const { checkUserTokenAvailability } = require('../services/tokenQuotaCheckService');

/**
 * POST /api/user-resources/internal/token-check
 * Internal — called by ChatModel, agentic-chat, document, citation, draft services.
 *
 * Body: { userId, estimatedTokens?, checkFirmCap?, service?, endpoint? }
 */
exports.internalTokenCheck = async (req, res) => {
  try {
    const userId = req.body?.userId ?? req.headers['x-user-id'];
    const estimatedTokens = req.body?.estimatedTokens ?? req.body?.requestedTokens ?? 0;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required.' });
    }

    const data = await checkUserTokenAvailability(userId, {
      estimatedTokens,
      checkFirmCap: req.body?.checkFirmCap !== false,
      service: req.body?.service || req.headers['x-internal-service'] || null,
      endpoint: req.body?.endpoint || null,
    });

    const status = data.allowed ? 200 : 429;
    return res.status(status).json({ success: data.allowed, data });
  } catch (err) {
    console.error('[internalTokenCheck] error:', err);
    return res.status(503).json({
      success: false,
      code: 'TOKEN_CHECK_UNAVAILABLE',
      message: 'Unable to verify token availability. Please try again shortly.',
      error: err.message,
    });
  }
};

/**
 * GET /api/payments/token-quota-status — refactored to use shared check service.
 */
exports.getTokenQuotaStatus = async (req, res) => {
  try {
    const userId = req.user?.id || req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized.' });

    const data = await checkUserTokenAvailability(userId, { checkFirmCap: false });
    return res.status(200).json({
      success: true,
      data: {
        ...data,
        limit_exhausted: data.blocked,
      },
    });
  } catch (err) {
    console.error('[getTokenQuotaStatus] error:', err);
    return res.status(500).json({ success: false, message: 'Failed to get token quota status.', error: err.message });
  }
};
