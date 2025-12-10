
const API_BASE_URL =
 import.meta.env.VITE_APP_API_URL || "http://localhost:5000";

class ApiService {
 constructor() {
 this.baseURL = API_BASE_URL;
 }

 getAuthToken() {
 const token = localStorage.getItem("token");
 console.log(
 `[ApiService] getAuthToken: Token ${token ? 'Present' : 'Not Present'}`
 );
 return token;
 }

 async request(endpoint, options = {}) {
 const url =
 endpoint.startsWith("http://") || endpoint.startsWith("https://")
 ? endpoint
 : `${this.baseURL}${endpoint}`;
 const token = this.getAuthToken();
 const { responseType, ...fetchOptions } = options;

 console.log(`[ApiService] Requesting URL: ${url}`);
 console.log(`[ApiService] Request method: ${options.method || 'GET'}`);
 console.log(`[ApiService] Full URL being sent: ${url}`);

 const headers = {
 ...(fetchOptions.body instanceof FormData
 ? {}
 : { "Content-Type": "application/json" }),
 ...fetchOptions.headers,
 };

 if (token) {
 headers["Authorization"] = `Bearer ${token}`;
 console.log('[ApiService] Authorization header added.');
 } else {
 console.log('[ApiService] No token found, Authorization header NOT added.');
 }

 const config = {
 headers,
 credentials: "include",
 ...fetchOptions,
 };

 try {
 const response = await fetch(url, config);

 if (!response.ok) {
 const errorData = await response.json().catch(() => ({}));
 const error = new Error(
 errorData.message || errorData.error || `HTTP error! status: ${response.status}`
 );
 error.response = {
 status: response.status,
 data: errorData
 };
 throw error;
 }

 if (responseType === "arrayBuffer") {
 return await response.arrayBuffer();
 }
 return await response.json();
 } catch (error) {
 console.error("API request failed:", error);
 throw error;
 }
 }

 // ========================
 // ✅ Auth APIs
 // ========================
 async login(credentials) {
 const response = await this.request("/auth/api/auth/login", {
 method: "POST",
 body: JSON.stringify(credentials),
 });
 if (response.token) {
 localStorage.setItem("token", response.token);
 }
 return response;
 }

 // async register(userData) {
 // return this.request("/auth/api/auth/register", {
 // method: "POST",
 // body: JSON.stringify(userData),
 // });
 // }


 async register(userData) {
 // Updated to match the expected endpoint pattern
 return this.request("/auth/api/auth/register", {
 method: "POST",
 body: JSON.stringify(userData),
 });
 }

 async logout() {
 localStorage.removeItem("token");
 localStorage.removeItem("user");
 window.dispatchEvent(new Event("userUpdated"));
 return { message: "Logged out successfully locally" };
 }

 async updateProfile(userData) {
 return this.request("/auth/api/auth/update", {
 method: "PUT",
 body: JSON.stringify(userData),
 });
 }

 async updatePassword(passwordData) {
 return this.request("/auth/api/auth/change-password", {
 method: "PUT",
 body: JSON.stringify(passwordData),
 });
 }

 // Professional Profile APIs
 async getProfessionalProfile() {
 return this.request("/auth/api/auth/professional-profile", {
 method: "GET",
 });
 }

 async updateProfessionalProfile(profileData) {
 return this.request("/auth/api/auth/professional-profile", {
 method: "PUT",
 body: JSON.stringify(profileData),
 });
 }

 async deleteAccount() {
 return this.request("/auth/api/auth/delete", {
 method: "DELETE",
 });
 }

 async logoutUser() {
 return this.request("/auth/api/auth/logout", {
 method: "POST",
 });
 }

 async fetchProfile() {
 return this.request("/auth/api/auth/profile");
 }

 async verifyOtp(email, otp) {
 const response = await this.request("http://localhost:5000/auth/api/auth/verify-otp", {
 method: "POST",
 body: JSON.stringify({ email, otp }),
 });
 if (response.token) {
 localStorage.setItem("token", response.token);
 }
 return response;
 }

 // ========================
 // ✅ Template APIs
 // ========================
 async getTemplates() {
 return this.request("/drafting");
 }

 async getUserTemplates() {
 return this.request("/drafting/user");
 }

 async getTemplateById(id) {
 return this.request(`/drafting/${id}`);
 }

 async openTemplateForEditing(templateId) {
 return this.request(`/drafting/${templateId}/open`);
 }

 async saveUserDraft(templateId, name, file) {
 const formData = new FormData();
 formData.append("templateId", templateId);
 formData.append("name", name);
 formData.append("file", file);

 return this.request("/templates/draft", {
 method: "POST",
 body: formData,
 });
 }

 async getTemplateDocxArrayBuffer(templateId) {
 return this.request(`/templates/${templateId}/docx`, {
 responseType: "arrayBuffer",
 });
 }

