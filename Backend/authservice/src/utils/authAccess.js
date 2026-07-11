const Firm = require('../models/Firm');
const FirmUser = require('../models/FirmUser');

const DISABLED_RESPONSE = {
  success: false,
  code: 'USER_DISABLED',
  message: 'Your account has been disabled. Please contact your firm admin.',
};

const FIRM_DISABLED_RESPONSE = {
  success: false,
  code: 'FIRM_DISABLED',
  message: 'Your firm is blocked by Jurinex. Please contact your firm admin.',
};

const FIRM_NOT_APPROVED_RESPONSE = {
  success: false,
  code: 'FIRM_NOT_APPROVED',
  message: 'Your firm is not approved yet.',
};

/**
 * Resolve the firm for a firm admin or firm staff user.
 */
async function resolveUserFirm(user) {
  if (!user) return null;
  const accountType = String(user.account_type || '').toUpperCase();

  if (accountType === 'FIRM_ADMIN') {
    return Firm.findByAdminUserId(user.id);
  }

  if (accountType === 'FIRM_USER') {
    const membership = await FirmUser.findByUserId(user.id);
    if (!membership?.firm_id) return null;
    return Firm.findById(membership.firm_id);
  }

  // Staff may still be linked via firm_users even if account_type is unexpected
  const membership = await FirmUser.findByUserId(user.id);
  if (membership?.firm_id) {
    return Firm.findById(membership.firm_id);
  }

  return null;
}

/**
 * Returns null if the user may authenticate; otherwise an error payload for 403.
 *
 * Order matters: firm-level block is checked before per-user disable so that when a
 * firm is disabled (and members are cascaded inactive), everyone sees the firm message.
 */
async function getAuthDenial(user, { requireFirmApproval = true } = {}) {
  if (!user) {
    return { ...DISABLED_RESPONSE, message: 'User not found.' };
  }

  const firm = await resolveUserFirm(user);

  // Firm-level disable blocks every member (admin + staff)
  if (firm && firm.is_active === false) {
    return { ...FIRM_DISABLED_RESPONSE };
  }

  const isEnabled = user.is_active === true && user.is_blocked !== true;
  if (!isEnabled) {
    return { ...DISABLED_RESPONSE };
  }

  const accountType = String(user.account_type || '').toUpperCase();
  const isFirmAccount = accountType === 'FIRM_ADMIN' || accountType === 'FIRM_USER' || !!firm;

  if (!isFirmAccount) {
    return null;
  }

  if (!firm) {
    if (user.approval_status === 'PENDING') {
      return {
        success: false,
        code: 'FIRM_NOT_APPROVED',
        message: 'Your account is pending approval. Please wait for admin verification.',
      };
    }
    if (user.approval_status === 'REJECTED') {
      return {
        success: false,
        code: 'FIRM_NOT_APPROVED',
        message: 'Your account has been rejected. Please contact support.',
      };
    }
    return null;
  }

  if (requireFirmApproval && firm.approval_status !== 'APPROVED') {
    if (firm.approval_status === 'REJECTED') {
      return {
        success: false,
        code: 'FIRM_NOT_APPROVED',
        message: 'Your firm has been rejected. Please contact support.',
      };
    }
    return { ...FIRM_NOT_APPROVED_RESPONSE };
  }

  return null;
}

module.exports = {
  getAuthDenial,
  resolveUserFirm,
  DISABLED_RESPONSE,
  FIRM_DISABLED_RESPONSE,
  FIRM_NOT_APPROVED_RESPONSE,
};
