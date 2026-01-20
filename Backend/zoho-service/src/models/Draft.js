/**
 * Draft Model
 * Interacts with drafts table in draft_db
 */
const pool = require('../config/database');
const { logTiming } = require('../utils/logger');

/**
 * Create or update draft record (upsert)
 */
const upsert = async ({ userId, title, zohoDocId, gcsPath, status = 'synced' }, requestId) => {
    const startTime = Date.now();

    try {
        // Check if draft exists
        const existing = await pool.query(
            'SELECT id FROM drafts WHERE user_id = $1 AND google_file_id = $2',
            [userId, zohoDocId]
        );

        let result;

        if (existing.rows.length > 0) {
            // Update existing
            result = await pool.query(
                `UPDATE drafts 
         SET title = $1, gcs_path = $2, status = $3, last_synced_at = NOW()
         WHERE id = $4
         RETURNING *`,
                [title, gcsPath, status, existing.rows[0].id]
            );
        } else {
            // Insert new
            result = await pool.query(
                `INSERT INTO drafts (user_id, title, google_file_id, gcs_path, status, last_synced_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING *`,
                [userId, title, zohoDocId, gcsPath, status]
            );
        }

        const duration = Date.now() - startTime;
        logTiming(requestId, 'DB Upsert Draft', duration, true);

        return result.rows[0];
    } catch (error) {
        const duration = Date.now() - startTime;
        logTiming(requestId, 'DB Upsert Draft', duration, false);
        throw error;
    }
};

/**
 * Find draft by ID
 */
const findById = async (id, requestId) => {
    const startTime = Date.now();

    try {
        const result = await pool.query(
            'SELECT * FROM drafts WHERE id = $1',
            [id]
        );

        const duration = Date.now() - startTime;
        logTiming(requestId, 'DB Find Draft', duration, true);

        return result.rows[0] || null;
    } catch (error) {
        const duration = Date.now() - startTime;
        logTiming(requestId, 'DB Find Draft', duration, false);
        throw error;
    }
};

/**
 * Find draft by Zoho document ID and user
 */
const findByZohoDocIdAndUser = async (zohoDocId, userId, requestId) => {
    const startTime = Date.now();

    try {
        const result = await pool.query(
            'SELECT * FROM drafts WHERE google_file_id = $1 AND user_id = $2',
            [zohoDocId, userId]
        );

        const duration = Date.now() - startTime;
        logTiming(requestId, 'DB Find Draft By Zoho ID', duration, true);

        return result.rows[0] || null;
    } catch (error) {
        const duration = Date.now() - startTime;
        logTiming(requestId, 'DB Find Draft By Zoho ID', duration, false);
        throw error;
    }
};

/**
 * List drafts by user
 */
const findByUser = async (userId, requestId) => {
    const startTime = Date.now();

    try {
        const result = await pool.query(
            'SELECT * FROM drafts WHERE user_id = $1 ORDER BY last_synced_at DESC',
            [userId]
        );

        const duration = Date.now() - startTime;
        logTiming(requestId, 'DB List Drafts', duration, true);

        return result.rows;
    } catch (error) {
        const duration = Date.now() - startTime;
        logTiming(requestId, 'DB List Drafts', duration, false);
        throw error;
    }
};

module.exports = {
    upsert,
    findById,
    findByZohoDocIdAndUser,
    findByUser
};
