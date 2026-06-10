const {
  getLLMConfig,
  mergeRequestLlmOverrides,
  flattenLlmRequestBody,
} = require('../services/llmConfigService');
const { assertChatAllowed } = require('../services/llmChatPolicyService');
const { checkTokenAvailability } = require('../services/paymentTokenClient');

/**
 * After `protect`:
 * 1. Checks token availability via payment-service (shared pool)
 * 2. Loads `llm_chat_config` from DB → `req.llmChatConfig`
 * 3. Enforces rate limits from that row
 * 4. Merges per-request generation overrides → `req.llmConfigForRequest`
 */
async function enforceLLMChatPolicy(req, res, next) {
  try {
    const userId = req.user?.id ?? req.userId;
    if (userId == null) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const flatBody = flattenLlmRequestBody(req.body);
    const estimatedTokens = Math.max(
      0,
      Math.floor(Number(flatBody.estimated_tokens || flatBody.estimatedTokens || 0))
    );

    const tokenCheck = await checkTokenAvailability(userId, {
      estimatedTokens,
      endpoint: req.originalUrl || req.path,
      service: 'chatmodel',
    });
    if (!tokenCheck.ok) {
      const status = tokenCheck.code === 'TOKEN_CHECK_UNAVAILABLE' ? 503 : 429;
      return res.status(status).json({
        success: false,
        code: tokenCheck.code,
        message: tokenCheck.message,
        details: tokenCheck.details,
      });
    }

    const llmConfig = await getLLMConfig(userId, 'chat');
    req.llmChatConfig = llmConfig;

    const check = await assertChatAllowed(Number(userId), llmConfig);
    if (!check.ok) {
      const status = check.code === 'POLICY_CHECK_UNAVAILABLE' ? 503 : 429;
      return res.status(status).json({
        success: false,
        code: check.code,
        message: check.message,
        details: check.details,
      });
    }

    req.llmConfigForRequest = mergeRequestLlmOverrides(llmConfig, flatBody);

    next();
  } catch (err) {
    console.error('[LLM Policy] enforceLLMChatPolicy error:', err.message);
    return res.status(503).json({
      success: false,
      message: 'Unable to verify LLM usage limits. Please try again shortly.',
    });
  }
}

module.exports = { enforceLLMChatPolicy };
