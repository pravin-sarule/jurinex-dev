const express = require('express');
const router = express.Router();
const wordController = require('../controllers/word.controller');
const { authenticateToken, requireMicrosoftAuth } = require('../middleware/auth.js');

// All word routes require authentication and Microsoft auth
router.use(authenticateToken);
router.use(requireMicrosoftAuth);

// Export document to Word (create in OneDrive)
router.post('/export', wordController.exportToWord);

// Sync content FROM Word back to Jurinex (fetch and update)
router.get('/sync/:documentId', wordController.syncFromWord);

// Re-open existing Word document in Word Online
router.get('/reopen/:documentId', wordController.reopenWordDocument);

module.exports = router;
