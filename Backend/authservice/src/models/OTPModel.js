const pool = require('../config/db');

class OTP {
    static async createOTP(email, otp, expiresAt) {
        const query = `
            INSERT INTO otps (email, otp, expires_at)
            VALUES ($1, $2, $3)
            RETURNING *;
        `;
        const { rows } = await pool.query(query, [email, otp, expiresAt]);
        return rows[0];
    }

    static async findOTP(email, otp) {
        const query = `
            SELECT * FROM otps
            WHERE email = $1 AND otp = $2 AND expires_at > NOW();
        `;
        const { rows } = await pool.query(query, [email, otp]);
        return rows[0];
    }

    static async deleteOTP(email, otp) {
        const query = `
            DELETE FROM otps
            WHERE email = $1 AND otp = $2;
        `;
        await pool.query(query, [email, otp]);
    }
}

module.exports = OTP;