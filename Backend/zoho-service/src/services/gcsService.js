/**
 * Google Cloud Storage Service
 * Handles file uploads and signed URL generation
 */
const { getBucket, getBucketName } = require('../config/gcs');
const { logTiming } = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * Upload file buffer to GCS
 * @param {Buffer} buffer - File content
 * @param {string} gcsPath - Destination path in bucket
 * @param {string} mimeType - File MIME type
 * @param {string} requestId - Request correlation ID
 * @returns {Promise<string>} GCS path
 */
const uploadBuffer = async (buffer, gcsPath, mimeType, requestId) => {
    const startTime = Date.now();
    const bucket = getBucket();

    if (!bucket) {
        throw new Error('GCS not configured');
    }

    try {
        console.log(`[REQ:${requestId}] [GCS] Uploading to ${gcsPath} (${buffer.length} bytes)`);

        const file = bucket.file(gcsPath);

        await file.save(buffer, {
            contentType: mimeType,
            resumable: buffer.length > 5 * 1024 * 1024, // Resumable for >5MB
            metadata: {
                uploadedAt: new Date().toISOString(),
                requestId
            }
        });

        const duration = Date.now() - startTime;
        logTiming(requestId, 'GCS Upload', duration, true);

        console.log(`[REQ:${requestId}] [GCS] ✅ Uploaded: ${gcsPath}`);

        return gcsPath;
    } catch (error) {
        const duration = Date.now() - startTime;
        logTiming(requestId, 'GCS Upload', duration, false);

        console.error(`[REQ:${requestId}] [GCS] ❌ Upload failed: ${error.message}`);
        throw error;
    }
};

/**
 * Stream upload to GCS (for large files)
 * @param {ReadableStream} stream - File stream
 * @param {string} gcsPath - Destination path
 * @param {string} mimeType - File MIME type
 * @param {string} requestId - Request correlation ID
 * @returns {Promise<string>} GCS path
 */
const uploadStream = async (stream, gcsPath, mimeType, requestId) => {
    const startTime = Date.now();
    const bucket = getBucket();

    if (!bucket) {
        throw new Error('GCS not configured');
    }

    return new Promise((resolve, reject) => {
        console.log(`[REQ:${requestId}] [GCS] Streaming upload to ${gcsPath}`);

        const file = bucket.file(gcsPath);
        const writeStream = file.createWriteStream({
            contentType: mimeType,
            resumable: true,
            metadata: {
                uploadedAt: new Date().toISOString(),
                requestId
            }
        });

        stream.pipe(writeStream);

        writeStream.on('finish', () => {
            const duration = Date.now() - startTime;
            logTiming(requestId, 'GCS Stream Upload', duration, true);
            console.log(`[REQ:${requestId}] [GCS] ✅ Stream uploaded: ${gcsPath}`);
            resolve(gcsPath);
        });

        writeStream.on('error', (error) => {
            const duration = Date.now() - startTime;
            logTiming(requestId, 'GCS Stream Upload', duration, false);
            console.error(`[REQ:${requestId}] [GCS] ❌ Stream upload failed: ${error.message}`);
            reject(error);
        });
    });
};

/**
 * Generate signed URL for download
 * @param {string} gcsPath - Path in bucket
 * @param {number} expiresInMinutes - URL expiry time
 * @param {string} requestId - Request correlation ID
 * @returns {Promise<string>} Signed URL
 */
const getSignedUrl = async (gcsPath, expiresInMinutes = 15, requestId) => {
    const startTime = Date.now();
    const bucket = getBucket();

    if (!bucket) {
        throw new Error('GCS not configured');
    }

    try {
        console.log(`[REQ:${requestId}] [GCS] Generating signed URL for ${gcsPath}`);

        const file = bucket.file(gcsPath);

        const [url] = await file.getSignedUrl({
            action: 'read',
            expires: Date.now() + expiresInMinutes * 60 * 1000
        });

        const duration = Date.now() - startTime;
        logTiming(requestId, 'GCS Signed URL', duration, true);

        console.log(`[REQ:${requestId}] [GCS] ✅ Signed URL generated (expires: ${expiresInMinutes}min)`);

        return url;
    } catch (error) {
        const duration = Date.now() - startTime;
        logTiming(requestId, 'GCS Signed URL', duration, false);

        console.error(`[REQ:${requestId}] [GCS] ❌ Signed URL failed: ${error.message}`);
        throw error;
    }
};

/**
 * Download file from GCS
 * @param {string} gcsPath - Path in bucket
 * @param {string} requestId - Request correlation ID
 * @returns {Promise<Buffer>} File content
 */
const downloadBuffer = async (gcsPath, requestId) => {
    const startTime = Date.now();
    const bucket = getBucket();

    if (!bucket) {
        throw new Error('GCS not configured');
    }

    try {
        console.log(`[REQ:${requestId}] [GCS] Downloading ${gcsPath}`);

        const file = bucket.file(gcsPath);
        const [buffer] = await file.download();

        const duration = Date.now() - startTime;
        logTiming(requestId, 'GCS Download', duration, true);

        console.log(`[REQ:${requestId}] [GCS] ✅ Downloaded (${buffer.length} bytes)`);

        return buffer;
    } catch (error) {
        const duration = Date.now() - startTime;
        logTiming(requestId, 'GCS Download', duration, false);

        console.error(`[REQ:${requestId}] [GCS] ❌ Download failed: ${error.message}`);
        throw error;
    }
};

/**
 * Generate unique GCS path for a document
 * @param {number} userId - User ID
 * @param {string} filename - Original filename
 * @param {string} prefix - Path prefix (e.g., 'originals', 'drafts')
 * @returns {string} GCS path
 */
const generateGcsPath = (userId, filename, prefix = 'drafts') => {
    const timestamp = Date.now();
    const uuid = uuidv4().substring(0, 8);
    const safeName = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    return `${prefix}/${userId}/${timestamp}-${uuid}-${safeName}`;
};

/**
 * Delete file from GCS
 * @param {string} gcsPath - Path in bucket
 * @returns {Promise<boolean>} Success status
 */
const deleteFile = async (gcsPath) => {
    // Skip if path is null/empty (e.g., Zoho-only documents)
    if (!gcsPath) return true;

    const bucket = getBucket();
    if (!bucket) {
        console.error('[GCS] Delete skipped: GCS not configured');
        return false;
    }

    try {
        console.log(`[GCS] Deleting file: ${gcsPath}`);
        const file = bucket.file(gcsPath);

        // Check if exists first to avoid 404 error
        const [exists] = await file.exists();
        if (!exists) {
            console.warn(`[GCS] Delete skipped: File not found ${gcsPath}`);
            return true;
        }

        await file.delete();
        console.log(`[GCS] ✅ File deleted: ${gcsPath}`);
        return true;
    } catch (error) {
        console.error(`[GCS] ❌ Delete failed: ${error.message}`);
        // Don't throw, just return false, so DB delete can proceed
        return false;
    }
};

module.exports = {
    uploadBuffer,
    uploadStream,
    getSignedUrl,
    downloadBuffer,
    generateGcsPath,
    deleteFile // ✅ NEW
};
