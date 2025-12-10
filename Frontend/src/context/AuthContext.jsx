


// import React, { createContext, useContext, useState, useEffect } from 'react';
// import api from '../services/api'; // Import the API service

// const AuthContext = createContext(null);

// export const AuthProvider = ({ children }) => {
//   const [user, setUser] = useState(null);
//   const [token, setToken] = useState(null);
//   const [loading, setLoading] = useState(true);

//   // Initialize auth state from localStorage on component mount
//   useEffect(() => {
//     const initializeAuth = () => {
//       const storedToken = localStorage.getItem('token');
//       const storedUser = localStorage.getItem('user');

//       console.log('AuthContext: Initializing from localStorage - Token:', storedToken ? 'Present' : 'Not Present');

//       if (storedToken) {
//         setToken(storedToken);
        
//         if (storedUser) {
//           try {
//             const parsedUser = JSON.parse(storedUser);
//             setUser(parsedUser);
//             console.log('AuthContext: User restored from localStorage:', parsedUser.email);
//           } catch (e) {
//             console.error('AuthContext: Failed to parse user from localStorage', e);
//             // Clear invalid data
//             localStorage.removeItem('user');
//             localStorage.removeItem('token');
//             setToken(null);
//             setUser(null);
//           }
//         }
//       }
      
//       setLoading(false);
//     };

//     initializeAuth();
//   }, []); // Empty dependency array - only run once on mount

//   const login = async (email, password) => {
//     try {
//       const response = await api.login({ email, password });
      
//       // Check if OTP is required (remove the forced true condition)
//       if (response.requiresOtp) {
//         console.log('AuthContext: OTP required for login.');
//         return { 
//           success: false, 
//           requiresOtp: true, 
//           email: email, 
//           message: response.message || 'OTP required. Please check your email.' 
//         };
//       }
      
//       // If login is successful and token is provided
//       if (response.token) {
//         setToken(response.token);
//         setUser(response.user);
        
//         // Store in localStorage
//         localStorage.setItem('token', response.token);
//         localStorage.setItem('user', JSON.stringify(response.user));
        
//         console.log('AuthContext: Login successful, token stored:', response.token);
//         return { success: true, user: response.user, token: response.token };
//       }
      
//       return { success: false, message: response.message || 'Login failed: No token received.' };
//     } catch (error) {
//       console.error('AuthContext: Login failed:', error);
//       return { success: false, message: error.message || 'Login failed.' };
//     }
//   };

//   const verifyOtp = async (email, otp) => {
//     try {
//       const response = await api.verifyOtp(email, otp);
      
//       if (response.success && response.token) {
//         setToken(response.token);
//         setUser(response.user);
        
//         // Store in localStorage
//         localStorage.setItem('token', response.token);
//         localStorage.setItem('user', JSON.stringify(response.user));
        
//         console.log('AuthContext: OTP verification successful, token stored:', response.token);
//         return { success: true, user: response.user, token: response.token };
//       }
      
//       return { success: false, message: response.message || 'OTP verification failed.' };
//     } catch (error) {
//       console.error('AuthContext: OTP verification failed:', error);
//       return { success: false, message: error.message || 'OTP verification failed.' };
//     }
//   };

//   // NEW METHOD: Manually set authentication state (for Google Sign-In and other OAuth providers)
//   const setAuthState = (authToken, userData) => {
//     console.log('AuthContext: Manually setting auth state for user:', userData.email);
    
//     setToken(authToken);
//     setUser(userData);
    
//     // Store in localStorage
//     localStorage.setItem('token', authToken);
//     localStorage.setItem('user', JSON.stringify(userData));
    
//     console.log('AuthContext: Auth state manually updated');
//   };

//   const logout = () => {
//     setUser(null);
//     setToken(null);
    
//     // Clear localStorage
//     localStorage.removeItem('token');
//     localStorage.removeItem('user');
    
//     console.log('AuthContext: User logged out, all data cleared.');
//   };

//   // Check if user is authenticated
//   const isAuthenticated = !loading && token && user;

//   const value = {
//     user,
//     token,
//     loading,
//     isAuthenticated,
//     login,
//     logout,
//     verifyOtp,
//     setAuthState // Export the new method
//   };

//   return (
//     <AuthContext.Provider value={value}>
//       {children}
//     </AuthContext.Provider>
//   );
// };

// export const useAuth = () => {
//   const context = useContext(AuthContext);
//   if (!context) {
//     throw new Error('useAuth must be used within an AuthProvider');
//   }
//   return context;
// };




