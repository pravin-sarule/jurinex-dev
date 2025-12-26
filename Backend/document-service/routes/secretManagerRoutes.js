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

router.get('/secrets', getAllSecrets);

router.get('/secrets/:id', fetchSecretValueFromGCP);

router.post('/create', createSecretInGCP);

router.post('/trigger-llm', protect, triggerSecretLLM);

router.post('/trigger-llm-folder', protect, triggerAskLlmForFolder);

module.exports = router;
