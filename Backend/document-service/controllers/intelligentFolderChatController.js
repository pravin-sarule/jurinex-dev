const FolderChat = require('../models/FolderChat');
const File = require('../models/File');
const { askGeminiWithMultipleGCS, streamGeminiWithMultipleGCS } = require('../services/folderGeminiService');
const { generateEmbedding } = require('../services/embeddingService');
const ChunkVector = require('../models/ChunkVector');
const FileChunk = require('../models/FileChunk');
const TokenUsageService = require('../services/tokenUsageService');
const UserProfileService = require('../services/userProfileService');
const pool = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const { streamLLM } = require('../services/folderAiService');
const { getSecretDetailsById } = require('./secretManagerController');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { 
  fetchTemplateFilesData, 
  buildEnhancedSystemPromptWithTemplates
} = require('../services/secretPromptTemplateService'); // NEW: Import template service

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function postProcessSecretPromptResponse(rawResponse, outputTemplate = null) {
  if (!rawResponse || typeof rawResponse !== 'string') {
    return rawResponse;
  }

  let cleanedResponse = rawResponse.trim();
  
  const jsonMatch = cleanedResponse.match(/```json\s*([\s\S]*?)\s*```/i);
  if (jsonMatch) {
    try {
      const jsonData = JSON.parse(jsonMatch[1].trim());
      return `\`\`\`json\n${JSON.stringify(jsonData, null, 2)}\n\`\`\``;
    } catch (e) {
      console.warn('[postProcessSecretPromptResponse] Failed to parse JSON from code block:', e);
    }
  }
  
  const trimmed = cleanedResponse.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const jsonData = JSON.parse(trimmed);
      if (!cleanedResponse.includes('```json')) {
        return `\`\`\`json\n${JSON.stringify(jsonData, null, 2)}\n\`\`\``;
      }
      return cleanedResponse;
    } catch (e) {
      console.warn('[postProcessSecretPromptResponse] Failed to parse raw JSON:', e);
    }
  }
  
  const jsonPattern = /\{[\s\S]*\}/;
  const jsonMatch2 = cleanedResponse.match(jsonPattern);
  if (jsonMatch2) {
    try {
      const jsonData = JSON.parse(jsonMatch2[0]);
      return `\`\`\`json\n${JSON.stringify(jsonData, null, 2)}\n\`\`\``;
    } catch (e) {
    }
  }
  
  return cleanedResponse;
}

function addSecretPromptJsonFormatting(secretPrompt, inputTemplate = null, outputTemplate = null) {
  let jsonFormattingInstructions = '';
  
  if (inputTemplate && inputTemplate.extracted_text && outputTemplate && outputTemplate.extracted_text) {
    jsonFormattingInstructions += `\n\n`;
    jsonFormattingInstructions += `═══════════════════════════════════════════════════════════════════════\n`;
    jsonFormattingInstructions += `🔄 WORKFLOW REMINDER - INPUT TO OUTPUT MAPPING\n`;
    jsonFormattingInstructions += `═══════════════════════════════════════════════════════════════════════\n\n`;
    jsonFormattingInstructions += `📥 STEP 1: EXTRACT FROM INPUT TEMPLATE FORMAT\n`;
    jsonFormattingInstructions += `   - Study the INPUT TEMPLATE format shown above to understand what information to look for\n`;
    jsonFormattingInstructions += `   - Identify similar patterns, fields, sections, and data points in the actual documents\n`;
    jsonFormattingInstructions += `   - Extract all relevant points that match the INPUT TEMPLATE structure\n\n`;
    jsonFormattingInstructions += `📤 STEP 2: FORMAT USING OUTPUT TEMPLATE STRUCTURE\n`;
    jsonFormattingInstructions += `   - Take the extracted information and format it according to OUTPUT TEMPLATE structure\n`;
    jsonFormattingInstructions += `   - Map extracted points to corresponding sections in OUTPUT TEMPLATE\n`;
    jsonFormattingInstructions += `   - Ensure the final response follows the EXACT OUTPUT TEMPLATE JSON format\n\n`;
  }

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
    
    if (outputTemplate.structured_schema) {
      try {
        const schema = typeof outputTemplate.structured_schema === 'string' 
          ? JSON.parse(outputTemplate.structured_schema) 
          : outputTemplate.structured_schema;
        if (schema.properties && schema.properties.generated_sections && schema.properties.generated_sections.properties) {
          Object.keys(schema.properties.generated_sections.properties).forEach(key => {
            if (!sectionKeys.includes(key)) {
              sectionKeys.push(key);
            }
          });
        }
      } catch (e) {
        console.warn('Could not parse structured_schema:', e);
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
  "schemas": {
    "output_summary_template": {
      "metadata": {
        "document_title": "Actual title from documents",
        "case_title": "Actual case name",
        "date": "Actual date",
        "prepared_by": "Actual preparer name"
      },
      "generated_sections": {
        "2_1_ground_wise_summary": {
          "generated_text": "Actual comprehensive summary with facts from documents...",
          "required_summary_type": "Extractive"
        },
        "2_2_annexure_summary": {
          "generated_text": "Actual annexure summary with page references...",
          "required_summary_type": "Extractive"
        }
        [... ALL other sections from template ...]
      }
    }
  }
}
\`\`\`

❌ WRONG FORMATS (DO NOT DO THIS):
- Raw JSON without code blocks: {"key": "value"}
- Text before JSON: "Here is the analysis: {...}"
- Text after JSON: {...} "This completes the analysis"
- Missing sections from template
- Placeholder text instead of actual content

✅ VALIDATION CHECKLIST:
Before submitting your response, verify:
- [ ] Response starts with \`\`\`json
- [ ] Response ends with \`\`\`
- [ ] JSON is valid and parseable
- [ ] ALL sections from template are included
- [ ] ALL fields are filled with actual content (not placeholders)
- [ ] Structure matches template exactly
- [ ] No text outside the code block

🎯 FINAL INSTRUCTION:
Generate your response NOW following the template structure exactly. Include ALL sections. Use ONLY the JSON format shown above.`;
  } else {
    jsonFormattingInstructions = `

=== CRITICAL OUTPUT FORMATTING REQUIREMENTS ===

You MUST format your response as clean, structured JSON wrapped in a markdown code block. The frontend needs to easily parse and render your response in a beautiful, document-like format.

REQUIRED FORMAT:
\`\`\`json
{
  "title": "Brief descriptive title of the analysis",
  "summary": "A concise summary of the key findings",
  "sections": [
    {
      "heading": "Section heading",
      "content": "Section content with proper formatting. Use markdown formatting like **bold**, *italic*, lists, tables, etc.",
      "subsections": [
        {
          "heading": "Subsection heading",
          "content": "Subsection content with markdown formatting"
        }
      ]
    }
  ],
  "keyFindings": [
    "Key finding 1 with supporting details",
    "Key finding 2 with supporting details"
  ],
  "recommendations": [
    "Recommendation 1 with actionable steps",
    "Recommendation 2 with actionable steps"
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
4. Use markdown formatting within content strings:
   - **Bold** for emphasis
   - *Italic* for subtle emphasis
   - Lists (bulleted or numbered) for multiple items
   - Tables for structured data (use markdown table syntax)
   - Headings (##, ###) for subsections within content
5. Include all relevant information from the document
6. Make the JSON clean and well-formatted for easy parsing
7. Ensure all JSON is valid and parseable
8. Use rich formatting to make the output visually appealing and easy to read

Your response should ONLY contain the JSON wrapped in markdown code blocks. Do not include any additional text before or after the code block.`;
  }

  return secretPrompt + jsonFormattingInstructions;
}

function ensurePlainText(answer) {
  if (!answer) return '';
  
  if (typeof answer === 'string') {
    try {
      const parsed = JSON.parse(answer);
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
        return JSON.stringify(parsed);
      }
      if (typeof parsed === 'string') {
        return parsed.trim();
      }
    } catch (e) {
      return answer.trim();
    }
  }
  
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
    return JSON.stringify(answer);
  }
  
  return String(answer || '').trim();
}

function analyzeQueryForRouting(question) {
  if (!question || typeof question !== 'string') {
    return {
      method: 'rag',
      reason: 'Invalid query - defaulting to RAG for specific answers',
      confidence: 0.5
    };
  }

  const queryLower = question.toLowerCase().trim();

  const explicitSummaryKeywords = [
    'complete summary', 'complete document summary', 'complete folder summary',
    'summarize all', 'summarize the all', 'summarize all documents', 'summarize all the documents',
    'summarize the complete', 'summarize complete', 'summarize entire',
    'full summary', 'full document summary', 'full folder summary',
    'overall summary', 'entire summary', 'comprehensive summary',
    'document complete summary', 'folder complete summary',
    'all documents summary', 'all files summary',
    'complete overview', 'full overview', 'entire overview',
    'summarize everything', 'summarize all files', 'summarize all documents',
    'give me a summary', 'provide a summary', 'create a summary',
    'summary of all', 'summary of everything', 'summary of the folder',
    'what is the summary', 'what is the overview', 'what is the complete picture',
    'summarize this case', 'summarize the case', 'summarize case', 'summarize this',
    'case summary', 'this case summary', 'the case summary',
    'summary of this case', 'summary of the case', 'summary of case',
    'complete case summary', 'full case summary', 'overall case summary',
    'summarize', 'summary' // Generic summarize/summary at the start
  ];

  const startsWithSummarize = /^(summarize|summary)/i.test(question.trim());

  const specificQuestionKeywords = [
    'what is', 'what are', 'what does', 'what did', 'what was', 'what were',
    'who is', 'who are', 'who did', 'who was',
    'when did', 'when was', 'when is', 'when are',
    'where is', 'where are', 'where did', 'where was',
    'how much', 'how many', 'how did', 'how was', 'how is',
    'which', 'find', 'locate', 'search for', 'tell me about',
    'explain', 'describe', 'show me', 'give me',
    'what evidence', 'what case', 'what section', 'what clause',
    'what paragraph', 'what page', 'what document says',
    'mention of', 'reference to', 'details about', 'information about',
    'evidence about', 'case about', 'section about'
  ];

  const specificPatterns = [
    /\b(page|paragraph|clause|section|article)\s+\d+/i,  // "page 5", "clause 3"
    /\b(find|locate|search|show)\s+(me\s+)?(the|a|an)\s+/i,  // "find the", "show me the"
    /\b(what|which|where|when|who|how)\s+(is|are|was|were|did|does)\s+/i,  // "what is", "where is"
    /\b(evidence|case|section|content|information|details)\s+(about|regarding|concerning)/i,  // "evidence about"
    /\b(amount|date|time|value|number|name|person|party)\s+(is|are|was|were)/i  // "amount is", "date was"
  ];

  const isExplicitSummary = explicitSummaryKeywords.some(keyword => queryLower.includes(keyword));

  if (startsWithSummarize && !queryLower.includes('what') && !queryLower.includes('which') && !queryLower.includes('where')) {
    return {
      method: 'gemini_eyeball',
      reason: 'Query starts with "summarize/summary" - using GEMINI EYEBALL for complete document analysis',
      confidence: 0.9
    };
  }

  if (isExplicitSummary) {
    return {
      method: 'gemini_eyeball',
      reason: 'Explicit complete summary/overview request - using GEMINI EYEBALL for full document vision',
      confidence: 0.95
    };
  }

  const hasSpecificKeyword = specificQuestionKeywords.some(keyword => queryLower.includes(keyword));
  const hasSpecificPattern = specificPatterns.some(pattern => pattern.test(question));

  const isAskingSpecific = hasSpecificKeyword || hasSpecificPattern;


  if (isAskingSpecific) {
    return {
      method: 'rag',
      reason: hasSpecificPattern
        ? 'Specific content lookup with patterns (page/clause/section) - using RAG for precise search'
        : 'Specific question detected - using RAG for targeted semantic search',
      confidence: hasSpecificPattern ? 0.9 : 0.85
    };
  }

  return {
    method: 'rag',
    reason: 'Query requires specific information - using RAG for precise chunk-based search',
    confidence: 0.75
  };
}

