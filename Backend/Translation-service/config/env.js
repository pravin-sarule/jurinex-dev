require('dotenv').config();

module.exports = {
  googleCloud: {
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
    // Can use either GOOGLE_APPLICATION_CREDENTIALS env var or this config
    credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS_PATH,
  },
  translation: {
    location: process.env.TRANSLATION_API_LOCATION || 'global',
  },
  documentAI: {
    processorId: process.env.DOCUMENT_AI_PROCESSOR_ID,
    location: process.env.DOCUMENT_AI_LOCATION || 'us',
  },
  server: {
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
  },
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 104857600, // 100MB default (for 500 page documents)
    uploadDir: process.env.UPLOAD_DIR || './uploads',
  },
  jobQueue: {
    maxConcurrentJobs: parseInt(process.env.MAX_CONCURRENT_JOBS) || 3,
  },
};

