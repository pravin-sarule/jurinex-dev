#!/usr/bin/env node
/**
 * db/migrate.js — Run all SQL migrations in db/migrations/ in alphabetical order.
 *
 * Usage:
 *   node db/migrate.js
 *   DATABASE_URL="postgresql://user:pass@host/db" node db/migrate.js
 *
 * The script is idempotent: it creates a schema_migrations table to track which
 * files have already been applied and skips them on subsequent runs.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[migrate] ERROR: DATABASE_URL environment variable is not set.');
  process.exit(1);
}

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function run() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log('[migrate] Connected to database.');

  try {
    // Create the tracking table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    TEXT        PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Fetch already-applied files
    const { rows } = await client.query('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map(r => r.filename));

    // Collect SQL files and sort alphabetically (numeric prefix ordering)
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    let ranCount = 0;
    let skippedCount = 0;

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`[migrate] SKIP  ${file}`);
        skippedCount++;
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`[migrate] RUN   ${file}`);

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
        console.log(`[migrate] OK    ${file}`);
        ranCount++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[migrate] FAIL  ${file}: ${err.message}`);
        throw err;
      }
    }

    console.log(`\n[migrate] Done. ${ranCount} applied, ${skippedCount} skipped.`);
  } finally {
    await client.end();
  }
}

run().catch(err => {
  console.error('[migrate] Fatal:', err.message);
  process.exit(1);
});
