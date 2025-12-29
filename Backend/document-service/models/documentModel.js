const pool = require('../config/db');

const DocumentModel = {
  async saveFileMetadata(userId, originalname, gcs_path, folder_path, mimetype, size, status = 'uploaded') {
    const res = await pool.query(`
      INSERT INTO user_files (user_id, originalname, gcs_path, folder_path, mimetype, size, status, processing_progress, current_operation)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 0.00, 'Pending')
      RETURNING id
    `, [userId, originalname, gcs_path, folder_path, mimetype, size, status]);
    return res.rows[0].id;
  },

  async updateFileFullTextContent(fileId, fullTextContent) {
    await pool.query(`
      UPDATE user_files
      SET full_text_content = $1, updated_at = NOW()
      WHERE id = $2::uuid
    `, [fullTextContent, fileId]);
  },

  async updateFileStatus(fileId, status, progress = null) {
    let query = `UPDATE user_files SET status = $1, updated_at = NOW()`;
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
      UPDATE user_files 
      SET current_operation = $1, updated_at = NOW()
      WHERE id = $2::uuid
    `, [operation, fileId]);
  },

  async updateProgressWithOperation(fileId, status, progress, operation) {
    await pool.query(`
      UPDATE user_files 
      SET status = $1, 
          processing_progress = $2, 
          current_operation = $3, 
          updated_at = NOW()
      WHERE id = $4::uuid
    `, [status, progress, operation, fileId]);
  },

  async updateFileProcessedAt(fileId) {
    await pool.query(`
      UPDATE user_files
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
        UPDATE user_files
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
    console.log(`[DocumentModel.getFileById] Attempting to retrieve file with ID: ${fileId}`);
    const res = await pool.query(`SELECT * FROM user_files WHERE id = $1::uuid`, [fileId]);
    if (res.rows[0]) {
      console.log(`[DocumentModel.getFileById] Found file with ID: ${fileId}, status: ${res.rows[0].status}, progress: ${res.rows[0].processing_progress}%, operation: ${res.rows[0].current_operation}`);
    } else {
      console.warn(`[DocumentModel.getFileById] No file found with ID: ${fileId}`);
    }
    return res.rows[0];
  },

  async updateFileSummary(fileId, summary) {
    await pool.query(`
      UPDATE user_files
      SET summary = $1, updated_at = NOW()
      WHERE id = $2::uuid
    `, [summary, fileId]);
  },

  async saveEditedVersions(documentId, docxUrl, pdfUrl) {
    await pool.query(`
      UPDATE user_files
      SET edited_docx_path = $1, edited_pdf_path = $2
      WHERE id = $3::uuid
    `, [docxUrl, pdfUrl, documentId]);
  },

  async countDocumentsByUserId(userId) {
    const res = await pool.query(`
      SELECT COUNT(*) FROM user_files
      WHERE user_id = $1 AND is_folder = FALSE
    `, [userId]);
    return parseInt(res.rows[0].count, 10);
  },

  async getFileChunks(fileId) {
    const res = await pool.query(`
      SELECT id, chunk_index, content, token_count FROM file_chunks
      WHERE file_id = $1
      ORDER BY chunk_index ASC
    `, [fileId]);
    return res.rows;
  },

  async getChunkVectors(chunkIds) {
    // Filter and validate chunk IDs as UUIDs
    const idsArray = Array.isArray(chunkIds) ? chunkIds : [chunkIds];
    const validIds = idsArray.filter(id => {
      if (!id) return false;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      return uuidRegex.test(String(id));
    });
    
    if (validIds.length === 0) {
      return [];
    }
    
    const res = await pool.query(`
      SELECT id, chunk_id, embedding FROM chunk_vectors
      WHERE chunk_id = ANY($1::uuid[])
    `, [validIds]);
    return res.rows;
  },

  async getFilesByUserIdAndFolderPath(userId, folderPath) {
    const res = await pool.query(`
      SELECT * FROM user_files
      WHERE user_id = $1 AND folder_path = $2
      ORDER BY created_at DESC
    `, [userId, folderPath]);
    return res.rows;
  },

  async getFilesByUserId(userId) {
    const res = await pool.query(`
      SELECT * FROM user_files
      WHERE user_id = $1
      ORDER BY created_at DESC
    `, [userId]);
    return res.rows;
  },

  async getFilesWithStatus(userId) {
    const res = await pool.query(`
      SELECT 
        id,
        originalname as filename,
        status,
        processing_progress,
        current_operation,
        mimetype,
        size,
        created_at,
        updated_at,
        processed_at
      FROM user_files
      WHERE user_id = $1
      ORDER BY created_at DESC
    `, [userId]);
    return res.rows;
  },

  async getProcessingFiles(userId) {
    const res = await pool.query(`
      SELECT 
        id,
        originalname as filename,
        status,
        processing_progress,
        current_operation,
        updated_at
      FROM user_files
      WHERE user_id = $1 
        AND status IN ('processing', 'batch_processing', 'batch_queued')
      ORDER BY updated_at DESC
    `, [userId]);
    return res.rows;
  }
};

module.exports = DocumentModel;
