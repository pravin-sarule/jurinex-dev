// // hooks/useAutoSave.js
// import { useEffect, useRef, useCallback, useState } from 'react';

// const API_BASE_URL = "http://localhost:5002/api/content";

// // Function to decode JWT token without verification (client-side)
// const decodeJWTToken = (token) => {
//   try {
//     if (!token) {
//       console.log('❌ No token provided');
//       return null;
//     }

//     // JWT tokens have 3 parts separated by dots
//     const parts = token.split('.');
//     if (parts.length !== 3) {
//       console.log('❌ Invalid JWT token format');
//       return null;
//     }

//     // Decode the payload (middle part)
//     const payload = parts[1];
    
//     // Add padding if needed for base64 decoding
//     const paddedPayload = payload + '='.repeat((4 - payload.length % 4) % 4);
    
//     // Decode base64
//     const decodedPayload = atob(paddedPayload);
    
//     // Parse JSON
//     const parsedPayload = JSON.parse(decodedPayload);
    
//     console.log('✅ JWT token decoded successfully:', parsedPayload);
//     return parsedPayload;
//   } catch (error) {
//     console.error('❌ Error decoding JWT token:', error);
//     return null;
//   }
// };

// // Get user ID from JWT token stored in localStorage
// const getUserIdFromToken = () => {
//   try {
//     // Get token from localStorage
//     const token = localStorage.getItem('token');
    
//     if (!token) {
//       console.log('❌ No token found in localStorage');
//       return null;
//     }

//     console.log('🔍 Found token in localStorage');
    
//     // Decode the token
//     const decodedToken = decodeJWTToken(token);
    
//     if (!decodedToken) {
//       console.log('❌ Failed to decode token');
//       return null;
//     }

//     // Try to extract user ID from common JWT payload fields
//     // Adjust these field names based on your JWT structure
//     const userId = decodedToken.id || 
//                   decodedToken.userId || 
//                   decodedToken.user_id || 
//                   decodedToken.sub ||
//                   (decodedToken.user && decodedToken.user.id);

//     if (!userId) {
//       console.log('❌ No user ID found in token payload:', decodedToken);
//       return null;
//     }

//     // Convert to integer if it's a string
//     const userIdInt = typeof userId === 'string' ? parseInt(userId, 10) : userId;
    
//     if (isNaN(userIdInt) || userIdInt <= 0) {
//       console.log('❌ Invalid user ID in token:', userId);
//       return null;
//     }

//     console.log('✅ User ID extracted from token:', userIdInt);
//     return userIdInt;

//   } catch (error) {
//     console.error('❌ Error extracting user ID from token:', error);
//     return null;
//   }
// };

// // Function to check if token is expired
// const isTokenExpired = (token) => {
//   try {
//     const decodedToken = decodeJWTToken(token);
//     if (!decodedToken || !decodedToken.exp) {
//       return true; // Consider expired if we can't decode or no expiration
//     }

//     // JWT exp is in seconds, Date.now() is in milliseconds
//     const currentTime = Math.floor(Date.now() / 1000);
//     const isExpired = decodedToken.exp < currentTime;
    
//     console.log('🕒 Token expiration check:', {
//       exp: decodedToken.exp,
//       currentTime,
//       isExpired
//     });
    
//     return isExpired;
//   } catch (error) {
//     console.error('❌ Error checking token expiration:', error);
//     return true;
//   }
// };

// export const useAutoSave = (caseData, currentStep, userId = null, isEnabled = true) => {
//   const timeoutRef = useRef(null);
//   const lastSavedDataRef = useRef(null);
//   const isInitialLoad = useRef(true);
//   const [saveStatus, setSaveStatus] = useState('idle');
//   const [lastSaveTime, setLastSaveTime] = useState(null);
//   const [tokenError, setTokenError] = useState(null);
  
//   // Get user ID from JWT token or use provided userId
//   const actualUserId = userId || getUserIdFromToken();

//   // Validate token and user ID
//   useEffect(() => {
//     const token = localStorage.getItem('token');
    
//     if (!token) {
//       setTokenError('No authentication token found');
//       console.log('❌ No token in localStorage');
//       return;
//     }

//     if (isTokenExpired(token)) {
//       setTokenError('Authentication token has expired');
//       console.log('❌ Token has expired');
//       return;
//     }

//     if (!actualUserId || isNaN(actualUserId) || actualUserId <= 0) {
//       setTokenError('Invalid user ID in token');
//       console.error('❌ Invalid user ID:', actualUserId);
//       return;
//     }

