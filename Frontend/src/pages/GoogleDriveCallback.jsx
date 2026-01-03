import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import googleDriveApi from '../services/googleDriveApi';

const GoogleDriveCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('processing');
  const [error, setError] = useState(null);

  useEffect(() => {
    const handleCallback = async () => {
      const success = searchParams.get('success');
      const errorParam = searchParams.get('error');
      const code = searchParams.get('code');
      const state = searchParams.get('state');

      // Check for success parameter first (backend already processed the OAuth)
      if (success === 'true') {
        setStatus('success');
        toast.success('Google Drive connected successfully!');

        // If opened as popup, send success message to parent window
        if (window.opener) {
          window.opener.postMessage({
            type: 'GOOGLE_DRIVE_AUTH_SUCCESS'
          }, window.location.origin);
          
          // Close popup after short delay
          setTimeout(() => window.close(), 1500);
        } else {
          // If not a popup, redirect to dashboard or previous page
          setTimeout(() => {
            navigate('/dashboard', { replace: true });
          }, 1500);
        }
        return;
      }

      // Check for error parameter
      if (errorParam) {
        setStatus('error');
        setError(`Authorization failed: ${errorParam}`);
        
        // If opened as popup, send message to parent
        if (window.opener) {
          window.opener.postMessage({
            type: 'GOOGLE_DRIVE_AUTH_ERROR',
            error: errorParam
          }, window.location.origin);
          setTimeout(() => window.close(), 2000);
        }
        return;
      }

      // Legacy flow: if code and state are present, use POST API to complete OAuth
      // This is for cases where frontend handles the callback directly
      if (code && state) {
      try {
          // Complete the OAuth flow via POST API
        const result = await googleDriveApi.handleCallback(code, state);
        
        setStatus('success');
        toast.success('Google Drive connected successfully!');

        // If opened as popup, send success message to parent window
        if (window.opener) {
          window.opener.postMessage({
            type: 'GOOGLE_DRIVE_AUTH_SUCCESS',
            code,
            state
          }, window.location.origin);
          
          // Close popup after short delay
          setTimeout(() => window.close(), 1500);
        } else {
          // If not a popup, redirect to dashboard or previous page
          setTimeout(() => {
            navigate('/dashboard', { replace: true });
          }, 1500);
        }
      } catch (err) {
        console.error('[GoogleDriveCallback] Error:', err);
        setStatus('error');
        setError(err.response?.data?.error || err.message || 'Failed to connect Google Drive');
        
        if (window.opener) {
          window.opener.postMessage({
            type: 'GOOGLE_DRIVE_AUTH_ERROR',
            error: err.message
          }, window.location.origin);
        }
      }
        return;
      }

      // No success, no error, no code - invalid request
      setStatus('error');
      setError('Invalid callback request. Please try connecting again.');
    };

    handleCallback();
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="bg-gray-800 p-8 rounded-lg shadow-xl max-w-md w-full mx-4 text-center">
        {status === 'processing' && (
          <>
            <div className="mb-4">
              <svg className="animate-spin h-12 w-12 mx-auto text-blue-500" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">Connecting Google Drive</h2>
            <p className="text-gray-400">Please wait while we complete the authorization...</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="mb-4">
              <svg className="h-12 w-12 mx-auto text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">Google Drive Connected!</h2>
            <p className="text-gray-400">
              {window.opener 
                ? 'This window will close automatically...' 
                : 'Redirecting to dashboard...'}
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="mb-4">
              <svg className="h-12 w-12 mx-auto text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">Connection Failed</h2>
            <p className="text-red-400 mb-4">{error}</p>
            <button
              onClick={() => window.opener ? window.close() : navigate('/dashboard')}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
            >
              {window.opener ? 'Close' : 'Go to Dashboard'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default GoogleDriveCallback;



