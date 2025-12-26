const pool = require('../config/db');
const { v4: uuidv4 } = require('uuid'); // Import uuid

class File {
  static async create({ user_id, originalname, gcs_path, folder_path, mimetype, size, is_folder = false, status = 'uploaded', processing_progress = 0.00 }) {
    const id = uuidv4(); // Generate a UUID for the new file/folder
    const result = await pool.query(
      `INSERT INTO user_files (id, user_id, originalname, gcs_path, folder_path, mimetype, size, is_folder, status, processing_progress, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()) RETURNING *`,
      [id, user_id, originalname, gcs_path, folder_path, mimetype, size, is_folder, status, processing_progress]
    );
    return result.rows[0];
  }

  static async findByUserId(user_id) {
    const result = await pool.query(
      'SELECT * FROM user_files WHERE user_id = $1 ORDER BY is_folder DESC, created_at DESC', 
      [user_id]
    );
    return result.rows;
  }

  static async findByUserIdAndFolderPath(user_id, folder_path) {
    let query, params;
    
    if (!folder_path || folder_path === '') {
      query = `
        SELECT * FROM user_files 
        WHERE user_id = $1 AND (folder_path IS NULL OR folder_path = '')
        ORDER BY is_folder DESC, originalname ASC
      `;
      params = [user_id];
    } else {
      query = `
        SELECT * FROM user_files 
        WHERE user_id = $1 AND folder_path = $2
        ORDER BY is_folder DESC, originalname ASC
      `;
      params = [user_id, folder_path];
    }
    
    const result = await pool.query(query, params);
    return result.rows;
  }

  static async getFileById(id) { // Renamed from findById
    const result = await pool.query('SELECT * FROM user_files WHERE id = $1::uuid', [id]); // Cast to UUID
    return result.rows[0];
  }

  static async updateSummary(fileId, summary) {
    await pool.query(`
      UPDATE user_files
      SET summary = $1, updated_at = NOW()
      WHERE id = $2::uuid
    `, [summary, fileId]);
  }

  static async findFolderByPath(user_id, folder_name, parent_path = '') {
    const folder_path = parent_path ? `${parent_path}/${folder_name}` : folder_name;
    
    const result = await pool.query(
      'SELECT * FROM user_files WHERE user_id = $1 AND originalname = $2 AND folder_path = $3 AND is_folder = true',
      [user_id, folder_name, parent_path]
    );
    return result.rows[0];
  }

  static async folderExists(user_id, folder_name, parent_path = '') {
    const folder = await this.findFolderByPath(user_id, folder_name, parent_path);
    return !!folder;
  }

  static async getFilesInFolderRecursive(user_id, folder_path) {
    const result = await pool.query(
      `SELECT * FROM user_files 
       WHERE user_id = $1 AND (folder_path = $2 OR folder_path LIKE $3)
       ORDER BY folder_path, is_folder DESC, originalname ASC`,
      [user_id, folder_path, `${folder_path}/%`]
    );
    return result.rows;
  }

  static async getFolderStats(user_id, folder_path) {
    const result = await pool.query(
      `SELECT 
         COUNT(*) as file_count,
         COALESCE(SUM(CASE WHEN is_folder = false THEN size ELSE 0 END), 0) as total_size,
         COUNT(CASE WHEN is_folder = true THEN 1 END) as subfolder_count,
         COUNT(CASE WHEN is_folder = false THEN 1 END) as document_count
       FROM user_files 
       WHERE user_id = $1 AND (folder_path = $2 OR folder_path LIKE $3)`,
      [user_id, folder_path, `${folder_path}/%`]
    );
    return {
      fileCount: parseInt(result.rows[0].file_count, 10),
      totalSize: parseInt(result.rows[0].total_size, 10),
      subfolderCount: parseInt(result.rows[0].subfolder_count, 10),
      documentCount: parseInt(result.rows[0].document_count, 10)
    };
  }

  static async delete(id) {
    const result = await pool.query('DELETE FROM user_files WHERE id = $1::uuid RETURNING *', [id]); // Cast to UUID
    return result.rows[0];
  }

  static async deleteFilesInFolder(user_id, folder_path) {
    const result = await pool.query(
      'DELETE FROM user_files WHERE user_id = $1 AND (folder_path = $2 OR folder_path LIKE $3) RETURNING *',
      [user_id, folder_path, `${folder_path}/%`]
    );
    return result.rows;
  }

  static async update(id, updates) {
    const fields = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
    
    const result = await pool.query(
      `UPDATE user_files SET ${setClause}, updated_at = NOW() WHERE id = $1::uuid RETURNING *`,
      [id, ...values]
    );
    return result.rows[0];
  }

  static async moveToFolder(id, new_folder_path) {
    const result = await pool.query(
      'UPDATE user_files SET folder_path = $2, updated_at = NOW() WHERE id = $1::uuid RETURNING *',
      [id, new_folder_path]
    );
    return result.rows[0];
  }

  static async getTotalStorageUsed(user_id) {
    const result = await pool.query(
      'SELECT COALESCE(SUM(size), 0) AS total_size FROM user_files WHERE user_id = $1 AND is_folder = false',
      [user_id]
    );
    return parseInt(result.rows[0].total_size, 10);
  }

