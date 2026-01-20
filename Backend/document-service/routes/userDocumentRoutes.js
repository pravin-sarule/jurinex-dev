const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const {
    saveDocument,
    verifyAccess,
    getDocuments
} = require('../controllers/userDocumentController');

// Save a Google Doc reference
router.post('/save', authMiddleware.protect, saveDocument);

// Verify and grant access to a Google Doc
router.get('/verify-access/:fileId', authMiddleware.protect, verifyAccess);

// Get all saved documents for user
router.get('/', authMiddleware.protect, getDocuments);

module.exports = router;
