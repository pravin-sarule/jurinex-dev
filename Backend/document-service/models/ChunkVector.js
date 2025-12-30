const pool = require('../config/db');

const ChunkVector = {
  async saveChunkVector(chunkId, embedding, fileId) {
    if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
      throw new Error(`Invalid embedding for chunk ${chunkId}`);
    }
    
    // Validate chunkId is a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(String(chunkId))) {
      throw new Error(`Invalid chunkId format: ${chunkId}`);
    }
    
    const embeddingPgVector = `[${embedding.join(',')}]`;
    
    // Let PostgreSQL generate UUID for id via DEFAULT gen_random_uuid()
    try {
      const res = await pool.query(`
        INSERT INTO chunk_vectors (chunk_id, embedding, file_id)
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
      if (!vector.chunk_id) {
        throw new Error(`Vector ${i}: Missing chunk_id`);
      }
      if (!uuidRegex.test(String(vector.chunk_id))) {
        throw new Error(`Vector ${i}: Invalid chunk_id format: ${vector.chunk_id}`);
      }
      if (!vector.file_id) {
        throw new Error(`Vector ${i}: Missing file_id`);
      }
      if (!uuidRegex.test(String(vector.file_id))) {
        throw new Error(`Vector ${i}: Invalid file_id format: ${vector.file_id}`);
      }
      if (!vector.embedding || !Array.isArray(vector.embedding) || vector.embedding.length === 0) {
        throw new Error(`Vector ${i} (chunk_id: ${vector.chunk_id}): Invalid embedding - ${JSON.stringify(vector.embedding)}`);
      }
      for (let j = 0; j < vector.embedding.length; j++) {
        if (typeof vector.embedding[j] !== 'number' || isNaN(vector.embedding[j])) {
          throw new Error(`Vector ${i} (chunk_id: ${vector.chunk_id}): Invalid embedding value at index ${j}: ${vector.embedding[j]}`);
        }
      }
    }
    console.log(`[ChunkVector] ✅ All ${vectorsData.length} vectors validated successfully`);

    // Let PostgreSQL generate UUIDs automatically via DEFAULT gen_random_uuid()
    const values = [];
    const placeholders = [];
    let paramIndex = 1;

    // Generate placeholders for each vector (without id - let DB generate it)
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
      INSERT INTO chunk_vectors (chunk_id, embedding, file_id)
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
      console.error(`[ChunkVector] Query:`, query);
      console.error(`[ChunkVector] Values (first 3):`, values.slice(0, 9));
      throw error;
    }
  },

  async getExistingChunkIds(chunkIds) {
    const ids = Array.isArray(chunkIds) ? chunkIds : [chunkIds];
    if (ids.length === 0) return [];
    
    // Filter out any invalid UUIDs
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const validIds = ids.filter(id => {
      if (!id) return false;
      return uuidRegex.test(String(id));
    });
    
    if (validIds.length === 0) return [];
    
    const { rows } = await pool.query(
      `
        SELECT chunk_id
        FROM chunk_vectors
        WHERE chunk_id = ANY($1::uuid[])
      `,
      [validIds]
    );
    return rows.map((row) => row.chunk_id);
  },

  async getVectorsByChunkIds(chunkIds) {
    if (!chunkIds || chunkIds.length === 0) {
      console.warn('[ChunkVector] getVectorsByChunkIds: No chunk IDs provided');
      return [];
    }
    
    if (!Array.isArray(chunkIds)) {
      chunkIds = [chunkIds];
    }
    
    // Filter out any invalid UUIDs
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const validIds = chunkIds.filter(id => {
      if (!id) return false;
      return uuidRegex.test(String(id));
    });
    
    if (validIds.length === 0) {
      console.warn('[ChunkVector] getVectorsByChunkIds: No valid UUID chunk IDs provided');
      return [];
    }
    
    try {
      const res = await pool.query(`
        SELECT id, chunk_id, embedding, file_id, created_at
        FROM chunk_vectors
        WHERE chunk_id = ANY($1::uuid[])
      `, [validIds]);
      
      console.log(`[ChunkVector] Found ${res.rows.length} vectors for ${validIds.length} chunk IDs`);
      return res.rows;
    } catch (error) {
      console.error(`[ChunkVector] Error fetching vectors:`, error.message);
      throw error;
    }
  },

  async findNearestChunks(embedding, limit = 5, fileIds = null) {
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
      FROM chunk_vectors cv
      INNER JOIN file_chunks fc ON cv.chunk_id = fc.id
    `;

    const params = [embeddingPgVector];

    if (fileIds && fileIds.length > 0) {
      if (!Array.isArray(fileIds)) fileIds = [fileIds];
      // Validate UUIDs
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
      
      if (res.rows.length > 0) {
        console.log(`[ChunkVector] Distance range: ${res.rows[res.rows.length - 1].distance.toFixed(4)} - ${res.rows[0].distance.toFixed(4)}`);
        console.log(`[ChunkVector] Similarity range: ${res.rows[0].similarity.toFixed(4)} - ${res.rows[res.rows.length - 1].similarity.toFixed(4)}`);
      }
      
      return res.rows;
    } catch (error) {
      console.error(`[ChunkVector] Error in vector search:`, error.message);
      console.error(`[ChunkVector] Query:`, query);
      console.error(`[ChunkVector] Params:`, params);
      throw error;
    }
  },

  async findNearestChunksAcrossFiles(embedding, limit = 5, fileIds = null) {
    return this.findNearestChunks(embedding, limit, fileIds);
  },

  async getVectorsByFileId(fileId) {
    try {
      const res = await pool.query(`
        SELECT 
          cv.id,
          cv.chunk_id,
          cv.file_id,
          cv.created_at,
          fc.content,
          fc.chunk_index,
          fc.page_start,
          fc.page_end
        FROM chunk_vectors cv
        INNER JOIN file_chunks fc ON cv.chunk_id = fc.id
        WHERE cv.file_id = $1::uuid
        ORDER BY fc.chunk_index ASC
      `, [fileId]);
      
      console.log(`[ChunkVector] Found ${res.rows.length} vectors for file ${fileId}`);
      return res.rows;
    } catch (error) {
      console.error(`[ChunkVector] Error fetching vectors by file ID:`, error.message);
      throw error;
    }
  },

  async verifyEmbeddingsForFile(fileId) {
    try {
      const res = await pool.query(`
        SELECT 
          COUNT(fc.id) as total_chunks,
          COUNT(cv.id) as total_embeddings,
          (COUNT(cv.id)::float / NULLIF(COUNT(fc.id), 0) * 100) as coverage_percentage
        FROM file_chunks fc
        LEFT JOIN chunk_vectors cv ON cv.chunk_id = fc.id
        WHERE fc.file_id = $1::uuid
      `, [fileId]);
      
      const stats = res.rows[0];
      console.log(`[ChunkVector] Embedding coverage for file ${fileId}:`);
      console.log(`   - Total chunks: ${stats.total_chunks}`);
      console.log(`   - Total embeddings: ${stats.total_embeddings}`);
      console.log(`   - Coverage: ${parseFloat(stats.coverage_percentage || 0).toFixed(2)}%`);
      
      return {
        totalChunks: parseInt(stats.total_chunks),
        totalEmbeddings: parseInt(stats.total_embeddings),
        coveragePercentage: parseFloat(stats.coverage_percentage || 0),
        isComplete: parseInt(stats.total_chunks) === parseInt(stats.total_embeddings)
      };
    } catch (error) {
      console.error(`[ChunkVector] Error verifying embeddings:`, error.message);
      throw error;
    }
  }
};

module.exports = ChunkVector;