//     // Clear any previous errors
//     setTokenError(null);
    
//     console.log('🔧 Auto-save hook initialized:', {
//       providedUserId: userId,
//       actualUserId,
//       isEnabled,
//       currentStep,
//       hasData: Object.values(caseData).some(val => val && val !== '')
//     });
//   }, [userId, actualUserId, isEnabled, currentStep, caseData]);

//   // Function to check if data has changed
//   const hasDataChanged = useCallback((newData, oldData) => {
//     const changed = JSON.stringify(newData) !== JSON.stringify(oldData);
//     console.log('📊 Data changed check:', { changed });
//     return changed;
//   }, []);

//   // Check if there's meaningful data to save
//   const hasMeaningfulData = useCallback((data) => {
//     const hasData = Object.entries(data).some(([key, val]) => {
//       if (typeof val === 'string') {
//         const meaningful = val.trim() !== '';
//         if (meaningful) console.log(`📝 Found meaningful data in ${key}:`, val);
//         return meaningful;
//       }
//       if (Array.isArray(val)) {
//         return val.length > 0 && val.some(item => {
//           if (typeof item === 'object' && item !== null) {
//             return Object.values(item).some(v => v && typeof v === 'string' && v.trim() !== '');
//           }
//           return item && typeof item === 'string' && item.trim() !== '';
//         });
//       }
//       return val !== null && val !== undefined && val !== '';
//     });
    
//     console.log('💾 Has meaningful data:', hasData);
//     return hasData;
//   }, []);

//   // Save draft function with detailed logging
//   const saveDraft = useCallback(async (userIdInt, draftData, lastStep) => {
//     console.log('🚀 Attempting to save draft:', { userIdInt, lastStep, draftData });
    
//     // Validate user ID
//     if (isNaN(userIdInt) || userIdInt <= 0) {
//       throw new Error('Invalid user ID - must be a positive integer');
//     }

//     // Check if token is still valid before making API call
//     const token = localStorage.getItem('token');
//     if (!token || isTokenExpired(token)) {
//       throw new Error('Authentication token is missing or expired');
//     }
    
//     try {
//       const payload = {
//         userId: userIdInt,
//         draftData: JSON.stringify(draftData),
//         lastStep,
//       };
      
//       console.log('📤 Sending payload with user ID:', payload);
      
//       const response = await fetch(`${API_BASE_URL}/case-draft/save`, {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//           'Authorization': `Bearer ${token}`, // Include token in request
//         },
//         body: JSON.stringify(payload),
//       });

//       console.log('📥 Response status:', response.status);
      
//       // Handle token expiration
//       if (response.status === 401) {
//         setTokenError('Authentication token has expired');
//         throw new Error('Authentication token has expired');
//       }
      
//       if (!response.ok) {
//         const errorText = await response.text();
//         console.error('❌ Save failed:', errorText);
//         throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
//       }

//       const result = await response.json();
//       console.log('✅ Save successful:', result);
//       return result;
//     } catch (error) {
//       console.error('💥 Save error:', error);
//       throw error;
//     }
//   }, []);

//   // Get draft function
//   const getDraft = useCallback(async (userIdInt) => {
//     console.log('🔍 Loading draft for user ID:', userIdInt);
    
//     // Validate user ID
//     if (isNaN(userIdInt) || userIdInt <= 0) {
//       throw new Error('Invalid user ID - must be a positive integer');
//     }

//     // Check if token is still valid before making API call
//     const token = localStorage.getItem('token');
//     if (!token || isTokenExpired(token)) {
//       throw new Error('Authentication token is missing or expired');
//     }
    
//     try {
//       const response = await fetch(`${API_BASE_URL}/case-draft/${userIdInt}`, {
//         method: 'GET',
//         headers: {
//           'Content-Type': 'application/json',
//           'Authorization': `Bearer ${token}`, // Include token in request
//         },
//       });

//       console.log('📥 Load response status:', response.status);

//       // Handle token expiration
//       if (response.status === 401) {
//         setTokenError('Authentication token has expired');
//         throw new Error('Authentication token has expired');
//       }

//       if (response.status === 404) {
//         console.log('📭 No draft found');
//         return null;
//       }

//       if (!response.ok) {
//         const errorText = await response.text();
//         throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
//       }

//       const result = await response.json();
//       console.log('📄 Draft loaded:', result);
      
