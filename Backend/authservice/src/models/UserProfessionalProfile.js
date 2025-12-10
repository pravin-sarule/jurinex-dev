const pool = require('../config/db');

class UserProfessionalProfile {
  /**
   * Find profile by user_id
   */
  static async findByUserId(userId) {
    const result = await pool.query(
      'SELECT * FROM user_professional_profiles WHERE user_id = $1',
      [userId]
    );
    return result.rows[0];
  }

  /**
   * Create a new profile with default values
   */
  static async create(userId) {
    const result = await pool.query(
      `INSERT INTO user_professional_profiles (
        user_id, 
        is_profile_completed,
        created_at, 
        updated_at
      ) VALUES ($1, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *`,
      [userId]
    );
    return result.rows[0];
  }

  /**
   * Create or get existing profile (used during login)
   */
  static async findOrCreate(userId) {
    let profile = await this.findByUserId(userId);
    
    if (!profile) {
      profile = await this.create(userId);
    }
    
    return profile;
  }

  /**
   * Update profile fields
   * Allows updating all fields including null and empty string values
   */
  static async update(userId, fields) {
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    // Build dynamic update query
    // Allow undefined to be skipped, but allow null and empty strings to be set
    for (const key in fields) {
      if (fields[key] !== undefined) {
        setClauses.push(`${key} = $${paramIndex}`);
        // Allow null, empty string, or any other value
        values.push(fields[key] === null ? null : fields[key]);
        paramIndex++;
      }
    }

    if (setClauses.length === 0) {
      return this.findByUserId(userId); // No fields to update, return current profile
    }

    values.push(userId); // Add userId for WHERE clause
    const query = `
      UPDATE user_professional_profiles 
      SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP 
      WHERE user_id = $${paramIndex} 
      RETURNING *
    `;
    
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Delete profile (usually handled by CASCADE on user delete)
   */
  static async delete(userId) {
    const result = await pool.query(
      'DELETE FROM user_professional_profiles WHERE user_id = $1 RETURNING *',
      [userId]
    );
    return result.rows[0];
  }
}

module.exports = UserProfessionalProfile;

