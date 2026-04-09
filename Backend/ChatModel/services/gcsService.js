const { getBucket } = require('../config/gcs');
const path = require('path');

async function uploadFileToGCS(bucketName, gcsFilePath, fileBuffer, mimeType) {
    if (!bucketName || !gcsFilePath || !fileBuffer) {
        throw new Error("Missing GCS service parameters. Required: bucketName, gcsFilePath, fileBuffer");
    }

    try {
        if (!Buffer.isBuffer(fileBuffer)) {
            throw new Error('fileBuffer must be a Buffer object');
        }

        console.log(`📤 Initializing GCS upload: ${bucketName}/${gcsFilePath}`);
        
        const bucket = getBucket(bucketName);
        
        const [bucketExists] = await bucket.exists();
        if (!bucketExists) {
            throw new Error(`Bucket '${bucketName}' does not exist or you don't have access to it`);
        }

        const file = bucket.file(gcsFilePath);
        
        console.log(`📤 Uploading file to GCS...`);
        await file.save(fileBuffer, {
            resumable: false,
            metadata: {
                contentType: mimeType || 'application/octet-stream',
                cacheControl: 'private, max-age=3600',
            },
        });

        const gcsUri = `gs://${bucketName}/${gcsFilePath}`;
        console.log(`✅ Successfully uploaded to ${gcsUri}`);
        
        return gcsUri;
    } catch (error) {
        console.error('❌ GCS Upload error:', error.message);
        console.error('❌ Error stack:', error.stack);
        
        if (error.message.includes('invalid_grant') || error.message.includes('JWT') || error.message.includes('Token')) {
            throw new Error(
                `GCS Authentication failed: Invalid or expired service account key. ` +
                `Please check: 1) Service account key is valid and not expired, 2) System clock is synchronized, ` +
                `3) GCS_KEY_BASE64 is correctly base64 encoded. ` +
                `Try regenerating the service account key in GCP Console. ` +
                `Original error: ${error.message}`
            );
        } else if (error.message.includes('permission') || error.message.includes('access') || error.message.includes('denied')) {
            throw new Error(
                `GCS Permission denied: Service account does not have permission to upload to bucket '${bucketName}'. ` +
                `Please check IAM permissions. The service account needs 'Storage Object Admin' or 'Storage Admin' role. ` +
                `Original error: ${error.message}`
            );
        } else if (error.message.includes('not initialized')) {
            throw new Error(
                `GCS Storage client not initialized. Please check GCS_KEY_BASE64 in .env file. ` +
                `Original error: ${error.message}`
            );
        } else {
            throw new Error(`GCS Upload failed: ${error.message}`);
        }
    }
}

async function createSignedUploadUrl(bucketName, gcsFilePath, mimeType, expiresInSeconds = 15 * 60) {
    if (!bucketName || !gcsFilePath) {
        throw new Error("Missing required params. Required: bucketName, gcsFilePath");
    }

    const bucket = getBucket(bucketName);
    const file = bucket.file(gcsFilePath);
    const contentType = mimeType || 'application/octet-stream';
    const expires = Date.now() + Math.max(60, Number(expiresInSeconds) || 900) * 1000;

    const [signedUrl] = await file.getSignedUrl({
        version: 'v4',
        action: 'write',
        expires,
        contentType,
    });

    return {
        signedUrl,
        expiresAt: new Date(expires).toISOString(),
        contentType,
    };
}

async function getObjectMetadata(bucketName, gcsFilePath) {
    const bucket = getBucket(bucketName);
    const file = bucket.file(gcsFilePath);
    const [exists] = await file.exists();
    if (!exists) {
        return null;
    }
    const [metadata] = await file.getMetadata();
    return metadata;
}

async function downloadObjectBuffer(bucketName, gcsFilePath) {
    const bucket = getBucket(bucketName);
    const file = bucket.file(gcsFilePath);
    const [buffer] = await file.download();
    return buffer;
}

async function deleteObjectIfExists(bucketName, gcsFilePath) {
    try {
        const bucket = getBucket(bucketName);
        const file = bucket.file(gcsFilePath);
        await file.delete({ ignoreNotFound: true });
    } catch (error) {
        console.warn(`[GCS] Could not delete object ${bucketName}/${gcsFilePath}: ${error.message}`);
    }
}

module.exports = {
    uploadFileToGCS,
    createSignedUploadUrl,
    getObjectMetadata,
    downloadObjectBuffer,
    deleteObjectIfExists,
};
