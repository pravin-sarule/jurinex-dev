//     if (!storage) {
    
    
    

  
    
    
    

//     if (!storage) {



//     if (!gcsUri.startsWith('gs://')) {
    
    


//     if (!bucketName || !filePath) {
    
    
    
//     if (!exists) {
    
    


    
    
    
    
    
        
        
//         // Create file part with GCS URI (Vertex AI supports gs:// directly!)
//             fileUri: gcsUri // This works natively with Vertex AI!
        
        
        
        
    



const { VertexAI } = require('@google-cloud/vertexai');
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const { logLLMUsage } = require('./llmUsageService');


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


async function askLLMWithGCS(question, gcsUri, userContext = '', metadata = {}) {
  try {
    const vertex_ai = initializeVertexAI();
    
    if (!gcsUri.startsWith('gs://')) throw new Error('Invalid GCS URI');
    const mimeType = getMimeTypeFromPath(gcsUri);

    let promptText = question;
    if (userContext) {
      promptText = `USER CONTEXT:\n${userContext}\n\nUSER QUESTION: ${question}`;
    }

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
    let successfulModel = null;
    let usageData = null;

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

        if (!result.response || !result.response.candidates || !result.response.candidates.length) {
          throw new Error('Empty response from Vertex AI');
        }

        const text = result.response.candidates[0].content.parts[0].text;
        successfulModel = modelName;
        
        // Extract usage metadata from response
        if (result.response.usageMetadata) {
          usageData = {
            inputTokens: result.response.usageMetadata.promptTokenCount || 0,
            outputTokens: result.response.usageMetadata.candidatesTokenCount || 0,
            totalTokens: result.response.usageMetadata.totalTokenCount || 0,
            modelName: modelName
          };
          console.log(`📊 Token usage - Input: ${usageData.inputTokens}, Output: ${usageData.outputTokens}, Total: ${usageData.totalTokens}`);
        }
        
        console.log(`✅ Success with model: ${modelName}`);
        
        // Log usage if userId is provided
        if (metadata.userId && usageData) {
          logLLMUsage({
            userId: metadata.userId,
            modelName: usageData.modelName,
            inputTokens: usageData.inputTokens,
            outputTokens: usageData.outputTokens,
            endpoint: metadata.endpoint || '/api/chat/ask',
            requestId: metadata.requestId,
            fileId: metadata.fileId,
            sessionId: metadata.sessionId
          }).catch(err => {
            console.error('⚠️ Failed to log LLM usage:', err.message);
          });
        }
        
        return text;

      } catch (err) {
        console.warn(`⚠️ Model ${modelName} failed: ${err.message}`);
        lastError = err;
        continue; // Try next model
      }
    }

    throw new Error(`All Vertex AI models failed. Last error: ${lastError?.message}`);

  } catch (error) {
    console.error(`❌ Fatal Error in askLLMWithGCS:`, error.message);
    throw error;
  }
}

async function* streamLLMWithGCS(question, gcsUri, userContext = '') {
  try {
    const vertex_ai = initializeVertexAI();
    
    if (!gcsUri.startsWith('gs://')) throw new Error('Invalid GCS URI');
    const mimeType = getMimeTypeFromPath(gcsUri);

    let promptText = question;
    if (userContext) {
      promptText = `USER CONTEXT:\n${userContext}\n\nUSER QUESTION: ${question}`;
    }

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

        const streamingResp = await model.generateContentStream({
          contents: [{
            role: 'user',
            parts: [filePart, { text: promptText }]
          }]
        });

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

    throw new Error(`All Vertex AI models failed for streaming. Last error: ${lastError?.message}`);

  } catch (error) {
    console.error(`❌ Fatal Error in streamLLMWithGCS:`, error.message);
    throw error;
  }
}

module.exports = { askLLMWithGCS, streamLLMWithGCS };