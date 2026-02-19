const Draft = require('../models/Draft');
const { copyFile, getFileMetadata, shareFile, makePublic, getPermissions, deletePermission, getDriveClientWithToken } = require('../services/googleDriveService');
const { createGoogleDoc, getEditorUrl } = require('../services/googleDocsService');
const { syncDraftToGCS, syncDriveToGCS, getGCSSignedUrl, needsSync } = require('../services/gcsSyncService');
const { handleInitialUpload, syncGoogleDocToGCS } = require('../services/fileUploadService');
const { google } = require('googleapis');
const { Readable } = require('stream');
const path = require('path');

/**
 * Unified Draft Controller
 * Handles all draft operations: creation, management, population, GCS sync, etc.
 */

// Helper: Verify draft ownership
const verifyOwnership = (draft, userId) => {
  const draftUserId = typeof draft.user_id === 'number' ? draft.user_id : parseInt(draft.user_id);
  const requestUserId = typeof userId === 'number' ? userId : parseInt(userId);
  return draftUserId === requestUserId;
};

// Helper: Get Google Docs client with access token
const getDocsClientWithToken = (accessToken) => {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.docs({ version: 'v1', auth: oauth2Client });
};

// Helper: Find placeholders in a Google Doc
const findPlaceholders = async (accessToken, fileId) => {
  try {
    const docs = getDocsClientWithToken(accessToken);
    const doc = await docs.documents.get({ documentId: fileId });

    const placeholders = new Set();
    const text = doc.data.body?.content?.map(para =>
      para.paragraph?.elements?.map(elem => elem.textRun?.content || '').join('') || ''
    ).join('') || '';

    // Find all {{placeholder}} patterns
    const matches = text.match(/\{\{([^}]+)\}\}/g);
    if (matches) {
      matches.forEach(match => placeholders.add(match));
    }

    return Array.from(placeholders);
  } catch (error) {
    console.error(`[Draft] Error finding placeholders:`, error.message);
    throw error;
  }
};

// Helper: Replace all text in a Google Doc
const replaceAllText = async (accessToken, fileId, variables) => {
  try {
    const docs = getDocsClientWithToken(accessToken);

    const requests = Object.entries(variables).map(([placeholder, replacement]) => ({
      replaceAllText: {
        containsText: {
          text: placeholder,
          matchCase: true
        },
        replaceText: String(replacement)
      }
    }));

    const response = await docs.documents.batchUpdate({
      documentId: fileId,
      requestBody: {
        requests
      }
    });

    return response.data;
  } catch (error) {
    console.error(`[Draft] Error replacing text:`, error.message);
    throw error;
  }
};

/**
 * POST /api/drafts/initiate
 * Create a new draft from a Google Docs template
 */
const initiateDraft = async (req, res) => {
  try {
    const userId = parseInt(req.user.id);
    const { templateFileId, googleAccessToken, draftName, metadata = {}, folderId, isUploadedFile = false } = req.body;

    if (!templateFileId) {
      return res.status(400).json({ success: false, error: 'Template file ID is required' });
    }
    if (!googleAccessToken) {
      return res.status(400).json({ success: false, error: 'Google access token is required' });
    }

    console.log(`[Draft] User ${userId} initiating draft from template: ${templateFileId}, isUploadedFile: ${isUploadedFile}`);

    // Get template metadata
    let templateMetadata;
    let useFileDirectly = isUploadedFile;
    try {
      templateMetadata = await getFileMetadata(googleAccessToken, templateFileId);

      // Check if it's a Google Doc
      if (templateMetadata.mimeType && templateMetadata.mimeType !== 'application/vnd.google-apps.document') {
        return res.status(400).json({ success: false, error: 'Template must be a Google Docs document' });
      }
    } catch (error) {
      // If metadata fetch fails, it might be a newly uploaded file that's still processing
      // For uploaded files converted to Google Docs, we'll proceed anyway
      console.warn(`[Draft] Could not fetch metadata for ${templateFileId}, assuming it's a Google Doc:`, error.message);
      templateMetadata = { name: 'Untitled Document', mimeType: 'application/vnd.google-apps.document' };
      useFileDirectly = true; // Likely an uploaded file that's still processing
    }

    // Generate draft title
    const timestamp = new Date().toISOString().split('T')[0];
    const title = draftName || (templateMetadata.name && templateMetadata.name !== 'Untitled Document'
      ? `Draft - ${templateMetadata.name} (${timestamp})`
      : `Untitled Document - ${timestamp}`);

    // For uploaded files, use them directly instead of copying (they're already Google Docs)
    // For templates, copy to create a new draft
    let newFile;
    if (useFileDirectly) {
      // Use the uploaded file directly (it's already converted to Google Docs)
      newFile = { id: templateFileId, name: templateMetadata.name || title };
      console.log(`[Draft] Using uploaded file directly: ${templateFileId}`);
    } else {
      // Copy template to create new draft
      newFile = await copyFile(googleAccessToken, templateFileId, {
        name: title,
        folderId
      });
    }

    console.log(`[Draft] Created new draft file: ${newFile.id}`);

    // NOTE: Service account is NOT added to user files - we use User OAuth for all operations

    // Try to find placeholders (non-blocking)
    let placeholders = [];
    try {
      placeholders = await findPlaceholders(googleAccessToken, newFile.id);
      console.log(`[Draft] Found placeholders:`, placeholders);
    } catch (error) {
      console.warn(`[Draft] Could not extract placeholders:`, error.message);
    }

    // Save draft to database (using new schema with title)
    const draft = await Draft.create({
      user_id: userId,
      title: title,
      google_file_id: newFile.id,
      status: 'active',
      editor_type: 'google' // Set editor type to 'google' for Google Docs
    });

    console.log(`[Draft] Draft saved to database: ${draft.id}`);

    // Step 1: Perform initial export to GCS to create gcs_path
    // This ensures the draft has a gcs_path for future syncs
    try {
      const { syncGoogleDocToGCS } = require('../services/fileUploadService');
      const { getAuthorizedClient } = require('../utils/oauth2Client');

      // Get User OAuth client for export (User OAuth is required for Drive operations)
      const userOAuthClient = await getAuthorizedClient(userId);

      console.log(`[Draft] Performing initial export to GCS for draft ${draft.id}`);
      const syncResult = await syncGoogleDocToGCS(newFile.id, 'docx', userOAuthClient);
      console.log(`[Draft] ✅ Initial export completed: ${syncResult.gcsPath}`);

      // Update draft with gcs_path if it was created
      if (syncResult.gcsPath) {
        await Draft.update(draft.id, {
          gcs_path: syncResult.gcsPath,
          last_synced_at: new Date()
        });
        console.log(`[Draft] ✅ Updated draft with gcs_path: ${syncResult.gcsPath}`);
      }
    } catch (syncError) {
      console.warn(`[Draft] ⚠️  Initial export failed (non-critical, will retry on edit):`, syncError.message);
      // Non-critical - draft is still created, webhook will handle future syncs
    }

    // Step 2: Automatically setup webhook watcher for real-time sync to GCS
    // This ensures edited files are automatically saved to GCS
    try {
      const { setupDriveWatcher } = require('../services/driveWebhookService');
      const { getWebhookUrl, validateWebhookUrl } = require('../utils/webhookUrl');

      // Validate webhook URL configuration
      const validation = validateWebhookUrl();
      if (!validation.isValid) {
        console.warn(`[Draft] ⚠️  Webhook URL validation failed: ${validation.message}`);
        console.warn(`[Draft] ⚠️  Suggestion: ${validation.suggestion}`);
        console.warn(`[Draft] ⚠️  Webhook will not be set up. For local development, use ngrok.`);
        throw new Error(validation.message);
      }

      const webhookUrl = getWebhookUrl();

      // Get User OAuth client for webhook setup (file is user-owned, service account can't access it)
      const { getAuthorizedClient } = require('../utils/oauth2Client');
      const userOAuthClient = await getAuthorizedClient(userId);

      console.log(`[Draft] Setting up webhook watcher for automatic GCS sync`);
      console.log(`[Draft] Webhook URL: ${webhookUrl}`);
      await setupDriveWatcher(newFile.id, draft.id, webhookUrl, userOAuthClient);
      console.log(`[Draft] ✅ Webhook watcher set up for automatic sync`);
    } catch (watcherError) {
      console.warn(`[Draft] ⚠️  Failed to setup webhook watcher (non-critical):`, watcherError.message);
      // Non-critical - draft is still created, just won't have automatic sync
    }

    res.status(201).json({
      success: true,
      message: 'Draft created successfully',
      draft: {
        id: draft.id,
        title: draft.title,
        googleFileId: draft.google_file_id,
        status: draft.status,
        editorType: draft.editor_type || 'google',
        placeholders,
        lastSyncedAt: draft.last_synced_at
      }
    });

  } catch (error) {
    console.error('[Draft] Initiate draft error:', error);

    if (error.code === 404) {
      return res.status(404).json({ success: false, error: 'Template not found or not accessible' });
    }
    if (error.code === 403) {
      return res.status(403).json({ success: false, error: 'No permission to access this template' });
    }
    if (error.message?.includes('invalid_grant') || error.message?.includes('Invalid Credentials')) {
      return res.status(401).json({ success: false, error: 'Google access token expired or invalid', needsAuth: true });
    }

    res.status(500).json({ success: false, error: 'Failed to create draft', details: error.message });
  }
};

