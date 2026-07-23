const pool = require('../config/db');
const paymentPool = require('../config/paymentDb');
const authPool = require('../config/authDb');

function parseAliasMap(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    return { ...raw };
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function mapRowToConfig(row) {
  if (!row) return null;

  const aliasMap = parseAliasMap(row.model_alias_map);

  return {
    max_output_tokens: finiteNumber(row.max_output_tokens),
    total_tokens_per_day: finiteNumber(row.total_tokens_per_day),
    llm_model: row.llm_model != null ? String(row.llm_model) : '',
    llm_provider: row.llm_provider != null ? String(row.llm_provider).trim().toLowerCase() : 'google',
    model_temperature: finiteNumber(row.model_temperature, 1),
    messages_per_hour: finiteNumber(row.messages_per_hour),
    quota_chats_per_minute: finiteNumber(row.quota_chats_per_minute),
    chats_per_day: finiteNumber(row.chats_per_day),
    max_document_pages: finiteNumber(row.max_document_pages),
    max_document_size_mb: finiteNumber(row.max_document_size_mb),
    max_file_upload_per_day: finiteNumber(row.max_file_upload_per_day),
    max_upload_files: finiteNumber(row.max_upload_files, 1),
    streaming_delay: finiteNumber(row.streaming_delay, 0),
    updated_by: row.updated_by != null ? finiteNumber(row.updated_by) : null,

    vertex_model_id: row.vertex_model_id != null && String(row.vertex_model_id).trim()
      ? String(row.vertex_model_id).trim()
      : null,
    model_alias_map: aliasMap,

    min_output_tokens: finiteNumber(row.min_output_tokens, 1),
    max_output_tokens_cap: finiteNumber(row.max_output_tokens_cap, 65536),
    temperature_min: finiteNumber(row.temperature_min, 0),
    temperature_max: finiteNumber(row.temperature_max, 2),
    multer_upload_ceiling_mb: finiteNumber(row.multer_upload_ceiling_mb, 100),
  };
}

function resolveVertexModelId(llmConfig) {
  if (!llmConfig) return null;
  if (llmConfig.vertex_model_id && String(llmConfig.vertex_model_id).trim()) {
    return String(llmConfig.vertex_model_id).trim();
  }
  const raw = (llmConfig.llm_model || '').trim();
  if (!raw) return null;
  const map = llmConfig.model_alias_map || {};
  const key = raw.toLowerCase();
  if (map[key] != null && String(map[key]).trim()) return String(map[key]).trim();
  if (map[raw] != null && String(map[raw]).trim()) return String(map[raw]).trim();
  return raw;
}

function getMulterUploadCeilingMb(llmConfig) {
  const ceiling = finiteNumber(llmConfig?.multer_upload_ceiling_mb, 100);
  const maxDoc = finiteNumber(llmConfig?.max_document_size_mb, 1);
  return Math.max(1, Math.ceil(ceiling), Math.ceil(maxDoc));
}

function getStreamingDelayMs(llmConfig) {
  const raw = finiteNumber(llmConfig?.streaming_delay, 0);
  return Math.min(Math.max(0, Math.floor(raw)), 5000);
}

function normalizeUserId(userId) {
  const n = Number(userId);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

// LEFT JOIN both plan tables so monthly-plan users (plan_id NULL, monthly_plan_id
// set — e.g. the free plan) still resolve. eff_* are the effective values across
// tables; sp.* is kept for the legacy chat_*/sum_* override columns (NULL for a
// monthly-only plan → admin defaults apply, which is correct).
const ACTIVE_SUBSCRIPTION_SQL = `
  SELECT
    sp.*,
    COALESCE(mp.id, sp.id)                          AS eff_plan_id,
    COALESCE(mp.name, sp.name)                       AS eff_plan_name,
    COALESCE(mp.price, sp.price, 0)                  AS eff_plan_price,
    COALESCE(mp.monthly_tokens, sp.token_limit, 0)   AS eff_token_limit
  FROM user_subscriptions us
  LEFT JOIN monthly_plans mp      ON mp.id = us.monthly_plan_id AND mp.is_active = true
  LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
  WHERE us.user_id = $1
    AND LOWER(COALESCE(us.status, 'active')) = 'active'
    AND (us.end_date IS NULL OR us.end_date >= CURRENT_DATE)
    AND (mp.id IS NOT NULL OR sp.id IS NOT NULL)
  ORDER BY us.activated_at DESC NULLS LAST, us.start_date DESC NULLS LAST, us.updated_at DESC
  LIMIT 1
`;

async function getPlanRowById(planId) {
  const pid = Number(planId);
  if (!Number.isFinite(pid) || pid <= 0) return null;
  try {
    const { rows } = await paymentPool.query(
      'SELECT * FROM subscription_plans WHERE id = $1 LIMIT 1',
      [pid]
    );
    return rows[0] || null;
  } catch (err) {
    console.warn('[LLMConfig] subscription_plans lookup failed:', err.message);
    return null;
  }
}

async function getUserActivePlanFromAuth(userId) {
  if (!authPool) return null;
  try {
    const { rows } = await authPool.query(
      `SELECT active_plan_id, active_plan_name
       FROM users
       WHERE id = $1 AND active_plan_id IS NOT NULL
       LIMIT 1`,
      [userId]
    );
    const planId = rows[0]?.active_plan_id;
    if (planId == null) return null;
    const plan = await getPlanRowById(planId);
    if (plan) {
      console.log(
        `[LLMConfig] Resolved plan via users.active_plan_id=${planId} ("${plan.name || rows[0].active_plan_name}")`
      );
    }
    return plan;
  } catch (err) {
    console.warn('[LLMConfig] Auth active_plan_id lookup failed:', err.message);
    return null;
  }
}

async function getUserActivePlan(userId) {
  const uid = normalizeUserId(userId);
  if (!uid) return null;

  try {
    const { rows } = await paymentPool.query(ACTIVE_SUBSCRIPTION_SQL, [uid]);
    if (rows.length > 0) {
      return rows[0];
    }
  } catch (err) {
    console.warn('[LLMConfig] user_subscriptions lookup failed:', err.message);
  }

  return getUserActivePlanFromAuth(uid);
}

/**
 * Overlay subscription_plans onto admin llm_chat_config defaults.
 * NULL plan column = keep admin default. Non-null > 0 = override.
 * Legacy document_limit applies when chat_* columns are unset.
 */
function applyPlanLimitsToConfig(cfg, plan, service = 'chat') {
  if (!plan || !cfg) return cfg;

  const planInt = (colName, fallback) => {
    const v = plan[colName];
    if (v == null) return fallback;
    const n = finiteNumber(v, 0);
    return n > 0 ? n : fallback;
  };

  const planColSet = (colName) => {
    const v = plan[colName];
    return v != null && finiteNumber(v, 0) > 0;
  };

  const legacyDocLimit = finiteNumber(plan.document_limit, 0);

  if (service === 'summarization') {
    cfg.total_tokens_per_day = planInt('summarization_token_limit', cfg.total_tokens_per_day);
    cfg.messages_per_hour = planInt('sum_messages_per_hour', cfg.messages_per_hour);
    cfg.chats_per_day = planInt('sum_chats_per_day', cfg.chats_per_day);
    cfg.quota_chats_per_minute = planInt('sum_quota_per_minute', cfg.quota_chats_per_minute);
    cfg.max_document_pages = planInt('sum_max_document_pages', cfg.max_document_pages);
    cfg.max_document_size_mb = planInt('sum_max_document_size_mb', cfg.max_document_size_mb);
    cfg.max_file_upload_per_day = planInt('sum_max_file_upload_per_day', cfg.max_file_upload_per_day);
    cfg.max_upload_files = planInt('sum_max_upload_files', cfg.max_upload_files);
    cfg.max_context_documents = planInt('sum_max_context_documents', cfg.max_context_documents ?? 0);
    cfg.max_conversation_history = planInt(
      'sum_max_conversation_history',
      cfg.max_conversation_history ?? 0
    );
    if (legacyDocLimit > 0) {
      if (!planColSet('sum_max_upload_files')) {
        cfg.max_upload_files = legacyDocLimit;
      }
      if (!planColSet('sum_max_file_upload_per_day')) {
        cfg.max_file_upload_per_day = legacyDocLimit;
      }
    }
  } else {
    cfg.total_tokens_per_day = planInt('chat_token_limit', cfg.total_tokens_per_day);
    cfg.messages_per_hour = planInt('chat_messages_per_hour', cfg.messages_per_hour);
    cfg.chats_per_day = planInt('chat_chats_per_day', cfg.chats_per_day);
    cfg.quota_chats_per_minute = planInt('chat_quota_per_minute', cfg.quota_chats_per_minute);
    cfg.max_document_pages = planInt('chat_max_document_pages', cfg.max_document_pages);
    cfg.max_document_size_mb = planInt('chat_max_document_size_mb', cfg.max_document_size_mb);
    cfg.max_file_upload_per_day = planInt('chat_max_file_upload_per_day', cfg.max_file_upload_per_day);
    cfg.max_upload_files = planInt('chat_max_upload_files', cfg.max_upload_files);

    if (legacyDocLimit > 0) {
      if (!planColSet('chat_max_upload_files')) {
        cfg.max_upload_files = legacyDocLimit;
      }
      if (!planColSet('chat_max_file_upload_per_day')) {
        cfg.max_file_upload_per_day = legacyDocLimit;
      }
      // NOTE: document_limit is an upload-count column, never a page-count limit.
      // max_document_pages is only set via chat_max_document_pages (plan) or the admin config default.
      if (!planColSet('chat_max_document_size_mb') && plan.storage_limit_gb > 0) {
        const storageMb = Math.ceil(finiteNumber(plan.storage_limit_gb, 0) * 1024);
        if (storageMb > 0) cfg.max_document_size_mb = storageMb;
      }
    }
  }

  cfg._plan_id = plan.eff_plan_id ?? plan.id;
  cfg._plan_name = plan.eff_plan_name ?? plan.name;

  // Free-tier → DeepSeek: expose a model override for the GENERAL/text streaming
  // path only (file-grounded chat stays on Vertex/Gemini — DeepSeek can't read
  // gs:// parts). llm_provider stays 'google' so assertSupportedProvider and the
  // Vertex fallback path are untouched. Off by default → no behavior change.
  // Free = a ₹0-price plan (robust to renaming; matches payment-service).
  try {
    const enabled = String(process.env.FREE_TIER_DEEPSEEK_ENABLED || 'false').toLowerCase() === 'true';
    const dsModel = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
    const dsKey = process.env.DEEPSEEK_API_KEY || '';
    const price = plan.eff_plan_price != null ? plan.eff_plan_price : plan.price;
    const isFree = price != null && Number(price) === 0;
    if (enabled && dsKey && isFree) {
      cfg._llm_model_override = dsModel;
    }
  } catch (_e) {
    /* never let model routing break config loading */
  }
  return cfg;
}

async function getBaseLLMConfigRow() {
  const result = await pool.query(
    `SELECT *
     FROM llm_chat_config
     ORDER BY id DESC
     LIMIT 1`
  );
  if (result.rows.length === 0) {
    throw new Error(
      'llm_chat_config has no rows. Run migrations (Backend/ChatModel/migrations) against this database.'
    );
  }
  return result.rows[0];
}

async function getLLMConfig(userId = null, service = 'chat') {
  try {
    const uid = normalizeUserId(userId);
    console.log(
      `\n[LLMConfig] Fetching effective llm_chat_config from DB${uid ? ` for user ${uid}` : ' (global default)'} [service=${service}]...`
    );

    const baseRow = await getBaseLLMConfigRow();
    const cfg = mapRowToConfig(baseRow);

    if (!uid) {
      console.log('[LLMConfig] No user — returning global defaults');
      return cfg;
    }

    const plan = await getUserActivePlan(uid);
    if (!plan) {
      console.log(`[LLMConfig] No active plan for user ${uid} — using global defaults`);
    } else {
      console.log(`[LLMConfig] Active plan for user ${uid}: "${plan.name}" (id=${plan.id})`);
      applyPlanLimitsToConfig(cfg, plan, service);
    }

    console.log('[LLMConfig] Effective config:');
    console.log(`   - scope                : ${plan ? `plan "${cfg._plan_name}" (id=${cfg._plan_id})` : 'global'}`);
    console.log(`   - llm_provider         : ${cfg.llm_provider}`);
    console.log(`   - llm_model / vertex   : ${cfg.llm_model} -> ${resolveVertexModelId(cfg)}`);
    console.log(`   - max_output_tokens    : ${cfg.max_output_tokens}`);
    console.log(`   - model_temperature    : ${cfg.model_temperature}`);
    console.log(`   - total_tokens_per_day : ${cfg.total_tokens_per_day}`);
    console.log(`   - messages_per_hour    : ${cfg.messages_per_hour}`);
    console.log(`   - quota_chats_per_min  : ${cfg.quota_chats_per_minute}`);
    console.log(`   - chats_per_day        : ${cfg.chats_per_day}`);
    console.log(`   - max_document_pages   : ${cfg.max_document_pages}`);
    console.log(`   - max_document_size_mb : ${cfg.max_document_size_mb}`);
    console.log(`   - max_file_upload/day  : ${cfg.max_file_upload_per_day}`);
    console.log(`   - max_upload_files     : ${cfg.max_upload_files}`);
    console.log(`   - streaming_delay_ms   : ${getStreamingDelayMs(cfg)}`);
    console.log(`   - updated_by           : ${cfg.updated_by ?? 'N/A'}`);
    console.log(`   - multer_ceiling_mb    : ${getMulterUploadCeilingMb(cfg)}`);

    return cfg;
  } catch (error) {
    console.error('[LLMConfig] Error reading llm_chat_config:', error.message);
    throw error;
  }
}

function invalidateConfigCache() {
  console.log('[LLMConfig] invalidateConfigCache called - caching is disabled; config is read fresh from DB each time.');
}

/**
 * Flatten JSON body so overrides can live at top level or under `llm`.
 * Top-level keys win over `llm.*` for the same name.
 * @param {object} body - req.body
 */
function flattenLlmRequestBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const { llm, ...rest } = body;
  const nested = llm && typeof llm === 'object' && !Array.isArray(llm) ? llm : {};
  return { ...nested, ...rest };
}

/**
 * Apply optional per-request overrides from the client (clamped to dashboard limits).
 * @param {object} baseConfig - from mapRowToConfig / getLLMConfig
 * @param {object} body - req.body (may include max_output_tokens, model_temperature, temperature)
 */
function mergeRequestLlmOverrides(baseConfig, body = {}) {
  if (!baseConfig) return baseConfig;
  const out = { ...baseConfig };

  const rawMax =
    body.max_output_tokens != null && body.max_output_tokens !== ''
      ? body.max_output_tokens
      : body.maxOutputTokens;
  if (rawMax != null && rawMax !== '') {
    const n = Number(rawMax);
    if (Number.isFinite(n)) {
      const minOut = finiteNumber(baseConfig.min_output_tokens, 1);
      const cap = finiteNumber(baseConfig.max_output_tokens_cap, 65536);
      const lo = Math.max(1, Math.floor(minOut));
      const hi = Math.max(lo, Math.floor(cap));
      out.max_output_tokens = Math.min(hi, Math.max(lo, Math.floor(n)));
    }
  }

  const rawTemp =
    body.model_temperature != null && body.model_temperature !== ''
      ? body.model_temperature
      : body.temperature;
  if (rawTemp != null && rawTemp !== '') {
    const n = Number(rawTemp);
    if (Number.isFinite(n)) {
      let tMin = finiteNumber(baseConfig.temperature_min, 0);
      let tMax = finiteNumber(baseConfig.temperature_max, 2);
      if (tMin > tMax) {
        const x = tMin;
        tMin = tMax;
        tMax = x;
      }
      out.model_temperature = Math.min(tMax, Math.max(tMin, n));
    }
  }

  return out;
}

/**
 * Returns all plan IDs (monthly_plans.id + subscription_plans.id) that could
 * match secret_manager.plan_id. Admins may store either ID depending on which
 * billing table they used when creating the secret.
 */
async function getSecretManagerPlanIds(userId) {
  const uid = normalizeUserId(userId);
  if (!uid) return [];

  try {
    // Get the user's active plan with both the effective id and the subscription_plan id
    const { rows } = await paymentPool.query(
      `SELECT
         COALESCE(mp.id, sp.id)   AS effective_plan_id,
         sp.id                    AS subscription_plan_id,
         COALESCE(mp.name, sp.name) AS plan_name
       FROM user_subscriptions us
       LEFT JOIN monthly_plans      mp ON mp.id = us.monthly_plan_id AND mp.is_active = true
       LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
       WHERE us.user_id = $1
         AND LOWER(COALESCE(us.status, 'active')) = 'active'
         AND (us.end_date IS NULL OR us.end_date >= CURRENT_DATE)
         AND (mp.id IS NOT NULL OR sp.id IS NOT NULL)
       ORDER BY us.activated_at DESC NULLS LAST, us.start_date DESC, us.updated_at DESC
       LIMIT 1`,
      [uid]
    );

    if (!rows.length) return [];

    const { effective_plan_id, subscription_plan_id, plan_name } = rows[0];
    const ids = new Set();

    if (subscription_plan_id) ids.add(Number(subscription_plan_id));
    if (effective_plan_id)    ids.add(Number(effective_plan_id));

    // If still no subscription_plan_id, look it up by name
    if (!subscription_plan_id && plan_name) {
      const nameRows = await paymentPool.query(
        `SELECT id FROM subscription_plans WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 5`,
        [plan_name]
      );
      for (const r of nameRows.rows) ids.add(Number(r.id));
    }

    return [...ids].filter(id => id > 0);
  } catch (err) {
    console.warn('[LLMConfig] getSecretManagerPlanIds failed:', err.message);
    return [];
  }
}

module.exports = {
  getLLMConfig,
  getUserActivePlan,
  getSecretManagerPlanIds,
  applyPlanLimitsToConfig,
  invalidateConfigCache,
  resolveVertexModelId,
  getMulterUploadCeilingMb,
  getStreamingDelayMs,
  mapRowToConfig,
  mergeRequestLlmOverrides,
  flattenLlmRequestBody,
};
