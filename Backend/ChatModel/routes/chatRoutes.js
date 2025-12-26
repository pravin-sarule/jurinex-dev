const express = require('express');
const router = express.Router();
const multer = require('multer');
const chatController = require('../controllers/chatController');
const { protect } = require('../middleware/auth');

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

router.post(
  '/upload-document',
  protect,
  upload.single('document'),
  chatController.uploadDocumentAndGetURI
);

router.post(
  '/ask',
  protect,
  chatController.askQuestion
);

router.post(
  '/ask/stream',
  protect,
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

module.exports = router;
