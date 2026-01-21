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
    fileIds,
    question,
    answer,
    sessionId = null,
    usedChunkIds = [],
    chatHistory = []
  ) {
    try {
      const currentSessionId = isValidUUID(sessionId) ? sessionId : uuidv4();
      
      const normalizedFileIds = Array.isArray(fileIds) 
        ? fileIds.filter(id => isValidUUID(id))
        : (fileIds && isValidUUID(fileIds) ? [fileIds] : []);

      const chunkIdsArray = Array.isArray(usedChunkIds) 
        ? usedChunkIds.filter(id => isValidUUID(id))
        : [];

      const existingHistory = normalizeHistory(chatHistory);

      const res = await pool.query(
        `
        INSERT INTO agent_file_chats
        (file_ids, question, answer, session_id, used_chunk_ids, chat_history, created_at, last_activity)
        VALUES
        ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        RETURNING id, session_id, (created_at AT TIME ZONE 'UTC')::text as created_at
        `,
        [
          normalizedFileIds,
          question,
          answer,
          currentSessionId,
          chunkIdsArray,
          JSON.stringify(existingHistory),
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
        `UPDATE agent_file_chats SET chat_history = $1 WHERE id = $2`,
        [JSON.stringify(updatedHistory), insertedChat.id]
      );

      console.log(
        `✅ [FileChat] Saved chat ID: ${insertedChat.id} | Session: ${currentSessionId} | Files: ${normalizedFileIds.length}`
      );

      return { 
        ...insertedChat, 
        chat_history: updatedHistory,
        file_ids: normalizedFileIds 
      };
    } catch (error) {
      console.error('❌ [FileChat.saveChat] Error:', error);
      throw new Error(`Failed to save chat: ${error.message}`);
    }
  },

  async getChatHistory(sessionId = null, fileIds = null) {
    try {
      let query = `
        SELECT id, file_ids, question, answer, session_id, used_chunk_ids,
        chat_history, 
        (created_at AT TIME ZONE 'UTC')::text as created_at
        FROM agent_file_chats
        WHERE 1=1
      `;
      const params = [];
      let paramIndex = 1;

      if (sessionId && isValidUUID(sessionId)) {
        query += ` AND session_id = $${paramIndex}`;
        params.push(sessionId);
        paramIndex++;
      }

      if (fileIds && Array.isArray(fileIds) && fileIds.length > 0) {
        const validIds = fileIds.filter(id => isValidUUID(id));
        if (validIds.length > 0) {
          query += ` AND file_ids && $${paramIndex}::uuid[]`;
          params.push(validIds);
        }
      }

      query += ` ORDER BY created_at ASC`;

      const res = await pool.query(query, params);
      
      console.log(
        `✅ [FileChat.getChatHistory] Retrieved ${res.rows.length} chat(s)`
      );
      
      return res.rows;
    } catch (error) {
      console.error('❌ [FileChat.getChatHistory] Error:', error);
      throw new Error(`Failed to get chat history: ${error.message}`);
    }
  },

  async deleteChatsByFileId(fileId) {
    try {
      const res = await pool.query(`
        DELETE FROM agent_file_chats
        WHERE $1::uuid = ANY(file_ids)
        RETURNING id
      `, [fileId]);
      return res.rows.length;
    } catch (error) {
      console.error('❌ [FileChat.deleteChatsByFileId] Error:', error);
      throw new Error(`Failed to delete chats: ${error.message}`);
    }
  }
};

module.exports = FileChat;
