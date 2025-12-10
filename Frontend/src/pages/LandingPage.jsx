

// import React, { useRef, useState, useEffect } from 'react';
// import { Link, useNavigate } from 'react-router-dom';
// import { FileText, Upload, Cpu, CheckCircle, Sparkles, ArrowRight, Zap, Lock, TrendingUp, Menu, X } from 'lucide-react';
// import JuriNexGavelLogo from '../assets/JuriNex_gavel_logo.png';
// import { motion, useScroll, useTransform, useInView } from 'framer-motion';
// import Footer from '../components/Footer';

// const LandingPage = () => {
//  const navigate = useNavigate();
//  const { scrollY } = useScroll();
//  const heroRef = useRef(null);
//  const featuresRef = useRef(null);
//  const benefitsRef = useRef(null);
//  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
//  const [isDesktop, setIsDesktop] = useState(false);
//  const isHeroInView = useInView(heroRef, { once: true });
//  const isFeaturesInView = useInView(featuresRef, { once: true });
//  const isBenefitsInView = useInView(benefitsRef, { once: true });
 
//  // Handle responsive behavior
//  useEffect(() => {
//  const handleResize = () => {
//  setIsDesktop(window.innerWidth >= 1024);
//  };
 
//  handleResize();
//  window.addEventListener('resize', handleResize);
//  return () => window.removeEventListener('resize', handleResize);
//  }, []);

//  // Navigation handlers
//  const handleLogin = () => {
//  navigate('/login');
//  };

//  const handleRegister = () => {
//  alert('Register clicked - navigate to /register');
//  };

//  // Parallax effects
//  const heroY = useTransform(scrollY, [0, 500], [0, -50]);
//  const heroOpacity = useTransform(scrollY, [0, 300], [1, 0.8]);

//  // Animation variants
//  const containerVariants = {
//  hidden: { opacity: 0 },
//  visible: {
//  opacity: 1,
//  transition: {
//  staggerChildren: 0.15,
//  delayChildren: 0.1
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

//  const cardVariants = {
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
//  duration: 0.7,
//  ease: [0.25, 0.46, 0.45, 0.94]
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
//  <div className="min-h-screen bg-white">
//  {/* Mobile Menu Toggle Button */}
//  <button
//  onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
//  className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg shadow-lg bg-white"
//  style={{ color: '#21C1B6' }}
//  >
//  {mobileSidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
//  </button>

//  {/* Vertical Sidebar Navigation - Fixed Width */}
//  <motion.nav 
//  animate={{ 
//  x: mobileSidebarOpen || isDesktop ? 0 : -280
//  }}
//  transition={{ duration: 0.3, ease: "easeInOut" }}
//  className="fixed top-0 left-0 h-full bg-white shadow-xl z-40 border-r border-gray-100"
//  style={{ width: '280px' }}
//  >
//  <div className="flex flex-col h-full px-6 py-8 relative">
//  {/* Logo */}
//  <motion.div 
//  className="flex items-center justify-center mb-12"
//  initial={{ opacity: 0 }}
//  animate={{ opacity: 1 }}
//  transition={{ delay: 0.2 }}
//  >
//  <div className="flex items-center">
//  <span className="text-teal-500 text-3xl font-bold" style={{ color: '#21C1B6' }}>Juri</span>
//  <span className="text-gray-800 text-3xl font-bold relative">
//  Nex
//  <span className="absolute text-xs font-normal" style={{ 
//  top: '0', 
//  right: '-0.6em',
//  color: '#6B7280'
//  }}>™</span>
//  </span>
//  </div>
//  </motion.div>

//  {/* Navigation Links */}
//  <div className="flex-1 flex flex-col space-y-2">
//  <Link
//  to="/"
//  className="group relative text-base text-gray-600 hover:text-gray-900 font-medium py-4 px-6 rounded-lg transition-all duration-300 hover:bg-gray-50 flex items-center"
//  >
//  <span className="relative z-10">Home</span>
//  <motion.div
//  className="absolute left-0 top-0 bottom-0 w-1 rounded-r-lg"
//  style={{ backgroundColor: '#21C1B6' }}
//  initial={{ scaleY: 0 }}
//  whileHover={{ scaleY: 1 }}
//  transition={{ duration: 0.2 }}
//  />
//  </Link>

//  <Link
//  to="/services"
//  className="group relative text-base text-gray-600 hover:text-gray-900 font-medium py-4 px-6 rounded-lg transition-all duration-300 hover:bg-gray-50 flex items-center"
//  >
//  <span className="relative z-10">Services</span>
//  <motion.div
//  className="absolute left-0 top-0 bottom-0 w-1 rounded-r-lg"
//  style={{ backgroundColor: '#21C1B6' }}
//  initial={{ scaleY: 0 }}
//  whileHover={{ scaleY: 1 }}
//  transition={{ duration: 0.2 }}
//  />
//  </Link>

//  <Link
//  to="/pricing"
//  className="group relative text-base text-gray-600 hover:text-gray-900 font-medium py-4 px-6 rounded-lg transition-all duration-300 hover:bg-gray-50 flex items-center"
//  >
//  <span className="relative z-10">Pricing</span>
//  <motion.div
//  className="absolute left-0 top-0 bottom-0 w-1 rounded-r-lg"
//  style={{ backgroundColor: '#21C1B6' }}
//  initial={{ scaleY: 0 }}
//  whileHover={{ scaleY: 1 }}
//  transition={{ duration: 0.2 }}
//  />
//  </Link>

//  <Link
//  to="/aboutus"
//  className="group relative text-base text-gray-600 hover:text-gray-900 font-medium py-4 px-6 rounded-lg transition-all duration-300 hover:bg-gray-50 flex items-center"
//  >
//  <span className="relative z-10">About Us</span>
//  <motion.div
//  className="absolute left-0 top-0 bottom-0 w-1 rounded-r-lg"
//  style={{ backgroundColor: '#21C1B6' }}
//  initial={{ scaleY: 0 }}
//  whileHover={{ scaleY: 1 }}
//  transition={{ duration: 0.2 }}
//  />
//  </Link>
//  </div>

//  {/* Login Button */}
//  <motion.button
//  whileHover={{ scale: 1.05 }}
//  whileTap={{ scale: 0.95 }}
//  onClick={handleLogin}
//  className="w-full text-white text-base font-medium py-3 px-6 rounded-lg transition-all shadow-lg flex items-center justify-center"
//  style={{ backgroundColor: '#21C1B6' }}
//  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#1AA49B'}
//  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#21C1B6'}
//  >
//  Login
//  </motion.button>

//  {/* Decorative element */}
//  <motion.div
//  initial={{ opacity: 0 }}
//  animate={{ opacity: 1 }}
//  className="mt-8 h-1 rounded-full mx-auto"
//  style={{ backgroundColor: '#21C1B6', width: '60%' }}
//  transition={{
//  duration: 3,
//  repeat: Infinity,
//  ease: "easeInOut"
//  }}
//  />
//  </div>
//  </motion.nav>

//  {/* Overlay for mobile */}
//  {mobileSidebarOpen && (
//  <div
//  className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-30"
//  onClick={() => setMobileSidebarOpen(false)}
//  />
//  )}

//  {/* Main Content - Fixed margin for desktop */}
//  <div
//  className="transition-all lg:ml-[280px]"
//  >
//  {/* Animated background elements */}
//  <div className="fixed inset-0 overflow-hidden pointer-events-none">
//  <motion.div
//  className="absolute -top-40 -right-40 w-80 h-80 rounded-full blur-3xl opacity-20"
//  style={{ backgroundColor: '#21C1B6' }}
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
//  className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full blur-3xl opacity-20"
//  style={{ backgroundColor: '#21C1B6' }}
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

//  {/* Hero Section */}
//  <motion.header
//  ref={heroRef}
//  className="relative pt-32 pb-20 overflow-hidden"
//  style={{
//  y: heroY,
//  opacity: heroOpacity,
//  background: 'linear-gradient(to bottom right, #f9fafb, #ffffff, #f0fffe)'
//  }}
//  >
//  <motion.div
//  className="container mx-auto text-center px-4 sm:px-6 lg:px-8 relative z-10"
//  variants={containerVariants}
//  initial="hidden"
//  animate={isHeroInView ? "visible" : "hidden"}
//  >
//  {/* Logo with glow effect */}
//  <motion.div
//  className="relative inline-flex items-center justify-center mb-8"
//  variants={itemVariants}
//  >
//  <motion.div
//  className="absolute w-24 h-24 rounded-xl blur-md opacity-20"
//  variants={glowVariants}
//  initial="initial"
//  animate="animate"
//  />
//  <motion.div
//  className="relative w-20 h-20 rounded-xl shadow-2xl flex items-center justify-center"
//  whileHover={{
//  scale: 1.05,
//  rotate: [0, -5, 5, 0],
//  transition: { duration: 0.3 }
//  }}
//  whileTap={{ scale: 0.95 }}
//  >
//  <img src={JuriNexGavelLogo} alt="JuriNex Logo" className="w-full h-full object-cover rounded-xl" />
//  <motion.div
//  className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent rounded-xl"
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
//  className="text-2xl sm:text-3xl lg:text-4xl font-semibold text-gray-700 mb-6"
//  variants={itemVariants}
//  >
//  Intelligent Assistant for Legal Professionals
//  </motion.h2>

//  <motion.p 
//  className="text-lg sm:text-xl text-gray-600 mb-10 max-w-3xl mx-auto leading-relaxed"
//  variants={itemVariants}
//  >
//  Work Faster, Practice Smarter<br/> with<br/> the{' '}
//  <span className="font-semibold inline-flex items-center" style={{ color: '#21C1B6' }}>
//  Power of AI
//  </span>
//  </motion.p>

