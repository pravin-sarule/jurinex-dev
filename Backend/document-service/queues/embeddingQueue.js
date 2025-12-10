const { Queue } = require('bullmq');
const { redisConnection, REDIS_DISABLED } = require('../config/redis');

const EMBEDDING_QUEUE_NAME = process.env.EMBEDDING_QUEUE_NAME || 'document-embedding-jobs';

const limiter = {
  max: Number(process.env.EMBEDDING_QUEUE_RATE_MAX || 8),
  duration: Number(process.env.EMBEDDING_QUEUE_RATE_DURATION_MS || 1000),
};

const defaultJobOptions = {
  attempts: Number(process.env.EMBEDDING_QUEUE_ATTEMPTS || 3),
  backoff: {
    type: 'exponential',
    delay: Number(process.env.EMBEDDING_QUEUE_BACKOFF_DELAY_MS || 5000),
  },
  removeOnComplete: Number(process.env.EMBEDDING_QUEUE_KEEP_COMPLETE || 100),
  removeOnFail: false,
};

// Only create queue if Redis is enabled
let embeddingQueue = null;
if (!REDIS_DISABLED && redisConnection) {
  try {
    embeddingQueue = new Queue(EMBEDDING_QUEUE_NAME, {
      connection: redisConnection,
      defaultJobOptions,
      limiter,
    });
  } catch (error) {
    console.error('[EmbeddingQueue] Failed to create queue', error);
  }
}

async function warmQueue() {
  if (REDIS_DISABLED || !embeddingQueue) {
    console.log('[EmbeddingQueue] ⚠️ Queue disabled (Redis is disabled)');
    return;
  }
  try {
    await embeddingQueue.waitUntilReady();
    console.log(`[EmbeddingQueue] Ready (limiter=${limiter.max}/${limiter.duration}ms)`);
  } catch (error) {
    console.error('[EmbeddingQueue] Failed to initialize queue', error);
  }
}

async function enqueueEmbeddingJob(payload, options = {}) {
  if (REDIS_DISABLED || !embeddingQueue) {
    console.log('[EmbeddingQueue] ⚠️ Skipping job enqueue (Redis is disabled):', payload.fileId);
    // Return a mock job object to prevent errors
    return {
      id: `disabled:${payload.fileId}:${Date.now()}`,
      data: payload,
      remove: async () => {},
      updateProgress: async () => {},
    };
  }
  const jobId = options.jobId || `embedding:${payload.fileId}:${Date.now()}`;
  return embeddingQueue.add('embed-chunks', payload, {
    jobId,
    priority: options.priority || 1,
    attempts: options.attempts,
    backoff: options.backoff,
  });
}

module.exports = {
  embeddingQueue,
  enqueueEmbeddingJob,
  warmQueue,
  EMBEDDING_QUEUE_NAME,
};


