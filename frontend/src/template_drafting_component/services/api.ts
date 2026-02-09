/**
 * Template Drafting Component - API Client
 * Base configuration for all API calls
 */

/// <reference path="../vite-env.d.ts" />

import axios, { AxiosInstance, AxiosError } from 'axios';
import { Logger } from '../utils/logger';

// API Base URL - uses gateway routing
// const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

// Gateway routes /api/drafting-templates/* to drafting-template-service
// The service has endpoints like /api/templates, /api/drafts
// Full path: {gateway}/api/drafting-templates/api/templates
// export const DRAFTING_API_BASE = `${API_BASE}/api/drafting-templates/api`;

// DIRECT SERVICE ACCESS (Bypassing Gateway)
const API_BASE = 'http://localhost:8000';
export const DRAFTING_API_BASE = `${API_BASE}/api`;

/**
 * Create axios instance with auth and error handling
 */
export const createApiClient = (): AxiosInstance => {
    const client = axios.create({
        baseURL: DRAFTING_API_BASE,
        timeout: 120000,
        headers: {
            'Content-Type': 'application/json'
        }
    });

    // Auth interceptor - add JWT token
    client.interceptors.request.use(
        (config) => {
            const token = localStorage.getItem('token');
            if (token) {
                config.headers.Authorization = `Bearer ${token}`;
            }
            return config;
        },
        (error) => {
            Logger.error('API_REQUEST_ERROR', { error: error.message });
            return Promise.reject(error);
        }
    );

    // Response interceptor - handle errors
    client.interceptors.response.use(
        (response) => response,
        (error: AxiosError) => {
            const errorData = error.response?.data as any;

            Logger.error('API_RESPONSE_ERROR', {
                url: error.config?.url,
                method: error.config?.method,
                status: error.response?.status,
                code: errorData?.code,
                message: errorData?.message || error.message
            });

            return Promise.reject(error);
        }
    );

    return client;
};

// Singleton instance
export const api = createApiClient();

/**
 * Helper: Extract error message from API error
 */
export const getErrorMessage = (error: unknown): string => {
    if (axios.isAxiosError(error)) {
        const data = error.response?.data as any;
        return data?.message || data?.error || error.message;
    }
    if (error instanceof Error) {
        return error.message;
    }
    return 'An unexpected error occurred';
};

/**
 * Helper: Extract error code from API error
 */
export const getErrorCode = (error: unknown): string | undefined => {
    if (axios.isAxiosError(error)) {
        const data = error.response?.data as any;
        return data?.code;
    }
    return undefined;
};
