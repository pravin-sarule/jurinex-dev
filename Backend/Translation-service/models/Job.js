/**
 * Job Model - Tracks translation jobs
 * In production, this should be replaced with a database (MongoDB, PostgreSQL, etc.)
 */
class Job {
  constructor() {
    this.jobs = new Map();
  }

  create(jobData) {
    const job = {
      id: jobData.id || `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      status: 'pending', // pending, processing, completed, failed
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...jobData,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  get(id) {
    return this.jobs.get(id);
  }

  update(id, updates) {
    const job = this.jobs.get(id);
    if (!job) return null;
    
    Object.assign(job, updates, {
      updatedAt: new Date().toISOString(),
    });
    return job;
  }

  delete(id) {
    return this.jobs.delete(id);
  }

  getAll() {
    return Array.from(this.jobs.values());
  }

  // Clean up old completed/failed jobs (older than 24 hours)
  cleanup(maxAge = 24 * 60 * 60 * 1000) {
    const now = Date.now();
    const toDelete = [];
    
    this.jobs.forEach((job, id) => {
      if ((job.status === 'completed' || job.status === 'failed') && 
          (now - new Date(job.updatedAt).getTime()) > maxAge) {
        toDelete.push(id);
      }
    });
    
    toDelete.forEach(id => this.jobs.delete(id));
    return toDelete.length;
  }
}

module.exports = new Job();

