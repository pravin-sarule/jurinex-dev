// Judgement service client — ADK legal search pipeline (FastAPI, direct).
//
// Flow:
//   1. analyze / analyzeUpload  -> sessionId + caseContext + suggestedIssues
//   2. runSearch(sessionId)     -> precedents grouped by issue (bands, chips, signals)
//   3. refine(sessionId)        -> search-within-search over the cached result set
//   searchOneShot               -> single call doing analyze + search together
//
// Every docId returned by this service is mechanically verified against the
// Indian Kanoon fetch pool server-side (CitationGuardian) — nothing invented.

import { JUDGEMENT_SERVICE_URL, getUserIdForDrafting } from '../config/apiConfig';
import { throwIfQuotaResponse } from '../utils/quotaError';

function getAuthHeader() {
  const token = localStorage.getItem('token') || localStorage.getItem('authToken')
    || localStorage.getItem('access_token') || localStorage.getItem('jwt') || localStorage.getItem('auth_token');
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  // The document service scopes case/file access by X-User-Id; the
  // judgement service forwards it when resolving a case's documents.
  const userId = getUserIdForDrafting();
  if (userId) headers['X-User-Id'] = String(userId);
  return headers;
}

async function postJson(path, body) {
  const response = await fetch(`${JUDGEMENT_SERVICE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await throwIfQuotaResponse(response, 'Judgement service request failed');
    let detail = `Judgement service error (${response.status})`;
    try {
      const data = await response.json();
      if (data?.detail) detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
    } catch { /* keep default detail */ }
    throw new Error(detail);
  }
  return response.json();
}

export const judgementApi = {
  /** GET /health — service + store status. */
  async health() {
    const response = await fetch(`${JUDGEMENT_SERVICE_URL}/health`, { headers: getAuthHeader() });
    if (!response.ok) throw new Error(`Judgement service unreachable (${response.status})`);
    return response.json();
  },

  /**
   * Phase 1 — POST /api/v1/analyze with pasted case text (and/or a server-side
   * fileRef). Returns { sessionId, caseContext, suggestedIssues,
   * needsClarification, clarificationQuestion, researchMode, groundsMeta }.
   * mode: 'issues' (default — issue spotter) | 'grounds' (extract the grounds
   * pleaded in the filing and research precedents for each ground).
   * No search spend happens here.
   */
  analyze({ text, fileRef, mode = 'issues' } = {}) {
    return postJson('/api/v1/analyze', { caseInput: { text: text || null, fileRef: fileRef || null }, mode });
  },

  /**
   * Phase 1 (case) — POST /api/v1/analyze/case. Analyzes one of the user's
   * existing cases: the backend pulls the case documents (and their
   * page-numbered chunks) from the agentic document service, so suggested
   * issues come back with 'file, page N' source references.
   */
  analyzeCase(caseId, text = '', mode = 'issues') {
    return postJson('/api/v1/analyze/case', { caseId, text: text || null, mode });
  },

  /** Phase 1 (upload) — POST /api/v1/analyze/upload with a PDF/DOCX + optional note. */
  async analyzeUpload(file, text = '', mode = 'issues') {
    const form = new FormData();
    form.append('file', file);
    if (text) form.append('text', text);
    form.append('mode', mode);
    const response = await fetch(`${JUDGEMENT_SERVICE_URL}/api/v1/analyze/upload`, {
      method: 'POST',
      headers: { ...getAuthHeader() },
      body: form,
    });
    if (!response.ok) {
      await throwIfQuotaResponse(response, 'Document analysis failed');
      let detail = `Document analysis failed (${response.status})`;
      try {
        const data = await response.json();
        if (data?.detail) detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
      } catch { /* keep default detail */ }
      throw new Error(detail);
    }
    return response.json();
  },

  /**
   * Phase 2 — POST /api/v1/search/{sessionId}/run.
   * issueIds: ids picked from suggestedIssues (null/undefined = all).
   * customIssues: the user's own issue texts, each searched separately.
   * Returns the full SearchResponse: issues[] -> results[] with band, score,
   * pinpoint, signals (explainability chips — render one chip per key).
   */
  runSearch(sessionId, { issueIds = null, customIssues = [] } = {}) {
    return postJson(`/api/v1/search/${sessionId}/run`, { issueIds, customIssues });
  },

  /** One-shot — POST /api/v1/search (analyze + split + search in one call). */
  searchOneShot({ text, fileRef } = {}) {
    return postJson('/api/v1/search', { caseInput: { text: text || null, fileRef: fileRef || null } });
  },

  /** Research history — GET /api/v1/sessions (scoped by X-User-Id). */
  async listSessions() {
    const response = await fetch(`${JUDGEMENT_SERVICE_URL}/api/v1/sessions`, { headers: getAuthHeader() });
    if (!response.ok) throw new Error(`History failed (${response.status})`);
    const data = await response.json();
    return data.sessions || [];
  },

  /** Reopen a stored research session with all its citations + decisions. */
  async getSession(sessionId) {
    const response = await fetch(`${JUDGEMENT_SERVICE_URL}/api/v1/search/${sessionId}`, { headers: getAuthHeader() });
    if (!response.ok) {
      let detail = `Could not open research (${response.status})`;
      try {
        const data = await response.json();
        if (data?.detail) detail = data.detail;
      } catch { /* keep default */ }
      throw new Error(detail);
    }
    return response.json();
  },

  /**
   * Full legal-intelligence report for one surfaced citation —
   * GET /api/v1/search/{sessionId}/report/{issueId}/{docId}.
   * Includes grounded LLM analysis, deterministic semantic/factual
   * relevance scores, citation context, bench/date, and the full
   * judgment text for the Document tab. Cached server-side per session.
   */
  async getReport(sessionId, issueId, docId) {
    const response = await fetch(
      `${JUDGEMENT_SERVICE_URL}/api/v1/search/${sessionId}/report/${issueId}/${encodeURIComponent(docId)}`,
      { headers: getAuthHeader() },
    );
    if (!response.ok) {
      let detail = `Report failed (${response.status})`;
      try {
        const data = await response.json();
        if (data?.detail) detail = data.detail;
      } catch { /* keep default */ }
      throw new Error(detail);
    }
    return response.json();
  },

  /** Approve / reject a citation — persisted in the search session. */
  setReportStatus(sessionId, issueId, docId, status) {
    return postJson(`/api/v1/search/${sessionId}/report/${issueId}/${encodeURIComponent(docId)}/status`, { status });
  },

  /**
   * Search-within-search — POST /api/v1/search/{sessionId}/refine.
   * mode: 'facet' | 'keyword' | 'semantic' | 'ik_escape'.
   * Results are reordered/de-emphasised, never deleted; when nothing matches,
   * the response carries an escapeHatch offer to search all of Indian Kanoon.
   */
  refine(sessionId, { issueId, mode, query = '', court = null, yearFrom = null, yearTo = null, band = null }) {
    return postJson(`/api/v1/search/${sessionId}/refine`, {
      issueId, mode, query, court, yearFrom, yearTo, band,
    });
  },
};

export default judgementApi;
