const express = require('express');
const router = express.Router();
const { protect, softProtect } = require('../middleware/auth');

const { register, registerSoloLawyer, registerFirm, login, verifyOtpAndLogin, updateProfile, deleteAccount, logout, fetchProfile, getUserById, updateRazorpayCustomerId , firebaseGoogleSignIn, getUserInfo, getProfessionalProfile, updateProfessionalProfile, changePassword, setPassword, getAllActiveUsers, getAllUsers, createFirmStaff, getFirmStaff, getFirmInfo, pingActivity } = require('../controllers/authController');
const googleDriveRoutes = require('./googleDriveRoutes');

// Registration routes
router.post('/register', register); // Legacy endpoint
router.post('/register/solo', registerSoloLawyer);
router.post('/register/firm', registerFirm);

router.post('/login', login);

router.post('/verify-otp', verifyOtpAndLogin);



router.put('/update', protect, updateProfile);

router.delete('/delete', protect, deleteAccount);

router.post('/logout', protect, logout);

router.get('/profile', protect, fetchProfile);

router.get('/user-info', protect, getUserInfo);

router.get('/professional-profile', protect, getProfessionalProfile);
router.put('/professional-profile', protect, updateProfessionalProfile);

router.get('/users', protect, getAllUsers);
router.get('/users/active', protect, getAllActiveUsers);
router.get('/users/:userId', protect, getUserById);

router.put('/users/:id/razorpay-customer-id', protect, updateRazorpayCustomerId);

router.post('/google', firebaseGoogleSignIn);


router.put('/change-password', protect, changePassword);
router.post('/set-password', setPassword); // Public endpoint for first-time password setup
router.post('/activity/ping', softProtect, pingActivity);

// Firm admin routes
router.post('/firm/staff', protect, createFirmStaff);
router.get('/firm/staff', protect, getFirmStaff);
router.get('/firm/info', protect, getFirmInfo);

// Google Drive OAuth routes
router.use('/', googleDriveRoutes);

// Public: list all professional roles for registration dropdowns
router.get('/roles', async (req, res) => {
  try {
    const pool = require('../config/db');
    const result = await pool.query('SELECT id, name FROM roles ORDER BY name ASC');
    res.json({ roles: result.rows });
  } catch (error) {
    console.error('[AuthRoutes] Error fetching roles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
