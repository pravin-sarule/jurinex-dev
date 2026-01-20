const { google } = require('googleapis');

/**
 * Google Drive Service for document operations
 * Reuses Google Cloud credentials from environment (same as Document Service)
 */

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
      fields: 'id, name, mimeType, size, createdTime, modifiedTime, webViewLink, webContentLink',
      supportsAllDrives: true
    });
    return response.data;
  } catch (error) {
    console.error(`[GoogleDrive] Metadata error for ${fileId}:`, error.message);
    throw error;
  }
};

/**
 * Copy a file in Google Drive (used for creating drafts from templates)
 * @param {string} accessToken - Google OAuth access token
 * @param {string} templateFileId - Source file ID to copy
 * @param {Object} options - Copy options
 * @returns {Promise<Object>} - New file metadata
 */
const copyFile = async (accessToken, templateFileId, options = {}) => {
  const { drive } = getDriveClientWithToken(accessToken);
  const { name, folderId } = options;

  try {
    console.log(`[GoogleDrive] Copying file: ${templateFileId}`);
    
    const requestBody = {};
    
    if (name) {
      requestBody.name = name;
    }
    
    // If a destination folder is specified
    if (folderId) {
      requestBody.parents = [folderId];
    }

    const response = await drive.files.copy({
      fileId: templateFileId,
      requestBody,
      fields: 'id, name, mimeType, webViewLink, webContentLink, createdTime',
      supportsAllDrives: true
    });

    const newFileId = response.data.id;
    console.log(`[GoogleDrive] File copied successfully: ${newFileId}`);

    // Note: When copying a file, the user who made the copy becomes the owner automatically
    // Owner has full edit access, so the full Google Docs UI will appear
    // No need to explicitly grant permissions as the user is already the owner

    return response.data;
  } catch (error) {
    console.error(`[GoogleDrive] Copy error for ${templateFileId}:`, error.message);
    throw error;
  }
};

/**
 * List files in Google Drive (for browsing templates)
 * @param {string} accessToken - Google OAuth access token
 * @param {Object} options - List options
 * @returns {Promise<Array>} - Array of files
 */
const listFiles = async (accessToken, options = {}) => {
  const { drive } = getDriveClientWithToken(accessToken);
  const { 
    folderId,
    mimeType,
    pageSize = 100,
    query: customQuery
  } = options;

  try {
    let q = "trashed = false";
    
    if (folderId) {
      q += ` and '${folderId}' in parents`;
    }
    
    if (mimeType) {
      q += ` and mimeType = '${mimeType}'`;
    }
    
    if (customQuery) {
      q += ` and ${customQuery}`;
    }

    const response = await drive.files.list({
      q,
      pageSize,
      fields: 'files(id, name, mimeType, webViewLink, iconLink, thumbnailLink, createdTime, modifiedTime)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });

    return response.data.files;
  } catch (error) {
    console.error('[GoogleDrive] List files error:', error.message);
    throw error;
  }
};

/**
 * List Google Docs templates (Google Docs files only)
 * @param {string} accessToken - Google OAuth access token
 * @param {Object} options - List options
 * @returns {Promise<Array>} - Array of template files
 */
const listDocTemplates = async (accessToken, options = {}) => {
  return listFiles(accessToken, {
    ...options,
    mimeType: 'application/vnd.google-apps.document'
  });
};

/**
 * Share a file with a user
 * @param {string} accessToken - Google OAuth access token
 * @param {string} fileId - File ID to share
 * @param {string} email - Email of user to share with
 * @param {string} role - Permission role (reader, commenter, writer)
 * @param {boolean} sendNotificationEmail - Whether to send notification email (default: true)
 * @returns {Promise<Object>} - Permission data
 */
const shareFile = async (accessToken, fileId, email, role = 'writer', sendNotificationEmail = true) => {
  const { drive } = getDriveClientWithToken(accessToken);

  try {
    const response = await drive.permissions.create({
      fileId,
      requestBody: {
        type: 'user',
        role,
        emailAddress: email
      },
      sendNotificationEmail: sendNotificationEmail,
      supportsAllDrives: true
    });

    return response.data;
  } catch (error) {
    console.error(`[GoogleDrive] Share error for ${fileId}:`, error.message);
    throw error;
  }
};

/**
 * Make a file accessible to anyone with the link
 * @param {string} accessToken - Google OAuth access token
 * @param {string} fileId - File ID
 * @param {string} role - Permission role (reader, commenter, writer)
 * @returns {Promise<Object>} - Permission data
 */
const makePublic = async (accessToken, fileId, role = 'reader') => {
  const { drive } = getDriveClientWithToken(accessToken);

  try {
    const response = await drive.permissions.create({
      fileId,
      requestBody: {
        type: 'anyone',
        role
      },
      supportsAllDrives: true
    });

    return response.data;
  } catch (error) {
    console.error(`[GoogleDrive] Make public error for ${fileId}:`, error.message);
    throw error;
  }
};

/**
 * Get all permissions for a file
 * @param {string} accessToken - Google OAuth access token
 * @param {string} fileId - File ID
 * @returns {Promise<Array>} - Array of permissions
 */
const getPermissions = async (accessToken, fileId) => {
  const { drive } = getDriveClientWithToken(accessToken);

  try {
    const response = await drive.permissions.list({
      fileId,
      fields: 'permissions(id, type, role, emailAddress, displayName)',
      supportsAllDrives: true
    });

    return response.data.permissions || [];
  } catch (error) {
    console.error(`[GoogleDrive] Get permissions error for ${fileId}:`, error.message);
    throw error;
  }
};

/**
 * Delete a permission (remove access)
 * @param {string} accessToken - Google OAuth access token
 * @param {string} fileId - File ID
 * @param {string} permissionId - Permission ID to delete
 * @returns {Promise<void>}
 */
const deletePermission = async (accessToken, fileId, permissionId) => {
  const { drive } = getDriveClientWithToken(accessToken);

  try {
    await drive.permissions.delete({
      fileId,
      permissionId,
      supportsAllDrives: true
    });
  } catch (error) {
    console.error(`[GoogleDrive] Delete permission error for ${fileId}:`, error.message);
    throw error;
  }
};

module.exports = {
  getDriveClientWithToken,
  getFileMetadata,
  copyFile,
  listFiles,
  listDocTemplates,
  shareFile,
  makePublic,
  getPermissions,
  deletePermission
};

