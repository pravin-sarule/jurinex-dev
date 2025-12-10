
// import React, { useState, useRef } from 'react';
// import { Link, useNavigate } from 'react-router-dom';
// import { toast } from 'react-toastify';
// import 'react-toastify/dist/ReactToastify.css';
// import { Eye, EyeOff, Shield, Mail, Lock, ArrowRight, Sparkles } from 'lucide-react';
// import { motion, useInView } from 'framer-motion';
// import PublicLayout from '../../layouts/PublicLayout';
// import { useAuth } from '../../context/AuthContext';

// const LoginPage = () => {
//   const [formData, setFormData] = useState({
//     email: '',
//     password: '',
//   });

//   const [errors, setErrors] = useState({});
//   const [showPassword, setShowPassword] = useState(false);
//   const [loginSuccess, setLoginSuccess] = useState(false);
//   const [isLoading, setIsLoading] = useState(false);

//   const navigate = useNavigate();
//   const { login } = useAuth();
//   const formRef = useRef(null);
//   const isInView = useInView(formRef, { once: true });

//   const validateEmail = (email) => {
//     if (!email) return 'Email is required.';
//     if (!/\S+@\S+\.\S+/.test(email)) return 'Email address is invalid.';
//     return '';
//   };

//   const validatePassword = (password) => {
//     if (!password) return 'Password is required.';
//     return '';
//   };

//   const handleChange = (e) => {
//     const { name, value } = e.target;
//     setFormData({
//       ...formData,
//       [name]: value,
//     });

//     // Real-time validation feedback
//     if (name === 'email') {
//       setErrors((prevErrors) => ({
//         ...prevErrors,
//         email: validateEmail(value),
//       }));
//     } else if (name === 'password') {
//       setErrors((prevErrors) => ({
//         ...prevErrors,
//         password: validatePassword(value),
//       }));
//     }
//   };

//   const handleSubmit = async (e) => {
//     e.preventDefault();
//     const emailError = validateEmail(formData.email);
//     const passwordError = validatePassword(formData.password);

//     setErrors({
//       email: emailError,
//       password: passwordError,
//     });

//     if (emailError || passwordError) {
//       return;
//     }

//     setIsLoading(true);

//     try {
//       const result = await login(formData.email, formData.password);

//       if (result.success) {
//         toast.success('Login successful!');
//         setLoginSuccess(true);
//         navigate('/dashboard');
//       } else {
//         toast.error(result.message || 'Login failed.');
//       }
//     } catch (error) {
//       if (loginSuccess) {
//         return;
//       }
//       toast.error(error.message || 'An unexpected error occurred. Please try again.');
//       console.error('Unexpected error:', error);
//     } finally {
//       setIsLoading(false);
//     }
//   };

//   // Animation variants
//   const containerVariants = {
//     hidden: { opacity: 0 },
//     visible: {
//       opacity: 1,
//       transition: {
//         staggerChildren: 0.1,
//         delayChildren: 0.2
//       }
//     }
//   };

//   const itemVariants = {
//     hidden: { 
//       opacity: 0, 
//       y: 30,
//       scale: 0.95
//     },
//     visible: { 
//       opacity: 1, 
//       y: 0,
//       scale: 1,
//       transition: {
//         duration: 0.6,
//         ease: [0.25, 0.46, 0.45, 0.94]
//       }
//     }
//   };

//   const formVariants = {
//     hidden: { 
//       opacity: 0, 
//       y: 50,
//       rotateX: -15
//     },
//     visible: { 
//       opacity: 1, 
//       y: 0,
//       rotateX: 0,
//       transition: {
//         duration: 0.8,
//         ease: [0.25, 0.46, 0.45, 0.94]
//       }
//     }
//   };

//   const inputVariants = {
//     hidden: { opacity: 0, x: -20 },
//     visible: { 
//       opacity: 1, 
//       x: 0,
//       transition: {
//         duration: 0.5,
//         ease: "easeOut"
//       }
//     }
//   };

//   const glowVariants = {
//     initial: { scale: 1, opacity: 0.7 },
//     animate: {
//       scale: [1, 1.2, 1],
//       opacity: [0.7, 1, 0.7],
//       transition: {
//         duration: 3,
//         repeat: Infinity,
//         ease: "easeInOut"
//       }
//     }
//   };

//   return (
//     <PublicLayout>
//       {/* Animated background elements */}
//       <div className="fixed inset-0 overflow-hidden pointer-events-none">
//         <motion.div 
//           className="absolute -top-40 -right-40 w-80 h-80 bg-gradient-to-br from-blue-100 to-purple-100 rounded-full blur-3xl opacity-20"
//           animate={{
//             scale: [1, 1.1, 1],
//             rotate: [0, 180, 360]
//           }}
//           transition={{
//             duration: 20,
//             repeat: Infinity,
//             ease: "linear"
//           }}
//         />
//         <motion.div 
//           className="absolute -bottom-40 -left-40 w-96 h-96 bg-gradient-to-br from-gray-100 to-blue-100 rounded-full blur-3xl opacity-20"
//           animate={{
//             scale: [1, 1.2, 1],
//             rotate: [360, 180, 0]
//           }}
//           transition={{
//             duration: 25,
//             repeat: Infinity,
//             ease: "linear"
//           }}
//         />
//       </div>

//       <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-white to-gray-50 py-12 px-4 sm:px-6 lg:px-8 relative">
//         {/* Animated grid background */}
//         <div className="absolute inset-0 opacity-5">
//           <div className="absolute inset-0" style={{
//             backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23374151' fill-opacity='0.3'%3E%3Ccircle cx='7' cy='7' r='1'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
//           }} />
//         </div>

//         <motion.div 
//           ref={formRef}
//           className="max-w-md w-full space-y-8 relative z-10"
//           variants={containerVariants}
//           initial="hidden"
//           animate={isInView ? "visible" : "hidden"}
//         >
//           {/* Form container with glassmorphism effect */}
//           <motion.div 
//             className="relative p-10 bg-white/80 backdrop-blur-sm rounded-2xl shadow-2xl border border-gray-200/50 overflow-hidden"
//             variants={formVariants}
//           >
//             {/* Animated border glow */}
//             <motion.div 
//               className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 rounded-2xl blur-sm opacity-0"
//               animate={{
//                 opacity: [0, 0.3, 0]
//               }}
//               transition={{
//                 duration: 3,
//                 repeat: Infinity,
//                 ease: "easeInOut"
//               }}
//             />

//             {/* Header section */}
//             <motion.div 
//               className="text-center"
//               variants={itemVariants}
//             >
//               {/* Logo with glow effect */}
//               <motion.div 
//                 className="relative inline-flex items-center justify-center mb-6"
//                 variants={itemVariants}
//               >
//                 <motion.div 
//                   className="absolute w-20 h-20 bg-gray-700 rounded-2xl blur-md opacity-20"
//                   variants={glowVariants}
//                   initial="initial"
//                   animate="animate"
//                 />
//                 <motion.div 
//                   className="relative w-16 h-16 bg-gradient-to-br from-gray-700 to-gray-800 rounded-2xl shadow-2xl flex items-center justify-center"
//                   whileHover={{ 
//                     scale: 1.05,
//                     rotate: [0, -5, 5, 0],
//                     transition: { duration: 0.3 }
//                   }}
//                   whileTap={{ scale: 0.95 }}
//                 >
//                   <Shield className="w-8 h-8 text-white" />
//                   <motion.div 
//                     className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent rounded-2xl"
//                     animate={{
//                       opacity: [0, 0.3, 0]
//                     }}
//                     transition={{
//                       duration: 2,
//                       repeat: Infinity,
//                       ease: "easeInOut"
//                     }}
//                   />
//                 </motion.div>
//               </motion.div>

//               <motion.h2 
//                 className="text-3xl font-bold bg-gradient-to-r from-gray-800 via-gray-700 to-gray-800 bg-clip-text text-transparent mb-2"
//                 variants={itemVariants}
//               >
//                 Welcome Back
//               </motion.h2>
              
//               <motion.p 
//                 className="text-gray-600 mb-8"
//                 variants={itemVariants}
//               >
//                 Or{' '}
//                 <Link 
//                   to="/register" 
//                   className="font-medium text-gray-700 hover:text-gray-800 relative group"
//                 >
//                   <span className="relative z-10">create a new account</span>
//                   <motion.div 
//                     className="absolute bottom-0 left-0 w-0 h-0.5 bg-gradient-to-r from-gray-600 to-gray-700 group-hover:w-full transition-all duration-300"
//                   />
//                 </Link>
//               </motion.p>
//             </motion.div>

//             {/* Form */}
//             <motion.form 
//               className="space-y-6" 
//               onSubmit={handleSubmit}
//               variants={containerVariants}
//             >
//               {/* Email field */}
//               <motion.div variants={inputVariants}>
//                 <label htmlFor="email-address" className="block text-sm font-medium text-gray-700 mb-2">
//                   Email Address
//                 </label>
//                 <div className="relative group">
//                   <motion.div 
//                     className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"
//                     whileHover={{ scale: 1.1 }}
//                   >
//                     <Mail className="h-5 w-5 text-gray-400 group-focus-within:text-gray-600 transition-colors" />
//                   </motion.div>
//                   <motion.input
//                     id="email-address"
//                     name="email"
//                     type="email"
//                     autoComplete="email"
//                     required
//                     className={`block w-full pl-10 pr-3 py-3 border ${
//                       errors.email ? 'border-red-500' : 'border-gray-300'
//                     } rounded-xl placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-transparent transition-all duration-300 bg-white/50 backdrop-blur-sm`}
//                     placeholder="Enter your email"
//                     value={formData.email}
//                     onChange={handleChange}
//                     whileFocus={{ scale: 1.02 }}
//                     transition={{ duration: 0.2 }}
//                   />
//                   {errors.email && (
//                     <motion.p 
//                       className="mt-2 text-sm text-red-600"
//                       initial={{ opacity: 0, y: -10 }}
//                       animate={{ opacity: 1, y: 0 }}
//                       transition={{ duration: 0.3 }}
//                     >
//                       {errors.email}
//                     </motion.p>
//                   )}
//                 </div>
//               </motion.div>

//               {/* Password field */}
//               <motion.div variants={inputVariants}>
//                 <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
//                   Password
//                 </label>
//                 <div className="relative group">
//                   <motion.div 
//                     className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"
//                     whileHover={{ scale: 1.1 }}
//                   >
//                     <Lock className="h-5 w-5 text-gray-400 group-focus-within:text-gray-600 transition-colors" />
//                   </motion.div>
//                   <motion.input
//                     id="password"
//                     name="password"
//                     type={showPassword ? 'text' : 'password'}
//                     autoComplete="current-password"
//                     required
//                     className={`block w-full pl-10 pr-12 py-3 border ${
//                       errors.password ? 'border-red-500' : 'border-gray-300'
//                     } rounded-xl placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-transparent transition-all duration-300 bg-white/50 backdrop-blur-sm`}
//                     placeholder="Enter your password"
//                     value={formData.password}
//                     onChange={handleChange}
//                     whileFocus={{ scale: 1.02 }}
//                     transition={{ duration: 0.2 }}
//                   />
//                   <motion.button
//                     type="button"
//                     className="absolute inset-y-0 right-0 pr-3 flex items-center"
//                     onClick={() => setShowPassword(!showPassword)}
//                     whileHover={{ scale: 1.1 }}
//                     whileTap={{ scale: 0.95 }}
//                   >
//                     <motion.div
//                       animate={{ rotate: showPassword ? 180 : 0 }}
//                       transition={{ duration: 0.3 }}
//                     >
//                       {showPassword ? (
//                         <EyeOff className="h-5 w-5 text-gray-400 hover:text-gray-600 transition-colors" />
//                       ) : (
//                         <Eye className="h-5 w-5 text-gray-400 hover:text-gray-600 transition-colors" />
//                       )}
//                     </motion.div>
//                   </motion.button>
//                   {errors.password && (
//                     <motion.p 
//                       className="mt-2 text-sm text-red-600"
//                       initial={{ opacity: 0, y: -10 }}
//                       animate={{ opacity: 1, y: 0 }}
//                       transition={{ duration: 0.3 }}
//                     >
//                       {errors.password}
//                     </motion.p>
//                   )}
//                 </div>
//               </motion.div>

//               {/* Forgot password link */}
//               <motion.div 
//                 className="flex items-center justify-end"
//                 variants={inputVariants}
//               >
//                 <Link 
//                   to="#" 
//                   className="text-sm font-medium text-gray-700 hover:text-gray-800 relative group"
//                 >
//                   <span className="relative z-10">Forgot your password?</span>
//                   <motion.div 
//                     className="absolute bottom-0 left-0 w-0 h-0.5 bg-gradient-to-r from-gray-600 to-gray-700 group-hover:w-full transition-all duration-300"
//                   />
//                 </Link>
//               </motion.div>

//               {/* Submit button */}
//               <motion.div variants={inputVariants}>
//                 <motion.button
//                   type="submit"
//                   disabled={isLoading}
//                   className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-xl text-white bg-gradient-to-r from-gray-700 to-gray-800 hover:from-gray-800 hover:to-gray-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden"
//                   whileHover={{ scale: 1.02 }}
//                   whileTap={{ scale: 0.98 }}
//                 >
//                   <motion.div 
//                     className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0"
//                     initial={{ x: '-100%' }}
//                     whileHover={{ x: '100%' }}
//                     transition={{ duration: 0.6 }}
//                   />
                  
//                   <span className="relative z-10 flex items-center">
//                     {isLoading ? (
//                       <>
//                         <motion.div
//                           className="w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2"
//                           animate={{ rotate: 360 }}
//                           transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
//                         />
//                         Signing in...
//                       </>
//                     ) : (
//                       <>
//                         Sign in
//                         <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform duration-300" />
//                       </>
//                     )}
//                   </span>
//                 </motion.button>
//               </motion.div>
//             </motion.form>

//             {/* Floating elements */}
//             <motion.div 
//               className="absolute top-4 right-4 w-2 h-2 bg-gray-400 rounded-full opacity-30"
//               animate={{
//                 y: [0, -10, 0],
//                 x: [0, 5, 0]
//               }}
//               transition={{
//                 duration: 3,
//                 repeat: Infinity,
//                 ease: "easeInOut"
//               }}
//             />
//             <motion.div 
//               className="absolute bottom-4 left-4 w-3 h-3 bg-gray-300 rounded-full opacity-20"
//               animate={{
//                 y: [0, -15, 0],
//                 x: [0, -8, 0]
//               }}
//               transition={{
//                 duration: 4,
//                 repeat: Infinity,
//                 ease: "easeInOut",
//                 delay: 1
//               }}
//             />
//           </motion.div>

//           {/* Additional features hint */}
//           <motion.div 
//             className="text-center"
//             variants={itemVariants}
//           >
//             <motion.p 
//               className="text-sm text-gray-500 flex items-center justify-center"
//               whileHover={{ scale: 1.02 }}
//             >
//               <Sparkles className="w-4 h-4 mr-2" />
//               Secure login with enterprise-grade encryption
//             </motion.p>
//           </motion.div>
//         </motion.div>
//       </div>
//     </PublicLayout>
//   );
// };

// export default LoginPage;


// import React, { useState, useRef } from 'react';
// import { Link, useNavigate } from 'react-router-dom';
// import { toast } from 'react-toastify';
// import 'react-toastify/dist/ReactToastify.css';
// import { Eye, EyeOff, Shield, Mail, Lock, ArrowRight, Sparkles } from 'lucide-react';
// import { motion, useInView } from 'framer-motion';
// import PublicLayout from '../../layouts/PublicLayout';
// import { useAuth } from '../../context/AuthContext';

// const LoginPage = () => {
//  const [formData, setFormData] = useState({
//  email: '',
//  password: '',
//  });

//  const [errors, setErrors] = useState({});
//  const [showPassword, setShowPassword] = useState(false);
//  const [loginSuccess, setLoginSuccess] = useState(false);
//  const [isLoading, setIsLoading] = useState(false);
//  const [showOtpField, setShowOtpField] = useState(false);
//  const [otp, setOtp] = useState('');
//  const [otpEmail, setOtpEmail] = useState(''); // To store the email for OTP verification

//  const navigate = useNavigate();
//  const { login, verifyOtp } = useAuth();
//  const formRef = useRef(null);
//  const isInView = useInView(formRef, { once: true });

//  const validateEmail = (email) => {
//  if (!email) return 'Email is required.';
//  if (!/\S+@\S+\.\S+/.test(email)) return 'Email address is invalid.';
//  return '';
//  };

//  const validatePassword = (password) => {
//  if (!password) return 'Password is required.';
//  return '';
//  };

//  const handleChange = (e) => {
//  const { name, value } = e.target;
//  setFormData({
//  ...formData,
//  [name]: value,
//  });

//  // Real-time validation feedback
//  if (name === 'email') {
//  setErrors((prevErrors) => ({
//  ...prevErrors,
//  email: validateEmail(value),
//  }));
//  } else if (name === 'password') {
//  setErrors((prevErrors) => ({
//  ...prevErrors,
//  password: validatePassword(value),
//  }));
//  }
//  };

//  const handleSubmit = async (e) => {
//  e.preventDefault();
//  const emailError = validateEmail(formData.email);
//  const passwordError = validatePassword(formData.password);

//  setErrors({
//  email: emailError,
//  password: passwordError,
//  });

//  if (emailError || passwordError) {
//  return;
//  }

//  setIsLoading(true);

//  try {
//  const result = await login(formData.email, formData.password);
//  console.log("Login result:", result); // Added for debugging

//  if (result.requiresOtp) {
//  setShowOtpField(true);
//  setOtpEmail(result.email);
//  toast.info(result.message || 'OTP required. Please check your email.');
//  } else if (result.success) {
//  toast.success('Login successful!');
//  setLoginSuccess(true);
//  navigate('/dashboard');
//  } else {
//  toast.error(result.message || 'Login failed.');
//  }
//  } catch (error) {
//  if (loginSuccess) {
//  return;
//  }
//  toast.error(error.message || 'An unexpected error occurred. Please try again.');
//  console.error('Unexpected error:', error);
//  } finally {
//  setIsLoading(false);
//  }
//  };

//  const handleOtpChange = (e) => {
//  setOtp(e.target.value);
//  };

//  const handleOtpSubmit = async (e) => {
//  e.preventDefault();
//  setIsLoading(true);
//  try {
//  const result = await verifyOtp(otpEmail, otp);
//  if (result.success) {
//  toast.success('OTP verification successful! Logging in...');
//  setLoginSuccess(true);
//  navigate('/dashboard');
//  } else {
//  toast.error(result.message || 'OTP verification failed.');
//  }
//  } catch (error) {
//  toast.error(error.message || 'An unexpected error occurred during OTP verification. Please try again.');
//  console.error('OTP verification error:', error);
//  } finally {
//  setIsLoading(false);
//  }
//  };

//  // Animation variants
//  const containerVariants = {
//  hidden: { opacity: 0 },
//  visible: {
//  opacity: 1,
//  transition: {
//  staggerChildren: 0.1,
//  delayChildren: 0.2
//  }
//  }
//  };

//  const itemVariants = {
//  hidden: { 
//  opacity: 0, 
//  y: 30,
//  scale: 0.95
//  },
//  visible: { 
//  opacity: 1, 
//  y: 0,
//  scale: 1,
//  transition: {
//  duration: 0.6,
//  ease: [0.25, 0.46, 0.45, 0.94]
//  }
//  }
//  };

//  const formVariants = {
//  hidden: { 
//  opacity: 0, 
//  y: 50,
//  rotateX: -15
//  },
//  visible: { 
//  opacity: 1, 
//  y: 0,
//  rotateX: 0,
//  transition: {
//  duration: 0.8,
//  ease: [0.25, 0.46, 0.45, 0.94]
//  }
//  }
//  };

//  const inputVariants = {
//  hidden: { opacity: 0, x: -20 },
//  visible: { 
//  opacity: 1, 
//  x: 0,
//  transition: {
//  duration: 0.5,
//  ease: "easeOut"
//  }
//  }
//  };

//  const glowVariants = {
//  initial: { scale: 1, opacity: 0.7 },
//  animate: {
//  scale: [1, 1.2, 1],
//  opacity: [0.7, 1, 0.7],
//  transition: {
//  duration: 3,
//  repeat: Infinity,
//  ease: "easeInOut"
//  }
//  }
//  };

//  return (
//  <PublicLayout>
//  {/* Animated background elements */}
//  <div className="fixed inset-0 overflow-hidden pointer-events-none">
//  <motion.div 
//  className="absolute -top-40 -right-40 w-80 h-80 bg-gradient-to-br from-blue-100 to-purple-100 rounded-full blur-3xl opacity-20"
//  animate={{
//  scale: [1, 1.1, 1],
//  rotate: [0, 180, 360]
//  }}
//  transition={{
//  duration: 20,
//  repeat: Infinity,
//  ease: "linear"
//  }}
//  />
//  <motion.div 
//  className="absolute -bottom-40 -left-40 w-96 h-96 bg-gradient-to-br from-gray-100 to-blue-100 rounded-full blur-3xl opacity-20"
//  animate={{
//  scale: [1, 1.2, 1],
//  rotate: [360, 180, 0]
//  }}
//  transition={{
//  duration: 25,
//  repeat: Infinity,
//  ease: "linear"
//  }}
//  />
//  </div>

//  <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-white to-gray-50 py-12 px-4 sm:px-6 lg:px-8 relative">
//  {/* Animated grid background */}
//  <div className="absolute inset-0 opacity-5">
//  <div className="absolute inset-0" style={{
//  backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23374151' fill-opacity='0.3'%3E%3Ccircle cx='7' cy='7' r='1'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
//  }} />
//  </div>

//  <motion.div 
//  ref={formRef}
//  className="max-w-md w-full space-y-8 relative z-10"
//  variants={containerVariants}
//  initial="hidden"
//  animate={isInView ? "visible" : "hidden"}
//  >
//  {/* Form container with glassmorphism effect */}
//  <motion.div 
//  className="relative p-10 bg-white/80 backdrop-blur-sm rounded-2xl shadow-2xl border border-gray-200/50 overflow-hidden"
//  variants={formVariants}
//  >
//  {/* Animated border glow */}
//  <motion.div 
//  className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 rounded-2xl blur-sm opacity-0"
//  animate={{
//  opacity: [0, 0.3, 0]
//  }}
//  transition={{
//  duration: 3,
//  repeat: Infinity,
//  ease: "easeInOut"
//  }}
//  />

//  {/* Header section */}
//  <motion.div 
//  className="text-center"
//  variants={itemVariants}
//  >
//  {/* Logo with glow effect */}
//  <motion.div 
//  className="relative inline-flex items-center justify-center mb-6"
//  variants={itemVariants}
//  >
//  <motion.div 
//  className="absolute w-20 h-20 bg-gray-700 rounded-2xl blur-md opacity-20"
//  variants={glowVariants}
//  initial="initial"
//  animate="animate"
//  />
//  <motion.div 
//  className="relative w-16 h-16 bg-gradient-to-br from-gray-700 to-gray-800 rounded-2xl shadow-2xl flex items-center justify-center"
//  whileHover={{ 
//  scale: 1.05,
//  rotate: [0, -5, 5, 0],
//  transition: { duration: 0.3 }
//  }}
//  whileTap={{ scale: 0.95 }}
//  >
//  <Shield className="w-8 h-8 text-white" />
//  <motion.div 
//  className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent rounded-2xl"
//  animate={{
//  opacity: [0, 0.3, 0]
//  }}
//  transition={{
//  duration: 2,
//  repeat: Infinity,
//  ease: "easeInOut"
//  }}
//  />
//  </motion.div>
//  </motion.div>

//  <motion.h2 
//  className="text-3xl font-bold bg-gradient-to-r from-gray-800 via-gray-700 to-gray-800 bg-clip-text text-transparent mb-2"
//  variants={itemVariants}
//  >
//  Welcome Back
//  </motion.h2>
 
//  <motion.p 
//  className="text-gray-600 mb-8"
//  variants={itemVariants}
//  >
//  Or{' '}
//  <Link 
//  to="/register" 
//  className="font-medium text-gray-700 hover:text-gray-800 relative group"
//  >
//  <span className="relative z-10">create a new account</span>
//  <motion.div 
//  className="absolute bottom-0 left-0 w-0 h-0.5 bg-gradient-to-r from-gray-600 to-gray-700 group-hover:w-full transition-all duration-300"
//  />
//  </Link>
//  </motion.p>
//  </motion.div>

//  {/* Form */}
//  {!showOtpField ? (
//  <motion.form
//  className="space-y-6"
//  onSubmit={handleSubmit}
//  variants={containerVariants}
//  >
//  {/* Email field */}
//  <motion.div variants={inputVariants}>
//  <label htmlFor="email-address" className="block text-sm font-medium text-gray-700 mb-2">
//  Email Address
//  </label>
//  <div className="relative group">
//  <motion.div
//  className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"
//  whileHover={{ scale: 1.1 }}
//  >
//  <Mail className="h-5 w-5 text-gray-400 group-focus-within:text-gray-600 transition-colors" />
//  </motion.div>
//  <motion.input
//  id="email-address"
//  name="email"
//  type="email"
//  autoComplete="email"
//  required
//  className={`block w-full pl-10 pr-3 py-3 border ${
//  errors.email ? 'border-red-500' : 'border-gray-300'
//  } rounded-xl placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-transparent transition-all duration-300 bg-white/50 backdrop-blur-sm`}
//  placeholder="Enter your email"
//  value={formData.email}
//  onChange={handleChange}
//  whileFocus={{ scale: 1.02 }}
//  transition={{ duration: 0.2 }}
//  />
//  {errors.email && (
//  <motion.p
//  className="mt-2 text-sm text-red-600"
//  initial={{ opacity: 0, y: -10 }}
//  animate={{ opacity: 1, y: 0 }}
//  transition={{ duration: 0.3 }}
//  >
//  {errors.email}
//  </motion.p>
//  )}
//  </div>
//  </motion.div>

