//     if (!user) {


//     if (!user.password || typeof user.password !== 'string' || user.password.trim() === '') {
//     if (!isMatch) {





//     if (!isOTPValid) {

//     if (!user) {





//     if (!user) {

//       if (existingUser && existingUser.id !== userId) {




//     if (!user) {






//     if (!user) {



//     if (!user) {



//     if (!user) {







//     if (!idToken) {


//     if (!email) {


//     if (!user) {












const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Session = require('../models/Session');
const UserProfessionalProfile = require('../models/UserProfessionalProfile');
const { generateToken } = require('../utils/jwt');
const { createAndSendOTP, verifyOTP } = require('../services/otpService');
const admin = require('../config/firebase'); // Import Firebase Admin SDK
const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const register = async (req, res) => {
  const { username, email, password } = req.body;

  try {
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      username,
      email,
      password: hashedPassword,
      auth_type: 'manual',
    });

    const token = generateToken(user);

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        is_blocked: user.is_blocked,
      },
    });
  } catch (error) {
    console.error('Error during registration:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const login = async (req, res) => {
  const { email, password } = req.body;
  console.log(`[AuthController] Attempting manual login for email: ${email}`);

  try {
    const user = await User.findByEmail(email);
    if (!user) {
      console.log(`[AuthController] User not found for email: ${email}`);
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    console.log(`[AuthController] User found: ${user.email}`);

    if (user.is_blocked === true) {
      return res.status(403).json({ message: 'You are blocked for policy violations.' });
    }

    if (!user.password || typeof user.password !== 'string' || user.password.trim() === '') {
      console.log(`[AuthController] User ${user.email} has no password (likely Google sign-in user).`);
      return res.status(400).json({ 
        message: 'This account was created using Google Sign-In. Please use "Sign in with Google" button.' 
      });
    }

    console.log(`[AuthController] Comparing password for user: ${user.email}`);
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log(`[AuthController] Password mismatch for user: ${user.email}`);
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    console.log(`[AuthController] ✅ Password matched for user: ${user.email}`);

    await createAndSendOTP(user.email);
    console.log(`[AuthController] ✅ OTP sent to: ${user.email}`);

    res.status(200).json({
      requiresOtp: true,  // ⚠️ CRITICAL: This flag tells frontend to switch to OTP screen
      success: true,
      message: 'OTP sent to your email. Please verify to complete login.',
      email: user.email,
    });
  } catch (error) {
    console.error('[AuthController] ❌ Error during manual login:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const verifyOtpAndLogin = async (req, res) => {
  const { email, otp } = req.body;
  console.log(`[AuthController] Attempting OTP verification for email: ${email}`);

  try {
    const isOTPValid = await verifyOTP(email, otp);

    if (!isOTPValid) {
      console.log(`[AuthController] ❌ Invalid or expired OTP for: ${email}`);
      return res.status(400).json({ 
        success: false,
        message: 'Invalid or expired OTP. Please try again.' 
      });
    }
    console.log(`[AuthController] ✅ OTP verified successfully for: ${email}`);

    const user = await User.findByEmail(email);
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found after OTP verification.' 
      });
    }

    const token = generateToken(user);

    await Session.create({ user_id: user.id, token });
    console.log(`[AuthController] ✅ Session created for user: ${email}`);

    let professionalProfile;
    try {
      professionalProfile = await UserProfessionalProfile.findOrCreate(user.id);
      console.log(`[AuthController] ✅ Professional profile checked/created for user: ${email}`);
    } catch (profileError) {
      console.error('[AuthController] ⚠️ Error checking/creating professional profile:', profileError);
    }

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        is_blocked: user.is_blocked,
      },
      professionalProfile: professionalProfile ? {
        is_profile_completed: professionalProfile.is_profile_completed
      } : null,
    });

  } catch (error) {
    console.error('[AuthController] ❌ Error during OTP verification and login:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error' 
    });
  }
};

