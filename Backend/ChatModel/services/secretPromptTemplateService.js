const pool = require('../config/db');

async function fetchTemplateFilesData(inputTemplateId, outputTemplateId) {
  const result = {
    inputTemplate: null,
    outputTemplate: null,
    hasTemplates: false
  };

  try {
    if (inputTemplateId) {
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
          dae.tables
        FROM template_files tf
        LEFT JOIN document_ai_extractions dae ON tf.id = dae.template_file_id
        WHERE tf.id = $1
          AND (tf.deleted_at IS NULL OR tf.deleted_at > NOW())
        ORDER BY dae.created_at DESC NULLS LAST
        LIMIT 1;
      `;
      
      const inputResult = await pool.query(inputQuery, [inputTemplateId]);
      
      if (inputResult.rows.length > 0) {
        const row = inputResult.rows[0];
        result.inputTemplate = {
          id: row.id,
          filename: row.filename,
          file_type: row.file_type,
          extracted_text: row.extracted_text || row.ai_extracted_text || '',
          structured_schema: row.structured_schema || null,
          entities: row.entities || null,
          form_fields: row.form_fields || null,
          tables: row.tables || null
        };
        result.hasTemplates = true;
        console.log(`✅ [ChatModel Template Service] Input template found: ${row.filename}`);
      } else {
        console.warn(`⚠️ [ChatModel Template Service] Input template file not found: ${inputTemplateId}`);
      }
    }

    if (outputTemplateId) {
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
          dae.tables
        FROM template_files tf
        LEFT JOIN document_ai_extractions dae ON tf.id = dae.template_file_id
        WHERE tf.id = $1
          AND (tf.deleted_at IS NULL OR tf.deleted_at > NOW())
        ORDER BY dae.created_at DESC NULLS LAST
        LIMIT 1;
      `;
      
      const outputResult = await pool.query(outputQuery, [outputTemplateId]);
      
      if (outputResult.rows.length > 0) {
        const row = outputResult.rows[0];
        result.outputTemplate = {
          id: row.id,
          filename: row.filename,
          file_type: row.file_type,
          extracted_text: row.extracted_text || row.ai_extracted_text || '',
          structured_schema: row.structured_schema || null,
          entities: row.entities || null,
          form_fields: row.form_fields || null,
          tables: row.tables || null
        };
        result.hasTemplates = true;
        console.log(`✅ [ChatModel Template Service] Output template found: ${row.filename}`);
      } else {
        console.warn(`⚠️ [ChatModel Template Service] Output template file not found: ${outputTemplateId}`);
      }
    }

    return result;
  } catch (error) {
    console.error(`❌ [ChatModel Template Service] Error fetching template files:`, error.message);
    console.error(`   Stack:`, error.stack);
    return result;
  }
}