//  <motion.div 
//  className="flex flex-col sm:flex-row justify-center gap-4 items-center"
//  variants={itemVariants}
//  >
//  <motion.div
//  whileHover={{ scale: 1.05 }}
//  whileTap={{ scale: 0.98 }}
//  >
//  <button 
//  onClick={handleRegister}
//  className="group relative text-white font-semibold py-3 px-8 rounded-lg text-base shadow-lg inline-flex items-center overflow-hidden transition-all duration-300"
//  style={{ backgroundColor: '#21C1B6' }}
//  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#1AA49B'}
//  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#21C1B6'}
//  >
//  <FileText className="w-5 h-5 mr-2 group-hover:rotate-12 transition-transform duration-300" />
//  <span className="relative z-10">Product Demo</span>
//  <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform duration-300" />
//  </button>
//  </motion.div>

//  <motion.div
//  whileHover={{ scale: 1.05 }}
//  whileTap={{ scale: 0.98 }}
//  >
//  <Link
//  to="/register"
//  className="group bg-white hover:bg-gray-50 text-gray-800 font-semibold py-3 px-8 rounded-lg text-base shadow-md border border-gray-300 hover:border-gray-400 inline-flex items-center transition-all duration-300"
//  >
//  <span>Register</span>
//  <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform duration-300" />
//  </Link>
//  </motion.div>
//  </motion.div>

//  {/* Floating elements */}
//  <motion.div 
//  className="absolute top-10 left-10 w-4 h-4 rounded-full opacity-30"
//  style={{ backgroundColor: '#21C1B6' }}
//  animate={{
//  y: [0, -20, 0],
//  x: [0, 10, 0]
//  }}
//  transition={{
//  duration: 4,
//  repeat: Infinity,
//  ease: "easeInOut"
//  }}
//  />
//  <motion.div 
//  className="absolute top-32 right-20 w-6 h-6 rounded-full opacity-20"
//  style={{ backgroundColor: '#21C1B6' }}
//  animate={{
//  y: [0, -30, 0],
//  x: [0, -15, 0]
//  }}
//  transition={{
//  duration: 5,
//  repeat: Infinity,
//  ease: "easeInOut",
//  delay: 1
//  }}
//  />
//  </motion.div>
//  </motion.header>

//  {/* How it Works Section */}
//  <motion.section 
//  ref={featuresRef}
//  className="py-20 bg-gradient-to-br from-white to-gray-50 relative overflow-hidden"
//  >
//  <div className="container mx-auto text-center px-4 sm:px-6 lg:px-8 relative z-10">
//  <motion.div
//  initial={{ opacity: 0, y: 30 }}
//  animate={isFeaturesInView ? { opacity: 1, y: 0 } : {}}
//  transition={{ duration: 0.6 }}
//  >
//  <motion.h2 
//  className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 mb-3"
//  whileHover={{ scale: 1.02 }}
//  >
//  How It Works
//  </motion.h2>
//  <motion.p 
//  className="text-base text-gray-600 mb-16 max-w-2xl mx-auto"
//  initial={{ opacity: 0 }}
//  animate={isFeaturesInView ? { opacity: 1 } : {}}
//  transition={{ delay: 0.2, duration: 0.6 }}
//  >
//  Three simple steps to transform the way you work !!
//  </motion.p>
//  </motion.div>

//  <motion.div 
//  className="grid grid-cols-1 md:grid-cols-3 gap-8"
//  variants={containerVariants}
//  initial="hidden"
//  animate={isFeaturesInView ? "visible" : "hidden"}
//  >
//  {/* Step 1 */}
//  <motion.div 
//  className="group relative"
//  variants={cardVariants}
//  whileHover={{ 
//  y: -10,
//  transition: { duration: 0.3 }
//  }}
//  >
//  <motion.div 
//  className="absolute inset-0 rounded-2xl blur-xl opacity-0 group-hover:opacity-20 transition-opacity duration-500"
//  style={{ backgroundColor: '#21C1B6' }}
//  animate={{
//  scale: [1, 1.05, 1]
//  }}
//  transition={{
//  duration: 2,
//  repeat: Infinity,
//  ease: "easeInOut"
//  }}
//  />
 
//  <div className="relative p-8 bg-white rounded-2xl shadow-lg border border-gray-100 group-hover:shadow-xl transition-all duration-500">
//  <motion.div 
//  className="relative inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6 shadow-lg"
//  style={{ backgroundColor: '#e0f7f6' }}
//  whileHover={{ 
//  rotate: [0, -10, 10, 0],
//  scale: 1.1
//  }}
//  transition={{ duration: 0.4 }}
//  >
//  <Upload className="w-8 h-8" style={{ color: '#21C1B6' }} />
//  <motion.div 
//  className="absolute inset-0 bg-gradient-to-br from-white/30 to-transparent rounded-2xl"
//  animate={{
//  opacity: [0, 0.5, 0]
//  }}
//  transition={{
//  duration: 2,
//  repeat: Infinity,
//  ease: "easeInOut",
//  delay: 0
//  }}
//  />
//  </motion.div>
 
//  <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-gray-900 transition-colors duration-300">
//  Upload Document
//  </h3>
//  <p className="text-sm text-gray-600 leading-relaxed group-hover:text-gray-700 transition-colors duration-300">
//  Securely upload your legal documents in various formats like PDF, DOCX, or TXT with enterprise-grade encryption.
//  </p>

//  {/* Step indicator */}
//  <motion.div 
//  className="absolute -top-3 -right-3 w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-lg"
//  style={{ backgroundColor: '#21C1B6' }}
//  initial={{ scale: 0, rotate: -180 }}
//  animate={isFeaturesInView ? { scale: 1, rotate: 0 } : {}}
//  transition={{ delay: 0.5, duration: 0.5 }}
//  >
//  1
//  </motion.div>
//  </div>
//  </motion.div>

//  {/* Step 2 */}
//  <motion.div 
//  className="group relative"
//  variants={cardVariants}
//  whileHover={{ 
//  y: -10,
//  transition: { duration: 0.3 }
//  }}
//  >
//  <motion.div 
//  className="absolute inset-0 rounded-2xl blur-xl opacity-0 group-hover:opacity-20 transition-opacity duration-500"
//  style={{ backgroundColor: '#21C1B6' }}
//  animate={{
//  scale: [1, 1.05, 1]
//  }}
//  transition={{
//  duration: 2,
//  repeat: Infinity,
//  ease: "easeInOut",
//  delay: 0.7
//  }}
//  />
 
//  <div className="relative p-8 bg-white rounded-2xl shadow-lg border border-gray-100 group-hover:shadow-xl transition-all duration-500">
//  <motion.div 
//  className="relative inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6 shadow-lg"
//  style={{ backgroundColor: '#e0f7f6' }}
//  whileHover={{ 
//  rotate: [0, 180, 360],
//  scale: 1.1
//  }}
//  transition={{ duration: 0.8 }}
//  >
//  <Cpu className="w-8 h-8" style={{ color: '#21C1B6' }} />
//  <motion.div 
//  className="absolute inset-0 bg-gradient-to-br from-white/30 to-transparent rounded-2xl"
//  animate={{
//  opacity: [0, 0.5, 0]
//  }}
//  transition={{
//  duration: 2,
//  repeat: Infinity,
//  ease: "easeInOut",
//  delay: 0.7
//  }}
//  />
//  </motion.div>
 
//  <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-gray-900 transition-colors duration-300">
//  AI-Powered Analysis
//  </h3>
//  <p className="text-sm text-gray-600 leading-relaxed group-hover:text-gray-700 transition-colors duration-300">
//  Advanced machine learning algorithms analyze content, identifying key legal points, clauses, and critical insights.
//  </p>

//  {/* Step indicator */}
//  <motion.div 
//  className="absolute -top-3 -right-3 w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-lg"
//  style={{ backgroundColor: '#21C1B6' }}
//  initial={{ scale: 0, rotate: -180 }}
//  animate={isFeaturesInView ? { scale: 1, rotate: 0 } : {}}
//  transition={{ delay: 0.7, duration: 0.5 }}
//  >
//  2
//  </motion.div>
//  </div>
//  </motion.div>

//  {/* Step 3 */}
//  <motion.div 
//  className="group relative"
//  variants={cardVariants}
//  whileHover={{ 
//  y: -10,
//  transition: { duration: 0.3 }
//  }}
//  >
//  <motion.div 
//  className="absolute inset-0 rounded-2xl blur-xl opacity-0 group-hover:opacity-20 transition-opacity duration-500"
//  style={{ backgroundColor: '#21C1B6' }}
//  animate={{
//  scale: [1, 1.05, 1]
//  }}
//  transition={{
//  duration: 2,
//  repeat: Infinity,
//  ease: "easeInOut",
//  delay: 1.4
//  }}
//  />
 
//  <div className="relative p-8 bg-white rounded-2xl shadow-lg border border-gray-100 group-hover:shadow-xl transition-all duration-500">
//  <motion.div 
//  className="relative inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6 shadow-lg"
//  style={{ backgroundColor: '#e0f7f6' }}
//  whileHover={{ 
//  scale: [1, 1.2, 1],
//  rotate: [0, 10, -10, 0]
//  }}
//  transition={{ duration: 0.6 }}
//  >
//  <CheckCircle className="w-8 h-8" style={{ color: '#21C1B6' }} />
//  <motion.div 
//  className="absolute inset-0 bg-gradient-to-br from-white/30 to-transparent rounded-2xl"
//  animate={{
//  opacity: [0, 0.5, 0]
//  }}
//  transition={{
//  duration: 2,
//  repeat: Infinity,
//  ease: "easeInOut",
//  delay: 1.4
//  }}
//  />
//  </motion.div>
 
