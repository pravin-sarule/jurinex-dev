const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.connect()
  .then(() => console.log('[AI-Agent] Database connected successfully.'))
  .catch(err => console.error('[AI-Agent] Database connection failed:', err));

pool.on('error', (err) => {
  console.error('[AI-Agent] Unexpected error on idle client', err);
  process.exit(-1);
});

module.exports = pool;
