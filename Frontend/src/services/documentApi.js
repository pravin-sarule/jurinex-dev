

// import axios from 'axios';

// const API_BASE_URL = 'https://gateway-service-120280829617.asia-south1.run.app/docs';

// const getAuthHeader = () => {
//   const token = localStorage.getItem('token');
//   return token ? { Authorization: `Bearer ${token}` } : {};
// };

// const documentApi = {
//   // Create a new folder
//   createFolder: async (folderName, parentPath = '') => {
//     const response = await axios.post(
//       `${API_BASE_URL}/create-folder`,
//       { folderName, parentPath },
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get all folders & files
//   getFoldersAndFiles: async () => {
//     const response = await axios.get(`${API_BASE_URL}/folders`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Upload multiple documents
//   uploadDocuments: async (folderName, files) => {
//     const formData = new FormData();
//     files.forEach((file) => formData.append('files', file));

//     try {
//       const response = await axios.post(
//         `${API_BASE_URL}/${encodeURIComponent(folderName)}/upload`,
//         formData,
//         {
//           headers: {
//             ...getAuthHeader(),
//             'Content-Type': 'multipart/form-data',
//           },
//         }
//       );
//       return { success: true, documents: response.data.documents || [] };
//     } catch (error) {
//       if (error.response && error.response.status === 403) {
//         return { success: false, message: error.response.data.message || 'Token exhausted.' };
//       }
//       return { success: false, message: error.message || 'An unexpected error occurred during upload.' };
//     }
//   },

//   // Get folder summary
//   getFolderSummary: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${encodeURIComponent(folderName)}/summary`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get file processing status
//   getFileProcessingStatus: async (fileId) => {
//     const response = await axios.get(`${API_BASE_URL}/status/${fileId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Get folder processing status
//   getFolderProcessingStatus: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${encodeURIComponent(folderName)}/status`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get document content
//   getDocumentContent: async (fileId) => {
//     const response = await axios.get(`${API_BASE_URL}/status/${fileId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Query folder documents
//   queryFolderDocuments: async (folderName, question, sessionId = null) => {
//     if (!folderName) {
//       throw new Error('Folder name is required to query documents');
//     }
    
//     const payload = { question };
//     if (sessionId) {
//       payload.sessionId = sessionId;
//     }

//     const response = await axios.post(
//       `${API_BASE_URL}/${encodeURIComponent(folderName)}/query`,
//       payload,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Query documents from test_case folder
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

//   // Query folder documents with a secret prompt
//   queryFolderDocumentsWithSecret: async (folderName, promptValue, promptLabel, sessionId = null) => {
//     if (!folderName) {
//       throw new Error('Folder name is required to query documents');
//     }

//     const payload = { 
//       question: promptValue, 
//       promptLabel 
//     };
//     if (sessionId) {
//       payload.sessionId = sessionId;
//     }

//     const response = await axios.post(
//       `${API_BASE_URL}/${encodeURIComponent(folderName)}/query`,
//       payload,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get all chat sessions for a folder
//   getFolderChatSessions: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${encodeURIComponent(folderName)}/sessions`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get a specific chat session
//   getFolderChatSessionById: async (folderName, sessionId) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${encodeURIComponent(folderName)}/sessions/${sessionId}`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Continue chat in a session
//   continueFolderChat: async (folderName, sessionId, question) => {
//     const response = await axios.post(
//       `${API_BASE_URL}/${encodeURIComponent(folderName)}/sessions/${sessionId}/continue`,
//       { question },
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Delete a chat session
//   deleteFolderChatSession: async (folderName, sessionId) => {
//     const response = await axios.delete(
//       `${API_BASE_URL}/${encodeURIComponent(folderName)}/sessions/${sessionId}`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get all secrets
//   getSecrets: async () => {
//     const response = await axios.get(`${API_BASE_URL}/files/secrets?fetch=true`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Get a specific secret by ID
//   getSecretById: async (secretId) => {
//     const response = await axios.get(`${API_BASE_URL}/files/secrets/${secretId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Get all chats for a specific folder
//   getFolderChats: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${encodeURIComponent(folderName)}/chats`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get all cases
//   getCases: async () => {
//     const response = await axios.get(`${API_BASE_URL}/cases`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Get a specific case by ID
//   getCaseById: async (caseId) => {
//     const response = await axios.get(`${API_BASE_URL}/cases/${caseId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Update a case
//   updateCase: async (caseId, caseData) => {
//     const response = await axios.put(
//       `${API_BASE_URL}/cases/${caseId}`,
//       caseData,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Delete a case
//   deleteCase: async (caseId) => {
//     const response = await axios.delete(`${API_BASE_URL}/cases/${caseId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },
// };

// export default documentApi;



// import axios from 'axios';

// const API_BASE_URL = 'https://gateway-service-120280829617.asia-south1.run.app/docs';

// const getAuthHeader = () => {
//   const token = localStorage.getItem('token');
//   return token ? { Authorization: `Bearer ${token}` } : {};
// };

