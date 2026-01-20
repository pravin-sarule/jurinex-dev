/**
 * PostgreSQL Database Configuration
 * Uses connection pooling for production performance
 */
const { Pool } = require('pg');
require('dotenv').config();

console.log(`[DraftingService] DATABASE_URL: ${process.env.DATABASE_URL ? 'CONFIGURED' : 'MISSING'}`);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20, // Maximum connections in pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});

// Log pool errors
pool.on('error', (err) => {
    console.error('❌ [DraftingService] Unexpected database pool error:', err.message);
});

module.exports = pool;
