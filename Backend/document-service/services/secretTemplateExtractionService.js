// const pool = require('../config/db');
// const PromptExtraction = require('../models/PromptExtraction');
// const { askLLM } = require('./aiService');
// const { postProcessSecretPromptResponse } = require('../controllers/secretManagerController');

// /**
//  * Process secret prompt with input/output templates:
//  * 1. If input_template_id exists, fetch input template JSON from document_ai_extractions
//  * 2. Use input template JSON structure to extract data from document via LLM
//  * 3. Store LLM-generated extracted data in prompt_extractions table (NOT input_templates)
//  * 4. Fetch stored LLM-generated extracted data immediately
//  * 5. If output_template_id exists, fetch output template JSON and use it to format final response
//  */
// async function processSecretPromptWithTemplates({
//   secretPrompt,
//   inputTemplateId,
//   outputTemplateId,
//   fileId,
//   sessionId,
//   userId,
//   documentContext,
//   provider = 'gemini'
// }) {
//   try {
//     console.log(`\n📋 [SecretTemplateExtraction] Processing secret prompt with templates`);
//     console.log(`   Input Template ID: ${inputTemplateId || 'not set'}`);
//     console.log(`   Output Template ID: ${outputTemplateId || 'not set'}`);
//     console.log(`   File ID: ${fileId || 'not set'}`);
//     console.log(`   Session ID: ${sessionId}\n`);

//     let extractedData = null;
//     let storedExtraction = null;

//     // Step 1: If input_template_id exists, fetch input template JSON from document_ai_extractions
//     if (inputTemplateId) {
//       console.log(`\n🔍 [SecretTemplateExtraction] Step 1: Fetching input template JSON from document_ai_extractions...`);
      
//       const inputTemplateQuery = `
//         SELECT 
//           dae.extracted_text,
//           dae.structured_schema,
//           dae.entities,
//           dae.form_fields,
//           dae.tables
//         FROM document_ai_extractions dae
//         WHERE dae.template_file_id = $1
//           AND (dae.structured_schema IS NOT NULL OR dae.extracted_text IS NOT NULL)
//           AND (dae.deleted_at IS NULL OR dae.deleted_at > NOW())
//         ORDER BY dae.created_at DESC
//         LIMIT 1;
//       `;
      
//       const inputTemplateResult = await pool.query(inputTemplateQuery, [inputTemplateId]);
      
//       if (inputTemplateResult.rows.length > 0) {
//         const inputTemplateExtractedText = inputTemplateResult.rows[0].extracted_text;
//         const inputTemplateStructuredSchema = inputTemplateResult.rows[0].structured_schema;
        
//         // Prioritize structured_schema for input template structure, fallback to extracted_text
//         let inputTemplateJson = null;
//         let inputTemplateStructure = null;
        
//         if (inputTemplateStructuredSchema) {
//           console.log(`✅ [SecretTemplateExtraction] Input template structured_schema found`);
//           inputTemplateStructure = typeof inputTemplateStructuredSchema === 'string'
//             ? JSON.parse(inputTemplateStructuredSchema)
//             : inputTemplateStructuredSchema;
          
//           // Use structured_schema as the primary template structure
//           inputTemplateJson = JSON.stringify(inputTemplateStructure, null, 2);
//           console.log(`✅ [SecretTemplateExtraction] Using structured_schema for input template structure`);
//         } else if (inputTemplateExtractedText) {
//           console.log(`⚠️ [SecretTemplateExtraction] Using extracted_text as fallback for input template (${inputTemplateExtractedText.length} chars)`);
//           inputTemplateJson = inputTemplateExtractedText;
//         }
        
//         if (inputTemplateJson) {
//           console.log(`✅ [SecretTemplateExtraction] Input template JSON fetched: ${inputTemplateJson.length} chars`);
//           console.log(`\n📄 [SecretTemplateExtraction] INPUT TEMPLATE JSON STRUCTURE:\n${inputTemplateJson}\n`);
//         }

//         // Step 2: Use input template JSON structure to extract data from document
//         console.log(`\n🔍 [SecretTemplateExtraction] Step 2: Extracting data using input template JSON structure...`);
        
//         let extractionPrompt = `${secretPrompt}

// ═══════════════════════════════════════════════════════════════════════
// 📥 INPUT TEMPLATE STRUCTURE (Extract data matching this EXACT format)
// ═══════════════════════════════════════════════════════════════════════
// The structure below shows the EXACT format you must use when extracting data from the document.
// You MUST extract all information that matches this structure and return it in the SAME JSON format.

// INPUT TEMPLATE STRUCTURE:
// ${inputTemplateJson}

// DOCUMENT TO ANALYZE:
// ${documentContext}

// CRITICAL INSTRUCTIONS:
// 1. Extract ALL relevant information from the document that matches the INPUT TEMPLATE structure above
// 2. Return the extracted data in the EXACT same JSON structure as the input template
// 3. Fill in all fields with actual data from the document
// 4. Maintain the exact same field names, nesting, and structure as shown in INPUT TEMPLATE
// 5. If a field in the template doesn't have corresponding data in the document, leave it empty or use null
// 6. Return ONLY valid JSON matching the INPUT TEMPLATE structure exactly`;

//         // Add structured_schema details if available
//         if (inputTemplateStructure && inputTemplateStructure.properties) {
//           extractionPrompt += `\n\n📊 INPUT TEMPLATE JSON SCHEMA (MUST FOLLOW EXACTLY):\n`;
//           extractionPrompt += `This JSON schema defines the EXACT structure your extracted data must have:\n`;
//           extractionPrompt += `${JSON.stringify(inputTemplateStructure, null, 2)}\n\n`;
//           extractionPrompt += `⚠️ CRITICAL: Extract data from the document and format it according to this schema structure.\n`;
          
//           // Extract required sections/fields from schema
//           if (inputTemplateStructure.properties) {
//             const requiredFields = Object.keys(inputTemplateStructure.properties);
//             if (requiredFields.length > 0) {
//               extractionPrompt += `\n🚨 REQUIRED FIELDS/SECTIONS TO EXTRACT:\n`;
//               requiredFields.forEach((field, idx) => {
//                 extractionPrompt += `   ${idx + 1}. "${field}" - REQUIRED\n`;
//               });
//               extractionPrompt += `\n⚠️ You MUST extract and include ALL of these fields/sections in your response!\n\n`;
//             }
//           }
//         }

//         // Extract data using LLM
//         const extractedDataResponse = await askLLM(
//           provider,
//           extractionPrompt,
//           '',
//           '',
//           'Extract data using input template structure'
//         );

//         console.log(`✅ [SecretTemplateExtraction] Data extraction completed`);
//         console.log(`   Response length: ${extractedDataResponse.length} chars`);

//         // Try to parse extracted data as JSON
//         try {
//           // Try to extract JSON from markdown code blocks
//           const jsonMatch = extractedDataResponse.match(/```json\s*([\s\S]*?)\s*```/i);
//           if (jsonMatch) {
//             extractedData = JSON.parse(jsonMatch[1].trim());
//           } else if (extractedDataResponse.trim().startsWith('{') || extractedDataResponse.trim().startsWith('[')) {
//             extractedData = JSON.parse(extractedDataResponse.trim());
//           } else {
//             extractedData = extractedDataResponse;
//           }
          
//           // Validate and enhance extracted data to match input template structure
//           if (extractedData && typeof extractedData === 'object' && inputTemplateStructure) {
//             console.log(`\n🔍 [SecretTemplateExtraction] Validating extracted data against input template structure...`);
            
//             // If input template has a schema, ensure extracted data matches it
//             if (inputTemplateStructure.properties) {
//               const requiredFields = Object.keys(inputTemplateStructure.properties);
//               const extractedFields = Object.keys(extractedData);
              
//               console.log(`   Required fields from schema: ${requiredFields.length}`);
//               console.log(`   Extracted fields: ${extractedFields.length}`);
              
//               // Check for missing required fields
//               const missingFields = requiredFields.filter(field => !extractedFields.includes(field));
//               if (missingFields.length > 0) {
//                 console.warn(`⚠️ [SecretTemplateExtraction] Missing ${missingFields.length} required fields: ${missingFields.join(', ')}`);
                
