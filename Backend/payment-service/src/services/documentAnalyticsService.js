const axios = require('axios');

const FILE_SERVICE_URL = process.env.FILE_SERVICE_URL || '';
const DOCUMENT_SERVICE_URL = process.env.DOCUMENT_SERVICE_URL || '';
const API_GATEWAY_URL = process.env.API_GATEWAY_URL || 'http://localhost:5000';
const INTERNAL_SERVICE_TOKEN = process.env.INTERNAL_SERVICE_TOKEN || '';

function buildCandidateUrls() {
  const urls = [];
  const seen = new Set();

  const directServiceBases = [
    FILE_SERVICE_URL,
    DOCUMENT_SERVICE_URL,
    'http://localhost:5002',
  ].filter(Boolean);

  for (const baseUrl of directServiceBases) {
    const normalized = `${String(baseUrl).replace(/\/$/, '')}/api/files/internal/analytics/users`;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      urls.push({
        url: normalized,
        headers: {},
        source: 'direct',
      });
    }
  }

  if (API_GATEWAY_URL && INTERNAL_SERVICE_TOKEN) {
    const gatewayUrl = `${String(API_GATEWAY_URL).replace(/\/$/, '')}/docs/internal/analytics/users`;
    if (!seen.has(gatewayUrl)) {
      seen.add(gatewayUrl);
      urls.push({
        url: gatewayUrl,
        headers: {
          Authorization: `Bearer ${INTERNAL_SERVICE_TOKEN}`,
        },
        source: 'gateway',
      });
    }
  }

  return urls;
}

async function fetchUserDocumentAnalytics(userIds = [], options = {}) {
  const normalizedUserIds = Array.from(
    new Set(
      (userIds || [])
        .map((value) => Number(value))
        .filter((value) => !Number.isNaN(value) && value > 0)
    )
  );

  if (!normalizedUserIds.length) {
    return {};
  }

  const payload = {
    userIds: normalizedUserIds,
    ...(options.startDate ? { startDate: options.startDate } : {}),
    ...(options.endDate ? { endDate: options.endDate } : {}),
  };

  let lastError = null;
  const candidates = buildCandidateUrls();
  if (!candidates.length) {
    throw new Error('No document analytics service URL candidates are configured.');
  }

  for (const candidate of candidates) {
    try {
      const response = await axios.post(candidate.url, payload, {
        timeout: 10000,
        headers: candidate.headers,
      });
      return response.data?.data || response.data || {};
    } catch (error) {
      lastError = error;
      console.warn(
        `[DocumentAnalyticsService] Failed ${candidate.source} request to ${candidate.url}:`,
        error.response?.status || error.message
      );
    }
  }

  console.error(
    '[DocumentAnalyticsService] Exhausted analytics service candidates:',
    candidates.map((candidate) => candidate.url)
  );

  throw lastError || new Error('Unable to fetch user analytics from document service.');
}

module.exports = {
  fetchUserDocumentAnalytics,
};
