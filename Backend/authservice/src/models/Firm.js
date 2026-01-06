const pool = require('../config/db');

class Firm {
  static async create({
    firm_name,
    firm_type,
    establishment_date,
    registering_advocate_name,
    bar_enrollment_number,
    enrollment_date,
    state_bar_council,
    email,
    mobile,
    landline = null,
    office_address,
    city,
    district = null,
    state,
    pin_code,
    pan_number,
    gst_number = null,
    approval_status = 'PENDING',
    admin_user_id = null
  }) {
    const result = await pool.query(
      `INSERT INTO firms (
        firm_name, firm_type, establishment_date,
        registering_advocate_name, bar_enrollment_number, enrollment_date, state_bar_council,
        email, mobile, landline,
        office_address, city, district, state, pin_code,
        pan_number, gst_number,
        approval_status, admin_user_id,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *`,
      [
        firm_name, firm_type, establishment_date,
        registering_advocate_name, bar_enrollment_number, enrollment_date, state_bar_council,
        email, mobile, landline,
        office_address, city, district, state, pin_code,
        pan_number, gst_number,
        approval_status, admin_user_id
      ]
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await pool.query('SELECT * FROM firms WHERE id = $1', [id]);
    return result.rows[0];
  }

  static async findByEmail(email) {
    const result = await pool.query('SELECT * FROM firms WHERE email = $1', [email]);
    return result.rows[0];
  }

  static async findByAdminUserId(adminUserId) {
    const result = await pool.query('SELECT * FROM firms WHERE admin_user_id = $1', [adminUserId]);
    return result.rows[0];
  }

  static async update(id, fields) {
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
      return this.findById(id);
    }

    values.push(id);
    const query = `UPDATE firms SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIndex} RETURNING *`;
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async findAllPending() {
    const result = await pool.query(
      "SELECT * FROM firms WHERE approval_status = 'PENDING' ORDER BY created_at DESC"
    );
    return result.rows;
  }

  static async findAllApproved() {
    const result = await pool.query(
      "SELECT * FROM firms WHERE approval_status = 'APPROVED' ORDER BY created_at DESC"
    );
    return result.rows;
  }
}

module.exports = Firm;

