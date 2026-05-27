/**
 * geminiCacheService.js
 *
 * Gemini 2.5 Flash context caching with exact token accounting.
 *
 * Token extraction (from usageMetadata per query):
 *   cachedTokens    = usage.cachedContentTokenCount   → served cheaply from cache
 *   totalInput      = usage.promptTokenCount           → cached + new prompt
 *   newPromptTokens = totalInput - cachedTokens        → billed at full input rate
 *   outputTokens    = usage.candidatesTokenCount
 *
 * Pricing — Gemini 2.5 Flash (USD / 1M tokens):
 *   Creation (setup)  : $0.30
 *   Storage / hour    : $1.00
 *   Cached input      : $0.03
 *   New input         : $0.30
 *   Output            : $2.50
 *
 * Data persistence:
 *   gemini_cache_sessions — one row per cache session (lifecycle + totals)
 *   query_logs            — one row per question (exact per-query breakdown)
 *
 * In-memory map:
 *   cacheTimers  — only the 2-minute sliding-window setTimeout handle
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAICacheManager, GoogleAIFileManager } = require('@google/generative-ai/server');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// Only timers live in memory; all session data is in Postgres
const cacheTimers = new Map(); // sessionId → { timer, expiresAt }

// Inactivity window before Google cache is deleted (default 15 min; was 2 min).
const INACTIVITY_MS = (() => {
  const raw = Number(process.env.GEMINI_CACHE_INACTIVITY_MS);
  return Number.isFinite(raw) && raw >= 60_000 ? Math.floor(raw) : 15 * 60 * 1000;
})();

/** Google Generative AI minimum for explicit context cache (document + system instruction). */
const GEMINI_CACHE_MIN_TOKENS = 1024;

function toGenAISystemInstruction(text) {
  const t = String(text || '').trim();
  if (!t) return undefined;
  return { parts: [{ text: t }] };
}

function isCacheTooSmallError(err) {
  const msg = String(err?.message || '');
  return (
    err?.code === 'CACHE_TOO_SMALL' ||
    /cached content is too small/i.test(msg) ||
    /min_total_token_count/i.test(msg)
  );
}

function resolveCacheSystemInstruction(customSystemInstruction) {
  const custom = String(customSystemInstruction || '').trim();
  if (custom) return custom;
  return DOCUMENT_SYSTEM_INSTRUCTION;
}

async function countTokensForCachePayload(countModel, { filePart, textContent, systemInstruction }) {
  const parts = filePart ? [filePart] : [{ text: String(textContent || '') }];
  const request = { contents: [{ role: 'user', parts }] };
  const sys = toGenAISystemInstruction(systemInstruction);
  if (sys) request.systemInstruction = sys;
  const countResult = await countModel.countTokens(request);
  return countResult.totalTokens || 0;
}

async function assertMeetsCacheMinimumTokenCount(countModel, payload, label = 'cache') {
  const total = await countTokensForCachePayload(countModel, payload);
  if (total < GEMINI_CACHE_MIN_TOKENS) {
    const err = new Error(
      `${label} has ${total} tokens; Gemini context cache requires at least ${GEMINI_CACHE_MIN_TOKENS} (document + system prompt).`
    );
    err.code = 'CACHE_TOO_SMALL';
    err.tokenCount = total;
    throw err;
  }
  return total;
}

// ── Pricing ──────────────────────────────────────────────────────────────────

const FLASH_PRICING = {
  model:           'gemini-2.5-flash',
  creationRate:    0.30,   // setup / write to cache
  storageRate:     1.00,   // per hour
  cachedInputRate: 0.03,   // cached tokens served
  newInputRate:    0.30,   // new prompt tokens
  outputRate:      2.50,   // output tokens
};

function getPricing() { return FLASH_PRICING; }

// ── Document-grounding system instruction ─────────────────────────────────────
// Applied to every cache-backed generation so the model stays anchored to the
// uploaded document and does not hallucinate content from its training data.
const DOCUMENT_SYSTEM_INSTRUCTION = `You are JuriNex Legal Assistant. Answer questions about the user's uploaded document.

CORE OUTPUT RULES (highest priority):
1. Answer exactly what is asked. Do not add unrequested context or tangents.
2. Never repeat yourself. Every sentence must contain new information. Do not add a closing summary or restatement of what you just wrote.
3. Never hallucinate. Only assert facts present in the document. Never invent clause numbers, party names, dates, amounts, or obligations.
4. Length follows content. Stop when the answer is complete. Do not pad or truncate.
5. One pass only. Write the answer once in logical sequence, then stop.

DOCUMENT GROUNDING:
- Answer ONLY from the content of the provided document. Do not introduce facts, clauses, names, dates, figures, or legal positions not explicitly written in the document.
- If the answer is not in the document, say: "This information is not present in the provided document." Do not speculate or fill gaps.
- Support every answer by quoting or paraphrasing the exact relevant section(s). Cite clause numbers, headings, or page references when visible.
- If the question is ambiguous about which part of the document is meant, ask a clarifying question rather than guessing.

FORMATTING:
- Use markdown headings (##, ###) for multi-part answers.
- Use numbered lists for sequential steps; bullet points for non-sequential items.
- Bold (**text**) key legal terms, clause numbers, and party names.
- Use tables for comparisons. Use blockquotes (>) for verbatim text from the document.`;

