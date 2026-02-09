export const isFreeTier = (plan) => {
  if (!plan) return true;
  
  const planName = typeof plan === 'object' ? (plan.plan || plan.name || plan.plan_name) : plan;
  
  if (!planName || typeof planName !== 'string') return true;
  
  const normalizedPlan = planName.toLowerCase().trim();
  
  const freeTierIndicators = ['free', 'free plan'];
  
  if (freeTierIndicators.some(indicator => normalizedPlan.includes(indicator))) {
    return true;
  }
  
  const paidTierIndicators = ['premium', 'pro', 'plus', 'paid', 'subscription', 'plan'];
  
  if (paidTierIndicators.some(indicator => normalizedPlan.includes(indicator)) && 
      !normalizedPlan.includes('free')) {
    return false;
  }
  
  return true;
};

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

export const isUserFreeTier = () => {
  const plan = getUserPlan();
  return isFreeTier(plan);
};

export const FREE_TIER_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export const FREE_TIER_MAX_FILE_SIZE_MB = 10;

export const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
};



