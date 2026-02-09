const { google } = require('googleapis');
const { Storage } = require('@google-cloud/storage');
const { Readable } = require('stream');
const Draft = require('../models/Draft');

/**
 * File Upload Service
 * Handles initial upload flow: Local -> GCS -> Google Drive -> Database
 * Uses Service Account credentials from GCS_KEY_BASE64
 */

// Initialize Service Account credentials
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
    // Decode base64 service account key
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

    console.log('[FileUpload] ✅ Service Account credentials loaded');
    console.log(`[FileUpload]    Project ID: ${serviceAccountCredentials.project_id}`);
    console.log(`[FileUpload]    Client Email: ${serviceAccountCredentials.client_email}`);

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

    console.log('[FileUpload] ✅ GCS Storage and Google Drive clients initialized');

    return { storage, driveClient };
  } catch (error) {
    console.error('[FileUpload] ❌ Failed to initialize Service Account:', error.message);
    throw new Error(`Failed to initialize Service Account: ${error.message}`);
  }
}

// Initialize on module load
initializeServiceAccount();

const BUCKET_NAME = process.env.GCS_BUCKET || process.env.GCS_BUCKET_NAME || 'draft_templates';

/**
 * Function 1: handleInitialUpload
 * Upload file to GCS, then to Google Drive (converted to Google Doc), and save to database
 * 
 * @param {Buffer} fileBuffer - File buffer from upload
 * @param {number} userId - User ID
 * @param {string} filename - Original filename
 * @param {string} mimetype - File MIME type
 * @param {string} title - Document title (optional, defaults to filename without extension)
 * @returns {Promise<Object>} Created draft with all IDs and paths
 */
