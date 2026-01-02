// require("dotenv").config();

// const mime = require("mime-types");
// const path = require("path");
// const { v4: uuidv4 } = require("uuid");

// const pool = require("../config/db");

// const File = require("../models/File");
// const FileChat = require("../models/FileChat");
// const FileChunk = require("../models/FileChunk");
// const ChunkVector = require("../models/ChunkVector");
// const ProcessingJob = require("../models/ProcessingJob");
// const FolderChat = require("../models/FolderChat");

// const {
//   uploadToGCS,
//   getSignedUrl: getSignedUrlFromGCS, // Renamed to avoid conflict
//   getSignedUploadUrl,
// } = require("../services/gcsService");
// const { getSignedUrl } = require("../services/folderService"); // Import from folderService
// const { checkStorageLimit } = require("../utils/storage");
// const { bucket } = require("../config/gcs");
// const { askGemini, getSummaryFromChunks, askLLM, getAvailableProviders, resolveProviderName } = require("../services/aiService");
// const { askLLM: askFolderLLMService, streamLLM: streamFolderLLM, resolveProviderName: resolveFolderProviderName, getAvailableProviders: getFolderAvailableProviders } = require("../services/folderAiService"); // Import askLLM, streamLLM, resolveProviderName, and getAvailableProviders from folderAiService
// const UserProfileService = require("../services/userProfileService");
// const { extractText, detectDigitalNativePDF, extractTextFromPDFWithPages } = require("../utils/textExtractor");
// const {
//   extractTextFromDocument,
//   batchProcessDocument,
//   getOperationStatus,
//   fetchBatchResults,
// } = require("../services/documentAiService");
// const { chunkDocument } = require("../services/chunkingService");
// const { generateEmbedding, generateEmbeddings } = require("../services/embeddingService");
// const { enqueueEmbeddingJob } = require("../queues/embeddingQueue");
// const { fileInputBucket, fileOutputBucket } = require("../config/gcs");
// const TokenUsageService = require("../services/tokenUsageService"); // Import TokenUsageService
// const { SecretManagerServiceClient } = require('@google-cloud/secret-manager'); // NEW
// const secretManagerController = require('./secretManagerController'); // NEW
// const GCLOUD_PROJECT_ID = process.env.GCLOUD_PROJECT_ID; // NEW
// const { 
//   fetchTemplateFilesData, 
//   buildEnhancedSystemPromptWithTemplates,
//   fetchSecretManagerWithTemplates 
// } = require("../services/secretPromptTemplateService"); // NEW: Import template service
// let secretClient; // NEW

// if (!secretClient) { // NEW
//   secretClient = new SecretManagerServiceClient(); // NEW
// } // NEW

// function sanitizeName(name) {
//   return String(name).trim().replace(/[^a-zA-Z0-9._-]/g, "_");
// }

// function escapeRegExp(string) {
//   return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
// }

// async function ensureUniqueKey(key) {
//   const dir = path.posix.dirname(key);
//   const name = path.posix.basename(key);
//   const ext = path.posix.extname(name);
//   const stem = ext ? name.slice(0, -ext.length) : name;

//   let candidate = key;
//   let counter = 1;

//   while (true) {
//     const [exists] = await bucket.file(candidate).exists();
//     if (!exists) return candidate;
//     candidate = path.posix.join(dir, `${stem}(${counter})${ext}`);
//     counter++;
//   }
// }

// async function makeSignedReadUrl(objectKey, minutes = 15) {
//   const [signedUrl] = await bucket.file(objectKey).getSignedUrl({
//     version: "v4",
//     action: "read",
//     expires: Date.now() + minutes * 60 * 1000,
//   });
//   return signedUrl;
// }

// const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// const CONVERSATION_HISTORY_TURNS = 5;

// function formatFolderConversationHistory(chats = [], limit = CONVERSATION_HISTORY_TURNS) {
//   if (!Array.isArray(chats) || chats.length === 0) return '';
//   const recentChats = chats.slice(-limit);
//   return recentChats
//     .map((chat, idx) => {
//       const turnNumber = chats.length - recentChats.length + idx + 1;
//       return `Turn ${turnNumber}:\nUser: ${chat.question || ''}\nAssistant: ${chat.answer || ''}`;
//     })
//     .join('\n\n');
// }

// function simplifyFolderHistory(chats = []) {
//   if (!Array.isArray(chats)) return [];
//   return chats
//     .map((chat) => ({
//       id: chat.id,
//       question: chat.question,
//       answer: chat.answer,
//       created_at: chat.created_at,
//     }))
//     .filter((entry) => typeof entry.question === 'string' && typeof entry.answer === 'string');
// }

// function appendFolderConversation(prompt, conversationText) {
//   if (!conversationText) return prompt;
//   return `You are continuing a multi-turn chat for a folder-level analysis. Maintain context with earlier exchanges.\n\nPrevious Conversation:\n${conversationText}\n\n---\n\n${prompt}`;
// }

// async function fetchCaseDataForFolder(userId, folderName) {
//   try {
//     const folderQuery = `
//       SELECT id, originalname, folder_path
//       FROM user_files
//       WHERE user_id = $1
//         AND is_folder = true
//         AND (
//           folder_path = $2 
//           OR folder_path LIKE $3
//           OR folder_path LIKE $4
//           OR originalname = $2
//         )
//       ORDER BY created_at ASC
//       LIMIT 1;
//     `;
//     const folderPattern = `%${folderName}%`;
//     const folderEndPattern = `%/${folderName}`;
//     const { rows: folderRows } = await pool.query(folderQuery, [
//       userId,
//       folderName,
//       folderPattern,
//       folderEndPattern
//     ]);

//     if (folderRows.length === 0) {
//       console.log(`[fetchCaseDataForFolder] No folder found for folderName: ${folderName}`);
//       return null;
//     }

//     const folder = folderRows[0];

//     const caseQuery = `
//       SELECT *
//       FROM cases
//       WHERE user_id = $1
//         AND folder_id = $2
//       ORDER BY created_at DESC
//       LIMIT 1;
//     `;
//     const { rows: caseRows } = await pool.query(caseQuery, [userId, folder.id]);

//     if (caseRows.length === 0) {
//       console.log(`[fetchCaseDataForFolder] No case found for folder_id: ${folder.id}`);
//       return null;
//     }

//     return caseRows[0];
//   } catch (error) {
//     console.error(`[fetchCaseDataForFolder] Error fetching case data:`, error);
//     return null;
//   }
// }

// function formatCaseDataAsContext(caseData) {
//   if (!caseData) return '';

//   const formatJsonField = (field) => {
//     if (!field) return 'N/A';
//     if (typeof field === 'string') {
//       try {
//         const parsed = JSON.parse(field);
//         return Array.isArray(parsed) ? parsed.map(item => {
//           if (typeof item === 'object') {
//             return Object.entries(item).map(([key, val]) => `${key}: ${val || 'N/A'}`).join(', ');
//           }
//           return item;
//         }).join('; ') : JSON.stringify(parsed);
//       } catch {
//         return field;
//       }
//     }
//     if (Array.isArray(field)) {
//       return field.map(item => {
//         if (typeof item === 'object') {
//           return Object.entries(item).map(([key, val]) => `${key}: ${val || 'N/A'}`).join(', ');
//         }
//         return item;
//       }).join('; ');
//     }
//     return String(field);
//   };

//   const formatDate = (date) => {
//     if (!date) return 'N/A';
//     return new Date(date).toLocaleDateString('en-US', {
//       year: 'numeric',
//       month: 'long',
//       day: 'numeric'
//     });
//   };

//   return `=== CASE INFORMATION ===
// Case Title: ${caseData.case_title || 'N/A'}
// Case Number: ${caseData.case_number || 'N/A'}
// Filing Date: ${formatDate(caseData.filing_date)}
// Case Type: ${caseData.case_type || 'N/A'}
// Sub Type: ${caseData.sub_type || 'N/A'}
// Court Name: ${caseData.court_name || 'N/A'}
// Court Level: ${caseData.court_level || 'N/A'}
// Bench Division: ${caseData.bench_division || 'N/A'}
// Jurisdiction: ${caseData.jurisdiction || 'N/A'}
// State: ${caseData.state || 'N/A'}
// Judges: ${formatJsonField(caseData.judges)}
// Court Room No: ${caseData.court_room_no || 'N/A'}
// Petitioners: ${formatJsonField(caseData.petitioners)}
// Respondents: ${formatJsonField(caseData.respondents)}
// Category Type: ${caseData.category_type || 'N/A'}
// Primary Category: ${caseData.primary_category || 'N/A'}
// Sub Category: ${caseData.sub_category || 'N/A'}
// Complexity: ${caseData.complexity || 'N/A'}
// Monetary Value: ${caseData.monetary_value ? `₹${caseData.monetary_value}` : 'N/A'}
// Priority Level: ${caseData.priority_level || 'N/A'}
// Status: ${caseData.status || 'N/A'}
// ---`;
// }


// const PROGRESS_STAGES = {
//   INIT: { start: 0, end: 5, status: 'batch_queued' },
//   UPLOAD: { start: 5, end: 15, status: 'batch_queued' },
//   BATCH_START: { start: 15, end: 20, status: 'batch_processing' },
//   BATCH_OCR: { start: 20, end: 42, status: 'batch_processing' },
//   FETCH_RESULTS: { start: 42, end: 45, status: 'processing' },
//   CONFIG: { start: 45, end: 48, status: 'processing' },
//   CHUNKING: { start: 48, end: 58, status: 'processing' },
//   EMBEDDING_QUEUE: { start: 58, end: 68, status: 'processing' },
//   SAVE_CHUNKS: { start: 68, end: 78, status: 'processing' },
//   SUMMARY: { start: 78, end: 88, status: 'embedding_pending' },
//   FINALIZE: { start: 88, end: 100, status: 'embedding_pending' },
// };

// function getOperationName(progress, status) {
//   if (status === "processed" || status === "completed") return "Completed";
//   if (status === "error" || status === "failed") return "Failed";

//   const p = parseFloat(progress) || 0;

//   if (status === "batch_queued") {
//     if (p < 5) return "Initializing document processing";
//     if (p < 15) return "Uploading document to cloud storage";
//     return "Preparing batch operation";
//   }

//   if (status === "batch_processing") {
//     if (p < 20) return "Starting Document AI batch processing";
//     if (p < 25) return "Document uploaded to processing queue";
//     if (p < 30) return "OCR analysis in progress";
//     if (p < 35) return "Extracting text from document";
//     if (p < 40) return "Processing document layout";
//     return "Completing OCR extraction";
//   }

//   if (status === "embedding_pending") {
//     return "Waiting for background embedding";
//   }

//   if (status === "embedding_processing") {
//     return "Embedding chunks in background";
//   }

//   if (status === "embedding_failed") {
//     return "Embedding failed";
//   }

//   if (status === "processing") {
//     if (p < 45) return "Fetching OCR results";
//     if (p < 48) return "Loading chunking configuration";
//     if (p < 52) return "Initializing chunking";
//     if (p < 58) return "Chunking document into segments";
//     if (p < 64) return "Preparing for embedding";
//     if (p < 70) return "Connecting to embedding service";
//     if (p < 76) return "Generating AI embeddings";
//     if (p < 79) return "Preparing database storage";
//     if (p < 82) return "Saving chunks to database";
//     if (p < 85) return "Preparing vector embeddings";
//     if (p < 88) return "Storing vector embeddings";
//     if (p < 92) return "Generating AI summary";
//     if (p < 96) return "Saving document summary";
//     if (p < 98) return "Updating document metadata";
//     if (p < 100) return "Finalizing document processing";
//     return "Processing complete";
//   }

//   return "Queued";
// }


// const updateProgress = async (fileId, status, progress, operation = null) => {
//   const currentOperation = operation || getOperationName(progress, status);

//   await File.updateProcessingStatus(fileId, status, progress, currentOperation);

//   console.log(`[Progress] File ${fileId.substring(0, 8)}...: ${progress.toFixed(1)}% - ${currentOperation}`);

//   return {
//     file_id: fileId,
//     status,
//     progress: parseFloat(progress.toFixed(1)),
//     operation: currentOperation,
//     timestamp: new Date().toISOString()
//   };
// };

// const smoothProgressIncrement = async (
//   fileId,
//   status,
//   startProgress,
//   endProgress,
//   operation = null,
//   delayMs = 100
// ) => {
//   const start = parseFloat(startProgress);
//   const end = parseFloat(endProgress);
//   const steps = Math.ceil(end - start);

//   for (let i = 0; i <= steps; i++) {
//     const currentProgress = start + i;
//     if (currentProgress > end) break;

//     await updateProgress(fileId, status, currentProgress, operation);

//     if (i < steps) {
//       await new Promise(resolve => setTimeout(resolve, delayMs));
//     }
//   }
// };


// async function pollBatchProgress(fileId, jobId, operationName) {
//   console.log(`[Batch Polling] 🔄 Starting progress polling for file: ${fileId}`);

//   const maxPolls = 300; // 25 minutes max
//   let pollCount = 0;
//   let batchCompleted = false;

//   const pollInterval = setInterval(async () => {
//     try {
//       pollCount++;

//       const file = await File.getFileById(fileId);

//       if (!file) {
//         console.log(`[Batch Polling] ❌ File ${fileId} not found. Stopping.`);
//         clearInterval(pollInterval);
//         return;
//       }

//       if (file.status === "processing" || file.status === "processed") {
//         console.log(`[Batch Polling] ✅ Status: ${file.status}. Stopping poll.`);
//         clearInterval(pollInterval);
//         return;
//       }

//       if (file.status === "error") {
//         console.log(`[Batch Polling] ❌ Error detected. Stopping poll.`);
//         clearInterval(pollInterval);
//         return;
//       }

//       const status = await getOperationStatus(operationName);

//       if (status.done && !batchCompleted) {
//         batchCompleted = true;
//         console.log(`[Batch Polling] ✅ Batch operation COMPLETED for file: ${fileId}`);

//         if (status.error) {
//           console.error(`[Batch Polling] ❌ Batch failed:`, status.error.message);
//           await updateProgress(fileId, "error", 0, "Batch processing failed");
//           await ProcessingJob.updateJobStatus(jobId, "failed", status.error.message);
//           clearInterval(pollInterval);
//           return;
//         }

//         await updateProgress(fileId, "processing", 42.0, "OCR completed. Starting post-processing");

//         const job = await ProcessingJob.getJobByFileId(fileId);

//         if (!job) {
//           console.error(`[Batch Polling] ❌ Job not found for file: ${fileId}`);
//           clearInterval(pollInterval);
//           return;
//         }

//         console.log(`[Batch Polling] 🚀 Triggering post-processing for file: ${fileId}`);

//         if (file.status !== "processing_locked") {
//           File.updateProcessingStatus(fileId, "processing_locked", 42.0)
//             .then(() => {
//               processBatchResults(fileId, job).catch(err => {
//                 console.error(`[Batch Polling] ❌ Post-processing error:`, err);
//                 File.updateProcessingStatus(fileId, "error", 42.0, "Post-processing failed");
//               });
//             });
//         }

//         clearInterval(pollInterval);
//         return;
//       }

//       const currentProgress = parseFloat(file.processing_progress) || 20;

//       if (file.status === "batch_processing" && currentProgress < 42) {
//         const newProgress = Math.min(currentProgress + 0.5, 41.5);
//         await updateProgress(fileId, "batch_processing", newProgress);
//       }

//       if (pollCount >= maxPolls) {
//         console.warn(`[Batch Polling] ⚠️ Max polls reached for file: ${fileId}`);
//         await updateProgress(fileId, "error", 0, "Batch processing timeout");
//         await ProcessingJob.updateJobStatus(jobId, "failed", "Processing timeout");
//         clearInterval(pollInterval);
//       }

//     } catch (error) {
//       console.error(`[Batch Polling] ❌ Error in poll #${pollCount}:`, error.message);
//     }
//   }, 5000); // Poll every 5 seconds
// }


// async function processDocumentWithAI(
//   fileId,
//   fileBuffer,
//   mimetype,
//   userId,
//   originalFilename,
//   secretId = null
// ) {
//   const jobId = uuidv4();
//   console.log(`\n${"=".repeat(80)}`);
//   console.log(`[START] Processing: ${originalFilename} (File ID: ${fileId})`);
//   console.log(`[START] MIME Type: ${mimetype}`);
//   console.log(`[START] File Size: ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB`);
//   console.log(`${"=".repeat(80)}\n`);

//   try {
//     await updateProgress(fileId, "batch_queued", 0, "Initializing document processing");

//     await ProcessingJob.createJob({
//       job_id: jobId,
//       file_id: fileId,
//       type: "batch",
//       document_ai_operation_name: null,
//       status: "queued",
//       secret_id: secretId,
//     });

//     await smoothProgressIncrement(fileId, "batch_queued", 1, 5, "Processing job created", 100);

//     const isPDF = String(mimetype).toLowerCase() === 'application/pdf';
//     let extractedTexts = [];
//     let isDigitalNative = false;

//     if (isPDF) {
//       console.log(`\n${"🔍".repeat(40)}`);
//       console.log(`[PDF DETECTION] Starting digital-native detection...`);
//       console.log(`[PDF DETECTION] File: ${originalFilename}`);
//       console.log(`[PDF DETECTION] File ID: ${fileId}`);
//       console.log(`${"🔍".repeat(40)}\n`);
      
//       await updateProgress(fileId, "batch_queued", 6, "Analyzing PDF format (checking if digital-native)");
      
//       const pdfDetection = await detectDigitalNativePDF(fileBuffer);
      
//       console.log(`\n${"=".repeat(80)}`);
//       console.log(`[PDF DETECTION] Analysis Results for File ID: ${fileId}`);
//       console.log(`${"=".repeat(80)}`);
//       console.log(`  📄 Page Count: ${pdfDetection.pageCount}`);
//       console.log(`  📊 Non-whitespace Characters: ${pdfDetection.nonWhitespaceChars}`);
//       console.log(`  📏 Threshold: ${pdfDetection.threshold}`);
//       console.log(`  🎯 Confidence Score: ${pdfDetection.confidence || 0}%`);
//       if (pdfDetection.metrics) {
//         console.log(`  📈 Metrics:`);
//         console.log(`     - Characters per page: ${pdfDetection.metrics.charsPerPage}`);
//         console.log(`     - Words per page: ${pdfDetection.metrics.wordsPerPage}`);
//         console.log(`     - Non-whitespace chars/page: ${pdfDetection.metrics.nonWhitespaceCharsPerPage}`);
//         console.log(`     - Total words: ${pdfDetection.metrics.totalWords}`);
//         console.log(`     - Has sentences: ${pdfDetection.metrics.hasSentences ? 'Yes' : 'No'}`);
//         console.log(`     - OCR artifacts detected: ${pdfDetection.metrics.hasOCRArtifacts ? 'Yes' : 'No'}`);
//       }
//       if (pdfDetection.reasons && pdfDetection.reasons.length > 0) {
//         console.log(`  🔍 Detection Reasons:`);
//         pdfDetection.reasons.forEach((reason, idx) => {
//           console.log(`     ${idx + 1}. ${reason}`);
//         });
//       }
//       console.log(`  ✅ Is Digital Native: ${pdfDetection.isDigitalNative ? 'YES' : 'NO'}`);
//       console.log(`${"=".repeat(80)}\n`);
      
//       if (pdfDetection.isDigitalNative) {
//         isDigitalNative = true;
        
//         console.log(`\n${"🟢".repeat(40)}`);
//         console.log(`[TEXT EXTRACTION METHOD] ✅ DIGITAL-NATIVE PDF DETECTED`);
//         console.log(`[TEXT EXTRACTION METHOD] 📦 Using: pdf-parse (FREE - No Document AI cost)`);
//         console.log(`[TEXT EXTRACTION METHOD] 💰 Cost: $0.00 (Cost savings enabled)`);
//         console.log(`[TEXT EXTRACTION METHOD] ⚡ Speed: Fast (local parsing)`);
//         console.log(`${"🟢".repeat(40)}\n`);
        
//         await updateProgress(fileId, "processing", 20, "Extracting text from digital-native PDF (using pdf-parse)");
        
//         extractedTexts = await extractTextFromPDFWithPages(fileBuffer);
        
//         console.log(`[TEXT EXTRACTION] ✅ Successfully extracted ${extractedTexts.length} text segment(s) with page numbers`);
//         if (extractedTexts.length > 0 && extractedTexts[0].page_start) {
//           console.log(`[TEXT EXTRACTION] 📄 Page range: ${extractedTexts[0].page_start} - ${extractedTexts[0].page_end}`);
//         }
        
//         const totalExtractedText = extractedTexts.map(t => t.text || '').join(' ').trim();
//         const extractedWordCount = totalExtractedText.split(/\s+/).filter(w => w.length > 0).length;
//         const extractedCharCount = totalExtractedText.length;
//         const minWordsRequired = 10 * pdfDetection.pageCount; // At least 10 words per page
//         const minCharsRequired = 100 * pdfDetection.pageCount; // At least 100 chars per page
        
//         console.log(`[TEXT EXTRACTION] Validation:`);
//         console.log(`  - Extracted words: ${extractedWordCount} (minimum: ${minWordsRequired})`);
//         console.log(`  - Extracted characters: ${extractedCharCount} (minimum: ${minCharsRequired})`);
        
//         if (extractedWordCount < minWordsRequired || extractedCharCount < minCharsRequired) {
//           console.log(`\n${"⚠️".repeat(40)}`);
//           console.log(`[TEXT EXTRACTION] ⚠️ WARNING: Extracted text is too sparse`);
//           console.log(`[TEXT EXTRACTION] Digital-native detection may have been incorrect`);
//           console.log(`[TEXT EXTRACTION] Falling back to Document AI for better extraction`);
//           console.log(`${"⚠️".repeat(40)}\n`);
          
//           isDigitalNative = false;
//           extractedTexts = [];
//         } else {
//           await updateProgress(fileId, "processing", 42, "Text extraction completed (digital-native PDF - pdf-parse)");
          
//           await processDigitalNativePDF(fileId, extractedTexts, userId, secretId, jobId);
//           return; // Exit early, processing continues in background
//         }
//       } else {
//         console.log(`\n${"🟡".repeat(40)}`);
//         console.log(`[TEXT EXTRACTION METHOD] ⚠️ SCANNED PDF DETECTED`);
//         console.log(`[TEXT EXTRACTION METHOD] 📦 Using: Document AI OCR (Google Cloud)`);
//         console.log(`[TEXT EXTRACTION METHOD] 💰 Cost: Document AI pricing applies`);
//         console.log(`[TEXT EXTRACTION METHOD] ⏱️ Speed: Slower (cloud OCR processing)`);
//         if (pdfDetection.error) {
//           console.log(`[TEXT EXTRACTION METHOD] ⚠️ Detection error: ${pdfDetection.error}`);
//         }
//         console.log(`${"🟡".repeat(40)}\n`);
//       }
//     }

//     if (!isDigitalNative) {
//       console.log(`\n${"🔵".repeat(40)}`);
//       console.log(`[TEXT EXTRACTION METHOD] 🔵 DOCUMENT AI OCR`);
//       console.log(`[TEXT EXTRACTION METHOD] 📦 Using: Google Cloud Document AI`);
//       console.log(`[TEXT EXTRACTION METHOD] 📄 File Type: ${isPDF ? 'Scanned PDF' : mimetype}`);
//       console.log(`[TEXT EXTRACTION METHOD] 💰 Cost: Document AI pricing applies`);
//       console.log(`[TEXT EXTRACTION METHOD] ⏱️ Speed: Processing time depends on file size`);
//       console.log(`${"🔵".repeat(40)}\n`);

//       await updateProgress(fileId, "batch_queued", 6, "Uploading to cloud storage");

//       const batchUploadFolder = `batch-uploads/${userId}/${uuidv4()}`;
//       const { gsUri: gcsInputUri } = await uploadToGCS(
//         originalFilename,
//         fileBuffer,
//         batchUploadFolder,
//         true,
//         mimetype
//       );

//       console.log(`[Upload] Success: ${gcsInputUri}`);
//       await smoothProgressIncrement(fileId, "batch_queued", 7, 15, "Upload completed", 100);

//       await updateProgress(fileId, "batch_processing", 16, "Initializing Document AI");

//       const outputPrefix = `document-ai-results/${userId}/${uuidv4()}/`;
//       const gcsOutputUriPrefix = `gs://${fileOutputBucket.name}/${outputPrefix}`;

//       const operationName = await batchProcessDocument(
//         [gcsInputUri],
//         gcsOutputUriPrefix,
//         mimetype
//       );

//       console.log(`[Document AI] Operation started: ${operationName}`);

//       await ProcessingJob.updateJob(jobId, {
//         gcs_input_uri: gcsInputUri,
//         gcs_output_uri_prefix: gcsOutputUriPrefix,
//         document_ai_operation_name: operationName,
//         status: "running",
//       });

//       await smoothProgressIncrement(fileId, "batch_processing", 17, 20, "Batch processing started", 100);

//       console.log(`[Info] 🚀 Starting background polling for file: ${fileId}`);
//       pollBatchProgress(fileId, jobId, operationName);

//       console.log(`\n[Info] ✅ Batch processing initiated. Polling active.\n`);
//     } else {
//       console.log(`[processDocumentWithAI] ✅ Digital-native PDF detected - skipping Document AI batch processing`);
//     }

//   } catch (err) {
//     console.error(`\n❌ [ERROR] Failed to process file ${fileId}:`, err.message);
//     console.error(err.stack);
//     await updateProgress(fileId, "error", 0, `Initialization failed: ${err.message}`);
//     await ProcessingJob.updateJobStatus(jobId, "failed", err.message);
//   }
// }

    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    


    
    
    
    
    
    
    
    
    
    
    
// //     if (savedChunks.length !== chunksToSave.length) {
    
    
    
    
    
    
    
    
    
      
// //       if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
      
    
// //     if (validVectors.length !== vectorsToSave.length) {
    
    
// //     if (savedVectors.length !== validVectors.length) {
    
    
    
    
    
    
    
    
    
    
      
        
// //           console.error(`   ❌ WARNING: Chunks exist but NO embeddings found!`);
// //           console.log(`   ✅ All chunks have embeddings!`);
    
    
    

// async function processDigitalNativePDF(fileId, extractedTexts, userId, secretId, jobId) {
//   try {
//     console.log(`\n${'='.repeat(80)}`);
//     console.log(`[processDigitalNativePDF] Starting processing for File ID: ${fileId}`);
//     console.log(`${'='.repeat(80)}\n`);
    
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
    
//     await updateProgress(fileId, "processing", 60, "Saving chunks to database");
    
//     const chunksToSave = chunks.map((chunk, i) => {
//       const page_start = chunk.metadata?.page_start !== null && chunk.metadata?.page_start !== undefined
//         ? chunk.metadata.page_start
//         : (chunk.page_start !== null && chunk.page_start !== undefined ? chunk.page_start : null);
//       const page_end = chunk.metadata?.page_end !== null && chunk.metadata?.page_end !== undefined
//         ? chunk.metadata.page_end
//         : (chunk.page_end !== null && chunk.page_end !== undefined ? chunk.page_end : null);
      
//       if (i < 3) {
//         console.log(`[Save Chunks] Chunk ${i}: page_start=${page_start}, page_end=${page_end}, has metadata=${!!chunk.metadata}`);
//       }
      
//       return {
//         file_id: fileId,
//         chunk_index: i,
//         content: chunk.content,
//         token_count: chunk.token_count,
//         page_start: page_start,
//         page_end: page_end || page_start, // Use page_start if page_end is null
//         heading: chunk.metadata?.heading || chunk.heading || null,
//       };
//     });
    
//     console.log(`[processDigitalNativePDF] 💾 Saving ${chunksToSave.length} chunks to database...`);
//     const savedChunks = await FileChunk.saveMultipleChunks(chunksToSave);
//     console.log(`[processDigitalNativePDF] ✅ Saved ${savedChunks.length} chunks to database`);
    
//     if (savedChunks.length !== chunksToSave.length) {
//       console.error(`[processDigitalNativePDF] ❌ Chunk count mismatch: expected ${chunksToSave.length}, saved ${savedChunks.length}`);
//       throw new Error(`Chunk save failed: expected ${chunksToSave.length}, got ${savedChunks.length}`);
//     }
    
//     const chunkIds = savedChunks.map(c => c.id);
//     console.log(`[processDigitalNativePDF] 📋 Saved chunk IDs: ${chunkIds.slice(0, 5).join(', ')}${chunkIds.length > 5 ? `... (${chunkIds.length} total)` : ''}`);
    
//     await updateProgress(fileId, "processing", 68, `${savedChunks.length} chunks saved`);
    
//     await updateProgress(fileId, "processing", 70, "Generating embeddings");
    
//     const chunkContents = chunks.map(c => c.content);
//     console.log(`[processDigitalNativePDF] 🔄 Generating embeddings for ${chunkContents.length} chunks`);
    
//     let embeddings;
//     try {
//       embeddings = await generateEmbeddings(chunkContents);
//       console.log(`[processDigitalNativePDF] ✅ Generated ${embeddings.length} embeddings`);
      
//       if (embeddings.length !== chunkContents.length) {
//         console.error(`[processDigitalNativePDF] ❌ Embedding count mismatch: expected ${chunkContents.length}, got ${embeddings.length}`);
//         throw new Error(`Embedding generation failed: expected ${chunkContents.length}, got ${embeddings.length}`);
//       }
      
//       for (let i = 0; i < embeddings.length; i++) {
//         if (!embeddings[i] || !Array.isArray(embeddings[i]) || embeddings[i].length === 0) {
//           console.error(`[processDigitalNativePDF] ❌ Invalid embedding at index ${i}`);
//           throw new Error(`Invalid embedding at index ${i}: ${JSON.stringify(embeddings[i])}`);
//         }
//       }
      
//     } catch (embeddingError) {
//       console.error(`[processDigitalNativePDF] ❌ Embedding generation failed:`, embeddingError.message);
//       throw embeddingError;
//     }
    
//     await updateProgress(fileId, "processing", 75, "Embeddings generated");
    
//     await updateProgress(fileId, "processing", 76, "Saving vector embeddings");
    
//     console.log(`[processDigitalNativePDF] 🔗 Mapping chunks to embeddings...`);
//     const vectorsToSave = savedChunks.map((savedChunk, index) => {
//       const originalChunkIndex = savedChunk.chunk_index;
//       const embedding = embeddings[originalChunkIndex];
      
//       if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
//         console.error(`[processDigitalNativePDF] ❌ Missing/invalid embedding for chunk ${savedChunk.id} at index ${originalChunkIndex}`);
//         throw new Error(`Invalid embedding for chunk ${savedChunk.id}`);
//       }
      
//       return {
//         chunk_id: savedChunk.id,
//         embedding: embedding,
//         file_id: fileId,
//       };
//     });
    
//     console.log(`[processDigitalNativePDF] 💾 Saving ${vectorsToSave.length} vector embeddings to database...`);
    
//     let savedVectors;
//     try {
//       savedVectors = await ChunkVector.saveMultipleChunkVectors(vectorsToSave);
//       console.log(`[processDigitalNativePDF] ✅ Saved ${savedVectors.length} vector embeddings to database`);
      
//       if (savedVectors.length !== vectorsToSave.length) {
//         console.error(`[processDigitalNativePDF] ❌ Vector count mismatch: expected ${vectorsToSave.length}, saved ${savedVectors.length}`);
//         throw new Error(`Vector save failed: expected ${vectorsToSave.length}, got ${savedVectors.length}`);
//       }
      
//     } catch (vectorSaveError) {
//       console.error(`[processDigitalNativePDF] ❌ Failed to save vectors:`, vectorSaveError.message);
//       throw vectorSaveError;
//     }
    
//     const vectorIds = savedVectors.map(v => v.chunk_id);
//     console.log(`[processDigitalNativePDF] 📋 Saved vector chunk IDs: ${vectorIds.slice(0, 5).join(', ')}${vectorIds.length > 5 ? `... (${vectorIds.length} total)` : ''}`);
    
//     await updateProgress(fileId, "processing", 85, "Vector embeddings saved");
    
//     console.log(`\n[processDigitalNativePDF] 🔍 IMMEDIATE VERIFICATION CHECK`);
//     try {
//       const verifyVectors = await ChunkVector.getVectorsByChunkIds(chunkIds);
//       console.log(`   ✅ Verification: Found ${verifyVectors.length} embeddings in database for ${chunkIds.length} chunks`);
      
//       if (verifyVectors.length === 0) {
//         console.error(`   ❌ CRITICAL: Vectors were saved but CANNOT be retrieved!`);
//         throw new Error('Vectors saved but retrieval failed - database issue');
//       } else if (verifyVectors.length < chunkIds.length) {
//         console.warn(`   ⚠️ WARNING: Only ${verifyVectors.length} embeddings retrieved for ${chunkIds.length} chunks`);
//       } else {
//         console.log(`   ✅ All ${chunkIds.length} embeddings verified successfully`);
//       }
//     } catch (verifyError) {
//       console.error(`   ❌ Verification failed:`, verifyError.message);
//       throw new Error(`Embedding verification failed: ${verifyError.message}`);
//     }
    
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
    
//     await updateProgress(fileId, "processing", 98, "Finalizing processing");
    
//     await File.updateProcessingStatus(fileId, "processed", 100, "Completed");
//     await ProcessingJob.updateJobStatus(jobId, "completed");
    
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
//           console.error(`   ❌ CRITICAL ERROR: Chunks exist but NO embeddings found!`);
//           throw new Error('No embeddings found after save - critical database issue');
//         } else if (verifyVectors.length < verifyChunks.length) {
//           console.warn(`   ⚠️ WARNING: Only ${verifyVectors.length} embeddings for ${verifyChunks.length} chunks`);
//           throw new Error(`Incomplete embeddings: ${verifyVectors.length}/${verifyChunks.length}`);
//         } else {
//           console.log(`   ✅ SUCCESS: All ${verifyChunks.length} chunks have embeddings!`);
//         }
//       }
//     } catch (verifyError) {
//       console.error(`   ❌ Final verification failed:`, verifyError.message);
//       await File.updateProcessingStatus(fileId, "error", 0, `Verification failed: ${verifyError.message}`);
//       await ProcessingJob.updateJobStatus(jobId, "failed", verifyError.message);
//       throw verifyError;
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
//     console.log(`   ✅ All verifications passed`);
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
// async function processBatchResults(file_id, job) {
//   console.log(`\n${"=".repeat(80)}`);
//   console.log(`[POST-PROCESSING] Starting for File ID: ${file_id}`);
//   console.log(`${"=".repeat(80)}\n`);

//   try {
//     const currentFile = await File.getFileById(file_id);
//     console.log(`[POST-PROCESSING] Status: ${currentFile.status}, Progress: ${currentFile.processing_progress}%`);

//     await updateProgress(file_id, "processing", 42.5, "Fetching batch results");

//     const bucketName = fileOutputBucket.name;
//     const prefix = job.gcs_output_uri_prefix.replace(`gs://${bucketName}/`, "");

//     await smoothProgressIncrement(file_id, "processing", 43, 44, "Retrieving processed documents", 100);

//     const extractedBatchTexts = await fetchBatchResults(bucketName, prefix);
//     console.log(`[Extraction] ✅ Retrieved ${extractedBatchTexts.length} text segments`);

//     await updateProgress(file_id, "processing", 45, "Text extraction completed");

//     if (!extractedBatchTexts?.length || extractedBatchTexts.every(item => !item.text?.trim())) {
//       throw new Error("No text content extracted from document");
//     }

//     try {
//       const plainText = extractedBatchTexts
//         .map(segment => segment.text || '')
//         .filter(text => text.trim())
//         .join('\n\n');
      
//       if (plainText && plainText.trim()) {
//         console.log(`[Save Extracted Text] Saving plain text (${plainText.length} chars) to output bucket`);
        
//         const outputTextPath = `extracted-text/${file_id}.txt`;
//         const outputTextFile = fileOutputBucket.file(outputTextPath);
        
//         await outputTextFile.save(plainText, {
//           resumable: false,
//           metadata: {
//             contentType: 'text/plain',
//             cacheControl: 'public, max-age=31536000',
//           },
//         });
        
//         const outputTextUri = `gs://${fileOutputBucket.name}/${outputTextPath}`;
//         console.log(`[Save Extracted Text] ✅ Saved to: ${outputTextUri}`);
        