function formatConversationHistory(chats = [], limit = 5) {
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

function preservePageInfo(chunk) {
  return {
    ...chunk,
    page_start: chunk.page_start !== null && chunk.page_start !== undefined ? chunk.page_start : null,
    page_end: chunk.page_end !== null && chunk.page_end !== undefined ? chunk.page_end : null,
  };
}

async function extractCitationsFromFiles(files = [], baseUrl = '') {
  if (!Array.isArray(files) || files.length === 0) {
    console.log(`[extractCitationsFromFiles] No files provided`);
    return [];
  }

  console.log(`[extractCitationsFromFiles] Processing ${files.length} files for citations`);

  const citationsMap = new Map(); // Use Map to avoid duplicates: "fileId"
  const FileChunk = require('../models/FileChunk');

  for (const file of files) {
    const fileId = file.id;
    const filename = file.originalname || 'document.pdf';

    if (!fileId) {
      console.warn(`[extractCitationsFromFiles] File missing ID: ${filename}`);
      continue;
    }

    try {
      const chunks = await FileChunk.getChunksByFileId(fileId);
      let firstPage = 1;
      
      if (chunks && chunks.length > 0) {
        const pages = chunks
          .map(c => c.page_start)
          .filter(p => p !== null && p !== undefined && p > 0);
        
        if (pages.length > 0) {
          firstPage = Math.min(...pages);
        }
      }

      const citationKey = fileId; // Unique key: fileId

      if (!citationsMap.has(citationKey)) {
        let text = 'Full document analysis';
        if (chunks && chunks.length > 0 && chunks[0].content) {
          const contentSnippet = chunks[0].content.substring(0, 150).trim();
          text = contentSnippet.length > 0
            ? `${contentSnippet}${contentSnippet.length >= 150 ? '...' : ''}`
            : 'Full document analysis';
        }

        const viewUrl = fileId
          ? `${baseUrl}/api/files/file/${fileId}/view?page=${firstPage}`
          : null;

        citationsMap.set(citationKey, {
          page: firstPage,
          pageStart: firstPage,
          pageEnd: null, // Full document, no specific end page
          pageLabel: `Full Document`, // Indicates entire document was analyzed
          source: `${filename} - Full Document`, // e.g., "document.pdf - Full Document"
          filename: filename,
          fileId: fileId,
          text: text,
          link: `${filename}#page=${firstPage}`, // Link format for PDF viewer
          viewUrl: viewUrl, // API endpoint to get signed URL
          isFullDocument: true, // Flag to indicate this is a full document citation
        });
      }
    } catch (error) {
      console.error(`[extractCitationsFromFiles] Error processing file ${fileId}:`, error.message);
    }
  }

  const citations = Array.from(citationsMap.values())
    .sort((a, b) => a.filename.localeCompare(b.filename));

  console.log(`[extractCitationsFromFiles] Citations extracted: ${citations.length} from ${files.length} files`);

  return citations;
}

async function extractCitationsFromChunks(chunks = [], baseUrl = '') {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    console.log(`[extractCitationsFromChunks] No chunks provided`);
    return [];
  }
  
  console.log(`[extractCitationsFromChunks] Processing ${chunks.length} chunks for citations`);
  
  const citationsMap = new Map(); // Use Map to avoid duplicates: "fileId:pageNumber"
  let chunksWithoutPages = 0;
  let chunksWithoutFileId = 0;
  
  chunks.forEach((chunk, index) => {
    const filename = chunk.filename || 'document.pdf';
    const fileId = chunk.file_id || chunk.fileId || null;
    const pageStart = chunk.page_start !== null && chunk.page_start !== undefined 
      ? chunk.page_start 
      : (chunk.pageStart !== null && chunk.pageStart !== undefined ? chunk.pageStart : null);
    const pageEnd = chunk.page_end !== null && chunk.page_end !== undefined
      ? chunk.page_end
      : (chunk.pageEnd !== null && chunk.pageEnd !== undefined ? chunk.pageEnd : null);
    
    if (index < 3) {
      console.log(`[extractCitationsFromChunks] Chunk ${index}: fileId=${fileId}, page_start=${pageStart}, page_end=${pageEnd}, filename=${filename}`);
    }
    
    if (pageStart !== null && pageStart !== undefined && fileId) {
      const pageNumber = parseInt(pageStart, 10) || pageStart; // Ensure it's a number
      const citationKey = `${fileId}:${pageNumber}`; // Unique key: fileId:pageNumber
      
      if (!citationsMap.has(citationKey)) {
        const contentSnippet = (chunk.content || '').substring(0, 150).trim();
        const text = contentSnippet.length > 0 
          ? `${contentSnippet}${contentSnippet.length >= 150 ? '...' : ''}`
          : 'Content from page';
        
            const viewUrl = fileId
              ? `${baseUrl}/api/files/file/${fileId}/view?page=${pageNumber}`
              : null;
        
        citationsMap.set(citationKey, {
          page: pageNumber,
          pageStart: pageStart,
          pageEnd: pageEnd || pageStart,
          filename: filename,
          fileId: fileId,
          text: text,
          pageLabel: pageEnd && pageEnd !== pageStart 
            ? `Pages ${pageStart}-${pageEnd}`
            : `Page ${pageNumber}`,
          link: `${filename}#page=${pageNumber}`,
          viewUrl: viewUrl,
          source: `${filename} - ${pageEnd && pageEnd !== pageStart ? `Pages ${pageStart}-${pageEnd}` : `Page ${pageNumber}`}`,
        });
      }
    } else {
      if (!fileId) {
        chunksWithoutFileId++;
      }
      if (pageStart === null || pageStart === undefined) {
        chunksWithoutPages++;
      }
    }
  });
  
  console.log(`[extractCitationsFromChunks] Citations extracted: ${citationsMap.size}`);
  if (chunksWithoutPages > 0) {
    console.warn(`[extractCitationsFromChunks] ⚠️ ${chunksWithoutPages} chunks skipped - missing page_start`);
  }
  if (chunksWithoutFileId > 0) {
    console.warn(`[extractCitationsFromChunks] ⚠️ ${chunksWithoutFileId} chunks skipped - missing file_id`);
  }
  
  const citations = Array.from(citationsMap.values())
    .sort((a, b) => {
      if (a.filename !== b.filename) {
        return a.filename.localeCompare(b.filename);
      }
      return (a.page || 0) - (b.page || 0);
    });
  
  return citations;
}

