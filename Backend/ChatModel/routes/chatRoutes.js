const express = require('express');
const router = express.Router();
const multer = require('multer');
const chatController = require('../controllers/chatController');
const { protect } = require('../middleware/auth');

// Configure multer for file uploads (memory storage)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// Upload document to GCS
// POST /api/chat/upload-document
router.post(
  '/upload-document',
  protect,
  upload.single('document'),
  chatController.uploadDocumentAndGetURI
);

// Ask question to LLM with document context
// POST /api/chat/ask
router.post(
  '/ask',
  protect,
  chatController.askQuestion
);

// Ask question to LLM with document context (Streaming with SSE)
// POST /api/chat/ask/stream
router.post(
  '/ask/stream',
  protect,
  chatController.askQuestionStream
);

// Get user's uploaded files
// GET /api/chat/files
router.get(
  '/files',
  protect,
  chatController.getUserFiles
);

// Get chat history for a document
// GET /api/chat/history/:file_id?session_id=uuid
router.get(
  '/history/:file_id',
  protect,
  chatController.getChatHistory
);

// Get all sessions for a document
// GET /api/chat/sessions/:file_id
router.get(
  '/sessions/:file_id',
  protect,
  chatController.getDocumentSessions
);

module.exports = router;
