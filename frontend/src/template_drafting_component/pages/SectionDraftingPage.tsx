/**
 * Section Drafting Page
 * 
 * New drafting flow where users:
 * 1. See tabs for only their selected sections
 * 2. Generate each section separately
 * 3. View Critic validation (confidence score & accuracy)
 * 4. Edit generated content
 * 5. Update via prompt
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
import { UNIVERSAL_SECTIONS } from '../components/constants';
import { toast } from 'react-toastify';
import axios from 'axios';

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
}

export const SectionDraftingPage: React.FC<SectionDraftingPageProps> = ({ draftIdProp, onAssembleComplete, onBack }) => {
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

    // Custom Section State
    const [allSections, setAllSections] = useState<any[]>([]);
    const [showAddSection, setShowAddSection] = useState(false);
    const [newSectionData, setNewSectionData] = useState({ name: '', type: 'clause', prompt: '' });


    // Load draft and section prompts
    useEffect(() => {
        const loadDraftData = async () => {
            if (!draftId) return;

            try {
                setLoading(true);

                // Get section prompts to determine which sections are active
                const prompts = await draftApi.getSectionPrompts(draftId);

                // Merge Universal and Custom sections
                const mergedSections = mergeSections(UNIVERSAL_SECTIONS, prompts);
                setAllSections(mergedSections);

                const activeSections = mergedSections.map(s => s.id);
                setSelectedSections(activeSections);

                if (activeSections.length > 0 && !activeTab) {
                    setActiveTab(activeSections[0]);
                }

                // Initialize section states
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

                // Load existing section content if any
                const token = localStorage.getItem('token');
                const sectionsResponse = await axios.get(
                    `http://localhost:8000/api/drafts/${draftId}/sections`,
                    {
                        headers: {
                            'Authorization': `Bearer ${token}`
                        }
                    }
                );

                if (sectionsResponse.data.success && sectionsResponse.data.sections) {
                    const updatedStates = { ...initialStates };
                    sectionsResponse.data.sections.forEach((section: any) => {
                        if (updatedStates[section.section_key]) {
                            updatedStates[section.section_key] = {
                                ...updatedStates[section.section_key],
                                content: section.content_html || '',
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

    // Helper: Merge Universal and Custom (Fix: Maintain sort order from DB)
    const mergeSections = (universal: any[], dbPrompts: any[]) => {
        const universalIds = new Set(universal.map(u => u.id));
        const dbMap = new Map(dbPrompts.map(p => [p.section_id, p]));

        // 1. Process Universal Sections
        const activeUniversal = universal.map((u, index) => {
            const dbEntry = dbMap.get(u.id);
            if (dbEntry && dbEntry.is_deleted) return null;
            return {
                ...u,
                // If user customized the prompt, use it. Otherwise use universal default.
                defaultPrompt: dbEntry?.custom_prompt || u.defaultPrompt,
                isCustom: false,
                sortOrder: dbEntry?.sort_order ?? index // Default to index to keep default order if no DB entry
            };
        }).filter(Boolean);

        // 2. Process Custom Sections (in DB but not in Universal)
        const customSections = dbPrompts
            .filter(p => !universalIds.has(p.section_id) && !p.is_deleted)
            .map(p => ({
                id: p.section_id,
                title: p.section_name || 'Custom Section',
                description: p.section_type || 'Custom',
                // Important: Ensure specific instruction is passed. If custom_prompt empty, fallback to a strong generic instruction.
                defaultPrompt: p.custom_prompt || `Generate the content for the section titled '${p.section_name || 'Custom Section'}'. Ensure it is professionally drafted, legally sound, and formatted in clean HTML.`,
                isCustom: true,
                sortOrder: p.sort_order ?? 999
            }));

        // 3. Combine and Sort
        // FIX: The backend sort_order is the source of truth for ALL sections (both universal and custom)
        // If a Universal section has no sort_order (never moved), it should probably come before customs with 999?
        // But if user reordered some, we rely on the numeric values.
        return [...activeUniversal, ...customSections].sort((a: any, b: any) => {
            // Treat undefined/null as max to push to bottom if needed, but above logic defaults to index or 999.
            return a.sortOrder - b.sortOrder;
        });
    };

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

            // Refresh
            const prompts = await draftApi.getSectionPrompts(draftId);
            const merged = mergeSections(UNIVERSAL_SECTIONS, prompts);
            setAllSections(merged);
            setSelectedSections(merged.map(s => s.id));

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

            // Refresh list
            const prompts = await draftApi.getSectionPrompts(draftId);
            const merged = mergeSections(UNIVERSAL_SECTIONS, prompts);
            setAllSections(merged);
            setSelectedSections(merged.map(s => s.id));

            if (activeTab === sectionId && merged.length > 0) {
                setActiveTab(merged[0].id);
            }
        } catch (err) {
            toast.error('Failed to remove section');
        }
    };


    const handleGenerateSection = async (sectionId: string) => {
        if (!draftId) return;

        setSectionStates(prev => ({
            ...prev,
            [sectionId]: { ...prev[sectionId], isGenerating: true }
        }));

        try {
            // Fix: Find section in allSections (which includes custom ones) instead of just UNIVERSAL_SECTIONS
            const section = allSections.find(s => s.id === sectionId);
            const token = localStorage.getItem('token');

            const response = await axios.post(
                `http://localhost:8000/api/drafts/${draftId}/sections/${sectionId}/generate`,
                {
                    section_prompt: section?.defaultPrompt,
                    auto_validate: true
                },
                {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                }
            );

            if (response.data.success) {
                const { version, critic_review } = response.data;

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
            console.error('Failed to generate section:', error);
            toast.error('Failed to generate section');
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
            const token = localStorage.getItem('token');
            const currentState = sectionStates[activeTab];

            if (currentState.versionId) {
                await axios.put(
                    `http://localhost:8000/api/drafts/${draftId}/sections/${activeTab}/versions/${currentState.versionId}`,
                    {
                        content_html: htmlContent
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${token}`
                        }
                    }
                );
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
            const token = localStorage.getItem('token');

            // Generate RAG query automatically to fetch context from uploaded files/cases
            const section = allSections.find(s => s.id === activeTab);
            const sectionName = section?.title || activeTab;
            const autoRagQuery = `Provide all relevant factual details, case information, and context for updating the section: ${sectionName}. User request: ${updatePrompt}`;

            const response = await axios.post(
                `http://localhost:8000/api/drafts/${draftId}/sections/${activeTab}/refine`,
                {
                    user_feedback: updatePrompt,
                    rag_query: autoRagQuery, // Send RAG query to fetch context
                    auto_validate: true
                },
                {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                }
            );

            if (response.data.success) {
                const { version, critic_review } = response.data;

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
            // Call assembler agent
            const response = await draftApi.assemble(draftId, selectedSections);

            if (response.success) {
                toast.success('Document assembled successfully!');

                if (onAssembleComplete) {
                    onAssembleComplete();
                } else {
                    // Navigate to preview or final document
                    navigate(`/template-drafting/drafts/${draftId}/preview`);
                }
            }
        } catch (error) {
            console.error('Failed to assemble document:', error);
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
                                                            className="w-full min-h-[400px] px-4 py-3 border-2 border-blue-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-[#21C1B6] focus:outline-none prose max-w-none bg-white"
                                                            style={{
                                                                maxHeight: '600px',
                                                                overflowY: 'auto'
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
                                                    <div
                                                        className="prose max-w-none bg-white border border-gray-200 rounded-lg p-6"
                                                        dangerouslySetInnerHTML={{ __html: currentSection.content }}
                                                    />
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
                            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-[#21C1B6] to-[#1AA49B] text-white rounded-xl font-bold hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