 async exportUserDraft(draftId) {
 return this.request(`/templates/${draftId}/export`);
 }

 async addHtmlTemplate(templateData) {
 return this.request("/templates/admin/html", {
 method: "POST",
 body: JSON.stringify(templateData),
 });
 }

 async getDraftingTemplates() {
 return this.request("http://localhost:5000/drafting");
 }

 // ========================
 // ✅ Document APIs
 // ========================
 async saveDocument(documentData) {
 return this.request("/doc/save", {
 method: "POST",
 body: JSON.stringify(documentData),
 });
 }

 async getDocuments() {
 return this.request("/doc");
 }

 async getDocument(documentId) {
 return this.request(`/doc/${documentId}`);
 }

 // ========================
 // ✅ Subscription Plans APIs
 // ========================
 async getPublicPlans() {
 return this.request(`/payments/plans`);
 }

 async startSubscription(plan_id) {
 return this.request("/payments/subscription/start", {
 method: "POST",
 body: JSON.stringify({ plan_id }),
 });
 }

 async verifySubscription(paymentData) {
 return this.request("/payments/subscription/verify", {
 method: "POST",
 body: JSON.stringify(paymentData),
 });
 }

 async getPaymentPlans() {
 return this.request(`/payments/plans`);
 }

 // ========================
 // ✅ User Resource APIs
 // ========================
 async getUserPlanDetails(service = "") {
 const endpoint = service
 ? `/user-resources/plan-details?service=${service}`
 : `/user-resources/plan-details`;
 return this.request(endpoint);
 }

 async getUserTransactions() {
 return this.request(`/user-resources/transactions`);
 }

 async fetchPaymentHistory() {
 return this.request("/payments/history");
 }

 async getUserTokenUsage(userId) {
 return this.request(`/files/user-usage-and-plan/${userId}`);
 }

 // ========================
 // ✅ File Management APIs
 // ========================
 async uploadSingleFile(file, folderPath = "") {
 const formData = new FormData();
 formData.append("files", file);
 if (folderPath) {
 formData.append("folderPath", folderPath);
 }
 return this.request("/files/upload", {
 method: "POST",
 body: formData,
 });
 }

 async uploadMultipleFiles(files, folderPath = "") {
 const formData = new FormData();
 Array.from(files).forEach((file) => {
 formData.append("files", file);
 });
 if (folderPath) {
 formData.append("folderPath", folderPath);
 }
 return this.request("/files/upload-folder", {
 method: "POST",
 body: formData,
 });
 }

 async getFileStatus(fileId) {
 return this.request(`/files/status/${fileId}`);
 }

 // ========================
 // ✅ Document Processing APIs
 // ========================
 async uploadDocumentForProcessing(file) {
 const formData = new FormData();
 formData.append("file", file);
 return this.request("/documents/upload", {
 method: "POST",
 body: formData,
 });
 }

 async batchUploadDocument(file) {
 const formData = new FormData();
 formData.append("document", file);
 return this.request("/documents/batch-upload", {
 method: "POST",
 body: formData,
 });
 }

 // ========================
 // ✅ Template Drafting APIs
 // ========================
 async saveUserDraftFromTemplate(file, templateId, name) {
 const formData = new FormData();
 formData.append("file", file);
 formData.append("templateId", templateId);
 formData.append("name", name);
 return this.request("/templates/draft", {
 method: "POST",
 body: formData,
 });
 }

 async fetchChatsBySessionId(sessionId) {
 if (!sessionId) {
 console.warn("[ApiService] fetchChatsBySessionId called without sessionId.");
 return;
 }
 return this.request(`/files/session/${sessionId}`);
 }

 // ========================
 // ✅ Chat APIs
 // ========================
 async fetchChatSessions(page = 1, limit = 20) {
 return this.request(`/files?page=${page}&limit=${limit}`);
 }

 async getFolderChatSessions(folderName) {
 return this.request(`/files/${folderName}/chat/sessions`);
 }

 async getFolderChatSessionById(folderName, sessionId) {
 return this.request(`/files/${folderName}/chat/sessions/${sessionId}`);
 }

 async queryFolderDocuments(folderName, question) {
 return this.request(`/docs/${folderName}/intelligent-chat`, {
 method: "POST",
 body: JSON.stringify({ question }),
 });
 }

 async continueFolderChat(folderName, sessionId, question) {
 return this.request(`/docs/${folderName}/intelligent-chat`, {
 method: "POST",
 body: JSON.stringify({ question, session_id: sessionId }),
 });
 }

 async deleteFolderChatSession(folderName, sessionId) {
 return this.request(`/files/${folderName}/chat/sessions/${sessionId}`, {
 method: "DELETE",
 });
 }

