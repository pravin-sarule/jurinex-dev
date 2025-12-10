// /**
//  * Folder-Level Gemini Eyeball Service
//  * Handles multiple document analysis using Gemini's native GCS URI support
//  * This service is optimized for folder-level summaries and comprehensive analysis
//  * while minimizing token consumption by using Gemini's native document processing
//  */

// const { VertexAI } = require('@google-cloud/vertexai');
// const path = require('path');
// const pool = require('../config/db');
// const { bucket } = require('../config/gcs');

// // --- Initialization ---

// function getGCSProjectId() {
//   try {
//     if (process.env.GCP_PROJECT_ID) {
//       return process.env.GCP_PROJECT_ID;
//     }

//     if (process.env.GCS_KEY_BASE64) {
//       const jsonString = Buffer.from(process.env.GCS_KEY_BASE64, 'base64').toString('utf-8');
//       const credentials = JSON.parse(jsonString);
//       if (credentials.project_id) {
//         return credentials.project_id;
//       }
//     }
    
//     throw new Error('GCP_PROJECT_ID not found. Set GCP_PROJECT_ID in .env');
//   } catch (error) {
//     console.error('❌ Failed to get GCP Project ID:', error.message);
//     throw error;
//   }
// }

// let vertexAI;
// function initializeVertexAI() {
//   if (vertexAI) return vertexAI;
  
//   try {
//     const projectId = getGCSProjectId();
//     const location = process.env.GCP_LOCATION || 'us-central1';
    
//     console.log(`🚀 Initializing Vertex AI for folder Gemini service: ${projectId}, location: ${location}`);
    
//     vertexAI = new VertexAI({
//       project: projectId,
//       location: location,
//     });
    
//     return vertexAI;
//   } catch (error) {
//     console.error('❌ Failed to initialize Vertex AI:', error.message);
//     throw new Error(`Vertex AI initialization failed: ${error.message}`);
//   }
// }

// /**
//  * Get MIME type from file extension
//  */
// function getMimeTypeFromPath(filePath) {
//   const ext = path.extname(filePath).toLowerCase();
//   const mimeTypes = {
//     '.pdf': 'application/pdf',
//     '.txt': 'text/plain',
//     '.md': 'text/markdown',
//     '.jpg': 'image/jpeg',
//     '.jpeg': 'image/jpeg',
//     '.png': 'image/png',
//     '.csv': 'text/csv',
//     '.doc': 'application/msword',
//     '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
//     '.xls': 'application/vnd.ms-excel',
//     '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
//   };
//   return mimeTypes[ext] || 'application/octet-stream';
// }

// /**
//  * Fallback method: Download files from GCS and pass directly to Gemini
//  * Used when GCS URI access fails due to permissions
//  * 
//  * @param {string} question - User's question or prompt
//  * @param {Array<{gcsUri: string, filename: string, mimeType?: string}>} documents - Array of document objects
//  * @param {string} userContext - Optional user profile context
//  * @returns {Promise<string>} - LLM response
//  */
// async function askGeminiWithDirectFiles(question, documents = [], userContext = '') {
//   console.log(`🔄 [folderGeminiService] Using fallback: Direct file download method`);
//   console.log(`🔄 [folderGeminiService] Downloading ${documents.length} files from GCS...`);

//   const vertex_ai = initializeVertexAI();
  
//   // Build prompt
//   let promptText = question;
//   if (userContext) {
//     promptText = `USER CONTEXT:\n${userContext}\n\nUSER QUESTION: ${question}`;
//   }

//   const documentList = documents.map((doc, idx) => `${idx + 1}. ${doc.filename || `Document ${idx + 1}`}`).join('\n');
//   promptText = `You are analyzing a folder containing ${documents.length} document(s):\n${documentList}\n\n${promptText}\n\nPlease provide a comprehensive analysis considering ALL documents in this folder.`;

//   // Download files and convert to base64
//   const parts = [];
//   for (let i = 0; i < documents.length; i++) {
//     const doc = documents[i];
//     try {
//       // Extract GCS path from URI (gs://bucket/path -> path)
//       const gcsPath = doc.gcsUri.replace(/^gs:\/\/[^\/]+\//, '');
//       console.log(`🔄 [folderGeminiService] Downloading file ${i + 1}/${documents.length}: ${doc.filename}`);
//       console.log(`🔄 [folderGeminiService]   GCS Path: ${gcsPath}`);

//       const file = bucket.file(gcsPath);
//       const [exists] = await file.exists();
      
//       if (!exists) {
//         console.warn(`⚠️ [folderGeminiService] File not found in GCS: ${gcsPath}`);
//         continue;
//       }

//       const [fileBuffer] = await file.download();
//       const mimeType = doc.mimeType || getMimeTypeFromPath(doc.filename || gcsPath);
      
//       // Convert to base64
//       const base64Data = fileBuffer.toString('base64');
      
//       parts.push({
//         inlineData: {
//           mimeType: mimeType,
//           data: base64Data
//         }
//       });
      
//       console.log(`✅ [folderGeminiService]   Downloaded and converted to base64 (${fileBuffer.length} bytes)`);
//     } catch (downloadError) {
//       console.error(`❌ [folderGeminiService] Failed to download file ${doc.filename}:`, downloadError.message);
//       // Continue with other files
//     }
//   }