// Maximum number of prior Q&A turns to include as conversation history.
// Each turn = 1 user message + 1 model message → 10 turns = 20 content entries.
// Keeping this bounded prevents token bloat on long sessions.
const MAX_HISTORY_TURNS = 10;

// ── Utilities ─────────────────────────────────────────────────────────────────

function getApiKey() {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error('GEMINI_API_KEY is not configured.');
  return k;
}

// ── Timer management ──────────────────────────────────────────────────────────

async function startInactivityTimer(sessionId) {
  // Clear any existing timer for this session
  if (cacheTimers.has(sessionId)) {
    clearTimeout(cacheTimers.get(sessionId).timer);
  }

  const expiresAt = Date.now() + INACTIVITY_MS;

  const timer = setTimeout(async () => {
    console.log(`[CacheService] Inactivity timeout — auto-deleting session ${sessionId}`);
    try { await deleteCache(sessionId, 'inactivity_timeout'); } catch (e) {
      console.error('[CacheService] Auto-delete failed:', e.message);
    }
  }, 2 * 60 * 1000);

  cacheTimers.set(sessionId, { timer, expiresAt });

  // Await the DB update so that any status fetch immediately after this call
  // sees the correct expires_at (2 min from now, not from cache creation time).
  await pool.query(
    'UPDATE gemini_cache_sessions SET expires_at = $1, last_accessed_at = NOW() WHERE session_id = $2',
    [new Date(expiresAt), sessionId]
  ).catch(err => console.warn('[CacheService] expires_at update failed:', err.message));

  console.log(`[CacheService] Inactivity timer set for ${sessionId} — fires at ${new Date(expiresAt).toISOString()}`);
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function dbInsertSession({ sessionId, cacheName, documentTokens, setupCost, displayName, expiresAt, fileId }) {
  const pricing = getPricing();
  await pool.query(
    `INSERT INTO gemini_cache_sessions
       (session_id, cache_name, model_name, document_tokens, display_name,
        status, created_at, last_accessed_at, expires_at,
        setup_cost, new_input_tokens_used, total_cached_tokens_used,
        questions_asked, total_input_tokens_used, total_output_tokens_used,
        creation_cost, accumulated_input_cost, accumulated_output_cost, file_id)
     VALUES ($1,$2,$3,$4,$5,'active',NOW(),NOW(),$6,$7,0,0,0,0,0,$7,0,0,$8)`,
    [sessionId, cacheName, pricing.model, documentTokens, displayName, new Date(expiresAt), setupCost, fileId || null]
  );
}

async function dbInsertQueryLog(sessionId, { promptTokens, cachedTokens, outputTokens, queryCost }) {
  await pool.query(
    `INSERT INTO query_logs (session_id, prompt_tokens, cached_tokens, output_tokens, query_cost)
     VALUES ($1,$2,$3,$4,$5)`,
    [sessionId, promptTokens, cachedTokens, outputTokens, queryCost]
  );
}

/**
 * Store a Q&A turn in the existing file_chats table so the regular
 * document-chat history endpoint can surface cache conversations too.
 */
async function dbStoreCacheTurn(fileId, userId, sessionId, question, answer) {
  try {
    await pool.query(
      `INSERT INTO file_chats (file_id, user_id, session_id, question, answer, chat_type)
       VALUES ($1, $2, $3, $4, $5, 'chat_model')`,
      [fileId, userId, sessionId, question, answer]
    );
  } catch (err) {
    console.warn('[CacheService] dbStoreCacheTurn failed (non-fatal):', err.message);
  }
}

/**
 * Fetch the most recent MAX_HISTORY_TURNS Q&A turns for a session from
 * file_chats and return them as Gemini `contents` history.
 * The cached document is already bound to the model; only conversational
 * context (prior questions + answers) is included here.
 */
async function getConversationHistory(sessionId) {
  // Fetch newest-first so LIMIT gives us the most recent turns, then reverse
  // to restore chronological order for the model.
  const res = await pool.query(
    `SELECT question, answer FROM file_chats
     WHERE session_id = $1 AND chat_type = 'chat_model'
       AND question IS NOT NULL AND answer IS NOT NULL
     ORDER BY created_at DESC
     LIMIT $2`,
    [sessionId, MAX_HISTORY_TURNS]
  );
  const history = [];
  for (const row of [...res.rows].reverse()) {
    history.push({ role: 'user',  parts: [{ text: row.question }] });
    history.push({ role: 'model', parts: [{ text: row.answer   }] });
  }
  return history;
}

async function dbAccumulateUsage(sessionId, { cachedTokens, newPromptTokens, outputTokens, inputCost, outputCost }) {
  await pool.query(
    `UPDATE gemini_cache_sessions SET
       questions_asked           = questions_asked + 1,
       total_input_tokens_used   = total_input_tokens_used   + $2,
       new_input_tokens_used     = new_input_tokens_used     + $3,
       total_cached_tokens_used  = total_cached_tokens_used  + $4,
       total_output_tokens_used  = total_output_tokens_used  + $5,
       accumulated_input_cost    = accumulated_input_cost    + $6,
       accumulated_output_cost   = accumulated_output_cost   + $7,
       last_accessed_at          = NOW()
     WHERE session_id = $1`,
    [sessionId,
     cachedTokens + newPromptTokens, // total_input (as Gemini counts it)
     newPromptTokens,
     cachedTokens,
     outputTokens,
     inputCost,
     outputCost]
  );
}

// ── Shared status builder ─────────────────────────────────────────────────────

function buildStatus(session, queryAgg, lastQueryRow, allQueryRows = []) {
  const pricing    = getPricing();
  const now        = Date.now();
  const createdAt  = new Date(session.created_at).getTime();
  const isActive   = session.status === 'active';
  const endTime    = isActive ? now : (session.deleted_at ? new Date(session.deleted_at).getTime() : now);
  const activeHrs  = Math.max(0, (endTime - createdAt) / 3_600_000);

  const docTokens      = Number(session.document_tokens || 0);
  const setupCost      = Number(session.setup_cost || session.creation_cost || 0);
  const storageCost    = docTokens * (pricing.storageRate / 1_000_000) * activeHrs;
  const totalQueryCost = Number(queryAgg?.total_query_cost || 0);
  const grandTotal     = setupCost + storageCost + totalQueryCost;

  const expiresAt = session.expires_at;
  const remainingSeconds = isActive && expiresAt
    ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000))
    : 0;

  // Correct display total: doc (once) + new prompts + output — never inflated
  const totalNewPromptTokens = Number(queryAgg?.total_prompt_tokens || 0);
  const totalCachedTokens    = Number(queryAgg?.total_cached_tokens || 0);
  const totalOutputTokens    = Number(queryAgg?.total_output_tokens || 0);
  const displayTotal         = docTokens + totalNewPromptTokens + totalOutputTokens;

  const lastQuery = lastQueryRow ? {
    promptTokens: Number(lastQueryRow.prompt_tokens),
    cachedTokens: Number(lastQueryRow.cached_tokens),
    outputTokens: Number(lastQueryRow.output_tokens),
    queryCost:    Number(lastQueryRow.query_cost),
    createdAt:    lastQueryRow.created_at,
  } : null;

  return {
    sessionId:    session.session_id,
    status:       session.status,
    modelName:    session.model_name || pricing.model,
    displayName:  session.display_name,
    documentTokens: docTokens,
    // Costs
    setupCost,
    storageCost,
    totalQueryCost,
    grandTotal,
    // Token totals (correct, non-inflated)
    totalNewPromptTokens,
    totalCachedTokens,
    totalOutputTokens,
    displayTotal,
    totalQueries: Number(queryAgg?.total_queries || 0),
    // Lifecycle
    createdAt:      session.created_at,
    expiresAt:      session.expires_at,
    deletedAt:      session.deleted_at,
    deleteReason:   session.delete_reason,
    remainingSeconds,
    // Pricing (for client-side live storage calc)
    pricing,
    // Last query breakdown
    lastQuery,
    // Full query history (all rows, chronological)
    queryHistory: allQueryRows.map((r, i) => ({
      index:        i + 1,
      promptTokens: Number(r.prompt_tokens),
      cachedTokens: Number(r.cached_tokens),
      outputTokens: Number(r.output_tokens),
      queryCost:    Number(r.query_cost),
      createdAt:    r.created_at,
    })),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * createCache — from raw document text
 */
async function createCache(
  documentText,
  displayName = 'Legal Doc Cache',
  modelName = 'gemini-2.5-flash',
  customSessionId = null,
  fileId = null,
  systemInstruction = null
) {
  const apiKey = getApiKey();
  const genAI  = new GoogleGenerativeAI(apiKey);
  const cacheManager = new GoogleAICacheManager(apiKey);
  const sessionId    = customSessionId || uuidv4();
  const pricing      = getPricing();
  const sysInst      = resolveCacheSystemInstruction(systemInstruction);

  console.log(`[CacheService] Counting tokens for session ${sessionId} (document + system prompt)...`);
  const countModel = genAI.getGenerativeModel({ model: pricing.model });
  const documentTokens = await assertMeetsCacheMinimumTokenCount(countModel, {
    textContent: documentText,
    systemInstruction: sysInst,
  });
  const setupCost = documentTokens * (pricing.creationRate / 1_000_000);
  console.log(
    `[CacheService] cachePayloadTokens=${documentTokens} (incl. system prompt), setupCost=$${setupCost.toFixed(8)}`
  );

  const cache = await cacheManager.create({
    model: pricing.model,
    displayName: `${displayName.slice(0, 40)}-${sessionId.slice(0, 8)}`,
    contents: [{ role: 'user', parts: [{ text: documentText }] }],
    systemInstruction: toGenAISystemInstruction(sysInst),
    ttlSeconds: 900,
  });

  const expiresAt = Date.now() + INACTIVITY_MS;

  // 3. Persist to DB
  await dbInsertSession({ sessionId, cacheName: cache.name, documentTokens, setupCost, displayName, expiresAt, fileId });

  // 4. Start sliding inactivity timer
  await startInactivityTimer(sessionId);

  console.log(`[CacheService] Cache created. sessionId=${sessionId}`);

  return buildStatus(
    { session_id: sessionId, cache_name: cache.name, model_name: pricing.model,
      document_tokens: documentTokens, display_name: displayName, status: 'active',
      created_at: new Date().toISOString(), expires_at: new Date(expiresAt).toISOString(),
      deleted_at: null, delete_reason: null, setup_cost: setupCost, creation_cost: setupCost },
    { total_queries: 0, total_prompt_tokens: 0, total_cached_tokens: 0, total_output_tokens: 0, total_query_cost: 0 },
    null
  );
}

/**
 * createCacheFromFile — from a GCS buffer (PDF/text/image)
 * @param {boolean} skipInitialTimer - when true, do NOT start the 2-min inactivity timer
 *   immediately after creation; the caller (askWithAutoCache) will start it once the
 *   full response has been delivered to the user.
 */
async function createCacheFromFile(
  fileBuffer,
  mimetype,
  filename,
  displayName = 'Legal Chat Cache',
  modelName = 'gemini-2.5-flash',
  customSessionId = null,
  fileId = null,
  skipInitialTimer = false,
  systemInstruction = null
) {
  const apiKey       = getApiKey();
  const genAI        = new GoogleGenerativeAI(apiKey);
  const cacheManager = new GoogleAICacheManager(apiKey);
  const fileManager  = new GoogleAIFileManager(apiKey);
  const sessionId    = customSessionId || uuidv4();
  const pricing      = getPricing();

  // Upload buffer to Google File API
  const tempPath = path.join(os.tmpdir(), `${Date.now()}_${filename}`);
  fs.writeFileSync(tempPath, fileBuffer);
  let uploadResult;
  try {
    uploadResult = await fileManager.uploadFile(tempPath, { mimeType: mimetype, displayName: filename });
    console.log(`[CacheService] File uploaded → ${uploadResult.file.uri}`);
  } finally {
    try { fs.unlinkSync(tempPath); } catch (_) {}
  }

  const filePart = { fileData: { fileUri: uploadResult.file.uri, mimeType: uploadResult.file.mimeType } };
  const sysInst = resolveCacheSystemInstruction(systemInstruction);

  const countModel = genAI.getGenerativeModel({ model: pricing.model });
  let documentTokens = 0;
  try {
    documentTokens = await assertMeetsCacheMinimumTokenCount(
      countModel,
      { filePart, systemInstruction: sysInst },
      'Document + system prompt'
    );
  } catch (countErr) {
    if (isCacheTooSmallError(countErr)) throw countErr;
    console.warn(`[CacheService] countTokens failed (non-fatal): ${countErr.message}`);
    documentTokens = GEMINI_CACHE_MIN_TOKENS;
  }
  const setupCost = documentTokens * (pricing.creationRate / 1_000_000);
  console.log(
    `[CacheService] cachePayloadTokens=${documentTokens} (document + system prompt), setupCost=$${setupCost.toFixed(8)}`
  );

  const cache = await cacheManager.create({
    model: pricing.model,
    displayName: `${displayName.slice(0, 40)}-${sessionId.slice(0, 8)}`,
    contents: [{ role: 'user', parts: [filePart] }],
    systemInstruction: toGenAISystemInstruction(sysInst),
    ttlSeconds: 900,
  });

  // Clean up uploaded file from Google File API
  try { await fileManager.deleteFile(uploadResult.file.name); } catch (_) {}

  // When skipInitialTimer=true the 2-min timer starts AFTER the full response is
  // delivered.  Use Google's TTL (900 s) as the safe initial expiry so that a
  // server restart during a long-running first request won't prematurely delete
  // the session before `startInactivityTimer` can update the DB.
  const expiresAt = skipInitialTimer
    ? Date.now() + 900 * 1000
    : Date.now() + INACTIVITY_MS;
  await dbInsertSession({ sessionId, cacheName: cache.name, documentTokens, setupCost, displayName, expiresAt, fileId });

  if (!skipInitialTimer) {
    await startInactivityTimer(sessionId);
  }

  console.log(`[CacheService] Cache created from file. sessionId=${sessionId} fileId=${fileId} skipInitialTimer=${skipInitialTimer}`);

  return buildStatus(
    { session_id: sessionId, cache_name: cache.name, model_name: pricing.model,
      document_tokens: documentTokens, display_name: displayName, status: 'active',
      created_at: new Date().toISOString(), expires_at: new Date(expiresAt).toISOString(),
      deleted_at: null, delete_reason: null, setup_cost: setupCost, creation_cost: setupCost },
    { total_queries: 0, total_prompt_tokens: 0, total_cached_tokens: 0, total_output_tokens: 0, total_query_cost: 0 },
    null
  );
}

/**
 * askQuestion — query cached content, log exact token usage
 */
async function askQuestion(sessionId, question, userId = null) {
  // Load session from DB
  const sessionRes = await pool.query(
    "SELECT * FROM gemini_cache_sessions WHERE session_id = $1 AND status = 'active'",
    [sessionId]
  );
  if (!sessionRes.rows.length) throw new Error('Cache session not found or has expired.');
  const session = sessionRes.rows[0];

  const apiKey = getApiKey();
  const genAI  = new GoogleGenerativeAI(apiKey);

  // Bind the model to the cached content + inject the document-grounding
  // system instruction so the model stays anchored to the uploaded document.
  // System instruction is stored inside the cached content at creation time.
  const model = genAI.getGenerativeModelFromCachedContent({
    name: session.cache_name,
    model: session.model_name,
  });

  const history = await getConversationHistory(sessionId);
  const historyTurns = history.length / 2; // each turn = 1 user + 1 model part
  const historyChars = history.reduce((sum, h) => sum + (h.parts?.[0]?.text?.length || 0), 0);
  console.log(
    `\n📜 [CacheService ask] History sent with this prompt` +
    `\n   turns included : ${historyTurns} (max ${MAX_HISTORY_TURNS})` +
    `\n   history chars  : ${historyChars}  |  estimated tokens : ~${Math.round(historyChars / 4)}`
  );
  if (historyTurns > 0) {
    for (let i = 0; i < history.length; i += 2) {
      const q = (history[i]?.parts?.[0]?.text || '').substring(0, 120);
      const a = (history[i + 1]?.parts?.[0]?.text || '').substring(0, 120);
      const qLen = (history[i]?.parts?.[0]?.text || '').length;
      const aLen = (history[i + 1]?.parts?.[0]?.text || '').length;
      console.log(
        `   [Turn ${i / 2 + 1}]` +
        `\n      Q (${qLen} chars): ${q}${qLen > 120 ? '…' : ''}` +
        `\n      A (${aLen} chars): ${a}${aLen > 120 ? '…' : ''}`
      );
    }
  }

  const contents = [
    ...history,
    { role: 'user', parts: [{ text: question }] },
  ];

  const result = await model.generateContent({ contents });
  const answer = result.response.text();

  // ── Exact token extraction ────────────────────────────────────────────────
  // usageMetadata fields:
  //   promptTokenCount         = total input (cached doc + new prompt)
  //   cachedContentTokenCount  = tokens served from cache (cheap rate)
  //   candidatesTokenCount     = output tokens
  const usage = result.response.usageMetadata || {};
  const cachedTokens     = usage.cachedContentTokenCount || 0;
  const totalInputTokens = usage.promptTokenCount         || 0;
  const newPromptTokens  = Math.max(0, totalInputTokens - cachedTokens);
  const outputTokens     = usage.candidatesTokenCount     || 0;

  console.log(
    `\n📊 [CacheService ask] Token Summary` +
    `\n   cached tokens  : ${cachedTokens}` +
    `\n   new prompt     : ${newPromptTokens}` +
    `\n   output tokens  : ${outputTokens}` +
    `\n   total input    : ${totalInputTokens}` +
    `\n   max_output cap : (set by Gemini cache model default — no explicit cap sent)`
  );

  // ── Cost calculation ──────────────────────────────────────────────────────
  const pricing    = getPricing();
  const cachedCost = cachedTokens    * (pricing.cachedInputRate / 1_000_000);
  const promptCost = newPromptTokens * (pricing.newInputRate    / 1_000_000);
  const outputCost = outputTokens    * (pricing.outputRate      / 1_000_000);
  const queryCost  = cachedCost + promptCost + outputCost;

  await dbInsertQueryLog(sessionId, { promptTokens: newPromptTokens, cachedTokens, outputTokens, queryCost });
  await dbStoreCacheTurn(session.file_id, userId, sessionId, question, answer);

  // ── Accumulate totals in gemini_cache_sessions ───────────────────────────
  await dbAccumulateUsage(sessionId, {
    cachedTokens, newPromptTokens, outputTokens,
    inputCost: cachedCost + promptCost, outputCost,
  });

  // ── Reset 2-minute sliding window (await so DB has correct expires_at) ─────
  await startInactivityTimer(sessionId);

  // ── Build sessionMetrics from DB (post-update) ────────────────────────────
  const sessionMetrics = await getStatus(sessionId);

  return {
    answer,
    tokenUsage: {
      cachedTokens,
      newPromptTokens,
      outputTokens,
      totalInputTokens,
      queryCost,
      cachedCost,
      promptCost,
      outputCost,
    },
    sessionMetrics,
  };
}

/**
 * getStatus — full session state aggregated from DB + query_logs
 */
async function getStatus(sessionId) {
  const sessionRes = await pool.query(
    'SELECT * FROM gemini_cache_sessions WHERE session_id = $1',
    [sessionId]
  );
  if (!sessionRes.rows.length) return { sessionId, status: 'NOT_FOUND' };

  const session = sessionRes.rows[0];

  const [aggRes, allLogsRes] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*)                           AS total_queries,
         COALESCE(SUM(prompt_tokens), 0)   AS total_prompt_tokens,
         COALESCE(SUM(cached_tokens), 0)   AS total_cached_tokens,
         COALESCE(SUM(output_tokens), 0)   AS total_output_tokens,
         COALESCE(SUM(query_cost),    0)   AS total_query_cost
       FROM query_logs WHERE session_id = $1`,
      [sessionId]
    ),
    pool.query(
      'SELECT * FROM query_logs WHERE session_id = $1 ORDER BY created_at ASC',
      [sessionId]
    ),
  ]);

  const allLogs = allLogsRes.rows;
  const lastQueryRow = allLogs.length > 0 ? allLogs[allLogs.length - 1] : null;
  return buildStatus(session, aggRes.rows[0], lastQueryRow, allLogs);
}

/**
 * getStatusForFile — aggregated status + FULL cross-session query history for a file_id.
 * Even when a cache session expires and is recreated, all previous query logs remain visible.
 */
async function getStatusForFile(fileId) {
  if (!fileId) return { fileId, status: 'NO_FILE_ID', queryHistory: [], totalQueries: 0 };

  // Latest session (prefer active, then most recently created)
  const sessionRes = await pool.query(
    `SELECT * FROM gemini_cache_sessions
     WHERE file_id = $1
     ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, created_at DESC
     LIMIT 1`,
    [fileId]
  );

  if (!sessionRes.rows.length) return { fileId, status: 'NO_SESSION', queryHistory: [], totalQueries: 0 };

  const session = sessionRes.rows[0];

  // Aggregate query metrics + logs across ALL sessions for this file
  const [fileAggRes, allLogsRes, allSessionsAggRes] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*)                           AS total_queries,
         COALESCE(SUM(ql.prompt_tokens), 0) AS total_prompt_tokens,
         COALESCE(SUM(ql.cached_tokens), 0) AS total_cached_tokens,
         COALESCE(SUM(ql.output_tokens), 0) AS total_output_tokens,
         COALESCE(SUM(ql.query_cost),    0) AS total_query_cost
       FROM query_logs ql
       JOIN gemini_cache_sessions gcs ON ql.session_id = gcs.session_id
       WHERE gcs.file_id = $1`,
      [fileId]
    ),
    pool.query(
      `SELECT ql.* FROM query_logs ql
       JOIN gemini_cache_sessions gcs ON ql.session_id = gcs.session_id
       WHERE gcs.file_id = $1
       ORDER BY ql.created_at ASC`,
      [fileId]
    ),
    pool.query(
      `SELECT COALESCE(SUM(setup_cost), 0) AS total_setup_cost
       FROM gemini_cache_sessions WHERE file_id = $1`,
      [fileId]
    ),
  ]);

  const allLogs = allLogsRes.rows;
  const lastQueryRow = allLogs.length > 0 ? allLogs[allLogs.length - 1] : null;

  // Override setup_cost with sum across all recreations of this document's cache
  const adjustedSession = {
    ...session,
    setup_cost:    Number(allSessionsAggRes.rows[0].total_setup_cost),
    creation_cost: Number(allSessionsAggRes.rows[0].total_setup_cost),
  };

  const status = buildStatus(adjustedSession, fileAggRes.rows[0], lastQueryRow, allLogs);
  return { ...status, fileId };
}