const firebaseGoogleSignIn = async (req, res) => {
  const { idToken, email, displayName, photoURL, uid } = req.body;
  console.log(`[GoogleSignIn] Attempting Google Sign-In for email: ${email}`);

  try {
    if (!idToken) {
      return res.status(400).json({ message: "Firebase ID token is required" });
    }

    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken);
      console.log(`[GoogleSignIn] ✅ Firebase token verified for: ${decodedToken.email}`);
    } catch (verifyError) {
      console.error('[GoogleSignIn] ❌ Firebase token verification failed:', verifyError);
      return res.status(401).json({ 
        message: 'Invalid or expired Firebase token. Please try signing in again.' 
      });
    }

    const { 
      uid: firebase_uid, 
      email: tokenEmail, 
      name, 
      picture 
    } = decodedToken;

    const userEmail = tokenEmail || email;

    if (!userEmail) {
      return res.status(400).json({ message: "Email not found in Firebase token" });
    }

    let user = await User.findByEmail(userEmail);

    if (!user) {
      const username = name || displayName || userEmail.split("@")[0];

      user = await User.create({
        username,
        email: userEmail,
        password: null, // Google users don't have passwords
        firebase_uid: firebase_uid || uid,
        auth_type: "google",
        profile_image: picture || photoURL || null,
      });

      console.log(`[GoogleSignIn] ✅ New Google user created: ${userEmail}`);
    } else {
      console.log(`[GoogleSignIn] ✅ Existing user found: ${userEmail}`);
      
      if (!user.firebase_uid && (firebase_uid || uid)) {
        await User.update(user.id, { firebase_uid: firebase_uid || uid });
      }
    }

    if (user.is_blocked) {
      return res.status(403).json({ 
        message: "Your account is blocked. Please contact support." 
      });
    }

    const jwtToken = generateToken(user);

    await Session.create({ user_id: user.id, token: jwtToken });
    console.log(`[GoogleSignIn] ✅ Session created for: ${userEmail}`);

    let professionalProfile;
    try {
      professionalProfile = await UserProfessionalProfile.findOrCreate(user.id);
      console.log(`[GoogleSignIn] ✅ Professional profile checked/created for user: ${userEmail}`);
    } catch (profileError) {
      console.error('[GoogleSignIn] ⚠️ Error checking/creating professional profile:', profileError);
    }

    res.status(200).json({
      message: "Google Sign-In successful",
      token: jwtToken,  // ⚠️ CRITICAL: Token returned immediately (no OTP required)
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        is_blocked: user.is_blocked,
        profile_image: user.profile_image,
      },
      professionalProfile: professionalProfile ? {
        is_profile_completed: professionalProfile.is_profile_completed
      } : null,
    });
  } catch (error) {
    console.error("[GoogleSignIn] ❌ Error during Google Sign-In:", error);
    res.status(500).json({ 
      message: "Internal server error during Google Sign-In" 
    });
  }
};