/**
 * POST /api/drafts/create
 * Create a new blank Google Docs document
 */
const createDocument = async (req, res) => {
  try {
    const userId = parseInt(req.user.id);
    const { title } = req.body;
    const userEmail = req.user.email; // Get email from JWT token if available

    if (!title || typeof title !== 'string' || title.trim() === '') {
      return res.status(400).json({ success: false, error: 'Title is required' });
    }

    const result = await createGoogleDoc(userId, title.trim(), userEmail);

    // Fetch the created draft to get editor_type
    const draft = await Draft.findById(result.draftId);

    res.status(201).json({
      success: true,
      message: 'Document created successfully',
      data: {
        ...result,
        editorType: draft?.editor_type || 'google'
      }
    });
  } catch (error) {
    console.error('[Draft] Error creating document:', error);

    if (error.message?.includes('not connected')) {
      return res.status(401).json({ success: false, error: error.message });
    }
    if (error.message?.includes('expired')) {
      return res.status(401).json({ success: false, error: error.message, needsReconnect: true });
    }
    if (error.message?.includes('quota')) {
      return res.status(429).json({ success: false, error: error.message });
    }

    res.status(500).json({ success: false, error: 'Failed to create document', details: error.message });
  }
};

/**
 * POST /api/drafts/populate/:draftId
 * Populate a draft with template variables
 */
const populateDraft = async (req, res) => {
  try {
    const userId = parseInt(req.user.id);
    const { draftId } = req.params;
    const { googleAccessToken, variables, saveToMetadata = true } = req.body;

    if (!googleAccessToken) {
      return res.status(400).json({ success: false, error: 'Google access token is required' });
    }
    if (!variables || typeof variables !== 'object' || Object.keys(variables).length === 0) {
      return res.status(400).json({ success: false, error: 'Variables object is required' });
    }

    const draft = await Draft.findById(draftId);
    if (!draft) {
      return res.status(404).json({ success: false, error: 'Draft not found' });
    }
    if (!verifyOwnership(draft, userId)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to modify this draft' });
    }
    // Enforce immutability: finalized documents cannot be modified
    if (draft.status === 'FINALIZED' || draft.status === 'finalized') {
      return res.status(400).json({
        success: false,
        error: 'Document is finalized and cannot be edited.'
      });
    }

    // Replace placeholders
    const replaceResult = await replaceAllText(googleAccessToken, draft.google_file_id, variables);

    const replacementCount = replaceResult.replies?.reduce((acc, reply) => {
      return acc + (reply.replaceAllText?.occurrencesChanged || 0);
    }, 0) || 0;

    console.log(`[Draft] Made ${replacementCount} replacements in draft ${draftId}`);

    res.status(200).json({
      success: true,
      message: 'Draft populated successfully',
      draft: {
        id: draft.id,
        title: draft.title,
        googleFileId: draft.google_file_id,
        status: draft.status,
        gcsPath: draft.gcs_path,
        editorType: draft.editor_type || 'google'
      },
      replacements: {
        variablesProvided: Object.keys(variables).length,
        occurrencesChanged: replacementCount
      }
    });

  } catch (error) {
    console.error('[Draft] Populate draft error:', error);

    if (error.code === 403) {
      return res.status(403).json({ success: false, error: 'No permission to edit this document' });
    }
    if (error.message?.includes('invalid_grant') || error.message?.includes('Invalid Credentials')) {
      return res.status(401).json({ success: false, error: 'Google access token expired or invalid', needsAuth: true });
    }

    res.status(500).json({ success: false, error: 'Failed to populate draft', details: error.message });
  }
};

/**
 * GET /api/drafts/:draftId
 * Get a draft by ID
 */
const getDraft = async (req, res) => {
  try {
    const userId = parseInt(req.user.id);
    const draftId = parseInt(req.params.draftId);

    if (isNaN(draftId)) {
      return res.status(400).json({ success: false, error: 'Invalid draft ID' });
    }

    const draft = await Draft.findById(draftId);
    if (!draft) {
      return res.status(404).json({ success: false, error: 'Draft not found' });
    }
    if (!verifyOwnership(draft, userId)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to view this draft' });
    }

    // Step 1: Check if google_file_id is valid using drive.files.get
    let googleFileId = draft.google_file_id;
    let webViewLink = null;
    let restored = false;

    if (googleFileId) {
      try {
        const { initializeServiceAccount } = require('../services/fileUploadService');
        const { driveClient: drive } = initializeServiceAccount();

        // Check if Google Drive file exists and is not trashed
        try {
          const fileMetadata = await drive.files.get({
            fileId: googleFileId,
            fields: 'id, name, webViewLink, trashed'
          });

          // Check if file is trashed
          if (fileMetadata.data.trashed === true) {
            console.log(`[Draft] Google Drive file ${googleFileId} is in trash, restoring from GCS`);
            throw new Error('File is trashed');
          }

          webViewLink = fileMetadata.data.webViewLink;
          console.log(`[Draft] ✅ Google Drive file exists: ${googleFileId}`);
        } catch (driveError) {
          // File doesn't exist (404) or is trashed - restore from GCS
          if (driveError.code === 404 || driveError.message?.includes('not found') || driveError.message?.includes('trashed')) {
            console.log(`[Draft] Google Drive file ${googleFileId} not found (404) or deleted, restoring from GCS`);

            // Step 2: Check if gcs_path exists
            if (!draft.gcs_path) {
              console.error(`[Draft] ⚠️  Cannot restore: draft has no gcs_path`);
              return res.status(400).json({
                success: false,
                error: 'Google Drive file is deleted and no GCS backup is available',
                draft: {
                  id: draft.id,
                  title: draft.title,
                  status: draft.status,
                  editorType: draft.editor_type || 'google'
                }
              });
            }

            // Step 3: Download file from GCS and upload back to Google Drive
            try {
              const { restoreFileFromGCSToDrive } = require('../services/fileUploadService');
              const restoreResult = await restoreFileFromGCSToDrive(
                draft.id,
                draft.gcs_path,
                draft.title || 'Restored Document',
                draft.user_id
              );

              googleFileId = restoreResult.google_file_id;
              webViewLink = restoreResult.webViewLink;
              restored = true;

              console.log(`[Draft] ✅ File restored from GCS. New Google File ID: ${googleFileId}`);

              // Refresh draft from database to get updated google_file_id
              const updatedDraft = await Draft.findById(draftId);
              if (updatedDraft) {
                draft.google_file_id = updatedDraft.google_file_id;
                draft.drive_item_id = updatedDraft.drive_item_id;
                draft.last_synced_at = updatedDraft.last_synced_at;
              }
            } catch (restoreError) {
              console.error(`[Draft] ❌ Error restoring file from GCS:`, restoreError);
              return res.status(500).json({
                success: false,
                error: 'Failed to restore file from GCS',
                details: restoreError.message,
                draft: {
                  id: draft.id,
                  title: draft.title,
                  gcsPath: draft.gcs_path,
                  status: draft.status
                }
              });
            }
          } else {
            // Other error (permission, etc.) - log but continue
            console.warn(`[Draft] ⚠️  Error checking Google Drive file:`, driveError.message);
          }
        }
      } catch (error) {
        console.warn(`[Draft] ⚠️  Error during file validation:`, error.message);
        // Continue with response even if validation fails
      }
    }

    res.status(200).json({
      success: true,
      draft: {
        id: draft.id,
        title: draft.title,
        googleFileId: draft.google_file_id || googleFileId,
        gcsPath: draft.gcs_path,
        status: draft.status,
        editorType: draft.editor_type || 'google',
        lastSyncedAt: draft.last_synced_at,
        webViewLink: webViewLink || (draft.google_file_id ? `https://docs.google.com/document/d/${draft.google_file_id}/edit` : null)
      },
      restored: restored,
      message: restored ? 'File was restored from GCS to Google Drive' : null
    });

  } catch (error) {
    console.error('[Draft] Get draft error:', error);
    res.status(500).json({ success: false, error: 'Failed to get draft', details: error.message });
  }
};