// const documentApi = {
//   // Create a new folder
//   createFolder: async (folderName, parentPath = '') => {
//     const response = await axios.post(
//       `${API_BASE_URL}/create-folder`,
//       { folderName, parentPath },
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get all folders & files
//   getFoldersAndFiles: async () => {
//     const response = await axios.get(`${API_BASE_URL}/folders`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Upload multiple documents
//   uploadDocuments: async (folderName, files) => {
//     const formData = new FormData();
//     files.forEach((file) => formData.append('files', file));

//     try {
//       const response = await axios.post(
//         `${API_BASE_URL}/${encodeURIComponent(folderName)}/upload`,
//         formData,
//         {
//           headers: {
//             ...getAuthHeader(),
//             'Content-Type': 'multipart/form-data',
//           },
//         }
//       );
//       return { success: true, documents: response.data.documents || [] };
//     } catch (error) {
//       if (error.response && error.response.status === 403) {
//         return { success: false, message: error.response.data.message || 'Token exhausted.' };
//       }
//       return { success: false, message: error.message || 'An unexpected error occurred during upload.' };
//     }
//   },

//   // Get folder summary
//   getFolderSummary: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${encodeURIComponent(folderName)}/summary`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get file processing status
//   getFileProcessingStatus: async (fileId) => {
//     const response = await axios.get(`${API_BASE_URL}/status/${fileId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Get folder processing status
//   getFolderProcessingStatus: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${encodeURIComponent(folderName)}/status`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get document content
//   getDocumentContent: async (fileId) => {
//     const response = await axios.get(`${API_BASE_URL}/status/${fileId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Query folder documents
//   queryFolderDocuments: async (folderName, question, sessionId = null) => {
//     if (!folderName) {
//       throw new Error('Folder name is required to query documents');
//     }
    
//     const payload = { question };
//     if (sessionId) {
//       payload.sessionId = sessionId;
//     }

//     const response = await axios.post(
//       `${API_BASE_URL}/${encodeURIComponent(folderName)}/query`,
//       payload,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Query documents from test_case folder
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

//   // Query folder documents with a secret prompt
//   queryFolderDocumentsWithSecret: async (folderName, promptValue, promptLabel, sessionId = null) => {
//     if (!folderName) {
//       throw new Error('Folder name is required to query documents');
//     }

//     const payload = { 
//       question: promptValue, 
//       promptLabel 
//     };
//     if (sessionId) {
//       payload.sessionId = sessionId;
//     }

//     const response = await axios.post(
//       `${API_BASE_URL}/${encodeURIComponent(folderName)}/query`,
//       payload,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get all chat sessions for a folder
//   getFolderChatSessions: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${encodeURIComponent(folderName)}/sessions`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get a specific chat session
//   getFolderChatSessionById: async (folderName, sessionId) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${encodeURIComponent(folderName)}/sessions/${sessionId}`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Continue chat in a session
//   continueFolderChat: async (folderName, sessionId, question) => {
//     const response = await axios.post(
//       `${API_BASE_URL}/${encodeURIComponent(folderName)}/sessions/${sessionId}/continue`,
//       { question },
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Delete a chat session
//   deleteFolderChatSession: async (folderName, sessionId) => {
//     const response = await axios.delete(
//       `${API_BASE_URL}/${encodeURIComponent(folderName)}/sessions/${sessionId}`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get all secrets
//   getSecrets: async () => {
//     const response = await axios.get(`${API_BASE_URL}/files/secrets?fetch=true`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Get a specific secret by ID
//   getSecretById: async (secretId) => {
//     const response = await axios.get(`${API_BASE_URL}/files/secrets/${secretId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Get all chats for a specific folder
//   getFolderChats: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${encodeURIComponent(folderName)}/chats`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get all cases with populated data
//   getCases: async () => {
//     try {
//       const response = await axios.get(`${API_BASE_URL}/cases?populate=true`, {
//         headers: getAuthHeader(),
//       });
//       return response.data;
//     } catch (error) {
//       // If populate param is not supported, try without it
//       if (error.response && error.response.status === 400) {
//         const response = await axios.get(`${API_BASE_URL}/cases`, {
//           headers: getAuthHeader(),
//         });
//         return response.data;
//       }
//       throw error;
//     }
//   },

//   // Get a specific case by ID with populated data
//   getCaseById: async (caseId) => {
//     try {
//       const response = await axios.get(`${API_BASE_URL}/cases/${caseId}?populate=true`, {
//         headers: getAuthHeader(),
//       });
//       return response.data;
//     } catch (error) {
//       // If populate param is not supported, try without it
//       if (error.response && error.response.status === 400) {
//         const response = await axios.get(`${API_BASE_URL}/cases/${caseId}`, {
//           headers: getAuthHeader(),
//         });
//         return response.data;
//       }
//       throw error;
//     }
//   },

//   // Update a case
//   updateCase: async (caseId, caseData) => {
//     const response = await axios.put(
//       `${API_BASE_URL}/cases/${caseId}`,
//       caseData,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Delete a case
//   deleteCase: async (caseId) => {
//     const response = await axios.delete(`${API_BASE_URL}/cases/${caseId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Get all courts (helper function to map court IDs to names)
//   getCourts: async () => {
//     try {
//       const response = await axios.get(`${API_BASE_URL}/courts`, {
//         headers: getAuthHeader(),
//       });
//       return response.data;
//     } catch (error) {
//       console.error('Error fetching courts:', error);
//       return { courts: [] };
//     }
//   },

