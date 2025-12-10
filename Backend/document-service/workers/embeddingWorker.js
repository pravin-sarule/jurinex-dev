const { Worker, QueueEvents } = require('bullmq');
const { redisConnection, REDIS_DISABLED } = require('../config/redis');
const { EMBEDDING_QUEUE_NAME } = require('../queues/embeddingQueue');
const ChunkVector = require('../models/ChunkVector');
const File = require('../models/File');
const ProcessingJob = require('../models/ProcessingJob');
const {
  computeContentHash,
  generateEmbeddingsWithMeta,
  getCachedEmbedding,
  cacheEmbedding,
  BATCH_SIZE,
} = require('../services/embeddingService');

const MAX_BATCH_SIZE = Number(process.env.EMBEDDING_WORKER_BATCH_SIZE || BATCH_SIZE);
const CACHE_ONLY_MODE = process.env.EMBEDDING_WORKER_CACHE_ONLY === 'true';

function parseVector(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    return raw
      .replace(/[\[\]]/g, '')
      .split(',')
      .map((value) => parseFloat(value.trim()))
      .filter((value) => Number.isFinite(value));
  }
  return [];
}

async function upsertVectors(vectors) {
  if (!vectors.length) return [];
  return ChunkVector.saveMultipleChunkVectors(vectors);
}

async function updateFileStatus(fileId, status, progress) {
  if (!fileId) return;
  try {
    await File.updateProcessingStatus(fileId, status, progress);
  } catch (error) {
    console.error('[EmbeddingWorker] Failed to update file status', error?.message || error);
  }
}

async function completeProcessing(jobId) {
  if (!jobId) return;
  try {
    await ProcessingJob.updateJobStatus(jobId, 'completed');
  } catch (error) {
    console.error('[EmbeddingWorker] Failed to set job completed', error?.message || error);
  }
}

async function failProcessing(jobId, errorMessage) {
  if (!jobId) return;
  try {
    await ProcessingJob.updateJobStatus(jobId, 'failed', errorMessage);
  } catch (error) {
    console.error('[EmbeddingWorker] Failed to set job failed', error?.message || error);
  }
}

async function processJob(job) {
  const { fileId, jobId, chunks, progressBase = 78 } = job.data;

  if (!Array.isArray(chunks) || !chunks.length) {
    console.warn('[EmbeddingWorker] Job with no chunks, skipping');
    return;
  }

  await updateFileStatus(fileId, 'embedding_processing', progressBase);

  const vectors = [];
  const toEmbed = [];
  const cacheHits = [];

  for (const chunk of chunks) {
    const hash = computeContentHash(chunk.content);
    const cached = await getCachedEmbedding(hash);

    if (cached && cached.embedding) {
      const embedding = parseVector(cached.embedding);
      if (embedding.length) {
        vectors.push({ chunk_id: chunk.chunkId, embedding, file_id: fileId });
        cacheHits.push(chunk.chunkIndex);
        continue;
      }
    }

    toEmbed.push({ ...chunk, hash });
  }

  if (CACHE_ONLY_MODE && toEmbed.length) {
    throw new Error('Cache-only mode enabled but cache miss detected');
  }

  console.log(`[EmbeddingWorker] Cache hits: ${cacheHits.length}/${chunks.length}`);

  if (toEmbed.length) {
    for (let i = 0; i < toEmbed.length; i += MAX_BATCH_SIZE) {
      const batch = toEmbed.slice(i, i + MAX_BATCH_SIZE);
      const texts = batch.map((item) => item.content);

      const { embeddings, model } = await generateEmbeddingsWithMeta(texts);
      if (!embeddings || embeddings.length !== batch.length) {
        throw new Error(`Embedding count mismatch (expected ${batch.length}, got ${embeddings?.length || 0})`);
      }

      embeddings.forEach((embedding, idx) => {
        const chunk = batch[idx];
        vectors.push({
          chunk_id: chunk.chunkId,
          embedding,
          file_id: fileId,
        });

        cacheEmbedding({
          hash: chunk.hash,
          embedding,
          model,
          tokenCount: chunk.tokenCount,
        }).catch(() => {});
      });

      const progress = progressBase + Math.min(8, Math.round(((i + batch.length) / chunks.length) * 10));
      await updateFileStatus(fileId, 'embedding_processing', progress);
    }
  }

  await upsertVectors(vectors);
  await updateFileStatus(fileId, 'processed', 100);
  await completeProcessing(jobId);

  console.log(`[EmbeddingWorker] ✅ Stored ${vectors.length} vectors for file ${fileId}`);
}

let workerInstance = null;
let queueEvents = null;

function startEmbeddingWorker() {
  if (REDIS_DISABLED || !redisConnection) {
    console.log('[EmbeddingWorker] ⚠️ Worker disabled (Redis is disabled)');
    return null;
  }

  if (workerInstance) {
    return workerInstance;
  }

  try {
    workerInstance = new Worker(EMBEDDING_QUEUE_NAME, processJob, {
      connection: redisConnection,
      concurrency: Number(process.env.EMBEDDING_WORKER_CONCURRENCY || 2),
    });

    workerInstance.on('completed', (job) => {
      console.log(`[EmbeddingWorker] Job ${job.id} completed`);
    });

    workerInstance.on('failed', async (job, error) => {
      console.error(`[EmbeddingWorker] Job ${job?.id} failed`, error?.message || error);
      if (job?.data?.fileId) {
        await updateFileStatus(job.data.fileId, 'embedding_failed', 90);
      }
      if (job?.data?.jobId) {
        await failProcessing(job.data.jobId, error?.message || 'Embedding worker failure');
      }
    });

    queueEvents = new QueueEvents(EMBEDDING_QUEUE_NAME, { connection: redisConnection });
    queueEvents.on('waiting', ({ jobId }) => {
      console.log(`[EmbeddingWorker] Job ${jobId} waiting in queue`);
    });

    console.log('[EmbeddingWorker] Initialized');
    return workerInstance;
  } catch (error) {
    console.error('[EmbeddingWorker] Failed to initialize worker', error);
    return null;
  }
}

module.exports = {
  startEmbeddingWorker,
};




