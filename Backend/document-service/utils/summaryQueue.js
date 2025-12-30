/**
 * Summary Generation Queue with Rate Limiting
 * Processes summaries in parallel with controlled concurrency to avoid API rate limits
 */

class SummaryQueue {
  constructor(maxConcurrent = 3, delayBetweenBatches = 1000) {
    this.maxConcurrent = maxConcurrent; // Max concurrent API calls
    this.delayBetweenBatches = delayBetweenBatches; // Delay between batches in ms
    this.queue = [];
    this.processing = false;
  }

  /**
   * Add a summary generation task to the queue
   * @param {Function} task - Async function that generates a summary
   * @returns {Promise} - Promise that resolves when the summary is generated
   */
  async add(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        task,
        resolve,
        reject,
      });
      // Start processing if not already processing
      if (!this.processing) {
        this.process().catch(err => {
          console.error('[SummaryQueue] Processing error:', err);
        });
      }
    });
  }

  /**
   * Process the queue with rate limiting
   */
  async process() {
    if (this.processing) {
      return;
    }

    this.processing = true;

    try {
      while (this.queue.length > 0) {
        // Take up to maxConcurrent tasks
        const batch = this.queue.splice(0, this.maxConcurrent);
        
        // Process batch in parallel
        const promises = batch.map(async ({ task, resolve, reject }) => {
          try {
            const result = await task();
            resolve(result);
            return { success: true, result };
          } catch (error) {
            reject(error);
            return { success: false, error };
          }
        });

        // Wait for all tasks in the batch to complete
        await Promise.allSettled(promises);

        // If there are more tasks, wait before processing the next batch
        if (this.queue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, this.delayBetweenBatches));
        }
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Clear the queue
   */
  clear() {
    this.queue = [];
  }

  /**
   * Get queue size
   */
  size() {
    return this.queue.length;
  }
}

// Create a singleton instance
const summaryQueue = new SummaryQueue(
  parseInt(process.env.SUMMARY_QUEUE_MAX_CONCURRENT || '3', 10),
  parseInt(process.env.SUMMARY_QUEUE_DELAY_MS || '1000', 10)
);

module.exports = summaryQueue;