//   // Get all case types (helper function to map case type IDs to names)
//   getCaseTypes: async () => {
//     try {
//       const response = await axios.get(`${API_BASE_URL}/case-types`, {
//         headers: getAuthHeader(),
//       });
//       return response.data;
//     } catch (error) {
//       console.error('Error fetching case types:', error);
//       return { caseTypes: [] };
//     }
//   },
// };

// export default documentApi;



// import axios from 'axios';

// const API_BASE_URL = 'https://gateway-service-120280829617.asia-south1.run.app/docs';

// const getAuthHeader = () => {
//   const token = localStorage.getItem('token');
//   return token ? { Authorization: `Bearer ${token}` } : {};
// };

// const documentApi = {
//   // Create a new folder
//   createFolder: async (folderName, parentPath = '') => {
//     const response = await axios.post(
//       `${API_BASE_URL}/create-folder`,
//       { folderName, parentPath },
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get all folders & files
//   getFoldersAndFiles: async () => {
//     const response = await axios.get(`${API_BASE_URL}/folders`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Get documents in a specific folder
//   getDocumentsInFolder: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/files`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Upload multiple documents
//   uploadDocuments: async (folderName, files) => {
//     const formData = new FormData();
//     files.forEach((file) => formData.append('files', file));

//     try {
//       const response = await axios.post(
//         `${API_BASE_URL}/${folderName}/upload`,
//         formData,
//         {
//           headers: {
//             ...getAuthHeader(),
//             'Content-Type': 'multipart/form-data',
//           },
//         }
//       );
//       return { success: true, documents: response.data.documents || [] };
//     } catch (error) {
//       if (error.response && error.response.status === 403) {
//         return { success: false, message: error.response.data.message || 'Token exhausted.' };
//       }
//       return { success: false, message: error.message || 'An unexpected error occurred during upload.' };
//     }
//   },

//   // Get folder summary
//   getFolderSummary: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/summary`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get file processing status
//   getFileProcessingStatus: async (fileId) => {
//     const response = await axios.get(`${API_BASE_URL}/status/${fileId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Get folder processing status
//   getFolderProcessingStatus: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/status`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get document content
//   getDocumentContent: async (fileId) => {
//     const response = await axios.get(`${API_BASE_URL}/status/${fileId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Query folder documents
//   queryFolderDocuments: async (folderName, question, sessionId = null) => {
//     if (!folderName) {
//       throw new Error('Folder name is required to query documents');
//     }
    
//     const payload = { question };
//     if (sessionId) {
//       payload.sessionId = sessionId;
//     }

//     const response = await axios.post(
//       `${API_BASE_URL}/${folderName}/query`,
//       payload,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Query documents from test_case folder
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

//   // Query folder documents with a secret prompt
//   queryFolderDocumentsWithSecret: async (folderName, promptValue, promptLabel, sessionId = null) => {
//     if (!folderName) {
//       throw new Error('Folder name is required to query documents');
//     }

//     const payload = { 
//       question: promptValue, 
//       promptLabel 
//     };
//     if (sessionId) {
//       payload.sessionId = sessionId;
//     }

//     const response = await axios.post(
//       `${API_BASE_URL}/${folderName}/query`,
//       payload,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get all chat sessions for a folder
//   getFolderChatSessions: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/sessions`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get a specific chat session
//   getFolderChatSessionById: async (folderName, sessionId) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/sessions/${sessionId}`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Continue chat in a session
//   continueFolderChat: async (folderName, sessionId, question) => {
//     const response = await axios.post(
//       `${API_BASE_URL}/${folderName}/sessions/${sessionId}/continue`,
//       { question },
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Delete a chat session
//   deleteFolderChatSession: async (folderName, sessionId) => {
//     const response = await axios.delete(
//       `${API_BASE_URL}/${folderName}/sessions/${sessionId}`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get all secrets
//   getSecrets: async () => {
//     const response = await axios.get(`${API_BASE_URL}/files/secrets?fetch=true`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Get a specific secret by ID
//   getSecretById: async (secretId) => {
//     const response = await axios.get(`${API_BASE_URL}/files/secrets/${secretId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Get all chats for a specific folder
//   getFolderChats: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/chats`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get all cases
//   getCases: async () => {
//     const response = await axios.get(`${API_BASE_URL}/cases`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Get a specific case by ID
//   getCaseById: async (caseId) => {
//     const response = await axios.get(`${API_BASE_URL}/cases/${caseId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Update a case
//   updateCase: async (caseId, caseData) => {
//     const response = await axios.put(
//       `${API_BASE_URL}/cases/${caseId}`,
//       caseData,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Delete a case
//   deleteCase: async (caseId) => {
//     const response = await axios.delete(`${API_BASE_URL}/cases/${caseId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },
// };

// export default documentApi;







// import axios from 'axios';

// const API_BASE_URL = 'https://gateway-service-120280829617.asia-south1.run.app/docs';

// const getAuthHeader = () => {
//   const token = localStorage.getItem('token');
//   return token ? { Authorization: `Bearer ${token}` } : {};
// };

