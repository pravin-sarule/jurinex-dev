import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Reorder } from "framer-motion";
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
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
  PlusIcon,
  ArrowPathIcon,
  ShieldCheckIcon,
  TrashIcon
} from '@heroicons/react/24/outline';
import {
  getDraft,
  getTemplateUserFieldValues,
  updateDraftFields,
  saveTemplateUserFieldValues,
  attachCaseToDraft,
  uploadDocumentForDraft,
  setUploadedFileNameInDraft,
  linkFileToDraft,
  renameDraft,
  getTemplate,
  getTemplateSections,
  getTemplateFields
} from '../services/draftFormApi';
import documentApi from '../services/documentApi';
import { toast } from 'react-toastify';
import { draftApi } from '../template_drafting_component/services';
import { TEMPLATE_DRAFTING_ROUTES } from '../template_drafting_component/routes'
import { SectionDraftingPage } from '../template_drafting_component/pages/SectionDraftingPage';
import { AssembledPreviewPage } from '../template_drafting_component/pages/AssembledPreviewPage';
import { TemplateWizardGallery } from '../components/TemplateWizard';
import DraftingLayout from '../components/DraftingRedesign/DraftingLayout';
import { useSidebar } from '../context/SidebarContext';

const DRAFT_STEPS = [
  { id: 'initialization', label: 'Initialization' },
  { id: 'form_inputs', label: 'Form Inputs' },
  { id: 'section_config', label: 'Section Config' },
  { id: 'validation', label: 'Validation' },
  { id: 'review', label: 'Review' },
  { id: 'assembly', label: 'Assembly' },
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
  const [searchParams, setSearchParams] = useSearchParams();

  // Initial step from URL so refresh keeps you on the same page (e.g. ?step=3 = Configure Sections)
  const stepFromUrl = parseInt(searchParams.get('step'), 10);
  const initialStep = (!Number.isNaN(stepFromUrl) && stepFromUrl >= 1 && stepFromUrl <= 6) ? stepFromUrl : 1;

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
  const fieldValuesRef = useRef(fieldValues);
  fieldValuesRef.current = fieldValues;
  const autopopulatePollRef = useRef(null);

  // Case / File State
  const [cases, setCases] = useState([]);
  const [casesLoading, setCasesLoading] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState(null);
  const [attachCaseLoading, setAttachCaseLoading] = useState(false);
  const [uploadFileLoading, setUploadFileLoading] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState(null);
  const [attachedCaseTitle, setAttachedCaseTitle] = useState(null);
  const [isAutopopulatingFields, setIsAutopopulatingFields] = useState(false);

  // Steps (initial from URL so refresh preserves current step)
  const [currentStep, setCurrentStepState] = useState(initialStep);

  // When step changes, update URL so refresh keeps you on same step
  const setCurrentStep = (nextStep) => {
    setCurrentStepState(nextStep);
    setSearchParams({ step: String(nextStep) }, { replace: true });
  };
  const [subStepId, setSubStepId] = useState('inputs'); // 'inputs' or 'sections' for Step 3 prodigy flow
  const [deletedSections, setDeletedSections] = useState(new Set());
  const [isFinalizing, setIsFinalizing] = useState(false);

  // Language and Detail Level
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [sectionDetailLevels, setSectionDetailLevels] = useState({});

  // Rename modal
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [newDraftTitle, setNewDraftTitle] = useState('');
  const [renamingDraft, setRenamingDraft] = useState(false);
  const [orderedSections, setOrderedSections] = useState([]);
  const [loadingSections, setLoadingSections] = useState(false);
  const [templateSections, setTemplateSections] = useState([]);
  const [showAddSectionModal, setShowAddSectionModal] = useState(false);
  const [newSectionData, setNewSectionData] = useState({ name: '', type: 'clause' });
  const [isGoogleDocsActive, setIsGoogleDocsActive] = useState(false);
  const [lastAssembleResult, setLastAssembleResult] = useState(null);

  // Agent activity feed mock/state
  const [activities, setActivities] = useState([
    {
      id: 1,
      agentName: 'System',
      type: 'System',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      action: 'Initializing draft and awaiting case context.',
      status: 'completed'
    }
  ]);

  const { setForceSidebarCollapsed } = useSidebar();

  useEffect(() => {
    // Force main app sidebar to collapse when drafting
    setForceSidebarCollapsed(true);
    return () => {
      // Restore previous state when leaving the page if needed
      // Actually, Sidebar.jsx handles restoration based on user preference if force is false
      setForceSidebarCollapsed(false);
    };
  }, [setForceSidebarCollapsed]);

  // -- EFFECTS --

  // Auto-reset isGoogleDocsActive when navigating steps
  useEffect(() => {
    if (currentStep !== 6) {
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

        // Load draft and section prompts in parallel
        const [res, sectionsData] = await Promise.all([
          getDraft(draftId),
          draftApi.getSectionPrompts(draftId).catch(err => {
            console.warn('Failed to fetch section prompts', err);
            return [];
          }),
        ]);

        if (!cancelled && res?.success && res?.draft) {
          const d = res.draft;
          // Fetch full template (fields, sections, preview) so we have all form fields from DB
          let dbSections = [];
          let templateFields = d.fields;
          if (d.template_id) {
            try {
              const templateRes = await getTemplate(d.template_id);
              if (templateRes?.success && templateRes?.template) {
                const t = templateRes.template;
                dbSections = Array.isArray(t.sections) ? t.sections : [];
                // Use template fields from API when draft.fields is empty (e.g. custom templates)
                if (Array.isArray(t.fields) && t.fields.length > 0 && (!Array.isArray(d.fields) || d.fields.length === 0)) {
                  templateFields = t.fields;
                } else if (Array.isArray(d.fields) && d.fields.length > 0) {
                  templateFields = d.fields;
                }
              }
            } catch (err) {
              console.warn('Failed to fetch template (sections/fields)', err);
            }
          }
          setDraft({ ...d, fields: templateFields ?? d.fields });
          setTemplateSections(dbSections);

          // Convert DB sections to the format expected by the UI.
          // Use section_prompts (default_prompt) for AI instructions, NOT section_intro (short description).
          const baseSections = dbSections.map((section, index) => ({
            id: section.section_id || section.id || `section_${index}`,
            title: section.section_name || section.title || `Section ${index + 1}`,
            description: section.section_purpose || section.description || '',
            defaultPrompt: section.default_prompt || section.section_intro || '',
            subItems: [], // Can be populated if available in the section data
            isFromTemplate: true
          }));

          // Populate sections
          const deletedSet = new Set();
          const detailMap = {};
          const orderMap = {};
          let lang = d.metadata?.draft_language || 'en';

          if (Array.isArray(sectionsData)) {
            sectionsData.forEach(p => {
              if (p.is_deleted) deletedSet.add(p.section_id);
              if (p.detail_level) detailMap[p.section_id] = p.detail_level;
              if (p.language) lang = p.language;
              if (p.sort_order !== undefined) orderMap[p.section_id] = p.sort_order;
            });
          }

          // Section prompts stay backend-only - not fetched or displayed on frontend
          setDeletedSections(deletedSet);
          setSectionDetailLevels(detailMap);
          setSelectedLanguage(lang);

          // Identify custom sections added by user (not in template)
          const templateSectionIds = new Set(baseSections.map(s => s.id));
          const customSections = [];

          if (Array.isArray(sectionsData)) {
            sectionsData.forEach(p => {
              if (!templateSectionIds.has(p.section_id) && !p.is_deleted) {
                customSections.push({
                  id: p.section_id,
                  title: p.section_name || 'Custom Section',
                  description: p.section_type || 'Custom',
                  defaultPrompt: '',
                  isCustom: true
                });
              }
            });
          }

          // Combine template sections with custom sections
          const allSectionsCombined = [...baseSections, ...customSections];

          // Sort sections by order_index or sort_order
          const sorted = allSectionsCombined.sort((a, b) => {
            const oa = orderMap[a.id];
            const ob = orderMap[b.id];
            if (oa !== undefined && ob !== undefined) return oa - ob;

            // If one has order and other doesn't, prioritize one with order
            const ia = baseSections.findIndex(s => s.id === a.id);
            const ib = baseSections.findIndex(s => s.id === b.id);

            // If both are from template, use original order
            if (ia !== -1 && ib !== -1) return ia - ib;

            // If custom sections don't have order, put them at end
            if (oa !== undefined) return -1;
            if (ob !== undefined) return 1;

            return 0;
          });
          setOrderedSections(sorted);

          const isFresh = d.metadata?.is_fresh === true;

          // Hydrate fields - merge from getDraft (backend) + getTemplateUserFieldValues (InjectionAgent) for reliable autopopulation
          const raw = d.field_values;
          let saved = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? { ...raw } : {};

          // Also fetch template_user_field_values (InjectionAgent) and merge - backend merge can miss when agent writes async
          if (d.template_id) {
            try {
              const tvRes = await getTemplateUserFieldValues(String(d.template_id), draftId);
              if (tvRes?.field_values && typeof tvRes.field_values === 'object' && Object.keys(tvRes.field_values).length > 0) {
                saved = { ...saved, ...tvRes.field_values };
              }
            } catch (_) {}
          }

          if (isFresh) {
            console.log('[DraftFormPage] Fresh template - loaded agent-extracted values if available');
            console.log(`[DraftFormPage] Found ${Object.keys(saved).length} field values`);
          } else {
            console.log(`[DraftFormPage] Loaded ${Object.keys(saved).length} saved field values`);
          }

          setFieldValues(saved);

          // Load case/file metadata
          const caseId = d.metadata?.case_id;
          if (caseId) {
            setSelectedCaseId(caseId);
            setAttachedCaseTitle(d.metadata?.case_title || `Case ${caseId}`);
          }
          setUploadedFileName(d.metadata?.uploaded_file_name ?? null);

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

  const addActivity = (agent, action, status = 'in-progress') => {
    const typeMap = {
      Librarian: 'Search',
      Gemini: 'LLM',
      Drafter: 'GenAI',
      Citation: 'GenAI',
      Critic: 'LLM',
      Assembler: 'Assembly',
      Orchestrator: 'Orchestrator',
      System: 'System'
    };
    setActivities(prev => {
      const updatedPrev = prev.map(act =>
        act.status === 'in-progress' ? { ...act, status: 'completed' } : act
      );
      return [{
        id: Date.now() + Math.random(),
        agentName: agent,
        type: typeMap[agent] || 'Agent',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        action,
        status
      }, ...updatedPrev];
    });
  };

  const handleTemplateClick = async (template) => {
    // For now, just show a toast if they try to change template
    toast.info(`Template "${template.title}" selected. Context updated.`);
    addActivity('Orchestrator', `Updated template to ${template.title}`, 'completed');
    setCurrentStep(2);
  };

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

  // Poll for autopopulated form fields (InjectionAgent) and update form as soon as data is available
  const pollForAutopopulatedFields = (draftIdParam, templateIdParam, onApplied) => {
    if (autopopulatePollRef.current) clearInterval(autopopulatePollRef.current);
    setIsAutopopulatingFields(true);
    const POLL_INTERVAL_MS = 1500;
    const MAX_ATTEMPTS = 20;
    let attempts = 0;
    const intervalId = setInterval(async () => {
      attempts++;
      try {
        const draftRes = await getDraft(draftIdParam);
        const d = draftRes?.draft;
        let fromDraft = (d?.field_values && typeof d.field_values === 'object') ? d.field_values : {};
        let fromTemplate = {};
        if (templateIdParam) {
          try {
            const tvRes = await getTemplateUserFieldValues(templateIdParam, draftIdParam);
            if (tvRes?.field_values && typeof tvRes.field_values === 'object') {
              fromTemplate = tvRes.field_values;
            }
          } catch (_) {}
        }
        const merged = { ...fieldValuesRef.current, ...fromDraft, ...fromTemplate };
        const hasNewData = Object.keys(fromDraft).length > 0 || Object.keys(fromTemplate).length > 0;
        if (hasNewData && Object.keys(merged).length > 0) {
          clearInterval(intervalId);
          autopopulatePollRef.current = null;
          setIsAutopopulatingFields(false);
          setFieldValues(merged);
          await updateDraftFields(draftIdParam, merged, Object.keys(merged));
          if (templateIdParam) {
            try {
              await saveTemplateUserFieldValues(templateIdParam, merged, Object.keys(merged), draftIdParam);
            } catch (e) { /* non-blocking */ }
          }
          toast.success('Form fields auto-filled from document.');
          if (onApplied) onApplied();
        }
      } catch (_) {}
      if (attempts >= MAX_ATTEMPTS) {
        clearInterval(intervalId);
        autopopulatePollRef.current = null;
        setIsAutopopulatingFields(false);
      }
    }, POLL_INTERVAL_MS);
    autopopulatePollRef.current = intervalId;
  };

  useEffect(() => {
    return () => {
      if (autopopulatePollRef.current) clearInterval(autopopulatePollRef.current);
    };
  }, []);

  // When draft has case/file but fields are empty, poll for agent-extracted values (InjectionAgent runs async)
  useEffect(() => {
    if (!draftId || !draft || loading) return;
    const hasCase = draft.metadata?.case_id || selectedCaseId;
    const hasFile = uploadedFileName;
    const fieldsEmpty = Object.keys(fieldValues).length === 0 || Object.values(fieldValues).every(v => v == null || String(v).trim() === '');
    if ((hasCase || hasFile) && fieldsEmpty && draft.template_id) {
      pollForAutopopulatedFields(draftId, String(draft.template_id));
    }
  }, [draftId, draft?.template_id, draft?.metadata?.case_id, selectedCaseId, uploadedFileName, loading, fieldValues]);

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
      addActivity('Orchestrator', `Analyzing and attaching case context: ${caseTitle ?? caseId}`, 'completed');
      toast.success('Case attached. Form fields will update as soon as they are ready.');
      pollForAutopopulatedFields(draftId, draft?.template_id ? String(draft.template_id) : null);
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
        templateId: draft?.template_id ? String(draft.template_id) : undefined,
      });
      setUploadedFileName(file.name);

      if (draftId) {
        try { await setUploadedFileNameInDraft(draftId, file.name); } catch (e) { }
        const fileId = res?.file_id ?? res?.state?.file_id;
        if (fileId) {
          try { await linkFileToDraft(draftId, fileId, file.name); } catch (e) { }
        }
      }
      addActivity('System', `Extracting facts and evidence from ${file.name}...`, 'completed');
      toast.success('Document uploaded. Form fields will update as soon as they are ready.');
      if (draftId && draft?.template_id) {
        pollForAutopopulatedFields(draftId, String(draft.template_id));
      }
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
    setErrors({});
    try {
      setSaving(true);
      await updateDraftFields(draftId, fieldValues, Object.keys(fieldValues));
      // Sync to template_user_field_values so autopopulate agent does not overwrite user-edited fields
      if (draft?.template_id) {
        try {
          await saveTemplateUserFieldValues(
            draft.template_id,
            fieldValues,
            Object.keys(fieldValues),
            draftId
          );
        } catch (e) {
          console.warn('Save template-user-field-values failed (non-blocking):', e);
        }
      }
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
      // Fire and forget - silent save to ensure persistence (uses agent-draft-service)
      draftApi.saveSectionOrder(draftId, orderIds).catch(err => console.warn('Order auto-save failed', err));
    }
  };

  const handleFinalizeDraft = async () => {
    if (!draftId) return;

    // Save order (uses agent-draft-service)
    try {
      const orderIds = orderedSections.map(s => s.id);
      await draftApi.saveSectionOrder(draftId, orderIds);
    } catch (err) { console.warn("Saving order failed", err); }

    setIsFinalizing(true);
    try {
      // Iterate orderedSections to include Custom Sections in the save process
      const savePromises = orderedSections.map(async (section, index) => {
        const isDeleted = deletedSections.has(section.id);
        const detailLevel = sectionDetailLevels[section.id] || 'concise';

        return draftApi.saveSectionPrompt(draftId, section.id, {
          customPrompt: undefined,
          isDeleted: isDeleted,
          detailLevel: detailLevel,
          language: selectedLanguage,
          // Save name/type for all sections so Draft Sections page shows user-selected labels
          sectionName: section.title,
          sectionType: section.description,
          sortOrder: index // Explicitly save current index as sortOrder
        });
      });
      addActivity('Orchestrator', 'Configuring document structure and language preferences.', 'completed');
      setCurrentStep(5);
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
      addActivity('System', `Draft renamed to "${newDraftTitle.trim()}"`, 'completed');
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
      customPrompt: undefined,
      isDeleted: false
    };

    try {
      await draftApi.saveSectionPrompt(draftId, sectionId, newSection);

      const newItem = {
        id: sectionId,
        title: newSectionData.name,
        description: newSectionData.type,
        defaultPrompt: '',
        isCustom: true
      };

      setOrderedSections(prev => {
        const nextOrder = [...prev, newItem];
        // Auto-save the new order immediately (uses agent-draft-service)
        if (draftId) {
          const orderIds = nextOrder.map(s => s.id);
          draftApi.saveSectionOrder(draftId, orderIds).catch(err => console.warn('Order update failed after add', err));
        }
        return nextOrder;
      });
      setShowAddSectionModal(false);
      setNewSectionData({ name: '', type: 'clause' });
      addActivity('Orchestrator', `Added custom section: ${newSectionData.name}`, 'completed');
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

  // Map current Step ID to Step Name for WorkflowSidebar
  const currentStepId = DRAFT_STEPS[currentStep - 1]?.id || 'initialization';
  const completedSteps = DRAFT_STEPS.slice(0, currentStep - 1).map(s => s.id);

  return (
    <>
      <DraftingLayout
        currentStepId={currentStepId}
        completedSteps={completedSteps}
        activities={activities}
        headerContent={
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold text-slate-800 tracking-tight">
                    {draft.draft_title || draft.template_name}
                  </h1>
                  <button
                    onClick={handleOpenRenameModal}
                    className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-[#21C1B6] transition-all"
                  >
                    <PencilIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-bold uppercase">
                    ID: {draftId?.slice(0, 8)}
                  </span>
                  {saving ? (
                    <span className="text-[10px] text-[#21C1B6] font-bold animate-pulse">Saving...</span>
                  ) : lastSaved ? (
                    <span className="text-[10px] text-slate-400 font-medium">
                      Saved {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <button
              onClick={() => navigate('/draft-selection')}
              className="px-3 py-2 text-sm font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg border border-slate-200 transition-all"
            >
              Exit
            </button>
          </div>
        }
      >
        <div className="h-full">

          {/* STEP 1: INITIALIZATION */}
          {currentStep === 1 && (
            <div className="p-2 space-y-8 animate-slideIn h-full">
              <div className="space-y-2 pb-4 border-b border-slate-100">
                <h2 className="text-2xl font-bold text-slate-900">Initialization</h2>
                <p className="text-slate-500 text-sm">Setting the context for your legal document.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Option A: Attach Case */}
                <div className="space-y-5 p-7 bg-white rounded-3xl border border-slate-200 hover:border-[#21C1B6] transition-all duration-300 shadow-sm hover:shadow-xl group">
                  <div className="flex items-center gap-4 mb-2">
                    <div className="w-12 h-12 bg-slate-100 group-hover:bg-[#21C1B6] group-hover:text-white text-[#21C1B6] rounded-2xl flex items-center justify-center transition-all shadow-inner">
                      <Squares2X2Icon className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg text-slate-900">Attach Case</h3>
                      <p className="text-xs text-slate-500">Use case facts & history</p>
                    </div>
                  </div>

                  {attachedCaseTitle ? (
                    <div className="p-4 bg-[#21C1B6]/5 border border-[#21C1B6]/20 rounded-2xl flex items-center gap-4">
                      <div className="w-10 h-10 bg-[#21C1B6] text-white rounded-xl flex items-center justify-center shadow-lg">
                        <CheckCircleIcon className="w-6 h-6" />
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <p className="text-xs text-[#19a096] font-bold uppercase">Attached Context</p>
                        <p className="text-sm text-slate-900 truncate font-semibold">{attachedCaseTitle}</p>
                      </div>
                      <button onClick={() => { setSelectedCaseId(null); setAttachedCaseTitle(null); }} className="text-slate-300 hover:text-red-500 transition-colors">
                        <XMarkIcon className="w-5 h-5" />
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <select
                        className="w-full h-12 px-4 text-sm border-2 border-slate-100 rounded-2xl focus:ring-2 focus:ring-[#21C1B6] focus:border-[#21C1B6] bg-slate-50 transition-all"
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
                      {attachCaseLoading && <p className="text-[10px] text-[#21C1B6] font-bold animate-pulse px-2 uppercase tracking-widest">Processing Context...</p>}
                    </div>
                  )}
                </div>

                {/* Option B: Upload File */}
                <div className="space-y-5 p-7 bg-white rounded-3xl border border-slate-200 hover:border-[#21C1B6] transition-all duration-300 shadow-sm hover:shadow-xl group">
                  <div className="flex items-center gap-4 mb-2">
                    <div className="w-12 h-12 bg-slate-100 group-hover:bg-[#21C1B6] group-hover:text-white text-[#21C1B6] rounded-2xl flex items-center justify-center transition-all shadow-inner">
                      <ArrowUpTrayIcon className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg text-slate-900">Upload Data</h3>
                      <p className="text-xs text-slate-500">Extract facts from files</p>
                    </div>
                  </div>

                  {uploadedFileName ? (
                    <div className="p-4 bg-[#21C1B6]/5 border border-[#21C1B6]/20 rounded-2xl flex items-center gap-4">
                      <div className="w-10 h-10 bg-[#21C1B6] text-white rounded-xl flex items-center justify-center shadow-lg">
                        <DocumentTextIcon className="w-6 h-6" />
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <p className="text-xs text-[#19a096] font-bold uppercase">Data Source</p>
                        <p className="text-sm text-slate-900 truncate font-semibold">{uploadedFileName}</p>
                      </div>
                      <button onClick={() => setUploadedFileName(null)} className="text-slate-300 hover:text-red-500 transition-colors">
                        <XMarkIcon className="w-5 h-5" />
                      </button>
                    </div>
                  ) : (
                    <label className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-2xl cursor-pointer transition-all ${uploadFileLoading ? 'bg-slate-50 opacity-50' : 'border-slate-200 bg-slate-50/50 hover:bg-white hover:border-[#21C1B6]'}`}>
                      <div className="flex flex-col items-center justify-center">
                        {uploadFileLoading ? (
                          <ArrowPathIcon className="w-8 h-8 text-[#21C1B6] animate-spin" />
                        ) : (
                          <>
                            <PlusIcon className="w-6 h-6 text-slate-400 mb-1" />
                            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-tighter">Add File</p>
                          </>
                        )}
                      </div>
                      <input type="file" className="hidden" onChange={handleFileUpload} accept=".pdf,.docx,.doc,.txt" />
                    </label>
                  )}
                </div>
              </div>

              {/* Spinner and message while autopopulating form fields */}
              {isAutopopulatingFields && (
                <div className="flex items-center gap-3 p-4 bg-[#21C1B6]/10 border border-[#21C1B6]/20 rounded-2xl">
                  <ArrowPathIcon className="w-6 h-6 text-[#21C1B6] animate-spin flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Fetching form fields from document...</p>
                    <p className="text-xs text-slate-500">Next step will be enabled when fields are ready.</p>
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-8 border-t border-slate-100">
                <button
                  onClick={() => {
                    setCurrentStep(2);
                    addActivity('Drafter Agent', 'Case analysis complete. Ready to generate content.', 'in-progress');
                  }}
                  disabled={isAutopopulatingFields}
                  className={`h-11 flex items-center gap-3 px-8 rounded-2xl font-bold shadow-xl transition-all active:scale-95 ${
                    isAutopopulatingFields
                      ? 'bg-slate-300 text-slate-500 cursor-not-allowed shadow-none'
                      : 'bg-[#21C1B6] hover:bg-[#19a096] text-white hover:scale-105 shadow-[#21C1B6]/20'
                  }`}
                >
                  Continue to Drafting
                  <ChevronRightIcon className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: FORM INPUTS */}
          {currentStep === 2 && (
            <div className="animate-slideIn h-full flex flex-col space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900">Form Inputs</h2>
                    <p className="text-slate-500 text-sm">Provide basic document details for AI generation.</p>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar px-1">
                <div className="bg-white border-2 border-slate-100 rounded-3xl p-8 shadow-sm">
                  {sections.length === 0 ? (
                    <div className="text-center py-20 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                      <DocumentTextIcon className="w-16 h-16 mx-auto mb-4 text-slate-200" />
                      <p className="text-slate-500 font-bold uppercase tracking-widest text-[10px]">No inputs required</p>
                    </div>
                  ) : (
                    <div className="space-y-10">
                      {sections.map(({ sectionName, fields: secFields }) => (
                        <div key={sectionName} className="space-y-6">
                          <div className="flex items-center gap-4">
                            <div className="w-8 h-8 bg-[#21C1B6]/10 rounded-lg flex items-center justify-center">
                              <DocumentTextIcon className="w-5 h-5 text-[#21C1B6]" />
                            </div>
                            <h3 className="text-sm font-black text-slate-700 uppercase tracking-[0.15em]">
                              {sectionName}
                            </h3>
                            <div className="h-px flex-1 bg-gradient-to-r from-slate-100 to-transparent" />
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-6">
                            {secFields.map((field) => (
                              <div key={field.id} className="space-y-1.5 group">
                                <label className="block text-[11px] font-bold text-slate-500 tracking-tight ml-1">
                                  {field.field_label || field.field_name}
                                </label>
                                <div className="relative">
                                  <input
                                    type={field.field_type === 'date' ? 'date' : 'text'}
                                    className="h-11 w-full text-sm rounded-xl border-2 border-slate-100 px-4 focus:ring-4 focus:ring-[#21C1B6]/5 focus:border-[#21C1B6] transition-all bg-slate-50/50 hover:bg-white hover:border-slate-200 font-medium text-slate-700 placeholder:text-slate-300 placeholder:font-normal"
                                    value={fieldValues[field.field_name] || ''}
                                    onChange={(e) => handleFieldChange(field.field_name, e.target.value)}
                                    placeholder={field.placeholder || 'Enter details...'}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-between pt-6 border-t border-slate-100 flex-shrink-0">
                <button onClick={() => setCurrentStep(1)} className="h-11 flex items-center gap-2 px-6 text-slate-500 hover:text-slate-900 font-bold">
                  <ArrowLeftIcon className="w-5 h-5" /> Back
                </button>
                <button
                  onClick={async () => {
                    const ok = await saveToBackend(true);
                    if (ok) {
                      addActivity('Orchestrator', 'Inputs validated. Preparing section configuration structure.', 'completed');
                      setCurrentStep(3);
                    }
                  }}
                  className="h-11 flex items-center gap-3 bg-[#21C1B6] hover:bg-[#19a096] text-white px-8 rounded-2xl font-bold shadow-xl transition-all hover:scale-105 shadow-[#21C1B6]/20"
                >
                  Configure Sections
                  <ChevronRightIcon className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: SECTION CONFIG */}
          {currentStep === 3 && (
            <div className="animate-slideIn h-full flex flex-col space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900">Configure Sections</h2>
                    <p className="text-slate-500 text-sm">Select which sections to generate and customize their instructions.</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Draft Language</p>
                    <select
                      value={selectedLanguage}
                      onChange={(e) => setSelectedLanguage(e.target.value)}
                      className="bg-white border-2 border-slate-100 rounded-xl text-sm font-bold px-4 py-2 focus:ring-[#21C1B6] focus:border-[#21C1B6] outline-none min-w-[150px] transition-all"
                    >
                      {INDIAN_LANGUAGES.map(lang => (
                        <option key={lang.code} value={lang.code}>{lang.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar px-1">
                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Drag to Reorder</h3>
                    <button
                      onClick={() => setShowAddSectionModal(true)}
                      className="text-xs font-bold text-[#21C1B6] border-2 border-[#21C1B6]/10 px-5 py-2 rounded-xl hover:bg-[#21C1B6] hover:text-white hover:border-[#21C1B6] transition-all shadow-sm flex items-center gap-2"
                    >
                      <PlusIcon className="w-4 h-4" /> Add Custom Section
                    </button>
                  </div>

                  <Reorder.Group axis="y" values={orderedSections} onReorder={handleReorderSections} className="space-y-4 pb-10">
                    {(() => {
                      let activeNumber = 0;
                      return orderedSections.map((section) => {
                        const isDeleted = deletedSections.has(section.id);
                        if (!isDeleted) activeNumber++;

                        return (
                          <Reorder.Item
                            key={section.id}
                            value={section}
                            className={`group bg-white border-2 rounded-2xl transition-all duration-300 ${isDeleted
                              ? 'opacity-60 border-slate-100'
                              : 'border-slate-100 shadow-sm hover:border-[#21C1B6]/50 hover:shadow-xl cursor-grab active:cursor-grabbing'
                              }`}
                          >
                            <div className="p-4">
                              <div className="flex items-start gap-4 mb-3">
                                <input
                                  type="checkbox"
                                  checked={!isDeleted}
                                  onChange={() => toggleSectionDeletion(section.id)}
                                  className="mt-1 w-5 h-5 rounded-md border-2 border-slate-200 text-[#21C1B6] focus:ring-[#21C1B6] transition-all cursor-pointer"
                                />

                                <div className="flex-1">
                                  <div className="flex items-center justify-between mb-0.5">
                                    <h4 className={`text-base font-bold transition-all ${isDeleted ? 'text-slate-400' : 'text-slate-900'}`}>
                                      {!isDeleted ? `${activeNumber}. ` : ''}{section.title.replace(/^\d+\.\s*/, '')}
                                    </h4>

                                    <div className="flex items-center gap-3">
                                      {!isDeleted && (
                                        <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
                                          {DETAIL_LEVELS.map((level) => (
                                            <button
                                              key={level.value}
                                              onClick={() => setSectionDetailLevels(prev => ({ ...prev, [section.id]: level.value }))}
                                              className={`px-2.5 py-0.5 text-[10px] font-bold rounded-md transition-all ${(sectionDetailLevels[section.id] || 'concise') === level.value
                                                ? 'bg-white text-[#21C1B6] shadow-sm'
                                                : 'text-slate-400 hover:text-slate-600'
                                                }`}
                                            >
                                              {level.label}
                                            </button>
                                          ))}
                                        </div>
                                      )}

                                      <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-widest ${isDeleted ? 'bg-slate-100 text-slate-400' : 'bg-[#21C1B6]/10 text-[#21C1B6]'
                                        }`}>
                                        {isDeleted ? 'Excluded' : 'Active'}
                                      </span>
                                    </div>
                                  </div>
                                  <p className="text-[11px] text-slate-500 font-medium">
                                    {section.description || section.type}
                                  </p>
                                </div>
                              </div>

                              {/* Section prompts are backend-only and sent to LLM at generation time - not shown or editable on frontend */}
                            </div>
                          </Reorder.Item>
                        );
                      });
                    })()}
                  </Reorder.Group>
                </div>
              </div>

              <div className="flex justify-between pt-6 border-t border-slate-100 flex-shrink-0">
                <button onClick={() => setCurrentStep(2)} className="h-11 flex items-center gap-3 px-8 text-slate-500 hover:text-slate-900 font-bold transition-all rounded-2xl hover:bg-slate-50">
                  <ArrowLeftIcon className="w-5 h-5" /> Back
                </button>
                <button
                  onClick={handleFinalizeDraft}
                  className="h-11 flex items-center gap-3 bg-[#21C1B6] text-white px-10 rounded-2xl font-bold shadow-xl transition-all hover:scale-105 active:scale-95 hover:bg-[#19a096] shadow-[#21C1B6]/20"
                >
                  {isFinalizing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Saving Config...
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

          {/* STEP 4: VALIDATION */}
          {currentStep === 4 && (
            <div className="p-10 flex flex-col items-center justify-center h-full text-center space-y-6 animate-pulse">
              <div className="w-24 h-24 bg-[#21C1B6]/10 rounded-full flex items-center justify-center">
                <ShieldCheckIcon className="w-12 h-12 text-[#21C1B6]" />
              </div>
              <div className="max-w-md">
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Legal Logic Validation</h2>
                <p className="text-slate-500">Our specialized Legal Auditor agent is currently cross-referencing your inputs with jurisdictional requirements and procedural rules.</p>
              </div>
              <div className="w-64 h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-[#21C1B6] w-2/3 rounded-full animate-marquee" />
              </div>
              <div className="flex gap-4 mt-8">
                <button
                  onClick={() => setCurrentStep(3)}
                  className="px-8 py-2.5 bg-white text-slate-600 border border-slate-200 rounded-xl font-bold hover:bg-slate-50 transition-all"
                >
                  Back
                </button>
                <button
                  onClick={() => {
                    addActivity('Legal Auditor', 'Validation complete. No conflicts found.', 'completed');
                    addActivity('Drafter Agent', 'Starting generation of detailed sections.', 'in-progress');
                    setCurrentStep(5);
                  }}
                  className="px-8 py-2.5 bg-[#21C1B6] text-white rounded-xl font-bold shadow-lg shadow-[#21C1B6]/20 transition-all hover:scale-105"
                >
                  Continue to Review
                </button>
              </div>
            </div>
          )}

          {/* STEP 5: REVIEW - no outer scrollbar; only inner section preview scrolls */}
          {currentStep === 5 && (
            <div className="animate-slideIn h-full overflow-hidden flex flex-col">
              <SectionDraftingPage
                draftIdProp={draftId}
                addActivity={addActivity}
                onAssembleComplete={(response) => {
                  setLastAssembleResult(response);
                  setCurrentStep(6);
                }}
                onBack={() => setCurrentStep(3)}
              />
            </div>
          )}

          {/* STEP 6: ASSEMBLY */}
          {currentStep === 6 && (
            <div className={`animate-slideIn h-full overflow-y-auto custom-scrollbar flex flex-col ${isGoogleDocsActive ? 'overflow-hidden' : ''}`}>
              <AssembledPreviewPage
                draftIdProp={draftId}
                addActivity={addActivity}
                onBack={() => setCurrentStep(3)}
                onToggleEditor={(active) => setIsGoogleDocsActive(active)}
                initialAssembleResult={lastAssembleResult}
              />
            </div>
          )}
        </div>
      </DraftingLayout>

      {/* Rename Modal */}
      {showRenameModal && (
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
      )}

      {/* Add Custom Section Modal */}
      {showAddSectionModal && (
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
              {/* Prompts are backend-only - sent to LLM at generation time */}
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
      )}

      {/* Styles for animations */}
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes scaleIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        .animate-fadeIn { animation: fadeIn 0.3s ease-out; }
        .animate-slideIn { animation: slideIn 0.4s ease-out; }
        .animate-scaleIn { animation: scaleIn 0.25s ease-out; }
      `}</style>
    </>
  );
};

export default DraftFormPage;