const updateProfile = async (req, res) => {
  const { fullname, email, password, phone, location } = req.body;
  const userId = req.user.id;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const updateFields = {};
    if (fullname) updateFields.username = fullname;
    if (email) {
      const existingUser = await User.findByEmail(email);
      if (existingUser && existingUser.id !== userId) {
        return res.status(400).json({ message: 'Email already in use' });
      }
      updateFields.email = email;
    }
    if (password) {
      updateFields.password = await bcrypt.hash(password, 10);
    }
    if (phone) updateFields.phone = phone;
    if (location) updateFields.location = location;

    const updatedUser = await User.update(userId, updateFields);

    res.status(200).json({ 
      message: 'Profile updated successfully', 
      user: { 
        id: updatedUser.id, 
        username: updatedUser.username, 
        email: updatedUser.email, 
        role: updatedUser.role, 
        is_blocked: updatedUser.is_blocked, 
        phone: updatedUser.phone, 
        location: updatedUser.location 
      } 
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const deleteAccount = async (req, res) => {
  const userId = req.user.id;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    await user.delete();

    res.status(200).json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Error deleting account:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const logout = async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];

  try {
    if (token) {
      await Session.deleteByToken(token);
    }
    res.status(200).json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Error during logout:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const fetchProfile = async (req, res) => {
  const userId = req.user.id;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({
      message: 'User profile fetched successfully',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        is_blocked: user.is_blocked,
        phone: user.phone,
        location: user.location,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const getUserById = async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({
      message: 'User fetched successfully',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        is_blocked: user.is_blocked,
        phone: user.phone,
        location: user.location,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
    });
  } catch (error) {
    console.error('Error fetching user by ID:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const updateRazorpayCustomerId = async (req, res) => {
  const { id } = req.params;
  const { razorpay_customer_id } = req.body;

  try {
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const updatedUser = await User.update(id, { razorpay_customer_id });

    res.status(200).json({
      message: 'Razorpay customer ID updated successfully',
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        email: updatedUser.email,
        role: updatedUser.role,
        is_blocked: updatedUser.is_blocked,
        phone: updatedUser.phone,
        location: updatedUser.location,
        razorpay_customer_id: updatedUser.razorpay_customer_id,
      },
    });
  } catch (error) {
    console.error('Error updating Razorpay customer ID:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const getUserInfo = async (req, res) => {
  const userId = req.user.id;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({
      type: 'final',
      message: 'User information fetched successfully',
      data: {
        fullname: user.username || null,
        email: user.email || null,
        mobile: user.phone || null,
      },
    });
  } catch (error) {
    console.error('Error fetching user info:', error);
    res.status(500).json({ 
      type: 'status',
      message: 'Internal server error' 
    });
  }
};

const getProfessionalProfile = async (req, res) => {
  const userId = req.user.id;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        type: 'status',
        message: 'User not found'
      });
    }

    const profile = await UserProfessionalProfile.findOrCreate(userId);

    const responseData = {
      fullname: user.username || null,
      email: user.email || null,
      phone: user.phone || null,
      ...profile,
    };

    res.status(200).json({
      type: 'final',
      message: 'Professional profile fetched successfully',
      data: responseData,
    });
  } catch (error) {
    console.error('Error fetching professional profile:', error);
    res.status(500).json({ 
      type: 'status',
      message: 'Internal server error' 
    });
  }
};



    
//     if (is_profile_completed !== undefined) {
    
//     if (preferred_tone !== undefined) updateFields.preferred_tone = preferred_tone;
//     if (preferred_detail_level !== undefined) updateFields.preferred_detail_level = preferred_detail_level;
//     if (citation_style !== undefined) updateFields.citation_style = citation_style;
//     if (perspective !== undefined) updateFields.perspective = perspective;
//     if (typical_client !== undefined) updateFields.typical_client = typical_client;
//     if (highlights_in_summary !== undefined) updateFields.highlights_in_summary = highlights_in_summary;
//     if (organization_name !== undefined) updateFields.organization_name = organization_name;
//     if (primary_role !== undefined) updateFields.primary_role = primary_role;
//     if (experience !== undefined) updateFields.experience = experience;
//     if (primary_jurisdiction !== undefined) updateFields.primary_jurisdiction = primary_jurisdiction;
//     if (main_areas_of_practice !== undefined) updateFields.main_areas_of_practice = main_areas_of_practice;
//     if (organization_type !== undefined) updateFields.organization_type = organization_type;
//     if (bar_enrollment_number !== undefined) updateFields.bar_enrollment_number = bar_enrollment_number;







//     if (phone !== undefined) userUpdateFields.phone = phone;
//     if (location !== undefined) userUpdateFields.location = location;
//     if (profile_image !== undefined) userUpdateFields.profile_image = profile_image;





//     if (is_profile_completed !== undefined) {

//     if (preferred_tone !== undefined) updateFields.preferred_tone = preferred_tone;
//     if (preferred_detail_level !== undefined) updateFields.preferred_detail_level = preferred_detail_level;
//     if (citation_style !== undefined) updateFields.citation_style = citation_style;
//     if (perspective !== undefined) updateFields.perspective = perspective;
//     if (typical_client !== undefined) updateFields.typical_client = typical_client;
//     if (highlights_in_summary !== undefined) updateFields.highlights_in_summary = highlights_in_summary;
//     if (organization_name !== undefined) updateFields.organization_name = organization_name;
//     if (primary_role !== undefined) updateFields.primary_role = primary_role;
//     if (experience !== undefined) updateFields.experience = experience;
//     if (primary_jurisdiction !== undefined) updateFields.primary_jurisdiction = primary_jurisdiction;
//     if (main_areas_of_practice !== undefined) updateFields.main_areas_of_practice = main_areas_of_practice;
//     if (organization_type !== undefined) updateFields.organization_type = organization_type;
//     if (bar_enrollment_number !== undefined) updateFields.bar_enrollment_number = bar_enrollment_number;




const updateProfessionalProfile = async (req, res) => {
  const userId = req.user.id;

  const {
    phone,
    location,
    profile_image,  // optional if user wants to update profile image
  } = req.body;

  const {
    is_profile_completed,
    preferred_tone,
    preferred_detail_level,
    citation_style,
    perspective,
    typical_client,
    highlights_in_summary,
    organization_name,
    primary_role,
    experience,
    primary_jurisdiction,
    main_areas_of_practice,
    organization_type,
    bar_enrollment_number,
  } = req.body;

  try {
    console.log("🔍 Updating profile for user:", userId);


    const userUpdateFields = {};

    if (phone !== undefined) userUpdateFields.phone = phone;
    if (location !== undefined) userUpdateFields.location = location;
    if (profile_image !== undefined) userUpdateFields.profile_image = profile_image;

    if (Object.keys(userUpdateFields).length > 0) {
      await User.update(userId, userUpdateFields);
    }


    await UserProfessionalProfile.findOrCreate(userId);


    const updateFields = {};

    if (is_profile_completed !== undefined)
      updateFields.is_profile_completed = is_profile_completed;

    if (preferred_tone !== undefined)
      updateFields.preferred_tone = preferred_tone;

    if (preferred_detail_level !== undefined)
      updateFields.preferred_detail_level = preferred_detail_level;

    if (citation_style !== undefined)
      updateFields.citation_style = citation_style;

    if (perspective !== undefined)
      updateFields.perspective = perspective;

    if (typical_client !== undefined)
      updateFields.typical_client = typical_client;

    if (highlights_in_summary !== undefined)
      updateFields.highlights_in_summary = highlights_in_summary;

    if (organization_name !== undefined)
      updateFields.organization_name = organization_name;

    if (primary_role !== undefined)
      updateFields.primary_role = primary_role;

    if (experience !== undefined)
      updateFields.experience = experience;

    if (primary_jurisdiction !== undefined)
      updateFields.primary_jurisdiction = primary_jurisdiction;

    if (main_areas_of_practice !== undefined)
      updateFields.main_areas_of_practice = main_areas_of_practice;

    if (organization_type !== undefined)
      updateFields.organization_type = organization_type;

    if (bar_enrollment_number !== undefined)
      updateFields.bar_enrollment_number = bar_enrollment_number;

    const updatedProfile = await UserProfessionalProfile.update(userId, updateFields);


    res.status(200).json({
      type: "final",
      message: "Professional profile updated successfully",
      data: updatedProfile,
    });

  } catch (error) {
    console.error("❌ Error updating profile:", error);
    res.status(500).json({
      type: "status",
      message: "Internal server error",
    });
  }
};


const changePassword = async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  const userId = req.user.id;

  console.log(`[AuthController] Attempting password change for user ID: ${userId}`);

  try {
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ 
        message: 'Current password, new password, and confirmation are required' 
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ 
        message: 'New password and confirmation do not match' 
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ 
        message: 'New password must be at least 6 characters long' 
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      console.log(`[AuthController] User not found for ID: ${userId}`);
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.password || typeof user.password !== 'string' || user.password.trim() === '') {
      console.log(`[AuthController] User ${user.email} has no password (likely Google sign-in user).`);
      return res.status(400).json({ 
        message: 'This account was created using Google Sign-In and does not have a password. Password change is not available.' 
      });
    }

    console.log(`[AuthController] Verifying current password for user: ${user.email}`);
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      console.log(`[AuthController] Current password mismatch for user: ${user.email}`);
      return res.status(400).json({ message: 'Current password is incorrect' });
    }
    console.log(`[AuthController] ✅ Current password verified for user: ${user.email}`);

    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      return res.status(400).json({ 
        message: 'New password must be different from current password' 
      });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    console.log(`[AuthController] ✅ New password hashed for user: ${user.email}`);

    await User.update(userId, { password: hashedNewPassword });
    console.log(`[AuthController] ✅ Password updated successfully for user: ${user.email}`);


    res.status(200).json({
      success: true,
      message: 'Password changed successfully. Please log in again with your new password.',
    });

  } catch (error) {
    console.error('[AuthController] ❌ Error during password change:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error' 
    });
  }
};

