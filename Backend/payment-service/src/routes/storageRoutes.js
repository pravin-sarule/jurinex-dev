const express    = require('express');
const router     = express.Router();
const { protect } = require('../middleware/auth');
const ctrl       = require('../controllers/storageController');

// User: authenticated storage breakdown
router.get('/usage',        protect, ctrl.getUserStorageUsage);

// Admin: all-users storage summary
router.get('/admin/users',  protect, ctrl.getAdminStorageUsage);

// Internal: incremental adjust (no JWT — restricted to internal callers)
router.post('/internal/adjust', ctrl.adjustStorageUsage);

module.exports = router;
