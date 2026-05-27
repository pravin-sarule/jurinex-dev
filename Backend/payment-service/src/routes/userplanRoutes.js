const express = require('express');
const router = express.Router();

const {
    getAllPlans,
    assignFreePlan,
} = require('../controllers/userplanController');

// Internal — called by auth service after user registration (no auth middleware needed)
router.post('/internal/assign-free-plan', assignFreePlan);

module.exports = router;
