const express = require('express');
const router = express.Router();
const User = require('../models/User');

/**
 * Internal Routes for Service-to-Service Communication
 * These routes are for internal microservice communication only
 * Should be protected by INTERNAL_SERVICE_TOKEN
 */

/**
 * GET /api/auth/internal/user/:userId/tokens
 * Get user's Google Drive tokens (internal use only)
 */
router.get('/user/:userId/tokens', async (req, res) => {
  try {
    // TODO: Add internal service token validation
    // const internalToken = req.headers['authorization']?.split(' ')[1];
    // if (internalToken !== process.env.INTERNAL_SERVICE_TOKEN) {
    //   return res.status(401).json({ error: 'Unauthorized' });
    // }

    const userId = parseInt(req.params.userId);
    
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Return only token-related data
    res.json({
      google_drive_refresh_token: user.google_drive_refresh_token,
      google_drive_token_expiry: user.google_drive_token_expiry,
      email: user.email
    });
  } catch (error) {
    console.error('[Internal] Error fetching user tokens:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