//   if (parts.length === 0) {
//     throw new Error('Failed to download any files from GCS');
//   }

//   // Add text prompt
//   parts.push({ text: promptText });

//   // Try models with direct file data - Use gemini-2.5-flash as primary
//   const modelNames = [
//     'gemini-2.5-flash',       // Primary: Fast and reliable
//     'gemini-2.5-flash-001',   // Alternative flash version
//     process.env.GEMINI_MODEL_NAME, // Custom model from env if set
//     'gemini-2.5-pro',         // Pro version (fallback)
//     'gemini-2.0-flash-001',   // Older flash version (fallback)
//     'gemini-3-pro-preview'    // Latest preview (fallback)
//   ].filter(Boolean);

//       for (const modelName of modelNames) {
//         try {
//           console.log(`🔄 [folderGeminiService] Attempting model with direct files: ${modelName}`);
//           const model = vertex_ai.getGenerativeModel({ model: modelName });

//           // Add timeout for fallback method too
//           const requestPromise = model.generateContent({
//             contents: [{
//               role: 'user',
//               parts: parts
//             }],
//             generationConfig: {
//               temperature: 0.7,
//               maxOutputTokens: 8192,
//             }
//           });

//           const timeoutPromise = new Promise((_, reject) => {
//             setTimeout(() => {
//               reject(new Error(`Request timeout: Fallback method took longer than 180 seconds. Model: ${modelName}`));
//             }, 180000);
//           });

//           console.log(`⏱️ [folderGeminiService] Starting fallback request with 180s timeout...`);
//           const result = await Promise.race([requestPromise, timeoutPromise]);
//           console.log(`✅ [folderGeminiService] Fallback request completed within timeout`);

//       if (!result.response || !result.response.candidates || !result.response.candidates.length) {
//         throw new Error('Empty response from Vertex AI');
//       }

//       const text = result.response.candidates[0].content.parts[0].text;
//       console.log(`✅ [folderGeminiService] Fallback method succeeded with ${modelName} (${text.length} chars)`);
//       return text;
//     } catch (err) {
//       console.warn(`⚠️ [folderGeminiService] Model ${modelName} failed with direct files:`, err.message);
//       continue;
//     }
//   }

//   throw new Error('All models failed with direct file method');
// }

// /**
//  * Ask Gemini with multiple GCS URIs (Folder Eyeball Method)
//  * This uses Gemini's native ability to process multiple documents directly from GCS
//  * which is more cost-effective than extracting and chunking text
//  * 
//  * @param {string} question - User's question or prompt
//  * @param {Array<{gcsUri: string, filename: string}>} documents - Array of document objects with GCS URI and filename
//  * @param {string} userContext - Optional user profile context
//  * @returns {Promise<string>} - LLM response
//  */
// async function askGeminiWithMultipleGCS(question, documents = [], userContext = '') {
//   console.log(`🔵 [folderGeminiService] askGeminiWithMultipleGCS called`);
//   console.log(`🔵 [folderGeminiService] Question length: ${question.length} chars`);
//   console.log(`🔵 [folderGeminiService] Documents count: ${documents.length}`);
//   console.log(`🔵 [folderGeminiService] User context: ${userContext ? 'provided' : 'none'}`);
  
//   try {
//     if (!documents || documents.length === 0) {
//       console.error(`❌ [folderGeminiService] No documents provided`);
//       throw new Error('No documents provided for folder analysis');
//     }

//     console.log(`🔵 [folderGeminiService] Initializing Vertex AI...`);
//     const vertex_ai = initializeVertexAI();
//     console.log(`🔵 [folderGeminiService] Vertex AI initialized`);
    
//     // Build prompt with context about multiple documents
//     let promptText = question;
//     if (userContext) {
//       promptText = `USER CONTEXT:\n${userContext}\n\nUSER QUESTION: ${question}`;
//     }

//     // Add folder context to prompt
//     const documentList = documents.map((doc, idx) => `${idx + 1}. ${doc.filename || `Document ${idx + 1}`}`).join('\n');
//     promptText = `You are analyzing a folder containing ${documents.length} document(s):\n${documentList}\n\n${promptText}\n\nPlease provide a comprehensive analysis considering ALL documents in this folder.`;

//     // Define model priority - Use gemini-2.5-flash as primary for Eyeball method
//     const modelNames = [
//       'gemini-2.5-flash',       // Primary: Fast and reliable for multi-document analysis
//       'gemini-2.5-flash-001',   // Alternative flash version
//       process.env.GEMINI_MODEL_NAME, // Custom model from env if set
//       'gemini-2.5-pro',         // Pro version with large context (fallback)
//       'gemini-2.0-flash-001',   // Older flash version (fallback)
//       'gemini-3-pro-preview'    // Latest preview (fallback)
//     ].filter(Boolean);

//     let lastError;

//     for (const modelName of modelNames) {
//       try {
//         console.log(`🔵 [folderGeminiService] Attempting model: ${modelName} (${documents.length} documents)`);
//         console.log(`🔵 [folderGeminiService] Model list: ${modelNames.join(', ')}`);