//  <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-gray-900 transition-colors duration-300">
//  Receive Summary
//  </h3>
//  <p className="text-sm text-gray-600 leading-relaxed group-hover:text-gray-700 transition-colors duration-300">
//  Get comprehensive, easy-to-understand summaries with actionable insights, saving hours of manual review.
//  </p>

//  {/* Step indicator */}
//  <motion.div 
//  className="absolute -top-3 -right-3 w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-lg"
//  style={{ backgroundColor: '#21C1B6' }}
//  initial={{ scale: 0, rotate: -180 }}
//  animate={isFeaturesInView ? { scale: 1, rotate: 0 } : {}}
//  transition={{ delay: 0.9, duration: 0.5 }}
//  >
//  3
//  </motion.div>
//  </div>
//  </motion.div>
//  </motion.div>
//  </div>

//  {/* Background decoration */}
//  <motion.div 
//  className="absolute top-20 right-10 w-32 h-32 rounded-full opacity-10 blur-2xl"
//  style={{ backgroundColor: '#21C1B6' }}
//  animate={{
//  scale: [1, 1.2, 1],
//  opacity: [0.1, 0.2, 0.1]
//  }}
//  transition={{
//  duration: 4,
//  repeat: Infinity,
//  ease: "easeInOut"
//  }}
//  />
//  </motion.section>

//  {/* Benefits Section */}
//  <motion.section 
//  ref={benefitsRef}
//  className="py-20 bg-white"
//  >
//  <div className="container mx-auto px-4 sm:px-6 lg:px-8">
//  <motion.div
//  className="text-center mb-16"
//  initial={{ opacity: 0, y: 30 }}
//  animate={isBenefitsInView ? { opacity: 1, y: 0 } : {}}
//  >
//  <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 mb-3">
//  Why Choose JuriNex<span className="text-xs font-normal text-gray-500 align-top">™</span>?
//  </h2>
//  <p className="text-base text-gray-600 max-w-2xl mx-auto">
//  Powerful features designed for legal professionals
//  </p>
//  </motion.div>

//  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
//  <motion.div 
//  className="bg-white p-6 rounded-xl shadow-md border border-gray-100 hover:shadow-lg transition-shadow"
//  initial={{ opacity: 0, y: 20 }}
//  animate={isBenefitsInView ? { opacity: 1, y: 0 } : {}}
//  transition={{ delay: 0.1 }}
//  >
//  <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-4" style={{ backgroundColor: '#e0f7f6' }}>
//  <Zap className="w-6 h-6" style={{ color: '#21C1B6' }} />
//  </div>
//  <h3 className="text-lg font-bold text-gray-900 mb-2">Lightning Fast</h3>
//  <p className="text-sm text-gray-600">Process documents in seconds, not hours</p>
//  </motion.div>

//  <motion.div 
//  className="bg-white p-6 rounded-xl shadow-md border border-gray-100 hover:shadow-lg transition-shadow"
//  initial={{ opacity: 0, y: 20 }}
//  animate={isBenefitsInView ? { opacity: 1, y: 0 } : {}}
//  transition={{ delay: 0.2 }}
//  >
//  <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-4" style={{ backgroundColor: '#e0f7f6' }}>
//  <Lock className="w-6 h-6" style={{ color: '#21C1B6' }} />
//  </div>
//  <h3 className="text-lg font-bold text-gray-900 mb-2">Secure & Private</h3>
//  <p className="text-sm text-gray-600">Enterprise-grade security for your sensitive data</p>
//  </motion.div>

//  <motion.div 
//  className="bg-white p-6 rounded-xl shadow-md border border-gray-100 hover:shadow-lg transition-shadow"
//  initial={{ opacity: 0, y: 20 }}
//  animate={isBenefitsInView ? { opacity: 1, y: 0 } : {}}
//  transition={{ delay: 0.3 }}
//  >
//  <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-4" style={{ backgroundColor: '#e0f7f6' }}>
//  <TrendingUp className="w-6 h-6" style={{ color: '#21C1B6' }} />
//  </div>
//  <h3 className="text-lg font-bold text-gray-900 mb-2">Highly Accurate</h3>
//  <p className="text-sm text-gray-600">AI trained on millions of legal documents</p>
//  </motion.div>
//  </div>
//  </div>
//  </motion.section>

//  {/* CTA Section */}
//  <section className="py-20" style={{ backgroundColor: '#21C1B6' }}>
//  <div className="container mx-auto text-center px-4 sm:px-6 lg:px-8">
//  <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
//  Ready to Transform Your Legal Workflow?
//  </h2>
//  <p className="text-lg text-white/95 mb-8 max-w-2xl mx-auto">
//  Join thousands of legal professionals who trust JuriNex<span className="text-xs align-top">™</span>
//  </p>
//  <motion.button
//  whileHover={{ scale: 1.05 }}
//  whileTap={{ scale: 0.95 }}
//  onClick={handleRegister}
//  className="bg-white font-semibold py-3 px-8 rounded-lg text-base shadow-xl hover:bg-gray-50 transition-colors inline-flex items-center"
//  style={{ color: '#21C1B6' }}
//  >
//  <span>Start Free Trial</span>
//  <ArrowRight className="w-5 h-5 ml-2" />
//  </motion.button>
//  </div>
//  </section>

//  {/* Footer */}
//  {/* <footer className="bg-gray-900 text-gray-300 py-12">
//  <div className="container mx-auto px-4 sm:px-6 lg:px-8">
//  <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
//  <div>
//  <div className="flex items-center mb-4">
//  <div className="flex items-center">
//  <span className="text-teal-500 text-2xl font-bold" style={{ color: '#21C1B6' }}>Juri</span>
//  <span className="text-white text-2xl font-bold relative">
//  Nex
//  <span className="absolute text-xs font-normal text-gray-400" style={{ 
//  top: '0', 
//  right: '-0.5em'
//  }}>™</span>
//  </span>
//  </div>
//  </div>
//  <p className="text-gray-400 text-sm leading-relaxed">
//  Transforming legal workflows with AI-powered intelligence.
//  </p>
//  </div>

//  <div>
//  <h4 className="text-white font-semibold mb-4 text-sm">Quick Links</h4>
//  <ul className="space-y-2 text-sm">
//  <li><Link to="/" className="text-gray-400 hover:text-white transition-colors">Home</Link></li>
//  <li><Link to="/services" className="text-gray-400 hover:text-white transition-colors">Services</Link></li>
//  <li><Link to="/pricing" className="text-gray-400 hover:text-white transition-colors">Pricing</Link></li>
//  </ul>
//  </div>

//  <div>
//  <h4 className="text-white font-semibold mb-4 text-sm">Contact Us</h4>
//  <p className="text-sm text-gray-400 leading-relaxed">
//  B-11, near Railway Station Road,<br />
//  MIDC Chikalthana,<br />
//  Aurangabad
//  </p>
//  </div>

//  <div>
//  <h4 className="text-white font-semibold mb-4 text-sm">Legal</h4>
//  <ul className="space-y-2 text-sm">
//  <li><a href="#" className="text-gray-400 hover:text-white transition-colors">Terms of Use</a></li>
//  <li><a href="#" className="text-gray-400 hover:text-white transition-colors">Privacy Policy</a></li>
//  </ul>
//  </div>
//  </div>

//  <div className="border-t border-gray-800 mt-8 pt-8 text-center text-sm text-gray-400">
//  <p>&copy; 2025 JuriNex<span className="text-xs align-top"></span>. All rights reserved.</p>
//  </div>
//  </div>
//  </footer> */}


//  <Footer/>
//  </div>
//  </div>
//  );
// };

// export default LandingPage;



// import React, { useRef, useState, useEffect } from 'react';
// import { Link, useNavigate } from 'react-router-dom';
// import { FileText, Upload, Cpu, CheckCircle, Sparkles, ArrowRight, Zap, Lock, TrendingUp, Menu, X, Clock, FileSearch, Target, Globe, Brain } from 'lucide-react';
// import JuriNexGavelLogo from '../assets/JuriNex_gavel_logo.png';
// import { motion, useScroll, useTransform, useInView } from 'framer-motion';
// import Footer from '../components/Footer';

// const LandingPage = () => {
//  const navigate = useNavigate();
//  const { scrollY } = useScroll();
//  const heroRef = useRef(null);
//  const featuresRef = useRef(null);
//  const benefitsRef = useRef(null);
//  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
//  const [isDesktop, setIsDesktop] = useState(false);
//  const isHeroInView = useInView(heroRef, { once: true });
//  const isFeaturesInView = useInView(featuresRef, { once: true });
//  const isBenefitsInView = useInView(benefitsRef, { once: true });
 
//  // Handle responsive behavior
//  useEffect(() => {
//  const handleResize = () => {
//  setIsDesktop(window.innerWidth >= 1024);
//  };
 
//  handleResize();
//  window.addEventListener('resize', handleResize);
//  return () => window.removeEventListener('resize', handleResize);
//  }, []);

//  // Navigation handlers
//  const handleLogin = () => {
//  navigate('/login');
//  };

//  const handleRegister = () => {
//  navigate('/register');
//  };

//  // Parallax effects
//  const heroY = useTransform(scrollY, [0, 500], [0, -50]);
//  const heroOpacity = useTransform(scrollY, [0, 300], [1, 0.8]);

//  // Animation variants
//  const containerVariants = {
//  hidden: { opacity: 0 },
//  visible: {
//  opacity: 1,
//  transition: {
//  staggerChildren: 0.15,
//  delayChildren: 0.1
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

