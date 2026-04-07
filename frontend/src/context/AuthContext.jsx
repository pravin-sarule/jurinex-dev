import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';
import { API_BASE_URL, USER_RESOURCES_SERVICE_URL } from '../config/apiConfig';
import { shouldEnforceRbac } from '../utils/permissions';
import { getPlanDisplayName } from '../utils/planUtils';

const AuthContext = createContext(null);
const ACTIVITY_PING_INTERVAL_MS = 15 * 1000;

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [planInfo, setPlanInfo] = useState(null);

  const persistUser = (userData) => {
    setUser(userData);
    if (userData) {
      localStorage.setItem('user', JSON.stringify(userData));
    } else {
      localStorage.removeItem('user');
    }
  };

  const fetchCurrentUserPermissions = async (authToken) => {
    if (!authToken) return null;

    const response = await fetch(`${API_BASE_URL}/api/rbac/permissions/me`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch permissions: ${response.status}`);
    }

    const data = await response.json();
    return data.permissions || {};
  };

  const hydratePermissions = async (authToken, baseUser) => {
    if (!authToken || !baseUser) return baseUser;
    if (!shouldEnforceRbac(baseUser)) return baseUser;

    try {
      const permissions = await fetchCurrentUserPermissions(authToken);
      const nextUser = { ...baseUser, permissions };
      persistUser(nextUser);
      return nextUser;
    } catch (error) {
      console.error('❌ AuthContext: Error fetching current user permissions:', error);
      return baseUser;
    }
  };

  const fetchAndStorePlan = async (authToken) => {
    try {
      if (!authToken) {
        console.log('⚠️ AuthContext: No token provided for plan fetch');
        return null;
      }

      console.log('🔄 AuthContext: Fetching plan from API...');
      const response = await fetch(`${USER_RESOURCES_SERVICE_URL}/plan-details`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        credentials: 'include'
      });

      if (!response.ok) {
        console.error('❌ AuthContext: Failed to fetch plan from API:', response.status);
        return null;
      }

      const data = await response.json();
      console.log('✅ AuthContext: Fetched plan data from API:', data);

      const activePlan = data.activePlan || data.userSubscription || data.subscription;
      if (activePlan && (activePlan.plan_name || activePlan.planName || activePlan.name)) {
        const planName = activePlan.plan_name || activePlan.planName || activePlan.name;
        const planLabel = getPlanDisplayName(activePlan) || planName;
        const planData = {
          plan: planLabel,
          planName,
          isInheritedFromFirm: !!activePlan.is_inherited_from_firm,
          lastPayment: activePlan.lastPayment || data.lastPayment,
          subscription: activePlan
        };
        
        setPlanInfo(planData);
        
        try {
          const existingUserInfo = localStorage.getItem('userInfo');
          const userInfoData = existingUserInfo ? JSON.parse(existingUserInfo) : {};
          userInfoData.plan = planLabel;
          userInfoData.lastPayment = planData.lastPayment;
          userInfoData.lastFetched = new Date().toISOString();
          localStorage.setItem('userInfo', JSON.stringify(userInfoData));
          console.log('✅ AuthContext: Updated localStorage with plan:', planLabel);
        } catch (storageError) {
          console.error('⚠️ AuthContext: Failed to update localStorage:', storageError);
        }

        console.log('✅ AuthContext: Plan stored in RAM:', planLabel);
        return planData;
      }

      return null;
    } catch (error) {
      console.error('❌ AuthContext: Error fetching plan from API:', error);
      return null;
    }
  };

  useEffect(() => {
    const initializeAuth = async () => {
      const storedToken = localStorage.getItem('token');
      const storedUser = localStorage.getItem('user');
      const storedPlanInfo = localStorage.getItem('userInfo');

      console.log('AuthContext: Initializing from localStorage - Token:', storedToken ? 'Present' : 'Not Present');

      if (storedToken) {
        setToken(storedToken);
        
        if (storedUser) {
          try {
            const parsedUser = JSON.parse(storedUser);
            persistUser(parsedUser);
            console.log('AuthContext: User restored from localStorage:', parsedUser.email);

            hydratePermissions(storedToken, parsedUser).catch((err) => {
              console.error('AuthContext: Background permission fetch failed:', err);
            });
          } catch (e) {
            console.error('AuthContext: Failed to parse user from localStorage', e);
            localStorage.removeItem('user');
            localStorage.removeItem('token');
            setToken(null);
            setUser(null);
          }
        }

        if (storedPlanInfo) {
          try {
            const parsedPlanInfo = JSON.parse(storedPlanInfo);
            if (parsedPlanInfo.plan) {
              setPlanInfo(parsedPlanInfo);
              console.log('✅ AuthContext: Plan restored from localStorage to RAM:', parsedPlanInfo.plan);
            }
          } catch (e) {
            console.error('AuthContext: Failed to parse planInfo from localStorage', e);
          }
        }

        fetchAndStorePlan(storedToken).catch(err => {
          console.error('AuthContext: Background plan fetch failed:', err);
        });
      }
      
      setLoading(false);
    };

    initializeAuth();
  }, []);

  useEffect(() => {
    if (!token || loading) return undefined;

    const pingActivity = async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }

      try {
        await fetch(`${API_BASE_URL}/api/auth/activity/ping`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          credentials: 'include',
        });
      } catch (error) {
        console.warn('AuthContext: Activity ping failed:', error.message);
      }
    };

    pingActivity();
    const intervalId = window.setInterval(pingActivity, ACTIVITY_PING_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        pingActivity();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [token, loading]);

  const login = async (email, password) => {
    try {
      const response = await api.login({ email, password });
      
      if (response.requiresOtp) {
        console.log('AuthContext: OTP required for login.');
        return { 
          success: false, 
          requiresOtp: true, 
          firstLogin: response.firstLogin || false,
          email: email, 
          message: response.message || 'OTP required. Please check your email.' 
        };
      }
      
      if (response.token) {
        setToken(response.token);
        persistUser(response.user);
        
        localStorage.setItem('token', response.token);
        
        console.log('AuthContext: Login successful, token stored:', response.token);

        await hydratePermissions(response.token, response.user);
        
        fetchAndStorePlan(response.token).catch(err => {
          console.error('AuthContext: Plan fetch after login failed:', err);
        });
        
        return { success: true, user: response.user, token: response.token };
      }
      
      return { success: false, message: response.message || 'Login failed: No token received.' };
    } catch (error) {
      console.error('AuthContext: Login failed:', error);
      return { success: false, message: error.message || 'Login failed.' };
    }
  };

  const verifyOtp = async (email, otp, newPassword = null) => {
    try {
      const response = await api.verifyOtp(email, otp, newPassword);
      
      if (response.success && response.token) {
        setToken(response.token);
        persistUser(response.user);
        
        localStorage.setItem('token', response.token);
        
        console.log('AuthContext: OTP verification successful, token stored:', response.token);

        await hydratePermissions(response.token, response.user);
        
        fetchAndStorePlan(response.token).catch(err => {
          console.error('AuthContext: Plan fetch after OTP verification failed:', err);
        });
        
        return { success: true, user: response.user, token: response.token };
      }
      
      return { success: false, message: response.message || 'OTP verification failed.' };
    } catch (error) {
      console.error('AuthContext: OTP verification failed:', error);
      return { success: false, message: error.message || 'OTP verification failed.' };
    }
  };

  const setAuthState = (authToken, userData) => {
    console.log('AuthContext: Manually setting auth state for user:', userData.email);
    
    setToken(authToken);
    persistUser(userData);
    
    localStorage.setItem('token', authToken);

    hydratePermissions(authToken, userData).catch(err => {
      console.error('AuthContext: Permission fetch after setAuthState failed:', err);
    });
    
    fetchAndStorePlan(authToken).catch(err => {
      console.error('AuthContext: Plan fetch after setAuthState failed:', err);
    });
    
    console.log('AuthContext: Auth state manually updated');
  };

  const logout = () => {
    persistUser(null);
    setToken(null);
    setPlanInfo(null);
    
    localStorage.removeItem('token');
    
    console.log('AuthContext: User logged out, all data cleared.');
  };

  const isAuthenticated = !loading && token && user;

  const value = {
    user,
    token,
    loading,
    isAuthenticated,
    planInfo,
    login,
    logout,
    verifyOtp,
    setAuthState,
    fetchAndStorePlan,
    hydratePermissions,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
