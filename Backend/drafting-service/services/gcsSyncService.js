const { google } = require('googleapis');
const { Storage } = require('@google-cloud/storage');
const { pipeline } = require('stream/promises');
const Draft = require('../models/Draft');

/**
 * GCS Sync Service
 * Handles exporting Google Docs to GCS (PDF/DOCX)
 * Uses Service Account authentication from GCS_KEY_BASE64
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
    console.error('[GCSSync] ❌ Failed to initialize Service Account:', error.message);
    throw new Error(`Failed to initialize Service Account: ${error.message}`);
  }
}

// Initialize on module load
initializeServiceAccount();

const BUCKET_NAME = process.env.GCS_BUCKET || process.env.GCS_BUCKET_NAME || 'draft_templates';

/**
 * Sync Google Drive document to GCS by exporting from Google Drive
 * Uses existing gcs_path and overwrites the file
 * @param {string} google_file_id - Google Drive file ID
 * @param {string} exportFormat - Export format: 'pdf' or 'docx' (default: 'docx')
 * @returns {Promise<Object>} Sync result with GCS path
 */
const syncDriveToGCS = async (google_file_id, exportFormat = 'docx') => {
  try {
    console.log(`[GCSSync] Starting sync for Google file ${google_file_id} as ${exportFormat}`);

    // Look up the draft by google_file_id to get gcs_path and user_id
    const draft = await Draft.findByGoogleFileId(google_file_id);
    
    if (!draft) {
      throw new Error(`Draft with google_file_id ${google_file_id} not found`);
    }

    if (!draft.gcs_path) {
      throw new Error(`Draft ${draft.id} does not have a GCS path. Please upload the file first.`);
    }

    // Get Service Account clients
    const { storage: storageClient, driveClient: drive } = initializeServiceAccount();

    // Determine MIME type for export
    const mimeTypes = {
      'pdf': 'application/pdf',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    };

    const mimeType = mimeTypes[exportFormat.toLowerCase()] || mimeTypes.docx;
    const fileExtension = exportFormat.toLowerCase() === 'docx' ? '.docx' : '.pdf';

    console.log(`[GCSSync] Exporting Google Doc ${google_file_id} as ${mimeType}`);
    console.log(`[GCSSync] Using existing GCS path: ${draft.gcs_path}`);

    // Step 1: Export file from Google Drive
    let exportStream;
    try {
      const exportResponse = await drive.files.export(
        {
          fileId: google_file_id,
          mimeType: mimeType
        },
        {
          responseType: 'stream'
        }
      );

      exportStream = exportResponse.data;
    } catch (exportError) {
      console.error(`[GCSSync] Export error:`, exportError);
      
      // Handle quota limits
      if (exportError.code === 429 || exportError.message?.includes('quota') || exportError.message?.includes('rate limit')) {
        throw new Error('Google API quota exceeded. Please try again later.');
      }

      // Handle permission errors
      if (exportError.code === 403) {
        throw new Error('Permission denied. Cannot export this document.');
      }

      throw new Error(`Failed to export document: ${exportError.message}`);
    }

    // Step 2: Use existing GCS path (overwrite existing file)
    const gcsPath = draft.gcs_path;
    
    // Ensure the file extension matches the export format
    // If the existing path has a different extension, we'll keep the path but update the content
    const bucket = storageClient.bucket(BUCKET_NAME);
    const gcsFile = bucket.file(gcsPath);

    // Step 3: Delete existing file if it exists (to ensure clean overwrite)
    try {
      const [exists] = await gcsFile.exists();
      if (exists) {
        console.log(`[GCSSync] Deleting existing file at ${gcsPath} before overwrite`);
        await gcsFile.delete();
      }
    } catch (deleteError) {
      // If file doesn't exist, that's fine - we'll create it
      console.log(`[GCSSync] File doesn't exist yet, will create new one`);
    }

    // Step 4: Create write stream to GCS (overwrite)
    const gcsWriteStream = gcsFile.createWriteStream({
      metadata: {
        contentType: mimeType,
        metadata: {
          draftId: draft.id.toString(),
          userId: draft.user_id.toString(),
          title: draft.title,
          googleFileId: google_file_id,
          exportedAt: new Date().toISOString(),
          syncedAt: new Date().toISOString()
        }
      },
      resumable: false // For smaller files, non-resumable is faster
    });

    // Step 5: Use stream.pipeline for efficient memory management
    try {
      await pipeline(exportStream, gcsWriteStream);
      console.log(`[GCSSync] ✅ File uploaded to GCS (overwritten): ${gcsPath}`);
    } catch (pipelineError) {
      console.error(`[GCSSync] Pipeline error:`, pipelineError);
      
      // Clean up partial upload if possible
      try {
        await gcsFile.delete();
      } catch (deleteError) {
        console.warn(`[GCSSync] Failed to clean up partial upload:`, deleteError);
      }
      
      // Check for authentication errors (invalid_rapt, invalid_grant)
      const errorMessage = pipelineError.message || '';
      const errorResponse = pipelineError.response?.data || {};
      
      if (
        errorMessage.includes('invalid_rapt') ||
        errorMessage.includes('invalid_grant') ||
        errorResponse.error === 'invalid_grant' ||
        errorResponse.error_subtype === 'invalid_rapt'
      ) {
        const authError = new Error('Google identity verification required. Please re-authenticate your account.');
        authError.code = 'REAUTH_REQUIRED';
        authError.originalError = pipelineError;
        throw authError;
      }
      
      throw new Error(`Failed to upload to GCS: ${pipelineError.message}`);
    }

    // Step 6: Generate signed URL for access (valid for 1 year)
    const [signedUrl] = await gcsFile.getSignedUrl({
      action: 'read',
      expires: Date.now() + 365 * 24 * 60 * 60 * 1000 // 1 year
    });

    // Step 7: Update draft record with last_synced_at timestamp
    const updatedDraft = await Draft.update(draft.id, {
      last_synced_at: new Date()
    });

    console.log(`[GCSSync] ✅ Google file ${google_file_id} synced successfully to ${gcsPath}`);

    return {
      success: true,
      draftId: draft.id,
      google_file_id: google_file_id,
      gcsPath: gcsPath,
      signedUrl: signedUrl,
      exportFormat: exportFormat,
      syncedAt: updatedDraft.last_synced_at
    };
  } catch (error) {
    console.error(`[GCSSync] Error syncing Google file ${google_file_id}:`, error);
    
    // Handle Service Account authentication errors
    const errorMessage = error.message || '';
    const errorResponse = error.response?.data || {};
    
    if (
      errorMessage.includes('invalid_rapt') ||
      errorMessage.includes('invalid_grant') ||
      errorResponse.error === 'invalid_grant' ||
      errorResponse.error_subtype === 'invalid_rapt'
    ) {
      throw new Error('Service Account authentication failed. Please check GCS_KEY_BASE64 configuration.');
    }
    
    // Handle specific error cases
    if (error.message?.includes('GCS_KEY_BASE64') || error.message?.includes('Service Account')) {
      throw new Error('Service Account configuration error. Please check GCS_KEY_BASE64 environment variable.');
    }

    if (error.message?.includes('quota') || error.code === 429) {
      throw new Error('Google API quota exceeded. Please try again later.');
    }

    throw error;
  }
};