//  {/* Password field */}
//  <motion.div variants={inputVariants}>
//  <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
//  Password
//  </label>
//  <div className="relative group">
//  <motion.div
//  className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"
//  whileHover={{ scale: 1.1 }}
//  >
//  <Lock className="h-5 w-5 text-gray-400 group-focus-within:text-gray-600 transition-colors" />
//  </motion.div>
//  <motion.input
//  id="password"
//  name="password"
//  type={showPassword ? 'text' : 'password'}
//  autoComplete="current-password"
//  required
//  className={`block w-full pl-10 pr-12 py-3 border ${
//  errors.password ? 'border-red-500' : 'border-gray-300'
//  } rounded-xl placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-transparent transition-all duration-300 bg-white/50 backdrop-blur-sm`}
//  placeholder="Enter your password"
//  value={formData.password}
//  onChange={handleChange}
//  whileFocus={{ scale: 1.02 }}
//  transition={{ duration: 0.2 }}
//  />
//  <motion.button
//  type="button"
//  className="absolute inset-y-0 right-0 pr-3 flex items-center"
//  onClick={() => setShowPassword(!showPassword)}
//  whileHover={{ scale: 1.1 }}
//  whileTap={{ scale: 0.95 }}
//  >
//  <motion.div
//  animate={{ rotate: showPassword ? 180 : 0 }}
//  transition={{ duration: 0.3 }}
//  >
//  {showPassword ? (
//  <EyeOff className="h-5 w-5 text-gray-400 hover:text-gray-600 transition-colors" />
//  ) : (
//  <Eye className="h-5 w-5 text-gray-400 hover:text-gray-600 transition-colors" />
//  )}
//  </motion.div>
//  </motion.button>
//  {errors.password && (
//  <motion.p
//  className="mt-2 text-sm text-red-600"
//  initial={{ opacity: 0, y: -10 }}
//  animate={{ opacity: 1, y: 0 }}
//  transition={{ duration: 0.3 }}
//  >
//  {errors.password}
//  </motion.p>
//  )}
//  </div>
//  </motion.div>

//  {/* Forgot password link */}
//  <motion.div
//  className="flex items-center justify-end"
//  variants={inputVariants}
//  >
//  <Link
//  to="#"
//  className="text-sm font-medium text-gray-700 hover:text-gray-800 relative group"
//  >
//  <span className="relative z-10">Forgot your password?</span>
//  <motion.div
//  className="absolute bottom-0 left-0 w-0 h-0.5 bg-gradient-to-r from-gray-600 to-gray-700 group-hover:w-full transition-all duration-300"
//  />
//  </Link>
//  </motion.div>

//  {/* Submit button */}
//  <motion.div variants={inputVariants}>
//  <motion.button
//  type="submit"
//  disabled={isLoading}
//  className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-xl text-white bg-gradient-to-r from-gray-700 to-gray-800 hover:from-gray-800 hover:to-gray-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden"
//  whileHover={{ scale: 1.02 }}
//  whileTap={{ scale: 0.98 }}
//  >
//  <motion.div
//  className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0"
//  initial={{ x: '-100%' }}
//  whileHover={{ x: '100%' }}
//  transition={{ duration: 0.6 }}
//  />
 
//  <span className="relative z-10 flex items-center">
//  {isLoading ? (
//  <>
//  <motion.div
//  className="w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2"
//  animate={{ rotate: 360 }}
//  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
//  />
//  Signing in...
//  </>
//  ) : (
//  <>
//  Sign in
//  <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform duration-300" />
//  </>
//  )}
//  </span>
//  </motion.button>
//  </motion.div>
//  </motion.form>
//  ) : (
//  <motion.form
//  className="space-y-6"
//  onSubmit={handleOtpSubmit}
//  variants={containerVariants}
//  >
//  <motion.div variants={inputVariants}>
//  <label htmlFor="otp" className="block text-sm font-medium text-gray-700 mb-2">
//  Enter OTP
//  </label>
//  <div className="relative group">
//  <motion.div
//  className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"
//  whileHover={{ scale: 1.1 }}
//  >
//  <Shield className="h-5 w-5 text-gray-400 group-focus-within:text-gray-600 transition-colors" />
//  </motion.div>
//  <motion.input
//  id="otp"
//  name="otp"
//  type="text"
//  autoComplete="one-time-code"
//  required
//  className={`block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-xl placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-transparent transition-all duration-300 bg-white/50 backdrop-blur-sm`}
//  placeholder="Enter your OTP"
//  value={otp}
//  onChange={handleOtpChange}
//  whileFocus={{ scale: 1.02 }}
//  transition={{ duration: 0.2 }}
//  />
//  </div>
//  </motion.div>
//  <motion.div variants={inputVariants}>
//  <motion.button
//  type="submit"
//  disabled={isLoading}
//  className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-xl text-white bg-gradient-to-r from-gray-700 to-gray-800 hover:from-gray-800 hover:to-gray-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden"
//  whileHover={{ scale: 1.02 }}
//  whileTap={{ scale: 0.98 }}
//  >
//  <motion.div
//  className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0"
//  initial={{ x: '-100%' }}
//  whileHover={{ x: '100%' }}
//  transition={{ duration: 0.6 }}
//  />
 
//  <span className="relative z-10 flex items-center">
//  {isLoading ? (
//  <>
//  <motion.div
//  className="w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2"
//  animate={{ rotate: 360 }}
//  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
//  />
//  Verifying OTP...
//  </>
//  ) : (
//  <>
//  Verify OTP
//  <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform duration-300" />
//  </>
//  )}
//  </span>
//  </motion.button>
//  </motion.div>
//  </motion.form>
//  )}

//  {/* Floating elements */}
//  <motion.div 
//  className="absolute top-4 right-4 w-2 h-2 bg-gray-400 rounded-full opacity-30"
//  animate={{
//  y: [0, -10, 0],
//  x: [0, 5, 0]
//  }}
//  transition={{
//  duration: 3,
//  repeat: Infinity,
//  ease: "easeInOut"
//  }}
//  />
//  <motion.div 
//  className="absolute bottom-4 left-4 w-3 h-3 bg-gray-300 rounded-full opacity-20"
//  animate={{
//  y: [0, -15, 0],
//  x: [0, -8, 0]
//  }}
//  transition={{
//  duration: 4,
//  repeat: Infinity,
//  ease: "easeInOut",
//  delay: 1
//  }}
//  />
//  </motion.div>

//  {/* Additional features hint */}
//  <motion.div 
//  className="text-center"
//  variants={itemVariants}
//  >
//  <motion.p 
//  className="text-sm text-gray-500 flex items-center justify-center"
//  whileHover={{ scale: 1.02 }}
//  >
//  <Sparkles className="w-4 h-4 mr-2" />
//  Secure login with enterprise-grade encryption
//  </motion.p>
//  </motion.div>
//  </motion.div>
//  </div>
//  </PublicLayout>
//  );
// };

// export default LoginPage;



// // src/pages/Auth/LoginPage.jsx
// import React, { useState } from "react";
// import { Eye, EyeOff, CheckCircle } from "lucide-react";
// import apiService from "../../services/api"; // ✅ connect to backend

// const LoginPage = () => {
//   const [formData, setFormData] = useState({ email: "", password: "" });
//   const [errors, setErrors] = useState({});
//   const [showPassword, setShowPassword] = useState(false);
//   const [isOTPStage, setIsOTPStage] = useState(false);
//   const [otp, setOtp] = useState("");
//   const [successMessage, setSuccessMessage] = useState("");
//   const [isVerifying, setIsVerifying] = useState(false);
//   const [isLoading, setIsLoading] = useState(false);
//   const [serverMessage, setServerMessage] = useState("");

//   // ---------------- Validation ----------------
//   const validateEmail = (email) => {
//     if (!email) return "Email is required.";
//     if (!/\S+@\S+\.\S+/.test(email)) return "Invalid email format.";
//     return "";
//   };
//   const validatePassword = (password) =>
//     !password ? "Password is required." : "";

//   // ---------------- Handle Input ----------------
//   const handleChange = (e) => {
//     const { name, value } = e.target;
//     setFormData({ ...formData, [name]: value });
//     setErrors((prev) => ({ ...prev, [name]: "" }));
//   };

//   // ---------------- Send OTP ----------------
//   const handleSendOTP = async (e) => {
//   e.preventDefault();
//   const emailError = validateEmail(formData.email);
//   const passwordError = validatePassword(formData.password);
//   setErrors({ email: emailError, password: passwordError });
//   if (emailError || passwordError) return;

//   try {
//     setIsLoading(true);
//     const res = await apiService.login(formData);
//     setServerMessage(res.message);
//     setIsOTPStage(true);
//   } catch (err) {
//     setServerMessage(err.message || "Failed to send OTP");
//   } finally {
//     setIsLoading(false);
//   }
// };

//   // ---------------- Verify OTP ----------------
//   const handleVerifyOTP = async () => {
//     if (otp.length !== 6) {
//       alert("Please enter a 6-digit OTP.");
//       return;
//     }

//     try {
//       setIsVerifying(true);
//       const res = await apiService.verifyOtp(formData.email, otp);
//       setSuccessMessage(res.message);
//       localStorage.setItem("token", res.token);
//       localStorage.setItem("user", JSON.stringify(res.user));
//       setTimeout(() => (window.location.href = "/dashboard"), 1500);
//     } catch (err) {
//       setSuccessMessage(err.message || "Invalid OTP. Try again.");
//     } finally {
//       setIsVerifying(false);
//     }
//   };

//   return (
//     <div className="min-h-screen flex font-sans transition-all duration-700 ease-in-out">
//       {/* Left Section (Login + OTP) */}
//       <div className="w-full lg:w-1/2 bg-white flex items-center justify-center p-8 lg:p-12">
//         {/* ------------- Login Screen ------------- */}
//         {!isOTPStage && (
//           <div className="max-w-md w-full transition-opacity duration-700">
//             <div className="flex justify-center mb-8">
//               <div
//                 className="w-16 h-16 rounded-lg flex items-center justify-center"
//                 style={{ backgroundColor: "#1AA49B" }}
//               >
//                 <svg
//                   className="w-10 h-10 text-white"
//                   viewBox="0 0 24 24"
//                   fill="currentColor"
//                 >
//                   <path d="M3 3h8l4 4-4 4H3V3zm10 10h8v8h-8l-4-4 4-4z" />
//                 </svg>
//               </div>
//             </div>

//             <h2 className="text-3xl font-bold text-gray-900 mb-2 text-center">
//               Welcome to NexIntel AI
//             </h2>
//             <p className="text-gray-500 mb-8 text-center text-sm">
//               Sign in to continue managing your legal workspace.
//             </p>

//             <form className="space-y-5" onSubmit={handleSendOTP}>
//               <div>
//                 <label className="block text-sm font-medium text-gray-700 mb-1">
//                   Email / User ID
//                 </label>
//                 <input
//                   type="text"
//                   name="email"
//                   placeholder="Enter your email"
//                   className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6]"
//                   value={formData.email}
//                   onChange={handleChange}
//                 />
//                 {errors.email && (
//                   <p className="mt-1 text-xs text-red-600">{errors.email}</p>
//                 )}
//               </div>

//               <div>
//                 <label className="block text-sm font-medium text-gray-700 mb-1">
//                   Password
//                 </label>
//                 <div className="relative">
//                   <input
//                     type={showPassword ? "text" : "password"}
//                     name="password"
//                     placeholder="Enter your password"
//                     className="w-full px-4 py-2.5 border border-gray-300 rounded-lg pr-10 focus:ring-2 focus:ring-[#21C1B6]"
//                     value={formData.password}
//                     onChange={handleChange}
//                   />
//                   <button
//                     type="button"
//                     onClick={() => setShowPassword(!showPassword)}
//                     className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
//                   >
//                     {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
//                   </button>
//                 </div>
//                 {errors.password && (
//                   <p className="mt-1 text-xs text-red-600">{errors.password}</p>
//                 )}
//               </div>

//               <button
//                 type="submit"
//                 disabled={isLoading}
//                 className="w-full py-3 px-5 text-white font-semibold rounded-lg transition duration-300 mt-6"
//                 style={{
//                   background:
//                     "linear-gradient(90deg, #21C1B6 0%, #1AA49B 100%)",
//                 }}
//               >
//                 {isLoading ? "Sending OTP..." : "Send OTP"}
//               </button>
//             </form>

//             {serverMessage && (
//               <p className="text-sm text-center mt-4 text-gray-600">
//                 {serverMessage}
//               </p>
//             )}
//           </div>
//         )}

//         {/* ------------- OTP Screen ------------- */}
//         {isOTPStage && (
//           <div className="max-w-md w-full text-center animate-fadeIn">
//             <div className="flex justify-center mb-8">
//               <div
//                 className="w-16 h-16 rounded-lg flex items-center justify-center"
//                 style={{
//                   background:
//                     "linear-gradient(135deg, #21C1B6 0%, #1AA49B 100%)",
//                 }}
//               >
//                 <CheckCircle className="w-10 h-10 text-white" />
//               </div>
//             </div>
//             <h2 className="text-2xl font-bold text-gray-900 mb-2">Enter OTP</h2>
//             <p className="text-gray-500 mb-6 text-sm">
//               We’ve sent a 6-digit code to your registered email.
//             </p>

//             <input
//               type="text"
//               maxLength="6"
//               placeholder="Enter 6-digit OTP"
//               className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center tracking-widest text-lg focus:ring-2 focus:ring-[#21C1B6]"
//               value={otp}
//               onChange={(e) => setOtp(e.target.value)}
//             />

//             <button
//               onClick={handleVerifyOTP}
//               disabled={isVerifying}
//               className="w-full mt-6 py-3 px-5 text-white font-semibold rounded-lg transition duration-300"
//               style={{
//                 background:
//                   "linear-gradient(90deg, #21C1B6 0%, #1AA49B 100%)",
//               }}
//             >
//               {isVerifying ? "Verifying..." : "Verify OTP"}
//             </button>

//             {successMessage && (
//               <p className="text-green-600 mt-4 text-sm animate-fadeIn">
//                 {successMessage}
//               </p>
//             )}
//           </div>
//         )}
//       </div>

//       {/* Right visual column remains same */}
//       <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-gray-800 via-gray-900 to-gray-950 items-center justify-center p-12 relative overflow-hidden">
//         {/* visuals */}
//       </div>
//     </div>
//   );
// };

// export default LoginPage;

// // src/pages/Auth/LoginPage.jsx
// import React, { useState, useEffect } from "react";
// import { useNavigate } from "react-router-dom";
// import { Eye, EyeOff, CheckCircle } from "lucide-react";
// import apiService from "../../services/api";

// const LoginPage = () => {
//   const navigate = useNavigate();
//   const [formData, setFormData] = useState({ email: "", password: "" });
//   const [errors, setErrors] = useState({});
//   const [showPassword, setShowPassword] = useState(false);
//   const [isOTPStage, setIsOTPStage] = useState(false);
//   const [otp, setOtp] = useState("");
//   const [successMessage, setSuccessMessage] = useState("");
//   const [isVerifying, setIsVerifying] = useState(false);
//   const [isLoading, setIsLoading] = useState(false);
//   const [serverMessage, setServerMessage] = useState("");

//   // Check if user is already logged in
//   useEffect(() => {
//     const token = localStorage.getItem('token');
//     if (token) {
//       navigate('/dashboard', { replace: true });
//     }
//   }, [navigate]);

//   // Validation
//   const validateEmail = (email) => {
//     if (!email) return "Email is required.";
//     if (!/\S+@\S+\.\S+/.test(email)) return "Invalid email format.";
//     return "";
//   };
  
//   const validatePassword = (password) =>
//     !password ? "Password is required." : "";

//   // Handle Input
//   const handleChange = (e) => {
//     const { name, value } = e.target;
//     setFormData({ ...formData, [name]: value });
//     setErrors((prev) => ({ ...prev, [name]: "" }));
//   };

//   // Send OTP
//   const handleSendOTP = async (e) => {
//     e.preventDefault();
//     const emailError = validateEmail(formData.email);
//     const passwordError = validatePassword(formData.password);
//     setErrors({ email: emailError, password: passwordError });
//     if (emailError || passwordError) return;

//     try {
//       setIsLoading(true);
//       setServerMessage("");
//       const res = await apiService.login(formData);
//       setServerMessage(res.message);
//       setIsOTPStage(true);
//     } catch (err) {
//       setServerMessage(err.message || "Failed to send OTP");
//     } finally {
//       setIsLoading(false);
//     }
//   };

//   // Verify OTP
//   const handleVerifyOTP = async () => {
//     if (otp.length !== 6) {
//       setSuccessMessage("Please enter a 6-digit OTP.");
//       return;
//     }

//     try {
//       setIsVerifying(true);
//       setSuccessMessage("");
      
//       const res = await apiService.verifyOtp(formData.email, otp);
      
//       // Store auth data
//       localStorage.setItem("token", res.token);
//       localStorage.setItem("user", JSON.stringify(res.user));
      
//       // Show success message
//       setSuccessMessage(res.message || "Login successful! Redirecting...");
      
//       // Use navigate for redirect
//       navigate("/dashboard");
      
//     } catch (err) {
//       setSuccessMessage(err.message || "Invalid OTP. Please try again.");
//     } finally {
//       setIsVerifying(false);
//     }
//   };

//   return (
//     <div className="min-h-screen flex font-sans transition-all duration-700 ease-in-out">
//       {/* Left Section (Login + OTP) */}
//       <div className="w-full lg:w-1/2 bg-white flex items-center justify-center p-8 lg:p-12">
//         {/* Login Screen */}
//         {!isOTPStage && (
//           <div className="max-w-md w-full transition-opacity duration-700">
//             <div className="flex justify-center mb-8">
//               <div
//                 className="w-16 h-16 rounded-lg flex items-center justify-center"
//                 style={{ backgroundColor: "#1AA49B" }}
//               >
//                 <svg
//                   className="w-10 h-10 text-white"
//                   viewBox="0 0 24 24"
//                   fill="currentColor"
//                 >
//                   <path d="M3 3h8l4 4-4 4H3V3zm10 10h8v8h-8l-4-4 4-4z" />
//                 </svg>
//               </div>
//             </div>

//             <h2 className="text-3xl font-bold text-gray-900 mb-2 text-center">
//               Welcome to NexIntel AI
//             </h2>
//             <p className="text-gray-500 mb-8 text-center text-sm">
//               Sign in to continue managing your legal workspace.
//             </p>

//             <form className="space-y-5" onSubmit={handleSendOTP}>
//               <div>
//                 <label className="block text-sm font-medium text-gray-700 mb-1">
//                   Email / User ID
//                 </label>
//                 <input
//                   type="text"
//                   name="email"
//                   placeholder="Enter your email"
//                   className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] text-black"
//                   value={formData.email}
//                   onChange={handleChange}
//                 />
//                 {errors.email && (
//                   <p className="mt-1 text-xs text-red-600">{errors.email}</p>
//                 )}
//               </div>

//               <div>
//                 <label className="block text-sm font-medium text-gray-700 mb-1">
//                   Password
//                 </label>
//                 <div className="relative">
//                   <input
//                     type={showPassword ? "text" : "password"}
//                     name="password"
//                     placeholder="Enter your password"
//                     className="w-full px-4 py-2.5 border border-gray-300 rounded-lg pr-10 focus:ring-2 focus:ring-[#21C1B6] text-black"
//                     value={formData.password}
//                     onChange={handleChange}
//                   />
//                   <button
//                     type="button"
//                     onClick={() => setShowPassword(!showPassword)}
//                     className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
//                   >
//                     {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
//                   </button>
//                 </div>
//                 {errors.password && (
//                   <p className="mt-1 text-xs text-red-600">{errors.password}</p>
//                 )}
//               </div>

//               <button
//                 type="submit"
//                 disabled={isLoading}
//                 className="w-full py-3 px-5 text-white font-semibold rounded-lg transition duration-300 mt-6 disabled:opacity-50 disabled:cursor-not-allowed"
//                 style={{
//                   background:
//                     "linear-gradient(90deg, #21C1B6 0%, #1AA49B 100%)",
//                 }}
//               >
//                 {isLoading ? "Sending OTP..." : "Send OTP"}
//               </button>
//             </form>

//             {serverMessage && (
//               <p className="text-sm text-center mt-4 text-gray-600">
//                 {serverMessage}
//               </p>
//             )}
//           </div>
//         )}

//         {/* OTP Screen */}
//         {isOTPStage && (
//           <div className="max-w-md w-full text-center animate-fadeIn">
//             <div className="flex justify-center mb-8">
//               <div
//                 className="w-16 h-16 rounded-lg flex items-center justify-center"
//                 style={{
//                   background:
//                     "linear-gradient(135deg, #21C1B6 0%, #1AA49B 100%)",
//                 }}
//               >
//                 <CheckCircle className="w-10 h-10 text-white" />
//               </div>
//             </div>
//             <h2 className="text-2xl font-bold text-gray-900 mb-2">Enter OTP</h2>
//             <p className="text-gray-500 mb-6 text-sm">
//               We've sent a 6-digit code to your registered email.
//             </p>

//             <input
//               type="text"
//               maxLength="6"
//               placeholder="Enter 6-digit OTP"
//               className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center tracking-widest text-lg text-black focus:ring-2 focus:ring-[#21C1B6]"
//               value={otp}
//               onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
//               autoFocus
//             />

//             <button
//               onClick={handleVerifyOTP}
//               disabled={isVerifying || otp.length !== 6}
//               className="w-full mt-6 py-3 px-5 text-white font-semibold rounded-lg transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
//               style={{
//                 background:
//                   "linear-gradient(90deg, #21C1B6 0%, #1AA49B 100%)",
//               }}
//             >
//               {isVerifying ? "Verifying..." : "Verify OTP"}
//             </button>

//             {successMessage && (
//               <p className={`mt-4 text-sm animate-fadeIn ${
//                 successMessage.includes('Invalid') || successMessage.includes('Please') 
//                   ? 'text-red-600' 
//                   : 'text-green-600'
//               }`}>
//                 {successMessage}
//               </p>
//             )}
            
//             <button
//               onClick={() => {
//                 setIsOTPStage(false);
//                 setOtp("");
//                 setSuccessMessage("");
//               }}
//               className="mt-4 text-sm text-gray-500 hover:text-gray-700 underline"
//             >
//               ← Back to Login
//             </button>
//           </div>
//         )}
//       </div>

//       {/* Right visual column */}
//       <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-gray-800 via-gray-900 to-gray-950 items-center justify-center p-12 relative overflow-hidden">
//         <div className="absolute inset-0 opacity-10">
//           <div className="absolute top-20 right-20 w-64 h-64 rounded-full blur-3xl" style={{ backgroundColor: '#1AA49B' }}></div>
//           <div className="absolute bottom-20 left-20 w-64 h-64 bg-blue-500 rounded-full blur-3xl"></div>
//         </div>

//         <div className="max-w-lg text-white relative z-10">
//           <div className="mb-8 relative">
//             <div className="bg-gradient-to-br from-gray-700 to-gray-800 rounded-2xl p-8 shadow-2xl">
//               <div className="flex gap-2 mb-6">
//                 <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//                 <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//                 <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//               </div>
              
//               <div className="flex gap-4 items-center justify-center">
//                 <div className="space-y-3">
//                   <div className="w-12 h-12 rounded-lg" style={{ backgroundColor: '#1AA49B' }}></div>
//                   <div className="w-12 h-12 bg-gray-700 rounded-lg"></div>
//                   <div className="w-12 h-12 bg-gray-700 rounded-lg"></div>
//                 </div>
                
//                 <div className="bg-white rounded-lg p-4 w-48">
//                   <div className="space-y-2">
//                     <div className="h-3 rounded w-3/4" style={{ backgroundColor: '#1AA49B' }}></div>
//                     <div className="h-2 bg-gray-300 rounded"></div>
//                     <div className="h-2 bg-gray-300 rounded"></div>
//                     <div className="h-2 bg-gray-300 rounded w-5/6"></div>
//                   </div>
//                 </div>

//                 <div className="space-y-4">
//                   <div className="w-16 h-16 relative">
//                     <div className="absolute top-0 right-0 w-8 h-12 bg-gray-600 rounded transform rotate-45"></div>
//                     <div className="absolute bottom-0 left-0 w-12 h-6 rounded" style={{ backgroundColor: '#1AA49B' }}></div>
//                   </div>
//                   <div className="w-16 h-16 flex items-end justify-center">
//                     <div className="w-12 h-12 border-4 border-gray-600 rounded-full relative">
//                       <div className="absolute -top-6 left-1/2 -translate-x-1/2 w-1 h-8 bg-gray-600"></div>
//                     </div>
//                   </div>
//                 </div>
//               </div>
//             </div>
//           </div>

