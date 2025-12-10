// import React from 'react';
// import { Link } from 'react-router-dom';

// const PricingPage = () => {
//   return (
//     <div className="min-h-screen bg-gray-100 font-inter py-16 px-4 sm:px-6 lg:px-8">
//       <div className="container mx-auto">
//         <h3 className="text-3xl sm:text-4xl font-semibold text-center text-gray-800 mb-12">Flexible Pricing Plans</h3>
//         <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
//           {/* Free Tier */}
//           <div className="bg-white p-8 rounded-xl shadow-lg border-t-4 border-gray-400 text-center">
//             <h4 className="text-3xl font-bold text-gray-900 mb-4">Free</h4>
//             <p className="text-5xl font-extrabold text-gray-700 mb-6">$0<span className="text-xl text-gray-500">/month</span></p>
//             <ul className="text-gray-700 text-left mb-8 space-y-3">
//               <li className="flex items-center"><span className="text-green-500 mr-2">✔</span> Limited Document Uploads</li>
//               <li className="flex items-center"><span className="text-green-500 mr-2">✔</span> Basic AI Summarization</li>
//               <li className="flex items-center"><span className="text-red-500 mr-2">✖</span> Document Drafting</li>
//               <li className="flex items-center"><span className="text-red-500 mr-2">✖</span> Priority Support</li>
//             </ul>
//             <Link to="/register" className="block w-full bg-gray-700 hover:bg-gray-800 text-white font-semibold py-3 rounded-lg transition-colors duration-200" target="_blank" rel="noopener noreferrer">
//               Sign Up - Free
//             </Link>
//           </div>

//           {/* Premium Tier */}
//           <div className="bg-white p-8 rounded-xl shadow-xl border-t-4 border-gray-700 text-center transform scale-105">
//             <h4 className="text-3xl font-bold text-gray-900 mb-4">Premium</h4>
//             <p className="text-5xl font-extrabold text-gray-700 mb-6">$49<span className="text-xl text-gray-500">/month</span></p>
//             <ul className="text-gray-700 text-left mb-8 space-y-3">
//               <li className="flex items-center"><span className="text-green-500 mr-2">✔</span> Unlimited Document Uploads</li>
//               <li className="flex items-center"><span className="text-green-500 mr-2">✔</span> Advanced AI Analysis</li>
//               <li className="flex items-center"><span className="text-green-500 mr-2">✔</span> Basic Document Drafting</li>
//               <li className="flex items-center"><span className="text-green-500 mr-2">✔</span> Standard Support</li>
//             </ul>
//             <Link to="/register" className="block w-full bg-gray-800 hover:bg-gray-900 text-white font-semibold py-3 rounded-lg transition-colors duration-200" target="_blank" rel="noopener noreferrer">
//               Choose Premium
//             </Link>
//           </div>

//           {/* Enterprise Tier */}
//           <div className="bg-white p-8 rounded-xl shadow-lg border-t-4 border-gray-400 text-center">
//             <h4 className="text-3xl font-bold text-gray-900 mb-4">Enterprise</h4>
//             <p className="text-5xl font-extrabold text-gray-700 mb-6">$99<span className="text-xl text-gray-500">/month</span></p>
//             <ul className="text-gray-700 text-left mb-8 space-y-3">
//               <li className="flex items-center"><span className="text-green-500 mr-2">✔</span> All Premium Features</li>
//               <li className="flex items-center"><span className="text-green-500 mr-2">✔</span> Custom AI Models</li>
//               <li className="flex items-center"><span className="text-green-500 mr-2">✔</span> Advanced Document Drafting</li>
//               <li className="flex items-center"><span className="text-green-500 mr-2">✔</span> Dedicated Account Manager</li>
//             </ul>
//             <Link to="/register" className="block w-full bg-gray-700 hover:bg-gray-800 text-white font-semibold py-3 rounded-lg transition-colors duration-200" target="_blank" rel="noopener noreferrer">
//               Contact Sales
//             </Link>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default PricingPage;

// import React, { useState, useEffect, useCallback } from 'react';
// import { CheckIcon } from '@heroicons/react/20/solid';
// import { ArrowLeftIcon } from '@heroicons/react/24/outline';
// import { useNavigate } from 'react-router-dom';
// import PaymentForm from '../components/PaymentForm';
// import apiService from '../services/api'; // Import the apiService
// import { useAuth } from '../context/AuthContext'; // Assuming you have an AuthContext

// const PricingPage = () => {
//   const navigate = useNavigate();
//   const [billingCycle, setBillingCycle] = useState('yearly'); // 'monthly' or 'yearly'
//   const [planType, setPlanType] = useState('individual'); // 'individual' or 'team'
//   const [plans, setPlans] = useState([]);
//   const [loading, setLoading] = useState(true);
//   const [error, setError] = useState(null);
//   const [showPaymentForm, setShowPaymentForm] = useState(false); // State to control payment form visibility
//   const [selectedPlan, setSelectedPlan] = useState(null); // State to store the selected plan

//   const fetchPlans = useCallback(async () => {
//     setLoading(true);
//     setError(null);
//     try {
//       const filters = {
//         type: planType === 'team' ? 'business' : planType, // Map 'team' to 'business'
//         interval: billingCycle === 'monthly' ? 'month' : 'year',
//       };
//       const response = await apiService.getPublicPlans(filters);
//       if (response && Array.isArray(response.data)) {
//         setPlans(response.data);
//       } else {
//         console.error('API response is not an array or missing data property:', response);
//         setError('Invalid data received from server.');
//       }
//     } catch (err) {
//       setError(err.message || 'Failed to fetch plans. Please try again later.');
//       console.error('Error fetching plans:', err);
//     } finally {
//       setLoading(false);
//     }
//   }, [planType, billingCycle]);

//   useEffect(() => {
//     fetchPlans();
//   }, [fetchPlans]);

//   const handleGoBack = () => {
//     navigate(-1); // Go back to the previous page
//   };

//   const handleSelectPlan = (plan) => {
//     setSelectedPlan(plan);
//     setShowPaymentForm(true);
//   };

//   const handleClosePaymentForm = () => {
//     setShowPaymentForm(false);
//     setSelectedPlan(null);
//   };

//   const handlePaymentSuccess = (planName) => {
//     // Update user's plan in local storage
//     const userInfo = JSON.parse(localStorage.getItem('userInfo'));
//     if (userInfo) {
//       userInfo.plan = planName;
//       localStorage.setItem('userInfo', JSON.stringify(userInfo));
//       // Dispatch a custom event to notify other components (like UserProfileMenu)
//       // that user info has changed. This is a workaround if direct context update isn't feasible.
//       window.dispatchEvent(new CustomEvent('userInfoUpdated'));
//     }
//     // Optionally, navigate away or show a success message
//     navigate('/dashboard'); // Redirect to dashboard after successful payment
//   };

