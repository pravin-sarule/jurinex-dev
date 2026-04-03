const {
  getLLMConfig,
  mergeRequestLlmOverrides,
  flattenLlmRequestBody,
} = require('../services/llmConfigService');
const { assertChatAllowed } = require('../services/llmChatPolicyService');

/**
 * After `protect`:
 * 1. Loads `llm_chat_config` from DB (cached) → `req.llmChatConfig`
 * 2. Enforces quota / rate limits from that row
 * 3. Merges per-request generation overrides (clamped) → `req.llmConfigForRequest`
 *
 * Controllers must use `req.llmConfigForRequest` for Vertex generation (temperature, max_output_tokens)
 * and `req.llmChatConfig` for dashboard-only fields (streaming_delay, quotas in logs).
 */
async function enforceLLMChatPolicy(req, res, next) {
  try {
    const userId = req.user?.id ?? req.userId;
    if (userId == null) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const llmConfig = await getLLMConfig(userId);
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

    const flatBody = flattenLlmRequestBody(req.body);
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
