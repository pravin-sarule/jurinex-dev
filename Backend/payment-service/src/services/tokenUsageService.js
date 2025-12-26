const db = require('../config/db');

class TokenUsageService {
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

    static async commitTokens(userId, tokensUsed, actionDescription = 'Operation completed') {
        const client = await db.connect();
        try {
            await client.query('BEGIN');

            const currentBalance = await TokenUsageService.getCurrentTokenBalance(userId);
            const newRemainingTokens = currentBalance - tokensUsed;

            if (newRemainingTokens < 0) {
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

    static async resetUserUsage(userId, newBalance, actionDescription = 'Subscription token reset') {
        const client = await db.connect();
        try {
            await client.query('BEGIN');

            await client.query(
                `INSERT INTO token_usage_logs (user_id, tokens_used, action_description, remaining_tokens, used_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
                [userId, newBalance - await TokenUsageService.getCurrentTokenBalance(userId), actionDescription, newBalance]
            );

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

    static async getRemainingTokens(userId) {
        try {
            const remaining = await TokenUsageService.getCurrentTokenBalance(userId);
            return remaining;
        } catch (error) {
            console.error(`❌ Error getting remaining tokens for user ${userId}:`, error);
            return null;
        }
    }
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