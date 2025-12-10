const File = require('../models/File');
const FileChat = require('../models/FileChat');
const { uploadFileToGCS } = require('../services/gcsService');
const { askLLMWithGCS, streamLLMWithGCS } = require('../services/llmService');
const UserProfileService = require('../services/userProfileService');
const pool = require('../config/db');
const { v4: uuidv4 } = require('uuid');

/**
 * Upload document to GCS and store URL in database
 * POST /api/chat/upload-document
 */
exports.uploadDocumentAndGetURI = async (req, res) => {
  try {
    const userId = req.user.id;
    const authorizationHeader = req.headers.authorization;
    
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        message: 'No file uploaded' 
      });
    }

    console.log(`📤 Uploading document for user ${userId}: ${req.file.originalname}`);

    // Fetch user profile from auth service
    const userProfile = await UserProfileService.getUserProfile(userId, authorizationHeader);
    if (!userProfile) {
      console.warn(`⚠️ Could not fetch user profile for user ${userId}`);
    }

    // Get GCS bucket name from environment
    const bucketName = process.env.GCS_BUCKET_NAME;
    
    if (!bucketName) {
      return res.status(500).json({
        success: false,
        message: 'GCS configuration missing. Please set GCS_BUCKET_NAME in .env'
      });
    }

    // Generate GCS file path
    const timestamp = Date.now();
    const safeFilename = req.file.originalname.replace(/\s+/g, '_');
    const gcsFilePath = `chat-uploads/${userId}/${timestamp}_${safeFilename}`;

    // Upload file to GCS using buffer directly (more reliable)
    const gcsUri = await uploadFileToGCS(
      bucketName,
      gcsFilePath,
      req.file.buffer,
      req.file.mimetype
    );

    console.log(`✅ File uploaded to GCS: ${gcsUri}`);

    // Store file metadata in database
    const savedFile = await File.create({
      user_id: userId,
      originalname: req.file.originalname,
      gcs_path: gcsFilePath,
      mimetype: req.file.mimetype,
      size: req.file.size,
      status: 'uploaded'
    });

    console.log(`✅ File metadata saved to database: ${savedFile.id}`);

    return res.status(200).json({
      success: true,
      message: 'File uploaded successfully',
      data: {
        file_id: savedFile.id,
        filename: req.file.originalname,
        gcs_uri: gcsUri,
        size: req.file.size,
        mimetype: req.file.mimetype
      }
    });

  } catch (error) {
    console.error('❌ Error uploading document:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to upload document',
      error: error.message
    });
  }
};

// Helper functions for conversation history
const CONVERSATION_HISTORY_TURNS = 5;

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
 * Ask question to LLM with document context
 * POST /api/chat/ask
 * 
 * Request body:
 * {
 *   "question": "user question",
 *   "file_id": "uuid",
 *   "session_id": "uuid" (optional - for continuing conversations)
 * }
 */
