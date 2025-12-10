


const db = require("../config/db");
const axios = require("axios"); // Import axios
const DocumentModel = require("../models/documentModel");
const File = require("../models/File"); // Import the File model
const FileChunkModel = require("../models/FileChunk");
const ChunkVectorModel = require("../models/ChunkVector");
const ProcessingJobModel = require("../models/ProcessingJob");
const FileChat = require("../models/FileChat");
const secretManagerController = require("./secretManagerController"); // NEW: Import secretManagerController
const { getSecretDetailsById } = require('../controllers/secretManagerController');
const { validate: isUuid } = require("uuid");
const { uploadToGCS, getSignedUrl, getSignedUploadUrl } = require("../services/gcsService");
const {
 convertHtmlToDocx,
 convertHtmlToPdf,
} = require("../services/conversionService");
const {
  askGemini,
  analyzeWithGemini,
  getSummaryFromChunks,
  askLLM,
  streamLLM, // Add streaming function
  resolveProviderName, // Add resolveProviderName here
  getAvailableProviders, // Add getAvailableProviders here
} = require("../services/aiService");
const { extractText, detectDigitalNativePDF, extractTextFromPDFWithPages } = require("../utils/textExtractor");
const {
  extractTextFromDocument,
  batchProcessDocument,
  getOperationStatus,
  fetchBatchResults,
} = require("../services/documentAiService");
const { chunkDocument } = require("../services/chunkingService");
const {
 generateEmbedding,
 generateEmbeddings,
} = require("../services/embeddingService");
const { normalizeGcsKey } = require("../utils/gcsKey");
const TokenUsageService = require("../services/tokenUsageService");
const UserProfileService = require("../services/userProfileService");
const { fileInputBucket, fileOutputBucket } = require("../config/gcs");
const { checkStorageLimit } = require("../utils/storage"); // Import checkStorageLimit
const { DOCUMENT_UPLOAD_COST_TOKENS } = require("../middleware/checkTokenLimits");
const { 
  fetchTemplateFilesData, 
  buildEnhancedSystemPromptWithTemplates,
  fetchSecretManagerWithTemplates 
} = require("../services/secretPromptTemplateService"); // NEW: Import template service

const { v4: uuidv4 } = require("uuid");

const CONVERSATION_HISTORY_TURNS = 5;

/**
 * Ensures the answer is plain text, not JSON
 * Converts JSON objects/strings to plain text
 */
/**
 * Adds structured JSON formatting instructions to secret prompt
 * Ensures LLM output is in clean, structured JSON format wrapped in markdown code blocks
 * @param {string} secretPrompt - The original secret prompt
 * @returns {string} - The prompt with JSON formatting instructions appended
 */
function addSecretPromptJsonFormatting(secretPrompt) {
  const jsonFormattingInstructions = `

=== CRITICAL OUTPUT FORMATTING REQUIREMENTS ===

You MUST format your response as clean, structured JSON wrapped in a markdown code block. The frontend needs to easily parse and render your response.

REQUIRED FORMAT:
\`\`\`json
{
  "title": "Brief descriptive title of the analysis",
  "summary": "A concise summary of the key findings",
  "sections": [
    {
      "heading": "Section heading",
      "content": "Section content with proper formatting. Use markdown formatting like **bold**, *italic*, lists, etc.",
      "subsections": [
        {
          "heading": "Subsection heading",
          "content": "Subsection content"
        }
      ]
    }
  ],
  "keyFindings": [
    "Key finding 1",
    "Key finding 2"
  ],
  "recommendations": [
    "Recommendation 1",
    "Recommendation 2"
  ],
  "metadata": {
    "analysisDate": "Date of analysis if available",
    "documentType": "Type of document analyzed",
    "confidence": "Confidence level of the analysis"
  }
}
\`\`\`

IMPORTANT GUIDELINES:
1. Always wrap your JSON response in \`\`\`json ... \`\`\` markdown code blocks
2. Use proper JSON syntax - all strings must be properly escaped
3. Structure the content logically with clear sections and subsections
4. Use markdown formatting within content strings (bold, italic, lists, etc.)
5. Include all relevant information from the document
6. Make the JSON clean and well-formatted for easy parsing
7. Ensure all JSON is valid and parseable

Your response should ONLY contain the JSON wrapped in markdown code blocks. Do not include any additional text before or after the code block.`;

  return secretPrompt + jsonFormattingInstructions;
}

/**
 * Post-processes LLM response to extract and validate JSON
 * Ensures response is always in the correct format for frontend rendering
 * @param {string} rawResponse - Raw response from LLM
 * @param {Object} outputTemplate - Output template to validate against
 * @returns {string} Cleaned and validated JSON response wrapped in markdown code blocks
 */
function postProcessSecretPromptResponse(rawResponse, outputTemplate = null) {
  if (!rawResponse || typeof rawResponse !== 'string') {
    return rawResponse;
  }

  let cleanedResponse = rawResponse.trim();
  
  // Try to extract JSON from markdown code blocks
  const jsonMatch = cleanedResponse.match(/```json\s*([\s\S]*?)\s*```/i);
  if (jsonMatch) {
    try {
      const jsonData = JSON.parse(jsonMatch[1].trim());
      // Validate and re-wrap in code blocks
      return `\`\`\`json\n${JSON.stringify(jsonData, null, 2)}\n\`\`\``;
    } catch (e) {
      console.warn('[postProcessSecretPromptResponse] Failed to parse JSON from code block:', e);
    }
  }
  
  // Try to extract JSON without code blocks (raw JSON)
  const trimmed = cleanedResponse.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const jsonData = JSON.parse(trimmed);
      // Wrap in code blocks if not already wrapped
      if (!cleanedResponse.includes('```json')) {
        return `\`\`\`json\n${JSON.stringify(jsonData, null, 2)}\n\`\`\``;
      }
      return cleanedResponse;
    } catch (e) {
      console.warn('[postProcessSecretPromptResponse] Failed to parse raw JSON:', e);
    }
  }
  
  // If response doesn't contain JSON, try to find JSON anywhere in the text
  const jsonPattern = /\{[\s\S]*\}/;
  const jsonMatch2 = cleanedResponse.match(jsonPattern);
  if (jsonMatch2) {
    try {
      const jsonData = JSON.parse(jsonMatch2[0]);
      return `\`\`\`json\n${JSON.stringify(jsonData, null, 2)}\n\`\`\``;
    } catch (e) {
      // Not valid JSON, return as is
    }
  }
  
  // Return as is if we can't extract JSON
  return cleanedResponse;
}

function ensurePlainTextAnswer(answer) {
  if (!answer) return '';
  
  // If it's already a string, check if it's JSON
  if (typeof answer === 'string') {
    // Try to parse as JSON
    try {
      const parsed = JSON.parse(answer);
      // If it's an object with a text field, extract it
      if (typeof parsed === 'object' && parsed !== null) {
        if (parsed.text) {
          return String(parsed.text).trim();
        }
        if (parsed.answer) {
          return String(parsed.answer).trim();
        }
        if (parsed.content) {
          return String(parsed.content).trim();
        }
        // If it's an object without text fields, stringify it (shouldn't happen but handle it)
        return JSON.stringify(parsed);
      }
      // If parsed is a string, use it
      if (typeof parsed === 'string') {
        return parsed.trim();
      }
    } catch (e) {
      // Not JSON, return as is
      return answer.trim();
    }
  }
  
  // If it's an object, try to extract text or stringify
  if (typeof answer === 'object' && answer !== null) {
    if (answer.text) {
      return String(answer.text).trim();
    }
    if (answer.answer) {
      return String(answer.answer).trim();
    }
    if (answer.content) {
      return String(answer.content).trim();
    }
    // Last resort: stringify (shouldn't happen)
    return JSON.stringify(answer);
  }
  
  // Convert to string and trim
  return String(answer || '').trim();
}

function formatConversationHistory(chats = [], limit = CONVERSATION_HISTORY_TURNS) {
  if (!Array.isArray(chats) || chats.length === 0) return '';
  const recentChats = chats.slice(-limit);
  return recentChats
    .map((chat, idx) => {
      const turnNumber = chats.length - recentChats.length + idx + 1;
      return `Turn ${turnNumber}:\nUser: ${chat.question || ''}\nAssistant: ${chat.answer || ''}`;
    })
    .join('\n\n');
}

function simplifyHistory(chats = []) {
  if (!Array.isArray(chats)) return [];
  return chats
    .map((chat) => ({
      id: chat.id,
      question: chat.question,
      answer: chat.answer,
      created_at: chat.created_at,
    }))
    .filter((entry) => typeof entry.question === 'string' && typeof entry.answer === 'string');
}

function appendConversationToPrompt(prompt, conversationText) {
  if (!conversationText) return prompt;
  return `You are continuing an existing conversation with the same user. Reference prior exchanges when helpful and keep the narrative consistent.\n\nPrevious Conversation:\n${conversationText}\n\n---\n\n${prompt}`;
}

/**
 * @description Uploads a document, saves its metadata, and initiates asynchronous processing.
 * @route POST /api/doc/upload
 */
exports.uploadDocument = async (req, res) => {
 const userId = req.user.id;
 const authorizationHeader = req.headers.authorization;

 try {
 if (!userId) return res.status(401).json({ error: "Unauthorized" });
 if (!req.file) return res.status(400).json({ error: "No file uploaded." });

 const { originalname, mimetype, buffer, size } = req.file;
 const { secret_id } = req.body; // NEW: Get secret_id from request body

 // Check storage limits
 // Fetch user usage and plan
 const { usage: userUsage, plan: userPlan } = await TokenUsageService.getUserUsageAndPlan(userId, authorizationHeader);

 // Convert size to number if needed
 const fileSizeBytes = typeof size === 'string' ? parseInt(size, 10) : Number(size);
 
 if (isNaN(fileSizeBytes) || fileSizeBytes <= 0) {
   return res.status(400).json({ 
     error: "Invalid file size. Please provide a valid file size." 
   });
 }

 // Check free tier file size limit BEFORE processing
 const fileSizeCheck = TokenUsageService.checkFreeTierFileSize(fileSizeBytes, userPlan);
 if (!fileSizeCheck.allowed) {
   console.log(`\n${'🆓'.repeat(40)}`);
   console.log(`[FREE TIER] File upload REJECTED - size limit exceeded`);
   console.log(`[FREE TIER] File: ${originalname}`);
   console.log(`[FREE TIER] File size: ${(fileSizeBytes / (1024 * 1024)).toFixed(2)} MB`);
   console.log(`[FREE TIER] Max allowed: ${fileSizeCheck.maxSizeMB || 10} MB`);
   console.log(`[FREE TIER] ❌ Upload prevented - file not saved`);
   console.log(`${'🆓'.repeat(40)}\n`);
   
   return res.status(403).json({ 
     error: fileSizeCheck.message,
     shortMessage: fileSizeCheck.shortMessage || fileSizeCheck.message,
     fileSizeMB: fileSizeCheck.fileSizeMB,
     fileSizeGB: fileSizeCheck.fileSizeGB,
     maxSizeMB: fileSizeCheck.maxSizeMB,
     upgradeRequired: true,
     planType: 'free',
     limit: `${fileSizeCheck.maxSizeMB} MB`
   });
 }

 // Check if user is on free plan and controller access limit
 const isFreeUser = TokenUsageService.isFreePlan(userPlan);
 if (isFreeUser) {
   // Check controller access limit (1 per day)
   const controllerAccessCheck = await TokenUsageService.checkFreeTierControllerAccessLimit(userId, userPlan, 'documentController');
   if (!controllerAccessCheck.allowed) {
     return res.status(403).json({
       error: controllerAccessCheck.message,
       upgradeRequired: true,
       used: controllerAccessCheck.used,
       limit: controllerAccessCheck.limit
     });
   }
 }

 // Check storage limits
 const storageLimitCheck = await checkStorageLimit(userId, size, userPlan);
 if (!storageLimitCheck.allowed) {
 return res.status(403).json({ error: storageLimitCheck.message });
 }

 // Calculate requested resources for this upload
 const requestedResources = {
 tokens: DOCUMENT_UPLOAD_COST_TOKENS,
 documents: 1,
 ai_analysis: 1,
 storage_gb: size / (1024 ** 3), // convert bytes to GB
 };

 // Enforce limits
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

 const folderPath = `uploads/${userId}`;
 const { gsUri } = await uploadToGCS(originalname, buffer, folderPath, true, mimetype);

 const fileId = await DocumentModel.saveFileMetadata(
 userId,
 originalname,
 gsUri,
 folderPath,
 mimetype,
 size,
 "uploaded"
 );

 // Increment usage after successful upload
 await TokenUsageService.incrementUsage(userId, requestedResources, userPlan);

 // Asynchronously process the document
 processDocument(fileId, buffer, mimetype, userId, secret_id); // NEW: Pass secret_id to processDocument

  res.status(202).json({
    message: "Document uploaded and processing initiated.",
    file_id: fileId,
    gs_uri: gsUri,
  });
} catch (error) {
  console.error("❌ uploadDocument error:", error);
  res.status(500).json({ error: "Failed to upload document." });
}
};

/**
 * @description Generate signed URL for direct upload to GCS (for large files >32MB)
 * @route POST /api/doc/generate-upload-url
 */
exports.generateUploadUrl = async (req, res) => {
  const userId = req.user.id;
  const authorizationHeader = req.headers.authorization;

  try {
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { filename, mimetype, size } = req.body;
    if (!filename) {
      return res.status(400).json({ error: "Filename is required" });
    }

    // Size is REQUIRED - check file size BEFORE generating signed URL
    if (!size) {
      return res.status(400).json({ 
        error: "File size is required. Please provide the file size in bytes." 
      });
    }

    // Get user plan to check if free tier restrictions apply
    const { plan: userPlan } = await TokenUsageService.getUserUsageAndPlan(userId, authorizationHeader);
    
    // Convert size to number if it's a string
    const fileSizeBytes = typeof size === 'string' ? parseInt(size, 10) : Number(size);
    
    if (isNaN(fileSizeBytes) || fileSizeBytes <= 0) {
      return res.status(400).json({ 
        error: "Invalid file size. Please provide a valid file size in bytes." 
      });
    }
    
    // Check free tier file size limit BEFORE generating signed URL
    const fileSizeCheck = TokenUsageService.checkFreeTierFileSize(fileSizeBytes, userPlan);
    if (!fileSizeCheck.allowed) {
      console.log(`\n${'🆓'.repeat(40)}`);
      console.log(`[FREE TIER] Upload URL generation REJECTED - size limit exceeded`);
      console.log(`[FREE TIER] File: ${filename}`);
      console.log(`[FREE TIER] File size: ${(fileSizeBytes / (1024 * 1024)).toFixed(2)} MB`);
      console.log(`[FREE TIER] Max allowed: ${fileSizeCheck.maxSizeMB || 10} MB`);
      console.log(`[FREE TIER] ❌ Signed URL NOT generated - upload prevented`);
      console.log(`${'🆓'.repeat(40)}\n`);
      
      return res.status(403).json({ 
        error: fileSizeCheck.message,
        shortMessage: fileSizeCheck.shortMessage || fileSizeCheck.message,
        fileSizeMB: fileSizeCheck.fileSizeMB,
        fileSizeGB: fileSizeCheck.fileSizeGB,
        maxSizeMB: fileSizeCheck.maxSizeMB,
        upgradeRequired: true,
        planType: 'free',
        limit: `${fileSizeCheck.maxSizeMB} MB`
      });
    }
    
    console.log(`✅ [generateUploadUrl] File size check passed: ${(fileSizeBytes / (1024 * 1024)).toFixed(2)} MB`);

    // Generate GCS path
    const folderPath = `uploads/${userId}`;
    const path = require('path');
    const timestamp = Date.now();
    const safeFilename = filename.replace(/\s+/g, '_');
    const gcsPath = path.posix.join(folderPath, `${timestamp}_${safeFilename}`);

    // Generate signed URL for upload (15 minutes expiry)
    const signedUrl = await getSignedUploadUrl(
      gcsPath,
      mimetype || 'application/octet-stream',
      15,
      true // Use input bucket for document uploads
    );

    return res.status(200).json({
      signedUrl,
      gcsPath,
      filename: safeFilename,
      folderPath,
    });
  } catch (error) {
    console.error("❌ generateUploadUrl error:", error);
    res.status(500).json({
      error: "Failed to generate upload URL",
      details: error.message
    });
  }
};

/**
 * @description Handle post-upload processing after file is uploaded via signed URL
 * @route POST /api/doc/complete-upload
 */
exports.completeSignedUpload = async (req, res) => {
  const userId = req.user.id;
  const authorizationHeader = req.headers.authorization;

  try {
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { gcsPath, filename, mimetype, size, secret_id } = req.body;
    if (!gcsPath || !filename || !size) {
      return res.status(400).json({ error: "gcsPath, filename, and size are required" });
    }

    // Verify file exists in GCS
    const { fileInputBucket } = require("../config/gcs");
    const fileRef = fileInputBucket.file(gcsPath);
    const [exists] = await fileRef.exists();
    if (!exists) {
      console.error(`❌ [completeSignedUpload] File not found in GCS: ${gcsPath}`);
      return res.status(404).json({ error: "File not found in storage. Upload may have failed." });
    }
    
    // Verify file metadata
    const [metadata] = await fileRef.getMetadata();
    console.log(`✅ [completeSignedUpload] File found in GCS: ${gcsPath}`);
    console.log(`📋 [completeSignedUpload] File metadata:`, {
      size: metadata.size,
      contentType: metadata.contentType,
      timeCreated: metadata.timeCreated,
      bucket: fileInputBucket.name
    });
    
    // Use ACTUAL file size from GCS metadata as source of truth
    const actualFileSize = parseInt(metadata.size) || parseInt(size);
    
    // Validate file size matches (warn if different, but use actual size)
    if (metadata.size && parseInt(metadata.size) !== parseInt(size)) {
      console.warn(`⚠️ [completeSignedUpload] Size mismatch: expected ${size}, got ${metadata.size}. Using actual size from GCS.`);
    }
    
    // Validate mime type if provided
    if (mimetype && metadata.contentType && metadata.contentType !== mimetype) {
      console.warn(`⚠️ [completeSignedUpload] MIME type mismatch: expected ${mimetype}, got ${metadata.contentType}`);
      // Use the actual content type from GCS
      mimetype = metadata.contentType;
    }

    // Check storage limits
    const { usage: userUsage, plan: userPlan } = await TokenUsageService.getUserUsageAndPlan(userId, authorizationHeader);
    
    // CRITICAL: Check free tier file size limit using ACTUAL file size from GCS
    // This is a backup check in case the frontend bypassed the initial check
    const fileSizeCheck = TokenUsageService.checkFreeTierFileSize(actualFileSize, userPlan);
    if (!fileSizeCheck.allowed) {
      console.log(`\n${'🆓'.repeat(40)}`);
      console.log(`[FREE TIER] File upload REJECTED - actual file size exceeds limit`);
      console.log(`[FREE TIER] File: ${filename}`);
      console.log(`[FREE TIER] Actual file size from GCS: ${(actualFileSize / (1024 * 1024)).toFixed(2)} MB`);
      console.log(`[FREE TIER] Max allowed: ${fileSizeCheck.maxSizeMB || 10} MB`);
      console.log(`[FREE TIER] 🗑️ Deleting file from GCS...`);
      console.log(`${'🆓'.repeat(40)}\n`);
      
      // Delete the uploaded file from GCS
      await fileRef.delete().catch(err => {
        console.error(`❌ Failed to delete oversized file from GCS:`, err.message);
      });
      
      return res.status(403).json({ 
        error: fileSizeCheck.message,
        shortMessage: fileSizeCheck.shortMessage || fileSizeCheck.message,
        fileSizeMB: fileSizeCheck.fileSizeMB,
        fileSizeGB: fileSizeCheck.fileSizeGB,
        maxSizeMB: fileSizeCheck.maxSizeMB,
        upgradeRequired: true,
        planType: 'free',
        limit: `${fileSizeCheck.maxSizeMB} MB`,
        actualFileSizeMB: (actualFileSize / (1024 * 1024)).toFixed(2)
      });
    }
    
    const storageLimitCheck = await checkStorageLimit(userId, actualFileSize, userPlan);
    if (!storageLimitCheck.allowed) {
      // Delete the uploaded file if storage limit exceeded
      await fileRef.delete().catch(err => console.error("Failed to delete file:", err));
      return res.status(403).json({ error: storageLimitCheck.message });
    }

    // Calculate requested resources (use actual file size from GCS)
    const requestedResources = {
      tokens: DOCUMENT_UPLOAD_COST_TOKENS,
      documents: 1,
      ai_analysis: 1,
      storage_gb: actualFileSize / (1024 ** 3),
    };

    // Enforce limits
    const limitCheck = await TokenUsageService.enforceLimits(
      userId,
      userUsage,
      userPlan,
      requestedResources
    );

    if (!limitCheck.allowed) {
      // Delete the uploaded file if limits exceeded
      await fileRef.delete().catch(err => console.error("Failed to delete file:", err));
      return res.status(403).json({
        success: false,
        message: limitCheck.message,
        nextRenewalTime: limitCheck.nextRenewalTime,
        remainingTime: limitCheck.remainingTime,
      });
    }

    // Extract folder path from gcsPath
    const folderPath = `uploads/${userId}`;
    const gsUri = `gs://${fileInputBucket.name}/${gcsPath}`;

    // ✅ CRITICAL: Save file metadata to database FIRST before processing
    // This ensures the file record exists even if processing fails
    let fileId;
    try {
      console.log(`💾 [completeSignedUpload] Saving file metadata to database...`);
      fileId = await DocumentModel.saveFileMetadata(
        userId,
        filename,
        gsUri,
        folderPath,
        mimetype || 'application/octet-stream',
        actualFileSize, // Use actual size from GCS metadata
        "uploaded"
      );
      console.log(`✅ [completeSignedUpload] File saved to database with ID: ${fileId}`);
    } catch (dbError) {
      console.error(`❌ [completeSignedUpload] Failed to save file to database:`, dbError);
      // Delete file from GCS if DB save fails
      await fileRef.delete().catch(err => console.error("Failed to delete file after DB error:", err));
      return res.status(500).json({ 
        error: "Failed to save file metadata to database",
        details: dbError.message 
      });
    }

    // Increment usage after successful upload
    try {
      await TokenUsageService.incrementUsage(userId, requestedResources, userPlan);
      console.log(`✅ [completeSignedUpload] Usage incremented successfully`);
    } catch (usageError) {
      console.error(`⚠️ [completeSignedUpload] Failed to increment usage (non-critical):`, usageError.message);
      // Don't fail the upload if usage increment fails - file is already saved
    }

    // Download file buffer for processing
    console.log(`📥 [completeSignedUpload] Downloading file buffer for processing...`);
    const [fileBuffer] = await fileRef.download();
    
    if (!fileBuffer || fileBuffer.length === 0) {
      console.error(`❌ [completeSignedUpload] Downloaded file buffer is empty!`);
      // Update file status to error instead of deleting (file is already in DB)
      try {
        await DocumentModel.updateFileStatus(fileId, "error", 0);
        await DocumentModel.updateCurrentOperation(fileId, "File appears to be empty or corrupted");
      } catch (updateError) {
        console.error(`⚠️ Failed to update file status:`, updateError.message);
      }
      return res.status(400).json({ 
        error: "Uploaded file appears to be empty or corrupted.",
        file_id: fileId // Return file_id so frontend knows the file was created
      });
    }
    
    console.log(`✅ [completeSignedUpload] File buffer downloaded: ${fileBuffer.length} bytes`);
    console.log(`🚀 [completeSignedUpload] Starting document processing with mime type: ${mimetype || 'application/octet-stream'}`);
    
    // Asynchronously process the document
    processDocument(fileId, fileBuffer, mimetype || metadata.contentType || 'application/octet-stream', userId, secret_id)
      .catch(err => {
        console.error(`❌ [completeSignedUpload] Error in processDocument:`, err);
        console.error(`❌ [completeSignedUpload] Error stack:`, err.stack);
      });

    return res.status(202).json({
      message: "Document uploaded and processing initiated.",
      file_id: fileId,
      gs_uri: gsUri,
    });
  } catch (error) {
    console.error("❌ completeSignedUpload error:", error);
    res.status(500).json({
      error: "Failed to complete upload",
      details: error.message
    });
  }
};