//   return (
//     <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
//       <div className="max-w-7xl mx-auto">
//         <button
//           onClick={handleGoBack}
//           className="flex items-center text-gray-600 hover:text-gray-900 mb-8"
//         >
//           <ArrowLeftIcon className="h-5 w-5 mr-2" />
//           Back
//         </button>

//         <h1 className="text-4xl font-extrabold text-gray-900 text-center mb-12">
//           Plans that grow with you
//         </h1>

//         {/* Plan Type Toggle */}
//         <div className="flex justify-center mb-8">
//           <div className="inline-flex rounded-md shadow-sm">
//             <button
//               type="button"
//               className={`py-2 px-4 text-sm font-medium rounded-l-md ${
//                 planType === 'individual'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-gray-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setPlanType('individual')}
//             >
//               Individual
//             </button>
//             <button
//               type="button"
//               className={`-ml-px py-2 px-4 text-sm font-medium rounded-r-md ${
//                 planType === 'team'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setPlanType('team')}
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
//               className={`py-2 px-4 text-sm font-medium rounded-l-md ${
//                 billingCycle === 'monthly'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-gray-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setBillingCycle('monthly')}
//             >
//               Monthly
//             </button>
//             <button
//               type="button"
//               className={`-ml-px py-2 px-4 text-sm font-medium rounded-r-md ${
//                 billingCycle === 'yearly'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-gray-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setBillingCycle('yearly')}
//             >
//               Yearly
//             </button>
//           </div>
//         </div>

//         {loading && (
//           <div className="text-center text-gray-600 text-lg">Loading plans...</div>
//         )}

//         {error && (
//           <div className="text-center text-red-600 text-lg">{error}</div>
//         )}

//         {!loading && !error && plans.length === 0 && (
//           <div className="text-center text-gray-600 text-lg">No plans available for the selected criteria.</div>
//         )}

//         {/* Plan Cards */}
//         {!loading && !error && plans.length > 0 && (
//           <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
//             {plans.map((plan) => {
//               const displayPrice = plan.price ? `$${plan.price}` : 'N/A';
//               const isPriceZero = displayPrice === '$0';

//               return (
//                 <div
//                   key={plan.id}
//                   className={`bg-white rounded-lg shadow-md p-8 flex flex-col ${plan.highlightClass || ''}`}
//                 >
//                   <div className="flex-shrink-0 mb-4">
//                     {plan.icon ? (
//                       plan.icon
//                     ) : (
//                       <svg className="h-12 w-12 text-gray-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1">
//                         <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.592 1L21 12h-4m-7 0h-4M7.21 14.77l-2.832 4.904A2 2 0 011.91 21h16.18a2 2 0 001.728-3.224L12.79 8.23" />
//                       </svg>
//                     )}
//                   </div>
//                   <h2 className="text-2xl font-bold text-gray-900 mb-2">{plan.name}</h2>
//                   <p className="text-gray-500 text-sm mb-4">{plan.tagline}</p>
//                   <div className="flex items-baseline mb-6">
//                     <span className="text-4xl font-extrabold text-gray-900">
//                       {displayPrice}
//                     </span>
//                     {!isPriceZero && (
//                       <span className="ml-1 text-gray-500 text-base">
//                         {billingCycle === 'monthly' ? '/ month billed monthly' : '/ month billed annually'}
//                       </span>
//                     )}
//                   </div>
//                   <button
//                     onClick={() => handleSelectPlan(plan)}
//                     className={`w-full py-3 px-6 rounded-md text-base font-medium transition-colors duration-200 ${plan.buttonClass}`}
//                     disabled={plan.id === 'free'} // Disable button for free plan
//                   >
//                     {plan.buttonText}
//                   </button>
//                   <div className="mt-8 flex-1">
//                     <ul className="space-y-4">
//                       {plan.features.map((feature, index) => (
//                         <li key={index} className="flex items-start">
//                           <CheckIcon className="h-5 w-5 text-green-500 flex-shrink-0 mr-2" />
//                           <span className="text-gray-700 text-sm">{feature}</span>
//                         </li>
//                       ))}
//                     </ul>
//                   </div>
//                 </div>
//               );
//             })}
//           </div>
//         )}

//       </div>

//       {showPaymentForm && selectedPlan && (
//         <PaymentForm
//           plan={selectedPlan}
//           onClose={handleClosePaymentForm}
//           onPaymentSuccess={handlePaymentSuccess}
//         />
//       )}
//     </div>
//   );
// };

// export default PricingPage;


// import React, { useState, useEffect, useCallback } from 'react';
// import { CheckIcon } from '@heroicons/react/20/solid';
// import { ArrowLeftIcon } from '@heroicons/react/24/outline';
// import { useNavigate } from 'react-router-dom';
// import apiService from '../services/api'; // Import the apiService
// import { useAuth } from '../context/AuthContext'; // Assuming you have an AuthContext

// // Razorpay Configuration (Replace with your actual values)
// const RAZORPAY_KEY_ID = import.meta.env.VITE_APP_RAZORPAY_KEY_ID || 'rzp_test_R6mBF5iIMakFt1'; // Get from environment variables or replace directly
// const BACKEND_BASE_URL = import.meta.env.VITE_APP_API_URL || 'https://nexintelai-user.onrender.com/api';

// const PricingPage = () => {
//   console.log('SubscriptionPlanPage component rendered.');
//   const navigate = useNavigate();
//   const [billingCycle, setBillingCycle] = useState('yearly'); // 'monthly' or 'yearly'
//   const [planType, setPlanType] = useState('individual'); // 'individual' or 'team'
//   const [plans, setPlans] = useState([]);
//   const [loading, setLoading] = useState(true);
//   const [error, setError] = useState(null);
//   const [showPaymentForm, setShowPaymentForm] = useState(false); // State to control payment form visibility (will be removed later)
//   const [selectedPlan, setSelectedPlan] = useState(null); // State to store the selected plan
//   const { user, token } = useAuth(); // Get user and token from AuthContext