 async queryTestDocuments(question, sessionId) {
 return this.request(`/files/test/chat`, {
 method: "POST",
 body: JSON.stringify({ question, session_id: sessionId }),
 });
 }

 async queryFolderDocumentsWithSecret(folderName, question, promptLabel, sessionId) {
 return this.request(`/docs/${folderName}/intelligent-chat`, {
 method: "POST",
 body: JSON.stringify({ question, prompt_label: promptLabel, session_id: sessionId, llm_name: 'gemini' }),
 });
 }

 // ========================
 // ✅ Chat Deletion APIs
 // ========================
 async getChatStatistics() {
 return this.request(`/files/chats/statistics`);
 }

 async getDeletePreview(filters) {
 return this.request(`/files/chats/delete-preview`, {
 method: "POST",
 body: JSON.stringify(filters),
 });
 }

 async deleteChat(chatId) {
 return this.request(`/files/chat/${chatId}`, {
 method: "DELETE",
 });
 }

 async deleteSelectedChats(chatIds) {
 return this.request(`/files/chats/selected`, {
 method: "DELETE",
 body: JSON.stringify({ chat_ids: chatIds }),
 });
 }

 async deleteAllChats() {
 return this.request(`/files/chats/all`, {
 method: "DELETE",
 });
 }

 async deleteChatsBySession(sessionId) {
 return this.request(`/files/chats/session/${sessionId}`, {
 method: "DELETE",
 });
 }

 async deleteChatsByFile(fileId) {
 return this.request(`/files/chats/file/${fileId}`, {
 method: "DELETE",
 });
 }

 // ========================
 // ✅ Secret Manager APIs
 // ========================
 async getSecrets() {
 return this.request(`/files/secrets?fetch=true`);
 }

 async getSecretById(secretId) {
 return this.request(`/files/secrets/${secretId}`);
 }

 // ✅ UPDATED: triggerLLMWithSecret method
 async triggerLLMWithSecret(secretId, fileId, additionalInput = "") {
 return this.request("/files/trigger-llm", {
 method: "POST",
 body: JSON.stringify({ 
 secretId, 
 fileId,
 additionalInput 
 }),
 });
 }

 // ========================
 // ✅ Support APIs
 // ========================
 async submitSupportQuery(queryData) {
 return this.request("/support", {
 method: "POST",
 body: JSON.stringify(queryData),
 });
 }

 // ========================
 // ✅ ChatModel APIs (Base URL: http://localhost:5000)
 // ========================
 
 // Helper method for ChatModel API requests
 async chatModelRequest(endpoint, options = {}) {
 const CHAT_MODEL_BASE_URL = "http://localhost:5000";
 const url = endpoint.startsWith("http://") || endpoint.startsWith("https://")
   ? endpoint
   : `${CHAT_MODEL_BASE_URL}${endpoint}`;
 const token = this.getAuthToken();
 const { responseType, ...fetchOptions } = options;

 const headers = {
   ...(fetchOptions.body instanceof FormData
     ? {}
     : { "Content-Type": "application/json" }),
   ...fetchOptions.headers,
 };

 if (token) {
   headers["Authorization"] = `Bearer ${token}`;
 }

 const config = {
   headers,
   credentials: "include",
   ...fetchOptions,
 };

 try {
   const response = await fetch(url, config);

   if (!response.ok) {
     const errorData = await response.json().catch(() => ({}));
     const error = new Error(
       errorData.message || errorData.error || `HTTP error! status: ${response.status}`
     );
     error.response = {
       status: response.status,
       data: errorData
     };
     throw error;
   }

   if (responseType === "arrayBuffer") {
     return await response.arrayBuffer();
   }
   return await response.json();
 } catch (error) {
   console.error("ChatModel API request failed:", error);
   throw error;
 }
 }

 // Upload document for ChatModel
 async uploadChatModelDocument(file) {
 const formData = new FormData();
 formData.append("document", file);
 return this.chatModelRequest("/chat/upload-document", {
   method: "POST",
   body: formData,
 });
 }

 // Ask question (non-streaming)
 async askChatModelQuestion(question, fileId, sessionId = null) {
 const body = { question, file_id: fileId };
 if (sessionId) {
   body.session_id = sessionId;
 }
 return this.chatModelRequest("/chat/ask", {
   method: "POST",
   body: JSON.stringify(body),
 });
 }