const updateProcessingProgress = async (
 fileId,
 status,
 progress,
 currentOperation
) => {
 await DocumentModel.updateFileStatus(fileId, status, progress);
 await DocumentModel.updateCurrentOperation(fileId, currentOperation);
 console.log(`[Progress] File ${fileId}: ${currentOperation} - ${progress}%`);
};

/**
 * @description Asynchronously processes a document with granular real-time progress tracking
 */
async function processDocument(
 fileId,
 fileBuffer,
 mimetype,
 userId,
 secretId = null
) {
 const jobId = uuidv4();

 try {
 // Step 1: Initialize job (0-2%)
 await updateProcessingProgress(
 fileId,
 "processing",
 0.0,
 "Starting document processing"
 );

 await ProcessingJobModel.createJob({
 job_id: jobId,
 file_id: fileId,
 type: "synchronous",
 document_ai_operation_name: null,
 status: "queued",
 secret_id: secretId,
 });

 await updateProcessingProgress(
 fileId,
 "processing",
 2.0,
 "Processing job created"
 );

 // Step 2: Initialize processing (2-5%)
 await updateProcessingProgress(
 fileId,
 "processing",
 3.0,
 "Initializing document processor"
 );

 await updateProcessingProgress(
 fileId,
 "processing",
 5.0,
 "Initialization complete"
 );

 let chunkingMethod = "recursive";

 // Step 3: Fetch chunking method (5-12%)
 if (secretId) {
 await updateProcessingProgress(
 fileId,
 "processing",
 7.0,
 "Fetching processing configuration from database"
 );

 console.log(
 `[processDocument] Fetching chunking method for secret ID: ${secretId}`
 );

 const secretQuery = `
 SELECT chunking_method
 FROM secret_manager
 WHERE id = $1
 `;
 const result = await db.query(secretQuery, [secretId]);

 if (result.rows.length > 0 && result.rows[0].chunking_method) {
 chunkingMethod = result.rows[0].chunking_method;
 console.log(
 `[processDocument] Using chunking method from DB: ${chunkingMethod}`
 );
 await updateProcessingProgress(
 fileId,
 "processing",
 10.0,
 `Configuration loaded: ${chunkingMethod} chunking`
 );
 }
 } else {
 await updateProcessingProgress(
 fileId,
 "processing",
 10.0,
 "Using default configuration (recursive chunking)"
 );
 }

 await updateProcessingProgress(
 fileId,
 "processing",
 12.0,
 "Configuration ready"
 );

 // Step 4: Check if already processed (12-15%)
 await updateProcessingProgress(
 fileId,
 "processing",
 13.0,
 "Checking document processing status"
 );

 const file = await DocumentModel.getFileById(fileId);

 if (file.status === "processed") {
 console.log(
 `[processDocument] File ${fileId} already processed. Skipping.`
 );
 await ProcessingJobModel.updateJobStatus(jobId, "completed");
 await updateProcessingProgress(
 fileId,
 "processed",
 100.0,
 "Already processed"
 );
 return;
 }

 await updateProcessingProgress(
 fileId,
 "processing",
 15.0,
 "Document ready for processing"
 );

 // Step 5: Prepare for text extraction (15-18%)
 await updateProcessingProgress(
 fileId,
 "processing",
 16.0,
 "Analyzing document format"
 );

 let extractedTexts = [];
 const isPDF = String(mimetype).toLowerCase() === 'application/pdf';
 const ocrMimeTypes = [
 "image/png",
 "image/jpeg",
 "image/tiff",
 "application/msword",
 "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
 "application/vnd.ms-powerpoint",
 "application/vnd.openxmlformats-officedocument.presentationml.presentation",
 "application/vnd.ms-excel",
 "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
 "text/plain",
 "text/csv",
 ];

 // Step 6: Text Extraction (18-42%)
 // Special handling for PDFs: Check if digital-native first
 if (isPDF) {
   console.log(`[processDocument] PDF detected - checking if digital-native...`);
   
   await updateProcessingProgress(
     fileId,
     "processing",
     18.0,
     "Analyzing PDF format (checking if digital-native)"
   );
   
   const pdfDetection = await detectDigitalNativePDF(fileBuffer);
   
   console.log(`\n${"=".repeat(80)}`);
   console.log(`[PDF DETECTION] Analysis Results for File ID: ${fileId}`);
   console.log(`${"=".repeat(80)}`);
   console.log(`  📄 Page Count: ${pdfDetection.pageCount}`);
   console.log(`  📊 Non-whitespace Characters: ${pdfDetection.nonWhitespaceChars}`);
   console.log(`  📏 Threshold: ${pdfDetection.threshold}`);
   console.log(`  🎯 Confidence Score: ${pdfDetection.confidence || 0}%`);
   if (pdfDetection.metrics) {
     console.log(`  📈 Metrics:`);
     console.log(`     - Characters per page: ${pdfDetection.metrics.charsPerPage}`);
     console.log(`     - Words per page: ${pdfDetection.metrics.wordsPerPage}`);
     console.log(`     - Non-whitespace chars/page: ${pdfDetection.metrics.nonWhitespaceCharsPerPage}`);
     console.log(`     - Total words: ${pdfDetection.metrics.totalWords}`);
     console.log(`     - Has sentences: ${pdfDetection.metrics.hasSentences ? 'Yes' : 'No'}`);
     console.log(`     - OCR artifacts detected: ${pdfDetection.metrics.hasOCRArtifacts ? 'Yes' : 'No'}`);
   }
   if (pdfDetection.reasons && pdfDetection.reasons.length > 0) {
     console.log(`  🔍 Detection Reasons:`);
     pdfDetection.reasons.forEach((reason, idx) => {
       console.log(`     ${idx + 1}. ${reason}`);
     });
   }
   console.log(`  ✅ Is Digital Native: ${pdfDetection.isDigitalNative ? 'YES' : 'NO'}`);
   console.log(`${"=".repeat(80)}\n`);
   
   if (pdfDetection.isDigitalNative) {
     // Digital-native PDF: Use pdf-parse directly (FREE, no Document AI cost)
     console.log(`\n${"🟢".repeat(40)}`);
     console.log(`[TEXT EXTRACTION METHOD] ✅ DIGITAL-NATIVE PDF DETECTED`);
     console.log(`[TEXT EXTRACTION METHOD] 📦 Using: pdf-parse (FREE - No Document AI cost)`);
     console.log(`[TEXT EXTRACTION METHOD] 💰 Cost: $0.00 (Cost savings enabled)`);
     console.log(`[TEXT EXTRACTION METHOD] ⚡ Speed: Fast (local parsing)`);
     console.log(`${"🟢".repeat(40)}\n`);
     
     await updateProcessingProgress(
       fileId,
       "processing",
       20.0,
       "Extracting text from digital-native PDF (using pdf-parse)"
     );
     
     // Extract text with page numbers
     extractedTexts = await extractTextFromPDFWithPages(fileBuffer);
     
     console.log(`[TEXT EXTRACTION] ✅ Successfully extracted ${extractedTexts.length} text segment(s) with page numbers`);
     if (extractedTexts.length > 0 && extractedTexts[0].page_start) {
       console.log(`[TEXT EXTRACTION] 📄 Page range: ${extractedTexts[0].page_start} - ${extractedTexts[0].page_end}`);
     }
     
     // VALIDATION: Check if extracted text has meaningful content
     const totalExtractedText = extractedTexts.map(t => t.text || '').join(' ').trim();
     const extractedWordCount = totalExtractedText.split(/\s+/).filter(w => w.length > 0).length;
     const extractedCharCount = totalExtractedText.length;
     const minWordsRequired = 10 * pdfDetection.pageCount; // At least 10 words per page
     const minCharsRequired = 100 * pdfDetection.pageCount; // At least 100 chars per page
     
     console.log(`[TEXT EXTRACTION] Validation:`);
     console.log(`  - Extracted words: ${extractedWordCount} (minimum: ${minWordsRequired})`);
     console.log(`  - Extracted characters: ${extractedCharCount} (minimum: ${minCharsRequired})`);
     
     if (extractedWordCount < minWordsRequired || extractedCharCount < minCharsRequired) {
       console.log(`\n${"⚠️".repeat(40)}`);
       console.log(`[TEXT EXTRACTION] ⚠️ WARNING: Extracted text is too sparse`);
       console.log(`[TEXT EXTRACTION] Digital-native detection may have been incorrect`);
       console.log(`[TEXT EXTRACTION] Falling back to Document AI for better extraction`);
       console.log(`${"⚠️".repeat(40)}\n`);
       
       // Clear extractedTexts to force Document AI processing
       extractedTexts = [];
       
       await updateProcessingProgress(
         fileId,
         "processing",
         20.0,
         "Text extraction insufficient - falling back to Document AI OCR"
       );
     } else {
       await updateProcessingProgress(
         fileId,
         "processing",
         38.0,
         "Text extraction completed (digital-native PDF - pdf-parse)"
       );
       
       await updateProcessingProgress(
         fileId,
         "processing",
         42.0,
         "Text extraction successful (Method: pdf-parse)"
       );
     }
   } else {
     // Scanned PDF: Use Document AI OCR (costs apply)
     console.log(`\n${"🟡".repeat(40)}`);
     console.log(`[TEXT EXTRACTION METHOD] ⚠️ SCANNED PDF DETECTED`);
     console.log(`[TEXT EXTRACTION METHOD] 📦 Using: Document AI OCR (Google Cloud)`);
     console.log(`[TEXT EXTRACTION METHOD] 💰 Cost: Document AI pricing applies`);
     console.log(`[TEXT EXTRACTION METHOD] ⏱️ Speed: Slower (cloud OCR processing)`);
     if (pdfDetection.error) {
       console.log(`[TEXT EXTRACTION METHOD] ⚠️ Detection error: ${pdfDetection.error}`);
     }
     console.log(`${"🟡".repeat(40)}\n`);
     
     await updateProcessingProgress(
       fileId,
       "processing",
       20.0,
       "Scanned PDF detected - preparing for Document AI OCR"
     );
     
     // Fall through to Document AI processing below
   }
 }
 
 // Use OCR for scanned PDFs or other OCR-required file types
 const useOCR = (isPDF && !extractedTexts.length) || ocrMimeTypes.includes(String(mimetype).toLowerCase());

 if (useOCR) {
 console.log(
 `[processDocument] Using Document AI OCR for ${isPDF ? 'scanned PDF' : 'file'} (file ID: ${fileId})`
 );

 await updateProcessingProgress(
 fileId,
 "processing",
 20.0,
 "Preparing document for OCR"
 );

 await updateProcessingProgress(
 fileId,
 "processing",
 22.0,
 "Sending document to OCR engine"
 );

 await updateProcessingProgress(
 fileId,
 "processing",
 25.0,
 "OCR processing started (this may take a moment)"
 );

 const FILE_SIZE_LIMIT_INLINE = 20 * 1024 * 1024; // 20MB - Document AI inline limit
 const fileSizeMB = (fileBuffer.length / 1024 / 1024).toFixed(2);
 const isLargeFile = fileBuffer.length > FILE_SIZE_LIMIT_INLINE;

 console.log(`[processDocument] Processing file with Document AI (${fileSizeMB}MB, mimeType: ${mimetype})`);

 // Try inline processing first, fall back to batch if it fails or file is too large
 let useBatchProcessing = isLargeFile;
 
 if (!useBatchProcessing) {
   // Try inline processing for smaller files
   try {
     extractedTexts = await extractTextFromDocument(fileBuffer, mimetype);
     
     if (!extractedTexts || extractedTexts.length === 0) {
       console.warn(`[processDocument] No text extracted from inline processing, trying batch processing`);
       useBatchProcessing = true;
     } else {
       console.log(`[processDocument] Successfully extracted ${extractedTexts.length} text segment(s) using inline processing`);
       
       await updateProcessingProgress(
         fileId,
         "processing",
         38.0,
         "OCR processing completed"
       );

       await updateProcessingProgress(
         fileId,
         "processing",
         42.0,
         "Text extraction successful"
       );
     }
   } catch (ocrError) {
     console.warn(`[processDocument] Inline OCR failed (${ocrError.message}), falling back to batch processing`);
     useBatchProcessing = true;
   }
 }

 // Use batch processing for large files or if inline failed
 if (useBatchProcessing) {
   console.log(`[processDocument] Using batch processing (file: ${fileSizeMB}MB)`);
   
   await updateProcessingProgress(
     fileId,
     "processing",
     26.0,
     "Uploading to GCS for batch processing"
   );
   
   // Get original filename from database if available
   const fileRecord = await DocumentModel.getFileById(fileId);
   const originalFilename = fileRecord?.originalname || `file_${fileId}`;
   
   // Upload to GCS for batch processing
   const batchUploadFolder = `batch-uploads/${userId}/${uuidv4()}`;
   const { gsUri: gcsInputUri } = await uploadToGCS(
     originalFilename,
     fileBuffer,
     batchUploadFolder,
     true, // Use input bucket
     mimetype
   );
   
   await updateProcessingProgress(
     fileId,
     "batch_processing",
     30.0,
     "Starting batch OCR processing"
   );
   
   const outputPrefix = `document-ai-results/${userId}/${uuidv4()}/`;
   const gcsOutputUriPrefix = `gs://${fileOutputBucket.name}/${outputPrefix}`;
   
   const operationName = await batchProcessDocument(
     [gcsInputUri],
     gcsOutputUriPrefix,
     mimetype
   );
   
   console.log(`[processDocument] Batch operation started: ${operationName}`);
   
   // Update job with batch operation details
   const job = await ProcessingJobModel.getJobByFileId(fileId);
   if (job && job.job_id) {
     await ProcessingJobModel.updateJob(job.job_id, {
       gcs_input_uri: gcsInputUri,
       gcs_output_uri_prefix: gcsOutputUriPrefix,
       document_ai_operation_name: operationName,
       type: "batch",
       status: "running",
     });
   }
   
   // ✅ CRITICAL: Store output path in user_files table for tracking
   try {
     await DocumentModel.updateFileOutputPath(fileId, gcsOutputUriPrefix);
     console.log(`[processDocument] ✅ Stored output path in user_files: ${gcsOutputUriPrefix}`);
   } catch (outputPathError) {
     console.error(`[processDocument] ⚠️ Failed to store output path (non-critical):`, outputPathError.message);
   }
   
   // Poll for batch completion and continue processing
   let batchCompleted = false;
   let attempts = 0;
   const maxAttempts = 240; // 20 minutes max
   
   while (!batchCompleted && attempts < maxAttempts) {
     await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
     attempts++;
     
     try {
       const status = await getOperationStatus(operationName);
       
       if (status.done) {
         batchCompleted = true;
         
         if (status.error) {
           console.error(`[processDocument] Batch processing error:`, status.error);
           throw new Error(`Batch processing failed: ${JSON.stringify(status.error)}`);
         }
         
         // Fetch results from GCS
         await updateProcessingProgress(
           fileId,
           "processing",
           40.0,
           "Fetching batch processing results"
         );
         
         const bucketName = fileOutputBucket.name;
         const prefix = outputPrefix;
         extractedTexts = await fetchBatchResults(bucketName, prefix);
         
         if (!extractedTexts || extractedTexts.length === 0) {
           throw new Error("No text extracted from batch processing results");
         }
         
         console.log(`\n${"✅".repeat(40)}`);
         console.log(`[TEXT EXTRACTION] ✅ SUCCESS - Batch Document AI Processing`);
         console.log(`[TEXT EXTRACTION] 📦 Method: Document AI (Batch)`);
         console.log(`[TEXT EXTRACTION] 📊 Extracted: ${extractedTexts.length} text segment(s)`);
         console.log(`${"✅".repeat(40)}\n`);
         
         await updateProcessingProgress(
           fileId,
           "processing",
           42.0,
           "Batch OCR processing completed"
         );
       } else {
         // Update progress
         const progress = Math.min(30 + (attempts * 0.15), 39);
         await updateProcessingProgress(
           fileId,
           "batch_processing",
           progress,
           "Batch OCR processing in progress"
         );
       }
     } catch (pollError) {
       console.error(`[processDocument] Batch polling error:`, pollError);
       throw pollError;
     }
   }
   
   if (!batchCompleted) {
     throw new Error("Batch processing timeout after 20 minutes");
   }
 }
 } else {
   console.log(`\n${"🟢".repeat(40)}`);
   console.log(`[TEXT EXTRACTION METHOD] ✅ STANDARD TEXT EXTRACTION`);
   console.log(`[TEXT EXTRACTION METHOD] 📦 Using: Native text extractor (pdf-parse/mammoth)`);
   console.log(`[TEXT EXTRACTION METHOD] 📄 File Type: ${mimetype}`);
   console.log(`[TEXT EXTRACTION METHOD] 💰 Cost: $0.00 (Free)`);
   console.log(`[TEXT EXTRACTION METHOD] ⚡ Speed: Fast (local parsing)`);
   console.log(`${"🟢".repeat(40)}\n`);
   
   console.log(`[processDocument] Using standard text extraction for file ID ${fileId}`);

 await updateProcessingProgress(
 fileId,
 "processing",
 22.0,
 "Starting text extraction"
 );

 await updateProcessingProgress(
 fileId,
 "processing",
 28.0,
 "Extracting text content from document"
 );

 const text = await extractText(fileBuffer, mimetype);
 extractedTexts.push({ text });

 await updateProcessingProgress(
 fileId,
 "processing",
 38.0,
 "Text extracted successfully"
 );

 await updateProcessingProgress(
 fileId,
 "processing",
 42.0,
 "Text extraction completed"
 );
 }

 // Step 7: Validate extracted text (42-45%)
 await updateProcessingProgress(
 fileId,
 "processing",
 43.0,
 "Validating extracted text"
 );

 if (
 !extractedTexts.length ||
 extractedTexts.every((item) => !item.text || item.text.trim() === "")
 ) {
 throw new Error("No meaningful text extracted from document.");
 }

 await updateProcessingProgress(
 fileId,
 "processing",
 45.0,
 "Text validation completed"
 );

 // Step 8: Prepare for chunking (45-48%)
 await updateProcessingProgress(
 fileId,
 "processing",
 46.0,
 `Preparing to chunk document using ${chunkingMethod} method`
 );

 await updateProcessingProgress(
 fileId,
 "processing",
 48.0,
 "Analyzing document structure for optimal chunking"
 );

 // Step 9: Chunking (48-58%)
 console.log(
 `[processDocument] Chunking file ID ${fileId} using method: ${chunkingMethod}`
 );

 await updateProcessingProgress(
 fileId,
 "processing",
 50.0,
 `Chunking document with ${chunkingMethod} strategy`
 );

 const chunks = await chunkDocument(extractedTexts, fileId, chunkingMethod);

 console.log(
 `[processDocument] Generated ${chunks.length} chunks using ${chunkingMethod} method.`
 );

 await updateProcessingProgress(
 fileId,
 "processing",
 56.0,
 `Generated ${chunks.length} chunks`
 );

 await updateProcessingProgress(
 fileId,
 "processing",
 58.0,
 `Chunking completed with ${chunks.length} segments`
 );

 if (!chunks.length) {
 console.warn(
 `[processDocument] No chunks generated. Marking as processed.`
 );
 await DocumentModel.updateFileProcessedAt(fileId);
 await updateProcessingProgress(
 fileId,
 "processed",
 100.0,
 "Processing completed (no content to chunk)"
 );
 await ProcessingJobModel.updateJobStatus(jobId, "completed");
 return;
 }

 // Step 10: Prepare embeddings (58-62%)
 await updateProcessingProgress(
 fileId,
 "processing",
 59.0,
 "Preparing chunks for embedding generation"
 );

 const chunkContents = chunks.map((c) => c.content);

 await updateProcessingProgress(
 fileId,
 "processing",
 62.0,
 `Ready to generate embeddings for ${chunks.length} chunks`
 );

 // Step 11: Generate Embeddings (62-76%)
 console.log(
 `[processDocument] Generating embeddings for ${chunks.length} chunks...`
 );

 await updateProcessingProgress(
 fileId,
 "processing",
 64.0,
 "Connecting to embedding service"
 );

 await updateProcessingProgress(
 fileId,
 "processing",
 66.0,
 `Processing embeddings for ${chunks.length} chunks`
 );

 const embeddings = await generateEmbeddings(chunkContents);

 await updateProcessingProgress(
 fileId,
 "processing",
 74.0,
 "All embeddings generated successfully"
 );

 await updateProcessingProgress(
 fileId,
 "processing",
 76.0,
 "Validating embeddings"
 );

 if (chunks.length !== embeddings.length) {
 throw new Error(
 "Mismatch between number of chunks and embeddings generated."
 );
 }

 // Step 12: Prepare database save (76-78%)
 await updateProcessingProgress(
 fileId,
 "processing",
 77.0,
 "Preparing data for database storage"
 );

const chunksToSave = chunks.map((chunk, i) => {
  // ✅ CRITICAL: Extract page_start and page_end from metadata (or chunk directly)
  const page_start = chunk.metadata?.page_start !== null && chunk.metadata?.page_start !== undefined
    ? chunk.metadata.page_start
    : (chunk.page_start !== null && chunk.page_start !== undefined ? chunk.page_start : null);
  const page_end = chunk.metadata?.page_end !== null && chunk.metadata?.page_end !== undefined
    ? chunk.metadata.page_end
    : (chunk.page_end !== null && chunk.page_end !== undefined ? chunk.page_end : null);
  
  return {
    file_id: fileId,
    chunk_index: i,
    content: chunk.content,
    token_count: chunk.token_count,
    page_start: page_start,
    page_end: page_end || page_start, // Use page_start if page_end is null
    heading: chunk.metadata?.heading || chunk.heading || null,
  };
});

 await updateProcessingProgress(
 fileId,
 "processing",
 78.0,
 "Data prepared for storage"
 );

 // Step 13: Save chunks to database (78-82%)
 await updateProcessingProgress(
 fileId,
 "processing",
 79.0,
 "Saving chunks to database"
 );

 const savedChunks = await FileChunkModel.saveMultipleChunks(chunksToSave);

 console.log(
 `[processDocument] Saved ${savedChunks.length} chunks to database.`
 );

 await updateProcessingProgress(
 fileId,
 "processing",
 82.0,
 `${savedChunks.length} chunks saved successfully`
 );

 // Step 14: Prepare vectors (82-84%)
 await updateProcessingProgress(
 fileId,
 "processing",
 83.0,
 "Preparing vector embeddings for storage"
 );

 const vectorsToSave = savedChunks.map((savedChunk, i) => ({
 chunk_id: savedChunk.id,
 embedding: embeddings[i],
 file_id: fileId,
 }));

 await updateProcessingProgress(
 fileId,
 "processing",
 84.0,
 "Vector data prepared"
 );

 // Step 15: Save vectors (84-88%)
 await updateProcessingProgress(
 fileId,
 "processing",
 85.0,
 "Storing vector embeddings in database"
 );

 await ChunkVectorModel.saveMultipleChunkVectors(vectorsToSave);

 await updateProcessingProgress(
 fileId,
 "processing",
 88.0,
 "Vector embeddings stored successfully"
 );

 // Step 16: Prepare for summary (88-90%)
 await updateProcessingProgress(
 fileId,
 "processing",
 89.0,
 "Preparing document content for summarization"
 );

 const fullText = chunks.map((c) => c.content).join("\n\n");

 await updateProcessingProgress(
 fileId,
 "processing",
 90.0,
 "Ready to generate summary"
 );

 // Step 17: Generate Summary (90-95%)
 try {
 if (fullText.trim()) {
 await updateProcessingProgress(
 fileId,
 "processing",
 91.0,
 "Connecting to AI summarization service"
 );

 await updateProcessingProgress(
 fileId,
 "processing",
 92.0,
 "Generating AI-powered document summary"
 );

 const summary = await getSummaryFromChunks(fullText);

 await updateProcessingProgress(
 fileId,
 "processing",
 94.0,
 "Saving document summary"
 );

 await DocumentModel.updateFileSummary(fileId, summary);

 await updateProcessingProgress(
 fileId,
 "processing",
 95.0,
 "Summary generated and saved successfully"
 );

 console.log(
 `[processDocument] Summary generated for file ID ${fileId}`
 );
 }
 } catch (summaryError) {
 console.warn(
 `[processDocument] Summary generation failed: ${summaryError.message}`
 );
 await updateProcessingProgress(
 fileId,
 "processing",
 95.0,
 "Summary generation skipped (non-critical error)"
 );
 }

 // Step 18: Finalization (95-100%)
 await updateProcessingProgress(
 fileId,
 "processing",
 96.0,
 "Updating document metadata"
 );

 await DocumentModel.updateFileProcessedAt(fileId);

 await updateProcessingProgress(
 fileId,
 "processing",
 98.0,
 "Finalizing document processing"
 );

 await updateProcessingProgress(
 fileId,
 "processed",
 100.0,
 "Document processing completed successfully"
 );

 await ProcessingJobModel.updateJobStatus(jobId, "completed");

 console.log(
 `✅ Document ID ${fileId} fully processed using '${chunkingMethod}' method.`
 );
 } catch (error) {
 console.error(`❌ processDocument failed for file ID ${fileId}:`, error);
 await updateProcessingProgress(
 fileId,
 "error",
 0.0,
 `Processing failed: ${error.message}`
 );
 await ProcessingJobModel.updateJobStatus(jobId, "failed", error.message);
 }
}

