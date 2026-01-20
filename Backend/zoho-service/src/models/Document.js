/**
 * Document Model
 * Interacts with documents table in draft_db
 */
const pool = require('../config/database');
const { logTiming } = require('../utils/logger');

/**
 * Create a new document record
 */
const create = async ({ userId, title, gcsPath, mimeType, status = 'uploaded' }, requestId) => {
    const startTime = Date.now();

    try {
        const result = await pool.query(
            `INSERT INTO documents (user_id, title, gcs_path, mime_type, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING *`,
            [userId, title, gcsPath, mimeType, status]
        );

        const duration = Date.now() - startTime;
        logTiming(requestId, 'DB Insert Document', duration, true);

        return result.rows[0];
    } catch (error) {
        const duration = Date.now() - startTime;
        logTiming(requestId, 'DB Insert Document', duration, false);
        throw error;
    }
};

/**
 * Find document by ID
 */
const findById = async (id, requestId) => {
    const startTime = Date.now();

    try {
        const result = await pool.query(
            'SELECT * FROM documents WHERE id = $1',
            [id]
        );

        const duration = Date.now() - startTime;
        logTiming(requestId, 'DB Find Document', duration, true);

        return result.rows[0] || null;
    } catch (error) {
        const duration = Date.now() - startTime;
        logTiming(requestId, 'DB Find Document', duration, false);
        throw error;
    }
};

/**
 * Find document by ID and user (for ownership check)
 */
const findByIdAndUser = async (id, userId, requestId) => {
    const startTime = Date.now();

    try {
        const result = await pool.query(
            'SELECT * FROM documents WHERE id = $1 AND user_id = $2',
            [id, userId]
        );

        const duration = Date.now() - startTime;
        logTiming(requestId, 'DB Find Document By User', duration, true);

        return result.rows[0] || null;
    } catch (error) {
        const duration = Date.now() - startTime;
        logTiming(requestId, 'DB Find Document By User', duration, false);
        throw error;
    }
};

/**
 * Update Zoho document ID
 */
const updateZohoDocId = async (id, zohoDocId, requestId) => {
    const startTime = Date.now();

    try {
        const result = await pool.query(
            `UPDATE documents 
       SET zoho_file_id = $1, status = 'zoho_created', updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
            [zohoDocId, id]
        );

        const duration = Date.now() - startTime;
        logTiming(requestId, 'DB Update Zoho Doc ID', duration, true);

        return result.rows[0];
    } catch (error) {
        const duration = Date.now() - startTime;
        logTiming(requestId, 'DB Update Zoho Doc ID', duration, false);
        throw error;
    }
};

/**
 * Update sync status
 */
const updateSyncStatus = async (id, requestId) => {
    const startTime = Date.now();

    try {
        const result = await pool.query(
            `UPDATE documents 
       SET status = 'synced', last_synced_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
            [id]
        );

        const duration = Date.now() - startTime;
        logTiming(requestId, 'DB Update Sync Status', duration, true);

        return result.rows[0];
    } catch (error) {
        const duration = Date.now() - startTime;
        logTiming(requestId, 'DB Update Sync Status', duration, false);
        throw error;
    }
};

/**
 * Update document title
 */
const updateTitle = async (id, title, requestId) => {
    const startTime = Date.now();
    try {
        const result = await pool.query(
            `UPDATE documents 
             SET title = $1, updated_at = NOW()
             WHERE id = $2
             RETURNING *`,
            [title, id]
        );
        const duration = Date.now() - startTime;
        logTiming(requestId, 'DB Update Title', duration, true);
        return result.rows[0];
    } catch (error) {
        const duration = Date.now() - startTime;
        logTiming(requestId, 'DB Update Title', duration, false);
        throw error;
    }
};

/**
 * Soft delete document
 */
const softDelete = async (id, requestId) => {
    const startTime = Date.now();
    try {
        const result = await pool.query(
            `UPDATE documents 
             SET status = 'deleted', updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [id]
        );
        const duration = Date.now() - startTime;
        logTiming(requestId, 'DB Soft Delete', duration, true);
        return result.rows[0];
    } catch (error) {
        const duration = Date.now() - startTime;
        logTiming(requestId, 'DB Soft Delete', duration, false);
        throw error;
    }
};

/**
 * List documents by user (excluding deleted)
 */
const findByUser = async (userId, requestId) => {
    const startTime = Date.now();

    try {
        const result = await pool.query(
            "SELECT * FROM documents WHERE user_id = $1 AND status != 'deleted' ORDER BY created_at DESC",
            [userId]
        );

        const duration = Date.now() - startTime;
        logTiming(requestId, 'DB List Documents', duration, true);

        return result.rows;
    } catch (error) {
        const duration = Date.now() - startTime;
        logTiming(requestId, 'DB List Documents', duration, false);
        throw error;
    }
};

module.exports = {
    create,
    findById,
    findByIdAndUser,
    updateZohoDocId,
    updateSyncStatus,
    findByUser,
    updateTitle, // ✅ NEW
    softDelete   // ✅ NEW
};
