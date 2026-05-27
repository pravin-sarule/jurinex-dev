const { GoogleGenAI, createPartFromUri } = require('@google/genai');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { logLLMUsage } = require('./llmUsageService');
const { resolveVertexModelId } = require('./llmConfigService');
const {
  getObjectMetadata,
  downloadObjectBuffer,
  uploadBufferViaSignedUrl,
} = require('./gcsService');

const VERTEX_FILE_SIZE_LIMIT_BYTES = 50 * 1024 * 1024;
const PDF_CHUNK_TARGET_BYTES = 48 * 1024 * 1024;

// Per-model output caps removed — use llm_chat_config.max_output_tokens and max_output_tokens_cap only.

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
  'gemini-2.5-pro': [
    'gemini-2.5-pro',
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
function getGoogleAuthOptions() {
  if (!process.env.GCS_KEY_BASE64) return undefined;

  try {
    const jsonString = Buffer.from(process.env.GCS_KEY_BASE64, 'base64').toString('utf-8');
    const credentials = JSON.parse(jsonString);
    if (credentials?.client_email && credentials?.private_key) {
      return { credentials };
    }
  } catch (error) {
    console.warn(`[LLM] Failed to parse GCS_KEY_BASE64 for Vertex auth: ${error.message}`);
  }

  return undefined;
}

function initializeVertexAI() {
  if (vertexAI) return vertexAI;

  try {
    const projectId = getGCSProjectId();
    const location = process.env.GCP_LOCATION || 'us-central1';

    console.log(`Initializing Vertex AI for project: ${projectId}, location: ${location}`);

    vertexAI = new GoogleGenAI({
      vertexai: true,
      project: projectId,
      location,
      googleAuthOptions: getGoogleAuthOptions(),
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
  return uris.map((uri) => createPartFromUri(uri, getMimeTypeFromPath(uri)));
}

function parseGcsUri(uri) {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(String(uri || '').trim());
  if (!match) return null;
  return { bucketName: match[1], objectPath: match[2] };
}

function buildTempSessionPrefix(sessionId, sourcePath) {
  const safeSessionId = String(sessionId || `adhoc-${Date.now()}`).replace(/[^a-zA-Z0-9-_]/g, '_');
  const baseName = path.basename(sourcePath, path.extname(sourcePath))
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80) || 'document';
  return `tmp/${safeSessionId}/${baseName}`;
}

function buildUnifiedDocumentNotice(segmentGroups) {
  if (!Array.isArray(segmentGroups) || !segmentGroups.length) {
    return '';
  }

  const lines = [
    'Context header: some attached files are sequential segments of one larger source document.',
    'Treat every segment from the same source as one unified document, not as separate sources.',
    'Synthesize information across all segments before answering.',
  ];

  for (const group of segmentGroups) {
    lines.push(
      `Source "${group.sourceName}" is split into ${group.partCount} parts covering pages 1-${group.pageCount}.`
    );
  }

  return lines.join('\n');
}

function buildPreparedFileDescriptor(sourceUri, expandedUris, wasSplit) {
  return {
    source_gcs_uri: sourceUri,
    was_split: !!wasSplit,
    active_gcs_uris: expandedUris,
    split_gcs_uris: wasSplit ? expandedUris : [],
  };
}

async function splitPdfIntoGcsParts(sourceUri, sessionId) {
  const parsed = parseGcsUri(sourceUri);
  if (!parsed) {
    throw new Error(`Invalid GCS URI: ${sourceUri}`);
  }

  const metadata = await getObjectMetadata(parsed.bucketName, parsed.objectPath);
  const totalSize = Number(metadata?.size || 0);
  if (!Number.isFinite(totalSize) || totalSize <= VERTEX_FILE_SIZE_LIMIT_BYTES) {
    return {
      uris: [sourceUri],
      split: false,
      segmentGroup: null,
      preparedFile: buildPreparedFileDescriptor(sourceUri, [sourceUri], false),
    };
  }

  if (getMimeTypeFromPath(parsed.objectPath) !== 'application/pdf') {
    throw new Error(
      `File ${path.basename(parsed.objectPath)} exceeds 50 MB and is not a PDF, so it cannot be page-split for Vertex AI.`
    );
  }

  console.log(`[LLM] Splitting oversized PDF for Vertex AI: ${sourceUri} (${totalSize} bytes)`);
  const buffer = await downloadObjectBuffer(parsed.bucketName, parsed.objectPath);
  const sourcePdf = await PDFDocument.load(buffer);
  const totalPages = sourcePdf.getPageCount();
  if (!totalPages) {
    throw new Error(`PDF ${path.basename(parsed.objectPath)} contains no pages.`);
  }

  const estimatedChunkCount = Math.max(2, Math.ceil(totalSize / PDF_CHUNK_TARGET_BYTES));
  const estimatedPagesPerChunk = Math.max(1, Math.ceil(totalPages / estimatedChunkCount));
  const tempPrefix = buildTempSessionPrefix(sessionId, parsed.objectPath);
  const partUris = [];
  const pageRanges = [];

  let startPage = 0;
  let partIndex = 1;

  while (startPage < totalPages) {
    let endPage = Math.min(totalPages, startPage + estimatedPagesPerChunk);
    let chunkBuffer = null;

    while (endPage > startPage) {
      const chunkDoc = await PDFDocument.create();
      const pageIndexes = Array.from({ length: endPage - startPage }, (_, idx) => startPage + idx);
      const copiedPages = await chunkDoc.copyPages(sourcePdf, pageIndexes);
      copiedPages.forEach((page) => chunkDoc.addPage(page));
      chunkBuffer = Buffer.from(await chunkDoc.save());

      if (chunkBuffer.length <= PDF_CHUNK_TARGET_BYTES || endPage - startPage === 1) {
        if (endPage - startPage === 1 && chunkBuffer.length > VERTEX_FILE_SIZE_LIMIT_BYTES) {
          throw new Error(
            `Page ${startPage + 1} of ${path.basename(parsed.objectPath)} is larger than the Vertex AI file limit even by itself, so the PDF cannot be split safely.`
          );
        }
        break;
      }

      endPage -= 1;
    }

    if (!chunkBuffer || !chunkBuffer.length) {
      throw new Error(`Failed to generate PDF chunk for ${sourceUri}`);
    }

    const objectPath = `${tempPrefix}/part_${partIndex}.pdf`;
    const partUri = await uploadBufferViaSignedUrl(parsed.bucketName, objectPath, chunkBuffer, 'application/pdf');
    partUris.push(partUri);
    pageRanges.push(`pages ${startPage + 1}-${endPage}`);
    startPage = endPage;
    partIndex += 1;
  }

  console.log(
    `[LLM] Created ${partUris.length} PDF part(s) for ${path.basename(parsed.objectPath)}: ${pageRanges.join(', ')}`
  );

  return {
    uris: partUris,
    split: true,
    segmentGroup: {
      sourceName: path.basename(parsed.objectPath),
      partCount: partUris.length,
      pageCount: totalPages,
    },
    preparedFile: buildPreparedFileDescriptor(sourceUri, partUris, true),
  };
}

async function prepareGcsUrisForVertex(gcsUris, metadata = {}) {
  const normalizedUris = normalizeGcsUris(gcsUris);
  if (!normalizedUris.length) {
    throw new Error('Invalid GCS URI(s)');
  }

  const expandedUris = [];
  const segmentGroups = [];
  const preparedFiles = [];

  for (const uri of normalizedUris) {
    const parsed = parseGcsUri(uri);
    if (!parsed) {
      throw new Error(`Invalid GCS URI: ${uri}`);
    }

    const objectMetadata = await getObjectMetadata(parsed.bucketName, parsed.objectPath);
    const totalSize = Number(objectMetadata?.size || 0);
    const isPdf = getMimeTypeFromPath(parsed.objectPath) === 'application/pdf';

    if (Number.isFinite(totalSize) && totalSize > VERTEX_FILE_SIZE_LIMIT_BYTES && !isPdf) {
      throw new Error(
        `File ${path.basename(parsed.objectPath)} exceeds 50 MB and only PDF files can be split automatically for Vertex AI requests.`
      );
    }

    if (isPdf && Number.isFinite(totalSize) && totalSize > VERTEX_FILE_SIZE_LIMIT_BYTES) {
      const splitResult = await splitPdfIntoGcsParts(uri, metadata.sessionId);
      expandedUris.push(...splitResult.uris);
      if (splitResult.segmentGroup) {
        segmentGroups.push(splitResult.segmentGroup);
      }
      if (splitResult.preparedFile) {
        preparedFiles.push(splitResult.preparedFile);
      }
      continue;
    }

    expandedUris.push(uri);
    preparedFiles.push(buildPreparedFileDescriptor(uri, [uri], false));
  }

  if (typeof metadata.onPreparedFiles === 'function') {
    try {
      metadata.onPreparedFiles(preparedFiles);
    } catch (error) {
      console.warn(`[LLM] Failed to publish prepared file metadata: ${error.message}`);
    }
  }

  return {
    uris: expandedUris,
    contextHeader: buildUnifiedDocumentNotice(segmentGroups),
    preparedFiles,
  };
}

function aggregateCandidateText(candidate) {
  if (!candidate?.content?.parts?.length) return '';
  let out = '';
  for (const part of candidate.content.parts) {
    if (!part?.thought && part.text) out += part.text;
  }
  const thoughtFallback = extractVertexThoughtTextFromCandidate(candidate);
  if (!out.trim()) {
    if (thoughtFallback.trim()) {
      console.warn(
        '[LLM] Candidate had no non-thought text parts; using thought parts as answer fallback.'
      );
      return thoughtFallback;
    }
    return out;
  }
  // Gemini 2.5 Pro may tag the visible body as "thought" after a short header.
  if (thoughtFallback.length > out.length * 2 && thoughtFallback.length > 400) {
    console.warn(
      `[LLM] Thought parts (${thoughtFallback.length} chars) exceed visible answer (${out.length} chars); merging into output.`
    );
    return `${out}\n\n${thoughtFallback}`;
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

const STATIC_MODEL_ALIASES = {
  'gemini-pro-2.5': 'gemini-2.5-pro',
  'gemini-flash-2.5': 'gemini-2.5-flash',
  'gemini-flash-lite-2.5': 'gemini-2.5-flash-lite',
};

function normalizeModelName(modelName) {
  if (!modelName) return '';
  const stripped = String(modelName).trim().replace(/^models\//i, '');
  const key = stripped.toLowerCase();
  return STATIC_MODEL_ALIASES[key] || STATIC_MODEL_ALIASES[stripped] || stripped;
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

  // Return the computed values as-is so plan-level caps are respected.
  // frequency/presence penalties are NOT used: gemini-2.5-flash and related
  // Gemini models reject them with a 400 error on both Google AI Studio and
  // Vertex AI endpoints. Repetition prevention is handled by the system prompt
  // and the frontend circuit breaker instead.
  return { maxOutputTokens, temperature };
}

function extractVertexThoughtTextFromCandidate(candidate) {
  if (!candidate?.content?.parts?.length) return '';
  let out = '';
  for (const part of candidate.content.parts) {
    if (part?.thought && part?.text) out += part.text;
  }
  return out;
}

function extractVertexAnswerTextFromCandidate(candidate) {
  if (!candidate?.content?.parts?.length) return '';
  let out = '';
  for (const part of candidate.content.parts) {
    if (!part?.thought && part?.text) out += part.text;
  }
  return out;
}

function extractVertexStreamChunkPayload(chunk) {
  if (!chunk) return { answerText: '', thoughtText: '' };
  let answerText = '';
  let thoughtText = '';

  const collectParts = (parts = []) => {
    for (const part of parts) {
      if (!part?.text) continue;
      if (part.thought) thoughtText += part.text;
      else answerText += part.text;
    }
  };

  const candidate = chunk.candidates?.[0];
  if (candidate?.content?.parts) collectParts(candidate.content.parts);
  else if (candidate?.delta?.content?.parts) collectParts(candidate.delta.content.parts);

  if (!answerText) {
    try {
      const t = chunk.text;
      if (typeof t === 'function') {
        const out = t.call(chunk);
        if (out) answerText += String(out);
      } else if (t) {
        answerText += String(t);
      }
    } catch {
      // ignore SDK text() errors
    }
  }

  return { answerText, thoughtText };
}

/** Normalize one Vertex stream chunk to text (handles parts + delta + text getter). */
function extractVertexStreamChunkText(chunk) {
  return extractVertexStreamChunkPayload(chunk).answerText;
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

function buildSystemInstructionPart(systemInstruction = '') {
  if (!systemInstruction) return undefined;
  return { role: 'system', parts: [{ text: systemInstruction }] };
}

async function askLLMWithGCS(question, gcsUriOrUris, userContext = '', metadata = {}) {
  try {
    const vertex_ai = initializeVertexAI();
    const preparedContext = await prepareGcsUrisForVertex(gcsUriOrUris, metadata);
    const uris = preparedContext.uris;

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

        const userText = promptText;
        const chatModelSys = metadata.chatModelSystemInstruction || '';
        const mergedSystem = chatModelSys || '';
        const fileParts = buildFilePartsFromGcsUris(uris);
        const contextualParts = preparedContext.contextHeader
          ? [{ text: preparedContext.contextHeader }, ...fileParts]
          : fileParts;

        const result = await vertex_ai.models.generateContent({
          model: modelName,
          contents: [{ role: 'user', parts: [...contextualParts, { text: userText }] }],
          config: {
            ...generationConfig,
            ...(mergedSystem ? { systemInstruction: buildSystemInstructionPart(mergedSystem) } : {}),
          },
        });

        if (!result?.candidates?.length) {
          throw new Error('Empty response from Vertex AI');
        }

        const cand0 = result.candidates[0];
        let text = extractVertexAnswerTextFromCandidate(cand0) || result.text || aggregateCandidateText(cand0);
        if (!text && cand0.content?.parts?.[0]?.text) {
          text = cand0.content.parts[0].text;
        }
        const thoughts = extractVertexThoughtTextFromCandidate(cand0);
        if (typeof metadata.onThoughts === 'function' && thoughts) {
          metadata.onThoughts(thoughts);
        }

        if (result.usageMetadata) {
          const um = result.usageMetadata;
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
            `\n📊 [askLLMWithGCS] Token Summary` +
            `\n   model          : ${modelName}` +
            `\n   max_output_tokens (cap): ${generationConfig.maxOutputTokens}` +
            `\n   input tokens   : ${usageData.inputTokens}` +
            `\n   output tokens  : ${usageData.outputTokens}  (used ${((usageData.outputTokens / generationConfig.maxOutputTokens) * 100).toFixed(1)}% of cap)` +
            `\n   total tokens   : ${usageData.totalTokens}`
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
    const preparedContext = await prepareGcsUrisForVertex(gcsUriOrUris, metadata);
    const uris = preparedContext.uris;

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
      let hasYielded = false;
      try {
        const generationConfig = buildGenerationConfig(llmConfig, modelName);
        console.log(`Streaming with Vertex AI model: ${modelName}`);
        console.log(`   - max_output_tokens: ${generationConfig.maxOutputTokens}`);
        console.log(`   - temperature      : ${generationConfig.temperature}`);

        const userText = promptText;
        const chatModelSys = metadata.chatModelSystemInstruction || '';
        const mergedSystem = chatModelSys || '';
        const fileParts = buildFilePartsFromGcsUris(uris);
        const contextualParts = preparedContext.contextHeader
          ? [{ text: preparedContext.contextHeader }, ...fileParts]
          : fileParts;

        const streamingResp = await vertex_ai.models.generateContentStream({
          model: modelName,
          contents: [{ role: 'user', parts: [...contextualParts, { text: userText }] }],
          config: {
            ...generationConfig,
            ...(mergedSystem ? { systemInstruction: buildSystemInstructionPart(mergedSystem) } : {}),
          },
        });

        let totalChunks = 0;
        let streamedAnswer = '';
        let agg = null;
        for await (const chunk of streamingResp) {
          agg = chunk;
          const { answerText, thoughtText } = extractVertexStreamChunkPayload(chunk);
          if (thoughtText.length > 0) {
            yield { type: 'thought', text: thoughtText };
          }
          if (answerText.length > 0) {
            totalChunks++;
            streamedAnswer += answerText;
            hasYielded = true;
            yield { type: 'chunk', text: answerText };
          } else if (thoughtText.length > 0 && !streamedAnswer.trim()) {
            totalChunks++;
            streamedAnswer += thoughtText;
            hasYielded = true;
            yield { type: 'chunk', text: thoughtText };
            console.warn(
              '[LLM streamLLMWithGCS] Stream chunk had only thought text; using as visible answer.'
            );
          }
        }

        const cand = agg?.candidates?.[0];
        const finishReason = cand?.finishReason;
        const aggText = cand ? aggregateCandidateText(cand) : '';
        if (aggText.length > streamedAnswer.length) {
          const tail = aggText.slice(streamedAnswer.length);
          if (tail.length > 0) {
            totalChunks++;
            streamedAnswer = aggText;
            yield { type: 'chunk', text: tail };
            console.warn(
              `[LLM streamLLMWithGCS] Flushed ${tail.length} chars from final candidate (stream missed tail).`
            );
          }
        }

        if (finishReason === 'MAX_TOKENS') {
          console.warn(
            `[LLM streamLLMWithGCS] finishReason=MAX_TOKENS — model hit output cap (${generationConfig.maxOutputTokens}). Increase max_output_tokens in llm_chat_config if answers should be longer.`
          );
        }

        const textLenForUsage = streamedAnswer.length || (aggText ? aggText.length : 0);
        const u = normalizeVertexUsageForLog(agg, textLenForUsage);

        console.log(
          `\n📊 [streamLLMWithGCS] Token Summary` +
          `\n   model          : ${modelName}` +
          `\n   max_output_tokens (cap): ${generationConfig.maxOutputTokens}` +
          `\n   input tokens   : ${u.inputTokens}` +
          `\n   output tokens  : ${u.outputTokens}  (used ${((u.outputTokens / generationConfig.maxOutputTokens) * 100).toFixed(1)}% of cap)` +
          `\n   total tokens   : ${u.totalTokens}` +
          `\n   finish reason  : ${finishReason || 'STOP'}`
        );

        if (metadata.userId) {
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

        yield {
          type: 'usage',
          inputTokens: u.inputTokens,
          outputTokens: u.outputTokens,
          totalTokens: u.totalTokens,
          modelName,
          finishReason: finishReason || null,
          outputTruncated: finishReason === 'MAX_TOKENS',
        };

        console.log(`Streamed ${totalChunks} chunks from ${modelName}`);
        return;
      } catch (err) {
        console.warn(`Model ${modelName} streaming failed: ${err.message}`);
        lastError = err;
        
        // If we already sent chunks to the user, we CANNOT retry with a fallback model,
        // because it will append a brand new response to the half-finished one, causing duplication!
        if (hasYielded) {
          console.warn(`[LLM] Stream aborted mid-way. Cannot retry. Sending error to frontend.`);
          yield { type: 'error', message: 'Stream interrupted mid-generation.', details: err.message };
          return;
        }
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
      let hasYielded = false;
      try {
        const generationConfig = buildGenerationConfig(llmConfig, modelName);
        console.log(`[General] Streaming with Vertex AI model: ${modelName}`);
        console.log(`   - max_output_tokens: ${generationConfig.maxOutputTokens}`);
        console.log(`   - temperature      : ${generationConfig.temperature}`);

        const userText = promptText;
        const mergedSystem = systemInstruction || '';

        const streamingResp = await vertex_ai.models.generateContentStream({
          model: modelName,
          contents: [{ role: 'user', parts: [{ text: userText }] }],
          config: {
            ...generationConfig,
            ...(mergedSystem ? { systemInstruction: buildSystemInstructionPart(mergedSystem) } : {}),
          },
        });

        let totalChunks = 0;
        let streamedAnswer = '';
        let agg = null;
        for await (const chunk of streamingResp) {
          agg = chunk;
          const { answerText, thoughtText } = extractVertexStreamChunkPayload(chunk);
          if (thoughtText.length > 0) {
            yield { type: 'thought', text: thoughtText };
          }
          if (answerText.length > 0) {
            totalChunks++;
            streamedAnswer += answerText;
            hasYielded = true;
            yield { type: 'chunk', text: answerText };
          } else if (thoughtText.length > 0 && !streamedAnswer.trim()) {
            totalChunks++;
            streamedAnswer += thoughtText;
            hasYielded = true;
            yield { type: 'chunk', text: thoughtText };
            console.warn(
              '[LLM streamLLMWithGCS] Stream chunk had only thought text; using as visible answer.'
            );
          }
        }

        const cand = agg?.candidates?.[0];
        const finishReason = cand?.finishReason;
        const aggText = cand ? aggregateCandidateText(cand) : '';
        if (aggText.length > streamedAnswer.length) {
          const tail = aggText.slice(streamedAnswer.length);
          if (tail.length > 0) {
            totalChunks++;
            streamedAnswer = aggText;
            yield { type: 'chunk', text: tail };
            console.warn(
              `[LLM streamLLMGeneral] Flushed ${tail.length} chars from final candidate (stream missed tail).`
            );
          }
        }

        if (finishReason === 'MAX_TOKENS') {
          console.warn(
            `[LLM streamLLMGeneral] finishReason=MAX_TOKENS — model hit output cap (${generationConfig.maxOutputTokens}).`
          );
        }

        const textLenForUsage = streamedAnswer.length || (aggText ? aggText.length : 0);
        const u = normalizeVertexUsageForLog(agg, textLenForUsage);

        console.log(
          `\n📊 [streamLLMGeneral] Token Summary` +
          `\n   model          : ${modelName}` +
          `\n   max_output_tokens (cap): ${generationConfig.maxOutputTokens}` +
          `\n   input tokens   : ${u.inputTokens}` +
          `\n   output tokens  : ${u.outputTokens}  (used ${((u.outputTokens / generationConfig.maxOutputTokens) * 100).toFixed(1)}% of cap)` +
          `\n   total tokens   : ${u.totalTokens}` +
          `\n   finish reason  : ${finishReason || 'STOP'}`
        );

        if (metadata.userId) {
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

        yield {
          type: 'usage',
          inputTokens: u.inputTokens,
          outputTokens: u.outputTokens,
          totalTokens: u.totalTokens,
          modelName,
          finishReason: finishReason || null,
          outputTruncated: finishReason === 'MAX_TOKENS',
        };

        console.log(`[General] Streamed ${totalChunks} chunks from ${modelName}`);
        return;
      } catch (err) {
        console.warn(`[General] Model ${modelName} streaming failed: ${err.message}`);
        lastError = err;

        if (hasYielded) {
          console.warn(`[General] Stream aborted mid-way. Cannot retry. Sending error to frontend.`);
          yield { type: 'error', message: 'Stream interrupted mid-generation.', details: err.message };
          return;
        }
      }
    }

    throw new Error(`All Vertex AI models failed for general streaming. Last error: ${lastError?.message}`);
  } catch (error) {
    console.error('Fatal Error in streamLLMGeneral:', error.message);
    throw error;
  }
}

/**
 * Count tokens for one or more GCS files using Vertex AI's countTokens API.
 * This is a free, non-generating call — no billing quota consumed.
 * Supports PDFs, images, audio, video, and text via GCS URI.
 *
 * @param {string|string[]} gcsUriOrUris  One or more gs:// URIs
 * @param {string} modelName  The model to use for tokenization (default: gemini-2.5-flash)
 * @returns {Promise<{totalTokens: number, promptTokenCount: number}>}
 */
async function countTokensFromGCS(gcsUriOrUris, modelName = 'gemini-2.5-flash') {
  const vertex_ai = initializeVertexAI();
  const uris = normalizeGcsUris(gcsUriOrUris);
  if (!uris.length) {
    throw new Error('countTokensFromGCS: No valid gs:// URIs provided');
  }

  const fileParts = buildFilePartsFromGcsUris(uris);

  console.log(`[countTokens] Counting tokens for ${uris.length} file(s) with model: ${modelName}`);

  const result = await vertex_ai.models.countTokens({
    model: modelName,
    contents: [{ role: 'user', parts: fileParts }],
  });

  const total = result.totalTokens || 0;
  console.log(`[countTokens] Result: ${total} tokens for ${uris.join(', ')}`);
  return { totalTokens: total, promptTokenCount: total };
}

module.exports = { askLLMWithGCS, streamLLMWithGCS, streamLLMGeneral, countTokensFromGCS };