exports.analyzeDocument = async (req, res) => {
 const userId = req.user.id;
 const authorizationHeader = req.headers.authorization;

 try {
 const { file_id } = req.body;
 if (!file_id)
 return res.status(400).json({ error: "file_id is required." });

 const file = await DocumentModel.getFileById(file_id);
 if (!file) return res.status(404).json({ error: "File not found." });
 if (file.user_id !== userId)
 return res.status(403).json({ error: "Access denied." });

 if (file.status !== "processed") {
 return res.status(400).json({
 error: "Document is still processing or failed.",
 status: file.status,
 progress: file.processing_progress,
 });
 }

 const chunks = await FileChunkModel.getChunksByFileId(file_id);
 const fullText = chunks.map((c) => c.content).join("\n\n");

 const analysisCost = Math.ceil(fullText.length / 500);

 const { userUsage, userPlan, requestedResources } = req;

 // Enforce limits is already handled by middleware. If we reach here, it's allowed.
 // The middleware also handles refetching usage if renewal occurred.

 let insights;
 try {
 insights = await analyzeWithGemini(fullText);
 // Increment usage after successful AI analysis
 await TokenUsageService.incrementUsage(userId, requestedResources, userUsage, userPlan);
 } catch (aiError) {
 console.error("❌ Gemini analysis error:", aiError);
 return res.status(500).json({
 error: "Failed to get AI analysis.",
 details: aiError.message,
 });
 }

 return res.json(insights);
 } catch (error) {
 console.error("❌ analyzeDocument error:", error);
 return res.status(500).json({ error: "Failed to analyze document." });
 }
};
exports.getSummary = async (req, res) => {
 const userId = req.user.id;
 const authorizationHeader = req.headers.authorization;

 try {
 const { file_id, selected_chunk_ids } = req.body;

 if (!file_id)
 return res.status(400).json({ error: "file_id is required." });
 if (!Array.isArray(selected_chunk_ids) || selected_chunk_ids.length === 0) {
 return res.status(400).json({ error: "No chunks selected for summary." });
 }

 const file = await DocumentModel.getFileById(file_id);
 if (!file || file.user_id !== userId) {
 return res.status(403).json({ error: "Access denied or file not found." });
 }

 if (file.status !== "processed") {
 return res.status(400).json({
 error: "Document is still processing or failed.",
 status: file.status,
 progress: file.processing_progress,
 });
 }

 const fileChunks = await FileChunkModel.getChunksByFileId(file_id);
 const allowedIds = new Set(fileChunks.map((c) => c.id));
 const safeChunkIds = selected_chunk_ids.filter((id) => allowedIds.has(id));

 if (safeChunkIds.length === 0) {
 return res.status(400).json({ error: "Selected chunks are invalid for this file." });
 }

 const selectedChunks = await FileChunkModel.getChunkContentByIds(safeChunkIds);
 const combinedText = selectedChunks.map((chunk) => chunk.content).join("\n\n");

 if (!combinedText.trim()) {
 return res.status(400).json({ error: "Selected chunks contain no readable content." });
 }

 const summaryCost = Math.ceil(combinedText.length / 200);

 const { userUsage, userPlan, requestedResources } = req;

 // Enforce limits is already handled by middleware. If we reach here, it's allowed.
 // The middleware also handles refetching usage if renewal occurred.

 let summary;
 try {
 summary = await getSummaryFromChunks(combinedText);
 // Increment usage after successful summary generation
 await TokenUsageService.incrementUsage(userId, requestedResources, userUsage, userPlan);
 } catch (aiError) {
 console.error("❌ Gemini summary error:", aiError);
 return res.status(500).json({
 error: "Failed to generate summary.",
 details: aiError.message,
 });
 }

 return res.json({ summary, used_chunk_ids: safeChunkIds });
 } catch (error) {
 console.error("❌ Error generating summary:", error);
 return res.status(500).json({ error: "Failed to generate summary." });
 }
};


// exports.chatWithDocument = async (req, res) => {
//   let userId = null;

//   try {
//     const {
//       file_id,
//       question,
//       used_secret_prompt = false,
//       prompt_label = null,
//       session_id = null,
//       secret_id,
//       llm_name,
//       additional_input = '',
//     } = req.body;

//     userId = req.user.id;

//     // ---------- VALIDATION ----------
//     const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
//     if (!file_id) return res.status(400).json({ error: 'file_id is required.' });
//     if (!uuidRegex.test(file_id)) return res.status(400).json({ error: 'Invalid file ID format.' });

//     const hasExistingSession = session_id && uuidRegex.test(session_id);
//     const finalSessionId = hasExistingSession ? session_id : uuidv4();

//     console.log(
//       `[chatWithDocument] started: used_secret_prompt=${used_secret_prompt}, secret_id=${secret_id}, llm_name=${llm_name}, session_id=${finalSessionId}`
//     );

//     // ---------- FILE ACCESS ----------
//     const file = await DocumentModel.getFileById(file_id);
//     if (!file) return res.status(404).json({ error: 'File not found.' });
//     if (String(file.user_id) !== String(userId))
//       return res.status(403).json({ error: 'Access denied.' });
//     if (file.status !== 'processed') {
//       return res.status(400).json({
//         error: 'Document is not yet processed.',
//         status: file.status,
//         progress: file.processing_progress,
//       });
//     }

//     let previousChats = [];
//     if (hasExistingSession) {
//       previousChats = await FileChat.getChatHistory(file_id, finalSessionId);
//     }
//     const conversationContext = formatConversationHistory(previousChats);
//     const historyForStorage = simplifyHistory(previousChats);
//     if (historyForStorage.length > 0) {
//       const lastTurn = historyForStorage[historyForStorage.length - 1];
//       console.log(
//         `[chatWithDocument] Using ${historyForStorage.length} prior turn(s) for context. Most recent: Q="${(lastTurn.question || '').slice(0, 120)}", A="${(lastTurn.answer || '').slice(0, 120)}"`
//       );
//     } else {
//       console.log('[chatWithDocument] No prior context for this session.');
//     }

//     // ✅ RAG CONFIGURATION
//     const SIMILARITY_THRESHOLD = 0.75; // Cosine similarity cutoff
//     const MIN_CHUNKS = 5; // Minimum chunks to retrieve
//     const MAX_CHUNKS = 10; // Maximum chunks to retrieve
//     const MAX_CONTEXT_TOKENS = 4000; // ~15% of model limit
//     const CHARS_PER_TOKEN = 4; // Average chars per token
//     const MAX_CONTEXT_CHARS = MAX_CONTEXT_TOKENS * CHARS_PER_TOKEN; // ~16,000 chars

//     // ---------- PROMPT BUILDING ----------
//     let usedChunkIds = [];
//     let storedQuestion = null;
//     let finalPromptLabel = prompt_label;
//     let provider = 'gemini';
//     let finalPrompt = '';

//     // ================================
//     // CASE 1: SECRET PROMPT
//     // ================================
//     if (used_secret_prompt) {
//       if (!secret_id)
//         return res.status(400).json({ error: 'secret_id required for secret prompt.' });

//       const secretQuery = `
//         SELECT s.id, s.name, s.secret_manager_id, s.version, s.llm_id, l.name AS llm_name
//         FROM secret_manager s
//         LEFT JOIN llm_models l ON s.llm_id = l.id
//         WHERE s.id = $1`;
//       const secretResult = await db.query(secretQuery, [secret_id]);
//       if (!secretResult.rows.length)
//         return res.status(404).json({ error: 'Secret configuration not found.' });

//       const { name: secretName, secret_manager_id, version, llm_name: dbLlmName } =
//         secretResult.rows[0];
//       finalPromptLabel = secretName;
//       provider = resolveProviderName(llm_name || dbLlmName || 'gemini');

//       const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
//       const client = new SecretManagerServiceClient();
//       const GCLOUD_PROJECT_ID = process.env.GCLOUD_PROJECT_ID;
//       const gcpSecretName = `projects/${GCLOUD_PROJECT_ID}/secrets/${secret_manager_id}/versions/${version}`;
//       const [accessResponse] = await client.accessSecretVersion({ name: gcpSecretName });
//       const secretValue = accessResponse.payload.data.toString('utf8');

//       // ✅ Get all chunks and apply smart selection
//       const allChunks = await FileChunkModel.getChunksByFileId(file_id);
      
//       if (!allChunks || allChunks.length === 0) {
//         return res.status(400).json({ error: 'No content found in document.' });
//       }

//       // ✅ For secret prompts, use embedding-based selection
//       const secretEmbedding = await generateEmbedding(secretValue);
//       const rankedChunks = await ChunkVectorModel.findNearestChunks(
//         secretEmbedding,
//         MAX_CHUNKS, // Retrieve top 10 candidates
//         file_id
//       );

//       // ✅ Filter by similarity threshold
//       const highQualityChunks = rankedChunks
//         .filter(chunk => {
//           const similarity = chunk.similarity || chunk.distance || 0;
//           const score = similarity > 1 ? (1 / (1 + similarity)) : similarity;
//           return score >= SIMILARITY_THRESHOLD;
//         })
//         .sort((a, b) => {
//           const scoreA = a.similarity > 1 ? (1 / (1 + a.similarity)) : a.similarity;
//           const scoreB = b.similarity > 1 ? (1 / (1 + b.similarity)) : b.similarity;
//           return scoreB - scoreA; // Best first
//         });

//       console.log(`🎯 Filtered chunks: ${highQualityChunks.length}/${rankedChunks.length} above similarity threshold ${SIMILARITY_THRESHOLD}`);

//       // ✅ Select 5-10 best chunks within token budget
//       let selectedChunks = [];
//       let currentContextLength = 0;

//       const chunksToConsider = highQualityChunks.length >= MIN_CHUNKS 
//         ? highQualityChunks 
//         : rankedChunks; // Fallback if not enough high-quality chunks

//       for (const chunk of chunksToConsider) {
//         if (selectedChunks.length >= MAX_CHUNKS) break;
        
//         const chunkLength = chunk.content.length;
//         if (currentContextLength + chunkLength <= MAX_CONTEXT_CHARS) {
//           selectedChunks.push(chunk);
//           currentContextLength += chunkLength;
//         } else if (selectedChunks.length < MIN_CHUNKS) {
//           // If we haven't reached minimum, truncate this chunk to fit
//           const remainingSpace = MAX_CONTEXT_CHARS - currentContextLength;
//           if (remainingSpace > 500) {
//             selectedChunks.push({
//               ...chunk,
//               content: chunk.content.substring(0, remainingSpace - 100) + "..."
//             });
//             currentContextLength += remainingSpace;
//           }
//           break;
//         }
//       }

//       // ✅ Ensure minimum chunks
//       const finalChunks = selectedChunks.length >= MIN_CHUNKS 
//         ? selectedChunks 
//         : chunksToConsider.slice(0, MIN_CHUNKS);

//       console.log(`✅ Selected ${finalChunks.length} chunks for secret prompt | Context: ${currentContextLength} chars (~${Math.ceil(currentContextLength / CHARS_PER_TOKEN)} tokens)`);

//       usedChunkIds = finalChunks.map((c) => c.chunk_id || c.id);

//       // ✅ Build context with separators and metadata
//       const docContent = finalChunks
//         .map((c, idx) => {
//           const similarity = c.similarity || c.distance || 0;
//           const score = similarity > 1 ? (1 / (1 + similarity)) : similarity;
//           return `--- Chunk ${idx + 1} | Relevance: ${(score * 100).toFixed(1)}% ---\n${c.content}`;
//         })
//         .join('\n\n');

//       finalPrompt = `You are an expert AI legal assistant using the ${provider.toUpperCase()} model.\n\n${secretValue}\n\n=== DOCUMENT TO ANALYZE ===\n${docContent}`;
      
//       if (additional_input?.trim()) {
//         const trimmedInput = additional_input.trim().substring(0, 500);
//         finalPrompt += `\n\n=== ADDITIONAL USER INSTRUCTIONS ===\n${trimmedInput}`;
//       }

//       storedQuestion = secretName;
//     } 
//     // ================================
//     // CASE 2: CUSTOM QUESTION
//     // ================================
//     else {
//       if (!question?.trim())
//         return res.status(400).json({ error: 'question is required.' });

//       storedQuestion = question.trim();

//       // Fetch LLM model from custom_query table for custom queries (always fetch from DB)
//       let dbLlmName = null;
//       const customQueryLlm = `
//         SELECT cq.llm_name, cq.llm_model_id
//         FROM custom_query cq
//         ORDER BY cq.id DESC
//         LIMIT 1;
//       `;
//       const customQueryResult = await db.query(customQueryLlm);
//       if (customQueryResult.rows.length > 0) {
//         dbLlmName = customQueryResult.rows[0].llm_name;
//         console.log(`🤖 Using LLM from custom_query table: ${dbLlmName}`);
//       } else {
//         console.warn(`⚠️ No LLM found in custom_query table — falling back to gemini`);
//         dbLlmName = 'gemini';
//       }

//       // Resolve provider name using the LLM from custom_query table
//       provider = resolveProviderName(dbLlmName || "gemini");
//       console.log(`🤖 Resolved LLM provider for custom query: ${provider}`);
      
//       // Check if provider is available
//       const availableProviders = getAvailableProviders();
//       if (!availableProviders[provider] || !availableProviders[provider].available) {
//         console.warn(`⚠️ Provider '${provider}' unavailable — falling back to gemini`);
//         provider = 'gemini';
//       }

//       // ✅ Vector search with similarity scoring
//       const questionEmbedding = await generateEmbedding(storedQuestion);
//       const rankedChunks = await ChunkVectorModel.findNearestChunks(
//         questionEmbedding,
//         MAX_CHUNKS, // Retrieve top 10 candidates
//         file_id
//       );

//       if (!rankedChunks || rankedChunks.length === 0) {
//         // Fallback: use all chunks if no vector matches
//         console.log('⚠️ No vector matches found, using all chunks as fallback');
//         const allChunks = await FileChunkModel.getChunksByFileId(file_id);
//         const limitedChunks = allChunks.slice(0, MIN_CHUNKS);
//         usedChunkIds = limitedChunks.map((c) => c.id);
        
//         const docContent = limitedChunks
//           .map((c, idx) => `--- Chunk ${idx + 1} ---\n${c.content}`)
//           .join('\n\n');
        
//         finalPrompt = `${storedQuestion}\n\n=== DOCUMENT CONTEXT ===\n${docContent}`;
//       } else {
//         // ✅ Filter by similarity threshold
//         const highQualityChunks = rankedChunks
//           .filter(chunk => {
//             const similarity = chunk.similarity || chunk.distance || 0;
//             const score = similarity > 1 ? (1 / (1 + similarity)) : similarity;
//             return score >= SIMILARITY_THRESHOLD;
//           })
//           .sort((a, b) => {
//             const scoreA = a.similarity > 1 ? (1 / (1 + a.similarity)) : a.similarity;
//             const scoreB = b.similarity > 1 ? (1 / (1 + b.similarity)) : b.similarity;
//             return scoreB - scoreA;
//           });

//         console.log(`🎯 Filtered chunks: ${highQualityChunks.length}/${rankedChunks.length} above similarity threshold ${SIMILARITY_THRESHOLD}`);

//         // ✅ Select 5-10 best chunks within token budget
//         let selectedChunks = [];
//         let currentContextLength = 0;

//         const chunksToConsider = highQualityChunks.length >= MIN_CHUNKS 
//           ? highQualityChunks 
//           : rankedChunks;

//         for (const chunk of chunksToConsider) {
//           if (selectedChunks.length >= MAX_CHUNKS) break;
          
//           const chunkLength = chunk.content.length;
//           if (currentContextLength + chunkLength <= MAX_CONTEXT_CHARS) {
//             selectedChunks.push(chunk);
//             currentContextLength += chunkLength;
//           } else if (selectedChunks.length < MIN_CHUNKS) {
//             const remainingSpace = MAX_CONTEXT_CHARS - currentContextLength;
//             if (remainingSpace > 500) {
//               selectedChunks.push({
//                 ...chunk,
//                 content: chunk.content.substring(0, remainingSpace - 100) + "..."
//               });
//               currentContextLength += remainingSpace;
//             }
//             break;
//           }
//         }

//         // ✅ Ensure minimum chunks
//         const finalChunks = selectedChunks.length >= MIN_CHUNKS 
//           ? selectedChunks 
//           : chunksToConsider.slice(0, MIN_CHUNKS);

//         console.log(`✅ Selected ${finalChunks.length} chunks | Context: ${currentContextLength} chars (~${Math.ceil(currentContextLength / CHARS_PER_TOKEN)} tokens)`);

//         usedChunkIds = finalChunks.map((c) => c.chunk_id || c.id);

//         // ✅ Build context with separators and metadata
//         const relevantTexts = finalChunks
//           .map((c, idx) => {
//             const similarity = c.similarity || c.distance || 0;
//             const score = similarity > 1 ? (1 / (1 + similarity)) : similarity;
//             return `--- Chunk ${idx + 1} | Relevance: ${(score * 100).toFixed(1)}% ---\n${c.content}`;
//           })
//           .join('\n\n');

//         finalPrompt = `${storedQuestion}\n\n=== RELEVANT CONTEXT ===\n${relevantTexts}`;
//       }
//     }

//     finalPrompt = appendConversationToPrompt(finalPrompt, conversationContext);

//     // ---------- CALL LLM ----------
//     console.log(`[chatWithDocument] Calling LLM provider: ${provider} | Chunks used: ${usedChunkIds.length}`);
//     const answer = await askLLM(provider, finalPrompt);

//     if (!answer?.trim()) {
//       return res.status(500).json({ error: 'Empty response from AI.' });
//     }

//     console.log(`[chatWithDocument] Received answer, length: ${answer.length} characters`);

//     // ---------- SAVE CHAT ----------
//     const savedChat = await FileChat.saveChat(
//       file_id,
//       userId,
//       storedQuestion,
//       answer,
//       finalSessionId,
//       usedChunkIds,
//       used_secret_prompt,
//       finalPromptLabel,
//       used_secret_prompt ? secret_id : null,
//       historyForStorage
//     );

//     console.log(`[chatWithDocument] Chat saved with ID: ${savedChat.id} | Chunks used: ${usedChunkIds.length}`);

//     // ---------- TOKEN USAGE ----------
//     try {
//       const { userUsage, userPlan, requestedResources } = req;
//       await TokenUsageService.incrementUsage(userId, requestedResources, userUsage, userPlan);
//     } catch (e) {
//       console.warn('Token usage increment failed:', e.message);
//     }

//     // ---------- FETCH HISTORY ----------
//     const historyRows = await FileChat.getChatHistory(file_id, savedChat.session_id);
//     const history = historyRows.map((row) => ({
//       id: row.id,
//       file_id: row.file_id,
//       session_id: row.session_id,
//       question: row.question,
//       answer: row.answer,
//       used_secret_prompt: row.used_secret_prompt || false,
//       prompt_label: row.prompt_label || null,
//       secret_id: row.secret_id || null,
//       used_chunk_ids: row.used_chunk_ids || [],
//       confidence: row.confidence || 0.8,
//       timestamp: row.created_at || row.timestamp,
//       chat_history: row.chat_history || [],
//       display_text_left_panel: row.used_secret_prompt
//         ? `Analysis: ${row.prompt_label || 'Secret Prompt'}`
//         : row.question,
//     }));

