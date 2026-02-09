const crypto = require('crypto');
const { GoogleGenAI } = require('@google/genai');
const ChunkEmbeddingCache = require('../models/ChunkEmbeddingCache');
const embeddingRateLimiter = require('../utils/embeddingRateLimiter');

// Initialize the Gemini client with API key
const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MAX_CHARS = Number(process.env.GEMINI_EMBEDDING_MAX_CHARS || 10000);
const BATCH_SIZE = Number(process.env.GEMINI_EMBEDDING_BATCH_SIZE || 100);

// Use the correct Gemini embedding model
const PRIMARY_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
const OUTPUT_DIMENSIONALITY = Number(process.env.GEMINI_EMBEDDING_DIMENSION || 768);

console.log(`[EmbeddingService] Initialized with model: ${PRIMARY_MODEL}`);
console.log(`[EmbeddingService] Output dimensionality: ${OUTPUT_DIMENSIONALITY}`);
console.log(`[EmbeddingService] Batch size: ${BATCH_SIZE}`);

const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 1000;

function cleanText(text) {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
}

function computeContentHash(text) {
  return crypto.createHash('sha256').update(text || '', 'utf8').digest('hex');
}

/**
 * Normalize embeddings for dimensions other than 3072
 * This ensures accurate semantic similarity comparisons
 */
function normalizeEmbedding(embedding) {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('Invalid embedding array');
  }

  // Calculate the magnitude (L2 norm)
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));

  if (magnitude === 0) {
    throw new Error('Cannot normalize zero vector');
  }

  // Normalize each value
  return embedding.map(val => val / magnitude);
}

/**
 * Generate embeddings using the new Gemini API
 */
