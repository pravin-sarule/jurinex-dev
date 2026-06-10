/**
 * storageController.js  (ChatModel)
 *
 * GET /api/chat/storage/usage
 *
 * Returns a full storage breakdown for the authenticated user:
 *   - filesBytes     – GCS file bytes from user_files.size (with GCS fallback repair)
 *   - chatBytes      – byte length of question + answer columns in file_chats
 *   - questionBytes  – byte length of question column only
 *   - embeddingBytes – chunk_vectors count × 768 dims × 4 bytes
 *   - totalBytes     – sum of all above
 *
 * Also fires a background incremental adjust to the payment-service cache.
 */

const pool    = require('../config/db');
const { getBucket } = require('../config/gcs');

const INPUT_BUCKET   = process.env.GCS_BUCKET_NAME        || 'fileinputbucket';
const PAYMENT_SVC    = process.env.PAYMENT_SERVICE_URL     || 'http://localhost:5003';
const EMBED_DIMS     = parseInt(process.env.STORAGE_EMBED_DIMS || '768', 10);
const BYTES_PER_FLOAT = 4;

// ─── GCS helpers ─────────────────────────────────────────────────────────────

async function sumGcsBucketPrefix(bucketName, prefix) {
  if (!bucketName || !prefix) return 0;
  try {
    const bucket = getBucket(bucketName);
    const [files] = await bucket.getFiles({ prefix, autoPaginate: true });
    return files.reduce((sum, f) => sum + Number(f.metadata?.size || 0), 0);
  } catch (err) {
    console.warn(`[StorageCtrl] GCS listing failed bucket=${bucketName} prefix=${prefix}:`, err.message);
    return 0;
  }
}

async function repairFileSizeInDb(fileId, bucketName, gcsPath, client) {
  try {
    const bucket = getBucket(bucketName);
    const [meta] = await bucket.file(gcsPath).getMetadata();
    const realSize = Number(meta?.size || 0);
    if (realSize > 0) {
      await client.query(
        'UPDATE user_files SET size = $1 WHERE id = $2 AND (size IS NULL OR size = 0)',
        [realSize, fileId]
      );
    }
  } catch (_) {
    // non-fatal background repair
  }
}

// ─── Payment-service cache push (fire-and-forget) ────────────────────────────

async function pushToPaymentCache(userId, stats) {
  const url = `${PAYMENT_SVC}/api/storage/internal/adjust`;
  try {
    const { default: fetch } = await import('node-fetch').catch(() => ({ default: null }));
    if (!fetch) return;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        filesBytes:          stats.filesBytes,
        chatBytes:           stats.chatBytes,
        questionBytes:       stats.questionBytes,
        embeddingBytes:      stats.embeddingBytes,
        fileCountDelta:      0,
        chatCountDelta:      0,
        embeddingCountDelta: 0,
      }),
      signal: AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined,
    });
  } catch (_) {
    // non-fatal
  }
}

// ─── Controller ───────────────────────────────────────────────────────────────

/**
 * GET /api/chat/storage/usage
 */
