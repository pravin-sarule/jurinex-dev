//     if (!req.file) {


//     if (!userProfile) {

    
//     if (!bucketName) {









//   if (!Array.isArray(chats) || chats.length === 0) return '';

//   if (!Array.isArray(chats)) return [];

//   if (!conversationText) return prompt;


//     if (!question || !question.trim()) {

//     if (!file_id) {

    
//     if (!uuidRegex.test(sanitizedFileId)) {



    
//     if (!file) {

//     if (String(file.user_id) !== String(userId)) {
    

//     if (!file.gcs_path) {
    



      
      


    


      

//       console.log(`✅ [ChatModel] Chat saved successfully!`);




  
  






//     if (!question || !question.trim()) {

//     if (!file_id) {

    
//     if (!uuidRegex.test(sanitizedFileId)) {



    
//     if (!file) {

//     if (String(file.user_id) !== String(userId)) {

//     if (!file.gcs_path) {
    







    




      
          
          
          
      
      
//       if (!fullAnswer || fullAnswer.trim().length === 0) {
      


      

//       console.log(`✅ [ChatModel] Streaming chat saved successfully!`);

    
    
    
    
    
    







//     if (!uuidRegex.test(file_id)) {

//     if (!file) {

//     if (String(file.user_id) !== String(userId)) {





//     if (!uuidRegex.test(file_id)) {

//     if (!file) {

//     if (String(file.user_id) !== String(userId)) {

    
//       if (!sessionsMap.has(sessionId)) {




const File = require('../models/File');
const FileChat = require('../models/FileChat');
const { uploadFileToGCS } = require('../services/gcsService');
const { askLLMWithGCS, streamLLMWithGCS } = require('../services/llmService');
const UserProfileService = require('../services/userProfileService');
const pool = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { 
  fetchTemplateFilesData, 
  buildEnhancedSystemPromptWithTemplates 
} = require('../services/secretPromptTemplateService');

// Import Google Drive service from ChatModel services
const { downloadFile: downloadFileFromGoogleDrive } = require('../services/googleDriveService');

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

    const userProfile = await UserProfileService.getUserProfile(userId, authorizationHeader);
    if (!userProfile) {
      console.warn(`⚠️ Could not fetch user profile for user ${userId}`);
    }

    const bucketName = process.env.GCS_BUCKET_NAME;
    
    if (!bucketName) {
      return res.status(500).json({
        success: false,
        message: 'GCS configuration missing. Please set GCS_BUCKET_NAME in .env'
      });
    }

    const timestamp = Date.now();
    const safeFilename = req.file.originalname.replace(/\s+/g, '_');
    const gcsFilePath = `chat-uploads/${userId}/${timestamp}_${safeFilename}`;

    const gcsUri = await uploadFileToGCS(
      bucketName,
      gcsFilePath,
      req.file.buffer,
      req.file.mimetype
    );

    console.log(`✅ File uploaded to GCS: ${gcsUri}`);

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

/**
 * Upload document from Google Drive to ChatModel
 * Downloads file from Google Drive, uploads to GCS, and saves to database
 * Same workflow as uploadDocumentAndGetURI but for Google Drive files
 */
