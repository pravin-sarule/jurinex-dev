

require("dotenv").config();

const mime = require("mime-types");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

// Database
const pool = require("../config/db");

// Models
const File = require("../models/File");
const FileChat = require("../models/FileChat");
const FileChunk = require("../models/FileChunk");
const ChunkVector = require("../models/ChunkVector");
const ProcessingJob = require("../models/ProcessingJob");
const FolderChat = require("../models/FolderChat");

// Services
const {
  uploadToGCS,
  getSignedUrl: getSignedUrlFromGCS, // Renamed to avoid conflict
  getSignedUploadUrl,
} = require("../services/gcsService");
const { getSignedUrl } = require("../services/folderService"); // Import from folderService
const { checkStorageLimit } = require("../utils/storage");
const { bucket } = require("../config/gcs");
const { askGemini, getSummaryFromChunks, askLLM, getAvailableProviders, resolveProviderName } = require("../services/aiService");
const { askLLM: askFolderLLMService, streamLLM: streamFolderLLM, resolveProviderName: resolveFolderProviderName, getAvailableProviders: getFolderAvailableProviders } = require("../services/folderAiService"); // Import askLLM, streamLLM, resolveProviderName, and getAvailableProviders from folderAiService
const UserProfileService = require("../services/userProfileService");
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
const TokenUsageService = require("../services/tokenUsageService"); // Import TokenUsageService
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager'); // NEW
const secretManagerController = require('./secretManagerController'); // NEW
const GCLOUD_PROJECT_ID = process.env.GCLOUD_PROJECT_ID; // NEW
const { 
  fetchTemplateFilesData, 
  buildEnhancedSystemPromptWithTemplates,
  fetchSecretManagerWithTemplates 
} = require("../services/secretPromptTemplateService"); // NEW: Import template service
let secretClient; // NEW

if (!secretClient) { // NEW
  secretClient = new SecretManagerServiceClient(); // NEW
} // NEW

/* ----------------- Helpers ----------------- */
function sanitizeName(name) {
  return String(name).trim().replace(/[^a-zA-Z0-9._-]/g, "_");
}

// Helper to escape special characters in a string for use in a regular expression
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

async function ensureUniqueKey(key) {
  const dir = path.posix.dirname(key);
  const name = path.posix.basename(key);
  const ext = path.posix.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;

  let candidate = key;
  let counter = 1;

  while (true) {
    const [exists] = await bucket.file(candidate).exists();
    if (!exists) return candidate;
    candidate = path.posix.join(dir, `${stem}(${counter})${ext}`);
    counter++;
  }
}

async function makeSignedReadUrl(objectKey, minutes = 15) {
  const [signedUrl] = await bucket.file(objectKey).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + minutes * 60 * 1000,
  });
  return signedUrl;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONVERSATION_HISTORY_TURNS = 5;

function formatFolderConversationHistory(chats = [], limit = CONVERSATION_HISTORY_TURNS) {
  if (!Array.isArray(chats) || chats.length === 0) return '';
  const recentChats = chats.slice(-limit);
  return recentChats
    .map((chat, idx) => {
      const turnNumber = chats.length - recentChats.length + idx + 1;
      return `Turn ${turnNumber}:\nUser: ${chat.question || ''}\nAssistant: ${chat.answer || ''}`;
    })
    .join('\n\n');
}

function simplifyFolderHistory(chats = []) {
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

function appendFolderConversation(prompt, conversationText) {
  if (!conversationText) return prompt;
  return `You are continuing a multi-turn chat for a folder-level analysis. Maintain context with earlier exchanges.\n\nPrevious Conversation:\n${conversationText}\n\n---\n\n${prompt}`;
}

// Helper function to fetch and format case data based on folderName
async function fetchCaseDataForFolder(userId, folderName) {
  try {
    // First, find the folder by folder_path or originalname
    // folderName could be just the folder name or part of the full path
    const folderQuery = `
      SELECT id, originalname, folder_path
      FROM user_files
      WHERE user_id = $1
        AND is_folder = true
        AND (
          folder_path = $2 
          OR folder_path LIKE $3
          OR folder_path LIKE $4
          OR originalname = $2
        )
      ORDER BY created_at ASC
      LIMIT 1;
    `;
    const folderPattern = `%${folderName}%`;
    const folderEndPattern = `%/${folderName}`;
    const { rows: folderRows } = await pool.query(folderQuery, [
      userId,
      folderName,
      folderPattern,
      folderEndPattern
    ]);

    if (folderRows.length === 0) {
      console.log(`[fetchCaseDataForFolder] No folder found for folderName: ${folderName}`);
      return null;
    }

    const folder = folderRows[0];

    // Then, find the case by folder_id
    const caseQuery = `
      SELECT *
      FROM cases
      WHERE user_id = $1
        AND folder_id = $2
      ORDER BY created_at DESC
      LIMIT 1;
    `;
    const { rows: caseRows } = await pool.query(caseQuery, [userId, folder.id]);

    if (caseRows.length === 0) {
      console.log(`[fetchCaseDataForFolder] No case found for folder_id: ${folder.id}`);
      return null;
    }

    return caseRows[0];
  } catch (error) {
    console.error(`[fetchCaseDataForFolder] Error fetching case data:`, error);
    return null;
  }
}

// Helper function to format case data as context string
function formatCaseDataAsContext(caseData) {
  if (!caseData) return '';

  const formatJsonField = (field) => {
    if (!field) return 'N/A';
    if (typeof field === 'string') {
      try {
        const parsed = JSON.parse(field);
        return Array.isArray(parsed) ? parsed.map(item => {
          if (typeof item === 'object') {
            return Object.entries(item).map(([key, val]) => `${key}: ${val || 'N/A'}`).join(', ');
          }
          return item;
        }).join('; ') : JSON.stringify(parsed);
      } catch {
        return field;
      }
    }
    if (Array.isArray(field)) {
      return field.map(item => {
        if (typeof item === 'object') {
          return Object.entries(item).map(([key, val]) => `${key}: ${val || 'N/A'}`).join(', ');
        }
        return item;
      }).join('; ');
    }
    return String(field);
  };

  const formatDate = (date) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  return `=== CASE INFORMATION ===
Case Title: ${caseData.case_title || 'N/A'}
Case Number: ${caseData.case_number || 'N/A'}
Filing Date: ${formatDate(caseData.filing_date)}
Case Type: ${caseData.case_type || 'N/A'}
Sub Type: ${caseData.sub_type || 'N/A'}
Court Name: ${caseData.court_name || 'N/A'}
Court Level: ${caseData.court_level || 'N/A'}
Bench Division: ${caseData.bench_division || 'N/A'}
Jurisdiction: ${caseData.jurisdiction || 'N/A'}
State: ${caseData.state || 'N/A'}
Judges: ${formatJsonField(caseData.judges)}
Court Room No: ${caseData.court_room_no || 'N/A'}
Petitioners: ${formatJsonField(caseData.petitioners)}
Respondents: ${formatJsonField(caseData.respondents)}
Category Type: ${caseData.category_type || 'N/A'}
Primary Category: ${caseData.primary_category || 'N/A'}
Sub Category: ${caseData.sub_category || 'N/A'}
Complexity: ${caseData.complexity || 'N/A'}
Monetary Value: ${caseData.monetary_value ? `₹${caseData.monetary_value}` : 'N/A'}
Priority Level: ${caseData.priority_level || 'N/A'}
Status: ${caseData.status || 'N/A'}
---`;
}


// Progress stage definitions
const PROGRESS_STAGES = {
  INIT: { start: 0, end: 5, status: 'batch_queued' },
  UPLOAD: { start: 5, end: 15, status: 'batch_queued' },
  BATCH_START: { start: 15, end: 20, status: 'batch_processing' },
  BATCH_OCR: { start: 20, end: 42, status: 'batch_processing' },
  FETCH_RESULTS: { start: 42, end: 45, status: 'processing' },
  CONFIG: { start: 45, end: 48, status: 'processing' },
  CHUNKING: { start: 48, end: 58, status: 'processing' },
  EMBEDDING_QUEUE: { start: 58, end: 68, status: 'processing' },
  SAVE_CHUNKS: { start: 68, end: 78, status: 'processing' },
  SUMMARY: { start: 78, end: 88, status: 'embedding_pending' },
  FINALIZE: { start: 88, end: 100, status: 'embedding_pending' },
};

/**
 * Get human-readable operation name based on progress
 */
function getOperationName(progress, status) {
  if (status === "processed" || status === "completed") return "Completed";
  if (status === "error" || status === "failed") return "Failed";

  const p = parseFloat(progress) || 0;

  // Batch queued stage (0-15%)
  if (status === "batch_queued") {
    if (p < 5) return "Initializing document processing";
    if (p < 15) return "Uploading document to cloud storage";
    return "Preparing batch operation";
  }

  // Batch processing stage (15-42%)
  if (status === "batch_processing") {
    if (p < 20) return "Starting Document AI batch processing";
    if (p < 25) return "Document uploaded to processing queue";
    if (p < 30) return "OCR analysis in progress";
    if (p < 35) return "Extracting text from document";
    if (p < 40) return "Processing document layout";
    return "Completing OCR extraction";
  }

  if (status === "embedding_pending") {
    return "Waiting for background embedding";
  }

  if (status === "embedding_processing") {
    return "Embedding chunks in background";
  }

  if (status === "embedding_failed") {
    return "Embedding failed";
  }

  // Post-processing stage (42-100%)
  if (status === "processing") {
    if (p < 45) return "Fetching OCR results";
    if (p < 48) return "Loading chunking configuration";
    if (p < 52) return "Initializing chunking";
    if (p < 58) return "Chunking document into segments";
    if (p < 64) return "Preparing for embedding";
    if (p < 70) return "Connecting to embedding service";
    if (p < 76) return "Generating AI embeddings";
    if (p < 79) return "Preparing database storage";
    if (p < 82) return "Saving chunks to database";
    if (p < 85) return "Preparing vector embeddings";
    if (p < 88) return "Storing vector embeddings";
    if (p < 92) return "Generating AI summary";
    if (p < 96) return "Saving document summary";
    if (p < 98) return "Updating document metadata";
    if (p < 100) return "Finalizing document processing";
    return "Processing complete";
  }

  return "Queued";
}

// ============================================================================
// PROGRESS UPDATE HELPERS
// ============================================================================

/**
 * Update progress with consistent formatting and DATABASE WRITE
 */
const updateProgress = async (fileId, status, progress, operation = null) => {
  const currentOperation = operation || getOperationName(progress, status);

  // ✅ CRITICAL: Actually update the database
  await File.updateProcessingStatus(fileId, status, progress, currentOperation);

  console.log(`[Progress] File ${fileId.substring(0, 8)}...: ${progress.toFixed(1)}% - ${currentOperation}`);

  return {
    file_id: fileId,
    status,
    progress: parseFloat(progress.toFixed(1)),
    operation: currentOperation,
    timestamp: new Date().toISOString()
  };
};

/**
 * Smoothly increment progress with consistent intervals
 */
const smoothProgressIncrement = async (
  fileId,
  status,
  startProgress,
  endProgress,
  operation = null,
  delayMs = 100
) => {
  const start = parseFloat(startProgress);
  const end = parseFloat(endProgress);
  const steps = Math.ceil(end - start);

  for (let i = 0; i <= steps; i++) {
    const currentProgress = start + i;
    if (currentProgress > end) break;

    await updateProgress(fileId, status, currentProgress, operation);

    if (i < steps) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
};

// ============================================================================
// BATCH POLLING WITH CLEAR PROGRESS
// ============================================================================

/**
 * Background polling to update batch processing progress (20% -> 42%)
 */
async function pollBatchProgress(fileId, jobId, operationName) {
  console.log(`[Batch Polling] 🔄 Starting progress polling for file: ${fileId}`);

  const maxPolls = 300; // 25 minutes max
  let pollCount = 0;
  let batchCompleted = false;

  const pollInterval = setInterval(async () => {
    try {
      pollCount++;

      // Check file status
      const file = await File.getFileById(fileId);

      if (!file) {
        console.log(`[Batch Polling] ❌ File ${fileId} not found. Stopping.`);
        clearInterval(pollInterval);
        return;
      }

      // Stop if moved to post-processing
      if (file.status === "processing" || file.status === "processed") {
        console.log(`[Batch Polling] ✅ Status: ${file.status}. Stopping poll.`);
        clearInterval(pollInterval);
        return;
      }

      // Stop on error
      if (file.status === "error") {
        console.log(`[Batch Polling] ❌ Error detected. Stopping poll.`);
        clearInterval(pollInterval);
        return;
      }

      // Check batch operation status
      const status = await getOperationStatus(operationName);

      if (status.done && !batchCompleted) {
        batchCompleted = true;
        console.log(`[Batch Polling] ✅ Batch operation COMPLETED for file: ${fileId}`);

        if (status.error) {
          console.error(`[Batch Polling] ❌ Batch failed:`, status.error.message);
          await updateProgress(fileId, "error", 0, "Batch processing failed");
          await ProcessingJob.updateJobStatus(jobId, "failed", status.error.message);
          clearInterval(pollInterval);
          return;
        }

        // Move to post-processing at 42%
        await updateProgress(fileId, "processing", 42.0, "OCR completed. Starting post-processing");

        const job = await ProcessingJob.getJobByFileId(fileId);

        if (!job) {
          console.error(`[Batch Polling] ❌ Job not found for file: ${fileId}`);
          clearInterval(pollInterval);
          return;
        }

        console.log(`[Batch Polling] 🚀 Triggering post-processing for file: ${fileId}`);

        // Trigger post-processing
        if (file.status !== "processing_locked") {
          File.updateProcessingStatus(fileId, "processing_locked", 42.0)
            .then(() => {
              processBatchResults(fileId, job).catch(err => {
                console.error(`[Batch Polling] ❌ Post-processing error:`, err);
                File.updateProcessingStatus(fileId, "error", 42.0, "Post-processing failed");
              });
            });
        }

        clearInterval(pollInterval);
        return;
      }

      // ✅ IMPORTANT: Gradual progress increment during batch processing (20% -> 41.5%)
      const currentProgress = parseFloat(file.processing_progress) || 20;

      if (file.status === "batch_processing" && currentProgress < 42) {
        // Increment by 0.5% every 5 seconds for smooth progress
        const newProgress = Math.min(currentProgress + 0.5, 41.5);
        await updateProgress(fileId, "batch_processing", newProgress);
      }

      // Stop after max attempts
      if (pollCount >= maxPolls) {
        console.warn(`[Batch Polling] ⚠️ Max polls reached for file: ${fileId}`);
        await updateProgress(fileId, "error", 0, "Batch processing timeout");
        await ProcessingJob.updateJobStatus(jobId, "failed", "Processing timeout");
        clearInterval(pollInterval);
      }

    } catch (error) {
      console.error(`[Batch Polling] ❌ Error in poll #${pollCount}:`, error.message);
      // Continue polling on error
    }
  }, 5000); // Poll every 5 seconds
}

// ============================================================================
// MAIN PROCESSING FUNCTIONS
// ============================================================================

/**
 * Initiates batch document processing (0% -> 20%)
 */
async function processDocumentWithAI(
  fileId,
  fileBuffer,
  mimetype,
  userId,
  originalFilename,
  secretId = null
) {
  const jobId = uuidv4();
  console.log(`\n${"=".repeat(80)}`);
  console.log(`[START] Processing: ${originalFilename} (File ID: ${fileId})`);
  console.log(`[START] MIME Type: ${mimetype}`);
  console.log(`[START] File Size: ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB`);
  console.log(`${"=".repeat(80)}\n`);

  try {
    // STAGE 1: Initialize (0-5%)
    await updateProgress(fileId, "batch_queued", 0, "Initializing document processing");

    await ProcessingJob.createJob({
      job_id: jobId,
      file_id: fileId,
      type: "batch",
      document_ai_operation_name: null,
      status: "queued",
      secret_id: secretId,
    });

    await smoothProgressIncrement(fileId, "batch_queued", 1, 5, "Processing job created", 100);

    // Check if PDF and detect if digital-native
    const isPDF = String(mimetype).toLowerCase() === 'application/pdf';
    let extractedTexts = [];
    let isDigitalNative = false;

    if (isPDF) {
      console.log(`\n${"🔍".repeat(40)}`);
      console.log(`[PDF DETECTION] Starting digital-native detection...`);
      console.log(`[PDF DETECTION] File: ${originalFilename}`);
      console.log(`[PDF DETECTION] File ID: ${fileId}`);
      console.log(`${"🔍".repeat(40)}\n`);
      
      await updateProgress(fileId, "batch_queued", 6, "Analyzing PDF format (checking if digital-native)");
      
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
        isDigitalNative = true;
        
        console.log(`\n${"🟢".repeat(40)}`);
        console.log(`[TEXT EXTRACTION METHOD] ✅ DIGITAL-NATIVE PDF DETECTED`);
        console.log(`[TEXT EXTRACTION METHOD] 📦 Using: pdf-parse (FREE - No Document AI cost)`);
        console.log(`[TEXT EXTRACTION METHOD] 💰 Cost: $0.00 (Cost savings enabled)`);
        console.log(`[TEXT EXTRACTION METHOD] ⚡ Speed: Fast (local parsing)`);
        console.log(`${"🟢".repeat(40)}\n`);
        
        await updateProgress(fileId, "processing", 20, "Extracting text from digital-native PDF (using pdf-parse)");
        
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
          
          // Fall back to Document AI
          isDigitalNative = false;
          extractedTexts = [];
        } else {
          await updateProgress(fileId, "processing", 42, "Text extraction completed (digital-native PDF - pdf-parse)");
          
          // Process directly without Document AI
          await processDigitalNativePDF(fileId, extractedTexts, userId, secretId, jobId);
          return; // Exit early, processing continues in background
        }
      } else {
        console.log(`\n${"🟡".repeat(40)}`);
        console.log(`[TEXT EXTRACTION METHOD] ⚠️ SCANNED PDF DETECTED`);
        console.log(`[TEXT EXTRACTION METHOD] 📦 Using: Document AI OCR (Google Cloud)`);
        console.log(`[TEXT EXTRACTION METHOD] 💰 Cost: Document AI pricing applies`);
        console.log(`[TEXT EXTRACTION METHOD] ⏱️ Speed: Slower (cloud OCR processing)`);
        if (pdfDetection.error) {
          console.log(`[TEXT EXTRACTION METHOD] ⚠️ Detection error: ${pdfDetection.error}`);
        }
        console.log(`${"🟡".repeat(40)}\n`);
      }
    }

    // If not digital-native PDF, proceed with Document AI batch processing
    if (!isDigitalNative) {
      console.log(`\n${"🔵".repeat(40)}`);
      console.log(`[TEXT EXTRACTION METHOD] 🔵 DOCUMENT AI OCR`);
      console.log(`[TEXT EXTRACTION METHOD] 📦 Using: Google Cloud Document AI`);
      console.log(`[TEXT EXTRACTION METHOD] 📄 File Type: ${isPDF ? 'Scanned PDF' : mimetype}`);
      console.log(`[TEXT EXTRACTION METHOD] 💰 Cost: Document AI pricing applies`);
      console.log(`[TEXT EXTRACTION METHOD] ⏱️ Speed: Processing time depends on file size`);
      console.log(`${"🔵".repeat(40)}\n`);

      // STAGE 2: Upload to GCS (5-15%)
      await updateProgress(fileId, "batch_queued", 6, "Uploading to cloud storage");

      const batchUploadFolder = `batch-uploads/${userId}/${uuidv4()}`;
      const { gsUri: gcsInputUri } = await uploadToGCS(
        originalFilename,
        fileBuffer,
        batchUploadFolder,
        true,
        mimetype
      );

      console.log(`[Upload] Success: ${gcsInputUri}`);
      await smoothProgressIncrement(fileId, "batch_queued", 7, 15, "Upload completed", 100);

      // STAGE 3: Start batch operation (15-20%)
      await updateProgress(fileId, "batch_processing", 16, "Initializing Document AI");

      const outputPrefix = `document-ai-results/${userId}/${uuidv4()}/`;
      const gcsOutputUriPrefix = `gs://${fileOutputBucket.name}/${outputPrefix}`;

      const operationName = await batchProcessDocument(
        [gcsInputUri],
        gcsOutputUriPrefix,
        mimetype
      );

      console.log(`[Document AI] Operation started: ${operationName}`);

      await ProcessingJob.updateJob(jobId, {
        gcs_input_uri: gcsInputUri,
        gcs_output_uri_prefix: gcsOutputUriPrefix,
        document_ai_operation_name: operationName,
        status: "running",
      });

      await smoothProgressIncrement(fileId, "batch_processing", 17, 20, "Batch processing started", 100);

      // Start background polling (20% -> 42%)
      console.log(`[Info] 🚀 Starting background polling for file: ${fileId}`);
      pollBatchProgress(fileId, jobId, operationName);

      console.log(`\n[Info] ✅ Batch processing initiated. Polling active.\n`);
    } else {
      console.log(`[processDocumentWithAI] ✅ Digital-native PDF detected - skipping Document AI batch processing`);
    }

  } catch (err) {
    console.error(`\n❌ [ERROR] Failed to process file ${fileId}:`, err.message);
    console.error(err.stack);
    await updateProgress(fileId, "error", 0, `Initialization failed: ${err.message}`);
    await ProcessingJob.updateJobStatus(jobId, "failed", err.message);
  }
}

/**
 * Processes digital-native PDF directly without Document AI
 */
// async function processDigitalNativePDF(fileId, extractedTexts, userId, secretId, jobId) {
//   try {
//     console.log(`[processDigitalNativePDF] Processing digital-native PDF directly (File ID: ${fileId})`);
    
//     // Fetch chunking method
//     let chunkingMethod = "recursive";
//     if (secretId) {
//       try {
//         const chunkMethodQuery = `
//           SELECT cm.method_name
//           FROM secret_manager sm
//           LEFT JOIN chunking_methods cm ON sm.chunking_method_id = cm.id
//           WHERE sm.id = $1
//         `;
//         const result = await pool.query(chunkMethodQuery, [secretId]);
//         if (result.rows.length > 0 && result.rows[0].method_name) {
//           chunkingMethod = result.rows[0].method_name;
//         }
//       } catch (err) {
//         console.warn(`[processDigitalNativePDF] Using default chunking method`);
//       }
//     }
    
//     console.log(`[processDigitalNativePDF] Chunking method: ${chunkingMethod}`);
//     await updateProgress(fileId, "processing", 45, `Chunking with ${chunkingMethod} method`);
    
//     // Chunk document
//     const chunks = await chunkDocument(extractedTexts, fileId, chunkingMethod);
//     console.log(`[processDigitalNativePDF] ✅ Generated ${chunks.length} chunks`);
    
//     if (chunks.length === 0) {
//       console.warn(`[processDigitalNativePDF] ⚠️ No chunks generated`);
//       await updateProgress(fileId, "processed", 100, "Completed (no content)");
//       await ProcessingJob.updateJobStatus(jobId, "completed");
//       return;
//     }
    
//     await updateProgress(fileId, "processing", 58, `Created ${chunks.length} chunks`);
    
//     // CRITICAL: Save chunks to database FIRST before queuing embeddings
//     await updateProgress(fileId, "processing", 60, "Saving chunks to database");
    
//     const chunksToSave = chunks.map((chunk, i) => ({
//       file_id: fileId,
//       chunk_index: i,
//       content: chunk.content,
//       token_count: chunk.token_count,
//       page_start: chunk.metadata?.page_start || null,
//       page_end: chunk.metadata?.page_end || null,
//       heading: chunk.metadata?.heading || null,
//     }));
    
//     const savedChunks = await FileChunk.saveMultipleChunks(chunksToSave);
//     console.log(`[processDigitalNativePDF] ✅ Saved ${savedChunks.length} chunks to database`);
    
//     if (savedChunks.length === 0) {
//       console.warn(`[processDigitalNativePDF] ⚠️ No chunks saved to database`);
//       await updateProgress(fileId, "processed", 100, "Completed (no chunks saved)");
//       await ProcessingJob.updateJobStatus(jobId, "completed");
//       return;
//     }
    
//     await updateProgress(fileId, "processing", 65, `${savedChunks.length} chunks saved to database`);
    
//     // Prepare embedding queue payload with saved chunk IDs
//     await updateProgress(fileId, "processing", 66, "Preparing embedding queue payload");
    
//     const embeddingQueuePayload = savedChunks.map((savedChunk) => {
//       const sourceChunk = chunks[savedChunk.chunk_index];
//       return {
//         chunkId: savedChunk.id,
//         chunkIndex: savedChunk.chunk_index,
//         content: sourceChunk.content,
//         tokenCount: sourceChunk.token_count,
//       };
//     });
    
//     console.log(`[processDigitalNativePDF] 🔄 Queueing ${embeddingQueuePayload.length} chunks for background embedding`);
    
//     // Queue embeddings for background processing
//     await enqueueEmbeddingJob({
//       fileId,
//       jobId,
//       chunks: embeddingQueuePayload,
//     });
    
//     await updateProgress(fileId, "processing", 68, "Embedding job queued");
    
//     // Mark as processed (embeddings will be generated in background)
//     await updateProgress(fileId, "processed", 100, "Processing completed (embeddings generating in background)");
//     await ProcessingJob.updateJobStatus(jobId, "completed");
    
//     console.log(`[processDigitalNativePDF] ✅ Digital-native PDF processing completed (File ID: ${fileId})`);
    
//   } catch (err) {
//     console.error(`[processDigitalNativePDF] ❌ Error:`, err.message);
//     console.error(err.stack);
//     await updateProgress(fileId, "error", 0, `Processing failed: ${err.message}`);
//     await ProcessingJob.updateJobStatus(jobId, "failed", err.message);
//   }
// }

// Find this function and replace it completely:

/**
 * Processes digital-native PDF directly without Document AI
 */
// async function processDigitalNativePDF(fileId, extractedTexts, userId, secretId, jobId) {
//   try {
//     console.log(`\n${'='.repeat(80)}`);
//     console.log(`[processDigitalNativePDF] Starting processing for File ID: ${fileId}`);
//     console.log(`${'='.repeat(80)}\n`);
    
//     // STAGE 1: Fetch chunking method (45-48%)
//     await updateProgress(fileId, "processing", 45, "Loading chunking configuration");
    
//     let chunkingMethod = "recursive";
//     if (secretId) {
//       try {
//         const chunkMethodQuery = `
//           SELECT cm.method_name
//           FROM secret_manager sm
//           LEFT JOIN chunking_methods cm ON sm.chunking_method_id = cm.id
//           WHERE sm.id = $1
//         `;
//         const result = await pool.query(chunkMethodQuery, [secretId]);
//         if (result.rows.length > 0 && result.rows[0].method_name) {
//           chunkingMethod = result.rows[0].method_name;
//         }
//       } catch (err) {
//         console.warn(`[processDigitalNativePDF] Error fetching chunking method: ${err.message}`);
//       }
//     }
    
//     console.log(`[processDigitalNativePDF] Chunking method: ${chunkingMethod}`);
//     await updateProgress(fileId, "processing", 48, `Configuration loaded: ${chunkingMethod}`);
    
//     // STAGE 2: Chunk document (48-58%)
//     await updateProgress(fileId, "processing", 50, "Starting chunking");
    
//     const chunks = await chunkDocument(extractedTexts, fileId, chunkingMethod);
//     console.log(`[processDigitalNativePDF] ✅ Generated ${chunks.length} chunks`);
    
//     if (chunks.length === 0) {
//       console.warn(`[processDigitalNativePDF] ⚠️ No chunks generated`);
//       await updateProgress(fileId, "processed", 100, "Completed (no content)");
//       await ProcessingJob.updateJobStatus(jobId, "completed");
//       return;
//     }
    
//     await updateProgress(fileId, "processing", 58, `Created ${chunks.length} chunks`);
    
//     // STAGE 3: Save chunks to database (58-68%)
//     await updateProgress(fileId, "processing", 60, "Saving chunks to database");
    
//     const chunksToSave = chunks.map((chunk, i) => ({
//       file_id: fileId,
//       chunk_index: i,
//       content: chunk.content,
//       token_count: chunk.token_count,
//       page_start: chunk.metadata?.page_start || null,
//       page_end: chunk.metadata?.page_end || null,
//       heading: chunk.metadata?.heading || null,
//     }));
    
//     console.log(`[processDigitalNativePDF] 💾 Saving ${chunksToSave.length} chunks to database...`);
//     const savedChunks = await FileChunk.saveMultipleChunks(chunksToSave);
//     console.log(`[processDigitalNativePDF] ✅ Saved ${savedChunks.length} chunks to database`);
    
//     // Verify chunks were saved correctly
//     if (savedChunks.length !== chunksToSave.length) {
//       console.warn(`[processDigitalNativePDF] ⚠️ Chunk count mismatch: expected ${chunksToSave.length}, saved ${savedChunks.length}`);
//     }
    