//       return {
//         ...result,
//         draft_data: typeof result.draft_data === 'string' 
//           ? JSON.parse(result.draft_data) 
//           : result.draft_data
//       };
//     } catch (error) {
//       console.error('💥 Load error:', error);
//       throw error;
//     }
//   }, []);

//   // Delete draft function
//   const deleteDraftAPI = useCallback(async (userIdInt) => {
//     console.log('🗑️ Deleting draft for user ID:', userIdInt);
    
//     // Validate user ID
//     if (isNaN(userIdInt) || userIdInt <= 0) {
//       throw new Error('Invalid user ID - must be a positive integer');
//     }

//     // Check if token is still valid before making API call
//     const token = localStorage.getItem('token');
//     if (!token || isTokenExpired(token)) {
//       throw new Error('Authentication token is missing or expired');
//     }
    
//     try {
//       const response = await fetch(`${API_BASE_URL}/case-draft/${userIdInt}`, {
//         method: 'DELETE',
//         headers: {
//           'Content-Type': 'application/json',
//           'Authorization': `Bearer ${token}`, // Include token in request
//         },
//       });

//       console.log('📥 Delete response status:', response.status);

//       // Handle token expiration
//       if (response.status === 401) {
//         setTokenError('Authentication token has expired');
//         throw new Error('Authentication token has expired');
//       }

//       if (response.status === 404) {
//         console.log('📭 No draft found to delete');
//         return { message: 'No draft found to delete' };
//       }

//       if (!response.ok) {
//         const errorText = await response.text();
//         throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
//       }

//       const result = await response.json();
//       console.log('✅ Draft deleted:', result);
//       return result;
//     } catch (error) {
//       console.error('💥 Delete error:', error);
//       throw error;
//     }
//   }, []);

//   // Auto-save function with comprehensive logging
//   const autoSave = useCallback(async () => {
//     console.log('⚡ Auto-save triggered:', {
//       isEnabled,
//       actualUserId,
//       isInitialLoad: isInitialLoad.current,
//       currentStep,
//       tokenError
//     });

//     if (!isEnabled) {
//       console.log('⏹️ Auto-save disabled');
//       return;
//     }
    
//     if (tokenError) {
//       console.log('⏹️ Token error:', tokenError);
//       return;
//     }
    
//     if (!actualUserId || isNaN(actualUserId) || actualUserId <= 0) {
//       console.log('⏹️ Invalid user ID:', actualUserId);
//       return;
//     }

//     // Skip initial load
//     if (isInitialLoad.current) {
//       console.log('⏭️ Skipping initial load');
//       isInitialLoad.current = false;
//       lastSavedDataRef.current = { ...caseData };
//       return;
//     }

//     // Check if data has changed
//     if (!hasDataChanged(caseData, lastSavedDataRef.current)) {
//       console.log('⏭️ No data changes detected');
//       return;
//     }

//     // Check if there's meaningful data
//     if (!hasMeaningfulData(caseData)) {
//       console.log('⏭️ No meaningful data to save');
//       return;
//     }

//     console.log('💾 Starting save process...');
//     setSaveStatus('saving');
    
//     try {
//       const result = await saveDraft(actualUserId, caseData, currentStep);
//       lastSavedDataRef.current = { ...caseData };
//       setSaveStatus('saved');
//       setLastSaveTime(new Date());
      
//       console.log('✅ Auto-save completed successfully');
      
//       // Reset to idle after 3 seconds
//       setTimeout(() => {
//         console.log('🔄 Resetting save status to idle');
//         setSaveStatus('idle');
//       }, 3000);
      
//     } catch (error) {
//       console.error('❌ Auto-save failed:', error);
//       setSaveStatus('error');
      
//       // If it's a token error, set the token error state
//       if (error.message.includes('token') || error.message.includes('Authentication')) {
//         setTokenError(error.message);
//       }
      
//       // Reset to idle after 5 seconds
//       setTimeout(() => {
//         console.log('🔄 Resetting error status to idle');
//         setSaveStatus('idle');
//       }, 5000);
//     }
//   }, [caseData, currentStep, actualUserId, isEnabled, hasDataChanged, hasMeaningfulData, saveDraft, tokenError]);

//   // Debounced auto-save effect
//   useEffect(() => {
//     if (!isEnabled || !actualUserId || isNaN(actualUserId) || actualUserId <= 0 || tokenError) {
//       console.log('⏹️ Auto-save effect skipped:', { isEnabled, actualUserId, tokenError });
//       return;
//     }

//     if (timeoutRef.current) {
//       clearTimeout(timeoutRef.current);
//       console.log('⏰ Cleared previous timeout');
//     }

