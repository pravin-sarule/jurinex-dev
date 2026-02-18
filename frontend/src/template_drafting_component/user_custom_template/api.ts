/**
 * Template Drafting Component - Custom Template API Service
 * Handles interactions with the User Template Analyzer Agent (via Gateway).
 *
 * Backend: Template Analyzer Agent (e.g. port 5017)
 *   - GET  /analysis/templates          → list user templates (requires x-user-id from Gateway)
 *   - POST /analysis/upload-template    → Form: name, category, subcategory?, description?, file, image?
 *   - GET  /analysis/template/{id}      → template details
 *   - PUT  /analysis/template/{id}      → JSON: template_name?, description?, category?, sub_category?
 *   - DELETE /analysis/template/{id}
 *
 * Gateway: /api/template-analysis/* → proxies to Analyzer with x-user-id from JWT.
 * Frontend must send Authorization: Bearer <token> so Gateway can inject x-user-id.
 */

import axios, { AxiosError } from 'axios';
import { Logger } from '../utils/logger';
import type { TemplateListItem } from '../types';
import type { UploadTemplateResponse } from './types';

const GATEWAY_BASE =
    (import.meta.env?.VITE_APP_GATEWAY_URL as string) ||
    (import.meta.env?.VITE_APP_API_URL as string) ||
    'http://localhost:5000';
const ANALYZER_API_BASE = `${GATEWAY_BASE}/api/template-analysis`;

function getAuthToken(): string | null {
    return (
        localStorage.getItem('token') ||
        localStorage.getItem('access_token') ||
        localStorage.getItem('auth_token')
    );
}

function getMessageFromError(error: unknown): string {
    if (error instanceof AxiosError && error.response?.data) {
        const d = error.response.data as { detail?: string | string[] };
        if (typeof d.detail === 'string') return d.detail;
        if (Array.isArray(d.detail) && d.detail.length) return d.detail[0];
    }
    return error instanceof Error ? error.message : 'Request failed';
}

const analyzerClient = axios.create({
    baseURL: ANALYZER_API_BASE,
    timeout: 300000,
});

analyzerClient.interceptors.request.use(
    (config) => {
        const token = getAuthToken();
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        console.log(
            `[Custom Template API] ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`,
            { hasAuth: !!token }
        );
        return config;
    },
    (error) => Promise.reject(error)
);

analyzerClient.interceptors.response.use(
    (response) => {
        const bodyPreview = Array.isArray(response.data)
            ? `(${response.data.length} items)`
            : response.data != null
                ? '(has body)'
                : '';
        console.log(
            `[Custom Template API] ${response.status} ${response.config.url} ${bodyPreview}`
        );
        return response;
    },
    (error) => {
        console.error('[Custom Template API] Request failed:', error.config?.url, error.response?.status, error.message);
        return Promise.reject(error);
    }
);

export const customTemplateApi = {
    /**
     * POST /upload-template
     * Do not set Content-Type so axios sets multipart/form-data with boundary.
     */
    uploadTemplate: async (formData: FormData): Promise<UploadTemplateResponse> => {
        const name = formData.get('name') ?? '(unnamed)';
        console.log('[Custom Template API] uploadTemplate: sending POST /upload-template', { name });
        try {
            const response = await analyzerClient.post('/upload-template', formData);
            console.log('[Custom Template API] uploadTemplate: success', response.data);
            return response.data;
        } catch (error) {
            Logger.error('CUSTOM_TEMPLATE_UPLOAD_ERROR', { error });
            console.error('[Custom Template API] uploadTemplate: error', error);
            throw new Error(getMessageFromError(error));
        }
    },

    /**
     * GET /templates → array of user templates (Template Analyzer GET /analysis/templates).
     * Gateway: GET /api/template-analysis/templates. Requires Authorization so Gateway can send x-user-id.
     * @param finalizedOnly When true, only templates with status=finalized (for draft section).
     */
    getUserTemplates: async (finalizedOnly = false): Promise<TemplateListItem[]> => {
        const params = finalizedOnly ? { status: 'finalized' } : {};
        console.log('[Custom Template API] getUserTemplates: sending GET /templates', params);
        try {
            const response = await analyzerClient.get('/templates', { params });
            const list = Array.isArray(response.data) ? response.data : [];
            return list.map((item: Record<string, unknown>) => ({
                id: (item.template_id ?? item.id)?.toString() ?? '',
                name: String((item.template_name ?? item.name) ?? 'Untitled Template'),
                description: (item.description ?? '') as string,
                category: (item.category ?? 'Uncategorized') as string,
                isActive: item.status === 'active',
                createdAt: (item.created_at ?? new Date().toISOString()) as string,
                imageUrl: item.image_url as string | undefined,
            }));
        } catch (error) {
            Logger.error('CUSTOM_TEMPLATE_LIST_ERROR', { error });
            throw new Error(getMessageFromError(error));
        }
    },

    /**
     * GET /template/{template_id} → template details with sections and fields (API_DOCUMENTATION.md).
     * Use when you need template + sections + fields from the Template Analyzer (e.g. edit modal).
     * For drafting form fields/sections, use agent-draft-service getTemplate(templateId) which reads from same DB.
     */
    getTemplateDetails: async (templateId: string): Promise<{
        template: Record<string, unknown>;
        sections: unknown[];
        fields: Record<string, unknown>;
    }> => {
        try {
            const response = await analyzerClient.get(`/template/${templateId}`);
            const data = response.data as { template?: unknown; sections?: unknown[]; fields?: Record<string, unknown> };
            return {
                template: (data.template as Record<string, unknown>) ?? {},
                sections: Array.isArray(data.sections) ? data.sections : [],
                fields: data.fields ?? {},
            };
        } catch (error) {
            Logger.error('CUSTOM_TEMPLATE_DETAILS_ERROR', { error });
            throw new Error(getMessageFromError(error));
        }
    },

    /**
     * PUT /template/{template_id} with JSON body (template_name, description, category, sub_category, status).
     * Use status: 'finalized' in template section to make template available in draft section.
     */
    updateTemplate: async (
        templateId: string,
        data: { name?: string; description?: string; category?: string; status?: 'active' | 'finalized' }
    ): Promise<void> => {
        try {
            await analyzerClient.put(`/template/${templateId}`, {
                template_name: data.name,
                description: data.description,
                category: data.category,
                status: data.status,
            });
        } catch (error) {
            Logger.error('CUSTOM_TEMPLATE_UPDATE_ERROR', { error });
            throw new Error(getMessageFromError(error));
        }
    },

    /**
     * DELETE /template/{template_id}
     */
    deleteTemplate: async (templateId: string): Promise<void> => {
        try {
            await analyzerClient.delete(`/template/${templateId}`);
        } catch (error) {
            Logger.error('CUSTOM_TEMPLATE_DELETE_ERROR', { error });
            throw new Error(getMessageFromError(error));
        }
    },
};
