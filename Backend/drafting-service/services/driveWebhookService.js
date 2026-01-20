const { google } = require('googleapis');
const { Storage } = require('@google-cloud/storage');
const Draft = require('../models/Draft');

/**
 * Google Drive Webhook Service
 * Handles real-time sync from Google Docs to GCS using Push Notifications
 */

// Initialize Service Account credentials (reuse from fileUploadService pattern)
let serviceAccountCredentials = null;
let storage = null;
let driveClient = null;

/**
 * Initialize Service Account credentials and clients
 */
function initializeServiceAccount() {
  if (serviceAccountCredentials && storage && driveClient) {
    return { storage, driveClient };
  }

  try {
    if (!process.env.GCS_KEY_BASE64) {
      throw new Error('GCS_KEY_BASE64 environment variable is not set');
    }

    const jsonString = Buffer.from(process.env.GCS_KEY_BASE64, 'base64').toString('utf-8');
    serviceAccountCredentials = JSON.parse(jsonString);

    if (!serviceAccountCredentials.project_id || 
        !serviceAccountCredentials.private_key || 
        !serviceAccountCredentials.client_email) {
      throw new Error('Invalid service account key format. Missing required fields.');
    }

    // Initialize GCS Storage with Service Account
    storage = new Storage({
      credentials: serviceAccountCredentials,
      projectId: serviceAccountCredentials.project_id
    });

    // Initialize Google Drive API with Service Account JWT
    const jwtClient = new google.auth.JWT(
      serviceAccountCredentials.client_email,
      null,
      serviceAccountCredentials.private_key,
      ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive']
    );

    driveClient = google.drive({ version: 'v3', auth: jwtClient });

    return { storage, driveClient };
  } catch (error) {
    console.error('[DriveWebhook] ❌ Failed to initialize Service Account:', error.message);
    throw new Error(`Failed to initialize Service Account: ${error.message}`);
  }
}

// Initialize on module load
initializeServiceAccount();

const BUCKET_NAME = process.env.GCS_BUCKET || process.env.GCS_BUCKET_NAME || 'draft_templates';

/**
 * Sync Google Doc to GCS
 * Exports the document and overwrites the file at the existing gcs_path
 * NOTE: This function is DEPRECATED - use fileUploadService.syncGoogleDocToGCS instead
 * which uses User OAuth for Drive operations
 * 
 * @param {string} googleFileId - Google Drive file ID
 * @param {string} exportFormat - Export format: 'docx' or 'pdf' (default: 'docx')
 * @param {Object} userOAuthClient - User's OAuth client (required)
 * @returns {Promise<Object>} Sync result
 */
