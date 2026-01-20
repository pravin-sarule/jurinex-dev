const pool = require('../config/db');

/**
 * Draft model for managing document drafts
 */
class Draft {
  /**
   * Create a new draft record
   * @param {Object} data - Draft data
   * @returns {Promise<Object>} Created draft
   */
  static async create(data) {
    const {
      user_id,
      title,
      google_file_id = null,
      gcs_path = null,
      status = 'active',
      editor_type = null,
      drive_item_id = null,
      drive_path = null,
      last_synced_at = null,
      last_opened_at = null
    } = data;

    // Try to insert with all columns (new schema)
    // If columns don't exist, fall back to basic columns
    try {
      const query = `
        INSERT INTO drafts (user_id, title, google_file_id, gcs_path, status, editor_type, drive_item_id, drive_path, last_synced_at, last_opened_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `;

      const values = [
        user_id,
        title,
        google_file_id,
        gcs_path,
        status,
        editor_type,
        drive_item_id || google_file_id, // Default to google_file_id if not provided
        drive_path,
        last_synced_at,
        last_opened_at
      ];

      const { rows } = await pool.query(query, values);
      return rows[0];
    } catch (error) {
      // If column doesn't exist error, try with basic columns only
      if (error.code === '42703' && error.message?.includes('does not exist')) {
        console.warn('[Draft] New columns not found, using basic schema. Please run migration 003_add_sync_fields.sql');
        
        // Check which columns exist by trying a simpler insert
        const basicQuery = `
          INSERT INTO drafts (user_id, title, google_file_id, gcs_path, status, editor_type, last_synced_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `;

        const basicValues = [
          user_id,
          title,
          google_file_id,
          gcs_path,
          status,
          editor_type,
          last_synced_at
        ];

        try {
          const { rows } = await pool.query(basicQuery, basicValues);
          return rows[0];
        } catch (basicError) {
          // If editor_type also doesn't exist, use minimal schema
          if (basicError.code === '42703' && basicError.message?.includes('editor_type')) {
            const minimalQuery = `
              INSERT INTO drafts (user_id, title, google_file_id, gcs_path, status, last_synced_at)
              VALUES ($1, $2, $3, $4, $5, $6)
              RETURNING *
            `;

            const minimalValues = [
              user_id,
              title,
              google_file_id,
              gcs_path,
              status,
              last_synced_at
            ];

            const { rows } = await pool.query(minimalQuery, minimalValues);
            return rows[0];
          }
          throw basicError;
        }
      }
      throw error;
    }
  }

  /**
   * Find a draft by ID
   * @param {number} id - Draft ID (SERIAL)
   * @returns {Promise<Object|null>} Draft or null
   */
  static async findById(id) {
    const query = 'SELECT * FROM drafts WHERE id = $1';
    const { rows } = await pool.query(query, [id]);
    return rows[0] || null;
  }

