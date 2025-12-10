


// import React, { useState, useEffect, useRef, useCallback } from 'react';
// import { User, Mail, Phone, MapPin, Calendar, Shield, Bell, Palette, Globe, Download, Trash2, LogOut, ChevronRight, Check, Lock, Eye, EyeOff } from 'lucide-react';
// import { useTheme } from '../context/ThemeContext.jsx';
// import api from '../services/api';
// import { ToastContainer, toast } from 'react-toastify';
// import 'react-toastify/dist/ReactToastify.css';

// const SettingsPage = () => {
//  const { theme, toggleTheme } = useTheme();
//  const [language, setLanguage] = useState('English');
//  const [notifications, setNotifications] = useState({
//  email: true,
//  push: false,
//  marketing: false
//  });

//  // User data state
//  const [userData, setUserData] = useState({
//  fullName: '',
//  email: '',
//  phone: '',
//  location: '',
//  joinDate: ''
//  });

//  const [loading, setLoading] = useState(true);
//  const [error, setError] = useState(null);
//  const [isEditingProfile, setIsEditingProfile] = useState(false);
//  const [isEditingPassword, setIsEditingPassword] = useState(false);
//  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

//  // Password visibility state only
//  const [showPasswords, setShowPasswords] = useState({
//  current: false,
//  new: false,
//  confirm: false
//  });

//  // Password values state (controlled approach)
//  const [passwordValues, setPasswordValues] = useState({
//  current: '',
//  new: '',
//  confirm: ''
//  });

//  // Memoized onChange handlers for password inputs
//  const handleCurrentPasswordChange = useCallback((value) => {
//  setPasswordValues(prev => ({ ...prev, current: value }));
//  }, []);

//  const handleNewPasswordChange = useCallback((value) => {
//  setPasswordValues(prev => ({ ...prev, new: value }));
//  }, []);

//  const handleConfirmPasswordChange = useCallback((value) => {
//  setPasswordValues(prev => ({ ...prev, confirm: value }));
//  }, []);

//  // Refs for profile inputs only (uncontrolled approach)
//  const fullNameRef = useRef(null);
//  const emailRef = useRef(null);
//  const phoneRef = useRef(null);
//  const locationRef = useRef(null);

//  const handleThemeChange = (newTheme) => {
//  toggleTheme(newTheme);
//  };

//  const handleNotificationChange = (type) => {
//  setNotifications(prev => ({
//  ...prev,
//  [type]: !prev[type]
//  }));
//  };

//  const handleProfileSave = async () => {
//  const formData = {
//  fullname: fullNameRef.current?.value || '',
//  email: emailRef.current?.value || '',
//  phone: phoneRef.current?.value || '',
//  location: locationRef.current?.value || ''
//  };

//  try {
//  const updatedUser = await api.updateProfile(formData);
 
//  setUserData(prev => ({
//  ...prev,
//  fullName: updatedUser.user.username || formData.fullname,
//  email: updatedUser.user.email || formData.email,
//  phone: updatedUser.user.phone || formData.phone,
//  location: updatedUser.user.location || formData.location
//  }));
 
//  setIsEditingProfile(false);
//  toast.success('Profile updated successfully!');
//  } catch (err) {
//  console.error('Error updating profile:', err);
//  toast.error(err.response?.data?.message || 'Failed to update profile.');
//  }
//  };

//  const handlePasswordSave = async () => {
//  const currentPassword = passwordValues.current.trim();
//  const newPassword = passwordValues.new.trim();
//  const confirmPassword = passwordValues.confirm.trim();

//  // Validation checks
//  if (!currentPassword || !newPassword || !confirmPassword) {
//  toast.error('Please fill in all password fields.');
//  return;
//  }

//  if (newPassword !== confirmPassword) {
//  toast.error('New passwords do not match.');
//  return;
//  }

//  if (newPassword.length < 6) {
//  toast.error('New password must be at least 6 characters long.');
//  return;
//  }

//  if (currentPassword === newPassword) {
//  toast.error('New password must be different from current password.');
//  return;
//  }

//  // Check password strength (optional additional validation)
//  const hasUpperCase = /[A-Z]/.test(newPassword);
//  const hasLowerCase = /[a-z]/.test(newPassword);
//  const hasNumber = /[0-9]/.test(newPassword);
 
//  if (!hasUpperCase || !hasLowerCase || !hasNumber) {
//  toast.warning('For better security, use a mix of uppercase, lowercase, and numbers.');
//  }

//  try {
//  setIsUpdatingPassword(true);
 
//  const response = await api.updatePassword({
//  currentPassword: currentPassword,
//  newPassword: newPassword,
//  });
 
//  // Clear password fields
//  setPasswordValues({
//  current: '',
//  new: '',
//  confirm: ''
//  });
 
//  // Close editing mode
//  setIsEditingPassword(false);
 
//  // Show success message
//  toast.success(response.message || 'Password updated successfully!');
 
//  } catch (err) {
//  console.error('Error updating password:', err);
 
//  // Handle specific error cases
//  if (err.response?.status === 401) {
//  toast.error('Current password is incorrect. Please try again.');
//  } else if (err.response?.status === 400) {
//  toast.error(err.response?.data?.message || 'Invalid password format.');
//  } else if (err.response?.status === 500) {
//  toast.error('Server error. Please try again later.');
//  } else {
//  toast.error(err.response?.data?.message || 'Failed to update password. Please try again.');
//  }
//  } finally {
//  setIsUpdatingPassword(false);
//  }
//  };

//  const togglePasswordVisibility = (field) => {
//  setShowPasswords(prev => ({
//  ...prev,
//  [field]: !prev[field]
//  }));
//  };

//  const handleDeleteAccount = async () => {
//  if (window.confirm('Are you sure you want to delete your account? This action cannot be undone.')) {
//  try {
//  await api.deleteAccount();
//  toast.success('Account deleted successfully. You will be logged out.');
//  setTimeout(() => {
//  handleLogout();
//  }, 2000);
//  } catch (err) {
//  console.error('Error deleting account:', err);
//  toast.error(err.response?.data?.message || 'Failed to delete account.');
//  }
//  }
//  };

//  const handleLogout = async () => {
//  try {
//  // Call the logout API endpoint to invalidate the session token
//  await api.logoutUser();
 
//  // Clear local storage
//  api.logout();
 
//  // Show success message
//  toast.success('Logged out successfully!');
 
//  // Redirect to login page
//  setTimeout(() => {
//  window.location.href = '/login';
//  }, 1000);
//  } catch (err) {
//  console.error('Error logging out:', err);
//  // Even if the API call fails, still clear local storage and redirect
//  api.logout();
//  toast.success('Logged out successfully!');
//  setTimeout(() => {
//  window.location.href = '/login';
//  }, 1000);
//  }
//  };

//  const handlePhoneInput = (e) => {
//  const value = e.target.value.replace(/\D/g, '');
//  if (value.length <= 10) {
//  e.target.value = value;
//  } else {
//  e.target.value = value.slice(0, 10);
//  }
//  };

//  useEffect(() => {
//  const fetchUserProfile = async () => {
//  try {
//  setLoading(true);
//  const response = await api.fetchProfile();
//  const user = response.user;
 
//  setUserData({
//  fullName: user.username || '',
//  email: user.email || '',
//  phone: user.phone || '',
//  location: user.location || '',
//  joinDate: user.created_at ? new Date(user.created_at).toLocaleDateString('en-US', {
//  year: 'numeric',
//  month: 'long',
//  day: 'numeric'
//  }) : 'N/A'
//  });
//  } catch (err) {
//  setError('Failed to fetch user profile.');
//  console.error('Error fetching profile:', err);
//  toast.error('Failed to load profile data.');
//  } finally {
//  setLoading(false);
//  }
//  };

//  fetchUserProfile();
//  }, []);

//  if (loading) {
//  return (
//  <div className="min-h-screen flex items-center justify-center bg-gray-50">
//  <div className="text-center">
//  <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
//  <p className="mt-4 text-gray-600">Loading settings...</p>
//  </div>
//  </div>
//  );
//  }

//  if (error) {
//  return (
//  <div className="min-h-screen flex items-center justify-center bg-gray-50">
//  <div className="text-center">
//  <p className="text-red-600 text-lg">{error}</p>
//  <button 
//  onClick={() => window.location.reload()} 
//  className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
//  >
//  Retry
//  </button>
//  </div>
//  </div>
//  );
//  }

//  const SettingSection = ({ icon: Icon, title, children, className = "" }) => (
//  <div className={`bg-white border border-gray-200 rounded-lg p-6 ${className}`}>
//  <div className="flex items-center mb-4">
//  <Icon className="w-5 h-5 text-gray-600 mr-3" />
//  <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
//  </div>
//  {children}
//  </div>
//  );

//  const ToggleSwitch = ({ enabled, onChange, label, description }) => (
//  <div className="flex items-center justify-between py-3">
//  <div className="flex-1">
//  <div className="text-sm font-medium text-gray-900">{label}</div>
//  {description && <div className="text-sm text-gray-500">{description}</div>}
//  </div>
//  <button
//  onClick={onChange}
//  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
//  enabled ? 'bg-green-600' : 'bg-gray-200'
//  }`}
//  >
//  <span
//  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
//  enabled ? 'translate-x-6' : 'translate-x-1'
//  }`}
//  />
//  </button>
//  </div>
//  );

