

// import React, { useState, useEffect, useCallback } from 'react';
// import { CheckIcon } from '@heroicons/react/20/solid';
// import { ArrowLeftIcon } from '@heroicons/react/24/outline';
// import { useNavigate } from 'react-router-dom';
// import apiService from '../services/api';
// import { useAuth } from '../context/AuthContext';

// // Razorpay Configuration
// const RAZORPAY_KEY_ID = import.meta.env.VITE_APP_RAZORPAY_KEY_ID || 'rzp_test_R6mBF5iIMakFt1';
// const BACKEND_BASE_URL = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000/payments';

// console.log('Environment variables:', { RAZORPAY_KEY_ID, BACKEND_BASE_URL });

// const SubscriptionPlanPage = () => {
//   const navigate = useNavigate();
//   const { user, token, loading: authLoading } = useAuth();
  
//   // State management
//   const [billingCycle, setBillingCycle] = useState('yearly');
//   const [planType, setPlanType] = useState('individual');
//   const [plans, setPlans] = useState([]);
//   const [loading, setLoading] = useState(true);
//   const [error, setError] = useState(null);
//   const [processingPayment, setProcessingPayment] = useState(false);
//   const [selectedPlanId, setSelectedPlanId] = useState(null);

//   // Fetch plans from API
//   const fetchPlans = useCallback(async () => {
//     console.log('Fetching plans for:', { planType, billingCycle });
//     setLoading(true);
//     setError(null);
    
//     try {
//       const response = await apiService.getPublicPlans();
//       console.log('API response:', response);
      
//       if (response?.success && Array.isArray(response.data)) {
//         // Filter plans based on selected criteria
//         const filteredPlans = response.data.filter(plan => {
//           // Type matching
//           const matchesType = (planType === 'team' && plan.type === 'business') || 
//                              (planType === 'individual' && plan.type === 'individual');
          
//           // Interval matching - normalize interval names
//           const planInterval = plan.interval?.toLowerCase();
//           const matchesInterval = (billingCycle === 'monthly' && ['month', 'monthly'].includes(planInterval)) ||
//                                  (billingCycle === 'yearly' && ['year', 'yearly', 'annual'].includes(planInterval)) ||
//                                  (billingCycle === 'quarterly' && ['quarter', 'quarterly'].includes(planInterval));
          
//           console.log(`Plan ${plan.name}: type=${plan.type}, interval=${planInterval}, matchesType=${matchesType}, matchesInterval=${matchesInterval}`);
//           return matchesType && matchesInterval;
//         });
        
//         console.log('Filtered plans:', filteredPlans);
//         setPlans(filteredPlans);
//       } else {
//         throw new Error('Invalid response format from server');
//       }
//     } catch (err) {
//       console.error('Error fetching plans:', err);
//       setError(`Failed to fetch plans: ${err.message}`);
//     } finally {
//       setLoading(false);
//     }
//   }, [planType, billingCycle]);

//   useEffect(() => {
//     fetchPlans();
//   }, [fetchPlans]);

//   // Load Razorpay script dynamically
//   const loadRazorpayScript = () => {
//     return new Promise((resolve) => {
//       // Check if Razorpay is already loaded
//       if (window.Razorpay) {
//         console.log('Razorpay already loaded');
//         return resolve(true);
//       }
      
//       // Check if script is already in DOM
//       if (document.getElementById('razorpay-script')) {
//         console.log('Razorpay script already in DOM');
//         return resolve(true);
//       }
      
//       console.log('Loading Razorpay script...');
//       const script = document.createElement('script');
//       script.id = 'razorpay-script';
//       script.src = 'https://checkout.razorpay.com/v1/checkout.js';
//       script.onload = () => {
//         console.log('Razorpay script loaded successfully');
//         resolve(true);
//       };
//       script.onerror = (error) => {
//         console.error('Failed to load Razorpay script:', error);
//         resolve(false);
//       };
//       document.body.appendChild(script);
//     });
//   };

//   // Handle payment success
//   const handlePaymentSuccess = async (planName, paymentData) => {
//     try {
//       console.log('Payment successful:', paymentData);
      
//       // Update local storage
//       const userInfo = JSON.parse(localStorage.getItem('userInfo') || '{}');
//       userInfo.plan = planName;
//       userInfo.lastPayment = {
//         id: paymentData.razorpay_payment_id,
//         subscription_id: paymentData.razorpay_subscription_id,
//         date: new Date().toISOString()
//       };
//       localStorage.setItem('userInfo', JSON.stringify(userInfo));
      
//       // Dispatch event for other components
//       window.dispatchEvent(new CustomEvent('userInfoUpdated', { detail: userInfo }));
      
//       // Show success message
//       alert('🎉 Payment successful! Your subscription is now active.');
      
//       // Redirect to dashboard
//       navigate('/dashboard', { replace: true });
//     } catch (error) {
//       console.error('Error handling payment success:', error);
//     }
//   };

//   // Handle payment failure
//   const handlePaymentFailure = (error) => {
//     console.error('Payment failed:', error);
//     const errorMessage = error?.description || error?.message || 'Payment failed due to unknown error';
//     alert(`❌ Payment Failed: ${errorMessage}`);
//     setError(`Payment failed: ${errorMessage}`);
//     setProcessingPayment(false);
//     setSelectedPlanId(null);
//   };

//   // Create payment order and handle Razorpay checkout
//   const handleSelectPlan = async (plan) => {
//     console.log('Selected plan:', plan);

//     // Check if user is authenticated
//     // Authentication check is now handled by AuthChecker.jsx at the route level.
//     // If a user reaches this page, they are assumed to be authenticated.
//     // If authLoading is true, it means the auth state is still being determined.
//     if (authLoading) {
//       setError('Please wait while we verify your authentication...');
//       return;
//     }
//     // If for some reason user or token are null/undefined here, it implies an issue
//     // with AuthContext or AuthChecker, which should be addressed there.
//     // We will not redirect from here to avoid conflicting with AuthChecker.
//     if (!user || !user.id) {
//       setError('User not authenticated or User ID not available. Please log in again.');
//       setProcessingPayment(false);
//       setSelectedPlanId(null);
//       return;
//     }

//     // Validate plan
//     if (!plan.id || !plan.price || plan.price <= 0) {
//       setError('Invalid plan selected');
//       return;
//     }

//     setProcessingPayment(true);
//     setSelectedPlanId(plan.id);
//     setError(null);

//     try {
//       // Load Razorpay script
//       const scriptLoaded = await loadRazorpayScript();
//       if (!scriptLoaded) {
//         throw new Error('Payment gateway failed to load. Please refresh and try again.');
//       }

//       console.log('Initiating subscription payment for plan ID:', plan.id);
//       console.log('Token being sent for subscription:', token?.substring(0, 20) + '...'); // Log only first 20 chars
//       console.log('Sending plan_id to backend:', plan.id); // Added log for plan.id

//       // Start subscription
//       const response = await fetch(`${BACKEND_BASE_URL}/subscription/start`, {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//           'Authorization': `Bearer ${localStorage.getItem('token')}`, // Get token directly from localStorage
//           'X-User-ID': user?.id || '', // Add User ID from context or empty string if not available
//         },
//         body: JSON.stringify({ plan_id: plan.id }),
//       });

//       // Check if response is ok
//       if (!response.ok) {
//         const errorText = await response.text();
//         console.error('HTTP Error:', response.status, errorText);
//         throw new Error(`Server error: ${response.status} ${response.statusText}`);
//       }

//       const startSubscriptionResponse = await response.json();
//       console.log('startSubscription API response:', startSubscriptionResponse);

//       if (!startSubscriptionResponse.success) {
//         throw new Error(startSubscriptionResponse.message || startSubscriptionResponse.error || 'Failed to initiate subscription payment.');
//       }

//       if (!startSubscriptionResponse.subscription_id || !startSubscriptionResponse.key) {
//         throw new Error('Invalid response from payment server. Missing subscription ID or key.');
//       }

//       // Configure Razorpay checkout options
//       const razorpayOptions = {
//         key: startSubscriptionResponse.key,
//         subscription_id: startSubscriptionResponse.subscription_id,
//         name: "NexintelAI Subscriptions",
//         description: `${plan.name} Subscription`,
//         image: "https://www.nexintelai.com/assets/img/Ai%20logo-01.png", // Add your logo URL here
//         prefill: {
//           name: user?.name || user?.username || '',
//           email: user?.email || '',
//           contact: user?.phone || user?.contact || ''
//         },
//         theme: {
//           color: "#1a202c"
//         },
//         handler: async function (response) {
//           console.log('Razorpay payment handler response:', response);
          
//           setProcessingPayment(true);
          
//           try {
//             // Verify the payment with the backend
//             const verificationResponse = await fetch(`${BACKEND_BASE_URL}/subscription/verify`, {
//               method: 'POST',
//               headers: {
//                 'Content-Type': 'application/json',
//                 'Authorization': `Bearer ${localStorage.getItem('token')}`, // Get token directly from localStorage
//               },
//               body: JSON.stringify({
//                 razorpay_payment_id: response.razorpay_payment_id,
//                 razorpay_subscription_id: response.razorpay_subscription_id,
//                 razorpay_signature: response.razorpay_signature,
//               }),
//             });

//             if (!verificationResponse.ok) {
//               const errorText = await verificationResponse.text();
//               console.error('Verification HTTP Error:', verificationResponse.status, errorText);
//               throw new Error(`Verification failed: ${verificationResponse.status} ${verificationResponse.statusText}`);
//             }

//             const verifyResult = await verificationResponse.json();
//             console.log('Verification response:', verifyResult);

//             if (verifyResult.success) {
//               await handlePaymentSuccess(plan.name, response);
//             } else {
//               throw new Error(verifyResult.message || 'Payment verification failed.');
//             }
//           } catch (verifyError) {
//             console.error('Error during payment verification:', verifyError);
//             handlePaymentFailure({ description: verifyError.message || 'Payment verification failed.' });
//           } finally {
//             setProcessingPayment(false);
//             setSelectedPlanId(null);
//           }
//         },
//         modal: {
//           ondismiss: function() {
//             console.log('Payment modal dismissed by user');
//             setProcessingPayment(false);
//             setSelectedPlanId(null);
//           },
//           escape: true,
//           backdropclose: false
//         },
//         notes: {
//           plan_id: plan.id,
//           user_id: user?.id || 'anonymous' // Safely access user.id with null check
//         }
//       };

//       console.log('Opening Razorpay checkout with options:', razorpayOptions);
      
//       // Create and open Razorpay instance
//       const razorpayInstance = new window.Razorpay(razorpayOptions);
      
//       razorpayInstance.on('payment.failed', function (response) {
//         console.error('Razorpay payment.failed event:', response);
//         handlePaymentFailure(response.error);
//       });

//       razorpayInstance.open();

//     } catch (err) {
//       console.error('Error in payment process:', err);
//       setError(err.message || 'Payment process failed. Please try again.');
//       setProcessingPayment(false);
//       setSelectedPlanId(null);
//     }
//   };

//   // Navigation handler
//   const handleGoBack = () => {
//     navigate(-1);
//   };

//   // Retry handler
//   const handleRetry = () => {
//     setError(null);
//     fetchPlans();
//   };

//   return (
//     <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
//       <div className="max-w-7xl mx-auto">
//         {/* Back button */}
//         <button
//           onClick={handleGoBack}
//           className="flex items-center text-gray-600 hover:text-gray-900 mb-8 transition-colors"
//           disabled={processingPayment}
//         >
//           <ArrowLeftIcon className="h-5 w-5 mr-2" />
//           Back
//         </button>

