const File = require('../models/File');
const { downloadObjectBuffer } = require('../services/gcsService');
const geminiCacheService = require('../services/geminiCacheService');
const { buildChatModelSystemInstruction } = require('../services/chatModelSystemPromptService');
const UserProfileService = require('../services/userProfileService');
const pdfParse = require('pdf-parse');

function getClientSafeCacheError(error) {
  const message = String(error?.message || '');
  if (geminiCacheService.isCacheTooSmallError?.(error)) {
    return 'Document is too small for Gemini context cache; using standard processing instead.';
  }
  if (geminiCacheService.isGeminiApiKeyRevokedError?.(error)) {
    return 'Gemini API key is revoked/blocked (reported as leaked). Caching is temporarily disabled until a new key is configured.';
  }
  if (/fetch failed|undici|ECONN|ETIMEDOUT|ENOTFOUND|network|googleapis/i.test(message)) {
    return 'The Gemini cache service is temporarily unavailable. Retrying without cache.';
  }
  return 'The Gemini cache service could not process this request. Retrying without cache.';
}

/**
 * Helper to extract text from a buffer based on MIME type / filename
 */
async function extractTextFromBuffer(buffer, mimetype, filename) {
  const isPdf = mimetype?.toLowerCase() === 'application/pdf' || filename?.toLowerCase().endsWith('.pdf');
  const isText = mimetype?.toLowerCase() === 'text/plain' || filename?.toLowerCase().endsWith('.txt');
  const isMarkdown = mimetype?.toLowerCase() === 'text/markdown' || filename?.toLowerCase().endsWith('.md');

  if (isPdf) {
    console.log(`[GeminiCacheController] Parsing PDF document (${buffer.length} bytes)...`);
    const data = await pdfParse(buffer);
    return data.text || '';
  } else if (isText || isMarkdown) {
    console.log(`[GeminiCacheController] Parsing text document (${buffer.length} bytes)...`);
    return buffer.toString('utf-8');
  } else {
    // Fallback: try reading as text
    console.log(`[GeminiCacheController] Fallback parsing document as text (${buffer.length} bytes)...`);
    return buffer.toString('utf-8');
  }
}

/**
 * Route handler to create a Gemini Context Cache
 * Accepts documentText directly OR download and extracts text from a file stored in GCS
 */
exports.createCache = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { documentText, file_id, displayName, modelName, customSessionId } = req.body;

    let finalDocumentText = documentText || '';
    let finalDisplayName = displayName || 'Legal Chat Cache';
    const finalModelName = modelName || 'gemini-2.5-flash';
    const authorizationHeader = req.headers.authorization;
    const fullProfile = userId
      ? await UserProfileService.getFullProfile(userId, authorizationHeader)
      : null;
    const systemInstruction = await buildChatModelSystemInstruction(fullProfile);

    // If file_id is provided, download and extract text from the GCS bucket
    if (file_id) {
      console.log(`[GeminiCacheController] Fetching file metadata for file_id: ${file_id}`);
      const fileRecord = await File.findById(file_id);
      if (!fileRecord) {
        return res.status(404).json({
          success: false,
          message: `File record not found for id: ${file_id}`
        });
      }

      if (userId && String(fileRecord.user_id) !== String(userId)) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to access this file.'
        });
      }

      const bucketName = process.env.GCS_BUCKET_NAME;
      if (!bucketName) {
        return res.status(500).json({
          success: false,
          message: 'GCS_BUCKET_NAME environment variable is not configured.'
        });
      }

      const fileBuffer = await downloadObjectBuffer(bucketName, fileRecord.gcs_path);
      if (!fileBuffer) {
        return res.status(400).json({
          success: false,
          message: 'Failed to download document from storage.'
        });
      }

      finalDisplayName = displayName || fileRecord.originalname || 'Legal Chat Cache';
      
      const cacheResult = await geminiCacheService.createCacheFromFile(
        fileBuffer,
        fileRecord.mimetype,
        fileRecord.originalname,
        finalDisplayName,
        finalModelName,
        customSessionId,
        file_id,
        false,
        systemInstruction,
        userId
      );

      return res.status(200).json({
        success: true,
        message: 'Gemini Context Cache created successfully from file. 2-minute inactivity timer started.',
        data: cacheResult
      });
    }

    if (!finalDocumentText || finalDocumentText.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'A non-empty documentText or a valid file_id is required to create a cache.'
      });
    }

    // Call service to create context cache from text
    const cacheResult = await geminiCacheService.createCache(
      finalDocumentText,
      finalDisplayName,
      finalModelName,
      customSessionId,
      null,
      systemInstruction,
      userId
    );

    return res.status(200).json({
      success: true,
      message: 'Gemini Context Cache created successfully. 2-minute inactivity timer started.',
      data: cacheResult
    });

  } catch (error) {
    console.error('[GeminiCacheController] Error in createCache:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to initialize cache session.',
      error: error.message
    });
  }
};

/**
 * Route handler: ask a question via Gemini Context Cache.
 *
 * Accepts { file_id, question, displayName } — NO sessionId required from the client.
 * The service handles the full lifecycle:
 *   • First prompt   → create cache lazily, then ask
 *   • Active session → ask directly (sliding 2-min timer resets)
 *   • Resurrection   → session expired? create fresh cache, ask again
 *
 * Returns { answer, tokenUsage, sessionMetrics } so the frontend never needs
 * to call /cache/create separately.
 */
