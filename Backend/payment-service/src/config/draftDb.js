/**
 * draftDb.js — Pool for Draft_DB (generated_documents, user_drafts).
 * Env var: DRAFT_DATABASE_URL
 */
const { Pool } = require('pg');
const draftPool = new Pool({
  connectionString: process.env.DRAFT_DATABASE_URL || process.env.DATABASE_URL,
});
draftPool.on('error', (err) =>
  console.error('[DraftDB] idle-client error:', err.message)
);
module.exports = draftPool;
