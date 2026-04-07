const pool = require('../config/db');

const initializeRbacSchema = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_permissions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE NOT NULL,
        permissions JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('[RBAC Service] Schema initialized successfully');
  } catch (err) {
    console.error('[RBAC Service] Schema initialization failed:', err);
  }
};

module.exports = { initializeRbacSchema };
