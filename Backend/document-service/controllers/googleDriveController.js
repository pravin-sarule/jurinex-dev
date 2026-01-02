const { v4: uuidv4 } = require('uuid');
const path = require('path');
const pool = require('../config/db');
const { uploadToGCS, getSignedUrl } = require('../services/gcsService');
const { downloadFile } = require('../services/googleDriveService');
const File = require('../models/File');
const TokenUsageService = require('../services/tokenUsageService');
const { processDocumentWithAI } = require('./FileController');

/**
 * Sanitize filename for safe storage
 */
const sanitizeName = (name) => {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 200);
};

/**
 * Download file from Google Drive, upload to GCS, and process with Document AI
 * Same flow as FileController.uploadDocumentsToCaseByFolderName
 * 
 * POST /api/files/google-drive/download
 * Body: { fileId, folderName, accessToken }
 */
const downloadFromGoogleDrive = async (req, res) => {
  try {
    const userId = req.user.id;
    const username = req.user.username || req.user.email?.split('@')[0] || `user_${userId}`;
    const authorizationHeader = req.headers.authorization;
    const { fileId, folderName, accessToken } = req.body;

    if (!fileId) {
      return res.status(400).json({ error: 'Google Drive file ID is required' });
    }

    if (!accessToken) {
      return res.status(400).json({ error: 'Google Drive access token is required' });
    }

    console.log(`[GoogleDrive] Download request from user ${userId} for file ${fileId}`);

    // Step 1: Download file from Google Drive using the access token
    const { buffer, filename, mimeType, metadata } = await downloadFile(accessToken, fileId);
    const fileSizeBytes = buffer.length;

    console.log(`[GoogleDrive] Downloaded: ${filename}, size: ${fileSizeBytes} bytes, type: ${mimeType}`);

    // Step 2: Check file size and plan limits (same as FileController)
    const { usage: userUsage, plan: userPlan } = await TokenUsageService.getUserUsageAndPlan(userId, authorizationHeader);
    
    const fileSizeCheck = TokenUsageService.checkFreeTierFileSize(fileSizeBytes, userPlan);
    if (!fileSizeCheck.allowed) {
      console.log(`[GoogleDrive] File size limit exceeded for user ${userId}`);
      return res.status(403).json({
        error: fileSizeCheck.message,
        shortMessage: fileSizeCheck.shortMessage || fileSizeCheck.message,
        maxSizeMB: fileSizeCheck.maxSizeMB
      });
    }

    // Step 3: Find or create folder path (same as FileController)
    let folderPath = `${username}/documents`;
    let folderId = null;
    let folderRow = null;

    if (folderName) {
      const folderQuery = `
        SELECT * FROM user_files 
        WHERE user_id = $1 AND is_folder = true 
        AND originalname = $2
        ORDER BY created_at DESC
        LIMIT 1
      `;
      const { rows: folderRows } = await pool.query(folderQuery, [userId, folderName]);

      if (folderRows.length > 0) {
        folderRow = folderRows[0];
        folderPath = folderRow.folder_path;
        folderId = folderRow.id;
      } else {
        folderPath = `${username}/${folderName}`;
      }
    } else {
      // Get default documents folder
      const defaultFolderQuery = `
        SELECT * FROM user_files 
        WHERE user_id = $1 AND is_folder = true 
        ORDER BY created_at DESC
        LIMIT 1
      `;
      const { rows: defaultRows } = await pool.query(defaultFolderQuery, [userId]);
      if (defaultRows.length > 0) {
        folderRow = defaultRows[0];
        folderPath = folderRow.folder_path;
        folderId = folderRow.id;
      }
    }

    // Step 4: Check token limits (same as FileController)
    const { DOCUMENT_UPLOAD_COST_TOKENS } = require('../middleware/checkTokenLimits');
    const requestedResources = {
      tokens: DOCUMENT_UPLOAD_COST_TOKENS,
      documents: 1,
      ai_analysis: 1,
      storage_gb: fileSizeBytes / (1024 ** 3),
    };

    const limitCheck = await TokenUsageService.enforceLimits(
      userId,
      userUsage,
      userPlan,
      requestedResources
    );

    if (!limitCheck.allowed) {
      return res.status(403).json({
        success: false,
        message: limitCheck.message,
        nextRenewalTime: limitCheck.nextRenewalTime,
        remainingTime: limitCheck.remainingTime,
      });
    }

    // Step 5: Upload to GCS (same as FileController)
    const sanitizedFilename = sanitizeName(path.basename(filename, path.extname(filename))) + path.extname(filename);
    const gcsFolder = folderRow?.gcs_path || `${userId}/documents/${folderPath}/`;
    
    console.log(`[GoogleDrive] Uploading to GCS: ${gcsFolder}${sanitizedFilename}`);
    
    const { gsUri, gcsPath } = await uploadToGCS(
      sanitizedFilename,
      buffer,
      gcsFolder,
      false,
      mimeType
    );

    console.log(`[GoogleDrive] File uploaded to GCS: ${gcsPath}`);

    // Step 6: Generate signed URL for preview (same as FileController)
    const previewUrl = await getSignedUrl(gcsPath, 15 * 60); // 15 minutes in seconds

    // Step 7: Save file record to database (same as FileController)
    const savedFile = await File.create({
      user_id: userId,
      originalname: filename,
      mimetype: mimeType,
      size: fileSizeBytes,
      gcs_path: gcsPath,
      folder_path: folderPath,
      is_folder: false,
      status: 'queued',
      processing_progress: 0,
    });

    console.log(`[GoogleDrive] File record created: ${savedFile.id}`);

    // Step 8: Increment usage (same as FileController)
    try {
      await TokenUsageService.incrementUsage(userId, requestedResources, userPlan);
      console.log(`[GoogleDrive] Usage incremented successfully`);
    } catch (usageError) {
      console.error(`[GoogleDrive] Failed to increment usage (non-critical):`, usageError.message);
    }

    // Step 9: Start Document AI processing in background (same as FileController)
    processDocumentWithAI(
      savedFile.id,
      buffer,
      mimeType,
      userId,
      filename,
      req.body.secret_id
    ).catch(err => {
      console.error(`[GoogleDrive] Background processing failed for ${savedFile.id}:`, err.message);
    });

    // Step 10: Return success response (same format as FileController)
    res.status(201).json({
      success: true,
      message: 'File downloaded from Google Drive and processing started',
      document: {
        ...savedFile,
        previewUrl,
        status: 'queued',
      },
      folderInfo: folderRow ? {
        folderName: folderRow.originalname,
        folder_path: folderRow.folder_path,
        gcs_path: folderRow.gcs_path
      } : null
    });

  } catch (error) {
    console.error('[GoogleDrive] Download error:', error);
    
    if (error.message?.includes('invalid_grant') || error.message?.includes('Invalid Credentials')) {
      return res.status(401).json({
        error: 'Google Drive access token expired. Please try again.',
        needsAuth: true
      });
    }
    
    res.status(500).json({
      error: 'Failed to download file from Google Drive',
      details: error.message
    });
  }
};

