const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticateToken } = require('../middleware/auth.js');

// Public routes
router.get('/signin', authController.signIn);
router.get('/callback', authController.callback);

// Protected routes
// Status can work without auth (returns isConnected: false if no token)
router.get('/status', authController.getStatus);
router.post('/disconnect', authenticateToken, authController.disconnect);

module.exports = router;