//   const fetchPlans = useCallback(async () => {
//     setLoading(true);
//     setError(null);
//     try {
//       // Fetch plans without specific type and interval filters, as the backend seems to prefer this.
//       // The backend should return all available plans, and frontend can filter/display as needed.
//       console.log('Calling apiService.getPublicPlans...');
//       const response = await apiService.getPublicPlans();
//       console.log('apiService.getPublicPlans response:', response);
//       if (response && Array.isArray(response.data)) {
//         // Filter plans based on selected planType and billingCycle
//         const filteredPlans = response.data.filter(plan => {
//           const matchesType = (planType === 'team' && plan.type === 'business') || (planType === 'individual' && plan.type === 'individual');
//           const matchesInterval = (billingCycle === 'monthly' && plan.interval === 'month') ||
//                                   (billingCycle === 'yearly' && plan.interval === 'year') ||
//                                   (billingCycle === 'quarterly' && plan.interval === 'quarterly'); // Ensure backend uses 'quarterly'
//           return matchesType && matchesInterval;
//         });
//         console.log('Filtered plans:', filteredPlans);
//         setPlans(filteredPlans);
//       } else {
//         console.error('API response is not an array or missing data property:', response);
//         setError('Invalid data received from server.');
//       }
//     } catch (err) {
//       console.error('Error in fetchPlans:', err);
//       setError(err.message || 'Failed to fetch plans. Please try again later.');
//     } finally {
//       setLoading(false);
//       console.log('fetchPlans finished. Loading:', false);
//     }
//   }, [planType, billingCycle]);

//   useEffect(() => {
//     fetchPlans();
//   }, [fetchPlans]);

//   const handleGoBack = () => {
//     navigate(-1); // Go back to the previous page
//   };

//   const handlePaymentSuccess = (planName) => {
//     // Update user's plan in local storage (assuming planName is sufficient)
//     const userInfo = JSON.parse(localStorage.getItem('userInfo'));
//     if (userInfo) {
//       userInfo.plan = planName; // Or update with more detailed plan info if available
//       localStorage.setItem('userInfo', JSON.stringify(userInfo));
//       window.dispatchEvent(new CustomEvent('userInfoUpdated'));
//     }
//     navigate('/dashboard'); // Redirect to dashboard after successful payment
//   };

//   const handleSelectPlan = async (plan) => {
//     if (!token) {
//       setError('You must be logged in to subscribe to a plan.');
//       navigate('/login'); // Redirect to login page
//       return;
//     }

//     setSelectedPlan(plan);
//     setLoading(true);
//     setError(null);

//     try {
//       const response = await fetch(`${BACKEND_BASE_URL}/payments/order`, {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//           'Authorization': `Bearer ${token}`
//         },
//         body: JSON.stringify({ planId: plan.id })
//       });

//       const data = await response.json();

//       if (!response.ok) {
//         throw new Error(data.message || 'Failed to create Razorpay order.');
//       }

//       const order = data.order;
//       const razorpaySubscription = data.razorpaySubscription;

//       const options = {
//         key: RAZORPAY_KEY_ID,
//         subscription_id: razorpaySubscription.id,
//         name: "NexintelAI Subscriptions",
//         description: plan.name,
//         image: "/src/assets/nexintel.jpg", // Assuming this is now the new logo
//         handler: function (response) {
//           console.log('Razorpay payment successful:', response);
//           alert('Payment successful! Your subscription is now active.');
//           handlePaymentSuccess(plan.name); // Call your success handler
//         },
//         prefill: {
//           name: user?.name || '',
//           email: user?.email || '',
//           contact: user?.contact || '' // Assuming user object has contact
//         },
//         notes: {
//           user_id: user?.id || '',
//           plan_id: plan.id
//         },
//         theme: {
//           "color": "#1a202c" // Tailwind's gray-900
//         }
//       };

//       const rzp = new window.Razorpay(options);

//       rzp.on('payment.failed', function (response) {
//         alert(`Payment Failed: ${response.error.description || 'Unknown error'}`);
//         console.error('Razorpay payment failed:', response.error);
//         setError(`Payment failed: ${response.error.description || 'Unknown error'}`);
//       });

//       rzp.open();

//     } catch (err) {
//       const errorMessage = err.message || 'An unexpected error occurred during the subscription process.';
//       setError(errorMessage);
//       console.error('Error during subscription process:', err);
//     } finally {
//       setLoading(false);
//     }
//   };

//   return (
//     <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
//       <div className="max-w-7xl mx-auto">
//         <button
//           onClick={handleGoBack}
//           className="flex items-center text-gray-600 hover:text-gray-900 mb-8"
//         >
//           <ArrowLeftIcon className="h-5 w-5 mr-2" />
//           Back
//         </button>

//         <h1 className="text-4xl font-extrabold text-gray-900 text-center mb-12">
//           Plans that grow with you
//         </h1>

//         {/* Plan Type Toggle */}
//         <div className="flex justify-center mb-8">
//           <div className="inline-flex rounded-md shadow-sm">
//             <button
//               type="button"
//               className={`py-2 px-4 text-sm font-medium rounded-l-md ${
//                 planType === 'individual'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-gray-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setPlanType('individual')}
//             >
//               Individual
//             </button>
//             <button
//               type="button"
//               className={`-ml-px py-2 px-4 text-sm font-medium rounded-r-md ${
//                 planType === 'team'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setPlanType('team')}
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
//               className={`py-2 px-4 text-sm font-medium rounded-l-md ${
//                 billingCycle === 'monthly'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-gray-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setBillingCycle('monthly')}
//             >
//               Monthly
//             </button>
//             <button
//               type="button"
//               className={`-ml-px py-2 px-4 text-sm font-medium ${
//                 billingCycle === 'yearly'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-gray-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setBillingCycle('yearly')}
//             >
//               Yearly
//             </button>
//             <button
//               type="button"
//               className={`-ml-px py-2 px-4 text-sm font-medium rounded-r-md ${
//                 billingCycle === 'quarterly'
//                   ? 'bg-gray-900 text-white'
//                   : 'bg-white text-gray-700 hover:bg-gray-50'
//               } focus:z-10 focus:outline-none focus:ring-2 focus:ring-gray-500`}
//               onClick={() => setBillingCycle('quarterly')}
//             >
//               Quarterly
//             </button>
//           </div>
//         </div>

//         {loading && (
//           <div className="text-center text-gray-600 text-lg">Loading plans...</div>
//         )}

//         {error && (
//           <div className="text-center text-red-600 text-lg">Error: {error}</div>
//         )}

//         {!loading && !error && plans.length === 0 && (
//           <div className="text-center text-gray-600 text-lg">No plans available for the selected criteria.</div>
//         )}

//         {/* Plan Cards */}
//         {!loading && !error && plans.length > 0 && (
//           <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
//             {plans.map((plan) => {
//               const displayPrice = plan.price ? `$${plan.price}` : 'N/A';
//               const isPriceZero = displayPrice === '$0';

