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

      console.log(`💾 [FileChat.saveChat] Preparing to insert chat into database...`);
      console.log(`   - File ID: ${normalizedFileId || 'null (pre-upload)'}`);
      console.log(`   - User ID: ${userId}`);
      console.log(`   - Session ID: ${currentSessionId}`);
      console.log(`   - Question: ${question.substring(0, 100)}${question.length > 100 ? '...' : ''}`);
      console.log(`   - Answer length: ${answer.length} chars`);
      console.log(`   - Used chunk IDs: ${chunkIdsArray.length} chunks`);
      console.log(`   - History items: ${existingHistory.length}`);

      const res = await pool.query(
        `
        INSERT INTO file_chats
          (file_id, user_id, question, answer, session_id, used_chunk_ids, 
           used_secret_prompt, prompt_label, secret_id, chat_history, created_at)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
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
        ]
      );

      console.log(`✅ [FileChat.saveChat] INSERT query successful, got ${res.rows.length} row(s)`);

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
      console.error('❌ [FileChat.saveChat] Database error occurred:');
      console.error(`   Error message: ${error.message}`);
      console.error(`   Error code: ${error.code || 'N/A'}`);
      console.error(`   Error detail: ${error.detail || 'N/A'}`);
      console.error(`   Error hint: ${error.hint || 'N/A'}`);
      console.error(`   Stack trace:`, error.stack);
      console.error(`   Parameters attempted:`);
      console.error(`     - file_id: ${fileId} (normalized: ${fileId && isValidUUID(fileId) ? fileId : null})`);
      console.error(`     - user_id: ${userId}`);
      console.error(`     - session_id: ${sessionId} (normalized: ${isValidUUID(sessionId) ? sessionId : 'new UUID'})`);
      console.error(`     - question length: ${question ? question.length : 0}`);
      console.error(`     - answer length: ${answer ? answer.length : 0}`);
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
};

module.exports = FileChat;

