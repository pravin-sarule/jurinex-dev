const pool = require('../config/db');

const FileChunk = {
  async saveChunk(fileId, chunkIndex, content, tokenCount, pageStart = null, pageEnd = null, heading = null) {
    // Let PostgreSQL generate UUID automatically via DEFAULT gen_random_uuid()
    try {
      const res = await pool.query(
        `
        INSERT INTO file_chunks
          (file_id, chunk_index, content, token_count, page_start, page_end, heading)
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
        RETURNING id
        `,
        [fileId, chunkIndex, content, tokenCount, pageStart, pageEnd, heading]
      );
      return res.rows[0].id;
    } catch (insertError) {
      // If there's a unique constraint violation (duplicate file_id + chunk_index)
      if (insertError.code === '23505') {
        console.warn('⚠️ [FileChunk.saveChunk] Duplicate chunk_index detected, updating existing chunk');
        // Update existing chunk instead
        const updateRes = await pool.query(
          `
          UPDATE file_chunks
          SET content = $3, token_count = $4, page_start = $5, page_end = $6, heading = $7
          WHERE file_id = $1::uuid AND chunk_index = $2
          RETURNING id
          `,
          [fileId, chunkIndex, content, tokenCount, pageStart, pageEnd, heading]
        );
        return updateRes.rows[0].id;
      }
      throw insertError;
    }
  },

  async saveMultipleChunks(chunksData) {
    if (!chunksData || chunksData.length === 0) return [];

    // Optimize: Split large batches into smaller chunks to prevent slow queries and avoid hitting PostgreSQL parameter limits
    const BATCH_SIZE = 100; // Insert 100 chunks at a time for better performance
    const allSavedChunks = [];
    const totalChunks = chunksData.length;
    
    console.log(`[FileChunk.saveMultipleChunks] ⚡ Processing ${totalChunks} chunks in batches of ${BATCH_SIZE}`);

    for (let batchStart = 0; batchStart < totalChunks; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, totalChunks);
      const batch = chunksData.slice(batchStart, batchEnd);
      
      // Let PostgreSQL generate UUIDs automatically via DEFAULT gen_random_uuid()
      const values = [];
      const placeholders = [];
      let paramIndex = 1;

      // Generate placeholders for each chunk in this batch
      for (let i = 0; i < batch.length; i++) {
        const chunk = batch[i];
        
        placeholders.push(
          `($${paramIndex}::uuid, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6})`
        );
        values.push(
          chunk.file_id,
          chunk.chunk_index,
          chunk.content,
          chunk.token_count,
          chunk.page_start,
          chunk.page_end,
          chunk.heading
        );
        paramIndex += 7;
      }

      const query = `
        INSERT INTO file_chunks
          (file_id, chunk_index, content, token_count, page_start, page_end, heading)
        VALUES ${placeholders.join(', ')}
        RETURNING id, chunk_index
      `;

      try {
        const res = await pool.query(query, values);
        allSavedChunks.push(...res.rows);
        console.log(`✅ [FileChunk.saveMultipleChunks] Saved batch ${Math.floor(batchStart / BATCH_SIZE) + 1}/${Math.ceil(totalChunks / BATCH_SIZE)} (${batchStart + 1}-${batchEnd}/${totalChunks} chunks)`);
      } catch (insertError) {
        // If there's a unique constraint violation (duplicate file_id + chunk_index)
        if (insertError.code === '23505') {
          console.warn(`⚠️ [FileChunk.saveMultipleChunks] Duplicate chunk_index detected in batch ${Math.floor(batchStart / BATCH_SIZE) + 1}, handling conflicts`);
          
          // For conflicts, we'll insert chunks one by one in this batch, updating existing ones
          for (const chunk of batch) {
            try {
              const saved = await this.saveChunk(
                chunk.file_id,
                chunk.chunk_index,
                chunk.content,
                chunk.token_count,
                chunk.page_start,
                chunk.page_end,
                chunk.heading
              );
              allSavedChunks.push({ id: saved, chunk_index: chunk.chunk_index });
            } catch (chunkError) {
              console.error(`❌ [FileChunk.saveMultipleChunks] Failed to save chunk ${chunk.chunk_index}:`, chunkError.message);
              throw chunkError;
            }
          }
        } else {
          throw insertError;
        }
      }
    }
    
    console.log(`✅ [FileChunk.saveMultipleChunks] Successfully saved ${allSavedChunks.length} chunks in ${Math.ceil(totalChunks / BATCH_SIZE)} batches`);
    return allSavedChunks;
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
    // Convert to array and ensure they're valid UUIDs
    const idsArray = Array.isArray(chunkIds) ? chunkIds : [chunkIds];
    
    // Filter out any invalid UUIDs
    const validIds = idsArray.filter(id => {
      if (!id) return false;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      return uuidRegex.test(String(id));
    });

    if (validIds.length === 0) {
      return [];
    }

    const res = await pool.query(
      `
      SELECT id, content
      FROM file_chunks
      WHERE id = ANY($1::uuid[])
      ORDER BY array_position($1::uuid[], id)
      `,
      [validIds]
    );
    return res.rows;
  }
};

module.exports = FileChunk;
