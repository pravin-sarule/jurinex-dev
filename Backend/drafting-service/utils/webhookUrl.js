/**
 * Webhook URL Utility
 * Handles webhook URL configuration for local development (ngrok) and production
 */

/**
 * Get the webhook base URL from environment variables
 * Supports:
 * - NGROK_URL (for local development with ngrok)
 * - WEBHOOK_BASE_URL (for production)
 * - GATEWAY_URL (fallback)
 * 
 * @returns {string} Base URL for webhooks
 */
const getWebhookBaseUrl = () => {
  // Priority 1: NGROK_URL (for local development)
  if (process.env.NGROK_URL) {
    const ngrokUrl = process.env.NGROK_URL.trim().replace(/\/$/, ''); // Remove trailing slash
    if (!ngrokUrl.startsWith('https://')) {
      throw new Error('NGROK_URL must start with https:// (e.g., https://a1b2-c3d4.ngrok-free.app)');
    }
    console.log(`[WebhookURL] Using NGROK_URL: ${ngrokUrl}`);
    return ngrokUrl;
  }

  // Priority 2: WEBHOOK_BASE_URL (for production)
  if (process.env.WEBHOOK_BASE_URL) {
    const webhookUrl = process.env.WEBHOOK_BASE_URL.trim().replace(/\/$/, '');
    if (!webhookUrl.startsWith('https://')) {
      console.warn(`[WebhookURL] ⚠️  WEBHOOK_BASE_URL should use HTTPS for production: ${webhookUrl}`);
    }
    console.log(`[WebhookURL] Using WEBHOOK_BASE_URL: ${webhookUrl}`);
    return webhookUrl;
  }

  // Priority 3: GATEWAY_URL (fallback)
  if (process.env.GATEWAY_URL) {
    const gatewayUrl = process.env.GATEWAY_URL.trim().replace(/\/$/, '');
    console.log(`[WebhookURL] Using GATEWAY_URL: ${gatewayUrl}`);
    return gatewayUrl;
  }

  // Default: localhost (will fail for webhooks, but useful for testing)
  const defaultUrl = 'http://localhost:5000';
  console.warn(`[WebhookURL] ⚠️  No webhook URL configured. Using default: ${defaultUrl}`);
  console.warn(`[WebhookURL] ⚠️  For local development, set NGROK_URL=https://your-ngrok-url.ngrok-free.app`);
  console.warn(`[WebhookURL] ⚠️  For production, set WEBHOOK_BASE_URL=https://your-domain.com`);
  return defaultUrl;
};

/**
 * Get the full webhook endpoint URL
 * 
 * @param {string} [baseUrl] - Optional base URL (defaults to getWebhookBaseUrl())
 * @returns {string} Full webhook endpoint URL
 */
const getWebhookUrl = (baseUrl = null) => {
  const base = baseUrl || getWebhookBaseUrl();
  // Note: The webhook route is at /api/webhooks/google-drive (not /drafting/api/webhooks/google-drive)
  // This matches the route defined in index.js
  const endpoint = '/api/webhooks/google-drive';
  const fullUrl = `${base}${endpoint}`;
  
  // Validate HTTPS for webhooks (required by Google)
  if (!fullUrl.startsWith('https://') && !fullUrl.startsWith('http://localhost')) {
    throw new Error(`Webhook URL must use HTTPS (Google requirement): ${fullUrl}`);
  }
  
  return fullUrl;
};

/**
 * Validate that the webhook URL is properly configured
 * 
 * @returns {Object} Validation result with isValid and message
 */
const validateWebhookUrl = () => {
  try {
    const url = getWebhookUrl();
    
    // Check if it's localhost (won't work for Google webhooks)
    if (url.includes('localhost') || url.includes('127.0.0.1')) {
      return {
        isValid: false,
        message: 'Webhook URL is using localhost. Google cannot send webhooks to localhost.',
        suggestion: 'Set NGROK_URL environment variable to your ngrok HTTPS URL (e.g., https://a1b2-c3d4.ngrok-free.app)'
      };
    }
    
    // Check if it's HTTPS
    if (!url.startsWith('https://')) {
      return {
        isValid: false,
        message: 'Webhook URL must use HTTPS (Google requirement)',
        suggestion: 'Use ngrok for local development or HTTPS URL for production'
      };
    }
    
    return {
      isValid: true,
      message: 'Webhook URL is properly configured',
      url: url
    };
  } catch (error) {
    return {
      isValid: false,
      message: error.message,
      suggestion: 'Check your environment variables: NGROK_URL, WEBHOOK_BASE_URL, or GATEWAY_URL'
    };
  }
};

module.exports = {
  getWebhookBaseUrl,
  getWebhookUrl,
  validateWebhookUrl
};

