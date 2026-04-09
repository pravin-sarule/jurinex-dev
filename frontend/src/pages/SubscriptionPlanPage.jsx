import React, { useState, useEffect, useCallback } from 'react';
import { CheckIcon } from '@heroicons/react/20/solid';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { useNavigate, useLocation } from 'react-router-dom';
import apiService from '../services/api';
import { useAuth } from '../context/AuthContext';

import { PAYMENT_SERVICE_URL } from '../config/apiConfig';
const BACKEND_BASE_URL = PAYMENT_SERVICE_URL;

console.log('Environment variables:', { BACKEND_BASE_URL });

const LANDING_PLAN_CONFIG = [
 { id: 'enterprise', name: 'Enterprise', description: 'Custom enterprise plan - Contact sales for pricing and features', monthlyPrice: null, annualPrice: null, monthlyPeriod: null, annualPeriod: null, type: 'business', ctaMonthly: 'Contact Us', ctaAnnual: 'Select Plan' },
 { id: 'law-firm', name: 'Law Firm', description: 'Full access for law firms with 5 users', monthlyPrice: '₹9,999', annualPrice: '₹59,990', monthlyPeriod: '/month', annualPeriod: '/year', type: 'business', ctaMonthly: 'Select Plan', ctaAnnual: 'Select Plan' },
 { id: 'free', name: 'SoloLite', description: 'Starter plan for individual legal professionals', monthlyPrice: '₹999', annualPrice: '₹9,990', monthlyPeriod: '/month', annualPeriod: '/year', type: 'individual', ctaMonthly: 'Select Plan', ctaAnnual: 'Select Plan' },
 { id: 'solo-lawyer', name: 'Solo Lawyer', description: 'Full access for individual lawyers', monthlyPrice: '₹2,004', annualPrice: '₹24,990', monthlyPeriod: '/month', annualPeriod: '/year', type: 'individual', ctaMonthly: 'Select Plan', ctaAnnual: 'Select Plan' },
];

const PLAN_NAME_HINTS = {
 enterprise: ['enterprise'],
 'law-firm': ['law firm', 'lawfirm', 'team', 'business'],
 free: ['sololite', 'solo lite', 'free', 'starter', 'basic'],
 'solo-lawyer': ['solo lawyer', 'solo'],
};

const priceStringToPaise = (price) => {
  const raw = String(price || "").replace(/[^0-9.]/g, "");
  if (!raw) return 0;
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * 100);
};

const resolveBackendPlanForUi = (backendPlans, uiPlanId, cycle, uiPlanType) => {
 const intervals = cycle === 'yearly'
 ? ['year', 'yearly', 'annual']
 : cycle === 'quarterly'
 ? ['quarter', 'quarterly']
 : ['month', 'monthly'];
 const hints = PLAN_NAME_HINTS[uiPlanId] || [];
 const active = backendPlans.filter((p) => p?.is_active !== false);
 const intervalMatched = active.filter((p) =>
 intervals.includes(String(p?.interval || '').toLowerCase())
 );
 const intervalAndTypeMatched = intervalMatched.filter((p) => {
 const t = String(p?.type || '').toLowerCase();
 if (uiPlanType === 'business') return t === 'business' || t === 'team' || t === 'enterprise';
 if (uiPlanType === 'individual') return t === 'individual' || t === 'solo';
 return true;
 });
 const byName = intervalAndTypeMatched.find((p) =>
 hints.some((hint) => String(p?.name || '').toLowerCase().includes(hint))
 );
 if (byName) return byName;
 if (intervalAndTypeMatched.length > 0) return intervalAndTypeMatched[0];
 if (intervalMatched.length > 0) return intervalMatched[0];
 const nameOnly = active.find((p) =>
 hints.some((hint) => String(p?.name || '').toLowerCase().includes(hint))
 );
 if (nameOnly) return nameOnly;
 // Last fallback: any active plan so checkout can proceed.
 return active[0] || null;
};