/**
 * GET /api/drafts
 * Get all drafts for the current user
 */
const listDrafts = async (req, res) => {
  try {
    const userId = parseInt(req.user.id);
    const { status, limit = 50, offset = 0 } = req.query;

    // Only fetch drafts with editor_type='google' (Google Docs files)
    const drafts = await Draft.findByUserId(userId, {
      status,
      limit: parseInt(limit),
      offset: parseInt(offset),
      editor_type: 'google' // Filter to only show Google Docs files
    });

    const count = await Draft.countByUserId(userId, status, 'google');

    res.status(200).json({
      success: true,
      drafts: drafts.map(draft => ({
        id: draft.id,
        title: draft.title,
        fileName: draft.title, // Map title to fileName for frontend compatibility
        googleFileId: draft.google_file_id,
        status: draft.status,
        editorType: draft.editor_type || 'google',
        gcsPath: draft.gcs_path,
        lastSyncedAt: draft.last_synced_at,
        createdAt: draft.created_at // Map created_at to createdAt for frontend
      })),
      pagination: {
        total: count,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });

  } catch (error) {
    console.error('[Draft] List drafts error:', error);
    res.status(500).json({ success: false, error: 'Failed to list drafts', details: error.message });
  }
};

/**
 * GET /api/drafts/:draftId/editor-url
 * Get iframe editor URL for a draft
 */
const getEditorUrlController = async (req, res) => {
  try {
    const userId = parseInt(req.user.id);
    const draftId = parseInt(req.params.draftId);

    const draft = await Draft.findById(draftId);
    if (!draft) {
      return res.status(404).json({ success: false, error: 'Draft not found' });
    }
    if (!verifyOwnership(draft, userId)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to access this draft' });
    }

    // Enforce immutability: finalized documents cannot be edited
    if (draft.status === 'FINALIZED' || draft.status === 'finalized') {
      return res.status(400).json({
        success: false,
        error: 'Document is finalized and cannot be edited.'
      });
    }

    const editorUrl = await getEditorUrl(draftId);

    res.json({
      success: true,
      editorUrl: editorUrl,
      draft: {
        id: draft.id,
        title: draft.title,
        googleFileId: draft.google_file_id,
        status: draft.status,
        gcsPath: draft.gcs_path
      }
    });
  } catch (error) {
    console.error('[Draft] Error getting editor URL:', error);
    res.status(500).json({ success: false, error: 'Failed to get editor URL', details: error.message });
  }
};

/**
 * GET /api/drafts/:draftId/placeholders
 * Get placeholders from a draft document
 */
const getPlaceholders = async (req, res) => {
  try {
    const userId = parseInt(req.user.id);
    const { draftId } = req.params;
    const { googleAccessToken } = req.query;

    if (!googleAccessToken) {
      return res.status(400).json({ success: false, error: 'Google access token is required' });
    }

    const draft = await Draft.findById(draftId);
    if (!draft) {
      return res.status(404).json({ success: false, error: 'Draft not found' });
    }
    if (!verifyOwnership(draft, userId)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to view this draft' });
    }

    const placeholders = await findPlaceholders(googleAccessToken, draft.google_file_id);

    res.status(200).json({
      success: true,
      draftId: draft.id,
      placeholders
    });

  } catch (error) {
    console.error('[Draft] Get placeholders error:', error);

    if (error.message?.includes('invalid_grant') || error.message?.includes('Invalid Credentials')) {
      return res.status(401).json({ success: false, error: 'Google access token expired or invalid', needsAuth: true });
    }

    res.status(500).json({ success: false, error: 'Failed to get placeholders', details: error.message });
  }
};

/**
 * PATCH /api/drafts/:draftId/finalize
 * Finalize a draft - Mark as FINALIZED without GCS sync
 */
const finalizeDraft = async (req, res) => {
  try {
    const userId = parseInt(req.user.id);
    const draftId = parseInt(req.params.draftId);

    // Verify ownership and check if already FINALIZED
    const draft = await Draft.findById(draftId);
    if (!draft) {
      return res.status(404).json({ success: false, error: 'Draft not found' });
    }
    if (!verifyOwnership(draft, userId)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to finalize this draft' });
    }
    if (draft.status === 'FINALIZED' || draft.status === 'finalized') {
      return res.status(400).json({ success: false, error: 'Draft is already finalized' });
    }

    // Update the database record to mark as FINALIZED
    const updatedDraft = await Draft.update(draftId, {
      status: 'FINALIZED'
    });

    res.status(200).json({
      success: true,
      message: 'Draft finalized successfully',
      draft: {
        id: updatedDraft.id,
        title: updatedDraft.title,
        googleFileId: updatedDraft.google_file_id,
        status: updatedDraft.status,
        editorType: updatedDraft.editor_type || 'google'
      }
    });

  } catch (error) {
    console.error('[Draft] Finalize draft error:', error);
    res.status(500).json({ success: false, error: 'Failed to finalize draft', details: error.message });
  }
};

/**
 * DELETE /api/drafts/:draftId
 * Delete a draft
 */
const deleteDraft = async (req, res) => {
  try {
    const userId = parseInt(req.user.id);
    const { draftId } = req.params;

    const draft = await Draft.findById(draftId);
    if (!draft) {
      return res.status(404).json({ success: false, error: 'Draft not found' });
    }
    if (!verifyOwnership(draft, userId)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to delete this draft' });
    }

    await Draft.delete(draftId);

    res.status(200).json({
      success: true,
      message: 'Draft deleted successfully'
    });

  } catch (error) {
    console.error('[Draft] Delete draft error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete draft', details: error.message });
  }
};

/**
 * POST /api/drafts/:draftId/sync
 * Sync draft to GCS
 */
/**
 * POST /api/drafts/:draftId/sync
 * Manual sync: Save edited Google Doc to GCS bucket
 * Exports the current version and overwrites the file at the existing gcs_path
 * Uses Service Account authentication
 */
