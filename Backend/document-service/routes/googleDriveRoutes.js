const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const {
  downloadFromGoogleDrive,
  downloadMultipleFromGoogleDrive,
  getGoogleDriveFileInfo
} = require('../controllers/googleDriveController');

// Download single file from Google Drive
router.post('/google-drive/download', authMiddleware.protect, downloadFromGoogleDrive);

// Download multiple files from Google Drive
router.post('/google-drive/download-multiple', authMiddleware.protect, downloadMultipleFromGoogleDrive);

// Get file info from Google Drive
router.get('/google-drive/info/:fileId', authMiddleware.protect, getGoogleDriveFileInfo);

module.exports = router;



