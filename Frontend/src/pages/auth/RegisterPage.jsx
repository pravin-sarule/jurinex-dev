// import React, { useState } from 'react';
// import { Link, useNavigate } from 'react-router-dom';
// import { toast } from 'react-toastify';
// import 'react-toastify/dist/ReactToastify.css';
// import { registerUser } from '../../api';
// import { Eye, EyeOff, Shield, User, Mail, Lock, Check, X } from 'lucide-react';
// import PublicLayout from '../../layouts/PublicLayout';

// const RegisterPage = () => {
//   const [formData, setFormData] = useState({
//     username: '',
//     email: '',
//     password: '',
//     confirmPassword: '',
//   });

//   const [errors, setErrors] = useState({});
//   const [showPassword, setShowPassword] = useState(false);
//   const [showConfirmPassword, setShowConfirmPassword] = useState(false);

//   const navigate = useNavigate();

//   const validateUsername = (username) => {
//     if (!username) return 'Username is required.';
//     if (username.length < 3) return 'Username must be at least 3 characters.';
//     return '';
//   };

//   const validateEmail = (email) => {
//     if (!email) return 'Email is required.';
//     if (!/\S+@\S+\.\S+/.test(email)) return 'Email address is invalid.';
//     return '';
//   };

//   const getPasswordStrength = (password) => {
//     let score = 0;
//     if (password.length >= 8) score++; // Minimum length
//     if (/[a-z]/.test(password)) score++; // Lowercase
//     if (/[A-Z]/.test(password)) score++; // Uppercase
//     if (/[0-9]/.test(password)) score++; // Numbers
//     if (/[^A-Za-z0-9]/.test(password)) score++; // Special characters
//     return score;
//   };

//   const validatePassword = (password) => {
//     if (!password) return 'Password is required.';
//     const strength = getPasswordStrength(password);
//     if (strength < 4) return 'Password is too weak. Must include at least 8 characters, mixed case, numbers, and special characters.';
//     return '';
//   };

//   const validateConfirmPassword = (confirmPassword, password) => {
//     if (!confirmPassword) return 'Confirm Password is required.';
//     if (confirmPassword !== password) return 'Passwords do not match.';
//     return '';
//   };

//   const handleChange = (e) => {
//     const { name, value } = e.target;
//     setFormData({
//       ...formData,
//       [name]: value,
//     });

//     // Real-time validation feedback
//     if (name === 'username') {
//       setErrors((prevErrors) => ({
//         ...prevErrors,
//         username: validateUsername(value),
//       }));
//     } else if (name === 'email') {
//       setErrors((prevErrors) => ({
//         ...prevErrors,
//         email: validateEmail(value),
//       }));
//     } else if (name === 'password') {
//       setErrors((prevErrors) => ({
//         ...prevErrors,
//         password: validatePassword(value),
//       }));
//       setErrors((prevErrors) => ({
//         ...prevErrors,
//         confirmPassword: validateConfirmPassword(formData.confirmPassword, value),
//       }));
//     } else if (name === 'confirmPassword') {
//       setErrors((prevErrors) => ({
//         ...prevErrors,
//         confirmPassword: validateConfirmPassword(value, formData.password),
//       }));
//     }
//   };

//   const handleSubmit = async (e) => {
//     e.preventDefault();
//     const usernameError = validateUsername(formData.username);
//     const emailError = validateEmail(formData.email);
//     const passwordError = validatePassword(formData.password);
//     const confirmPasswordError = validateConfirmPassword(formData.confirmPassword, formData.password);

//     setErrors({
//       username: usernameError,
//       email: emailError,
//       password: passwordError,
//       confirmPassword: confirmPasswordError,
//     });

//     if (usernameError || emailError || passwordError || confirmPasswordError) {
//       return;
//     }

//     try {
//       const res = await registerUser({
//         username: formData.username,
//         email: formData.email,
//         password: formData.password,
//       });

//       if (res.status === 201) {
//         toast.success('Registration successful!');
//         navigate('/login');
//       } else {
//         toast.error(res.data.message || 'Registration failed.');
//       }
//     } catch (error) {
//       toast.error(error.response?.data?.message || 'Network error. Please try again later.');
//     }
//   };

//   const getStrengthColor = () => {
//     const strength = getPasswordStrength(formData.password);
//     if (strength <= 2) return 'bg-red-500';
//     if (strength <= 3) return 'bg-yellow-500';
//     return 'bg-green-500';
//   };

//   const getStrengthText = () => {
//     const strength = getPasswordStrength(formData.password);
//     if (strength <= 2) return 'Weak';
//     if (strength <= 3) return 'Medium';
//     return 'Strong';
//   };

//   return (
//     <PublicLayout>
//       <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
//         <div className="max-w-md w-full space-y-8 p-10 bg-white rounded-xl shadow-lg z-10">
//           <div className="text-center">
//             <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-700 rounded-xl mb-4 shadow-lg">
//               <Shield className="w-8 h-8 text-white" />
//             </div>
//             <h2 className="mt-6 text-3xl font-semibold text-gray-800">
//               Create your account
//             </h2>
//             <p className="mt-2 text-sm text-gray-600">
//               Or <Link to="/login" className="font-medium text-gray-700 hover:text-gray-800">log in to your existing account</Link>
//             </p>
//           </div>
//           <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
//             <div className="rounded-md shadow-sm -space-y-px">
//               {/* Username Field */}
//               <div>
//                 <label htmlFor="username" className="sr-only">Username</label>
//                 <input
//                   id="username"
//                   name="username"
//                   type="text"
//                   autoComplete="username"
//                   required
//                   className={`appearance-none rounded-none relative block w-full px-3 py-2 border ${errors.username ? 'border-red-500' : 'border-gray-300'} placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-gray-500 focus:border-gray-500 focus:z-10 sm:text-sm`}
//                   placeholder="Username"
//                   value={formData.username}
//                   onChange={handleChange}
//                 />
//                 {errors.username && <p className="mt-2 text-sm text-red-600">{errors.username}</p>}
//               </div>
//               {/* Email Field */}
//               <div className="mt-4">
//                 <label htmlFor="email-address" className="sr-only">Email address</label>
//                 <input
//                   id="email-address"
//                   name="email"
//                   type="email"
//                   autoComplete="email"
//                   required
//                   className={`appearance-none rounded-none relative block w-full px-3 py-2 border ${errors.email ? 'border-red-500' : 'border-gray-300'} placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-gray-500 focus:border-gray-500 focus:z-10 sm:text-sm`}
//                   placeholder="Email address"
//                   value={formData.email}
//                   onChange={handleChange}
//                 />
//                 {errors.email && <p className="mt-2 text-sm text-red-600">{errors.email}</p>}
//               </div>
//               {/* Password Field */}
//               <div className="mt-4">
//                 <label htmlFor="password" className="sr-only">Password</label>
//                 <div className="relative">
//                   <input
//                     id="password"
//                     name="password"
//                     type={showPassword ? 'text' : 'password'}
//                     autoComplete="new-password"
//                     required
//                     className={`appearance-none rounded-none relative block w-full px-3 py-2 border ${errors.password ? 'border-red-500' : 'border-gray-300'} placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-gray-500 focus:border-gray-500 focus:z-10 sm:text-sm`}
//                     placeholder="Password"
//                     value={formData.password}
//                     onChange={handleChange}
//                   />
//                   <span
//                     className="absolute inset-y-0 right-0 pr-3 flex items-center cursor-pointer"
//                     onClick={() => setShowPassword(!showPassword)}
//                   >
//                     {showPassword ? (
//                       <EyeOff className="h-5 w-5 text-gray-400" />
//                     ) : (
//                       <Eye className="h-5 w-5 text-gray-400" />
//                     )}
//                   </span>
//                 </div>
//                 {formData.password && (
//                   <div className="mt-2">
//                     <div className="flex items-center space-x-2 mb-1">
//                       <div className="flex-1 bg-gray-200 rounded-full h-2">
//                         <div
//                           className={`h-2 rounded-full transition-all duration-300 ${getStrengthColor()}`}
//                           style={{ width: `${(getPasswordStrength(formData.password) / 5) * 100}%` }}
//                         ></div>
//                       </div>
//                       <span className={`text-xs font-medium ${
//                         getPasswordStrength(formData.password) <= 2 ? 'text-red-600' :
//                         getPasswordStrength(formData.password) <= 3 ? 'text-yellow-600' : 'text-green-600'
//                       }`}>
//                         {getStrengthText()}
//                       </span>
//                     </div>
//                     <div className="text-xs text-gray-500 space-y-1">
//                       <div className="flex items-center space-x-2">
//                         {formData.password.length >= 8 ?
//                           <Check className="w-3 h-3 text-green-500" /> :
//                           <X className="w-3 h-3 text-red-500" />
//                         }
//                         <span>At least 8 characters</span>
//                       </div>
//                       <div className="flex items-center space-x-2">
//                         {/[A-Z]/.test(formData.password) && /[a-z]/.test(formData.password) ?
//                           <Check className="w-3 h-3 text-green-500" /> :
//                           <X className="w-3 h-3 text-red-500" />
//                         }
//                         <span>Mixed case letters</span>
//                       </div>
//                       <div className="flex items-center space-x-2">
//                         {/[0-9]/.test(formData.password) ?
//                           <Check className="w-3 h-3 text-green-500" /> :
//                           <X className="w-3 h-3 text-red-500" />
//                         }
//                         <span>Contains numbers</span>
//                       </div>
//                       <div className="flex items-center space-x-2">
//                         {/[^A-Za-z0-9]/.test(formData.password) ?
//                           <Check className="w-3 h-3 text-green-500" /> :
//                           <X className="w-3 h-3 text-red-500" />
//                         }
//                         <span>Contains special characters</span>
//                       </div>
//                     </div>
//                   </div>
//                 )}
//                 {errors.password && <p className="mt-2 text-sm text-red-600">{errors.password}</p>}
//               </div>
//               {/* Confirm Password Field */}
//               <div className="mt-4">
//                 <label htmlFor="confirm-password" className="sr-only">Confirm Password</label>
//                 <div className="relative">
//                   <input
//                     id="confirm-password"
//                     name="confirmPassword"
//                     type={showConfirmPassword ? 'text' : 'password'}
//                     autoComplete="new-password"
//                     required
//                     className={`appearance-none rounded-none relative block w-full px-3 py-2 border ${errors.confirmPassword ? 'border-red-500' : 'border-gray-300'} placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-gray-500 focus:border-gray-500 focus:z-10 sm:text-sm`}
//                     placeholder="Confirm Password"
//                     value={formData.confirmPassword}
//                     onChange={handleChange}
//                   />
//                   <span
//                     className="absolute inset-y-0 right-0 pr-3 flex items-center cursor-pointer"
//                     onClick={() => setShowConfirmPassword(!showConfirmPassword)}
//                   >
//                     {showConfirmPassword ? (
//                       <EyeOff className="h-5 w-5 text-gray-400" />
//                     ) : (
//                       <Eye className="h-5 w-5 text-gray-400" />
//                     )}
//                   </span>
//                 </div>
//                 {errors.confirmPassword && <p className="mt-2 text-sm text-red-600">{errors.confirmPassword}</p>}
//               </div>
//             </div>

//             <div>
//               <button
//                 type="submit"
//                 className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-gray-700 hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
//               >
//                 Register
//               </button>
//             </div>
//           </form>
//         </div>
//       </div>
//     </PublicLayout>
//   );
// };

// export default RegisterPage;

// import React, { useState } from 'react';
// import { Eye, EyeOff, Check, X, Loader2 } from 'lucide-react';
// import { registerUser } from '../../api';

// const RegisterPage = () => {
//  const [fullName, setFullName] = useState('');
//  const [email, setEmail] = useState('');
//  const [phone, setPhone] = useState('');
//  const [password, setPassword] = useState('');
//  const [confirmPassword, setConfirmPassword] = useState('');
//  const [agreeTerms, setAgreeTerms] = useState(false);
//  const [consentData, setConsentData] = useState(false);
//  const [showPassword, setShowPassword] = useState(false);
//  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
//  const [isLoading, setIsLoading] = useState(false);
//  const [error, setError] = useState('');
//  const [validationErrors, setValidationErrors] = useState({});

//  const getPasswordStrength = (password) => {
//  const strength = {
//  length: password.length >= 8,
//  uppercase: /[A-Z]/.test(password),
//  number: /[0-9]/.test(password),
//  specialChar: /[!@#$%^&*(),.?":{}|<>]/.test(password),
//  };
 
//  const count = Object.values(strength).filter(Boolean).length;
//  let level = 'Weak';
//  if (count === 4) level = 'Strong';
//  else if (count >= 2) level = 'Medium';
 
//  return { ...strength, level, count };
//  };

//  const passwordStrength = getPasswordStrength(password);

//  const validateForm = () => {
//  const errors = {};
 
//  if (!fullName.trim()) {
//  errors.fullName = 'Full name is required';
//  }
 
//  if (!email.trim()) {
//  errors.email = 'Email is required';
//  } else if (!/\S+@\S+\.\S+/.test(email)) {
//  errors.email = 'Email is invalid';
//  }
 
//  if (!phone.trim()) {
//  errors.phone = 'Phone number is required';
//  } else if (!/^\d{10}$/.test(phone)) {
//  errors.phone = 'Phone number must be 10 digits';
//  }
 
//  if (!password) {
//  errors.password = 'Password is required';
//  } else if (passwordStrength.count < 4) {
//  errors.password = 'Password must meet all requirements';
//  }
 
//  if (!confirmPassword) {
//  errors.confirmPassword = 'Please confirm your password';
//  } else if (password !== confirmPassword) {
//  errors.confirmPassword = 'Passwords do not match';
//  }
 
//  if (!agreeTerms) {
//  errors.agreeTerms = 'You must agree to the Terms & Conditions';
//  }
 
//  if (!consentData) {
//  errors.consentData = 'You must consent to data processing';
//  }
 
//  setValidationErrors(errors);
//  return Object.keys(errors).length === 0;
//  };

//  const handleRegister = async () => {
//  setError('');
//  setValidationErrors({});
 
//  if (!validateForm()) {
//  return;
//  }
 
//  setIsLoading(true);
 
//  try {
//  const data = await registerUser({
//  username: fullName,
//  email: email,
//  password: password,
//  });
 
//  if (data.token) {
//  console.log('Registration successful, token received');
//  }
 
//  alert('Registration successful! Redirecting to dashboard...');
//  window.location.href = '/dashboard';
 
//  } catch (err) {
//  console.error('Registration error:', err);
//  setError(err.message || 'An error occurred during registration. Please try again.');
//  } finally {
//  setIsLoading(false);
//  }
//  };

//  return (
//  <div className="min-h-screen flex flex-col lg:flex-row font-sans">
//  {/* Left Section - Registration Form */}
//  <div className="w-full lg:w-1/2 bg-white flex items-center justify-center p-4 sm:p-6 md:p-8 lg:p-12 min-h-screen lg:min-h-0">
//  <div className="max-w-md w-full">
//  {/* Logo - Responsive sizing */}
//  <div className="flex justify-center mb-6 sm:mb-8">
//  <div 
//  className="w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 rounded-lg flex items-center justify-center" 
//  style={{ backgroundColor: '#1AA49B' }}
//  >
//  <svg className="w-7 h-7 sm:w-9 sm:h-9 md:w-10 md:h-10 text-white" viewBox="0 0 24 24" fill="currentColor">
//  <path d="M3 3h8l4 4-4 4H3V3zm10 10h8v8h-8l-4-4 4-4z"/>
//  </svg>
//  </div>
//  </div>

