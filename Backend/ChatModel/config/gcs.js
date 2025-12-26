const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const path = require('path');
const os = require('os');
require('dotenv').config();

let credentials;
let storage;
let tempKeyPath;

function initializeGCS() {
  try {
    if (process.env.GCS_KEY_BASE64) {
      const jsonString = Buffer.from(process.env.GCS_KEY_BASE64, 'base64').toString('utf-8');
      credentials = JSON.parse(jsonString);
      
      if (!credentials.project_id || !credentials.private_key || !credentials.client_email) {
        throw new Error('Invalid service account key format. Missing required fields.');
      }
      
      console.log('✅ GCS credentials loaded successfully');
      console.log(`   Project ID: ${credentials.project_id}`);
      console.log(`   Client Email: ${credentials.client_email}`);
      
      tempKeyPath = path.join(os.tmpdir(), `gcs-key-${Date.now()}.json`);
      fs.writeFileSync(tempKeyPath, jsonString);
      process.env.GOOGLE_APPLICATION_CREDENTIALS = tempKeyPath;
      
      console.log(`✅ GCS credentials written to temporary file: ${tempKeyPath}`);
    } else {
      throw new Error('GCS_KEY_BASE64 environment variable is not set');
    }

    storage = new Storage({
      projectId: credentials.project_id,
    });

    console.log(`✅ GCS Storage client initialized for project: ${credentials.project_id}`);
    return storage;
  } catch (error) {
    console.error('❌ Failed to initialize GCS Storage:', error.message);
    if (tempKeyPath && fs.existsSync(tempKeyPath)) {
      try {
        fs.unlinkSync(tempKeyPath);
      } catch (e) {
      }
    }
    throw error;
  }
}

function cleanup() {
  if (tempKeyPath && fs.existsSync(tempKeyPath)) {
    try {
      fs.unlinkSync(tempKeyPath);
      console.log('🧹 Cleaned up temporary GCS credentials file');
    } catch (error) {
    }
  }
}

process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit();
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit();
});

if (!storage) {
  try {
    initializeGCS();
  } catch (error) {
    console.error('❌ GCS initialization failed:', error.message);
    console.error('   Please check:');
    console.error('   1. GCS_KEY_BASE64 is set in .env');
    console.error('   2. Service account key is valid and not expired');
    console.error('   3. System clock is synchronized');
  }
}

function getBucket(bucketName) {
  if (!storage) {
    throw new Error('GCS Storage client not initialized. Check GCS_KEY_BASE64 in .env');
  }
  
  if (!bucketName) {
    throw new Error('Bucket name is required');
  }
  
  return storage.bucket(bucketName);
}

module.exports = {
  storage,
  credentials,
  getBucket,
  initializeGCS,
};

