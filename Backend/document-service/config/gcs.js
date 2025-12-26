const { Storage } = require('@google-cloud/storage');

let credentials;

if (process.env.GCS_KEY_BASE64) {
  const jsonString = Buffer.from(process.env.GCS_KEY_BASE64, 'base64').toString('utf-8');
  credentials = JSON.parse(jsonString);
} else {
  credentials = require('../gcs-key.json');
}

const storage = new Storage({ credentials });

const inputBucketName = process.env.GCS_INPUT_BUCKET_NAME;
const outputBucketName = process.env.GCS_OUTPUT_BUCKET_NAME;
const defaultBucketName = process.env.GCS_BUCKET_NAME || inputBucketName;

const bucket = storage.bucket(defaultBucketName);
const fileInputBucket = storage.bucket(inputBucketName);
const fileOutputBucket = storage.bucket(outputBucketName);

module.exports = {
  storage,
  credentials,
  bucket,
  fileInputBucket,
  fileOutputBucket,
};
