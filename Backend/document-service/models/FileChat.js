// //   if (!Array.isArray(history)) return [];




















//   if (!str) return false;


//   if (!Array.isArray(history)) return [];

      
      









//       if (!fileId || !isValidUUID(fileId)) {




      
      

//       if (!userId) {

//       if (!sessionId || !isValidUUID(sessionId)) {




//       if (!userId || !isValidUUID(sessionId) || !isValidUUID(fileId)) {


      


//       if (!userId) {


      
      

//       if (!userId) {


      
      

//       if (!chatId || !userId) {


      


//       if (!sessionId || !isValidUUID(sessionId) || !userId) {


      


//       if (!userId || !sessionId || !isValidUUID(sessionId)) {



  









const pool = require('../config/db');
const { v4: uuidv4 } = require('uuid');

function isValidUUID(str) {
 if (!str) return false;
 const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 return uuidRegex.test(str);
}

const MAX_HISTORY_LENGTH = 20;

function normalizeHistory(history = []) {
 if (!Array.isArray(history)) return [];
 return history
 .filter(
 (item) =>
 item &&
 typeof item.question === 'string' &&
 typeof item.answer === 'string'
 )
 .map((item) => ({
 id: item.id || null,
 question: item.question,
 answer: item.answer,
 created_at: item.created_at || null,
 }))
 .slice(-MAX_HISTORY_LENGTH);
}

