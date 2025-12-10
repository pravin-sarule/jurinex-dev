// const { VertexAI } = require('@google-cloud/vertexai');
// const { Storage } = require('@google-cloud/storage');
// const path = require('path');

// // --- Initialization ---

// /**
//  * Get GCS credentials to extract project ID
//  */
// function getGCSProjectId() {
//   try {
//     const { storage } = require('../config/gcs');
//     if (!storage) {
//       throw new Error('GCS Storage client not initialized');
//     }
    
//     // Get project ID from environment or credentials
//     if (process.env.GCP_PROJECT_ID) {
//       return process.env.GCP_PROJECT_ID;
//     }
    
//     // Try to get from GCS config
//     if (process.env.GCS_KEY_BASE64) {
//       const jsonString = Buffer.from(process.env.GCS_KEY_BASE64, 'base64').toString('utf-8');
//       const credentials = JSON.parse(jsonString);
//       if (credentials.project_id) {
//         return credentials.project_id;
//       }
//     }
    
//     throw new Error('GCP_PROJECT_ID not found. Set GCP_PROJECT_ID in .env or ensure GCS_KEY_BASE64 contains project_id');
//   } catch (error) {
//     console.error('❌ Failed to get GCP Project ID:', error.message);
//     throw error;
//   }
// }

// /**
//  * Initialize Vertex AI client
//  * Vertex AI uses Google Cloud IAM authentication (service account)
//  * It will automatically use GOOGLE_APPLICATION_CREDENTIALS or GCS credentials
//  */
// let vertexAI;
// function initializeVertexAI() {
//   if (vertexAI) {
//     return vertexAI;
//   }
  
//   try {
//     const projectId = getGCSProjectId();
//     const location = process.env.GCP_LOCATION || 'us-central1'; // Default to us-central1
    
//     console.log(`🚀 Initializing Vertex AI for project: ${projectId}, location: ${location}`);
    
//     vertexAI = new VertexAI({
//       project: projectId,
//       location: location,
//     });
    
//     console.log('✅ Vertex AI initialized successfully');
//     return vertexAI;
//   } catch (error) {
//     console.error('❌ Failed to initialize Vertex AI:', error.message);
//     throw new Error(`Vertex AI initialization failed: ${error.message}`);
//   }
// }

// /**
//  * Initialize GCS Storage client (use singleton from config)
//  */
// function getStorageClient() {
//   try {
//     const { storage } = require('../config/gcs');
//     if (!storage) {
//       throw new Error('Storage client not exported from config.');
//     }
//     return storage;
//   } catch (e) {
//     console.error('❌ Could not load GCS configuration:', e.message);
//     throw new Error('GCS Storage client not initialized. Check GCS_KEY_BASE64 and ../config/gcs');
//   }
// }

// // --- Utility Functions ---

// /**
//  * Get MIME type from file extension
//  * @param {string} filePath - File path
//  * @returns {string} - MIME type
//  */
// function getMimeTypeFromPath(filePath) {
//   const ext = path.extname(filePath).toLowerCase();
//   const mimeTypes = {
//     '.pdf': 'application/pdf',
//     '.txt': 'text/plain',
//     '.md': 'text/markdown',
//     '.doc': 'application/msword',
//     '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
//     '.xls': 'application/vnd.ms-excel',
//     '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
//     '.jpg': 'image/jpeg',
//     '.jpeg': 'image/jpeg',
//     '.png': 'image/png',
//     '.gif': 'image/gif',
//     '.mp4': 'video/mp4',
//     '.mp3': 'audio/mp3',
//   };
//   return mimeTypes[ext] || 'application/octet-stream';
// }

// /**
//  * Verify GCS file exists
//  * @param {string} gcsUri - GCS URI (gs://bucket/path)
//  * @returns {Promise<{bucketName: string, filePath: string, mimeType: string}>}
//  */
// async function verifyGCSFile(gcsUri) {
//   try {
//     // Parse GCS URI: gs://bucket-name/path/to/file
//     if (!gcsUri.startsWith('gs://')) {
//       throw new Error(`Invalid GCS URI format: Must start with 'gs://'. URI: ${gcsUri}`);
//     }
    
//     const uriPath = gcsUri.substring(5); // Remove 'gs://'
//     const firstSlashIndex = uriPath.indexOf('/');
    
//     if (firstSlashIndex === -1) {
//       throw new Error(`Invalid GCS URI format: Missing file path after bucket name. URI: ${gcsUri}`);
//     }

//     const bucketName = uriPath.substring(0, firstSlashIndex);
//     const filePath = uriPath.substring(firstSlashIndex + 1);

//     if (!bucketName || !filePath) {
//       throw new Error(`Invalid GCS URI structure. Bucket: ${bucketName}, Path: ${filePath}`);
//     }
    
//     console.log(`📖 Verifying GCS file: ${bucketName}/${filePath}`);
    
//     const storage = getStorageClient();
//     const file = storage.bucket(bucketName).file(filePath);
    
//     // Check if file exists
//     const [exists] = await file.exists();
//     if (!exists) {
//       throw new Error(`File not found in GCS: ${gcsUri}`);
//     }
    