const handleInitialUpload = async (fileBuffer, userId, filename, mimetype, title = null) => {
  let gcsPath = null; // Declare outside try block for cleanup

  try {
    // Ensure clients are initialized
    const { storage: storageClient, driveClient: drive } = initializeServiceAccount();

    console.log(`[FileUpload] Starting upload for user ${userId}: ${filename}`);

    // Determine title (use provided title or derive from filename)
    const baseName = title || filename.replace(/\.[^/.]+$/, '');
    const timestamp = Date.now();
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');

    // Step 1: Upload to GCS at path uploads/{userId}/{timestamp}_{title}.docx
    // Use .docx extension for consistency (will be converted to Google Docs)
    const fileExtension = filename.match(/\.[^/.]+$/) ? filename.match(/\.[^/.]+$/)[0] : '.docx';
    gcsPath = `uploads/${userId}/${timestamp}_${baseName.replace(/[^a-zA-Z0-9._-]/g, '_')}${fileExtension}`;

    console.log(`[FileUpload] Step 1: Uploading to GCS: ${gcsPath}`);

    const bucket = storageClient.bucket(BUCKET_NAME);
    const gcsFile = bucket.file(gcsPath);

    await gcsFile.save(fileBuffer, {
      metadata: {
        contentType: mimetype,
        metadata: {
          userId: userId.toString(),
          originalFilename: filename,
          title: baseName,
          uploadedAt: new Date().toISOString()
        }
      },
      resumable: false
    });

    console.log(`[FileUpload] ✅ File uploaded to GCS: ${gcsPath}`);

    // Step 2: Download file from GCS and convert to stream
    console.log(`[FileUpload] Step 2: Downloading from GCS for Drive upload`);
    const [fileContents] = await gcsFile.download();
    const fileStream = Readable.from(fileContents);

    // Step 3: Upload to Google Drive using mimeType: 'application/vnd.google-apps.document'
    console.log(`[FileUpload] Step 3: Uploading to Google Drive and converting to Google Docs`);

    // Check if file needs conversion to Google Docs
    const supportedFormats = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/msword', // .doc
      'text/plain', // .txt
      'application/pdf', // .pdf
      'application/rtf', // .rtf
      'text/html' // .html
    ];

    let googleFileId;
    let drivePath = `/${baseName}`;

    // If file can be converted to Google Docs, use import feature
    if (supportedFormats.includes(mimetype) || mimetype === 'application/vnd.google-apps.document') {
      console.log(`[FileUpload] Step 4: Converting file to Google Docs format`);

      try {
        // Import as Google Docs (this automatically converts the file)
        const importFile = await drive.files.create({
          requestBody: {
            name: baseName,
            mimeType: 'application/vnd.google-apps.document' // Target format: Google Docs
          },
          media: {
            mimeType: mimetype === 'application/vnd.google-apps.document' ? mimetype : mimetype, // Source format
            body: fileStream
          },
          fields: 'id, name, mimeType, webViewLink'
        });

        googleFileId = importFile.data.id;
        console.log(`[FileUpload] ✅ File converted to Google Docs: ${googleFileId}`);
      } catch (driveError) {
        // Handle specific Google Drive errors
        if (driveError.code === 403 && driveError.errors && driveError.errors.length > 0) {
          const errorReason = driveError.errors[0].reason;
          const errorMessage = driveError.errors[0].message;

          if (errorReason === 'storageQuotaExceeded') {
            throw new Error(
              'Google Drive storage quota exceeded. ' +
              'The Service Account\'s Google Drive storage is full. ' +
              'Please free up space or upgrade the storage quota. ' +
              'Note: Files are still saved in GCS, but Google Docs conversion failed.'
            );
          } else if (errorReason === 'insufficientFilePermissions') {
            throw new Error(
              'Insufficient permissions to create files in Google Drive. ' +
              'Please check Service Account permissions and ensure Drive API is enabled.'
            );
          } else {
            throw new Error(`Google Drive upload failed: ${errorMessage}`);
          }
        }
        throw driveError;
      }
    } else {
      // Upload as-is (may not be editable in Google Docs)
      console.warn(`[FileUpload] ⚠️  File format ${mimetype} may not be editable in Google Docs`);

      try {
        const driveFile = await drive.files.create({
          requestBody: {
            name: baseName,
            mimeType: mimetype
          },
          media: {
            mimeType: mimetype,
            body: fileStream
          },
          fields: 'id, name, mimeType, webViewLink'
        });
        googleFileId = driveFile.data.id;
        console.log(`[FileUpload] ✅ File uploaded to Drive: ${googleFileId}`);
      } catch (driveError) {
        // Handle specific Google Drive errors
        if (driveError.code === 403 && driveError.errors && driveError.errors.length > 0) {
          const errorReason = driveError.errors[0].reason;
          const errorMessage = driveError.errors[0].message;

          if (errorReason === 'storageQuotaExceeded') {
            throw new Error(
              'Google Drive storage quota exceeded. ' +
              'The Service Account\'s Google Drive storage is full. ' +
              'Please free up space or upgrade the storage quota. ' +
              'Note: Files are still saved in GCS, but Google Drive upload failed.'
            );
          } else if (errorReason === 'insufficientFilePermissions') {
            throw new Error(
              'Insufficient permissions to create files in Google Drive. ' +
              'Please check Service Account permissions and ensure Drive API is enabled.'
            );
          } else {
            throw new Error(`Google Drive upload failed: ${errorMessage}`);
          }
        }
        throw driveError;
      }
    }

    // Step 4: Get file metadata to determine drive path
    try {
      const fileMetadata = await drive.files.get({
        fileId: googleFileId,
        fields: 'name, parents'
      });

      drivePath = `/${fileMetadata.data.name}`;
    } catch (error) {
      console.warn(`[FileUpload] ⚠️  Could not get file metadata for path:`, error.message);
    }

    // Step 5: Store the result in the PostgreSQL database
    console.log(`[FileUpload] Step 5: Saving to database`);

    const draft = await Draft.create({
      user_id: userId,
      title: baseName,
      google_file_id: googleFileId,
      drive_item_id: googleFileId, // Same as google_file_id
      gcs_path: gcsPath,
      drive_path: drivePath,
      status: 'active',
      editor_type: 'google',
      last_synced_at: new Date() // Set initial sync time
    });

    console.log(`[FileUpload] ✅ Draft saved to database: ${draft.id}`);

    // Step 6: Automatically setup webhook watcher for real-time sync
    // This ensures edited files are automatically saved to GCS
    try {
      const { setupDriveWatcher } = require('./driveWebhookService');
      const { getWebhookUrl, validateWebhookUrl } = require('../utils/webhookUrl');

      // Validate webhook URL configuration
      const validation = validateWebhookUrl();
      if (!validation.isValid) {
        console.warn(`[FileUpload] ⚠️  Webhook URL validation failed: ${validation.message}`);
        console.warn(`[FileUpload] ⚠️  Suggestion: ${validation.suggestion}`);
        console.warn(`[FileUpload] ⚠️  Webhook will not be set up. For local development, use ngrok.`);
        throw new Error(validation.message);
      }

      const webhookUrl = getWebhookUrl();
      console.log(`[FileUpload] Step 6: Setting up webhook watcher for automatic sync`);
      console.log(`[FileUpload] Webhook URL: ${webhookUrl}`);
      const watcherInfo = await setupDriveWatcher(googleFileId, draft.id, webhookUrl);
      console.log(`[FileUpload] ✅ Webhook watcher set up. Expires: ${watcherInfo.expiration.toISOString()}`);
    } catch (watcherError) {
      console.warn(`[FileUpload] ⚠️  Failed to setup webhook watcher (non-critical):`, watcherError.message);
      // Non-critical - file is still saved, just won't have automatic sync
    }

    return {
      success: true,
      draft: {
        id: draft.id,
        user_id: draft.user_id,
        title: draft.title,
        google_file_id: draft.google_file_id,
        drive_item_id: draft.drive_item_id,
        gcs_path: draft.gcs_path,
        drive_path: draft.drive_path,
        last_synced_at: draft.last_synced_at,
        status: draft.status,
        editor_type: draft.editor_type
      },
      editorUrl: `https://docs.google.com/document/d/${googleFileId}/edit`
    };
  } catch (error) {
    console.error(`[FileUpload] Error uploading file:`, error);

    // Only clean up GCS file if it's not a Drive quota error
    // If Drive quota is exceeded, the file is still useful in GCS
    const isQuotaError = error.message?.includes('storage quota exceeded') ||
      error.message?.includes('storageQuotaExceeded') ||
      (error.code === 403 && error.errors && error.errors.some(e => e.reason === 'storageQuotaExceeded'));

    if (gcsPath && !isQuotaError) {
      try {
        const { storage: storageClient } = initializeServiceAccount();
        const bucket = storageClient.bucket(BUCKET_NAME);
        const gcsFile = bucket.file(gcsPath);
        await gcsFile.delete();
        console.log(`[FileUpload] Cleaned up GCS file: ${gcsPath}`);
      } catch (cleanupError) {
        console.warn(`[FileUpload] Failed to clean up GCS file:`, cleanupError.message);
      }
    } else if (isQuotaError && gcsPath) {
      console.log(`[FileUpload] Keeping GCS file ${gcsPath} despite Drive quota error - file is still accessible in GCS`);
    }

    // Handle specific errors
    if (error.message?.includes('invalid_grant') || error.message?.includes('invalid_rapt')) {
      throw new Error('Service Account authentication failed. Please check GCS_KEY_BASE64 configuration.');
    }

    if (error.message?.includes('storage quota exceeded') || error.message?.includes('storageQuotaExceeded')) {
      // Don't clean up GCS file if Drive quota is exceeded - file is still in GCS
      throw error; // Re-throw the error with the detailed message
    }

    throw new Error(`Failed to upload file: ${error.message}`);
  }
};

