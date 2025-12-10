const express = require('express');
const router = express.Router();
const { handleWebhook } = require('../controllers/paymentController');

// IMPORTANT: keep raw parser here, before any express.json()
router.post('/razorpay', express.raw({ type: 'application/json' }), handleWebhook);

module.exports = router;
