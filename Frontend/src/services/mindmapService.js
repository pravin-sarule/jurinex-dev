import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';
const VISUAL_SERVICE_URL = `${API_BASE_URL}/visual`;

// Get auth token from your auth system
const getAuthToken = () => {
  return localStorage.getItem('token') || sessionStorage.getItem('token');
};

const getHeaders = () => ({
  'Authorization': `Bearer ${getAuthToken()}`,
  'Content-Type': 'application/json'
});

export const mindmapService = {
  /**
   * Generate a new mind map from a document
   * @param {string} fileId - Document file ID
   * @param {string} sessionId - Optional session ID to link mindmap to chat session
   * @param {string} prompt - Optional custom prompt
   * @returns {Promise} Mind map data in NotebookLM format
   */
  async generateMindmap(fileId, sessionId = null, prompt = null) {
    try {
      const response = await axios.post(
        `${VISUAL_SERVICE_URL}/generate-mindmap`,
        {
          file_id: fileId,
          session_id: sessionId,  // Link to chat session
          prompt: prompt
        },
        { headers: getHeaders() }
      );
      return response.data;
    } catch (error) {
      console.error('Error generating mind map:', error);
      throw error;
    }
  },

  /**
   * Generate mindmap for multiple files
   * @param {Array<string>} fileIds - Array of file IDs
   * @param {string} sessionId - Optional session ID
   * @param {string} prompt - Optional custom prompt
   * @returns {Promise} Mind map data
   */
  async generateMindmapMulti(fileIds, sessionId = null, prompt = null) {
    try {
      const response = await axios.post(
        `${VISUAL_SERVICE_URL}/generate-mindmap`,
        {
          file_ids: fileIds,
          session_id: sessionId,
          prompt: prompt
        },
        { headers: getHeaders() }
      );
      return response.data;
    } catch (error) {
      console.error('Error generating multi-file mind map:', error);
      throw error;
    }
  },

  /**
   * Get mind map by ID
   * @param {string} mindmapId - Mind map ID
   * @returns {Promise} Mind map data with user state
   */
  async getMindmap(mindmapId) {
    try {
      const response = await axios.get(
        `${VISUAL_SERVICE_URL}/mindmap`,
        {
          params: { mindmap_id: mindmapId },
          headers: getHeaders()
        }
      );
      return response.data;
    } catch (error) {
      console.error('Error getting mind map:', error);
      throw error;
    }
  },

  /**
   * Get all mind maps for a file
   * @param {string} fileId - Document file ID
   * @param {string} sessionId - Optional session ID to filter by session
   * @returns {Promise} List of mind maps
   */
  async getMindmapsByFile(fileId, sessionId = null) {
    try {
      const params = { file_id: fileId };
      if (sessionId) {
        params.session_id = sessionId;
      }
      const response = await axios.get(
        `${VISUAL_SERVICE_URL}/mindmaps`,
        {
          params: params,
          headers: getHeaders()
        }
      );
      return response.data;
    } catch (error) {
      console.error('Error getting mind maps:', error);
      throw error;
    }
  },

  /**
   * Get full mindmap by session ID (RECOMMENDED - returns complete structure with nodes and user state)
   * Use this when loading previous chat sessions to get the complete mindmap ready for rendering
   * @param {string} sessionId - Chat session ID
   * @returns {Promise} Full mindmap data ready for rendering
   */
  async getMindmapBySession(sessionId) {
    try {
      console.log('[mindmapService] Fetching mindmap for session:', sessionId);
      console.log('[mindmapService] Using endpoint:', `${VISUAL_SERVICE_URL}/mindmap`);
      
      const response = await axios.get(
        `${VISUAL_SERVICE_URL}/mindmap`,
        {
          params: { session_id: sessionId },
          headers: getHeaders()
        }
      );
      
      console.log('[mindmapService] Mindmap response received:', {
        status: response.status,
        data: response.data,
        hasData: !!response.data,
        hasSuccess: response.data?.success !== undefined,
        hasDataField: !!response.data?.data,
        responseKeys: response.data ? Object.keys(response.data) : []
      });
      
      return response.data;
    } catch (error) {
      // If 404, no mindmap exists for this session (not an error)
      if (error.response?.status === 404) {
        console.log('[mindmapService] No mindmap found for session (404):', sessionId);
        return { success: false, data: null };
      }
      
      // Try alternative endpoint path if first attempt fails
      if (error.response?.status === 404 || error.code === 'ERR_BAD_REQUEST') {
        console.log('[mindmapService] Trying alternative endpoint path...');
        try {
          const altResponse = await axios.get(
            `${API_BASE_URL}/api/visual/mindmap`,
            {
              params: { session_id: sessionId },
              headers: getHeaders()
            }
          );
          console.log('[mindmapService] Alternative endpoint succeeded');
          return altResponse.data;
        } catch (altError) {
          console.log('[mindmapService] Alternative endpoint also failed');
        }
      }
      
      console.error('[mindmapService] Error getting mindmap by session:', error);
      console.error('[mindmapService] Error details:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        url: error.config?.url
      });
      throw error;
    }
  },

  /**
   * Get mindmap metadata list for a specific chat session (returns list without full node structure)
   * Use this to check which sessions have mindmaps or get a list of mindmaps
   * @param {string} sessionId - Chat session ID
   * @returns {Promise} List of mind map metadata for the session
   */
  async getMindmapsMetadataBySession(sessionId) {
    try {
      const response = await axios.get(
        `${VISUAL_SERVICE_URL}/mindmaps/session`,
        {
          params: { session_id: sessionId },
          headers: getHeaders()
        }
      );
      return response.data;
    } catch (error) {
      console.error('Error getting mind maps metadata by session:', error);
      throw error;
    }
  },

  /**
   * Update node collapse state
   * @param {string} nodeId - Node ID
   * @param {boolean} isCollapsed - Collapse state
   * @returns {Promise} Updated state
   */
  async updateNodeState(nodeId, isCollapsed) {
    try {
      const response = await axios.put(
        `${VISUAL_SERVICE_URL}/mindmap/node/state`,
        {
          node_id: nodeId,
          is_collapsed: isCollapsed
        },
        { headers: getHeaders() }
      );
      return response.data;
    } catch (error) {
      console.error('Error updating node state:', error);
      throw error;
    }
  },

  /**
   * Delete a mind map
   * @param {string} mindmapId - Mind map ID
   * @returns {Promise} Deletion result
   */
  async deleteMindmap(mindmapId) {
    try {
      const response = await axios.delete(
        `${VISUAL_SERVICE_URL}/mindmap/${mindmapId}`,
        { headers: getHeaders() }
      );
      return response.data;
    } catch (error) {
      console.error('Error deleting mind map:', error);
      throw error;
    }
  }
};