//                 // Add missing fields with null/empty values based on schema
//                 missingFields.forEach(field => {
//                   const fieldSchema = inputTemplateStructure.properties[field];
//                   if (fieldSchema.type === 'object' && fieldSchema.properties) {
//                     extractedData[field] = {};
//                   } else if (fieldSchema.type === 'array') {
//                     extractedData[field] = [];
//                   } else {
//                     extractedData[field] = fieldSchema.default !== undefined ? fieldSchema.default : null;
//                   }
//                 });
//                 console.log(`✅ [SecretTemplateExtraction] Added missing fields to match input template structure`);
//               }
              
//               // Log extra fields that aren't in the schema
//               const extraFields = extractedFields.filter(field => !requiredFields.includes(field));
//               if (extraFields.length > 0) {
//                 console.log(`ℹ️ [SecretTemplateExtraction] Found ${extraFields.length} extra fields not in schema: ${extraFields.join(', ')}`);
//               }
//             }
            
//             console.log(`✅ [SecretTemplateExtraction] Extracted data validated against input template structure`);
//           }
//         } catch (parseError) {
//           console.warn(`⚠️ [SecretTemplateExtraction] Could not parse extracted data as JSON, storing as text`);
//           extractedData = extractedDataResponse;
//         }

//         // Step 3: Store LLM-generated extracted data in prompt_extractions table
//         console.log(`\n💾 [SecretTemplateExtraction] Step 3: Storing LLM-generated extracted data in prompt_extractions table...`);
        
//         try {
//           const savedExtraction = await PromptExtraction.save(
//             inputTemplateId,
//             fileId,
//             sessionId,
//             userId,
//             extractedData
//           );
//           console.log(`✅ [SecretTemplateExtraction] Extracted data stored in prompt_extractions: ${savedExtraction.id}`);

//           // Step 4: Fetch stored LLM-generated extracted data immediately
//           console.log(`\n📥 [SecretTemplateExtraction] Step 4: Fetching stored LLM-generated extracted data...`);
//           storedExtraction = await PromptExtraction.getLatestBySession(sessionId);
//           if (storedExtraction && storedExtraction.extracted_data) {
//             extractedData = storedExtraction.extracted_data;
//             console.log(`✅ [SecretTemplateExtraction] Stored extracted data retrieved`);
//             const extractedDataText = typeof extractedData === 'object' 
//               ? JSON.stringify(extractedData, null, 2)
//               : extractedData;
//             console.log(`   Data length: ${extractedDataText.length} chars`);
//           } else {
//             console.warn(`⚠️ [SecretTemplateExtraction] Could not retrieve stored extraction, using original extracted data`);
//           }
//         } catch (storageError) {
//           console.warn(`⚠️ [SecretTemplateExtraction] Could not store extraction (continuing with original data):`, storageError.message);
//           // Continue with the original extractedData - don't fail the entire flow
//         }
//       } else {
//         console.warn(`⚠️ [SecretTemplateExtraction] No input template JSON found in document_ai_extractions for template_file_id: ${inputTemplateId}`);
//       }
//     }

//     // Step 5: Generate response using output template if available
//     console.log(`\n📤 [SecretTemplateExtraction] Step 5: Generating response...`);
    
//     let finalResponse = '';
//     let outputTemplateJson = null;
//     let outputTemplateStructuredSchema = null;
//     let outputTemplateExampleStructure = null; // Example structure built from schema
    
//     if (outputTemplateId) {
//       // Fetch output template JSON from document_ai_extractions
//       // Prioritize structured_schema over extracted_text for JSON structure
//       const outputTemplateQuery = `
//         SELECT 
//           dae.extracted_text,
//           dae.structured_schema
//         FROM document_ai_extractions dae
//         WHERE dae.template_file_id = $1
//           AND (dae.structured_schema IS NOT NULL OR dae.extracted_text IS NOT NULL)
//           AND (dae.deleted_at IS NULL OR dae.deleted_at > NOW())
//         ORDER BY dae.created_at DESC
//         LIMIT 1;
//       `;
      
//       const outputTemplateResult = await pool.query(outputTemplateQuery, [outputTemplateId]);
      
//       if (outputTemplateResult.rows.length > 0) {
//         outputTemplateStructuredSchema = outputTemplateResult.rows[0].structured_schema;
//         const extractedText = outputTemplateResult.rows[0].extracted_text;
        
//         console.log(`✅ [SecretTemplateExtraction] Output template fetched from document_ai_extractions`);
//         console.log(`   Has structured_schema: ${!!outputTemplateStructuredSchema}`);
//         console.log(`   Has extracted_text: ${!!extractedText}`);
        
//         // Prioritize structured_schema for JSON structure, fallback to extracted_text if it's valid JSON
//         if (outputTemplateStructuredSchema) {
//           console.log(`✅ [SecretTemplateExtraction] Output template structured_schema found`);
          
//           // Parse structured_schema to extract the actual template structure
//           try {
//             const schemaObj = typeof outputTemplateStructuredSchema === 'string'
//               ? JSON.parse(outputTemplateStructuredSchema)
//               : outputTemplateStructuredSchema;
            
//             // Extract the actual template structure from schema (like schemas.input_form_data or schemas.output_summary_template)
//             if (schemaObj.schemas) {
//               // Check for input_form_data structure (like user's example)
//               if (schemaObj.schemas.input_form_data) {
//                 outputTemplateExampleStructure = schemaObj.schemas.input_form_data;
//                 outputTemplateJson = JSON.stringify(outputTemplateExampleStructure, null, 2);
//                 console.log(`✅ [SecretTemplateExtraction] Using schemas.input_form_data structure from schema`);
//               }
//               // Check for output_summary_template structure
//               else if (schemaObj.schemas.output_summary_template) {
//                 outputTemplateExampleStructure = schemaObj.schemas.output_summary_template;
//                 outputTemplateJson = JSON.stringify(outputTemplateExampleStructure, null, 2);
//                 console.log(`✅ [SecretTemplateExtraction] Using schemas.output_summary_template structure from schema`);
//               }
//               // Use the full schemas object
//               else {
//                 outputTemplateExampleStructure = schemaObj.schemas;
//                 outputTemplateJson = JSON.stringify(outputTemplateExampleStructure, null, 2);
//                 console.log(`✅ [SecretTemplateExtraction] Using full schemas structure from schema`);
//               }
//             } else {
//               // Use structured_schema as-is if it doesn't have schemas wrapper
//               outputTemplateExampleStructure = schemaObj;
//               outputTemplateJson = JSON.stringify(outputTemplateExampleStructure, null, 2);
//               console.log(`✅ [SecretTemplateExtraction] Using structured_schema directly`);
//             }
//           } catch (parseError) {
//             console.warn(`⚠️ [SecretTemplateExtraction] Could not parse structured_schema:`, parseError.message);
//             outputTemplateJson = typeof outputTemplateStructuredSchema === 'string' 
//               ? outputTemplateStructuredSchema 
//               : JSON.stringify(outputTemplateStructuredSchema);
//           }
//         } else if (extractedText) {
//           // Try to use extracted_text if structured_schema is not available
//           console.log(`⚠️ [SecretTemplateExtraction] Using extracted_text as fallback (${extractedText.length} chars)`);
//           outputTemplateJson = extractedText;
          
//           // Try to parse it as JSON
//           try {
//             outputTemplateExampleStructure = JSON.parse(extractedText);
//           } catch (e) {
//             // Not JSON, use as-is
//           }
//         }
        
//         if (outputTemplateJson) {
//           console.log(`✅ [SecretTemplateExtraction] Output template JSON fetched: ${outputTemplateJson.length} chars`);
//           console.log(`\n📄 [SecretTemplateExtraction] OUTPUT TEMPLATE JSON STRUCTURE (fetched from DB):\n${outputTemplateJson}\n`);
//         }
        
//         if (outputTemplateExampleStructure) {
//           console.log(`✅ [SecretTemplateExtraction] Output template example structure built`);
//           console.log(`\n📊 [SecretTemplateExtraction] OUTPUT TEMPLATE EXAMPLE STRUCTURE:\n${JSON.stringify(outputTemplateExampleStructure, null, 2)}\n`);
//         }
//       } else {
//         console.warn(`⚠️ [SecretTemplateExtraction] No output template found in document_ai_extractions for template_file_id: ${outputTemplateId}`);
//       }
//     }

