const express = require('express');
const router = express.Router();
const rbacController = require('./rbacController');
const { protect } = require('../middleware/auth');

router.post('/firm/staff', protect, rbacController.createFirmUser);
router.get('/firm/staff', protect, rbacController.getFirmUsers);
router.patch('/firm/staff/:userId/status', protect, rbacController.updateFirmUserActiveStatus);
router.post('/firm/staff/:userId/resend-password-setup', protect, rbacController.resendFirmUserPasswordSetupEmail);
router.delete('/firm/staff/:userId', protect, rbacController.deleteFirmUser);
router.get('/permissions/me', protect, rbacController.getCurrentUserPermissions);
router.get('/permissions/:userId', protect, rbacController.getUserPermissions);
router.put('/permissions/:userId', protect, rbacController.updateUserPermissions);

module.exports = router;