function buildEnhancedSystemPromptWithTemplates(secretPrompt, templateData) {
  let enhancedPrompt = secretPrompt;

  if (templateData.inputTemplate && templateData.inputTemplate.extracted_text) {
    enhancedPrompt += `\n\n=== INPUT TEMPLATE EXAMPLE ===\n`;
    enhancedPrompt += `Filename: ${templateData.inputTemplate.filename}\n`;
    enhancedPrompt += `File Type: ${templateData.inputTemplate.file_type || 'input'}\n\n`;
    enhancedPrompt += `Extracted Text:\n${templateData.inputTemplate.extracted_text}`;
    
    if (templateData.inputTemplate.structured_schema) {
      enhancedPrompt += `\n\nStructured Schema:\n${JSON.stringify(templateData.inputTemplate.structured_schema, null, 2)}`;
    }
    
    if (templateData.inputTemplate.form_fields && templateData.inputTemplate.form_fields.length > 0) {
      enhancedPrompt += `\n\nForm Fields:\n${JSON.stringify(templateData.inputTemplate.form_fields, null, 2)}`;
    }
    
    if (templateData.inputTemplate.tables && templateData.inputTemplate.tables.length > 0) {
      enhancedPrompt += `\n\nTables:\n${JSON.stringify(templateData.inputTemplate.tables, null, 2)}`;
    }
  }

  if (templateData.outputTemplate && templateData.outputTemplate.extracted_text) {
    enhancedPrompt += `\n\n=== OUTPUT TEMPLATE EXAMPLE (STRUCTURE TO FOLLOW) ===\n`;
    enhancedPrompt += `Filename: ${templateData.outputTemplate.filename}\n`;
    enhancedPrompt += `File Type: ${templateData.outputTemplate.file_type || 'output'}\n\n`;
    enhancedPrompt += `This shows the EXACT JSON structure and format you must use for your response.\n`;
    enhancedPrompt += `NOTE: The example below shows the STRUCTURE - you must fill it with ACTUAL content from the documents.\n\n`;
    enhancedPrompt += `Template Structure:\n${templateData.outputTemplate.extracted_text}`;
    
    if (templateData.outputTemplate.structured_schema) {
      enhancedPrompt += `\n\n=== REQUIRED OUTPUT SCHEMA (MUST FOLLOW EXACTLY) ===\n`;
      enhancedPrompt += `This JSON schema defines the exact structure your response must have:\n`;
      enhancedPrompt += `${JSON.stringify(templateData.outputTemplate.structured_schema, null, 2)}\n\n`;
      enhancedPrompt += `⚠️ CRITICAL: This schema shows the STRUCTURE. You must fill each field with ACTUAL content extracted from the documents.\n`;
    }
    
    if (templateData.outputTemplate.form_fields && templateData.outputTemplate.form_fields.length > 0) {
      enhancedPrompt += `\n\nForm Fields Structure:\n${JSON.stringify(templateData.outputTemplate.form_fields, null, 2)}`;
    }
    
    if (templateData.outputTemplate.tables && templateData.outputTemplate.tables.length > 0) {
      enhancedPrompt += `\n\nTables Structure:\n${JSON.stringify(templateData.outputTemplate.tables, null, 2)}`;
    }
    
    enhancedPrompt += `\n\n=== CRITICAL INSTRUCTIONS FOR OUTPUT GENERATION ===\n`;
    enhancedPrompt += `\n📋 YOUR TASK:\n`;
    enhancedPrompt += `1. Analyze the provided documents (from INPUT TEMPLATE EXAMPLE format)\n`;
    enhancedPrompt += `2. Extract ALL relevant information from the documents\n`;
    enhancedPrompt += `3. Generate a COMPLETE response following the EXACT structure shown in OUTPUT TEMPLATE EXAMPLE\n`;
    enhancedPrompt += `4. Fill in ALL fields with ACTUAL content extracted from the documents\n`;
    enhancedPrompt += `5. DO NOT just repeat the schema structure - you must generate REAL content\n\n`;
    
    enhancedPrompt += `⚠️ IMPORTANT REQUIREMENTS:\n`;
    enhancedPrompt += `- The OUTPUT TEMPLATE EXAMPLE shows the STRUCTURE and FORMAT you must follow\n`;
    enhancedPrompt += `- You must extract actual data from the documents and populate each field\n`;
    enhancedPrompt += `- For "generated_text" fields, provide comprehensive summaries based on document content\n`;
    enhancedPrompt += `- For "required_summary_type", use the same values as shown in the template\n`;
    enhancedPrompt += `- Maintain the exact JSON structure and nesting shown in the output template\n`;
    enhancedPrompt += `- Include all sections and subsections from the output template\n`;
    enhancedPrompt += `- Use actual case information, dates, names, and facts from the documents\n`;
    enhancedPrompt += `- Do NOT use placeholder text like "Summary Type: Extractive" - provide actual summaries\n\n`;
    
    enhancedPrompt += `📝 OUTPUT FORMAT:\n`;
    enhancedPrompt += `- Your response MUST be valid JSON matching the output template structure\n`;
    enhancedPrompt += `- Fill in metadata fields (date, case_title, prepared_by) with actual values\n`;
    enhancedPrompt += `- For each section in "generated_sections", provide:\n`;
    enhancedPrompt += `  * "generated_text": Actual comprehensive summary/content extracted from documents\n`;
    enhancedPrompt += `  * "required_summary_type": The type specified in the template (Extractive/Abstractive/Extractive + Abstractive)\n`;
    enhancedPrompt += `- Ensure all text is meaningful and based on document content, not generic placeholders\n\n`;
    
    enhancedPrompt += `✅ EXAMPLE OF CORRECT OUTPUT:\n`;
    enhancedPrompt += `\n❌ WRONG (DO NOT DO THIS):\n`;
    enhancedPrompt += `"generated_text": "Summary Type: Extractive"\n`;
    enhancedPrompt += `"required_summary_type": "Extractive"\n\n`;
    enhancedPrompt += `✅ CORRECT (DO THIS):\n`;
    enhancedPrompt += `"generated_text": "The plaintiff, BSNL, filed a complaint on January 15, 2024, alleging breach of contract by India Com Limited. The complaint states that India Com Limited failed to deliver services as per the agreement dated March 10, 2023. Key evidence includes email correspondence from April 2023 showing delivery delays, and the original service agreement document. The plaintiff seeks damages of ₹50,00,000 for losses incurred due to service disruption."\n`;
    enhancedPrompt += `"required_summary_type": "Extractive"\n\n`;
    enhancedPrompt += `The "generated_text" must contain ACTUAL extracted content from the documents, not just the summary type label.\n\n`;
    
    enhancedPrompt += `🚫 WHAT NOT TO DO:\n`;
    enhancedPrompt += `- Do NOT return just the schema structure with placeholder text\n`;
    enhancedPrompt += `- Do NOT use generic text like "Summary Type: Extractive" as content\n`;
    enhancedPrompt += `- Do NOT skip sections - fill in ALL fields from the output template\n`;
    enhancedPrompt += `- Do NOT change the JSON structure - follow it exactly\n\n`;
    
    enhancedPrompt += `🎯 START GENERATING:\n`;
    enhancedPrompt += `Now analyze the provided documents and generate a complete response following the output template structure with actual extracted content.`;
  }

  return enhancedPrompt;
}

module.exports = {
  fetchTemplateFilesData,
  buildEnhancedSystemPromptWithTemplates
};










