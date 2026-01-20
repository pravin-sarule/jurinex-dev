const express = require('express');
const multer = require('multer');
const router = express.Router();

const controller = require('../controllers/documentController');
const { protect } = require('../middleware/auth');
const { checkDocumentUploadLimits } = require('../middleware/checkTokenLimits'); // Middleware enforces plan limits automatically

const upload = multer({ storage: multer.memoryStorage() });


router.post(
  "/generate-upload-url",
  protect,
  controller.generateUploadUrl
);

router.post(
  "/complete-upload",
  protect,
  controller.completeSignedUpload
);

router.post(
  "/upload",
  protect,
  checkDocumentUploadLimits,
  upload.single("document"),
  controller.uploadDocument
);


router.post(
  "/batch-upload",
  protect,
  checkDocumentUploadLimits,
  upload.array("document", 10), // up to 10 files at once
  controller.batchUploadDocuments
);


router.post(
    '/analyze',
    protect,
    checkDocumentUploadLimits, // Middleware checks plan limits
    controller.analyzeDocument
);

router.post(
    '/summary',
    protect,
    checkDocumentUploadLimits,
    controller.getSummary
);

router.post(
    '/chat',
    protect,
    checkDocumentUploadLimits,
    controller.chatWithDocument
);

router.post(
    '/chat/stream',
    protect,
    checkDocumentUploadLimits,
    controller.chatWithDocumentStream
);

router.post(
    '/save',
    protect,
    checkDocumentUploadLimits,
    controller.saveEditedDocument
);

router.get(
    '/download/:file_id/:format',
    protect,
    controller.downloadDocument
);

router.get(
    '/chat-history/:file_id',
    protect,
    controller.getChatHistory
);

router.get(
    '/status/:file_id',
    protect,
    controller.getDocumentProcessingStatus
);

router.get(
    '/user-usage-and-plan/:userId',
    protect,
    controller.getUserUsageAndPlan
);



router.get(
  '/chats/statistics',
  protect,
  controller.getChatStatistics
);

router.post(
  '/chats/delete-preview',
  protect,
  controller.getDeletePreview
);

router.delete(
  '/chat/:chat_id',
  protect,
  controller.deleteChat
);

router.delete(
  '/chats/selected',
  protect,
  controller.deleteSelectedChats
);

router.delete(
  '/chats/all',
  protect,
  controller.deleteAllChats
);

router.delete(
  '/chats/session/:session_id',
  protect,
  controller.deleteChatsBySession
);

router.delete(
  '/chats/file/:file_id',
  protect,
  controller.deleteChatsByFile
);

router.get(
  '/document/:file_id/complete',
  protect,
  controller.getDocumentComplete
);

module.exports = router;