//     console.log('⏰ Setting auto-save timeout (2 seconds)');
//     timeoutRef.current = setTimeout(() => {
//       console.log('⏰ Auto-save timeout triggered');
//       autoSave();
//     }, 2000);

//     return () => {
//       if (timeoutRef.current) {
//         clearTimeout(timeoutRef.current);
//         console.log('🧹 Cleanup: timeout cleared');
//       }
//     };
//   }, [caseData, autoSave, isEnabled, actualUserId, tokenError]);

//   // Manual save function
//   const manualSave = useCallback(async () => {
//     console.log('👆 Manual save triggered');
    
//     if (tokenError) {
//       console.log('❌ Manual save failed: Token error -', tokenError);
//       return { success: false, error: tokenError };
//     }
    
//     if (!actualUserId || isNaN(actualUserId) || actualUserId <= 0) {
//       console.log('❌ Manual save failed: Invalid user ID');
//       return { success: false, error: 'Invalid user ID' };
//     }
    
//     setSaveStatus('saving');
//     try {
//       const result = await saveDraft(actualUserId, caseData, currentStep);
//       lastSavedDataRef.current = { ...caseData };
//       setSaveStatus('saved');
//       setLastSaveTime(new Date());
      
//       setTimeout(() => setSaveStatus('idle'), 3000);
//       console.log('✅ Manual save successful');
//       return { success: true, result };
//     } catch (error) {
//       setSaveStatus('error');
      
//       // If it's a token error, set the token error state
//       if (error.message.includes('token') || error.message.includes('Authentication')) {
//         setTokenError(error.message);
//       }
      
//       setTimeout(() => setSaveStatus('idle'), 5000);
//       console.error('❌ Manual save failed:', error);
//       return { success: false, error };
//     }
//   }, [caseData, currentStep, actualUserId, saveDraft, tokenError]);

//   // Load draft function
//   const loadDraft = useCallback(async () => {
//     if (tokenError) {
//       console.log('⏹️ Load draft skipped: Token error -', tokenError);
//       return null;
//     }
    
//     if (!actualUserId || isNaN(actualUserId) || actualUserId <= 0) {
//       console.log('⏹️ Load draft skipped: Invalid user ID');
//       return null;
//     }

//     try {
//       const draft = await getDraft(actualUserId);
//       if (draft) {
//         lastSavedDataRef.current = draft.draft_data;
//         console.log('✅ Draft loaded and cached');
//       }
//       return draft;
//     } catch (error) {
//       console.error('❌ Error loading draft:', error);
      
//       // If it's a token error, set the token error state
//       if (error.message.includes('token') || error.message.includes('Authentication')) {
//         setTokenError(error.message);
//       }
      
//       return null;
//     }
//   }, [actualUserId, getDraft, tokenError]);

//   // Delete draft function
//   const deleteDraft = useCallback(async () => {
//     if (tokenError) {
//       console.log('⏹️ Delete draft skipped: Token error -', tokenError);
//       return { success: false, error: tokenError };
//     }
    
//     if (!actualUserId || isNaN(actualUserId) || actualUserId <= 0) {
//       console.log('⏹️ Delete draft skipped: Invalid user ID');
//       return { success: false, error: 'Invalid user ID' };
//     }

//     try {
//       const result = await deleteDraftAPI(actualUserId);
//       lastSavedDataRef.current = null;
//       console.log('✅ Draft deletion successful');
//       return { success: true, result };
//     } catch (error) {
//       console.error('❌ Error deleting draft:', error);
      
//       // If it's a token error, set the token error state
//       if (error.message.includes('token') || error.message.includes('Authentication')) {
//         setTokenError(error.message);
//       }
      
//       return { success: false, error };
//     }
//   }, [actualUserId, deleteDraftAPI, tokenError]);

//   return {
//     saveStatus,
//     lastSaveTime,
//     actualUserId, // Return the actual integer ID being used
//     tokenError, // Return token error state
//     manualSave,
//     loadDraft,
//     deleteDraft,
//   };
// };


// // hooks/useAutoSave.js
// import { useEffect, useRef, useCallback, useState } from 'react';

// const API_BASE_URL = "http://localhost:5002/api/content";

// // Decode JWT token (client-side only)
// const decodeJWTToken = (token) => {
//   try {
//     if (!token) return null;
//     const parts = token.split('.');
//     if (parts.length !== 3) return null;

