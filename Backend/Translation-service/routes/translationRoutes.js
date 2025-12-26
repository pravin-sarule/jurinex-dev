const express = require('express');
const router = express.Router();
const upload = require('../middlewares/uploadMiddleware');
const {
  translateDocument,
  getJobStatus,
  downloadTranslatedDocument,
  healthCheck,
} = require('../controllers/translationController');

// Health check
router.get('/health', healthCheck);

// Translate document (single file upload) - returns job ID for async processing
router.post('/translate', upload.single('document'), translateDocument);

// Get job status
router.get('/status/:jobId', getJobStatus);

// Download translated document
router.get('/download/:filename', downloadTranslatedDocument);

module.exports = router;