/**
 * deleteCache — stop timer, delete from Google, mark EXPIRED in DB
 */
async function deleteCache(sessionId, reason = 'manual') {
  const sessionRes = await pool.query(
    'SELECT * FROM gemini_cache_sessions WHERE session_id = $1',
    [sessionId]
  );
  if (!sessionRes.rows.length) return { success: false, message: 'Session not found' };
  const session = sessionRes.rows[0];

  // Clear timer
  if (cacheTimers.has(sessionId)) {
    clearTimeout(cacheTimers.get(sessionId).timer);
    cacheTimers.delete(sessionId);
  }

  // Delete from Google
  if (session.status === 'active') {
    try {
      const cacheManager = new GoogleAICacheManager(getApiKey());
      await cacheManager.delete(session.cache_name);
      console.log(`[CacheService] Google cache deleted for ${sessionId}`);
    } catch (err) {
      console.warn('[CacheService] Google delete failed:', err.message);
    }
  }

  await pool.query(
    `UPDATE gemini_cache_sessions
     SET status='deleted', deleted_at=NOW(), delete_reason=$1
     WHERE session_id=$2`,
    [reason, sessionId]
  );

  return { success: true, sessionId, status: 'deleted', reason };
}

/**
 * askWithAutoCache — lazy cache lifecycle (create on first use, resurrect after inactivity)
 *
 * Steps:
 *   1. Check DB for an active session tied to this file_id
 *   2. If active  → ask directly (sliding timer resets inside askQuestion)
 *   3. If expired/missing → call getFileBuffer() → create new cache → ask
 *
 * @param {string}   fileId         - JuriNex file UUID
 * @param {string}   question       - User's question text
 * @param {Function} getFileBuffer  - Async fn () => Buffer — only called when cache must be created
 * @param {string}   mimetype       - File MIME type
 * @param {string}   filename       - Original filename
 * @param {string}   displayName    - Human-readable label for the cache
 */
