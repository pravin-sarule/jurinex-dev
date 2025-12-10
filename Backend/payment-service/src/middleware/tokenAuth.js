
const db = require('../config/db');

/**
 * @desc Middleware to check and deduct tokens from a user
 * @param {number} tokensRequired
 */
const checkTokenUsage = async (req, res, next) => {
  const userId = req.user?.id || req.userId;
  const { tokensRequired } = req.body; // Get tokensRequired from request body

  if (!userId) {
    console.error("❌ checkTokenUsage: No user ID found in request");
    return res.status(401).json({ success: false, message: 'Unauthorized: User ID not found.' });
  }

  if (typeof tokensRequired === 'undefined' || tokensRequired <= 0) {
    console.error("❌ checkTokenUsage: Invalid or missing tokensRequired in request body");
    return res.status(400).json({ success: false, message: 'Bad Request: tokensRequired is missing or invalid.' });
  }

  try {
    // Fetch user's subscription
    const result = await db.query(`
      SELECT current_token_balance, status 
      FROM user_subscriptions 
      WHERE user_id = $1
    `, [userId]);

    const userSub = result.rows[0];

    if (!userSub || userSub.status !== 'active') {
      return res.status(403).json({ success: false, message: 'No active subscription found.' });
    }

    if (userSub.current_token_balance >= tokensRequired) {
      const newBalance = userSub.current_token_balance - tokensRequired;

      // Update token balance
      await db.query(`
        UPDATE user_subscriptions
        SET current_token_balance = $1, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $2
      `, [newBalance, userId]);

      // Log token usage
      await db.query(`
        INSERT INTO token_usage_logs (user_id, tokens_used, action_description)
        VALUES ($1, $2, $3)
      `, [userId, tokensRequired, req.originalUrl]);

      req.user.current_token_balance = newBalance;
      next();
    } else {
      return res.status(403).json({ success: false, message: 'Insufficient tokens.' });
    }
  } catch (err) {
    console.error("❌ Error in checkTokenUsage middleware:", err.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = {
  checkTokenUsage
};
