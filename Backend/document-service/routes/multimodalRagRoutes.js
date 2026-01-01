const express = require('express');
const router = express.Router();
const { processRAGStream, processRAG } = require('../controllers/multimodalRagController');
const { protect } = require('../middleware/auth');

/**
 * Multimodal RAG Routes
 * POST /api/multimodal-rag/stream - SSE streaming endpoint
 * POST /api/multimodal-rag - Non-streaming endpoint
 */

// SSE Streaming endpoint
router.post('/stream', protect, processRAGStream);

// Non-streaming endpoint
router.post('/', protect, processRAG);

module.exports = router;