//     const mimeType = getMimeTypeFromPath(filePath);
//     console.log(`✅ GCS file verified. MIME type: ${mimeType}`);
    
//     return { bucketName, filePath, mimeType };
//   } catch (error) {
//     console.error(`❌ Error verifying GCS file:`, error.message);
//     throw error;
//   }
// }

// // --- Core LLM Function ---

// /**
//  * Ask LLM with GCS URI using Vertex AI (supports direct gs:// URIs)
//  * This method passes the GCS URI directly to Gemini via Vertex AI, which can "see" the document
//  * without needing to extract text first. Supports PDFs, images, and other formats.
//  * 
//  * @param {string} question - User's question
//  * @param {string} gcsUri - GCS URI of the document (gs://bucket/path)
//  * @param {string} userContext - Optional user profile context
//  * @returns {Promise<string>} - LLM response
//  */
// async function askLLMWithGCS(question, gcsUri, userContext = '') {
//   try {
//     // Initialize Vertex AI
//     const vertex_ai = initializeVertexAI();
    
//     // Verify file exists and get MIME type
//     const { mimeType } = await verifyGCSFile(gcsUri);
    
//     // Build the prompt with user context if provided
//     let promptText = question;
//     if (userContext) {
//       promptText = `USER CONTEXT:\n${userContext}\n\nUSER QUESTION: ${question}`;
//     }
    
//     // Try multiple models in order of preference (using latest stable models)
//     // Vertex AI supports the same model names as Google AI Studio
//     const modelNames = [
//       process.env.GEMINI_MODEL_NAME, // Custom from env (allows override)
//       'gemini-2.5-pro',              // Best for complex reasoning & long documents (1M context)
//       'gemini-2.5-flash',            // Best balance of speed, price, and intelligence
//       'gemini-1.5-pro',              // Stable pro model (widely supported)
//       'gemini-1.5-flash'             // Fast and efficient fallback
//     ].filter(Boolean); // Remove undefined/null entries
    
//     let lastError;
    
//     // Iterate and try models
//     for (const modelName of modelNames) {
//       try {
//         console.log(`🤖 Attempting to use Gemini model: ${modelName} with GCS URI: ${gcsUri}`);
        
//         // Get the generative model from Vertex AI
//         const model = vertex_ai.getGenerativeModel({ 
//           model: modelName 
//         });
        
//         // Create file part with GCS URI (Vertex AI supports gs:// directly!)
//         const filePart = {
//           fileData: {
//             mimeType: mimeType,
//             fileUri: gcsUri // This works natively with Vertex AI!
//           }
//         };
        
//         console.log(`🤖 Sending multimodal request via Vertex AI (GCS URI method)`);
//         console.log(`   File URI: ${gcsUri}`);
//         console.log(`   MIME Type: ${mimeType}`);
        
//         // Generate content using Vertex AI format
//         // Vertex AI uses a different structure than Google AI Studio
//         const result = await model.generateContent({
//           contents: [
//             {
//               role: 'user',
//               parts: [
//                 filePart,
//                 { text: promptText }
//               ]
//             }
//           ],
//         });
        
//         // Extract response text from Vertex AI response structure
//         const response = result.response;
//         const text = response.candidates[0].content.parts[0].text;
        
//         console.log(`✅ LLM response received (length: ${text.length} chars) using model: ${modelName}`);
//         return text;
//       } catch (modelError) {
//         console.warn(`⚠️ Model ${modelName} failed:`, modelError.message);
//         lastError = modelError;
//         continue;
//       }
//     }
    
//     // If all models failed, throw the last error
//     throw new Error(`All Gemini models failed. Tried: ${modelNames.join(', ')}. Last error: ${lastError?.message || "Unknown API error."}`);
//   } catch (error) {
//     console.error(`❌ Fatal Error in askLLMWithGCS:`, error.message);
//     throw error;
//   }
// }

// module.exports = {
//   askLLMWithGCS,
//   verifyGCSFile,
//   getMimeTypeFromPath,
// };


const { VertexAI } = require('@google-cloud/vertexai');
const { Storage } = require('@google-cloud/storage');
const path = require('path');

// --- Initialization ---

/**
 * Get GCS credentials to extract project ID
 */