/**
 * Download multiple files from Google Drive
 * POST /api/files/google-drive/download-multiple
 * Body: { files: [{id, name}], folderName, accessToken }
 */
const downloadMultipleFromGoogleDrive = async (req, res) => {
  try {
    const userId = req.user.id;
    const username = req.user.username || req.user.email?.split('@')[0] || `user_${userId}`;
    const authorizationHeader = req.headers.authorization;
    const { files, folderName, accessToken } = req.body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'At least one file is required' });
    }

    if (!accessToken) {
      return res.status(400).json({ error: 'Google Drive access token is required' });
    }

    console.log(`[GoogleDrive] Batch download request from user ${userId} for ${files.length} files`);

    // Get user plan info once
    const { usage: userUsage, plan: userPlan } = await TokenUsageService.getUserUsageAndPlan(userId, authorizationHeader);

    // Find or determine folder
    let folderPath = null;
    let folderId = null;
    let folderRow = null;
    let tempGcsPrefix = null;
    let isTempFolder = false;

    if (folderName) {
      // Check if this is a temp folder path (used in case creation workflow)
      if (folderName.startsWith('temp-case-')) {
        // Use existing temp folder path
        folderPath = folderName;
        tempGcsPrefix = `${userId}/temp-uploads/${folderName.replace('temp-case-', '')}/`;
        isTempFolder = true;
        console.log(`[GoogleDrive] Using existing temp folder: ${folderPath}`);
      } else {
        // Try to find existing folder
        const folderQuery = `
          SELECT * FROM user_files 
          WHERE user_id = $1 AND is_folder = true 
          AND originalname = $2
          ORDER BY created_at DESC
          LIMIT 1
        `;
        const { rows: folderRows } = await pool.query(folderQuery, [userId, folderName]);

        if (folderRows.length > 0) {
          folderRow = folderRows[0];
          folderPath = folderRow.folder_path;
          folderId = folderRow.id;
        } else {
          folderPath = `${username}/${folderName}`;
        }
      }
    } else {
      // No folder specified - create a new temp folder for case creation workflow
      const timestamp = Date.now();
      folderPath = `temp-case-${timestamp}`;
      tempGcsPrefix = `${userId}/temp-uploads/${timestamp}/`;
      isTempFolder = true;
      console.log(`[GoogleDrive] Creating new temp folder: ${folderPath}`);
    }

    const results = [];
    const { DOCUMENT_UPLOAD_COST_TOKENS } = require('../middleware/checkTokenLimits');

    for (const file of files) {
      const fileId = file.id || file.fileId;
      
      if (!fileId) {
        results.push({
          fileId: null,
          error: 'File ID is required',
          status: 'failed'
        });
        continue;
      }

      try {
        // Download from Google Drive
        const { buffer, filename, mimeType } = await downloadFile(accessToken, fileId);
        const fileSizeBytes = buffer.length;

        // Check file size
        const fileSizeCheck = TokenUsageService.checkFreeTierFileSize(fileSizeBytes, userPlan);
        if (!fileSizeCheck.allowed) {
          results.push({
            fileId,
            originalname: filename,
            error: fileSizeCheck.message,
            status: 'failed'
          });
          continue;
        }

        // Upload to GCS
        const sanitizedFilename = sanitizeName(path.basename(filename, path.extname(filename))) + path.extname(filename);
        // Use temp GCS prefix for temp folders, otherwise use folder's GCS path
        const gcsFolder = isTempFolder ? tempGcsPrefix : (folderRow?.gcs_path || `${userId}/documents/${folderPath}/`);
        
        const { gcsPath } = await uploadToGCS(
          sanitizedFilename,
          buffer,
          gcsFolder,
          false,
          mimeType
        );

        // Generate signed URL
        const previewUrl = await getSignedUrl(gcsPath, 15 * 60); // 15 minutes in seconds

        // Save file record
        const savedFile = await File.create({
          user_id: userId,
          originalname: filename,
          mimetype: mimeType,
          size: fileSizeBytes,
          gcs_path: gcsPath,
          folder_path: folderPath,
          is_folder: false,
          status: 'queued',
          processing_progress: 0,
        });

        // Increment usage
        const requestedResources = {
          tokens: DOCUMENT_UPLOAD_COST_TOKENS,
          documents: 1,
          ai_analysis: 1,
          storage_gb: fileSizeBytes / (1024 ** 3),
        };
        
        try {
          await TokenUsageService.incrementUsage(userId, requestedResources, userPlan);
        } catch (usageError) {
          console.error(`[GoogleDrive] Usage increment error (non-critical):`, usageError.message);
        }

        // Start Document AI processing in background
        processDocumentWithAI(
          savedFile.id,
          buffer,
          mimeType,
          userId,
          filename,
          req.body.secret_id
        ).catch(err => {
          console.error(`[GoogleDrive] Processing failed for ${savedFile.id}:`, err.message);
        });

        results.push({
          id: savedFile.id,
          fileId,
          originalname: filename,
          mimetype: mimeType,
          file_size: fileSizeBytes,
          previewUrl,
          status: 'queued'
        });

        console.log(`[GoogleDrive] Successfully processed: ${filename}`);
      } catch (fileError) {
        console.error(`[GoogleDrive] Error processing file ${fileId}:`, fileError.message);
        console.error(`[GoogleDrive] Full error stack:`, fileError.stack);
        results.push({
          fileId,
          error: fileError.message,
          status: 'failed'
        });
      }
    }

    const successful = results.filter(r => r.status === 'queued');
    const failed = results.filter(r => r.status === 'failed');

    res.status(200).json({
      success: successful.length > 0,
      message: `Downloaded ${successful.length}/${files.length} files from Google Drive`,
      folderName: folderPath, // Return folder path for subsequent operations
      documents: results,
      summary: {
        total: files.length,
        successful: successful.length,
        failed: failed.length
      }
    });
  } catch (error) {
    console.error('[GoogleDrive] Batch download error:', error);
    
    if (error.message?.includes('invalid_grant') || error.message?.includes('Invalid Credentials')) {
      return res.status(401).json({
        error: 'Google Drive access token expired. Please try again.',
        needsAuth: true
      });
    }
    
    res.status(500).json({
      error: 'Failed to download files from Google Drive',
      details: error.message
    });
  }
};

/**
 * Get Google Drive file info (for preview before download)
 * GET /api/files/google-drive/info/:fileId
 * Query: accessToken
 */
const getGoogleDriveFileInfo = async (req, res) => {
  try {
    const { fileId } = req.params;
    const { accessToken } = req.query;

    if (!fileId) {
      return res.status(400).json({ error: 'File ID is required' });
    }

    if (!accessToken) {
      return res.status(400).json({ error: 'Access token is required' });
    }

    const { getFileMetadata } = require('../services/googleDriveService');
    const metadata = await getFileMetadata(accessToken, fileId);

    res.json({
      id: metadata.id,
      name: metadata.name,
      mimeType: metadata.mimeType,
      size: metadata.size,
      createdTime: metadata.createdTime,
      modifiedTime: metadata.modifiedTime
    });
  } catch (error) {
    console.error('[GoogleDrive] Get file info error:', error);
    
    res.status(500).json({
      error: 'Failed to get file information',
      details: error.message
    });
  }
};

module.exports = {
  downloadFromGoogleDrive,
  downloadMultipleFromGoogleDrive,
  getGoogleDriveFileInfo
};
