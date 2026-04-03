const { VertexAI } = require('@google-cloud/vertexai');
const path = require('path');
const { logLLMUsage } = require('./llmUsageService');
const { resolveVertexModelId } = require('./llmConfigService');

const MODEL_MAX_OUTPUT_TOKENS = {
  'gemini-2.0-flash-lite': 8192,
  'gemini-2.0-flash-lite-001': 8192,
  'gemini-2.0-flash': 8192,
  'gemini-2.0-flash-001': 8192,
  'gemini-2.5-flash': 8192,
  'gemini-2.5-flash-001': 8192,
  'gemini-2.5-flash-lite': 8192,
  'gemini-2.5-pro': 8192,
};

const MODEL_FALLBACKS = {
  'gemini-flash-lite-latest': [
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash-lite-001',
  ],
  'gemini-flash-lite': [
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash-lite-001',
  ],
  'gemini-pro-latest': [
    'gemini-2.5-flash',
    'gemini-2.5-flash-001',
    'gemini-2.5-flash-lite',
  ],
  'gemini-pro': [
    'gemini-2.5-flash',
    'gemini-2.5-flash-001',
    'gemini-2.5-flash-lite',
  ],
  'gemini-2.0-flash-lite': [
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash-lite-001',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
  ],
  'gemini-2.0-flash-lite-001': [
    'gemini-2.0-flash-lite-001',
    'gemini-2.0-flash-lite',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
  ],
  'gemini-2.0-flash': [
    'gemini-2.0-flash',
    'gemini-2.0-flash-001',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
  ],
  'gemini-2.0-flash-001': [
    'gemini-2.0-flash-001',
    'gemini-2.0-flash',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
  ],
  'gemini-2.5-flash-lite': [
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.0-flash-lite',
  ],
  'gemini-2.5-flash': [
    'gemini-2.5-flash',
    'gemini-2.5-flash-001',
    'gemini-2.5-flash-lite',
  ],
  'gemini-2.5-flash-001': [
    'gemini-2.5-flash-001',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
  ],
};

function assertSupportedProvider(llmConfig) {
  const provider = String(llmConfig?.llm_provider || 'google').trim().toLowerCase();
  if (provider !== 'google') {
    throw new Error(`Unsupported llm_provider "${provider}" in llm_chat_config. ChatModel currently supports only "google".`);
  }
  return provider;
}

function getGCSProjectId() {
  try {
    if (process.env.GCP_PROJECT_ID) {
      return process.env.GCP_PROJECT_ID;
    }

    if (process.env.GCS_KEY_BASE64) {
      const jsonString = Buffer.from(process.env.GCS_KEY_BASE64, 'base64').toString('utf-8');
      const credentials = JSON.parse(jsonString);
      if (credentials.project_id) {
        return credentials.project_id;
      }
    }

    throw new Error('GCP_PROJECT_ID not found. Set GCP_PROJECT_ID in .env');
  } catch (error) {
    console.error('Failed to get GCP Project ID:', error.message);
    throw error;
  }
}

let vertexAI;
function initializeVertexAI() {
  if (vertexAI) return vertexAI;

  try {
    const projectId = getGCSProjectId();
    const location = process.env.GCP_LOCATION || 'us-central1';

    console.log(`Initializing Vertex AI for project: ${projectId}, location: ${location}`);

    vertexAI = new VertexAI({
      project: projectId,
      location,
    });

    return vertexAI;
  } catch (error) {
    console.error('Failed to initialize Vertex AI:', error.message);
    throw new Error(`Vertex AI initialization failed: ${error.message}`);
  }
}

function normalizeGcsUris(gcsUriOrUris) {
  if (Array.isArray(gcsUriOrUris)) {
    return gcsUriOrUris.filter((u) => typeof u === 'string' && u.startsWith('gs://'));
  }
  if (typeof gcsUriOrUris === 'string' && gcsUriOrUris.startsWith('gs://')) {
    return [gcsUriOrUris];
  }
  return [];
}

function buildFilePartsFromGcsUris(uris) {
  return uris.map((uri) => ({
    fileData: { mimeType: getMimeTypeFromPath(uri), fileUri: uri },
  }));
}

function aggregateCandidateText(candidate) {
  if (!candidate?.content?.parts?.length) return '';
  let out = '';
  for (const part of candidate.content.parts) {
    if (part.text) out += part.text;
  }
  return out;
}

function getMimeTypeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.csv': 'text/csv',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