exports.askQuestion = async (req, res) => {
  try {
    const userId = req.user.id;
    const authorizationHeader = req.headers.authorization;
    const { question, file_id, session_id } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Question is required'
      });
    }

    if (!file_id) {
      return res.status(400).json({
        success: false,
        message: 'file_id is required'
      });
    }

    // Sanitize file_id: remove curly braces if present (template variable issue)
    let sanitizedFileId = file_id.trim();
    // Remove any leading/trailing curly braces (handles {{...}}, {...}, or plain UUID)
    sanitizedFileId = sanitizedFileId.replace(/^\{+\s*|\s*\}+$/g, '').trim();
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(sanitizedFileId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file_id format. file_id must be a valid UUID.',
        error: `Received: ${file_id}`
      });
    }

    // Generate or validate session_id
    const hasExistingSession = session_id && uuidRegex.test(session_id);
    const finalSessionId = hasExistingSession ? session_id : uuidv4();

    console.log(`💬 User ${userId} asking question about file ${sanitizedFileId} (session: ${finalSessionId})`);

    // Fetch file from database
    const file = await File.findById(sanitizedFileId);
    
    if (!file) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    // Verify file belongs to user (convert both to strings to handle type mismatch)
    if (String(file.user_id) !== String(userId)) {
      console.log('❌ Permission denied: user_id mismatch');
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to access this file'
      });
    }
    
    console.log('✅ Permission granted: user_id matches');

    // Construct GCS URI from gcs_path
    if (!file.gcs_path) {
      return res.status(400).json({
        success: false,
        message: 'GCS path not found for this file'
      });
    }
    
    const bucketName = process.env.GCS_BUCKET_NAME;
    const gcsUri = `gs://${bucketName}/${file.gcs_path}`;

    // Load previous chat history for this file and session
    // If it's an existing session, load only that session's chats
    // If it's a new session, still load recent chats from the file for context
    let previousChats = [];
    if (hasExistingSession) {
      previousChats = await FileChat.getChatHistory(sanitizedFileId, finalSessionId);
      console.log(`📜 Loaded ${previousChats.length} previous messages from session ${finalSessionId}`);
    } else {
      // For new sessions, load recent chats from the file (last 5) to provide context
      const allChats = await FileChat.getChatHistory(sanitizedFileId, null);
      previousChats = allChats.slice(-5); // Get last 5 chats for context
      console.log(`📜 Loaded ${previousChats.length} recent messages from file for context (new session)`);
    }

    // Build conversation context from previous chats
    const conversationContext = formatConversationHistory(previousChats);
    const historyForStorage = simplifyHistory(previousChats);

    // Log previous context being used
    if (conversationContext) {
      console.log(`📜 Previous Conversation Context (${previousChats.length} messages):`);
      console.log('─'.repeat(80));
      
      // Log each previous message for clarity
      previousChats.forEach((chat, index) => {
        console.log(`\n[Previous Message ${index + 1}]`);
        console.log(`  Q: ${(chat.question || '').substring(0, 150)}${(chat.question || '').length > 150 ? '...' : ''}`);
        console.log(`  A: ${(chat.answer || '').substring(0, 150)}${(chat.answer || '').length > 150 ? '...' : ''}`);
        console.log(`  Time: ${chat.created_at || 'N/A'}`);
      });
      
      console.log('\n📝 Formatted Context for LLM:');
      console.log(conversationContext);
      console.log('─'.repeat(80));
    } else {
      console.log(`📜 No previous conversation context available (new conversation)`);
    }

    // Fetch user profile for context
    const userProfile = await UserProfileService.getUserProfile(userId, authorizationHeader);
    let userContext = '';
    if (userProfile) {
      userContext = `User: ${userProfile.username || userProfile.email || 'User'}`;
      if (userProfile.professional_profile) {
        userContext += `\nProfessional Profile: ${JSON.stringify(userProfile.professional_profile)}`;
      }
    }

    // Build the prompt with conversation history
    let promptText = question.trim();
    if (conversationContext) {
      promptText = appendConversationToPrompt(promptText, conversationContext);
    }
    
    // Add user context to the prompt
    if (userContext) {
      promptText = `USER CONTEXT:\n${userContext}\n\n${promptText}`;
    }

    // Log the final prompt being sent (truncated for readability)
    console.log(`🤖 Asking LLM question with document context and ${previousChats.length} previous messages...`);
    console.log(`📝 Final Prompt Preview (first 500 chars):`);
    console.log('─'.repeat(80));
    console.log(promptText.substring(0, 500) + (promptText.length > 500 ? '...' : ''));
    console.log('─'.repeat(80));
    console.log(`📊 Full prompt length: ${promptText.length} characters`);
    const answer = await askLLMWithGCS(promptText, gcsUri, ''); // userContext already in promptText

    // Save chat history to database
    let savedChat;
    try {
      console.log(`💾 [ChatModel] Saving chat to database...`);
      console.log(`   - File ID: ${sanitizedFileId}`);
      console.log(`   - User ID: ${userId}`);
      console.log(`   - Session ID: ${finalSessionId}`);
      console.log(`   - Question length: ${question.trim().length} chars`);
      console.log(`   - Answer length: ${answer.length} chars`);
      
      savedChat = await FileChat.saveChat(
        sanitizedFileId,
        userId,
        question.trim(),
        answer,
        finalSessionId,
        [], // usedChunkIds - not applicable for ChatModel
        false, // usedSecretPrompt
        null, // promptLabel
        null, // secretId
        historyForStorage
      );

      console.log(`✅ [ChatModel] Chat saved successfully!`);
      console.log(`   - Chat ID: ${savedChat.id}`);
      console.log(`   - Session ID: ${savedChat.session_id}`);
      console.log(`   - Created at: ${savedChat.created_at}`);
    } catch (saveError) {
      console.error(`❌ [ChatModel] Failed to save chat to database:`, saveError);
      console.error(`   Error details:`, saveError.message);
      console.error(`   Stack:`, saveError.stack);
      // Don't fail the request if save fails, but log it clearly
      // The chat was successful, just storage failed
      savedChat = {
        id: null,
        session_id: finalSessionId,
        created_at: new Date().toISOString()
      };
    }

    // Fetch updated history for response
    const historyRows = await FileChat.getChatHistory(sanitizedFileId, finalSessionId);
    const history = historyRows.map((row) => ({
      id: row.id,
      question: row.question,
      answer: row.answer,
      created_at: row.created_at,
      session_id: row.session_id,
    }));

    return res.status(200).json({
      success: true,
      data: {
        question: question.trim(),
        answer: answer,
        file_id: sanitizedFileId,
        filename: file.originalname,
        session_id: finalSessionId,
        chat_id: savedChat.id,
        history: history
      }
    });

  } catch (error) {
    console.error('❌ Error asking question:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to get answer from LLM',
      error: error.message
    });
  }
};

