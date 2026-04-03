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
const { askLLMWithGCS, streamLLMWithGCS, streamLLMGeneral } = require('../services/llmService');
const {
  getLLMConfig,
  getStreamingDelayMs,
  mergeRequestLlmOverrides,
  flattenLlmRequestBody,
  getMulterUploadCeilingMb,
} = require('../services/llmConfigService');
const {
  assertStoredFileMeetsDashboardLimits,
  assertUploadAllowed,
  getNextUtcMidnightIsoString,
} = require('../services/llmChatPolicyService');
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

/** SSE cannot use wildcard Origin when the browser sends credentials; echo request Origin instead. */
function setSseCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sleep(ms) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

const UUID_FILE_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizeOneFileId(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim().replace(/^\{+\s*|\s*\}+$/g, '').trim();
  return UUID_FILE_ID_REGEX.test(s) ? s : null;
}

/** Accepts `file_id` (single UUID) or `file_ids` (array). Deduplicates, preserves order. */
function parseFileIdsFromBody(body) {
  const ids = [];
  if (Array.isArray(body?.file_ids) && body.file_ids.length) {
    for (const x of body.file_ids) {
      const id = sanitizeOneFileId(x);
      if (id) ids.push(id);
    }
  } else if (body?.file_id != null && String(body.file_id).trim()) {
    const id = sanitizeOneFileId(body.file_id);
    if (id) ids.push(id);
  }
  return [...new Set(ids)];
}

/** Persisted on each Chat Model turn: all attached files + gs:// URI for session restore. */
function buildAttachedFilesSnapshot(files, bucketName) {
  if (!Array.isArray(files) || !files.length || !bucketName) return null;
  return files.map((f) => ({
    file_id: f.id,
    filename: f.originalname || f.filename || 'document',
    mimetype: f.mimetype || null,
    size: f.size != null ? Number(f.size) : null,
    gcs_uri: f.gcs_path ? `gs://${bucketName}/${f.gcs_path}` : null,
  }));
}

function parseAttachedFilesCell(raw) {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw.length ? raw : null;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) && p.length ? p : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Prefer latest row with attached_files; else derive from primary user_files row. */
function resolveAttachedFilesForSession(historyRows, file, primaryFileId, bucketName) {
  if (Array.isArray(historyRows) && historyRows.length) {
    for (let i = historyRows.length - 1; i >= 0; i--) {
      const parsed = parseAttachedFilesCell(historyRows[i].attached_files);
      if (parsed && parsed.length) return parsed;
    }
  }
  if (file && primaryFileId && file.gcs_path && bucketName) {
    return [
      {
        file_id: primaryFileId,
        filename: file.originalname || file.filename || 'document',
        mimetype: file.mimetype || null,
        size: file.size != null ? Number(file.size) : null,
        gcs_uri: `gs://${bucketName}/${file.gcs_path}`,
      },
    ];
  }
  return null;
}

/**
 * Dashboard row from DB + per-request overrides (set by enforceLLMChatPolicy).
 * Falls back if the route was not wired through that middleware (e.g. tests).
 */
async function ensureLlmRequestConfig(req) {
  if (req.llmChatConfig && req.llmConfigForRequest) {
    return { llmChatConfig: req.llmChatConfig, llmConfigForRequest: req.llmConfigForRequest };
  }
  const userId = req.user?.id ?? req.userId ?? null;
  const base = await getLLMConfig(userId);
  const merged = mergeRequestLlmOverrides(base, flattenLlmRequestBody(req.body));
  return { llmChatConfig: base, llmConfigForRequest: merged };
}

/**
 * Limits from `llm_chat_config` for client-side upload validation (must match server enforcement).
 */