const syncToGCS = async (req, res) => {
  try {
    const userId = parseInt(req.user.id);
    const draftId = parseInt(req.params.draftId);
    const { format = 'docx' } = req.body; // Default to docx for better compatibility

    const draft = await Draft.findById(draftId);
    if (!draft) {
      return res.status(404).json({ success: false, error: 'Draft not found' });
    }
    if (!verifyOwnership(draft, userId)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to sync this draft' });
    }
    if (!draft.google_file_id) {
      return res.status(400).json({ success: false, error: 'Draft does not have a Google file ID' });
    }

    // Get User OAuth client for export (User OAuth is required for Drive operations)
    const { getAuthorizedClient } = require('../utils/oauth2Client');
    const userOAuthClient = await getAuthorizedClient(userId);

    // Use syncGoogleDocToGCS with User OAuth for export
    // If gcs_path doesn't exist, it will create one automatically
    const result = await syncGoogleDocToGCS(draft.google_file_id, format, userOAuthClient);

    res.json({
      success: true,
      message: 'Document saved to GCS successfully',
      gcsPath: result.gcsPath,
      syncedAt: result.syncedAt,
      draftId: result.draftId,
      exportFormat: result.exportFormat
    });
  } catch (error) {
    console.error('[Draft] Error syncing to GCS:', error);

    if (error.message?.includes('GCS_KEY_BASE64') || error.message?.includes('Service Account')) {
      return res.status(500).json({
        success: false,
        error: 'Service Account configuration error. Please check GCS_KEY_BASE64 environment variable.',
        details: error.message
      });
    }
    if (error.message?.includes('not found') || error.message?.includes('GCS path')) {
      return res.status(400).json({ success: false, error: error.message });
    }

    res.status(500).json({ success: false, error: 'Failed to save document to GCS', details: error.message });
  }
};

/**
 * GET /api/drafts/:draftId/gcs-url
 * Get signed URL for GCS file
 */
const getGCSUrl = async (req, res) => {
  try {
    const userId = parseInt(req.user.id);
    const draftId = parseInt(req.params.draftId);
    const expiresInHours = parseInt(req.query.expiresInHours) || 24;

    const draft = await Draft.findById(draftId);
    if (!draft) {
      return res.status(404).json({ success: false, error: 'Draft not found' });
    }
    if (!verifyOwnership(draft, userId)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to access this draft' });
    }

    const signedUrl = await getGCSSignedUrl(draftId, expiresInHours);

    res.json({
      success: true,
      signedUrl: signedUrl,
      expiresInHours: expiresInHours
    });
  } catch (error) {
    console.error('[Draft] Error getting GCS URL:', error);
    res.status(500).json({ success: false, error: 'Failed to get GCS URL', details: error.message });
  }
};

/**
 * GET /api/drafts/:draftId/view
 * View document from GCS (for deleted Google Drive files)
 * Serves the file directly or redirects to signed URL
 */
const viewDocumentFromGCS = async (req, res) => {
  try {
    const userId = parseInt(req.user.id);
    const draftId = parseInt(req.params.draftId);

    const draft = await Draft.findById(draftId);
    if (!draft) {
      return res.status(404).json({ success: false, error: 'Draft not found' });
    }
    if (!verifyOwnership(draft, userId)) {
      return res.status(403).json({ success: false, error: 'Permission denied' });
    }

    if (!draft.gcs_path) {
      return res.status(400).json({
        success: false,
        error: 'Draft has not been synced to GCS yet'
      });
    }

    // Get signed URL and redirect to it
    const signedUrl = await getGCSSignedUrl(draftId, 1); // 1 hour expiration for viewing

    // Redirect to the signed URL
    res.redirect(signedUrl);
  } catch (error) {
    console.error('[Draft] Error viewing document from GCS:', error);
    res.status(500).json({ success: false, error: 'Failed to view document', details: error.message });
  }
};

/**
 * GET /api/drafts/:draftId/sync-status
 * Check if draft needs syncing
 */
const getSyncStatus = async (req, res) => {
  try {
    const userId = parseInt(req.user.id);
    const draftId = parseInt(req.params.draftId);
    const maxAgeHours = parseInt(req.query.maxAgeHours) || 24;

    const draft = await Draft.findById(draftId);
    if (!draft) {
      return res.status(404).json({ success: false, error: 'Draft not found' });
    }
    if (!verifyOwnership(draft, userId)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to access this draft' });
    }

    const shouldSync = await needsSync(draftId, maxAgeHours);

    res.json({
      success: true,
      needsSync: shouldSync,
      lastSyncedAt: draft.last_synced_at,
      gcsPath: draft.gcs_path
    });
  } catch (error) {
    console.error('[Draft] Error getting sync status:', error);
    res.status(500).json({ success: false, error: 'Failed to get sync status', details: error.message });
  }
};

/**
 * POST /api/drafts/:draftId/share
 * Share a draft document with another user
 */
const shareDraft = async (req, res) => {
  try {
    const userId = parseInt(req.user.id);
    const draftId = parseInt(req.params.draftId);
    const { googleAccessToken, email, role = 'writer', sendNotificationEmail = true } = req.body;

    if (!googleAccessToken) {
      return res.status(400).json({ success: false, error: 'Google access token is required' });
    }
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, error: 'Valid email address is required' });
    }

    const draft = await Draft.findById(draftId);
    if (!draft) {
      return res.status(404).json({ success: false, error: 'Draft not found' });
    }
    if (!verifyOwnership(draft, userId)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to share this draft' });
    }
    if (!draft.google_file_id) {
      return res.status(400).json({ success: false, error: 'Draft does not have a Google file ID' });
    }

    // Share the Google Doc (sendNotificationEmail defaults to true)
    const permission = await shareFile(googleAccessToken, draft.google_file_id, email, role, sendNotificationEmail);

    res.json({
      success: true,
      message: `Document shared with ${email} as ${role}${sendNotificationEmail ? '. Notification email sent.' : ''}`,
      permission: {
        id: permission.id,
        email: email,
        role: role
      }
    });
  } catch (error) {
    console.error('[Draft] Error sharing draft:', error);

    if (error.code === 403) {
      return res.status(403).json({ success: false, error: 'No permission to share this document' });
    }
    if (error.message?.includes('invalid_grant') || error.message?.includes('Invalid Credentials')) {
      return res.status(401).json({ success: false, error: 'Google access token expired or invalid', needsAuth: true });
    }

    res.status(500).json({ success: false, error: 'Failed to share draft', details: error.message });
  }
};

/**
 * GET /api/drafts/:draftId/permissions
 * Get all permissions for a draft document
 */
const getDraftPermissions = async (req, res) => {
  try {
    const userId = parseInt(req.user.id);
    const draftId = parseInt(req.params.draftId);
    const { googleAccessToken } = req.query;

    if (!googleAccessToken) {
      return res.status(400).json({ success: false, error: 'Google access token is required' });
    }

    const draft = await Draft.findById(draftId);
    if (!draft) {
      return res.status(404).json({ success: false, error: 'Draft not found' });
    }
    if (!verifyOwnership(draft, userId)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to view this draft' });
    }
    if (!draft.google_file_id) {
      return res.status(400).json({ success: false, error: 'Draft does not have a Google file ID' });
    }

    const permissions = await getPermissions(googleAccessToken, draft.google_file_id);

    res.json({
      success: true,
      permissions: permissions.map(p => ({
        id: p.id,
        type: p.type,
        role: p.role,
        emailAddress: p.emailAddress,
        displayName: p.displayName
      }))
    });
  } catch (error) {
    console.error('[Draft] Error getting permissions:', error);

    if (error.message?.includes('invalid_grant') || error.message?.includes('Invalid Credentials')) {
      return res.status(401).json({ success: false, error: 'Google access token expired or invalid', needsAuth: true });
    }

    res.status(500).json({ success: false, error: 'Failed to get permissions', details: error.message });
  }
};

/**
 * POST /api/drafts/:draftId/make-public
 * Make a draft document accessible to anyone with the link
 */
