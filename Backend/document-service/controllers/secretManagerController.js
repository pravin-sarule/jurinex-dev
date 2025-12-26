const db = require('../config/db');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { askLLM, getAvailableProviders, resolveProviderName } = require('../services/aiService');
const { askLLM: askFolderLLM } = require('../services/folderAiService'); // Import askLLM from folderAiService
const { v4: uuidv4 } = require('uuid');
const File = require('../models/File'); // Import File model
const FolderChat = require('../models/FolderChat'); // Import FolderChat model

const MAX_STORED_HISTORY = 20;

function simplifyFolderChatHistory(chats = []) {
  if (!Array.isArray(chats)) return [];
  return chats
    .map((chat) => ({
      id: chat.id,
      question: chat.question,
      answer: chat.answer,
      created_at: chat.created_at,
    }))
    .filter((entry) => typeof entry.question === 'string' && typeof entry.answer === 'string')
    .slice(-MAX_STORED_HISTORY);
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

function validateAndEnhanceJsonStructure(jsonData, outputTemplate = null) {
  if (!jsonData || typeof jsonData !== 'object') {
    return jsonData;
  }

  // First, try to use the output template JSON structure as the base
  if (outputTemplate && outputTemplate.extracted_text) {
    try {
      // Helper function to safely parse JSON from text
      const safeParseJson = (text) => {
        if (!text || typeof text !== 'string') return null;
        
        // Try direct JSON parse
        try {
          return JSON.parse(text);
        } catch (e) {
          // Try extracting JSON from markdown code blocks
          const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/i) || 
                           text.match(/```\s*([\s\S]*?)\s*```/i);
          if (jsonMatch) {
            try {
              return JSON.parse(jsonMatch[1].trim());
            } catch (e2) {
              // Ignore
            }
          }
          
          // Try if it starts with { or [
          if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
            try {
              return JSON.parse(text.trim());
            } catch (e3) {
              // Ignore
            }
          }
        }
        return null;
      };
      
      const templateJson = typeof outputTemplate.extracted_text === 'string'
        ? safeParseJson(outputTemplate.extracted_text)
        : outputTemplate.extracted_text;
      
      // If extracted_text is not JSON, try using structured_schema
      if (!templateJson && outputTemplate.structured_schema) {
        try {
          const schema = typeof outputTemplate.structured_schema === 'string'
            ? JSON.parse(outputTemplate.structured_schema)
            : outputTemplate.structured_schema;
          
          // Build template structure from schema
          if (schema && schema.properties) {
            const builtTemplate = {};
            if (schema.properties.generated_sections && schema.properties.generated_sections.properties) {
              builtTemplate.generated_sections = {};
              const sectionKeys = Object.keys(schema.properties.generated_sections.properties);
              sectionKeys.forEach(key => {
                builtTemplate.generated_sections[key] = {
                  generated_text: '',
                  required_summary_type: schema.properties.generated_sections.properties[key]?.properties?.required_summary_type?.default || 'Extractive'
                };
              });
            }
            // Use the built template structure
            const mergedData = JSON.parse(JSON.stringify(builtTemplate)); // Deep clone template
            const mergeDataIntoTemplate = (template, data) => {
              for (const key in template) {
                if (data && data.hasOwnProperty(key)) {
                  if (typeof template[key] === 'object' && template[key] !== null && !Array.isArray(template[key])) {
                    if (typeof data[key] === 'object' && data[key] !== null && !Array.isArray(data[key])) {
                      mergeDataIntoTemplate(template[key], data[key]);
                    } else {
                      template[key] = data[key];
                    }
                  } else {
                    template[key] = data[key];
                  }
                }
              }
            };
            mergeDataIntoTemplate(mergedData, jsonData);
            console.log('[validateAndEnhanceJsonStructure] ✅ Merged response into template structure built from schema');
            return mergedData;
          }
        } catch (schemaError) {
          console.warn('[validateAndEnhanceJsonStructure] Could not build template from structured_schema:', schemaError);
        }
      }
      
      if (templateJson && typeof templateJson === 'object') {
        // If templateJson is a JSON schema (has properties), extract example structure
        if (templateJson.properties) {
          // It's a JSON schema - we need to build an example structure from it
          const buildExampleFromSchema = (schema) => {
            if (!schema.properties) return {};
            
            const example = {};
            for (const key in schema.properties) {
              const prop = schema.properties[key];
              if (prop.type === 'object' && prop.properties) {
                example[key] = buildExampleFromSchema(prop);
              } else if (prop.type === 'array' && prop.items) {
                example[key] = prop.items.properties ? [buildExampleFromSchema(prop.items)] : [];
              } else {
                // Use default value if available, otherwise use empty string or null
                example[key] = prop.default !== undefined ? prop.default : (prop.type === 'string' ? '' : null);
              }
            }
            return example;
          };
          
          templateJson = buildExampleFromSchema(templateJson);
          console.log('[validateAndEnhanceJsonStructure] ✅ Built example structure from JSON schema');
        }
        
        // Merge response data into template structure
        const mergedData = JSON.parse(JSON.stringify(templateJson)); // Deep clone template
        
        // Recursively merge response data into template structure
        const mergeDataIntoTemplate = (template, data) => {
          for (const key in template) {
            if (data && data.hasOwnProperty(key)) {
              if (typeof template[key] === 'object' && template[key] !== null && !Array.isArray(template[key])) {
                if (typeof data[key] === 'object' && data[key] !== null && !Array.isArray(data[key])) {
                  mergeDataIntoTemplate(template[key], data[key]);
                } else {
                  template[key] = data[key];
                }
              } else {
                template[key] = data[key];
              }
            }
          }
        };
        
        mergeDataIntoTemplate(mergedData, jsonData);
        console.log('[validateAndEnhanceJsonStructure] ✅ Merged response into template structure');
        jsonData = mergedData;
      }
    } catch (e) {
      console.warn('[validateAndEnhanceJsonStructure] Could not merge with template structure:', e);
    }
  }

  if (outputTemplate && outputTemplate.structured_schema) {
    try {
      const schema = typeof outputTemplate.structured_schema === 'string'
        ? JSON.parse(outputTemplate.structured_schema)
        : outputTemplate.structured_schema;

      if (schema.properties && schema.properties.generated_sections) {
        // Normalize the structure - ensure it's in the schemas.output_summary_template format
        if (!jsonData.schemas || !jsonData.schemas.output_summary_template) {
          if (jsonData.generated_sections) {
            jsonData = {
              ...jsonData,
              schemas: {
                output_summary_template: {
                  metadata: jsonData.metadata || {},
                  generated_sections: jsonData.generated_sections
                }
              }
            };
          } else if (jsonData.metadata) {
            // If only metadata exists, create the full structure
            jsonData = {
              schemas: {
                output_summary_template: {
                  metadata: jsonData.metadata,
                  generated_sections: {}
                }
              }
            };
          }
        }

        const requiredSections = Object.keys(schema.properties.generated_sections.properties || {});
        console.log(`[validateAndEnhanceJsonStructure] Required sections from schema: ${requiredSections.length} sections`);
        console.log(`[validateAndEnhanceJsonStructure] Required sections: ${requiredSections.join(', ')}`);
        
        if (jsonData.schemas && jsonData.schemas.output_summary_template) {
          const existingSections = Object.keys(jsonData.schemas.output_summary_template.generated_sections || {});
          console.log(`[validateAndEnhanceJsonStructure] Existing sections in response: ${existingSections.length} sections`);
          console.log(`[validateAndEnhanceJsonStructure] Existing sections: ${existingSections.join(', ')}`);
          
          const missingSections = requiredSections.filter(section => !existingSections.includes(section));
          
          if (missingSections.length > 0) {
            console.warn(`[validateAndEnhanceJsonStructure] ⚠️ MISSING ${missingSections.length} REQUIRED SECTIONS: ${missingSections.join(', ')}`);
            console.warn(`[validateAndEnhanceJsonStructure] Adding placeholder sections. The LLM should have generated these!`);
            
            missingSections.forEach(section => {
              if (!jsonData.schemas.output_summary_template.generated_sections) {
                jsonData.schemas.output_summary_template.generated_sections = {};
              }
              // Get the section schema to determine the required_summary_type
              const sectionSchema = schema.properties.generated_sections.properties[section];
              const summaryType = sectionSchema?.properties?.required_summary_type?.default || 
                                   sectionSchema?.properties?.required_summary_type?.enum?.[0] || 
                                   'Extractive';
              
              jsonData.schemas.output_summary_template.generated_sections[section] = {
                generated_text: `⚠️ WARNING: This section was missing from the LLM response. Expected section "${section}" with content extracted from documents.`,
                required_summary_type: summaryType
              };
            });
          } else {
            console.log(`[validateAndEnhanceJsonStructure] ✅ All required sections are present!`);
          }
        } else {
          console.warn(`[validateAndEnhanceJsonStructure] ⚠️ Response structure is missing schemas.output_summary_template.generated_sections`);
        }
      }
    } catch (e) {
      console.warn('[validateAndEnhanceJsonStructure] Error validating schema:', e);
    }
  }

  return jsonData;
}