//     // Build prompt for LLM response generation
//     let responsePrompt = secretPrompt;
    
//     // Use stored extracted data from input template as context for output template response
//     if (extractedData) {
//       const extractedDataText = typeof extractedData === 'object' 
//         ? JSON.stringify(extractedData, null, 2)
//         : extractedData;
      
//       console.log(`\n📋 [SecretTemplateExtraction] Using stored extracted data from input template as context`);
//       console.log(`   Extracted data length: ${extractedDataText.length} chars`);
      
//       responsePrompt += `\n\n`;
//       responsePrompt += `═══════════════════════════════════════════════════════════════════════\n`;
//       responsePrompt += `📥 EXTRACTED DATA FROM INPUT TEMPLATE (USE THIS AS CONTEXT)\n`;
//       responsePrompt += `═══════════════════════════════════════════════════════════════════════\n`;
//       responsePrompt += `The data below was extracted from the document using the INPUT TEMPLATE structure.\n`;
//       responsePrompt += `This extracted data contains all the relevant information you need to generate your response.\n`;
//       responsePrompt += `USE THIS EXTRACTED DATA as the source of information when filling the OUTPUT TEMPLATE structure.\n\n`;
//       responsePrompt += `EXTRACTED DATA:\n${extractedDataText}\n\n`;
//     } else {
//       console.log(`\n⚠️ [SecretTemplateExtraction] No extracted data available, using original document context`);
//       responsePrompt += `\n\nDOCUMENT TO ANALYZE:
// ${documentContext}`;
//     }

//     if (outputTemplateJson || outputTemplateStructuredSchema) {
//       // Parse output template JSON to extract structure details
//       // Prioritize structured_schema as it contains the actual JSON schema
//       let outputTemplateObj = null;
//       let allRequiredSections = [];
      
//       // Helper function to safely parse JSON from text
//       const safeParseJson = (text) => {
//         if (!text || typeof text !== 'string') return null;
        
//         // Try direct JSON parse
//         try {
//           return JSON.parse(text);
//         } catch (e) {
//           // Try extracting JSON from markdown code blocks
//           const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/i) || 
//                            text.match(/```\s*([\s\S]*?)\s*```/i);
//           if (jsonMatch) {
//             try {
//               return JSON.parse(jsonMatch[1].trim());
//             } catch (e2) {
//               // Ignore
//             }
//           }
          
//           // Try if it starts with { or [
//           if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
//             try {
//               return JSON.parse(text.trim());
//             } catch (e3) {
//               // Ignore
//             }
//           }
//         }
//         return null;
//       };
      
//       // Helper function to build example structure from JSON schema
//       const buildExampleFromSchema = (schema) => {
//         if (!schema || typeof schema !== 'object') return null;
        
//         // If schema has schemas.input_form_data structure (like user's example)
//         if (schema.schemas && schema.schemas.input_form_data) {
//           return schema.schemas.input_form_data;
//         }
        
//         // If schema has schemas.output_summary_template structure
//         if (schema.schemas && schema.schemas.output_summary_template) {
//           return schema.schemas.output_summary_template;
//         }
        
//         // If it's a JSON schema with properties, build example from it
//         if (schema.properties) {
//           const example = {};
//           for (const key in schema.properties) {
//             const prop = schema.properties[key];
//             if (prop.type === 'object' && prop.properties) {
//               example[key] = buildExampleFromSchema(prop);
//             } else if (prop.type === 'array' && prop.items) {
//               example[key] = prop.items.properties ? [buildExampleFromSchema(prop.items)] : [];
//             } else {
//               // Use default value if available, otherwise use empty string or null
//               example[key] = prop.default !== undefined ? prop.default : (prop.type === 'string' ? '' : null);
//             }
//           }
//           return example;
//         }
        
//         return schema;
//       };
      
//       try {
//         // Prioritize structured_schema - it contains the actual JSON schema
//         if (outputTemplateStructuredSchema) {
//           const schemaObj = typeof outputTemplateStructuredSchema === 'string'
//             ? safeParseJson(outputTemplateStructuredSchema)
//             : outputTemplateStructuredSchema;
          
//           if (schemaObj) {
//             console.log(`✅ [SecretTemplateExtraction] Parsed structured_schema as template structure`);
            
//             // Build example structure from schema
//             outputTemplateExampleStructure = buildExampleFromSchema(schemaObj);
//             outputTemplateObj = schemaObj; // Keep original schema for reference
            
//             if (outputTemplateExampleStructure) {
//               console.log(`✅ [SecretTemplateExtraction] Built example structure from schema`);
//             }
//           }
//         }
        
//         // Fallback to outputTemplateJson if structured_schema parsing failed
//         if (!outputTemplateObj && outputTemplateJson) {
//           if (typeof outputTemplateJson === 'string') {
//             outputTemplateObj = safeParseJson(outputTemplateJson);
//           } else {
//             outputTemplateObj = outputTemplateJson;
//           }
          
//           if (outputTemplateObj) {
//             console.log(`✅ [SecretTemplateExtraction] Parsed extracted_text as template structure`);
//             if (!outputTemplateExampleStructure) {
//               outputTemplateExampleStructure = outputTemplateObj;
//             }
//           }
//         }
        
//         // Extract required sections from the JSON structure
//         if (outputTemplateExampleStructure && typeof outputTemplateExampleStructure === 'object') {
//           // Check for nested structure (schemas.output_summary_template.generated_sections)
//           if (outputTemplateExampleStructure.schemas && outputTemplateExampleStructure.schemas.output_summary_template && 
//               outputTemplateExampleStructure.schemas.output_summary_template.generated_sections) {
//             allRequiredSections = Object.keys(outputTemplateExampleStructure.schemas.output_summary_template.generated_sections);
//           } 
//           // Check for direct structure (generated_sections)
//           else if (outputTemplateExampleStructure.generated_sections && typeof outputTemplateExampleStructure.generated_sections === 'object') {
//             allRequiredSections = Object.keys(outputTemplateExampleStructure.generated_sections);
//           }
//           // Check for analytical_sections (like in user's example)
//           else if (outputTemplateExampleStructure.analytical_sections && typeof outputTemplateExampleStructure.analytical_sections === 'object') {
//             allRequiredSections = Object.keys(outputTemplateExampleStructure.analytical_sections);
//           }
//           // Recursively find generated_sections or analytical_sections
//           else {
//             const findSections = (obj) => {
//               if (typeof obj !== 'object' || obj === null) return null;
//               for (const key in obj) {
//                 if ((key === 'generated_sections' || key === 'analytical_sections') && typeof obj[key] === 'object') {
//                   return Object.keys(obj[key]);
//                 }
//                 const result = findSections(obj[key]);
//                 if (result) return result;
//               }
//               return null;
//             };
//             const found = findSections(outputTemplateExampleStructure);
//             if (found) allRequiredSections = found;
//           }
          
//           if (allRequiredSections.length > 0) {
//             console.log(`✅ [SecretTemplateExtraction] Found ${allRequiredSections.length} required sections: ${allRequiredSections.join(', ')}`);
//           }
//         }
//       } catch (e) {
//         console.warn('[SecretTemplateExtraction] Could not parse output template JSON:', e.message);
//         if (outputTemplateJson && typeof outputTemplateJson === 'string') {
//           console.warn('[SecretTemplateExtraction] Template text preview:', outputTemplateJson.substring(0, 100));
//         }
//       }
      
//       responsePrompt += `\n\n`;
//       responsePrompt += `═══════════════════════════════════════════════════════════════════════\n`;
//       responsePrompt += `🚨 CRITICAL: YOU MUST COPY THE EXACT JSON STRUCTURE BELOW\n`;
//       responsePrompt += `═══════════════════════════════════════════════════════════════════════\n\n`;
//       responsePrompt += `⚠️ MANDATORY INSTRUCTION: The OUTPUT TEMPLATE JSON below is the EXACT structure you MUST return.\n`;
//       responsePrompt += `⚠️ DO NOT create your own format. DO NOT modify the structure. DO NOT add or remove fields.\n`;
//       responsePrompt += `⚠️ COPY the entire JSON structure below and ONLY replace placeholder values with actual data from EXTRACTED DATA.\n\n`;
      