//           <h2 className="text-4xl font-bold mb-8 leading-tight text-center">
//             Automate Your Legal Workflow in Minutes
//           </h2>

//           <div className="space-y-6 bg-gradient-to-br from-gray-800/50 to-gray-900/50 backdrop-blur-sm rounded-2xl p-6">
//             <div className="flex items-start gap-4">
//               <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                 <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                   <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z"/>
//                 </svg>
//               </div>
//               <div>
//                 <h3 className="text-lg font-semibold mb-1">Accelerate case preparation</h3>
//                 <p className="text-gray-400 text-sm">in minutes with AI-powered tools</p>
//               </div>
//             </div>

//             <div className="flex items-start gap-4">
//               <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                 <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                   <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/>
//                 </svg>
//               </div>
//               <div>
//                 <h3 className="text-lg font-semibold mb-1">Smart Document Vault</h3>
//                 <p className="text-gray-400 text-sm">Secure, searchable, and organized</p>
//               </div>
//             </div>

//             <div className="flex items-start gap-4">
//               <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                 <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                   <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/>
//                 </svg>
//               </div>
//               <div>
//                 <h3 className="text-lg font-semibold mb-1">Trusted Legal Insights</h3>
//                 <p className="text-gray-400 text-sm">AI-driven precedents & analysis</p>
//               </div>
//             </div>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default LoginPage;



// // src/pages/Auth/LoginPage.jsx
// import React, { useState } from "react";
// import { useNavigate } from "react-router-dom";
// import { Eye, EyeOff, CheckCircle } from "lucide-react";
// import apiService from "../../services/api"; // ✅ connect to backend

// const LoginPage = () => {
//   const [formData, setFormData] = useState({ email: "", password: "" });
//   const [errors, setErrors] = useState({});
//   const [showPassword, setShowPassword] = useState(false);
//   const [isOTPStage, setIsOTPStage] = useState(false);
//   const [otp, setOtp] = useState("");
//   const [successMessage, setSuccessMessage] = useState("");
//   const [isVerifying, setIsVerifying] = useState(false);
//   const [isLoading, setIsLoading] = useState(false);
//   const [serverMessage, setServerMessage] = useState("");
//   const navigate = useNavigate();

//   // ---------------- Validation ----------------
//   const validateEmail = (email) => {
//     if (!email) return "Email is required.";
//     if (!/\S+@\S+\.\S+/.test(email)) return "Invalid email format.";
//     return "";
//   };
//   const validatePassword = (password) =>
//     !password ? "Password is required." : "";

//   // ---------------- Handle Input ----------------
//   const handleChange = (e) => {
//     const { name, value } = e.target;
//     setFormData({ ...formData, [name]: value });
//     setErrors((prev) => ({ ...prev, [name]: "" }));
//   };

//   // ---------------- Send OTP ----------------
//   const handleSendOTP = async (e) => {
//   e.preventDefault();
//   const emailError = validateEmail(formData.email);
//   const passwordError = validatePassword(formData.password);
//   setErrors({ email: emailError, password: passwordError });
//   if (emailError || passwordError) return;

//   try {
//     setIsLoading(true);
//     const res = await apiService.login(formData);
//     setServerMessage(res.message);
//     setIsOTPStage(true);
//   } catch (err) {
//     setServerMessage(err.message || "Failed to send OTP");
//   } finally {
//     setIsLoading(false);
//   }
// };

//   // ---------------- Verify OTP ----------------
//   const handleVerifyOTP = async () => {
//     if (otp.length !== 6) {
//       alert("Please enter a 6-digit OTP.");
//       return;
//     }

//     try {
//       setIsVerifying(true);
//       const res = await apiService.verifyOtp(formData.email, otp);
//       setSuccessMessage(res.message);
//       localStorage.setItem("token", res.token);
//       localStorage.setItem("user", JSON.stringify(res.user));
//       setTimeout(() => navigate("/dashboard"), 1500);
//     } catch (err) {
//       setSuccessMessage(err.message || "Invalid OTP. Try again.");
//     } finally {
//       setIsVerifying(false);
//     }
//   };

//   return (
//     <div className="min-h-screen flex font-sans transition-all duration-700 ease-in-out">
//       {/* Left Section (Login + OTP) */}
//       <div className="w-full lg:w-1/2 bg-white flex items-center justify-center p-8 lg:p-12">
//         {/* ------------- Login Screen ------------- */}
//         {!isOTPStage && (
//           <div className="max-w-md w-full transition-opacity duration-700">
//             <div className="flex justify-center mb-8">
//               <div
//                 className="w-16 h-16 rounded-lg flex items-center justify-center"
//                 style={{ backgroundColor: "#1AA49B" }}
//               >
//                 <svg
//                   className="w-10 h-10 text-white"
//                   viewBox="0 0 24 24"
//                   fill="currentColor"
//                 >
//                   <path d="M3 3h8l4 4-4 4H3V3zm10 10h8v8h-8l-4-4 4-4z" />
//                 </svg>
//               </div>
//             </div>

//             <h2 className="text-3xl font-bold text-gray-900 mb-2 text-center">
//               Welcome to NexIntel AI
//             </h2>
//             <p className="text-gray-500 mb-8 text-center text-sm">
//               Sign in to continue managing your legal workspace.
//             </p>

//             <form className="space-y-5" onSubmit={handleSendOTP}>
//               <div>
//                 <label className="block text-sm font-medium text-gray-700 mb-1">
//                   Email / User ID
//                 </label>
//                 <input
//                   type="text"
//                   name="email"
//                   placeholder="Enter your email"
//                   className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] text-black"
//                   value={formData.email}
//                   onChange={handleChange}
//                 />
//                 {errors.email && (
//                   <p className="mt-1 text-xs text-red-600">{errors.email}</p>
//                 )}
//               </div>

//               <div>
//                 <label className="block text-sm font-medium text-gray-700 mb-1">
//                   Password
//                 </label>
//                 <div className="relative">
//                   <input
//                     type={showPassword ? "text" : "password"}
//                     name="password"
//                     placeholder="Enter your password"
//                     className="w-full px-4 py-2.5 border border-gray-300 rounded-lg pr-10 focus:ring-2 focus:ring-[#21C1B6] text-black"
//                     value={formData.password}
//                     onChange={handleChange}
//                   />
//                   <button
//                     type="button"
//                     onClick={() => setShowPassword(!showPassword)}
//                     className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
//                   >
//                     {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
//                   </button>
//                 </div>
//                 {errors.password && (
//                   <p className="mt-1 text-xs text-red-600">{errors.password}</p>
//                 )}
//               </div>

//               <button
//                 type="submit"
//                 disabled={isLoading}
//                 className="w-full py-3 px-5 text-white font-semibold rounded-lg transition duration-300 mt-6"
//                 style={{
//                   background:
//                     "linear-gradient(90deg, #21C1B6 0%, #1AA49B 100%)",
//                 }}
//               >
//                 {isLoading ? "Sending OTP..." : "Send OTP"}
//               </button>
//             </form>

//             {serverMessage && (
//               <p className="text-sm text-center mt-4 text-gray-600">
//                 {serverMessage}
//               </p>
//             )}
//           </div>
//         )}

//         {/* ------------- OTP Screen ------------- */}
//         {isOTPStage && (
//           <div className="max-w-md w-full text-center animate-fadeIn">
//             <div className="flex justify-center mb-8">
//               <div
//                 className="w-16 h-16 rounded-lg flex items-center justify-center"
//                 style={{
//                   background:
//                     "linear-gradient(135deg, #21C1B6 0%, #1AA49B 100%)",
//                 }}
//               >
//                 <CheckCircle className="w-10 h-10 text-white" />
//               </div>
//             </div>
//             <h2 className="text-2xl font-bold text-gray-900 mb-2">Enter OTP</h2>
//             <p className="text-gray-500 mb-6 text-sm">
//               We’ve sent a 6-digit code to your registered email.
//             </p>

//             <input
//               type="text"
//               maxLength="6"
//               placeholder="Enter 6-digit OTP"
//               className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center tracking-widest text-lg text-black focus:ring-2 focus:ring-[#21C1B6]"
//               value={otp}
//               onChange={(e) => setOtp(e.target.value)}
//             />

//             <button
//               onClick={handleVerifyOTP}
//               disabled={isVerifying}
//               className="w-full mt-6 py-3 px-5 text-white font-semibold rounded-lg transition duration-300"
//               style={{
//                 background:
//                   "linear-gradient(90deg, #21C1B6 0%, #1AA49B 100%)",
//               }}
//             >
//               {isVerifying ? "Verifying..." : "Verify OTP"}
//             </button>

//             {successMessage && (
//               <p className="text-green-600 mt-4 text-sm animate-fadeIn">
//                 {successMessage}
//               </p>
//             )}
//           </div>
//         )}
//       </div>

//       {/* Right visual column remains same */}
//       <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-gray-800 via-gray-900 to-gray-950 items-center justify-center p-12 relative overflow-hidden">
//         <div className="absolute inset-0 opacity-10">
//           <div className="absolute top-20 right-20 w-64 h-64 rounded-full blur-3xl" style={{ backgroundColor: '#1AA49B' }}></div>
//           <div className="absolute bottom-20 left-20 w-64 h-64 bg-blue-500 rounded-full blur-3xl"></div>
//         </div>

//         <div className="max-w-lg text-white relative z-10">
//           <div className="mb-8 relative">
//             <div className="bg-gradient-to-br from-gray-700 to-gray-800 rounded-2xl p-8 shadow-2xl">
//               <div className="flex gap-2 mb-6">
//                 <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//                 <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//                 <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//               </div>
              
//               <div className="flex gap-4 items-center justify-center">
//                 <div className="space-y-3">
//                   <div className="w-12 h-12 rounded-lg" style={{ backgroundColor: '#1AA49B' }}></div>
//                   <div className="w-12 h-12 bg-gray-700 rounded-lg"></div>
//                   <div className="w-12 h-12 bg-gray-700 rounded-lg"></div>
//                 </div>
                
//                 <div className="bg-white rounded-lg p-4 w-48">
//                   <div className="space-y-2">
//                     <div className="h-3 rounded w-3/4" style={{ backgroundColor: '#1AA49B' }}></div>
//                     <div className="h-2 bg-gray-300 rounded"></div>
//                     <div className="h-2 bg-gray-300 rounded"></div>
//                     <div className="h-2 bg-gray-300 rounded w-5/6"></div>
//                   </div>
//                 </div>

//                 <div className="space-y-4">
//                   <div className="w-16 h-16 relative">
//                     <div className="absolute top-0 right-0 w-8 h-12 bg-gray-600 rounded transform rotate-45"></div>
//                     <div className="absolute bottom-0 left-0 w-12 h-6 rounded" style={{ backgroundColor: '#1AA49B' }}></div>
//                   </div>
//                   <div className="w-16 h-16 flex items-end justify-center">
//                     <div className="w-12 h-12 border-4 border-gray-600 rounded-full relative">
//                       <div className="absolute -top-6 left-1/2 -translate-x-1/2 w-1 h-8 bg-gray-600"></div>
//                     </div>
//                   </div>
//                 </div>
//               </div>
//             </div>
//           </div>

//           <h2 className="text-4xl font-bold mb-8 leading-tight text-center">
//             Automate Your Legal Workflow in Minutes
//           </h2>

//           <div className="space-y-6 bg-gradient-to-br from-gray-800/50 to-gray-900/50 backdrop-blur-sm rounded-2xl p-6">
//             <div className="flex items-start gap-4">
//               <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                 <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                   <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z"/>
//                 </svg>
//               </div>
//               <div>
//                 <h3 className="text-lg font-semibold mb-1">Accelerate case preparation</h3>
//                 <p className="text-gray-400 text-sm">in minutes with AI-powered tools</p>
//               </div>
//             </div>

//             <div className="flex items-start gap-4">
//               <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                 <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                   <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/>
//                 </svg>
//               </div>
//               <div>
//                 <h3 className="text-lg font-semibold mb-1">Smart Document Vault</h3>
//                 <p className="text-gray-400 text-sm">Secure, searchable, and organized</p>
//               </div>
//             </div>

//             <div className="flex items-start gap-4">
//               <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                 <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                   <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/>
//                 </svg>
//               </div>
//               <div>
//                 <h3 className="text-lg font-semibold mb-1">Trusted Legal Insights</h3>
//                 <p className="text-gray-400 text-sm">AI-driven precedents & analysis</p>
//               </div>
//             </div>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default LoginPage;


// import React, { useState, useRef } from 'react';
// import { Link, useNavigate } from 'react-router-dom';
// import { toast } from 'react-toastify';
// import 'react-toastify/dist/ReactToastify.css';
// import { Eye, EyeOff, Shield, Mail, Lock, ArrowRight, Sparkles } from 'lucide-react';
// import { motion, useInView } from 'framer-motion';
// import PublicLayout from '../../layouts/PublicLayout';
// import { useAuth } from '../../context/AuthContext';

// const LoginPage = () => {
//  const [formData, setFormData] = useState({
//  email: '',
//  password: '',
//  });

//  const [errors, setErrors] = useState({});
//  const [showPassword, setShowPassword] = useState(false);
//  const [loginSuccess, setLoginSuccess] = useState(false);
//  const [isLoading, setIsLoading] = useState(false);
//  const [showOtpField, setShowOtpField] = useState(false);
//  const [otp, setOtp] = useState('');
//  const [otpEmail, setOtpEmail] = useState(''); // To store the email for OTP verification

//  const navigate = useNavigate();
//  const { login, verifyOtp } = useAuth();
//  const formRef = useRef(null);
//  const isInView = useInView(formRef, { once: true });

//  const validateEmail = (email) => {
//  if (!email) return 'Email is required.';
//  if (!/\S+@\S+\.\S+/.test(email)) return 'Email address is invalid.';
//  return '';
//  };

//  const validatePassword = (password) => {
//  if (!password) return 'Password is required.';
//  return '';
//  };

//  const handleChange = (e) => {
//  const { name, value } = e.target;
//  setFormData({
//  ...formData,
//  [name]: value,
//  });

//  // Real-time validation feedback
//  if (name === 'email') {
//  setErrors((prevErrors) => ({
//  ...prevErrors,
//  email: validateEmail(value),
//  }));
//  } else if (name === 'password') {
//  setErrors((prevErrors) => ({
//  ...prevErrors,
//  password: validatePassword(value),
//  }));
//  }
//  };

//  const handleSubmit = async (e) => {
//  e.preventDefault();
//  const emailError = validateEmail(formData.email);
//  const passwordError = validatePassword(formData.password);

//  setErrors({
//  email: emailError,
//  password: passwordError,
//  });

//  if (emailError || passwordError) {
//  return;
//  }

//  setIsLoading(true);

//  try {
//  const result = await login(formData.email, formData.password);
//  console.log("Login result:", result); // Added for debugging

//  if (result.requiresOtp) {
//  setShowOtpField(true);
//  setOtpEmail(result.email);
//  toast.info(result.message || 'OTP required. Please check your email.');
//  } else if (result.success) {
//  toast.success('Login successful!');
//  setLoginSuccess(true);
//  navigate('/dashboard');
//  } else {
//  toast.error(result.message || 'Login failed.');
//  }
//  } catch (error) {
//  if (loginSuccess) {
//  return;
//  }
//  toast.error(error.message || 'An unexpected error occurred. Please try again.');
//  console.error('Unexpected error:', error);
//  } finally {
//  setIsLoading(false);
//  }
//  };

//  const handleOtpChange = (e) => {
//  setOtp(e.target.value);
//  };

//  const handleOtpSubmit = async (e) => {
//  e.preventDefault();
//  setIsLoading(true);
//  try {
//  const result = await verifyOtp(otpEmail, otp);
//  if (result.success) {
//  toast.success('OTP verification successful! Logging in...');
//  setLoginSuccess(true);
//  navigate('/dashboard');
//  } else {
//  toast.error(result.message || 'OTP verification failed.');
//  }
//  } catch (error) {
//  toast.error(error.message || 'An unexpected error occurred during OTP verification. Please try again.');
//  console.error('OTP verification error:', error);
//  } finally {
//  setIsLoading(false);
//  }
//  };

//  // Animation variants
//  const containerVariants = {
//  hidden: { opacity: 0 },
//  visible: {
//  opacity: 1,
//  transition: {
//  staggerChildren: 0.1,
//  delayChildren: 0.2
//  }
//  }
//  };

//  const itemVariants = {
//  hidden: { 
//  opacity: 0, 
//  y: 30,
//  scale: 0.95
//  },
//  visible: { 
//  opacity: 1, 
//  y: 0,
//  scale: 1,
//  transition: {
//  duration: 0.6,
//  ease: [0.25, 0.46, 0.45, 0.94]
//  }
//  }
//  };

//  const formVariants = {
//  hidden: { 
//  opacity: 0, 
//  y: 50,
//  rotateX: -15
//  },
//  visible: { 
//  opacity: 1, 
//  y: 0,
//  rotateX: 0,
//  transition: {
//  duration: 0.8,
//  ease: [0.25, 0.46, 0.45, 0.94]
//  }
//  }
//  };

//  const inputVariants = {
//  hidden: { opacity: 0, x: -20 },
//  visible: { 
//  opacity: 1, 
//  x: 0,
//  transition: {
//  duration: 0.5,
//  ease: "easeOut"
//  }
//  }
//  };

//  const glowVariants = {
//  initial: { scale: 1, opacity: 0.7 },
//  animate: {
//  scale: [1, 1.2, 1],
//  opacity: [0.7, 1, 0.7],
//  transition: {
//  duration: 3,
//  repeat: Infinity,
//  ease: "easeInOut"
//  }
//  }
//  };

//  return (
//  <PublicLayout>
//  {/* Animated background elements */}
//  <div className="fixed inset-0 overflow-hidden pointer-events-none">
//  <motion.div 
//  className="absolute -top-40 -right-40 w-80 h-80 bg-gradient-to-br from-blue-100 to-purple-100 rounded-full blur-3xl opacity-20"
//  animate={{
//  scale: [1, 1.1, 1],
//  rotate: [0, 180, 360]
//  }}
//  transition={{
//  duration: 20,
//  repeat: Infinity,
//  ease: "linear"
//  }}
//  />
//  <motion.div 
//  className="absolute -bottom-40 -left-40 w-96 h-96 bg-gradient-to-br from-gray-100 to-blue-100 rounded-full blur-3xl opacity-20"
//  animate={{
//  scale: [1, 1.2, 1],
//  rotate: [360, 180, 0]
//  }}
//  transition={{
//  duration: 25,
//  repeat: Infinity,
//  ease: "linear"
//  }}
//  />
//  </div>

//  <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-white to-gray-50 py-12 px-4 sm:px-6 lg:px-8 relative">
//  {/* Animated grid background */}
//  <div className="absolute inset-0 opacity-5">
//  <div className="absolute inset-0" style={{
//  backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23374151' fill-opacity='0.3'%3E%3Ccircle cx='7' cy='7' r='1'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
//  }} />
//  </div>

//  <motion.div 
//  ref={formRef}
//  className="max-w-md w-full space-y-8 relative z-10"
//  variants={containerVariants}
//  initial="hidden"
//  animate={isInView ? "visible" : "hidden"}
//  >
//  {/* Form container with glassmorphism effect */}
//  <motion.div 
//  className="relative p-10 bg-white/80 backdrop-blur-sm rounded-2xl shadow-2xl border border-gray-200/50 overflow-hidden"
//  variants={formVariants}
//  >
//  {/* Animated border glow */}
//  <motion.div 
//  className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 rounded-2xl blur-sm opacity-0"
//  animate={{
//  opacity: [0, 0.3, 0]
//  }}
//  transition={{
//  duration: 3,
//  repeat: Infinity,
//  ease: "easeInOut"
//  }}
//  />

//  {/* Header section */}
//  <motion.div 
//  className="text-center"
//  variants={itemVariants}
//  >
//  {/* Logo with glow effect */}
//  <motion.div 
//  className="relative inline-flex items-center justify-center mb-6"
//  variants={itemVariants}
//  >
//  <motion.div 
//  className="absolute w-20 h-20 bg-gray-700 rounded-2xl blur-md opacity-20"
//  variants={glowVariants}
//  initial="initial"
//  animate="animate"
//  />
//  <motion.div 
//  className="relative w-16 h-16 bg-gradient-to-br from-gray-700 to-gray-800 rounded-2xl shadow-2xl flex items-center justify-center"
//  whileHover={{ 
//  scale: 1.05,
//  rotate: [0, -5, 5, 0],
//  transition: { duration: 0.3 }
//  }}
//  whileTap={{ scale: 0.95 }}
//  >
//  <Shield className="w-8 h-8 text-white" />
//  <motion.div 
//  className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent rounded-2xl"
//  animate={{
//  opacity: [0, 0.3, 0]
//  }}
//  transition={{
//  duration: 2,
//  repeat: Infinity,
//  ease: "easeInOut"
//  }}
//  />
//  </motion.div>
//  </motion.div>

//  <motion.h2 
//  className="text-3xl font-bold bg-gradient-to-r from-gray-800 via-gray-700 to-gray-800 bg-clip-text text-transparent mb-2"
//  variants={itemVariants}
//  >
//  Welcome Back
//  </motion.h2>
 
//  <motion.p 
//  className="text-gray-600 mb-8"
//  variants={itemVariants}
//  >
//  Or{' '}
//  <Link 
//  to="/register" 
//  className="font-medium text-gray-700 hover:text-gray-800 relative group"
//  >
//  <span className="relative z-10">create a new account</span>
//  <motion.div 
//  className="absolute bottom-0 left-0 w-0 h-0.5 bg-gradient-to-r from-gray-600 to-gray-700 group-hover:w-full transition-all duration-300"
//  />
//  </Link>
//  </motion.p>
//  </motion.div>

//  {/* Form */}
//  {!showOtpField ? (
//  <motion.form
//  className="space-y-6"
//  onSubmit={handleSubmit}
//  variants={containerVariants}
//  >
//  {/* Email field */}
//  <motion.div variants={inputVariants}>
//  <label htmlFor="email-address" className="block text-sm font-medium text-gray-700 mb-2">
//  Email Address
//  </label>
//  <div className="relative group">
//  <motion.div
//  className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"
//  whileHover={{ scale: 1.1 }}
//  >
//  <Mail className="h-5 w-5 text-gray-400 group-focus-within:text-gray-600 transition-colors" />
//  </motion.div>
//  <motion.input
//  id="email-address"
//  name="email"
//  type="email"
//  autoComplete="email"
//  required
//  className={`block w-full pl-10 pr-3 py-3 border ${
//  errors.email ? 'border-red-500' : 'border-gray-300'
//  } rounded-xl placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-transparent transition-all duration-300 bg-white/50 backdrop-blur-sm`}
//  placeholder="Enter your email"
//  value={formData.email}
//  onChange={handleChange}
//  whileFocus={{ scale: 1.02 }}
//  transition={{ duration: 0.2 }}
//  />
//  {errors.email && (
//  <motion.p
//  className="mt-2 text-sm text-red-600"
//  initial={{ opacity: 0, y: -10 }}
//  animate={{ opacity: 1, y: 0 }}
//  transition={{ duration: 0.3 }}
//  >
//  {errors.email}
//  </motion.p>
//  )}
//  </div>
//  </motion.div>

//  {/* Password field */}
//  <motion.div variants={inputVariants}>
//  <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
//  Password
//  </label>
//  <div className="relative group">
//  <motion.div
//  className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"
//  whileHover={{ scale: 1.1 }}
//  >
//  <Lock className="h-5 w-5 text-gray-400 group-focus-within:text-gray-600 transition-colors" />
//  </motion.div>
//  <motion.input
//  id="password"
//  name="password"
//  type={showPassword ? 'text' : 'password'}
//  autoComplete="current-password"
//  required
//  className={`block w-full pl-10 pr-12 py-3 border ${
//  errors.password ? 'border-red-500' : 'border-gray-300'
//  } rounded-xl placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-transparent transition-all duration-300 bg-white/50 backdrop-blur-sm`}
//  placeholder="Enter your password"
//  value={formData.password}
//  onChange={handleChange}
//  whileFocus={{ scale: 1.02 }}
//  transition={{ duration: 0.2 }}
//  />
//  <motion.button
//  type="button"
//  className="absolute inset-y-0 right-0 pr-3 flex items-center"
//  onClick={() => setShowPassword(!showPassword)}
//  whileHover={{ scale: 1.1 }}
//  whileTap={{ scale: 0.95 }}
//  >
//  <motion.div
//  animate={{ rotate: showPassword ? 180 : 0 }}
//  transition={{ duration: 0.3 }}
//  >
//  {showPassword ? (
//  <EyeOff className="h-5 w-5 text-gray-400 hover:text-gray-600 transition-colors" />
//  ) : (
//  <Eye className="h-5 w-5 text-gray-400 hover:text-gray-600 transition-colors" />
//  )}
//  </motion.div>
//  </motion.button>
//  {errors.password && (
//  <motion.p
//  className="mt-2 text-sm text-red-600"
//  initial={{ opacity: 0, y: -10 }}
//  animate={{ opacity: 1, y: 0 }}
//  transition={{ duration: 0.3 }}
//  >
//  {errors.password}
//  </motion.p>
//  )}
//  </div>
//  </motion.div>