exports.getChatLlmLimits = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.userId ?? null;
    const cfg = await getLLMConfig(userId);
    const uploadCeilingMb = getMulterUploadCeilingMb(cfg);
    return res.status(200).json({
      success: true,
      data: {
        max_document_size_mb: cfg.max_document_size_mb,
        multer_upload_ceiling_mb: cfg.multer_upload_ceiling_mb,
        max_upload_mb: uploadCeilingMb,
        max_upload_bytes: Math.floor(uploadCeilingMb * 1024 * 1024),
        max_upload_files: cfg.max_upload_files,
        max_file_upload_per_day: cfg.max_file_upload_per_day,
        max_document_pages: cfg.max_document_pages,
        max_output_tokens: cfg.max_output_tokens,
        max_output_tokens_cap: cfg.max_output_tokens_cap,
        min_output_tokens: cfg.min_output_tokens,
        model_temperature: cfg.model_temperature,
        temperature_min: cfg.temperature_min,
        temperature_max: cfg.temperature_max,
        streaming_delay_ms: getStreamingDelayMs(cfg),
        quota_chats_per_minute: cfg.quota_chats_per_minute,
        messages_per_hour: cfg.messages_per_hour,
        chats_per_day: cfg.chats_per_day,
        total_tokens_per_day: cfg.total_tokens_per_day,
        next_daily_reset_utc: getNextUtcMidnightIsoString(),
        llm_model: cfg.llm_model,
        llm_provider: cfg.llm_provider,
      },
    });
  } catch (err) {
    console.error('[getChatLlmLimits]', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to load LLM config',
    });
  }
};

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

    const llmCfg = await getLLMConfig(userId);
    const uploadPolicy = await assertUploadAllowed(userId, llmCfg, {
      sizeBytes: fileSizeBytes,
      buffer,
      mimetype: mimeType,
      originalname: filename,
    });
    if (!uploadPolicy.ok) {
      const st =
        uploadPolicy.code === 'DAILY_UPLOAD_LIMIT'
          ? 429
          : uploadPolicy.code === 'FILE_TOO_LARGE' || uploadPolicy.code === 'DOCUMENT_TOO_MANY_PAGES'
            ? 413
            : 400;
      return res.status(st).json({
        success: false,
        code: uploadPolicy.code,
        message: uploadPolicy.message,
        details: uploadPolicy.details,
      });
    }

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
        throw new Error(`Database table 'secret_manager' does not exist. Please ensure ChatModel has access to its configured database schema.`);
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

    const fileIds = parseFileIdsFromBody(req.body);
    if (!fileIds.length) {
      return res.status(400).json({
        success: false,
        message: 'file_id or file_ids is required',
      });
    }

    const uuidRegex = UUID_FILE_ID_REGEX;
    const hasExistingSession = session_id && uuidRegex.test(session_id);
    const finalSessionId = hasExistingSession ? session_id : uuidv4();

    const { llmChatConfig, llmConfigForRequest } = await ensureLlmRequestConfig(req);
    const maxFiles = Math.max(1, Math.floor(Number(llmChatConfig?.max_upload_files)) || 8);
    if (fileIds.length > maxFiles) {
      return res.status(400).json({
        success: false,
        message: `Too many files attached (${fileIds.length}). Maximum is ${maxFiles} (configured in llm_chat_config).`,
      });
    }

    const sanitizedFileId = fileIds[0];

    console.log(`💬 User ${userId} asking about file(s) ${fileIds.join(', ')} (session: ${finalSessionId})`);

    const bucketName = process.env.GCS_BUCKET_NAME;
    const files = [];
    for (const fid of fileIds) {
      const file = await File.findById(fid);
      if (!file) {
        return res.status(404).json({
          success: false,
          message: `File not found: ${fid}`,
        });
      }
      if (String(file.user_id) !== String(userId)) {
        console.log('❌ Permission denied: user_id mismatch for', fid);
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to access one or more of these files',
        });
      }
      if (!file.gcs_path) {
        return res.status(400).json({
          success: false,
          message: `GCS path not found for file ${fid}`,
        });
      }
      const filePolicy = assertStoredFileMeetsDashboardLimits(file, llmChatConfig);
      if (!filePolicy.ok) {
        return res.status(403).json({
          success: false,
          code: filePolicy.code,
          message: filePolicy.message,
          details: filePolicy.details,
        });
      }
      files.push(file);
    }

    console.log('✅ Permission granted for all attached file(s)');

    const gcsUris = files.map((f) => `gs://${bucketName}/${f.gcs_path}`);

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

    const fullProfile = await UserProfileService.getFullProfile(userId, authorizationHeader);
    const userContext = buildUserContextFromProfile(fullProfile);

    let finalQuestion = question?.trim() || '';
    let finalPromptLabel = prompt_label || null;
    let secretIdToSave = null;
    let usedSecretPrompt = false;
    let outputTemplate = null;
    let resolvedModelName = (typeof llm_name === 'string' && llm_name.trim()) ? llm_name.trim() : null;

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
      if (!resolvedModelName && typeof dbLlmName === 'string' && dbLlmName.trim()) {
        resolvedModelName = dbLlmName.trim();
      }

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

    if (files.length > 1) {
      const names = files.map((f) => f.originalname || f.filename || 'document').join(', ');
      promptText = `The user attached ${files.length} documents (${names}). Use information from all of them when answering.\n\n${promptText}`;
    }

    // ── LLM config (loaded earlier for file size vs Dashboard) ─────────────────
    console.log(`\n📋 [DB → LLM Config] Parameters used for this request:`);
    console.log(`   - llm_provider         : ${llmConfigForRequest.llm_provider}`);
    console.log(`   - llm_model            : ${llmConfigForRequest.llm_model}`);
    console.log(`   - max_output_tokens    : ${llmConfigForRequest.max_output_tokens}`);
    console.log(`   - model_temperature    : ${llmConfigForRequest.model_temperature}`);
    console.log(`   - chats_per_day        : ${llmConfigForRequest.chats_per_day}`);
    console.log(`   - messages_per_hour    : ${llmConfigForRequest.messages_per_hour}`);
    console.log(`   - streaming_delay_ms   : ${getStreamingDelayMs(llmChatConfig)}`);
    // ─────────────────────────────────────────────────────────────────────────

    console.log(`🤖 Asking LLM question with document context and ${previousChats.length} previous messages...`);
    console.log(`📝 Final Prompt Preview (first 500 chars):`);
    console.log('─'.repeat(80));
    console.log(promptText.substring(0, 500) + (promptText.length > 500 ? '...' : ''));
    console.log('─'.repeat(80));
    console.log(`📊 Full prompt length: ${promptText.length} characters`);
    console.log(`🧭 [ChatModel] Model selection:`, {
      from_request_llm_name: (typeof llm_name === 'string' && llm_name.trim()) ? llm_name.trim() : null,
      from_db_llm_name: (usedSecretPrompt ? 'available via secret config' : null),
      resolved_model_name: resolvedModelName,
      env_default: process.env.GEMINI_MODEL_NAME || null
    });
    const answer = await askLLMWithGCS(promptText, gcsUris, '', {
      userId: userId,
      endpoint: '/api/chat/ask',
      fileId: sanitizedFileId,
      sessionId: finalSessionId,
      modelName: resolvedModelName,
      llmConfig: llmConfigForRequest,
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

      const attachedSnapshot = buildAttachedFilesSnapshot(files, bucketName);
      
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
        historyForStorage,
        attachedSnapshot
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
    const attached_files = resolveAttachedFilesForSession(
      historyRows,
      files[0],
      sanitizedFileId,
      bucketName || ''
    );
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
      attached_files: parseAttachedFilesCell(row.attached_files),
    }));

    return res.status(200).json({
      success: true,
      data: {
        question: usedSecretPrompt ? (finalPromptLabel || 'Secret Prompt') : (question?.trim() || ''),
        answer: answer,
        file_id: sanitizedFileId,
        file_ids: fileIds,
        filename: files[0]?.originalname,
        session_id: finalSessionId,
        chat_id: savedChat.id,
        history: history,
        used_secret_prompt: usedSecretPrompt,
        prompt_label: finalPromptLabel,
        secret_id: secretIdToSave,
        attached_files,
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
  setSseCorsHeaders(req, res);

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

    const fileIds = parseFileIdsFromBody(req.body);
    if (!fileIds.length) {
      sendError('file_id or file_ids is required');
      return;
    }

    const uuidRegex = UUID_FILE_ID_REGEX;
    const hasExistingSession = session_id && uuidRegex.test(session_id);
    const finalSessionId = hasExistingSession ? session_id : uuidv4();

    const sanitizedFileId = fileIds[0];

    console.log(`\n${'='.repeat(80)}`);
    console.log(`📋 [DB Chat Params] Incoming chat request:`);
    console.log(`   - user_id        : ${userId}`);
    console.log(`   - file_id(s)     : ${fileIds.join(', ')} (primary: ${sanitizedFileId})`);
    console.log(`   - session_id     : ${session_id || 'none (new session)'}`);
    console.log(`   - is_valid_uuid  : ${hasExistingSession}`);
    console.log(`   - final_session  : ${finalSessionId}`);
    console.log(`   - action         : ${hasExistingSession ? '🔄 CONTINUING existing session' : '🆕 STARTING new session'}`);
    console.log(`   - used_secret    : ${!!used_secret_prompt}`);
    console.log(`   - secret_id      : ${secret_id || 'none'}`);
    console.log(
      `   - client LLM overrides (raw): max_output_tokens=${req.body?.max_output_tokens ?? req.body?.maxOutputTokens ?? '—'}, model_temperature=${req.body?.model_temperature ?? req.body?.temperature ?? '—'}`
    );
    console.log(`${'='.repeat(80)}\n`);

    sendStatus('validating', 'Validating file access...');

    const { llmChatConfig, llmConfigForRequest } = await ensureLlmRequestConfig(req);
    const maxFiles = Math.max(1, Math.floor(Number(llmChatConfig?.max_upload_files)) || 8);
    if (fileIds.length > maxFiles) {
      sendError(`Too many files attached (${fileIds.length}). Maximum is ${maxFiles}.`);
      return;
    }

    const bucketName = process.env.GCS_BUCKET_NAME;
    const files = [];
    for (const fid of fileIds) {
      const file = await File.findById(fid);
      if (!file) {
        sendError(`File not found: ${fid}`);
        return;
      }
      if (String(file.user_id) !== String(userId)) {
        sendError('You do not have permission to access one or more of these files');
        return;
      }
      if (!file.gcs_path) {
        sendError(`GCS path not found for file ${fid}`);
        return;
      }
      const filePolicy = assertStoredFileMeetsDashboardLimits(file, llmChatConfig);
      if (!filePolicy.ok) {
        sendError(filePolicy.message);
        return;
      }
      files.push(file);
    }

    const gcsUris = files.map((f) => `gs://${bucketName}/${f.gcs_path}`);

    sendStatus('fetching', 'Fetching previous conversation context...');

    let previousChats = [];
    if (hasExistingSession) {
      previousChats = await FileChat.getChatHistory(sanitizedFileId, finalSessionId);
      console.log(`\n📦 [DB Load] Session continuation — loaded ${previousChats.length} messages from DB:`);
      console.log(`   - DB query: SELECT FROM file_chats WHERE file_id='${sanitizedFileId}' AND session_id='${finalSessionId}'`);
      previousChats.forEach((chat, i) => {
        console.log(`   [${i + 1}] id=${chat.id} | created=${chat.created_at} | Q="${(chat.question||'').substring(0,60)}..."`);
      });
    } else {
      const allChats = await FileChat.getChatHistory(sanitizedFileId, null);
      previousChats = allChats.slice(-5);
      console.log(`\n📦 [DB Load] New session — loaded last ${previousChats.length} messages for context:`);
      console.log(`   - DB query: SELECT FROM file_chats WHERE file_id='${sanitizedFileId}' ORDER BY created_at ASC (last 5)`);
      previousChats.forEach((chat, i) => {
        console.log(`   [${i + 1}] id=${chat.id} | session=${chat.session_id} | Q="${(chat.question||'').substring(0,60)}..."`);
      });
    }

    const conversationContext = formatConversationHistory(previousChats);
    const historyForStorage = simplifyHistory(previousChats);

    if (conversationContext) {
      console.log(`\n📜 [DB Context] Sending ${previousChats.length} messages as conversation context to LLM:`);
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
      console.log(`📜 [DB Context] No previous conversation context — this is a fresh conversation`);
    }

    sendStatus('analyzing', 'Analyzing document and preparing context...');

    console.log(`\n📋 [DB → LLM Config] Parameters used for this request:`);
    console.log(`   - llm_model            : ${llmConfigForRequest.llm_model}`);
    console.log(`   - max_output_tokens    : ${llmConfigForRequest.max_output_tokens}`);
    console.log(`   - model_temperature    : ${llmConfigForRequest.model_temperature}`);
    console.log(`   - chats_per_day        : ${llmConfigForRequest.chats_per_day}`);
    console.log(`   - messages_per_hour    : ${llmConfigForRequest.messages_per_hour}`);
    console.log(`   - quota_chats_per_min  : ${llmConfigForRequest.quota_chats_per_minute}`);
    console.log(`   - streaming_delay_ms   : ${getStreamingDelayMs(llmChatConfig)}`);

    const fullProfile = await UserProfileService.getFullProfile(userId, authorizationHeader);
    const userContext = buildUserContextFromProfile(fullProfile);

    let finalQuestion = question?.trim() || '';
    let finalPromptLabel = prompt_label || null;
    let secretIdToSave = null;
    let usedSecretPrompt = false;
    let outputTemplate = null;
    let resolvedModelName = (typeof llm_name === 'string' && llm_name.trim()) ? llm_name.trim() : null;

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
      if (!resolvedModelName && typeof dbLlmName === 'string' && dbLlmName.trim()) {
        resolvedModelName = dbLlmName.trim();
      }

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

    if (files.length > 1) {
      const names = files.map((f) => f.originalname || f.filename || 'document').join(', ');
      promptText = `The user attached ${files.length} documents (${names}). Use information from all of them when answering.\n\n${promptText}`;
    }

    console.log(`🤖 Streaming LLM response with document context and ${previousChats.length} previous messages...`);
    console.log(`📝 Final Prompt Preview (first 500 chars):`);
    console.log('─'.repeat(80));
    console.log(promptText.substring(0, 500) + (promptText.length > 500 ? '...' : ''));
    console.log('─'.repeat(80));
    console.log(`📊 Full prompt length: ${promptText.length} characters`);
    console.log(`🧭 [ChatModel Stream] Model selection:`, {
      from_request_llm_name: (typeof llm_name === 'string' && llm_name.trim()) ? llm_name.trim() : null,
      resolved_model_name: resolvedModelName,
      env_default: process.env.GEMINI_MODEL_NAME || null
    });

    sendStatus('generating', 'Generating response from AI...');

    res.write(
      `data: ${JSON.stringify({
        type: 'metadata',
        session_id: finalSessionId,
        file_id: sanitizedFileId,
        file_ids: fileIds,
      })}\n\n`
    );

    let fullAnswer = '';
    let chunkCount = 0;
    const streamingDelayMs = getStreamingDelayMs(llmChatConfig);
    try {
      console.log('🔄 Starting to stream LLM response...');
      
      for await (const chunk of streamLLMWithGCS(promptText, gcsUris, '', {
        modelName: resolvedModelName,
        llmConfig: llmConfigForRequest,
        userId,
        fileId: sanitizedFileId,
        sessionId: finalSessionId,
        endpoint: '/api/chat/ask/stream',
      })) {
        if (typeof chunk === 'string' && chunk.length > 0) {
          fullAnswer += chunk;
          chunkCount++;
          
          const chunkData = JSON.stringify({ type: 'chunk', text: chunk });
          res.write(`data: ${chunkData}\n\n`);
          
          if (res.flush && typeof res.flush === 'function') {
            res.flush();
          }

          if (streamingDelayMs > 0) {
            await sleep(streamingDelayMs);
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

      const attachedSnapshot = buildAttachedFilesSnapshot(files, bucketName);
      
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
        historyForStorage,
        attachedSnapshot
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
      file_ids: fileIds,
      filename: files[0]?.originalname,
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
    const bucketName = process.env.GCS_BUCKET_NAME || '';
    const attached_files = resolveAttachedFilesForSession(historyRows, file, file_id, bucketName);
    const file_ids =
      attached_files && attached_files.length
        ? [...new Set(attached_files.map((a) => a.file_id).filter(Boolean))]
        : [file_id];

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
      attached_files: parseAttachedFilesCell(row.attached_files),
    }));

    return res.status(200).json({
      success: true,
      data: {
        file_id: file_id,
        filename: file.originalname,
        session_id: session_id || null,
        history: history,
        count: history.length,
        attached_files,
        file_ids,
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

// ─────────────────────────────────────────────────────────────────────────────
// Build a plain-text user context string for document chat prompts
// Takes the { basic, professional } object from getFullProfile
// ─────────────────────────────────────────────────────────────────────────────
function buildUserContextFromProfile(fullProfile) {
  const p = fullProfile?.professional || {};
  const b = fullProfile?.basic || {};

  const name         = b.username || p.fullname || b.email || p.email || 'Unknown';
  const ns = (v) => v || 'Not set';

  return `USER PROFILE (complete profile fetched from JuriNex auth service):
- Name: ${name}
- Email: ${ns(b.email || p.email)}
- Role: ${ns(p.primary_role)}
- Organization: ${ns(p.organization_name)}
- Organization Type: ${ns(p.organization_type)}
- Primary Jurisdiction: ${ns(p.primary_jurisdiction)}
- Areas of Practice: ${ns(p.main_areas_of_practice)}
- Experience: ${ns(p.experience)}
- Bar Enrollment Number: ${ns(p.bar_enrollment_number)}
- Typical Client: ${ns(p.typical_client)}
- Preferred Tone: ${ns(p.preferred_tone)}
- Detail Level: ${ns(p.preferred_detail_level)}
- Citation Style: ${ns(p.citation_style)}

When asked about profile details, list ALL the above fields including those marked "Not set". Never claim you lack access to profile data — the complete profile is listed above.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// LEGAL DOMAIN SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────────────────
function buildLegalSystemPrompt(userProfile) {
  const professional = userProfile?.professional || {};
  const basic = userProfile?.basic || {};

  const ns = (v) => v || 'Not set';
  const name         = basic.username || professional.fullname || basic.email || professional.email || 'the user';

  const profileSection = `\n\nUSER PROFILE (complete profile fetched from JuriNex auth service):
- Name: ${name}
- Email: ${ns(basic.email || professional.email)}
- Role: ${ns(professional.primary_role)}
- Organization: ${ns(professional.organization_name)}
- Organization Type: ${ns(professional.organization_type)}
- Primary Jurisdiction: ${ns(professional.primary_jurisdiction)}
- Areas of Practice: ${ns(professional.main_areas_of_practice)}
- Experience: ${ns(professional.experience)}
- Bar Enrollment Number: ${ns(professional.bar_enrollment_number)}
- Typical Client: ${ns(professional.typical_client)}
- Preferred Tone: ${ns(professional.preferred_tone)}
- Detail Level: ${ns(professional.preferred_detail_level)}
- Citation Style: ${ns(professional.citation_style)}

IMPORTANT: When the user asks about their profile details, list ALL the above fields exactly as shown, including those marked "Not set". Never say you do not have access to their profile — the complete profile is provided above. "Not set" means the user has not filled in that field yet.`;

  return `You are JuriNex Legal Assistant — an expert AI assistant strictly specialised in legal matters.

DOMAIN RESTRICTION:
- You ONLY answer questions related to law, legal concepts, legal procedures, contracts, regulations, case law, statutes, compliance, legal rights, legal strategy, or legal research.
- You MAY answer questions about the user's own profile details since the complete profile is provided to you above.
- If a question is outside the legal domain and is not about the user's profile, politely decline and explain that you are a legal-only assistant.

RESPONSE QUALITY:
- Provide accurate, well-reasoned legal information.
- Responses are for informational purposes only and not a substitute for formal legal advice from a licensed attorney.
- Cite relevant statutes, regulations, or case law where appropriate.
- Address the user by name.${profileSection}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// General Chat (no document) — Streaming SSE
// ─────────────────────────────────────────────────────────────────────────────
exports.askGeneralQuestionStream = async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  setSseCorsHeaders(req, res);
  res.flushHeaders();

  console.log('📡 [General] SSE connection established for general legal chat');

  const heartbeat = setInterval(() => {
    try { res.write(`data: [PING]\n\n`); } catch (e) { clearInterval(heartbeat); }
  }, 15000);

  const sendStatus = (status, message = '') => {
    try {
      res.write(`data: ${JSON.stringify({ type: 'status', status, message })}\n\n`);
      if (res.flush) res.flush();
    } catch (e) { console.error('Error sending status:', e); }
  };

  const sendError = (message, details = '') => {
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', message, details })}\n\n`);
      res.write(`data: [DONE]\n\n`);
      clearInterval(heartbeat);
      res.end();
    } catch (e) { console.error('Error sending error:', e); }
  };

  try {
    const userId = req.user.id;
    const authorizationHeader = req.headers.authorization;
    const { question, session_id, llm_name: generalLlmName } = req.body;

    sendStatus('initializing', 'Starting legal chat...');

    if (!question || !question.trim()) {
      sendError('Question is required');
      return;
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const hasExistingSession = session_id && uuidRegex.test(session_id);
    const finalSessionId = hasExistingSession ? session_id : uuidv4();

    console.log(`\n${'='.repeat(80)}`);
    console.log(`📋 [General Chat DB Params] Incoming general legal chat request:`);
    console.log(`   - user_id        : ${userId}`);
    console.log(`   - session_id     : ${session_id || 'none (new session)'}`);
    console.log(`   - is_valid_uuid  : ${hasExistingSession}`);
    console.log(`   - final_session  : ${finalSessionId}`);
    console.log(`   - action         : ${hasExistingSession ? '🔄 CONTINUING existing session' : '🆕 STARTING new session'}`);
    console.log(`   - question       : ${question.trim().substring(0, 100)}`);
    console.log(`${'='.repeat(80)}\n`);

    sendStatus('fetching', 'Loading your professional profile...');

    // Fetch full user profile (basic + professional) for legal context
    const userProfile = await UserProfileService.getFullProfile(userId, authorizationHeader);

    console.log(`\n📦 [General Chat DB Load] Profile loaded from auth service:`);
    console.log(`   - username       : ${userProfile.basic?.username || 'N/A'}`);
    console.log(`   - role           : ${userProfile.professional?.primary_role || 'N/A'}`);
    console.log(`   - jurisdiction   : ${userProfile.professional?.primary_jurisdiction || 'N/A'}`);
    console.log(`   - practice areas : ${userProfile.professional?.main_areas_of_practice || 'N/A'}`);
    console.log(`   - tone pref      : ${userProfile.professional?.preferred_tone || 'N/A'}`);
    console.log(`   - detail level   : ${userProfile.professional?.preferred_detail_level || 'N/A'}\n`);

    // Load previous messages for this session (file_id IS NULL)
    let previousChats = [];
    if (hasExistingSession) {
      const result = await pool.query(
        `SELECT id, question, answer, session_id, created_at
         FROM file_chats
         WHERE user_id = $1 AND session_id = $2 AND file_id IS NULL AND chat_type = 'chat_model'
         ORDER BY created_at ASC`,
        [userId, finalSessionId]
      );
      previousChats = result.rows;
      console.log(`\n📦 [General Chat DB Load] Loaded ${previousChats.length} previous messages from DB:`);
      console.log(`   - DB query: SELECT FROM file_chats WHERE user_id='${userId}' AND session_id='${finalSessionId}' AND file_id IS NULL`);
      previousChats.forEach((chat, i) => {
        console.log(`   [${i + 1}] id=${chat.id} | Q="${(chat.question||'').substring(0,60)}..."`);
      });
    } else {
      console.log(`📦 [General Chat] New session — no previous messages to load`);
    }

    // Build conversation history string for context
    let conversationContext = '';
    if (previousChats.length > 0) {
      conversationContext = previousChats
        .map((c, i) => `Turn ${i + 1}:\nUser: ${c.question}\nAssistant: ${c.answer}`)
        .join('\n\n');
      console.log(`📜 [General Chat] Sending ${previousChats.length} previous messages as context to LLM`);
    }

    const systemInstruction = buildLegalSystemPrompt(userProfile);

    let promptText = question.trim();
    if (conversationContext) {
      promptText = `PREVIOUS CONVERSATION:\n${conversationContext}\n\nCURRENT QUESTION:\n${promptText}`;
    }

    console.log(`📝 [General Chat] System instruction length: ${systemInstruction.length} chars`);
    console.log(`📝 [General Chat] Prompt length: ${promptText.length} chars`);

    // ── LLM config: DB row + per-request overrides (enforceLLMChatPolicy) ─────
    const { llmChatConfig, llmConfigForRequest } = await ensureLlmRequestConfig(req);
    const resolvedGeneralModel =
      typeof generalLlmName === 'string' && generalLlmName.trim() ? generalLlmName.trim() : null;
    console.log(`\n📋 [DB → General Chat LLM Config] Parameters used:`);
    console.log(`   - llm_model            : ${llmConfigForRequest.llm_model}`);
    console.log(`   - max_output_tokens    : ${llmConfigForRequest.max_output_tokens}`);
    console.log(`   - model_temperature    : ${llmConfigForRequest.model_temperature}`);
    console.log(`   - chats_per_day        : ${llmConfigForRequest.chats_per_day}`);
    console.log(`   - messages_per_hour    : ${llmConfigForRequest.messages_per_hour}`);
    // ─────────────────────────────────────────────────────────────────────────

    sendStatus('generating', 'Generating legal response...');

    res.write(`data: ${JSON.stringify({ type: 'metadata', session_id: finalSessionId })}\n\n`);

    let fullAnswer = '';
    let chunkCount = 0;
    const streamingDelayMs = getStreamingDelayMs(llmChatConfig);

    try {
      for await (const chunk of streamLLMGeneral(promptText, systemInstruction, llmConfigForRequest, {
        modelName: resolvedGeneralModel,
        userId,
        sessionId: finalSessionId,
        endpoint: '/api/chat/ask/general/stream',
      })) {
        if (typeof chunk === 'string' && chunk.length > 0) {
          fullAnswer += chunk;
          chunkCount++;
          res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
          if (res.flush) res.flush();
          if (streamingDelayMs > 0) {
            await sleep(streamingDelayMs);
          }
        }
      }

      if (!fullAnswer || fullAnswer.trim().length === 0) {
        throw new Error('Received empty response from LLM');
      }

      console.log(`✅ [General Chat] Streaming completed: ${chunkCount} chunks, ${fullAnswer.length} chars`);
    } catch (streamError) {
      console.error('❌ [General Chat] Streaming error:', streamError);
      sendError('Streaming failed', streamError.message);
      return;
    }

    sendStatus('saving', 'Saving conversation to database...');

    // Build history snapshot for storage
    const historyForStorage = previousChats.map(c => ({
      id: c.id,
      question: c.question,
      answer: c.answer,
      created_at: c.created_at,
    }));

    let savedChat;
    try {
      console.log(`💾 [General Chat] Saving to DB — file_id: NULL, session: ${finalSessionId}`);
      savedChat = await FileChat.saveChat(
        null,          // file_id — null for general chat
        userId,
        question.trim(),
        fullAnswer,
        finalSessionId,
        [],            // usedChunkIds
        false,         // usedSecretPrompt
        null,          // promptLabel
        null,          // secretId
        historyForStorage,
        null           // attached_files — N/A for general legal chat
      );
      console.log(`✅ [General Chat] Saved — chat_id: ${savedChat.id}, session: ${savedChat.session_id}`);
    } catch (saveError) {
      console.error(`❌ [General Chat] Failed to save to DB:`, saveError.message);
      savedChat = { id: null, session_id: finalSessionId, created_at: new Date().toISOString() };
    }

    const completionData = {
      type: 'done',
      session_id: finalSessionId,
      chat_id: savedChat.id,
      answer: fullAnswer,
      answer_length: fullAnswer.length,
      chunks_received: chunkCount,
      is_general_chat: true,
    };

    res.write(`data: ${JSON.stringify(completionData)}\n\n`);
    if (res.flush) res.flush();
    res.write(`data: [DONE]\n\n`);
    if (res.flush) res.flush();

    clearInterval(heartbeat);
    res.end();

  } catch (error) {
    console.error('❌ [General Chat] Error:', error.message);
    sendError('Failed to process chat request', error.message);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Get general chat history by session (file_id IS NULL)
// ─────────────────────────────────────────────────────────────────────────────
exports.getGeneralChatHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { session_id } = req.params;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(session_id)) {
      return res.status(400).json({ success: false, message: 'Invalid session_id format' });
    }

    console.log(`📋 [General Chat] Fetching history — user: ${userId}, session: ${session_id}`);

    const result = await pool.query(
      `SELECT id, user_id, question, answer, session_id, used_secret_prompt,
              prompt_label, secret_id, created_at
       FROM file_chats
       WHERE user_id = $1 AND session_id = $2 AND file_id IS NULL AND chat_type = 'chat_model'
       ORDER BY created_at ASC`,
      [userId, session_id]
    );

    const history = result.rows.map(row => ({
      id: row.id,
      question: row.question,
      answer: row.answer,
      session_id: row.session_id,
      created_at: row.created_at,
      used_secret_prompt: false,
      prompt_label: null,
      file_id: null,
      is_general_chat: true,
    }));

    console.log(`✅ [General Chat] Loaded ${history.length} messages for session ${session_id}`);

    return res.status(200).json({
      success: true,
      data: {
        session_id,
        history,
        count: history.length,
        is_general_chat: true,
      }
    });

  } catch (error) {
    console.error('❌ [General Chat] Error fetching history:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch general chat history',
      error: error.message
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// List all general chat sessions for the current user (file_id IS NULL)
// ─────────────────────────────────────────────────────────────────────────────
exports.getGeneralChatSessions = async (req, res) => {
  try {
    const userId = req.user.id;

    console.log(`\n📋 [General Sessions] Fetching all general chat sessions for user ${userId}`);
    console.log(`   - DB query: SELECT DISTINCT session_id FROM file_chats WHERE user_id=${userId} AND file_id IS NULL`);

    const result = await pool.query(
      `SELECT
         session_id,
         MIN(created_at)  AS first_message_at,
         MAX(created_at)  AS last_message_at,
         COUNT(*)::int    AS message_count,
         (array_agg(question ORDER BY created_at ASC))[1]  AS first_question,
         (array_agg(question ORDER BY created_at DESC))[1] AS last_question
       FROM file_chats
       WHERE user_id = $1 AND file_id IS NULL AND chat_type = 'chat_model'
       GROUP BY session_id
       ORDER BY MAX(created_at) DESC`,
      [userId]
    );

    console.log(`✅ [General Sessions] Found ${result.rows.length} session(s) for user ${userId}`);
    result.rows.forEach((row, i) => {
      console.log(`   [${i + 1}] session=${row.session_id} | msgs=${row.message_count} | last="${(row.last_question||'').substring(0,60)}"`);
    });

    return res.status(200).json({
      success: true,
      data: {
        sessions: result.rows.map(row => ({
          session_id: row.session_id,
          first_message_at: row.first_message_at,
          last_message_at: row.last_message_at,
          message_count: row.message_count,
          first_question: row.first_question,
          last_question: row.last_question,
          is_general_chat: true,
        })),
        count: result.rows.length,
      }
    });

  } catch (error) {
    console.error('❌ [General Sessions] Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch general chat sessions',
      error: error.message
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Secret prompts (same DB + GCP as ask/stream) — no document-service HTTP calls
// ─────────────────────────────────────────────────────────────────────────────
exports.listSecretPrompts = async (req, res) => {
  const includeValues = String(req.query.fetch || '').toLowerCase() === 'true';

  try {
    const query = `
      SELECT
        s.*,
        l.name AS llm_name
      FROM secret_manager s
      LEFT JOIN llm_models l ON s.llm_id::text = l.id::text
      ORDER BY s.created_at DESC
    `;

    const result = await pool.query(query);
    const rows = result.rows;

    if (!includeValues) {
      return res.status(200).json(rows);
    }

    const GCLOUD_PROJECT_ID = process.env.GCLOUD_PROJECT_ID;
    if (!GCLOUD_PROJECT_ID) {
      return res.status(500).json({ error: 'GCLOUD_PROJECT_ID not configured' });
    }

    const secretClient = new SecretManagerServiceClient();

    const enriched = await Promise.all(
      rows.map(async (row) => {
        try {
          const name = `projects/${GCLOUD_PROJECT_ID}/secrets/${row.secret_manager_id}/versions/${row.version}`;
          const [accessResponse] = await secretClient.accessSecretVersion({ name });
          const value = accessResponse.payload.data.toString('utf8');
          return { ...row, value };
        } catch (err) {
          return { ...row, value: '[ERROR: Cannot fetch]' };
        }
      })
    );

    return res.status(200).json(enriched);
  } catch (error) {
    console.error('🚨 [ChatModel] Error fetching secrets:', error.message);
    return res.status(500).json({ error: 'Failed to fetch secrets: ' + error.message });
  }
};

exports.getSecretPromptById = async (req, res) => {
  const { id } = req.params;

  try {
    const query = `
      SELECT
        s.secret_manager_id,
        s.version,
        s.llm_id,
        l.name AS llm_name,
        cm.method_name AS chunking_method
      FROM secret_manager s
      LEFT JOIN chunking_methods cm ON s.chunking_method_id::text = cm.id::text
      LEFT JOIN llm_models l ON s.llm_id::text = l.id::text
      WHERE s.id::text = $1::text
    `;

    const result = await pool.query(query, [String(id)]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '❌ Secret config not found in DB' });
    }

    const { secret_manager_id, version, llm_id, llm_name, chunking_method } = result.rows[0];
    const GCLOUD_PROJECT_ID = process.env.GCLOUD_PROJECT_ID;
    if (!GCLOUD_PROJECT_ID) {
      return res.status(500).json({ error: 'GCLOUD_PROJECT_ID not configured' });
    }

    const secretClient = new SecretManagerServiceClient();
    const secretName = `projects/${GCLOUD_PROJECT_ID}/secrets/${secret_manager_id}/versions/${version}`;
    const [accessResponse] = await secretClient.accessSecretVersion({ name: secretName });
    const secretValue = accessResponse.payload.data.toString('utf8');

    return res.status(200).json({
      secretManagerId: secret_manager_id,
      version,
      llm_id,
      llm_name,
      chunking_method,
      value: secretValue,
    });
  } catch (err) {
    console.error('🚨 [ChatModel] getSecretPromptById:', err.message);
    return res.status(500).json({ error: 'Internal Server Error: ' + err.message });
  }
};