//     // ---------- RETURN COMPLETE RESPONSE ----------
//     return res.status(200).json({
//       success: true,
//       session_id: savedChat.session_id,
//       message_id: savedChat.id,
//       answer,
//       response: answer,
//       history,
//       used_chunk_ids: usedChunkIds,
//       chunks_used: usedChunkIds.length, // ✅ Show actual count
//       confidence: used_secret_prompt ? 0.9 : 0.85,
//       timestamp: savedChat.created_at || new Date().toISOString(),
//       llm_provider: provider,
//       used_secret_prompt,
//     });
//   } catch (error) {
//     console.error('❌ Error in chatWithDocument:', error);
//     console.error('Stack trace:', error.stack);
//     return res.status(500).json({
//       error: 'Failed to get AI answer.',
//       details: error.message,
//     });
//   }
// };


// exports.chatWithDocument = async (req, res) => {
//   let userId = null;

//   try {
//     const {
//       file_id,
//       question,
//       used_secret_prompt = false,
//       prompt_label = null,
//       session_id = null,
//       secret_id,
//       llm_name,
//       additional_input = '',
//     } = req.body;

//     userId = req.user.id;

//     // ---------- VALIDATION ----------
//     const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
//     const hasFileId = Boolean(file_id);
    
//     // Only validate file_id format if it's provided
//     if (hasFileId && !uuidRegex.test(file_id)) {
//       return res.status(400).json({ error: 'Invalid file ID format.' });
//     }

//     // Generate or validate session_id
//     const hasExistingSession = session_id && uuidRegex.test(session_id);
//     const finalSessionId = hasExistingSession ? session_id : uuidv4();

//     console.log(
//       `[chatWithDocument] started: used_secret_prompt=${used_secret_prompt}, secret_id=${secret_id}, llm_name=${llm_name}, session_id=${finalSessionId}, has_file=${hasFileId}`
//     );

//     // Load existing session history (works for both file-based and file-less sessions)
//     const sessionHistory = hasExistingSession
//       ? await FileChat.getChatHistoryBySession(userId, finalSessionId)
//       : [];

//     console.log(`[chatWithDocument] Loaded ${sessionHistory.length} previous messages from session`);

//     // ================================
//     // CASE 1: NO DOCUMENT YET (PRE-UPLOAD CHAT)
//     // ================================
//     if (!hasFileId) {
//       if (!question?.trim()) {
//         return res.status(400).json({ error: 'question is required when no document is provided.' });
//       }

//       console.log(`[chatWithDocument] Pre-upload mode - chatting without document`);

//       // Determine LLM provider
//       let provider = resolveProviderName(llm_name || 'gemini');
//       console.log(`[chatWithDocument] Resolved provider: ${provider}`);
      
//       const availableProviders = getAvailableProviders();
//       if (!availableProviders[provider] || !availableProviders[provider].available) {
//         console.warn(`⚠️ Provider '${provider}' unavailable — falling back to gemini for pre-upload chat`);
//         provider = 'gemini';
//       }

//       // Build prompt with conversation history
//       const userPrompt = question.trim();
//       const conversationContext = formatConversationHistory(sessionHistory);
//       const finalPrompt = appendConversationToPrompt(userPrompt, conversationContext);

//       console.log(`[chatWithDocument] Pre-upload conversation | Provider: ${provider} | Session: ${finalSessionId}`);
//       console.log(`[chatWithDocument] Prompt length: ${finalPrompt.length} chars | History turns: ${sessionHistory.length}`);
      
//       // Get AI response
//       const answer = await askLLM(provider, finalPrompt, ''); // Empty context since it's already in prompt

//       if (!answer?.trim()) {
//         return res.status(500).json({ error: 'Empty response from AI.' });
//       }

//       console.log(`✅ [chatWithDocument] Received answer: ${answer.length} chars`);

//       // Save chat without file_id
//       const savedChat = await FileChat.saveChat(
//         null,              // No file_id for pre-upload chat
//         userId,
//         userPrompt,
//         answer,
//         finalSessionId,
//         [],                // No chunks used
//         false,             // Not a secret prompt
//         null,              // No prompt label
//         null,              // No secret_id
//         simplifyHistory(sessionHistory)  // Store conversation context
//       );

//       // Fetch updated history
//       const updatedHistoryRows = await FileChat.getChatHistoryBySession(userId, finalSessionId);
//       const history = updatedHistoryRows.map((row) => ({
//         id: row.id,
//         file_id: row.file_id,
//         session_id: row.session_id,
//         question: row.question,
//         answer: row.answer,
//         used_secret_prompt: row.used_secret_prompt || false,
//         prompt_label: row.prompt_label || null,
//         secret_id: row.secret_id || null,
//         used_chunk_ids: row.used_chunk_ids || [],
//         confidence: row.confidence || 0.8,
//         timestamp: row.created_at || row.timestamp,
//         display_text_left_panel: row.used_secret_prompt
//           ? `Analysis: ${row.prompt_label || 'Secret Prompt'}`
//           : row.question,
//       }));

//       // Increment usage
//       try {
//         const { userUsage, userPlan, requestedResources } = req;
//         await TokenUsageService.incrementUsage(userId, requestedResources, userUsage, userPlan);
//       } catch (e) {
//         console.warn('Token usage increment failed for pre-upload chat:', e.message);
//       }

//       return res.status(200).json({
//         success: true,
//         session_id: finalSessionId,
//         message_id: savedChat.id,
//         answer,
//         response: answer,
//         history,
//         used_chunk_ids: [],
//         chunks_used: 0,
//         confidence: 0.8,
//         timestamp: savedChat.created_at || new Date().toISOString(),
//         llm_provider: provider,
//         used_secret_prompt: false,
//         mode: 'pre_document',  // Indicates this is a pre-upload conversation
//       });
//     }

//     // ================================
//     // CASE 2: DOCUMENT PROVIDED (POST-UPLOAD CHAT)
//     // ================================
    
//     console.log(`[chatWithDocument] Post-upload mode - chatting with document ${file_id}`);

//     // ---------- FILE ACCESS ----------
//     const file = await DocumentModel.getFileById(file_id);
//     if (!file) return res.status(404).json({ error: 'File not found.' });
//     if (String(file.user_id) !== String(userId)) {
//       return res.status(403).json({ error: 'Access denied.' });
//     }
//     if (file.status !== 'processed') {
//       return res.status(400).json({
//         error: 'Document is not yet processed.',
//         status: file.status,
//         progress: file.processing_progress,
//       });
//     }

//     // Link pre-upload chats to this file if they exist
//     if (sessionHistory.length > 0) {
//       const hasUnassignedChats = sessionHistory.some((chat) => !chat.file_id);
//       if (hasUnassignedChats) {
//         const linkedCount = await FileChat.assignFileIdToSession(userId, finalSessionId, file_id);
//         console.log(`✅ Linked ${linkedCount} pre-upload chat(s) to file ${file_id}`);
//       }
//     }

//     // Load previous chats for this file + session
//     let previousChats = [];
//     if (hasExistingSession) {
//       previousChats = await FileChat.getChatHistory(file_id, finalSessionId);
//     }

//     // Build conversation context from ALL chats (pre-upload + post-upload)
//     const conversationContext = formatConversationHistory(previousChats);
//     const historyForStorage = simplifyHistory(previousChats);
    
//     if (historyForStorage.length > 0) {
//       const lastTurn = historyForStorage[historyForStorage.length - 1];
//       console.log(
//         `[chatWithDocument] Using ${historyForStorage.length} prior turn(s) for context. Most recent: Q="${(lastTurn.question || '').slice(0, 120)}", A="${(lastTurn.answer || '').slice(0, 120)}"`
//       );
//     } else {
//       console.log('[chatWithDocument] No prior context for this session.');
//     }

//     // ✅ RAG CONFIGURATION
//     const SIMILARITY_THRESHOLD = 0.75;
//     const MIN_CHUNKS = 5;
//     const MAX_CHUNKS = 10;
//     const MAX_CONTEXT_TOKENS = 4000;
//     const CHARS_PER_TOKEN = 4;
//     const MAX_CONTEXT_CHARS = MAX_CONTEXT_TOKENS * CHARS_PER_TOKEN;

//     // ---------- PROMPT BUILDING ----------
//     let usedChunkIds = [];
//     let storedQuestion = null;
//     let finalPromptLabel = prompt_label;
//     let provider = 'gemini';
//     let finalPrompt = '';

//     // ================================
//     // SECRET PROMPT HANDLING
//     // ================================
//     if (used_secret_prompt) {
//       if (!secret_id) {
//         return res.status(400).json({ error: 'secret_id required for secret prompt.' });
//       }

//       const secretQuery = `
//         SELECT s.id, s.name, s.secret_manager_id, s.version, s.llm_id, l.name AS llm_name
//         FROM secret_manager s
//         LEFT JOIN llm_models l ON s.llm_id = l.id
//         WHERE s.id = $1`;
//       const secretResult = await db.query(secretQuery, [secret_id]);
//       if (!secretResult.rows.length) {
//         return res.status(404).json({ error: 'Secret configuration not found.' });
//       }

//       const { name: secretName, secret_manager_id, version, llm_name: dbLlmName } =
//         secretResult.rows[0];
//       finalPromptLabel = secretName;
//       provider = resolveProviderName(llm_name || dbLlmName || 'gemini');

//       const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
//       const client = new SecretManagerServiceClient();
//       const GCLOUD_PROJECT_ID = process.env.GCLOUD_PROJECT_ID;
//       const gcpSecretName = `projects/${GCLOUD_PROJECT_ID}/secrets/${secret_manager_id}/versions/${version}`;
//       const [accessResponse] = await client.accessSecretVersion({ name: gcpSecretName });
//       const secretValue = accessResponse.payload.data.toString('utf8');

//       // Get all chunks and apply smart selection
//       const allChunks = await FileChunkModel.getChunksByFileId(file_id);
      
//       if (!allChunks || allChunks.length === 0) {
//         return res.status(400).json({ error: 'No content found in document.' });
//       }

//       // Use embedding-based selection for secret prompts
//       const secretEmbedding = await generateEmbedding(secretValue);
//       const rankedChunks = await ChunkVectorModel.findNearestChunks(
//         secretEmbedding,
//         MAX_CHUNKS,
//         file_id
//       );

//       // Filter by similarity threshold
//       const highQualityChunks = rankedChunks
//         .filter(chunk => {
//           const similarity = chunk.similarity || chunk.distance || 0;
//           const score = similarity > 1 ? (1 / (1 + similarity)) : similarity;
//           return score >= SIMILARITY_THRESHOLD;
//         })
//         .sort((a, b) => {
//           const scoreA = a.similarity > 1 ? (1 / (1 + a.similarity)) : a.similarity;
//           const scoreB = b.similarity > 1 ? (1 / (1 + b.similarity)) : b.similarity;
//           return scoreB - scoreA;
//         });

//       console.log(`🎯 Filtered chunks: ${highQualityChunks.length}/${rankedChunks.length} above similarity threshold ${SIMILARITY_THRESHOLD}`);

//       // Select 5-10 best chunks within token budget
//       let selectedChunks = [];
//       let currentContextLength = 0;

//       const chunksToConsider = highQualityChunks.length >= MIN_CHUNKS 
//         ? highQualityChunks 
//         : rankedChunks;

//       for (const chunk of chunksToConsider) {
//         if (selectedChunks.length >= MAX_CHUNKS) break;
        
//         const chunkLength = chunk.content.length;
//         if (currentContextLength + chunkLength <= MAX_CONTEXT_CHARS) {
//           selectedChunks.push(chunk);
//           currentContextLength += chunkLength;
//         } else if (selectedChunks.length < MIN_CHUNKS) {
//           const remainingSpace = MAX_CONTEXT_CHARS - currentContextLength;
//           if (remainingSpace > 500) {
//             selectedChunks.push({
//               ...chunk,
//               content: chunk.content.substring(0, remainingSpace - 100) + "..."
//             });
//             currentContextLength += remainingSpace;
//           }
//           break;
//         }
//       }

//       const finalChunks = selectedChunks.length >= MIN_CHUNKS 
//         ? selectedChunks 
//         : chunksToConsider.slice(0, MIN_CHUNKS);

//       console.log(`✅ Selected ${finalChunks.length} chunks for secret prompt | Context: ${currentContextLength} chars (~${Math.ceil(currentContextLength / CHARS_PER_TOKEN)} tokens)`);

//       usedChunkIds = finalChunks.map((c) => c.chunk_id || c.id);

//       // Build context with separators and metadata
//       const docContent = finalChunks
//         .map((c, idx) => {
//           const similarity = c.similarity || c.distance || 0;
//           const score = similarity > 1 ? (1 / (1 + similarity)) : similarity;
//           return `--- Chunk ${idx + 1} | Relevance: ${(score * 100).toFixed(1)}% ---\n${c.content}`;
//         })
//         .join('\n\n');

//       finalPrompt = `You are an expert AI legal assistant using the ${provider.toUpperCase()} model.\n\n${secretValue}\n\n=== DOCUMENT TO ANALYZE ===\n${docContent}`;
      
//       if (additional_input?.trim()) {
//         const trimmedInput = additional_input.trim().substring(0, 500);
//         finalPrompt += `\n\n=== ADDITIONAL USER INSTRUCTIONS ===\n${trimmedInput}`;
//       }

//       storedQuestion = secretName;
//     } 
//     // ================================
//     // CUSTOM QUESTION HANDLING
//     // ================================
//     else {
//       if (!question?.trim()) {
//         return res.status(400).json({ error: 'question is required.' });
//       }

//       storedQuestion = question.trim();

//       // Fetch LLM model from custom_query table
//       let dbLlmName = null;
//       const customQueryLlm = `
//         SELECT cq.llm_name, cq.llm_model_id
//         FROM custom_query cq
//         ORDER BY cq.id DESC
//         LIMIT 1;
//       `;
//       const customQueryResult = await db.query(customQueryLlm);
//       if (customQueryResult.rows.length > 0) {
//         dbLlmName = customQueryResult.rows[0].llm_name;
//         console.log(`🤖 Using LLM from custom_query table: ${dbLlmName}`);
//       } else {
//         console.warn(`⚠️ No LLM found in custom_query table — falling back to gemini`);
//         dbLlmName = 'gemini';
//       }

//       provider = resolveProviderName(dbLlmName || "gemini");
//       console.log(`🤖 Resolved LLM provider for custom query: ${provider}`);
      
//       // Check if provider is available
//       const availableProviders = getAvailableProviders();
//       if (!availableProviders[provider] || !availableProviders[provider].available) {
//         console.warn(`⚠️ Provider '${provider}' unavailable — falling back to gemini`);
//         provider = 'gemini';
//       }

//       // Vector search with similarity scoring
//       const questionEmbedding = await generateEmbedding(storedQuestion);
//       const rankedChunks = await ChunkVectorModel.findNearestChunks(
//         questionEmbedding,
//         MAX_CHUNKS,
//         file_id
//       );

//       if (!rankedChunks || rankedChunks.length === 0) {
//         // Fallback: use all chunks if no vector matches
//         console.log('⚠️ No vector matches found, using all chunks as fallback');
//         const allChunks = await FileChunkModel.getChunksByFileId(file_id);
//         const limitedChunks = allChunks.slice(0, MIN_CHUNKS);
//         usedChunkIds = limitedChunks.map((c) => c.id);
        
//         const docContent = limitedChunks
//           .map((c, idx) => `--- Chunk ${idx + 1} ---\n${c.content}`)
//           .join('\n\n');
        
//         finalPrompt = `${storedQuestion}\n\n=== DOCUMENT CONTEXT ===\n${docContent}`;
//       } else {
//         // Filter by similarity threshold
//         const highQualityChunks = rankedChunks
//           .filter(chunk => {
//             const similarity = chunk.similarity || chunk.distance || 0;
//             const score = similarity > 1 ? (1 / (1 + similarity)) : similarity;
//             return score >= SIMILARITY_THRESHOLD;
//           })
//           .sort((a, b) => {
//             const scoreA = a.similarity > 1 ? (1 / (1 + a.similarity)) : a.similarity;
//             const scoreB = b.similarity > 1 ? (1 / (1 + b.similarity)) : b.similarity;
//             return scoreB - scoreA;
//           });

//         console.log(`🎯 Filtered chunks: ${highQualityChunks.length}/${rankedChunks.length} above similarity threshold ${SIMILARITY_THRESHOLD}`);

//         // Select 5-10 best chunks within token budget
//         let selectedChunks = [];
//         let currentContextLength = 0;

//         const chunksToConsider = highQualityChunks.length >= MIN_CHUNKS 
//           ? highQualityChunks 
//           : rankedChunks;

//         for (const chunk of chunksToConsider) {
//           if (selectedChunks.length >= MAX_CHUNKS) break;
          
//           const chunkLength = chunk.content.length;
//           if (currentContextLength + chunkLength <= MAX_CONTEXT_CHARS) {
//             selectedChunks.push(chunk);
//             currentContextLength += chunkLength;
//           } else if (selectedChunks.length < MIN_CHUNKS) {
//             const remainingSpace = MAX_CONTEXT_CHARS - currentContextLength;
//             if (remainingSpace > 500) {
//               selectedChunks.push({
//                 ...chunk,
//                 content: chunk.content.substring(0, remainingSpace - 100) + "..."
//               });
//               currentContextLength += remainingSpace;
//             }
//             break;
//           }
//         }

//         const finalChunks = selectedChunks.length >= MIN_CHUNKS 
//           ? selectedChunks 
//           : chunksToConsider.slice(0, MIN_CHUNKS);

//         console.log(`✅ Selected ${finalChunks.length} chunks | Context: ${currentContextLength} chars (~${Math.ceil(currentContextLength / CHARS_PER_TOKEN)} tokens)`);

//         usedChunkIds = finalChunks.map((c) => c.chunk_id || c.id);

//         // Build context with separators and metadata
//         const relevantTexts = finalChunks
//           .map((c, idx) => {
//             const similarity = c.similarity || c.distance || 0;
//             const score = similarity > 1 ? (1 / (1 + similarity)) : similarity;
//             return `--- Chunk ${idx + 1} | Relevance: ${(score * 100).toFixed(1)}% ---\n${c.content}`;
//           })
//           .join('\n\n');

//         finalPrompt = `${storedQuestion}\n\n=== RELEVANT CONTEXT ===\n${relevantTexts}`;
//       }
//     }

//     // ✅ CRITICAL: Append conversation history to the prompt
//     finalPrompt = appendConversationToPrompt(finalPrompt, conversationContext);

//     // ---------- CALL LLM ----------
//     console.log(`[chatWithDocument] Calling LLM provider: ${provider} | Chunks used: ${usedChunkIds.length}`);
//     const answer = await askLLM(provider, finalPrompt, '');

//     if (!answer?.trim()) {
//       return res.status(500).json({ error: 'Empty response from AI.' });
//     }

//     console.log(`[chatWithDocument] Received answer, length: ${answer.length} characters`);

//     // ---------- SAVE CHAT ----------
//     const savedChat = await FileChat.saveChat(
//       file_id,
//       userId,
//       storedQuestion,
//       answer,
//       finalSessionId,
//       usedChunkIds,
//       used_secret_prompt,
//       finalPromptLabel,
//       used_secret_prompt ? secret_id : null,
//       historyForStorage  // ✅ This includes both pre-upload and post-upload context
//     );

//     console.log(`[chatWithDocument] Chat saved with ID: ${savedChat.id} | Chunks used: ${usedChunkIds.length}`);

//     // ---------- TOKEN USAGE ----------
//     try {
//       const { userUsage, userPlan, requestedResources } = req;
//       await TokenUsageService.incrementUsage(userId, requestedResources, userUsage, userPlan);
//     } catch (e) {
//       console.warn('Token usage increment failed:', e.message);
//     }

//     // ---------- FETCH HISTORY ----------
//     const historyRows = await FileChat.getChatHistory(file_id, savedChat.session_id);
//     const history = historyRows.map((row) => ({
//       id: row.id,
//       file_id: row.file_id,
//       session_id: row.session_id,
//       question: row.question,
//       answer: row.answer,
//       used_secret_prompt: row.used_secret_prompt || false,
//       prompt_label: row.prompt_label || null,
//       secret_id: row.secret_id || null,
//       used_chunk_ids: row.used_chunk_ids || [],
//       confidence: row.confidence || 0.8,
//       timestamp: row.created_at || row.timestamp,
//       chat_history: row.chat_history || [],
//       display_text_left_panel: row.used_secret_prompt
//         ? `Analysis: ${row.prompt_label || 'Secret Prompt'}`
//         : row.question,
//     }));

//     // ---------- RETURN COMPLETE RESPONSE ----------
//     return res.status(200).json({
//       success: true,
//       session_id: savedChat.session_id,
//       message_id: savedChat.id,
//       answer,
//       response: answer,
//       history,
//       used_chunk_ids: usedChunkIds,
//       chunks_used: usedChunkIds.length,
//       confidence: used_secret_prompt ? 0.9 : 0.85,
//       timestamp: savedChat.created_at || new Date().toISOString(),
//       llm_provider: provider,
//       used_secret_prompt,
//       mode: 'post_document',  // Indicates this is a post-upload conversation
//     });
//   } catch (error) {
//     console.error('❌ Error in chatWithDocument:', error);
//     console.error('Stack trace:', error.stack);
//     return res.status(500).json({
//       error: 'Failed to get AI answer.',
//       details: error.message,
//     });
//   }
// };

/**
 * Analyzes user query to determine if it needs full document or targeted search
 * @param {string} question - The user's question/query
 * @returns {Object} Analysis result with strategy, threshold, and reason
 */
function analyzeQueryIntent(question) {
  if (!question || typeof question !== 'string') {
    return {
      needsFullDocument: false,
      threshold: 0.75,
      strategy: 'TARGETED_RAG',
      reason: 'Invalid query - defaulting to targeted search'
    };
  }

  const queryLower = question.toLowerCase();
  
  // Keywords that indicate need for FULL DOCUMENT analysis
  const fullDocumentKeywords = [
    'summary', 'summarize', 'overview', 'complete', 'entire', 'all',
    'comprehensive', 'detailed analysis', 'full details', 'everything',
    'list all', 'what are all', 'give me all', 'extract all',
    'analyze', 'review', 'examine', 'timeline', 'chronology',
    'what is this document', 'what does this document', 'document about',
    'key points', 'main points', 'important information',
    'case details', 'petition details', 'contract terms',
    'parties involved', 'background', 'history'
  ];
  
  // Keywords that indicate TARGETED search is okay
  const targetedKeywords = [
    'specific section', 'find where', 'locate', 'search for',
    'what does it say about', 'mention of', 'reference to',
    'clause', 'paragraph', 'page', 'section'
  ];
  
  // Check for full document indicators
  const needsFullDoc = fullDocumentKeywords.some(keyword => 
    queryLower.includes(keyword)
  );
  
  // Check for targeted search indicators
  const isTargeted = targetedKeywords.some(keyword => 
    queryLower.includes(keyword)
  );
  
  // Special handling for short questions (usually broad)
  const isShortQuestion = question.trim().split(' ').length <= 5;
  
  // Questions asking "what/who/when/where/why/how" with no specific target
  const isBroadQuestion = /^(what|who|when|where|why|how)\s/i.test(queryLower) && 
                          !isTargeted;
  
  return {
    needsFullDocument: needsFullDoc || (isBroadQuestion && !isTargeted) || isShortQuestion,
    threshold: needsFullDoc ? 0.0 : (isTargeted ? 0.80 : 0.75),
    strategy: needsFullDoc ? 'FULL_DOCUMENT' : 'TARGETED_RAG',
    reason: needsFullDoc ? 'Query requires comprehensive analysis' : 'Query is specific/targeted'
  };
}

