const pool = require('../config/db');

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

async function getLLMConfig(userId = null) {
  try {
    const uid = normalizeUserId(userId);
    console.log(
      `\n[LLMConfig] Fetching effective llm_chat_config from DB${uid ? ` for user ${uid}` : ' (global default)'}...`
    );

    const baseRow = await getBaseLLMConfigRow();
    const cfg = mapRowToConfig(baseRow);

    console.log('[LLMConfig] Config loaded from DB:');
    console.log(`   - scope                : global`);
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

module.exports = {
  getLLMConfig,
  invalidateConfigCache,
  resolveVertexModelId,
  getMulterUploadCeilingMb,
  getStreamingDelayMs,
  mapRowToConfig,
  mergeRequestLlmOverrides,
  flattenLlmRequestBody,
};
