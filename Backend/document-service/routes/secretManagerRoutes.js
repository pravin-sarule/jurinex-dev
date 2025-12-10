
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');

const {
  getAllSecrets,
  fetchSecretValueFromGCP,
  createSecretInGCP,
  triggerSecretLLM,
  triggerAskLlmForFolder // Add the new function for folders
} = require('../controllers/secretManagerController');

// 🔍 GET /api/secrets → list all secrets (use ?fetch=true to include secret values)
router.get('/secrets', getAllSecrets);

// 🔐 GET /api/secrets/:id → fetch secret value from GCP using internal UUID
router.get('/secrets/:id', fetchSecretValueFromGCP);

// 📥 POST /api/secrets/create → add new secret to GCP + DB
router.post('/create', createSecretInGCP);

// 🧠 POST /api/secrets/trigger-llm → trigger LLM with secret content
router.post('/trigger-llm', protect, triggerSecretLLM);

// 🧠 POST /api/secrets/trigger-llm-folder → trigger LLM with secret content for a folder
router.post('/trigger-llm-folder', protect, triggerAskLlmForFolder);

module.exports = router;
