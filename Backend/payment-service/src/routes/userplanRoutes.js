const express = require('express');
const router = express.Router();

// Import the controller function for users
const {
    getAllPlans,
} = require('../controllers/userplanController');



module.exports = router;
