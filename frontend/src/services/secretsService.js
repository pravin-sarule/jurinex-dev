import { SECRET_PROMPTS_API_BASE, CHAT_MODEL_BASE_URL } from '../config/apiConfig';

const CACHE_KEY = 'jurinex_secrets_list_v1';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

let memoryCache = null;
let memoryCacheAt = 0;
let inflightListRequest = null;

function getAuthToken() {
  const tokenKeys = [
    'authToken', 'token', 'accessToken', 'jwt', 'bearerToken',
    'auth_token', 'access_token', 'api_token', 'userToken',
  ];
  for (const key of tokenKeys) {
    const token = localStorage.getItem(key);
    if (token) return token;
  }
  return null;
}

function readSessionCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data || !parsed?.at) return null;
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeSessionCache(data) {
  try {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ data, at: Date.now() })
    );
  } catch {
    /* ignore quota errors */
  }
}

/** Instant list for UI (memory → sessionStorage). Does not hit the network. */
export function peekSecretsList() {
  if (memoryCache?.length && Date.now() - memoryCacheAt < CACHE_TTL_MS) {
    return memoryCache;
  }
  const fromSession = readSessionCache();
  if (fromSession?.length) {
    memoryCache = fromSession;
    memoryCacheAt = Date.now();
    return fromSession;
  }
  return memoryCache?.length ? memoryCache : null;
}

export function invalidateSecretsListCache() {
  memoryCache = null;
  memoryCacheAt = 0;
  inflightListRequest = null;
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

async function requestSecretsFromApi(includeValues) {
  const token = getAuthToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const base = String(SECRET_PROMPTS_API_BASE || CHAT_MODEL_BASE_URL).replace(/\/$/, '');
  const url = `${base}/secrets?fetch=${includeValues ? 'true' : 'false'}`;

  const response = await fetch(url, { method: 'GET', headers });
  if (!response.ok) {
    throw new Error(`Failed to fetch secrets: ${response.status}`);
  }
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

/**
 * Load analysis prompt metadata (names/ids). Values are fetched on-demand when a prompt runs.
 * Uses in-memory + sessionStorage cache and dedupes concurrent requests.
 */
export async function fetchSecretsList({ includeValues = false, forceRefresh = false } = {}) {
  const canUseCache = !includeValues && !forceRefresh;

  if (canUseCache) {
    const cached = peekSecretsList();
    if (cached?.length) {
      void fetchSecretsList({ includeValues: false, forceRefresh: true }).catch(() => {});
      return cached;
    }
  }

  if (inflightListRequest) {
    return inflightListRequest;
  }

  inflightListRequest = (async () => {
    const rows = await requestSecretsFromApi(includeValues);
    if (!includeValues && rows.length) {
      memoryCache = rows;
      memoryCacheAt = Date.now();
      writeSessionCache(rows);
    }
    return rows;
  })();

  try {
    return await inflightListRequest;
  } finally {
    inflightListRequest = null;
  }
}

/** Full prompt body for a single secret (used when backend needs client-side value). */
export async function fetchSecretById(secretId) {
  const token = getAuthToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const base = String(SECRET_PROMPTS_API_BASE || CHAT_MODEL_BASE_URL).replace(/\/$/, '');
  const response = await fetch(`${base}/secrets/${secretId}`, { method: 'GET', headers });
  if (!response.ok) {
    throw new Error(`Failed to fetch secret value: ${response.status}`);
  }
  return response.json();
}