exports.uploadDocumentFromGoogleDrive = async (req, res) => {
  try {
    const userId = req.user.id;
    const authorizationHeader = req.headers.authorization;
    const { fileId, accessToken } = req.body;
    
    if (!fileId) {
      return res.status(400).json({ 
        success: false,
        message: 'Google Drive file ID is required' 
      });
    }

    if (!accessToken) {
      return res.status(400).json({ 
        success: false,
        message: 'Google Drive access token is required' 
      });
    }

    console.log(`📤 [ChatModel] Downloading file from Google Drive for user ${userId}: ${fileId}`);

    const userProfile = await UserProfileService.getUserProfile(userId, authorizationHeader);
    if (!userProfile) {
      console.warn(`⚠️ Could not fetch user profile for user ${userId}`);
    }

    const bucketName = process.env.GCS_BUCKET_NAME;
    
    if (!bucketName) {
      return res.status(500).json({
        success: false,
        message: 'GCS configuration missing. Please set GCS_BUCKET_NAME in .env'
      });
    }

    // Step 1: Download file from Google Drive
    let downloadedFile;
    try {
      downloadedFile = await downloadFileFromGoogleDrive(accessToken, fileId);
    } catch (driveError) {
      console.error('❌ [ChatModel] Google Drive download error:', driveError.message);
      if (driveError.message?.includes('invalid_grant') || driveError.message?.includes('Invalid Credentials')) {
        return res.status(401).json({
          success: false,
          message: 'Google Drive access token expired. Please try again.',
          needsAuth: true
        });
      }
      throw driveError;
    }

    const { buffer, filename, mimeType } = downloadedFile;
    const fileSizeBytes = buffer.length;

    console.log(`✅ [ChatModel] Downloaded file from Google Drive: ${filename}, size: ${fileSizeBytes} bytes, type: ${mimeType}`);

    // Step 2: Upload to GCS (same path structure as regular upload)
    const timestamp = Date.now();
    const safeFilename = filename.replace(/\s+/g, '_');
    const gcsFilePath = `chat-uploads/${userId}/${timestamp}_${safeFilename}`;

    const gcsUri = await uploadFileToGCS(
      bucketName,
      gcsFilePath,
      buffer,
      mimeType
    );

    console.log(`✅ [ChatModel] File uploaded to GCS: ${gcsUri}`);

    // Step 3: Save file record to database
    const savedFile = await File.create({
      user_id: userId,
      originalname: filename,
      gcs_path: gcsFilePath,
      mimetype: mimeType,
      size: fileSizeBytes,
      status: 'uploaded'
    });

    console.log(`✅ [ChatModel] File metadata saved to database: ${savedFile.id}`);

    // Step 4: Return success response (same format as uploadDocumentAndGetURI)
    return res.status(200).json({
      success: true,
      message: 'File downloaded from Google Drive and uploaded successfully',
      data: {
        file_id: savedFile.id,
        filename: filename,
        gcs_uri: gcsUri,
        size: fileSizeBytes,
        mimetype: mimeType
      }
    });

  } catch (error) {
    console.error('❌ [ChatModel] Error uploading document from Google Drive:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to upload document from Google Drive',
      error: error.message
    });
  }
};

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