//         {/* Page title */}
//         <h1 className="text-4xl font-extrabold text-gray-900 text-center mb-12">
//           Plans that grow with you
//         </h1>

//         {/* Plan Type Toggle */}
//         <div className="flex justify-center mb-8">
//           <div className="inline-flex rounded-md shadow-sm">
//             <button
//               type="button"
//               className={`py-2 px-4 text-sm font-medium rounded-l-md transition-colors ${
//                 planType === 'individual'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-gray-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setPlanType('individual')}
//               disabled={loading || processingPayment}
//             >
//               Individual
//             </button>
//             <button
//               type="button"
//               className={`-ml-px py-2 px-4 text-sm font-medium rounded-r-md transition-colors ${
//                 planType === 'team'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-gray-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setPlanType('team')}
//               disabled={loading || processingPayment}
//             >
//               Team & Enterprise
//             </button>
//           </div>
//         </div>

//         {/* Billing Cycle Toggle */}
//         <div className="flex justify-center mb-12">
//           <div className="inline-flex rounded-md shadow-sm">
//             <button
//               type="button"
//               className={`py-2 px-4 text-sm font-medium rounded-l-md transition-colors ${
//                 billingCycle === 'monthly'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-gray-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setBillingCycle('monthly')}
//               disabled={loading || processingPayment}
//             >
//               Monthly
//             </button>
//             <button
//               type="button"
//               className={`-ml-px py-2 px-4 text-sm font-medium transition-colors ${
//                 billingCycle === 'yearly'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-gray-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setBillingCycle('yearly')}
//               disabled={loading || processingPayment}
//             >
//               Yearly
//             </button>
//             <button
//               type="button"
//               className={`-ml-px py-2 px-4 text-sm font-medium rounded-r-md transition-colors ${
//                 billingCycle === 'quarterly'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-gray-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setBillingCycle('quarterly')}
//               disabled={loading || processingPayment}
//             >
//               Quarterly
//             </button>
//           </div>
//         </div>

//         {/* Loading State */}
//         {loading && (
//           <div className="text-center py-12">
//             <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mb-4"></div>
//             <p className="text-gray-600">Loading subscription plans...</p>
//           </div>
//         )}

//         {/* Error State */}
//         {error && (
//           <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-8">
//             <div className="flex justify-between items-center">
//               <div className="text-red-800">{error}</div>
//               <button
//                 onClick={handleRetry}
//                 className="text-red-600 hover:text-red-500 text-sm font-medium"
//                 disabled={loading}
//               >
//                 Try Again
//               </button>
//             </div>
//           </div>
//         )}

//         {/* Empty State */}
//         {!loading && !error && plans.length === 0 && (
//           <div className="text-center py-12">
//             <p className="text-gray-600 text-lg mb-4">
//               No plans available for {planType} - {billingCycle} billing
//             </p>
//             <button
//               onClick={handleRetry}
//               className="text-blue-600 hover:text-blue-500 font-medium"
//             >
//               Refresh Plans
//             </button>
//           </div>
//         )}

//         {/* Plan Cards */}
//         {!loading && !error && plans.length > 0 && (
//           <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
//             {plans.map((plan) => {
//               const displayPrice = plan.price ? `₹${plan.price.toLocaleString()}` : 'Free';
//               const isPriceZero = !plan.price || plan.price === 0;
//               const isCurrentlyProcessing = processingPayment && selectedPlanId === plan.id;
//               const isDisabled = isPriceZero || processingPayment || authLoading;

//               console.log(`Plan: ${plan.name}, ID: ${plan.id}, processingPayment: ${processingPayment}, selectedPlanId: ${selectedPlanId}, isCurrentlyProcessing: ${isCurrentlyProcessing}, isDisabled: ${isDisabled}, Auth Loading: ${authLoading}`);

//               return (
//                 <div
//                   key={plan.id}
//                   className={`bg-white rounded-lg shadow-lg p-8 flex flex-col border transition-all duration-200 ${
//                     isCurrentlyProcessing ? 'ring-2 ring-blue-500 shadow-xl' : 'hover:shadow-xl'
//                   }`}
//                 >
//                   {/* Plan Icon */}
//                   <div className="flex-shrink-0 mb-4">
//                     <div className="h-12 w-12 bg-gray-100 rounded-lg flex items-center justify-center">
//                       <svg className="h-6 w-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
//                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.592 1L21 12h-4m-7 0h-4" />
//                       </svg>
//                     </div>
//                   </div>
                  
//                   {/* Plan Details */}
//                   <h2 className="text-2xl font-bold text-gray-900 mb-2">{plan.name}</h2>
//                   <p className="text-gray-500 text-sm mb-6 flex-grow">
//                     {plan.description || plan.tagline || 'Subscription plan'}
//                   </p>
                  
//                   {/* Pricing */}
//                   <div className="flex items-baseline mb-6">
//                     <span className="text-4xl font-extrabold text-gray-900">
//                       {displayPrice}
//                     </span>
//                     {!isPriceZero && (
//                       <span className="ml-1 text-gray-500 text-base">
//                         /{billingCycle === 'monthly' ? 'month' : billingCycle === 'yearly' ? 'year' : 'quarter'}
//                       </span>
//                     )}
//                   </div>
                  
//                   {/* CTA Button */}
//                   <button
//                     onClick={() => handleSelectPlan(plan)}
//                     disabled={isDisabled}
//                     className={`w-full py-3 px-6 rounded-md text-base font-medium transition-all duration-200 mb-6 ${
//                       isDisabled
//                         ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
//                         : 'bg-gray-900 text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2'
//                     }`}
//                   >
//                     {isCurrentlyProcessing ? (
//                       <div className="flex items-center justify-center">
//                         <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
//                         Processing...
//                       </div>
//                     ) : isPriceZero ? (
//                       'Free Plan'
//                     ) : (
//                       'Select Plan'
//                     )}
//                   </button>
                  
//                   {/* Features List */}
//                   <div className="flex-1">
//                     <ul className="space-y-3">
//                       {plan.features ? (
//                         (typeof plan.features === 'string' ?
//                          plan.features.split(',').map(f => f.trim()).filter(f => f) :
//                          Array.isArray(plan.features) ? plan.features : []
//                         ).map((feature, index) => (
//                           <li key={index} className="flex items-start">
//                             <CheckIcon className="h-5 w-5 text-green-500 flex-shrink-0 mr-3 mt-0.5" />
//                             <span className="text-gray-700 text-sm">{feature}</span>
//                           </li>
//                         ))
//                       ) : (
//                         <li className="text-gray-500 text-sm italic">No features listed</li>
//                       )}
//                     </ul>
//                   </div>
//                 </div>
//               );
//             })}
//           </div>
//         )}
//       </div>
//     </div>
//   );
// };

// export default SubscriptionPlanPage;

// import React, { useState, useEffect, useCallback } from 'react';
// import { CheckIcon } from '@heroicons/react/20/solid';
// import { ArrowLeftIcon } from '@heroicons/react/24/outline';
// import { useNavigate } from 'react-router-dom';
// import apiService from '../services/api';
// import { useAuth } from '../context/AuthContext';

// // Razorpay Configuration
// const RAZORPAY_KEY_ID = import.meta.env.VITE_APP_RAZORPAY_KEY_ID || 'rzp_test_R6mBF5iIMakFt1';
// const BACKEND_BASE_URL = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000/payments';

// console.log('Environment variables:', { RAZORPAY_KEY_ID, BACKEND_BASE_URL });

// const SubscriptionPlanPage = () => {
//   const navigate = useNavigate();
//   const { user, token, loading: authLoading } = useAuth();
  
//   // State management
//   const [billingCycle, setBillingCycle] = useState('yearly');
//   const [planType, setPlanType] = useState('individual');
//   const [plans, setPlans] = useState([]);
//   const [loading, setLoading] = useState(true);
//   const [error, setError] = useState(null);
//   const [processingPayment, setProcessingPayment] = useState(false);
//   const [selectedPlanId, setSelectedPlanId] = useState(null);

//   // Fetch plans from API
//   const fetchPlans = useCallback(async () => {
//     console.log('Fetching plans for:', { planType, billingCycle });
//     setLoading(true);
//     setError(null);
    
//     try {
//       const response = await apiService.getPublicPlans();
//       console.log('API response:', response);
      
//       if (response?.success && Array.isArray(response.data)) {
//         // Filter plans based on selected criteria
//         const filteredPlans = response.data.filter(plan => {
//           // Type matching
//           const matchesType = (planType === 'team' && plan.type === 'business') || 
//                              (planType === 'individual' && plan.type === 'individual');
          
//           // Interval matching - normalize interval names
//           const planInterval = plan.interval?.toLowerCase();
//           const matchesInterval = (billingCycle === 'monthly' && ['month', 'monthly'].includes(planInterval)) ||
//                                  (billingCycle === 'yearly' && ['year', 'yearly', 'annual'].includes(planInterval)) ||
//                                  (billingCycle === 'quarterly' && ['quarter', 'quarterly'].includes(planInterval));
          
//           console.log(`Plan ${plan.name}: type=${plan.type}, interval=${planInterval}, matchesType=${matchesType}, matchesInterval=${matchesInterval}`);
//           return matchesType && matchesInterval;
//         });
        
//         console.log('Filtered plans:', filteredPlans);
//         setPlans(filteredPlans);
//       } else {
//         throw new Error('Invalid response format from server');
//       }
//     } catch (err) {
//       console.error('Error fetching plans:', err);
//       setError(`Failed to fetch plans: ${err.message}`);
//     } finally {
//       setLoading(false);
//     }
//   }, [planType, billingCycle]);

//   useEffect(() => {
//     fetchPlans();
//   }, [fetchPlans]);

//   // Load Razorpay script dynamically
//   const loadRazorpayScript = () => {
//     return new Promise((resolve) => {
//       // Check if Razorpay is already loaded
//       if (window.Razorpay) {
//         console.log('Razorpay already loaded');
//         return resolve(true);
//       }
      
//       // Check if script is already in DOM
//       if (document.getElementById('razorpay-script')) {
//         console.log('Razorpay script already in DOM');
//         return resolve(true);
//       }
      
//       console.log('Loading Razorpay script...');
//       const script = document.createElement('script');
//       script.id = 'razorpay-script';
//       script.src = 'https://checkout.razorpay.com/v1/checkout.js';
//       script.onload = () => {
//         console.log('Razorpay script loaded successfully');
//         resolve(true);
//       };
//       script.onerror = (error) => {
//         console.error('Failed to load Razorpay script:', error);
//         resolve(false);
//       };
//       document.body.appendChild(script);
//     });
//   };

//   // Handle payment success
//   const handlePaymentSuccess = async (planName, paymentData) => {
//     try {
//       console.log('Payment successful:', paymentData);
      
//       // Update local storage
//       const userInfo = JSON.parse(localStorage.getItem('userInfo') || '{}');
//       userInfo.plan = planName;
//       userInfo.lastPayment = {
//         id: paymentData.razorpay_payment_id,
//         subscription_id: paymentData.razorpay_subscription_id,
//         date: new Date().toISOString()
//       };
//       localStorage.setItem('userInfo', JSON.stringify(userInfo));
      
//       // Dispatch event for other components
//       window.dispatchEvent(new CustomEvent('userInfoUpdated', { detail: userInfo }));
      
//       // Show success message
//       alert('🎉 Payment successful! Your subscription is now active.');
      
//       // Redirect to dashboard
//       navigate('/dashboard', { replace: true });
//     } catch (error) {
//       console.error('Error handling payment success:', error);
//     }
//   };

