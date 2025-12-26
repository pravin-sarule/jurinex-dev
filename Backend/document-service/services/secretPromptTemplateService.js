const pool = require('../config/db');

async function fetchTemplateFilesData(inputTemplateId, outputTemplateId) {
  const result = {
    inputTemplate: null,
    outputTemplate: null,
    hasTemplates: false
  };

  try {
    if (inputTemplateId) {
      // Get the most recent extraction with all data, prioritizing document_ai_extractions
      const inputQuery = `
        SELECT 
          tf.id,
          tf.filename,
          tf.file_type,
          tf.ai_extracted_text,
          dae.extracted_text,
          dae.structured_schema,
          dae.entities,
          dae.form_fields,
          dae.tables,
          dae.created_at as extraction_created_at
        FROM template_files tf
        LEFT JOIN (
          SELECT DISTINCT ON (template_file_id)
            template_file_id,
            extracted_text,
            structured_schema,
            entities,
            form_fields,
            tables,
            created_at
          FROM document_ai_extractions
          WHERE extracted_text IS NOT NULL
            AND extracted_text != ''
            AND template_file_id = $1
          ORDER BY template_file_id, created_at DESC
        ) dae ON dae.template_file_id = tf.id
        WHERE tf.id = $1
          AND (tf.deleted_at IS NULL OR tf.deleted_at > NOW())
        LIMIT 1;
      `;
      
      const inputResult = await pool.query(inputQuery, [inputTemplateId]);
      
      if (inputResult.rows.length > 0) {
        const row = inputResult.rows[0];
        // Prioritize extracted_text from document_ai_extractions, fallback to ai_extracted_text
        const extractedText = row.extracted_text || row.ai_extracted_text || '';
        
        result.inputTemplate = {
          id: row.id,
          filename: row.filename,
          file_type: row.file_type,
          extracted_text: extractedText,
          structured_schema: row.structured_schema || null,
          entities: row.entities || null,
          form_fields: row.form_fields || null,
          tables: row.tables || null
        };
        result.hasTemplates = true;
        console.log(`✅ [Template Service] Input template found: ${row.filename}`);
        console.log(`   📄 Extracted text length: ${extractedText.length} characters`);
        console.log(`   📊 Has structured_schema: ${!!row.structured_schema}`);
        console.log(`   📝 Has form_fields: ${!!(row.form_fields && row.form_fields.length > 0)}`);
        console.log(`   📋 Has tables: ${!!(row.tables && row.tables.length > 0)}`);
        if (row.extraction_created_at) {
          console.log(`   🕐 Extraction date: ${row.extraction_created_at}`);
        }
      } else {
        console.warn(`⚠️ [Template Service] Input template file not found: ${inputTemplateId}`);
      }
    }

    if (outputTemplateId) {
      // Get the most recent extraction with all data, prioritizing document_ai_extractions
      const outputQuery = `
        SELECT 
          tf.id,
          tf.filename,
          tf.file_type,
          tf.ai_extracted_text,
          dae.extracted_text,
          dae.structured_schema,
          dae.entities,
          dae.form_fields,
          dae.tables,
          dae.created_at as extraction_created_at
        FROM template_files tf
        LEFT JOIN (
          SELECT DISTINCT ON (template_file_id)
            template_file_id,
            extracted_text,
            structured_schema,
            entities,
            form_fields,
            tables,
            created_at
          FROM document_ai_extractions
          WHERE extracted_text IS NOT NULL
            AND extracted_text != ''
            AND template_file_id = $1
          ORDER BY template_file_id, created_at DESC
        ) dae ON dae.template_file_id = tf.id
        WHERE tf.id = $1
          AND (tf.deleted_at IS NULL OR tf.deleted_at > NOW())
        LIMIT 1;
      `;
      
      const outputResult = await pool.query(outputQuery, [outputTemplateId]);
      
      if (outputResult.rows.length > 0) {
        const row = outputResult.rows[0];
        // Prioritize extracted_text from document_ai_extractions, fallback to ai_extracted_text
        const extractedText = row.extracted_text || row.ai_extracted_text || '';
        
        result.outputTemplate = {
          id: row.id,
          filename: row.filename,
          file_type: row.file_type,
          extracted_text: extractedText,
          structured_schema: row.structured_schema || null,
          entities: row.entities || null,
          form_fields: row.form_fields || null,
          tables: row.tables || null
        };
        result.hasTemplates = true;
        console.log(`✅ [Template Service] Output template found: ${row.filename}`);
        console.log(`   📄 Extracted text length: ${extractedText.length} characters`);
        console.log(`   📊 Has structured_schema: ${!!row.structured_schema}`);
        console.log(`   📝 Has form_fields: ${!!(row.form_fields && row.form_fields.length > 0)}`);
        console.log(`   📋 Has tables: ${!!(row.tables && row.tables.length > 0)}`);
        if (row.extraction_created_at) {
          console.log(`   🕐 Extraction date: ${row.extraction_created_at}`);
        }
      } else {
        console.warn(`⚠️ [Template Service] Output template file not found: ${outputTemplateId}`);
      }
    }

    return result;
  } catch (error) {
    console.error(`❌ [Template Service] Error fetching template files:`, error.message);
    console.error(`   Stack:`, error.stack);
    return result;
  }
}

