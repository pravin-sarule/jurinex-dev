const db = require("../config/db");
const DocumentModel = require("../models/DocumentModel");
const FileChunkModel = require("../models/FileChunk");
const ChunkVectorModel = require("../models/ChunkVector");
const FileChat = require("../models/FileChat");
const { uploadToGCS } = require("../services/gcsService");
const { extractText, detectDigitalNativePDF, extractTextFromPDFWithPages } = require("../utils/textExtractor");
const { extractTextFromDocument, batchProcessDocument, getOperationStatus, fetchBatchResults } = require("../services/documentAiService");
const { chunkDocument } = require("../services/chunkingService");
const { generateEmbedding, generateEmbeddings } = require("../services/embeddingService");
const { fileInputBucket, fileOutputBucket } = require("../config/gcs");
const { v4: uuidv4 } = require("uuid");
const { askLLM, getSummaryFromChunks } = require("../services/aiService");
const { SessionManager } = require("../services/sessionManager");

const updateProcessingProgress = async (fileId, status, progress, currentOperation) => {
  await DocumentModel.updateProgressWithOperation(fileId, status, progress, currentOperation);
  console.log(`[Progress] File ${fileId}: ${currentOperation} - ${progress}%`);
};

async function processDocument(fileId, fileBuffer, mimetype) {
  const jobId = uuidv4();

  try {
    await updateProcessingProgress(fileId, "processing", 0.0, "Starting document processing");

    await updateProcessingProgress(fileId, "processing", 5.0, "Initialization complete");

    let extractedTexts = [];
    const isPDF = String(mimetype).toLowerCase() === 'application/pdf';

    if (isPDF) {
      await updateProcessingProgress(fileId, "processing", 18.0, "Analyzing PDF format");
      
      const pdfDetection = await detectDigitalNativePDF(fileBuffer);
      
      if (pdfDetection.isDigitalNative) {
        await updateProcessingProgress(fileId, "processing", 20.0, "Extracting text from digital-native PDF");
        extractedTexts = await extractTextFromPDFWithPages(fileBuffer);
        
        const totalExtractedText = extractedTexts.map(t => t.text || '').join(' ').trim();
        const extractedWordCount = totalExtractedText.split(/\s+/).filter(w => w.length > 0).length;
        const extractedCharCount = totalExtractedText.length;
        const minWordsRequired = 10 * pdfDetection.pageCount;
        const minCharsRequired = 100 * pdfDetection.pageCount;
        
        if (extractedWordCount < minWordsRequired || extractedCharCount < minCharsRequired) {
          extractedTexts = [];
          await updateProcessingProgress(fileId, "processing", 20.0, "Text extraction insufficient - falling back to Document AI OCR");
        } else {
          await updateProcessingProgress(fileId, "processing", 42.0, "Text extraction completed");
        }
      } else {
        await updateProcessingProgress(fileId, "processing", 20.0, "Scanned PDF detected - preparing for Document AI OCR");
      }
    }

    const ocrMimeTypes = [
      "image/png", "image/jpeg", "image/tiff",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];

    const useOCR = (isPDF && !extractedTexts.length) || ocrMimeTypes.includes(String(mimetype).toLowerCase());

    if (useOCR) {
      await updateProcessingProgress(fileId, "processing", 25.0, "OCR processing started");

      const FILE_SIZE_LIMIT_INLINE = 20 * 1024 * 1024;
      const isLargeFile = fileBuffer.length > FILE_SIZE_LIMIT_INLINE;

      if (!isLargeFile) {
        try {
          extractedTexts = await extractTextFromDocument(fileBuffer, mimetype);
          
          if (!extractedTexts || extractedTexts.length === 0) {
            throw new Error('No text extracted from inline processing');
          }
          
          await updateProcessingProgress(fileId, "processing", 42.0, "OCR processing completed");
        } catch (ocrError) {
          console.warn(`Inline OCR failed, falling back to batch processing`);
          // Will use batch processing below
        }
      }

      if (isLargeFile || !extractedTexts || extractedTexts.length === 0) {
        await updateProcessingProgress(fileId, "processing", 26.0, "Uploading to GCS for batch processing");
        
        const fileRecord = await DocumentModel.getFileById(fileId);
        const originalFilename = fileRecord?.originalname || `file_${fileId}`;
        
        const batchUploadFolder = `batch-uploads/${uuidv4()}`;
        const { gsUri: gcsInputUri } = await uploadToGCS(
          originalFilename,
          fileBuffer,
          batchUploadFolder,
          true,
          mimetype
        );
        
        await updateProcessingProgress(fileId, "batch_processing", 30.0, "Starting batch OCR processing");
        
        const outputPrefix = `document-ai-results/${uuidv4()}/`;
        const gcsOutputUriPrefix = `gs://${fileOutputBucket.name}/${outputPrefix}`;
        
        const operationName = await batchProcessDocument([gcsInputUri], gcsOutputUriPrefix, mimetype);
        
        let batchCompleted = false;
        let attempts = 0;
        const maxAttempts = 240;
        
        while (!batchCompleted && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 5000));
          attempts++;
          
          const status = await getOperationStatus(operationName);
          
          if (status.done) {
            batchCompleted = true;
            
            if (status.error) {
              throw new Error(`Batch processing failed: ${JSON.stringify(status.error)}`);
            }
            
            await updateProcessingProgress(fileId, "processing", 40.0, "Fetching batch processing results");
            
            const bucketName = fileOutputBucket.name;
            extractedTexts = await fetchBatchResults(bucketName, outputPrefix);
            
            if (!extractedTexts || extractedTexts.length === 0) {
              throw new Error("No text extracted from batch processing results");
            }
            
            await updateProcessingProgress(fileId, "processing", 42.0, "Batch OCR processing completed");
          } else {
            const progress = Math.min(30 + (attempts * 0.15), 39);
            await updateProcessingProgress(fileId, "batch_processing", progress, "Batch OCR processing in progress");
          }
        }
        
        if (!batchCompleted) {
          throw new Error("Batch processing timeout after 20 minutes");
        }
      }
    } else {
      await updateProcessingProgress(fileId, "processing", 22.0, "Starting text extraction");
      const text = await extractText(fileBuffer, mimetype);
      extractedTexts.push({ text });
      await updateProcessingProgress(fileId, "processing", 42.0, "Text extraction completed");
    }

    await updateProcessingProgress(fileId, "processing", 43.0, "Validating extracted text");

    if (!extractedTexts.length || extractedTexts.every((item) => !item.text || item.text.trim() === "")) {
      throw new Error("No meaningful text extracted from document.");
    }

    await updateProcessingProgress(fileId, "processing", 50.0, "Chunking document");
    
    const chunks = await chunkDocument(extractedTexts, fileId, "recursive");

    if (!chunks.length) {
      await DocumentModel.updateFileProcessedAt(fileId);
      await updateProcessingProgress(fileId, "processed", 100.0, "Processing completed (no content to chunk)");
      return;
    }

    await updateProcessingProgress(fileId, "processing", 62.0, `Generating embeddings for ${chunks.length} chunks`);

    const chunkContents = chunks.map((c) => c.content);
    const embeddings = await generateEmbeddings(chunkContents);

    if (chunks.length !== embeddings.length) {
      throw new Error("Mismatch between number of chunks and embeddings generated.");
    }

    await updateProcessingProgress(fileId, "processing", 79.0, "Saving chunks to database");

    const chunksToSave = chunks.map((chunk, i) => ({
      file_id: fileId,
      chunk_index: i,
      content: chunk.content,
      token_count: chunk.token_count,
      page_start: chunk.metadata?.page_start || chunk.page_start || null,
      page_end: chunk.metadata?.page_end || chunk.page_end || null,
      heading: chunk.metadata?.heading || chunk.heading || null,
    }));

    const savedChunks = await FileChunkModel.saveMultipleChunks(chunksToSave);

    await updateProcessingProgress(fileId, "processing", 85.0, "Storing vector embeddings");

    const vectorsToSave = savedChunks.map((savedChunk, i) => ({
      chunk_id: savedChunk.id,
      embedding: embeddings[i],
      file_id: fileId,
    }));

    await ChunkVectorModel.saveMultipleChunkVectors(vectorsToSave);

    await updateProcessingProgress(fileId, "processing", 90.0, "Generating document summary");

    try {
      const fullText = chunks.map((c) => c.content).join("\n\n");
      if (fullText.trim()) {
        const summary = await getSummaryFromChunks(fullText);
        await DocumentModel.updateFileSummary(fileId, summary);
      }
    } catch (summaryError) {
      console.warn(`Summary generation failed: ${summaryError.message}`);
    }

    await DocumentModel.updateFileProcessedAt(fileId);
    await updateProcessingProgress(fileId, "processed", 100.0, "Document processing completed successfully");

    console.log(`✅ Document ID ${fileId} fully processed.`);
  } catch (error) {
    console.error(`❌ processDocument failed for file ID ${fileId}:`, error);
    await updateProcessingProgress(fileId, "error", 0.0, `Processing failed: ${error.message}`);
  }
}

