// import axios from 'axios';
// import { DOCS_BASE_URL } from '../config/apiConfig';

// const API_BASE_URL = DOCS_BASE_URL;

// const getAuthHeader = () => {
//   const token = localStorage.getItem('token');
//   return token ? { Authorization: `Bearer ${token}` } : {};
// };

// const documentApi = {
//   createFolder: async (folderName, parentPath = '') => {
//     const response = await axios.post(
//       `${API_BASE_URL}/create-folder`,
//       { folderName, parentPath },
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   getFoldersAndFiles: async () => {
//     const response = await axios.get(`${API_BASE_URL}/folders`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   getDocumentsInFolder: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/files`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   uploadDocuments: async (folderName, files, secret_id = null) => {
//     const isProduction = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
//     const environment = isProduction ? 'PRODUCTION' : 'LOCALHOST';
//     const LARGE_FILE_THRESHOLD = 32 * 1024 * 1024;
//     const uploadedDocuments = [];

//     console.log(`[uploadDocuments] 🚀 Starting upload for ${files.length} file(s) to folder: ${folderName}`);
//     console.log(`[uploadDocuments] 🌍 Environment: ${environment}`);
//     console.log(`[uploadDocuments] 🔗 API Base URL: ${API_BASE_URL}`);

//     for (const file of files) {
//       const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
//       const isLarge = file.size > LARGE_FILE_THRESHOLD;
      
//       try {
//         if (isLarge) {
//           console.log(`\n[📤 SIGNED URL UPLOAD] Starting upload for: ${file.name} (${fileSizeMB}MB)`);
//           console.log(`[📤 SIGNED URL UPLOAD] Environment: ${environment}`);
//           console.log(`[📤 SIGNED URL UPLOAD] Folder: ${folderName}`);
          
//           const generateUrlEndpoint = `${API_BASE_URL}/${folderName}/generate-upload-url`;
//           console.log(`[📤 SIGNED URL UPLOAD] Step 1/3: Requesting signed URL from: ${generateUrlEndpoint}`);
          
//           const urlResponse = await axios.post(
//             generateUrlEndpoint,
//             {
//               filename: file.name,
//               mimetype: file.type,
//               size: file.size,
//             },
//             { headers: getAuthHeader() }
//           );

//           const { signedUrl, gcsPath, filename } = urlResponse.data;
//           console.log(`[📤 SIGNED URL UPLOAD] ✅ Signed URL received`);
//           console.log(`[📤 SIGNED URL UPLOAD] GCS Path: ${gcsPath}`);
//           console.log(`[📤 SIGNED URL UPLOAD] Signed URL (first 100 chars): ${signedUrl.substring(0, 100)}...`);

//           console.log(`[📤 SIGNED URL UPLOAD] Step 2/3: Uploading file directly to GCS (PUT request)`);
//           const uploadResponse = await fetch(signedUrl, {
//             method: 'PUT',
//             body: file,
//             headers: {
//               'Content-Type': file.type || 'application/octet-stream',
//             },
//           });

//           if (!uploadResponse.ok) {
//             throw new Error(`Failed to upload file to GCS: ${uploadResponse.statusText}`);
//           }

//           console.log(`[📤 SIGNED URL UPLOAD] ✅ File uploaded to GCS successfully`);

//           const completeEndpoint = `${API_BASE_URL}/${folderName}/complete-upload`;
//           console.log(`[📤 SIGNED URL UPLOAD] Step 3/3: Notifying backend to process file: ${completeEndpoint}`);
          
//           const completeResponse = await axios.post(
//             completeEndpoint,
//             {
//               gcsPath,
//               filename,
//               mimetype: file.type,
//               size: file.size,
//               secret_id,
//             },
//             { headers: getAuthHeader() }
//           );

//           console.log(`[📤 SIGNED URL UPLOAD] ✅ Upload completed successfully!`);
//           console.log(`[📤 SIGNED URL UPLOAD] 🎉 File ${file.name} is now being processed`);

//           uploadedDocuments.push(completeResponse.data.document || completeResponse.data);
//         } else {
//           console.log(`[📦 REGULAR UPLOAD] Uploading small file: ${file.name} (${fileSizeMB}MB)`);
//           console.log(`[📦 REGULAR UPLOAD] Environment: ${environment}`);
//           console.log(`[📦 REGULAR UPLOAD] Endpoint: ${API_BASE_URL}/${folderName}/upload`);
          
//           const formData = new FormData();
//           formData.append('files', file);
//           if (secret_id) {
//             formData.append('secret_id', secret_id);
//           }

//           const response = await axios.post(
//             `${API_BASE_URL}/${folderName}/upload`,
//             formData,
//             {
//               headers: {
//                 ...getAuthHeader(),
//                 'Content-Type': 'multipart/form-data',
//               },
//             }
//           );

//           console.log(`[📦 REGULAR UPLOAD] ✅ Upload completed successfully!`);

//           const docs = response.data.documents || [];
//           uploadedDocuments.push(...docs);
//         }
//       } catch (error) {
//         const uploadMethod = isLarge ? 'SIGNED URL UPLOAD' : 'REGULAR UPLOAD';
//         console.error(`[${uploadMethod}] ❌ Upload failed for ${file.name}:`, error);
//         console.error(`[${uploadMethod}] Error details:`, error.message);
        
//         if (error.response && error.response.status === 403) {
//           return {
//             success: false,
//             message: error.response.data.message || 'Token exhausted.',
//             documents: uploadedDocuments,
//           };
//         }
//         uploadedDocuments.push({
//           originalname: file.name,
//           error: error.message || 'Upload failed',
//           status: 'failed',
//         });
//       }
//     }

//     console.log(`[uploadDocuments] ✅ Upload process completed. Successfully uploaded: ${uploadedDocuments.filter(d => !d.error).length}/${files.length} files`);
//     return { success: true, documents: uploadedDocuments };
//   },

//   getFolderSummary: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/summary`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   getFileProcessingStatus: async (fileId) => {
//     const response = await axios.get(`${API_BASE_URL}/status/${fileId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   getFolderProcessingStatus: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/status`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   getDocumentContent: async (fileId) => {
//     const response = await axios.get(`${API_BASE_URL}/status/${fileId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   queryFolderDocuments: async (folderName, question, sessionId = null, options = {}) => {
//     if (!folderName) {
//       throw new Error('Folder name is required to query documents');
//     }
//     const payload = {
//       question: question || '',
//       session_id: sessionId,
//       llm_name: options.llm_name || 'gemini',
//       ...options
//     };
//     console.log('[documentApi] Sending request to intelligent-chat:', { folderName, payload });
//     const response = await axios.post(
//       `${API_BASE_URL}/${folderName}/intelligent-chat`,
//       payload,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   queryTestDocuments: async (question, sessionId = null) => {
//     const payload = { question };
//     if (sessionId) {
//       payload.sessionId = sessionId;
//     }
//     const response = await axios.post(
//       `${API_BASE_URL}/files/test_case/chat`,
//       payload,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   queryFolderDocumentsWithSecret: async (folderName, promptValue, promptLabel, sessionId = null) => {
//     console.warn('[documentApi] queryFolderDocumentsWithSecret is deprecated. Use queryFolderDocuments with options instead.');
//     if (!folderName) {
//       throw new Error('Folder name is required to query documents');
//     }
//     const payload = {
//       question: promptValue,
//       prompt_label: promptLabel,
//       session_id: sessionId,
//       llm_name: 'gemini',
//     };
//     const response = await axios.post(
//       `${API_BASE_URL}/${folderName}/intelligent-chat`,
//       payload,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   getFolderChatSessions: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/sessions`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   getFolderChatSessionById: async (folderName, sessionId) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/sessions/${sessionId}`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   continueFolderChat: async (folderName, sessionId, question) => {
//     const response = await axios.post(
//       `${API_BASE_URL}/${folderName}/sessions/${sessionId}/continue`,
//       { question },
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   deleteFolderChatSession: async (folderName, sessionId) => {
//     const response = await axios.delete(
//       `${API_BASE_URL}/${folderName}/sessions/${sessionId}`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   getSecrets: async () => {
//     const response = await axios.get(`${API_BASE_URL}/files/secrets?fetch=true`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   getSecretById: async (secretId) => {
//     const response = await axios.get(`${API_BASE_URL}/files/secrets/${secretId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   getFolderChats: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/chats`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   deleteSingleFolderChat: async (folderName, chatId) => {
//     const response = await axios.delete(
//       `${API_BASE_URL}/${folderName}/chat/${chatId}`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   deleteAllFolderChats: async (folderName) => {
//     const response = await axios.delete(
//       `${API_BASE_URL}/${folderName}/chats`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   getCases: async () => {
//     const response = await axios.get(`${API_BASE_URL}/cases`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   getCaseById: async (caseId) => {
//     const response = await axios.get(`${API_BASE_URL}/cases/${caseId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   updateCase: async (caseId, caseData) => {
//     const response = await axios.put(
//       `${API_BASE_URL}/cases/${caseId}`,
//       caseData,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   deleteCase: async (caseId) => {
//     const response = await axios.delete(`${API_BASE_URL}/cases/${caseId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   deleteFile: async (fileId) => {
//     const response = await axios.delete(`${API_BASE_URL}/${fileId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   generateDocumentUploadUrl: async (filename, mimetype, size) => {
//     const baseUrl = API_BASE_URL.replace('/docs', '/files');
//     const response = await axios.post(
//       `${baseUrl}/generate-upload-url`,
//       { filename, mimetype, size },
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   completeDocumentUpload: async (gcsPath, filename, mimetype, size, secret_id = null) => {
//     const baseUrl = API_BASE_URL.replace('/docs', '/files');
//     const response = await axios.post(
//       `${baseUrl}/complete-upload`,
//       { gcsPath, filename, mimetype, size, secret_id },
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },
// };

// export default documentApi;


import axios from 'axios';
import { DOCS_BASE_URL } from '../config/apiConfig';

const API_BASE_URL = DOCS_BASE_URL;

const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const documentApi = {
  createFolder: async (folderName, parentPath = '') => {
    const response = await axios.post(
      `${API_BASE_URL}/create-folder`,
      { folderName, parentPath },
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  getFoldersAndFiles: async () => {
    const response = await axios.get(`${API_BASE_URL}/folders`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  getDocumentsInFolder: async (folderName) => {
    const response = await axios.get(
      `${API_BASE_URL}/${folderName}/files`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  uploadDocuments: async (folderName, files, secret_id = null) => {
    const isProduction = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
    const environment = isProduction ? 'PRODUCTION' : 'LOCALHOST';
    const LARGE_FILE_THRESHOLD = 32 * 1024 * 1024;
    const uploadedDocuments = [];

    console.log(`[uploadDocuments] 🚀 Starting upload for ${files.length} file(s) to folder: ${folderName}`);
    console.log(`[uploadDocuments] 🌍 Environment: ${environment}`);
    console.log(`[uploadDocuments] 🔗 API Base URL: ${API_BASE_URL}`);

    for (const file of files) {
      const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
      const isLarge = file.size > LARGE_FILE_THRESHOLD;
      
      try {
        if (isLarge) {
          console.log(`\n[📤 SIGNED URL UPLOAD] Starting upload for: ${file.name} (${fileSizeMB}MB)`);
          console.log(`[📤 SIGNED URL UPLOAD] Environment: ${environment}`);
          console.log(`[📤 SIGNED URL UPLOAD] Folder: ${folderName}`);
          
          const generateUrlEndpoint = `${API_BASE_URL}/${folderName}/generate-upload-url`;
          console.log(`[📤 SIGNED URL UPLOAD] Step 1/3: Requesting signed URL from: ${generateUrlEndpoint}`);
          
          const urlResponse = await axios.post(
            generateUrlEndpoint,
            {
              filename: file.name,
              mimetype: file.type,
              size: file.size,
            },
            { headers: getAuthHeader() }
          );

          const { signedUrl, gcsPath, filename } = urlResponse.data;
          console.log(`[📤 SIGNED URL UPLOAD] ✅ Signed URL received`);
          console.log(`[📤 SIGNED URL UPLOAD] GCS Path: ${gcsPath}`);
          console.log(`[📤 SIGNED URL UPLOAD] Signed URL (first 100 chars): ${signedUrl.substring(0, 100)}...`);

          console.log(`[📤 SIGNED URL UPLOAD] Step 2/3: Uploading file directly to GCS (PUT request)`);
          const uploadResponse = await fetch(signedUrl, {
            method: 'PUT',
            body: file,
            headers: {
              'Content-Type': file.type || 'application/octet-stream',
            },
          });

          if (!uploadResponse.ok) {
            throw new Error(`Failed to upload file to GCS: ${uploadResponse.statusText}`);
          }

          console.log(`[📤 SIGNED URL UPLOAD] ✅ File uploaded to GCS successfully`);

          const completeEndpoint = `${API_BASE_URL}/${folderName}/complete-upload`;
          console.log(`[📤 SIGNED URL UPLOAD] Step 3/3: Notifying backend to process file: ${completeEndpoint}`);
          
          const completeResponse = await axios.post(
            completeEndpoint,
            {
              gcsPath,
              filename,
              mimetype: file.type,
              size: file.size,
              secret_id,
            },
            { headers: getAuthHeader() }
          );

          console.log(`[📤 SIGNED URL UPLOAD] ✅ Upload completed successfully!`);
          console.log(`[📤 SIGNED URL UPLOAD] 🎉 File ${file.name} is now being processed`);

          uploadedDocuments.push(completeResponse.data.document || completeResponse.data);
        } else {
          console.log(`[📦 REGULAR UPLOAD] Uploading small file: ${file.name} (${fileSizeMB}MB)`);
          console.log(`[📦 REGULAR UPLOAD] Environment: ${environment}`);
          console.log(`[📦 REGULAR UPLOAD] Endpoint: ${API_BASE_URL}/${folderName}/upload`);
          
          const formData = new FormData();
          formData.append('files', file);
          if (secret_id) {
            formData.append('secret_id', secret_id);
          }

          const response = await axios.post(
            `${API_BASE_URL}/${folderName}/upload`,
            formData,
            {
              headers: {
                ...getAuthHeader(),
                'Content-Type': 'multipart/form-data',
              },
            }
          );

          console.log(`[📦 REGULAR UPLOAD] ✅ Upload completed successfully!`);

          const docs = response.data.documents || [];
          uploadedDocuments.push(...docs);
        }
      } catch (error) {
        const uploadMethod = isLarge ? 'SIGNED URL UPLOAD' : 'REGULAR UPLOAD';
        console.error(`[${uploadMethod}] ❌ Upload failed for ${file.name}:`, error);
        console.error(`[${uploadMethod}] Error details:`, error.message);
        
        if (error.response && error.response.status === 403) {
          return {
            success: false,
            message: error.response.data.message || 'Token exhausted.',
            documents: uploadedDocuments,
          };
        }
        uploadedDocuments.push({
          originalname: file.name,
          error: error.message || 'Upload failed',
          status: 'failed',
        });
      }
    }

    console.log(`[uploadDocuments] ✅ Upload process completed. Successfully uploaded: ${uploadedDocuments.filter(d => !d.error).length}/${files.length} files`);
    return { success: true, documents: uploadedDocuments };
  },

  getFolderSummary: async (folderName) => {
    const response = await axios.get(
      `${API_BASE_URL}/${folderName}/summary`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  getFileProcessingStatus: async (fileId) => {
    const response = await axios.get(`${API_BASE_URL}/status/${fileId}`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  getFolderProcessingStatus: async (folderName) => {
    const response = await axios.get(
      `${API_BASE_URL}/${folderName}/status`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  getDocumentContent: async (fileId) => {
    const response = await axios.get(`${API_BASE_URL}/status/${fileId}`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  queryFolderDocuments: async (folderName, question, sessionId = null, options = {}) => {
    if (!folderName) {
      throw new Error('Folder name is required to query documents');
    }
    const payload = {
      question: question || '',
      session_id: sessionId,
      llm_name: options.llm_name || 'gemini',
      ...options
    };
    console.log('[documentApi] Sending request to intelligent-chat:', { folderName, payload });
    const response = await axios.post(
      `${API_BASE_URL}/${folderName}/intelligent-chat`,
      payload,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  // Upload files for processing (separate from extraction)
  uploadDocumentsForProcessing: async (files) => {
    try {
      console.log(`[uploadDocumentsForProcessing] 🚀 Uploading ${files.length} file(s)...`);
      
      const formData = new FormData();
      files.forEach(file => {
        formData.append('files', file);
      });

      const response = await axios.post(
        `${API_BASE_URL}/upload-for-processing`,
        formData,
        {
          headers: {
            ...getAuthHeader(),
            'Content-Type': 'multipart/form-data',
          },
          timeout: 60000, // 1 minute for upload
        }
      );

      console.log(`[uploadDocumentsForProcessing] ✅ Upload completed`);
      
      return {
        success: true,
        folderName: response.data.folderName,
        uploadedFiles: response.data.uploadedFiles || []
      };
    } catch (error) {
      console.error('[uploadDocumentsForProcessing] ❌ Error:', error);
      throw new Error(error.response?.data?.message || error.response?.data?.error || error.message || 'Failed to upload documents');
    }
  },

  // Get processing status of folder
  getFolderProcessingStatus: async (folderName) => {
    try {
      // URL encode the folderName to handle paths with slashes
      const encodedFolderName = encodeURIComponent(folderName);
      const response = await axios.get(
        `${API_BASE_URL}/${encodedFolderName}/status`,
        { 
          headers: getAuthHeader(),
          timeout: 30000, // 30 second timeout for status check
        }
      );
      return response.data;
    } catch (error) {
      console.error('[getFolderProcessingStatus] ❌ Error:', error);
      console.error('[getFolderProcessingStatus] Error details:', error.response?.data);
      console.error('[getFolderProcessingStatus] Folder name:', folderName);
      
      // Don't throw for timeout errors - let the caller handle retries
      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        throw new Error('Request timeout - will retry');
      }
      
      throw new Error(error.response?.data?.message || error.response?.data?.error || 'Failed to get processing status');
    }
  },

  // Extract case fields from processed folder
  extractCaseFieldsFromFolder: async (folderName) => {
    try {
      console.log(`[extractCaseFieldsFromFolder] 🔍 Extracting fields from folder: ${folderName}`);
      
      // URL encode the folderName to handle paths with slashes
      const encodedFolderName = encodeURIComponent(folderName);
      const response = await axios.post(
        `${API_BASE_URL}/extract-case-fields/${encodedFolderName}`,
        {},
        {
          headers: getAuthHeader(),
          timeout: 120000, // 2 minutes for extraction
        }
      );

      console.log(`[extractCaseFieldsFromFolder] ✅ Extraction completed`);
      
      return {
        success: true,
        extractedData: response.data.extractedData || {},
      };
    } catch (error) {
      console.error('[extractCaseFieldsFromFolder] ❌ Error:', error);
      throw new Error(error.response?.data?.message || error.response?.data?.error || error.message || 'Failed to extract case fields');
    }
  },

  // Legacy combined function (kept for backward compatibility)
  uploadAndExtractCaseFields: async (files) => {
    try {
      // Use new backend endpoint that handles upload, processing, and extraction
      // POST /upload-and-extract-case-fields
      console.log(`[uploadAndExtractCaseFields] 🚀 Starting upload and extraction for ${files.length} file(s)...`);
      
      const formData = new FormData();
      files.forEach(file => {
        formData.append('files', file);
      });

      const response = await axios.post(
        `${API_BASE_URL}/upload-and-extract-case-fields`,
        formData,
        {
          headers: {
            ...getAuthHeader(),
            'Content-Type': 'multipart/form-data',
          },
          timeout: 300000, // 5 minutes timeout for processing
        }
      );

      console.log(`[uploadAndExtractCaseFields] ✅ Upload and extraction completed successfully`);
      
      return {
        success: true,
        folderName: response.data.folderName,
        extractedData: response.data.extractedData || {},
        uploadedFiles: response.data.uploadedFiles || []
      };
    } catch (error) {
      console.error('[uploadAndExtractCaseFields] ❌ Error:', error);
      console.error('[uploadAndExtractCaseFields] Error response:', error.response?.data);
      
      if (error.code === 'ECONNABORTED') {
        throw new Error('Request timed out. Processing may still be in progress.');
      }
      
      if (error.response?.data) {
        throw new Error(error.response.data.message || error.response.data.error || 'Failed to upload and extract case fields');
      }
      
      throw new Error(error.message || 'Failed to upload and extract case fields. Please try again.');
    }
  },

  queryTestDocuments: async (question, sessionId = null) => {
    const payload = { question };
    if (sessionId) {
      payload.sessionId = sessionId;
    }
    const response = await axios.post(
      `${API_BASE_URL}/files/test_case/chat`,
      payload,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  queryFolderDocumentsWithSecret: async (folderName, promptValue, promptLabel, sessionId = null) => {
    console.warn('[documentApi] queryFolderDocumentsWithSecret is deprecated. Use queryFolderDocuments with options instead.');
    if (!folderName) {
      throw new Error('Folder name is required to query documents');
    }
    const payload = {
      question: promptValue,
      prompt_label: promptLabel,
      session_id: sessionId,
      llm_name: 'gemini',
    };
    const response = await axios.post(
      `${API_BASE_URL}/${folderName}/intelligent-chat`,
      payload,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  getFolderChatSessions: async (folderName) => {
    const response = await axios.get(
      `${API_BASE_URL}/${folderName}/sessions`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  getFolderChatSessionById: async (folderName, sessionId) => {
    const response = await axios.get(
      `${API_BASE_URL}/${folderName}/sessions/${sessionId}`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  continueFolderChat: async (folderName, sessionId, question) => {
    const response = await axios.post(
      `${API_BASE_URL}/${folderName}/sessions/${sessionId}/continue`,
      { question },
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  deleteFolderChatSession: async (folderName, sessionId) => {
    const response = await axios.delete(
      `${API_BASE_URL}/${folderName}/sessions/${sessionId}`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  getSecrets: async () => {
    const response = await axios.get(`${API_BASE_URL}/files/secrets?fetch=true`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  getSecretById: async (secretId) => {
    const response = await axios.get(`${API_BASE_URL}/files/secrets/${secretId}`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  getFolderChats: async (folderName) => {
    const response = await axios.get(
      `${API_BASE_URL}/${folderName}/chats`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  deleteSingleFolderChat: async (folderName, chatId) => {
    const response = await axios.delete(
      `${API_BASE_URL}/${folderName}/chat/${chatId}`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  deleteAllFolderChats: async (folderName) => {
    const response = await axios.delete(
      `${API_BASE_URL}/${folderName}/chats`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  getCases: async () => {
    const response = await axios.get(`${API_BASE_URL}/cases`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  getCaseById: async (caseId) => {
    const response = await axios.get(`${API_BASE_URL}/cases/${caseId}`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  updateCase: async (caseId, caseData) => {
    const response = await axios.put(
      `${API_BASE_URL}/cases/${caseId}`,
      caseData,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  deleteCase: async (caseId) => {
    const response = await axios.delete(`${API_BASE_URL}/cases/${caseId}`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  deleteFile: async (fileId) => {
    const response = await axios.delete(`${API_BASE_URL}/${fileId}`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  generateDocumentUploadUrl: async (filename, mimetype, size) => {
    const baseUrl = API_BASE_URL.replace('/docs', '/files');
    const response = await axios.post(
      `${baseUrl}/generate-upload-url`,
      { filename, mimetype, size },
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  completeDocumentUpload: async (gcsPath, filename, mimetype, size, secret_id = null) => {
    const baseUrl = API_BASE_URL.replace('/docs', '/files');
    const response = await axios.post(
      `${baseUrl}/complete-upload`,
      { gcsPath, filename, mimetype, size, secret_id },
      { headers: getAuthHeader() }
    );
    return response.data;
  },
};

export default documentApi;