 // Ask question (streaming) - returns EventSource-like stream
 async askChatModelQuestionStream(question, fileId, sessionId = null, onChunk, onStatus, onMetadata, onDone, onError) {
 const CHAT_MODEL_BASE_URL = "http://localhost:5000";
 const token = this.getAuthToken();
 
 const body = { question, file_id: fileId };
 if (sessionId) {
   body.session_id = sessionId;
 }

 const headers = {
   "Content-Type": "application/json",
   "Accept": "text/event-stream",
 };
 if (token) {
   headers["Authorization"] = `Bearer ${token}`;
 }

 try {
   const response = await fetch(`${CHAT_MODEL_BASE_URL}/chat/ask/stream`, {
     method: "POST",
     headers,
     body: JSON.stringify(body),
   });

   if (!response.ok) {
     const errorData = await response.json().catch(() => ({}));
     throw new Error(errorData.message || errorData.error || `HTTP error! status: ${response.status}`);
   }

   const reader = response.body.getReader();
   const decoder = new TextDecoder();
   let buffer = '';
   let streamDone = false;

   while (true) {
     const { done, value } = await reader.read();
     
     if (done) {
       streamDone = true;
       // If we haven't received a [DONE] message, call onDone with current buffer
       if (onDone && !streamDone) {
         onDone({ answer: buffer });
       }
       break;
     }

     buffer += decoder.decode(value, { stream: true });
     const lines = buffer.split('\n');
     buffer = lines.pop() || '';

     for (const line of lines) {
       if (!line.trim()) continue;
       
       let data = line.trim();
       if (data.startsWith('data: ')) {
         data = data.substring(6).trim();
       }
       
       if (data === '[PING]') {
         continue;
       }
       
       if (data === '[DONE]') {
         streamDone = true;
         break;
       }

       if (!data) continue;

       try {
         const parsed = JSON.parse(data);
         
         if (parsed.type === 'status' && onStatus) {
           onStatus(parsed.status, parsed.message);
         } else if (parsed.type === 'metadata' && onMetadata) {
           onMetadata(parsed);
         } else if (parsed.type === 'chunk' && onChunk) {
           onChunk(parsed.text || '');
         } else if (parsed.type === 'done' && onDone) {
           onDone(parsed);
           streamDone = true;
         } else if (parsed.type === 'error' && onError) {
           onError(parsed.message, parsed.details);
           streamDone = true;
         }
       } catch (e) {
         // Skip invalid JSON - might be partial data
         console.warn('Failed to parse SSE data:', data, e);
       }
     }
     
     if (streamDone) break;
   }
 } catch (error) {
   console.error("ChatModel streaming error:", error);
   if (onError) {
     onError(error.message);
   }
   throw error;
 }
 }


 // Get user files
 async getChatModelFiles() {
 return this.chatModelRequest("/chat/files");
 }

 // Get chat history
 async getChatModelHistory(fileId, sessionId = null) {
 let endpoint = `/chat/history/${fileId}`;
 if (sessionId) {
   endpoint += `?session_id=${sessionId}`;
 }
 return this.chatModelRequest(endpoint);
 }

 // Get document sessions
 async getChatModelSessions(fileId) {
 return this.chatModelRequest(`/chat/sessions/${fileId}`);
 }

 // Get chunk details by IDs (for file-based chat)
 async getChunkDetails(chunkIds, fileId) {
   if (!chunkIds || chunkIds.length === 0) {
     return [];
   }
   return this.request(`/files/${fileId}/chunks`, {
     method: "POST",
     body: JSON.stringify({ chunk_ids: chunkIds }),
   });
 }

 // Get chunk details by IDs (for folder-based chat)
 async getFolderChunkDetails(chunkIds, folderName) {
   if (!chunkIds || chunkIds.length === 0 || !folderName) {
     console.log('[API] getFolderChunkDetails: Missing chunkIds or folderName', { chunkIds, folderName });
     return [];
   }
   console.log('[API] Fetching chunks for folder:', folderName, 'chunk_ids:', chunkIds);
   try {
     // Try POST first (with chunk_ids in body), fallback to GET if needed
     // Based on user example: GET /api/files/{folderName}/chunks
     // But we need to filter by chunk_ids, so POST makes more sense
     const response = await this.request(`/api/files/${folderName}/chunks`, {
       method: "POST",
       body: JSON.stringify({ chunk_ids: chunkIds }),
     });
     console.log('[API] Chunks response:', response);
     // Handle both response formats: { chunks: [...] } or [...]
     const chunks = Array.isArray(response) ? response : (response.chunks || []);
     console.log('[API] Parsed chunks:', chunks.length, 'chunks');
     return chunks;
   } catch (error) {
     console.error('[API] Error fetching folder chunks:', error);
     // Try alternative: GET with query params
     try {
       const chunkIdsParam = chunkIds.join(',');
       const response = await this.request(`/api/files/${folderName}/chunks?chunk_ids=${chunkIdsParam}`, {
         method: "GET",
       });
       const chunks = Array.isArray(response) ? response : (response.chunks || []);
       console.log('[API] Chunks (GET fallback):', chunks.length, 'chunks');
       return chunks;
     } catch (fallbackError) {
       console.error('[API] Fallback also failed:', fallbackError);
       throw error;
     }
   }
 }
}

export default new ApiService();


