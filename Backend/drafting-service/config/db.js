const { Pool } = require('pg');
require('dotenv').config({ path: './.env' });

// Support both DRAFT_DATABASE_URL and fallback to DATABASE_URL
const databaseUrl = process.env.DRAFTING_SERVICE_URL || process.env.DATABASE_URL;

console.log('DRAFT_DATABASE_URL:', process.env.DRAFTING_SERVICE_URL ? '***configured***' : 'NOT SET');
console.log('DATABASE_URL fallback:', !process.env.DRAFTING_SERVICE_URL && process.env.DATABASE_URL ? '***using fallback***' : 'N/A');

if (!databaseUrl) {
  console.error('❌ No database URL configured. Set DRAFT_DATABASE_URL or DATABASE_URL in your .env file');
}

const pool = new Pool({
  connectionString: databaseUrl,
});

pool.connect()
  .then(() => console.log('✅ Draft Database connected successfully.'))
  .catch(err => console.error('❌ Draft Database connection failed:', err));

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

module.exports = pool;