//       responsePrompt += `📄 OUTPUT TEMPLATE JSON STRUCTURE (COPY THIS EXACT STRUCTURE):\n`;
      
//       // Format the output template - use example structure built from schema
//       let formattedTemplateText = '';
//       try {
//         // Use example structure built from schema if available (this is the actual template structure)
//         if (outputTemplateExampleStructure) {
//           formattedTemplateText = JSON.stringify(outputTemplateExampleStructure, null, 2);
//           console.log(`✅ [SecretTemplateExtraction] Using example structure built from schema`);
//           console.log(`\n📊 [SecretTemplateExtraction] OUTPUT TEMPLATE EXAMPLE STRUCTURE (being sent to LLM):\n${formattedTemplateText}\n`);
//         }
//         // Fallback to structured_schema if example structure not available
//         else if (outputTemplateStructuredSchema) {
//           const schemaObj = typeof outputTemplateStructuredSchema === 'string'
//             ? JSON.parse(outputTemplateStructuredSchema)
//             : outputTemplateStructuredSchema;
          
//           // Try to extract the actual structure from schema
//           if (schemaObj.schemas) {
//             if (schemaObj.schemas.input_form_data) {
//               formattedTemplateText = JSON.stringify(schemaObj.schemas.input_form_data, null, 2);
//             } else if (schemaObj.schemas.output_summary_template) {
//               formattedTemplateText = JSON.stringify(schemaObj.schemas.output_summary_template, null, 2);
//             } else {
//               formattedTemplateText = JSON.stringify(schemaObj.schemas, null, 2);
//             }
//           } else {
//             formattedTemplateText = JSON.stringify(schemaObj, null, 2);
//           }
          
//           console.log(`✅ [SecretTemplateExtraction] Using structured_schema directly for template structure`);
//           console.log(`\n📊 [SecretTemplateExtraction] OUTPUT TEMPLATE STRUCTURED SCHEMA (being sent to LLM):\n${formattedTemplateText}\n`);
//         } 
//         // Fallback to outputTemplateJson if it's valid JSON
//         else if (outputTemplateJson) {
//           const parsedJson = typeof outputTemplateJson === 'string' 
//             ? JSON.parse(outputTemplateJson) 
//             : outputTemplateJson;
//           formattedTemplateText = JSON.stringify(parsedJson, null, 2);
//           console.log(`✅ [SecretTemplateExtraction] Using extracted_text for template structure`);
//           console.log(`\n📄 [SecretTemplateExtraction] OUTPUT TEMPLATE JSON (being sent to LLM):\n${formattedTemplateText}\n`);
//         }
//       } catch (e) {
//         console.warn('[SecretTemplateExtraction] Could not format template text:', e);
//         formattedTemplateText = outputTemplateJson || JSON.stringify(outputTemplateStructuredSchema, null, 2);
//         console.log(`\n⚠️ [SecretTemplateExtraction] OUTPUT TEMPLATE (raw, unformatted):\n${formattedTemplateText}\n`);
//       }
      
//       responsePrompt += `${formattedTemplateText}\n\n`;
      
//       // Add very explicit instruction to return ONLY JSON matching this exact structure
//       responsePrompt += `\n🚨 ABSOLUTE REQUIREMENT: Your response MUST be valid JSON that matches the EXACT structure shown above.\n`;
//       responsePrompt += `🚨 DO NOT write a summary, description, or explanation.\n`;
//       responsePrompt += `🚨 DO NOT start with "Pravin, here is..." or any other text.\n`;
//       responsePrompt += `🚨 START your response DIRECTLY with the JSON structure matching the template above.\n`;
//       responsePrompt += `🚨 Wrap it in markdown code blocks: \`\`\`json ... \`\`\`\n\n`;
      
//       responsePrompt += `\n🚨 CRITICAL: Your response MUST be the EXACT same JSON structure as shown above.\n`;
//       responsePrompt += `- Copy the entire JSON structure above\n`;
//       responsePrompt += `- Replace any placeholder text/values with actual data from EXTRACTED DATA FROM DOCUMENT\n`;
//       responsePrompt += `- Keep ALL field names, nesting, and structure EXACTLY as shown\n`;
//       responsePrompt += `- Do NOT change the JSON structure in any way\n`;
//       responsePrompt += `- Do NOT create a summary or description - return ONLY the JSON matching the template above\n\n`;
      
//       // Add explicit list of all required sections
//       if (allRequiredSections.length > 0) {
//         responsePrompt += `\n🚨 CRITICAL: YOU MUST INCLUDE ALL OF THESE SECTIONS IN YOUR RESPONSE:\n`;
//         allRequiredSections.forEach((section, idx) => {
//           responsePrompt += `   ${idx + 1}. "${section}" - REQUIRED\n`;
//         });
//         responsePrompt += `\n⚠️ MISSING ANY OF THESE SECTIONS WILL RESULT IN AN INCOMPLETE RESPONSE!\n`;
//         responsePrompt += `⚠️ YOU MUST GENERATE CONTENT FOR EACH AND EVERY SECTION LISTED ABOVE!\n\n`;
//       }
      
//       responsePrompt += `\n`;
//       responsePrompt += `═══════════════════════════════════════════════════════════════════════\n`;
//       responsePrompt += `🚨 CRITICAL WORKFLOW INSTRUCTIONS - READ CAREFULLY\n`;
//       responsePrompt += `═══════════════════════════════════════════════════════════════════════\n\n`;
      
//       responsePrompt += `📋 STEP-BY-STEP TASK WORKFLOW:\n\n`;
//       responsePrompt += `STEP 1: COPY THE OUTPUT TEMPLATE JSON STRUCTURE\n`;
//       responsePrompt += `   - Take the ENTIRE OUTPUT TEMPLATE JSON structure shown above\n`;
//       responsePrompt += `   - Copy it EXACTLY as shown - do not modify the structure\n`;
//       responsePrompt += `   - Keep ALL field names, nesting levels, and JSON structure identical\n\n`;
      
//       responsePrompt += `STEP 2: USE THE EXTRACTED DATA FROM INPUT TEMPLATE\n`;
//       responsePrompt += `   - Review the EXTRACTED DATA FROM INPUT TEMPLATE shown above (in the previous section)\n`;
//       responsePrompt += `   - This data was extracted from the document using the INPUT TEMPLATE structure\n`;
//       responsePrompt += `   - ALL the information you need is in that EXTRACTED DATA section\n`;
//       responsePrompt += `   - Find corresponding values in the extracted data for each field in the OUTPUT TEMPLATE\n`;
//       responsePrompt += `   - Use the extracted data to populate the OUTPUT TEMPLATE structure\n`;
//       responsePrompt += `   - Replace placeholder text/values in the template with actual data from EXTRACTED DATA\n`;
//       responsePrompt += `   - Keep the JSON structure EXACTLY the same - only replace values\n\n`;
      
//       responsePrompt += `STEP 3: VERIFY STRUCTURE MATCHES TEMPLATE\n`;
//       responsePrompt += `   - Ensure your response has the EXACT same JSON structure as the OUTPUT TEMPLATE\n`;
//       responsePrompt += `   - All field names must match exactly\n`;
//       responsePrompt += `   - All nesting levels must match exactly\n`;
//       responsePrompt += `   - All sections must be present\n`;
//       if (allRequiredSections.length > 0) {
//         responsePrompt += `   - Verify ALL ${allRequiredSections.length} required sections are included\n\n`;
//       }
      
//       responsePrompt += `STEP 4: RETURN THE COMPLETED JSON\n`;
//       responsePrompt += `   - Return ONLY the JSON matching the OUTPUT TEMPLATE structure\n`;
//       responsePrompt += `   - Wrap it in markdown code blocks: \`\`\`json ... \`\`\`\n`;
//       responsePrompt += `   - Do NOT add any explanation, summary, or text outside the JSON\n`;
//       responsePrompt += `   - Do NOT create your own format - use ONLY the template structure\n\n`;
      