/**
 * Function 2: syncGoogleDocToGCS
 * Export Google Doc and overwrite the file at the exact same gcs_path
 * If gcs_path doesn't exist, creates it first (for drafts created from templates)
 * 
 * @param {string} googleFileId - Google Drive file ID
 * @param {string} exportFormat - Export format: 'docx' or 'pdf' (default: 'docx')
 * @param {Object} userOAuthClient - User's OAuth client for Drive API (required for export)
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

    console.log(`[FileUpload] Starting sync for Google file ${googleFileId} as ${exportFormat}`);

    // Step 1: Fetch the draft from the database
    const draft = await Draft.findByGoogleFileId(googleFileId);

    if (!draft) {
      throw new Error(`Draft with google_file_id ${googleFileId} not found`);
    }

    let gcsPath = draft.gcs_path;

    // If no gcs_path exists, create one (for drafts created from templates)
    if (!gcsPath) {
      console.log(`[FileUpload] Draft ${draft.id} doesn't have a GCS path. Creating initial GCS path...`);

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
        // If it's another error, use draft title as fallback
        console.warn(`[FileUpload] Could not get file metadata, using draft title:`, metadataError.message);
      }
      const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const timestamp = Date.now();
      const fileExtension = exportFormat === 'pdf' ? 'pdf' : 'docx';

      // Create GCS path similar to handleInitialUpload
      gcsPath = `uploads/${draft.user_id}/${timestamp}_${safeFileName}.${fileExtension}`;

      console.log(`[FileUpload] Created new GCS path: ${gcsPath}`);

      // Update draft with the new gcs_path
      await Draft.update(draft.id, {
        gcs_path: gcsPath
      });

      console.log(`[FileUpload] Updated draft ${draft.id} with GCS path: ${gcsPath}`);
    } else {
      console.log(`[FileUpload] Using existing GCS path: ${gcsPath}`);
    }

    // Step 2: Export the Google Doc using drive.files.export with Docx mimeType
    const mimeTypes = {
      'pdf': 'application/pdf',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    };

    const mimeType = mimeTypes[exportFormat.toLowerCase()] || mimeTypes.docx;

    console.log(`[FileUpload] Exporting Google Doc ${googleFileId} as ${mimeType}`);

    let exportResponse;
    try {
      exportResponse = await drive.files.export(
        {
          fileId: googleFileId,
          mimeType: mimeType
        },
        {
          responseType: 'stream'
        }
      );
    } catch (exportError) {
      if (exportError.code === 404 || exportError.message?.includes('not found')) {
        throw new Error(`File not found in Google Drive. The file may have been deleted or you may not have access to it. Original error: ${exportError.message}`);
      }
      throw exportError;
    }

    const exportStream = exportResponse.data;

    // Step 3: Use bucket.file(gcs_path).save() to overwrite the file in GCS
    console.log(`[FileUpload] Overwriting file in GCS: ${gcsPath}`);

    const bucket = storageClient.bucket(BUCKET_NAME);
    const gcsFile = bucket.file(gcsPath);

    // Delete existing file if it exists (to ensure clean overwrite)
    try {
      const [exists] = await gcsFile.exists();
      if (exists) {
        console.log(`[FileUpload] Deleting existing file at ${gcsPath} before overwrite`);
        await gcsFile.delete();
      }
    } catch (deleteError) {
      // If file doesn't exist, that's fine - we'll create it
      console.log(`[FileUpload] File doesn't exist yet, will create new one`);
    }

    // Convert stream to buffer for saving
    const chunks = [];
    for await (const chunk of exportStream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // Save the exported content to GCS (overwrite)
    await gcsFile.save(buffer, {
      metadata: {
        contentType: mimeType,
        metadata: {
          draftId: draft.id.toString(),
          userId: draft.user_id.toString(),
          title: draft.title,
          googleFileId: googleFileId,
          exportedAt: new Date().toISOString(),
          syncedAt: new Date().toISOString()
        }
      },
      resumable: false
    });

    console.log(`[FileUpload] ✅ File overwritten in GCS: ${gcsPath}`);

    // Step 4: Update last_synced_at in the DB
    const updatedDraft = await Draft.update(draft.id, {
      last_synced_at: new Date()
    });

    console.log(`[FileUpload] ✅ Google file ${googleFileId} synced successfully to ${gcsPath}`);

    return {
      success: true,
      draftId: draft.id,
      google_file_id: googleFileId,
      gcsPath: gcsPath,
      exportFormat: exportFormat,
      syncedAt: updatedDraft.last_synced_at
    };
  } catch (error) {
    console.error(`[FileUpload] Error syncing Google Doc to GCS:`, error);

    // Handle specific errors
    if (error.message?.includes('invalid_grant') || error.message?.includes('invalid_rapt')) {
      throw new Error('Service Account authentication failed. Please check GCS_KEY_BASE64 configuration.');
    }

    if (error.message?.includes('not found')) {
      throw new Error(`Draft not found: ${error.message}`);
    }

    throw new Error(`Failed to sync Google Doc to GCS: ${error.message}`);
  }
};

/**
 * Restore file from GCS to Google Drive using USER OAuth credentials
 * Downloads file from GCS, uploads to Google Drive (owned by user), updates database, and sets up webhook
 * 
 * @param {number} draftId - Draft ID
 * @param {string} gcsPath - GCS path of the file
 * @param {string} title - Document title
 * @param {number} userId - User ID
 * @param {google.auth.OAuth2Client} userOAuthClient - User's OAuth2 client (NOT service account)
 * @returns {Promise<Object>} Restored file info with google_file_id and webViewLink
 */
