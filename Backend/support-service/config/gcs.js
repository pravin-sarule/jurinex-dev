const fs = require("fs");
const path = require("path");
const { Storage } = require("@google-cloud/storage");

function loadCredentials() {
  if (process.env.SUPPORT_GCS_KEY_BASE64 || process.env.GCS_KEY_BASE64) {
    const encoded = process.env.SUPPORT_GCS_KEY_BASE64 || process.env.GCS_KEY_BASE64;
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf-8"));
  }

  const localKeyPath = path.join(__dirname, "..", "gcs-key.json");
  if (fs.existsSync(localKeyPath)) {
    return require(localKeyPath);
  }

  return null;
}

const bucketName =
  process.env.SUPPORT_GCS_BUCKET_NAME ||
  process.env.GCS_SUPPORT_BUCKET_NAME ||
  process.env.GCS_BUCKET_NAME ||
  "";

const credentials = loadCredentials();
const storage =
  credentials && bucketName
    ? new Storage({ credentials })
    : bucketName
      ? new Storage()
      : null;

const bucket = storage && bucketName ? storage.bucket(bucketName) : null;

module.exports = {
  storage,
  bucket,
  bucketName,
};