//         const model = vertex_ai.getGenerativeModel({ model: modelName });
//         console.log(`🔵 [folderGeminiService] Model instance created: ${modelName}`);

//         // Build parts array with all document file parts + text prompt
//         const parts = [];
//         console.log(`🔵 [folderGeminiService] Building parts array for ${documents.length} documents...`);

//         // Add all document file parts
//         for (let i = 0; i < documents.length; i++) {
//           const doc = documents[i];
//           console.log(`🔵 [folderGeminiService] Processing document ${i + 1}/${documents.length}: ${doc.filename || 'unknown'}`);
          
//           if (!doc.gcsUri || !doc.gcsUri.startsWith('gs://')) {
//             console.warn(`⚠️ [folderGeminiService] Skipping invalid GCS URI for document: ${doc.filename || 'unknown'}`);
//             console.warn(`⚠️ [folderGeminiService] GCS URI: ${doc.gcsUri}`);
//             continue;
//           }

//           const mimeType = doc.mimeType || getMimeTypeFromPath(doc.gcsUri);
//           console.log(`🔵 [folderGeminiService]   GCS URI: ${doc.gcsUri}`);
//           console.log(`🔵 [folderGeminiService]   MIME Type: ${mimeType}`);
          
//           parts.push({
//             fileData: {
//               mimeType: mimeType,
//               fileUri: doc.gcsUri
//             }
//           });
//           console.log(`🔵 [folderGeminiService]   Added to parts array`);
//         }

//         console.log(`🔵 [folderGeminiService] Total parts (documents): ${parts.length}`);

//         if (parts.length === 0) {
//           console.error(`❌ [folderGeminiService] No valid GCS URIs found in documents array`);
//           throw new Error('No valid GCS URIs found in documents array');
//         }

//         // Add text prompt at the end
//         parts.push({ text: promptText });
//         console.log(`🔵 [folderGeminiService] Added text prompt (${promptText.length} chars)`);
//         console.log(`🔵 [folderGeminiService] Total parts (including prompt): ${parts.length}`);

//         console.log(`🔵 [folderGeminiService] Calling model.generateContent...`);
//         console.log(`🔵 [folderGeminiService] Request config:`, {
//           model: modelName,
//           documentCount: parts.length - 1,
//           promptLength: promptText.length,
//           temperature: 0.7,
//           maxOutputTokens: 8192
//         });

//         // Add timeout to prevent hanging requests (3 minutes for large documents)
//         const requestPromise = model.generateContent({
//           contents: [{
//             role: 'user',
//             parts: parts
//           }],
//           generationConfig: {
//             temperature: 0.7,
//             maxOutputTokens: 8192, // Allow longer responses for comprehensive summaries
//           }
//         });

//         const timeoutPromise = new Promise((_, reject) => {
//           setTimeout(() => {
//             reject(new Error(`Request timeout: Gemini API request took longer than 180 seconds (3 minutes). Model: ${modelName}`));
//           }, 180000); // 3 minutes timeout
//         });

//         console.log(`⏱️ [folderGeminiService] Starting request with 180s timeout...`);
//         const result = await Promise.race([requestPromise, timeoutPromise]);
//         console.log(`✅ [folderGeminiService] Request completed within timeout`);

//         console.log(`🔵 [folderGeminiService] Response received from ${modelName}`);
//         console.log(`🔵 [folderGeminiService] Response structure:`, {
//           hasResponse: !!result.response,
//           hasCandidates: !!(result.response && result.response.candidates),
//           candidatesCount: result.response?.candidates?.length || 0
//         });

//         // Safely extract text
//         if (!result.response || !result.response.candidates || !result.response.candidates.length) {
//           console.error(`❌ [folderGeminiService] Empty response from Vertex AI`);
//           throw new Error('Empty response from Vertex AI');
//         }

//         const text = result.response.candidates[0].content.parts[0].text;
//         console.log(`✅ [folderGeminiService] Folder analysis completed with model: ${modelName} (${text.length} chars)`);
//         return text;

//       } catch (err) {
//         // Log detailed error information
//         console.error(`\n${'='.repeat(80)}`);
//         console.error(`❌ [folderGeminiService] ERROR DETAILS for model: ${modelName}`);
//         console.error(`❌ [folderGeminiService] Error type: ${err.name || 'Unknown'}`);
//         console.error(`❌ [folderGeminiService] Error message: ${err.message || 'No message'}`);
//         console.error(`❌ [folderGeminiService] Error status: ${err.status || err.code || 'N/A'}`);
//         if (err.stack) {
//           console.error(`❌ [folderGeminiService] Error stack (first 500 chars): ${err.stack.substring(0, 500)}`);
//         }
//         console.error(`${'='.repeat(80)}\n`);

//         // Check if this is a timeout error
//         const isTimeoutError = err.message && (
//           err.message.includes('timeout') ||
//           err.message.includes('Request timeout') ||
//           err.message.includes('took longer than')
//         );

//         if (isTimeoutError) {
//           console.error(`⏱️ [folderGeminiService] TIMEOUT ERROR: Request took too long. Trying next model...`);
//           lastError = err;
//           continue;
//         }

