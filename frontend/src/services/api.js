import {
  API_BASE_URL,
  CHAT_MODEL_BASE_URL,
  AUTH_SERVICE_URL,
  SECRET_PROMPTS_API_BASE,
  DOCS_BASE_URL,
  getUserIdForDrafting,
} from '../config/apiConfig';

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
 console.log("[ApiService] Response received:", {
   url,
   status: response.status,
   ok: response.ok,
   contentType: response.headers.get("content-type"),
 });

 if (!response.ok) {
 const errorData = await response.json().catch(() => ({}));
 const normalizedErrorData =
 errorData && typeof errorData === "object" && errorData.detail && typeof errorData.detail === "object"
 ? errorData.detail
 : errorData;
 console.error("[ApiService] Response error payload:", {
   url,
   status: response.status,
   errorData,
   normalizedErrorData,
 });
 const error = new Error(
 normalizedErrorData.message || normalizedErrorData.error || `HTTP error! status: ${response.status}`
 );
 error.code = normalizedErrorData.code;
 error.details = normalizedErrorData.details;
 error.response = {
 status: response.status,
 data: normalizedErrorData,
 rawData: errorData,
 };
 throw error;
 }

 if (responseType === "arrayBuffer") {
 return await response.arrayBuffer();
 }
 const json = await response.json();
 console.log("[ApiService] Response JSON payload:", {
   url,
   status: response.status,
   dataPreview: json,
 });
 return json;
 } catch (error) {
 console.error("API request failed:", error);
 throw error;
 }
 }

 async login(credentials) {
 const response = await this.request("/api/auth/login", {
 method: "POST",
 body: JSON.stringify(credentials),
 });
 if (response.token) {
 localStorage.setItem("token", response.token);
 }
 return response;
 }

  async register(userData) {
    return this.request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(userData),
    });
  }

  async registerSoloLawyer(userData) {
    return this.request("/api/auth/register/solo", {
      method: "POST",
      body: JSON.stringify(userData),
    });
  }

  async registerFirm(firmData) {
    return this.request("/api/auth/register/firm", {
      method: "POST",
      body: JSON.stringify(firmData),
    });
  }

 async logout() {
 localStorage.removeItem("token");
 localStorage.removeItem("user");
 window.dispatchEvent(new Event("userUpdated"));
 return { message: "Logged out successfully locally" };
 }

 async updateProfile(userData) {
 return this.request("/api/auth/update", {
 method: "PUT",
 body: JSON.stringify(userData),
 });
 }

  async updatePassword(passwordData) {
    return this.request("/api/auth/change-password", {
      method: "PUT",
      body: JSON.stringify(passwordData),
    });
  }

  async setPassword(passwordData) {
    return this.request("/api/auth/set-password", {
      method: "POST",
      body: JSON.stringify(passwordData),
    });
  }

 async getProfessionalProfile() {
return this.request(`${AUTH_SERVICE_URL}/api/auth/professional-profile`, {
 method: "GET",
 });
 }

 async updateProfessionalProfile(profileData) {
return this.request(`${AUTH_SERVICE_URL}/api/auth/professional-profile`, {
 method: "PUT",
 body: JSON.stringify(profileData),
 });
 }

 async deleteAccount() {
 return this.request("/api/auth/delete", {
 method: "DELETE",
 });
 }

 async logoutUser() {
 return this.request("/api/auth/logout", {
 method: "POST",
 });
 }

 async fetchProfile() {
 return this.request("/api/auth/profile");
 }

  async verifyOtp(email, otp, newPassword = null) {
    const body = { email, otp };
    if (newPassword) {
      body.newPassword = newPassword;
    }
    const response = await this.request(`${AUTH_SERVICE_URL}/api/auth/verify-otp`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (response.token) {
      localStorage.setItem("token", response.token);
    }
    return response;
  }

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
 return this.request("/drafting");
 }

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

 async fetchChatSessions(page = 1, limit = 20) {
 // Analysis chat sessions routed via backend gateway (/docs -> /api/files).
 return this.request(`/docs/chat-sessions?page=${page}&limit=${limit}`);
 }

 async getFolderChatSessions(folderName) {
 return this.request(`/files/${folderName}/chat/sessions`);
 }

 async getFolderChatSessionById(folderName, sessionId) {
 return this.request(`/files/${folderName}/chat/sessions/${sessionId}`);
 }

 async queryFolderDocuments(folderName, question) {
 const seg = encodeURIComponent(String(folderName ?? "").trim());
 const url = `${String(DOCS_BASE_URL || "").replace(/\/$/, "")}/${seg}/intelligent-chat`;
 const uid = getUserIdForDrafting();
 return this.request(url, {
 method: "POST",
 body: JSON.stringify({ question }),
 headers: uid ? { "X-User-Id": uid } : {},
 });
 }

 async continueFolderChat(folderName, sessionId, question) {
 const seg = encodeURIComponent(String(folderName ?? "").trim());
 const url = `${String(DOCS_BASE_URL || "").replace(/\/$/, "")}/${seg}/intelligent-chat`;
 const uid = getUserIdForDrafting();
 return this.request(url, {
 method: "POST",
 body: JSON.stringify({ question, session_id: sessionId }),
 headers: uid ? { "X-User-Id": uid } : {},
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
 const seg = encodeURIComponent(String(folderName ?? "").trim());
 const url = `${String(DOCS_BASE_URL || "").replace(/\/$/, "")}/${seg}/intelligent-chat`;
 const uid = getUserIdForDrafting();
 return this.request(url, {
 method: "POST",
 body: JSON.stringify({ question, prompt_label: promptLabel, session_id: sessionId, llm_name: 'gemini' }),
 headers: uid ? { "X-User-Id": uid } : {},
 });
 }

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

 async getSecrets() {
 const base = String(SECRET_PROMPTS_API_BASE || CHAT_MODEL_BASE_URL || '').replace(/\/$/, '');
 return this.request(`${base}/secrets?fetch=true`);
 }

 async getSecretById(secretId) {
 const base = String(SECRET_PROMPTS_API_BASE || CHAT_MODEL_BASE_URL || '').replace(/\/$/, '');
 return this.request(`${base}/secrets/${secretId}`);
 }

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

 async submitSupportQuery(queryData) {
 return this.request("/support/tickets", {
 method: "POST",
 body: queryData instanceof FormData ? queryData : JSON.stringify(queryData),
 });
 }

 async getMySupportTickets() {
 return this.request("/support/tickets/my");
 }

 async getSupportTicket(ticketId) {
 return this.request(`/support/tickets/${ticketId}`);
 }

 async getAdminSupportTickets(params = {}) {
 const searchParams = new URLSearchParams();
 if (params.status) {
   searchParams.set("status", params.status);
 }
 if (params.search) {
   searchParams.set("search", params.search);
 }
 const suffix = searchParams.toString() ? `?${searchParams.toString()}` : "";
 return this.request(`/support/tickets/admin/all${suffix}`);
 }

 async markSupportTicketSeen(ticketId) {
 return this.request(`/support/tickets/${ticketId}/seen`, {
 method: "POST",
 });
 }

 async updateSupportTicketStatus(ticketId, payload) {
 return this.request(`/support/tickets/${ticketId}/status`, {
 method: "PATCH",
 body: JSON.stringify(payload),
 });
 }

 async chatModelRequest(endpoint, options = {}) {
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

 // ChatModel uses Bearer token only; omit cookies so CORS can use reflected Origin (not wildcard + credentials).
 const config = {
   headers,
   credentials: "omit",
   ...fetchOptions,
 };

 try {
   const response = await fetch(url, config);

   if (!response.ok) {
     const errorData = await response.json().catch(() => ({}));
     const error = new Error(
       errorData.message || errorData.error || `HTTP error! status: ${response.status}`
     );
     error.code = errorData.code;
     error.details = errorData.details;
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

 async uploadChatModelDocument(file) {
  const mimeType = file?.type || "application/octet-stream";
  const initiate = await this.chatModelRequest("/api/chat/upload-document/initiate", {
    method: "POST",
    body: JSON.stringify({
      filename: file?.name || "document",
      mimetype: mimeType,
      size: Number(file?.size || 0),
    }),
  });

  const uploadData = initiate?.data || {};
  if (!uploadData.upload_url || !uploadData.upload_token) {
    throw new Error("Signed upload response missing upload_url or upload_token");
  }

  const uploadRes = await fetch(uploadData.upload_url, {
    method: uploadData.method || "PUT",
    headers: uploadData.headers || { "Content-Type": mimeType },
    body: file,
  });
  if (!uploadRes.ok) {
    throw new Error(`Signed upload failed with status ${uploadRes.status}`);
  }

  return this.chatModelRequest("/api/chat/upload-document/complete", {
    method: "POST",
    body: JSON.stringify({
      upload_token: uploadData.upload_token,
      filename: file?.name || "document",
      mimetype: mimeType,
      size: Number(file?.size || 0),
    }),
  });
 }

 async askChatModelQuestion(question, fileId, sessionId = null) {
 const body = { question, file_id: fileId };
 if (sessionId) {
   body.session_id = sessionId;
 }
 return this.chatModelRequest("/api/chat/ask", {
   method: "POST",
   body: JSON.stringify(body),
 });
 }

 async askChatModelQuestionStream(question, fileId, sessionId = null, onChunk, onStatus, onMetadata, onDone, onError, secretId = null, usedSecretPrompt = false, promptLabel = null, additionalInput = null, llmName = null, extraFetchParams = null, fileIds = null) {
 const token = this.getAuthToken();
 
 const body = { question, file_id: fileId };
 if (Array.isArray(fileIds) && fileIds.length > 1) {
   body.file_ids = fileIds;
 }
 if (sessionId) {
   body.session_id = sessionId;
 }
 if (usedSecretPrompt && secretId) {
   body.secret_id = secretId;
   body.used_secret_prompt = true;
   body.prompt_label = promptLabel;
   if (additionalInput) {
     body.additional_input = additionalInput;
   }
 }
 if (llmName) {
   body.llm_name = llmName;
 }
 if (extraFetchParams && typeof extraFetchParams === 'object') {
   const rawMot =
     extraFetchParams.max_output_tokens != null && extraFetchParams.max_output_tokens !== ''
       ? extraFetchParams.max_output_tokens
       : extraFetchParams.maxOutputTokens;
   if (rawMot != null && rawMot !== '') {
     const n = Number(rawMot);
     if (Number.isFinite(n)) body.max_output_tokens = n;
   }
   const rawTemp =
     extraFetchParams.model_temperature != null && extraFetchParams.model_temperature !== ''
       ? extraFetchParams.model_temperature
       : extraFetchParams.temperature;
   if (rawTemp != null && rawTemp !== '') {
     const t = Number(rawTemp);
     if (Number.isFinite(t)) body.model_temperature = t;
   }
 }

 const headers = {
   "Content-Type": "application/json",
   "Accept": "text/event-stream",
 };
 if (token) {
   headers["Authorization"] = `Bearer ${token}`;
 }

 try {
   const response = await fetch(`${CHAT_MODEL_BASE_URL}/api/chat/ask/stream`, {
     method: "POST",
     headers,
     body: JSON.stringify(body),
   });

   if (!response.ok) {
     const errorData = await response.json().catch(() => ({}));
     const err = new Error(errorData.message || errorData.error || `HTTP error! status: ${response.status}`);
     err.code = errorData.code;
     err.details = errorData.details;
     err.status = response.status;
     throw err;
   }

   const reader = response.body.getReader();
   const decoder = new TextDecoder();
   let buffer = '';
   let streamDone = false;
   let doneDispatched = false;
   let accumulatedAnswer = '';

   while (true) {
     const { done, value } = await reader.read();
     
     if (done) {
       break;
     }

     buffer += decoder.decode(value, { stream: true });
     const lines = buffer.split(/\r\n|\n|\r/);
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
           const piece = typeof parsed.text === 'string' ? parsed.text : '';
           accumulatedAnswer += piece;
           onChunk(piece);
         } else if (parsed.type === 'done' && onDone) {
           const fromServer = typeof parsed.answer === 'string' ? parsed.answer : '';
           const merged =
             fromServer.length > accumulatedAnswer.length ? fromServer : (accumulatedAnswer || fromServer);
           doneDispatched = true;
           onDone({ ...parsed, answer: merged });
           streamDone = true;
          } else if (parsed.type === 'error' && onError) {
            onError(parsed.message, parsed.details, parsed.code);
            streamDone = true;
          }
       } catch (e) {
         console.warn('Failed to parse SSE data:', data, e);
       }
     }
     
     if (streamDone) break;
   }

   if (onDone && !doneDispatched) {
     doneDispatched = true;
     onDone({ answer: accumulatedAnswer });
   }
  } catch (error) {
    console.error("ChatModel streaming error:", error);
    if (onError) {
      onError(error.message, error.details, error.code);
    }
    throw error;
  }
 }

 async getChatModelFiles() {
 return this.chatModelRequest("/api/chat/files");
 }

 async getChatModelHistory(fileId, sessionId = null) {
 let endpoint = `/api/chat/history/${fileId}`;
 if (sessionId) {
   endpoint += `?session_id=${sessionId}`;
 }
 return this.chatModelRequest(endpoint);
 }

 async getChatModelSessions(fileId) {
 return this.chatModelRequest(`/api/chat/sessions/${fileId}`);
 }

 async getGeneralChatHistory(sessionId) {
   return this.chatModelRequest(`/api/chat/general/history/${sessionId}`);
 }

 async getGeneralChatSessions() {
   return this.chatModelRequest('/api/chat/general/sessions');
 }

 async askGeneralChatStream(question, sessionId = null, onChunk, onStatus, onMetadata, onDone, onError, extraFetchParams = null) {
   const token = this.getAuthToken();

   const body = { question };
   if (sessionId) body.session_id = sessionId;
   if (extraFetchParams && typeof extraFetchParams === 'object') {
     if (extraFetchParams.llm_name) body.llm_name = String(extraFetchParams.llm_name);
     const rawMot =
       extraFetchParams.max_output_tokens != null && extraFetchParams.max_output_tokens !== ''
         ? extraFetchParams.max_output_tokens
         : extraFetchParams.maxOutputTokens;
     if (rawMot != null && rawMot !== '') {
       const n = Number(rawMot);
       if (Number.isFinite(n)) body.max_output_tokens = n;
     }
     const rawTemp =
       extraFetchParams.model_temperature != null && extraFetchParams.model_temperature !== ''
         ? extraFetchParams.model_temperature
         : extraFetchParams.temperature;
     if (rawTemp != null && rawTemp !== '') {
       const t = Number(rawTemp);
       if (Number.isFinite(t)) body.model_temperature = t;
     }
   }

   const headers = {
     'Content-Type': 'application/json',
     'Accept': 'text/event-stream',
   };
   if (token) headers['Authorization'] = `Bearer ${token}`;

   console.log('[API] askGeneralChatStream called with params:', {
     session_id: sessionId,
     question_preview: question.substring(0, 80),
     endpoint: `${CHAT_MODEL_BASE_URL}/api/chat/ask/general/stream`,
   });

   try {
     const response = await fetch(`${CHAT_MODEL_BASE_URL}/api/chat/ask/general/stream`, {
       method: 'POST',
       headers,
       body: JSON.stringify(body),
       credentials: 'omit',
     });

     if (!response.ok) {
       const errorData = await response.json().catch(() => ({}));
       const err = new Error(errorData.message || errorData.error || `HTTP error! status: ${response.status}`);
       err.code = errorData.code;
       err.details = errorData.details;
       err.status = response.status;
       throw err;
     }

     const reader = response.body.getReader();
     const decoder = new TextDecoder();
     let buffer = '';
     let streamDone = false;
     let doneDispatched = false;
     let accumulatedAnswer = '';

     while (true) {
       const { done, value } = await reader.read();
       if (done) {
         break;
       }

       buffer += decoder.decode(value, { stream: true });
       const lines = buffer.split(/\r\n|\n|\r/);
       buffer = lines.pop() || '';

       for (const line of lines) {
         if (!line.trim()) continue;
         let data = line.trim();
         if (data.startsWith('data: ')) data = data.substring(6).trim();
         if (data === '[PING]') continue;
         if (data === '[DONE]') { streamDone = true; break; }
         if (!data) continue;

         try {
           const parsed = JSON.parse(data);
           if (parsed.type === 'status' && onStatus) onStatus(parsed.status, parsed.message);
           else if (parsed.type === 'metadata' && onMetadata) onMetadata(parsed);
           else if (parsed.type === 'chunk' && onChunk) {
             const piece = typeof parsed.text === 'string' ? parsed.text : '';
             accumulatedAnswer += piece;
             onChunk(piece);
           } else if (parsed.type === 'done' && onDone) {
             const fromServer = typeof parsed.answer === 'string' ? parsed.answer : '';
             const merged =
               fromServer.length > accumulatedAnswer.length ? fromServer : (accumulatedAnswer || fromServer);
             doneDispatched = true;
             onDone({ ...parsed, answer: merged });
             streamDone = true;
           } else if (parsed.type === 'error' && onError) { onError(parsed.message, parsed.details); streamDone = true; }
         } catch (e) {
           console.warn('[API] Failed to parse SSE data:', data, e);
         }
       }

       if (streamDone) break;
     }

     if (onDone && !doneDispatched) {
       doneDispatched = true;
       onDone({ answer: accumulatedAnswer });
     }
  } catch (error) {
     console.error('[API] General chat streaming error:', error);
     if (onError) onError(error.message, error.details, error.code);
     throw error;
   }
 }

 async getChunkDetails(chunkIds, fileId) {
   if (!chunkIds || chunkIds.length === 0) {
     return [];
   }
   return this.request(`/files/${fileId}/chunks`, {
     method: "POST",
     body: JSON.stringify({ chunk_ids: chunkIds }),
   });
 }

 async getFolderChunkDetails(chunkIds, folderName) {
   if (!chunkIds || chunkIds.length === 0 || !folderName) {
     console.log('[API] getFolderChunkDetails: Missing chunkIds or folderName', { chunkIds, folderName });
     return [];
   }
   console.log('[API] Fetching chunks for folder:', folderName, 'chunk_ids:', chunkIds);
   try {
     const response = await this.request(`/api/files/${folderName}/chunks`, {
       method: "POST",
       body: JSON.stringify({ chunk_ids: chunkIds }),
     });
     console.log('[API] Chunks response:', response);
     const chunks = Array.isArray(response) ? response : (response.chunks || []);
     console.log('[API] Parsed chunks:', chunks.length, 'chunks');
     return chunks;
   } catch (error) {
     console.error('[API] Error fetching folder chunks:', error);
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