/**
 * Ask question to LLM with document context (Streaming with SSE)
 * POST /api/chat/ask/stream
 * 
 * Request body:
 * {
 *   "question": "user question",
 *   "file_id": "uuid",
 *   "session_id": "uuid" (optional - for continuing conversations)
 * }
 * 
 * Response: Server-Sent Events (SSE) stream with:
 * - status updates: "analyzing", "generating", "fetching"
 * - text chunks as they arrive
 * - completion message with full answer
 */
exports.askQuestionStream = async (req, res) => {
  // Set up SSE headers - CRITICAL for Postman and browsers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.setHeader('Access-Control-Allow-Origin', '*'); // CORS for testing
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Flush headers immediately
  res.flushHeaders();
  
  console.log('📡 SSE connection established for streaming chat');

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(`data: [PING]\n\n`);
    } catch (err) {
      clearInterval(heartbeat);
    }
  }, 15000);

  // Helper function to send status update
  const sendStatus = (status, message = '') => {
    try {
      res.write(`data: ${JSON.stringify({ type: 'status', status, message })}\n\n`);
      if (res.flush && typeof res.flush === 'function') {
        res.flush();
      }
    } catch (err) {
      console.error('Error sending status:', err);
    }
  };

  // Helper function to send error
  const sendError = (message, details = '') => {
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', message, details })}\n\n`);
      res.write(`data: [DONE]\n\n`);
      clearInterval(heartbeat);
      res.end();
    } catch (err) {
      console.error('Error sending error:', err);
    }
  };

  try {
    const userId = req.user.id;
    const authorizationHeader = req.headers.authorization;
    const { question, file_id, session_id } = req.body;

    // Send initial status
    sendStatus('initializing', 'Starting chat request...');

    if (!question || !question.trim()) {
      sendError('Question is required');
      return;
    }

    if (!file_id) {
      sendError('file_id is required');
      return;
    }

    // Sanitize file_id
    let sanitizedFileId = file_id.trim();
    sanitizedFileId = sanitizedFileId.replace(/^\{+\s*|\s*\}+$/g, '').trim();
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(sanitizedFileId)) {
      sendError('Invalid file_id format. file_id must be a valid UUID.');
      return;
    }

    // Generate or validate session_id
    const hasExistingSession = session_id && uuidRegex.test(session_id);
    const finalSessionId = hasExistingSession ? session_id : uuidv4();

    sendStatus('validating', 'Validating file access...');

    // Fetch file from database
    const file = await File.findById(sanitizedFileId);
    
    if (!file) {
      sendError('File not found');
      return;
    }

    // Verify file belongs to user
    if (String(file.user_id) !== String(userId)) {
      sendError('You do not have permission to access this file');
      return;
    }

    // Construct GCS URI
    if (!file.gcs_path) {
      sendError('GCS path not found for this file');
      return;
    }
    
    const bucketName = process.env.GCS_BUCKET_NAME;
    const gcsUri = `gs://${bucketName}/${file.gcs_path}`;

    sendStatus('fetching', 'Fetching previous conversation context...');

    // Load previous chat history
    let previousChats = [];
    if (hasExistingSession) {
      previousChats = await FileChat.getChatHistory(sanitizedFileId, finalSessionId);
      console.log(`📜 Loaded ${previousChats.length} previous messages from session ${finalSessionId}`);
    } else {
      const allChats = await FileChat.getChatHistory(sanitizedFileId, null);
      previousChats = allChats.slice(-5);
      console.log(`📜 Loaded ${previousChats.length} recent messages from file for context (new session)`);
    }

    // Log previous context
    const conversationContext = formatConversationHistory(previousChats);
    const historyForStorage = simplifyHistory(previousChats);

    if (conversationContext) {
      console.log(`📜 Previous Conversation Context (${previousChats.length} messages):`);
      console.log('─'.repeat(80));
      previousChats.forEach((chat, index) => {
        console.log(`\n[Previous Message ${index + 1}]`);
        console.log(`  Q: ${(chat.question || '').substring(0, 150)}${(chat.question || '').length > 150 ? '...' : ''}`);
        console.log(`  A: ${(chat.answer || '').substring(0, 150)}${(chat.answer || '').length > 150 ? '...' : ''}`);
        console.log(`  Time: ${chat.created_at || 'N/A'}`);
      });
      console.log('\n📝 Formatted Context for LLM:');
      console.log(conversationContext);
      console.log('─'.repeat(80));
    } else {
      console.log(`📜 No previous conversation context available (new conversation)`);
    }

    sendStatus('analyzing', 'Analyzing document and preparing context...');

    // Fetch user profile for context
    const userProfile = await UserProfileService.getUserProfile(userId, authorizationHeader);
    let userContext = '';
    if (userProfile) {
      userContext = `User: ${userProfile.username || userProfile.email || 'User'}`;
      if (userProfile.professional_profile) {
        userContext += `\nProfessional Profile: ${JSON.stringify(userProfile.professional_profile)}`;
      }
    }

    // Build the prompt with conversation history
    let promptText = question.trim();
    if (conversationContext) {
      promptText = appendConversationToPrompt(promptText, conversationContext);
    }
    
    // Add user context to the prompt
    if (userContext) {
      promptText = `USER CONTEXT:\n${userContext}\n\n${promptText}`;
    }

    console.log(`🤖 Streaming LLM response with document context and ${previousChats.length} previous messages...`);
    console.log(`📝 Final Prompt Preview (first 500 chars):`);
    console.log('─'.repeat(80));
    console.log(promptText.substring(0, 500) + (promptText.length > 500 ? '...' : ''));
    console.log('─'.repeat(80));
    console.log(`📊 Full prompt length: ${promptText.length} characters`);

    sendStatus('generating', 'Generating response from AI...');

    // Send session metadata
    res.write(`data: ${JSON.stringify({ type: 'metadata', session_id: finalSessionId, file_id: sanitizedFileId })}\n\n`);

    // Stream LLM response
    let fullAnswer = '';
    let chunkCount = 0;
    try {
      console.log('🔄 Starting to stream LLM response...');
      
      for await (const chunk of streamLLMWithGCS(promptText, gcsUri, '')) {
        if (chunk && chunk.trim()) {
          fullAnswer += chunk;
          chunkCount++;
          
          // Send chunk with proper SSE format
          const chunkData = JSON.stringify({ type: 'chunk', text: chunk });
          res.write(`data: ${chunkData}\n\n`);
          
          // CRITICAL: Flush immediately for real-time streaming
          if (res.flush && typeof res.flush === 'function') {
            res.flush();
          }
          
          // Log every 10 chunks for debugging
          if (chunkCount % 10 === 0) {
            console.log(`📊 Streamed ${chunkCount} chunks, total length: ${fullAnswer.length} chars`);
          }
        }
      }
      
      console.log(`✅ Streaming completed: ${chunkCount} chunks, ${fullAnswer.length} total characters`);
      
      if (!fullAnswer || fullAnswer.trim().length === 0) {
        throw new Error('Received empty response from LLM');
      }
      
    } catch (streamError) {
      console.error('❌ Streaming error:', streamError);
      console.error('❌ Error details:', streamError.stack);
      sendError('Streaming failed', streamError.message);
      return;
    }

    sendStatus('saving', 'Saving conversation to database...');

    // Save chat history to database
    let savedChat;
    try {
      console.log(`💾 [ChatModel] Saving streaming chat to database...`);
      console.log(`   - File ID: ${sanitizedFileId}`);
      console.log(`   - User ID: ${userId}`);
      console.log(`   - Session ID: ${finalSessionId}`);
      console.log(`   - Question length: ${question.trim().length} chars`);
      console.log(`   - Answer length: ${fullAnswer.length} chars`);
      
      savedChat = await FileChat.saveChat(
        sanitizedFileId,
        userId,
        question.trim(),
        fullAnswer,
        finalSessionId,
        [],
        false,
        null,
        null,
        historyForStorage
      );

      console.log(`✅ [ChatModel] Streaming chat saved successfully!`);
      console.log(`   - Chat ID: ${savedChat.id}`);
      console.log(`   - Session ID: ${savedChat.session_id}`);
      console.log(`   - Created at: ${savedChat.created_at}`);
    } catch (saveError) {
      console.error(`❌ [ChatModel] Failed to save streaming chat to database:`, saveError);
      console.error(`   Error details:`, saveError.message);
      console.error(`   Stack:`, saveError.stack);
      // Don't fail the request if save fails, but log it clearly
      savedChat = {
        id: null,
        session_id: finalSessionId,
        created_at: new Date().toISOString()
      };
    }

    // Send completion with full answer
    const completionData = {
      type: 'done',
      session_id: finalSessionId,
      chat_id: savedChat.id,
      answer: fullAnswer,
      file_id: sanitizedFileId,
      filename: file.originalname,
      answer_length: fullAnswer.length,
      chunks_received: chunkCount
    };
    
    res.write(`data: ${JSON.stringify(completionData)}\n\n`);
    
    // Flush before sending DONE
    if (res.flush && typeof res.flush === 'function') {
      res.flush();
    }
    
    // Send final DONE marker
    res.write(`data: [DONE]\n\n`);
    
    // Final flush
    if (res.flush && typeof res.flush === 'function') {
      res.flush();
    }
    
    console.log(`✅ Stream completed. Total: ${fullAnswer.length} chars in ${chunkCount} chunks`);
    
    clearInterval(heartbeat);
    res.end();

  } catch (error) {
    console.error('❌ Error in streaming chat:', error.message);
    sendError('Failed to process chat request', error.message);
  }
};

