/**
 * storageStatsService.js
 *
 * Aggregates storage usage across all tables:
 *
 *   Document_DB (documentPool):
 *     user_files   → GCS file bytes (size column)
 *     file_chats   → chat/question byte lengths
 *     chunk_vectors → embedding count (count × dims × 4 bytes)
 *
 *   Payment_DB (pool):
 *     user_storage_stats → persistent cache of calculated totals
 *     monthly_plans / user_subscriptions → storage quota
 *
 * Results are upserted into user_storage_stats after every recalculation.
 */

const pool         = require('../config/db');          // Payment_DB
const documentPool = require('../config/documentDb');  // Document_DB
const draftPool    = require('../config/draftDb');     // Draft_DB
const citationPool = require('../config/citationDb');  // citation_db

const EMBED_DIMS      = parseInt(process.env.STORAGE_EMBED_DIMS || '768', 10);
const BYTES_PER_FLOAT = 4;

// ─── Core calculation ─────────────────────────────────────────────────────────

async function calculateUserStorage(userId) {
  const uid = String(userId);

  const [fileRes, chatRes, embedRes, draftRes, citationRes] = await Promise.all([

    // 1. File storage broken down by service (gcs_path prefix pattern)
    //    chat-uploads/…         → Chat Model
    //    {uid}/documents/…      → Document Service
    //    uploads/…              → Draft Service
    //    everything else        → Other
    documentPool.query(
      `SELECT
         COUNT(*)::int                                                        AS file_count,
         COALESCE(SUM(size), 0)::bigint                                       AS files_bytes,
         COALESCE(SUM(size) FILTER (WHERE gcs_path LIKE 'chat-uploads/%'), 0)::bigint
                                                                              AS chat_model_bytes,
         COUNT(*) FILTER (WHERE gcs_path LIKE 'chat-uploads/%')::int         AS chat_model_count,
         COALESCE(SUM(size) FILTER (
           WHERE gcs_path ~ ('^' || user_id || '/documents/')
        ), 0)::bigint                                                         AS doc_service_bytes,
         COUNT(*) FILTER (WHERE gcs_path ~ ('^' || user_id || '/documents/'))::int
                                                                              AS doc_service_count,
         COALESCE(SUM(size) FILTER (WHERE gcs_path LIKE 'uploads/%'), 0)::bigint
                                                                              AS draft_service_bytes,
         COUNT(*) FILTER (WHERE gcs_path LIKE 'uploads/%')::int              AS draft_service_count,
         COALESCE(SUM(size) FILTER (
           WHERE gcs_path NOT LIKE 'chat-uploads/%'
             AND NOT (gcs_path ~ ('^' || user_id || '/documents/'))
             AND gcs_path NOT LIKE 'uploads/%'
        ), 0)::bigint                                                         AS other_bytes,
         COUNT(*) FILTER (
           WHERE gcs_path NOT LIKE 'chat-uploads/%'
             AND NOT (gcs_path ~ ('^' || user_id || '/documents/'))
             AND gcs_path NOT LIKE 'uploads/%'
        )::int                                                                AS other_count
       FROM user_files
       WHERE user_id = $1
         AND (is_folder IS NULL OR is_folder = FALSE)`,
      [uid]
    ),

    // 2. Chat + question storage: OCTET_LENGTH of question / answer columns
    documentPool.query(
      `SELECT
         COUNT(*)::int                                                  AS chat_count,
         COALESCE(SUM(
           OCTET_LENGTH(COALESCE(question,'')) +
           OCTET_LENGTH(COALESCE(answer,''))
         ), 0)::bigint                                                  AS chat_bytes,
         COALESCE(SUM(OCTET_LENGTH(COALESCE(question,''))), 0)::bigint AS question_bytes
       FROM file_chats
       WHERE user_id = $1`,
      [uid]
    ),

    // 3. Embedding count: join through user_files to scope by user
    documentPool.query(
      `SELECT COUNT(*)::int AS embedding_count
       FROM chunk_vectors cv
       JOIN user_files uf ON cv.file_id = uf.id
       WHERE uf.user_id = $1`,
      [uid]
    ).catch(() => ({ rows: [{ embedding_count: 0 }] })),

    // 4. Draft storage: generated_documents.file_size via user_drafts
    draftPool.query(
      `SELECT
         COUNT(gd.document_id)::int                     AS draft_count,
         COALESCE(SUM(gd.file_size), 0)::bigint         AS draft_bytes
       FROM generated_documents gd
       JOIN user_drafts ud ON gd.draft_id = ud.draft_id
       WHERE ud.user_id::text = $1`,
      [uid]
    ).catch(() => ({ rows: [{ draft_count: 0, draft_bytes: 0 }] })),

    // 5. Citation storage: per-user report text + query text
    citationPool.query(
      `SELECT
         COUNT(*)::int                                                                AS citation_count,
         COALESCE(SUM(
           OCTET_LENGTH(COALESCE(query, '')) +
           OCTET_LENGTH(COALESCE(report_format::text, ''))
         ), 0)::bigint                                                               AS citation_bytes
       FROM citation_reports
       WHERE user_id = $1`,
      [uid]
    ).catch(() => ({ rows: [{ citation_count: 0, citation_bytes: 0 }] })),
  ]);

  const fileRow     = fileRes.rows[0]     || {};
  const chatRow     = chatRes.rows[0]     || {};
  const embedRow    = embedRes.rows[0]    || {};
  const draftRow    = draftRes.rows[0]    || {};
  const citationRow = citationRes.rows[0] || {};

  const filesBytes     = Number(fileRow.files_bytes        || 0);
  const chatBytes      = Number(chatRow.chat_bytes         || 0);
  const questionBytes  = Number(chatRow.question_bytes     || 0);
  const embeddingCount = Number(embedRow.embedding_count   || 0);
  const embeddingBytes = embeddingCount * EMBED_DIMS * BYTES_PER_FLOAT;
  const draftBytes     = Number(draftRow.draft_bytes       || 0);
  const draftCount     = Number(draftRow.draft_count       || 0);
  const citationBytes  = Number(citationRow.citation_bytes || 0);
  const citationCount  = Number(citationRow.citation_count || 0);
  const totalBytes     = filesBytes + chatBytes + embeddingBytes + draftBytes + citationBytes;

  return {
    fileCount:      Number(fileRow.file_count || 0),
    chatCount:      Number(chatRow.chat_count || 0),
    embeddingCount,
    draftCount,
    citationCount,
    filesBytes,
    chatBytes,
    questionBytes,
    embeddingBytes,
    draftBytes,
    citationBytes,
    totalBytes,
    totalKB: totalBytes / 1024,
    totalMB: totalBytes / 1024 ** 2,
    totalGB: totalBytes / 1024 ** 3,
    filesByService: {
      chatModel:    { bytes: Number(fileRow.chat_model_bytes    || 0), count: Number(fileRow.chat_model_count    || 0) },
      docService:   { bytes: Number(fileRow.doc_service_bytes   || 0), count: Number(fileRow.doc_service_count   || 0) },
      draftService: { bytes: Number(fileRow.draft_service_bytes || 0), count: Number(fileRow.draft_service_count || 0) },
      other:        { bytes: Number(fileRow.other_bytes         || 0), count: Number(fileRow.other_count         || 0) },
    },
  };
}