//     const payload = parts[1];
//     const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
//     const decoded = atob(padded);
//     return JSON.parse(decoded);
//   } catch (error) {
//     console.error('Error decoding JWT:', error);
//     return null;
//   }
// };

// // Extract user ID from JWT
// const getUserIdFromToken = () => {
//   try {
//     const token = localStorage.getItem('token') || 
//                   localStorage.getItem('authToken') || 
//                   localStorage.getItem('access_token') || 
//                   localStorage.getItem('jwt');

//     if (!token) return null;

//     const decoded = decodeJWTToken(token);
//     if (!decoded) return null;

//     const userId = decoded.id || 
//                    decoded.userId || 
//                    decoded.user_id || 
//                    decoded.sub || 
//                    (decoded.user && decoded.user.id);

//     const userIdInt = parseInt(userId, 10);
//     return isNaN(userIdInt) || userIdInt <= 0 ? null : userIdInt;
//   } catch (error) {
//     console.error('Error extracting user ID from token:', error);
//     return null;
//   }
// };

// // Check if token is expired
// const isTokenExpired = (token) => {
//   try {
//     const decoded = decodeJWTToken(token);
//     if (!decoded || !decoded.exp) return true;
//     return decoded.exp < Math.floor(Date.now() / 1000);
//   } catch {
//     return true;
//   }
// };

// export const useAutoSave = (caseData, currentStep, providedUserId = null, isEnabled = true) => {
//   const timeoutRef = useRef(null);
//   const lastSavedDataRef = useRef(null);
//   const isInitialMount = useRef(true);

//   const [saveStatus, setSaveStatus] = useState('idle'); // idle, saving, saved, error
//   const [lastSaveTime, setLastSaveTime] = useState(null);
//   const [tokenError, setTokenError] = useState(null);

//   // Final user ID: use provided one, fallback to token
//   const actualUserId = providedUserId || getUserIdFromToken();

//   // Validate token & user ID on mount/change
//   useEffect(() => {
//     const token = localStorage.getItem('token') || 
//                   localStorage.getItem('authToken') || 
//                   localStorage.getItem('access_token') || 
//                   localStorage.getItem('jwt');

//     if (!token) {
//       setTokenError('No authentication token found. Please log in.');
//       return;
//     }

//     if (isTokenExpired(token)) {
//       setTokenError('Your session has expired. Please log in again.');
//       return;
//     }

//     if (!actualUserId || !Number.isInteger(actualUserId) || actualUserId <= 0) {
//       setTokenError('Invalid user ID. Unable to save draft.');
//       return;
//     }

//     setTokenError(null); // All good
//   }, [actualUserId]);

//   // Check if data actually changed
//   const hasDataChanged = useCallback((newData, oldData) => {
//     return JSON.stringify(newData) !== JSON.stringify(oldData);
//   }, []);

//   // Check if there's meaningful data (not just empty strings/arrays)
//   const hasMeaningfulData = useCallback((data) => {
//     return Object.values(data).some(value => {
//       if (value === null || value === undefined) return false;
//       if (typeof value === 'string') return value.trim() !== '';
//       if (Array.isArray(value)) return value.length > 0;
//       if (typeof value === 'object') return Object.values(value).some(v => v && v.toString().trim() !== '');
//       return true;
//     });
//   }, []);

//   // Save draft to backend
//   const saveDraft = useCallback(async (userId, data, step) => {
//     const token = localStorage.getItem('token') || 
//                   localStorage.getItem('authToken') || 
//                   localStorage.getItem('access_token') || 
//                   localStorage.getItem('jwt');

//     if (!token || isTokenExpired(token)) {
//       throw new Error('Authentication token expired');
//     }

//     const response = await fetch(`${API_BASE_URL}/case-draft/save`, {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json',
//         'Authorization': `Bearer ${token}`,
//       },
//       body: JSON.stringify({
//         userId,
//         draftData: JSON.stringify(data),
//         lastStep: step,
//       }),
//     });

//     if (response.status === 401) {
//       throw new Error('Authentication token expired');
//     }

//     if (!response.ok) {
//       const text = await response.text();
//       throw new Error(`Save failed: ${response.status} ${text}`);
//     }

//     return await response.json();
//   }, []);

//   // Load draft from backend
//   const loadDraft = useCallback(async () => {
//     if (!actualUserId || tokenError) return null;

//     const token = localStorage.getItem('token') || 
//                   localStorage.getItem('authToken') || 
//                   localStorage.getItem('access_token') || 
//                   localStorage.getItem('jwt');

//     if (!token || isTokenExpired(token)) return null;