function addSecretPromptJsonFormatting(secretPrompt, outputTemplate = null) {
  let jsonFormattingInstructions = '';

  if (outputTemplate && outputTemplate.extracted_text) {
    const templateText = outputTemplate.extracted_text;
    const sectionKeys = [];
    const sectionPattern = /["']?(\d+_\d+_[a-z_]+)["']?/gi;
    let match;
    while ((match = sectionPattern.exec(templateText)) !== null) {
      if (!sectionKeys.includes(match[1])) {
        sectionKeys.push(match[1]);
      }
    }
    
    const sectionsList = sectionKeys.length > 0 
      ? `\n\n📋 REQUIRED SECTIONS (MUST INCLUDE ALL):\n${sectionKeys.map((key, idx) => `   ${idx + 1}. ${key}`).join('\n')}\n`
      : '';

    jsonFormattingInstructions = `

═══════════════════════════════════════════════════════════════════════
🚨 CRITICAL OUTPUT FORMATTING REQUIREMENTS - MANDATORY FOR ALL LLMs 🚨
═══════════════════════════════════════════════════════════════════════

⚠️ ABSOLUTE REQUIREMENT: Your response MUST be valid JSON wrapped in markdown code blocks.
⚠️ NO EXCEPTIONS: This applies to ALL LLM models (Gemini, Claude, GPT, DeepSeek, etc.)
⚠️ NO RAW JSON: Never return raw JSON without markdown code blocks
⚠️ NO EXPLANATIONS: Do not include any text before or after the JSON code block

📋 OUTPUT TEMPLATE STRUCTURE (MUST FOLLOW EXACTLY):
The output template below shows the EXACT JSON structure you must use. Your response must match this structure EXACTLY with ALL fields populated:

${outputTemplate.extracted_text}${sectionsList}

🔒 MANDATORY REQUIREMENTS FOR ALL LLMs:
1. ✅ Your response MUST start with \`\`\`json and end with \`\`\`
2. ✅ Follow the EXACT JSON structure shown in the output template above
3. ✅ Include ALL sections and fields from the template - DO NOT skip any
4. ✅ Fill ALL fields with ACTUAL content extracted from the documents
5. ✅ Do NOT use placeholder text - provide real extracted information
6. ✅ Maintain the exact nesting, field names, and structure from the template
7. ✅ Use markdown formatting within content strings (bold, italic, lists, tables, etc.)
8. ✅ Ensure all JSON is valid and parseable
9. ✅ Include ALL required sections listed above - missing sections will cause errors

📝 CORRECT OUTPUT FORMAT (USE THIS EXACT FORMAT):

\`\`\`json
{
  "title": "Your analysis title here",
  "summary": "Your summary here",
  "sections": [
    {
      "heading": "Section heading",
      "content": "Section content with **markdown** formatting"
    }
  ]
}
\`\`\`

IMPORTANT GUIDELINES:
1. Always wrap your JSON response in \`\`\`json ... \`\`\` markdown code blocks
2. Use proper JSON syntax - all strings must be properly escaped
3. Structure the content logically with clear sections and subsections
4. Use markdown formatting within content strings
5. Include all relevant information from the document
6. Make the JSON clean and well-formatted for easy parsing
7. Ensure all JSON is valid and parseable
8. Use rich formatting to make the output visually appealing and easy to read

Your response should ONLY contain the JSON wrapped in markdown code blocks. Do not include any additional text before or after the code block.`;
  } else {
    jsonFormattingInstructions = `

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
  }

  return secretPrompt + jsonFormattingInstructions;
}

async function fetchSecretManagerWithTemplates(secretId) {
  try {
    console.log(`🔍 [ChatModel] Fetching secret manager with ID: ${secretId}`);
    
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(secretId)) {
      console.error(`❌ [ChatModel] Invalid secret ID format: ${secretId}`);
      return null;
    }
    
    try {
      const tableCheck = await pool.query(`SELECT COUNT(*) FROM secret_manager LIMIT 1`);
      console.log(`✅ [ChatModel] secret_manager table exists and is accessible`);
    } catch (tableError) {
      console.error(`❌ [ChatModel] Cannot access secret_manager table:`, tableError.message);
      if (tableError.message && tableError.message.includes('does not exist')) {
        throw new Error(`Database table 'secret_manager' does not exist. Please ensure ChatModel has access to the same database as Document Service.`);
      }
      throw tableError;
    }
    
    const secretQuery = `
      SELECT 
        s.id, 
        s.name, 
        s.secret_manager_id, 
        s.version, 
        s.llm_id, 
        s.input_template_id,
        s.output_template_id,
        l.name AS llm_name
      FROM secret_manager s
      LEFT JOIN llm_models l ON s.llm_id = l.id
      WHERE s.id = $1
        AND (s.deleted_at IS NULL OR s.deleted_at > NOW());
    `;
    
    console.log(`🔍 [ChatModel] Executing query for secret_id: ${secretId}`);
    const secretResult = await pool.query(secretQuery, [secretId]);
    
    console.log(`🔍 [ChatModel] Query returned ${secretResult.rows.length} row(s)`);
    
    if (secretResult.rows.length === 0) {
      console.warn(`⚠️ [ChatModel] Secret not found in database for ID: ${secretId}`);
      const checkQuery = `SELECT id, name, deleted_at FROM secret_manager WHERE id = $1`;
      const checkResult = await pool.query(checkQuery, [secretId]);
      if (checkResult.rows.length > 0) {
        console.warn(`⚠️ [ChatModel] Secret exists but is deleted: ${JSON.stringify(checkResult.rows[0])}`);
      } else {
        console.warn(`⚠️ [ChatModel] Secret ID does not exist in database at all`);
        const listQuery = `SELECT id, name FROM secret_manager LIMIT 5`;
        const listResult = await pool.query(listQuery);
        console.log(`ℹ️ [ChatModel] Available secrets in database:`, listResult.rows.map(r => ({ id: r.id, name: r.name })));
      }
      return null;
    }
    
    console.log(`✅ [ChatModel] Secret found: ${secretResult.rows[0].name}`);
    return secretResult.rows[0];
  } catch (error) {
    console.error(`❌ [ChatModel] Error fetching secret manager:`, error.message);
    console.error(`❌ [ChatModel] Error stack:`, error.stack);
    if (error.message && error.message.includes('does not exist')) {
      console.error(`❌ [ChatModel] Database table 'secret_manager' may not exist. Check database connection.`);
      console.error(`❌ [ChatModel] DATABASE_URL: ${process.env.DATABASE_URL ? 'Set' : 'NOT SET'}`);
    }
    throw error;
  }
}

exports.askQuestion = async (req, res) => {
  try {
    const userId = req.user.id;
    const authorizationHeader = req.headers.authorization;
    const { 
      question, 
      file_id, 
      session_id,
      secret_id,
      used_secret_prompt,
      prompt_label,
      additional_input,
      llm_name
    } = req.body;

    if (!used_secret_prompt && (!question || !question.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Question is required'
      });
    }

    if (used_secret_prompt && !secret_id) {
      return res.status(400).json({
        success: false,
        message: 'secret_id is required when using secret prompts'
      });
    }

    if (!file_id) {
      return res.status(400).json({
        success: false,
        message: 'file_id is required'
      });
    }

    let sanitizedFileId = file_id.trim();
    sanitizedFileId = sanitizedFileId.replace(/^\{+\s*|\s*\}+$/g, '').trim();
    
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(sanitizedFileId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file_id format. file_id must be a valid UUID.',
        error: `Received: ${file_id}`
      });
    }

    const hasExistingSession = session_id && uuidRegex.test(session_id);
    const finalSessionId = hasExistingSession ? session_id : uuidv4();

    console.log(`💬 User ${userId} asking question about file ${sanitizedFileId} (session: ${finalSessionId})`);

    const file = await File.findById(sanitizedFileId);
    
    if (!file) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    if (String(file.user_id) !== String(userId)) {
      console.log('❌ Permission denied: user_id mismatch');
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to access this file'
      });
    }
    
    console.log('✅ Permission granted: user_id matches');

    if (!file.gcs_path) {
      return res.status(400).json({
        success: false,
        message: 'GCS path not found for this file'
      });
    }
    
    const bucketName = process.env.GCS_BUCKET_NAME;
    const gcsUri = `gs://${bucketName}/${file.gcs_path}`;

    let previousChats = [];
    if (hasExistingSession) {
      previousChats = await FileChat.getChatHistory(sanitizedFileId, finalSessionId);
      console.log(`📜 Loaded ${previousChats.length} previous messages from session ${finalSessionId}`);
    } else {
      const allChats = await FileChat.getChatHistory(sanitizedFileId, null);
      previousChats = allChats.slice(-5); // Get last 5 chats for context
      console.log(`📜 Loaded ${previousChats.length} recent messages from file for context (new session)`);
    }

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

    const userProfile = await UserProfileService.getUserProfile(userId, authorizationHeader);
    let userContext = '';
    if (userProfile) {
      userContext = `User: ${userProfile.username || userProfile.email || 'User'}`;
      if (userProfile.professional_profile) {
        userContext += `\nProfessional Profile: ${JSON.stringify(userProfile.professional_profile)}`;
      }
    }

    let finalQuestion = question?.trim() || '';
    let finalPromptLabel = prompt_label || null;
    let secretIdToSave = null;
    let usedSecretPrompt = false;
    let outputTemplate = null;

    if (used_secret_prompt && secret_id) {
      console.log(`🔐 [ChatModel] Processing secret prompt with secret_id: ${secret_id}`);
      console.log(`🔐 [ChatModel] Request details:`, {
        secret_id,
        used_secret_prompt,
        prompt_label,
        file_id: sanitizedFileId,
        user_id: userId
      });
      
      let secretData;
      try {
        secretData = await fetchSecretManagerWithTemplates(secret_id);
      } catch (dbError) {
        console.error(`❌ [ChatModel] Database error fetching secret:`, dbError);
        return res.status(500).json({
          success: false,
          message: 'Database error while fetching secret configuration',
          error: dbError.message
        });
      }
      
      if (!secretData) {
        console.error(`❌ [ChatModel] Secret not found for ID: ${secret_id}`);
        return res.status(404).json({
          success: false,
          message: `Secret configuration not found in database for ID: ${secret_id}`,
          secret_id: secret_id
        });
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
      usedSecretPrompt = true;
      secretIdToSave = secret_id;

      const GCLOUD_PROJECT_ID = process.env.GCLOUD_PROJECT_ID;
      if (!GCLOUD_PROJECT_ID) {
        return res.status(500).json({
          success: false,
          message: 'GCLOUD_PROJECT_ID not configured'
        });
      }

      const secretClient = new SecretManagerServiceClient();
      const gcpSecretName = `projects/${GCLOUD_PROJECT_ID}/secrets/${secret_manager_id}/versions/${version}`;
      console.log(`🔐 [ChatModel] Fetching secret from GCP: ${gcpSecretName}`);

      const [accessResponse] = await secretClient.accessSecretVersion({ name: gcpSecretName });
      let secretValue = accessResponse.payload.data.toString('utf8');

      if (!secretValue?.trim()) {
        return res.status(500).json({
          success: false,
          message: 'Secret value is empty in GCP'
        });
      }

      console.log(`🔐 [ChatModel] Secret value retrieved (${secretValue.length} chars)`);

      let templateData = { inputTemplate: null, outputTemplate: null, hasTemplates: false };
      if (input_template_id || output_template_id) {
        console.log(`\n📄 [ChatModel] Fetching template files:`);
        console.log(`   Input Template ID: ${input_template_id || 'not set'}`);
        console.log(`   Output Template ID: ${output_template_id || 'not set'}\n`);
        
        templateData = await fetchTemplateFilesData(input_template_id, output_template_id);
        
        if (templateData.hasTemplates) {
          console.log(`✅ [ChatModel] Template files fetched successfully`);
          if (templateData.inputTemplate) {
            console.log(`   Input: ${templateData.inputTemplate.filename} (${templateData.inputTemplate.extracted_text?.length || 0} chars)`);
          }
          if (templateData.outputTemplate) {
            console.log(`   Output: ${templateData.outputTemplate.filename} (${templateData.outputTemplate.extracted_text?.length || 0} chars)`);
          }
          
          secretValue = buildEnhancedSystemPromptWithTemplates(secretValue, templateData);
          console.log(`✅ [ChatModel] Enhanced prompt built with template examples (${secretValue.length} chars)\n`);
        } else {
          console.log(`⚠️ [ChatModel] No template files found or available\n`);
        }
      }

      const formattedSecretValue = secretValue;
      
      finalQuestion = formattedSecretValue;
      if (additional_input?.trim()) {
        finalQuestion += `\n\n=== ADDITIONAL USER INSTRUCTIONS ===\n${additional_input.trim()}`;
      }

      console.log(`🔐 [ChatModel] Using secret prompt: "${secretName}"`);
    }

    let promptText = finalQuestion || question.trim();
    if (conversationContext) {
      promptText = appendConversationToPrompt(promptText, conversationContext);
    }
    
    if (userContext) {
      promptText = `USER CONTEXT:\n${userContext}\n\n${promptText}`;
    }

    console.log(`🤖 Asking LLM question with document context and ${previousChats.length} previous messages...`);
    console.log(`📝 Final Prompt Preview (first 500 chars):`);
    console.log('─'.repeat(80));
    console.log(promptText.substring(0, 500) + (promptText.length > 500 ? '...' : ''));
    console.log('─'.repeat(80));
    console.log(`📊 Full prompt length: ${promptText.length} characters`);
    const answer = await askLLMWithGCS(promptText, gcsUri, '', {
      userId: userId,
      endpoint: '/api/chat/ask',
      fileId: sanitizedFileId,
      sessionId: finalSessionId
    }); // userContext already in promptText

    let savedChat;
    try {
      console.log(`💾 [ChatModel] Saving chat to database...`);
      console.log(`   - File ID: ${sanitizedFileId}`);
      console.log(`   - User ID: ${userId}`);
      console.log(`   - Session ID: ${finalSessionId}`);
      const questionToSave = usedSecretPrompt ? (finalPromptLabel || 'Secret Prompt') : (question?.trim() || '');
      console.log(`   - Question length: ${questionToSave.length} chars`);
      console.log(`   - Answer length: ${answer.length} chars`);
      
      savedChat = await FileChat.saveChat(
        sanitizedFileId,
        userId,
        questionToSave,
        answer,
        finalSessionId,
        [], // usedChunkIds - not applicable for ChatModel
        usedSecretPrompt, // usedSecretPrompt
        finalPromptLabel, // promptLabel
        secretIdToSave, // secretId
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
      savedChat = {
        id: null,
        session_id: finalSessionId,
        created_at: new Date().toISOString()
      };
    }

    const historyRows = await FileChat.getChatHistory(sanitizedFileId, finalSessionId);
    const history = historyRows.map((row) => ({
      id: row.id,
      question: row.question,
      answer: row.answer,
      created_at: row.created_at,
      session_id: row.session_id,
      used_secret_prompt: row.used_secret_prompt || false,
      prompt_label: row.prompt_label || null,
      secret_id: row.secret_id || null,
      file_id: row.file_id || sanitizedFileId,
    }));

    return res.status(200).json({
      success: true,
      data: {
        question: usedSecretPrompt ? (finalPromptLabel || 'Secret Prompt') : (question?.trim() || ''),
        answer: answer,
        file_id: sanitizedFileId,
        filename: file.originalname,
        session_id: finalSessionId,
        chat_id: savedChat.id,
        history: history,
        used_secret_prompt: usedSecretPrompt,
        prompt_label: finalPromptLabel,
        secret_id: secretIdToSave
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

exports.askQuestionStream = async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.setHeader('Access-Control-Allow-Origin', '*'); // CORS for testing
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  res.flushHeaders();
  
  console.log('📡 SSE connection established for streaming chat');

  const heartbeat = setInterval(() => {
    try {
      res.write(`data: [PING]\n\n`);
    } catch (err) {
      clearInterval(heartbeat);
    }
  }, 15000);

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
    const { 
      question, 
      file_id, 
      session_id,
      secret_id,
      used_secret_prompt,
      prompt_label,
      additional_input,
      llm_name
    } = req.body;

    sendStatus('initializing', 'Starting chat request...');

    if (!used_secret_prompt && (!question || !question.trim())) {
      sendError('Question is required');
      return;
    }

    if (used_secret_prompt && !secret_id) {
      sendError('secret_id is required when using secret prompts');
      return;
    }

    if (!file_id) {
      sendError('file_id is required');
      return;
    }

    let sanitizedFileId = file_id.trim();
    sanitizedFileId = sanitizedFileId.replace(/^\{+\s*|\s*\}+$/g, '').trim();
    
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(sanitizedFileId)) {
      sendError('Invalid file_id format. file_id must be a valid UUID.');
      return;
    }

    const hasExistingSession = session_id && uuidRegex.test(session_id);
    const finalSessionId = hasExistingSession ? session_id : uuidv4();

    sendStatus('validating', 'Validating file access...');

    const file = await File.findById(sanitizedFileId);
    
    if (!file) {
      sendError('File not found');
      return;
    }

    if (String(file.user_id) !== String(userId)) {
      sendError('You do not have permission to access this file');
      return;
    }

    if (!file.gcs_path) {
      sendError('GCS path not found for this file');
      return;
    }
    
    const bucketName = process.env.GCS_BUCKET_NAME;
    const gcsUri = `gs://${bucketName}/${file.gcs_path}`;

    sendStatus('fetching', 'Fetching previous conversation context...');

    let previousChats = [];
    if (hasExistingSession) {
      previousChats = await FileChat.getChatHistory(sanitizedFileId, finalSessionId);
      console.log(`📜 Loaded ${previousChats.length} previous messages from session ${finalSessionId}`);
    } else {
      const allChats = await FileChat.getChatHistory(sanitizedFileId, null);
      previousChats = allChats.slice(-5);
      console.log(`📜 Loaded ${previousChats.length} recent messages from file for context (new session)`);
    }

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

    const userProfile = await UserProfileService.getUserProfile(userId, authorizationHeader);
    let userContext = '';
    if (userProfile) {
      userContext = `User: ${userProfile.username || userProfile.email || 'User'}`;
      if (userProfile.professional_profile) {
        userContext += `\nProfessional Profile: ${JSON.stringify(userProfile.professional_profile)}`;
      }
    }

    let finalQuestion = question?.trim() || '';
    let finalPromptLabel = prompt_label || null;
    let secretIdToSave = null;
    let usedSecretPrompt = false;
    let outputTemplate = null;

    if (used_secret_prompt && secret_id) {
      sendStatus('fetching', 'Fetching secret prompt configuration...');
      console.log(`🔐 [ChatModel Stream] Processing secret prompt with secret_id: ${secret_id}`);
      console.log(`🔐 [ChatModel Stream] Request details:`, {
        secret_id,
        used_secret_prompt,
        prompt_label,
        file_id: sanitizedFileId,
        user_id: userId
      });
      
      let secretData;
      try {
        secretData = await fetchSecretManagerWithTemplates(secret_id);
      } catch (dbError) {
        console.error(`❌ [ChatModel Stream] Database error fetching secret:`, dbError);
        sendError(`Database error while fetching secret configuration: ${dbError.message}`);
        return;
      }
      
      if (!secretData) {
        console.error(`❌ [ChatModel Stream] Secret not found for ID: ${secret_id}`);
        sendError(`Secret configuration not found in database for ID: ${secret_id}`);
        return;
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
      usedSecretPrompt = true;
      secretIdToSave = secret_id;

      const GCLOUD_PROJECT_ID = process.env.GCLOUD_PROJECT_ID;
      if (!GCLOUD_PROJECT_ID) {
        sendError('GCLOUD_PROJECT_ID not configured');
        return;
      }

      sendStatus('fetching', 'Retrieving secret prompt from GCP...');
      const secretClient = new SecretManagerServiceClient();
      const gcpSecretName = `projects/${GCLOUD_PROJECT_ID}/secrets/${secret_manager_id}/versions/${version}`;
      console.log(`🔐 [ChatModel Stream] Fetching secret from GCP: ${gcpSecretName}`);

      const [accessResponse] = await secretClient.accessSecretVersion({ name: gcpSecretName });
      let secretValue = accessResponse.payload.data.toString('utf8');

      if (!secretValue?.trim()) {
        sendError('Secret value is empty in GCP');
        return;
      }

      console.log(`🔐 [ChatModel Stream] Secret value retrieved (${secretValue.length} chars)`);

      let templateData = { inputTemplate: null, outputTemplate: null, hasTemplates: false };
      if (input_template_id || output_template_id) {
        console.log(`\n📄 [ChatModel Stream] Fetching template files:`);
        console.log(`   Input Template ID: ${input_template_id || 'not set'}`);
        console.log(`   Output Template ID: ${output_template_id || 'not set'}\n`);
        
        templateData = await fetchTemplateFilesData(input_template_id, output_template_id);
        
        if (templateData.hasTemplates) {
          console.log(`✅ [ChatModel Stream] Template files fetched successfully`);
          if (templateData.inputTemplate) {
            console.log(`   Input: ${templateData.inputTemplate.filename} (${templateData.inputTemplate.extracted_text?.length || 0} chars)`);
          }
          if (templateData.outputTemplate) {
            console.log(`   Output: ${templateData.outputTemplate.filename} (${templateData.outputTemplate.extracted_text?.length || 0} chars)`);
          }
          
          secretValue = buildEnhancedSystemPromptWithTemplates(secretValue, templateData);
          console.log(`✅ [ChatModel Stream] Enhanced prompt built with template examples (${secretValue.length} chars)\n`);
        } else {
          console.log(`⚠️ [ChatModel Stream] No template files found or available\n`);
        }
      }

      const formattedSecretValue = secretValue;
      
      finalQuestion = formattedSecretValue;
      if (additional_input?.trim()) {
        finalQuestion += `\n\n=== ADDITIONAL USER INSTRUCTIONS ===\n${additional_input.trim()}`;
      }

      console.log(`🔐 [ChatModel Stream] Using secret prompt: "${secretName}"`);
    }

    let promptText = finalQuestion || question.trim();
    if (conversationContext) {
      promptText = appendConversationToPrompt(promptText, conversationContext);
    }
    
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

    res.write(`data: ${JSON.stringify({ type: 'metadata', session_id: finalSessionId, file_id: sanitizedFileId })}\n\n`);

    let fullAnswer = '';
    let chunkCount = 0;
    try {
      console.log('🔄 Starting to stream LLM response...');
      
      for await (const chunk of streamLLMWithGCS(promptText, gcsUri, '')) {
        if (chunk && chunk.trim()) {
          fullAnswer += chunk;
          chunkCount++;
          
          const chunkData = JSON.stringify({ type: 'chunk', text: chunk });
          res.write(`data: ${chunkData}\n\n`);
          
          if (res.flush && typeof res.flush === 'function') {
            res.flush();
          }
          
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

    let savedChat;
    try {
      console.log(`💾 [ChatModel] Saving streaming chat to database...`);
      console.log(`   - File ID: ${sanitizedFileId}`);
      console.log(`   - User ID: ${userId}`);
      console.log(`   - Session ID: ${finalSessionId}`);
      const questionToSave = usedSecretPrompt ? (finalPromptLabel || 'Secret Prompt') : (question?.trim() || '');
      console.log(`   - Question length: ${questionToSave.length} chars`);
      console.log(`   - Answer length: ${fullAnswer.length} chars`);
      
      savedChat = await FileChat.saveChat(
        sanitizedFileId,
        userId,
        questionToSave,
        fullAnswer,
        finalSessionId,
        [],
        usedSecretPrompt,
        finalPromptLabel,
        secretIdToSave,
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
      savedChat = {
        id: null,
        session_id: finalSessionId,
        created_at: new Date().toISOString()
      };
    }

    const completionData = {
      type: 'done',
      session_id: finalSessionId,
      chat_id: savedChat.id,
      answer: fullAnswer,
      file_id: sanitizedFileId,
      filename: file.originalname,
      answer_length: fullAnswer.length,
      chunks_received: chunkCount,
      used_secret_prompt: usedSecretPrompt,
      prompt_label: finalPromptLabel,
      secret_id: secretIdToSave
    };
    
    res.write(`data: ${JSON.stringify(completionData)}\n\n`);
    
    if (res.flush && typeof res.flush === 'function') {
      res.flush();
    }
    
    res.write(`data: [DONE]\n\n`);
    
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

exports.getChatHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { file_id } = req.params;
    const { session_id } = req.query;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(file_id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file_id format. file_id must be a valid UUID.'
      });
    }

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

    const historyRows = await FileChat.getChatHistory(file_id, session_id || null);
    const history = historyRows.map((row) => ({
      id: row.id,
      question: row.question,
      answer: row.answer,
      session_id: row.session_id,
      created_at: row.created_at,
      used_secret_prompt: row.used_secret_prompt || false,
      prompt_label: row.prompt_label || null,
      secret_id: row.secret_id || null,
      file_id: row.file_id || file_id,
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

exports.getDocumentSessions = async (req, res) => {
  try {
    const userId = req.user.id;
    const { file_id } = req.params;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(file_id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file_id format. file_id must be a valid UUID.'
      });
    }

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

    const historyRows = await FileChat.getChatHistory(file_id, null);
    
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
