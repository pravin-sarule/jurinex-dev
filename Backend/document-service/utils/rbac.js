const axios = require('axios');

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:5001';

function normalizePermissions(permissions = {}) {
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) {
    return {};
  }
  return permissions;
}

function isPermissionAllowed(permissions, permissionKey) {
  const value = normalizePermissions(permissions)[permissionKey];

  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.trim().toLowerCase() !== 'disabled';
  }

  return true;
}

async function fetchUserPermissions(userId) {
  const response = await axios.get(
    `${AUTH_SERVICE_URL}/api/auth/internal/user/${userId}/permissions`,
    { timeout: 3000 }
  );
  return normalizePermissions(response.data?.permissions);
}

async function ensureUserPermission(req, permissionKey, deniedMessage) {
  const userId = parseInt(req.user?.id, 10);
  if (!userId) {
    return { allowed: false, status: 401, message: 'Unauthorized user' };
  }

  const accountType = String(req.user?.account_type || '').toUpperCase();
  if (accountType === 'FIRM_ADMIN' || accountType === 'SOLO') {
    return { allowed: true };
  }

  if (accountType !== 'FIRM_USER') {
    return { allowed: true };
  }

  try {
    const permissions = await fetchUserPermissions(userId);
    req.user.permissions = permissions;

    if (!isPermissionAllowed(permissions, permissionKey)) {
      return {
        allowed: false,
        status: 403,
        message: deniedMessage || 'You do not have permission to perform this action.',
      };
    }

    return { allowed: true };
  } catch (error) {
    console.error(`[RBAC] Failed to verify permission "${permissionKey}" for user ${userId}:`, error.message);
    return {
      allowed: false,
      status: 503,
      message: 'Unable to verify your permissions right now. Please try again.',
    };
  }
}

module.exports = {
  isPermissionAllowed,
  ensureUserPermission,
};