//  {/* Title - Responsive text size */}
//  <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2 text-center">
//  Welcome to NexIntel AI
//  </h2>
//  <p className="text-gray-500 mb-6 sm:mb-8 text-center text-xs sm:text-sm px-2">
//  Create your account to get started
//  </p>

//  {/* Error Message */}
//  {error && (
//  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
//  <p className="text-xs sm:text-sm text-red-600">{error}</p>
//  </div>
//  )}

//  {/* Registration Form */}
//  <div className="space-y-3 sm:space-y-4">
//  {/* Full Name */}
//  <div>
//  <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
//  Full Name
//  </label>
//  <input
//  type="text"
//  placeholder="Enter your full name"
//  className="w-full px-3 sm:px-4 py-2 sm:py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:border-transparent transition text-xs sm:text-sm bg-white text-black"
//  value={fullName}
//  onChange={(e) => setFullName(e.target.value)}
//  onFocus={(e) => e.target.style.boxShadow = '0 0 0 2px #1AA49B'}
//  onBlur={(e) => e.target.style.boxShadow = 'none'}
//  />
//  {validationErrors.fullName && (
//  <p className="text-xs text-red-600 mt-1">{validationErrors.fullName}</p>
//  )}
//  </div>

//  {/* Email Address */}
//  <div>
//  <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
//  Email Address
//  </label>
//  <input
//  type="email"
//  placeholder="Enter your email address"
//  className="w-full px-3 sm:px-4 py-2 sm:py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:border-transparent transition text-xs sm:text-sm bg-white text-black"
//  value={email}
//  onChange={(e) => setEmail(e.target.value)}
//  onFocus={(e) => e.target.style.boxShadow = '0 0 0 2px #1AA49B'}
//  onBlur={(e) => e.target.style.boxShadow = 'none'}
//  />
//  {validationErrors.email && (
//  <p className="text-xs text-red-600 mt-1">{validationErrors.email}</p>
//  )}
//  </div>

//  {/* Phone Number */}
//  <div>
//  <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
//  Phone Number
//  </label>
//  <div className="flex">
//  <span className="inline-flex items-center px-3 sm:px-4 py-2 sm:py-2.5 border border-r-0 border-gray-300 rounded-l-lg bg-gray-50 text-gray-600 text-xs sm:text-sm font-medium">
//  +91
//  </span>
//  <input
//  type="tel"
//  placeholder="Enter Phone Number"
//  className="flex-1 px-3 sm:px-4 py-2 sm:py-2.5 border border-gray-300 rounded-r-lg focus:outline-none focus:border-transparent transition text-xs sm:text-sm bg-white text-black"
//  value={phone}
//  onChange={(e) => setPhone(e.target.value)}
//  onFocus={(e) => e.target.style.boxShadow = '0 0 0 2px #1AA49B'}
//  onBlur={(e) => e.target.style.boxShadow = 'none'}
//  />
//  </div>
//  {validationErrors.phone && (
//  <p className="text-xs text-red-600 mt-1">{validationErrors.phone}</p>
//  )}
//  </div>

//  {/* Password */}
//  <div>
//  <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
//  Password
//  </label>
//  <div className="relative">
//  <input
//  type={showPassword ? "text" : "password"}
//  placeholder="***********"
//  className="w-full px-3 sm:px-4 py-2 sm:py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:border-transparent transition text-xs sm:text-sm pr-10 bg-white text-black"
//  value={password}
//  onChange={(e) => setPassword(e.target.value)}
//  onFocus={(e) => e.target.style.boxShadow = '0 0 0 2px #1AA49B'}
//  onBlur={(e) => e.target.style.boxShadow = 'none'}
//  />
//  <button
//  type="button"
//  onClick={() => setShowPassword(!showPassword)}
//  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
//  >
//  {showPassword ? <EyeOff size={16} className="sm:w-[18px] sm:h-[18px]" /> : <Eye size={16} className="sm:w-[18px] sm:h-[18px]" />}
//  </button>
//  </div>
 
//  {/* Password Strength Indicator */}
//  {password && (
//  <>
//  <div className="flex gap-1 mt-2">
//  <div className="h-1 flex-1 rounded transition-colors" style={{ backgroundColor: passwordStrength.count >= 1 ? '#21C1B6' : '#E5E7EB' }}></div>
//  <div className="h-1 flex-1 rounded transition-colors" style={{ backgroundColor: passwordStrength.count >= 2 ? '#21C1B6' : '#E5E7EB' }}></div>
//  <div className="h-1 flex-1 rounded transition-colors" style={{ backgroundColor: passwordStrength.count >= 3 ? '#21C1B6' : '#E5E7EB' }}></div>
//  <div className="h-1 flex-1 rounded transition-colors" style={{ backgroundColor: passwordStrength.count === 4 ? '#10B981' : '#E5E7EB' }}></div>
//  </div>
//  <p className="text-xs text-gray-600 mt-1 text-right">{passwordStrength.level}</p>
//  </>
//  )}

//  {/* Password Requirements */}
//  <div className="mt-2 sm:mt-3 space-y-1 sm:space-y-1.5">
//  <div className={`flex items-center text-xs ${passwordStrength.length ? "text-green-600" : "text-gray-500"}`}>
//  {passwordStrength.length ? <Check size={12} className="mr-1.5 sm:mr-2 sm:w-[14px] sm:h-[14px]" /> : <X size={12} className="mr-1.5 sm:mr-2 sm:w-[14px] sm:h-[14px]" />}
//  At least 8 characters
//  </div>
//  <div className={`flex items-center text-xs ${passwordStrength.uppercase ? "text-green-600" : "text-gray-500"}`}>
//  {passwordStrength.uppercase ? <Check size={12} className="mr-1.5 sm:mr-2 sm:w-[14px] sm:h-[14px]" /> : <X size={12} className="mr-1.5 sm:mr-2 sm:w-[14px] sm:h-[14px]" />}
//  Contains an uppercase letter
//  </div>
//  <div className={`flex items-center text-xs ${passwordStrength.number ? "text-green-600" : "text-gray-500"}`}>
//  {passwordStrength.number ? <Check size={12} className="mr-1.5 sm:mr-2 sm:w-[14px] sm:h-[14px]" /> : <X size={12} className="mr-1.5 sm:mr-2 sm:w-[14px] sm:h-[14px]" />}
//  Contains a number
//  </div>
//  <div className={`flex items-center text-xs ${passwordStrength.specialChar ? "text-green-600" : "text-gray-500"}`}>
//  {passwordStrength.specialChar ? <Check size={12} className="mr-1.5 sm:mr-2 sm:w-[14px] sm:h-[14px]" /> : <X size={12} className="mr-1.5 sm:mr-2 sm:w-[14px] sm:h-[14px]" />}
//  Contains a special character (!@#$%^&*)
//  </div>
//  </div>
//  {validationErrors.password && (
//  <p className="text-xs text-red-600 mt-1">{validationErrors.password}</p>
//  )}
//  </div>

//  {/* Confirm Password */}
//  <div>
//  <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
//  Confirm Password
//  </label>
//  <div className="relative">
//  <input
//  type={showConfirmPassword ? "text" : "password"}
//  placeholder="Enter password again"
//  className="w-full px-3 sm:px-4 py-2 sm:py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:border-transparent transition text-xs sm:text-sm pr-10 bg-white text-black"
//  value={confirmPassword}
//  onChange={(e) => setConfirmPassword(e.target.value)}
//  onFocus={(e) => e.target.style.boxShadow = '0 0 0 2px #9CDFE1'}
//  onBlur={(e) => e.target.style.boxShadow = 'none'}
//  />
//  <button
//  type="button"
//  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
//  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
//  >
//  {showConfirmPassword ? <EyeOff size={16} className="sm:w-[18px] sm:h-[18px]" /> : <Eye size={16} className="sm:w-[18px] sm:h-[18px]" />}
//  </button>
//  </div>
//  {validationErrors.confirmPassword && (
//  <p className="text-xs text-red-600 mt-1">{validationErrors.confirmPassword}</p>
//  )}
//  </div>

//  {/* Checkboxes */}
//  <div className="space-y-2 sm:space-y-3 pt-2">
//  <div className="flex items-start">
//  <input
//  type="checkbox"
//  id="agreeTerms"
//  className="h-3.5 w-3.5 sm:h-4 sm:w-4 mt-0.5 rounded border-gray-300"
//  style={{ accentColor: '#9CDFE1' }}
//  checked={agreeTerms}
//  onChange={(e) => setAgreeTerms(e.target.checked)}
//  />
//  <label htmlFor="agreeTerms" className="ml-2 block text-xs text-gray-700">
//  I agree to the <a href="#" className="font-medium hover:underline" style={{ color: '#9CDFE1' }}>Terms & Conditions</a>
//  </label>
//  </div>
//  {validationErrors.agreeTerms && (
//  <p className="text-xs text-red-600">{validationErrors.agreeTerms}</p>
//  )}
//  <div className="flex items-start">
//  <input
//  type="checkbox"
//  id="consentData"
//  className="h-3.5 w-3.5 sm:h-4 sm:w-4 mt-0.5 rounded border-gray-300"
//  style={{ accentColor: '#9CDFE1' }}
//  checked={consentData}
//  onChange={(e) => setConsentData(e.target.checked)}
//  />
//  <label htmlFor="consentData" className="ml-2 block text-xs text-gray-700">
//  I consent to data processing under GDPR/DPDPA guidelines
//  </label>
//  </div>
//  {validationErrors.consentData && (
//  <p className="text-xs text-red-600">{validationErrors.consentData}</p>
//  )}
//  </div>

//  {/* Register Button */}
//  <button
//  onClick={handleRegister}
//  disabled={isLoading}
//  className="w-full py-2.5 sm:py-3 px-4 sm:px-5 text-white font-semibold rounded-lg transition duration-200 focus:outline-none focus:ring-offset-2 mt-4 sm:mt-6 flex items-center justify-center text-sm sm:text-base disabled:opacity-70"
//  style={{ backgroundColor: isLoading ? '#9CA3AF' : '#21C1B6' }}
//  onMouseEnter={(e) => !isLoading && (e.currentTarget.style.backgroundColor = '#1AA49B')}
//  onMouseLeave={(e) => !isLoading && (e.currentTarget.style.backgroundColor = '#21C1B6')}
//  >
//  {isLoading ? (
//  <>
//  <Loader2 className="animate-spin mr-2" size={16} />
//  <span className="text-sm sm:text-base">Registering...</span>
//  </>
//  ) : (
//  'Register'
//  )}
//  </button>
//  </div>

//  {/* Login Link */}
//  <p className="mt-4 sm:mt-6 text-center text-xs sm:text-sm text-gray-600">
//  Already have an account? <a href="/login" className="font-semibold text-gray-900 hover:underline">Login</a>
//  </p>
//  </div>
//  </div>

//  {/* Right Visual Column - Hidden on mobile, visible on large screens */}
//  <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-gray-800 via-gray-900 to-gray-950 items-center justify-center p-8 xl:p-12 relative overflow-hidden">
//  {/* Background Blur Effects */}
//  <div className="absolute inset-0 opacity-10">
//  <div className="absolute top-20 right-20 w-48 h-48 xl:w-64 xl:h-64 rounded-full blur-3xl" style={{ backgroundColor: '#1AA49B' }}></div>
//  <div className="absolute bottom-20 left-20 w-48 h-48 xl:w-64 xl:h-64 bg-blue-500 rounded-full blur-3xl"></div>
//  </div>

//  <div className="max-w-lg text-white relative z-10">
//  {/* Illustration Card */}
//  <div className="mb-8 relative">
//  <div className="bg-gradient-to-br from-gray-700 to-gray-800 rounded-2xl p-6 xl:p-8 shadow-2xl">
//  <div className="flex gap-2 mb-6">
//  <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//  <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//  <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//  </div>
 
//  <div className="flex gap-3 xl:gap-4 items-center justify-center">
//  <div className="space-y-2 xl:space-y-3">
//  <div className="w-10 h-10 xl:w-12 xl:h-12 rounded-lg" style={{ backgroundColor: '#1AA49B' }}></div>
//  <div className="w-10 h-10 xl:w-12 xl:h-12 bg-gray-700 rounded-lg"></div>
//  <div className="w-10 h-10 xl:w-12 xl:h-12 bg-gray-700 rounded-lg"></div>
//  </div>
 
//  <div className="bg-white rounded-lg p-3 xl:p-4 w-40 xl:w-48">
//  <div className="space-y-2">
//  <div className="h-3 rounded w-3/4" style={{ backgroundColor: '#1AA49B' }}></div>
//  <div className="h-2 bg-gray-300 rounded"></div>
//  <div className="h-2 bg-gray-300 rounded"></div>
//  <div className="h-2 bg-gray-300 rounded w-5/6"></div>
//  </div>
//  </div>

//  <div className="space-y-3 xl:space-y-4">
//  <div className="w-12 h-12 xl:w-16 xl:h-16 relative">
//  <div className="absolute top-0 right-0 w-6 h-10 xl:w-8 xl:h-12 bg-gray-600 rounded transform rotate-45"></div>
//  <div className="absolute bottom-0 left-0 w-10 h-5 xl:w-12 xl:h-6 rounded" style={{ backgroundColor: '#1AA49B' }}></div>
//  </div>
//  <div className="w-12 h-12 xl:w-16 xl:h-16 flex items-end justify-center">
//  <div className="w-10 h-10 xl:w-12 xl:h-12 border-4 border-gray-600 rounded-full relative">
//  <div className="absolute -top-5 xl:-top-6 left-1/2 -translate-x-1/2 w-1 h-6 xl:h-8 bg-gray-600"></div>
//  </div>
//  </div>
//  </div>
//  </div>
//  </div>
//  </div>

//  {/* Main Heading */}
//  <h2 className="text-3xl xl:text-4xl font-bold mb-6 xl:mb-8 leading-tight text-center">
//  Automate Your Legal Workflow in Minutes
//  </h2>

//  {/* Features List */}
//  <div className="space-y-5 xl:space-y-6 bg-gradient-to-br from-gray-800/50 to-gray-900/50 backdrop-blur-sm rounded-2xl p-5 xl:p-6">
//  <div className="flex items-start gap-3 xl:gap-4">
//  <div className="w-9 h-9 xl:w-10 xl:h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//  <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//  <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z"/>
//  </svg>
//  </div>
//  <div>
//  <h3 className="text-base xl:text-lg font-semibold mb-1">Accelerate case preparation</h3>
//  <p className="text-gray-400 text-xs xl:text-sm">in minutes with AI-powered tools</p>
//  </div>
//  </div>

//  <div className="flex items-start gap-3 xl:gap-4">
//  <div className="w-9 h-9 xl:w-10 xl:h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//  <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/>
//  </svg>
//  </div>
//  <div>
//  <h3 className="text-base xl:text-lg font-semibold mb-1">Smart Document Vault</h3>
//  <p className="text-gray-400 text-xs xl:text-sm">Secure, searchable, and organized</p>
//  </div>
//  </div>