function postProcessSecretPromptResponse(rawResponse, outputTemplate = null) {
  if (!rawResponse || typeof rawResponse !== 'string') {
    return rawResponse;
  }

  let cleanedResponse = rawResponse.trim();
  let jsonData = null;
  
  const jsonMatch = cleanedResponse.match(/```json\s*([\s\S]*?)\s*```/i);
  if (jsonMatch) {
    try {
      const jsonText = jsonMatch[1].trim();
      jsonData = JSON.parse(jsonText);
    } catch (e) {
      console.warn('[postProcessSecretPromptResponse] Failed to parse JSON from code block:', e);
      try {
        let fixedJson = jsonText.replace(/,(\s*[}\]])/g, '$1');
        jsonData = JSON.parse(fixedJson);
      } catch (e2) {
        console.warn('[postProcessSecretPromptResponse] Failed to fix and parse JSON:', e2);
      }
    }
  }
  
  if (!jsonData) {
    const trimmed = cleanedResponse.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        jsonData = JSON.parse(trimmed);
      } catch (e) {
        console.warn('[postProcessSecretPromptResponse] Failed to parse raw JSON:', e);
        try {
          let fixedJson = trimmed.replace(/,(\s*[}\]])/g, '$1');
          jsonData = JSON.parse(fixedJson);
        } catch (e2) {
          console.warn('[postProcessSecretPromptResponse] Failed to fix raw JSON:', e2);
        }
      }
    }
  }
  
  if (!jsonData) {
    const jsonPattern = /\{[\s\S]{50,}\}/; // At least 50 chars to avoid false matches
    const jsonMatch2 = cleanedResponse.match(jsonPattern);
    if (jsonMatch2) {
      try {
        jsonData = JSON.parse(jsonMatch2[0]);
      } catch (e) {
        try {
          let fixedJson = jsonMatch2[0].replace(/,(\s*[}\]])/g, '$1');
          jsonData = JSON.parse(fixedJson);
        } catch (e2) {
          console.warn('[postProcessSecretPromptResponse] Could not extract valid JSON from text');
        }
      }
    }
  }
  
  if (jsonData && typeof jsonData === 'object') {
    jsonData = validateAndEnhanceJsonStructure(jsonData, outputTemplate);
    
    const formattedJson = JSON.stringify(jsonData, null, 2);
    return `\`\`\`json\n${formattedJson}\n\`\`\``;
  }
  
  if (outputTemplate && outputTemplate.structured_schema) {
    console.warn('[postProcessSecretPromptResponse] Response does not contain valid JSON, but template exists');
    console.warn('[postProcessSecretPromptResponse] Raw response preview:', cleanedResponse.substring(0, 200));
  }
  
  return cleanedResponse;
}