//         try {
//           await File.updateFileOutputPath(file_id, outputTextUri);
//           console.log(`[Save Extracted Text] ✅ Updated database with output path`);
//         } catch (dbError) {
//           console.warn(`[Save Extracted Text] ⚠️ Failed to update database (non-critical):`, dbError.message);
//         }
//       } else {
//         console.warn(`[Save Extracted Text] ⚠️ No plain text to save (empty extraction)`);
//       }
//     } catch (saveError) {
//       console.error(`[Save Extracted Text] ❌ Failed to save extracted text (non-critical):`, saveError.message);
//     }

//     await updateProgress(file_id, "processing", 45.5, "Loading chunking configuration");

//     let chunkingMethod = "recursive";
//     try {
//       const chunkMethodQuery = `
//         SELECT cm.method_name
//         FROM processing_jobs pj
//         LEFT JOIN secret_manager sm ON pj.secret_id = sm.id
//         LEFT JOIN chunking_methods cm ON sm.chunking_method_id = cm.id
//         WHERE pj.file_id = $1
//         ORDER BY pj.created_at DESC
//         LIMIT 1;
//       `;
//       const result = await pool.query(chunkMethodQuery, [file_id]);
//       if (result.rows.length > 0 && result.rows[0].method_name) {
//         chunkingMethod = result.rows[0].method_name;
//       }
//     } catch (err) {
//       console.warn(`[Config] Using default chunking method`);
//     }

//     console.log(`[Config] Chunking method: ${chunkingMethod}`);
//     await smoothProgressIncrement(file_id, "processing", 46, 48, `Configuration loaded: ${chunkingMethod}`, 100);

//     await updateProgress(file_id, "processing", 49, `Starting ${chunkingMethod} chunking`);
//     await smoothProgressIncrement(file_id, "processing", 50, 54, "Chunking document", 100);

//     const textsWithPages = extractedBatchTexts.filter(t => t.page_start !== null && t.page_start !== undefined);
//     const textsWithoutPages = extractedBatchTexts.length - textsWithPages.length;
//     if (textsWithPages.length > 0) {
//       const minPage = Math.min(...textsWithPages.map(t => t.page_start));
//       const maxPage = Math.max(...textsWithPages.map(t => t.page_end || t.page_start));
//       console.log(`[Chunking] ✅ ${textsWithPages.length} text segments have page numbers (page range: ${minPage} - ${maxPage})`);
//     }
//     if (textsWithoutPages > 0) {
//       console.warn(`[Chunking] ⚠️ ${textsWithoutPages} text segments missing page numbers`);
//     }

//     const chunks = await chunkDocument(extractedBatchTexts, file_id, chunkingMethod);
//     console.log(`[Chunking] ✅ Generated ${chunks.length} chunks`);

//     const chunksWithPageInfo = chunks.filter(c => 
//       (c.metadata?.page_start !== null && c.metadata?.page_start !== undefined) ||
//       (c.page_start !== null && c.page_start !== undefined)
//     );
//     if (chunksWithPageInfo.length > 0) {
//       console.log(`[Chunking] ✅ ${chunksWithPageInfo.length} chunks have page information in metadata`);
//     } else {
//       console.warn(`[Chunking] ⚠️ WARNING: No chunks have page information! This will cause citations to fail.`);
//     }

//     await smoothProgressIncrement(file_id, "processing", 55, 58, `Created ${chunks.length} chunks`, 100);

//     if (chunks.length === 0) {
//       console.warn(`[Warning] ⚠️ No chunks generated for file ${file_id}`);
//       await updateProgress(file_id, "processed", 100, "Completed (no content)");
//       await ProcessingJob.updateJobStatus(job.job_id, "completed");
//       return;
//     }

//     await updateProgress(file_id, "processing", 59, "Preparing embedding queue payload");
//     const chunkContents = chunks.map(c => c.content);
//     console.log(`[Embeddings] 🔄 Queueing ${chunkContents.length} chunks for background embedding`);
//     await smoothProgressIncrement(file_id, "processing", 60, 66, "Collecting chunk metadata", 100);

//     await updateProgress(file_id, "processing", 67, "Preparing database storage");

//     const chunksToSave = chunks.map((chunk, i) => {
//       const page_start = chunk.metadata?.page_start !== null && chunk.metadata?.page_start !== undefined
//         ? chunk.metadata.page_start
//         : (chunk.page_start !== null && chunk.page_start !== undefined ? chunk.page_start : null);
//       const page_end = chunk.metadata?.page_end !== null && chunk.metadata?.page_end !== undefined
//         ? chunk.metadata.page_end
//         : (chunk.page_end !== null && chunk.page_end !== undefined ? chunk.page_end : null);
      
//       if (i < 3) {
//         console.log(`[Save Chunks] Chunk ${i}: page_start=${page_start}, page_end=${page_end}, has metadata=${!!chunk.metadata}`);
//       }
      
//       return {
//         file_id: file_id,
//         chunk_index: i,
//         content: chunk.content,
//         token_count: chunk.token_count,
//         page_start: page_start,
//         page_end: page_end || page_start, // Use page_start if page_end is null
//         heading: chunk.metadata?.heading || chunk.heading || null,
//       };
//     });

//     await smoothProgressIncrement(file_id, "processing", 68, 72, "Saving chunks to database", 100);

//     const savedChunks = await FileChunk.saveMultipleChunks(chunksToSave);
//     console.log(`[Database] ✅ Saved ${savedChunks.length} chunks`);

//     await smoothProgressIncrement(file_id, "processing", 73, 78, `${savedChunks.length} chunks saved`, 100);

//     const embeddingQueuePayload = savedChunks.map((savedChunk) => {
//       const source = chunks[savedChunk.chunk_index];
//       return {
//         chunkId: savedChunk.id,
//         chunkIndex: savedChunk.chunk_index,
//         content: source.content,
//         tokenCount: source.token_count,
//       };
//     });

//     await enqueueEmbeddingJob({
//       fileId: file_id,
//       jobId: job.job_id,
//       chunks: embeddingQueuePayload,
//       progressBase: 78,
//     });

//     await updateProgress(file_id, "embedding_pending", 78, "Embeddings queued for background worker");

//     await updateProgress(file_id, "embedding_pending", 79, "Preparing summary generation");

//     const fullText = chunks.map(c => c.content).join("\n\n");
//     let summary = null;

//     try {
//       if (fullText.length > 0) {
//         await smoothProgressIncrement(file_id, "embedding_pending", 80, 86, "Generating AI summary", 150);

//         summary = await getSummaryFromChunks(chunks.map(c => c.content));
//         await File.updateSummary(file_id, summary);

//         console.log(`[Summary] ✅ Generated and saved`);
//         await updateProgress(file_id, "embedding_pending", 88, "Summary saved");
//       } else {
//         await updateProgress(file_id, "embedding_pending", 88, "Summary skipped (empty content)");
//       }
//     } catch (summaryError) {
//       console.warn(`⚠️ [Warning] Summary generation failed:`, summaryError.message);
//       await updateProgress(file_id, "embedding_pending", 88, "Summary skipped (error)");
//     }

//     await updateProgress(file_id, "embedding_pending", 89, "Waiting for background embeddings to complete");
//     console.log(`[Embeddings] Background task enqueued for file ${file_id}`);

//   } catch (error) {
//     console.error(`\n❌ [ERROR] Post-processing failed for ${file_id}:`, error.message);
//     console.error(error.stack);

//     try {
//       await updateProgress(file_id, "error", 0, `Failed: ${error.message}`);
//       await ProcessingJob.updateJobStatus(job.job_id, "failed", error.message);
//     } catch (err) {
//       console.error(`❌ Failed to update error status:`, err);
//     }
//   }
// }



// //     if (!file_id) {


// //     if (!file) {

// //     if (String(file.user_id) !== String(req.user.id)) {












// exports.createFolder = async (req, res) => {
//   try {
//     const { folderName, parentPath = '' } = req.body; // allow parent folder
//     const userId = req.user.id;

//     if (!folderName) {
//       return res.status(400).json({ error: "Folder name is required" });
//     }

//     const cleanParentPath = parentPath ? parentPath.replace(/^\/+|\/+$/g, '') : '';
//     const safeFolderName = sanitizeName(folderName.replace(/^\/+|\/+$/g, ''));

//     const folderPath = cleanParentPath
//       ? `${cleanParentPath}/${safeFolderName}`
//       : safeFolderName;

//     const gcsPath = `${userId}/documents/${folderPath}/`;

//     await uploadToGCS(".keep", Buffer.from(""), gcsPath, false, "text/plain");

//     const folder = await File.create({
//       user_id: userId,
//       originalname: safeFolderName,
//       gcs_path: gcsPath,
//       folder_path: cleanParentPath || null,
//       mimetype: 'folder/x-directory',
//       is_folder: true,
//       status: "processed",
//       processing_progress: 100,
//       size: 0,
//     });

//     return res.status(201).json({ message: "Folder created", folder });
//   } catch (error) {
//     console.error("❌ createFolder error:", error);
//     res.status(500).json({ error: "Internal server error", details: error.message });
//   }
// };





// async function createFolderInternal(userId, folderName, parentPath = "") {
//   try {
//     if (!folderName) {
//       throw new Error("Folder name is required");
//     }

//     const safeFolderName = sanitizeName(folderName.replace(/^\/+|\/+$/g, ""));

//     const folderPath = parentPath ? `${parentPath}/${safeFolderName}` : safeFolderName;

//     const gcsPath = `${userId}/documents/${folderPath}/`;

//     await uploadToGCS(".keep", Buffer.from(""), gcsPath, false, "text/plain");

//     const folder = await File.create({
//       user_id: userId,
//       originalname: safeFolderName,
//       gcs_path: gcsPath,
//       folder_path: folderPath, // This is what files will reference
//       mimetype: "folder/x-directory",
//       is_folder: true,
//       status: "processed",
//       processing_progress: 100,
//       size: 0,
//     });

//     return folder;
//   } catch (error) {
//     console.error("❌ createFolderInternal error:", error);
//     throw new Error("Failed to create folder: " + error.message);
//   }
// }

// exports.createCase = async (req, res) => {
//   const client = await pool.connect();

//   try {
//     const userId = parseInt(req.user?.id);
//     if (!userId) {
//       return res.status(401).json({ error: "Unauthorized user" });
//     }

//     const {
//       case_title,
//       case_number,
//       filing_date,
//       case_type,
//       sub_type,
//       court_name,
//       court_level,
//       bench_division,
//       jurisdiction,
//       // state,  // REMOVED
//       judges,
//       court_room_no,
//       petitioners,
//       respondents,
//       category_type,
//       primary_category,
//       sub_category,
//       complexity,
//       monetary_value,
//       priority_level,
//       status = "Active",
//       case_prefix,
//       case_year,
//       case_nature,
//       next_hearing_date,
//       document_type,
//       filed_by,
//     } = req.body;

//     if (!case_title || !case_type || !court_name) {
//       return res.status(400).json({
//         error: "Missing required fields: case_title, case_type, court_name",
//       });
//     }

//     await client.query("BEGIN");

//     const userIdInt = parseInt(userId, 10);
//     if (isNaN(userIdInt)) {
//       throw new Error(`Invalid user_id: ${userId}`);
//     }

//     const insertQuery = `
//       INSERT INTO cases (
//         user_id, case_title, case_number, filing_date, case_type, sub_type,
//         court_name, court_level, bench_division, jurisdiction, judges,
//         court_room_no, petitioners, respondents, category_type, primary_category,
//         sub_category, complexity, monetary_value, priority_level, status,
//         case_prefix, case_year, case_nature, next_hearing_date, document_type,
//         filed_by
//       )
//       VALUES (
//         $1::integer, $2, $3, $4, $5, $6,
//         $7, $8, $9, $10, $11,
//         $12, $13, $14, $15, $16,
//         $17, $18, $19, $20, $21,
//         $22, $23, $24, $25, $26,
//         $27
//       )
//       RETURNING *;
//     `;

//     const values = [
//       userIdInt,
//       case_title,
//       case_number,
//       filing_date,
//       case_type,
//       sub_type,
//       court_name,
//       court_level,
//       bench_division,
//       jurisdiction,
//       judges ? JSON.stringify(judges) : null,
//       court_room_no,
//       petitioners ? JSON.stringify(petitioners) : null,
//       respondents ? JSON.stringify(respondents) : null,
//       category_type,
//       primary_category,
//       sub_category,
//       complexity,
//       monetary_value,
//       priority_level,
//       status,
//       case_prefix,
//       case_year ? parseInt(case_year) : null,
//       case_nature,
//       next_hearing_date,
//       document_type,
//       filed_by,
//     ];

//     const { rows: caseRows } = await client.query(insertQuery, values);
//     const newCase = caseRows[0];

//     const safeCaseName = sanitizeName(case_title);
//     const parentPath = `${userId}/cases`;
//     const folder = await createFolderInternal(userId, safeCaseName, parentPath);

//     const updateQuery = `
//       UPDATE cases
//       SET folder_id = $1
//       WHERE id = $2
//       RETURNING *;
//     `;
//     const { rows: updatedRows } = await client.query(updateQuery, [
//       folder.id,
//       newCase.id,
//     ]);
//     const updatedCase = updatedRows[0];

//     await client.query("COMMIT");

//     return res.status(201).json({
//       message: "Case created successfully with folder",
//       case: updatedCase,
//       folder,
//     });

//   } catch (error) {
//     await client.query("ROLLBACK");
//     console.error("❌ Error creating case:", error);
//     res.status(500).json({
//       error: "Internal server error",
//       details: error.message,
//     });
//   } finally {
//     client.release();
//   }
// };

// // exports.createCase = async (req, res) => {
// //   const client = await pool.connect();

// //   try {
// //     const userId = parseInt(req.user?.id);
// //     if (!userId) {
// //       return res.status(401).json({ error: "Unauthorized user" });
// //     }

// //     const {
// //       case_title,
// //       case_number,
// //       filing_date,
// //       case_type,
// //       sub_type,
// //       court_name,
// //       court_level,
// //       bench_division,
// //       jurisdiction,
// //       state,
// //       judges,
// //       court_room_no,
// //       petitioners,
// //       respondents,
// //       category_type,
// //       primary_category,
// //       sub_category,
// //       complexity,
// //       monetary_value,
// //       priority_level,
// //       status = "Active",
// //     } = req.body;

// //     if (!case_title || !case_type || !court_name) {
// //       return res.status(400).json({
// //         error: "Missing required fields: case_title, case_type, court_name",
// //       });
// //     }

// //     await client.query("BEGIN");

// //     // Ensure userId is an integer
// //     const userIdInt = parseInt(userId, 10);
// //     if (isNaN(userIdInt)) {
// //       throw new Error(`Invalid user_id: ${userId}`);
// //     }

// //     // const insertQuery = `
// //     //   INSERT INTO cases (
// //     //     id, user_id, case_title, case_number, filing_date, case_type, sub_type,
// //     //     court_name, court_level, bench_division, jurisdiction, state, judges,
// //     //     court_room_no, petitioners, respondents, category_type, primary_category,
// //     //     sub_category, complexity, monetary_value, priority_level, status
// //     //   )
// //     //   VALUES (
// //     //     gen_random_uuid(), $1::integer, $2, $3, $4, $5, $6,
// //     //     $7, $8, $9, $10, $11, $12,
// //     //     $13, $14, $15, $16, $17,
// //     //     $18, $19, $20, $21, $22
// //     //   )
// //     //   RETURNING *;
// //     // `;

// //     // const values = [
// //     //   userIdInt,
// //     //   case_title,
// //     //   case_number,
// //     //   filing_date,
// //     //   case_type,
// //     //   sub_type,
// //     //   court_name,
// //     //   court_level,
// //     //   bench_division,
// //     //   jurisdiction,
// //     //   state,
// //     //   judges ? JSON.stringify(judges) : null,
// //     //   court_room_no,
// //     //   petitioners ? JSON.stringify(petitioners) : null,
// //     //   respondents ? JSON.stringify(respondents) : null,
// //     //   category_type,
// //     //   primary_category,
// //     //   sub_category,
// //     //   complexity,
// //     //   monetary_value,
// //     //   priority_level,
// //     //   status,
// //     // ];

// //     const insertQuery = `
// //     INSERT INTO cases (
// //       user_id, case_title, case_number, filing_date, case_type, sub_type,
// //       court_name, court_level, bench_division, jurisdiction, state, judges,
// //       court_room_no, petitioners, respondents, category_type, primary_category,
// //       sub_category, complexity, monetary_value, priority_level, status
// //     )
// //     VALUES (
// //       $1::integer, $2, $3, $4, $5, $6,
// //       $7, $8, $9, $10, $11, $12,
// //       $13, $14, $15, $16, $17,
// //       $18, $19, $20, $21, $22
// //     )
// //     RETURNING *;
// //   `;

  
// //   const values = [
// //     userIdInt,
// //     case_title,
// //     case_number,
// //     filing_date,
// //     case_type,
// //     sub_type,
// //     court_name,
// //     court_level,
// //     bench_division,
// //     jurisdiction,
// //     state,
// //     judges ? JSON.stringify(judges) : null,
// //     court_room_no,
// //     petitioners ? JSON.stringify(petitioners) : null,
// //     respondents ? JSON.stringify(respondents) : null,
// //     category_type,
// //     primary_category,
// //     sub_category,
// //     complexity,
// //     monetary_value,
// //     priority_level,
// //     status,
// //   ];

// //     const { rows: caseRows } = await client.query(insertQuery, values);
// //     const newCase = caseRows[0];

// //     const safeCaseName = sanitizeName(case_title);
// //     const parentPath = `${userId}/cases`;
// //     const folder = await createFolderInternal(userId, safeCaseName, parentPath);

// //     const updateQuery = `
// //       UPDATE cases
// //       SET folder_id = $1
// //       WHERE id = $2
// //       RETURNING *;
// //     `;
// //     const { rows: updatedRows } = await client.query(updateQuery, [
// //       folder.id,
// //       newCase.id,
// //     ]);
// //     const updatedCase = updatedRows[0];

// //     await client.query("COMMIT");

// //     return res.status(201).json({
// //       message: "Case created successfully with folder",
// //       case: updatedCase,
// //       folder,
// //     });

// //   } catch (error) {
// //     await client.query("ROLLBACK");
// //     console.error("❌ Error creating case:", error);
// //     res.status(500).json({
// //       error: "Internal server error",
// //       details: error.message,
// //     });
// //   } finally {
// //     client.release();
// //   }
// // };

// exports.deleteCase = async (req, res) => {
//   const client = await pool.connect();
//   try {
//     const userId = parseInt(req.user?.id);
//     if (!userId) {
//       return res.status(401).json({ error: "Unauthorized user" });
//     }

//     const { caseId } = req.params;
//     if (!caseId) {
//       return res.status(400).json({ error: "Case ID is required." });
//     }

//     await client.query("BEGIN");

//     const getCaseQuery = `SELECT folder_id FROM cases WHERE id = $1 AND user_id = $2;`;
//     const { rows: caseRows } = await client.query(getCaseQuery, [caseId, userId]);

//     if (caseRows.length === 0) {
//       await client.query("ROLLBACK");
//       return res.status(404).json({ error: "Case not found or not authorized." });
//     }

//     const folderId = caseRows[0].folder_id;

//     const deleteCaseQuery = `DELETE FROM cases WHERE id = $1 AND user_id = $2 RETURNING *;`;
//     const { rows: deletedCaseRows } = await client.query(deleteCaseQuery, [caseId, userId]);

//     if (deletedCaseRows.length === 0) {
//       await client.query("ROLLBACK");
//       return res.status(404).json({ error: "Case not found or not authorized." });
//     }

//     if (folderId) {
//       const getFolderQuery = `SELECT gcs_path FROM user_files WHERE id = $1::uuid AND user_id = $2 AND is_folder = TRUE;`;
//       const { rows: folderRows } = await client.query(getFolderQuery, [folderId, userId]);

//       if (folderRows.length > 0) {
//         const gcsPath = folderRows[0].gcs_path;
//         await bucket.deleteFiles({
//           prefix: gcsPath,
//         });
//         console.log(`🗑️ Deleted GCS objects with prefix: ${gcsPath}`);
//       }

//       const deleteFolderQuery = `DELETE FROM user_files WHERE id = $1::uuid AND user_id = $2;`;
//       await client.query(deleteFolderQuery, [folderId, userId]);
//       console.log(`🗑️ Deleted folder record with ID: ${folderId}`);
//     }

//     await client.query("COMMIT");

//     return res.status(200).json({
//       message: "Case and associated folder deleted successfully.",
//       deletedCase: deletedCaseRows[0],
//     });
//   } catch (error) {
//     await client.query("ROLLBACK");
//     console.error("❌ Error deleting case:", error);
//     res.status(500).json({
//       error: "Internal server error",
//       details: error.message,
//     });
//   } finally {
//     client.release();
//   }
// };

// exports.updateCase = async (req, res) => {
//   const client = await pool.connect();
//   try {
//     const userId = parseInt(req.user?.id);
//     if (!userId) {
//       return res.status(401).json({ error: "Unauthorized user" });
//     }

//     const { caseId } = req.params;
//     if (!caseId) {
//       return res.status(400).json({ error: "Case ID is required." });
//     }

//     const {
//       case_title,
//       case_number,
//       filing_date,
//       case_type,
//       sub_type,
//       court_name,
//       court_level,
//       bench_division,
//       jurisdiction,
//       state,
//       judges,
//       court_room_no,
//       petitioners,
//       respondents,
//       category_type,
//       primary_category,
//       sub_category,
//       complexity,
//       monetary_value,
//       priority_level,
//       status, // Allow updating status (e.g., 'Active', 'Inactive', 'Closed')
//     } = req.body;

//     const updates = {};
//     if (case_title !== undefined) updates.case_title = case_title;
//     if (case_number !== undefined) updates.case_number = case_number;
//     if (filing_date !== undefined) updates.filing_date = filing_date;
//     if (case_type !== undefined) updates.case_type = case_type;
//     if (sub_type !== undefined) updates.sub_type = sub_type;
//     if (court_name !== undefined) updates.court_name = court_name;
//     if (court_level !== undefined) updates.court_level = court_level;
//     if (bench_division !== undefined) updates.bench_division = bench_division;
//     if (jurisdiction !== undefined) updates.jurisdiction = jurisdiction;
//     if (state !== undefined) updates.state = state;
//     if (judges !== undefined) updates.judges = judges ? JSON.stringify(judges) : null;
//     if (court_room_no !== undefined) updates.court_room_no = court_room_no;
//     if (petitioners !== undefined) updates.petitioners = petitioners ? JSON.stringify(petitioners) : null;
//     if (respondents !== undefined) updates.respondents = respondents ? JSON.stringify(respondents) : null;
//     if (category_type !== undefined) updates.category_type = category_type;
//     if (primary_category !== undefined) updates.primary_category = primary_category;
//     if (sub_category !== undefined) updates.sub_category = sub_category;
//     if (complexity !== undefined) updates.complexity = complexity;
//     if (monetary_value !== undefined) updates.monetary_value = monetary_value;
//     if (priority_level !== undefined) updates.priority_level = priority_level;
//     if (status !== undefined) updates.status = status; // Update case status

//     if (Object.keys(updates).length === 0) {
//       return res.status(400).json({ error: "No update fields provided." });
//     }

//     const fields = Object.keys(updates).map((key, index) => `${key} = $${index + 3}`).join(', ');
//     const values = Object.values(updates);

//     const updateQuery = `
//       UPDATE cases
//       SET ${fields}, updated_at = NOW()
//       WHERE id = $1 AND user_id = $2
//       RETURNING *;
//     `;

//     const { rows: updatedCaseRows } = await client.query(updateQuery, [caseId, userId, ...values]);

//     if (updatedCaseRows.length === 0) {
//       return res.status(404).json({ error: "Case not found or not authorized." });
//     }

//     await client.query("COMMIT");

//     return res.status(200).json({
//       message: "Case updated successfully.",
//       case: updatedCaseRows[0],
//     });
//   } catch (error) {
//     await client.query("ROLLBACK");
//     console.error("❌ Error updating case:", error);
//     res.status(500).json({
//       error: "Internal server error",
//       details: error.message,
//     });
//   } finally {
//     client.release();
//   }
// };



// exports.getCase = async (req, res) => {
//   try {
//     const userId = req.user?.id;
//     const { caseId } = req.params;

//     if (!userId) return res.status(401).json({ error: "Unauthorized user" });
//     if (!caseId) return res.status(400).json({ error: "Case ID is required." });

//     const caseQuery = `
//       SELECT * FROM cases
//       WHERE id = $1 AND user_id = $2;
//     `;
//     const { rows: caseRows } = await pool.query(caseQuery, [caseId, userId]);
//     if (caseRows.length === 0) {
//       return res.status(404).json({ error: "Case not found or not authorized." });
//     }

//     const caseData = caseRows[0];

//     const folderQuery = `
//       SELECT *
//       FROM user_files
//       WHERE user_id = $1
//         AND is_folder = true
//         AND folder_path LIKE $2
//       ORDER BY created_at ASC
//       LIMIT 1;
//     `;
//     const folderPathPattern = `%${caseData.case_title}%`;
//     const { rows: folderRows } = await pool.query(folderQuery, [userId, folderPathPattern]);

//     const folders = folderRows.map(folder => ({
//       id: folder.id,
//       name: folder.originalname,
//       folder_path: folder.folder_path,
//       created_at: folder.created_at,
//       updated_at: folder.updated_at,
//       children: [], // Files will be fetched when user opens this folder
//     }));

//     caseData.folders = folders;

//     return res.status(200).json({
//       message: "Case fetched successfully.",
//       case: caseData,
//     });

//   } catch (error) {
//     console.error("❌ Error fetching case:", error);
//     res.status(500).json({ message: "Internal server error", details: error.message });
//   }
// };


// exports.getFolders = async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const files = await File.findByUserId(userId);

//     const folders = files
//       .filter(file => file.is_folder)
//       .map(folder => ({
//         id: folder.id,
//         name: folder.originalname,
//         folder_path: folder.folder_path,
//         created_at: folder.created_at,
//       }));

//     const actualFiles = files.filter(file => !file.is_folder);

//     const signedFiles = await Promise.all(
//       actualFiles.map(async (file) => {
//         let signedUrl = null;
//         try {
//           signedUrl = await getSignedUrl(file.gcs_path);
//         } catch (err) {
//           console.error('Error generating signed URL:', err);
//         }
//         return {
//           id: file.id,
//           name: file.originalname,
//           size: file.size,
//           mimetype: file.mimetype,
//           created_at: file.created_at,
//           folder_path: file.folder_path,
//           url: signedUrl,
//         };
//       })
//     );

//     const folderMap = {};
//     folders.forEach(folder => {
//       folder.children = [];
//       folderMap[folder.folder_path ? folder.folder_path + '/' + folder.name : folder.name] = folder;
//     });

//     signedFiles.forEach(file => {
//       const parentFolderKey = file.folder_path || '';
//       if (folderMap[parentFolderKey]) {
//         folderMap[parentFolderKey].children.push(file);
//       }
//     });

//     return res.status(200).json({ folders });
//   } catch (error) {
//     console.error('Error fetching user files and folders:', error);
//     return res.status(500).json({ message: 'Internal server error' });
//   }
// };



// exports.generateUploadUrl = async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const { folderName } = req.params;
//     const { filename, mimetype, size } = req.body;

//     if (!filename) {
//       return res.status(400).json({ error: "Filename is required" });
//     }

//     if (!size) {
//       return res.status(400).json({ 
//         error: "File size is required. Please provide the file size in bytes." 
//       });
//     }

//     const authorizationHeader = req.headers.authorization;
//     const { plan: userPlan } = await TokenUsageService.getUserUsageAndPlan(userId, authorizationHeader);
    
//     const fileSizeBytes = typeof size === 'string' ? parseInt(size, 10) : Number(size);
    
//     if (isNaN(fileSizeBytes) || fileSizeBytes <= 0) {
//       return res.status(400).json({ 
//         error: "Invalid file size. Please provide a valid file size in bytes." 
//       });
//     }
    
//     const fileSizeCheck = TokenUsageService.checkFreeTierFileSize(fileSizeBytes, userPlan);
//     if (!fileSizeCheck.allowed) {
//       console.log(`\n${'🆓'.repeat(40)}`);
//       console.log(`[FREE TIER] Upload URL generation REJECTED - size limit exceeded`);
//       console.log(`[FREE TIER] File: ${filename}`);
//       console.log(`[FREE TIER] File size: ${(fileSizeBytes / (1024 * 1024)).toFixed(2)} MB`);
//       console.log(`[FREE TIER] Max allowed: ${fileSizeCheck.maxSizeMB || 10} MB`);
//       console.log(`[FREE TIER] ❌ Signed URL NOT generated - upload prevented`);
//       console.log(`${'🆓'.repeat(40)}\n`);
      
//       return res.status(403).json({ 
//         error: fileSizeCheck.message,
//         shortMessage: fileSizeCheck.shortMessage || fileSizeCheck.message,
//         fileSizeMB: fileSizeCheck.fileSizeMB,
//         fileSizeGB: fileSizeCheck.fileSizeGB,
//         maxSizeMB: fileSizeCheck.maxSizeMB,
//         upgradeRequired: true,
//         planType: 'free',
//         limit: `${fileSizeCheck.maxSizeMB} MB`
//       });
//     }
    
//     console.log(`✅ [generateUploadUrl] File size check passed: ${(fileSizeBytes / (1024 * 1024)).toFixed(2)} MB`);

//     const folderQuery = `
//       SELECT * FROM user_files
//       WHERE user_id = $1
//         AND is_folder = true
//         AND originalname = $2
//       ORDER BY created_at DESC
//       LIMIT 1
//     `;
//     const { rows: folderRows } = await pool.query(folderQuery, [userId, folderName]);

//     if (folderRows.length === 0) {
//       return res.status(404).json({
//         error: `Folder "${folderName}" not found for this user.`,
//       });
//     }

//     const folderRow = folderRows[0];
//     const ext = path.extname(filename);
//     const baseName = path.basename(filename, ext);
//     const safeName = sanitizeName(baseName) + ext;
//     const key = `${folderRow.gcs_path}${safeName}`;
//     const uniqueKey = await ensureUniqueKey(key);

//     const signedUrl = await getSignedUploadUrl(
//       uniqueKey,
//       mimetype || 'application/octet-stream',
//       15,
//       false // Use default bucket, not input bucket
//     );

//     return res.status(200).json({
//       signedUrl,
//       gcsPath: uniqueKey,
//       filename: safeName,
//       folderPath: folderRow.folder_path,
//     });
//   } catch (error) {
//     console.error("❌ generateUploadUrl error:", error);
//     res.status(500).json({
//       error: "Failed to generate upload URL",
//       details: error.message
//     });
//   }
// };

// exports.completeSignedUpload = async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const { folderName } = req.params;
//     const { gcsPath, filename, mimetype, size, secret_id } = req.body;

//     if (!gcsPath || !filename || !size) {
//       return res.status(400).json({ error: "gcsPath, filename, and size are required" });
//     }

//     const folderQuery = `
//       SELECT * FROM user_files
//       WHERE user_id = $1
//         AND is_folder = true
//         AND originalname = $2
//       ORDER BY created_at DESC
//       LIMIT 1
//     `;
//     const { rows: folderRows } = await pool.query(folderQuery, [userId, folderName]);

//     if (folderRows.length === 0) {
//       return res.status(404).json({
//         error: `Folder "${folderName}" not found for this user.`,
//       });
//     }

//     const folderRow = folderRows[0];

//     const fileRef = bucket.file(gcsPath);
//     const [exists] = await fileRef.exists();
//     if (!exists) {
//       return res.status(404).json({ error: "File not found in storage. Upload may have failed." });
//     }

//     const authorizationHeader = req.headers.authorization;
//     const { usage: userUsage, plan: userPlan } = await TokenUsageService.getUserUsageAndPlan(userId, authorizationHeader);
    
//     const [metadata] = await fileRef.getMetadata();
//     const actualFileSize = parseInt(metadata.size) || parseInt(size);
    
//     const fileSizeBytes = typeof actualFileSize === 'string' ? parseInt(actualFileSize, 10) : Number(actualFileSize);
    
//     if (isNaN(fileSizeBytes) || fileSizeBytes <= 0) {
//       await fileRef.delete().catch(err => console.error("Failed to delete file:", err));
//       return res.status(400).json({ 
//         error: "Invalid file size. Unable to determine file size." 
//       });
//     }
    
//     const fileSizeCheck = TokenUsageService.checkFreeTierFileSize(fileSizeBytes, userPlan);
//     if (!fileSizeCheck.allowed) {
//       console.log(`\n${'🆓'.repeat(40)}`);
//       console.log(`[FREE TIER] File upload REJECTED - actual file size exceeds limit`);
//       console.log(`[FREE TIER] File: ${filename}`);
//       console.log(`[FREE TIER] Actual file size from GCS: ${(fileSizeBytes / (1024 * 1024)).toFixed(2)} MB`);
//       console.log(`[FREE TIER] Max allowed: ${fileSizeCheck.maxSizeMB || 10} MB`);
//       console.log(`[FREE TIER] 🗑️ Deleting file from GCS...`);
//       console.log(`${'🆓'.repeat(40)}\n`);
      
//       await fileRef.delete().catch(err => {
//         console.error(`❌ Failed to delete oversized file from GCS:`, err.message);
//       });
      
//       return res.status(403).json({ 
//         error: fileSizeCheck.message,
//         shortMessage: fileSizeCheck.shortMessage || fileSizeCheck.message,
//         fileSizeMB: fileSizeCheck.fileSizeMB,
//         fileSizeGB: fileSizeCheck.fileSizeGB,
//         maxSizeMB: fileSizeCheck.maxSizeMB,
//         upgradeRequired: true,
//         planType: 'free',
//         limit: `${fileSizeCheck.maxSizeMB} MB`,
//         actualFileSizeMB: (fileSizeBytes / (1024 * 1024)).toFixed(2)
//       });
//     }
    
//     const storageLimitCheck = await checkStorageLimit(userId, fileSizeBytes, userPlan);
//     if (!storageLimitCheck.allowed) {
//       await fileRef.delete().catch(err => console.error("Failed to delete file:", err));
//       return res.status(403).json({ error: storageLimitCheck.message });
//     }

//     const { DOCUMENT_UPLOAD_COST_TOKENS } = require("../middleware/checkTokenLimits");
//     const requestedResources = {
//       tokens: DOCUMENT_UPLOAD_COST_TOKENS,
//       documents: 1,
//       ai_analysis: 1,
//       storage_gb: fileSizeBytes / (1024 ** 3),
//     };

//     const limitCheck = await TokenUsageService.enforceLimits(
//       userId,
//       userUsage,
//       userPlan,
//       requestedResources
//     );

//     if (!limitCheck.allowed) {
//       await fileRef.delete().catch(err => console.error("Failed to delete file:", err));
//       return res.status(403).json({
//         success: false,
//         message: limitCheck.message,
//         nextRenewalTime: limitCheck.nextRenewalTime,
//         remainingTime: limitCheck.remainingTime,
//       });
//     }

//     let savedFile;
//     try {
//       console.log(`💾 [completeSignedUpload] Saving file metadata to database...`);
//       savedFile = await File.create({
//         user_id: userId,
//         originalname: filename,
//         gcs_path: gcsPath,
//         folder_path: folderRow.folder_path,
//         mimetype: mimetype || 'application/octet-stream',
//         size: fileSizeBytes, // Use actual size from GCS metadata
//         is_folder: false,
//         status: "queued",
//         processing_progress: 0,
//       });
//       console.log(`✅ [completeSignedUpload] File saved to database with ID: ${savedFile.id}`);
//     } catch (dbError) {
//       console.error(`❌ [completeSignedUpload] Failed to save file to database:`, dbError);
//       await fileRef.delete().catch(err => console.error("Failed to delete file after DB error:", err));
//       return res.status(500).json({ 
//         error: "Failed to save file metadata to database",
//         details: dbError.message 
//       });
//     }

//     try {
//       await TokenUsageService.incrementUsage(userId, requestedResources, userPlan);
//       console.log(`✅ [completeSignedUpload] Usage incremented successfully`);
//     } catch (usageError) {
//       console.error(`⚠️ [completeSignedUpload] Failed to increment usage (non-critical):`, usageError.message);
//     }

//     const [fileBuffer] = await fileRef.download();

//     processDocumentWithAI(
//       savedFile.id,
//       fileBuffer,
//       mimetype || 'application/octet-stream',
//       userId,
//       filename,
//       secret_id
//     ).catch(err =>
//       console.error(`❌ Background processing failed for ${savedFile.id}:`, err.message)
//     );

//     const previewUrl = await makeSignedReadUrl(gcsPath, 15);

