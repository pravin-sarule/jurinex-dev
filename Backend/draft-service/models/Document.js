const pool = require('../config/db');

class Document {
  // Table name: word_documents (matching your database schema)
  static getTableName() {
    return 'word_documents';
  }

  static async create({ title, content = '', userId, user_id }) {
    // Support both userId and user_id for compatibility
    const uid = userId || user_id;
    if (!uid) {
      throw new Error('user_id is required to create a document');
    }
    
    const tableName = this.getTableName();
    const result = await pool.query(
      `INSERT INTO ${tableName} (title, content, user_id, created_at, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [title, content, uid]
    );
    return result.rows[0];
  }

  static async findAll(options = {}) {
    const { where = {}, order = [] } = options;
    const tableName = this.getTableName();
    let query = `SELECT * FROM ${tableName}`;
    const values = [];
    const conditions = [];

    // Support both userId and user_id for compatibility
    const userId = where.userId || where.user_id;
    if (userId) {
      conditions.push(`user_id = $${values.length + 1}`);
      values.push(userId);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    if (order.length > 0) {
      const [field, direction] = order[0];
      query += ` ORDER BY ${field} ${direction || 'ASC'}`;
    }

    const result = await pool.query(query, values);
    return result.rows;
  }

  static async findOne(options = {}) {
    const { where = {} } = options;
    const tableName = this.getTableName();
    let query = `SELECT * FROM ${tableName}`;
    const values = [];
    const conditions = [];

    if (where.id) {
      conditions.push(`id = $${values.length + 1}`);
      values.push(where.id);
    }

    // Support both userId and user_id for compatibility
    const userId = where.userId || where.user_id;
    if (userId) {
      conditions.push(`user_id = $${values.length + 1}`);
      values.push(userId);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ' LIMIT 1';

    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  async update(fields) {
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    for (const key in fields) {
      if (fields[key] !== undefined) {
        setClauses.push(`${key} = $${paramIndex}`);
        values.push(fields[key]);
        paramIndex++;
      }
    }

    if (setClauses.length === 0) {
      return this;
    }

    values.push(this.id);
    const tableName = this.constructor.getTableName();
    const query = `UPDATE ${tableName} SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIndex} RETURNING *`;
    
    const result = await pool.query(query, values);
    Object.assign(this, result.rows[0]);
    return this;
  }

  async destroy() {
    const tableName = this.constructor.getTableName();
    await pool.query(`DELETE FROM ${tableName} WHERE id = $1`, [this.id]);
    return true;
  }

  toJSON() {
    return { ...this };
  }
}

module.exports = Document;