const makeDraftPublic = async (req, res) => {
  try {
    const userId = parseInt(req.user.id);
    const draftId = parseInt(req.params.draftId);
    const { googleAccessToken, role = 'reader' } = req.body;

    if (!googleAccessToken) {
      return res.status(400).json({ success: false, error: 'Google access token is required' });
    }

    const draft = await Draft.findById(draftId);
    if (!draft) {
      return res.status(404).json({ success: false, error: 'Draft not found' });
    }
    if (!verifyOwnership(draft, userId)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to share this draft' });
    }
    if (!draft.google_file_id) {
      return res.status(400).json({ success: false, error: 'Draft does not have a Google file ID' });
    }

    const permission = await makePublic(googleAccessToken, draft.google_file_id, role);

    res.json({
      success: true,
      message: 'Document is now accessible to anyone with the link',
      permission: {
        id: permission.id,
        type: 'anyone',
        role: role
      }
    });
  } catch (error) {
    console.error('[Draft] Error making draft public:', error);

    if (error.message?.includes('invalid_grant') || error.message?.includes('Invalid Credentials')) {
      return res.status(401).json({ success: false, error: 'Google access token expired or invalid', needsAuth: true });
    }

    res.status(500).json({ success: false, error: 'Failed to make draft public', details: error.message });
  }
};

/**
 * DELETE /api/drafts/:draftId/permissions/:permissionId
 * Remove a permission (revoke access)
 */
const removePermission = async (req, res) => {
  try {
    const userId = parseInt(req.user.id);
    const draftId = parseInt(req.params.draftId);
    const permissionId = req.params.permissionId;
    const { googleAccessToken } = req.body;

    if (!googleAccessToken) {
      return res.status(400).json({ success: false, error: 'Google access token is required' });
    }

    const draft = await Draft.findById(draftId);
    if (!draft) {
      return res.status(404).json({ success: false, error: 'Draft not found' });
    }
    if (!verifyOwnership(draft, userId)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to modify this draft' });
    }
    if (!draft.google_file_id) {
      return res.status(400).json({ success: false, error: 'Draft does not have a Google file ID' });
    }

    await deletePermission(googleAccessToken, draft.google_file_id, permissionId);

    res.json({
      success: true,
      message: 'Permission removed successfully'
    });
  } catch (error) {
    console.error('[Draft] Error removing permission:', error);

    if (error.message?.includes('invalid_grant') || error.message?.includes('Invalid Credentials')) {
      return res.status(401).json({ success: false, error: 'Google access token expired or invalid', needsAuth: true });
    }

    res.status(500).json({ success: false, error: 'Failed to remove permission', details: error.message });
  }
};

/**
 * POST /api/drafts/upload-local
 * Upload a local file and convert it to Google Docs
 * Bug Fix: Ensure proper file buffer handling and MIME type mapping
 */
const uploadLocalFile = async (req, res) => {
  try {
    const userId = parseInt(req.user.id);
    const { googleAccessToken, title } = req.body;

    // Validate file upload
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    if (!googleAccessToken) {
      return res.status(400).json({ success: false, error: 'Google access token is required' });
    }

    // Verify file buffer exists
    if (!req.file.buffer || req.file.buffer.length === 0) {
      return res.status(400).json({ success: false, error: 'File buffer is empty or invalid' });
    }

    const file = req.file;
    const fileName = title || file.originalname.replace(/\.[^/.]+$/, ''); // Remove extension

    console.log(`[Draft] User ${userId} uploading local file: ${file.originalname} (${file.size} bytes)`);

    // Get Google Drive client
    const { drive } = getDriveClientWithToken(googleAccessToken);

    // Determine MIME type for Google Drive import
    // importMimeType must be 'application/vnd.google-apps.document' to trigger conversion
    const importMimeType = 'application/vnd.google-apps.document';
    const fileExtension = path.extname(file.originalname).toLowerCase();

    // Map file extensions to Google Drive import MIME types (source MIME type)
    const mimeTypeMap = {
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.doc': 'application/msword',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.rtf': 'application/rtf',
      '.html': 'text/html'
    };

    const sourceMimeType = mimeTypeMap[fileExtension] || file.mimetype || 'application/octet-stream';

    // Verify MIME type mapping
    if (!sourceMimeType) {
      return res.status(400).json({
        success: false,
        error: `Unsupported file type: ${fileExtension}. Supported types: .docx, .doc, .pdf, .txt, .rtf, .html`
      });
    }

    // Convert buffer to stream
    const fileStream = Readable.from(file.buffer);

    // Upload file to Google Drive and convert to Google Docs
    // Setting mimeType to 'application/vnd.google-apps.document' triggers automatic conversion
    const uploadResponse = await drive.files.create({
      requestBody: {
        name: fileName,
        mimeType: importMimeType // This triggers conversion to Google Docs
      },
      media: {
        mimeType: sourceMimeType, // Original file MIME type
        body: fileStream
      },
      fields: 'id, name, mimeType, webViewLink',
      supportsAllDrives: true
    });

    const googleFileId = uploadResponse.data.id;
    console.log(`[Draft] File uploaded and converted to Google Docs: ${googleFileId}`);

    // Save draft to database with editor_type: 'google'
    const draft = await Draft.create({
      user_id: userId,
      title: fileName,
      google_file_id: googleFileId,
      status: 'active',
      editor_type: 'google' // Ensure editor_type is set to 'google'
    });

    console.log(`[Draft] Draft saved to database: ${draft.id}`);

    res.status(201).json({
      success: true,
      message: 'File uploaded and converted to Google Docs successfully',
      draft: {
        id: draft.id,
        title: draft.title,
        googleFileId: draft.google_file_id,
        status: draft.status,
        editorType: draft.editor_type || 'google'
      }
    });

  } catch (error) {
    console.error('[Draft] Error uploading local file:', error);

    if (error.message?.includes('invalid_grant') || error.message?.includes('Invalid Credentials')) {
      return res.status(401).json({ success: false, error: 'Google access token expired or invalid', needsAuth: true });
    }
    if (error.code === 403) {
      return res.status(403).json({ success: false, error: 'Permission denied. Please check your Google Drive access.' });
    }

    res.status(500).json({ success: false, error: 'Failed to upload file', details: error.message });
  }
};

/**
 * POST /api/drafts/upload
 * Initial Upload Flow: Local -> GCS -> Google Drive (USER OAuth) -> Database
 * Uploads a file from local computer to GCS, then to Google Drive (converted to Google Docs), and saves to database
 * Uses USER OAuth authentication (NOT service account)
 * BLOCKING: Waits for all operations to complete before returning iframe URL
 */