exports.chatWithDocument = async (req, res) => {
  let userId = null;

  try {
    const {
      file_id,
      question,
      used_secret_prompt = false,
      prompt_label = null,
      session_id = null,
      secret_id,
      llm_name,
      additional_input = '',
    } = req.body;

    userId = req.user.id;

    // ---------- VALIDATION ----------
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const hasFileId = Boolean(file_id);
    
    // Only validate file_id format if it's provided
    if (hasFileId && !uuidRegex.test(file_id)) {
      return res.status(400).json({ error: 'Invalid file ID format.' });
    }

    // Generate or validate session_id
    const hasExistingSession = session_id && uuidRegex.test(session_id);
    const finalSessionId = hasExistingSession ? session_id : uuidv4();

    console.log(
      `[chatWithDocument] started: used_secret_prompt=${used_secret_prompt}, secret_id=${secret_id}, llm_name=${llm_name}, session_id=${finalSessionId}, has_file=${hasFileId}`
    );

    // Load existing session history (works for both file-based and file-less sessions)
    const sessionHistory = hasExistingSession
      ? await FileChat.getChatHistoryBySession(userId, finalSessionId)
      : [];

    console.log(`[chatWithDocument] Loaded ${sessionHistory.length} previous messages from session`);

    // ================================
    // CASE 1: NO DOCUMENT YET (PRE-UPLOAD CHAT)
    // ================================
    if (!hasFileId) {
      if (!question?.trim()) {
        return res.status(400).json({ error: 'question is required when no document is provided.' });
      }

      console.log(`[chatWithDocument] Pre-upload mode - chatting without document`);

      // For pre-upload chats, use llm_name from request OR fetch from custom_query table
      let dbLlmName = llm_name; // Use the one from request first
      
      // If no llm_name in request, fetch from custom_query table
      if (!dbLlmName) {
        const customQueryLlm = `
          SELECT cq.llm_name, cq.llm_model_id
          FROM custom_query cq
          ORDER BY cq.id DESC
          LIMIT 1;
        `;
        const customQueryResult = await db.query(customQueryLlm);
        if (customQueryResult.rows.length > 0) {
          dbLlmName = customQueryResult.rows[0].llm_name;
          console.log(`🤖 Using LLM from custom_query table: ${dbLlmName}`);
        } else {
          console.warn(`⚠️ No LLM found in custom_query table — falling back to gemini`);
          dbLlmName = 'gemini';
        }
      }

      let provider = resolveProviderName(dbLlmName || 'gemini');
      console.log(`[chatWithDocument] Resolved provider for pre-upload: ${provider}`);
      
      const availableProviders = getAvailableProviders();
      if (!availableProviders[provider] || !availableProviders[provider].available) {
        console.warn(`⚠️ Provider '${provider}' unavailable — falling back to gemini for pre-upload chat`);
        provider = 'gemini';
      }

      // Build prompt with conversation history
      const userPrompt = question.trim();
      const conversationContext = formatConversationHistory(sessionHistory);
      let finalPrompt = appendConversationToPrompt(userPrompt, conversationContext);

      // ✅ CRITICAL: Append user professional profile context to the prompt
      try {
        // Check if user is asking about their profile
        const isProfileQuestion = /(my|my own|my personal|my professional|give me|show me|tell me about|what is|what are).*(profile|professional|legal|credentials|bar|jurisdiction|practice|role|experience|details)/i.test(userPrompt);
        
        console.log(`[chatWithDocument] Profile question detected: ${isProfileQuestion} for question: "${userPrompt}"`);
        
        let profileContext;
        if (isProfileQuestion) {
          // For profile questions, get detailed profile information
          console.log(`[chatWithDocument] Fetching detailed profile context for user ${userId}...`);
          profileContext = await UserProfileService.getDetailedProfileContext(userId, req.headers.authorization);
          if (!profileContext) {
            console.log(`[chatWithDocument] Detailed profile context not available, trying regular context...`);
            // Fallback to regular context if detailed not available
            profileContext = await UserProfileService.getProfileContext(userId, req.headers.authorization);
          }
        } else {
          // For regular questions, use standard context
          profileContext = await UserProfileService.getProfileContext(userId, req.headers.authorization);
        }
        
        if (profileContext) {
          // Prepend profile context BEFORE the user question so AI sees it first
          finalPrompt = `${profileContext}\n\nUSER QUESTION:\n${finalPrompt}`;
          console.log(`[chatWithDocument] ✅ Added user professional profile context to pre-upload prompt (detailed: ${isProfileQuestion}, length: ${profileContext.length} chars)`);
        } else {
          console.warn(`[chatWithDocument] ⚠️ No profile context available for user ${userId}`);
        }
      } catch (profileError) {
        console.error(`[chatWithDocument] ❌ Failed to fetch profile context:`, profileError.message);
        console.error(`[chatWithDocument] Error stack:`, profileError.stack);
        // Continue without profile context - don't fail the request
      }

      console.log(`[chatWithDocument] Pre-upload conversation | Provider: ${provider} | Session: ${finalSessionId}`);
      console.log(`[chatWithDocument] Prompt length: ${finalPrompt.length} chars | History turns: ${sessionHistory.length}`);
      
      // Get AI response - pass original question for web search
      let answer = await askLLM(provider, finalPrompt, '', '', userPrompt); // Pass original question for web search
      answer = ensurePlainTextAnswer(answer);

      if (!answer?.trim()) {
        return res.status(500).json({ error: 'Empty response from AI.' });
      }

      console.log(`✅ [chatWithDocument] Received answer: ${answer.length} chars`);

      // Save chat without file_id
      const savedChat = await FileChat.saveChat(
        null,              // No file_id for pre-upload chat
        userId,
        userPrompt,
        answer,
        finalSessionId,
        [],                // No chunks used
        false,             // Not a secret prompt
        null,              // No prompt label
        null,              // No secret_id
        simplifyHistory(sessionHistory)  // Store conversation context
      );

      // Fetch updated history
      const updatedHistoryRows = await FileChat.getChatHistoryBySession(userId, finalSessionId);
      const history = updatedHistoryRows.map((row) => ({
        id: row.id,
        file_id: row.file_id,
        session_id: row.session_id,
        question: row.question,
        answer: row.answer,
        used_secret_prompt: row.used_secret_prompt || false,
        prompt_label: row.prompt_label || null,
        secret_id: row.secret_id || null,
        used_chunk_ids: row.used_chunk_ids || [],
        confidence: row.confidence || 0.8,
        timestamp: row.created_at || row.timestamp,
        display_text_left_panel: row.used_secret_prompt
          ? `Analysis: ${row.prompt_label || 'Secret Prompt'}`
          : row.question,
      }));

      // Increment usage
      try {
        const { userUsage, userPlan, requestedResources } = req;
        await TokenUsageService.incrementUsage(userId, requestedResources, userUsage, userPlan);
      } catch (e) {
        console.warn('Token usage increment failed for pre-upload chat:', e.message);
      }

      return res.status(200).json({
        success: true,
        session_id: finalSessionId,
        message_id: savedChat.id,
        answer,
        response: answer,
        history,
        used_chunk_ids: [],
        chunks_used: 0,
        confidence: 0.8,
        timestamp: savedChat.created_at || new Date().toISOString(),
        llm_provider: provider,
        used_secret_prompt: false,
        mode: 'pre_document',  // Indicates this is a pre-upload conversation
      });
    }

    // ================================
    // CASE 2: DOCUMENT PROVIDED (POST-UPLOAD CHAT)
    // ================================
    
    console.log(`[chatWithDocument] Post-upload mode - chatting with document ${file_id}`);

    // ---------- FILE ACCESS ----------
    const file = await DocumentModel.getFileById(file_id);
    if (!file) return res.status(404).json({ error: 'File not found.' });
    if (String(file.user_id) !== String(userId)) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    if (file.status !== 'processed') {
      return res.status(400).json({
        error: 'Document is not yet processed.',
        status: file.status,
        progress: file.processing_progress,
      });
    }

    // Link pre-upload chats to this file if they exist
    if (sessionHistory.length > 0) {
      const hasUnassignedChats = sessionHistory.some((chat) => !chat.file_id);
      if (hasUnassignedChats) {
        const linkedCount = await FileChat.assignFileIdToSession(userId, finalSessionId, file_id);
        console.log(`✅ Linked ${linkedCount} pre-upload chat(s) to file ${file_id}`);
      }
    }

    // Load previous chats for this file + session
    let previousChats = [];
    if (hasExistingSession) {
      previousChats = await FileChat.getChatHistory(file_id, finalSessionId);
    }

    // Build conversation context from ALL chats (pre-upload + post-upload)
    const conversationContext = formatConversationHistory(previousChats);
    const historyForStorage = simplifyHistory(previousChats);
    
    if (historyForStorage.length > 0) {
      const lastTurn = historyForStorage[historyForStorage.length - 1];
      console.log(
        `[chatWithDocument] Using ${historyForStorage.length} prior turn(s) for context. Most recent: Q="${(lastTurn.question || '').slice(0, 120)}", A="${(lastTurn.answer || '').slice(0, 120)}"`
      );
    } else {
      console.log('[chatWithDocument] No prior context for this session.');
    }

    // ✅ ADAPTIVE RAG CONFIGURATION - Detects query type and adjusts strategy
    // For custom questions, analyze the query intent
    // For secret prompts, we'll analyze later in the secret prompt section
    const questionToAnalyze = question?.trim() || '';
    const queryAnalysis = analyzeQueryIntent(questionToAnalyze);

    let SIMILARITY_THRESHOLD, MIN_CHUNKS, MAX_CHUNKS, MAX_CONTEXT_TOKENS, useFullDocument;

    if (queryAnalysis.needsFullDocument && !used_secret_prompt) {
      // COMPREHENSIVE ANALYSIS MODE - Use entire document
      console.log(`🔍 Query requires full document analysis: "${questionToAnalyze.substring(0, 100)}..."`);
      useFullDocument = true;
      MIN_CHUNKS = 999999; // Force all chunks
      MAX_CHUNKS = 999999;
      MAX_CONTEXT_TOKENS = 25000; // ~100K tokens context (adjust based on your LLM)
      SIMILARITY_THRESHOLD = 0.0; // Accept all chunks
    } else {
      // TARGETED SEARCH MODE - Use semantic search
      console.log(`🎯 Query is targeted, using RAG with threshold ${queryAnalysis.threshold}`);
      useFullDocument = false;
      SIMILARITY_THRESHOLD = queryAnalysis.threshold;
      MIN_CHUNKS = 5;
      MAX_CHUNKS = 10;
      MAX_CONTEXT_TOKENS = 4000;
    }

    const CHARS_PER_TOKEN = 4;
    const MAX_CONTEXT_CHARS = MAX_CONTEXT_TOKENS * CHARS_PER_TOKEN;

    // Log query analysis results
    console.log(`
╔════════════════════════════════════════════════════════════════════
║ 📊 QUERY ANALYSIS RESULTS
╠════════════════════════════════════════════════════════════════════
║ Query: "${questionToAnalyze.substring(0, 100)}${questionToAnalyze.length > 100 ? '...' : ''}"
║ Strategy: ${queryAnalysis.strategy}
║ Reason: ${queryAnalysis.reason}
║ Full Document Mode: ${useFullDocument ? '✅ YES' : '❌ NO'}
║ Similarity Threshold: ${SIMILARITY_THRESHOLD}
║ Max Chunks: ${MAX_CHUNKS === 999999 ? 'ALL' : MAX_CHUNKS}
║ Max Context Tokens: ${MAX_CONTEXT_TOKENS}
╚════════════════════════════════════════════════════════════════════
`);

    // ---------- PROMPT BUILDING ----------
    let usedChunkIds = [];
    let storedQuestion = null;
    let finalPromptLabel = prompt_label;
    let provider = 'gemini';
    let finalPrompt = '';
    let adaptiveSystemContext = ''; // Will store adaptive instructions to be combined with database system prompt
    let templateData = { inputTemplate: null, outputTemplate: null, hasTemplates: false }; // Initialize templateData for use later

    // ================================
    // SECRET PROMPT HANDLING
    // ================================
    if (used_secret_prompt) {
      if (!secret_id) {
        return res.status(400).json({ error: 'secret_id required for secret prompt.' });
      }

      // Fetch secret metadata including template IDs
      const secretData = await fetchSecretManagerWithTemplates(secret_id);
      if (!secretData) {
        return res.status(404).json({ error: 'Secret configuration not found.' });
      }

      const { 
        name: secretName, 
        secret_manager_id, 
        version, 
        llm_name: dbLlmName,
        input_template_id,
        output_template_id
      } = secretData;
      finalPromptLabel = secretName;
      provider = resolveProviderName(llm_name || dbLlmName || 'gemini');

      const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
      const client = new SecretManagerServiceClient();
      const GCLOUD_PROJECT_ID = process.env.GCLOUD_PROJECT_ID;
      const gcpSecretName = `projects/${GCLOUD_PROJECT_ID}/secrets/${secret_manager_id}/versions/${version}`;
      const [accessResponse] = await client.accessSecretVersion({ name: gcpSecretName });
      let secretValue = accessResponse.payload.data.toString('utf8');

      // ✅ Fetch template files and their extracted data
      // templateData is already declared above, just update it here
      templateData = { inputTemplate: null, outputTemplate: null, hasTemplates: false };
      if (input_template_id || output_template_id) {
        console.log(`\n📄 [Secret Prompt] Fetching template files:`);
        console.log(`   Input Template ID: ${input_template_id || 'not set'}`);
        console.log(`   Output Template ID: ${output_template_id || 'not set'}\n`);
        
        templateData = await fetchTemplateFilesData(input_template_id, output_template_id);
        
        if (templateData.hasTemplates) {
          console.log(`✅ [Secret Prompt] Template files fetched successfully`);
          if (templateData.inputTemplate) {
            console.log(`   Input: ${templateData.inputTemplate.filename} (${templateData.inputTemplate.extracted_text?.length || 0} chars)`);
          }
          if (templateData.outputTemplate) {
            console.log(`   Output: ${templateData.outputTemplate.filename} (${templateData.outputTemplate.extracted_text?.length || 0} chars)`);
          }
          
          // Build enhanced prompt with template examples
          secretValue = buildEnhancedSystemPromptWithTemplates(secretValue, templateData);
          console.log(`✅ [Secret Prompt] Enhanced prompt built with template examples (${secretValue.length} chars)\n`);
        } else {
          console.log(`⚠️ [Secret Prompt] No template files found or available\n`);
        }
      }

      // ✅ ADD: Analyze if secret prompt needs full document
      const secretQueryAnalysis = analyzeQueryIntent(secretValue);
      const useFullDocumentForSecret = secretQueryAnalysis.needsFullDocument;

      console.log(`🔐 Secret prompt analysis mode: ${useFullDocumentForSecret ? 'FULL DOCUMENT' : 'TARGETED'}`);
      console.log(`🔐 Secret prompt strategy: ${secretQueryAnalysis.strategy} - ${secretQueryAnalysis.reason}`);

      let rankedChunks;

      if (useFullDocumentForSecret) {
        // GET ALL CHUNKS for secret prompt
        console.log(`📚 Fetching ALL chunks for secret prompt comprehensive analysis...`);
        const allChunks = await FileChunkModel.getChunksByFileId(file_id);
        if (!allChunks || allChunks.length === 0) {
          return res.status(400).json({ error: 'No content found in document.' });
        }
        rankedChunks = allChunks
          .sort((a, b) => {
            if ((a.page_start || 0) !== (b.page_start || 0)) {
              return (a.page_start || 0) - (b.page_start || 0);
            }
            return (a.chunk_index || 0) - (b.chunk_index || 0);
          })
          .map(chunk => ({ 
            ...chunk, 
            similarity: 1.0, 
            chunk_id: chunk.id, 
            distance: 0 
          }));
        
        console.log(`✅ Using all ${rankedChunks.length} chunks for secret prompt`);
      } else {
        // USE EMBEDDING SEARCH - Original logic
        console.log(`🔍 Performing semantic search for secret prompt...`);
        const secretEmbedding = await generateEmbedding(secretValue);
        rankedChunks = await ChunkVectorModel.findNearestChunks(
          secretEmbedding,
          MAX_CHUNKS,
          file_id
        );
      }

      if (!rankedChunks || rankedChunks.length === 0) {
        // Fallback: use all chunks if no vector matches
        console.log('⚠️ No chunks retrieved for secret prompt, using all chunks as fallback');
        const allChunks = await FileChunkModel.getChunksByFileId(file_id);
        rankedChunks = allChunks.map(c => ({ 
          ...c, 
          similarity: 0.5, 
          chunk_id: c.id, 
          distance: 0.5 
        }));
      }

      // ADAPTIVE FILTERING for secret prompts
      let selectedChunks;

      if (useFullDocumentForSecret) {
        // USE ALL CHUNKS - No filtering
        selectedChunks = rankedChunks;
        console.log(`📄 Using ALL ${selectedChunks.length} chunks for secret prompt comprehensive analysis`);
      } else {
        // APPLY SIMILARITY FILTERING
        const highQualityChunks = rankedChunks
          .filter(chunk => {
            const similarity = chunk.similarity || chunk.distance || 0;
            const score = similarity > 1 ? (1 / (1 + similarity)) : similarity;
            return score >= SIMILARITY_THRESHOLD;
          })
          .sort((a, b) => {
            const scoreA = a.similarity > 1 ? (1 / (1 + a.similarity)) : a.similarity;
            const scoreB = b.similarity > 1 ? (1 / (1 + b.similarity)) : b.similarity;
            return scoreB - scoreA;
          });

        console.log(`🎯 Filtered chunks: ${highQualityChunks.length}/${rankedChunks.length} above similarity threshold ${SIMILARITY_THRESHOLD}`);

        // Select chunks within token budget
        selectedChunks = [];
        let currentContextLength = 0;

        const chunksToConsider = highQualityChunks.length >= MIN_CHUNKS 
          ? highQualityChunks 
          : rankedChunks;

        for (const chunk of chunksToConsider) {
          if (selectedChunks.length >= MAX_CHUNKS) break;
          
          const chunkLength = chunk.content?.length || 0;
          if (currentContextLength + chunkLength <= MAX_CONTEXT_CHARS) {
            selectedChunks.push(chunk);
            currentContextLength += chunkLength;
          } else if (selectedChunks.length < MIN_CHUNKS) {
            const remainingSpace = MAX_CONTEXT_CHARS - currentContextLength;
            if (remainingSpace > 500) {
              selectedChunks.push({
                ...chunk,
                content: chunk.content.substring(0, remainingSpace - 100) + "..."
              });
              currentContextLength += remainingSpace;
            }
            break;
          }
        }

        // Ensure minimum chunks
        if (selectedChunks.length < MIN_CHUNKS && rankedChunks.length >= MIN_CHUNKS) {
          selectedChunks = rankedChunks.slice(0, MIN_CHUNKS);
        }
      }

      // Ensure chunks are in document order for full document mode
      if (useFullDocumentForSecret) {
        selectedChunks.sort((a, b) => {
          if ((a.page_start || 0) !== (b.page_start || 0)) {
            return (a.page_start || 0) - (b.page_start || 0);
          }
          return (a.chunk_index || 0) - (b.chunk_index || 0);
        });
      }

      const totalContextLength = selectedChunks.reduce((sum, c) => sum + (c.content?.length || 0), 0);
      const estimatedTokens = Math.ceil(totalContextLength / CHARS_PER_TOKEN);

      console.log(`✅ Final selection for secret prompt: ${selectedChunks.length} chunks | ${totalContextLength} chars (~${estimatedTokens} tokens)`);

      usedChunkIds = selectedChunks.map((c) => c.chunk_id || c.id);

      // Build comprehensive context for secret prompts
      const documentContext = selectedChunks
        .map((c, idx) => {
          let chunkHeader = `\n${'='.repeat(80)}\n`;
          
          if (useFullDocumentForSecret) {
            chunkHeader += `SECTION ${idx + 1} of ${selectedChunks.length}`;
            if (c.page_start) {
              chunkHeader += ` | Page ${c.page_start}`;
              if (c.page_end && c.page_end !== c.page_start) {
                chunkHeader += `-${c.page_end}`;
              }
            }
            if (c.heading) {
              chunkHeader += `\nHeading: ${c.heading}`;
            }
          } else {
            const similarity = c.similarity || c.distance || 0;
            const score = similarity > 1 ? (1 / (1 + similarity)) : similarity;
            chunkHeader += `CHUNK ${idx + 1} | Relevance: ${(score * 100).toFixed(1)}%`;
            if (c.page_start) {
              chunkHeader += ` | Page ${c.page_start}`;
            }
          }
          
          chunkHeader += `\n${'='.repeat(80)}\n\n`;
          
          return chunkHeader + (c.content || '');
        })
        .join('\n\n');

      // Build adaptive system instructions for secret prompts
      // Add JSON formatting instructions to secret prompt (pass output template if available)
      const outputTemplate = templateData?.outputTemplate || null;
      const formattedSecretValue = addSecretPromptJsonFormatting(secretValue, outputTemplate);
      adaptiveSystemContext = `
═══════════════════════════════════════════════════════════════════════
SECRET PROMPT ANALYSIS MODE: ${useFullDocumentForSecret ? 'COMPREHENSIVE (Full Document)' : 'TARGETED (Relevant Sections)'}
═══════════════════════════════════════════════════════════════════════

SECRET PROMPT INSTRUCTIONS:
${formattedSecretValue}

${useFullDocumentForSecret ? `
📚 FULL DOCUMENT ANALYSIS MODE ACTIVATED FOR SECRET PROMPT:

CRITICAL: You have been provided with the COMPLETE document content below.
You MUST:
- Analyze ALL sections comprehensively
- Extract EVERY relevant detail
- Follow the secret prompt instructions above for ALL sections of the document
- Extract complete timelines, all parties, all amounts, all legal provisions
` : `
🎯 TARGETED ANALYSIS MODE ACTIVATED FOR SECRET PROMPT:

CRITICAL: You have been provided with the MOST RELEVANT sections from the document.
You MUST:
- Focus on the specific question/task in the secret prompt
- Extract specific details from the provided sections
- If information seems incomplete, note that only relevant sections were provided
`}

${additional_input?.trim() ? `\n=== ADDITIONAL USER INSTRUCTIONS ===\n${additional_input.trim().substring(0, 500)}` : ''}

⚠️ STRICT COMPLIANCE: Follow ALL instructions above. The database system prompt takes precedence, but these secret prompt instructions are MANDATORY enhancements.
═══════════════════════════════════════════════════════════════════════
`;

      // Build user message with secret prompt question and document context only
      finalPrompt = `Analyze the document according to the secret prompt instructions provided in the system context.

${useFullDocumentForSecret ? 'COMPLETE DOCUMENT CONTENT:' : 'RELEVANT DOCUMENT SECTIONS:'}
${documentContext}`;

      storedQuestion = secretName;
    } 
    // ================================
    // CUSTOM QUESTION HANDLING
    // ================================
    else {
      if (!question?.trim()) {
        return res.status(400).json({ error: 'question is required.' });
      }

      storedQuestion = question.trim();

      // ✅ KEEP ORIGINAL LOGIC: Fetch LLM model from custom_query table for custom queries
      let dbLlmName = null;
      const customQueryLlm = `
        SELECT cq.llm_name, cq.llm_model_id
        FROM custom_query cq
        ORDER BY cq.id DESC
        LIMIT 1;
      `;
      const customQueryResult = await db.query(customQueryLlm);
      if (customQueryResult.rows.length > 0) {
        dbLlmName = customQueryResult.rows[0].llm_name;
        console.log(`🤖 Using LLM from custom_query table: ${dbLlmName}`);
      } else {
        console.warn(`⚠️ No LLM found in custom_query table — falling back to gemini`);
        dbLlmName = 'gemini';
      }

      // Resolve provider name using the LLM from custom_query table
      provider = resolveProviderName(dbLlmName || "gemini");
      console.log(`🤖 Resolved LLM provider for custom query: ${provider}`);
      
      // Check if provider is available
      const availableProviders = getAvailableProviders();
      if (!availableProviders[provider] || !availableProviders[provider].available) {
        console.warn(`⚠️ Provider '${provider}' unavailable — falling back to gemini`);
        provider = 'gemini';
      }

      // ADAPTIVE CHUNK SELECTION based on query intent
      let rankedChunks;

      if (useFullDocument) {
        // GET ALL CHUNKS - No embedding search needed
        console.log(`📚 Fetching ALL chunks for comprehensive analysis...`);
        const allChunks = await FileChunkModel.getChunksByFileId(file_id);
        
        if (!allChunks || allChunks.length === 0) {
          return res.status(400).json({ error: 'No content found in document.' });
        }
        
        // Sort by page/chunk order to maintain document flow
        rankedChunks = allChunks
          .sort((a, b) => {
            if (a.page_start !== b.page_start) {
              return (a.page_start || 0) - (b.page_start || 0);
            }
            return (a.chunk_index || 0) - (b.chunk_index || 0);
          })
          .map(chunk => ({
            ...chunk,
            similarity: 1.0, // Mark as fully relevant
            chunk_id: chunk.id,
            distance: 0
          }));
        
        console.log(`✅ Retrieved ${rankedChunks.length} chunks for full document analysis`);
      } else {
        // USE SEMANTIC SEARCH - Original logic
        console.log(`🔍 Performing semantic search for targeted query...`);
        const questionEmbedding = await generateEmbedding(storedQuestion);
        rankedChunks = await ChunkVectorModel.findNearestChunks(
          questionEmbedding,
          MAX_CHUNKS,
          file_id
        );
      }

      if (!rankedChunks || rankedChunks.length === 0) {
        // Fallback: use all chunks if no vector matches
        console.log('⚠️ No chunks retrieved, using all chunks as fallback');
        const allChunks = await FileChunkModel.getChunksByFileId(file_id);
        rankedChunks = allChunks.map(c => ({ ...c, similarity: 0.5, chunk_id: c.id, distance: 0.5 }));
      }

      // ADAPTIVE FILTERING based on query intent
      let selectedChunks;

      if (useFullDocument) {
        // USE ALL CHUNKS - No filtering
        selectedChunks = rankedChunks;
        console.log(`📄 Using ALL ${selectedChunks.length} chunks for comprehensive analysis`);
      } else {
        // APPLY SIMILARITY FILTERING - Original logic
        const highQualityChunks = rankedChunks
          .filter(chunk => {
            const similarity = chunk.similarity || chunk.distance || 0;
            const score = similarity > 1 ? (1 / (1 + similarity)) : similarity;
            return score >= SIMILARITY_THRESHOLD;
          })
          .sort((a, b) => {
            const scoreA = a.similarity > 1 ? (1 / (1 + a.similarity)) : a.similarity;
            const scoreB = b.similarity > 1 ? (1 / (1 + b.similarity)) : b.similarity;
            return scoreB - scoreA;
          });

        console.log(`🎯 Filtered chunks: ${highQualityChunks.length}/${rankedChunks.length} above similarity threshold ${SIMILARITY_THRESHOLD}`);

        // Select chunks within token budget
        selectedChunks = [];
        let currentContextLength = 0;

        const chunksToConsider = highQualityChunks.length >= MIN_CHUNKS 
          ? highQualityChunks 
          : rankedChunks;

        for (const chunk of chunksToConsider) {
          if (selectedChunks.length >= MAX_CHUNKS) break;
          
          const chunkLength = chunk.content.length;
          if (currentContextLength + chunkLength <= MAX_CONTEXT_CHARS) {
            selectedChunks.push(chunk);
            currentContextLength += chunkLength;
          } else if (selectedChunks.length < MIN_CHUNKS) {
            const remainingSpace = MAX_CONTEXT_CHARS - currentContextLength;
            if (remainingSpace > 500) {
              selectedChunks.push({
                ...chunk,
                content: chunk.content.substring(0, remainingSpace - 100) + "..."
              });
              currentContextLength += remainingSpace;
            }
            break;
          }
        }

        // Ensure minimum chunks
        if (selectedChunks.length < MIN_CHUNKS && rankedChunks.length >= MIN_CHUNKS) {
          selectedChunks = rankedChunks.slice(0, MIN_CHUNKS);
        }
      }

      // Calculate actual context size
      const totalContextLength = selectedChunks.reduce((sum, c) => sum + (c.content?.length || 0), 0);
      const estimatedTokens = Math.ceil(totalContextLength / CHARS_PER_TOKEN);

      console.log(`✅ Final selection: ${selectedChunks.length} chunks | ${totalContextLength} chars (~${estimatedTokens} tokens)`);

      // Ensure chunks are in document order for full document mode
      if (useFullDocument) {
        selectedChunks.sort((a, b) => {
          if ((a.page_start || 0) !== (b.page_start || 0)) {
            return (a.page_start || 0) - (b.page_start || 0);
          }
          return (a.chunk_index || 0) - (b.chunk_index || 0);
        });
      }

      usedChunkIds = selectedChunks.map((c) => c.chunk_id || c.id);

      // Build comprehensive document context
      const documentContext = selectedChunks
        .map((c, idx) => {
          let chunkHeader = `\n${'='.repeat(80)}\n`;
          
          if (useFullDocument) {
            // For full document mode, show document structure
            chunkHeader += `SECTION ${idx + 1} of ${selectedChunks.length}`;
            if (c.page_start) {
              chunkHeader += ` | Page ${c.page_start}`;
              if (c.page_end && c.page_end !== c.page_start) {
                chunkHeader += `-${c.page_end}`;
              }
            }
            if (c.heading) {
              chunkHeader += `\nHeading: ${c.heading}`;
            }
          } else {
            // For targeted mode, show relevance
            const similarity = c.similarity || c.distance || 0;
            const score = similarity > 1 ? (1 / (1 + similarity)) : similarity;
            chunkHeader += `CHUNK ${idx + 1} | Relevance: ${(score * 100).toFixed(1)}%`;
            if (c.page_start) {
              chunkHeader += ` | Page ${c.page_start}`;
            }
          }
          
          chunkHeader += `\n${'='.repeat(80)}\n\n`;
          
          return chunkHeader + (c.content || '');
        })
        .join('\n\n');

      // Build adaptive system instructions that will be combined with database system prompt
      // These instructions enhance the database system prompt based on query intent
      // Store in a variable to pass as context to askLLM
      const adaptiveInstructions = `
═══════════════════════════════════════════════════════════════════════
DOCUMENT ANALYSIS MODE: ${useFullDocument ? 'COMPREHENSIVE (Full Document)' : 'TARGETED (Relevant Sections)'}
═══════════════════════════════════════════════════════════════════════

${useFullDocument ? `
📚 FULL DOCUMENT ANALYSIS MODE ACTIVATED:

You have been provided with the COMPLETE document content below.
You MUST:
- Analyze ALL sections comprehensively
- Extract EVERY relevant detail mentioned in the document
- Organize information logically with clear headings and structure
- Include ALL dates, amounts, names, references, and specific details
- Do NOT skip any important information
- Extract complete timelines, all parties, all amounts, all legal provisions
` : `
🎯 TARGETED ANALYSIS MODE ACTIVATED:

You have been provided with the MOST RELEVANT sections from the document.
You MUST:
- Focus on answering the specific question asked
- Extract specific details from the provided sections
- If information seems incomplete, note that only relevant sections were provided
`}

CRITICAL EXTRACTION REQUIREMENTS:

1. Extract EXACT information - use direct quotes for:
   - Party names (full legal names)
   - Case numbers, document references
   - Dates (format: DD.MM.YYYY)
   - Monetary amounts (with currency)
   - Legal provisions, section numbers, clause references

2. Structure your response with:
   - Clear section headings (use ## for main sections)
   - Bullet points for lists
   - Tables for comparative data (use markdown tables)
   - Chronological timelines for events
   - Numbered lists for legal grounds/arguments

3. If information is NOT found, explicitly state "NOT MENTIONED IN DOCUMENT"

4. Maintain document context:
   - Reference page numbers when citing information
   - Note which section information came from
   - Preserve relationships between facts

5. Be comprehensive but organized:
   - Start with document identification (type, parties, date)
   - Then provide structured analysis
   - End with summary of key takeaways

⚠️ STRICT COMPLIANCE: Follow ALL instructions above. The database system prompt takes precedence, but these adaptive instructions are MANDATORY enhancements for this query type.
═══════════════════════════════════════════════════════════════════════
`;

      // Build user message with question and document context only
      // Adaptive instructions will be passed as system context to ensure strict compliance with database system prompt
      finalPrompt = `${storedQuestion}

${useFullDocument ? 'COMPLETE DOCUMENT CONTENT:' : 'RELEVANT DOCUMENT SECTIONS:'}
${documentContext}`;
      
      // Store adaptive instructions to pass as context parameter to askLLM
      // This ensures database system prompt is used as primary, with our instructions as enhancement
      const adaptiveSystemContext = adaptiveInstructions;
    }

    // ✅ CRITICAL: Append conversation history to the prompt
    finalPrompt = appendConversationToPrompt(finalPrompt, conversationContext);

    // ✅ CRITICAL: Append user professional profile context to the prompt
    try {
      // Check if user is asking about their profile
      const isProfileQuestion = /(my|my own|my personal|my professional|give me|show me|tell me about|what is|what are).*(profile|professional|legal|credentials|bar|jurisdiction|practice|role|experience|details)/i.test(storedQuestion);
      
      console.log(`[chatWithDocument] Profile question detected: ${isProfileQuestion} for question: "${storedQuestion}"`);
      
      let profileContext;
      if (isProfileQuestion) {
        // For profile questions, get detailed profile information
        console.log(`[chatWithDocument] Fetching detailed profile context for user ${userId}...`);
        profileContext = await UserProfileService.getDetailedProfileContext(userId, req.headers.authorization);
        if (!profileContext) {
          console.log(`[chatWithDocument] Detailed profile context not available, trying regular context...`);
          // Fallback to regular context if detailed not available
          profileContext = await UserProfileService.getProfileContext(userId, req.headers.authorization);
        }
      } else {
        // For regular questions, use standard context
        profileContext = await UserProfileService.getProfileContext(userId, req.headers.authorization);
      }
      
      if (profileContext) {
        // Prepend profile context BEFORE the question so AI sees it first
        finalPrompt = `${profileContext}\n\nUSER QUESTION:\n${finalPrompt}`;
        console.log(`[chatWithDocument] ✅ Added user professional profile context to prompt (detailed: ${isProfileQuestion}, length: ${profileContext.length} chars)`);
      } else {
        console.warn(`[chatWithDocument] ⚠️ No profile context available for user ${userId}`);
      }
    } catch (profileError) {
      console.error(`[chatWithDocument] ❌ Failed to fetch profile context:`, profileError.message);
      console.error(`[chatWithDocument] Error stack:`, profileError.stack);
      // Continue without profile context - don't fail the request
    }

    // ---------- CONTEXT SIZE VALIDATION ----------
    const estimatedPromptTokens = Math.ceil(finalPrompt.length / CHARS_PER_TOKEN);
    const MODEL_CONTEXT_LIMITS = {
      'gemini': 1000000,      // Gemini 1.5 Pro has 1M context
      'gemini-pro-2.5': 2000000, // Gemini 2.5 Pro has 2M context
      'gemini-3-pro': 1000000,   // Gemini 3.0 Pro has 1M context
      'claude-sonnet-4': 200000, // Claude Sonnet 4 has 200K context
      'claude-opus-4-1': 200000, // Claude Opus 4.1 has 200K context
      'claude-sonnet-4-5': 200000, // Claude Sonnet 4.5 has 200K context
      'claude-haiku-4-5': 200000,  // Claude Haiku 4.5 has 200K context
      'claude': 200000,        // Claude has 200K context
      'anthropic': 200000,     // Anthropic has 200K context
      'gpt-4o': 128000,        // GPT-4 Turbo has 128K context
      'openai': 128000,        // OpenAI has 128K context
      'default': 8000
    };

    const modelLimit = MODEL_CONTEXT_LIMITS[provider] || MODEL_CONTEXT_LIMITS['default'];
    const safeLimit = Math.floor(modelLimit * 0.8); // Use 80% of limit for safety

    if (estimatedPromptTokens > safeLimit) {
      console.warn(`⚠️ Prompt is ${estimatedPromptTokens} tokens, which exceeds safe limit ${safeLimit} for ${provider}`);
      
      if (useFullDocument && !used_secret_prompt) {
        // Fallback: Switch to targeted mode if full document exceeds limits
        console.log(`⚠️ Falling back to targeted mode due to context size`);
        useFullDocument = false;
        
        // Re-run chunk selection with targeted mode
        const questionEmbedding = await generateEmbedding(storedQuestion);
        const fallbackRankedChunks = await ChunkVectorModel.findNearestChunks(
          questionEmbedding,
          10,
          file_id
        );
        
        // Re-select chunks within budget
        const fallbackSelectedChunks = fallbackRankedChunks.slice(0, 10);
        usedChunkIds = fallbackSelectedChunks.map(c => c.chunk_id || c.id);
        
        // Rebuild prompt with smaller context
        const fallbackDocumentContext = fallbackSelectedChunks
          .map((c, idx) => {
            const similarity = c.similarity || c.distance || 0;
            const score = similarity > 1 ? (1 / (1 + similarity)) : similarity;
            return `--- Chunk ${idx + 1} | Relevance: ${(score * 100).toFixed(1)}% ---\n${c.content || ''}`;
          })
          .join('\n\n');
        
        finalPrompt = `${storedQuestion}\n\n=== RELEVANT CONTEXT ===\n${fallbackDocumentContext}`;
        
        // Re-append conversation history
        finalPrompt = appendConversationToPrompt(finalPrompt, conversationContext);
        
        // Re-append profile context if it was added
        try {
          const isProfileQuestion = /(my|my own|my personal|my professional|give me|show me|tell me about|what is|what are).*(profile|professional|legal|credentials|bar|jurisdiction|practice|role|experience|details)/i.test(storedQuestion);
          let profileContext;
          if (isProfileQuestion) {
            profileContext = await UserProfileService.getDetailedProfileContext(userId, req.headers.authorization);
            if (!profileContext) {
              profileContext = await UserProfileService.getProfileContext(userId, req.headers.authorization);
            }
          } else {
            profileContext = await UserProfileService.getProfileContext(userId, req.headers.authorization);
          }
          
          if (profileContext) {
            finalPrompt = `${profileContext}\n\nUSER QUESTION:\n${finalPrompt}`;
          }
        } catch (profileError) {
          console.warn(`⚠️ Failed to re-add profile context in fallback mode`);
        }
        
        const newEstimatedTokens = Math.ceil(finalPrompt.length / CHARS_PER_TOKEN);
        console.log(`✅ Fallback prompt: ${newEstimatedTokens} tokens (${((newEstimatedTokens/modelLimit)*100).toFixed(1)}% of model limit)`);
      } else {
        // For secret prompts or targeted mode, just truncate the prompt
        console.log(`⚠️ Truncating prompt to fit within model limits`);
        const maxChars = safeLimit * CHARS_PER_TOKEN;
        if (finalPrompt.length > maxChars) {
          finalPrompt = finalPrompt.substring(0, maxChars - 200) + '\n\n[Content truncated due to context size limits...]';
          const truncatedTokens = Math.ceil(finalPrompt.length / CHARS_PER_TOKEN);
          console.log(`✅ Truncated prompt: ${truncatedTokens} tokens (${((truncatedTokens/modelLimit)*100).toFixed(1)}% of model limit)`);
        }
      }
    } else {
      console.log(`📝 Final prompt: ${estimatedPromptTokens} tokens (${((estimatedPromptTokens/modelLimit)*100).toFixed(1)}% of model limit)`);
    }

    // ---------- CALL LLM ----------
    console.log(`[chatWithDocument] Calling LLM provider: ${provider} | Chunks used: ${usedChunkIds.length}`);
    if (adaptiveSystemContext) {
      console.log(`[chatWithDocument] ✅ Passing adaptive system context (${adaptiveSystemContext.length} chars) to be combined with database system prompt`);
    }
    // Pass adaptive system context as the context parameter so it gets combined with database system prompt
    // Pass the original user question separately so web search only uses that, not the full prompt
    let answer = await askLLM(provider, finalPrompt, adaptiveSystemContext || '', '', storedQuestion);
    
    // For secret prompts, preserve JSON structure; for regular queries, convert to plain text
    if (used_secret_prompt && templateData?.outputTemplate) {
      // Post-process to ensure proper JSON format
      answer = postProcessSecretPromptResponse(answer, templateData.outputTemplate);
    } else {
      answer = ensurePlainTextAnswer(answer);
    }

    if (!answer?.trim()) {
      return res.status(500).json({ error: 'Empty response from AI.' });
    }

    console.log(`[chatWithDocument] Received answer, length: ${answer.length} characters`);

    // ---------- SAVE CHAT ----------
    const savedChat = await FileChat.saveChat(
      file_id,
      userId,
      storedQuestion,
      answer,
      finalSessionId,
      usedChunkIds,
      used_secret_prompt,
      finalPromptLabel,
      used_secret_prompt ? secret_id : null,
      historyForStorage  // ✅ This includes both pre-upload and post-upload context
    );

    console.log(`[chatWithDocument] Chat saved with ID: ${savedChat.id} | Chunks used: ${usedChunkIds.length}`);

    // ---------- TOKEN USAGE ----------
    try {
      const { userUsage, userPlan, requestedResources } = req;
      await TokenUsageService.incrementUsage(userId, requestedResources, userUsage, userPlan);
    } catch (e) {
      console.warn('Token usage increment failed:', e.message);
    }

    // ---------- FETCH HISTORY ----------
    const historyRows = await FileChat.getChatHistory(file_id, savedChat.session_id);
    const history = historyRows.map((row) => ({
      id: row.id,
      file_id: row.file_id,
      session_id: row.session_id,
      question: row.question,
      answer: row.answer,
      used_secret_prompt: row.used_secret_prompt || false,
      prompt_label: row.prompt_label || null,
      secret_id: row.secret_id || null,
      used_chunk_ids: row.used_chunk_ids || [],
      confidence: row.confidence || 0.8,
      timestamp: row.created_at || row.timestamp,
      chat_history: row.chat_history || [],
      display_text_left_panel: row.used_secret_prompt
        ? `Analysis: ${row.prompt_label || 'Secret Prompt'}`
        : row.question,
    }));

    // ---------- RETURN COMPLETE RESPONSE ----------
    return res.status(200).json({
      success: true,
      session_id: savedChat.session_id,
      message_id: savedChat.id,
      answer,
      response: answer,
      history,
      used_chunk_ids: usedChunkIds,
      chunks_used: usedChunkIds.length,
      confidence: used_secret_prompt ? 0.9 : 0.85,
      timestamp: savedChat.created_at || new Date().toISOString(),
      llm_provider: provider,
      used_secret_prompt,
      mode: 'post_document',  // Indicates this is a post-upload conversation
    });
  } catch (error) {
    console.error('❌ Error in chatWithDocument:', error);
    console.error('Stack trace:', error.stack);
    return res.status(500).json({
      error: 'Failed to get AI answer.',
      details: error.message,
    });
  }
};

