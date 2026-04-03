import React, { useState } from 'react';
import { XMarkIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-toastify';
import { formatTokenCount, formatCostInr } from '../../utils/formatters';
import { formatFileSize } from '../../utils/fileHelpers';
import './aiAssistant.css';

const RESPONSE_SIZE_OPTIONS = [
  { value: 'short', label: 'Short (3-5 sentences)' },
  { value: 'medium', label: 'Medium (1-2 paragraphs)' },
  { value: 'long', label: 'Long (Detailed)' },
];

export default function AIAssistantPanel({
  isOpen,
  onClose,
  currentField,
  mode,
  onModeChange,
  prompt,
  onPromptChange,
  instruction,
  onInstructionChange,
  responseSize,
  onResponseSizeChange,
  selectedFiles,
  onToggleFile,
  suggestion,
  isGenerating,
  onGenerate,
  onInsert,
  onDiscard,
  evidenceList = [],
  onUploadEvidence,
}) {
  const [inserting, setInserting] = useState(false);

  const handleInsert = async () => {
    if (!onInsert) return;
    setInserting(true);
    try {
      await onInsert();
    } catch (err) {
      console.error('Insert suggestion error:', err);
      toast.error(err.message || 'Failed to insert content. Please try again.');
    } finally {
      setInserting(false);
    }
  };

  const handleGenerate = async () => {
    if (!onGenerate) return;
    try {
      await onGenerate();
    } catch (err) {
      console.error('Generate suggestion error:', err);
      toast.error(err.message || 'Failed to generate content. Please try again.');
    }
  };

  if (!isOpen) return null;

  const usage = suggestion?.usage || {};
  const totalTokens = usage.totalTokens ?? usage.inputTokens + usage.outputTokens ?? 0;
  const costInr = usage.estimatedCostInr ?? 0;

  return (
    <div className="ai-assistant-panel" role="dialog" aria-label="AI Assistant">
      <div className="ai-assistant-panel__header">
        <h2 className="ai-assistant-panel__title">
          <SparklesIcon className="w-5 h-5 text-[#8B5CF6]" aria-hidden />
          AI Assistant
        </h2>
        <button
          type="button"
          className="ai-assistant-panel__close"
          onClick={onClose}
          aria-label="Close AI Assistant"
        >
          <XMarkIcon className="w-5 h-5" />
        </button>
      </div>

      {currentField && (
        <div className="ai-assistant-panel__target">
          <div className="ai-assistant-panel__target-label">{currentField.label}</div>
          <div className="ai-assistant-panel__target-desc">Generate content for this field</div>
        </div>
      )}

      <div className="ai-assistant-panel__tabs">
        <button
          type="button"
          className={`ai-assistant-panel__tab ${mode === 'basic' ? 'ai-assistant-panel__tab--active' : ''}`}
          onClick={() => onModeChange('basic')}
        >
          Basic
        </button>
        <button
          type="button"
          className={`ai-assistant-panel__tab ${mode === 'advanced' ? 'ai-assistant-panel__tab--active' : ''}`}
          onClick={() => onModeChange('advanced')}
        >
          Advanced
        </button>
      </div>

      <div className="ai-assistant-panel__body">
        {isGenerating ? (
          <div className="ai-assistant-panel__loading">
            <div className="ai-assistant-panel__spinner" aria-hidden />
            <span>Generating content...</span>
          </div>
        ) : (
          <>
            {mode === 'basic' && (
              <div className="ai-assistant-panel__section">
                <label className="ai-assistant-panel__section-title" htmlFor="ai-prompt">
                  Prompt
                </label>
                <textarea
                  id="ai-prompt"
                  className="ai-assistant-panel__input"
                  placeholder="Describe what you want to generate..."
                  value={prompt}
                  onChange={(e) => onPromptChange(e.target.value)}
                  rows={3}
                />
                <div className="ai-assistant-panel__section" style={{ marginTop: 12 }}>
                  <label className="ai-assistant-panel__section-title" htmlFor="ai-response-size">
                    Response size
                  </label>
                  <select
                    id="ai-response-size"
                    className="ai-assistant-panel__select"
                    value={responseSize}
                    onChange={(e) => onResponseSizeChange(e.target.value)}
                  >
                    {RESPONSE_SIZE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    className="ai-assistant-panel__btn ai-assistant-panel__btn--primary"
                    onClick={handleGenerate}
                    disabled={!prompt.trim()}
                  >
                    Generate Content
                  </button>
                </div>
              </div>
            )}

            {mode === 'advanced' && (
              <div className="ai-assistant-panel__section">
                <label className="ai-assistant-panel__section-title" htmlFor="ai-instruction">
                  Instructions for AI
                </label>
                <textarea
                  id="ai-instruction"
                  className="ai-assistant-panel__input"
                  placeholder="Instructions for AI (optional evidence below)..."
                  value={instruction}
                  onChange={(e) => onInstructionChange(e.target.value)}
                  rows={3}
                />
                <div className="ai-assistant-panel__section" style={{ marginTop: 16 }}>
                  <div className="ai-assistant-panel__section-title">Evidence Documents</div>
                  <ul className="ai-assistant-panel__evidence-list">
                    {evidenceList.length === 0 ? (
                      <li className="ai-assistant-panel__evidence-item" style={{ color: '#9ca3af' }}>
                        No evidence uploaded. Upload files to use as context.
                      </li>
                    ) : (
                      evidenceList.map((file) => {
                        const id = file.evidenceId || file.id;
                        const name = file.originalName || file.fileName || 'Document';
                        const size = file.sizeBytes ?? file.fileSize ?? 0;
                        const checked = selectedFiles.includes(id);
                        return (
                          <li key={id} className="ai-assistant-panel__evidence-item">
                            <label>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => onToggleFile(id)}
                              />
                              <span>{name}</span>
                              <span className="ai-assistant-panel__evidence-size">
                                {formatFileSize(size)}
                              </span>
                            </label>
                          </li>
                        );
                      })
                    )}
                  </ul>
                  {onUploadEvidence && (
                    <button
                      type="button"
                      className="ai-assistant-panel__upload-btn"
                      onClick={onUploadEvidence}
                    >
                      + Upload Evidence
                    </button>
                  )}
                </div>
                <div className="ai-assistant-panel__section" style={{ marginTop: 12 }}>
                  <label className="ai-assistant-panel__section-title" htmlFor="ai-response-size-adv">
                    Response size
                  </label>
                  <select
                    id="ai-response-size-adv"
                    className="ai-assistant-panel__select"
                    value={responseSize}
                    onChange={(e) => onResponseSizeChange(e.target.value)}
                  >
                    {RESPONSE_SIZE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    className="ai-assistant-panel__btn ai-assistant-panel__btn--primary"
                    onClick={handleGenerate}
                  >
                    Generate with Context
                  </button>
                </div>
              </div>
            )}

            {suggestion && (
              <div className="ai-assistant-panel__suggestion">
                <div className="ai-assistant-panel__suggestion-header">
                  <span className="ai-assistant-panel__section-title">Generated Content</span>
                  <span className="ai-assistant-panel__suggestion-usage">
                    {formatTokenCount(totalTokens)} tokens · {formatCostInr(costInr)}
                  </span>
                </div>
                <pre className="ai-assistant-panel__suggestion-content">{suggestion.content}</pre>
                <div className="ai-assistant-panel__suggestion-actions">
                  <button
                    type="button"
                    className="ai-assistant-panel__btn ai-assistant-panel__btn--primary"
                    onClick={handleInsert}
                    disabled={inserting}
                  >
                    {inserting ? 'Inserting...' : 'Insert into Field'}
                  </button>
                  <button
                    type="button"
                    className="ai-assistant-panel__btn ai-assistant-panel__btn--secondary"
                    onClick={handleGenerate}
                  >
                    Regenerate
                  </button>
                  <button
                    type="button"
                    className="ai-assistant-panel__btn ai-assistant-panel__btn--danger"
                    onClick={onDiscard}
                  >
                    Discard
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