//     return res.status(201).json({
//       message: "File uploaded and processing started.",
//       document: {
//         ...savedFile,
//         previewUrl,
//         status: "uploaded_and_queued",
//       },
//       folderInfo: {
//         folderName: folderRow.originalname,
//         folder_path: folderRow.folder_path,
//         gcs_path: folderRow.gcs_path
//       }
//     });
//   } catch (error) {
//     console.error("❌ completeSignedUpload error:", error);
//     res.status(500).json({
//       error: "Failed to complete upload",
//       details: error.message
//     });
//   }
// };

// exports.uploadDocumentsToCaseByFolderName = async (req, res) => {
//   try {
//     const username = req.user.username;
//     const userId = req.user.id;
//     const { folderName } = req.params;
//     const { secret_id } = req.body;

//     if (!req.files || req.files.length === 0) {
//       return res.status(400).json({ error: "No files uploaded" });
//     }

//     console.log(`📁 Uploading to folder: ${folderName} for user: ${username}`);

//     const folderQuery = `
//       SELECT * FROM user_files
//       WHERE user_id = $1
//         AND is_folder = true
//         AND originalname = $2
//       ORDER BY created_at DESC
//       LIMIT 1
//     `;
//     const { rows: folderRows } = await pool.query(folderQuery, [userId, folderName]);

//     if (folderRows.length === 0) {
//       return res.status(404).json({
//         error: `Folder "${folderName}" not found for this user.`,
//         debug: { userId, folderName }
//       });
//     }

//     const folderRow = folderRows[0];

//     let folderPathForFiles = folderRow.folder_path;

//     console.log(`📁 Found folder. Database folder_path: ${folderPathForFiles}`);
//     console.log(`📁 GCS path: ${folderRow.gcs_path}`);

//     const authorizationHeader = req.headers.authorization;
//     const { plan: userPlan } = await TokenUsageService.getUserUsageAndPlan(userId, authorizationHeader);

//     const uploadedFiles = [];
//     for (const file of req.files) {
//       const fileSizeBytes = typeof file.size === 'string' ? parseInt(file.size, 10) : Number(file.size);
      
//       const fileSizeCheck = TokenUsageService.checkFreeTierFileSize(fileSizeBytes, userPlan);
//       if (!fileSizeCheck.allowed) {
//         console.log(`\n${'🆓'.repeat(40)}`);
//         console.log(`[FREE TIER] File upload rejected - size limit exceeded`);
//         console.log(`[FREE TIER] File: ${file.originalname}`);
//         console.log(`[FREE TIER] File size: ${(fileSizeBytes / (1024 * 1024)).toFixed(2)} MB`);
//         console.log(`[FREE TIER] Max allowed: ${fileSizeCheck.maxSizeMB || 10} MB`);
//         console.log(`${'🆓'.repeat(40)}\n`);
        
//         uploadedFiles.push({
//           originalname: file.originalname,
//           error: fileSizeCheck.message,
//           shortMessage: fileSizeCheck.shortMessage || fileSizeCheck.message,
//           status: "failed",
//           fileSizeMB: fileSizeCheck.fileSizeMB,
//           fileSizeGB: fileSizeCheck.fileSizeGB,
//           maxSizeMB: fileSizeCheck.maxSizeMB,
//           upgradeRequired: true,
//           planType: 'free',
//           limit: `${fileSizeCheck.maxSizeMB} MB`
//         });
//         continue;
//       }
//       try {
//         const ext = path.extname(file.originalname);
//         const baseName = path.basename(file.originalname, ext);
//         const safeName = sanitizeName(baseName) + ext;

//         const key = `${folderRow.gcs_path}${safeName}`;
//         const uniqueKey = await ensureUniqueKey(key);

//         console.log(`📄 Uploading file: ${safeName} to ${uniqueKey}`);

//         const fileRef = bucket.file(uniqueKey);
//         await fileRef.save(file.buffer, {
//           resumable: false,
//           metadata: { contentType: file.mimetype },
//         });

//         console.log(`✅ File uploaded to GCS: ${uniqueKey}`);

//         let savedFile;
//         try {
//           savedFile = await File.create({
//             user_id: userId,
//             originalname: safeName,
//             gcs_path: uniqueKey,
//             folder_path: folderPathForFiles, // Use the folder's folder_path
//             mimetype: file.mimetype,
//             size: file.size,
//             is_folder: false,
//             status: "queued",
//             processing_progress: 0,
//           });
//           console.log(`✅ File saved to DB with ID: ${savedFile.id}, folder_path: ${folderPathForFiles}`);
//         } catch (dbError) {
//           console.error(`❌ Failed to save file to database:`, dbError);
//           await fileRef.delete().catch(err => console.error("Failed to delete file after DB error:", err));
//           throw dbError; // Re-throw to be caught by outer try-catch
//         }

//         const previewUrl = await makeSignedReadUrl(uniqueKey, 15);

//         processDocumentWithAI(
//           savedFile.id,
//           file.buffer,
//           file.mimetype,
//           userId,
//           safeName,
//           secret_id
//         ).catch(err =>
//           console.error(`❌ Background processing failed for ${savedFile.id}:`, err.message)
//         );

//         uploadedFiles.push({
//           ...savedFile,
//           previewUrl,
//           status: "uploaded_and_queued",
//         });
//       } catch (fileError) {
//         console.error(`❌ Error uploading file ${file.originalname}:`, fileError);
//         uploadedFiles.push({
//           originalname: file.originalname,
//           error: fileError.message,
//           status: "failed"
//         });
//       }
//     }

//     return res.status(201).json({
//       message: "Documents uploaded to case folder and processing started.",
//       documents: uploadedFiles,
//       folderInfo: {
//         folderName: folderRow.originalname,
//         folder_path: folderPathForFiles,
//         gcs_path: folderRow.gcs_path
//       }
//     });

//   } catch (error) {
//     console.error("❌ uploadDocumentsToCaseByFolderName error:", error);
//     res.status(500).json({
//       error: "Internal server error",
//       details: error.message
//     });
//   }
// };

// exports.deleteDocument = async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const { fileId } = req.params;

//     const { rows } = await pool.query(
//       `SELECT * FROM user_files WHERE id = $1 AND user_id = $2 AND is_folder = false`,
//       [fileId, userId]
//     );

//     if (rows.length === 0) {
//       return res.status(404).json({
//         error: "File not found or access denied",
//         debug: { fileId, userId },
//       });
//     }

//     const fileRow = rows[0];
//     const gcsPath = fileRow.gcs_path;

//     console.log(`🗑️ Deleting file: ${fileRow.originalname} (${gcsPath})`);

//     const fileRef = bucket.file(gcsPath);
//     const [exists] = await fileRef.exists();

//     if (exists) {
//       await fileRef.delete();
//       console.log(`✅ GCS file deleted: ${gcsPath}`);
//     } else {
//       console.warn(`⚠️ File not found in GCS: ${gcsPath}`);
//     }

//     await pool.query(`DELETE FROM user_files WHERE id = $1`, [fileId]);
//     console.log(`✅ DB record deleted for file ID: ${fileId}`);

//     return res.status(200).json({
//       message: "File deleted successfully",
//       deletedFile: {
//         id: fileId,
//         originalname: fileRow.originalname,
//         folder_path: fileRow.folder_path,
//         gcs_path: gcsPath,
//       },
//     });
//   } catch (error) {
//     console.error("❌ deleteDocument error:", error);
//     return res.status(500).json({
//       error: "Internal server error",
//       details: error.message,
//     });
//   }
// };
// exports.getFolderSummary = async (req, res) => {
//   const userId = req.user.id;
//   const authorizationHeader = req.headers.authorization;

//   try {
//     const { folderName } = req.params;

//     const { usage, plan, timeLeft } = await TokenUsageService.getUserUsageAndPlan(userId, authorizationHeader);

//     const files = await File.findByUserIdAndFolderPath(userId, folderName);
//     console.log(`[getFolderSummary] Found files in folder '${folderName}' for user ${userId}:`, files.map(f => ({ id: f.id, originalname: f.originalname, status: f.status })));

//     const processed = files.filter((f) => !f.is_folder && f.status === "processed");
//     console.log(`[getFolderSummary] Processed documents in folder '${folderName}':`, processed.map(f => ({ id: f.id, originalname: f.originalname })));

//     if (processed.length === 0) {
//       return res.status(404).json({ error: "No processed documents in folder" });
//     }

//     let combinedText = "";
//     let documentDetails = [];

//     for (const f of processed) {
//       const chunks = await FileChunk.getChunksByFileId(f.id);
//       const fileText = chunks.map((c) => c.content).join("\n\n");
//       combinedText += `\n\n[Document: ${f.originalname}]\n${fileText}`;

//       documentDetails.push({
//         name: f.originalname,
//         summary: f.summary || "Summary not available",
//         chunkCount: chunks.length
//       });
//     }

//     const summaryCost = Math.ceil(combinedText.length / 200); // Rough estimate

//     const requestedResources = { tokens: summaryCost, ai_analysis: 1 };
//     const { allowed, message } = await TokenUsageService.enforceLimits(usage, plan, requestedResources);

//     if (!allowed) {
//       return res.status(403).json({
//         error: `Summary generation failed: ${message}`,
//         timeLeftUntilReset: timeLeft
//       });
//     }

//     const summary = await getSummaryFromChunks(combinedText);

//     await TokenUsageService.incrementUsage(userId, requestedResources);

//     const savedChat = await FolderChat.saveFolderChat(
//       userId,
//       folderName,
//       `Summary for folder "${folderName}"`,
//       summary,
//       null,
//       processed.map(f => f.id),
//       [],
//       false,
//       null,
//       null,
//       []
//     );

//     return res.json({
//       folder: folderName,
//       summary,
//       documentCount: processed.length,
//       documents: documentDetails,
//       session_id: savedChat.session_id,
//     });
//   } catch (error) {
//     console.error("❌ getFolderSummary error:", error);
//     res.status(500).json({ error: "Failed to generate folder summary", details: error.message });
//   }
// };




// //     let used_secret_prompt = !!secret_id; // If secret_id is present, it's a secret prompt

// //     if (!folderName) {










// //       if (!secret_id)








// //       if (!secretValue?.trim()) {










// //       if (!question?.trim())






// //       if (!allowed) {








// //     if (!answer?.trim()) {



// //     if (chatCost && !used_secret_prompt) {



// //     let used_secret_prompt = !!secret_id;

// //     if (!folderName) {













// //       if (!secret_id)








// //       if (!secretValue?.trim()) {












// //       if (!question?.trim())





// //       if (!allowed) {










// //     if (!answer?.trim()) {



// //     if (chatCost && !used_secret_prompt) {





// //     let used_secret_prompt = !!secret_id;

// //     if (!folderName) {









// //       if (!chunksByFile[chunk.file_id]) {




// //       if (!secret_id)








// //       if (!secretValue?.trim()) {













// //       if (!question?.trim())





// //       if (!allowed) {











// //     if (!answer?.trim()) {



// //     if (chatCost && !used_secret_prompt) {


// function analyzeQueryIntent(question) {
//   if (!question || typeof question !== 'string') {
//     return {
//       needsFullDocument: false,
//       threshold: 0.75,
//       strategy: 'TARGETED_RAG',
//       reason: 'Invalid query - defaulting to targeted search'
//     };
//   }

//   const queryLower = question.toLowerCase();

//   const fullDocumentKeywords = [
//     'summary', 'summarize', 'overview', 'complete', 'entire', 'all',
//     'comprehensive', 'detailed analysis', 'full details', 'everything',
//     'list all', 'what are all', 'give me all', 'extract all',
//     'analyze', 'review', 'examine', 'timeline', 'chronology',
//     'what is this document', 'what does this document', 'document about',
//     'key points', 'main points', 'important information',
//     'case details', 'petition details', 'contract terms',
//     'parties involved', 'background', 'history'
//   ];

//   const targetedKeywords = [
//     'specific section', 'find where', 'locate', 'search for',
//     'what does it say about', 'mention of', 'reference to',
//     'clause', 'paragraph', 'page', 'section'
//   ];

//   const needsFullDoc = fullDocumentKeywords.some(keyword =>
//     queryLower.includes(keyword)
//   );

//   const isTargeted = targetedKeywords.some(keyword =>
//     queryLower.includes(keyword)
//   );

//   const isShortQuestion = question.trim().split(' ').length <= 5;

//   const isBroadQuestion = /^(what|who|when|where|why|how)\s/i.test(queryLower) &&
//     !isTargeted;

//   return {
//     needsFullDocument: needsFullDoc || (isBroadQuestion && !isTargeted) || isShortQuestion,
//     threshold: needsFullDoc ? 0.0 : (isTargeted ? 0.80 : 0.75),
//     strategy: needsFullDoc ? 'FULL_DOCUMENT' : 'TARGETED_RAG',
//     reason: needsFullDoc ? 'Query requires comprehensive analysis' : 'Query is specific/targeted'
//   };
// }

// function selectRepresentativeChunks(allChunks, files, maxContextChars) {
//   if (!allChunks || allChunks.length === 0) return [];

//   const chunksByFile = {};
//   for (const chunk of allChunks) {
//     const fileId = chunk.file_id || chunk.filename || 'unknown';
//     if (!chunksByFile[fileId]) {
//       chunksByFile[fileId] = [];
//     }
//     chunksByFile[fileId].push(chunk);
//   }

//   const fileCount = Object.keys(chunksByFile).length;
//   const targetCharsPerFile = Math.floor(maxContextChars / fileCount);

//   const selectedChunks = [];
//   let totalChars = 0;

//   for (const fileId in chunksByFile) {
//     const fileChunks = chunksByFile[fileId].sort((a, b) => (a.chunk_index || 0) - (b.chunk_index || 0));
//     const totalFileChars = fileChunks.reduce((sum, c) => sum + ((c.content || '').length || 0), 0);

//     if (totalFileChars <= targetCharsPerFile) {
//       selectedChunks.push(...fileChunks);
//       totalChars += totalFileChars;
//     } else {
//       const targetChunks = Math.max(5, Math.floor((targetCharsPerFile / totalFileChars) * fileChunks.length));

//       if (targetChunks >= fileChunks.length) {
//         selectedChunks.push(...fileChunks);
//         totalChars += totalFileChars;
//       } else {
//         const step = Math.floor(fileChunks.length / targetChunks);
//         const selected = [];

//         selected.push(fileChunks[0]);

//         for (let i = step; i < fileChunks.length - 1; i += step) {
//           if (selected.length < targetChunks - 1) {
//             selected.push(fileChunks[i]);
//           }
//         }

//         if (selected.length < targetChunks && fileChunks.length > 1) {
//           selected.push(fileChunks[fileChunks.length - 1]);
//         }

//         selected.sort((a, b) => (a.chunk_index || 0) - (b.chunk_index || 0));

//         let fileChars = 0;
//         const trimmedSelected = [];
//         for (const chunk of selected) {
//           const chunkLength = (chunk.content || '').length;
//           if (fileChars + chunkLength <= targetCharsPerFile) {
//             trimmedSelected.push(chunk);
//             fileChars += chunkLength;
//           } else {
//             const remaining = targetCharsPerFile - fileChars;
//             if (remaining > 500) {
//               trimmedSelected.push({
//                 ...chunk,
//                 content: (chunk.content || '').substring(0, remaining - 100) + '...[continued in full document]'
//               });
//             }
//             break;
//           }
//         }

//         selectedChunks.push(...trimmedSelected);
//         totalChars += fileChars;
//       }
//     }

//     if (totalChars >= maxContextChars) {
//       break;
//     }
//   }

//   selectedChunks.sort((a, b) => {
//     if ((a.filename || '') !== (b.filename || '')) {
//       return (a.filename || '').localeCompare(b.filename || '');
//     }
//     return (a.chunk_index || 0) - (b.chunk_index || 0);
//   });

//   return selectedChunks;
// }

// function isMetadataQuery(question) {
//   if (!question || typeof question !== 'string') return null;

//   const queryLower = question.toLowerCase();

//   const metadataPatterns = [
//     { pattern: /how many (file|document|doc|pdf|docx)/i, type: 'file_count' },
//     { pattern: /(count|number|total).*(file|document|doc)/i, type: 'file_count' },
//     { pattern: /how many.*in.*(case|project|folder)/i, type: 'file_count' },
//     { pattern: /(list|show|what are).*(all|the).*(file|document)/i, type: 'file_list' },
//     { pattern: /(file|document).*(name|title|list)/i, type: 'file_list' },
//     { pattern: /what.*(file|document).*in.*(case|project|folder)/i, type: 'file_list' },
//   ];

//   for (const { pattern, type } of metadataPatterns) {
//     if (pattern.test(queryLower)) {
//       return { type, question: queryLower };
//     }
//   }

//   return null;
// }

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
//       maxResults = 10, // ✅ Retrieve top 10 candidates
//       secret_id,
//       llm_name,
//       additional_input = "",
//     } = req.body;

//     let used_secret_prompt = !!secret_id;

//     if (!folderName) {
//       return res.status(400).json({ error: "folderName is required." });
//     }

//     const hasExistingSession = session_id && UUID_REGEX.test(session_id);
//     const finalSessionId = hasExistingSession ? session_id : uuidv4();

//     console.log(`\n${'='.repeat(80)}`);
//     console.log(`📁 FOLDER QUERY REQUEST`);
//     console.log(`Folder: ${folderName}`);
//     console.log(`Session: ${finalSessionId}`);
//     console.log(`Secret Prompt: ${used_secret_prompt} ${secret_id ? `(ID: ${secret_id})` : ''}`);
//     console.log(`Question: "${(question || '').substring(0, 100)}..."`);
//     console.log(`${'='.repeat(80)}\n`);

//     const { usage, plan, timeLeft } = await TokenUsageService.getUserUsageAndPlan(
//       userId,
//       authorizationHeader
//     );

//     const isFreeUser = TokenUsageService.isFreePlan(plan);
//     if (isFreeUser) {
//       console.log(`\n${'🆓'.repeat(40)}`);
//       console.log(`[FREE TIER] User is on free plan - applying restrictions`);
//       console.log(`[FREE TIER] - File size limit: 10 MB`);
//       console.log(`[FREE TIER] - Model: Forced to ${TokenUsageService.getFreeTierForcedModel()}`);
//       console.log(`[FREE TIER] - Gemini Eyeball: Only 1 use per day (first prompt)`);
//       console.log(`[FREE TIER] - Subsequent chats: Must use RAG retrieval`);
//       console.log(`[FREE TIER] - Daily token limit: 100,000 tokens (in + out)`);
//       console.log(`${'🆓'.repeat(40)}\n`);
      
//       const controllerAccessCheck = await TokenUsageService.checkFreeTierControllerAccessLimit(userId, plan, 'FileController');
//       if (!controllerAccessCheck.allowed) {
//         return res.status(403).json({
//           error: controllerAccessCheck.message,
//           upgradeRequired: true,
//           used: controllerAccessCheck.used,
//           limit: controllerAccessCheck.limit
//         });
//       }
//     }

//     const folderPattern = `%${folderName}%`;
//     const filesQuery = `
//       SELECT id, originalname, folder_path, status, gcs_path, mimetype
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

//     if (question && !used_secret_prompt) {
//       const metadataQuery = isMetadataQuery(question);
//       if (metadataQuery) {
//         console.log(`📊 Detected metadata query: ${metadataQuery.type}`);

//         if (metadataQuery.type === 'file_count') {
//           const answer = `There are **${files.length}** processed file(s) in the "${folderName}" folder/case project.`;

//           const savedChat = await FolderChat.saveFolderChat(
//             userId,
//             folderName,
//             question,
//             answer,
//             finalSessionId,
//             files.map((f) => f.id),
//             [],
//             false,
//             null,
//             null,
//             []
//           );

//           return res.json({
//             success: true,
//             session_id: savedChat.session_id,
//             answer,
//             response: answer,
//             llm_provider: 'metadata',
//             used_secret_prompt: false,
//             prompt_label: null,
//             secret_id: null,
//             used_chunk_ids: [],
//             files_queried: files.map((f) => f.originalname),
//             total_files: files.length,
//             chunks_used: 0,
//             timestamp: new Date().toISOString(),
//             displayQuestion: question,
//             storedQuestion: question,
//             chat_history: [],
//             metadata_query: true
//           });
//         } else if (metadataQuery.type === 'file_list') {
//           const fileList = files.map((f, idx) => `${idx + 1}. ${f.originalname}`).join('\n');
//           const answer = `Files in the "${folderName}" folder/case project:\n\n${fileList}\n\n**Total: ${files.length} file(s)**`;

//           const savedChat = await FolderChat.saveFolderChat(
//             userId,
//             folderName,
//             question,
//             answer,
//             finalSessionId,
//             files.map((f) => f.id),
//             [],
//             false,
//             null,
//             null,
//             []
//           );

//           return res.json({
//             success: true,
//             session_id: savedChat.session_id,
//             answer,
//             response: answer,
//             llm_provider: 'metadata',
//             used_secret_prompt: false,
//             prompt_label: null,
//             secret_id: null,
//             used_chunk_ids: [],
//             files_queried: files.map((f) => f.originalname),
//             total_files: files.length,
//             chunks_used: 0,
//             timestamp: new Date().toISOString(),
//             displayQuestion: question,
//             storedQuestion: question,
//             chat_history: [],
//             metadata_query: true
//           });
//         }
//       }
//     }

//     const caseData = await fetchCaseDataForFolder(userId, folderName);
//     const caseContext = caseData ? formatCaseDataAsContext(caseData) : '';

//     let previousChats = [];
//     if (hasExistingSession) {
//       previousChats = await FolderChat.getFolderChatHistory(userId, folderName, finalSessionId);
//     }
//     const conversationContext = formatFolderConversationHistory(previousChats);
//     const historyForStorage = simplifyFolderHistory(previousChats);

//     let answer;
//     let usedChunkIds = [];
//     let usedFileIds = files.map(f => f.id);
//     let storedQuestion;
//     let displayQuestion;
//     let finalPromptLabel = prompt_label;
//     let provider = "gemini";
//     let methodUsed = "rag"; // Default to RAG
//     let secretValue = null;
//     let secretName = null;

//     if (used_secret_prompt) {
//       if (!secret_id) {
//         return res.status(400).json({ error: "secret_id is required for secret prompts." });
//       }

//       console.log(`\n${'='.repeat(80)}`);
//       console.log(`🔐 PROCESSING SECRET PROMPT (ID: ${secret_id})`);
//       console.log(`${'='.repeat(80)}\n`);

//       const secretData = await fetchSecretManagerWithTemplates(secret_id);

//       if (!secretData) {
//         console.error(`❌ Secret ID ${secret_id} not found in database`);
//         return res.status(404).json({ error: "Secret configuration not found in database." });
//       }

//       const {
//         id: dbSecretId,
//         name: dbSecretName,
//         secret_manager_id,
//         version,
//         llm_id,
//         llm_name: dbLlmName,
//         input_template_id,
//         output_template_id
//       } = secretData;

//       console.log(`\n📋 SECRET METADATA RETRIEVED:`);
//       console.log(`   Database ID: ${dbSecretId}`);
//       console.log(`   Secret Name: ${dbSecretName}`);
//       console.log(`   GCP Secret Manager ID: ${secret_manager_id}`);
//       console.log(`   Version: ${version}`);
//       console.log(`   LLM ID: ${llm_id || 'not set'}`);
//       console.log(`   LLM Name: ${dbLlmName || 'not set'}\n`);

//       secretName = dbSecretName;
//       finalPromptLabel = secretName;
//       storedQuestion = secretName;
//       displayQuestion = `Analysis: ${secretName}`;

//       provider = resolveFolderProviderName(llm_name || dbLlmName || "gemini");
//       console.log(`🤖 LLM Provider Resolution:`);
//       console.log(`   Input LLM Name: ${llm_name || dbLlmName || 'none (defaulting to gemini)'}`);
//       console.log(`   Resolved Provider: ${provider}\n`);

//       const isGeminiProvider = provider.toLowerCase().includes('gemini');
//       console.log(`🔍 Provider Type Check: ${isGeminiProvider ? '✅ Gemini' : '❌ Non-Gemini'}\n`);

//       const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");
//       const secretClient = new SecretManagerServiceClient();
//       const GCLOUD_PROJECT_ID = process.env.GCLOUD_PROJECT_ID;

//       if (!GCLOUD_PROJECT_ID) {
//         throw new Error('GCLOUD_PROJECT_ID environment variable not set');
//       }

//       const gcpSecretName = `projects/${GCLOUD_PROJECT_ID}/secrets/${secret_manager_id}/versions/${version}`;
//       console.log(`🔐 Fetching Secret from GCP Secret Manager:`);
//       console.log(`   Full Path: ${gcpSecretName}\n`);

//       let accessResponse;
//       try {
//         [accessResponse] = await secretClient.accessSecretVersion({ name: gcpSecretName });
//       } catch (gcpError) {
//         console.error(`❌ Failed to fetch secret from GCP:`, gcpError.message);
//         throw new Error(`Failed to access secret from GCP Secret Manager: ${gcpError.message}`);
//       }

//       secretValue = accessResponse.payload.data.toString("utf8");

//       if (!secretValue?.trim()) {
//         console.error(`❌ Secret value is empty for secret: ${dbSecretName} (${secret_manager_id})`);
//         return res.status(500).json({
//           error: "Secret value is empty.",
//           secretName: dbSecretName,
//           secretId: secret_id
//         });
//       }

//       console.log(`✅ SECRET VALUE RETRIEVED SUCCESSFULLY:`);
//       console.log(`   Length: ${secretValue.length} characters`);
//       console.log(`   Preview: "${secretValue.substring(0, 100)}${secretValue.length > 100 ? '...' : ''}"\n`);

//       let templateData = { inputTemplate: null, outputTemplate: null, hasTemplates: false };
//       if (input_template_id || output_template_id) {
//         console.log(`\n📄 FETCHING TEMPLATE FILES:`);
//         console.log(`   Input Template ID: ${input_template_id || 'not set'}`);
//         console.log(`   Output Template ID: ${output_template_id || 'not set'}\n`);
        
//         templateData = await fetchTemplateFilesData(input_template_id, output_template_id);
        
//         if (templateData.hasTemplates) {
//           console.log(`✅ Template files fetched successfully`);
//           if (templateData.inputTemplate) {
//             console.log(`   Input: ${templateData.inputTemplate.filename} (${templateData.inputTemplate.extracted_text?.length || 0} chars)`);
//           }
//           if (templateData.outputTemplate) {
//             console.log(`   Output: ${templateData.outputTemplate.filename} (${templateData.outputTemplate.extracted_text?.length || 0} chars)`);
//           }
//         } else {
//           console.log(`⚠️ No template files found or available`);
//         }
//         console.log();
//       }

//       if (templateData.hasTemplates) {
//         secretValue = buildEnhancedSystemPromptWithTemplates(secretValue, templateData);
//         console.log(`✅ Enhanced prompt built with template examples`);
//         console.log(`   Enhanced prompt length: ${secretValue.length} characters\n`);
        
//         // Add JSON formatting instructions if output template exists
//         const inputTemplate = templateData?.inputTemplate || null;
//         const outputTemplate = templateData?.outputTemplate || null;
//         if (outputTemplate && outputTemplate.extracted_text) {
//           const { addSecretPromptJsonFormatting } = require('./secretManagerController');
//           const jsonFormatting = addSecretPromptJsonFormatting('', inputTemplate, outputTemplate);
//           if (jsonFormatting.trim()) {
//             secretValue += jsonFormatting;
//             console.log(`✅ Added JSON formatting instructions to prompt\n`);
//           }
//         }
//       }

//       const secretQueryAnalysis = analyzeQueryIntent(secretValue);
//       console.log(`📊 QUERY INTENT ANALYSIS:`);
//       console.log(`   Strategy: ${secretQueryAnalysis.strategy}`);
//       console.log(`   Reason: ${secretQueryAnalysis.reason}`);
//       console.log(`   Needs Full Document: ${secretQueryAnalysis.needsFullDocument ? '✅ YES' : '❌ NO'}`);
//       console.log(`   Similarity Threshold: ${secretQueryAnalysis.threshold}\n`);

//       console.log(`\n${'='.repeat(80)}`);
//       console.log(`🚦 ROUTING DECISION FOR SECRET PROMPT`);
//       console.log(`${'='.repeat(80)}`);
//       console.log(`🔒 SECRET PROMPT POLICY:`);
//       console.log(`   ✅ Always use RAG method (no Gemini Eyeball)`);
//       console.log(`   ✅ Use ONLY the LLM specified in secret configuration`);
//       console.log(`\nSecret Configuration:`);
//       console.log(`   - Secret Name: "${secretName}"`);
//       console.log(`   - LLM from Secret: ${dbLlmName || 'not set'}`);
//       console.log(`   - Resolved Provider: ${provider}`);
//       console.log(`   - Method: RAG (enforced)`);
//       console.log(`${'='.repeat(80)}\n`);

//       methodUsed = "rag";

//       console.log(`\n🎯 ROUTING DECISION: RAG METHOD (SECRET PROMPT)`);
//       console.log(`Reason: Secret prompts always use RAG with their specified LLM`);
//       console.log(`   🔐 Secret Prompt: "${secretName}"`);
//       console.log(`   🤖 LLM from Secret Config: ${dbLlmName || 'not set'}`);
//       console.log(`   🤖 Resolved Provider: ${provider}`);
//       console.log(`   📊 Query Analysis: ${secretQueryAnalysis.strategy}`);
//       console.log(`   🔍 Vector search threshold: ${secretQueryAnalysis.threshold}`);
//       console.log(`${'='.repeat(80)}\n`);

//       console.log(`\n🔍 [RAG] Starting vector search for secret prompt...`);
//       console.log(`   - Files to search: ${files.length}`);
//       console.log(`   - Max results per file: ${maxResults}`);
      
//       const questionEmbedding = await generateEmbedding(secretValue);
//       console.log(`   - Question embedding generated: ${questionEmbedding.length} dimensions`);
      
//       const allRelevantChunks = [];
//       for (const file of files) {
//         console.log(`\n   🔍 Searching chunks in file: ${file.originalname}`);
//         console.log(`      File ID: ${file.id} (type: ${typeof file.id})`);
//         console.log(`      File Status: ${file.status}`);
        
//         const debugChunks = await FileChunk.getChunksByFileId(file.id);
//         console.log(`      📋 Chunks in database: ${debugChunks.length}`);
        
//         if (debugChunks.length === 0) {
//           console.log(`      ⚠️ No chunks found in database for this file - skipping vector search`);
//           continue;
//         }
        
//         const chunkIds = debugChunks.map(c => c.id);
//         const debugVectors = await ChunkVector.getVectorsByChunkIds(chunkIds);
//         console.log(`      🔗 Embeddings in database: ${debugVectors.length} for ${chunkIds.length} chunks`);
        
//         if (debugVectors.length === 0) {
//           console.log(`      ⚠️ WARNING: Chunks exist but no embeddings found!`);
//           console.log(`      💡 This means embeddings were not generated. Using chunks directly as fallback.`);
//           const fallbackChunks = debugChunks.map(c => ({
//             ...c,
//             filename: file.originalname,
//             file_id: file.id,
//             similarity: 0.5,
//             distance: 1.0,
//             chunk_id: c.id,
//             content: c.content
//           }));
//           allRelevantChunks.push(...fallbackChunks);
//           console.log(`      ✅ Added ${fallbackChunks.length} chunks as fallback (no embeddings available)`);
//           continue;
//         }
        
//         console.log(`      🔎 Performing vector search with embedding...`);
//         const relevant = await ChunkVector.findNearestChunksAcrossFiles(
//           questionEmbedding,
//           maxResults,
//           [file.id]
//         );
//         console.log(`      📊 Vector search found: ${relevant.length} relevant chunks`);
        
//         if (relevant.length) {
//           const chunksWithSimilarity = relevant.map((r) => {
//             const distance = parseFloat(r.distance) || 2.0;
//             const similarity = 1 / (1 + distance); // Convert distance to similarity
//             return {
//               ...r,
//               filename: file.originalname,
//               file_id: file.id,
//               similarity: similarity,
//               distance: distance
//             };
//           });
//           allRelevantChunks.push(...chunksWithSimilarity);
//           console.log(`      ✅ Added ${chunksWithSimilarity.length} chunks (similarity range: ${Math.min(...chunksWithSimilarity.map(c => c.similarity)).toFixed(3)} - ${Math.max(...chunksWithSimilarity.map(c => c.similarity)).toFixed(3)})`);
//         } else {
//           console.log(`      ⚠️ Vector search returned 0 results, but ${debugChunks.length} chunks exist`);
//           console.log(`      💡 Using all chunks as fallback since embeddings exist but don't match query`);
//           const fallbackChunks = debugChunks.map(c => ({
//             ...c,
//             filename: file.originalname,
//             file_id: file.id,
//             similarity: 0.3, // Lower similarity for fallback
//             distance: 2.0,
//             chunk_id: c.id,
//             content: c.content
//           }));
//           allRelevantChunks.push(...fallbackChunks);
//           console.log(`      ✅ Added ${fallbackChunks.length} chunks as fallback (vector search had no matches)`);
//         }
//       }

//       console.log(`\n📊 [RAG] Vector search completed:`);
//       console.log(`   - Total relevant chunks found: ${allRelevantChunks.length}`);

//       if (allRelevantChunks.length === 0) {
//         console.warn(`\n⚠️ [RAG] No chunks found via vector search - trying fallback...`);
//         console.warn(`   - Files searched: ${files.length}`);
        
//         const processingFiles = files.filter(f => f.status !== 'processed');
//         if (processingFiles.length > 0) {
//           console.warn(`   - ⚠️ ${processingFiles.length} file(s) still processing: ${processingFiles.map(f => f.originalname).join(', ')}`);
//           return res.status(400).json({ 
//             error: "Document is still being processed. Please wait for processing to complete before asking questions.",
//             processingFiles: processingFiles.map(f => ({ id: f.id, name: f.originalname, status: f.status }))
//           });
//         }
        
//         console.log(`   - Attempting fallback: Using all chunks from processed files...`);
//         const fallbackChunks = [];
//         for (const file of files) {
//           if (file.status === 'processed') {
//             const fileChunks = await FileChunk.getChunksByFileId(file.id);
//             console.log(`     - File ${file.originalname}: Found ${fileChunks.length} chunks`);
//             if (fileChunks.length > 0) {
//               fallbackChunks.push(...fileChunks.map(c => ({
//                 ...c,
//                 filename: file.originalname,
//                 file_id: file.id,
//                 similarity: 0.5, // Default similarity for fallback
//                 distance: 1.0,
//                 chunk_id: c.id,
//                 content: c.content
//               })));
//             }
//           }
//         }
        
//         if (fallbackChunks.length > 0) {
//           console.log(`   ✅ Fallback successful: Using ${fallbackChunks.length} chunks from ${files.length} file(s)`);
//           allRelevantChunks.push(...fallbackChunks);
//         } else {
//           console.error(`\n❌ [RAG] No chunks found even with fallback!`);
//           console.error(`   - Files searched: ${files.length}`);
//           console.error(`   - Files status: ${files.map(f => `${f.originalname}: ${f.status}`).join(', ')}`);
//           console.error(`   - This could mean:`);
//           console.error(`     1. Chunks/embeddings not yet generated (processing may still be in progress)`);
//           console.error(`     2. Embeddings don't match the query`);
//           console.error(`     3. File IDs don't match`);
//           console.error(`     4. No chunks were created during processing`);
//           return res.status(404).json({ 
//             error: "No relevant information found for your query.",
//             details: "The document may still be processing, or no content was extracted. Please check the document status.",
//             filesStatus: files.map(f => ({ id: f.id, name: f.originalname, status: f.status }))
//           });
//         }
//       }

//       const topChunks = allRelevantChunks
//         .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
//         .slice(0, 10);
      
//       console.log(`   - Top chunks selected: ${topChunks.length}`);
//       console.log(`   - Similarity range: ${Math.min(...topChunks.map(c => c.similarity)).toFixed(3)} - ${Math.max(...topChunks.map(c => c.similarity)).toFixed(3)}`);
//       usedChunkIds = topChunks.map(c => c.chunk_id || c.id);

//       const combinedContext = topChunks
//         .map((c) => `📄 [${c.filename}]\n${c.content}`)
//         .join("\n\n");

//       let finalPrompt = secretValue;
//       if (caseContext) {
//         finalPrompt = `${caseContext}\n\n${finalPrompt}`;
//       }
//       if (conversationContext) {
//         finalPrompt = `Previous Conversation:\n${conversationContext}\n\n---\n\n${finalPrompt}`;
//       }
//       finalPrompt += `\n\n=== RELEVANT DOCUMENTS (FOLDER: "${folderName}") ===\n${combinedContext}`;
//       if (additional_input?.trim()) {
//         finalPrompt += `\n\n=== ADDITIONAL INPUT ===\n${additional_input.trim()}`;
//       }

