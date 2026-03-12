const axios = require('axios');

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:5001';

/**
 * Returns all user_ids this request is allowed to see (firm members or just current user).
 * Always asks auth service for firm-member-ids so newly added firm users see firm cases
 * even if their JWT has wrong/missing account_type.
 */
async function getAllowedUserIds(req) {
  const userId = parseInt(req.user?.id, 10);
  if (!userId) return [];
  try {
    const res = await axios.get(
      `${AUTH_SERVICE_URL}/api/auth/internal/user/${userId}/firm-member-ids`,
      { timeout: 3000 }
    );
    const ids = res.data?.user_ids;
    if (Array.isArray(ids) && ids.length > 0) return ids.map((id) => parseInt(id, 10)).filter((n) => !isNaN(n));
  } catch (err) {
    console.warn('[getAllowedUserIds] Auth service call failed, using single user:', err.message);
  }
  return [userId];
}

module.exports = { getAllowedUserIds };
