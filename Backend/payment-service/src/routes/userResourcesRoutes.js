const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const userResourceController = require('../controllers/userResourcesController');
const llmUsageController = require('../controllers/llmUsageController');

console.log("DEBUG: userResourceController exports:", Object.keys(userResourceController));

router.get('/transactions', protect, userResourceController.getUserTransactions);
router.get('/plan-details', protect, userResourceController.getPlanAndResourceDetails);
router.get('/user-plan/:userId', protect, userResourceController.getUserPlanById); // New route for fetching a user's plan by ID
router.get('/llm-usage', protect, llmUsageController.getLLMUsage);

const tokenUsageController = require('../controllers/tokenUsageController');
router.get('/token-usage', protect, tokenUsageController.getTokenUsage);

const llmUsageLogController = require('../controllers/llmUsageLogController');
router.post('/llm-usage-log', llmUsageLogController.createLLMUsageLog); // No auth - will be called internally by document service

module.exports = router;