const SubscriptionPlanPage = () => {
 const navigate = useNavigate();
 const location = useLocation();
 const { user, token, loading: authLoading } = useAuth();
 
 const [billingCycle, setBillingCycle] = useState('yearly');
 const [plans, setPlans] = useState([]);
 const [backendPlans, setBackendPlans] = useState([]);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState(null);
 const [processingPayment, setProcessingPayment] = useState(false);
 const [selectedPlanId, setSelectedPlanId] = useState(null);
 const [pendingCheckout, setPendingCheckout] = useState(null);

 useEffect(() => {
 const statePending = location.state?.pendingUpgradePlan;
 if (statePending && typeof statePending === 'object') {
 setPendingCheckout(statePending);
 localStorage.setItem('pendingUpgradeCheckout', JSON.stringify(statePending));
 return;
 }
 const storedPending = localStorage.getItem('pendingUpgradeCheckout');
 if (storedPending) {
 try {
 setPendingCheckout(JSON.parse(storedPending));
 } catch (error) {
 console.error('Failed to parse pending upgrade checkout:', error);
 localStorage.removeItem('pendingUpgradeCheckout');
 }
 }
 }, [location.state]);

 const fetchPlans = useCallback(async () => {
 console.log('Fetching plans for:', { billingCycle });
 setLoading(true);
 setError(null);
 
 try {
 let plansData = null;
 try {
 const response = await apiService.getPublicPlans();
 console.log('API response:', response);
 if (response?.success && Array.isArray(response.data)) {
 plansData = response.data;
 }
 } catch (apiErr) {
 console.warn('apiService.getPublicPlans failed, trying direct fetch:', apiErr?.message);
 }

 if (!plansData) {
 const token = localStorage.getItem('token');
 const directRes = await fetch(`${BACKEND_BASE_URL}/api/payments/plans`, {
 method: 'GET',
 headers: {
 'Content-Type': 'application/json',
 ...(token ? { Authorization: `Bearer ${token}` } : {}),
 },
 cache: 'no-store',
 });
 if (!directRes.ok) {
 throw new Error(`Failed to fetch plans (${directRes.status})`);
 }
 const directJson = await directRes.json();
 plansData = Array.isArray(directJson?.data) ? directJson.data : [];
 }

 if (Array.isArray(plansData) && plansData.length > 0) {
 setBackendPlans(plansData);
 const visiblePlans = LANDING_PLAN_CONFIG
 .map((uiPlan) => ({
 ...uiPlan,
 backendPlan: resolveBackendPlanForUi(plansData, uiPlan.id, billingCycle, uiPlan.type),
 }));
 
 console.log('Visible landing-aligned plans:', visiblePlans);
 setPlans(visiblePlans);
 } else {
 throw new Error('No plans available from payment service');
 }
 } catch (err) {
 console.error('Error fetching plans:', err);
 setError(`Failed to fetch plans: ${err.message}`);
 } finally {
 setLoading(false);
 }
 }, [billingCycle]);

 useEffect(() => {
 fetchPlans();
 }, [fetchPlans]);

 const loadRazorpayScript = () => {
 return new Promise((resolve) => {
 if (window.Razorpay) {
 console.log('Razorpay already loaded');
 return resolve(true);
 }
 
 if (document.getElementById('razorpay-script')) {
 console.log('Razorpay script already in DOM');
 return resolve(true);
 }
 
 console.log('Loading Razorpay script...');
 const script = document.createElement('script');
 script.id = 'razorpay-script';
 script.src = 'https://checkout.razorpay.com/v1/checkout.js';
 script.onload = () => {
 console.log('Razorpay script loaded successfully');
 resolve(true);
 };
 script.onerror = (error) => {
 console.error('Failed to load Razorpay script:', error);
 resolve(false);
 };
 document.body.appendChild(script);
 });
 };

 const handlePaymentSuccess = async (planName, paymentData) => {
 try {
 console.log('Payment successful:', paymentData);
 
 const userInfo = JSON.parse(localStorage.getItem('userInfo') || '{}');
 userInfo.plan = planName;
 userInfo.lastPayment = {
 id: paymentData.razorpay_payment_id,
 subscription_id: paymentData.razorpay_subscription_id,
 date: new Date().toISOString()
 };
 localStorage.setItem('userInfo', JSON.stringify(userInfo));
 
 window.dispatchEvent(new CustomEvent('userInfoUpdated', { detail: userInfo }));
 
 alert('🎉 Payment successful! Your subscription is now active.');
 
 navigate('/dashboard', { replace: true });
 } catch (error) {
 console.error('Error handling payment success:', error);
 }
 };

 const handlePaymentFailure = (error) => {
 console.error('Payment failed:', error);
 const errorMessage = error?.description || error?.message || 'Payment failed due to unknown error';
 alert(`❌ Payment Failed: ${errorMessage}`);
 setError(`Payment failed: ${errorMessage}`);
 setProcessingPayment(false);
 setSelectedPlanId(null);
 };

 const handleSelectPlan = async (plan) => {
 console.log('Selected plan:', plan);

 console.log('All localStorage keys:', Object.keys(localStorage));
 console.log('token:', localStorage.getItem('token'));
 console.log('userInfo:', localStorage.getItem('userInfo'));

 const storedToken = localStorage.getItem('token');
 
 if (!storedToken) {
 setError('Please log in to continue with your subscription.');
 return;
 }

 const extractUserId = (candidate) => {
 if (!candidate || typeof candidate !== 'object') return null;
 return (
 candidate.id ??
 candidate.user_id ??
 candidate.userId ??
 candidate.uid ??
 candidate.profile_id ??
 null
 );
 };

 let currentUser = null;
 const possibleUserKeys = ['userInfo', 'user', 'userData', 'authUser'];
 
 for (const key of possibleUserKeys) {
 const storedData = localStorage.getItem(key);
 if (storedData) {
 try {
 const parsedData = JSON.parse(storedData);
 console.log(`Found user data in ${key}:`, parsedData);

 const directId = extractUserId(parsedData);
 if (directId) {
 currentUser = { ...parsedData, id: directId };
 console.log(`Using user data from ${key}`);
 break;
 }

 const nestedUserId = extractUserId(parsedData.user);
 if (nestedUserId) {
 currentUser = { ...parsedData.user, id: nestedUserId };
 console.log(`Using nested user data from ${key}.user`);
 break;
 }

 const nestedDataId = extractUserId(parsedData.data);
 if (nestedDataId) {
 currentUser = { ...parsedData.data, id: nestedDataId };
 console.log(`Using nested user data from ${key}.data`);
 break;
 }
 } catch (e) {
 console.error(`Error parsing ${key} from localStorage:`, e);
 }
 }
 }

 const authUserId = extractUserId(user);
 if (!currentUser && authUserId) {
 currentUser = { ...user, id: authUserId };
 console.log('Using user from AuthContext as fallback');
 }

 if (!currentUser || !currentUser.id) {
 console.error('No valid user found in localStorage or AuthContext');
 console.log('Available localStorage keys:', Object.keys(localStorage));
 setError('User information not found. Please log in again.');
 return;
 }

 console.log('Final currentUser object:', currentUser);

 if (plan.id === 'enterprise' && billingCycle === 'monthly') {
 navigate('/contact');
 return;
 }

 const shownPrice = billingCycle === 'yearly' ? plan.annualPrice : plan.monthlyPrice;
 const amountInPaise = priceStringToPaise(shownPrice);
 if (!amountInPaise) {
 setError('Invalid plan amount. Please try another plan.');
 return;
 }

 setProcessingPayment(true);
 setSelectedPlanId(plan.id);
 setError(null);

 try {
 const scriptLoaded = await loadRazorpayScript();
 if (!scriptLoaded) {
 throw new Error('Payment gateway failed to load. Please refresh and try again.');
 }

 console.log('Initiating one-time payment:', { planName: plan.name, amountInPaise });
 console.log('Token being sent for payment:', storedToken?.substring(0, 20) + '...');
 console.log('User ID from localStorage:', currentUser.id);

 const response = await fetch(`${BACKEND_BASE_URL}/api/payments/order/create`, {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 'Authorization': `Bearer ${storedToken}`,
 },
 body: JSON.stringify({
 amount: amountInPaise,
 currency: 'INR',
 plan_name: plan.name,
 }),
 });

 if (!response.ok) {
 const errorText = await response.text();
 console.error('HTTP Error:', response.status, errorText);
 throw new Error(`Server error: ${response.status} ${response.statusText}`);
 }

 const createOrderResponse = await response.json();
 console.log('[Razorpay Debug] createOrder API raw response:', createOrderResponse);

 if (!createOrderResponse.success) {
 throw new Error(createOrderResponse.message || createOrderResponse.error || 'Failed to create payment order.');
 }

 const orderId = createOrderResponse.order?.id;
 const orderAmount = createOrderResponse.order?.amount;
 const razorpayKeyId = createOrderResponse.key || import.meta.env.VITE_RAZORPAY_KEY_ID;
 
 if (!orderId) {
 console.error('[Razorpay Debug] Missing order ID in createOrder response:', createOrderResponse);
 throw new Error('Invalid response from payment server. Missing order ID.');
 }

 if (!razorpayKeyId) {
 console.error('[Razorpay Debug] Missing Razorpay key in createOrder response:', createOrderResponse);
 throw new Error('Invalid response from payment server. Missing Razorpay key.');
 }
 const isLocalhost =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1';
 if (isLocalhost && String(razorpayKeyId).startsWith('rzp_live_')) {
  throw new Error(
   'Live Razorpay key detected on localhost. Use test keys for local development or run via a public HTTPS URL.'
  );
 }

 console.log(`[Razorpay Debug] Received orderId: ${orderId}`);
 console.log(`[Razorpay Debug] Received Razorpay key: ${razorpayKeyId}`);

 const razorpayOptions = {
 key: razorpayKeyId,
 order_id: orderId,
 amount: orderAmount || amountInPaise,
 currency: 'INR',
 name: "NexintelAI Subscriptions",
 description: `${plan.name} Payment`,
 image: "https://www.nexintelai.com/assets/img/Ai%20logo-01.png",
 prefill: {
 name: currentUser?.name || currentUser?.username || '',
 email: currentUser?.email || '',
 contact: currentUser?.phone || currentUser?.contact || ''
 },
 theme: {
 color: "#1a202c"
 },
 handler: async function (response) {
 console.log('Razorpay payment handler response:', response);
 
 setProcessingPayment(true);
 
 try {
 const verificationResponse = await fetch(`${BACKEND_BASE_URL}/api/payments/order/verify`, {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 'Authorization': `Bearer ${storedToken}`,
 },
 body: JSON.stringify({
 razorpay_order_id: response.razorpay_order_id,
 razorpay_payment_id: response.razorpay_payment_id,
 razorpay_signature: response.razorpay_signature,
 plan_name: plan.name,
 }),
 });

 if (!verificationResponse.ok) {
 const errorText = await verificationResponse.text();
 console.error('Verification HTTP Error:', verificationResponse.status, errorText);
 throw new Error(`Verification failed: ${verificationResponse.status} ${verificationResponse.statusText}`);
 }

 const verifyResult = await verificationResponse.json();
 console.log('Verification response:', verifyResult);

 if (verifyResult.success) {
 await handlePaymentSuccess(plan.name, response);
 } else {
 throw new Error(verifyResult.message || 'Payment verification failed.');
 }
 } catch (verifyError) {
 console.error('Error during payment verification:', verifyError);
 handlePaymentFailure({ description: verifyError.message || 'Payment verification failed.' });
 } finally {
 setProcessingPayment(false);
 setSelectedPlanId(null);
 }
 },
 modal: {
 ondismiss: function() {
 console.log('Payment modal dismissed by user');
 setProcessingPayment(false);
 setSelectedPlanId(null);
 },
 escape: true,
 backdropclose: false
 },
 notes: {
 plan_name: plan.name,
 user_id: currentUser?.id || 'anonymous'
 }
 };

 console.log('Opening Razorpay checkout with options:', razorpayOptions);
 
 const razorpayInstance = new window.Razorpay(razorpayOptions);
 
 razorpayInstance.on('payment.failed', function (response) {
 console.error('Razorpay payment.failed event:', response);
 handlePaymentFailure(response.error);
 });

 razorpayInstance.open();

 } catch (err) {
 console.error('Error in payment process:', err);
 setError(err.message || 'Payment process failed. Please try again.');
 setProcessingPayment(false);
 setSelectedPlanId(null);
 }
 };

 const handleGoBack = () => {
 navigate(-1);
 };

 const handleRetry = () => {
 setError(null);
 fetchPlans();
 };

 useEffect(() => {
 if (!pendingCheckout || loading || processingPayment || plans.length === 0) return;

 const desiredBilling = pendingCheckout.billing === 'annual' ? 'yearly' : pendingCheckout.billing;
 const normalizedPlanId = String(pendingCheckout.planId || '').toLowerCase();
 const normalizedPlanName = String(pendingCheckout.planName || '').toLowerCase();
 const mapNameHints = {
 'law-firm': ['law firm', 'lawfirm', 'team', 'business'],
 'solo-lawyer': ['solo lawyer', 'solo'],
 'free': ['sololite', 'solo lite', 'free', 'starter', 'basic'],
 enterprise: ['enterprise'],
 };
 const hints = mapNameHints[normalizedPlanId] || [normalizedPlanName].filter(Boolean);

 if (desiredBilling && billingCycle !== desiredBilling) {
 setBillingCycle(desiredBilling);
 return;
 }

 const match = plans.find((plan) => {
 const n = String(plan?.name || '').toLowerCase();
 return hints.some((hint) => hint && n.includes(hint));
 });
 if (!match) return;

 localStorage.removeItem('pendingUpgradeCheckout');
 setPendingCheckout(null);
 handleSelectPlan(match);
 }, [pendingCheckout, loading, processingPayment, plans, billingCycle]);

 return (
 <div className="min-h-screen bg-white py-20 sm:py-28">
 <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
 <button
 onClick={handleGoBack}
 className="mb-8 flex items-center text-juri-muted transition-colors hover:text-teal-700"
 disabled={processingPayment}
 >
 <ArrowLeftIcon className="h-5 w-5 mr-2" />
 Back
 </button>

 <div className="text-center">
 <h1 className="font-playfair text-3xl font-bold text-teal-700 sm:text-4xl">
 Choose Your Plan
 </h1>
 <p className="mx-auto mt-4 max-w-xl font-dmSans text-base text-juri-muted">
 Select the perfect plan for your legal practice. All plans include our core
 AI features with scalable pricing.
 </p>
 </div>

 <div className="mt-8 mb-12 flex justify-center">
 <div className="relative inline-flex rounded-full border border-teal-300/60 bg-white p-1 shadow-sm">
 <button
 type="button"
 className={`rounded-full px-6 py-2 font-dmSans text-sm font-semibold transition-all duration-200 ${
 billingCycle === 'monthly'
 ? 'text-white'
 : 'text-teal-700 hover:text-juri-muted'
 }`}
 style={billingCycle === 'monthly' ? { backgroundColor: '#0D9488' } : {}}
 onMouseEnter={(e) => {
 if (billingCycle === 'monthly') {
 e.currentTarget.style.backgroundColor = '#1AA49B';
 }
 }}
 onMouseLeave={(e) => {
 if (billingCycle === 'monthly') {
 e.currentTarget.style.backgroundColor = '#21C1B6';
 }
 }}
 onClick={() => setBillingCycle('monthly')}
 disabled={loading || processingPayment}
 >
 Monthly
 </button>
 <button
 type="button"
 className={`rounded-full px-6 py-2 font-dmSans text-sm font-semibold transition-all duration-200 ${
 billingCycle === 'yearly'
 ? 'text-white'
 : 'text-teal-700 hover:text-juri-muted'
 }`}
 style={billingCycle === 'yearly' ? { backgroundColor: '#0D9488' } : {}}
 onMouseEnter={(e) => {
 if (billingCycle === 'yearly') {
 e.currentTarget.style.backgroundColor = '#1AA49B';
 }
 }}
 onMouseLeave={(e) => {
 if (billingCycle === 'yearly') {
 e.currentTarget.style.backgroundColor = '#21C1B6';
 }
 }}
 onClick={() => setBillingCycle('yearly')}
 disabled={loading || processingPayment}
 >
 Yearly
 </button>
 </div>
 </div>

 {loading && (
 <div className="py-12 text-center">
 <div className="mb-4 inline-block h-12 w-12 animate-spin rounded-full border-b-2 border-teal-700"></div>
 <p className="font-dmSans text-juri-muted">Loading subscription plans...</p>
 </div>
 )}

 {error && (
 <div className="mb-8 rounded-xl border border-red-200 bg-red-50 p-4">
 <div className="flex items-center justify-between">
 <div className="font-dmSans text-red-800">{error}</div>
 <button
 onClick={handleRetry}
 className="text-red-600 hover:text-red-500 text-sm font-medium"
 disabled={loading}
 >
 Try Again
 </button>
 </div>
 </div>
 )}

 {!loading && !error && plans.length === 0 && (
 <div className="py-12 text-center">
 <p className="mb-4 font-dmSans text-lg text-juri-muted">
 No plans available for {billingCycle} billing
 </p>
 <button
 onClick={handleRetry}
 className="font-dmSans font-medium text-teal-700 hover:text-teal-600"
 >
 Refresh Plans
 </button>
 </div>
 )}

 {!loading && !error && plans.length > 0 && (
 <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
 {plans.map((plan) => {
const displayPrice = billingCycle === 'yearly' ? plan.annualPrice : plan.monthlyPrice;
const displayPeriod = billingCycle === 'yearly' ? plan.annualPeriod : plan.monthlyPeriod;
const isPriceZero = !plan.backendPlan?.price || plan.backendPlan.price === 0;
 const isCurrentlyProcessing = processingPayment && selectedPlanId === plan.id;
const isDisabled = processingPayment;
const ctaLabel = billingCycle === 'monthly' ? plan.ctaMonthly : plan.ctaAnnual;

 return (
 <div
 key={plan.id}
 className={`group flex flex-col rounded-2xl border border-teal-300/60 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-2 hover:border-teal-500 hover:shadow-[0_8px_32px_rgba(13,148,136,0.2)] ${
 isCurrentlyProcessing ? 'ring-2 ring-teal-500 shadow-[0_8px_32px_rgba(13,148,136,0.28)]' : ''
 }`}
 >
 <h2 className="text-center font-playfair text-lg font-semibold text-teal-700 transition-colors duration-300 group-hover:text-teal-600">
 {plan.name}
 </h2>
 <p className="mt-2 text-center font-dmSans text-xs leading-snug text-juri-muted">
 {plan.description || plan.tagline || 'Subscription plan'}
 </p>
 
 <div className="mt-5 flex items-end justify-center gap-1">
{displayPrice ? (
<>
<span className="font-playfair text-4xl font-bold text-teal-700">
{displayPrice}
</span>
{displayPeriod && (
<span className="mb-1 font-dmSans text-sm text-juri-muted">
{displayPeriod}
</span>
)}
</>
) : (
<span className="font-dmSans text-sm italic text-juri-muted">Contact us for pricing</span>
)}
 </div>
 
 <button
 onClick={() => handleSelectPlan(plan)}
 disabled={isDisabled}
 className={`mt-5 mb-6 w-full rounded-lg border border-teal-300/60 bg-white py-2.5 font-dmSans text-sm font-medium transition-all duration-300 active:scale-[0.98] ${
 isDisabled
 ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
 : 'text-teal-700 group-hover:border-teal-500 group-hover:bg-teal-600 group-hover:text-white'
 }`}
 style={isDisabled ? {} : { backgroundColor: '#FFFFFF' }}
 onMouseEnter={(e) => {
 if (!isDisabled) {
 e.currentTarget.style.backgroundColor = '#1AA49B';
 }
 }}
 onMouseLeave={(e) => {
 if (!isDisabled) {
 e.currentTarget.style.backgroundColor = '#21C1B6';
 }
 }}
 >
 {isCurrentlyProcessing ? (
 <div className="flex items-center justify-center">
 <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
 Processing...
 </div>
 ) : (
ctaLabel
 )}
 </button>
 
 <hr className="my-5 border-teal-300/60" />

 <div className="flex-1">
 <ul className="space-y-3">
 {plan.features ? (
 (typeof plan.features === 'string' ?
 plan.features.split(',').map(f => f.trim()).filter(f => f) :
 Array.isArray(plan.features) ? plan.features : []
 ).map((feature, index) => (
 <li key={index} className="flex items-start">
 <CheckIcon className="mt-0.5 mr-3 h-5 w-5 flex-shrink-0 text-teal-600" />
 <span className="font-dmSans text-xs leading-snug text-teal-700">{feature}</span>
 </li>
 ))
 ) : (
 <li className="font-dmSans text-sm italic text-juri-muted">No features listed</li>
 )}
 </ul>
 </div>
 </div>
 );
 })}
 </div>
 )}
 </div>
 </div>
 );
};

export default SubscriptionPlanPage;