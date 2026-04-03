import { GATEWAY_BASE_URL } from '../config/apiConfig';
import { toast } from 'react-toastify';

// Template service URL through gateway
const TEMPLATE_SERVICE_URL = `${GATEWAY_BASE_URL}/api/drafting-templates/api`;

const getAuthToken = () => {
  return localStorage.getItem('token') || 
         localStorage.getItem('authToken') || 
         localStorage.getItem('access_token') || 
         localStorage.getItem('jwt') ||
         localStorage.getItem('auth_token');
};

const getHeaders = () => {
  const token = getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  return headers;
};

/**
 * Get all templates, optionally filtered by category
 * @param {string} category - Optional category filter
 * @returns {Promise<Array>} Array of template objects
 */
export const getTemplates = async (category = null) => {
  try {
    let url = `${TEMPLATE_SERVICE_URL}/templates`;
    if (category && category !== 'All') {
      url += `?category=${encodeURIComponent(category)}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: getHeaders(),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    // Backend returns { success: true, templates: [...] }
    if (data.success && data.templates) {
      return data.templates.map(template => ({
        id: String(template.id || '').trim(),
        title: template.name,
        name: template.name,
        description: template.description,
        category: template.category,
        isActive: template.isActive,
        createdAt: template.createdAt
      }));
    }
    
    return data.templates || [];
  } catch (error) {
    console.error('Error fetching templates:', error);
    toast.error('Failed to load templates. Please try again.');
    throw error;
  }
};

/**
 * Get a single template by ID with full schema and content
 * @param {string} id - Template ID
 * @returns {Promise<Object>} Template object with schema and content
 */
export const getTemplateById = async (id) => {
  try {
    const response = await fetch(`${TEMPLATE_SERVICE_URL}/templates/${id}`, {
      method: 'GET',
      headers: getHeaders(),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    // Backend returns { success: true, template: { id, name, schema, content, ... } }
    if (data.success && data.template) {
      const template = data.template;
      
      return {
        id: String(template.id || '').trim(),
        name: template.name,
        title: template.name,
        description: template.description,
        category: template.category,
        schema: template.schema,
        content: template.content,
        isActive: template.isActive,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt
      };
    }
    
    throw new Error('Invalid response format from server');
  } catch (error) {
    console.error('Error fetching template:', error);
    toast.error('Failed to load template. Please try again.');
    throw error;
  }
};

/**
 * Get only the template schema (for form generation)
 * @param {string} id - Template ID
 * @returns {Promise<Object>} Schema object with fields
 */
export const getTemplateSchema = async (id) => {
  try {
    const response = await fetch(`${TEMPLATE_SERVICE_URL}/templates/${id}/schema`, {
      method: 'GET',
      headers: getHeaders(),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.schema || { fields: [] };
  } catch (error) {
    console.error('Error fetching template schema:', error);
    throw error;
  }
};
