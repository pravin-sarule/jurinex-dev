import React, { useState, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';
import { Reorder } from "framer-motion";
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowUpTrayIcon,
  DocumentTextIcon,
  Squares2X2Icon,
  ArrowLeftIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  PencilIcon,
  ClipboardDocumentIcon,
  XMarkIcon,
  DocumentCheckIcon,
  PlusIcon
} from '@heroicons/react/24/outline';
import {
  getDraft,
  updateDraftFields,
  attachCaseToDraft,
  uploadDocumentForDraft,
  setUploadedFileNameInDraft,
  linkFileToDraft,
  renameDraft
} from '../services/draftFormApi';
import documentApi from '../services/documentApi';
import { toast } from 'react-toastify';
import { UNIVERSAL_SECTIONS } from '../template_drafting_component/components/constants';
import { draftApi } from '../template_drafting_component/services';
import { TEMPLATE_DRAFTING_ROUTES } from '../template_drafting_component/routes'
import { SectionDraftingPage } from '../template_drafting_component/pages/SectionDraftingPage';
import { AssembledPreviewPage } from '../template_drafting_component/pages/AssembledPreviewPage';
import StepProgress from '../components/StepProgress/StepProgress';

const DRAFT_STEPS = [
  { label: 'Upload / Case', icon: ArrowUpTrayIcon },
  { label: 'Form fields', icon: DocumentTextIcon },
  { label: 'Template sections', icon: Squares2X2Icon },
  { label: 'Drafting', icon: PencilIcon },
  { label: 'Preview', icon: DocumentCheckIcon }
];

const AUTO_SAVE_DELAY_MS = 1500;

// Indian Languages for draft generation
const INDIAN_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'Hindi (हिंदी)' },
  { code: 'bn', name: 'Bengali (বাংলা)' },
  { code: 'te', name: 'Telugu (తెలుగు)' },
  { code: 'mr', name: 'Marathi (मराठी)' },
  { code: 'ta', name: 'Tamil (தமிழ்)' },
  { code: 'gu', name: 'Gujarati (ગુજરાતી)' },
  { code: 'kn', name: 'Kannada (ಕನ್ನಡ)' },
  { code: 'ml', name: 'Malayalam (മലയാളം)' },
  { code: 'pa', name: 'Punjabi (ਪੰਜਾਬੀ)' },
  { code: 'or', name: 'Odia (ଓଡ଼ିଆ)' },
  { code: 'as', name: 'Assamese (অসমীয়া)' },
  { code: 'ur', name: 'Urdu (اردو)' },
  { code: 'sa', name: 'Sanskrit (संस्कृत)' }
];

// Detail levels for each section
const DETAIL_LEVELS = [
  { value: 'detailed', label: 'Detailed', description: 'Comprehensive and thorough' },
  { value: 'concise', label: 'Concise', description: 'Balanced and clear' },
  { value: 'short', label: 'Short', description: 'Brief and to the point' }
];

