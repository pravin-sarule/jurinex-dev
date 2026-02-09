import React, { useState, useEffect, useCallback } from 'react';
import { CreditCard, Users, Calendar, TrendingUp, Download, Settings, AlertCircle, RefreshCw, Cpu } from 'lucide-react';
import html2pdf from 'html2pdf.js';

import { USER_RESOURCES_SERVICE_URL, PAYMENT_SERVICE_URL, FILES_SERVICE_URL } from '../config/apiConfig';
import LLMUsageComponent from '../components/LLMUsageComponent';

const api = {
 getUserPlanDetails: async () => {
 const token = localStorage.getItem('token');
 const response = await fetch(`${USER_RESOURCES_SERVICE_URL}/plan-details`, {
 headers: {
 'Authorization': `Bearer ${token}`,
 'Content-Type': 'application/json'
 },
 credentials: 'include'
 });
 if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
 return response.json();
 },
 fetchPaymentHistory: async () => {
 const token = localStorage.getItem('token');
 const response = await fetch(`${PAYMENT_SERVICE_URL}/history`, {
 headers: {
 'Authorization': `Bearer ${token}`,
 'Content-Type': 'application/json'
 },
 credentials: 'include'
 });
 if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
 return response.json();
 },
 getUserTokenUsage: async () => {
 const token = localStorage.getItem('token');
 const response = await fetch(`${USER_RESOURCES_SERVICE_URL}/token-usage`, {
 headers: {
 'Authorization': `Bearer ${token}`,
 'Content-Type': 'application/json'
 },
 credentials: 'include'
 });
 if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
 return response.json();
 }
};

