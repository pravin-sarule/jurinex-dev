/**
 * Template Builder API — Claude-powered endpoints
 *
 *  POST /analysis/get-questions      → Claude returns document-specific questions
 *  POST /analysis/generate-template  → Claude drafts the full legal template
 *  POST /analysis/save-generated     → Saves to user's custom library
 */

import axios, { AxiosError } from 'axios';
import { TEMPLATE_ANALYZER_API_BASE } from '../config/apiConfig.js';
import type {
  ExtractedField,
  ParsedSection,
  GenerationMetadata,
  TemplateRequirements,
} from './templateBuilderStore';

// ── Auth helpers ──────────────────────────────────────────────────────────────

function getAuthToken(): string | null {
  return (
    localStorage.getItem('token') ||
    localStorage.getItem('access_token') ||
    localStorage.getItem('auth_token') ||
    localStorage.getItem('authToken') ||
    null
  );
}

function getUserId(): string | null {
  try {
    const userStr = localStorage.getItem('user') || localStorage.getItem('userInfo');
    if (userStr) {
      const parsed = JSON.parse(userStr);
      const id = parsed?.id ?? parsed?.userId ?? parsed?.user_id;
      if (id != null) return String(id);
    }
    const token = getAuthToken();
    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1] || '{}'));
      const id = payload?.id ?? payload?.userId ?? payload?.user_id ?? payload?.sub;
      if (id != null) return String(id);
    }
  } catch {
    // ignore
  }
  return null;
}

function normalizeBase(base: string): string {
  const t = String(base || '').replace(/\/+$/, '');
  if (!t) return '/analysis';
  return t.endsWith('/analysis') ? t : `${t}/analysis`;
}

function extractError(error: unknown): string {
  if (error instanceof AxiosError && error.response?.data) {
    const d = error.response.data as { detail?: string | string[] };
    if (typeof d.detail === 'string') return d.detail;
    if (Array.isArray(d.detail) && d.detail.length) return String(d.detail[0]);
  }
  return error instanceof Error ? error.message : 'Request failed';
}

// ── Axios client ──────────────────────────────────────────────────────────────

const client = axios.create({
  baseURL: normalizeBase(TEMPLATE_ANALYZER_API_BASE),
  timeout: 180_000, // 3 min — Claude can take time for large templates
});

client.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const userId = getUserId();
  if (userId) config.headers['X-User-Id'] = userId;
  return config;
});

// ── Response types ────────────────────────────────────────────────────────────

export interface GetQuestionsResponse {
  success: boolean;
  document_type: string;
  questions: Array<Record<string, unknown>>;
}

export interface GenerateTemplateResponse {
  success: boolean;
  templateText: string;
  fields: ExtractedField[];
  sections: ParsedSection[];
  metadata: GenerationMetadata;
}

export interface SaveGeneratedResponse {
  success: boolean;
  templateId: string;
  message: string;
}

// ── API methods ───────────────────────────────────────────────────────────────

export const templateBuilderApi = {
  /**
   * Legacy dynamic-question endpoint. Kept for backward compatibility.
   */
  getQuestions: async (documentType: string): Promise<GetQuestionsResponse> => {
    try {
      const res = await client.post<GetQuestionsResponse>('/get-questions', {
        document_type: documentType,
      });
      return res.data;
    } catch (error) {
      throw new Error(extractError(error));
    }
  },

  /**
   * Send structured template requirements → AI drafts the complete legal template.
   */
  generateTemplate: async (payload: {
    requirements: TemplateRequirements;
  }): Promise<GenerateTemplateResponse> => {
    try {
      const { requirements } = payload;
      const entries = [
        ['Document Type', requirements.subjectLabel || requirements.subject],
        ['Category', requirements.category],
        ['Custom Description', requirements.customDescription],
        ['Property Type', requirements.propertyType],
        ['Party Type', requirements.partyType],
        ['Value Range', requirements.valueRange],
        ['Court', requirements.court],
        ['Dispute Nature', requirements.disputeNature],
        ['Opposing Party', requirements.opposingParty],
        ['Organization Type', requirements.orgType],
        ['Trust Purpose', requirements.trustPurpose],
        ['Corpus Size', requirements.corpusSize],
        ['Audience Type', requirements.audienceType],
        ['Personal Law', requirements.personalLaw],
        ['Urgency', requirements.urgency],
        ['Detail Level', requirements.detailLevel],
        ['Emphasis', requirements.emphasis],
        ['Schedule Preference', requirements.schedulePreference],
        ['Special Clauses', requirements.specialClauses.join(', ')],
        ['Additional Notes', requirements.freeText],
      ].filter(([, value]) => Boolean(value));

      const questions = entries.map(([label], index) => ({
        id: `req_${index + 1}`,
        question: label,
        type: 'text',
      }));

      const answers = Object.fromEntries(
        entries.map(([_, value], index) => [`req_${index + 1}`, String(value)])
      );

      const res = await client.post<GenerateTemplateResponse>('/generate-template', {
        document_type: requirements.subjectLabel || requirements.subject || 'Legal Template',
        answers,
        questions,
        jurisdiction: requirements.jurisdiction || 'India',
        language: requirements.language || 'English',
      });
      return res.data;
    } catch (error) {
      throw new Error(extractError(error));
    }
  },

  /**
   * Save the reviewed template to the user's custom library.
   */
  saveGeneratedTemplate: async (payload: {
    templateText: string;
    fields: ExtractedField[];
    sections: ParsedSection[];
    metadata: GenerationMetadata;
    requirements: Record<string, unknown>;
  }): Promise<SaveGeneratedResponse> => {
    try {
      const res = await client.post<SaveGeneratedResponse>('/save-generated', payload);
      return res.data;
    } catch (error) {
      throw new Error(extractError(error));
    }
  },
};