//  {/* Forgot password link */}
//  <motion.div
//  className="flex items-center justify-end"
//  variants={inputVariants}
//  >
//  <Link
//  to="#"
//  className="text-sm font-medium text-gray-700 hover:text-gray-800 relative group"
//  >
//  <span className="relative z-10">Forgot your password?</span>
//  <motion.div
//  className="absolute bottom-0 left-0 w-0 h-0.5 bg-gradient-to-r from-gray-600 to-gray-700 group-hover:w-full transition-all duration-300"
//  />
//  </Link>
//  </motion.div>

//  {/* Submit button */}
//  <motion.div variants={inputVariants}>
//  <motion.button
//  type="submit"
//  disabled={isLoading}
//  className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-xl text-white bg-gradient-to-r from-gray-700 to-gray-800 hover:from-gray-800 hover:to-gray-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden"
//  whileHover={{ scale: 1.02 }}
//  whileTap={{ scale: 0.98 }}
//  >
//  <motion.div
//  className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0"
//  initial={{ x: '-100%' }}
//  whileHover={{ x: '100%' }}
//  transition={{ duration: 0.6 }}
//  />
 
//  <span className="relative z-10 flex items-center">
//  {isLoading ? (
//  <>
//  <motion.div
//  className="w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2"
//  animate={{ rotate: 360 }}
//  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
//  />
//  Signing in...
//  </>
//  ) : (
//  <>
//  Sign in
//  <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform duration-300" />
//  </>
//  )}
//  </span>
//  </motion.button>
//  </motion.div>
//  </motion.form>
//  ) : (
//  <motion.form
//  className="space-y-6"
//  onSubmit={handleOtpSubmit}
//  variants={containerVariants}
//  >
//  <motion.div variants={inputVariants}>
//  <label htmlFor="otp" className="block text-sm font-medium text-gray-700 mb-2">
//  Enter OTP
//  </label>
//  <div className="relative group">
//  <motion.div
//  className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"
//  whileHover={{ scale: 1.1 }}
//  >
//  <Shield className="h-5 w-5 text-gray-400 group-focus-within:text-gray-600 transition-colors" />
//  </motion.div>
//  <motion.input
//  id="otp"
//  name="otp"
//  type="text"
//  autoComplete="one-time-code"
//  required
//  className={`block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-xl placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-transparent transition-all duration-300 bg-white/50 backdrop-blur-sm`}
//  placeholder="Enter your OTP"
//  value={otp}
//  onChange={handleOtpChange}
//  whileFocus={{ scale: 1.02 }}
//  transition={{ duration: 0.2 }}
//  />
//  </div>
//  </motion.div>
//  <motion.div variants={inputVariants}>
//  <motion.button
//  type="submit"
//  disabled={isLoading}
//  className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-xl text-white bg-gradient-to-r from-gray-700 to-gray-800 hover:from-gray-800 hover:to-gray-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden"
//  whileHover={{ scale: 1.02 }}
//  whileTap={{ scale: 0.98 }}
//  >
//  <motion.div
//  className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0"
//  initial={{ x: '-100%' }}
//  whileHover={{ x: '100%' }}
//  transition={{ duration: 0.6 }}
//  />
 
//  <span className="relative z-10 flex items-center">
//  {isLoading ? (
//  <>
//  <motion.div
//  className="w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2"
//  animate={{ rotate: 360 }}
//  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
//  />
//  Verifying OTP...
//  </>
//  ) : (
//  <>
//  Verify OTP
//  <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform duration-300" />
//  </>
//  )}
//  </span>
//  </motion.button>
//  </motion.div>
//  </motion.form>
//  )}

//  {/* Floating elements */}
//  <motion.div 
//  className="absolute top-4 right-4 w-2 h-2 bg-gray-400 rounded-full opacity-30"
//  animate={{
//  y: [0, -10, 0],
//  x: [0, 5, 0]
//  }}
//  transition={{
//  duration: 3,
//  repeat: Infinity,
//  ease: "easeInOut"
//  }}
//  />
//  <motion.div 
//  className="absolute bottom-4 left-4 w-3 h-3 bg-gray-300 rounded-full opacity-20"
//  animate={{
//  y: [0, -15, 0],
//  x: [0, -8, 0]
//  }}
//  transition={{
//  duration: 4,
//  repeat: Infinity,
//  ease: "easeInOut",
//  delay: 1
//  }}
//  />
//  </motion.div>

//  {/* Additional features hint */}
//  <motion.div 
//  className="text-center"
//  variants={itemVariants}
//  >
//  <motion.p 
//  className="text-sm text-gray-500 flex items-center justify-center"
//  whileHover={{ scale: 1.02 }}
//  >
//  <Sparkles className="w-4 h-4 mr-2" />
//  Secure login with enterprise-grade encryption
//  </motion.p>
//  </motion.div>
//  </motion.div>
//  </div>
//  </PublicLayout>
//  );
// };

// export default LoginPage;



// import React, { useState } from "react";
// import { useNavigate, Link } from "react-router-dom";
// import { Eye, EyeOff, CheckCircle, ArrowLeft } from "lucide-react";
// import { toast } from 'react-toastify';
// import 'react-toastify/dist/ReactToastify.css';
// import { useAuth } from '../../context/AuthContext'; // Using AuthContext like the working version

// const LoginPage = () => {
//   const [formData, setFormData] = useState({ email: "", password: "" });
//   const [errors, setErrors] = useState({});
//   const [showPassword, setShowPassword] = useState(false);
//   const [isOTPStage, setIsOTPStage] = useState(false);
//   const [otp, setOtp] = useState("");
//   const [successMessage, setSuccessMessage] = useState("");
//   const [isVerifying, setIsVerifying] = useState(false);
//   const [isLoading, setIsLoading] = useState(false);
//   const [serverMessage, setServerMessage] = useState("");
//   const [otpEmail, setOtpEmail] = useState(''); // To store email for OTP verification
//   const [loginSuccess, setLoginSuccess] = useState(false);

//   const navigate = useNavigate();
//   const { login, verifyOtp } = useAuth(); // Using AuthContext methods

//   // ---------------- Validation (from working version) ----------------
//   const validateEmail = (email) => {
//     if (!email) return "Email is required.";
//     if (!/\S+@\S+\.\S+/.test(email)) return "Invalid email format.";
//     return "";
//   };
  
//   const validatePassword = (password) => {
//     if (!password) return "Password is required.";
//     if (password.length < 8) return "Password must be at least 8 characters long.";
//     if (!/(?=.*[a-z])/.test(password)) return "Password must contain at least one lowercase letter.";
//     if (!/(?=.*[A-Z])/.test(password)) return "Password must contain at least one uppercase letter.";
//     if (!/(?=.*\d)/.test(password)) return "Password must contain at least one number.";
//     if (!/(?=.*[@$!%*?&])/.test(password)) return "Password must contain at least one special character (@$!%*?&).";
//     return "";
//   };

//   // ---------------- Handle Input ----------------
//   const handleChange = (e) => {
//     const { name, value } = e.target;
//     setFormData({ ...formData, [name]: value });
    
//     // Real-time validation feedback
//     if (name === 'email') {
//       setErrors((prev) => ({ ...prev, email: validateEmail(value) }));
//     } else if (name === 'password') {
//       setErrors((prev) => ({ ...prev, password: validatePassword(value) }));
//     }
//   };

//   // ---------------- Send OTP (using AuthContext logic) ----------------
//   const handleSendOTP = async (e) => {
//     e.preventDefault();
//     const emailError = validateEmail(formData.email);
//     const passwordError = validatePassword(formData.password);
//     setErrors({ email: emailError, password: passwordError });
//     if (emailError || passwordError) return;

//     setIsLoading(true);

//     try {
//       const result = await login(formData.email, formData.password);
//       console.log("Login result:", result); // Added for debugging

//       if (result.requiresOtp) {
//         setIsOTPStage(true);
//         setOtpEmail(result.email || formData.email);
//         setServerMessage(result.message || 'OTP sent to your email. Please check and enter the code.');
//         toast.info(result.message || 'OTP required. Please check your email.');
//       } else if (result.success) {
//         toast.success('Login successful!');
//         setLoginSuccess(true);
//         navigate('/dashboard');
//       } else {
//         setServerMessage(result.message || "Failed to send OTP");
//         toast.error(result.message || 'Login failed.');
//       }
//     } catch (error) {
//       if (loginSuccess) {
//         return;
//       }
//       setServerMessage(error.message || "Failed to send OTP");
//       toast.error(error.message || 'An unexpected error occurred. Please try again.');
//       console.error('Unexpected error:', error);
//     } finally {
//       setIsLoading(false);
//     }
//   };

//   // ---------------- Verify OTP (using AuthContext logic) ----------------
//   const handleVerifyOTP = async (e) => {
//     if (e) e.preventDefault();
    
//     if (otp.length !== 6) {
//       toast.error("Please enter a 6-digit OTP.");
//       return;
//     }

//     setIsVerifying(true);
//     try {
//       const result = await verifyOtp(otpEmail || formData.email, otp);
//       if (result.success) {
//         setSuccessMessage('OTP verification successful! Logging in...');
//         toast.success('OTP verification successful! Logging in...');
//         setLoginSuccess(true);
//         navigate('/dashboard');
//       } else {
//         setSuccessMessage(result.message || "Invalid OTP. Try again.");
//         toast.error(result.message || 'OTP verification failed.');
//       }
//     } catch (error) {
//       setSuccessMessage(error.message || "Invalid OTP. Try again.");
//       toast.error(error.message || 'An unexpected error occurred during OTP verification. Please try again.');
//       console.error('OTP verification error:', error);
//     } finally {
//       setIsVerifying(false);
//     }
//   };

//   return (
//     <div className="min-h-screen flex font-sans transition-all duration-700 ease-in-out">
//       {/* Left Section (Login + OTP) */}
//       <div className="w-full lg:w-1/2 bg-white flex items-center justify-center p-8 lg:p-12">
//         {/* ------------- Login Screen ------------- */}
//         {!isOTPStage && (
//           <div className="max-w-md w-full transition-opacity duration-700">
//             <div className="flex justify-center mb-8">
//               <div
//                 className="w-16 h-16 rounded-lg flex items-center justify-center"
//                 style={{ backgroundColor: "#1AA49B" }}
//               >
//                 <svg
//                   className="w-10 h-10 text-white"
//                   viewBox="0 0 24 24"
//                   fill="currentColor"
//                 >
//                   <path d="M3 3h8l4 4-4 4H3V3zm10 10h8v8h-8l-4-4 4-4z" />
//                 </svg>
//               </div>
//             </div>

//             <h2 className="text-3xl font-bold text-gray-900 mb-2 text-center">
//               Welcome to JuriNexAI
//             </h2>
//             <p className="text-gray-500 mb-8 text-center text-sm">
//               Sign in to continue managing your legal workspace.
//             </p>

//             <form className="space-y-5" onSubmit={handleSendOTP}>
//               <div>
//                 <label className="block text-sm font-medium text-gray-700 mb-1">
//                   Email / User ID
//                 </label>
//                 <input
//                   type="text"
//                   name="email"
//                   placeholder="Enter your email"
//                   className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] text-black"
//                   value={formData.email}
//                   onChange={handleChange}
//                 />
//                 {errors.email && (
//                   <p className="mt-1 text-xs text-red-600">{errors.email}</p>
//                 )}
//               </div>

//               <div>
//                 <label className="block text-sm font-medium text-gray-700 mb-1">
//                   Password
//                 </label>
//                 <div className="relative">
//                   <input
//                     type={showPassword ? "text" : "password"}
//                     name="password"
//                     placeholder="Enter your password"
//                     className="w-full px-4 py-2.5 border border-gray-300 rounded-lg pr-10 focus:ring-2 focus:ring-[#21C1B6] text-black"
//                     value={formData.password}
//                     onChange={handleChange}
//                   />
//                   <button
//                     type="button"
//                     onClick={() => setShowPassword(!showPassword)}
//                     className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
//                   >
//                     {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
//                   </button>
//                 </div>
//                 {errors.password && (
//                   <p className="mt-1 text-xs text-red-600">{errors.password}</p>
//                 )}
//               </div>

//               <button
//                 type="submit"
//                 disabled={isLoading}
//                 className="w-full py-3 px-5 text-white font-semibold rounded-lg transition duration-300 mt-6 disabled:opacity-50 disabled:cursor-not-allowed"
//                 style={{
//                   background:
//                     "linear-gradient(90deg, #21C1B6 0%, #1AA49B 100%)",
//                 }}
//               >
//                 {isLoading ? "Sending OTP..." : "Send OTP"}
//               </button>
//             </form>

//             {/* Register Link and Navigation Below Send OTP Button */}
//             <div className="mt-6 space-y-4">
//               {/* Register Link */}
//               <div className="text-center">
//                 <p className="text-sm text-gray-600">
//                   Don't have an account?{' '}
//                   <Link 
//                     to="/register" 
//                     className="font-medium text-[#1AA49B] hover:text-[#21C1B6] transition-colors duration-200"
//                   >
//                     Create new account
//                   </Link>
//                 </p>
//               </div>
              
//               {/* Back to Home Button */}
//               <div className="text-center">
//                 <button
//                   onClick={() => navigate('/')}
//                   className="flex items-center justify-center mx-auto text-gray-600 hover:text-gray-800 transition-colors duration-200 group"
//                 >
//                   <ArrowLeft size={18} className="mr-2 group-hover:-translate-x-1 transition-transform duration-200" />
//                   <span className="text-sm font-medium">Back to Home</span>
//                 </button>
//               </div>
//             </div>

//             {serverMessage && (
//               <p className="text-sm text-center mt-4 text-gray-600">
//                 {serverMessage}
//               </p>
//             )}
//           </div>
//         )}

//         {/* ------------- OTP Screen ------------- */}
//         {isOTPStage && (
//           <div className="max-w-md w-full text-center animate-fadeIn">
//             {/* Back to Login Button */}
//             <div className="mb-6 text-left">
//               <button
//                 onClick={() => setIsOTPStage(false)}
//                 className="flex items-center text-gray-600 hover:text-gray-800 transition-colors duration-200 group"
//               >
//                 <ArrowLeft size={20} className="mr-2 group-hover:-translate-x-1 transition-transform duration-200" />
//                 <span className="text-sm font-medium">Back to Login</span>
//               </button>
//             </div>

//             <div className="flex justify-center mb-8">
//               <div
//                 className="w-16 h-16 rounded-lg flex items-center justify-center"
//                 style={{
//                   background:
//                     "linear-gradient(135deg, #21C1B6 0%, #1AA49B 100%)",
//                 }}
//               >
//                 <CheckCircle className="w-10 h-10 text-white" />
//               </div>
//             </div>
//             <h2 className="text-2xl font-bold text-gray-900 mb-2">Enter OTP</h2>
//             <p className="text-gray-500 mb-6 text-sm">
//               We've sent a 6-digit code to your registered email.
//             </p>

//             <form onSubmit={handleVerifyOTP} className="space-y-6">
//               <input
//                 type="text"
//                 maxLength="6"
//                 placeholder="Enter 6-digit OTP"
//                 className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center tracking-widest text-lg text-black focus:ring-2 focus:ring-[#21C1B6]"
//                 value={otp}
//                 onChange={(e) => setOtp(e.target.value)}
//               />

//               <button
//                 type="submit"
//                 disabled={isVerifying}
//                 className="w-full mt-6 py-3 px-5 text-white font-semibold rounded-lg transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
//                 style={{
//                   background:
//                     "linear-gradient(90deg, #21C1B6 0%, #1AA49B 100%)",
//                 }}
//               >
//                 {isVerifying ? "Verifying..." : "Verify OTP"}
//               </button>
//             </form>

//             {successMessage && (
//               <p className={`mt-4 text-sm animate-fadeIn ${
//                 successMessage.includes('successful') || successMessage.includes('Logging in') 
//                   ? 'text-green-600' 
//                   : 'text-red-600'
//               }`}>
//                 {successMessage}
//               </p>
//             )}
//           </div>
//         )}
//       </div>

//       {/* Right visual column remains same */}
//       <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-gray-800 via-gray-900 to-gray-950 items-center justify-center p-12 relative overflow-hidden">
//         <div className="absolute inset-0 opacity-10">
//           <div className="absolute top-20 right-20 w-64 h-64 rounded-full blur-3xl" style={{ backgroundColor: '#1AA49B' }}></div>
//           <div className="absolute bottom-20 left-20 w-64 h-64 bg-blue-500 rounded-full blur-3xl"></div>
//         </div>

//         <div className="max-w-lg text-white relative z-10">
//           <div className="mb-8 relative">
//             <div className="bg-gradient-to-br from-gray-700 to-gray-800 rounded-2xl p-8 shadow-2xl">
//               <div className="flex gap-2 mb-6">
//                 <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//                 <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//                 <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//               </div>
              
//               <div className="flex gap-4 items-center justify-center">
//                 <div className="space-y-3">
//                   <div className="w-12 h-12 rounded-lg" style={{ backgroundColor: '#1AA49B' }}></div>
//                   <div className="w-12 h-12 bg-gray-700 rounded-lg"></div>
//                   <div className="w-12 h-12 bg-gray-700 rounded-lg"></div>
//                 </div>
                
//                 <div className="bg-white rounded-lg p-4 w-48">
//                   <div className="space-y-2">
//                     <div className="h-3 rounded w-3/4" style={{ backgroundColor: '#1AA49B' }}></div>
//                     <div className="h-2 bg-gray-300 rounded"></div>
//                     <div className="h-2 bg-gray-300 rounded"></div>
//                     <div className="h-2 bg-gray-300 rounded w-5/6"></div>
//                   </div>
//                 </div>

//                 <div className="space-y-4">
//                   <div className="w-16 h-16 relative">
//                     <div className="absolute top-0 right-0 w-8 h-12 bg-gray-600 rounded transform rotate-45"></div>
//                     <div className="absolute bottom-0 left-0 w-12 h-6 rounded" style={{ backgroundColor: '#1AA49B' }}></div>
//                   </div>
//                   <div className="w-16 h-16 flex items-end justify-center">
//                     <div className="w-12 h-12 border-4 border-gray-600 rounded-full relative">
//                       <div className="absolute -top-6 left-1/2 -translate-x-1/2 w-1 h-8 bg-gray-600"></div>
//                     </div>
//                   </div>
//                 </div>
//               </div>
//             </div>
//           </div>

//           <h2 className="text-4xl font-bold mb-8 leading-tight text-center">
//             Automate Your Legal Workflow in Minutes
//           </h2>

//           <div className="space-y-6 bg-gradient-to-br from-gray-800/50 to-gray-900/50 backdrop-blur-sm rounded-2xl p-6">
//             <div className="flex items-start gap-4">
//               <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                 <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                   <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z"/>
//                 </svg>
//               </div>
//               <div>
//                 <h3 className="text-lg font-semibold mb-1">Accelerate case preparation</h3>
//                 <p className="text-gray-400 text-sm">in minutes with AI-powered tools</p>
//               </div>
//             </div>

//             <div className="flex items-start gap-4">
//               <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                 <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                   <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/>
//                 </svg>
//               </div>
//               <div>
//                 <h3 className="text-lg font-semibold mb-1">Smart Document Vault</h3>
//                 <p className="text-gray-400 text-sm">Secure, searchable, and organized</p>
//               </div>
//             </div>

//             <div className="flex items-start gap-4">
//               <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                 <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                   <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/>
//                 </svg>
//               </div>
//               <div>
//                 <h3 className="text-lg font-semibold mb-1">Trusted Legal Insights</h3>
//                 <p className="text-gray-400 text-sm">AI-driven precedents & analysis</p>
//               </div>
//             </div>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default LoginPage;



// import React, { useState, useEffect } from "react";
// import { useNavigate, Link, useLocation } from "react-router-dom";
// import { Eye, EyeOff, CheckCircle, ArrowLeft } from "lucide-react";
// import { auth, googleProvider } from '../../config/firebase';
// import { signInWithPopup } from 'firebase/auth';

// const LoginPage = () => {
//  const [formData, setFormData] = useState({ email: "", password: "" });
//  const [errors, setErrors] = useState({});
//  const [showPassword, setShowPassword] = useState(false);
//  const [isOTPStage, setIsOTPStage] = useState(false);
//  const [otp, setOtp] = useState("");
//  const [successMessage, setSuccessMessage] = useState("");
//  const [isVerifying, setIsVerifying] = useState(false);
//  const [isLoading, setIsLoading] = useState(false);
//  const [serverMessage, setServerMessage] = useState("");
//  const [otpEmail, setOtpEmail] = useState('');
//  const [loginSuccess, setLoginSuccess] = useState(false);

//  const navigate = useNavigate();
//  const location = useLocation();

//  useEffect(() => {
//  const params = new URLSearchParams(location.search);
//  const token = params.get('token');
//  const user = params.get('user');

//  if (token && user) {
//  localStorage.setItem('token', token);
//  localStorage.setItem('user', user);
//  navigate('/dashboard');
//  }
//  }, [location, navigate]);

//  // Validation functions
//  const validateEmail = (email) => {
//  if (!email) return "Email is required.";
//  if (!/\S+@\S+\.\S+/.test(email)) return "Invalid email format.";
//  return "";
//  };
 
//  const validatePassword = (password) => {
//  if (!password) return "Password is required.";
//  if (password.length < 8) return "Password must be at least 8 characters long.";
//  if (!/(?=.*[a-z])/.test(password)) return "Password must contain at least one lowercase letter.";
//  if (!/(?=.*[A-Z])/.test(password)) return "Password must contain at least one uppercase letter.";
//  if (!/(?=.*\d)/.test(password)) return "Password must contain at least one number.";
//  if (!/(?=.*[@$!%*?&])/.test(password)) return "Password must contain at least one special character (@$!%*?&).";
//  return "";
//  };

//  const handleChange = (e) => {
//  const { name, value } = e.target;
//  setFormData({ ...formData, [name]: value });
 
//  // Clear previous messages when user starts typing
//  setServerMessage("");
//  setSuccessMessage("");
 
//  if (name === 'email') {
//  setErrors((prev) => ({ ...prev, email: validateEmail(value) }));
//  } else if (name === 'password') {
//  setErrors((prev) => ({ ...prev, password: validatePassword(value) }));
//  }
//  };

//  // Google Sign In Handler (Direct login - NO OTP required)
//  const handleGoogleSignIn = async () => {
//  try {
//  setIsLoading(true);
//  setServerMessage('');
//  setSuccessMessage('');
//  setIsOTPStage(false); // Ensure we stay on login screen, not OTP screen
 
//  const result = await signInWithPopup(auth, googleProvider);
//  const user = result.user;
 
//  // Get Firebase ID token
//  const idToken = await user.getIdToken();
 
//  // Send token to backend for verification and user creation/login
//  const response = await fetch(`${import.meta.env.VITE_API_URL}/api/auth/google`, {
//  method: 'POST',
//  headers: {
//  'Content-Type': 'application/json',
//  },
//  body: JSON.stringify({
//  idToken: idToken,
//  email: user.email,
//  displayName: user.displayName,
//  photoURL: user.photoURL,
//  }),
//  });

//  const data = await response.json();

//  if (response.ok && data.token) {
//  // Store authentication token and user info
//  localStorage.setItem('token', data.token);
//  localStorage.setItem('user', JSON.stringify({
//  email: user.email,
//  displayName: user.displayName,
//  photoURL: user.photoURL,
//  uid: user.uid
//  }));
 
//  setSuccessMessage('Google Sign-In successful! Redirecting...');
//  setLoginSuccess(true);
 
//  // Direct navigation to dashboard - NO OTP required for Google Sign-In
//  setTimeout(() => {
//  navigate('/dashboard');
//  }, 1500);
//  } else {
//  setServerMessage(data.message || 'Google Sign-In failed. Please try again.');
//  }
//  } catch (error) {
//  console.error('Google Sign-In Error:', error);
 
//  // Handle specific Firebase Auth errors gracefully
//  if (error.code === 'auth/popup-closed-by-user') {
//  setServerMessage('Sign-in cancelled. Please try again.');
//  } else if (error.code === 'auth/popup-blocked') {
//  setServerMessage('Pop-up blocked. Please allow pop-ups and try again.');
//  } else if (error.code === 'auth/cancelled-popup-request') {
//  // User cancelled - no error message needed
//  return;
//  } else {
//  setServerMessage(error.message || 'Failed to sign in with Google. Please try again.');
//  }
//  } finally {
//  setIsLoading(false);
//  }
//  };

//  // Manual Login - Send OTP (OTP is required for email/password login)
//  const handleSendOTP = async (e) => {
//  e.preventDefault();
 
//  // Validate all form fields before proceeding
//  const emailError = validateEmail(formData.email);
//  const passwordError = validatePassword(formData.password);
//  setErrors({ email: emailError, password: passwordError });
 
//  if (emailError || passwordError) return;

//  setIsLoading(true);
//  setServerMessage('');
//  setSuccessMessage('');