const FileChat = {
 async saveChat(
 fileId,
 userId,
 question,
 answer,
 sessionId = null,
 usedChunkIds = [],
 usedSecretPrompt = false,
 promptLabel = null,
 secretId = null,
 chatHistory = []
 ) {
 try {
 const currentSessionId = isValidUUID(sessionId) ? sessionId : uuidv4();
 
 const normalizedFileId = fileId && isValidUUID(fileId) ? fileId : null;
 
 const normalizedSecretId = secretId && isValidUUID(secretId) ? secretId : null;

 const chunkIdsArray = Array.isArray(usedChunkIds) 
 ? usedChunkIds.filter(id => Number.isInteger(id)) 
 : [];

 const existingHistory = normalizeHistory(chatHistory);

 const res = await pool.query(
 `
 INSERT INTO file_chats
 (file_id, user_id, question, answer, session_id, used_chunk_ids, 
 used_secret_prompt, prompt_label, secret_id, chat_history, chat_type, created_at)
 VALUES
 ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
 RETURNING id, session_id, created_at
 `,
 [
 normalizedFileId,
 userId,
 question,
 answer,
 currentSessionId,
 chunkIdsArray,
 usedSecretPrompt,
 promptLabel,
 normalizedSecretId,
 JSON.stringify(existingHistory),
 'analysis', // chat_type: 'analysis' for document analysis chats
 ]
 );

 const insertedChat = res.rows[0];

 const updatedHistory = [
 ...existingHistory,
 {
 id: insertedChat.id,
 question,
 answer,
 created_at: insertedChat.created_at,
 },
 ].slice(-MAX_HISTORY_LENGTH);

 await pool.query(
 `UPDATE file_chats SET chat_history = $1 WHERE id = $2`,
 [JSON.stringify(updatedHistory), insertedChat.id]
 );

 console.log(
 `✅ [FileChat] Saved chat ID: ${insertedChat.id} | Session: ${currentSessionId} | File: ${normalizedFileId || 'none (pre-upload)'}`
 );

 return { 
 ...insertedChat, 
 chat_history: updatedHistory,
 file_id: normalizedFileId 
 };
 } catch (error) {
 console.error('❌ [FileChat.saveChat] Error:', error);
 throw new Error(`Failed to save chat: ${error.message}`);
 }
 },

 async getChatHistory(fileId, sessionId = null) {
 try {
 if (!fileId || !isValidUUID(fileId)) {
 console.warn('⚠️ [FileChat.getChatHistory] Invalid fileId provided');
 return [];
 }

 let query = `
 SELECT id, file_id, user_id, question, answer, session_id, used_chunk_ids,
 used_secret_prompt, prompt_label, secret_id, chat_history, created_at
 FROM file_chats
 WHERE file_id = $1
 `;
 const params = [fileId];

 if (sessionId && isValidUUID(sessionId)) {
 query += ` AND session_id = $2`;
 params.push(sessionId);
 }

 query += ` ORDER BY created_at ASC`;

 const res = await pool.query(query, params);
 
 console.log(
 `✅ [FileChat.getChatHistory] Retrieved ${res.rows.length} chat(s) for file: ${fileId}${sessionId ? ` in session: ${sessionId}` : ''}`
 );
 
 return res.rows;
 } catch (error) {
 console.error('❌ [FileChat.getChatHistory] Error:', error);
 throw new Error(`Failed to get chat history: ${error.message}`);
 }
 },

 async getChatHistoryBySession(userId, sessionId) {
 try {
 if (!userId) {
 console.warn('⚠️ [FileChat.getChatHistoryBySession] Missing userId');
 return [];
 }

 if (!sessionId || !isValidUUID(sessionId)) {
 console.warn('⚠️ [FileChat.getChatHistoryBySession] Invalid sessionId');
 return [];
 }

 const res = await pool.query(
 `
 SELECT id, file_id, user_id, question, answer, session_id, used_chunk_ids,
 used_secret_prompt, prompt_label, secret_id, chat_history, created_at
 FROM file_chats
 WHERE user_id = $1 AND session_id = $2
 ORDER BY created_at ASC
 `,
 [userId, sessionId]
 );

 console.log(
 `✅ [FileChat.getChatHistoryBySession] Retrieved ${res.rows.length} chat(s) for session: ${sessionId}`
 );

 return res.rows;
 } catch (error) {
 console.error('❌ [FileChat.getChatHistoryBySession] Error:', error);
 throw new Error(`Failed to get chat history by session: ${error.message}`);
 }
 },

 async assignFileIdToSession(userId, sessionId, fileId) {
 try {
 if (!userId || !isValidUUID(sessionId) || !isValidUUID(fileId)) {
 console.warn('⚠️ [FileChat.assignFileIdToSession] Invalid parameters');
 return 0;
 }

 const res = await pool.query(
 `
 UPDATE file_chats
 SET file_id = $3, updated_at = NOW()
 WHERE user_id = $1
 AND session_id = $2
 AND file_id IS NULL
 RETURNING id
 `,
 [userId, sessionId, fileId]
 );

 const updatedCount = res.rowCount || 0;
 
 if (updatedCount > 0) {
 console.log(
 `✅ [FileChat.assignFileIdToSession] Linked ${updatedCount} pre-upload chat(s) to file: ${fileId}`
 );
 }

 return updatedCount;
 } catch (error) {
 console.error('❌ [FileChat.assignFileIdToSession] Error:', error);
 throw new Error(`Failed to assign file to session: ${error.message}`);
 }
 },

 async getChatHistoryByUserId(userId) {
 try {
 if (!userId) {
 console.warn('⚠️ [FileChat.getChatHistoryByUserId] Missing userId');
 return [];
 }

 const query = `
 SELECT id, file_id, user_id, question, answer, session_id, used_chunk_ids,
 used_secret_prompt, prompt_label, secret_id, chat_history, created_at
 FROM file_chats
 WHERE user_id = $1
 ORDER BY created_at ASC
 `;

 const res = await pool.query(query, [userId]);
 
 console.log(
 `✅ [FileChat.getChatHistoryByUserId] Retrieved ${res.rows.length} chat(s) for user: ${userId}`
 );
 
 return res.rows;
 } catch (error) {
 console.error('❌ [FileChat.getChatHistoryByUserId] Error:', error);
 throw new Error(`Failed to get user chat history: ${error.message}`);
 }
 },

 async getUserSessions(userId) {
 try {
 if (!userId) {
 console.warn('⚠️ [FileChat.getUserSessions] Missing userId');
 return [];
 }

 const query = `
 SELECT 
 session_id,
 file_id,
 COUNT(*) as message_count,
 MIN(created_at) as first_message_at,
 MAX(created_at) as last_message_at,
 BOOL_OR(used_secret_prompt) as has_secret_prompts,
 ARRAY_AGG(DISTINCT prompt_label) FILTER (WHERE prompt_label IS NOT NULL) as prompt_labels
 FROM file_chats
 WHERE user_id = $1
 GROUP BY session_id, file_id
 ORDER BY MAX(created_at) DESC
 `;

 const res = await pool.query(query, [userId]);
 
 console.log(
 `✅ [FileChat.getUserSessions] Retrieved ${res.rows.length} session(s) for user: ${userId}`
 );
 
 return res.rows;
 } catch (error) {
 console.error('❌ [FileChat.getUserSessions] Error:', error);
 throw new Error(`Failed to get user sessions: ${error.message}`);
 }
 },

 // if (!chatId || !userId) {


 


 // if (!sessionId || !isValidUUID(sessionId) || !userId) {


 


 async getLastChatInSession(userId, sessionId) {
 try {
 if (!userId || !sessionId || !isValidUUID(sessionId)) {
 console.warn('⚠️ [FileChat.getLastChatInSession] Invalid parameters');
 return null;
 }

 const res = await pool.query(
 `
 SELECT id, file_id, user_id, question, answer, session_id, used_chunk_ids,
 used_secret_prompt, prompt_label, secret_id, chat_history, created_at
 FROM file_chats
 WHERE user_id = $1 AND session_id = $2
 ORDER BY created_at DESC
 LIMIT 1
 `,
 [userId, sessionId]
 );

 if (res.rows.length > 0) {
 console.log(`✅ [FileChat.getLastChatInSession] Found last chat for session: ${sessionId}`);
 return res.rows[0];
 }

 return null;
 } catch (error) {
 console.error('❌ [FileChat.getLastChatInSession] Error:', error);
 throw new Error(`Failed to get last chat in session: ${error.message}`);
 }
 },

async deleteChatById(chatId, userId) {
 try {
 if (!chatId || !userId) {
 console.warn('⚠️ [FileChat.deleteChatById] Missing chatId or userId');
 return false;
 }

 if (!isValidUUID(chatId)) {
 console.warn('⚠️ [FileChat.deleteChatById] Invalid chatId format');
 return false;
 }

 const res = await pool.query(
 `
 DELETE FROM file_chats
 WHERE id = $1 AND user_id = $2
 RETURNING id
 `,
 [chatId, userId]
 );

 const deleted = res.rowCount > 0;
 
 if (deleted) {
 console.log(`✅ [FileChat.deleteChatById] Deleted chat: ${chatId}`);
 } else {
 console.warn(`⚠️ [FileChat.deleteChatById] Chat not found or unauthorized: ${chatId}`);
 }

 return deleted;
 } catch (error) {
 console.error('❌ [FileChat.deleteChatById] Error:', error);
 throw new Error(`Failed to delete chat: ${error.message}`);
 }
},

async deleteSelectedChats(chatIds, userId) {
 try {
 if (!Array.isArray(chatIds) || chatIds.length === 0 || !userId) {
 console.warn('⚠️ [FileChat.deleteSelectedChats] Invalid parameters');
 return { deletedCount: 0, deletedIds: [] };
 }

 const validIds = chatIds.filter(id => isValidUUID(id));
 if (validIds.length === 0) {
 console.warn('⚠️ [FileChat.deleteSelectedChats] No valid UUIDs provided');
 return { deletedCount: 0, deletedIds: [] };
 }

 const placeholders = validIds.map((_, index) => `$${index + 2}`).join(',');
 
 const query = `
 DELETE FROM file_chats 
 WHERE id IN (${placeholders}) AND user_id = $1
 RETURNING id
 `;
 
 const res = await pool.query(query, [userId, ...validIds]);
 const deletedIds = res.rows.map(row => row.id);
 const deletedCount = res.rowCount || 0;

 if (deletedCount > 0) {
 console.log(`✅ [FileChat.deleteSelectedChats] Deleted ${deletedCount} chat(s)`);
 }

 return { deletedCount, deletedIds };
 } catch (error) {
 console.error('❌ [FileChat.deleteSelectedChats] Error:', error);
 throw new Error(`Failed to delete selected chats: ${error.message}`);
 }
},

async deleteAllChatsByUserId(userId) {
 try {
 if (!userId) {
 console.warn('⚠️ [FileChat.deleteAllChatsByUserId] Missing userId');
 return { deletedCount: 0 };
 }

 const res = await pool.query(
 `
 DELETE FROM file_chats 
 WHERE user_id = $1
 RETURNING id
 `,
 [userId]
 );

 const deletedCount = res.rowCount || 0;
 
 if (deletedCount > 0) {
 console.log(`✅ [FileChat.deleteAllChatsByUserId] Deleted ${deletedCount} chat(s) for user: ${userId}`);
 }

 return { deletedCount };
 } catch (error) {
 console.error('❌ [FileChat.deleteAllChatsByUserId] Error:', error);
 throw new Error(`Failed to delete all user chats: ${error.message}`);
 }
},

async deleteChatsBySession(sessionId, userId) {
 try {
 if (!sessionId || !userId || !isValidUUID(sessionId)) {
 console.warn('⚠️ [FileChat.deleteChatsBySession] Invalid parameters');
 return { deletedCount: 0 };
 }

 const res = await pool.query(
 `
 DELETE FROM file_chats
 WHERE session_id = $1 AND user_id = $2
 RETURNING id
 `,
 [sessionId, userId]
 );

 const deletedCount = res.rowCount || 0;
 
 if (deletedCount > 0) {
 console.log(`✅ [FileChat.deleteChatsBySession] Deleted ${deletedCount} chat(s) from session: ${sessionId}`);
 }

 return { deletedCount };
 } catch (error) {
 console.error('❌ [FileChat.deleteChatsBySession] Error:', error);
 throw new Error(`Failed to delete session chats: ${error.message}`);
 }
},

async deleteChatsByFileId(fileId, userId) {
 try {
 if (!fileId || !userId || !isValidUUID(fileId)) {
 console.warn('⚠️ [FileChat.deleteChatsByFileId] Invalid parameters');
 return { deletedCount: 0 };
 }

 const res = await pool.query(
 `
 DELETE FROM file_chats
 WHERE file_id = $1 AND user_id = $2
 RETURNING id
 `,
 [fileId, userId]
 );

 const deletedCount = res.rowCount || 0;
 
 if (deletedCount > 0) {
 console.log(`✅ [FileChat.deleteChatsByFileId] Deleted ${deletedCount} chat(s) for file: ${fileId}`);
 }

 return { deletedCount };
 } catch (error) {
 console.error('❌ [FileChat.deleteChatsByFileId] Error:', error);
 throw new Error(`Failed to delete file chats: ${error.message}`);
 }
},

async getChatStatistics(userId) {
 try {
 if (!userId) {
 console.warn('⚠️ [FileChat.getChatStatistics] Missing userId');
 return null;
 }

 const res = await pool.query(
 `
 SELECT 
 COUNT(*) as total_chats,
 COUNT(DISTINCT session_id) as total_sessions,
 COUNT(DISTINCT file_id) FILTER (WHERE file_id IS NOT NULL) as files_with_chats,
 COUNT(*) FILTER (WHERE file_id IS NULL) as pre_upload_chats,
 MIN(created_at) as first_chat_date,
 MAX(created_at) as last_chat_date
 FROM file_chats
 WHERE user_id = $1
 `,
 [userId]
 );

 const stats = res.rows[0];
 
 console.log(`✅ [FileChat.getChatStatistics] Retrieved statistics for user: ${userId}`);
 
 return {
 totalChats: parseInt(stats.total_chats) || 0,
 totalSessions: parseInt(stats.total_sessions) || 0,
 filesWithChats: parseInt(stats.files_with_chats) || 0,
 preUploadChats: parseInt(stats.pre_upload_chats) || 0,
 firstChatDate: stats.first_chat_date,
 lastChatDate: stats.last_chat_date
 };
 } catch (error) {
 console.error('❌ [FileChat.getChatStatistics] Error:', error);
 throw new Error(`Failed to get chat statistics: ${error.message}`);
 }
},

async getDeletePreview(userId, filters = {}) {
 try {
 if (!userId) {
 console.warn('⚠️ [FileChat.getDeletePreview] Missing userId');
 return [];
 }

 let query = `
 SELECT id, question, answer, session_id, file_id, created_at,
 used_secret_prompt, prompt_label
 FROM file_chats
 WHERE user_id = $1
 `;
 const params = [userId];
 let paramIndex = 2;

 if (filters.sessionId && isValidUUID(filters.sessionId)) {
 query += ` AND session_id = $${paramIndex}`;
 params.push(filters.sessionId);
 paramIndex++;
 }

 if (filters.fileId && isValidUUID(filters.fileId)) {
 query += ` AND file_id = $${paramIndex}`;
 params.push(filters.fileId);
 paramIndex++;
 }

 if (filters.chatIds && Array.isArray(filters.chatIds) && filters.chatIds.length > 0) {
 const validIds = filters.chatIds.filter(id => isValidUUID(id));
 if (validIds.length > 0) {
 const placeholders = validIds.map((_, index) => `$${paramIndex + index}`).join(',');
 query += ` AND id IN (${placeholders})`;
 params.push(...validIds);
 }
 }

 query += ` ORDER BY created_at DESC LIMIT 100`; // Limit for performance

 const res = await pool.query(query, params);
 
 console.log(`✅ [FileChat.getDeletePreview] Retrieved ${res.rows.length} preview items`);
 
 return res.rows.map(row => ({
 id: row.id,
 question: row.question.substring(0, 100) + (row.question.length > 100 ? '...' : ''),
 answer: row.answer.substring(0, 100) + (row.answer.length > 100 ? '...' : ''),
 sessionId: row.session_id,
 fileId: row.file_id,
 createdAt: row.created_at,
 usedSecretPrompt: row.used_secret_prompt,
 promptLabel: row.prompt_label
 }));
 } catch (error) {
 console.error('❌ [FileChat.getDeletePreview] Error:', error);
 throw new Error(`Failed to get delete preview: ${error.message}`);
 }
}
 
};

module.exports = FileChat;