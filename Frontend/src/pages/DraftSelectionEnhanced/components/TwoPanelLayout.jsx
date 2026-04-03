import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ChatBubbleLeftRightIcon, XMarkIcon, BookmarkIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import TemplatePreviewPanel from './TemplatePreviewPanel';
import ChatAndFormPanel from './ChatAndFormPanel';
import ExportActions from '../../../components/Export/ExportActions';
import EvidenceUploadModal from '../../../components/Evidence/EvidenceUploadModal';
import { createDraft, getDraft, exportDraft, getPreview, finalizeDraft } from '../../../services/draftTemplateApi';
import { useEvidence } from '../../../hooks/useEvidence';
import { toast } from 'react-toastify';

const TwoPanelLayout = ({ template, onClose, isLoading }) => {
  const [isMobile, setIsMobile] = useState(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(true);
  const [isFormPanelOpen, setIsFormPanelOpen] = useState(true);
  const [draft, setDraft] = useState(null);
  const [isLoadingDraft, setIsLoadingDraft] = useState(false);
  const [versionHistory, setVersionHistory] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [evidenceModalOpen, setEvidenceModalOpen] = useState(false);
  const manualSaveFnRef = useRef(null);

  const refetchDraft = useCallback(async () => {
    if (!draft?.id) return;
    try {
      const updatedDraft = await getDraft(draft.id);
      setDraft(updatedDraft);
      setHasUnsavedChanges(false);
    } catch (err) {
      console.error('Error refetching draft:', err);
      toast.error('Failed to refresh draft. Please try again.');
    }
  }, [draft?.id]);

  const evidence = useEvidence(draft?.id, !!draft?.id);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Create draft when template is selected
  useEffect(() => {
    if (template?.id && !draft && !isLoadingDraft) {
      createDraftFromTemplate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.id]);

  const createDraftFromTemplate = async () => {
    if (!template?.id) return;
    
    try {
      setIsLoadingDraft(true);
      console.log('Creating draft from template:', template.id);
      
      const newDraft = await createDraft(template.id, `${template.name || template.title} - Draft`);
      console.log('Draft created:', newDraft);
      
      // Load full draft with blocks
      console.log('Loading full draft with blocks...');
      const fullDraft = await getDraft(newDraft.id);
      console.log('Full draft loaded:', fullDraft);
      console.log('Draft blocks:', fullDraft?.blocks);
      console.log('Draft schema:', fullDraft?.schema);
      console.log('Template schema fields:', template?.schema?.fields);
      
      // Verify blocks match schema fields
      if (fullDraft?.blocks && template?.schema?.fields) {
        const schemaKeys = new Set(template.schema.fields.map(f => f.key));
        const blockKeys = new Set(fullDraft.blocks.map(b => b.key));
        const missingBlocks = template.schema.fields.filter(f => !blockKeys.has(f.key));
        
        if (missingBlocks.length > 0) {
          console.warn('Some schema fields have no corresponding blocks:', missingBlocks.map(f => f.key));
        }
        
        console.log('Schema keys:', Array.from(schemaKeys));
        console.log('Block keys:', Array.from(blockKeys));
      }
      
      setDraft(fullDraft);
      setIsLoadingDraft(false);
    } catch (error) {
      console.error('Error creating draft:', error);
      console.error('Error stack:', error.stack);
      setIsLoadingDraft(false);
      
      // More specific error message
      const errorMessage = error.message?.includes('Internal server error') 
        ? 'Server error: Some template blocks are missing required fields. Please contact support.'
        : error.message || 'Failed to initialize draft. Please try again.';
      
      toast.error(errorMessage);
    }
  };

  // Handle draft updates from child components
  // ⚠️ GOLDEN RULE: Always refetch - never mutate locally
  const handleDraftUpdate = async (updatedDraft) => {
    // updatedDraft comes from refetch after mutation
    // This is the server's truth - use it directly
    setDraft(updatedDraft);
    setHasUnsavedChanges(false); // Changes are saved
  };

  // Handle unsaved changes flag from form
  const handleUnsavedChanges = (hasChanges) => {
    setHasUnsavedChanges(hasChanges);
  };

  // Manual save handler
  const handleManualSave = useCallback(async () => {
    if (!draft?.id || isSaving || !hasUnsavedChanges) return;

    setIsSaving(true);
    
    try {
      // Call manual save function from form panel
      if (manualSaveFnRef.current) {
        const saved = await manualSaveFnRef.current();
        
        if (saved) {
          // Success - state will be updated by onDraftUpdate
          setTimeout(() => setIsSaving(false), 500);
        } else {
          setIsSaving(false);
          toast.info('No changes to save');
        }
      } else {
        setIsSaving(false);
        toast.warning('Save function not available. Please wait a moment and try again.');
      }
    } catch (error) {
      console.error('Error in manual save:', error);
      setIsSaving(false);
      toast.error('Failed to save draft');
    }
  }, [draft?.id, isSaving, hasUnsavedChanges]);

  // Receive manual save function from form panel
  const handleManualSaveRequest = useCallback((saveFn) => {
    if (typeof saveFn === 'function') {
      manualSaveFnRef.current = saveFn;
    }
  }, []);

  // Export / Preview / Finalize
  const handleExport = useCallback(async () => {
    if (!draft?.id) return;
    setExporting(true);
    try {
      const result = await exportDraft(draft.id);
      toast.success(`Document exported! Download expires in ${result.expiresIn || '60 minutes'}.`);
      if (result.downloadUrl) window.open(result.downloadUrl, '_blank');
    } catch (err) {
      console.error('Export error:', err);
      toast.error(err.message || 'Failed to export document');
    } finally {
      setExporting(false);
    }
  }, [draft?.id]);

  const handlePreview = useCallback(async () => {
    if (!draft?.id) return;
    try {
      const html = await getPreview(draft.id);
      const w = window.open('', '_blank');
      w.document.write(html);
      w.document.close();
    } catch (err) {
      console.error('Preview error:', err);
      toast.error(err.message || 'Failed to load preview');
    }
  }, [draft?.id]);

  const handleFinalize = useCallback(async () => {
    if (!draft?.id) return;
    const confirmed = window.confirm(
      'Are you sure you want to finalize this draft? You will not be able to edit it after finalization.'
    );
    if (!confirmed) return;
    try {
      await finalizeDraft(draft.id);
      toast.success('Draft finalized successfully!');
      refetchDraft();
    } catch (err) {
      console.error('Finalize error:', err);
      toast.error(err.message || 'Failed to finalize draft');
    }
  }, [draft?.id, refetchDraft]);

  const handleEvidenceUpload = useCallback(
    async (file) => {
      await evidence.upload(file);
      setEvidenceModalOpen(false);
      toast.success('Evidence uploaded successfully');
    },
    [evidence]
  );

  if (isLoading || isLoadingDraft) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#21C1B6] mx-auto mb-4"></div>
          <p className="text-gray-600">{isLoading ? 'Loading template...' : 'Initializing draft...'}</p>
        </div>
      </div>
    );
  }

  if (!template) {
    return null;
  }

  return (
    <div className="two-panel-layout h-screen flex flex-col overflow-hidden bg-gray-50">
      {/* Header */}
      <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center space-x-4">
          <button
            onClick={onClose}
            className="close-button p-2 rounded-lg hover:bg-gray-100 transition-colors duration-200"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {template.name || template.title}
            </h1>
            {template.category && (
              <p className="text-sm text-gray-600 mt-1">
                {template.category}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Export / Preview / Finalize */}
          {draft?.id && (
            <ExportActions
              draftId={draft.id}
              draftStatus={draft.status}
              onExport={handleExport}
              onPreview={handlePreview}
              onFinalize={handleFinalize}
              exporting={exporting}
            />
          )}
          {/* Save Draft Button */}
          {draft?.id && (
            <button
              type="button"
              onClick={handleManualSave}
              disabled={isSaving || !hasUnsavedChanges}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-200 ${
                isSaving
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : hasUnsavedChanges
                  ? 'bg-[#21C1B6] text-white hover:bg-[#1AA49B] shadow-sm'
                  : 'bg-gray-100 text-gray-500 cursor-not-allowed'
              }`}
              aria-label="Save Draft"
            >
              {isSaving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-400 border-t-transparent"></div>
                  <span>Saving...</span>
                </>
              ) : hasUnsavedChanges ? (
                <>
                  <BookmarkIcon className="w-4 h-4" />
                  <span>Save Draft</span>
                </>
              ) : (
                <>
                  <CheckCircleIcon className="w-4 h-4" />
                  <span>Saved</span>
                </>
              )}
            </button>
          )}

          {!isRightPanelOpen && (
            <button
              type="button"
              onClick={() => setIsRightPanelOpen(true)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium text-gray-700 transition-colors duration-200"
              aria-label="Open AI Assistant and Form Fields"
            >
              <ChatBubbleLeftRightIcon className="w-5 h-5 text-gray-600" />
              <span className="hidden sm:inline">Open AI & Fields</span>
            </button>
          )}
        </div>
      </div>

      {/* Two Panel Layout */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Panel - Template Preview */}
        <div
          className={`panel-left flex-1 ${
            isRightPanelOpen ? 'lg:w-1/2 border-r border-gray-200' : 'lg:w-full'
          } overflow-hidden bg-white`}
        >
          <TemplatePreviewPanel 
            template={template} 
            draft={draft}
            onDraftUpdate={handleDraftUpdate}
          />
        </div>

        {/* Right Panel - Chat + Form */}
        {isRightPanelOpen && (
          <div className="panel-right flex-1 lg:w-1/2 overflow-hidden bg-gray-50 flex flex-col">
            <ChatAndFormPanel
              template={template}
              draft={draft}
              onDraftUpdate={handleDraftUpdate}
              onRefetchDraft={refetchDraft}
              onUnsavedChanges={handleUnsavedChanges}
              onManualSaveRequest={handleManualSaveRequest}
              onClose={() => setIsRightPanelOpen(false)}
              onCloseAi={() => setIsAiPanelOpen(false)}
              onCloseForm={() => setIsFormPanelOpen(false)}
              isAiPanelOpen={isAiPanelOpen}
              isFormPanelOpen={isFormPanelOpen}
              onReopenAi={() => setIsAiPanelOpen(true)}
              onReopenForm={() => setIsFormPanelOpen(true)}
              isMobile={isMobile}
              evidenceList={evidence.list}
              onUploadEvidence={async (file) => {
                await evidence.upload(file);
                setEvidenceModalOpen(false);
                toast.success('Evidence uploaded successfully');
              }}
            />
          </div>
        )}
      </div>

      {/* Evidence Upload Modal */}
      <EvidenceUploadModal
        isOpen={evidenceModalOpen}
        onClose={() => setEvidenceModalOpen(false)}
        onUpload={handleEvidenceUpload}
        draftId={draft?.id}
      />
    </div>
  );
};

export default TwoPanelLayout;