//               return (
//                 <div
//                   key={plan.id}
//                   className={`bg-white rounded-lg shadow-md p-8 flex flex-col ${plan.highlightClass || ''}`}
//                 >
//                   <div className="flex-shrink-0 mb-4">
//                     {plan.icon ? (
//                       plan.icon
//                     ) : (
//                       <svg className="h-12 w-12 text-gray-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1">
//                         <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.592 1L21 12h-4m-7 0h-4M7.21 14.77l-2.832 4.904A2 2 0 011.91 21h16.18a2 2 0 001.728-3.224L12.79 8.23" />
//                       </svg>
//                     )}
//                   </div>
//                   <h2 className="text-2xl font-bold text-gray-900 mb-2">{plan.name}</h2>
//                   <p className="text-gray-500 text-sm mb-4">{plan.tagline}</p>
//                   <div className="flex items-baseline mb-6">
//                     <span className="text-4xl font-extrabold text-gray-900">
//                       {displayPrice}
//                     </span>
//                     {!isPriceZero && (
//                       <span className="ml-1 text-gray-500 text-base">
//                         {billingCycle === 'monthly' ? '/ month billed monthly' : (billingCycle === 'yearly' ? '/ month billed annually' : '/ month billed quarterly')}
//                       </span>
//                     )}
//                   </div>
//                   <button
//                     onClick={() => handleSelectPlan(plan)}
//                     className={`w-full py-3 px-6 rounded-md text-base font-medium transition-colors duration-200 ${plan.buttonClass || 'bg-gray-900 text-white hover:bg-gray-800'}`}
//                     disabled={plan.id === 'free' || !plan.price} // Disable button for free plan or if no price
//                   >
//                     {plan.buttonText || 'Select Plan'}
//                   </button>
//                   <div className="mt-8 flex-1">
//                     <ul className="space-y-4">
//                       {plan.features ? (
//                         // Check if features is a string and split it, otherwise assume it's an array
//                         (typeof plan.features === 'string' ? plan.features.split(',').map(f => f.trim()) : plan.features).map((feature, index) => (
//                           <li key={index} className="flex items-start">
//                             <CheckIcon className="h-5 w-5 text-green-500 flex-shrink-0 mr-2" />
//                             <span className="text-gray-700 text-sm">{feature}</span>
//                           </li>
//                         ))
//                       ) : (
//                         <li className="text-gray-500 text-sm">No features listed.</li>
//                       )}
//                     </ul>
//                   </div>
//                 </div>
//               );
//             })}
//           </div>
//         )}

//       </div>

//       {/* PaymentForm is no longer directly used here as Razorpay Checkout handles the UI */}
//     </div>
//   );
// };

// export default PricingPage;


// import React, { useState, useEffect, useCallback, useRef } from 'react';
// import { Link, useNavigate } from 'react-router-dom';
// import { CheckIcon } from '@heroicons/react/20/solid';
// import { Shield, FileText, Sparkles, ArrowRight } from 'lucide-react';
// import { motion, useScroll, useTransform, useInView } from 'framer-motion';
// import NexintelLogo from '../assets/nexintel.jpg';
// import apiService from '../services/api';
// import { useAuth } from '../context/AuthContext';

// const RAZORPAY_KEY_ID = import.meta.env.VITE_APP_RAZORPAY_KEY_ID || 'rzp_test_R6mBF5iIMakFt1';
// const BACKEND_BASE_URL = import.meta.env.VITE_APP_API_URL || 'https://nexintelai-user.onrender.com/api';

// const PricingPage = () => {
//  console.log('SubscriptionPlanPage component rendered.');
//  const navigate = useNavigate();
//  const { scrollY } = useScroll();
//  const heroRef = useRef(null);
//  const featuresRef = useRef(null);
//  const benefitsRef = useRef(null);
//  const isHeroInView = useInView(heroRef, { once: true });
//  const isFeaturesInView = useInView(featuresRef, { once: true });
//  const isBenefitsInView = useInView(benefitsRef, { once: true });

//  const [billingCycle, setBillingCycle] = useState('yearly');
//  const [planType, setPlanType] = useState('individual');
//  const [plans, setPlans] = useState([]);
//  const [loading, setLoading] = useState(true);
//  const [error, setError] = useState(null);
//  const [showPaymentForm, setShowPaymentForm] = useState(false);
//  const [selectedPlan, setSelectedPlan] = useState(null);
//  const { user, token } = useAuth();

//  const handleLogin = () => {
//  navigate('/login');
//  };

//  const handleRegister = () => {
//  navigate('/register');
//  };

//  const heroY = useTransform(scrollY, [0, 500], [0, -50]);
//  const heroOpacity = useTransform(scrollY, [0, 300], [1, 0.8]);

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

//  const fetchPlans = useCallback(async () => {
//  setLoading(true);
//  setError(null);
//  try {
//  console.log('Calling apiService.getPublicPlans...');
//  const response = await apiService.getPublicPlans();
//  console.log('apiService.getPublicPlans response:', response);
//  if (response && Array.isArray(response.data)) {
//  const filteredPlans = response.data.filter(plan => {
//  const matchesType = (planType === 'team' && plan.type === 'business') || (planType === 'individual' && plan.type === 'individual');
//  const matchesInterval = (billingCycle === 'monthly' && plan.interval === 'month') ||
//  (billingCycle === 'yearly' && plan.interval === 'year') ||
//  (billingCycle === 'quarterly' && plan.interval === 'quarterly');
//  return matchesType && matchesInterval;
//  });
//  console.log('Filtered plans:', filteredPlans);
//  setPlans(filteredPlans);
//  } else {
//  console.error('API response is not an array or missing data property:', response);
//  setError('Invalid data received from server.');
//  }
//  } catch (err) {
//  console.error('Error in fetchPlans:', err);
//  setError(err.message || 'Failed to fetch plans. Please try again later.');
//  } finally {
//  setLoading(false);
//  console.log('fetchPlans finished. Loading:', false);
//  }
//  }, [planType, billingCycle]);

//  useEffect(() => {
//  fetchPlans();
//  }, [fetchPlans]);

//  const handleGoBack = () => {
//  navigate(-1);
//  };

//  const handlePaymentSuccess = (planName) => {
//  const userInfo = JSON.parse(localStorage.getItem('userInfo'));
//  if (userInfo) {
//  userInfo.plan = planName;
//  localStorage.setItem('userInfo', JSON.stringify(userInfo));
//  window.dispatchEvent(new CustomEvent('userInfoUpdated'));
//  }
//  navigate('/dashboard');
//  };

//  const handleSelectPlan = async (plan) => {
//  if (!token) {
//  setError('You must be logged in to subscribe to a plan.');
//  navigate('/login');
//  return;
//  }

//  setSelectedPlan(plan);
//  setLoading(true);
//  setError(null);

//  try {
//  const response = await fetch(`${BACKEND_BASE_URL}/payments/order`, {
//  method: 'POST',
//  headers: {
//  'Content-Type': 'application/json',
//  'Authorization': `Bearer ${token}`
//  },
//  body: JSON.stringify({ planId: plan.id })
//  });

