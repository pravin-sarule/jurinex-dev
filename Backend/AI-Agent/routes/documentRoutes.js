const express = require('express');
const multer = require('multer');
const router = express.Router();

const controller = require('../controllers/documentController');

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  }
});

/**
 * @route POST /api/documents/upload
 * @desc Upload and process a document
 * @access Public (for inter-service calls)
 * @body multipart/form-data with 'document' field
 */
router.post(
  "/upload",
  upload.single("document"),
  controller.uploadDocument
);

/**
 * @route GET /api/documents/status/:file_id
 * @desc Get document processing status
 * @access Public
 * @param file_id UUID of the document
 */
router.get(
  "/status/:file_id",
  controller.getProcessingStatus
);

/**
 * @route POST /api/documents/chat
 * @desc Chat with documents using AI (searches across all files or specified file_ids)
 * @access Public
 * @body JSON: { question, file_ids?, session_id?, llm_name? }
 */
router.post(
  "/chat",
  controller.chatWithDocuments
);

/**
 * @route GET /api/documents/documents
 * @desc Get all processed documents
 * @access Public
 */
router.get(
  "/documents",
  controller.getAllDocuments
);

/**
 * @route DELETE /api/documents/session/:session_id
 * @desc Delete a user session and all its chat history
 * @access Public
 * @param session_id UUID of the session to delete
 */
router.delete(
  "/session/:session_id",
  controller.deleteSession
);

/**
 * @route GET /api/documents/:file_id
 * @desc Get a single document by ID with full details
 * @access Public
 * @param file_id UUID of the document
 */
router.get(
  "/:file_id",
  controller.getDocumentById
);

/**
 * @route POST /api/documents/process
 * @desc Trigger processing for an existing uploaded document
 * @access Public
 * @body JSON: { file_id }
 */
router.post(
  "/process",
  controller.processExistingDocument
);

/**
 * @route DELETE /api/documents/:file_id
 * @desc Delete a document and all associated data (chunks, vectors, chats)
 * @access Public
 * @param file_id UUID of the document to delete
 */
router.delete(
  "/:file_id",
  controller.deleteDocument
);

module.exports = router;
