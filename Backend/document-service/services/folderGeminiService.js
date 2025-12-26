//       if (!exists) {

      
      
      








//       if (!result.response || !result.response.candidates || !result.response.candidates.length) {



  
//     if (!documents || documents.length === 0) {

    







          
//           if (!doc.gcsUri || !doc.gcsUri.startsWith('gs://')) {

          








//           hasResponse: !!result.response,
//           hasCandidates: !!(result.response && result.response.candidates),

//         if (!result.response || !result.response.candidates || !result.response.candidates.length) {





        




//     if (!documents || documents.length === 0) {

    






//           if (!doc.gcsUri || !doc.gcsUri.startsWith('gs://')) {





          
          
          
        







const { VertexAI } = require('@google-cloud/vertexai');
const path = require('path');
const pool = require('../config/db');
const { bucket } = require('../config/gcs');


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

const GEMINI_MODELS_CASCADE = [
  'gemini-2.5-flash',      // Primary: Fast and reliable
  'gemini-2.5-pro',        // Most capable 2.5
  'gemini-2.0-flash-001',  // Stable 2.0
  'gemini-1.5-flash-002',  // Fallback 1.5 flash
  'gemini-1.5-pro-002',    // Fallback 1.5 pro
];

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

async function checkFileSize(gcsUri, mimeType) {
  try {
    const match = gcsUri.match(/^gs:\/\/([^\/]+)\/(.+)$/);
    if (!match) {
      console.warn(`⚠️ Invalid GCS URI format: ${gcsUri}`);
      return { valid: true, warning: 'Invalid URI format, skipping check' };
    }

    const [, bucketName, filePath] = match;
    const file = bucket.file(filePath);

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
    return { valid: true, warning: error.message };
  }
}

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

async function askGeminiWithDirectFiles(question, documents = [], userContext = '') {
  console.log(`🔄 [folderGeminiService] Using fallback: Direct file download method`);
  console.log(`🔄 [folderGeminiService] Downloading ${documents.length} files from GCS...`);

  const vertex_ai = initializeVertexAI();
  
  let promptText = question;
  if (userContext) {
    promptText = `USER CONTEXT:\n${userContext}\n\nUSER QUESTION: ${question}`;
  }

  const documentList = documents.map((doc, idx) => `${idx + 1}. ${doc.filename || `Document ${idx + 1}`}`).join('\n');
  promptText = `You are analyzing a folder containing ${documents.length} document(s):\n${documentList}\n\n${promptText}\n\nPlease provide a comprehensive analysis considering ALL documents in this folder.`;

  const parts = [];
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    try {
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

  parts.push({ text: promptText });

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

async function askGeminiWithMultipleGCS(question, documents = [], userContext = '') {
  console.log(`🔵 [folderGeminiService] askGeminiWithMultipleGCS called with ${documents.length} documents`);
  
  try {
    if (!documents || documents.length === 0) {
      throw new Error('No documents provided for folder analysis');
    }

    const { validFiles, skippedFiles } = await filterValidFiles(documents);

    if (validFiles.length === 0) {
      throw new Error('All files were skipped due to size limits. Please reduce file sizes and try again.');
    }

    if (skippedFiles.length > 0) {
      console.warn(`⚠️ Skipped ${skippedFiles.length} oversized files, proceeding with ${validFiles.length} valid files`);
    }

    const vertex_ai = initializeVertexAI();
    
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

async function* streamGeminiWithMultipleGCS(question, documents = [], userContext = '') {
  try {
    if (!documents || documents.length === 0) {
      throw new Error('No documents provided for folder analysis');
    }

    console.log(`📋 [Stream] Checking ${documents.length} files for size limits...`);

    const { validFiles, skippedFiles } = await filterValidFiles(documents);

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

        const parts = validFiles.map(doc => ({
          fileData: {
            mimeType: doc.mimeType,
            fileUri: doc.gcsUri
          }
        }));

        parts.push({ text: promptText });

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

        const errorMessage = (err.message || '').toLowerCase();
        if (errorMessage.includes('not found') || errorMessage.includes('404')) {
          console.warn(`⏭️ [Stream] Model ${modelName} not available, trying next...`);
          continue;
        }

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