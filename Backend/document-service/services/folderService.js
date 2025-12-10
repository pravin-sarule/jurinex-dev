const { bucket, fileInputBucket } = require("../config/gcs");
const path = require("path");

/**
 * Upload a file buffer to Google Cloud Storage
 *
 * @param {string} filenameOrPath - File name OR full object path
 * @param {Buffer} buffer - File buffer
 * @param {string|null} folder - Destination folder in GCS (ignored if full path provided)
 * @param {boolean} isBatch - If true, upload to fileInputBucket (for DocAI)
 * @param {string} mimetype - File MIME type
 * @param {boolean} rawKey - If true, use filenameOrPath as the full GCS object key
 * @returns {Promise<{ gsUri: string, gcsPath: string }>}
 */
exports.uploadToGCS = async (
  filenameOrPath,
  buffer,
  folder = "uploads",
  isBatch = false,
  mimetype = "application/octet-stream",
  rawKey = false
) => {
  const targetBucket = isBatch ? fileInputBucket : bucket;
  let destination;

  if (rawKey) {
    // ✅ Use provided string as full GCS key (for things like .keep files)
    destination = filenameOrPath;
  } else {
    // ✅ Default: put inside folder with timestamp
    const timestamp = Date.now();
    const safeFilename = filenameOrPath.replace(/\s+/g, "_");
    destination = path.posix.join(folder, `${timestamp}_${safeFilename}`);
  }

  const file = targetBucket.file(destination);

  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: mimetype,
      cacheControl: "public, max-age=31536000",
    },
  });

  return {
    gsUri: `gs://${targetBucket.name}/${destination}`,
    gcsPath: destination,
  };
};

/**
 * Generate a temporary signed URL for download
 *
 * @param {string} gcsPath - Path inside the main bucket
 * @param {number} expiresInSeconds - Expiry in seconds (default 5 min)
 * @returns {Promise<string>} Signed URL
 */
exports.getSignedUrl = async (gcsPath, expiresInSeconds = 300) => {
  const file = bucket.file(gcsPath);

  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + expiresInSeconds * 1000,
  });

  return url;
};
