const db = require('../config/db');

exports.getAllPlans = async (req, res) => {
    const { type, interval } = req.query;

    let queryText = `
        SELECT id, name, description, price, currency, "interval", type, features,
               document_limit, ai_analysis_limit, template_access, token_limit,
               carry_over_limit, limits, razorpay_plan_id, created_at, updated_at
        FROM subscription_plans
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
        queryText += ' WHERE ' + conditions.join(' AND ');
    }

    queryText += ' ORDER BY type, "interval", price ASC;';

    try {
        const { rows } = await db.query(queryText, values);

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