//  return (
//  <div className="min-h-screen bg-gray-50">
//  <ToastContainer 
//  position="top-right" 
//  autoClose={5000} 
//  hideProgressBar={false} 
//  newestOnTop 
//  closeOnClick 
//  rtl={false} 
//  pauseOnFocusLoss 
//  draggable 
//  pauseOnHover 
//  theme="light"
//  />
 
//  {/* Header */}
//  <div className="bg-white border-b border-gray-200">
//  <div className="max-w-4xl mx-auto px-6 py-6">
//  <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
//  <p className="text-gray-600 mt-1">Manage your account and application preferences</p>
//  </div>
//  </div>

//  <div className="max-w-4xl mx-auto px-6 py-8">
//  <div className="space-y-6">
 
//  {/* Account Section */}
//  <SettingSection icon={User} title="Account">
//  <div className="space-y-4">
//  <div className="flex items-center justify-between">
//  <div className="flex items-center space-x-4">
//  <div
//  className="w-12 h-12 rounded-full flex items-center justify-center text-white font-medium shadow-lg transition-colors duration-200 transform hover:-translate-y-0.5 hover:shadow-xl"
//  style={{ backgroundColor: '#21C1B6' }}
//  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//  >
//  <User className="w-6 h-6" />
//  </div>
//  <div>
//  <div className="font-medium text-gray-900">{userData.fullName}</div>
//  <div className="text-sm text-gray-500">Joined {userData.joinDate}</div>
//  </div>
//  </div>
//  <button
//  onClick={() => setIsEditingProfile(!isEditingProfile)}
//  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//  className="px-4 py-2 text-sm font-medium text-white rounded-md transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
//  style={{ backgroundColor: '#21C1B6' }}
//  >
//  {isEditingProfile ? 'Cancel' : 'Edit Profile'}
//  </button>
//  </div>

//  {isEditingProfile ? (
//  <div className="space-y-4 border-t pt-4">
//  <div>
//  <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
//  <input
//  ref={fullNameRef}
//  id="fullName"
//  type="text"
//  defaultValue={userData.fullName}
//  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
//  placeholder="Enter your full name"
//  />
//  </div>
//  <div>
//  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
//  <input
//  ref={emailRef}
//  id="email"
//  type="email"
//  defaultValue={userData.email}
//  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
//  placeholder="Enter your email"
//  />
//  </div>
//  <div>
//  <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">Phone (10 digits only)</label>
//  <input
//  ref={phoneRef}
//  id="phone"
//  type="tel"
//  defaultValue={userData.phone}
//  onInput={handlePhoneInput}
//  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
//  placeholder="Enter your 10-digit phone number"
//  maxLength="10"
//  />
//  </div>
//  <div>
//  <label htmlFor="location" className="block text-sm font-medium text-gray-700 mb-1">Location</label>
//  <input
//  ref={locationRef}
//  id="location"
//  type="text"
//  defaultValue={userData.location}
//  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
//  placeholder="Enter your location"
//  />
//  </div>
//  <div className="flex space-x-3">
//  <button
//  onClick={handleProfileSave}
//  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//  className="px-4 py-2 text-white text-sm font-medium rounded-md transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
//  style={{ backgroundColor: '#21C1B6' }}
//  >
//  Save Changes
//  </button>
//  <button
//  onClick={() => setIsEditingProfile(false)}
//  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//  className="px-4 py-2 text-white text-sm font-medium rounded-md transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
//  style={{ backgroundColor: '#21C1B6' }}
//  >
//  Cancel
//  </button>
//  </div>
//  </div>
//  ) : (
//  <div className="space-y-3 border-t pt-4">
//  <div className="flex items-center text-sm">
//  <Mail className="w-4 h-4 text-gray-400 mr-3" />
//  <span className="text-gray-600">{userData.email || 'Not provided'}</span>
//  </div>
//  <div className="flex items-center text-sm">
//  <Phone className="w-4 h-4 text-gray-400 mr-3" />
//  <span className="text-gray-600">{userData.phone || 'Not provided'}</span>
//  </div>
//  <div className="flex items-center text-sm">
//  <MapPin className="w-4 h-4 text-gray-400 mr-3" />
//  <span className="text-gray-600">{userData.location || 'Not provided'}</span>
//  </div>
//  </div>
//  )}
//  </div>
//  </SettingSection>

//  {/* Password Section */}
//  <SettingSection icon={Lock} title="Password & Security">
//  <div className="space-y-4">
//  <div className="flex items-center justify-between">
//  <div>
//  <div className="text-sm font-medium text-gray-900">Password</div>
//  <div className="text-sm text-gray-500">Update your account password</div>
//  </div>
//  <button
//  onClick={() => {
//  setIsEditingPassword(!isEditingPassword);
//  if (isEditingPassword) {
//  setPasswordValues({ current: '', new: '', confirm: '' });
//  }
//  }}
//  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//  className="px-4 py-2 text-sm font-medium text-white rounded-md transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
//  style={{ backgroundColor: '#21C1B6' }}
//  disabled={isUpdatingPassword}
//  >
//  {isEditingPassword ? 'Cancel' : 'Change Password'}
//  </button>
//  </div>

//  {isEditingPassword && (
//  <div className="space-y-4 border-t pt-4">
//  <div>
//  <label htmlFor="currentPassword" className="block text-sm font-medium text-gray-700 mb-1">
//  Current Password <span className="text-red-500">*</span>
//  </label>
//  <PasswordInput
//  key="current-password-input"
//  id="currentPassword"
//  placeholder="Enter current password"
//  value={passwordValues.current}
//  onChange={handleCurrentPasswordChange}
//  showPassword={showPasswords.current}
//  onToggle={() => togglePasswordVisibility('current')}
//  autoComplete="current-password"
//  disabled={isUpdatingPassword}
//  />
//  </div>
//  <div>
//  <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700 mb-1">
//  New Password <span className="text-red-500">*</span>
//  </label>
//  <PasswordInput
//  key="new-password-input"
//  id="newPassword"
//  placeholder="Enter new password (min. 6 characters)"
//  value={passwordValues.new}
//  onChange={handleNewPasswordChange}
//  showPassword={showPasswords.new}
//  onToggle={() => togglePasswordVisibility('new')}
//  autoComplete="new-password"
//  disabled={isUpdatingPassword}
//  />
//  <p className="mt-1 text-xs text-gray-500">
//  Password should contain uppercase, lowercase, and numbers for better security
//  </p>
//  </div>
//  <div>
//  <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
//  Confirm New Password <span className="text-red-500">*</span>
//  </label>
//  <PasswordInput
//  key="confirm-password-input"
//  id="confirmPassword"
//  placeholder="Confirm new password"
//  value={passwordValues.confirm}
//  onChange={handleConfirmPasswordChange}
//  showPassword={showPasswords.confirm}
//  onToggle={() => togglePasswordVisibility('confirm')}
//  autoComplete="new-password"
//  disabled={isUpdatingPassword}
//  />
//  </div>
//  <div className="flex space-x-3">
//  <button
//  onClick={handlePasswordSave}
//  disabled={isUpdatingPassword}
//  onMouseEnter={(e) => !isUpdatingPassword && (e.currentTarget.style.backgroundColor = '#1AA49B')}
//  onMouseLeave={(e) => !isUpdatingPassword && (e.currentTarget.style.backgroundColor = '#21C1B6')}
//  className="px-4 py-2 text-white text-sm font-medium rounded-md transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
//  style={{ backgroundColor: isUpdatingPassword ? '#9CA3AF' : '#21C1B6' }}
//  >
//  {isUpdatingPassword ? (
//  <span className="flex items-center">
//  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
//  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
//  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
//  </svg>
//  Updating...
//  </span>
//  ) : (
//  'Update Password'
//  )}
//  </button>
//  <button
//  onClick={() => {
//  setIsEditingPassword(false);
//  setPasswordValues({
//  current: '',
//  new: '',
//  confirm: ''
//  });
//  }}
//  disabled={isUpdatingPassword}
//  onMouseEnter={(e) => !isUpdatingPassword && (e.currentTarget.style.backgroundColor = '#1AA49B')}
//  onMouseLeave={(e) => !isUpdatingPassword && (e.currentTarget.style.backgroundColor = '#21C1B6')}
//  className="px-4 py-2 text-white text-sm font-medium rounded-md transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
//  style={{ backgroundColor: isUpdatingPassword ? '#9CA3AF' : '#21C1B6' }}
//  >
//  Cancel
//  </button>
//  </div>
//  </div>
//  )}
//  </div>
//  </SettingSection>

//  {/* Language & Region */}
//  <SettingSection icon={Globe} title="Language & Region">
//  <div className="space-y-4">
//  <div>
//  <label htmlFor="language" className="block text-sm font-medium text-gray-700 mb-2">Language</label>
//  <select
//  id="language"
//  value={language}
//  onChange={(e) => setLanguage(e.target.value)}
//  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
//  >
//  <option value="English">English</option>
//  <option value="Spanish">Español</option>
//  <option value="French">Français</option>
//  <option value="German">Deutsch</option>
//  <option value="Chinese">中文</option>
//  </select>
//  </div>
//  </div>
//  </SettingSection>