const restoreFileFromGCSToDrive = async (draftId, gcsPath, title, userId, userOAuthClient) => {
  try {
    // Use Service Account ONLY for GCS operations
    const { storage: storageClient } = initializeServiceAccount();

    // Use USER OAuth client for Google Drive operations (user will own the file)
    const { google } = require('googleapis');
    const drive = google.drive({ version: 'v3', auth: userOAuthClient });

    console.log(`[FileUpload] Restoring file from GCS: ${gcsPath} for draft ${draftId}`);

    // Step 1: Download file from GCS
    const bucket = storageClient.bucket(BUCKET_NAME);
    const gcsFile = bucket.file(gcsPath);

    const [exists] = await gcsFile.exists();
    if (!exists) {
      throw new Error(`File not found in GCS: ${gcsPath}`);
    }

    console.log(`[FileUpload] Downloading file from GCS: ${gcsPath}`);
    const [fileBuffer] = await gcsFile.download();
    console.log(`[FileUpload] ✅ Downloaded ${fileBuffer.length} bytes from GCS`);

    // Step 2: Determine file metadata
    const [fileMetadata] = await gcsFile.getMetadata();
    const contentType = fileMetadata.contentType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const fileName = title || gcsPath.split('/').pop() || 'restored-document.docx';

    // Step 3: Upload to Google Drive (convert to Google Doc if .docx)
    let googleFileId;
    let webViewLink;

    const fileStream = Readable.from(fileBuffer);

    if (contentType.includes('wordprocessingml') || fileName.endsWith('.docx')) {
      // Upload as Google Doc (Drive will auto-convert)
      console.log(`[FileUpload] Uploading to Google Drive as Google Doc`);

      const driveFile = await drive.files.create({
        requestBody: {
          name: fileName.replace(/\.docx?$/i, ''),
          mimeType: 'application/vnd.google-apps.document' // Target: Google Doc
        },
        media: {
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // Source: .docx
          body: fileStream
        },
        fields: 'id, name, webViewLink, webContentLink'
      });

      googleFileId = driveFile.data.id;
      webViewLink = driveFile.data.webViewLink;
      console.log(`[FileUpload] ✅ File uploaded to Drive as Google Doc: ${googleFileId}`);
    } else if (contentType.includes('pdf')) {
      // For PDFs, we can import as Google Doc too
      console.log(`[FileUpload] Uploading PDF to Google Drive as Google Doc`);

      const driveFile = await drive.files.create({
        requestBody: {
          name: fileName.replace(/\.pdf$/i, ''),
          mimeType: 'application/vnd.google-apps.document' // Target: Google Doc
        },
        media: {
          mimeType: 'application/pdf', // Source: PDF
          body: fileStream
        },
        fields: 'id, name, webViewLink, webContentLink'
      });

      googleFileId = driveFile.data.id;
      webViewLink = driveFile.data.webViewLink;
      console.log(`[FileUpload] ✅ PDF uploaded to Drive as Google Doc: ${googleFileId}`);
    } else {
      // Upload as original file type (may not be editable in Google Docs)
      console.log(`[FileUpload] Uploading to Google Drive as ${contentType}`);

      const driveFile = await drive.files.create({
        requestBody: {
          name: fileName,
          mimeType: contentType
        },
        media: {
          mimeType: contentType,
          body: fileStream
        },
        fields: 'id, name, webViewLink, webContentLink'
      });

      googleFileId = driveFile.data.id;
      webViewLink = driveFile.data.webViewLink;
      console.log(`[FileUpload] ✅ File uploaded to Drive: ${googleFileId}`);
    }

    // Step 4: Update database with new google_file_id and set is_shared = true (BLOCKING)
    // NOTE: Service account is NOT added to user files - we use User OAuth for all operations
    // File is owned by user, so no need to share with user again
    // CRITICAL: This must complete before returning to ensure DB has new file ID
    console.log(`[FileUpload] 📝 Updating database with new google_file_id: ${googleFileId}`);
    const updatedDraft = await Draft.update(draftId, {
      google_file_id: googleFileId,
      drive_item_id: googleFileId,
      last_synced_at: new Date(),
      is_shared: true // User owns the file, so no need to share again
    });

    if (!updatedDraft) {
      throw new Error(`Failed to update draft ${draftId} in database`);
    }

    // Verify the update was successful
    if (updatedDraft.google_file_id !== googleFileId) {
      throw new Error(`Database update verification failed: Expected google_file_id ${googleFileId}, got ${updatedDraft.google_file_id}`);
    }

    console.log(`[FileUpload] ✅ Database updated and verified: google_file_id = ${googleFileId}`);

    // Step 6: Set up webhook watcher for automatic sync
    try {
      const { setupDriveWatcher } = require('./driveWebhookService');
      const { getWebhookUrl, validateWebhookUrl } = require('../utils/webhookUrl');

      const validation = validateWebhookUrl();
      if (validation.isValid) {
        const webhookUrl = getWebhookUrl();
        console.log(`[FileUpload] Setting up webhook watcher for restored file`);
        // Use User OAuth for webhook setup (file is user-owned, service account can't access it)
        await setupDriveWatcher(googleFileId, draftId, webhookUrl, userOAuthClient);
        console.log(`[FileUpload] ✅ Webhook watcher set up for restored file`);
      } else {
        console.warn(`[FileUpload] ⚠️  Webhook URL validation failed: ${validation.message}`);
      }
    } catch (watcherError) {
      console.warn(`[FileUpload] ⚠️  Failed to setup webhook watcher (non-critical):`, watcherError.message);
    }

    return {
      google_file_id: googleFileId,
      webViewLink: webViewLink,
      title: fileName,
      gcsPath: gcsPath
    };
  } catch (error) {
    console.error(`[FileUpload] Error restoring file from GCS to Drive:`, error);

    // Handle Drive quota errors specifically
    if (error.code === 403 && error.errors && error.errors.some(e => e.reason === 'storageQuotaExceeded')) {
      const quotaError = new Error("Google Drive storage quota exceeded. Please free up space in your Google Drive account.");
      quotaError.code = 507; // Insufficient Storage status code
      quotaError.quotaExceeded = true;
      throw quotaError;
    }

    throw error;
  }
};