//   // Handle payment failure
//   const handlePaymentFailure = (error) => {
//     console.error('Payment failed:', error);
//     const errorMessage = error?.description || error?.message || 'Payment failed due to unknown error';
//     alert(`❌ Payment Failed: ${errorMessage}`);
//     setError(`Payment failed: ${errorMessage}`);
//     setProcessingPayment(false);
//     setSelectedPlanId(null);
//   };

//   // Create payment order and handle Razorpay checkout
//   const handleSelectPlan = async (plan) => {
//     console.log('Selected plan:', plan);

//     // Get user info and token from localStorage
//     const storedToken = localStorage.getItem('token');
//     const storedUserInfo = localStorage.getItem('userInfo');
    
//     if (!storedToken) {
//       setError('Please log in to continue with your subscription.');
//       return;
//     }

//     let currentUser = null;
//     try {
//       currentUser = storedUserInfo ? JSON.parse(storedUserInfo) : null;
//     } catch (e) {
//       console.error('Error parsing user info from localStorage:', e);
//     }

//     // Check if user info is available
//     if (!currentUser || !currentUser.id) {
//       setError('User information not found. Please log in again.');
//       return;
//     }

//     // Validate plan
//     if (!plan.id || !plan.price || plan.price <= 0) {
//       setError('Invalid plan selected');
//       return;
//     }

//     setProcessingPayment(true);
//     setSelectedPlanId(plan.id);
//     setError(null);

//     try {
//       // Load Razorpay script
//       const scriptLoaded = await loadRazorpayScript();
//       if (!scriptLoaded) {
//         throw new Error('Payment gateway failed to load. Please refresh and try again.');
//       }

//       console.log('Initiating subscription payment for plan ID:', plan.id);
//       console.log('Token being sent for subscription:', storedToken?.substring(0, 20) + '...');
//       console.log('Sending plan_id to backend:', plan.id);
//       console.log('User ID from localStorage:', currentUser.id);

//       // Start subscription - CORRECTED API CALL
//       const response = await fetch(`${BACKEND_BASE_URL}/subscription/start`, {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//           'Authorization': `Bearer ${storedToken}`,
//           'X-User-ID': currentUser.id.toString(),
//         },
//         body: JSON.stringify({ plan_id: plan.id }),
//       });

//       // Check if response is ok
//       if (!response.ok) {
//         const errorText = await response.text();
//         console.error('HTTP Error:', response.status, errorText);
//         throw new Error(`Server error: ${response.status} ${response.statusText}`);
//       }

//       const startSubscriptionResponse = await response.json();
//       console.log('startSubscription API response:', startSubscriptionResponse);

//       if (!startSubscriptionResponse.success) {
//         throw new Error(startSubscriptionResponse.message || startSubscriptionResponse.error || 'Failed to initiate subscription payment.');
//       }

//       // CORRECTED: Extract subscription ID from the response structure
//       const subscriptionId = startSubscriptionResponse.subscription?.id;
      
//       if (!subscriptionId) {
//         throw new Error('Invalid response from payment server. Missing subscription ID.');
//       }

//       // Configure Razorpay checkout options
//       const razorpayOptions = {
//         key: RAZORPAY_KEY_ID, // Use the environment variable key instead of expecting it from backend
//         subscription_id: subscriptionId, // Use the correct subscription ID
//         name: "NexintelAI Subscriptions",
//         description: `${plan.name} Subscription`,
//         image: "https://www.nexintelai.com/assets/img/Ai%20logo-01.png",
//         prefill: {
//           name: currentUser?.name || currentUser?.username || '',
//           email: currentUser?.email || '',
//           contact: currentUser?.phone || currentUser?.contact || ''
//         },
//         theme: {
//           color: "#1a202c"
//         },
//         handler: async function (response) {
//           console.log('Razorpay payment handler response:', response);
          
//           setProcessingPayment(true);
          
//           try {
//             // Verify the payment with the backend
//             const verificationResponse = await fetch(`${BACKEND_BASE_URL}/subscription/verify`, {
//               method: 'POST',
//               headers: {
//                 'Content-Type': 'application/json',
//                 'Authorization': `Bearer ${storedToken}`,
//               },
//               body: JSON.stringify({
//                 razorpay_payment_id: response.razorpay_payment_id,
//                 razorpay_subscription_id: response.razorpay_subscription_id,
//                 razorpay_signature: response.razorpay_signature,
//               }),
//             });

//             if (!verificationResponse.ok) {
//               const errorText = await verificationResponse.text();
//               console.error('Verification HTTP Error:', verificationResponse.status, errorText);
//               throw new Error(`Verification failed: ${verificationResponse.status} ${verificationResponse.statusText}`);
//             }

//             const verifyResult = await verificationResponse.json();
//             console.log('Verification response:', verifyResult);

//             if (verifyResult.success) {
//               await handlePaymentSuccess(plan.name, response);
//             } else {
//               throw new Error(verifyResult.message || 'Payment verification failed.');
//             }
//           } catch (verifyError) {
//             console.error('Error during payment verification:', verifyError);
//             handlePaymentFailure({ description: verifyError.message || 'Payment verification failed.' });
//           } finally {
//             setProcessingPayment(false);
//             setSelectedPlanId(null);
//           }
//         },
//         modal: {
//           ondismiss: function() {
//             console.log('Payment modal dismissed by user');
//             setProcessingPayment(false);
//             setSelectedPlanId(null);
//           },
//           escape: true,
//           backdropclose: false
//         },
//         notes: {
//           plan_id: plan.id,
//           user_id: currentUser?.id || 'anonymous'
//         }
//       };

//       console.log('Opening Razorpay checkout with options:', razorpayOptions);
      
//       // Create and open Razorpay instance
//       const razorpayInstance = new window.Razorpay(razorpayOptions);
      
//       razorpayInstance.on('payment.failed', function (response) {
//         console.error('Razorpay payment.failed event:', response);
//         handlePaymentFailure(response.error);
//       });

//       razorpayInstance.open();

//     } catch (err) {
//       console.error('Error in payment process:', err);
//       setError(err.message || 'Payment process failed. Please try again.');
//       setProcessingPayment(false);
//       setSelectedPlanId(null);
//     }
//   };

//   // Navigation handler
//   const handleGoBack = () => {
//     navigate(-1);
//   };

//   // Retry handler
//   const handleRetry = () => {
//     setError(null);
//     fetchPlans();
//   };

//   return (
//     <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
//       <div className="max-w-7xl mx-auto">
//         {/* Back button */}
//         <button
//           onClick={handleGoBack}
//           className="flex items-center text-gray-600 hover:text-gray-900 mb-8 transition-colors"
//           disabled={processingPayment}
//         >
//           <ArrowLeftIcon className="h-5 w-5 mr-2" />
//           Back
//         </button>

//         {/* Page title */}
//         <h1 className="text-4xl font-extrabold text-gray-900 text-center mb-12">
//           Plans that grow with you
//         </h1>

//         {/* Plan Type Toggle */}
//         <div className="flex justify-center mb-8">
//           <div className="inline-flex rounded-md shadow-sm">
//             <button
//               type="button"
//               className={`py-2 px-4 text-sm font-medium rounded-l-md transition-colors ${
//                 planType === 'individual'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-gray-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setPlanType('individual')}
//               disabled={loading || processingPayment}
//             >
//               Individual
//             </button>
//             <button
//               type="button"
//               className={`-ml-px py-2 px-4 text-sm font-medium rounded-r-md transition-colors ${
//                 planType === 'team'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-gray-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setPlanType('team')}
//               disabled={loading || processingPayment}
//             >
//               Team & Enterprise
//             </button>
//           </div>
//         </div>

//         {/* Billing Cycle Toggle */}
//         <div className="flex justify-center mb-12">
//           <div className="inline-flex rounded-md shadow-sm">
//             <button
//               type="button"
//               className={`py-2 px-4 text-sm font-medium rounded-l-md transition-colors ${
//                 billingCycle === 'monthly'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-gray-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setBillingCycle('monthly')}
//               disabled={loading || processingPayment}
//             >
//               Monthly
//             </button>
//             <button
//               type="button"
//               className={`-ml-px py-2 px-4 text-sm font-medium transition-colors ${
//                 billingCycle === 'yearly'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-gray-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setBillingCycle('yearly')}
//               disabled={loading || processingPayment}
//             >
//               Yearly
//             </button>
//             <button
//               type="button"
//               className={`-ml-px py-2 px-4 text-sm font-medium rounded-r-md transition-colors ${
//                 billingCycle === 'quarterly'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-gray-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setBillingCycle('quarterly')}
//               disabled={loading || processingPayment}
//             >
//               Quarterly
//             </button>
//           </div>
//         </div>

//         {/* Loading State */}
//         {loading && (
//           <div className="text-center py-12">
//             <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mb-4"></div>
//             <p className="text-gray-600">Loading subscription plans...</p>
//           </div>
//         )}

//         {/* Error State */}
//         {error && (
//           <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-8">
//             <div className="flex justify-between items-center">
//               <div className="text-red-800">{error}</div>
//               <button
//                 onClick={handleRetry}
//                 className="text-red-600 hover:text-red-500 text-sm font-medium"
//                 disabled={loading}
//               >
//                 Try Again
//               </button>
//             </div>
//           </div>
//         )}

//         {/* Empty State */}
//         {!loading && !error && plans.length === 0 && (
//           <div className="text-center py-12">
//             <p className="text-gray-600 text-lg mb-4">
//               No plans available for {planType} - {billingCycle} billing
//             </p>
//             <button
//               onClick={handleRetry}
//               className="text-blue-600 hover:text-blue-500 font-medium"
//             >
//               Refresh Plans
//             </button>
//           </div>
//         )}

//         {/* Plan Cards */}
//         {!loading && !error && plans.length > 0 && (
//           <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
//             {plans.map((plan) => {
//               const displayPrice = plan.price ? `₹${plan.price.toLocaleString()}` : 'Free';
//               const isPriceZero = !plan.price || plan.price === 0;
//               const isCurrentlyProcessing = processingPayment && selectedPlanId === plan.id;
//               const isDisabled = isPriceZero || processingPayment;

//               console.log(`Plan: ${plan.name}, ID: ${plan.id}, processingPayment: ${processingPayment}, selectedPlanId: ${selectedPlanId}, isCurrentlyProcessing: ${isCurrentlyProcessing}, isDisabled: ${isDisabled}`);

//               return (
//                 <div
//                   key={plan.id}
//                   className={`bg-white rounded-lg shadow-lg p-8 flex flex-col border transition-all duration-200 ${
//                     isCurrentlyProcessing ? 'ring-2 ring-blue-500 shadow-xl' : 'hover:shadow-xl'
//                   }`}
//                 >
//                   {/* Plan Icon */}
//                   <div className="flex-shrink-0 mb-4">
//                     <div className="h-12 w-12 bg-gray-100 rounded-lg flex items-center justify-center">
//                       <svg className="h-6 w-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
//                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.592 1L21 12h-4m-7 0h-4" />
//                       </svg>
//                     </div>
//                   </div>
                  
//                   {/* Plan Details */}
//                   <h2 className="text-2xl font-bold text-gray-900 mb-2">{plan.name}</h2>
//                   <p className="text-gray-500 text-sm mb-6 flex-grow">
//                     {plan.description || plan.tagline || 'Subscription plan'}
//                   </p>
                  
//                   {/* Pricing */}
//                   <div className="flex items-baseline mb-6">
//                     <span className="text-4xl font-extrabold text-gray-900">
//                       {displayPrice}
//                     </span>
//                     {!isPriceZero && (
//                       <span className="ml-1 text-gray-500 text-base">
//                         /{billingCycle === 'monthly' ? 'month' : billingCycle === 'yearly' ? 'year' : 'quarter'}
//                       </span>
//                     )}
//                   </div>
                  
