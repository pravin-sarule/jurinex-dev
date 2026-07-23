/**
 * Free-tier model routing for chat-draft-backend.
 *
 * Asks payment-service (the single source of truth) whether the requesting user
 * should be routed to a DeepSeek model. Returns the DeepSeek model id for
 * free-tier users when the feature is enabled, else null (→ keep Claude).
 * Fails safe: any error / missing config / missing user returns null.
 */
const config = require("../config");

function extractUserId(req) {
  const headerId = req.headers["x-user-id"];
  if (headerId) return String(headerId).trim();
  const auth = req.headers.authorization || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    try {
      const token = auth.split(" ")[1];
      const parts = token.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
        const uid = payload.id || payload.userId || payload.user_id || payload.sub;
        return uid ? String(uid) : null;
      }
    } catch (_e) {
      /* ignore malformed token */
    }
  }
  return null;
}

async function getFreeTierDeepSeekModel(req) {
  if (!config.freeTierDeepseekEnabled || !config.deepseekApiKey) return null;
  const userId = extractUserId(req);
  if (!userId) return null;
  try {
    const resp = await fetch(
      `${config.paymentServiceUrl}/api/user-resources/internal/token-check`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-service": "chat-draft-backend",
        },
        body: JSON.stringify({ userId, service: "chat-draft-backend" }),
      }
    );
    if (!resp.ok) return null;
    const payload = await resp.json();
    const data = (payload && (payload.data || payload)) || {};
    if (data.llm_provider_override === "deepseek" && data.llm_model_override) {
      return String(data.llm_model_override);
    }
  } catch (_e) {
    return null;
  }
  return null;
}

module.exports = { getFreeTierDeepSeekModel };