//  {/* Notifications */}
//  <SettingSection icon={Bell} title="Notifications">
//  <div className="space-y-1">
//  <ToggleSwitch
//  enabled={notifications.email}
//  onChange={() => handleNotificationChange('email')}
//  label="Email notifications"
//  description="Receive updates about your conversations via email"
//  />
//  <ToggleSwitch
//  enabled={notifications.push}
//  onChange={() => handleNotificationChange('push')}
//  label="Push notifications"
//  description="Get notified about important updates"
//  />
//  <ToggleSwitch
//  enabled={notifications.marketing}
//  onChange={() => handleNotificationChange('marketing')}
//  label="Marketing emails"
//  description="Receive product updates and feature announcements"
//  />
//  </div>
//  </SettingSection>

//  {/* Privacy & Security */}
//  <SettingSection icon={Shield} title="Privacy & Security">
//  <div className="space-y-3">
//  <div className="flex items-center justify-between py-3 border-b border-gray-100">
//  <div>
//  <div className="text-sm font-medium text-gray-900">Two-factor authentication</div>
//  <div className="text-sm text-gray-500">Add an extra layer of security</div>
//  </div>
//  <ChevronRight className="w-4 h-4 text-gray-400" />
//  </div>
//  <div className="flex items-center justify-between py-3 border-b border-gray-100">
//  <div>
//  <div className="text-sm font-medium text-gray-900">Login activity</div>
//  <div className="text-sm text-gray-500">See your recent login history</div>
//  </div>
//  <ChevronRight className="w-4 h-4 text-gray-400" />
//  </div>
//  <div className="flex items-center justify-between py-3">
//  <div>
//  <div className="text-sm font-medium text-gray-900">Connected apps</div>
//  <div className="text-sm text-gray-500">Manage third-party integrations</div>
//  </div>
//  <ChevronRight className="w-4 h-4 text-gray-400" />
//  </div>
//  </div>
//  </SettingSection>

//  {/* Data & Storage */}
//  <SettingSection icon={Download} title="Data & Storage">
//  <div className="space-y-3">
//  <button
//  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//  className="flex items-center justify-between w-full py-3 px-4 text-left text-white transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 rounded-md"
//  style={{ backgroundColor: '#21C1B6' }}
//  >
//  <div>
//  <div className="text-sm font-medium">Export data</div>
//  <div className="text-sm text-gray-100">Download your conversation history</div>
//  </div>
//  <Download className="w-4 h-4" />
//  </button>
//  <div className="border-t pt-3">
//  <button
//  onClick={handleDeleteAccount}
//  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#DC2626')}
//  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#EF4444')}
//  className="flex items-center text-white hover:text-gray-100 transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
//  style={{ backgroundColor: '#EF4444', padding: '0.5rem 1rem', borderRadius: '0.375rem' }}
//  >
//  <Trash2 className="w-4 h-4 mr-2" />
//  <span className="text-sm font-medium">Delete all conversations</span>
//  </button>
//  </div>
//  </div>
//  </SettingSection>

//  {/* Account Actions */}
//  <SettingSection icon={LogOut} title="Account Actions" className="border-red-200">
//  <div className="space-y-3">
//  <button
//  onClick={handleLogout}
//  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//  className="flex items-center text-white hover:text-gray-100 transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
//  style={{ backgroundColor: '#21C1B6', padding: '0.5rem 1rem', borderRadius: '0.375rem' }}
//  >
//  <LogOut className="w-4 h-4 mr-2" />
//  <span className="text-sm font-medium">Logout</span>
//  </button>
//  <div className="border-t pt-3">
//  <button
//  onClick={handleDeleteAccount}
//  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#DC2626')}
//  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#EF4444')}
//  className="flex items-center text-white hover:text-gray-100 transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
//  style={{ backgroundColor: '#EF4444', padding: '0.5rem 1rem', borderRadius: '0.375rem' }}
//  >
//  <Trash2 className="w-4 h-4 mr-2" />
//  <span className="text-sm font-medium">Delete account</span>
//  </button>
//  <p className="text-xs text-gray-500 mt-1">This action cannot be undone</p>
//  </div>
//  </div>
//  </SettingSection>

//  </div>
//  </div>
//  </div>
//  );
// };

// export default SettingsPage;

// // Password input component with stable focus
// const PasswordInput = React.memo(({ id, placeholder, value, onChange, showPassword, onToggle, autoComplete, disabled }) => {
//  const inputRef = useRef(null);

//  const handleToggle = (e) => {
//  e.preventDefault();
//  e.stopPropagation();
 
//  const input = inputRef.current;
//  const cursorPosition = input?.selectionStart;
 
//  onToggle();
 
//  requestAnimationFrame(() => {
//  input?.focus();
//  if (cursorPosition !== null && cursorPosition !== undefined) {
//  input.setSelectionRange(cursorPosition, cursorPosition);
//  }
//  });
//  };

//  return (
//  <div className="relative">
//  <input
//  ref={inputRef}
//  id={id}
//  type={showPassword ? 'text' : 'password'}
//  value={value}
//  onChange={(e) => onChange(e.target.value)}
//  className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed text-black"
//  placeholder={placeholder}
//  autoComplete={autoComplete}
//  maxLength={100}
//  spellCheck="false"
//  autoCapitalize="off"
//  autoCorrect="off"
//  disabled={disabled}
//  />
//  <button
//  type="button"
//  onClick={handleToggle}
//  onMouseDown={(e) => e.preventDefault()}
//  className="password-toggle-btn absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors duration-150 p-1 rounded focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:cursor-not-allowed"
//  aria-label={showPassword ? 'Hide password' : 'Show password'}
//  tabIndex={-1}
//  disabled={disabled}
//  >
//  {showPassword ? (
//  <EyeOff className="w-4 h-4" />
//  ) : (
//  <Eye className="w-4 h-4" />
//  )}
//  </button>
//  </div>
//  );
// });


// import React, { useState, useEffect, useRef, useCallback } from 'react';
// import { User, Mail, Phone, MapPin, Calendar, Shield, Bell, Palette, Globe, Download, Trash2, LogOut, ChevronRight, Check, Lock, Eye, EyeOff } from 'lucide-react';
// import { useTheme } from '../context/ThemeContext.jsx';
// import api from '../services/api';
// import { ToastContainer, toast } from 'react-toastify';
// import 'react-toastify/dist/ReactToastify.css';
// import ProfileSetupForm from '../components/ProfileSetupForm';

// const SettingsPage = () => {
//  const { theme, toggleTheme } = useTheme();
//  const [language, setLanguage] = useState('English');
//  const [notifications, setNotifications] = useState({
//  email: true,
//  push: false,
//  marketing: false
//  });

//  // User data state
//  const [userData, setUserData] = useState({
//  fullName: '',
//  email: '',
//  phone: '',
//  location: '',
//  joinDate: ''
//  });

//  const [loading, setLoading] = useState(true);
//  const [error, setError] = useState(null);
//  const [isEditingProfile, setIsEditingProfile] = useState(false);
//  const [isEditingPassword, setIsEditingPassword] = useState(false);
//  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
//  const [showProfileSetup, setShowProfileSetup] = useState(false);

//  // Password visibility state only
//  const [showPasswords, setShowPasswords] = useState({
//  current: false,
//  new: false,
//  confirm: false
//  });

//  // Password values state (controlled approach)
//  const [passwordValues, setPasswordValues] = useState({
//  current: '',
//  new: '',
//  confirm: ''
//  });

//  // Memoized onChange handlers for password inputs
//  const handleCurrentPasswordChange = useCallback((value) => {
//  setPasswordValues(prev => ({ ...prev, current: value }));
//  }, []);

//  const handleNewPasswordChange = useCallback((value) => {
//  setPasswordValues(prev => ({ ...prev, new: value }));
//  }, []);

//  const handleConfirmPasswordChange = useCallback((value) => {
//  setPasswordValues(prev => ({ ...prev, confirm: value }));
//  }, []);

//  // Refs for profile inputs only (uncontrolled approach)
//  const fullNameRef = useRef(null);
//  const emailRef = useRef(null);
//  const phoneRef = useRef(null);
//  const locationRef = useRef(null);

//  const handleThemeChange = (newTheme) => {
//  toggleTheme(newTheme);
//  };

//  const handleNotificationChange = (type) => {
//  setNotifications(prev => ({
//  ...prev,
//  [type]: !prev[type]
//  }));
//  };

//  const handleProfileSave = async () => {
//  const formData = {
//  fullname: fullNameRef.current?.value || '',
//  email: emailRef.current?.value || '',
//  phone: phoneRef.current?.value || '',
//  location: locationRef.current?.value || ''
//  };

//  try {
//  const updatedUser = await api.updateProfile(formData);
 
//  setUserData(prev => ({
//  ...prev,
//  fullName: updatedUser.user.username || formData.fullname,
//  email: updatedUser.user.email || formData.email,
//  phone: updatedUser.user.phone || formData.phone,
//  location: updatedUser.user.location || formData.location
//  }));
 
//  setIsEditingProfile(false);
//  toast.success('Profile updated successfully!');
//  } catch (err) {
//  console.error('Error updating profile:', err);
//  toast.error(err.response?.data?.message || 'Failed to update profile.');
//  }
//  };

