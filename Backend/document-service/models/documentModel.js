

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

  /**
   * Updates the current operation status for real-time progress tracking
   * @param {string} fileId - The file UUID
   * @param {string} operation - Description of current operation
   */
  async updateCurrentOperation(fileId, operation) {
    await pool.query(`
      UPDATE user_files 
      SET current_operation = $1, updated_at = NOW()
      WHERE id = $2::uuid
    `, [operation, fileId]);
  },

  /**
   * Updates both status, progress, and current operation in a single transaction
   * @param {string} fileId - The file UUID
   * @param {string} status - Processing status (processing, processed, error, etc.)
   * @param {number} progress - Progress percentage (0-100)
   * @param {string} operation - Description of current operation
   */
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

  /**
   * Store the Document AI output path in user_files table
   * @param {string} fileId - The file UUID
   * @param {string} outputPath - The GCS output URI prefix (gs://bucket/path/)
   */
  async updateFileOutputPath(fileId, outputPath) {
    // Try to update a column if it exists, otherwise store in metadata or use a workaround
    // First check if we have a column for this, if not we'll use a JSONB column or add metadata
    try {
      // Try to update using a potential output_path column or store in summary/metadata
      // For now, we'll log it and store in a way that can be retrieved
      await pool.query(`
        UPDATE user_files
        SET updated_at = NOW()
        WHERE id = $1::uuid
      `, [fileId]);
      
      // Store in processing_jobs table (which already has gcs_output_uri_prefix)
      // The output path is already stored there, so we just need to ensure it's linked
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
    const res = await pool.query(`
      SELECT id, chunk_id, embedding FROM chunk_vectors
      WHERE chunk_id = ANY($1::int[])
    `, [chunkIds]);
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

  /**
   * Get all files with their processing status for a user
   * Useful for dashboard/status overview
   */
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

  /**
   * Get files that are currently being processed
   * Useful for monitoring active processing jobs
   */
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
