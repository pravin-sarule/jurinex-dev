const pool = require('../config/db');

const FileChunk = {
  async saveChunk(fileId, chunkIndex, content, tokenCount, pageStart = null, pageEnd = null, heading = null) {
    // Generate ID in application code to avoid schema dependency
    let chunkId;
    try {
      const maxIdResult = await pool.query('SELECT COALESCE(MAX(id), 0) as max_id FROM file_chunks');
      chunkId = (maxIdResult.rows[0]?.max_id || 0) + 1;
    } catch (maxIdError) {
      // Try to use sequence if it exists
      try {
        const seqResult = await pool.query("SELECT nextval('file_chunks_id_seq') as next_id");
        chunkId = seqResult.rows[0]?.next_id || 1;
      } catch (seqError) {
        // Fallback: start from 1
        chunkId = 1;
      }
    }

    try {
      const res = await pool.query(
        `
        INSERT INTO file_chunks
          (id, file_id, chunk_index, content, token_count, page_start, page_end, heading)
        VALUES ($1, $2::uuid, $3, $4, $5, $6, $7)
        RETURNING id
        `,
        [chunkId, fileId, chunkIndex, content, tokenCount, pageStart, pageEnd, heading]
      );
      return res.rows[0].id;
    } catch (insertError) {
      // If there's a unique constraint violation (duplicate ID), retry with a higher ID
      if (insertError.code === '23505' || (insertError.code === '23502' && insertError.column === 'id')) {
        const maxIdResult = await pool.query('SELECT COALESCE(MAX(id), 0) as max_id FROM file_chunks');
        const newChunkId = (maxIdResult.rows[0]?.max_id || 0) + 1;
        
        const retryRes = await pool.query(
          `
          INSERT INTO file_chunks
            (id, file_id, chunk_index, content, token_count, page_start, page_end, heading)
          VALUES ($1, $2::uuid, $3, $4, $5, $6, $7)
          RETURNING id
          `,
          [newChunkId, fileId, chunkIndex, content, tokenCount, pageStart, pageEnd, heading]
        );
        return retryRes.rows[0].id;
      }
      throw insertError;
    }
  },

  async saveMultipleChunks(chunksData) {
    if (!chunksData || chunksData.length === 0) return [];

    // Generate IDs in application code to avoid schema dependency
    // Get the current max ID and generate sequential IDs
    let startId = 1;
    try {
      const maxIdResult = await pool.query('SELECT COALESCE(MAX(id), 0) as max_id FROM file_chunks');
      startId = (maxIdResult.rows[0]?.max_id || 0) + 1;
    } catch (maxIdError) {
      console.warn('⚠️ [FileChunk.saveMultipleChunks] Could not get max ID, starting from 1:', maxIdError.message);
      // If we can't get max ID, try to use sequence if it exists
      try {
        const seqResult = await pool.query("SELECT nextval('file_chunks_id_seq') as next_id");
        startId = seqResult.rows[0]?.next_id || 1;
        // Reset sequence to start from the correct value for remaining chunks
        if (chunksData.length > 1) {
          await pool.query(`SELECT setval('file_chunks_id_seq', $1, false)`, [startId + chunksData.length - 1]);
        }
      } catch (seqError) {
        // Sequence doesn't exist, continue with max_id approach
        console.warn('⚠️ [FileChunk.saveMultipleChunks] Sequence not found, using max_id approach');
      }
    }

    const values = [];
    const placeholders = [];
    let paramIndex = 1;

    // Generate IDs for each chunk
    for (let i = 0; i < chunksData.length; i++) {
      const chunk = chunksData[i];
      const chunkId = startId + i;
      
      placeholders.push(
        `($${paramIndex}, $${paramIndex + 1}::uuid, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7})`
      );
      values.push(
        chunkId, // Explicitly provide the id
        chunk.file_id,
        chunk.chunk_index,
        chunk.content,
        chunk.token_count,
        chunk.page_start,
        chunk.page_end,
        chunk.heading
      );
      paramIndex += 8;
    }

    const query = `
      INSERT INTO file_chunks
        (id, file_id, chunk_index, content, token_count, page_start, page_end, heading)
      VALUES ${placeholders.join(', ')}
      RETURNING id, chunk_index
    `;

    try {
      const res = await pool.query(query, values);
      return res.rows;
    } catch (insertError) {
      // If there's a unique constraint violation (duplicate ID), retry with a higher start ID
      if (insertError.code === '23505' || (insertError.code === '23502' && insertError.column === 'id')) {
        console.warn('⚠️ [FileChunk.saveMultipleChunks] ID conflict detected, retrying with higher start ID');
        // Get the actual max ID again (in case another process inserted)
        const maxIdResult = await pool.query('SELECT COALESCE(MAX(id), 0) as max_id FROM file_chunks');
        const newStartId = (maxIdResult.rows[0]?.max_id || 0) + 1;
        
        // Regenerate placeholders and values with new start ID
        const retryValues = [];
        const retryPlaceholders = [];
        let retryParamIndex = 1;
        
        for (let i = 0; i < chunksData.length; i++) {
          const chunk = chunksData[i];
          const chunkId = newStartId + i;
          
          retryPlaceholders.push(
            `($${retryParamIndex}, $${retryParamIndex + 1}::uuid, $${retryParamIndex + 2}, $${retryParamIndex + 3}, $${retryParamIndex + 4}, $${retryParamIndex + 5}, $${retryParamIndex + 6}, $${retryParamIndex + 7})`
          );
          retryValues.push(
            chunkId,
            chunk.file_id,
            chunk.chunk_index,
            chunk.content,
            chunk.token_count,
            chunk.page_start,
            chunk.page_end,
            chunk.heading
          );
          retryParamIndex += 8;
        }
        
        const retryQuery = `
          INSERT INTO file_chunks
            (id, file_id, chunk_index, content, token_count, page_start, page_end, heading)
          VALUES ${retryPlaceholders.join(', ')}
          RETURNING id, chunk_index
        `;
        
        const retryRes = await pool.query(retryQuery, retryValues);
        return retryRes.rows;
      }
      throw insertError;
    }
  },

  async getChunksByFileId(fileId) {
    const res = await pool.query(
      `
      SELECT id, chunk_index, content, token_count, page_start, page_end, heading
      FROM file_chunks
      WHERE file_id = $1::uuid
      ORDER BY chunk_index ASC
      `,
      [fileId]
    );
    return res.rows;
  },

  async getChunkContentByIds(chunkIds) {
    const idsArray = Array.isArray(chunkIds) ? chunkIds.map(Number) : [Number(chunkIds)];

    const res = await pool.query(
      `
      SELECT id, content
      FROM file_chunks
      WHERE id = ANY($1::int[])
      ORDER BY array_position($1::int[], id)
      `,
      [idsArray]
    );
    return res.rows;
  }
};

module.exports = FileChunk;
