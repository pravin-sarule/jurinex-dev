

const pool = require('../config/db');

const FileChunk = {
  // Save a single chunk
  async saveChunk(fileId, chunkIndex, content, tokenCount, pageStart = null, pageEnd = null, heading = null) {
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
  },

  // Save multiple chunks in a batch
  async saveMultipleChunks(chunksData) {
    if (!chunksData || chunksData.length === 0) return [];

    const values = [];
    const placeholders = [];
    let paramIndex = 1;

    for (const chunk of chunksData) {
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

    const res = await pool.query(query, values);
    return res.rows;
  },

  // Get all chunks by file ID
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

  // Get chunk content by an array of chunk IDs
  async getChunkContentByIds(chunkIds) {
    // Ensure chunkIds is an array of integers
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
