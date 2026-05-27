const axios = require('axios');

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:5001';
const API_GATEWAY_URL = process.env.API_GATEWAY_URL || 'http://localhost:5000';

function buildCandidateUrls(path) {
  const candidates = [];

  if (AUTH_SERVICE_URL) {
    candidates.push(`${String(AUTH_SERVICE_URL).replace(/\/$/, '')}/api/auth/internal${path}`);
  }

  if (API_GATEWAY_URL) {
    candidates.push(`${String(API_GATEWAY_URL).replace(/\/$/, '')}/api/auth/internal${path}`);
  }

  return candidates;
}

async function getFirstSuccessful(path) {
  const urls = buildCandidateUrls(path);
  let lastError = null;

  for (const url of urls) {
    try {
      const response = await axios.get(url, { timeout: 5000 });
      return response.data;
    } catch (error) {
      lastError = error;
      console.warn(`[FirmContextService] Failed request to ${url}:`, error.response?.status || error.message);
    }
  }

  throw lastError || new Error(`Unable to resolve internal auth path: ${path}`);
}

async function fetchFirmContext(userId) {
  return getFirstSuccessful(`/user/${userId}/firm-context`);
}

async function fetchFirmMembers(userId) {
  return getFirstSuccessful(`/user/${userId}/firm-members`);
}

module.exports = {
  fetchFirmContext,
  fetchFirmMembers,
};
