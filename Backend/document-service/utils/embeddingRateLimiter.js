/**
 * Rate limiter for embedding API calls
 * Gemini API limit: 3000 requests per minute = 50 requests/second
 * We'll use a safer limit of 40 requests/second to avoid hitting the limit
 */

class EmbeddingRateLimiter {
  constructor() {
    this.maxRequestsPerSecond = 40; // Safe limit: 40 req/sec = 2400 req/min (under 3000 limit)
    this.maxRequestsPerMinute = 2400; // Additional safety buffer
    this.requestQueue = [];
    this.isProcessing = false;
    this.requestTimes = []; // Track request times for rate limiting
    this.concurrentRequests = 0;
    this.maxConcurrentRequests = 10; // Process up to 10 batches concurrently
  }

  /**
   * Add a request to the queue and process it when rate limit allows
   */
  async addRequest(requestFn) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({
        fn: requestFn,
        resolve,
        reject,
        timestamp: Date.now(),
      });
      
      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  /**
   * Clean up old request times (older than 1 minute)
   */
  cleanupOldTimes() {
    const oneMinuteAgo = Date.now() - 60000;
    this.requestTimes = this.requestTimes.filter(time => time > oneMinuteAgo);
  }

  /**
   * Check if we can make a request now
   */
  canMakeRequest() {
    this.cleanupOldTimes();
    
    // Check per-second limit
    const oneSecondAgo = Date.now() - 1000;
    const recentRequests = this.requestTimes.filter(time => time > oneSecondAgo).length;
    
    if (recentRequests >= this.maxRequestsPerSecond) {
      return false;
    }
    
    // Check per-minute limit
    if (this.requestTimes.length >= this.maxRequestsPerMinute) {
      return false;
    }
    
    // Check concurrent requests
    if (this.concurrentRequests >= this.maxConcurrentRequests) {
      return false;
    }
    
    return true;
  }

  /**
   * Get delay needed before next request
   */
  getDelayUntilNextRequest() {
    this.cleanupOldTimes();
    
    // Check per-second limit
    const oneSecondAgo = Date.now() - 1000;
    const recentRequests = this.requestTimes.filter(time => time > oneSecondAgo);
    
    if (recentRequests.length >= this.maxRequestsPerSecond) {
      const oldestRecentRequest = Math.min(...recentRequests);
      const delay = 1000 - (Date.now() - oldestRecentRequest);
      return Math.max(delay, 25); // Minimum 25ms delay
    }
    
    // Check concurrent requests
    if (this.concurrentRequests >= this.maxConcurrentRequests) {
      return 50; // Wait 50ms before checking again
    }
    
    return 0;
  }

  /**
   * Process the queue with controlled concurrency
   */
  async processQueue() {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    while (this.requestQueue.length > 0 || this.concurrentRequests > 0) {
      // Start as many requests as allowed (up to maxConcurrentRequests)
      const requestsToStart = [];
      while (this.requestQueue.length > 0 && this.canMakeRequest()) {
        const request = this.requestQueue.shift();
        requestsToStart.push(request);
      }

      // Execute all allowed requests concurrently
      for (const request of requestsToStart) {
        const requestTime = Date.now();
        this.requestTimes.push(requestTime);
        this.concurrentRequests++;

        // Execute request asynchronously
        Promise.resolve(request.fn())
          .then(result => {
            this.concurrentRequests--;
            request.resolve(result);
            // Clean up old times periodically
            if (this.requestTimes.length > 5000) {
              this.cleanupOldTimes();
            }
          })
          .catch(error => {
            this.concurrentRequests--;
            request.reject(error);
            // Clean up old times periodically
            if (this.requestTimes.length > 5000) {
              this.cleanupOldTimes();
            }
          });
      }

      // If we can't make more requests or queue is empty, wait
      if (this.requestQueue.length > 0 || this.concurrentRequests > 0) {
        const delay = this.getDelayUntilNextRequest();
        await new Promise(resolve => setTimeout(resolve, delay || 50));
      }
    }

    this.isProcessing = false;
  }

  /**
   * Get current queue status
   */
  getStatus() {
    this.cleanupOldTimes();
    return {
      queueLength: this.requestQueue.length,
      concurrentRequests: this.concurrentRequests,
      requestsInLastMinute: this.requestTimes.length,
      isProcessing: this.isProcessing,
    };
  }
}

// Singleton instance
const embeddingRateLimiter = new EmbeddingRateLimiter();

module.exports = embeddingRateLimiter;