//  const data = await response.json();

//  if (!response.ok) {
//  throw new Error(data.message || 'Failed to create Razorpay order.');
//  }

//  const order = data.order;
//  const razorpaySubscription = data.razorpaySubscription;

//  const options = {
//  key: RAZORPAY_KEY_ID,
//  subscription_id: razorpaySubscription.id,
//  name: "NexintelAI Subscriptions",
//  description: plan.name,
//  image: "/src/assets/nexintel.jpg",
//  handler: function (response) {
//  console.log('Razorpay payment successful:', response);
//  alert('Payment successful! Your subscription is now active.');
//  handlePaymentSuccess(plan.name);
//  },
//  prefill: {
//  name: user?.name || '',
//  email: user?.email || '',
//  contact: user?.contact || ''
//  },
//  notes: {
//  user_id: user?.id || '',
//  plan_id: plan.id
//  },
//  theme: {
//  "color": "#1a202c"
//  }
//  };

//  const rzp = new window.Razorpay(options);

//  rzp.on('payment.failed', function (response) {
//  alert(`Payment Failed: ${response.error.description || 'Unknown error'}`);
//  console.error('Razorpay payment failed:', response.error);
//  setError(`Payment failed: ${response.error.description || 'Unknown error'}`);
//  });

//  rzp.open();

//  } catch (err) {
//  const errorMessage = err.message || 'An unexpected error occurred during the subscription process.';
//  setError(errorMessage);
//  console.error('Error during subscription process:', err);
//  } finally {
//  setLoading(false);
//  }
//  };

//  return (
//  <div className="min-h-screen bg-white overflow-hidden">
//  <nav className="fixed top-0 left-0 right-0 bg-white/95 backdrop-blur-sm shadow-sm z-50 border-b border-gray-100">
//  <div className="container mx-auto px-4 sm:px-6 lg:px-8">
//  <div className="flex justify-between items-center h-16">
//  <div className="flex items-center space-x-2">
//  <img src={NexintelLogo} alt="Nexintel AI Logo" className="h-8 w-auto" />
//  </div>
 
//  <div className="hidden md:flex items-center space-x-8 ml-auto mr-8">
//  <Link to="/" className="text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors">Home</Link>
//  <Link to="/services" className="text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors">Services</Link>
//  <Link to="/pricing" className="text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors">Pricing</Link>
//  <Link to="/aboutus" className="text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors">About Us</Link>
//  </div>

//  <motion.button
//  whileHover={{ scale: 1.05 }}
//  whileTap={{ scale: 0.95 }}
//  onClick={handleLogin}
//  className="text-white text-sm font-medium px-5 py-2 rounded-md transition-all"
//  style={{ backgroundColor: '#21C1B6' }}
//  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#1AA49B'; }}
//  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#21C1B6'; }}
//  >
//  Login
//  </motion.button>
//  </div>
//  </div>
//  </nav>

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
//  <motion.h1
//  className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 mb-4 leading-tight"
//  variants={itemVariants}
//  >
//  Flexible Pricing Plans
//  </motion.h1>

//  <motion.p
//  className="text-lg sm:text-xl text-gray-600 mb-10 max-w-3xl mx-auto leading-relaxed"
//  variants={itemVariants}
//  >
//  Choose the plan that best fits your needs and scale your legal workflow with Nexintel AI.
//  </motion.p>
//  </motion.div>
//  </motion.header>

//  <motion.section
//  ref={featuresRef}
//  className="py-20 bg-gradient-to-br from-white to-gray-50 relative overflow-hidden"
//  >
//  <div className="container mx-auto text-center px-4 sm:px-6 lg:px-8 relative z-10">
//  <div className="flex justify-center mb-8">
//  <div className="inline-flex rounded-md shadow-sm">
//  <button
//  type="button"
//  className={`py-2 px-4 text-sm font-medium rounded-l-md ${
//  planType === 'individual'
//  ? 'text-white'
//  : 'bg-white text-gray-700'
//  } focus:z-10 focus:outline-none focus:ring-2`}
//  style={{
//  backgroundColor: planType === 'individual' ? '#21C1B6' : undefined,
//  borderColor: '#21C1B6'
//  }}
//  onMouseEnter={(e) => {
//  if (planType !== 'individual') e.currentTarget.style.backgroundColor = '#f9fafb';
//  }}
//  onMouseLeave={(e) => {
//  if (planType !== 'individual') e.currentTarget.style.backgroundColor = 'white';
//  }}
//  onClick={() => setPlanType('individual')}
//  >
//  Individual
//  </button>
//  <button
//  type="button"
//  className={`-ml-px py-2 px-4 text-sm font-medium rounded-r-md ${
//  planType === 'team'
//  ? 'text-white'
//  : 'bg-white text-gray-700'
//  } focus:z-10 focus:outline-none focus:ring-2`}
//  style={{
//  backgroundColor: planType === 'team' ? '#21C1B6' : undefined,
//  borderColor: '#21C1B6'
//  }}
//  onMouseEnter={(e) => {
//  if (planType !== 'team') e.currentTarget.style.backgroundColor = '#f9fafb';
//  }}
//  onMouseLeave={(e) => {
//  if (planType !== 'team') e.currentTarget.style.backgroundColor = 'white';
//  }}
//  onClick={() => setPlanType('team')}
//  >
//  Team & Enterprise
//  </button>
//  </div>
//  </div>

