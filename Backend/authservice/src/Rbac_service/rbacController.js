const User = require('../models/User');
const Firm = require('../models/Firm');
const FirmUser = require('../models/FirmUser');
const { sendCreatePasswordEmail } = require('../services/otpService');
const pool = require('../config/db');
const {
  normalizePermissions,
  summarizePermissions,
  getPermissionsByUserId,
  getFirmUserCapabilities,
  canReadPermissions,
  canManagePermissions,
} = require('./rbacUtils');

const FULL_ACCESS_PERMISSIONS = {
  view_account_settings: 'Allowed',
  create_new_cases: 'Allowed',
  delete_cases: 'Allowed',
  edit_case_information: 'Allowed',
  view_case_information: 'Allowed',
  read_chat_messages: 'Allowed',
  send_chat_messages: 'Allowed',
  upload_documents_in_chat: 'Allowed',
  view_dashboard: 'Allowed',
  delete_documents: 'Allowed',
  edit_documents: 'Allowed',
  share_documents: 'Allowed',
  upload_documents: 'Allowed',
  view_documents: 'Allowed',
  create_custom_roles: 'Allowed',
  delete_roles: 'Allowed',
  view_roles: 'Allowed',
  update_roles: 'Allowed',
  view_tenant_information: 'Allowed',
  update_tenant_settings: 'Allowed',
  manage_tenant_users: 'Allowed',
  create_new_users: 'Allowed',
  view_user_information: 'Allowed',
  update_user_information: 'Allowed',
  delete_users: 'Allowed',
  assign_remove_roles_from_users: 'Allowed',
  manage_user_permissions: 'Allowed',
  delete_firm_users: 'Allowed',
  resend_password_setup_email: 'Allowed',
};

async function resolveFirmLifecycleTarget(actor, targetUserId, capabilityKey) {
  const actorUserId = Number(actor?.id);
  const normalizedTargetUserId = Number(targetUserId);

  if (!actorUserId || !normalizedTargetUserId) {
    return { status: 400, message: 'Invalid user id provided.' };
  }

  const capabilities = await getFirmUserCapabilities(actor);
  if (!capabilities?.firmId) {
    return { status: 403, message: 'Not authorized.' };
  }

  if (!capabilities.isFirmAdmin && !capabilities?.[capabilityKey]) {
    return { status: 403, message: 'You do not have permission to manage firm users.' };
  }

  const firm = capabilities.isFirmAdmin
    ? await Firm.findByAdminUserId(actorUserId)
    : await Firm.findById(capabilities.firmId);

  if (!firm?.id) {
    return { status: 404, message: 'Firm not found.' };
  }

  if (normalizedTargetUserId === actorUserId) {
    return { status: 403, message: 'You cannot perform this action on your own account.' };
  }

  if (Number(firm.admin_user_id) === normalizedTargetUserId) {
    return { status: 403, message: 'The firm admin account cannot be managed from this action.' };
  }

  const targetResult = await pool.query(
    `
      SELECT
        u.id,
        u.username,
        u.email,
        u.first_login,
        u.account_type,
        fu.role AS membership_role
      FROM users u
      JOIN firm_users fu ON fu.user_id = u.id
      WHERE fu.firm_id = $1
        AND u.id = $2
      LIMIT 1
    `,
    [firm.id, normalizedTargetUserId]
  );

  const targetUser = targetResult.rows[0];
  if (!targetUser) {
    return { status: 404, message: 'Target user not found in this firm.' };
  }

  return {
    capabilities,
    firm,
    targetUser,
  };
}