exports.uploadDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        error: "No file uploaded." 
      });
    }

    const { originalname, mimetype, buffer, size } = req.file;

    const folderPath = `uploads/${uuidv4()}`;
    const { gsUri } = await uploadToGCS(originalname, buffer, folderPath, true, mimetype);

    const fileId = await DocumentModel.saveFileMetadata(
      originalname,
      gsUri,
      folderPath,
      mimetype,
      size,
      "uploaded"
    );

    // Start processing asynchronously (don't await)
    processDocument(fileId, buffer, mimetype).catch(err => {
      console.error(`[uploadDocument] Error processing file ${fileId}:`, err);
    });

    res.status(202).json({
      success: true,
      message: "Document uploaded and processing initiated.",
      file_id: fileId,
      gs_uri: gsUri,
      status: "processing",
      status_check_url: `/api/documents/status/${fileId}`
    });
  } catch (error) {
    console.error("❌ uploadDocument error:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to upload document.",
      details: error.message 
    });
  }
};

exports.getProcessingStatus = async (req, res) => {
  try {
    const { file_id } = req.params;
    if (!file_id) {
      return res.status(400).json({ 
        success: false,
        error: "file_id is required." 
      });
    }

    const file = await DocumentModel.getFileById(file_id);
    if (!file) {
      return res.status(404).json({ 
        success: false,
        error: "Document not found." 
      });
    }

    const baseResponse = {
      success: true,
      document_id: file.id,
      filename: file.originalname,
      status: file.status,
      processing_progress: parseFloat(file.processing_progress) || 0,
      current_operation: file.current_operation || "Pending",
      last_updated: file.updated_at,
      mimetype: file.mimetype,
      size: file.size,
      created_at: file.created_at,
    };

    if (file.status === "processed") {
      const chunks = await FileChunkModel.getChunksByFileId(file_id);
      return res.json({
        ...baseResponse,
        processing_progress: 100,
        current_operation: "Completed",
        chunks: chunks.length,
        summary: file.summary,
        processed_at: file.processed_at,
        ready_for_chat: true
      });
    }

    if (file.status === "error") {
      return res.json({
        ...baseResponse,
        error: true,
        error_message: file.current_operation || "Processing failed",
        ready_for_chat: false
      });
    }

    return res.json({
      ...baseResponse,
      ready_for_chat: false
    });
  } catch (error) {
    console.error("❌ getProcessingStatus error:", error);
    return res.status(500).json({ 
      success: false,
      error: "Failed to fetch processing status.",
      details: error.message 
    });
  }
};

