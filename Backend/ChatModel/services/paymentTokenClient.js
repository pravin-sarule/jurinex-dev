/**
 * Calls payment-service central token check before LLM tasks.
 */
const axios = require('axios');

const PAYMENT_SERVICE_URL = (process.env.PAYMENT_SERVICE_URL || 'http://localhost:5003').replace(/\/$/, '');
const SERVICE_NAME = process.env.SERVICE_NAME || 'chatmodel';

/**
 * @param {number|string} userId
 * @param {{ estimatedTokens?: number, endpoint?: string, service?: string }} opts
 * @returns {Promise<{ ok: boolean, code?: string, message?: string, details?: object, source?: string }>}
 */
const { assertChatAllowed } = require('./llmChatPolicyService');
const { getLLMConfig } = require('./llmConfigService');

async function fallbackLocalPolicy(userId, llmConfig) {
  try {
    const cfg = llmConfig || await getLLMConfig(userId, 'chat');
    const check = await assertChatAllowed(Number(userId), cfg);
    if (check.ok) {
      return { ok: true, source: check.source || 'local_fallback', details: check.details };
    }
    return {
      ok: false,
      code: check.code,
      message: check.message,
      details: check.details,
    };
  } catch (err) {
    console.warn('[PaymentTokenClient] local fallback failed:', err.message);
    if (process.env.TOKEN_CHECK_FAIL_OPEN === 'true') {
      return { ok: true };
    }
    return {
      ok: false,
      code: 'TOKEN_CHECK_UNAVAILABLE',
      message: 'Unable to verify token availability. Please try again shortly.',
      details: { reason: err.message },
    };
  }
}

async function checkTokenAvailability(userId, opts = {}) {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) {
    return {
      ok: false,
      code: 'INVALID_USER',
      message: 'Authentication required.',
    };
  }

  try {
    const { data, status } = await axios.post(
      `${PAYMENT_SERVICE_URL}/api/user-resources/internal/token-check`,
      {
        userId: uid,
        estimatedTokens: Math.max(0, Math.floor(Number(opts.estimatedTokens) || 0)),
        service: opts.service || SERVICE_NAME,
        endpoint: opts.endpoint || null,
        checkFirmCap: opts.checkFirmCap !== false,
      },
      {
        timeout: 8000,
        headers: { 'x-internal-service': opts.service || SERVICE_NAME },
        validateStatus: () => true,
      }
    );

    if (status === 404) {
      console.warn(
        '[PaymentTokenClient] token-check returned 404 — restart payment-service. Using local policy fallback.'
      );
      return fallbackLocalPolicy(uid);
    }

    if (status >= 500) {
      return fallbackLocalPolicy(uid);
    }

    const payload = data?.data || data || {};
    if (status === 429 || payload.allowed === false) {
      return {
        ok: false,
        source: payload.source,
        code: payload.code || 'TOKEN_LIMIT_EXHAUSTED',
        message: payload.message,
        details: payload,
      };
    }

    return {
      ok: !!payload.allowed,
      source: payload.source,
      code: payload.code || (payload.allowed ? undefined : 'TOKEN_LIMIT_EXHAUSTED'),
      message: payload.message,
      details: payload,
    };
  } catch (err) {
    console.error('[PaymentTokenClient] check failed:', err.message);
    return fallbackLocalPolicy(uid);
  }
}

module.exports = { checkTokenAvailability };
