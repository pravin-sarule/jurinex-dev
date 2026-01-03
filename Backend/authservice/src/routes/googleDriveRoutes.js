const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  initiateAuth,
  handleCallbackGet,
  handleCallbackPost,
  getConnectionStatus,
  getAccessToken,
  disconnect
} = require('../controllers/googleDriveController');

// Initiate Google Drive OAuth flow
router.get('/google/drive', protect, initiateAuth);

// Handle OAuth callback (GET from Google redirect, POST from frontend)
// Support both /google/callback and /google/drive/callback for flexibility
// Also handle trailing slashes
router.get('/google/callback', handleCallbackGet);
router.get('/google/callback/', handleCallbackGet);
router.get('/google/drive/callback', handleCallbackGet);
router.get('/google/drive/callback/', handleCallbackGet);
router.post('/google/drive/callback', protect, handleCallbackPost);

// Check connection status
router.get('/google/drive/status', protect, getConnectionStatus);

// Get fresh access token
router.get('/google/drive/token', protect, getAccessToken);

// Disconnect Google Drive
router.delete('/google/drive', protect, disconnect);

module.exports = router;
