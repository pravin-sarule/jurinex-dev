const db = require('../config/db');

// Internal endpoint: assign the free plan to a newly registered user.
// Called by auth service after user creation. Safe to call multiple times
// (ON CONFLICT DO NOTHING ensures idempotency).
exports.assignFreePlan = async (req, res) => {
    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({ success: false, message: 'userId is required.' });
    }

    try {
        const endDate = new Date();
        endDate.setFullYear(endDate.getFullYear() + 10); // 10-year far-future expiry for free plan
        const endDateStr = endDate.toISOString().split('T')[0];

        // Preferred: the admin-managed FREE monthly plan (price = 0). This makes the
        // monthly_plans "free" row (e.g. "Free Trial", 300k tokens) authoritative, so
        // billing/limits show exactly what the admin configured.
        const monthlyFree = await db.query(
            `SELECT id, monthly_tokens FROM monthly_plans
             WHERE price = 0 AND is_active = true
             ORDER BY (monthly_tokens > 0) DESC, sort_order ASC, id ASC
             LIMIT 1`
        );

        if (monthlyFree.rows.length) {
            const mp = monthlyFree.rows[0];
            await db.query(
                `INSERT INTO user_subscriptions
                    (user_id, monthly_plan_id, status, current_token_balance, start_date, end_date,
                     activated_at, last_reset_date, created_at, updated_at)
                 VALUES ($1, $2, 'active', $3, CURRENT_DATE, $4, CURRENT_TIMESTAMP, CURRENT_DATE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                 ON CONFLICT (user_id) DO NOTHING`,
                [userId, mp.id, mp.monthly_tokens || 0, endDateStr]
            );
            return res.status(200).json({ success: true, message: 'Free monthly plan assigned.' });
        }

        // Legacy fallback: subscription_plans row named FREE_PLAN_NAME (older DBs
        // without a price-0 monthly plan).
        const freePlanName = process.env.FREE_PLAN_NAME || 'free';
        const planResult = await db.query(
            `SELECT id, token_limit FROM subscription_plans WHERE LOWER(name) = LOWER($1) AND (is_active IS NOT FALSE) LIMIT 1`,
            [freePlanName]
        );

        if (!planResult.rows.length) {
            console.warn(`[assignFreePlan] No free monthly plan (price=0) and no subscription_plans "${freePlanName}" for user ${userId}`);
            return res.status(200).json({ success: false, message: 'Free plan not found; skipped.' });
        }

        const plan = planResult.rows[0];
        await db.query(
            `INSERT INTO user_subscriptions
                (user_id, plan_id, status, current_token_balance, start_date, end_date,
                 activated_at, last_reset_date, created_at, updated_at)
             VALUES ($1, $2, 'active', $3, CURRENT_DATE, $4, CURRENT_TIMESTAMP, CURRENT_DATE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT (user_id) DO NOTHING`,
            [userId, plan.id, plan.token_limit || 0, endDateStr]
        );

        return res.status(200).json({ success: true, message: 'Free plan assigned (legacy).' });
    } catch (error) {
        console.error(`[assignFreePlan] Error for user ${userId}:`, error);
        return res.status(500).json({ success: false, message: 'Internal server error.', error: error.message });
    }
};

exports.getAllPlans = async (req, res) => {
    const { type, interval } = req.query;

    let queryText = `
        SELECT
               id, name, description, price, currency, "interval", type, features,
               document_limit, ai_analysis_limit, template_access, token_limit,
               carry_over_limit, storage_limit_gb, drafting_type, limits,
               razorpay_plan_id, is_active, created_at, updated_at,
               chat_token_limit, chat_messages_per_hour, chat_chats_per_day, chat_quota_per_minute,
               chat_max_document_pages, chat_max_document_size_mb,
               chat_max_file_upload_per_day, chat_max_upload_files,
               summarization_token_limit, sum_messages_per_hour, sum_chats_per_day, sum_quota_per_minute,
               sum_max_document_pages, sum_max_document_size_mb,
               sum_max_file_upload_per_day, sum_max_upload_files,
               sum_max_context_documents, sum_max_conversation_history
        FROM subscription_plans
        WHERE (is_active IS NOT FALSE)
    `;

    const conditions = [];
    const values = [];
    let paramIndex = 1;

    if (type) {
        if (['individual', 'business'].includes(type)) {
            conditions.push(`type = $${paramIndex++}`);
            values.push(type);
        } else {
            return res.status(400).json({ success: false, message: "Invalid 'type' parameter." });
        }
    }

    if (interval) {
        if (['month', 'year', 'quarter'].includes(interval)) {
            conditions.push(`"interval" = $${paramIndex++}`);
            values.push(interval);
        } else {
            return res.status(400).json({ success: false, message: "Invalid 'interval' parameter." });
        }
    }

    if (conditions.length > 0) {
        queryText += ' AND ' + conditions.join(' AND ');
    }

    queryText += ' ORDER BY type, "interval", price ASC;';

    try {
        let rows;
        try {
            const result = await db.query(queryText, values);
            rows = result.rows;
        } catch (columnError) {
            const msg = String(columnError.message || '');
            if (!msg.includes('does not exist') && !msg.includes('column')) {
                throw columnError;
            }
            console.warn('[Plans] Extended columns missing — falling back to SELECT *:', msg);
            let fallbackText = `SELECT * FROM subscription_plans WHERE (is_active IS NOT FALSE)`;
            if (conditions.length > 0) {
                fallbackText += ' AND ' + conditions.join(' AND ');
            }
            fallbackText += ' ORDER BY type, "interval", price ASC;';
            const fallback = await db.query(fallbackText, values);
            rows = fallback.rows;
        }

        return res.status(200).json({
            success: true,
            count: rows.length,
            data: rows
        });
    } catch (error) {
        console.error("Error fetching plans:", error);
        res.status(500).json({ success: false, message: "Server Error", error: error.message });
    }
};