//  <div className="flex items-start gap-3 xl:gap-4">
//  <div className="w-9 h-9 xl:w-10 xl:h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//  <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//  <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/>
//  </svg>
//  </div>
//  <div>
//  <h3 className="text-base xl:text-lg font-semibold mb-1">Trusted Legal Insights</h3>
//  <p className="text-gray-400 text-xs xl:text-sm">AI-driven precedents & analysis</p>
//  </div>
//  </div>
//  </div>
//  </div>
//  </div>
//  </div>
//  );
// };

// export default RegisterPage;



// import React, { useState } from 'react';
// import { Eye, EyeOff, Check, X, Loader2 } from 'lucide-react';
// import ApiService from '../../services/api';

// const RegisterPage = () => {
//  const [fullName, setFullName] = useState('');
//  const [email, setEmail] = useState('');
//  const [password, setPassword] = useState('');
//  const [confirmPassword, setConfirmPassword] = useState('');
//  const [agreeTerms, setAgreeTerms] = useState(false);
//  const [consentData, setConsentData] = useState(false);
//  const [showPassword, setShowPassword] = useState(false);
//  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
//  const [isLoading, setIsLoading] = useState(false);
//  const [error, setError] = useState('');
//  const [validationErrors, setValidationErrors] = useState({});

//  const getPasswordStrength = (password) => {
//  const strength = {
//  length: password.length >= 8,
//  uppercase: /[A-Z]/.test(password),
//  number: /[0-9]/.test(password),
//  specialChar: /[!@#$%^&*(),.?":{}|<>]/.test(password),
//  };
 
//  const count = Object.values(strength).filter(Boolean).length;
//  let level = 'Weak';
//  if (count === 4) level = 'Strong';
//  else if (count >= 2) level = 'Medium';
 
//  return { ...strength, level, count };
//  };

//  const passwordStrength = getPasswordStrength(password);

//  const validateForm = () => {
//  const errors = {};
 
//  if (!fullName.trim()) {
//  errors.fullName = 'Full name is required';
//  }
 
//  if (!email.trim()) {
//  errors.email = 'Email is required';
//  } else if (!/\S+@\S+\.\S+/.test(email)) {
//  errors.email = 'Email is invalid';
//  }
 
//  if (!password) {
//  errors.password = 'Password is required';
//  } else if (passwordStrength.count < 4) {
//  errors.password = 'Password must meet all requirements';
//  }
 
//  if (!confirmPassword) {
//  errors.confirmPassword = 'Please confirm your password';
//  } else if (password !== confirmPassword) {
//  errors.confirmPassword = 'Passwords do not match';
//  }
 
//  if (!agreeTerms) {
//  errors.agreeTerms = 'You must agree to the Terms & Conditions';
//  }
 
//  if (!consentData) {
//  errors.consentData = 'You must consent to data processing';
//  }
 
//  setValidationErrors(errors);
//  return Object.keys(errors).length === 0;
//  };

//  const handleRegister = async () => {
//  setError('');
//  setValidationErrors({});
 
//  if (!validateForm()) {
//  return;
//  }
 
//  setIsLoading(true);
 
//  try {
//  const data = await ApiService.register({
//  username: fullName,
//  email: email,
//  password: password,
//  });
 
//  if (data.token) {
//  console.log('Registration successful, token received');
//  localStorage.setItem('token', data.token);
//  }
 
//  alert('Registration successful! Redirecting to login page...');
//  window.location.href = '/login';
 
//  } catch (err) {
//  console.error('Registration error:', err);
//  setError(err.message || 'An error occurred during registration. Please try again.');
//  } finally {
//  setIsLoading(false);
//  }
//  };

//  return (
//  <div className="min-h-screen flex flex-col lg:flex-row font-sans">
//  {/* Left Section - Registration Form */}
//  <div className="w-full lg:w-1/2 bg-white flex items-center justify-center p-4 sm:p-6 md:p-8 lg:p-12 min-h-screen lg:min-h-0">
//  <div className="max-w-md w-full">
//  {/* Logo - Responsive sizing */}
//  <div className="flex justify-center mb-6 sm:mb-8">
//  <div 
//  className="w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 rounded-lg flex items-center justify-center" 
//  style={{ backgroundColor: '#1AA49B' }}
//  >
//  <svg className="w-7 h-7 sm:w-9 sm:h-9 md:w-10 md:h-10 text-white" viewBox="0 0 24 24" fill="currentColor">
//  <path d="M3 3h8l4 4-4 4H3V3zm10 10h8v8h-8l-4-4 4-4z"/>
//  </svg>
//  </div>
//  </div>

//  {/* Title - Responsive text size */}
//  <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2 text-center">
//  Welcome to NexIntel AI
//  </h2>
//  <p className="text-gray-500 mb-6 sm:mb-8 text-center text-xs sm:text-sm px-2">
//  Create your account to get started
//  </p>

//  {/* Error Message */}
//  {error && (
//  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
//  <p className="text-xs sm:text-sm text-red-600">{error}</p>
//  </div>
//  )}

//  {/* Registration Form */}
//  <div className="space-y-3 sm:space-y-4">
//  {/* Full Name */}
//  <div>
//  <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
//  Full Name
//  </label>
//  <input
//  type="text"
//  placeholder="Enter your full name"
//  className="w-full px-3 sm:px-4 py-2 sm:py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:border-transparent transition text-xs sm:text-sm bg-white text-black"
//  value={fullName}
//  onChange={(e) => setFullName(e.target.value)}
//  onFocus={(e) => e.target.style.boxShadow = '0 0 0 2px #1AA49B'}
//  onBlur={(e) => e.target.style.boxShadow = 'none'}
//  />
//  {validationErrors.fullName && (
//  <p className="text-xs text-red-600 mt-1">{validationErrors.fullName}</p>
//  )}
//  </div>

//  {/* Email Address */}
//  <div>
//  <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
//  Email Address
//  </label>
//  <input
//  type="email"
//  placeholder="Enter your email address"
//  className="w-full px-3 sm:px-4 py-2 sm:py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:border-transparent transition text-xs sm:text-sm bg-white text-black"
//  value={email}
//  onChange={(e) => setEmail(e.target.value)}
//  onFocus={(e) => e.target.style.boxShadow = '0 0 0 2px #1AA49B'}
//  onBlur={(e) => e.target.style.boxShadow = 'none'}
//  />
//  {validationErrors.email && (
//  <p className="text-xs text-red-600 mt-1">{validationErrors.email}</p>
//  )}
//  </div>

//  {/* Password */}
//  <div>
//  <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
//  Password
//  </label>
//  <div className="relative">
//  <input
//  type={showPassword ? "text" : "password"}
//  placeholder="***********"
//  className="w-full px-3 sm:px-4 py-2 sm:py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:border-transparent transition text-xs sm:text-sm pr-10 bg-white text-black"
//  value={password}
//  onChange={(e) => setPassword(e.target.value)}
//  onFocus={(e) => e.target.style.boxShadow = '0 0 0 2px #1AA49B'}
//  onBlur={(e) => e.target.style.boxShadow = 'none'}
//  />
//  <button
//  type="button"
//  onClick={() => setShowPassword(!showPassword)}
//  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
//  >
//  {showPassword ? <EyeOff size={16} className="sm:w-[18px] sm:h-[18px]" /> : <Eye size={16} className="sm:w-[18px] sm:h-[18px]" />}
//  </button>
//  </div>
 
//  {/* Password Strength Indicator */}
//  {password && (
//  <>
//  <div className="flex gap-1 mt-2">
//  <div className="h-1 flex-1 rounded transition-colors" style={{ backgroundColor: passwordStrength.count >= 1 ? '#21C1B6' : '#E5E7EB' }}></div>
//  <div className="h-1 flex-1 rounded transition-colors" style={{ backgroundColor: passwordStrength.count >= 2 ? '#21C1B6' : '#E5E7EB' }}></div>
//  <div className="h-1 flex-1 rounded transition-colors" style={{ backgroundColor: passwordStrength.count >= 3 ? '#21C1B6' : '#E5E7EB' }}></div>
//  <div className="h-1 flex-1 rounded transition-colors" style={{ backgroundColor: passwordStrength.count === 4 ? '#10B981' : '#E5E7EB' }}></div>
//  </div>
//  <p className="text-xs text-gray-600 mt-1 text-right">{passwordStrength.level}</p>
//  </>
//  )}

//  {/* Password Requirements */}
//  <div className="mt-2 sm:mt-3 space-y-1 sm:space-y-1.5">
//  <div className={`flex items-center text-xs ${passwordStrength.length ? "text-green-600" : "text-gray-500"}`}>
//  {passwordStrength.length ? <Check size={12} className="mr-1.5 sm:mr-2 sm:w-[14px] sm:h-[14px]" /> : <X size={12} className="mr-1.5 sm:mr-2 sm:w-[14px] sm:h-[14px]" />}
//  At least 8 characters
//  </div>
//  <div className={`flex items-center text-xs ${passwordStrength.uppercase ? "text-green-600" : "text-gray-500"}`}>
//  {passwordStrength.uppercase ? <Check size={12} className="mr-1.5 sm:mr-2 sm:w-[14px] sm:h-[14px]" /> : <X size={12} className="mr-1.5 sm:mr-2 sm:w-[14px] sm:h-[14px]" />}
//  Contains an uppercase letter
//  </div>
//  <div className={`flex items-center text-xs ${passwordStrength.number ? "text-green-600" : "text-gray-500"}`}>
//  {passwordStrength.number ? <Check size={12} className="mr-1.5 sm:mr-2 sm:w-[14px] sm:h-[14px]" /> : <X size={12} className="mr-1.5 sm:mr-2 sm:w-[14px] sm:h-[14px]" />}
//  Contains a number
//  </div>
//  <div className={`flex items-center text-xs ${passwordStrength.specialChar ? "text-green-600" : "text-gray-500"}`}>
//  {passwordStrength.specialChar ? <Check size={12} className="mr-1.5 sm:mr-2 sm:w-[14px] sm:h-[14px]" /> : <X size={12} className="mr-1.5 sm:mr-2 sm:w-[14px] sm:h-[14px]" />}
//  Contains a special character (!@#$%^&*)
//  </div>
//  </div>
//  {validationErrors.password && (
//  <p className="text-xs text-red-600 mt-1">{validationErrors.password}</p>
//  )}
//  </div>

//  {/* Confirm Password */}
//  <div>
//  <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
//  Confirm Password
//  </label>
//  <div className="relative">
//  <input
//  type={showConfirmPassword ? "text" : "password"}
//  placeholder="Enter password again"
//  className="w-full px-3 sm:px-4 py-2 sm:py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:border-transparent transition text-xs sm:text-sm pr-10 bg-white text-black"
//  value={confirmPassword}
//  onChange={(e) => setConfirmPassword(e.target.value)}
//  onFocus={(e) => e.target.style.boxShadow = '0 0 0 2px #9CDFE1'}
//  onBlur={(e) => e.target.style.boxShadow = 'none'}
//  />
//  <button
//  type="button"
//  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
//  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
//  >
//  {showConfirmPassword ? <EyeOff size={16} className="sm:w-[18px] sm:h-[18px]" /> : <Eye size={16} className="sm:w-[18px] sm:h-[18px]" />}
//  </button>
//  </div>
//  {validationErrors.confirmPassword && (
//  <p className="text-xs text-red-600 mt-1">{validationErrors.confirmPassword}</p>
//  )}
//  </div>

//  {/* Checkboxes */}
//  <div className="space-y-2 sm:space-y-3 pt-2">
//  <div className="flex items-start">
//  <input
//  type="checkbox"
//  id="agreeTerms"
//  className="h-3.5 w-3.5 sm:h-4 sm:w-4 mt-0.5 rounded border-gray-300"
//  style={{ accentColor: '#9CDFE1' }}
//  checked={agreeTerms}
//  onChange={(e) => setAgreeTerms(e.target.checked)}
//  />
//  <label htmlFor="agreeTerms" className="ml-2 block text-xs text-gray-700">
//  I agree to the <a href="#" className="font-medium hover:underline" style={{ color: '#9CDFE1' }}>Terms & Conditions</a>
//  </label>
//  </div>
//  {validationErrors.agreeTerms && (
//  <p className="text-xs text-red-600">{validationErrors.agreeTerms}</p>
//  )}
//  <div className="flex items-start">
//  <input
//  type="checkbox"
//  id="consentData"
//  className="h-3.5 w-3.5 sm:h-4 sm:w-4 mt-0.5 rounded border-gray-300"
//  style={{ accentColor: '#9CDFE1' }}
//  checked={consentData}
//  onChange={(e) => setConsentData(e.target.checked)}
//  />
//  <label htmlFor="consentData" className="ml-2 block text-xs text-gray-700">
//  I consent to data processing under GDPR/DPDPA guidelines
//  </label>
//  </div>
//  {validationErrors.consentData && (
//  <p className="text-xs text-red-600">{validationErrors.consentData}</p>
//  )}
//  </div>

//  {/* Register Button */}
//  <button
//  onClick={handleRegister}
//  disabled={isLoading}
//  className="w-full py-2.5 sm:py-3 px-4 sm:px-5 text-white font-semibold rounded-lg transition duration-200 focus:outline-none focus:ring-offset-2 mt-4 sm:mt-6 flex items-center justify-center text-sm sm:text-base disabled:opacity-70"
//  style={{ backgroundColor: isLoading ? '#9CA3AF' : '#21C1B6' }}
//  onMouseEnter={(e) => !isLoading && (e.currentTarget.style.backgroundColor = '#1AA49B')}
//  onMouseLeave={(e) => !isLoading && (e.currentTarget.style.backgroundColor = '#21C1B6')}
//  >
//  {isLoading ? (
//  <>
//  <Loader2 className="animate-spin mr-2" size={16} />
//  <span className="text-sm sm:text-base">Registering...</span>
//  </>
//  ) : (
//  'Register'
//  )}
//  </button>
//  </div>

//  {/* Login Link */}
//  <p className="mt-4 sm:mt-6 text-center text-xs sm:text-sm text-gray-600">
//  Already have an account? <a href="/login" className="font-semibold text-gray-900 hover:underline">Login</a>
//  </p>
//  </div>
//  </div>

//  {/* Right Visual Column - Hidden on mobile, visible on large screens */}
//  <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-gray-800 via-gray-900 to-gray-950 items-center justify-center p-8 xl:p-12 relative overflow-hidden">
//  {/* Background Blur Effects */}
//  <div className="absolute inset-0 opacity-10">
//  <div className="absolute top-20 right-20 w-48 h-48 xl:w-64 xl:h-64 rounded-full blur-3xl" style={{ backgroundColor: '#1AA49B' }}></div>
//  <div className="absolute bottom-20 left-20 w-48 h-48 xl:w-64 xl:h-64 bg-blue-500 rounded-full blur-3xl"></div>
//  </div>

//  <div className="max-w-lg text-white relative z-10">
//  {/* Illustration Card */}
//  <div className="mb-8 relative">
//  <div className="bg-gradient-to-br from-gray-700 to-gray-800 rounded-2xl p-6 xl:p-8 shadow-2xl">
//  <div className="flex gap-2 mb-6">
//  <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//  <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//  <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//  </div>
 