// ---------------------------
// SSE Streaming Version of chatWithDocument
// Handles unlimited length responses with heartbeat to prevent timeout
// ---------------------------
exports.chatWithDocumentStream = async (req, res) => {
  let userId = null;
  const heartbeat = setInterval(() => {
    try {
      res.write(`data: [PING]\n\n`);
    } catch (err) {
      // Connection closed, stop heartbeat
      clearInterval(heartbeat);
    }
  }, 15000);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    // Send initial metadata
    res.write(`data: ${JSON.stringify({ type: 'metadata', status: 'streaming_started' })}\n\n`);

    // Reuse the non-streaming function's logic but intercept the LLM call
    // We'll build the prompt the same way, then stream instead of waiting for full response
    const {
      file_id,
      question,
      used_secret_prompt = false,
      prompt_label = null,
      session_id = null,
      secret_id,
      llm_name,
      additional_input = '',
    } = req.body;

    userId = req.user.id;

    // Call a helper that builds the prompt (we'll extract this logic)
    // For now, let's create a wrapper that calls chatWithDocument but intercepts the LLM call
    
    // Create a mock response object to capture the prompt building
    let capturedPrompt = null;
    let capturedProvider = null;
    let capturedStoredQuestion = null;
    let capturedAdaptiveContext = null;
    let capturedUsedChunkIds = [];
    let capturedFileId = file_id;
    let capturedSessionId = session_id;
    let capturedUsedSecretPrompt = used_secret_prompt;
    let capturedFinalPromptLabel = prompt_label;
    let capturedSecretId = secret_id;
    let capturedHistoryForStorage = [];

    // We need to duplicate the prompt building logic but use streamLLM
    // For now, let's create a simplified version that works
    
    // Validate and get session
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const hasFileId = Boolean(file_id);
    const hasExistingSession = session_id && uuidRegex.test(session_id);
    const finalSessionId = hasExistingSession ? session_id : uuidv4();

    console.log(`[chatWithDocumentStream] Streaming started: file_id=${file_id}, session_id=${finalSessionId}`);

    // For simplicity, let's call the existing chatWithDocument logic but replace askLLM with streamLLM
    // We'll need to modify the approach - let's create a modified version that streams
    
    // Build prompt using existing logic (simplified approach)
    // Actually, the best approach is to extract prompt building into a helper
    // But for now, let's use a workaround: call chatWithDocument with a modified askLLM
    
    // Temporary: Use the non-streaming version but stream the result
    // This is not ideal but will work for now
    let fullAnswer = '';
    let streamingError = null;

    try {
      // We need to build the prompt ourselves or extract it
      // For now, let's use a simpler approach: call the existing function but capture the answer
      // and stream it chunk by chunk
      
      // Actually, the cleanest solution is to extract prompt building
      // But for immediate fix, let's stream the response from askLLM by wrapping it
      
      // Create a streaming wrapper
      let promptBuilt = false;
      
      // We'll need to intercept at the askLLM call level
      // For now, let's implement a basic streaming version that works
      
      // Simplified streaming implementation:
      // 1. Build prompt (reuse existing logic)
      // 2. Call streamLLM instead of askLLM
      // 3. Stream chunks to client
      // 4. Save chat after completion
      
      // For immediate fix, let's use the existing chatWithDocument but modify it to stream
      // We'll create a custom version that uses streamLLM
      
      // Actually, the best approach is to duplicate the prompt building logic
      // But that's 1000+ lines. Let's use a different strategy:
      
      // Strategy: Call chatWithDocument but replace askLLM with a streaming version
      // We can do this by temporarily replacing the askLLM import
      
      // For now, let's implement a minimal working version:
      // We'll build a simplified prompt and stream it
      
      if (!hasFileId) {
        // Pre-upload chat - simplified
        if (!question?.trim()) {
          clearInterval(heartbeat);
          res.write(`data: ${JSON.stringify({ type: 'error', message: 'question is required when no document is provided.' })}\n\n`);
          res.end();
          return;
        }

        let dbLlmName = llm_name;
        if (!dbLlmName) {
          const customQueryLlm = `
            SELECT cq.llm_name, cq.llm_model_id
            FROM custom_query cq
            ORDER BY cq.id DESC
            LIMIT 1;
          `;
          const customQueryResult = await db.query(customQueryLlm);
          if (customQueryResult.rows.length > 0) {
            dbLlmName = customQueryResult.rows[0].llm_name;
          } else {
            dbLlmName = 'gemini';
          }
        }

        let provider = resolveProviderName(dbLlmName || 'gemini');
        const availableProviders = getAvailableProviders();
        if (!availableProviders[provider] || !availableProviders[provider].available) {
          provider = 'gemini';
        }

        const userPrompt = question.trim();
        const sessionHistory = hasExistingSession
          ? await FileChat.getChatHistoryBySession(userId, finalSessionId)
          : [];
        const conversationContext = formatConversationHistory(sessionHistory);
        let finalPrompt = appendConversationToPrompt(userPrompt, conversationContext);

        // Add profile context
        try {
          const isProfileQuestion = /(my|my own|my personal|my professional|give me|show me|tell me about|what is|what are).*(profile|professional|legal|credentials|bar|jurisdiction|practice|role|experience|details)/i.test(userPrompt);
          let profileContext;
          if (isProfileQuestion) {
            profileContext = await UserProfileService.getDetailedProfileContext(userId, req.headers.authorization);
            if (!profileContext) {
              profileContext = await UserProfileService.getProfileContext(userId, req.headers.authorization);
            }
          } else {
            profileContext = await UserProfileService.getProfileContext(userId, req.headers.authorization);
          }
          if (profileContext) {
            finalPrompt = `${profileContext}\n\nUSER QUESTION:\n${finalPrompt}`;
          }
        } catch (profileError) {
          console.error(`[chatWithDocumentStream] Failed to fetch profile context:`, profileError.message);
        }

        // Stream the response
        res.write(`data: ${JSON.stringify({ type: 'metadata', session_id: finalSessionId })}\n\n`);
        
        let fullAnswer = '';
        try {
          for await (const chunk of streamLLM(provider, finalPrompt, '', '', userPrompt)) {
            fullAnswer += chunk;
            res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
        // CRITICAL: Flush immediately to send chunk to frontend without buffering
        if (res.flush && typeof res.flush === 'function') {
          res.flush();
        }
            // CRITICAL: Flush immediately to send chunk to frontend without buffering
            // This ensures true streaming (word-by-word) instead of clumped delivery
            if (res.flush && typeof res.flush === 'function') {
              res.flush();
            }
          }
        } catch (streamError) {
          console.error('[chatWithDocumentStream] Streaming error:', streamError);
          clearInterval(heartbeat);
          res.write(`data: ${JSON.stringify({ type: 'error', message: 'Streaming failed', details: streamError.message })}\n\n`);
          res.end();
          return;
        }

        // Save chat
        const savedChat = await FileChat.saveChat(
          null,
          userId,
          userPrompt,
          fullAnswer,
          finalSessionId,
          [],
          false,
          null,
          null,
          simplifyHistory(sessionHistory)
        );

        // Send completion
        res.write(`data: ${JSON.stringify({ 
          type: 'done', 
          session_id: savedChat.session_id, 
          message_id: savedChat.id,
          answer: fullAnswer,
          llm_provider: provider
        })}\n\n`);
        res.write(`data: [DONE]\n\n`);

        clearInterval(heartbeat);
        res.end();
        return;
      }

      // Post-upload chat - we need the full prompt building logic
      // For now, let's use a workaround: call chatWithDocument but stream the result
      // This requires modifying how we handle the response
      
      // Better approach: Extract the key parts we need
      const file = await DocumentModel.getFileById(file_id);
      if (!file) {
        clearInterval(heartbeat);
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'File not found.' })}\n\n`);
        res.end();
        return;
      }
      if (String(file.user_id) !== String(userId)) {
        clearInterval(heartbeat);
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'Access denied.' })}\n\n`);
        res.end();
        return;
      }
      if (file.status !== 'processed') {
        clearInterval(heartbeat);
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'Document is not yet processed.', status: file.status })}\n\n`);
        res.end();
        return;
      }

      // Post-upload chat - use existing logic but stream the response
      // Strategy: Call chatWithDocument with a mock response that captures the answer
      // Then stream it back to the client
      
      console.log('[chatWithDocumentStream] Post-upload: using streaming wrapper');
      
      let capturedData = null;
      let captureError = null;
      
      // Create mock response to capture the JSON response
      // Must have all methods that chatWithDocument might call
      const mockRes = {
        status: (code) => {
          mockRes.statusCode = code;
          return mockRes;
        },
        json: (data) => {
          capturedData = data;
          return mockRes;
        },
        setHeader: () => mockRes,
        writeHead: () => mockRes,
        end: () => {},
        headersSent: false,
        statusCode: 200
      };

      // Call the non-streaming version to build prompt and get answer
      // Create a properly structured mock request that preserves all original request properties
      // CRITICAL: Preserve headers object with all properties including authorization
      const mockReq = {
        ...req,
        headers: {
          ...(req.headers || {}),
          authorization: req.headers?.authorization || req.header?.('authorization') || ''
        },
        user: req.user || {},
        body: req.body || {},
        params: req.params || {},
        query: req.query || {}
      };

      try {
        // chatWithDocument expects (req, res) - pass both
        await exports.chatWithDocument(mockReq, mockRes);
      } catch (err) {
        captureError = err;
      }

      if (captureError) {
        clearInterval(heartbeat);
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'Failed to process request', details: captureError.message })}\n\n`);
        res.end();
        return;
      }

      if (!capturedData || !capturedData.answer) {
        clearInterval(heartbeat);
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'No answer received' })}\n\n`);
        res.end();
        return;
      }

      // Stream the captured answer
      res.write(`data: ${JSON.stringify({ type: 'metadata', session_id: capturedData.session_id })}\n\n`);
      
      // Stream answer character by character for smooth streaming effect
      // ✅ Ensure answer is plain text, not JSON
      let answer = ensurePlainTextAnswer(capturedData.answer);
      const chunkSize = 10; // Stream 10 characters at a time
      for (let i = 0; i < answer.length; i += chunkSize) {
        const chunk = answer.substring(i, Math.min(i + chunkSize, answer.length));
        res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
        // CRITICAL: Flush immediately to send chunk to frontend without buffering
        if (res.flush && typeof res.flush === 'function') {
          res.flush();
        }
        // Small delay for streaming effect
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      // Send completion
      res.write(`data: ${JSON.stringify({ 
        type: 'done', 
        session_id: capturedData.session_id, 
        message_id: capturedData.message_id,
        answer: answer, // ✅ Send plain text answer
        llm_provider: capturedData.llm_provider,
        used_chunk_ids: capturedData.used_chunk_ids,
        chunks_used: capturedData.chunks_used
      })}\n\n`);
      res.write(`data: [DONE]\n\n`);
      clearInterval(heartbeat);
      res.end();
      
    } catch (error) {
      console.error('❌ Error in chatWithDocumentStream:', error);
      clearInterval(heartbeat);
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Failed to get AI answer.', details: error.message })}\n\n`);
      res.end();
    }
  } catch (error) {
    console.error('❌ Error in chatWithDocumentStream:', error);
    clearInterval(heartbeat);
    if (!res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Failed to get AI answer.', details: error.message })}\n\n`);
    }
    res.end();
  }
};