//       responsePrompt += `⚠️ CRITICAL REQUIREMENTS:\n`;
//       responsePrompt += `1. ✅ COPY the OUTPUT TEMPLATE JSON structure EXACTLY - do not modify it\n`;
//       responsePrompt += `2. ✅ USE the EXTRACTED DATA FROM INPUT TEMPLATE (shown above) as your source of information\n`;
//       responsePrompt += `3. ✅ REPLACE placeholder values with actual data from EXTRACTED DATA FROM INPUT TEMPLATE\n`;
//       responsePrompt += `4. ✅ KEEP the exact same JSON structure, field names, and nesting\n`;
//       responsePrompt += `5. ✅ DO NOT create your own format or structure\n`;
//       responsePrompt += `6. ✅ DO NOT add explanations or summaries outside the JSON\n`;
//       responsePrompt += `7. ✅ DO NOT skip any sections or fields from the template\n`;
//       if (allRequiredSections.length > 0) {
//         responsePrompt += `8. ✅ INCLUDE ALL ${allRequiredSections.length} required sections from the template\n`;
//       }
//       responsePrompt += `9. ✅ RETURN ONLY valid JSON matching the template structure\n\n`;
      
//       responsePrompt += `📝 OUTPUT FORMAT REQUIREMENTS:\n`;
//       responsePrompt += `- Your response MUST be the EXACT JSON structure from OUTPUT TEMPLATE above\n`;
//       responsePrompt += `- Wrap your JSON response in markdown code blocks: \`\`\`json ... \`\`\`\n`;
//       responsePrompt += `- Fill in all fields with actual data from EXTRACTED DATA FROM INPUT TEMPLATE (shown above)\n`;
//       responsePrompt += `- The EXTRACTED DATA section contains all information extracted from the document\n`;
//       responsePrompt += `- Use ONLY the information from EXTRACTED DATA to populate the OUTPUT TEMPLATE\n`;
//       responsePrompt += `- Do NOT return a summary or description - return ONLY the JSON\n`;
//       responsePrompt += `- The JSON structure must match the template EXACTLY\n\n`;
      
//       // Add structured_schema if available
//       if (outputTemplateStructuredSchema) {
//         responsePrompt += `\n\n📊 REQUIRED OUTPUT JSON SCHEMA (MUST FOLLOW EXACTLY):\n`;
//         responsePrompt += `This JSON schema defines the EXACT structure your response must have:\n`;
//         const schemaText = typeof outputTemplateStructuredSchema === 'string'
//           ? outputTemplateStructuredSchema
//           : JSON.stringify(outputTemplateStructuredSchema, null, 2);
//         responsePrompt += `${schemaText}\n\n`;
//         responsePrompt += `⚠️ CRITICAL: This schema shows the STRUCTURE. You must fill each field with ACTUAL content from the extracted data.\n`;
//         if (allRequiredSections.length > 0) {
//           responsePrompt += `⚠️ CRITICAL: The schema above lists ${allRequiredSections.length} required sections. You MUST include ALL of them in your response.\n\n`;
//         }
//       }
      
//       responsePrompt += `🎯 FINAL INSTRUCTION:\n`;
//       responsePrompt += `YOUR TASK: Copy the OUTPUT TEMPLATE JSON structure above and fill it with data from EXTRACTED DATA FROM INPUT TEMPLATE.\n\n`;
//       responsePrompt += `DO THIS:\n`;
//       responsePrompt += `1. Copy the ENTIRE OUTPUT TEMPLATE JSON structure (shown above)\n`;
//       responsePrompt += `2. Use the EXTRACTED DATA FROM INPUT TEMPLATE (shown in the previous section) as your source of information\n`;
//       responsePrompt += `3. Replace placeholder values with actual data from EXTRACTED DATA FROM INPUT TEMPLATE\n`;
//       responsePrompt += `4. Keep the JSON structure EXACTLY the same - only change the values\n`;
//       responsePrompt += `5. Return ONLY the JSON (wrapped in \`\`\`json ... \`\`\`)\n\n`;
      
//       responsePrompt += `DO NOT DO THIS:\n`;
//       responsePrompt += `- Do NOT create your own JSON structure\n`;
//       responsePrompt += `- Do NOT write a summary or description\n`;
//       responsePrompt += `- Do NOT modify field names or structure\n`;
//       responsePrompt += `- Do NOT add or remove fields\n`;
//       responsePrompt += `- Do NOT return text outside the JSON structure\n\n`;
      
//       responsePrompt += `EXAMPLE:\n`;
//       responsePrompt += `If OUTPUT TEMPLATE has: {"metadata": {"case_title": "..."}, "generated_sections": {"section_1": {"generated_text": "...", "required_summary_type": "Extractive"}}}\n`;
//       responsePrompt += `Your response MUST have the EXACT same structure with actual data filled in.\n\n`;
//     }

//     // Generate response using LLM
//     console.log(`\n🚀 [SecretTemplateExtraction] Sending prompt to LLM with output template structure...`);
//     if (outputTemplateStructuredSchema || outputTemplateJson) {
//       console.log(`📋 [SecretTemplateExtraction] Output template is included in the prompt above`);
//     }
    
//     let llmResponse = await askLLM(
//       provider,
//       responsePrompt,
//       '',
//       '',
//       'Generate response based on extracted data and output template'
//     );

//     console.log(`✅ [SecretTemplateExtraction] LLM response generated: ${llmResponse.length} chars`);
//     console.log(`\n📄 [SecretTemplateExtraction] RAW LLM RESPONSE (first 500 chars):\n${llmResponse.substring(0, 500)}\n`);

//     // Apply output template post-processing if output template exists
//     if (outputTemplateJson || outputTemplateStructuredSchema) {
//       console.log(`\n📤 [SecretTemplateExtraction] Step 6: Applying output template formatting...`);
      
//       // Clean the response - remove any text before JSON
//       let cleanedResponse = llmResponse.trim();
      
//       // Remove common prefixes like "Pravin, here is..." or "Based on..."
//       const prefixPatterns = [
//         /^[^`]*?```json\s*/i,
//         /^[^`]*?```\s*/i,
//         /^.*?(?=\{|\[)/s, // Remove everything before first { or [
//       ];
      
//       for (const pattern of prefixPatterns) {
//         const match = cleanedResponse.match(pattern);
//         if (match && match[0] && (match[0].includes('Pravin') || match[0].includes('here is') || match[0].includes('Based on'))) {
//           cleanedResponse = cleanedResponse.replace(pattern, '');
//           console.log(`🧹 [SecretTemplateExtraction] Removed prefix text before JSON`);
//         }
//       }
      
//       // Extract JSON from markdown code blocks if present
//       const jsonMatch = cleanedResponse.match(/```json\s*([\s\S]*?)\s*```/i) || 
//                        cleanedResponse.match(/```\s*([\s\S]*?)\s*```/i);
//       if (jsonMatch) {
//         cleanedResponse = jsonMatch[1].trim();
//         console.log(`🧹 [SecretTemplateExtraction] Extracted JSON from markdown code blocks`);
//       }
      
//       // If response doesn't start with { or [, try to find JSON
//       if (!cleanedResponse.trim().startsWith('{') && !cleanedResponse.trim().startsWith('[')) {
//         const jsonStart = cleanedResponse.indexOf('{');
//         if (jsonStart > 0) {
//           cleanedResponse = cleanedResponse.substring(jsonStart);
//           console.log(`🧹 [SecretTemplateExtraction] Removed text before JSON start`);
//         }
//       }
      
//       llmResponse = cleanedResponse;
      
//       // Parse output template to use as reference structure
//       let outputTemplateObj = null;
      
//       // Helper function to safely parse JSON from text
//       const safeParseJson = (text) => {
//         if (!text || typeof text !== 'string') return null;
        
//         // Try direct JSON parse
//         try {
//           return JSON.parse(text);
//         } catch (e) {
//           // Try extracting JSON from markdown code blocks
//           const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/i) || 
//                            text.match(/```\s*([\s\S]*?)\s*```/i);
//           if (jsonMatch) {
//             try {
//               return JSON.parse(jsonMatch[1].trim());
//             } catch (e2) {
//               // Ignore
//             }
//           }
          
//           // Try if it starts with { or [
//           if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
//             try {
//               return JSON.parse(text.trim());
//             } catch (e3) {
//               // Ignore
//             }
//           }
//         }
//         return null;
//       };
      