//  try {
//  const response = await fetch(`${import.meta.env.VITE_API_URL}/api/auth/login`, {
//  method: 'POST',
//  headers: {
//  'Content-Type': 'application/json',
//  },
//  body: JSON.stringify({
//  email: formData.email,
//  password: formData.password,
//  }),
//  });

//  const data = await response.json();

//  if (data.requiresOtp) {
//  // Manual login requires OTP verification - switch to OTP screen
//  setIsOTPStage(true);
//  setOtpEmail(data.email || formData.email);
//  setServerMessage('');
//  setSuccessMessage(data.message || 'OTP sent to your email. Please check and enter the code.');
//  } else if (data.token) {
//  // Direct login without OTP (edge case - if backend allows it)
//  localStorage.setItem('token', data.token);
//  localStorage.setItem('user', JSON.stringify(data.user));
//  setSuccessMessage('Login successful! Redirecting...');
//  setLoginSuccess(true);
//  setTimeout(() => {
//  navigate('/dashboard');
//  }, 1500);
//  } else {
//  setServerMessage(data.message || "Failed to send OTP. Please try again.");
//  }
//  } catch (error) {
//  if (loginSuccess) return; // Prevent error messages after successful login
//  setServerMessage(error.message || "Failed to send OTP. Please try again.");
//  console.error('Login error:', error);
//  } finally {
//  setIsLoading(false);
//  }
//  };

//  // Verify OTP Handler (for manual email/password login only)
//  const handleVerifyOTP = async (e) => {
//  if (e) e.preventDefault();
 
//  if (otp.length !== 6) {
//  setSuccessMessage("");
//  setServerMessage("Please enter a 6-digit OTP.");
//  return;
//  }

//  setIsVerifying(true);
//  setServerMessage('');
//  setSuccessMessage('');
 
//  try {
//  const response = await fetch(`${import.meta.env.VITE_API_URL}/api/auth/verify-otp`, {
//  method: 'POST',
//  headers: {
//  'Content-Type': 'application/json',
//  },
//  body: JSON.stringify({
//  email: otpEmail || formData.email,
//  otp: otp,
//  }),
//  });

//  const data = await response.json();

//  if (data.success && data.token) {
//  // OTP verification successful - store credentials and redirect
//  localStorage.setItem('token', data.token);
//  localStorage.setItem('user', JSON.stringify(data.user));
//  setSuccessMessage('OTP verification successful! Logging in...');
//  setServerMessage('');
//  setLoginSuccess(true);
 
//  setTimeout(() => {
//  navigate('/dashboard');
//  }, 1500);
//  } else {
//  setServerMessage(data.message || "Invalid OTP. Please try again.");
//  setSuccessMessage('');
//  }
//  } catch (error) {
//  setServerMessage(error.message || "Invalid OTP. Please try again.");
//  setSuccessMessage('');
//  console.error('OTP verification error:', error);
//  } finally {
//  setIsVerifying(false);
//  }
//  };

//  // Handle back button from OTP screen to login screen
//  const handleBackToLogin = () => {
//  setIsOTPStage(false);
//  setOtp('');
//  setServerMessage('');
//  setSuccessMessage('');
//  setErrors({});
//  };

//  return (
//  <div className="min-h-screen flex font-sans transition-all duration-700 ease-in-out">
//  {/* Left Section (Login + OTP) */}
//  <div className="w-full lg:w-1/2 bg-white flex items-center justify-center p-8 lg:p-12">
//  {/* ------------- Login Screen (Default View) ------------- */}
//  {!isOTPStage && (
//  <div className="max-w-md w-full transition-opacity duration-700">
//  <div className="flex justify-center mb-8">
//  <div
//  className="w-16 h-16 rounded-lg flex items-center justify-center"
//  style={{ backgroundColor: "#1AA49B" }}
//  >
//  <svg
//  className="w-10 h-10 text-white"
//  viewBox="0 0 24 24"
//  fill="currentColor"
//  >
//  <path d="M3 3h8l4 4-4 4H3V3zm10 10h8v8h-8l-4-4 4-4z" />
//  </svg>
//  </div>
//  </div>

//  <h2 className="text-3xl font-bold text-gray-900 mb-2 text-center">
//  Welcome to NexIntel AI
//  </h2>
//  <p className="text-gray-500 mb-8 text-center text-sm">
//  Sign in to continue managing your legal workspace.
//  </p>

//  {/* Manual Login Form (requires OTP) */}
//  <form className="space-y-5" onSubmit={handleSendOTP}>
//  <div>
//  <label className="block text-sm font-medium text-gray-700 mb-1">
//  Email / User ID
//  </label>
//  <input
//  type="text"
//  name="email"
//  placeholder="Enter your email"
//  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] text-black"
//  value={formData.email}
//  onChange={handleChange}
//  />
//  {errors.email && (
//  <p className="mt-1 text-xs text-red-600">{errors.email}</p>
//  )}
//  </div>

//  <div>
//  <label className="block text-sm font-medium text-gray-700 mb-1">
//  Password
//  </label>
//  <div className="relative">
//  <input
//  type={showPassword ? "text" : "password"}
//  name="password"
//  placeholder="Enter your password"
//  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg pr-10 focus:ring-2 focus:ring-[#21C1B6] text-black"
//  value={formData.password}
//  onChange={handleChange}
//  />
//  <button
//  type="button"
//  onClick={() => setShowPassword(!showPassword)}
//  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
//  >
//  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
//  </button>
//  </div>
//  {errors.password && (
//  <p className="mt-1 text-xs text-red-600">{errors.password}</p>
//  )}
//  </div>

//  <button
//  type="submit"
//  disabled={isLoading}
//  className="w-full py-3 px-5 text-white font-semibold rounded-lg transition duration-300 mt-6 disabled:opacity-50 disabled:cursor-not-allowed"
//  style={{
//  background: "linear-gradient(90deg, #21C1B6 0%, #1AA49B 100%)",
//  }}
//  >
//  {isLoading ? "Sending OTP..." : "Send OTP"}
//  </button>
//  </form>

//  {/* Divider - Outside Form */}
//  <div className="mt-6">
//  <div className="relative">
//  <div className="absolute inset-0 flex items-center">
//  <div className="w-full border-t border-gray-300" />
//  </div>
//  <div className="relative flex justify-center text-sm">
//  <span className="px-2 bg-white text-gray-500">Or continue with</span>
//  </div>
//  </div>
//  </div>

//  {/* Google Sign-In Button (NO OTP required) - Outside Form */}
//  <div className="mt-6">
//  <button
//  onClick={handleGoogleSignIn}
//  disabled={isLoading}
//  type="button"
//  className="w-full flex items-center justify-center px-4 py-2.5 border border-gray-300 rounded-lg shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#21C1B6] disabled:opacity-50 disabled:cursor-not-allowed transition duration-200"
//  >
//  <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24">
//  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
//  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
//  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
//  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
//  </svg>
//  Sign in with Google
//  </button>
//  </div>

//  <div className="mt-6 space-y-4">
//  <div className="text-center">
//  <p className="text-sm text-gray-600">
//  Don't have an account?{' '}
//  <Link
//  to="/register"
//  className="font-medium text-[#1AA49B] hover:text-[#21C1B6] transition-colors duration-200"
//  >
//  Create new account
//  </Link>
//  </p>
//  </div>
 
//  <div className="text-center">
//  <button
//  onClick={() => navigate('/')}
//  type="button"
//  className="flex items-center justify-center mx-auto text-gray-600 hover:text-gray-800 transition-colors duration-200 group"
//  >
//  <ArrowLeft size={18} className="mr-2 group-hover:-translate-x-1 transition-transform duration-200" />
//  <span className="text-sm font-medium">Back to Home</span>
//  </button>
//  </div>
//  </div>

//  {serverMessage && (
//  <p className="text-sm text-center mt-4 text-red-600">
//  {serverMessage}
//  </p>
//  )}

//  {successMessage && (
//  <p className="text-sm text-center mt-4 text-green-600">
//  {successMessage}
//  </p>
//  )}
//  </div>
//  )}

//  {/* ------------- OTP Verification Screen (for manual login only) ------------- */}
//  {isOTPStage && (
//  <div className="max-w-md w-full text-center animate-fadeIn">
//  <div className="mb-6 text-left">
//  <button
//  onClick={handleBackToLogin}
//  type="button"
//  className="flex items-center text-gray-600 hover:text-gray-800 transition-colors duration-200 group"
//  >
//  <ArrowLeft size={20} className="mr-2 group-hover:-translate-x-1 transition-transform duration-200" />
//  <span className="text-sm font-medium">Back to Login</span>
//  </button>
//  </div>

//  <div className="flex justify-center mb-8">
//  <div
//  className="w-16 h-16 rounded-lg flex items-center justify-center"
//  style={{
//  background: "linear-gradient(135deg, #21C1B6 0%, #1AA49B 100%)",
//  }}
//  >
//  <CheckCircle className="w-10 h-10 text-white" />
//  </div>
//  </div>
//  <h2 className="text-2xl font-bold text-gray-900 mb-2">Enter OTP</h2>
//  <p className="text-gray-500 mb-6 text-sm">
//  We've sent a 6-digit code to <span className="font-medium text-gray-700">{otpEmail || formData.email}</span>
//  </p>

//  <form onSubmit={handleVerifyOTP} className="space-y-6">
//  <input
//  type="text"
//  maxLength="6"
//  placeholder="Enter 6-digit OTP"
//  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center tracking-widest text-lg text-black focus:ring-2 focus:ring-[#21C1B6]"
//  value={otp}
//  onChange={(e) => {
//  const value = e.target.value.replace(/\D/g, ''); // Only allow digits
//  setOtp(value);
//  setServerMessage('');
//  setSuccessMessage('');
//  }}
//  />

//  <button
//  type="submit"
//  disabled={isVerifying || otp.length !== 6}
//  className="w-full mt-6 py-3 px-5 text-white font-semibold rounded-lg transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
//  style={{
//  background: "linear-gradient(90deg, #21C1B6 0%, #1AA49B 100%)",
//  }}
//  >
//  {isVerifying ? "Verifying..." : "Verify OTP"}
//  </button>
//  </form>

//  {serverMessage && (
//  <p className="mt-4 text-sm animate-fadeIn text-red-600">
//  {serverMessage}
//  </p>
//  )}

//  {successMessage && (
//  <p className="mt-4 text-sm animate-fadeIn text-green-600">
//  {successMessage}
//  </p>
//  )}
//  </div>
//  )}
//  </div>

//  {/* Right Visual Column (Branding & Features) */}
//  <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-gray-800 via-gray-900 to-gray-950 items-center justify-center p-12 relative overflow-hidden">
//  <div className="absolute inset-0 opacity-10">
//  <div className="absolute top-20 right-20 w-64 h-64 rounded-full blur-3xl" style={{ backgroundColor: '#1AA49B' }}></div>
//  <div className="absolute bottom-20 left-20 w-64 h-64 bg-blue-500 rounded-full blur-3xl"></div>
//  </div>

//  <div className="max-w-lg text-white relative z-10">
//  <div className="mb-8 relative">
//  <div className="bg-gradient-to-br from-gray-700 to-gray-800 rounded-2xl p-8 shadow-2xl">
//  <div className="flex gap-2 mb-6">
//  <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//  <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//  <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//  </div>
 
//  <div className="flex gap-4 items-center justify-center">
//  <div className="space-y-3">
//  <div className="w-12 h-12 rounded-lg" style={{ backgroundColor: '#1AA49B' }}></div>
//  <div className="w-12 h-12 bg-gray-700 rounded-lg"></div>
//  <div className="w-12 h-12 bg-gray-700 rounded-lg"></div>
//  </div>
 
//  <div className="bg-white rounded-lg p-4 w-48">
//  <div className="space-y-2">
//  <div className="h-3 rounded w-3/4" style={{ backgroundColor: '#1AA49B' }}></div>
//  <div className="h-2 bg-gray-300 rounded"></div>
//  <div className="h-2 bg-gray-300 rounded"></div>
//  <div className="h-2 bg-gray-300 rounded w-5/6"></div>
//  </div>
//  </div>

//  <div className="space-y-4">
//  <div className="w-16 h-16 relative">
//  <div className="absolute top-0 right-0 w-8 h-12 bg-gray-600 rounded transform rotate-45"></div>
//  <div className="absolute bottom-0 left-0 w-12 h-6 rounded" style={{ backgroundColor: '#1AA49B' }}></div>
//  </div>
//  <div className="w-16 h-16 flex items-end justify-center">
//  <div className="w-12 h-12 border-4 border-gray-600 rounded-full relative">
//  <div className="absolute -top-6 left-1/2 -translate-x-1/2 w-1 h-8 bg-gray-600"></div>
//  </div>
//  </div>
//  </div>
//  </div>
//  </div>
//  </div>

//  <h2 className="text-4xl font-bold mb-8 leading-tight text-center">
//  Automate Your Legal Workflow in Minutes
//  </h2>

//  <div className="space-y-6 bg-gradient-to-br from-gray-800/50 to-gray-900/50 backdrop-blur-sm rounded-2xl p-6">
//  <div className="flex items-start gap-4">
//  <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//  <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//  <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z"/>
//  </svg>
//  </div>
//  <div>
//  <h3 className="text-lg font-semibold mb-1">Accelerate case preparation</h3>
//  <p className="text-gray-400 text-sm">in minutes with AI-powered tools</p>
//  </div>
//  </div>

//  <div className="flex items-start gap-4">
//  <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//  <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/>
//  </svg>
//  </div>
//  <div>
//  <h3 className="text-lg font-semibold mb-1">Smart Document Vault</h3>
//  <p className="text-gray-400 text-sm">Secure, searchable, and organized</p>
//  </div>
//  </div>

//  <div className="flex items-start gap-4">
//  <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//  <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//  <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/>
//  </svg>
//  </div>
//  <div>
//  <h3 className="text-lg font-semibold mb-1">Trusted Legal Insights</h3>
//  <p className="text-gray-400 text-sm">AI-driven precedents & analysis</p>
//  </div>
//  </div>
//  </div>
//  </div>
//  </div>
//  </div>
//  );
// };

// export default LoginPage;

// import React, { useState, useEffect } from "react";
// import { useNavigate, Link, useLocation } from "react-router-dom";
// import { Eye, EyeOff, CheckCircle, ArrowLeft } from "lucide-react";
// import { auth, googleProvider } from '../../config/firebase';
// import { signInWithPopup } from 'firebase/auth';
// import { useAuth } from '../../context/AuthContext'; // Import useAuth

// const LoginPage = () => {
//   const [formData, setFormData] = useState({ email: "", password: "" });
//   const [errors, setErrors] = useState({});
//   const [showPassword, setShowPassword] = useState(false);
//   const [isOTPStage, setIsOTPStage] = useState(false);
//   const [otp, setOtp] = useState("");
//   const [successMessage, setSuccessMessage] = useState("");
//   const [isVerifying, setIsVerifying] = useState(false);
//   const [isLoading, setIsLoading] = useState(false);
//   const [serverMessage, setServerMessage] = useState("");
//   const [otpEmail, setOtpEmail] = useState('');

//   const navigate = useNavigate();
//   const location = useLocation();
//   const { login, verifyOtp, isAuthenticated } = useAuth();

//   // Redirect if already authenticated
//   useEffect(() => {
//     if (isAuthenticated) {
//       const redirectTo = location.state?.from || '/dashboard';
//       console.log('LoginPage: User already authenticated, redirecting to:', redirectTo);
//       navigate(redirectTo, { replace: true });
//     }
//   }, [isAuthenticated, navigate, location.state]);

//   // Handle URL parameters (for external redirects like Google OAuth)
//   useEffect(() => {
//     const params = new URLSearchParams(location.search);
//     const token = params.get('token');
//     const user = params.get('user');

//     if (token && user) {
//       localStorage.setItem('token', token);
//       localStorage.setItem('user', user);
//       navigate('/dashboard', { replace: true });
//     }
//   }, [location, navigate]);

//   // Validation functions
//   const validateEmail = (email) => {
//     if (!email) return "Email is required.";
//     if (!/\S+@\S+\.\S+/.test(email)) return "Invalid email format.";
//     return "";
//   };
  
//   const validatePassword = (password) => {
//     if (!password) return "Password is required.";
//     if (password.length < 8) return "Password must be at least 8 characters long.";
//     if (!/(?=.*[a-z])/.test(password)) return "Password must contain at least one lowercase letter.";
//     if (!/(?=.*[A-Z])/.test(password)) return "Password must contain at least one uppercase letter.";
//     if (!/(?=.*\d)/.test(password)) return "Password must contain at least one number.";
//     if (!/(?=.*[@$!%*?&])/.test(password)) return "Password must contain at least one special character (@$!%*?&).";
//     return "";
//   };

//   const handleChange = (e) => {
//     const { name, value } = e.target;
//     setFormData({ ...formData, [name]: value });
    
//     // Clear previous messages when user starts typing
//     setServerMessage("");
//     setSuccessMessage("");
    
//     if (name === 'email') {
//       setErrors((prev) => ({ ...prev, email: validateEmail(value) }));
//     } else if (name === 'password') {
//       setErrors((prev) => ({ ...prev, password: validatePassword(value) }));
//     }
//   };

//   // Google Sign In Handler (Direct login - NO OTP required)
//   const handleGoogleSignIn = async () => {
//     try {
//       setIsLoading(true);
//       setServerMessage('');
//       setSuccessMessage('');
//       setIsOTPStage(false);
      
//       const result = await signInWithPopup(auth, googleProvider);
//       const user = result.user;
      
//       // Get Firebase ID token
//       const idToken = await user.getIdToken();
      
//       // Send token to backend for verification and user creation/login
//       const response = await fetch(`${import.meta.env.VITE_API_URL}/api/auth/google`, {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//         },
//         body: JSON.stringify({
//           idToken: idToken,
//           email: user.email,
//           displayName: user.displayName,
//           photoURL: user.photoURL,
//         }),
//       });

//       const data = await response.json();

//       if (response.ok && data.token) {
//         // Store authentication token and user info
//         localStorage.setItem('token', data.token);
//         localStorage.setItem('user', JSON.stringify({
//           email: user.email,
//           displayName: user.displayName,
//           photoURL: user.photoURL,
//           uid: user.uid
//         }));
        
//         setSuccessMessage('Google Sign-In successful! Redirecting...');
        
//         // Direct navigation to dashboard - NO OTP required for Google Sign-In
//         setTimeout(() => {
//           const redirectTo = location.state?.from || '/dashboard';
//           navigate(redirectTo, { replace: true });
//         }, 1500);
//       } else {
//         setServerMessage(data.message || 'Google Sign-In failed. Please try again.');
//       }
//     } catch (error) {
//       console.error('Google Sign-In Error:', error);
      
//       // Handle specific Firebase Auth errors gracefully
//       if (error.code === 'auth/popup-closed-by-user') {
//         setServerMessage('Sign-in cancelled. Please try again.');
//       } else if (error.code === 'auth/popup-blocked') {
//         setServerMessage('Pop-up blocked. Please allow pop-ups and try again.');
//       } else if (error.code === 'auth/cancelled-popup-request') {
//         // User cancelled - no error message needed
//         return;
//       } else {
//         setServerMessage(error.message || 'Failed to sign in with Google. Please try again.');
//       }
//     } finally {
//       setIsLoading(false);
//     }
//   };

//   // Manual Login - Handle login through AuthContext
//   const handleLogin = async (e) => {
//     e.preventDefault();
    
//     // Validate all form fields before proceeding
//     const emailError = validateEmail(formData.email);
//     const passwordError = validatePassword(formData.password);
//     setErrors({ email: emailError, password: passwordError });
    
//     if (emailError || passwordError) return;

//     setIsLoading(true);
//     setServerMessage('');
//     setSuccessMessage('');

//     try {
//       const result = await login(formData.email, formData.password);

//       if (result.requiresOtp) {
//         // Switch to OTP verification stage
//         setIsOTPStage(true);
//         setOtpEmail(result.email || formData.email);
//         setServerMessage('');
//         setSuccessMessage(result.message || 'OTP sent to your email. Please check and enter the code.');
//       } else if (result.success) {
//         // Direct login successful
//         setSuccessMessage('Login successful! Redirecting...');
//         setTimeout(() => {
//           const redirectTo = location.state?.from || '/dashboard';
//           navigate(redirectTo, { replace: true });
//         }, 1500);
//       } else {
//         setServerMessage(result.message || "Login failed. Please try again.");
//       }
//     } catch (error) {
//       setServerMessage(error.message || "Login failed. Please try again.");
//       console.error('Login error:', error);
//     } finally {
//       setIsLoading(false);
//     }
//   };

//   // Verify OTP Handler (for manual email/password login only)
//   const handleVerifyOTP = async (e) => {
//     if (e) e.preventDefault();
    
//     if (otp.length !== 6) {
//       setSuccessMessage("");
//       setServerMessage("Please enter a 6-digit OTP.");
//       return;
//     }

//     setIsVerifying(true);
//     setServerMessage('');
//     setSuccessMessage('');
    
//     try {
//       const result = await verifyOtp(otpEmail || formData.email, otp);

//       if (result.success) {
//         // OTP verification successful
//         setSuccessMessage('OTP verification successful! Logging in...');
//         setServerMessage('');
        
//         setTimeout(() => {
//           const redirectTo = location.state?.from || '/dashboard';
//           navigate(redirectTo, { replace: true });
//         }, 1500);
//       } else {
//         setServerMessage(result.message || "Invalid OTP. Please try again.");
//         setSuccessMessage('');
//       }
//     } catch (error) {
//       setServerMessage(error.message || "Invalid OTP. Please try again.");
//       setSuccessMessage('');
//       console.error('OTP verification error:', error);
//     } finally {
//       setIsVerifying(false);
//     }
//   };

//   // Handle back button from OTP screen to login screen
//   const handleBackToLogin = () => {
//     setIsOTPStage(false);
//     setOtp('');
//     setServerMessage('');
//     setSuccessMessage('');
//     setErrors({});
//   };

//   return (
//     <div className="min-h-screen flex font-sans transition-all duration-700 ease-in-out">
//       {/* Left Section (Login + OTP) */}
//       <div className="w-full lg:w-1/2 bg-white flex items-center justify-center p-8 lg:p-12">
//         {/* ------------- Login Screen (Default View) ------------- */}
//         {!isOTPStage && (
//           <div className="max-w-md w-full transition-opacity duration-700">
//             <div className="flex justify-center mb-8">
//               <div
//                 className="w-16 h-16 rounded-lg flex items-center justify-center"
//                 style={{ backgroundColor: "#1AA49B" }}
//               >
//                 <svg
//                   className="w-10 h-10 text-white"
//                   viewBox="0 0 24 24"
//                   fill="currentColor"
//                 >
//                   <path d="M3 3h8l4 4-4 4H3V3zm10 10h8v8h-8l-4-4 4-4z" />
//                 </svg>
//               </div>
//             </div>

//             <h2 className="text-3xl font-bold text-gray-900 mb-2 text-center">
//               Welcome to NexIntel AI
//             </h2>
//             <p className="text-gray-500 mb-8 text-center text-sm">
//               Sign in to continue managing your legal workspace.
//             </p>

//             {/* Manual Login Form */}
//             <form className="space-y-5" onSubmit={handleLogin}>
//               <div>
//                 <label className="block text-sm font-medium text-gray-700 mb-1">
//                   Email / User ID
//                 </label>
//                 <input
//                   type="text"
//                   name="email"
//                   placeholder="Enter your email"
//                   className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] text-black"
//                   value={formData.email}
//                   onChange={handleChange}
//                 />
//                 {errors.email && (
//                   <p className="mt-1 text-xs text-red-600">{errors.email}</p>
//                 )}
//               </div>

//               <div>
//                 <label className="block text-sm font-medium text-gray-700 mb-1">
//                   Password
//                 </label>
//                 <div className="relative">
//                   <input
//                     type={showPassword ? "text" : "password"}
//                     name="password"
//                     placeholder="Enter your password"
//                     className="w-full px-4 py-2.5 border border-gray-300 rounded-lg pr-10 focus:ring-2 focus:ring-[#21C1B6] text-black"
//                     value={formData.password}
//                     onChange={handleChange}
//                   />
//                   <button
//                     type="button"
//                     onClick={() => setShowPassword(!showPassword)}
//                     className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
//                   >
//                     {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
//                   </button>
//                 </div>
//                 {errors.password && (
//                   <p className="mt-1 text-xs text-red-600">{errors.password}</p>
//                 )}
//               </div>

//               <button
//                 type="submit"
//                 disabled={isLoading}
//                 className="w-full py-3 px-5 text-white font-semibold rounded-lg transition duration-300 mt-6 disabled:opacity-50 disabled:cursor-not-allowed"
//                 style={{
//                   background: "linear-gradient(90deg, #21C1B6 0%, #1AA49B 100%)",
//                 }}
//               >
//                 {isLoading ? "Signing In..." : "Sign In"}
//               </button>
//             </form>

//             {/* Divider - Outside Form */}
//             <div className="mt-6">
//               <div className="relative">
//                 <div className="absolute inset-0 flex items-center">
//                   <div className="w-full border-t border-gray-300" />
//                 </div>
//                 <div className="relative flex justify-center text-sm">
//                   <span className="px-2 bg-white text-gray-500">Or continue with</span>
//                 </div>
//               </div>
//             </div>

