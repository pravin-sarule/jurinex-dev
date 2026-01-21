const { bucket, fileInputBucket } = require('../config/gcs');
const path = require('path');

exports.uploadToGCS = async (
  filename,
  buffer,
  folder = 'uploads',
  isBatch = false,
  mimetype = 'application/octet-stream'
) => {
  const targetBucket = isBatch ? fileInputBucket : bucket;
  const timestamp = Date.now();

  const safeFilename = filename.replace(/\s+/g, '_');
  const destination = path.posix.join(folder, `${timestamp}_${safeFilename}`);
  const file = targetBucket.file(destination);

  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: mimetype,
      cacheControl: 'public, max-age=31536000',
    },
  });

  return {
    gsUri: `gs://${targetBucket.name}/${destination}`,
    gcsPath: destination,
  };
};

exports.getSignedUrl = async (gcsPath, expiresInSeconds = 300) => {
  const file = bucket.file(gcsPath);

  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + expiresInSeconds * 1000,
  });

  return url;
};

exports.getSignedUploadUrl = async (gcsPath, contentType = 'application/octet-stream', expiresInMinutes = 15, useInputBucket = false) => {
  const targetBucket = useInputBucket ? fileInputBucket : bucket;
  const file = targetBucket.file(gcsPath);

  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + expiresInMinutes * 60 * 1000,
    contentType: contentType,
  });

  return url;
};

exports.deleteFromGCS = async (gcsPath, useInputBucket = false) => {
  const targetBucket = useInputBucket ? fileInputBucket : bucket;
  
  // Handle both gs:// URI and direct path
  let filePath = gcsPath;
  if (gcsPath.startsWith('gs://')) {
    const match = gcsPath.match(/^gs:\/\/([^\/]+)\/(.+)$/);
    if (match) {
      filePath = match[2]; // Extract path after bucket name
    }
  }
  
  const file = targetBucket.file(filePath);
  
  try {
    const [exists] = await file.exists();
    if (!exists) {
      console.warn(`[gcsService] File does not exist in GCS: ${filePath}`);
      return false;
    }
    
    await file.delete();
    console.log(`[gcsService] ✅ Deleted file from GCS: ${filePath}`);
    return true;
  } catch (error) {
    console.error(`[gcsService] ❌ Failed to delete file from GCS: ${filePath}`, error.message);
    throw error;
  }
};