function normalizeModelName(modelName) {
  if (!modelName) return '';
  return String(modelName).trim().replace(/^models\//i, '');
}

function dedupeModelNames(modelNames) {
  const seen = new Set();
  const deduped = [];

  for (const modelName of modelNames) {
    const normalized = normalizeModelName(modelName);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
  }

  return deduped;
}

function buildModelList(llmConfig, preferredModelName = '') {
  assertSupportedProvider(llmConfig);
  const preferred = normalizeModelName(preferredModelName);
  const resolved = normalizeModelName(resolveVertexModelId(llmConfig));
  const raw = normalizeModelName(llmConfig?.llm_model);
  const aliasMap = llmConfig?.model_alias_map || {};
  const aliasResolved = raw
    ? normalizeModelName(aliasMap[raw.toLowerCase()] || aliasMap[raw] || '')
    : '';

  const candidates = dedupeModelNames([
    ...(preferred ? [preferred] : []),
    resolved,
    raw,
    aliasResolved,
    ...(MODEL_FALLBACKS[resolved] || []),
    ...(MODEL_FALLBACKS[raw] || []),
    ...(MODEL_FALLBACKS[aliasResolved] || []),
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
  ]);

  if (!candidates.length) {
    throw new Error(
      'LLM model is not configured: set llm_model and/or vertex_model_id in llm_chat_config (migration 003).'
    );
  }

  return candidates;
}

/**
 * When max output is limited (below model cap), tell the model to stay complete and concise
 * so answers are not cut off mid-sentence at MAX_TOKENS.
 */
function buildOutputBudgetHint(maxOutputTokens) {
  const n = Math.floor(Number(maxOutputTokens));
  if (!Number.isFinite(n) || n < 1) return '';
  const MODEL_CAP = 8192;
  if (n >= MODEL_CAP) return '';
  const approxWords = Math.max(40, Math.floor(n * 0.65));
  return `\n\n---\nOUTPUT LENGTH (required): The server allows about ${n} output tokens (~${approxWords} words). Reply with a complete, self-contained answer: use short paragraphs or bullet points, cover only what fits, finish every sentence, and end with a clear closing line. Do not begin detailed sections you cannot complete. If the topic is broad, give a structured summary of the most important points only.\n---`;
}

/** Short system line for tight budgets (paired with buildOutputBudgetHint). */
function buildBudgetSystemInstruction(maxOutputTokens) {
  const n = Math.floor(Number(maxOutputTokens));
  if (!Number.isFinite(n) || n < 1) return '';
  if (n >= 8192) return '';
  return 'Always produce a finished answer within the output budget: concise, structured, and with no incomplete sentences or trailing fragments.';
}

function buildGenerationConfig(llmConfig, modelName = '') {
  const minOut = Number(llmConfig?.min_output_tokens);
  const cap = Number(llmConfig?.max_output_tokens_cap);
  const minT = Number.isFinite(minOut) && minOut >= 1 ? Math.floor(minOut) : 1;
  const maxCap = Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : 1;

  const raw = Number(llmConfig?.max_output_tokens);
  let maxOutputTokens;
  if (!Number.isFinite(raw) || raw < minT) {
    console.warn(
      `[LLMConfig] max_output_tokens=${llmConfig?.max_output_tokens} invalid, using min_output_tokens (${minT}) from DB`
    );
    maxOutputTokens = minT;
  } else {
    maxOutputTokens = Math.min(Math.floor(raw), maxCap);
  }

  const modelCap = MODEL_MAX_OUTPUT_TOKENS[normalizeModelName(modelName)];
  if (Number.isFinite(modelCap)) {
    maxOutputTokens = Math.min(maxOutputTokens, modelCap);
  }

  let tMin = Number(llmConfig?.temperature_min);
  let tMax = Number(llmConfig?.temperature_max);
  if (!Number.isFinite(tMin)) tMin = 0;
  if (!Number.isFinite(tMax)) tMax = 2;
  if (tMin > tMax) {
    const x = tMin;
    tMin = tMax;
    tMax = x;
  }

  let temperature =
    llmConfig?.model_temperature != null ? Number(llmConfig.model_temperature) : 1;
  if (!Number.isFinite(temperature)) temperature = 1;
  temperature = Math.min(tMax, Math.max(tMin, temperature));

  return { maxOutputTokens, temperature };
}

/** Normalize one Vertex stream chunk to text (handles parts + delta + text getter). */
function extractVertexStreamChunkText(chunk) {
  if (!chunk) return '';
  let chunkText = '';
  try {
    const t = chunk.text;
    if (typeof t === 'function') {
      const out = t.call(chunk);
      if (out) chunkText += String(out);
    } else if (t) {
      chunkText += String(t);
    }
  } catch {
    // ignore SDK text() errors
  }
  if (chunkText) return chunkText;
  const candidate = chunk.candidates?.[0];
  if (!candidate) return '';
  if (candidate.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.text) chunkText += part.text;
    }
  } else if (candidate.delta?.content?.parts) {
    for (const part of candidate.delta.content.parts) {
      if (part.text) chunkText += part.text;
    }
  }
  return chunkText;
}