//     try {
//       const response = await fetch(`${API_BASE_URL}/case-draft/${actualUserId}`, {
//         headers: {
//           'Authorization': `Bearer ${token}`,
//         },
//       });

//       if (response.status === 404) return null;
//       if (!response.ok) throw new Error('Failed to load draft');

//       const result = await response.json();
//       return {
//         ...result,
//         draft_data: typeof result.draft_data === 'string'
//           ? JSON.parse(result.draft_data)
//           : result.draft_data,
//       };
//     } catch (error) {
//       console.error('Load draft error:', error);
//       return null;
//     }
//   }, [actualUserId, tokenError]);

//   // Delete draft from backend
//   const deleteDraft = useCallback(async () => {
//     if (!actualUserId || tokenError) {
//       console.log('Cannot delete draft: invalid user ID or token');
//       return { success: false, error: 'Invalid session' };
//     }

//     const token = localStorage.getItem('token') || 
//                   localStorage.getItem('authToken') || 
//                   localStorage.getItem('access_token') || 
//                   localStorage.getItem('jwt');

//     if (!token || isTokenExpired(token)) {
//       return { success: false, error: 'Token expired' };
//     }

//     try {
//       const response = await fetch(`${API_BASE_URL}/case-draft/${actualUserId}`, {
//         method: 'DELETE',
//         headers: {
//           'Authorization': `Bearer ${token}`,
//         },
//       });

//       if (response.status === 404) {
//         console.log('No draft to delete (already gone)');
//         return { success: true };
//       }

//       if (!response.ok) throw new Error('Delete failed');

//       console.log('Draft permanently deleted from database');
//       lastSavedDataRef.current = null;
//       return { success: true };
//     } catch (error) {
//       console.error('Delete draft error:', error);
//       return { success: false, error: error.message };
//     }
//   }, [actualUserId, tokenError]);

//   // Manual save (for testing or force save)
//   const manualSave = useCallback(async () => {
//     if (tokenError || !actualUserId) {
//       return { success: false, error: tokenError || 'Invalid user ID' };
//     }

//     setSaveStatus('saving');
//     try {
//       await saveDraft(actualUserId, caseData, currentStep);
//       lastSavedDataRef.current = { ...caseData };
//       setSaveStatus('saved');
//       setLastSaveTime(new Date());
//       setTimeout(() => setSaveStatus('idle'), 3000);
//       return { success: true };
//     } catch (error) {
//       setSaveStatus('error');
//       setTimeout(() => setSaveStatus('idle'), 5000);
//       return { success: false, error: error.message };
//     }
//   }, [actualUserId, caseData, currentStep, saveDraft, tokenError]);

//   // Auto-save effect (debounced)
//   useEffect(() => {
//     if (!isEnabled || tokenError || !actualUserId || !Number.isInteger(actualUserId)) {
//       return;
//     }

//     if (isInitialMount.current) {
//       isInitialMount.current = false;
//       lastSavedDataRef.current = { ...caseData };
//       return;
//     }

//     if (!hasDataChanged(caseData, lastSavedDataRef.current)) {
//       return;
//     }

//     if (!hasMeaningfulData(caseData)) {
//       return;
//     }

//     if (timeoutRef.current) clearTimeout(timeoutRef.current);

//     timeoutRef.current = setTimeout(() => {
//       (async () => {
//         setSaveStatus('saving');
//         try {
//           await saveDraft(actualUserId, caseData, currentStep);
//           lastSavedDataRef.current = { ...caseData };
//           setSaveStatus('saved');
//           setLastSaveTime(new Date());
//           setTimeout(() => setSaveStatus('idle'), 3000);
//         } catch (error) {
//           setSaveStatus('error');
//           setTimeout(() => setSaveStatus('idle'), 5000);
//         }
//       })();
//     }, 2000);

//     return () => {
//       if (timeoutRef.current) clearTimeout(timeoutRef.current);
//     };
//   }, [caseData, currentStep, actualUserId, isEnabled, hasDataChanged, hasMeaningfulData, saveDraft, tokenError]);

//   return {
//     saveStatus,
//     lastSaveTime,
//     actualUserId,
//     tokenError,
//     manualSave,
//     loadDraft,
//     deleteDraft, // This is now 100% reliable
//   };
// };


// hooks/useAutoSave.js
import { useEffect, useRef, useCallback, useState } from 'react';

const API_BASE_URL = "http://localhost:5002/api/content";