//         // Check if this is a GCS permission error (403 Forbidden with storage.objects.get)
//         const errorMessage = err.message || '';
//         const causeMessage = err.cause?.message || '';
//         const fullErrorText = `${errorMessage} ${causeMessage}`.toLowerCase();
        
//         const isPermissionError = (
//           err.status === 403 ||
//           err.code === 403 ||
//           fullErrorText.includes('storage.objects.get') ||
//           fullErrorText.includes('permission_denied') ||
//           fullErrorText.includes('permission denied') ||
//           fullErrorText.includes('does not have storage.objects.get access')
//         );

//         if (isPermissionError && modelName === modelNames[0]) {
//           // Only try fallback on first model attempt to avoid multiple downloads
//           console.log(`\n${'='.repeat(80)}`);
//           console.log(`⚠️ [folderGeminiService] GCS PERMISSION ERROR DETECTED`);
//           console.log(`⚠️ [folderGeminiService] Error: ${errorMessage.substring(0, 200)}`);
//           console.log(`⚠️ [folderGeminiService] Attempting fallback: Download files and use direct file data...`);
//           console.log(`${'='.repeat(80)}\n`);
//           try {
//             const result = await askGeminiWithDirectFiles(question, documents, userContext);
//             console.log(`\n${'='.repeat(80)}`);
//             console.log(`✅ [folderGeminiService] FALLBACK METHOD SUCCEEDED`);
//             console.log(`✅ [folderGeminiService] Using direct file download instead of GCS URIs`);
//             console.log(`${'='.repeat(80)}\n`);
//             return result;
//           } catch (fallbackError) {
//             console.error(`\n${'='.repeat(80)}`);
//             console.error(`❌ [folderGeminiService] FALLBACK METHOD ALSO FAILED`);
//             console.error(`❌ [folderGeminiService] Error: ${fallbackError.message}`);
//             console.log(`${'='.repeat(80)}\n`);
//             // Continue to next model or throw
//             lastError = fallbackError;
//           }
//         }

//         console.error(`❌ [folderGeminiService] Model ${modelName} failed for folder analysis`);
//         console.error(`❌ [folderGeminiService] Error message: ${err.message}`);
//         console.error(`❌ [folderGeminiService] Error code: ${err.code || 'N/A'}`);
//         console.error(`❌ [folderGeminiService] Error status: ${err.status || 'N/A'}`);
//         console.error(`❌ [folderGeminiService] Error details:`, JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
//         console.error(`❌ [folderGeminiService] Error stack:`, err.stack);
//         lastError = err;
//         continue;
//       }
//     }

//     const errorMessage = `All Gemini models failed for folder analysis. Last error: ${lastError?.message}`;
//     console.error(`❌ [folderGeminiService] ${errorMessage}`);
//     console.error(`❌ [folderGeminiService] Last error details:`, JSON.stringify(lastError, Object.getOwnPropertyNames(lastError), 2));
//     throw new Error(errorMessage);
//   } catch (error) {
//     console.error(`❌ [folderGeminiService] Fatal Error in askGeminiWithMultipleGCS`);
//     console.error(`❌ [folderGeminiService] Error message: ${error.message}`);
//     console.error(`❌ [folderGeminiService] Error stack: ${error.stack}`);
//     console.error(`❌ [folderGeminiService] Full error:`, JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
//     throw error;
//   }
// }

// /**
//  * Stream Gemini response with multiple GCS URIs (Folder Eyeball Method)
//  * Returns an async generator that yields text chunks
//  * 
//  * @param {string} question - User's question or prompt
//  * @param {Array<{gcsUri: string, filename: string}>} documents - Array of document objects
//  * @param {string} userContext - Optional user profile context
//  * @returns {AsyncGenerator<string>} - Yields text chunks as they arrive
//  */
// async function* streamGeminiWithMultipleGCS(question, documents = [], userContext = '') {
//   try {
//     if (!documents || documents.length === 0) {
//       throw new Error('No documents provided for folder analysis');
//     }

//     const vertex_ai = initializeVertexAI();
    
//     // Build prompt
//     let promptText = question;
//     if (userContext) {
//       promptText = `USER CONTEXT:\n${userContext}\n\nUSER QUESTION: ${question}`;
//     }

//     const documentList = documents.map((doc, idx) => `${idx + 1}. ${doc.filename || `Document ${idx + 1}`}`).join('\n');
//     promptText = `You are analyzing a folder containing ${documents.length} document(s):\n${documentList}\n\n${promptText}\n\nPlease provide a comprehensive analysis considering ALL documents in this folder.`;

//     // Use gemini-2.5-flash as primary for streaming
//     const modelNames = [
//       'gemini-2.5-flash',       // Primary: Fast and reliable for streaming
//       'gemini-2.5-flash-001',   // Alternative flash version
//       process.env.GEMINI_MODEL_NAME, // Custom model from env if set
//       'gemini-2.5-pro',         // Pro version (fallback)
//       'gemini-2.0-flash-001',   // Older flash version (fallback)
//       'gemini-3-pro-preview'    // Latest preview (fallback)
//     ].filter(Boolean);

//     let lastError;

//     for (const modelName of modelNames) {
//       try {
//         console.log(`🤖 Streaming folder analysis with Gemini model: ${modelName} (${documents.length} documents)`);