//                   {/* CTA Button */}
//                   <button
//                     onClick={() => handleSelectPlan(plan)}
//                     disabled={isDisabled}
//                     className={`w-full py-3 px-6 rounded-md text-base font-medium transition-all duration-200 mb-6 ${
//                       isDisabled
//                         ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
//                         : 'bg-gray-900 text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2'
//                     }`}
//                   >
//                     {isCurrentlyProcessing ? (
//                       <div className="flex items-center justify-center">
//                         <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
//                         Processing...
//                       </div>
//                     ) : isPriceZero ? (
//                       'Free Plan'
//                     ) : (
//                       'Select Plan'
//                     )}
//                   </button>
                  
//                   {/* Features List */}
//                   <div className="flex-1">
//                     <ul className="space-y-3">
//                       {plan.features ? (
//                         (typeof plan.features === 'string' ?
//                          plan.features.split(',').map(f => f.trim()).filter(f => f) :
//                          Array.isArray(plan.features) ? plan.features : []
//                         ).map((feature, index) => (
//                           <li key={index} className="flex items-start">
//                             <CheckIcon className="h-5 w-5 text-green-500 flex-shrink-0 mr-3 mt-0.5" />
//                             <span className="text-gray-700 text-sm">{feature}</span>
//                           </li>
//                         ))
//                       ) : (
//                         <li className="text-gray-500 text-sm italic">No features listed</li>
//                       )}
//                     </ul>
//                   </div>
//                 </div>
//               );
//             })}
//           </div>
//         )}
//       </div>
//     </div>
//   );
// };

// export default SubscriptionPlanPage;


// import React, { useState, useEffect, useCallback } from 'react';
// import { CheckIcon } from '@heroicons/react/20/solid';
// import { ArrowLeftIcon } from '@heroicons/react/24/outline';
// import { useNavigate } from 'react-router-dom';
// import apiService from '../services/api';
// import { useAuth } from '../context/AuthContext';

// // Razorpay Configuration
// const RAZORPAY_KEY_ID = import.meta.env.VITE_APP_RAZORPAY_KEY_ID || 'rzp_test_R6mBF5iIMakFt1';
// const BACKEND_BASE_URL = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000/payments';

// console.log('Environment variables:', { RAZORPAY_KEY_ID, BACKEND_BASE_URL });
// console.log(`[Razorpay Debug] Using RAZORPAY_KEY_ID: ${RAZORPAY_KEY_ID}`);

// const SubscriptionPlanPage = () => {
//   const navigate = useNavigate();
//   const { user, token, loading: authLoading } = useAuth();
  
//   // State management
//   const [billingCycle, setBillingCycle] = useState('yearly');
//   const [planType, setPlanType] = useState('individual');
//   const [plans, setPlans] = useState([]);
//   const [loading, setLoading] = useState(true);
//   const [error, setError] = useState(null);
//   const [processingPayment, setProcessingPayment] = useState(false);
//   const [selectedPlanId, setSelectedPlanId] = useState(null);

//   // Fetch plans from API
//   const fetchPlans = useCallback(async () => {
//     console.log('Fetching plans for:', { planType, billingCycle });
//     setLoading(true);
//     setError(null);
    
//     try {
//       const response = await apiService.getPublicPlans();
//       console.log('API response:', response);
      
//       if (response?.success && Array.isArray(response.data)) {
//         // Filter plans based on selected criteria
//         const filteredPlans = response.data.filter(plan => {
//           // Type matching
//           const matchesType = (planType === 'team' && plan.type === 'business') || 
//                              (planType === 'individual' && plan.type === 'individual');
          
//           // Interval matching - normalize interval names
//           const planInterval = plan.interval?.toLowerCase();
//           const matchesInterval = (billingCycle === 'monthly' && ['month', 'monthly'].includes(planInterval)) ||
//                                  (billingCycle === 'yearly' && ['year', 'yearly', 'annual'].includes(planInterval)) ||
//                                  (billingCycle === 'quarterly' && ['quarter', 'quarterly'].includes(planInterval));
          
//           console.log(`Plan ${plan.name}: type=${plan.type}, interval=${planInterval}, matchesType=${matchesType}, matchesInterval=${matchesInterval}`);
//           return matchesType && matchesInterval;
//         });
        
//         console.log('Filtered plans:', filteredPlans);
//         setPlans(filteredPlans);
//       } else {
//         throw new Error('Invalid response format from server');
//       }
//     } catch (err) {
//       console.error('Error fetching plans:', err);
//       setError(`Failed to fetch plans: ${err.message}`);
//     } finally {
//       setLoading(false);
//     }
//   }, [planType, billingCycle]);

//   useEffect(() => {
//     fetchPlans();
//   }, [fetchPlans]);

//   // Load Razorpay script dynamically
//   const loadRazorpayScript = () => {
//     return new Promise((resolve) => {
//       // Check if Razorpay is already loaded
//       if (window.Razorpay) {
//         console.log('Razorpay already loaded');
//         return resolve(true);
//       }
      
//       // Check if script is already in DOM
//       if (document.getElementById('razorpay-script')) {
//         console.log('Razorpay script already in DOM');
//         return resolve(true);
//       }
      
//       console.log('Loading Razorpay script...');
//       const script = document.createElement('script');
//       script.id = 'razorpay-script';
//       script.src = 'https://checkout.razorpay.com/v1/checkout.js';
//       script.onload = () => {
//         console.log('Razorpay script loaded successfully');
//         resolve(true);
//       };
//       script.onerror = (error) => {
//         console.error('Failed to load Razorpay script:', error);
//         resolve(false);
//       };
//       document.body.appendChild(script);
//     });
//   };

//   // Handle payment success
//   const handlePaymentSuccess = async (planName, paymentData) => {
//     try {
//       console.log('Payment successful:', paymentData);
      
//       // Update local storage
//       const userInfo = JSON.parse(localStorage.getItem('userInfo') || '{}');
//       userInfo.plan = planName;
//       userInfo.lastPayment = {
//         id: paymentData.razorpay_payment_id,
//         subscription_id: paymentData.razorpay_subscription_id,
//         date: new Date().toISOString()
//       };
//       localStorage.setItem('userInfo', JSON.stringify(userInfo));
      
//       // Dispatch event for other components
//       window.dispatchEvent(new CustomEvent('userInfoUpdated', { detail: userInfo }));
      
//       // Show success message
//       alert('🎉 Payment successful! Your subscription is now active.');
      
//       // Redirect to dashboard
//       navigate('/dashboard', { replace: true });
//     } catch (error) {
//       console.error('Error handling payment success:', error);
//     }
//   };

//   // Handle payment failure
//   const handlePaymentFailure = (error) => {
//     console.error('Payment failed:', error);
//     const errorMessage = error?.description || error?.message || 'Payment failed due to unknown error';
//     alert(`❌ Payment Failed: ${errorMessage}`);
//     setError(`Payment failed: ${errorMessage}`);
//     setProcessingPayment(false);
//     setSelectedPlanId(null);
//   };

//   // Create payment order and handle Razorpay checkout
//   const handleSelectPlan = async (plan) => {
//     console.log('Selected plan:', plan);

//     // Debug localStorage contents
//     console.log('All localStorage keys:', Object.keys(localStorage));
//     console.log('token:', localStorage.getItem('token'));
//     console.log('userInfo:', localStorage.getItem('userInfo'));
//     console.log('user:', localStorage.getItem('user'));
//     console.log('userData:', localStorage.getItem('userData'));
//     console.log('authUser:', localStorage.getItem('authUser'));

//     // Get user info and token from localStorage
//     const storedToken = localStorage.getItem('token');
    
//     if (!storedToken) {
//       setError('Please log in to continue with your subscription.');
//       return;
//     }

//     // Try different possible keys for user information
//     let currentUser = null;
//     const possibleUserKeys = ['userInfo', 'user', 'userData', 'authUser'];
    
//     for (const key of possibleUserKeys) {
//       const storedData = localStorage.getItem(key);
//       if (storedData) {
//         try {
//           const parsedData = JSON.parse(storedData);
//           console.log(`Found user data in ${key}:`, parsedData);
          
//           // Check if this object has an id property (directly or nested)
//           if (parsedData.id) {
//             currentUser = parsedData;
//             console.log(`Using user data from ${key}`);
//             break;
//           } else if (parsedData.user && parsedData.user.id) {
//             currentUser = parsedData.user;
//             console.log(`Using nested user data from ${key}.user`);
//             break;
//           } else if (parsedData.data && parsedData.data.id) {
//             currentUser = parsedData.data;
//             console.log(`Using nested user data from ${key}.data`);
//             break;
//           }
//         } catch (e) {
//           console.error(`Error parsing ${key} from localStorage:`, e);
//         }
//       }
//     }

//     // Fallback: try to get user from AuthContext if available
//     if (!currentUser && user && user.id) {
//       currentUser = user;
//       console.log('Using user from AuthContext as fallback');
//     }

//     // Check if user info is available
//     if (!currentUser || !currentUser.id) {
//       console.error('No valid user found in localStorage or AuthContext');
//       console.log('Available localStorage keys:', Object.keys(localStorage));
//       setError('User information not found. Please log in again.');
//       return;
//     }

//     console.log('Final currentUser object:', currentUser);

//     // Validate plan
//     if (!plan.id || !plan.price || plan.price <= 0) {
//       setError('Invalid plan selected');
//       return;
//     }

//     setProcessingPayment(true);
//     setSelectedPlanId(plan.id);
//     setError(null);

//     try {
//       // Load Razorpay script
//       const scriptLoaded = await loadRazorpayScript();
//       if (!scriptLoaded) {
//         throw new Error('Payment gateway failed to load. Please refresh and try again.');
//       }

//       console.log('Initiating subscription payment for plan ID:', plan.id);
//       console.log('Token being sent for subscription:', storedToken?.substring(0, 20) + '...');
//       console.log('Sending plan_id to backend:', plan.id);
//       console.log('User ID from localStorage:', currentUser.id);

//       // Start subscription - CORRECTED API CALL
//       const response = await fetch(`${BACKEND_BASE_URL}/subscription/start`, {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//           'Authorization': `Bearer ${storedToken}`,
//           'X-User-ID': currentUser.id.toString(),
//         },
//         body: JSON.stringify({ plan_id: plan.id }),
//       });

//       // Check if response is ok
//       if (!response.ok) {
//         const errorText = await response.text();
//         console.error('HTTP Error:', response.status, errorText);
//         throw new Error(`Server error: ${response.status} ${response.statusText}`);
//       }

//       const startSubscriptionResponse = await response.json();
//       console.log('[Razorpay Debug] startSubscription API raw response:', startSubscriptionResponse);

//       if (!startSubscriptionResponse.success) {
//         throw new Error(startSubscriptionResponse.message || startSubscriptionResponse.error || 'Failed to initiate subscription payment.');
//       }

//       // CORRECTED: Extract subscription ID from the response structure
//       const subscriptionId = startSubscriptionResponse.subscription?.id;
      
//       if (!subscriptionId) {
//         console.error('[Razorpay Debug] Missing subscription ID in startSubscription response:', startSubscriptionResponse);
//         throw new Error('Invalid response from payment server. Missing subscription ID.');
//       }
//       console.log(`[Razorpay Debug] Received subscriptionId from backend: ${subscriptionId}`);

