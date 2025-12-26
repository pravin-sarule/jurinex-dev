const pool = require('../config/db');
const { v4: uuidv4 } = require('uuid');

const PromptExtraction = {
  /**
   * Save extracted data from a prompt
   * @param {string} inputTemplateId - UUID of the input template used
   * @param {string} fileId - UUID of the file (optional)
   * @param {string} sessionId - UUID of the session
   * @param {string} userId - UUID of the user
   * @param {Object} extractedData - The extracted data as JSON object
   * @returns {Promise<Object>} Saved extraction record
   */
  async save(inputTemplateId, fileId, sessionId, userId, extractedData) {
    try {
      const query = `
        INSERT INTO prompt_extractions (
          input_template_id,
          file_id,
          session_id,
          user_id,
          extracted_data
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *;
      `;
      
      const { rows } = await pool.query(query, [
        inputTemplateId || null,
        fileId || null,
        sessionId,
        userId,
        JSON.stringify(extractedData)
      ]);
      
      console.log(`[PromptExtraction] ✅ Saved extraction: ${rows[0].id}`);
      return rows[0];
    } catch (error) {
      console.error(`[PromptExtraction] ❌ Error saving extraction:`, error.message);
      throw error;
    }
  },

  /**
   * Get the most recent extraction for a session
   * @param {string} sessionId - UUID of the session
   * @returns {Promise<Object|null>} Extraction record or null if not found
   */
  async getLatestBySession(sessionId) {
    try {
      const query = `
        SELECT *
        FROM prompt_extractions
        WHERE session_id = $1
        ORDER BY created_at DESC
        LIMIT 1;
      `;
      
      const { rows } = await pool.query(query, [sessionId]);
      
      if (rows.length === 0) {
        return null;
      }
      
      // Parse JSONB data
      const extraction = rows[0];
      if (extraction.extracted_data && typeof extraction.extracted_data === 'object') {
        extraction.extracted_data = extraction.extracted_data;
      }
      
      console.log(`[PromptExtraction] ✅ Fetched latest extraction for session: ${sessionId}`);
      return extraction;
    } catch (error) {
      console.error(`[PromptExtraction] ❌ Error fetching extraction:`, error.message);
      throw error;
    }
  },

  /**
   * Get extraction by ID
   * @param {string} extractionId - UUID of the extraction
   * @returns {Promise<Object|null>} Extraction record or null if not found
   */
  async getById(extractionId) {
    try {
      const query = `
        SELECT *
        FROM prompt_extractions
        WHERE id = $1;
      `;
      
      const { rows } = await pool.query(query, [extractionId]);
      
      if (rows.length === 0) {
        return null;
      }
      
      // Parse JSONB data
      const extraction = rows[0];
      if (extraction.extracted_data && typeof extraction.extracted_data === 'object') {
        extraction.extracted_data = extraction.extracted_data;
      }
      
      return extraction;
    } catch (error) {
      console.error(`[PromptExtraction] ❌ Error fetching extraction:`, error.message);
      throw error;
    }
  },

  /**
   * Get all extractions for a file
   * @param {string} fileId - UUID of the file
   * @returns {Promise<Array>} Array of extraction records
   */
  async getByFileId(fileId) {
    try {
      const query = `
        SELECT *
        FROM prompt_extractions
        WHERE file_id = $1
        ORDER BY created_at DESC;
      `;
      
      const { rows } = await pool.query(query, [fileId]);
      
      // Parse JSONB data for each row
      return rows.map(row => {
        if (row.extracted_data && typeof row.extracted_data === 'object') {
          row.extracted_data = row.extracted_data;
        }
        return row;
      });
    } catch (error) {
      console.error(`[PromptExtraction] ❌ Error fetching extractions:`, error.message);
      throw error;
    }
  }
};

module.exports = PromptExtraction;