//  <div className="flex justify-center mb-12">
//  <div className="inline-flex rounded-md shadow-sm">
//  <button
//  type="button"
//  className={`py-2 px-4 text-sm font-medium rounded-l-md ${
//  billingCycle === 'monthly'
//  ? 'text-white'
//  : 'bg-white text-gray-700'
//  } focus:z-10 focus:outline-none focus:ring-2`}
//  style={{
//  backgroundColor: billingCycle === 'monthly' ? '#21C1B6' : undefined,
//  borderColor: '#21C1B6'
//  }}
//  onMouseEnter={(e) => {
//  if (billingCycle !== 'monthly') e.currentTarget.style.backgroundColor = '#f9fafb';
//  }}
//  onMouseLeave={(e) => {
//  if (billingCycle !== 'monthly') e.currentTarget.style.backgroundColor = 'white';
//  }}
//  onClick={() => setBillingCycle('monthly')}
//  >
//  Monthly
//  </button>
//  <button
//  type="button"
//  className={`-ml-px py-2 px-4 text-sm font-medium ${
//  billingCycle === 'yearly'
//  ? 'text-white'
//  : 'bg-white text-gray-700'
//  } focus:z-10 focus:outline-none focus:ring-2`}
//  style={{
//  backgroundColor: billingCycle === 'yearly' ? '#21C1B6' : undefined,
//  borderColor: '#21C1B6'
//  }}
//  onMouseEnter={(e) => {
//  if (billingCycle !== 'yearly') e.currentTarget.style.backgroundColor = '#f9fafb';
//  }}
//  onMouseLeave={(e) => {
//  if (billingCycle !== 'yearly') e.currentTarget.style.backgroundColor = 'white';
//  }}
//  onClick={() => setBillingCycle('yearly')}
//  >
//  Yearly
//  </button>
//  <button
//  type="button"
//  className={`-ml-px py-2 px-4 text-sm font-medium rounded-r-md ${
//  billingCycle === 'quarterly'
//  ? 'text-white'
//  : 'bg-white text-gray-700'
//  } focus:z-10 focus:outline-none focus:ring-2`}
//  style={{
//  backgroundColor: billingCycle === 'quarterly' ? '#21C1B6' : undefined,
//  borderColor: '#21C1B6'
//  }}
//  onMouseEnter={(e) => {
//  if (billingCycle !== 'quarterly') e.currentTarget.style.backgroundColor = '#f9fafb';
//  }}
//  onMouseLeave={(e) => {
//  if (billingCycle !== 'quarterly') e.currentTarget.style.backgroundColor = 'white';
//  }}
//  onClick={() => setBillingCycle('quarterly')}
//  >
//  Quarterly
//  </button>
//  </div>
//  </div>

//  {loading && (
//  <div className="text-center text-gray-600 text-lg">Loading plans...</div>
//  )}

//  {error && (
//  <div className="text-center text-red-600 text-lg">Error: {error}</div>
//  )}

//  {!loading && !error && plans.length === 0 && (
//  <div className="text-center text-gray-600 text-lg">No plans available for the selected criteria.</div>
//  )}

//  {!loading && !error && plans.length > 0 && (
//  <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
//  {plans.map((plan) => {
//  const displayPrice = plan.price ? `$${plan.price}` : 'N/A';
//  const isPriceZero = displayPrice === '$0';

//  return (
//  <motion.div
//  key={plan.id}
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
 
//  <div
//  className={`relative p-8 bg-white rounded-2xl shadow-lg border border-gray-100 group-hover:shadow-xl transition-all duration-500 flex flex-col ${plan.highlightClass || ''}`}
//  >
//  <div className="flex-shrink-0 mb-4">
//  {plan.icon ? (
//  plan.icon
//  ) : (
//  <svg className="h-12 w-12 text-gray-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1">
//  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.592 1L21 12h-4m-7 0h-4M7.21 14.77l-2.832 4.904A2 2 0 011.91 21h16.18a2 2 0 001.728-3.224L12.79 8.23" />
//  </svg>
//  )}
//  </div>
//  <h2 className="text-2xl font-bold text-gray-900 mb-2">{plan.name}</h2>
//  <p className="text-gray-500 text-sm mb-4">{plan.tagline}</p>
//  <div className="flex items-baseline mb-6">
//  <span className="text-4xl font-extrabold text-gray-900">
//  {displayPrice}
//  </span>
//  {!isPriceZero && (
//  <span className="ml-1 text-gray-500 text-base">
//  {billingCycle === 'monthly' ? '/ month billed monthly' : (billingCycle === 'yearly' ? '/ month billed annually' : '/ month billed quarterly')}
//  </span>
//  )}
//  </div>
//  <motion.button
//  whileHover={{ scale: 1.05 }}
//  whileTap={{ scale: 0.98 }}
//  onClick={() => handleSelectPlan(plan)}
//  className={`w-full py-3 px-6 rounded-md text-base font-medium transition-colors duration-200 ${
//  plan.id === 'free' || !plan.price 
//  ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
//  : 'text-white'
//  }`}
//  style={{
//  backgroundColor: (plan.id !== 'free' && plan.price) ? '#21C1B6' : undefined
//  }}
//  onMouseEnter={(e) => {
//  if (plan.id !== 'free' && plan.price) {
//  e.currentTarget.style.backgroundColor = '#1AA49B';
//  }
//  }}
//  onMouseLeave={(e) => {
//  if (plan.id !== 'free' && plan.price) {
//  e.currentTarget.style.backgroundColor = '#21C1B6';
//  }
//  }}
//  disabled={plan.id === 'free' || !plan.price}
//  >
//  {plan.buttonText || 'Select Plan'}
//  </motion.button>
//  <div className="mt-8 flex-1">
//  <ul className="space-y-4">
//  {plan.features ? (
//  (typeof plan.features === 'string' ? plan.features.split(',').map(f => f.trim()) : plan.features).map((feature, index) => (
//  <li key={index} className="flex items-start">
//  <CheckIcon className="h-5 w-5 text-green-500 flex-shrink-0 mr-2" />
//  <span className="text-gray-700 text-sm">{feature}</span>
//  </li>
//  ))
//  ) : (
//  <li className="text-gray-500 text-sm">No features listed.</li>
//  )}
//  </ul>
//  </div>
//  </div>
//  </motion.div>
//  );
//  })}
//  </div>
//  )}
//  </div>
//  </motion.section>

//  </div>
//  );
// };

// export default PricingPage;


// import React, { useState, useEffect, useCallback, useRef } from 'react';
// import { useNavigate } from 'react-router-dom';
// import { CheckIcon } from '@heroicons/react/20/solid';
// import { motion, useScroll, useTransform, useInView } from 'framer-motion';
// import apiService from '../services/api';
// import { useAuth } from '../context/AuthContext';
// import Footer from '../components/Footer';

// const RAZORPAY_KEY_ID = import.meta.env.VITE_APP_RAZORPAY_KEY_ID || 'rzp_test_R6mBF5iIMakFt1';
// const BACKEND_BASE_URL = import.meta.env.VITE_APP_API_URL || 'https://nexintelai-user.onrender.com/api';

// const PricingPage = () => {
//   const navigate = useNavigate();
//   const { scrollY } = useScroll();
//   const heroRef = useRef(null);
//   const featuresRef = useRef(null);
//   const isHeroInView = useInView(heroRef, { once: true });
//   const isFeaturesInView = useInView(featuresRef, { once: true });

//   const [billingCycle, setBillingCycle] = useState('yearly');
//   const [planType, setPlanType] = useState('individual');
//   const [plans, setPlans] = useState([]);
//   const [loading, setLoading] = useState(true);
//   const [error, setError] = useState(null);
//   const [selectedPlan, setSelectedPlan] = useState(null);
//   const { user, token } = useAuth();

//   const heroY = useTransform(scrollY, [0, 500], [0, -50]);
//   const heroOpacity = useTransform(scrollY, [0, 300], [1, 0.8]);