const syncGoogleDocToGCS = async (googleFileId, exportFormat = 'docx', userOAuthClient = null) => {
  try {
    // Use service account ONLY for GCS storage operations
    const { storage: storageClient } = initializeServiceAccount();
    
    // Use User OAuth for Drive API operations (export)
    if (!userOAuthClient) {
      throw new Error('User OAuth client is required for exporting Google Docs');
    }
    
    const { google } = require('googleapis');
    const drive = google.drive({ version: 'v3', auth: userOAuthClient });
    
    console.log(`[DriveWebhook] Starting sync for Google file ${googleFileId} as ${exportFormat}`);

    // Step 1: Find the corresponding gcs_path in the database
    const draft = await Draft.findByGoogleFileId(googleFileId);
    
    if (!draft) {
      throw new Error(`Draft with google_file_id ${googleFileId} not found`);
    }

    let gcsPath = draft.gcs_path;
    
    // If no gcs_path exists, create one (for drafts created from templates)
    if (!gcsPath) {
      console.log(`[DriveWebhook] Draft ${draft.id} doesn't have a GCS path. Creating initial GCS path...`);
      
      // Get file metadata from Google Drive to get the title
      let fileName = draft.title || 'document';
      try {
        const fileMetadata = await drive.files.get({
          fileId: googleFileId,
          fields: 'name, mimeType'
        });
        fileName = fileMetadata.data.name || draft.title || 'document';
      } catch (metadataError) {
        if (metadataError.code === 404 || metadataError.message?.includes('not found')) {
          throw new Error(`File not found in Google Drive. The file may have been deleted or you may not have access to it.`);
        }
        console.warn(`[DriveWebhook] Could not get file metadata, using draft title:`, metadataError.message);
      }
      
      const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const timestamp = Date.now();
      const fileExtension = exportFormat === 'pdf' ? 'pdf' : 'docx';
      
      // Create GCS path similar to handleInitialUpload
      gcsPath = `uploads/${draft.user_id}/${timestamp}_${safeFileName}.${fileExtension}`;
      
      console.log(`[DriveWebhook] Created new GCS path: ${gcsPath}`);
      
      // Update draft with the new gcs_path
      await Draft.update(draft.id, {
        gcs_path: gcsPath
      });
      
      console.log(`[DriveWebhook] Updated draft ${draft.id} with GCS path: ${gcsPath}`);
    } else {
      console.log(`[DriveWebhook] Using existing GCS path: ${gcsPath}`);
    }

    // Step 2: Export the Google Doc using drive.files.export with Docx mimeType
    const mimeTypes = {
      'pdf': 'application/pdf',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    };

    const mimeType = mimeTypes[exportFormat.toLowerCase()] || mimeTypes.docx;

    console.log(`[DriveWebhook] Exporting Google Doc ${googleFileId} as ${mimeType}`);

    const exportResponse = await drive.files.export(
      {
        fileId: googleFileId,
        mimeType: mimeType
      },
      {
        responseType: 'stream'
      }
    );

    const exportStream = exportResponse.data;

    // Step 3: Convert stream to buffer
    const chunks = [];
    for await (const chunk of exportStream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // Step 4: Use bucket.file(gcs_path).save() to overwrite the existing file in GCS
    console.log(`[DriveWebhook] Overwriting file in GCS: ${gcsPath}`);
    console.log(`[DriveWebhook]    File size: ${buffer.length} bytes`);
    
    const bucket = storageClient.bucket(BUCKET_NAME);
    const gcsFile = bucket.file(gcsPath);

    // Check if file exists before deleting
    try {
      const [exists] = await gcsFile.exists();
      if (exists) {
        console.log(`[DriveWebhook] Existing file found at ${gcsPath}, deleting before overwrite...`);
        await gcsFile.delete();
        console.log(`[DriveWebhook] ✅ Existing file deleted`);
      } else {
        console.log(`[DriveWebhook] No existing file at ${gcsPath}, creating new one`);
      }
    } catch (deleteError) {
      console.warn(`[DriveWebhook] ⚠️  Error checking/deleting existing file:`, deleteError.message);
      // Continue anyway - we'll try to save
    }

    // Save the exported content to GCS (overwrite)
    console.log(`[DriveWebhook] Saving ${buffer.length} bytes to GCS: ${gcsPath}`);
    await gcsFile.save(buffer, {
      metadata: {
        contentType: mimeType,
        metadata: {
          draftId: draft.id.toString(),
          userId: draft.user_id.toString(),
          title: draft.title,
          googleFileId: googleFileId,
          exportedAt: new Date().toISOString(),
          syncedAt: new Date().toISOString(),
          syncedVia: 'webhook'
        }
      },
      resumable: false
    });

    console.log(`[DriveWebhook] ✅ File successfully saved/overwritten in GCS: ${gcsPath}`);

    // Step 5: Update last_synced_at in the database
    const updatedDraft = await Draft.update(draft.id, {
      last_synced_at: new Date()
    });

    console.log(`[DriveWebhook] ✅ Google file ${googleFileId} synced successfully to ${gcsPath}`);
    console.log(`[DriveWebhook]    File size: ${buffer.length} bytes`);

    return {
      success: true,
      draftId: draft.id,
      google_file_id: googleFileId,
      gcsPath: gcsPath,
      exportFormat: exportFormat,
      syncedAt: updatedDraft.last_synced_at,
      fileSize: buffer.length
    };
  } catch (error) {
    console.error(`[DriveWebhook] Error syncing Google Doc to GCS:`, error);
    throw error;
  }
};

/**
 * Setup Drive Watcher
 * Registers a webhook for a Google Drive file using drive.files.watch
 * Uses User OAuth for user-owned files (service account cannot access them)
 * Falls back to service account for legacy files that service account uploaded
 * 
 * @param {string} googleFileId - Google Drive file ID
 * @param {number} draftId - Draft ID (for reference)
 * @param {string} webhookUrl - Full URL of the webhook endpoint
 * @param {Object} [userOAuthClient] - Optional User OAuth client (required for user-owned files)
 * @returns {Promise<Object>} Watcher information with expiration
 */
const setupDriveWatcher = async (googleFileId, draftId, webhookUrl, userOAuthClient = null) => {
  try {
    let drive;
    
    // Use User OAuth if provided (for user-owned files), otherwise fall back to service account
    if (userOAuthClient) {
      const { google } = require('googleapis');
      drive = google.drive({ version: 'v3', auth: userOAuthClient });
      console.log(`[DriveWebhook] Setting up watcher for Google file ${googleFileId} (draft ${draftId}) using User OAuth`);
    } else {
      const { driveClient } = initializeServiceAccount();
      drive = driveClient;
      console.log(`[DriveWebhook] Setting up watcher for Google file ${googleFileId} (draft ${draftId}) using Service Account`);
    }
    
    console.log(`[DriveWebhook] Setting up watcher for Google file ${googleFileId} (draft ${draftId})`);

    // Generate a unique channel ID
    const channelId = `webhook-${draftId}-${Date.now()}`;

    // Call drive.files.watch to register the webhook
    const watchResponse = await drive.files.watch({
      fileId: googleFileId,
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address: webhookUrl,
        // Optional: Set expiration (default is 1 hour, max is 7 days)
        expiration: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days in milliseconds
      }
    });

    const resourceId = watchResponse.data.resourceId;
    const expirationValue = watchResponse.data.expiration;
    
    // Handle expiration time - Google returns it in milliseconds
    let expirationTime;
    try {
      // expiration can be a number (milliseconds) or a string
      const expirationMs = typeof expirationValue === 'string' 
        ? parseInt(expirationValue, 10) 
        : expirationValue;
      
      expirationTime = new Date(expirationMs);
      
      // Validate the date
      if (isNaN(expirationTime.getTime())) {
        throw new Error('Invalid expiration value');
      }
    } catch (error) {
      console.warn(`[DriveWebhook] ⚠️  Could not parse expiration time: ${expirationValue}`);
      // Use a default expiration (7 days from now)
      expirationTime = new Date(Date.now() + (7 * 24 * 60 * 60 * 1000));
    }

    console.log(`[DriveWebhook] ✅ Watcher registered for ${googleFileId}`);
    console.log(`[DriveWebhook]    Channel ID: ${channelId}`);
    console.log(`[DriveWebhook]    Resource ID: ${resourceId}`);
    console.log(`[DriveWebhook]    Expiration: ${expirationTime.toISOString()}`);

    // Store the expiration time and resource ID in the database
    // Note: You may want to add fields like webhook_channel_id, webhook_resource_id, webhook_expires_at
    // For now, we'll store it in a JSONB field or use existing fields
    // This is a placeholder - adjust based on your schema
    try {
      await Draft.update(draftId, {
        // If you have a metadata JSONB field, you could store it there
        // Or add specific columns for webhook info
      });
    } catch (dbError) {
      console.warn(`[DriveWebhook] ⚠️  Could not store watcher info in database:`, dbError.message);
      // Non-critical, continue
    }

    return {
      success: true,
      channelId: channelId,
      resourceId: resourceId,
      expiration: expirationTime,
      expirationTimestamp: expirationTime.getTime()
    };
  } catch (error) {
    console.error(`[DriveWebhook] Error setting up watcher:`, error);
    throw error;
  }
};

/**
 * Stop Drive Watcher
 * Unsubscribes from push notifications
 * 
 * @param {string} channelId - Channel ID from watch response
 * @param {string} resourceId - Resource ID from watch response
 * @returns {Promise<void>}
 */
const stopDriveWatcher = async (channelId, resourceId) => {
  try {
    const { driveClient: drive } = initializeServiceAccount();
    
    console.log(`[DriveWebhook] Stopping watcher: ${channelId}`);

    await drive.channels.stop({
      requestBody: {
        id: channelId,
        resourceId: resourceId
      }
    });

    console.log(`[DriveWebhook] ✅ Watcher stopped: ${channelId}`);
  } catch (error) {
    console.error(`[DriveWebhook] Error stopping watcher:`, error);
    throw error;
  }
};

module.exports = {
  syncGoogleDocToGCS,
  setupDriveWatcher,
  stopDriveWatcher
};