//         const model = vertex_ai.getGenerativeModel({ model: modelName });

//         // Build parts array
//         const parts = [];
//         for (const doc of documents) {
//           if (!doc.gcsUri || !doc.gcsUri.startsWith('gs://')) {
//             console.warn(`⚠️ Skipping invalid GCS URI for document: ${doc.filename || 'unknown'}`);
//             continue;
//           }

//           const mimeType = doc.mimeType || getMimeTypeFromPath(doc.gcsUri);
//           parts.push({
//             fileData: {
//               mimeType: mimeType,
//               fileUri: doc.gcsUri
//             }
//           });
//         }

//         if (parts.length === 0) {
//           throw new Error('No valid GCS URIs found in documents array');
//         }

//         parts.push({ text: promptText });

//         // Use streaming API
//         const streamingResp = await model.generateContentStream({
//           contents: [{
//             role: 'user',
//             parts: parts
//           }],
//           generationConfig: {
//             temperature: 0.7,
//             maxOutputTokens: 8192,
//           }
//         });

//         // Stream chunks with reasoning/thinking support
//         let totalChunks = 0;
//         for await (const chunk of streamingResp.stream) {
//           let chunkText = '';
//           let reasoningText = '';
          
//           if (chunk.text) {
//             chunkText = chunk.text;
//           } else if (chunk.candidates && chunk.candidates[0]) {
//             const candidate = chunk.candidates[0];
//             if (candidate.content && candidate.content.parts) {
//               for (const part of candidate.content.parts) {
//                 if (part.text) {
//                   chunkText += part.text;
//                 }
//                 // Check for reasoning tokens (Gemini thinking process)
//                 if (part.reasoningMetadata || part.reasoning) {
//                   reasoningText += part.reasoning || '';
//                 }
//               }
//             } else if (candidate.delta && candidate.delta.content && candidate.delta.content.parts) {
//               for (const part of candidate.delta.content.parts) {
//                 if (part.text) {
//                   chunkText += part.text;
//                 }
//                 // Check for reasoning tokens in delta
//                 if (part.reasoningMetadata || part.reasoning) {
//                   reasoningText += part.reasoning || '';
//                 }
//               }
//             }
//           }
          
//           // Yield reasoning/thinking tokens separately if present
//           if (reasoningText) {
//             yield { type: 'thinking', text: reasoningText };
//           }
          
//           // Yield content tokens
//           if (chunkText) {
//             totalChunks++;
//             yield { type: 'content', text: chunkText };
//           }
//         }
        
//         console.log(`✅ Streamed ${totalChunks} chunks from ${modelName}`);
//         return;

//       } catch (err) {
//         console.warn(`⚠️ Model ${modelName} streaming failed: ${err.message}`);
//         lastError = err;
//         continue;
//       }
//     }

//     throw new Error(`All Gemini models failed for folder streaming. Last error: ${lastError?.message}`);
//   } catch (error) {
//     console.error(`❌ Fatal Error in streamGeminiWithMultipleGCS:`, error.message);
//     throw error;
//   }
// }

// module.exports = {
//   askGeminiWithMultipleGCS,
//   streamGeminiWithMultipleGCS,
//   getMimeTypeFromPath,
// };



/**
 * Folder-Level Gemini Eyeball Service
 * Handles multiple document analysis using Gemini's native GCS URI support
 * This service is optimized for folder-level summaries and comprehensive analysis
 * while minimizing token consumption by using Gemini's native document processing
 */

const { VertexAI } = require('@google-cloud/vertexai');
const path = require('path');
const pool = require('../config/db');
const { bucket } = require('../config/gcs');

// --- Initialization ---

function getGCSProjectId() {
  try {
    if (process.env.GCP_PROJECT_ID) {
      return process.env.GCP_PROJECT_ID;
    }

    if (process.env.GCS_KEY_BASE64) {
      const jsonString = Buffer.from(process.env.GCS_KEY_BASE64, 'base64').toString('utf-8');
      const credentials = JSON.parse(jsonString);
      if (credentials.project_id) {
        return credentials.project_id;
      }
    }
    
    throw new Error('GCP_PROJECT_ID not found. Set GCP_PROJECT_ID in .env');
  } catch (error) {
    console.error('❌ Failed to get GCP Project ID:', error.message);
    throw error;
  }
}

let vertexAI;
function initializeVertexAI() {
  if (vertexAI) return vertexAI;
  
  try {
    const projectId = getGCSProjectId();
    const location = process.env.GCP_LOCATION || 'us-central1';
    
    console.log(`🚀 Initializing Vertex AI for folder Gemini service: ${projectId}, location: ${location}`);
    
    vertexAI = new VertexAI({
      project: projectId,
      location: location,
    });
    
    return vertexAI;
  } catch (error) {
    console.error('❌ Failed to initialize Vertex AI:', error.message);
    throw new Error(`Vertex AI initialization failed: ${error.message}`);
  }
}

/**
 * File size limits for Vertex AI (in bytes)
 */
