
const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth');
const oiController = require('../controllers/oiController');
const draftFromChatController = require('../controllers/draftFromChatController');

/**
 * @route   POST /drafting/oi/upload
 * @desc    Upload file, store in GCS, create DB record
 * @access  Private (JWT required)
 */
router.post('/upload', protect, oiController.upload);

/**
 * @route   POST /drafting/oi/session
 * @desc    Create Office Integrator editor session, returns iframe URL
 * @access  Private (JWT required)
 */
router.post('/session', protect, oiController.createSession);

/**
 * @route   POST /drafting/oi/save
 * @desc    Manual save: export from OI, store to GCS
 * @access  Private (JWT required)
 */
router.post('/save', protect, oiController.save);

/**
 * ✅ NEW
 * @route   GET /drafting/oi/list
 * @desc    List user's drafts/documents for OI UI
 * @access  Private (JWT required)
 */
router.get('/list', protect, oiController.listDrafts);

/**
 * @route   GET /drafting/oi/:id/download
 * @desc    Get signed URL to download document (latest stored GCS path)
 * @access  Private (JWT required)
 */
router.get('/:id/download', protect, oiController.download);

/**
 * @route   POST /drafting/oi/create-blank
 * @desc    Create a new blank DOCX document
 * @access  Private (JWT required)
 */
router.post('/create-blank', protect, oiController.createBlank);

/**
 * @route   POST /drafting/oi/from-chat
 * @desc    Create draft document from AI chat content
 * @access  Private (JWT required)
 */
router.post('/from-chat', protect, draftFromChatController.createFromChat);

/**
 * @route   POST /drafting/oi/save-callback
 * @desc    Webhook called by Office Integrator on save events
 * @access  Public (called by Zoho)
 */
router.post('/save-callback', oiController.saveCallback);

/**
 * @route   POST /drafting/oi/:id/rename
 * @desc    Rename a document
 * @access  Private (JWT required)
 */
router.post('/:id/rename', protect, oiController.renameDocument);

/**
 * @route   DELETE /drafting/oi/:id/delete
 * @desc    Delete a document
 * @access  Private (JWT required)
 */
router.delete('/:id/delete', protect, oiController.deleteDocument);

module.exports = router;