  /**
   * Find all drafts for a user
   * @param {number} userId - User ID (INT)
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of drafts
   */
  static async findByUserId(userId, options = {}) {
    const { status, limit = 50, offset = 0, editor_type = 'google' } = options;
    
    let query = 'SELECT * FROM drafts WHERE user_id = $1';
    const values = [userId];
    let paramIndex = 2;
    
    // Filter by editor_type (default to 'google' to only show Google Docs files)
    if (editor_type) {
      query += ` AND editor_type = $${paramIndex}`;
      values.push(editor_type);
      paramIndex++;
    }
    
    if (status) {
      query += ` AND status = $${paramIndex}`;
      values.push(status);
      paramIndex++;
    }
    
    query += ` ORDER BY id DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    values.push(limit, offset);
    
    const { rows } = await pool.query(query, values);
    return rows;
  }

  /**
   * Find a draft by Google file ID
   * @param {string} googleFileId - Google Drive file ID
   * @returns {Promise<Object|null>} Draft or null
   */
  static async findByGoogleFileId(googleFileId) {
    const query = 'SELECT * FROM drafts WHERE google_file_id = $1';
    const { rows } = await pool.query(query, [googleFileId]);
    return rows[0] || null;
  }

  /**
   * Update a draft
   * @param {number} id - Draft ID
   * @param {Object} data - Fields to update
   * @returns {Promise<Object|null>} Updated draft or null
   */
  static async update(id, data) {
    const allowedFields = [
      'title', 
      'status', 
      'google_file_id', 
      'gcs_path', 
      'last_synced_at', 
      'editor_type',
      'drive_item_id',
      'drive_path',
      'last_opened_at',
      'is_shared'
    ];
    const updates = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(data)) {
      if (allowedFields.includes(key) && value !== undefined) {
        updates.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    const query = `
      UPDATE drafts 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    try {
      const { rows } = await pool.query(query, values);
      return rows[0] || null;
    } catch (error) {
      // If column doesn't exist error, filter out new columns and retry
      if (error.code === '42703' && error.message?.includes('does not exist')) {
        console.warn('[Draft] Some columns not found, filtering out new columns. Please run migration 003_add_sync_fields.sql');
        
        // Filter out new columns that might not exist
        const newColumns = ['drive_item_id', 'drive_path', 'last_opened_at', 'is_shared'];
        const filteredUpdates = [];
        const filteredValues = [];
        let filteredParamIndex = 1;

        for (let i = 0; i < updates.length; i++) {
          const update = updates[i];
          const fieldName = update.split('=')[0].trim();
          
          // Skip new columns if they don't exist
          if (!newColumns.includes(fieldName)) {
            filteredUpdates.push(update.replace(/\$\d+/, `$${filteredParamIndex}`));
            filteredValues.push(values[i]);
            filteredParamIndex++;
          }
        }

        if (filteredUpdates.length === 0) {
          return this.findById(id);
        }

        filteredValues.push(id);
        const filteredQuery = `
          UPDATE drafts 
          SET ${filteredUpdates.join(', ')}
          WHERE id = $${filteredParamIndex}
          RETURNING *
        `;

        const { rows } = await pool.query(filteredQuery, filteredValues);
        return rows[0] || null;
      }
      throw error;
    }
  }

  /**
   * Update draft status
   * @param {number} id - Draft ID
   * @param {string} status - New status
   * @returns {Promise<Object|null>} Updated draft or null
   */
  static async updateStatus(id, status) {
    return this.update(id, { status });
  }

  /**
   * Delete a draft
   * @param {number} id - Draft ID
   * @returns {Promise<boolean>} True if deleted
   */
  static async delete(id) {
    const query = 'DELETE FROM drafts WHERE id = $1 RETURNING id';
    const { rows } = await pool.query(query, [id]);
    return rows.length > 0;
  }

  /**
   * Delete all drafts for a user
   * @param {number} userId - User ID
   * @returns {Promise<number>} Number of deleted drafts
   */
  static async deleteByUserId(userId) {
    const query = 'DELETE FROM drafts WHERE user_id = $1 RETURNING id';
    const { rows } = await pool.query(query, [userId]);
    return rows.length;
  }

  /**
   * Count drafts for a user
   * @param {number} userId - User ID
   * @param {string} status - Optional status filter
   * @returns {Promise<number>} Count
   */
  static async countByUserId(userId, status = null, editor_type = 'google') {
    let query = 'SELECT COUNT(*) as count FROM drafts WHERE user_id = $1';
    const values = [userId];
    let paramIndex = 2;
    
    // Filter by editor_type (default to 'google' to only show Google Docs files)
    if (editor_type) {
      query += ` AND editor_type = $${paramIndex}`;
      values.push(editor_type);
      paramIndex++;
    }
    
    if (status) {
      query += ` AND status = $${paramIndex}`;
      values.push(status);
    }
    
    const { rows } = await pool.query(query, values);
    return parseInt(rows[0].count, 10);
  }
}

module.exports = Draft;