const FILE_SIZE_LIMITS = {
  'application/pdf': 52428800, // 50MB
  'image/jpeg': 10485760, // 10MB
  'image/png': 10485760, // 10MB
  'image/gif': 10485760, // 10MB
  'image/webp': 10485760, // 10MB
  'video/mp4': 52428800, // 50MB
  'video/mpeg': 52428800, // 50MB
  'video/mov': 52428800, // 50MB
  'video/avi': 52428800, // 50MB
  'video/webm': 52428800, // 50MB
  'text/plain': 10485760, // 10MB
  'text/csv': 10485760, // 10MB
  'application/msword': 52428800, // 50MB
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 52428800, // 50MB
};

/**
 * Model cascade - Only models available in us-central1
 * Ordered by performance and reliability
 */
const GEMINI_MODELS_CASCADE = [
  'gemini-2.5-flash',      // Primary: Fast and reliable
  'gemini-2.5-pro',        // Most capable 2.5
  'gemini-2.0-flash-001',  // Stable 2.0
  'gemini-1.5-flash-002',  // Fallback 1.5 flash
  'gemini-1.5-pro-002',    // Fallback 1.5 pro
];

/**
 * Get MIME type from file extension
 */
function getMimeTypeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.csv': 'text/csv',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Check if a GCS file exceeds size limits
 */
async function checkFileSize(gcsUri, mimeType) {
  try {
    // Parse GCS URI: gs://bucket/path/to/file
    const match = gcsUri.match(/^gs:\/\/([^\/]+)\/(.+)$/);
    if (!match) {
      console.warn(`⚠️ Invalid GCS URI format: ${gcsUri}`);
      return { valid: true, warning: 'Invalid URI format, skipping check' };
    }

    const [, bucketName, filePath] = match;
    const file = bucket.file(filePath);

    // Get file metadata
    const [metadata] = await file.getMetadata();
    const fileSize = parseInt(metadata.size || '0', 10);
    const limit = FILE_SIZE_LIMITS[mimeType] || 52428800; // Default 50MB

    if (fileSize > limit) {
      const fileSizeMB = (fileSize / 1048576).toFixed(2);
      const limitMB = (limit / 1048576).toFixed(2);
      return {
        valid: false,
        reason: `File size ${fileSizeMB}MB exceeds ${limitMB}MB limit`,
        fileSize,
        limit,
        fileSizeMB,
        limitMB
      };
    }

    return { valid: true, fileSize };
  } catch (error) {
    console.warn(`⚠️ Error checking file size for ${gcsUri}: ${error.message}`);
    // If we can't check, assume it's valid (let Vertex AI handle it)
    return { valid: true, warning: error.message };
  }
}

/**
 * Filter out files that are too large
 */
async function filterValidFiles(documents) {
  const validFiles = [];
  const skippedFiles = [];

  for (const doc of documents) {
    if (!doc.gcsUri || !doc.gcsUri.startsWith('gs://')) {
      console.warn(`⚠️ Skipping invalid GCS URI: ${doc.filename || 'unknown'}`);
      skippedFiles.push({
        filename: doc.filename || 'unknown',
        uri: doc.gcsUri,
        reason: 'Invalid GCS URI format'
      });
      continue;
    }

    const mimeType = doc.mimeType || getMimeTypeFromPath(doc.gcsUri);
    const check = await checkFileSize(doc.gcsUri, mimeType);

    if (check.valid) {
      validFiles.push({
        ...doc,
        mimeType // Ensure mimeType is set
      });
    } else {
      skippedFiles.push({
        filename: doc.filename || doc.gcsUri.split('/').pop(),
        uri: doc.gcsUri,
        reason: check.reason,
        size: check.fileSizeMB,
        limit: check.limitMB
      });
      console.warn(`⏭️ Skipping oversized file: ${doc.filename || doc.gcsUri} (${check.fileSizeMB}MB > ${check.limitMB}MB)`);
    }
  }

  return { validFiles, skippedFiles };
}

/**
 * Build user-friendly skip notification
 */
function buildSkipNotification(skippedFiles) {
  if (skippedFiles.length === 0) return '';

  const lines = [
    `\n⚠️ **Note:** ${skippedFiles.length} file(s) were skipped due to size limits:\n`
  ];

  for (const file of skippedFiles) {
    if (file.size && file.limit) {
      lines.push(`- **${file.filename}**: ${file.size}MB (limit: ${file.limit}MB)`);
    } else {
      lines.push(`- **${file.filename}**: ${file.reason || 'Size limit exceeded'}`);
    }
  }

  lines.push('\nProcessing remaining files...\n\n');
  return lines.join('\n');
}

/**
 * Fallback method: Download files from GCS and pass directly to Gemini
 * Used when GCS URI access fails due to permissions
 */