//       try {
//         const profileContext = await UserProfileService.getProfileContext(userId, authorizationHeader);
//         if (profileContext) {
//           finalPrompt = `${profileContext}\n\n---\n\n${finalPrompt}`;
//         }
//       } catch (profileError) {
//         console.warn(`Failed to fetch profile context:`, profileError.message);
//       }

//       console.log(`\n🤖 Using LLM from secret configuration: ${provider}`);
//       answer = await askFolderLLMService(provider, finalPrompt, '', combinedContext);

//       // Post-process response to ensure proper JSON format if output template exists
//       if (used_secret_prompt && templateData?.outputTemplate) {
//         const { postProcessSecretPromptResponse } = require('./secretManagerController');
//         answer = postProcessSecretPromptResponse(answer, templateData.outputTemplate);
//         console.log(`✅ Post-processed response to match output template format`);
//       }

//       console.log(`\n✅ RAG METHOD COMPLETED SUCCESSFULLY:`);
//       console.log(`   🔐 Secret Prompt Used: "${secretName}"`);
//       console.log(`   🤖 LLM Used: ${provider} (from secret config)`);
//       console.log(`   📊 Answer Length: ${answer.length} characters`);
//       console.log(`   🧩 Chunks Used: ${topChunks.length}`);
//       console.log(`${'='.repeat(80)}\n`);
//     }

//     else {
//       if (!question?.trim())
//         return res.status(400).json({ error: "question is required for custom queries." });

//       console.log(`\n${'='.repeat(80)}`);
//       console.log(`💬 PROCESSING CUSTOM QUESTION`);
//       console.log(`Question: "${question.substring(0, 100)}..."`);
//       console.log(`${'='.repeat(80)}\n`);

//       storedQuestion = question;
//       displayQuestion = question;
//       finalPromptLabel = null;

//       let dbLlmName = null;
//       const customQueryLlm = `
//         SELECT cq.llm_name, cq.llm_model_id
//         FROM custom_query cq
//         ORDER BY cq.id DESC
//         LIMIT 1;
//       `;
//       const customQueryResult = await pool.query(customQueryLlm);
//       if (customQueryResult.rows.length > 0) {
//         dbLlmName = customQueryResult.rows[0].llm_name;
//         console.log(`🤖 LLM from custom_query table: ${dbLlmName}`);
//       } else {
//         console.warn(`⚠️ No LLM in custom_query table — falling back to gemini`);
//         dbLlmName = 'gemini';
//       }

//       provider = resolveFolderProviderName(dbLlmName || "gemini");
//       console.log(`🤖 Resolved provider: ${provider}`);

//       const availableProviders = getFolderAvailableProviders();
//       if (!availableProviders[provider] || !availableProviders[provider].available) {
//         console.warn(`⚠️ Provider '${provider}' unavailable — falling back to gemini`);
//         provider = 'gemini';
//       }

//       const queryAnalysis = analyzeQueryIntent(question);
//       console.log(`💬 Query Analysis: ${queryAnalysis.strategy} - ${queryAnalysis.reason}`);

//       const isGeminiProvider = provider.toLowerCase().includes('gemini');

//       if (isFreeUser) {
//         if (queryAnalysis.needsFullDocument) {
//           const eyeballLimitCheck = await TokenUsageService.checkFreeTierEyeballLimit(userId, plan);
//           if (!eyeballLimitCheck.allowed) {
//             console.log(`\n${'🆓'.repeat(40)}`);
//             console.log(`[FREE TIER] Gemini Eyeball limit reached - forcing RAG`);
//             console.log(`[FREE TIER] ${eyeballLimitCheck.message}`);
//             console.log(`${'🆓'.repeat(40)}\n`);
            
//             queryAnalysis.needsFullDocument = false;
//             queryAnalysis.strategy = 'TARGETED_RAG';
//             queryAnalysis.reason = 'Free tier: Gemini Eyeball limit reached (1/day), using RAG retrieval instead';
//           } else {
//             console.log(`\n${'🆓'.repeat(40)}`);
//             console.log(`[FREE TIER] Gemini Eyeball allowed: ${eyeballLimitCheck.message}`);
//             console.log(`${'🆓'.repeat(40)}\n`);
//           }
//         } else {
//           console.log(`\n${'🆓'.repeat(40)}`);
//           console.log(`[FREE TIER] Using RAG retrieval (subsequent chat after first Eyeball use)`);
//           console.log(`${'🆓'.repeat(40)}\n`);
//         }
//       }

//       if (isFreeUser) {
//         const inputTokens = Math.ceil((question?.length || 0) / 4);
//         const estimatedOutputTokens = Math.ceil(inputTokens * 1.5); // Estimate output tokens
//         const estimatedTokens = inputTokens + estimatedOutputTokens;
        
//         const tokenLimitCheck = await TokenUsageService.checkFreeTierDailyTokenLimit(userId, plan, estimatedTokens);
//         if (!tokenLimitCheck.allowed) {
//           return res.status(403).json({
//             error: tokenLimitCheck.message,
//             dailyLimit: tokenLimitCheck.dailyLimit,
//             used: tokenLimitCheck.used,
//             remaining: tokenLimitCheck.remaining,
//             upgradeRequired: true
//           });
//         }
//         console.log(`[FREE TIER] Token check passed: ${tokenLimitCheck.message}`);
//       }

//       if (isGeminiProvider && queryAnalysis.needsFullDocument) {
//         methodUsed = "gemini_eyeball";

//         console.log(`\n${'='.repeat(80)}`);
//         console.log(`👁️ USING GEMINI EYEBALL METHOD`);
//         console.log(`Reason: Gemini provider + comprehensive query`);
//         console.log(`Files to process: ${files.length}`);
//         console.log(`${'='.repeat(80)}\n`);

//         const bucketName = process.env.GCS_BUCKET_NAME;
//         if (!bucketName) {
//           throw new Error('GCS_BUCKET_NAME not configured');
//         }

//         const documents = files.map((file) => ({
//           gcsUri: `gs://${bucketName}/${file.gcs_path}`,
//           filename: file.originalname,
//           mimeType: file.mimetype || 'application/pdf'
//         }));

//         let promptText = question;
//         if (caseContext) {
//           promptText = `${caseContext}\n\n${promptText}`;
//         }
//         if (conversationContext) {
//           promptText = `Previous Conversation:\n${conversationContext}\n\n---\n\n${promptText}`;
//         }

//         try {
//           const profileContext = await UserProfileService.getProfileContext(userId, authorizationHeader);
//           if (profileContext) {
//             promptText = `${profileContext}\n\n---\n\n${promptText}`;
//           }
//         } catch (profileError) {
//           console.warn(`Failed to fetch profile context:`, profileError.message);
//         }

//         const { askGeminiWithMultipleGCS } = require('../services/folderGeminiService');
//         const forcedModel = isFreeUser ? TokenUsageService.getFreeTierForcedModel() : null;
//         answer = await askGeminiWithMultipleGCS(promptText, documents, '', forcedModel);
//         answer = ensurePlainTextAnswer(answer);

//         usedChunkIds = []; // Eyeball uses full documents, not chunks

//         console.log(`✅ Gemini Eyeball completed: ${answer.length} chars`);
//       } else {
//         methodUsed = "rag";

//         console.log(`\n${'='.repeat(80)}`);
//         console.log(`🔍 USING RAG METHOD`);
//         console.log(`Reason: ${isGeminiProvider ? 'Targeted query' : 'Non-Gemini provider'}`);
//         console.log(`Provider: ${provider}`);
//         console.log(`${'='.repeat(80)}\n`);

//         const questionEmbedding = await generateEmbedding(question);
//         console.log(`\n🔍 [RAG] Starting vector search for custom question...`);
//         console.log(`   - Question: "${question.substring(0, 100)}${question.length > 100 ? '...' : ''}"`);
//         console.log(`   - Files to search: ${files.length}`);
//         console.log(`   - Max results per file: ${maxResults}`);
        
//         const allRelevantChunks = [];
//         for (const file of files) {
//           console.log(`\n   🔍 Searching chunks in file: ${file.originalname}`);
//           console.log(`      File ID: ${file.id} (type: ${typeof file.id})`);
//           console.log(`      File Status: ${file.status}`);
          
//           const debugChunks = await FileChunk.getChunksByFileId(file.id);
//           console.log(`      📋 Chunks in database: ${debugChunks.length}`);
          
//           if (debugChunks.length === 0) {
//             console.log(`      ⚠️ No chunks found in database for this file - skipping vector search`);
//             continue;
//           }
          
//           const chunkIds = debugChunks.map(c => c.id);
//           const debugVectors = await ChunkVector.getVectorsByChunkIds(chunkIds);
//           console.log(`      🔗 Embeddings in database: ${debugVectors.length} for ${chunkIds.length} chunks`);
          
//           if (debugVectors.length === 0) {
//             console.log(`      ⚠️ WARNING: Chunks exist but no embeddings found!`);
//             console.log(`      💡 This means embeddings were not generated. Using chunks directly as fallback.`);
//             const fallbackChunks = debugChunks.map(c => ({
//               ...c,
//               filename: file.originalname,
//               file_id: file.id,
//               similarity: 0.5,
//               distance: 1.0,
//               chunk_id: c.id,
//               content: c.content
//             }));
//             allRelevantChunks.push(...fallbackChunks);
//             console.log(`      ✅ Added ${fallbackChunks.length} chunks as fallback (no embeddings available)`);
//             continue;
//           }
          
//           console.log(`      🔎 Performing vector search with embedding...`);
//           const relevant = await ChunkVector.findNearestChunksAcrossFiles(
//             questionEmbedding,
//             maxResults,
//             [file.id]
//           );
//           console.log(`      📊 Vector search found: ${relevant.length} relevant chunks`);
          
//           if (relevant.length) {
//             const chunksWithSimilarity = relevant.map((r) => {
//               const distance = parseFloat(r.distance) || 2.0;
//               const similarity = 1 / (1 + distance); // Convert distance to similarity
//               return {
//                 ...r,
//                 filename: file.originalname,
//                 file_id: file.id,
//                 similarity: similarity,
//                 distance: distance
//               };
//             });
//             allRelevantChunks.push(...chunksWithSimilarity);
//             console.log(`      ✅ Added ${chunksWithSimilarity.length} chunks (similarity range: ${Math.min(...chunksWithSimilarity.map(c => c.similarity)).toFixed(3)} - ${Math.max(...chunksWithSimilarity.map(c => c.similarity)).toFixed(3)})`);
//           } else {
//             console.log(`      ⚠️ Vector search returned 0 results, but ${debugChunks.length} chunks exist`);
//             console.log(`      💡 Using all chunks as fallback since embeddings exist but don't match query`);
//             const fallbackChunks = debugChunks.map(c => ({
//               ...c,
//               filename: file.originalname,
//               file_id: file.id,
//               similarity: 0.3, // Lower similarity for fallback
//               distance: 2.0,
//               chunk_id: c.id,
//               content: c.content
//             }));
//             allRelevantChunks.push(...fallbackChunks);
//             console.log(`      ✅ Added ${fallbackChunks.length} chunks as fallback (vector search had no matches)`);
//           }
//         }

//         console.log(`\n📊 [RAG] Vector search completed:`);
//         console.log(`   - Total relevant chunks found: ${allRelevantChunks.length}`);

//         if (allRelevantChunks.length === 0) {
//           console.warn(`\n⚠️ [RAG] No chunks found via vector search - trying fallback...`);
//           console.warn(`   - Files searched: ${files.length}`);
          
//           const processingFiles = files.filter(f => f.status !== 'processed');
//           if (processingFiles.length > 0) {
//             console.warn(`   - ⚠️ ${processingFiles.length} file(s) still processing: ${processingFiles.map(f => f.originalname).join(', ')}`);
//             return res.status(400).json({ 
//               error: "Document is still being processed. Please wait for processing to complete before asking questions.",
//               processingFiles: processingFiles.map(f => ({ id: f.id, name: f.originalname, status: f.status }))
//             });
//           }
          
//           console.log(`   - Attempting fallback: Using all chunks from processed files...`);
//           const fallbackChunks = [];
//           for (const file of files) {
//             if (file.status === 'processed') {
//               const fileChunks = await FileChunk.getChunksByFileId(file.id);
//               console.log(`     - File ${file.originalname}: Found ${fileChunks.length} chunks`);
//               if (fileChunks.length > 0) {
//                 fallbackChunks.push(...fileChunks.map(c => ({
//                   ...c,
//                   filename: file.originalname,
//                   file_id: file.id,
//                   similarity: 0.5, // Default similarity for fallback
//                   distance: 1.0,
//                   chunk_id: c.id,
//                   content: c.content
//                 })));
//               }
//             }
//           }
          
//           if (fallbackChunks.length > 0) {
//             console.log(`   ✅ Fallback successful: Using ${fallbackChunks.length} chunks from ${files.length} file(s)`);
//             allRelevantChunks.push(...fallbackChunks);
//           } else {
//             console.error(`\n❌ [RAG] No chunks found even with fallback!`);
//             console.error(`   - Files searched: ${files.length}`);
//             console.error(`   - Files status: ${files.map(f => `${f.originalname}: ${f.status}`).join(', ')}`);
//             console.error(`   - This could mean:`);
//             console.error(`     1. Chunks/embeddings not yet generated (processing may still be in progress)`);
//             console.error(`     2. Embeddings don't match the query`);
//             console.error(`     3. File IDs don't match`);
//             console.error(`     4. No chunks were created during processing`);
//             return res.status(404).json({ 
//               error: "No relevant information found for your query.",
//               details: "The document may still be processing, or no content was extracted. Please check the document status.",
//               filesStatus: files.map(f => ({ id: f.id, name: f.originalname, status: f.status }))
//             });
//           }
//         }

//         const topChunks = allRelevantChunks
//           .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
//           .slice(0, 10);
        
//         console.log(`   - Top chunks selected: ${topChunks.length}`);
//         console.log(`   - Similarity range: ${Math.min(...topChunks.map(c => c.similarity)).toFixed(3)} - ${Math.max(...topChunks.map(c => c.similarity)).toFixed(3)}`);
//         usedChunkIds = topChunks.map(c => c.chunk_id || c.id);

//         const combinedContext = topChunks
//           .map((c) => `📄 [${c.filename}]\n${c.content}`)
//           .join("\n\n");

//         chatCost = Math.ceil(question.length / 100) + Math.ceil(combinedContext.length / 200);

//         const requestedResources = { tokens: chatCost, ai_analysis: 1 };
//         const { allowed, message } = await TokenUsageService.enforceLimits(usage, plan, requestedResources);
//         if (!allowed) {
//           return res.status(403).json({
//             error: `AI chat failed: ${message}`,
//             timeLeftUntilReset: timeLeft
//           });
//         }

//         let finalPrompt = question;
//         if (caseContext) {
//           finalPrompt = `${caseContext}\n\n${finalPrompt}`;
//         }
//         if (conversationContext) {
//           finalPrompt = `Previous Conversation:\n${conversationContext}\n\n---\n\n${finalPrompt}`;
//         }
//         finalPrompt += `\n\n=== RELEVANT DOCUMENTS (FOLDER: "${folderName}") ===\n${combinedContext}`;

//         try {
//           const profileContext = await UserProfileService.getProfileContext(userId, authorizationHeader);
//           if (profileContext) {
//             finalPrompt = `${profileContext}\n\n---\n\n${finalPrompt}`;
//           }
//         } catch (profileError) {
//           console.warn(`Failed to fetch profile context:`, profileError.message);
//         }

//         answer = await askFolderLLMService(provider, finalPrompt, '', combinedContext);
//         answer = ensurePlainTextAnswer(answer);

//         console.log(`✅ RAG completed: ${answer.length} chars, ${topChunks.length} chunks`);

//         await TokenUsageService.incrementUsage(userId, requestedResources);
//       }
//     }

//     if (!answer?.trim()) {
//       return res.status(500).json({ error: "Empty response from AI." });
//     }

//     console.log(`\n${'='.repeat(80)}`);
//     console.log(`✅ QUERY COMPLETED SUCCESSFULLY`);
//     console.log(`Method: ${methodUsed.toUpperCase()}`);
//     console.log(`Answer Length: ${answer.length} chars`);
//     console.log(`Chunks Used: ${usedChunkIds.length}`);
//     console.log(`${'='.repeat(80)}\n`);

//     const savedChat = await FolderChat.saveFolderChat(
//       userId,
//       folderName,
//       storedQuestion,
//       answer,
//       finalSessionId,
//       usedFileIds,
//       usedChunkIds,
//       used_secret_prompt,
//       finalPromptLabel,
//       secret_id,
//       historyForStorage
//     );

//     return res.json({
//       success: true,
//       session_id: savedChat.session_id,
//       answer,
//       response: answer,
//       llm_provider: provider,
//       method: methodUsed,
//       used_secret_prompt,
//       prompt_label: finalPromptLabel,
//       secret_id: used_secret_prompt ? secret_id : null,
//       used_chunk_ids: usedChunkIds,
//       files_queried: files.map((f) => f.originalname),
//       total_files: files.length,
//       chunks_used: usedChunkIds.length,
//       timestamp: new Date().toISOString(),
//       displayQuestion: displayQuestion,
//       storedQuestion: storedQuestion,
//       chat_history: savedChat.chat_history || [],
//     });
//   } catch (error) {
//     console.error(`\n${'='.repeat(80)}`);
//     console.error("❌ ERROR in queryFolderDocuments");
//     console.error(`Type: ${error.name}`);
//     console.error(`Message: ${error.message}`);
//     console.error(`Stack: ${error.stack}`);
//     console.error(`${'='.repeat(80)}\n`);

//     return res.status(500).json({
//       error: "Failed to get AI answer.",
//       details: error.message,
//     });
//   }
// };

// exports.queryFolderDocumentsStream = async (req, res) => {
//   let userId = req.user.id;
//   const heartbeat = setInterval(() => {
//     try {
//       res.write(`data: [PING]\n\n`);
//     } catch (err) {
//       clearInterval(heartbeat);
//     }
//   }, 15000);

//   res.setHeader("Content-Type", "text/event-stream");
//   res.setHeader("Cache-Control", "no-cache");
//   res.setHeader("Connection", "keep-alive");
//   res.flushHeaders();

//   try {
//     res.write(`data: ${JSON.stringify({ type: 'metadata', status: 'streaming_started' })}\n\n`);

//     console.log('[queryFolderDocumentsStream] Streaming started');


//     let capturedData = null;
//     let captureError = null;

//     const mockRes = {
//       status: (code) => {
//         mockRes.statusCode = code;
//         return mockRes;
//       },
//       json: (data) => {
//         capturedData = data;
//         return mockRes;
//       },
//       setHeader: () => mockRes,
//       writeHead: () => mockRes,
//       end: () => { },
//       headersSent: false,
//       statusCode: 200
//     };

//     const mockReq = {
//       ...req,
//       headers: {
//         ...(req.headers || {}),
//         authorization: req.headers?.authorization || req.header?.('authorization') || ''
//       },
//       user: req.user || {},
//       body: req.body || {},
//       params: req.params || {},
//       query: req.query || {}
//     };

//     try {
//       await exports.queryFolderDocuments(mockReq, mockRes);
//     } catch (err) {
//       captureError = err;
//     }

//     if (captureError) {
//       clearInterval(heartbeat);
//       res.write(`data: ${JSON.stringify({ type: 'error', message: 'Failed to process request', details: captureError.message })}\n\n`);
//       res.end();
//       return;
//     }

//     if (!capturedData || !capturedData.answer) {
//       clearInterval(heartbeat);
//       res.write(`data: ${JSON.stringify({ type: 'error', message: 'No answer received' })}\n\n`);
//       res.end();
//       return;
//     }

//     res.write(`data: ${JSON.stringify({ type: 'metadata', session_id: capturedData.session_id })}\n\n`);

//     let answer = ensurePlainTextAnswer(capturedData.answer);
//     const chunkSize = 10; // Stream 10 characters at a time
//     for (let i = 0; i < answer.length; i += chunkSize) {
//       const chunk = answer.substring(i, Math.min(i + chunkSize, answer.length));
//       res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
//       await new Promise(resolve => setTimeout(resolve, 10));
//     }

//     res.write(`data: ${JSON.stringify({
//       type: 'done',
//       session_id: capturedData.session_id,
//       answer: answer, // ✅ Send plain text answer
//       llm_provider: capturedData.llm_provider,
//       used_chunk_ids: capturedData.used_chunk_ids,
//       chunks_used: capturedData.chunks_used,
//       files_queried: capturedData.files_queried,
//       total_files: capturedData.total_files
//     })}\n\n`);
//     res.write(`data: [DONE]\n\n`);
//     clearInterval(heartbeat);
//     res.end();

//   } catch (error) {
//     console.error('❌ Error in queryFolderDocumentsStream:', error);
//     clearInterval(heartbeat);
//     if (!res.headersSent) {
//       res.write(`data: ${JSON.stringify({ type: 'error', message: 'Failed to get AI answer.', details: error.message })}\n\n`);
//     }
//     res.end();
//   }
// };

// exports.getFolderProcessingStatus = async (req, res) => {
//   try {
//     const { folderName } = req.params;
//     const userId = req.user.id;

//     const files = await File.findByUserIdAndFolderPath(userId, folderName);
//     const documents = files.filter(f => !f.is_folder);

//     if (documents.length === 0) {
//       return res.json({
//         folderName,
//         overallProgress: 100,
//         processingStatus: { total: 0, queued: 0, processing: 0, completed: 0, failed: 0 },
//         documents: []
//       });
//     }

//     const processingStatus = {
//       total: documents.length,
//       queued: documents.filter(f => f.status === "queued" || f.status === "batch_queued").length,
//       processing: documents.filter(f => f.status === "batch_processing" || f.status === "processing").length,
//       completed: documents.filter(f => f.status === "processed").length,
//       failed: documents.filter(f => f.status === "error").length
//     };

//     const overallProgress = Math.round((processingStatus.completed / documents.length) * 100);

//     return res.json({
//       folderName,
//       overallProgress,
//       processingStatus,
//       documents: documents.map(doc => ({
//         id: doc.id,
//         name: doc.originalname,
//         status: doc.status, // Fixed: was using doc.processing_status
//         progress: doc.processing_progress
//       }))
//     });

//   } catch (error) {
//     console.error("❌ getFolderProcessingStatus error:", error);
//     res.status(500).json({
//       error: "Failed to get folder processing status",
//       details: error.message
//     });
//   }
// };

// exports.getFileProcessingStatus = async (req, res) => {
//   try {
//     const { file_id } = req.params;
//     if (!file_id || file_id === 'undefined') {
//       return res.status(400).json({ error: "A valid file_id is required." });
//     }

//     const file = await File.getFileById(file_id);
//     if (!file || String(file.user_id) !== String(req.user.id)) {
//       return res.status(403).json({ error: "Access denied or file not found." });
//     }

//     const job = await ProcessingJob.getJobByFileId(file_id);

//     if (file.status === "processed") {
//       const existingChunks = await FileChunk.getChunksByFileId(file_id);
//       if (existingChunks && existingChunks.length > 0) {
//         const formattedChunks = existingChunks.map((chunk) => ({
//           text: chunk.content,
//           metadata: {
//             page_start: chunk.page_start,
//             page_end: chunk.page_end,
//             heading: chunk.heading,
//           },
//         }));
//         return res.json({
//           file_id: file.id,
//           status: file.status,
//           processing_progress: file.processing_progress,
//           job_status: job ? job.status : "completed",
//           job_error: job ? job.error_message : null,
//           last_updated: file.updated_at,
//           chunks: formattedChunks,
//           summary: file.summary,
//         });
//       }
//     }

//     if (!job || !job.document_ai_operation_name) {
//       return res.json({
//         file_id: file.id,
//         status: file.status,
//         processing_progress: file.processing_progress,
//         job_status: "not_queued",
//         job_error: null,
//         last_updated: file.updated_at,
//         chunks: [],
//         summary: file.summary,
//       });
//     }

//     const status = await getOperationStatus(job.document_ai_operation_name);

//     if (!status.done) {
//       return res.json({
//         file_id: file.id,
//         status: "batch_processing",
//         processing_progress: file.processing_progress,
//         job_status: "running",
//         job_error: null,
//         last_updated: file.updated_at,
//       });
//     }

//     if (status.error) {
//       await File.updateProcessingStatus(file_id, "error", 0.0);
//       await ProcessingJob.updateJobStatus(job.job_id, "failed", status.error.message);
//       return res.status(500).json({
//         file_id: file.id,
//         status: "error",
//         processing_progress: 0.0,
//         job_status: "failed",
//         job_error: status.error.message,
//         last_updated: new Date().toISOString(),
//       });
//     }

//     const preProcessFile = await File.getFileById(file_id);
//     if (preProcessFile.status === "processing_locked") {
//       console.log(`[getFileProcessingStatus] 🔒 File ${file_id} is already being processed. Aborting duplicate trigger.`);
//       return res.json({
//         file_id: file.id,
//         status: "processing",
//         processing_progress: file.processing_progress,
//         job_status: "running",
//         job_error: null,
//         last_updated: file.updated_at,
//       });
//     }

//     await File.updateProcessingStatus(file_id, "processing_locked", 75.0);

//     const bucketName = fileOutputBucket.name;
//     let prefix = job.gcs_output_uri_prefix;
//     if (prefix.startsWith('gs://')) {
//       prefix = prefix.replace(`gs://${bucketName}/`, "");
//     }
//     if (!prefix.endsWith('/')) {
//       prefix += '/';
//     }
    
//     console.log(`[getFileProcessingStatus] Fetching results from bucket: ${bucketName}, prefix: ${prefix}`);
//     console.log(`[getFileProcessingStatus] Full output URI: ${job.gcs_output_uri_prefix}`);
    
//     const extractedBatchTexts = await fetchBatchResults(bucketName, prefix);

//     if (!extractedBatchTexts || extractedBatchTexts.length === 0) {
//       const errorDetails = {
//         file_id: file_id,
//         bucket: bucketName,
//         prefix: prefix,
//         output_uri: job.gcs_output_uri_prefix,
//         message: "Could not extract any meaningful text content from batch document. This may indicate: 1) Image-only PDF with no OCR text, 2) Corrupted document, 3) Document AI processing incomplete, or 4) JSON structure mismatch."
//       };
//       console.error(`[getFileProcessingStatus] ❌ Text extraction failed:`, errorDetails);
      
//       await File.updateProcessingStatus(file_id, "error", 0.0, "Text extraction failed: No text content found in Document AI results");
//       await ProcessingJob.updateJobStatus(job.job_id, "failed", errorDetails.message);
      
//       throw new Error(`Could not extract any meaningful text content from batch document. Check logs for details. Output URI: ${job.gcs_output_uri_prefix}`);
//     }
    
//     const nonEmptyTexts = extractedBatchTexts.filter(item => item.text && item.text.trim());
//     if (nonEmptyTexts.length === 0) {
//       console.error(`[getFileProcessingStatus] ❌ All extracted text segments are empty`);
//       const errorDetails = {
//         file_id: file_id,
//         total_segments: extractedBatchTexts.length,
//         message: "Document AI returned results but all text segments are empty. This may indicate an image-only PDF or OCR processing issue."
//       };
//       await File.updateProcessingStatus(file_id, "error", 0.0);
//       await ProcessingJob.updateJobStatus(job.job_id, "failed", errorDetails.message);
//       throw new Error(`All extracted text segments are empty. Total segments: ${extractedBatchTexts.length}`);
//     }
    
//     console.log(`[getFileProcessingStatus] ✅ Successfully extracted ${nonEmptyTexts.length} non-empty text segments from ${extractedBatchTexts.length} total segments`);

//     let batchChunkingMethod = "recursive"; // Default fallback
//     try {
//       const chunkMethodQuery = `
//         SELECT cm.method_name
//         FROM processing_jobs pj
//         LEFT JOIN secret_manager sm ON pj.secret_id = sm.id
//         LEFT JOIN chunking_methods cm ON sm.chunking_method_id = cm.id
//         WHERE pj.file_id = $1
//         ORDER BY pj.created_at DESC
//         LIMIT 1;
//       `;
//       const result = await pool.query(chunkMethodQuery, [file_id]);

//       if (result.rows.length > 0) {
//         batchChunkingMethod = result.rows[0].method_name;
//         console.log(`[getFileProcessingStatus] ✅ Using chunking method from DB: ${batchChunkingMethod}`);
//       } else {
//         console.log(`[getFileProcessingStatus] No secret_id found for file ${file_id}, using default chunking method.`);
//       }
//     } catch (err) {
//       console.error(`[getFileProcessingStatus] Error fetching chunking method: ${err.message}`);
//       console.log(`[getFileProcessingStatus] Falling back to default chunking method: recursive`);
//     }

//     const chunks = await chunkDocument(extractedBatchTexts, file_id, batchChunkingMethod || 'recursive');

//     if (chunks.length === 0) {
//       await File.updateProcessingStatus(file_id, "processed", 100.0);
//       await ProcessingJob.updateJobStatus(job.job_id, "completed");
//       const updatedFile = await File.getFileById(file_id);
//       return res.json({
//         file_id: updatedFile.id,
//         chunks: [],
//         summary: updatedFile.summary,
//         chunking_method: batchChunkingMethod,
//       });
//     }

//     const chunkContents = chunks.map((c) => c.content);
//     const embeddings = await generateEmbeddings(chunkContents);

//     const chunksToSaveBatch = chunks.map((chunk, i) => {
//       const page_start = chunk.metadata?.page_start !== null && chunk.metadata?.page_start !== undefined
//         ? chunk.metadata.page_start
//         : (chunk.page_start !== null && chunk.page_start !== undefined ? chunk.page_start : null);
//       const page_end = chunk.metadata?.page_end !== null && chunk.metadata?.page_end !== undefined
//         ? chunk.metadata.page_end
//         : (chunk.page_end !== null && chunk.page_end !== undefined ? chunk.page_end : null);
      
//       return {
//         file_id: file_id,
//         chunk_index: i,
//         content: chunk.content,
//         token_count: chunk.token_count,
//         page_start: page_start,
//         page_end: page_end || page_start, // Use page_start if page_end is null
//         heading: chunk.metadata?.heading || chunk.heading || null,
//       };
//     });

//     const savedChunksBatch = await FileChunk.saveMultipleChunks(chunksToSaveBatch);

//     const vectorsToSaveBatch = savedChunksBatch.map((savedChunk) => {
//       const originalChunkIndex = savedChunk.chunk_index;
//       const embedding = embeddings[originalChunkIndex];
//       return {
//         chunk_id: savedChunk.id,
//         embedding: embedding,
//         file_id: file_id,
//       };
//     });

//     await ChunkVector.saveMultipleChunkVectors(vectorsToSaveBatch);
//     await File.updateProcessingStatus(file_id, "processed", 100.0);
//     await ProcessingJob.updateJobStatus(job.job_id, "completed");

//     let summary = null;
//     try {
//       if (chunks.length > 0) {
//         summary = await getSummaryFromChunks(chunks.map(c => c.content));
//         await File.updateSummary(file_id, summary);
//       }
//     } catch (summaryError) {
//       console.warn(`⚠️ Could not generate summary for file ID ${file_id}:`, summaryError.message);
//     }

//     const updatedFile = await File.getFileById(file_id);
//     const fileChunks = await FileChunk.getChunksByFileId(file_id);

//     const formattedChunks = fileChunks.map((chunk) => ({
//       text: chunk.content,
//       metadata: {
//         page_start: chunk.page_start,
//         page_end: chunk.page_end,
//         heading: chunk.heading,
//       },
//     }));

//     return res.json({
//       file_id: updatedFile.id,
//       status: updatedFile.status,
//       processing_progress: updatedFile.processing_progress,
//       job_status: "completed",
//       job_error: null,
//       last_updated: updatedFile.updated_at,
//       chunks: formattedChunks,
//       summary: updatedFile.summary,
//       chunking_method: batchChunkingMethod,
//     });
//   } catch (error) {
//     console.error("❌ getFileProcessingStatus error:", error);
//     return res.status(500).json({
//       error: "Failed to fetch processing status.",
//       details: error.message,
//     });
//   }
// };

// function calculateCosineSimilarity(vectorA, vectorB) {
//   if (!vectorA || !vectorB || vectorA.length !== vectorB.length) {
//     return 0;
//   }

//   let dotProduct = 0;
//   let normA = 0;
//   let normB = 0;

//   for (let i = 0; i < vectorA.length; i++) {
//     dotProduct += vectorA[i] * vectorB[i];
//     normA += vectorA[i] * vectorA[i];
//     normB += vectorB[i] * vectorB[i];
//   }

//   normA = Math.sqrt(normA);
//   normB = Math.sqrt(normB);

//   if (normA === 0 || normB === 0) {
//     return 0;
//   }

//   return dotProduct / (normA * normB);
// }


// exports.getFolderChatSessionById = async (req, res) => {
//   try {
//     const { folderName, sessionId } = req.params;
//     const userId = req.user?.id;

//     console.log(`📖 [getFolderChatSessionById] Fetching session: ${sessionId} for folder: ${folderName}, user: ${userId}`);

//     if (!userId) {
//       return res.status(401).json({
//         error: "Unauthorized - user not found"
//       });
//     }

//     const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
//     if (!UUID_REGEX.test(sessionId)) {
//       return res.status(400).json({
//         error: "Invalid session ID format",
//         sessionId
//       });
//     }

//     const chatHistory = await FolderChat.findAll({
//       where: {
//         user_id: userId,
//         folder_name: folderName,
//         session_id: sessionId
//       },
//       order: [["created_at", "ASC"]],
//     });

//     console.log(`📖 [getFolderChatSessionById] Found ${chatHistory.length} chat(s) for session: ${sessionId}`);

//     if (chatHistory.length === 0) {
//       return res.status(404).json({
//         error: "Chat session not found",
//         folderName,
//         sessionId,
//         message: "No chats found for this session. It may have been deleted or doesn't exist."
//       });
//     }

//     const files = await File.findByUserIdAndFolderPath(userId, folderName);
//     const processedFiles = files.filter(f => !f.is_folder && f.status === "processed");

//     const protocol = req.protocol || 'http';
//     const host = req.get('host') || '';
//     const baseUrl = `${protocol}://${host}`;

//     const chatHistoryWithCitations = await Promise.all(
//       chatHistory.map(async (chat) => {
//         let citations = chat.citations || [];
        
//         if ((!citations || citations.length === 0) && chat.used_chunk_ids && chat.used_chunk_ids.length > 0) {
//           try {
//             const { extractCitationsFromChunks } = require('./intelligentFolderChatController');
            
//             const chunkIds = chat.used_chunk_ids;
//             const chunksQuery = `
//               SELECT 
//                 fc.id,
//                 fc.content,
//                 fc.page_start,
//                 fc.page_end,
//                 fc.file_id,
//                 uf.originalname AS filename
//               FROM file_chunks fc
//               JOIN user_files uf ON fc.file_id = uf.id
//               WHERE fc.id = ANY($1::bigint[])
//                 AND uf.user_id = $2
//               ORDER BY uf.originalname ASC, fc.page_start ASC;
//             `;
//             const { rows: chunks } = await pool.query(chunksQuery, [chunkIds, userId]);
            
//             if (chunks.length > 0) {
//               const formattedChunks = chunks.map(c => ({
//                 chunk_id: c.id,
//                 content: c.content,
//                 page_start: c.page_start,
//                 page_end: c.page_end,
//                 file_id: c.file_id,
//                 filename: c.filename,
//               }));
              
//               citations = await extractCitationsFromChunks(formattedChunks, baseUrl);
              
//               if (citations.length > 0) {
//                 await pool.query(
//                   `UPDATE folder_chats SET citations = $1::jsonb WHERE id = $2::uuid`,
//                   [JSON.stringify(citations), chat.id]
//                 );
//               }
//             }
//           } catch (citationError) {
//             console.error(`❌ Error generating citations for chat ${chat.id}:`, citationError);
//           }
//         }

//         return {
//           id: chat.id,
//           question: chat.used_secret_prompt ? `Analysis: ${chat.prompt_label || 'Secret Prompt'}` : chat.question,
//           response: chat.answer,
//           timestamp: chat.created_at,
//           documentIds: chat.summarized_file_ids || [],
//           usedChunkIds: chat.used_chunk_ids || [],
//           used_secret_prompt: chat.used_secret_prompt || false,
//           prompt_label: chat.prompt_label || null,
//           secret_id: chat.secret_id || null,
//           citations: citations || [], // ✅ Always return citations from database
//         };
//       })
//     );

