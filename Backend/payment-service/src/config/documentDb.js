/**
 * documentDb.js
 *
 * Secondary PostgreSQL connection to Document_DB.
 * Used by storageStatsService to query user_files, file_chats, chunk_vectors
 * which live in Document_DB (not Payment_DB).
 *
 * Env var: DOCUMENT_DATABASE_URL (falls back to DATABASE_URL so local dev
 * without a separate env still works, albeit against the same DB).
 */

const { Pool } = require('pg');

const connStr =
  process.env.DOCUMENT_DATABASE_URL ||
  process.env.DATABASE_URL;

const documentPool = new Pool({ connectionString: connStr });

documentPool.on('error', (err) => {
  console.error('[DocumentDB] Unexpected idle-client error:', err.message);
});

module.exports = documentPool;