exports.getUserStorageUsage = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    // ── 1. File storage from DB ────────────────────────────────────────────
    const fileRes = await pool.query(
      `SELECT
         COUNT(*)::int                                                     AS documents_used,
         COALESCE(SUM(size), 0)::bigint                                    AS total_bytes,
         ARRAY_AGG(
           CASE WHEN (size IS NULL OR size = 0) AND gcs_path IS NOT NULL
                THEN json_build_object('id', id::text, 'gcs_path', gcs_path)
                ELSE NULL END
         ) FILTER (WHERE (size IS NULL OR size = 0) AND gcs_path IS NOT NULL)
           AS zero_size_files
       FROM user_files
       WHERE user_id = $1
         AND (is_folder IS NULL OR is_folder = FALSE)`,
      [String(userId)]
    );

    const fileRow      = fileRes.rows[0] || {};
    const documentsUsed = Number(fileRow.documents_used || 0);
    let   filesBytes    = Number(fileRow.total_bytes    || 0);
    const zeroFiles     = fileRow.zero_size_files || [];

    // ── 2. Background size repair for zero-byte rows ───────────────────────
    if (zeroFiles.length > 0) {
      const client = await pool.connect();
      (async () => {
        try {
          for (const f of zeroFiles.slice(0, 20)) {
            if (!f?.gcs_path) continue;
            await repairFileSizeInDb(f.id, INPUT_BUCKET, f.gcs_path, client);
          }
        } finally { client.release(); }
      })().catch(() => {});
    }

    // ── 3. GCS fallback when DB sum is zero ───────────────────────────────
    let gcsFallbackBytes = 0;
    if (filesBytes === 0) {
      const [chatUp, docUp, rootUp] = await Promise.all([
        sumGcsBucketPrefix(INPUT_BUCKET, `chat-uploads/${userId}/`),
        sumGcsBucketPrefix(INPUT_BUCKET, `${userId}/documents/`),
        sumGcsBucketPrefix(INPUT_BUCKET, `${userId}/`),
      ]);
      gcsFallbackBytes = Math.max(chatUp + docUp, rootUp, chatUp);
      filesBytes = gcsFallbackBytes;
    }

    // ── 4. Chat + question storage ────────────────────────────────────────
    const chatRes = await pool.query(
      `SELECT
         COUNT(*)::int                                                  AS chat_count,
         COALESCE(SUM(
           OCTET_LENGTH(COALESCE(question,'')) +
           OCTET_LENGTH(COALESCE(answer,''))
         ), 0)::bigint                                                  AS chat_bytes,
         COALESCE(SUM(OCTET_LENGTH(COALESCE(question,''))), 0)::bigint AS question_bytes
       FROM file_chats
       WHERE user_id = $1`,
      [String(userId)]
    );
    const chatRow      = chatRes.rows[0] || {};
    const chatBytes    = Number(chatRow.chat_bytes    || 0);
    const questionBytes = Number(chatRow.question_bytes || 0);
    const chatCount    = Number(chatRow.chat_count    || 0);

    // ── 5. Embedding storage ──────────────────────────────────────────────
    let embeddingCount = 0;
    try {
      const embedRes = await pool.query(
        `SELECT COUNT(*)::int AS embedding_count
         FROM chunk_vectors cv
         JOIN user_files uf ON cv.file_id = uf.id
         WHERE uf.user_id = $1`,
        [String(userId)]
      );
      embeddingCount = Number(embedRes.rows[0]?.embedding_count || 0);
    } catch (_) {
      // chunk_vectors may be in a separate DB
    }
    const embeddingBytes = embeddingCount * EMBED_DIMS * BYTES_PER_FLOAT;

    // ── 6. Totals ─────────────────────────────────────────────────────────
    const totalBytes = filesBytes + chatBytes + embeddingBytes;

    const stats = {
      filesBytes, chatBytes, questionBytes, embeddingBytes,
      totalBytes, embeddingCount,
    };

    // Push to payment-service cache in background
    pushToPaymentCache(userId, stats).catch(() => {});

    return res.status(200).json({
      success: true,
      data: {
        // Legacy top-level fields
        storage_used_bytes: filesBytes,
        storage_used_gb:    parseFloat((filesBytes / 1024 ** 3).toFixed(6)),
        documents_used:     documentsUsed,
        breakdown: {
          db_bytes:             Number(fileRow.total_bytes || 0),
          gcs_fallback_bytes:   gcsFallbackBytes,
          zero_size_file_count: zeroFiles.length,
        },

        // Full breakdown
        filesBytes,
        chatBytes,
        questionBytes,
        embeddingBytes,
        totalBytes,
        totalMB: parseFloat((totalBytes / 1024 ** 2).toFixed(4)),
        totalGB: parseFloat((totalBytes / 1024 ** 3).toFixed(6)),

        counts: {
          files:      documentsUsed,
          chats:      chatCount,
          embeddings: embeddingCount,
        },
      },
    });
  } catch (err) {
    console.error('[StorageCtrl] getUserStorageUsage failed:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to calculate storage',
      error: err.message,
    });
  }
};