//     // Log chunk IDs for verification
//     const chunkIds = savedChunks.map(c => c.id);
//     console.log(`[processDigitalNativePDF] 📋 Saved chunk IDs: ${chunkIds.slice(0, 5).join(', ')}${chunkIds.length > 5 ? `... (${chunkIds.length} total)` : ''}`);
    
//     if (savedChunks.length === 0) {
//       console.warn(`[processDigitalNativePDF] ⚠️ No chunks saved to database`);
//       await updateProgress(fileId, "processed", 100, "Completed (no chunks saved)");
//       await ProcessingJob.updateJobStatus(jobId, "completed");
//       return;
//     }
    
//     await updateProgress(fileId, "processing", 68, `${savedChunks.length} chunks saved`);
    
//     // STAGE 4: Generate embeddings (68-78%)
//     await updateProgress(fileId, "processing", 70, "Generating embeddings");
    
//     const chunkContents = chunks.map(c => c.content);
//     console.log(`[processDigitalNativePDF] Generating embeddings for ${chunkContents.length} chunks`);
    
//     const embeddings = await generateEmbeddings(chunkContents);
//     console.log(`[processDigitalNativePDF] ✅ Generated ${embeddings.length} embeddings`);
    
//     await updateProgress(fileId, "processing", 75, "Embeddings generated");
    
//     // STAGE 5: Save vectors (75-85%)
//     await updateProgress(fileId, "processing", 76, "Saving vector embeddings");
    
//     console.log(`[processDigitalNativePDF] 🔗 Mapping chunks to embeddings...`);
//     const vectorsToSave = savedChunks.map((savedChunk) => {
//       const originalChunkIndex = savedChunk.chunk_index;
//       const embedding = embeddings[originalChunkIndex];
      
//       if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
//         console.warn(`[processDigitalNativePDF] ⚠️ Missing embedding for chunk ${savedChunk.id} at index ${originalChunkIndex}`);
//       }
      
//       return {
//         chunk_id: savedChunk.id,
//         embedding: embedding,
//         file_id: fileId,
//       };
//     });
    
//     // Filter out any vectors with missing embeddings
//     const validVectors = vectorsToSave.filter(v => v.embedding && Array.isArray(v.embedding) && v.embedding.length > 0);
//     if (validVectors.length !== vectorsToSave.length) {
//       console.warn(`[processDigitalNativePDF] ⚠️ Filtered out ${vectorsToSave.length - validVectors.length} vectors with missing embeddings`);
//     }
    
//     console.log(`[processDigitalNativePDF] 💾 Saving ${validVectors.length} vector embeddings to database...`);
//     const savedVectors = await ChunkVector.saveMultipleChunkVectors(validVectors);
//     console.log(`[processDigitalNativePDF] ✅ Saved ${savedVectors.length} vector embeddings to database`);
    
//     // Verify embeddings were saved correctly
//     if (savedVectors.length !== validVectors.length) {
//       console.warn(`[processDigitalNativePDF] ⚠️ Vector count mismatch: expected ${validVectors.length}, saved ${savedVectors.length}`);
//     }
    
//     // Log vector IDs for verification
//     const vectorIds = savedVectors.map(v => v.chunk_id);
//     console.log(`[processDigitalNativePDF] 📋 Saved vector chunk IDs: ${vectorIds.slice(0, 5).join(', ')}${vectorIds.length > 5 ? `... (${vectorIds.length} total)` : ''}`);
    
//     // Verify embeddings exist in database
//     try {
//       const verifyVectors = await ChunkVector.getVectorsByChunkIds(chunkIds.slice(0, 5));
//       console.log(`[processDigitalNativePDF] ✅ Verification: Found ${verifyVectors.length} embeddings in database for first 5 chunks`);
//     } catch (verifyError) {
//       console.warn(`[processDigitalNativePDF] ⚠️ Verification failed: ${verifyError.message}`);
//     }
    
//     await updateProgress(fileId, "processing", 85, "Vector embeddings saved");
    
//     // STAGE 6: Generate summary (85-95%)
//     await updateProgress(fileId, "processing", 86, "Generating document summary");
    
//     let summary = null;
//     try {
//       if (chunks.length > 0) {
//         const fullText = chunks.map(c => c.content).join("\n\n");
//         if (fullText.length > 0) {
//           summary = await getSummaryFromChunks(chunks.map(c => c.content));
//           await File.updateSummary(fileId, summary);
//           console.log(`[processDigitalNativePDF] ✅ Generated and saved summary`);
//         }
//       }
//     } catch (summaryError) {
//       console.warn(`[processDigitalNativePDF] ⚠️ Summary generation failed: ${summaryError.message}`);
//     }
    
//     await updateProgress(fileId, "processing", 95, "Summary completed");
    
//     // STAGE 7: Finalize (95-100%)
//     await updateProgress(fileId, "processing", 98, "Finalizing processing");
    
//     await File.updateProcessingStatus(fileId, "processed", 100, "Completed");
//     await ProcessingJob.updateJobStatus(jobId, "completed");
    
//     // Final verification: Check that chunks and embeddings are in database
//     console.log(`\n${'='.repeat(80)}`);
//     console.log(`[processDigitalNativePDF] 🔍 FINAL VERIFICATION`);
//     console.log(`${'='.repeat(80)}`);
    
//     try {
//       const verifyChunks = await FileChunk.getChunksByFileId(fileId);
//       console.log(`   ✅ Chunks in database: ${verifyChunks.length} (expected: ${savedChunks.length})`);
      
//       if (verifyChunks.length > 0) {
//         const verifyChunkIds = verifyChunks.map(c => c.id);
//         const verifyVectors = await ChunkVector.getVectorsByChunkIds(verifyChunkIds);
//         console.log(`   ✅ Embeddings in database: ${verifyVectors.length} (expected: ${savedVectors.length})`);
        
//         if (verifyVectors.length === 0) {
//           console.error(`   ❌ WARNING: Chunks exist but NO embeddings found!`);
//         } else if (verifyVectors.length < verifyChunks.length) {
//           console.warn(`   ⚠️ WARNING: Only ${verifyVectors.length} embeddings for ${verifyChunks.length} chunks`);
//         } else {
//           console.log(`   ✅ All chunks have embeddings!`);
//         }
//       }
//     } catch (verifyError) {
//       console.warn(`   ⚠️ Verification check failed: ${verifyError.message}`);
//     }
    
//     console.log(`\n${'='.repeat(80)}`);
//     console.log(`[processDigitalNativePDF] ✅ COMPLETED SUCCESSFULLY`);
//     console.log(`${'='.repeat(80)}`);
//     console.log(`   📄 File ID: ${fileId}`);
//     console.log(`   📦 Chunks Generated: ${chunks.length}`);
//     console.log(`   💾 Chunks Saved: ${savedChunks.length}`);
//     console.log(`   🔗 Embeddings Generated: ${embeddings.length}`);
//     console.log(`   💾 Embeddings Saved: ${savedVectors.length}`);
//     console.log(`   📝 Summary: ${summary ? 'Generated' : 'Skipped'}`);
//     console.log(`   ✅ Status: processed`);
//     console.log(`${'='.repeat(80)}\n`);
    
//   } catch (err) {
//     console.error(`\n${'='.repeat(80)}`);
//     console.error(`[processDigitalNativePDF] ❌ ERROR`);
//     console.error(`   - File ID: ${fileId}`);
//     console.error(`   - Error: ${err.message}`);
//     console.error(`   - Stack: ${err.stack}`);
//     console.error(`${'='.repeat(80)}\n`);
    
//     await updateProgress(fileId, "error", 0, `Processing failed: ${err.message}`);
//     await ProcessingJob.updateJobStatus(jobId, "failed", err.message);
//   }
// }

/**
 * Fixed: Processes digital-native PDF directly without Document AI
 * Ensures chunks AND embeddings are properly saved and verified
 */
async function processDigitalNativePDF(fileId, extractedTexts, userId, secretId, jobId) {
  try {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[processDigitalNativePDF] Starting processing for File ID: ${fileId}`);
    console.log(`${'='.repeat(80)}\n`);
    
    // STAGE 1: Fetch chunking method (45-48%)
    await updateProgress(fileId, "processing", 45, "Loading chunking configuration");
    
    let chunkingMethod = "recursive";
    if (secretId) {
      try {
        const chunkMethodQuery = `
          SELECT cm.method_name
          FROM secret_manager sm
          LEFT JOIN chunking_methods cm ON sm.chunking_method_id = cm.id
          WHERE sm.id = $1
        `;
        const result = await pool.query(chunkMethodQuery, [secretId]);
        if (result.rows.length > 0 && result.rows[0].method_name) {
          chunkingMethod = result.rows[0].method_name;
        }
      } catch (err) {
        console.warn(`[processDigitalNativePDF] Error fetching chunking method: ${err.message}`);
      }
    }
    
    console.log(`[processDigitalNativePDF] Chunking method: ${chunkingMethod}`);
    await updateProgress(fileId, "processing", 48, `Configuration loaded: ${chunkingMethod}`);
    
    // STAGE 2: Chunk document (48-58%)
    await updateProgress(fileId, "processing", 50, "Starting chunking");
    
    const chunks = await chunkDocument(extractedTexts, fileId, chunkingMethod);
    console.log(`[processDigitalNativePDF] ✅ Generated ${chunks.length} chunks`);
    
    if (chunks.length === 0) {
      console.warn(`[processDigitalNativePDF] ⚠️ No chunks generated`);
      await updateProgress(fileId, "processed", 100, "Completed (no content)");
      await ProcessingJob.updateJobStatus(jobId, "completed");
      return;
    }
    
    await updateProgress(fileId, "processing", 58, `Created ${chunks.length} chunks`);
    
    // STAGE 3: Save chunks to database (58-68%)
    await updateProgress(fileId, "processing", 60, "Saving chunks to database");
    
    const chunksToSave = chunks.map((chunk, i) => {
      // ✅ CRITICAL: Extract page_start and page_end from metadata (or chunk directly)
      const page_start = chunk.metadata?.page_start !== null && chunk.metadata?.page_start !== undefined
        ? chunk.metadata.page_start
        : (chunk.page_start !== null && chunk.page_start !== undefined ? chunk.page_start : null);
      const page_end = chunk.metadata?.page_end !== null && chunk.metadata?.page_end !== undefined
        ? chunk.metadata.page_end
        : (chunk.page_end !== null && chunk.page_end !== undefined ? chunk.page_end : null);
      
      // Debug: Log first few chunks to verify page info
      if (i < 3) {
        console.log(`[Save Chunks] Chunk ${i}: page_start=${page_start}, page_end=${page_end}, has metadata=${!!chunk.metadata}`);
      }
      
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
    
    console.log(`[processDigitalNativePDF] 💾 Saving ${chunksToSave.length} chunks to database...`);
    const savedChunks = await FileChunk.saveMultipleChunks(chunksToSave);
    console.log(`[processDigitalNativePDF] ✅ Saved ${savedChunks.length} chunks to database`);
    
    // ✅ CRITICAL FIX: Verify chunks were saved correctly
    if (savedChunks.length !== chunksToSave.length) {
      console.error(`[processDigitalNativePDF] ❌ Chunk count mismatch: expected ${chunksToSave.length}, saved ${savedChunks.length}`);
      throw new Error(`Chunk save failed: expected ${chunksToSave.length}, got ${savedChunks.length}`);
    }
    
    // Log chunk IDs for verification
    const chunkIds = savedChunks.map(c => c.id);
    console.log(`[processDigitalNativePDF] 📋 Saved chunk IDs: ${chunkIds.slice(0, 5).join(', ')}${chunkIds.length > 5 ? `... (${chunkIds.length} total)` : ''}`);
    
    await updateProgress(fileId, "processing", 68, `${savedChunks.length} chunks saved`);
    
    // STAGE 4: Generate embeddings (68-78%)
    await updateProgress(fileId, "processing", 70, "Generating embeddings");
    
    const chunkContents = chunks.map(c => c.content);
    console.log(`[processDigitalNativePDF] 🔄 Generating embeddings for ${chunkContents.length} chunks`);
    
    let embeddings;
    try {
      embeddings = await generateEmbeddings(chunkContents);
      console.log(`[processDigitalNativePDF] ✅ Generated ${embeddings.length} embeddings`);
      
      // ✅ CRITICAL FIX: Verify embeddings are valid
      if (embeddings.length !== chunkContents.length) {
        console.error(`[processDigitalNativePDF] ❌ Embedding count mismatch: expected ${chunkContents.length}, got ${embeddings.length}`);
        throw new Error(`Embedding generation failed: expected ${chunkContents.length}, got ${embeddings.length}`);
      }
      
      // Verify each embedding is valid
      for (let i = 0; i < embeddings.length; i++) {
        if (!embeddings[i] || !Array.isArray(embeddings[i]) || embeddings[i].length === 0) {
          console.error(`[processDigitalNativePDF] ❌ Invalid embedding at index ${i}`);
          throw new Error(`Invalid embedding at index ${i}: ${JSON.stringify(embeddings[i])}`);
        }
      }
      
    } catch (embeddingError) {
      console.error(`[processDigitalNativePDF] ❌ Embedding generation failed:`, embeddingError.message);
      throw embeddingError;
    }
    
    await updateProgress(fileId, "processing", 75, "Embeddings generated");
    
    // STAGE 5: Save vectors (75-85%)
    await updateProgress(fileId, "processing", 76, "Saving vector embeddings");
    
    console.log(`[processDigitalNativePDF] 🔗 Mapping chunks to embeddings...`);
    const vectorsToSave = savedChunks.map((savedChunk, index) => {
      const originalChunkIndex = savedChunk.chunk_index;
      const embedding = embeddings[originalChunkIndex];
      
      // ✅ CRITICAL FIX: Validate each vector before saving
      if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
        console.error(`[processDigitalNativePDF] ❌ Missing/invalid embedding for chunk ${savedChunk.id} at index ${originalChunkIndex}`);
        throw new Error(`Invalid embedding for chunk ${savedChunk.id}`);
      }
      
      return {
        chunk_id: savedChunk.id,
        embedding: embedding,
        file_id: fileId,
      };
    });
    
    console.log(`[processDigitalNativePDF] 💾 Saving ${vectorsToSave.length} vector embeddings to database...`);
    
    let savedVectors;
    try {
      savedVectors = await ChunkVector.saveMultipleChunkVectors(vectorsToSave);
      console.log(`[processDigitalNativePDF] ✅ Saved ${savedVectors.length} vector embeddings to database`);
      
      // ✅ CRITICAL FIX: Verify vectors were saved correctly
      if (savedVectors.length !== vectorsToSave.length) {
        console.error(`[processDigitalNativePDF] ❌ Vector count mismatch: expected ${vectorsToSave.length}, saved ${savedVectors.length}`);
        throw new Error(`Vector save failed: expected ${vectorsToSave.length}, got ${savedVectors.length}`);
      }
      
    } catch (vectorSaveError) {
      console.error(`[processDigitalNativePDF] ❌ Failed to save vectors:`, vectorSaveError.message);
      throw vectorSaveError;
    }
    
    // Log vector IDs for verification
    const vectorIds = savedVectors.map(v => v.chunk_id);
    console.log(`[processDigitalNativePDF] 📋 Saved vector chunk IDs: ${vectorIds.slice(0, 5).join(', ')}${vectorIds.length > 5 ? `... (${vectorIds.length} total)` : ''}`);
    
    await updateProgress(fileId, "processing", 85, "Vector embeddings saved");
    
    // ✅ CRITICAL FIX: IMMEDIATE VERIFICATION after saving
    console.log(`\n[processDigitalNativePDF] 🔍 IMMEDIATE VERIFICATION CHECK`);
    try {
      const verifyVectors = await ChunkVector.getVectorsByChunkIds(chunkIds);
      console.log(`   ✅ Verification: Found ${verifyVectors.length} embeddings in database for ${chunkIds.length} chunks`);
      
      if (verifyVectors.length === 0) {
        console.error(`   ❌ CRITICAL: Vectors were saved but CANNOT be retrieved!`);
        throw new Error('Vectors saved but retrieval failed - database issue');
      } else if (verifyVectors.length < chunkIds.length) {
        console.warn(`   ⚠️ WARNING: Only ${verifyVectors.length} embeddings retrieved for ${chunkIds.length} chunks`);
      } else {
        console.log(`   ✅ All ${chunkIds.length} embeddings verified successfully`);
      }
    } catch (verifyError) {
      console.error(`   ❌ Verification failed:`, verifyError.message);
      throw new Error(`Embedding verification failed: ${verifyError.message}`);
    }
    
    // STAGE 6: Generate summary (85-95%)
    await updateProgress(fileId, "processing", 86, "Generating document summary");
    
    let summary = null;
    try {
      if (chunks.length > 0) {
        const fullText = chunks.map(c => c.content).join("\n\n");
        if (fullText.length > 0) {
          summary = await getSummaryFromChunks(chunks.map(c => c.content));
          await File.updateSummary(fileId, summary);
          console.log(`[processDigitalNativePDF] ✅ Generated and saved summary`);
        }
      }
    } catch (summaryError) {
      console.warn(`[processDigitalNativePDF] ⚠️ Summary generation failed: ${summaryError.message}`);
    }
    
    await updateProgress(fileId, "processing", 95, "Summary completed");
    
    // STAGE 7: Finalize (95-100%)
    await updateProgress(fileId, "processing", 98, "Finalizing processing");
    
    await File.updateProcessingStatus(fileId, "processed", 100, "Completed");
    await ProcessingJob.updateJobStatus(jobId, "completed");
    
    // ✅ FINAL VERIFICATION: Check that chunks and embeddings are in database
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[processDigitalNativePDF] 🔍 FINAL VERIFICATION`);
    console.log(`${'='.repeat(80)}`);
    
    try {
      const verifyChunks = await FileChunk.getChunksByFileId(fileId);
      console.log(`   ✅ Chunks in database: ${verifyChunks.length} (expected: ${savedChunks.length})`);
      
      if (verifyChunks.length > 0) {
        const verifyChunkIds = verifyChunks.map(c => c.id);
        const verifyVectors = await ChunkVector.getVectorsByChunkIds(verifyChunkIds);
        console.log(`   ✅ Embeddings in database: ${verifyVectors.length} (expected: ${savedVectors.length})`);
        
        if (verifyVectors.length === 0) {
          console.error(`   ❌ CRITICAL ERROR: Chunks exist but NO embeddings found!`);
          throw new Error('No embeddings found after save - critical database issue');
        } else if (verifyVectors.length < verifyChunks.length) {
          console.warn(`   ⚠️ WARNING: Only ${verifyVectors.length} embeddings for ${verifyChunks.length} chunks`);
          throw new Error(`Incomplete embeddings: ${verifyVectors.length}/${verifyChunks.length}`);
        } else {
          console.log(`   ✅ SUCCESS: All ${verifyChunks.length} chunks have embeddings!`);
        }
      }
    } catch (verifyError) {
      console.error(`   ❌ Final verification failed:`, verifyError.message);
      // Mark as error since embeddings are missing
      await File.updateProcessingStatus(fileId, "error", 0, `Verification failed: ${verifyError.message}`);
      await ProcessingJob.updateJobStatus(jobId, "failed", verifyError.message);
      throw verifyError;
    }
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[processDigitalNativePDF] ✅ COMPLETED SUCCESSFULLY`);
    console.log(`${'='.repeat(80)}`);
    console.log(`   📄 File ID: ${fileId}`);
    console.log(`   📦 Chunks Generated: ${chunks.length}`);
    console.log(`   💾 Chunks Saved: ${savedChunks.length}`);
    console.log(`   🔗 Embeddings Generated: ${embeddings.length}`);
    console.log(`   💾 Embeddings Saved: ${savedVectors.length}`);
    console.log(`   📝 Summary: ${summary ? 'Generated' : 'Skipped'}`);
    console.log(`   ✅ Status: processed`);
    console.log(`   ✅ All verifications passed`);
    console.log(`${'='.repeat(80)}\n`);
    
  } catch (err) {
    console.error(`\n${'='.repeat(80)}`);
    console.error(`[processDigitalNativePDF] ❌ ERROR`);
    console.error(`   - File ID: ${fileId}`);
    console.error(`   - Error: ${err.message}`);
    console.error(`   - Stack: ${err.stack}`);
    console.error(`${'='.repeat(80)}\n`);
    
    await updateProgress(fileId, "error", 0, `Processing failed: ${err.message}`);
    await ProcessingJob.updateJobStatus(jobId, "failed", err.message);
  }
}
/**
 * Processes batch results after OCR completion (42% -> 100%)
 */
async function processBatchResults(file_id, job) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`[POST-PROCESSING] Starting for File ID: ${file_id}`);
  console.log(`${"=".repeat(80)}\n`);

  try {
    // Verify starting point
    const currentFile = await File.getFileById(file_id);
    console.log(`[POST-PROCESSING] Status: ${currentFile.status}, Progress: ${currentFile.processing_progress}%`);

    // STAGE 1: Fetch results (42-45%)
    await updateProgress(file_id, "processing", 42.5, "Fetching batch results");

    const bucketName = fileOutputBucket.name;
    const prefix = job.gcs_output_uri_prefix.replace(`gs://${bucketName}/`, "");

    await smoothProgressIncrement(file_id, "processing", 43, 44, "Retrieving processed documents", 100);

    const extractedBatchTexts = await fetchBatchResults(bucketName, prefix);
    console.log(`[Extraction] ✅ Retrieved ${extractedBatchTexts.length} text segments`);

    await updateProgress(file_id, "processing", 45, "Text extraction completed");

    if (!extractedBatchTexts?.length || extractedBatchTexts.every(item => !item.text?.trim())) {
      throw new Error("No text content extracted from document");
    }

    // ✅ NEW: Extract plain text and save to output bucket with file ID as filename
    try {
      // Combine all extracted text segments into a single plain text string
      const plainText = extractedBatchTexts
        .map(segment => segment.text || '')
        .filter(text => text.trim())
        .join('\n\n');
      
      if (plainText && plainText.trim()) {
        console.log(`[Save Extracted Text] Saving plain text (${plainText.length} chars) to output bucket`);
        
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
        console.log(`[Save Extracted Text] ✅ Saved to: ${outputTextUri}`);
        
        // Update database with the output path
        try {
          await File.updateFileOutputPath(file_id, outputTextUri);
          console.log(`[Save Extracted Text] ✅ Updated database with output path`);
        } catch (dbError) {
          console.warn(`[Save Extracted Text] ⚠️ Failed to update database (non-critical):`, dbError.message);
        }
      } else {
        console.warn(`[Save Extracted Text] ⚠️ No plain text to save (empty extraction)`);
      }
    } catch (saveError) {
      console.error(`[Save Extracted Text] ❌ Failed to save extracted text (non-critical):`, saveError.message);
      // Don't throw - this is non-critical, processing can continue
    }

    // STAGE 2: Fetch config (45-48%)
    await updateProgress(file_id, "processing", 45.5, "Loading chunking configuration");

    let chunkingMethod = "recursive";
    try {
      const chunkMethodQuery = `
        SELECT cm.method_name
        FROM processing_jobs pj
        LEFT JOIN secret_manager sm ON pj.secret_id = sm.id
        LEFT JOIN chunking_methods cm ON sm.chunking_method_id = cm.id
        WHERE pj.file_id = $1
        ORDER BY pj.created_at DESC
        LIMIT 1;
      `;
      const result = await pool.query(chunkMethodQuery, [file_id]);
      if (result.rows.length > 0 && result.rows[0].method_name) {
        chunkingMethod = result.rows[0].method_name;
      }
    } catch (err) {
      console.warn(`[Config] Using default chunking method`);
    }

    console.log(`[Config] Chunking method: ${chunkingMethod}`);
    await smoothProgressIncrement(file_id, "processing", 46, 48, `Configuration loaded: ${chunkingMethod}`, 100);

    // STAGE 3: Chunk document (48-58%)
    await updateProgress(file_id, "processing", 49, `Starting ${chunkingMethod} chunking`);
    await smoothProgressIncrement(file_id, "processing", 50, 54, "Chunking document", 100);

    // ✅ CRITICAL: Verify extracted texts have page information before chunking
    const textsWithPages = extractedBatchTexts.filter(t => t.page_start !== null && t.page_start !== undefined);
    const textsWithoutPages = extractedBatchTexts.length - textsWithPages.length;
    if (textsWithPages.length > 0) {
      const minPage = Math.min(...textsWithPages.map(t => t.page_start));
      const maxPage = Math.max(...textsWithPages.map(t => t.page_end || t.page_start));
      console.log(`[Chunking] ✅ ${textsWithPages.length} text segments have page numbers (page range: ${minPage} - ${maxPage})`);
    }
    if (textsWithoutPages > 0) {
      console.warn(`[Chunking] ⚠️ ${textsWithoutPages} text segments missing page numbers`);
    }

    const chunks = await chunkDocument(extractedBatchTexts, file_id, chunkingMethod);
    console.log(`[Chunking] ✅ Generated ${chunks.length} chunks`);

    // Verify chunks have page info in metadata
    const chunksWithPageInfo = chunks.filter(c => 
      (c.metadata?.page_start !== null && c.metadata?.page_start !== undefined) ||
      (c.page_start !== null && c.page_start !== undefined)
    );
    if (chunksWithPageInfo.length > 0) {
      console.log(`[Chunking] ✅ ${chunksWithPageInfo.length} chunks have page information in metadata`);
    } else {
      console.warn(`[Chunking] ⚠️ WARNING: No chunks have page information! This will cause citations to fail.`);
    }

    await smoothProgressIncrement(file_id, "processing", 55, 58, `Created ${chunks.length} chunks`, 100);

    if (chunks.length === 0) {
      console.warn(`[Warning] ⚠️ No chunks generated for file ${file_id}`);
      await updateProgress(file_id, "processed", 100, "Completed (no content)");
      await ProcessingJob.updateJobStatus(job.job_id, "completed");
      return;
    }

    // STAGE 4: Prepare background embedding job (58-68%)
    await updateProgress(file_id, "processing", 59, "Preparing embedding queue payload");
    const chunkContents = chunks.map(c => c.content);
    console.log(`[Embeddings] 🔄 Queueing ${chunkContents.length} chunks for background embedding`);
    await smoothProgressIncrement(file_id, "processing", 60, 66, "Collecting chunk metadata", 100);

    // STAGE 5: Save chunks (68-78%)
    await updateProgress(file_id, "processing", 67, "Preparing database storage");

    const chunksToSave = chunks.map((chunk, i) => {
      // ✅ CRITICAL: Extract page_start and page_end from metadata (or chunk directly)
      const page_start = chunk.metadata?.page_start !== null && chunk.metadata?.page_start !== undefined
        ? chunk.metadata.page_start
        : (chunk.page_start !== null && chunk.page_start !== undefined ? chunk.page_start : null);
      const page_end = chunk.metadata?.page_end !== null && chunk.metadata?.page_end !== undefined
        ? chunk.metadata.page_end
        : (chunk.page_end !== null && chunk.page_end !== undefined ? chunk.page_end : null);
      
      // Debug: Log first few chunks to verify page info
      if (i < 3) {
        console.log(`[Save Chunks] Chunk ${i}: page_start=${page_start}, page_end=${page_end}, has metadata=${!!chunk.metadata}`);
      }
      
      return {
        file_id: file_id,
        chunk_index: i,
        content: chunk.content,
        token_count: chunk.token_count,
        page_start: page_start,
        page_end: page_end || page_start, // Use page_start if page_end is null
        heading: chunk.metadata?.heading || chunk.heading || null,
      };
    });

    await smoothProgressIncrement(file_id, "processing", 68, 72, "Saving chunks to database", 100);

    const savedChunks = await FileChunk.saveMultipleChunks(chunksToSave);
    console.log(`[Database] ✅ Saved ${savedChunks.length} chunks`);

    await smoothProgressIncrement(file_id, "processing", 73, 78, `${savedChunks.length} chunks saved`, 100);

    // STAGE 6: Queue vectors for background worker (78% -> embedding_pending)
    const embeddingQueuePayload = savedChunks.map((savedChunk) => {
      const source = chunks[savedChunk.chunk_index];
      return {
        chunkId: savedChunk.id,
        chunkIndex: savedChunk.chunk_index,
        content: source.content,
        tokenCount: source.token_count,
      };
    });

    await enqueueEmbeddingJob({
      fileId: file_id,
      jobId: job.job_id,
      chunks: embeddingQueuePayload,
      progressBase: 78,
    });

    await updateProgress(file_id, "embedding_pending", 78, "Embeddings queued for background worker");

    // STAGE 7: Generate summary (78-88%)
    await updateProgress(file_id, "embedding_pending", 79, "Preparing summary generation");

    const fullText = chunks.map(c => c.content).join("\n\n");
    let summary = null;

    try {
      if (fullText.length > 0) {
        await smoothProgressIncrement(file_id, "embedding_pending", 80, 86, "Generating AI summary", 150);

        summary = await getSummaryFromChunks(chunks.map(c => c.content));
        await File.updateSummary(file_id, summary);

        console.log(`[Summary] ✅ Generated and saved`);
        await updateProgress(file_id, "embedding_pending", 88, "Summary saved");
      } else {
        await updateProgress(file_id, "embedding_pending", 88, "Summary skipped (empty content)");
      }
    } catch (summaryError) {
      console.warn(`⚠️ [Warning] Summary generation failed:`, summaryError.message);
      await updateProgress(file_id, "embedding_pending", 88, "Summary skipped (error)");
    }

    await updateProgress(file_id, "embedding_pending", 89, "Waiting for background embeddings to complete");
    console.log(`[Embeddings] Background task enqueued for file ${file_id}`);

  } catch (error) {
    console.error(`\n❌ [ERROR] Post-processing failed for ${file_id}:`, error.message);
    console.error(error.stack);

    try {
      await updateProgress(file_id, "error", 0, `Failed: ${error.message}`);
      await ProcessingJob.updateJobStatus(job.job_id, "failed", error.message);
    } catch (err) {
      console.error(`❌ Failed to update error status:`, err);
    }
  }
}

