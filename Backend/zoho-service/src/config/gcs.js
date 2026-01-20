/**
 * Google Cloud Storage Configuration
 * Uses base64-encoded service account key from environment
 */
const { Storage } = require('@google-cloud/storage');
require('dotenv').config();

let storage = null;
let bucket = null;

/**
 * Initialize GCS client from base64 key
 */
const initializeGCS = () => {
    if (storage) return { storage, bucket };

    const keyBase64 = process.env.GCS_KEY_BASE64;
    const bucketName = process.env.GCS_BUCKET_NAME;
    const projectId = process.env.GCS_PROJECT_ID;

    if (!keyBase64) {
        console.warn('⚠️ [GCS] GCS_KEY_BASE64 not configured - GCS features will be disabled');
        return { storage: null, bucket: null };
    }

    if (!bucketName) {
        console.warn('⚠️ [GCS] GCS_BUCKET_NAME not configured');
        return { storage: null, bucket: null };
    }

    try {
        const keyJson = JSON.parse(Buffer.from(keyBase64, 'base64').toString('utf8'));

        storage = new Storage({
            projectId: projectId || keyJson.project_id,
            credentials: keyJson
        });

        bucket = storage.bucket(bucketName);
        console.log(`✅ [GCS] Initialized with bucket: ${bucketName}`);

        return { storage, bucket };
    } catch (error) {
        console.error('❌ [GCS] Failed to initialize:', error.message);
        return { storage: null, bucket: null };
    }
};

/**
 * Get initialized GCS bucket
 */
const getBucket = () => {
    if (!bucket) {
        const result = initializeGCS();
        return result.bucket;
    }
    return bucket;
};

/**
 * Get bucket name
 */
const getBucketName = () => process.env.GCS_BUCKET_NAME;

module.exports = {
    initializeGCS,
    getBucket,
    getBucketName
};
