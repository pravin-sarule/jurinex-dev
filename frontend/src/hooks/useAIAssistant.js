import { useState, useCallback } from 'react';
import {
  aiSuggest,
  insertAiSuggestion,
  discardAiSuggestion,
} from '../services/draftTemplateApi';

/**
 * Hook for AI Assistant panel: generate suggestions, insert/discard, mode (basic/advanced)
 * @param {string} draftId - Current draft ID
 * @param {Function} onInsertSuccess - Called after insert (e.g. refetch draft)
 */
export function useAIAssistant(draftId, onInsertSuccess) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentField, setCurrentField] = useState(null);
  const [mode, setMode] = useState('basic');
  const [prompt, setPrompt] = useState('');
  const [instruction, setInstruction] = useState('');
  const [responseSize, setResponseSize] = useState('medium');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [suggestion, setSuggestion] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const openAIAssistant = useCallback((fieldKey, fieldLabel) => {
    setCurrentField({ key: fieldKey, label: fieldLabel });
    setIsOpen(true);
    setSuggestion(null);
    setPrompt('');
    setInstruction('');
  }, []);

  const closeAIAssistant = useCallback(() => {
    setIsOpen(false);
    setCurrentField(null);
    setSuggestion(null);
  }, []);

  const toggleFile = useCallback((fileId) => {
    setSelectedFiles((prev) =>
      prev.includes(fileId) ? prev.filter((id) => id !== fileId) : [...prev, fileId]
    );
  }, []);

  const generateSuggestion = useCallback(async () => {
    if (!draftId || !currentField) return;

    setIsGenerating(true);
    setSuggestion(null);

    try {
      if (mode === 'basic') {
        const { suggestion: s } = await aiSuggest(draftId, {
          targetBlock: currentField.key,
          prompt: prompt.trim() || `Generate content for "${currentField.label}"`,
          responseSize,
        });
        setSuggestion({
          suggestionId: s.suggestionId,
          content: s.content,
          usage: s.usage || { totalTokens: 0, estimatedCostInr: 0 },
        });
      } else {
        const { suggestion: s } = await aiSuggest(draftId, {
          targetBlock: currentField.key,
          instruction: instruction.trim() || prompt.trim() || `Generate content for "${currentField.label}"`,
          stateAware: true,
          fileIds: selectedFiles,
          responseSize,
        });
        setSuggestion({
          suggestionId: s.suggestionId,
          content: s.content,
          usage: s.usage || { totalTokens: 0, estimatedCostInr: 0 },
        });
      }
    } catch (error) {
      console.error('Error generating suggestion:', error);
      throw error;
    } finally {
      setIsGenerating(false);
    }
  }, [draftId, currentField, mode, prompt, instruction, responseSize, selectedFiles]);

  const insertSuggestion = useCallback(async () => {
    if (!draftId || !suggestion?.suggestionId) return;

    try {
      await insertAiSuggestion(draftId, suggestion.suggestionId);
      if (typeof onInsertSuccess === 'function') onInsertSuccess();
      closeAIAssistant();
    } catch (error) {
      console.error('Error inserting suggestion:', error);
      throw error;
    }
  }, [draftId, suggestion, onInsertSuccess, closeAIAssistant]);

  const discardSuggestion = useCallback(async () => {
    if (!draftId || !suggestion?.suggestionId) return;

    try {
      await discardAiSuggestion(draftId, suggestion.suggestionId);
      setSuggestion(null);
    } catch (error) {
      console.error('Error discarding suggestion:', error);
      throw error;
    }
  }, [draftId, suggestion]);

  return {
    isOpen,
    currentField,
    mode,
    setMode,
    prompt,
    setPrompt,
    instruction,
    setInstruction,
    responseSize,
    setResponseSize,
    selectedFiles,
    setSelectedFiles,
    toggleFile,
    suggestion,
    isGenerating,
    openAIAssistant,
    closeAIAssistant,
    generateSuggestion,
    insertSuggestion,
    discardSuggestion,
  };
}
