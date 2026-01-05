const { google } = require('googleapis');

// MIME type mappings for Google Docs export
const GOOGLE_DOCS_EXPORT_MIMES = {
  'application/vnd.google-apps.document': {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extension: '.docx'
  },
  'application/vnd.google-apps.spreadsheet': {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: '.xlsx'
  },
  'application/vnd.google-apps.presentation': {
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    extension: '.pptx'
  },
  'application/vnd.google-apps.drawing': {
    mimeType: 'application/pdf',
    extension: '.pdf'
  }
};

/**
 * Get Google Drive client using access token directly
 * @param {string} accessToken - Google OAuth access token from frontend
 * @returns {Object} - { drive, oauth2Client }
 */
const getDriveClientWithToken = (accessToken) => {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  
  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  return { drive, oauth2Client };
};

/**
 * Get file metadata from Google Drive
 * @param {string} accessToken - Google OAuth access token
 * @param {string} fileId - Google Drive file ID
 * @returns {Promise<Object>} - File metadata
 */
const getFileMetadata = async (accessToken, fileId) => {
  const { drive } = getDriveClientWithToken(accessToken);

  try {
    console.log(`[GoogleDrive] Getting metadata for file: ${fileId}`);
    const response = await drive.files.get({
      fileId,
      fields: 'id, name, mimeType, size, createdTime, modifiedTime',
      supportsAllDrives: true  // Support shared drives
    });
    return response.data;
  } catch (error) {
    console.error(`[GoogleDrive] Metadata error for ${fileId}:`, error.message);
    console.error(`[GoogleDrive] Error code:`, error.code);
    console.error(`[GoogleDrive] Error response:`, JSON.stringify(error.response?.data || {}, null, 2));
    throw error;
  }
};

/**
 * Download file content from Google Drive
 * For native Google Docs (Docs, Sheets, Slides), exports to appropriate format
 * For other files, downloads using alt=media
 * 
 * @param {string} accessToken - Google OAuth access token
 * @param {string} fileId - Google Drive file ID
 * @returns {Promise<Object>} - { buffer, filename, mimeType, originalMimeType, metadata }
 */
const downloadFile = async (accessToken, fileId) => {
  const { drive } = getDriveClientWithToken(accessToken);

  console.log(`[GoogleDrive] Starting download for fileId: ${fileId}`);
  console.log(`[GoogleDrive] Access token present: ${!!accessToken}, length: ${accessToken?.length || 0}`);

  // Get file metadata first
  let metadata;
  try {
    metadata = await getFileMetadata(accessToken, fileId);
  } catch (metadataError) {
    console.error(`[GoogleDrive] Failed to get metadata for ${fileId}:`, metadataError.message);
    console.error(`[GoogleDrive] Error details:`, metadataError.response?.data || metadataError);
    throw new Error(`Failed to access file: ${metadataError.message}`);
  }
  console.log(`[GoogleDrive] File metadata:`, {
    id: metadata.id,
    name: metadata.name,
    mimeType: metadata.mimeType,
    size: metadata.size
  });

  let buffer;
  let filename = metadata.name;
  let mimeType = metadata.mimeType;

  // Check if it's a Google Docs native format that needs export
  if (GOOGLE_DOCS_EXPORT_MIMES[metadata.mimeType]) {
    const exportConfig = GOOGLE_DOCS_EXPORT_MIMES[metadata.mimeType];
    console.log(`[GoogleDrive] Exporting Google Docs file as ${exportConfig.mimeType}`);

    const response = await drive.files.export({
      fileId,
      mimeType: exportConfig.mimeType
    }, {
      responseType: 'arraybuffer'
    });

    buffer = Buffer.from(response.data);
    mimeType = exportConfig.mimeType;
    
    // Add extension if not present
    if (!filename.endsWith(exportConfig.extension)) {
      filename = filename + exportConfig.extension;
    }
  } else {
    // Download regular file using alt=media
    console.log(`[GoogleDrive] Downloading binary file`);

    const response = await drive.files.get({
      fileId,
      alt: 'media',
      supportsAllDrives: true  // Support shared drives
    }, {
      responseType: 'arraybuffer'
    });

    buffer = Buffer.from(response.data);
  }

  console.log(`[GoogleDrive] Downloaded file: ${filename}, size: ${buffer.length} bytes`);

  return {
    buffer,
    filename,
    mimeType,
    originalMimeType: metadata.mimeType,
    metadata
  };
};

module.exports = {
  getDriveClientWithToken,
  getFileMetadata,
  downloadFile,
  GOOGLE_DOCS_EXPORT_MIMES
};
