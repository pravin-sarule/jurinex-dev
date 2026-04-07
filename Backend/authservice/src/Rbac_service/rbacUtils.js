const pool = require('../config/db');

const FIRM_PERMISSION_KEYS = {
  CREATE_USERS: 'create_new_users',
  VIEW_USER_INFORMATION: 'view_user_information',
  UPDATE_USER_INFORMATION: 'update_user_information',
  DELETE_USERS: 'delete_users',
  ASSIGN_REMOVE_ROLES: 'assign_remove_roles_from_users',
  MANAGE_USER_PERMISSIONS: 'manage_user_permissions',
  VIEW_CASE_INFORMATION: 'view_case_information',
  DELETE_FIRM_USERS: 'delete_firm_users',
  RESEND_PASSWORD_SETUP_EMAIL: 'resend_password_setup_email',
  CREATE_CUSTOM_ROLES: 'create_custom_roles',
  DELETE_ROLES: 'delete_roles',
  VIEW_ROLES: 'view_roles',
  UPDATE_ROLES: 'update_roles',
};

function normalizePermissions(permissions = {}) {
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) {
    return {};
  }
  return permissions;
}

function summarizePermissions(permissions = {}) {
  const normalized = normalizePermissions(permissions);
  const entries = Object.entries(normalized);
  const allowed = entries.filter(([, value]) => String(value).trim().toLowerCase() !== 'disabled').map(([key]) => key);
  const disabled = entries.filter(([, value]) => String(value).trim().toLowerCase() === 'disabled').map(([key]) => key);

  return {
    totalKeys: entries.length,
    allowedCount: allowed.length,
    disabledCount: disabled.length,
    disabledKeys: disabled,
  };
}

async function getPermissionsByUserId(userId) {
  const result = await pool.query(
    'SELECT permissions FROM user_permissions WHERE user_id = $1',
    [userId]
  );
  return normalizePermissions(result.rows[0]?.permissions);
}

function isPermissionAllowed(permissions = {}, permissionKey) {
  const value = permissions?.[permissionKey];

  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return String(value).trim().toLowerCase() !== 'disabled';
  }

  return true;
}

function isPermissionExplicitlyAllowed(permissions = {}, permissionKey) {
  const value = permissions?.[permissionKey];

  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return String(value).trim().toLowerCase() === 'allowed';
  }

  return false;
}

async function getFirmScopeForUser(user) {
  if (!user?.id) return null;

  const actorId = Number(user.id);
  if (!actorId) return null;

  // Treat the user as firm admin whenever they actually own a firm in DB,
  // even if their account_type is stale or incorrect.
  const firmResult = await pool.query(
    'SELECT id FROM firms WHERE admin_user_id = $1 LIMIT 1',
    [actorId]
  );
  const firm = firmResult.rows[0];
  if (firm?.id) {
    return {
      firmId: firm.id,
      isFirmAdmin: true,
    };
  }

  const accountType = String(user.account_type || '').trim().toUpperCase();
  if (accountType === 'FIRM_ADMIN') {
    return null;
  }

  const firmUserResult = await pool.query(
    'SELECT firm_id FROM firm_users WHERE user_id = $1 LIMIT 1',
    [actorId]
  );
  const firmUser = firmUserResult.rows[0];
  if (!firmUser?.firm_id) return null;

  return {
    firmId: firmUser.firm_id,
    isFirmAdmin: false,
  };
}

async function isUserInFirm(firmId, userId) {
  if (!firmId || !userId) return false;

  const normalizedFirmId = Number(firmId);
  const normalizedUserId = Number(userId);
  if (!normalizedFirmId || !normalizedUserId) return false;

  const membershipResult = await pool.query(
    'SELECT 1 FROM firm_users WHERE firm_id = $1 AND user_id = $2 LIMIT 1',
    [normalizedFirmId, normalizedUserId]
  );
  if (membershipResult.rows.length > 0) {
    return true;
  }

  const adminFirmResult = await pool.query(
    'SELECT 1 FROM firms WHERE id = $1 AND admin_user_id = $2 LIMIT 1',
    [normalizedFirmId, normalizedUserId]
  );
  return adminFirmResult.rows.length > 0;
}

async function isFirmAdminForFirm(firmId, userId) {
  if (!firmId || !userId) return false;

  const result = await pool.query(
    'SELECT 1 FROM firms WHERE id = $1 AND admin_user_id = $2 LIMIT 1',
    [Number(firmId), Number(userId)]
  );
  return result.rows.length > 0;
}

async function canUseFirmPermission(actor, permissionKey) {
  const actorId = Number(actor?.id);
  if (!actorId || !permissionKey) return false;

  const scope = await getFirmScopeForUser(actor);
  if (!scope?.firmId) return false;
  if (scope.isFirmAdmin) return true;

  const actorPermissions = await getPermissionsByUserId(actorId);
  return isPermissionAllowed(actorPermissions, permissionKey);
}

