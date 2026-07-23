const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const isCloudRun = Boolean(process.env.K_SERVICE);

const defaultServiceUrl = (envValue, localUrl, cloudUrl) =>
  (envValue || (isCloudRun ? cloudUrl : localUrl) || "").replace(/\/+$/, "");

module.exports = {
  port: toInt(process.env.PORT, 8010),
  corsOrigins: process.env.CORS_ORIGINS || "*",
  agentDraftTemplateApiUrl: defaultServiceUrl(
    process.env.AGENT_DRAFT_TEMPLATE_API_URL,
    "http://localhost:8000",
    "https://all-drafting-agent-120280829617.asia-south1.run.app"
  ),
  templateAnalyzerUrl: defaultServiceUrl(
    process.env.TEMPLATE_ANALYZER_URL,
    "http://localhost:5017",
    "https://drafting-agents-120280829617.asia-south1.run.app"
  ),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: process.env.CLAUDE_MODEL || "claude-sonnet-4-5",
  // ── Free-tier DeepSeek routing ────────────────────────────────────────────
  paymentServiceUrl: defaultServiceUrl(
    process.env.PAYMENT_SERVICE_URL,
    "http://localhost:5003",
    "http://localhost:5003"
  ),
  freeTierDeepseekEnabled:
    String(process.env.FREE_TIER_DEEPSEEK_ENABLED || "false").toLowerCase() === "true",
  freePlanName: process.env.FREE_PLAN_NAME || "free",
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || "",
  deepseekModel: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
  maxFiles: toInt(process.env.CHAT_DRAFT_MAX_FILES, 20),
  maxFileSizeMb: toInt(process.env.CHAT_DRAFT_MAX_FILE_SIZE_MB, 30),
  chunkSize: toInt(process.env.CHAT_DRAFT_CHUNK_SIZE, 2400),
  chunkOverlap: toInt(process.env.CHAT_DRAFT_CHUNK_OVERLAP, 300),
  retrievalTopK: toInt(process.env.CHAT_DRAFT_TOP_K, 30),
  // Max chars of document context to send to Claude (fits comfortably in 200K ctx window)
  maxContextChars: toInt(process.env.CHAT_DRAFT_MAX_CONTEXT_CHARS, 180000),
};