// Decode JWT token (client-side only)
const decodeJWTToken = (token) => {
  try {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payload = parts[1];
    const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
    const decoded = atob(padded);
    return JSON.parse(decoded);
  } catch (error) {
    console.error('Error decoding JWT:', error);
    return null;
  }
};

// Extract user ID from JWT
const getUserIdFromToken = () => {
  try {
    const token = localStorage.getItem('token') || 
                  localStorage.getItem('authToken') || 
                  localStorage.getItem('access_token') || 
                  localStorage.getItem('jwt');

    if (!token) return null;

    const decoded = decodeJWTToken(token);
    if (!decoded) return null;

    const userId = decoded.id || 
                   decoded.userId || 
                   decoded.user_id || 
                   decoded.sub || 
                   (decoded.user && decoded.user.id);

    const userIdInt = parseInt(userId, 10);
    return isNaN(userIdInt) || userIdInt <= 0 ? null : userIdInt;
  } catch (error) {
    console.error('Error extracting user ID from token:', error);
    return null;
  }
};

// Check if token is expired
const isTokenExpired = (token) => {
  try {
    const decoded = decodeJWTToken(token);
    if (!decoded || !decoded.exp) return true;
    return decoded.exp < Math.floor(Date.now() / 1000);
  } catch {
    return true;
  }
};

