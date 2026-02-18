const express = require('express');
const router = express.Router();
const db = require('../config/db');

/**
 * GET /api/llm-models
 * Returns all rows from llm_models table (id, name, etc.).
 * Used by agent-draft-service to resolve model_ids to model names.
 */
router.get('/llm-models', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name FROM llm_models ORDER BY id ASC`
    );
    const models = result.rows || [];
    console.log('[llm-models] Fetched models from document-service DB:', models.length);
    models.forEach((m) => console.log('[llm-models] Model:', m.id, '->', m.name));
    return res.status(200).json({ success: true, models });
  } catch (err) {
    console.error('[llm-models] Error fetching llm_models:', err.message);
    return res.status(500).json({ success: false, error: err.message, models: [] });
  }
});

module.exports = router;
