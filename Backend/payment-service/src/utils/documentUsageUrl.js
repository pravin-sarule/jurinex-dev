const axios = require('axios');

/**
 * Build candidate URLs for GET user-usage-and-plan (contract: /api/files/user-usage-and-plan/:userId).
 *
 * Order: DOCUMENT_FILES_API_URL → FILE_SERVICE_URL → local agentic-document-service → API gateway.
 */
function buildUserUsageAndPlanCandidates(userId) {
  const path = `/user-usage-and-plan/${userId}`;
  const candidates = [];
  const seen = new Set();

  const add = (base) => {
    const normalized = `${String(base).replace(/\/$/, '')}${path}`;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      candidates.push(normalized);
    }
  };

  const documentFilesApi = (process.env.DOCUMENT_FILES_API_URL || '').trim();
  if (documentFilesApi) {
    add(documentFilesApi);
  }

  const fileServiceUrl = (process.env.FILE_SERVICE_URL || '').trim();
  if (fileServiceUrl) {
    add(`${fileServiceUrl.replace(/\/$/, '')}/api/files`);
  }

  add('http://localhost:8092/api/files');

  const gateway = (process.env.API_GATEWAY_URL || 'http://localhost:5000').trim().replace(/\/$/, '');
  if (gateway) {
    const gatewayPath = `${gateway}/files${path}`;
    if (!seen.has(gatewayPath)) {
      seen.add(gatewayPath);
      candidates.push(gatewayPath);
    }
  }

  return candidates;
}

/** @deprecated Prefer fetchUserUsageAndPlan — kept for callers that only need one URL. */
function getUserUsageAndPlanUrl(userId) {
  const candidates = buildUserUsageAndPlanCandidates(userId);
  return candidates[0];
}

function usageRequestHeaders(authorizationHeader, userId) {
  const headers = {};
  if (authorizationHeader) {
    headers.Authorization = authorizationHeader;
  }
  if (userId != null && userId !== '') {
    headers['x-user-id'] = String(userId);
  }
  return headers;
}

/**
 * Fetch usage/plan from document service, trying direct service URL before gateway.
 * @returns {Promise<{ usage, plan, timeLeft } | null>}
 */
async function fetchUserUsageAndPlan(userId, authorizationHeader) {
  const candidates = buildUserUsageAndPlanCandidates(userId);
  const headers = usageRequestHeaders(authorizationHeader, userId);
  let lastError = null;

  for (const url of candidates) {
    try {
      const response = await axios.get(url, { headers, timeout: 10000 });
      if (response.status === 200 && response.data?.success) {
        return {
          usage: response.data.data.usage,
          plan: response.data.data.plan,
          timeLeft: response.data.data.timeLeft,
        };
      }
      console.warn(
        `[DocumentUsage] Non-success response from ${url}:`,
        response.status,
        response.data
      );
    } catch (error) {
      lastError = error;
      const detail = error.response?.status
        ? `HTTP ${error.response.status}`
        : error.code || error.message;
      console.warn(`[DocumentUsage] Failed request to ${url}: ${detail}`);
    }
  }

  if (lastError) {
    const detail = lastError.response?.status
      ? `HTTP ${lastError.response.status}`
      : lastError.code || lastError.message;
    console.error('❌ Error fetching user usage and plan from Document Service:', detail);
  }

  return null;
}

module.exports = {
  buildUserUsageAndPlanCandidates,
  getUserUsageAndPlanUrl,
  usageRequestHeaders,
  fetchUserUsageAndPlan,
};
