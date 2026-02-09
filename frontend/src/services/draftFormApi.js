/**
 * Draft form API: create draft from template, get draft (with fields + values), update field values.
 * Uses agent-draft-service (Draft_DB). Requires JWT.
 */

import { AGENT_DRAFT_TEMPLATE_API } from '../config/apiConfig';

const BASE = `${AGENT_DRAFT_TEMPLATE_API}/api`;

/** Log API activity to console (method, url, label). */
const logApi = (method, url, label) => {
  console.log('[API]', method, url, label ? `— ${label}` : '');
};

const getAuthToken = () =>
  localStorage.getItem('token') ||
  localStorage.getItem('authToken') ||
  localStorage.getItem('access_token') ||
  localStorage.getItem('jwt') ||
  localStorage.getItem('auth_token');

const headers = () => {
  const token = getAuthToken();
  const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
};

/**
 * Get form field schema for a template (no auth required for this endpoint).
 */
export const getTemplateFields = async (templateId) => {
  logApi('GET', `${BASE}/templates/${templateId}/fields`, 'getTemplateFields');
  const res = await fetch(`${BASE}/templates/${templateId}/fields`, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Create a new draft from a template (clone + attach to current user). Requires JWT.
 * @returns { draft_id, template_id, draft_title, status, ... }
 */
export const createDraft = async (templateId, draftTitle = '') => {
  logApi('POST', `${BASE}/drafts`, 'createDraft');
  const res = await fetch(`${BASE}/drafts`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ template_id: templateId, draft_title: draftTitle || undefined }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * List current user's drafts (recent first). Requires JWT.
 */
export const listDrafts = async (status = null, limit = 50, offset = 0, templateId = null) => {
  const params = new URLSearchParams({ limit, offset });
  if (status) params.set('status', status);
  if (templateId) params.set('template_id', templateId);
  const url = `${BASE}/drafts?${params}`;
  logApi('GET', url, 'listDrafts');
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Get the latest draft for this template for the current user. Returns { success, draft } (draft may be null).
 * Use this before creating: if draft exists, open it; else create new.
 */
export const getLatestDraftForTemplate = async (templateId) => {
  logApi('GET', `${BASE}/templates/${templateId}/drafts/latest`, 'getLatestDraftForTemplate');
  const res = await fetch(`${BASE}/templates/${templateId}/drafts/latest`, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Get a draft with template info, form fields schema, and current field values. Requires JWT.
 */
export const getDraft = async (draftId) => {
  logApi('GET', `${BASE}/drafts/${draftId}`, 'getDraft');
  const res = await fetch(`${BASE}/drafts/${draftId}`, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Update field values for a draft. Requires JWT.
 */
export const updateDraftFields = async (draftId, fieldValues, filledFields = null) => {
  logApi('PUT', `${BASE}/drafts/${draftId}`, 'updateDraftFields');
  const body = filledFields !== null
    ? { field_values: fieldValues, filled_fields: filledFields }
    : { field_values: fieldValues };
  const res = await fetch(`${BASE}/drafts/${draftId}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Rename a draft. Updates the draft title. Requires JWT (owner only).
 */
export const renameDraft = async (draftId, newTitle) => {
  logApi('PATCH', `${BASE}/drafts/${draftId}/rename`, 'renameDraft');
  const res = await fetch(`${BASE}/drafts/${draftId}/rename`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ new_title: newTitle }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Delete a draft and its field data. Requires JWT (owner only).
 */
export const deleteDraft = async (draftId) => {
  logApi('DELETE', `${BASE}/drafts/${draftId}`, 'deleteDraft');
  const res = await fetch(`${BASE}/drafts/${draftId}`, {
    method: 'DELETE',
    headers: headers(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Save the uploaded file name to draft metadata so it is shown when the draft is reopened.
 */
export const setUploadedFileNameInDraft = async (draftId, fileName) => {
  logApi('POST', `${BASE}/drafts/${draftId}/uploaded-file`, 'setUploadedFileNameInDraft');
  const res = await fetch(`${BASE}/drafts/${draftId}/uploaded-file`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ file_name: fileName || '' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Link an uploaded file (by file_id) to this draft so the Librarian fetches only this draft's context.
 * Call this after upload when the response includes file_id. Stores file_id in metadata.uploaded_file_ids.
 */
export const linkFileToDraft = async (draftId, fileId, fileName = null) => {
  logApi('POST', `${BASE}/drafts/${draftId}/link-file`, 'linkFileToDraft');
  const body = { file_id: fileId };
  if (fileName != null) body.file_name = fileName;
  const res = await fetch(`${BASE}/drafts/${draftId}/link-file`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Attach a case to the draft. Case data (files/context) will be used by the agent.
 */
export const attachCaseToDraft = async (draftId, caseId, caseTitle = null) => {
  logApi('POST', `${BASE}/drafts/${draftId}/attach-case`, 'attachCaseToDraft');
  const body = { case_id: caseId };
  if (caseTitle != null) body.case_title = caseTitle;
  const res = await fetch(`${BASE}/drafts/${draftId}/attach-case`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Upload a document for the draft. Orchestrator sends task to ingestion agent (GCS → Document AI → chunk → embed → DB).
 * Optional draftId/caseId link the uploaded file to the draft or case for downstream agents.
 * @param {File} file - The file to upload
 * @param {{ draftId?: string, caseId?: string }} options - Optional draft and case linkage
 */
export const uploadDocumentForDraft = async (file, options = {}) => {
  logApi('POST', `${AGENT_DRAFT_TEMPLATE_API}/api/orchestrate/upload`, 'uploadDocumentForDraft (Orchestrator → Ingestion)');
  const token = getAuthToken();
  const form = new FormData();
  form.append('file', file);
  if (options.draftId) form.append('draft_id', options.draftId);
  if (options.caseId) form.append('case_id', options.caseId);
  const res = await fetch(`${AGENT_DRAFT_TEMPLATE_API}/api/orchestrate/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
}
