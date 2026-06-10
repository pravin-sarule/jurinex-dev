/**
 * storageController.js
 *
 * User endpoint:  GET /api/storage/usage
 * Admin endpoint: GET /api/storage/admin/users
 * Internal hook:  POST /api/storage/internal/adjust  (no auth — intranet only)
 */

const {
  getStorageUsage,
  getAllUsersStorageUsage,
  adjustStorageCache,
} = require('../services/storageStatsService');
const pool = require('../config/db');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(bytes) {
  return {
    bytes,
    kb:   parseFloat((bytes / 1024).toFixed(2)),
    mb:   parseFloat((bytes / 1024 ** 2).toFixed(4)),
    gb:   parseFloat((bytes / 1024 ** 3).toFixed(6)),
  };
}

async function getStorageLimitBytes(userId) {
  try {
    const res = await pool.query(
      `SELECT mp.storage_limit_gb, us.extra_storage_bytes
       FROM user_subscriptions us
       JOIN monthly_plans mp ON us.monthly_plan_id = mp.id
       WHERE us.user_id = $1
         AND us.status  = 'active'
       LIMIT 1`,
      [userId]
    );
    if (res.rows[0]?.storage_limit_gb) {
      const planBytes  = parseFloat(res.rows[0].storage_limit_gb) * 1024 ** 3;
      const extraBytes = Number(res.rows[0].extra_storage_bytes || 0);
      return planBytes + extraBytes;
    }
    // Fallback: try subscription_plans table (legacy)
    const res2 = await pool.query(
      `SELECT sp.storage_limit_gb, us.extra_storage_bytes
       FROM user_subscriptions us
       JOIN subscription_plans sp ON us.plan_id = sp.id
       WHERE us.user_id = $1
         AND us.status  = 'active'
       LIMIT 1`,
      [userId]
    );
    if (res2.rows[0]?.storage_limit_gb) {
      const planBytes  = parseFloat(res2.rows[0].storage_limit_gb) * 1024 ** 3;
      const extraBytes = Number(res2.rows[0].extra_storage_bytes || 0);
      return planBytes + extraBytes;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Controllers ─────────────────────────────────────────────────────────────

/**
 * GET /api/storage/usage
 * Returns full storage breakdown for the authenticated user.
 */
exports.getUserStorageUsage = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    const [stats, limitBytes] = await Promise.all([
      getStorageUsage(String(userId)),
      getStorageLimitBytes(String(userId)),
    ]);

    const usagePct = limitBytes
      ? parseFloat(((stats.totalBytes / limitBytes) * 100).toFixed(2))
      : null;

    return res.json({
      success: true,
      userId: String(userId),

      // Per-category breakdown
      filesBytes:     stats.filesBytes,
      chatBytes:      stats.chatBytes,
      questionBytes:  stats.questionBytes,
      embeddingBytes: stats.embeddingBytes,
      draftBytes:     stats.draftBytes     ?? 0,
      citationBytes:  stats.citationBytes  ?? 0,
      totalBytes:     stats.totalBytes,

      // Human-readable
      files:     fmt(stats.filesBytes),
      chat:      fmt(stats.chatBytes),
      questions: fmt(stats.questionBytes),
      embeddings: fmt(stats.embeddingBytes),
      drafts:    fmt(stats.draftBytes     ?? 0),
      citations: fmt(stats.citationBytes  ?? 0),
      total:     fmt(stats.totalBytes),

      // Legacy flat fields for backward compat
      totalKB: parseFloat((stats.totalBytes / 1024).toFixed(2)),
      totalMB: parseFloat((stats.totalBytes / 1024 ** 2).toFixed(4)),
      totalGB: parseFloat((stats.totalBytes / 1024 ** 3).toFixed(6)),

      // Counts
      counts: {
        files:      stats.fileCount,
        chats:      stats.chatCount,
        embeddings: stats.embeddingCount,
        drafts:     stats.draftCount    ?? 0,
        citations:  stats.citationCount ?? 0,
      },

      // Per-service file breakdown
      filesByService: stats.filesByService || null,

      // Plan quota
      limitBytes:   limitBytes ?? null,
      limitGB:      limitBytes ? parseFloat((limitBytes / 1024 ** 3).toFixed(3)) : null,
      usagePct:     usagePct,
    });
  } catch (err) {
    console.error('[StorageCtrl] getUserStorageUsage error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to calculate storage usage' });
  }
};

/**
 * GET /api/storage/admin/users
 * All users sorted by storage consumed (admin only).
 */
exports.getAdminStorageUsage = async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }

  try {
    const users = await getAllUsersStorageUsage();
    return res.json({
      success: true,
      count: users.length,
      users: users.map(u => ({
        userId:         u.userId,
        fileCount:      u.fileCount,
        chatCount:      u.chatCount,
        embeddingCount: u.embeddingCount,
        filesBytes:     u.filesBytes,
        chatBytes:      u.chatBytes,
        questionBytes:  u.questionBytes,
        embeddingBytes: u.embeddingBytes,
        totalBytes:     u.totalBytes,
        totalMB:        parseFloat((u.totalBytes / 1024 ** 2).toFixed(4)),
        totalGB:        parseFloat((u.totalBytes / 1024 ** 3).toFixed(6)),
      })),
    });
  } catch (err) {
    console.error('[StorageCtrl] getAdminStorageUsage error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to retrieve admin storage data' });
  }
};

/**
 * POST /api/storage/internal/adjust
 * Called internally by ChatModel / agentic services after file upload/delete or chat save.
 * Body: { userId, filesBytes?, chatBytes?, questionBytes?, embeddingBytes?,
 *         fileCountDelta?, chatCountDelta?, embeddingCountDelta? }
 * No JWT auth — should only be reachable from internal network.
 */
exports.adjustStorageUsage = async (req, res) => {
  const { userId, ...delta } = req.body || {};
  if (!userId) return res.status(400).json({ success: false, message: 'userId required' });

  try {
    await adjustStorageCache(String(userId), delta);
    return res.json({ success: true });
  } catch (err) {
    console.error('[StorageCtrl] adjustStorageUsage error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to adjust storage cache' });
  }
};
