


const pool = require('../config/db');
const { v4: uuidv4 } = require('uuid');

function isValidUUID(str) {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

const FolderChat = {
  // Save a folder chat entry
  async saveFolderChat(
    userId,
    folderName,
    question,
    answer,
    sessionId = null,
    summarizedFileIds = [],
    usedChunkIds = [],
    usedSecretPrompt = false,
    promptLabel = null,
    secretId = null,
    chatHistory = [],
    citations = [] // ✅ NEW: Store citations permanently
  ) {
    const id = uuidv4();
    const currentSessionId = isValidUUID(sessionId) ? sessionId : uuidv4();

    // ✅ Convert chunk IDs to numbers (BIGINT-compatible)
    const numericChunkIds = usedChunkIds.map(id => Number(id)).filter(Boolean);
    const existingHistory = normalizeHistory(chatHistory);
    
    // ✅ Ensure citations is a valid array and normalize it
    const normalizedCitations = Array.isArray(citations) ? citations : [];
    // Remove any null/undefined citations and ensure they have required fields
    const validCitations = normalizedCitations.filter(c => c && (c.fileId || c.page || c.filename));

    const res = await pool.query(
      `
      INSERT INTO folder_chats
        (id, user_id, folder_name, question, answer, summarized_file_ids, used_chunk_ids, session_id,
         used_secret_prompt, prompt_label, secret_id, chat_history, citations, created_at)
      VALUES
        ($1::uuid, $2, $3, $4, $5, $6::uuid[], $7::bigint[], $8::uuid, $9, $10, $11::uuid, $12::jsonb, $13::jsonb, NOW())
      RETURNING id, session_id, created_at
      `,
      [
        id,
        userId,
        folderName,
        question,
        answer,
        summarizedFileIds,
        numericChunkIds, // ✅ now numeric array
        currentSessionId,
        usedSecretPrompt,
        promptLabel,
        secretId,
        JSON.stringify(existingHistory),
        JSON.stringify(validCitations), // ✅ Store citations as JSONB
      ]
    );

    const insertedChat = res.rows[0];
    const updatedHistory = [...existingHistory, {
      id: insertedChat.id,
      question,
      answer,
      created_at: insertedChat.created_at,
    }].slice(-MAX_HISTORY_LENGTH);

    await pool.query(
      `UPDATE folder_chats SET chat_history = $1::jsonb WHERE id = $2`,
      [JSON.stringify(updatedHistory), insertedChat.id]
    );

    return { ...insertedChat, chat_history: updatedHistory };
  },

  async getFolderChatHistory(userId, folderName, sessionId = null) {
    let query = `
      SELECT id, user_id, folder_name, question, answer, session_id, summarized_file_ids, used_chunk_ids,
             used_secret_prompt, prompt_label, secret_id, chat_history, citations, created_at
      FROM folder_chats
      WHERE user_id = $1 AND folder_name = $2
    `;
    const params = [userId, folderName];

    if (sessionId && isValidUUID(sessionId)) {
      query += ` AND session_id = $3::uuid`;
      params.push(sessionId);
    }

    query += ` ORDER BY created_at ASC`;

    const res = await pool.query(query, params);
    return res.rows;
  },

  async getFolderChatHistoryByUserId(userId) {
    const query = `
      SELECT id, user_id, folder_name, question, answer, session_id, summarized_file_ids, used_chunk_ids,
             used_secret_prompt, prompt_label, secret_id, chat_history, citations, created_at
      FROM folder_chats
      WHERE user_id = $1
      ORDER BY created_at ASC
    `;

    const res = await pool.query(query, [userId]);
    return res.rows;
  },

  async findAll(options = {}) {
    let query = `
      SELECT id, user_id, folder_name, question, answer, session_id, summarized_file_ids, used_chunk_ids,
             used_secret_prompt, prompt_label, secret_id, chat_history, citations, created_at
      FROM folder_chats
    `;
    const params = [];
    const whereClauses = [];
    let paramIndex = 1;

    if (options.where) {
      if (options.where.user_id) {
        whereClauses.push(`user_id = $${paramIndex++}`);
        params.push(options.where.user_id);
      }
      if (options.where.folder_name) {
        whereClauses.push(`folder_name = $${paramIndex++}`);
        params.push(options.where.folder_name);
      }
      if (options.where.session_id) {
        whereClauses.push(`session_id = $${paramIndex++}::uuid`);
        params.push(options.where.session_id);
      }
    }

    if (whereClauses.length > 0) {
      query += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    if (options.order && Array.isArray(options.order) && options.order.length > 0) {
      const orderByClauses = options.order.map(o => {
        const [field, direction] = o;
        return `${field} ${direction.toUpperCase()}`;
      });
      query += ` ORDER BY ${orderByClauses.join(', ')}`;
    } else {
      query += ` ORDER BY created_at ASC`;
    }

    const res = await pool.query(query, params);
    return res.rows;
  },

  // Delete folder chat records (matching Sequelize destroy pattern)
  async destroy(options = {}) {
    let query = `DELETE FROM folder_chats`;
    const params = [];
    const whereClauses = [];
    let paramIndex = 1;

    if (options.where) {
      if (options.where.user_id) {
        whereClauses.push(`user_id = $${paramIndex++}`);
        params.push(options.where.user_id);
      }
      if (options.where.folder_name) {
        whereClauses.push(`folder_name = $${paramIndex++}`);
        params.push(options.where.folder_name);
      }
      if (options.where.session_id) {
        whereClauses.push(`session_id = $${paramIndex++}::uuid`);
        params.push(options.where.session_id);
      }
      if (options.where.id) {
        whereClauses.push(`id = $${paramIndex++}::uuid`);
        params.push(options.where.id);
      }
    }

    if (whereClauses.length === 0) {
      throw new Error('Cannot delete without WHERE conditions for safety');
    }

    query += ` WHERE ${whereClauses.join(' AND ')}`;
    query += ` RETURNING id`;

    const res = await pool.query(query, params);
    return res.rowCount || 0; // Return count of deleted rows
  },
};

module.exports = FolderChat;