async function askWithAutoCache(
  fileId,
  question,
  getFileBuffer,
  mimetype,
  filename,
  displayName = 'Legal Chat Cache',
  userId = null,
  systemInstruction = null
) {
  // 1. Look up active session for this file
  const activeRes = await pool.query(
    "SELECT session_id FROM gemini_cache_sessions WHERE file_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    [fileId]
  );

  let sessionId;
  if (activeRes.rows.length > 0) {
    sessionId = activeRes.rows[0].session_id;
    const tokRes = await pool.query(
      'SELECT document_tokens FROM gemini_cache_sessions WHERE session_id = $1',
      [sessionId]
    );
    const storedTokens = Number(tokRes.rows[0]?.document_tokens || 0);
    if (storedTokens > 0 && storedTokens < GEMINI_CACHE_MIN_TOKENS) {
      await deleteCache(sessionId, 'upgrade_for_system_prompt_cache').catch(console.warn);
      sessionId = null;
    } else {
      console.log(`[CacheService] Re-using active cache session ${sessionId} for file ${fileId}`);
    }
  }

  if (!sessionId) {
    console.log(`[CacheService] No active cache for file ${fileId} — creating new cache (lazy)`);
    const fileBuffer = await getFileBuffer();
    const cacheStatus = await createCacheFromFile(
      fileBuffer,
      mimetype,
      filename,
      displayName,
      'gemini-2.5-flash',
      null,
      fileId,
      true,
      systemInstruction
    );
    sessionId = cacheStatus.sessionId;
    console.log(`[CacheService] New cache session ${sessionId} created for file ${fileId}`);
  }

  const result = await askQuestion(sessionId, question, userId);

  // 4. Replace sessionMetrics with cross-session aggregated status so the client
  //    always sees the full history across all cache recreations for this file.
  const fileStatus = await getStatusForFile(fileId);
  result.sessionMetrics = fileStatus;

  return result;
}

