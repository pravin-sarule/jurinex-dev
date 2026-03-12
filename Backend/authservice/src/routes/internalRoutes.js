const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Firm = require('../models/Firm');
const FirmUser = require('../models/FirmUser');

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

/**
 * GET /api/auth/internal/user/:userId/account-type
 * Get user's account_type from DB (for document-service when JWT has old payload without account_type)
 */
router.get('/user/:userId/account-type', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const accountType = (user.account_type && String(user.account_type).trim())
      ? String(user.account_type).toUpperCase()
      : 'SOLO';
    res.json({ account_type: accountType });
  } catch (error) {
    console.error('[Internal] Error fetching user account-type:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/auth/internal/user/:userId/firm-member-ids
 * Returns list of user_ids that belong to the same firm as this user (for document-service: show all firm cases).
 * For solo users returns [userId]. For firm users returns all member user_ids of their firm.
 */
router.get('/user/:userId/firm-member-ids', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    let firmId = null;
    let firmAdminUserId = null;
    const firmByAdmin = await Firm.findByAdminUserId(userId);
    if (firmByAdmin) {
      firmId = firmByAdmin.id;
      firmAdminUserId = firmByAdmin.admin_user_id || userId;
    } else {
      const firmUserRow = await FirmUser.findByUserId(userId);
      if (firmUserRow) {
        firmId = firmUserRow.firm_id;
        const firm = await Firm.findById(firmId);
        firmAdminUserId = firm?.admin_user_id || null;
      }
    }
    if (!firmId) {
      return res.status(200).json({ user_ids: [userId] });
    }
    const rawIds = await FirmUser.getUserIdsByFirmId(firmId);
    const userIds = (rawIds || [])
      .map((id) => (typeof id === 'number' ? id : parseInt(id, 10)))
      .filter((n) => !isNaN(n));
    if (firmAdminUserId && !userIds.includes(firmAdminUserId)) {
      userIds.push(firmAdminUserId);
    }
    if (!userIds.length) {
      return res.status(200).json({ user_ids: [userId] });
    }
    res.status(200).json({ user_ids: userIds });
  } catch (error) {
    console.error('[Internal] Error fetching firm member ids:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/auth/internal/users/bulk?ids=1,2,42
 * Bulk lookup users by ID. Returns { users: [{ user_id, username, email, auth_type, role }] }.
 * Used by citation-service to resolve usernames/roles for activity user_ids not in firm-members.
 */
router.get('/users/bulk', async (req, res) => {
  try {
    const idsParam = req.query.ids || '';
    const ids = idsParam
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0);
    if (!ids.length) {
      return res.status(200).json({ users: [] });
    }
    const pool = require('../config/db');
    const result = await pool.query(
      'SELECT id, username, email, auth_type, account_type FROM users WHERE id = ANY($1::int[])',
      [ids]
    );
    const users = (result.rows || []).map((r) => ({
      user_id: r.id,
      username: r.username || r.email,
      email: r.email,
      auth_type: r.auth_type || 'manual',
      role: r.account_type || 'SOLO',
    }));
    res.status(200).json({ users });
  } catch (error) {
    console.error('[Internal] Error bulk fetching users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/auth/internal/user/:userId/firm-members
 * Returns list of firm members with id, email, username, auth_type, role for the same firm as this user.
 * Used by citation-service analytics to show username, auth type and role in the team activity table.
 * For solo users returns [{user_id, email, username, auth_type, role}] for just that user.
 */
router.get('/user/:userId/firm-members', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    let firmId = null;
    let firmAdminUserId = null;
    const firmByAdmin = await Firm.findByAdminUserId(userId);
    if (firmByAdmin) {
      firmId = firmByAdmin.id;
      firmAdminUserId = firmByAdmin.admin_user_id || userId;
    } else {
      const firmUserRow = await FirmUser.findByUserId(userId);
      if (firmUserRow) {
        firmId = firmUserRow.firm_id;
        const firm = await Firm.findById(firmId);
        firmAdminUserId = firm?.admin_user_id || null;
      }
    }
    if (!firmId) {
      // Solo user — return just this user's info
      const user = await User.findById(userId);
      if (!user) return res.status(200).json({ members: [] });
      return res.status(200).json({
        members: [{
          user_id: userId,
          email: user.email,
          username: user.username || user.email,
          auth_type: user.auth_type || 'manual',
          role: user.account_type || 'SOLO',
        }],
      });
    }
    // Firm members with email, username, auth_type, role via JOIN in FirmUser.findByFirmId
    const rows = await FirmUser.findByFirmId(firmId);
    const members = (rows || []).map(r => ({
      user_id: r.user_id,
      email: r.email,
      username: r.username || r.email,
      auth_type: r.auth_type || 'manual',
      role: r.account_type || r.role || 'STAFF',
    }));
    // Ensure firm admin is included
    if (firmAdminUserId && !members.find(m => m.user_id === firmAdminUserId)) {
      const admin = await User.findById(firmAdminUserId);
      if (admin) {
        members.push({
          user_id: firmAdminUserId,
          email: admin.email,
          username: admin.username || admin.email,
          auth_type: admin.auth_type || 'manual',
          role: 'ADMIN',
        });
      }
    }
    res.status(200).json({ members });
  } catch (error) {
    console.error('[Internal] Error fetching firm members:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
