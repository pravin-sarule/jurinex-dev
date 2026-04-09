const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
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

module.exports = router;
