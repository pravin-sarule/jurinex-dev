const express = require('express');
const router = express.Router();
const multer = require('multer');
const chatController = require('../controllers/chatController');
const { protect } = require('../middleware/auth');
const { enforceLLMChatPolicy } = require('../middleware/llmChatPolicy');
const { enforceDashboardUploadPolicy } = require('../middleware/dashboardUploadPolicy');
const { getLLMConfig, getMulterUploadCeilingMb } = require('../services/llmConfigService');

/** Multer limit bytes from `llm_chat_config.multer_upload_ceiling_mb` + `max_document_size_mb` */
function dynamicUploadSingle(fieldName) {
  return (req, res, next) => {
    const userId = req.user?.id ?? req.userId ?? null;
    getLLMConfig(userId)
      .then((cfg) => {
        const mb = getMulterUploadCeilingMb(cfg);
        const upload = multer({
          storage: multer.memoryStorage(),
          limits: { fileSize: mb * 1024 * 1024 },
        });
        upload.single(fieldName)(req, res, next);
      })
      .catch(next);
  };
}

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
  dynamicUploadSingle('document'),
  enforceDashboardUploadPolicy,
  chatController.uploadDocumentAndGetURI
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
