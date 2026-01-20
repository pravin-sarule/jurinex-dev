const { google } = require('googleapis');
const { getAuthorizedClient, getUserEmail } = require('../utils/oauth2Client');
const Draft = require('../models/Draft');

/**
 * Google Docs Service
 * Handles document creation, permissions, and management
 */

/**
 * Create a new Google Docs document
 * @param {number} userId - User ID
 * @param {string} title - Document title
 * @param {string} [userEmail] - Optional user email (from JWT token)
 * @returns {Promise<Object>} Created document with google_file_id
 */
const createGoogleDoc = async (userId, title, userEmail = null) => {
  try {
    console.log(`[GoogleDocs] Creating document for user ${userId}: "${title}"`);

    // Get authorized OAuth2 client
    const oauth2Client = await getAuthorizedClient(userId);
    
    // Get user's email - try multiple sources
    let email = userEmail; // Use provided email first (from JWT token)
    
    if (!email) {
      // Try Google userinfo API (most reliable)
      try {
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const userInfo = await oauth2.userinfo.get();
        email = userInfo.data.email;
        console.log(`[GoogleDocs] ✅ Got user email from Google: ${email}`);
      } catch (emailError) {
        // Google userinfo failed - try auth service only if INTERNAL_SERVICE_TOKEN is set
        if (process.env.INTERNAL_SERVICE_TOKEN) {
          try {
            email = await getUserEmail(userId);
            console.log(`[GoogleDocs] ✅ Got user email from auth service: ${email}`);
          } catch (authError) {
            console.warn(`[GoogleDocs] ⚠️  Could not get email from auth service (non-critical):`, authError.message);
            email = null;
          }
        } else {
          console.log(`[GoogleDocs] ℹ️  Skipping auth service email lookup (INTERNAL_SERVICE_TOKEN not set). File will be owned by authenticated user.`);
          email = null;
        }
      }
    } else {
      console.log(`[GoogleDocs] ✅ Using provided user email: ${email}`);
    }

    // Initialize Drive API
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    // Step 1: Create the Google Docs file
    const fileMetadata = {
      name: title,
      mimeType: 'application/vnd.google-apps.document'
    };

    const createResponse = await drive.files.create({
      requestBody: fileMetadata,
      fields: 'id, name, webViewLink, webContentLink'
    });

    const googleFileId = createResponse.data.id;
    const fileUrl = createResponse.data.webViewLink;

    console.log(`[GoogleDocs] ✅ Document created: ${googleFileId}`);

    // Step 2: Grant user write permission (crucial for iframe editing)
    // Only set explicit permission if we have the email
    if (email) {
      try {
        await drive.permissions.create({
          fileId: googleFileId,
          requestBody: {
            role: 'writer',
            type: 'user',
            emailAddress: email
          },
          sendNotificationEmail: false // Don't send email notification
        });

        console.log(`[GoogleDocs] ✅ Write permission granted to ${email}`);
      } catch (permError) {
        console.warn(`[GoogleDocs] ⚠️  Failed to set explicit permission (may already exist):`, permError.message);
        // Continue - file might already have permissions or be owned by the user
      }
    } else {
      console.log(`[GoogleDocs] ℹ️  Skipping explicit permission (no email available). File is owned by authenticated user - this is fine.`);
    }

    // NOTE: Service account is NOT added to user files - we use User OAuth for all operations

    // Step 3: Insert into drafts table
    const draft = await Draft.create({
      user_id: userId,
      title: title,
      google_file_id: googleFileId,
      status: 'active',
      editor_type: 'google' // Set editor type to 'google' for Google Docs
    });

    console.log(`[GoogleDocs] ✅ Draft record created: ${draft.id}`);

    // Step 4: Perform initial export to GCS to create gcs_path
    // This ensures the draft has a gcs_path for future syncs
    try {
      const { syncGoogleDocToGCS } = require('./fileUploadService');
      const { getAuthorizedClient } = require('../utils/oauth2Client');
      
      // Get User OAuth client for export (User OAuth is required for Drive operations)
      const userOAuthClient = await getAuthorizedClient(userId);
      
      console.log(`[GoogleDocs] Performing initial export to GCS for draft ${draft.id}`);
      const syncResult = await syncGoogleDocToGCS(googleFileId, 'docx', userOAuthClient);
      console.log(`[GoogleDocs] ✅ Initial export completed: ${syncResult.gcsPath}`);
      
      // Update draft with gcs_path if it was created
      if (syncResult.gcsPath) {
        await Draft.update(draft.id, {
          gcs_path: syncResult.gcsPath,
          last_synced_at: new Date()
        });
        console.log(`[GoogleDocs] ✅ Updated draft with gcs_path: ${syncResult.gcsPath}`);
      }
    } catch (syncError) {
      console.warn(`[GoogleDocs] ⚠️  Initial export failed (non-critical, will retry on edit):`, syncError.message);
      // Non-critical - draft is still created, webhook will handle future syncs
    }

    // Step 5: Setup webhook watcher for real-time sync to GCS
    // This ensures edited files are automatically saved to GCS
    try {
      const { setupDriveWatcher } = require('./driveWebhookService');
      const { getWebhookUrl, validateWebhookUrl } = require('../utils/webhookUrl');
      
      // Validate webhook URL configuration
      const validation = validateWebhookUrl();
      if (!validation.isValid) {
        console.warn(`[GoogleDocs] ⚠️  Webhook URL validation failed: ${validation.message}`);
        console.warn(`[GoogleDocs] ⚠️  Suggestion: ${validation.suggestion}`);
        console.warn(`[GoogleDocs] ⚠️  Webhook will not be set up. For local development, use ngrok.`);
      } else {
        const webhookUrl = getWebhookUrl();
        console.log(`[GoogleDocs] Setting up webhook watcher for automatic GCS sync`);
        console.log(`[GoogleDocs] Webhook URL: ${webhookUrl}`);
        // Use User OAuth for webhook setup (file is user-owned, service account can't access it)
        await setupDriveWatcher(googleFileId, draft.id, webhookUrl, oauth2Client);
        console.log(`[GoogleDocs] ✅ Webhook watcher set up for automatic sync`);
      }
    } catch (watcherError) {
      console.warn(`[GoogleDocs] ⚠️  Failed to setup webhook watcher (non-critical):`, watcherError.message);
      // Non-critical - draft is still created, just won't have automatic sync
    }

    return {
      draftId: draft.id,
      googleFileId: googleFileId,
      title: title,
      fileUrl: fileUrl,
      webContentLink: createResponse.data.webContentLink
    };
  } catch (error) {
    console.error(`[GoogleDocs] Error creating document:`, error);
    
    if (error.message?.includes('not connected Google Drive')) {
      throw new Error('Google Drive not connected. Please connect your Google Drive account first.');
    }
    
    if (error.message?.includes('expired')) {
      throw new Error('Google Drive connection expired. Please reconnect your Google Drive account.');
    }

    // Handle Google API quota limits
    if (error.code === 429 || error.message?.includes('quota') || error.message?.includes('rate limit')) {
      throw new Error('Google API quota exceeded. Please try again later.');
    }

    throw new Error(`Failed to create Google Docs document: ${error.message}`);
  }
};