async function getFirmUserCapabilities(actor) {
  const scope = await getFirmScopeForUser(actor);
  if (!scope?.firmId) {
    return {
      firmId: null,
      isFirmAdmin: false,
      canCreateUsers: false,
      canViewUserInformation: false,
      canUpdateUserInformation: false,
      canDeleteUsers: false,
      canAssignRemoveRoles: false,
      canManageUserPermissions: false,
      canViewCaseInformation: false,
      canManageCaseAssignments: false,
      canDeleteFirmUsers: false,
      canResendPasswordSetupEmail: false,
      canCreateRoles: false,
      canDeleteRoles: false,
      canViewRoles: false,
      canUpdateRoles: false,
    };
  }

  if (scope.isFirmAdmin) {
    return {
      firmId: scope.firmId,
      isFirmAdmin: true,
      canCreateUsers: true,
      canViewUserInformation: true,
      canUpdateUserInformation: true,
      canDeleteUsers: true,
      canAssignRemoveRoles: true,
      canManageUserPermissions: true,
      canViewCaseInformation: true,
      canManageCaseAssignments: true,
      canDeleteFirmUsers: true,
      canResendPasswordSetupEmail: true,
      canCreateRoles: true,
      canDeleteRoles: true,
      canViewRoles: true,
      canUpdateRoles: true,
    };
  }

  const permissions = await getPermissionsByUserId(actor.id);
  const canManageUserPermissions = isPermissionAllowed(permissions, FIRM_PERMISSION_KEYS.MANAGE_USER_PERMISSIONS);
  const canViewCaseInformation = isPermissionAllowed(permissions, FIRM_PERMISSION_KEYS.VIEW_CASE_INFORMATION);

  return {
    firmId: scope.firmId,
    isFirmAdmin: false,
    canCreateUsers: isPermissionAllowed(permissions, FIRM_PERMISSION_KEYS.CREATE_USERS),
    canViewUserInformation: isPermissionAllowed(permissions, FIRM_PERMISSION_KEYS.VIEW_USER_INFORMATION),
    canUpdateUserInformation: isPermissionAllowed(permissions, FIRM_PERMISSION_KEYS.UPDATE_USER_INFORMATION),
    canDeleteUsers: isPermissionAllowed(permissions, FIRM_PERMISSION_KEYS.DELETE_USERS),
    canAssignRemoveRoles: isPermissionAllowed(permissions, FIRM_PERMISSION_KEYS.ASSIGN_REMOVE_ROLES),
    canManageUserPermissions,
    canViewCaseInformation,
    canManageCaseAssignments: canManageUserPermissions && canViewCaseInformation,
    canDeleteFirmUsers: isPermissionExplicitlyAllowed(permissions, FIRM_PERMISSION_KEYS.DELETE_FIRM_USERS),
    canResendPasswordSetupEmail: isPermissionExplicitlyAllowed(permissions, FIRM_PERMISSION_KEYS.RESEND_PASSWORD_SETUP_EMAIL),
    canCreateRoles: isPermissionAllowed(permissions, FIRM_PERMISSION_KEYS.CREATE_CUSTOM_ROLES),
    canDeleteRoles: isPermissionAllowed(permissions, FIRM_PERMISSION_KEYS.DELETE_ROLES),
    canViewRoles: isPermissionAllowed(permissions, FIRM_PERMISSION_KEYS.VIEW_ROLES),
    canUpdateRoles: isPermissionAllowed(permissions, FIRM_PERMISSION_KEYS.UPDATE_ROLES),
  };
}

async function canReadPermissions(actor, targetUserId) {
  const actorId = Number(actor?.id);
  const normalizedTargetUserId = Number(targetUserId);

  if (!actorId || !normalizedTargetUserId) return false;
  if (actorId === normalizedTargetUserId) return true;

  const capabilities = await getFirmUserCapabilities(actor);
  if (!capabilities.firmId) return false;
  if (!capabilities.isFirmAdmin && !capabilities.canManageUserPermissions && !capabilities.canViewUserInformation) {
    return false;
  }

  return isUserInFirm(capabilities.firmId, normalizedTargetUserId);
}

async function canManagePermissions(actor, targetUserId) {
  const normalizedTargetUserId = Number(targetUserId);
  if (!normalizedTargetUserId) return false;

  const capabilities = await getFirmUserCapabilities(actor);
  const actorId = Number(actor?.id) || null;
  const firmId = capabilities?.firmId ? Number(capabilities.firmId) : null;

  if (!capabilities.firmId || !capabilities.isFirmAdmin && !capabilities.canManageUserPermissions) {
    console.log('[RBAC][PermissionUpdate] Authorization denied before membership check', {
      actorId,
      actorAccountType: actor?.account_type || null,
      firmId,
      targetUserId: normalizedTargetUserId,
      isFirmAdmin: !!capabilities?.isFirmAdmin,
      canManageUserPermissions: !!capabilities?.canManageUserPermissions,
    });
    return false;
  }

  const inSameFirm = await isUserInFirm(capabilities.firmId, normalizedTargetUserId);
  const targetIsFirmAdmin = inSameFirm
    ? await isFirmAdminForFirm(capabilities.firmId, normalizedTargetUserId)
    : false;

  console.log('[RBAC][PermissionUpdate] Authorization check', {
    actorId,
    actorAccountType: actor?.account_type || null,
    firmId,
    targetUserId: normalizedTargetUserId,
    isFirmAdmin: !!capabilities.isFirmAdmin,
    canManageUserPermissions: !!capabilities.canManageUserPermissions,
    inSameFirm,
    targetIsFirmAdmin,
  });

  if (!inSameFirm) return false;
  if (!capabilities.isFirmAdmin && targetIsFirmAdmin) return false;

  return true;
}

module.exports = {
  FIRM_PERMISSION_KEYS,
  normalizePermissions,
  summarizePermissions,
  getPermissionsByUserId,
  isPermissionAllowed,
  canUseFirmPermission,
  getFirmUserCapabilities,
  canReadPermissions,
  canManagePermissions,
  getFirmScopeForUser,
};
