// services/draftService.js
const API_BASE_URL = import.meta.env.REACT_APP_API_BASE_URL || 'https://gateway-service-120280829617.asia-south1.run.app/api/content';

export const draftService = {
  // Save or update case draft
  saveDraft: async (userId, draftData, lastStep) => {
    try {
      const response = await fetch(`${API_BASE_URL}/case-draft/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          draftData: JSON.stringify(draftData),
          lastStep,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error saving draft:', error);
      throw error;
    }
  },

  // Get existing draft for user
  getDraft: async (userId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/case-draft/${userId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 404) {
        return null; // No draft found
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      return {
        ...result,
        draft_data: typeof result.draft_data === 'string' 
          ? JSON.parse(result.draft_data) 
          : result.draft_data
      };
    } catch (error) {
      console.error('Error fetching draft:', error);
      throw error;
    }
  },

  // Delete draft after case creation
  deleteDraft: async (userId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/case-draft/${userId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error deleting draft:', error);
      throw error;
    }
  },
};

// API service for other content (case types, courts, judges)
export const contentService = {
  // Case Types
  getCaseTypes: async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/case-types`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Error fetching case types:', error);
      throw error;
    }
  },

  getSubTypes: async (caseTypeId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/case-types/${caseTypeId}/sub-types`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Error fetching sub-types:', error);
      throw error;
    }
  },

  // Courts
  getCourts: async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/courts`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Error fetching courts:', error);
      throw error;
    }
  },

  getCourtsByLevel: async (level) => {
    try {
      const response = await fetch(`${API_BASE_URL}/courts/level/${level}`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Error fetching courts by level:', error);
      throw error;
    }
  },

  getCourtById: async (id) => {
    try {
      const response = await fetch(`${API_BASE_URL}/courts/${id}`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Error fetching court by ID:', error);
      throw error;
    }
  },

  // Judges
  getJudgesByBench: async (courtId, benchName) => {
    try {
      const response = await fetch(`${API_BASE_URL}/judges?courtId=${courtId}&benchName=${encodeURIComponent(benchName)}`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Error fetching judges by bench:', error);
      throw error;
    }
  },
};