// const documentApi = {
//   // Create a new folder
//   createFolder: async (folderName, parentPath = '') => {
//     const response = await axios.post(
//       `${API_BASE_URL}/create-folder`,
//       { folderName, parentPath },
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get all folders & files
//   getFoldersAndFiles: async () => {
//     const response = await axios.get(`${API_BASE_URL}/folders`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Get documents in a specific folder
//   getDocumentsInFolder: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/files`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Upload multiple documents
//   uploadDocuments: async (folderName, files) => {
//     const formData = new FormData();
//     files.forEach((file) => formData.append('files', file));

//     try {
//       const response = await axios.post(
//         `${API_BASE_URL}/${folderName}/upload`,
//         formData,
//         {
//           headers: {
//             ...getAuthHeader(),
//             'Content-Type': 'multipart/form-data',
//           },
//         }
//       );
//       return { success: true, documents: response.data.documents || [] };
//     } catch (error) {
//       if (error.response && error.response.status === 403) {
//         return { success: false, message: error.response.data.message || 'Token exhausted.' };
//       }
//       return { success: false, message: error.message || 'An unexpected error occurred during upload.' };
//     }
//   },

//   // Get folder summary
//   getFolderSummary: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/summary`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get file processing status
//   getFileProcessingStatus: async (fileId) => {
//     const response = await axios.get(`${API_BASE_URL}/status/${fileId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Get folder processing status
//   getFolderProcessingStatus: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/status`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get document content
//   getDocumentContent: async (fileId) => {
//     const response = await axios.get(`${API_BASE_URL}/status/${fileId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // ✅ FIXED: Query folder documents - Now supports both custom queries and secret prompts
//   queryFolderDocuments: async (folderName, question, sessionId = null, options = {}) => {
//     if (!folderName) {
//       throw new Error('Folder name is required to query documents');
//     }
    
//     // Build payload
//     const payload = {
//       question: question || '', // Empty string for secret prompts
//       session_id: sessionId,
//       ...options // This includes: secret_id, llm_name, prompt_label, additional_input, etc.
//     };

//     console.log('[documentApi] Sending request:', {
//       folderName,
//       payload,
//       isSecretPrompt: !!options.secret_id
//     });

//     const response = await axios.post(
//       `${API_BASE_URL}/${folderName}/query`,
//       payload,
//       { headers: getAuthHeader() }
//     );
    
//     return response.data;
//   },

//   // Query documents from test_case folder
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

//   // ✅ DEPRECATED: Use queryFolderDocuments with options instead
//   // Keeping for backward compatibility but should be removed
//   queryFolderDocumentsWithSecret: async (folderName, promptValue, promptLabel, sessionId = null) => {
//     console.warn('[documentApi] queryFolderDocumentsWithSecret is deprecated. Use queryFolderDocuments with options instead.');
    
//     if (!folderName) {
//       throw new Error('Folder name is required to query documents');
//     }

//     const payload = { 
//       question: promptValue, 
//       prompt_label: promptLabel,
//       session_id: sessionId
//     };

//     const response = await axios.post(
//       `${API_BASE_URL}/${folderName}/query`,
//       payload,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get all chat sessions for a folder
//   getFolderChatSessions: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/sessions`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get a specific chat session
//   getFolderChatSessionById: async (folderName, sessionId) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/sessions/${sessionId}`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Continue chat in a session
//   continueFolderChat: async (folderName, sessionId, question) => {
//     const response = await axios.post(
//       `${API_BASE_URL}/${folderName}/sessions/${sessionId}/continue`,
//       { question },
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Delete a chat session
//   deleteFolderChatSession: async (folderName, sessionId) => {
//     const response = await axios.delete(
//       `${API_BASE_URL}/${folderName}/sessions/${sessionId}`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get all secrets
//   getSecrets: async () => {
//     const response = await axios.get(`${API_BASE_URL}/files/secrets?fetch=true`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Get a specific secret by ID
//   getSecretById: async (secretId) => {
//     const response = await axios.get(`${API_BASE_URL}/files/secrets/${secretId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Get all chats for a specific folder
//   getFolderChats: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/chats`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get all cases
//   getCases: async () => {
//     const response = await axios.get(`${API_BASE_URL}/cases`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Get a specific case by ID
//   getCaseById: async (caseId) => {
//     const response = await axios.get(`${API_BASE_URL}/cases/${caseId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Update a case
//   updateCase: async (caseId, caseData) => {
//     const response = await axios.put(
//       `${API_BASE_URL}/cases/${caseId}`,
//       caseData,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Delete a case
//   deleteCase: async (caseId) => {
//     const response = await axios.delete(`${API_BASE_URL}/cases/${caseId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },
// };

// export default documentApi;



// import axios from 'axios';

// const API_BASE_URL = 'https://gateway-service-120280829617.asia-south1.run.app/docs';

// const getAuthHeader = () => {
//   const token = localStorage.getItem('token');
//   return token ? { Authorization: `Bearer ${token}` } : {};
// };

// const documentApi = {
//   // Create a new folder
//   createFolder: async (folderName, parentPath = '') => {
//     const response = await axios.post(
//       `${API_BASE_URL}/create-folder`,
//       { folderName, parentPath },
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get all folders & files
//   getFoldersAndFiles: async () => {
//     const response = await axios.get(`${API_BASE_URL}/folders`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Get documents in a specific folder
//   getDocumentsInFolder: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/files`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Upload multiple documents
//   uploadDocuments: async (folderName, files) => {
//     const formData = new FormData();
//     files.forEach((file) => formData.append('files', file));