//       // Use the example structure built earlier, or build it now if not available
//       let templateStructureForPostProcessing = outputTemplateExampleStructure || null;
      
//       if (!templateStructureForPostProcessing && outputTemplateStructuredSchema) {
//         // Build example structure from schema for post-processing
//         const schemaObj = typeof outputTemplateStructuredSchema === 'string'
//           ? safeParseJson(outputTemplateStructuredSchema)
//           : outputTemplateStructuredSchema;
        
//         if (schemaObj) {
//           // Helper function to build example structure from JSON schema
//           const buildExampleFromSchema = (schema) => {
//             if (!schema || typeof schema !== 'object') return null;
            
//             // If schema has schemas.input_form_data structure (like user's example)
//             if (schema.schemas && schema.schemas.input_form_data) {
//               return schema.schemas.input_form_data;
//             }
            
//             // If schema has schemas.output_summary_template structure
//             if (schema.schemas && schema.schemas.output_summary_template) {
//               return schema.schemas.output_summary_template;
//             }
            
//             // If it's a JSON schema with properties, build example from it
//             if (schema.properties) {
//               const example = {};
//               for (const key in schema.properties) {
//                 const prop = schema.properties[key];
//                 if (prop.type === 'object' && prop.properties) {
//                   example[key] = buildExampleFromSchema(prop);
//                 } else if (prop.type === 'array' && prop.items) {
//                   example[key] = prop.items.properties ? [buildExampleFromSchema(prop.items)] : [];
//                 } else {
//                   // Use default value if available, otherwise use empty string or null
//                   example[key] = prop.default !== undefined ? prop.default : (prop.type === 'string' ? '' : null);
//                 }
//               }
//               return example;
//             }
            
//             return schema;
//           };
          
//           templateStructureForPostProcessing = buildExampleFromSchema(schemaObj);
//           console.log(`✅ [SecretTemplateExtraction] Built example structure from schema for post-processing`);
//         }
//       }
      
//       // Fallback to outputTemplateJson if example structure not available
//       if (!templateStructureForPostProcessing && outputTemplateJson) {
//         templateStructureForPostProcessing = typeof outputTemplateJson === 'string'
//           ? safeParseJson(outputTemplateJson)
//           : outputTemplateJson;
//       }
      
//       // Create outputTemplate object for postProcessSecretPromptResponse
//       const outputTemplate = {
//         extracted_text: outputTemplateJson,
//         structured_schema: outputTemplateStructuredSchema
//       };
      
//       let processedResponse = postProcessSecretPromptResponse(llmResponse, outputTemplate);
      
//       // Additional validation: Ensure response matches template structure EXACTLY
//       if (templateStructureForPostProcessing) {
//         try {
//           // Extract JSON from processed response
//           const jsonMatch = processedResponse.match(/```json\s*([\s\S]*?)\s*```/i);
//           let responseJson = null;
          
//           if (jsonMatch) {
//             responseJson = JSON.parse(jsonMatch[1].trim());
//           } else if (processedResponse.trim().startsWith('{') || processedResponse.trim().startsWith('[')) {
//             responseJson = JSON.parse(processedResponse.trim());
//           }
          
//           if (responseJson && templateStructureForPostProcessing) {
//             // Use template structure as base and merge response data into it
//             const mergedResponse = JSON.parse(JSON.stringify(templateStructureForPostProcessing)); // Deep clone template
            
//             // Recursively merge response data into template structure
//             const mergeDataIntoTemplate = (template, data) => {
//               for (const key in template) {
//                 if (data && data.hasOwnProperty(key)) {
//                   if (typeof template[key] === 'object' && template[key] !== null && !Array.isArray(template[key])) {
//                     if (typeof data[key] === 'object' && data[key] !== null && !Array.isArray(data[key])) {
//                       mergeDataIntoTemplate(template[key], data[key]);
//                     } else if (data[key] !== undefined && data[key] !== null) {
//                       // Replace template value with actual data
//                       template[key] = data[key];
//                     }
//                   } else if (data[key] !== undefined && data[key] !== null) {
//                     // Replace template value with actual data
//                     template[key] = data[key];
//                   }
//                 }
//               }
//             };
            
//             mergeDataIntoTemplate(mergedResponse, responseJson);
            
//             // Ensure all required sections exist - handle different structure types
//             // Check for analytical_sections (like in user's example with input_form_data)
//             if (mergedResponse.analytical_sections && typeof mergedResponse.analytical_sections === 'object') {
//               const sections = mergedResponse.analytical_sections;
              
//               // Ensure each section has required fields
//               for (const sectionKey in sections) {
//                 if (sections[sectionKey] && typeof sections[sectionKey] === 'object') {
//                   // Merge data from response if available
//                   if (responseJson.analytical_sections && responseJson.analytical_sections[sectionKey]) {
//                     Object.assign(sections[sectionKey], responseJson.analytical_sections[sectionKey]);
//                   }
//                   // Ensure content field exists (for analytical_sections structure)
//                   if (!sections[sectionKey].content && responseJson.analytical_sections && responseJson.analytical_sections[sectionKey]) {
//                     sections[sectionKey].content = responseJson.analytical_sections[sectionKey].content || 
//                                                   responseJson.analytical_sections[sectionKey].generated_text || 
//                                                   '';
//                   }
//                 }
//               }
//             }
//             // Check for generated_sections (standard output template structure)
//             else if (mergedResponse.generated_sections || (mergedResponse.schemas && mergedResponse.schemas.output_summary_template && mergedResponse.schemas.output_summary_template.generated_sections)) {
//               const sections = mergedResponse.generated_sections || 
//                              (mergedResponse.schemas && mergedResponse.schemas.output_summary_template && mergedResponse.schemas.output_summary_template.generated_sections);
              
//               // Ensure each section has required fields
//               for (const sectionKey in sections) {
//                 if (sections[sectionKey] && typeof sections[sectionKey] === 'object') {
//                   // Ensure generated_text exists
//                   if (!sections[sectionKey].generated_text && responseJson.generated_sections && responseJson.generated_sections[sectionKey]) {
//                     sections[sectionKey].generated_text = responseJson.generated_sections[sectionKey].generated_text || 
//                                                          responseJson.generated_sections[sectionKey] || 
//                                                          '';
//                   }
//                   // Ensure required_summary_type exists
//                   if (!sections[sectionKey].required_summary_type) {
//                     sections[sectionKey].required_summary_type = sections[sectionKey].required_summary_type || 'Extractive';
//                   }
//                 }
//               }
//             }
            
//             processedResponse = `\`\`\`json\n${JSON.stringify(mergedResponse, null, 2)}\n\`\`\``;
//             console.log(`[SecretTemplateExtraction] ✅ Merged response into exact template structure`);
//             console.log(`\n📤 [SecretTemplateExtraction] FINAL FORMATTED RESPONSE:\n${processedResponse.substring(0, 500)}...\n`);
//           } else {
//             // If response doesn't parse as JSON but we have a template structure, force it
//             if (templateStructureForPostProcessing) {
//               console.warn(`⚠️ [SecretTemplateExtraction] Response JSON missing or invalid, forcing template structure`);
//               const forcedResponse = JSON.parse(JSON.stringify(templateStructureForPostProcessing));
//               // Try to extract any data from the raw cleaned response (best effort)
//               try {
//                 const parsedRaw = JSON.parse(llmResponse);
//                 const mergeDataIntoTemplate = (template, data) => {
//                   for (const key in template) {
//                     if (data && data.hasOwnProperty(key)) {
//                       if (typeof template[key] === 'object' && template[key] !== null && !Array.isArray(template[key])) {
//                         if (typeof data[key] === 'object' && data[key] !== null && !Array.isArray(data[key])) {
//                           mergeDataIntoTemplate(template[key], data[key]);
//                         } else if (data[key] !== undefined && data[key] !== null) {
//                           template[key] = data[key];
//                         }
//                       } else if (data[key] !== undefined && data[key] !== null) {
//                         template[key] = data[key];
//                       }
//                     }
//                   }
//                 };
//                 mergeDataIntoTemplate(forcedResponse, parsedRaw);
//               } catch (e) {
//                 // ignore if raw is not JSON
//               }
//               processedResponse = `\`\`\`json\n${JSON.stringify(forcedResponse, null, 2)}\n\`\`\``;
//               console.log(`[SecretTemplateExtraction] ✅ Forced response into template structure (no valid JSON parsed)`);              
//             }
//           }
//         } catch (e) {
//           console.warn('[SecretTemplateExtraction] Could not validate/merge response structure:', e);
//           console.warn('[SecretTemplateExtraction] Error details:', e.message);
          