//  const cardVariants = {
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
//  duration: 0.7,
//  ease: [0.25, 0.46, 0.45, 0.94]
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
//  <div className="min-h-screen bg-white">
//  {/* Mobile Menu Toggle Button */}
//  <button
//  onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
//  className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg shadow-lg bg-white"
//  style={{ color: '#21C1B6' }}
//  >
//  {mobileSidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
//  </button>

//  {/* Vertical Sidebar Navigation - Fixed Width */}
//  <motion.nav 
//  animate={{ 
//  x: mobileSidebarOpen || isDesktop ? 0 : -280
//  }}
//  transition={{ duration: 0.3, ease: "easeInOut" }}
//  className="fixed top-0 left-0 h-full bg-white shadow-xl z-40 border-r border-gray-100"
//  style={{ width: '280px' }}
//  >
//  <div className="flex flex-col h-full px-6 py-8 relative">
//  {/* Logo */}
//  <motion.div 
//  className="flex items-center justify-center mb-12"
//  initial={{ opacity: 0 }}
//  animate={{ opacity: 1 }}
//  transition={{ delay: 0.2 }}
//  >
//  <div className="flex items-center">
//  <span className="text-teal-500 text-3xl font-bold" style={{ color: '#21C1B6' }}>Juri</span>
//  <span className="text-gray-800 text-3xl font-bold relative">
//  Nex
//  <span className="absolute text-xs font-normal" style={{ 
//  top: '0', 
//  right: '-0.6em',
//  color: '#6B7280'
//  }}>™</span>
//  </span>
//  </div>
//  </motion.div>

//  {/* Navigation Links */}
//  <div className="flex-1 flex flex-col space-y-2">
//  <Link
//  to="/"
//  className="group relative text-base text-gray-600 hover:text-gray-900 font-medium py-4 px-6 rounded-lg transition-all duration-300 hover:bg-gray-50 flex items-center"
//  >
//  <span className="relative z-10">Home</span>
//  <motion.div
//  className="absolute left-0 top-0 bottom-0 w-1 rounded-r-lg"
//  style={{ backgroundColor: '#21C1B6' }}
//  initial={{ scaleY: 0 }}
//  whileHover={{ scaleY: 1 }}
//  transition={{ duration: 0.2 }}
//  />
//  </Link>

//  <Link
//  to="/services"
//  className="group relative text-base text-gray-600 hover:text-gray-900 font-medium py-4 px-6 rounded-lg transition-all duration-300 hover:bg-gray-50 flex items-center"
//  >
//  <span className="relative z-10">Services</span>
//  <motion.div
//  className="absolute left-0 top-0 bottom-0 w-1 rounded-r-lg"
//  style={{ backgroundColor: '#21C1B6' }}
//  initial={{ scaleY: 0 }}
//  whileHover={{ scaleY: 1 }}
//  transition={{ duration: 0.2 }}
//  />
//  </Link>

//  <Link
//  to="/pricing"
//  className="group relative text-base text-gray-600 hover:text-gray-900 font-medium py-4 px-6 rounded-lg transition-all duration-300 hover:bg-gray-50 flex items-center"
//  >
//  <span className="relative z-10">Pricing</span>
//  <motion.div
//  className="absolute left-0 top-0 bottom-0 w-1 rounded-r-lg"
//  style={{ backgroundColor: '#21C1B6' }}
//  initial={{ scaleY: 0 }}
//  whileHover={{ scaleY: 1 }}
//  transition={{ duration: 0.2 }}
//  />
//  </Link>

//  <Link
//  to="/aboutus"
//  className="group relative text-base text-gray-600 hover:text-gray-900 font-medium py-4 px-6 rounded-lg transition-all duration-300 hover:bg-gray-50 flex items-center"
//  >
//  <span className="relative z-10">About Us</span>
//  <motion.div
//  className="absolute left-0 top-0 bottom-0 w-1 rounded-r-lg"
//  style={{ backgroundColor: '#21C1B6' }}
//  initial={{ scaleY: 0 }}
//  whileHover={{ scaleY: 1 }}
//  transition={{ duration: 0.2 }}
//  />
//  </Link>
//  </div>

//  {/* Login Button */}
//  <motion.button
//  whileHover={{ scale: 1.05 }}
//  whileTap={{ scale: 0.95 }}
//  onClick={handleLogin}
//  className="w-full text-white text-base font-medium py-3 px-6 rounded-lg transition-all shadow-lg flex items-center justify-center"
//  style={{ backgroundColor: '#21C1B6' }}
//  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#1AA49B'}
//  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#21C1B6'}
//  >
//  Login
//  </motion.button>

//  {/* Decorative element */}
//  <motion.div
//  initial={{ opacity: 0 }}
//  animate={{ opacity: 1 }}
//  className="mt-8 h-1 rounded-full mx-auto"
//  style={{ backgroundColor: '#21C1B6', width: '60%' }}
//  transition={{
//  duration: 3,
//  repeat: Infinity,
//  ease: "easeInOut"
//  }}
//  />
//  </div>
//  </motion.nav>

//  {/* Overlay for mobile */}
//  {mobileSidebarOpen && (
//  <div
//  className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-30"
//  onClick={() => setMobileSidebarOpen(false)}
//  />
//  )}

//  {/* Main Content - Fixed margin for desktop */}
//  <div
//  className="transition-all lg:ml-[280px]"
//  >
//  {/* Animated background elements */}
//  <div className="fixed inset-0 overflow-hidden pointer-events-none">
//  <motion.div
//  className="absolute -top-40 -right-40 w-80 h-80 rounded-full blur-3xl opacity-20"
//  style={{ backgroundColor: '#21C1B6' }}
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
//  className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full blur-3xl opacity-20"
//  style={{ backgroundColor: '#21C1B6' }}
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

//  {/* Hero Section */}
//  <motion.header
//  ref={heroRef}
//  className="relative pt-32 overflow-hidden"
//  style={{
//  y: heroY,
//  opacity: heroOpacity,
//  background: 'linear-gradient(to bottom right, #f9fafb, #ffffff, #f0fffe)'
//  }}
//  >
//  <motion.div
//  className="container mx-auto text-center px-4 sm:px-6 lg:px-8 relative z-10"
//  variants={containerVariants}
//  initial="hidden"
//  animate={isHeroInView ? "visible" : "hidden"}
//  >
//  {/* Logo with glow effect */}
//  <motion.div
//  className="relative inline-flex items-center justify-center mb-8"
//  variants={itemVariants}
//  >
//  <motion.div
//  className="absolute w-40 h-40 lg:w-48 lg:h-48 rounded-xl blur-md opacity-20"
//  variants={glowVariants}
//  initial="initial"
//  animate="animate"
//  />
//  <motion.div
//  className="relative w-32 h-32 lg:w-40 lg:h-40 rounded-xl shadow-2xl flex items-center justify-center"
//  whileHover={{
//  scale: 1.05,
//  rotate: [0, -5, 5, 0],
//  transition: { duration: 0.3 }
//  }}
//  whileTap={{ scale: 0.95 }}
//  >
//  <img src={JuriNexGavelLogo} alt="JuriNex Logo" className="w-full h-full object-cover rounded-xl" />
//  <motion.div
//  className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent rounded-xl"
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
//  className="text-2xl sm:text-3xl lg:text-4xl font-semibold text-gray-700 mb-6"
//  variants={itemVariants}
//  >
//  Intelligent Assistant for Legal Professionals
//  </motion.h2>

//  <motion.p 
//  className="text-lg sm:text-xl text-gray-600 mb-10 max-w-3xl mx-auto leading-relaxed"
//  variants={itemVariants}
//  >
//  Work Faster, Practice Smarter<br/> with<br/> {' '}
//  <span className="font-semibold inline-flex items-center" style={{ color: '#21C1B6' }}>
//  Power of AI
//  </span>
//  </motion.p>

//  <motion.div 
//  className="flex flex-col sm:flex-row justify-center gap-4 items-center"
//  variants={itemVariants}
//  >

//  <motion.div
//  whileHover={{ scale: 1.05 }}
//  whileTap={{ scale: 0.98 }}
//  >
//  {/* <Link
//  to="/register"
//  className="group bg-white hover:bg-gray-50 text-gray-800 font-semibold py-3 px-8 rounded-lg text-base shadow-md border border-gray-300 hover:border-gray-400 inline-flex items-center transition-all duration-300"
//  >
//  <span>Register</span>
//  <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform duration-300" />
//  </Link> */}
//  </motion.div>
//  </motion.div>

//  {/* Floating elements */}
//  <motion.div 
//  className="absolute top-10 left-10 w-4 h-4 rounded-full opacity-30"
//  style={{ backgroundColor: '#21C1B6' }}
//  animate={{
//  y: [0, -20, 0],
//  x: [0, 10, 0]
//  }}
//  transition={{
//  duration: 4,
//  repeat: Infinity,
//  ease: "easeInOut"
//  }}
//  />
//  <motion.div 
//  className="absolute top-32 right-20 w-6 h-6 rounded-full opacity-20"
//  style={{ backgroundColor: '#21C1B6' }}
//  animate={{
//  y: [0, -30, 0],
//  x: [0, -15, 0]
//  }}
//  transition={{
//  duration: 5,
//  repeat: Infinity,
//  ease: "easeInOut",
//  delay: 1
//  }}
//  />
//  </motion.div>
//  </motion.header>

