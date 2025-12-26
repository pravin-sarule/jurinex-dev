const express = require('express');
const multer = require('multer');
const router = express.Router();
const { protect } = require('../middleware/auth'); // Assuming auth middleware is available
const controller = require('../../controllers/documentController');

const upload = multer({ storage: multer.memoryStorage() });

router.post('/batch-upload', upload.single('document'), controller.batchUploadDocument);

router.post('/analyze', controller.analyzeDocument);

router.post('/summary', controller.getSummary);

router.post('/chat', controller.chatWithDocument);

router.post('/save', controller.saveEditedDocument);

router.get('/download/:file_id/:format', controller.downloadDocument);

router.get('/chat-history/:file_id', controller.getChatHistory);

router.get('/status/:file_id', controller.getDocumentProcessingStatus);

router.get('/user-storage-utilization', protect, controller.getUserStorageUtilization);

module.exports = router;