/**
 * Upload file from local to GCS and Google Drive using USER OAuth
 * Downloads file from GCS, uploads to Google Drive (owned by user), saves to database
 * 
 * @param {Buffer} fileBuffer - File buffer from upload
 * @param {number} userId - User ID
 * @param {string} filename - Original filename
 * @param {string} mimetype - File MIME type
 * @param {string} title - Document title (optional, defaults to filename without extension)
 * @param {google.auth.OAuth2Client} userOAuthClient - User's OAuth2 client (NOT service account)
 * @returns {Promise<Object>} Created draft with all IDs and paths
 */
const uploadToUserDriveAsGoogleDoc = async (fileBuffer, userId, filename, mimetype, title = null, userOAuthClient) => {
  let gcsPath = null; // Declare outside try block for cleanup

  try {
    // Use Service Account ONLY for GCS operations
    const { storage: storageClient } = initializeServiceAccount();

    // Use USER OAuth client for Google Drive operations (user will own the file)
    const { google } = require('googleapis');
    const drive = google.drive({ version: 'v3', auth: userOAuthClient });

    console.log(`[FileUpload] 📤 Starting upload for user ${userId}: ${filename} (${fileBuffer.length} bytes)`);

    // Determine title (use provided title or derive from filename)
    const baseName = title || filename.replace(/\.[^/.]+$/, '');
    const timestamp = Date.now();
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');

    // Step 1: Upload to GCS at path uploads/{userId}/{timestamp}_{title}.docx
    const fileExtension = filename.match(/\.[^/.]+$/) ? filename.match(/\.[^/.]+$/)[0] : '.docx';
    gcsPath = `uploads/${userId}/${timestamp}_${baseName.replace(/[^a-zA-Z0-9._-]/g, '_')}${fileExtension}`;

    console.log(`[FileUpload] 📦 Step 1: Uploading to GCS: ${gcsPath}`);

    const bucket = storageClient.bucket(BUCKET_NAME);
    const gcsFile = bucket.file(gcsPath);

    await gcsFile.save(fileBuffer, {
      metadata: {
        contentType: mimetype,
        metadata: {
          userId: userId.toString(),
          originalFilename: filename,
          title: baseName,
          uploadedAt: new Date().toISOString()
        }
      },
      resumable: false
    });

    console.log(`[FileUpload] ✅ File saved to GCS: ${gcsPath}`);

    // Step 2: Prepare file stream for Drive upload
    console.log(`[FileUpload] 🔄 Step 2: Preparing file for Drive upload`);
    const fileStream = Readable.from(fileBuffer);

    // Step 3: Upload to Google Drive using USER OAuth (convert to Google Doc)
    console.log(`[FileUpload] ☁️  Step 3: Uploading to Google Drive using USER OAuth`);
    console.log(`[FileUpload]    Converting to Google Docs format`);

    // Supported formats that can be converted to Google Docs
    const supportedFormats = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/msword', // .doc
      'text/plain', // .txt
      'application/pdf', // .pdf
      'application/rtf', // .rtf
      'text/html' // .html
    ];

    let googleFileId;
    let webViewLink;

    // Determine source MIME type for conversion
    let sourceMimeType = mimetype;
    if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      sourceMimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    } else if (mimetype === 'application/pdf') {
      sourceMimeType = 'application/pdf';
    } else if (mimetype === 'application/msword') {
      sourceMimeType = 'application/msword';
    } else if (mimetype === 'text/plain') {
      sourceMimeType = 'text/plain';
    } else if (mimetype === 'text/html') {
      sourceMimeType = 'text/html';
    } else if (mimetype === 'application/rtf') {
      sourceMimeType = 'application/rtf';
    }

    // Upload and convert to Google Docs
    if (supportedFormats.includes(mimetype)) {
      try {
        const driveFile = await drive.files.create({
          requestBody: {
            name: baseName,
            mimeType: 'application/vnd.google-apps.document' // Target: Google Doc
          },
          media: {
            mimeType: sourceMimeType, // Source format
            body: fileStream
          },
          fields: 'id, name, mimeType, webViewLink'
        });

        googleFileId = driveFile.data.id;
        webViewLink = driveFile.data.webViewLink;
        console.log(`[FileUpload] ✅ File uploaded to Drive as Google Doc: ${googleFileId}`);
        console.log(`[FileUpload]    File is owned by user (not service account)`);

        // Step 3b: Set permissions so the iframe doesn't show "You need access"
        // This makes the file "Anyone with the link can edit"
        try {
          console.log(`[FileUpload] 🔑 Setting permissions for iframe access...`);
          await drive.permissions.create({
            fileId: googleFileId,
            requestBody: {
              role: 'writer',
              type: 'anyone'
            }
          });
          console.log(`[FileUpload] ✅ Permissions updated to 'anyone with link can edit'`);
        } catch (permError) {
          console.warn(`[FileUpload] ⚠️ Failed to set permissions (might work anyway if user is owner):`, permError.message);
        }
      } catch (driveError) {
        console.error(`[FileUpload] ❌ Drive upload failed:`, driveError.message);

        // Handle Drive quota errors specifically
        if (driveError.code === 403 && driveError.errors && driveError.errors.some(e => e.reason === 'storageQuotaExceeded')) {
          const quotaError = new Error("Google Drive storage quota exceeded. Please free up space in your Google Drive account.");
          quotaError.code = 507; // Insufficient Storage status code
          quotaError.quotaExceeded = true;
          throw quotaError;
        }

        throw driveError;
      }
    } else {
      // Upload as-is (may not be editable in Google Docs)
      console.warn(`[FileUpload] ⚠️  File format ${mimetype} may not be editable in Google Docs`);

      const driveFile = await drive.files.create({
        requestBody: {
          name: baseName,
          mimeType: mimetype
        },
        media: {
          mimeType: mimetype,
          body: fileStream
        },
        fields: 'id, name, mimeType, webViewLink'
      });

      googleFileId = driveFile.data.id;
      webViewLink = driveFile.data.webViewLink;
      console.log(`[FileUpload] ✅ File uploaded to Drive: ${googleFileId}`);
    }

    // Step 4: Save draft record in database (BLOCKING)
    // NOTE: Service account is NOT added to user files - we use User OAuth for all operations
    console.log(`[FileUpload] 💾 Step 4: Saving draft to database`);

    const draft = await Draft.create({
      user_id: userId,
      title: baseName,
      google_file_id: googleFileId,
      drive_item_id: googleFileId,
      gcs_path: gcsPath,
      status: 'active',
      editor_type: 'google',
      last_synced_at: new Date(),
      is_shared: true // User owns the file, so no need to share again
    });

    console.log(`[FileUpload] ✅ Draft saved to database: ${draft.id}`);
    console.log(`[FileUpload]    google_file_id: ${googleFileId}`);
    console.log(`[FileUpload]    gcs_path: ${gcsPath}`);

    // Step 6: Set up webhook watcher for automatic sync (non-critical)
    try {
      const { setupDriveWatcher } = require('./driveWebhookService');
      const { getWebhookUrl, validateWebhookUrl } = require('../utils/webhookUrl');

      const validation = validateWebhookUrl();
      if (validation.isValid) {
        const webhookUrl = getWebhookUrl();
        console.log(`[FileUpload] 🔔 Step 5: Setting up webhook watcher for automatic sync`);
        // Use User OAuth for webhook setup (file is user-owned, service account can't access it)
        await setupDriveWatcher(googleFileId, draft.id, webhookUrl, userOAuthClient);
        console.log(`[FileUpload] ✅ Webhook watcher set up for automatic sync`);
      } else {
        console.warn(`[FileUpload] ⚠️  Webhook URL validation failed: ${validation.message}`);
      }
    } catch (watcherError) {
      console.warn(`[FileUpload] ⚠️  Failed to setup webhook watcher (non-critical):`, watcherError.message);
    }

    return {
      success: true,
      draft: {
        id: draft.id,
        user_id: draft.user_id,
        title: draft.title,
        google_file_id: draft.google_file_id,
        gcs_path: draft.gcs_path,
        last_synced_at: draft.last_synced_at,
        status: draft.status,
        editor_type: draft.editor_type
      },
      google_file_id: googleFileId,
      iframeUrl: `https://docs.google.com/document/d/${googleFileId}/edit?embedded=true`
    };
  } catch (error) {
    console.error(`[FileUpload] ❌ Error uploading file to user Drive:`, error);

    // Only clean up GCS file if it's not a Drive quota error
    // If Drive quota is exceeded, the file is still useful in GCS
    const isQuotaError = error.code === 507 || error.quotaExceeded ||
      (error.code === 403 && error.errors && error.errors.some(e => e.reason === 'storageQuotaExceeded'));

    if (gcsPath && !isQuotaError) {
      try {
        const { storage: storageClient } = initializeServiceAccount();
        const bucket = storageClient.bucket(BUCKET_NAME);
        const gcsFile = bucket.file(gcsPath);
        await gcsFile.delete();
        console.log(`[FileUpload] 🧹 Cleaned up GCS file: ${gcsPath}`);
      } catch (cleanupError) {
        console.warn(`[FileUpload] ⚠️  Failed to clean up GCS file:`, cleanupError.message);
      }
    } else if (isQuotaError && gcsPath) {
      console.log(`[FileUpload] 📦 Keeping GCS file ${gcsPath} despite Drive quota error - file is still accessible in GCS`);
    }

    // Handle Drive quota errors specifically
    if (error.code === 507 || error.quotaExceeded ||
      (error.code === 403 && error.errors && error.errors.some(e => e.reason === 'storageQuotaExceeded'))) {
      const quotaError = new Error("Google Drive storage quota exceeded. Please free up space in your Google Drive account.");
      quotaError.code = 507;
      quotaError.quotaExceeded = true;
      throw quotaError;
    }

    throw error;
  }
};

// Legacy function name for backward compatibility
const uploadFileToGCSAndDrive = handleInitialUpload;

module.exports = {
  handleInitialUpload,
  syncGoogleDocToGCS,
  uploadFileToGCSAndDrive, // Backward compatibility
  restoreFileFromGCSToDrive,
  uploadToUserDriveAsGoogleDoc,
  initializeServiceAccount // Export for use in other modules
};