/**
 * askWithAutoCacheStream — same lazy lifecycle as askWithAutoCache but streams
 * response chunks via callbacks so the client can render text in real time.
 *
 * @param {Function} onStatus  (statusData: { status, message }) => void
 * @param {Function} onChunk   (text: string) => void
 */
async function askWithAutoCacheStream(
  fileId,
  question,
  getFileBuffer,
  mimetype,
  filename,
  displayName = 'Legal Chat Cache',
  onStatus,
  onChunk,
  userId = null,
  chatSessionId = null,
  historyQuestion = null,
  systemInstruction = null
) {
  onStatus?.({ status: 'preparing', message: 'Preparing document cache...' });

  // 1. Find or create active session
  const activeRes = await pool.query(
    "SELECT session_id FROM gemini_cache_sessions WHERE file_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    [fileId]
  );

  let sessionId;
  if (activeRes.rows.length > 0) {
    sessionId = activeRes.rows[0].session_id;
    const tokRes = await pool.query(
      'SELECT document_tokens FROM gemini_cache_sessions WHERE session_id = $1',
      [sessionId]
    );
    const storedTokens = Number(tokRes.rows[0]?.document_tokens || 0);
    // Sessions created before system-prompt-in-cache stored only document tokens (< 1024).
    if (storedTokens > 0 && storedTokens < GEMINI_CACHE_MIN_TOKENS) {
      console.log(
        `[CacheService] Upgrading cache ${sessionId} (${storedTokens} tokens) — recreating with system prompt in cache`
      );
      await deleteCache(sessionId, 'upgrade_for_system_prompt_cache').catch(console.warn);
      sessionId = null;
    }
  }

  if (sessionId) {
    // Pause the inactivity timer while generating — prevents mid-stream auto-delete
    if (cacheTimers.has(sessionId)) {
      clearTimeout(cacheTimers.get(sessionId).timer);
      cacheTimers.delete(sessionId);
      console.log(`[CacheService] Stream: timer paused for ${sessionId} during generation`);
    }
    // Extend DB expires_at so the UI doesn't show "Expired" while we're streaming
    pool.query(
      'UPDATE gemini_cache_sessions SET expires_at=$1 WHERE session_id=$2',
      [new Date(Date.now() + 900 * 1000), sessionId]
    ).catch(console.warn);
    console.log(`[CacheService] Stream: re-using active session ${sessionId} for file ${fileId}`);
  }

  if (!sessionId) {
    onStatus?.({ status: 'initializing', message: 'Creating document cache...' });
    console.log(`[CacheService] Stream: no active cache for file ${fileId} — creating lazily`);
    const fileBuffer = await getFileBuffer();
    const cacheStatus = await createCacheFromFile(
      fileBuffer,
      mimetype,
      filename,
      displayName,
      'gemini-2.5-flash',
      null,
      fileId,
      true,
      systemInstruction
    );
    sessionId = cacheStatus.sessionId;
    console.log(`[CacheService] Stream: new session ${sessionId} created for file ${fileId}`);
  }

  // 2. Load session row
  const sessionRes = await pool.query(
    "SELECT * FROM gemini_cache_sessions WHERE session_id = $1 AND status = 'active'",
    [sessionId]
  );
  if (!sessionRes.rows.length) throw new Error('Cache session not found or has expired.');
  const session = sessionRes.rows[0];

  const apiKey = getApiKey();
  const genAI  = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModelFromCachedContent({
    name: session.cache_name,
    model: session.model_name,
  });

  // 3. Build conversation history from the user's chat session (file_chats), not the cache row id
  const history = await getConversationHistory(chatSessionId || sessionId);
  const historyTurns = history.length / 2;
  const historyChars = history.reduce((sum, h) => sum + (h.parts?.[0]?.text?.length || 0), 0);
  console.log(
    `\n📜 [CacheService stream] History sent with this prompt` +
    `\n   turns included : ${historyTurns} (max ${MAX_HISTORY_TURNS})` +
    `\n   history chars  : ${historyChars}  |  estimated tokens : ~${Math.round(historyChars / 4)}`
  );
  if (historyTurns > 0) {
    for (let i = 0; i < history.length; i += 2) {
      const q = (history[i]?.parts?.[0]?.text || '').substring(0, 120);
      const a = (history[i + 1]?.parts?.[0]?.text || '').substring(0, 120);
      const qLen = (history[i]?.parts?.[0]?.text || '').length;
      const aLen = (history[i + 1]?.parts?.[0]?.text || '').length;
      console.log(
        `   [Turn ${i / 2 + 1}]` +
        `\n      Q (${qLen} chars): ${q}${qLen > 120 ? '…' : ''}` +
        `\n      A (${aLen} chars): ${a}${aLen > 120 ? '…' : ''}`
      );
    }
  }

  const contents = [
    ...history,
    { role: 'user', parts: [{ text: question }] },
  ];

  onStatus?.({ status: 'generating', message: 'Generating response...' });

  // 4. Stream the response with conversation context
  const streamResult = await model.generateContentStream({ contents });

  let fullAnswer = '';
  for await (const chunk of streamResult.stream) {
    const piece = chunk.text();
    if (piece) {
      fullAnswer += piece;
      onChunk?.(piece);
    }
  }

  // 5. Token accounting (from aggregated response — available after stream exhausted)
  const finalResponse = await streamResult.response;
  const usage           = finalResponse.usageMetadata || {};
  const cachedTokens    = usage.cachedContentTokenCount || 0;
  const totalInputTokens= usage.promptTokenCount         || 0;
  const newPromptTokens = Math.max(0, totalInputTokens - cachedTokens);
  const outputTokens    = usage.candidatesTokenCount     || 0;

  console.log(
    `\n📊 [CacheService stream] Token Summary` +
    `\n   cached tokens  : ${cachedTokens}` +
    `\n   new prompt     : ${newPromptTokens}` +
    `\n   output tokens  : ${outputTokens}` +
    `\n   total input    : ${totalInputTokens}` +
    `\n   max_output cap : (set by Gemini cache model default — no explicit cap sent)`
  );

  const pricing    = getPricing();
  const cachedCost = cachedTokens    * (pricing.cachedInputRate / 1_000_000);
  const promptCost = newPromptTokens * (pricing.newInputRate    / 1_000_000);
  const outputCost = outputTokens    * (pricing.outputRate      / 1_000_000);
  const queryCost  = cachedCost + promptCost + outputCost;

  await dbInsertQueryLog(sessionId, { promptTokens: newPromptTokens, cachedTokens, outputTokens, queryCost });
  // When chatSessionId is supplied, askQuestionStream saves via FileChat.saveChat.
  if (!chatSessionId) {
    const turnQuestion = historyQuestion || question;
    await dbStoreCacheTurn(fileId, userId, sessionId, turnQuestion, fullAnswer);
  }
  await dbAccumulateUsage(sessionId, {
    cachedTokens, newPromptTokens, outputTokens,
    inputCost: cachedCost + promptCost, outputCost,
  });

  // 8. Start 2-minute inactivity timer AFTER the full response has been streamed
  await startInactivityTimer(sessionId);

  // 9. Build cross-session file status
  const fileStatus = await getStatusForFile(fileId);

  return {
    answer: fullAnswer,
    tokenUsage: { cachedTokens, newPromptTokens, outputTokens, totalInputTokens, queryCost, cachedCost, promptCost, outputCost },
    sessionMetrics: fileStatus,
  };
}

