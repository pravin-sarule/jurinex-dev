import { GATEWAY_BASE_URL } from '../config/apiConfig';
import { toast } from 'react-toastify';

// Draft Template Service URL through gateway
const DRAFT_TEMPLATE_SERVICE_URL = `${GATEWAY_BASE_URL}/api/drafts`;

const getAuthToken = () => {
  return localStorage.getItem('token') || 
         localStorage.getItem('authToken') || 
         localStorage.getItem('access_token') || 
         localStorage.getItem('jwt') ||
         localStorage.getItem('auth_token');
};

const getHeaders = () => {
  const token = getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  return headers;
};

/**
 * Create a new draft from template
 * @param {string} templateId - Template ID
 * @param {string} title - Optional draft title
 * @returns {Promise<Object>} Draft object
 */
export const createDraft = async (templateId, title = null) => {
  try {
    const response = await fetch(`${DRAFT_TEMPLATE_SERVICE_URL}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ templateId, title }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.success && data.draft) {
      return data.draft;
    }
    
    throw new Error('Invalid response format from server');
  } catch (error) {
    console.error('Error creating draft:', error);
    toast.error('Failed to create draft. Please try again.');
    throw error;
  }
};

/**
 * Get draft with current state (all blocks)
 * @param {string} draftId - Draft ID
 * @returns {Promise<Object>} Draft object with blocks and schema
 */
export const getDraft = async (draftId) => {
  try {
    const response = await fetch(`${DRAFT_TEMPLATE_SERVICE_URL}/${draftId}`, {
      method: 'GET',
      headers: getHeaders(),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.success && data.draft) {
      return data.draft;
    }
    
    throw new Error('Invalid response format from server');
  } catch (error) {
    console.error('Error fetching draft:', error);
    toast.error('Failed to load draft. Please try again.');
    throw error;
  }
};

/**
 * Update draft form fields (creates new version)
 * @param {string} draftId - Draft ID
 * @param {Object} fields - Object with field keys and values
 * @returns {Promise<Object>} Version info
 */
export const updateDraftFields = async (draftId, fields) => {
  try {
    const url = `${DRAFT_TEMPLATE_SERVICE_URL}/${draftId}/fields`;
    const headers = getHeaders();
    const body = JSON.stringify({ fields });
    
    console.log('[draftTemplateApi] updateDraftFields called:', {
      draftId,
      fields,
      url,
      headers: { ...headers, Authorization: headers.Authorization ? 'Bearer ***' : 'none' },
      body
    });

    const response = await fetch(url, {
      method: 'PUT',
      headers: headers,
      body: body,
    });

    console.log('[draftTemplateApi] Response status:', response.status, response.statusText);
    console.log('[draftTemplateApi] Response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[draftTemplateApi] Error response body:', errorText);
      
      let errorData = {};
      try {
        errorData = JSON.parse(errorText);
        console.error('[draftTemplateApi] Parsed error data:', errorData);
      } catch (e) {
        console.error('[draftTemplateApi] Failed to parse error as JSON:', e);
        errorData = { message: errorText };
      }
      
      const errorMessage = errorData.message || errorData.error || `HTTP error! status: ${response.status}`;
      console.error('[draftTemplateApi] Throwing error:', errorMessage);
      throw new Error(errorMessage);
    }

    const data = await response.json();
    console.log('[draftTemplateApi] Success response:', data);
    
    if (data.success) {
      return {
        versionId: data.versionId,
        versionNo: data.versionNo,
      };
    }
    
    throw new Error('Invalid response format from server');
  } catch (error) {
    console.error('[draftTemplateApi] Error updating draft fields:', error);
    console.error('[draftTemplateApi] Error stack:', error.stack);
    toast.error(`Failed to save fields: ${error.message || 'Unknown error'}`);
    throw error;
  }
};

/**
 * Update draft title
 * @param {string} draftId - Draft ID
 * @param {string} title - New title
 * @returns {Promise<Object>} Updated draft
 */
export const updateDraftTitle = async (draftId, title) => {
  try {
    const response = await fetch(`${DRAFT_TEMPLATE_SERVICE_URL}/${draftId}/title`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ title }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error updating draft title:', error);
    toast.error('Failed to update title. Please try again.');
    throw error;
  }
};

/**
 * Get version history for a draft
 * @param {string} draftId - Draft ID
 * @returns {Promise<Object>} Version history
 */
export const getDraftVersions = async (draftId) => {
  try {
    const response = await fetch(`${DRAFT_TEMPLATE_SERVICE_URL}/${draftId}/versions`, {
      method: 'GET',
      headers: getHeaders(),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.success) {
      return {
        draftId: data.draftId,
        currentVersionId: data.currentVersionId,
        versions: data.versions || [],
      };
    }
    
    throw new Error('Invalid response format from server');
  } catch (error) {
    console.error('Error fetching draft versions:', error);
    throw error;
  }
};

/**
 * Undo last action
 * @param {string} draftId - Draft ID
 * @returns {Promise<Object>} Version info
 */
export const undoDraft = async (draftId) => {
  try {
    const response = await fetch(`${DRAFT_TEMPLATE_SERVICE_URL}/${draftId}/undo`, {
      method: 'POST',
      headers: getHeaders(),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error undoing draft:', error);
    toast.error('Failed to undo. Please try again.');
    throw error;
  }
};

/**
 * Redo undone action
 * @param {string} draftId - Draft ID
 * @returns {Promise<Object>} Version info
 */
export const redoDraft = async (draftId) => {
  try {
    const response = await fetch(`${DRAFT_TEMPLATE_SERVICE_URL}/${draftId}/redo`, {
      method: 'POST',
      headers: getHeaders(),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error redoing draft:', error);
    toast.error('Failed to redo. Please try again.');
    throw error;
  }
};

/**
 * Restore to specific version
 * @param {string} draftId - Draft ID
 * @param {string} versionId - Version ID to restore
 * @returns {Promise<Object>} Version info
 */
export const restoreDraftVersion = async (draftId, versionId) => {
  try {
    const response = await fetch(`${DRAFT_TEMPLATE_SERVICE_URL}/${draftId}/versions/${versionId}/restore`, {
      method: 'POST',
      headers: getHeaders(),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error restoring draft version:', error);
    toast.error('Failed to restore version. Please try again.');
    throw error;
  }
};

/**
 * List all user's drafts
 * @returns {Promise<Array>} Array of draft objects
 */
export const listDrafts = async () => {
  try {
    const response = await fetch(`${DRAFT_TEMPLATE_SERVICE_URL}`, {
      method: 'GET',
      headers: getHeaders(),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.success && data.drafts) {
      return data.drafts;
    }
    
    return [];
  } catch (error) {
    console.error('Error fetching drafts:', error);
    throw error;
  }
};

/**
 * Delete a draft
 * @param {string} draftId - Draft ID
 * @returns {Promise<Object>} Success response
 */
export const deleteDraft = async (draftId) => {
  try {
    const response = await fetch(`${DRAFT_TEMPLATE_SERVICE_URL}/${draftId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error deleting draft:', error);
    toast.error('Failed to delete draft. Please try again.');
    throw error;
  }
};

// --- AI Suggestion APIs ---

/**
 * Generate AI suggestion (basic or state-aware)
 * @param {string} draftId - Draft ID
 * @param {Object} body - { targetBlock, prompt?, instruction?, stateAware?, fileIds?, responseSize? }
 * @returns {Promise<Object>} { suggestion }
 */
export const aiSuggest = async (draftId, body) => {
  const response = await fetch(`${DRAFT_TEMPLATE_SERVICE_URL}/${draftId}/ai/suggest`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || err.error || `HTTP ${response.status}`);
  }
  const data = await response.json();
  if (!data.success || !data.suggestion) throw new Error('Invalid response');
  return data;
};

/**
 * Get pending AI suggestions for a draft
 */
export const getAiSuggestions = async (draftId) => {
  const response = await fetch(`${DRAFT_TEMPLATE_SERVICE_URL}/${draftId}/ai/suggestions`, {
    method: 'GET',
    headers: getHeaders(),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || err.error || `HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.suggestions || [];
};

/**
 * Insert AI suggestion into draft (creates new version)
 */
export const insertAiSuggestion = async (draftId, suggestionId) => {
  const response = await fetch(`${DRAFT_TEMPLATE_SERVICE_URL}/${draftId}/ai/${suggestionId}/insert`, {
    method: 'POST',
    headers: getHeaders(),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || err.error || `HTTP ${response.status}`);
  }
  return response.json();
};

/**
 * Discard/reject AI suggestion
 */
export const discardAiSuggestion = async (draftId, suggestionId) => {
  const response = await fetch(`${DRAFT_TEMPLATE_SERVICE_URL}/${draftId}/ai/${suggestionId}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || err.error || `HTTP ${response.status}`);
  }
  return response.json();
};

// --- Evidence APIs ---

/**
 * Upload evidence file (multipart/form-data)
 * @param {string} draftId - Draft ID
 * @param {File} file - File to upload
 * @returns {Promise<Object>} { evidence }
 */
export const uploadEvidence = async (draftId, file) => {
  const formData = new FormData();
  formData.append('file', file);
  const token = getAuthToken();
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${DRAFT_TEMPLATE_SERVICE_URL}/${draftId}/evidence/upload`, {
    method: 'POST',
    headers,
    body: formData,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || err.error || `HTTP ${response.status}`);
  }
  const data = await response.json();
  if (!data.success || !data.evidence) throw new Error('Invalid response');
  return data;
};

/**
 * List evidence for a draft
 */
export const listEvidence = async (draftId) => {
  const response = await fetch(`${DRAFT_TEMPLATE_SERVICE_URL}/${draftId}/evidence`, {
    method: 'GET',
    headers: getHeaders(),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || err.error || `HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.evidence || [];
};

/**
 * Delete evidence
 */
export const deleteEvidence = async (draftId, evidenceId) => {
  const response = await fetch(`${DRAFT_TEMPLATE_SERVICE_URL}/${draftId}/evidence/${evidenceId}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || err.error || `HTTP ${response.status}`);
  }
  return response.json();
};

// --- Export / Preview / Finalize ---

/**
 * Export draft to DOCX; returns signed download URL
 */
export const exportDraft = async (draftId) => {
  const response = await fetch(`${DRAFT_TEMPLATE_SERVICE_URL}/${draftId}/export`, {
    method: 'POST',
    headers: getHeaders(),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || err.error || `HTTP ${response.status}`);
  }
  const data = await response.json();
  if (!data.success || !data.downloadUrl) throw new Error('Invalid response');
  return data;
};

/**
 * Get HTML preview (returns raw HTML string)
 */
export const getPreview = async (draftId) => {
  const response = await fetch(`${DRAFT_TEMPLATE_SERVICE_URL}/${draftId}/preview`, {
    method: 'GET',
    headers: getHeaders(),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || err.error || `HTTP ${response.status}`);
  }
  return response.text();
};

/**
 * Finalize draft (lock editing)
 */
export const finalizeDraft = async (draftId) => {
  const response = await fetch(`${DRAFT_TEMPLATE_SERVICE_URL}/${draftId}/finalize`, {
    method: 'POST',
    headers: getHeaders(),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || err.error || `HTTP ${response.status}`);
  }
  return response.json();
};

export default {
  createDraft,
  getDraft,
  updateDraftFields,
  updateDraftTitle,
  getDraftVersions,
  undoDraft,
  redoDraft,
  restoreDraftVersion,
  listDrafts,
  deleteDraft,
  aiSuggest,
  getAiSuggestions,
  insertAiSuggestion,
  discardAiSuggestion,
  uploadEvidence,
  listEvidence,
  deleteEvidence,
  exportDraft,
  getPreview,
  finalizeDraft,
};
