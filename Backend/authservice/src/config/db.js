const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();
console.log('DATABASE_URL:', process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool
  .query('SELECT 1')
  .then(() => console.log('Database connected successfully.'))
  .catch((err) => console.error('Database connection failed:', err));

pool.on('error', (err) => {
  console.error('Unexpected error on idle pool client:', err.message);
});

module.exports = pool;