/**
 * Sync draft to GCS by exporting from Google Drive (legacy function - uses draftId)
 * @param {number} draftId - Draft ID
 * @param {string} exportFormat - Export format: 'pdf' or 'docx' (default: 'pdf')
 * @returns {Promise<Object>} Sync result with GCS path
 */
const syncDraftToGCS = async (draftId, exportFormat = 'pdf') => {
  try {
    const draft = await Draft.findById(draftId);
    
    if (!draft) {
      throw new Error(`Draft ${draftId} not found`);
    }

    if (!draft.google_file_id) {
      throw new Error(`Draft ${draftId} does not have a Google file ID`);
    }

    // Use the new syncDriveToGCS function
    return await syncDriveToGCS(draft.google_file_id, exportFormat);
  } catch (error) {
    console.error(`[GCSSync] Error syncing draft ${draftId}:`, error);
    throw error;
  }
};

/**
 * Get signed URL for GCS file
 * @param {number} draftId - Draft ID
 * @param {number} expiresInHours - URL expiration in hours (default: 24)
 * @returns {Promise<string>} Signed URL
 */
const getGCSSignedUrl = async (draftId, expiresInHours = 24) => {
  try {
    const draft = await Draft.findById(draftId);
    
    if (!draft) {
      throw new Error(`Draft ${draftId} not found`);
    }

    if (!draft.gcs_path) {
      throw new Error(`Draft ${draftId} has not been synced to GCS yet`);
    }

    const { storage: storageClient } = initializeServiceAccount();
    const bucket = storageClient.bucket(BUCKET_NAME);
    const file = bucket.file(draft.gcs_path);

    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + expiresInHours * 60 * 60 * 1000
    });

    return signedUrl;
  } catch (error) {
    console.error(`[GCSSync] Error getting signed URL:`, error);
    throw error;
  }
};

/**
 * Check if draft needs syncing (based on last_synced_at)
 * @param {number} draftId - Draft ID
 * @param {number} maxAgeHours - Maximum age in hours before requiring sync (default: 24)
 * @returns {Promise<boolean>} True if sync is needed
 */
const needsSync = async (draftId, maxAgeHours = 24) => {
  try {
    const draft = await Draft.findById(draftId);
    
    if (!draft) {
      return false;
    }

    if (!draft.gcs_path) {
      return true; // Never synced
    }

    if (!draft.last_synced_at) {
      return true; // No sync timestamp
    }

    const lastSync = new Date(draft.last_synced_at);
    const maxAge = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);

    return lastSync < maxAge;
  } catch (error) {
    console.error(`[GCSSync] Error checking sync status:`, error);
    return false;
  }
};

module.exports = {
  syncDriveToGCS,
  syncDraftToGCS, // Legacy function for backward compatibility
  getGCSSignedUrl,
  needsSync
};

