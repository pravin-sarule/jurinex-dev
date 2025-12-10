const express = require('express');
const multer = require('multer');
const router = express.Router();
const { protect } = require('../middleware/auth'); // Assuming auth middleware is available
const controller = require('../../controllers/documentController');

const upload = multer({ storage: multer.memoryStorage() });

// Batch Upload & processing for large documents
router.post('/batch-upload', upload.single('document'), controller.batchUploadDocument);

// Post-processing analytics
router.post('/analyze', controller.analyzeDocument);

// Summarize selected chunks (RAG-efficient)
router.post('/summary', controller.getSummary);

// Chat with the document (RAG)
router.post('/chat', controller.chatWithDocument);

// Save edited (docx + pdf variants)
router.post('/save', controller.saveEditedDocument);

// Download edited variants via signed URL
router.get('/download/:file_id/:format', controller.downloadDocument);

// Chat history for a document
router.get('/chat-history/:file_id', controller.getChatHistory);

// Processing status
router.get('/status/:file_id', controller.getDocumentProcessingStatus);

// Get user storage utilization
router.get('/user-storage-utilization', protect, controller.getUserStorageUtilization);

module.exports = router;