// ============================================================================
// STATUS API ENDPOINT - RETURNS REAL-TIME PROGRESS
// ============================================================================

/**
 * ✅ CRITICAL: This endpoint must return FRESH data from database
 */
// exports.getFileProcessingStatus = async (req, res) => {
//   try {
//     const { file_id } = req.params;

//     if (!file_id) {
//       return res.status(400).json({ 
//         success: false,
//         error: "file_id is required" 
//       });
//     }

//     // ✅ CRITICAL: Get FRESH data from database - NO CACHING
//     const file = await File.getFileById(file_id);

//     if (!file) {
//       return res.status(404).json({ 
//         success: false,
//         error: "File not found" 
//       });
//     }

//     if (String(file.user_id) !== String(req.user.id)) {
//       return res.status(403).json({ 
//         success: false,
//         error: "Access denied" 
//       });
//     }

//     const job = await ProcessingJob.getJobByFileId(file_id);

//     // ✅ Get REAL-TIME progress from database
//     let progress = parseFloat(file.processing_progress) || 0;
//     let status = file.status || 'unknown';
//     let operation = file.current_operation || getOperationName(progress, status);

//     // Round to 1 decimal place
//     progress = Math.round(progress * 10) / 10;
//     progress = Math.min(100, Math.max(0, progress));

//     // Log every status check
//     console.log(`[Status API] 📊 ${file_id.substring(0, 8)}... | ${progress.toFixed(1)}% | ${status} | ${operation}`);

//     // Base response
//     const response = {
//       success: true,
//       file_id: file.id,
//       filename: file.filename || file.original_filename,
//       status: status,
//       progress: progress,
//       progress_percentage: `${progress.toFixed(1)}%`,
//       current_operation: operation,
//       job_status: job?.status || "unknown",
//       last_updated: file.updated_at,
//       file_size: file.file_size,
//       mime_type: file.mime_type,
//     };

//     // CASE 1: Completed (100%)
//     if ((status === "processed" || status === "completed") && progress >= 100) {
//       const chunks = await FileChunk.getChunksByFileId(file_id);

//       if (chunks?.length > 0) {
//         const formattedChunks = chunks.map(chunk => ({
//           text: chunk.content,
//           metadata: {
//             page_start: chunk.page_start,
//             page_end: chunk.page_end,
//             heading: chunk.heading,
//           },
//         }));

//         return res.json({
//           ...response,
//           progress: 100,
//           progress_percentage: "100%",
//           current_operation: "Completed",
//           is_complete: true,
//           chunks: formattedChunks,
//           chunk_count: chunks.length,
//           summary: file.summary,
//         });
//       }
//     }

//     // CASE 2: Error
//     if (status === "error" || status === "failed") {
//       return res.json({
//         ...response,
//         progress: 0,
//         progress_percentage: "0%",
//         current_operation: "Failed",
//         is_error: true,
//         error_message: job?.error_message || operation || "Unknown error occurred",
//       });
//     }

//     // CASE 3: Processing (42-100%)
//     if (status === "processing") {
//       return res.json({
//         ...response,
//         is_processing: true,
//         message: "Document is being processed",
//         estimated_time_remaining: progress < 50 ? "5-10 minutes" : 
//                                   progress < 80 ? "2-5 minutes" : "Less than 2 minutes",
//       });
//     }

//     // CASE 4: Batch processing (0-42%)
//     if (status === "batch_processing") {
//       return res.json({
//         ...response,
//         is_processing: true,
//         message: "Document AI OCR is processing your document",
//         estimated_time_remaining: progress < 30 ? "5-10 minutes" : "2-5 minutes",
//       });
//     }

//     // CASE 5: Batch queued (0-15%)
//     if (status === "batch_queued") {
//       return res.json({
//         ...response,
//         is_processing: true,
//         message: "Document is queued for processing",
//         estimated_time_remaining: "Starting soon",
//       });
//     }

//     // CASE 6: Just uploaded
//     return res.json({
//       ...response,
//       progress: 0,
//       progress_percentage: "0%",
//       current_operation: "Queued",
//       is_queued: true,
//       message: "Document uploaded. Processing will begin shortly.",
//     });

//   } catch (error) {
//     console.error("❌ [Status API] Error:", error.message);
//     console.error(error.stack);

//     return res.status(500).json({
//       success: false,
//       error: "Failed to fetch processing status",
//       message: error.message,
//     });
//   }
// };
/**
 * Get real-time file processing status (Frontend-friendly)
 * Smoothly reflects each stage from 0% → 100%
 */
exports.getFileProcessingStatus = async (req, res) => {
  try {
    const { file_id } = req.params;

    if (!file_id) {
      return res.status(400).json({ success: false, error: "file_id is required" });
    }

    // ✅ Always fetch fresh data from DB
    const file = await File.getFileById(file_id);
    if (!file) {
      return res.status(404).json({ success: false, error: "File not found" });
    }

    // ✅ Authorization check
    if (String(file.user_id) !== String(req.user.id)) {
      return res.status(403).json({ success: false, error: "Access denied" });
    }

    // ✅ Get job info
    const job = await ProcessingJob.getJobByFileId(file_id);
    const progress = parseFloat(file.processing_progress) || 0;
    const status = file.status || "queued";
    const current_operation = file.current_operation || getOperationName(progress, status);

    // ✅ Unified response for all stages
    const baseResponse = {
      success: true,
      file_id: file.id,
      filename: file.filename || file.originalname,
      progress: parseFloat(progress.toFixed(1)),
      progress_percentage: `${progress.toFixed(1)}%`,
      status,
      current_operation,
      job_status: job?.status || "unknown",
      last_updated: file.updated_at,
      estimated_time_remaining:
        progress < 25
          ? "10-12 minutes"
          : progress < 50
            ? "6-8 minutes"
            : progress < 75
              ? "3-5 minutes"
              : progress < 90
                ? "1-2 minutes"
                : "Few seconds",
    };

    // ✅ CASE 1: Completed
    if ((status === "processed" || status === "completed") && progress >= 100) {
      const chunks = await FileChunk.getChunksByFileId(file_id);
      const formattedChunks = chunks.map((chunk) => ({
        text: chunk.content,
        metadata: {
          page_start: chunk.page_start,
          page_end: chunk.page_end,
          heading: chunk.heading,
        },
      }));
      return res.json({
        ...baseResponse,
        progress: 100,
        progress_percentage: "100%",
        current_operation: "Completed",
        is_complete: true,
        chunks: formattedChunks,
        summary: file.summary,
      });
    }

    // ✅ CASE 2: Error
    if (status === "error" || status === "failed") {
      return res.json({
        ...baseResponse,
        progress: 0,
        progress_percentage: "0%",
        current_operation: "Failed",
        is_error: true,
        error_message: job?.error_message || "Unknown error occurred",
      });
    }

    // ✅ CASE 3: Batch queued (0-15%)
    if (status === "batch_queued") {
      return res.json({
        ...baseResponse,
        is_processing: true,
        stage: "queued",
        message: "Document is queued for processing",
      });
    }

    // ✅ CASE 4: Batch processing (15-42%)
    if (status === "batch_processing") {
      return res.json({
        ...baseResponse,
        is_processing: true,
        stage: "ocr",
        message: "Performing OCR via Document AI",
      });
    }

    // ✅ CASE 5: Post-processing (42-100%)
    if (status === "processing") {
      let stage = "processing";
      if (progress < 45) stage = "fetching_results";
      else if (progress < 55) stage = "chunking";
      else if (progress < 75) stage = "embedding";
      else if (progress < 95) stage = "summarizing";
      else stage = "finalizing";

      return res.json({
        ...baseResponse,
        is_processing: true,
        stage,
        message: `Document is in ${stage.replace("_", " ")} stage`,
      });
    }

    // ✅ CASE 6: Just uploaded / awaiting processing
    return res.json({
      ...baseResponse,
      is_queued: true,
      progress: 0,
      current_operation: "Queued",
      message: "Document uploaded and queued for processing",
    });
  } catch (error) {
    console.error("❌ [getFileProcessingStatus] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch file processing status",
      details: error.message,
    });
  }
};

exports.createFolder = async (req, res) => {
  try {
    const { folderName, parentPath = '' } = req.body; // allow parent folder
    const userId = req.user.id;

    if (!folderName) {
      return res.status(400).json({ error: "Folder name is required" });
    }

    // Sanitize folder and parent names
    const cleanParentPath = parentPath ? parentPath.replace(/^\/+|\/+$/g, '') : '';
    const safeFolderName = sanitizeName(folderName.replace(/^\/+|\/+$/g, ''));

    // Construct full folder path
    const folderPath = cleanParentPath
      ? `${cleanParentPath}/${safeFolderName}`
      : safeFolderName;

    // GCS path for the folder
    const gcsPath = `${userId}/documents/${folderPath}/`;

    // Create placeholder file in GCS
    await uploadToGCS(".keep", Buffer.from(""), gcsPath, false, "text/plain");

    // Save folder record in DB
    const folder = await File.create({
      user_id: userId,
      originalname: safeFolderName,
      gcs_path: gcsPath,
      folder_path: cleanParentPath || null,
      mimetype: 'folder/x-directory',
      is_folder: true,
      status: "processed",
      processing_progress: 100,
      size: 0,
    });

    return res.status(201).json({ message: "Folder created", folder });
  } catch (error) {
    console.error("❌ createFolder error:", error);
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
};





/* ---------------------- Create Folder Internal (FIXED) ---------------------- */
async function createFolderInternal(userId, folderName, parentPath = "") {
  try {
    if (!folderName) {
      throw new Error("Folder name is required");
    }

    const safeFolderName = sanitizeName(folderName.replace(/^\/+|\/+$/g, ""));

    // FIX: Store folder_path consistently for querying later
    const folderPath = parentPath ? `${parentPath}/${safeFolderName}` : safeFolderName;

    // GCS path for folder
    const gcsPath = `${userId}/documents/${folderPath}/`;

    // Create placeholder file in GCS
    await uploadToGCS(".keep", Buffer.from(""), gcsPath, false, "text/plain");

    // FIX: Store the folder_path that will be used for file uploads
    const folder = await File.create({
      user_id: userId,
      originalname: safeFolderName,
      gcs_path: gcsPath,
      folder_path: folderPath, // This is what files will reference
      mimetype: "folder/x-directory",
      is_folder: true,
      status: "processed",
      processing_progress: 100,
      size: 0,
    });

    return folder;
  } catch (error) {
    console.error("❌ createFolderInternal error:", error);
    throw new Error("Failed to create folder: " + error.message);
  }
}

/* ---------------------- Create Case ---------------------- */


exports.createCase = async (req, res) => {
  const client = await pool.connect();

  try {
    const userId = parseInt(req.user?.id);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized user" });
    }

    const {
      case_title,
      case_number,
      filing_date,
      case_type,
      sub_type,
      court_name,
      court_level,
      bench_division,
      jurisdiction,
      state,
      judges,
      court_room_no,
      petitioners,
      respondents,
      category_type,
      primary_category,
      sub_category,
      complexity,
      monetary_value,
      priority_level,
      status = "Active",
    } = req.body;

    if (!case_title || !case_type || !court_name) {
      return res.status(400).json({
        error: "Missing required fields: case_title, case_type, court_name",
      });
    }

    await client.query("BEGIN");

    // Insert case
    const insertQuery = `
      INSERT INTO cases (
        user_id, case_title, case_number, filing_date, case_type, sub_type,
        court_name, court_level, bench_division, jurisdiction, state, judges,
        court_room_no, petitioners, respondents, category_type, primary_category,
        sub_category, complexity, monetary_value, priority_level, status
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17,
        $18, $19, $20, $21, $22
      )
      RETURNING *;
    `;

    const values = [
      userId,
      case_title,
      case_number,
      filing_date,
      case_type,
      sub_type,
      court_name,
      court_level,
      bench_division,
      jurisdiction,
      state,
      judges ? JSON.stringify(judges) : null,
      court_room_no,
      petitioners ? JSON.stringify(petitioners) : null,
      respondents ? JSON.stringify(respondents) : null,
      category_type,
      primary_category,
      sub_category,
      complexity,
      monetary_value,
      priority_level,
      status,
    ];

    const { rows: caseRows } = await client.query(insertQuery, values);
    const newCase = caseRows[0];

    // Create folder for the case
    const safeCaseName = sanitizeName(case_title);
    const parentPath = `${userId}/cases`;
    const folder = await createFolderInternal(userId, safeCaseName, parentPath);

    // Link folder to case
    const updateQuery = `
      UPDATE cases
      SET folder_id = $1
      WHERE id = $2
      RETURNING *;
    `;
    const { rows: updatedRows } = await client.query(updateQuery, [
      folder.id,
      newCase.id,
    ]);
    const updatedCase = updatedRows[0];

    await client.query("COMMIT");

    return res.status(201).json({
      message: "Case created successfully with folder",
      case: updatedCase,
      folder,
    });

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error creating case:", error);
    res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  } finally {
    client.release();
  }
};

/* ---------------------- Delete Case ---------------------- */
exports.deleteCase = async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = parseInt(req.user?.id);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized user" });
    }

    const { caseId } = req.params;
    if (!caseId) {
      return res.status(400).json({ error: "Case ID is required." });
    }

    await client.query("BEGIN");

    // 1. Get the case to find its associated folder_id
    const getCaseQuery = `SELECT folder_id FROM cases WHERE id = $1 AND user_id = $2;`;
    const { rows: caseRows } = await client.query(getCaseQuery, [caseId, userId]);

    if (caseRows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Case not found or not authorized." });
    }

    const folderId = caseRows[0].folder_id;

    // 2. Delete the case record
    const deleteCaseQuery = `DELETE FROM cases WHERE id = $1 AND user_id = $2 RETURNING *;`;
    const { rows: deletedCaseRows } = await client.query(deleteCaseQuery, [caseId, userId]);

    if (deletedCaseRows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Case not found or not authorized." });
    }

    // 3. Delete the associated folder from user_files
    if (folderId) {
      // First, get the gcs_path of the folder to delete its contents from GCS
      const getFolderQuery = `SELECT gcs_path FROM user_files WHERE id = $1::uuid AND user_id = $2 AND is_folder = TRUE;`;
      const { rows: folderRows } = await client.query(getFolderQuery, [folderId, userId]);

      if (folderRows.length > 0) {
        const gcsPath = folderRows[0].gcs_path;
        // Delete all files within the GCS folder (including the .keep file)
        await bucket.deleteFiles({
          prefix: gcsPath,
        });
        console.log(`🗑️ Deleted GCS objects with prefix: ${gcsPath}`);
      }

      // Now delete the folder record itself from user_files
      const deleteFolderQuery = `DELETE FROM user_files WHERE id = $1::uuid AND user_id = $2;`;
      await client.query(deleteFolderQuery, [folderId, userId]);
      console.log(`🗑️ Deleted folder record with ID: ${folderId}`);
    }

    await client.query("COMMIT");

    return res.status(200).json({
      message: "Case and associated folder deleted successfully.",
      deletedCase: deletedCaseRows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error deleting case:", error);
    res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  } finally {
    client.release();
  }
};

/* ---------------------- Update Case ---------------------- */
exports.updateCase = async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = parseInt(req.user?.id);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized user" });
    }

    const { caseId } = req.params;
    if (!caseId) {
      return res.status(400).json({ error: "Case ID is required." });
    }

    const {
      case_title,
      case_number,
      filing_date,
      case_type,
      sub_type,
      court_name,
      court_level,
      bench_division,
      jurisdiction,
      state,
      judges,
      court_room_no,
      petitioners,
      respondents,
      category_type,
      primary_category,
      sub_category,
      complexity,
      monetary_value,
      priority_level,
      status, // Allow updating status (e.g., 'Active', 'Inactive', 'Closed')
    } = req.body;

    const updates = {};
    if (case_title !== undefined) updates.case_title = case_title;
    if (case_number !== undefined) updates.case_number = case_number;
    if (filing_date !== undefined) updates.filing_date = filing_date;
    if (case_type !== undefined) updates.case_type = case_type;
    if (sub_type !== undefined) updates.sub_type = sub_type;
    if (court_name !== undefined) updates.court_name = court_name;
    if (court_level !== undefined) updates.court_level = court_level;
    if (bench_division !== undefined) updates.bench_division = bench_division;
    if (jurisdiction !== undefined) updates.jurisdiction = jurisdiction;
    if (state !== undefined) updates.state = state;
    if (judges !== undefined) updates.judges = judges ? JSON.stringify(judges) : null;
    if (court_room_no !== undefined) updates.court_room_no = court_room_no;
    if (petitioners !== undefined) updates.petitioners = petitioners ? JSON.stringify(petitioners) : null;
    if (respondents !== undefined) updates.respondents = respondents ? JSON.stringify(respondents) : null;
    if (category_type !== undefined) updates.category_type = category_type;
    if (primary_category !== undefined) updates.primary_category = primary_category;
    if (sub_category !== undefined) updates.sub_category = sub_category;
    if (complexity !== undefined) updates.complexity = complexity;
    if (monetary_value !== undefined) updates.monetary_value = monetary_value;
    if (priority_level !== undefined) updates.priority_level = priority_level;
    if (status !== undefined) updates.status = status; // Update case status

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No update fields provided." });
    }

    const fields = Object.keys(updates).map((key, index) => `${key} = $${index + 3}`).join(', ');
    const values = Object.values(updates);

    const updateQuery = `
      UPDATE cases
      SET ${fields}, updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING *;
    `;

    const { rows: updatedCaseRows } = await client.query(updateQuery, [caseId, userId, ...values]);

    if (updatedCaseRows.length === 0) {
      return res.status(404).json({ error: "Case not found or not authorized." });
    }

    await client.query("COMMIT");

    return res.status(200).json({
      message: "Case updated successfully.",
      case: updatedCaseRows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error updating case:", error);
    res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  } finally {
    client.release();
  }
};

/* ---------------------- Get Case by ID ---------------------- */


exports.getCase = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { caseId } = req.params;

    if (!userId) return res.status(401).json({ error: "Unauthorized user" });
    if (!caseId) return res.status(400).json({ error: "Case ID is required." });

    // 1️⃣ Fetch case details
    const caseQuery = `
      SELECT * FROM cases
      WHERE id = $1 AND user_id = $2;
    `;
    const { rows: caseRows } = await pool.query(caseQuery, [caseId, userId]);
    if (caseRows.length === 0) {
      return res.status(404).json({ error: "Case not found or not authorized." });
    }

    const caseData = caseRows[0];

    // 2️⃣ Fetch the main folder for this case
    const folderQuery = `
      SELECT *
      FROM user_files
      WHERE user_id = $1
        AND is_folder = true
        AND folder_path LIKE $2
      ORDER BY created_at ASC
      LIMIT 1;
    `;
    // Assuming folder_path contains the case title
    const folderPathPattern = `%${caseData.case_title}%`;
    const { rows: folderRows } = await pool.query(folderQuery, [userId, folderPathPattern]);

    // 3️⃣ Prepare folder metadata
    const folders = folderRows.map(folder => ({
      id: folder.id,
      name: folder.originalname,
      folder_path: folder.folder_path,
      created_at: folder.created_at,
      updated_at: folder.updated_at,
      children: [], // Files will be fetched when user opens this folder
    }));

    // 4️⃣ Attach folders to case
    caseData.folders = folders;

    return res.status(200).json({
      message: "Case fetched successfully.",
      case: caseData,
    });

  } catch (error) {
    console.error("❌ Error fetching case:", error);
    res.status(500).json({ message: "Internal server error", details: error.message });
  }
};


