/**
 * Section API Service (agent-draft-service, API_POSTMAN.md).
 * Section generate/refine, get sections, section prompts.
 */

import { AGENT_DRAFT_TEMPLATE_API } from '../config/apiConfig';

const API_URL = AGENT_DRAFT_TEMPLATE_API;

const getAuthHeaders = () => {
  const token =
    localStorage.getItem('token') ||
    localStorage.getItem('authToken') ||
    localStorage.getItem('access_token') ||
    localStorage.getItem('auth_token');
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
};

/**
 * Generate initial section content
 */
export const generateSection = async (
  draftId,
  sectionKey,
  sectionPrompt = null,
  ragQuery = null,
  templateUrl = null
) => {
  console.log(`[API] POST /api/drafts/${draftId}/sections/${sectionKey}/generate`);
  
  const response = await fetch(
    `${API_URL}/api/drafts/${draftId}/sections/${sectionKey}/generate`,
    {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        section_prompt: sectionPrompt,
        rag_query: ragQuery,
        template_url: templateUrl,
        auto_validate: true,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Failed to generate section');
  }

  return response.json();
};

/**
 * Refine section with user feedback
 */
export const refineSection = async (
  draftId,
  sectionKey,
  userFeedback,
  ragQuery = null,
  templateUrl = null
) => {
  console.log(`[API] POST /api/drafts/${draftId}/sections/${sectionKey}/refine`);
  
  const response = await fetch(
    `${API_URL}/api/drafts/${draftId}/sections/${sectionKey}/refine`,
    {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        user_feedback: userFeedback,
        rag_query: ragQuery,
        template_url: templateUrl,
        auto_validate: true,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Failed to refine section');
  }

  return response.json();
};

/**
 * Get all active sections for a draft
 */
export const getAllSections = async (draftId) => {
  console.log(`[API] GET /api/drafts/${draftId}/sections`);
  
  const response = await fetch(`${API_URL}/api/drafts/${draftId}/sections`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error('Failed to fetch sections');
  }

  return response.json();
};

/**
 * Get specific section with reviews
 */
export const getSection = async (draftId, sectionKey) => {
  console.log(`[API] GET /api/drafts/${draftId}/sections/${sectionKey}`);
  
  const response = await fetch(`${API_URL}/api/drafts/${draftId}/sections/${sectionKey}`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error('Failed to fetch section');
  }

  return response.json();
};

/**
 * Get version history for a section
 */
export const getSectionVersions = async (draftId, sectionKey) => {
  console.log(`[API] GET /api/drafts/${draftId}/sections/${sectionKey}/versions`);
  
  const response = await fetch(
    `${API_URL}/api/drafts/${draftId}/sections/${sectionKey}/versions`,
    {
      headers: getAuthHeaders(),
    }
  );

  if (!response.ok) {
    throw new Error('Failed to fetch section versions');
  }

  return response.json();
};

/**
 * Get universal sections (hardcoded 23 sections)
 */
export const getUniversalSections = async () => {
  console.log('[API] GET /api/universal-sections');
  
  const response = await fetch(`${API_URL}/api/universal-sections`);

  if (!response.ok) {
    throw new Error('Failed to fetch universal sections');
  }

  return response.json();
};

/**
 * Save section prompts to draft metadata
 */
export const saveSectionPrompts = async (draftId, prompts) => {
  console.log(`[API] POST /api/drafts/${draftId}/section-prompts`);
  
  const response = await fetch(`${API_URL}/api/drafts/${draftId}/section-prompts`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ prompts }),
  });

  if (!response.ok) {
    throw new Error('Failed to save section prompts');
  }

  return response.json();
};

/**
 * Get saved section prompts from draft metadata
 */
export const getSectionPrompts = async (draftId) => {
  console.log(`[API] GET /api/drafts/${draftId}/section-prompts`);
  
  const response = await fetch(`${API_URL}/api/drafts/${draftId}/section-prompts`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error('Failed to fetch section prompts');
  }

  return response.json();
};