//  <div className="flex gap-3 xl:gap-4 items-center justify-center">
//  <div className="space-y-2 xl:space-y-3">
//  <div className="w-10 h-10 xl:w-12 xl:h-12 rounded-lg" style={{ backgroundColor: '#1AA49B' }}></div>
//  <div className="w-10 h-10 xl:w-12 xl:h-12 bg-gray-700 rounded-lg"></div>
//  <div className="w-10 h-10 xl:w-12 xl:h-12 bg-gray-700 rounded-lg"></div>
//  </div>
 
//  <div className="bg-white rounded-lg p-3 xl:p-4 w-40 xl:w-48">
//  <div className="space-y-2">
//  <div className="h-3 rounded w-3/4" style={{ backgroundColor: '#1AA49B' }}></div>
//  <div className="h-2 bg-gray-300 rounded"></div>
//  <div className="h-2 bg-gray-300 rounded"></div>
//  <div className="h-2 bg-gray-300 rounded w-5/6"></div>
//  </div>
//  </div>

//  <div className="space-y-3 xl:space-y-4">
//  <div className="w-12 h-12 xl:w-16 xl:h-16 relative">
//  <div className="absolute top-0 right-0 w-6 h-10 xl:w-8 xl:h-12 bg-gray-600 rounded transform rotate-45"></div>
//  <div className="absolute bottom-0 left-0 w-10 h-5 xl:w-12 xl:h-6 rounded" style={{ backgroundColor: '#1AA49B' }}></div>
//  </div>
//  <div className="w-12 h-12 xl:w-16 xl:h-16 flex items-end justify-center">
//  <div className="w-10 h-10 xl:w-12 xl:h-12 border-4 border-gray-600 rounded-full relative">
//  <div className="absolute -top-5 xl:-top-6 left-1/2 -translate-x-1/2 w-1 h-6 xl:h-8 bg-gray-600"></div>
//  </div>
//  </div>
//  </div>
//  </div>
//  </div>
//  </div>

//  {/* Main Heading */}
//  <h2 className="text-3xl xl:text-4xl font-bold mb-6 xl:mb-8 leading-tight text-center">
//  Automate Your Legal Workflow in Minutes
//  </h2>

//  {/* Features List */}
//  <div className="space-y-5 xl:space-y-6 bg-gradient-to-br from-gray-800/50 to-gray-900/50 backdrop-blur-sm rounded-2xl p-5 xl:p-6">
//  <div className="flex items-start gap-3 xl:gap-4">
//  <div className="w-9 h-9 xl:w-10 xl:h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//  <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//  <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z"/>
//  </svg>
//  </div>
//  <div>
//  <h3 className="text-base xl:text-lg font-semibold mb-1">Accelerate case preparation</h3>
//  <p className="text-gray-400 text-xs xl:text-sm">in minutes with AI-powered tools</p>
//  </div>
//  </div>

//  <div className="flex items-start gap-3 xl:gap-4">
//  <div className="w-9 h-9 xl:w-10 xl:h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//  <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/>
//  </svg>
//  </div>
//  <div>
//  <h3 className="text-base xl:text-lg font-semibold mb-1">Smart Document Vault</h3>
//  <p className="text-gray-400 text-xs xl:text-sm">Secure, searchable, and organized</p>
//  </div>
//  </div>

//  <div className="flex items-start gap-3 xl:gap-4">
//  <div className="w-9 h-9 xl:w-10 xl:h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//  <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//  <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/>
//  </svg>
//  </div>
//  <div>
//  <h3 className="text-base xl:text-lg font-semibold mb-1">Trusted Legal Insights</h3>
//  <p className="text-gray-400 text-xs xl:text-sm">AI-driven precedents & analysis</p>
//  </div>
//  </div>
//  </div>
//  </div>
//  </div>
//  </div>
//  );
// };

// export default RegisterPage;


// import React, { useState } from 'react';
// import { Eye, EyeOff, Check, X, Loader2, ArrowLeft } from 'lucide-react';
// import ApiService from '../../services/api';
// import TermsAndConditions from '../../components/TermsAndConditions';

// const RegisterPage = () => {
//   const [fullName, setFullName] = useState('');
//   const [email, setEmail] = useState('');
//   const [password, setPassword] = useState('');
//   const [confirmPassword, setConfirmPassword] = useState('');
//   const [agreeTerms, setAgreeTerms] = useState(false);
//   const [consentData, setConsentData] = useState(false);
//   const [showPassword, setShowPassword] = useState(false);
//   const [showConfirmPassword, setShowConfirmPassword] = useState(false);
//   const [isLoading, setIsLoading] = useState(false);
//   const [error, setError] = useState('');
//   const [validationErrors, setValidationErrors] = useState({});
//   const [showTermsModal, setShowTermsModal] = useState(false);
//   const [termsAccepted, setTermsAccepted] = useState(false);

//   // Password strength
//   const getPasswordStrength = (pwd) => {
//     const s = {
//       length: pwd.length >= 8,
//       uppercase: /[A-Z]/.test(pwd),
//       number: /[0-9]/.test(pwd),
//       specialChar: /[!@#$%^&*(),.?":{}|<>]/.test(pwd),
//     };
//     const count = Object.values(s).filter(Boolean).length;
//     let level = 'Weak';
//     if (count === 4) level = 'Strong';
//     else if (count >= 2) level = 'Medium';
//     return { ...s, level, count };
//   };
//   const passwordStrength = getPasswordStrength(password);

//   // Form validation
//   const validateForm = () => {
//     const e = {};

//     if (!fullName.trim()) e.fullName = 'Full name is required';
//     if (!email.trim()) e.email = 'Email is required';
//     else if (!/\S+@\S+\.\S+/.test(email)) e.email = 'Email is invalid';

//     if (!password) e.password = 'Password is required';
//     else if (passwordStrength.count < 4) e.password = 'Password must meet all requirements';

//     if (!confirmPassword) e.confirmPassword = 'Please confirm your password';
//     else if (password !== confirmPassword) e.confirmPassword = 'Passwords do not match';

//     if (!termsAccepted) e.agreeTerms = 'You must accept the Terms & Conditions';
//     if (!consentData) e.consentData = 'You must consent to data processing';

//     setValidationErrors(e);
//     return Object.keys(e).length === 0;
//   };

//   // Terms checkbox click
//   const handleTermsCheckboxClick = (e) => {
//     e.preventDefault();
//     if (!termsAccepted) {
//       setShowTermsModal(true);
//     } else {
//       setAgreeTerms(false);
//       setTermsAccepted(false);
//     }
//   };

//   const handleAcceptTerms = () => {
//     setTermsAccepted(true);
//     setAgreeTerms(true);
//     setShowTermsModal(false);
//   };

//   // Navigation
//   const go = (path) => {
//     if (window.history?.pushState) {
//       window.history.pushState({}, '', path);
//       window.dispatchEvent(new PopStateEvent('popstate'));
//     } else {
//       window.location.href = path;
//     }
//   };
//   const handleBackToHome = () => go('/');
//   const handleLoginClick = (e) => {
//     e.preventDefault();
//     go('/login');
//   };

//   // Register
//   const handleRegister = async () => {
//     setError('');
//     setValidationErrors({});
//     if (!validateForm()) return;

//     setIsLoading(true);
//     try {
//       const data = await ApiService.register({
//         username: fullName,
//         email,
//         password,
//       });

//       if (data.token) localStorage.setItem('token', data.token);
//       alert('Registration successful! Redirecting to login...');
//       go('/login');
//     } catch (err) {
//       setError(err.message || 'Registration failed');
//     } finally {
//       setIsLoading(false);
//     }
//   };

//   return (
//     <div className="min-h-screen flex flex-col lg:flex-row font-sans">
//       {/* LEFT - FORM */}
//       <div className="w-full lg:w-1/2 bg-white flex items-center justify-center p-4 sm:p-6 md:p-8 lg:p-12">
//         <div className="max-w-md w-full">

//           {/* TERMS MODAL */}
//           {showTermsModal ? (
//             <TermsAndConditions
//               isOpen={showTermsModal}
//               onClose={() => setShowTermsModal(false)}
//               onAccept={handleAcceptTerms}
//               showAcceptButton
//               companyName="NexIntel AI"
//               effectiveDate="January 1, 2025"
//             />
//           ) : (
//             <>
//               {/* Logo */}
//               <div className="flex justify-center mb-6 sm:mb-8">
//                 <div
//                   className="w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 rounded-lg flex items-center justify-center"
//                   style={{ backgroundColor: '#1AA49B' }}
//                 >
//                   <svg
//                     className="w-7 h-7 sm:w-9 sm:h-9 md:w-10 md:h-10 text-white"
//                     viewBox="0 0 24 24"
//                     fill="currentColor"
//                   >
//                     <path d="M3 3h8l4 4-4 4H3V3zm10 10h8v8h-8l-4-4 4-4z" />
//                   </svg>
//                 </div>
//               </div>

//               <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2 text-center">
//                 Welcome to JuriNex
//               </h2>
//               <p className="text-gray-500 mb-6 sm:mb-8 text-center text-xs sm:text-sm">
//                 Create your account to get started
//               </p>

//               {error && (
//                 <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
//                   <p className="text-xs sm:text-sm text-red-600">{error}</p>
//                 </div>
//               )}

//               {/* FORM */}
//               <div className="space-y-3 sm:space-y-4">
//                 {/* Full Name */}
//                 <div>
//                   <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
//                     Full Name
//                   </label>
//                   <input
//                     type="text"
//                     placeholder="Enter your full name"
//                     className="w-full px-3 sm:px-4 py-2 sm:py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1AA49B] transition text-xs sm:text-sm text-gray-900"
//                     value={fullName}
//                     onChange={(e) => setFullName(e.target.value)}
//                   />
//                   {validationErrors.fullName && (
//                     <p className="text-xs text-red-600 mt-1">{validationErrors.fullName}</p>
//                   )}
//                 </div>

//                 {/* Email */}
//                 <div>
//                   <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
//                     Email Address
//                   </label>
//                   <input
//                     type="email"
//                     placeholder="Enter your email address"
//                     className="w-full px-3 sm:px-4 py-2 sm:py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1AA49B] transition text-xs sm:text-sm text-gray-900"
//                     value={email}
//                     onChange={(e) => setEmail(e.target.value)}
//                   />
//                   {validationErrors.email && (
//                     <p className="text-xs text-red-600 mt-1">{validationErrors.email}</p>
//                   )}
//                 </div>

//                 {/* Password */}
//                 <div>
//                   <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
//                     Password
//                   </label>
//                   <div className="relative">
//                     <input
//                       type={showPassword ? 'text' : 'password'}
//                       placeholder="***********"
//                       className="w-full px-3 sm:px-4 py-2 sm:py-2.5 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1AA49B] transition text-xs sm:text-sm text-gray-900"
//                       value={password}
//                       onChange={(e) => setPassword(e.target.value)}
//                     />
//                     <button
//                       type="button"
//                       onClick={() => setShowPassword(!showPassword)}
//                       className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
//                     >
//                       {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
//                     </button>
//                   </div>

//                   {/* Strength Bar */}
//                   {password && (
//                     <>
//                       <div className="flex gap-1 mt-2">
//                         {[1, 2, 3, 4].map((i) => (
//                           <div
//                             key={i}
//                             className="h-1 flex-1 rounded transition-colors"
//                             style={{
//                               backgroundColor:
//                                 passwordStrength.count >= i
//                                   ? i === 4
//                                     ? '#10B981'
//                                     : '#21C1B6'
//                                   : '#E5E7EB',
//                             }}
//                           />
//                         ))}
//                       </div>
//                       <p className="text-xs text-gray-600 mt-1 text-right">
//                         {passwordStrength.level}
//                       </p>
//                     </>
//                   )}

//                   {/* Requirements */}
//                   {password && (
//                     <div className="mt-2 space-y-1">
//                       {[
//                         { cond: passwordStrength.length, txt: 'At least 8 characters' },
//                         { cond: passwordStrength.uppercase, txt: 'Contains an uppercase letter' },
//                         { cond: passwordStrength.number, txt: 'Contains a number' },
//                         { cond: passwordStrength.specialChar, txt: 'Contains a special character (!@#$%^&*)' },
//                       ].map((r, i) => (
//                         <div
//                           key={i}
//                           className={`flex items-center text-xs ${r.cond ? 'text-green-600' : 'text-gray-500'}`}
//                         >
//                           {r.cond ? <Check size={12} className="mr-1.5" /> : <X size={12} className="mr-1.5" />}
//                           {r.txt}
//                         </div>
//                       ))}
//                     </div>
//                   )}
//                   {validationErrors.password && (
//                     <p className="text-xs text-red-600 mt-1">{validationErrors.password}</p>
//                   )}
//                 </div>

//                 {/* Confirm Password */}
//                 <div>
//                   <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
//                     Confirm Password
//                   </label>
//                   <div className="relative">
//                     <input
//                       type={showConfirmPassword ? 'text' : 'password'}
//                       placeholder="Enter password again"
//                       className="w-full px-3 sm:px-4 py-2 sm:py-2.5 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#9CDFE1] transition text-xs sm:text-sm text-gray-900"
//                       value={confirmPassword}
//                       onChange={(e) => setConfirmPassword(e.target.value)}
//                     />
//                     <button
//                       type="button"
//                       onClick={() => setShowConfirmPassword(!showConfirmPassword)}
//                       className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
//                     >
//                       {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
//                     </button>
//                   </div>
//                   {validationErrors.confirmPassword && (
//                     <p className="text-xs text-red-600 mt-1">{validationErrors.confirmPassword}</p>
//                   )}
//                 </div>

//                 {/* Checkboxes */}
//                 <div className="space-y-2 pt-2">
//                   <div className="flex items-start">
//                     <input
//                       type="checkbox"
//                       id="agreeTerms"
//                       className="h-3.5 w-3.5 mt-0.5 rounded border-gray-300"
//                       style={{ accentColor: '#9CDFE1' }}
//                       checked={agreeTerms}
//                       onChange={handleTermsCheckboxClick}
//                     />
//                     <label htmlFor="agreeTerms" className="ml-2 block text-xs text-gray-700">
//                       I agree to the{' '}
//                       <button
//                         type="button"
//                         onClick={() => setShowTermsModal(true)}
//                         className="font-medium hover:underline"
//                         style={{ color: '#9CDFE1' }}
//                       >
//                         Terms & Conditions
//                       </button>
//                     </label>
//                   </div>
//                   {validationErrors.agreeTerms && (
//                     <p className="text-xs text-red-600">{validationErrors.agreeTerms}</p>
//                   )}

//                   <div className="flex items-start">
//                     <input
//                       type="checkbox"
//                       id="consentData"
//                       className="h-3.5 w-3.5 mt-0.5 rounded border-gray-300"
//                       style={{ accentColor: '#9CDFE1' }}
//                       checked={consentData}
//                       onChange={(e) => setConsentData(e.target.checked)}
//                     />
//                     <label htmlFor="consentData" className="ml-2 block text-xs text-gray-700">
//                       I consent to data processing under GDPR/DPDPA guidelines
//                     </label>
//                   </div>
//                   {validationErrors.consentData && (
//                     <p className="text-xs text-red-600">{validationErrors.consentData}</p>
//                   )}
//                 </div>