//  const handlePasswordSave = async () => {
//  const currentPassword = passwordValues.current.trim();
//  const newPassword = passwordValues.new.trim();
//  const confirmPassword = passwordValues.confirm.trim();

//  // Validation checks
//  if (!currentPassword || !newPassword || !confirmPassword) {
//  toast.error('Please fill in all password fields.');
//  return;
//  }

//  if (newPassword !== confirmPassword) {
//  toast.error('New passwords do not match.');
//  return;
//  }

//  if (newPassword.length < 6) {
//  toast.error('New password must be at least 6 characters long.');
//  return;
//  }

//  if (currentPassword === newPassword) {
//  toast.error('New password must be different from current password.');
//  return;
//  }

//  // Check password strength (optional additional validation)
//  const hasUpperCase = /[A-Z]/.test(newPassword);
//  const hasLowerCase = /[a-z]/.test(newPassword);
//  const hasNumber = /[0-9]/.test(newPassword);
 
//  if (!hasUpperCase || !hasLowerCase || !hasNumber) {
//  toast.warning('For better security, use a mix of uppercase, lowercase, and numbers.');
//  }

//  try {
//  setIsUpdatingPassword(true);
 
//  const response = await api.updatePassword({
//  currentPassword: currentPassword,
//  newPassword: newPassword,
//  confirmPassword: confirmPassword,
//  });
 
//  // Clear password fields
//  setPasswordValues({
//  current: '',
//  new: '',
//  confirm: ''
//  });
 
//  // Close editing mode
//  setIsEditingPassword(false);
 
//  // Show success message
//  toast.success(response.message || 'Password updated successfully!');
 
//  } catch (err) {
//  console.error('Error updating password:', err);
 
//  // Handle specific error cases
//  if (err.response?.status === 401) {
//  toast.error('Current password is incorrect. Please try again.');
//  } else if (err.response?.status === 400) {
//  toast.error(err.response?.data?.message || 'Invalid password format.');
//  } else if (err.response?.status === 500) {
//  toast.error('Server error. Please try again later.');
//  } else {
//  toast.error(err.response?.data?.message || 'Failed to update password. Please try again.');
//  }
//  } finally {
//  setIsUpdatingPassword(false);
//  }
//  };

//  const togglePasswordVisibility = (field) => {
//  setShowPasswords(prev => ({
//  ...prev,
//  [field]: !prev[field]
//  }));
//  };

//  const handleDeleteAccount = async () => {
//  try {
//  await api.deleteAccount();
// //  toast.success('Account deleted successfully. You will be logged out.');
//  setTimeout(() => {
//  handleLogout();
//  }, 2000);
//  } catch (err) {
//  console.error('Error deleting account:', err);
// //  toast.error(err.response?.data?.message || 'Failed to delete account.');
//  }
//  };

//  const handleDeleteAllConversations = async () => {
//    try {
//      // Assuming there's an API call to delete all conversations
//      // If not, you'll need to implement this API call in your services/api.js
//      await api.deleteAllConversations(); // This needs to be implemented in api.js
//     //  toast.success('All conversations deleted successfully!');
//    } catch (err) {
//      console.error('Error deleting all conversations:', err);
//     //  toast.error(err.response?.data?.message || 'Failed to delete all conversations.');
//    }
//  };

//  const handleLogout = async () => {
//  try {
//  // Call the logout API endpoint to invalidate the session token
//  await api.logoutUser();
 
//  // Clear local storage
//  api.logout();
 
//  // Show success message
//  toast.success('Logged out successfully!');
 
//  // Redirect to login page
//  setTimeout(() => {
//  window.location.href = '/login';
//  }, 1000);
//  } catch (err) {
//  console.error('Error logging out:', err);
//  // Even if the API call fails, still clear local storage and redirect
//  api.logout();
//  toast.success('Logged out successfully!');
//  setTimeout(() => {
//  window.location.href = '/login';
//  }, 1000);
//  }
//  };

//  const handlePhoneInput = (e) => {
//  const value = e.target.value.replace(/\D/g, '');
//  if (value.length <= 10) {
//  e.target.value = value;
//  } else {
//  e.target.value = value.slice(0, 10);
//  }
//  };

//  useEffect(() => {
//  const fetchUserProfile = async () => {
//  try {
//  setLoading(true);
//  const response = await api.fetchProfile();
//  const user = response.user;
 
//  setUserData({
//  fullName: user.username || '',
//  email: user.email || '',
//  phone: user.phone || '',
//  location: user.location || '',
//  joinDate: user.created_at ? new Date(user.created_at).toLocaleDateString('en-US', {
//  year: 'numeric',
//  month: 'long',
//  day: 'numeric'
//  }) : 'N/A'
//  });
//  } catch (err) {
//  setError('Failed to fetch user profile.');
//  console.error('Error fetching profile:', err);
//  toast.error('Failed to load profile data.');
//  } finally {
//  setLoading(false);
//  }
//  };

//  fetchUserProfile();
//  }, []);

//  if (loading) {
//  return (
//  <div className="min-h-screen flex items-center justify-center bg-gray-50">
//  <div className="text-center">
//  <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
//  <p className="mt-4 text-gray-600">Loading settings...</p>
//  </div>
//  </div>
//  );
//  }

//  if (error) {
//  return (
//  <div className="min-h-screen flex items-center justify-center bg-gray-50">
//  <div className="text-center">
//  <p className="text-red-600 text-lg">{error}</p>
//  <button
//  onClick={() => window.location.reload()}
//  className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
//  >
//  Retry
//  </button>
//  </div>
//  </div>
//  );
//  }

//  const SettingSection = ({ icon: Icon, title, children, className = "" }) => (
//  <div className={`bg-white border border-gray-200 rounded-lg p-6 ${className}`}>
//  <div className="flex items-center mb-4">
//  <Icon className="w-5 h-5 text-gray-600 mr-3" />
//  <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
//  </div>
//  {children}
//  </div>
//  );

//  const ToggleSwitch = ({ enabled, onChange, label, description }) => (
//  <div className="flex items-center justify-between py-3">
//  <div className="flex-1">
//  <div className="text-sm font-medium text-gray-900">{label}</div>
//  {description && <div className="text-sm text-gray-500">{description}</div>}
//  </div>
//  <button
//  onClick={onChange}
//  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
//  enabled ? 'bg-green-600' : 'bg-gray-200'
//  }`}
//  >
//  <span
//  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
//  enabled ? 'translate-x-6' : 'translate-x-1'
//  }`}
//  />
//  </button>
//  </div>
//  );

//  return (
//  <div className="min-h-screen bg-gray-50">
//  <ToastContainer
//  position="top-right"
//  autoClose={5000}
//  hideProgressBar={false}
//  newestOnTop
//  closeOnClick
//  rtl={false}
//  pauseOnFocusLoss
//  draggable
//  pauseOnHover
//  theme="light"
//  />
 
//  {/* Header */}
//  <div className="bg-white border-b border-gray-200">
//  <div className="max-w-4xl mx-auto px-6 py-6">
//  <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
//  <p className="text-gray-600 mt-1">Manage your account and application preferences</p>
//  </div>
//  </div>

//  <div className="max-w-4xl mx-auto px-6 py-8">
//  <div className="space-y-6">
 
//  {/* Account Section */}
//  <SettingSection icon={User} title="Account">
//  <div className="space-y-4">
//  <div className="flex items-center justify-between">
//  <div className="flex items-center space-x-4">
//  <div
//  className="w-12 h-12 rounded-full flex items-center justify-center text-white font-medium shadow-lg transition-colors duration-200 transform hover:-translate-y-0.5 hover:shadow-xl"
//  style={{ backgroundColor: '#21C1B6' }}
//  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//  >
//  <User className="w-6 h-6" />
//  </div>
//  <div>
//  <div className="font-medium text-gray-900">{userData.fullName}</div>
//  <div className="text-sm text-gray-500">Joined {userData.joinDate}</div>
//  </div>
//  </div>
//  <button
//  onClick={() => setShowProfileSetup(!showProfileSetup)}
//  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//  className="px-4 py-2 text-sm font-medium text-white rounded-md transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
//  style={{ backgroundColor: '#21C1B6' }}
//  >
//  {showProfileSetup ? 'Hide Profile Setup' : 'Complete Profile Setup'}
//  </button>
//  </div>

//  {showProfileSetup && (
//  <div className="border-t pt-6 mt-6">
//  <ProfileSetupForm
//  onSave={() => {
//  setShowProfileSetup(false);
//  window.dispatchEvent(new CustomEvent('userInfoUpdated'));
//  toast.success('Profile updated successfully!');
//  }}
//  />
//  </div>
//  )}