let secretClient;

function setupGCPClientFromBase64() {
  const base64Key = process.env.GCS_KEY_BASE64;
  if (!base64Key) throw new Error('❌ GCS_KEY_BASE64 is not set');

  const keyJson = Buffer.from(base64Key, 'base64').toString('utf8');
  const tempFilePath = path.join(os.tmpdir(), 'gcp-key.json');
  fs.writeFileSync(tempFilePath, keyJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tempFilePath;

  secretClient = new SecretManagerServiceClient();
}

if (!secretClient) {
  setupGCPClientFromBase64();
}

const GCLOUD_PROJECT_ID = process.env.GCLOUD_PROJECT_ID;
if (!GCLOUD_PROJECT_ID) throw new Error('❌ GCLOUD_PROJECT_ID not set in env');

const fetchSecretValueFromGCP = async (req, res) => {
  const { id } = req.params;

  try {
    console.log('📦 Fetching secret config from DB for ID:', id);

    const query = `
      SELECT s.secret_manager_id, s.version, s.llm_id, l.name AS llm_name, cm.method_name AS chunking_method
      FROM secret_manager s
      LEFT JOIN chunking_methods cm ON s.chunking_method_id = cm.id
      LEFT JOIN llm_models l ON s.llm_id = l.id
      WHERE s.id = $1
    `;

    const result = await db.query(query, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '❌ Secret config not found in DB' });
    }

    const { secret_manager_id, version, llm_id, llm_name, chunking_method } = result.rows[0];
    const secretName = `projects/${GCLOUD_PROJECT_ID}/secrets/${secret_manager_id}/versions/${version}`;
    console.log('🔐 Fetching from GCP Secret Manager:', secretName);

    let accessResponse;
    try {
      [accessResponse] = await secretClient.accessSecretVersion({ name: secretName });
    } catch (gcpError) {
      console.error(`\n${'='.repeat(80)}`);
      console.error(`🔐 [Secret Manager] ❌ GCP SECRET MANAGER ACCESS DENIED`);
      console.error(`${'='.repeat(80)}`);
      console.error(`Error: ${gcpError.message}`);
      console.error(`Secret Path: ${secretName}`);
      console.error(`\n🔧 TO FIX THIS ISSUE:`);
      console.error(`1. Ensure the service account has 'Secret Manager Secret Accessor' role`);
      console.error(`2. Grant permission: roles/secretmanager.secretAccessor`);
      console.error(`3. Verify GCS_KEY_BASE64 contains valid credentials`);
      console.error(`4. Check that the secret exists in GCP Secret Manager`);
      console.error(`5. Verify the service account email has access to the secret`);
      console.error(`${'='.repeat(80)}\n`);
      throw new Error(`GCP Secret Manager access denied: ${gcpError.message}`);
    }
    const secretValue = accessResponse.payload.data.toString('utf8');

    res.status(200).json({
      secretManagerId: secret_manager_id,
      version,
      llm_id,
      llm_name,
      chunking_method, // Include chunking_method
      value: secretValue,
    });
  } catch (err) {
    console.error('🚨 Error in fetchSecretValueFromGCP:', err.message);
    res.status(500).json({ error: 'Internal Server Error: ' + err.message });
  }
};

