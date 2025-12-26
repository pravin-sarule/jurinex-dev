const { bucket, fileInputBucket } = require("../config/gcs");
const path = require("path");

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
    destination = filenameOrPath;
  } else {
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

exports.getSignedUrl = async (gcsPath, expiresInSeconds = 300) => {
  const file = bucket.file(gcsPath);

  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + expiresInSeconds * 1000,
  });

  return url;
};