const BillingAndUsagePage = () => {
 const [activeTab, setActiveTab] = useState('overview');
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState(null);
 const [planData, setPlanData] = useState(null);
 const [userSubscription, setUserSubscription] = useState(null);
 const [transactions, setTransactions] = useState([]);
 const [latestPayment, setLatestPayment] = useState(null);
 const [loadingTransactions, setLoadingTransactions] = useState(false);
 const [tokenUsageData, setTokenUsageData] = useState(null);
 const [loadingTokenUsage, setLoadingTokenUsage] = useState(false);
 const [refreshTrigger, setRefreshTrigger] = useState(0);

 const fetchPlanData = async () => {
 try {
 setError(null);
 const data = await api.getUserPlanDetails();
 
 setPlanData(data);
 
 const activePlan = data.activePlan || data.userSubscription || data.subscription;
 if (activePlan) {
 const normalizedSubscription = {
 id: activePlan.id || activePlan.subscription_id,
 plan_name: activePlan.plan_name || activePlan.planName || activePlan.name,
 type: activePlan.type || activePlan.accountType || activePlan.subscription_type,
 interval: activePlan.interval || activePlan.billingCycle || activePlan.billing_cycle,
 price: activePlan.price || activePlan.cost || activePlan.amount,
 currency: activePlan.currency || 'INR',
 status: activePlan.subscription_status || activePlan.status || (activePlan.is_active ? 'active' : 'inactive'),
 start_date: activePlan.start_date || activePlan.startDate || activePlan.created_at,
 end_date: activePlan.end_date || activePlan.nextBillingDate || activePlan.next_billing_date,
 is_active: activePlan.is_active !== undefined ? activePlan.is_active : (activePlan.status === 'active'),
 ...activePlan
 };
 setUserSubscription(normalizedSubscription);
 
 try {
 const existingUserInfo = localStorage.getItem('userInfo');
 const userInfoData = existingUserInfo ? JSON.parse(existingUserInfo) : {};
 
 userInfoData.plan = normalizedSubscription.plan_name || 'Free plan';
 
 localStorage.setItem('userInfo', JSON.stringify(userInfoData));
 console.log('✅ Updated localStorage["userInfo"] with plan:', userInfoData.plan);
 
 window.dispatchEvent(new CustomEvent('userInfoUpdated'));
 } catch (storageError) {
 console.error('Error updating localStorage with plan info:', storageError);
 }
 }

 const payment = data.latestPayment || data.lastPayment;
 if (payment) {
 setLatestPayment({
 id: payment.id || payment.payment_id,
 amount: payment.amount || payment.total_amount,
 currency: payment.currency || 'INR',
 status: payment.status || payment.payment_status,
 payment_method: payment.payment_method || payment.method,
 payment_date: payment.payment_date || payment.created_at,
 razorpay_payment_id: payment.razorpay_payment_id,
 razorpay_order_id: payment.razorpay_order_id,
 plan_name: payment.plan_name || payment.description,
 ...payment
 });
 
 try {
 const existingUserInfo = localStorage.getItem('userInfo');
 const userInfoData = existingUserInfo ? JSON.parse(existingUserInfo) : {};
 userInfoData.lastPayment = {
 id: payment.razorpay_payment_id || payment.id,
 amount: payment.amount,
 status: payment.status,
 date: payment.payment_date
 };
 localStorage.setItem('userInfo', JSON.stringify(userInfoData));
 } catch (storageError) {
 console.error('Error updating localStorage with payment info:', storageError);
 }
 }
 } catch (err) {
 setError(`Failed to fetch plan data: ${err.message}`);
 console.error('Error fetching plan data:', err);
 }
 };

 const fetchTransactions = async () => {
 try {
 setLoadingTransactions(true);
 const data = await api.fetchPaymentHistory();
 
 let paymentArray = [];
 if (data.data && Array.isArray(data.data)) {
 paymentArray = data.data;
 } else if (Array.isArray(data.payments)) {
 paymentArray = data.payments;
 } else if (Array.isArray(data)) {
 paymentArray = data;
 }

 const normalizedTransactions = paymentArray.map((transaction, index) => ({
 id: transaction.id || transaction.payment_id || `tx-${index}`,
 amount: transaction.amount || transaction.total_amount,
 currency: transaction.currency || 'INR',
 payment_status: transaction.payment_status || transaction.status,
 payment_method: transaction.payment_method || transaction.method,
 payment_date: transaction.payment_date || transaction.created_at,
 plan_name: transaction.plan_name || transaction.description || 'Subscription Payment',
 razorpay_payment_id: transaction.razorpay_payment_id,
 razorpay_order_id: transaction.razorpay_order_id,
 user_subscription_id: transaction.user_subscription_id,
 invoice_link: transaction.invoice_link,
 ...transaction
 }));

 setTransactions(normalizedTransactions);
 } catch (err) {
 console.error('Error fetching payment history:', err);
 setTransactions([]);
 } finally {
 setLoadingTransactions(false);
 }
 };

 const getUserIdFromToken = () => {
 try {
 const token = localStorage.getItem('token');
 if (!token) {
 console.warn('No token found in localStorage');
 return null;
 }
 
 const parts = token.split('.');
 if (parts.length !== 3) {
 console.error('Invalid token format');
 return null;
 }
 
 const payload = JSON.parse(atob(parts[1]));
 console.log('Decoded token payload:', payload);
 
 const userId = payload.userId || payload.id || payload.user_id || payload.sub;
 console.log('Extracted userId from token:', userId);
 
 return userId;
 } catch (error) {
 console.error('Error decoding token:', error);
 return null;
 }
 };

 const fetchTokenUsage = async () => {
 setLoadingTokenUsage(true);
 try {
 console.log('Fetching token usage...');
 
 const response = await api.getUserTokenUsage();
 console.log('Full token usage API response:', JSON.stringify(response, null, 2));
 
 let data = null;
 if (response && response.success && response.data) {
 data = response.data;
 } else if (response && response.data) {
 data = response.data;
 } else if (response) {
 data = response;
 }
 
 console.log('Extracted data:', data);
 
 // Also get plan data to include limits
 let planData = null;
 try {
 const planResponse = await api.getUserPlanDetails();
 planData = planResponse.activePlan || planResponse.userSubscription || planResponse.subscription || planResponse.plan;
 } catch (planErr) {
 console.warn('Could not fetch plan data for token usage:', planErr.message);
 }
 
 if (data) {
      const tokenData = {
        tokensUsed: (data.tokens_used !== null && data.tokens_used !== undefined) ? data.tokens_used : 0,
        tokenLimit: planData?.token_limit || null,
        carryOverLimit: planData?.carry_over_limit || 0,
        carryOverTokens: (data.carry_over_tokens !== null && data.carry_over_tokens !== undefined) ? data.carry_over_tokens : 0,
        planName: planData?.plan_name || planData?.name || 'Unknown',
        periodEnd: data.period_end || null,
        lastUpdated: data.updated_at || null,
      };
 console.log('✅ Successfully parsed token data:', tokenData);
 setTokenUsageData(tokenData);
 } else {
 console.error('❌ Unable to find usage data in response');
 console.log('Response structure:', Object.keys(response || {}));
 setTokenUsageData(null);
 }
 } catch (err) {
 console.error('❌ Error fetching token usage:', err);
 console.error('Error details:', err.message);
 setTokenUsageData(null);
 } finally {
 setLoadingTokenUsage(false);
 }
 };

 const loadAllData = useCallback(async () => {
 setLoading(true);
 setError(null);
 try {
 await Promise.all([
 fetchPlanData(),
 fetchTransactions(),
 fetchTokenUsage(),
 ]);
 } catch (err) {
 console.error('Error loading data:', err);
 setError('Failed to load dashboard data');
 } finally {
 setLoading(false);
 }
 }, []);

 useEffect(() => {
 loadAllData();
 }, [loadAllData, refreshTrigger]);

 const handleRefresh = () => {
 setRefreshTrigger(prev => prev + 1);
 };

 const getUsagePercentage = (used, limit) => {
 if (!limit || limit === 'Unlimited' || limit === null || limit === 0) return 0;
 const usedNum = parseFloat(used) || 0;
 const limitNum = parseFloat(limit) || 0;
 if (limitNum === 0) return 0;
 return Math.min((usedNum / limitNum) * 100, 100);
 };

 const formatDate = (dateString) => {
 if (!dateString) return 'N/A';
 try {
 const date = new Date(dateString);
 if (isNaN(date.getTime())) return 'Invalid Date';
 return date.toLocaleDateString('en-US', {
 year: 'numeric',
 month: 'long',
 day: 'numeric'
 });
 } catch (error) {
 return 'Invalid Date';
 }
 };

 const formatCurrency = (amount, currency = 'INR') => {
 if (amount === null || amount === undefined || isNaN(amount)) return 'N/A';
 const numAmount = parseFloat(amount);
 return new Intl.NumberFormat('en-IN', {
 style: 'currency',
 currency: currency
 }).format(numAmount);
 };

 const TabButton = ({ id, label, icon: Icon }) => (
 <button
 onClick={() => setActiveTab(id)}
 className={`flex items-center px-6 py-3 font-medium transition-colors border rounded-lg ${
 activeTab === id
 ? 'bg-[#21C1B6] text-white border-[#21C1B6]'
 : 'text-gray-700 bg-white border-gray-300 hover:bg-gray-50'
 }`}
 onMouseEnter={(e) => {
 if (activeTab === id) {
 e.currentTarget.style.backgroundColor = '#1AA49B';
 }
 }}
 onMouseLeave={(e) => {
 if (activeTab === id) {
 e.currentTarget.style.backgroundColor = '#21C1B6';
 }
 }}
 >
 <Icon size={18} className="mr-2" />
 {label}
 </button>
 );

 const getTransactionAmountDisplay = (transaction) => {
 if (!transaction.amount) return 'N/A';
 let amount = parseFloat(transaction.amount);
 if (amount > 1000 && !transaction.amount_in_rupees) {
 amount = amount / 100;
 }
 return formatCurrency(amount, transaction.currency || 'INR');
 };

 const exportTransactionsToCSV = () => {
 if (transactions.length === 0) {
 alert('No transactions to export.');
 return;
 }

 const headers = ['Date', 'Description', 'Amount', 'Currency', 'Status', 'Payment Method', 'Transaction ID'];
 
 const csvRows = transactions.map(transaction => {
 return [
 formatDate(transaction.payment_date),
 `"${(transaction.plan_name || 'Subscription Payment').replace(/"/g, '""')}"`,
 getTransactionAmountDisplay(transaction),
 transaction.currency || 'INR',
 transaction.payment_status || 'N/A',
 transaction.payment_method || 'N/A',
 transaction.razorpay_payment_id || transaction.id || 'N/A'
 ].map(field => `"${String(field).replace(/"/g, '""')}"`).join(',');
 });

 const csvContent = [headers.map(h => `"${h}"`).join(','), ...csvRows].join('\n');
 const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
 const link = document.createElement('a');
 const url = URL.createObjectURL(blob);
 link.setAttribute('href', url);
 link.setAttribute('download', `transactions_${new Date().toISOString().split('T')[0]}.csv`);
 link.style.visibility = 'hidden';
 document.body.appendChild(link);
 link.click();
 document.body.removeChild(link);
 };

 const downloadReceipt = (transaction) => {
 const amountDisplay = getTransactionAmountDisplay(transaction);
 const receiptHtml = `
 <div style="font-family: Arial, sans-serif; padding: 40px; max-width: 750px; margin: auto; border: 1px solid #ccc; border-radius: 10px;">
 <div style="text-align: center; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 2px solid #333;">
 <h1 style="color: #000; font-size: 32px; margin: 0;">PAYMENT RECEIPT</h1>
 </div>
 <table style="width: 100%; margin-bottom: 20px;">
 <tr><td style="padding: 10px 0; color: #000; font-weight: bold;">Receipt Number:</td><td style="color: #000;">${transaction.razorpay_payment_id || transaction.id}</td></tr>
 <tr><td style="padding: 10px 0; color: #000; font-weight: bold;">Date:</td><td style="color: #000;">${formatDate(transaction.payment_date)}</td></tr>
 <tr><td style="padding: 10px 0; color: #000; font-weight: bold;">Description:</td><td style="color: #000;">${transaction.plan_name}</td></tr>
 <tr><td style="padding: 10px 0; color: #000; font-weight: bold;">Payment Method:</td><td style="color: #000;">${transaction.payment_method || 'N/A'}</td></tr>
 </table>
 <div style="border-top: 2px solid #333; padding-top: 25px; text-align: right;">
 <p style="font-size: 24px; color: #000;"><strong>TOTAL PAID:</strong> ${amountDisplay}</p>
 </div>
 </div>
 `;
 html2pdf().from(receiptHtml).save(`receipt_${transaction.id}_${Date.now()}.pdf`);
 };

 const LoadingSpinner = () => (
 <div className="flex justify-center items-center py-12">
 <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#21C1B6]"></div>
 <span className="ml-3 text-gray-600">Loading data...</span>
 </div>
 );

 const ErrorMessage = () => (
 <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-8">
 <div className="flex items-center">
 <AlertCircle className="h-5 w-5 text-red-500 mr-2" />
 <h3 className="text-red-800 font-medium">Error loading data</h3>
 </div>
 <p className="text-red-700 mt-2">{error}</p>
 <button onClick={handleRefresh} className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700">
 Retry
 </button>
 </div>
 );

 if (error && !planData && !loading) {
 return (
 <div className="p-8 bg-white min-h-screen">
 <div className="max-w-7xl mx-auto">
 <div className="mb-8 pb-6 border-b border-gray-200">
 <h1 className="text-3xl font-bold text-gray-900 mb-2">Billing & Usage Dashboard</h1>
 </div>
 <ErrorMessage />
 </div>
 </div>
 );
 }

 return (
 <div className="p-8 bg-white min-h-screen">
 <div className="max-w-7xl mx-auto">
 <div className="mb-8 pb-6 border-b border-gray-200 flex justify-between items-center">
 <div>
 <h1 className="text-3xl font-bold text-gray-900 mb-2">Billing & Usage Dashboard</h1>
 <p className="text-gray-900">Manage your subscription and monitor usage</p>
 </div>
 <button
 onClick={handleRefresh}
 className="px-6 py-3 bg-[#21C1B6] text-white font-medium rounded-lg hover:bg-[#1AA49B] flex items-center disabled:opacity-50"
 disabled={loading}
 >
 <RefreshCw size={18} className="mr-2" />
 Refresh
 </button>
 </div>

 {error && <ErrorMessage />}

      <div className="flex flex-wrap gap-3 mb-8">
        <TabButton id="overview" label="Overview" icon={TrendingUp} />
        <TabButton id="usage" label="Token Usage" icon={Calendar} />
        <TabButton id="llm-usage" label="LLM Usage" icon={Cpu} />
        <TabButton id="history" label="Payment History" icon={Download} />
      </div>

 {loading ? (
 <LoadingSpinner />
 ) : (
 <>
 {activeTab === 'overview' && (
 <div className="space-y-8">
 {userSubscription && (
 <div className="bg-white border border-gray-300 rounded-lg p-8">
 <div className="flex justify-between items-start mb-6">
 <div>
 <h2 className="text-2xl font-bold text-gray-900 mb-2">Active Subscription</h2>
 <p className="text-gray-900">Current plan details</p>
 </div>
 <button className="px-6 py-3 bg-[#21C1B6] text-white font-medium rounded-lg hover:bg-[#1AA49B] flex items-center">
 <Settings size={18} className="mr-2" />
 Manage
 </button>
 </div>
 
 <div className="grid md:grid-cols-4 gap-6">
 <div className="border border-gray-200 rounded-lg p-6">
 <div className="text-sm text-gray-900 font-medium mb-2">PLAN</div>
 <div className="text-2xl font-bold text-gray-900">{userSubscription.plan_name || 'Basic'}</div>
 </div>
 <div className="border border-gray-200 p-6">
 <div className="text-sm text-gray-900 font-medium mb-2">TYPE</div>
 <div className="text-2xl font-bold text-gray-900">{userSubscription.type || 'Individual'}</div>
 </div>
 <div className="border border-gray-200 p-6">
 <div className="text-sm text-gray-900 font-medium mb-2">BILLING</div>
 <div className="text-2xl font-bold text-gray-900">{userSubscription.interval || 'Monthly'}</div>
 </div>
 <div className="border border-gray-200 p-6">
 <div className="text-sm text-gray-900 font-medium mb-2">PRICE</div>
 <div className="text-2xl font-bold text-gray-900">
 {userSubscription.price ? formatCurrency(userSubscription.price, userSubscription.currency) : 'N/A'}
 </div>
 </div>
 </div>

 <div className="mt-8 pt-6 border-t border-gray-200">
 <div className="grid md:grid-cols-2 gap-4 text-sm">
 <div>
 <span className="text-gray-500">Status:</span>{' '}
 <span className={`font-semibold px-2 py-1 rounded text-xs ${
 userSubscription.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
 }`}>
 {userSubscription.status || 'Inactive'}
 </span>
 </div>
 <div>
 <span className="text-gray-900">Started:</span>{' '}
 <span className="font-semibold text-gray-900">{formatDate(userSubscription.start_date)}</span>
 </div>
 </div>
 </div>
 </div>
 )}

 {latestPayment && (
 <div className="bg-white border border-gray-300 rounded-lg p-8">
 <h2 className="text-2xl font-bold text-gray-900 mb-6">Latest Payment</h2>
 <div className="grid md:grid-cols-4 gap-6">
 <div className="border border-gray-200 rounded-lg p-6">
 <div className="text-sm text-gray-900 font-medium mb-2">AMOUNT</div>
 <div className="text-2xl font-bold text-gray-900">{getTransactionAmountDisplay(latestPayment)}</div>
 </div>
 <div className="border border-gray-200 p-6">
 <div className="text-sm text-gray-900 font-medium mb-2">METHOD</div>
 <div className="text-2xl font-bold text-gray-900">{latestPayment.payment_method || 'N/A'}</div>
 </div>
 <div className="border border-gray-200 p-6">
 <div className="text-sm text-gray-900 font-medium mb-2">STATUS</div>
 <div className={`text-2xl font-bold ${
 latestPayment.status === 'captured' ? 'text-green-600' : 'text-yellow-600'
 }`}>
 {latestPayment.status || 'N/A'}
 </div>
 </div>
 <div className="border border-gray-200 p-6">
 <div className="text-sm text-gray-900 font-medium mb-2">DATE</div>
 <div className="text-2xl font-bold text-gray-900">{formatDate(latestPayment.payment_date)}</div>
 </div>
 </div>
 </div>
 )}

 {loadingTokenUsage ? (
 <div className="bg-white border border-gray-300 rounded-lg p-8">
 <LoadingSpinner />
 </div>
 ) : tokenUsageData ? (
 <div className="bg-white border border-gray-300 rounded-lg p-8">
 <h2 className="text-2xl font-bold text-gray-900 mb-6">Token Usage Summary</h2>
 <div className="grid md:grid-cols-3 gap-6">
        <div className="border border-gray-200 rounded-lg p-6">
          <div className="flex justify-between items-center mb-4">
            <span className="text-sm font-semibold text-gray-900 uppercase">Total Tokens Used</span>
        <span className="text-xs font-medium text-gray-600 bg-gray-100 rounded px-2 py-1">
          {tokenUsageData.tokenLimit ? `${getUsagePercentage(tokenUsageData.tokensUsed || 0, tokenUsageData.tokenLimit).toFixed(0)}%` : 'UNLIMITED'}
        </span>
 </div>
        <div className="text-3xl font-bold text-gray-900 mb-2">
          {(tokenUsageData.tokensUsed !== null && tokenUsageData.tokensUsed !== undefined) 
            ? tokenUsageData.tokensUsed.toLocaleString() 
            : '0'}
        </div>
 <div className="text-sm text-gray-900">
 {tokenUsageData.tokenLimit ? `of ${tokenUsageData.tokenLimit.toLocaleString()} limit` : 'No limit'}
 </div>
        {tokenUsageData.tokenLimit && (
          <div className="mt-4 w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full ${
                getUsagePercentage(tokenUsageData.tokensUsed || 0, tokenUsageData.tokenLimit) >= 90 ? 'bg-red-500' :
                getUsagePercentage(tokenUsageData.tokensUsed || 0, tokenUsageData.tokenLimit) >= 70 ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${getUsagePercentage(tokenUsageData.tokensUsed || 0, tokenUsageData.tokenLimit)}%` }}
            />
          </div>
        )}
 </div>

 <div className="border border-gray-200 rounded-lg p-6">
 <div className="text-sm font-semibold text-gray-900 uppercase mb-4">Carry Over Tokens</div>
 <div className="text-3xl font-bold text-gray-900 mb-2">
 {tokenUsageData.carryOverTokens?.toLocaleString() || '0'}
 </div>
 <div className="text-sm text-gray-900">
 Max carry over: {tokenUsageData.carryOverLimit?.toLocaleString() || '0'}
 </div>
 </div>

 <div className="border border-gray-200 rounded-lg p-6">
 <div className="text-sm font-semibold text-gray-900 uppercase mb-4">Period Ends</div>
 <div className="text-xl font-bold text-gray-900 mb-2">
 {formatDate(tokenUsageData.periodEnd)}
 </div>
 <div className="text-sm text-gray-900">
 Usage resets at period end
 </div>
 </div>
 </div>
 </div>
 ) : (
 <div className="bg-white border border-gray-300 rounded-lg p-8 text-center">
 <TrendingUp size={48} className="mx-auto text-gray-400 mb-4" />
 <h3 className="text-xl font-semibold text-gray-900 mb-2">Token Usage Not Available</h3>
 <p className="text-gray-900">Unable to load token usage data. Please try refreshing.</p>
 </div>
 )}
 </div>
 )}

 {activeTab === 'usage' && (
 <div className="bg-white border border-gray-300 rounded-lg">
 <div className="p-8 border-b border-gray-200">
 <h2 className="text-2xl font-bold text-gray-900 mb-2">Token Usage Details</h2>
 <p className="text-gray-900">Monitor your token consumption</p>
 </div>
 
 {tokenUsageData ? (
 <div className="p-8">
 <div className="grid md:grid-cols-2 gap-8">
 <div className="border border-gray-200 rounded-lg p-6">
 <h3 className="text-lg font-bold text-gray-900 mb-4">Current Period</h3>
 <div className="space-y-4">
              <div className="flex justify-between">
                <span className="text-gray-900">Total Tokens Used:</span>
                <span className="font-bold text-gray-900">
                  {(tokenUsageData.tokensUsed !== null && tokenUsageData.tokensUsed !== undefined) 
                    ? tokenUsageData.tokensUsed.toLocaleString() 
                    : '0'}
                </span>
              </div>
 <div className="flex justify-between">
 <span className="text-gray-900">Token Limit:</span>
 <span className="font-bold text-gray-900">
 {tokenUsageData.tokenLimit ? tokenUsageData.tokenLimit.toLocaleString() : 'Unlimited'}
 </span>
 </div>
              {tokenUsageData.tokenLimit && (
                <div className="flex justify-between">
                  <span className="text-gray-900">Remaining:</span>
                  <span className="font-bold text-green-600">
                    {(tokenUsageData.tokenLimit - (tokenUsageData.tokensUsed || 0)).toLocaleString()}
                  </span>
                </div>
              )}
 </div>
 </div>

 <div className="border border-gray-200 rounded-lg p-6">
 <h3 className="text-lg font-bold text-gray-900 mb-4">Plan Information</h3>
 <div className="space-y-4">
 <div className="flex justify-between">
 <span className="text-gray-900">Plan Name:</span>
 <span className="font-bold text-gray-900">{tokenUsageData.planName}</span>
 </div>
 <div className="flex justify-between">
 <span className="text-gray-900">Carry Over Available:</span>
 <span className="font-bold text-gray-900">{tokenUsageData.carryOverTokens.toLocaleString()}</span>
 </div>
 <div className="flex justify-between">
 <span className="text-gray-900">Last Updated:</span>
 <span className="font-bold text-gray-900">{formatDate(tokenUsageData.lastUpdated)}</span>
 </div>
 </div>
 </div>
 </div>
 </div>
 ) : (
 <div className="text-center py-12">
 <TrendingUp size={48} className="mx-auto text-gray-400 mb-4" />
 <h3 className="text-xl font-semibold text-gray-900 mb-2">No Usage Data</h3>
 <p className="text-gray-900">Start using the service to see your token usage</p>
 </div>
 )}
 </div>
 )}

          {activeTab === 'llm-usage' && (
            <LLMUsageComponent />
          )}

          {activeTab === 'history' && (
 <div className="bg-white border border-gray-300 rounded-lg">
 <div className="p-8 border-b border-gray-200 flex justify-between items-center">
 <div>
 <h2 className="text-2xl font-bold text-gray-900 mb-2">Payment History</h2>
 <p className="text-gray-900">View all your transactions</p>
 </div>
 <button
 onClick={exportTransactionsToCSV}
 disabled={transactions.length === 0}
 className="px-6 py-3 bg-black text-white font-medium rounded-lg hover:bg-gray-800 flex items-center disabled:opacity-50"
 >
 <Download size={18} className="mr-2" />
 Export CSV
 </button>
 </div>
 
 {loadingTransactions ? (
 <LoadingSpinner />
 ) : (
 <div className="overflow-x-auto">
 {transactions.length === 0 ? (
 <div className="text-center py-12">
 <Calendar size={48} className="mx-auto text-gray-400 mb-4" />
 <h3 className="text-xl font-semibold text-gray-900 mb-2">No Transactions</h3>
 <p className="text-gray-900">Your payment history will appear here</p>
 </div>
 ) : (
 <table className="w-full">
 <thead className="bg-gray-50 border-b border-gray-200">
 <tr>
 <th className="px-8 py-4 text-left text-sm font-bold text-gray-900 uppercase">Date</th>
 <th className="px-8 py-4 text-left text-sm font-bold text-gray-900 uppercase">Description</th>
 <th className="px-8 py-4 text-right text-sm font-bold text-gray-900 uppercase">Amount</th>
 <th className="px-8 py-4 text-center text-sm font-bold text-gray-900 uppercase">Status</th>
 <th className="px-8 py-4 text-center text-sm font-bold text-gray-900 uppercase">Method</th>
 <th className="px-8 py-4 text-center text-sm font-bold text-gray-900 uppercase">Actions</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-gray-200">
 {transactions.map((transaction, index) => (
 <tr key={`${transaction.id}-${index}`} className="hover:bg-gray-50">
 <td className="px-8 py-6 whitespace-nowrap text-base text-gray-900 font-medium">
 {formatDate(transaction.payment_date)}
 </td>
 <td className="px-8 py-6 text-base text-gray-900 font-semibold">
 {transaction.plan_name}
 </td>
 <td className="px-8 py-6 whitespace-nowrap text-base text-gray-900 text-right font-medium">
 {getTransactionAmountDisplay(transaction)}
 </td>
 <td className="px-8 py-6 whitespace-nowrap text-center">
 <span className={`px-3 py-1 text-sm font-bold rounded ${
 transaction.payment_status === 'captured' || transaction.payment_status === 'completed'
 ? 'bg-green-100 text-green-800'
 : transaction.payment_status === 'pending'
 ? 'bg-yellow-100 text-yellow-800'
 : 'bg-red-100 text-red-800'
 }`}>
 {transaction.payment_status || 'N/A'}
 </span>
 </td>
 <td className="px-8 py-6 whitespace-nowrap text-base text-gray-900 text-center">
 {transaction.payment_method || 'N/A'}
 </td>
 <td className="px-8 py-6 whitespace-nowrap text-center">
 <button
 onClick={() => downloadReceipt(transaction)}
 className="border border-gray-300 text-gray-900 px-4 py-2 text-sm font-medium rounded hover:bg-gray-50"
 >
 Download Receipt
 </button>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 )}
 </div>
 )}
 </div>
 )}
 </>
 )}
 </div>
 </div>
 );
};

export default BillingAndUsagePage;