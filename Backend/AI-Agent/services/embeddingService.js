const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const MAX_CHARS = Number(process.env.GEMINI_EMBEDDING_MAX_CHARS || 8000);
const BATCH_SIZE = Number(process.env.GEMINI_EMBEDDING_BATCH_SIZE || 100);
const PRIMARY_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004';

function cleanText(text) {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
}

async function embedBatchWithModel(modelName, texts, retryCount = 0) {
  const model = genAI.getGenerativeModel({ model: modelName });
  const requests = texts.map((text) => ({
    content: { parts: [{ text: cleanText(text) }] },
  }));
  
  try {
    const response = await model.batchEmbedContents({ requests });
    return response.embeddings.map((item) => item.values);
  } catch (error) {
    const errorMessage = error?.message || String(error);
    const isRateLimitError = errorMessage.includes('429') || 
                             errorMessage.includes('Too Many Requests') ||
                             errorMessage.includes('quota') ||
                             errorMessage.includes('rate limit');
    
    if (isRateLimitError && retryCount < 3) {
      const retryDelay = 1000 * Math.pow(2, retryCount);
      console.warn(`Rate limit hit. Retrying in ${retryDelay}ms...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      return embedBatchWithModel(modelName, texts, retryCount + 1);
    }
    
    throw error;
  }
}

async function generateEmbeddingsWithMeta(texts) {
  if (!Array.isArray(texts) || texts.length === 0) {
    return { embeddings: [], model: PRIMARY_MODEL };
  }

  const results = [];
  const totalBatches = Math.ceil(texts.length / BATCH_SIZE);

  console.log(`[EmbeddingService] Processing ${texts.length} texts in ${totalBatches} batches`);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const batchStart = batchIndex * BATCH_SIZE;
    const batch = texts.slice(batchStart, batchStart + BATCH_SIZE);
    
    if (batch.length === 0) continue;

    try {
      const embeddings = await embedBatchWithModel(PRIMARY_MODEL, batch);
      results.push(...embeddings);
      
      if ((batchIndex + 1) % 10 === 0 || batchIndex === totalBatches - 1) {
        console.log(`✅ Embedded batch ${batchIndex + 1}/${totalBatches}`);
      }
    } catch (error) {
      console.error(`❌ Failed to embed batch ${batchIndex + 1}/${totalBatches}:`, error.message);
      throw error;
    }
  }

  console.log(`✅ Completed embedding ${texts.length} texts`);
  return { embeddings: results, model: PRIMARY_MODEL };
}

async function generateEmbedding(text) {
  const { embeddings } = await generateEmbeddingsWithMeta([text]);
  return embeddings[0];
}

async function generateEmbeddings(texts) {
  const { embeddings } = await generateEmbeddingsWithMeta(texts);
  return embeddings;
}

module.exports = {
  generateEmbedding,
  generateEmbeddings,
};
