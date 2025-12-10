// const pool = require('../config/db');
// const { v4: uuidv4 } = require('uuid');

// class Session {
//   // Create a new session (on login)
//   static async create({ user_id, token }) {
//     try {
//       const session_id = uuidv4(); // Generate a UUID for the session ID
//       const result = await pool.query(
//         `INSERT INTO user_sessions (id, user_id, token)
//          VALUES ($1, $2, $3)
//          RETURNING *`,
//         [session_id, user_id, token]
//       );
//       return result.rows[0];
//     } catch (error) {
//       console.error('Error creating session:', error);
//       throw error;
//     }
//   }

//   // Set logout_time to CURRENT_TIMESTAMP (on logout)
//   static async logout(sessionId) {
//     try {
//       const result = await pool.query(
//         `UPDATE user_sessions
//          SET logout_time = CURRENT_TIMESTAMP
//          WHERE id = $1
//          RETURNING *`,
//         [sessionId]
//       );
//       return result.rows[0];
//     } catch (error) {
//       console.error('Error updating logout time:', error);
//       throw error;
//     }
//   }
// }

// module.exports = Session;

const pool = require('../config/db');

class Session {
  // Create a new session (on login)
  static async create({ user_id, token }) {
    try {
      const result = await pool.query(
        `INSERT INTO user_sessions (user_id, token)
         VALUES ($1, $2)
         RETURNING *`,
        [user_id, token]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error creating session:', error);
      throw error;
    }
  }

  // Set logout_time to CURRENT_TIMESTAMP (on logout)
  static async logout(sessionId) {
    try {
      const result = await pool.query(
        `UPDATE user_sessions
         SET logout_time = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
        [sessionId]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error updating logout time:', error);
      throw error;
    }
  }
}

module.exports = Session;