const createSecretInGCP = async (req, res) => {
  const {
    name,
    description,
    secret_manager_id,
    secret_value,
    llm_id,
    chunking_method, // NEW: Add chunking_method
    version = '1',
    created_by = 1,
    template_type = 'system',
    status = 'active',
    usage_count = 0,
    success_rate = 0,
    avg_processing_time = 0,
    template_metadata = {},
  } = req.body;

  try {
    const parent = `projects/${GCLOUD_PROJECT_ID}`;
    const secretName = `${parent}/secrets/${secret_manager_id}`;

    const [secrets] = await secretClient.listSecrets({ parent });
    const exists = secrets.find((s) => s.name === secretName);

    if (!exists) {
      console.log(`🆕 Creating new secret: ${secret_manager_id}`);
      await secretClient.createSecret({
        parent,
        secretId: secret_manager_id,
        secret: { replication: { automatic: {} } },
      });
    } else {
      console.log(`ℹ️ Secret already exists: ${secret_manager_id}`);
    }

    const [versionResponse] = await secretClient.addSecretVersion({
      parent: secretName,
      payload: { data: Buffer.from(secret_value, 'utf8') },
    });
    const versionId = versionResponse.name.split('/').pop();

    const insertQuery = `
      INSERT INTO secret_manager (
        id, name, description, template_type, status,
        usage_count, success_rate, avg_processing_time,
        created_by, updated_by, created_at, updated_at,
        activated_at, last_used_at, template_metadata,
        secret_manager_id, version, llm_id, chunking_method
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4,
        $5, $6, $7,
        $8, $8, now(), now(),
        now(), NULL, $9::jsonb,
        $10, $11, $12, $13
      )
      RETURNING *;
    `;

    const result = await db.query(insertQuery, [
      name,
      description,
      template_type,
      status,
      usage_count,
      success_rate,
      avg_processing_time,
      created_by,
      JSON.stringify(template_metadata),
      secret_manager_id,
      versionId,
      llm_id || null,
      chunking_method || null, // NEW: Add chunking_method
    ]);

    res.status(201).json({
      message: '✅ Secret created and version added to GCP',
      gcpSecret: secret_manager_id,
      gcpVersion: versionId,
      dbRecord: result.rows[0],
    });
  } catch (error) {
    console.error('🚨 Error creating secret in GCP:', error.message);
    res.status(500).json({ error: 'Failed to create secret: ' + error.message });
  }
};

const getAllSecrets = async (req, res) => {
  const includeValues = req.query.fetch === 'true';

  try {
    const query = `
      SELECT 
        s.*, 
        l.name AS llm_name
      FROM secret_manager s
      LEFT JOIN llm_models l ON s.llm_id = l.id
      ORDER BY s.created_at DESC
    `;

    const result = await db.query(query);
    const rows = result.rows;

    if (!includeValues) {
      return res.status(200).json(rows);
    }

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

    res.status(200).json(enriched);
  } catch (error) {
    console.error('🚨 Error fetching secrets:', error.message);
    res.status(500).json({ error: 'Failed to fetch secrets: ' + error.message });
  }
};