//     try {
//       const response = await axios.post(
//         `${API_BASE_URL}/${folderName}/upload`,
//         formData,
//         {
//           headers: {
//             ...getAuthHeader(),
//             'Content-Type': 'multipart/form-data',
//           },
//         }
//       );
//       return { success: true, documents: response.data.documents || [] };
//     } catch (error) {
//       if (error.response && error.response.status === 403) {
//         return { success: false, message: error.response.data.message || 'Token exhausted.' };
//       }
//       return { success: false, message: error.message || 'An unexpected error occurred during upload.' };
//     }
//   },

//   // Get folder summary
//   getFolderSummary: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/summary`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get file processing status
//   getFileProcessingStatus: async (fileId) => {
//     const response = await axios.get(`${API_BASE_URL}/status/${fileId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Get folder processing status
//   getFolderProcessingStatus: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/status`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get document content
//   getDocumentContent: async (fileId) => {
//     const response = await axios.get(`${API_BASE_URL}/status/${fileId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Query folder documents
//   queryFolderDocuments: async (folderName, question, sessionId = null, options = {}) => {
//     if (!folderName) {
//       throw new Error('Folder name is required to query documents');
//     }
    
//     const payload = {
//       question: question || '',
//       session_id: sessionId,
//       ...options
//     };

//     console.log('[documentApi] Sending request:', {
//       folderName,
//       payload,
//       isSecretPrompt: !!options.secret_id
//     });

//     const response = await axios.post(
//       `${API_BASE_URL}/${folderName}/query`,
//       payload,
//       { headers: getAuthHeader() }
//     );
    
//     return response.data;
//   },

//   // Query documents from test_case folder
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

//   // DEPRECATED: Use queryFolderDocuments with options instead
//   queryFolderDocumentsWithSecret: async (folderName, promptValue, promptLabel, sessionId = null) => {
//     console.warn('[documentApi] queryFolderDocumentsWithSecret is deprecated. Use queryFolderDocuments with options instead.');
    
//     if (!folderName) {
//       throw new Error('Folder name is required to query documents');
//     }

//     const payload = { 
//       question: promptValue, 
//       prompt_label: promptLabel,
//       session_id: sessionId
//     };