function buildEnhancedSystemPromptWithTemplates(secretPrompt, templateData) {
  let enhancedPrompt = secretPrompt;

  if (templateData.inputTemplate && templateData.inputTemplate.extracted_text) {
    enhancedPrompt += `\n\n`;
    enhancedPrompt += `═══════════════════════════════════════════════════════════════════════\n`;
    enhancedPrompt += `📥 INPUT TEMPLATE - EXTRACT POINTS FROM THIS FORMAT\n`;
    enhancedPrompt += `═══════════════════════════════════════════════════════════════════════\n\n`;
    enhancedPrompt += `The INPUT TEMPLATE below shows you the FORMAT and STRUCTURE of the input documents.\n`;
    enhancedPrompt += `Your task is to identify and extract similar points/information from the actual documents provided to you.\n\n`;
    enhancedPrompt += `📋 INPUT TEMPLATE DETAILS:\n`;
    enhancedPrompt += `Filename: ${templateData.inputTemplate.filename}\n`;
    enhancedPrompt += `File Type: ${templateData.inputTemplate.file_type || 'input'}\n\n`;
    
    // Parse and extract key data points from input template
    const inputText = templateData.inputTemplate.extracted_text;
    let extractedDataPoints = [];
    
    // Try to extract structured data points from the input template
    try {
      // If it's JSON, parse it to extract keys/fields
      const parsedInput = JSON.parse(inputText);
      if (typeof parsedInput === 'object') {
        const extractKeys = (obj, prefix = '') => {
          for (const key in obj) {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
              extractKeys(obj[key], fullKey);
            } else {
              extractedDataPoints.push(fullKey);
            }
          }
        };
        extractKeys(parsedInput);
      }
    } catch (e) {
      // Not JSON, extract text patterns
      // Look for common patterns like dates, names, amounts, etc.
      const datePattern = /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/g;
      const amountPattern = /[₹$€£]?\s*\d+[,\d]*\.?\d*/g;
      const namePattern = /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g;
      
      const dates = inputText.match(datePattern) || [];
      const amounts = inputText.match(amountPattern) || [];
      const names = inputText.match(namePattern) || [];
      
      if (dates.length > 0) extractedDataPoints.push(`Dates: ${dates.slice(0, 5).join(', ')}`);
      if (amounts.length > 0) extractedDataPoints.push(`Amounts: ${amounts.slice(0, 5).join(', ')}`);
      if (names.length > 0) extractedDataPoints.push(`Names: ${names.slice(0, 5).join(', ')}`);
    }
    
    enhancedPrompt += `📄 INPUT TEMPLATE CONTENT (Study this format to understand what to extract):\n`;
    enhancedPrompt += `${inputText}\n\n`;
    
    if (extractedDataPoints.length > 0) {
      enhancedPrompt += `🔍 KEY DATA POINTS IDENTIFIED IN INPUT TEMPLATE:\n`;
      extractedDataPoints.forEach((point, idx) => {
        enhancedPrompt += `   ${idx + 1}. ${point}\n`;
      });
      enhancedPrompt += `\n💡 INSTRUCTION: Look for similar data points in the actual documents you analyze.\n\n`;
    }
    
    if (templateData.inputTemplate.structured_schema) {
      let schemaObj = templateData.inputTemplate.structured_schema;
      if (typeof schemaObj === 'string') {
        try {
          schemaObj = JSON.parse(schemaObj);
        } catch (e) {
          // Keep as string if parsing fails
        }
      }
      
      enhancedPrompt += `\n📊 INPUT TEMPLATE STRUCTURED SCHEMA:\n`;
      enhancedPrompt += `This schema shows the expected structure of input documents:\n`;
      enhancedPrompt += `${JSON.stringify(schemaObj, null, 2)}\n\n`;
      enhancedPrompt += `💡 INSTRUCTION: Look for similar structured information in the actual documents you receive.\n`;
      enhancedPrompt += `💡 INSTRUCTION: Extract data that matches the fields and structure shown in this schema.\n\n`;
    }
    
    if (templateData.inputTemplate.form_fields && templateData.inputTemplate.form_fields.length > 0) {
      let formFields = templateData.inputTemplate.form_fields;
      if (typeof formFields === 'string') {
        try {
          formFields = JSON.parse(formFields);
        } catch (e) {
          // Keep as string if parsing fails
        }
      }
      
      enhancedPrompt += `\n📝 INPUT TEMPLATE FORM FIELDS (Extract similar fields from documents):\n`;
      enhancedPrompt += `${JSON.stringify(formFields, null, 2)}\n\n`;
      enhancedPrompt += `💡 INSTRUCTION: Identify and extract similar form field values from the actual documents.\n`;
      enhancedPrompt += `💡 INSTRUCTION: Match each field shown above with corresponding data in the documents.\n\n`;
    }
    
    if (templateData.inputTemplate.tables && templateData.inputTemplate.tables.length > 0) {
      let tables = templateData.inputTemplate.tables;
      if (typeof tables === 'string') {
        try {
          tables = JSON.parse(tables);
        } catch (e) {
          // Keep as string if parsing fails
        }
      }
      
      enhancedPrompt += `\n📊 INPUT TEMPLATE TABLES (Extract similar table data from documents):\n`;
      enhancedPrompt += `${JSON.stringify(tables, null, 2)}\n\n`;
      enhancedPrompt += `💡 INSTRUCTION: Extract similar table structures and data from the actual documents.\n`;
      enhancedPrompt += `💡 INSTRUCTION: Maintain the same table structure and column relationships.\n\n`;
    }

    enhancedPrompt += `🎯 CRITICAL INSTRUCTIONS FOR INPUT TEMPLATE:\n`;
    enhancedPrompt += `1. ✅ Study the INPUT TEMPLATE content shown above to understand the document structure\n`;
    enhancedPrompt += `2. ✅ Identify ALL types of information shown in the INPUT TEMPLATE (dates, names, amounts, sections, etc.)\n`;
    enhancedPrompt += `3. ✅ When analyzing the actual documents, extract EVERY piece of information that matches the INPUT TEMPLATE format\n`;
    enhancedPrompt += `4. ✅ Pay attention to the structure, formatting, and organization shown in the INPUT TEMPLATE\n`;
    enhancedPrompt += `5. ✅ Extract all relevant data points, fields, sections, and information that correspond to the INPUT TEMPLATE\n`;
    enhancedPrompt += `6. ✅ Collect ALL data mentioned in the INPUT TEMPLATE from the actual documents\n\n`;
  }

  if (templateData.outputTemplate && templateData.outputTemplate.extracted_text) {
    enhancedPrompt += `\n\n`;
    enhancedPrompt += `═══════════════════════════════════════════════════════════════════════\n`;
    enhancedPrompt += `📤 OUTPUT TEMPLATE - GENERATE RESPONSE IN THIS EXACT FORMAT\n`;
    enhancedPrompt += `═══════════════════════════════════════════════════════════════════════\n\n`;
    enhancedPrompt += `The OUTPUT TEMPLATE below shows you the EXACT JSON structure and format you MUST use for your response.\n`;
    enhancedPrompt += `⚠️ CRITICAL: You must extract information from the documents (based on INPUT TEMPLATE format) and format it according to this OUTPUT TEMPLATE structure.\n\n`;
    enhancedPrompt += `📋 OUTPUT TEMPLATE DETAILS:\n`;
    enhancedPrompt += `Filename: ${templateData.outputTemplate.filename}\n`;
    enhancedPrompt += `File Type: ${templateData.outputTemplate.file_type || 'output'}\n\n`;
    
    // Extract all required section keys from structured_schema first
    let allRequiredSections = [];
    if (templateData.outputTemplate.structured_schema) {
      try {
        const schema = typeof templateData.outputTemplate.structured_schema === 'string'
          ? JSON.parse(templateData.outputTemplate.structured_schema)
          : templateData.outputTemplate.structured_schema;
        if (schema.properties && schema.properties.generated_sections && schema.properties.generated_sections.properties) {
          allRequiredSections = Object.keys(schema.properties.generated_sections.properties);
        }
      } catch (e) {
        console.warn('[buildEnhancedSystemPromptWithTemplates] Could not parse structured_schema:', e);
      }
    }
    
    // Also extract sections from extracted_text using pattern matching
    const templateText = templateData.outputTemplate.extracted_text;
    const sectionPattern = /["']?(\d+_\d+_[a-z_]+)["']?/gi;
    let match;
    while ((match = sectionPattern.exec(templateText)) !== null) {
      if (!allRequiredSections.includes(match[1])) {
        allRequiredSections.push(match[1]);
      }
    }
    
    // Format the output template text - if it's JSON, try to pretty-print it
    let formattedTemplateText = templateData.outputTemplate.extracted_text;
    try {
      // Try to parse as JSON and pretty-print if successful
      const parsedJson = JSON.parse(templateData.outputTemplate.extracted_text);
      formattedTemplateText = JSON.stringify(parsedJson, null, 2);
    } catch (e) {
      // Not JSON, use as-is
      formattedTemplateText = templateData.outputTemplate.extracted_text;
    }
    
    enhancedPrompt += `📄 OUTPUT TEMPLATE STRUCTURE (MUST FOLLOW EXACTLY):\n`;
    enhancedPrompt += `${formattedTemplateText}\n\n`;
    
    // Add explicit list of all required sections
    if (allRequiredSections.length > 0) {
      enhancedPrompt += `\n\n🚨 CRITICAL: YOU MUST INCLUDE ALL OF THESE SECTIONS IN YOUR RESPONSE:\n`;
      allRequiredSections.forEach((section, idx) => {
        enhancedPrompt += `   ${idx + 1}. "${section}" - REQUIRED\n`;
      });
      enhancedPrompt += `\n⚠️ MISSING ANY OF THESE SECTIONS WILL RESULT IN AN INCOMPLETE RESPONSE!\n`;
      enhancedPrompt += `⚠️ YOU MUST GENERATE CONTENT FOR EACH AND EVERY SECTION LISTED ABOVE!\n\n`;
    }
    
    if (templateData.outputTemplate.structured_schema) {
      enhancedPrompt += `\n\n📊 REQUIRED OUTPUT JSON SCHEMA (MUST FOLLOW EXACTLY):\n`;
      enhancedPrompt += `This JSON schema defines the EXACT structure your response must have:\n`;
      enhancedPrompt += `${JSON.stringify(templateData.outputTemplate.structured_schema, null, 2)}\n\n`;
      enhancedPrompt += `⚠️ CRITICAL: This schema shows the STRUCTURE. You must fill each field with ACTUAL content extracted from the documents (based on INPUT TEMPLATE format).\n`;
      enhancedPrompt += `⚠️ CRITICAL: The schema above lists ${allRequiredSections.length} required sections. You MUST include ALL of them in your response.\n`;
    }
    
    if (templateData.outputTemplate.form_fields && templateData.outputTemplate.form_fields.length > 0) {
      enhancedPrompt += `\n\n📝 OUTPUT TEMPLATE FORM FIELDS STRUCTURE:\n`;
      enhancedPrompt += `${JSON.stringify(templateData.outputTemplate.form_fields, null, 2)}\n\n`;
      enhancedPrompt += `💡 INSTRUCTION: Generate form fields in this exact structure, populated with data extracted from documents.\n`;
    }
    
    if (templateData.outputTemplate.tables && templateData.outputTemplate.tables.length > 0) {
      enhancedPrompt += `\n\n📊 OUTPUT TEMPLATE TABLES STRUCTURE:\n`;
      enhancedPrompt += `${JSON.stringify(templateData.outputTemplate.tables, null, 2)}\n\n`;
      enhancedPrompt += `💡 INSTRUCTION: Generate tables in this exact structure, populated with data extracted from documents.\n`;
    }
    
    enhancedPrompt += `\n\n`;
    enhancedPrompt += `═══════════════════════════════════════════════════════════════════════\n`;
    enhancedPrompt += `🚨 CRITICAL WORKFLOW INSTRUCTIONS - READ CAREFULLY\n`;
    enhancedPrompt += `═══════════════════════════════════════════════════════════════════════\n\n`;
    
    enhancedPrompt += `📋 STEP-BY-STEP TASK WORKFLOW:\n\n`;
    enhancedPrompt += `STEP 1: UNDERSTAND THE INPUT TEMPLATE\n`;
    enhancedPrompt += `   - Review the INPUT TEMPLATE shown above to understand the format and structure of input documents\n`;
    enhancedPrompt += `   - Identify the types of information, fields, sections, and data points shown in the INPUT TEMPLATE\n`;
    enhancedPrompt += `   - Note the structure, formatting, and organization of content in the INPUT TEMPLATE\n\n`;
    
    enhancedPrompt += `STEP 2: ANALYZE THE ACTUAL DOCUMENTS\n`;
    enhancedPrompt += `   - Read through the actual documents provided to you (in the "DOCUMENT TO ANALYZE" section)\n`;
    enhancedPrompt += `   - Identify information that matches the structure and format shown in the INPUT TEMPLATE\n`;
    enhancedPrompt += `   - Extract all relevant points, fields, data, sections, and information from the documents\n`;
    enhancedPrompt += `   - Pay attention to similar patterns, structures, and content types as shown in the INPUT TEMPLATE\n\n`;
    
    enhancedPrompt += `STEP 3: UNDERSTAND THE OUTPUT TEMPLATE FORMAT\n`;
    enhancedPrompt += `   - Review the OUTPUT TEMPLATE structure shown above\n`;
    enhancedPrompt += `   - Understand the exact JSON structure you must generate\n`;
    enhancedPrompt += `   - Identify all required sections, fields, and nested structures\n`;
    enhancedPrompt += `   - Note the exact field names, nesting levels, and data types required\n\n`;
    
    enhancedPrompt += `STEP 4: MAP EXTRACTED INFORMATION TO OUTPUT FORMAT\n`;
    enhancedPrompt += `   - Take ALL the information you extracted from documents in STEP 2 (based on INPUT TEMPLATE format)\n`;
    enhancedPrompt += `   - Map each extracted data point to the corresponding fields and sections in the OUTPUT TEMPLATE (STEP 3)\n`;
    enhancedPrompt += `   - Ensure ALL extracted points from INPUT TEMPLATE are placed in the correct sections according to OUTPUT TEMPLATE structure\n`;
    enhancedPrompt += `   - Use the collected data from INPUT TEMPLATE to populate the OUTPUT TEMPLATE structure\n`;
    enhancedPrompt += `   - Maintain the exact JSON structure, field names, and nesting from the OUTPUT TEMPLATE\n`;
    enhancedPrompt += `   - DO NOT leave any fields empty - fill them with actual extracted data from the documents\n\n`;
    
    enhancedPrompt += `STEP 5: GENERATE THE FINAL RESPONSE\n`;
    enhancedPrompt += `   - Create a complete JSON response following the OUTPUT TEMPLATE structure EXACTLY\n`;
    enhancedPrompt += `   - Fill ALL fields with ACTUAL content extracted from documents (not placeholders)\n`;
    enhancedPrompt += `   - Include ALL sections and subsections from the OUTPUT TEMPLATE - DO NOT SKIP ANY\n`;
    enhancedPrompt += `   - Ensure the JSON is valid and follows the exact format shown in OUTPUT TEMPLATE\n`;
    enhancedPrompt += `   - Verify that you have included EVERY section listed in the REQUIRED SECTIONS list above\n\n`;
    
    enhancedPrompt += `⚠️ CRITICAL REQUIREMENTS:\n`;
    enhancedPrompt += `1. ✅ Extract points from documents based on INPUT TEMPLATE format/structure\n`;
    enhancedPrompt += `2. ✅ Generate response in EXACT OUTPUT TEMPLATE JSON format/structure\n`;
    enhancedPrompt += `3. ✅ Fill ALL fields with ACTUAL extracted content (not placeholder text)\n`;
    enhancedPrompt += `4. ✅ Include ALL sections from OUTPUT TEMPLATE (do not skip any) - THIS IS MANDATORY\n`;
    enhancedPrompt += `5. ✅ Maintain exact JSON structure, field names, and nesting from OUTPUT TEMPLATE\n`;
    enhancedPrompt += `6. ✅ Use actual case information, dates, names, facts, and data from documents\n`;
    enhancedPrompt += `7. ✅ Ensure JSON is valid and parseable\n`;
    enhancedPrompt += `8. ✅ Before submitting, verify you have included ALL ${allRequiredSections.length} required sections listed above\n\n`;
    
    enhancedPrompt += `📝 OUTPUT FORMAT REQUIREMENTS:\n`;
    enhancedPrompt += `- Your response MUST be valid JSON matching the OUTPUT TEMPLATE structure exactly\n`;
    enhancedPrompt += `- Wrap your JSON response in markdown code blocks: \`\`\`json ... \`\`\`\n`;
    enhancedPrompt += `- Fill in metadata fields (date, case_title, prepared_by, etc.) with actual values from documents\n`;
    enhancedPrompt += `- For each section in "generated_sections", provide:\n`;
    enhancedPrompt += `  * "generated_text": Actual comprehensive content extracted from documents (based on INPUT TEMPLATE points)\n`;
    enhancedPrompt += `  * "required_summary_type": The type specified in the OUTPUT TEMPLATE (Extractive/Abstractive/Extractive + Abstractive)\n`;
    enhancedPrompt += `- Ensure all text is meaningful, accurate, and based on document content\n\n`;
    
    enhancedPrompt += `✅ EXAMPLE OF CORRECT WORKFLOW:\n\n`;
    enhancedPrompt += `INPUT TEMPLATE shows: Complaint filing date, Plaintiff name, Defendant name, Amount claimed\n`;
    enhancedPrompt += `→ You extract from documents: "January 15, 2024", "BSNL", "India Com Limited", "₹50,00,000"\n\n`;
    enhancedPrompt += `OUTPUT TEMPLATE requires: {\n`;
    enhancedPrompt += `  "metadata": {\n`;
    enhancedPrompt += `    "date": "...",\n`;
    enhancedPrompt += `    "case_title": "...",\n`;
    enhancedPrompt += `  },\n`;
    enhancedPrompt += `  "generated_sections": {\n`;
    enhancedPrompt += `    "2_1_ground_wise_summary": {\n`;
    enhancedPrompt += `      "generated_text": "...",\n`;
    enhancedPrompt += `      "required_summary_type": "Extractive"\n`;
    enhancedPrompt += `    }\n`;
    enhancedPrompt += `  }\n`;
    enhancedPrompt += `}\n\n`;
    enhancedPrompt += `→ You generate: {\n`;
    enhancedPrompt += `  "metadata": {\n`;
    enhancedPrompt += `    "date": "January 15, 2024",\n`;
    enhancedPrompt += `    "case_title": "BSNL vs India Com Limited",\n`;
    enhancedPrompt += `  },\n`;
    enhancedPrompt += `  "generated_sections": {\n`;
    enhancedPrompt += `    "2_1_ground_wise_summary": {\n`;
    enhancedPrompt += `      "generated_text": "The plaintiff BSNL filed a complaint on January 15, 2024, alleging breach of contract by India Com Limited. The complaint seeks damages of ₹50,00,000 for losses incurred due to service disruption. Key evidence includes...",\n`;
    enhancedPrompt += `      "required_summary_type": "Extractive"\n`;
    enhancedPrompt += `    }\n`;
    enhancedPrompt += `  }\n`;
    enhancedPrompt += `}\n\n`;
    
    enhancedPrompt += `❌ WRONG (DO NOT DO THIS):\n`;
    enhancedPrompt += `- Returning just the OUTPUT TEMPLATE structure with placeholder text\n`;
    enhancedPrompt += `- Using generic text like "Summary Type: Extractive" as content\n`;
    enhancedPrompt += `- Skipping sections from OUTPUT TEMPLATE\n`;
    enhancedPrompt += `- Changing the JSON structure from OUTPUT TEMPLATE\n`;
    enhancedPrompt += `- Ignoring the INPUT TEMPLATE and not extracting relevant points\n`;
    enhancedPrompt += `- Not mapping extracted information to OUTPUT TEMPLATE format\n\n`;
    
    enhancedPrompt += `🎯 FINAL INSTRUCTION:\n`;
    enhancedPrompt += `Now analyze the provided documents and:\n`;
    enhancedPrompt += `1. Extract ALL data points mentioned in the INPUT TEMPLATE from the actual documents\n`;
    enhancedPrompt += `2. Collect and organize this extracted information according to the INPUT TEMPLATE structure\n`;
    enhancedPrompt += `3. Format the collected data into the EXACT OUTPUT TEMPLATE JSON structure shown above\n`;
    enhancedPrompt += `4. Ensure every field in the OUTPUT TEMPLATE is filled with actual extracted content (not placeholders)\n`;
    enhancedPrompt += `5. Use the INPUT TEMPLATE as your guide for WHAT to extract, and OUTPUT TEMPLATE as your guide for HOW to format\n\n`;
    enhancedPrompt += `🚨 CRITICAL REMINDER: Your response MUST include ALL ${allRequiredSections.length} sections listed above. `;
    enhancedPrompt += `An incomplete response missing any section will be considered FAILED. `;
    enhancedPrompt += `Generate comprehensive content for EACH section using the data you extracted based on the INPUT TEMPLATE format.\n`;
    enhancedPrompt += `The frontend needs this properly formatted JSON to render the document text correctly.\n`;
  }

  return enhancedPrompt;
}

async function fetchSecretManagerWithTemplates(secretId) {
  try {
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
        AND s.deleted_at IS NULL;
    `;
    
    const secretResult = await pool.query(secretQuery, [secretId]);
    
    if (secretResult.rows.length === 0) {
      return null;
    }
    
    return secretResult.rows[0];
  } catch (error) {
    console.error(`❌ [Template Service] Error fetching secret manager:`, error.message);
    throw error;
  }
}

module.exports = {
  fetchTemplateFilesData,
  buildEnhancedSystemPromptWithTemplates,
  fetchSecretManagerWithTemplates
};