const triggerSecretLLM = async (req, res) => {
  const { secretId, fileId, additionalInput = "", sessionId, llm_name: requestLlmName } = req.body;

  console.log(`[triggerSecretLLM] Request body:`, {
    secretId,
    fileId,
    sessionId,
    llm_name: requestLlmName,
    additionalInput: additionalInput ? additionalInput.substring(0, 50) + '...' : '(empty)',
  });

  if (!secretId) return res.status(400).json({ error: '❌ secretId is required.' });
  if (!fileId) return res.status(400).json({ error: '❌ fileId is required.' });

  const userId = req.user?.id || req.userId;
  if (!userId) return res.status(401).json({ error: '❌ User authentication required.' });

  const finalSessionId = sessionId || uuidv4();

  try {
    console.log(`[triggerSecretLLM] Starting process for secretId: ${secretId}, fileId: ${fileId}`);

    const { fetchSecretManagerWithTemplates, fetchTemplateFilesData, buildEnhancedSystemPromptWithTemplates } = require('../services/secretPromptTemplateService');
    const secretData = await fetchSecretManagerWithTemplates(secretId);
    if (!secretData)
      return res.status(404).json({ error: '❌ Secret configuration not found in DB.' });

    const {
      name: secretName,
      secret_manager_id,
      version,
      llm_name: dbLlmName,
      chunking_method: dbChunkingMethod,
      input_template_id,
      output_template_id,
    } = secretData;

    console.log(
      `[triggerSecretLLM] Found secret: ${secretName}, LLM from DB: ${dbLlmName || 'none'}, Chunking Method from DB: ${dbChunkingMethod || 'none'}`
    );

    let provider = resolveProviderName(requestLlmName || dbLlmName);
    console.log(`[triggerSecretLLM] Resolved LLM provider: ${provider}`);
    const availableProviders = getAvailableProviders();
    if (!availableProviders[provider] || !availableProviders[provider].available) {
      console.warn(`[triggerSecretLLM] Provider '${provider}' unavailable — falling back to gemini`);
      provider = 'gemini';
    }

    const gcpSecretName = `projects/${GCLOUD_PROJECT_ID}/secrets/${secret_manager_id}/versions/${version}`;
    console.log(`[triggerSecretLLM] Fetching secret from GCP: ${gcpSecretName}`);

    const [accessResponse] = await secretClient.accessSecretVersion({ name: gcpSecretName });
    let secretValue = accessResponse.payload.data.toString('utf8');
    if (!secretValue?.trim()) return res.status(500).json({ error: '❌ Secret value is empty in GCP.' });

    console.log(`[triggerSecretLLM] Secret value length: ${secretValue.length} characters`);

    let templateData = { inputTemplate: null, outputTemplate: null, hasTemplates: false };
    if (input_template_id || output_template_id) {
      console.log(`[triggerSecretLLM] Fetching template files:`);
      console.log(`   Input Template ID: ${input_template_id || 'not set'}`);
      console.log(`   Output Template ID: ${output_template_id || 'not set'}`);
      
      templateData = await fetchTemplateFilesData(input_template_id, output_template_id);
      
      if (templateData.hasTemplates) {
        console.log(`[triggerSecretLLM] ✅ Template files fetched successfully`);
        if (templateData.inputTemplate) {
          console.log(`   Input: ${templateData.inputTemplate.filename} (${templateData.inputTemplate.extracted_text?.length || 0} chars)`);
        }
        if (templateData.outputTemplate) {
          console.log(`   Output: ${templateData.outputTemplate.filename} (${templateData.outputTemplate.extracted_text?.length || 0} chars)`);
        }
        
        secretValue = buildEnhancedSystemPromptWithTemplates(secretValue, templateData);
        console.log(`[triggerSecretLLM] ✅ Enhanced prompt built with template examples (${secretValue.length} chars)`);
      } else {
        console.log(`[triggerSecretLLM] ⚠️ No template files found or available`);
      }
    }

    const FileChunkModel = require('../models/FileChunk');
    const allChunks = await FileChunkModel.getChunksByFileId(fileId);
    if (!allChunks?.length)
      return res.status(404).json({ error: '❌ No document content found for this file.' });

    const documentContent = allChunks.map((c) => c.content).join('\n\n');
    console.log(`[triggerSecretLLM] Document content length: ${documentContent.length} characters`);

    let finalPrompt = `You are an expert AI legal assistant using the ${provider.toUpperCase()} model.\n\n`;
    
    const inputTemplate = templateData?.inputTemplate || null;
    const outputTemplate = templateData?.outputTemplate || null;
    const formattedSecretValue = addSecretPromptJsonFormatting(secretValue, inputTemplate, outputTemplate);
    finalPrompt += `${formattedSecretValue}\n\n=== DOCUMENT TO ANALYZE ===\n${documentContent}`;
    
    if (inputTemplate && inputTemplate.extracted_text) {
      finalPrompt += `\n\n💡 REMINDER: Extract points from these documents based on the INPUT TEMPLATE format shown above, `;
      finalPrompt += `and format your response according to the OUTPUT TEMPLATE structure shown above.`;
    }
    if (additionalInput?.trim().length > 0)
      finalPrompt += `\n\n=== ADDITIONAL USER INSTRUCTIONS ===\n${additionalInput.trim()}`;

    try {
      const UserProfileService = require('../services/userProfileService');
      const userId = req.user?.id;
      const authorizationHeader = req.headers.authorization;
      if (userId && authorizationHeader) {
        const profileContext = await UserProfileService.getProfileContext(userId, authorizationHeader);
        if (profileContext) {
          finalPrompt = `${profileContext}\n\n---\n\n${finalPrompt}`;
          console.log(`[triggerSecretLLM] Added user professional profile context to prompt`);
        }
      }
    } catch (profileError) {
      console.warn(`[triggerSecretLLM] Failed to fetch profile context:`, profileError.message);
    }

    console.log(`[triggerSecretLLM] Final prompt length: ${finalPrompt.length} characters`);
    console.log(`[triggerSecretLLM] Prompt includes secret prompt: ${secretValue.length} chars + document content: ${documentContent.length} chars`);

    console.log(`[triggerSecretLLM] Calling askLLM with provider: ${provider}...`);
    console.log(`[triggerSecretLLM] Token logging: Input tokens will be calculated from full prompt (includes secret prompt), output tokens from response`);
    const originalQuestion = additionalInput?.trim() || secretName;
    let llmResponse = await askLLM(provider, finalPrompt, '', '', originalQuestion, {
      userId: userId,
      endpoint: '/api/doc/secret/trigger',
      fileId: fileId,
      sessionId: finalSessionId
    });
    if (!llmResponse?.trim()) throw new Error(`Empty response received from ${provider}`);
    console.log(`[triggerSecretLLM] ✅ LLM response received (${llmResponse.length} characters)`);
    
    llmResponse = postProcessSecretPromptResponse(llmResponse, outputTemplate);
    console.log(`[triggerSecretLLM] ✅ Post-processed response (${llmResponse.length} characters)`);

    try {
      const linkedJob = await ProcessingJobModel.linkSecretToJob(fileId, secretId);
      if (linkedJob) {
        console.log(`[triggerSecretLLM] ✅ Linked secret ${secretId} to processing job for file ${fileId}`);
      } else {
        console.warn(`[triggerSecretLLM] ⚠️ No existing processing job found to link for file ${fileId}`);
      }
    } catch (linkErr) {
      console.error(`[triggerSecretLLM] ⚠️ Failed to link secret_id to job: ${linkErr.message}`);
    }

    console.log(`[triggerSecretLLM] Storing chat in database...`);
    const chunkIds = allChunks.map((c) => c.id);

    const insertChatQuery = `
      INSERT INTO file_chats (
        file_id,
        session_id,
        user_id,
        question,
        answer,
        used_secret_prompt,
        prompt_label,
        secret_id,
        used_chunk_ids,
        chat_type,
        created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::int[],$10,NOW())
      RETURNING id, created_at
    `;
    const chatResult = await db.query(insertChatQuery, [
      fileId,
      finalSessionId,
      userId,
      secretName,
      llmResponse,
      true,
      secretName,
      secretId,
      chunkIds,
      'analysis', // chat_type: 'analysis' for document analysis chats
    ]);

    const messageId = chatResult.rows[0].id;
    const createdAt = chatResult.rows[0].created_at;

    const historyQuery = `
      SELECT 
        id, file_id, session_id, question, answer, used_secret_prompt,
        prompt_label, secret_id, used_chunk_ids, created_at as timestamp
      FROM file_chats
      WHERE file_id = $1 AND session_id = $2 AND user_id = $3
      ORDER BY created_at ASC;
    `;
    const historyResult = await db.query(historyQuery, [fileId, finalSessionId, userId]);

    const history = historyResult.rows.map((row) => ({
      id: row.id,
      file_id: row.file_id,
      session_id: row.session_id,
      question: row.question,
      answer: row.answer,
      used_secret_prompt: row.used_secret_prompt,
      prompt_label: row.prompt_label,
      secret_id: row.secret_id,
      used_chunk_ids: typeof row.used_chunk_ids === 'string' ? JSON.parse(row.used_chunk_ids) : row.used_chunk_ids,
      timestamp: row.timestamp,
      display_text_left_panel: row.used_secret_prompt ? `Analysis: ${row.prompt_label}` : row.question,
    }));

    console.log(`[triggerSecretLLM] ✅ Chat and job linked successfully.`);

    return res.status(200).json({
      success: true,
      answer: llmResponse,
      response: llmResponse,
      message_id: messageId,
      session_id: finalSessionId,
      secretManagerId: secret_manager_id,
      llmProvider: provider,
      used_chunk_ids: chunkIds,
      history,
      timestamp: createdAt,
      chunkingMethod: dbChunkingMethod,
    });

  } catch (err) {
    console.error('🚨 Error in triggerSecretLLM:', err);
    res.status(500).json({
      error: `Internal Server Error: ${err.message}`,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
  }
};

const triggerAskLlmForFolder = async (req, res) => {
  const { secretId, folderName, additionalInput = "", sessionId, llm_name: requestLlmName } = req.body;

  console.log(`[triggerAskLlmForFolder] Request body:`, {
    secretId,
    folderName,
    sessionId,
    llm_name: requestLlmName,
    additionalInput: additionalInput ? additionalInput.substring(0, 50) + '...' : '(empty)',
  });

  if (!secretId) return res.status(400).json({ error: '❌ secretId is required.' });
  if (!folderName) return res.status(400).json({ error: '❌ folderName is required.' });

  const userId = req.user?.id || req.userId;
  if (!userId) return res.status(401).json({ error: '❌ User authentication required.' });

  const finalSessionId = sessionId || uuidv4();

  try {
    console.log(`[triggerAskLlmForFolder] Starting process for secretId: ${secretId}, folderName: ${folderName}`);

    const query = `
      SELECT
        s.id,
        s.name,
        s.secret_manager_id,
        s.version,
        s.llm_id,
        l.name AS llm_name,
        cm.method_name AS chunking_method
      FROM secret_manager s
      LEFT JOIN chunking_methods cm ON s.chunking_method_id = cm.id
      LEFT JOIN llm_models l ON s.llm_id = l.id
      WHERE s.id = $1
    `;
    const result = await db.query(query, [secretId]);
    if (result.rows.length === 0)
      return res.status(404).json({ error: '❌ Secret configuration not found in DB.' });

    const {
      name: secretName,
      secret_manager_id,
      version,
      llm_name: dbLlmName,
      chunking_method: dbChunkingMethod,
    } = result.rows[0];

    console.log(
      `[triggerAskLlmForFolder] Found secret: ${secretName}, LLM from DB: ${dbLlmName || 'none'}, Chunking Method from DB: ${dbChunkingMethod || 'none'}`
    );

    let provider = resolveProviderName(requestLlmName || dbLlmName);
    console.log(`[triggerAskLlmForFolder] Resolved LLM provider: ${provider}`);
    const availableProviders = getAvailableProviders();
    if (!availableProviders[provider] || !availableProviders[provider].available) {
      console.warn(`[triggerAskLlmForFolder] Provider '${provider}' unavailable — falling back to gemini`);
      provider = 'gemini';
    }

    const gcpSecretName = `projects/${GCLOUD_PROJECT_ID}/secrets/${secret_manager_id}/versions/${version}`;
    console.log(`[triggerAskLlmForFolder] Fetching secret from GCP: ${gcpSecretName}`);

    const [accessResponse] = await secretClient.accessSecretVersion({ name: gcpSecretName });
    const secretValue = accessResponse.payload.data.toString('utf8');
    if (!secretValue?.trim()) return res.status(500).json({ error: '❌ Secret value is empty in GCP.' });

    console.log(`[triggerAskLlmForFolder] Secret value length: ${secretValue.length} characters`);

    const files = await File.findByUserIdAndFolderPath(userId, folderName);
    const processedFiles = files.filter(f => !f.is_folder && f.status === "processed");

    if (processedFiles.length === 0) {
      return res.status(404).json({ error: "No processed documents found in this folder." });
    }

    console.log(`[triggerAskLlmForFolder] Found ${processedFiles.length} processed files in folder "${folderName}"`);

    let allChunks = [];
    const FileChunk = require('../models/FileChunk'); // Dynamically require FileChunk
    for (const file of processedFiles) {
      const chunks = await FileChunk.getChunksByFileId(file.id);
      allChunks.push(
        ...chunks.map((chunk) => ({
          ...chunk,
          file_id: file.id,
          filename: file.originalname,
        }))
      );
    }

    if (allChunks.length === 0) {
      return res.status(400).json({ error: "No content found in folder documents." });
    }

    const documentContent = allChunks.map((c) => `📄 [${c.filename}]\n${c.content}`).join('\n\n');
    console.log(`[triggerAskLlmForFolder] Combined document content length: ${documentContent.length} characters`);

    let finalPrompt = `You are an expert AI legal assistant using the ${provider.toUpperCase()} model.\n\n`;
    
    let templateData = { inputTemplate: null, outputTemplate: null, hasTemplates: false };
    const { fetchTemplateFilesData, buildEnhancedSystemPromptWithTemplates } = require('../services/secretPromptTemplateService');
    const secretData = await fetchSecretManagerWithTemplates(secretId);
    if (secretData && (secretData.input_template_id || secretData.output_template_id)) {
      templateData = await fetchTemplateFilesData(secretData.input_template_id, secretData.output_template_id);
      
      if (templateData.hasTemplates) {
        secretValue = buildEnhancedSystemPromptWithTemplates(secretValue, templateData);
      }
    }
    
    const inputTemplate = templateData?.inputTemplate || null;
    const outputTemplate = templateData?.outputTemplate || null;
    const formattedSecretValue = addSecretPromptJsonFormatting(secretValue, inputTemplate, outputTemplate);
    finalPrompt += `${formattedSecretValue}\n\n=== DOCUMENTS TO ANALYZE (FOLDER: "${folderName}") ===\n${documentContent}`;
    
    if (inputTemplate && inputTemplate.extracted_text) {
      finalPrompt += `\n\n💡 REMINDER: Extract points from these documents based on the INPUT TEMPLATE format shown above, `;
      finalPrompt += `and format your response according to the OUTPUT TEMPLATE structure shown above.`;
    }
    if (additionalInput?.trim().length > 0)
      finalPrompt += `\n\n=== ADDITIONAL USER INSTRUCTIONS ===\n${additionalInput.trim()}`;

    try {
      const UserProfileService = require('../services/userProfileService');
      const userId = req.user?.id;
      const authorizationHeader = req.headers.authorization;
      if (userId && authorizationHeader) {
        const profileContext = await UserProfileService.getProfileContext(userId, authorizationHeader);
        if (profileContext) {
          finalPrompt = `${profileContext}\n\n---\n\n${finalPrompt}`;
          console.log(`[triggerAskLlmForFolder] Added user professional profile context to prompt`);
        }
      }
    } catch (profileError) {
      console.warn(`[triggerAskLlmForFolder] Failed to fetch profile context:`, profileError.message);
    }

    console.log(`[triggerAskLlmForFolder] Final prompt length: ${finalPrompt.length} characters`);
    console.log(`[triggerAskLlmForFolder] Prompt includes secret prompt: ${secretValue.length} chars + document content: ${documentContent.length} chars`);

    console.log(`[triggerAskLlmForFolder] Calling askFolderLLM with provider: ${provider}...`);
    console.log(`[triggerAskLlmForFolder] Token logging: Input tokens will be calculated from full prompt (includes secret prompt), output tokens from response`);
    const originalQuestion = additionalInput?.trim() || secretName;
    const userId = req.user?.id || req.userId;
    let llmResponse = await askFolderLLM(provider, finalPrompt, '', null, originalQuestion, {
      userId: userId,
      endpoint: '/api/doc/secret/trigger-folder',
      fileId: null, // No specific file for folder chat
      sessionId: finalSessionId
    }); // Pass original question for web search and metadata for logging
    if (!llmResponse?.trim()) throw new Error(`Empty response received from ${provider}`);
    console.log(`[triggerAskLlmForFolder] ✅ LLM response received (${llmResponse.length} characters)`);
    
    llmResponse = postProcessSecretPromptResponse(llmResponse, outputTemplate);
    console.log(`[triggerAskLlmForFolder] ✅ Post-processed response (${llmResponse.length} characters)`);

    console.log(`[triggerAskLlmForFolder] Storing chat in database...`);
    const summarizedFileIds = processedFiles.map((f) => f.id);

    const existingHistory = await FolderChat.getFolderChatHistory(userId, folderName, finalSessionId);
    const historyForStorage = simplifyFolderChatHistory(existingHistory);
    if (historyForStorage.length > 0) {
      const lastTurn = historyForStorage[historyForStorage.length - 1];
      console.log(
        `[triggerAskLlmForFolder] Using ${historyForStorage.length} prior turn(s) for context. Most recent: Q="${(lastTurn.question || '').slice(0, 120)}", A="${(lastTurn.answer || '').slice(0, 120)}"`
      );
    } else {
      console.log('[triggerAskLlmForFolder] No prior context for this session.');
    }

    const savedChat = await FolderChat.saveFolderChat(
      userId,
      folderName,
      secretName, // Store the secret/prompt name as the question
      llmResponse,
      finalSessionId,
      summarizedFileIds,
      allChunks.map((c) => c.id), // usedChunkIds
      true, // used_secret_prompt = true
      secretName, // prompt_label
      secretId,
      historyForStorage
    );

    const messageId = savedChat.id;
    const createdAt = savedChat.created_at;

    console.log(`[triggerAskLlmForFolder] ✅ Chat stored in DB with ID: ${messageId}`);

    const historyRows = await FolderChat.getFolderChatHistory(userId, folderName, finalSessionId);

    const history = historyRows.map((row) => ({
      id: row.id,
      folder_name: row.folder_name,
      session_id: row.session_id,
      question: row.question,
      answer: row.answer,
      used_secret_prompt: row.used_secret_prompt,
      prompt_label: row.prompt_label,
      secret_id: row.secret_id,
      summarized_file_ids: row.summarized_file_ids,
      timestamp: row.created_at,
      chat_history: row.chat_history || [],
      display_text_left_panel: row.used_secret_prompt ? `Analysis: ${row.prompt_label}` : row.question,
    }));

    console.log(`[triggerAskLlmForFolder] ✅ Chat and job linked successfully.`);

    return res.status(200).json({
      success: true,
      answer: llmResponse,
      response: llmResponse,
      message_id: messageId,
      session_id: finalSessionId,
      secretManagerId: secret_manager_id,
      llmProvider: provider,
      files_queried: processedFiles.map(f => f.originalname),
      history,
      timestamp: createdAt,
      chunkingMethod: dbChunkingMethod,
    });

  } catch (err) {
    console.error('🚨 Error in triggerAskLlmForFolder:', err);
    res.status(500).json({
      error: `Internal Server Error: ${err.message}`,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
  }
};


const getSecretDetailsById = async (secretId) => {
  try {
    const query = `
      SELECT
        s.id,
        s.name,
        s.secret_manager_id,
        s.version,
        s.llm_id,
        s.input_template_id,
        s.output_template_id,
        l.name AS llm_name,
        cm.method_name AS chunking_method
      FROM secret_manager s
      LEFT JOIN chunking_methods cm ON s.chunking_method_id = cm.id
      LEFT JOIN llm_models l ON s.llm_id = l.id
      WHERE s.id = $1
    `;
    const result = await db.query(query, [secretId]);
    return result.rows[0];
  } catch (error) {
    console.error(`🚨 Error in getSecretDetailsById for secret ${secretId}:`, error.message);
    throw error;
  }
};


module.exports = {
  getAllSecrets,
  fetchSecretValueFromGCP,
  createSecretInGCP,
  triggerSecretLLM,
  triggerAskLlmForFolder, // Export the new function
  getSecretDetailsById,
  postProcessSecretPromptResponse, // Export postProcessSecretPromptResponse
};