//                 {/* Register Button */}
//                 <button
//                   onClick={handleRegister}
//                   disabled={isLoading}
//                   className="w-full py-2.5 sm:py-3 mt-4 sm:mt-6 text-white font-semibold rounded-lg transition flex items-center justify-center text-sm sm:text-base disabled:opacity-70"
//                   style={{
//                     backgroundColor: isLoading ? '#9CA3AF' : '#21C1B6',
//                   }}
//                   onMouseEnter={(e) =>
//                     !isLoading && (e.currentTarget.style.backgroundColor = '#1AA49B')
//                   }
//                   onMouseLeave={(e) =>
//                     !isLoading && (e.currentTarget.style.backgroundColor = '#21C1B6')
//                   }
//                 >
//                   {isLoading ? (
//                     <>
//                       <Loader2 className="animate-spin mr-2" size={16} />
//                       Registering...
//                     </>
//                   ) : (
//                     'Register'
//                   )}
//                 </button>
//               </div>

//               {/* LOGIN + BACK TO HOME – CENTERED BELOW */}
//               <div className="mt-4 sm:mt-6 text-center">
//                 <p className="text-xs sm:text-sm text-gray-600">
//                   Already have an account?{' '}
//                   <button onClick={handleLoginClick} className="font-semibold text-gray-900 hover:underline">
//                     Login
//                   </button>
//                 </p>

//                 {/* EXACTLY CENTERED BELOW */}
//                 <button
//                   onClick={handleBackToHome}
//                   className="mt-3 flex items-center justify-center w-full text-gray-600 hover:text-gray-800 transition-colors text-xs sm:text-sm"
//                 >
//                   <ArrowLeft size={14} className="mr-1.5" />
//                   Back to Home
//                 </button>
//               </div>
//             </>
//           )}
//         </div>
//       </div>

//       {/* RIGHT - VISUAL */}
//       <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-gray-800 via-gray-900 to-gray-950 items-center justify-center p-8 xl:p-12 relative overflow-hidden">
//         <div className="absolute inset-0 opacity-10">
//           <div className="absolute top-20 right-20 w-48 h-48 xl:w-64 xl:h-64 rounded-full blur-3xl" style={{ backgroundColor: '#1AA49B' }}></div>
//           <div className="absolute bottom-20 left-20 w-48 h-48 xl:w-64 xl:h-64 bg-blue-500 rounded-full blur-3xl"></div>
//         </div>

//         <div className="max-w-lg text-white relative z-10">
//           <div className="mb-8 relative">
//             <div className="bg-gradient-to-br from-gray-700 to-gray-800 rounded-2xl p-6 xl:p-8 shadow-2xl">
//               <div className="flex gap-2 mb-6">
//                 <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//                 <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//                 <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//               </div>

//               <div className="flex gap-3 xl:gap-4 items-center justify-center">
//                 <div className="space-y-2 xl:space-y-3">
//                   <div className="w-10 h-10 xl:w-12 xl:h-12 rounded-lg" style={{ backgroundColor: '#1AA49B' }}></div>
//                   <div className="w-10 h-10 xl:w-12 xl:h-12 bg-gray-700 rounded-lg"></div>
//                   <div className="w-10 h-10 xl:w-12 xl:h-12 bg-gray-700 rounded-lg"></div>
//                 </div>

//                 <div className="bg-white rounded-lg p-3 xl:p-4 w-40 xl:w-48">
//                   <div className="space-y-2">
//                     <div className="h-3 rounded w-3/4" style={{ backgroundColor: '#1AA49B' }}></div>
//                     <div className="h-2 bg-gray-300 rounded"></div>
//                     <div className="h-2 bg-gray-300 rounded"></div>
//                     <div className="h-2 bg-gray-300 rounded w-5/6"></div>
//                   </div>
//                 </div>

//                 <div className="space-y-3 xl:space-y-4">
//                   <div className="w-12 h-12 xl:w-16 xl:h-16 relative">
//                     <div className="absolute top-0 right-0 w-6 h-10 xl:w-8 xl:h-12 bg-gray-600 rounded transform rotate-45"></div>
//                     <div className="absolute bottom-0 left-0 w-10 h-5 xl:w-12 xl:h-6 rounded" style={{ backgroundColor: '#1AA49B' }}></div>
//                   </div>
//                   <div className="w-12 h-12 xl:w-16 xl:h-16 flex items-end justify-center">
//                     <div className="w-10 h-10 xl:w-12 xl:h-12 border-4 border-gray-600 rounded-full relative">
//                       <div className="absolute -top-5 xl:-top-6 left-1/2 -translate-x-1/2 w-1 h-6 xl:h-8 bg-gray-600"></div>
//                     </div>
//                   </div>
//                 </div>
//               </div>
//             </div>
//           </div>

//           <h2 className="text-3xl xl:text-4xl font-bold mb-6 xl:mb-8 leading-tight text-center">
//             Automate Your Legal Workflow in Minutes
//           </h2>

//           <div className="space-y-5 xl:space-y-6 bg-gradient-to-br from-gray-800/50 to-gray-900/50 backdrop-blur-sm rounded-2xl p-5 xl:p-6">
//             <div className="flex items-start gap-3 xl:gap-4">
//               <div className="w-9 h-9 xl:w-10 xl:h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                 <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                   <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z"/>
//                 </svg>
//               </div>
//               <div>
//                 <h3 className="text-base xl:text-lg font-semibold mb-1">Accelerate case preparation</h3>
//                 <p className="text-gray-400 text-xs xl:text-sm">in minutes with AI-powered tools</p>
//               </div>
//             </div>

//             <div className="flex items-start gap-3 xl:gap-4">
//               <div className="w-9 h-9 xl:w-10 xl:h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                 <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                   <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/>
//                 </svg>
//               </div>
//               <div>
//                 <h3 className="text-base xl:text-lg font-semibold mb-1">Smart Document Vault</h3>
//                 <p className="text-gray-400 text-xs xl:text-sm">Secure, searchable, and organized</p>
//               </div>
//             </div>

//             <div className="flex items-start gap-3 xl:gap-4">
//               <div className="w-9 h-9 xl:w-10 xl:h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                 <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                   <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/>
//                 </svg>
//               </div>
//               <div>
//                 <h3 className="text-base xl:text-lg font-semibold mb-1">Trusted Legal Insights</h3>
//                 <p className="text-gray-400 text-xs xl:text-sm">AI-driven precedents & analysis</p>
//               </div>
//             </div>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default RegisterPage;


// import React, { useState } from 'react';
// import { Eye, EyeOff, Check, X, Loader2, ArrowLeft } from 'lucide-react';
// import ApiService from '../../services/api';
// import TermsAndConditions from '../../components/TermsAndConditions';

// const RegisterPage = () => {
//   const [fullName, setFullName] = useState('');
//   const [email, setEmail] = useState('');
//   const [password, setPassword] = useState('');
//   const [confirmPassword, setConfirmPassword] = useState('');
//   const [agreeTerms, setAgreeTerms] = useState(false);
//   const [consentData, setConsentData] = useState(false);
//   const [showPassword, setShowPassword] = useState(false);
//   const [showConfirmPassword, setShowConfirmPassword] = useState(false);
//   const [isLoading, setIsLoading] = useState(false);
//   const [error, setError] = useState('');
//   const [validationErrors, setValidationErrors] = useState({});
//   const [showTermsModal, setShowTermsModal] = useState(false);
//   const [termsAccepted, setTermsAccepted] = useState(false);

//   // Password strength
//   const getPasswordStrength = (pwd) => {
//     const s = {
//       length: pwd.length >= 8,
//       uppercase: /[A-Z]/.test(pwd),
//       number: /[0-9]/.test(pwd),
//       specialChar: /[!@#$%^&*(),.?":{}|<>]/.test(pwd),
//     };
//     const count = Object.values(s).filter(Boolean).length;
//     let level = 'Weak';
//     if (count === 4) level = 'Strong';
//     else if (count >= 2) level = 'Medium';
//     return { ...s, level, count };
//   };
//   const passwordStrength = getPasswordStrength(password);

//   // Form validation
//   const validateForm = () => {
//     const e = {};

//     if (!fullName.trim()) e.fullName = 'Full name is required';
//     if (!email.trim()) e.email = 'Email is required';
//     else if (!/\S+@\S+\.\S+/.test(email)) e.email = 'Email is invalid';

//     if (!password) e.password = 'Password is required';
//     else if (passwordStrength.count < 4) e.password = 'Password must meet all requirements';

//     if (!confirmPassword) e.confirmPassword = 'Please confirm your password';
//     else if (password !== confirmPassword) e.confirmPassword = 'Passwords do not match';

//     if (!termsAccepted) e.agreeTerms = 'You must accept the Terms & Conditions';
//     if (!consentData) e.consentData = 'You must consent to data processing';

//     setValidationErrors(e);
//     return Object.keys(e).length === 0;
//   };

//   // Terms checkbox click
//   const handleTermsCheckboxClick = (e) => {
//     e.preventDefault();
//     if (!termsAccepted) {
//       setShowTermsModal(true);
//     } else {
//       setAgreeTerms(false);
//       setTermsAccepted(false);
//     }
//   };

//   const handleAcceptTerms = () => {
//     setTermsAccepted(true);
//     setAgreeTerms(true);
//     setShowTermsModal(false);
//   };

//   // Navigation
//   const go = (path) => {
//     if (window.history?.pushState) {
//       window.history.pushState({}, '', path);
//       window.dispatchEvent(new PopStateEvent('popstate'));
//     } else {
//       window.location.href = path;
//     }
//   };
//   const handleBackToHome = () => go('/');
//   const handleLoginClick = (e) => {
//     e.preventDefault();
//     go('/login');
//   };

//   // Register
//   const handleRegister = async () => {
//     setError('');
//     setValidationErrors({});
//     if (!validateForm()) return;

//     setIsLoading(true);
//     try {
//       const data = await ApiService.register({
//         username: fullName,
//         email,
//         password,
//       });

//       if (data.token) localStorage.setItem('token', data.token);
//       alert('Registration successful! Redirecting to login...');
//       go('/login');
//     } catch (err) {
//       setError(err.message || 'Registration failed');
//     } finally {
//       setIsLoading(false);
//     }
//   };

//   return (
//     <>
//       <div className="min-h-screen flex flex-col lg:flex-row font-sans">
//         {/* LEFT - FORM */}
//         <div className="w-full lg:w-1/2 bg-white flex items-center justify-center p-4 sm:p-6 md:p-8 lg:p-12">
//           <div className="max-w-md w-full">
//             {/* Logo */}
//             <div className="flex justify-center mb-6 sm:mb-8">
//               <div
//                 className="w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 rounded-lg flex items-center justify-center"
//                 style={{ backgroundColor: '#1AA49B' }}
//               >
//                 <svg
//                   className="w-7 h-7 sm:w-9 sm:h-9 md:w-10 md:h-10 text-white"
//                   viewBox="0 0 24 24"
//                   fill="currentColor"
//                 >
//                   <path d="M3 3h8l4 4-4 4H3V3zm10 10h8v8h-8l-4-4 4-4z" />
//                 </svg>
//               </div>
//             </div>

//             <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2 text-center">
//               Welcome to JuriNex
//             </h2>
//             <p className="text-gray-500 mb-6 sm:mb-8 text-center text-xs sm:text-sm">
//               Create your account to get started
//             </p>

//             {error && (
//               <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
//                 <p className="text-xs sm:text-sm text-red-600">{error}</p>
//               </div>
//             )}

//             {/* FORM */}
//             <div className="space-y-3 sm:space-y-4">
//               {/* Full Name */}
//               <div>
//                 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
//                   Full Name
//                 </label>
//                 <input
//                   type="text"
//                   placeholder="Enter your full name"
//                   className="w-full px-3 sm:px-4 py-2 sm:py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1AA49B] transition text-xs sm:text-sm text-gray-900"
//                   value={fullName}
//                   onChange={(e) => setFullName(e.target.value)}
//                 />
//                 {validationErrors.fullName && (
//                   <p className="text-xs text-red-600 mt-1">{validationErrors.fullName}</p>
//                 )}
//               </div>

//               {/* Email */}
//               <div>
//                 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
//                   Email Address
//                 </label>
//                 <input
//                   type="email"
//                   placeholder="Enter your email address"
//                   className="w-full px-3 sm:px-4 py-2 sm:py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1AA49B] transition text-xs sm:text-sm text-gray-900"
//                   value={email}
//                   onChange={(e) => setEmail(e.target.value)}
//                 />
//                 {validationErrors.email && (
//                   <p className="text-xs text-red-600 mt-1">{validationErrors.email}</p>
//                 )}
//               </div>

//               {/* Password */}
//               <div>
//                 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
//                   Password
//                 </label>
//                 <div className="relative">
//                   <input
//                     type={showPassword ? 'text' : 'password'}
//                     placeholder="***********"
//                     className="w-full px-3 sm:px-4 py-2 sm:py-2.5 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1AA49B] transition text-xs sm:text-sm text-gray-900"
//                     value={password}
//                     onChange={(e) => setPassword(e.target.value)}
//                   />
//                   <button
//                     type="button"
//                     onClick={() => setShowPassword(!showPassword)}
//                     className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
//                   >
//                     {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
//                   </button>
//                 </div>

//                 {/* Strength Bar */}
//                 {password && (
//                   <>
//                     <div className="flex gap-1 mt-2">
//                       {[1, 2, 3, 4].map((i) => (
//                         <div
//                           key={i}
//                           className="h-1 flex-1 rounded transition-colors"
//                           style={{
//                             backgroundColor:
//                               passwordStrength.count >= i
//                                 ? i === 4
//                                   ? '#10B981'
//                                   : '#21C1B6'
//                                 : '#E5E7EB',
//                           }}
//                         />
//                       ))}
//                     </div>
//                     <p className="text-xs text-gray-600 mt-1 text-right">
//                       {passwordStrength.level}
//                     </p>
//                   </>
//                 )}

//                 {/* Requirements */}
//                 {password && (
//                   <div className="mt-2 space-y-1">
//                     {[
//                       { cond: passwordStrength.length, txt: 'At least 8 characters' },
//                       { cond: passwordStrength.uppercase, txt: 'Contains an uppercase letter' },
//                       { cond: passwordStrength.number, txt: 'Contains a number' },
//                       { cond: passwordStrength.specialChar, txt: 'Contains a special character (!@#$%^&*)' },
//                     ].map((r, i) => (
//                       <div
//                         key={i}
//                         className={`flex items-center text-xs ${r.cond ? 'text-green-600' : 'text-gray-500'}`}
//                       >
//                         {r.cond ? <Check size={12} className="mr-1.5" /> : <X size={12} className="mr-1.5" />}
//                         {r.txt}
//                       </div>
//                     ))}
//                   </div>
//                 )}
//                 {validationErrors.password && (
//                   <p className="text-xs text-red-600 mt-1">{validationErrors.password}</p>
//                 )}
//               </div>

