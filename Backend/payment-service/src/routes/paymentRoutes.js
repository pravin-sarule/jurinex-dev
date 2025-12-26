const express = require('express');
const {
  startSubscription,
  verifySubscription,
  testPlans,
  testRazorpayConnection,
  getUserPaymentHistory,
  checkAndDeductTokens,
  checkAndReserveTokensApi,
  commitTokensApi,
  rollbackTokensApi
} = require('../controllers/paymentController');
const { protect } = require('../middleware/auth');
const { checkTokenUsage } = require('../middleware/tokenAuth'); // Import checkTokenUsage
const {getAllPlans} = require('../controllers/userplanController');
const router = express.Router();

router.use((req, res, next) => {
  console.log(`🔔 Payment route accessed: ${req.method} ${req.originalUrl}`);
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  console.log('User from auth (if any):', req.user);
  next();
});

router.route('/plans')
    .get(getAllPlans);

router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: "Payments test route works",
    timestamp: new Date().toISOString(),
    env_check: {
      razorpay_key_configured: !!process.env.RAZORPAY_KEY_ID,
      razorpay_secret_configured: !!process.env.RAZORPAY_SECRET,
      node_env: process.env.NODE_ENV
    }
  });
});

router.get('/ping', (req, res) => {
  res.json({
    success: true,
    message: "✅ Payment route is working",
    razorpay_configured: !!process.env.RAZORPAY_KEY_ID,
    timestamp: new Date().toISOString()
  });
});

router.get('/test-config', protect, testPlans); // DB + Razorpay plan sync check
router.get('/test-razorpay-connection', testRazorpayConnection); // Razorpay API check

router.post('/subscription/start', protect, startSubscription);
router.post('/subscription/verify', protect, verifySubscription);

router.get('/history', protect, getUserPaymentHistory);

router.post('/token-usage', protect, checkTokenUsage, checkAndDeductTokens);

router.post('/token/check-reserve', protect, checkAndReserveTokensApi);
router.post('/token/commit', protect, commitTokensApi);
router.post('/token/rollback', protect, rollbackTokensApi);

module.exports = router;
