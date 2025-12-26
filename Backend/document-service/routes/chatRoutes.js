const express = require('express');
const { protect } = require('../middleware/auth');
const { getAllChats, getUserChats, getChatsBySession } = require('../controllers/chatController');

const router = express.Router();

router.get('/', protect, getUserChats);
router.get('/all', protect, getAllChats); // Assuming this is an admin route or similar
router.get('/session/:sessionId', protect, getChatsBySession);

module.exports = router;