//               {/* Confirm Password */}
//               <div>
//                 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
//                   Confirm Password
//                 </label>
//                 <div className="relative">
//                   <input
//                     type={showConfirmPassword ? 'text' : 'password'}
//                     placeholder="Enter password again"
//                     className="w-full px-3 sm:px-4 py-2 sm:py-2.5 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#9CDFE1] transition text-xs sm:text-sm text-gray-900"
//                     value={confirmPassword}
//                     onChange={(e) => setConfirmPassword(e.target.value)}
//                   />
//                   <button
//                     type="button"
//                     onClick={() => setShowConfirmPassword(!showConfirmPassword)}
//                     className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
//                   >
//                     {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
//                   </button>
//                 </div>
//                 {validationErrors.confirmPassword && (
//                   <p className="text-xs text-red-600 mt-1">{validationErrors.confirmPassword}</p>
//                 )}
//               </div>

//               {/* Checkboxes */}
//               <div className="space-y-2 pt-2">
//                 <div className="flex items-start">
//                   <input
//                     type="checkbox"
//                     id="agreeTerms"
//                     className="h-3.5 w-3.5 mt-0.5 rounded border-gray-300"
//                     style={{ accentColor: '#9CDFE1' }}
//                     checked={agreeTerms}
//                     onChange={handleTermsCheckboxClick}
//                   />
//                   <label htmlFor="agreeTerms" className="ml-2 block text-xs text-gray-700">
//                     I agree to the{' '}
//                     <button
//                       type="button"
//                       onClick={() => setShowTermsModal(true)}
//                       className="font-medium hover:underline"
//                       style={{ color: '#9CDFE1' }}
//                     >
//                       Terms & Conditions
//                     </button>
//                   </label>
//                 </div>
//                 {validationErrors.agreeTerms && (
//                   <p className="text-xs text-red-600">{validationErrors.agreeTerms}</p>
//                 )}

//                 <div className="flex items-start">
//                   <input
//                     type="checkbox"
//                     id="consentData"
//                     className="h-3.5 w-3.5 mt-0.5 rounded border-gray-300"
//                     style={{ accentColor: '#9CDFE1' }}
//                     checked={consentData}
//                     onChange={(e) => setConsentData(e.target.checked)}
//                   />
//                   <label htmlFor="consentData" className="ml-2 block text-xs text-gray-700">
//                     I consent to data processing under GDPR/DPDPA guidelines
//                   </label>
//                 </div>
//                 {validationErrors.consentData && (
//                   <p className="text-xs text-red-600">{validationErrors.consentData}</p>
//                 )}
//               </div>

//               {/* Register Button */}
//               <button
//                 onClick={handleRegister}
//                 disabled={isLoading}
//                 className="w-full py-2.5 sm:py-3 mt-4 sm:mt-6 text-white font-semibold rounded-lg transition flex items-center justify-center text-sm sm:text-base disabled:opacity-70"
//                 style={{
//                   backgroundColor: isLoading ? '#9CA3AF' : '#21C1B6',
//                 }}
//                 onMouseEnter={(e) =>
//                   !isLoading && (e.currentTarget.style.backgroundColor = '#1AA49B')
//                 }
//                 onMouseLeave={(e) =>
//                   !isLoading && (e.currentTarget.style.backgroundColor = '#21C1B6')
//                 }
//               >
//                 {isLoading ? (
//                   <>
//                     <Loader2 className="animate-spin mr-2" size={16} />
//                     Registering...
//                   </>
//                 ) : (
//                   'Register'
//                 )}
//               </button>
//             </div>

//             {/* LOGIN + BACK TO HOME – CENTERED BELOW */}
//             <div className="mt-4 sm:mt-6 text-center">
//               <p className="text-xs sm:text-sm text-gray-600">
//                 Already have an account?{' '}
//                 <button onClick={handleLoginClick} className="font-semibold text-gray-900 hover:underline">
//                   Login
//                 </button>
//               </p>

//               {/* EXACTLY CENTERED BELOW */}
//               <button
//                 onClick={handleBackToHome}
//                 className="mt-3 flex items-center justify-center w-full text-gray-600 hover:text-gray-800 transition-colors text-xs sm:text-sm"
//               >
//                 <ArrowLeft size={14} className="mr-1.5" />
//                 Back to Home
//               </button>
//             </div>
//           </div>
//         </div>

//         {/* RIGHT - VISUAL */}
//         <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-gray-800 via-gray-900 to-gray-950 items-center justify-center p-8 xl:p-12 relative overflow-hidden">
//           <div className="absolute inset-0 opacity-10">
//             <div className="absolute top-20 right-20 w-48 h-48 xl:w-64 xl:h-64 rounded-full blur-3xl" style={{ backgroundColor: '#1AA49B' }}></div>
//             <div className="absolute bottom-20 left-20 w-48 h-48 xl:w-64 xl:h-64 bg-blue-500 rounded-full blur-3xl"></div>
//           </div>

//           <div className="max-w-lg text-white relative z-10">
//             <div className="mb-8 relative">
//               <div className="bg-gradient-to-br from-gray-700 to-gray-800 rounded-2xl p-6 xl:p-8 shadow-2xl">
//                 <div className="flex gap-2 mb-6">
//                   <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//                   <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//                   <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//                 </div>

//                 <div className="flex gap-3 xl:gap-4 items-center justify-center">
//                   <div className="space-y-2 xl:space-y-3">
//                     <div className="w-10 h-10 xl:w-12 xl:h-12 rounded-lg" style={{ backgroundColor: '#1AA49B' }}></div>
//                     <div className="w-10 h-10 xl:w-12 xl:h-12 bg-gray-700 rounded-lg"></div>
//                     <div className="w-10 h-10 xl:w-12 xl:h-12 bg-gray-700 rounded-lg"></div>
//                   </div>

//                   <div className="bg-white rounded-lg p-3 xl:p-4 w-40 xl:w-48">
//                     <div className="space-y-2">
//                       <div className="h-3 rounded w-3/4" style={{ backgroundColor: '#1AA49B' }}></div>
//                       <div className="h-2 bg-gray-300 rounded"></div>
//                       <div className="h-2 bg-gray-300 rounded"></div>
//                       <div className="h-2 bg-gray-300 rounded w-5/6"></div>
//                     </div>
//                   </div>

//                   <div className="space-y-3 xl:space-y-4">
//                     <div className="w-12 h-12 xl:w-16 xl:h-16 relative">
//                       <div className="absolute top-0 right-0 w-6 h-10 xl:w-8 xl:h-12 bg-gray-600 rounded transform rotate-45"></div>
//                       <div className="absolute bottom-0 left-0 w-10 h-5 xl:w-12 xl:h-6 rounded" style={{ backgroundColor: '#1AA49B' }}></div>
//                     </div>
//                     <div className="w-12 h-12 xl:w-16 xl:h-16 flex items-end justify-center">
//                       <div className="w-10 h-10 xl:w-12 xl:h-12 border-4 border-gray-600 rounded-full relative">
//                         <div className="absolute -top-5 xl:-top-6 left-1/2 -translate-x-1/2 w-1 h-6 xl:h-8 bg-gray-600"></div>
//                       </div>
//                     </div>
//                   </div>
//                 </div>
//               </div>
//             </div>

//             <h2 className="text-3xl xl:text-4xl font-bold mb-6 xl:mb-8 leading-tight text-center">
//               Automate Your Legal Workflow in Minutes
//             </h2>

//             <div className="space-y-5 xl:space-y-6 bg-gradient-to-br from-gray-800/50 to-gray-900/50 backdrop-blur-sm rounded-2xl p-5 xl:p-6">
//               <div className="flex items-start gap-3 xl:gap-4">
//                 <div className="w-9 h-9 xl:w-10 xl:h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                   <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                     <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z"/>
//                   </svg>
//                 </div>
//                 <div>
//                   <h3 className="text-base xl:text-lg font-semibold mb-1">Accelerate case preparation</h3>
//                   <p className="text-gray-400 text-xs xl:text-sm">in minutes with AI-powered tools</p>
//                 </div>
//               </div>

//               <div className="flex items-start gap-3 xl:gap-4">
//                 <div className="w-9 h-9 xl:w-10 xl:h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                   <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                     <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/>
//                   </svg>
//                 </div>
//                 <div>
//                   <h3 className="text-base xl:text-lg font-semibold mb-1">Smart Document Vault</h3>
//                   <p className="text-gray-400 text-xs xl:text-sm">Secure, searchable, and organized</p>
//                 </div>
//               </div>

//               <div className="flex items-start gap-3 xl:gap-4">
//                 <div className="w-9 h-9 xl:w-10 xl:h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                   <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                     <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/>
//                   </svg>
//                 </div>
//                 <div>
//                   <h3 className="text-base xl:text-lg font-semibold mb-1">Trusted Legal Insights</h3>
//                   <p className="text-gray-400 text-xs xl:text-sm">AI-driven precedents & analysis</p>
//                 </div>
//               </div>
//             </div>
//           </div>
//         </div>
//       </div>

//       {/* TERMS MODAL - Rendered outside main container as overlay */}
//       <TermsAndConditions
//         isOpen={showTermsModal}
//         onClose={() => setShowTermsModal(false)}
//         onAccept={handleAcceptTerms}
//         showAcceptButton
//         companyName="NexIntel AI"
//         effectiveDate="January 1, 2025"
//       />
//     </>
//   );
// };

// export default RegisterPage;


// import React, { useState } from 'react';
// import { Eye, EyeOff, Check, X, Loader2, ArrowLeft } from 'lucide-react';
// import ApiService from '../../services/api';
// import TermsAndConditions from '../../components/TermsAndConditions';
// // Import the logo image
// import JuriNexLogo from '../../assets/JuriNex_gavel_logo.png';

// const RegisterPage = () => {
//   const [fullName, setFullName] = useState('');
//   const [email, setEmail] = useState('');
//   const [password, setPassword] = useState('');
//   const [confirmPassword, setConfirmPassword] = useState('');
//   const [agreeTerms, setAgreeTerms] = useState(false);
//   const [consentData, setConsentData] = useState(false);
//   const [showPassword, setShowPassword] = useState(false);
//   const [showConfirmPassword, setShowConfirmPassword] = useState(false);
//   const [isLoading, setIsLoading] = useState(false);
//   const [error, setError] = useState('');
//   const [validationErrors, setValidationErrors] = useState({});
//   const [showTermsModal, setShowTermsModal] = useState(false);
//   const [termsAccepted, setTermsAccepted] = useState(false);
//   const [logoError, setLogoError] = useState(false);

//   // Logo component with fallback
//   const LogoComponent = ({ size = "w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16" }) => {
//     if (logoError) {
//       // Fallback SVG logo if image fails to load
//       return (
//         <div
//           className={`${size} rounded-lg flex items-center justify-center`}
//           style={{ backgroundColor: "#1AA49B" }}
//         >
//           <svg
//             className="w-7 h-7 sm:w-9 sm:h-9 md:w-10 md:h-10 text-white"
//             viewBox="0 0 24 24"
//             fill="currentColor"
//           >
//             <path d="M3 3h8l4 4-4 4H3V3zm10 10h8v8h-8l-4-4 4-4z" />
//           </svg>
//         </div>
//       );
//     }

//     return (
//       <div className={`${size} rounded-lg flex items-center justify-center overflow-hidden bg-gray-100`}>
//         <img
//           src={JuriNexLogo}
//           alt="JuriNex Logo"
//           className="w-full h-full object-contain"
//           onError={() => setLogoError(true)}
//           onLoad={() => setLogoError(false)}
//         />
//       </div>
//     );
//   };

//   // Password strength
//   const getPasswordStrength = (pwd) => {
//     const s = {
//       length: pwd.length >= 8,
//       uppercase: /[A-Z]/.test(pwd),
//       number: /[0-9]/.test(pwd),
//       specialChar: /[!@#$%^&*(),.?":{}|<>]/.test(pwd),
//     };
//     const count = Object.values(s).filter(Boolean).length;
//     let level = 'Weak';
//     if (count === 4) level = 'Strong';
//     else if (count >= 2) level = 'Medium';
//     return { ...s, level, count };
//   };
//   const passwordStrength = getPasswordStrength(password);

//   // Form validation
//   const validateForm = () => {
//     const e = {};

//     if (!fullName.trim()) e.fullName = 'Full name is required';
//     if (!email.trim()) e.email = 'Email is required';
//     else if (!/\S+@\S+\.\S+/.test(email)) e.email = 'Email is invalid';

//     if (!password) e.password = 'Password is required';
//     else if (passwordStrength.count < 4) e.password = 'Password must meet all requirements';

//     if (!confirmPassword) e.confirmPassword = 'Please confirm your password';
//     else if (password !== confirmPassword) e.confirmPassword = 'Passwords do not match';

//     if (!termsAccepted) e.agreeTerms = 'You must accept the Terms & Conditions';
//     if (!consentData) e.consentData = 'You must consent to data processing';

//     setValidationErrors(e);
//     return Object.keys(e).length === 0;
//   };

//   // Terms checkbox click
//   const handleTermsCheckboxClick = (e) => {
//     e.preventDefault();
//     if (!termsAccepted) {
//       setShowTermsModal(true);
//     } else {
//       setAgreeTerms(false);
//       setTermsAccepted(false);
//     }
//   };

//   const handleAcceptTerms = () => {
//     setTermsAccepted(true);
//     setAgreeTerms(true);
//     setShowTermsModal(false);
//   };

//   // Navigation
//   const go = (path) => {
//     if (window.history?.pushState) {
//       window.history.pushState({}, '', path);
//       window.dispatchEvent(new PopStateEvent('popstate'));
//     } else {
//       window.location.href = path;
//     }
//   };
//   const handleBackToHome = () => go('/');
//   const handleLoginClick = (e) => {
//     e.preventDefault();
//     go('/login');
//   };

//   // Register
//   const handleRegister = async () => {
//     setError('');
//     setValidationErrors({});
//     if (!validateForm()) return;

//     setIsLoading(true);
//     try {
//       const data = await ApiService.register({
//         username: fullName,
//         email,
//         password,
//       });

//       if (data.token) localStorage.setItem('token', data.token);
//       alert('Registration successful! Redirecting to login...');
//       go('/login');
//     } catch (err) {
//       setError(err.message || 'Registration failed');
//     } finally {
//       setIsLoading(false);
//     }
//   };

//   return (
//     <>
//       <div className="min-h-screen flex flex-col lg:flex-row font-sans">
//         {/* LEFT - FORM */}
//         <div className="w-full lg:w-1/2 bg-white flex items-center justify-center p-4 sm:p-6 md:p-8 lg:p-12">
//           <div className="max-w-md w-full">
//             {/* Logo */}
//             <div className="flex justify-center mb-6 sm:mb-8">
//               <LogoComponent />
//             </div>

//             <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2 text-center">
//               Welcome to JuriNex
//             </h2>
//             <p className="text-gray-500 mb-6 sm:mb-8 text-center text-xs sm:text-sm">
//               Create your account to get started
//             </p>

//             {error && (
//               <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
//                 <p className="text-xs sm:text-sm text-red-600">{error}</p>
//               </div>
//             )}

//             {/* FORM */}
//             <div className="space-y-3 sm:space-y-4">
//               {/* Full Name */}
//               <div>
//                 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
//                   Full Name
//                 </label>
//                 <input
//                   type="text"
//                   placeholder="Enter your full name"
//                   className="w-full px-3 sm:px-4 py-2 sm:py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1AA49B] transition text-xs sm:text-sm text-gray-900"
//                   value={fullName}
//                   onChange={(e) => setFullName(e.target.value)}
//                 />
//                 {validationErrors.fullName && (
//                   <p className="text-xs text-red-600 mt-1">{validationErrors.fullName}</p>
//                 )}
//               </div>

