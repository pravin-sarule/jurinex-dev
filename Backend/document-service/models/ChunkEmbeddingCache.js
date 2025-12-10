const pool = require('../config/db');

const TABLE_NAME = 'chunk_embedding_cache';

async function getEmbeddingByHash(contentHash) {
  const { rows } = await pool.query(
    `
      SELECT content_hash, embedding, model, token_count
      FROM ${TABLE_NAME}
      WHERE content_hash = $1
      LIMIT 1
    `,
    [contentHash]
  );

  return rows[0] || null;
}

async function upsertEmbedding({ contentHash, embedding, model, tokenCount }) {
  if (!Array.isArray(embedding)) {
    throw new Error('Embedding must be an array of numbers');
  }

  const vector = `[${embedding.join(',')}]`;
  const query = `
    INSERT INTO ${TABLE_NAME} (content_hash, embedding, model, token_count)
    VALUES ($1, $2::vector, $3, $4)
    ON CONFLICT (content_hash)
    DO UPDATE SET
      embedding = EXCLUDED.embedding,
      model = EXCLUDED.model,
      token_count = EXCLUDED.token_count,
      updated_at = NOW()
    RETURNING content_hash, model
  `;

  const { rows } = await pool.query(query, [
    contentHash,
    vector,
    model,
    tokenCount || null,
  ]);

  return rows[0];
}

module.exports = {
  getEmbeddingByHash,
  upsertEmbedding,
};