/**
 * Check if a question is a greeting or general question that doesn't need document context
 * @param {string} question - User question
 * @returns {boolean} True if question doesn't need document context
 */
function isGeneralQuestion(question) {
  if (!question) return false;
  
  const q = question.toLowerCase().trim();
  
  // Greetings
  const greetings = [
    'hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening',
    'greetings', 'howdy', 'what\'s up', 'sup', 'hi there', 'hello there'
  ];
  
  // General questions that don't need documents
  const generalPatterns = [
    /^how are you/i,
    /^what can you do/i,
    /^who are you/i,
    /^what are you/i,
    /^tell me about yourself/i,
    /^help me/i,
    /^what is jurinex/i,
    /^what does jurinex do/i,
    /^explain jurinex/i
  ];
  
  // Check for greetings
  if (greetings.some(g => q.startsWith(g) || q === g)) {
    return true;
  }
  
  // Check for general patterns
  if (generalPatterns.some(pattern => pattern.test(q))) {
    return true;
  }
  
  // If question is very short (less than 10 chars) and doesn't contain question words, likely a greeting
  if (q.length < 10 && !q.includes('?') && !q.match(/\b(what|who|when|where|why|how|which|can|will|is|are|do|does)\b/i)) {
    return true;
  }
  
  return false;
}