//               {/* Email */}
//               <div>
//                 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
//                   Email Address
//                 </label>
//                 <input
//                   type="email"
//                   placeholder="Enter your email address"
//                   className="w-full px-3 sm:px-4 py-2 sm:py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1AA49B] transition text-xs sm:text-sm text-gray-900"
//                   value={email}
//                   onChange={(e) => setEmail(e.target.value)}
//                 />
//                 {validationErrors.email && (
//                   <p className="text-xs text-red-600 mt-1">{validationErrors.email}</p>
//                 )}
//               </div>

//               {/* Password */}
//               <div>
//                 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
//                   Password
//                 </label>
//                 <div className="relative">
//                   <input
//                     type={showPassword ? 'text' : 'password'}
//                     placeholder="***********"
//                     className="w-full px-3 sm:px-4 py-2 sm:py-2.5 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1AA49B] transition text-xs sm:text-sm text-gray-900"
//                     value={password}
//                     onChange={(e) => setPassword(e.target.value)}
//                   />
//                   <button
//                     type="button"
//                     onClick={() => setShowPassword(!showPassword)}
//                     className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
//                   >
//                     {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
//                   </button>
//                 </div>

//                 {/* Strength Bar */}
//                 {password && (
//                   <>
//                     <div className="flex gap-1 mt-2">
//                       {[1, 2, 3, 4].map((i) => (
//                         <div
//                           key={i}
//                           className="h-1 flex-1 rounded transition-colors"
//                           style={{
//                             backgroundColor:
//                               passwordStrength.count >= i
//                                 ? i === 4
//                                   ? '#10B981'
//                                   : '#21C1B6'
//                                 : '#E5E7EB',
//                           }}
//                         />
//                       ))}
//                     </div>
//                     <p className="text-xs text-gray-600 mt-1 text-right">
//                       {passwordStrength.level}
//                     </p>
//                   </>
//                 )}

//                 {/* Requirements */}
//                 {password && (
//                   <div className="mt-2 space-y-1">
//                     {[
//                       { cond: passwordStrength.length, txt: 'At least 8 characters' },
//                       { cond: passwordStrength.uppercase, txt: 'Contains an uppercase letter' },
//                       { cond: passwordStrength.number, txt: 'Contains a number' },
//                       { cond: passwordStrength.specialChar, txt: 'Contains a special character (!@#$%^&*)' },
//                     ].map((r, i) => (
//                       <div
//                         key={i}
//                         className={`flex items-center text-xs ${r.cond ? 'text-green-600' : 'text-gray-500'}`}
//                       >
//                         {r.cond ? <Check size={12} className="mr-1.5" /> : <X size={12} className="mr-1.5" />}
//                         {r.txt}
//                       </div>
//                     ))}
//                   </div>
//                 )}
//                 {validationErrors.password && (
//                   <p className="text-xs text-red-600 mt-1">{validationErrors.password}</p>
//                 )}
//               </div>

//               {/* Confirm Password */}
//               <div>
//                 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
//                   Confirm Password
//                 </label>
//                 <div className="relative">
//                   <input
//                     type={showConfirmPassword ? 'text' : 'password'}
//                     placeholder="Enter password again"
//                     className="w-full px-3 sm:px-4 py-2 sm:py-2.5 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#9CDFE1] transition text-xs sm:text-sm text-gray-900"
//                     value={confirmPassword}
//                     onChange={(e) => setConfirmPassword(e.target.value)}
//                   />
//                   <button
//                     type="button"
//                     onClick={() => setShowConfirmPassword(!showConfirmPassword)}
//                     className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
//                   >
//                     {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
//                   </button>
//                 </div>
//                 {validationErrors.confirmPassword && (
//                   <p className="text-xs text-red-600 mt-1">{validationErrors.confirmPassword}</p>
//                 )}
//               </div>

//               {/* Checkboxes */}
//               <div className="space-y-2 pt-2">
//                 <div className="flex items-start">
//                   <input
//                     type="checkbox"
//                     id="agreeTerms"
//                     className="h-3.5 w-3.5 mt-0.5 rounded border-gray-300"
//                     style={{ accentColor: '#9CDFE1' }}
//                     checked={agreeTerms}
//                     onChange={handleTermsCheckboxClick}
//                   />
//                   <label htmlFor="agreeTerms" className="ml-2 block text-xs text-gray-700">
//                     I agree to the{' '}
//                     <button
//                       type="button"
//                       onClick={() => setShowTermsModal(true)}
//                       className="font-medium hover:underline"
//                       style={{ color: '#40a0a3ff' }}
//                     >
//                       Terms & Conditions
//                     </button>
//                   </label>
//                 </div>
//                 {validationErrors.agreeTerms && (
//                   <p className="text-xs text-red-600">{validationErrors.agreeTerms}</p>
//                 )}

//                 <div className="flex items-start">
//                   <input
//                     type="checkbox"
//                     id="consentData"
//                     className="h-3.5 w-3.5 mt-0.5 rounded border-gray-300"
//                     style={{ accentColor: '#9CDFE1' }}
//                     checked={consentData}
//                     onChange={(e) => setConsentData(e.target.checked)}
//                   />
//                   <label htmlFor="consentData" className="ml-2 block text-xs text-gray-700">
//                     I consent to data processing under GDPR/DPDPA guidelines
//                   </label>
//                 </div>
//                 {validationErrors.consentData && (
//                   <p className="text-xs text-red-600">{validationErrors.consentData}</p>
//                 )}
//               </div>

//               {/* Register Button */}
//               <button
//                 onClick={handleRegister}
//                 disabled={isLoading}
//                 className="w-full py-2.5 sm:py-3 mt-4 sm:mt-6 text-white font-semibold rounded-lg transition flex items-center justify-center text-sm sm:text-base disabled:opacity-70"
//                 style={{
//                   backgroundColor: isLoading ? '#9CA3AF' : '#21C1B6',
//                 }}
//                 onMouseEnter={(e) =>
//                   !isLoading && (e.currentTarget.style.backgroundColor = '#1AA49B')
//                 }
//                 onMouseLeave={(e) =>
//                   !isLoading && (e.currentTarget.style.backgroundColor = '#21C1B6')
//                 }
//               >
//                 {isLoading ? (
//                   <>
//                     <Loader2 className="animate-spin mr-2" size={16} />
//                     Registering...
//                   </>
//                 ) : (
//                   'Register'
//                 )}
//               </button>
//             </div>

//             {/* LOGIN + BACK TO HOME – CENTERED BELOW */}
//             <div className="mt-4 sm:mt-6 text-center">
//               <p className="text-xs sm:text-sm text-gray-600">
//                 Already have an account?{' '}
//                 <button onClick={handleLoginClick} className="font-semibold text-gray-900 hover:underline">
//                   Login
//                 </button>
//               </p>

//               {/* EXACTLY CENTERED BELOW */}
//               <button
//                 onClick={handleBackToHome}
//                 className="mt-3 flex items-center justify-center w-full text-gray-600 hover:text-gray-800 transition-colors text-xs sm:text-sm"
//               >
//                 <ArrowLeft size={14} className="mr-1.5" />
//                 Back to Home
//               </button>
//             </div>
//           </div>
//         </div>

//         {/* RIGHT - VISUAL */}
//         <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-gray-800 via-gray-900 to-gray-950 items-center justify-center p-8 xl:p-12 relative overflow-hidden">
//           <div className="absolute inset-0 opacity-10">
//             <div className="absolute top-20 right-20 w-48 h-48 xl:w-64 xl:h-64 rounded-full blur-3xl" style={{ backgroundColor: '#1AA49B' }}></div>
//             <div className="absolute bottom-20 left-20 w-48 h-48 xl:w-64 xl:h-64 bg-blue-500 rounded-full blur-3xl"></div>
//           </div>

//           <div className="max-w-lg text-white relative z-10">
//             <div className="mb-8 relative">
//               <div className="bg-gradient-to-br from-gray-700 to-gray-800 rounded-2xl p-6 xl:p-8 shadow-2xl">
//                 <div className="flex gap-2 mb-6">
//                   <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//                   <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//                   <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//                 </div>

//                 <div className="flex gap-3 xl:gap-4 items-center justify-center">
//                   <div className="space-y-2 xl:space-y-3">
//                     <div className="w-10 h-10 xl:w-12 xl:h-12 rounded-lg" style={{ backgroundColor: '#1AA49B' }}></div>
//                     <div className="w-10 h-10 xl:w-12 xl:h-12 bg-gray-700 rounded-lg"></div>
//                     <div className="w-10 h-10 xl:w-12 xl:h-12 bg-gray-700 rounded-lg"></div>
//                   </div>

//                   <div className="bg-white rounded-lg p-3 xl:p-4 w-40 xl:w-48">
//                     <div className="space-y-2">
//                       <div className="h-3 rounded w-3/4" style={{ backgroundColor: '#1AA49B' }}></div>
//                       <div className="h-2 bg-gray-300 rounded"></div>
//                       <div className="h-2 bg-gray-300 rounded"></div>
//                       <div className="h-2 bg-gray-300 rounded w-5/6"></div>
//                     </div>
//                   </div>

//                   <div className="space-y-3 xl:space-y-4">
//                     <div className="w-12 h-12 xl:w-16 xl:h-16 relative">
//                       <div className="absolute top-0 right-0 w-6 h-10 xl:w-8 xl:h-12 bg-gray-600 rounded transform rotate-45"></div>
//                       <div className="absolute bottom-0 left-0 w-10 h-5 xl:w-12 xl:h-6 rounded" style={{ backgroundColor: '#1AA49B' }}></div>
//                     </div>
//                     <div className="w-12 h-12 xl:w-16 xl:h-16 flex items-end justify-center">
//                       <div className="w-10 h-10 xl:w-12 xl:h-12 border-4 border-gray-600 rounded-full relative">
//                         <div className="absolute -top-5 xl:-top-6 left-1/2 -translate-x-1/2 w-1 h-6 xl:h-8 bg-gray-600"></div>
//                       </div>
//                     </div>
//                   </div>
//                 </div>
//               </div>
//             </div>

//             <h2 className="text-3xl xl:text-4xl font-bold mb-6 xl:mb-8 leading-tight text-center">
//               Automate Your Legal Workflow in Minutes
//             </h2>

//             <div className="space-y-5 xl:space-y-6 bg-gradient-to-br from-gray-800/50 to-gray-900/50 backdrop-blur-sm rounded-2xl p-5 xl:p-6">
//               <div className="flex items-start gap-3 xl:gap-4">
//                 <div className="w-9 h-9 xl:w-10 xl:h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                   <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                     <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z"/>
//                   </svg>
//                 </div>
//                 <div>
//                   <h3 className="text-base xl:text-lg font-semibold mb-1">Accelerate case preparation</h3>
//                   <p className="text-gray-400 text-xs xl:text-sm">in minutes with AI-powered tools</p>
//                 </div>
//               </div>

//               <div className="flex items-start gap-3 xl:gap-4">
//                 <div className="w-9 h-9 xl:w-10 xl:h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                   <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                     <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/>
//                   </svg>
//                 </div>
//                 <div>
//                   <h3 className="text-base xl:text-lg font-semibold mb-1">Smart Document Vault</h3>
//                   <p className="text-gray-400 text-xs xl:text-sm">Secure, searchable, and organized</p>
//                 </div>
//               </div>

//               <div className="flex items-start gap-3 xl:gap-4">
//                 <div className="w-9 h-9 xl:w-10 xl:h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                   <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                     <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/>
//                   </svg>
//                 </div>
//                 <div>
//                   <h3 className="text-base xl:text-lg font-semibold mb-1">Trusted Legal Insights</h3>
//                   <p className="text-gray-400 text-xs xl:text-sm">AI-driven precedents & analysis</p>
//                 </div>
//               </div>
//             </div>
//           </div>
//         </div>
//       </div>

//       {/* TERMS MODAL - Rendered outside main container as overlay */}
//       <TermsAndConditions
//         isOpen={showTermsModal}
//         onClose={() => setShowTermsModal(false)}
//         onAccept={handleAcceptTerms}
//         showAcceptButton
//         companyName="NexIntelAI"
//         effectiveDate="January 1, 2025"
//       />
//     </>
//   );
// };

// export default RegisterPage;


import React, { useState } from 'react';
import { Eye, EyeOff, Check, X, Loader2, ArrowLeft } from 'lucide-react';
import ApiService from '../../services/api';
import TermsAndConditions from '../../components/TermsAndConditions';
import JuriNexLogo from '../../assets/JuriNex_gavel_logo.png';
import AdvocateImage from '../../assets/advocate.png';

