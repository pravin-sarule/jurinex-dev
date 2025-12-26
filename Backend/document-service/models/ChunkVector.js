//     if (!vectorsData || vectorsData.length === 0) return [];






//     if (!Array.isArray(chunkIds)) chunkIds = [chunkIds]; // Ensure array



//       if (!Array.isArray(fileIds)) fileIds = [fileIds];







const pool = require('../config/db');

const ChunkVector = {
  async saveChunkVector(chunkId, embedding, fileId) {
    if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
      throw new Error(`Invalid embedding for chunk ${chunkId}`);
    }
    
    // Generate ID in application code to avoid schema dependency
    let vectorId;
    try {
      const maxIdResult = await pool.query('SELECT COALESCE(MAX(id), 0) as max_id FROM chunk_vectors');
      vectorId = (maxIdResult.rows[0]?.max_id || 0) + 1;
    } catch (maxIdError) {
      // Try to use sequence if it exists
      try {
        const seqResult = await pool.query("SELECT nextval('chunk_vectors_id_seq') as next_id");
        vectorId = seqResult.rows[0]?.next_id || 1;
      } catch (seqError) {
        // Fallback: start from 1
        vectorId = 1;
      }
    }
    
    const embeddingPgVector = `[${embedding.join(',')}]`;
    
    try {
      const res = await pool.query(`
        INSERT INTO chunk_vectors (id, chunk_id, embedding, file_id)
        VALUES ($1, $2, $3::vector, $4::uuid)
        ON CONFLICT (chunk_id) DO UPDATE
          SET embedding = EXCLUDED.embedding,
              file_id = EXCLUDED.file_id,
              updated_at = NOW()
        RETURNING id, chunk_id
      `, [vectorId, chunkId, embeddingPgVector, fileId]);
      
      return res.rows[0].id;
    } catch (insertError) {
      // If there's a unique constraint violation (duplicate ID), retry with a higher ID
      if (insertError.code === '23505' || (insertError.code === '23502' && insertError.column === 'id')) {
        const maxIdResult = await pool.query('SELECT COALESCE(MAX(id), 0) as max_id FROM chunk_vectors');
        const newVectorId = (maxIdResult.rows[0]?.max_id || 0) + 1;
        
        const retryRes = await pool.query(`
          INSERT INTO chunk_vectors (id, chunk_id, embedding, file_id)
          VALUES ($1, $2, $3::vector, $4::uuid)
          ON CONFLICT (chunk_id) DO UPDATE
            SET embedding = EXCLUDED.embedding,
                file_id = EXCLUDED.file_id,
                updated_at = NOW()
          RETURNING id, chunk_id
        `, [newVectorId, chunkId, embeddingPgVector, fileId]);
        
        return retryRes.rows[0].id;
      }
      throw insertError;
    }
  },

  async saveMultipleChunkVectors(vectorsData) {
    if (!vectorsData || vectorsData.length === 0) {
      console.warn('[ChunkVector] saveMultipleChunkVectors: No vectors to save');
      return [];
    }

    console.log(`[ChunkVector] Validating ${vectorsData.length} vectors before save...`);
    for (let i = 0; i < vectorsData.length; i++) {
      const vector = vectorsData[i];
      if (!vector.chunk_id) {
        throw new Error(`Vector ${i}: Missing chunk_id`);
      }
      if (!vector.file_id) {
        throw new Error(`Vector ${i}: Missing file_id`);
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

    // Generate IDs in application code to avoid schema dependency
    let startId = 1;
    try {
      const maxIdResult = await pool.query('SELECT COALESCE(MAX(id), 0) as max_id FROM chunk_vectors');
      startId = (maxIdResult.rows[0]?.max_id || 0) + 1;
    } catch (maxIdError) {
      console.warn('⚠️ [ChunkVector.saveMultipleChunkVectors] Could not get max ID, starting from 1:', maxIdError.message);
      // If we can't get max ID, try to use sequence if it exists
      try {
        const seqResult = await pool.query("SELECT nextval('chunk_vectors_id_seq') as next_id");
        startId = seqResult.rows[0]?.next_id || 1;
        // Reset sequence to start from the correct value for remaining vectors
        if (vectorsData.length > 1) {
          await pool.query(`SELECT setval('chunk_vectors_id_seq', $1, false)`, [startId + vectorsData.length - 1]);
        }
      } catch (seqError) {
        // Sequence doesn't exist, continue with max_id approach
        console.warn('⚠️ [ChunkVector.saveMultipleChunkVectors] Sequence not found, using max_id approach');
      }
    }

    const values = [];
    const placeholders = [];
    let paramIndex = 1;

    // Generate IDs for each vector
    for (let i = 0; i < vectorsData.length; i++) {
      const vector = vectorsData[i];
      const vectorId = startId + i;
      
      placeholders.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}::vector, $${paramIndex + 3}::uuid)`);
      values.push(
        vectorId, // Explicitly provide the id
        vector.chunk_id,
        `[${vector.embedding.join(',')}]`,
        vector.file_id
      );
      paramIndex += 4;
    }

    const query = `
      INSERT INTO chunk_vectors (id, chunk_id, embedding, file_id)
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
      // If there's a unique constraint violation (duplicate ID), retry with a higher start ID
      if (error.code === '23505' || (error.code === '23502' && error.column === 'id')) {
        console.warn('⚠️ [ChunkVector.saveMultipleChunkVectors] ID conflict detected, retrying with higher start ID');
        // Get the actual max ID again (in case another process inserted)
        const maxIdResult = await pool.query('SELECT COALESCE(MAX(id), 0) as max_id FROM chunk_vectors');
        const newStartId = (maxIdResult.rows[0]?.max_id || 0) + 1;
        
        // Regenerate placeholders and values with new start ID
        const retryValues = [];
        const retryPlaceholders = [];
        let retryParamIndex = 1;
        
        for (let i = 0; i < vectorsData.length; i++) {
          const vector = vectorsData[i];
          const vectorId = newStartId + i;
          
          retryPlaceholders.push(`($${retryParamIndex}, $${retryParamIndex + 1}, $${retryParamIndex + 2}::vector, $${retryParamIndex + 3}::uuid)`);
          retryValues.push(
            vectorId,
            vector.chunk_id,
            `[${vector.embedding.join(',')}]`,
            vector.file_id
          );
          retryParamIndex += 4;
        }
        
        const retryQuery = `
          INSERT INTO chunk_vectors (id, chunk_id, embedding, file_id)
          VALUES ${retryPlaceholders.join(', ')}
          ON CONFLICT (chunk_id) DO UPDATE
            SET embedding = EXCLUDED.embedding,
                file_id = EXCLUDED.file_id,
                updated_at = NOW()
          RETURNING id, chunk_id;
        `;
        
        const retryRes = await pool.query(retryQuery, retryValues);
        console.log(`[ChunkVector] ✅ Saved ${retryRes.rows.length} vectors to database (after retry)`);
        return retryRes.rows;
      }
      
      console.error(`[ChunkVector] ❌ Error saving vectors:`, error.message);
      console.error(`[ChunkVector] Query:`, query);
      console.error(`[ChunkVector] Values (first 4):`, values.slice(0, 12));
      throw error;
    }
  },

  async getExistingChunkIds(chunkIds) {
    const ids = Array.isArray(chunkIds) ? chunkIds : [chunkIds];
    if (ids.length === 0) return [];
    
    const { rows } = await pool.query(
      `
        SELECT chunk_id
        FROM chunk_vectors
        WHERE chunk_id = ANY($1::int[])
      `,
      [ids]
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
    
    try {
      const res = await pool.query(`
        SELECT id, chunk_id, embedding, file_id, created_at
        FROM chunk_vectors
        WHERE chunk_id = ANY($1::int[])
      `, [chunkIds]);
      
      console.log(`[ChunkVector] Found ${res.rows.length} vectors for ${chunkIds.length} chunk IDs`);
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

    const params = [embeddingPgVector, limit];

    if (fileIds && fileIds.length > 0) {
      if (!Array.isArray(fileIds)) fileIds = [fileIds];
      query += ` WHERE fc.file_id = ANY($3::uuid[])`;
      params.push(fileIds);
    }

    query += `
      ORDER BY distance ASC
      LIMIT $2
    `;

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