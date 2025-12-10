// controllers/chatController.js
const pool = require('../config/db'); // your PostgreSQL connection

// Fetch all chats
const getAllChats = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, user_id, question, answer, used_chunk_ids, created_at, session_id, file_id, used_secret_prompt, prompt_label, chat_history
       FROM file_chats
       ORDER BY created_at ASC`
    );

    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error fetching all chats:', err);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
};
const getUserChats = async (req, res) => {
  try {
    // Assuming you set req.user when verifying JWT
    const userId = req.user.id;  

    const result = await pool.query(
      `SELECT id, user_id, question, answer, used_chunk_ids, created_at, session_id, file_id, used_secret_prompt, prompt_label, chat_history
       FROM file_chats
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [userId]
    );

    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error fetching user chats:', err);
    res.status(500).json({ error: 'Failed to fetch user chats' });
  }
};

// Fetch chats by session ID
const getChatsBySession = async (req, res) => {
  const { sessionId } = req.params;
  try {
    console.log(`Fetching chats for session ID: ${sessionId}`);
    const result = await pool.query(
      `SELECT id, user_id, question, answer, used_chunk_ids, created_at, session_id, file_id, used_secret_prompt, prompt_label, chat_history
       FROM file_chats
       WHERE session_id = $1
       ORDER BY created_at ASC`,
      [sessionId]
    );

    console.log(`Found ${result.rows.length} chats for session ID: ${sessionId}`);
    if (result.rows.length === 0) {
      console.log(`No chat history found for session ID: ${sessionId}`);
      return res.status(404).json({ message: 'No chat history found for this session.' });
    }

    res.status(200).json(result.rows);
  } catch (err) {
    console.error(`Error fetching chats for session ${sessionId}:`, err);
    res.status(500).json({ error: 'Failed to fetch chats for session' });
  }
};

module.exports = {
  getAllChats,
  getUserChats,
  getChatsBySession,
};