exports.createFirmUser = async (req, res) => {
  const { fullName, email, permissions } = req.body;
  const actorUserId = Number(req.user.id);

  try {
    const capabilities = await getFirmUserCapabilities(req.user);
    if (!capabilities.firmId || !capabilities.canCreateUsers) {
      return res.status(403).json({ success: false, message: 'You do not have permission to add users.' });
    }

    const firm = capabilities.isFirmAdmin
      ? await Firm.findByAdminUserId(actorUserId)
      : await Firm.findById(capabilities.firmId);
    if (!firm) return res.status(404).json({ success: false, message: 'Firm not found.' });

    const existingUser = await User.findByEmail(email);
    if (existingUser) return res.status(400).json({ success: false, message: 'User with this email already exists.' });

    const username = fullName || email.split('@')[0];

    // Create staff user without password
    const staffUser = await User.create({
      username,
      email,
      password: null, // User will set it via email link
      auth_type: 'manual',
      account_type: 'FIRM_USER',
      approval_status: 'APPROVED',
      first_login: true,
      is_active: true,
      phone: null
    });

    // Create firm_user relationship
    await FirmUser.create({ firm_id: firm.id, user_id: staffUser.id, role: 'STAFF' });

    // Store granular permissions
    const perms = normalizePermissions({
      delete_firm_users: 'Disabled',
      resend_password_setup_email: 'Disabled',
      ...(permissions || {}),
    });
    await pool.query(
      `INSERT INTO user_permissions (user_id, permissions) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET permissions = $2`,
      [staffUser.id, perms]
    );

    let emailSent = true;
    try {
      await sendCreatePasswordEmail(email, fullName || username);
    } catch (emailError) {
      emailSent = false;
      console.error('[RBAC] Error sending create-password email after user creation:', emailError);
    }

    res.status(201).json({
      success: true,
      message: emailSent
        ? 'Firm user created. Create-password email sent.'
        : 'Firm user created, but the create-password email could not be sent. You can resend it from User Management.',
      emailSent,
      user: { id: staffUser.id, username, email }
    });
  } catch (error) {
    console.error('[RBAC] Error creating user:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.getFirmUsers = async (req, res) => {
  const actorUserId = Number(req.user.id);
  try {
    const capabilities = await getFirmUserCapabilities(req.user);
    if (!capabilities.firmId) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    if (capabilities.isFirmAdmin) {
      const adminFirm = await Firm.findByAdminUserId(actorUserId);
      const query = `
        SELECT
          u.id,
          u.username,
          u.email,
          u.first_login,
          u.is_active,
          u.account_type,
          fu.role AS membership_role,
          COALESCE(up.permissions, '{}'::jsonb) AS permissions,
          false AS is_self,
          false AS is_firm_admin
        FROM users u
        JOIN firm_users fu ON u.id = fu.user_id
        LEFT JOIN user_permissions up ON u.id = up.user_id
        WHERE fu.firm_id = $1
          AND u.id <> $2
        ORDER BY COALESCE(fu.created_at, u.created_at) DESC, u.username ASC
      `;
      const result = await pool.query(query, [adminFirm.id, actorUserId]);
      return res.status(200).json({
        success: true,
        users: result.rows,
        capabilities,
        viewerMode: 'admin',
      });
    }

    const canBrowseFirmUsers =
      capabilities.canCreateUsers
      || capabilities.canViewUserInformation
      || capabilities.canUpdateUserInformation
      || capabilities.canDeleteUsers
      || capabilities.canAssignRemoveRoles
      || capabilities.canManageUserPermissions
      || capabilities.canDeleteFirmUsers
      || capabilities.canResendPasswordSetupEmail
      || capabilities.canCreateRoles
      || capabilities.canDeleteRoles
      || capabilities.canViewRoles
      || capabilities.canUpdateRoles;

    const directoryQuery = `
      SELECT
        u.id,
        u.username,
        u.email,
        u.first_login,
        u.is_active,
        u.account_type,
        CASE
          WHEN u.id = f.admin_user_id THEN 'ADMIN'
          ELSE COALESCE(fu.role, 'STAFF')
        END AS membership_role,
        COALESCE(up.permissions, '{}'::jsonb) AS permissions,
        (u.id = $2) AS is_self,
        (u.id = f.admin_user_id) AS is_firm_admin
      FROM firms f
      JOIN users u
        ON (
          u.id = f.admin_user_id
          OR EXISTS (
            SELECT 1
            FROM firm_users fu_member
            WHERE fu_member.firm_id = f.id
              AND fu_member.user_id = u.id
          )
        )
      LEFT JOIN firm_users fu
        ON fu.firm_id = f.id
       AND fu.user_id = u.id
      LEFT JOIN user_permissions up ON up.user_id = u.id
      WHERE f.id = $1
      ORDER BY (u.id = f.admin_user_id) DESC, (u.id = $2) DESC, u.username ASC
    `;

    const overviewQuery = `
      SELECT
        u.id,
        u.username,
        u.email,
        u.first_login,
        u.is_active,
        u.account_type,
        CASE
          WHEN u.id = f.admin_user_id THEN 'ADMIN'
          ELSE COALESCE(fu.role, 'STAFF')
        END AS membership_role,
        COALESCE(up.permissions, '{}'::jsonb) AS permissions,
        (u.id = $2) AS is_self,
        (u.id = f.admin_user_id) AS is_firm_admin
      FROM firms f
      JOIN users u ON u.id IN (f.admin_user_id, $2)
      LEFT JOIN firm_users fu
        ON fu.firm_id = f.id
       AND fu.user_id = u.id
      LEFT JOIN user_permissions up ON up.user_id = u.id
      WHERE f.id = $1
      ORDER BY (u.id = f.admin_user_id) DESC, (u.id = $2) DESC
    `;
    const result = await pool.query(
      canBrowseFirmUsers ? directoryQuery : overviewQuery,
      [capabilities.firmId, actorUserId]
    );
    const users = result.rows.map((row) => ({
      ...row,
      permissions: row.is_firm_admin
        ? { ...FULL_ACCESS_PERMISSIONS }
        : normalizePermissions(row.permissions),
    }));

    return res.status(200).json({
      success: true,
      users,
      capabilities,
      viewerMode: capabilities.canManageUserPermissions
        ? 'member_manage_permissions'
        : canBrowseFirmUsers
          ? 'member_directory_read_only'
          : 'read_only',
    });
  } catch (error) {
    console.error('[RBAC] Error fetching users:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.getUserPermissions = async (req, res) => {
  const { userId } = req.params;
  try {
    const allowed = await canReadPermissions(req.user, userId);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Not authorized to view these permissions.' });
    }

    const permissions = await getPermissionsByUserId(userId);
    res.status(200).json({ success: true, permissions });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.getCurrentUserPermissions = async (req, res) => {
  try {
    const permissions = await getPermissionsByUserId(req.user.id);
    res.status(200).json({ success: true, permissions });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.updateUserPermissions = async (req, res) => {
  const { userId } = req.params;
  const { permissions } = req.body;
  const requestId = `rbac-perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const normalizedPermissions = normalizePermissions(permissions);
    const capabilities = await getFirmUserCapabilities(req.user);
    console.log('[RBAC][PermissionUpdate] Request received', {
      requestId,
      actorId: req.user?.id || null,
      actorEmail: req.user?.email || null,
      actorAccountType: req.user?.account_type || null,
      targetUserId: Number(userId) || null,
      actorCapabilities: capabilities,
      permissionSummary: summarizePermissions(normalizedPermissions),
      permissionKeys: Object.keys(normalizedPermissions),
    });

    let allowed = await canManagePermissions(req.user, userId);
    let fallbackFirmId = null;

    if (!allowed) {
      const firm = capabilities?.firmId
        ? await Firm.findById(capabilities.firmId)
        : await Firm.findByAdminUserId(req.user.id);
      fallbackFirmId = firm?.id || null;

      if (fallbackFirmId) {
        const membershipResult = await pool.query(
          'SELECT 1 FROM firm_users WHERE firm_id = $1 AND user_id = $2 LIMIT 1',
          [fallbackFirmId, Number(userId)]
        );
        allowed = membershipResult.rows.length > 0;

        console.log('[RBAC][PermissionUpdate] Fallback membership check', {
          requestId,
          actorId: req.user?.id || null,
          fallbackFirmId,
          targetUserId: Number(userId) || null,
          allowed,
        });
      }
    }

    if (!allowed) {
      console.log('[RBAC][PermissionUpdate] Request forbidden', {
        requestId,
        actorId: req.user?.id || null,
        targetUserId: Number(userId) || null,
        fallbackFirmId,
      });
      return res.status(403).json({ success: false, message: 'Only the firm admin can update these permissions.' });
    }

    await pool.query(
      `INSERT INTO user_permissions (user_id, permissions) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET permissions = $2`,
      [userId, normalizedPermissions]
    );

    console.log('[RBAC][PermissionUpdate] Request succeeded', {
      requestId,
      actorId: req.user?.id || null,
      targetUserId: Number(userId) || null,
      permissionSummary: summarizePermissions(normalizedPermissions),
    });
    res.status(200).json({ success: true, message: 'Permissions updated.' });
  } catch (error) {
    console.error('[RBAC][PermissionUpdate] Request failed', {
      requestId,
      actorId: req.user?.id || null,
      targetUserId: Number(userId) || null,
      errorMessage: error.message,
      errorStack: error.stack,
    });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.resendFirmUserPasswordSetupEmail = async (req, res) => {
  try {
    const { userId } = req.params;
    const resolved = await resolveFirmLifecycleTarget(req.user, userId, 'canResendPasswordSetupEmail');

    if (resolved.status) {
      return res.status(resolved.status).json({ success: false, message: resolved.message });
    }

    const { targetUser } = resolved;
    if (!targetUser.first_login) {
      return res.status(400).json({
        success: false,
        message: 'This user has already created a password. Resend is only available before first login.',
      });
    }

    await sendCreatePasswordEmail(targetUser.email, targetUser.username);

    return res.status(200).json({
      success: true,
      message: 'Create-password email resent successfully.',
    });
  } catch (error) {
    console.error('[RBAC] Error resending create-password email:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.deleteFirmUser = async (req, res) => {
  const client = await pool.connect();
  try {
    const { userId } = req.params;
    const resolved = await resolveFirmLifecycleTarget(req.user, userId, 'canDeleteFirmUsers');

    if (resolved.status) {
      return res.status(resolved.status).json({ success: false, message: resolved.message });
    }

    const { firm, targetUser } = resolved;

    await client.query('BEGIN');
    await client.query('DELETE FROM user_permissions WHERE user_id = $1', [targetUser.id]);
    await client.query('DELETE FROM user_sessions WHERE user_id = $1', [targetUser.id]);
    await client.query('DELETE FROM otps WHERE email = $1', [targetUser.email]);
    await client.query('DELETE FROM firm_users WHERE firm_id = $1 AND user_id = $2', [firm.id, targetUser.id]);
    await client.query('DELETE FROM users WHERE id = $1', [targetUser.id]);
    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: 'Firm user deleted successfully.',
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[RBAC] Error deleting firm user:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  } finally {
    client.release();
  }
};
