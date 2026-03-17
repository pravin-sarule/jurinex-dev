/**
 * Centralized API Base URLs Configuration
 * 
 * All backend URLs should be imported from this file.
 * Environment variables are supported with sensible defaults.
 */

// Get base gateway URL from environment or use deployed default
const GATEWAY_URL =
  import.meta.env.VITE_APP_GATEWAY_URL ||
  import.meta.env.VITE_APP_API_URL ||
  'https://gateway-service-120280829617.asia-south1.run.app';

// API Base URLs for different services
export const API_BASE_URL = GATEWAY_URL;
export const GATEWAY_BASE_URL = GATEWAY_URL;

// Service-specific endpoints (gateway proxies; can override with direct URLs via env)
export const AUTH_SERVICE_URL =
  import.meta.env.VITE_APP_AUTH_SERVICE_URL ||
  'https://authservice-120280829617.asia-south1.run.app';
export const CHAT_MODEL_BASE_URL =
  import.meta.env.VITE_APP_CHAT_MODEL_URL ||
  'https://chat-model-120280829617.asia-south1.run.app';
export const PAYMENT_SERVICE_URL =
  import.meta.env.VITE_APP_PAYMENT_SERVICE_URL ||
  'https://payment-service-120280829617.asia-south1.run.app';
export const VISUAL_SERVICE_URL =
  import.meta.env.VITE_APP_VISUAL_SERVICE_URL ||
  'https://visual-service-120280829617.asia-south1.run.app';

export const DOCUMENT_SERVICE_URL =
  import.meta.env.VITE_APP_DOCUMENT_SERVICE_URL ||
  'https://document-service-120280829617.asia-south1.run.app';
export const FILES_SERVICE_URL = `${GATEWAY_URL}/api/files`;
export const CONTENT_SERVICE_URL = `${GATEWAY_URL}/api/content`;
export const MINDMAP_SERVICE_URL = `${GATEWAY_URL}/api/mindmap`;
export const USER_RESOURCES_SERVICE_URL = `${GATEWAY_URL}/user-resources`;
export const CHAT_SERVICE_URL = CHAT_MODEL_BASE_URL;

// Citation service (direct FastAPI service)
export const CITATION_SERVICE_URL =
  import.meta.env.VITE_APP_CITATION_SERVICE_URL ||
  'https://citation-service-120280829617.asia-south1.run.app';

// Drafting service for Google Docs / Word integration (direct to Cloud Run)
export const DRAFTING_SERVICE_URL =
  import.meta.env.VITE_DRAFTING_SERVICE_URL ||
  'https://drafting-service-120280829617.asia-south1.run.app';

// Agent-draft service: templates, drafts, fields, sections, autopopulation (JuriNex Agent Draft Service)
export const AGENT_DRAFT_TEMPLATE_API =
  import.meta.env.VITE_APP_AGENT_DRAFT_TEMPLATE_URL ||
  'https://all-drafting-agent-120280829617.asia-south1.run.app';

// Template Analyzer (user upload templates): User Template Analyzer Agent
export const TEMPLATE_ANALYZER_API_BASE =
  import.meta.env.VITE_APP_TEMPLATE_ANALYZER_URL ||
  'https://drafting-agents-120280829617.asia-south1.run.app';

/**
 * Get current user id for drafting/template APIs (Custom Template Isolation).
 * Used as X-User-Id header so agent-draft-service can fetch user-uploaded templates from Template Analyzer.
 * @returns {string|null} User id string or null
 */
export function getUserIdForDrafting() {
  try {
    const userStr = localStorage.getItem('user') || localStorage.getItem('userInfo');
    if (userStr) {
      const parsed = JSON.parse(userStr);
      const id = parsed?.id ?? parsed?.userId ?? parsed?.user_id;
      if (id != null) return String(id);
    }
    const token = localStorage.getItem('token') || localStorage.getItem('authToken') || localStorage.getItem('access_token') || localStorage.getItem('jwt') || localStorage.getItem('auth_token');
    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1] || '{}'));
      const id = payload?.id ?? payload?.userId ?? payload?.user_id ?? payload?.sub;
      if (id != null) return String(id);
    }
  } catch (_) {}
  return null;
}

// Legacy support - backward compatibility (docs via document service when direct)
export const DOCS_BASE_URL = DOCUMENT_SERVICE_URL.replace(/\/$/, '');
export const FILES_BASE_URL = `${GATEWAY_URL}/files`;

// For direct service access (document service)
export const DOCUMENT_SERVICE_DIRECT =
  import.meta.env.VITE_DOCUMENT_SERVICE_URL ||
  'https://document-service-120280829617.asia-south1.run.app';
export const CONTENT_SERVICE_DIRECT = `${DOCUMENT_SERVICE_DIRECT}/api/content`;

// Export default object for convenience
const apiConfig = {
  GATEWAY_URL,
  API_BASE_URL,
  GATEWAY_BASE_URL,
  CHAT_MODEL_BASE_URL,
  AGENT_DRAFT_TEMPLATE_API,
  TEMPLATE_ANALYZER_API_BASE,
  getUserIdForDrafting,
  DOCUMENT_SERVICE_URL,
  FILES_SERVICE_URL,
  CONTENT_SERVICE_URL,
  MINDMAP_SERVICE_URL,
  VISUAL_SERVICE_URL,
  AUTH_SERVICE_URL,
  PAYMENT_SERVICE_URL,
  USER_RESOURCES_SERVICE_URL,
  CHAT_SERVICE_URL,
  CITATION_SERVICE_URL,
  DRAFTING_SERVICE_URL,
  DOCS_BASE_URL,
  FILES_BASE_URL,
  DOCUMENT_SERVICE_DIRECT,
  CONTENT_SERVICE_DIRECT,
};

export default apiConfig;








