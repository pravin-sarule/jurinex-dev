/**
 * Plan Utilities
 * Helper functions to check user plan status and restrictions
 */

/**
 * Checks if a user is on a free tier plan
 * @param {string|Object} plan - Plan name string or plan object
 * @returns {boolean} - True if user is on free tier
 */
export const isFreeTier = (plan) => {
  if (!plan) return true; // Default to free tier if no plan data
  
  // If plan is an object, extract the plan name
  const planName = typeof plan === 'object' ? (plan.plan || plan.name || plan.plan_name) : plan;
  
  if (!planName || typeof planName !== 'string') return true; // Default to free tier
  
  // Normalize plan name to lowercase for comparison
  const normalizedPlan = planName.toLowerCase().trim();
  
  // Check if it's a free tier plan
  const freeTierIndicators = ['free', 'free plan'];
  
  // If plan contains "free", it's a free tier
  if (freeTierIndicators.some(indicator => normalizedPlan.includes(indicator))) {
    return true;
  }
  
  // If plan is not explicitly free-related, check if it's a paid plan
  const paidTierIndicators = ['premium', 'pro', 'plus', 'paid', 'subscription', 'plan'];
  
  // If it contains paid tier indicators and doesn't contain "free", it's paid
  if (paidTierIndicators.some(indicator => normalizedPlan.includes(indicator)) && 
      !normalizedPlan.includes('free')) {
    return false;
  }
  
  // Default to free tier if uncertain
  return true;
};

/**
 * Gets the user's plan from localStorage
 * @returns {string|null} - User's plan name or null if not found
 */
export const getUserPlan = () => {
  try {
    const userInfo = localStorage.getItem('userInfo');
    if (userInfo) {
      const parsed = JSON.parse(userInfo);
      return parsed.plan || null;
    }
  } catch (error) {
    console.error('Error getting user plan from localStorage:', error);
  }
  return null;
};

/**
 * Checks if user is on free tier by reading from localStorage
 * @returns {boolean} - True if user is on free tier
 */
export const isUserFreeTier = () => {
  const plan = getUserPlan();
  return isFreeTier(plan);
};

/**
 * Free tier file size limit in bytes (10 MB)
 */
export const FREE_TIER_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Free tier file size limit in MB
 */
export const FREE_TIER_MAX_FILE_SIZE_MB = 10;

/**
 * Formats file size to human readable format
 * @param {number} bytes - File size in bytes
 * @returns {string} - Formatted file size (e.g., "5.2 MB")
 */
export const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
};

