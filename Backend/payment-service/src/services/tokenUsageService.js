const db = require('../config/db');

class TokenUsageService {
    /**
     * Retrieves the current remaining token balance for a user from the latest log entry.
     * @param {number} userId - The ID of the user.
     * @returns {Promise<number>} - The current remaining token balance, or 0 if no logs exist.
     */
    static async getCurrentTokenBalance(userId) {
        try {
            const result = await db.query(
                `SELECT remaining_tokens FROM token_usage_logs WHERE user_id = $1 ORDER BY used_at DESC LIMIT 1`,
                [userId]
            );
            return result.rows.length > 0 ? result.rows[0].remaining_tokens : 0;
        } catch (error) {
            console.error(`❌ Error getting current token balance for user ${userId}:`, error);
            return 0; // Default to 0 on error
        }
    }

    /**
     * Checks if a user has enough tokens for an operation.
     * @param {number} userId - The ID of the user.
     * @param {number} operationCost - The token cost of the impending operation.
     * @returns {Promise<boolean>} - True if tokens are sufficient, false otherwise.
     */
    static async checkAndReserveTokens(userId, operationCost) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');

            const currentBalance = await TokenUsageService.getCurrentTokenBalance(userId);
            console.log(`DEBUG: checkAndReserveTokens - User ${userId} - Current Balance: ${currentBalance}, Operation Cost: ${operationCost}`);

            if (currentBalance < operationCost) {
                await client.query('ROLLBACK');
                console.log(`DEBUG: checkAndReserveTokens - User ${userId} - Insufficient tokens. Current: ${currentBalance}, Cost: ${operationCost}`);
                return false; // Insufficient tokens
            }

            // No need to "reserve" by updating user_subscriptions.current_token_balance here.
            // The actual deduction and logging happens in commitTokens.
            // This function just checks availability.

            await client.query('COMMIT');
            return true;
        } catch (error) {
            await client.query('ROLLBACK');
            console.error(`❌ Error in checkAndReserveTokens for user ${userId}:`, error);
            return false;
        } finally {
            client.release();
        }
    }

    /**
     * Records token usage and updates the remaining balance in token_usage_logs.
     * @param {number} userId - The ID of the user.
     * @param {number} tokensUsed - The number of tokens consumed.
     * @param {string} actionDescription - Description of the action for logging.
     * @returns {Promise<boolean>} - True if committed successfully, false otherwise.
     */
    static async commitTokens(userId, tokensUsed, actionDescription = 'Operation completed') {
        const client = await db.connect();
        try {
            await client.query('BEGIN');

            const currentBalance = await TokenUsageService.getCurrentTokenBalance(userId);
            const newRemainingTokens = currentBalance - tokensUsed;

            if (newRemainingTokens < 0) {
                // This should ideally not happen if checkAndReserveTokens was called correctly
                console.error(`❌ Attempted to commit more tokens than available for user ${userId}. Current: ${currentBalance}, Used: ${tokensUsed}`);
                await client.query('ROLLBACK');
                return false;
            }

            await client.query(
                `INSERT INTO token_usage_logs (user_id, tokens_used, action_description, remaining_tokens, used_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
                [userId, tokensUsed, actionDescription, newRemainingTokens]
            );

            await client.query('COMMIT');
            console.log(`DEBUG: commitTokens - User ${userId} - Used ${tokensUsed} tokens. Remaining: ${newRemainingTokens}. Action: ${actionDescription}`);
            return true;
        } catch (error) {
            await client.query('ROLLBACK');
            console.error(`❌ Error committing tokens for user ${userId}:`, error);
            return false;
        } finally {
            client.release();
        }
    }

    /**
     * Rolls back token usage by adding tokens back to the balance and logging the event.
     * @param {number} userId - The ID of the user.
     * @param {number} tokensToRollback - The number of tokens to add back.
     * @param {string} actionDescription - Description of the rollback action.
     * @returns {Promise<boolean>} - True if rolled back successfully, false otherwise.
     */
    static async rollbackTokens(userId, tokensToRollback, actionDescription = 'Token rollback due to error') {
        const client = await db.connect();
        try {
            await client.query('BEGIN');

            const currentBalance = await TokenUsageService.getCurrentTokenBalance(userId);
            const newRemainingTokens = currentBalance + tokensToRollback;

            await client.query(
                `INSERT INTO token_usage_logs (user_id, tokens_used, action_description, remaining_tokens, used_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
                [userId, -tokensToRollback, actionDescription, newRemainingTokens] // Log tokens_used as negative for rollback
            );

            await client.query('COMMIT');
            console.log(`DEBUG: rollbackTokens - User ${userId} - Rolled back ${tokensToRollback} tokens. New Remaining: ${newRemainingTokens}. Action: ${actionDescription}`);
            return true;
        } catch (error) {
            await client.query('ROLLBACK');
            console.error(`❌ Error rolling back tokens for user ${userId}:`, error);
            return false;
        } finally {
            client.release();
        }
    }

    /**
     * Resets a user's token balance to a specified amount and logs the event.
     * This is used for subscription activation/renewal.
     * @param {number} userId - The ID of the user.
     * @param {number} newBalance - The new token balance to set.
     * @param {string} actionDescription - Description of the reset action.
     * @returns {Promise<boolean>} - True if reset successfully, false otherwise.
     */
    static async resetUserUsage(userId, newBalance, actionDescription = 'Subscription token reset') {
        const client = await db.connect();
        try {
            await client.query('BEGIN');

            await client.query(
                `INSERT INTO token_usage_logs (user_id, tokens_used, action_description, remaining_tokens, used_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
                [userId, newBalance - await TokenUsageService.getCurrentTokenBalance(userId), actionDescription, newBalance]
            );

            // Remove current_token_balance and last_reset_date from user_subscriptions
            // as token_usage_logs is now the authoritative source.
            await client.query(
                `UPDATE user_subscriptions SET last_reset_date = CURRENT_DATE WHERE user_id = $1`,
                [userId]
            );

            await client.query('COMMIT');
            console.log(`DEBUG: resetUserUsage - User ${userId} token usage reset to ${newBalance}. Action: ${actionDescription}`);
            return true;
        } catch (error) {
            await client.query('ROLLBACK');
            console.error(`❌ Error resetting user usage for user ${userId}:`, error);
            return false;
        } finally {
            client.release();
        }
    }

    /**
     * Retrieves a user's current token usage (remaining tokens).
     * @param {number} userId - The ID of the user.
     * @returns {Promise<number|null>} - The number of remaining tokens, or null if not found.
     */
    static async getRemainingTokens(userId) {
        try {
            const remaining = await TokenUsageService.getCurrentTokenBalance(userId);
            return remaining;
        } catch (error) {
            console.error(`❌ Error getting remaining tokens for user ${userId}:`, error);
            return null;
        }
    }
    /**
     * Retrieves the total tokens used by a user.
     * @param {number} userId - The ID of the user.
     * @returns {Promise<number>} - The total tokens used, or 0 if no logs exist.
     */
    static async getTotalTokensUsed(userId) {
        try {
            const result = await db.query(
                `SELECT SUM(tokens_used) AS total_used FROM token_usage_logs WHERE user_id = $1 AND tokens_used > 0`,
                [userId]
            );
            return result.rows.length > 0 && result.rows[0].total_used !== null ? parseInt(result.rows[0].total_used, 10) : 0;
        } catch (error) {
            console.error(`❌ Error getting total tokens used for user ${userId}:`, error);
            return 0; // Default to 0 on error
        }
    }
}

module.exports = TokenUsageService;