exports.askQuestion = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { file_id, question, displayName } = req.body;

    if (!file_id) {
      return res.status(400).json({ success: false, message: 'file_id is required.' });
    }
    if (!question || question.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'question is required.' });
    }

    // Verify file ownership
    const fileRecord = await File.findById(file_id);
    if (!fileRecord) {
      return res.status(404).json({ success: false, message: `File not found: ${file_id}` });
    }
    if (userId && String(fileRecord.user_id) !== String(userId)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to access this file.' });
    }

    const bucketName = process.env.GCS_BUCKET_NAME;
    if (!bucketName) {
      return res.status(500).json({ success: false, message: 'GCS_BUCKET_NAME not configured.' });
    }

    // Lazy file download — only executed when the cache must be (re)created
    const getFileBuffer = async () => {
      const buf = await downloadObjectBuffer(bucketName, fileRecord.gcs_path);
      if (!buf) throw new Error('Failed to download document from storage.');
      return buf;
    };

    const finalDisplayName = displayName || fileRecord.originalname || 'Legal Chat Cache';

    const result = await geminiCacheService.askWithAutoCache(
      file_id,
      question.trim(),
      getFileBuffer,
      fileRecord.mimetype,
      fileRecord.originalname,
      finalDisplayName,
      userId
    );

    return res.status(200).json({ success: true, data: result });

  } catch (error) {
    console.error('[GeminiCacheController] Error in askQuestion:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate response using cache.',
      error: error.message,
    });
  }
};

/**
 * Route handler to query cache session status and live cost breakdown
 */
exports.getStatus = async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'sessionId parameter is required.'
      });
    }

    const status = await geminiCacheService.getStatus(sessionId);
    return res.status(200).json({
      success: true,
      data: status
    });

  } catch (error) {
    console.error('[GeminiCacheController] Error in getStatus:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve cache status.',
      error: error.message
    });
  }
};

/**
 * Route handler: stream a cache-backed answer via Server-Sent Events.
 * Emits: status → chunk … chunk → done (or error)
 */
exports.askQuestionStream = async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const userId = req.user?.id;
    const { file_id, question, displayName } = req.body;

    if (!file_id) { send({ type: 'error', message: 'file_id is required.' }); return res.end(); }
    if (!question || question.trim().length === 0) { send({ type: 'error', message: 'question is required.' }); return res.end(); }

    const fileRecord = await File.findById(file_id);
    if (!fileRecord) { send({ type: 'error', message: `File not found: ${file_id}` }); return res.end(); }
    if (userId && String(fileRecord.user_id) !== String(userId)) { send({ type: 'error', message: 'Permission denied.' }); return res.end(); }

    const bucketName = process.env.GCS_BUCKET_NAME;
    if (!bucketName) { send({ type: 'error', message: 'GCS_BUCKET_NAME not configured.' }); return res.end(); }

    const getFileBuffer = async () => {
      const buf = await downloadObjectBuffer(bucketName, fileRecord.gcs_path);
      if (!buf) throw new Error('Failed to download document from storage.');
      return buf;
    };

    const finalDisplayName = displayName || fileRecord.originalname || 'Legal Chat Cache';
    const authorizationHeader = req.headers.authorization;
    const fullProfile = userId
      ? await UserProfileService.getFullProfile(userId, authorizationHeader)
      : null;
    const systemInstruction = await buildChatModelSystemInstruction(fullProfile);

    const result = await geminiCacheService.askWithAutoCacheStream(
      file_id,
      question.trim(),
      getFileBuffer,
      fileRecord.mimetype,
      fileRecord.originalname,
      finalDisplayName,
      (statusData) => send({ type: 'status', status: statusData.status, message: statusData.message }),
      (chunk) => send({ type: 'chunk', text: chunk }),
      userId,
      req.body.session_id || null,
      question.trim(),
      systemInstruction
    );

    send({ type: 'done', answer: result.answer, tokenUsage: result.tokenUsage, sessionMetrics: result.sessionMetrics });
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error('[GeminiCacheController] Error in askQuestionStream:', error);
    send({ type: 'error', message: getClientSafeCacheError(error), code: 'CACHE_STREAM_FAILED' });
    if (!res.writableEnded) res.end();
  }
};

/**
 * Route handler to query cross-session status for a file_id.
 * Returns full query history across all cache sessions for this document.
 */
exports.getFileStatus = async (req, res) => {
  try {
    const { fileId } = req.params;

    if (!fileId) {
      return res.status(400).json({ success: false, message: 'fileId parameter is required.' });
    }

    const status = await geminiCacheService.getStatusForFile(fileId);
    return res.status(200).json({ success: true, data: status });

  } catch (error) {
    console.error('[GeminiCacheController] Error in getFileStatus:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve file cache status.',
      error: error.message,
    });
  }
};

/**
 * Route handler to manually delete a cache session and clean up Google storage
 */
exports.deleteCache = async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'sessionId is required.'
      });
    }

    const result = await geminiCacheService.deleteCache(sessionId, 'manual');
    return res.status(200).json({
      success: true,
      message: 'Cache deleted manually.',
      data: result
    });

  } catch (error) {
    console.error('[GeminiCacheController] Error in deleteCache:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete cache.',
      error: error.message
    });
  }
};
