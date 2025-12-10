

// backend/routes/documentRoutes.js
const express = require('express');
const multer = require('multer');
const router = express.Router();

const controller = require('../controllers/documentController');
const { protect } = require('../middleware/auth');
const { checkDocumentUploadLimits } = require('../middleware/checkTokenLimits'); // Middleware enforces plan limits automatically

const upload = multer({ storage: multer.memoryStorage() });

// =========================
// Document Routes
// =========================

// Generate signed URL for large file uploads (>32MB)
router.post(
  "/generate-upload-url",
  protect,
  controller.generateUploadUrl
);

// Complete upload after signed URL upload
router.post(
  "/complete-upload",
  protect,
  controller.completeSignedUpload
);

// Single Document Upload & processing
router.post(
  "/upload",
  protect,
  checkDocumentUploadLimits,
  upload.single("document"),
  controller.uploadDocument
);

// Batch Upload & processing for large documents
// router.post(
//     '/batch-upload',
//     protect,
//     checkDocumentUploadLimits, // Dynamically enforces limits from DB/plan
//     upload.any('document'),
//     controller.batchUploadDocument
// );

router.post(
  "/batch-upload",
  protect,
  checkDocumentUploadLimits,
  upload.array("document", 10), // up to 10 files at once
  controller.batchUploadDocuments
);


// Post-processing analytics
router.post(
    '/analyze',
    protect,
    checkDocumentUploadLimits, // Middleware checks plan limits
    controller.analyzeDocument
);

// Summarize selected chunks (RAG-efficient)
router.post(
    '/summary',
    protect,
    checkDocumentUploadLimits,
    controller.getSummary
);

// Chat with the document (RAG)
router.post(
    '/chat',
    protect,
    checkDocumentUploadLimits,
    controller.chatWithDocument
);

// Chat with the document (RAG) - SSE Streaming Version
router.post(
    '/chat/stream',
    protect,
    checkDocumentUploadLimits,
    controller.chatWithDocumentStream
);

// Save edited (docx + pdf variants)
router.post(
    '/save',
    protect,
    checkDocumentUploadLimits,
    controller.saveEditedDocument
);

// Download edited variants via signed URL (read-only, no token used)
router.get(
    '/download/:file_id/:format',
    protect,
    controller.downloadDocument
);

// Chat history for a document (read-only)
router.get(
    '/chat-history/:file_id',
    protect,
    controller.getChatHistory
);

// Processing status (read-only)
router.get(
    '/status/:file_id',
    protect,
    controller.getDocumentProcessingStatus
);

// Fetch user usage and plan info (read-only)
router.get(
    '/user-usage-and-plan/:userId',
    protect,
    controller.getUserUsageAndPlan
);



// Get chat statistics (useful for showing user their data before deletion)
router.get(
  '/chats/statistics',
  protect,
  controller.getChatStatistics
);

// Get preview of chats to be deleted (for confirmation dialogs)
router.post(
  '/chats/delete-preview',
  protect,
  controller.getDeletePreview
);

// Delete a single chat
router.delete(
  '/chat/:chat_id',
  protect,
  controller.deleteChat
);

// Delete multiple selected chats
router.delete(
  '/chats/selected',
  protect,
  controller.deleteSelectedChats
);

// Delete all chats for user
router.delete(
  '/chats/all',
  protect,
  controller.deleteAllChats
);

// Delete all chats for a specific session
router.delete(
  '/chats/session/:session_id',
  protect,
  controller.deleteChatsBySession
);

// Delete all chats for a specific file
router.delete(
  '/chats/file/:file_id',
  protect,
  controller.deleteChatsByFile
);

// Get document with all related data (chunks, chats, metadata) - user-specific
router.get(
  '/document/:file_id/complete',
  protect,
  controller.getDocumentComplete
);

module.exports = router;