exports.chatWithDocuments = async (req, res) => {
  try {
    const { question, file_ids, session_id, llm_name = 'gemini' } = req.body;

    if (!question?.trim()) {
      return res.status(400).json({ error: 'question is required.' });
    }

    const finalSessionId = session_id || uuidv4();
    const isGeneral = isGeneralQuestion(question);

    console.log(`[chatWithDocuments] Question: "${question.substring(0, 100)}..." | Files: ${file_ids?.length || 0} | General: ${isGeneral}`);

    let targetFileIds = [];

    if (file_ids && Array.isArray(file_ids) && file_ids.length > 0) {
      const files = await DocumentModel.getFilesByIds(file_ids);
      targetFileIds = files.map(f => f.id);
      
      if (targetFileIds.length === 0) {
        return res.status(400).json({ 
          success: false,
          error: 'No valid processed files found.',
          suggestion: 'Check file_ids and ensure files exist and are processed.'
        });
      }
      
      const allProcessed = files.every(f => f.status === 'processed');
      if (!allProcessed) {
        const processingFiles = files.filter(f => f.status === 'processing' || f.status === 'batch_processing');
        return res.status(400).json({ 
          success: false,
          error: 'Some files are still processing. Please wait for all files to be processed.',
          processing_files: processingFiles.map(f => ({
            file_id: f.id,
            filename: f.originalname,
            status: f.status,
            progress: f.processing_progress
          }))
        });
      }
    } else {
      const allFiles = await DocumentModel.getAllProcessedFiles();
      targetFileIds = allFiles.map(f => f.id);
      
      // If no documents and it's not a general question, still respond naturally
      if (targetFileIds.length === 0 && !isGeneral) {
        // Allow the question to proceed - AI will respond naturally
        console.log(`[chatWithDocuments] No documents available, but question is not general - proceeding with natural response`);
      }
    }

    // Get conversation history (use empty array if no files)
    const previousChats = targetFileIds.length > 0 
      ? await FileChat.getChatHistory(finalSessionId, targetFileIds)
      : await FileChat.getChatHistory(finalSessionId, []);
    
    const conversationContext = previousChats
      .slice(-5)
      .map((chat, idx) => `Turn ${idx + 1}:\nUser: ${chat.question || ''}\nAssistant: ${chat.answer || ''}`)
      .join('\n\n');

    // If no documents available and not a general question, still proceed with natural response
    if (targetFileIds.length === 0 && !isGeneral) {
      console.log(`[chatWithDocuments] No documents available, responding naturally without document context`);
    } else {
      console.log(`[chatWithDocuments] Using ${targetFileIds.length} file(s) for context`);
    }

    let answer;
    let usedChunkIds = [];
    let documentContext = '';

    // Only search documents if it's not a general question
    if (!isGeneral) {
      const questionEmbedding = await generateEmbedding(question);
      
      console.log(`[chatWithDocuments] Searching chunks across ${targetFileIds.length} file(s)`);
      const rankedChunks = await ChunkVectorModel.findNearestChunks(
        questionEmbedding,
        15,
        targetFileIds
      );

      if (rankedChunks && rankedChunks.length > 0) {
        usedChunkIds = rankedChunks.map(c => c.chunk_id || c.id);

        // Build document context without chunk numbers visible to the AI
        documentContext = rankedChunks
          .map((c) => {
            let content = c.content || '';
            // Optionally include page reference if available, but don't label it as "chunk"
            if (c.page_start) {
              content = `[Page ${c.page_start}]\n${content}`;
            }
            return content;
          })
          .join('\n\n---\n\n');
      }
    }

    // Build prompt based on whether we have document context
    let finalPrompt;
    
    if (documentContext) {
      // Question requires document context
      finalPrompt = `Question: ${question}\n\nRelevant Information:\n${documentContext}\n\nInstructions: Answer the question using the information provided above. IMPORTANT: Format your response with PROPER STRUCTURE using markdown headings (## Heading), bullet points (-), and bold text (**text**) for highlights. Organize information into clear sections with headings. Keep response CONCISE and SHORT (maximum 5-7 key points per section). Each point should be brief (1-2 sentences). Use professional, clean tone. Make it easy to understand at a glance.`;
    } else {
      // General question or greeting - no document context needed
      finalPrompt = `Question: ${question}\n\nSTRICT INSTRUCTIONS: You are a chatbot assistant. Respond in EXACTLY 1-2 SHORT sentences (10-20 words total). NO headings, NO bullet points, NO formatting, NO lists. Just a simple, brief, friendly chat message like typical chatbots. Be extremely concise - maximum 20 words. Examples: "Hello! How can I help?" or "Hi! I'm here to assist with JuriNex questions."`;
    }
    
    if (conversationContext) {
      finalPrompt = `You are continuing an existing conversation.\n\nPrevious Conversation:\n${conversationContext}\n\n---\n\n${finalPrompt}`;
    }

    console.log(`[chatWithDocuments] Calling LLM ${documentContext ? `with ${usedChunkIds.length} chunks` : 'without document context'}`);
    answer = await askLLM(llm_name, finalPrompt, '', documentContext, question, isGeneral);

    if (!answer?.trim()) {
      return res.status(500).json({ 
        success: false,
        error: 'Empty response from AI.',
        suggestion: 'Try rephrasing your question or check if LLM service is available.'
      });
    }

    // Save chat - use empty array if no files (for general questions)
    const filesForChat = targetFileIds.length > 0 ? targetFileIds : [];
    const savedChat = await FileChat.saveChat(
      filesForChat,
      question,
      answer,
      finalSessionId,
      usedChunkIds,
      previousChats
    );

    // Update session activity timestamp
    await SessionManager.updateSessionActivity(finalSessionId);

    const historyRows = await FileChat.getChatHistory(finalSessionId, filesForChat);
    
    // Format timestamps to IST (Indian Standard Time) ISO string
    // Convert UTC timestamps to IST (UTC+5:30) for consistent display
    const formatTimestamp = (dateValue) => {
      if (!dateValue) {
        // Return current time in IST
        const now = new Date();
        const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
        const istTime = new Date(now.getTime() + istOffset);
        return istTime.toISOString().replace('Z', '+05:30');
      }
      
      try {
        let date;
        
        // Handle Date objects
        if (dateValue instanceof Date) {
          date = dateValue;
        } else if (typeof dateValue === 'string') {
          // Parse string timestamp
          let dateStr = dateValue.trim();
          
          // If it's already ISO format with timezone, parse it
          if (dateStr.includes('T') && (dateStr.endsWith('Z') || dateStr.match(/[+-]\d{2}:\d{2}$/))) {
            date = new Date(dateStr);
          } else {
            // PostgreSQL timestamp format: '2026-01-21 06:42:47.031'
            // Replace space with T for ISO format
            if (dateStr.includes(' ') && !dateStr.includes('T')) {
              dateStr = dateStr.replace(' ', 'T');
            }
            
            // If no timezone, assume UTC (from database)
            if (!dateStr.endsWith('Z') && !dateStr.match(/[+-]\d{2}:\d{2}$/)) {
              dateStr = dateStr + 'Z';
            }
            
            date = new Date(dateStr);
          }
        } else {
          date = new Date(String(dateValue));
        }
        
        if (isNaN(date.getTime())) {
          console.warn(`[formatTimestamp] Invalid date value: ${dateValue}, using current time`);
          const now = new Date();
          const istOffset = 5.5 * 60 * 60 * 1000;
          const istTime = new Date(now.getTime() + istOffset);
          return istTime.toISOString().replace('Z', '+05:30');
        }
        
        // Convert UTC to IST (UTC+5:30)
        const istOffset = 5.5 * 60 * 60 * 1000; // 5 hours 30 minutes in milliseconds
        const istTime = new Date(date.getTime() + istOffset);
        
        // Return in ISO format with IST timezone indicator
        return istTime.toISOString().replace('Z', '+05:30');
      } catch (error) {
        console.error(`[formatTimestamp] Error parsing date: ${dateValue}`, error);
        const now = new Date();
        const istOffset = 5.5 * 60 * 60 * 1000;
        const istTime = new Date(now.getTime() + istOffset);
        return istTime.toISOString().replace('Z', '+05:30');
      }
    };
    
    const history = historyRows.map((row) => ({
      id: row.id,
      file_ids: row.file_ids,
      session_id: row.session_id,
      question: row.question,
      answer: row.answer,
      used_chunk_ids: row.used_chunk_ids || [],
      timestamp: formatTimestamp(row.created_at),
    }));

    return res.status(200).json({
      success: true,
      session_id: finalSessionId,
      message_id: savedChat.id,
      answer,
      response: answer,
      history,
      used_chunk_ids: usedChunkIds,
      chunks_used: usedChunkIds.length,
      files_used: targetFileIds.length > 0 ? targetFileIds.length : 0,
      timestamp: formatTimestamp(savedChat.created_at),
    });

  } catch (error) {
    console.error('❌ Error in chatWithDocuments:', error);
    return res.status(500).json({
      error: 'Failed to get AI answer.',
      details: error.message,
    });
  }
};

