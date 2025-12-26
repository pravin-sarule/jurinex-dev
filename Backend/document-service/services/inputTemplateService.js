const InputTemplate = require('../models/InputTemplate');
const PromptExtraction = require('../models/PromptExtraction');
const { fetchTemplateFilesData } = require('./secretPromptTemplateService');
const { askLLM } = require('./aiService');
const { postProcessSecretPromptResponse } = require('../controllers/secretManagerController');

/**
 * Process input template flow:
 * 1. Fetch input template from input_templates table (get the prompt field)
 * 2. Use that prompt to extract data from document via LLM
 * 3. Store extracted data in prompt_extractions table
 * 4. Fetch stored extracted data immediately
 * 5. Apply output template to format the response based on extracted data
 * 6. Return formatted response
 */
async function processInputTemplateFlow({
  inputTemplateId,
  outputTemplateId,
  fileId,
  sessionId,
  userId,
  documentContext,
  provider = 'gemini',
  llm_name = null
}) {
  try {
    console.log(`\n📋 [InputTemplateService] Starting input template flow`);
    console.log(`   Input Template ID: ${inputTemplateId}`);
    console.log(`   Output Template ID: ${outputTemplateId || 'not set'}`);
    console.log(`   File ID: ${fileId || 'not set'}`);
    console.log(`   Session ID: ${sessionId}\n`);

    // Step 1: Fetch input template from input_templates table
    const inputTemplate = await InputTemplate.getById(inputTemplateId);
    if (!inputTemplate) {
      throw new Error(`Input template not found: ${inputTemplateId}`);
    }

    if (!inputTemplate.prompt || !inputTemplate.prompt.trim()) {
      throw new Error(`Input template prompt is empty or null: ${inputTemplateId}`);
    }

    console.log(`✅ [InputTemplateService] Fetched input template: ${inputTemplate.id}`);
    console.log(`   Prompt length: ${inputTemplate.prompt.length} chars`);

    // Step 2: Use the prompt from input_templates to extract data from document
    console.log(`\n🔍 [InputTemplateService] Step 1: Extracting data using input template prompt...`);
    
    const extractionPrompt = `${inputTemplate.prompt}

DOCUMENT TO ANALYZE:
${documentContext}

Please extract all relevant information from the document based on the instructions above. Return the extracted data in a structured format (JSON preferred).`;

    // Extract data using LLM
    const extractedDataResponse = await askLLM(
      provider,
      extractionPrompt,
      '',
      '',
      'Extract data from document'
    );

    console.log(`✅ [InputTemplateService] Data extraction completed`);
    console.log(`   Response length: ${extractedDataResponse.length} chars`);

    // Try to parse extracted data as JSON
    let extractedData = extractedDataResponse;
    try {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = extractedDataResponse.match(/```json\s*([\s\S]*?)\s*```/i);
      if (jsonMatch) {
        extractedData = JSON.parse(jsonMatch[1].trim());
      } else if (extractedDataResponse.trim().startsWith('{') || extractedDataResponse.trim().startsWith('[')) {
        extractedData = JSON.parse(extractedDataResponse.trim());
      }
    } catch (parseError) {
      console.warn(`⚠️ [InputTemplateService] Could not parse extracted data as JSON, storing as text`);
      extractedData = {
        raw_text: extractedDataResponse,
        extracted_at: new Date().toISOString()
      };
    }

    // Step 3: Store extracted data in prompt_extractions table
    console.log(`\n💾 [InputTemplateService] Step 2: Storing extracted data in prompt_extractions table...`);
    const savedExtraction = await PromptExtraction.save(
      inputTemplateId,
      fileId,
      sessionId,
      userId,
      extractedData
    );
    console.log(`✅ [InputTemplateService] Extracted data stored: ${savedExtraction.id}`);

    // Step 4: Fetch stored extracted data immediately
    console.log(`\n📥 [InputTemplateService] Step 3: Fetching stored extracted data...`);
    const storedExtraction = await PromptExtraction.getLatestBySession(sessionId);
    if (!storedExtraction) {
      throw new Error('Failed to retrieve stored extraction');
    }

    const storedDataText = typeof storedExtraction.extracted_data === 'object'
      ? JSON.stringify(storedExtraction.extracted_data, null, 2)
      : storedExtraction.extracted_data;

    console.log(`✅ [InputTemplateService] Stored data retrieved: ${storedDataText.length} chars`);

    // Step 5: Apply output template to format response based on extracted data
    console.log(`\n📤 [InputTemplateService] Step 4: Applying output template to generate formatted response...`);
    
    let templateData = { inputTemplate: null, outputTemplate: null, hasTemplates: false };
    let finalResponse = storedDataText; // Default to extracted data as response

    if (outputTemplateId) {
      // Fetch output template from template_files
      templateData = await fetchTemplateFilesData(null, outputTemplateId);
      console.log(`✅ [InputTemplateService] Output template fetched: ${templateData.hasTemplates}`);
      
      if (templateData.outputTemplate && templateData.outputTemplate.extracted_text) {
        // Build prompt to format extracted data according to output template
        const formattingPrompt = `Based on the extracted data below, generate a response formatted according to the output template structure.

EXTRACTED DATA:
${storedDataText}

OUTPUT TEMPLATE STRUCTURE (MUST FOLLOW EXACTLY):
${templateData.outputTemplate.extracted_text}

CRITICAL INSTRUCTIONS:
1. Use the extracted data above to populate the output template structure
2. Follow the exact format and structure shown in the output template
3. Ensure all fields are filled with actual data from the extracted information
4. Return the response in the exact format specified by the output template`;

        // Call LLM to format the data according to output template
        const formattedResponse = await askLLM(
          provider,
          formattingPrompt,
          '',
          '',
          'Format extracted data according to output template'
        );

        console.log(`✅ [InputTemplateService] Formatted response generated: ${formattedResponse.length} chars`);

        // Apply output template post-processing
        finalResponse = postProcessSecretPromptResponse(formattedResponse, templateData.outputTemplate);
        console.log(`✅ [InputTemplateService] Output template applied to response`);
      }
    }

    console.log(`\n✅ [InputTemplateService] Flow completed successfully\n`);

    return {
      success: true,
      response: finalResponse,
      extractedData: storedExtraction.extracted_data,
      extractionId: savedExtraction.id,
      templateData: templateData
    };

  } catch (error) {
    console.error(`❌ [InputTemplateService] Error in flow:`, error.message);
    console.error(`   Stack:`, error.stack);
    throw error;
  }
}

/**
 * Get input template by ID
 */
async function getInputTemplate(templateId) {
  return await InputTemplate.getById(templateId);
}

/**
 * Get all input templates
 */
async function getAllInputTemplates(userId = null) {
  return await InputTemplate.getAll(userId);
}

module.exports = {
  processInputTemplateFlow,
  getInputTemplate,
  getAllInputTemplates
};

