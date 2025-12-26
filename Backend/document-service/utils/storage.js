const { bucket } = require('../config/gcs');
const File = require('../models/File');
const db = require('../config/db'); // Import db for querying user subscriptions


const uploadFileToGCS = (file, userId, folderPath = '') => {
  return new Promise(async (resolve, reject) => {
    const gcsFileName = `${userId}/${folderPath ? folderPath + '/' : ''}${Date.now()}-${file.originalname}`;
    const blob = bucket.file(gcsFileName);
    const blobStream = blob.createWriteStream({
      resumable: false,
      metadata: {
        contentType: file.mimetype,
      },
    });

    blobStream.on('error', (err) => {
      console.error('GCS Upload Error:', err);
      reject(err);
    });

    blobStream.on('finish', async () => {
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
      try {
        const newFile = await File.create({
          user_id: userId,
          originalname: file.originalname,
          gcs_path: blob.name,
          folder_path: folderPath,
          mimetype: file.mimetype,
          size: file.size,
        });
        resolve(newFile);
      } catch (dbError) {
        console.error('Database Error after GCS upload:', dbError);
        await blob.delete().catch(console.error);
        reject(dbError);
      }
    });

    blobStream.end(file.buffer);
  });
};

const checkStorageLimit = async (userId, newFileSize = 0, userPlan) => { // NEW: Add userPlan parameter
  console.log(`DEBUG: checkStorageLimit function entered for user ${userId}, newFileSize: ${newFileSize}`);
  try {
    if (!userPlan || !userPlan.storage_limit_gb) {
      console.warn(`User ${userId} has no active plan or storage_limit_gb defined. Denying upload.`);
      return { allowed: false, message: "No active plan or storage limit defined." };
    }

    const storageLimitGB = userPlan.storage_limit_gb;
    const storageLimitBytes = parseFloat(storageLimitGB) * 1024 * 1024 * 1024; // Convert GB to Bytes, ensure float parsing
    console.log(`DEBUG: checkStorageLimit - Plan storageLimitGB: ${storageLimitGB}, converted to Bytes: ${storageLimitBytes}`);

    const totalUsed = await File.getTotalStorageUsed(userId);
    console.log(`DEBUG: checkStorageLimit - User ${userId} - Total Used: ${totalUsed} bytes, New File Size: ${newFileSize} bytes, Storage Limit: ${storageLimitGB} GB (${storageLimitBytes} bytes)`);

    const isAllowed = (totalUsed + newFileSize) <= storageLimitBytes;
    console.log(`DEBUG: checkStorageLimit - Is allowed: ${isAllowed} (Total Used + New File Size: ${totalUsed + newFileSize} vs Limit: ${storageLimitBytes})`);
    
    if (!isAllowed) {
      return { allowed: false, message: `Storage limit of ${storageLimitGB} GB exceeded.` };
    }

    return { allowed: true, message: "Storage limit check passed." };
  } catch (error) {
    console.error(`❌ Error in checkStorageLimit for user ${userId}:`, error);
    return { allowed: false, message: `Internal server error during storage check: ${error.message}` };
  }
};

const getSignedUrlForFile = async (gcsPath) => {
  const options = {
    version: 'v4',
    action: 'read',
    expires: Date.now() + 15 * 60 * 1000, // 15 minutes
  };

  const [url] = await bucket.file(gcsPath).getSignedUrl(options);
  return url;
};

module.exports = { uploadFileToGCS, checkStorageLimit, getSignedUrlForFile };