/**
 * Get user's uploaded files
 * GET /api/chat/files
 */
exports.getUserFiles = async (req, res) => {
  try {
    const userId = req.user.id;

    const files = await File.findByUserId(userId);

    return res.status(200).json({
      success: true,
      data: {
        files: files.map(file => ({
          id: file.id,
          filename: file.originalname,
          size: file.size,
          mimetype: file.mimetype,
          status: file.status,
          created_at: file.created_at
        }))
      }
    });

  } catch (error) {
    console.error('❌ Error fetching user files:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch files',
      error: error.message
    });
  }
};

/**
 * Get chat history for a document
 * GET /api/chat/history/:file_id
 * Query params: session_id (optional)
 */
exports.getChatHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { file_id } = req.params;
    const { session_id } = req.query;

    // Validate file_id format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(file_id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file_id format. file_id must be a valid UUID.'
      });
    }

    // Verify file belongs to user
    const file = await File.findById(file_id);
    if (!file) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    if (String(file.user_id) !== String(userId)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to access this file'
      });
    }

    // Get chat history
    const historyRows = await FileChat.getChatHistory(file_id, session_id || null);
    const history = historyRows.map((row) => ({
      id: row.id,
      question: row.question,
      answer: row.answer,
      session_id: row.session_id,
      created_at: row.created_at,
    }));

    return res.status(200).json({
      success: true,
      data: {
        file_id: file_id,
        filename: file.originalname,
        session_id: session_id || null,
        history: history,
        count: history.length
      }
    });

  } catch (error) {
    console.error('❌ Error fetching chat history:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch chat history',
      error: error.message
    });
  }
};

