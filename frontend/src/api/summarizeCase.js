/**
 * Client for the structured-case endpoint on the agentic-document-service.
 *
 *   POST {DOCUMENT_SERVICE_URL}/api/summarize
 *   body: { caseText, query, model }
 *   ->   { success, data: StructuredCase, rawMarkdown?, warnings: [] }
 *
 * Includes a small retry with exponential backoff for transient network / 5xx
 * failures (the endpoint is non-streaming, so a plain fetch is sufficient).
 */
import { DOCUMENT_SERVICE_URL } from '../config/apiConfig';

const ENDPOINT = `${DOCUMENT_SERVICE_URL}/api/summarize`;

function authHeaders() {
  const token =
    localStorage.getItem('token') ||
    localStorage.getItem('authToken') ||
    localStorage.getItem('access_token') ||
    localStorage.getItem('jwt') ||
    localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{ caseText?: string, query?: string, model?: string }} params
 * @param {{ retries?: number, signal?: AbortSignal }} [opts]
 * @returns {Promise<{success:boolean,data:object,rawMarkdown?:string,warnings:string[]}>}
 */
export async function summarizeCase(
  { caseText = '', query = '', model } = {},
  { retries = 2, signal } = {},
) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ caseText, query, model }),
        signal,
      });

      if (res.status >= 500 && attempt < retries) {
        await sleep(2 ** attempt * 500);
        continue;
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Request failed (${res.status}): ${detail.slice(0, 200)}`);
      }
      return await res.json();
    } catch (err) {
      lastError = err;
      if (err?.name === 'AbortError') throw err;
      if (attempt < retries) {
        await sleep(2 ** attempt * 500);
        continue;
      }
    }
  }
  throw lastError || new Error('summarizeCase failed');
}