//  {isEditingProfile ? (
//  <div className="space-y-4 border-t pt-4">
//  <div>
//  <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
//  <input
//  ref={fullNameRef}
//  id="fullName"
//  type="text"
//  defaultValue={userData.fullName}
//  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
//  placeholder="Enter your full name"
//  />
//  </div>
//  <div>
//  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
//  <input
//  ref={emailRef}
//  id="email"
//  type="email"
//  defaultValue={userData.email}
//  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
//  placeholder="Enter your email"
//  />
//  </div>
//  <div>
//  <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">Phone (10 digits only)</label>
//  <input
//  ref={phoneRef}
//  id="phone"
//  type="tel"
//  defaultValue={userData.phone}
//  onInput={handlePhoneInput}
//  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
//  placeholder="Enter your 10-digit phone number"
//  maxLength="10"
//  />
//  </div>
//  <div>
//  <label htmlFor="location" className="block text-sm font-medium text-gray-700 mb-1">Location</label>
//  <input
//  ref={locationRef}
//  id="location"
//  type="text"
//  defaultValue={userData.location}
//  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
//  placeholder="Enter your location"
//  />
//  </div>
//  <div className="flex space-x-3">
//  <button
//  onClick={handleProfileSave}
//  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//  className="px-4 py-2 text-white text-sm font-medium rounded-md transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
//  style={{ backgroundColor: '#21C1B6' }}
//  >
//  Save Changes
//  </button>
//  <button
//  onClick={() => setIsEditingProfile(false)}
//  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//  className="px-4 py-2 text-white text-sm font-medium rounded-md transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
//  style={{ backgroundColor: '#21C1B6' }}
//  >
//  Cancel
//  </button>
//  </div>
//  </div>
//  ) : (
//  <div className="space-y-3 border-t pt-4">
//  <div className="flex items-center text-sm">
//  <Mail className="w-4 h-4 text-gray-400 mr-3" />
//  <span className="text-gray-600">{userData.email || 'Not provided'}</span>
//  </div>
//                 <div className="flex items-center text-sm">
//                   <Phone className="w-4 h-4 text-gray-400 mr-3" />
//                   <span className="text-gray-600">{userData.phone || 'Not provided'}</span>
//                 </div>
//  </div>
//  )}
//  </div>
//  </SettingSection>

//  {/* Password Section */}
//  <SettingSection icon={Lock} title="Password & Security">
//  <div className="space-y-4">
//  <div className="flex items-center justify-between">
//  <div>
//  <div className="text-sm font-medium text-gray-900">Password</div>
//  <div className="text-sm text-gray-500">Update your account password</div>
//  </div>
//  <button
//  onClick={() => {
//  setIsEditingPassword(!isEditingPassword);
//  if (isEditingPassword) {
//  setPasswordValues({ current: '', new: '', confirm: '' });
//  }
//  }}
//  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//  className="px-4 py-2 text-sm font-medium text-white rounded-md transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
//  style={{ backgroundColor: '#21C1B6' }}
//  disabled={isUpdatingPassword}
//  >
//  {isEditingPassword ? 'Cancel' : 'Change Password'}
//  </button>
//  </div>

//  {isEditingPassword && (
//  <div className="space-y-4 border-t pt-4">
//  <div>
//  <label htmlFor="currentPassword" className="block text-sm font-medium text-gray-700 mb-1">
//  Current Password <span className="text-red-500">*</span>
//  </label>
//  <PasswordInput
//  key="current-password-input"
//  id="currentPassword"
//  placeholder="Enter current password"
//  value={passwordValues.current}
//  onChange={handleCurrentPasswordChange}
//  showPassword={showPasswords.current}
//  onToggle={() => togglePasswordVisibility('current')}
//  autoComplete="current-password"
//  disabled={isUpdatingPassword}
//  />
//  </div>
//  <div>
//  <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700 mb-1">
//  New Password <span className="text-red-500">*</span>
//  </label>
//  <PasswordInput
//  key="new-password-input"
//  id="newPassword"
//  placeholder="Enter new password (min. 6 characters)"
//  value={passwordValues.new}
//  onChange={handleNewPasswordChange}
//  showPassword={showPasswords.new}
//  onToggle={() => togglePasswordVisibility('new')}
//  autoComplete="new-password"
//  disabled={isUpdatingPassword}
//  />
//  <p className="mt-1 text-xs text-gray-500">
//  Password should contain uppercase, lowercase, and numbers for better security
//  </p>
//  </div>
//  <div>
//  <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
//  Confirm New Password <span className="text-red-500">*</span>
//  </label>
//  <PasswordInput
//  key="confirm-password-input"
//  id="confirmPassword"
//  placeholder="Confirm new password"
//  value={passwordValues.confirm}
//  onChange={handleConfirmPasswordChange}
//  showPassword={showPasswords.confirm}
//  onToggle={() => togglePasswordVisibility('confirm')}
//  autoComplete="new-password"
//  disabled={isUpdatingPassword}
//  />
//  </div>
//  <div className="flex space-x-3">
//  <button
//  onClick={handlePasswordSave}
//  disabled={isUpdatingPassword}
//  onMouseEnter={(e) => !isUpdatingPassword && (e.currentTarget.style.backgroundColor = '#1AA49B')}
//  onMouseLeave={(e) => !isUpdatingPassword && (e.currentTarget.style.backgroundColor = '#21C1B6')}
//  className="px-4 py-2 text-white text-sm font-medium rounded-md transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
//  style={{ backgroundColor: isUpdatingPassword ? '#9CA3AF' : '#21C1B6' }}
//  >
//  {isUpdatingPassword ? (
//  <span className="flex items-center">
//  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
//  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
//  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
//  </svg>
//  Updating...
//  </span>
//  ) : (
//  'Update Password'
//  )}
//  </button>
//  <button
//  onClick={() => {
//  setIsEditingPassword(false);
//  setPasswordValues({
//  current: '',
//  new: '',
//  confirm: ''
//  });
//  }}
//  disabled={isUpdatingPassword}
//  onMouseEnter={(e) => !isUpdatingPassword && (e.currentTarget.style.backgroundColor = '#1AA49B')}
//  onMouseLeave={(e) => !isUpdatingPassword && (e.currentTarget.style.backgroundColor = '#21C1B6')}
//  className="px-4 py-2 text-white text-sm font-medium rounded-md transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
//  style={{ backgroundColor: isUpdatingPassword ? '#9CA3AF' : '#21C1B6' }}
//  >
//  Cancel
//  </button>
//  </div>
//  </div>
//  )}
//  </div>
//  </SettingSection>

//  {/* Language & Region */}
//  <SettingSection icon={Globe} title="Language & Region">
//  <div className="space-y-4">
//  <div>
//  <label htmlFor="language" className="block text-sm font-medium text-gray-700 mb-2">Language</label>
//  <select
//  id="language"
//  value={language}
//  onChange={(e) => setLanguage(e.target.value)}
//  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
//  >
//  <option value="English">English</option>
//  <option value="Spanish">Español</option>
//  <option value="French">Français</option>
//  <option value="German">Deutsch</option>
//  <option value="Chinese">中文</option>
//  </select>
//  </div>
//  </div>
//  </SettingSection>

//  {/* Notifications */}
//  <SettingSection icon={Bell} title="Notifications">
//  <div className="space-y-1">
//  <ToggleSwitch
//  disabled={notifications.email}
//  onChange={() => handleNotificationChange('email')}
//  label="Email notifications"
//  description="Receive updates about your conversations via email"
//  />
//  <ToggleSwitch
//  disabled={notifications.push}
//  onChange={() => handleNotificationChange('push')}
//  label="Push notifications"
//  description="Get notified about important updates"
//  />
//  <ToggleSwitch
//  disabled={notifications.marketing}
//  onChange={() => handleNotificationChange('marketing')}
//  label="Marketing emails"
//  description="Receive product updates and feature announcements"
//  />
//  </div>
//  </SettingSection>

//  {/* Privacy & Security */}
//  <SettingSection icon={Shield} title="Privacy & Security">
//  <div className="space-y-3">
//  <div className="flex items-center justify-between py-3 border-b border-gray-100">
//  <div>
//  <div className="text-sm font-medium text-gray-900">Two-factor authentication</div>
//  <div className="text-sm text-gray-500">Add an extra layer of security</div>
//  </div>
//  <ChevronRight className="w-4 h-4 text-gray-400" />
//  </div>
//  <div className="flex items-center justify-between py-3 border-b border-gray-100">
//  <div>
//  <div className="text-sm font-medium text-gray-900">Login activity</div>
//  <div className="text-sm text-gray-500">See your recent login history</div>
//  </div>
//  <ChevronRight className="w-4 h-4 text-gray-400" />
//  </div>
//  <div className="flex items-center justify-between py-3">
//  <div>
//  <div className="text-sm font-medium text-gray-900">Connected apps</div>
//  <div className="text-sm text-gray-500">Manage third-party integrations</div>
//  </div>
//  <ChevronRight className="w-4 h-4 text-gray-400" />
//  </div>
//  </div>
//  </SettingSection>

//  {/* Data & Storage */}
//  <SettingSection icon={Download} title="Data & Storage">
//  <div className="space-y-3">
//  <button
//  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//  className="flex items-center justify-between w-full py-3 px-4 text-left text-white transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 rounded-md"
//  style={{ backgroundColor: '#21C1B6' }}
//  >
//  <div>
//  <div className="text-sm font-medium">Export data</div>
//  <div className="text-sm text-gray-100">Download your conversation history</div>
//  </div>
//  <Download className="w-4 h-4" />
//  </button>
//  <div className="border-t pt-3">
//  <button
//  onClick={handleDeleteAllConversations}
//  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#DC2626')}
//  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#EF4444')}
//  className="flex items-center text-white hover:text-gray-100 transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
//  style={{ backgroundColor: '#EF4444', padding: '0.5rem 1rem', borderRadius: '0.375rem' }}
//  >
//  <Trash2 className="w-4 h-4 mr-2" />
//  <span className="text-sm font-medium">Delete all conversations</span>
//  </button>
//  </div>
//  </div>
//  </SettingSection>