exports.saveEditedDocument = async (req, res) => {
 try {
 const { file_id, edited_html } = req.body;
 if (!file_id || typeof edited_html !== "string") {
 return res
 .status(400)
 .json({ error: "file_id and edited_html are required." });
 }

 const file = await DocumentModel.getFileById(file_id);
 if (!file || file.user_id !== req.user.id) {
 return res
 .status(403)
 .json({ error: "Access denied or file not found." });
 }

 const docxBuffer = await convertHtmlToDocx(edited_html);
 const pdfBuffer = await convertHtmlToPdf(edited_html);

 const { gsUri: docxUrl } = await uploadToGCS(
 `edited_${file_id}.docx`,
 docxBuffer,
 "edited",
 false,
 "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
 );
 const { gsUri: pdfUrl } = await uploadToGCS(
 `edited_${file_id}.pdf`,
 pdfBuffer,
 "edited",
 false,
 "application/pdf"
 );

 await DocumentModel.saveEditedVersions(file_id, docxUrl, pdfUrl);

 return res.json({ docx_download_url: docxUrl, pdf_download_url: pdfUrl });
 } catch (error) {
 console.error("❌ saveEditedDocument error:", error);
 return res.status(500).json({ error: "Failed to save edited document." });
 }
};

/**
 * @description Generates a signed URL to download a specific format (DOCX or PDF) of an edited document.
 * @route GET /api/doc/download/:file_id/:format
 */
exports.downloadDocument = async (req, res) => {
 try {
 const { file_id, format } = req.params;
 if (!file_id || !format)
 return res
 .status(400)
 .json({ error: "file_id and format are required." });
 if (!["docx", "pdf"].includes(format))
 return res
 .status(400)
 .json({ error: "Invalid format. Use docx or pdf." });

 const file = await DocumentModel.getFileById(file_id);
 if (!file) return res.status(404).json({ error: "File not found." });
 if (file.user_id !== req.user.id)
 return res.status(403).json({ error: "Access denied" });

 const targetUrl =
 format === "docx" ? file.edited_docx_path : file.edited_pdf_path;
 if (!targetUrl)
 return res
 .status(404)
 .json({ error: "File not found or not yet generated" });

 const gcsKey = normalizeGcsKey(targetUrl, process.env.GCS_BUCKET);
 if (!gcsKey)
 return res.status(500).json({ error: "Invalid GCS path for the file." });

 const signedUrl = await getSignedUrl(gcsKey);
 return res.redirect(signedUrl);
 } catch (error) {
 console.error("❌ Error generating signed URL:", error);
 return res
 .status(500)
 .json({ error: "Failed to generate signed download link" });
 }
};

/**
 * @description Retrieves the chat history for a specific document.
 * @route GET /api/doc/chat-history/:file_id
 */
exports.getChatHistory = async (req, res) => {
 try {
 const userId = req.user.id;

 // ✅ Fetch all chats for this user (grouped by session)
 const chats = await FileChat.getChatHistoryByUserId(userId);

 if (!chats || chats.length === 0) {
 return res.status(404).json({ error: "No chat history found for this user." });
 }

 // ✅ Group chats by session_id for better organization
 const sessions = chats.reduce((acc, chat) => {
 if (!acc[chat.session_id]) {
 acc[chat.session_id] = {
 session_id: chat.session_id,
 file_id: chat.file_id || null,
 filename: chat.filename || null,
 user_id: chat.user_id,
 messages: []
 };
 } else {
 // Update filename and file_id if they are null but this chat has them
 // This ensures we get the filename even if the first chat in a session didn't have it
 if (!acc[chat.session_id].filename && chat.filename) {
 acc[chat.session_id].filename = chat.filename;
 }
 if (!acc[chat.session_id].file_id && chat.file_id) {
 acc[chat.session_id].file_id = chat.file_id;
 }
 }

 acc[chat.session_id].messages.push({
 id: chat.id,
 question: chat.question,
 answer: chat.answer,
 used_chunk_ids: chat.used_chunk_ids,
 used_secret_prompt: chat.used_secret_prompt,
 prompt_label: chat.prompt_label,
 created_at: chat.created_at
 });

 return acc;
 }, {});

 // ✅ Final pass: Ensure we have the best filename for each session
 // Look through all chats in each session to find the first non-null filename
 const sessionArray = Object.values(sessions);
 for (const session of sessionArray) {
 // Ensure filename is always a string or null, never undefined
 if (!session.filename || session.filename === undefined) {
 // Find the first chat in this session that has a filename
 const sessionChats = chats.filter(c => c.session_id === session.session_id && c.filename);
 if (sessionChats.length > 0 && sessionChats[0].filename) {
 session.filename = sessionChats[0].filename;
 // Also update file_id if we found a filename but file_id was null
 if (!session.file_id && sessionChats[0].file_id) {
 session.file_id = sessionChats[0].file_id;
 }
 } else {
 // Explicitly set to null if no filename found (not undefined)
 session.filename = null;
 }
 }
 }

 return res.json(Object.values(sessions));
 } catch (error) {
 console.error("❌ getChatHistory error:", error);
 return res.status(500).json({ error: "Failed to fetch chat history." });
 }
};