//           // Last resort: if we have template structure, use it as base
//           if (templateStructureForPostProcessing && !processedResponse.includes('```json')) {
//             console.log(`[SecretTemplateExtraction] Using template structure as fallback response`);
//             processedResponse = `\`\`\`json\n${JSON.stringify(templateStructureForPostProcessing, null, 2)}\n\`\`\``;
//           }
//         }
//       }
      
//       finalResponse = processedResponse;
//       console.log(`✅ [SecretTemplateExtraction] Output template formatting applied`);
//       console.log(`\n📄 [SecretTemplateExtraction] FINAL RESPONSE LENGTH: ${finalResponse.length} chars`);
//     } else {
//       finalResponse = llmResponse;
//     }

//     console.log(`\n✅ [SecretTemplateExtraction] Flow completed successfully\n`);

//     return {
//       success: true,
//       response: finalResponse,
//       extractedData: extractedData,
//       extractionId: storedExtraction ? storedExtraction.id : null,
//       outputTemplateJson: outputTemplateJson
//     };

//   } catch (error) {
//     console.error(`❌ [SecretTemplateExtraction] Error in flow:`, error.message);
//     console.error(`   Stack:`, error.stack);
//     throw error;
//   }
// }

// module.exports = {
//   processSecretPromptWithTemplates
// };

const pool = require('../config/db');
const PromptExtraction = require('../models/PromptExtraction');
const { askLLM } = require('./aiService');
const { postProcessSecretPromptResponse } = require('../controllers/secretManagerController');

/**
 * FIXED VERSION - Process secret prompt with input/output templates:
 * Key fixes:
 * 1. Properly extract and parse structured_schema from output template
 * 2. Build correct example structure from schema
 * 3. Ensure LLM receives the exact template structure to follow
 * 4. Better validation and merging of LLM response with template structure
 */