//             {/* Google Sign-In Button (NO OTP required) - Outside Form */}
//             <div className="mt-6">
//               <button
//                 onClick={handleGoogleSignIn}
//                 disabled={isLoading}
//                 type="button"
//                 className="w-full flex items-center justify-center px-4 py-2.5 border border-gray-300 rounded-lg shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#21C1B6] disabled:opacity-50 disabled:cursor-not-allowed transition duration-200"
//               >
//                 <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24">
//                   <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
//                   <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
//                   <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
//                   <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
//                 </svg>
//                 Sign in with Google
//               </button>
//             </div>

//             <div className="mt-6 space-y-4">
//               <div className="text-center">
//                 <p className="text-sm text-gray-600">
//                   Don't have an account?{' '}
//                   <Link
//                     to="/register"
//                     className="font-medium text-[#1AA49B] hover:text-[#21C1B6] transition-colors duration-200"
//                   >
//                     Create new account
//                   </Link>
//                 </p>
//               </div>
              
//               <div className="text-center">
//                 <button
//                   onClick={() => navigate('/')}
//                   type="button"
//                   className="flex items-center justify-center mx-auto text-gray-600 hover:text-gray-800 transition-colors duration-200 group"
//                 >
//                   <ArrowLeft size={18} className="mr-2 group-hover:-translate-x-1 transition-transform duration-200" />
//                   <span className="text-sm font-medium">Back to Home</span>
//                 </button>
//               </div>
//             </div>

//             {serverMessage && (
//               <p className="text-sm text-center mt-4 text-red-600">
//                 {serverMessage}
//               </p>
//             )}

//             {successMessage && (
//               <p className="text-sm text-center mt-4 text-green-600">
//                 {successMessage}
//               </p>
//             )}
//           </div>
//         )}

//         {/* ------------- OTP Verification Screen (for manual login only) ------------- */}
//         {isOTPStage && (
//           <div className="max-w-md w-full text-center animate-fadeIn">
//             <div className="mb-6 text-left">
//               <button
//                 onClick={handleBackToLogin}
//                 type="button"
//                 className="flex items-center text-gray-600 hover:text-gray-800 transition-colors duration-200 group"
//               >
//                 <ArrowLeft size={20} className="mr-2 group-hover:-translate-x-1 transition-transform duration-200" />
//                 <span className="text-sm font-medium">Back to Login</span>
//               </button>
//             </div>

//             <div className="flex justify-center mb-8">
//               <div
//                 className="w-16 h-16 rounded-lg flex items-center justify-center"
//                 style={{
//                   background: "linear-gradient(135deg, #21C1B6 0%, #1AA49B 100%)",
//                 }}
//               >
//                 <CheckCircle className="w-10 h-10 text-white" />
//               </div>
//             </div>
//             <h2 className="text-2xl font-bold text-gray-900 mb-2">Enter OTP</h2>
//             <p className="text-gray-500 mb-6 text-sm">
//               We've sent a 6-digit code to <span className="font-medium text-gray-700">{otpEmail || formData.email}</span>
//             </p>

//             <form onSubmit={handleVerifyOTP} className="space-y-6">
//               <input
//                 type="text"
//                 maxLength="6"
//                 placeholder="Enter 6-digit OTP"
//                 className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center tracking-widest text-lg text-black focus:ring-2 focus:ring-[#21C1B6]"
//                 value={otp}
//                 onChange={(e) => {
//                   const value = e.target.value.replace(/\D/g, ''); // Only allow digits
//                   setOtp(value);
//                   setServerMessage('');
//                   setSuccessMessage('');
//                 }}
//               />

//               <button
//                 type="submit"
//                 disabled={isVerifying || otp.length !== 6}
//                 className="w-full mt-6 py-3 px-5 text-white font-semibold rounded-lg transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
//                 style={{
//                   background: "linear-gradient(90deg, #21C1B6 0%, #1AA49B 100%)",
//                 }}
//               >
//                 {isVerifying ? "Verifying..." : "Verify OTP"}
//               </button>
//             </form>

//             {serverMessage && (
//               <p className="mt-4 text-sm animate-fadeIn text-red-600">
//                 {serverMessage}
//               </p>
//             )}

//             {successMessage && (
//               <p className="mt-4 text-sm animate-fadeIn text-green-600">
//                 {successMessage}
//               </p>
//             )}
//           </div>
//         )}
//       </div>

//       {/* Right Visual Column (Branding & Features) */}
//       <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-gray-800 via-gray-900 to-gray-950 items-center justify-center p-12 relative overflow-hidden">
//         <div className="absolute inset-0 opacity-10">
//           <div className="absolute top-20 right-20 w-64 h-64 rounded-full blur-3xl" style={{ backgroundColor: '#1AA49B' }}></div>
//           <div className="absolute bottom-20 left-20 w-64 h-64 bg-blue-500 rounded-full blur-3xl"></div>
//         </div>

//         <div className="max-w-lg text-white relative z-10">
//           <div className="mb-8 relative">
//             <div className="bg-gradient-to-br from-gray-700 to-gray-800 rounded-2xl p-8 shadow-2xl">
//               <div className="flex gap-2 mb-6">
//                 <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//                 <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//                 <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//               </div>
              
//               <div className="flex gap-4 items-center justify-center">
//                 <div className="space-y-3">
//                   <div className="w-12 h-12 rounded-lg" style={{ backgroundColor: '#1AA49B' }}></div>
//                   <div className="w-12 h-12 bg-gray-700 rounded-lg"></div>
//                   <div className="w-12 h-12 bg-gray-700 rounded-lg"></div>
//                 </div>
                
//                 <div className="bg-white rounded-lg p-4 w-48">
//                   <div className="space-y-2">
//                     <div className="h-3 rounded w-3/4" style={{ backgroundColor: '#1AA49B' }}></div>
//                     <div className="h-2 bg-gray-300 rounded"></div>
//                     <div className="h-2 bg-gray-300 rounded"></div>
//                     <div className="h-2 bg-gray-300 rounded w-5/6"></div>
//                   </div>
//                 </div>

//                 <div className="space-y-4">
//                   <div className="w-16 h-16 relative">
//                     <div className="absolute top-0 right-0 w-8 h-12 bg-gray-600 rounded transform rotate-45"></div>
//                     <div className="absolute bottom-0 left-0 w-12 h-6 rounded" style={{ backgroundColor: '#1AA49B' }}></div>
//                   </div>
//                   <div className="w-16 h-16 flex items-end justify-center">
//                     <div className="w-12 h-12 border-4 border-gray-600 rounded-full relative">
//                       <div className="absolute -top-6 left-1/2 -translate-x-1/2 w-1 h-8 bg-gray-600"></div>
//                     </div>
//                   </div>
//                 </div>
//               </div>
//             </div>
//           </div>

//           <h2 className="text-4xl font-bold mb-8 leading-tight text-center">
//             Automate Your Legal Workflow in Minutes
//           </h2>

//           <div className="space-y-6 bg-gradient-to-br from-gray-800/50 to-gray-900/50 backdrop-blur-sm rounded-2xl p-6">
//             <div className="flex items-start gap-4">
//               <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                 <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                   <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z"/>
//                 </svg>
//               </div>
//               <div>
//                 <h3 className="text-lg font-semibold mb-1">Accelerate case preparation</h3>
//                 <p className="text-gray-400 text-sm">in minutes with AI-powered tools</p>
//               </div>
//             </div>

//             <div className="flex items-start gap-4">
//               <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                 <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                   <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/>
//                 </svg>
//               </div>
//               <div>
//                 <h3 className="text-lg font-semibold mb-1">Smart Document Vault</h3>
//                 <p className="text-gray-400 text-sm">Secure, searchable, and organized</p>
//               </div>
//             </div>

//             <div className="flex items-start gap-4">
//               <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                 <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                   <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/>
//                 </svg>
//               </div>
//               <div>
//                 <h3 className="text-lg font-semibold mb-1">Trusted Legal Insights</h3>
//                 <p className="text-gray-400 text-sm">AI-driven precedents & analysis</p>
//               </div>
//             </div>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default LoginPage;



// import React, { useState, useEffect } from "react";
// import { useNavigate, Link, useLocation } from "react-router-dom";
// import { Eye, EyeOff, CheckCircle, ArrowLeft } from "lucide-react";
// import { auth, googleProvider } from '../../config/firebase';
// import { signInWithPopup } from 'firebase/auth';
// import { useAuth } from '../../context/AuthContext';

// const LoginPage = () => {
//   const [formData, setFormData] = useState({ email: "", password: "" });
//   const [errors, setErrors] = useState({});
//   const [showPassword, setShowPassword] = useState(false);
//   const [isOTPStage, setIsOTPStage] = useState(false);
//   const [otp, setOtp] = useState("");
//   const [successMessage, setSuccessMessage] = useState("");
//   const [isVerifying, setIsVerifying] = useState(false);
//   const [isLoading, setIsLoading] = useState(false);
//   const [serverMessage, setServerMessage] = useState("");
//   const [otpEmail, setOtpEmail] = useState('');

//   const [isGoogleSignInProgress, setIsGoogleSignInProgress] = useState(false);

//   const navigate = useNavigate();
//   const location = useLocation();
//   const { login, verifyOtp, isAuthenticated, setAuthState } = useAuth();

//   // Redirect if already authenticated (but not during loading)
//   useEffect(() => {
//     // Only redirect if we're authenticated and NOT currently in a loading state
//     if (isAuthenticated && !isLoading) {
//       const redirectTo = location.state?.from || '/dashboard';
//       console.log('LoginPage: User already authenticated, redirecting to:', redirectTo);
//       navigate(redirectTo, { replace: true });
//     }
//   }, [isAuthenticated, navigate, location.state, isLoading]);

//   // Remove the URL parameters effect - no longer needed
//   // The AuthContext will handle the authentication state

//   // Validation functions
//   const validateEmail = (email) => {
//     if (!email) return "Email is required.";
//     if (!/\S+@\S+\.\S+/.test(email)) return "Invalid email format.";
//     return "";
//   };
  
//   const validatePassword = (password) => {
//     if (!password) return "Password is required.";
//     if (password.length < 8) return "Password must be at least 8 characters long.";
//     if (!/(?=.*[a-z])/.test(password)) return "Password must contain at least one lowercase letter.";
//     if (!/(?=.*[A-Z])/.test(password)) return "Password must contain at least one uppercase letter.";
//     if (!/(?=.*\d)/.test(password)) return "Password must contain at least one number.";
//     if (!/(?=.*[@$!%*?&])/.test(password)) return "Password must contain at least one special character (@$!%*?&).";
//     return "";
//   };

//   const handleChange = (e) => {
//     const { name, value } = e.target;
//     setFormData({ ...formData, [name]: value });
    
//     setServerMessage("");
//     setSuccessMessage("");
    
//     if (name === 'email') {
//       setErrors((prev) => ({ ...prev, email: validateEmail(value) }));
//     } else if (name === 'password') {
//       setErrors((prev) => ({ ...prev, password: validatePassword(value) }));
//     }
//   };

//   // Google Sign In Handler - NO PAGE REFRESH VERSION
//   const handleGoogleSignIn = async () => {
//     try {
//       setIsLoading(true);
//       setServerMessage('');
//       setSuccessMessage('');
//       setIsOTPStage(false);
      
//       const result = await signInWithPopup(auth, googleProvider);
//       const user = result.user;
      
//       // Get Firebase ID token
//       const idToken = await user.getIdToken();
      
//       // Send token to backend for verification and user creation/login
//       const response = await fetch(`${import.meta.env.VITE_API_URL}/api/auth/google`, {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//         },
//         body: JSON.stringify({
//           idToken: idToken,
//           email: user.email,
//           displayName: user.displayName,
//           photoURL: user.photoURL,
//         }),
//       });

//       const data = await response.json();

//       if (response.ok && data.token) {
//         const userData = {
//           email: user.email,
//           displayName: user.displayName,
//           photoURL: user.photoURL,
//           uid: user.uid
//         };

//         setSuccessMessage('Google Sign-In successful! Redirecting...');
        
//         // CRITICAL: Update AuthContext state directly
//         setAuthState(data.token, userData);
        
//         // Wait a moment for state to update, then navigate
//         setTimeout(() => {
//           setIsLoading(false); // End loading state
//           const redirectTo = location.state?.from || '/dashboard';
//           navigate(redirectTo, { replace: true });
//         }, 500);
//       } else {
//         setServerMessage(data.message || 'Google Sign-In failed. Please try again.');
//         setIsLoading(false);
//       }
//     } catch (error) {
//       console.error('Google Sign-In Error:', error);
      
//       if (error.code === 'auth/popup-closed-by-user') {
//         setServerMessage('Sign-in cancelled. Please try again.');
//       } else if (error.code === 'auth/popup-blocked') {
//         setServerMessage('Pop-up blocked. Please allow pop-ups and try again.');
//       } else if (error.code === 'auth/cancelled-popup-request') {
//         return;
//       } else {
//         setServerMessage(error.message || 'Failed to sign in with Google. Please try again.');
//       }
//       setIsLoading(false);
//     }
//   };

//   // Manual Login
//   const handleLogin = async (e) => {
//     e.preventDefault();
    
//     const emailError = validateEmail(formData.email);
//     const passwordError = validatePassword(formData.password);
//     setErrors({ email: emailError, password: passwordError });
    
//     if (emailError || passwordError) return;

//     setIsLoading(true);
//     setServerMessage('');
//     setSuccessMessage('');

//     try {
//       const result = await login(formData.email, formData.password);

//       if (result.requiresOtp) {
//         setIsOTPStage(true);
//         setOtpEmail(result.email || formData.email);
//         setServerMessage('');
//         setSuccessMessage(result.message || 'OTP sent to your email. Please check and enter the code.');
//       } else if (result.success) {
//         setSuccessMessage('Login successful! Redirecting...');
//         setTimeout(() => {
//           const redirectTo = location.state?.from || '/dashboard';
//           navigate(redirectTo, { replace: true });
//         }, 1500);
//       } else {
//         setServerMessage(result.message || "Login failed. Please try again.");
//       }
//     } catch (error) {
//       setServerMessage(error.message || "Login failed. Please try again.");
//       console.error('Login error:', error);
//     } finally {
//       setIsLoading(false);
//     }
//   };

//   // Verify OTP Handler
//   const handleVerifyOTP = async (e) => {
//     if (e) e.preventDefault();
    
//     if (otp.length !== 6) {
//       setSuccessMessage("");
//       setServerMessage("Please enter a 6-digit OTP.");
//       return;
//     }

//     setIsVerifying(true);
//     setServerMessage('');
//     setSuccessMessage('');
    
//     try {
//       const result = await verifyOtp(otpEmail || formData.email, otp);

//       if (result.success) {
//         setSuccessMessage('OTP verification successful! Logging in...');
//         setServerMessage('');
        
//         setTimeout(() => {
//           const redirectTo = location.state?.from || '/dashboard';
//           navigate(redirectTo, { replace: true });
//         }, 1500);
//       } else {
//         setServerMessage(result.message || "Invalid OTP. Please try again.");
//         setSuccessMessage('');
//       }
//     } catch (error) {
//       setServerMessage(error.message || "Invalid OTP. Please try again.");
//       setSuccessMessage('');
//       console.error('OTP verification error:', error);
//     } finally {
//       setIsVerifying(false);
//     }
//   };

//   const handleBackToLogin = () => {
//     setIsOTPStage(false);
//     setOtp('');
//     setServerMessage('');
//     setSuccessMessage('');
//     setErrors({});
//   };

//   return (
//     <div className="min-h-screen flex font-sans transition-all duration-700 ease-in-out">
//       {/* Left Section */}
//       <div className="w-full lg:w-1/2 bg-white flex items-center justify-center p-8 lg:p-12">
//         {!isOTPStage && (
//           <div className="max-w-md w-full transition-opacity duration-700">
//             <div className="flex justify-center mb-8">
//               <div
//                 className="w-16 h-16 rounded-lg flex items-center justify-center"
//                 style={{ backgroundColor: "#1AA49B" }}
//               >
//                 <svg
//                   className="w-10 h-10 text-white"
//                   viewBox="0 0 24 24"
//                   fill="currentColor"
//                 >
//                   <path d="M3 3h8l4 4-4 4H3V3zm10 10h8v8h-8l-4-4 4-4z" />
//                 </svg>
//               </div>
//             </div>

//             <h2 className="text-3xl font-bold text-gray-900 mb-2 text-center">
//               Welcome to JuriNex
//             </h2>
//             <p className="text-gray-500 mb-8 text-center text-sm">
//               Sign in to continue managing your legal workspace.
//             </p>

//             <form className="space-y-5" onSubmit={handleLogin}>
//               <div>
//                 <label className="block text-sm font-medium text-gray-700 mb-1">
//                   Email / User ID
//                 </label>
//                 <input
//                   type="text"
//                   name="email"
//                   placeholder="Enter your email"
//                   className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] text-black"
//                   value={formData.email}
//                   onChange={handleChange}
//                 />
//                 {errors.email && (
//                   <p className="mt-1 text-xs text-red-600">{errors.email}</p>
//                 )}
//               </div>

//               <div>
//                 <label className="block text-sm font-medium text-gray-700 mb-1">
//                   Password
//                 </label>
//                 <div className="relative">
//                   <input
//                     type={showPassword ? "text" : "password"}
//                     name="password"
//                     placeholder="Enter your password"
//                     className="w-full px-4 py-2.5 border border-gray-300 rounded-lg pr-10 focus:ring-2 focus:ring-[#21C1B6] text-black"
//                     value={formData.password}
//                     onChange={handleChange}
//                   />
//                   <button
//                     type="button"
//                     onClick={() => setShowPassword(!showPassword)}
//                     className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
//                   >
//                     {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
//                   </button>
//                 </div>
//                 {errors.password && (
//                   <p className="mt-1 text-xs text-red-600">{errors.password}</p>
//                 )}
//               </div>

//               <button
//                 type="submit"
//                 disabled={isLoading}
//                 className="w-full py-3 px-5 text-white font-semibold rounded-lg transition duration-300 mt-6 disabled:opacity-50 disabled:cursor-not-allowed"
//                 style={{
//                   background: "linear-gradient(90deg, #21C1B6 0%, #1AA49B 100%)",
//                 }}
//               >
//                 {isLoading ? "Signing In..." : "Sign In"}
//               </button>
//             </form>

//             <div className="mt-6">
//               <div className="relative">
//                 <div className="absolute inset-0 flex items-center">
//                   <div className="w-full border-t border-gray-300" />
//                 </div>
//                 <div className="relative flex justify-center text-sm">
//                   <span className="px-2 bg-white text-gray-500">Or continue with</span>
//                 </div>
//               </div>
//             </div>

//             <div className="mt-6">
//               <button
//                 onClick={handleGoogleSignIn}
//                 disabled={isLoading}
//                 type="button"
//                 className="w-full flex items-center justify-center px-4 py-2.5 border border-gray-300 rounded-lg shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#21C1B6] disabled:opacity-50 disabled:cursor-not-allowed transition duration-200"
//               >
//                 <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24">
//                   <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
//                   <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
//                   <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
//                   <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
//                 </svg>
//                 Sign in with Google
//               </button>
//             </div>

//             <div className="mt-6 space-y-4">
//               <div className="text-center">
//                 <p className="text-sm text-gray-600">
//                   Don't have an account?{' '}
//                   <Link
//                     to="/register"
//                     className="font-medium text-[#1AA49B] hover:text-[#21C1B6] transition-colors duration-200"
//                   >
//                     Create new account
//                   </Link>
//                 </p>
//               </div>
              
//               <div className="text-center">
//                 <button
//                   onClick={() => navigate('/')}
//                   type="button"
//                   className="flex items-center justify-center mx-auto text-gray-600 hover:text-gray-800 transition-colors duration-200 group"
//                 >
//                   <ArrowLeft size={18} className="mr-2 group-hover:-translate-x-1 transition-transform duration-200" />
//                   <span className="text-sm font-medium">Back to Home</span>
//                 </button>
//               </div>
//             </div>

//             {serverMessage && (
//               <p className="text-sm text-center mt-4 text-red-600">
//                 {serverMessage}
//               </p>
//             )}

//             {successMessage && (
//               <p className="text-sm text-center mt-4 text-green-600">
//                 {successMessage}
//               </p>
//             )}
//           </div>
//         )}

//         {/* OTP Screen */}
//         {isOTPStage && (
//           <div className="max-w-md w-full text-center animate-fadeIn">
//             <div className="mb-6 text-left">
//               <button
//                 onClick={handleBackToLogin}
//                 type="button"
//                 className="flex items-center text-gray-600 hover:text-gray-800 transition-colors duration-200 group"
//               >
//                 <ArrowLeft size={20} className="mr-2 group-hover:-translate-x-1 transition-transform duration-200" />
//                 <span className="text-sm font-medium">Back to Login</span>
//               </button>
//             </div>

//             <div className="flex justify-center mb-8">
//               <div
//                 className="w-16 h-16 rounded-lg flex items-center justify-center"
//                 style={{
//                   background: "linear-gradient(135deg, #21C1B6 0%, #1AA49B 100%)",
//                 }}
//               >
//                 <CheckCircle className="w-10 h-10 text-white" />
//               </div>
//             </div>
//             <h2 className="text-2xl font-bold text-gray-900 mb-2">Enter OTP</h2>
//             <p className="text-gray-500 mb-6 text-sm">
//               We've sent a 6-digit code to <span className="font-medium text-gray-700">{otpEmail || formData.email}</span>
//             </p>

//             <form onSubmit={handleVerifyOTP} className="space-y-6">
//               <input
//                 type="text"
//                 maxLength="6"
//                 placeholder="Enter 6-digit OTP"
//                 className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center tracking-widest text-lg text-black focus:ring-2 focus:ring-[#21C1B6]"
//                 value={otp}
//                 onChange={(e) => {
//                   const value = e.target.value.replace(/\D/g, '');
//                   setOtp(value);
//                   setServerMessage('');
//                   setSuccessMessage('');
//                 }}
//               />

//               <button
//                 type="submit"
//                 disabled={isVerifying || otp.length !== 6}
//                 className="w-full mt-6 py-3 px-5 text-white font-semibold rounded-lg transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
//                 style={{
//                   background: "linear-gradient(90deg, #21C1B6 0%, #1AA49B 100%)",
//                 }}
//               >
//                 {isVerifying ? "Verifying..." : "Verify OTP"}
//               </button>
//             </form>

//             {serverMessage && (
//               <p className="mt-4 text-sm animate-fadeIn text-red-600">
//                 {serverMessage}
//               </p>
//             )}

//             {successMessage && (
//               <p className="mt-4 text-sm animate-fadeIn text-green-600">
//                 {successMessage}
//               </p>
//             )}
//           </div>
//         )}
//       </div>

//       {/* Right Visual Column */}
//       <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-gray-800 via-gray-900 to-gray-950 items-center justify-center p-12 relative overflow-hidden">
//         <div className="absolute inset-0 opacity-10">
//           <div className="absolute top-20 right-20 w-64 h-64 rounded-full blur-3xl" style={{ backgroundColor: '#1AA49B' }}></div>
//           <div className="absolute bottom-20 left-20 w-64 h-64 bg-blue-500 rounded-full blur-3xl"></div>
//         </div>

//         <div className="max-w-lg text-white relative z-10">
//           <div className="mb-8 relative">
//             <div className="bg-gradient-to-br from-gray-700 to-gray-800 rounded-2xl p-8 shadow-2xl">
//               <div className="flex gap-2 mb-6">
//                 <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//                 <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//                 <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//               </div>
              
//               <div className="flex gap-4 items-center justify-center">
//                 <div className="space-y-3">
//                   <div className="w-12 h-12 rounded-lg" style={{ backgroundColor: '#1AA49B' }}></div>
//                   <div className="w-12 h-12 bg-gray-700 rounded-lg"></div>
//                   <div className="w-12 h-12 bg-gray-700 rounded-lg"></div>
//                 </div>
                
//                 <div className="bg-white rounded-lg p-4 w-48">
//                   <div className="space-y-2">
//                     <div className="h-3 rounded w-3/4" style={{ backgroundColor: '#1AA49B' }}></div>
//                     <div className="h-2 bg-gray-300 rounded"></div>
//                     <div className="h-2 bg-gray-300 rounded"></div>
//                     <div className="h-2 bg-gray-300 rounded w-5/6"></div>
//                   </div>
//                 </div>

//                 <div className="space-y-4">
//                   <div className="w-16 h-16 relative">
//                     <div className="absolute top-0 right-0 w-8 h-12 bg-gray-600 rounded transform rotate-45"></div>
//                     <div className="absolute bottom-0 left-0 w-12 h-6 rounded" style={{ backgroundColor: '#1AA49B' }}></div>
//                   </div>
//                   <div className="w-16 h-16 flex items-end justify-center">
//                     <div className="w-12 h-12 border-4 border-gray-600 rounded-full relative">
//                       <div className="absolute -top-6 left-1/2 -translate-x-1/2 w-1 h-8 bg-gray-600"></div>
//                     </div>
//                   </div>
//                 </div>
//               </div>
//             </div>
//           </div>

//           <h2 className="text-4xl font-bold mb-8 leading-tight text-center">
//             Automate Your Legal Workflow in Minutes
//           </h2>