//   const containerVariants = {
//     hidden: { opacity: 0 },
//     visible: {
//       opacity: 1,
//       transition: {
//         staggerChildren: 0.15,
//         delayChildren: 0.1
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

//   const cardVariants = {
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
//         duration: 0.7,
//         ease: [0.25, 0.46, 0.45, 0.94]
//       }
//     }
//   };

//   const fetchPlans = useCallback(async () => {
//     setLoading(true);
//     setError(null);
//     try {
//       const response = await apiService.getPublicPlans();
//       if (response && Array.isArray(response.data)) {
//         const filteredPlans = response.data.filter(plan => {
//           const matchesType = (planType === 'team' && plan.type === 'business') || 
//                             (planType === 'individual' && plan.type === 'individual');
//           const matchesInterval = (billingCycle === 'monthly' && plan.interval === 'month') ||
//                                 (billingCycle === 'yearly' && plan.interval === 'year') ||
//                                 (billingCycle === 'quarterly' && plan.interval === 'quarterly');
//           return matchesType && matchesInterval;
//         });
//         setPlans(filteredPlans);
//       } else {
//         setError('Invalid data received from server.');
//       }
//     } catch (err) {
//       setError(err.message || 'Failed to fetch plans. Please try again later.');
//     } finally {
//       setLoading(false);
//     }
//   }, [planType, billingCycle]);

//   useEffect(() => {
//     fetchPlans();
//   }, [fetchPlans]);

//   const handlePaymentSuccess = (planName) => {
//     const userInfo = JSON.parse(localStorage.getItem('userInfo'));
//     if (userInfo) {
//       userInfo.plan = planName;
//       localStorage.setItem('userInfo', JSON.stringify(userInfo));
//       window.dispatchEvent(new CustomEvent('userInfoUpdated'));
//     }
//     navigate('/dashboard');
//   };

//   const handleSelectPlan = async (plan) => {
//     if (!token) {
//       setError('You must be logged in to subscribe to a plan.');
//       navigate('/login');
//       return;
//     }

//     setSelectedPlan(plan);
//     setLoading(true);
//     setError(null);

//     try {
//       const response = await fetch(`${BACKEND_BASE_URL}/payments/order`, {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//           'Authorization': `Bearer ${token}`
//         },
//         body: JSON.stringify({ planId: plan.id })
//       });

//       const data = await response.json();

//       if (!response.ok) {
//         throw new Error(data.message || 'Failed to create Razorpay order.');
//       }

//       const razorpaySubscription = data.razorpaySubscription;

//       const options = {
//         key: RAZORPAY_KEY_ID,
//         subscription_id: razorpaySubscription.id,
//         name: "NexintelAI Subscriptions",
//         description: plan.name,
//         image: "/src/assets/nexintel.jpg",
//         handler: function (response) {
//           alert('Payment successful! Your subscription is now active.');
//           handlePaymentSuccess(plan.name);
//         },
//         prefill: {
//           name: user?.name || '',
//           email: user?.email || '',
//           contact: user?.contact || ''
//         },
//         notes: {
//           user_id: user?.id || '',
//           plan_id: plan.id
//         },
//         theme: {
//           "color": "#21C1B6"
//         }
//       };

//       const rzp = new window.Razorpay(options);

//       rzp.on('payment.failed', function (response) {
//         alert(`Payment Failed: ${response.error.description || 'Unknown error'}`);
//         setError(`Payment failed: ${response.error.description || 'Unknown error'}`);
//       });

//       rzp.open();

//     } catch (err) {
//       const errorMessage = err.message || 'An unexpected error occurred during the subscription process.';
//       setError(errorMessage);
//     } finally {
//       setLoading(false);
//     }
//   };

//   const ToggleButton = ({ active, onClick, children, position = 'middle' }) => {
//     const roundedClass = position === 'left' ? 'rounded-l-md' : 
//                         position === 'right' ? 'rounded-r-md' : '';
    
//     return (
//       <button
//         type="button"
//         className={`py-2 px-4 text-sm font-medium ${roundedClass} ${
//           active ? 'text-white' : 'bg-white text-gray-700'
//         } focus:z-10 focus:outline-none focus:ring-2 transition-all duration-200`}
//         style={{
//           backgroundColor: active ? '#21C1B6' : undefined,
//           borderColor: '#21C1B6'
//         }}
//         onMouseEnter={(e) => {
//           if (!active) e.currentTarget.style.backgroundColor = '#f9fafb';
//         }}
//         onMouseLeave={(e) => {
//           if (!active) e.currentTarget.style.backgroundColor = 'white';
//         }}
//         onClick={onClick}
//       >
//         {children}
//       </button>
//     );
//   };

//   return (
//     <div className="min-h-screen bg-white overflow-hidden">
//       {/* Hero Section */}
//       <motion.header
//         ref={heroRef}
//         className="relative pt-32 pb-20 overflow-hidden"
//         style={{
//           y: heroY,
//           opacity: heroOpacity,
//           background: 'linear-gradient(to bottom right, #f9fafb, #ffffff, #f0fffe)'
//         }}
//       >
//         <motion.div
//           className="container mx-auto text-center px-4 sm:px-6 lg:px-8 relative z-10"
//           variants={containerVariants}
//           initial="hidden"
//           animate={isHeroInView ? "visible" : "hidden"}
//         >
//           <motion.h1
//             className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 mb-4 leading-tight"
//             variants={itemVariants}
//           >
//             Flexible Pricing Plans
//           </motion.h1>

//           <motion.p
//             className="text-lg sm:text-xl text-gray-600 mb-10 max-w-3xl mx-auto leading-relaxed"
//             variants={itemVariants}
//           >
//             Choose the plan that best fits your needs and scale your legal workflow with Nexintel AI.
//           </motion.p>
//         </motion.div>
//       </motion.header>

//       {/* Pricing Section */}
//       <motion.section
//         ref={featuresRef}
//         className="py-20 bg-gradient-to-br from-white to-gray-50 relative overflow-hidden"
//         initial="hidden"
//         animate={isFeaturesInView ? "visible" : "hidden"}
//         variants={containerVariants}
//       >
//         <div className="container mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
//           {/* Plan Type Toggle */}
//           <div className="flex justify-center mb-8">
//             <div className="inline-flex rounded-md shadow-sm">
//               <ToggleButton
//                 active={planType === 'individual'}
//                 onClick={() => setPlanType('individual')}
//                 position="left"
//               >
//                 Individual
//               </ToggleButton>
//               <ToggleButton
//                 active={planType === 'team'}
//                 onClick={() => setPlanType('team')}
//                 position="right"
//               >
//                 Team & Enterprise
//               </ToggleButton>
//             </div>
//           </div>

