// import React, { useEffect } from 'react';
// import { useNavigate } from 'react-router-dom';
// import { useAuth } from '../context/AuthContext'; // Import useAuth

// const AuthChecker = ({ children }) => {
//   const navigate = useNavigate();
//   const { token, loading } = useAuth(); // Get token and loading state from AuthContext

//   useEffect(() => {
//     // Add a small delay to allow AuthContext to fully initialize
//     const timer = setTimeout(() => {
//       if (!loading && !token) {
//         navigate('/login');
//       }
//     }, 100);

//     return () => clearTimeout(timer);
//   }, [token, loading, navigate]); // Add token and loading to dependency array

//   // Render children only when authentication state is loaded
//   if (loading) {
//     return <div>Loading authentication...</div>; // Or a spinner, or null
//   }

//   return <>{children}</>;
// };

// export default AuthChecker;


import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ProfileSetupPopup from './ProfileSetupPopup';
import api from '../services/api';

const AuthChecker = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, loading, user } = useAuth();
  const [showProfileSetup, setShowProfileSetup] = useState(false);
  const [hasCheckedProfile, setHasCheckedProfile] = useState(false);

  useEffect(() => {
    // Don't redirect if still loading
    if (loading) {
      return;
    }

    // Don't redirect if user is authenticated
    if (isAuthenticated) {
      // Check if profile setup is needed (only once after authentication)
      if (!hasCheckedProfile && user) {
        checkProfileCompletion();
      }
      return;
    }

    // Don't redirect if already on login or register pages
    const publicRoutes = ['/login', '/register', '/', '/forgot-password'];
    if (publicRoutes.includes(location.pathname)) {
      return;
    }

    // Redirect to login if not authenticated and not on a public route
    console.log('AuthChecker: User not authenticated, redirecting to login');
    navigate('/login', { 
      replace: true,
      state: { from: location.pathname } // Save the attempted route
    });
  }, [isAuthenticated, loading, navigate, location.pathname, user, hasCheckedProfile]);

  const checkProfileCompletion = async () => {
    // Don't block dashboard loading - check in background
    // Mark as checked immediately so dashboard can load
    setHasCheckedProfile(true);
    
    // Check profile completion in background (non-blocking)
    try {
      // Fetch professional profile from API
      const response = await api.getProfessionalProfile();
      
      if (response && response.data) {
        const isProfileCompleted = response.data.is_profile_completed;
        
        // Only show popup if profile is not completed (false or undefined/null)
        if (!isProfileCompleted) {
          console.log('AuthChecker: Profile not completed, showing setup popup');
          // Show popup immediately
          setShowProfileSetup(true);
          // Mark as completed in background (non-blocking) so popup only shows once
          api.updateProfessionalProfile({
            is_profile_completed: true
          }).then(() => {
            console.log('AuthChecker: Profile marked as completed - popup will only show once');
          }).catch((error) => {
            console.error('AuthChecker: Error marking profile as completed:', error);
          });
        } else {
          console.log('AuthChecker: Profile already completed, skipping popup');
        }
      } else {
        // If API call fails or no data, show popup and mark as shown
        console.log('AuthChecker: No profile data found, showing setup popup');
        // Show popup immediately
        setShowProfileSetup(true);
        // Mark as completed in background (non-blocking)
        api.updateProfessionalProfile({
          is_profile_completed: true
        }).then(() => {
          console.log('AuthChecker: Profile marked as completed - popup will only show once');
        }).catch((error) => {
          console.error('AuthChecker: Error marking profile as completed:', error);
        });
      }
    } catch (error) {
      console.error('AuthChecker: Error checking profile completion:', error);
      // On error, show popup and mark as shown
      console.log('AuthChecker: Error fetching profile, showing setup popup');
      // Show popup immediately
      setShowProfileSetup(true);
      // Mark as completed in background (non-blocking)
      api.updateProfessionalProfile({
        is_profile_completed: true
      }).then(() => {
        console.log('AuthChecker: Profile marked as completed - popup will only show once');
      }).catch((markError) => {
        console.error('AuthChecker: Error marking profile as completed:', markError);
      });
    }
  };

  const handleProfileSetupComplete = () => {
    setShowProfileSetup(false);
    // Profile is already marked as completed when popup was shown
    // Refresh user data if needed
    window.dispatchEvent(new CustomEvent('userInfoUpdated'));
  };

  // Show loading spinner only while checking authentication (not profile check)
  // Profile check happens in background so dashboard loads immediately
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1AA49B] mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Render children if authenticated or on public routes
  return (
    <>
      {children}
      {showProfileSetup && (
        <ProfileSetupPopup
          isOpen={showProfileSetup}
          onClose={() => {
            setShowProfileSetup(false);
            // Profile is already marked as completed when popup was shown
          }}
          onComplete={handleProfileSetupComplete}
        />
      )}
    </>
  );
};

export default AuthChecker;