//     return res.json({
//       success: true,
//       folderName,
//       sessionId,
//       chatHistory: chatHistoryWithCitations,
//       documentsInFolder: processedFiles.map(f => ({
//         id: f.id,
//         name: f.originalname,
//         status: f.status
//       })),
//       totalMessages: chatHistory.length
//     });
//   } catch (error) {
//     console.error("❌ getFolderChatSessionById error:", error);
//     console.error("❌ getFolderChatSessionById error stack:", error.stack);
//     res.status(500).json({
//       error: "Failed to fetch chat session",
//       details: error.message,
//       stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
//     });
//   }
// };

// exports.getFolderChatSessions = async (req, res) => {
//   try {
//     const { folderName } = req.params;
//     const userId = req.user?.id;

//     if (!userId) {
//       return res.status(401).json({ error: "Unauthorized: No user found in token" });
//     }

//     const chatHistory = await FolderChat.findAll({
//       where: {
//         user_id: userId,
//         folder_name: folderName
//       },
//       order: [["created_at", "ASC"]],
//     });

//     if (!chatHistory.length) {
//       return res.status(200).json({
//         success: true,
//         folderName,
//         sessions: [],
//         documentsInFolder: [],
//         totalSessions: 0,
//         totalMessages: 0
//       });
//     }

//     const sessions = {};
//     chatHistory.forEach(chat => {
//       if (!sessions[chat.session_id]) {
//         sessions[chat.session_id] = {
//           sessionId: chat.session_id,
//           messages: []
//         };
//       }
//       sessions[chat.session_id].messages.push({
//         id: chat.id,
//         question: chat.used_secret_prompt ? `Analysis: ${chat.prompt_label || 'Secret Prompt'}` : chat.question,
//         response: chat.answer,
//         timestamp: chat.created_at,
//         documentIds: chat.summarized_file_ids || [],
//         usedChunkIds: chat.used_chunk_ids || [],
//         used_secret_prompt: chat.used_secret_prompt || false,
//         prompt_label: chat.prompt_label || null,
//       });
//     });

//     const files = await File.findByUserIdAndFolderPath(userId, folderName);
//     const processedFiles = files.filter(f => !f.is_folder && f.status === "processed");

//     return res.json({
//       success: true,
//       folderName,
//       sessions: Object.values(sessions),
//       documentsInFolder: processedFiles.map(f => ({
//         id: f.id,
//         name: f.originalname,
//         status: f.status
//       })),
//       totalSessions: Object.keys(sessions).length,
//       totalMessages: chatHistory.length
//     });
//   } catch (error) {
//     console.error("❌ getFolderChatSessions error:", error);
//     res.status(500).json({
//       error: "Failed to fetch folder chat sessions",
//       details: error.message
//     });
//   }
// };

// exports.getChatCitations = async (req, res) => {
//   try {
//     const { folderName, chatId } = req.params;
//     const userId = req.user?.id;

//     if (!userId) {
//       return res.status(401).json({
//         error: "Unauthorized - user not found"
//       });
//     }

//     const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
//     if (!UUID_REGEX.test(chatId)) {
//       return res.status(400).json({
//         error: "Invalid chat ID format",
//         chatId
//       });
//     }

//     console.log(`📚 [getChatCitations] Fetching citations for chat: ${chatId}, folder: ${folderName}, user: ${userId}`);

//     const chatQuery = `
//       SELECT id, question, answer, used_chunk_ids, summarized_file_ids, folder_name
//       FROM folder_chats
//       WHERE id = $1::uuid AND user_id = $2 AND folder_name = $3;
//     `;
//     const { rows: chatRows } = await pool.query(chatQuery, [chatId, userId, folderName]);

//     if (chatRows.length === 0) {
//       return res.status(404).json({
//         error: "Chat message not found",
//         chatId,
//         folderName
//       });
//     }

//     const chat = chatRows[0];
    
//     let citations = chat.citations || [];
    
//     if ((!citations || citations.length === 0) && chat.used_chunk_ids && chat.used_chunk_ids.length > 0) {
//       console.log(`🔄 [getChatCitations] No citations in DB, generating from chunk IDs for chat ${chatId}`);
      
//       const protocol = req.protocol || 'http';
//       const host = req.get('host') || '';
//       const baseUrl = `${protocol}://${host}`;

//       const { extractCitationsFromChunks } = require('./intelligentFolderChatController');

//       const chunkIds = chat.used_chunk_ids;
//       const chunksQuery = `
//         SELECT 
//           fc.id,
//           fc.content,
//           fc.page_start,
//           fc.page_end,
//           fc.heading,
//           fc.file_id,
//           uf.originalname AS filename,
//           uf.mimetype
//         FROM file_chunks fc
//         JOIN user_files uf ON fc.file_id = uf.id
//         WHERE fc.id = ANY($1::bigint[])
//           AND uf.user_id = $2
//         ORDER BY uf.originalname ASC, fc.page_start ASC;
//       `;
//       const { rows: chunks } = await pool.query(chunksQuery, [chunkIds, userId]);

//       if (chunks.length > 0) {
//         const formattedChunks = chunks.map(c => ({
//           chunk_id: c.id,
//           content: c.content,
//           page_start: c.page_start,
//           page_end: c.page_end,
//           heading: c.heading,
//           file_id: c.file_id,
//           filename: c.filename,
//           mimetype: c.mimetype,
//         }));

//         citations = await extractCitationsFromChunks(formattedChunks, baseUrl);

//         if (citations.length > 0) {
//           await pool.query(
//             `UPDATE folder_chats SET citations = $1::jsonb WHERE id = $2::uuid`,
//             [JSON.stringify(citations), chat.id]
//           );
//           console.log(`💾 [getChatCitations] Saved ${citations.length} citations to database for chat ${chatId}`);
//         }
//       } else {
//         console.warn(`⚠️ [getChatCitations] No chunks found for IDs: ${chunkIds.join(', ')}`);
//       }
//     }
    
//     if (!chat.used_chunk_ids || chat.used_chunk_ids.length === 0) {
//       return res.status(200).json({
//         success: true,
//         chatId: chat.id,
//         question: chat.question,
//         citations: [],
//         message: "No chunks were used for this response (may have used Gemini Eyeball or context-based method)"
//       });
//     }

//     console.log(`✅ [getChatCitations] Returning ${citations.length} citations for chat ${chatId} (from DB: ${!!chat.citations})`);

//     return res.status(200).json({
//       success: true,
//       chatId: chat.id,
//       question: chat.question,
//       citations: citations || [],
//       chunks_used: chat.used_chunk_ids?.length || 0,
//       chunk_ids: chat.used_chunk_ids || [],
//       source: chat.citations ? 'database' : 'generated'
//     });

//   } catch (error) {
//     console.error("❌ getChatCitations error:", error);
//     console.error("❌ getChatCitations error stack:", error.stack);
//     return res.status(500).json({
//       error: "Failed to fetch chat citations",
//       details: error.message,
//       stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
//     });
//   }
// };

// exports.continueFolderChat = async (req, res) => {
//   let chatCost;
//   const userId = req.user.id;
//   const authorizationHeader = req.headers.authorization;

//   try {
//     const { folderName, sessionId } = req.params;
//     const {
//       question, // For custom queries
//       maxResults = 10,
//       used_secret_prompt = false, // NEW
//       prompt_label = null, // NEW
//       secret_id, // NEW
//       llm_name, // NEW
//       additional_input = '', // NEW
//     } = req.body;

//     if (!folderName) {
//       return res.status(400).json({ error: "folderName is required." });
//     }

//     console.log(`[continueFolderChat] Continuing session ${sessionId} for folder: ${folderName}`);
//     console.log(`[continueFolderChat] New question: ${question}`);
//     console.log(`[continueFolderChat] Used secret prompt: ${used_secret_prompt}, secret_id: ${secret_id}, llm_name: ${llm_name}`);

//     const { usage, plan, timeLeft } = await TokenUsageService.getUserUsageAndPlan(userId, authorizationHeader);

//     const existingChats = await FolderChat.findAll({
//       where: {
//         user_id: userId,
//         folder_name: folderName,
//         session_id: sessionId
//       },
//       order: [["created_at", "ASC"]],
//     });

//     if (existingChats.length === 0) {
//       return res.status(404).json({
//         error: "Chat session not found. Please start a new conversation.",
//         folderName,
//         sessionId
//       });
//     }

//     const conversationContext = formatFolderConversationHistory(existingChats);
//     const historyForStorage = simplifyFolderHistory(existingChats);
//     if (historyForStorage.length > 0) {
//       const lastTurn = historyForStorage[historyForStorage.length - 1];
//       console.log(
//         `[continueFolderChat] Using ${historyForStorage.length} prior turn(s) for context. Most recent: Q="${(lastTurn.question || '').slice(0, 120)}", A="${(lastTurn.answer || '').slice(0, 120)}"`
//       );
//     } else {
//       console.log('[continueFolderChat] No prior context for this session.');
//     }

//     const files = await File.findByUserIdAndFolderPath(userId, folderName);
//     const processedFiles = files.filter(f => !f.is_folder && f.status === "processed");

//     console.log(`[continueFolderChat] Found ${processedFiles.length} processed files in folder ${folderName}`);

//     if (processedFiles.length === 0) {
//       return res.status(404).json({
//         error: "No processed documents in folder",
//         sessionId,
//         chatHistory: existingChats.map(chat => ({
//           question: chat.question,
//           response: chat.response,
//           timestamp: chat.created_at
//         }))
//       });
//     }

//     let allChunks = [];
//     for (const file of processedFiles) {
//       const chunks = await FileChunk.getChunksByFileId(file.id);
//       const chunksWithFileInfo = chunks.map(chunk => ({
//         ...chunk,
//         filename: file.originalname,
//         file_id: file.id
//       }));
//       allChunks = allChunks.concat(chunksWithFileInfo);
//     }

//     console.log(`[continueFolderChat] Total chunks found: ${allChunks.length}`);

//     if (allChunks.length === 0) {
//       const answer = "The documents in this folder don't appear to have any processed content yet. Please wait for processing to complete or check the document processing status.";

//       const savedChat = await FolderChat.saveFolderChat(
//         userId,
//         folderName,
//         question,
//         answer,
//         sessionId,
//         processedFiles.map(f => f.id),
//         [], // usedChunkIds - will be populated by vector search
//         used_secret_prompt,
//         prompt_label,
//         secret_id,
//         historyForStorage
//       );

//       const newChatEntry = {
//         id: savedChat.id,
//         question,
//         answer,
//         created_at: savedChat.created_at,
//         used_secret_prompt,
//         prompt_label,
//       };

//       return res.json({
//         answer,
//         sources: [],
//         sessionId,
//         chatHistory: [...existingChats, newChatEntry].map(chat => ({
//           question: chat.question,
//           response: chat.answer,
//           timestamp: chat.created_at || chat.created_at,
//           used_secret_prompt: chat.used_secret_prompt || false,
//           prompt_label: chat.prompt_label || null,
//         })),
//         newMessage: {
//           question,
//           response: answer,
//           timestamp: savedChat.created_at
//         },
//         chat_history: savedChat.chat_history || [],
//       });
//     }

//     chatCost = Math.ceil(question.length / 100) + Math.ceil(allChunks.reduce((sum, c) => sum + c.content.length, 0) / 200) + Math.ceil(conversationContext.length / 200); // Question tokens + context tokens + history tokens

//     const requestedResources = { tokens: chatCost, ai_analysis: 1 };
//     const { allowed, message } = await TokenUsageService.enforceLimits(usage, plan, requestedResources);

//     if (!allowed) {
//       return res.status(403).json({
//         error: `AI chat failed: ${message}`,
//         timeLeftUntilReset: timeLeft
//       });
//     }

//     const questionLower = question.toLowerCase();
//     const questionWords = questionLower
//       .split(/\s+/)
//       .filter(word => word.length > 3 && !['what', 'where', 'when', 'how', 'why', 'which', 'this', 'that', 'these', 'those'].includes(word));

//     console.log(`[continueFolderChat] Question keywords:`, questionWords);

//     let relevantChunks = [];

//     if (questionWords.length > 0) {
//       relevantChunks = allChunks.map(chunk => {
//         const contentLower = chunk.content.toLowerCase();
//         let score = 0;

//         for (const word of questionWords) {
//           const regex = new RegExp(`\\b${word}\\b`, 'gi');
//           const matches = (contentLower.match(regex) || []).length;
//           score += matches * 2;
//         }

//         for (const word of questionWords) {
//           if (contentLower.includes(word)) {
//             score += 1;
//           }
//         }

//         return {
//           ...chunk,
//           similarity_score: score
//         };
//       })
//         .filter(chunk => chunk.similarity_score > 0)
//         .sort((a, b) => b.similarity_score - a.similarity_score)
//         .slice(0, maxResults);
//     } else {
//       const chunksPerDoc = Math.max(1, Math.floor(maxResults / processedFiles.length));
//       for (const file of processedFiles) {
//         const fileChunks = allChunks.filter(chunk => chunk.file_id === file.id);
//         const topChunks = fileChunks.slice(0, chunksPerDoc).map(chunk => ({
//           ...chunk,
//           similarity_score: 0.5
//         }));
//         relevantChunks = relevantChunks.concat(topChunks);
//       }
//     }

//     console.log(`[continueFolderChat] Found ${relevantChunks.length} relevant chunks`);

//     let provider;
//     if (used_secret_prompt && secret_id) {
//       const { resolveProviderName: resolveFolderProviderName } = require('../services/folderAiService');
//       const secretQuery = `
//         SELECT s.llm_id, l.name AS llm_name
//         FROM secret_manager s
//         LEFT JOIN llm_models l ON s.llm_id = l.id
//         WHERE s.id = $1
//       `;
//       const secretResult = await pool.query(secretQuery, [secret_id]);
//       const dbLlmName = secretResult.rows[0]?.llm_name;
//       provider = resolveFolderProviderName(llm_name || dbLlmName || 'gemini');
//     } else {
//       provider = 'claude-sonnet-4';
//       console.log(`🤖 Using Claude Sonnet 4 for custom query in continueFolderChat`);
//     }

//     const contextText = relevantChunks.map((chunk, index) =>
//       `[Document: ${chunk.filename} - Page ${chunk.page_start || 'N/A'}]\n${chunk.content.substring(0, 2000)}`
//     ).join("\n\n---\n\n");

//     let prompt = `
// You are an AI assistant continuing a conversation about documents in folder "${folderName}".

// CURRENT QUESTION: "${question}"

// RELEVANT DOCUMENT CONTENT:
// ${contextText}

// INSTRUCTIONS:
// 1. Consider the conversation history when answering the current question.
// 2. If the question refers to previous responses (e.g., "tell me more about that", "what else", "can you elaborate"), use the conversation context.
// 3. Provide a comprehensive answer based on both the conversation history and document content.
// 4. Use specific details, quotes, and examples from the documents when possible.
// 5. If information spans multiple documents, clearly indicate which documents contain what information.
// 6. Maintain conversational flow and reference previous parts of the conversation when relevant.
// 7. Be thorough and helpful - synthesize information across all relevant documents.
// `;

//     prompt = appendFolderConversation(prompt, conversationContext);

//     let answer = await askFolderLLMService(provider, prompt, '', contextText);
//     answer = ensurePlainTextAnswer(answer);
//     console.log(`[continueFolderChat] Generated answer length: ${answer.length} characters`);

//     const savedChat = await FolderChat.saveFolderChat(
//       userId,
//       folderName,
//       question,
//       answer,
//       sessionId,
//       processedFiles.map(f => f.id),
//       relevantChunks.map(c => c.id), // usedChunkIds
//       used_secret_prompt,
//       prompt_label,
//       secret_id,
//       historyForStorage
//     );

//     await TokenUsageService.incrementUsage(userId, requestedResources);

//     const sources = relevantChunks.map(chunk => ({
//       document: chunk.filename,
//       content: chunk.content.substring(0, 400) + (chunk.content.length > 400 ? "..." : ""),
//       page: chunk.page_start || 'N/A',
//       relevanceScore: chunk.similarity_score || 0
//     }));

//     const newChatEntry = {
//       id: savedChat.id,
//       question,
//       answer,
//       created_at: savedChat.created_at,
//       used_chunk_ids: relevantChunks.map(c => c.id),
//       used_secret_prompt,
//       prompt_label,
//     };

//     const fullChatHistory = [...existingChats, newChatEntry].map(chat => ({
//       question: chat.question,
//       response: chat.answer,
//       timestamp: chat.created_at,
//       usedChunkIds: chat.used_chunk_ids || [],
//       used_secret_prompt: chat.used_secret_prompt || false,
//       prompt_label: chat.prompt_label || null,
//     }));

//     return res.json({
//       answer,
//       sources,
//       sessionId,
//       folderName,
//       chatHistory: fullChatHistory,
//       newMessage: {
//         question,
//         response: answer,
//         timestamp: savedChat.created_at
//       },
//       documentsSearched: processedFiles.length,
//       chunksFound: relevantChunks.length,
//       totalMessages: fullChatHistory.length,
//       searchMethod: questionWords.length > 0 ? 'keyword_search' : 'document_sampling',
//       chat_history: savedChat.chat_history || [],
//     });

//   } catch (error) {
//     console.error("❌ continueFolderChat error:", error);
//     res.status(500).json({
//       error: "Failed to continue chat",
//       details: error.message
//     });
//   }
// };


// exports.deleteFolderChatSession = async (req, res) => {
//   try {
//     const { folderName, sessionId } = req.params;
//     const userId = req.user.id;

//     console.log(`🗑️ [deleteFolderChatSession] Deleting session: ${sessionId} for folder: ${folderName}, user: ${userId}`);

//     const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
//     const isValidUUID = UUID_REGEX.test(sessionId);
    
//     if (!isValidUUID) {
//       return res.status(400).json({
//         error: "Invalid session ID format",
//         sessionId,
//         message: "Session ID must be a valid UUID format (e.g., bc428ae4-ec0f-4e24-af70-e7c35d8db42a)"
//       });
//     }

//     const checkQuery = `
//       SELECT id, session_id, folder_name, created_at, question
//       FROM folder_chats
//       WHERE user_id = $1
//         AND session_id = $2::uuid
//       ORDER BY created_at DESC
//       LIMIT 10
//     `;
    
//     const checkResult = await pool.query(checkQuery, [userId, sessionId]);
//     console.log(`🗑️ [deleteFolderChatSession] Found ${checkResult.rows.length} chat(s) with session_id: ${sessionId}`);
    
//     if (checkResult.rows.length === 0) {
//       return res.status(404).json({
//         error: "Chat session not found",
//         folderName,
//         sessionId,
//         message: "No chats found with this session ID for your user account."
//       });
//     }
    
//     const normalizedFolderName = folderName.trim();
//     const matchingFolder = checkResult.rows.filter(row => 
//       row.folder_name && row.folder_name.trim().toLowerCase() === normalizedFolderName.toLowerCase()
//     );
    
//     console.log(`🗑️ [deleteFolderChatSession] Checking folder match:`);
//     console.log(`   - Requested folder: "${normalizedFolderName}"`);
//     console.log(`   - Found folders: ${[...new Set(checkResult.rows.map(r => r.folder_name))].join(', ')}`);
//     console.log(`   - Matching chats: ${matchingFolder.length}`);
    
//     if (matchingFolder.length === 0) {
//       const actualFolders = [...new Set(checkResult.rows.map(r => r.folder_name).filter(Boolean))];
//       return res.status(404).json({
//         error: "Chat session not found in this folder",
//         folderName: normalizedFolderName,
//         sessionId,
//         message: `Session exists but belongs to different folder(s): ${actualFolders.join(', ')}`,
//         availableFolders: actualFolders,
//         debug: {
//           requestedFolder: normalizedFolderName,
//           foundFolders: actualFolders
//         }
//       });
//     }
    
//     const deleteQuery = `
//       DELETE FROM folder_chats
//       WHERE user_id = $1
//         AND session_id = $2::uuid
//         AND LOWER(TRIM(folder_name)) = LOWER(TRIM($3))
//       RETURNING id, folder_name, question
//     `;

//     const result = await pool.query(deleteQuery, [userId, sessionId, normalizedFolderName]);
//     const deletedCount = result.rowCount || 0;

//     console.log(`🗑️ [deleteFolderChatSession] Deleted ${deletedCount} chat(s) for session: ${sessionId}`);

//     if (deletedCount === 0) {
//       return res.status(404).json({
//         error: "Chat session not found",
//         folderName: normalizedFolderName,
//         sessionId,
//         message: "No chats found for this session. It may have already been deleted or doesn't exist."
//       });
//     }

//     return res.json({
//       success: true,
//       message: `Deleted chat session with ${deletedCount} message(s)`,
//       folderName: normalizedFolderName,
//       sessionId,
//       deletedMessages: deletedCount,
//       deletedChats: result.rows.map(row => ({
//         id: row.id,
//         folder_name: row.folder_name,
//         question: row.question?.substring(0, 100) + (row.question?.length > 100 ? '...' : '')
//       }))
//     });
//   } catch (error) {
//     console.error("❌ deleteFolderChatSession error:", error);
//     console.error("❌ deleteFolderChatSession error stack:", error.stack);
//     res.status(500).json({
//       error: "Failed to delete chat session",
//       details: error.message,
//       stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
//     });
//   }
// };

// exports.deleteSingleFolderChat = async (req, res) => {
//   try {
//     const { folderName, chatId } = req.params;
//     const userId = req.user.id;

//     console.log(`🗑️ [deleteSingleFolderChat] Deleting chat: ${chatId} from folder: ${folderName}, user: ${userId}`);

//     const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
//     const isValidUUID = UUID_REGEX.test(chatId);
    
//     if (!isValidUUID) {
//       return res.status(400).json({
//         error: "Invalid chat ID format",
//         chatId,
//         message: "Chat ID must be a valid UUID format"
//       });
//     }

//     const checkQuery = `
//       SELECT id, folder_name, question, created_at
//       FROM folder_chats
//       WHERE id = $1::uuid
//         AND user_id = $2
//     `;
    
//     const checkResult = await pool.query(checkQuery, [chatId, userId]);
    
//     if (checkResult.rows.length === 0) {
//       return res.status(404).json({
//         error: "Chat not found",
//         chatId,
//         message: "Chat not found or you don't have permission to delete it."
//       });
//     }

//     const chat = checkResult.rows[0];
//     const normalizedFolderName = folderName.trim();
//     const chatFolderName = chat.folder_name?.trim() || '';

//     if (chatFolderName.toLowerCase() !== normalizedFolderName.toLowerCase()) {
//       return res.status(404).json({
//         error: "Chat not found in this folder",
//         chatId,
//         folderName: normalizedFolderName,
//         actualFolder: chatFolderName,
//         message: `Chat belongs to folder "${chatFolderName}", not "${normalizedFolderName}"`
//       });
//     }

//     const deleteQuery = `
//       DELETE FROM folder_chats
//       WHERE id = $1::uuid
//         AND user_id = $2
//         AND LOWER(TRIM(folder_name)) = LOWER(TRIM($3))
//       RETURNING id, folder_name, question
//     `;

//     const result = await pool.query(deleteQuery, [chatId, userId, normalizedFolderName]);
//     const deletedCount = result.rowCount || 0;

//     console.log(`🗑️ [deleteSingleFolderChat] Deleted ${deletedCount} chat(s) with id: ${chatId}`);

//     if (deletedCount === 0) {
//       return res.status(404).json({
//         error: "Chat not found",
//         chatId,
//         folderName: normalizedFolderName,
//         message: "Chat not found. It may have already been deleted or doesn't exist."
//       });
//     }

//     return res.json({
//       success: true,
//       message: "Chat deleted successfully",
//       folderName: normalizedFolderName,
//       chatId,
//       deletedChat: result.rows[0]
//     });

//   } catch (error) {
//     console.error("❌ deleteSingleFolderChat error:", error);
//     console.error("❌ deleteSingleFolderChat error stack:", error.stack);
//     res.status(500).json({
//       error: "Failed to delete chat",
//       details: error.message,
//       stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
//     });
//   }
// };




// exports.getFolderChatsByFolder = async (req, res) => {
//   try {
//     const { folderName } = req.params;
//     const userId = req.user.id; // assuming user is authenticated and middleware sets req.user

//     const chats = await FolderChat.getFolderChatHistory(userId, folderName);

//     res.status(200).json({
//       success: true,
//       folderName,
//       chats,
//     });
//   } catch (error) {
//     console.error("Error fetching folder chats:", error.message);
//     res.status(500).json({
//       success: false,
//       message: "Failed to fetch chats for folder",
//     });
//   }
// };

// exports.getDocumentsInFolder = async (req, res) => {
//   try {
//     const { folderName } = req.params;
//     const userId = req.user.id;

//     if (!folderName) {
//       return res.status(400).json({ error: "Folder name is required." });
//     }

//     const files = await File.findByUserIdAndFolderPath(userId, folderName);

//     const documents = files
//       .filter(file => !file.is_folder)
//       .map(file => ({
//         id: file.id,
//         name: file.originalname,
//         size: file.size,
//         mimetype: file.mimetype,
//         created_at: file.created_at,
//         status: file.status,
//         processing_progress: file.processing_progress,
//         folder_path: file.folder_path,
//       }));

//     return res.status(200).json({
//       message: `Documents in folder '${folderName}' fetched successfully.`,
//       folderName: folderName,
//       documents: documents,
//       totalDocuments: documents.length,
//     });
//   } catch (error) {
//     console.error("❌ Error fetching documents in folder:", error);
//     res.status(500).json({
//       error: "Internal server error",
//       details: error.message,
//     });
//   }
// };



// exports.getAllCases = async (req, res) => {
//   try {
//     const userId = parseInt(req.user?.id);
//     if (!userId) {
//       return res.status(401).json({ error: "Unauthorized user" });
//     }

//     const getAllCasesQuery = `
//       SELECT
//         c.*,
//         ct.name as case_type_name,
//         st.name as sub_type_name,
//         co.name as court_name_name
//       FROM cases c
//       LEFT JOIN case_types ct ON 
//         CASE 
//           WHEN c.case_type ~ '^[0-9]+$' THEN c.case_type::integer = ct.id
//           ELSE false
//         END
//       LEFT JOIN sub_types st ON 
//         CASE 
//           WHEN c.sub_type ~ '^[0-9]+$' THEN c.sub_type::integer = st.id
//           ELSE false
//         END
//       LEFT JOIN courts co ON 
//         CASE 
//           WHEN c.court_name ~ '^[0-9]+$' THEN c.court_name::integer = co.id
//           ELSE false
//         END
//       WHERE c.user_id = $1
//       ORDER BY c.created_at DESC;
//     `;
//     const { rows: cases } = await pool.query(getAllCasesQuery, [userId]);

//     const formattedCases = cases.map(caseData => {
//       caseData.case_type = caseData.case_type_name || caseData.case_type;
//       caseData.sub_type = caseData.sub_type_name || caseData.sub_type;
//       caseData.court_name = caseData.court_name_name || caseData.court_name;

//       delete caseData.case_type_name;
//       delete caseData.sub_type_name;
//       delete caseData.court_name_name;

//       try {
//         if (typeof caseData.judges === 'string' && caseData.judges.trim() !== '') {
//           caseData.judges = JSON.parse(caseData.judges);
//         } else if (caseData.judges === null) {
//           caseData.judges = []; // Default to empty array if null
//         }
//       } catch (e) {
//         console.warn(`⚠️ Could not parse judges JSON for case ${caseData.id}: ${e.message}. Value: ${caseData.judges}`);
//         caseData.judges = []; // Fallback to empty array on error
//       }
//       try {
//         if (typeof caseData.petitioners === 'string' && caseData.petitioners.trim() !== '') {
//           caseData.petitioners = JSON.parse(caseData.petitioners);
//         } else if (caseData.petitioners === null) {
//           caseData.petitioners = []; // Default to empty array if null
//         }
//       } catch (e) {
//         console.warn(`⚠️ Could not parse petitioners JSON for case ${caseData.id}: ${e.message}. Value: ${caseData.petitioners}`);
//         caseData.petitioners = []; // Fallback to empty array on error
//       }
//       try {
//         if (typeof caseData.respondents === 'string' && caseData.respondents.trim() !== '') {
//           caseData.respondents = JSON.parse(caseData.respondents);
//         } else if (caseData.respondents === null) {
//           caseData.respondents = []; // Default to empty array if null
//         }
//       } catch (e) {
//         console.warn(`⚠️ Could not parse respondents JSON for case ${caseData.id}: ${e.message}. Value: ${caseData.respondents}`);
//         caseData.respondents = []; // Fallback to empty array on error
//       }
//       return caseData;
//     });

//     return res.status(200).json({
//       message: "Cases fetched successfully.",
//       cases: formattedCases,
//       totalCases: formattedCases.length,
//     });
//   } catch (error) {
//     console.error("❌ Error fetching all cases:", error);
//     res.status(500).json({
//       error: "Internal server error",
//       details: error.message,
//     });
//   }
// };

// exports.getCaseFilesByFolderName = async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const username = req.user.username;
//     const { folderName } = req.params;

//     if (!folderName) {
//       return res.status(400).json({ error: "Folder name is required" });
//     }

//     console.log(`📂 [getCaseFilesByFolderName] User: ${username}, Folder: ${folderName}`);

//     const folderQuery = `
//       SELECT * FROM user_files
//       WHERE user_id = $1
//         AND is_folder = true
//         AND originalname = $2
//       ORDER BY created_at DESC
//       LIMIT 1;
//     `;
//     const { rows: folderRows } = await pool.query(folderQuery, [userId, folderName]);

//     if (folderRows.length === 0) {
//       console.warn(`⚠️ Folder "${folderName}" not found for user ${userId}`);
//       return res.status(404).json({
//         error: `Folder "${folderName}" not found for this user.`,
//       });
//     }

//     const folder = folderRows[0];
//     const folderPath = folder.folder_path; // ✅ Use the same folder_path stored during upload
//     console.log(`✅ Folder found. Using folder_path: ${folderPath}`);

//     const filesQuery = `
//       SELECT
//         id,
//         user_id,
//         originalname,
//         gcs_path,
//         folder_path,
//         mimetype,
//         size,
//         status,
//         processing_progress,
//         full_text_content,
//         summary,
//         edited_docx_path,
//         edited_pdf_path,
//         processed_at,
//         created_at,
//         updated_at,
//         is_folder
//       FROM user_files
//       WHERE user_id = $1
//         AND is_folder = false
//         AND folder_path = $2
//       ORDER BY created_at DESC;
//     `;
//     const { rows: files } = await pool.query(filesQuery, [userId, folderPath]);

//     if (files.length === 0) {
//       console.warn(`⚠️ No files found under folder_path: ${folderPath}`);
//       return res.status(200).json({
//         message: "Folder files fetched successfully, but no documents found.",
//         folder,
//         files: [],
//         debug: {
//           searched_folder_path: folderPath,
//           hint: "Check that uploaded files used the same folder_path value",
//         },
//       });
//     }

//     const filesWithUrls = await Promise.all(
//       files.map(async (file) => {
//         const previewUrl = await makeSignedReadUrl(file.gcs_path, 15);
//         const viewUrl = await makeSignedReadUrl(file.gcs_path, 60); // Longer expiry for viewing
//         return {
//           ...file,
//           previewUrl,
//           viewUrl, // Direct URL to open/view the document
//         };
//       })
//     );

//     console.log(`✅ Returning ${filesWithUrls.length} files for folder "${folderName}"`);

//     return res.status(200).json({
//       message: "Folder files fetched successfully.",
//       folder: {
//         id: folder.id,
//         name: folder.originalname,
//         folder_path: folder.folder_path,
//         gcs_path: folder.gcs_path,
//       },
//       files: filesWithUrls,
//     });

//   } catch (error) {
//     console.error("❌ getCaseFilesByFolderName error:", error);
//     return res.status(500).json({
//       error: "Internal server error",
//       details: error.message,
//     });
//   }
// };

// exports.getFilesForMindmap = async (req, res) => {
//   try {
//     const userId = req.user.id;
    
//     console.log(`[getFilesForMindmap] Fetching processed files for user: ${userId}`);
    
//     const query = `
//       SELECT 
//         id,
//         originalname,
//         size,
//         mimetype,
//         status,
//         processing_progress,
//         created_at,
//         processed_at
//       FROM user_files
//       WHERE user_id = $1
//         AND is_folder = false
//         AND status = 'processed'
//       ORDER BY created_at DESC
//     `;
    
//     const result = await pool.query(query, [userId]);
    
//     const files = result.rows.map(file => ({
//       id: file.id,
//       name: file.originalname,
//       size: file.size,
//       mimetype: file.mimetype,
//       status: file.status,
//       progress: file.processing_progress,
//       createdAt: file.created_at,
//       processedAt: file.processed_at
//     }));
    
//     console.log(`[getFilesForMindmap] Found ${files.length} processed files for user ${userId}`);
    
//     return res.status(200).json({
//       success: true,
//       files: files,
//       count: files.length
//     });
//   } catch (error) {
//     console.error('[getFilesForMindmap] Error:', error);
//     return res.status(500).json({
//       success: false,
//       error: 'Failed to fetch files for mindmap',
//       details: error.message
//     });
//   }
// };

// exports.viewDocument = async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const { fileId } = req.params;
//     const { expiryMinutes = 60 } = req.query; // Default 60 minutes

//     if (!fileId) {
//       return res.status(400).json({ error: "File ID is required" });
//     }

//     console.log(`👁️ [viewDocument] User: ${userId}, FileId: ${fileId}`);

//     const fileQuery = `
//       SELECT 
//         id,
//         user_id,
//         originalname,
//         gcs_path,
//         folder_path,
//         mimetype,
//         size,
//         status,
//         is_folder,
//         created_at
//       FROM user_files
//       WHERE id = $1 AND user_id = $2 AND is_folder = false;
//     `;
//     const { rows } = await pool.query(fileQuery, [fileId, userId]);

//     if (rows.length === 0) {
//       console.warn(`⚠️ File ${fileId} not found for user ${userId}`);
//       return res.status(404).json({
//         error: "Document not found or you don't have permission to access it.",
//       });
//     }

//     const file = rows[0];

//     const fileRef = bucket.file(file.gcs_path);
//     const [exists] = await fileRef.exists();

//     if (!exists) {
//       console.error(`❌ File ${file.gcs_path} not found in GCS`);
//       return res.status(404).json({
//         error: "Document file not found in storage.",
//       });
//     }

//     const viewUrl = await makeSignedReadUrl(file.gcs_path, parseInt(expiryMinutes));

//     const pageNumber = req.query.page ? parseInt(req.query.page, 10) : null;

//     console.log(`✅ Generated view URL for file: ${file.originalname}${pageNumber ? ` (page ${pageNumber})` : ''}`);

//     const finalViewUrl = viewUrl;
    
//     const viewUrlWithPage = pageNumber && file.mimetype === 'application/pdf' 
//       ? `${finalViewUrl}#page=${pageNumber}` 
//       : finalViewUrl;

//     return res.status(200).json({
//       success: true,
//       message: "Document view URL generated successfully.",
//       document: {
//         id: file.id,
//         name: file.originalname,
//         mimetype: file.mimetype,
//         size: file.size,
//         status: file.status,
//         folder_path: file.folder_path,
//         created_at: file.created_at,
//       },
//       viewUrl: finalViewUrl, // Base signed URL from GCS (use this for iframe/embed)
//       viewUrlWithPage: viewUrlWithPage, // URL with page hash for direct opening (PDFs)
//       signedUrl: finalViewUrl, // Alias for viewUrl
//       page: pageNumber || null, // Page number from query param (if provided)
//       usage: {
//         preview: "Use 'viewUrl' or 'signedUrl' to embed in iframe or open in new tab",
//         pageNavigation: pageNumber 
//           ? `Use 'viewUrlWithPage' to open directly at page ${pageNumber}. For other pages, append #page=N to viewUrl`
//           : "Append #page=N to viewUrl to navigate to specific page (PDFs only)",
//         example: pageNumber 
//           ? `window.open(data.viewUrlWithPage, '_blank') // Opens at page ${pageNumber}`
//           : `window.open(data.viewUrl + '#page=5', '_blank') // Opens at page 5`
//       },
//       expiresIn: `${expiryMinutes} minutes`,
//       expiresAt: new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString(),
//     });