//           <div className="space-y-6 bg-gradient-to-br from-gray-800/50 to-gray-900/50 backdrop-blur-sm rounded-2xl p-6">
//             <div className="flex items-start gap-4">
//               <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                 <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                   <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z"/>
//                 </svg>
//               </div>
//               <div>
//                 <h3 className="text-lg font-semibold mb-1">Accelerate case preparation</h3>
//                 <p className="text-gray-400 text-sm">in minutes with AI-powered tools</p>
//               </div>
//             </div>

//             <div className="flex items-start gap-4">
//               <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                 <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                   <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/>
//                 </svg>
//               </div>
//               <div>
//                 <h3 className="text-lg font-semibold mb-1">Smart Document Vault</h3>
//                 <p className="text-gray-400 text-sm">Secure, searchable, and organized</p>
//               </div>
//             </div>

//             <div className="flex items-start gap-4">
//               <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                 <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                   <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/>
//                 </svg>
//               </div>
//               <div>
//                 <h3 className="text-lg font-semibold mb-1">Trusted Legal Insights</h3>
//                 <p className="text-gray-400 text-sm">AI-driven precedents & analysis</p>
//               </div>
//             </div>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default LoginPage;



// import React, { useState, useEffect } from "react";
// import { useNavigate, Link, useLocation } from "react-router-dom";
// import { Eye, EyeOff, CheckCircle, ArrowLeft } from "lucide-react";
// import { auth, googleProvider } from '../../config/firebase';
// import { signInWithPopup } from 'firebase/auth';
// import { useAuth } from '../../context/AuthContext';

// const LoginPage = () => {
//   const [formData, setFormData] = useState({ email: "", password: "" });
//   const [errors, setErrors] = useState({});
//   const [showPassword, setShowPassword] = useState(false);
//   const [isOTPStage, setIsOTPStage] = useState(false);
//   const [otp, setOtp] = useState("");
//   const [successMessage, setSuccessMessage] = useState("");
//   const [isVerifying, setIsVerifying] = useState(false);
//   const [isLoading, setIsLoading] = useState(false);
//   const [serverMessage, setServerMessage] = useState("");
//   const [otpEmail, setOtpEmail] = useState('');

//   const [isGoogleSignInProgress, setIsGoogleSignInProgress] = useState(false);

//   const navigate = useNavigate();
//   const location = useLocation();
//   const { login, verifyOtp, isAuthenticated, setAuthState } = useAuth();

//   // Always redirect to dashboard if already authenticated
//   useEffect(() => {
//     if (isAuthenticated && !isLoading) {
//       console.log('LoginPage: User already authenticated, redirecting to dashboard');
//       navigate('/dashboard', { replace: true });
//     }
//   }, [isAuthenticated, navigate, isLoading]);

//   // Validation functions
//   const validateEmail = (email) => {
//     if (!email) return "Email is required.";
//     if (!/\S+@\S+\.\S+/.test(email)) return "Invalid email format.";
//     return "";
//   };
  
//   const validatePassword = (password) => {
//     if (!password) return "Password is required.";
//     if (password.length < 8) return "Password must be at least 8 characters long.";
//     if (!/(?=.*[a-z])/.test(password)) return "Password must contain at least one lowercase letter.";
//     if (!/(?=.*[A-Z])/.test(password)) return "Password must contain at least one uppercase letter.";
//     if (!/(?=.*\d)/.test(password)) return "Password must contain at least one number.";
//     if (!/(?=.*[@$!%*?&])/.test(password)) return "Password must contain at least one special character (@$!%*?&).";
//     return "";
//   };

//   const handleChange = (e) => {
//     const { name, value } = e.target;
//     setFormData({ ...formData, [name]: value });
    
//     setServerMessage("");
//     setSuccessMessage("");
    
//     if (name === 'email') {
//       setErrors((prev) => ({ ...prev, email: validateEmail(value) }));
//     } else if (name === 'password') {
//       setErrors((prev) => ({ ...prev, password: validatePassword(value) }));
//     }
//   };

//   // Google Sign In Handler - Always redirect to dashboard
//   const handleGoogleSignIn = async () => {
//     try {
//       setIsLoading(true);
//       setServerMessage('');
//       setSuccessMessage('');
//       setIsOTPStage(false);
      
//       const result = await signInWithPopup(auth, googleProvider);
//       const user = result.user;
      
//       // Get Firebase ID token
//       const idToken = await user.getIdToken();
      
//       // Send token to backend for verification and user creation/login
//       const response = await fetch(`${import.meta.env.VITE_API_URL}/api/auth/google`, {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//         },
//         body: JSON.stringify({
//           idToken: idToken,
//           email: user.email,
//           displayName: user.displayName,
//           photoURL: user.photoURL,
//         }),
//       });

//       const data = await response.json();

//       if (response.ok && data.token) {
//         const userData = {
//           email: user.email,
//           displayName: user.displayName,
//           photoURL: user.photoURL,
//           uid: user.uid
//         };

//         setSuccessMessage('Google Sign-In successful! Redirecting...');
        
//         // CRITICAL: Update AuthContext state directly
//         setAuthState(data.token, userData);
        
//         // Always redirect to dashboard
//         setTimeout(() => {
//           setIsLoading(false); // End loading state
//           navigate('/dashboard', { replace: true });
//         }, 500);
//       } else {
//         setServerMessage(data.message || 'Google Sign-In failed. Please try again.');
//         setIsLoading(false);
//       }
//     } catch (error) {
//       console.error('Google Sign-In Error:', error);
      
//       if (error.code === 'auth/popup-closed-by-user') {
//         setServerMessage('Sign-in cancelled. Please try again.');
//       } else if (error.code === 'auth/popup-blocked') {
//         setServerMessage('Pop-up blocked. Please allow pop-ups and try again.');
//       } else if (error.code === 'auth/cancelled-popup-request') {
//         return;
//       } else {
//         setServerMessage(error.message || 'Failed to sign in with Google. Please try again.');
//       }
//       setIsLoading(false);
//     }
//   };

//   // Manual Login - Always redirect to dashboard
//   const handleLogin = async (e) => {
//     e.preventDefault();
    
//     const emailError = validateEmail(formData.email);
//     const passwordError = validatePassword(formData.password);
//     setErrors({ email: emailError, password: passwordError });
    
//     if (emailError || passwordError) return;

//     setIsLoading(true);
//     setServerMessage('');
//     setSuccessMessage('');

//     try {
//       const result = await login(formData.email, formData.password);

//       if (result.requiresOtp) {
//         setIsOTPStage(true);
//         setOtpEmail(result.email || formData.email);
//         setServerMessage('');
//         setSuccessMessage(result.message || 'OTP sent to your email. Please check and enter the code.');
//       } else if (result.success) {
//         setSuccessMessage('Login successful! Redirecting...');
//         setTimeout(() => {
//           // Always redirect to dashboard
//           navigate('/dashboard', { replace: true });
//         }, 1500);
//       } else {
//         setServerMessage(result.message || "Login failed. Please try again.");
//       }
//     } catch (error) {
//       setServerMessage(error.message || "Login failed. Please try again.");
//       console.error('Login error:', error);
//     } finally {
//       setIsLoading(false);
//     }
//   };

//   // Verify OTP Handler - Always redirect to dashboard
//   const handleVerifyOTP = async (e) => {
//     if (e) e.preventDefault();
    
//     if (otp.length !== 6) {
//       setSuccessMessage("");
//       setServerMessage("Please enter a 6-digit OTP.");
//       return;
//     }

//     setIsVerifying(true);
//     setServerMessage('');
//     setSuccessMessage('');
    
//     try {
//       const result = await verifyOtp(otpEmail || formData.email, otp);

//       if (result.success) {
//         setSuccessMessage('OTP verification successful! Logging in...');
//         setServerMessage('');
        
//         setTimeout(() => {
//           // Always redirect to dashboard
//           navigate('/dashboard', { replace: true });
//         }, 1500);
//       } else {
//         setServerMessage(result.message || "Invalid OTP. Please try again.");
//         setSuccessMessage('');
//       }
//     } catch (error) {
//       setServerMessage(error.message || "Invalid OTP. Please try again.");
//       setSuccessMessage('');
//       console.error('OTP verification error:', error);
//     } finally {
//       setIsVerifying(false);
//     }
//   };

//   const handleBackToLogin = () => {
//     setIsOTPStage(false);
//     setOtp('');
//     setServerMessage('');
//     setSuccessMessage('');
//     setErrors({});
//   };

//   return (
//     <div className="min-h-screen flex font-sans transition-all duration-700 ease-in-out">
//       {/* Left Section */}
//       <div className="w-full lg:w-1/2 bg-white flex items-center justify-center p-8 lg:p-12">
//         {!isOTPStage && (
//           <div className="max-w-md w-full transition-opacity duration-700">
//             <div className="flex justify-center mb-8">
//               <div
//                 className="w-16 h-16 rounded-lg flex items-center justify-center"
//                 style={{ backgroundColor: "#1AA49B" }}
//               >
//                 <svg
//                   className="w-10 h-10 text-white"
//                   viewBox="0 0 24 24"
//                   fill="currentColor"
//                 >
//                   <path d="M3 3h8l4 4-4 4H3V3zm10 10h8v8h-8l-4-4 4-4z" />
//                 </svg>
//               </div>
//             </div>

//             <h2 className="text-3xl font-bold text-gray-900 mb-2 text-center">
//               Welcome to JuriNex
//             </h2>
//             <p className="text-gray-500 mb-8 text-center text-sm">
//               Sign in to continue managing your legal workspace.
//             </p>

//             <form className="space-y-5" onSubmit={handleLogin}>
//               <div>
//                 <label className="block text-sm font-medium text-gray-700 mb-1">
//                   Email / User ID
//                 </label>
//                 <input
//                   type="text"
//                   name="email"
//                   placeholder="Enter your email"
//                   className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] text-black"
//                   value={formData.email}
//                   onChange={handleChange}
//                 />
//                 {errors.email && (
//                   <p className="mt-1 text-xs text-red-600">{errors.email}</p>
//                 )}
//               </div>

//               <div>
//                 <label className="block text-sm font-medium text-gray-700 mb-1">
//                   Password
//                 </label>
//                 <div className="relative">
//                   <input
//                     type={showPassword ? "text" : "password"}
//                     name="password"
//                     placeholder="Enter your password"
//                     className="w-full px-4 py-2.5 border border-gray-300 rounded-lg pr-10 focus:ring-2 focus:ring-[#21C1B6] text-black"
//                     value={formData.password}
//                     onChange={handleChange}
//                   />
//                   <button
//                     type="button"
//                     onClick={() => setShowPassword(!showPassword)}
//                     className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
//                   >
//                     {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
//                   </button>
//                 </div>
//                 {errors.password && (
//                   <p className="mt-1 text-xs text-red-600">{errors.password}</p>
//                 )}
//               </div>

//               <button
//                 type="submit"
//                 disabled={isLoading}
//                 className="w-full py-3 px-5 text-white font-semibold rounded-lg transition duration-300 mt-6 disabled:opacity-50 disabled:cursor-not-allowed"
//                 style={{
//                   background: "linear-gradient(90deg, #21C1B6 0%, #1AA49B 100%)",
//                 }}
//               >
//                 {isLoading ? "Signing In..." : "Sign In"}
//               </button>
//             </form>

//             <div className="mt-6">
//               <div className="relative">
//                 <div className="absolute inset-0 flex items-center">
//                   <div className="w-full border-t border-gray-300" />
//                 </div>
//                 <div className="relative flex justify-center text-sm">
//                   <span className="px-2 bg-white text-gray-500">Or continue with</span>
//                 </div>
//               </div>
//             </div>

//             <div className="mt-6">
//               <button
//                 onClick={handleGoogleSignIn}
//                 disabled={isLoading}
//                 type="button"
//                 className="w-full flex items-center justify-center px-4 py-2.5 border border-gray-300 rounded-lg shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#21C1B6] disabled:opacity-50 disabled:cursor-not-allowed transition duration-200"
//               >
//                 <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24">
//                   <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
//                   <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
//                   <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
//                   <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
//                 </svg>
//                 Sign in with Google
//               </button>
//             </div>

//             <div className="mt-6 space-y-4">
//               <div className="text-center">
//                 <p className="text-sm text-gray-600">
//                   Don't have an account?{' '}
//                   <Link
//                     to="/register"
//                     className="font-medium text-[#1AA49B] hover:text-[#21C1B6] transition-colors duration-200"
//                   >
//                     Create new account
//                   </Link>
//                 </p>
//               </div>
              
//               <div className="text-center">
//                 <button
//                   onClick={() => navigate('/')}
//                   type="button"
//                   className="flex items-center justify-center mx-auto text-gray-600 hover:text-gray-800 transition-colors duration-200 group"
//                 >
//                   <ArrowLeft size={18} className="mr-2 group-hover:-translate-x-1 transition-transform duration-200" />
//                   <span className="text-sm font-medium">Back to Home</span>
//                 </button>
//               </div>
//             </div>

//             {serverMessage && (
//               <p className="text-sm text-center mt-4 text-red-600">
//                 {serverMessage}
//               </p>
//             )}

//             {successMessage && (
//               <p className="text-sm text-center mt-4 text-green-600">
//                 {successMessage}
//               </p>
//             )}
//           </div>
//         )}

//         {/* OTP Screen */}
//         {isOTPStage && (
//           <div className="max-w-md w-full text-center animate-fadeIn">
//             <div className="mb-6 text-left">
//               <button
//                 onClick={handleBackToLogin}
//                 type="button"
//                 className="flex items-center text-gray-600 hover:text-gray-800 transition-colors duration-200 group"
//               >
//                 <ArrowLeft size={20} className="mr-2 group-hover:-translate-x-1 transition-transform duration-200" />
//                 <span className="text-sm font-medium">Back to Login</span>
//               </button>
//             </div>

//             <div className="flex justify-center mb-8">
//               <div
//                 className="w-16 h-16 rounded-lg flex items-center justify-center"
//                 style={{
//                   background: "linear-gradient(135deg, #21C1B6 0%, #1AA49B 100%)",
//                 }}
//               >
//                 <CheckCircle className="w-10 h-10 text-white" />
//               </div>
//             </div>
//             <h2 className="text-2xl font-bold text-gray-900 mb-2">Enter OTP</h2>
//             <p className="text-gray-500 mb-6 text-sm">
//               We've sent a 6-digit code to <span className="font-medium text-gray-700">{otpEmail || formData.email}</span>
//             </p>

//             <form onSubmit={handleVerifyOTP} className="space-y-6">
//               <input
//                 type="text"
//                 maxLength="6"
//                 placeholder="Enter 6-digit OTP"
//                 className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center tracking-widest text-lg text-black focus:ring-2 focus:ring-[#21C1B6]"
//                 value={otp}
//                 onChange={(e) => {
//                   const value = e.target.value.replace(/\D/g, '');
//                   setOtp(value);
//                   setServerMessage('');
//                   setSuccessMessage('');
//                 }}
//               />

//               <button
//                 type="submit"
//                 disabled={isVerifying || otp.length !== 6}
//                 className="w-full mt-6 py-3 px-5 text-white font-semibold rounded-lg transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
//                 style={{
//                   background: "linear-gradient(90deg, #21C1B6 0%, #1AA49B 100%)",
//                 }}
//               >
//                 {isVerifying ? "Verifying..." : "Verify OTP"}
//               </button>
//             </form>

//             {serverMessage && (
//               <p className="mt-4 text-sm animate-fadeIn text-red-600">
//                 {serverMessage}
//               </p>
//             )}

//             {successMessage && (
//               <p className="mt-4 text-sm animate-fadeIn text-green-600">
//                 {successMessage}
//               </p>
//             )}
//           </div>
//         )}
//       </div>

//       {/* Right Visual Column */}
//       <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-gray-800 via-gray-900 to-gray-950 items-center justify-center p-12 relative overflow-hidden">
//         <div className="absolute inset-0 opacity-10">
//           <div className="absolute top-20 right-20 w-64 h-64 rounded-full blur-3xl" style={{ backgroundColor: '#1AA49B' }}></div>
//           <div className="absolute bottom-20 left-20 w-64 h-64 bg-blue-500 rounded-full blur-3xl"></div>
//         </div>

//         <div className="max-w-lg text-white relative z-10">
//           <div className="mb-8 relative">
//             <div className="bg-gradient-to-br from-gray-700 to-gray-800 rounded-2xl p-8 shadow-2xl">
//               <div className="flex gap-2 mb-6">
//                 <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//                 <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//                 <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//               </div>
              
//               <div className="flex gap-4 items-center justify-center">
//                 <div className="space-y-3">
//                   <div className="w-12 h-12 rounded-lg" style={{ backgroundColor: '#1AA49B' }}></div>
//                   <div className="w-12 h-12 bg-gray-700 rounded-lg"></div>
//                   <div className="w-12 h-12 bg-gray-700 rounded-lg"></div>
//                 </div>
                
//                 <div className="bg-white rounded-lg p-4 w-48">
//                   <div className="space-y-2">
//                     <div className="h-3 rounded w-3/4" style={{ backgroundColor: '#1AA49B' }}></div>
//                     <div className="h-2 bg-gray-300 rounded"></div>
//                     <div className="h-2 bg-gray-300 rounded"></div>
//                     <div className="h-2 bg-gray-300 rounded w-5/6"></div>
//                   </div>
//                 </div>

//                 <div className="space-y-4">
//                   <div className="w-16 h-16 relative">
//                     <div className="absolute top-0 right-0 w-8 h-12 bg-gray-600 rounded transform rotate-45"></div>
//                     <div className="absolute bottom-0 left-0 w-12 h-6 rounded" style={{ backgroundColor: '#1AA49B' }}></div>
//                   </div>
//                   <div className="w-16 h-16 flex items-end justify-center">
//                     <div className="w-12 h-12 border-4 border-gray-600 rounded-full relative">
//                       <div className="absolute -top-6 left-1/2 -translate-x-1/2 w-1 h-8 bg-gray-600"></div>
//                     </div>
//                   </div>
//                 </div>
//               </div>
//             </div>
//           </div>

//           <h2 className="text-4xl font-bold mb-8 leading-tight text-center">
//             Automate Your Legal Workflow in Minutes
//           </h2>

//           <div className="space-y-6 bg-gradient-to-br from-gray-800/50 to-gray-900/50 backdrop-blur-sm rounded-2xl p-6">
//             <div className="flex items-start gap-4">
//               <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                 <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                   <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z"/>
//                 </svg>
//               </div>
//               <div>
//                 <h3 className="text-lg font-semibold mb-1">Accelerate case preparation</h3>
//                 <p className="text-gray-400 text-sm">in minutes with AI-powered tools</p>
//               </div>
//             </div>

//             <div className="flex items-start gap-4">
//               <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                 <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                   <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/>
//                 </svg>
//               </div>
//               <div>
//                 <h3 className="text-lg font-semibold mb-1">Smart Document Vault</h3>
//                 <p className="text-gray-400 text-sm">Secure, searchable, and organized</p>
//               </div>
//             </div>

//             <div className="flex items-start gap-4">
//               <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                 <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                   <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/>
//                 </svg>
//               </div>
//               <div>
//                 <h3 className="text-lg font-semibold mb-1">Trusted Legal Insights</h3>
//                 <p className="text-gray-400 text-sm">AI-driven precedents & analysis</p>
//               </div>
//             </div>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default LoginPage;



// import React, { useState, useEffect } from "react";
// import { useNavigate, Link, useLocation } from "react-router-dom";
// import { Eye, EyeOff, CheckCircle, ArrowLeft } from "lucide-react";
// import { auth, googleProvider } from '../../config/firebase';
// import { signInWithPopup } from 'firebase/auth';
// import { useAuth } from '../../context/AuthContext';
// // Import the logo image
// import JuriNexLogo from '../../assets/JuriNex_gavel_logo.png';

// const LoginPage = () => {
//   const [formData, setFormData] = useState({ email: "", password: "" });
//   const [errors, setErrors] = useState({});
//   const [showPassword, setShowPassword] = useState(false);
//   const [isOTPStage, setIsOTPStage] = useState(false);
//   const [otp, setOtp] = useState("");
//   const [successMessage, setSuccessMessage] = useState("");
//   const [isVerifying, setIsVerifying] = useState(false);
//   const [isLoading, setIsLoading] = useState(false);
//   const [serverMessage, setServerMessage] = useState("");
//   const [otpEmail, setOtpEmail] = useState('');
//   const [logoError, setLogoError] = useState(false);

//   const [isGoogleSignInProgress, setIsGoogleSignInProgress] = useState(false);

//   const navigate = useNavigate();
//   const location = useLocation();
//   const { login, verifyOtp, isAuthenticated, setAuthState } = useAuth();

//   // Always redirect to dashboard if already authenticated
//   useEffect(() => {
//     if (isAuthenticated && !isLoading) {
//       console.log('LoginPage: User already authenticated, redirecting to dashboard');
//       navigate('/dashboard', { replace: true });
//     }
//   }, [isAuthenticated, navigate, isLoading]);

//   // Validation functions
//   const validateEmail = (email) => {
//     if (!email) return "Email is required.";
//     if (!/\S+@\S+\.\S+/.test(email)) return "Invalid email format.";
//     return "";
//   };
  
//   const validatePassword = (password) => {
//     if (!password) return "Password is required.";
//     if (password.length < 8) return "Password must be at least 8 characters long.";
//     if (!/(?=.*[a-z])/.test(password)) return "Password must contain at least one lowercase letter.";
//     if (!/(?=.*[A-Z])/.test(password)) return "Password must contain at least one uppercase letter.";
//     if (!/(?=.*\d)/.test(password)) return "Password must contain at least one number.";
//     if (!/(?=.*[@$!%*?&])/.test(password)) return "Password must contain at least one special character (@$!%*?&).";
//     return "";
//   };

//   const handleChange = (e) => {
//     const { name, value } = e.target;
//     setFormData({ ...formData, [name]: value });
    
//     setServerMessage("");
//     setSuccessMessage("");
    
//     if (name === 'email') {
//       setErrors((prev) => ({ ...prev, email: validateEmail(value) }));
//     } else if (name === 'password') {
//       setErrors((prev) => ({ ...prev, password: validatePassword(value) }));
//     }
//   };

//   // Logo component with fallback
//   const LogoComponent = ({ size = "w-16 h-16" }) => {
//     if (logoError) {
//       // Fallback SVG logo if image fails to load
//       return (
//         <div
//           className={`${size} rounded-lg flex items-center justify-center`}
//           style={{ backgroundColor: "#1AA49B" }}
//         >
//           <svg
//             className="w-10 h-10 text-white"
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

//   // Google Sign In Handler - Always redirect to dashboard
//   const handleGoogleSignIn = async () => {
//     try {
//       setIsLoading(true);
//       setServerMessage('');
//       setSuccessMessage('');
//       setIsOTPStage(false);
      
//       const result = await signInWithPopup(auth, googleProvider);
//       const user = result.user;
      
//       // Get Firebase ID token
//       const idToken = await user.getIdToken();
      
//       // Send token to backend for verification and user creation/login
//       const response = await fetch(`${import.meta.env.VITE_API_URL}/api/auth/google`, {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//         },
//         body: JSON.stringify({
//           idToken: idToken,
//           email: user.email,
//           displayName: user.displayName,
//           photoURL: user.photoURL,
//         }),
//       });

//       const data = await response.json();

//       if (response.ok && data.token) {
//         const userData = {
//           email: user.email,
//           displayName: user.displayName,
//           photoURL: user.photoURL,
//           uid: user.uid
//         };

//         setSuccessMessage('Google Sign-In successful! Redirecting...');
        
//         // CRITICAL: Update AuthContext state directly
//         setAuthState(data.token, userData);
        
//         // Always redirect to dashboard
//         setTimeout(() => {
//           setIsLoading(false); // End loading state
//           navigate('/dashboard', { replace: true });
//         }, 500);
//       } else {
//         setServerMessage(data.message || 'Google Sign-In failed. Please try again.');
//         setIsLoading(false);
//       }
//     } catch (error) {
//       console.error('Google Sign-In Error:', error);
      
//       if (error.code === 'auth/popup-closed-by-user') {
//         setServerMessage('Sign-in cancelled. Please try again.');
//       } else if (error.code === 'auth/popup-blocked') {
//         setServerMessage('Pop-up blocked. Please allow pop-ups and try again.');
//       } else if (error.code === 'auth/cancelled-popup-request') {
//         return;
//       } else {
//         setServerMessage(error.message || 'Failed to sign in with Google. Please try again.');
//       }
//       setIsLoading(false);
//     }
//   };

//   // Manual Login - Always redirect to dashboard
//   const handleLogin = async (e) => {
//     e.preventDefault();
    
//     const emailError = validateEmail(formData.email);
//     const passwordError = validatePassword(formData.password);
//     setErrors({ email: emailError, password: passwordError });
    
//     if (emailError || passwordError) return;

//     setIsLoading(true);
//     setServerMessage('');
//     setSuccessMessage('');

//     try {
//       const result = await login(formData.email, formData.password);

