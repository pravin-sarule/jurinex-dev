const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const userResourceController = require('../controllers/userResourcesController');
const llmUsageController = require('../controllers/llmUsageController');
const firmAnalyticsController = require('../controllers/firmAnalyticsController');

console.log("DEBUG: userResourceController exports:", Object.keys(userResourceController));

router.get('/transactions', protect, userResourceController.getUserTransactions);
router.get('/plan-details', protect, userResourceController.getPlanAndResourceDetails);
router.get('/user-plan/:userId', protect, userResourceController.getUserPlanById); // New route for fetching a user's plan by ID
router.get('/llm-usage', protect, llmUsageController.getLLMUsage);
router.get('/firm-analytics/summary', protect, firmAnalyticsController.getFirmAnalyticsSummary);
router.get('/firm-analytics/users', protect, firmAnalyticsController.getFirmAnalyticsUsers);
router.get('/firm-analytics/users/:userId', protect, firmAnalyticsController.getFirmAnalyticsUserDetail);
router.put('/firm-analytics/users/:userId/token-limit', protect, firmAnalyticsController.updateFirmUserTokenLimit);

const tokenUsageController = require('../controllers/tokenUsageController');
router.get('/token-usage', protect, tokenUsageController.getTokenUsage);
const tokenCheckController = require('../controllers/tokenCheckController');
router.post('/internal/firm-token-caps/check', firmAnalyticsController.checkFirmUserTokenLimit);
router.post('/internal/token-check', tokenCheckController.internalTokenCheck);

const llmUsageLogController = require('../controllers/llmUsageLogController');
router.post('/llm-usage-log', llmUsageLogController.createLLMUsageLog); // No auth - will be called internally by document service

// On-demand billing period renewal — renews the caller's subscription if the end_date
// has already passed in IST but the midnight cron hasn't run yet (server restart, etc.)
router.post('/renew-billing-period', protect, async (req, res) => {
  const { runDailyMidnightIST } = require('../services/cronService');
  try {
    await runDailyMidnightIST();
    res.json({ success: true, message: 'Billing period renewal check completed.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