const uploadFileInitial = async (req, res) => {
  try {
    const userId = parseInt(req.user.id);

    // Validate file upload
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const file = req.file;
    const title = req.body.title || null; // Optional title from request body

    console.log(`[Draft] 📤 User ${userId} uploading file from local: ${file.originalname} (${file.size} bytes)`);
    console.log(`[Draft]    MIME type: ${file.mimetype}`);

    // Get user's OAuth client (NOT service account)
    console.log(`[Draft] 🔐 Getting user OAuth client for Drive upload`);
    const { getAuthorizedClient } = require('../utils/oauth2Client');
    const userOAuthClient = await getAuthorizedClient(userId);
    console.log(`[Draft] ✅ User OAuth client obtained`);

    // Upload file to GCS and Google Drive using USER OAuth (BLOCKING)
    console.log(`[Draft] 🚀 Starting upload flow: GCS -> Drive (USER OAuth)`);
    const { uploadToUserDriveAsGoogleDoc } = require('../services/fileUploadService');
    const result = await uploadToUserDriveAsGoogleDoc(
      file.buffer,
      userId,
      file.originalname,
      file.mimetype,
      title,
      userOAuthClient // Pass user OAuth client, NOT service account
    );

    console.log(`[Draft] ✅ Upload complete. Draft ID: ${result.draft.id}, Google File ID: ${result.google_file_id}`);
    console.log(`[Draft] 📋 Returning iframe URL: ${result.iframeUrl}`);

    res.status(201).json({
      success: true,
      draft: result.draft, // Include draft object for frontend
      google_file_id: result.google_file_id,
      iframeUrl: result.iframeUrl
    });

  } catch (error) {
    console.error('[Draft] ❌ Error in upload flow:', error);

    // Handle OAuth errors (user needs to reconnect Google Drive)
    if (error.message?.includes('not connected Google Drive') ||
      error.message?.includes('invalid_grant') ||
      error.message?.includes('reconnect')) {
      return res.status(401).json({
        success: false,
        error: 'Google Drive connection required',
        message: 'Please reconnect your Google Drive account to upload files.',
        details: error.message
      });
    }

    // Handle Google Drive quota errors specifically
    if (error.code === 507 || error.quotaExceeded ||
      (error.code === 403 && error.errors && error.errors.some(e => e.reason === 'storageQuotaExceeded'))) {
      return res.status(507).json({
        success: false,
        error: 'Google Drive storage quota exceeded',
        message: 'Your Google Drive storage is full. Please free up space and try again.',
        details: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to upload file',
      message: 'An error occurred while uploading the file. Please try again.',
      details: error.message
    });
  }
};

/**
 * POST /api/drafts/sync-drive-to-gcs
 * Sync Logic: Export Google Doc from Drive and upload to GCS (overwriting existing file)
 * Uses Service Account authentication (no OAuth2 required)
 * Body: { google_file_id: string, exportFormat?: 'docx' | 'pdf' }
 */
const syncDriveToGCSController = async (req, res) => {
  try {
    const userId = parseInt(req.user.id);
    const { google_file_id, exportFormat = 'docx' } = req.body;

    if (!google_file_id) {
      return res.status(400).json({ success: false, error: 'google_file_id is required' });
    }

    console.log(`[Draft] User ${userId} syncing Google file ${google_file_id} to GCS`);

    // Verify ownership
    const draft = await Draft.findByGoogleFileId(google_file_id);
    if (!draft) {
      return res.status(404).json({ success: false, error: 'Draft not found' });
    }

    if (draft.user_id !== userId) {
      return res.status(403).json({ success: false, error: 'Permission denied' });
    }

    // Sync to GCS using Service Account
    // Get User OAuth client for export (User OAuth is required for Drive operations)
    const { getAuthorizedClient } = require('../utils/oauth2Client');
    const userOAuthClient = await getAuthorizedClient(userId);

    const result = await syncGoogleDocToGCS(google_file_id, exportFormat, userOAuthClient);

    res.status(200).json({
      success: true,
      message: 'File synced successfully from Google Drive to GCS',
      ...result
    });

  } catch (error) {
    console.error('[Draft] Error syncing Drive to GCS:', error);

    if (error.message?.includes('GCS_KEY_BASE64') || error.message?.includes('Service Account')) {
      return res.status(500).json({
        success: false,
        error: 'Service Account configuration error. Please check GCS_KEY_BASE64 environment variable.',
        details: error.message
      });
    }

    if (error.message?.includes('not found') || error.message?.includes('GCS path')) {
      return res.status(400).json({ success: false, error: error.message });
    }

    res.status(500).json({ success: false, error: 'Failed to sync file', details: error.message });
  }
};

/**
 * GET /api/drafts/:id/open
 * Editing Flow: Redirect user to Google Docs editor OR serve from GCS if file is deleted
 * Updates last_opened_at timestamp
 * Ensures webhook watcher is set up for automatic GCS sync
 * If Google Drive file is deleted/trashed, serves file from GCS bucket instead
 */
const openDocumentForEditing = async (req, res) => {
  try {
    const userId = parseInt(req.user.id);
    const draftId = parseInt(req.params.draftId || req.params.id);

    if (isNaN(draftId)) {
      return res.status(400).json({ success: false, error: 'Invalid draft ID' });
    }

    // Step 1: Fetch draft by ID
    const draft = await Draft.findById(draftId);

    if (!draft) {
      return res.status(404).json({ success: false, error: 'Draft not found' });
    }

    // Verify ownership
    if (draft.user_id !== userId) {
      return res.status(403).json({ success: false, error: 'Permission denied' });
    }

    // Step 2: Ensure editor_type is 'google' (required for Google Docs iframe)
    if (draft.editor_type !== 'google') {
      return res.status(400).json({
        success: false,
        error: 'This endpoint only supports Google Docs editor. Please use editor_type="google"',
        editorType: draft.editor_type || null
      });
    }

    // Step 3: Detect if Google Drive file is deleted OR trashed
    // Use User OAuth to check file state (file is user-owned, service account can't access it)
    let googleFileId = draft.google_file_id;
    let fileNeedsRecreation = false;
    let userOAuthClient = null;
    let userOAuthDrive = null;

    if (googleFileId) {
      try {
        // Get User OAuth client for file existence check (file is user-owned)
        const { getAuthorizedClient } = require('../utils/oauth2Client');
        userOAuthClient = await getAuthorizedClient(userId);
        const { google } = require('googleapis');
        userOAuthDrive = google.drive({ version: 'v3', auth: userOAuthClient });

        // Check if Google Drive file exists and is not trashed using User OAuth
        try {
          const fileMetadata = await userOAuthDrive.files.get({
            fileId: googleFileId,
            fields: 'id, trashed'
          });

          // Check if file is trashed
          if (fileMetadata.data.trashed === true) {
            console.log(`[Draft] Google Drive file ${googleFileId} is in trash - will recreate from GCS`);
            fileNeedsRecreation = true;
          } else {
            console.log(`[Draft] ✅ Google Drive file exists and is not trashed: ${googleFileId}`);
          }
        } catch (driveError) {
          // File doesn't exist (404) - needs recreation
          if (driveError.code === 404 || driveError.message?.includes('not found')) {
            console.log(`[Draft] Google Drive file ${googleFileId} not found (404) - will recreate from GCS`);
            fileNeedsRecreation = true;
          } else {
            // Other error - log but continue (might be permission issue)
            console.warn(`[Draft] ⚠️  Error checking Google Drive file:`, driveError.message);
            // Continue - file might still be accessible
          }
        }
      } catch (error) {
        console.warn(`[Draft] ⚠️  Error during file validation:`, error.message);
        // Continue - we'll try to proceed with existing file
      }
    } else {
      // No google_file_id - check if we have GCS path to recreate from
      if (draft.gcs_path) {
        console.log(`[Draft] No Google Drive file ID - will create from GCS: ${draft.gcs_path}`);
        fileNeedsRecreation = true;
      } else {
        return res.status(400).json({
          success: false,
          error: 'Draft does not have a Google file ID or GCS path',
          draft: {
            id: draft.id,
            title: draft.title,
            status: draft.status
          }
        });
      }
    }

    // Step 4: If deleted OR trashed, recreate from GCS (BLOCKING - must complete before returning)
    if (fileNeedsRecreation) {
      // Check if gcs_path exists
      if (!draft.gcs_path) {
        console.error(`[Draft] ⚠️  Cannot recreate: draft has no gcs_path`);
        return res.status(400).json({
          success: false,
          error: 'Google Drive file is deleted and no GCS backup is available',
          draft: {
            id: draft.id,
            title: draft.title,
            status: draft.status,
            editorType: draft.editor_type
          }
        });
      }

      console.log(`[Draft] 🔄 Starting BLOCKING recreation from GCS: ${draft.gcs_path}`);

      try {
        // Get user's OAuth client (NOT service account) - reuse if already obtained
        if (!userOAuthClient) {
          const { getAuthorizedClient } = require('../utils/oauth2Client');
          userOAuthClient = await getAuthorizedClient(userId);
        }
        console.log(`[Draft] ✅ User OAuth client obtained for recreation`);

        // RECREATE FILE - This is BLOCKING and must complete before proceeding
        const { restoreFileFromGCSToDrive } = require('../services/fileUploadService');
        const recreateResult = await restoreFileFromGCSToDrive(
          draft.id,
          draft.gcs_path,
          draft.title || 'Recreated Document',
          draft.user_id,
          userOAuthClient // Pass user OAuth client, NOT service account
        );

        // CRITICAL: Use NEW google_file_id from recreation result
        googleFileId = recreateResult.google_file_id;
        console.log(`[Draft] ✅ Recreation COMPLETE. New Google File ID: ${googleFileId}`);
        console.log(`[Draft] 📝 OLD file ID was: ${draft.google_file_id}, NEW file ID is: ${googleFileId}`);

        // Verify the new file ID is different and valid
        if (!googleFileId || googleFileId === draft.google_file_id) {
          throw new Error(`Recreation failed: New file ID is invalid or unchanged. Expected new ID, got: ${googleFileId}`);
        }

        // CRITICAL: Refresh draft from database to confirm update completed
        const updatedDraft = await Draft.findById(draftId);
        if (!updatedDraft || updatedDraft.google_file_id !== googleFileId) {
          throw new Error(`Database update verification failed. Expected google_file_id: ${googleFileId}, got: ${updatedDraft?.google_file_id}`);
        }

        console.log(`[Draft] ✅ Database verified: google_file_id = ${googleFileId}`);

        // Update local draft object with confirmed values
        draft.google_file_id = googleFileId;
        draft.drive_item_id = updatedDraft.drive_item_id;
        draft.last_synced_at = updatedDraft.last_synced_at;
        draft.is_shared = updatedDraft.is_shared || true; // Should be true since user owns the file

      } catch (recreateError) {
        console.error(`[Draft] ❌ BLOCKING recreation FAILED:`, recreateError);

        // Handle Drive quota errors specifically
        if (recreateError.code === 507 || recreateError.quotaExceeded ||
          (recreateError.code === 403 && recreateError.errors && recreateError.errors.some(e => e.reason === 'storageQuotaExceeded'))) {
          return res.status(507).json({
            success: false,
            error: 'Google Drive storage quota exceeded',
            message: 'Your Google Drive storage is full. Please free up space and try again.',
            details: recreateError.message
          });
        }

        // Handle OAuth errors (user needs to reconnect Google Drive)
        if (recreateError.message?.includes('not connected Google Drive') ||
          recreateError.message?.includes('invalid_grant') ||
          recreateError.message?.includes('reconnect')) {
          return res.status(401).json({
            success: false,
            error: 'Google Drive connection required',
            message: 'Please reconnect your Google Drive account to recreate the file.',
            details: recreateError.message
          });
        }

        return res.status(500).json({
          success: false,
          error: 'Failed to recreate file from GCS',
          message: 'The file could not be recreated from backup. Please try again or contact support.',
          details: recreateError.message
        });
      }
    }

    // CRITICAL CHECK: Ensure we have a valid google_file_id at this point
    // After recreation, googleFileId MUST be the new file ID, not the old trashed/deleted one
    if (!googleFileId) {
      console.error(`[Draft] ❌ CRITICAL: No valid google_file_id after recreation check`);
      return res.status(400).json({
        success: false,
        error: 'Draft does not have a valid Google file ID'
      });
    }

    // CRITICAL: Verify the file is NOT trashed/deleted before returning iframe URL
    // Use User OAuth for verification (file is user-owned, service account may not have access)
    try {
      // Get User OAuth client if not already obtained (for cases where file didn't need recreation)
      if (!userOAuthClient) {
        const { getAuthorizedClient } = require('../utils/oauth2Client');
        userOAuthClient = await getAuthorizedClient(userId);
      }

      // Use User OAuth client for verification
      const { google } = require('googleapis');
      const userOAuthDrive = google.drive({ version: 'v3', auth: userOAuthClient });

      const fileCheck = await userOAuthDrive.files.get({
        fileId: googleFileId,
        fields: 'id, trashed'
      });

      if (fileCheck.data.trashed === true) {
        console.error(`[Draft] ❌ CRITICAL: File ${googleFileId} is still trashed after recreation!`);
        return res.status(500).json({
          success: false,
          error: 'File recreation failed: File is still trashed',
          message: 'The file could not be properly recreated. Please try again.'
        });
      }

      console.log(`[Draft] ✅ Final verification: File ${googleFileId} exists and is NOT trashed`);
    } catch (verifyError) {
      if (verifyError.code === 404) {
        console.error(`[Draft] ❌ CRITICAL: File ${googleFileId} not found after recreation!`);
        return res.status(500).json({
          success: false,
          error: 'File recreation failed: File not found',
          message: 'The file could not be properly recreated. Please try again.'
        });
      }
      // Other errors might be permission-related, but file exists
      console.warn(`[Draft] ⚠️  Could not verify file (non-critical):`, verifyError.message);
    }

    // Update google_file_id in draft object (using verified new ID)
    draft.google_file_id = googleFileId;

    // Step 5: Share file with logged-in user if is_shared = false
    // Note: If file was recreated, user already owns it (is_shared = true), so skip sharing
    // Check if is_shared flag exists (handle backward compatibility)
    const isShared = draft.is_shared === true || draft.is_shared === 'true' || draft.is_shared === 1;

    if (!isShared) {
      // File exists but is not shared with user - share it
      // This should not happen if file was recreated (user owns it), but handle for existing files
      const userEmail = req.user.email;

      if (!userEmail) {
        console.warn(`[Draft] ⚠️  User email not available in request, cannot share file`);
        return res.status(400).json({
          success: false,
          error: 'User email not available. Cannot share file with user.'
        });
      }

      try {
        // Use user's OAuth client to share (since service account might not have permission)
        const { getAuthorizedClient } = require('../utils/oauth2Client');
        const userOAuthClient = await getAuthorizedClient(userId);
        const { google } = require('googleapis');
        const drive = google.drive({ version: 'v3', auth: userOAuthClient });

        console.log(`[Draft] Sharing file ${googleFileId} with user: ${userEmail}`);

        // Share file with user using USER OAuth client
        await drive.permissions.create({
          fileId: googleFileId,
          requestBody: {
            type: 'user',
            role: 'writer',
            emailAddress: userEmail
          },
          sendNotificationEmail: false, // Don't send notification email
          supportsAllDrives: true
        });

        console.log(`[Draft] ✅ File shared successfully with ${userEmail}`);

        // Update is_shared flag in database
        await Draft.update(draftId, {
          is_shared: true
        });

        draft.is_shared = true; // Update local draft object
      } catch (shareError) {
        // If file is already shared with user, that's fine - mark as shared
        if (shareError.code === 400 && shareError.message?.includes('Permission already exists')) {
          console.log(`[Draft] ⚠️  File already shared with ${userEmail}, marking as shared`);
          await Draft.update(draftId, {
            is_shared: true
          });
          draft.is_shared = true;
        } else {
          console.warn(`[Draft] ⚠️  Failed to share file with user:`, shareError.message);
          return res.status(500).json({
            success: false,
            error: 'Failed to share file with user',
            details: shareError.message
          });
        }
      }
    } else {
      console.log(`[Draft] File already shared (is_shared=true) or user owns it, skipping share step`);
    }

    // Step 6: Ensure webhook watcher is set up for automatic sync (non-blocking)
    // This ensures webhooks are active even if they expired or weren't set up initially
    try {
      const { setupDriveWatcher } = require('../services/driveWebhookService');
      const { getWebhookUrl, validateWebhookUrl } = require('../utils/webhookUrl');

      const validation = validateWebhookUrl();
      if (validation.isValid) {
        const webhookUrl = getWebhookUrl();

        // Get User OAuth client for webhook setup (file is user-owned)
        if (!userOAuthClient) {
          const { getAuthorizedClient } = require('../utils/oauth2Client');
          userOAuthClient = await getAuthorizedClient(userId);
        }

        console.log(`[Draft] 🔔 Setting up/refreshing webhook watcher for file ${googleFileId}`);
        await setupDriveWatcher(googleFileId, draftId, webhookUrl, userOAuthClient);
        console.log(`[Draft] ✅ Webhook watcher set up/refreshed for automatic sync`);
      } else {
        console.warn(`[Draft] ⚠️  Webhook URL validation failed: ${validation.message}`);
      }
    } catch (watcherError) {
      console.warn(`[Draft] ⚠️  Failed to setup webhook watcher (non-critical):`, watcherError.message);
      // Non-critical - file can still be opened, just won't have automatic sync
    }

    // Step 7: Update metadata (last_opened_at and last_synced_at)
    // Use the verified google_file_id (new ID after recreation if needed)
    await Draft.update(draftId, {
      last_opened_at: new Date(),
      last_synced_at: new Date()
    });

    // Step 8: Return iframe URL with VERIFIED google_file_id
    // CRITICAL: Use the verified new file ID (not old trashed/deleted one)
    // This ensures iframe NEVER loads with a trashed or deleted file ID
    const finalGoogleFileId = googleFileId; // Use verified ID from above
    const iframeUrl = `https://docs.google.com/document/d/${finalGoogleFileId}/edit?embedded=true`;

    console.log(`[Draft] ✅ Returning iframe URL for file ID: ${finalGoogleFileId}`);
    console.log(`[Draft] 📋 Iframe URL: ${iframeUrl}`);

    res.status(200).json({
      success: true,
      google_file_id: finalGoogleFileId,
      iframeUrl: iframeUrl
    });

  } catch (error) {
    console.error('[Draft] Error opening document for editing:', error);
    res.status(500).json({ success: false, error: 'Failed to open document', details: error.message });
  }
};

/**
 * GET /api/drafts/webhook-config
 * Check webhook URL configuration status
 * Useful for debugging ngrok setup
 */
const checkWebhookConfig = async (req, res) => {
  try {
    const { validateWebhookUrl, getWebhookUrl, getWebhookBaseUrl } = require('../utils/webhookUrl');

    const validation = validateWebhookUrl();
    const webhookUrl = getWebhookUrl();
    const baseUrl = getWebhookBaseUrl();

    // Check environment variables
    const envVars = {
      NGROK_URL: process.env.NGROK_URL || 'not set',
      WEBHOOK_BASE_URL: process.env.WEBHOOK_BASE_URL || 'not set',
      GATEWAY_URL: process.env.GATEWAY_URL || 'not set'
    };

    res.status(200).json({
      success: true,
      webhook: {
        isValid: validation.isValid,
        message: validation.message,
        suggestion: validation.suggestion,
        url: webhookUrl,
        baseUrl: baseUrl
      },
      environment: {
        variables: envVars,
        active: envVars.NGROK_URL !== 'not set' ? 'NGROK_URL' :
          envVars.WEBHOOK_BASE_URL !== 'not set' ? 'WEBHOOK_BASE_URL' :
            envVars.GATEWAY_URL !== 'not set' ? 'GATEWAY_URL' : 'none'
      },
      instructions: validation.isValid ? null : {
        local: 'For local development: 1) Start ngrok: ngrok http 5000, 2) Set NGROK_URL=https://your-ngrok-url.ngrok-free.app, 3) Restart server',
        production: 'For production: Set WEBHOOK_BASE_URL=https://your-domain.com'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to check webhook configuration',
      details: error.message
    });
  }
};

/**
 * POST /api/drafts/finish-assembled
 * Complete the assembly process by saving the final DOCX to GCS and Drive.
 * If existing_google_file_id is provided (e.g. after section edits), updates that doc
 * so the same Google Doc URL shows the latest content.
 * This is called by the Assembler agent (agent-draft-service)
 */
const saveAssembledDraft = async (req, res) => {
  try {
    const userId = parseInt(req.headers['x-user-id'] || req.user?.id);
    const { title, draft_id: agentDraftId, existing_google_file_id } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ success: false, error: 'No DOCX file provided' });
    }
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User ID is required' });
    }

    console.log(`[Draft] Finalizing assembled draft for user ${userId}, agent draft: ${agentDraftId}`);

    const { uploadToUserDriveAsGoogleDoc } = require('../services/fileUploadService');
    const { getAuthorizedClient } = require('../utils/oauth2Client');
    const { google } = require('googleapis');
    const { Readable } = require('stream');

    const userOAuthClient = await getAuthorizedClient(userId);
    const drive = google.drive({ version: 'v3', auth: userOAuthClient });

    let googleFileId;
    let result;

    const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    if (existing_google_file_id && String(existing_google_file_id).trim() !== '') {
      console.log(`[Draft] 🔄 UPDATING existing Google Doc: ${existing_google_file_id}`);
      try {
        const fileStream = Readable.from(file.buffer);
        await drive.files.update({
          fileId: String(existing_google_file_id).trim(),
          media: {
            mimeType: docxMime,
            body: fileStream
          },
          fields: 'id, name, mimeType, webViewLink'
        });
        googleFileId = existing_google_file_id.trim();
        console.log(`[Draft] ✅ Successfully UPDATED existing Google Doc: ${googleFileId}`);

        const Draft = require('../models/Draft');
        const existingDraft = await Draft.findByGoogleFileId(googleFileId);
        if (existingDraft) {
          await Draft.update(existingDraft.id, {
            last_synced_at: new Date(),
            title: title || existingDraft.title
          });
          result = {
            draft: {
              id: existingDraft.id,
              google_file_id: googleFileId,
              gcs_path: existingDraft.gcs_path,
              title: title || existingDraft.title
            }
          };
        } else {
          result = { draft: { google_file_id: googleFileId, title: title || 'Assembled_Draft' } };
        }
      } catch (updateError) {
        console.error(`[Draft] ❌ Failed to update existing file ${existing_google_file_id}:`, updateError.message);
        console.log(`[Draft] 🔄 Falling back to creating new file`);
        result = await uploadToUserDriveAsGoogleDoc(
          file.buffer,
          userId,
          `${title || 'Assembled_Draft'}.docx`,
          docxMime,
          title,
          userOAuthClient
        );
        googleFileId = result.draft.google_file_id;
      }
    } else {
      console.log(`[Draft] ✨ CREATING new Google Doc`);
      result = await uploadToUserDriveAsGoogleDoc(
        file.buffer,
        userId,
        `${title || 'Assembled_Draft'}.docx`,
        docxMime,
        title,
        userOAuthClient
      );
      googleFileId = result.draft.google_file_id;
    }

    if (agentDraftId) {
      try {
        const pool = require('../config/db');
        const versionQuery = 'SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM generated_documents WHERE draft_id = $1';
        const versionRes = await pool.query(versionQuery, [agentDraftId]);
        const nextVersion = versionRes.rows[0].next_version;
        const genDocQuery = `
          INSERT INTO generated_documents (document_id, draft_id, version, is_final, generated_at, file_size, file_name, file_path, file_type)
          VALUES (gen_random_uuid(), $1, $2, $3, NOW(), $4, $5, $6, $7)
          RETURNING *
        `;
        const genDocValues = [
          agentDraftId,
          nextVersion,
          true,
          file.size,
          `${title || 'Assembled_Draft'}.docx`,
          result.draft.gcs_path || '',
          'docx'
        ];
        await pool.query(genDocQuery, genDocValues);
        console.log(`[Draft] ✅ Saved to generated_documents. Version: ${nextVersion}`);
      } catch (dbError) {
        console.warn(`[Draft] ⚠️  Failed to save to generated_documents (non-critical):`, dbError.message);
      }
    }

    console.log(`[Draft] ✅ Assembled draft finished. Google File ID: ${googleFileId}`);

    res.status(200).json({
      success: true,
      message: existing_google_file_id ? 'Draft updated successfully' : 'Draft assembled and saved successfully',
      googleFileId,
      iframeUrl: `https://docs.google.com/document/d/${googleFileId}/edit?embedded=true`,
      draft: result.draft,
      updated: !!(existing_google_file_id && String(existing_google_file_id).trim())
    });

  } catch (error) {
    console.error('[Draft] Error saving assembled draft:', error);
    res.status(500).json({ success: false, error: 'Failed to save assembled draft', details: error.message });
  }
};

module.exports = {
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
  uploadLocalFile,
  uploadFileInitial,
  syncDriveToGCSController,
  openDocumentForEditing,
  checkWebhookConfig,
  viewDocumentFromGCS,
  saveAssembledDraft
};