//       if (result.requiresOtp) {
//         setIsOTPStage(true);
//         setOtpEmail(result.email || formData.email);
//         setServerMessage('');
//         setSuccessMessage(result.message || 'OTP sent to your email. Please check and enter the code.');
//       } else if (result.success) {
//         setSuccessMessage('Login successful! Redirecting...');
//         setTimeout(() => {
//           // Always redirect to dashboard
//           navigate('/dashboard', { replace: true });
//         }, 1500);
//       } else {
//         setServerMessage(result.message || "Login failed. Please try again.");
//       }
//     } catch (error) {
//       setServerMessage(error.message || "Login failed. Please try again.");
//       console.error('Login error:', error);
//     } finally {
//       setIsLoading(false);
//     }
//   };

//   // Verify OTP Handler - Always redirect to dashboard
//   const handleVerifyOTP = async (e) => {
//     if (e) e.preventDefault();
    
//     if (otp.length !== 6) {
//       setSuccessMessage("");
//       setServerMessage("Please enter a 6-digit OTP.");
//       return;
//     }

//     setIsVerifying(true);
//     setServerMessage('');
//     setSuccessMessage('');
    
//     try {
//       const result = await verifyOtp(otpEmail || formData.email, otp);

//       if (result.success) {
//         setSuccessMessage('OTP verification successful! Logging in...');
//         setServerMessage('');
        
//         setTimeout(() => {
//           // Always redirect to dashboard
//           navigate('/dashboard', { replace: true });
//         }, 1500);
//       } else {
//         setServerMessage(result.message || "Invalid OTP. Please try again.");
//         setSuccessMessage('');
//       }
//     } catch (error) {
//       setServerMessage(error.message || "Invalid OTP. Please try again.");
//       setSuccessMessage('');
//       console.error('OTP verification error:', error);
//     } finally {
//       setIsVerifying(false);
//     }
//   };

//   const handleBackToLogin = () => {
//     setIsOTPStage(false);
//     setOtp('');
//     setServerMessage('');
//     setSuccessMessage('');
//     setErrors({});
//   };

//   return (
//     <div className="min-h-screen flex font-sans transition-all duration-700 ease-in-out">
//       {/* Left Section */}
//       <div className="w-full lg:w-1/2 bg-white flex items-center justify-center p-8 lg:p-12">
//         {!isOTPStage && (
//           <div className="max-w-md w-full transition-opacity duration-700">
//             <div className="flex justify-center mb-8">
//               <LogoComponent />
//             </div>

//             <h2 className="text-3xl font-bold text-gray-900 mb-2 text-center">
//               Welcome to JuriNex
//             </h2>
//             <p className="text-gray-500 mb-8 text-center text-sm">
//               Sign in to continue managing your legal workspace.
//             </p>

//             <form className="space-y-5" onSubmit={handleLogin}>
//               <div>
//                 <label className="block text-sm font-medium text-gray-700 mb-1">
//                   Email / User ID
//                 </label>
//                 <input
//                   type="text"
//                   name="email"
//                   placeholder="Enter your email"
//                   className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] text-black"
//                   value={formData.email}
//                   onChange={handleChange}
//                 />
//                 {errors.email && (
//                   <p className="mt-1 text-xs text-red-600">{errors.email}</p>
//                 )}
//               </div>

//               <div>
//                 <label className="block text-sm font-medium text-gray-700 mb-1">
//                   Password
//                 </label>
//                 <div className="relative">
//                   <input
//                     type={showPassword ? "text" : "password"}
//                     name="password"
//                     placeholder="Enter your password"
//                     className="w-full px-4 py-2.5 border border-gray-300 rounded-lg pr-10 focus:ring-2 focus:ring-[#21C1B6] text-black"
//                     value={formData.password}
//                     onChange={handleChange}
//                   />
//                   <button
//                     type="button"
//                     onClick={() => setShowPassword(!showPassword)}
//                     className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
//                   >
//                     {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
//                   </button>
//                 </div>
//                 {errors.password && (
//                   <p className="mt-1 text-xs text-red-600">{errors.password}</p>
//                 )}
//               </div>

//               <button
//                 type="submit"
//                 disabled={isLoading}
//                 className="w-full py-3 px-5 text-white font-semibold rounded-lg transition duration-300 mt-6 disabled:opacity-50 disabled:cursor-not-allowed"
//                 style={{
//                   background: "linear-gradient(90deg, #21C1B6 0%, #1AA49B 100%)",
//                 }}
//               >
//                 {isLoading ? "Signing In..." : "Sign In"}
//               </button>
//             </form>

//             <div className="mt-6">
//               <div className="relative">
//                 <div className="absolute inset-0 flex items-center">
//                   <div className="w-full border-t border-gray-300" />
//                 </div>
//                 <div className="relative flex justify-center text-sm">
//                   <span className="px-2 bg-white text-gray-500">Or continue with</span>
//                 </div>
//               </div>
//             </div>

//             <div className="mt-6">
//               <button
//                 onClick={handleGoogleSignIn}
//                 disabled={isLoading}
//                 type="button"
//                 className="w-full flex items-center justify-center px-4 py-2.5 border border-gray-300 rounded-lg shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#21C1B6] disabled:opacity-50 disabled:cursor-not-allowed transition duration-200"
//               >
//                 <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24">
//                   <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
//                   <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
//                   <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
//                   <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
//                 </svg>
//                 Sign in with Google
//               </button>
//             </div>

//             <div className="mt-6 space-y-4">
//               <div className="text-center">
//                 <p className="text-sm text-gray-600">
//                   Don't have an account?{' '}
//                   <Link
//                     to="/register"
//                     className="font-medium text-[#1AA49B] hover:text-[#21C1B6] transition-colors duration-200"
//                   >
//                     Create new account
//                   </Link>
//                 </p>
//               </div>
              
//               <div className="text-center">
//                 <button
//                   onClick={() => navigate('/')}
//                   type="button"
//                   className="flex items-center justify-center mx-auto text-gray-600 hover:text-gray-800 transition-colors duration-200 group"
//                 >
//                   <ArrowLeft size={18} className="mr-2 group-hover:-translate-x-1 transition-transform duration-200" />
//                   <span className="text-sm font-medium">Back to Home</span>
//                 </button>
//               </div>
//             </div>

//             {serverMessage && (
//               <p className="text-sm text-center mt-4 text-red-600">
//                 {serverMessage}
//               </p>
//             )}

//             {successMessage && (
//               <p className="text-sm text-center mt-4 text-green-600">
//                 {successMessage}
//               </p>
//             )}
//           </div>
//         )}

//         {/* OTP Screen */}
//         {isOTPStage && (
//           <div className="max-w-md w-full text-center animate-fadeIn">
//             <div className="mb-6 text-left">
//               <button
//                 onClick={handleBackToLogin}
//                 type="button"
//                 className="flex items-center text-gray-600 hover:text-gray-800 transition-colors duration-200 group"
//               >
//                 <ArrowLeft size={20} className="mr-2 group-hover:-translate-x-1 transition-transform duration-200" />
//                 <span className="text-sm font-medium">Back to Login</span>
//               </button>
//             </div>

//             <div className="flex justify-center mb-8">
//               <LogoComponent />
//             </div>
//             <h2 className="text-2xl font-bold text-gray-900 mb-2">Enter OTP</h2>
//             <p className="text-gray-500 mb-6 text-sm">
//               We've sent a 6-digit code to <span className="font-medium text-gray-700">{otpEmail || formData.email}</span>
//             </p>

//             <form onSubmit={handleVerifyOTP} className="space-y-6">
//               <input
//                 type="text"
//                 maxLength="6"
//                 placeholder="Enter 6-digit OTP"
//                 className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center tracking-widest text-lg text-black focus:ring-2 focus:ring-[#21C1B6]"
//                 value={otp}
//                 onChange={(e) => {
//                   const value = e.target.value.replace(/\D/g, '');
//                   setOtp(value);
//                   setServerMessage('');
//                   setSuccessMessage('');
//                 }}
//               />

//               <button
//                 type="submit"
//                 disabled={isVerifying || otp.length !== 6}
//                 className="w-full mt-6 py-3 px-5 text-white font-semibold rounded-lg transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
//                 style={{
//                   background: "linear-gradient(90deg, #21C1B6 0%, #1AA49B 100%)",
//                 }}
//               >
//                 {isVerifying ? "Verifying..." : "Verify OTP"}
//               </button>
//             </form>

//             {serverMessage && (
//               <p className="mt-4 text-sm animate-fadeIn text-red-600">
//                 {serverMessage}
//               </p>
//             )}

//             {successMessage && (
//               <p className="mt-4 text-sm animate-fadeIn text-green-600">
//                 {successMessage}
//               </p>
//             )}
//           </div>
//         )}
//       </div>

//       {/* Right Visual Column */}
//       <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-gray-800 via-gray-900 to-gray-950 items-center justify-center p-12 relative overflow-hidden">
//         <div className="absolute inset-0 opacity-10">
//           <div className="absolute top-20 right-20 w-64 h-64 rounded-full blur-3xl" style={{ backgroundColor: '#1AA49B' }}></div>
//           <div className="absolute bottom-20 left-20 w-64 h-64 bg-blue-500 rounded-full blur-3xl"></div>
//         </div>

//         <div className="max-w-lg text-white relative z-10">
//           <div className="mb-8 relative">
//             <div className="bg-gradient-to-br from-gray-700 to-gray-800 rounded-2xl p-8 shadow-2xl">
//               <div className="flex gap-2 mb-6">
//                 <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//                 <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//                 <div className="w-3 h-3 rounded-full bg-gray-600"></div>
//               </div>
              
//               <div className="flex gap-4 items-center justify-center">
//                 <div className="space-y-3">
//                   <div className="w-12 h-12 rounded-lg" style={{ backgroundColor: '#1AA49B' }}></div>
//                   <div className="w-12 h-12 bg-gray-700 rounded-lg"></div>
//                   <div className="w-12 h-12 bg-gray-700 rounded-lg"></div>
//                 </div>
                
//                 <div className="bg-white rounded-lg p-4 w-48">
//                   <div className="space-y-2">
//                     <div className="h-3 rounded w-3/4" style={{ backgroundColor: '#1AA49B' }}></div>
//                     <div className="h-2 bg-gray-300 rounded"></div>
//                     <div className="h-2 bg-gray-300 rounded"></div>
//                     <div className="h-2 bg-gray-300 rounded w-5/6"></div>
//                   </div>
//                 </div>

//                 <div className="space-y-4">
//                   <div className="w-16 h-16 relative">
//                     <div className="absolute top-0 right-0 w-8 h-12 bg-gray-600 rounded transform rotate-45"></div>
//                     <div className="absolute bottom-0 left-0 w-12 h-6 rounded" style={{ backgroundColor: '#1AA49B' }}></div>
//                   </div>
//                   <div className="w-16 h-16 flex items-end justify-center">
//                     <div className="w-12 h-12 border-4 border-gray-600 rounded-full relative">
//                       <div className="absolute -top-6 left-1/2 -translate-x-1/2 w-1 h-8 bg-gray-600"></div>
//                     </div>
//                   </div>
//                 </div>
//               </div>
//             </div>
//           </div>

//           <h2 className="text-4xl font-bold mb-8 leading-tight text-center">
//             Automate Your Legal Workflow in Minutes
//           </h2>

//           <div className="space-y-6 bg-gradient-to-br from-gray-800/50 to-gray-900/50 backdrop-blur-sm rounded-2xl p-6">
//             <div className="flex items-start gap-4">
//               <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                 <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                   <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z"/>
//                 </svg>
//               </div>
//               <div>
//                 <h3 className="text-lg font-semibold mb-1">Accelerate case preparation</h3>
//                 <p className="text-gray-400 text-sm">in minutes with AI-powered tools</p>
//               </div>
//             </div>

//             <div className="flex items-start gap-4">
//               <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                 <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                   <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/>
//                 </svg>
//               </div>
//               <div>
//                 <h3 className="text-lg font-semibold mb-1">Smart Document Vault</h3>
//                 <p className="text-gray-400 text-sm">Secure, searchable, and organized</p>
//               </div>
//             </div>

//             <div className="flex items-start gap-4">
//               <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156, 223, 225, 0.2)' }}>
//                 <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
//                   <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/>
//                 </svg>
//               </div>
//               <div>
//                 <h3 className="text-lg font-semibold mb-1">Trusted Legal Insights</h3>
//                 <p className="text-gray-400 text-sm">AI-driven precedents & analysis</p>
//               </div>
//             </div>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default LoginPage;



import React, { useState, useEffect } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { Eye, EyeOff, CheckCircle, ArrowLeft } from "lucide-react";
import { auth, googleProvider } from '../../config/firebase';
import { signInWithPopup } from 'firebase/auth';
import { useAuth } from '../../context/AuthContext';
// Import the logo image
import JuriNexLogo from '../../assets/JuriNex_gavel_logo.png';
import AdvocateImage from '../../assets/advocate.png';

const LoginPage = () => {
 const [formData, setFormData] = useState({ email: "", password: "" });
 const [errors, setErrors] = useState({});
 const [showPassword, setShowPassword] = useState(false);
 const [isOTPStage, setIsOTPStage] = useState(false);
 const [otp, setOtp] = useState("");
 const [successMessage, setSuccessMessage] = useState("");
 const [isVerifying, setIsVerifying] = useState(false);
 const [isLoading, setIsLoading] = useState(false);
 const [serverMessage, setServerMessage] = useState("");
 const [otpEmail, setOtpEmail] = useState('');
 const [logoError, setLogoError] = useState(false);

 const [isGoogleSignInProgress, setIsGoogleSignInProgress] = useState(false);

 const navigate = useNavigate();
 const location = useLocation();
 const { login, verifyOtp, isAuthenticated, setAuthState } = useAuth();

 // Always redirect to dashboard if already authenticated
 useEffect(() => {
 if (isAuthenticated && !isLoading) {
 console.log('LoginPage: User already authenticated, redirecting to dashboard');
 navigate('/dashboard', { replace: true });
 }
 }, [isAuthenticated, navigate, isLoading]);

 // Validation functions
 const validateEmail = (email) => {
 if (!email) return "Email is required.";
 if (!/\S+@\S+\.\S+/.test(email)) return "Invalid email format.";
 return "";
 };
 
 const validatePassword = (password) => {
 if (!password) return "Password is required.";
 if (password.length < 8) return "Password must be at least 8 characters long.";
 if (!/(?=.*[a-z])/.test(password)) return "Password must contain at least one lowercase letter.";
 if (!/(?=.*[A-Z])/.test(password)) return "Password must contain at least one uppercase letter.";
 if (!/(?=.*\d)/.test(password)) return "Password must contain at least one number.";
 if (!/(?=.*[@$!%*?&])/.test(password)) return "Password must contain at least one special character (@$!%*?&).";
 return "";
 };

 const handleChange = (e) => {
 const { name, value } = e.target;
 setFormData({ ...formData, [name]: value });
 
 setServerMessage("");
 setSuccessMessage("");
 
 if (name === 'email') {
 setErrors((prev) => ({ ...prev, email: validateEmail(value) }));
 } else if (name === 'password') {
 setErrors((prev) => ({ ...prev, password: validatePassword(value) }));
 }
 };

 // Logo component with fallback
 const LogoComponent = ({ size = "w-16 h-16" }) => {
 if (logoError) {
 // Fallback SVG logo if image fails to load
 return (
 <div
 className={`${size} rounded-lg flex items-center justify-center`}
 style={{ backgroundColor: "#1AA49B" }}
 >
 <svg
 className="w-10 h-10 text-white"
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

 // Google Sign In Handler - Always redirect to dashboard
 const handleGoogleSignIn = async () => {
 try {
 setIsLoading(true);
 setServerMessage('');
 setSuccessMessage('');
 setIsOTPStage(false);
 
 const result = await signInWithPopup(auth, googleProvider);
 const user = result.user;
 
 // Get Firebase ID token
 const idToken = await user.getIdToken();
 
 // Send token to backend for verification and user creation/login
 const response = await fetch(`${import.meta.env.VITE_API_URL}/api/auth/google`, {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 },
 body: JSON.stringify({
 idToken: idToken,
 email: user.email,
 displayName: user.displayName,
 photoURL: user.photoURL,
 }),
 });

 const data = await response.json();

 if (response.ok && data.token) {
 const userData = {
 email: user.email,
 displayName: user.displayName,
 photoURL: user.photoURL,
 uid: user.uid
 };

 setSuccessMessage('Google Sign-In successful! Redirecting...');
 
 // CRITICAL: Update AuthContext state directly
 setAuthState(data.token, userData);
 
 // Always redirect to dashboard
 setTimeout(() => {
 setIsLoading(false); // End loading state
 navigate('/dashboard', { replace: true });
 }, 500);
 } else {
 setServerMessage(data.message || 'Google Sign-In failed. Please try again.');
 setIsLoading(false);
 }
 } catch (error) {
 console.error('Google Sign-In Error:', error);
 
 if (error.code === 'auth/popup-closed-by-user') {
 setServerMessage('Sign-in cancelled. Please try again.');
 } else if (error.code === 'auth/popup-blocked') {
 setServerMessage('Pop-up blocked. Please allow pop-ups and try again.');
 } else if (error.code === 'auth/cancelled-popup-request') {
 return;
 } else {
 setServerMessage(error.message || 'Failed to sign in with Google. Please try again.');
 }
 setIsLoading(false);
 }
 };

 // Manual Login - Always redirect to dashboard
 const handleLogin = async (e) => {
 e.preventDefault();
 
 const emailError = validateEmail(formData.email);
 const passwordError = validatePassword(formData.password);
 setErrors({ email: emailError, password: passwordError });
 
 if (emailError || passwordError) return;

 setIsLoading(true);
 setServerMessage('');
 setSuccessMessage('');

 try {
 const result = await login(formData.email, formData.password);

 if (result.requiresOtp) {
 setIsOTPStage(true);
 setOtpEmail(result.email || formData.email);
 setServerMessage('');
 setSuccessMessage(result.message || 'OTP sent to your email. Please check and enter the code.');
 } else if (result.success) {
 setSuccessMessage('Login successful! Redirecting...');
 setTimeout(() => {
 // Always redirect to dashboard
 navigate('/dashboard', { replace: true });
 }, 1500);
 } else {
 setServerMessage(result.message || "Login failed. Please try again.");
 }
 } catch (error) {
 setServerMessage(error.message || "Login failed. Please try again.");
 console.error('Login error:', error);
 } finally {
 setIsLoading(false);
 }
 };

 // Verify OTP Handler - Always redirect to dashboard
 const handleVerifyOTP = async (e) => {
 if (e) e.preventDefault();
 
 if (otp.length !== 6) {
 setSuccessMessage("");
 setServerMessage("Please enter a 6-digit OTP.");
 return;
 }

 setIsVerifying(true);
 setServerMessage('');
 setSuccessMessage('');
 
 try {
 const result = await verifyOtp(otpEmail || formData.email, otp);

 if (result.success) {
 setSuccessMessage('OTP verification successful! Logging in...');
 setServerMessage('');
 
 setTimeout(() => {
 // Always redirect to dashboard
 navigate('/dashboard', { replace: true });
 }, 1500);
 } else {
 setServerMessage(result.message || "Invalid OTP. Please try again.");
 setSuccessMessage('');
 }
 } catch (error) {
 setServerMessage(error.message || "Invalid OTP. Please try again.");
 setSuccessMessage('');
 console.error('OTP verification error:', error);
 } finally {
 setIsVerifying(false);
 }
 };

 const handleBackToLogin = () => {
 setIsOTPStage(false);
 setOtp('');
 setServerMessage('');
 setSuccessMessage('');
 setErrors({});
 };

 return (
 <div className="min-h-screen flex font-sans transition-all duration-700 ease-in-out">
 {/* Left Section */}
 <div className="w-full lg:w-1/2 bg-white flex items-center justify-center p-8 lg:p-12">
 {!isOTPStage && (
 <div className="max-w-md w-full transition-opacity duration-700">
 <div className="flex justify-center mb-8">
 <LogoComponent />
 </div>

 <h2 className="text-3xl font-bold text-gray-900 mb-2 text-center">
 Welcome to JuriNex
 </h2>
 <p className="text-gray-500 mb-8 text-center text-sm">
 Sign in to continue managing your legal workspace.
 </p>

 <form className="space-y-5" onSubmit={handleLogin}>
 <div>
 <label className="block text-sm font-medium text-gray-700 mb-1">
 Email / User ID
 </label>
 <input
 type="text"
 name="email"
 placeholder="Enter your email"
 className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] text-black"
 value={formData.email}
 onChange={handleChange}
 />
 {errors.email && (
 <p className="mt-1 text-xs text-red-600">{errors.email}</p>
 )}
 </div>

 <div>
 <label className="block text-sm font-medium text-gray-700 mb-1">
 Password
 </label>
 <div className="relative">
 <input
 type={showPassword ? "text" : "password"}
 name="password"
 placeholder="Enter your password"
 className="w-full px-4 py-2.5 border border-gray-300 rounded-lg pr-10 focus:ring-2 focus:ring-[#21C1B6] text-black"
 value={formData.password}
 onChange={handleChange}
 />
 <button
 type="button"
 onClick={() => setShowPassword(!showPassword)}
 className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
 >
 {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
 </button>
 </div>
 {errors.password && (
 <p className="mt-1 text-xs text-red-600">{errors.password}</p>
 )}
 </div>

 <button
 type="submit"
 disabled={isLoading}
 className="w-full py-3 px-5 text-white font-semibold rounded-lg transition duration-300 mt-6 disabled:opacity-50 disabled:cursor-not-allowed"
 style={{
 background: "linear-gradient(90deg, #21C1B6 0%, #1AA49B 100%)",
 }}
 >
 {isLoading ? "Signing In..." : "Sign In"}
 </button>
 </form>

 <div className="mt-6">
 <div className="relative">
 <div className="absolute inset-0 flex items-center">
 <div className="w-full border-t border-gray-300" />
 </div>
 <div className="relative flex justify-center text-sm">
 <span className="px-2 bg-white text-gray-500">Or continue with</span>
 </div>
 </div>
 </div>

 <div className="mt-6">
 <button
 onClick={handleGoogleSignIn}
 disabled={isLoading}
 type="button"
 className="w-full flex items-center justify-center px-4 py-2.5 border border-gray-300 rounded-lg shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#21C1B6] disabled:opacity-50 disabled:cursor-not-allowed transition duration-200"
 >
 <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24">
 <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
 <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
 <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
 <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
 </svg>
 Sign in with Google
 </button>
 </div>

 <div className="mt-6 space-y-4">
 <div className="text-center">
 <p className="text-sm text-gray-600">
 Don't have an account?{' '}
 <Link
 to="/register"
 className="font-medium text-[#1AA49B] hover:text-[#21C1B6] transition-colors duration-200"
 >
 Create new account
 </Link>
 </p>
 </div>
 
 <div className="text-center">
 <button
 onClick={() => navigate('/')}
 type="button"
 className="flex items-center justify-center mx-auto text-gray-600 hover:text-gray-800 transition-colors duration-200 group"
 >
 <ArrowLeft size={18} className="mr-2 group-hover:-translate-x-1 transition-transform duration-200" />
 <span className="text-sm font-medium">Back to Home</span>
 </button>
 </div>
 </div>

 {serverMessage && (
 <p className="text-sm text-center mt-4 text-red-600">
 {serverMessage}
 </p>
 )}

 {successMessage && (
 <p className="text-sm text-center mt-4 text-green-600">
 {successMessage}
 </p>
 )}
 </div>
 )}

 {/* OTP Screen */}
 {isOTPStage && (
 <div className="max-w-md w-full text-center animate-fadeIn">
 <div className="mb-6 text-left">
 <button
 onClick={handleBackToLogin}
 type="button"
 className="flex items-center text-gray-600 hover:text-gray-800 transition-colors duration-200 group"
 >
 <ArrowLeft size={20} className="mr-2 group-hover:-translate-x-1 transition-transform duration-200" />
 <span className="text-sm font-medium">Back to Login</span>
 </button>
 </div>

 <div className="flex justify-center mb-8">
 <LogoComponent />
 </div>
 <h2 className="text-2xl font-bold text-gray-900 mb-2">Enter OTP</h2>
 <p className="text-gray-500 mb-6 text-sm">
 We've sent a 6-digit code to <span className="font-medium text-gray-700">{otpEmail || formData.email}</span>
 </p>

 <form onSubmit={handleVerifyOTP} className="space-y-6">
 <input
 type="text"
 maxLength="6"
 placeholder="Enter 6-digit OTP"
 className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center tracking-widest text-lg text-black focus:ring-2 focus:ring-[#21C1B6]"
 value={otp}
 onChange={(e) => {
 const value = e.target.value.replace(/\D/g, '');
 setOtp(value);
 setServerMessage('');
 setSuccessMessage('');
 }}
 />

 <button
 type="submit"
 disabled={isVerifying || otp.length !== 6}
 className="w-full mt-6 py-3 px-5 text-white font-semibold rounded-lg transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
 style={{
 background: "linear-gradient(90deg, #21C1B6 0%, #1AA49B 100%)",
 }}
 >
 {isVerifying ? "Verifying..." : "Verify OTP"}
 </button>
 </form>

 {serverMessage && (
 <p className="mt-4 text-sm animate-fadeIn text-red-600">
 {serverMessage}
 </p>
 )}

 {successMessage && (
 <p className="mt-4 text-sm animate-fadeIn text-green-600">
 {successMessage}
 </p>
 )}
 </div>
 )}
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
 );
};

export default LoginPage;