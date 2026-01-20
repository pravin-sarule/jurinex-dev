const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const {
  initiateDraft,
  createDocument,
  populateDraft,
  getDraft,
  listDrafts,
  getEditorUrlController,
  getPlaceholders,
  finalizeDraft,
  deleteDraft,
  syncToGCS,
  getGCSUrl,
  getSyncStatus,
  shareDraft,
  getDraftPermissions,
  makeDraftPublic,
  removePermission,
  uploadFileInitial,
  syncDriveToGCSController,
  openDocumentForEditing,
  checkWebhookConfig,
  viewDocumentFromGCS
} = require('../controllers/draftController');

const {
  setupDraftWatcher,
  stopDraftWatcher
} = require('../controllers/webhookController');

/**
 * Unified Draft Routes
 * All routes require JWT authentication
 * 
 * Route order matters: specific routes must come before parameterized routes
 */

// ============================================
// Specific Routes (must come first)
// ============================================

// Create a new draft from template
// POST /api/drafts/initiate
router.post('/initiate', authMiddleware.protect, initiateDraft);

// Create a new blank Google Docs document
// POST /api/drafts/create
router.post('/create', authMiddleware.protect, createDocument);

// Check webhook configuration (useful for debugging ngrok setup)
// GET /api/drafts/webhook-config
router.get('/webhook-config', authMiddleware.protect, checkWebhookConfig);

// Initial Upload Flow: Local -> GCS -> Google Drive -> Database
// POST /api/drafts/upload
// Requires: multipart/form-data with file field
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
router.post('/upload', authMiddleware.protect, upload.single('file'), uploadFileInitial);

// Sync Google Drive to GCS (overwrite existing file)
// POST /api/drafts/sync-drive-to-gcs
// Body: { google_file_id: string, exportFormat?: 'docx' | 'pdf' }
router.post('/sync-drive-to-gcs', authMiddleware.protect, syncDriveToGCSController);

// Get all drafts for the current user
// GET /api/drafts
router.get('/', authMiddleware.protect, listDrafts);

// ============================================
// Parameterized Routes (come after specific routes)
// ============================================

// Populate a draft with variables
// POST /api/drafts/populate/:draftId
router.post('/populate/:draftId', authMiddleware.protect, populateDraft);

// Get placeholders from a draft
// GET /api/drafts/:draftId/placeholders
router.get('/:draftId/placeholders', authMiddleware.protect, getPlaceholders);

// Get iframe editor URL
// GET /api/drafts/:draftId/editor-url
router.get('/:draftId/editor-url', authMiddleware.protect, getEditorUrlController);

// Open document for editing (redirects to Google Docs, updates last_opened_at)
// GET /api/drafts/:draftId/open
router.get('/:draftId/open', authMiddleware.protect, openDocumentForEditing);

// Setup webhook watcher for a draft
// POST /api/drafts/:draftId/watch
// Body: { webhookUrl?: string }
router.post('/:draftId/watch', authMiddleware.protect, setupDraftWatcher);

// Stop webhook watcher for a draft
// DELETE /api/drafts/:draftId/watch
// Body: { channelId: string, resourceId: string }
router.delete('/:draftId/watch', authMiddleware.protect, stopDraftWatcher);

// Sync draft to GCS
// POST /api/drafts/:draftId/sync
router.post('/:draftId/sync', authMiddleware.protect, syncToGCS);

// Share draft with another user
// POST /api/drafts/:draftId/share
router.post('/:draftId/share', authMiddleware.protect, shareDraft);

// Get permissions for a draft
// GET /api/drafts/:draftId/permissions
router.get('/:draftId/permissions', authMiddleware.protect, getDraftPermissions);

// Make draft public (anyone with link)
// POST /api/drafts/:draftId/make-public
router.post('/:draftId/make-public', authMiddleware.protect, makeDraftPublic);

// Remove a permission (revoke access)
// DELETE /api/drafts/:draftId/permissions/:permissionId
router.delete('/:draftId/permissions/:permissionId', authMiddleware.protect, removePermission);

// Get GCS signed URL
// GET /api/drafts/:draftId/gcs-url
router.get('/:draftId/gcs-url', authMiddleware.protect, getGCSUrl);

// View document from GCS (for deleted Google Drive files)
// GET /api/drafts/:draftId/view
router.get('/:draftId/view', authMiddleware.protect, viewDocumentFromGCS);

// Get sync status
// GET /api/drafts/:draftId/sync-status
router.get('/:draftId/sync-status', authMiddleware.protect, getSyncStatus);

// Finalize a draft
// PATCH /api/drafts/:draftId/finalize
router.patch('/:draftId/finalize', authMiddleware.protect, finalizeDraft);

// Get a specific draft
// GET /api/drafts/:draftId (must be last to avoid conflicts)
router.get('/:draftId', authMiddleware.protect, getDraft);

// Delete a draft
// DELETE /api/drafts/:draftId
router.delete('/:draftId', authMiddleware.protect, deleteDraft);

module.exports = router;
