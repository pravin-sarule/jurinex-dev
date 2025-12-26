require("dotenv").config();

const path = require("path");
const { v4: uuidv4 } = require("uuid");

const pool = require("../config/db");

const File = require("../models/File");
const FileChat = require("../models/FileChat");
const DocumentModel = require("../models/documentModel");

const {
  uploadToGCS,
  getSignedUrl: getSignedUrlFromGCS,
  getSignedUploadUrl,
} = require("../services/gcsService");
const { checkStorageLimit } = require("../utils/storage");
const { bucket } = require("../config/gcs");
const { extractText, detectDigitalNativePDF, extractTextFromPDFWithPages } = require("../utils/textExtractor");
const {
  extractTextFromDocument,
  batchProcessDocument,
  getOperationStatus,
  fetchBatchResults,
} = require("../services/documentAiService");
const { chunkDocument } = require("../services/chunkingService");
const { generateEmbedding, generateEmbeddings } = require("../services/embeddingService");
const { enqueueEmbeddingJob } = require("../queues/embeddingQueue");
const { fileInputBucket, fileOutputBucket } = require("../config/gcs");
const TokenUsageService = require("../services/tokenUsageService");
const documentController = require("./documentController");

function sanitizeName(name) {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .substring(0, 255);
}

async function ensureUniqueKey(key) {
  const fileRef = bucket.file(key);
  const [exists] = await fileRef.exists();
  if (!exists) return key;
  
  const ext = path.extname(key);
  const base = key.substring(0, key.length - ext.length);
  let counter = 1;
  let newKey;
  do {
    newKey = `${base}_${counter}${ext}`;
    const [fileExists] = await bucket.file(newKey).exists();
    if (!fileExists) return newKey;
    counter++;
  } while (counter < 1000);
  
  return `${base}_${Date.now()}${ext}`;
}

async function makeSignedReadUrl(gcsPath, expiryMinutes = 15) {
  const file = bucket.file(gcsPath);
  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + expiryMinutes * 60 * 1000,
  });
  return url;
}

exports.uploadDocuments = async (req, res) => {
  try {
    const userId = req.user.id;
    const authorizationHeader = req.headers.authorization;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded." });
    }

    console.log(`📤 [MindmapController] Uploading ${req.files.length} file(s) for user: ${userId}`);

    const { usage: userUsage, plan: userPlan } = await TokenUsageService.getUserUsageAndPlan(userId, authorizationHeader);

    const uploadedFiles = [];
    const errors = [];

    for (const file of req.files) {
      const { originalname, mimetype, buffer, size } = file;

      const fileSizeBytes = typeof size === 'string' ? parseInt(size, 10) : Number(size);

      if (isNaN(fileSizeBytes) || fileSizeBytes <= 0) {
        errors.push({
          filename: originalname,
          error: "Invalid file size"
        });
        continue;
      }

      const fileSizeCheck = TokenUsageService.checkFreeTierFileSize(fileSizeBytes, userPlan);
      if (!fileSizeCheck.allowed) {
        console.log(`[FREE TIER] File upload rejected: ${originalname} (${(fileSizeBytes / (1024 * 1024)).toFixed(2)} MB)`);
        errors.push({
          filename: originalname,
          error: fileSizeCheck.message,
          shortMessage: fileSizeCheck.shortMessage || fileSizeCheck.message,
          fileSizeMB: fileSizeCheck.fileSizeMB,
          maxSizeMB: fileSizeCheck.maxSizeMB,
          upgradeRequired: true,
          planType: 'free',
          limit: `${fileSizeCheck.maxSizeMB} MB`
        });
        continue;
      }

      const storageLimitCheck = await checkStorageLimit(userId, size, userPlan);
      if (!storageLimitCheck.allowed) {
        errors.push({
          filename: originalname,
          error: storageLimitCheck.message
        });
        continue;
      }

      try {
        const folderPath = `mindmap-uploads/${userId}`;
        const { gsUri, gcsPath } = await uploadToGCS(originalname, buffer, folderPath, true, mimetype);

        const fileId = await DocumentModel.saveFileMetadata(
          userId,
          originalname,
          gsUri,
          folderPath,
          mimetype,
          size,
          "uploaded"
        );

        console.log(`✅ [MindmapController] File uploaded: ${originalname} (ID: ${fileId})`);

        const requestedResources = {
          tokens: 1000, // Base cost for upload
          documents: 1,
          storage_gb: size / (1024 ** 3),
        };

        const limitCheck = await TokenUsageService.enforceLimits(
          userId,
          userUsage,
          userPlan,
          requestedResources
        );

        if (!limitCheck.allowed) {
          errors.push({
            filename: originalname,
            error: limitCheck.message
          });
          await bucket.file(gcsPath).delete().catch(() => {});
          await pool.query('DELETE FROM user_files WHERE id = $1', [fileId]).catch(() => {});
          continue;
        }

        await TokenUsageService.incrementUsage(userId, requestedResources, userPlan);

        documentController.processDocument(fileId, buffer, mimetype, userId, null).catch(err =>
          console.error(`❌ Background processing failed for ${fileId}:`, err.message)
        );

        const previewUrl = await makeSignedReadUrl(gcsPath, 15);

        uploadedFiles.push({
          id: fileId,
          name: originalname,
          size: size,
          mimetype: mimetype,
          status: "uploaded_and_queued",
          previewUrl: previewUrl,
          gcsPath: gcsPath
        });
      } catch (fileError) {
        console.error(`❌ Error uploading file ${originalname}:`, fileError);
        errors.push({
          filename: originalname,
          error: fileError.message
        });
      }
    }

    return res.status(201).json({
      success: true,
      message: `Uploaded ${uploadedFiles.length} file(s) successfully.${errors.length > 0 ? ` ${errors.length} file(s) failed.` : ''}`,
      files: uploadedFiles,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error("❌ [MindmapController] uploadDocuments error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to upload documents.",
      details: error.message
    });
  }
};