function getGCSProjectId() {
  try {
    // Try environment variable first
    if (process.env.GCP_PROJECT_ID) {
      return process.env.GCP_PROJECT_ID;
    }

    // Try extracting from Base64 key
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

/**
 * Initialize Vertex AI client
 */
let vertexAI;
function initializeVertexAI() {
  if (vertexAI) return vertexAI;
  
  try {
    const projectId = getGCSProjectId();
    // 'us-central1' is the most reliable region for new Gemini models
    const location = process.env.GCP_LOCATION || 'us-central1'; 
    
    console.log(`🚀 Initializing Vertex AI for project: ${projectId}, location: ${location}`);
    
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
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// --- Core Function ---

async function askLLMWithGCS(question, gcsUri, userContext = '') {
  try {
    const vertex_ai = initializeVertexAI();
    
    // 1. Parse GCS URI
    if (!gcsUri.startsWith('gs://')) throw new Error('Invalid GCS URI');
    const mimeType = getMimeTypeFromPath(gcsUri);

    // 2. Build Prompt
    let promptText = question;
    if (userContext) {
      promptText = `USER CONTEXT:\n${userContext}\n\nUSER QUESTION: ${question}`;
    }

    // 3. Define Valid Models (Nov 2025 List)
    // Note: Gemini 1.5 is retired. We prioritize 2.5 and 3.
    const modelNames = [
      process.env.GEMINI_MODEL_NAME, 
      'gemini-2.5-flash-001',   // Try specific version first (most stable)
      'gemini-2.5-flash',       // Alias
      'gemini-2.5-pro-001',     // Pro version
      'gemini-2.5-pro',         // Pro Alias
      'gemini-3-pro-preview',   // Latest Preview
      'gemini-2.0-flash-001'    // Fallback to 2.0 if 2.5 fails
    ].filter(Boolean);

    let lastError;

    for (const modelName of modelNames) {
      try {
        console.log(`🤖 Attempting Vertex AI model: ${modelName}`);

        const model = vertex_ai.getGenerativeModel({ model: modelName });

        const filePart = {
          fileData: {
            mimeType: mimeType,
            fileUri: gcsUri // Native gs:// support in Vertex AI
          }
        };

        const result = await model.generateContent({
          contents: [{
            role: 'user',
            parts: [filePart, { text: promptText }]
          }]
        });

        // Safely extract text
        if (!result.response || !result.response.candidates || !result.response.candidates.length) {
          throw new Error('Empty response from Vertex AI');
        }

        const text = result.response.candidates[0].content.parts[0].text;
        console.log(`✅ Success with model: ${modelName}`);
        return text;

      } catch (err) {
        // Log the specific error for this model to help debugging
        console.warn(`⚠️ Model ${modelName} failed: ${err.message}`);
        lastError = err;
        continue; // Try next model
      }
    }

    // If we get here, all models failed
    throw new Error(`All Vertex AI models failed. Last error: ${lastError?.message}`);

  } catch (error) {
    console.error(`❌ Fatal Error in askLLMWithGCS:`, error.message);
    throw error;
  }
}

/**
 * Stream LLM response with GCS URI using Vertex AI
 * Returns an async generator that yields text chunks
 * 
 * @param {string} question - User's question
 * @param {string} gcsUri - GCS URI of the document (gs://bucket/path)
 * @param {string} userContext - Optional user profile context
 * @returns {AsyncGenerator<string>} - Yields text chunks as they arrive
 */
async function* streamLLMWithGCS(question, gcsUri, userContext = '') {
  try {
    const vertex_ai = initializeVertexAI();
    
    // 1. Parse GCS URI
    if (!gcsUri.startsWith('gs://')) throw new Error('Invalid GCS URI');
    const mimeType = getMimeTypeFromPath(gcsUri);

    // 2. Build Prompt
    let promptText = question;
    if (userContext) {
      promptText = `USER CONTEXT:\n${userContext}\n\nUSER QUESTION: ${question}`;
    }

    // 3. Define Valid Models
    const modelNames = [
      process.env.GEMINI_MODEL_NAME, 
      'gemini-2.5-flash-001',
      'gemini-2.5-flash',
      'gemini-2.5-pro-001',
      'gemini-2.5-pro',
      'gemini-3-pro-preview',
      'gemini-2.0-flash-001'
    ].filter(Boolean);

    let lastError;

    for (const modelName of modelNames) {
      try {
        console.log(`🤖 Streaming with Vertex AI model: ${modelName}`);

        const model = vertex_ai.getGenerativeModel({ model: modelName });

        const filePart = {
          fileData: {
            mimeType: mimeType,
            fileUri: gcsUri
          }
        };

        // Use streaming API
        const streamingResp = await model.generateContentStream({
          contents: [{
            role: 'user',
            parts: [filePart, { text: promptText }]
          }]
        });

        // Stream chunks - Vertex AI returns chunks in response.stream
        let totalChunks = 0;
        for await (const chunk of streamingResp.stream) {
          // Extract text from chunk - structure may vary by model
          let chunkText = '';
          
          // Try different response structures
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
            } else if (candidate.delta && candidate.delta.content && candidate.delta.content.parts) {
              for (const part of candidate.delta.content.parts) {
                if (part.text) {
                  chunkText += part.text;
                }
              }
            }
          }
          
          if (chunkText) {
            totalChunks++;
            yield chunkText;
          }
        }
        
        console.log(`✅ Streamed ${totalChunks} chunks from ${modelName}`);

        console.log(`✅ Streaming completed with model: ${modelName}`);
        return; // Success, exit function

      } catch (err) {
        console.warn(`⚠️ Model ${modelName} streaming failed: ${err.message}`);
        lastError = err;
        continue; // Try next model
      }
    }

    // If we get here, all models failed
    throw new Error(`All Vertex AI models failed for streaming. Last error: ${lastError?.message}`);

  } catch (error) {
    console.error(`❌ Fatal Error in streamLLMWithGCS:`, error.message);
    throw error;
  }
}

module.exports = { askLLMWithGCS, streamLLMWithGCS };