//           {/* Billing Cycle Toggle */}
//           <div className="flex justify-center mb-12">
//             <div className="inline-flex rounded-md shadow-sm">
//               <ToggleButton
//                 active={billingCycle === 'monthly'}
//                 onClick={() => setBillingCycle('monthly')}
//                 position="left"
//               >
//                 Monthly
//               </ToggleButton>
//               <ToggleButton
//                 active={billingCycle === 'yearly'}
//                 onClick={() => setBillingCycle('yearly')}
//                 position="middle"
//               >
//                 Yearly
//               </ToggleButton>
//               <ToggleButton
//                 active={billingCycle === 'quarterly'}
//                 onClick={() => setBillingCycle('quarterly')}
//                 position="right"
//               >
//                 Quarterly
//               </ToggleButton>
//             </div>
//           </div>

//           {/* Loading State */}
//           {loading && (
//             <div className="text-center text-gray-600 text-lg">Loading plans...</div>
//           )}

//           {/* Error State */}
//           {error && (
//             <div className="text-center text-red-600 text-lg">Error: {error}</div>
//           )}

//           {/* No Plans State */}
//           {!loading && !error && plans.length === 0 && (
//             <div className="text-center text-gray-600 text-lg">
//               No plans available for the selected criteria.
//             </div>
//           )}

//           {/* Plan Cards */}
//           {!loading && !error && plans.length > 0 && (
//             <div className="grid grid-cols-1 gap-8 md:grid-cols-3 max-w-6xl mx-auto">
//               {plans.map((plan, index) => {
//                 const displayPrice = plan.price ? `$${plan.price}` : 'N/A';
//                 const isPriceZero = displayPrice === '$0';
//                 const isDisabled = plan.id === 'free' || !plan.price;

//                 return (
//                   <motion.div
//                     key={plan.id}
//                     className="group relative"
//                     variants={cardVariants}
//                     whileHover={{
//                       y: -10,
//                       transition: { duration: 0.3 }
//                     }}
//                   >
//                     {/* Glow Effect */}
//                     <motion.div
//                       className="absolute inset-0 rounded-2xl blur-xl opacity-0 group-hover:opacity-20 transition-opacity duration-500"
//                       style={{ backgroundColor: '#21C1B6' }}
//                       animate={{
//                         scale: [1, 1.05, 1]
//                       }}
//                       transition={{
//                         duration: 2,
//                         repeat: Infinity,
//                         ease: "easeInOut",
//                         delay: index * 0.7
//                       }}
//                     />
                    
//                     {/* Card Content */}
//                     <div className="relative p-8 bg-white rounded-2xl shadow-lg border border-gray-100 group-hover:shadow-xl transition-all duration-500 flex flex-col h-full">
//                       {/* Icon */}
//                       <div className="flex-shrink-0 mb-4">
//                         {plan.icon ? (
//                           plan.icon
//                         ) : (
//                           <svg 
//                             className="h-12 w-12 text-gray-900" 
//                             fill="none" 
//                             viewBox="0 0 24 24" 
//                             stroke="currentColor" 
//                             strokeWidth="1"
//                           >
//                             <path 
//                               strokeLinecap="round" 
//                               strokeLinejoin="round" 
//                               d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.592 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.592-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" 
//                             />
//                           </svg>
//                         )}
//                       </div>

//                       {/* Plan Details */}
//                       <h2 className="text-2xl font-bold text-gray-900 mb-2">{plan.name}</h2>
//                       <p className="text-gray-500 text-sm mb-4">{plan.tagline}</p>
                      
//                       {/* Pricing */}
//                       <div className="flex items-baseline mb-6">
//                         <span className="text-4xl font-extrabold text-gray-900">
//                           {displayPrice}
//                         </span>
//                         {!isPriceZero && (
//                           <span className="ml-1 text-gray-500 text-base">
//                             {billingCycle === 'monthly' 
//                               ? '/ month billed monthly' 
//                               : billingCycle === 'yearly' 
//                                 ? '/ month billed annually' 
//                                 : '/ month billed quarterly'}
//                           </span>
//                         )}
//                       </div>

//                       {/* CTA Button */}
//                       <motion.button
//                         whileHover={!isDisabled ? { scale: 1.05 } : {}}
//                         whileTap={!isDisabled ? { scale: 0.98 } : {}}
//                         onClick={() => !isDisabled && handleSelectPlan(plan)}
//                         className={`w-full py-3 px-6 rounded-md text-base font-medium transition-colors duration-200 ${
//                           isDisabled
//                             ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
//                             : 'text-white'
//                         }`}
//                         style={{
//                           backgroundColor: !isDisabled ? '#21C1B6' : undefined
//                         }}
//                         onMouseEnter={(e) => {
//                           if (!isDisabled) {
//                             e.currentTarget.style.backgroundColor = '#1AA49B';
//                           }
//                         }}
//                         onMouseLeave={(e) => {
//                           if (!isDisabled) {
//                             e.currentTarget.style.backgroundColor = '#21C1B6';
//                           }
//                         }}
//                         disabled={isDisabled}
//                       >
//                         {plan.buttonText || 'Select Plan'}
//                       </motion.button>

//                       {/* Features List */}
//                       <div className="mt-8 flex-1">
//                         <ul className="space-y-4">
//                           {plan.features ? (
//                             (typeof plan.features === 'string' 
//                               ? plan.features.split(',').map(f => f.trim()) 
//                               : plan.features
//                             ).map((feature, idx) => (
//                               <li key={idx} className="flex items-start">
//                                 <CheckIcon className="h-5 w-5 text-green-500 flex-shrink-0 mr-2 mt-0.5" />
//                                 <span className="text-gray-700 text-sm">{feature}</span>
//                               </li>
//                             ))
//                           ) : (
//                             <li className="text-gray-500 text-sm">No features listed.</li>
//                           )}
//                         </ul>
//                       </div>
//                     </div>
//                   </motion.div>
//                 );
//               })}
//             </div>
//           )}
//         </div>
//       </motion.section>
//       <Footer />
//     </div>
//   );
// };

// export default PricingPage;



import React, { useState, useEffect, useCallback } from 'react';
import { CheckIcon } from '@heroicons/react/20/solid';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import Footer from '../components/Footer';
import apiService from '../services/api';
import { useAuth } from '../context/AuthContext';

// FIXED: Remove hardcoded test key - get from environment or backend
const BACKEND_BASE_URL = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000/payments';

console.log('Environment variables:', { BACKEND_BASE_URL });

const PricingPage = () => {
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
 <div className="flex flex-col min-h-screen bg-gray-50">
 <div className="flex-grow max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 w-full">
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
 <Footer />
 </div>
 );
};

export default PricingPage;