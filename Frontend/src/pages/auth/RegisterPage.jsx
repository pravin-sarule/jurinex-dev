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

 const LogoComponent = ({ size = "w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16" }) => {
 if (logoError) {
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
 <div className="w-full lg:w-1/2 bg-white flex items-center justify-center p-4 sm:p-6 md:p-8 lg:p-12">
 <div className="max-w-md w-full">
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

 <div className="space-y-3 sm:space-y-4">
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

 <div className="mt-4 sm:mt-6 text-center">
 <p className="text-xs sm:text-sm text-gray-600">
 Already have an account?{' '}
 <button onClick={handleLoginClick} className="font-semibold text-gray-900 hover:underline">
 Login
 </button>
 </p>

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

 <div className="w-full lg:w-1/2 relative overflow-hidden">
 <div className="absolute inset-0 w-full h-full">
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
 
 <div className="absolute inset-0">
 <div className="absolute top-16 right-16 w-40 h-40 md:w-48 md:h-48 lg:w-56 lg:h-56 xl:w-64 xl:h-64 rounded-full blur-3xl opacity-30" style={{ backgroundColor: '#1AA49B' }}></div>
 <div className="absolute bottom-16 left-16 w-40 h-40 md:w-48 md:h-48 lg:w-56 lg:h-56 xl:w-64 xl:h-64 bg-blue-500 rounded-full blur-3xl opacity-20"></div>
 <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-32 h-32 md:w-40 md:h-40 lg:w-48 lg:h-48 bg-gradient-to-br from-blue-400 to-purple-600 rounded-full blur-2xl opacity-10"></div>
 </div>
 
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
 
 <div className="absolute inset-0 z-10 flex flex-col justify-between p-6 md:p-8 lg:p-10 xl:p-12 text-white">
 <div className="flex-1 flex items-start justify-center lg:items-start pt-4 lg:pt-8">
 </div>
 
 <div className="w-full max-w-md lg:max-w-lg xl:max-w-xl">
 <h2 className="text-2xl md:text-3xl lg:text-4xl xl:text-5xl font-bold mb-4 md:mb-6 lg:mb-8 leading-tight text-center lg:text-left">
 Automate Your Legal Workflow in Minutes
 </h2>
 
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