async function processBatchResults(file_id, job) {
  try {
    console.log(
      `[processBatchResults] Starting background post-processing for file: ${file_id}`
    );

    // Step 7: Validate extracted text (42-45%)
    await updateProcessingProgress(
      file_id,
      "processing",
      43.0,
      "Validating extracted text"
    );

    const bucketName = process.env.GCS_OUTPUT_BUCKET_NAME;
    
    if (!bucketName) {
      throw new Error("GCS_OUTPUT_BUCKET_NAME environment variable is not set");
    }
    
    if (!job.gcs_output_uri_prefix) {
      throw new Error(`No output URI prefix found in job for file ${file_id}`);
    }
    
    // Extract prefix from gs:// URI
    let prefix = job.gcs_output_uri_prefix;
    if (prefix.startsWith('gs://')) {
      prefix = prefix.replace(`gs://${bucketName}/`, "");
    }
    
    // Ensure prefix ends with / for proper directory matching
    if (!prefix.endsWith('/')) {
      prefix += '/';
    }
    
    console.log(`[processBatchResults] Fetching results from bucket: ${bucketName}, prefix: ${prefix}`);
    console.log(`[processBatchResults] Full output URI: ${job.gcs_output_uri_prefix}`);
    
    const extractedBatchTexts = await fetchBatchResults(bucketName, prefix);

    // Enhanced validation with detailed logging
    console.log(`[processBatchResults] Extracted ${extractedBatchTexts.length} text segments`);
    if (extractedBatchTexts.length > 0) {
      const nonEmptySegments = extractedBatchTexts.filter(item => item.text && item.text.trim());
      console.log(`[processBatchResults] Non-empty segments: ${nonEmptySegments.length}`);
      if (nonEmptySegments.length > 0) {
        console.log(`[processBatchResults] Sample text (first 100 chars): ${nonEmptySegments[0].text.substring(0, 100)}`);
      }
    }

    // ✅ NEW: Extract plain text and save to output bucket with file ID as filename
    try {
      // Combine all extracted text segments into a single plain text string
      const plainText = extractedBatchTexts
        .map(segment => segment.text || '')
        .filter(text => text.trim())
        .join('\n\n');
      
      if (plainText && plainText.trim()) {
        console.log(`[processBatchResults] Saving plain text (${plainText.length} chars) to output bucket`);
        
        // Get fileOutputBucket from config
        const { fileOutputBucket } = require('../config/gcs');
        
        // Save to output bucket with file ID as filename
        const outputTextPath = `extracted-text/${file_id}.txt`;
        const outputTextFile = fileOutputBucket.file(outputTextPath);
        
        await outputTextFile.save(plainText, {
          resumable: false,
          metadata: {
            contentType: 'text/plain',
            cacheControl: 'public, max-age=31536000',
          },
        });
        
        const outputTextUri = `gs://${fileOutputBucket.name}/${outputTextPath}`;
        console.log(`[processBatchResults] ✅ Saved extracted text to: ${outputTextUri}`);
        
        // Update database with the output path
        try {
          await DocumentModel.updateFileOutputPath(file_id, outputTextUri);
          console.log(`[processBatchResults] ✅ Updated database with output path`);
        } catch (dbError) {
          console.warn(`[processBatchResults] ⚠️ Failed to update database (non-critical):`, dbError.message);
        }
      } else {
        console.warn(`[processBatchResults] ⚠️ No plain text to save (empty extraction)`);
      }
    } catch (saveError) {
      console.error(`[processBatchResults] ❌ Failed to save extracted text (non-critical):`, saveError.message);
      // Don't throw - this is non-critical, processing can continue
    }

    if (
      !extractedBatchTexts.length ||
      extractedBatchTexts.every((item) => !item.text || item.text.trim() === "")
    ) {
      const errorDetails = {
        file_id: file_id,
        bucket: bucketName,
        prefix: prefix,
        segments_found: extractedBatchTexts.length,
        message: "No meaningful text extracted from batch document. This may indicate an image-only PDF, corrupted document, or incomplete batch processing."
      };
      console.error(`[processBatchResults] ❌ Validation failed:`, errorDetails);
      throw new Error(`No meaningful text extracted from batch document. Found ${extractedBatchTexts.length} segments, but all were empty.`);
    }

    await updateProcessingProgress(
      file_id,
      "processing",
      45.0,
      "Text validation completed"
    );

    // Step 8: Prepare for chunking (45-48%)
    await updateProcessingProgress(
      file_id,
      "processing",
      46.0,
      "Fetching chunking configuration"
    );

    let batchChunkingMethod = "recursive";
    try {
      const chunkMethodQuery = `
        SELECT chunking_method
        FROM processing_jobs pj
        LEFT JOIN secret_manager sm ON pj.secret_id = sm.id
        WHERE pj.file_id = $1
        ORDER BY pj.created_at DESC
        LIMIT 1;
      `;
      const result = await db.query(chunkMethodQuery, [file_id]);
      if (result.rows.length > 0 && result.rows[0].chunking_method) {
        batchChunkingMethod = result.rows[0].chunking_method;
      }
    } catch (err) {
      console.error(`Error fetching chunking method: ${err.message}`);
    }

    await updateProcessingProgress(
      file_id,
      "processing",
      48.0,
      `Configuration loaded: ${batchChunkingMethod} chunking`
    );

    // Step 9: Chunking (48-58%)
    await updateProcessingProgress(
      file_id,
      "processing",
      50.0,
      `Chunking document with ${batchChunkingMethod} strategy`
    );

    const chunks = await chunkDocument(
      extractedBatchTexts,
      file_id,
      batchChunkingMethod
    );

    await updateProcessingProgress(
      file_id,
      "processing",
      58.0,
      `Chunking completed with ${chunks.length} segments`
    );

    if (!chunks.length) {
      // Handle no chunks (same as in processDocument)
      await DocumentModel.updateFileProcessedAt(file_id);
      await updateProcessingProgress(
        file_id,
        "processed",
        100.0,
        "Processing completed (no content to chunk)"
      );
      await ProcessingJobModel.updateJobStatus(job.job_id, "completed");
      return; // Stop execution
    }

    // Step 10: Prepare embeddings (58-62%)
    await updateProcessingProgress(
      file_id,
      "processing",
      59.0,
      "Preparing chunks for embedding generation"
    );
    const chunkContents = chunks.map((c) => c.content);

    await updateProcessingProgress(
      file_id,
      "processing",
      62.0,
      `Ready to generate embeddings for ${chunks.length} chunks`
    );

    // Step 11: Generate Embeddings (62-76%)
    await updateProcessingProgress(
      file_id,
      "processing",
      64.0,
      "Connecting to embedding service"
    );
    await updateProcessingProgress(
      file_id,
      "processing",
      66.0,
      `Processing embeddings for ${chunks.length} chunks`
    );
    const embeddings = await generateEmbeddings(chunkContents);
    await updateProcessingProgress(
      file_id,
      "processing",
      76.0,
      "All embeddings generated successfully"
    );

    // Step 12: Prepare database save (76-78%)
    await updateProcessingProgress(
      file_id,
      "processing",
      77.0,
      "Preparing data for database storage"
    );
    const chunksToSave = chunks.map((chunk, i) => {
      // ✅ CRITICAL: Extract page_start and page_end from metadata (or chunk directly)
      const page_start = chunk.metadata?.page_start !== null && chunk.metadata?.page_start !== undefined
        ? chunk.metadata.page_start
        : (chunk.page_start !== null && chunk.page_start !== undefined ? chunk.page_start : null);
      const page_end = chunk.metadata?.page_end !== null && chunk.metadata?.page_end !== undefined
        ? chunk.metadata.page_end
        : (chunk.page_end !== null && chunk.page_end !== undefined ? chunk.page_end : null);
      
      return {
        file_id,
        chunk_index: i,
        content: chunk.content,
        token_count: chunk.token_count,
        page_start: page_start,
        page_end: page_end || page_start, // Use page_start if page_end is null
        heading: chunk.metadata?.heading || chunk.heading || null,
      };
    });

    // Step 13: Save chunks to database (78-82%)
    await updateProcessingProgress(
      file_id,
      "processing",
      79.0,
      "Saving chunks to database"
    );
    const savedChunks = await FileChunkModel.saveMultipleChunks(chunksToSave);
    await updateProcessingProgress(
      file_id,
      "processing",
      82.0,
      `${savedChunks.length} chunks saved successfully`
    );

    // Step 14: Prepare vectors (82-84%)
    await updateProcessingProgress(
      file_id,
      "processing",
      83.0,
      "Preparing vector embeddings for storage"
    );
    const vectors = savedChunks.map((chunk, i) => ({
      chunk_id: chunk.id,
      embedding: embeddings[i],
      file_id,
    }));

    // Step 15: Save vectors (84-88%)
    await updateProcessingProgress(
      file_id,
      "processing",
      85.0,
      "Storing vector embeddings in database"
    );
    await ChunkVectorModel.saveMultipleChunkVectors(vectors);
    await updateProcessingProgress(
      file_id,
      "processing",
      88.0,
      "Vector embeddings stored successfully"
    );

    // Step 16: Prepare for summary (88-90%)
    await updateProcessingProgress(
      file_id,
      "processing",
      89.0,
      "Preparing document content for summarization"
    );
    const fullText = chunks.map((c) => c.content).join("\n\n");
    await updateProcessingProgress(
      file_id,
      "processing",
      90.0,
      "Ready to generate summary"
    );

    // Step 17: Generate Summary (90-95%)
    try {
      if (fullText.trim()) {
        await updateProcessingProgress(
          file_id,
          "processing",
          92.0,
          "Generating AI-powered document summary"
        );
        const summary = await getSummaryFromChunks(fullText);
        await DocumentModel.updateFileSummary(file_id, summary);
        await updateProcessingProgress(
          file_id,
          "processing",
          95.0,
          "Summary generated and saved successfully"
        );
      } else {
        await updateProcessingProgress(
          file_id,
          "processing",
          95.0,
          "Summary generation skipped (empty content)"
        );
      }
    } catch (err) {
      console.warn(`Summary generation failed: ${err.message}`);
      await updateProcessingProgress(
        file_id,
        "processing",
        95.0,
        "Summary generation skipped (non-critical)"
      );
    }

    // Step 18: Finalization (95-100%)
    await updateProcessingProgress(
      file_id,
      "processing",
      96.0,
      "Updating document metadata"
    );
    await DocumentModel.updateFileProcessedAt(file_id);
    await updateProcessingProgress(
      file_id,
      "processing",
      98.0,
      "Finalizing document processing"
    );
    await updateProcessingProgress(
      file_id,
      "processed",
      100.0,
      "Document processing completed successfully"
    );
    await ProcessingJobModel.updateJobStatus(job.job_id, "completed");

    console.log(
      `[processBatchResults] ✅ Successfully finished post-processing for file: ${file_id}`
    );
  } catch (error) {
    console.error(`❌ processBatchResults failed for file ${file_id}:`, error);
    try {
      await updateProcessingProgress(
        file_id,
        "error",
        0.0,
        `Post-processing failed: ${error.message}`
      );
      await ProcessingJobModel.updateJobStatus(
        job.job_id,
        "failed",
        error.message
      );
    } catch (err) {
      console.error(`❌ Failed to even update error status for ${file_id}:`, err);
    }
  }
}
exports.getDocumentProcessingStatus = async (req, res) => {
  try {
    const { file_id } = req.params;
    if (!file_id) {
      return res.status(400).json({ error: "file_id is required." });
    }

    console.log(
      `[getDocumentProcessingStatus] Checking status for file_id: ${file_id}`
    );

    const file = await DocumentModel.getFileById(file_id);
    if (!file || String(file.user_id) !== String(req.user.id)) {
      return res
        .status(403)
        .json({ error: "Access denied or file not found." });
    }

    const job = await ProcessingJobModel.getJobByFileId(file_id);

    // Prepare base response
    const baseResponse = {
      document_id: file.id,
      filename: file.filename,
      status: file.status,
      processing_progress: parseFloat(file.processing_progress) || 0,
      current_operation: file.current_operation || "Pending",
      job_status: job ? job.status : "unknown",
      job_error: job ? job.error_message : null,
      last_updated: file.updated_at,
      file_size: file.file_size,
      mime_type: file.mime_type,
    };

    // Case 1: Document is fully processed
    if (file.status === "processed") {
      const chunks = await FileChunkModel.getChunksByFileId(file_id);
      return res.json({
        ...baseResponse,
        processing_progress: 100,
        current_operation: "Completed",
        chunks: chunks,
        chunk_count: chunks.length,
        summary: file.summary,
        processed_at: file.processed_at,
      });
    }

    // Case 2: Document processing failed
    if (file.status === "error") {
      return res.json({
        ...baseResponse,
        processing_progress: 0,
        current_operation: "Failed",
        error_details: job ? job.error_message : "Unknown error occurred",
      });
    }

    // Case 3: Synchronous OR *BACKGROUND* processing in progress
    if (file.status === "processing") {
      // This case now handles all polls *after* the background job is triggered
      return res.json({
        ...baseResponse,
        message: "Document is being processed. Progress updates in real-time.",
      });
    }

    // Case 4: Batch processing (polling the Google operation)
    if (file.status === "batch_processing" || file.status === "batch_queued") {
      if (!job || !job.document_ai_operation_name) {
        return res.json({
          ...baseResponse,
          current_operation: "Queued for batch processing",
          message: "Document is queued for batch processing.",
        });
      }

      const currentProgress = parseFloat(file.processing_progress) || 0;
     
      // Only update if we're moving forward from the initial state
      if (currentProgress < 5) {
        await updateProcessingProgress(
          file_id,
          "batch_processing",
          5.0, // Start at 5%
          "Checking batch processing status"
        );
      }

      const operationStatus = await getOperationStatus(
        job.document_ai_operation_name
      );

      // Batch still running
      if (!operationStatus.done) {
        console.log(`[getDocumentProcessingStatus] Batch operation for ${file_id} is still running.`);
        // Smoothly progress from 5% to 42%
        const newProgress = Math.min(currentProgress + 2, 42);

        if (newProgress > currentProgress) {
          await updateProcessingProgress(
            file_id,
            "batch_processing",
            newProgress,
            "Batch OCR processing in progress"
          );
        }
        return res.json({
          ...baseResponse,
          processing_progress: newProgress,
          current_operation: "Batch OCR processing in progress",
          message:
            "Document AI is processing your document. This may take several minutes.",
        });
      }

      // Batch failed
      if (operationStatus.error) {
        await updateProcessingProgress(
          file_id,
          "error",
          0.0,
          "Batch processing failed"
        );
        await ProcessingJobModel.updateJobStatus(
          job.job_id,
          "failed",
          operationStatus.error.message
        );
        return res.json({
          ...baseResponse,
          status: "error",
          processing_progress: 0,
          current_operation: "Batch processing failed",
          job_status: "failed",
          job_error: operationStatus.error.message,
        });
      }

      // ---=== BATCH IS DONE (operationStatus.done === true) ===---

      // Check if this is the FIRST time we're seeing it 'done'
      // We check < 100 to prevent re-triggering a completed job.
      if (currentProgress < 100) {
        console.log(
          `[getDocumentProcessingStatus] Batch for ${file_id} is DONE. Triggering background post-processing.`
        );

        // ** THIS IS THE CRITICAL FIX **
        // Update status to 'processing' so Case 3 handles future polls
        await updateProcessingProgress(
          file_id,
          "processing", // Set status to 'processing'
          42.0, // Set progress to 42 (end of OCR)
          "Batch OCR completed"
        );

        // ** FIRE-AND-FORGET **
        // Call the worker function but DO NOT await it.
        // This lets the API request return immediately.
        processBatchResults(file_id, job);

        // Return the 42% status to the client *immediately*
        return res.json({
          ...baseResponse,
          status: "processing", // Reflect the new status
          processing_progress: 42.0,
          current_operation: "Batch OCR completed",
          message: "Batch processing complete. Starting post-processing.",
        });
      }

      // Fallback: If we're here, it's 'done' but progress is somehow 100
      // (or processing was triggered by a duplicate request).
      // This shouldn't happen, but if it does, just return the current status.
      return res.json({
        ...baseResponse,
        message: "Post-processing is complete.",
      });
    }

    // Case 5: Just uploaded, not yet started
    return res.json({
      ...baseResponse,
      current_operation: "Queued",
      message: "Document uploaded successfully. Processing will begin shortly.",
    });
  } catch (error) {
    console.error("❌ getDocumentProcessingStatus error:", error);
    try {
      const { file_id } = req.params;
      if (file_id) {
        await updateProcessingProgress(
          file_id,
          "error",
          0.0,
          `Status check failed: ${error.message}`
        );
        const job = await ProcessingJobModel.getJobByFileId(file_id);
        if (job) {
          await ProcessingJobModel.updateJobStatus(
            job.job_id,
            "failed",
            error.message
          );
        }
      }
    } catch (updateError) {
      console.error("❌ Failed to update error status:", updateError);
    }

    return res.status(500).json({
      error: "Failed to fetch processing status.",
      details: error.message,
    });
  }
};

exports.batchUploadDocuments = async (req, res) => {
 const userId = req.user.id;
 const authorizationHeader = req.headers.authorization;

 try {
 console.log(`[batchUploadDocuments] Received batch upload request.`);
 const { secret_id, llm_name, trigger_initial_analysis_with_secret } = req.body; // Destructure trigger_initial_analysis_with_secret
 console.log(`[batchUploadDocuments] Received secret_id: ${secret_id}, llm_name: ${llm_name}, trigger_initial_analysis_with_secret: ${trigger_initial_analysis_with_secret}`);

 if (!userId) return res.status(401).json({ error: "Unauthorized" });
 if (!req.files || req.files.length === 0)
 return res.status(400).json({ error: "No files uploaded." });

 // --- Fetch user usage and plan ---
 let usageAndPlan;
 try {
 usageAndPlan = await TokenUsageService.getUserUsageAndPlan(
 userId,
 authorizationHeader
 );
 } catch (planError) {
 console.error(`❌ Failed to retrieve user plan for user ${userId}:`, planError.message);
 return res.status(500).json({
 success: false,
 message: "Failed to retrieve user plan. Please ensure the user plan service is accessible.",
 details: planError.message,
 });
 }

 const { usage: userUsage, plan: userPlan } = usageAndPlan;

 // --- Calculate requested resources for this batch ---
 // For simplicity, assume each document uses 1 document slot and a fixed number of tokens (adjust as needed)
 const requestedResources = {
 tokens: req.files.length * 100, // Example: each file consumes 100 tokens
 documents: req.files.length,
 ai_analysis: req.files.length,
 storage_gb: req.files.reduce((acc, f) => acc + f.size / (1024 ** 3), 0), // convert bytes to GB
 };

 // --- Enforce limits ---
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

 const uploadedFiles = [];
 for (const file of req.files) {
 try {
 const originalFilename = file.originalname;
 const mimeType = file.mimetype;

 const batchUploadFolder = `batch-uploads/${userId}/${uuidv4()}`;
 const { gsUri: gcsInputUri, gcsPath: folderPath } = await uploadToGCS(
 originalFilename,
 file.buffer,
 batchUploadFolder,
 true,
 mimeType
 );

 const outputPrefix = `document-ai-results/${userId}/${uuidv4()}/`;
 const gcsOutputUriPrefix = `gs://${fileOutputBucket.name}/${outputPrefix}`;

 // Start DocAI Batch Operation
 console.log(`[batchUploadDocuments] Starting Document AI batch processing for ${originalFilename}`);
 const operationName = await batchProcessDocument(
   [gcsInputUri],
   gcsOutputUriPrefix,
   mimeType
 );

 // Save file metadata
 const fileId = await DocumentModel.saveFileMetadata(
 userId,
 originalFilename,
 gcsInputUri,
 folderPath,
 mimeType,
 file.size,
 "batch_queued"
 );

 // Create job entry
 const jobId = uuidv4();
 await ProcessingJobModel.createJob({
 job_id: jobId,
 file_id: fileId,
 type: "batch",
 gcs_input_uri: gcsInputUri,
 gcs_output_uri_prefix: gcsOutputUriPrefix,
 document_ai_operation_name: operationName,
 status: "queued",
 secret_id: secret_id || null, // Pass secret_id from request body
 });

 await DocumentModel.updateFileStatus(fileId, "batch_processing", 0.0);

 uploadedFiles.push({
 file_id: fileId,
 job_id: jobId,
 filename: originalFilename,
 operation_name: operationName,
 gcs_input_uri: gcsInputUri,
 gcs_output_uri_prefix: gcsOutputUriPrefix,
 });
 } catch (innerError) {
 console.error(`❌ Error processing ${file.originalname}:`, innerError);
 uploadedFiles.push({
 filename: file.originalname,
 error: innerError.message,
 });
 }
 }

 // --- Increment usage after successful upload(s) ---
 try {
 await TokenUsageService.incrementUsage(
 userId,
 requestedResources,
 userPlan
 );
 } catch (usageError) {
 console.error(`❌ Error incrementing token usage for user ${userId}:`, usageError);
 }

 return res.status(202).json({
 success: true,
 message: "Batch document upload successful; processing initiated.",
 uploaded_files: uploadedFiles,
 });
 } catch (error) {
 console.error("❌ Batch Upload Error:", error);
 return res.status(500).json({
 success: false,
 message: "Failed to initiate batch processing",
 details: error.message,
 });
 }
};

/**
 * @description Retrieves the total storage utilization for the authenticated user.
 * @route GET /api/doc/user-storage-utilization
 */
exports.getUserStorageUtilization = async (req, res) => {
 try {
 const userId = req.user.id;
 if (!userId) {
 return res.status(401).json({ message: 'Unauthorized' });
 }

 const totalStorageUsedBytes = await File.getTotalStorageUsed(userId);
 const totalStorageUsedGB = (totalStorageUsedBytes / (1024 * 1024 * 1024)).toFixed(2);

 res.status(200).json({
 storage: {
 used_bytes: totalStorageUsedBytes,
 used_gb: totalStorageUsedGB,
 }
 });

 } catch (error) {
 console.error('❌ Error fetching user storage utilization:', error);
 res.status(500).json({ message: 'Internal server error', error: error.message });
 }
};

/**
 * @description Retrieves user's current usage and plan details from the Document Service.
 * This endpoint is intended to be called by the Payment Service.
 * @route GET /api/doc/user-usage-and-plan/:userId
 */
exports.getUserUsageAndPlan = async (req, res) => {
 try {
 const { userId } = req.params;
 const authorizationHeader = req.headers.authorization; // Pass through auth header

 if (!userId) {
 return res.status(400).json({ error: "User ID is required." });
 }

 // Call the TokenUsageService to get the combined usage and plan data
 const { usage, plan, timeLeft } = await TokenUsageService.getUserUsageAndPlan(userId, authorizationHeader);

 return res.status(200).json({
 success: true,
 data: {
 usage,
 plan,
 timeLeft
 }
 });

 } catch (error) {
 console.error('❌ Error fetching user usage and plan:', error);
 res.status(500).json({ message: 'Internal server error', error: error.message });
 }
};



/**
 * @description Delete a single chat by ID
 * @route DELETE /api/doc/chat/:chat_id
 */
exports.deleteChat = async (req, res) => {
  try {
    const userId = req.user.id;
    const { chat_id } = req.params;

    if (!chat_id) {
      return res.status(400).json({ error: "chat_id is required." });
    }

    const deleted = await FileChat.deleteChatById(chat_id, userId);

    if (!deleted) {
      return res.status(404).json({ error: "Chat not found or access denied." });
    }

    return res.status(200).json({
      success: true,
      message: "Chat deleted successfully.",
      deleted_chat_id: chat_id
    });

  } catch (error) {
    console.error("❌ deleteChat error:", error);
    return res.status(500).json({ error: "Failed to delete chat." });
  }
};

/**
 * @description Delete multiple selected chats
 * @route DELETE /api/doc/chats/selected
 */
exports.deleteSelectedChats = async (req, res) => {
  try {
    const userId = req.user.id;
    const { chat_ids } = req.body;

    if (!Array.isArray(chat_ids) || chat_ids.length === 0) {
      return res.status(400).json({ error: "chat_ids array is required and cannot be empty." });
    }

    if (chat_ids.length > 100) {
      return res.status(400).json({ error: "Cannot delete more than 100 chats at once." });
    }

    const result = await FileChat.deleteSelectedChats(chat_ids, userId);

    return res.status(200).json({
      success: true,
      message: `${result.deletedCount} chat(s) deleted successfully.`,
      requested_count: chat_ids.length,
      deleted_count: result.deletedCount,
      deleted_ids: result.deletedIds
    });

  } catch (error) {
    console.error("❌ deleteSelectedChats error:", error);
    return res.status(500).json({ error: "Failed to delete selected chats." });
  }
};

/**
 * @description Delete all chats for the authenticated user
 * @route DELETE /api/doc/chats/all
 */
exports.deleteAllChats = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get statistics first for confirmation message
    const stats = await FileChat.getChatStatistics(userId);
    
    if (stats && stats.totalChats === 0) {
      return res.status(404).json({ 
        success: true,
        message: "No chats found to delete.",
        deleted_count: 0
      });
    }

    const result = await FileChat.deleteAllChatsByUserId(userId);

    return res.status(200).json({
      success: true,
      message: `All chats deleted successfully. ${result.deletedCount} chat(s) were removed.`,
      deleted_count: result.deletedCount,
      sessions_affected: stats ? stats.totalSessions : 0
    });

  } catch (error) {
    console.error("❌ deleteAllChats error:", error);
    return res.status(500).json({ error: "Failed to delete all chats." });
  }
};

/**
 * @description Delete all chats for a specific session
 * @route DELETE /api/doc/chats/session/:session_id
 */
exports.deleteChatsBySession = async (req, res) => {
  try {
    const userId = req.user.id;
    const { session_id } = req.params;

    if (!session_id) {
      return res.status(400).json({ error: "session_id is required." });
    }

    const result = await FileChat.deleteChatsBySession(session_id, userId);

    if (result.deletedCount === 0) {
      return res.status(404).json({ 
        error: "No chats found in this session or access denied.",
        session_id: session_id
      });
    }

    return res.status(200).json({
      success: true,
      message: `Session chats deleted successfully. ${result.deletedCount} chat(s) were removed.`,
      deleted_count: result.deletedCount,
      session_id: session_id
    });

  } catch (error) {
    console.error("❌ deleteChatsBySession error:", error);
    return res.status(500).json({ error: "Failed to delete session chats." });
  }
};

/**
 * @description Delete all chats for a specific file
 * @route DELETE /api/doc/chats/file/:file_id
 */
exports.deleteChatsByFile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { file_id } = req.params;

    if (!file_id) {
      return res.status(400).json({ error: "file_id is required." });
    }

    // Verify user owns the file (optional check)
    const DocumentModel = require("../models/documentModel");
    const file = await DocumentModel.getFileById(file_id);
    if (file && String(file.user_id) !== String(userId)) {
      return res.status(403).json({ error: "Access denied to this file." });
    }

    const result = await FileChat.deleteChatsByFileId(file_id, userId);

    if (result.deletedCount === 0) {
      return res.status(404).json({ 
        success: true,
        message: "No chats found for this file.",
        deleted_count: 0,
        file_id: file_id
      });
    }

    return res.status(200).json({
      success: true,
      message: `File chats deleted successfully. ${result.deletedCount} chat(s) were removed.`,
      deleted_count: result.deletedCount,
      file_id: file_id
    });

  } catch (error) {
    console.error("❌ deleteChatsByFile error:", error);
    return res.status(500).json({ error: "Failed to delete file chats." });
  }
};

/**
 * @description Get chat statistics for the user
 * @route GET /api/doc/chats/statistics
 */
exports.getChatStatistics = async (req, res) => {
  try {
    const userId = req.user.id;

    const stats = await FileChat.getChatStatistics(userId);

    return res.status(200).json({
      success: true,
      statistics: stats
    });

  } catch (error) {
    console.error("❌ getChatStatistics error:", error);
    return res.status(500).json({ error: "Failed to get chat statistics." });
  }
};

/**
 * @description Get preview of chats that would be deleted
 * @route POST /api/doc/chats/delete-preview
 */
exports.getDeletePreview = async (req, res) => {
  try {
    const userId = req.user.id;
    const filters = req.body;

    const preview = await FileChat.getDeletePreview(userId, filters);

    return res.status(200).json({
      success: true,
      preview,
      count: preview.length,
      message: preview.length > 0 ? `${preview.length} chat(s) would be deleted` : "No chats match the criteria"
    });

  } catch (error) {
    console.error("❌ getDeletePreview error:", error);
    return res.status(500).json({ error: "Failed to get delete preview." });
  }
};



/**
 * @description Get document with all related data (chunks, chats, metadata) - user-specific
 * @route GET /api/doc/document/:file_id/complete
 */
exports.getDocumentComplete = async (req, res) => {
  const userId = req.user.id;
  const { file_id } = req.params;

  try {
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!file_id) return res.status(400).json({ error: "file_id is required" });

    // Get file metadata
    const file = await DocumentModel.getFileById(file_id);
    if (!file) {
      return res.status(404).json({ error: "Document not found" });
    }

    // Verify user owns the document
    if (String(file.user_id) !== String(userId)) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Get all chunks for this file
    const chunks = await FileChunkModel.getChunksByFileId(file_id);

    // Get chat history for this file
    const chats = await FileChat.getChatHistory(file_id);

    // Get processing job if exists
    const processingJob = await ProcessingJobModel.getJobByFileId(file_id);

    // Return complete document data
    return res.status(200).json({
      success: true,
      document: {
        id: file.id,
        user_id: file.user_id,
        originalname: file.originalname,
        gcs_path: file.gcs_path,
        folder_path: file.folder_path,
        mimetype: file.mimetype,
        size: file.size,
        status: file.status,
        processing_progress: file.processing_progress,
        current_operation: file.current_operation,
        summary: file.summary,
        full_text_content: file.full_text_content,
        created_at: file.created_at,
        updated_at: file.updated_at,
        processed_at: file.processed_at
      },
      chunks: chunks.map(chunk => ({
        id: chunk.id,
        chunk_index: chunk.chunk_index,
        content: chunk.content,
        token_count: chunk.token_count,
        page_start: chunk.page_start,
        page_end: chunk.page_end,
        heading: chunk.heading
      })),
      chats: chats.map(chat => ({
        id: chat.id,
        question: chat.question,
        answer: chat.answer,
        session_id: chat.session_id,
        used_chunk_ids: chat.used_chunk_ids,
        used_secret_prompt: chat.used_secret_prompt,
        prompt_label: chat.prompt_label,
        created_at: chat.created_at
      })),
      processing_job: processingJob ? {
        job_id: processingJob.job_id,
        status: processingJob.status,
        type: processingJob.type,
        created_at: processingJob.created_at
      } : null,
      total_chunks: chunks.length,
      total_chats: chats.length
    });
  } catch (error) {
    console.error("❌ getDocumentComplete error:", error);
    return res.status(500).json({ error: "Failed to retrieve document data" });
  }
};

// Export processDocument for use in other modules (e.g., documentRoutes)
exports.processDocument = processDocument;