//       // Configure Razorpay checkout options
//       const razorpayOptions = {
//         key: RAZORPAY_KEY_ID, // Use the environment variable key instead of expecting it from backend
//         subscription_id: subscriptionId, // Use the correct subscription ID
//         name: "NexintelAI Subscriptions",
//         description: `${plan.name} Subscription`,
//         image: "https://www.nexintelai.com/assets/img/Ai%20logo-01.png",
//         prefill: {
//           name: currentUser?.name || currentUser?.username || '',
//           email: currentUser?.email || '',
//           contact: currentUser?.phone || currentUser?.contact || ''
//         },
//         theme: {
//           color: "#1a202c"
//         },
//         handler: async function (response) {
//           console.log('Razorpay payment handler response:', response);
          
//           setProcessingPayment(true);
          
//           try {
//             // Verify the payment with the backend
//             const verificationResponse = await fetch(`${BACKEND_BASE_URL}/subscription/verify`, {
//               method: 'POST',
//               headers: {
//                 'Content-Type': 'application/json',
//                 'Authorization': `Bearer ${storedToken}`,
//               },
//               body: JSON.stringify({
//                 razorpay_payment_id: response.razorpay_payment_id,
//                 razorpay_subscription_id: response.razorpay_subscription_id,
//                 razorpay_signature: response.razorpay_signature,
//               }),
//             });

//             if (!verificationResponse.ok) {
//               const errorText = await verificationResponse.text();
//               console.error('Verification HTTP Error:', verificationResponse.status, errorText);
//               throw new Error(`Verification failed: ${verificationResponse.status} ${verificationResponse.statusText}`);
//             }

//             const verifyResult = await verificationResponse.json();
//             console.log('Verification response:', verifyResult);

//             if (verifyResult.success) {
//               await handlePaymentSuccess(plan.name, response);
//             } else {
//               throw new Error(verifyResult.message || 'Payment verification failed.');
//             }
//           } catch (verifyError) {
//             console.error('Error during payment verification:', verifyError);
//             handlePaymentFailure({ description: verifyError.message || 'Payment verification failed.' });
//           } finally {
//             setProcessingPayment(false);
//             setSelectedPlanId(null);
//           }
//         },
//         modal: {
//           ondismiss: function() {
//             console.log('Payment modal dismissed by user');
//             setProcessingPayment(false);
//             setSelectedPlanId(null);
//           },
//           escape: true,
//           backdropclose: false
//         },
//         notes: {
//           plan_id: plan.id,
//           user_id: currentUser?.id || 'anonymous'
//         }
//       };

//       console.log('Opening Razorpay checkout with options:', razorpayOptions);
      
//       // Create and open Razorpay instance
//       const razorpayInstance = new window.Razorpay(razorpayOptions);
      
//       razorpayInstance.on('payment.failed', function (response) {
//         console.error('Razorpay payment.failed event:', response);
//         handlePaymentFailure(response.error);
//       });

//       razorpayInstance.open();

//     } catch (err) {
//       console.error('Error in payment process:', err);
//       setError(err.message || 'Payment process failed. Please try again.');
//       setProcessingPayment(false);
//       setSelectedPlanId(null);
//     }
//   };

//   // Navigation handler
//   const handleGoBack = () => {
//     navigate(-1);
//   };

//   // Retry handler
//   const handleRetry = () => {
//     setError(null);
//     fetchPlans();
//   };

//   return (
//     <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
//       <div className="max-w-7xl mx-auto">
//         {/* Back button */}
//         <button
//           onClick={handleGoBack}
//           className="flex items-center text-gray-600 hover:text-gray-900 mb-8 transition-colors"
//           disabled={processingPayment}
//         >
//           <ArrowLeftIcon className="h-5 w-5 mr-2" />
//           Back
//         </button>

//         {/* Page title */}
//         <h1 className="text-4xl font-extrabold text-gray-900 text-center mb-12">
//           Plans that grow with you
//         </h1>

//         {/* Plan Type Toggle */}
//         <div className="flex justify-center mb-8">
//           <div className="inline-flex rounded-md shadow-sm">
//             <button
//               type="button"
//               className={`py-2 px-4 text-sm font-medium rounded-l-md transition-colors ${
//                 planType === 'individual'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-gray-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setPlanType('individual')}
//               disabled={loading || processingPayment}
//             >
//               Individual
//             </button>
//             <button
//               type="button"
//               className={`-ml-px py-2 px-4 text-sm font-medium rounded-r-md transition-colors ${
//                 planType === 'team'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-gray-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setPlanType('team')}
//               disabled={loading || processingPayment}
//             >
//               Team & Enterprise
//             </button>
//           </div>
//         </div>

//         {/* Billing Cycle Toggle */}
//         <div className="flex justify-center mb-12">
//           <div className="inline-flex rounded-md shadow-sm">
//             <button
//               type="button"
//               className={`py-2 px-4 text-sm font-medium rounded-l-md transition-colors ${
//                 billingCycle === 'monthly'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-gray-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setBillingCycle('monthly')}
//               disabled={loading || processingPayment}
//             >
//               Monthly
//             </button>
//             <button
//               type="button"
//               className={`-ml-px py-2 px-4 text-sm font-medium transition-colors ${
//                 billingCycle === 'yearly'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-gray-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setBillingCycle('yearly')}
//               disabled={loading || processingPayment}
//             >
//               Yearly
//             </button>
//             <button
//               type="button"
//               className={`-ml-px py-2 px-4 text-sm font-medium rounded-r-md transition-colors ${
//                 billingCycle === 'quarterly'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-gray-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setBillingCycle('quarterly')}
//               disabled={loading || processingPayment}
//             >
//               Quarterly
//             </button>
//           </div>
//         </div>

//         {/* Loading State */}
//         {loading && (
//           <div className="text-center py-12">
//             <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mb-4"></div>
//             <p className="text-gray-600">Loading subscription plans...</p>
//           </div>
//         )}

//         {/* Error State */}
//         {error && (
//           <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-8">
//             <div className="flex justify-between items-center">
//               <div className="text-red-800">{error}</div>
//               <button
//                 onClick={handleRetry}
//                 className="text-red-600 hover:text-red-500 text-sm font-medium"
//                 disabled={loading}
//               >
//                 Try Again
//               </button>
//             </div>
//           </div>
//         )}

//         {/* Empty State */}
//         {!loading && !error && plans.length === 0 && (
//           <div className="text-center py-12">
//             <p className="text-gray-600 text-lg mb-4">
//               No plans available for {planType} - {billingCycle} billing
//             </p>
//             <button
//               onClick={handleRetry}
//               className="text-blue-600 hover:text-blue-500 font-medium"
//             >
//               Refresh Plans
//             </button>
//           </div>
//         )}

//         {/* Plan Cards */}
//         {!loading && !error && plans.length > 0 && (
//           <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
//             {plans.map((plan) => {
//               const displayPrice = plan.price ? `₹${plan.price.toLocaleString()}` : 'Free';
//               const isPriceZero = !plan.price || plan.price === 0;
//               const isCurrentlyProcessing = processingPayment && selectedPlanId === plan.id;
//               const isDisabled = isPriceZero || processingPayment;

//               console.log(`Plan: ${plan.name}, ID: ${plan.id}, processingPayment: ${processingPayment}, selectedPlanId: ${selectedPlanId}, isCurrentlyProcessing: ${isCurrentlyProcessing}, isDisabled: ${isDisabled}`);

//               return (
//                 <div
//                   key={plan.id}
//                   className={`bg-white rounded-lg shadow-lg p-8 flex flex-col border transition-all duration-200 ${
//                     isCurrentlyProcessing ? 'ring-2 ring-blue-500 shadow-xl' : 'hover:shadow-xl'
//                   }`}
//                 >
//                   {/* Plan Icon */}
//                   <div className="flex-shrink-0 mb-4">
//                     <div className="h-12 w-12 bg-gray-100 rounded-lg flex items-center justify-center">
//                       <svg className="h-6 w-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
//                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.592 1L21 12h-4m-7 0h-4" />
//                       </svg>
//                     </div>
//                   </div>
                  
//                   {/* Plan Details */}
//                   <h2 className="text-2xl font-bold text-gray-900 mb-2">{plan.name}</h2>
//                   <p className="text-gray-500 text-sm mb-6 flex-grow">
//                     {plan.description || plan.tagline || 'Subscription plan'}
//                   </p>
                  
//                   {/* Pricing */}
//                   <div className="flex items-baseline mb-6">
//                     <span className="text-4xl font-extrabold text-gray-900">
//                       {displayPrice}
//                     </span>
//                     {!isPriceZero && (
//                       <span className="ml-1 text-gray-500 text-base">
//                         /{billingCycle === 'monthly' ? 'month' : billingCycle === 'yearly' ? 'year' : 'quarter'}
//                       </span>
//                     )}
//                   </div>
                  
//                   {/* CTA Button */}
//                   <button
//                     onClick={() => handleSelectPlan(plan)}
//                     disabled={isDisabled}
//                     className={`w-full py-3 px-6 rounded-md text-base font-medium transition-all duration-200 mb-6 ${
//                       isDisabled
//                         ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
//                         : 'bg-gray-900 text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2'
//                     }`}
//                   >
//                     {isCurrentlyProcessing ? (
//                       <div className="flex items-center justify-center">
//                         <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
//                         Processing...
//                       </div>
//                     ) : isPriceZero ? (
//                       'Free Plan'
//                     ) : (
//                       'Select Plan'
//                     )}
//                   </button>
                  
//                   {/* Features List */}
//                   <div className="flex-1">
//                     <ul className="space-y-3">
//                       {plan.features ? (
//                         (typeof plan.features === 'string' ?
//                          plan.features.split(',').map(f => f.trim()).filter(f => f) :
//                          Array.isArray(plan.features) ? plan.features : []
//                         ).map((feature, index) => (
//                           <li key={index} className="flex items-start">
//                             <CheckIcon className="h-5 w-5 text-green-500 flex-shrink-0 mr-3 mt-0.5" />
//                             <span className="text-gray-700 text-sm">{feature}</span>
//                           </li>
//                         ))
//                       ) : (
//                         <li className="text-gray-500 text-sm italic">No features listed</li>
//                       )}
//                     </ul>
//                   </div>
//                 </div>
//               );
//             })}
//           </div>
//         )}
//       </div>
//     </div>
//   );
// };

// export default SubscriptionPlanPage;

// import React, { useState, useEffect, useCallback } from 'react';
// import { CheckIcon } from '@heroicons/react/20/solid';
// import { ArrowLeftIcon } from '@heroicons/react/24/outline';
// import { useNavigate } from 'react-router-dom';
// import apiService from '../services/api';
// import { useAuth } from '../context/AuthContext';

// // FIXED: Remove hardcoded test key - get from environment or backend
// const BACKEND_BASE_URL = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000/payments';

// console.log('Environment variables:', { BACKEND_BASE_URL });

// const SubscriptionPlanPage = () => {
//   const navigate = useNavigate();
//   const { user, token, loading: authLoading } = useAuth();
  
//   // State management
//   const [billingCycle, setBillingCycle] = useState('yearly');
//   const [planType, setPlanType] = useState('individual');
//   const [plans, setPlans] = useState([]);
//   const [loading, setLoading] = useState(true);
//   const [error, setError] = useState(null);
//   const [processingPayment, setProcessingPayment] = useState(false);
//   const [selectedPlanId, setSelectedPlanId] = useState(null);

//   // Fetch plans from API
//   const fetchPlans = useCallback(async () => {
//     console.log('Fetching plans for:', { planType, billingCycle });
//     setLoading(true);
//     setError(null);
    
//     try {
//       const response = await apiService.getPublicPlans();
//       console.log('API response:', response);
      
//       if (response?.success && Array.isArray(response.data)) {
//         // Filter plans based on selected criteria
//         const filteredPlans = response.data.filter(plan => {
//           // Type matching
//           const matchesType = (planType === 'team' && plan.type === 'business') || 
//                              (planType === 'individual' && plan.type === 'individual');
          