exports.getAllDocuments = async (req, res) => {
  try {
    // Get all documents (not just processed ones)
    const files = await DocumentModel.getAllFiles();
    
    // Add additional metadata
    const documentsWithMetadata = await Promise.all(
      files.map(async (file) => {
        let chunks = 0;
        if (file.status === 'processed') {
          try {
            const fileChunks = await FileChunkModel.getChunksByFileId(file.id);
            chunks = fileChunks.length;
          } catch (err) {
            console.warn(`Failed to get chunks for file ${file.id}:`, err.message);
          }
        }
        return {
          ...file,
          chunks_count: chunks,
          ready_for_chat: file.status === 'processed'
        };
      })
    );
    
    // Calculate status counts
    const statusCounts = {
      uploaded: documentsWithMetadata.filter(d => d.status === 'uploaded').length,
      processing: documentsWithMetadata.filter(d => d.status === 'processing').length,
      batch_processing: documentsWithMetadata.filter(d => d.status === 'batch_processing').length,
      processed: documentsWithMetadata.filter(d => d.status === 'processed').length,
      error: documentsWithMetadata.filter(d => d.status === 'error').length
    };
    
    return res.json({
      success: true,
      documents: documentsWithMetadata,
      count: documentsWithMetadata.length,
      status_counts: statusCounts,
      processed_count: statusCounts.processed,
      processing_count: statusCounts.processing + statusCounts.batch_processing,
    });
  } catch (error) {
    console.error("❌ getAllDocuments error:", error);
    return res.status(500).json({ 
      success: false,
      error: "Failed to fetch documents.",
      details: error.message 
    });
  }
};