/**
 * Token counts for `llm_usage_logs.total_tokens` (global daily pool sums this column).
 * Vertex streaming sometimes omits usageMetadata or only sets totalTokenCount — never log 0 for a successful call.
 */
function normalizeVertexUsageForLog(agg, streamedCharCount = 0) {
  const um = agg?.usageMetadata;
  let prompt = 0;
  let candidates = 0;
  let totalFromApi = 0;
  if (um) {
    prompt = Number(um.promptTokenCount) || 0;
    candidates = Number(um.candidatesTokenCount) || 0;
    totalFromApi = Number(um.totalTokenCount) || 0;
  }
  let total = totalFromApi;
  if (!total && (prompt || candidates)) {
    total = prompt + candidates;
  }
  if (!total && streamedCharCount > 0) {
    total = Math.max(1, Math.ceil(streamedCharCount / 4));
    candidates = total;
    prompt = 0;
    console.warn(
      `[LLM Usage] Vertex usageMetadata missing or zero; estimated ~${total} tokens from ${streamedCharCount} streamed chars`
    );
  }
  if (!total) {
    total = 1;
    candidates = 1;
    prompt = 0;
    console.warn(
      '[LLM Usage] No usage metadata and no streamed text; logging 1 token so quota counters still advance.'
    );
  }
  if (total > 0 && prompt === 0 && candidates === 0) {
    candidates = total;
  }
  return { inputTokens: prompt, outputTokens: candidates, totalTokens: total };
}

async function askLLMWithGCS(question, gcsUriOrUris, userContext = '', metadata = {}) {
  try {
    const vertex_ai = initializeVertexAI();

    const uris = normalizeGcsUris(gcsUriOrUris);
    if (!uris.length) throw new Error('Invalid GCS URI(s)');

    let promptText = question;
    if (userContext) {
      promptText = `USER CONTEXT:\n${userContext}\n\nUSER QUESTION: ${question}`;
    }

    const llmConfig = metadata.llmConfig || null;
    const modelNames = buildModelList(llmConfig, metadata.modelName);

    let lastError;
    let usageData = null;

    console.log('\n[LLM askLLMWithGCS] Using DB config:');
    console.log(`   - primary model    : ${modelNames[0]}`);
    console.log(`   - fallback models  : ${modelNames.slice(1).join(', ') || 'none'}`);
    console.log(`   - gcs document(s) : ${uris.length}`);

    for (const modelName of modelNames) {
      try {
        const generationConfig = buildGenerationConfig(llmConfig, modelName);
        console.log(`Attempting Vertex AI model: ${modelName}`);
        console.log(`   - max_output_tokens: ${generationConfig.maxOutputTokens}`);
        console.log(`   - temperature      : ${generationConfig.temperature}`);

        const budgetHint = buildOutputBudgetHint(generationConfig.maxOutputTokens);
        const userText = budgetHint ? `${promptText}${budgetHint}` : promptText;
        const sysBudget = buildBudgetSystemInstruction(generationConfig.maxOutputTokens);
        const chatModelSys = metadata.chatModelSystemInstruction || '';
        const mergedSystem = [chatModelSys, sysBudget].filter(Boolean).join('\n\n');
        const model = vertex_ai.getGenerativeModel({
          model: modelName,
          ...(mergedSystem ? { systemInstruction: { parts: [{ text: mergedSystem }] } } : {}),
        });
        const fileParts = buildFilePartsFromGcsUris(uris);

        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [...fileParts, { text: userText }] }],
          generationConfig,
        });

        if (!result.response?.candidates?.length) {
          throw new Error('Empty response from Vertex AI');
        }

        const cand0 = result.response.candidates[0];
        let text = aggregateCandidateText(cand0);
        if (!text && cand0.content?.parts?.[0]?.text) {
          text = cand0.content.parts[0].text;
        }

        if (result.response.usageMetadata) {
          const um = result.response.usageMetadata;
          const p = um.promptTokenCount || 0;
          const c = um.candidatesTokenCount || 0;
          const t = um.totalTokenCount || 0;
          usageData = {
            inputTokens: p,
            outputTokens: c,
            totalTokens: t > 0 ? t : p + c,
            modelName,
          };
          console.log(
            `Token usage - Input: ${usageData.inputTokens}, Output: ${usageData.outputTokens}, Total: ${usageData.totalTokens}`
          );
        }

        console.log(`Success with model: ${modelName}`);

        if (metadata.userId && usageData) {
          logLLMUsage({
            userId: metadata.userId,
            modelName: usageData.modelName,
            inputTokens: usageData.inputTokens,
            outputTokens: usageData.outputTokens,
            totalTokens: usageData.totalTokens,
            endpoint: metadata.endpoint || '/api/chat/ask',
            fileId: metadata.fileId,
            sessionId: metadata.sessionId,
          }).catch(err => console.error('Failed to log LLM usage:', err.message));
        }

        return text;
      } catch (err) {
        console.warn(`Model ${modelName} failed: ${err.message}`);
        lastError = err;
      }
    }

    throw new Error(`All Vertex AI models failed. Last error: ${lastError?.message}`);
  } catch (error) {
    console.error('Fatal Error in askLLMWithGCS:', error.message);
    throw error;
  }
}

