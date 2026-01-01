const crypto = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const ChunkEmbeddingCache = require('../models/ChunkEmbeddingCache');
const embeddingRateLimiter = require('../utils/embeddingRateLimiter');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const MAX_CHARS = Number(process.env.GEMINI_EMBEDDING_MAX_CHARS || 8000);
const BATCH_SIZE = Number(process.env.GEMINI_EMBEDDING_BATCH_SIZE || 100); // Gemini supports up to 100 per batch
// Use text-embedding-004 as primary (dedicated embedding model that supports batchEmbedContents)
// Note: gemini-1.5-flash-002 and gemini-2.0-flash-exp do NOT support embeddings
const PRIMARY_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004';
const FALLBACK_MODELS = (process.env.GEMINI_EMBEDDING_FALLBACKS || 'embedding-001').split(',').map((m) => m.trim()).filter(Boolean);

console.log(`[EmbeddingService] Initialized with PRIMARY_MODEL: ${PRIMARY_MODEL}`);
console.log(`[EmbeddingService] FALLBACK_MODELS: ${FALLBACK_MODELS.join(', ')}`);
const MAX_RETRIES = 3; // Maximum retries for rate limit errors
const RETRY_DELAY_BASE = 1000; // Base delay in milliseconds for exponential backoff

function cleanText(text) {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
}

function computeContentHash(text) {
  return crypto.createHash('sha256').update(text || '', 'utf8').digest('hex');
}

async function embedBatchWithModel(modelName, texts, retryCount = 0) {
  console.log(`[EmbeddingService] Using model: ${modelName} for ${texts.length} texts`);
  
  // For embedding models, use getGenerativeModel (works for text-embedding-004)
  const model = genAI.getGenerativeModel({ model: modelName });
  const requests = texts.map((text) => ({
    content: { parts: [{ text: cleanText(text) }] },
  }));
  
  try {
    // Use rate limiter to ensure we don't exceed API limits
    const response = await embeddingRateLimiter.addRequest(async () => {
      return await model.batchEmbedContents({ requests });
    });
    
    console.log(`[EmbeddingService] ✅ Successfully embedded ${texts.length} texts using ${modelName}`);
    return response.embeddings.map((item) => item.values);
  } catch (error) {
    console.error(`[EmbeddingService] ❌ Error with model ${modelName}:`, error.message);
    const errorMessage = error?.message || String(error);
    const isRateLimitError = errorMessage.includes('429') || 
                             errorMessage.includes('Too Many Requests') ||
                             errorMessage.includes('quota') ||
                             errorMessage.includes('rate limit');
    
    // Handle rate limit errors with exponential backoff
    if (isRateLimitError && retryCount < MAX_RETRIES) {
      // Extract retry delay from error if available (Gemini provides this)
      let retryDelay = RETRY_DELAY_BASE * Math.pow(2, retryCount);
      
      // Try to extract retry delay from error details
      if (error?.errorDetails) {
        const retryInfo = error.errorDetails.find(detail => detail['@type']?.includes('RetryInfo'));
        if (retryInfo?.retryDelay) {
          // Convert seconds to milliseconds
          retryDelay = parseFloat(retryInfo.retryDelay) * 1000 || retryDelay;
        }
      }
      
      console.warn(`[EmbeddingService] Rate limit hit for model "${modelName}". Retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      
      return embedBatchWithModel(modelName, texts, retryCount + 1);
    }
    
    throw error;
  }
}

async function tryModelsSequentially(texts, models) {
  console.log(`[EmbeddingService] Trying models sequentially:`, models);
  const errors = [];
  for (const modelName of models) {
    try {
      console.log(`[EmbeddingService] Attempting model: ${modelName}`);
      const embeddings = await embedBatchWithModel(modelName, texts);
      return { embeddings, model: modelName };
    } catch (error) {
      const message = error?.message || String(error);
      console.warn(`[EmbeddingService] Model "${modelName}" failed: ${message}`);
      errors.push({ model: modelName, message });

      if (!message.toLowerCase().includes('token') && !message.toLowerCase().includes('length')) {
        throw error;
      }
    }
  }

  const errorSummary = errors.map((e) => `${e.model}: ${e.message}`).join('; ');
  throw new Error(`All embedding models failed. ${errorSummary}`);
}

async function generateEmbeddingsWithMeta(texts) {
  if (!Array.isArray(texts) || texts.length === 0) {
    return { embeddings: [], model: PRIMARY_MODEL };
  }

  const models = [PRIMARY_MODEL, ...FALLBACK_MODELS.filter((m) => m !== PRIMARY_MODEL)];
  const results = [];
  let lastModel = PRIMARY_MODEL;
  const totalBatches = Math.ceil(texts.length / BATCH_SIZE);

  console.log(`[EmbeddingService] Processing ${texts.length} texts in ${totalBatches} batches (batch size: ${BATCH_SIZE})`);

  // Process batches sequentially through rate limiter (which handles internal parallelization)
  // This ensures we stay within rate limits even for very large files (1200+ pages)
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const batchStart = batchIndex * BATCH_SIZE;
    const batch = texts.slice(batchStart, batchStart + BATCH_SIZE);
    
    if (batch.length === 0) continue;

    try {
      const { embeddings, model } = await tryModelsSequentially(batch, models);
      results.push(...embeddings);
      lastModel = model;
      
      if ((batchIndex + 1) % 10 === 0 || batchIndex === totalBatches - 1) {
        console.log(`[EmbeddingService] ✅ Embedded batch ${batchIndex + 1}/${totalBatches} using ${model} (${((batchIndex + 1) / totalBatches * 100).toFixed(1)}%)`);
      }
    } catch (error) {
      console.error(`[EmbeddingService] ❌ Failed to embed batch ${batchIndex + 1}/${totalBatches}:`, error.message);
      throw error;
    }
  }

  console.log(`[EmbeddingService] ✅ Completed embedding ${texts.length} texts using ${lastModel}`);
  return { embeddings: results, model: lastModel };
}

async function generateEmbedding(text) {
  const { embeddings } = await generateEmbeddingsWithMeta([text]);
  return embeddings[0];
}

async function generateEmbeddings(texts) {
  const { embeddings } = await generateEmbeddingsWithMeta(texts);
  return embeddings;
}

async function getCachedEmbedding(hash) {
  if (!hash) return null;
  try {
    return await ChunkEmbeddingCache.getEmbeddingByHash(hash);
  } catch (error) {
    console.warn('[EmbeddingService] Cache lookup failed', error?.message || error);
    return null;
  }
}

async function cacheEmbedding({ hash, embedding, model, tokenCount }) {
  try {
    await ChunkEmbeddingCache.upsertEmbedding({
      contentHash: hash,
      embedding,
      model,
      tokenCount,
    });
  } catch (error) {
    console.warn('[EmbeddingService] Cache upsert failed', error?.message || error);
  }
}

module.exports = {
  cleanText,
  computeContentHash,
  generateEmbedding,
  generateEmbeddings,
  generateEmbeddingsWithMeta,
  tryModelsSequentially,
  getCachedEmbedding,
  cacheEmbedding,
  BATCH_SIZE,
  embeddingRateLimiter,
};