// ── Restore timers on startup ─────────────────────────────────────────────────

async function initActiveSessionsFromDb() {
  try {
    const res = await pool.query(
      "SELECT session_id, expires_at FROM gemini_cache_sessions WHERE status='active'"
    );
    console.log(`[CacheService] Restoring ${res.rows.length} active session(s)...`);

    for (const row of res.rows) {
      const now       = Date.now();
      const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : now;
      const remainMs  = Math.max(0, expiresAt - now);

      if (remainMs > 0) {
        const timer = setTimeout(async () => {
          await deleteCache(row.session_id, 'inactivity_timeout').catch(console.error);
        }, remainMs);
        cacheTimers.set(row.session_id, { timer, expiresAt });
        console.log(`[CacheService] Timer restored for ${row.session_id} (${Math.ceil(remainMs / 1000)}s left)`);
      } else {
        deleteCache(row.session_id, 'inactivity_timeout').catch(console.error);
      }
    }
  } catch (err) {
    console.error('[CacheService] Failed to restore sessions from DB:', err.message);
  }
}

initActiveSessionsFromDb();

module.exports = {
  createCache,
  createCacheFromFile,
  askQuestion,
  askWithAutoCache,
  askWithAutoCacheStream,
  getStatus,
  getStatusForFile,
  deleteCache,
  isCacheTooSmallError,
  GEMINI_CACHE_MIN_TOKENS,
};