/**
 * Get editor URL for iframe embedding
 * @param {number} draftId - Draft ID
 * @returns {Promise<string>} Google Docs editor URL
 */
const getEditorUrl = async (draftId) => {
  try {
    const draft = await Draft.findById(draftId);
    
    if (!draft) {
      throw new Error(`Draft ${draftId} not found`);
    }

    if (!draft.google_file_id) {
      throw new Error(`Draft ${draftId} does not have a Google file ID`);
    }

    // Return full Google Docs UI URL for iframe embedding
    return `https://docs.google.com/document/d/${draft.google_file_id}/edit`;
  } catch (error) {
    console.error(`[GoogleDocs] Error getting editor URL:`, error);
    throw error;
  }
};

/**
 * Get draft details including editor URL
 * @param {number} draftId - Draft ID
 * @returns {Promise<Object>} Draft details with editor URL
 */
const getDraftWithEditorUrl = async (draftId) => {
  try {
    const draft = await Draft.findById(draftId);
    
    if (!draft) {
      throw new Error(`Draft ${draftId} not found`);
    }

    const editorUrl = draft.google_file_id 
      ? `https://docs.google.com/document/d/${draft.google_file_id}/edit`
      : null;

    return {
      ...draft,
      editorUrl
    };
  } catch (error) {
    console.error(`[GoogleDocs] Error getting draft with editor URL:`, error);
    throw error;
  }
};

module.exports = {
  createGoogleDoc,
  getEditorUrl,
  getDraftWithEditorUrl
};