async function processSecretPromptWithTemplates({
  secretPrompt,
  inputTemplateId,
  outputTemplateId,
  fileId,
  sessionId,
  userId,
  documentContext,
  provider = 'gemini'
}) {
  try {
    console.log(`\n📋 [SecretTemplateExtraction] Processing secret prompt with templates`);
    console.log(`   Input Template ID: ${inputTemplateId || 'not set'}`);
    console.log(`   Output Template ID: ${outputTemplateId || 'not set'}`);
    console.log(`   File ID: ${fileId || 'not set'}`);
    console.log(`   Session ID: ${sessionId}\n`);

    let extractedData = null;
    let storedExtraction = null;

    // ==================================================================================
    // STEP 1 & 2: INPUT TEMPLATE EXTRACTION
    // ==================================================================================
    if (inputTemplateId) {
      console.log(`\n🔍 [SecretTemplateExtraction] Step 1: Fetching input template...`);
      
      const inputTemplateQuery = `
        SELECT 
          dae.extracted_text,
          dae.structured_schema,
          dae.entities,
          dae.form_fields,
          dae.tables
        FROM document_ai_extractions dae
        WHERE dae.template_file_id = $1
          AND (dae.structured_schema IS NOT NULL OR dae.extracted_text IS NOT NULL)
          AND (dae.deleted_at IS NULL OR dae.deleted_at > NOW())
        ORDER BY dae.created_at DESC
        LIMIT 1;
      `;
      
      const inputTemplateResult = await pool.query(inputTemplateQuery, [inputTemplateId]);
      
      if (inputTemplateResult.rows.length > 0) {
        const row = inputTemplateResult.rows[0];
        let inputTemplateStructure = null;
        let inputTemplateJson = null;
        
        // Parse structured_schema
        if (row.structured_schema) {
          console.log(`✅ Found input template structured_schema`);
          const schemaObj = typeof row.structured_schema === 'string'
            ? JSON.parse(row.structured_schema)
            : row.structured_schema;
          
          // Extract the actual template structure
          if (schemaObj.schemas && schemaObj.schemas.input_form_data) {
            inputTemplateStructure = schemaObj.schemas.input_form_data;
            console.log(`✅ Using schemas.input_form_data structure`);
          } else if (schemaObj.input_form_data) {
            inputTemplateStructure = schemaObj.input_form_data;
            console.log(`✅ Using input_form_data structure`);
          } else {
            inputTemplateStructure = schemaObj;
            console.log(`✅ Using full schema structure`);
          }
          
          inputTemplateJson = JSON.stringify(inputTemplateStructure, null, 2);
        } else if (row.extracted_text) {
          console.log(`⚠️ Using extracted_text as fallback`);
          inputTemplateJson = row.extracted_text;
          try {
            inputTemplateStructure = JSON.parse(inputTemplateJson);
          } catch (e) {
            // Not JSON, use as-is
          }
        }
        
        if (inputTemplateJson) {
          console.log(`✅ Input template JSON ready: ${inputTemplateJson.length} chars`);
          
          // Step 2: Extract data using input template
          console.log(`\n🔍 Step 2: Extracting data using input template...`);
          
          let extractionPrompt = `${secretPrompt}

═══════════════════════════════════════════════════════════════════════
📥 INPUT TEMPLATE STRUCTURE (Extract data matching this format)
═══════════════════════════════════════════════════════════════════════

INPUT TEMPLATE STRUCTURE:
${inputTemplateJson}

DOCUMENT TO ANALYZE:
${documentContext}

CRITICAL INSTRUCTIONS:
1. Extract ALL relevant information from the document that matches the INPUT TEMPLATE structure
2. Return the extracted data in the EXACT same JSON structure as the input template
3. Fill in all fields with actual data from the document
4. Maintain the exact same field names, nesting, and structure
5. If a field doesn't have corresponding data, leave it empty or use null
6. Return ONLY valid JSON wrapped in \`\`\`json ... \`\`\` blocks`;

          const extractedDataResponse = await askLLM(
            provider,
            extractionPrompt,
            '',
            '',
            'Extract data using input template'
          );

          console.log(`✅ Data extraction completed: ${extractedDataResponse.length} chars`);

          // Parse extracted data
          try {
            const jsonMatch = extractedDataResponse.match(/```json\s*([\s\S]*?)\s*```/i);
            if (jsonMatch) {
              extractedData = JSON.parse(jsonMatch[1].trim());
            } else if (extractedDataResponse.trim().startsWith('{') || extractedDataResponse.trim().startsWith('[')) {
              extractedData = JSON.parse(extractedDataResponse.trim());
            } else {
              extractedData = extractedDataResponse;
            }
            console.log(`✅ Parsed extracted data as JSON`);
          } catch (parseError) {
            console.warn(`⚠️ Could not parse as JSON, storing as text`);
            extractedData = extractedDataResponse;
          }

          // Step 3: Store extracted data
          console.log(`\n💾 Step 3: Storing extracted data in prompt_extractions...`);
          try {
            const savedExtraction = await PromptExtraction.save(
              inputTemplateId,
              fileId,
              sessionId,
              userId,
              extractedData
            );
            console.log(`✅ Stored in prompt_extractions: ${savedExtraction.id}`);

            // Step 4: Fetch stored data
            console.log(`\n📥 Step 4: Fetching stored extracted data...`);
            storedExtraction = await PromptExtraction.getLatestBySession(sessionId);
            if (storedExtraction && storedExtraction.extracted_data) {
              extractedData = storedExtraction.extracted_data;
              console.log(`✅ Retrieved stored extraction`);
            }
          } catch (storageError) {
            console.warn(`⚠️ Storage error (continuing):`, storageError.message);
          }
        }
      } else {
        console.warn(`⚠️ No input template found for ID: ${inputTemplateId}`);
      }
    }

    // ==================================================================================
    // STEP 5: OUTPUT TEMPLATE GENERATION
    // ==================================================================================
    console.log(`\n📤 Step 5: Generating response with output template...`);
    
    let finalResponse = '';
    let outputTemplateStructure = null;
    let outputTemplateJson = null;
    
    if (outputTemplateId) {
      console.log(`\n🔍 Fetching output template from document_ai_extractions...`);
      
      const outputTemplateQuery = `
        SELECT 
          dae.extracted_text,
          dae.structured_schema
        FROM document_ai_extractions dae
        WHERE dae.template_file_id = $1
          AND (dae.structured_schema IS NOT NULL OR dae.extracted_text IS NOT NULL)
          AND (dae.deleted_at IS NULL OR dae.deleted_at > NOW())
        ORDER BY dae.created_at DESC
        LIMIT 1;
      `;
      
      const outputTemplateResult = await pool.query(outputTemplateQuery, [outputTemplateId]);
      
      if (outputTemplateResult.rows.length > 0) {
        const row = outputTemplateResult.rows[0];
        
        console.log(`✅ Output template fetched`);
        console.log(`   Has structured_schema: ${!!row.structured_schema}`);
        console.log(`   Has extracted_text: ${!!row.extracted_text}`);
        
        // CRITICAL FIX: Properly extract output template structure from structured_schema
        if (row.structured_schema) {
          const schemaObj = typeof row.structured_schema === 'string'
            ? JSON.parse(row.structured_schema)
            : row.structured_schema;
          
          console.log(`✅ Parsed structured_schema`);
          
          // Extract the actual template structure from various possible locations
          if (schemaObj.schemas && schemaObj.schemas.output_summary_template) {
            outputTemplateStructure = schemaObj.schemas.output_summary_template;
            console.log(`✅ Using schemas.output_summary_template structure`);
          } else if (schemaObj.schemas && schemaObj.schemas.input_form_data) {
            // Some templates use input_form_data as the output structure
            outputTemplateStructure = schemaObj.schemas.input_form_data;
            console.log(`✅ Using schemas.input_form_data structure`);
          } else if (schemaObj.output_summary_template) {
            outputTemplateStructure = schemaObj.output_summary_template;
            console.log(`✅ Using output_summary_template structure`);
          } else if (schemaObj.input_form_data) {
            outputTemplateStructure = schemaObj.input_form_data;
            console.log(`✅ Using input_form_data structure`);
          } else {
            outputTemplateStructure = schemaObj;
            console.log(`✅ Using full schema structure`);
          }
          
          outputTemplateJson = JSON.stringify(outputTemplateStructure, null, 2);
        } else if (row.extracted_text) {
          console.log(`⚠️ Using extracted_text as fallback`);
          outputTemplateJson = row.extracted_text;
          try {
            outputTemplateStructure = JSON.parse(outputTemplateJson);
          } catch (e) {
            // Not JSON
          }
        }
        
        if (outputTemplateJson) {
          console.log(`✅ Output template JSON ready: ${outputTemplateJson.length} chars`);
          console.log(`\n📄 OUTPUT TEMPLATE STRUCTURE:\n${outputTemplateJson.substring(0, 500)}...\n`);
        }
      } else {
        console.warn(`⚠️ No output template found for ID: ${outputTemplateId}`);
      }
    }

    // Build the response generation prompt
    let responsePrompt = secretPrompt;
    
    // Add extracted data as context
    if (extractedData) {
      const extractedDataText = typeof extractedData === 'object' 
        ? JSON.stringify(extractedData, null, 2)
        : extractedData;
      
      console.log(`\n📋 Using extracted data as context (${extractedDataText.length} chars)`);
      
      responsePrompt += `\n\n═══════════════════════════════════════════════════════════════════════
📥 EXTRACTED DATA (USE THIS AS YOUR SOURCE OF INFORMATION)
═══════════════════════════════════════════════════════════════════════

${extractedDataText}

`;
    } else {
      responsePrompt += `\n\nDOCUMENT TO ANALYZE:\n${documentContext}\n\n`;
    }

    // Add output template instructions if available
    if (outputTemplateJson && outputTemplateStructure) {
      console.log(`\n📝 Adding output template instructions to prompt...`);
      
      responsePrompt += `
═══════════════════════════════════════════════════════════════════════
🚨 CRITICAL: YOU MUST RETURN JSON MATCHING THIS EXACT STRUCTURE
═══════════════════════════════════════════════════════════════════════

OUTPUT TEMPLATE (COPY THIS STRUCTURE EXACTLY):
\`\`\`json
${outputTemplateJson}
\`\`\`

🚨 MANDATORY REQUIREMENTS:
1. Your response MUST be valid JSON matching the EXACT structure above
2. Copy ALL field names exactly as shown
3. Maintain ALL nesting levels and structure
4. Fill each field with appropriate content from the EXTRACTED DATA
5. Do NOT add, remove, or modify any field names
6. Do NOT add explanations outside the JSON
7. Wrap your response in \`\`\`json ... \`\`\` blocks

🎯 TASK:
- Copy the OUTPUT TEMPLATE structure above
- Fill each field with relevant data from EXTRACTED DATA
- Return ONLY the JSON (no other text)

START YOUR RESPONSE WITH: \`\`\`json
`;
    }

    // Generate response using LLM
    console.log(`\n🚀 Sending prompt to LLM...`);
    let llmResponse = await askLLM(
      provider,
      responsePrompt,
      '',
      '',
      'Generate response with output template'
    );

    console.log(`✅ LLM response received: ${llmResponse.length} chars`);

    // Process and validate response
    if (outputTemplateJson && outputTemplateStructure) {
      console.log(`\n🔧 Processing LLM response to match template...`);
      
      // Clean response - extract JSON
      let cleanedResponse = llmResponse.trim();
      
      // Remove any text before JSON
      const jsonMatch = cleanedResponse.match(/```json\s*([\s\S]*?)\s*```/i);
      if (jsonMatch) {
        cleanedResponse = jsonMatch[1].trim();
      } else {
        // Try to find JSON start
        const jsonStart = cleanedResponse.indexOf('{');
        if (jsonStart >= 0) {
          cleanedResponse = cleanedResponse.substring(jsonStart);
          const jsonEnd = cleanedResponse.lastIndexOf('}');
          if (jsonEnd >= 0) {
            cleanedResponse = cleanedResponse.substring(0, jsonEnd + 1);
          }
        }
      }
      
      // Parse and validate
      try {
        const responseData = JSON.parse(cleanedResponse);
        console.log(`✅ Parsed LLM response as JSON`);
        
        // Merge response data into template structure
        const mergedResponse = JSON.parse(JSON.stringify(outputTemplateStructure)); // Deep clone
        
        const deepMerge = (template, data) => {
          for (const key in template) {
            if (data && data.hasOwnProperty(key)) {
              if (typeof template[key] === 'object' && template[key] !== null && !Array.isArray(template[key])) {
                if (typeof data[key] === 'object' && data[key] !== null && !Array.isArray(data[key])) {
                  deepMerge(template[key], data[key]);
                } else {
                  template[key] = data[key];
                }
              } else {
                template[key] = data[key];
              }
            }
          }
        };
        
        deepMerge(mergedResponse, responseData);
        
        finalResponse = `\`\`\`json\n${JSON.stringify(mergedResponse, null, 2)}\n\`\`\``;
        console.log(`✅ Successfully merged response into template structure`);
        
      } catch (parseError) {
        console.warn(`⚠️ Could not parse response as JSON:`, parseError.message);
        // Fallback: use template structure with empty values
        finalResponse = `\`\`\`json\n${JSON.stringify(outputTemplateStructure, null, 2)}\n\`\`\``;
        console.log(`⚠️ Using template structure as fallback`);
      }
      
    } else {
      finalResponse = llmResponse;
    }

    console.log(`\n✅ Processing completed successfully`);
    console.log(`   Final response length: ${finalResponse.length} chars\n`);

    return {
      success: true,
      response: finalResponse,
      extractedData: extractedData,
      extractionId: storedExtraction ? storedExtraction.id : null,
      outputTemplateJson: outputTemplateJson
    };

  } catch (error) {
    console.error(`❌ Error in processSecretPromptWithTemplates:`, error.message);
    console.error(`   Stack:`, error.stack);
    throw error;
  }
}

module.exports = {
  processSecretPromptWithTemplates
};