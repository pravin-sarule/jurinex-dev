const pool = require('../config/db');

const ChunkVector = {
  async saveChunkVector(chunkId, embedding, fileId) {
    if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
      throw new Error(`Invalid embedding for chunk ${chunkId}`);
    }
    
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(String(chunkId))) {
      throw new Error(`Invalid chunkId format: ${chunkId}`);
    }
    
    const embeddingPgVector = `[${embedding.join(',')}]`;
    
    try {
      const res = await pool.query(`
        INSERT INTO agent_chunk_vectors (chunk_id, embedding, file_id)
        VALUES ($1::uuid, $2::vector, $3::uuid)
        ON CONFLICT (chunk_id) DO UPDATE
          SET embedding = EXCLUDED.embedding,
              file_id = EXCLUDED.file_id,
              updated_at = NOW()
        RETURNING id, chunk_id
      `, [chunkId, embeddingPgVector, fileId]);
      
      return res.rows[0].id;
    } catch (insertError) {
      console.error(`[ChunkVector.saveChunkVector] Error:`, insertError.message);
      throw insertError;
    }
  },

  async saveMultipleChunkVectors(vectorsData) {
    if (!vectorsData || vectorsData.length === 0) {
      console.warn('[ChunkVector] saveMultipleChunkVectors: No vectors to save');
      return [];
    }

    console.log(`[ChunkVector] Validating ${vectorsData.length} vectors before save...`);
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    for (let i = 0; i < vectorsData.length; i++) {
      const vector = vectorsData[i];
      if (!vector.chunk_id || !uuidRegex.test(String(vector.chunk_id))) {
        throw new Error(`Vector ${i}: Invalid chunk_id format: ${vector.chunk_id}`);
      }
      if (!vector.file_id || !uuidRegex.test(String(vector.file_id))) {
        throw new Error(`Vector ${i}: Invalid file_id format: ${vector.file_id}`);
      }
      if (!vector.embedding || !Array.isArray(vector.embedding) || vector.embedding.length === 0) {
        throw new Error(`Vector ${i}: Invalid embedding`);
      }
    }
    console.log(`[ChunkVector] ✅ All ${vectorsData.length} vectors validated successfully`);

    const values = [];
    const placeholders = [];
    let paramIndex = 1;

    for (let i = 0; i < vectorsData.length; i++) {
      const vector = vectorsData[i];
      
      placeholders.push(`($${paramIndex}::uuid, $${paramIndex + 1}::vector, $${paramIndex + 2}::uuid)`);
      values.push(
        vector.chunk_id,
        `[${vector.embedding.join(',')}]`,
        vector.file_id
      );
      paramIndex += 3;
    }

    const query = `
      INSERT INTO agent_chunk_vectors (chunk_id, embedding, file_id)
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (chunk_id) DO UPDATE
        SET embedding = EXCLUDED.embedding,
            file_id = EXCLUDED.file_id,
            updated_at = NOW()
      RETURNING id, chunk_id;
    `;

    try {
      const res = await pool.query(query, values);
      console.log(`[ChunkVector] ✅ Saved ${res.rows.length} vectors to database`);
      return res.rows;
    } catch (error) {
      console.error(`[ChunkVector] ❌ Error saving vectors:`, error.message);
      throw error;
    }
  },

  async findNearestChunks(embedding, limit = 10, fileIds = null) {
    if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('Invalid embedding for vector search');
    }
    
    const embeddingPgVector = `[${embedding.join(',')}]`;
    
    let query = `
      SELECT
        cv.chunk_id,
        cv.embedding,
        fc.content,
        fc.file_id,
        fc.page_start,
        fc.page_end,
        fc.heading,
        (cv.embedding <=> $1::vector) AS distance,
        (1 / (1 + (cv.embedding <=> $1::vector))) AS similarity
      FROM agent_chunk_vectors cv
      INNER JOIN agent_file_chunks fc ON cv.chunk_id = fc.id
    `;

    const params = [embeddingPgVector];

    if (fileIds && fileIds.length > 0) {
      if (!Array.isArray(fileIds)) fileIds = [fileIds];
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const validFileIds = fileIds.filter(id => id && uuidRegex.test(String(id)));
      if (validFileIds.length > 0) {
        query += ` WHERE fc.file_id = ANY($${params.length + 1}::uuid[])`;
        params.push(validFileIds);
      }
    }

    query += `
      ORDER BY distance ASC
      LIMIT $${params.length + 1}
    `;
    params.push(limit);

    try {
      console.log(`[ChunkVector] Searching for nearest chunks (limit: ${limit}, fileIds: ${fileIds ? fileIds.length : 'all'})`);
      const res = await pool.query(query, params);
      console.log(`[ChunkVector] Found ${res.rows.length} nearest chunks`);
      
      return res.rows;
    } catch (error) {
      console.error(`[ChunkVector] Error in vector search:`, error.message);
      throw error;
    }
  },

  async findNearestChunksAcrossFiles(embedding, limit = 10) {
    return this.findNearestChunks(embedding, limit, null);
  },

  async deleteVectorsByFileId(fileId) {
    const res = await pool.query(`
      DELETE FROM agent_chunk_vectors
      WHERE file_id = $1::uuid
      RETURNING id
    `, [fileId]);
    return res.rows.length;
  }
};

module.exports = ChunkVector;