//  {/* How it Works Section */}
//  <motion.section 
//  ref={featuresRef}
//  className="pt-0 pb-20 bg-gradient-to-br from-white to-gray-50 relative overflow-hidden"
//  >
//  <div className="container mx-auto text-center px-4 sm:px-6 lg:px-8 relative z-10">
//  <motion.div
//  initial={{ opacity: 0, y: 30 }}
//  animate={isFeaturesInView ? { opacity: 1, y: 0 } : {}}
//  transition={{ duration: 0.6 }}
//  >
//  <motion.h2 
//  className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 mb-3"
//  whileHover={{ scale: 1.02 }}
//  >
//  How It Works
//  </motion.h2>
//  <motion.p 
//  className="text-base text-gray-600 mb-16 max-w-2xl mx-auto"
//  initial={{ opacity: 0 }}
//  animate={isFeaturesInView ? { opacity: 1 } : {}}
//  transition={{ delay: 0.2, duration: 0.6 }}
//  >
//  Three simple steps to transform the way you Work.
//  </motion.p>
//  </motion.div>

//  <motion.div 
//  className="grid grid-cols-1 md:grid-cols-3 gap-8"
//  variants={containerVariants}
//  initial="hidden"
//  animate={isFeaturesInView ? "visible" : "hidden"}
//  >
//  {/* Step 1 */}
//  <motion.div 
//  className="group relative"
//  variants={cardVariants}
//  whileHover={{ 
//  y: -10,
//  transition: { duration: 0.3 }
//  }}
//  >
//  <motion.div 
//  className="absolute inset-0 rounded-2xl blur-xl opacity-0 group-hover:opacity-20 transition-opacity duration-500"
//  style={{ backgroundColor: '#21C1B6' }}
//  animate={{
//  scale: [1, 1.05, 1]
//  }}
//  transition={{
//  duration: 2,
//  repeat: Infinity,
//  ease: "easeInOut"
//  }}
//  />
 
//  <div className="relative p-8 bg-white rounded-2xl shadow-lg border border-gray-100 group-hover:shadow-xl transition-all duration-500">
//  <motion.div 
//  className="relative inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6 shadow-lg"
//  style={{ backgroundColor: '#e0f7f6' }}
//  whileHover={{ 
//  rotate: [0, -10, 10, 0],
//  scale: 1.1
//  }}
//  transition={{ duration: 0.4 }}
//  >
//  <Upload className="w-8 h-8" style={{ color: '#21C1B6' }} />
//  <motion.div 
//  className="absolute inset-0 bg-gradient-to-br from-white/30 to-transparent rounded-2xl"
//  animate={{
//  opacity: [0, 0.5, 0]
//  }}
//  transition={{
//  duration: 2,
//  repeat: Infinity,
//  ease: "easeInOut",
//  delay: 0
//  }}
//  />
//  </motion.div>
 
//  <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-gray-900 transition-colors duration-300">
//  Upload Document
//  </h3>
//  <p className="text-sm text-gray-600 leading-relaxed group-hover:text-gray-700 transition-colors duration-300">
//  Securely upload your legal documents in various formats like PDF, DOCX, or TXT with enterprise-grade encryption.
//  </p>

//  {/* Step indicator */}
//  <motion.div 
//  className="absolute -top-3 -right-3 w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-lg"
//  style={{ backgroundColor: '#21C1B6' }}
//  initial={{ scale: 0, rotate: -180 }}
//  animate={isFeaturesInView ? { scale: 1, rotate: 0 } : {}}
//  transition={{ delay: 0.5, duration: 0.5 }}
//  >
//  1
//  </motion.div>
//  </div>
//  </motion.div>

//  {/* Step 2 */}
//  <motion.div 
//  className="group relative"
//  variants={cardVariants}
//  whileHover={{ 
//  y: -10,
//  transition: { duration: 0.3 }
//  }}
//  >
//  <motion.div 
//  className="absolute inset-0 rounded-2xl blur-xl opacity-0 group-hover:opacity-20 transition-opacity duration-500"
//  style={{ backgroundColor: '#21C1B6' }}
//  animate={{
//  scale: [1, 1.05, 1]
//  }}
//  transition={{
//  duration: 2,
//  repeat: Infinity,
//  ease: "easeInOut",
//  delay: 0.7
//  }}
//  />
 
//  <div className="relative p-8 bg-white rounded-2xl shadow-lg border border-gray-100 group-hover:shadow-xl transition-all duration-500">
//  <motion.div 
//  className="relative inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6 shadow-lg"
//  style={{ backgroundColor: '#e0f7f6' }}
//  whileHover={{ 
//  rotate: [0, 180, 360],
//  scale: 1.1
//  }}
//  transition={{ duration: 0.8 }}
//  >
//  <Cpu className="w-8 h-8" style={{ color: '#21C1B6' }} />
//  <motion.div 
//  className="absolute inset-0 bg-gradient-to-br from-white/30 to-transparent rounded-2xl"
//  animate={{
//  opacity: [0, 0.5, 0]
//  }}
//  transition={{
//  duration: 2,
//  repeat: Infinity,
//  ease: "easeInOut",
//  delay: 0.7
//  }}
//  />
//  </motion.div>
 
//  <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-gray-900 transition-colors duration-300">
//  AI-Powered Analysis
//  </h3>
//  <p className="text-sm text-gray-600 leading-relaxed group-hover:text-gray-700 transition-colors duration-300">
//  Advanced machine learning algorithms analyze content, identifying key legal points, clauses, and critical insights.
//  </p>

//  {/* Step indicator */}
//  <motion.div 
//  className="absolute -top-3 -right-3 w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-lg"
//  style={{ backgroundColor: '#21C1B6' }}
//  initial={{ scale: 0, rotate: -180 }}
//  animate={isFeaturesInView ? { scale: 1, rotate: 0 } : {}}
//  transition={{ delay: 0.7, duration: 0.5 }}
//  >
//  2
//  </motion.div>
//  </div>
//  </motion.div>

//  {/* Step 3 */}
//  <motion.div 
//  className="group relative"
//  variants={cardVariants}
//  whileHover={{ 
//  y: -10,
//  transition: { duration: 0.3 }
//  }}
//  >
//  <motion.div 
//  className="absolute inset-0 rounded-2xl blur-xl opacity-0 group-hover:opacity-20 transition-opacity duration-500"
//  style={{ backgroundColor: '#21C1B6' }}
//  animate={{
//  scale: [1, 1.05, 1]
//  }}
//  transition={{
//  duration: 2,
//  repeat: Infinity,
//  ease: "easeInOut",
//  delay: 1.4
//  }}
//  />
 
//  <div className="relative p-8 bg-white rounded-2xl shadow-lg border border-gray-100 group-hover:shadow-xl transition-all duration-500">
//  <motion.div 
//  className="relative inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6 shadow-lg"
//  style={{ backgroundColor: '#e0f7f6' }}
//  whileHover={{ 
//  scale: [1, 1.2, 1],
//  rotate: [0, 10, -10, 0]
//  }}
//  transition={{ duration: 0.6 }}
//  >
//  <CheckCircle className="w-8 h-8" style={{ color: '#21C1B6' }} />
//  <motion.div 
//  className="absolute inset-0 bg-gradient-to-br from-white/30 to-transparent rounded-2xl"
//  animate={{
//  opacity: [0, 0.5, 0]
//  }}
//  transition={{
//  duration: 2,
//  repeat: Infinity,
//  ease: "easeInOut",
//  delay: 1.4
//  }}
//  />
//  </motion.div>
 
//  <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-gray-900 transition-colors duration-300">
//  Receive Summary
//  </h3>
//  <p className="text-sm text-gray-600 leading-relaxed group-hover:text-gray-700 transition-colors duration-300">
//  Get comprehensive, easy-to-understand summaries with actionable insights, saving hours of manual review.
//  </p>

//  {/* Step indicator */}
//  <motion.div 
//  className="absolute -top-3 -right-3 w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-lg"
//  style={{ backgroundColor: '#21C1B6' }}
//  initial={{ scale: 0, rotate: -180 }}
//  animate={isFeaturesInView ? { scale: 1, rotate: 0 } : {}}
//  transition={{ delay: 0.9, duration: 0.5 }}
//  >
//  3
//  </motion.div>
//  </div>
//  </motion.div>
//  </motion.div>
//  </div>

//  {/* Background decoration */}
//  <motion.div 
//  className="absolute top-20 right-10 w-32 h-32 rounded-full opacity-10 blur-2xl"
//  style={{ backgroundColor: '#21C1B6' }}
//  animate={{
//  scale: [1, 1.2, 1],
//  opacity: [0.1, 0.2, 0.1]
//  }}
//  transition={{
//  duration: 4,
//  repeat: Infinity,
//  ease: "easeInOut"
//  }}
//  />
//  </motion.section>

//  {/* Benefits Section */}
//  <motion.section 
//  ref={benefitsRef}
//  className="py-20 bg-white"
//  >
//  <div className="container mx-auto px-4 sm:px-6 lg:px-8">
//  <motion.div
//  className="text-center mb-16"
//  initial={{ opacity: 0, y: 30 }}
//  animate={isBenefitsInView ? { opacity: 1, y: 0 } : {}}
//  >
//  <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 mb-3">
//  Why Choose JuriNex<span className="text-xs font-normal text-gray-500 align-top">™</span>?
//  </h2>
//  <p className="text-base text-gray-600 max-w-2xl mx-auto">
//  Powerful features designed for legal professionals
//  </p>
// {/* <div className="space-y-3">
//  <span className="block mt-4 text-base text-black leading-relaxed">
//  <span className="text-green-500 mr-2 text-lg">✔</span>
//  <strong className="text-lg font-semibold">Speed You Can Trust</strong> – Get summaries or draft petitions in minutes, not hours.
//  </span>

//  <span className="block mt-4 text-base text-black leading-relaxed">
//  <span className="text-green-500 mr-2 text-lg">✔</span>
//  <strong className="text-lg font-semibold">Clarity From Chaos</strong> – Turn messy PDFs and files into structured insights.
//  </span>

