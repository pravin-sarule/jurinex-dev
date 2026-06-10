const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const geminiCacheController = require('../controllers/geminiCacheController');
const storageController = require('../controllers/storageController');
const { protect } = require('../middleware/auth');
const { enforceLLMChatPolicy } = require('../middleware/llmChatPolicy');


/** Limits from DB (`llm_chat_config`) for client-side validation — no quota side effect */
router.get('/limits', protect, chatController.getChatLlmLimits);

/** Secret prompts — same DB + GCP as /ask; does not call document-service */
router.get('/secrets', protect, chatController.listSecretPrompts);
router.get('/secrets/:id', protect, chatController.getSecretPromptById);

router.post(
  '/upload-document/initiate',
  protect,
  chatController.initiateSignedUpload
);

router.post(
  '/upload-document/complete',
  protect,
  chatController.completeSignedUpload
);

router.post(
  '/upload-document',
  protect,
  (req, res) => {
    res.status(410).json({
      success: false,
      message: 'Direct multipart upload is disabled for ChatModel. Use /upload-document/initiate and /upload-document/complete.',
      code: 'SIGNED_UPLOAD_REQUIRED',
    });
  }
);

router.post(
  '/google-drive/upload',
  protect,
  chatController.uploadDocumentFromGoogleDrive
);

router.post(
  '/ask',
  protect,
  enforceLLMChatPolicy,
  chatController.askQuestion
);

router.post(
  '/ask/stream',
  protect,
  enforceLLMChatPolicy,
  chatController.askQuestionStream
);

router.get(
  '/files',
  protect,
  chatController.getUserFiles
);

router.get(
  '/history/:file_id',
  protect,
  chatController.getChatHistory
);

router.get(
  '/sessions/:file_id',
  protect,
  chatController.getDocumentSessions
);

// General legal chat — no document required
router.post(
  '/ask/general/stream',
  protect,
  enforceLLMChatPolicy,
  chatController.askGeneralQuestionStream
);

router.get(
  '/general/history/:session_id',
  protect,
  chatController.getGeneralChatHistory
);

router.get(
  '/general/sessions',
  protect,
  chatController.getGeneralChatSessions
);

router.get(
  '/document-sessions',
  protect,
  chatController.getAllDocumentSessions
);

/* ─────────────────────────────────────────────────────────────────────────
   Token Counting (free, non-generating) — mirrors Google AI Studio behaviour
───────────────────────────────────────────────────────────────────────── */
router.post('/count-tokens', protect, chatController.countFileTokens);

/* ─────────────────────────────────────────────────────────────────────────
   Storage Usage — real bytes from Document_DB + GCS fallback
───────────────────────────────────────────────────────────────────────── */
router.get('/storage/usage', protect, storageController.getUserStorageUsage);

/* ─────────────────────────────────────────────────────────────────────────
   Gemini Context Caching Routes
───────────────────────────────────────────────────────────────────────── */
router.post('/cache/create', protect, enforceLLMChatPolicy, geminiCacheController.createCache);
router.post('/cache/ask', protect, enforceLLMChatPolicy, geminiCacheController.askQuestion);
router.post('/cache/ask/stream', protect, enforceLLMChatPolicy, geminiCacheController.askQuestionStream);
router.get('/cache/status/:sessionId', protect, geminiCacheController.getStatus);
router.get('/cache/file-status/:fileId', protect, geminiCacheController.getFileStatus);
router.post('/cache/delete', protect, geminiCacheController.deleteCache);

module.exports = router;

