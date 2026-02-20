import axios from 'axios';
import { GATEWAY_BASE_URL, DOCS_BASE_URL } from '../config/apiConfig';

// Google Drive auth routes go through gateway /auth which rewrites to /api/auth
const GOOGLE_DRIVE_AUTH_URL = `${GATEWAY_BASE_URL}/auth/google/drive`;

const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const googleDriveApi = {
  /**
   * Initiate Google Drive OAuth flow
   * Returns the authorization URL to redirect user to
   * @param {string} [returnTo] - Path to redirect after success (e.g. /template-drafting/drafts/123/preview)
   */
  initiateAuth: async (returnTo) => {
    const params = returnTo && returnTo.startsWith('/') ? { returnTo } : {};
    const response = await axios.get(
      GOOGLE_DRIVE_AUTH_URL,
      { headers: getAuthHeader(), params }
    );
    return response.data;
  },

  /**
   * Complete OAuth callback with authorization code
   */
  handleCallback: async (code, state) => {
    const response = await axios.post(
      `${GOOGLE_DRIVE_AUTH_URL}/callback`,
      { code, state },
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  /**
   * Check if user has Google Drive connected
   */
  getConnectionStatus: async () => {
    try {
      const response = await axios.get(
        `${GOOGLE_DRIVE_AUTH_URL}/status`,
        { headers: getAuthHeader() }
      );
      return response.data;
    } catch (error) {
      console.error('[GoogleDrive] Status check error:', error);
      return { connected: false };
    }
  },

  /**
   * Get fresh access token for Google Picker
   */
  getAccessToken: async () => {
    const response = await axios.get(
      `${GOOGLE_DRIVE_AUTH_URL}/token`,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  /**
   * Disconnect Google Drive
   */
  disconnect: async () => {
    const response = await axios.delete(
      GOOGLE_DRIVE_AUTH_URL,
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  /**
   * Download file from Google Drive to server storage
   * @param {string} fileId - Google Drive file ID
   * @param {string} accessToken - Google OAuth access token from Picker
   * @param {string} folderName - Optional folder name
   */
  downloadFile: async (fileId, accessToken, folderName = null) => {
    const response = await axios.post(
      `${DOCS_BASE_URL}/google-drive/download`,
      { fileId, accessToken, folderName },
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  /**
   * Download multiple files from Google Drive
   * @param {Array} files - Array of {id, name} objects
   * @param {string} accessToken - Google OAuth access token from Picker
   * @param {string} folderName - Optional folder name
   */
  downloadMultipleFiles: async (files, accessToken, folderName = null) => {
    const response = await axios.post(
      `${DOCS_BASE_URL}/google-drive/download-multiple`,
      { files, accessToken, folderName },
      { headers: getAuthHeader() }
    );
    return response.data;
  },

  /**
   * Get file info from Google Drive
   */
  getFileInfo: async (fileId) => {
    const response = await axios.get(
      `${DOCS_BASE_URL}/google-drive/info/${fileId}`,
      { headers: getAuthHeader() }
    );
    return response.data;
  }
};

export default googleDriveApi;

/**
 * Google Picker helper functions
 */

// Load Google Picker API script
export const loadGooglePickerApi = () => {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.picker) {
      resolve(window.google.picker);
      return;
    }

    // Check if script is already loading
    if (document.querySelector('script[src*="apis.google.com/js/api.js"]')) {
      // Wait for it to load
      const checkLoaded = setInterval(() => {
        if (window.gapi) {
          clearInterval(checkLoaded);
          window.gapi.load('picker', {
            callback: () => resolve(window.google.picker),
            onerror: reject
          });
        }
      }, 100);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.defer = true;
    
    script.onload = () => {
      window.gapi.load('picker', {
        callback: () => resolve(window.google.picker),
        onerror: reject
      });
    };
    
    script.onerror = reject;
    document.body.appendChild(script);
  });
};

// Create and show Google Picker with full Google Drive UI (like native Drive picker)
export const openGooglePicker = async ({
  accessToken,
  apiKey,
  onSelect,
  onCancel,
  multiselect = true
}) => {
  await loadGooglePickerApi();

  // Remove any blur from background when picker opens
  const removeBlur = () => {
    // Remove blur from Google's picker overlay
    const style = document.createElement('style');
    style.id = 'google-picker-no-blur';
    style.textContent = `
      .picker-dialog-bg {
        background: rgba(0, 0, 0, 0.5) !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }
      .picker-dialog {
        box-shadow: 0 24px 38px 3px rgba(0,0,0,0.14), 0 9px 46px 8px rgba(0,0,0,0.12), 0 11px 15px -7px rgba(0,0,0,0.2) !important;
      }
    `;
    if (!document.getElementById('google-picker-no-blur')) {
      document.head.appendChild(style);
    }
  };
  removeBlur();

  // Create "Recent" view - shows recently accessed files with GRID layout (thumbnails)
  const recentView = new window.google.picker.DocsView(window.google.picker.ViewId.RECENTLY_PICKED)
    .setIncludeFolders(false)
    .setSelectFolderEnabled(false)
    .setMode(window.google.picker.DocsViewMode.GRID)
    .setLabel('Recent');

  // Create "My Drive" view - browse all files in user's drive
  const myDriveView = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
    .setIncludeFolders(true)
    .setSelectFolderEnabled(false)
    .setMode(window.google.picker.DocsViewMode.GRID)
    .setParent('root')
    .setLabel('My Drive');

  // Create "Shared with me" view
  const sharedWithMeView = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
    .setIncludeFolders(true)
    .setSelectFolderEnabled(false)
    .setMode(window.google.picker.DocsViewMode.GRID)
    .setOwnedByMe(false)
    .setLabel('Shared with me');

  // Create "Starred" view
  const starredView = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
    .setIncludeFolders(false)
    .setSelectFolderEnabled(false)
    .setMode(window.google.picker.DocsViewMode.GRID)
    .setStarred(true)
    .setLabel('Starred');

  const pickerBuilder = new window.google.picker.PickerBuilder()
    .addView(recentView)
    .addView(myDriveView)
    .addView(sharedWithMeView)
    .addView(starredView)
    .setOAuthToken(accessToken)
    .setDeveloperKey(apiKey)
    .setCallback((data) => {
      if (data.action === window.google.picker.Action.PICKED) {
        const files = data.docs.map(doc => ({
          id: doc.id,
          name: doc.name,
          mimeType: doc.mimeType,
          url: doc.url,
          iconUrl: doc.iconUrl,
          sizeBytes: doc.sizeBytes
        }));
        onSelect(files);
      } else if (data.action === window.google.picker.Action.CANCEL) {
        if (onCancel) onCancel();
      }
    })
    .setTitle('Select files')
    .setSize(1051, 650)
    .setOrigin(window.location.protocol + '//' + window.location.host);

  // Enable multiselect if requested
  if (multiselect) {
    pickerBuilder.enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED);
  }
  
  // Enable shared drives support
  pickerBuilder.enableFeature(window.google.picker.Feature.SUPPORT_DRIVES);

  const picker = pickerBuilder.build();
  picker.setVisible(true);
};