exports.getDocumentById = async (req, res) => {
  try {
    const { file_id } = req.params;

    if (!file_id) {
      return res.status(400).json({
        success: false,
        error: "file_id is required."
      });
    }

    const file = await DocumentModel.getFileById(file_id);
    if (!file) {
      return res.status(404).json({
        success: false,
        error: "Document not found."
      });
    }

    // Get additional metadata
    let chunks = [];
    let chunksCount = 0;
    
    if (file.status === 'processed') {
      try {
        chunks = await FileChunkModel.getChunksByFileId(file_id);
        chunksCount = chunks.length;
      } catch (err) {
        console.warn(`Failed to get chunks for file ${file_id}:`, err.message);
      }
    }

    return res.json({
      success: true,
      document: {
        id: file.id,
        originalname: file.originalname,
        status: file.status,
        processing_progress: parseFloat(file.processing_progress) || 0,
        current_operation: file.current_operation || "Pending",
        mimetype: file.mimetype,
        size: file.size,
        gcs_path: file.gcs_path,
        folder_path: file.folder_path,
        summary: file.summary,
        chunks_count: chunksCount,
        created_at: file.created_at,
        updated_at: file.updated_at,
        processed_at: file.processed_at,
        ready_for_chat: file.status === 'processed'
      }
    });
  } catch (error) {
    console.error("❌ getDocumentById error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch document.",
      details: error.message
    });
  }
};