// ─── Cache upsert (Payment_DB) ────────────────────────────────────────────────

async function upsertStorageCache(userId, s) {
  // Ensure new columns exist (idempotent — only fails silently if already present)
  await pool.query(`
    ALTER TABLE user_storage_stats
      ADD COLUMN IF NOT EXISTS draft_count    INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS citation_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS draft_bytes    BIGINT  NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS citation_bytes BIGINT  NOT NULL DEFAULT 0
  `).catch(() => {});

  await pool.query(
    `INSERT INTO user_storage_stats
       (user_id, file_count, chat_count, embedding_count, draft_count, citation_count,
        files_bytes, chat_bytes, question_bytes, embedding_bytes, draft_bytes, citation_bytes,
        total_bytes, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       file_count      = EXCLUDED.file_count,
       chat_count      = EXCLUDED.chat_count,
       embedding_count = EXCLUDED.embedding_count,
       draft_count     = EXCLUDED.draft_count,
       citation_count  = EXCLUDED.citation_count,
       files_bytes     = EXCLUDED.files_bytes,
       chat_bytes      = EXCLUDED.chat_bytes,
       question_bytes  = EXCLUDED.question_bytes,
       embedding_bytes = EXCLUDED.embedding_bytes,
       draft_bytes     = EXCLUDED.draft_bytes,
       citation_bytes  = EXCLUDED.citation_bytes,
       total_bytes     = EXCLUDED.total_bytes,
       updated_at      = NOW()`,
    [
      String(userId),
      s.fileCount, s.chatCount, s.embeddingCount, s.draftCount  ?? 0, s.citationCount ?? 0,
      s.filesBytes, s.chatBytes, s.questionBytes, s.embeddingBytes,
      s.draftBytes ?? 0, s.citationBytes ?? 0,
      s.totalBytes,
    ]
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Recalculate storage for a user from Document_DB, cache to Payment_DB, return stats.
 */
async function getStorageUsage(userId) {
  const stats = await calculateUserStorage(userId);
  upsertStorageCache(userId, stats).catch(err =>
    console.warn('[StorageStats] cache upsert failed:', err.message)
  );
  return stats;
}

/**
 * Fast read from Payment_DB cache (no Document_DB scan).
 */
async function getCachedStorageUsage(userId) {
  const res = await pool.query(
    `SELECT * FROM user_storage_stats WHERE user_id = $1`,
    [String(userId)]
  );
  return res.rows[0] || null;
}

/**
 * Admin: all users sorted by total_bytes DESC (recalculates every user).
 */
async function getAllUsersStorageUsage() {
  const usersRes = await documentPool.query(
    `SELECT DISTINCT user_id::text AS user_id FROM (
       SELECT user_id FROM user_files WHERE is_folder IS NULL OR is_folder = FALSE
       UNION
       SELECT user_id FROM file_chats
     ) u`
  );

  const results = await Promise.all(
    usersRes.rows.map(async (row) => {
      try {
        const stats = await calculateUserStorage(row.user_id);
        upsertStorageCache(row.user_id, stats).catch(() => {});
        return { userId: row.user_id, ...stats };
      } catch {
        return { userId: row.user_id, error: true, totalBytes: 0 };
      }
    })
  );

  return results
    .filter(r => !r.error)
    .sort((a, b) => b.totalBytes - a.totalBytes);
}

/**
 * Incremental O(1) update to the cache row (called by file-upload/delete hooks).
 */
async function adjustStorageCache(userId, delta) {
  const fb = Number(delta.filesBytes     || 0);
  const cb = Number(delta.chatBytes      || 0);
  const qb = Number(delta.questionBytes  || 0);
  const eb = Number(delta.embeddingBytes || 0);
  const tb = fb + cb + qb + eb;

  await pool.query(
    `INSERT INTO user_storage_stats
       (user_id, file_count, chat_count, embedding_count,
        files_bytes, chat_bytes, question_bytes, embedding_bytes,
        total_bytes, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       file_count      = GREATEST(0, user_storage_stats.file_count      + $2),
       chat_count      = GREATEST(0, user_storage_stats.chat_count      + $3),
       embedding_count = GREATEST(0, user_storage_stats.embedding_count + $4),
       files_bytes     = GREATEST(0, user_storage_stats.files_bytes     + $5),
       chat_bytes      = GREATEST(0, user_storage_stats.chat_bytes      + $6),
       question_bytes  = GREATEST(0, user_storage_stats.question_bytes  + $7),
       embedding_bytes = GREATEST(0, user_storage_stats.embedding_bytes + $8),
       total_bytes     = GREATEST(0, user_storage_stats.total_bytes     + $9),
       updated_at      = NOW()`,
    [
      String(userId),
      Number(delta.fileCountDelta      || 0),
      Number(delta.chatCountDelta      || 0),
      Number(delta.embeddingCountDelta || 0),
      fb, cb, qb, eb, tb,
    ]
  );
}

module.exports = {
  getStorageUsage,
  getCachedStorageUsage,
  getAllUsersStorageUsage,
  adjustStorageCache,
  calculateUserStorage,
};