exports.getFilesForMindmap = async (req, res) => {
  try {
    const userId = req.user.id;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    console.log(`📋 [MindmapController] Fetching files for mindmap for user: ${userId}`);

    const userIdInt = parseInt(userId, 10);
    if (isNaN(userIdInt)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }
    
    const filesQuery = `
      SELECT 
        uf.id,
        uf.originalname,
        uf.size,
        uf.mimetype,
        uf.status,
        uf.processing_progress,
        uf.created_at,
        uf.processed_at,
        COUNT(DISTINCT fc.id) as chat_count
      FROM user_files uf
      LEFT JOIN file_chats fc ON uf.id = fc.file_id AND CAST(fc.user_id AS INTEGER) = $1
      WHERE CAST(uf.user_id AS INTEGER) = $1
        AND uf.is_folder = false
        AND uf.status = 'processed'
      GROUP BY uf.id, uf.originalname, uf.size, uf.mimetype, uf.status, 
               uf.processing_progress, uf.created_at, uf.processed_at
      ORDER BY uf.created_at DESC
    `;

    const result = await pool.query(filesQuery, [userIdInt]);

    const files = result.rows.map(file => ({
      id: file.id,
      name: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
      status: file.status,
      progress: file.processing_progress,
      createdAt: file.created_at,
      processedAt: file.processed_at,
      chatCount: parseInt(file.chat_count) || 0,
      hasChats: parseInt(file.chat_count) > 0
    }));

    console.log(`✅ [MindmapController] Found ${files.length} processed files for user ${userId}`);

    return res.status(200).json({
      success: true,
      files: files,
      count: files.length
    });
  } catch (error) {
    console.error('[MindmapController] getFilesForMindmap error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch files for mindmap',
      details: error.message
    });
  }
};