//   } catch (error) {
//     console.error("❌ viewDocument error:", error);
//     return res.status(500).json({
//       error: "Internal server error",
//       details: error.message,
//     });
//   }
// };

// exports.streamDocument = async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const { fileId } = req.params;
//     const { download = false } = req.query; // Download vs inline viewing

//     if (!fileId) {
//       return res.status(400).json({ error: "File ID is required" });
//     }

//     console.log(`📥 [streamDocument] User: ${userId}, FileId: ${fileId}, Download: ${download}`);

//     const fileQuery = `
//       SELECT 
//         id,
//         user_id,
//         originalname,
//         gcs_path,
//         mimetype,
//         size,
//         is_folder
//       FROM user_files
//       WHERE id = $1 AND user_id = $2 AND is_folder = false;
//     `;
//     const { rows } = await pool.query(fileQuery, [fileId, userId]);

//     if (rows.length === 0) {
//       return res.status(404).json({
//         error: "Document not found or you don't have permission to access it.",
//       });
//     }

//     const file = rows[0];

//     const fileRef = bucket.file(file.gcs_path);
//     const [exists] = await fileRef.exists();

//     if (!exists) {
//       return res.status(404).json({
//         error: "Document file not found in storage.",
//       });
//     }

//     const [metadata] = await fileRef.getMetadata();

//     const contentDisposition = download === 'true' || download === true
//       ? `attachment; filename="${file.originalname}"`
//       : `inline; filename="${file.originalname}"`;

//     res.setHeader('Content-Type', file.mimetype || 'application/octet-stream');
//     res.setHeader('Content-Disposition', contentDisposition);
//     res.setHeader('Content-Length', metadata.size || file.size);
//     res.setHeader('Cache-Control', 'private, max-age=3600');

//     const readStream = fileRef.createReadStream();

//     readStream.on('error', (error) => {
//       console.error(`❌ Stream error for file ${fileId}:`, error);
//       if (!res.headersSent) {
//         res.status(500).json({
//           error: "Error streaming document",
//           details: error.message,
//         });
//       }
//     });

//     readStream.pipe(res);

//     console.log(`✅ Streaming file: ${file.originalname}`);

//   } catch (error) {
//     console.error("❌ streamDocument error:", error);
//     if (!res.headersSent) {
//       return res.status(500).json({
//         error: "Internal server error",
//         details: error.message,
//       });
//     }
//   }
// };

// exports.getFileComplete = async (req, res) => {
//   const userId = req.user.id;
//   const { file_id } = req.params;

//   try {
//     if (!userId) return res.status(401).json({ error: "Unauthorized" });
//     if (!file_id) return res.status(400).json({ error: "file_id is required" });

//     const file = await File.getFileById(file_id);
//     if (!file) {
//       return res.status(404).json({ error: "File not found" });
//     }

//     if (String(file.user_id) !== String(userId)) {
//       return res.status(403).json({ error: "Access denied" });
//     }

//     const chunks = await FileChunk.getChunksByFileId(file_id);

//     const chats = await FileChat.getChatHistory(file_id);

//     const processingJob = await ProcessingJob.getJobByFileId(file_id);

//     let folderChats = [];
//     if (file.folder_path) {
//       const folderName = file.folder_path.split('/').pop() || file.folder_path;
//       folderChats = await FolderChat.getFolderChatHistory(userId, folderName);
//     }

//     return res.status(200).json({
//       success: true,
//       file: {
//         id: file.id,
//         user_id: file.user_id,
//         originalname: file.originalname,
//         gcs_path: file.gcs_path,
//         folder_path: file.folder_path,
//         mimetype: file.mimetype,
//         size: file.size,
//         is_folder: file.is_folder,
//         status: file.status,
//         processing_progress: file.processing_progress,
//         current_operation: file.current_operation,
//         summary: file.summary,
//         full_text_content: file.full_text_content,
//         created_at: file.created_at,
//         updated_at: file.updated_at,
//         processed_at: file.processed_at
//       },
//       chunks: chunks.map(chunk => ({
//         id: chunk.id,
//         chunk_index: chunk.chunk_index,
//         content: chunk.content,
//         token_count: chunk.token_count,
//         page_start: chunk.page_start,
//         page_end: chunk.page_end,
//         heading: chunk.heading
//       })),
//       chats: chats.map(chat => ({
//         id: chat.id,
//         question: chat.question,
//         answer: chat.answer,
//         session_id: chat.session_id,
//         used_chunk_ids: chat.used_chunk_ids,
//         used_secret_prompt: chat.used_secret_prompt,
//         prompt_label: chat.prompt_label,
//         created_at: chat.created_at
//       })),
//       folder_chats: folderChats.map(chat => ({
//         id: chat.id,
//         question: chat.question,
//         answer: chat.answer,
//         session_id: chat.session_id,
//         created_at: chat.created_at
//       })),
//       processing_job: processingJob ? {
//         job_id: processingJob.job_id,
//         status: processingJob.status,
//         type: processingJob.type,
//         created_at: processingJob.created_at
//       } : null,
//       total_chunks: chunks.length,
//       total_chats: chats.length,
//       total_folder_chats: folderChats.length
//     });
//   } catch (error) {
//     console.error("❌ getFileComplete error:", error);
//     return res.status(500).json({ error: "Failed to retrieve file data" });
//   }
// };

// exports.getFolderChunks = async (req, res) => {
//   try {
//     const userId = req.user?.id;
//     const { folderName } = req.params;
//     const { fileId, page } = req.query; // Optional filters

//     if (!userId) {
//       return res.status(401).json({ error: "Unauthorized - user not found" });
//     }

//     if (!folderName) {
//       return res.status(400).json({ error: "folderName is required" });
//     }

//     console.log(`📄 [getFolderChunks] Fetching chunks for folder: ${folderName}, user: ${userId}`);

//     const folderPattern = `%${folderName}%`;
//     const filesQuery = `
//       SELECT id, originalname, folder_path, status, gcs_path, mimetype
//       FROM user_files
//       WHERE user_id = $1
//         AND is_folder = false
//         AND status = 'processed'
//         AND folder_path LIKE $2
//       ORDER BY created_at DESC;
//     `;
//     const { rows: files } = await pool.query(filesQuery, [userId, folderPattern]);

//     if (files.length === 0) {
//       return res.status(404).json({
//         error: "No processed documents found in this folder",
//         folder_name: folderName
//       });
//     }

//     console.log(`📄 [getFolderChunks] Found ${files.length} processed files in folder`);

//     const filesToProcess = fileId 
//       ? files.filter(f => f.id === fileId)
//       : files;

//     if (fileId && filesToProcess.length === 0) {
//       return res.status(404).json({
//         error: `File with ID ${fileId} not found in folder ${folderName}`
//       });
//     }

//     const allChunks = [];

//     for (const file of filesToProcess) {
//       const chunks = await FileChunk.getChunksByFileId(file.id);
      
//       for (const chunk of chunks) {
//         if (page) {
//           const pageNum = parseInt(page, 10);
//           if (chunk.page_start !== pageNum && chunk.page_end !== pageNum) {
//             if (!(chunk.page_start <= pageNum && chunk.page_end >= pageNum)) {
//               continue;
//             }
//           }
//         }

//         const chunkWithPageInfo = {
//           chunk_id: chunk.id,
//           chunk_index: chunk.chunk_index,
//           content: chunk.content,
//           token_count: chunk.token_count,
//           page: chunk.page_start || null, // Primary page number
//           page_start: chunk.page_start || null,
//           page_end: chunk.page_end || null,
//           page_range: chunk.page_start && chunk.page_end
//             ? (chunk.page_start === chunk.page_end 
//                 ? `Page ${chunk.page_start}` 
//                 : `Pages ${chunk.page_start}-${chunk.page_end}`)
//             : null,
//           heading: chunk.heading || null,
//           file_id: file.id,
//           filename: file.originalname,
//           file_mimetype: file.mimetype,
//         };

//         allChunks.push(chunkWithPageInfo);
//       }
//     }

//     allChunks.sort((a, b) => {
//       if (a.filename !== b.filename) {
//         return a.filename.localeCompare(b.filename);
//       }
//       const pageA = a.page_start || 0;
//       const pageB = b.page_start || 0;
//       if (pageA !== pageB) {
//         return pageA - pageB;
//       }
//       return (a.chunk_index || 0) - (b.chunk_index || 0);
//     });

//     console.log(`📄 [getFolderChunks] Returning ${allChunks.length} chunks from ${filesToProcess.length} file(s)`);

//     const chunksByFile = {};
//     for (const chunk of allChunks) {
//       if (!chunksByFile[chunk.file_id]) {
//         chunksByFile[chunk.file_id] = {
//           file_id: chunk.file_id,
//           filename: chunk.filename,
//           mimetype: chunk.file_mimetype,
//           chunks: []
//         };
//       }
//       chunksByFile[chunk.file_id].chunks.push(chunk);
//     }

//     return res.json({
//       success: true,
//       folder_name: folderName,
//       total_files: filesToProcess.length,
//       total_chunks: allChunks.length,
//       filters: {
//         fileId: fileId || null,
//         page: page ? parseInt(page, 10) : null
//       },
//       chunks: allChunks,
//       chunks_by_file: Object.values(chunksByFile),
//       statistics: {
//         files_with_chunks: Object.keys(chunksByFile).length,
//         chunks_with_pages: allChunks.filter(c => c.page_start !== null).length,
//         chunks_without_pages: allChunks.filter(c => c.page_start === null).length,
//         page_range: allChunks.length > 0 && allChunks.some(c => c.page_start !== null)
//           ? {
//               min: Math.min(...allChunks.filter(c => c.page_start !== null).map(c => c.page_start)),
//               max: Math.max(...allChunks.filter(c => c.page_start !== null).map(c => c.page_end || c.page_start))
//             }
//           : null
//       }
//     });

//   } catch (error) {
//     console.error("❌ getFolderChunks error:", error);
//     return res.status(500).json({
//       error: "Failed to retrieve folder chunks",
//       details: error.message
//     });
//   }
// };


require("dotenv").config();

const mime = require("mime-types");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const pool = require("../config/db");

const File = require("../models/File");
const FileChat = require("../models/FileChat");
const FileChunk = require("../models/FileChunk");
const ChunkVector = require("../models/ChunkVector");
const ProcessingJob = require("../models/ProcessingJob");
const FolderChat = require("../models/FolderChat");

const {
  uploadToGCS,
  getSignedUrl: getSignedUrlFromGCS, // Renamed to avoid conflict
  getSignedUploadUrl,
} = require("../services/gcsService");
const { getSignedUrl } = require("../services/folderService"); // Import from folderService
const { checkStorageLimit } = require("../utils/storage");
const { bucket } = require("../config/gcs");
// Using folderAiService for all AI operations in this project
const { askLLM: askFolderLLMService, streamLLM: streamFolderLLM, resolveProviderName: resolveFolderProviderName, getAvailableProviders: getFolderAvailableProviders, getSummaryFromChunks } = require("../services/folderAiService"); // Import askLLM, streamLLM, resolveProviderName, getAvailableProviders, and getSummaryFromChunks from folderAiService
// Legacy aiService import (only used for getSummaryFromChunks, now using folderAiService instead)
// const { askGemini, getSummaryFromChunks, askLLM, getAvailableProviders, resolveProviderName } = require("../services/aiService");
const summaryQueue = require("../utils/summaryQueue"); // Rate-limited queue for summary generation
const UserProfileService = require("../services/userProfileService");
const { extractText, detectDigitalNativePDF, extractTextFromPDFWithPages } = require("../utils/textExtractor");
const {
  extractTextFromDocument,
  batchProcessDocument,
  getOperationStatus,
  fetchBatchResults,
} = require("../services/documentAiService");
const { chunkDocument } = require("../services/chunkingService");
const { generateEmbedding, generateEmbeddings, generateEmbeddingsWithMeta, computeContentHash, getCachedEmbedding, cacheEmbedding } = require("../services/embeddingService");
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

function sanitizeName(name) {
  return String(name).trim().replace(/[^a-zA-Z0-9._-]/g, "_");
}

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