//  {/* Account Actions */}
//  <SettingSection icon={LogOut} title="Account Actions" className="border-red-200">
//  <div className="space-y-3">
//  <button
//  onClick={handleLogout}
//  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//  className="flex items-center text-white hover:text-gray-100 transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
//  style={{ backgroundColor: '#21C1B6', padding: '0.5rem 1rem', borderRadius: '0.375rem' }}
//  >
//  <LogOut className="w-4 h-4 mr-2" />
//  <span className="text-sm font-medium">Logout</span>
//  </button>
//  <div className="border-t pt-3">
//  <button
//  onClick={handleDeleteAccount}
//  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#DC2626')}
//  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#EF4444')}
//  className="flex items-center text-white hover:text-gray-100 transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
//  style={{ backgroundColor: '#EF4444', padding: '0.5rem 1rem', borderRadius: '0.375rem' }}
//  >
//  <Trash2 className="w-4 h-4 mr-2" />
//  <span className="text-sm font-medium">Delete account</span>
//  </button>
//  <p className="text-xs text-gray-500 mt-1">This action cannot be undone</p>
//  </div>
//  </div>
//  </SettingSection>

//  </div>
//  </div>
//  </div>
//  );
// };

// export default SettingsPage;

// // Password input component with stable focus
// const PasswordInput = React.memo(({ id, placeholder, value, onChange, showPassword, onToggle, autoComplete, disabled }) => {
//  const inputRef = useRef(null);

//  const handleToggle = (e) => {
//  e.preventDefault();
//  e.stopPropagation();
 
//  const input = inputRef.current;
//  const cursorPosition = input?.selectionStart;
 
//  onToggle();
 
//  requestAnimationFrame(() => {
//  input?.focus();
//  if (cursorPosition !== null && cursorPosition !== undefined) {
//  input.setSelectionRange(cursorPosition, cursorPosition);
//  }
//  });
//  };

//  return (
//  <div className="relative">
//  <input
//  ref={inputRef}
//  id={id}
//  type={showPassword ? 'text' : 'password'}
//  value={value}
//  onChange={(e) => onChange(e.target.value)}
//  className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed text-black"
//  placeholder={placeholder}
//  autoComplete={autoComplete}
//  maxLength={100}
//  spellCheck="false"
//  autoCapitalize="off"
//  autoCorrect="off"
//  disabled={disabled}
//  />
//  <button
//  type="button"
//  onClick={handleToggle}
//  onMouseDown={(e) => e.preventDefault()}
//  className="password-toggle-btn absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors duration-150 p-1 rounded focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:cursor-not-allowed"
//  aria-label={showPassword ? 'Hide password' : 'Show password'}
//  tabIndex={-1}
//  disabled={disabled}
//  >
//  {showPassword ? (
//  <EyeOff className="w-4 h-4" />
//  ) : (
//  <Eye className="w-4 h-4" />
//  )}
//  </button>
//  </div>
//  );
// });


import React, { useState, useEffect, useRef, useCallback } from 'react';
import { User, Mail, Phone, MapPin, Calendar, Shield, Bell, Palette, Globe, Download, Trash2, LogOut, ChevronRight, Check, Lock, Eye, EyeOff } from 'lucide-react';
import { useTheme } from '../context/ThemeContext.jsx';
import api from '../services/api';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import ProfileSetupForm from '../components/ProfileSetupForm';

// Password input component with stable focus - defined outside to prevent recreation
const PasswordInput = React.memo(({ id, placeholder, value, onChange, showPassword, onToggle, autoComplete, disabled }) => {
 const inputRef = useRef(null);

 const handleToggle = (e) => {
 e.preventDefault();
 e.stopPropagation();
 
 const input = inputRef.current;
 if (!input) return;
 
 // Save cursor position before state update
 const cursorPosition = input.selectionStart;
 const wasFocused = document.activeElement === input;
 
 // Call the toggle handler
 onToggle();
 
 // Restore focus and cursor position after state update
 // Use requestAnimationFrame to ensure it happens after React's render
 requestAnimationFrame(() => {
 if (input && wasFocused) {
 input.focus();
 if (cursorPosition !== null && cursorPosition !== undefined) {
 input.setSelectionRange(cursorPosition, cursorPosition);
 }
 }
 });
 };

 const handleChange = (e) => {
 const newValue = e.target.value;
 onChange(newValue);
 };

 return (
 <div className="relative">
 <input
 ref={inputRef}
 id={id}
 type={showPassword ? 'text' : 'password'}
 value={value}
 onChange={handleChange}
 className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed text-black"
 placeholder={placeholder}
 autoComplete={autoComplete}
 maxLength={100}
 spellCheck="false"
 autoCapitalize="off"
 autoCorrect="off"
 disabled={disabled}
 />
 <button
 type="button"
 onClick={handleToggle}
 onMouseDown={(e) => e.preventDefault()}
 className="password-toggle-btn absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors duration-150 p-1 rounded focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:cursor-not-allowed"
 aria-label={showPassword ? 'Hide password' : 'Show password'}
 tabIndex={-1}
 disabled={disabled}
 >
 {showPassword ? (
 <EyeOff className="w-4 h-4" />
 ) : (
 <Eye className="w-4 h-4" />
 )}
 </button>
 </div>
 );
}, (prevProps, nextProps) => {
 // Return true if props are equal (skip re-render), false if different (re-render)
 // We don't compare onChange and onToggle because they're stable memoized callbacks
 // and comparing function references would always return false
 return (
 prevProps.id === nextProps.id &&
 prevProps.value === nextProps.value &&
 prevProps.showPassword === nextProps.showPassword &&
 prevProps.disabled === nextProps.disabled &&
 prevProps.placeholder === nextProps.placeholder &&
 prevProps.autoComplete === nextProps.autoComplete
 );
});

PasswordInput.displayName = 'PasswordInput';

// Move SettingSection and ToggleSwitch outside to prevent recreation on every render
const SettingSection = React.memo(({ icon: Icon, title, children, className = "" }) => (
 <div className={`bg-white border border-gray-200 rounded-lg p-6 ${className}`}>
 <div className="flex items-center mb-4">
 <Icon className="w-5 h-5 text-gray-600 mr-3" />
 <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
 </div>
 {children}
 </div>
));

SettingSection.displayName = 'SettingSection';

const ToggleSwitch = React.memo(({ enabled, onChange, label, description }) => (
 <div className="flex items-center justify-between py-3">
 <div className="flex-1">
 <div className="text-sm font-medium text-gray-900">{label}</div>
 {description && <div className="text-sm text-gray-500">{description}</div>}
 </div>
 <button
 onClick={onChange}
 className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
 enabled ? 'bg-green-600' : 'bg-gray-200'
 }`}
 >
 <span
 className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
 enabled ? 'translate-x-6' : 'translate-x-1'
 }`}
 />
 </button>
 </div>
));

ToggleSwitch.displayName = 'ToggleSwitch';