exports.intelligentFolderChat = async (req, res) => {
  try {
    console.log('🚀 [intelligentFolderChat] Controller called');
    console.log('🚀 [intelligentFolderChat] Request params:', req.params);
    console.log('🚀 [intelligentFolderChat] Request body:', req.body);

    let userId = req.user?.id;
    const authorizationHeader = req.headers.authorization;

    if (!userId) {
      console.error('❌ [intelligentFolderChat] No user ID found');
      return res.status(401).json({ error: "Unauthorized - user not found" });
    }

    const { folderName } = req.params;
    const {
      question,
      session_id = null,
      llm_name = 'gemini',
      secret_id = null,
    } = req.body;

    if (!folderName) {
      console.error('❌ [intelligentFolderChat] No folderName in params');
      return res.status(400).json({ error: "folderName is required in URL path" });
    }

    const hasSecretId = secret_id && (secret_id !== null && secret_id !== undefined && secret_id !== '');
    if (!hasSecretId && (!question || !question.trim())) {
      return res.status(400).json({ error: "question is required when secret_id is not provided." });
    }

    const hasExistingSession = session_id && UUID_REGEX.test(session_id);
    const finalSessionId = hasExistingSession ? session_id : uuidv4();

    console.log(`📁 [Intelligent Routing] Folder: ${folderName} | Session: ${finalSessionId}`);
    console.log(`💬 Query: "${(question || '').substring(0, 100)}..."`);
    console.log(`🔐 Secret ID: ${secret_id || 'none'}`);

    let used_secret_prompt = false;
    let secretLlmName = null;
    let secretProvider = null;
    let isSecretGemini = false;
    let secretValue = null;
    let secretName = null;
    if (hasSecretId) {
      used_secret_prompt = true;
      console.log(`🔐 [Secret Prompt] Fetching secret configuration for secret_id: ${secret_id}`);

      try {
        const secretDetails = await getSecretDetailsById(secret_id);
        
        if (!secretDetails) {
          console.warn(`🔐 [Secret Prompt] Secret not found in database`);
        } else {
          const {
            name: dbSecretName,
            secret_manager_id,
            version,
            llm_name: dbLlmName,
            chunking_method: dbChunkingMethod,
            input_template_id,
            output_template_id,
          } = secretDetails;

          secretName = dbSecretName;
          secretLlmName = dbLlmName;

          const { resolveProviderName } = require('../services/folderAiService');
          secretProvider = resolveProviderName(secretLlmName || 'gemini');
          isSecretGemini = secretProvider.startsWith('gemini');

          console.log(`🔐 [Secret Prompt] Found secret: ${secretName}`);
          console.log(`🔐 [Secret Prompt] LLM from secret_manager table: ${secretLlmName || 'none'}`);
          console.log(`🔐 [Secret Prompt] Resolved provider: ${secretProvider}`);
          console.log(`🔐 [Secret Prompt] Is Gemini: ${isSecretGemini}`);
          console.log(`🔐 [Secret Prompt] Chunking method: ${dbChunkingMethod || 'none'}`);

          if (secret_manager_id && version) {
            try {
              const secretClient = new SecretManagerServiceClient();
              const GCLOUD_PROJECT_ID = process.env.GCLOUD_PROJECT_ID;

              if (!GCLOUD_PROJECT_ID) {
                throw new Error('GCLOUD_PROJECT_ID not configured');
              }

              const gcpSecretName = `projects/${GCLOUD_PROJECT_ID}/secrets/${secret_manager_id}/versions/${version}`;
              console.log(`🔐 [Secret Prompt] Fetching secret value from GCP: ${gcpSecretName}`);

              let accessResponse;
              try {
                [accessResponse] = await secretClient.accessSecretVersion({ name: gcpSecretName });
                secretValue = accessResponse.payload.data.toString('utf8');
              } catch (gcpError) {
                console.error(`\n${'='.repeat(80)}`);
                console.error(`🔐 [Secret Prompt] ❌ GCP SECRET MANAGER ACCESS DENIED`);
                console.error(`${'='.repeat(80)}`);
                console.error(`Error: ${gcpError.message}`);
                console.error(`Secret Path: ${gcpSecretName}`);
                console.error(`\n🔧 TO FIX THIS ISSUE:`);
                console.error(`1. Ensure the service account has 'Secret Manager Secret Accessor' role`);
                console.error(`2. Grant permission: roles/secretmanager.secretAccessor`);
                console.error(`3. Verify GCS_KEY_BASE64 contains valid credentials`);
                console.error(`4. Check that the secret exists in GCP Secret Manager`);
                console.error(`5. Verify the service account email has access to the secret`);
                console.error(`${'='.repeat(80)}\n`);
                throw new Error(`GCP Secret Manager access denied: ${gcpError.message}`);
              }

              if (!secretValue?.trim()) {
                console.warn(`🔐 [Secret Prompt] Secret value is empty in GCP`);
              } else {
                console.log(`🔐 [Secret Prompt] Secret value fetched successfully (${secretValue.length} characters)`);
              }

              if (input_template_id || output_template_id) {
                console.log(`\n📄 [Secret Prompt] Fetching template files:`);
                console.log(`   Input Template ID: ${input_template_id || 'not set'}`);
                console.log(`   Output Template ID: ${output_template_id || 'not set'}\n`);
                
                const templateData = await fetchTemplateFilesData(input_template_id, output_template_id);
                
                if (templateData.hasTemplates) {
                  console.log(`✅ [Secret Prompt] Template files fetched successfully`);
                  if (templateData.inputTemplate) {
                    console.log(`   Input: ${templateData.inputTemplate.filename} (${templateData.inputTemplate.extracted_text?.length || 0} chars)`);
                  }
                  if (templateData.outputTemplate) {
                    console.log(`   Output: ${templateData.outputTemplate.filename} (${templateData.outputTemplate.extracted_text?.length || 0} chars)`);
                  }
                  
                  secretValue = buildEnhancedSystemPromptWithTemplates(secretValue, templateData);
                  secretTemplateData = templateData; // Store for later use
                  console.log(`✅ [Secret Prompt] Enhanced prompt built with template examples (${secretValue.length} chars)\n`);
                } else {
                  console.log(`⚠️ [Secret Prompt] No template files found or available\n`);
                }
              }
            } catch (gcpError) {
              console.error(`🔐 [Secret Prompt] Error fetching secret from GCP:`, gcpError.message);
              throw gcpError; // Re-throw to handle properly
            }
          } else {
            console.warn(`🔐 [Secret Prompt] Missing secret_manager_id or version in database`);
          }
        }
      } catch (secretError) {
        console.error(`🔐 [Secret Prompt] Error fetching secret:`, secretError.message);
        return res.status(500).json({ 
          error: "Failed to fetch secret configuration.",
          details: secretError.message 
        });
      }
    }

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
    }

    const folderQuery = `
      SELECT id, originalname, folder_path
      FROM user_files
      WHERE user_id = $1
        AND is_folder = true
        AND originalname = $2
      ORDER BY created_at DESC
      LIMIT 1;
    `;
    const { rows: folderRows } = await pool.query(folderQuery, [userId, folderName]);
    
    if (folderRows.length === 0) {
      console.error(`❌ [FOLDER ISOLATION] Folder "${folderName}" not found for user`);
      return res.status(404).json({
        error: `Folder "${folderName}" not found.`,
        folder_name: folderName
      });
    }
    
    const folderRow = folderRows[0];
    const actualFolderPath = folderRow.folder_path; // This could be null, empty string, or a path
    
    let filesQuery, queryParams;
    if (!actualFolderPath || actualFolderPath === '') {
      filesQuery = `
        SELECT id, originalname, folder_path, status, gcs_path, mimetype, is_folder
        FROM user_files
        WHERE user_id = $1
          AND is_folder = false
          AND status = 'processed'
          AND (folder_path IS NULL OR folder_path = '')
        ORDER BY created_at DESC;
      `;
      queryParams = [userId];
    } else {
      filesQuery = `
        SELECT id, originalname, folder_path, status, gcs_path, mimetype, is_folder
        FROM user_files
        WHERE user_id = $1
          AND is_folder = false
          AND status = 'processed'
          AND folder_path = $2
        ORDER BY created_at DESC;
      `;
      queryParams = [userId, actualFolderPath];
    }
    
    const { rows: files } = await pool.query(filesQuery, queryParams);
    
    console.log(`📂 [FOLDER ISOLATION] Folder "${folderName}" has folder_path: "${actualFolderPath || '(root)'}"`);

    console.log(`📂 [FOLDER ISOLATION] Total processed files found in folder "${folderName}": ${files.length}`);
    if (files.length > 0) {
      console.log(`📂 [FOLDER ISOLATION] Files found:`, files.map(f => ({ 
        name: f.originalname, 
        status: f.status, 
        folder_path: f.folder_path || '(null)'
      })));
      const wrongFolderFiles = files.filter(f => (f.folder_path || '') !== (actualFolderPath || ''));
      if (wrongFolderFiles.length > 0) {
        console.error(`❌ [FOLDER ISOLATION] CRITICAL ERROR: Found ${wrongFolderFiles.length} files from wrong folder!`);
        console.error(`❌ [FOLDER ISOLATION] Wrong files:`, wrongFolderFiles.map(f => ({
          name: f.originalname,
          expected_folder_path: actualFolderPath || '(root)',
          actual_folder_path: f.folder_path || '(root)'
        })));
      }
    } else {
      const debugQuery = `
        SELECT DISTINCT folder_path, COUNT(*) as file_count
        FROM user_files
        WHERE user_id = $1 AND is_folder = false
        GROUP BY folder_path
        ORDER BY file_count DESC
        LIMIT 10;
      `;
      const { rows: debugRows } = await pool.query(debugQuery, [userId]);
      console.log(`🔍 [DEBUG] Available folder_path values in database:`, debugRows.map(r => ({
        folder_path: r.folder_path || '(null/empty)',
        file_count: r.file_count
      })));
      console.log(`🔍 [DEBUG] Querying for folder_path: "${actualFolderPath || '(null/empty)'}"`);
    }

    const processedFiles = files; // Already filtered by query

    if (processedFiles.length === 0) {
      console.log(`⚠️ No processed documents found. Total files: ${files.length}, Processed: ${processedFiles.length}`);
      return res.status(404).json({
        error: "No processed documents found in this folder.",
        total_files: files.length,
        processed_files: processedFiles.length,
        folder_name: folderName
      });
    }

    console.log(`📄 Found ${processedFiles.length} processed files in folder`);

    let routingDecision;
    let finalProvider = null; // Will be set based on secret prompt or DB fetch

    if (used_secret_prompt && secret_id) {
      routingDecision = {
        method: 'rag',
        reason: 'Secret prompt - always use RAG with specified LLM (policy enforced)',
        confidence: 1.0
      };
      finalProvider = secretProvider; // Use LLM from secret_manager table

      console.log(`\n${'='.repeat(80)}`);
      console.log(`🔐 [SECRET PROMPT] ROUTING DECISION`);
      console.log(`${'='.repeat(80)}`);
      console.log(`🔒 SECRET PROMPT POLICY:`);
      console.log(`   ✅ Always use RAG method (no Gemini Eyeball)`);
      console.log(`   ✅ Use ONLY the LLM specified in secret configuration`);
      console.log(`\nSecret Configuration:`);
      console.log(`   - Secret Name: "${secretName}"`);
      console.log(`   - LLM from Secret: ${secretLlmName || 'not set'}`);
      console.log(`   - Resolved Provider: ${secretProvider}`);
      console.log(`   - Method: RAG (enforced)`);
      console.log(`${'='.repeat(80)}\n`);
    } else {
      routingDecision = analyzeQueryForRouting(question);

      if (isFreeUser) {
        if (routingDecision.method === 'gemini_eyeball') {
          const eyeballLimitCheck = await TokenUsageService.checkFreeTierEyeballLimit(userId, plan);
          if (!eyeballLimitCheck.allowed) {
            console.log(`\n${'🆓'.repeat(40)}`);
            console.log(`[FREE TIER] Gemini Eyeball limit reached - forcing RAG`);
            console.log(`[FREE TIER] ${eyeballLimitCheck.message}`);
            console.log(`${'🆓'.repeat(40)}\n`);
            
            routingDecision = {
              method: 'rag',
              reason: 'Free tier: Gemini Eyeball limit reached (1/day), using RAG retrieval instead',
              confidence: 1.0
            };
          } else {
            console.log(`\n${'🆓'.repeat(40)}`);
            console.log(`[FREE TIER] Gemini Eyeball allowed: ${eyeballLimitCheck.message}`);
            console.log(`${'🆓'.repeat(40)}\n`);
          }
        } else if (routingDecision.method === 'rag') {
          console.log(`\n${'🆓'.repeat(40)}`);
          console.log(`[FREE TIER] Using RAG retrieval (subsequent chat after first Eyeball use)`);
          console.log(`${'🆓'.repeat(40)}\n`);
        }
      }

      if (routingDecision.method === 'rag') {
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
          console.log(`🤖 [RAG] Using LLM from custom_query table: ${dbLlmName}`);
        } else {
          console.warn(`⚠️ [RAG] No LLM found in custom_query table — falling back to gemini`);
          dbLlmName = 'gemini';
        }

        const { resolveProviderName, getAvailableProviders } = require('../services/folderAiService');
        finalProvider = resolveProviderName(dbLlmName || 'gemini');
        console.log(`🤖 [RAG] Resolved LLM provider for custom query: ${finalProvider}`);

        const availableProviders = getAvailableProviders();
        if (!availableProviders[finalProvider] || !availableProviders[finalProvider].available) {
          console.warn(`⚠️ [RAG] Provider '${finalProvider}' unavailable — falling back to gemini`);
          finalProvider = 'gemini';
        }
      } else {
        finalProvider = 'gemini';
        console.log(`👁️ [Gemini Eyeball] Using Gemini (Eyeball is Gemini-specific)`);
      }

      console.log(`\n${'='.repeat(80)}`);
      console.log(`🧠 [ROUTING DECISION] Query: "${question.substring(0, 100)}${question.length > 100 ? '...' : ''}"`);
      console.log(`🧠 [ROUTING DECISION] Method: ${routingDecision.method.toUpperCase()}`);
      console.log(`🧠 [ROUTING DECISION] Reason: ${routingDecision.reason}`);
      console.log(`🧠 [ROUTING DECISION] Confidence: ${routingDecision.confidence}`);
      console.log(`🧠 [ROUTING DECISION] Provider: ${finalProvider}`);
      if (routingDecision.method === 'gemini_eyeball') {
        console.log(`👁️ [ROUTING] Using GEMINI EYEBALL - Complete document vision (ChatModel)`);
      } else {
        console.log(`🔍 [ROUTING] Using RAG - Targeted semantic search with chunks`);
      }
      console.log(`${'='.repeat(80)}\n`);
    }

    let previousChats = [];
    if (hasExistingSession) {
      previousChats = await FolderChat.getFolderChatHistory(userId, folderName, finalSessionId);
    }
    const conversationContext = formatConversationHistory(previousChats);
    const historyForStorage = simplifyHistory(previousChats);

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

    let answer;
    let usedChunkIds = [];
    let usedFileIds = processedFiles.map(f => f.id);
    let methodUsed = routingDecision.method;
    let usedChunksForCitations = []; // Store chunks used for citation extraction
    let secretTemplateData = null; // Store template data for post-processing

    if (isFreeUser) {
      finalProvider = 'gemini';
      console.log(`\n${'🆓'.repeat(40)}`);
      console.log(`[FREE TIER] Forcing model: ${TokenUsageService.getFreeTierForcedModel()}`);
      console.log(`${'🆓'.repeat(40)}\n`);
    }

    if (routingDecision.method === 'gemini_eyeball') {
      console.log(`👁️ [Gemini Eyeball] Starting complete folder summary...`);
      console.log(`👁️ [Gemini Eyeball] Files to process: ${processedFiles.length}`);
      console.log(`👁️ [Gemini Eyeball] Note: Using Gemini models (Eyeball is Gemini-specific, ignoring llm_name="${llm_name}")`);

      const bucketName = process.env.GCS_BUCKET_NAME;
      if (!bucketName) {
        console.error('❌ [Gemini Eyeball] GCS_BUCKET_NAME not configured');
        throw new Error('GCS_BUCKET_NAME not configured');
      }
      console.log(`👁️ [Gemini Eyeball] Using bucket: ${bucketName}`);

      const documents = processedFiles.map((file, index) => {
        const gcsUri = `gs://${bucketName}/${file.gcs_path}`;
        console.log(`👁️ [Gemini Eyeball] Document ${index + 1}/${processedFiles.length}: ${file.originalname}`);
        console.log(`👁️ [Gemini Eyeball]   GCS Path: ${file.gcs_path}`);
        console.log(`👁️ [Gemini Eyeball]   GCS URI: ${gcsUri}`);
        console.log(`👁️ [Gemini Eyeball]   MIME Type: ${file.mimetype || 'application/pdf'}`);
        return {
          gcsUri: gcsUri,
          filename: file.originalname,
          mimeType: file.mimetype || 'application/pdf'
        };
      });

      console.log(`👁️ [Gemini Eyeball] Built ${documents.length} document objects`);

      let promptText = question;
      if (conversationContext) {
        console.log(`👁️ [Gemini Eyeball] Adding conversation context (${conversationContext.length} chars)`);
        promptText = `Previous Conversation:\n${conversationContext}\n\n---\n\n${promptText}`;
      }

      if (used_secret_prompt && secretValue) {
        const inputTemplate = secretTemplateData?.inputTemplate || null;
        const outputTemplate = secretTemplateData?.outputTemplate || null;
        const formattedSecretValue = addSecretPromptJsonFormatting(secretValue, inputTemplate, outputTemplate);
        promptText = `${formattedSecretValue}\n\n=== USER QUESTION ===\n${promptText}`;
        console.log(`🔐 [Gemini Eyeball] Added secret prompt with JSON formatting: "${secretName}" (${formattedSecretValue.length} chars)`);
      }

      console.log(`👁️ [Gemini Eyeball] Final prompt length: ${promptText.length} chars`);

      console.log(`👁️ [Gemini Eyeball] Calling askGeminiWithMultipleGCS...`);
      console.log(`👁️ [Gemini Eyeball] Request started at: ${new Date().toISOString()}`);
      const startTime = Date.now();

      try {
        const forcedModel = isFreeUser ? TokenUsageService.getFreeTierForcedModel() : null;
        const geminiPromise = askGeminiWithMultipleGCS(promptText, documents, '', forcedModel);
        const overallTimeout = new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error('Gemini Eyeball request exceeded maximum timeout of 4 minutes'));
          }, 240000); // 4 minutes overall timeout
        });

        answer = await Promise.race([geminiPromise, overallTimeout]);
        
        if (used_secret_prompt && secretTemplateData?.outputTemplate) {
          answer = postProcessSecretPromptResponse(answer, secretTemplateData.outputTemplate);
        } else {
          answer = ensurePlainText(answer);
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\n${'='.repeat(80)}`);
        console.log(`✅✅✅ ANSWER PROVIDED BY: GEMINI EYEBALL ✅✅✅`);
        console.log(`✅ [Gemini Eyeball] Answer length: ${answer.length} chars`);
        console.log(`✅ [Gemini Eyeball] Documents processed: ${documents.length}`);
        console.log(`✅ [Gemini Eyeball] Chunks used: 0 (using full document vision)`);
        console.log(`✅ [Gemini Eyeball] Request duration: ${duration}s`);
        console.log(`${'='.repeat(80)}\n`);
      } catch (geminiError) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.error(`\n${'='.repeat(80)}`);
        console.error(`❌ [Gemini Eyeball] Error occurred after ${duration}s`);
        console.error(`❌ [Gemini Eyeball] Error type: ${geminiError.name || 'Unknown'}`);
        console.error(`❌ [Gemini Eyeball] Error message: ${geminiError.message || 'No message'}`);
        console.error(`❌ [Gemini Eyeball] Error stack:`, geminiError.stack);

        const isTimeout = geminiError.message && (
          geminiError.message.includes('timeout') ||
          geminiError.message.includes('exceeded maximum timeout') ||
          geminiError.message.includes('took longer than')
        );

        if (isTimeout) {
          console.error(`⏱️ [Gemini Eyeball] TIMEOUT ERROR: Request took too long`);
        }

        console.error(`${'='.repeat(80)}\n`);

        console.log(`\n${'='.repeat(80)}`);
        console.log(`🔄 [FALLBACK] Gemini Eyeball failed, falling back to RAG method...`);
        console.log(`🔄 [FALLBACK] Reason: ${isTimeout ? 'Request timeout' : geminiError.message}`);
        console.log(`${'='.repeat(80)}\n`);
        methodUsed = 'rag';

        routingDecision.method = 'rag';
        routingDecision.reason = isTimeout ? 'Gemini Eyeball timeout, using RAG fallback' : 'Gemini Eyeball failed, using RAG fallback';
      }

      if (methodUsed === 'gemini_eyeball') {
        usedChunkIds = [];
      }

    }

    if (routingDecision.method === 'rag' || methodUsed === 'rag') {
      console.log(`🔍 [RAG] Using RAG method for ${methodUsed === 'rag' ? 'targeted query' : 'fallback after Gemini error'}...`);
      console.log(`🔍 [RAG] Processing ${processedFiles.length} files`);

      let basePrompt;
      if (used_secret_prompt && secretValue) {
        const inputTemplate = secretTemplateData?.inputTemplate || null;
        const outputTemplate = secretTemplateData?.outputTemplate || null;
        basePrompt = addSecretPromptJsonFormatting(secretValue, inputTemplate, outputTemplate);
      } else {
        basePrompt = question;
      }
      
      let promptText = basePrompt;
      if (conversationContext) {
        console.log(`🔍 [RAG] Adding conversation context (${conversationContext.length} chars)`);
        promptText = `Previous Conversation:\n${conversationContext}\n\n---\n\n${promptText}`;
      }

      const embeddingSource = (used_secret_prompt && secretValue) ? secretValue : question;
      console.log(`🔍 [RAG] Generating embedding for ${used_secret_prompt ? 'secret prompt' : 'question'}...`);
      const questionEmbedding = await generateEmbedding(embeddingSource);
      console.log(`🔍 [RAG] Embedding generated, length: ${questionEmbedding.length}`);

      const allRelevantChunks = [];

      for (let i = 0; i < processedFiles.length; i++) {
        const file = processedFiles[i];
        
        if (file.folder_path !== folderName) {
          console.error(`❌ [FOLDER ISOLATION] SKIPPING FILE: "${file.originalname}" - Wrong folder!`);
          console.error(`   Expected folder: "${folderName}"`);
          console.error(`   Actual folder: "${file.folder_path}"`);
          continue; // Skip files from wrong folder
        }
        
        console.log(`\n🔍 [RAG] Searching file ${i + 1}/${processedFiles.length}: ${file.originalname}`);
        console.log(`   File ID: ${file.id} (type: ${typeof file.id})`);
        console.log(`   File Status: ${file.status}`);
        console.log(`   ✅ Folder verified: ${file.folder_path}`);
        
        const debugChunks = await FileChunk.getChunksByFileId(file.id);
        console.log(`   📋 Chunks in database: ${debugChunks.length}`);
        
        if (debugChunks.length === 0) {
          console.log(`   ⚠️ No chunks found in database for this file - skipping vector search`);
          continue;
        }
        
        const chunkIds = debugChunks.map(c => c.id);
        const debugVectors = await ChunkVector.getVectorsByChunkIds(chunkIds);
        console.log(`   🔗 Embeddings in database: ${debugVectors.length} for ${chunkIds.length} chunks`);
        
        if (debugVectors.length === 0) {
          console.log(`   ⚠️ WARNING: Chunks exist but no embeddings found!`);
          console.log(`   💡 Using chunks directly as fallback.`);
          const fallbackChunks = debugChunks.map(c => ({
            ...preservePageInfo(c), // Ensure page_start/page_end are preserved
            filename: file.originalname,
            file_id: file.id,
            similarity: 0.5,
            distance: 1.0,
            chunk_id: c.id,
            content: c.content
          }));
          allRelevantChunks.push(...fallbackChunks);
          console.log(`   ✅ Added ${fallbackChunks.length} chunks as fallback (no embeddings available)`);
          continue;
        }
        
        const fileIdStr = String(file.id).trim();
        const isValidUUID = UUID_REGEX.test(fileIdStr);
        
        if (!isValidUUID) {
          console.error(`   ❌ Invalid file ID format: ${file.id} (expected UUID)`);
          const fallbackChunks = debugChunks.map(c => ({
            ...preservePageInfo(c), // Ensure page_start/page_end are preserved
            filename: file.originalname,
            file_id: file.id,
            similarity: 0.5,
            distance: 1.0,
            chunk_id: c.id,
            content: c.content
          }));
          allRelevantChunks.push(...fallbackChunks);
          console.log(`   ✅ Added ${fallbackChunks.length} chunks as fallback (invalid file ID format)`);
          continue;
        }
        
        console.log(`   🔎 Performing vector search with embedding...`);
        const relevant = await ChunkVector.findNearestChunks(
          questionEmbedding,
          5, // Get top 5 chunks per file
          [fileIdStr] // Pass as array of UUIDs
        );

        console.log(`   📊 Vector search found: ${relevant.length} relevant chunks`);

        if (relevant.length > 0) {
          const chunksWithSimilarity = relevant.map((r) => {
            const distance = parseFloat(r.distance) || 2.0;
            const similarity = r.similarity || (1 / (1 + distance));
            return {
              ...preservePageInfo(r), // Ensure page_start/page_end are preserved
              filename: file.originalname,
              file_id: file.id,
              similarity: similarity,
              distance: distance,
              chunk_id: r.chunk_id || r.id
            };
          });
          allRelevantChunks.push(...chunksWithSimilarity);
          console.log(`   ✅ Added ${chunksWithSimilarity.length} chunks (similarity range: ${Math.min(...chunksWithSimilarity.map(c => c.similarity)).toFixed(3)} - ${Math.max(...chunksWithSimilarity.map(c => c.similarity)).toFixed(3)})`);
        } else {
          console.log(`   ⚠️ Vector search returned 0 results, but ${debugChunks.length} chunks exist`);
          console.log(`   💡 Using all chunks as fallback since embeddings exist but don't match query`);
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
          console.log(`   ✅ Added ${fallbackChunks.length} chunks as fallback (vector search had no matches)`);
        }
      }

      console.log(`\n🔍 [RAG] Total relevant chunks found: ${allRelevantChunks.length}`);

      if (allRelevantChunks.length === 0) {
        console.warn(`\n⚠️ [RAG] No chunks found via vector search - trying fallback...`);
        console.warn(`   - Files searched: ${processedFiles.length}`);
        
        const processingFiles = processedFiles.filter(f => f.status !== 'processed');
        if (processingFiles.length > 0) {
          console.warn(`   - ⚠️ ${processingFiles.length} file(s) still processing: ${processingFiles.map(f => f.originalname).join(', ')}`);
          sendError("Document is still being processed. Please wait for processing to complete before asking questions.");
          return;
        }
        
        console.log(`   - Attempting fallback: Using all chunks from processed files...`);
        const fallbackChunks = [];
        for (const file of processedFiles) {
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
          console.log(`   ✅ Fallback successful: Using ${fallbackChunks.length} chunks from ${processedFiles.length} file(s)`);
          allRelevantChunks.push(...fallbackChunks);
        } else {
          console.error(`\n❌ [RAG] No chunks found even with fallback!`);
          console.error(`   - Files searched: ${processedFiles.length}`);
          console.error(`   - Files status: ${processedFiles.map(f => `${f.originalname}: ${f.status}`).join(', ')}`);
          console.log(`⚠️ [RAG] No relevant chunks found - using conversation history + user context + case data`);

        let profileContext = '';
        try {
          profileContext = await UserProfileService.getProfileContext(userId, authorizationHeader) || '';
          if (profileContext) {
            console.log(`🔍 [RAG] Fetched user profile context (${profileContext.length} chars)`);
          }
        } catch (profileError) {
          console.warn(`🔍 [RAG] Failed to fetch profile context:`, profileError.message);
        }

        let caseContext = '';
        try {
          const { fetchCaseDataForFolder, formatCaseDataAsContext } = require('./FileController');
          const caseData = await fetchCaseDataForFolder(userId, folderName);
          if (caseData) {
            caseContext = formatCaseDataAsContext(caseData);
            console.log(`🔍 [RAG] Fetched case data context (${caseContext.length} chars)`);
          }
        } catch (caseError) {
          console.warn(`🔍 [RAG] Failed to fetch case data:`, caseError.message);
        }

        let contextParts = [];
        if (conversationContext) {
          contextParts.push(`=== PREVIOUS CONVERSATION ===\n${conversationContext}`);
        }
        if (profileContext) {
          contextParts.push(`=== USER PROFILE CONTEXT ===\n${profileContext}`);
        }
        if (caseContext) {
          contextParts.push(caseContext);
        }

        const combinedContext = contextParts.join('\n\n');

          if (!combinedContext) {
            console.error(`❌ [RAG] No chunks, conversation history, profile, or case data available`);
            return res.status(404).json({
              error: "No relevant information found for your query.",
              suggestion: "Please provide more context or ask a different question."
            });
          }

        console.log(`🔍 [RAG] Using context-based answer (no chunks): ${combinedContext.length} chars`);

        let contextPrompt = promptText;
        if (combinedContext) {
          if (used_secret_prompt && secretValue) {
            const inputTemplate = secretTemplateData?.inputTemplate || null;
            const outputTemplate = secretTemplateData?.outputTemplate || null;
            const formattedSecretValue = addSecretPromptJsonFormatting(secretValue, inputTemplate, outputTemplate);
            contextPrompt = `${combinedContext}\n\n=== SECRET PROMPT ===\n${formattedSecretValue}`;
          } else {
            contextPrompt = `${combinedContext}\n\n=== USER QUESTION ===\n${promptText}`;
          }
        } else {
          if (used_secret_prompt && secretValue) {
            const inputTemplate = secretTemplateData?.inputTemplate || null;
            const outputTemplate = secretTemplateData?.outputTemplate || null;
            const formattedSecretValue = addSecretPromptJsonFormatting(secretValue, inputTemplate, outputTemplate);
            contextPrompt = formattedSecretValue;
          }
        }

        const provider = finalProvider || 'gemini';
        console.log(`🔍 [RAG] Calling LLM with provider: ${provider} (context-based, no chunks)`);
        const { askLLM, getModelMaxTokens, ALL_LLM_CONFIGS } = require('../services/folderAiService');

        const modelConfig = ALL_LLM_CONFIGS[provider];
        const modelName = modelConfig?.model || 'unknown';
        let maxTokens = null;
        try {
          maxTokens = await getModelMaxTokens(provider, modelName);
          console.log(`🔍 [RAG] Model: ${modelName}, Max tokens: ${maxTokens || 'default'}`);
        } catch (tokenError) {
          console.warn(`🔍 [RAG] Could not fetch token limits: ${tokenError.message}`);
        }

        try {
          const llmQuestion = (used_secret_prompt && secretValue) ? secretValue : question;
          answer = await askLLM(provider, contextPrompt, '', null, llmQuestion, {
            userId: userId,
            endpoint: '/api/doc/folder-chat',
            fileId: null,
            sessionId: sessionId
          });
          
          if (used_secret_prompt && secretTemplateData?.outputTemplate) {
            answer = postProcessSecretPromptResponse(answer, secretTemplateData.outputTemplate);
          } else {
            answer = ensurePlainText(answer);
          }
          
          console.log(`\n${'='.repeat(80)}`);
          console.log(`🔍🔍🔍 ANSWER PROVIDED BY: RAG METHOD (CONTEXT-BASED) 🔍🔍🔍`);
          console.log(`✅ [RAG] Answer length: ${answer.length} chars`);
          console.log(`✅ [RAG] Chunks used: 0 (using conversation history + user context + case data)`);
          console.log(`✅ [RAG] Files searched: ${processedFiles.length}`);
          console.log(`✅ [RAG] Provider: ${provider}`);
          console.log(`${'='.repeat(80)}\n`);

          usedChunkIds = [];

          if (!answer || !answer.trim()) {
            console.error(`❌ [RAG] Empty answer from context-based response`);
            return res.status(500).json({
              error: "Failed to generate response from available context.",
              details: "LLM returned empty response"
            });
          }

        } catch (contextError) {
          console.error(`❌ [RAG] Error in context-based LLM call:`, contextError.message);
          return res.status(500).json({
            error: "Failed to process query with available context.",
            details: contextError.message
          });
        }
        }
      } else {
        const validFolderChunks = allRelevantChunks.filter(chunk => {
          const chunkFile = processedFiles.find(f => f.id === (chunk.file_id || chunk.fileId));
          if (!chunkFile) {
            console.warn(`⚠️ [FOLDER ISOLATION] Chunk ${chunk.chunk_id || chunk.id} has unknown file_id, skipping`);
            return false;
          }
          if (chunkFile.folder_path !== folderName) {
            console.error(`❌ [FOLDER ISOLATION] Chunk ${chunk.chunk_id || chunk.id} from wrong folder!`);
            console.error(`   File: ${chunkFile.originalname}, Expected: "${folderName}", Actual: "${chunkFile.folder_path}"`);
            return false;
          }
          return true;
        });
        
        if (validFolderChunks.length < allRelevantChunks.length) {
          console.warn(`⚠️ [FOLDER ISOLATION] Filtered out ${allRelevantChunks.length - validFolderChunks.length} chunks from wrong folders`);
        }
        
        const topChunks = validFolderChunks
          .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
          .slice(0, 10); // Top 10 chunks

        console.log(`🔍 [RAG] Selected top ${topChunks.length} chunks (similarity range: ${topChunks[topChunks.length - 1]?.similarity || 0} - ${topChunks[0]?.similarity || 0})`);
        console.log(`✅ [FOLDER ISOLATION] All ${topChunks.length} chunks verified to belong to folder "${folderName}"`);

        usedChunkIds = topChunks.map(c => c.chunk_id || c.id);
        usedChunksForCitations = topChunks; // Store chunks for citation extraction
        
        console.log(`\n${'='.repeat(80)}`);
        console.log(`📋 [RAG RESPONSE] CHUNKS WITH CITATIONS (${topChunks.length} chunks):`);
        console.log(`${'='.repeat(80)}`);
        topChunks.forEach((chunk, idx) => {
          const pageInfo = chunk.page_start !== null && chunk.page_start !== undefined
            ? `Page ${chunk.page_start}${chunk.page_end && chunk.page_end !== chunk.page_start ? `-${chunk.page_end}` : ''}`
            : '❌ NO PAGE INFO';
          console.log(`\n📄 Chunk ${idx + 1}/${topChunks.length}:`);
          console.log(`   📁 File: ${chunk.filename || 'N/A'}`);
          console.log(`   📄 ${pageInfo}`);
          console.log(`   📊 Similarity: ${(chunk.similarity || 0).toFixed(4)}`);
          console.log(`   📏 Distance: ${(chunk.distance || 0).toFixed(4)}`);
          console.log(`   🆔 Chunk ID: ${chunk.chunk_id || chunk.id || 'N/A'}`);
          console.log(`   📝 Content Preview: ${(chunk.content || '').substring(0, 120)}${(chunk.content || '').length > 120 ? '...' : ''}`);
          if (chunk.page_start !== null && chunk.page_start !== undefined && chunk.filename) {
            console.log(`   🔗 Citation: ${chunk.filename} - ${pageInfo}`);
          }
        });
        console.log(`${'='.repeat(80)}\n`);
        
        console.log(`🔍 [RAG] Using chunk IDs: ${usedChunkIds.slice(0, 5).join(', ')}${usedChunkIds.length > 5 ? '...' : ''}`);

        const chunkContext = topChunks
          .map((c) => {
            const pageInfo = c.page_start !== null && c.page_start !== undefined
              ? `Page ${c.page_start}${c.page_end && c.page_end !== c.page_start ? `-${c.page_end}` : ''}`
              : 'Page N/A';
            return `📄 [${c.filename} - ${pageInfo}]\n${c.content || ''}`;
          })
          .join('\n\n');

        console.log(`🔍 [RAG] Built context: ${chunkContext.length} chars from ${topChunks.length} chunks`);

        const provider = finalProvider || 'gemini';
        console.log(`🔍 [RAG] Calling LLM with provider: ${provider}`);
        const { askLLM, getModelMaxTokens, ALL_LLM_CONFIGS } = require('../services/folderAiService');

        const modelConfig = ALL_LLM_CONFIGS[provider];
        const modelName = modelConfig?.model || 'unknown';
        let maxTokens = null;
        try {
          maxTokens = await getModelMaxTokens(provider, modelName);
          console.log(`🔍 [RAG] Model: ${modelName}, Max tokens: ${maxTokens || 'default'}`);
        } catch (tokenError) {
          console.warn(`🔍 [RAG] Could not fetch token limits: ${tokenError.message}`);
        }

        let fullPrompt = `${promptText}\n\n=== RELEVANT DOCUMENTS (FOLDER: "${folderName}") ===\n${chunkContext}`;

        if (used_secret_prompt && secretValue) {
          console.log(`🔐 [RAG] Using secret prompt with JSON formatting as base: "${secretName}" (${promptText.length} chars)`);
        }

        console.log(`🔍 [RAG] Final prompt length: ${fullPrompt.length} chars`);

        try {
          const llmQuestion = (used_secret_prompt && secretValue) ? secretValue : question;
          answer = await askLLM(provider, fullPrompt, '', topChunks, llmQuestion, {
            userId: userId,
            endpoint: '/api/doc/folder-chat',
            fileId: null,
            sessionId: sessionId
          });
          
          if (used_secret_prompt && secretTemplateData?.outputTemplate) {
            answer = postProcessSecretPromptResponse(answer, secretTemplateData.outputTemplate);
          } else {
            answer = ensurePlainText(answer);
          }
          
          console.log(`\n${'='.repeat(80)}`);
          console.log(`🔍🔍🔍 ANSWER PROVIDED BY: RAG METHOD 🔍🔍🔍`);
          console.log(`✅ [RAG] Answer length: ${answer.length} chars`);
          console.log(`✅ [RAG] Chunks used: ${topChunks.length}`);
          console.log(`✅ [RAG] Files searched: ${processedFiles.length}`);
          console.log(`✅ [RAG] Provider: ${provider}`);
          console.log(`${'='.repeat(80)}\n`);
        } catch (ragError) {
          console.error(`❌ [RAG] Error calling LLM:`, ragError.message);
          console.error(`❌ [RAG] Error stack:`, ragError.stack);
          throw ragError;
        }
      }
    }

    if (!answer || !answer.trim()) {
      console.error(`❌ [intelligentFolderChat] Empty answer generated`);
      console.error(`❌ [intelligentFolderChat] Method used: ${methodUsed}`);
      return res.status(500).json({
        error: "Failed to generate response.",
        method: methodUsed,
        details: "LLM returned empty response"
      });
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`✅ [FINAL RESULT] Answer generated successfully`);
    console.log(`✅ [FINAL RESULT] Method used: ${methodUsed.toUpperCase()}`);
    console.log(`✅ [FINAL RESULT] Answer length: ${answer.length} chars`);
    console.log(`✅ [FINAL RESULT] Files used: ${usedFileIds.length}`);
    console.log(`✅ [FINAL RESULT] Chunks used: ${usedChunkIds.length} ${methodUsed === 'gemini_eyeball' ? '(full document vision, no chunks)' : ''}`);
    console.log(`${'='.repeat(80)}\n`);

    const protocol = req.protocol || 'http';
    const host = req.get('host') || '';
    const baseUrl = `${protocol}://${host}`;
    
    let citations = [];
    if (methodUsed === 'gemini_eyeball' && processedFiles.length > 0) {
      console.log(`👁️ [Gemini Eyeball] Extracting citations from ${processedFiles.length} files`);
      citations = await extractCitationsFromFiles(processedFiles, baseUrl);
    } else if (methodUsed === 'rag' && usedChunksForCitations.length > 0) {
      citations = await extractCitationsFromChunks(usedChunksForCitations, baseUrl);
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`📑 [RESPONSE CITATIONS] Total citations: ${citations.length}`);
    console.log(`${'='.repeat(80)}`);
    
    if (citations.length > 0) {
      citations.forEach((citation, idx) => {
        console.log(`\n📄 Citation ${idx + 1}:`);
        console.log(`   📁 File: ${citation.filename}`);
        console.log(`   📄 Page: ${citation.pageLabel || `Page ${citation.page}`}`);
        console.log(`   🔗 Link: ${citation.link}`);
        console.log(`   🔗 View URL: ${citation.viewUrl || 'N/A'}`);
        console.log(`   📝 Text Preview: ${citation.text.substring(0, 100)}${citation.text.length > 100 ? '...' : ''}`);
        if (citation.isFullDocument) {
          console.log(`   ✅ Full Document Citation (Gemini Eyeball)`);
        }
      });
      console.log(`💾 [RESPONSE] Citations will be stored in database for permanent access`);
    } else if (methodUsed === 'rag' && usedChunksForCitations.length > 0) {
      console.log(`\n⚠️ [WARNING] ${usedChunksForCitations.length} chunks used but NO citations extracted!`);
      console.log(`   This means chunks are missing page_start/page_end information.`);
      console.log(`\n   Chunks details:`);
      usedChunksForCitations.slice(0, 5).forEach((chunk, idx) => {
        console.log(`   Chunk ${idx + 1}:`);
        console.log(`     - File: ${chunk.filename || 'N/A'}`);
        console.log(`     - File ID: ${chunk.file_id || chunk.fileId || 'N/A'}`);
        console.log(`     - Page Start: ${chunk.page_start !== null && chunk.page_start !== undefined ? chunk.page_start : 'NULL'}`);
        console.log(`     - Page End: ${chunk.page_end !== null && chunk.page_end !== undefined ? chunk.page_end : 'NULL'}`);
        console.log(`     - Content Preview: ${(chunk.content || '').substring(0, 80)}...`);
      });
    } else if (methodUsed === 'gemini_eyeball') {
      if (citations.length > 0) {
        console.log(`   ✅ Gemini Eyeball method used - ${citations.length} file citations created`);
      } else {
        console.log(`   ⚠️  Gemini Eyeball method used - no file citations extracted`);
      }
    }
    
    console.log(`${'='.repeat(80)}\n`);

    console.log(`💾 [intelligentFolderChat] Saving chat to folder_chat table with ${citations.length} citations...`);
    let storedQuestion;
    if (used_secret_prompt) {
      storedQuestion = secretName || question?.trim() || 'Secret Prompt';
      console.log(`💾 [intelligentFolderChat] Secret prompt detected - storing question as: "${storedQuestion}"`);
    } else {
      storedQuestion = question?.trim() || '';
      console.log(`💾 [intelligentFolderChat] Regular query - storing question as: "${storedQuestion}"`);
    }
    const savedChat = await FolderChat.saveFolderChat(
      userId,
      folderName,
      storedQuestion,
      answer,
      finalSessionId,
      usedFileIds,
      usedChunkIds,
      used_secret_prompt, // used_secret_prompt
      secretName || null, // prompt_label (use secret name if secret prompt)
      secret_id, // secret_id
      historyForStorage, // chat_history
      citations // ✅ Store citations in database for permanent access
    );

    console.log(`✅ [intelligentFolderChat] Chat saved to folder_chat: ${savedChat.id} with ${citations.length} citations stored`);

    console.log(`📜 [intelligentFolderChat] Fetching updated chat history...`);
    const updatedHistoryRows = await FolderChat.getFolderChatHistory(userId, folderName, finalSessionId);
    const updatedHistory = updatedHistoryRows.map(row => ({
      id: row.id,
      question: row.question,
      answer: row.answer,
      created_at: row.created_at,
    }));
    console.log(`📜 [intelligentFolderChat] Retrieved ${updatedHistory.length} history entries`);

    console.log(`\n${'='.repeat(80)}`);
    console.log(`📑 [RESPONSE CITATIONS] Total citations: ${citations.length}`);
    console.log(`${'='.repeat(80)}`);
    
    if (citations.length > 0) {
      citations.forEach((citation, idx) => {
        console.log(`\n📄 Citation ${idx + 1}:`);
        console.log(`   📁 File: ${citation.filename}`);
        console.log(`   📄 Page: ${citation.pageLabel || `Page ${citation.page}`}`);
        console.log(`   🔗 Link: ${citation.link}`);
        console.log(`   🔗 View URL: ${citation.viewUrl || 'N/A'}`);
        console.log(`   📝 Text Preview: ${citation.text.substring(0, 100)}${citation.text.length > 100 ? '...' : ''}`);
      });
      console.log(`💾 [RESPONSE] Citations will be stored in database for permanent access`);
    } else if (methodUsed === 'rag' && usedChunksForCitations.length > 0) {
      console.log(`\n⚠️ [WARNING] ${usedChunksForCitations.length} chunks used but NO citations extracted!`);
      console.log(`   This means chunks are missing page_start/page_end information.`);
      console.log(`\n   Chunks details:`);
      usedChunksForCitations.slice(0, 5).forEach((chunk, idx) => {
        console.log(`   Chunk ${idx + 1}:`);
        console.log(`     - File: ${chunk.filename || 'N/A'}`);
        console.log(`     - File ID: ${chunk.file_id || chunk.fileId || 'N/A'}`);
        console.log(`     - Page Start: ${chunk.page_start !== null && chunk.page_start !== undefined ? chunk.page_start : 'NULL'}`);
        console.log(`     - Page End: ${chunk.page_end !== null && chunk.page_end !== undefined ? chunk.page_end : 'NULL'}`);
        console.log(`     - Content Preview: ${(chunk.content || '').substring(0, 80)}...`);
      });
    } else if (methodUsed === 'gemini_eyeball') {
      if (citations.length > 0) {
        console.log(`   ✅ Gemini Eyeball method used - ${citations.length} file citations created`);
      } else {
        console.log(`   ⚠️  Gemini Eyeball method used - no file citations extracted`);
      }
    }
    
    console.log(`${'='.repeat(80)}\n`);

    let chunkDetails = [];
    if (methodUsed === 'gemini_eyeball' && processedFiles.length > 0) {
      const FileChunk = require('../models/FileChunk');
      for (const file of processedFiles) {
        try {
          const chunks = await FileChunk.getChunksByFileId(file.id);
          
          if (!chunks || chunks.length === 0) {
            continue;
          }

          const pageSet = new Set();
          chunks.forEach(chunk => {
            if (chunk.page_start !== null && chunk.page_start !== undefined && chunk.page_start > 0) {
              pageSet.add(chunk.page_start);
            }
            if (chunk.page_end !== null && chunk.page_end !== undefined && chunk.page_end > 0) {
              if (chunk.page_end > chunk.page_start) {
                for (let p = chunk.page_start; p <= chunk.page_end; p++) {
                  pageSet.add(p);
                }
              }
            }
          });

          const allPages = Array.from(pageSet).sort((a, b) => a - b);
          
          if (allPages.length > 0) {
            const minPage = Math.min(...allPages);
            const maxPage = Math.max(...allPages);
            const pageLabel = allPages.length === 1 
              ? `Page ${minPage}` 
              : (minPage === maxPage ? `Page ${minPage}` : `Pages ${minPage}-${maxPage}`);
            
            chunkDetails.push({
              file_id: file.id,
              filename: file.originalname,
              page: minPage,
              page_start: minPage,
              page_end: maxPage,
              page_label: pageLabel,
              all_pages: allPages, // Include all pages array
              content_preview: chunks && chunks.length > 0 
                ? (chunks[0].content || '').substring(0, 200) + ((chunks[0].content || '').length > 200 ? '...' : '')
                : 'Full document analysis',
              is_full_document: false, // Changed to false since we now show specific pages
            });
          } else {
            chunkDetails.push({
              file_id: file.id,
              filename: file.originalname,
              page: 1,
              page_start: 1,
              page_end: null,
              page_label: 'Full Document',
              all_pages: [1],
              content_preview: chunks && chunks.length > 0 
                ? (chunks[0].content || '').substring(0, 200) + ((chunks[0].content || '').length > 200 ? '...' : '')
                : 'Full document analysis',
              is_full_document: true,
            });
          }
        } catch (error) {
          console.error(`Error getting chunks for file ${file.id}:`, error);
        }
      }
    } else if (methodUsed === 'rag' && usedChunksForCitations.length > 0) {
      chunkDetails = usedChunksForCitations.map(chunk => ({
        chunk_id: chunk.chunk_id || chunk.id,
        content_preview: (chunk.content || '').substring(0, 200) + ((chunk.content || '').length > 200 ? '...' : ''),
        page: chunk.page_start,
        page_start: chunk.page_start,
        page_end: chunk.page_end || chunk.page_start,
        page_label: chunk.page_start !== null && chunk.page_start !== undefined
          ? `Page ${chunk.page_start}${chunk.page_end && chunk.page_end !== chunk.page_start ? `-${chunk.page_end}` : ''}`
          : null,
        filename: chunk.filename,
        file_id: chunk.file_id || chunk.fileId,
      }));
    }

    console.log(`✅ [intelligentFolderChat] Request completed successfully`);
    console.log(`✅ [intelligentFolderChat] Response summary:`, {
      sessionId: finalSessionId,
      method: methodUsed,
      answerLength: answer.length,
      filesUsed: usedFileIds.length,
      chunksUsed: usedChunkIds.length,
      citationsCount: citations.length,
      chunkDetailsCount: chunkDetails.length,
      historyEntries: updatedHistory.length
    });

    const plainTextAnswer = ensurePlainText(answer);
    
    return res.json({
      success: true,
      session_id: finalSessionId,
      answer: plainTextAnswer, // ✅ Always send plain text, not JSON
      method: methodUsed,
      routing_decision: routingDecision,
      used_file_ids: usedFileIds,
      used_chunk_ids: usedChunkIds,
      citations: citations, // Array of citation objects with page numbers and links
      chunk_details: chunkDetails, // ✅ Chunk/file details with page numbers for easy reference
      chat_id: savedChat.id,
      chat_history: updatedHistory,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`\n${'='.repeat(80)}`);
    console.error('❌ [intelligentFolderChat] FATAL ERROR');
    console.error('❌ [intelligentFolderChat] Error type:', error.name || 'Unknown');
    console.error('❌ [intelligentFolderChat] Error message:', error.message || 'No message');
    console.error('❌ [intelligentFolderChat] Error stack:', error.stack);

    if (res.headersSent) {
      console.error('❌ [intelligentFolderChat] Response already sent, cannot send error response');
      return;
    }

    return res.status(500).json({
      error: "Failed to process folder chat",
      details: error.message || 'Unknown error occurred',
      error_type: error.name || 'Error',
      timestamp: new Date().toISOString(),
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};


exports.intelligentFolderChatStream = async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    try {
      res.write(`data: [PING]\n\n`);
    } catch (err) {
      clearInterval(heartbeat);
    }
  }, 30000); // 30 seconds instead of 15

  let chunkBuffer = '';
  let chunkBufferTimer = null;
  const CHUNK_BUFFER_DELAY = 50; // ms - batch chunks every 50ms
  const MAX_CHUNK_BUFFER_SIZE = 500; // chars - send if buffer exceeds this

  const flushChunkBuffer = () => {
    if (chunkBuffer && !res.destroyed) {
      try {
        res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunkBuffer })}\n\n`);
        chunkBuffer = '';
        if (chunkBufferTimer) {
          clearTimeout(chunkBufferTimer);
          chunkBufferTimer = null;
        }
      } catch (err) {
        console.error('Error flushing chunk buffer:', err);
      }
    }
  };

  const writeChunk = (text) => {
    if (!text || res.destroyed) return;
    
    chunkBuffer += text;
    
    if (chunkBuffer.length >= MAX_CHUNK_BUFFER_SIZE) {
      flushChunkBuffer();
      return;
    }
    
    if (!chunkBufferTimer) {
      chunkBufferTimer = setTimeout(() => {
        flushChunkBuffer();
      }, CHUNK_BUFFER_DELAY);
    }
  };

  const sendStatus = (status, message = '') => {
    try {
      flushChunkBuffer();
      res.write(`data: ${JSON.stringify({ type: 'status', status, message })}\n\n`);
      if (res.flush) res.flush();
    } catch (err) {
      console.error('Error sending status:', err);
    }
  };

  const sendError = (message, details = '') => {
    try {
      flushChunkBuffer();
      if (chunkBufferTimer) {
        clearTimeout(chunkBufferTimer);
        chunkBufferTimer = null;
      }
      res.write(`data: ${JSON.stringify({ type: 'error', message, details })}\n\n`);
      res.write(`data: [DONE]\n\n`);
      clearInterval(heartbeat);
      res.end();
    } catch (err) {
      console.error('Error sending error:', err);
    }
  };

  try {
    let userId = req.user.id;
    const authorizationHeader = req.headers.authorization;
    const { folderName } = req.params;
    const {
      question,
      session_id = null,
      llm_name = 'gemini',
      secret_id = null,
    } = req.body;

    sendStatus('initializing', 'Starting intelligent folder chat...');

    if (!folderName) {
      sendError('folderName is required');
      return;
    }

    const actualQuestion = question || req.query.question || '';
    const hasSecretId = secret_id && (secret_id !== null && secret_id !== undefined && secret_id !== '');
    
    if (!hasSecretId && (!actualQuestion || !actualQuestion.trim())) {
      sendError('question is required when secret_id is not provided');
      return;
    }

    console.log(`📁 [Streaming] Folder: ${folderName} | Question: "${actualQuestion.substring(0, 100)}..."`);
    console.log(`🔐 [Streaming] Secret ID: ${secret_id || 'none'}`);

    const hasExistingSession = session_id && UUID_REGEX.test(session_id);
    const finalSessionId = hasExistingSession ? session_id : uuidv4();

    sendStatus('analyzing', 'Analyzing query intent...');

    const { usage, plan } = await TokenUsageService.getUserUsageAndPlan(userId, authorizationHeader);

    const isFreeUser = TokenUsageService.isFreePlan(plan);
    if (isFreeUser) {
      console.log(`\n${'🆓'.repeat(40)}`);
      console.log(`[FREE TIER STREAM] User is on free plan - applying restrictions`);
      console.log(`${'🆓'.repeat(40)}\n`);
    }

    const folderQuery = `
      SELECT id, originalname, folder_path
      FROM user_files
      WHERE user_id = $1
        AND is_folder = true
        AND originalname = $2
      ORDER BY created_at DESC
      LIMIT 1;
    `;
    const { rows: folderRows } = await pool.query(folderQuery, [userId, folderName]);
    
    if (folderRows.length === 0) {
      console.error(`❌ [Streaming] [FOLDER ISOLATION] Folder "${folderName}" not found for user`);
      sendError(`Folder "${folderName}" not found.`);
      return;
    }
    
    const folderRow = folderRows[0];
    const actualFolderPath = folderRow.folder_path; // This could be null, empty string, or a path
    
    let filesQuery, queryParams;
    if (!actualFolderPath || actualFolderPath === '') {
      filesQuery = `
        SELECT id, originalname, folder_path, status, gcs_path, mimetype, is_folder
        FROM user_files
        WHERE user_id = $1
          AND is_folder = false
          AND status = 'processed'
          AND (folder_path IS NULL OR folder_path = '')
        ORDER BY created_at DESC;
      `;
      queryParams = [userId];
    } else {
      filesQuery = `
        SELECT id, originalname, folder_path, status, gcs_path, mimetype, is_folder
        FROM user_files
        WHERE user_id = $1
          AND is_folder = false
          AND status = 'processed'
          AND folder_path = $2
        ORDER BY created_at DESC;
      `;
      queryParams = [userId, actualFolderPath];
    }
    
    const { rows: files } = await pool.query(filesQuery, queryParams);
    const processedFiles = files; // Already filtered by query

    console.log(`📂 [Streaming] [FOLDER ISOLATION] Folder "${folderName}" has folder_path: "${actualFolderPath || '(root)'}"`);
    console.log(`📂 [Streaming] [FOLDER ISOLATION] Found ${processedFiles.length} processed files in folder "${folderName}"`);
    if (processedFiles.length > 0) {
      const wrongFolderFiles = processedFiles.filter(f => (f.folder_path || '') !== (actualFolderPath || ''));
      if (wrongFolderFiles.length > 0) {
        console.error(`❌ [Streaming] [FOLDER ISOLATION] CRITICAL ERROR: Found ${wrongFolderFiles.length} files from wrong folder!`);
        console.error(`❌ [Streaming] [FOLDER ISOLATION] Wrong files:`, wrongFolderFiles.map(f => ({
          name: f.originalname,
          expected_folder_path: actualFolderPath || '(root)',
          actual_folder_path: f.folder_path || '(root)'
        })));
      } else {
        console.log(`✅ [Streaming] [FOLDER ISOLATION] All ${processedFiles.length} files verified to belong to folder "${folderName}" (folder_path: "${actualFolderPath || '(root)'}")`);
      }
    }

    if (processedFiles.length === 0) {
      const debugQuery = `
        SELECT DISTINCT folder_path, COUNT(*) as file_count
        FROM user_files
        WHERE user_id = $1 AND is_folder = false
        GROUP BY folder_path
        ORDER BY file_count DESC
        LIMIT 10;
      `;
      const { rows: debugRows } = await pool.query(debugQuery, [userId]);
      console.log(`🔍 [Streaming] [DEBUG] Available folder_path values in database:`, debugRows.map(r => ({
        folder_path: r.folder_path || '(null/empty)',
        file_count: r.file_count
      })));
      console.log(`🔍 [Streaming] [DEBUG] Querying for folder_path: "${actualFolderPath || '(null/empty)'}"`);
      console.log(`⚠️ [Streaming] No processed documents found in folder: "${folderName}" (folder_path: "${actualFolderPath || '(root)'}")`);
      sendError(`No processed documents found in folder "${folderName}". Documents may still be processing.`);
      return;
    }

    let used_secret_prompt = false;
    let secretLlmName = null;
    let secretProvider = null;
    let isSecretGemini = false;
    let finalProvider = null; // Will be set based on secret prompt or DB fetch
    let secretValue = null;
    let secretName = null;
    let secretTemplateData = null; // Store template data for streaming route

    if (hasSecretId) {
      used_secret_prompt = true;
      console.log(`🔐 [Streaming Secret Prompt] Fetching secret configuration for secret_id: ${secret_id}`);

      try {
        const secretDetails = await getSecretDetailsById(secret_id);
        
        if (!secretDetails) {
          console.warn(`🔐 [Streaming Secret Prompt] Secret not found in database`);
          sendError('Secret configuration not found');
          return;
        }

        const {
          name: dbSecretName,
          secret_manager_id,
          version,
          llm_name: dbLlmName,
          chunking_method: dbChunkingMethod,
          input_template_id,
          output_template_id,
        } = secretDetails;

        secretName = dbSecretName;
        secretLlmName = dbLlmName;

        const { resolveProviderName } = require('../services/folderAiService');
        secretProvider = resolveProviderName(secretLlmName || 'gemini');
        isSecretGemini = secretProvider.startsWith('gemini');
        finalProvider = secretProvider;

        console.log(`🔐 [Streaming Secret Prompt] Found secret: ${secretName}`);
        console.log(`🔐 [Streaming Secret Prompt] LLM from secret_manager table: ${secretLlmName || 'none'}`);
        console.log(`🔐 [Streaming Secret Prompt] Resolved provider: ${secretProvider}`);
        console.log(`🔐 [Streaming Secret Prompt] Is Gemini: ${isSecretGemini}`);
        console.log(`🔐 [Streaming Secret Prompt] Chunking method: ${dbChunkingMethod || 'none'}`);

        if (secret_manager_id && version) {
          try {
            const secretClient = new SecretManagerServiceClient();
            const GCLOUD_PROJECT_ID = process.env.GCLOUD_PROJECT_ID;

            if (!GCLOUD_PROJECT_ID) {
              console.error(`🔐 [Streaming Secret Prompt] ❌ GCLOUD_PROJECT_ID not configured`);
              throw new Error('GCLOUD_PROJECT_ID environment variable not set');
            }

            const gcpSecretName = `projects/${GCLOUD_PROJECT_ID}/secrets/${secret_manager_id}/versions/${version}`;
            console.log(`\n${'='.repeat(80)}`);
            console.log(`🔐 [STREAMING SECRET PROMPT] Fetching from GCP Secret Manager`);
            console.log(`${'='.repeat(80)}`);
            console.log(`📋 Secret Metadata:`);
            console.log(`   Database ID: ${secret_id}`);
            console.log(`   Secret Name: ${secretName}`);
            console.log(`   GCP Secret Manager ID: ${secret_manager_id}`);
            console.log(`   Version: ${version}`);
            console.log(`   Full GCP Path: ${gcpSecretName}`);
            console.log(`${'='.repeat(80)}\n`);

            let accessResponse;
            try {
              [accessResponse] = await secretClient.accessSecretVersion({ name: gcpSecretName });
            } catch (gcpError) {
              console.error(`\n${'='.repeat(80)}`);
              console.error(`🔐 [Streaming Secret Prompt] ❌ GCP SECRET MANAGER ACCESS DENIED`);
              console.error(`${'='.repeat(80)}`);
              console.error(`Error: ${gcpError.message}`);
              console.error(`Secret Path: ${gcpSecretName}`);
              console.error(`\n🔧 TO FIX THIS ISSUE:`);
              console.error(`1. Ensure the service account has 'Secret Manager Secret Accessor' role`);
              console.error(`2. Grant permission: roles/secretmanager.secretAccessor`);
              console.error(`3. Verify GCS_KEY_BASE64 contains valid credentials`);
              console.error(`4. Check that the secret exists in GCP Secret Manager`);
              console.error(`5. Verify the service account email has access to the secret`);
              console.error(`${'='.repeat(80)}\n`);
              
              const errorMessage = gcpError.message.includes('PERMISSION_DENIED')
                ? `Permission denied accessing GCP Secret Manager. Please ensure the service account has 'Secret Manager Secret Accessor' role (roles/secretmanager.secretAccessor). Secret: ${secret_manager_id}`
                : `Failed to fetch secret from GCP Secret Manager: ${gcpError.message}`;
              
              sendError(errorMessage, gcpError.message);
              return;
            }

            secretValue = accessResponse.payload.data.toString('utf8');

            if (!secretValue?.trim()) {
              console.error(`\n${'='.repeat(80)}`);
              console.error(`🔐 [Streaming Secret Prompt] ❌ SECRET VALUE IS EMPTY`);
              console.error(`   Secret Name: ${secretName}`);
              console.error(`   GCP Secret ID: ${secret_manager_id}`);
              console.error(`${'='.repeat(80)}\n`);
              sendError('Secret value is empty');
              return;
            } else {
              console.log(`\n${'='.repeat(80)}`);
              console.log(`🔐 [STREAMING SECRET PROMPT] ✅ SECRET VALUE RETRIEVED SUCCESSFULLY`);
              console.log(`${'='.repeat(80)}`);
              console.log(`📊 Secret Details:`);
              console.log(`   Secret Name: "${secretName}"`);
              console.log(`   Length: ${secretValue.length} characters`);
              console.log(`   Preview (first 100 chars):`);
              console.log(`   "${secretValue.substring(0, 100)}${secretValue.length > 100 ? '...' : ''}"`);
              console.log(`${'='.repeat(80)}\n`);
            }

            if (input_template_id || output_template_id) {
              console.log(`\n📄 [Streaming Secret Prompt] Fetching template files:`);
              console.log(`   Input Template ID: ${input_template_id || 'not set'}`);
              console.log(`   Output Template ID: ${output_template_id || 'not set'}\n`);
              
              const templateData = await fetchTemplateFilesData(input_template_id, output_template_id);
              
              if (templateData.hasTemplates) {
                console.log(`✅ [Streaming Secret Prompt] Template files fetched successfully`);
                if (templateData.inputTemplate) {
                  console.log(`   Input: ${templateData.inputTemplate.filename} (${templateData.inputTemplate.extracted_text?.length || 0} chars)`);
                }
                if (templateData.outputTemplate) {
                  console.log(`   Output: ${templateData.outputTemplate.filename} (${templateData.outputTemplate.extracted_text?.length || 0} chars)`);
                }
                
                secretValue = buildEnhancedSystemPromptWithTemplates(secretValue, templateData);
                console.log(`✅ [Streaming Secret Prompt] Enhanced prompt built with template examples (${secretValue.length} chars)\n`);
              } else {
                console.log(`⚠️ [Streaming Secret Prompt] No template files found or available\n`);
              }
              
              secretTemplateData = templateData; // Store for later use in streaming route
            }
          } catch (gcpError) {
            console.error(`\n${'='.repeat(80)}`);
            console.error(`🔐 [Streaming Secret Prompt] ❌ ERROR FETCHING SECRET FROM GCP`);
            console.error(`   Error: ${gcpError.message}`);
            console.error(`   Secret Name: ${secretName}`);
            console.error(`   GCP Secret ID: ${secret_manager_id}`);
            console.error(`${'='.repeat(80)}\n`);
            sendError('Failed to fetch secret from GCP', gcpError.message);
            return;
          }
        } else {
          console.warn(`\n${'='.repeat(80)}`);
          console.warn(`🔐 [Streaming Secret Prompt] ⚠️ MISSING GCP CONFIGURATION`);
          console.warn(`   Secret Name: ${secretName}`);
          console.warn(`   Missing: ${!secret_manager_id ? 'secret_manager_id' : 'version'}`);
          console.warn(`${'='.repeat(80)}\n`);
          sendError('Missing secret configuration (secret_manager_id or version)');
          return;
        }
      } catch (secretError) {
        console.error(`🔐 [Streaming Secret Prompt] Error fetching secret:`, secretError.message);
        sendError('Failed to fetch secret configuration', secretError.message);
        return;
      }
    }

    let routingDecision;

    if (used_secret_prompt && secret_id) {
      routingDecision = {
        method: 'rag',
        reason: 'Secret prompt - always use RAG with specified LLM (policy enforced)',
        confidence: 1.0
      };
      finalProvider = secretProvider; // Use LLM from secret_manager table

      console.log(`\n${'='.repeat(80)}`);
      console.log(`🔐 [STREAMING SECRET PROMPT] ROUTING DECISION`);
      console.log(`${'='.repeat(80)}`);
      console.log(`🔒 SECRET PROMPT POLICY:`);
      console.log(`   ✅ Always use RAG method (no Gemini Eyeball)`);
      console.log(`   ✅ Use ONLY the LLM specified in secret configuration`);
      console.log(`\nSecret Configuration:`);
      console.log(`   - Secret Name: "${secretName}"`);
      console.log(`   - LLM from Secret: ${secretLlmName || 'not set'}`);
      console.log(`   - Resolved Provider: ${secretProvider}`);
      console.log(`   - Method: RAG (enforced)`);
      console.log(`${'='.repeat(80)}\n`);
    } else {
      routingDecision = analyzeQueryForRouting(actualQuestion);

      if (isFreeUser) {
        if (routingDecision.method === 'gemini_eyeball') {
          const eyeballLimitCheck = await TokenUsageService.checkFreeTierEyeballLimit(userId, plan);
          if (!eyeballLimitCheck.allowed) {
            console.log(`\n${'🆓'.repeat(40)}`);
            console.log(`[FREE TIER STREAM] Gemini Eyeball limit reached - forcing RAG`);
            console.log(`[FREE TIER STREAM] ${eyeballLimitCheck.message}`);
            console.log(`${'🆓'.repeat(40)}\n`);
            sendStatus('info', eyeballLimitCheck.message);
            
            routingDecision = {
              method: 'rag',
              reason: 'Free tier: Gemini Eyeball limit reached (1/day), using RAG retrieval instead',
              confidence: 1.0
            };
          } else {
            console.log(`\n${'🆓'.repeat(40)}`);
            console.log(`[FREE TIER STREAM] Gemini Eyeball allowed: ${eyeballLimitCheck.message}`);
            console.log(`${'🆓'.repeat(40)}\n`);
          }
        } else if (routingDecision.method === 'rag') {
          console.log(`\n${'🆓'.repeat(40)}`);
          console.log(`[FREE TIER STREAM] Using RAG retrieval (subsequent chat after first Eyeball use)`);
          console.log(`${'🆓'.repeat(40)}\n`);
        }
      }

      if (routingDecision.method === 'rag') {
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
          console.log(`🤖 [STREAMING RAG] Using LLM from custom_query table: ${dbLlmName}`);
        } else {
          console.warn(`⚠️ [STREAMING RAG] No LLM found in custom_query table — falling back to gemini`);
          dbLlmName = 'gemini';
        }

        const { resolveProviderName, getAvailableProviders } = require('../services/folderAiService');
        finalProvider = resolveProviderName(dbLlmName || 'gemini');
        console.log(`🤖 [STREAMING RAG] Resolved LLM provider for custom query: ${finalProvider}`);

        const availableProviders = getAvailableProviders();
        if (!availableProviders[finalProvider] || !availableProviders[finalProvider].available) {
          console.warn(`⚠️ [STREAMING RAG] Provider '${finalProvider}' unavailable — falling back to gemini`);
          finalProvider = 'gemini';
        }
      } else {
        finalProvider = 'gemini';
        console.log(`👁️ [STREAMING Gemini Eyeball] Using Gemini (Eyeball is Gemini-specific)`);
      }

      console.log(`\n${'='.repeat(80)}`);
      console.log(`🧠 [STREAMING ROUTING DECISION] Query: "${actualQuestion.substring(0, 100)}${actualQuestion.length > 100 ? '...' : ''}"`);
      console.log(`🧠 [STREAMING ROUTING DECISION] Method: ${routingDecision.method.toUpperCase()}`);
      console.log(`🧠 [STREAMING ROUTING DECISION] Reason: ${routingDecision.reason}`);
      console.log(`🧠 [STREAMING ROUTING DECISION] Confidence: ${routingDecision.confidence}`);
      console.log(`🧠 [STREAMING ROUTING DECISION] Provider: ${finalProvider}`);
      if (routingDecision.method === 'gemini_eyeball') {
        console.log(`👁️ [STREAMING ROUTING] Using GEMINI EYEBALL - Complete document vision (ChatModel)`);
      } else {
        console.log(`🔍 [STREAMING ROUTING] Using RAG - Targeted semantic search with chunks`);
      }
      console.log(`${'='.repeat(80)}\n`);
    }

    sendStatus('routing', `Using ${routingDecision.method.toUpperCase()} method: ${routingDecision.reason}`);

    if (isFreeUser) {
      const estimatedTokens = Math.ceil((actualQuestion?.length || 0) / 4) + 1000; // Add buffer for response
      const tokenLimitCheck = await TokenUsageService.checkFreeTierDailyTokenLimit(userId, plan, estimatedTokens);
      if (!tokenLimitCheck.allowed) {
        sendError(tokenLimitCheck.message);
        return;
      }
      sendStatus('info', `Free tier: ${tokenLimitCheck.remaining.toLocaleString()} tokens remaining today`);
    }

    let previousChats = [];
    if (hasExistingSession) {
      previousChats = await FolderChat.getFolderChatHistory(userId, folderName, finalSessionId);
    }
    const conversationContext = formatConversationHistory(previousChats);
    const historyForStorage = simplifyHistory(previousChats);

    let fullAnswer = '';
    let usedChunkIds = [];
    let usedFileIds = processedFiles.map(f => f.id);
    let methodUsed = routingDecision.method;
    let usedChunksForCitations = []; // Store chunks used for citation extraction

    sendStatus('generating', 'Generating response...');
    res.write(`data: ${JSON.stringify({ type: 'metadata', session_id: finalSessionId, method: methodUsed })}\n\n`);

    if (routingDecision.method === 'gemini_eyeball') {
      console.log(`👁️ [STREAMING Gemini Eyeball] Processing ${processedFiles.length} files...`);

      const bucketName = process.env.GCS_BUCKET_NAME;
      if (!bucketName) {
        throw new Error('GCS_BUCKET_NAME not configured');
      }

      const documents = processedFiles.map(file => ({
        gcsUri: `gs://${bucketName}/${file.gcs_path}`,
        filename: file.originalname,
        mimeType: file.mimetype
      }));

      let basePrompt;
      if (used_secret_prompt && secretValue) {
        const inputTemplate = secretTemplateData?.inputTemplate || null;
        const outputTemplate = secretTemplateData?.outputTemplate || null;
        basePrompt = addSecretPromptJsonFormatting(secretValue, inputTemplate, outputTemplate);
      } else {
        basePrompt = actualQuestion;
      }
      
      let promptText = basePrompt;
      if (conversationContext) {
        promptText = `Previous Conversation:\n${conversationContext}\n\n---\n\n${promptText}`;
      }

      if (used_secret_prompt && secretValue) {
      }

      
      try {
        const forcedModel = isFreeUser ? TokenUsageService.getFreeTierForcedModel() : null;
        for await (const chunk of streamGeminiWithMultipleGCS(promptText, documents, '', forcedModel)) {
          if (typeof chunk === 'string' && chunk.trim()) {
            fullAnswer += chunk;
            writeChunk(chunk); // Use buffered write instead of immediate
          } else if (typeof chunk === 'object' && chunk.type) {
            if (chunk.type === 'thinking' && chunk.text) {
              flushChunkBuffer(); // Flush any pending content chunks first
              res.write(`data: ${JSON.stringify({ type: 'thinking', text: chunk.text })}\n\n`);
              if (res.flush) res.flush();
            } else if (chunk.type === 'content' && chunk.text) {
              fullAnswer += chunk.text;
              writeChunk(chunk.text); // Use buffered write instead of immediate
            }
          }
        }
        flushChunkBuffer();
      } catch (streamError) {
        console.error(`\n${'='.repeat(80)}`);
        console.error(`❌ [STREAMING Gemini Eyeball] Error during streaming:`);
        console.error(`   Error Type: ${streamError.name || 'Unknown'}`);
        console.error(`   Error Message: ${streamError.message || 'No message'}`);
        console.error(`   Prompt Length: ${promptText.length} chars`);
        console.error(`   Documents: ${documents.length}`);
        console.error(`   Stack: ${streamError.stack}`);
        console.error(`${'='.repeat(80)}\n`);
        
        if (streamError.message && streamError.message.includes('fetch failed')) {
          sendError('Network error: Failed to connect to Gemini service. Please check your internet connection and GCP credentials.', streamError.message);
          return;
        }
        
        throw streamError;
      }

      console.log(`✅ [STREAMING Gemini Eyeball] Complete: ${fullAnswer.length} chars, ${documents.length} documents`);

      if (used_secret_prompt) {
        let streamingTemplateData = null;
        try {
          const secretDetails = await getSecretDetailsById(secret_id);
          if (secretDetails && (secretDetails.input_template_id || secretDetails.output_template_id)) {
            streamingTemplateData = await fetchTemplateFilesData(secretDetails.input_template_id, secretDetails.output_template_id);
          }
        } catch (e) {
          console.warn('[STREAMING Gemini Eyeball] Could not fetch template data for post-processing:', e);
        }
        
        if (streamingTemplateData?.outputTemplate) {
          fullAnswer = postProcessSecretPromptResponse(fullAnswer, streamingTemplateData.outputTemplate);
        } else {
          fullAnswer = postProcessSecretPromptResponse(fullAnswer, null);
        }
      } else {
        fullAnswer = ensurePlainText(fullAnswer);
      }

      usedChunkIds = [];

    } else {
      console.log(`🔍 [STREAMING RAG] Using RAG method for targeted query...`);
      console.log(`🔍 [STREAMING RAG] Processing ${processedFiles.length} files`);

      const embeddingSource = (used_secret_prompt && secretValue) ? secretValue : actualQuestion;
      const questionEmbedding = await generateEmbedding(embeddingSource);
      const allRelevantChunks = [];

      for (let i = 0; i < processedFiles.length; i++) {
        const file = processedFiles[i];
        
        const fileFolderPath = file.folder_path || '';
        if (fileFolderPath !== (actualFolderPath || '')) {
          console.error(`❌ [STREAMING] [FOLDER ISOLATION] SKIPPING FILE: "${file.originalname}" - Wrong folder!`);
          console.error(`   Expected folder_path: "${actualFolderPath || '(root)'}"`);
          console.error(`   Actual folder_path: "${fileFolderPath || '(root)'}"`);
          continue; // Skip files from wrong folder
        }
        
        if (i === 0 || i === processedFiles.length - 1) {
          console.log(`🔍 [STREAMING RAG] Searching file ${i + 1}/${processedFiles.length}: ${file.originalname}`);
        }
        
        const debugChunks = await FileChunk.getChunksByFileId(file.id);
        console.log(`   📋 Chunks in database: ${debugChunks.length}`);
        
        if (debugChunks.length === 0) {
          console.log(`   ⚠️ No chunks found in database for this file - skipping vector search`);
          continue;
        }
        
        const chunkIds = debugChunks.map(c => c.id);
        const debugVectors = await ChunkVector.getVectorsByChunkIds(chunkIds);
        console.log(`   🔗 Embeddings in database: ${debugVectors.length} for ${chunkIds.length} chunks`);
        
        if (debugVectors.length === 0) {
          console.log(`   ⚠️ WARNING: Chunks exist but no embeddings found!`);
          console.log(`   💡 Using chunks directly as fallback.`);
          const fallbackChunks = debugChunks.map(c => ({
            ...preservePageInfo(c), // Ensure page_start/page_end are preserved
            filename: file.originalname,
            file_id: file.id,
            similarity: 0.5,
            distance: 1.0,
            chunk_id: c.id,
            content: c.content
          }));
          allRelevantChunks.push(...fallbackChunks);
          console.log(`   ✅ Added ${fallbackChunks.length} chunks as fallback (no embeddings available)`);
          continue;
        }
        
        const fileIdStr = String(file.id).trim();
        const isValidUUID = UUID_REGEX.test(fileIdStr);
        
        if (!isValidUUID) {
          console.error(`   ❌ Invalid file ID format: ${file.id} (expected UUID)`);
          const fallbackChunks = debugChunks.map(c => ({
            ...preservePageInfo(c), // Ensure page_start/page_end are preserved
            filename: file.originalname,
            file_id: file.id,
            similarity: 0.5,
            distance: 1.0,
            chunk_id: c.id,
            content: c.content
          }));
          allRelevantChunks.push(...fallbackChunks);
          console.log(`   ✅ Added ${fallbackChunks.length} chunks as fallback (invalid file ID format)`);
          continue;
        }
        
        console.log(`   🔎 Performing vector search with embedding...`);
        const relevant = await ChunkVector.findNearestChunks(
          questionEmbedding,
          5, // Get top 5 chunks per file
          [fileIdStr] // Pass as array of UUIDs
        );

        console.log(`   📊 Vector search found: ${relevant.length} relevant chunks`);

        if (relevant.length > 0) {
          const chunksWithSimilarity = relevant.map((r) => {
            const distance = parseFloat(r.distance) || 2.0;
            const similarity = r.similarity || (1 / (1 + distance));
            return {
              ...preservePageInfo(r), // Ensure page_start/page_end are preserved
              filename: file.originalname,
              file_id: file.id,
              similarity: similarity,
              distance: distance,
              chunk_id: r.chunk_id || r.id
            };
          });
          allRelevantChunks.push(...chunksWithSimilarity);
          console.log(`   ✅ Added ${chunksWithSimilarity.length} chunks (similarity range: ${Math.min(...chunksWithSimilarity.map(c => c.similarity)).toFixed(3)} - ${Math.max(...chunksWithSimilarity.map(c => c.similarity)).toFixed(3)})`);
        } else {
          console.log(`   ⚠️ Vector search returned 0 results, but ${debugChunks.length} chunks exist`);
          console.log(`   💡 Using all chunks as fallback since embeddings exist but don't match query`);
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
          console.log(`   ✅ Added ${fallbackChunks.length} chunks as fallback (vector search had no matches)`);
        }
      }

      console.log(`\n🔍 [STREAMING RAG] Total relevant chunks found: ${allRelevantChunks.length}`);

      if (allRelevantChunks.length === 0) {
        console.warn(`\n⚠️ [STREAMING RAG] No chunks found via vector search - trying fallback...`);
        console.warn(`   - Files searched: ${processedFiles.length}`);
        
        const processingFiles = processedFiles.filter(f => f.status !== 'processed');
        if (processingFiles.length > 0) {
          console.warn(`   - ⚠️ ${processingFiles.length} file(s) still processing: ${processingFiles.map(f => f.originalname).join(', ')}`);
          sendError("Document is still being processed. Please wait for processing to complete before asking questions.");
          return;
        }
        
        console.log(`   - Attempting fallback: Using all chunks from processed files...`);
        const fallbackChunks = [];
        for (const file of processedFiles) {
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
          console.log(`   ✅ Fallback successful: Using ${fallbackChunks.length} chunks from ${processedFiles.length} file(s)`);
          allRelevantChunks.push(...fallbackChunks);
        } else {
          console.error(`\n❌ [STREAMING RAG] No chunks found even with fallback!`);
          console.error(`   - Files searched: ${processedFiles.length}`);
          console.error(`   - Files status: ${processedFiles.map(f => `${f.originalname}: ${f.status}`).join(', ')}`);
          sendError('No relevant information found for your query', 'Please ensure documents are processed and contain relevant content.');
          return;
        }
      }

      const validFolderChunks = allRelevantChunks.filter(chunk => {
        const chunkFile = processedFiles.find(f => f.id === (chunk.file_id || chunk.fileId));
        if (!chunkFile) {
          console.warn(`⚠️ [STREAMING] [FOLDER ISOLATION] Chunk ${chunk.chunk_id || chunk.id} has unknown file_id, skipping`);
          return false;
        }
        const chunkFileFolderPath = chunkFile.folder_path || '';
        if (chunkFileFolderPath !== (actualFolderPath || '')) {
          console.error(`❌ [STREAMING] [FOLDER ISOLATION] Chunk ${chunk.chunk_id || chunk.id} from wrong folder!`);
          console.error(`   File: ${chunkFile.originalname}, Expected folder_path: "${actualFolderPath || '(root)'}", Actual: "${chunkFileFolderPath || '(root)'}"`);
          return false;
        }
        return true;
      });
      
      if (validFolderChunks.length < allRelevantChunks.length) {
        console.warn(`⚠️ [STREAMING] [FOLDER ISOLATION] Filtered out ${allRelevantChunks.length - validFolderChunks.length} chunks from wrong folders`);
      }
      
      const topChunks = validFolderChunks
        .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
        .slice(0, 10);

      console.log(`✅ [STREAMING] [FOLDER ISOLATION] All ${topChunks.length} chunks verified to belong to folder "${folderName}"`);

      usedChunkIds = topChunks.map(c => c.chunk_id || c.id);
      usedChunksForCitations = topChunks; // Store chunks for citation extraction
      
      console.log(`\n${'='.repeat(80)}`);
      console.log(`📋 [STREAMING RAG RESPONSE] CHUNKS WITH CITATIONS (${topChunks.length} chunks):`);
      console.log(`${'='.repeat(80)}`);
      topChunks.forEach((chunk, idx) => {
        const pageInfo = chunk.page_start !== null && chunk.page_start !== undefined
          ? `Page ${chunk.page_start}${chunk.page_end && chunk.page_end !== chunk.page_start ? `-${chunk.page_end}` : ''}`
          : '❌ NO PAGE INFO';
        console.log(`\n📄 Chunk ${idx + 1}/${topChunks.length}:`);
        console.log(`   📁 File: ${chunk.filename || 'N/A'}`);
        console.log(`   📄 ${pageInfo}`);
        console.log(`   📊 Similarity: ${(chunk.similarity || 0).toFixed(4)}`);
        console.log(`   📏 Distance: ${(chunk.distance || 0).toFixed(4)}`);
        console.log(`   🆔 Chunk ID: ${chunk.chunk_id || chunk.id || 'N/A'}`);
        console.log(`   📝 Content Preview: ${(chunk.content || '').substring(0, 120)}${(chunk.content || '').length > 120 ? '...' : ''}`);
        if (chunk.page_start !== null && chunk.page_start !== undefined && chunk.filename) {
          console.log(`   🔗 Citation: ${chunk.filename} - ${pageInfo}`);
        }
      });
      console.log(`${'='.repeat(80)}\n`);
      
      console.log(`🔍 [STREAMING RAG] Selected top ${topChunks.length} chunks`);

      const chunkContext = topChunks
        .map((c) => {
          const pageInfo = c.page_start !== null && c.page_start !== undefined
            ? `Page ${c.page_start}${c.page_end && c.page_end !== c.page_start ? `-${c.page_end}` : ''}`
            : 'Page N/A';
          return `📄 [${c.filename} - ${pageInfo}]\n${c.content || ''}`;
        })
        .join('\n\n');

      let basePrompt;
      if (used_secret_prompt && secretValue) {
        const inputTemplate = secretTemplateData?.inputTemplate || null;
        const outputTemplate = secretTemplateData?.outputTemplate || null;
        basePrompt = addSecretPromptJsonFormatting(secretValue, inputTemplate, outputTemplate);
      } else {
        basePrompt = actualQuestion;
      }
      
      let promptText = basePrompt;
      if (conversationContext) {
        promptText = `Previous Conversation:\n${conversationContext}\n\n---\n\n${promptText}`;
      }

      let fullPrompt = `${promptText}\n\n=== RELEVANT DOCUMENTS (FOLDER: "${folderName}") ===\n${chunkContext}`;

      if (used_secret_prompt && secretValue) {
        console.log(`🔐 [Streaming RAG] Using secret prompt with JSON formatting as base: "${secretName}" (${promptText.length} chars)`);
      }

      const provider = finalProvider || 'gemini';
      console.log(`🔍 [STREAMING RAG] Using provider: ${provider}`);
      const { streamLLM: streamLLMFunc, getModelMaxTokens, ALL_LLM_CONFIGS } = require('../services/folderAiService');

      const modelConfig = ALL_LLM_CONFIGS[provider];
      const modelName = modelConfig?.model || 'unknown';
      let maxTokens = null;
      try {
        maxTokens = await getModelMaxTokens(provider, modelName);
      } catch (tokenError) {
      }

      
      try {
        const llmQuestion = (used_secret_prompt && secretValue) ? secretValue : actualQuestion;
        for await (const chunk of streamLLMFunc(provider, fullPrompt, '', topChunks, llmQuestion)) {
          if (typeof chunk === 'string' && chunk.trim()) {
            fullAnswer += chunk;
            writeChunk(chunk); // Use buffered write instead of immediate
          } else if (typeof chunk === 'object' && chunk.type) {
            if (chunk.type === 'thinking' && chunk.text) {
              flushChunkBuffer(); // Flush any pending content chunks first
              res.write(`data: ${JSON.stringify({ type: 'thinking', text: chunk.text })}\n\n`);
              if (res.flush) res.flush();
            } else if (chunk.type === 'content' && chunk.text) {
              fullAnswer += chunk.text;
              writeChunk(chunk.text); // Use buffered write instead of immediate
            }
          }
        }
        flushChunkBuffer();
      } catch (streamError) {
        console.error(`\n${'='.repeat(80)}`);
        console.error(`❌ [STREAMING RAG] Error during streaming:`);
        console.error(`   Error Type: ${streamError.name || 'Unknown'}`);
        console.error(`   Error Message: ${streamError.message || 'No message'}`);
        console.error(`   Provider: ${provider}`);
        console.error(`   Prompt Length: ${fullPrompt.length} chars`);
        console.error(`   Stack: ${streamError.stack}`);
        console.error(`${'='.repeat(80)}\n`);
        
        if (streamError.message && streamError.message.includes('fetch failed')) {
          sendError('Network error: Failed to connect to LLM service. Please check your internet connection and API credentials.', streamError.message);
          return;
        }
        
        throw streamError;
      }

      console.log(`✅ [STREAMING RAG] Complete: ${fullAnswer.length} chars, ${topChunks.length} chunks, ${processedFiles.length} files, ${provider}`);

      if (used_secret_prompt) {
        let streamingTemplateData = null;
        try {
          const secretDetails = await getSecretDetailsById(secret_id);
          if (secretDetails && (secretDetails.input_template_id || secretDetails.output_template_id)) {
            streamingTemplateData = await fetchTemplateFilesData(secretDetails.input_template_id, secretDetails.output_template_id);
          }
        } catch (e) {
          console.warn('[STREAMING RAG] Could not fetch template data for post-processing:', e);
        }
        
        if (streamingTemplateData?.outputTemplate) {
          fullAnswer = postProcessSecretPromptResponse(fullAnswer, streamingTemplateData.outputTemplate);
        } else {
          fullAnswer = postProcessSecretPromptResponse(fullAnswer, null);
        }
      } else {
        fullAnswer = ensurePlainText(fullAnswer);
      }
    }

    const protocol = req.protocol || req.headers['x-forwarded-proto'] || 'http';
    const host = req.get('host') || req.headers.host || '';
    const baseUrl = `${protocol}://${host}`;
    
    let citations = [];
    if (methodUsed === 'gemini_eyeball' && processedFiles.length > 0) {
      console.log(`👁️ [STREAMING Gemini Eyeball] Extracting citations from ${processedFiles.length} files`);
      citations = await extractCitationsFromFiles(processedFiles, baseUrl);
    } else if (methodUsed === 'rag' && usedChunksForCitations.length > 0) {
      citations = await extractCitationsFromChunks(usedChunksForCitations, baseUrl);
    }

    if (citations.length > 0) {
      console.log(`📑 [STREAMING] ${citations.length} citations extracted (${methodUsed})`);
    } else if (methodUsed === 'rag' && usedChunksForCitations.length > 0) {
      console.warn(`⚠️ [STREAMING] ${usedChunksForCitations.length} chunks used but NO citations extracted!`);
    }
    
    console.log(`${'='.repeat(80)}\n`);

    let storedQuestion;
    if (used_secret_prompt) {
      storedQuestion = secretName || actualQuestion?.trim() || 'Secret Prompt';
      console.log(`💾 [Streaming] Secret prompt detected - storing question as: "${storedQuestion}"`);
    } else {
      storedQuestion = actualQuestion?.trim() || '';
      console.log(`💾 [Streaming] Regular query - storing question as: "${storedQuestion}"`);
    }
    const savedChat = await FolderChat.saveFolderChat(
      userId,
      folderName,
      storedQuestion,
      fullAnswer,
      finalSessionId,
      usedFileIds,
      usedChunkIds,
      used_secret_prompt,
      secretName || null, // prompt_label (use secret name if secret prompt)
      secret_id,
      historyForStorage,
      citations // ✅ Store citations in database for permanent access
    );

    let chunkDetails = [];
    if (methodUsed === 'gemini_eyeball' && processedFiles.length > 0) {
      const FileChunk = require('../models/FileChunk');
      for (const file of processedFiles) {
        try {
          const chunks = await FileChunk.getChunksByFileId(file.id);
          
          if (!chunks || chunks.length === 0) {
            continue;
          }

          const pageSet = new Set();
          chunks.forEach(chunk => {
            if (chunk.page_start !== null && chunk.page_start !== undefined && chunk.page_start > 0) {
              pageSet.add(chunk.page_start);
            }
            if (chunk.page_end !== null && chunk.page_end !== undefined && chunk.page_end > 0) {
              if (chunk.page_end > chunk.page_start) {
                for (let p = chunk.page_start; p <= chunk.page_end; p++) {
                  pageSet.add(p);
                }
              }
            }
          });

          const allPages = Array.from(pageSet).sort((a, b) => a - b);
          
          if (allPages.length > 0) {
            const minPage = Math.min(...allPages);
            const maxPage = Math.max(...allPages);
            const pageLabel = allPages.length === 1 
              ? `Page ${minPage}` 
              : (minPage === maxPage ? `Page ${minPage}` : `Pages ${minPage}-${maxPage}`);
            
            chunkDetails.push({
              file_id: file.id,
              filename: file.originalname,
              page: minPage,
              page_start: minPage,
              page_end: maxPage,
              page_label: pageLabel,
              all_pages: allPages, // Include all pages array
              content_preview: chunks && chunks.length > 0 
                ? (chunks[0].content || '').substring(0, 200) + ((chunks[0].content || '').length > 200 ? '...' : '')
                : 'Full document analysis',
              is_full_document: false, // Changed to false since we now show specific pages
            });
          } else {
            chunkDetails.push({
              file_id: file.id,
              filename: file.originalname,
              page: 1,
              page_start: 1,
              page_end: null,
              page_label: 'Full Document',
              all_pages: [1],
              content_preview: chunks && chunks.length > 0 
                ? (chunks[0].content || '').substring(0, 200) + ((chunks[0].content || '').length > 200 ? '...' : '')
                : 'Full document analysis',
              is_full_document: true,
            });
          }
        } catch (error) {
          console.error(`Error getting chunks for file ${file.id}:`, error);
        }
      }
    } else if (methodUsed === 'rag' && usedChunksForCitations.length > 0) {
      chunkDetails = usedChunksForCitations.map(chunk => ({
        chunk_id: chunk.chunk_id || chunk.id,
        content_preview: (chunk.content || '').substring(0, 200) + ((chunk.content || '').length > 200 ? '...' : ''),
        page: chunk.page_start,
        page_start: chunk.page_start,
        page_end: chunk.page_end || chunk.page_start,
        page_label: chunk.page_start !== null && chunk.page_start !== undefined
          ? `Page ${chunk.page_start}${chunk.page_end && chunk.page_end !== chunk.page_start ? `-${chunk.page_end}` : ''}`
          : null,
        filename: chunk.filename,
        file_id: chunk.file_id || chunk.fileId,
      }));
    }

    flushChunkBuffer();
    if (chunkBufferTimer) {
      clearTimeout(chunkBufferTimer);
      chunkBufferTimer = null;
    }

    res.write(`data: ${JSON.stringify({
      type: 'done',
      session_id: finalSessionId,
      chat_id: savedChat.id,
      method: methodUsed,
      answer_length: fullAnswer.length,
      citations: citations, // Array of citation objects with page numbers and links
      chunk_details: chunkDetails // ✅ Chunk details with page numbers for easy reference
    })}\n\n`);

    res.write(`data: [DONE]\n\n`);
    clearInterval(heartbeat);
    res.end();

  } catch (error) {
    console.error('❌ Streaming error:', error);
    sendError('Failed to process streaming chat', error.message);
  }
};