async function fetchCaseDataForFolder(userId, folderName) {
  try {
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

function getOperationName(progress, status) {
  if (status === "processed" || status === "completed") return "Completed";
  if (status === "error" || status === "failed") return "Failed";

  const p = parseFloat(progress) || 0;

  if (status === "batch_queued") {
    if (p < 5) return "Initializing document processing";
    if (p < 15) return "Uploading document to cloud storage";
    return "Preparing batch operation";
  }

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


const updateProgress = async (fileId, status, progress, operation = null) => {
  const currentOperation = operation || getOperationName(progress, status);

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


async function pollBatchProgress(fileId, jobId, operationName) {
  console.log(`[Batch Polling] 🔄 Starting progress polling for file: ${fileId}`);

  const maxPolls = 300; // 25 minutes max
  let pollCount = 0;
  let batchCompleted = false;

  const pollInterval = setInterval(async () => {
    try {
      pollCount++;

      const file = await File.getFileById(fileId);

      if (!file) {
        console.log(`[Batch Polling] ❌ File ${fileId} not found. Stopping.`);
        clearInterval(pollInterval);
        return;
      }

      if (file.status === "processing" || file.status === "processed") {
        console.log(`[Batch Polling] ✅ Status: ${file.status}. Stopping poll.`);
        clearInterval(pollInterval);
        return;
      }

      if (file.status === "error") {
        console.log(`[Batch Polling] ❌ Error detected. Stopping poll.`);
        clearInterval(pollInterval);
        return;
      }

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

        await updateProgress(fileId, "processing", 42.0, "OCR completed. Starting post-processing");

        const job = await ProcessingJob.getJobByFileId(fileId);

        if (!job) {
          console.error(`[Batch Polling] ❌ Job not found for file: ${fileId}`);
          clearInterval(pollInterval);
          return;
        }

        console.log(`[Batch Polling] 🚀 Triggering post-processing for file: ${fileId}`);

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

      const currentProgress = parseFloat(file.processing_progress) || 20;

      if (file.status === "batch_processing" && currentProgress < 42) {
        const newProgress = Math.min(currentProgress + 0.5, 41.5);
        await updateProgress(fileId, "batch_processing", newProgress);
      }

      if (pollCount >= maxPolls) {
        console.warn(`[Batch Polling] ⚠️ Max polls reached for file: ${fileId}`);
        await updateProgress(fileId, "error", 0, "Batch processing timeout");
        await ProcessingJob.updateJobStatus(jobId, "failed", "Processing timeout");
        clearInterval(pollInterval);
      }

    } catch (error) {
      console.error(`[Batch Polling] ❌ Error in poll #${pollCount}:`, error.message);
    }
  }, 5000); // Poll every 5 seconds
}


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
       
        extractedTexts = await extractTextFromPDFWithPages(fileBuffer);
       
        console.log(`[TEXT EXTRACTION] ✅ Successfully extracted ${extractedTexts.length} text segment(s) with page numbers`);
        if (extractedTexts.length > 0 && extractedTexts[0].page_start) {
          console.log(`[TEXT EXTRACTION] 📄 Page range: ${extractedTexts[0].page_start} - ${extractedTexts[0].page_end}`);
        }
       
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
         
          isDigitalNative = false;
          extractedTexts = [];
        } else {
          await updateProgress(fileId, "processing", 42, "Text extraction completed (digital-native PDF - pdf-parse)");
         
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

    if (!isDigitalNative) {
      console.log(`\n${"🔵".repeat(40)}`);
      console.log(`[TEXT EXTRACTION METHOD] 🔵 DOCUMENT AI OCR`);
      console.log(`[TEXT EXTRACTION METHOD] 📦 Using: Google Cloud Document AI`);
      console.log(`[TEXT EXTRACTION METHOD] 📄 File Type: ${isPDF ? 'Scanned PDF' : mimetype}`);
      console.log(`[TEXT EXTRACTION METHOD] 💰 Cost: Document AI pricing applies`);
      console.log(`[TEXT EXTRACTION METHOD] ⏱️ Speed: Processing time depends on file size`);
      console.log(`${"🔵".repeat(40)}\n`);

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

   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   


   
   
   
   
   
   
   
   
   
   
   
//     if (savedChunks.length !== chunksToSave.length) {
   
   
   
   
   
   
   
   
   
     
//       if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
     
   
//     if (validVectors.length !== vectorsToSave.length) {
   
   
//     if (savedVectors.length !== validVectors.length) {
   
   
   
   
   
   
   
   
   
   
     
       
//           console.error(`   ❌ WARNING: Chunks exist but NO embeddings found!`);
//           console.log(`   ✅ All chunks have embeddings!`);
   
   
   

async function processDigitalNativePDF(fileId, extractedTexts, userId, secretId, jobId) {
  try {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[processDigitalNativePDF] Starting processing for File ID: ${fileId}`);
    console.log(`${'='.repeat(80)}\n`);
   
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
   
    await updateProgress(fileId, "processing", 60, "Saving chunks to database");
   
    const chunksToSave = chunks.map((chunk, i) => {
      const page_start = chunk.metadata?.page_start !== null && chunk.metadata?.page_start !== undefined
        ? chunk.metadata.page_start
        : (chunk.page_start !== null && chunk.page_start !== undefined ? chunk.page_start : null);
      const page_end = chunk.metadata?.page_end !== null && chunk.metadata?.page_end !== undefined
        ? chunk.metadata.page_end
        : (chunk.page_end !== null && chunk.page_end !== undefined ? chunk.page_end : null);
     
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
   
    if (savedChunks.length !== chunksToSave.length) {
      console.error(`[processDigitalNativePDF] ❌ Chunk count mismatch: expected ${chunksToSave.length}, saved ${savedChunks.length}`);
      throw new Error(`Chunk save failed: expected ${chunksToSave.length}, got ${savedChunks.length}`);
    }
   
    const chunkIds = savedChunks.map(c => c.id);
    console.log(`[processDigitalNativePDF] 📋 Saved chunk IDs: ${chunkIds.slice(0, 5).join(', ')}${chunkIds.length > 5 ? `... (${chunkIds.length} total)` : ''}`);
   
    await updateProgress(fileId, "processing", 68, `${savedChunks.length} chunks saved`);
   
    await updateProgress(fileId, "processing", 70, "Generating embeddings");
   
    const chunkContents = chunks.map(c => c.content);
    console.log(`[processDigitalNativePDF] 🔄 Generating embeddings for ${chunkContents.length} chunks`);
   
    let embeddings;
    try {
      embeddings = await generateEmbeddings(chunkContents);
      console.log(`[processDigitalNativePDF] ✅ Generated ${embeddings.length} embeddings`);
     
      if (embeddings.length !== chunkContents.length) {
        console.error(`[processDigitalNativePDF] ❌ Embedding count mismatch: expected ${chunkContents.length}, got ${embeddings.length}`);
        throw new Error(`Embedding generation failed: expected ${chunkContents.length}, got ${embeddings.length}`);
      }
     
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
   
    await updateProgress(fileId, "processing", 76, "Saving vector embeddings");
   
    console.log(`[processDigitalNativePDF] 🔗 Mapping chunks to embeddings...`);
    const vectorsToSave = savedChunks.map((savedChunk, index) => {
      const originalChunkIndex = savedChunk.chunk_index;
      const embedding = embeddings[originalChunkIndex];
     
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
     
      if (savedVectors.length !== vectorsToSave.length) {
        console.error(`[processDigitalNativePDF] ❌ Vector count mismatch: expected ${vectorsToSave.length}, saved ${savedVectors.length}`);
        throw new Error(`Vector save failed: expected ${vectorsToSave.length}, got ${savedVectors.length}`);
      }
     
    } catch (vectorSaveError) {
      console.error(`[processDigitalNativePDF] ❌ Failed to save vectors:`, vectorSaveError.message);
      throw vectorSaveError;
    }
   
    const vectorIds = savedVectors.map(v => v.chunk_id);
    console.log(`[processDigitalNativePDF] 📋 Saved vector chunk IDs: ${vectorIds.slice(0, 5).join(', ')}${vectorIds.length > 5 ? `... (${vectorIds.length} total)` : ''}`);
   
    await updateProgress(fileId, "processing", 85, "Vector embeddings saved");
   
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
   
    await updateProgress(fileId, "processing", 86, "Generating document summary");
   
    let summary = null;
    try {
      if (chunks.length > 0) {
        const fullText = chunks.map(c => c.content).join("\n\n");
        if (fullText.length > 0) {
          // Use rate-limited queue to avoid API rate limits
          const chunkContents = chunks.map(c => c.content);
          summary = await summaryQueue.add(async () => {
            console.log(`[SummaryQueue] Processing summary for file ${fileId}`);
            return await getSummaryFromChunks(chunkContents);
          });
          await File.updateSummary(fileId, summary);
          console.log(`[processDigitalNativePDF] ✅ Generated and saved summary`);
        }
      }
    } catch (summaryError) {
      console.warn(`[processDigitalNativePDF] ⚠️ Summary generation failed: ${summaryError.message}`);
    }
   
    await updateProgress(fileId, "processing", 95, "Summary completed");
   
    await updateProgress(fileId, "processing", 98, "Finalizing processing");
   
    await File.updateProcessingStatus(fileId, "processed", 100, "Completed");
    await ProcessingJob.updateJobStatus(jobId, "completed");
   
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
async function processBatchResults(file_id, job) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`[POST-PROCESSING] Starting for File ID: ${file_id}`);
  console.log(`${"=".repeat(80)}\n`);

  try {
    const currentFile = await File.getFileById(file_id);
    console.log(`[POST-PROCESSING] Status: ${currentFile.status}, Progress: ${currentFile.processing_progress}%`);

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

    try {
      const plainText = extractedBatchTexts
        .map(segment => segment.text || '')
        .filter(text => text.trim())
        .join('\n\n');
     
      if (plainText && plainText.trim()) {
        console.log(`[Save Extracted Text] Saving plain text (${plainText.length} chars) to output bucket`);
       
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
    }

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

    await updateProgress(file_id, "processing", 49, `Starting ${chunkingMethod} chunking`);
    await smoothProgressIncrement(file_id, "processing", 50, 54, "Chunking document", 100);

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

    await updateProgress(file_id, "processing", 59, "Preparing embedding queue payload");
    const chunkContents = chunks.map(c => c.content);
    console.log(`[Embeddings] 🔄 Queueing ${chunkContents.length} chunks for background embedding`);
    await smoothProgressIncrement(file_id, "processing", 60, 66, "Collecting chunk metadata", 100);

    await updateProgress(file_id, "processing", 67, "Preparing database storage");

    const chunksToSave = chunks.map((chunk, i) => {
      const page_start = chunk.metadata?.page_start !== null && chunk.metadata?.page_start !== undefined
        ? chunk.metadata.page_start
        : (chunk.page_start !== null && chunk.page_start !== undefined ? chunk.page_start : null);
      const page_end = chunk.metadata?.page_end !== null && chunk.metadata?.page_end !== undefined
        ? chunk.metadata.page_end
        : (chunk.page_end !== null && chunk.page_end !== undefined ? chunk.page_end : null);
     
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

    await updateProgress(file_id, "processing", 79, "Preparing summary generation");

    const fullText = chunks.map(c => c.content).join("\n\n");
    let summary = null;

    try {
      if (fullText.length > 0) {
        await smoothProgressIncrement(file_id, "processing", 80, 86, "Generating AI summary", 150);

        // Use rate-limited queue to avoid API rate limits
        const chunkContents = chunks.map(c => c.content);
        summary = await summaryQueue.add(async () => {
          console.log(`[SummaryQueue] Processing summary for file ${file_id}`);
          return await getSummaryFromChunks(chunkContents);
        });
        await File.updateSummary(file_id, summary);

        console.log(`[Summary] ✅ Generated and saved`);
        await updateProgress(file_id, "processing", 88, "Summary saved");
      } else {
        await updateProgress(file_id, "processing", 88, "Summary skipped (empty content)");
      }
    } catch (summaryError) {
      console.warn(`⚠️ [Warning] Summary generation failed:`, summaryError.message);
      await updateProgress(file_id, "processing", 88, "Summary skipped (error)");
    }

    // Process embeddings synchronously (not in background)
    await updateProgress(file_id, "processing", 89, "Generating embeddings");
    console.log(`[Embeddings] Starting synchronous embedding generation for file ${file_id}`);

    // Helper function to parse cached embedding
    const parseCachedEmbedding = (raw) => {
      if (Array.isArray(raw)) return raw;
      if (typeof raw === 'string') {
        try {
          // Try JSON parse first
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed;
        } catch (e) {
          // If not JSON, try parsing as comma-separated string
          return raw.replace(/[\[\]]/g, '').split(',').map(x => parseFloat(x.trim())).filter(x => !isNaN(x));
        }
      }
      return null;
    };

    const vectors = [];
    const toEmbed = [];
    const cacheHits = [];

    // Check cache for each chunk
    for (const savedChunk of savedChunks) {
      const source = chunks[savedChunk.chunk_index];
      const hash = computeContentHash(source.content);
      const cached = await getCachedEmbedding(hash);

      if (cached && cached.embedding) {
        const embedding = parseCachedEmbedding(cached.embedding);
        if (embedding && Array.isArray(embedding) && embedding.length > 0) {
          vectors.push({ 
            chunk_id: savedChunk.id, 
            embedding, 
            file_id: file_id 
          });
          cacheHits.push(savedChunk.chunk_index);
          continue;
        }
      }

      toEmbed.push({
        chunkId: savedChunk.id,
        chunkIndex: savedChunk.chunk_index,
        content: source.content,
        tokenCount: source.token_count,
        hash,
      });
    }

    console.log(`[Embeddings] Cache hits: ${cacheHits.length}/${savedChunks.length}`);
    console.log(`[Embeddings] Processing ${toEmbed.length} chunks in batches`);

    // Process embeddings in batches
    if (toEmbed.length > 0) {
      const { BATCH_SIZE, PARALLEL_BATCHES } = require("../services/embeddingService");
      const totalBatches = Math.ceil(toEmbed.length / BATCH_SIZE);
      
      for (let batchStart = 0; batchStart < toEmbed.length; batchStart += BATCH_SIZE * PARALLEL_BATCHES) {
        const parallelPromises = [];
        
        // Create parallel batch processing promises
        for (let i = 0; i < PARALLEL_BATCHES && (batchStart + i * BATCH_SIZE) < toEmbed.length; i++) {
          const batchIndex = batchStart + i * BATCH_SIZE;
          const batch = toEmbed.slice(batchIndex, batchIndex + BATCH_SIZE);
          if (batch.length > 0) {
            const texts = batch.map((item) => item.content);
            parallelPromises.push(
              generateEmbeddingsWithMeta(texts).then(({ embeddings, model }) => ({
                embeddings,
                model,
                batch,
              }))
            );
          }
        }

        // Wait for all parallel batches to complete
        const batchResults = await Promise.all(parallelPromises);
        
        // Process results
        for (const { embeddings, model, batch } of batchResults) {
          if (!embeddings || embeddings.length !== batch.length) {
            throw new Error(`Embedding count mismatch (expected ${batch.length}, got ${embeddings?.length || 0})`);
          }

          embeddings.forEach((embedding, idx) => {
            const chunk = batch[idx];
            vectors.push({
              chunk_id: chunk.chunkId,
              embedding,
              file_id: file_id,
            });

            // Cache embedding (fire and forget)
            cacheEmbedding({
              hash: chunk.hash,
              embedding,
              model,
              tokenCount: chunk.tokenCount,
            }).catch(() => {});
          });

          const currentBatch = Math.floor(batchStart / BATCH_SIZE) + 1;
          const progress = 89 + Math.min(8, Math.round((currentBatch / totalBatches) * 10));
          await updateProgress(file_id, "processing", progress, `Generating embeddings (${currentBatch}/${totalBatches} batches)`);
          console.log(`[Embeddings] ✅ Processed batch ${currentBatch}/${totalBatches} (${batch.length} chunks)`);
        }
      }
    }

    // Save all vectors to database
    await updateProgress(file_id, "processing", 97, "Saving embeddings to database");
    console.log(`[Embeddings] Saving ${vectors.length} vectors to database`);
    
    await ChunkVector.saveMultipleChunkVectors(vectors);
    
    console.log(`[Embeddings] ✅ Saved ${vectors.length} vectors for file ${file_id}`);
    await updateProgress(file_id, "processed", 100, "Processing complete");
    await ProcessingJob.updateJobStatus(job.job_id, "completed");

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



//     if (!file_id) {


//     if (!file) {

//     if (String(file.user_id) !== String(req.user.id)) {












exports.createFolder = async (req, res) => {
  try {
    const { folderName, parentPath = '' } = req.body; // allow parent folder
    const userId = req.user.id;

    if (!folderName) {
      return res.status(400).json({ error: "Folder name is required" });
    }

    const cleanParentPath = parentPath ? parentPath.replace(/^\/+|\/+$/g, '') : '';
    const safeFolderName = sanitizeName(folderName.replace(/^\/+|\/+$/g, ''));

    const folderPath = cleanParentPath
      ? `${cleanParentPath}/${safeFolderName}`
      : safeFolderName;

    const gcsPath = `${userId}/documents/${folderPath}/`;

    await uploadToGCS(".keep", Buffer.from(""), gcsPath, false, "text/plain");

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





async function createFolderInternal(userId, folderName, parentPath = "") {
  try {
    if (!folderName) {
      throw new Error("Folder name is required");
    }

    const safeFolderName = sanitizeName(folderName.replace(/^\/+|\/+$/g, ""));

    const folderPath = parentPath ? `${parentPath}/${safeFolderName}` : safeFolderName;

    const gcsPath = `${userId}/documents/${folderPath}/`;

    await uploadToGCS(".keep", Buffer.from(""), gcsPath, false, "text/plain");

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



// exports.createCase = async (req, res) => {
//   const client = await pool.connect();

//   try {
//     const userId = parseInt(req.user?.id);
//     if (!userId) {
//       return res.status(401).json({ error: "Unauthorized user" });
//     }

//     const {
//       case_title,
//       case_number,
//       filing_date,
//       case_type,
//       sub_type,
//       court_name,
//       court_level,
//       bench_division,
//       jurisdiction,
//       state,
//       judges,
//       court_room_no,
//       petitioners,
//       respondents,
//       category_type,
//       primary_category,
//       sub_category,
//       complexity,
//       monetary_value,
//       priority_level,
//       status = "Active",
//     } = req.body;

//     if (!case_title || !case_type || !court_name) {
//       return res.status(400).json({
//         error: "Missing required fields: case_title, case_type, court_name",
//       });
//     }

//     await client.query("BEGIN");

//     const insertQuery = `
//       INSERT INTO cases (
//         user_id, case_title, case_number, filing_date, case_type, sub_type,
//         court_name, court_level, bench_division, jurisdiction, state, judges,
//         court_room_no, petitioners, respondents, category_type, primary_category,
//         sub_category, complexity, monetary_value, priority_level, status
//       )
//       VALUES (
//         $1, $2, $3, $4, $5, $6,
//         $7, $8, $9, $10, $11, $12,
//         $13, $14, $15, $16, $17,
//         $18, $19, $20, $21, $22
//       )
//       RETURNING *;
//     `;

//     const values = [
//       userId,
//       case_title,
//       case_number,
//       filing_date,
//       case_type,
//       sub_type,
//       court_name,
//       court_level,
//       bench_division,
//       jurisdiction,
//       state,
//       judges ? JSON.stringify(judges) : null,
//       court_room_no,
//       petitioners ? JSON.stringify(petitioners) : null,
//       respondents ? JSON.stringify(respondents) : null,
//       category_type,
//       primary_category,
//       sub_category,
//       complexity,
//       monetary_value,
//       priority_level,
//       status,
//     ];

//     const { rows: caseRows } = await client.query(insertQuery, values);
//     const newCase = caseRows[0];

//     const safeCaseName = sanitizeName(case_title);
//     const parentPath = `${userId}/cases`;
//     const folder = await createFolderInternal(userId, safeCaseName, parentPath);

//     const updateQuery = `
//       UPDATE cases
//       SET folder_id = $1
//       WHERE id = $2
//       RETURNING *;
//     `;
//     const { rows: updatedRows } = await client.query(updateQuery, [
//       folder.id,
//       newCase.id,
//     ]);
//     const updatedCase = updatedRows[0];

//     await client.query("COMMIT");

//     return res.status(201).json({
//       message: "Case created successfully with folder",
//       case: updatedCase,
//       folder,
//     });

//   } catch (error) {
//     await client.query("ROLLBACK");
//     console.error("❌ Error creating case:", error);
//     res.status(500).json({
//       error: "Internal server error",
//       details: error.message,
//     });
//   } finally {
//     client.release();
//   }
// };


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
      // state,  // REMOVED
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
      case_prefix,
      case_year,
      case_nature,
      next_hearing_date,
      document_type,
      filed_by,
      temp_folder_name, // Temporary folder name for file migration
    } = req.body;

    // Fields are now optional - allow case creation even if these fields are missing
    // Use default values if missing
    const finalCaseTitle = case_title || "Untitled Case";
    const finalCaseType = case_type || "";
    const finalCourtName = court_name || "";

    await client.query("BEGIN");

    const userIdInt = parseInt(userId, 10);
    if (isNaN(userIdInt)) {
      throw new Error(`Invalid user_id: ${userId}`);
    }

    const insertQuery = `
      INSERT INTO cases (
        user_id, case_title, case_number, filing_date, case_type, sub_type,
        court_name, court_level, bench_division, jurisdiction, judges,
        court_room_no, petitioners, respondents, category_type, primary_category,
        sub_category, complexity, monetary_value, priority_level, status,
        case_prefix, case_year, case_nature, next_hearing_date, document_type,
        filed_by
      )
      VALUES (
        $1::integer, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21,
        $22, $23, $24, $25, $26,
        $27
      )
      RETURNING *;
    `;

    const values = [
      userIdInt,
      finalCaseTitle,
      case_number || null,
      filing_date || null,
      finalCaseType,
      sub_type || null,
      finalCourtName,
      court_level,
      bench_division,
      jurisdiction,
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
      case_prefix,
      case_year ? parseInt(case_year) : null,
      case_nature,
      next_hearing_date,
      document_type,
      filed_by,
    ];

    const { rows: caseRows } = await client.query(insertQuery, values);
    const newCase = caseRows[0];

    // Use finalCaseTitle for folder name (handles empty case_title)
    const safeCaseName = sanitizeName(finalCaseTitle || "Untitled Case");
    const parentPath = `${userId}/cases`;
    const folder = await createFolderInternal(userId, safeCaseName, parentPath);

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

    // Step 4: Move files from temp folder to case folder if temp_folder_name is provided
    if (temp_folder_name) {
      console.log(`📁 Moving files from temp folder "${temp_folder_name}" to case folder "${folder.folder_path}"`);
      
      try {
        // Find files by temp folder_path (no folder record exists, just find files by folder_path string)
        const tempFiles = await File.findByUserIdAndFolderPath(userId, temp_folder_name);
        const documents = tempFiles.filter(f => !f.is_folder); // No folder record, just filter files

        if (documents.length > 0) {
          console.log(`  📄 Found ${documents.length} file(s) to move from temp folder_path "${temp_folder_name}"`);

          // Move each file from temp folder to case folder in GCS
          for (const doc of documents) {
            const oldGcsPath = doc.gcs_path;
            const fileName = path.basename(oldGcsPath);
            const newGcsPath = `${folder.gcs_path}${fileName}`;

            try {
              // Check if file exists in GCS
              const oldFile = bucket.file(oldGcsPath);
              const [exists] = await oldFile.exists();
              
              if (exists) {
                // Copy file to new location
                const newFile = bucket.file(newGcsPath);
                await oldFile.copy(newFile);
                console.log(`  ✅ Copied ${fileName} from ${oldGcsPath} to ${newGcsPath}`);

                // Update file record in database
                await client.query(
                  `UPDATE user_files SET gcs_path = $1, folder_path = $2 WHERE id = $3::uuid AND user_id = $4`,
                  [newGcsPath, folder.folder_path, doc.id, userId]
                );
                console.log(`  ✅ Updated file record ${doc.id} with new folder_path`);

                // Delete old file from temp location (optional - keep for now, can be cleaned up later)
                // await oldFile.delete().catch(err => console.warn(`⚠️ Failed to delete old file: ${err.message}`));
              } else {
                console.warn(`  ⚠️ File not found in GCS: ${oldGcsPath}`);
              }
            } catch (fileError) {
              console.error(`  ❌ Error moving file ${doc.originalname}:`, fileError.message);
              // Continue with other files even if one fails
            }
          }

          // Delete temp files from GCS after copying (optional - can keep for backup)
          // Uncomment if you want to delete temp files from GCS after moving:
          /*
          for (const doc of documents) {
            try {
              const oldFile = bucket.file(doc.gcs_path);
              await oldFile.delete();
              console.log(`  🗑️ Deleted temp file from GCS: ${doc.gcs_path}`);
            } catch (deleteError) {
              console.warn(`  ⚠️ Failed to delete temp file:`, deleteError.message);
            }
          }
          */

          console.log(`  ✅ File migration complete. Temp folder_path "${temp_folder_name}" cleaned up.`);
        } else {
          console.log(`  ℹ️ No files found with temp folder_path "${temp_folder_name}"`);
        }
      } catch (moveError) {
        console.error(`❌ Error moving files from temp folder:`, moveError.message);
        // Don't fail case creation if file move fails - files are already in temp folder
        // They can be manually moved or cleaned up later
      }
    }

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

    const getCaseQuery = `SELECT folder_id FROM cases WHERE id = $1 AND user_id = $2;`;
    const { rows: caseRows } = await client.query(getCaseQuery, [caseId, userId]);

    if (caseRows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Case not found or not authorized." });
    }

    const folderId = caseRows[0].folder_id;

    const deleteCaseQuery = `DELETE FROM cases WHERE id = $1 AND user_id = $2 RETURNING *;`;
    const { rows: deletedCaseRows } = await client.query(deleteCaseQuery, [caseId, userId]);

    if (deletedCaseRows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Case not found or not authorized." });
    }

    if (folderId) {
      const getFolderQuery = `SELECT gcs_path FROM user_files WHERE id = $1::uuid AND user_id = $2 AND is_folder = TRUE;`;
      const { rows: folderRows } = await client.query(getFolderQuery, [folderId, userId]);

      if (folderRows.length > 0) {
        const gcsPath = folderRows[0].gcs_path;
        await bucket.deleteFiles({
          prefix: gcsPath,
        });
        console.log(`🗑️ Deleted GCS objects with prefix: ${gcsPath}`);
      }

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



exports.getCase = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { caseId } = req.params;

    if (!userId) return res.status(401).json({ error: "Unauthorized user" });
    if (!caseId) return res.status(400).json({ error: "Case ID is required." });

    const caseQuery = `
      SELECT * FROM cases
      WHERE id = $1 AND user_id = $2;
    `;
    const { rows: caseRows } = await pool.query(caseQuery, [caseId, userId]);
    if (caseRows.length === 0) {
      return res.status(404).json({ error: "Case not found or not authorized." });
    }

    const caseData = caseRows[0];

    const folderQuery = `
      SELECT *
      FROM user_files
      WHERE user_id = $1
        AND is_folder = true
        AND folder_path LIKE $2
      ORDER BY created_at ASC
      LIMIT 1;
    `;
    const folderPathPattern = `%${caseData.case_title}%`;
    const { rows: folderRows } = await pool.query(folderQuery, [userId, folderPathPattern]);

    const folders = folderRows.map(folder => ({
      id: folder.id,
      name: folder.originalname,
      folder_path: folder.folder_path,
      created_at: folder.created_at,
      updated_at: folder.updated_at,
      children: [], // Files will be fetched when user opens this folder
    }));

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

    const folders = files
      .filter(file => file.is_folder)
      .map(folder => ({
        id: folder.id,
        name: folder.originalname,
        folder_path: folder.folder_path,
        created_at: folder.created_at,
      }));

    const actualFiles = files.filter(file => !file.is_folder);

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



exports.generateUploadUrl = async (req, res) => {
  try {
    const userId = req.user.id;
    const { folderName } = req.params;
    const { filename, mimetype, size } = req.body;

    if (!filename) {
      return res.status(400).json({ error: "Filename is required" });
    }

    if (!size) {
      return res.status(400).json({
        error: "File size is required. Please provide the file size in bytes."
      });
    }

    const authorizationHeader = req.headers.authorization;
    const { plan: userPlan } = await TokenUsageService.getUserUsageAndPlan(userId, authorizationHeader);
   
    const fileSizeBytes = typeof size === 'string' ? parseInt(size, 10) : Number(size);
   
    if (isNaN(fileSizeBytes) || fileSizeBytes <= 0) {
      return res.status(400).json({
        error: "Invalid file size. Please provide a valid file size in bytes."
      });
    }
   
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

exports.completeSignedUpload = async (req, res) => {
  try {
    const userId = req.user.id;
    const { folderName } = req.params;
    const { gcsPath, filename, mimetype, size, secret_id } = req.body;

    if (!gcsPath || !filename || !size) {
      return res.status(400).json({ error: "gcsPath, filename, and size are required" });
    }

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

    const fileRef = bucket.file(gcsPath);
    const [exists] = await fileRef.exists();
    if (!exists) {
      return res.status(404).json({ error: "File not found in storage. Upload may have failed." });
    }

    const authorizationHeader = req.headers.authorization;
    const { usage: userUsage, plan: userPlan } = await TokenUsageService.getUserUsageAndPlan(userId, authorizationHeader);
   
    const [metadata] = await fileRef.getMetadata();
    const actualFileSize = parseInt(metadata.size) || parseInt(size);
   
    const fileSizeBytes = typeof actualFileSize === 'string' ? parseInt(actualFileSize, 10) : Number(actualFileSize);
   
    if (isNaN(fileSizeBytes) || fileSizeBytes <= 0) {
      await fileRef.delete().catch(err => console.error("Failed to delete file:", err));
      return res.status(400).json({
        error: "Invalid file size. Unable to determine file size."
      });
    }
   
    const fileSizeCheck = TokenUsageService.checkFreeTierFileSize(fileSizeBytes, userPlan);
    if (!fileSizeCheck.allowed) {
      console.log(`\n${'🆓'.repeat(40)}`);
      console.log(`[FREE TIER] File upload REJECTED - actual file size exceeds limit`);
      console.log(`[FREE TIER] File: ${filename}`);
      console.log(`[FREE TIER] Actual file size from GCS: ${(fileSizeBytes / (1024 * 1024)).toFixed(2)} MB`);
      console.log(`[FREE TIER] Max allowed: ${fileSizeCheck.maxSizeMB || 10} MB`);
      console.log(`[FREE TIER] 🗑️ Deleting file from GCS...`);
      console.log(`${'🆓'.repeat(40)}\n`);
     
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
      await fileRef.delete().catch(err => console.error("Failed to delete file:", err));
      return res.status(403).json({ error: storageLimitCheck.message });
    }

    const { DOCUMENT_UPLOAD_COST_TOKENS } = require("../middleware/checkTokenLimits");
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
      await fileRef.delete().catch(err => console.error("Failed to delete file:", err));
      return res.status(403).json({
        success: false,
        message: limitCheck.message,
        nextRenewalTime: limitCheck.nextRenewalTime,
        remainingTime: limitCheck.remainingTime,
      });
    }

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
      await fileRef.delete().catch(err => console.error("Failed to delete file after DB error:", err));
      return res.status(500).json({
        error: "Failed to save file metadata to database",
        details: dbError.message
      });
    }

    try {
      await TokenUsageService.incrementUsage(userId, requestedResources, userPlan);
      console.log(`✅ [completeSignedUpload] Usage incremented successfully`);
    } catch (usageError) {
      console.error(`⚠️ [completeSignedUpload] Failed to increment usage (non-critical):`, usageError.message);
    }

    const [fileBuffer] = await fileRef.download();

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

    let folderPathForFiles = folderRow.folder_path;

    console.log(`📁 Found folder. Database folder_path: ${folderPathForFiles}`);
    console.log(`📁 GCS path: ${folderRow.gcs_path}`);

    const authorizationHeader = req.headers.authorization;
    const { plan: userPlan } = await TokenUsageService.getUserUsageAndPlan(userId, authorizationHeader);

    const uploadedFiles = [];
    for (const file of req.files) {
      const fileSizeBytes = typeof file.size === 'string' ? parseInt(file.size, 10) : Number(file.size);
     
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

        const key = `${folderRow.gcs_path}${safeName}`;
        const uniqueKey = await ensureUniqueKey(key);

        console.log(`📄 Uploading file: ${safeName} to ${uniqueKey}`);

        const fileRef = bucket.file(uniqueKey);
        await fileRef.save(file.buffer, {
          resumable: false,
          metadata: { contentType: file.mimetype },
        });

        console.log(`✅ File uploaded to GCS: ${uniqueKey}`);

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
          await fileRef.delete().catch(err => console.error("Failed to delete file after DB error:", err));
          throw dbError; // Re-throw to be caught by outer try-catch
        }

        const previewUrl = await makeSignedReadUrl(uniqueKey, 15);

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

    const fileRef = bucket.file(gcsPath);
    const [exists] = await fileRef.exists();

    if (exists) {
      await fileRef.delete();
      console.log(`✅ GCS file deleted: ${gcsPath}`);
    } else {
      console.warn(`⚠️ File not found in GCS: ${gcsPath}`);
    }

    await pool.query(`DELETE FROM user_files WHERE id = $1`, [fileId]);
    console.log(`✅ DB record deleted for file ID: ${fileId}`);

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
exports.getFolderSummary = async (req, res) => {
  const userId = req.user.id;
  const authorizationHeader = req.headers.authorization;

  try {
    const { folderName } = req.params;

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

    const summaryCost = Math.ceil(combinedText.length / 200); // Rough estimate

    const requestedResources = { tokens: summaryCost, ai_analysis: 1 };
    const { allowed, message } = await TokenUsageService.enforceLimits(usage, plan, requestedResources);

    if (!allowed) {
      return res.status(403).json({
        error: `Summary generation failed: ${message}`,
        timeLeftUntilReset: timeLeft
      });
    }

    const summary = await getSummaryFromChunks(combinedText);

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




//     let used_secret_prompt = !!secret_id; // If secret_id is present, it's a secret prompt

//     if (!folderName) {










//       if (!secret_id)








//       if (!secretValue?.trim()) {










//       if (!question?.trim())






//       if (!allowed) {








//     if (!answer?.trim()) {



//     if (chatCost && !used_secret_prompt) {



//     let used_secret_prompt = !!secret_id;

//     if (!folderName) {













//       if (!secret_id)








//       if (!secretValue?.trim()) {












//       if (!question?.trim())





//       if (!allowed) {










//     if (!answer?.trim()) {



//     if (chatCost && !used_secret_prompt) {





//     let used_secret_prompt = !!secret_id;

//     if (!folderName) {









//       if (!chunksByFile[chunk.file_id]) {




//       if (!secret_id)








//       if (!secretValue?.trim()) {













//       if (!question?.trim())





//       if (!allowed) {











//     if (!answer?.trim()) {



//     if (chatCost && !used_secret_prompt) {


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

  const targetedKeywords = [
    'specific section', 'find where', 'locate', 'search for',
    'what does it say about', 'mention of', 'reference to',
    'clause', 'paragraph', 'page', 'section'
  ];

  const needsFullDoc = fullDocumentKeywords.some(keyword =>
    queryLower.includes(keyword)
  );

  const isTargeted = targetedKeywords.some(keyword =>
    queryLower.includes(keyword)
  );

  const isShortQuestion = question.trim().split(' ').length <= 5;

  const isBroadQuestion = /^(what|who|when|where|why|how)\s/i.test(queryLower) &&
    !isTargeted;

  return {
    needsFullDocument: needsFullDoc || (isBroadQuestion && !isTargeted) || isShortQuestion,
    threshold: needsFullDoc ? 0.0 : (isTargeted ? 0.80 : 0.75),
    strategy: needsFullDoc ? 'FULL_DOCUMENT' : 'TARGETED_RAG',
    reason: needsFullDoc ? 'Query requires comprehensive analysis' : 'Query is specific/targeted'
  };
}

function selectRepresentativeChunks(allChunks, files, maxContextChars) {
  if (!allChunks || allChunks.length === 0) return [];

  const chunksByFile = {};
  for (const chunk of allChunks) {
    const fileId = chunk.file_id || chunk.filename || 'unknown';
    if (!chunksByFile[fileId]) {
      chunksByFile[fileId] = [];
    }
    chunksByFile[fileId].push(chunk);
  }

  const fileCount = Object.keys(chunksByFile).length;
  const targetCharsPerFile = Math.floor(maxContextChars / fileCount);

  const selectedChunks = [];
  let totalChars = 0;

  for (const fileId in chunksByFile) {
    const fileChunks = chunksByFile[fileId].sort((a, b) => (a.chunk_index || 0) - (b.chunk_index || 0));
    const totalFileChars = fileChunks.reduce((sum, c) => sum + ((c.content || '').length || 0), 0);

    if (totalFileChars <= targetCharsPerFile) {
      selectedChunks.push(...fileChunks);
      totalChars += totalFileChars;
    } else {
      const targetChunks = Math.max(5, Math.floor((targetCharsPerFile / totalFileChars) * fileChunks.length));

      if (targetChunks >= fileChunks.length) {
        selectedChunks.push(...fileChunks);
        totalChars += totalFileChars;
      } else {
        const step = Math.floor(fileChunks.length / targetChunks);
        const selected = [];

        selected.push(fileChunks[0]);

        for (let i = step; i < fileChunks.length - 1; i += step) {
          if (selected.length < targetChunks - 1) {
            selected.push(fileChunks[i]);
          }
        }

        if (selected.length < targetChunks && fileChunks.length > 1) {
          selected.push(fileChunks[fileChunks.length - 1]);
        }

        selected.sort((a, b) => (a.chunk_index || 0) - (b.chunk_index || 0));

        let fileChars = 0;
        const trimmedSelected = [];
        for (const chunk of selected) {
          const chunkLength = (chunk.content || '').length;
          if (fileChars + chunkLength <= targetCharsPerFile) {
            trimmedSelected.push(chunk);
            fileChars += chunkLength;
          } else {
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

    if (totalChars >= maxContextChars) {
      break;
    }
  }

  selectedChunks.sort((a, b) => {
    if ((a.filename || '') !== (b.filename || '')) {
      return (a.filename || '').localeCompare(b.filename || '');
    }
    return (a.chunk_index || 0) - (b.chunk_index || 0);
  });

  return selectedChunks;
}

function isMetadataQuery(question) {
  if (!question || typeof question !== 'string') return null;

  const queryLower = question.toLowerCase();

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

    const { usage, plan, timeLeft } = await TokenUsageService.getUserUsageAndPlan(
      userId,
      authorizationHeader
    );

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

    if (question && !used_secret_prompt) {
      const metadataQuery = isMetadataQuery(question);
      if (metadataQuery) {
        console.log(`📊 Detected metadata query: ${metadataQuery.type}`);

        if (metadataQuery.type === 'file_count') {
          const answer = `There are **${files.length}** processed file(s) in the "${folderName}" folder/case project.`;

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

    const caseData = await fetchCaseDataForFolder(userId, folderName);
    const caseContext = caseData ? formatCaseDataAsContext(caseData) : '';

    let previousChats = [];
    if (hasExistingSession) {
      previousChats = await FolderChat.getFolderChatHistory(userId, folderName, finalSessionId);
    }
    const conversationContext = formatFolderConversationHistory(previousChats);
    const historyForStorage = simplifyFolderHistory(previousChats);

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

    if (used_secret_prompt) {
      if (!secret_id) {
        return res.status(400).json({ error: "secret_id is required for secret prompts." });
      }

      console.log(`\n${'='.repeat(80)}`);
      console.log(`🔐 PROCESSING SECRET PROMPT (ID: ${secret_id})`);
      console.log(`${'='.repeat(80)}\n`);

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

      provider = resolveFolderProviderName(llm_name || dbLlmName || "gemini");
      console.log(`🤖 LLM Provider Resolution:`);
      console.log(`   Input LLM Name: ${llm_name || dbLlmName || 'none (defaulting to gemini)'}`);
      console.log(`   Resolved Provider: ${provider}\n`);

      const isGeminiProvider = provider.toLowerCase().includes('gemini');
      console.log(`🔍 Provider Type Check: ${isGeminiProvider ? '✅ Gemini' : '❌ Non-Gemini'}\n`);

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

      if (templateData.hasTemplates) {
        secretValue = buildEnhancedSystemPromptWithTemplates(secretValue, templateData);
        console.log(`✅ Enhanced prompt built with template examples`);
        console.log(`   Enhanced prompt length: ${secretValue.length} characters\n`);
       
        // Add JSON formatting instructions if output template exists
        const inputTemplate = templateData?.inputTemplate || null;
        const outputTemplate = templateData?.outputTemplate || null;
        if (outputTemplate && outputTemplate.extracted_text) {
          const { addSecretPromptJsonFormatting } = require('./secretManagerController');
          const jsonFormatting = addSecretPromptJsonFormatting('', inputTemplate, outputTemplate);
          if (jsonFormatting.trim()) {
            secretValue += jsonFormatting;
            console.log(`✅ Added JSON formatting instructions to prompt\n`);
          }
        }
      }

      const secretQueryAnalysis = analyzeQueryIntent(secretValue);
      console.log(`📊 QUERY INTENT ANALYSIS:`);
      console.log(`   Strategy: ${secretQueryAnalysis.strategy}`);
      console.log(`   Reason: ${secretQueryAnalysis.reason}`);
      console.log(`   Needs Full Document: ${secretQueryAnalysis.needsFullDocument ? '✅ YES' : '❌ NO'}`);
      console.log(`   Similarity Threshold: ${secretQueryAnalysis.threshold}\n`);

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

      methodUsed = "rag";

      console.log(`\n🎯 ROUTING DECISION: RAG METHOD (SECRET PROMPT)`);
      console.log(`Reason: Secret prompts always use RAG with their specified LLM`);
      console.log(`   🔐 Secret Prompt: "${secretName}"`);
      console.log(`   🤖 LLM from Secret Config: ${dbLlmName || 'not set'}`);
      console.log(`   🤖 Resolved Provider: ${provider}`);
      console.log(`   📊 Query Analysis: ${secretQueryAnalysis.strategy}`);
      console.log(`   🔍 Vector search threshold: ${secretQueryAnalysis.threshold}`);
      console.log(`${'='.repeat(80)}\n`);

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
       
        const debugChunks = await FileChunk.getChunksByFileId(file.id);
        console.log(`      📋 Chunks in database: ${debugChunks.length}`);
       
        if (debugChunks.length === 0) {
          console.log(`      ⚠️ No chunks found in database for this file - skipping vector search`);
          continue;
        }
       
        const chunkIds = debugChunks.map(c => c.id);
        const debugVectors = await ChunkVector.getVectorsByChunkIds(chunkIds);
        console.log(`      🔗 Embeddings in database: ${debugVectors.length} for ${chunkIds.length} chunks`);
       
        if (debugVectors.length === 0) {
          console.log(`      ⚠️ WARNING: Chunks exist but no embeddings found!`);
          console.log(`      💡 This means embeddings were not generated. Using chunks directly as fallback.`);
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
       
        console.log(`      🔎 Performing vector search with embedding...`);
        const relevant = await ChunkVector.findNearestChunksAcrossFiles(
          questionEmbedding,
          maxResults,
          [file.id]
        );
        console.log(`      📊 Vector search found: ${relevant.length} relevant chunks`);
       
        if (relevant.length) {
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

      if (allRelevantChunks.length === 0) {
        console.warn(`\n⚠️ [RAG] No chunks found via vector search - trying fallback...`);
        console.warn(`   - Files searched: ${files.length}`);
       
        const processingFiles = files.filter(f => f.status !== 'processed');
        if (processingFiles.length > 0) {
          console.warn(`   - ⚠️ ${processingFiles.length} file(s) still processing: ${processingFiles.map(f => f.originalname).join(', ')}`);
          return res.status(400).json({
            error: "Document is still being processed. Please wait for processing to complete before asking questions.",
            processingFiles: processingFiles.map(f => ({ id: f.id, name: f.originalname, status: f.status }))
          });
        }
       
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

      const topChunks = allRelevantChunks
        .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
        .slice(0, 10);
     
      console.log(`   - Top chunks selected: ${topChunks.length}`);
      console.log(`   - Similarity range: ${Math.min(...topChunks.map(c => c.similarity)).toFixed(3)} - ${Math.max(...topChunks.map(c => c.similarity)).toFixed(3)}`);
      usedChunkIds = topChunks.map(c => c.chunk_id || c.id);

      const combinedContext = topChunks
        .map((c) => `📄 [${c.filename}]\n${c.content}`)
        .join("\n\n");

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

      try {
        const profileContext = await UserProfileService.getProfileContext(userId, authorizationHeader);
        if (profileContext) {
          finalPrompt = `${profileContext}\n\n---\n\n${finalPrompt}`;
        }
      } catch (profileError) {
        console.warn(`Failed to fetch profile context:`, profileError.message);
      }

      console.log(`\n🤖 Using LLM from secret configuration: ${provider}`);
      answer = await askFolderLLMService(provider, finalPrompt, '', combinedContext);

      // Post-process response to ensure proper JSON format if output template exists
      if (used_secret_prompt && templateData?.outputTemplate) {
        const { postProcessSecretPromptResponse } = require('./secretManagerController');
        answer = postProcessSecretPromptResponse(answer, templateData.outputTemplate);
        console.log(`✅ Post-processed response to match output template format`);
      }

      console.log(`\n✅ RAG METHOD COMPLETED SUCCESSFULLY:`);
      console.log(`   🔐 Secret Prompt Used: "${secretName}"`);
      console.log(`   🤖 LLM Used: ${provider} (from secret config)`);
      console.log(`   📊 Answer Length: ${answer.length} characters`);
      console.log(`   🧩 Chunks Used: ${topChunks.length}`);
      console.log(`${'='.repeat(80)}\n`);
    }

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

      provider = resolveFolderProviderName(dbLlmName || "gemini");
      console.log(`🤖 Resolved provider: ${provider}`);

      const availableProviders = getFolderAvailableProviders();
      if (!availableProviders[provider] || !availableProviders[provider].available) {
        console.warn(`⚠️ Provider '${provider}' unavailable — falling back to gemini`);
        provider = 'gemini';
      }

      const queryAnalysis = analyzeQueryIntent(question);
      console.log(`💬 Query Analysis: ${queryAnalysis.strategy} - ${queryAnalysis.reason}`);

      const isGeminiProvider = provider.toLowerCase().includes('gemini');

      if (isFreeUser) {
        if (queryAnalysis.needsFullDocument) {
          const eyeballLimitCheck = await TokenUsageService.checkFreeTierEyeballLimit(userId, plan);
          if (!eyeballLimitCheck.allowed) {
            console.log(`\n${'🆓'.repeat(40)}`);
            console.log(`[FREE TIER] Gemini Eyeball limit reached - forcing RAG`);
            console.log(`[FREE TIER] ${eyeballLimitCheck.message}`);
            console.log(`${'🆓'.repeat(40)}\n`);
           
            queryAnalysis.needsFullDocument = false;
            queryAnalysis.strategy = 'TARGETED_RAG';
            queryAnalysis.reason = 'Free tier: Gemini Eyeball limit reached (1/day), using RAG retrieval instead';
          } else {
            console.log(`\n${'🆓'.repeat(40)}`);
            console.log(`[FREE TIER] Gemini Eyeball allowed: ${eyeballLimitCheck.message}`);
            console.log(`${'🆓'.repeat(40)}\n`);
          }
        } else {
          console.log(`\n${'🆓'.repeat(40)}`);
          console.log(`[FREE TIER] Using RAG retrieval (subsequent chat after first Eyeball use)`);
          console.log(`${'🆓'.repeat(40)}\n`);
        }
      }

      if (isFreeUser) {
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

      if (isGeminiProvider && queryAnalysis.needsFullDocument) {
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

        const documents = files.map((file) => ({
          gcsUri: `gs://${bucketName}/${file.gcs_path}`,
          filename: file.originalname,
          mimeType: file.mimetype || 'application/pdf'
        }));

        let promptText = question;
        if (caseContext) {
          promptText = `${caseContext}\n\n${promptText}`;
        }
        if (conversationContext) {
          promptText = `Previous Conversation:\n${conversationContext}\n\n---\n\n${promptText}`;
        }

        try {
          const profileContext = await UserProfileService.getProfileContext(userId, authorizationHeader);
          if (profileContext) {
            promptText = `${profileContext}\n\n---\n\n${promptText}`;
          }
        } catch (profileError) {
          console.warn(`Failed to fetch profile context:`, profileError.message);
        }

        const { askGeminiWithMultipleGCS } = require('../services/folderGeminiService');
        const forcedModel = isFreeUser ? TokenUsageService.getFreeTierForcedModel() : null;
        answer = await askGeminiWithMultipleGCS(promptText, documents, '', forcedModel);
        answer = ensurePlainTextAnswer(answer);

        usedChunkIds = []; // Eyeball uses full documents, not chunks

        console.log(`✅ Gemini Eyeball completed: ${answer.length} chars`);
      } else {
        methodUsed = "rag";

        console.log(`\n${'='.repeat(80)}`);
        console.log(`🔍 USING RAG METHOD`);
        console.log(`Reason: ${isGeminiProvider ? 'Targeted query' : 'Non-Gemini provider'}`);
        console.log(`Provider: ${provider}`);
        console.log(`${'='.repeat(80)}\n`);

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
         
          const debugChunks = await FileChunk.getChunksByFileId(file.id);
          console.log(`      📋 Chunks in database: ${debugChunks.length}`);
         
          if (debugChunks.length === 0) {
            console.log(`      ⚠️ No chunks found in database for this file - skipping vector search`);
            continue;
          }
         
          const chunkIds = debugChunks.map(c => c.id);
          const debugVectors = await ChunkVector.getVectorsByChunkIds(chunkIds);
          console.log(`      🔗 Embeddings in database: ${debugVectors.length} for ${chunkIds.length} chunks`);
         
          if (debugVectors.length === 0) {
            console.log(`      ⚠️ WARNING: Chunks exist but no embeddings found!`);
            console.log(`      💡 This means embeddings were not generated. Using chunks directly as fallback.`);
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
         
          console.log(`      🔎 Performing vector search with embedding...`);
          const relevant = await ChunkVector.findNearestChunksAcrossFiles(
            questionEmbedding,
            maxResults,
            [file.id]
          );
          console.log(`      📊 Vector search found: ${relevant.length} relevant chunks`);
         
          if (relevant.length) {
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

        if (allRelevantChunks.length === 0) {
          console.warn(`\n⚠️ [RAG] No chunks found via vector search - trying fallback...`);
          console.warn(`   - Files searched: ${files.length}`);
         
          const processingFiles = files.filter(f => f.status !== 'processed');
          if (processingFiles.length > 0) {
            console.warn(`   - ⚠️ ${processingFiles.length} file(s) still processing: ${processingFiles.map(f => f.originalname).join(', ')}`);
            return res.status(400).json({
              error: "Document is still being processed. Please wait for processing to complete before asking questions.",
              processingFiles: processingFiles.map(f => ({ id: f.id, name: f.originalname, status: f.status }))
            });
          }
         
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

        const topChunks = allRelevantChunks
          .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
          .slice(0, 10);
       
        console.log(`   - Top chunks selected: ${topChunks.length}`);
        console.log(`   - Similarity range: ${Math.min(...topChunks.map(c => c.similarity)).toFixed(3)} - ${Math.max(...topChunks.map(c => c.similarity)).toFixed(3)}`);
        usedChunkIds = topChunks.map(c => c.chunk_id || c.id);

        const combinedContext = topChunks
          .map((c) => `📄 [${c.filename}]\n${c.content}`)
          .join("\n\n");

        chatCost = Math.ceil(question.length / 100) + Math.ceil(combinedContext.length / 200);

        const requestedResources = { tokens: chatCost, ai_analysis: 1 };
        const { allowed, message } = await TokenUsageService.enforceLimits(usage, plan, requestedResources);
        if (!allowed) {
          return res.status(403).json({
            error: `AI chat failed: ${message}`,
            timeLeftUntilReset: timeLeft
          });
        }

        let finalPrompt = question;
        if (caseContext) {
          finalPrompt = `${caseContext}\n\n${finalPrompt}`;
        }
        if (conversationContext) {
          finalPrompt = `Previous Conversation:\n${conversationContext}\n\n---\n\n${finalPrompt}`;
        }
        finalPrompt += `\n\n=== RELEVANT DOCUMENTS (FOLDER: "${folderName}") ===\n${combinedContext}`;

        try {
          const profileContext = await UserProfileService.getProfileContext(userId, authorizationHeader);
          if (profileContext) {
            finalPrompt = `${profileContext}\n\n---\n\n${finalPrompt}`;
          }
        } catch (profileError) {
          console.warn(`Failed to fetch profile context:`, profileError.message);
        }

        answer = await askFolderLLMService(provider, finalPrompt, '', combinedContext);
        answer = ensurePlainTextAnswer(answer);

        console.log(`✅ RAG completed: ${answer.length} chars, ${topChunks.length} chunks`);

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

exports.queryFolderDocumentsStream = async (req, res) => {
  let userId = req.user.id;
  const heartbeat = setInterval(() => {
    try {
      res.write(`data: [PING]\n\n`);
    } catch (err) {
      clearInterval(heartbeat);
    }
  }, 15000);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    res.write(`data: ${JSON.stringify({ type: 'metadata', status: 'streaming_started' })}\n\n`);

    console.log('[queryFolderDocumentsStream] Streaming started');


    let capturedData = null;
    let captureError = null;

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

    res.write(`data: ${JSON.stringify({ type: 'metadata', session_id: capturedData.session_id })}\n\n`);

    let answer = ensurePlainTextAnswer(capturedData.answer);
    const chunkSize = 10; // Stream 10 characters at a time
    for (let i = 0; i < answer.length; i += chunkSize) {
      const chunk = answer.substring(i, Math.min(i + chunkSize, answer.length));
      res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }

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

exports.getFolderProcessingStatus = async (req, res) => {
  try {
    const { folderName } = req.params;
    const userId = req.user.id;

    console.log(`[getFolderProcessingStatus] Getting status for folder: ${folderName}, user: ${userId}`);

    // folderName could be either folder_path or originalname
    // Try to find by folder_path first (which is what we return from uploadForProcessing)
    let files = await File.findByUserIdAndFolderPath(userId, folderName);
    
    // If not found, try to find by originalname (for backward compatibility)
    if (files.length === 0) {
      console.log(`[getFolderProcessingStatus] No files found with folder_path, trying to find by originalname...`);
      // Query to find folder by originalname
      const folderQuery = `
        SELECT folder_path FROM user_files
        WHERE user_id = $1 AND is_folder = true AND originalname = $2
        LIMIT 1;
      `;
      const { rows: folderRows } = await pool.query(folderQuery, [userId, folderName]);
      if (folderRows.length > 0) {
        const foundFolderPath = folderRows[0].folder_path;
        console.log(`[getFolderProcessingStatus] Found folder with path: ${foundFolderPath}`);
        files = await File.findByUserIdAndFolderPath(userId, foundFolderPath);
      }
    }

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

// New endpoint: Upload files, wait for processing, and extract case fields
exports.uploadAndExtractCaseFields = async (req, res) => {
  try {
    const userId = req.user.id;
    const username = req.user.username;
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📤 UPLOAD AND EXTRACT CASE FIELDS - START`);
    console.log(`User ID: ${userId}, Username: ${username}`);
    console.log(`Files count: ${req.files ? req.files.length : 0}`);
    console.log(`${'='.repeat(80)}\n`);
    
    if (!req.files || req.files.length === 0) {
      console.error('❌ No files provided in request');
      return res.status(400).json({ 
        success: false,
        error: "No files uploaded",
        message: "Please select at least one file to upload."
      });
    }

    // Step 1: Create temporary folder
    const tempFolderName = `case-creation-${Date.now()}`;
    console.log(`📁 Step 1/4: Creating temporary folder: ${tempFolderName}`);
    
    const tempFolder = await createFolderInternal(userId, tempFolderName, '');
    console.log(`✅ Folder created: ${tempFolder.originalname}`);

    // Step 2: Upload files (reuse existing upload logic)
    console.log(`📤 Step 2/4: Uploading ${req.files.length} file(s)...`);
    const uploadedFiles = [];
    
    for (const file of req.files) {
      try {
        const ext = path.extname(file.originalname);
        const baseName = path.basename(file.originalname, ext);
        const safeName = sanitizeName(baseName) + ext;
        const key = `${tempFolder.gcs_path}${safeName}`;
        const uniqueKey = await ensureUniqueKey(key);

        console.log(`  📄 Uploading: ${safeName}`);

        const fileRef = bucket.file(uniqueKey);
        await fileRef.save(file.buffer, {
          resumable: false,
          metadata: { contentType: file.mimetype },
        });

        const savedFile = await File.create({
          user_id: userId,
          originalname: safeName,
          gcs_path: uniqueKey,
          folder_path: tempFolder.folder_path,
          mimetype: file.mimetype,
          size: file.size,
          is_folder: false,
          status: "queued",
          processing_progress: 0,
        });

        // Start processing
        processDocumentWithAI(
          savedFile.id,
          file.buffer,
          file.mimetype,
          userId,
          safeName,
          null
        ).catch(err => console.error(`❌ Processing failed for ${savedFile.id}:`, err.message));

        uploadedFiles.push(savedFile);
        console.log(`  ✅ Uploaded: ${safeName} (ID: ${savedFile.id})`);
      } catch (fileError) {
        console.error(`❌ Error uploading ${file.originalname}:`, fileError);
        console.error(`❌ Error details:`, fileError.message, fileError.stack);
      }
    }

    if (uploadedFiles.length === 0) {
      console.error('❌ No files were successfully uploaded');
      return res.status(500).json({ 
        success: false,
        error: "Failed to upload any files",
        message: "All file uploads failed. Please check file formats and try again."
      });
    }

    // Step 3: Wait for files to be processed
    console.log(`⏳ Step 3/4: Waiting for files to be processed...`);
    let allProcessed = false;
    let attempts = 0;
    const maxAttempts = 60; // 60 attempts * 3 seconds = 3 minutes max
    const pollInterval = 3000; // 3 seconds

    while (!allProcessed && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
      // Use folder_path (not originalname) to find files
      const files = await File.findByUserIdAndFolderPath(userId, tempFolder.folder_path);
      const documents = files.filter(f => !f.is_folder);
      
      if (documents.length === 0) {
        attempts++;
        continue;
      }

      const processedCount = documents.filter(f => f.status === 'processed').length;
      const failedCount = documents.filter(f => f.status === 'error').length;
      const totalCount = documents.length;

      console.log(`  📊 Status: ${processedCount}/${totalCount} processed, ${failedCount} failed`);

      allProcessed = processedCount === totalCount || (processedCount + failedCount) === totalCount;
      attempts++;

      if (attempts >= maxAttempts) {
        console.warn(`⚠️ Processing timeout after ${maxAttempts} attempts`);
        break;
      }
    }

    if (!allProcessed) {
      console.warn(`⚠️ Some files may not be processed yet, proceeding with extraction...`);
    }

    // Step 4: Extract case fields using query
    console.log(`🔍 Step 4/4: Extracting case fields from documents...`);
    
    const extractionPrompt = `Extract all case information from the uploaded documents. Return a JSON object with the following fields:
- caseTitle (case title or name)
- caseNumber (case number if available)
- casePrefix (case prefix like WP, CR, etc. if available)
- caseYear (case year if available, extract from case number or date)
- caseType (type of case)
- caseNature (case nature: Civil, Criminal, Constitutional/Writ, Arbitration, etc.)
- subType (subtype if available)
- courtName (court name)
- courtLevel (court level: High Court, District Court, etc.)
- benchDivision (bench/division if mentioned)
- jurisdiction (jurisdiction area or adjudicating authority - these are the same thing)
- state (state if mentioned)
- filingDate (filing date in YYYY-MM-DD format if available)
- judges (array of judge names if available)
- courtRoom (court room number if available)
- petitioners (array of objects with fullName, role, advocateName, barRegistration, contact if available)
- respondents (array of objects with fullName, role, advocateName, barRegistration, contact if available)
- categoryType (category type if mentioned)
- primaryCategory (primary category if available)
- subCategory (sub category if available)
- complexity (complexity level if mentioned)
- monetaryValue (monetary value if mentioned, extract numeric value only)
- priorityLevel (priority: Low, Medium, High if mentioned)
- currentStatus (current status if mentioned: Active, Pending, Closed, etc.)
- nextHearingDate (next hearing date in YYYY-MM-DD format if available)
- documentType (type of document if mentioned)
- filedBy (who filed: Plaintiff, Defendant, Both, or advocate name if mentioned)

Return ONLY valid JSON without markdown formatting. If a field is not found, use null or empty string.`;

    // Step 4: Extract case fields - query processed documents
    let extractedData = {};
    try {
      // Use folder_path (not originalname) to find processed files
      const filesQuery = `
        SELECT id, originalname, folder_path, status, gcs_path, mimetype
        FROM user_files
        WHERE user_id = $1
          AND is_folder = false
          AND status = 'processed'
          AND folder_path = $2
        ORDER BY created_at DESC;
      `;
      const { rows: processedFiles } = await pool.query(filesQuery, [userId, tempFolder.folder_path]);

      if (processedFiles.length === 0) {
        console.warn('⚠️ No processed files found for extraction');
        return res.status(200).json({
          success: true,
          folderName: tempFolderName,
          extractedData: {},
          uploadedFiles: uploadedFiles.map(f => ({
            id: f.id,
            name: f.originalname,
            status: f.status
          })),
          message: 'Files uploaded but not yet processed. Please try extraction again later.'
        });
      }

      console.log(`  📄 Found ${processedFiles.length} processed files for extraction`);

      // Get chunks from processed files
      const allChunks = [];
      for (const file of processedFiles) {
        const chunks = await FileChunk.getChunksByFileId(file.id);
        if (chunks && chunks.length > 0) {
          allChunks.push(...chunks.map(c => c.content));
        }
      }

      if (allChunks.length === 0) {
        console.warn('⚠️ No chunks found in processed files');
        extractedData = {};
      } else {
        try {
          // Use AI to extract case fields from chunks
          const documentContext = allChunks.join('\n\n');
          const provider = 'gemini';
          
          console.log(`  🤖 Querying AI to extract case fields (${allChunks.length} chunks, ${documentContext.length} chars)...`);
          
          // Limit context to avoid token limits
          const limitedContext = documentContext.substring(0, 50000);
          const fullPrompt = extractionPrompt + '\n\nDocument Content:\n' + limitedContext;
          
          let answer;
          try {
            // Wrap AI call in Promise.race with timeout to prevent hanging
            const aiCallPromise = askFolderLLMService(
              provider,
              fullPrompt,
              '',
              '',
              'Extract case fields'
            );
            
            const timeoutPromise = new Promise((_, reject) => {
              setTimeout(() => reject(new Error('AI extraction timed out after 120 seconds')), 120000);
            });
            
            answer = await Promise.race([aiCallPromise, timeoutPromise]);
            
            if (!answer || typeof answer !== 'string') {
              console.warn(`  ⚠️ Invalid AI response:`, typeof answer);
              answer = null;
            }
          } catch (aiCallError) {
            console.error(`  ❌ AI service call failed:`, aiCallError.message);
            console.error(`  ❌ Error name:`, aiCallError.name);
            if (aiCallError.stack) {
              console.error(`  ❌ Error stack:`, aiCallError.stack);
            }
            // Continue with empty extractedData if AI fails - don't fail the entire request
            answer = null;
          }

          // Parse the extracted data
          if (answer) {
            const jsonMatch = answer.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || answer.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              try {
                extractedData = JSON.parse(jsonMatch[1] || jsonMatch[0]);
                console.log(`  ✅ Successfully parsed extracted JSON`);
              } catch (parseErr) {
                console.error(`  ❌ JSON parse error:`, parseErr.message);
                extractedData = {};
              }
            } else if (answer.trim().startsWith('{')) {
              try {
                extractedData = JSON.parse(answer);
                console.log(`  ✅ Successfully parsed direct JSON`);
              } catch (parseErr) {
                console.error(`  ❌ JSON parse error:`, parseErr.message);
                extractedData = {};
              }
            } else {
              console.warn(`  ⚠️ Could not find JSON in AI response`);
              console.warn(`  Response preview: ${answer.substring(0, 200)}...`);
              extractedData = {};
            }
          } else {
            console.warn(`  ⚠️ Invalid answer format:`, typeof answer);
            extractedData = {};
          }
        } catch (aiError) {
          console.error('❌ Error in AI extraction:', aiError);
          console.error('❌ Error stack:', aiError.stack);
          // Continue with empty extractedData if AI fails
          extractedData = {};
        }
      }
    } catch (extractError) {
      console.error('❌ Error extracting case fields:', extractError);
      console.error('❌ Error stack:', extractError.stack);
      // Continue with empty extractedData
      extractedData = {};
    }

    console.log(`✅ Extraction complete! Extracted ${Object.keys(extractedData).length} fields`);
    console.log(`${'='.repeat(80)}\n`);

    // IMPORTANT: This endpoint ONLY extracts and returns data - it does NOT create a case
    // The case is only created when user submits the final form in ReviewStep (handleCreateCase)
    // This ensures users can review and edit all fields before case creation
    
    const responseData = {
      success: true,
      folderName: tempFolderName,
      extractedData: extractedData || {},
      uploadedFiles: uploadedFiles.map(f => ({
        id: f.id,
        name: f.originalname,
        status: f.status
      })),
      message: 'Files uploaded and fields extracted. Review and edit fields as needed. No case has been created yet.'
    };

    console.log(`📤 Sending response with ${Object.keys(extractedData).length} extracted fields`);
    return res.status(200).json(responseData);

  } catch (error) {
    console.error('❌ uploadAndExtractCaseFields error:', error);
    console.error('❌ Error name:', error.name);
    console.error('❌ Error message:', error.message);
    console.error('❌ Error stack:', error.stack);
    
    // Ensure we always send a response even if something goes wrong
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        details: error.message || 'Unknown error occurred',
        message: 'Failed to process documents. Please try again or contact support if the issue persists.'
      });
    } else {
      console.error('⚠️ Response already sent, cannot send error response');
    }
  }
};

// Upload files for processing (separate from extraction)
exports.uploadForProcessing = async (req, res) => {
  try {
    const userId = req.user.id;
    const username = req.user.username;
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📤 UPLOAD FOR PROCESSING - START`);
    console.log(`User ID: ${userId}, Username: ${username}`);
    console.log(`Files count: ${req.files ? req.files.length : 0}`);
    console.log(`${'='.repeat(80)}\n`);
    
    if (!req.files || req.files.length === 0) {
      console.error('❌ No files provided in request');
      return res.status(400).json({ 
        success: false,
        error: "No files uploaded",
        message: "Please select at least one file to upload."
      });
    }

    // Step 1: Create temporary folder_path identifier (NO folder record in database)
    const tempFolderPath = `temp-case-${Date.now()}`;
    const tempGcsPrefix = `${userId}/temp-uploads/${Date.now()}/`;
    console.log(`📁 Using temporary path: ${tempFolderPath} (NO folder record will be created)`);

    // Step 2: Upload files and initiate processing in parallel
    console.log(`📤 Processing ${req.files.length} file(s) in parallel...`);
    const uploadPromises = req.files.map(async (file) => {
      try {
        const ext = path.extname(file.originalname);
        const baseName = path.basename(file.originalname, ext);
        const safeName = sanitizeName(baseName) + ext;
        const key = `${tempGcsPrefix}${safeName}`;
        const uniqueKey = await ensureUniqueKey(key);

        console.log(`  📄 Uploading: ${safeName} to temp path: ${uniqueKey}`);

        const fileRef = bucket.file(uniqueKey);
        await fileRef.save(file.buffer, {
          resumable: false,
          metadata: { contentType: file.mimetype },
        });

        // Store file with temp folder_path (string value only, no folder record)
        const savedFile = await File.create({
          user_id: userId,
          originalname: safeName,
          gcs_path: uniqueKey,
          folder_path: tempFolderPath, // Use temp folder_path identifier (no folder record)
          mimetype: file.mimetype,
          size: file.size,
          is_folder: false,
          status: "queued",
          processing_progress: 0,
        });

        // Start processing in background (files will process in parallel)
        processDocumentWithAI(
          savedFile.id,
          file.buffer,
          file.mimetype,
          userId,
          safeName,
          null
        ).catch(err => console.error(`❌ Processing failed for ${savedFile.id}:`, err.message));

        console.log(`  ✅ Uploaded: ${safeName} (ID: ${savedFile.id})`);
        
        return {
          id: savedFile.id,
          name: savedFile.originalname,
          status: savedFile.status
        };
      } catch (fileError) {
        console.error(`❌ Error uploading ${file.originalname}:`, fileError);
        return null;
      }
    });

    // Wait for all uploads to complete in parallel
    const uploadResults = await Promise.all(uploadPromises);
    const uploadedFiles = uploadResults.filter(file => file !== null);

    if (uploadedFiles.length === 0) {
      console.error('❌ No files were successfully uploaded');
      return res.status(500).json({ 
        success: false,
        error: "Failed to upload any files",
        message: "All file uploads failed. Please check file formats and try again."
      });
    }

    console.log(`✅ Upload complete! ${uploadedFiles.length} file(s) uploaded to temp path: ${tempFolderPath}`);
    console.log(`📁 Temp folder_path: ${tempFolderPath} (NO folder record created)`);
    console.log(`${'='.repeat(80)}\n`);

    // Return temp folder_path (string identifier, not a folder record)
    return res.status(200).json({
      success: true,
      folderName: tempFolderPath, // Return temp folder_path so files can be found later
      uploadedFiles: uploadedFiles,
      message: 'Files uploaded successfully. Processing has started.'
    });

  } catch (error) {
    console.error('❌ uploadForProcessing error:', error);
    console.error('❌ Error stack:', error.stack);
    
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        details: error.message || 'Unknown error occurred',
        message: 'Failed to upload files. Please try again or contact support if the issue persists.'
      });
    }
  }
};

// Extract case fields from processed folder (called after 100% processing)
exports.extractCaseFieldsFromFolder = async (req, res) => {
  try {
    const userId = req.user.id;
    let { folderName } = req.params;
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔍 EXTRACT CASE FIELDS FROM FOLDER - START`);
    console.log(`User ID: ${userId}`);
    console.log(`Folder: ${folderName}`);
    console.log(`${'='.repeat(80)}\n`);

    if (!folderName) {
      return res.status(400).json({
        success: false,
        error: "Folder name is required"
      });
    }

    // Find files by folder_path (folderName is a folder_path identifier, not a folder record)
    // Since we no longer create folder records for temp uploads, just find files directly by folder_path
    let files = await File.findByUserIdAndFolderPath(userId, folderName);
    
    // If not found, try to find by originalname (backward compatibility for old folder records)
    if (files.length === 0) {
      console.log(`[extractCaseFieldsFromFolder] No files found with folder_path "${folderName}", trying to find by originalname...`);
      const folderQuery = `
        SELECT folder_path FROM user_files
        WHERE user_id = $1 AND is_folder = true AND originalname = $2
        LIMIT 1;
      `;
      const { rows: folderRows } = await pool.query(folderQuery, [userId, folderName]);
      if (folderRows.length > 0) {
        const foundFolderPath = folderRows[0].folder_path;
        console.log(`[extractCaseFieldsFromFolder] Found folder record with path: ${foundFolderPath}`);
        folderName = foundFolderPath; // Update for later use
        files = await File.findByUserIdAndFolderPath(userId, folderName);
      }
    }

    // Filter out folder records (we only care about actual files)
    const documents = files.filter(f => !f.is_folder);

    if (documents.length === 0) {
      console.log(`[extractCaseFieldsFromFolder] No files found with folder_path "${folderName}"`);
      return res.status(404).json({
        success: false,
        error: "No files found for the specified folder path"
      });
    }

    console.log(`[extractCaseFieldsFromFolder] Found ${documents.length} file(s) with folder_path "${folderName}"`);

    // Get all processed files (use folderName directly as folder_path, since we don't create folder records anymore)
    const filesQuery = `
      SELECT id, originalname, folder_path, status, gcs_path, mimetype
      FROM user_files
      WHERE user_id = $1
        AND is_folder = false
        AND status = 'processed'
        AND folder_path = $2
      ORDER BY created_at DESC;
    `;
    const { rows: processedFiles } = await pool.query(filesQuery, [userId, folderName]);

    if (processedFiles.length === 0) {
      return res.status(200).json({
        success: true,
        extractedData: {},
        message: 'No processed files found. Please wait for files to finish processing.'
      });
    }

    console.log(`  📄 Found ${processedFiles.length} processed files for extraction`);

    // Get chunks from processed files - prioritize relevant chunks for better extraction
    const allChunks = [];
    const chunkMetadata = []; // Store metadata for semantic search if needed
    for (const file of processedFiles) {
      const chunks = await FileChunk.getChunksByFileId(file.id);
      if (chunks && chunks.length > 0) {
        chunks.forEach(chunk => {
          allChunks.push(chunk.content);
          chunkMetadata.push({
            fileId: file.id,
            fileName: file.originalname,
            content: chunk.content,
            chunkId: chunk.id
          });
        });
      }
    }

    let extractedData = {};
    
    if (allChunks.length === 0) {
      console.warn('⚠️ No chunks found in processed files');
      extractedData = {};
    } else {
      try {
        // Combine all chunks with page/file separators for better context
        const documentContext = chunkMetadata.map((meta, idx) => {
          return `[Document: ${meta.fileName} - Section ${idx + 1}]\n${meta.content}`;
        }).join('\n\n---\n\n');
        
        const provider = 'gemini';
        
        console.log(`  🤖 Querying AI to extract case fields (${allChunks.length} chunks from ${processedFiles.length} files, ${documentContext.length} chars)...`);
        
        const extractionPrompt = `You are an expert legal document analyst. Extract ALL case information from the documents using semantic understanding and intelligent field matching.

INSTRUCTIONS:
1. Read the entire document carefully and understand the context
2. Look for fields even if they are written with different names, synonyms, or abbreviations
3. Use semantic understanding to match field names - for example:
   - "Case Title" could be: "Title", "Subject Matter", "Matter Title", "Case Name", "Cause Title", "Petition Title"
   - "Case Number" could be: "Case No.", "Suit No.", "Petition No.", "Application No.", "Writ Petition No.", "Criminal Case No."
   - "Court" could be: "Court Name", "Forum", "Adjudicating Forum", "Court of", "Before", "Hon'ble Court"
   - "Jurisdiction" could be: "Jurisdiction", "Adjudicating Authority", "Territorial Jurisdiction", "Jurisdictional Area"
   - "Petitioner" could be: "Petitioner", "Plaintiff", "Applicant", "Appellant", "Complainant", "Party"
   - "Respondent" could be: "Respondent", "Defendant", "Opposite Party", "Opponent", "Accused"
   - "Filing Date" could be: "Date of Filing", "Date Filed", "Filed On", "Instituted On", "Registration Date"
   - "Hearing Date" could be: "Next Date", "Next Date of Hearing", "Date of Hearing", "Listed On", "Posted On"
   - "Judge" could be: "Judge", "Hon'ble Justice", "Hon'ble Judge", "Bench", "Presiding Officer"
   - "Advocate" could be: "Advocate", "Counsel", "Lawyer", "Attorney", "Legal Representative"

4. Extract ALL available information - be thorough and comprehensive
5. For dropdown fields (caseType, jurisdiction, courtName, etc.), extract the EXACT value even if written differently
6. For dates, convert to YYYY-MM-DD format
7. For monetary values, extract numeric value only (remove currency symbols, commas)
8. For arrays (petitioners, respondents, judges), extract ALL entries

EXTRACT THE FOLLOWING FIELDS:
{
  "caseTitle": "IMPORTANT: Generate case title as 'Plaintiff Name vs Defendant Name' format. If case title exists in document, use it; otherwise, construct it from petitioners and respondents as 'Petitioner Name vs Respondent Name'. Look for: Title, Subject Matter, Matter Title, Case Name, Cause Title",
  "caseNumber": "Case number (look for: Case No., Suit No., Petition No., Application No., WP No., Criminal Case No.)",
  "casePrefix": "Case prefix like WP, CR, WP(C), SLP, etc. (extract from case number or separately - this is INDEPENDENT field, not dependent on bench)",
  "caseYear": "Year from case number or filing date (YYYY format)",
  "caseType": "Type of case (Civil, Criminal, Writ, Arbitration, etc.) - must match dropdown values exactly",
  "caseNature": "Case nature (Civil, Criminal, Constitutional/Writ, Arbitration, Commercial, etc.) - must match dropdown values exactly",
  "subType": "Subtype or category of the case - must match dropdown values exactly",
  "courtName": "Full court name (look for: Court Name, Forum, Before, Hon'ble Court) - use exact court name for dropdown matching",
  "courtLevel": "Court level (High Court, District Court, Supreme Court, etc.)",
  "benchDivision": "Bench or division name (e.g., Aurangabad Bench, Principal Bench, Mumbai Bench) - use exact bench name",
  "jurisdiction": "Jurisdiction or Adjudicating Authority (territorial area) - use exact name for dropdown matching",
  "state": "State name if mentioned",
  "filingDate": "Filing date in YYYY-MM-DD format (look for: Date of Filing, Filed On, Instituted On)",
  "judges": ["Array of judge names (look for: Judge, Hon'ble Justice, Hon'ble Judge)"],
  "courtRoom": "Court room number if mentioned (can be just a number like '12' or text like 'Room 12')",
  "petitioners": [{"fullName": "Petitioner/Plaintiff name (REQUIRED - extract all petitioners)", "role": "Individual/Company/Government", "advocateName": "Advocate name", "barRegistration": "Bar registration number", "contact": "Contact info"}],
  "respondents": [{"fullName": "Respondent/Defendant name (REQUIRED - extract all respondents)", "role": "Individual/Company/Government", "advocateName": "Advocate name", "barRegistration": "Bar registration number", "contact": "Contact info"}],
  "categoryType": "Category type if mentioned",
  "primaryCategory": "Primary category",
  "subCategory": "Sub category",
  "complexity": "Complexity level (Simple, Medium, Complex)",
  "monetaryValue": "Monetary value (numeric only, no currency symbols)",
  "priorityLevel": "Priority level (Low, Medium, High)",
  "currentStatus": "Current status (Active, Pending, Closed, Disposed, etc.)",
  "nextHearingDate": "Next hearing date in YYYY-MM-DD format (look for: Next Date, Date of Hearing, Listed On)",
  "documentType": "Type of document (Petition, Affidavit, Notice, Order, etc.)",
  "filedBy": "Who filed the case (Plaintiff, Defendant, Both, or advocate name)"
}

CRITICAL REQUIREMENTS:
- Extract ALL fields that are present in the document
- Use semantic matching to find fields even with different names
- Be exhaustive - check multiple sections of the document
- For dropdown fields, extract the value as written (we will match it later)
- Return COMPLETE JSON with all found fields
- If a field has multiple possible values, use the most relevant one
- For arrays, include ALL items found in the document

Return ONLY valid JSON without markdown formatting. If a field is not found, use null or empty string.`;

        // Use more context for better extraction (increased from 50k to 100k chars)
        const limitedContext = documentContext.substring(0, 100000);
        const fullPrompt = extractionPrompt + '\n\n=== DOCUMENT CONTENT ===\n' + limitedContext + '\n\n=== EXTRACTION INSTRUCTIONS ===\nExtract ALL fields comprehensively. Use semantic understanding to find fields even with different names. Be thorough and leave no field empty if the information exists in the document.';
        
        let answer;
        try {
          const aiCallPromise = askFolderLLMService(
            provider,
            fullPrompt,
            '',
            '',
            'Extract case fields'
          );
          
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('AI extraction timed out after 120 seconds')), 120000);
          });
          
          answer = await Promise.race([aiCallPromise, timeoutPromise]);
          
          if (!answer || typeof answer !== 'string') {
            console.warn(`  ⚠️ Invalid AI response:`, typeof answer);
            answer = null;
          }
        } catch (aiCallError) {
          console.error(`  ❌ AI service call failed:`, aiCallError.message);
          answer = null;
        }

        // Parse the extracted data
        if (answer) {
          const jsonMatch = answer.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || answer.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              extractedData = JSON.parse(jsonMatch[1] || jsonMatch[0]);
              console.log(`  ✅ Successfully parsed extracted JSON`);
            } catch (parseErr) {
              console.error(`  ❌ JSON parse error:`, parseErr.message);
              extractedData = {};
            }
          } else if (answer.trim().startsWith('{')) {
            try {
              extractedData = JSON.parse(answer);
              console.log(`  ✅ Successfully parsed direct JSON`);
            } catch (parseErr) {
              console.error(`  ❌ JSON parse error:`, parseErr.message);
              extractedData = {};
            }
          } else {
            console.warn(`  ⚠️ Could not find JSON in AI response`);
            extractedData = {};
          }
        }
      } catch (aiError) {
        console.error('❌ Error in AI extraction:', aiError);
        extractedData = {};
      }
    }

    console.log(`✅ Extraction complete! Extracted ${Object.keys(extractedData).length} fields`);
    console.log(`${'='.repeat(80)}\n`);

    // IMPORTANT: This endpoint ONLY extracts and returns data - it does NOT create a case
    return res.status(200).json({
      success: true,
      extractedData: extractedData || {},
      message: 'Fields extracted successfully. Review and edit fields as needed. No case has been created yet.'
    });

  } catch (error) {
    console.error('❌ extractCaseFieldsFromFolder error:', error);
    console.error('❌ Error stack:', error.stack);
    
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        details: error.message || 'Unknown error occurred',
        message: 'Failed to extract case fields. Please try again.'
      });
    }
  }
};

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

    await File.updateProcessingStatus(file_id, "processing_locked", 75.0);

    const bucketName = fileOutputBucket.name;
    let prefix = job.gcs_output_uri_prefix;
    if (prefix.startsWith('gs://')) {
      prefix = prefix.replace(`gs://${bucketName}/`, "");
    }
    if (!prefix.endsWith('/')) {
      prefix += '/';
    }
   
    console.log(`[getFileProcessingStatus] Fetching results from bucket: ${bucketName}, prefix: ${prefix}`);
    console.log(`[getFileProcessingStatus] Full output URI: ${job.gcs_output_uri_prefix}`);
   
    const extractedBatchTexts = await fetchBatchResults(bucketName, prefix);

    if (!extractedBatchTexts || extractedBatchTexts.length === 0) {
      const errorDetails = {
        file_id: file_id,
        bucket: bucketName,
        prefix: prefix,
        output_uri: job.gcs_output_uri_prefix,
        message: "Could not extract any meaningful text content from batch document. This may indicate: 1) Image-only PDF with no OCR text, 2) Corrupted document, 3) Document AI processing incomplete, or 4) JSON structure mismatch."
      };
      console.error(`[getFileProcessingStatus] ❌ Text extraction failed:`, errorDetails);
     
      await File.updateProcessingStatus(file_id, "error", 0.0, "Text extraction failed: No text content found in Document AI results");
      await ProcessingJob.updateJobStatus(job.job_id, "failed", errorDetails.message);
     
      throw new Error(`Could not extract any meaningful text content from batch document. Check logs for details. Output URI: ${job.gcs_output_uri_prefix}`);
    }
   
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
        // Use rate-limited queue to avoid API rate limits
        const chunkContents = chunks.map(c => c.content);
        summary = await summaryQueue.add(async () => {
          console.log(`[SummaryQueue] Processing summary for file ${file_id}`);
          return await getSummaryFromChunks(chunkContents);
        });
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

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(sessionId)) {
      return res.status(400).json({
        error: "Invalid session ID format",
        sessionId
      });
    }

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

    const files = await File.findByUserIdAndFolderPath(userId, folderName);
    const processedFiles = files.filter(f => !f.is_folder && f.status === "processed");

    const protocol = req.protocol || 'http';
    const host = req.get('host') || '';
    const baseUrl = `${protocol}://${host}`;

    const chatHistoryWithCitations = await Promise.all(
      chatHistory.map(async (chat) => {
        let citations = chat.citations || [];
       
        if ((!citations || citations.length === 0) && chat.used_chunk_ids && chat.used_chunk_ids.length > 0) {
          try {
            const { extractCitationsFromChunks } = require('./intelligentFolderChatController');
           
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

exports.getChatCitations = async (req, res) => {
  try {
    const { folderName, chatId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        error: "Unauthorized - user not found"
      });
    }

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(chatId)) {
      return res.status(400).json({
        error: "Invalid chat ID format",
        chatId
      });
    }

    console.log(`📚 [getChatCitations] Fetching citations for chat: ${chatId}, folder: ${folderName}, user: ${userId}`);

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
   
    let citations = chat.citations || [];
   
    if ((!citations || citations.length === 0) && chat.used_chunk_ids && chat.used_chunk_ids.length > 0) {
      console.log(`🔄 [getChatCitations] No citations in DB, generating from chunk IDs for chat ${chatId}`);
     
      const protocol = req.protocol || 'http';
      const host = req.get('host') || '';
      const baseUrl = `${protocol}://${host}`;

      const { extractCitationsFromChunks } = require('./intelligentFolderChatController');

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

        citations = await extractCitationsFromChunks(formattedChunks, baseUrl);

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

    const { usage, plan, timeLeft } = await TokenUsageService.getUserUsageAndPlan(userId, authorizationHeader);

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

    chatCost = Math.ceil(question.length / 100) + Math.ceil(allChunks.reduce((sum, c) => sum + c.content.length, 0) / 200) + Math.ceil(conversationContext.length / 200); // Question tokens + context tokens + history tokens

    const requestedResources = { tokens: chatCost, ai_analysis: 1 };
    const { allowed, message } = await TokenUsageService.enforceLimits(usage, plan, requestedResources);

    if (!allowed) {
      return res.status(403).json({
        error: `AI chat failed: ${message}`,
        timeLeftUntilReset: timeLeft
      });
    }

    const questionLower = question.toLowerCase();
    const questionWords = questionLower
      .split(/\s+/)
      .filter(word => word.length > 3 && !['what', 'where', 'when', 'how', 'why', 'which', 'this', 'that', 'these', 'those'].includes(word));

    console.log(`[continueFolderChat] Question keywords:`, questionWords);

    let relevantChunks = [];

    if (questionWords.length > 0) {
      relevantChunks = allChunks.map(chunk => {
        const contentLower = chunk.content.toLowerCase();
        let score = 0;

        for (const word of questionWords) {
          const regex = new RegExp(`\\b${word}\\b`, 'gi');
          const matches = (contentLower.match(regex) || []).length;
          score += matches * 2;
        }

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

    let provider;
    if (used_secret_prompt && secret_id) {
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
      provider = 'claude-sonnet-4';
      console.log(`🤖 Using Claude Sonnet 4 for custom query in continueFolderChat`);
    }

    const contextText = relevantChunks.map((chunk, index) =>
      `[Document: ${chunk.filename} - Page ${chunk.page_start || 'N/A'}]\n${chunk.content.substring(0, 2000)}`
    ).join("\n\n---\n\n");

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
    answer = ensurePlainTextAnswer(answer);
    console.log(`[continueFolderChat] Generated answer length: ${answer.length} characters`);

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

    await TokenUsageService.incrementUsage(userId, requestedResources);

    const sources = relevantChunks.map(chunk => ({
      document: chunk.filename,
      content: chunk.content.substring(0, 400) + (chunk.content.length > 400 ? "..." : ""),
      page: chunk.page_start || 'N/A',
      relevanceScore: chunk.similarity_score || 0
    }));

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
    res.status(500).json({
      error: "Failed to continue chat",
      details: error.message
    });
  }
};


exports.deleteFolderChatSession = async (req, res) => {
  try {
    const { folderName, sessionId } = req.params;
    const userId = req.user.id;

    console.log(`🗑️ [deleteFolderChatSession] Deleting session: ${sessionId} for folder: ${folderName}, user: ${userId}`);

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isValidUUID = UUID_REGEX.test(sessionId);
   
    if (!isValidUUID) {
      return res.status(400).json({
        error: "Invalid session ID format",
        sessionId,
        message: "Session ID must be a valid UUID format (e.g., bc428ae4-ec0f-4e24-af70-e7c35d8db42a)"
      });
    }

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
   
    const normalizedFolderName = folderName.trim();
    const matchingFolder = checkResult.rows.filter(row =>
      row.folder_name && row.folder_name.trim().toLowerCase() === normalizedFolderName.toLowerCase()
    );
   
    console.log(`🗑️ [deleteFolderChatSession] Checking folder match:`);
    console.log(`   - Requested folder: "${normalizedFolderName}"`);
    console.log(`   - Found folders: ${[...new Set(checkResult.rows.map(r => r.folder_name))].join(', ')}`);
    console.log(`   - Matching chats: ${matchingFolder.length}`);
   
    if (matchingFolder.length === 0) {
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

exports.deleteSingleFolderChat = async (req, res) => {
  try {
    const { folderName, chatId } = req.params;
    const userId = req.user.id;

    console.log(`🗑️ [deleteSingleFolderChat] Deleting chat: ${chatId} from folder: ${folderName}, user: ${userId}`);

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isValidUUID = UUID_REGEX.test(chatId);
   
    if (!isValidUUID) {
      return res.status(400).json({
        error: "Invalid chat ID format",
        chatId,
        message: "Chat ID must be a valid UUID format"
      });
    }

    const checkQuery = `
      SELECT id, folder_name, question, created_at
      FROM folder_chats
      WHERE id = $1::uuid
        AND user_id = $2
    `;
   
    const checkResult = await pool.query(checkQuery, [chatId, userId]);
   
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        error: "Chat not found",
        chatId,
        message: "Chat not found or you don't have permission to delete it."
      });
    }

    const chat = checkResult.rows[0];
    const normalizedFolderName = folderName.trim();
    const chatFolderName = chat.folder_name?.trim() || '';

    if (chatFolderName.toLowerCase() !== normalizedFolderName.toLowerCase()) {
      return res.status(404).json({
        error: "Chat not found in this folder",
        chatId,
        folderName: normalizedFolderName,
        actualFolder: chatFolderName,
        message: `Chat belongs to folder "${chatFolderName}", not "${normalizedFolderName}"`
      });
    }

    const deleteQuery = `
      DELETE FROM folder_chats
      WHERE id = $1::uuid
        AND user_id = $2
        AND LOWER(TRIM(folder_name)) = LOWER(TRIM($3))
      RETURNING id, folder_name, question
    `;

    const result = await pool.query(deleteQuery, [chatId, userId, normalizedFolderName]);
    const deletedCount = result.rowCount || 0;

    console.log(`🗑️ [deleteSingleFolderChat] Deleted ${deletedCount} chat(s) with id: ${chatId}`);

    if (deletedCount === 0) {
      return res.status(404).json({
        error: "Chat not found",
        chatId,
        folderName: normalizedFolderName,
        message: "Chat not found. It may have already been deleted or doesn't exist."
      });
    }

    return res.json({
      success: true,
      message: "Chat deleted successfully",
      folderName: normalizedFolderName,
      chatId,
      deletedChat: result.rows[0]
    });

  } catch (error) {
    console.error("❌ deleteSingleFolderChat error:", error);
    console.error("❌ deleteSingleFolderChat error stack:", error.stack);
    res.status(500).json({
      error: "Failed to delete chat",
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};




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
        co.court_name as court_name_name
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

    const formattedCases = cases.map(caseData => {
      caseData.case_type = caseData.case_type_name || caseData.case_type;
      caseData.sub_type = caseData.sub_type_name || caseData.sub_type;
      caseData.court_name = caseData.court_name_name || caseData.court_name;

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

exports.getCaseFilesByFolderName = async (req, res) => {
  try {
    const userId = req.user.id;
    const username = req.user.username;
    const { folderName } = req.params;

    if (!folderName) {
      return res.status(400).json({ error: "Folder name is required" });
    }

    console.log(`📂 [getCaseFilesByFolderName] User: ${username}, Folder: ${folderName}`);

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

exports.getFilesForMindmap = async (req, res) => {
  try {
    const userId = req.user.id;
   
    console.log(`[getFilesForMindmap] Fetching processed files for user: ${userId}`);
   
    const query = `
      SELECT
        id,
        originalname,
        size,
        mimetype,
        status,
        processing_progress,
        created_at,
        processed_at
      FROM user_files
      WHERE user_id = $1
        AND is_folder = false
        AND status = 'processed'
      ORDER BY created_at DESC
    `;
   
    const result = await pool.query(query, [userId]);
   
    const files = result.rows.map(file => ({
      id: file.id,
      name: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
      status: file.status,
      progress: file.processing_progress,
      createdAt: file.created_at,
      processedAt: file.processed_at
    }));
   
    console.log(`[getFilesForMindmap] Found ${files.length} processed files for user ${userId}`);
   
    return res.status(200).json({
      success: true,
      files: files,
      count: files.length
    });
  } catch (error) {
    console.error('[getFilesForMindmap] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch files for mindmap',
      details: error.message
    });
  }
};

exports.viewDocument = async (req, res) => {
  try {
    const userId = req.user.id;
    const { fileId } = req.params;
    const { expiryMinutes = 60 } = req.query; // Default 60 minutes

    if (!fileId) {
      return res.status(400).json({ error: "File ID is required" });
    }

    console.log(`👁️ [viewDocument] User: ${userId}, FileId: ${fileId}`);

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

    const fileRef = bucket.file(file.gcs_path);
    const [exists] = await fileRef.exists();

    if (!exists) {
      console.error(`❌ File ${file.gcs_path} not found in GCS`);
      return res.status(404).json({
        error: "Document file not found in storage.",
      });
    }

    const viewUrl = await makeSignedReadUrl(file.gcs_path, parseInt(expiryMinutes));

    const pageNumber = req.query.page ? parseInt(req.query.page, 10) : null;

    console.log(`✅ Generated view URL for file: ${file.originalname}${pageNumber ? ` (page ${pageNumber})` : ''}`);

    const finalViewUrl = viewUrl;
   
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

exports.streamDocument = async (req, res) => {
  try {
    const userId = req.user.id;
    const { fileId } = req.params;
    const { download = false } = req.query; // Download vs inline viewing

    if (!fileId) {
      return res.status(400).json({ error: "File ID is required" });
    }

    console.log(`📥 [streamDocument] User: ${userId}, FileId: ${fileId}, Download: ${download}`);

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

    const fileRef = bucket.file(file.gcs_path);
    const [exists] = await fileRef.exists();

    if (!exists) {
      return res.status(404).json({
        error: "Document file not found in storage.",
      });
    }

    const [metadata] = await fileRef.getMetadata();

    const contentDisposition = download === 'true' || download === true
      ? `attachment; filename="${file.originalname}"`
      : `inline; filename="${file.originalname}"`;

    res.setHeader('Content-Type', file.mimetype || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition);
    res.setHeader('Content-Length', metadata.size || file.size);
    res.setHeader('Cache-Control', 'private, max-age=3600');

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

exports.getFileComplete = async (req, res) => {
  const userId = req.user.id;
  const { file_id } = req.params;

  try {
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!file_id) return res.status(400).json({ error: "file_id is required" });

    const file = await File.getFileById(file_id);
    if (!file) {
      return res.status(404).json({ error: "File not found" });
    }

    if (String(file.user_id) !== String(userId)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const chunks = await FileChunk.getChunksByFileId(file_id);

    const chats = await FileChat.getChatHistory(file_id);

    const processingJob = await ProcessingJob.getJobByFileId(file_id);

    let folderChats = [];
    if (file.folder_path) {
      const folderName = file.folder_path.split('/').pop() || file.folder_path;
      folderChats = await FolderChat.getFolderChatHistory(userId, folderName);
    }

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

    const filesToProcess = fileId
      ? files.filter(f => f.id === fileId)
      : files;

    if (fileId && filesToProcess.length === 0) {
      return res.status(404).json({
        error: `File with ID ${fileId} not found in folder ${folderName}`
      });
    }

    const allChunks = [];

    for (const file of filesToProcess) {
      const chunks = await FileChunk.getChunksByFileId(file.id);
     
      for (const chunk of chunks) {
        if (page) {
          const pageNum = parseInt(page, 10);
          if (chunk.page_start !== pageNum && chunk.page_end !== pageNum) {
            if (!(chunk.page_start <= pageNum && chunk.page_end >= pageNum)) {
              continue;
            }
          }
        }

        const chunkWithPageInfo = {
          chunk_id: chunk.id,
          chunk_index: chunk.chunk_index,
          content: chunk.content,
          token_count: chunk.token_count,
          page: chunk.page_start || null, // Primary page number
          page_start: chunk.page_start || null,
          page_end: chunk.page_end || null,
          page_range: chunk.page_start && chunk.page_end
            ? (chunk.page_start === chunk.page_end
                ? `Page ${chunk.page_start}`
                : `Pages ${chunk.page_start}-${chunk.page_end}`)
            : null,
          heading: chunk.heading || null,
          file_id: file.id,
          filename: file.originalname,
          file_mimetype: file.mimetype,
        };

        allChunks.push(chunkWithPageInfo);
      }
    }

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
      chunks: allChunks,
      chunks_by_file: Object.values(chunksByFile),
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

// Export processDocumentWithAI for use by Google Drive controller
exports.processDocumentWithAI = processDocumentWithAI;
