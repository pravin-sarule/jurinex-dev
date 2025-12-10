const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const path = require('path');
const os = require('os');
require('dotenv').config();

let credentials;
let storage;
let tempKeyPath;

/**
 * Initialize GCS Storage client from base64 encoded key
 * Uses temporary file approach (similar to document-service secret manager)
 * This helps avoid JWT token issues
 */
function initializeGCS() {
  try {
    if (process.env.GCS_KEY_BASE64) {
      const jsonString = Buffer.from(process.env.GCS_KEY_BASE64, 'base64').toString('utf-8');
      credentials = JSON.parse(jsonString);
      
      // Validate credentials
      if (!credentials.project_id || !credentials.private_key || !credentials.client_email) {
        throw new Error('Invalid service account key format. Missing required fields.');
      }
      
      console.log('✅ GCS credentials loaded successfully');
      console.log(`   Project ID: ${credentials.project_id}`);
      console.log(`   Client Email: ${credentials.client_email}`);
      
      // Write credentials to temporary file and set GOOGLE_APPLICATION_CREDENTIALS
      // This approach is more reliable for JWT token generation
      tempKeyPath = path.join(os.tmpdir(), `gcs-key-${Date.now()}.json`);
      fs.writeFileSync(tempKeyPath, jsonString);
      process.env.GOOGLE_APPLICATION_CREDENTIALS = tempKeyPath;
      
      console.log(`✅ GCS credentials written to temporary file: ${tempKeyPath}`);
    } else {
      throw new Error('GCS_KEY_BASE64 environment variable is not set');
    }

    // Initialize Storage client
    // When GOOGLE_APPLICATION_CREDENTIALS is set, Storage will use it automatically
    storage = new Storage({
      projectId: credentials.project_id,
    });

    console.log(`✅ GCS Storage client initialized for project: ${credentials.project_id}`);
    return storage;
  } catch (error) {
    console.error('❌ Failed to initialize GCS Storage:', error.message);
    // Clean up temp file on error
    if (tempKeyPath && fs.existsSync(tempKeyPath)) {
      try {
        fs.unlinkSync(tempKeyPath);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    throw error;
  }
}

// Cleanup function to remove temp file on exit
function cleanup() {
  if (tempKeyPath && fs.existsSync(tempKeyPath)) {
    try {
      fs.unlinkSync(tempKeyPath);
      console.log('🧹 Cleaned up temporary GCS credentials file');
    } catch (error) {
      // Ignore cleanup errors
    }
  }
}

// Register cleanup on process exit
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit();
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit();
});

// Initialize on module load
if (!storage) {
  try {
    initializeGCS();
  } catch (error) {
    console.error('❌ GCS initialization failed:', error.message);
    console.error('   Please check:');
    console.error('   1. GCS_KEY_BASE64 is set in .env');
    console.error('   2. Service account key is valid and not expired');
    console.error('   3. System clock is synchronized');
    // Don't throw here, allow the app to start but operations will fail
  }
}

// Get bucket reference
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

