const pool = require('../config/db');

const DocumentModel = {
  async saveFileMetadata(originalname, gcs_path, folder_path, mimetype, size, status = 'uploaded') {
    const res = await pool.query(`
      INSERT INTO agent_documents (originalname, gcs_path, folder_path, mimetype, size, status, processing_progress, current_operation)
      VALUES ($1, $2, $3, $4, $5, $6, 0.00, 'Pending')
      RETURNING id
    `, [originalname, gcs_path, folder_path, mimetype, size, status]);
    return res.rows[0].id;
  },

  async updateFileStatus(fileId, status, progress = null) {
    let query = `UPDATE agent_documents SET status = $1, updated_at = NOW()`;
    const params = [status];
    
    if (progress !== null) {
      query += `, processing_progress = $2`;
      params.push(progress);
    }
    
    query += ` WHERE id = $${params.length + 1}::uuid`;
    params.push(fileId);
    
    await pool.query(query, params);
  },

  async updateCurrentOperation(fileId, operation) {
    await pool.query(`
      UPDATE agent_documents 
      SET current_operation = $1, updated_at = NOW()
      WHERE id = $2::uuid
    `, [operation, fileId]);
  },

  async updateProgressWithOperation(fileId, status, progress, operation) {
    await pool.query(`
      UPDATE agent_documents 
      SET status = $1, 
          processing_progress = $2, 
          current_operation = $3, 
          updated_at = NOW()
      WHERE id = $4::uuid
    `, [status, progress, operation, fileId]);
  },

  async updateFileProcessedAt(fileId) {
    await pool.query(`
      UPDATE agent_documents
      SET processed_at = NOW(), 
          status = 'processed', 
          processing_progress = 100.00,
          current_operation = 'Completed'
      WHERE id = $1::uuid
    `, [fileId]);
  },

  async updateFileOutputPath(fileId, outputPath) {
    try {
      await pool.query(`
        UPDATE agent_documents
        SET updated_at = NOW()
        WHERE id = $1::uuid
      `, [fileId]);
      
      console.log(`[DocumentModel] Output path for file ${fileId}: ${outputPath}`);
    } catch (error) {
      console.error(`[DocumentModel] Failed to update output path:`, error.message);
      throw error;
    }
  },

  async getFileById(fileId) {
    const res = await pool.query(`SELECT * FROM agent_documents WHERE id = $1::uuid`, [fileId]);
    return res.rows[0];
  },

  async updateFileSummary(fileId, summary) {
    await pool.query(`
      UPDATE agent_documents
      SET summary = $1, updated_at = NOW()
      WHERE id = $2::uuid
    `, [summary, fileId]);
  },

  async getAllProcessedFiles() {
    const res = await pool.query(`
      SELECT id, originalname, status, processing_progress, mimetype, size, created_at, processed_at
      FROM agent_documents
      WHERE status = 'processed'
      ORDER BY created_at DESC
    `);
    return res.rows;
  },

  async getAllFiles() {
    const res = await pool.query(`
      SELECT id, originalname, status, processing_progress, current_operation, mimetype, size, created_at, updated_at, processed_at, summary
      FROM agent_documents
      ORDER BY created_at DESC
    `);
    return res.rows;
  },

  async getFilesByIds(fileIds) {
    if (!Array.isArray(fileIds) || fileIds.length === 0) return [];
    
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const validIds = fileIds.filter(id => id && uuidRegex.test(String(id)));
    
    if (validIds.length === 0) return [];
    
    const res = await pool.query(`
      SELECT id, originalname, status, processing_progress, mimetype, size, created_at, processed_at
      FROM agent_documents
      WHERE id = ANY($1::uuid[]) AND status = 'processed'
      ORDER BY created_at DESC
    `, [validIds]);
    return res.rows;
  },

  async deleteDocument(fileId) {
    const res = await pool.query(`
      DELETE FROM agent_documents
      WHERE id = $1::uuid
      RETURNING id, originalname, gcs_path, folder_path
    `, [fileId]);
    return res.rows[0];
  }
};

module.exports = DocumentModel;