//  <span className="block mt-4 text-base text-black leading-relaxed">
//  <span className="text-green-500 mr-2 text-lg">✔</span>
//  <strong className="text-lg font-semibold">Accuracy</strong> – Aligned with Indian laws, languages, and legal logic.
//  </span>

//  <span className="block mt-4 text-base text-black leading-relaxed">
//  <span className="text-green-500 mr-2 text-lg">✔</span>
//  <strong className="text-lg font-semibold">Multilingual Mastery</strong> – Works seamlessly in all Indian languages.
//  </span>

//  <span className="block mt-4 text-base text-black leading-relaxed">
//  <span className="text-green-500 mr-2 text-lg">✔</span>
//  <strong className="text-lg font-semibold">AI That Understands Law</strong> – Purpose-built for lawyers, paralegals, and judges.
//  </span>
// </div> */}

// <div className="flex flex-col items-center justify-center text-center mt-8 space-y-4 text-black">
//  <ul className="list-disc text-left space-y-3 max-w-2xl">
//  <li className="text-base leading-relaxed">
//  <strong className="text-lg font-semibold">Speed You Can Trust:</strong> Get summaries or draft petitions in minutes, not hours.
//  </li>

//  <li className="text-base leading-relaxed">
//  <strong className="text-lg font-semibold">Clarity From Chaos:</strong> Turn messy PDFs and files into structured insights.
//  </li>

//  <li className="text-base leading-relaxed">
//  <strong className="text-lg font-semibold">Accuracy:</strong> Aligned with Indian laws, languages, and legal logic.
//  </li>

//  <li className="text-base leading-relaxed">
//  <strong className="text-lg font-semibold">Multilingual Mastery:</strong> Works seamlessly in all Indian languages.
//  </li>

//  <li className="text-base leading-relaxed">
//  <strong className="text-lg font-semibold">AI That Understands Law:</strong> Purpose-built for lawyers, paralegals, and judges.
//  </li>
//  </ul>
// </div>



// </motion.div>

// <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
//  <motion.div
//  className="bg-white p-6 rounded-xl shadow-md border border-gray-100 hover:shadow-lg transition-shadow"
//  initial={{ opacity: 0, y: 20 }}
//  animate={isBenefitsInView ? { opacity: 1, y: 0 } : {}}
//  transition={{ delay: 0.1 }}
//  >
//  <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-4" style={{ backgroundColor: '#e0f7f6' }}>
//  <Zap className="w-6 h-6" style={{ color: '#21C1B6' }} />
//  </div>
//  <h3 className="text-lg font-bold text-gray-900 mb-2">Lightning Fast</h3>
//  <p className="text-sm text-gray-600">Process documents in seconds, not hours</p>
//  </motion.div>

//  <motion.div
//  className="bg-white p-6 rounded-xl shadow-md border border-gray-100 hover:shadow-lg transition-shadow"
//  initial={{ opacity: 0, y: 20 }}
//  animate={isBenefitsInView ? { opacity: 1, y: 0 } : {}}
//  transition={{ delay: 0.2 }}
//  >
//  <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-4" style={{ backgroundColor: '#e0f7f6' }}>
//  <Lock className="w-6 h-6" style={{ color: '#21C1B6' }} />
//  </div>
//  <h3 className="text-lg font-bold text-gray-900 mb-2">Secure & Private</h3>
//  <p className="text-sm text-gray-600">Enterprise-grade security for your sensitive data</p>
//  </motion.div>

//  <motion.div
//  className="bg-white p-6 rounded-xl shadow-md border border-gray-100 hover:shadow-lg transition-shadow"
//  initial={{ opacity: 0, y: 20 }}
//  animate={isBenefitsInView ? { opacity: 1, y: 0 } : {}}
//  transition={{ delay: 0.3 }}
//  >
//  <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-4" style={{ backgroundColor: '#e0f7f6' }}>
//  <TrendingUp className="w-6 h-6" style={{ color: '#21C1B6' }} />
//  </div>
//  <h3 className="text-lg font-bold text-gray-900 mb-2">Highly Accurate</h3>
//  <p className="text-sm text-gray-600">AI trained on millions of legal documents</p>
//  </motion.div>
// </div>
//  </div>
//  </motion.section>

//  {/* CTA Section */}
//  <section className="py-20" style={{ backgroundColor: '#21C1B6' }}>
//  <div className="container mx-auto text-center px-4 sm:px-6 lg:px-8">
//  <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
//  Ready to Transform Your Legal Workflow?
//  </h2>
//  <p className="text-lg text-white/95 mb-8 max-w-2xl mx-auto">
//  Join thousands of legal professionals who trust JuriNex<span className="text-xs align-top">™</span>
//  </p>
//  <motion.div
//  className="flex flex-col sm:flex-row justify-center gap-4 items-center"
//  variants={itemVariants}
//  >
//  <motion.div
//  whileHover={{ scale: 1.05 }}
//  whileTap={{ scale: 0.98 }}
//  >
//  <button
//  className="group relative text-white font-semibold py-3 px-8 rounded-lg text-base shadow-lg inline-flex items-center overflow-hidden transition-all duration-300"
//  style={{ backgroundColor: '#21C1B6' }}
//  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#1AA49B'}
//  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#21C1B6'}
//  >
//  <FileText className="w-5 h-5 mr-2 group-hover:rotate-12 transition-transform duration-300" />
//  <span className="relative z-10">Product Demo</span>
//  <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform duration-300" />
//  </button>
//  </motion.div>
//  <motion.div
//  whileHover={{ scale: 1.05 }}
//  whileTap={{ scale: 0.95 }}
//  >
//  <button
//  onClick={handleRegister}
//  className="bg-white font-semibold py-3 px-8 rounded-lg text-base shadow-xl hover:bg-gray-50 transition-colors inline-flex items-center"
//  style={{ color: '#21C1B6' }}
//  >
//  <span>Start Free Trial</span>
//  <ArrowRight className="w-5 h-5 ml-2" />
//  </button>
//  </motion.div>
//  </motion.div>
//  </div>
//  </section>

//  {/* Footer */}
//  {/* <footer className="bg-gray-900 text-gray-300 py-12">
//  <div className="container mx-auto px-4 sm:px-6 lg:px-8">
//  <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
//  <div>
//  <div className="flex items-center mb-4">
//  <div className="flex items-center">
//  <span className="text-teal-500 text-2xl font-bold" style={{ color: '#21C1B6' }}>Juri</span>
//  <span className="text-white text-2xl font-bold relative">
//  Nex
//  <span className="absolute text-xs font-normal text-gray-400" style={{ 
//  top: '0', 
//  right: '-0.5em'
//  }}>™</span>
//  </span>
//  </div>
//  </div>
//  <p className="text-gray-400 text-sm leading-relaxed">
//  Transforming legal workflows with AI-powered intelligence.
//  </p>
//  </div>

//  <div>
//  <h4 className="text-white font-semibold mb-4 text-sm">Quick Links</h4>
//  <ul className="space-y-2 text-sm">
//  <li><Link to="/" className="text-gray-400 hover:text-white transition-colors">Home</Link></li>
//  <li><Link to="/services" className="text-gray-400 hover:text-white transition-colors">Services</Link></li>
//  <li><Link to="/pricing" className="text-gray-400 hover:text-white transition-colors">Pricing</Link></li>
//  </ul>
//  </div>

//  <div>
//  <h4 className="text-white font-semibold mb-4 text-sm">Contact Us</h4>
//  <p className="text-sm text-gray-400 leading-relaxed">
//  B-11, near Railway Station Road,<br />
//  MIDC Chikalthana,<br />
//  Aurangabad
//  </p>
//  </div>

//  <div>
//  <h4 className="text-white font-semibold mb-4 text-sm">Legal</h4>
//  <ul className="space-y-2 text-sm">
//  <li><a href="#" className="text-gray-400 hover:text-white transition-colors">Terms of Use</a></li>
//  <li><a href="#" className="text-gray-400 hover:text-white transition-colors">Privacy Policy</a></li>
//  </ul>
//  </div>
//  </div>

//  <div className="border-t border-gray-800 mt-8 pt-8 text-center text-sm text-gray-400">
//  <p>&copy; 2025 JuriNex<span className="text-xs align-top"></span>. All rights reserved.</p>
//  </div>
//  </div>
//  </footer> */}


//  <Footer/>
//  </div>
//  </div>
//  );
// };

// export default LandingPage;




import React, { useRef, useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileText, Upload, Cpu, CheckCircle, Sparkles, ArrowRight, Zap, Lock, TrendingUp, Clock, FileSearch, Target, Globe, Brain } from 'lucide-react';
import JuriNexGavelLogo from '../assets/JuriNex_gavel_logo.png';
import law01 from '../assets/law01.png'; // Import the background image
import { motion, useScroll, useTransform, useInView } from 'framer-motion';
import Footer from '../components/Footer';
import PublicHeader from '../components/PublicHeader'; // Import the new PublicHeader