/**
 * Get all sessions for a user's document
 * GET /api/chat/sessions/:file_id
 */
exports.getDocumentSessions = async (req, res) => {
  try {
    const userId = req.user.id;
    const { file_id } = req.params;

    // Validate file_id format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(file_id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file_id format. file_id must be a valid UUID.'
      });
    }

    // Verify file belongs to user
    const file = await File.findById(file_id);
    if (!file) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    if (String(file.user_id) !== String(userId)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to access this file'
      });
    }

    // Get all sessions for this file
    const historyRows = await FileChat.getChatHistory(file_id, null);
    
    // Group by session_id
    const sessionsMap = new Map();
    historyRows.forEach((row) => {
      const sessionId = row.session_id;
      if (!sessionsMap.has(sessionId)) {
        sessionsMap.set(sessionId, {
          session_id: sessionId,
          message_count: 0,
          first_message_at: row.created_at,
          last_message_at: row.created_at,
          messages: []
        });
      }
      const session = sessionsMap.get(sessionId);
      session.message_count++;
      if (new Date(row.created_at) < new Date(session.first_message_at)) {
        session.first_message_at = row.created_at;
      }
      if (new Date(row.created_at) > new Date(session.last_message_at)) {
        session.last_message_at = row.created_at;
      }
      session.messages.push({
        id: row.id,
        question: row.question,
        answer: row.answer,
        created_at: row.created_at
      });
    });

    const sessions = Array.from(sessionsMap.values()).sort((a, b) => 
      new Date(b.last_message_at) - new Date(a.last_message_at)
    );

    return res.status(200).json({
      success: true,
      data: {
        file_id: file_id,
        filename: file.originalname,
        sessions: sessions,
        count: sessions.length
      }
    });

  } catch (error) {
    console.error('❌ Error fetching document sessions:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch document sessions',
      error: error.message
    });
  }
};

