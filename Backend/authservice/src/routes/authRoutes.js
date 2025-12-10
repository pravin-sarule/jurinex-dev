

const express = require('express');
const router = express.Router();
// const auth = require('../middleware/auth'); // Import auth middleware
const { protect } = require('../middleware/auth');

const { register, login, verifyOtpAndLogin, updateProfile, deleteAccount, logout, fetchProfile, getUserById, updateRazorpayCustomerId , firebaseGoogleSignIn, getUserInfo, getProfessionalProfile, updateProfessionalProfile, changePassword } = require('../controllers/authController');

// Register a new user
router.post('/register', register);

// Login with email & password
router.post('/login', login);

// Verify OTP and complete login
router.post('/verify-otp', verifyOtpAndLogin);



// Update user profile
router.put('/update', protect, updateProfile);

// Delete user account
router.delete('/delete', protect, deleteAccount);

// Logout user
router.post('/logout', protect, logout);

// Fetch user profile
router.get('/profile', protect, fetchProfile);

// Fetch user info (fullname, email, mobile)
router.get('/user-info', protect, getUserInfo);

// Professional Profile routes
router.get('/professional-profile', protect, getProfessionalProfile);
router.put('/professional-profile', protect, updateProfessionalProfile);

// Fetch user by ID
router.get('/users/:userId', protect, getUserById);

// Update Razorpay customer ID
router.put('/users/:id/razorpay-customer-id', protect, updateRazorpayCustomerId);

router.post('/google', firebaseGoogleSignIn);


router.put('/change-password', protect, changePassword); 

module.exports = router;