import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api'; // Import the API service

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [planInfo, setPlanInfo] = useState(null); // Store plan data in RAM

  // Function to fetch and store plan data in RAM
  const fetchAndStorePlan = async (authToken) => {
    try {
      if (!authToken) {
        console.log('⚠️ AuthContext: No token provided for plan fetch');
        return null;
      }

      console.log('🔄 AuthContext: Fetching plan from API...');
      const response = await fetch('http://localhost:5000/user-resources/plan-details', {
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
      if (activePlan && activePlan.plan_name) {
        const planName = activePlan.plan_name || activePlan.planName || activePlan.name;
        const planData = {
          plan: planName,
          lastPayment: activePlan.lastPayment || data.lastPayment,
          subscription: activePlan
        };
        
        // Store in RAM (context state)
        setPlanInfo(planData);
        
        // Also update localStorage for persistence
        try {
          const existingUserInfo = localStorage.getItem('userInfo');
          const userInfoData = existingUserInfo ? JSON.parse(existingUserInfo) : {};
          userInfoData.plan = planName;
          userInfoData.lastPayment = planData.lastPayment;
          userInfoData.lastFetched = new Date().toISOString();
          localStorage.setItem('userInfo', JSON.stringify(userInfoData));
          console.log('✅ AuthContext: Updated localStorage with plan:', planName);
        } catch (storageError) {
          console.error('⚠️ AuthContext: Failed to update localStorage:', storageError);
        }

        console.log('✅ AuthContext: Plan stored in RAM:', planName);
        return planData;
      }

      return null;
    } catch (error) {
      console.error('❌ AuthContext: Error fetching plan from API:', error);
      return null;
    }
  };

  // Initialize auth state from localStorage on component mount
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
            setUser(parsedUser);
            console.log('AuthContext: User restored from localStorage:', parsedUser.email);
          } catch (e) {
            console.error('AuthContext: Failed to parse user from localStorage', e);
            // Clear invalid data
            localStorage.removeItem('user');
            localStorage.removeItem('token');
            setToken(null);
            setUser(null);
          }
        }

        // Restore plan from localStorage to RAM immediately
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

        // Fetch fresh plan data in background (non-blocking)
        fetchAndStorePlan(storedToken).catch(err => {
          console.error('AuthContext: Background plan fetch failed:', err);
        });
      }
      
      setLoading(false);
    };

    initializeAuth();
  }, []); // Empty dependency array - only run once on mount

  const login = async (email, password) => {
    try {
      const response = await api.login({ email, password });
      
      // Check if OTP is required (remove the forced true condition)
      if (response.requiresOtp) {
        console.log('AuthContext: OTP required for login.');
        return { 
          success: false, 
          requiresOtp: true, 
          email: email, 
          message: response.message || 'OTP required. Please check your email.' 
        };
      }
      
      // If login is successful and token is provided
      if (response.token) {
        setToken(response.token);
        setUser(response.user);
        
        // Store in localStorage
        localStorage.setItem('token', response.token);
        localStorage.setItem('user', JSON.stringify(response.user));
        
        console.log('AuthContext: Login successful, token stored:', response.token);
        
        // Fetch and store plan data in RAM immediately (non-blocking)
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

  const verifyOtp = async (email, otp) => {
    try {
      const response = await api.verifyOtp(email, otp);
      
      if (response.success && response.token) {
        setToken(response.token);
        setUser(response.user);
        
        // Store in localStorage
        localStorage.setItem('token', response.token);
        localStorage.setItem('user', JSON.stringify(response.user));
        
        console.log('AuthContext: OTP verification successful, token stored:', response.token);
        
        // Fetch and store plan data in RAM immediately (non-blocking)
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

  // NEW METHOD: Manually set authentication state (for Google Sign-In and other OAuth providers)
  const setAuthState = (authToken, userData) => {
    console.log('AuthContext: Manually setting auth state for user:', userData.email);
    
    setToken(authToken);
    setUser(userData);
    
    // Store in localStorage
    localStorage.setItem('token', authToken);
    localStorage.setItem('user', JSON.stringify(userData));
    
    // Fetch and store plan data in RAM immediately (non-blocking)
    fetchAndStorePlan(authToken).catch(err => {
      console.error('AuthContext: Plan fetch after setAuthState failed:', err);
    });
    
    console.log('AuthContext: Auth state manually updated');
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    setPlanInfo(null); // Clear plan from RAM
    
    // Clear localStorage
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    
    console.log('AuthContext: User logged out, all data cleared.');
  };

  // Check if user is authenticated
  const isAuthenticated = !loading && token && user;

  const value = {
    user,
    token,
    loading,
    isAuthenticated,
    planInfo, // Export plan data from RAM
    login,
    logout,
    verifyOtp,
    setAuthState, // Export the new method
    fetchAndStorePlan // Export function to manually refresh plan
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