const RegisterPage = () => {
 const [fullName, setFullName] = useState('');
 const [email, setEmail] = useState('');
 const [password, setPassword] = useState('');
 const [confirmPassword, setConfirmPassword] = useState('');
 const [agreeTerms, setAgreeTerms] = useState(false);
 const [consentData, setConsentData] = useState(false);
 const [showPassword, setShowPassword] = useState(false);
 const [showConfirmPassword, setShowConfirmPassword] = useState(false);
 const [isLoading, setIsLoading] = useState(false);
 const [error, setError] = useState('');
 const [validationErrors, setValidationErrors] = useState({});
 const [showTermsModal, setShowTermsModal] = useState(false);
 const [termsAccepted, setTermsAccepted] = useState(false);
 const [logoError, setLogoError] = useState(false);

 // Logo component with fallback
 const LogoComponent = ({ size = "w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16" }) => {
 if (logoError) {
 // Fallback SVG logo if image fails to load
 return (
 <div
 className={`${size} rounded-lg flex items-center justify-center`}
 style={{ backgroundColor: "#1AA49B" }}
 >
 <svg
 className="w-7 h-7 sm:w-9 sm:h-9 md:w-10 md:h-10 text-white"
 viewBox="0 0 24 24"
 fill="currentColor"
 >
 <path d="M3 3h8l4 4-4 4H3V3zm10 10h8v8h-8l-4-4 4-4z" />
 </svg>
 </div>
 );
 }

 return (
 <div className={`${size} rounded-lg flex items-center justify-center overflow-hidden bg-gray-100`}>
 <img
 src={JuriNexLogo}
 alt="JuriNex Logo"
 className="w-full h-full object-contain"
 onError={() => setLogoError(true)}
 onLoad={() => setLogoError(false)}
 />
 </div>
 );
 };

 // Password strength
 const getPasswordStrength = (pwd) => {
 const s = {
 length: pwd.length >= 8,
 uppercase: /[A-Z]/.test(pwd),
 number: /[0-9]/.test(pwd),
 specialChar: /[!@#$%^&*(),.?":{}|<>]/.test(pwd),
 };
 const count = Object.values(s).filter(Boolean).length;
 let level = 'Weak';
 if (count === 4) level = 'Strong';
 else if (count >= 2) level = 'Medium';
 return { ...s, level, count };
 };
 const passwordStrength = getPasswordStrength(password);

 // Form validation
 const validateForm = () => {
 const e = {};

 if (!fullName.trim()) e.fullName = 'Full name is required';
 if (!email.trim()) e.email = 'Email is required';
 else if (!/\S+@\S+\.\S+/.test(email)) e.email = 'Email is invalid';

 if (!password) e.password = 'Password is required';
 else if (passwordStrength.count < 4) e.password = 'Password must meet all requirements';

 if (!confirmPassword) e.confirmPassword = 'Please confirm your password';
 else if (password !== confirmPassword) e.confirmPassword = 'Passwords do not match';

 if (!termsAccepted) e.agreeTerms = 'You must accept the Terms & Conditions';
 if (!consentData) e.consentData = 'You must consent to data processing';

 setValidationErrors(e);
 return Object.keys(e).length === 0;
 };

 // Terms checkbox click
 const handleTermsCheckboxClick = (e) => {
 e.preventDefault();
 if (!termsAccepted) {
 setShowTermsModal(true);
 } else {
 setAgreeTerms(false);
 setTermsAccepted(false);
 }
 };

 const handleAcceptTerms = () => {
 setTermsAccepted(true);
 setAgreeTerms(true);
 setShowTermsModal(false);
 };

 // Navigation
 const go = (path) => {
 if (window.history?.pushState) {
 window.history.pushState({}, '', path);
 window.dispatchEvent(new PopStateEvent('popstate'));
 } else {
 window.location.href = path;
 }
 };
 const handleBackToHome = () => go('/');
 const handleLoginClick = (e) => {
 e.preventDefault();
 go('/login');
 };

 // Register
 const handleRegister = async () => {
 setError('');
 setValidationErrors({});
 if (!validateForm()) return;

 setIsLoading(true);
 try {
 const data = await ApiService.register({
 username: fullName,
 email,
 password,
 });

 if (data.token) localStorage.setItem('token', data.token);
 alert('Registration successful! Redirecting to login...');
 go('/login');
 } catch (err) {
 setError(err.message || 'Registration failed');
 } finally {
 setIsLoading(false);
 }
 };

 return (
 <>
 <div className="min-h-screen flex flex-col lg:flex-row font-sans">
 {/* LEFT - FORM */}
 <div className="w-full lg:w-1/2 bg-white flex items-center justify-center p-4 sm:p-6 md:p-8 lg:p-12">
 <div className="max-w-md w-full">
 {/* Logo */}
 <div className="flex justify-center mb-6 sm:mb-8">
 <LogoComponent />
 </div>

 <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2 text-center">
 Welcome to JuriNex
 </h2>
 <p className="text-gray-500 mb-6 sm:mb-8 text-center text-xs sm:text-sm">
 Create your account to get started
 </p>

 {error && (
 <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
 <p className="text-xs sm:text-sm text-red-600">{error}</p>
 </div>
 )}

 {/* FORM */}
 <div className="space-y-3 sm:space-y-4">
 {/* Full Name */}
 <div>
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
 Full Name
 </label>
 <input
 type="text"
 placeholder="Enter your full name"
 className="w-full px-3 sm:px-4 py-2 sm:py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1AA49B] transition text-xs sm:text-sm text-gray-900"
 value={fullName}
 onChange={(e) => setFullName(e.target.value)}
 />
 {validationErrors.fullName && (
 <p className="text-xs text-red-600 mt-1">{validationErrors.fullName}</p>
 )}
 </div>

 {/* Email */}
 <div>
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
 Email Address
 </label>
 <input
 type="email"
 placeholder="Enter your email address"
 className="w-full px-3 sm:px-4 py-2 sm:py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1AA49B] transition text-xs sm:text-sm text-gray-900"
 value={email}
 onChange={(e) => setEmail(e.target.value)}
 />
 {validationErrors.email && (
 <p className="text-xs text-red-600 mt-1">{validationErrors.email}</p>
 )}
 </div>

 {/* Password */}
 <div>
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
 Password
 </label>
 <div className="relative">
 <input
 type={showPassword ? 'text' : 'password'}
 placeholder="***********"
 className="w-full px-3 sm:px-4 py-2 sm:py-2.5 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1AA49B] transition text-xs sm:text-sm text-gray-900"
 value={password}
 onChange={(e) => setPassword(e.target.value)}
 />
 <button
 type="button"
 onClick={() => setShowPassword(!showPassword)}
 className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
 >
 {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
 </button>
 </div>

 {/* Strength Bar */}
 {password && (
 <>
 <div className="flex gap-1 mt-2">
 {[1, 2, 3, 4].map((i) => (
 <div
 key={i}
 className="h-1 flex-1 rounded transition-colors"
 style={{
 backgroundColor:
 passwordStrength.count >= i
 ? i === 4
 ? '#10B981'
 : '#21C1B6'
 : '#E5E7EB',
 }}
 />
 ))}
 </div>
 <p className="text-xs text-gray-600 mt-1 text-right">
 {passwordStrength.level}
 </p>
 </>
 )}

 {/* Requirements */}
 {password && (
 <div className="mt-2 space-y-1">
 {[
 { cond: passwordStrength.length, txt: 'At least 8 characters' },
 { cond: passwordStrength.uppercase, txt: 'Contains an uppercase letter' },
 { cond: passwordStrength.number, txt: 'Contains a number' },
 { cond: passwordStrength.specialChar, txt: 'Contains a special character (!@#$%^&*)' },
 ].map((r, i) => (
 <div
 key={i}
 className={`flex items-center text-xs ${r.cond ? 'text-green-600' : 'text-gray-500'}`}
 >
 {r.cond ? <Check size={12} className="mr-1.5" /> : <X size={12} className="mr-1.5" />}
 {r.txt}
 </div>
 ))}
 </div>
 )}
 {validationErrors.password && (
 <p className="text-xs text-red-600 mt-1">{validationErrors.password}</p>
 )}
 </div>

 {/* Confirm Password */}
 <div>
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
 Confirm Password
 </label>
 <div className="relative">
 <input
 type={showConfirmPassword ? 'text' : 'password'}
 placeholder="Enter password again"
 className="w-full px-3 sm:px-4 py-2 sm:py-2.5 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#9CDFE1] transition text-xs sm:text-sm text-gray-900"
 value={confirmPassword}
 onChange={(e) => setConfirmPassword(e.target.value)}
 />
 <button
 type="button"
 onClick={() => setShowConfirmPassword(!showConfirmPassword)}
 className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
 >
 {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
 </button>
 </div>
 {validationErrors.confirmPassword && (
 <p className="text-xs text-red-600 mt-1">{validationErrors.confirmPassword}</p>
 )}
 </div>

 {/* Checkboxes */}
 <div className="space-y-2 pt-2">
 <div className="flex items-start">
 <input
 type="checkbox"
 id="agreeTerms"
 className="h-3.5 w-3.5 mt-0.5 rounded border-gray-300"
 style={{ accentColor: '#9CDFE1' }}
 checked={agreeTerms}
 onChange={handleTermsCheckboxClick}
 />
 <label htmlFor="agreeTerms" className="ml-2 block text-xs text-gray-700">
 I agree to the{' '}
 <button
 type="button"
 onClick={() => setShowTermsModal(true)}
 className="font-medium hover:underline"
 style={{ color: '#40a0a3ff' }}
 >
 Terms & Conditions
 </button>
 </label>
 </div>
 {validationErrors.agreeTerms && (
 <p className="text-xs text-red-600">{validationErrors.agreeTerms}</p>
 )}

 <div className="flex items-start">
 <input
 type="checkbox"
 id="consentData"
 className="h-3.5 w-3.5 mt-0.5 rounded border-gray-300"
 style={{ accentColor: '#9CDFE1' }}
 checked={consentData}
 onChange={(e) => setConsentData(e.target.checked)}
 />
 <label htmlFor="consentData" className="ml-2 block text-xs text-gray-700">
 I consent to data processing under GDPR/DPDPA guidelines
 </label>
 </div>
 {validationErrors.consentData && (
 <p className="text-xs text-red-600">{validationErrors.consentData}</p>
 )}
 </div>

 {/* Register Button */}
 <button
 onClick={handleRegister}
 disabled={isLoading}
 className="w-full py-2.5 sm:py-3 mt-4 sm:mt-6 text-white font-semibold rounded-lg transition flex items-center justify-center text-sm sm:text-base disabled:opacity-70"
 style={{
 backgroundColor: isLoading ? '#9CA3AF' : '#21C1B6',
 }}
 onMouseEnter={(e) =>
 !isLoading && (e.currentTarget.style.backgroundColor = '#1AA49B')
 }
 onMouseLeave={(e) =>
 !isLoading && (e.currentTarget.style.backgroundColor = '#21C1B6')
 }
 >
 {isLoading ? (
 <>
 <Loader2 className="animate-spin mr-2" size={16} />
 Registering...
 </>
 ) : (
 'Register'
 )}
 </button>
 </div>

 {/* LOGIN + BACK TO HOME – CENTERED BELOW */}
 <div className="mt-4 sm:mt-6 text-center">
 <p className="text-xs sm:text-sm text-gray-600">
 Already have an account?{' '}
 <button onClick={handleLoginClick} className="font-semibold text-gray-900 hover:underline">
 Login
 </button>
 </p>

 {/* EXACTLY CENTERED BELOW */}
 <button
 onClick={handleBackToHome}
 className="mt-3 flex items-center justify-center w-full text-gray-600 hover:text-gray-800 transition-colors text-xs sm:text-sm"
 >
 <ArrowLeft size={14} className="mr-1.5" />
 Back to Home
 </button>
 </div>
 </div>
 </div>

 {/* Right Visual Column - Perfect 50% Coverage with Seamless Transitions */}
 <div className="w-full lg:w-1/2 relative overflow-hidden">
 <div className="absolute inset-0 w-full h-full">
 {/* Multi-layered gradient background for seamless transition */}
 <div
 className="absolute inset-0 w-full h-full"
 style={{
 background: `
 linear-gradient(135deg,
 rgba(11, 21, 36, 0.95) 0%,
 rgba(26, 35, 50, 0.90) 25%,
 rgba(11, 21, 36, 0.95) 50%,
 rgba(26, 35, 50, 0.90) 75%,
 rgba(11, 21, 36, 0.95) 100%
 )
 `
 }}
 />
 
 {/* Dynamic blur effects for depth */}
 <div className="absolute inset-0">
 <div className="absolute top-16 right-16 w-40 h-40 md:w-48 md:h-48 lg:w-56 lg:h-56 xl:w-64 xl:h-64 rounded-full blur-3xl opacity-30" style={{ backgroundColor: '#1AA49B' }}></div>
 <div className="absolute bottom-16 left-16 w-40 h-40 md:w-48 md:h-48 lg:w-56 lg:h-56 xl:w-64 xl:h-64 bg-blue-500 rounded-full blur-3xl opacity-20"></div>
 <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-32 h-32 md:w-40 md:h-40 lg:w-48 lg:h-48 bg-gradient-to-br from-blue-400 to-purple-600 rounded-full blur-2xl opacity-10"></div>
 </div>
 
 {/* Perfect Coverage Advocate Image with Seamless Integration */}
 <div className="absolute inset-0 w-full h-full">
 <img
 src={AdvocateImage}
 alt="Legal Professional"
 className="w-full h-full"
 style={{
 objectFit: 'cover',
 objectPosition: 'center center',
 filter: 'brightness(0.92) contrast(1.08) saturate(1.1)',
 opacity: 0.3,
 }}
 />
 
 {/* Seamless gradient overlay for perfect integration */}
 <div
 className="absolute inset-0 w-full h-full pointer-events-none"
 style={{
 background: `
 linear-gradient(
 135deg,
 rgba(11, 21, 36, 0.15) 0%,
 rgba(11, 21, 36, 0.05) 30%,
 rgba(26, 35, 50, 0.10) 50%,
 rgba(11, 21, 36, 0.05) 70%,
 rgba(11, 21, 36, 0.15) 100%
 )
 `
 }}
 />
 </div>
 </div>
 
 {/* Enhanced Content Overlay with Improved Spacing */}
 <div className="absolute inset-0 z-10 flex flex-col justify-between p-6 md:p-8 lg:p-10 xl:p-12 text-white">
 {/* Flexible top spacing */}
 <div className="flex-1 flex items-start justify-center lg:items-start pt-4 lg:pt-8">
 {/* Optional top content can go here */}
 </div>
 
 {/* Bottom content with enhanced responsive design */}
 <div className="w-full max-w-md lg:max-w-lg xl:max-w-xl">
 <h2 className="text-2xl md:text-3xl lg:text-4xl xl:text-5xl font-bold mb-4 md:mb-6 lg:mb-8 leading-tight text-center lg:text-left">
 Automate Your Legal Workflow in Minutes
 </h2>
 
 {/* Enhanced Features List with better mobile spacing */}
 <div className="space-y-4 md:space-y-5 lg:space-y-6 bg-gradient-to-br from-gray-800/40 to-gray-900/40 backdrop-blur-sm rounded-2xl p-4 md:p-5 lg:p-6 border border-gray-700/20">
 <div className="flex items-start gap-3 lg:gap-4">
 <div className="w-8 h-8 lg:w-10 lg:h-10 rounded-lg flex items-center justify-center flex-shrink-0 border border-teal-500/30" style={{ backgroundColor: 'rgba(156, 223, 225, 0.15)' }}>
 <svg className="w-4 h-4 lg:w-5 lg:h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
 <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z"/>
 </svg>
 </div>
 <div className="min-w-0 flex-1">
 <h3 className="text-sm md:text-base lg:text-lg font-semibold mb-1">Accelerate case preparation</h3>
 <p className="text-gray-300 text-xs md:text-sm">in minutes with AI-powered tools</p>
 </div>
 </div>
 
 <div className="flex items-start gap-3 lg:gap-4">
 <div className="w-8 h-8 lg:w-10 lg:h-10 rounded-lg flex items-center justify-center flex-shrink-0 border border-teal-500/30" style={{ backgroundColor: 'rgba(156, 223, 225, 0.15)' }}>
 <svg className="w-4 h-4 lg:w-5 lg:h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
 <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/>
 </svg>
 </div>
 <div className="min-w-0 flex-1">
 <h3 className="text-sm md:text-base lg:text-lg font-semibold mb-1">Smart Document Vault</h3>
 <p className="text-gray-300 text-xs md:text-sm">Secure, searchable, and organized</p>
 </div>
 </div>
 
 <div className="flex items-start gap-3 lg:gap-4">
 <div className="w-8 h-8 lg:w-10 lg:h-10 rounded-lg flex items-center justify-center flex-shrink-0 border border-teal-500/30" style={{ backgroundColor: 'rgba(156, 223, 225, 0.15)' }}>
 <svg className="w-4 h-4 lg:w-5 lg:h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
 <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/>
 </svg>
 </div>
 <div className="min-w-0 flex-1">
 <h3 className="text-sm md:text-base lg:text-lg font-semibold mb-1">Trusted Legal Insights</h3>
 <p className="text-gray-300 text-xs md:text-sm">AI-driven precedents & analysis</p>
 </div>
 </div>
 </div>
 </div>
 </div>
 </div>
 </div>

 {/* TERMS MODAL - Rendered outside main container as overlay */}
 <TermsAndConditions
 isOpen={showTermsModal}
 onClose={() => setShowTermsModal(false)}
 onAccept={handleAcceptTerms}
 showAcceptButton
 companyName="NexIntelAI"
 effectiveDate="January 1, 2025"
 />
 </>
 );
};

export default RegisterPage;