exports.getFolders = async (req, res) => {
  try {
    const userId = req.user.id;
    const files = await File.findByUserId(userId);

    // Separate folders and files
    const folders = files
      .filter(file => file.is_folder)
      .map(folder => ({
        id: folder.id,
        name: folder.originalname,
        folder_path: folder.folder_path,
        created_at: folder.created_at,
      }));

    const actualFiles = files.filter(file => !file.is_folder);

    // Generate signed URLs for files
    const signedFiles = await Promise.all(
      actualFiles.map(async (file) => {
        let signedUrl = null;
        try {
          signedUrl = await getSignedUrl(file.gcs_path);
        } catch (err) {
          console.error('Error generating signed URL:', err);
        }
        return {
          id: file.id,
          name: file.originalname,
          size: file.size,
          mimetype: file.mimetype,
          created_at: file.created_at,
          folder_path: file.folder_path,
          url: signedUrl,
        };
      })
    );

    // Optionally: organize files under their folders
    const folderMap = {};
    folders.forEach(folder => {
      folder.children = [];
      folderMap[folder.folder_path ? folder.folder_path + '/' + folder.name : folder.name] = folder;
    });

    signedFiles.forEach(file => {
      const parentFolderKey = file.folder_path || '';
      if (folderMap[parentFolderKey]) {
        folderMap[parentFolderKey].children.push(file);
      }
    });

    return res.status(200).json({ folders });
  } catch (error) {
    console.error('Error fetching user files and folders:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};



/* ---------------------- Upload Documents (FIXED) ---------------------- */
/**
 * Generate signed URL for direct upload to GCS (for large files >32MB)
 * @route POST /:folderName/generate-upload-url
 */
exports.generateUploadUrl = async (req, res) => {
  try {
    const userId = req.user.id;
    const { folderName } = req.params;
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
    const authorizationHeader = req.headers.authorization;
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

    // Find the folder
    const folderQuery = `
      SELECT * FROM user_files
      WHERE user_id = $1
        AND is_folder = true
        AND originalname = $2
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const { rows: folderRows } = await pool.query(folderQuery, [userId, folderName]);

    if (folderRows.length === 0) {
      return res.status(404).json({
        error: `Folder "${folderName}" not found for this user.`,
      });
    }

    const folderRow = folderRows[0];
    const ext = path.extname(filename);
    const baseName = path.basename(filename, ext);
    const safeName = sanitizeName(baseName) + ext;
    const key = `${folderRow.gcs_path}${safeName}`;
    const uniqueKey = await ensureUniqueKey(key);

    // Generate signed URL for upload (15 minutes expiry)
    const signedUrl = await getSignedUploadUrl(
      uniqueKey,
      mimetype || 'application/octet-stream',
      15,
      false // Use default bucket, not input bucket
    );

    return res.status(200).json({
      signedUrl,
      gcsPath: uniqueKey,
      filename: safeName,
      folderPath: folderRow.folder_path,
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
 * Handle post-upload processing after file is uploaded via signed URL
 * @route POST /:folderName/complete-upload
 */
exports.completeSignedUpload = async (req, res) => {
  try {
    const userId = req.user.id;
    const { folderName } = req.params;
    const { gcsPath, filename, mimetype, size, secret_id } = req.body;

    if (!gcsPath || !filename || !size) {
      return res.status(400).json({ error: "gcsPath, filename, and size are required" });
    }

    // Find the folder
    const folderQuery = `
      SELECT * FROM user_files
      WHERE user_id = $1
        AND is_folder = true
        AND originalname = $2
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const { rows: folderRows } = await pool.query(folderQuery, [userId, folderName]);

    if (folderRows.length === 0) {
      return res.status(404).json({
        error: `Folder "${folderName}" not found for this user.`,
      });
    }

    const folderRow = folderRows[0];

    // Verify file exists in GCS
    const fileRef = bucket.file(gcsPath);
    const [exists] = await fileRef.exists();
    if (!exists) {
      return res.status(404).json({ error: "File not found in storage. Upload may have failed." });
    }

    // Check storage limits
    const authorizationHeader = req.headers.authorization;
    const { usage: userUsage, plan: userPlan } = await TokenUsageService.getUserUsageAndPlan(userId, authorizationHeader);
    
    // Use ACTUAL file size from GCS metadata as source of truth
    const [metadata] = await fileRef.getMetadata();
    const actualFileSize = parseInt(metadata.size) || parseInt(size);
    
    // Convert size to number if it's a string
    const fileSizeBytes = typeof actualFileSize === 'string' ? parseInt(actualFileSize, 10) : Number(actualFileSize);
    
    if (isNaN(fileSizeBytes) || fileSizeBytes <= 0) {
      await fileRef.delete().catch(err => console.error("Failed to delete file:", err));
      return res.status(400).json({ 
        error: "Invalid file size. Unable to determine file size." 
      });
    }
    
    // Check free tier file size limit using ACTUAL file size from GCS
    const fileSizeCheck = TokenUsageService.checkFreeTierFileSize(fileSizeBytes, userPlan);
    if (!fileSizeCheck.allowed) {
      console.log(`\n${'🆓'.repeat(40)}`);
      console.log(`[FREE TIER] File upload REJECTED - actual file size exceeds limit`);
      console.log(`[FREE TIER] File: ${filename}`);
      console.log(`[FREE TIER] Actual file size from GCS: ${(fileSizeBytes / (1024 * 1024)).toFixed(2)} MB`);
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
        actualFileSizeMB: (fileSizeBytes / (1024 * 1024)).toFixed(2)
      });
    }
    
    const storageLimitCheck = await checkStorageLimit(userId, fileSizeBytes, userPlan);
    if (!storageLimitCheck.allowed) {
      // Delete the uploaded file if storage limit exceeded
      await fileRef.delete().catch(err => console.error("Failed to delete file:", err));
      return res.status(403).json({ error: storageLimitCheck.message });
    }

    // Calculate requested resources (use actual file size from GCS)
    const { DOCUMENT_UPLOAD_COST_TOKENS } = require("../middleware/checkTokenLimits");
    const requestedResources = {
      tokens: DOCUMENT_UPLOAD_COST_TOKENS,
      documents: 1,
      ai_analysis: 1,
      storage_gb: fileSizeBytes / (1024 ** 3),
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

    // ✅ CRITICAL: Save file metadata to database FIRST before processing
    // This ensures the file record exists even if processing fails
    let savedFile;
    try {
      console.log(`💾 [completeSignedUpload] Saving file metadata to database...`);
      savedFile = await File.create({
        user_id: userId,
        originalname: filename,
        gcs_path: gcsPath,
        folder_path: folderRow.folder_path,
        mimetype: mimetype || 'application/octet-stream',
        size: fileSizeBytes, // Use actual size from GCS metadata
        is_folder: false,
        status: "queued",
        processing_progress: 0,
      });
      console.log(`✅ [completeSignedUpload] File saved to database with ID: ${savedFile.id}`);
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

    // Download file buffer for processing (since we need it for processDocumentWithAI)
    const [fileBuffer] = await fileRef.download();

    // Process document asynchronously
    processDocumentWithAI(
      savedFile.id,
      fileBuffer,
      mimetype || 'application/octet-stream',
      userId,
      filename,
      secret_id
    ).catch(err =>
      console.error(`❌ Background processing failed for ${savedFile.id}:`, err.message)
    );

    const previewUrl = await makeSignedReadUrl(gcsPath, 15);

    return res.status(201).json({
      message: "File uploaded and processing started.",
      document: {
        ...savedFile,
        previewUrl,
        status: "uploaded_and_queued",
      },
      folderInfo: {
        folderName: folderRow.originalname,
        folder_path: folderRow.folder_path,
        gcs_path: folderRow.gcs_path
      }
    });
  } catch (error) {
    console.error("❌ completeSignedUpload error:", error);
    res.status(500).json({
      error: "Failed to complete upload",
      details: error.message
    });
  }
};

exports.uploadDocumentsToCaseByFolderName = async (req, res) => {
  try {
    const username = req.user.username;
    const userId = req.user.id;
    const { folderName } = req.params;
    const { secret_id } = req.body;

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    console.log(`📁 Uploading to folder: ${folderName} for user: ${username}`);

    // FIX 1: Find the folder using the stored folder_path pattern
    const folderQuery = `
      SELECT * FROM user_files
      WHERE user_id = $1
        AND is_folder = true
        AND originalname = $2
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const { rows: folderRows } = await pool.query(folderQuery, [userId, folderName]);

    if (folderRows.length === 0) {
      return res.status(404).json({
        error: `Folder "${folderName}" not found for this user.`,
        debug: { userId, folderName }
      });
    }

    const folderRow = folderRows[0];

    // FIX 2: Use the folder_path from the database for consistency
    let folderPathForFiles = folderRow.folder_path;

    console.log(`📁 Found folder. Database folder_path: ${folderPathForFiles}`);
    console.log(`📁 GCS path: ${folderRow.gcs_path}`);

    // Get user plan for free tier checks
    const authorizationHeader = req.headers.authorization;
    const { plan: userPlan } = await TokenUsageService.getUserUsageAndPlan(userId, authorizationHeader);

    // Upload each file
    const uploadedFiles = [];
    for (const file of req.files) {
      // Convert size to number if needed
      const fileSizeBytes = typeof file.size === 'string' ? parseInt(file.size, 10) : Number(file.size);
      
      // Check free tier file size limit BEFORE uploading
      const fileSizeCheck = TokenUsageService.checkFreeTierFileSize(fileSizeBytes, userPlan);
      if (!fileSizeCheck.allowed) {
        console.log(`\n${'🆓'.repeat(40)}`);
        console.log(`[FREE TIER] File upload rejected - size limit exceeded`);
        console.log(`[FREE TIER] File: ${file.originalname}`);
        console.log(`[FREE TIER] File size: ${(fileSizeBytes / (1024 * 1024)).toFixed(2)} MB`);
        console.log(`[FREE TIER] Max allowed: ${fileSizeCheck.maxSizeMB || 10} MB`);
        console.log(`${'🆓'.repeat(40)}\n`);
        
        uploadedFiles.push({
          originalname: file.originalname,
          error: fileSizeCheck.message,
          shortMessage: fileSizeCheck.shortMessage || fileSizeCheck.message,
          status: "failed",
          fileSizeMB: fileSizeCheck.fileSizeMB,
          fileSizeGB: fileSizeCheck.fileSizeGB,
          maxSizeMB: fileSizeCheck.maxSizeMB,
          upgradeRequired: true,
          planType: 'free',
          limit: `${fileSizeCheck.maxSizeMB} MB`
        });
        continue;
      }
      try {
        const ext = path.extname(file.originalname);
        const baseName = path.basename(file.originalname, ext);
        const safeName = sanitizeName(baseName) + ext;

        // FIX 3: Build the GCS key using the folder's gcs_path
        const key = `${folderRow.gcs_path}${safeName}`;
        const uniqueKey = await ensureUniqueKey(key);

        console.log(`📄 Uploading file: ${safeName} to ${uniqueKey}`);

        const fileRef = bucket.file(uniqueKey);
        await fileRef.save(file.buffer, {
          resumable: false,
          metadata: { contentType: file.mimetype },
        });

        console.log(`✅ File uploaded to GCS: ${uniqueKey}`);

        // ✅ CRITICAL: Store with the same folder_path for consistent querying
        // Save to DB immediately after GCS upload to ensure record exists
        let savedFile;
        try {
          savedFile = await File.create({
            user_id: userId,
            originalname: safeName,
            gcs_path: uniqueKey,
            folder_path: folderPathForFiles, // Use the folder's folder_path
            mimetype: file.mimetype,
            size: file.size,
            is_folder: false,
            status: "queued",
            processing_progress: 0,
          });
          console.log(`✅ File saved to DB with ID: ${savedFile.id}, folder_path: ${folderPathForFiles}`);
        } catch (dbError) {
          console.error(`❌ Failed to save file to database:`, dbError);
          // Delete file from GCS if DB save fails
          await fileRef.delete().catch(err => console.error("Failed to delete file after DB error:", err));
          throw dbError; // Re-throw to be caught by outer try-catch
        }

        const previewUrl = await makeSignedReadUrl(uniqueKey, 15);

        // Process document
        processDocumentWithAI(
          savedFile.id,
          file.buffer,
          file.mimetype,
          userId,
          safeName,
          secret_id
        ).catch(err =>
          console.error(`❌ Background processing failed for ${savedFile.id}:`, err.message)
        );

        uploadedFiles.push({
          ...savedFile,
          previewUrl,
          status: "uploaded_and_queued",
        });
      } catch (fileError) {
        console.error(`❌ Error uploading file ${file.originalname}:`, fileError);
        uploadedFiles.push({
          originalname: file.originalname,
          error: fileError.message,
          status: "failed"
        });
      }
    }

    return res.status(201).json({
      message: "Documents uploaded to case folder and processing started.",
      documents: uploadedFiles,
      folderInfo: {
        folderName: folderRow.originalname,
        folder_path: folderPathForFiles,
        gcs_path: folderRow.gcs_path
      }
    });

  } catch (error) {
    console.error("❌ uploadDocumentsToCaseByFolderName error:", error);
    res.status(500).json({
      error: "Internal server error",
      details: error.message
    });
  }
};

exports.deleteDocument = async (req, res) => {
  try {
    const userId = req.user.id;
    const { fileId } = req.params;

    // 1️⃣ Validate file existence and ownership
    const { rows } = await pool.query(
      `SELECT * FROM user_files WHERE id = $1 AND user_id = $2 AND is_folder = false`,
      [fileId, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: "File not found or access denied",
        debug: { fileId, userId },
      });
    }

    const fileRow = rows[0];
    const gcsPath = fileRow.gcs_path;

    console.log(`🗑️ Deleting file: ${fileRow.originalname} (${gcsPath})`);

    // 2️⃣ Delete from Google Cloud Storage
    const fileRef = bucket.file(gcsPath);
    const [exists] = await fileRef.exists();

    if (exists) {
      await fileRef.delete();
      console.log(`✅ GCS file deleted: ${gcsPath}`);
    } else {
      console.warn(`⚠️ File not found in GCS: ${gcsPath}`);
    }

    // 3️⃣ Delete from database
    await pool.query(`DELETE FROM user_files WHERE id = $1`, [fileId]);
    console.log(`✅ DB record deleted for file ID: ${fileId}`);

    // 4️⃣ Response
    return res.status(200).json({
      message: "File deleted successfully",
      deletedFile: {
        id: fileId,
        originalname: fileRow.originalname,
        folder_path: fileRow.folder_path,
        gcs_path: gcsPath,
      },
    });
  } catch (error) {
    console.error("❌ deleteDocument error:", error);
    return res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  }
};
/* ----------------- Enhanced Folder Summary ----------------- */
exports.getFolderSummary = async (req, res) => {
  const userId = req.user.id;
  const authorizationHeader = req.headers.authorization;

  try {
    const { folderName } = req.params;

    // 1. Fetch user's usage and plan details
    const { usage, plan, timeLeft } = await TokenUsageService.getUserUsageAndPlan(userId, authorizationHeader);

    const files = await File.findByUserIdAndFolderPath(userId, folderName);
    console.log(`[getFolderSummary] Found files in folder '${folderName}' for user ${userId}:`, files.map(f => ({ id: f.id, originalname: f.originalname, status: f.status })));

    const processed = files.filter((f) => !f.is_folder && f.status === "processed");
    console.log(`[getFolderSummary] Processed documents in folder '${folderName}':`, processed.map(f => ({ id: f.id, originalname: f.originalname })));

    if (processed.length === 0) {
      return res.status(404).json({ error: "No processed documents in folder" });
    }

    let combinedText = "";
    let documentDetails = [];

    for (const f of processed) {
      const chunks = await FileChunk.getChunksByFileId(f.id);
      const fileText = chunks.map((c) => c.content).join("\n\n");
      combinedText += `\n\n[Document: ${f.originalname}]\n${fileText}`;

      documentDetails.push({
        name: f.originalname,
        summary: f.summary || "Summary not available",
        chunkCount: chunks.length
      });
    }

    // Calculate token cost for summary generation
    const summaryCost = Math.ceil(combinedText.length / 200); // Rough estimate

    // 2. Enforce token limits for summary generation
    const requestedResources = { tokens: summaryCost, ai_analysis: 1 };
    const { allowed, message } = await TokenUsageService.enforceLimits(usage, plan, requestedResources);

    if (!allowed) {
      return res.status(403).json({
        error: `Summary generation failed: ${message}`,
        timeLeftUntilReset: timeLeft
      });
    }

    const summary = await getSummaryFromChunks(combinedText);

    // 3. Increment usage after successful summary generation
    await TokenUsageService.incrementUsage(userId, requestedResources);

    const savedChat = await FolderChat.saveFolderChat(
      userId,
      folderName,
      `Summary for folder "${folderName}"`,
      summary,
      null,
      processed.map(f => f.id),
      [],
      false,
      null,
      null,
      []
    );

    return res.json({
      folder: folderName,
      summary,
      documentCount: processed.length,
      documents: documentDetails,
      session_id: savedChat.session_id,
    });
  } catch (error) {
    console.error("❌ getFolderSummary error:", error);
    res.status(500).json({ error: "Failed to generate folder summary", details: error.message });
  }
};


// exports.queryFolderDocuments = async (req, res) => {
//   let chatCost;
//   let userId = req.user.id;
//   const authorizationHeader = req.headers.authorization;

//   try {
//     const { folderName } = req.params;
//     const {
//       question,
//       prompt_label = null,
//       session_id = null,
//       maxResults = 10,
//       secret_id,
//       llm_name,
//       additional_input = "",
//     } = req.body;

//     // Dynamically determine if a secret prompt is being used
//     let used_secret_prompt = !!secret_id; // If secret_id is present, it's a secret prompt

//     if (!folderName) {
//       return res.status(400).json({ error: "folderName is required." });
//     }

//     const finalSessionId = session_id || `session-${Date.now()}`;
//     console.log(`📁 Querying folder: ${folderName} | used_secret_prompt=${used_secret_prompt} | secret_id=${secret_id}`);

//     // 1️⃣ Get user plan & usage
//     const { usage, plan, timeLeft } = await TokenUsageService.getUserUsageAndPlan(
//       userId,
//       authorizationHeader
//     );

//     // 2️⃣ Fetch all processed files in folder
//     const folderPattern = `%${folderName}%`;
//     const filesQuery = `
//       SELECT id, originalname, folder_path, status
//       FROM user_files
//       WHERE user_id = $1
//         AND is_folder = false
//         AND status = 'processed'
//         AND folder_path LIKE $2
//       ORDER BY created_at DESC;
//     `;
//     const { rows: files } = await pool.query(filesQuery, [userId, folderPattern]);

//     if (files.length === 0) {
//       return res.status(404).json({ error: "No processed files found in this folder." });
//     }

//     console.log(`📄 Found ${files.length} processed files in folder "${folderName}"`);

//     // 3️⃣ Collect all chunks across all files
//     let allChunks = [];
//     for (const file of files) {
//       const chunks = await FileChunk.getChunksByFileId(file.id);
//       allChunks.push(
//         ...chunks.map((chunk) => ({
//           ...chunk,
//           file_id: file.id,
//           filename: file.originalname,
//         }))
//       );
//     }

//     if (allChunks.length === 0) {
//       return res.status(400).json({ error: "No content found in folder documents." });
//     }

//     console.log(`🧩 Total chunks aggregated: ${allChunks.length}`);

//     // 4️⃣ Initialize variables
//     let answer;
//     let usedChunkIds = [];
//     let storedQuestion; // This will be what we store in the DB
//     let displayQuestion; // This will be what we show to the user
//     let finalPromptLabel = prompt_label;
//     let provider = "gemini";

//     // ================================
//     // CASE 1: SECRET PROMPT
//     // ================================
//     if (used_secret_prompt) {
//       if (!secret_id)
//         return res.status(400).json({ error: "secret_id is required for secret prompts." });

//       console.log(`🔐 Using secret prompt id=${secret_id}`);

//       // Fetch secret metadata
//       const secretQuery = `
//         SELECT s.id, s.name, s.secret_manager_id, s.version, s.llm_id, l.name AS llm_name
//         FROM secret_manager s
//         LEFT JOIN llm_models l ON s.llm_id = l.id
//         WHERE s.id = $1;
//       `;
//       const secretResult = await pool.query(secretQuery, [secret_id]);
//       if (secretResult.rows.length === 0)
//         return res.status(404).json({ error: "Secret configuration not found." });

//       const { name: secretName, secret_manager_id, version, llm_name: dbLlmName } =
//         secretResult.rows[0];

//       // ✅ FIX: Store only the secret name, not the actual secret content
//       finalPromptLabel = secretName;
//       storedQuestion = secretName; // Store the prompt name in DB
//       displayQuestion = `Analysis: ${secretName}`; // Display format for frontend

//       provider = resolveProviderName(llm_name || dbLlmName || "gemini");

//       // Fetch secret value securely from GCP Secret Manager
//       const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");
//       const secretClient = new SecretManagerServiceClient();
//       const GCLOUD_PROJECT_ID = process.env.GCLOUD_PROJECT_ID;

//       const gcpSecretName = `projects/${GCLOUD_PROJECT_ID}/secrets/${secret_manager_id}/versions/${version}`;
//       const [accessResponse] = await secretClient.accessSecretVersion({ name: gcpSecretName });
//       const secretValue = accessResponse.payload.data.toString("utf8");

//       if (!secretValue?.trim()) {
//         return res.status(500).json({ error: "Secret value is empty." });
//       }

//       // Use vector search to find relevant chunks
//       const questionEmbedding = await generateEmbedding(secretValue);
//       const allRelevantChunks = [];

//       for (const file of files) {
//         const relevant = await ChunkVector.findNearestChunksAcrossFiles(
//           questionEmbedding,
//           maxResults,
//           [file.id]
//         );
//         if (relevant.length) {
//           allRelevantChunks.push(
//             ...relevant.map((r) => ({ ...r, filename: file.originalname }))
//           );
//         }
//       }

//       if (allRelevantChunks.length === 0) {
//         return res.status(404).json({ error: "No relevant information found for your query." });
//       }

//       usedChunkIds = allRelevantChunks.map((c) => c.chunk_id || c.id);

//       const combinedContext = allRelevantChunks
//         .map((c) => `📄 [${c.filename}]\n${c.content}`)
//         .join("\n\n");

//       let finalPrompt = `You are an expert AI legal assistant using the ${provider.toUpperCase()} model.\n\n`;
//       finalPrompt += `${secretValue}\n\n=== RELEVANT DOCUMENTS (FOLDER: "${folderName}") ===\n${combinedContext}`;

//       if (additional_input?.trim()) {
//         finalPrompt += `\n\n=== ADDITIONAL USER INPUT ===\n${additional_input.trim()}`;
//       }

//       answer = await askFolderLLMService(provider, finalPrompt);

//       console.log(`✅ Secret prompt processed: "${secretName}"`);
//     }

//     // ================================
//     // CASE 2: CUSTOM QUESTION
//     // ================================
//     else {
//       if (!question?.trim())
//         return res.status(400).json({ error: "question is required for custom queries." });

//       console.log(`💬 Handling custom question: "${question.substring(0, 50)}..."`);

//       // ✅ FIX: Store the actual user question for custom queries
//       storedQuestion = question;
//       displayQuestion = question;
//       finalPromptLabel = null; // No prompt label for custom questions

//       provider = "gemini"; // default

//       // Calculate token cost
//       chatCost = Math.ceil(question.length / 100) +
//                  Math.ceil(allChunks.reduce((sum, c) => sum + c.content.length, 0) / 200);

//       // Check token limits
//       const requestedResources = { tokens: chatCost, ai_analysis: 1 };
//       const { allowed, message } = await TokenUsageService.enforceLimits(
//         usage,
//         plan,
//         requestedResources
//       );

//       if (!allowed) {
//         return res.status(403).json({
//           error: `AI chat failed: ${message}`,
//           timeLeftUntilReset: timeLeft
//         });
//       }

//       // Use vector search for relevant chunks
//       const questionEmbedding = await generateEmbedding(question);
//       const allRelevantChunks = [];

//       for (const file of files) {
//         const relevant = await ChunkVector.findNearestChunksAcrossFiles(
//           questionEmbedding,
//           maxResults,
//           [file.id]
//         );
//         if (relevant.length) {
//           allRelevantChunks.push(
//             ...relevant.map((r) => ({ ...r, filename: file.originalname }))
//           );
//         }
//       }

//       if (allRelevantChunks.length === 0) {
//         return res.status(404).json({ error: "No relevant information found for your query." });
//       }

//       usedChunkIds = allRelevantChunks.map((c) => c.chunk_id || c.id);

//       const combinedContext = allRelevantChunks
//         .map((c) => `📄 [${c.filename}]\n${c.content}`)
//         .join("\n\n");

//       answer = await askFolderLLMService(provider, question, "", combinedContext);

//       console.log(`✅ Custom question processed`);
//     }

//     // Validate AI output
//     if (!answer?.trim()) {
//       return res.status(500).json({ error: "Empty response from AI." });
//     }

//     console.log(`✅ Folder query successful | Answer length: ${answer.length}`);

//     // 5️⃣ ✅ FIX: Save chat with correct question format
//     const savedChat = await FolderChat.saveFolderChat(
//       userId,
//       folderName,
//       storedQuestion, // ✅ This is the prompt name (for secret) or actual question (for custom)
//       answer,
//       finalSessionId,
//       files.map((f) => f.id), // summarizedFileIds
//       usedChunkIds, // usedChunkIds
//       used_secret_prompt, // Boolean flag
//       finalPromptLabel, // Prompt label (only for secret prompts)
//       secret_id // Secret ID (only for secret prompts)
//     );

//     // Increment token usage for custom queries
//     if (chatCost && !used_secret_prompt) {
//       await TokenUsageService.incrementUsage(userId, { tokens: chatCost, ai_analysis: 1 });
//     }

//     // 6️⃣ ✅ FIX: Return response with proper display format
//     return res.json({
//       success: true,
//       session_id: finalSessionId,
//       answer,
//       response: answer,
//       llm_provider: provider,
//       used_secret_prompt, // ✅ Include flag
//       prompt_label: finalPromptLabel, // ✅ Include label (null for custom queries)
//       secret_id: used_secret_prompt ? secret_id : null, // ✅ Include secret_id only if used
//       used_chunk_ids: usedChunkIds,
//       files_queried: files.map((f) => f.originalname),
//       total_files: files.length,
//       timestamp: new Date().toISOString(),
//       displayQuestion: displayQuestion, // ✅ Frontend should use this for display
//       storedQuestion: storedQuestion, // ✅ What's stored in DB (for debugging)
//     });
//   } catch (error) {
//     console.error("❌ Error in queryFolderDocuments:", error);
//     return res.status(500).json({
//       error: "Failed to get AI answer.",
//       details: error.message,
//     });
//   }
// };
// exports.queryFolderDocuments = async (req, res) => {
//   let chatCost;
//   let userId = req.user.id;
//   const authorizationHeader = req.headers.authorization;

//   try {
//     const { folderName } = req.params;
//     const {
//       question,
//       prompt_label = null,
//       session_id = null,
//       maxResults = 5, // ✅ REDUCED from 10
//       secret_id,
//       llm_name,
//       additional_input = "",
//     } = req.body;

//     let used_secret_prompt = !!secret_id;

//     if (!folderName) {
//       return res.status(400).json({ error: "folderName is required." });
//     }

//     const finalSessionId = session_id || `session-${Date.now()}`;
//     console.log(`📁 Querying folder: ${folderName} | used_secret_prompt=${used_secret_prompt} | secret_id=${secret_id}`);

//     // 1️⃣ Get user plan & usage
//     const { usage, plan, timeLeft } = await TokenUsageService.getUserUsageAndPlan(
//       userId,
//       authorizationHeader
//     );

//     // 2️⃣ Fetch all processed files in folder
//     const folderPattern = `%${folderName}%`;
//     const filesQuery = `
//       SELECT id, originalname, folder_path, status
//       FROM user_files
//       WHERE user_id = $1
//         AND is_folder = false
//         AND status = 'processed'
//         AND folder_path LIKE $2
//       ORDER BY created_at DESC;
//     `;
//     const { rows: files } = await pool.query(filesQuery, [userId, folderPattern]);

//     if (files.length === 0) {
//       return res.status(404).json({ error: "No processed files found in this folder." });
//     }

//     console.log(`📄 Found ${files.length} processed files in folder "${folderName}"`);

//     // 3️⃣ ✅ KEY FIX: Collect chunks with AGGRESSIVE pre-filtering
//     let allChunks = [];
//     const MAX_CHUNKS_PER_FILE = 10; // ✅ Limit chunks per file

//     for (const file of files) {
//       const chunks = await FileChunk.getChunksByFileId(file.id);

//       // ✅ Take only top N chunks per file (by length - usually more informative)
//       const topChunks = chunks
//         .sort((a, b) => b.content.length - a.content.length)
//         .slice(0, MAX_CHUNKS_PER_FILE)
//         .map((chunk) => ({
//           ...chunk,
//           file_id: file.id,
//           filename: file.originalname,
//         }));

//       allChunks.push(...topChunks);
//     }

//     console.log(`🧩 Pre-filtered chunks: ${allChunks.length} (from ${files.length} files, max ${MAX_CHUNKS_PER_FILE} per file)`);

//     if (allChunks.length === 0) {
//       return res.status(400).json({ error: "No content found in folder documents." });
//     }

//     // 4️⃣ Initialize variables
//     let answer;
//     let usedChunkIds = [];
//     let storedQuestion;
//     let displayQuestion;
//     let finalPromptLabel = prompt_label;
//     let provider = "gemini";

//     // ================================
//     // CASE 1: SECRET PROMPT
//     // ================================
//     if (used_secret_prompt) {
//       if (!secret_id)
//         return res.status(400).json({ error: "secret_id is required for secret prompts." });

//       console.log(`🔐 Using secret prompt id=${secret_id}`);

//       // Fetch secret metadata
//       const secretQuery = `
//         SELECT s.id, s.name, s.secret_manager_id, s.version, s.llm_id, l.name AS llm_name
//         FROM secret_manager s
//         LEFT JOIN llm_models l ON s.llm_id = l.id
//         WHERE s.id = $1;
//       `;
//       const secretResult = await pool.query(secretQuery, [secret_id]);
//       if (secretResult.rows.length === 0)
//         return res.status(404).json({ error: "Secret configuration not found." });

//       const { name: secretName, secret_manager_id, version, llm_name: dbLlmName } =
//         secretResult.rows[0];

//       finalPromptLabel = secretName;
//       storedQuestion = secretName;
//       displayQuestion = `Analysis: ${secretName}`;

//       provider = resolveProviderName(llm_name || dbLlmName || "gemini");

//       // Fetch secret value securely
//       const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");
//       const secretClient = new SecretManagerServiceClient();
//       const GCLOUD_PROJECT_ID = process.env.GCLOUD_PROJECT_ID;

//       const gcpSecretName = `projects/${GCLOUD_PROJECT_ID}/secrets/${secret_manager_id}/versions/${version}`;
//       const [accessResponse] = await secretClient.accessSecretVersion({ name: gcpSecretName });
//       const secretValue = accessResponse.payload.data.toString("utf8");

//       if (!secretValue?.trim()) {
//         return res.status(500).json({ error: "Secret value is empty." });
//       }

//       // ✅ Vector search with REDUCED maxResults
//       const questionEmbedding = await generateEmbedding(secretValue);
//       const allRelevantChunks = [];

//       for (const file of files) {
//         const relevant = await ChunkVector.findNearestChunksAcrossFiles(
//           questionEmbedding,
//           maxResults, // Now only 5 instead of 10
//           [file.id]
//         );
//         if (relevant.length) {
//           allRelevantChunks.push(
//             ...relevant.map((r) => ({ ...r, filename: file.originalname }))
//           );
//         }
//       }

//       // ✅ Limit total chunks across all files
//       const limitedChunks = allRelevantChunks.slice(0, maxResults * 2); // Max 10 chunks total

//       if (limitedChunks.length === 0) {
//         return res.status(404).json({ error: "No relevant information found for your query." });
//       }

//       usedChunkIds = limitedChunks.map((c) => c.chunk_id || c.id);

//       // ✅ Truncate long chunks to save tokens
//       const combinedContext = limitedChunks
//         .map((c) => {
//           const content = c.content.length > 1500 
//             ? c.content.substring(0, 1500) + "..." 
//             : c.content;
//           return `📄 [${c.filename}]\n${content}`;
//         })
//         .join("\n\n");

//       console.log(`📊 Context size: ~${Math.ceil(combinedContext.length / 4)} tokens`);

//       // ✅ Build minimal prompt
//       let finalPrompt = `You are an expert AI legal assistant using the ${provider.toUpperCase()} model.\n\n`;
//       finalPrompt += `${secretValue}\n\n=== RELEVANT DOCUMENTS (FOLDER: "${folderName}") ===\n${combinedContext}`;

//       if (additional_input?.trim()) {
//         const trimmedInput = additional_input.trim().substring(0, 500); // ✅ Limit additional input
//         finalPrompt += `\n\n=== ADDITIONAL INPUT ===\n${trimmedInput}`;
//       }

//       answer = await askFolderLLMService(provider, finalPrompt);

//       console.log(`✅ Secret prompt processed: "${secretName}"`);
//     }

//     // ================================
//     // CASE 2: CUSTOM QUESTION
//     // ================================
//     else {
//       if (!question?.trim())
//         return res.status(400).json({ error: "question is required for custom queries." });

//       console.log(`💬 Handling custom question: "${question.substring(0, 50)}..."`);

//       storedQuestion = question;
//       displayQuestion = question;
//       finalPromptLabel = null;
//       provider = "gemini";

//       // ✅ Calculate realistic token cost
//       chatCost = Math.ceil(question.length / 100) + 
//                  Math.ceil(allChunks.slice(0, maxResults * 2).reduce((sum, c) => 
//                    sum + Math.min(c.content.length, 1500), 0) / 200
//                  );

//       const requestedResources = { tokens: chatCost, ai_analysis: 1 };
//       const { allowed, message } = await TokenUsageService.enforceLimits(
//         usage,
//         plan,
//         requestedResources
//       );

//       if (!allowed) {
//         return res.status(403).json({
//           error: `AI chat failed: ${message}`,
//           timeLeftUntilReset: timeLeft
//         });
//       }

//       // ✅ Vector search with REDUCED maxResults
//       const questionEmbedding = await generateEmbedding(question);
//       const allRelevantChunks = [];

//       for (const file of files) {
//         const relevant = await ChunkVector.findNearestChunksAcrossFiles(
//           questionEmbedding,
//           maxResults,
//           [file.id]
//         );
//         if (relevant.length) {
//           allRelevantChunks.push(
//             ...relevant.map((r) => ({ ...r, filename: file.originalname }))
//           );
//         }
//       }

//       // ✅ Limit total chunks
//       const limitedChunks = allRelevantChunks.slice(0, maxResults * 2);

//       if (limitedChunks.length === 0) {
//         return res.status(404).json({ error: "No relevant information found for your query." });
//       }

//       usedChunkIds = limitedChunks.map((c) => c.chunk_id || c.id);

//       // ✅ Truncate chunks
//       const combinedContext = limitedChunks
//         .map((c) => {
//           const content = c.content.length > 1500 
//             ? c.content.substring(0, 1500) + "..." 
//             : c.content;
//           return `📄 [${c.filename}]\n${content}`;
//         })
//         .join("\n\n");

//       console.log(`📊 Context size: ~${Math.ceil(combinedContext.length / 4)} tokens`);

//       answer = await askFolderLLMService(provider, question, "", combinedContext);

//       console.log(`✅ Custom question processed`);
//     }

//     if (!answer?.trim()) {
//       return res.status(500).json({ error: "Empty response from AI." });
//     }

//     console.log(`✅ Folder query successful | Answer length: ${answer.length}`);

//     // 5️⃣ Save chat
//     const savedChat = await FolderChat.saveFolderChat(
//       userId,
//       folderName,
//       storedQuestion,
//       answer,
//       finalSessionId,
//       files.map((f) => f.id),
//       usedChunkIds,
//       used_secret_prompt,
//       finalPromptLabel,
//       secret_id
//     );

//     if (chatCost && !used_secret_prompt) {
//       await TokenUsageService.incrementUsage(userId, { tokens: chatCost, ai_analysis: 1 });
//     }

//     // 6️⃣ Return response
//     return res.json({
//       success: true,
//       session_id: finalSessionId,
//       answer,
//       response: answer,
//       llm_provider: provider,
//       used_secret_prompt,
//       prompt_label: finalPromptLabel,
//       secret_id: used_secret_prompt ? secret_id : null,
//       used_chunk_ids: usedChunkIds,
//       files_queried: files.map((f) => f.originalname),
//       total_files: files.length,
//       chunks_used: usedChunkIds.length, // ✅ Show actual chunks used
//       timestamp: new Date().toISOString(),
//       displayQuestion: displayQuestion,
//       storedQuestion: storedQuestion,
//     });
//   } catch (error) {
//     console.error("❌ Error in queryFolderDocuments:", error);
//     return res.status(500).json({
//       error: "Failed to get AI answer.",
//       details: error.message,
//     });
//   }
// };


// exports.queryFolderDocuments = async (req, res) => {
//   let chatCost;
//   let userId = req.user.id;
//   const authorizationHeader = req.headers.authorization;

//   try {
//     const { folderName } = req.params;
//     const {
//       question,
//       prompt_label = null,
//       session_id = null,
//       maxResults = 5,
//       secret_id,
//       llm_name,
//       additional_input = "",
//     } = req.body;

//     let used_secret_prompt = !!secret_id;

//     if (!folderName) {
//       return res.status(400).json({ error: "folderName is required." });
//     }

//     const finalSessionId = session_id || `session-${Date.now()}`;
//     console.log(`📁 Querying folder: ${folderName} | used_secret_prompt=${used_secret_prompt} | secret_id=${secret_id}`);

//     // 1️⃣ Get user plan & usage
//     const { usage, plan, timeLeft } = await TokenUsageService.getUserUsageAndPlan(
//       userId,
//       authorizationHeader
//     );

//     // 2️⃣ ✅ FIX: Fetch ONLY files in THIS specific folder
//     const filesQuery = `
//       SELECT id, originalname, folder_path, status
//       FROM user_files
//       WHERE user_id = $1
//         AND is_folder = false
//         AND status = 'processed'
//         AND folder_path = $2
//       ORDER BY created_at DESC;
//     `;
//     const { rows: files } = await pool.query(filesQuery, [userId, folderName]);

//     if (files.length === 0) {
//       return res.status(404).json({ error: "No processed files found in this folder." });
//     }

//     console.log(`📄 Found ${files.length} processed files in folder "${folderName}":`, files.map(f => f.originalname));

//     // 3️⃣ ✅ CRITICAL FIX: Only get chunks from FILES IN THIS FOLDER
//     const fileIds = files.map(f => f.id);
//     console.log(`🔍 Fetching chunks ONLY from file IDs:`, fileIds);

//     // Query chunks directly with file_id filter
//     const chunksQuery = `
//       SELECT 
//         fc.id,
//         fc.file_id,
//         fc.chunk_index,
//         fc.content,
//         fc.token_count,
//         fc.page_start,
//         fc.page_end,
//         fc.heading,
//         uf.originalname as filename
//       FROM file_chunks fc
//       INNER JOIN user_files uf ON fc.file_id = uf.id
//       WHERE fc.file_id = ANY($1::uuid[])
//         AND uf.user_id = $2
//       ORDER BY fc.file_id, fc.chunk_index;
//     `;
//     const { rows: allChunks } = await pool.query(chunksQuery, [fileIds, userId]);

//     console.log(`🧩 Total chunks from folder files: ${allChunks.length}`);

//     // ✅ Verify chunks belong to correct files
//     const chunksByFile = {};
//     allChunks.forEach(chunk => {
//       if (!chunksByFile[chunk.file_id]) {
//         chunksByFile[chunk.file_id] = [];
//       }
//       chunksByFile[chunk.file_id].push(chunk);
//     });

//     console.log(`📊 Chunks per file:`, Object.entries(chunksByFile).map(([fileId, chunks]) => {
//       const file = files.find(f => f.id === fileId);
//       return `${file?.originalname}: ${chunks.length} chunks`;
//     }).join(', '));

//     if (allChunks.length === 0) {
//       return res.status(400).json({ error: "No content found in folder documents." });
//     }

//     // 4️⃣ Initialize variables
//     let answer;
//     let usedChunkIds = [];
//     let storedQuestion;
//     let displayQuestion;
//     let finalPromptLabel = prompt_label;
//     let provider = "gemini";

//     // ================================
//     // CASE 1: SECRET PROMPT
//     // ================================
//     if (used_secret_prompt) {
//       if (!secret_id)
//         return res.status(400).json({ error: "secret_id is required for secret prompts." });

//       console.log(`🔐 Using secret prompt id=${secret_id}`);

//       const secretQuery = `
//         SELECT s.id, s.name, s.secret_manager_id, s.version, s.llm_id, l.name AS llm_name
//         FROM secret_manager s
//         LEFT JOIN llm_models l ON s.llm_id = l.id
//         WHERE s.id = $1;
//       `;
//       const secretResult = await pool.query(secretQuery, [secret_id]);
//       if (secretResult.rows.length === 0)
//         return res.status(404).json({ error: "Secret configuration not found." });

//       const { name: secretName, secret_manager_id, version, llm_name: dbLlmName } =
//         secretResult.rows[0];

//       finalPromptLabel = secretName;
//       storedQuestion = secretName;
//       displayQuestion = `Analysis: ${secretName}`;

//       provider = resolveProviderName(llm_name || dbLlmName || "gemini");

//       const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");
//       const secretClient = new SecretManagerServiceClient();
//       const GCLOUD_PROJECT_ID = process.env.GCLOUD_PROJECT_ID;

//       const gcpSecretName = `projects/${GCLOUD_PROJECT_ID}/secrets/${secret_manager_id}/versions/${version}`;
//       const [accessResponse] = await secretClient.accessSecretVersion({ name: gcpSecretName });
//       const secretValue = accessResponse.payload.data.toString("utf8");

//       if (!secretValue?.trim()) {
//         return res.status(500).json({ error: "Secret value is empty." });
//       }

//       // ✅ Vector search ONLY in folder file chunks
//       const questionEmbedding = await generateEmbedding(secretValue);

//       // Query vectors ONLY for chunks in this folder
//       const vectorQuery = `
//         SELECT 
//           cv.chunk_id,
//           cv.embedding,
//           fc.content,
//           fc.page_start,
//           fc.page_end,
//           fc.heading,
//           uf.originalname as filename,
//           cv.embedding <=> $1::vector as distance
//         FROM chunk_vectors cv
//         INNER JOIN file_chunks fc ON cv.chunk_id = fc.id
//         INNER JOIN user_files uf ON fc.file_id = uf.id
//         WHERE fc.file_id = ANY($2::uuid[])
//           AND uf.user_id = $3
//         ORDER BY distance ASC
//         LIMIT $4;
//       `;

//       const { rows: relevantChunks } = await pool.query(vectorQuery, [
//         JSON.stringify(questionEmbedding),
//         fileIds,
//         userId,
//         maxResults * 2
//       ]);

//       console.log(`🎯 Found ${relevantChunks.length} relevant chunks via vector search`);

//       if (relevantChunks.length === 0) {
//         return res.status(404).json({ error: "No relevant information found for your query." });
//       }

//       usedChunkIds = relevantChunks.map((c) => c.chunk_id);

//       const combinedContext = relevantChunks
//         .map((c) => {
//           const content = c.content.length > 1500 
//             ? c.content.substring(0, 1500) + "..." 
//             : c.content;
//           return `📄 [${c.filename}]\n${content}`;
//         })
//         .join("\n\n");

//       console.log(`📊 Context size: ~${Math.ceil(combinedContext.length / 4)} tokens`);

//       let finalPrompt = `You are an expert AI legal assistant using the ${provider.toUpperCase()} model.\n\n`;
//       finalPrompt += `${secretValue}\n\n=== RELEVANT DOCUMENTS (FOLDER: "${folderName}") ===\n${combinedContext}`;

//       if (additional_input?.trim()) {
//         const trimmedInput = additional_input.trim().substring(0, 500);
//         finalPrompt += `\n\n=== ADDITIONAL INPUT ===\n${trimmedInput}`;
//       }

//       answer = await askFolderLLMService(provider, finalPrompt);

//       console.log(`✅ Secret prompt processed: "${secretName}"`);
//     }

//     // ================================
//     // CASE 2: CUSTOM QUESTION
//     // ================================
//     else {
//       if (!question?.trim())
//         return res.status(400).json({ error: "question is required for custom queries." });

//       console.log(`💬 Handling custom question: "${question.substring(0, 50)}..."`);

//       storedQuestion = question;
//       displayQuestion = question;
//       finalPromptLabel = null;
//       provider = "gemini";

//       chatCost = Math.ceil(question.length / 100) + 
//                  Math.ceil(allChunks.slice(0, maxResults * 2).reduce((sum, c) => 
//                    sum + Math.min(c.content.length, 1500), 0) / 200
//                  );

//       const requestedResources = { tokens: chatCost, ai_analysis: 1 };
//       const { allowed, message } = await TokenUsageService.enforceLimits(
//         usage,
//         plan,
//         requestedResources
//       );

//       if (!allowed) {
//         return res.status(403).json({
//           error: `AI chat failed: ${message}`,
//           timeLeftUntilReset: timeLeft
//         });
//       }

//       // ✅ Vector search ONLY in folder file chunks
//       const questionEmbedding = await generateEmbedding(question);

//       const vectorQuery = `
//         SELECT 
//           cv.chunk_id,
//           cv.embedding,
//           fc.content,
//           fc.page_start,
//           fc.page_end,
//           fc.heading,
//           uf.originalname as filename,
//           cv.embedding <=> $1::vector as distance
//         FROM chunk_vectors cv
//         INNER JOIN file_chunks fc ON cv.chunk_id = fc.id
//         INNER JOIN user_files uf ON fc.file_id = uf.id
//         WHERE fc.file_id = ANY($2::uuid[])
//           AND uf.user_id = $3
//         ORDER BY distance ASC
//         LIMIT $4;
//       `;

//       const { rows: relevantChunks } = await pool.query(vectorQuery, [
//         JSON.stringify(questionEmbedding),
//         fileIds,
//         userId,
//         maxResults * 2
//       ]);

//       console.log(`🎯 Found ${relevantChunks.length} relevant chunks via vector search`);

//       if (relevantChunks.length === 0) {
//         return res.status(404).json({ error: "No relevant information found for your query." });
//       }

//       usedChunkIds = relevantChunks.map((c) => c.chunk_id);

//       const combinedContext = relevantChunks
//         .map((c) => {
//           const content = c.content.length > 1500 
//             ? c.content.substring(0, 1500) + "..." 
//             : c.content;
//           return `📄 [${c.filename}]\n${content}`;
//         })
//         .join("\n\n");

//       console.log(`📊 Context size: ~${Math.ceil(combinedContext.length / 4)} tokens`);

//       answer = await askFolderLLMService(provider, question, "", combinedContext);

//       console.log(`✅ Custom question processed`);
//     }

//     if (!answer?.trim()) {
//       return res.status(500).json({ error: "Empty response from AI." });
//     }

//     console.log(`✅ Folder query successful | Answer length: ${answer.length}`);

//     // 5️⃣ Save chat
//     const savedChat = await FolderChat.saveFolderChat(
//       userId,
//       folderName,
//       storedQuestion,
//       answer,
//       finalSessionId,
//       files.map((f) => f.id),
//       usedChunkIds,
//       used_secret_prompt,
//       finalPromptLabel,
//       secret_id
//     );

//     if (chatCost && !used_secret_prompt) {
//       await TokenUsageService.incrementUsage(userId, { tokens: chatCost, ai_analysis: 1 });
//     }

//     // 6️⃣ Return response
//     return res.json({
//       success: true,
//       session_id: finalSessionId,
//       answer,
//       response: answer,
//       llm_provider: provider,
//       used_secret_prompt,
//       prompt_label: finalPromptLabel,
//       secret_id: used_secret_prompt ? secret_id : null,
//       used_chunk_ids: usedChunkIds,
//       files_queried: files.map((f) => f.originalname),
//       total_files: files.length,
//       chunks_used: usedChunkIds.length,
//       chunks_available: allChunks.length, // ✅ Show how many chunks were in folder
//       timestamp: new Date().toISOString(),
//       displayQuestion: displayQuestion,
//       storedQuestion: storedQuestion,
//     });
//   } catch (error) {
//     console.error("❌ Error in queryFolderDocuments:", error);
//     return res.status(500).json({
//       error: "Failed to get AI answer.",
//       details: error.message,
//     });
//   }
// };

/**
 * Analyzes user query to determine if it needs full document or targeted search (Folder version)
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

/**
 * Intelligently selects representative chunks from each file for comprehensive analysis
 * while staying within token limits
 * @param {Array} allChunks - All chunks from all files
 * @param {Array} files - Array of file objects
 * @param {number} maxContextChars - Maximum context size in characters
 * @returns {Array} Selected representative chunks
 */
function selectRepresentativeChunks(allChunks, files, maxContextChars) {
  if (!allChunks || allChunks.length === 0) return [];

  // Group chunks by file
  const chunksByFile = {};
  for (const chunk of allChunks) {
    const fileId = chunk.file_id || chunk.filename || 'unknown';
    if (!chunksByFile[fileId]) {
      chunksByFile[fileId] = [];
    }
    chunksByFile[fileId].push(chunk);
  }

  // Calculate target chunks per file to ensure representation from all files
  const fileCount = Object.keys(chunksByFile).length;
  const targetCharsPerFile = Math.floor(maxContextChars / fileCount);

  const selectedChunks = [];
  let totalChars = 0;

  // Select representative chunks from each file
  for (const fileId in chunksByFile) {
    const fileChunks = chunksByFile[fileId].sort((a, b) => (a.chunk_index || 0) - (b.chunk_index || 0));
    const totalFileChars = fileChunks.reduce((sum, c) => sum + ((c.content || '').length || 0), 0);

    if (totalFileChars <= targetCharsPerFile) {
      // File fits entirely - include all chunks
      selectedChunks.push(...fileChunks);
      totalChars += totalFileChars;
    } else {
      // File is too large - select representative chunks
      // Strategy: Include first, middle, and last chunks + evenly spaced chunks
      const targetChunks = Math.max(5, Math.floor((targetCharsPerFile / totalFileChars) * fileChunks.length));

      if (targetChunks >= fileChunks.length) {
        // Include all if we have space
        selectedChunks.push(...fileChunks);
        totalChars += totalFileChars;
      } else {
        // Select representative chunks
        const step = Math.floor(fileChunks.length / targetChunks);
        const selected = [];

        // Always include first chunk
        selected.push(fileChunks[0]);

        // Include evenly spaced chunks from middle
        for (let i = step; i < fileChunks.length - 1; i += step) {
          if (selected.length < targetChunks - 1) {
            selected.push(fileChunks[i]);
          }
        }

        // Always include last chunk if we have space
        if (selected.length < targetChunks && fileChunks.length > 1) {
          selected.push(fileChunks[fileChunks.length - 1]);
        }

        // Sort by original index to maintain order
        selected.sort((a, b) => (a.chunk_index || 0) - (b.chunk_index || 0));

        // Trim if still too large
        let fileChars = 0;
        const trimmedSelected = [];
        for (const chunk of selected) {
          const chunkLength = (chunk.content || '').length;
          if (fileChars + chunkLength <= targetCharsPerFile) {
            trimmedSelected.push(chunk);
            fileChars += chunkLength;
          } else {
            // Truncate last chunk to fit
            const remaining = targetCharsPerFile - fileChars;
            if (remaining > 500) {
              trimmedSelected.push({
                ...chunk,
                content: (chunk.content || '').substring(0, remaining - 100) + '...[continued in full document]'
              });
            }
            break;
          }
        }

        selectedChunks.push(...trimmedSelected);
        totalChars += fileChars;
      }
    }

    // Check if we've exceeded total limit
    if (totalChars >= maxContextChars) {
      break;
    }
  }

  // Final sort by file and chunk index
  selectedChunks.sort((a, b) => {
    if ((a.filename || '') !== (b.filename || '')) {
      return (a.filename || '').localeCompare(b.filename || '');
    }
    return (a.chunk_index || 0) - (b.chunk_index || 0);
  });

  return selectedChunks;
}

/**
 * Checks if a question is a metadata query that should be answered directly without RAG
 * @param {string} question - The user's question
 * @returns {Object|null} Metadata query info or null if not a metadata query
 */
function isMetadataQuery(question) {
  if (!question || typeof question !== 'string') return null;

  const queryLower = question.toLowerCase();

  // Patterns for metadata queries
  const metadataPatterns = [
    { pattern: /how many (file|document|doc|pdf|docx)/i, type: 'file_count' },
    { pattern: /(count|number|total).*(file|document|doc)/i, type: 'file_count' },
    { pattern: /how many.*in.*(case|project|folder)/i, type: 'file_count' },
    { pattern: /(list|show|what are).*(all|the).*(file|document)/i, type: 'file_list' },
    { pattern: /(file|document).*(name|title|list)/i, type: 'file_list' },
    { pattern: /what.*(file|document).*in.*(case|project|folder)/i, type: 'file_list' },
  ];

  for (const { pattern, type } of metadataPatterns) {
    if (pattern.test(queryLower)) {
      return { type, question: queryLower };
    }
  }

  return null;
}

exports.queryFolderDocuments = async (req, res) => {
  let chatCost;
  let userId = req.user.id;
  const authorizationHeader = req.headers.authorization;

  try {
    const { folderName } = req.params;
    const {
      question,
      prompt_label = null,
      session_id = null,
      maxResults = 10, // ✅ Retrieve top 10 candidates
      secret_id,
      llm_name,
      additional_input = "",
    } = req.body;

    let used_secret_prompt = !!secret_id;

    if (!folderName) {
      return res.status(400).json({ error: "folderName is required." });
    }

    const hasExistingSession = session_id && UUID_REGEX.test(session_id);
    const finalSessionId = hasExistingSession ? session_id : uuidv4();

    console.log(`\n${'='.repeat(80)}`);
    console.log(`📁 FOLDER QUERY REQUEST`);
    console.log(`Folder: ${folderName}`);
    console.log(`Session: ${finalSessionId}`);
    console.log(`Secret Prompt: ${used_secret_prompt} ${secret_id ? `(ID: ${secret_id})` : ''}`);
    console.log(`Question: "${(question || '').substring(0, 100)}..."`);
    console.log(`${'='.repeat(80)}\n`);

    // 1️⃣ Get user plan & usage
    const { usage, plan, timeLeft } = await TokenUsageService.getUserUsageAndPlan(
      userId,
      authorizationHeader
    );

    // Check if user is on free plan
    const isFreeUser = TokenUsageService.isFreePlan(plan);
    if (isFreeUser) {
      console.log(`\n${'🆓'.repeat(40)}`);
      console.log(`[FREE TIER] User is on free plan - applying restrictions`);
      console.log(`[FREE TIER] - File size limit: 10 MB`);
      console.log(`[FREE TIER] - Model: Forced to ${TokenUsageService.getFreeTierForcedModel()}`);
      console.log(`[FREE TIER] - Gemini Eyeball: Only 1 use per day (first prompt)`);
      console.log(`[FREE TIER] - Subsequent chats: Must use RAG retrieval`);
      console.log(`[FREE TIER] - Daily token limit: 100,000 tokens (in + out)`);
      console.log(`${'🆓'.repeat(40)}\n`);
      
      // Check controller access limit (1 per day)
      const controllerAccessCheck = await TokenUsageService.checkFreeTierControllerAccessLimit(userId, plan, 'FileController');
      if (!controllerAccessCheck.allowed) {
        return res.status(403).json({
          error: controllerAccessCheck.message,
          upgradeRequired: true,
          used: controllerAccessCheck.used,
          limit: controllerAccessCheck.limit
        });
      }
    }

    // 2️⃣ Fetch all processed files in folder
    const folderPattern = `%${folderName}%`;
    const filesQuery = `
      SELECT id, originalname, folder_path, status, gcs_path, mimetype
      FROM user_files
      WHERE user_id = $1
        AND is_folder = false
        AND status = 'processed'
        AND folder_path LIKE $2
      ORDER BY created_at DESC;
    `;
    const { rows: files } = await pool.query(filesQuery, [userId, folderPattern]);

    if (files.length === 0) {
      return res.status(404).json({ error: "No processed files found in this folder." });
    }

    console.log(`📄 Found ${files.length} processed files in folder "${folderName}"`);

    // 2.25️⃣ Check if this is a metadata query (file count, file list, etc.)
    if (question && !used_secret_prompt) {
      const metadataQuery = isMetadataQuery(question);
      if (metadataQuery) {
        console.log(`📊 Detected metadata query: ${metadataQuery.type}`);

        if (metadataQuery.type === 'file_count') {
          const answer = `There are **${files.length}** processed file(s) in the "${folderName}" folder/case project.`;

          // Save the chat
          const savedChat = await FolderChat.saveFolderChat(
            userId,
            folderName,
            question,
            answer,
            finalSessionId,
            files.map((f) => f.id),
            [],
            false,
            null,
            null,
            []
          );

          return res.json({
            success: true,
            session_id: savedChat.session_id,
            answer,
            response: answer,
            llm_provider: 'metadata',
            used_secret_prompt: false,
            prompt_label: null,
            secret_id: null,
            used_chunk_ids: [],
            files_queried: files.map((f) => f.originalname),
            total_files: files.length,
            chunks_used: 0,
            timestamp: new Date().toISOString(),
            displayQuestion: question,
            storedQuestion: question,
            chat_history: [],
            metadata_query: true
          });
        } else if (metadataQuery.type === 'file_list') {
          const fileList = files.map((f, idx) => `${idx + 1}. ${f.originalname}`).join('\n');
          const answer = `Files in the "${folderName}" folder/case project:\n\n${fileList}\n\n**Total: ${files.length} file(s)**`;

          // Save the chat
          const savedChat = await FolderChat.saveFolderChat(
            userId,
            folderName,
            question,
            answer,
            finalSessionId,
            files.map((f) => f.id),
            [],
            false,
            null,
            null,
            []
          );

          return res.json({
            success: true,
            session_id: savedChat.session_id,
            answer,
            response: answer,
            llm_provider: 'metadata',
            used_secret_prompt: false,
            prompt_label: null,
            secret_id: null,
            used_chunk_ids: [],
            files_queried: files.map((f) => f.originalname),
            total_files: files.length,
            chunks_used: 0,
            timestamp: new Date().toISOString(),
            displayQuestion: question,
            storedQuestion: question,
            chat_history: [],
            metadata_query: true
          });
        }
      }
    }

    // 3️⃣ Fetch case data and conversation history
    const caseData = await fetchCaseDataForFolder(userId, folderName);
    const caseContext = caseData ? formatCaseDataAsContext(caseData) : '';

    let previousChats = [];
    if (hasExistingSession) {
      previousChats = await FolderChat.getFolderChatHistory(userId, folderName, finalSessionId);
    }
    const conversationContext = formatFolderConversationHistory(previousChats);
    const historyForStorage = simplifyFolderHistory(previousChats);

    // 4️⃣ Initialize variables
    let answer;
    let usedChunkIds = [];
    let usedFileIds = files.map(f => f.id);
    let storedQuestion;
    let displayQuestion;
    let finalPromptLabel = prompt_label;
    let provider = "gemini";
    let methodUsed = "rag"; // Default to RAG
    let secretValue = null;
    let secretName = null;

    // ================================
    // CASE 1: SECRET PROMPT
    // ================================
    if (used_secret_prompt) {
      if (!secret_id) {
        return res.status(400).json({ error: "secret_id is required for secret prompts." });
      }

      console.log(`\n${'='.repeat(80)}`);
      console.log(`🔐 PROCESSING SECRET PROMPT (ID: ${secret_id})`);
      console.log(`${'='.repeat(80)}\n`);

      // ✅ STEP 1: Fetch secret metadata from database (including template IDs)
      const secretData = await fetchSecretManagerWithTemplates(secret_id);

      if (!secretData) {
        console.error(`❌ Secret ID ${secret_id} not found in database`);
        return res.status(404).json({ error: "Secret configuration not found in database." });
      }

      const {
        id: dbSecretId,
        name: dbSecretName,
        secret_manager_id,
        version,
        llm_id,
        llm_name: dbLlmName,
        input_template_id,
        output_template_id
      } = secretData;

      // ✅ VALIDATION: Ensure we have the correct secret metadata
      console.log(`\n📋 SECRET METADATA RETRIEVED:`);
      console.log(`   Database ID: ${dbSecretId}`);
      console.log(`   Secret Name: ${dbSecretName}`);
      console.log(`   GCP Secret Manager ID: ${secret_manager_id}`);
      console.log(`   Version: ${version}`);
      console.log(`   LLM ID: ${llm_id || 'not set'}`);
      console.log(`   LLM Name: ${dbLlmName || 'not set'}\n`);

      secretName = dbSecretName;
      finalPromptLabel = secretName;
      storedQuestion = secretName;
      displayQuestion = `Analysis: ${secretName}`;

      // ✅ STEP 2: Resolve LLM provider from secret's configuration
      provider = resolveFolderProviderName(llm_name || dbLlmName || "gemini");
      console.log(`🤖 LLM Provider Resolution:`);
      console.log(`   Input LLM Name: ${llm_name || dbLlmName || 'none (defaulting to gemini)'}`);
      console.log(`   Resolved Provider: ${provider}\n`);

      // Check if provider is Gemini
      const isGeminiProvider = provider.toLowerCase().includes('gemini');
      console.log(`🔍 Provider Type Check: ${isGeminiProvider ? '✅ Gemini' : '❌ Non-Gemini'}\n`);

      // ✅ STEP 3: Fetch actual secret value from GCP Secret Manager
      const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");
      const secretClient = new SecretManagerServiceClient();
      const GCLOUD_PROJECT_ID = process.env.GCLOUD_PROJECT_ID;

      if (!GCLOUD_PROJECT_ID) {
        throw new Error('GCLOUD_PROJECT_ID environment variable not set');
      }

      const gcpSecretName = `projects/${GCLOUD_PROJECT_ID}/secrets/${secret_manager_id}/versions/${version}`;
      console.log(`🔐 Fetching Secret from GCP Secret Manager:`);
      console.log(`   Full Path: ${gcpSecretName}\n`);

      let accessResponse;
      try {
        [accessResponse] = await secretClient.accessSecretVersion({ name: gcpSecretName });
      } catch (gcpError) {
        console.error(`❌ Failed to fetch secret from GCP:`, gcpError.message);
        throw new Error(`Failed to access secret from GCP Secret Manager: ${gcpError.message}`);
      }

      secretValue = accessResponse.payload.data.toString("utf8");

      // ✅ VALIDATION: Ensure secret value is not empty
      if (!secretValue?.trim()) {
        console.error(`❌ Secret value is empty for secret: ${dbSecretName} (${secret_manager_id})`);
        return res.status(500).json({
          error: "Secret value is empty.",
          secretName: dbSecretName,
          secretId: secret_id
        });
      }

      console.log(`✅ SECRET VALUE RETRIEVED SUCCESSFULLY:`);
      console.log(`   Length: ${secretValue.length} characters`);
      console.log(`   Preview: "${secretValue.substring(0, 100)}${secretValue.length > 100 ? '...' : ''}"\n`);

      // ✅ STEP 3.5: Fetch template files and their extracted data
      let templateData = { inputTemplate: null, outputTemplate: null, hasTemplates: false };
      if (input_template_id || output_template_id) {
        console.log(`\n📄 FETCHING TEMPLATE FILES:`);
        console.log(`   Input Template ID: ${input_template_id || 'not set'}`);
        console.log(`   Output Template ID: ${output_template_id || 'not set'}\n`);
        
        templateData = await fetchTemplateFilesData(input_template_id, output_template_id);
        
        if (templateData.hasTemplates) {
          console.log(`✅ Template files fetched successfully`);
          if (templateData.inputTemplate) {
            console.log(`   Input: ${templateData.inputTemplate.filename} (${templateData.inputTemplate.extracted_text?.length || 0} chars)`);
          }
          if (templateData.outputTemplate) {
            console.log(`   Output: ${templateData.outputTemplate.filename} (${templateData.outputTemplate.extracted_text?.length || 0} chars)`);
          }
        } else {
          console.log(`⚠️ No template files found or available`);
        }
        console.log();
      }

      // ✅ STEP 3.6: Build enhanced prompt with template examples
      if (templateData.hasTemplates) {
        secretValue = buildEnhancedSystemPromptWithTemplates(secretValue, templateData);
        console.log(`✅ Enhanced prompt built with template examples`);
        console.log(`   Enhanced prompt length: ${secretValue.length} characters\n`);
      }

      // ✅ STEP 4: Analyze query intent to determine routing (RAG vs Eyeball)
      const secretQueryAnalysis = analyzeQueryIntent(secretValue);
      console.log(`📊 QUERY INTENT ANALYSIS:`);
      console.log(`   Strategy: ${secretQueryAnalysis.strategy}`);
      console.log(`   Reason: ${secretQueryAnalysis.reason}`);
      console.log(`   Needs Full Document: ${secretQueryAnalysis.needsFullDocument ? '✅ YES' : '❌ NO'}`);
      console.log(`   Similarity Threshold: ${secretQueryAnalysis.threshold}\n`);

      // ✅ STEP 5: ROUTING DECISION FOR SECRET PROMPTS
      // 🔒 CRITICAL POLICY: Secret prompts ALWAYS use RAG with their specified LLM
      console.log(`\n${'='.repeat(80)}`);
      console.log(`🚦 ROUTING DECISION FOR SECRET PROMPT`);
      console.log(`${'='.repeat(80)}`);
      console.log(`🔒 SECRET PROMPT POLICY:`);
      console.log(`   ✅ Always use RAG method (no Gemini Eyeball)`);
      console.log(`   ✅ Use ONLY the LLM specified in secret configuration`);
      console.log(`\nSecret Configuration:`);
      console.log(`   - Secret Name: "${secretName}"`);
      console.log(`   - LLM from Secret: ${dbLlmName || 'not set'}`);
      console.log(`   - Resolved Provider: ${provider}`);
      console.log(`   - Method: RAG (enforced)`);
      console.log(`${'='.repeat(80)}\n`);

      // ========================================
      // ✅ ALWAYS USE RAG FOR SECRET PROMPTS
      // ========================================
      methodUsed = "rag";

      console.log(`\n🎯 ROUTING DECISION: RAG METHOD (SECRET PROMPT)`);
      console.log(`Reason: Secret prompts always use RAG with their specified LLM`);
      console.log(`   🔐 Secret Prompt: "${secretName}"`);
      console.log(`   🤖 LLM from Secret Config: ${dbLlmName || 'not set'}`);
      console.log(`   🤖 Resolved Provider: ${provider}`);
      console.log(`   📊 Query Analysis: ${secretQueryAnalysis.strategy}`);
      console.log(`   🔍 Vector search threshold: ${secretQueryAnalysis.threshold}`);
      console.log(`${'='.repeat(80)}\n`);

      // Generate embedding and search
      console.log(`\n🔍 [RAG] Starting vector search for secret prompt...`);
      console.log(`   - Files to search: ${files.length}`);
      console.log(`   - Max results per file: ${maxResults}`);
      
      const questionEmbedding = await generateEmbedding(secretValue);
      console.log(`   - Question embedding generated: ${questionEmbedding.length} dimensions`);
      
      const allRelevantChunks = [];
      for (const file of files) {
        console.log(`\n   🔍 Searching chunks in file: ${file.originalname}`);
        console.log(`      File ID: ${file.id} (type: ${typeof file.id})`);
        console.log(`      File Status: ${file.status}`);
        
        // First, verify chunks exist for this file
        const debugChunks = await FileChunk.getChunksByFileId(file.id);
        console.log(`      📋 Chunks in database: ${debugChunks.length}`);
        
        if (debugChunks.length === 0) {
          console.log(`      ⚠️ No chunks found in database for this file - skipping vector search`);
          continue;
        }
        
        // Check if embeddings exist
        const chunkIds = debugChunks.map(c => c.id);
        const debugVectors = await ChunkVector.getVectorsByChunkIds(chunkIds);
        console.log(`      🔗 Embeddings in database: ${debugVectors.length} for ${chunkIds.length} chunks`);
        
        if (debugVectors.length === 0) {
          console.log(`      ⚠️ WARNING: Chunks exist but no embeddings found!`);
          console.log(`      💡 This means embeddings were not generated. Using chunks directly as fallback.`);
          // Use chunks directly as fallback
          const fallbackChunks = debugChunks.map(c => ({
            ...c,
            filename: file.originalname,
            file_id: file.id,
            similarity: 0.5,
            distance: 1.0,
            chunk_id: c.id,
            content: c.content
          }));
          allRelevantChunks.push(...fallbackChunks);
          console.log(`      ✅ Added ${fallbackChunks.length} chunks as fallback (no embeddings available)`);
          continue;
        }
        
        // Perform vector search
        console.log(`      🔎 Performing vector search with embedding...`);
        const relevant = await ChunkVector.findNearestChunksAcrossFiles(
          questionEmbedding,
          maxResults,
          [file.id]
        );
        console.log(`      📊 Vector search found: ${relevant.length} relevant chunks`);
        
        if (relevant.length) {
          // Convert distance to similarity (distance is 0-2, similarity should be 0-1)
          // similarity = 1 / (1 + distance)
          const chunksWithSimilarity = relevant.map((r) => {
            const distance = parseFloat(r.distance) || 2.0;
            const similarity = 1 / (1 + distance); // Convert distance to similarity
            return {
              ...r,
              filename: file.originalname,
              file_id: file.id,
              similarity: similarity,
              distance: distance
            };
          });
          allRelevantChunks.push(...chunksWithSimilarity);
          console.log(`      ✅ Added ${chunksWithSimilarity.length} chunks (similarity range: ${Math.min(...chunksWithSimilarity.map(c => c.similarity)).toFixed(3)} - ${Math.max(...chunksWithSimilarity.map(c => c.similarity)).toFixed(3)})`);
        } else {
          console.log(`      ⚠️ Vector search returned 0 results, but ${debugChunks.length} chunks exist`);
          console.log(`      💡 Using all chunks as fallback since embeddings exist but don't match query`);
          // Use all chunks as fallback if vector search fails but chunks exist
          const fallbackChunks = debugChunks.map(c => ({
            ...c,
            filename: file.originalname,
            file_id: file.id,
            similarity: 0.3, // Lower similarity for fallback
            distance: 2.0,
            chunk_id: c.id,
            content: c.content
          }));
          allRelevantChunks.push(...fallbackChunks);
          console.log(`      ✅ Added ${fallbackChunks.length} chunks as fallback (vector search had no matches)`);
        }
      }

      console.log(`\n📊 [RAG] Vector search completed:`);
      console.log(`   - Total relevant chunks found: ${allRelevantChunks.length}`);

      // FALLBACK: If no chunks found via vector search, try using all chunks
      if (allRelevantChunks.length === 0) {
        console.warn(`\n⚠️ [RAG] No chunks found via vector search - trying fallback...`);
        console.warn(`   - Files searched: ${files.length}`);
        
        // Check if files are still processing
        const processingFiles = files.filter(f => f.status !== 'processed');
        if (processingFiles.length > 0) {
          console.warn(`   - ⚠️ ${processingFiles.length} file(s) still processing: ${processingFiles.map(f => f.originalname).join(', ')}`);
          return res.status(400).json({ 
            error: "Document is still being processed. Please wait for processing to complete before asking questions.",
            processingFiles: processingFiles.map(f => ({ id: f.id, name: f.originalname, status: f.status }))
          });
        }
        
        // Fallback: Get all chunks from processed files
        console.log(`   - Attempting fallback: Using all chunks from processed files...`);
        const fallbackChunks = [];
        for (const file of files) {
          if (file.status === 'processed') {
            const fileChunks = await FileChunk.getChunksByFileId(file.id);
            console.log(`     - File ${file.originalname}: Found ${fileChunks.length} chunks`);
            if (fileChunks.length > 0) {
              fallbackChunks.push(...fileChunks.map(c => ({
                ...c,
                filename: file.originalname,
                file_id: file.id,
                similarity: 0.5, // Default similarity for fallback
                distance: 1.0,
                chunk_id: c.id,
                content: c.content
              })));
            }
          }
        }
        
        if (fallbackChunks.length > 0) {
          console.log(`   ✅ Fallback successful: Using ${fallbackChunks.length} chunks from ${files.length} file(s)`);
          allRelevantChunks.push(...fallbackChunks);
        } else {
          console.error(`\n❌ [RAG] No chunks found even with fallback!`);
          console.error(`   - Files searched: ${files.length}`);
          console.error(`   - Files status: ${files.map(f => `${f.originalname}: ${f.status}`).join(', ')}`);
          console.error(`   - This could mean:`);
          console.error(`     1. Chunks/embeddings not yet generated (processing may still be in progress)`);
          console.error(`     2. Embeddings don't match the query`);
          console.error(`     3. File IDs don't match`);
          console.error(`     4. No chunks were created during processing`);
          return res.status(404).json({ 
            error: "No relevant information found for your query.",
            details: "The document may still be processing, or no content was extracted. Please check the document status.",
            filesStatus: files.map(f => ({ id: f.id, name: f.originalname, status: f.status }))
          });
        }
      }

      // Sort by similarity and take top chunks
      const topChunks = allRelevantChunks
        .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
        .slice(0, 10);
      
      console.log(`   - Top chunks selected: ${topChunks.length}`);
      console.log(`   - Similarity range: ${Math.min(...topChunks.map(c => c.similarity)).toFixed(3)} - ${Math.max(...topChunks.map(c => c.similarity)).toFixed(3)}`);
      usedChunkIds = topChunks.map(c => c.chunk_id || c.id);

      // Build context
      const combinedContext = topChunks
        .map((c) => `📄 [${c.filename}]\n${c.content}`)
        .join("\n\n");

      // Build final prompt
      let finalPrompt = secretValue;
      if (caseContext) {
        finalPrompt = `${caseContext}\n\n${finalPrompt}`;
      }
      if (conversationContext) {
        finalPrompt = `Previous Conversation:\n${conversationContext}\n\n---\n\n${finalPrompt}`;
      }
      finalPrompt += `\n\n=== RELEVANT DOCUMENTS (FOLDER: "${folderName}") ===\n${combinedContext}`;
      if (additional_input?.trim()) {
        finalPrompt += `\n\n=== ADDITIONAL INPUT ===\n${additional_input.trim()}`;
      }

      // Add user profile context
      try {
        const profileContext = await UserProfileService.getProfileContext(userId, authorizationHeader);
        if (profileContext) {
          finalPrompt = `${profileContext}\n\n---\n\n${finalPrompt}`;
        }
      } catch (profileError) {
        console.warn(`Failed to fetch profile context:`, profileError.message);
      }

      // ✅ CRITICAL: Use RAG LLM service with the provider from secret configuration
      console.log(`\n🤖 Using LLM from secret configuration: ${provider}`);
      answer = await askFolderLLMService(provider, finalPrompt, '', combinedContext);

      console.log(`\n✅ RAG METHOD COMPLETED SUCCESSFULLY:`);
      console.log(`   🔐 Secret Prompt Used: "${secretName}"`);
      console.log(`   🤖 LLM Used: ${provider} (from secret config)`);
      console.log(`   📊 Answer Length: ${answer.length} characters`);
      console.log(`   🧩 Chunks Used: ${topChunks.length}`);
      console.log(`${'='.repeat(80)}\n`);
    }

    // ================================
    // CASE 2: CUSTOM QUESTION
    // ================================
    else {
      if (!question?.trim())
        return res.status(400).json({ error: "question is required for custom queries." });

      console.log(`\n${'='.repeat(80)}`);
      console.log(`💬 PROCESSING CUSTOM QUESTION`);
      console.log(`Question: "${question.substring(0, 100)}..."`);
      console.log(`${'='.repeat(80)}\n`);

      storedQuestion = question;
      displayQuestion = question;
      finalPromptLabel = null;

      // Fetch LLM from custom_query table (like old controller)
      let dbLlmName = null;
      const customQueryLlm = `
        SELECT cq.llm_name, cq.llm_model_id
        FROM custom_query cq
        ORDER BY cq.id DESC
        LIMIT 1;
      `;
      const customQueryResult = await pool.query(customQueryLlm);
      if (customQueryResult.rows.length > 0) {
        dbLlmName = customQueryResult.rows[0].llm_name;
        console.log(`🤖 LLM from custom_query table: ${dbLlmName}`);
      } else {
        console.warn(`⚠️ No LLM in custom_query table — falling back to gemini`);
        dbLlmName = 'gemini';
      }

      // Resolve provider
      provider = resolveFolderProviderName(dbLlmName || "gemini");
      console.log(`🤖 Resolved provider: ${provider}`);

      // Check if provider is available
      const availableProviders = getFolderAvailableProviders();
      if (!availableProviders[provider] || !availableProviders[provider].available) {
        console.warn(`⚠️ Provider '${provider}' unavailable — falling back to gemini`);
        provider = 'gemini';
      }

      // Analyze query intent
      const queryAnalysis = analyzeQueryIntent(question);
      console.log(`💬 Query Analysis: ${queryAnalysis.strategy} - ${queryAnalysis.reason}`);

      const isGeminiProvider = provider.toLowerCase().includes('gemini');

      // FREE TIER: Enforce restrictions
      if (isFreeUser) {
        // Check Gemini Eyeball limit (only 1 use per day)
        if (queryAnalysis.needsFullDocument) {
          const eyeballLimitCheck = await TokenUsageService.checkFreeTierEyeballLimit(userId, plan);
          if (!eyeballLimitCheck.allowed) {
            console.log(`\n${'🆓'.repeat(40)}`);
            console.log(`[FREE TIER] Gemini Eyeball limit reached - forcing RAG`);
            console.log(`[FREE TIER] ${eyeballLimitCheck.message}`);
            console.log(`${'🆓'.repeat(40)}\n`);
            
            // Force RAG for free users after first Eyeball use
            queryAnalysis.needsFullDocument = false;
            queryAnalysis.strategy = 'TARGETED_RAG';
            queryAnalysis.reason = 'Free tier: Gemini Eyeball limit reached (1/day), using RAG retrieval instead';
          } else {
            console.log(`\n${'🆓'.repeat(40)}`);
            console.log(`[FREE TIER] Gemini Eyeball allowed: ${eyeballLimitCheck.message}`);
            console.log(`${'🆓'.repeat(40)}\n`);
          }
        } else {
          // RAG is allowed for subsequent chats after first Eyeball use
          console.log(`\n${'🆓'.repeat(40)}`);
          console.log(`[FREE TIER] Using RAG retrieval (subsequent chat after first Eyeball use)`);
          console.log(`${'🆓'.repeat(40)}\n`);
        }
      }

      // Check free tier daily token limit before processing
      if (isFreeUser) {
        // Estimate tokens (rough estimate: ~4 chars per token for input, ~3 chars per token for output)
        const inputTokens = Math.ceil((question?.length || 0) / 4);
        const estimatedOutputTokens = Math.ceil(inputTokens * 1.5); // Estimate output tokens
        const estimatedTokens = inputTokens + estimatedOutputTokens;
        
        const tokenLimitCheck = await TokenUsageService.checkFreeTierDailyTokenLimit(userId, plan, estimatedTokens);
        if (!tokenLimitCheck.allowed) {
          return res.status(403).json({
            error: tokenLimitCheck.message,
            dailyLimit: tokenLimitCheck.dailyLimit,
            used: tokenLimitCheck.used,
            remaining: tokenLimitCheck.remaining,
            upgradeRequired: true
          });
        }
        console.log(`[FREE TIER] Token check passed: ${tokenLimitCheck.message}`);
      }

      // ROUTING DECISION FOR CUSTOM QUERIES
      if (isGeminiProvider && queryAnalysis.needsFullDocument) {
        // ========================================
        // USE GEMINI EYEBALL FOR COMPREHENSIVE ANALYSIS
        // ========================================
        methodUsed = "gemini_eyeball";

        console.log(`\n${'='.repeat(80)}`);
        console.log(`👁️ USING GEMINI EYEBALL METHOD`);
        console.log(`Reason: Gemini provider + comprehensive query`);
        console.log(`Files to process: ${files.length}`);
        console.log(`${'='.repeat(80)}\n`);

        const bucketName = process.env.GCS_BUCKET_NAME;
        if (!bucketName) {
          throw new Error('GCS_BUCKET_NAME not configured');
        }

        // Build documents array with GCS URIs
        const documents = files.map((file) => ({
          gcsUri: `gs://${bucketName}/${file.gcs_path}`,
          filename: file.originalname,
          mimeType: file.mimetype || 'application/pdf'
        }));

        // Build prompt with context
        let promptText = question;
        if (caseContext) {
          promptText = `${caseContext}\n\n${promptText}`;
        }
        if (conversationContext) {
          promptText = `Previous Conversation:\n${conversationContext}\n\n---\n\n${promptText}`;
        }

        // Add user profile context
        try {
          const profileContext = await UserProfileService.getProfileContext(userId, authorizationHeader);
          if (profileContext) {
            promptText = `${profileContext}\n\n---\n\n${promptText}`;
          }
        } catch (profileError) {
          console.warn(`Failed to fetch profile context:`, profileError.message);
        }

        // Use Gemini Eyeball
        const { askGeminiWithMultipleGCS } = require('../services/folderGeminiService');
        // FREE TIER: Force gemini-2.5-flash model
        const forcedModel = isFreeUser ? TokenUsageService.getFreeTierForcedModel() : null;
        answer = await askGeminiWithMultipleGCS(promptText, documents, '', forcedModel);
        // ✅ Ensure answer is plain text, not JSON
        answer = ensurePlainTextAnswer(answer);

        usedChunkIds = []; // Eyeball uses full documents, not chunks

        console.log(`✅ Gemini Eyeball completed: ${answer.length} chars`);
      } else {
        // ========================================
        // USE RAG METHOD FOR TARGETED QUERIES OR NON-GEMINI
        // ========================================
        methodUsed = "rag";

        console.log(`\n${'='.repeat(80)}`);
        console.log(`🔍 USING RAG METHOD`);
        console.log(`Reason: ${isGeminiProvider ? 'Targeted query' : 'Non-Gemini provider'}`);
        console.log(`Provider: ${provider}`);
        console.log(`${'='.repeat(80)}\n`);

        // Calculate token cost
        const questionEmbedding = await generateEmbedding(question);
        console.log(`\n🔍 [RAG] Starting vector search for custom question...`);
        console.log(`   - Question: "${question.substring(0, 100)}${question.length > 100 ? '...' : ''}"`);
        console.log(`   - Files to search: ${files.length}`);
        console.log(`   - Max results per file: ${maxResults}`);
        
        const allRelevantChunks = [];
        for (const file of files) {
          console.log(`\n   🔍 Searching chunks in file: ${file.originalname}`);
          console.log(`      File ID: ${file.id} (type: ${typeof file.id})`);
          console.log(`      File Status: ${file.status}`);
          
          // First, verify chunks exist for this file
          const debugChunks = await FileChunk.getChunksByFileId(file.id);
          console.log(`      📋 Chunks in database: ${debugChunks.length}`);
          
          if (debugChunks.length === 0) {
            console.log(`      ⚠️ No chunks found in database for this file - skipping vector search`);
            continue;
          }
          
          // Check if embeddings exist
          const chunkIds = debugChunks.map(c => c.id);
          const debugVectors = await ChunkVector.getVectorsByChunkIds(chunkIds);
          console.log(`      🔗 Embeddings in database: ${debugVectors.length} for ${chunkIds.length} chunks`);
          
          if (debugVectors.length === 0) {
            console.log(`      ⚠️ WARNING: Chunks exist but no embeddings found!`);
            console.log(`      💡 This means embeddings were not generated. Using chunks directly as fallback.`);
            // Use chunks directly as fallback
            const fallbackChunks = debugChunks.map(c => ({
              ...c,
              filename: file.originalname,
              file_id: file.id,
              similarity: 0.5,
              distance: 1.0,
              chunk_id: c.id,
              content: c.content
            }));
            allRelevantChunks.push(...fallbackChunks);
            console.log(`      ✅ Added ${fallbackChunks.length} chunks as fallback (no embeddings available)`);
            continue;
          }
          
          // Perform vector search
          console.log(`      🔎 Performing vector search with embedding...`);
          const relevant = await ChunkVector.findNearestChunksAcrossFiles(
            questionEmbedding,
            maxResults,
            [file.id]
          );
          console.log(`      📊 Vector search found: ${relevant.length} relevant chunks`);
          
          if (relevant.length) {
            // Convert distance to similarity (distance is 0-2, similarity should be 0-1)
            // similarity = 1 / (1 + distance)
            const chunksWithSimilarity = relevant.map((r) => {
              const distance = parseFloat(r.distance) || 2.0;
              const similarity = 1 / (1 + distance); // Convert distance to similarity
              return {
                ...r,
                filename: file.originalname,
                file_id: file.id,
                similarity: similarity,
                distance: distance
              };
            });
            allRelevantChunks.push(...chunksWithSimilarity);
            console.log(`      ✅ Added ${chunksWithSimilarity.length} chunks (similarity range: ${Math.min(...chunksWithSimilarity.map(c => c.similarity)).toFixed(3)} - ${Math.max(...chunksWithSimilarity.map(c => c.similarity)).toFixed(3)})`);
          } else {
            console.log(`      ⚠️ Vector search returned 0 results, but ${debugChunks.length} chunks exist`);
            console.log(`      💡 Using all chunks as fallback since embeddings exist but don't match query`);
            // Use all chunks as fallback if vector search fails but chunks exist
            const fallbackChunks = debugChunks.map(c => ({
              ...c,
              filename: file.originalname,
              file_id: file.id,
              similarity: 0.3, // Lower similarity for fallback
              distance: 2.0,
              chunk_id: c.id,
              content: c.content
            }));
            allRelevantChunks.push(...fallbackChunks);
            console.log(`      ✅ Added ${fallbackChunks.length} chunks as fallback (vector search had no matches)`);
          }
        }

        console.log(`\n📊 [RAG] Vector search completed:`);
        console.log(`   - Total relevant chunks found: ${allRelevantChunks.length}`);

        // FALLBACK: If no chunks found via vector search, try using all chunks
        if (allRelevantChunks.length === 0) {
          console.warn(`\n⚠️ [RAG] No chunks found via vector search - trying fallback...`);
          console.warn(`   - Files searched: ${files.length}`);
          
          // Check if files are still processing
          const processingFiles = files.filter(f => f.status !== 'processed');
          if (processingFiles.length > 0) {
            console.warn(`   - ⚠️ ${processingFiles.length} file(s) still processing: ${processingFiles.map(f => f.originalname).join(', ')}`);
            return res.status(400).json({ 
              error: "Document is still being processed. Please wait for processing to complete before asking questions.",
              processingFiles: processingFiles.map(f => ({ id: f.id, name: f.originalname, status: f.status }))
            });
          }
          
          // Fallback: Get all chunks from processed files
          console.log(`   - Attempting fallback: Using all chunks from processed files...`);
          const fallbackChunks = [];
          for (const file of files) {
            if (file.status === 'processed') {
              const fileChunks = await FileChunk.getChunksByFileId(file.id);
              console.log(`     - File ${file.originalname}: Found ${fileChunks.length} chunks`);
              if (fileChunks.length > 0) {
                fallbackChunks.push(...fileChunks.map(c => ({
                  ...c,
                  filename: file.originalname,
                  file_id: file.id,
                  similarity: 0.5, // Default similarity for fallback
                  distance: 1.0,
                  chunk_id: c.id,
                  content: c.content
                })));
              }
            }
          }
          
          if (fallbackChunks.length > 0) {
            console.log(`   ✅ Fallback successful: Using ${fallbackChunks.length} chunks from ${files.length} file(s)`);
            allRelevantChunks.push(...fallbackChunks);
          } else {
            console.error(`\n❌ [RAG] No chunks found even with fallback!`);
            console.error(`   - Files searched: ${files.length}`);
            console.error(`   - Files status: ${files.map(f => `${f.originalname}: ${f.status}`).join(', ')}`);
            console.error(`   - This could mean:`);
            console.error(`     1. Chunks/embeddings not yet generated (processing may still be in progress)`);
            console.error(`     2. Embeddings don't match the query`);
            console.error(`     3. File IDs don't match`);
            console.error(`     4. No chunks were created during processing`);
            return res.status(404).json({ 
              error: "No relevant information found for your query.",
              details: "The document may still be processing, or no content was extracted. Please check the document status.",
              filesStatus: files.map(f => ({ id: f.id, name: f.originalname, status: f.status }))
            });
          }
        }

        // Sort by similarity and take top chunks
        const topChunks = allRelevantChunks
          .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
          .slice(0, 10);
        
        console.log(`   - Top chunks selected: ${topChunks.length}`);
        console.log(`   - Similarity range: ${Math.min(...topChunks.map(c => c.similarity)).toFixed(3)} - ${Math.max(...topChunks.map(c => c.similarity)).toFixed(3)}`);
        usedChunkIds = topChunks.map(c => c.chunk_id || c.id);

        // Calculate token cost
        const combinedContext = topChunks
          .map((c) => `📄 [${c.filename}]\n${c.content}`)
          .join("\n\n");

        chatCost = Math.ceil(question.length / 100) + Math.ceil(combinedContext.length / 200);

        // Check token limits
        const requestedResources = { tokens: chatCost, ai_analysis: 1 };
        const { allowed, message } = await TokenUsageService.enforceLimits(usage, plan, requestedResources);
        if (!allowed) {
          return res.status(403).json({
            error: `AI chat failed: ${message}`,
            timeLeftUntilReset: timeLeft
          });
        }

        // Build final prompt
        let finalPrompt = question;
        if (caseContext) {
          finalPrompt = `${caseContext}\n\n${finalPrompt}`;
        }
        if (conversationContext) {
          finalPrompt = `Previous Conversation:\n${conversationContext}\n\n---\n\n${finalPrompt}`;
        }
        finalPrompt += `\n\n=== RELEVANT DOCUMENTS (FOLDER: "${folderName}") ===\n${combinedContext}`;

        // Add user profile context
        try {
          const profileContext = await UserProfileService.getProfileContext(userId, authorizationHeader);
          if (profileContext) {
            finalPrompt = `${profileContext}\n\n---\n\n${finalPrompt}`;
          }
        } catch (profileError) {
          console.warn(`Failed to fetch profile context:`, profileError.message);
        }

        // Use RAG LLM service
        answer = await askFolderLLMService(provider, finalPrompt, '', combinedContext);
        // ✅ Ensure answer is plain text, not JSON
        answer = ensurePlainTextAnswer(answer);

        console.log(`✅ RAG completed: ${answer.length} chars, ${topChunks.length} chunks`);

        // Increment usage for custom queries
        await TokenUsageService.incrementUsage(userId, requestedResources);
      }
    }

    if (!answer?.trim()) {
      return res.status(500).json({ error: "Empty response from AI." });
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`✅ QUERY COMPLETED SUCCESSFULLY`);
    console.log(`Method: ${methodUsed.toUpperCase()}`);
    console.log(`Answer Length: ${answer.length} chars`);
    console.log(`Chunks Used: ${usedChunkIds.length}`);
    console.log(`${'='.repeat(80)}\n`);

    // Save chat
    const savedChat = await FolderChat.saveFolderChat(
      userId,
      folderName,
      storedQuestion,
      answer,
      finalSessionId,
      usedFileIds,
      usedChunkIds,
      used_secret_prompt,
      finalPromptLabel,
      secret_id,
      historyForStorage
    );

    // Return response
    return res.json({
      success: true,
      session_id: savedChat.session_id,
      answer,
      response: answer,
      llm_provider: provider,
      method: methodUsed,
      used_secret_prompt,
      prompt_label: finalPromptLabel,
      secret_id: used_secret_prompt ? secret_id : null,
      used_chunk_ids: usedChunkIds,
      files_queried: files.map((f) => f.originalname),
      total_files: files.length,
      chunks_used: usedChunkIds.length,
      timestamp: new Date().toISOString(),
      displayQuestion: displayQuestion,
      storedQuestion: storedQuestion,
      chat_history: savedChat.chat_history || [],
    });
  } catch (error) {
    console.error(`\n${'='.repeat(80)}`);
    console.error("❌ ERROR in queryFolderDocuments");
    console.error(`Type: ${error.name}`);
    console.error(`Message: ${error.message}`);
    console.error(`Stack: ${error.stack}`);
    console.error(`${'='.repeat(80)}\n`);

    return res.status(500).json({
      error: "Failed to get AI answer.",
      details: error.message,
    });
  }
};

// ---------------------------
// SSE Streaming Version of queryFolderDocuments
// Handles unlimited length responses with heartbeat to prevent timeout
// ---------------------------
exports.queryFolderDocumentsStream = async (req, res) => {
  let userId = req.user.id;
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

    console.log('[queryFolderDocumentsStream] Streaming started');

    // Post-upload folder query - use existing logic but stream the response
    // Strategy: Call queryFolderDocuments with a mock response that captures the answer
    // Then stream it back to the client

    let capturedData = null;
    let captureError = null;

    // Create mock response to capture the JSON response
    // Must have all methods that queryFolderDocuments might call
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
      end: () => { },
      headersSent: false,
      statusCode: 200
    };

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

    // Call the non-streaming version to build prompt and get answer
    try {
      // queryFolderDocuments expects (req, res) - pass both
      await exports.queryFolderDocuments(mockReq, mockRes);
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
      // Small delay for streaming effect
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // Send completion
    res.write(`data: ${JSON.stringify({
      type: 'done',
      session_id: capturedData.session_id,
      answer: answer, // ✅ Send plain text answer
      llm_provider: capturedData.llm_provider,
      used_chunk_ids: capturedData.used_chunk_ids,
      chunks_used: capturedData.chunks_used,
      files_queried: capturedData.files_queried,
      total_files: capturedData.total_files
    })}\n\n`);
    res.write(`data: [DONE]\n\n`);
    clearInterval(heartbeat);
    res.end();

  } catch (error) {
    console.error('❌ Error in queryFolderDocumentsStream:', error);
    clearInterval(heartbeat);
    if (!res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Failed to get AI answer.', details: error.message })}\n\n`);
    }
    res.end();
  }
};

/* ----------------- Get Folder Processing Status (NEW) ----------------- */
exports.getFolderProcessingStatus = async (req, res) => {
  try {
    const { folderName } = req.params;
    const userId = req.user.id;

    const files = await File.findByUserIdAndFolderPath(userId, folderName);
    const documents = files.filter(f => !f.is_folder);

    if (documents.length === 0) {
      return res.json({
        folderName,
        overallProgress: 100,
        processingStatus: { total: 0, queued: 0, processing: 0, completed: 0, failed: 0 },
        documents: []
      });
    }

    const processingStatus = {
      total: documents.length,
      queued: documents.filter(f => f.status === "queued" || f.status === "batch_queued").length,
      processing: documents.filter(f => f.status === "batch_processing" || f.status === "processing").length,
      completed: documents.filter(f => f.status === "processed").length,
      failed: documents.filter(f => f.status === "error").length
    };

    const overallProgress = Math.round((processingStatus.completed / documents.length) * 100);

    return res.json({
      folderName,
      overallProgress,
      processingStatus,
      documents: documents.map(doc => ({
        id: doc.id,
        name: doc.originalname,
        status: doc.status, // Fixed: was using doc.processing_status
        progress: doc.processing_progress
      }))
    });

  } catch (error) {
    console.error("❌ getFolderProcessingStatus error:", error);
    res.status(500).json({
      error: "Failed to get folder processing status",
      details: error.message
    });
  }
};

/* ----------------- Get File Processing Status (Existing) ----------------- */
exports.getFileProcessingStatus = async (req, res) => {
  try {
    const { file_id } = req.params;
    if (!file_id || file_id === 'undefined') {
      return res.status(400).json({ error: "A valid file_id is required." });
    }

    const file = await File.getFileById(file_id);
    if (!file || String(file.user_id) !== String(req.user.id)) {
      return res.status(403).json({ error: "Access denied or file not found." });
    }

    const job = await ProcessingJob.getJobByFileId(file_id);

    if (file.status === "processed") {
      const existingChunks = await FileChunk.getChunksByFileId(file_id);
      if (existingChunks && existingChunks.length > 0) {
        const formattedChunks = existingChunks.map((chunk) => ({
          text: chunk.content,
          metadata: {
            page_start: chunk.page_start,
            page_end: chunk.page_end,
            heading: chunk.heading,
          },
        }));
        return res.json({
          file_id: file.id,
          status: file.status,
          processing_progress: file.processing_progress,
          job_status: job ? job.status : "completed",
          job_error: job ? job.error_message : null,
          last_updated: file.updated_at,
          chunks: formattedChunks,
          summary: file.summary,
        });
      }
    }

    if (!job || !job.document_ai_operation_name) {
      return res.json({
        file_id: file.id,
        status: file.status,
        processing_progress: file.processing_progress,
        job_status: "not_queued",
        job_error: null,
        last_updated: file.updated_at,
        chunks: [],
        summary: file.summary,
      });
    }

    const status = await getOperationStatus(job.document_ai_operation_name);

    if (!status.done) {
      return res.json({
        file_id: file.id,
        status: "batch_processing",
        processing_progress: file.processing_progress,
        job_status: "running",
        job_error: null,
        last_updated: file.updated_at,
      });
    }

    if (status.error) {
      await File.updateProcessingStatus(file_id, "error", 0.0);
      await ProcessingJob.updateJobStatus(job.job_id, "failed", status.error.message);
      return res.status(500).json({
        file_id: file.id,
        status: "error",
        processing_progress: 0.0,
        job_status: "failed",
        job_error: status.error.message,
        last_updated: new Date().toISOString(),
      });
    }

    // Check if another process has already locked this file for processing
    const preProcessFile = await File.getFileById(file_id);
    if (preProcessFile.status === "processing_locked") {
      console.log(`[getFileProcessingStatus] 🔒 File ${file_id} is already being processed. Aborting duplicate trigger.`);
      return res.json({
        file_id: file.id,
        status: "processing",
        processing_progress: file.processing_progress,
        job_status: "running",
        job_error: null,
        last_updated: file.updated_at,
      });
    }

    // Acquire lock
    await File.updateProcessingStatus(file_id, "processing_locked", 75.0);

    const bucketName = fileOutputBucket.name;
    let prefix = job.gcs_output_uri_prefix;
    if (prefix.startsWith('gs://')) {
      prefix = prefix.replace(`gs://${bucketName}/`, "");
    }
    // Ensure prefix ends with / for proper directory matching
    if (!prefix.endsWith('/')) {
      prefix += '/';
    }
    
    console.log(`[getFileProcessingStatus] Fetching results from bucket: ${bucketName}, prefix: ${prefix}`);
    console.log(`[getFileProcessingStatus] Full output URI: ${job.gcs_output_uri_prefix}`);
    
    const extractedBatchTexts = await fetchBatchResults(bucketName, prefix);

    // Enhanced validation with detailed error information
    if (!extractedBatchTexts || extractedBatchTexts.length === 0) {
      const errorDetails = {
        file_id: file_id,
        bucket: bucketName,
        prefix: prefix,
        output_uri: job.gcs_output_uri_prefix,
        message: "Could not extract any meaningful text content from batch document. This may indicate: 1) Image-only PDF with no OCR text, 2) Corrupted document, 3) Document AI processing incomplete, or 4) JSON structure mismatch."
      };
      console.error(`[getFileProcessingStatus] ❌ Text extraction failed:`, errorDetails);
      
      // Update file status to error with detailed message
      await File.updateProcessingStatus(file_id, "error", 0.0, "Text extraction failed: No text content found in Document AI results");
      await ProcessingJob.updateJobStatus(job.job_id, "failed", errorDetails.message);
      
      throw new Error(`Could not extract any meaningful text content from batch document. Check logs for details. Output URI: ${job.gcs_output_uri_prefix}`);
    }
    
    // Check if extracted text has actual content
    const nonEmptyTexts = extractedBatchTexts.filter(item => item.text && item.text.trim());
    if (nonEmptyTexts.length === 0) {
      console.error(`[getFileProcessingStatus] ❌ All extracted text segments are empty`);
      const errorDetails = {
        file_id: file_id,
        total_segments: extractedBatchTexts.length,
        message: "Document AI returned results but all text segments are empty. This may indicate an image-only PDF or OCR processing issue."
      };
      await File.updateProcessingStatus(file_id, "error", 0.0);
      await ProcessingJob.updateJobStatus(job.job_id, "failed", errorDetails.message);
      throw new Error(`All extracted text segments are empty. Total segments: ${extractedBatchTexts.length}`);
    }
    
    console.log(`[getFileProcessingStatus] ✅ Successfully extracted ${nonEmptyTexts.length} non-empty text segments from ${extractedBatchTexts.length} total segments`);

    // Dynamically determine chunking method from secret_manager → chunking_methods
    let batchChunkingMethod = "recursive"; // Default fallback
    try {
      const chunkMethodQuery = `
        SELECT cm.method_name
        FROM processing_jobs pj
        LEFT JOIN secret_manager sm ON pj.secret_id = sm.id
        LEFT JOIN chunking_methods cm ON sm.chunking_method_id = cm.id
        WHERE pj.file_id = $1
        ORDER BY pj.created_at DESC
        LIMIT 1;
      `;
      const result = await pool.query(chunkMethodQuery, [file_id]);

      if (result.rows.length > 0) {
        batchChunkingMethod = result.rows[0].method_name;
        console.log(`[getFileProcessingStatus] ✅ Using chunking method from DB: ${batchChunkingMethod}`);
      } else {
        console.log(`[getFileProcessingStatus] No secret_id found for file ${file_id}, using default chunking method.`);
      }
    } catch (err) {
      console.error(`[getFileProcessingStatus] Error fetching chunking method: ${err.message}`);
      console.log(`[getFileProcessingStatus] Falling back to default chunking method: recursive`);
    }

    const chunks = await chunkDocument(extractedBatchTexts, file_id, batchChunkingMethod || 'recursive');

    if (chunks.length === 0) {
      await File.updateProcessingStatus(file_id, "processed", 100.0);
      await ProcessingJob.updateJobStatus(job.job_id, "completed");
      const updatedFile = await File.getFileById(file_id);
      return res.json({
        file_id: updatedFile.id,
        chunks: [],
        summary: updatedFile.summary,
        chunking_method: batchChunkingMethod,
      });
    }

    const chunkContents = chunks.map((c) => c.content);
    const embeddings = await generateEmbeddings(chunkContents);

    const chunksToSaveBatch = chunks.map((chunk, i) => {
      // ✅ CRITICAL: Extract page_start and page_end from metadata (or chunk directly)
      const page_start = chunk.metadata?.page_start !== null && chunk.metadata?.page_start !== undefined
        ? chunk.metadata.page_start
        : (chunk.page_start !== null && chunk.page_start !== undefined ? chunk.page_start : null);
      const page_end = chunk.metadata?.page_end !== null && chunk.metadata?.page_end !== undefined
        ? chunk.metadata.page_end
        : (chunk.page_end !== null && chunk.page_end !== undefined ? chunk.page_end : null);
      
      return {
        file_id: file_id,
        chunk_index: i,
        content: chunk.content,
        token_count: chunk.token_count,
        page_start: page_start,
        page_end: page_end || page_start, // Use page_start if page_end is null
        heading: chunk.metadata?.heading || chunk.heading || null,
      };
    });

    const savedChunksBatch = await FileChunk.saveMultipleChunks(chunksToSaveBatch);

    const vectorsToSaveBatch = savedChunksBatch.map((savedChunk) => {
      const originalChunkIndex = savedChunk.chunk_index;
      const embedding = embeddings[originalChunkIndex];
      return {
        chunk_id: savedChunk.id,
        embedding: embedding,
        file_id: file_id,
      };
    });

    await ChunkVector.saveMultipleChunkVectors(vectorsToSaveBatch);
    await File.updateProcessingStatus(file_id, "processed", 100.0);
    await ProcessingJob.updateJobStatus(job.job_id, "completed");

    let summary = null;
    try {
      if (chunks.length > 0) {
        // FIX: Pass the array of chunk objects directly to the summary function
        summary = await getSummaryFromChunks(chunks.map(c => c.content));
        await File.updateSummary(file_id, summary);
      }
    } catch (summaryError) {
      console.warn(`⚠️ Could not generate summary for file ID ${file_id}:`, summaryError.message);
    }

    const updatedFile = await File.getFileById(file_id);
    const fileChunks = await FileChunk.getChunksByFileId(file_id);

    const formattedChunks = fileChunks.map((chunk) => ({
      text: chunk.content,
      metadata: {
        page_start: chunk.page_start,
        page_end: chunk.page_end,
        heading: chunk.heading,
      },
    }));

    return res.json({
      file_id: updatedFile.id,
      status: updatedFile.status,
      processing_progress: updatedFile.processing_progress,
      job_status: "completed",
      job_error: null,
      last_updated: updatedFile.updated_at,
      chunks: formattedChunks,
      summary: updatedFile.summary,
      chunking_method: batchChunkingMethod,
    });
  } catch (error) {
    console.error("❌ getFileProcessingStatus error:", error);
    return res.status(500).json({
      error: "Failed to fetch processing status.",
      details: error.message,
    });
  }
};

/* ----------------- Helper function for cosine similarity ----------------- */
function calculateCosineSimilarity(vectorA, vectorB) {
  if (!vectorA || !vectorB || vectorA.length !== vectorB.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vectorA.length; i++) {
    dotProduct += vectorA[i] * vectorB[i];
    normA += vectorA[i] * vectorA[i];
    normB += vectorB[i] * vectorB[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}


/* ----------------- Get Folder Chat Session with History ----------------- */
exports.getFolderChatSessionById = async (req, res) => {
  try {
    const { folderName, sessionId } = req.params;
    const userId = req.user?.id;

    console.log(`📖 [getFolderChatSessionById] Fetching session: ${sessionId} for folder: ${folderName}, user: ${userId}`);

    if (!userId) {
      return res.status(401).json({
        error: "Unauthorized - user not found"
      });
    }

    // Validate sessionId is a valid UUID
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(sessionId)) {
      return res.status(400).json({
        error: "Invalid session ID format",
        sessionId
      });
    }

    // Get all messages for this session, ordered chronologically
    const chatHistory = await FolderChat.findAll({
      where: {
        user_id: userId,
        folder_name: folderName,
        session_id: sessionId
      },
      order: [["created_at", "ASC"]],
    });

    console.log(`📖 [getFolderChatSessionById] Found ${chatHistory.length} chat(s) for session: ${sessionId}`);

    if (chatHistory.length === 0) {
      return res.status(404).json({
        error: "Chat session not found",
        folderName,
        sessionId,
        message: "No chats found for this session. It may have been deleted or doesn't exist."
      });
    }

    // Get folder info
    const files = await File.findByUserIdAndFolderPath(userId, folderName);
    const processedFiles = files.filter(f => !f.is_folder && f.status === "processed");

    // Generate base URL for citations (if needed to regenerate)
    const protocol = req.protocol || 'http';
    const host = req.get('host') || '';
    const baseUrl = `${protocol}://${host}`;

    // ✅ Return citations from database - they're already stored permanently
    // If citations don't exist in DB (old records), try to generate them from chunk IDs
    const chatHistoryWithCitations = await Promise.all(
      chatHistory.map(async (chat) => {
        let citations = chat.citations || [];
        
        // If no citations in DB but chunk IDs exist, regenerate them
        if ((!citations || citations.length === 0) && chat.used_chunk_ids && chat.used_chunk_ids.length > 0) {
          try {
            const { extractCitationsFromChunks } = require('./intelligentFolderChatController');
            
            // Fetch chunks by their IDs
            const chunkIds = chat.used_chunk_ids;
            const chunksQuery = `
              SELECT 
                fc.id,
                fc.content,
                fc.page_start,
                fc.page_end,
                fc.file_id,
                uf.originalname AS filename
              FROM file_chunks fc
              JOIN user_files uf ON fc.file_id = uf.id
              WHERE fc.id = ANY($1::bigint[])
                AND uf.user_id = $2
              ORDER BY uf.originalname ASC, fc.page_start ASC;
            `;
            const { rows: chunks } = await pool.query(chunksQuery, [chunkIds, userId]);
            
            if (chunks.length > 0) {
              const formattedChunks = chunks.map(c => ({
                chunk_id: c.id,
                content: c.content,
                page_start: c.page_start,
                page_end: c.page_end,
                file_id: c.file_id,
                filename: c.filename,
              }));
              
              citations = await extractCitationsFromChunks(formattedChunks, baseUrl);
              
              // Update the database with generated citations
              if (citations.length > 0) {
                await pool.query(
                  `UPDATE folder_chats SET citations = $1::jsonb WHERE id = $2::uuid`,
                  [JSON.stringify(citations), chat.id]
                );
              }
            }
          } catch (citationError) {
            console.error(`❌ Error generating citations for chat ${chat.id}:`, citationError);
          }
        }

        return {
          id: chat.id,
          question: chat.used_secret_prompt ? `Analysis: ${chat.prompt_label || 'Secret Prompt'}` : chat.question,
          response: chat.answer,
          timestamp: chat.created_at,
          documentIds: chat.summarized_file_ids || [],
          usedChunkIds: chat.used_chunk_ids || [],
          used_secret_prompt: chat.used_secret_prompt || false,
          prompt_label: chat.prompt_label || null,
          secret_id: chat.secret_id || null,
          citations: citations || [], // ✅ Always return citations from database
        };
      })
    );

    return res.json({
      success: true,
      folderName,
      sessionId,
      chatHistory: chatHistoryWithCitations,
      documentsInFolder: processedFiles.map(f => ({
        id: f.id,
        name: f.originalname,
        status: f.status
      })),
      totalMessages: chatHistory.length
    });
  } catch (error) {
    console.error("❌ getFolderChatSessionById error:", error);
    console.error("❌ getFolderChatSessionById error stack:", error.stack);
    res.status(500).json({
      error: "Failed to fetch chat session",
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

exports.getFolderChatSessions = async (req, res) => {
  try {
    const { folderName } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized: No user found in token" });
    }

    const chatHistory = await FolderChat.findAll({
      where: {
        user_id: userId,
        folder_name: folderName
      },
      order: [["created_at", "ASC"]],
    });

    if (!chatHistory.length) {
      return res.status(200).json({
        success: true,
        folderName,
        sessions: [],
        documentsInFolder: [],
        totalSessions: 0,
        totalMessages: 0
      });
    }

    const sessions = {};
    chatHistory.forEach(chat => {
      if (!sessions[chat.session_id]) {
        sessions[chat.session_id] = {
          sessionId: chat.session_id,
          messages: []
        };
      }
      sessions[chat.session_id].messages.push({
        id: chat.id,
        question: chat.used_secret_prompt ? `Analysis: ${chat.prompt_label || 'Secret Prompt'}` : chat.question,
        response: chat.answer,
        timestamp: chat.created_at,
        documentIds: chat.summarized_file_ids || [],
        usedChunkIds: chat.used_chunk_ids || [],
        used_secret_prompt: chat.used_secret_prompt || false,
        prompt_label: chat.prompt_label || null,
      });
    });

    const files = await File.findByUserIdAndFolderPath(userId, folderName);
    const processedFiles = files.filter(f => !f.is_folder && f.status === "processed");

    return res.json({
      success: true,
      folderName,
      sessions: Object.values(sessions),
      documentsInFolder: processedFiles.map(f => ({
        id: f.id,
        name: f.originalname,
        status: f.status
      })),
      totalSessions: Object.keys(sessions).length,
      totalMessages: chatHistory.length
    });
  } catch (error) {
    console.error("❌ getFolderChatSessions error:", error);
    res.status(500).json({
      error: "Failed to fetch folder chat sessions",
      details: error.message
    });
  }
};

/* ----------------- Get Citations for Chat Message ----------------- */
/**
 * Get citations (page sources) for a specific chat message
 * GET /api/files/:folderName/chats/:chatId/citations
 */
exports.getChatCitations = async (req, res) => {
  try {
    const { folderName, chatId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        error: "Unauthorized - user not found"
      });
    }

    // Validate chatId is a valid UUID
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(chatId)) {
      return res.status(400).json({
        error: "Invalid chat ID format",
        chatId
      });
    }

    console.log(`📚 [getChatCitations] Fetching citations for chat: ${chatId}, folder: ${folderName}, user: ${userId}`);

    // Fetch the chat message
    const chatQuery = `
      SELECT id, question, answer, used_chunk_ids, summarized_file_ids, folder_name
      FROM folder_chats
      WHERE id = $1::uuid AND user_id = $2 AND folder_name = $3;
    `;
    const { rows: chatRows } = await pool.query(chatQuery, [chatId, userId, folderName]);

    if (chatRows.length === 0) {
      return res.status(404).json({
        error: "Chat message not found",
        chatId,
        folderName
      });
    }

    const chat = chatRows[0];
    
    // ✅ Priority 1: Return citations from database (stored permanently)
    let citations = chat.citations || [];
    
    // ✅ Priority 2: If no citations in DB but chunk IDs exist, generate and save them
    if ((!citations || citations.length === 0) && chat.used_chunk_ids && chat.used_chunk_ids.length > 0) {
      console.log(`🔄 [getChatCitations] No citations in DB, generating from chunk IDs for chat ${chatId}`);
      
      // Generate base URL for citations
      const protocol = req.protocol || 'http';
      const host = req.get('host') || '';
      const baseUrl = `${protocol}://${host}`;

      // Import citation extraction function
      const { extractCitationsFromChunks } = require('./intelligentFolderChatController');

      // Fetch chunks by their IDs
      const chunkIds = chat.used_chunk_ids;
      const chunksQuery = `
        SELECT 
          fc.id,
          fc.content,
          fc.page_start,
          fc.page_end,
          fc.heading,
          fc.file_id,
          uf.originalname AS filename,
          uf.mimetype
        FROM file_chunks fc
        JOIN user_files uf ON fc.file_id = uf.id
        WHERE fc.id = ANY($1::bigint[])
          AND uf.user_id = $2
        ORDER BY uf.originalname ASC, fc.page_start ASC;
      `;
      const { rows: chunks } = await pool.query(chunksQuery, [chunkIds, userId]);

      if (chunks.length > 0) {
        // Format chunks for citation extraction
        const formattedChunks = chunks.map(c => ({
          chunk_id: c.id,
          content: c.content,
          page_start: c.page_start,
          page_end: c.page_end,
          heading: c.heading,
          file_id: c.file_id,
          filename: c.filename,
          mimetype: c.mimetype,
        }));

        // Generate citations
        citations = await extractCitationsFromChunks(formattedChunks, baseUrl);

        // ✅ Save generated citations to database for future access
        if (citations.length > 0) {
          await pool.query(
            `UPDATE folder_chats SET citations = $1::jsonb WHERE id = $2::uuid`,
            [JSON.stringify(citations), chat.id]
          );
          console.log(`💾 [getChatCitations] Saved ${citations.length} citations to database for chat ${chatId}`);
        }
      } else {
        console.warn(`⚠️ [getChatCitations] No chunks found for IDs: ${chunkIds.join(', ')}`);
      }
    }
    
    if (!chat.used_chunk_ids || chat.used_chunk_ids.length === 0) {
      return res.status(200).json({
        success: true,
        chatId: chat.id,
        question: chat.question,
        citations: [],
        message: "No chunks were used for this response (may have used Gemini Eyeball or context-based method)"
      });
    }

    console.log(`✅ [getChatCitations] Returning ${citations.length} citations for chat ${chatId} (from DB: ${!!chat.citations})`);

    return res.status(200).json({
      success: true,
      chatId: chat.id,
      question: chat.question,
      citations: citations || [],
      chunks_used: chat.used_chunk_ids?.length || 0,
      chunk_ids: chat.used_chunk_ids || [],
      source: chat.citations ? 'database' : 'generated'
    });

  } catch (error) {
    console.error("❌ getChatCitations error:", error);
    console.error("❌ getChatCitations error stack:", error.stack);
    return res.status(500).json({
      error: "Failed to fetch chat citations",
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

/* ----------------- Continue Folder Chat Session ----------------- */
exports.continueFolderChat = async (req, res) => {
  let chatCost;
  const userId = req.user.id;
  const authorizationHeader = req.headers.authorization;

  try {
    const { folderName, sessionId } = req.params;
    const {
      question, // For custom queries
      maxResults = 10,
      used_secret_prompt = false, // NEW
      prompt_label = null, // NEW
      secret_id, // NEW
      llm_name, // NEW
      additional_input = '', // NEW
    } = req.body;

    if (!folderName) {
      return res.status(400).json({ error: "folderName is required." });
    }

    console.log(`[continueFolderChat] Continuing session ${sessionId} for folder: ${folderName}`);
    console.log(`[continueFolderChat] New question: ${question}`);
    console.log(`[continueFolderChat] Used secret prompt: ${used_secret_prompt}, secret_id: ${secret_id}, llm_name: ${llm_name}`);

    // 1. Fetch user's usage and plan details
    const { usage, plan, timeLeft } = await TokenUsageService.getUserUsageAndPlan(userId, authorizationHeader);

    // Verify session exists and get chat history
    const existingChats = await FolderChat.findAll({
      where: {
        user_id: userId,
        folder_name: folderName,
        session_id: sessionId
      },
      order: [["created_at", "ASC"]],
    });

    if (existingChats.length === 0) {
      return res.status(404).json({
        error: "Chat session not found. Please start a new conversation.",
        folderName,
        sessionId
      });
    }

    const conversationContext = formatFolderConversationHistory(existingChats);
    const historyForStorage = simplifyFolderHistory(existingChats);
    if (historyForStorage.length > 0) {
      const lastTurn = historyForStorage[historyForStorage.length - 1];
      console.log(
        `[continueFolderChat] Using ${historyForStorage.length} prior turn(s) for context. Most recent: Q="${(lastTurn.question || '').slice(0, 120)}", A="${(lastTurn.answer || '').slice(0, 120)}"`
      );
    } else {
      console.log('[continueFolderChat] No prior context for this session.');
    }

    // Get all processed files in the folder
    const files = await File.findByUserIdAndFolderPath(userId, folderName);
    const processedFiles = files.filter(f => !f.is_folder && f.status === "processed");

    console.log(`[continueFolderChat] Found ${processedFiles.length} processed files in folder ${folderName}`);

    if (processedFiles.length === 0) {
      return res.status(404).json({
        error: "No processed documents in folder",
        sessionId,
        chatHistory: existingChats.map(chat => ({
          question: chat.question,
          response: chat.response,
          timestamp: chat.created_at
        }))
      });
    }

    // Get all chunks from all files in the folder
    let allChunks = [];
    for (const file of processedFiles) {
      const chunks = await FileChunk.getChunksByFileId(file.id);
      const chunksWithFileInfo = chunks.map(chunk => ({
        ...chunk,
        filename: file.originalname,
        file_id: file.id
      }));
      allChunks = allChunks.concat(chunksWithFileInfo);
    }

    console.log(`[continueFolderChat] Total chunks found: ${allChunks.length}`);

    if (allChunks.length === 0) {
      const answer = "The documents in this folder don't appear to have any processed content yet. Please wait for processing to complete or check the document processing status.";

      // Save the new chat message
      const savedChat = await FolderChat.saveFolderChat(
        userId,
        folderName,
        question,
        answer,
        sessionId,
        processedFiles.map(f => f.id),
        [], // usedChunkIds - will be populated by vector search
        used_secret_prompt,
        prompt_label,
        secret_id,
        historyForStorage
      );

      const newChatEntry = {
        id: savedChat.id,
        question,
        answer,
        created_at: savedChat.created_at,
        used_secret_prompt,
        prompt_label,
      };

      return res.json({
        answer,
        sources: [],
        sessionId,
        chatHistory: [...existingChats, newChatEntry].map(chat => ({
          question: chat.question,
          response: chat.answer,
          timestamp: chat.created_at || chat.created_at,
          used_secret_prompt: chat.used_secret_prompt || false,
          prompt_label: chat.prompt_label || null,
        })),
        newMessage: {
          question,
          response: answer,
          timestamp: savedChat.created_at
        },
        chat_history: savedChat.chat_history || [],
      });
    }

    // Token cost (rough estimate)
    chatCost = Math.ceil(question.length / 100) + Math.ceil(allChunks.reduce((sum, c) => sum + c.content.length, 0) / 200) + Math.ceil(conversationContext.length / 200); // Question tokens + context tokens + history tokens

    // 2. Enforce token limits for AI analysis
    const requestedResources = { tokens: chatCost, ai_analysis: 1 };
    const { allowed, message } = await TokenUsageService.enforceLimits(usage, plan, requestedResources);

    if (!allowed) {
      return res.status(403).json({
        error: `AI chat failed: ${message}`,
        timeLeftUntilReset: timeLeft
      });
    }

    // Use keyword-based search for the new question
    const questionLower = question.toLowerCase();
    const questionWords = questionLower
      .split(/\s+/)
      .filter(word => word.length > 3 && !['what', 'where', 'when', 'how', 'why', 'which', 'this', 'that', 'these', 'those'].includes(word));

    console.log(`[continueFolderChat] Question keywords:`, questionWords);

    let relevantChunks = [];

    if (questionWords.length > 0) {
      // Score chunks based on keyword matches
      relevantChunks = allChunks.map(chunk => {
        const contentLower = chunk.content.toLowerCase();
        let score = 0;

        // Check for exact keyword matches
        for (const word of questionWords) {
          const regex = new RegExp(`\\b${word}\\b`, 'gi');
          const matches = (contentLower.match(regex) || []).length;
          score += matches * 2;
        }

        // Check for partial matches
        for (const word of questionWords) {
          if (contentLower.includes(word)) {
            score += 1;
          }
        }

        return {
          ...chunk,
          similarity_score: score
        };
      })
        .filter(chunk => chunk.similarity_score > 0)
        .sort((a, b) => b.similarity_score - a.similarity_score)
        .slice(0, maxResults);
    } else {
      // If no meaningful keywords, use first chunks from each document
      const chunksPerDoc = Math.max(1, Math.floor(maxResults / processedFiles.length));
      for (const file of processedFiles) {
        const fileChunks = allChunks.filter(chunk => chunk.file_id === file.id);
        const topChunks = fileChunks.slice(0, chunksPerDoc).map(chunk => ({
          ...chunk,
          similarity_score: 0.5
        }));
        relevantChunks = relevantChunks.concat(topChunks);
      }
    }

    console.log(`[continueFolderChat] Found ${relevantChunks.length} relevant chunks`);

    // Determine provider based on request type
    let provider;
    if (used_secret_prompt && secret_id) {
      // Handle secret prompt - resolve provider from secret config
      const { resolveProviderName: resolveFolderProviderName } = require('../services/folderAiService');
      const secretQuery = `
        SELECT s.llm_id, l.name AS llm_name
        FROM secret_manager s
        LEFT JOIN llm_models l ON s.llm_id = l.id
        WHERE s.id = $1
      `;
      const secretResult = await pool.query(secretQuery, [secret_id]);
      const dbLlmName = secretResult.rows[0]?.llm_name;
      provider = resolveFolderProviderName(llm_name || dbLlmName || 'gemini');
    } else {
      // Custom query - use Claude Sonnet 4
      provider = 'claude-sonnet-4';
      console.log(`🤖 Using Claude Sonnet 4 for custom query in continueFolderChat`);
    }

    // Prepare context for AI with conversation history
    const contextText = relevantChunks.map((chunk, index) =>
      `[Document: ${chunk.filename} - Page ${chunk.page_start || 'N/A'}]\n${chunk.content.substring(0, 2000)}`
    ).join("\n\n---\n\n");

    // Enhanced prompt with conversation context
    let prompt = `
You are an AI assistant continuing a conversation about documents in folder "${folderName}".

CURRENT QUESTION: "${question}"

RELEVANT DOCUMENT CONTENT:
${contextText}

INSTRUCTIONS:
1. Consider the conversation history when answering the current question.
2. If the question refers to previous responses (e.g., "tell me more about that", "what else", "can you elaborate"), use the conversation context.
3. Provide a comprehensive answer based on both the conversation history and document content.
4. Use specific details, quotes, and examples from the documents when possible.
5. If information spans multiple documents, clearly indicate which documents contain what information.
6. Maintain conversational flow and reference previous parts of the conversation when relevant.
7. Be thorough and helpful - synthesize information across all relevant documents.
`;

    prompt = appendFolderConversation(prompt, conversationContext);

    let answer = await askFolderLLMService(provider, prompt, '', contextText);
    // ✅ Ensure answer is plain text, not JSON
    answer = ensurePlainTextAnswer(answer);
    console.log(`[continueFolderChat] Generated answer length: ${answer.length} characters`);

    // Save the new chat message
    const savedChat = await FolderChat.saveFolderChat(
      userId,
      folderName,
      question,
      answer,
      sessionId,
      processedFiles.map(f => f.id),
      relevantChunks.map(c => c.id), // usedChunkIds
      used_secret_prompt,
      prompt_label,
      secret_id,
      historyForStorage
    );

    // 3. Increment usage after successful AI chat
    await TokenUsageService.incrementUsage(userId, requestedResources);

    // Prepare sources with detail
    const sources = relevantChunks.map(chunk => ({
      document: chunk.filename,
      content: chunk.content.substring(0, 400) + (chunk.content.length > 400 ? "..." : ""),
      page: chunk.page_start || 'N/A',
      relevanceScore: chunk.similarity_score || 0
    }));

    // Return complete chat history plus new message
    const newChatEntry = {
      id: savedChat.id,
      question,
      answer,
      created_at: savedChat.created_at,
      used_chunk_ids: relevantChunks.map(c => c.id),
      used_secret_prompt,
      prompt_label,
    };

    const fullChatHistory = [...existingChats, newChatEntry].map(chat => ({
      question: chat.question,
      response: chat.answer,
      timestamp: chat.created_at,
      usedChunkIds: chat.used_chunk_ids || [],
      used_secret_prompt: chat.used_secret_prompt || false,
      prompt_label: chat.prompt_label || null,
    }));

    return res.json({
      answer,
      sources,
      sessionId,
      folderName,
      chatHistory: fullChatHistory,
      newMessage: {
        question,
        response: answer,
        timestamp: savedChat.created_at
      },
      documentsSearched: processedFiles.length,
      chunksFound: relevantChunks.length,
      totalMessages: fullChatHistory.length,
      searchMethod: questionWords.length > 0 ? 'keyword_search' : 'document_sampling',
      chat_history: savedChat.chat_history || [],
    });

  } catch (error) {
    console.error("❌ continueFolderChat error:", error);
    // If an error occurs after token check but before increment, we should ideally roll back.
    // For now, we'll just log the error.
    res.status(500).json({
      error: "Failed to continue chat",
      details: error.message
    });
  }
};


/* ----------------- Delete Folder Chat Session ----------------- */
exports.deleteFolderChatSession = async (req, res) => {
  try {
    const { folderName, sessionId } = req.params;
    const userId = req.user.id;

    console.log(`🗑️ [deleteFolderChatSession] Deleting session: ${sessionId} for folder: ${folderName}, user: ${userId}`);

    // Check if sessionId is a valid UUID
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isValidUUID = UUID_REGEX.test(sessionId);
    
    if (!isValidUUID) {
      return res.status(400).json({
        error: "Invalid session ID format",
        sessionId,
        message: "Session ID must be a valid UUID format (e.g., bc428ae4-ec0f-4e24-af70-e7c35d8db42a)"
      });
    }

    // First, verify the session exists and belongs to this user and folder
    const checkQuery = `
      SELECT id, session_id, folder_name, created_at, question
      FROM folder_chats
      WHERE user_id = $1
        AND session_id = $2::uuid
      ORDER BY created_at DESC
      LIMIT 10
    `;
    
    const checkResult = await pool.query(checkQuery, [userId, sessionId]);
    console.log(`🗑️ [deleteFolderChatSession] Found ${checkResult.rows.length} chat(s) with session_id: ${sessionId}`);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        error: "Chat session not found",
        folderName,
        sessionId,
        message: "No chats found with this session ID for your user account."
      });
    }
    
    // Check if any match the folder_name (case-insensitive, trimmed)
    const normalizedFolderName = folderName.trim();
    const matchingFolder = checkResult.rows.filter(row => 
      row.folder_name && row.folder_name.trim().toLowerCase() === normalizedFolderName.toLowerCase()
    );
    
    console.log(`🗑️ [deleteFolderChatSession] Checking folder match:`);
    console.log(`   - Requested folder: "${normalizedFolderName}"`);
    console.log(`   - Found folders: ${[...new Set(checkResult.rows.map(r => r.folder_name))].join(', ')}`);
    console.log(`   - Matching chats: ${matchingFolder.length}`);
    
    if (matchingFolder.length === 0) {
      // Session exists but for different folder
      const actualFolders = [...new Set(checkResult.rows.map(r => r.folder_name).filter(Boolean))];
      return res.status(404).json({
        error: "Chat session not found in this folder",
        folderName: normalizedFolderName,
        sessionId,
        message: `Session exists but belongs to different folder(s): ${actualFolders.join(', ')}`,
        availableFolders: actualFolders,
        debug: {
          requestedFolder: normalizedFolderName,
          foundFolders: actualFolders
        }
      });
    }
    
    // Delete all chats in this session for this folder
    // Use case-insensitive folder matching to handle any whitespace/case issues
    const deleteQuery = `
      DELETE FROM folder_chats
      WHERE user_id = $1
        AND session_id = $2::uuid
        AND LOWER(TRIM(folder_name)) = LOWER(TRIM($3))
      RETURNING id, folder_name, question
    `;

    const result = await pool.query(deleteQuery, [userId, sessionId, normalizedFolderName]);
    const deletedCount = result.rowCount || 0;

    console.log(`🗑️ [deleteFolderChatSession] Deleted ${deletedCount} chat(s) for session: ${sessionId}`);

    if (deletedCount === 0) {
      return res.status(404).json({
        error: "Chat session not found",
        folderName: normalizedFolderName,
        sessionId,
        message: "No chats found for this session. It may have already been deleted or doesn't exist."
      });
    }

    return res.json({
      success: true,
      message: `Deleted chat session with ${deletedCount} message(s)`,
      folderName: normalizedFolderName,
      sessionId,
      deletedMessages: deletedCount,
      deletedChats: result.rows.map(row => ({
        id: row.id,
        folder_name: row.folder_name,
        question: row.question?.substring(0, 100) + (row.question?.length > 100 ? '...' : '')
      }))
    });
  } catch (error) {
    console.error("❌ deleteFolderChatSession error:", error);
    console.error("❌ deleteFolderChatSession error stack:", error.stack);
    res.status(500).json({
      error: "Failed to delete chat session",
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};




// Fetch all chats for a specific folder
exports.getFolderChatsByFolder = async (req, res) => {
  try {
    const { folderName } = req.params;
    const userId = req.user.id; // assuming user is authenticated and middleware sets req.user

    const chats = await FolderChat.getFolderChatHistory(userId, folderName);

    res.status(200).json({
      success: true,
      folderName,
      chats,
    });
  } catch (error) {
    console.error("Error fetching folder chats:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch chats for folder",
    });
  }
};

/* ---------------------- Get Documents in a Specific Folder ---------------------- */
exports.getDocumentsInFolder = async (req, res) => {
  try {
    const { folderName } = req.params;
    const userId = req.user.id;

    if (!folderName) {
      return res.status(400).json({ error: "Folder name is required." });
    }

    const files = await File.findByUserIdAndFolderPath(userId, folderName);

    const documents = files
      .filter(file => !file.is_folder)
      .map(file => ({
        id: file.id,
        name: file.originalname,
        size: file.size,
        mimetype: file.mimetype,
        created_at: file.created_at,
        status: file.status,
        processing_progress: file.processing_progress,
        folder_path: file.folder_path,
      }));

    return res.status(200).json({
      message: `Documents in folder '${folderName}' fetched successfully.`,
      folderName: folderName,
      documents: documents,
      totalDocuments: documents.length,
    });
  } catch (error) {
    console.error("❌ Error fetching documents in folder:", error);
    res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  }
};



/* ---------------------- Get All Cases for User (FIXED) ---------------------- */
exports.getAllCases = async (req, res) => {
  try {
    const userId = parseInt(req.user?.id);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized user" });
    }

    const getAllCasesQuery = `
      SELECT
        c.*,
        ct.name as case_type_name,
        st.name as sub_type_name,
        co.name as court_name_name
      FROM cases c
      LEFT JOIN case_types ct ON 
        CASE 
          WHEN c.case_type ~ '^[0-9]+$' THEN c.case_type::integer = ct.id
          ELSE false
        END
      LEFT JOIN sub_types st ON 
        CASE 
          WHEN c.sub_type ~ '^[0-9]+$' THEN c.sub_type::integer = st.id
          ELSE false
        END
      LEFT JOIN courts co ON 
        CASE 
          WHEN c.court_name ~ '^[0-9]+$' THEN c.court_name::integer = co.id
          ELSE false
        END
      WHERE c.user_id = $1
      ORDER BY c.created_at DESC;
    `;
    const { rows: cases } = await pool.query(getAllCasesQuery, [userId]);

    // Parse JSON fields for each case
    const formattedCases = cases.map(caseData => {
      // Use lookup table names if available, otherwise use the original values
      caseData.case_type = caseData.case_type_name || caseData.case_type;
      caseData.sub_type = caseData.sub_type_name || caseData.sub_type;
      caseData.court_name = caseData.court_name_name || caseData.court_name;

      // Remove the now redundant name fields
      delete caseData.case_type_name;
      delete caseData.sub_type_name;
      delete caseData.court_name_name;

      try {
        if (typeof caseData.judges === 'string' && caseData.judges.trim() !== '') {
          caseData.judges = JSON.parse(caseData.judges);
        } else if (caseData.judges === null) {
          caseData.judges = []; // Default to empty array if null
        }
      } catch (e) {
        console.warn(`⚠️ Could not parse judges JSON for case ${caseData.id}: ${e.message}. Value: ${caseData.judges}`);
        caseData.judges = []; // Fallback to empty array on error
      }
      try {
        if (typeof caseData.petitioners === 'string' && caseData.petitioners.trim() !== '') {
          caseData.petitioners = JSON.parse(caseData.petitioners);
        } else if (caseData.petitioners === null) {
          caseData.petitioners = []; // Default to empty array if null
        }
      } catch (e) {
        console.warn(`⚠️ Could not parse petitioners JSON for case ${caseData.id}: ${e.message}. Value: ${caseData.petitioners}`);
        caseData.petitioners = []; // Fallback to empty array on error
      }
      try {
        if (typeof caseData.respondents === 'string' && caseData.respondents.trim() !== '') {
          caseData.respondents = JSON.parse(caseData.respondents);
        } else if (caseData.respondents === null) {
          caseData.respondents = []; // Default to empty array if null
        }
      } catch (e) {
        console.warn(`⚠️ Could not parse respondents JSON for case ${caseData.id}: ${e.message}. Value: ${caseData.respondents}`);
        caseData.respondents = []; // Fallback to empty array on error
      }
      return caseData;
    });

    return res.status(200).json({
      message: "Cases fetched successfully.",
      cases: formattedCases,
      totalCases: formattedCases.length,
    });
  } catch (error) {
    console.error("❌ Error fetching all cases:", error);
    res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  }
};

/* ---------------------- Get Case Files by Folder (FINAL FIXED) ---------------------- */
exports.getCaseFilesByFolderName = async (req, res) => {
  try {
    const userId = req.user.id;
    const username = req.user.username;
    const { folderName } = req.params;

    if (!folderName) {
      return res.status(400).json({ error: "Folder name is required" });
    }

    console.log(`📂 [getCaseFilesByFolderName] User: ${username}, Folder: ${folderName}`);

    // Step 1: Find folder record in DB
    const folderQuery = `
      SELECT * FROM user_files
      WHERE user_id = $1
        AND is_folder = true
        AND originalname = $2
      ORDER BY created_at DESC
      LIMIT 1;
    `;
    const { rows: folderRows } = await pool.query(folderQuery, [userId, folderName]);

    if (folderRows.length === 0) {
      console.warn(`⚠️ Folder "${folderName}" not found for user ${userId}`);
      return res.status(404).json({
        error: `Folder "${folderName}" not found for this user.`,
      });
    }

    const folder = folderRows[0];
    const folderPath = folder.folder_path; // ✅ Use the same folder_path stored during upload
    console.log(`✅ Folder found. Using folder_path: ${folderPath}`);

    // Step 2: Fetch all files having the same folder_path
    const filesQuery = `
      SELECT
        id,
        user_id,
        originalname,
        gcs_path,
        folder_path,
        mimetype,
        size,
        status,
        processing_progress,
        full_text_content,
        summary,
        edited_docx_path,
        edited_pdf_path,
        processed_at,
        created_at,
        updated_at,
        is_folder
      FROM user_files
      WHERE user_id = $1
        AND is_folder = false
        AND folder_path = $2
      ORDER BY created_at DESC;
    `;
    const { rows: files } = await pool.query(filesQuery, [userId, folderPath]);

    if (files.length === 0) {
      console.warn(`⚠️ No files found under folder_path: ${folderPath}`);
      return res.status(200).json({
        message: "Folder files fetched successfully, but no documents found.",
        folder,
        files: [],
        debug: {
          searched_folder_path: folderPath,
          hint: "Check that uploaded files used the same folder_path value",
        },
      });
    }

    // Step 3: Add signed URLs
    const filesWithUrls = await Promise.all(
      files.map(async (file) => {
        const previewUrl = await makeSignedReadUrl(file.gcs_path, 15);
        const viewUrl = await makeSignedReadUrl(file.gcs_path, 60); // Longer expiry for viewing
        return {
          ...file,
          previewUrl,
          viewUrl, // Direct URL to open/view the document
        };
      })
    );

    console.log(`✅ Returning ${filesWithUrls.length} files for folder "${folderName}"`);

    return res.status(200).json({
      message: "Folder files fetched successfully.",
      folder: {
        id: folder.id,
        name: folder.originalname,
        folder_path: folder.folder_path,
        gcs_path: folder.gcs_path,
      },
      files: filesWithUrls,
    });

  } catch (error) {
    console.error("❌ getCaseFilesByFolderName error:", error);
    return res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  }
};

/* ---------------------- View/Open Document ---------------------- */
/**
 * Get a signed URL to view/open a document directly
 * @route GET /files/:fileId/view
 */
exports.viewDocument = async (req, res) => {
  try {
    const userId = req.user.id;
    const { fileId } = req.params;
    const { expiryMinutes = 60 } = req.query; // Default 60 minutes

    if (!fileId) {
      return res.status(400).json({ error: "File ID is required" });
    }

    console.log(`👁️ [viewDocument] User: ${userId}, FileId: ${fileId}`);

    // Fetch the file from database
    const fileQuery = `
      SELECT 
        id,
        user_id,
        originalname,
        gcs_path,
        folder_path,
        mimetype,
        size,
        status,
        is_folder,
        created_at
      FROM user_files
      WHERE id = $1 AND user_id = $2 AND is_folder = false;
    `;
    const { rows } = await pool.query(fileQuery, [fileId, userId]);

    if (rows.length === 0) {
      console.warn(`⚠️ File ${fileId} not found for user ${userId}`);
      return res.status(404).json({
        error: "Document not found or you don't have permission to access it.",
      });
    }

    const file = rows[0];

    // Check if file exists in GCS
    const fileRef = bucket.file(file.gcs_path);
    const [exists] = await fileRef.exists();

    if (!exists) {
      console.error(`❌ File ${file.gcs_path} not found in GCS`);
      return res.status(404).json({
        error: "Document file not found in storage.",
      });
    }

    // Generate signed URL for viewing
    const viewUrl = await makeSignedReadUrl(file.gcs_path, parseInt(expiryMinutes));

    // Extract page number from query parameter (hash fragments #page=X are client-side only)
    // Frontend should append #page=X to the returned viewUrl
    const pageNumber = req.query.page ? parseInt(req.query.page, 10) : null;

    console.log(`✅ Generated view URL for file: ${file.originalname}${pageNumber ? ` (page ${pageNumber})` : ''}`);

    // Build the final URL - this is the signed GCS URL
    const finalViewUrl = viewUrl;
    
    // ✅ For PDFs, append #page=X to the signed URL (PDF viewers support this)
    // For other file types, page parameter is informational
    const viewUrlWithPage = pageNumber && file.mimetype === 'application/pdf' 
      ? `${finalViewUrl}#page=${pageNumber}` 
      : finalViewUrl;

    return res.status(200).json({
      success: true,
      message: "Document view URL generated successfully.",
      document: {
        id: file.id,
        name: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        status: file.status,
        folder_path: file.folder_path,
        created_at: file.created_at,
      },
      viewUrl: finalViewUrl, // Base signed URL from GCS (use this for iframe/embed)
      viewUrlWithPage: viewUrlWithPage, // URL with page hash for direct opening (PDFs)
      signedUrl: finalViewUrl, // Alias for viewUrl
      page: pageNumber || null, // Page number from query param (if provided)
      // Frontend instructions
      usage: {
        preview: "Use 'viewUrl' or 'signedUrl' to embed in iframe or open in new tab",
        pageNavigation: pageNumber 
          ? `Use 'viewUrlWithPage' to open directly at page ${pageNumber}. For other pages, append #page=N to viewUrl`
          : "Append #page=N to viewUrl to navigate to specific page (PDFs only)",
        example: pageNumber 
          ? `window.open(data.viewUrlWithPage, '_blank') // Opens at page ${pageNumber}`
          : `window.open(data.viewUrl + '#page=5', '_blank') // Opens at page 5`
      },
      expiresIn: `${expiryMinutes} minutes`,
      expiresAt: new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString(),
    });

  } catch (error) {
    console.error("❌ viewDocument error:", error);
    return res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  }
};

/* ---------------------- Stream/Download Document ---------------------- */
/**
 * Stream a document directly to the browser for inline viewing
 * @route GET /files/:fileId/stream
 */
exports.streamDocument = async (req, res) => {
  try {
    const userId = req.user.id;
    const { fileId } = req.params;
    const { download = false } = req.query; // Download vs inline viewing

    if (!fileId) {
      return res.status(400).json({ error: "File ID is required" });
    }

    console.log(`📥 [streamDocument] User: ${userId}, FileId: ${fileId}, Download: ${download}`);

    // Fetch the file from database
    const fileQuery = `
      SELECT 
        id,
        user_id,
        originalname,
        gcs_path,
        mimetype,
        size,
        is_folder
      FROM user_files
      WHERE id = $1 AND user_id = $2 AND is_folder = false;
    `;
    const { rows } = await pool.query(fileQuery, [fileId, userId]);

    if (rows.length === 0) {
      return res.status(404).json({
        error: "Document not found or you don't have permission to access it.",
      });
    }

    const file = rows[0];

    // Get file from GCS
    const fileRef = bucket.file(file.gcs_path);
    const [exists] = await fileRef.exists();

    if (!exists) {
      return res.status(404).json({
        error: "Document file not found in storage.",
      });
    }

    // Get file metadata
    const [metadata] = await fileRef.getMetadata();

    // Set appropriate headers
    const contentDisposition = download === 'true' || download === true
      ? `attachment; filename="${file.originalname}"`
      : `inline; filename="${file.originalname}"`;

    res.setHeader('Content-Type', file.mimetype || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition);
    res.setHeader('Content-Length', metadata.size || file.size);
    res.setHeader('Cache-Control', 'private, max-age=3600');

    // Stream the file
    const readStream = fileRef.createReadStream();

    readStream.on('error', (error) => {
      console.error(`❌ Stream error for file ${fileId}:`, error);
      if (!res.headersSent) {
        res.status(500).json({
          error: "Error streaming document",
          details: error.message,
        });
      }
    });

    readStream.pipe(res);

    console.log(`✅ Streaming file: ${file.originalname}`);

  } catch (error) {
    console.error("❌ streamDocument error:", error);
    if (!res.headersSent) {
      return res.status(500).json({
        error: "Internal server error",
        details: error.message,
      });
    }
  }
};

/**
 * @description Get file with all related data (chunks, chats, metadata) - user-specific
 * @route GET /api/files/file/:file_id/complete
 */
exports.getFileComplete = async (req, res) => {
  const userId = req.user.id;
  const { file_id } = req.params;

  try {
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!file_id) return res.status(400).json({ error: "file_id is required" });

    // Get file metadata
    const file = await File.getFileById(file_id);
    if (!file) {
      return res.status(404).json({ error: "File not found" });
    }

    // Verify user owns the file
    if (String(file.user_id) !== String(userId)) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Get all chunks for this file
    const chunks = await FileChunk.getChunksByFileId(file_id);

    // Get chat history for this file
    const chats = await FileChat.getChatHistory(file_id);

    // Get processing job if exists
    const processingJob = await ProcessingJob.getJobByFileId(file_id);

    // Get folder chat history if this file is in a folder
    let folderChats = [];
    if (file.folder_path) {
      const folderName = file.folder_path.split('/').pop() || file.folder_path;
      folderChats = await FolderChat.getFolderChatHistory(userId, folderName);
    }

    // Return complete file data
    return res.status(200).json({
      success: true,
      file: {
        id: file.id,
        user_id: file.user_id,
        originalname: file.originalname,
        gcs_path: file.gcs_path,
        folder_path: file.folder_path,
        mimetype: file.mimetype,
        size: file.size,
        is_folder: file.is_folder,
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
      folder_chats: folderChats.map(chat => ({
        id: chat.id,
        question: chat.question,
        answer: chat.answer,
        session_id: chat.session_id,
        created_at: chat.created_at
      })),
      processing_job: processingJob ? {
        job_id: processingJob.job_id,
        status: processingJob.status,
        type: processingJob.type,
        created_at: processingJob.created_at
      } : null,
      total_chunks: chunks.length,
      total_chats: chats.length,
      total_folder_chats: folderChats.length
    });
  } catch (error) {
    console.error("❌ getFileComplete error:", error);
    return res.status(500).json({ error: "Failed to retrieve file data" });
  }
};

/**
 * Get all chunks for a folder with page information
 * GET /api/files/:folderName/chunks
 * Returns all chunks from all processed files in the folder with page numbers
 */
exports.getFolderChunks = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { folderName } = req.params;
    const { fileId, page } = req.query; // Optional filters

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized - user not found" });
    }

    if (!folderName) {
      return res.status(400).json({ error: "folderName is required" });
    }

    console.log(`📄 [getFolderChunks] Fetching chunks for folder: ${folderName}, user: ${userId}`);

    // Get all processed files in folder
    const folderPattern = `%${folderName}%`;
    const filesQuery = `
      SELECT id, originalname, folder_path, status, gcs_path, mimetype
      FROM user_files
      WHERE user_id = $1
        AND is_folder = false
        AND status = 'processed'
        AND folder_path LIKE $2
      ORDER BY created_at DESC;
    `;
    const { rows: files } = await pool.query(filesQuery, [userId, folderPattern]);

    if (files.length === 0) {
      return res.status(404).json({
        error: "No processed documents found in this folder",
        folder_name: folderName
      });
    }

    console.log(`📄 [getFolderChunks] Found ${files.length} processed files in folder`);

    // Filter by fileId if provided
    const filesToProcess = fileId 
      ? files.filter(f => f.id === fileId)
      : files;

    if (fileId && filesToProcess.length === 0) {
      return res.status(404).json({
        error: `File with ID ${fileId} not found in folder ${folderName}`
      });
    }

    const allChunks = [];

    // Get chunks for each file
    for (const file of filesToProcess) {
      const chunks = await FileChunk.getChunksByFileId(file.id);
      
      for (const chunk of chunks) {
        // Filter by page if provided
        if (page) {
          const pageNum = parseInt(page, 10);
          if (chunk.page_start !== pageNum && chunk.page_end !== pageNum) {
            // Check if page is within range
            if (!(chunk.page_start <= pageNum && chunk.page_end >= pageNum)) {
              continue;
            }
          }
        }

        // Format chunk with page information
        const chunkWithPageInfo = {
          chunk_id: chunk.id,
          chunk_index: chunk.chunk_index,
          content: chunk.content,
          token_count: chunk.token_count,
          // Page information - clearly indicated
          page: chunk.page_start || null, // Primary page number
          page_start: chunk.page_start || null,
          page_end: chunk.page_end || null,
          page_range: chunk.page_start && chunk.page_end
            ? (chunk.page_start === chunk.page_end 
                ? `Page ${chunk.page_start}` 
                : `Pages ${chunk.page_start}-${chunk.page_end}`)
            : null,
          heading: chunk.heading || null,
          // File information
          file_id: file.id,
          filename: file.originalname,
          file_mimetype: file.mimetype,
        };

        allChunks.push(chunkWithPageInfo);
      }
    }

    // Sort by filename, then by page, then by chunk_index
    allChunks.sort((a, b) => {
      if (a.filename !== b.filename) {
        return a.filename.localeCompare(b.filename);
      }
      const pageA = a.page_start || 0;
      const pageB = b.page_start || 0;
      if (pageA !== pageB) {
        return pageA - pageB;
      }
      return (a.chunk_index || 0) - (b.chunk_index || 0);
    });

    console.log(`📄 [getFolderChunks] Returning ${allChunks.length} chunks from ${filesToProcess.length} file(s)`);

    // Group chunks by file for optional organization
    const chunksByFile = {};
    for (const chunk of allChunks) {
      if (!chunksByFile[chunk.file_id]) {
        chunksByFile[chunk.file_id] = {
          file_id: chunk.file_id,
          filename: chunk.filename,
          mimetype: chunk.file_mimetype,
          chunks: []
        };
      }
      chunksByFile[chunk.file_id].chunks.push(chunk);
    }

    return res.json({
      success: true,
      folder_name: folderName,
      total_files: filesToProcess.length,
      total_chunks: allChunks.length,
      filters: {
        fileId: fileId || null,
        page: page ? parseInt(page, 10) : null
      },
      // Return flat array for easy consumption
      chunks: allChunks,
      // Also return grouped by file (optional, for frontend flexibility)
      chunks_by_file: Object.values(chunksByFile),
      // Statistics
      statistics: {
        files_with_chunks: Object.keys(chunksByFile).length,
        chunks_with_pages: allChunks.filter(c => c.page_start !== null).length,
        chunks_without_pages: allChunks.filter(c => c.page_start === null).length,
        page_range: allChunks.length > 0 && allChunks.some(c => c.page_start !== null)
          ? {
              min: Math.min(...allChunks.filter(c => c.page_start !== null).map(c => c.page_start)),
              max: Math.max(...allChunks.filter(c => c.page_start !== null).map(c => c.page_end || c.page_start))
            }
          : null
      }
    });

  } catch (error) {
    console.error("❌ getFolderChunks error:", error);
    return res.status(500).json({
      error: "Failed to retrieve folder chunks",
      details: error.message
    });
  }
};