  static async getFolderStorageUsed(user_id, folder_path) {
    const result = await pool.query(
      `SELECT COALESCE(SUM(size), 0) AS total_size 
       FROM user_files 
       WHERE user_id = $1 AND is_folder = false AND (folder_path = $2 OR folder_path LIKE $3)`,
      [user_id, folder_path, `${folder_path}/%`]
    );
    return parseInt(result.rows[0].total_size, 10);
  }

  static async searchFiles(user_id, searchTerm) {
    const result = await pool.query(
      `SELECT * FROM user_files 
       WHERE user_id = $1 AND originalname ILIKE $2
       ORDER BY is_folder DESC, originalname ASC`,
      [user_id, `%${searchTerm}%`]
    );
    return result.rows;
  }

  static async getRecentFiles(user_id, limit = 10) {
    const result = await pool.query(
      `SELECT * FROM user_files 
       WHERE user_id = $1 AND is_folder = false
       ORDER BY created_at DESC 
       LIMIT $2`,
      [user_id, limit]
    );
    return result.rows;
  }

  static async getFilesByType(user_id, mimetype_pattern) {
    const result = await pool.query(
      `SELECT * FROM user_files 
       WHERE user_id = $1 AND is_folder = false AND mimetype LIKE $2
       ORDER BY created_at DESC`,
      [user_id, mimetype_pattern]
    );
    return result.rows;
  }

  static async getFolderTree(user_id) {
    const result = await pool.query(
      `SELECT * FROM user_files 
       WHERE user_id = $1 
       ORDER BY folder_path NULLS FIRST, is_folder DESC, originalname ASC`,
      [user_id]
    );
    return result.rows;
  }

  static async rename(id, new_name) {
    const result = await pool.query(
      'UPDATE user_files SET originalname = $2, updated_at = NOW() WHERE id = $1::uuid RETURNING *',
      [id, new_name]
    );
    return result.rows[0];
  }

  static async findDuplicates(user_id, originalname, folder_path) {
    let query, params;
    
    if (!folder_path || folder_path === '') {
      query = `
        SELECT * FROM user_files 
        WHERE user_id = $1 AND originalname = $2 AND (folder_path IS NULL OR folder_path = '')
      `;
      params = [user_id, originalname];
    } else {
      query = `
        SELECT * FROM user_files 
        WHERE user_id = $1 AND originalname = $2 AND folder_path = $3
      `;
      params = [user_id, originalname, folder_path];
    }
    
    const result = await pool.query(query, params);
    return result.rows;
  }

  static async batchDelete(ids) {
    const uuidIds = ids.map(id => `${id}::uuid`);
    const result = await pool.query(
      `DELETE FROM user_files WHERE id = ANY(ARRAY[${uuidIds.join(', ')}]) RETURNING *`,
      [] // No direct parameters needed if casting in query
    );
    return result.rows;
  }

  static async getFileCountByFolder(user_id) {
    const result = await pool.query(
      `SELECT 
         COALESCE(folder_path, 'root') as folder_path,
         COUNT(CASE WHEN is_folder = false THEN 1 END) as file_count,
         COUNT(CASE WHEN is_folder = true THEN 1 END) as folder_count
       FROM user_files 
       WHERE user_id = $1
       GROUP BY folder_path
       ORDER BY folder_path`,
      [user_id]
    );
    return result.rows;
  }

  static async getFileWithMetadata(id) {
    const result = await pool.query(
      `SELECT *,
       EXTRACT(EPOCH FROM created_at) as created_timestamp,
       EXTRACT(EPOCH FROM updated_at) as updated_timestamp
       FROM user_files WHERE id = $1::uuid`, // Cast to UUID
      [id]
    );
    return result.rows[0];
  }

  static async updateProcessingStatus(id, status, progress, operation = null) {
    const result = await pool.query(
      `UPDATE user_files
       SET status = $2,
           processing_progress = $3,
           current_operation = $4,
           updated_at = NOW()
       WHERE id = $1::uuid
       RETURNING *`,
      [id, status, progress, operation]
    );
    return result.rows[0];
  }

  static async updateFileOutputPath(fileId, outputPath) {
    try {
      await pool.query(`
        UPDATE user_files
        SET gcs_output_path = $2,
            updated_at = NOW()
        WHERE id = $1::uuid
      `, [fileId, outputPath]);
      
      console.log(`[File.updateFileOutputPath] ✅ Updated output path for file ${fileId}: ${outputPath}`);
    } catch (error) {
      if (error.message.includes('column') && error.message.includes('does not exist')) {
        console.warn(`[File.updateFileOutputPath] ⚠️ gcs_output_path column doesn't exist, storing in processing_jobs table instead`);
        try {
          await pool.query(`
            UPDATE processing_jobs
            SET gcs_output_uri_prefix = $2,
                updated_at = NOW()
            WHERE file_id = $1::uuid
            ORDER BY created_at DESC
            LIMIT 1
          `, [fileId, outputPath]);
          console.log(`[File.updateFileOutputPath] ✅ Stored output path in processing_jobs table`);
        } catch (jobError) {
          console.error(`[File.updateFileOutputPath] ❌ Failed to store in processing_jobs:`, jobError.message);
        }
      } else {
        console.error(`[File.updateFileOutputPath] ❌ Failed to update output path:`, error.message);
        throw error;
      }
    }
  }
}

module.exports = File;
