const pool = require('../config/db');

const InputTemplate = {
  /**
   * Get input template by ID
   * @param {string} templateId - UUID of the input template
   * @returns {Promise<Object|null>} Input template object or null if not found
   */
  async getById(templateId) {
    try {
      const query = `
        SELECT 
          id,
          prompt,
          created_by,
          created_at,
          updated_at
        FROM input_templates
        WHERE id = $1;
      `;
      
      const { rows } = await pool.query(query, [templateId]);
      
      if (rows.length === 0) {
        console.warn(`[InputTemplate] Template not found: ${templateId}`);
        return null;
      }
      
      console.log(`[InputTemplate] ✅ Fetched template: ${templateId}`);
      return rows[0];
    } catch (error) {
      console.error(`[InputTemplate] ❌ Error fetching template:`, error.message);
      throw error;
    }
  },

  /**
   * Get all input templates
   * @param {string} userId - Optional user ID to filter by creator
   * @returns {Promise<Array>} Array of input templates
   */
  async getAll(userId = null) {
    try {
      let query = `
        SELECT 
          id,
          prompt,
          created_by,
          created_at,
          updated_at
        FROM input_templates
        ORDER BY created_at DESC;
      `;
      
      let params = [];
      if (userId) {
        query = `
          SELECT 
            id,
            prompt,
            created_by,
            created_at,
            updated_at
          FROM input_templates
          WHERE created_by = $1
          ORDER BY created_at DESC;
        `;
        params = [userId];
      }
      
      const { rows } = await pool.query(query, params);
      console.log(`[InputTemplate] ✅ Fetched ${rows.length} templates`);
      return rows;
    } catch (error) {
      console.error(`[InputTemplate] ❌ Error fetching templates:`, error.message);
      throw error;
    }
  },

  /**
   * Create a new input template
   * @param {string} prompt - The prompt text
   * @param {string} createdBy - UUID of the user creating the template
   * @returns {Promise<Object>} Created input template
   */
  async create(prompt, createdBy = null) {
    try {
      // Validate UUID format - if not a valid UUID, set to null
      let validCreatedBy = null;
      if (createdBy) {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidRegex.test(createdBy)) {
          validCreatedBy = createdBy;
        } else {
          console.warn(`[InputTemplate] Invalid UUID format for createdBy: ${createdBy}, setting to null`);
          validCreatedBy = null;
        }
      }
      
      const query = `
        INSERT INTO input_templates (prompt, created_by)
        VALUES ($1, $2)
        RETURNING *;
      `;
      
      const { rows } = await pool.query(query, [prompt, validCreatedBy]);
      console.log(`[InputTemplate] ✅ Created template: ${rows[0].id}`);
      return rows[0];
    } catch (error) {
      console.error(`[InputTemplate] ❌ Error creating template:`, error.message);
      throw error;
    }
  },

  /**
   * Update an input template
   * @param {string} templateId - UUID of the template to update
   * @param {string} prompt - Updated prompt text
   * @returns {Promise<Object>} Updated input template
   */
  async update(templateId, prompt) {
    try {
      const query = `
        UPDATE input_templates
        SET prompt = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *;
      `;
      
      const { rows } = await pool.query(query, [prompt, templateId]);
      
      if (rows.length === 0) {
        throw new Error(`Template not found: ${templateId}`);
      }
      
      console.log(`[InputTemplate] ✅ Updated template: ${templateId}`);
      return rows[0];
    } catch (error) {
      console.error(`[InputTemplate] ❌ Error updating template:`, error.message);
      throw error;
    }
  },

  /**
   * Delete an input template
   * @param {string} templateId - UUID of the template to delete
   * @returns {Promise<boolean>} True if deleted successfully
   */
  async delete(templateId) {
    try {
      const query = `
        DELETE FROM input_templates
        WHERE id = $1;
      `;
      
      const { rows } = await pool.query(query, [templateId]);
      console.log(`[InputTemplate] ✅ Deleted template: ${templateId}`);
      return true;
    } catch (error) {
      console.error(`[InputTemplate] ❌ Error deleting template:`, error.message);
      throw error;
    }
  }
};

module.exports = InputTemplate;