async function embedBatchWithModel(modelName, texts, retryCount = 0) {
  console.log(`[EmbeddingService] Embedding ${texts.length} texts with ${modelName}`);

  try {
    // Use rate limiter to ensure we don't exceed API limits
    const result = await embeddingRateLimiter.addRequest(async () => {
      return await client.models.embedContent({
        model: modelName,
        contents: texts.map(text => cleanText(text)),
        config: {
          taskType: 'RETRIEVAL_DOCUMENT', // Optimized for document search/RAG
          outputDimensionality: OUTPUT_DIMENSIONALITY
        }
      });
    });

    console.log(`[EmbeddingService] API Response received`);
    console.log(`[EmbeddingService] Result type: ${typeof result}`);
    console.log(`[EmbeddingService] Result keys: ${result ? Object.keys(result).join(', ') : 'null'}`);
    console.log(`[EmbeddingService] result.embeddings type: ${typeof result?.embeddings}`);
    console.log(`[EmbeddingService] result.embeddings length: ${result?.embeddings?.length}`);

    if (!result) {
      throw new Error('API returned null/undefined result');
    }

    if (!result.embeddings) {
      console.error(`[EmbeddingService] ❌ result.embeddings is undefined!`);
      console.error(`[EmbeddingService] Full result:`, JSON.stringify(result, null, 2));
      throw new Error('API response missing embeddings property');
    }

    if (!Array.isArray(result.embeddings)) {
      console.error(`[EmbeddingService] ❌ result.embeddings is not an array!`);
      console.error(`[EmbeddingService] Type: ${typeof result.embeddings}`);
      throw new Error(`API response embeddings is not an array: ${typeof result.embeddings}`);
    }

    if (result.embeddings.length === 0) {
      console.error(`[EmbeddingService] ❌ result.embeddings is empty array!`);
      throw new Error('API returned empty embeddings array');
    }

    console.log(`[EmbeddingService] ✅ Successfully embedded ${texts.length} texts`);

    // Extract embeddings and normalize if needed
    const embeddings = result.embeddings.map((embeddingObj, idx) => {
      if (!embeddingObj) {
        console.error(`[EmbeddingService] ❌ Embedding at index ${idx} is null/undefined`);
        throw new Error(`Embedding at index ${idx} is null/undefined`);
      }

      if (!embeddingObj.values) {
        console.error(`[EmbeddingService] ❌ Embedding at index ${idx} missing 'values' property`);
        console.error(`[EmbeddingService] Embedding keys: ${Object.keys(embeddingObj).join(', ')}`);
        throw new Error(`Embedding at index ${idx} missing 'values' property`);
      }

      const values = embeddingObj.values;

      if (!Array.isArray(values)) {
        console.error(`[EmbeddingService] ❌ Embedding values at index ${idx} is not an array`);
        throw new Error(`Embedding values at index ${idx} is not an array`);
      }

      if (values.length === 0) {
        console.error(`[EmbeddingService] ❌ Embedding values at index ${idx} is empty`);
        throw new Error(`Embedding values at index ${idx} is empty`);
      }

      // Normalize for dimensions other than 3072
      if (OUTPUT_DIMENSIONALITY !== 3072) {
        return normalizeEmbedding(values);
      }

      return values;
    });

    console.log(`[EmbeddingService] ✅ Extracted and processed ${embeddings.length} embeddings`);
    console.log(`[EmbeddingService] First embedding dimension: ${embeddings[0]?.length}`);

    return embeddings;
  } catch (error) {
    console.error(`[EmbeddingService] ❌ Error with model ${modelName}:`, error.message);
    console.error(`[EmbeddingService] Error stack:`, error.stack);

    const errorMessage = error?.message || String(error);
    const isRateLimitError = errorMessage.includes('429') ||
      errorMessage.includes('Too Many Requests') ||
      errorMessage.includes('quota') ||
      errorMessage.includes('rate limit');

    // Handle rate limit errors with exponential backoff
    if (isRateLimitError && retryCount < MAX_RETRIES) {
      const retryDelay = RETRY_DELAY_BASE * Math.pow(2, retryCount);
      console.warn(`[EmbeddingService] Rate limit hit. Retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);

      await new Promise(resolve => setTimeout(resolve, retryDelay));
      return embedBatchWithModel(modelName, texts, retryCount + 1);
    }

    throw error;
  }
}

/**
 * Generate embeddings with metadata
 */
async function generateEmbeddingsWithMeta(texts) {
  if (!Array.isArray(texts) || texts.length === 0) {
    console.warn('[EmbeddingService] No texts provided for embedding');
    return { embeddings: [], model: PRIMARY_MODEL };
  }

  const results = [];
  const totalBatches = Math.ceil(texts.length / BATCH_SIZE);

  console.log(`[EmbeddingService] Processing ${texts.length} texts in ${totalBatches} batches`);

  // Process batches sequentially to stay within rate limits
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const batchStart = batchIndex * BATCH_SIZE;
    const batch = texts.slice(batchStart, batchStart + BATCH_SIZE);

    if (batch.length === 0) continue;

    try {
      const embeddings = await embedBatchWithModel(PRIMARY_MODEL, batch);
      results.push(...embeddings);

      // Log progress every 10 batches or on completion
      if ((batchIndex + 1) % 10 === 0 || batchIndex === totalBatches - 1) {
        const progress = ((batchIndex + 1) / totalBatches * 100).toFixed(1);
        console.log(`[EmbeddingService] ✅ Progress: ${batchIndex + 1}/${totalBatches} batches (${progress}%)`);
      }
    } catch (error) {
      console.error(`[EmbeddingService] ❌ Failed to embed batch ${batchIndex + 1}/${totalBatches}:`, error.message);
      throw new Error(`Embedding generation failed at batch ${batchIndex + 1}: ${error.message}`);
    }
  }

  console.log(`[EmbeddingService] ✅ Completed embedding ${texts.length} texts`);
  console.log(`[EmbeddingService] Total embeddings generated: ${results.length}`);
  console.log(`[EmbeddingService] Embedding dimension: ${results[0]?.length || 'N/A'}`);

  return { embeddings: results, model: PRIMARY_MODEL };
}

/**
 * Generate a single embedding
 */
async function generateEmbedding(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('Invalid text provided for embedding');
  }

  const { embeddings } = await generateEmbeddingsWithMeta([text]);

  if (!embeddings || embeddings.length === 0) {
    throw new Error('Failed to generate embedding');
  }

  return embeddings[0];
}

/**
 * Generate multiple embeddings
 */
async function generateEmbeddings(texts) {
  if (!Array.isArray(texts)) {
    throw new Error('texts must be an array');
  }

  const { embeddings } = await generateEmbeddingsWithMeta(texts);

  if (embeddings.length !== texts.length) {
    throw new Error(`Embedding count mismatch: expected ${texts.length}, got ${embeddings.length}`);
  }

  return embeddings;
}

/**
 * Get cached embedding by content hash
 */
async function getCachedEmbedding(hash) {
  if (!hash) return null;
  try {
    return await ChunkEmbeddingCache.getEmbeddingByHash(hash);
  } catch (error) {
    console.warn('[EmbeddingService] Cache lookup failed:', error?.message || error);
    return null;
  }
}

/**
 * Cache an embedding
 */
async function cacheEmbedding({ hash, embedding, model, tokenCount }) {
  try {
    await ChunkEmbeddingCache.upsertEmbedding({
      contentHash: hash,
      embedding,
      model,
      tokenCount,
    });
  } catch (error) {
    console.warn('[EmbeddingService] Cache upsert failed:', error?.message || error);
  }
}

module.exports = {
  cleanText,
  computeContentHash,
  generateEmbedding,
  generateEmbeddings,
  generateEmbeddingsWithMeta,
  normalizeEmbedding,
  getCachedEmbedding,
  cacheEmbedding,
  BATCH_SIZE,
  PARALLEL_BATCHES: Number(process.env.EMBEDDING_PARALLEL_BATCHES || 3),
  embeddingRateLimiter,
};