const DraftFormPage = () => {
  const { draftId } = useParams();
  const navigate = useNavigate();

  // -- STATE --
  const [draft, setDraft] = useState(null);
  const [fieldValues, setFieldValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [lastSaved, setLastSaved] = useState(null);

  // Autosave refs
  const skipNextAutoSaveRef = useRef(true);
  const hasUserEditedRef = useRef(false);

  // Case / File State
  const [cases, setCases] = useState([]);
  const [casesLoading, setCasesLoading] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState(null);
  const [attachCaseLoading, setAttachCaseLoading] = useState(false);
  const [uploadFileLoading, setUploadFileLoading] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState(null);
  const [attachedCaseTitle, setAttachedCaseTitle] = useState(null);

  // Steps
  const [currentStep, setCurrentStep] = useState(1);

  // Section Management
  const [sectionPrompts, setSectionPrompts] = useState({});
  const [deletedSections, setDeletedSections] = useState(new Set());
  const [isFinalizing, setIsFinalizing] = useState(false);

  // Language and Detail Level
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [sectionDetailLevels, setSectionDetailLevels] = useState({});

  // Rename modal
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [newDraftTitle, setNewDraftTitle] = useState('');
  const [renamingDraft, setRenamingDraft] = useState(false);
  const [orderedSections, setOrderedSections] = useState(UNIVERSAL_SECTIONS);
  const [showAddSectionModal, setShowAddSectionModal] = useState(false);
  const [newSectionData, setNewSectionData] = useState({ name: '', type: 'clause', prompt: '' });
  const [isGoogleDocsActive, setIsGoogleDocsActive] = useState(false);

  // -- EFFECTS --

  // Auto-reset isGoogleDocsActive when navigating steps
  useEffect(() => {
    if (currentStep !== 5) {
      setIsGoogleDocsActive(false);
    }
  }, [currentStep]);

  useEffect(() => {
    let cancelled = false;
    hasUserEditedRef.current = false;
    const load = async () => {
      if (!draftId) return;
      try {
        setLoading(true);
        skipNextAutoSaveRef.current = true;

        // Parallel load
        const [res, sectionsData] = await Promise.all([
          getDraft(draftId),
          draftApi.getSectionPrompts(draftId).catch(err => {
            console.warn('Failed to fetch section prompts', err);
            return [];
          })
        ]);

        if (!cancelled && res?.success && res?.draft) {
          const d = res.draft;
          setDraft(d);

          // Populate sections
          const promptsMap = {};
          const deletedSet = new Set();
          const detailMap = {};
          const orderMap = {};
          let lang = d.metadata?.draft_language || 'en';

          if (Array.isArray(sectionsData)) {
            sectionsData.forEach(p => {
              if (p.custom_prompt) promptsMap[p.section_id] = p.custom_prompt;
              if (p.is_deleted) deletedSet.add(p.section_id);
              if (p.detail_level) detailMap[p.section_id] = p.detail_level;
              if (p.language) lang = p.language;
              if (p.sort_order !== undefined) orderMap[p.section_id] = p.sort_order;
            });
          }

          setSectionPrompts(promptsMap);
          setDeletedSections(deletedSet);
          setSectionDetailLevels(detailMap);
          setSelectedLanguage(lang);

          // Sort sections
          // Sort sections
          // 1. Identify Custom Sections
          const universalIds = new Set(UNIVERSAL_SECTIONS.map(u => u.id));
          const customSections = [];

          if (Array.isArray(sectionsData)) {
            sectionsData.forEach(p => {
              if (!universalIds.has(p.section_id) && !p.is_deleted) {
                customSections.push({
                  id: p.section_id,
                  title: p.section_name || 'Custom Section',
                  description: p.section_type || 'Custom',
                  defaultPrompt: p.custom_prompt || '',
                  isCustom: true
                });
              }
            });
          }

          const allSectionsCombined = [...UNIVERSAL_SECTIONS, ...customSections];

          const sorted = allSectionsCombined.sort((a, b) => {
            const oa = orderMap[a.id];
            const ob = orderMap[b.id];
            if (oa !== undefined && ob !== undefined) return oa - ob;

            // If one has order and other doesn't, prioritized one with order? 
            // Or default to original index for universal
            const ia = UNIVERSAL_SECTIONS.findIndex(s => s.id === a.id);
            const ib = UNIVERSAL_SECTIONS.findIndex(s => s.id === b.id);

            // If both are universal, use original order
            if (ia !== -1 && ib !== -1) return ia - ib;

            // If new custom sections don't have order, put them at end
            if (oa !== undefined) return -1;
            if (ob !== undefined) return 1;

            return 0;
          });
          setOrderedSections(sorted);

          const isFresh = d.metadata?.is_fresh === true;

          // Hydrate fields
          if (isFresh) {
            console.log('[DraftFormPage] Fresh template detected');
            setFieldValues({});
            const caseId = d.metadata?.case_id;
            if (caseId) {
              setSelectedCaseId(caseId);
              setAttachedCaseTitle(d.metadata?.case_title || `Case ${caseId}`);
            }
            const uploadedFile = d.metadata?.uploaded_file_name;
            if (uploadedFile) setUploadedFileName(uploadedFile);
          } else {
            console.log('[DraftFormPage] Loading saved draft data');
            const raw = d.field_values;
            const saved = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? { ...raw } : {};
            setFieldValues(saved);

            const caseId = d.metadata?.case_id;
            if (caseId) {
              setSelectedCaseId(caseId);
              setAttachedCaseTitle(d.metadata?.case_title || `Case ${caseId}`);
            }
            setUploadedFileName(d.metadata?.uploaded_file_name ?? null);
          }

          if (d.updated_at) setLastSaved(new Date(d.updated_at));
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(err.message || 'Failed to load draft');
          navigate('/draft-selection');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [draftId, navigate]);


  // Initialize Section Prompts map when fields change (if needed)
  const fields = draft?.fields ?? [];
  const sections = useMemo(() => {
    const order = [];
    const map = {};
    fields.forEach((f) => {
      const key = (f.field_group && String(f.field_group).trim()) ? String(f.field_group).trim() : 'Details';
      if (!map[key]) {
        map[key] = [];
        order.push(key);
      }
      map[key].push(f);
    });
    return order.map((sectionName) => ({ sectionName, fields: map[sectionName] }));
  }, [fields]);

  useEffect(() => {
    if (sections.length === 0) return;
    setSectionPrompts((prev) => {
      const next = { ...prev };
      sections.forEach(({ sectionName }) => {
        // Just ensuring keys exist could be useful, mainly for universal sections
      });
      return next;
    });
  }, [sections]);


  // Auto-Save
  useEffect(() => {
    if (!draftId || !draft) return;
    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false;
      return;
    }
    if (!hasUserEditedRef.current) return;

    const timer = setTimeout(async () => {
      try {
        setSaving(true);
        await updateDraftFields(draftId, fieldValues, Object.keys(fieldValues));
        setLastSaved(new Date());
      } catch (err) {
        toast.error('Auto-save failed');
      } finally {
        setSaving(false);
      }
    }, AUTO_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draftId, draft, fieldValues]);


  // -- HANDLERS --

  const fetchCases = async () => {
    if (cases.length > 0) return;
    setCasesLoading(true);
    try {
      const res = await documentApi.getCases();
      const list = res?.cases ?? res?.data ?? (Array.isArray(res) ? res : []);
      setCases(list);
    } catch (err) {
      toast.error('Failed to load cases');
    } finally {
      setCasesLoading(false);
    }
  };

  const handleSelectCase = async (e) => {
    const caseId = e.target.value;
    if (!caseId) return;
    const c = cases.find((x) => String(x.id) === String(caseId) || String(x.case_id) === String(caseId));
    const caseTitle = c?.case_title ?? c?.title ?? null;

    setAttachCaseLoading(true);
    try {
      await attachCaseToDraft(draftId, caseId, caseTitle);
      setSelectedCaseId(caseId);
      setAttachedCaseTitle(caseTitle ?? `Case ${caseId}`);
      toast.success('Case attached. Agent will use its context.');
    } catch (err) {
      toast.error('Failed to attach case');
    } finally {
      setAttachCaseLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    setUploadFileLoading(true);
    try {
      const res = await uploadDocumentForDraft(file, {
        draftId: draftId || undefined,
        caseId: selectedCaseId ? String(selectedCaseId) : undefined,
      });
      setUploadedFileName(file.name);

      if (draftId) {
        try { await setUploadedFileNameInDraft(draftId, file.name); } catch (e) { }
        const fileId = res?.file_id ?? res?.state?.file_id;
        if (fileId) {
          try { await linkFileToDraft(draftId, fileId, file.name); } catch (e) { }
        }
      }
      toast.success('Document uploaded and processing.');
    } catch (err) {
      toast.error('Upload failed');
    } finally {
      setUploadFileLoading(false);
      e.target.value = '';
    }
  };

  const handleFieldChange = (fieldName, value) => {
    hasUserEditedRef.current = true;
    setFieldValues((prev) => ({ ...prev, [fieldName]: value }));
  };

  const saveToBackend = async (skipValidation = false) => {
    // Validation logic removed as requested by user
    // We now allow saving even if required fields are empty
    setErrors({});
    try {
      setSaving(true);
      await updateDraftFields(draftId, fieldValues, Object.keys(fieldValues));
      setLastSaved(new Date());
      if (!skipValidation) toast.success('Draft saved');
      return true;
    } catch (err) {
      toast.error('Failed to save');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleCopySection = async (sectionName, sectionFields) => {
    const lines = [sectionName, ''];
    sectionFields.forEach((f) => {
      const label = f.field_label || f.field_name;
      const value = fieldValues[f.field_name];
      const display = (value != null && String(value).trim() !== '') ? String(value) : '(empty)';
      lines.push(`${label}: ${display}`);
    });
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast.success('Copied to clipboard');
    } catch (err) {
      toast.error('Failed to copy');
    }
  };

  // Section Management
  const toggleSectionDeletion = (sectionId) => {
    setDeletedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  const handleReorderSections = (newOrder) => {
    setOrderedSections(newOrder);
    if (draftId) {
      const orderIds = newOrder.map(s => s.id);
      const token = localStorage.getItem('token');
      // Fire and forget - silent save to ensure persistence
      axios.post(
        `http://localhost:8000/api/drafts/${draftId}/sections/order`,
        { sectionIds: orderIds },
        { headers: { Authorization: `Bearer ${token}` } }
      ).catch(err => console.warn('Order auto-save failed', err));
    }
  };

  const handleFinalizeDraft = async () => {
    if (!draftId) return;

    // Save order
    try {
      const token = localStorage.getItem('token');
      const orderIds = orderedSections.map(s => s.id);
      await axios.post(
        `http://localhost:8000/api/drafts/${draftId}/sections/order`,
        { sectionIds: orderIds },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (err) { console.warn("Saving order failed", err); }

    setIsFinalizing(true);
    try {
      // Iterate orderedSections to include Custom Sections in the save process
      const savePromises = orderedSections.map(async (section, index) => {
        const customPrompt = sectionPrompts[section.id];
        const isDeleted = deletedSections.has(section.id);
        const defaultPrompt = section.defaultPrompt;
        const detailLevel = sectionDetailLevels[section.id] || 'concise';

        return draftApi.saveSectionPrompt(draftId, section.id, {
          customPrompt: customPrompt || defaultPrompt,
          isDeleted: isDeleted,
          detailLevel: detailLevel,
          language: selectedLanguage,
          // Only save name/type for custom sections to preserve their metadata
          sectionName: section.isCustom ? section.title : undefined,
          sectionType: section.isCustom ? section.description : undefined,
          sortOrder: index // Explicitly save current index as sortOrder
        });
      });
      await Promise.all(savePromises);
      toast.success("Section configuration saved!");
      // Proceed to Drafting step instead of navigating away
      setCurrentStep(4);
    } catch (err) {
      toast.error("Failed to finalize sections");
    } finally {
      setIsFinalizing(false);
    }
  };

  // Rename
  const handleOpenRenameModal = () => {
    setNewDraftTitle(draft?.draft_title || draft?.template_name || '');
    setShowRenameModal(true);
  };

  const handleRenameDraft = async () => {
    if (!newDraftTitle.trim()) return toast.error('Title cannot be empty');
    try {
      setRenamingDraft(true);
      await renameDraft(draftId, newDraftTitle.trim());
      setDraft(prev => prev ? { ...prev, draft_title: newDraftTitle.trim() } : prev);
      setShowRenameModal(false);
      toast.success('Renamed successfully');
    } catch (err) {
      toast.error('Rename failed');
    } finally {
      setRenamingDraft(false);
    }
  };

  const handleAddCustomSection = async () => {
    if (!newSectionData.name.trim() || !draftId) return;

    const sectionId = `custom_${Date.now()}`;
    const newSection = {
      sectionId,
      sectionName: newSectionData.name,
      sectionType: newSectionData.type,
      customPrompt: newSectionData.prompt,
      isDeleted: false
    };

    try {
      await draftApi.saveSectionPrompt(draftId, sectionId, newSection);

      // Update local state
      const newItem = {
        id: sectionId,
        title: newSectionData.name,
        description: newSectionData.type,
        defaultPrompt: newSectionData.prompt,
        isCustom: true
      };

      setOrderedSections(prev => {
        const nextOrder = [...prev, newItem];
        // Auto-save the new order immediately to ensure the new item has a sort_order in DB
        if (draftId) {
          const orderIds = nextOrder.map(s => s.id);
          const token = localStorage.getItem('token');
          axios.post(
            `http://localhost:8000/api/drafts/${draftId}/sections/order`,
            { sectionIds: orderIds },
            { headers: { Authorization: `Bearer ${token}` } }
          ).catch(err => console.warn('Order update failed after add', err));
        }
        return nextOrder;
      });
      // Also update prompts map if provided
      if (newSectionData.prompt) {
        setSectionPrompts(prev => ({ ...prev, [sectionId]: newSectionData.prompt }));
      }

      setShowAddSectionModal(false);
      setNewSectionData({ name: '', type: 'clause', prompt: '' });
      toast.success('Section added');
    } catch (err) {
      console.error(err);
      toast.error('Failed to add section');
    }
  };


  // -- RENDERERS --

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-[#21C1B6]/5 to-slate-100 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-2xl px-10 py-12 flex flex-col items-center gap-6 border border-slate-200">
          <div className="relative">
            <div className="animate-spin rounded-full h-12 w-12 border-3 border-slate-200 border-t-[#21C1B6]" />
            <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-[#21C1B6]/20 to-transparent animate-pulse" />
          </div>
          <p className="text-slate-600 font-semibold text-base">Loading draft...</p>
        </div>
      </div>
    );
  }

  if (!draft) return null;

  return (

    <div className="h-screen overflow-hidden flex flex-col bg-gradient-to-br from-slate-50 via-[#21C1B6]/5 to-slate-100">

      {/* Header - Hidden when Google Docs editor is active OR on the final Preview step */}
      {!isGoogleDocsActive && currentStep !== 5 && (
        <div className="bg-white border-b border-slate-200 shadow-sm flex-shrink-0">
          <div className="max-w-7xl mx-auto px-6 lg:px-8 py-5">
            {/* Standard Step Progress Header */}
            <StepProgress
              title={draft.draft_title || draft.template_name}
              totalSteps={DRAFT_STEPS.length}
              currentStep={currentStep}
              steps={DRAFT_STEPS}
              onStepClick={(s) => {
                if (s < currentStep) setCurrentStep(s);
              }}
              onRename={handleOpenRenameModal}
              onCancel={() => navigate('/draft-selection')}
              cancelLabel="Exit Draft"
            />

            {/* Supplemental Top Bar: Save Status & Manual Actions */}
            <div className="flex items-center justify-end -mt-12 mb-8 gap-4 px-1">
              {saving ? (
                <span className="text-xs text-[#21C1B6] font-semibold animate-pulse flex items-center gap-2">
                  <div className="w-1.5 h-1.5 bg-[#21C1B6] rounded-full animate-ping" />
                  Saving...
                </span>
              ) : lastSaved ? (
                <span className="text-xs text-slate-400 font-medium">
                  Saved {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              ) : null}

              {currentStep === 2 && (
                <button
                  onClick={() => saveToBackend(false)}
                  disabled={saving}
                  className="h-9 px-4 bg-white text-slate-700 text-xs font-bold border border-slate-300 rounded-lg hover:border-[#21C1B6] hover:text-[#21C1B6] transition-all disabled:opacity-50"
                >
                  Save Draft
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area - Full screen if Google Docs active OR on Preview step */}
      <div className={`flex-1 overflow-hidden flex flex-col ${(isGoogleDocsActive || currentStep === 5) ? 'px-0 py-0' : ''}`}>
        <div className={`flex-1 overflow-hidden flex flex-col transition-all duration-300 ${(isGoogleDocsActive || currentStep === 5) ? 'max-w-full px-0 py-0' : 'max-w-7xl mx-auto px-6 lg:px-8 py-4 h-full w-full animate-fadeIn'}`}>
          <div className={`bg-white shadow-xl shadow-slate-200/60 border-slate-200 overflow-hidden flex-1 flex flex-col w-full h-full ${(isGoogleDocsActive || currentStep === 5) ? 'rounded-none border-0' : 'rounded-2xl border'}`}>

            {/* STEP 1: UPLOAD / CASE */}
            {currentStep === 1 && (
              <div className="p-10 space-y-8 animate-slideIn h-full overflow-y-auto custom-scrollbar">
                <div className="text-center space-y-3 pb-4">
                  <h2 className="text-2xl font-bold text-slate-900">Context & Data Sources</h2>
                  <p className="text-slate-600 text-base max-w-2xl mx-auto">Attach a case or upload a file to provide the AI with relevant context for drafting.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Option A: Attach Case */}
                  <div className="space-y-5 p-7 bg-gradient-to-br from-[#21C1B6]/5 to-slate-50 rounded-2xl border-2 border-[#21C1B6]/20 hover:border-[#21C1B6] transition-all duration-300 hover:shadow-lg">
                    <div className="flex items-center gap-3 mb-1">
                      <div className="p-2.5 bg-[#21C1B6] text-white rounded-xl shadow-md">
                        <Squares2X2Icon className="w-6 h-6" />
                      </div>
                      <h3 className="font-bold text-lg text-slate-900">Attach Existing Case</h3>
                    </div>
                    <p className="text-sm text-slate-600 leading-relaxed">Connect this draft to a case to use its facts, parties, and history.</p>

                    {attachedCaseTitle ? (
                      <div className="p-4 bg-green-50 border-2 border-green-300 rounded-xl flex items-center gap-3 shadow-sm">
                        <CheckCircleIcon className="w-6 h-6 text-green-600 flex-shrink-0" />
                        <div className="flex-1 overflow-hidden min-w-0">
                          <p className="text-xs text-green-800 font-bold uppercase tracking-wide">Attached</p>
                          <p className="text-sm text-green-900 truncate font-medium mt-0.5">{attachedCaseTitle}</p>
                        </div>
                        <button onClick={() => { setSelectedCaseId(null); setAttachedCaseTitle(null); }} className="text-slate-400 hover:text-red-600 transition-colors p-1 hover:bg-red-50 rounded-lg flex-shrink-0">
                          <XMarkIcon className="w-5 h-5" />
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <select
                          className="w-full h-11 text-sm border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-[#21C1B6] focus:border-[#21C1B6] bg-white shadow-sm transition-all duration-200"
                          onClick={fetchCases}
                          onChange={handleSelectCase}
                          value={selectedCaseId || ""}
                          disabled={casesLoading}
                        >
                          <option value="">Select a case...</option>
                          {cases.map(c => (
                            <option key={c.id} value={c.id}>{c.case_title || c.title || `Case #${c.id}`}</option>
                          ))}
                        </select>
                        {attachCaseLoading && <p className="text-xs text-[#21C1B6] font-semibold animate-pulse">Attaching case...</p>}
                      </div>
                    )}
                  </div>

                  {/* Option B: Upload File */}
                  <div className="space-y-5 p-7 bg-gradient-to-br from-[#21C1B6]/5 to-slate-50 rounded-2xl border-2 border-[#21C1B6]/20 hover:border-[#21C1B6] transition-all duration-300 hover:shadow-lg">
                    <div className="flex items-center gap-3 mb-1">
                      <div className="p-2.5 bg-[#21C1B6] text-white rounded-xl shadow-md">
                        <ArrowUpTrayIcon className="w-6 h-6" />
                      </div>
                      <h3 className="font-bold text-lg text-slate-900">Upload Document</h3>
                    </div>
                    <p className="text-sm text-slate-600 leading-relaxed">Upload a PDF/Word file to extract facts directly into this draft.</p>

                    {uploadedFileName ? (
                      <div className="p-4 bg-[#21C1B6]/5 border-2 border-[#21C1B6]/30 rounded-xl flex items-center gap-3 shadow-sm">
                        <DocumentTextIcon className="w-6 h-6 text-[#21C1B6] flex-shrink-0" />
                        <div className="flex-1 overflow-hidden min-w-0">
                          <p className="text-xs text-[#19a096] font-bold uppercase tracking-wide">Uploaded</p>
                          <p className="text-sm text-[#128f86] truncate font-medium mt-0.5">{uploadedFileName}</p>
                        </div>
                        <button onClick={() => setUploadedFileName(null)} className="text-slate-400 hover:text-red-600 transition-colors p-1 hover:bg-red-50 rounded-lg flex-shrink-0">
                          <XMarkIcon className="w-5 h-5" />
                        </button>
                      </div>
                    ) : (
                      <label className={`flex flex-col items-center justify-center w-full h-36 border-2 border-dashed rounded-xl cursor-pointer transition-all duration-300 group ${uploadFileLoading ? 'opacity-50 pointer-events-none bg-slate-50' : 'border-slate-300 hover:border-[#21C1B6] bg-white hover:bg-[#21C1B6]/5 hover:shadow-md'}`}>
                        <div className="flex flex-col items-center justify-center">
                          {uploadFileLoading ? (
                            <div className="animate-spin h-8 w-8 border-3 border-[#21C1B6] rounded-full border-t-transparent" />
                          ) : (
                            <>
                              <ArrowUpTrayIcon className="w-10 h-10 text-slate-400 group-hover:text-[#21C1B6] mb-3 transition-colors" />
                              <p className="text-sm text-slate-600"><span className="font-semibold text-[#21C1B6]">Click to upload</span> or drag file</p>
                              <p className="text-xs text-slate-400 mt-1">PDF, DOCX, DOC, TXT</p>
                            </>
                          )}
                        </div>
                        <input type="file" className="hidden" onChange={handleFileUpload} accept=".pdf,.docx,.doc,.txt" />
                      </label>
                    )}
                  </div>
                </div>

                <div className="flex justify-end pt-8 border-t-2 border-slate-100 mt-4">
                  <button
                    onClick={() => setCurrentStep(2)}
                    className="h-11 flex items-center gap-2 bg-gradient-to-r from-[#21C1B6] to-[#19a096] hover:from-[#19a096] hover:to-[#128f86] text-white px-8 rounded-xl font-semibold shadow-lg shadow-[#21C1B6]/30 transition-all duration-200 hover:scale-[1.02] hover:shadow-xl"
                  >
                    Next: Fill Details
                    <ChevronRightIcon className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: FORM FIELDS */}
            {currentStep === 2 && (
              <div className="animate-slideIn h-full flex flex-col">
                <div className="bg-gradient-to-r from-slate-50 to-[#21C1B6]/5 px-10 py-7 border-b-2 border-slate-200 shrink-0">
                  <div className="flex justify-between items-center">
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900">Fill Details</h2>
                      <p className="text-sm text-slate-600 mt-1">Review and verify the data extracted or required for this template.</p>
                    </div>
                  </div>
                </div>

                <div className="p-10 flex-1 overflow-y-auto custom-scrollbar">
                  {sections.length === 0 ? (
                    <div className="text-center py-16 text-slate-400">
                      <DocumentTextIcon className="w-20 h-20 mx-auto mb-4 opacity-40" />
                      <p className="text-base font-medium">No specific fields required for this template.</p>
                    </div>
                  ) : (
                    <div className="space-y-12">
                      {sections.map(({ sectionName, fields: secFields }) => (
                        <div key={sectionName} className="space-y-6">
                          <div className="flex items-center justify-between border-b-2 border-slate-100 pb-3">
                            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-3">
                              <div className="w-1.5 h-7 bg-gradient-to-b from-[#21C1B6] to-[#19a096] rounded-full" />
                              {sectionName}
                            </h3>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-6">
                            {secFields.map((field) => {
                              const err = errors[field.field_name];
                              return (
                                <div key={field.id} className="space-y-2">
                                  <label className="block text-xs font-bold uppercase text-slate-500 tracking-wider">
                                    {field.field_label || field.field_name}
                                  </label>
                                  {field.field_type === 'textarea' ? (
                                    <textarea
                                      className={`w-full text-sm rounded-xl border-2 px-3 py-2.5 outline-none transition-all duration-200 bg-slate-50 focus:bg-white
                                      ${err
                                          ? 'border-red-300 bg-red-50 focus:border-red-500 focus:ring-2 focus:ring-red-200'
                                          : 'border-slate-200 focus:border-[#21C1B6] focus:ring-4 focus:ring-[#21C1B6]/10'
                                        }`}
                                      rows={3}
                                      value={fieldValues[field.field_name] || ''}
                                      onChange={(e) => handleFieldChange(field.field_name, e.target.value)}
                                      placeholder={`Enter ${field.field_label?.toLowerCase()}...`}
                                    />
                                  ) : (
                                    <input
                                      type={field.field_type === 'date' ? 'date' : 'text'}
                                      className={`h-11 w-full text-sm rounded-xl border-2 px-3 outline-none transition-all duration-200 bg-slate-50 focus:bg-white
                                      ${err
                                          ? 'border-red-300 bg-red-50 focus:border-red-500 focus:ring-2 focus:ring-red-200'
                                          : 'border-slate-200 focus:border-[#21C1B6] focus:ring-4 focus:ring-[#21C1B6]/10'
                                        }`}
                                      value={fieldValues[field.field_name] || ''}
                                      onChange={(e) => handleFieldChange(field.field_name, e.target.value)}
                                      placeholder={field.placeholder || ''}
                                    />
                                  )}
                                  {err && <p className="text-xs text-red-600 font-semibold">{err}</p>}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex justify-between pt-10 mt-10 border-t-2 border-slate-100">
                    <button
                      onClick={() => setCurrentStep(1)}
                      className="h-11 flex items-center gap-2 px-6 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl font-semibold transition-all duration-200"
                    >
                      <ArrowLeftIcon className="w-5 h-5" /> Back
                    </button>
                    <button
                      onClick={async () => {
                        const success = await saveToBackend(false);
                        if (success) setCurrentStep(3);
                      }}
                      className="h-11 flex items-center gap-2 bg-gradient-to-r from-[#21C1B6] to-[#19a096] hover:from-[#19a096] hover:to-[#128f86] text-white px-8 rounded-xl font-semibold shadow-lg shadow-[#21C1B6]/30 transition-all duration-200 hover:scale-[1.02] hover:shadow-xl"
                    >
                      Next: Sections
                      <ChevronRightIcon className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: TEMPLATE SECTIONS */}
            {currentStep === 3 && (
              <div className="animate-slideIn h-full flex flex-col">
                <div className="bg-gradient-to-r from-slate-50 to-[#21C1B6]/10 px-10 py-7 border-b-2 border-slate-200 shrink-0">
                  <div className="flex items-start justify-between gap-6">
                    <div className="flex-1">
                      <h2 className="text-2xl font-bold text-slate-900">Configure Sections</h2>
                      <p className="text-sm text-slate-600 mt-1">Select which sections to generate and customize their instructions.</p>
                    </div>
                    <div className="flex-shrink-0 min-w-[200px]">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">
                        Draft Language
                      </label>
                      <select
                        value={selectedLanguage}
                        onChange={(e) => setSelectedLanguage(e.target.value)}
                        className="w-full h-11 text-sm border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-[#21C1B6] focus:border-[#21C1B6] bg-white shadow-sm transition-all duration-200 font-medium"
                      >
                        {INDIAN_LANGUAGES.map(lang => (
                          <option key={lang.code} value={lang.code}>{lang.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="p-10 flex-1 overflow-y-auto custom-scrollbar">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Drag to Reorder</h3>
                    <button
                      onClick={() => setShowAddSectionModal(true)}
                      className="flex items-center gap-2 text-sm font-bold text-[#21C1B6] hover:text-white hover:bg-[#21C1B6] border border-[#21C1B6]/30 px-4 py-2 rounded-lg transition-all"
                    >
                      <PlusIcon className="w-5 h-5" />
                      Add Custom Section
                    </button>
                  </div>
                  <Reorder.Group axis="y" values={orderedSections} onReorder={handleReorderSections} className="space-y-5 list-none">
                    {orderedSections.reduce((acc, section, index) => {
                      const isDeleted = deletedSections.has(section.id);
                      // Calculate active index (numbering)
                      // Only increment for non-deleted sections
                      let displayNumber = null;
                      if (!isDeleted) {
                        acc.activeCount = (acc.activeCount || 0) + 1;
                        displayNumber = acc.activeCount;
                      }

                      acc.elements.push(
                        <Reorder.Item key={section.id} value={section} className={`group border rounded-xl overflow-hidden ${isDeleted ? 'bg-slate-50 border-slate-200 opacity-60' : 'bg-white border-slate-200 shadow-sm hover:border-[#21C1B6] hover:shadow-md'}`}>
                          <div className="flex items-start p-3 gap-3">
                            <div className="pt-1">
                              <input
                                type="checkbox"
                                checked={!isDeleted}
                                onChange={() => toggleSectionDeletion(section.id)}
                                className="w-4 h-4 rounded border-2 border-slate-300 text-[#21C1B6] focus:ring-2 focus:ring-[#21C1B6] cursor-pointer transition-all duration-200 accent-[#21C1B6]"
                              />
                            </div>
                            <div className="flex-1 space-y-3">
                              <div className="flex justify-between items-start gap-4">
                                <div>
                                  <h3 className={`font-bold text-sm ${isDeleted ? 'text-slate-500 line-through' : 'text-slate-900'}`}>
                                    {displayNumber ? `${displayNumber}. ` : ''}{section.title.replace(/^\d+\.\s*/, '')}
                                  </h3>
                                  <p className="text-xs text-slate-500 mt-1 max-w-prose leading-tight truncate">{section.description}</p>
                                </div>

                                <div className="flex items-center gap-3">
                                  {!isDeleted && (
                                    <div className="flex bg-slate-100 rounded-lg p-0.5 border border-slate-200">
                                      {DETAIL_LEVELS.map((level) => {
                                        const isSelected = (sectionDetailLevels[section.id] || 'concise') === level.value;
                                        return (
                                          <button
                                            key={level.value}
                                            onClick={() => setSectionDetailLevels(prev => ({
                                              ...prev,
                                              [section.id]: level.value
                                            }))}
                                            className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-all duration-200 ${isSelected
                                              ? 'bg-white text-[#21C1B6] shadow-sm'
                                              : 'text-slate-500 hover:text-slate-700'
                                              }`}
                                          >
                                            {level.label}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                  <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${isDeleted ? 'bg-slate-200 text-slate-600' : 'bg-[#21C1B6]/10 text-[#19a096]'}`}>
                                    {isDeleted ? 'Excluded' : 'Active'}
                                  </span>
                                </div>
                              </div>

                              {!isDeleted && (
                                <div className="pt-1">
                                  {/* Custom Instructions */}
                                  <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">
                                      Instructions for AI Agent
                                    </label>
                                    <textarea
                                      value={sectionPrompts[section.id] || section.defaultPrompt}
                                      onChange={(e) => setSectionPrompts(prev => ({ ...prev, [section.id]: e.target.value }))}
                                      className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-[#21C1B6] focus:ring-2 focus:ring-[#21C1B6]/20 transition-all duration-200 p-2.5"
                                      rows={2}
                                      placeholder="Add specific instructions..."
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </Reorder.Item>
                      );
                      return acc;
                    }, { activeCount: 0, elements: [] }).elements}
                  </Reorder.Group>
                </div>

                <div className="px-10 py-6 border-t-2 border-slate-200 bg-white flex justify-between shrink-0">
                  <button
                    onClick={() => setCurrentStep(2)}
                    className="h-11 flex items-center gap-2 px-6 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl font-semibold transition-all duration-200"
                  >
                    <ArrowLeftIcon className="w-5 h-5" /> Back
                  </button>
                  <button
                    onClick={handleFinalizeDraft}
                    disabled={isFinalizing}
                    className="h-11 flex items-center gap-2 bg-gradient-to-r from-[#21C1B6] to-[#19a096] hover:from-[#19a096] hover:to-[#128f86] text-white px-8 rounded-xl font-bold shadow-lg shadow-[#21C1B6]/30 transition-all duration-200 hover:scale-[1.02] hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                  >
                    {isFinalizing ? (
                      <>
                        <div className="animate-spin h-5 w-5 border-2 border-white rounded-full border-t-transparent" />
                        Finalizing...
                      </>
                    ) : (
                      <>
                        Generate Draft <Squares2X2Icon className="w-5 h-5" />
                      </>
                    )}
                  </button>
                </div>
              </div>

            )}

            {/* STEP 4: DRAFTING (Section Drafting) */}
            {currentStep === 4 && (
              <div className="animate-slideIn h-full overflow-y-auto custom-scrollbar flex flex-col">
                <SectionDraftingPage
                  draftIdProp={draftId}
                  onAssembleComplete={() => setCurrentStep(5)}
                  onBack={() => setCurrentStep(3)}
                />
              </div>
            )}

            {/* STEP 5: PREVIEW (Assembled Document) */}
            {currentStep === 5 && (
              <div className={`animate-slideIn h-full overflow-y-auto custom-scrollbar flex flex-col ${isGoogleDocsActive ? 'overflow-hidden' : ''}`}>
                <AssembledPreviewPage
                  draftIdProp={draftId}
                  onBack={() => setCurrentStep(4)}
                  onToggleEditor={(active) => setIsGoogleDocsActive(active)}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Rename Modal */}
      {
        showRenameModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 transform transition-all scale-100 animate-scaleIn border border-slate-200">
              <h3 className="text-xl font-bold text-slate-900 mb-6">Rename Draft</h3>
              <input
                type="text"
                value={newDraftTitle}
                onChange={(e) => setNewDraftTitle(e.target.value)}
                className="h-11 w-full text-sm rounded-xl border-2 border-slate-300 focus:ring-2 focus:ring-[#21C1B6] focus:border-[#21C1B6] mb-8 transition-all duration-200"
                placeholder="Enter new draft title..."
                autoFocus
              />
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowRenameModal(false)}
                  className="h-10 px-5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl text-sm font-semibold transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRenameDraft}
                  disabled={renamingDraft}
                  className="h-10 px-6 bg-gradient-to-r from-[#21C1B6] to-[#19a096] hover:from-[#19a096] hover:to-[#128f86] text-white rounded-xl text-sm font-bold shadow-md transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {renamingDraft ? 'Renaming...' : 'Save Name'}
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* Add Custom Section Modal */}
      {
        showAddSectionModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-scaleIn border border-slate-200">
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <h3 className="text-lg font-bold text-slate-900">Add Custom Section</h3>
                <button onClick={() => setShowAddSectionModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                  <XMarkIcon className="w-6 h-6" />
                </button>
              </div>
              <div className="p-6 space-y-5">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 tracking-wider mb-2">Section Name</label>
                  <input
                    type="text"
                    value={newSectionData.name}
                    onChange={e => setNewSectionData({ ...newSectionData, name: e.target.value })}
                    className="w-full px-3 py-2.5 bg-slate-50 border-2 border-slate-200 rounded-xl focus:bg-white focus:ring-[#21C1B6] focus:border-[#21C1B6] outline-none transition-all"
                    placeholder="E.g., Special Provisions"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 tracking-wider mb-2">Type</label>
                  <select
                    value={newSectionData.type}
                    onChange={e => setNewSectionData({ ...newSectionData, type: e.target.value })}
                    className="w-full px-3 py-2.5 bg-slate-50 border-2 border-slate-200 rounded-xl focus:bg-white focus:ring-[#21C1B6] focus:border-[#21C1B6] outline-none transition-all"
                  >
                    <option value="clause">Clause</option>
                    <option value="list">List</option>
                    <option value="text">Text Block</option>
                    <option value="definitions">Definitions</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 tracking-wider mb-2">Instruction Prompt</label>
                  <textarea
                    value={newSectionData.prompt}
                    onChange={e => setNewSectionData({ ...newSectionData, prompt: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2.5 bg-slate-50 border-2 border-slate-200 rounded-xl focus:bg-white focus:ring-[#21C1B6] focus:border-[#21C1B6] outline-none transition-all"
                    placeholder="Describe what should be in this section..."
                  />
                </div>
              </div>
              <div className="px-6 py-4 bg-slate-50 flex justify-end gap-3 border-t border-slate-100">
                <button
                  onClick={() => setShowAddSectionModal(false)}
                  className="px-4 py-2 text-sm font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded-lg transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddCustomSection}
                  disabled={!newSectionData.name.trim()}
                  className="px-4 py-2 text-sm font-bold text-white bg-[#21C1B6] hover:bg-[#19a096] rounded-lg shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Add Section
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* Styles for animations */}
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes scaleIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        .animate-fadeIn { animation: fadeIn 0.3s ease-out; }
        .animate-slideIn { animation: slideIn 0.4s ease-out; }
        .animate-scaleIn { animation: scaleIn 0.25s ease-out; }
      `}</style>
    </div >
  );
};

export default DraftFormPage;