async function* streamLLMWithGCS(question, gcsUriOrUris, userContext = '', metadata = {}) {
  try {
    const vertex_ai = initializeVertexAI();

    const uris = normalizeGcsUris(gcsUriOrUris);
    if (!uris.length) throw new Error('Invalid GCS URI(s)');

    let promptText = question;
    if (userContext) {
      promptText = `USER CONTEXT:\n${userContext}\n\nUSER QUESTION: ${question}`;
    }

    const llmConfig = metadata.llmConfig || null;
    const modelNames = buildModelList(llmConfig, metadata.modelName);

    console.log('\n[LLM streamLLMWithGCS] Using DB config:');
    console.log(`   - primary model    : ${modelNames[0]}`);
    console.log(`   - fallback models  : ${modelNames.slice(1).join(', ') || 'none'}`);
    console.log(`   - gcs document(s) : ${uris.length}`);

    let lastError;

    for (const modelName of modelNames) {
      try {
        const generationConfig = buildGenerationConfig(llmConfig, modelName);
        console.log(`Streaming with Vertex AI model: ${modelName}`);
        console.log(`   - max_output_tokens: ${generationConfig.maxOutputTokens}`);
        console.log(`   - temperature      : ${generationConfig.temperature}`);

        const budgetHint = buildOutputBudgetHint(generationConfig.maxOutputTokens);
        const userText = budgetHint ? `${promptText}${budgetHint}` : promptText;
        const sysBudget = buildBudgetSystemInstruction(generationConfig.maxOutputTokens);
        const chatModelSys = metadata.chatModelSystemInstruction || '';
        const mergedSystem = [chatModelSys, sysBudget].filter(Boolean).join('\n\n');
        const model = vertex_ai.getGenerativeModel({
          model: modelName,
          ...(mergedSystem ? { systemInstruction: { parts: [{ text: mergedSystem }] } } : {}),
        });
        const fileParts = buildFilePartsFromGcsUris(uris);

        const streamingResp = await model.generateContentStream({
          contents: [{ role: 'user', parts: [...fileParts, { text: userText }] }],
          generationConfig,
        });

        let totalChunks = 0;
        let streamedLen = 0;
        for await (const chunk of streamingResp.stream) {
          const chunkText = extractVertexStreamChunkText(chunk);
          if (chunkText.length > 0) {
            totalChunks++;
            streamedLen += chunkText.length;
            yield chunkText;
          }
        }

        let agg = null;
        try {
          agg = await streamingResp.response;
          const cand = agg?.candidates?.[0];
          const finishReason = cand?.finishReason;
          if (finishReason === 'MAX_TOKENS') {
            console.warn(
              `[LLM streamLLMWithGCS] finishReason=MAX_TOKENS — model hit output cap (${generationConfig.maxOutputTokens}). Increase max_output_tokens in llm_chat_config if answers should be longer.`
            );
          }
          const fullText = aggregateCandidateText(cand);
          if (fullText && fullText.length > streamedLen) {
            const tail = fullText.slice(streamedLen);
            if (tail.length > 0) {
              console.warn(`[LLM streamLLMWithGCS] Appending ${tail.length} chars from aggregated response (stream delta gap).`);
              yield tail;
            }
          }
        } catch (e) {
          console.warn('[LLM streamLLMWithGCS] Could not read final aggregated response:', e?.message || e);
        }

        let textLenForUsage = streamedLen;
        if (agg?.candidates?.[0]) {
          const aggText = aggregateCandidateText(agg.candidates[0]);
          if (aggText && aggText.length > textLenForUsage) textLenForUsage = aggText.length;
        }

        if (metadata.userId) {
          const u = normalizeVertexUsageForLog(agg, textLenForUsage);
          logLLMUsage({
            userId: Number(metadata.userId),
            modelName,
            inputTokens: u.inputTokens,
            outputTokens: u.outputTokens,
            totalTokens: u.totalTokens,
            endpoint: metadata.endpoint || '/api/chat/ask/stream',
            fileId: metadata.fileId ?? null,
            sessionId: metadata.sessionId ?? null,
          }).catch((err) => console.error('Failed to log LLM usage:', err.message));
        }

        console.log(`Streamed ${totalChunks} chunks from ${modelName}`);
        return;
      } catch (err) {
        console.warn(`Model ${modelName} streaming failed: ${err.message}`);
        lastError = err;
      }
    }

    throw new Error(`All Vertex AI models failed for streaming. Last error: ${lastError?.message}`);
  } catch (error) {
    console.error('Fatal Error in streamLLMWithGCS:', error.message);
    throw error;
  }
}