const SettingsPage = () => {
 const { theme, toggleTheme } = useTheme();
 const [language, setLanguage] = useState('English');
 const [notifications, setNotifications] = useState({
 email: true,
 push: false,
 marketing: false
 });

 // User data state
 const [userData, setUserData] = useState({
 fullName: '',
 email: '',
 phone: '',
 location: '',
 joinDate: ''
 });

 const [loading, setLoading] = useState(true);
 const [error, setError] = useState(null);
 const [isEditingProfile, setIsEditingProfile] = useState(false);
 const [isEditingPassword, setIsEditingPassword] = useState(false);
 const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
 const [showProfileSetup, setShowProfileSetup] = useState(false);

 // Password visibility state only
 const [showPasswords, setShowPasswords] = useState({
 current: false,
 new: false,
 confirm: false
 });

 // Password values state (controlled approach)
 const [passwordValues, setPasswordValues] = useState({
 current: '',
 new: '',
 confirm: ''
 });

 // Memoized onChange handlers for password inputs
 const handleCurrentPasswordChange = useCallback((value) => {
 setPasswordValues(prev => ({ ...prev, current: value }));
 }, []);

 const handleNewPasswordChange = useCallback((value) => {
 setPasswordValues(prev => ({ ...prev, new: value }));
 }, []);

 const handleConfirmPasswordChange = useCallback((value) => {
 setPasswordValues(prev => ({ ...prev, confirm: value }));
 }, []);

 // Refs for profile inputs only (uncontrolled approach)
 const fullNameRef = useRef(null);
 const emailRef = useRef(null);
 const phoneRef = useRef(null);
 const locationRef = useRef(null);

 const handleThemeChange = (newTheme) => {
 toggleTheme(newTheme);
 };

 const handleNotificationChange = (type) => {
 setNotifications(prev => ({
 ...prev,
 [type]: !prev[type]
 }));
 };

 const handleProfileSave = async () => {
 const formData = {
 fullname: fullNameRef.current?.value || '',
 email: emailRef.current?.value || '',
 phone: phoneRef.current?.value || '',
 location: locationRef.current?.value || ''
 };

 try {
 const updatedUser = await api.updateProfile(formData);
 
 setUserData(prev => ({
 ...prev,
 fullName: updatedUser.user.username || formData.fullname,
 email: updatedUser.user.email || formData.email,
 phone: updatedUser.user.phone || formData.phone,
 location: updatedUser.user.location || formData.location
 }));
 
 setIsEditingProfile(false);
 toast.success('Profile updated successfully!');
 } catch (err) {
 console.error('Error updating profile:', err);
 toast.error(err.response?.data?.message || 'Failed to update profile.');
 }
 };

 const handlePasswordSave = async () => {
 const currentPassword = passwordValues.current.trim();
 const newPassword = passwordValues.new.trim();
 const confirmPassword = passwordValues.confirm.trim();

 // Validation checks
 if (!currentPassword || !newPassword || !confirmPassword) {
 toast.error('Please fill in all password fields.');
 return;
 }

 if (newPassword !== confirmPassword) {
 toast.error('New passwords do not match.');
 return;
 }

 if (newPassword.length < 6) {
 toast.error('New password must be at least 6 characters long.');
 return;
 }

 if (currentPassword === newPassword) {
 toast.error('New password must be different from current password.');
 return;
 }

 // Check password strength (optional additional validation)
 const hasUpperCase = /[A-Z]/.test(newPassword);
 const hasLowerCase = /[a-z]/.test(newPassword);
 const hasNumber = /[0-9]/.test(newPassword);
 
 if (!hasUpperCase || !hasLowerCase || !hasNumber) {
 toast.warning('For better security, use a mix of uppercase, lowercase, and numbers.');
 }

 try {
 setIsUpdatingPassword(true);
 
 const response = await api.updatePassword({
 currentPassword: currentPassword,
 newPassword: newPassword,
 confirmPassword: confirmPassword,
 });
 
 // Clear password fields
 setPasswordValues({
 current: '',
 new: '',
 confirm: ''
 });
 
 // Close editing mode
 setIsEditingPassword(false);
 
 // Show success message
 toast.success(response.message || 'Password updated successfully!');
 
 } catch (err) {
 console.error('Error updating password:', err);
 
 // Handle specific error cases
 if (err.response?.status === 401) {
 toast.error('Current password is incorrect. Please try again.');
 } else if (err.response?.status === 400) {
 toast.error(err.response?.data?.message || 'Invalid password format.');
 } else if (err.response?.status === 500) {
 toast.error('Server error. Please try again later.');
 } else {
 toast.error(err.response?.data?.message || 'Failed to update password. Please try again.');
 }
 } finally {
 setIsUpdatingPassword(false);
 }
 };

 // Memoized toggle handlers for password visibility
 const toggleCurrentPasswordVisibility = useCallback(() => {
 setShowPasswords(prev => ({ ...prev, current: !prev.current }));
 }, []);

 const toggleNewPasswordVisibility = useCallback(() => {
 setShowPasswords(prev => ({ ...prev, new: !prev.new }));
 }, []);

 const toggleConfirmPasswordVisibility = useCallback(() => {
 setShowPasswords(prev => ({ ...prev, confirm: !prev.confirm }));
 }, []);

 const handleDeleteAccount = async () => {
 try {
 await api.deleteAccount();
//  toast.success('Account deleted successfully. You will be logged out.');
 setTimeout(() => {
 handleLogout();
 }, 2000);
 } catch (err) {
 console.error('Error deleting account:', err);
//  toast.error(err.response?.data?.message || 'Failed to delete account.');
 }
 };

 const handleDeleteAllConversations = async () => {
   try {
     // Assuming there's an API call to delete all conversations
     // If not, you'll need to implement this API call in your services/api.js
     await api.deleteAllConversations(); // This needs to be implemented in api.js
    //  toast.success('All conversations deleted successfully!');
   } catch (err) {
     console.error('Error deleting all conversations:', err);
    //  toast.error(err.response?.data?.message || 'Failed to delete all conversations.');
   }
 };

 const handleLogout = async () => {
 try {
 // Call the logout API endpoint to invalidate the session token
 await api.logoutUser();
 
 // Clear local storage
 api.logout();
 
 // Show success message
 toast.success('Logged out successfully!');
 
 // Redirect to login page
 setTimeout(() => {
 window.location.href = '/login';
 }, 1000);
 } catch (err) {
 console.error('Error logging out:', err);
 // Even if the API call fails, still clear local storage and redirect
 api.logout();
 toast.success('Logged out successfully!');
 setTimeout(() => {
 window.location.href = '/login';
 }, 1000);
 }
 };

 const handlePhoneInput = (e) => {
 const value = e.target.value.replace(/\D/g, '');
 if (value.length <= 10) {
 e.target.value = value;
 } else {
 e.target.value = value.slice(0, 10);
 }
 };

 useEffect(() => {
 const fetchUserProfile = async () => {
 try {
 setLoading(true);
 const response = await api.fetchProfile();
 const user = response.user;
 
 setUserData({
 fullName: user.username || '',
 email: user.email || '',
 phone: user.phone || '',
 location: user.location || '',
 joinDate: user.created_at ? new Date(user.created_at).toLocaleDateString('en-US', {
 year: 'numeric',
 month: 'long',
 day: 'numeric'
 }) : 'N/A'
 });
 } catch (err) {
 setError('Failed to fetch user profile.');
 console.error('Error fetching profile:', err);
 toast.error('Failed to load profile data.');
 } finally {
 setLoading(false);
 }
 };

 fetchUserProfile();
 }, []);

 if (loading) {
 return (
 <div className="min-h-screen flex items-center justify-center bg-gray-50">
 <div className="text-center">
 <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
 <p className="mt-4 text-gray-600">Loading settings...</p>
 </div>
 </div>
 );
 }

 if (error) {
 return (
 <div className="min-h-screen flex items-center justify-center bg-gray-50">
 <div className="text-center">
 <p className="text-red-600 text-lg">{error}</p>
 <button
 onClick={() => window.location.reload()}
 className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
 >
 Retry
 </button>
 </div>
 </div>
 );
 }


 return (
 <div className="min-h-screen bg-gray-50">
 <ToastContainer
 position="top-right"
 autoClose={5000}
 hideProgressBar={false}
 newestOnTop
 closeOnClick
 rtl={false}
 pauseOnFocusLoss
 draggable
 pauseOnHover
 theme="light"
 />
 
 {/* Header */}
 <div className="bg-white border-b border-gray-200">
 <div className="max-w-4xl mx-auto px-6 py-6">
 <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
 <p className="text-gray-600 mt-1">Manage your account and application preferences</p>
 </div>
 </div>

 <div className="max-w-4xl mx-auto px-6 py-8">
 <div className="space-y-6">
 
 {/* Account Section */}
 <SettingSection icon={User} title="Account">
 <div className="space-y-4">
 <div className="flex items-center justify-between">
 <div className="flex items-center space-x-4">
 <div
 className="w-12 h-12 rounded-full flex items-center justify-center text-white font-medium shadow-lg transition-colors duration-200 transform hover:-translate-y-0.5 hover:shadow-xl"
 style={{ backgroundColor: '#21C1B6' }}
 onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
 onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
 >
 <User className="w-6 h-6" />
 </div>
 <div>
 <div className="font-medium text-gray-900">{userData.fullName}</div>
 <div className="text-sm text-gray-500">Joined {userData.joinDate}</div>
 </div>
 </div>
 <button
 onClick={() => setShowProfileSetup(!showProfileSetup)}
 onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
 onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
 className="px-4 py-2 text-sm font-medium text-white rounded-md transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
 style={{ backgroundColor: '#21C1B6' }}
 >
 {showProfileSetup ? 'Hide Profile Setup' : 'Complete Profile Setup'}
 </button>
 </div>

 {showProfileSetup && (
 <div className="border-t pt-6 mt-6">
 <ProfileSetupForm
 onSave={() => {
 setShowProfileSetup(false);
 window.dispatchEvent(new CustomEvent('userInfoUpdated'));
 toast.success('Profile updated successfully!');
 }}
 />
 </div>
 )}

 {isEditingProfile ? (
 <div className="space-y-4 border-t pt-4">
 <div>
 <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
 <input
 ref={fullNameRef}
 id="fullName"
 type="text"
 defaultValue={userData.fullName}
 className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
 placeholder="Enter your full name"
 />
 </div>
 <div>
 <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
 <input
 ref={emailRef}
 id="email"
 type="email"
 defaultValue={userData.email}
 className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
 placeholder="Enter your email"
 />
 </div>
 <div>
 <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">Phone (10 digits only)</label>
 <input
 ref={phoneRef}
 id="phone"
 type="tel"
 defaultValue={userData.phone}
 onInput={handlePhoneInput}
 className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
 placeholder="Enter your 10-digit phone number"
 maxLength="10"
 />
 </div>
 <div>
 <label htmlFor="location" className="block text-sm font-medium text-gray-700 mb-1">Location</label>
 <input
 ref={locationRef}
 id="location"
 type="text"
 defaultValue={userData.location}
 className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
 placeholder="Enter your location"
 />
 </div>
 <div className="flex space-x-3">
 <button
 onClick={handleProfileSave}
 onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
 onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
 className="px-4 py-2 text-white text-sm font-medium rounded-md transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
 style={{ backgroundColor: '#21C1B6' }}
 >
 Save Changes
 </button>
 <button
 onClick={() => setIsEditingProfile(false)}
 onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
 onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
 className="px-4 py-2 text-white text-sm font-medium rounded-md transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
 style={{ backgroundColor: '#21C1B6' }}
 >
 Cancel
 </button>
 </div>
 </div>
 ) : (
 <div className="space-y-3 border-t pt-4">
 <div className="flex items-center text-sm">
 <Mail className="w-4 h-4 text-gray-400 mr-3" />
 <span className="text-gray-600">{userData.email || 'Not provided'}</span>
 </div>
                <div className="flex items-center text-sm">
                  <Phone className="w-4 h-4 text-gray-400 mr-3" />
                  <span className="text-gray-600">{userData.phone || 'Not provided'}</span>
                </div>
 </div>
 )}
 </div>
 </SettingSection>

 {/* Password Section */}
 <SettingSection icon={Lock} title="Password & Security">
 <div className="space-y-4">
 <div className="flex items-center justify-between">
 <div>
 <div className="text-sm font-medium text-gray-900">Password</div>
 <div className="text-sm text-gray-500">Update your account password</div>
 </div>
 <button
 onClick={() => {
 setIsEditingPassword(!isEditingPassword);
 if (isEditingPassword) {
 setPasswordValues({ current: '', new: '', confirm: '' });
 }
 }}
 onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
 onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
 className="px-4 py-2 text-sm font-medium text-white rounded-md transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
 style={{ backgroundColor: '#21C1B6' }}
 disabled={isUpdatingPassword}
 >
 {isEditingPassword ? 'Cancel' : 'Change Password'}
 </button>
 </div>

 {isEditingPassword && (
 <div className="space-y-4 border-t pt-4">
 <div>
 <label htmlFor="currentPassword" className="block text-sm font-medium text-gray-700 mb-1">
 Current Password <span className="text-red-500">*</span>
 </label>
 <PasswordInput
 id="currentPassword"
 placeholder="Enter current password"
 value={passwordValues.current}
 onChange={handleCurrentPasswordChange}
 showPassword={showPasswords.current}
 onToggle={toggleCurrentPasswordVisibility}
 autoComplete="current-password"
 disabled={isUpdatingPassword}
 />
 </div>
 <div>
 <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700 mb-1">
 New Password <span className="text-red-500">*</span>
 </label>
 <PasswordInput
 id="newPassword"
 placeholder="Enter new password (min. 6 characters)"
 value={passwordValues.new}
 onChange={handleNewPasswordChange}
 showPassword={showPasswords.new}
 onToggle={toggleNewPasswordVisibility}
 autoComplete="new-password"
 disabled={isUpdatingPassword}
 />
 <p className="mt-1 text-xs text-gray-500">
 Password should contain uppercase, lowercase, and numbers for better security
 </p>
 </div>
 <div>
 <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
 Confirm New Password <span className="text-red-500">*</span>
 </label>
 <PasswordInput
 id="confirmPassword"
 placeholder="Confirm new password"
 value={passwordValues.confirm}
 onChange={handleConfirmPasswordChange}
 showPassword={showPasswords.confirm}
 onToggle={toggleConfirmPasswordVisibility}
 autoComplete="new-password"
 disabled={isUpdatingPassword}
 />
 </div>
 <div className="flex space-x-3">
 <button
 onClick={handlePasswordSave}
 disabled={isUpdatingPassword}
 onMouseEnter={(e) => !isUpdatingPassword && (e.currentTarget.style.backgroundColor = '#1AA49B')}
 onMouseLeave={(e) => !isUpdatingPassword && (e.currentTarget.style.backgroundColor = '#21C1B6')}
 className="px-4 py-2 text-white text-sm font-medium rounded-md transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
 style={{ backgroundColor: isUpdatingPassword ? '#9CA3AF' : '#21C1B6' }}
 >
 {isUpdatingPassword ? (
 <span className="flex items-center">
 <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
 <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
 <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
 </svg>
 Updating...
 </span>
 ) : (
 'Update Password'
 )}
 </button>
 <button
 onClick={() => {
 setIsEditingPassword(false);
 setPasswordValues({
 current: '',
 new: '',
 confirm: ''
 });
 }}
 disabled={isUpdatingPassword}
 onMouseEnter={(e) => !isUpdatingPassword && (e.currentTarget.style.backgroundColor = '#1AA49B')}
 onMouseLeave={(e) => !isUpdatingPassword && (e.currentTarget.style.backgroundColor = '#21C1B6')}
 className="px-4 py-2 text-white text-sm font-medium rounded-md transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
 style={{ backgroundColor: isUpdatingPassword ? '#9CA3AF' : '#21C1B6' }}
 >
 Cancel
 </button>
 </div>
 </div>
 )}
 </div>
 </SettingSection>

 {/* Language & Region */}
 <SettingSection icon={Globe} title="Language & Region">
 <div className="space-y-4">
 <div>
 <label htmlFor="language" className="block text-sm font-medium text-gray-700 mb-2">Language</label>
 <select
 id="language"
 value={language}
 onChange={(e) => setLanguage(e.target.value)}
 className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
 >
 <option value="English">English</option>
 <option value="Spanish">Español</option>
 <option value="French">Français</option>
 <option value="German">Deutsch</option>
 <option value="Chinese">中文</option>
 </select>
 </div>
 </div>
 </SettingSection>

 {/* Notifications */}
 <SettingSection icon={Bell} title="Notifications">
 <div className="space-y-1">
 <ToggleSwitch
 disabled={notifications.email}
 onChange={() => handleNotificationChange('email')}
 label="Email notifications"
 description="Receive updates about your conversations via email"
 />
 <ToggleSwitch
 disabled={notifications.push}
 onChange={() => handleNotificationChange('push')}
 label="Push notifications"
 description="Get notified about important updates"
 />
 <ToggleSwitch
 disabled={notifications.marketing}
 onChange={() => handleNotificationChange('marketing')}
 label="Marketing emails"
 description="Receive product updates and feature announcements"
 />
 </div>
 </SettingSection>

 {/* Privacy & Security */}
 <SettingSection icon={Shield} title="Privacy & Security">
 <div className="space-y-3">
 <div className="flex items-center justify-between py-3 border-b border-gray-100">
 <div>
 <div className="text-sm font-medium text-gray-900">Two-factor authentication</div>
 <div className="text-sm text-gray-500">Add an extra layer of security</div>
 </div>
 <ChevronRight className="w-4 h-4 text-gray-400" />
 </div>
 <div className="flex items-center justify-between py-3 border-b border-gray-100">
 <div>
 <div className="text-sm font-medium text-gray-900">Login activity</div>
 <div className="text-sm text-gray-500">See your recent login history</div>
 </div>
 <ChevronRight className="w-4 h-4 text-gray-400" />
 </div>
 <div className="flex items-center justify-between py-3">
 <div>
 <div className="text-sm font-medium text-gray-900">Connected apps</div>
 <div className="text-sm text-gray-500">Manage third-party integrations</div>
 </div>
 <ChevronRight className="w-4 h-4 text-gray-400" />
 </div>
 </div>
 </SettingSection>

 {/* Data & Storage */}
 <SettingSection icon={Download} title="Data & Storage">
 <div className="space-y-3">
 <button
 onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
 onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
 className="flex items-center justify-between w-full py-3 px-4 text-left text-white transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 rounded-md"
 style={{ backgroundColor: '#21C1B6' }}
 >
 <div>
 <div className="text-sm font-medium">Export data</div>
 <div className="text-sm text-gray-100">Download your conversation history</div>
 </div>
 <Download className="w-4 h-4" />
 </button>
 <div className="border-t pt-3">
 <button
 onClick={handleDeleteAllConversations}
 onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#DC2626')}
 onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#EF4444')}
 className="flex items-center text-white hover:text-gray-100 transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
 style={{ backgroundColor: '#EF4444', padding: '0.5rem 1rem', borderRadius: '0.375rem' }}
 >
 <Trash2 className="w-4 h-4 mr-2" />
 <span className="text-sm font-medium">Delete all conversations</span>
 </button>
 </div>
 </div>
 </SettingSection>

 {/* Account Actions */}
 <SettingSection icon={LogOut} title="Account Actions" className="border-red-200">
 <div className="space-y-3">
 <button
 onClick={handleLogout}
 onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
 onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
 className="flex items-center text-white hover:text-gray-100 transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
 style={{ backgroundColor: '#21C1B6', padding: '0.5rem 1rem', borderRadius: '0.375rem' }}
 >
 <LogOut className="w-4 h-4 mr-2" />
 <span className="text-sm font-medium">Logout</span>
 </button>
 <div className="border-t pt-3">
 <button
 onClick={handleDeleteAccount}
 onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#DC2626')}
 onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#EF4444')}
 className="flex items-center text-white hover:text-gray-100 transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
 style={{ backgroundColor: '#EF4444', padding: '0.5rem 1rem', borderRadius: '0.375rem' }}
 >
 <Trash2 className="w-4 h-4 mr-2" />
 <span className="text-sm font-medium">Delete account</span>
 </button>
 <p className="text-xs text-gray-500 mt-1">This action cannot be undone</p>
 </div>
 </div>
 </SettingSection>

 </div>
 </div>
 </div>
 );
};

export default SettingsPage;