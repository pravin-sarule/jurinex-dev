/**
 * Centralized API Base URLs Configuration
 * 
 * All backend URLs should be imported from this file.
 * Environment variables are supported with sensible defaults.
 */

// Get base gateway URL from environment or use default
const GATEWAY_URL = import.meta.env.VITE_APP_GATEWAY_URL || 
                    import.meta.env.VITE_APP_API_URL || 
                    'https://gateway-service-110685455967.asia-south1.run.app';

// API Base URLs for different services
export const API_BASE_URL = GATEWAY_URL;
export const GATEWAY_BASE_URL = GATEWAY_URL;

// Service-specific endpoints (all go through gateway)
export const DOCUMENT_SERVICE_URL = `${GATEWAY_URL}/api/doc`;
export const FILES_SERVICE_URL = `${GATEWAY_URL}/api/files`;
export const CONTENT_SERVICE_URL = `${GATEWAY_URL}/api/content`;
export const MINDMAP_SERVICE_URL = `${GATEWAY_URL}/api/mindmap`;
export const VISUAL_SERVICE_URL = `${GATEWAY_URL}/visual`;
export const AUTH_SERVICE_URL = `${GATEWAY_URL}/auth/api/auth`;
export const PAYMENT_SERVICE_URL = `${GATEWAY_URL}/payments`;
export const USER_RESOURCES_SERVICE_URL = `${GATEWAY_URL}/user-resources`;
export const CHAT_SERVICE_URL = `${GATEWAY_URL}/api/chat`;
export const DRAFTING_SERVICE_URL = `${GATEWAY_URL}/drafting`;

// Legacy support - backward compatibility
export const DOCS_BASE_URL = `${GATEWAY_URL}/docs`;
export const FILES_BASE_URL = `${GATEWAY_URL}/files`;

// For direct service access (if needed, but prefer gateway)
export const DOCUMENT_SERVICE_DIRECT = import.meta.env.VITE_DOCUMENT_SERVICE_URL || 'https://document-service-110685455967.asia-south1.run.app';
export const CONTENT_SERVICE_DIRECT = `${DOCUMENT_SERVICE_DIRECT}/api/content`;

// Export default object for convenience
const apiConfig = {
  GATEWAY_URL,
  API_BASE_URL,
  GATEWAY_BASE_URL,
  DOCUMENT_SERVICE_URL,
  FILES_SERVICE_URL,
  CONTENT_SERVICE_URL,
  MINDMAP_SERVICE_URL,
  VISUAL_SERVICE_URL,
  AUTH_SERVICE_URL,
  PAYMENT_SERVICE_URL,
  USER_RESOURCES_SERVICE_URL,
  CHAT_SERVICE_URL,
  DRAFTING_SERVICE_URL,
  DOCS_BASE_URL,
  FILES_BASE_URL,
  DOCUMENT_SERVICE_DIRECT,
  CONTENT_SERVICE_DIRECT,
};

export default apiConfig;








