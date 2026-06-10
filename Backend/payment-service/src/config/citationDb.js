/**
 * citationDb.js — Pool for citation_db (citation_reports, citation_pipeline_runs).
 * Env var: CITATION_DATABASE_URL
 */
const { Pool } = require('pg');
const citationPool = new Pool({
  connectionString: process.env.CITATION_DATABASE_URL || process.env.DATABASE_URL,
});
citationPool.on('error', (err) =>
  console.error('[CitationDB] idle-client error:', err.message)
);
module.exports = citationPool;