//           // Interval matching - normalize interval names
//           const planInterval = plan.interval?.toLowerCase();
//           const matchesInterval = (billingCycle === 'monthly' && ['month', 'monthly'].includes(planInterval)) ||
//                                  (billingCycle === 'yearly' && ['year', 'yearly', 'annual'].includes(planInterval)) ||
//                                  (billingCycle === 'quarterly' && ['quarter', 'quarterly'].includes(planInterval));
          
//           console.log(`Plan ${plan.name}: type=${plan.type}, interval=${planInterval}, matchesType=${matchesType}, matchesInterval=${matchesInterval}`);
//           return matchesType && matchesInterval;
//         });
        
//         console.log('Filtered plans:', filteredPlans);
//         setPlans(filteredPlans);
//       } else {
//         throw new Error('Invalid response format from server');
//       }
//     } catch (err) {
//       console.error('Error fetching plans:', err);
//       setError(`Failed to fetch plans: ${err.message}`);
//     } finally {
//       setLoading(false);
//     }
//   }, [planType, billingCycle]);

//   useEffect(() => {
//     fetchPlans();
//   }, [fetchPlans]);

//   // Load Razorpay script dynamically
//   const loadRazorpayScript = () => {
//     return new Promise((resolve) => {
//       // Check if Razorpay is already loaded
//       if (window.Razorpay) {
//         console.log('Razorpay already loaded');
//         return resolve(true);
//       }
      
//       // Check if script is already in DOM
//       if (document.getElementById('razorpay-script')) {
//         console.log('Razorpay script already in DOM');
//         return resolve(true);
//       }
      
//       console.log('Loading Razorpay script...');
//       const script = document.createElement('script');
//       script.id = 'razorpay-script';
//       script.src = 'https://checkout.razorpay.com/v1/checkout.js';
//       script.onload = () => {
//         console.log('Razorpay script loaded successfully');
//         resolve(true);
//       };
//       script.onerror = (error) => {
//         console.error('Failed to load Razorpay script:', error);
//         resolve(false);
//       };
//       document.body.appendChild(script);
//     });
//   };

//   // Handle payment success
//   const handlePaymentSuccess = async (planName, paymentData) => {
//     try {
//       console.log('Payment successful:', paymentData);
      
//       // Update local storage
//       const userInfo = JSON.parse(localStorage.getItem('userInfo') || '{}');
//       userInfo.plan = planName;
//       userInfo.lastPayment = {
//         id: paymentData.razorpay_payment_id,
//         subscription_id: paymentData.razorpay_subscription_id,
//         date: new Date().toISOString()
//       };
//       localStorage.setItem('userInfo', JSON.stringify(userInfo));
      
//       // Dispatch event for other components
//       window.dispatchEvent(new CustomEvent('userInfoUpdated', { detail: userInfo }));
      
//       // Show success message
//       alert('🎉 Payment successful! Your subscription is now active.');
      
//       // Redirect to dashboard
//       navigate('/dashboard', { replace: true });
//     } catch (error) {
//       console.error('Error handling payment success:', error);
//     }
//   };

//   // Handle payment failure
//   const handlePaymentFailure = (error) => {
//     console.error('Payment failed:', error);
//     const errorMessage = error?.description || error?.message || 'Payment failed due to unknown error';
//     alert(`❌ Payment Failed: ${errorMessage}`);
//     setError(`Payment failed: ${errorMessage}`);
//     setProcessingPayment(false);
//     setSelectedPlanId(null);
//   };

//   // Create payment order and handle Razorpay checkout
//   const handleSelectPlan = async (plan) => {
//     console.log('Selected plan:', plan);

//     // Debug localStorage contents
//     console.log('All localStorage keys:', Object.keys(localStorage));
//     console.log('token:', localStorage.getItem('token'));
//     console.log('userInfo:', localStorage.getItem('userInfo'));

//     // Get user info and token from localStorage
//     const storedToken = localStorage.getItem('token');
    
//     if (!storedToken) {
//       setError('Please log in to continue with your subscription.');
//       return;
//     }

//     // Try different possible keys for user information
//     let currentUser = null;
//     const possibleUserKeys = ['userInfo', 'user', 'userData', 'authUser'];
    
//     for (const key of possibleUserKeys) {
//       const storedData = localStorage.getItem(key);
//       if (storedData) {
//         try {
//           const parsedData = JSON.parse(storedData);
//           console.log(`Found user data in ${key}:`, parsedData);
          
//           // Check if this object has an id property (directly or nested)
//           if (parsedData.id) {
//             currentUser = parsedData;
//             console.log(`Using user data from ${key}`);
//             break;
//           } else if (parsedData.user && parsedData.user.id) {
//             currentUser = parsedData.user;
//             console.log(`Using nested user data from ${key}.user`);
//             break;
//           } else if (parsedData.data && parsedData.data.id) {
//             currentUser = parsedData.data;
//             console.log(`Using nested user data from ${key}.data`);
//             break;
//           }
//         } catch (e) {
//           console.error(`Error parsing ${key} from localStorage:`, e);
//         }
//       }
//     }

//     // Fallback: try to get user from AuthContext if available
//     if (!currentUser && user && user.id) {
//       currentUser = user;
//       console.log('Using user from AuthContext as fallback');
//     }

//     // Check if user info is available
//     if (!currentUser || !currentUser.id) {
//       console.error('No valid user found in localStorage or AuthContext');
//       console.log('Available localStorage keys:', Object.keys(localStorage));
//       setError('User information not found. Please log in again.');
//       return;
//     }

//     console.log('Final currentUser object:', currentUser);

//     // Validate plan
//     if (!plan.id || !plan.price || plan.price <= 0) {
//       setError('Invalid plan selected');
//       return;
//     }

//     setProcessingPayment(true);
//     setSelectedPlanId(plan.id);
//     setError(null);

//     try {
//       // Load Razorpay script
//       const scriptLoaded = await loadRazorpayScript();
//       if (!scriptLoaded) {
//         throw new Error('Payment gateway failed to load. Please refresh and try again.');
//       }

//       console.log('Initiating subscription payment for plan ID:', plan.id);
//       console.log('Token being sent for subscription:', storedToken?.substring(0, 20) + '...');
//       console.log('User ID from localStorage:', currentUser.id);

//       // Start subscription
//       const response = await fetch(`${BACKEND_BASE_URL}/subscription/start`, {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//           'Authorization': `Bearer ${storedToken}`,
//           'X-User-ID': currentUser.id.toString(),
//         },
//         body: JSON.stringify({ plan_id: plan.id }),
//       });

//       // Check if response is ok
//       if (!response.ok) {
//         const errorText = await response.text();
//         console.error('HTTP Error:', response.status, errorText);
//         throw new Error(`Server error: ${response.status} ${response.statusText}`);
//       }

//       const startSubscriptionResponse = await response.json();
//       console.log('[Razorpay Debug] startSubscription API raw response:', startSubscriptionResponse);

//       if (!startSubscriptionResponse.success) {
//         throw new Error(startSubscriptionResponse.message || startSubscriptionResponse.error || 'Failed to initiate subscription payment.');
//       }

//       // Extract subscription ID and Razorpay key from the response
//       const subscriptionId = startSubscriptionResponse.subscription?.id;
//       const razorpayKeyId = startSubscriptionResponse.subscription?.key; // FIXED: Get key from backend
      
//       if (!subscriptionId) {
//         console.error('[Razorpay Debug] Missing subscription ID in startSubscription response:', startSubscriptionResponse);
//         throw new Error('Invalid response from payment server. Missing subscription ID.');
//       }

//       if (!razorpayKeyId) {
//         console.error('[Razorpay Debug] Missing Razorpay key in startSubscription response:', startSubscriptionResponse);
//         throw new Error('Invalid response from payment server. Missing Razorpay key.');
//       }

//       console.log(`[Razorpay Debug] Received subscriptionId: ${subscriptionId}`);
//       console.log(`[Razorpay Debug] Received Razorpay key: ${razorpayKeyId}`);

//       // FIXED: Configure Razorpay checkout options with key from backend
//       const razorpayOptions = {
//         key: razorpayKeyId, // Use the key from backend response (live key)
//         subscription_id: subscriptionId,
//         name: "NexintelAI Subscriptions",
//         description: `${plan.name} Subscription`,
//         image: "https://www.nexintelai.com/assets/img/Ai%20logo-01.png",
//         prefill: {
//           name: currentUser?.name || currentUser?.username || '',
//           email: currentUser?.email || '',
//           contact: currentUser?.phone || currentUser?.contact || ''
//         },
//         theme: {
//           color: "#1a202c"
//         },
//         handler: async function (response) {
//           console.log('Razorpay payment handler response:', response);
          
//           setProcessingPayment(true);
          
//           try {
//             // Verify the payment with the backend
//             const verificationResponse = await fetch(`${BACKEND_BASE_URL}/subscription/verify`, {
//               method: 'POST',
//               headers: {
//                 'Content-Type': 'application/json',
//                 'Authorization': `Bearer ${storedToken}`,
//               },
//               body: JSON.stringify({
//                 razorpay_payment_id: response.razorpay_payment_id,
//                 razorpay_subscription_id: response.razorpay_subscription_id,
//                 razorpay_signature: response.razorpay_signature,
//               }),
//             });

//             if (!verificationResponse.ok) {
//               const errorText = await verificationResponse.text();
//               console.error('Verification HTTP Error:', verificationResponse.status, errorText);
//               throw new Error(`Verification failed: ${verificationResponse.status} ${verificationResponse.statusText}`);
//             }

//             const verifyResult = await verificationResponse.json();
//             console.log('Verification response:', verifyResult);

//             if (verifyResult.success) {
//               await handlePaymentSuccess(plan.name, response);
//             } else {
//               throw new Error(verifyResult.message || 'Payment verification failed.');
//             }
//           } catch (verifyError) {
//             console.error('Error during payment verification:', verifyError);
//             handlePaymentFailure({ description: verifyError.message || 'Payment verification failed.' });
//           } finally {
//             setProcessingPayment(false);
//             setSelectedPlanId(null);
//           }
//         },
//         modal: {
//           ondismiss: function() {
//             console.log('Payment modal dismissed by user');
//             setProcessingPayment(false);
//             setSelectedPlanId(null);
//           },
//           escape: true,
//           backdropclose: false
//         },
//         notes: {
//           plan_id: plan.id,
//           user_id: currentUser?.id || 'anonymous'
//         }
//       };

//       console.log('Opening Razorpay checkout with options:', razorpayOptions);
      
//       // Create and open Razorpay instance
//       const razorpayInstance = new window.Razorpay(razorpayOptions);
      
//       razorpayInstance.on('payment.failed', function (response) {
//         console.error('Razorpay payment.failed event:', response);
//         handlePaymentFailure(response.error);
//       });

//       razorpayInstance.open();

//     } catch (err) {
//       console.error('Error in payment process:', err);
//       setError(err.message || 'Payment process failed. Please try again.');
//       setProcessingPayment(false);
//       setSelectedPlanId(null);
//     }
//   };

//   // Navigation handler
//   const handleGoBack = () => {
//     navigate(-1);
//   };

//   // Retry handler
//   const handleRetry = () => {
//     setError(null);
//     fetchPlans();
//   };

//   return (
//     <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
//       <div className="max-w-7xl mx-auto">
//         {/* Back button */}
//         <button
//           onClick={handleGoBack}
//           className="flex items-center text-gray-600 hover:text-gray-900 mb-8 transition-colors"
//           disabled={processingPayment}
//         >
//           <ArrowLeftIcon className="h-5 w-5 mr-2" />
//           Back
//         </button>