exports.processExistingDocument = async (req, res) => {
  try {
    const { file_id } = req.body;

    if (!file_id) {
      return res.status(400).json({ 
        success: false,
        error: "file_id is required." 
      });
    }

    const file = await DocumentModel.getFileById(file_id);
    if (!file) {
      return res.status(404).json({ 
        success: false,
        error: "File not found." 
      });
    }

    if (file.status === 'processed') {
      return res.status(400).json({
        success: false,
        error: "Document is already processed.",
        file_id: file_id,
        status: file.status
      });
    }

    if (file.status === 'processing' || file.status === 'batch_processing') {
      return res.status(400).json({
        success: false,
        error: "Document is already being processed.",
        file_id: file_id,
        status: file.status,
        progress: file.processing_progress
      });
    }

    // Download file from GCS
    const { fileInputBucket } = require("../config/gcs");
    
    // Extract GCS path from gs:// URI or use folder_path + filename
    let gcsPath = file.gcs_path;
    if (gcsPath.startsWith('gs://')) {
      const match = gcsPath.match(/^gs:\/\/([^\/]+)\/(.+)$/);
      if (match) {
        gcsPath = match[2]; // Extract path after bucket name
      } else {
        // Fallback: construct path from folder_path if available
        gcsPath = file.folder_path ? `${file.folder_path}/${file.originalname}` : null;
      }
    }
    
    if (!gcsPath) {
      return res.status(404).json({
        success: false,
        error: "Unable to determine file path in storage.",
        file_id: file_id
      });
    }
    
    const fileRef = fileInputBucket.file(gcsPath);
    
    const [exists] = await fileRef.exists();
    if (!exists) {
      return res.status(404).json({
        success: false,
        error: "File not found in storage.",
        file_id: file_id
      });
    }

    const [fileBuffer] = await fileRef.download();

    // Start processing asynchronously
    processDocument(file_id, fileBuffer, file.mimetype).catch(err => {
      console.error(`[processExistingDocument] Error processing file ${file_id}:`, err);
    });

    return res.status(202).json({
      success: true,
      message: "Document processing initiated.",
      file_id: file_id,
      status: "processing"
    });

  } catch (error) {
    console.error("❌ processExistingDocument error:", error);
    return res.status(500).json({ 
      success: false,
      error: "Failed to initiate document processing.",
      details: error.message 
    });
  }
};

exports.deleteDocument = async (req, res) => {
  try {
    const { file_id } = req.params;

    if (!file_id) {
      return res.status(400).json({
        success: false,
        error: "file_id is required."
      });
    }

    // Check if document exists
    const file = await DocumentModel.getFileById(file_id);
    if (!file) {
      return res.status(404).json({
        success: false,
        error: "Document not found."
      });
    }

    console.log(`[deleteDocument] Starting deletion for file ${file_id}`);

    // Delete in order: chats -> vectors -> chunks -> document
    // 1. Delete chat history
    const deletedChats = await FileChat.deleteChatsByFileId(file_id);
    console.log(`[deleteDocument] Deleted ${deletedChats} chat(s)`);

    // 2. Delete vectors
    const deletedVectors = await ChunkVectorModel.deleteVectorsByFileId(file_id);
    console.log(`[deleteDocument] Deleted ${deletedVectors} vector(s)`);

    // 3. Delete chunks
    const deletedChunks = await FileChunkModel.deleteChunksByFileId(file_id);
    console.log(`[deleteDocument] Deleted ${deletedChunks} chunk(s)`);

    // 4. Delete document record
    const deletedDoc = await DocumentModel.deleteDocument(file_id);
    console.log(`[deleteDocument] Deleted document: ${deletedDoc.originalname}`);

    // 5. Optionally delete from GCS (if needed)
    // Note: You may want to keep files in GCS for backup, or delete them
    // Uncomment below if you want to delete from GCS as well
    /*
    try {
      const { deleteFromGCS } = require("../services/gcsService");
      if (deletedDoc.gcs_path) {
        await deleteFromGCS(deletedDoc.gcs_path, true); // true = use input bucket
        console.log(`[deleteDocument] Deleted file from GCS: ${deletedDoc.gcs_path}`);
      }
    } catch (gcsError) {
      console.warn(`[deleteDocument] Failed to delete from GCS: ${gcsError.message}`);
      // Don't fail the request if GCS deletion fails
    }
    */

    return res.json({
      success: true,
      message: "Document and all associated data deleted successfully.",
      file_id: file_id,
      filename: deletedDoc.originalname,
      deleted: {
        document: 1,
        chunks: deletedChunks,
        vectors: deletedVectors,
        chats: deletedChats
      }
    });

  } catch (error) {
    console.error("❌ deleteDocument error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to delete document.",
      details: error.message
    });
  }
};

/**
 * Delete a user session and all its chat history
 * @route DELETE /api/documents/session/:session_id
 * @desc Delete all chats for a specific session (when user closes chat)
 */
exports.deleteSession = async (req, res) => {
  try {
    const { session_id } = req.params;

    if (!session_id) {
      return res.status(400).json({
        success: false,
        error: "session_id is required."
      });
    }

    console.log(`[deleteSession] Deleting session: ${session_id}`);
    
    const deletedCount = await SessionManager.deleteSession(session_id);

    return res.json({
      success: true,
      message: `Session deleted successfully.`,
      deleted_chats: deletedCount,
      session_id: session_id
    });
  } catch (error) {
    console.error("❌ deleteSession error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to delete session.",
      details: error.message
    });
  }
};

exports.processDocument = processDocument;
