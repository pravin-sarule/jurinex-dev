/**
 * Section Drafting Page
 *
 * Advanced drafting flow: sections come ONLY from user-fetched and selected or added
 * sections (dt_draft_section_prompts). Supports custom sections, reordering, and CRUD.
 *
 * 1. Load sections from dt_draft_section_prompts (no full universal catalog)
 * 2. Generate each section separately
 * 3. View Critic validation (confidence score & accuracy)
 * 4. Edit generated content, update via prompt
 * 5. Reorder, add, delete sections (CRUD)
 * 6. Assemble all sections into final document
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ArrowLeftIcon,
    CheckCircleIcon,
    XCircleIcon,
    SparklesIcon,
    PencilIcon,
    DocumentCheckIcon,
    ExclamationTriangleIcon,
    PlusIcon,
    ArrowUpIcon,
    ArrowDownIcon,
    TrashIcon
} from '@heroicons/react/24/outline';
import { draftApi } from '../services';
import { getUniversalSections } from '../services/universalSectionsApi';
import { getErrorMessage, isTimeoutError } from '../services/api';
import type { UniversalSection } from '../components/constants';
import { toast } from 'react-toastify';

interface SectionState {
    sectionId: string;
    content: string;
    isGenerated: boolean;
    isGenerating: boolean;
    criticReview: {
        status: 'PASS' | 'FAIL' | null;
        score: number;
        feedback: string;
        issues: string[];
        suggestions: string[];
        sources?: string[];
    } | null;
    versionId: string | null;
}

interface SectionDraftingPageProps {
    draftIdProp?: string;
    onAssembleComplete?: () => void;
    onBack?: () => void;
    addActivity?: (agent: string, action: string, status?: 'in-progress' | 'completed' | 'pending') => void;
}

export const SectionDraftingPage: React.FC<SectionDraftingPageProps> = ({ draftIdProp, onAssembleComplete, onBack, addActivity }) => {
    const params = useParams<{ draftId: string }>();
    const draftId = draftIdProp || params.draftId;
    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);
    const [selectedSections, setSelectedSections] = useState<string[]>([]);
    const [activeTab, setActiveTab] = useState<string>('');
    const [sectionStates, setSectionStates] = useState<Record<string, SectionState>>({});
    const [isEditing, setIsEditing] = useState(false);
    const [editContent, setEditContent] = useState('');
    const [updatePrompt, setUpdatePrompt] = useState('');
    const [showPromptInput, setShowPromptInput] = useState(false);
    const [isAssembling, setIsAssembling] = useState(false);
    const [draftTitle, setDraftTitle] = useState('');

    // Universal list: used to mark isCustom and to resolve display names when section_name is empty
    const [universalSectionIds, setUniversalSectionIds] = useState<Set<string>>(new Set());
    const [universalSectionsMap, setUniversalSectionsMap] = useState<Map<string, { title: string; description: string; defaultPrompt: string }>>(new Map());
    // Sections for this draft: only from dt_draft_section_prompts (user selected + added)
    const [allSections, setAllSections] = useState<any[]>([]);
    const [showAddSection, setShowAddSection] = useState(false);
    const [newSectionData, setNewSectionData] = useState({ name: '', type: 'clause', prompt: '' });


    // Build section list from dt_draft_section_prompts only (user selected + added sections)
    const promptsToSections = (
        prompts: any[],
        universalIds: Set<string>,
        universalMap: Map<string, { title: string; description: string; defaultPrompt: string }>
    ): any[] => {
        return prompts
            .filter((p: any) => !p.is_deleted)
            .map((p: any) => {
                const isCustom = !universalIds.has(p.section_id);
                const resolvedTitle = p.section_name?.trim() || universalMap.get(p.section_id)?.title || (isCustom ? 'Custom Section' : 'Untitled Section');
                const resolvedDesc = p.section_type?.trim() || universalMap.get(p.section_id)?.description || (isCustom ? 'Custom' : 'Section');
                const universalEntry = universalMap.get(p.section_id);
                // Prefer real prompt from section_prompts (default_prompt). If custom_prompt equals section_intro, show default_prompt instead.
                const customTrim = p.custom_prompt?.trim();
                const introTrim = p.section_intro?.trim();
                const useCustom = customTrim && customTrim !== introTrim;
                const defaultPrompt = useCustom ? customTrim : (p.default_prompt?.trim()) || (isCustom
                    ? `Generate the content for the section titled '${resolvedTitle}'. Ensure it is professionally drafted, legally sound, and formatted in clean HTML.`
                    : (universalEntry?.defaultPrompt || ''));
                return {
                    id: p.section_id,
                    title: resolvedTitle,
                    description: resolvedDesc,
                    defaultPrompt,
                    isCustom,
                    sortOrder: p.sort_order ?? 999
                };
            })
            .sort((a: any, b: any) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
    };

    // Load draft: sections ONLY from dt_draft_section_prompts (user-fetched, selected, or added)
    useEffect(() => {
        const loadDraftData = async () => {
            if (!draftId) return;

            try {
                setLoading(true);

                // Prompts = source of truth for this draft's sections. Universal only to mark isCustom.
                const [universalSections, prompts] = await Promise.all([
                    getUniversalSections(),
                    draftApi.getSectionPrompts(draftId),
                ]);

                const universalIds = new Set((universalSections || []).map((u: UniversalSection) => u.id));
                const universalMap = new Map((universalSections || []).map((u: UniversalSection) => [u.id, { title: u.title || '', description: u.description || '', defaultPrompt: u.defaultPrompt || '' }]));
                setUniversalSectionIds(universalIds);
                setUniversalSectionsMap(universalMap);

                const sections = Array.isArray(prompts) ? promptsToSections(prompts, universalIds, universalMap) : [];
                setAllSections(sections);

                const activeSections = sections.map((s: any) => s.id);
                setSelectedSections(activeSections);

                if (activeSections.length > 0 && !activeTab) {
                    setActiveTab(activeSections[0]);
                }

                const initialStates: Record<string, SectionState> = {};
                activeSections.forEach((sectionId: string) => {
                    initialStates[sectionId] = {
                        sectionId,
                        content: '',
                        isGenerated: false,
                        isGenerating: false,
                        criticReview: null,
                        versionId: null
                    };
                });
                setSectionStates(initialStates);

                const sectionsResponse = await draftApi.getSections(draftId);

                if (sectionsResponse.success && sectionsResponse.sections) {
                    const updatedStates = { ...initialStates };
                    const idByLowerKey = new Map<string, string>();
                    Object.keys(initialStates).forEach(id => {
                        const lower = id.toLowerCase();
                        idByLowerKey.set(lower, id);
                        idByLowerKey.set(lower.replace(/\s+/g, '_'), id);
                    });
                    sectionsResponse.sections.forEach((section: any) => {
                        const sk = (section.section_key || '').trim();
                        const skLower = sk.toLowerCase();
                        const skNorm = skLower.replace(/\s+/g, '_');
                        const targetId = idByLowerKey.get(skLower) ?? idByLowerKey.get(skNorm) ?? (initialStates[sk] ? sk : null);
                        if (targetId) {
                            const html = section.content_html || '';
                            updatedStates[targetId] = {
                                ...updatedStates[targetId],
                                content: html,
                                isGenerated: true,
                                versionId: section.version_id
                            };
                        }
                    });
                    setSectionStates(updatedStates);
                }

            } catch (error) {
                console.error('Failed to load draft data:', error);
                toast.error('Failed to load draft data');
            } finally {
                setLoading(false);
            }
        };

        loadDraftData();
    }, [draftId]);

    const refetchSectionContent = async (sectionId: string) => {
        if (!draftId) return;
        try {
            const res = await draftApi.getSection(draftId, sectionId);
            if (res.success && res.version?.content_html) {
                setSectionStates(prev => ({
                    ...prev,
                    [sectionId]: {
                        ...prev[sectionId],
                        content: res.version.content_html,
                        isGenerated: true,
                        versionId: res.version.version_id
                    }
                }));
            }
        } catch (e) {
            console.warn('Refetch section content failed:', e);
        }
    };

    useEffect(() => {
        if (!activeTab || !draftId) return;
        const state = sectionStates[activeTab];
        if (state?.isGenerated && (!state.content || state.content.trim() === '')) {
            refetchSectionContent(activeTab);
        }
    }, [activeTab, draftId]);

    const handleAddSection = async () => {
        if (!newSectionData.name.trim() || !draftId) return;

        const sectionId = `custom_${Date.now()}`;
        const newSection = {
            sectionId,
            sectionName: newSectionData.name,
            sectionType: newSectionData.type,
            customPrompt: newSectionData.prompt,
            isDeleted: false
            // sortOrder will be handled by backend or next fetch? 
            // Better to assign sortOrder locally:
        };

        try {
            // Save to DB
            await draftApi.saveSectionPrompt(draftId, sectionId, newSection);

            // Refresh from dt_draft_section_prompts only
            const prompts = await draftApi.getSectionPrompts(draftId);
            const sections = Array.isArray(prompts) ? promptsToSections(prompts, universalSectionIds, universalSectionsMap) : [];
            setAllSections(sections);
            setSelectedSections(sections.map((s: any) => s.id));

            // Init state
            setSectionStates(prev => ({
                ...prev,
                [sectionId]: {
                    sectionId,
                    content: '',
                    isGenerated: false,
                    isGenerating: false,
                    criticReview: null,
                    versionId: null
                }
            }));

            setActiveTab(sectionId);
            setShowAddSection(false);
            setNewSectionData({ name: '', type: 'clause', prompt: '' });
            toast.success('Section added');
        } catch (error) {
            console.error(error);
            toast.error('Failed to add section');
        }
    };

    const handleReorder = async (index: number, direction: 'up' | 'down') => {
        if (!draftId) return;
        const newSections = [...allSections];
        const targetIndex = direction === 'up' ? index - 1 : index + 1;

        if (targetIndex < 0 || targetIndex >= newSections.length) return;

        // Swap
        [newSections[index], newSections[targetIndex]] = [newSections[targetIndex], newSections[index]];

        // Update local sortOrders to match index
        newSections.forEach((s, idx) => s.sortOrder = idx);

        setAllSections(newSections);
        setSelectedSections(newSections.map(s => s.id));

        // Save order to backend
        try {
            await draftApi.saveSectionOrder(draftId, newSections.map(s => s.id));
        } catch (err) {
            toast.error('Failed to save order');
        }
    };

    const handleDeleteSection = async (sectionId: string) => {
        if (!draftId || !window.confirm('Are you sure you want to remove this section?')) return;

        try {
            // Mark as deleted in DB
            await draftApi.saveSectionPrompt(draftId, sectionId, { isDeleted: true });

            const prompts = await draftApi.getSectionPrompts(draftId);
            const sections = Array.isArray(prompts) ? promptsToSections(prompts, universalSectionIds, universalSectionsMap) : [];
            setAllSections(sections);
            setSelectedSections(sections.map((s: any) => s.id));

            if (activeTab === sectionId && sections.length > 0) {
                setActiveTab(sections[0].id);
            }
        } catch (err) {
            toast.error('Failed to remove section');
        }
    };


    const POLL_INTERVAL_MS = 15000;
    const POLL_MAX_ATTEMPTS = 20;

    const pollForSectionResult = async (
        draftId: string,
        sectionId: string,
        sectionTitle: string,
        addActivity?: (agent: string, message: string, status: 'in-progress' | 'completed') => void,
        setSectionStates?: React.Dispatch<React.SetStateAction<Record<string, SectionState>>>
    ) => {
        for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
            try {
                const res = await draftApi.getSection(draftId, sectionId);
                const html = res?.version?.content_html;
                if (html != null && String(html).trim().length > 0) {
                    if (setSectionStates) {
                        setSectionStates(prev => ({
                            ...prev,
                            [sectionId]: {
                                ...prev[sectionId],
                                content: html,
                                isGenerated: true,
                                isGenerating: false,
                                versionId: res?.version?.version_id ?? null
                            }
                        }));
                    }
                    toast.success(`Section "${sectionTitle}" is ready (completed in backend).`);
                    if (addActivity) {
                        addActivity('System', `Section "${sectionTitle}" result found.`, 'completed');
                    }
                    return;
                }
            } catch (_) {
                // ignore fetch errors during poll
            }
        }
        if (setSectionStates) {
            setSectionStates(prev => ({
                ...prev,
                [sectionId]: { ...prev[sectionId], isGenerating: false }
            }));
        }
        toast.warning('Generation may still be in progress. Refresh the page to check.');
        if (addActivity) {
            addActivity('System', 'No result yet. Refresh the page to check.', 'completed');
        }
    };

    const handleGenerateSection = async (sectionId: string) => {
        if (!draftId) return;

        const section = allSections.find(s => s.id === sectionId);
        const sectionTitle = section?.title || 'section';

        setSectionStates(prev => ({
            ...prev,
            [sectionId]: { ...prev[sectionId], isGenerating: true }
        }));

        const timeouts: ReturnType<typeof setTimeout>[] = [];
        try {

            if (addActivity) {
                addActivity('Librarian', 'Fetching case chunks via vector search (Gemini embeddings)...', 'in-progress');
                timeouts.push(setTimeout(() => {
                    addActivity('Librarian', 'Retrieved top 80 chunks from case files', 'completed');
                    addActivity('Drafter', 'Sending prompt to Gemini Flash model...', 'in-progress');
                }, 1500));
                timeouts.push(setTimeout(() => {
                    addActivity('Gemini', 'Generating 2-10 pages of legal content...', 'in-progress');
                }, 3500));
                timeouts.push(setTimeout(() => {
                    addActivity('Citation', 'Adding formal references and footnotes...', 'in-progress');
                }, 5500));
                timeouts.push(setTimeout(() => {
                    addActivity('Critic', 'Validating legal logic and accuracy...', 'in-progress');
                }, 7000));
            }

            const response = await draftApi.generateSection(draftId, sectionId, {
                section_prompt: section?.defaultPrompt,
                auto_validate: true
            });

            timeouts.forEach(t => clearTimeout(t));

            if (response.success) {
                const { version, critic_review } = response;

                if (addActivity) {
                    addActivity('Critic', 'Validation complete', 'completed');
                    addActivity('Drafter', `${sectionTitle} drafted and verified.`, 'completed');
                }

                setSectionStates(prev => ({
                    ...prev,
                    [sectionId]: {
                        ...prev[sectionId],
                        content: version.content_html,
                        isGenerated: true,
                        isGenerating: false,
                        versionId: version.version_id,
                        criticReview: critic_review ? {
                            status: critic_review.status,
                            score: critic_review.score,
                            feedback: critic_review.feedback,
                            issues: critic_review.issues || [],
                            suggestions: critic_review.suggestions || [],
                            sources: critic_review.sources || []
                        } : null
                    }
                }));

                toast.success(`Section "${section?.title}" generated successfully!`);
            }
        } catch (error) {
            timeouts.forEach(t => clearTimeout(t));
            if (isTimeoutError(error)) {
                toast.info('Request timed out. Checking backend for result…');
                if (addActivity) {
                    addActivity('System', 'Request timed out. Checking for completed section…', 'in-progress');
                }
                pollForSectionResult(draftId, sectionId, sectionTitle, addActivity, setSectionStates);
                return;
            }
            const message = getErrorMessage(error) || 'Failed to generate section';
            console.error('Failed to generate section:', message, error);
            toast.error(message);
            if (addActivity) {
                addActivity('System', message.length > 60 ? `Failed: ${message.slice(0, 57)}…` : `Failed: ${message}`, 'completed');
            }
            setSectionStates(prev => ({
                ...prev,
                [sectionId]: { ...prev[sectionId], isGenerating: false }
            }));
        }
    };


    const handleEditSection = () => {
        const currentSection = sectionStates[activeTab];
        // Set the HTML content directly for contenteditable editing
        setEditContent(currentSection.content);
        setIsEditing(true);
    };

    const handleSaveEdit = async () => {
        if (!draftId) return;

        try {
            // Use the edited HTML content directly (no conversion needed)
            const htmlContent = editContent;

            // Update local state
        setSectionStates(prev => ({
            ...prev,
            [activeTab]: { ...prev[activeTab], content: htmlContent }
        }));

            // Save to backend
            const currentState = sectionStates[activeTab];

            if (currentState.versionId) {
                await draftApi.updateSectionVersion(draftId, activeTab, currentState.versionId, htmlContent);
            }

            setIsEditing(false);
            toast.success('Content updated successfully');
        } catch (error) {
            console.error('Failed to save edited content:', error);
            toast.error('Failed to save changes');
        }
    };

    const handleUpdateWithPrompt = async () => {
        if (!draftId || !updatePrompt.trim()) return;

        setSectionStates(prev => ({
            ...prev,
            [activeTab]: { ...prev[activeTab], isGenerating: true }
        }));

        try {
            // Generate RAG query automatically to fetch context from uploaded files/cases
            const section = allSections.find(s => s.id === activeTab);
            const sectionName = section?.title || activeTab;
            const autoRagQuery = `Provide all relevant factual details, case information, and context for updating the section: ${sectionName}. User request: ${updatePrompt}`;

            if (addActivity) {
                addActivity('Drafter', `Refining ${sectionName} with feedback...`, 'in-progress');
                addActivity('Gemini', 'Processing refinement prompt...', 'in-progress');
            }

            const response = await draftApi.refineSection(draftId, activeTab, {
                user_feedback: updatePrompt,
                rag_query: autoRagQuery,
                auto_validate: true
            });

            if (response.success) {
                const { version, critic_review } = response;

                if (addActivity) {
                    addActivity('Gemini', 'Refinement complete', 'completed');
                    addActivity('Drafter', `${sectionName} section successfully updated.`, 'completed');
                }

                setSectionStates(prev => ({
                    ...prev,
                    [activeTab]: {
                        ...prev[activeTab],
                        content: version.content_html,
                        isGenerating: false,
                        versionId: version.version_id,
                        criticReview: critic_review ? {
                            status: critic_review.status,
                            score: critic_review.score,
                            feedback: critic_review.feedback,
                            issues: critic_review.issues || [],
                            suggestions: critic_review.suggestions || [],
                            sources: critic_review.sources || []
                        } : null
                    }
                }));

                setUpdatePrompt('');
                setShowPromptInput(false);
                toast.success('Section updated successfully with context!');
            }
        } catch (error) {
            console.error('Failed to update section:', error);
            toast.error('Failed to update section');
            setSectionStates(prev => ({
                ...prev,
                [activeTab]: { ...prev[activeTab], isGenerating: false }
            }));
        }
    };

    const handleAssemble = async () => {
        if (!draftId) return;

        // Check if all sections are generated
        const allGenerated = selectedSections.every(
            sectionId => sectionStates[sectionId]?.isGenerated
        );

        if (!allGenerated) {
            toast.warning('Please generate all sections before assembling');
            return;
        }

        setIsAssembling(true);

        try {
            if (addActivity) {
                addActivity('Assembler', 'Combining sections into final document...', 'in-progress');
                addActivity('Assembler', 'Applying A4 page breaks and template format...', 'in-progress');
            }

            // Call assembler agent
            const response = await draftApi.assemble(draftId, selectedSections);

            if (response.success) {
                if (addActivity) {
                    addActivity('Assembler', 'Document assembly complete. Preparing preview.', 'completed');
                }
                toast.success('Document assembled successfully!');

                // Google Docs opens in the iframe on AssembledPreviewPage (no new tab)
                if (onAssembleComplete) {
                    onAssembleComplete();
                } else {
                    navigate(`/template-drafting/drafts/${draftId}/preview`);
                }
            }
        } catch (error) {
            console.error('Failed to assemble document:', error);
            if (addActivity) {
                addActivity('Assembler', 'Assembly failed. Check logs.', 'completed');
            }
            toast.error('Failed to assemble document');
        } finally {
            setIsAssembling(false);
        }
    };

    if (loading) {
        return (
            <div className={`flex items-center justify-center ${draftIdProp ? 'py-12' : 'min-h-screen bg-gradient-to-b from-slate-50 to-gray-100'}`}>
                <div className={`bg-white rounded-2xl flex flex-col items-center gap-5 ${draftIdProp ? '' : 'shadow-lg border border-gray-200/80 px-8 py-10'}`}>
                    <div className="animate-spin rounded-full h-9 w-9 border-2 border-gray-200 border-t-[#21C1B6]" />
                    <p className="text-sm font-semibold text-gray-600">Loading sections...</p>
                </div>
            </div>
        );
    }

    const currentSection = sectionStates[activeTab];
    // Find config from allSections instead of UNIVERSAL_SECTIONS directly
    const sectionConfig = allSections.find(s => s.id === activeTab);


    return (
        <div className={draftIdProp ? 'w-full' : "min-h-screen bg-gradient-to-b from-slate-50 via-gray-50 to-gray-100"}>
            <div className={`max-w-7xl mx-auto ${draftIdProp ? 'p-10' : 'px-4 sm:px-6 lg:px-8 py-6 sm:py-8'}`}>
                {/* Header - Show if not embedded OR if onBack is provided */}
                {(onBack || !draftIdProp) && (
                    <nav className="mb-6">
                        <button
                            type="button"
                            onClick={onBack ? onBack : () => navigate(`/draft-form/${draftId}`)}
                            className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-[#21C1B6] transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#21C1B6] rounded-lg py-2 px-3 -ml-3 hover:bg-white/80"
                        >
                            <ArrowLeftIcon className="w-4 h-4 text-gray-400" />
                            {onBack ? 'Back to Sections' : 'Back to form'}
                        </button>
                    </nav>
                )}

                {/* Title */}
                <div className="mb-6">
                    <h1 className="text-2xl font-bold text-gray-900">Draft Sections</h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Generate and refine each section separately, then assemble your document
                    </p>
                </div>

                {/* Vertical Layout: Sidebar + Content */}
                <div className="flex gap-6">
                    {/* Left Sidebar - Section List */}
                    <div className="w-80 flex-shrink-0">
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm sticky top-6">
                            <div className="p-4 border-b border-gray-200">
                                <h2 className="text-lg font-bold text-gray-900">Sections</h2>
                                <p className="text-xs text-gray-500 mt-1">
                                    {selectedSections.filter(id => sectionStates[id]?.isGenerated).length} of {selectedSections.length} generated
                                </p>
                            </div>
                            <nav className="p-2 space-y-1 max-h-[calc(100vh-250px)] overflow-y-auto custom-scrollbar" aria-label="Sections">
                                {allSections.map((section, index) => {
                                    const sectionId = section.id;
                                    const state = sectionStates[sectionId];
                                    const isActive = activeTab === sectionId;

                                    return (
                                        <div key={sectionId} className="group relative flex items-center">
                                            <button
                                                onClick={() => setActiveTab(sectionId)}
                                                className={`
                                                    w-full text-left px-4 py-3 text-sm font-medium rounded-lg transition-all pr-12
                                                    ${isActive
                                                        ? 'bg-[#21C1B6] text-white shadow-md'
                                                        : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                                                    }
                                                `}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="truncate">{index + 1}. {section.title.replace(/^\d+\.\s*/, '')}</span>
                                                    {state?.isGenerated && (
                                                        <CheckCircleIcon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-white' : 'text-green-500'}`} />
                                                    )}
                                                </div>
                                            </button>

                                            {/* Reorder/Delete Controls (visible on hover or active) */}
                                            <div className={`absolute right-1 flex flex-col gap-0.5 ${isActive ? 'visible' : 'invisible group-hover:visible'}`}>
                                                <button onClick={(e) => { e.stopPropagation(); handleReorder(index, 'up'); }} className={`p-0.5 rounded hover:bg-black/10 ${isActive ? 'text-white' : 'text-gray-400'}`} disabled={index === 0}>
                                                    <ArrowUpIcon className="w-3 h-3" />
                                                </button>
                                                <button onClick={(e) => { e.stopPropagation(); handleReorder(index, 'down'); }} className={`p-0.5 rounded hover:bg-black/10 ${isActive ? 'text-white' : 'text-gray-400'}`} disabled={index === allSections.length - 1}>
                                                    <ArrowDownIcon className="w-3 h-3" />
                                                </button>
                                                <button onClick={(e) => { e.stopPropagation(); handleDeleteSection(sectionId); }} className={`p-0.5 rounded hover:bg-red-500/20 ${isActive ? 'text-white hover:text-red-100' : 'text-gray-400 hover:text-red-600'}`}>
                                                    <TrashIcon className="w-3 h-3" />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </nav>
                            <div className="p-3 border-t border-gray-200">
                                <button
                                    onClick={() => setShowAddSection(true)}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-[#21C1B6] bg-green-50 rounded-lg hover:bg-green-100 transition-colors border border-green-200"
                                >
                                    <PlusIcon className="w-4 h-4" />
                                    Add Section
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Right Content Area */}
                    <div className="flex-1 min-w-0">
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
                            <div className="p-6">
                                {currentSection && sectionConfig && (
                                    <div className="space-y-6">
                                        {/* Section Header */}
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <h2 className="text-xl font-bold text-gray-900">{selectedSections.indexOf(activeTab) + 1}. {sectionConfig.title.replace(/^\d+\.\s*/, '')}</h2>
                                                <p className="text-sm text-gray-500 mt-1">{sectionConfig.description}</p>
                                            </div>

                                            {!currentSection.isGenerated && (
                                                <button
                                                    onClick={() => handleGenerateSection(activeTab)}
                                                    disabled={currentSection.isGenerating}
                                                    className="inline-flex items-center gap-2 px-4 py-2 bg-[#21C1B6] text-white rounded-lg font-semibold hover:bg-[#1AA49B] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                                                >
                                                    <SparklesIcon className="w-5 h-5" />
                                                    {currentSection.isGenerating ? 'Generating...' : 'Generate Section'}
                                                </button>
                                            )}
                                        </div>

                                        {/* Critic Review */}
                                        {currentSection.criticReview && (
                                            <div className={`rounded-xl border-2 p-4 ${currentSection.criticReview.status === 'PASS'
                                                ? 'border-green-200 bg-green-50'
                                                : 'border-yellow-200 bg-yellow-50'
                                                }`}>
                                                <div className="flex items-start gap-3">
                                                    {currentSection.criticReview.status === 'PASS' ? (
                                                        <CheckCircleIcon className="w-6 h-6 text-green-600 flex-shrink-0" />
                                                    ) : (
                                                        <ExclamationTriangleIcon className="w-6 h-6 text-yellow-600 flex-shrink-0" />
                                                    )}
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-3 mb-2">
                                                            <h3 className="font-bold text-gray-900">
                                                                Validation: {currentSection.criticReview.status}
                                                            </h3>
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-sm font-semibold text-gray-700">
                                                                    Confidence Score:
                                                                </span>
                                                                <span className={`text-lg font-bold ${currentSection.criticReview.score >= 70
                                                                    ? 'text-green-600'
                                                                    : 'text-yellow-600'
                                                                    }`}>
                                                                    {currentSection.criticReview.score}%
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <p className="text-sm text-gray-700 mb-3">
                                                            {currentSection.criticReview.feedback}
                                                        </p>

                                                        {currentSection.criticReview.issues.length > 0 && (
                                                            <div className="mb-3">
                                                                <h4 className="text-xs font-semibold text-gray-700 uppercase mb-1">Issues:</h4>
                                                                <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                                                                    {currentSection.criticReview.issues.map((issue, idx) => (
                                                                        <li key={idx}>{issue}</li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                        )}

                                                        {currentSection.criticReview.suggestions.length > 0 && (
                                                            <div className="mb-3">
                                                                <h4 className="text-xs font-semibold text-gray-700 uppercase mb-1">Suggestions:</h4>
                                                                <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                                                                    {currentSection.criticReview.suggestions.map((suggestion, idx) => (
                                                                        <li key={idx}>{suggestion}</li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                        )}

                                                        {currentSection.criticReview.sources && currentSection.criticReview.sources.length > 0 && (
                                                            <div>
                                                                <h4 className="text-xs font-semibold text-gray-700 uppercase mb-1">Sources Used:</h4>
                                                                <div className="flex flex-wrap gap-2">
                                                                    {currentSection.criticReview.sources.map((source, idx) => (
                                                                        <span key={idx} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200">
                                                                            {source}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Content Display/Edit */}
                                        {currentSection.isGenerated && (
                                            <div className="space-y-4">
                                                <div className="flex items-center justify-between">
                                                    <h3 className="text-lg font-semibold text-gray-900">Generated Content</h3>
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={() => setShowPromptInput(!showPromptInput)}
                                                            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                                                        >
                                                            <SparklesIcon className="w-4 h-4" />
                                                            Update with Prompt
                                                        </button>
                                                        <button
                                                            onClick={handleEditSection}
                                                            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                                                        >
                                                            <PencilIcon className="w-4 h-4" />
                                                            Edit Content
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Prompt Input */}
                                                {showPromptInput && (
                                                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                                                            Update Instructions
                                                        </label>
                                                        <textarea
                                                            value={updatePrompt}
                                                            onChange={(e) => setUpdatePrompt(e.target.value)}
                                                            placeholder="E.g., Make it more formal, add more details about..."
                                                            rows={3}
                                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-[#21C1B6] text-sm"
                                                        />
                                                        <div className="flex justify-end gap-2 mt-2">
                                                            <button
                                                                onClick={() => {
                                                                    setShowPromptInput(false);
                                                                    setUpdatePrompt('');
                                                                }}
                                                                className="px-3 py-1.5 text-sm text-gray-600 hover:bg-white rounded-lg transition-colors"
                                                            >
                                                                Cancel
                                                            </button>
                                                            <button
                                                                onClick={handleUpdateWithPrompt}
                                                                disabled={!updatePrompt.trim() || currentSection.isGenerating}
                                                                className="px-3 py-1.5 text-sm bg-[#21C1B6] text-white rounded-lg hover:bg-[#1AA49B] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                            >
                                                                {currentSection.isGenerating ? 'Updating...' : 'Update'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Content Editor */}
                                                {isEditing ? (
                                                    <div className="space-y-3">
                                                        <div
                                                            contentEditable
                                                            suppressContentEditableWarning
                                                            onInput={(e) => setEditContent(e.currentTarget.innerHTML)}
                                                            dangerouslySetInnerHTML={{ __html: editContent }}
                                                            className="w-full min-h-[400px] px-4 py-3 border-2 border-blue-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-[#21C1B6] focus:outline-none max-w-none bg-white"
                                                            style={{
                                                                maxHeight: '600px',
                                                                overflowY: 'auto',
                                                                fontFamily: '"Times New Roman", Times, serif',
                                                                fontSize: '12pt',
                                                                lineHeight: 1.5,
                                                                padding: '2.54cm'
                                                            }}
                                                        />
                                                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                                                            <p className="text-xs text-blue-700">
                                                                <strong>💡 Tip:</strong> You can edit the content directly above. All formatting, fonts, and styles will be preserved exactly as generated.
                                                            </p>
                                                        </div>
                                                        <div className="flex justify-end gap-2">
                                                            <button
                                                                onClick={() => setIsEditing(false)}
                                                                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                                            >
                                                                Cancel
                                                            </button>
                                                            <button
                                                                onClick={handleSaveEdit}
                                                                className="px-4 py-2 text-sm bg-[#21C1B6] text-white rounded-lg hover:bg-[#1AA49B] transition-colors"
                                                            >
                                                                Save Changes
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="bg-[#dadce0] rounded-lg p-4 flex justify-center">
                                                        <div
                                                            className="section-preview-document bg-white rounded-lg overflow-y-auto border border-gray-100"
                                                            style={{
                                                                minHeight: '297mm',
                                                                padding: '2.54cm',
                                                                fontFamily: '"Times New Roman", Times, serif',
                                                                fontSize: '12pt',
                                                                lineHeight: 1.5,
                                                                width: '210mm',
                                                                maxWidth: '100%',
                                                                boxSizing: 'border-box',
                                                                boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.06)'
                                                            }}
                                                            title="Section preview — A4 (210×297mm)"
                                                            dangerouslySetInnerHTML={{
                                                                __html: currentSection.content && currentSection.content.trim()
                                                                    ? currentSection.content
                                                                    : '<p class="text-gray-400 italic">Content is loading or empty. If this persists, try regenerating the section.</p>'
                                                            }}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Loading State */}
                                        {currentSection.isGenerating && (
                                            <div className="flex items-center justify-center py-12">
                                                <div className="text-center">
                                                    <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-[#21C1B6] mx-auto mb-4" />
                                                    <p className="text-sm font-semibold text-gray-600">Generating section content...</p>
                                                    <p className="text-xs text-gray-500 mt-1">This may take a few moments</p>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Assemble Button */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mt-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-lg font-semibold text-gray-900">Ready to Assemble?</h3>
                            <p className="text-sm text-gray-500 mt-1">
                                {selectedSections.filter(id => sectionStates[id]?.isGenerated).length} of {selectedSections.length} sections generated
                            </p>
                        </div>
                        <button
                            onClick={handleAssemble}
                            disabled={isAssembling || !selectedSections.every(id => sectionStates[id]?.isGenerated)}
                            className="inline-flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-[#21C1B6] to-[#1AA49B] text-white rounded-xl font-bold hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                        >
                            <DocumentCheckIcon className="w-5 h-5" />
                            {isAssembling ? 'Assembling...' : 'Assemble Document'}
                        </button>
                    </div>
                </div>
                {/* Add Section Modal */}
                {showAddSection && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                        <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-fade-in">
                            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
                                <h3 className="text-lg font-bold text-gray-900">Add Custom Section</h3>
                                <button onClick={() => setShowAddSection(false)} className="text-gray-400 hover:text-gray-600">
                                    <XCircleIcon className="w-6 h-6" />
                                </button>
                            </div>
                            <div className="p-6 space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Section Name</label>
                                    <input
                                        type="text"
                                        value={newSectionData.name}
                                        onChange={e => setNewSectionData({ ...newSectionData, name: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-[#21C1B6] focus:border-[#21C1B6]"
                                        placeholder="E.g., Special Provisions"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                                    <select
                                        value={newSectionData.type}
                                        onChange={e => setNewSectionData({ ...newSectionData, type: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-[#21C1B6] focus:border-[#21C1B6]"
                                    >
                                        <option value="clause">Clause</option>
                                        <option value="list">List</option>
                                        <option value="text">Text Block</option>
                                        <option value="definitions">Definitions</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Instruction Prompt</label>
                                    <textarea
                                        value={newSectionData.prompt}
                                        onChange={e => setNewSectionData({ ...newSectionData, prompt: e.target.value })}
                                        rows={3}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-[#21C1B6] focus:border-[#21C1B6]"
                                        placeholder="Describe what should be in this section..."
                                    />
                                </div>
                            </div>
                            <div className="px-6 py-4 bg-gray-50 flex justify-end gap-3">
                                <button
                                    onClick={() => setShowAddSection(false)}
                                    className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-white rounded-lg border border-transparent hover:border-gray-200 transition-all"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleAddSection}
                                    disabled={!newSectionData.name.trim()}
                                    className="px-4 py-2 text-sm font-medium text-white bg-[#21C1B6] hover:bg-[#1AA49B] rounded-lg disabled:opacity-50"
                                >
                                    Add Section
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
