/**
 * Template Drafting Component - Draft API Service
 */

import { api } from './api';
import type {
    DraftsResponse,
    DraftResponse,
    CreateDraftRequest,
    CreateDraftResponse,
    UpdateFieldsRequest,
    UpdateFieldsResponse,
    VersionHistoryResponse,
    UndoRedoResponse
} from '../types';

export const draftApi = {
    /**
     * List all user's drafts
     */
    list: async (): Promise<DraftsResponse> => {
        const response = await api.get<DraftsResponse>('/drafts');
        return response.data;
    },

    /**
     * Create new draft from template
     */
    create: async (data: CreateDraftRequest): Promise<CreateDraftResponse> => {
        const response = await api.post<CreateDraftResponse>('/drafts', data);
        return response.data;
    },

    /**
     * Get draft by ID with current state (all blocks)
     */
    getById: async (draftId: string): Promise<DraftResponse> => {
        const response = await api.get<DraftResponse>(`/drafts/${draftId}`);
        return response.data;
    },

    /**
     * Update draft form fields (creates new version)
     */
    updateFields: async (
        draftId: string,
        fields: Record<string, string | number | null>
    ): Promise<UpdateFieldsResponse> => {
        const response = await api.put<UpdateFieldsResponse>(
            `/drafts/${draftId}/fields`,
            { fields }
        );
        return response.data;
    },

    /**
     * Update draft title
     */
    updateTitle: async (draftId: string, title: string): Promise<{ success: boolean }> => {
        const response = await api.put(`/drafts/${draftId}/title`, { title });
        return response.data;
    },

    /**
     * Delete draft (soft delete)
     */
    delete: async (draftId: string): Promise<{ success: boolean; message: string }> => {
        const response = await api.delete(`/drafts/${draftId}`);
        return response.data;
    },

    /**
     * Undo last action
     */
    undo: async (draftId: string): Promise<UndoRedoResponse> => {
        const response = await api.post<UndoRedoResponse>(`/drafts/${draftId}/undo`);
        return response.data;
    },

    /**
     * Redo undone action
     */
    redo: async (draftId: string): Promise<UndoRedoResponse> => {
        const response = await api.post<UndoRedoResponse>(`/drafts/${draftId}/redo`);
        return response.data;
    },

    /**
     * Get version history
     */
    getVersionHistory: async (draftId: string): Promise<VersionHistoryResponse> => {
        const response = await api.get<VersionHistoryResponse>(`/drafts/${draftId}/versions`);
        return response.data;
    },

    /**
     * Restore to specific version
     */
    restoreVersion: async (
        draftId: string,
        versionId: string
    ): Promise<{ success: boolean; versionId: string; versionNo: number }> => {
        const response = await api.post(`/drafts/${draftId}/versions/${versionId}/restore`);
        return response.data;
    },

    /**
     * Get HTML preview for draft
     */
    getPreview: async (draftId: string): Promise<{ html: string; versionId: string; renderId: string }> => {
        const response = await api.get<{ html: string; versionId: string; renderId: string }>(`/drafts/${draftId}/preview`);
        return response.data;
    },

    /**
     * Get section prompts for draft
     */
    getSectionPrompts: async (draftId: string): Promise<any[]> => {
        const response = await api.get<{ success: boolean; prompts: any[] }>(`/drafts/${draftId}/sections/prompts`);
        return response.data.prompts;
    },

    /**
     * Update section prompt
     */
    saveSectionPrompt: async (draftId: string, sectionId: string, data: { customPrompt?: string; isDeleted?: boolean; detailLevel?: string; language?: string; sectionName?: string; sectionType?: string; sortOrder?: number }): Promise<any> => {
        const payload = {
            sectionId,
            ...data
        };
        const response = await api.post(`/drafts/${draftId}/sections/prompts`, payload);
        return response.data;
    },

    saveSectionOrder: async (draftId: string, sectionIds: string[]): Promise<any> => {
        const response = await api.post(`/drafts/${draftId}/sections/order`, { sectionIds });
        return response.data;
    },

    /**
     * Assemble final document
     */
    assemble: async (draftId: string, sectionIds: string[]): Promise<{ success: boolean; final_document: string; template_css?: string }> => {
        const response = await api.post<{ success: boolean; final_document: string; template_css?: string }>(
            `/drafts/${draftId}/assemble`,
            { section_ids: sectionIds }
        );
        return response.data;
    }
};