async function* streamLLMGeneral(promptText, systemInstruction = '', llmConfig = null, metadata = {}) {
  try {
    const vertex_ai = initializeVertexAI();
    const modelNames = buildModelList(llmConfig, metadata.modelName);

    console.log('\n[LLM streamLLMGeneral] Using DB config:');
    console.log(`   - primary model    : ${modelNames[0]}`);
    console.log(`   - fallback models  : ${modelNames.slice(1).join(', ') || 'none'}`);

    let lastError;

    for (const modelName of modelNames) {
      try {
        const generationConfig = buildGenerationConfig(llmConfig, modelName);
        console.log(`[General] Streaming with Vertex AI model: ${modelName}`);
        console.log(`   - max_output_tokens: ${generationConfig.maxOutputTokens}`);
        console.log(`   - temperature      : ${generationConfig.temperature}`);

        const budgetHint = buildOutputBudgetHint(generationConfig.maxOutputTokens);
        const userText = budgetHint ? `${promptText}${budgetHint}` : promptText;
        const sysBudget = buildBudgetSystemInstruction(generationConfig.maxOutputTokens);
        const mergedSystem = [systemInstruction, sysBudget].filter(Boolean).join('\n\n');

        const model = vertex_ai.getGenerativeModel({
          model: modelName,
          ...(mergedSystem ? { systemInstruction: { parts: [{ text: mergedSystem }] } } : {}),
        });

        const streamingResp = await model.generateContentStream({
          contents: [{ role: 'user', parts: [{ text: userText }] }],
          generationConfig,
        });

        let totalChunks = 0;
        let streamedChars = 0;
        for await (const chunk of streamingResp.stream) {
          const chunkText = extractVertexStreamChunkText(chunk);
          if (chunkText.length > 0) {
            totalChunks++;
            streamedChars += chunkText.length;
            yield chunkText;
          }
        }

        let agg = null;
        try {
          agg = await streamingResp.response;
        } catch (e) {
          console.warn('[LLM streamLLMGeneral] Could not read aggregate response:', e?.message || e);
        }

        let textLenForUsage = streamedChars;
        if (agg?.candidates?.[0]) {
          const aggText = aggregateCandidateText(agg.candidates[0]);
          if (aggText && aggText.length > textLenForUsage) textLenForUsage = aggText.length;
        }

        if (metadata.userId) {
          const u = normalizeVertexUsageForLog(agg, textLenForUsage);
          logLLMUsage({
            userId: Number(metadata.userId),
            modelName,
            inputTokens: u.inputTokens,
            outputTokens: u.outputTokens,
            totalTokens: u.totalTokens,
            endpoint: metadata.endpoint || '/api/chat/ask/general/stream',
            fileId: metadata.fileId ?? null,
            sessionId: metadata.sessionId ?? null,
          }).catch((err) => console.error('Failed to log LLM usage:', err.message));
        }

        console.log(`[General] Streamed ${totalChunks} chunks from ${modelName}`);
        return;
      } catch (err) {
        console.warn(`[General] Model ${modelName} streaming failed: ${err.message}`);
        lastError = err;
      }
    }

    throw new Error(`All Vertex AI models failed for general streaming. Last error: ${lastError?.message}`);
  } catch (error) {
    console.error('Fatal Error in streamLLMGeneral:', error.message);
    throw error;
  }
}

module.exports = { askLLMWithGCS, streamLLMWithGCS, streamLLMGeneral };