export const useAutoSave = (caseData, currentStep, providedUserId = null, isEnabled = true) => {
  const timeoutRef = useRef(null);
  const lastSavedDataRef = useRef(null);
  const isInitialMount = useRef(true);

  const [saveStatus, setSaveStatus] = useState('idle'); // idle, saving, saved, error
  const [lastSaveTime, setLastSaveTime] = useState(null);
  const [tokenError, setTokenError] = useState(null);

  // Final user ID: use provided one, fallback to token
  const actualUserId = providedUserId || getUserIdFromToken();

  // Validate token & user ID on mount/change
  useEffect(() => {
    const token = localStorage.getItem('token') || 
                  localStorage.getItem('authToken') || 
                  localStorage.getItem('access_token') || 
                  localStorage.getItem('jwt');

    if (!token) {
      setTokenError('No authentication token found. Please log in.');
      return;
    }

    if (isTokenExpired(token)) {
      setTokenError('Your session has expired. Please log in again.');
      return;
    }

    if (!actualUserId || !Number.isInteger(actualUserId) || actualUserId <= 0) {
      setTokenError('Invalid user ID. Unable to save draft.');
      return;
    }

    setTokenError(null); // All good
  }, [actualUserId]);

  // Check if data actually changed
  const hasDataChanged = useCallback((newData, oldData) => {
    return JSON.stringify(newData) !== JSON.stringify(oldData);
  }, []);

  // Check if there's meaningful data (not just empty strings/arrays or default values)
  const hasMeaningfulData = useCallback((data) => {
    // Default values that should NOT trigger auto-save
    const defaultValues = ['Medium', 'High Court', 'Delhi', 'Active'];
    
    // Fields that indicate actual user input (important fields)
    const userInputFields = ['caseTitle', 'caseNumber', 'caseType', 'subType', 'courtName', 'filingDate'];
    
    // Check if any important field has actual user data
    const hasImportantData = userInputFields.some(field => {
      const value = data[field];
      if (!value) return false;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        // Return true only if it's not empty AND not a default value
        return trimmed !== '' && !defaultValues.includes(trimmed);
      }
      return false;
    });
    
    // Also check if arrays have meaningful data (petitioners/respondents with actual names)
    const hasArrayData = ['petitioners', 'respondents'].some(field => {
      const arr = data[field];
      if (!Array.isArray(arr) || arr.length === 0) return false;
      return arr.some(item => {
        if (typeof item === 'object' && item !== null) {
          return Object.values(item).some(v => v && typeof v === 'string' && v.trim() !== '');
        }
        return false;
      });
    });
    
    return hasImportantData || hasArrayData;
  }, []);

  // Save draft to backend
  const saveDraft = useCallback(async (userId, data, step) => {
    const token = localStorage.getItem('token') || 
                  localStorage.getItem('authToken') || 
                  localStorage.getItem('access_token') || 
                  localStorage.getItem('jwt');

    if (!token || isTokenExpired(token)) {
      throw new Error('Authentication token expired');
    }

    const response = await fetch(`${API_BASE_URL}/case-draft/save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        userId,
        draftData: JSON.stringify(data),
        lastStep: step,
      }),
    });

    if (response.status === 401) {
      throw new Error('Authentication token expired');
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Save failed: ${response.status} ${text}`);
    }

    return await response.json();
  }, []);

  // Load draft from backend
  const loadDraft = useCallback(async () => {
    if (!actualUserId || tokenError) return null;

    const token = localStorage.getItem('token') || 
                  localStorage.getItem('authToken') || 
                  localStorage.getItem('access_token') || 
                  localStorage.getItem('jwt');

    if (!token || isTokenExpired(token)) return null;

    try {
      const response = await fetch(`${API_BASE_URL}/case-draft/${actualUserId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.status === 404) return null;
      if (!response.ok) throw new Error('Failed to load draft');

      const result = await response.json();
      return {
        ...result,
        draft_data: typeof result.draft_data === 'string'
          ? JSON.parse(result.draft_data)
          : result.draft_data,
      };
    } catch (error) {
      console.error('Load draft error:', error);
      return null;
    }
  }, [actualUserId, tokenError]);

  // Delete draft from backend
  const deleteDraft = useCallback(async () => {
    if (!actualUserId || tokenError) {
      console.log('Cannot delete draft: invalid user ID or token');
      return { success: false, error: 'Invalid session' };
    }

    const token = localStorage.getItem('token') || 
                  localStorage.getItem('authToken') || 
                  localStorage.getItem('access_token') || 
                  localStorage.getItem('jwt');

    if (!token || isTokenExpired(token)) {
      return { success: false, error: 'Token expired' };
    }

    try {
      const response = await fetch(`${API_BASE_URL}/case-draft/${actualUserId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.status === 404) {
        console.log('No draft to delete (already gone)');
        return { success: true };
      }

      if (!response.ok) throw new Error('Delete failed');

      console.log('Draft permanently deleted from database');
      lastSavedDataRef.current = null;
      return { success: true };
    } catch (error) {
      console.error('Delete draft error:', error);
      return { success: false, error: error.message };
    }
  }, [actualUserId, tokenError]);

  // Manual save (for testing or force save)
  const manualSave = useCallback(async () => {
    if (tokenError || !actualUserId) {
      return { success: false, error: tokenError || 'Invalid user ID' };
    }

    setSaveStatus('saving');
    try {
      await saveDraft(actualUserId, caseData, currentStep);
      lastSavedDataRef.current = { ...caseData };
      setSaveStatus('saved');
      setLastSaveTime(new Date());
      setTimeout(() => setSaveStatus('idle'), 3000);
      return { success: true };
    } catch (error) {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 5000);
      return { success: false, error: error.message };
    }
  }, [actualUserId, caseData, currentStep, saveDraft, tokenError]);

  // Auto-save effect (debounced)
  useEffect(() => {
    if (!isEnabled || tokenError || !actualUserId || !Number.isInteger(actualUserId)) {
      return;
    }

    if (isInitialMount.current) {
      console.log('⏭️ Skipping initial mount auto-save');
      isInitialMount.current = false;
      lastSavedDataRef.current = { ...caseData };
      return;
    }

    if (!hasDataChanged(caseData, lastSavedDataRef.current)) {
      console.log('⏭️ No data changes detected, skipping auto-save');
      return;
    }

    if (!hasMeaningfulData(caseData)) {
      console.log('⏭️ No meaningful data to save, skipping auto-save');
      return;
    }
    
    console.log('✅ Data changed and meaningful, triggering auto-save in 2s...');

    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    timeoutRef.current = setTimeout(() => {
      (async () => {
        setSaveStatus('saving');
        try {
          await saveDraft(actualUserId, caseData, currentStep);
          lastSavedDataRef.current = { ...caseData };
          setSaveStatus('saved');
          setLastSaveTime(new Date());
          setTimeout(() => setSaveStatus('idle'), 3000);
        } catch (error) {
          setSaveStatus('error');
          setTimeout(() => setSaveStatus('idle'), 5000);
        }
      })();
    }, 2000);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [caseData, currentStep, actualUserId, isEnabled, hasDataChanged, hasMeaningfulData, saveDraft, tokenError]);

  // Reset auto-save state when draft is loaded
  const resetAutoSave = useCallback((draftData) => {
    console.log('🔄 Resetting auto-save baseline with draft data');
    lastSavedDataRef.current = { ...draftData };
    isInitialMount.current = false;
  }, []);

  return {
    saveStatus,
    lastSaveTime,
    actualUserId,
    tokenError,
    manualSave,
    loadDraft,
    deleteDraft,
    resetAutoSave, // Reset baseline when draft is loaded
  };
};