exports.generateMindmap = async (req, res) => {
  try {
    const userId = req.user.id;
    const { file_ids, session_id, prompt } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!file_ids || !Array.isArray(file_ids) || file_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: "file_ids array is required and must contain at least one file ID"
      });
    }

    console.log(`🗺️ [MindmapController] Generating mindmap for ${file_ids.length} file(s) for user: ${userId}`);

    const userIdInt = parseInt(userId, 10);
    if (isNaN(userIdInt)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }

    const filesQuery = `
      SELECT id, originalname, status, processing_progress
      FROM user_files
      WHERE id = ANY($1::uuid[])
        AND CAST(user_id AS INTEGER) = $2
        AND is_folder = false
    `;

    const filesResult = await pool.query(filesQuery, [file_ids, userIdInt]);

    if (filesResult.rows.length !== file_ids.length) {
      return res.status(400).json({
        success: false,
        error: "One or more files not found or do not belong to user",
        requested: file_ids.length,
        found: filesResult.rows.length
      });
    }

    const unprocessedFiles = filesResult.rows.filter(f => f.status !== 'processed');
    if (unprocessedFiles.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Some files are not yet processed",
        unprocessedFiles: unprocessedFiles.map(f => ({
          id: f.id,
          name: f.originalname,
          status: f.status,
          progress: f.processing_progress
        }))
      });
    }

    const GATEWAY_URL = process.env.API_GATEWAY_URL || 'http://localhost:5000';
    const authToken = req.headers.authorization;
    const fetch = require('node-fetch');

    try {
      const fileIdToProcess = file_ids.length === 1 ? file_ids[0] : file_ids[0];
      
      if (file_ids.length > 1) {
        console.log(`⚠️ [MindmapController] Multiple files provided (${file_ids.length}), generating mindmap for first file only`);
      }

      const response = await fetch(`${GATEWAY_URL}/visual/generate-mindmap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authToken || ''
        },
        body: JSON.stringify({
          file_id: fileIdToProcess,  // Visual service expects 'file_id' (singular)
          session_id: session_id || `mindmap-session-${Date.now()}`,
          prompt: prompt || null
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || 'Failed to generate mindmap' };
        }
        throw new Error(errorData.error || `Visual service returned ${response.status}`);
      }

      const mindmapData = await response.json();

      console.log(`✅ [MindmapController] Mindmap generated successfully for file: ${fileIdToProcess}`);

      return res.status(200).json({
        success: true,
        message: file_ids.length === 1 
          ? `Mindmap generated for ${file_ids.length} file(s)` 
          : `Mindmap generated for first file (${file_ids.length} files provided)`,
        mindmap: mindmapData,
        file_ids: file_ids,
        processed_file_id: fileIdToProcess,
        files: filesResult.rows.map(f => ({
          id: f.id,
          name: f.originalname
        }))
      });
    } catch (visualServiceError) {
      console.error('❌ [MindmapController] Visual service error:', visualServiceError);
      
      return res.status(500).json({
        success: false,
        error: "Failed to generate mindmap",
        details: visualServiceError.message
      });
    }
  } catch (error) {
    console.error("❌ [MindmapController] generateMindmap error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to generate mindmap",
      details: error.message
    });
  }
};

exports.generateUploadUrl = async (req, res) => {
  try {
    const userId = req.user.id;
    const authorizationHeader = req.headers.authorization;
    const { filename, mimetype, size } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!filename) {
      return res.status(400).json({ error: "Filename is required" });
    }

    if (!size) {
      return res.status(400).json({ 
        error: "File size is required. Please provide the file size in bytes." 
      });
    }

    const { plan: userPlan } = await TokenUsageService.getUserUsageAndPlan(userId, authorizationHeader);
    
    const fileSizeBytes = typeof size === 'string' ? parseInt(size, 10) : Number(size);
    
    if (isNaN(fileSizeBytes) || fileSizeBytes <= 0) {
      return res.status(400).json({ 
        error: "Invalid file size. Please provide a valid file size in bytes." 
      });
    }
    
    const fileSizeCheck = TokenUsageService.checkFreeTierFileSize(fileSizeBytes, userPlan);
    if (!fileSizeCheck.allowed) {
      console.log(`[FREE TIER] Upload URL generation REJECTED - size limit exceeded`);
      return res.status(403).json({ 
        error: fileSizeCheck.message,
        shortMessage: fileSizeCheck.shortMessage || fileSizeCheck.message,
        fileSizeMB: fileSizeCheck.fileSizeMB,
        maxSizeMB: fileSizeCheck.maxSizeMB,
        upgradeRequired: true,
        planType: 'free',
        limit: `${fileSizeCheck.maxSizeMB} MB`
      });
    }

    const folderPath = `mindmap-uploads/${userId}`;
    const timestamp = Date.now();
    const safeFilename = filename.replace(/\s+/g, '_');
    const gcsPath = path.posix.join(folderPath, `${timestamp}_${safeFilename}`);
    const uniqueKey = await ensureUniqueKey(gcsPath);

    const signedUrl = await getSignedUploadUrl(
      uniqueKey,
      mimetype || 'application/octet-stream',
      15,
      true // Use input bucket for document uploads
    );

    return res.status(200).json({
      signedUrl,
      gcsPath: uniqueKey,
      filename: safeFilename,
      folderPath,
    });
  } catch (error) {
    console.error("❌ [MindmapController] generateUploadUrl error:", error);
    return res.status(500).json({
      error: "Failed to generate upload URL",
      details: error.message
    });
  }
};

exports.completeSignedUpload = async (req, res) => {
  try {
    const userId = req.user.id;
    const authorizationHeader = req.headers.authorization;
    const { gcsPath, filename, mimetype, size } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!gcsPath || !filename || !size) {
      return res.status(400).json({ error: "gcsPath, filename, and size are required" });
    }

    const fileRef = fileInputBucket.file(gcsPath);
    const [exists] = await fileRef.exists();
    if (!exists) {
      return res.status(404).json({ error: "File not found in storage. Upload may have failed." });
    }

    const [metadata] = await fileRef.getMetadata();
    const actualSize = parseInt(metadata.size) || size;

    const { usage: userUsage, plan: userPlan } = await TokenUsageService.getUserUsageAndPlan(userId, authorizationHeader);

    const storageLimitCheck = await checkStorageLimit(userId, actualSize, userPlan);
    if (!storageLimitCheck.allowed) {
      await fileRef.delete().catch(() => {});
      return res.status(403).json({ error: storageLimitCheck.message });
    }

    const requestedResources = {
      tokens: 1000,
      documents: 1,
      storage_gb: actualSize / (1024 ** 3),
    };

    const limitCheck = await TokenUsageService.enforceLimits(
      userId,
      userUsage,
      userPlan,
      requestedResources
    );

    if (!limitCheck.allowed) {
      await fileRef.delete().catch(() => {});
      return res.status(403).json({
        success: false,
        message: limitCheck.message,
        nextRenewalTime: limitCheck.nextRenewalTime,
        remainingTime: limitCheck.remainingTime,
      });
    }

    const folderPath = `mindmap-uploads/${userId}`;
    const gsUri = `gs://${fileInputBucket.name}/${gcsPath}`;
    
    const fileId = await DocumentModel.saveFileMetadata(
      userId,
      filename,
      gsUri,
      folderPath,
      mimetype || metadata.contentType || 'application/octet-stream',
      actualSize,
      "uploaded"
    );

    await TokenUsageService.incrementUsage(userId, requestedResources, userPlan);

    const [fileBuffer] = await fileRef.download();

    documentController.processDocument(fileId, fileBuffer, mimetype || metadata.contentType, userId, null).catch(err =>
      console.error(`❌ Background processing failed for ${fileId}:`, err.message)
    );

    const previewUrl = await makeSignedReadUrl(gcsPath, 15);

    return res.status(201).json({
      success: true,
      message: "File uploaded and processing initiated.",
      file: {
        id: fileId,
        name: filename,
        size: actualSize,
        mimetype: mimetype || metadata.contentType,
        status: "uploaded_and_queued",
        previewUrl: previewUrl
      }
    });
  } catch (error) {
    console.error("❌ [MindmapController] completeSignedUpload error:", error);
    return res.status(500).json({
      error: "Failed to complete upload",
      details: error.message
    });
  }
};