const LandingPage = () => {
 const navigate = useNavigate();
 const { scrollY } = useScroll();
 const heroRef = useRef(null);
 const featuresRef = useRef(null);
 const benefitsRef = useRef(null);
 const isHeroInView = useInView(heroRef, { once: true });
 const isFeaturesInView = useInView(featuresRef, { once: true });
 const isBenefitsInView = useInView(benefitsRef, { once: true });
 
 // Navigation handlers
 const handleRegister = () => {
 navigate('/register');
 };

 // Parallax effects
 const heroY = useTransform(scrollY, [0, 500], [0, -50]);
 const heroOpacity = useTransform(scrollY, [0, 300], [1, 0.8]);

 // Animation variants
 const containerVariants = {
 hidden: { opacity: 0 },
 visible: {
 opacity: 1,
 transition: {
 staggerChildren: 0.15,
 delayChildren: 0.1
 }
 }
 };

 const itemVariants = {
 hidden: {
 opacity: 0,
 y: 30,
 scale: 0.95
 },
 visible: {
 opacity: 1,
 y: 0,
 scale: 1,
 transition: {
 duration: 0.6,
 ease: [0.25, 0.46, 0.45, 0.94]
 }
 }
 };

 const cardVariants = {
 hidden: {
 opacity: 0,
 y: 50,
 rotateX: -15
 },
 visible: {
 opacity: 1,
 y: 0,
 rotateX: 0,
 transition: {
 duration: 0.7,
 ease: [0.25, 0.46, 0.45, 0.94]
 }
 }
 };

 const glowVariants = {
 initial: { scale: 1, opacity: 0.7 },
 animate: {
 scale: [1, 1.2, 1],
 opacity: [0.7, 1, 0.7],
 transition: {
 duration: 3,
 repeat: Infinity,
 ease: "easeInOut"
 }
 }
 };

 return (
 <div className="min-h-screen bg-white">
 <PublicHeader /> {/* Add the new PublicHeader component */}

 {/* Main Content - No fixed margin needed as sidebar is removed */}
 <div className="transition-all">
 {/* Animated background elements */}
 <div className="fixed inset-0 overflow-hidden pointer-events-none">
 <motion.div
 className="absolute -top-40 -right-40 w-80 h-80 rounded-full blur-3xl opacity-20"
 style={{ backgroundColor: '#21C1B6' }}
 animate={{
 scale: [1, 1.1, 1],
 rotate: [0, 180, 360]
 }}
 transition={{
 duration: 20,
 repeat: Infinity,
 ease: "linear"
 }}
 />
 <motion.div
 className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full blur-3xl opacity-20"
 style={{ backgroundColor: '#21C1B6' }}
 animate={{
 scale: [1, 1.2, 1],
 rotate: [360, 180, 0]
 }}
 transition={{
 duration: 25,
 repeat: Infinity,
 ease: "linear"
 }}
 />
 </div>

 {/* Hero Section */}
 <motion.header
 ref={heroRef}
 className="relative pb-20 overflow-hidden bg-cover bg-center bg-no-repeat flex items-center justify-center min-h-screen"
 style={{
 y: heroY,
 opacity: heroOpacity,
 backgroundImage: `url(${law01})`,
 }}
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 transition={{ duration: 1.5, ease: "easeOut" }}
 >
 <div className="absolute inset-0 bg-white opacity-40"></div> {/* Subtle white overlay */}
 <motion.div
 className="container mx-auto text-center px-4 sm:px-6 lg:px-8 relative z-10"
 variants={containerVariants}
 initial="hidden"
 animate={isHeroInView ? "visible" : "hidden"}
 >
 {/* Logo with glow effect */}
 <motion.div
 className="relative inline-flex items-center justify-center mb-8"
 variants={itemVariants}
 >
 <motion.div
 className="absolute w-40 h-40 lg:w-48 lg:h-48 rounded-xl blur-md opacity-20"
 variants={glowVariants}
 initial="initial"
 animate="animate"
 />
 <motion.div
 className="relative w-32 h-32 lg:w-40 lg:h-40 rounded-xl shadow-2xl flex items-center justify-center"
 whileHover={{
 scale: 1.05,
 rotate: [0, -5, 5, 0],
 transition: { duration: 0.3 }
 }}
 whileTap={{ scale: 0.95 }}
 >
 <img src={JuriNexGavelLogo} alt="JuriNex Logo" className="w-full h-full object-cover rounded-xl" />
 <motion.div
 className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent rounded-xl"
 animate={{
 opacity: [0, 0.3, 0]
 }}
 transition={{
 duration: 2,
 repeat: Infinity,
 ease: "easeInOut"
 }}
 />
 </motion.div>
 </motion.div>

 <motion.h2
 className="text-2xl sm:text-3xl lg:text-4xl font-semibold text-black mb-6"
 variants={itemVariants}
 >
 Intelligent Assistant for Legal Professionals
 </motion.h2>

 <motion.p
 className="text-lg sm:text-xl text-[#021b1a] mb-10 max-w-3xl mx-auto leading-relaxed"

 variants={itemVariants}
 >
 Work Faster, Practice Smarter<br/> with<br/> {' '}
 <span className="font-semibold inline-flex items-center" style={{ color: '#021b1aff' }}>
 Power of AI
 </span>
 </motion.p>

 <motion.div
 className="flex flex-col sm:flex-row justify-center gap-4 items-center"
 variants={itemVariants}
 >
 </motion.div>

 {/* Floating elements */}
 <motion.div
 className="absolute top-10 left-10 w-4 h-4 rounded-full opacity-30"
 style={{ backgroundColor: '#21C1B6' }}
 animate={{
 y: [0, -20, 0],
 x: [0, 10, 0]
 }}
 transition={{
 duration: 4,
 repeat: Infinity,
 ease: "easeInOut"
 }}
 />
 <motion.div
 className="absolute top-32 right-20 w-6 h-6 rounded-full opacity-20"
 style={{ backgroundColor: '#21C1B6' }}
 animate={{
 y: [0, -30, 0],
 x: [0, -15, 0]
 }}
 transition={{
 duration: 5,
 repeat: Infinity,
 ease: "easeInOut",
 delay: 1
 }}
 />
 </motion.div>
 </motion.header>

 {/* How it Works Section */}
 <motion.section
 ref={featuresRef}
 className="pt-0 pb-20 bg-gradient-to-br from-white to-gray-50 relative overflow-hidden"
 >
 <div className="container mx-auto text-center px-4 sm:px-6 lg:px-8 relative z-10">
 <motion.div
 initial={{ opacity: 0, y: 30 }}
 animate={isFeaturesInView ? { opacity: 1, y: 0 } : {}}
 transition={{ duration: 0.6 }}
 >
 <motion.h2
 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 mb-3"
 whileHover={{ scale: 1.02 }}
 >
 How It Works
 </motion.h2>
 <motion.p
 className="text-base text-gray-600 mb-16 max-w-2xl mx-auto"
 initial={{ opacity: 0 }}
 animate={isFeaturesInView ? { opacity: 1 } : {}}
 transition={{ delay: 0.2, duration: 0.6 }}
 >
 Three simple steps to transform the way you Work.
 </motion.p>
 </motion.div>

 <motion.div
 className="grid grid-cols-1 md:grid-cols-3 gap-8"
 variants={containerVariants}
 initial="hidden"
 animate={isFeaturesInView ? "visible" : "hidden"}
 >
 {/* Step 1 */}
 <motion.div
 className="group relative"
 variants={cardVariants}
 whileHover={{
 y: -10,
 transition: { duration: 0.3 }
 }}
 >
 <motion.div
 className="absolute inset-0 rounded-2xl blur-xl opacity-0 group-hover:opacity-20 transition-opacity duration-500"
 style={{ backgroundColor: '#21C1B6' }}
 animate={{
 scale: [1, 1.05, 1]
 }}
 transition={{
 duration: 2,
 repeat: Infinity,
 ease: "easeInOut"
 }}
 />
 
 <div className="relative p-8 bg-white rounded-2xl shadow-lg border border-gray-100 group-hover:shadow-xl transition-all duration-500">
 <motion.div
 className="relative inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6 shadow-lg"
 style={{ backgroundColor: '#e0f7f6' }}
 whileHover={{
 rotate: [0, -10, 10, 0],
 scale: 1.1
 }}
 transition={{ duration: 0.4 }}
 >
 <Upload className="w-8 h-8" style={{ color: '#21C1B6' }} />
 <motion.div
 className="absolute inset-0 bg-gradient-to-br from-white/30 to-transparent rounded-2xl"
 animate={{
 opacity: [0, 0.5, 0]
 }}
 transition={{
 duration: 2,
 repeat: Infinity,
 ease: "easeInOut",
 delay: 0
 }}
 />
 </motion.div>
 
 <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-gray-900 transition-colors duration-300">
 Upload Document
 </h3>
 <p className="text-sm text-gray-600 leading-relaxed group-hover:text-gray-700 transition-colors duration-300">
 Securely upload your legal documents in various formats like PDF, DOCX, or TXT with enterprise-grade encryption.
 </p>

 {/* Step indicator */}
 <motion.div
 className="absolute -top-3 -right-3 w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-lg"
 style={{ backgroundColor: '#21C1B6' }}
 initial={{ scale: 0, rotate: -180 }}
 animate={isFeaturesInView ? { scale: 1, rotate: 0 } : {}}
 transition={{ delay: 0.5, duration: 0.5 }}
 >
 1
 </motion.div>
 </div>
 </motion.div>

 {/* Step 2 */}
 <motion.div
 className="group relative"
 variants={cardVariants}
 whileHover={{
 y: -10,
 transition: { duration: 0.3 }
 }}
 >
 <motion.div
 className="absolute inset-0 rounded-2xl blur-xl opacity-0 group-hover:opacity-20 transition-opacity duration-500"
 style={{ backgroundColor: '#21C1B6' }}
 animate={{
 scale: [1, 1.05, 1]
 }}
 transition={{
 duration: 2,
 repeat: Infinity,
 ease: "easeInOut",
 delay: 0.7
 }}
 />
 
 <div className="relative p-8 bg-white rounded-2xl shadow-lg border border-gray-100 group-hover:shadow-xl transition-all duration-500">
 <motion.div
 className="relative inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6 shadow-lg"
 style={{ backgroundColor: '#e0f7f6' }}
 whileHover={{
 rotate: [0, 180, 360],
 scale: 1.1
 }}
 transition={{ duration: 0.8 }}
 >
 <Cpu className="w-8 h-8" style={{ color: '#21C1B6' }} />
 <motion.div
 className="absolute inset-0 bg-gradient-to-br from-white/30 to-transparent rounded-2xl"
 animate={{
 opacity: [0, 0.5, 0]
 }}
 transition={{
 duration: 2,
 repeat: Infinity,
 ease: "easeInOut",
 delay: 0.7
 }}
 />
 </motion.div>
 
 <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-gray-900 transition-colors duration-300">
 AI-Powered Analysis
 </h3>
 <p className="text-sm text-gray-600 leading-relaxed group-hover:text-gray-700 transition-colors duration-300">
 Advanced machine learning algorithms analyze content, identifying key legal points, clauses, and critical insights.
 </p>

 {/* Step indicator */}
 <motion.div
 className="absolute -top-3 -right-3 w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-lg"
 style={{ backgroundColor: '#21C1B6' }}
 initial={{ scale: 0, rotate: -180 }}
 animate={isFeaturesInView ? { scale: 1, rotate: 0 } : {}}
 transition={{ delay: 0.7, duration: 0.5 }}
 >
 2
 </motion.div>
 </div>
 </motion.div>

 {/* Step 3 */}
 <motion.div
 className="group relative"
 variants={cardVariants}
 whileHover={{
 y: -10,
 transition: { duration: 0.3 }
 }}
 >
 <motion.div
 className="absolute inset-0 rounded-2xl blur-xl opacity-0 group-hover:opacity-20 transition-opacity duration-500"
 style={{ backgroundColor: '#21C1B6' }}
 animate={{
 scale: [1, 1.05, 1]
 }}
 transition={{
 duration: 2,
 repeat: Infinity,
 ease: "easeInOut",
 delay: 1.4
 }}
 />
 
 <div className="relative p-8 bg-white rounded-2xl shadow-lg border border-gray-100 group-hover:shadow-xl transition-all duration-500">
 <motion.div
 className="relative inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6 shadow-lg"
 style={{ backgroundColor: '#e0f7f6' }}
 whileHover={{
 scale: [1, 1.2, 1],
 rotate: [0, 10, -10, 0]
 }}
 transition={{ duration: 0.6 }}
 >
 <CheckCircle className="w-8 h-8" style={{ color: '#21C1B6' }} />
 <motion.div
 className="absolute inset-0 bg-gradient-to-br from-white/30 to-transparent rounded-2xl"
 animate={{
 opacity: [0, 0.5, 0]
 }}
 transition={{
 duration: 2,
 repeat: Infinity,
 ease: "easeInOut",
 delay: 1.4
 }}
 />
 </motion.div>
 
 <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-gray-900 transition-colors duration-300">
 Receive Summary
 </h3>
 <p className="text-sm text-gray-600 leading-relaxed group-hover:text-gray-700 transition-colors duration-300">
 Get comprehensive, easy-to-understand summaries with actionable insights, saving hours of manual review.
 </p>

 {/* Step indicator */}
 <motion.div
 className="absolute -top-3 -right-3 w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-lg"
 style={{ backgroundColor: '#21C1B6' }}
 initial={{ scale: 0, rotate: -180 }}
 animate={isFeaturesInView ? { scale: 1, rotate: 0 } : {}}
 transition={{ delay: 0.9, duration: 0.5 }}
 >
 3
 </motion.div>
 </div>
 </motion.div>
 </motion.div>
 </div>

 {/* Background decoration */}
 <motion.div
 className="absolute top-20 right-10 w-32 h-32 rounded-full opacity-10 blur-2xl"
 style={{ backgroundColor: '#21C1B6' }}
 animate={{
 scale: [1, 1.2, 1],
 opacity: [0.1, 0.2, 0.1]
 }}
 transition={{
 duration: 4,
 repeat: Infinity,
 ease: "easeInOut"
 }}
 />
 </motion.section>

 {/* Benefits Section */}
 <motion.section
 ref={benefitsRef}
 className="py-20 bg-white"
 >
 <div className="container mx-auto px-4 sm:px-6 lg:px-8">
 <motion.div
 className="text-center mb-16"
 initial={{ opacity: 0, y: 30 }}
 animate={isBenefitsInView ? { opacity: 1, y: 0 } : {}}
 >
 <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 mb-3">
 Why Choose JuriNex<span className="text-xs font-normal text-gray-500 align-top">™</span>?
 </h2>
 <p className="text-base text-gray-600 max-w-2xl mx-auto">
 Powerful features designed for legal professionals
 </p>

 <div className="flex flex-col items-center justify-center text-center mt-8 space-y-4 text-black">
 <ul className="list-disc text-left space-y-3 max-w-2xl">
 <li className="text-base leading-relaxed">
 <strong className="text-lg font-semibold">Speed You Can Trust:</strong> Get summaries or draft petitions in minutes, not hours.
 </li>

 <li className="text-base leading-relaxed">
 <strong className="text-lg font-semibold">Clarity From Chaos:</strong> Turn messy PDFs and files into structured insights.
 </li>

 <li className="text-base leading-relaxed">
 <strong className="text-lg font-semibold">Accuracy:</strong> Aligned with Indian laws, languages, and legal logic.
 </li>

 <li className="text-base leading-relaxed">
 <strong className="text-lg font-semibold">Multilingual Mastery:</strong> Works seamlessly in all Indian languages.
 </li>

 <li className="text-base leading-relaxed">
 <strong className="text-lg font-semibold">AI That Understands Law:</strong> Purpose-built for lawyers, paralegals, and judges.
 </li>
 </ul>
 </div>
 </motion.div>

 <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
 <motion.div
 className="bg-white p-6 rounded-xl shadow-md border border-gray-100 hover:shadow-lg transition-shadow"
 initial={{ opacity: 0, y: 20 }}
 animate={isBenefitsInView ? { opacity: 1, y: 0 } : {}}
 transition={{ delay: 0.1 }}
 >
 <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-4" style={{ backgroundColor: '#e0f7f6' }}>
 <Zap className="w-6 h-6" style={{ color: '#21C1B6' }} />
 </div>
 <h3 className="text-lg font-bold text-gray-900 mb-2">Lightning Fast</h3>
 <p className="text-sm text-gray-600">Process documents in seconds, not hours</p>
 </motion.div>

 <motion.div
 className="bg-white p-6 rounded-xl shadow-md border border-gray-100 hover:shadow-lg transition-shadow"
 initial={{ opacity: 0, y: 20 }}
 animate={isBenefitsInView ? { opacity: 1, y: 0 } : {}}
 transition={{ delay: 0.2 }}
 >
 <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-4" style={{ backgroundColor: '#e0f7f6' }}>
 <Lock className="w-6 h-6" style={{ color: '#21C1B6' }} />
 </div>
 <h3 className="text-lg font-bold text-gray-900 mb-2">Secure & Private</h3>
 <p className="text-sm text-gray-600">Enterprise-grade security for your sensitive data</p>
 </motion.div>

 <motion.div
 className="bg-white p-6 rounded-xl shadow-md border border-gray-100 hover:shadow-lg transition-shadow"
 initial={{ opacity: 0, y: 20 }}
 animate={isBenefitsInView ? { opacity: 1, y: 0 } : {}}
 transition={{ delay: 0.3 }}
 >
 <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-4" style={{ backgroundColor: '#e0f7f6' }}>
 <TrendingUp className="w-6 h-6" style={{ color: '#21C1B6' }} />
 </div>
 <h3 className="text-lg font-bold text-gray-900 mb-2">Highly Accurate</h3>
 <p className="text-sm text-gray-600">AI trained on millions of legal documents</p>
 </motion.div>
 </div>
 </div>
 </motion.section>

 {/* CTA Section */}
 <section className="py-20" style={{ backgroundColor: '#21C1B6' }}>
 <div className="container mx-auto text-center px-4 sm:px-6 lg:px-8">
 <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
 Ready to Transform Your Legal Workflow?
 </h2>
 <p className="text-lg text-white/95 mb-8 max-w-2xl mx-auto">
 Join thousands of legal professionals who trust JuriNex<span className="text-xs align-top">™</span>
 </p>
 <motion.div
 className="flex flex-col sm:flex-row justify-center gap-4 items-center"
 variants={itemVariants}
 >
 <motion.div
 whileHover={{ scale: 1.05 }}
 whileTap={{ scale: 0.98 }}
 >
 <button
 className="group relative text-white font-semibold py-3 px-8 rounded-lg text-base shadow-lg inline-flex items-center overflow-hidden transition-all duration-300"
 style={{ backgroundColor: '#21C1B6' }}
 onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#1AA49B'}
 onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#21C1B6'}
 >
 <FileText className="w-5 h-5 mr-2 group-hover:rotate-12 transition-transform duration-300" />
 <span className="relative z-10">Product Demo</span>
 <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform duration-300" />
 </button>
 </motion.div>
 <motion.div
 whileHover={{ scale: 1.05 }}
 whileTap={{ scale: 0.95 }}
 >
 <button
 onClick={handleRegister}
 className="bg-white font-semibold py-3 px-8 rounded-lg text-base shadow-xl hover:bg-gray-50 transition-colors inline-flex items-center"
 style={{ color: '#21C1B6' }}
 >
 <span>Start Free Trial</span>
 <ArrowRight className="w-5 h-5 ml-2" />
 </button>
 </motion.div>
 </motion.div>
 </div>
 </section>

 <Footer/>
 </div>
 </div>
 );
};

export default LandingPage;