async function askGeminiWithDirectFiles(question, documents = [], userContext = '') {
  console.log(`🔄 [folderGeminiService] Using fallback: Direct file download method`);
  console.log(`🔄 [folderGeminiService] Downloading ${documents.length} files from GCS...`);

  const vertex_ai = initializeVertexAI();
  
  // Build prompt
  let promptText = question;
  if (userContext) {
    promptText = `USER CONTEXT:\n${userContext}\n\nUSER QUESTION: ${question}`;
  }

  const documentList = documents.map((doc, idx) => `${idx + 1}. ${doc.filename || `Document ${idx + 1}`}`).join('\n');
  promptText = `You are analyzing a folder containing ${documents.length} document(s):\n${documentList}\n\n${promptText}\n\nPlease provide a comprehensive analysis considering ALL documents in this folder.`;

  // Download files and convert to base64
  const parts = [];
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    try {
      // Extract GCS path from URI (gs://bucket/path -> path)
      const gcsPath = doc.gcsUri.replace(/^gs:\/\/[^\/]+\//, '');
      console.log(`🔄 [folderGeminiService] Downloading file ${i + 1}/${documents.length}: ${doc.filename}`);

      const file = bucket.file(gcsPath);
      const [exists] = await file.exists();
      
      if (!exists) {
        console.warn(`⚠️ [folderGeminiService] File not found in GCS: ${gcsPath}`);
        continue;
      }

      const [fileBuffer] = await file.download();
      const mimeType = doc.mimeType || getMimeTypeFromPath(doc.filename || gcsPath);
      
      // Convert to base64
      const base64Data = fileBuffer.toString('base64');
      
      parts.push({
        inlineData: {
          mimeType: mimeType,
          data: base64Data
        }
      });
      
      console.log(`✅ [folderGeminiService]   Downloaded and converted to base64 (${fileBuffer.length} bytes)`);
    } catch (downloadError) {
      console.error(`❌ [folderGeminiService] Failed to download file ${doc.filename}:`, downloadError.message);
    }
  }

  if (parts.length === 0) {
    throw new Error('Failed to download any files from GCS');
  }

  // Add text prompt
  parts.push({ text: promptText });

  // Try models
  for (const modelName of GEMINI_MODELS_CASCADE) {
    try {
      console.log(`🔄 [folderGeminiService] Attempting model with direct files: ${modelName}`);
      const model = vertex_ai.getGenerativeModel({ model: modelName });

      const requestPromise = model.generateContent({
        contents: [{
          role: 'user',
          parts: parts
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8192,
        }
      });

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Request timeout: Fallback method took longer than 180 seconds`));
        }, 180000);
      });

      const result = await Promise.race([requestPromise, timeoutPromise]);

      if (!result.response || !result.response.candidates || !result.response.candidates.length) {
        throw new Error('Empty response from Vertex AI');
      }

      const text = result.response.candidates[0].content.parts[0].text;
      console.log(`✅ [folderGeminiService] Fallback method succeeded with ${modelName}`);
      return text;
    } catch (err) {
      console.warn(`⚠️ [folderGeminiService] Model ${modelName} failed with direct files:`, err.message);
      continue;
    }
  }

  throw new Error('All models failed with direct file method');
}

/**
 * Ask Gemini with multiple GCS URIs (Folder Eyeball Method)
 */
async function askGeminiWithMultipleGCS(question, documents = [], userContext = '') {
  console.log(`🔵 [folderGeminiService] askGeminiWithMultipleGCS called with ${documents.length} documents`);
  
  try {
    if (!documents || documents.length === 0) {
      throw new Error('No documents provided for folder analysis');
    }

    // Filter files by size BEFORE attempting any model
    const { validFiles, skippedFiles } = await filterValidFiles(documents);

    if (validFiles.length === 0) {
      throw new Error('All files were skipped due to size limits. Please reduce file sizes and try again.');
    }

    if (skippedFiles.length > 0) {
      console.warn(`⚠️ Skipped ${skippedFiles.length} oversized files, proceeding with ${validFiles.length} valid files`);
    }

    const vertex_ai = initializeVertexAI();
    
    // Build prompt
    let promptText = question;
    if (userContext) {
      promptText = `USER CONTEXT:\n${userContext}\n\nUSER QUESTION: ${question}`;
    }

    const documentList = validFiles.map((doc, idx) => `${idx + 1}. ${doc.filename || `Document ${idx + 1}`}`).join('\n');
    promptText = `You are analyzing a folder containing ${validFiles.length} document(s):\n${documentList}\n\n${promptText}\n\nPlease provide a comprehensive analysis considering ALL documents in this folder.`;

    let lastError;

    for (const modelName of GEMINI_MODELS_CASCADE) {
      try {
        console.log(`🤖 Analyzing folder with model: ${modelName} (${validFiles.length} documents)`);

        const model = vertex_ai.getGenerativeModel({ model: modelName });

        // Build parts array
        const parts = validFiles.map(doc => ({
          fileData: {
            mimeType: doc.mimeType,
            fileUri: doc.gcsUri
          }
        }));

        parts.push({ text: promptText });

        const requestPromise = model.generateContent({
          contents: [{
            role: 'user',
            parts: parts
          }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 8192,
          }
        });

        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`Request timeout for ${modelName}`)), 180000);
        });

        const result = await Promise.race([requestPromise, timeoutPromise]);

        if (!result.response || !result.response.candidates || !result.response.candidates.length) {
          throw new Error('Empty response from Vertex AI');
        }

        const text = result.response.candidates[0].content.parts[0].text;
        console.log(`✅ Folder analysis completed with ${modelName}`);
        return text;

      } catch (err) {
        console.warn(`⚠️ Model ${modelName} failed:`, err.message);
        lastError = err;

        // Check for permission errors - only try fallback on first model
        const errorMessage = (err.message || '').toLowerCase();
        const isPermissionError = (
          err.status === 403 ||
          err.code === 403 ||
          errorMessage.includes('storage.objects.get') ||
          errorMessage.includes('permission denied')
        );

        if (isPermissionError && modelName === GEMINI_MODELS_CASCADE[0]) {
          console.log(`⚠️ GCS permission error, attempting fallback method...`);
          try {
            return await askGeminiWithDirectFiles(question, validFiles, userContext);
          } catch (fallbackError) {
            console.error(`❌ Fallback method failed:`, fallbackError.message);
          }
        }

        continue;
      }
    }

    throw new Error(`All Gemini models failed. Last error: ${lastError?.message}`);
  } catch (error) {
    console.error(`❌ Fatal Error in askGeminiWithMultipleGCS:`, error.message);
    throw error;
  }
}

/**
 * Stream Gemini response with multiple GCS URIs (Folder Eyeball Method)
 * ✅ FIXED: Yields plain text strings instead of objects
 */
async function* streamGeminiWithMultipleGCS(question, documents = [], userContext = '') {
  try {
    if (!documents || documents.length === 0) {
      throw new Error('No documents provided for folder analysis');
    }

    console.log(`📋 [Stream] Checking ${documents.length} files for size limits...`);

    // Filter files by size BEFORE attempting any model
    const { validFiles, skippedFiles } = await filterValidFiles(documents);

    // Notify about skipped files
    if (skippedFiles.length > 0) {
      const notification = buildSkipNotification(skippedFiles);
      console.warn(`⚠️ [Stream] ${skippedFiles.length} files skipped due to size limits`);
      yield notification; // Yield notification as plain string
    }

    if (validFiles.length === 0) {
      throw new Error('All files were skipped due to size limits. Please reduce file sizes and try again.');
    }

    console.log(`🤖 [Stream] Processing ${validFiles.length} valid files (${skippedFiles.length} skipped)`);

    const vertex_ai = initializeVertexAI();
    
    // Build prompt
    let promptText = question;
    if (userContext) {
      promptText = `USER CONTEXT:\n${userContext}\n\nUSER QUESTION: ${question}`;
    }

    const documentList = validFiles.map((doc, idx) => `${idx + 1}. ${doc.filename || `Document ${idx + 1}`}`).join('\n');
    promptText = `You are analyzing a folder containing ${validFiles.length} document(s):\n${documentList}\n\n${promptText}\n\nPlease provide a comprehensive analysis considering ALL documents in this folder.`;

    let lastError;

    for (const modelName of GEMINI_MODELS_CASCADE) {
      try {
        console.log(`🤖 [Stream] Attempting model: ${modelName} (${validFiles.length} documents)`);

        const model = vertex_ai.getGenerativeModel({ model: modelName });

        // Build parts array
        const parts = validFiles.map(doc => ({
          fileData: {
            mimeType: doc.mimeType,
            fileUri: doc.gcsUri
          }
        }));

        parts.push({ text: promptText });

        // Use streaming API
        const streamingResp = await model.generateContentStream({
          contents: [{
            role: 'user',
            parts: parts
          }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 8192,
          }
        });

        // Stream chunks - FIXED: Yield plain text strings
        let totalChunks = 0;
        for await (const chunk of streamingResp.stream) {
          let chunkText = '';
          
          if (chunk.text) {
            chunkText = chunk.text;
          } else if (chunk.candidates && chunk.candidates[0]) {
            const candidate = chunk.candidates[0];
            if (candidate.content && candidate.content.parts) {
              for (const part of candidate.content.parts) {
                if (part.text) {
                  chunkText += part.text;
                }
              }
            }
          }
          
          if (chunkText) {
            totalChunks++;
            yield chunkText; // ✅ FIXED: Yield plain string, not object
          }
        }
        
        console.log(`✅ [Stream] Completed with ${modelName} (${totalChunks} chunks, ${validFiles.length} files)`);
        return; // Success, exit function

      } catch (err) {
        console.warn(`⚠️ [Stream] Model ${modelName} failed:`, err.message);
        lastError = err;

        // Check if model not found
        const errorMessage = (err.message || '').toLowerCase();
        if (errorMessage.includes('not found') || errorMessage.includes('404')) {
          console.warn(`⏭️ [Stream] Model ${modelName} not available, trying next...`);
          continue;
        }

        // Check for file size errors (shouldn't happen after filtering, but just in case)
        if (errorMessage.includes('file size') || errorMessage.includes('exceeds')) {
          console.error(`❌ [Stream] File size error even after filtering`);
          throw new Error('File size limit exceeded even after filtering. Please reduce file sizes further.');
        }

        continue;
      }
    }

    throw new Error(`All Gemini models failed for streaming. Last error: ${lastError?.message}`);
  } catch (error) {
    console.error(`❌ [Stream] Fatal error:`, error.message);
    throw error;
  }
}

module.exports = {
  askGeminiWithMultipleGCS,
  streamGeminiWithMultipleGCS,
  getMimeTypeFromPath,
  checkFileSize,
  filterValidFiles,
  GEMINI_MODELS_CASCADE,
  FILE_SIZE_LIMITS,
};