//     const response = await axios.post(
//       `${API_BASE_URL}/${folderName}/query`,
//       payload,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get all chat sessions for a folder
//   getFolderChatSessions: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/sessions`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // ✅ FIXED: Get a specific chat session with proper filtering
//   getFolderChatSessionById: async (folderName, sessionId) => {
//     console.log(`[documentApi] Fetching session ${sessionId} for folder ${folderName}`);
    
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/sessions/${sessionId}`,
//       { headers: getAuthHeader() }
//     );
    
//     // Ensure we filter messages to only this session
//     if (response.data && response.data.messages) {
//       response.data.messages = response.data.messages.filter(msg => 
//         msg.session_id === sessionId || msg.sessionId === sessionId
//       );
//     }
    
//     if (response.data && response.data.chatHistory) {
//       response.data.chatHistory = response.data.chatHistory.filter(msg => 
//         msg.session_id === sessionId || msg.sessionId === sessionId
//       );
//     }
    
//     console.log(`[documentApi] Filtered session data:`, response.data);
//     return response.data;
//   },

//   // ✅ NEW: Get specific chat history by file and session
//   getChatHistoryByFileAndSession: async (fileId, sessionId) => {
//     console.log(`[documentApi] Fetching chat history for file ${fileId}, session ${sessionId}`);
    
//     try {
//       const response = await axios.get(
//         `${API_BASE_URL}/files/${fileId}/sessions/${sessionId}`,
//         { headers: getAuthHeader() }
//       );
      
//       // Filter messages to ensure only this session's messages
//       let messages = [];
//       if (response.data.messages && Array.isArray(response.data.messages)) {
//         messages = response.data.messages.filter(msg => 
//           msg.session_id === sessionId || msg.sessionId === sessionId
//         );
//       } else if (response.data.chatHistory && Array.isArray(response.data.chatHistory)) {
//         messages = response.data.chatHistory.filter(msg => 
//           msg.session_id === sessionId || msg.sessionId === sessionId
//         );
//       }
      
//       console.log(`[documentApi] Filtered messages for session ${sessionId}:`, messages);
      
//       return {
//         ...response.data,
//         messages,
//         chatHistory: messages
//       };
//     } catch (error) {
//       console.error(`[documentApi] Error fetching session ${sessionId}:`, error);
//       throw error;
//     }
//   },

//   // Continue chat in a session
//   continueFolderChat: async (folderName, sessionId, question) => {
//     const response = await axios.post(
//       `${API_BASE_URL}/${folderName}/sessions/${sessionId}/continue`,
//       { question },
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Delete a chat session
//   deleteFolderChatSession: async (folderName, sessionId) => {
//     const response = await axios.delete(
//       `${API_BASE_URL}/${folderName}/sessions/${sessionId}`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get all secrets
//   getSecrets: async () => {
//     const response = await axios.get(`${API_BASE_URL}/files/secrets?fetch=true`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Get a specific secret by ID
//   getSecretById: async (secretId) => {
//     const response = await axios.get(`${API_BASE_URL}/files/secrets/${secretId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Get all chats for a specific folder
//   getFolderChats: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/chats`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // ✅ FIXED: Get chat history with proper session filtering
//   getChatHistory: async (fileId) => {
//     console.log(`[documentApi] Fetching all chat history for file: ${fileId}`);
    
//     const response = await axios.get(
//       `${API_BASE_URL}/files/chat-history/${fileId}`,
//       { headers: getAuthHeader() }
//     );
    
//     return response.data;
//   },

//   // ✅ NEW: Fetch chat sessions with better structure
//   fetchChatSessions: async (page = 1, limit = 20) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/chat-sessions?page=${page}&limit=${limit}`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get all cases
//   getCases: async () => {
//     const response = await axios.get(`${API_BASE_URL}/cases`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Get a specific case by ID
//   getCaseById: async (caseId) => {
//     const response = await axios.get(`${API_BASE_URL}/cases/${caseId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Update a case
//   updateCase: async (caseId, caseData) => {
//     const response = await axios.put(
//       `${API_BASE_URL}/cases/${caseId}`,
//       caseData,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Delete a case
//   deleteCase: async (caseId) => {
//     const response = await axios.delete(`${API_BASE_URL}/cases/${caseId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },
// };

// export default documentApi;




// import axios from 'axios';

// const API_BASE_URL = 'https://gateway-service-120280829617.asia-south1.run.app/docs';

// const getAuthHeader = () => {
//   const token = localStorage.getItem('token');
//   return token ? { Authorization: `Bearer ${token}` } : {};
// };

// const documentApi = {
//   // Create a new folder
//   createFolder: async (folderName, parentPath = '') => {
//     const response = await axios.post(
//       `${API_BASE_URL}/create-folder`,
//       { folderName, parentPath },
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get all folders & files
//   getFoldersAndFiles: async () => {
//     const response = await axios.get(`${API_BASE_URL}/folders`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Get documents in a specific folder
//   getDocumentsInFolder: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/files`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Upload multiple documents
//   uploadDocuments: async (folderName, files) => {
//     const formData = new FormData();
//     files.forEach((file) => formData.append('files', file));
//     try {
//       const response = await axios.post(
//         `${API_BASE_URL}/${folderName}/upload`,
//         formData,
//         {
//           headers: {
//             ...getAuthHeader(),
//             'Content-Type': 'multipart/form-data',
//           },
//         }
//       );
//       return { success: true, documents: response.data.documents || [] };
//     } catch (error) {
//       if (error.response && error.response.status === 403) {
//         return {
//           success: false,
//           message: error.response.data.message || 'Token exhausted.',
//         };
//       }
//       return {
//         success: false,
//         message: error.message || 'An unexpected error occurred during upload.',
//       };
//     }
//   },

//   // Get folder summary
//   getFolderSummary: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/summary`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get file processing status
//   getFileProcessingStatus: async (fileId) => {
//     const response = await axios.get(`${API_BASE_URL}/status/${fileId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Get folder processing status
//   getFolderProcessingStatus: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/status`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get document content
//   getDocumentContent: async (fileId) => {
//     const response = await axios.get(`${API_BASE_URL}/status/${fileId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // ✅ FIXED: Query folder documents - Now supports both custom queries and secret prompts
//   queryFolderDocuments: async (folderName, question, sessionId = null, options = {}) => {
//     if (!folderName) {
//       throw new Error('Folder name is required to query documents');
//     }
//     // Build payload
//     const payload = {
//       question: question || '', // Empty string for secret prompts
//       session_id: sessionId,
//       ...options // This includes: secret_id, llm_name, prompt_label, additional_input, etc.
//     };
//     console.log('[documentApi] Sending request:', { folderName, payload, isSecretPrompt: !!options.secret_id });
//     const response = await axios.post(
//       `${API_BASE_URL}/${folderName}/query`,
//       payload,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Query documents from test_case folder
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

//   // ✅ DEPRECATED: Use queryFolderDocuments with options instead
//   // Keeping for backward compatibility but should be removed
//   queryFolderDocumentsWithSecret: async (folderName, promptValue, promptLabel, sessionId = null) => {
//     console.warn('[documentApi] queryFolderDocumentsWithSecret is deprecated. Use queryFolderDocuments with options instead.');
//     if (!folderName) {
//       throw new Error('Folder name is required to query documents');
//     }
//     const payload = {
//       question: promptValue,
//       prompt_label: promptLabel,
//       session_id: sessionId
//     };
//     const response = await axios.post(
//       `${API_BASE_URL}/${folderName}/query`,
//       payload,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get all chat sessions for a folder
//   getFolderChatSessions: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/sessions`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get a specific chat session
//   getFolderChatSessionById: async (folderName, sessionId) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/sessions/${sessionId}`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Continue chat in a session
//   continueFolderChat: async (folderName, sessionId, question) => {
//     const response = await axios.post(
//       `${API_BASE_URL}/${folderName}/sessions/${sessionId}/continue`,
//       { question },
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Delete a chat session
//   deleteFolderChatSession: async (folderName, sessionId) => {
//     const response = await axios.delete(
//       `${API_BASE_URL}/${folderName}/sessions/${sessionId}`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get all secrets
//   getSecrets: async () => {
//     const response = await axios.get(`${API_BASE_URL}/files/secrets?fetch=true`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Get a specific secret by ID
//   getSecretById: async (secretId) => {
//     const response = await axios.get(`${API_BASE_URL}/files/secrets/${secretId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Get all chats for a specific folder
//   getFolderChats: async (folderName) => {
//     const response = await axios.get(
//       `${API_BASE_URL}/${folderName}/chats`,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Get all cases
//   getCases: async () => {
//     const response = await axios.get(`${API_BASE_URL}/cases`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Get a specific case by ID
//   getCaseById: async (caseId) => {
//     const response = await axios.get(`${API_BASE_URL}/cases/${caseId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Update a case
//   updateCase: async (caseId, caseData) => {
//     const response = await axios.put(
//       `${API_BASE_URL}/cases/${caseId}`,
//       caseData,
//       { headers: getAuthHeader() }
//     );
//     return response.data;
//   },

//   // Delete a case
//   deleteCase: async (caseId) => {
//     const response = await axios.delete(`${API_BASE_URL}/cases/${caseId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },

//   // Delete a file by ID
//   deleteFile: async (fileId) => {
//     const response = await axios.delete(`${API_BASE_URL}/${fileId}`, {
//       headers: getAuthHeader(),
//     });
//     return response.data;
//   },
  
// };

// export default documentApi;


import axios from 'axios';

const API_BASE_URL = 'https://gateway-service-120280829617.asia-south1.run.app/docs';

const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const documentApi = {
  // Create a new folder
  createFolder: async (folderName, parentPath = '') => {
    const response = await axios.post(
      `${API_BASE_URL}/create-folder`,
      { folderName, parentPath },
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  // Get all folders & files
  getFoldersAndFiles: async () => {
    const response = await axios.get(`${API_BASE_URL}/folders`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  // Get documents in a specific folder
  getDocumentsInFolder: async (folderName) => {
    const response = await axios.get(
      `${API_BASE_URL}/${folderName}/files`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  // Upload multiple documents (with signed URL support for large files >32MB)
  uploadDocuments: async (folderName, files, secret_id = null) => {
    const isProduction = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
    const environment = isProduction ? 'PRODUCTION' : 'LOCALHOST';
    const LARGE_FILE_THRESHOLD = 32 * 1024 * 1024; // 32MB in bytes
    const uploadedDocuments = [];

    console.log(`[uploadDocuments] 🚀 Starting upload for ${files.length} file(s) to folder: ${folderName}`);
    console.log(`[uploadDocuments] 🌍 Environment: ${environment}`);
    console.log(`[uploadDocuments] 🔗 API Base URL: ${API_BASE_URL}`);

    for (const file of files) {
      const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
      const isLarge = file.size > LARGE_FILE_THRESHOLD;
      
      try {
        // Check if file is larger than 32MB
        if (isLarge) {
          // Use signed URL upload for large files
          console.log(`\n[📤 SIGNED URL UPLOAD] Starting upload for: ${file.name} (${fileSizeMB}MB)`);
          console.log(`[📤 SIGNED URL UPLOAD] Environment: ${environment}`);
          console.log(`[📤 SIGNED URL UPLOAD] Folder: ${folderName}`);
          
          // Step 1: Get signed URL
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

          // Step 2: Upload file directly to GCS using PUT
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

          // Step 3: Notify backend to process the file
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
          // Use regular multipart upload for small files
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
        // Continue with other files even if one fails
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

  // Get folder summary
  getFolderSummary: async (folderName) => {
    const response = await axios.get(
      `${API_BASE_URL}/${folderName}/summary`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  // Get file processing status
  getFileProcessingStatus: async (fileId) => {
    const response = await axios.get(`${API_BASE_URL}/status/${fileId}`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  // Get folder processing status
  getFolderProcessingStatus: async (folderName) => {
    const response = await axios.get(
      `${API_BASE_URL}/${folderName}/status`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  // Get document content
  getDocumentContent: async (fileId) => {
    const response = await axios.get(`${API_BASE_URL}/status/${fileId}`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  // ✅ UPDATED: Query folder documents using intelligent-chat endpoint
  queryFolderDocuments: async (folderName, question, sessionId = null, options = {}) => {
    if (!folderName) {
      throw new Error('Folder name is required to query documents');
    }
    // Build payload
    const payload = {
      question: question || '', // Empty string for secret prompts
      session_id: sessionId,
      llm_name: options.llm_name || 'gemini', // Optional
      ...options // This includes: secret_id, prompt_label, additional_input, etc.
    };
    console.log('[documentApi] Sending request to intelligent-chat:', { folderName, payload });
    const response = await axios.post(
      `${API_BASE_URL}/${folderName}/intelligent-chat`,
      payload,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  // Query documents from test_case folder
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

  // ✅ DEPRECATED: Use queryFolderDocuments with options instead
  // Keeping for backward compatibility but should be removed
  queryFolderDocumentsWithSecret: async (folderName, promptValue, promptLabel, sessionId = null) => {
    console.warn('[documentApi] queryFolderDocumentsWithSecret is deprecated. Use queryFolderDocuments with options instead.');
    if (!folderName) {
      throw new Error('Folder name is required to query documents');
    }
    const payload = {
      question: promptValue,
      prompt_label: promptLabel,
      session_id: sessionId,
      llm_name: 'gemini', // Optional
    };
    const response = await axios.post(
      `${API_BASE_URL}/${folderName}/intelligent-chat`,
      payload,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  // Get all chat sessions for a folder
  getFolderChatSessions: async (folderName) => {
    const response = await axios.get(
      `${API_BASE_URL}/${folderName}/sessions`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  // Get a specific chat session
  getFolderChatSessionById: async (folderName, sessionId) => {
    const response = await axios.get(
      `${API_BASE_URL}/${folderName}/sessions/${sessionId}`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  // Continue chat in a session
  continueFolderChat: async (folderName, sessionId, question) => {
    const response = await axios.post(
      `${API_BASE_URL}/${folderName}/sessions/${sessionId}/continue`,
      { question },
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  // Delete a chat session
  deleteFolderChatSession: async (folderName, sessionId) => {
    const response = await axios.delete(
      `${API_BASE_URL}/${folderName}/sessions/${sessionId}`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  // Get all secrets
  getSecrets: async () => {
    const response = await axios.get(`${API_BASE_URL}/files/secrets?fetch=true`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  // Get a specific secret by ID
  getSecretById: async (secretId) => {
    const response = await axios.get(`${API_BASE_URL}/files/secrets/${secretId}`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  // Get all chats for a specific folder
  getFolderChats: async (folderName) => {
    const response = await axios.get(
      `${API_BASE_URL}/${folderName}/chats`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  // Delete a single chat in a folder by chat ID
  deleteSingleFolderChat: async (folderName, chatId) => {
    const response = await axios.delete(
      `${API_BASE_URL}/${folderName}/chat/${chatId}`, // ✅ Use /chat/:chatId endpoint (not /chats/:sessionId)
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  // Delete all chats in a folder
  deleteAllFolderChats: async (folderName) => {
    const response = await axios.delete(
      `${API_BASE_URL}/${folderName}/chats`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  // Get all cases
  getCases: async () => {
    const response = await axios.get(`${API_BASE_URL}/cases`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  // Get a specific case by ID
  getCaseById: async (caseId) => {
    const response = await axios.get(`${API_BASE_URL}/cases/${caseId}`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  // Update a case
  updateCase: async (caseId, caseData) => {
    const response = await axios.put(
      `${API_BASE_URL}/cases/${caseId}`,
      caseData,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  // Delete a case
  deleteCase: async (caseId) => {
    const response = await axios.delete(`${API_BASE_URL}/cases/${caseId}`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  // Delete a file by ID
  deleteFile: async (fileId) => {
    const response = await axios.delete(`${API_BASE_URL}/${fileId}`, {
      headers: getAuthHeader(),
    });
    return response.data;
  },

  // Generate signed URL for document upload (for large files >32MB)
  generateDocumentUploadUrl: async (filename, mimetype, size) => {
    // Use /files/* which maps to /api/doc/* through gateway
    const baseUrl = API_BASE_URL.replace('/docs', '/files');
    const response = await axios.post(
      `${baseUrl}/generate-upload-url`,
      { filename, mimetype, size },
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  // Complete document upload after signed URL upload
  completeDocumentUpload: async (gcsPath, filename, mimetype, size, secret_id = null) => {
    // Use /files/* which maps to /api/doc/* through gateway
    const baseUrl = API_BASE_URL.replace('/docs', '/files');
    const response = await axios.post(
      `${baseUrl}/complete-upload`,
      { gcsPath, filename, mimetype, size, secret_id },
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  // Upload document with signed URL support for large files
  uploadDocument: async (file, secret_id = null) => {
    const LARGE_FILE_THRESHOLD = 32 * 1024 * 1024; // 32MB in bytes

    // Check if file is larger than 32MB
    if (file.size > LARGE_FILE_THRESHOLD) {
      console.log(`📤 Uploading large document via signed URL: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
      
      // Step 1: Get signed URL
      const urlResponse = await this.generateDocumentUploadUrl(file.name, file.type, file.size);
      const { signedUrl, gcsPath, filename } = urlResponse;

      // Step 2: Upload file directly to GCS using PUT
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

      // Step 3: Notify backend to process the file
      const completeResponse = await this.completeDocumentUpload(
        gcsPath,
        filename,
        file.type,
        file.size,
        secret_id
      );

      return completeResponse;
    } else {
      // Use regular multipart upload for small files
      const formData = new FormData();
      formData.append('document', file);
      if (secret_id) {
        formData.append('secret_id', secret_id);
      }

      // Use /files/* which maps to /api/doc/* through gateway
      const baseUrl = API_BASE_URL.replace('/docs', '/files');
      const response = await axios.post(
        `${baseUrl}/upload`,
        formData,
        {
          headers: {
            ...getAuthHeader(),
            'Content-Type': 'multipart/form-data',
          },
        }
      );

      return response.data;
    }
  },
  
};

export default documentApi;