//         {/* Page title */}
//         <h1 className="text-4xl font-extrabold text-gray-900 text-center mb-12">
//           Plans that grow with you
//         </h1>

//         {/* Plan Type Toggle */}
//         <div className="flex justify-center mb-8">
//           <div className="inline-flex rounded-md shadow-sm">
//             <button
//               type="button"
//               className={`py-2 px-4 text-sm font-medium rounded-l-md transition-colors ${
//                 planType === 'individual'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-gray-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setPlanType('individual')}
//               disabled={loading || processingPayment}
//             >
//               Individual
//             </button>
//             <button
//               type="button"
//               className={`-ml-px py-2 px-4 text-sm font-medium rounded-r-md transition-colors ${
//                 planType === 'team'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-gray-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setPlanType('team')}
//               disabled={loading || processingPayment}
//             >
//               Team & Enterprise
//             </button>
//           </div>
//         </div>

//         {/* Billing Cycle Toggle */}
//         <div className="flex justify-center mb-12">
//           <div className="inline-flex rounded-md shadow-sm">
//             <button
//               type="button"
//               className={`py-2 px-4 text-sm font-medium rounded-l-md transition-colors ${
//                 billingCycle === 'monthly'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-gray-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setBillingCycle('monthly')}
//               disabled={loading || processingPayment}
//             >
//               Monthly
//             </button>
//             <button
//               type="button"
//               className={`-ml-px py-2 px-4 text-sm font-medium transition-colors ${
//                 billingCycle === 'yearly'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-gray-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setBillingCycle('yearly')}
//               disabled={loading || processingPayment}
//             >
//               Yearly
//             </button>
//             <button
//               type="button"
//               className={`-ml-px py-2 px-4 text-sm font-medium rounded-r-md transition-colors ${
//                 billingCycle === 'quarterly'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-gray-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setBillingCycle('quarterly')}
//               disabled={loading || processingPayment}
//             >
//               Quarterly
//             </button>
//           </div>
//         </div>

//         {/* Loading State */}
//         {loading && (
//           <div className="text-center py-12">
//             <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mb-4"></div>
//             <p className="text-gray-600">Loading subscription plans...</p>
//           </div>
//         )}

//         {/* Error State */}
//         {error && (
//           <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-8">
//             <div className="flex justify-between items-center">
//               <div className="text-red-800">{error}</div>
//               <button
//                 onClick={handleRetry}
//                 className="text-red-600 hover:text-red-500 text-sm font-medium"
//                 disabled={loading}
//               >
//                 Try Again
//               </button>
//             </div>
//           </div>
//         )}

//         {/* Empty State */}
//         {!loading && !error && plans.length === 0 && (
//           <div className="text-center py-12">
//             <p className="text-gray-600 text-lg mb-4">
//               No plans available for {planType} - {billingCycle} billing
//             </p>
//             <button
//               onClick={handleRetry}
//               className="text-blue-600 hover:text-blue-500 font-medium"
//             >
//               Refresh Plans
//             </button>
//           </div>
//         )}

//         {/* Plan Cards */}
//         {!loading && !error && plans.length > 0 && (
//           <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
//             {plans.map((plan) => {
//               const displayPrice = plan.price ? `₹${plan.price.toLocaleString()}` : 'Free';
//               const isPriceZero = !plan.price || plan.price === 0;
//               const isCurrentlyProcessing = processingPayment && selectedPlanId === plan.id;
//               const isDisabled = isPriceZero || processingPayment;

//               return (
//                 <div
//                   key={plan.id}
//                   className={`bg-white rounded-lg shadow-lg p-8 flex flex-col border transition-all duration-200 ${
//                     isCurrentlyProcessing ? 'ring-2 ring-blue-500 shadow-xl' : 'hover:shadow-xl'
//                   }`}
//                 >
//                   {/* Plan Icon */}
//                   <div className="flex-shrink-0 mb-4">
//                     <div className="h-12 w-12 bg-gray-100 rounded-lg flex items-center justify-center">
//                       <svg className="h-6 w-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
//                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.592 1L21 12h-4m-7 0h-4" />
//                       </svg>
//                     </div>
//                   </div>
                  
//                   {/* Plan Details */}
//                   <h2 className="text-2xl font-bold text-gray-900 mb-2">{plan.name}</h2>
//                   <p className="text-gray-500 text-sm mb-6 flex-grow">
//                     {plan.description || plan.tagline || 'Subscription plan'}
//                   </p>
                  
//                   {/* Pricing */}
//                   <div className="flex items-baseline mb-6">
//                     <span className="text-4xl font-extrabold text-gray-900">
//                       {displayPrice}
//                     </span>
//                     {!isPriceZero && (
//                       <span className="ml-1 text-gray-500 text-base">
//                         /{billingCycle === 'monthly' ? 'month' : billingCycle === 'yearly' ? 'year' : 'quarter'}
//                       </span>
//                     )}
//                   </div>
                  
//                   {/* CTA Button */}
//                   <button
//                     onClick={() => handleSelectPlan(plan)}
//                     disabled={isDisabled}
//                     className={`w-full py-3 px-6 rounded-md text-base font-medium transition-all duration-200 mb-6 ${
//                       isDisabled
//                         ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
//                         : 'bg-gray-900 text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2'
//                     }`}
//                   >
//                     {isCurrentlyProcessing ? (
//                       <div className="flex items-center justify-center">
//                         <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
//                         Processing...
//                       </div>
//                     ) : isPriceZero ? (
//                       'Free Plan'
//                     ) : (
//                       'Select Plan'
//                     )}
//                   </button>
                  
//                   {/* Features List */}
//                   <div className="flex-1">
//                     <ul className="space-y-3">
//                       {plan.features ? (
//                         (typeof plan.features === 'string' ?
//                          plan.features.split(',').map(f => f.trim()).filter(f => f) :
//                          Array.isArray(plan.features) ? plan.features : []
//                         ).map((feature, index) => (
//                           <li key={index} className="flex items-start">
//                             <CheckIcon className="h-5 w-5 text-green-500 flex-shrink-0 mr-3 mt-0.5" />
//                             <span className="text-gray-700 text-sm">{feature}</span>
//                           </li>
//                         ))
//                       ) : (
//                         <li className="text-gray-500 text-sm italic">No features listed</li>
//                       )}
//                     </ul>
//                   </div>
//                 </div>
//               );
//             })}
//           </div>
//         )}
//       </div>
//     </div>
//   );
// };

// export default SubscriptionPlanPage;



import React, { useState, useEffect, useCallback } from 'react';
import { CheckIcon } from '@heroicons/react/20/solid';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import apiService from '../services/api';
import { useAuth } from '../context/AuthContext';

// FIXED: Remove hardcoded test key - get from environment or backend
const BACKEND_BASE_URL = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000/payments';

console.log('Environment variables:', { BACKEND_BASE_URL });

