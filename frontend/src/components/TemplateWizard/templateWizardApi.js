/**
 * Fetches templates from agent-draft-service template gallery API.
 * GET /api/templates?category=&is_active=true&limit=50&offset=0&include_preview_url=true
 */

import { AGENT_DRAFT_TEMPLATE_API } from '../../config/apiConfig';

const TEMPLATES_URL = `${AGENT_DRAFT_TEMPLATE_API}/api/templates`;

/**
 * Fetch template list with preview image URLs for the gallery.
 * @param {Object} options
 * @param {string} [options.category] - Filter by category
 * @param {boolean} [options.is_active=true] - Only active templates
 * @param {number} [options.limit=50] - Page size
 * @param {number} [options.offset=0] - Pagination offset
 * @param {boolean} [options.include_preview_url=true] - Include signed preview_image_url per template
 * @returns {Promise<{ success: boolean, templates: Array, count: number }>}
 */
export const fetchTemplates = async ({
  category = '',
  is_active = true,
  limit = 50,
  offset = 0,
  include_preview_url = true,
} = {}) => {
  const params = new URLSearchParams({
    category: String(category),
    is_active: String(is_active),
    limit: String(limit),
    offset: String(offset),
    include_preview_url: String(include_preview_url),
  });
  const url = `${TEMPLATES_URL}?${params.toString()}`;
  console.log('[API]', 'GET', url, '— fetchTemplates');
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${response.status}`);
  }
  return response.json();
};