const getAllActiveUsers = async (req, res) => {
  try {
    const users = await User.findAllActive();
    
    res.status(200).json({
      success: true,
      message: 'Active users fetched successfully',
      users: users.map(user => ({
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        status: user.is_blocked ? 'blocked' : 'active',
        created_at: user.created_at,
        updated_at: user.updated_at
      }))
    });
  } catch (error) {
    console.error('Error fetching active users:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error' 
    });
  }
};

const getAllUsers = async (req, res) => {
  try {
    const { is_blocked } = req.query;
    let users;
    
    if (is_blocked === 'false' || is_blocked === false) {
      users = await User.findAllActive();
    } else {
      users = await User.findAll();
    }
    
    res.status(200).json({
      success: true,
      message: 'Users fetched successfully',
      users: users.map(user => ({
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        status: user.is_blocked ? 'blocked' : 'active',
        created_at: user.created_at,
        updated_at: user.updated_at
      }))
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error' 
    });
  }
};

module.exports = { 
  register, 
  login, 
  firebaseGoogleSignIn, 
  verifyOtpAndLogin, 
  updateProfile, 
  deleteAccount, 
  logout, 
  fetchProfile, 
  getUserById, 
  updateRazorpayCustomerId,
  getUserInfo,
  getProfessionalProfile,
  updateProfessionalProfile,
  changePassword,
  getAllActiveUsers,
  getAllUsers
};