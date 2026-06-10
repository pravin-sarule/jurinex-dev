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
 * Fetch storage usage from the ChatModel service's dedicated storage endpoint.
 * This endpoint queries Document_DB directly and falls back to GCS listing —
 * more reliable than the agentic-document-service proxy.
 *
 * @returns {Promise<number>} storage_used_bytes (0 on failure)
 */
async function fetchStorageFromChatModel(userId, authorizationHeader) {
  const chatModelBase = (process.env.CHAT_MODEL_SERVICE_URL || 'http://localhost:8096').replace(/\/$/, '');
  const url = `${chatModelBase}/api/chat/storage/usage`;
  const headers = usageRequestHeaders(authorizationHeader, userId);
  try {
    const response = await axios.get(url, { headers, timeout: 12000 });
    if (response.status === 200 && response.data?.success) {
      return {
        storage_used_bytes: Number(response.data.data?.storage_used_bytes || 0),
        storage_used_gb:    Number(response.data.data?.storage_used_gb    || 0),
        documents_used:     Number(response.data.data?.documents_used     || 0),
      };
    }
  } catch (error) {
    if (error.code !== 'ECONNREFUSED' && error.code !== 'ECONNRESET') {
      const detail = error.response?.status ? `HTTP ${error.response.status}` : error.code || error.message;
      console.debug(`[DocumentUsage] ChatModel storage endpoint unavailable: ${detail}`);
    }
  }
  return null;
}

/**
 * Fetch usage/plan from document service, trying direct service URL before gateway.
 * Storage is sourced from the ChatModel service (more reliable) first.
 * @returns {Promise<{ usage, plan, timeLeft } | null>}
 */
async function fetchUserUsageAndPlan(userId, authorizationHeader) {
  // ── Try ChatModel's dedicated storage endpoint first ──────────────────
  const chatModelStorage = await fetchStorageFromChatModel(userId, authorizationHeader);

  const candidates = buildUserUsageAndPlanCandidates(userId);
  const headers = usageRequestHeaders(authorizationHeader, userId);
  let lastError = null;

  for (const url of candidates) {
    try {
      const response = await axios.get(url, { headers, timeout: 10000 });
      if (response.status === 200 && response.data?.success) {
        const usage = { ...response.data.data.usage };

        // Override storage with ChatModel's more accurate value when available
        if (chatModelStorage && chatModelStorage.storage_used_bytes > 0) {
          usage.storage_used_bytes = chatModelStorage.storage_used_bytes;
          usage.storage_used_gb   = chatModelStorage.storage_used_gb;
          if (chatModelStorage.documents_used > 0) {
            usage.documents_used = chatModelStorage.documents_used;
          }
        } else if (!chatModelStorage && usage.storage_used_gb === 0) {
          // Both sources returned 0 — keep 0 but don't treat as error
        }

        return {
          usage,
          plan:     response.data.data.plan,
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
      console.debug(`[DocumentUsage] Failed request to ${url}: ${detail}`);
    }
  }

  // ── If agentic-document-service is unreachable but ChatModel storage worked,
  //    return a minimal usage payload with the real storage data ─────────────
  if (chatModelStorage) {
    console.debug('[DocumentUsage] agentic-doc-service unreachable; returning ChatModel storage data');
    return {
      usage: {
        user_id:            userId,
        tokens_used:        0,
        documents_used:     chatModelStorage.documents_used,
        ai_analysis_used:   0,
        storage_used_gb:    chatModelStorage.storage_used_gb,
        storage_used_bytes: chatModelStorage.storage_used_bytes,
        carry_over_tokens:  0,
      },
      plan:     null,
      timeLeft: 0,
    };
  }

  if (lastError) {
    const detail = lastError.response?.status
      ? `HTTP ${lastError.response.status}`
      : lastError.code || lastError.message;
    console.debug('[DocumentUsage] Service unavailable (non-critical):', detail);
  }

  return null;
}

module.exports = {
  buildUserUsageAndPlanCandidates,
  getUserUsageAndPlanUrl,
  usageRequestHeaders,
  fetchUserUsageAndPlan,
};
