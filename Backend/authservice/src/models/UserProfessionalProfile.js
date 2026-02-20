const pool = require('../config/db');

class UserProfessionalProfile {
  static async findByUserId(userId) {
    const result = await pool.query(
      'SELECT * FROM user_professional_profiles WHERE user_id = $1',
      [userId]
    );
    return result.rows[0];
  }

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

  static async findOrCreate(userId) {
    let profile = await this.findByUserId(userId);
    
    if (!profile) {
      profile = await this.create(userId);
    }
    
    return profile;
  }

  static ALLOWED_COLUMNS = new Set([
    'is_profile_completed', 'preferred_tone', 'preferred_detail_level', 'citation_style',
    'perspective', 'typical_client', 'highlights_in_summary', 'organization_name',
    'primary_role', 'experience', 'primary_jurisdiction', 'main_areas_of_practice',
    'organization_type', 'bar_enrollment_number'
  ]);

  static async update(userId, fields) {
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    for (const key in fields) {
      if (fields[key] !== undefined && this.ALLOWED_COLUMNS.has(key)) {
        setClauses.push(`"${key}" = $${paramIndex}`);
        let val = fields[key] === null ? null : fields[key];
        if (Array.isArray(val) || (typeof val === 'object' && val !== null)) {
          val = JSON.stringify(val);
        }
        values.push(val);
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

  static async delete(userId) {
    const result = await pool.query(
      'DELETE FROM user_professional_profiles WHERE user_id = $1 RETURNING *',
      [userId]
    );
    return result.rows[0];
  }
}

module.exports = UserProfessionalProfile;

