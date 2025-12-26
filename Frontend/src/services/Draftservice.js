import { CONTENT_SERVICE_DIRECT } from '../config/apiConfig';

const API_BASE_URL = CONTENT_SERVICE_DIRECT;

export const draftService = {
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

  getDraft: async (userId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/case-draft/${userId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 404) {
        return null;
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

export const contentService = {
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