const SubscriptionPlanPage = () => {
 const navigate = useNavigate();
 const { user, token, loading: authLoading } = useAuth();
 
 // State management
 const [billingCycle, setBillingCycle] = useState('yearly');
 const [planType, setPlanType] = useState('individual');
 const [plans, setPlans] = useState([]);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState(null);
 const [processingPayment, setProcessingPayment] = useState(false);
 const [selectedPlanId, setSelectedPlanId] = useState(null);

 // Fetch plans from API
 const fetchPlans = useCallback(async () => {
 console.log('Fetching plans for:', { planType, billingCycle });
 setLoading(true);
 setError(null);
 
 try {
 const response = await apiService.getPublicPlans();
 console.log('API response:', response);
 
 if (response?.success && Array.isArray(response.data)) {
 // Filter plans based on selected criteria
 const filteredPlans = response.data.filter(plan => {
 // Type matching
 const matchesType = (planType === 'team' && plan.type === 'business') || 
 (planType === 'individual' && plan.type === 'individual');
 
 // Interval matching - normalize interval names
 const planInterval = plan.interval?.toLowerCase();
 const matchesInterval = (billingCycle === 'monthly' && ['month', 'monthly'].includes(planInterval)) ||
 (billingCycle === 'yearly' && ['year', 'yearly', 'annual'].includes(planInterval)) ||
 (billingCycle === 'quarterly' && ['quarter', 'quarterly'].includes(planInterval));
 
 console.log(`Plan ${plan.name}: type=${plan.type}, interval=${planInterval}, matchesType=${matchesType}, matchesInterval=${matchesInterval}`);
 return matchesType && matchesInterval;
 });
 
 console.log('Filtered plans:', filteredPlans);
 setPlans(filteredPlans);
 } else {
 throw new Error('Invalid response format from server');
 }
 } catch (err) {
 console.error('Error fetching plans:', err);
 setError(`Failed to fetch plans: ${err.message}`);
 } finally {
 setLoading(false);
 }
 }, [planType, billingCycle]);

 useEffect(() => {
 fetchPlans();
 }, [fetchPlans]);

 // Load Razorpay script dynamically
 const loadRazorpayScript = () => {
 return new Promise((resolve) => {
 // Check if Razorpay is already loaded
 if (window.Razorpay) {
 console.log('Razorpay already loaded');
 return resolve(true);
 }
 
 // Check if script is already in DOM
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

 // Handle payment success
 const handlePaymentSuccess = async (planName, paymentData) => {
 try {
 console.log('Payment successful:', paymentData);
 
 // Update local storage
 const userInfo = JSON.parse(localStorage.getItem('userInfo') || '{}');
 userInfo.plan = planName;
 userInfo.lastPayment = {
 id: paymentData.razorpay_payment_id,
 subscription_id: paymentData.razorpay_subscription_id,
 date: new Date().toISOString()
 };
 localStorage.setItem('userInfo', JSON.stringify(userInfo));
 
 // Dispatch event for other components
 window.dispatchEvent(new CustomEvent('userInfoUpdated', { detail: userInfo }));
 
 // Show success message
 alert('🎉 Payment successful! Your subscription is now active.');
 
 // Redirect to dashboard
 navigate('/dashboard', { replace: true });
 } catch (error) {
 console.error('Error handling payment success:', error);
 }
 };

 // Handle payment failure
 const handlePaymentFailure = (error) => {
 console.error('Payment failed:', error);
 const errorMessage = error?.description || error?.message || 'Payment failed due to unknown error';
 alert(`❌ Payment Failed: ${errorMessage}`);
 setError(`Payment failed: ${errorMessage}`);
 setProcessingPayment(false);
 setSelectedPlanId(null);
 };

 // Create payment order and handle Razorpay checkout
 const handleSelectPlan = async (plan) => {
 console.log('Selected plan:', plan);

 // Debug localStorage contents
 console.log('All localStorage keys:', Object.keys(localStorage));
 console.log('token:', localStorage.getItem('token'));
 console.log('userInfo:', localStorage.getItem('userInfo'));

 // Get user info and token from localStorage
 const storedToken = localStorage.getItem('token');
 
 if (!storedToken) {
 setError('Please log in to continue with your subscription.');
 return;
 }

 // Try different possible keys for user information
 let currentUser = null;
 const possibleUserKeys = ['userInfo', 'user', 'userData', 'authUser'];
 
 for (const key of possibleUserKeys) {
 const storedData = localStorage.getItem(key);
 if (storedData) {
 try {
 const parsedData = JSON.parse(storedData);
 console.log(`Found user data in ${key}:`, parsedData);
 
 // Check if this object has an id property (directly or nested)
 if (parsedData.id) {
 currentUser = parsedData;
 console.log(`Using user data from ${key}`);
 break;
 } else if (parsedData.user && parsedData.user.id) {
 currentUser = parsedData.user;
 console.log(`Using nested user data from ${key}.user`);
 break;
 } else if (parsedData.data && parsedData.data.id) {
 currentUser = parsedData.data;
 console.log(`Using nested user data from ${key}.data`);
 break;
 }
 } catch (e) {
 console.error(`Error parsing ${key} from localStorage:`, e);
 }
 }
 }

 // Fallback: try to get user from AuthContext if available
 if (!currentUser && user && user.id) {
 currentUser = user;
 console.log('Using user from AuthContext as fallback');
 }

 // Check if user info is available
 if (!currentUser || !currentUser.id) {
 console.error('No valid user found in localStorage or AuthContext');
 console.log('Available localStorage keys:', Object.keys(localStorage));
 setError('User information not found. Please log in again.');
 return;
 }

 console.log('Final currentUser object:', currentUser);

 // Validate plan
 if (!plan.id || !plan.price || plan.price <= 0) {
 setError('Invalid plan selected');
 return;
 }

 setProcessingPayment(true);
 setSelectedPlanId(plan.id);
 setError(null);

 try {
 // Load Razorpay script
 const scriptLoaded = await loadRazorpayScript();
 if (!scriptLoaded) {
 throw new Error('Payment gateway failed to load. Please refresh and try again.');
 }

 console.log('Initiating subscription payment for plan ID:', plan.id);
 console.log('Token being sent for subscription:', storedToken?.substring(0, 20) + '...');
 console.log('User ID from localStorage:', currentUser.id);

 // Start subscription
 const response = await fetch(`${BACKEND_BASE_URL}/subscription/start`, {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 'Authorization': `Bearer ${storedToken}`,
 'X-User-ID': currentUser.id.toString(),
 },
 body: JSON.stringify({ plan_id: plan.id }),
 });

 // Check if response is ok
 if (!response.ok) {
 const errorText = await response.text();
 console.error('HTTP Error:', response.status, errorText);
 throw new Error(`Server error: ${response.status} ${response.statusText}`);
 }

 const startSubscriptionResponse = await response.json();
 console.log('[Razorpay Debug] startSubscription API raw response:', startSubscriptionResponse);

 if (!startSubscriptionResponse.success) {
 throw new Error(startSubscriptionResponse.message || startSubscriptionResponse.error || 'Failed to initiate subscription payment.');
 }

 // Extract subscription ID and Razorpay key from the response
 const subscriptionId = startSubscriptionResponse.subscription?.id;
 const razorpayKeyId = startSubscriptionResponse.subscription?.key; // FIXED: Get key from backend
 
 if (!subscriptionId) {
 console.error('[Razorpay Debug] Missing subscription ID in startSubscription response:', startSubscriptionResponse);
 throw new Error('Invalid response from payment server. Missing subscription ID.');
 }

 if (!razorpayKeyId) {
 console.error('[Razorpay Debug] Missing Razorpay key in startSubscription response:', startSubscriptionResponse);
 throw new Error('Invalid response from payment server. Missing Razorpay key.');
 }

 console.log(`[Razorpay Debug] Received subscriptionId: ${subscriptionId}`);
 console.log(`[Razorpay Debug] Received Razorpay key: ${razorpayKeyId}`);

 // FIXED: Configure Razorpay checkout options with key from backend
 const razorpayOptions = {
 key: razorpayKeyId, // Use the key from backend response (live key)
 subscription_id: subscriptionId,
 name: "NexintelAI Subscriptions",
 description: `${plan.name} Subscription`,
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
 // Verify the payment with the backend
 const verificationResponse = await fetch(`${BACKEND_BASE_URL}/subscription/verify`, {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 'Authorization': `Bearer ${storedToken}`,
 },
 body: JSON.stringify({
 razorpay_payment_id: response.razorpay_payment_id,
 razorpay_subscription_id: response.razorpay_subscription_id,
 razorpay_signature: response.razorpay_signature,
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
 plan_id: plan.id,
 user_id: currentUser?.id || 'anonymous'
 }
 };

 console.log('Opening Razorpay checkout with options:', razorpayOptions);
 
 // Create and open Razorpay instance
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

 // Navigation handler
 const handleGoBack = () => {
 navigate(-1);
 };

 // Retry handler
 const handleRetry = () => {
 setError(null);
 fetchPlans();
 };

 return (
 <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
 <div className="max-w-7xl mx-auto">
 {/* Back button */}
 <button
 onClick={handleGoBack}
 className="flex items-center text-gray-600 hover:text-gray-900 mb-8 transition-colors"
 disabled={processingPayment}
 >
 <ArrowLeftIcon className="h-5 w-5 mr-2" />
 Back
 </button>

 {/* Page title */}
 <h1 className="text-4xl font-extrabold text-gray-900 text-center mb-12">
 Plans that grow with you
 </h1>

 {/* Plan Type Toggle */}
 <div className="flex justify-center mb-8">
 <div className="inline-flex rounded-md shadow-sm">
 <button
 type="button"
 className={`py-2 px-4 text-sm font-medium rounded-l-md transition-colors ${
 planType === 'individual'
 ? 'text-white'
 : 'bg-white text-gray-700 hover:bg-gray-50'
 } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
 style={planType === 'individual' ? { backgroundColor: '#21C1B6' } : {}}
 onMouseEnter={(e) => {
 if (planType === 'individual') {
 e.currentTarget.style.backgroundColor = '#1AA49B';
 }
 }}
 onMouseLeave={(e) => {
 if (planType === 'individual') {
 e.currentTarget.style.backgroundColor = '#21C1B6';
 }
 }}
 onClick={() => setPlanType('individual')}
 disabled={loading || processingPayment}
 >
 Individual
 </button>
 <button
 type="button"
 className={`-ml-px py-2 px-4 text-sm font-medium rounded-r-md transition-colors ${
 planType === 'team'
 ? 'text-white'
 : 'bg-white text-gray-700 hover:bg-gray-50'
 } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
 style={planType === 'team' ? { backgroundColor: '#21C1B6' } : {}}
 onMouseEnter={(e) => {
 if (planType === 'team') {
 e.currentTarget.style.backgroundColor = '#1AA49B';
 }
 }}
 onMouseLeave={(e) => {
 if (planType === 'team') {
 e.currentTarget.style.backgroundColor = '#21C1B6';
 }
 }}
 onClick={() => setPlanType('team')}
 disabled={loading || processingPayment}
 >
 Team & Enterprise
 </button>
 </div>
 </div>

 {/* Billing Cycle Toggle */}
 <div className="flex justify-center mb-12">
 <div className="inline-flex rounded-md shadow-sm">
 <button
 type="button"
 className={`py-2 px-4 text-sm font-medium rounded-l-md transition-colors ${
 billingCycle === 'monthly'
 ? 'text-white'
 : 'bg-white text-gray-700 hover:bg-gray-50'
 } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
 style={billingCycle === 'monthly' ? { backgroundColor: '#21C1B6' } : {}}
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
 className={`-ml-px py-2 px-4 text-sm font-medium transition-colors ${
 billingCycle === 'yearly'
 ? 'text-white'
 : 'bg-white text-gray-700 hover:bg-gray-50'
 } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
 style={billingCycle === 'yearly' ? { backgroundColor: '#21C1B6' } : {}}
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
 <button
 type="button"
 className={`-ml-px py-2 px-4 text-sm font-medium rounded-r-md transition-colors ${
 billingCycle === 'quarterly'
 ? 'text-white'
 : 'bg-white text-gray-700 hover:bg-gray-50'
 } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
 style={billingCycle === 'quarterly' ? { backgroundColor: '#21C1B6' } : {}}
 onMouseEnter={(e) => {
 if (billingCycle === 'quarterly') {
 e.currentTarget.style.backgroundColor = '#1AA49B';
 }
 }}
 onMouseLeave={(e) => {
 if (billingCycle === 'quarterly') {
 e.currentTarget.style.backgroundColor = '#21C1B6';
 }
 }}
 onClick={() => setBillingCycle('quarterly')}
 disabled={loading || processingPayment}
 >
 Quarterly
 </button>
 </div>
 </div>

 {/* Loading State */}
 {loading && (
 <div className="text-center py-12">
 <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mb-4"></div>
 <p className="text-gray-600">Loading subscription plans...</p>
 </div>
 )}

 {/* Error State */}
 {error && (
 <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-8">
 <div className="flex justify-between items-center">
 <div className="text-red-800">{error}</div>
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

 {/* Empty State */}
 {!loading && !error && plans.length === 0 && (
 <div className="text-center py-12">
 <p className="text-gray-600 text-lg mb-4">
 No plans available for {planType} - {billingCycle} billing
 </p>
 <button
 onClick={handleRetry}
 className="text-blue-600 hover:text-blue-500 font-medium"
 >
 Refresh Plans
 </button>
 </div>
 )}

 {/* Plan Cards */}
 {!loading && !error && plans.length > 0 && (
 <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
 {plans.map((plan) => {
 const displayPrice = plan.price ? `₹${plan.price.toLocaleString()}` : 'Free';
 const isPriceZero = !plan.price || plan.price === 0;
 const isCurrentlyProcessing = processingPayment && selectedPlanId === plan.id;
 const isDisabled = isPriceZero || processingPayment;

 return (
 <div
 key={plan.id}
 className={`bg-white rounded-lg shadow-lg p-8 flex flex-col border transition-all duration-200 ${
 isCurrentlyProcessing ? 'ring-2 ring-blue-500 shadow-xl' : 'hover:shadow-xl'
 }`}
 >
 {/* Plan Icon */}
 <div className="flex-shrink-0 mb-4">
 <div className="h-12 w-12 bg-gray-100 rounded-lg flex items-center justify-center">
 <svg className="h-6 w-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.592 1L21 12h-4m-7 0h-4" />
 </svg>
 </div>
 </div>
 
 {/* Plan Details */}
 <h2 className="text-2xl font-bold text-gray-900 mb-2">{plan.name}</h2>
 <p className="text-gray-500 text-sm mb-6 flex-grow">
 {plan.description || plan.tagline || 'Subscription plan'}
 </p>
 
 {/* Pricing */}
 <div className="flex items-baseline mb-6">
 <span className="text-4xl font-extrabold text-gray-900">
 {displayPrice}
 </span>
 {!isPriceZero && (
 <span className="ml-1 text-gray-500 text-base">
 /{billingCycle === 'monthly' ? 'month' : billingCycle === 'yearly' ? 'year' : 'quarter'}
 </span>
 )}
 </div>
 
 {/* CTA Button */}
 <button
 onClick={() => handleSelectPlan(plan)}
 disabled={isDisabled}
 className={`w-full py-3 px-6 rounded-md text-base font-medium transition-all duration-200 mb-6 ${
 isDisabled
 ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
 : 'text-white focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2'
 }`}
 style={isDisabled ? {} : { backgroundColor: '#21C1B6' }}
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
 ) : isPriceZero ? (
 'Free Plan'
 ) : (
 'Select Plan'
 )}
 </button>
 
 {/* Features List */}
 <div className="flex-1">
 <ul className="space-y-3">
 {plan.features ? (
 (typeof plan.features === 'string' ?
 plan.features.split(',').map(f => f.trim()).filter(f => f) :
 Array.isArray(plan.features) ? plan.features : []
 ).map((feature, index) => (
 <li key={index} className="flex items-start">
 <CheckIcon className="h-5 w-5 text-green-500 flex-shrink-0 mr-3 mt-0.5" />
 <span className="text-gray-700 text-sm">{feature}</span>
 </li>
 ))
 ) : (
 <li className="text-gray-500 text-sm italic">No features listed</li>
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