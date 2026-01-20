const express = require('express');
const router = express.Router();
const documentController = require('../controllers/document.controller');
const { authenticateToken } = require('../middleware/auth.js');

// All document routes require authentication (JWT userId verification)
router.use(authenticateToken);

// Get all documents for current user
router.get('/', documentController.getDocuments);

// Get only Word-linked documents for current user
// Must be before /:id route to avoid route conflicts
router.get('/word', documentController.getWordDocuments);

// Get single document (with ownership verification)
router.get('/:id', documentController.getDocument);

// Create new document
router.post('/', documentController.createDocument);

// Update document (with ownership verification)
router.put('/:id', documentController.updateDocument);

// Delete document (with ownership verification)
router.delete('/:id', documentController.deleteDocument);

module.exports = router;
