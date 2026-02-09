import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PaperAirplaneIcon, XMarkIcon, ChatBubbleLeftRightIcon, DocumentTextIcon, SparklesIcon, DocumentArrowUpIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { updateDraftFields, getDraft, aiSuggest, insertAiSuggestion } from '../../../services/draftTemplateApi';
import { toast } from 'react-toastify';
import EvidenceUploadModal from '../../../components/Evidence/EvidenceUploadModal';
import { formatFileSize } from '../../../utils/fileHelpers';

const ChatAndFormPanel = ({ 
  template, 
  draft,
  onDraftUpdate,
  onRefetchDraft,
  onUnsavedChanges,
  onManualSaveRequest,
  onClose, 
  onCloseAi,
  onCloseForm,
  isAiPanelOpen = true,
  isFormPanelOpen = true,
  onReopenAi,
  onReopenForm,
  isMobile,
  evidenceList = [],
  onUploadEvidence,
}) => {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [formData, setFormData] = useState({});
  const [originalFormData, setOriginalFormData] = useState({});
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [currentFieldContext, setCurrentFieldContext] = useState(null); // { key, label } when AI Assist clicked
  const [selectedEvidenceFiles, setSelectedEvidenceFiles] = useState([]);
  const [evidenceModalOpen, setEvidenceModalOpen] = useState(false);
  const [pendingSuggestion, setPendingSuggestion] = useState(null); // { suggestionId, content, targetBlock }
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const saveTimeoutRef = useRef(null);

  // Initialize form data from draft blocks or template schema
  useEffect(() => {
    console.log('Initializing form data:', { draft, template });
    
    if (draft?.blocks) {
      // Load form data from draft blocks
      // Match blocks to schema fields to identify form fields
      const schemaFieldKeys = new Set((template?.schema?.fields || []).map(f => f.key));
      const draftData = {};
      
      console.log('Schema field keys:', Array.from(schemaFieldKeys));
      console.log('Draft blocks:', draft.blocks);
      
      draft.blocks.forEach((block) => {
        // Check if this block is a schema field (form field)
        if (schemaFieldKeys.has(block.key)) {
          const value = block.content?.value;
          console.log(`Block ${block.key}: value =`, value, 'type:', typeof value);
          if (value !== undefined && value !== null) {
            draftData[block.key] = value;
          }
        }
      });
      
      // Also initialize any missing fields from schema
      if (template?.schema?.fields) {
        template.schema.fields.forEach((field) => {
          if (draftData[field.key] === undefined) {
            draftData[field.key] = field.defaultValue || '';
          }
        });
      }
      
      console.log('Final form data:', draftData);
      setFormData(draftData);
      setOriginalFormData(JSON.parse(JSON.stringify(draftData))); // Deep copy for comparison
    } else if (template?.schema?.fields) {
      // Initialize from template schema
      const initialData = {};
      template.schema.fields.forEach((field) => {
        initialData[field.key] = field.defaultValue || '';
      });
      console.log('Initial form data from schema:', initialData);
      setFormData(initialData);
      setOriginalFormData(JSON.parse(JSON.stringify(initialData))); // Deep copy
    }
  }, [draft, template]);

  // Check for unsaved changes
  useEffect(() => {
    if (onUnsavedChanges && Object.keys(formData).length > 0) {
      try {
        const hasChanges = JSON.stringify(formData) !== JSON.stringify(originalFormData);
        onUnsavedChanges(hasChanges);
      } catch (error) {
        console.error('Error comparing form data:', error);
        // Fallback: compare keys and values manually
        const hasChanges = Object.keys(formData).some(key => formData[key] !== originalFormData[key]);
        onUnsavedChanges(hasChanges);
      }
    }
  }, [formData, originalFormData, onUnsavedChanges]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [inputMessage]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle AI Assist button click - set field context
  const handleAIAssist = useCallback((fieldKey, fieldLabel) => {
    setCurrentFieldContext({ key: fieldKey, label: fieldLabel });
    // Pre-fill prompt hint in input
    setInputMessage(`Generate content for "${fieldLabel}"`);
    // Focus the textarea
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, []);

  // Handle evidence upload
  const handleEvidenceUpload = useCallback(async (file) => {
    if (!onUploadEvidence) return;
    try {
      await onUploadEvidence(file);
      setEvidenceModalOpen(false);
      toast.success('Evidence uploaded successfully');
      // Evidence list will be updated by parent component
    } catch (err) {
      console.error('Evidence upload error:', err);
      toast.error(err.message || 'Failed to upload evidence');
    }
  }, [onUploadEvidence]);

  const handleSendMessage = useCallback(async () => {
    if (!inputMessage.trim() || isAiLoading) {
      return;
    }

    if (!draft?.id) {
      toast.error('Draft not initialized. Please wait...');
      return;
    }

    const userPrompt = inputMessage.trim();
    const userMessage = {
      id: Date.now(),
      role: 'user',
      content: userPrompt,
      timestamp: new Date()
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputMessage('');
    setIsAiLoading(true);

    try {
      // Determine target block (field context or null for general chat)
      const targetBlock = currentFieldContext?.key || null;
      
      // Build request body
      // Only set targetBlock if we have a valid field context, otherwise use 'general' for general chat
      const requestBody = {
        targetBlock: targetBlock || 'general',
        prompt: userPrompt,
        responseSize: 'medium',
      };

      // If evidence files selected, use state-aware mode
      if (selectedEvidenceFiles.length > 0 && Array.isArray(selectedEvidenceFiles)) {
        requestBody.stateAware = true;
        requestBody.fileIds = selectedEvidenceFiles;
        requestBody.instruction = userPrompt;
      }

      // Call AI suggest API
      const response = await aiSuggest(draft.id, requestBody);
      
      if (!response || !response.suggestion) {
        throw new Error('Invalid response from AI service');
      }

      const { suggestion } = response;

      // Store pending suggestion for insertion
      // Use the original targetBlock from currentFieldContext, not what backend returns
      // Backend might return 'general' but we want to preserve the actual field key
      // If currentFieldContext exists, use its key; otherwise use what backend returned (might be 'general')
      const actualTargetBlock = currentFieldContext?.key || (suggestion.targetBlock && suggestion.targetBlock !== 'general' ? suggestion.targetBlock : null);
      
      if (suggestion.suggestionId) {
        setPendingSuggestion({
          suggestionId: suggestion.suggestionId,
          content: suggestion.content || '',
          targetBlock: actualTargetBlock || 'general',
        });
      }

      // Add AI response to chat
      // Only include targetBlock if it's a valid field (not 'general')
      // This determines whether to show the Insert button
      const aiMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        content: suggestion.content || 'No content generated',
        suggestionId: suggestion.suggestionId,
        targetBlock: actualTargetBlock, // null if no field context, or the actual field key (e.g., 'place_of_execution')
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, aiMessage]);
      
      // Clear field context after generation
      if (currentFieldContext) {
        setCurrentFieldContext(null);
      }
    } catch (error) {
      console.error('AI generation error:', error);
      const errorMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        content: `Sorry, I couldn't generate content. ${error?.message || 'Please try again.'}`,
        timestamp: new Date(),
        isError: true,
      };
      setMessages((prev) => [...prev, errorMessage]);
      toast.error(error?.message || 'Failed to generate content');
    } finally {
      setIsAiLoading(false);
    }
  }, [inputMessage, isAiLoading, draft?.id, currentFieldContext, selectedEvidenceFiles]);

  // Insert AI suggestion into field
  const handleInsertSuggestion = useCallback(async (suggestionId, targetBlock) => {
    if (!draft?.id || !suggestionId) {
      toast.error('Missing draft ID or suggestion ID');
      return;
    }

    // If no targetBlock, this is general chat - can't insert
    if (!targetBlock || targetBlock === 'general') {
      toast.warning('Please use AI Assist on a specific field to insert content');
      return;
    }

    try {
      // Insert suggestion via API (creates new version)
      await insertAiSuggestion(draft.id, suggestionId);
      
      // Clear pending suggestion
      setPendingSuggestion(null);
      
      // Add confirmation message
      const fieldLabel = template?.schema?.fields?.find(f => f.key === targetBlock)?.label || targetBlock;
      const confirmMessage = {
        id: Date.now(),
        role: 'assistant',
        content: `✓ Content inserted into "${fieldLabel}" field`,
        timestamp: new Date(),
        isSystem: true,
      };
      setMessages((prev) => [...prev, confirmMessage]);
      
      // Refetch draft to get updated state (backend has already updated the field)
      if (onRefetchDraft) {
        await onRefetchDraft();
      }
      
      // Also update local form data if we have the content
      if (Array.isArray(messages)) {
        const suggestionMsg = messages.find(m => m && m.suggestionId === suggestionId);
        if (suggestionMsg && suggestionMsg.content) {
          setFormData((prev) => ({
            ...prev,
            [targetBlock]: suggestionMsg.content,
          }));
        }
      }
      
      toast.success('Content inserted successfully');
    } catch (error) {
      console.error('Insert suggestion error:', error);
      toast.error(error.message || 'Failed to insert content');
    }
  }, [draft?.id, messages, template?.schema?.fields, onRefetchDraft]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Debounced save function
  // ⚠️ GOLDEN RULE: Always refetch after mutation - Backend owns truth
  const saveFieldChanges = useCallback(async (fieldsToSave, immediate = false) => {
    if (!draft?.id) {
      console.error('❌ Cannot save: Draft ID is missing', { draft, fieldsToSave });
      toast.error('Draft not initialized. Please refresh the page.');
      return;
    }

    // Validate fields object
    if (!fieldsToSave || typeof fieldsToSave !== 'object' || Object.keys(fieldsToSave).length === 0) {
      console.warn('⚠️ No fields to save:', fieldsToSave);
      return;
    }

    console.log('💾 Saving field changes:', { 
      draftId: draft.id, 
      fieldsToSave,
      fieldCount: Object.keys(fieldsToSave).length
    });

    try {
      setIsSaving(true);
      
      // PUT /api/drafts/:id/fields - Creates new version
      console.log('📡 Calling updateDraftFields API...');
      const result = await updateDraftFields(draft.id, fieldsToSave);
      console.log('✅ Update result:', result);
      
      // 🔄 CRITICAL: MUST refetch draft after mutation
      // Backend creates new version with updated blocks
      // We cannot mutate locally - server is source of truth
      console.log('🔄 Refetching draft to get updated blocks...');
      const updatedDraft = await getDraft(draft.id);
      console.log('✅ Refetched draft:', {
        id: updatedDraft.id,
        blockCount: updatedDraft.blocks?.length,
        blocks: updatedDraft.blocks
      });
      
      // Verify the saved values are in the refetched draft
      Object.keys(fieldsToSave).forEach(fieldKey => {
        const block = updatedDraft.blocks?.find(b => b.key === fieldKey);
        if (block) {
          console.log(`✅ Field ${fieldKey}: saved value = ${block.content?.value}, expected = ${fieldsToSave[fieldKey]}`);
        } else {
          console.warn(`⚠️ Field ${fieldKey}: No block found in refetched draft`);
        }
      });
      
      // Update original form data to reflect saved state (deep copy)
      const newOriginalData = { ...formData, ...fieldsToSave };
      setOriginalFormData(JSON.parse(JSON.stringify(newOriginalData)));
      
      if (onDraftUpdate) {
        console.log('📤 Calling onDraftUpdate with updated draft');
        onDraftUpdate(updatedDraft);
      }
      
      setIsSaving(false);
      
      if (immediate) {
        toast.success('Draft saved successfully');
      } else {
        console.log('✅ Auto-save completed successfully');
      }
    } catch (error) {
      console.error('❌ Error saving fields:', error);
      console.error('❌ Error details:', {
        message: error.message,
        stack: error.stack,
        draftId: draft?.id,
        fieldsToSave,
        draftBlocks: draft?.blocks?.map(b => ({ key: b.key, value: b.content?.value }))
      });
      setIsSaving(false);
      toast.error(`Failed to save fields: ${error.message || 'Unknown error'}`);
    }
  }, [draft?.id, draft?.blocks, formData, onDraftUpdate]);

  // Manual save function (called by parent's Save button)
  const performManualSave = useCallback(async () => {
    if (!draft?.id || isSaving) {
      return false;
    }
    
    try {
      // Get all changed fields
      const changedFields = {};
      Object.keys(formData).forEach(key => {
        const currentValue = formData[key];
        const originalValue = originalFormData[key];
        
        // Compare values (handle null/undefined)
        if (currentValue !== originalValue) {
          changedFields[key] = currentValue;
        }
      });
      
      if (Object.keys(changedFields).length > 0) {
        await saveFieldChanges(changedFields, true);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error in performManualSave:', error);
      return false;
    }
  }, [draft?.id, formData, originalFormData, isSaving, saveFieldChanges]);

  // Expose manual save function to parent
  useEffect(() => {
    if (onManualSaveRequest && typeof performManualSave === 'function') {
      try {
        onManualSaveRequest(performManualSave);
      } catch (error) {
        console.error('Error exposing manual save function:', error);
      }
    }
  }, [onManualSaveRequest, performManualSave]);

  const handleFieldChange = (fieldKey, value) => {
    console.log('Field changed:', fieldKey, '=', value, 'Draft ID:', draft?.id);
    
    // Update local state immediately (for UI responsiveness)
    setFormData((prev) => ({
      ...prev,
      [fieldKey]: value
    }));

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce auto-save (300ms)
    // ⚠️ GOLDEN RULE: Auto-save creates new version, but user can also manually save
    saveTimeoutRef.current = setTimeout(() => {
      if (draft?.id) {
        const fieldsToSave = {
          [fieldKey]: value
        };
        console.log('Auto-saving fields:', fieldsToSave);
        saveFieldChanges(fieldsToSave, false).catch(error => {
          console.error('Auto-save failed:', error);
        });
      } else {
        console.warn('Cannot save: No draft ID available');
      }
    }, 300);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const schema = template?.schema || {};
  const fields = schema.fields || [];

  // If both panels are closed, show reopen buttons
  if (!isAiPanelOpen && !isFormPanelOpen) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-gray-50 p-4">
        <div className="text-center space-y-4">
          <p className="text-sm text-gray-600 mb-4">Panels closed</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {onReopenAi && (
              <button
                type="button"
                onClick={onReopenAi}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium text-gray-700 transition-colors duration-200"
              >
                <ChatBubbleLeftRightIcon className="w-5 h-5 text-gray-600" />
                <span>Open AI Assistant</span>
              </button>
            )}
            {onReopenForm && (
              <button
                type="button"
                onClick={onReopenForm}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium text-gray-700 transition-colors duration-200"
              >
                <DocumentTextIcon className="w-5 h-5 text-gray-600" />
                <span>Open Form Fields</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-gray-100/50">
      {/* Right sidebar: two separate blocks */}
      <div className="sidebar-blocks flex-1 flex flex-col lg:flex-row overflow-hidden gap-4 p-4 min-h-0">
        {/* Block 1: AI Assistant (separate card) */}
        {isAiPanelOpen ? (
          <section
            className="sidebar-block sidebar-block--ai flex-1 flex flex-col min-w-0 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden"
            aria-label="AI Assistant"
          >
            <header className="sidebar-block__header flex-shrink-0 px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-purple-50 to-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-purple-100 text-purple-600">
                  <SparklesIcon className="w-4 h-4" aria-hidden />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">AI Assistant</h3>
                  <p className="text-xs text-gray-500">Generate and insert content</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {typeof onCloseAi === 'function' && (
                  <button
                    type="button"
                    onClick={onCloseAi}
                    className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                    aria-label="Close AI Assistant"
                  >
                    <XMarkIcon className="w-4 h-4 text-gray-500" />
                  </button>
                )}
                {typeof onClose === 'function' && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                    aria-label="Close sidebar"
                  >
                    <XMarkIcon className="w-4 h-4 text-gray-500" />
                  </button>
                )}
              </div>
            </header>
            {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-full text-center">
                <div>
                  <div className="text-4xl mb-4">✨</div>
                  <p className="text-gray-600 mb-2">Ask me anything about this template</p>
                  <p className="text-sm text-gray-500">
                    I can help you fill in fields, suggest content, or answer questions
                  </p>
                  {currentFieldContext && (
                    <div className="mt-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                      <p className="text-sm text-purple-700">
                        Generating content for: <strong>{currentFieldContext.label}</strong>
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`chat-message flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-4 py-2 ${
                      message.role === 'user'
                        ? 'bg-[#21C1B6] text-white'
                        : message.isError
                        ? 'bg-red-50 text-red-900 border border-red-200'
                        : message.isSystem
                        ? 'bg-green-50 text-green-900 border border-green-200'
                        : 'bg-gray-100 text-gray-900'
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    {message.suggestionId && message.targetBlock && message.targetBlock !== 'general' && (
                      <button
                        type="button"
                        onClick={() => handleInsertSuggestion(message.suggestionId, message.targetBlock)}
                        className="mt-2 px-3 py-1.5 bg-[#8B5CF6] text-white text-xs font-medium rounded hover:bg-[#7c3aed] transition-colors duration-200 flex items-center gap-1.5"
                      >
                        <CheckCircleIcon className="w-4 h-4" />
                        Insert into Field
                      </button>
                    )}
                    <p
                      className={`text-xs mt-1 ${
                        message.role === 'user' ? 'text-white/70' : 'text-gray-500'
                      }`}
                    >
                      {message.timestamp.toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))
            )}
            {isAiLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-lg px-4 py-2">
                  <div className="flex space-x-2">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Chat Input */}
          <div className="chat-input-container flex-shrink-0 p-4 border-t border-gray-200 bg-white">
            {/* Evidence Selection */}
            <div className="mb-2 space-y-2">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setEvidenceModalOpen(true)}
                  className="text-xs text-purple-600 hover:text-purple-700 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-purple-50 transition-colors"
                >
                  <DocumentArrowUpIcon className="w-3.5 h-3.5" />
                  {!Array.isArray(evidenceList) || evidenceList.length === 0 ? 'Upload Evidence' : 'Upload More'}
                </button>
                {selectedEvidenceFiles.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedEvidenceFiles([])}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    Clear selection
                  </button>
                )}
              </div>
              {Array.isArray(evidenceList) && evidenceList.length > 0 && (
                <div className="max-h-24 overflow-y-auto space-y-1">
                  {evidenceList
                    .filter((file) => file && (file.evidenceId || file.id))
                    .map((file) => {
                      const fileId = file.evidenceId || file.id;
                      const fileName = file.originalName || file.fileName || 'Document';
                      const fileSize = file.sizeBytes ?? file.fileSize ?? 0;
                      const isSelected = selectedEvidenceFiles.includes(fileId);
                      return (
                        <label
                          key={fileId}
                          className="flex items-center gap-2 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 rounded cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedEvidenceFiles((prev) => [...prev, fileId]);
                              } else {
                                setSelectedEvidenceFiles((prev) => prev.filter((id) => id !== fileId));
                              }
                            }}
                            className="rounded"
                          />
                          <span className="flex-1 truncate">{fileName}</span>
                          <span className="text-gray-500">{formatFileSize(fileSize)}</span>
                        </label>
                      );
                    })}
                </div>
              )}
            </div>
            {currentFieldContext && (
              <div className="mb-2 px-3 py-1.5 bg-purple-50 border border-purple-200 rounded text-xs text-purple-700">
                Generating for: <strong>{currentFieldContext.label}</strong>
                <button
                  type="button"
                  onClick={() => setCurrentFieldContext(null)}
                  className="ml-2 text-purple-500 hover:text-purple-700"
                >
                  ✕
                </button>
              </div>
            )}
            <div className="flex items-end space-x-2">
              <textarea
                ref={textareaRef}
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={currentFieldContext ? `Generate content for "${currentFieldContext.label}"...` : "Ask AI for help..."}
                disabled={isAiLoading}
                rows={1}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#21C1B6] resize-none"
                style={{ minHeight: '40px', maxHeight: '120px' }}
              />
              <button
                onClick={handleSendMessage}
                disabled={!inputMessage.trim() || isAiLoading}
                className="btn-primary p-2 bg-[#21C1B6] text-white rounded-lg hover:bg-[#1AA49B] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
                aria-label="Send message"
              >
                <PaperAirplaneIcon className="w-5 h-5" />
              </button>
            </div>
          </div>
          </section>
        ) : (
          <section className="sidebar-block sidebar-block--ai-closed flex-1 flex flex-col min-w-0 rounded-xl border border-gray-200 border-dashed bg-gray-50 items-center justify-center p-6">
            {onReopenAi && (
              <button
                type="button"
                onClick={onReopenAi}
                className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-gray-200 bg-white hover:bg-purple-50 hover:border-purple-200 text-sm font-medium text-gray-700 transition-colors shadow-sm"
              >
                <ChatBubbleLeftRightIcon className="w-5 h-5 text-purple-500" />
                <span>Open AI Assistant</span>
              </button>
            )}
          </section>
        )}

        {/* Block 2: Form Fields (separate card) */}
        {isFormPanelOpen ? (
          <section
            className="sidebar-block sidebar-block--form flex-1 lg:max-w-md flex flex-col min-w-0 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden"
            aria-label="Form Fields"
          >
            <header className="sidebar-block__header flex-shrink-0 px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-teal-50/80 to-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-teal-100 text-teal-600">
                  <DocumentTextIcon className="w-4 h-4" aria-hidden />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">Form Fields</h3>
                  <p className="text-xs text-gray-500">
                    {fields.length} field{fields.length !== 1 ? 's' : ''}
                    {isSaving && <span className="ml-1 text-teal-600">• Saving...</span>}
                  </p>
                </div>
              </div>
              {typeof onCloseForm === 'function' && (
                <button
                  type="button"
                  onClick={onCloseForm}
                  className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                  aria-label="Close Form Fields"
                >
                  <XMarkIcon className="w-4 h-4 text-gray-500" />
                </button>
              )}
            </header>

            {/* Form Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {fields.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p className="text-sm">No form fields in this template</p>
              </div>
            ) : (
              fields.map((field) => (
                <div key={field.key} className="form-field bg-white rounded-lg p-4 border border-gray-200">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {field.label || field.key}
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  <div className="flex gap-2 items-start">
                    <div className="flex-1 min-w-0">
                      {field.type === 'textarea' ? (
                        <textarea
                          value={formData[field.key] || ''}
                          onChange={(e) => handleFieldChange(field.key, e.target.value)}
                          placeholder={field.placeholder || `Enter ${field.label || field.key}`}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#21C1B6] resize-none"
                          rows={3}
                        />
                      ) : (
                        <input
                          type={field.type || 'text'}
                          value={formData[field.key] || ''}
                          onChange={(e) => handleFieldChange(field.key, e.target.value)}
                          placeholder={field.placeholder || `Enter ${field.label || field.key}`}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#21C1B6]"
                        />
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAIAssist(field.key, field.label || field.key)}
                      className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#8B5CF6] bg-[#f5f3ff] text-[#5b21b6] hover:bg-[#ede9fe] transition-colors duration-200 text-sm font-medium"
                      title="Get AI suggestions for this field"
                      aria-label={`AI Assist for ${field.label || field.key}`}
                    >
                      <SparklesIcon className="w-4 h-4" />
                      <span className="hidden sm:inline">AI Assist</span>
                    </button>
                  </div>
                  {field.description && (
                    <p className="text-xs text-gray-500 mt-1">{field.description}</p>
                  )}
                </div>
              ))
            )}
            </div>
          </section>
        ) : (
          <section className="sidebar-block sidebar-block--form-closed flex-1 lg:max-w-md flex flex-col min-w-0 rounded-xl border border-gray-200 border-dashed bg-gray-50 items-center justify-center p-6">
            {onReopenForm && (
              <button
                type="button"
                onClick={onReopenForm}
                className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-gray-200 bg-white hover:bg-teal-50 hover:border-teal-200 text-sm font-medium text-gray-700 transition-colors shadow-sm"
              >
                <DocumentTextIcon className="w-5 h-5 text-teal-600" />
                <span>Open Form Fields</span>
              </button>
            )}
          </section>
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

export default ChatAndFormPanel;
