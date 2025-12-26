const crypto = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const ChunkEmbeddingCache = require('../models/ChunkEmbeddingCache');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const MAX_CHARS = Number(process.env.GEMINI_EMBEDDING_MAX_CHARS || 8000);
const BATCH_SIZE = Number(process.env.GEMINI_EMBEDDING_BATCH_SIZE || 32);
const PRIMARY_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'embedding-001';
const FALLBACK_MODELS = (process.env.GEMINI_EMBEDDING_FALLBACKS || 'text-embedding-004').split(',').map((m) => m.trim()).filter(Boolean);

function cleanText(text) {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
}

function computeContentHash(text) {
  return crypto.createHash('sha256').update(text || '', 'utf8').digest('hex');
}

async function embedBatchWithModel(modelName, texts) {
  const model = genAI.getGenerativeModel({ model: modelName });
  const requests = texts.map((text) => ({
    content: { parts: [{ text: cleanText(text) }] },
  }));
  const response = await model.batchEmbedContents({ requests });
  return response.embeddings.map((item) => item.values);
}

async function tryModelsSequentially(texts, models) {
  const errors = [];
  for (const modelName of models) {
    try {
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

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const { embeddings, model } = await tryModelsSequentially(batch, models);
    results.push(...embeddings);
    lastModel = model;
    console.log(`[EmbeddingService] ✅ Embedded batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(texts.length / BATCH_SIZE)} using ${model}`);
  }

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
};

