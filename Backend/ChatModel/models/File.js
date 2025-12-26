const pool = require('../config/db');
const { v4: uuidv4 } = require('uuid');

class File {
  static async create({ user_id, originalname, gcs_path, mimetype, size, status = 'uploaded' }) {
    const id = uuidv4();
    const result = await pool.query(
      `INSERT INTO user_files (id, user_id, originalname, gcs_path, mimetype, size, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *`,
      [id, user_id, originalname, gcs_path, mimetype, size, status]
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await pool.query('SELECT * FROM user_files WHERE id = $1::uuid', [id]);
    return result.rows[0];
  }

  static async findByUserId(user_id) {
    const result = await pool.query(
      'SELECT * FROM user_files WHERE user_id = $1 AND is_folder = false ORDER BY created_at DESC',
      [user_id]
    );
    return result.rows;
  }

  static async updateStatus(id, status) {
    const result = await pool.query(
      'UPDATE user_files SET status = $1, updated_at = NOW() WHERE id = $2::uuid RETURNING *',
      [status, id]
    );
    return result.rows[0];
  }
}

module.exports = File;

