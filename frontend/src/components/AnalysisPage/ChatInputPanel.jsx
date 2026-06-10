import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Send, Square, Mic, MicOff, Bot, X,
  FileText, Shield, Search, CalendarDays, Paperclip,
} from 'lucide-react';
import UploadOptionsMenu from '../UploadOptionsMenu';
import PromptChipsBar from '../PromptChipsBar';

/* ── Suggestion cards shown on the empty welcome screen ─────────────────── */
const SUGGESTIONS = [
  { icon: FileText,      text: 'Summarize document',      query: 'Please provide a comprehensive summary of this legal document, covering all key provisions and obligations.' },
  { icon: Shield,        text: 'Identify legal risks',     query: 'What are the key legal risks, liabilities, and red-flag clauses in this document?' },
  { icon: Search,        text: 'Extract key clauses',      query: 'Extract and explain all the important clauses, conditions, and restrictions in this document.' },
  { icon: CalendarDays,  text: 'Find critical dates',      query: 'List all important dates, deadlines, notice periods, and time-sensitive provisions in this document.' },
];

const ChatInputPanel = ({
  fileInputRef,
  isUploading,
  handleFileUpload,
  handleGoogleDriveUpload,
  fileId,
  processingStatus,
  isLoading,
  isGeneratingInsights,
  isLoadingSecrets,
  activeDropdown,
  secrets,
  handleDropdownSelect,
  chatInput,
  handleChatInputChange,
  isSecretPromptSelected,
  handleSend,
  documentData,
  hasResponse,
  formatFileSize,
  formatDate,
  setIsSecretPromptSelected,
  setActiveDropdown,
  setSelectedSecretId,
  isSplitView = false,
  stopGeneration,
  folderName = null,
  setChatInput,
}) => {
  const textareaRef = useRef(null);
  const [isListening, setIsListening] = useState(false);
  const [recognition, setRecognition] = useState(null);

  /* ── Speech recognition ─────────────────────────────────────────────────── */
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const r = new SpeechRecognition();
    r.continuous = false;
    r.interimResults = false;
    r.lang = 'en-US';
    r.onstart = () => setIsListening(true);
    r.onend   = () => setIsListening(false);
    r.onresult = (e) => {
      const t = e.results[0][0].transcript;
      if (setChatInput) setChatInput(prev => (prev ? `${prev} ${t}` : t));
      if (isSecretPromptSelected) {
        setIsSecretPromptSelected?.(false);
        setActiveDropdown?.('Custom Query');
        setSelectedSecretId?.(null);
      }
    };
    r.onerror = (e) => { console.error('Speech error:', e.error); setIsListening(false); };
    setRecognition(r);
  }, [isSecretPromptSelected, setChatInput, setActiveDropdown, setSelectedSecretId, setIsSecretPromptSelected]);

  const toggleListening = () => {
    if (!recognition) { alert('Speech recognition is not supported in this browser.'); return; }
    isListening ? recognition.stop() : recognition.start().catch(console.error);
  };

  /* ── Auto-resize textarea ───────────────────────────────────────────────── */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [chatInput]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  };

  const handleSuggestionClick = useCallback((query) => {
    if (setChatInput) setChatInput(query);
    textareaRef.current?.focus();
  }, [setChatInput]);

  const isGenerating   = isLoading || isGeneratingInsights;
  const isReady        = !!(fileId && processingStatus?.status === 'processed');
  const canSend        = (chatInput.trim() || isSecretPromptSelected) && isReady && !isGenerating;

  /* ═══════════════════════════════════════════════════════════════════════ */
  /* SPLIT-VIEW (compact sidebar mode) */
  /* ═══════════════════════════════════════════════════════════════════════ */
  if (isSplitView) {
    return (
      <form onSubmit={handleSend} className="w-full">
        {(isLoadingSecrets || secrets.length > 0) && (
          <PromptChipsBar
            secrets={secrets}
            isLoading={isLoadingSecrets}
            activeLabel={isSecretPromptSelected ? activeDropdown : null}
            onSelect={(s) => handleDropdownSelect(s.name, s.id)}
            disabled={!isReady || isGenerating}
            size="compact"
            className="mb-1"
          />
        )}
        <div className="flex items-center gap-1.5 bg-white rounded-xl border border-gray-200 px-2 py-1.5 focus-within:border-[#21C1B6] focus-within:shadow-sm transition-all shadow-sm">
          <UploadOptionsMenu
            fileInputRef={fileInputRef}
            isUploading={isUploading}
            onLocalFileClick={() => fileInputRef.current?.click()}
            onGoogleDriveUpload={handleGoogleDriveUpload}
            folderName={folderName}
            isSplitView
          />
          <input type="file" ref={fileInputRef} className="hidden"
            accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.tiff,.mp3,.wav,.m4a,.flac,.ogg,.webm,.aac,.mp4"
            onChange={handleFileUpload} disabled={isUploading} multiple />
          <input
            type="text"
            value={chatInput}
            onChange={handleChatInputChange}
            placeholder={isSecretPromptSelected ? 'Add details…' : isReady ? 'Ask a question…' : 'Upload document first'}
            className="flex-1 bg-transparent border-none outline-none text-xs text-gray-900 placeholder-gray-400 min-w-0 h-7"
            disabled={isGenerating || !isReady}
          />
          <button type="button" onClick={toggleListening}
            className={`p-1 rounded-full flex-shrink-0 transition-colors ${isListening ? 'bg-red-500 text-white animate-pulse' : 'text-gray-400 hover:text-[#21C1B6]'}`}
            disabled={isGenerating || !isReady || isSecretPromptSelected}>
            {isListening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
          </button>
          {isGenerating ? (
            <button type="button" onClick={stopGeneration}
              className="w-6 h-6 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center flex-shrink-0 transition-colors">
              <Square className="h-3 w-3 text-white fill-current" />
            </button>
          ) : (
            <button type="submit" disabled={!canSend}
              className="w-6 h-6 bg-[#21C1B6] hover:bg-[#1AA49B] disabled:bg-gray-200 rounded-full flex items-center justify-center flex-shrink-0 transition-colors">
              <Send className="h-3 w-3 text-white" />
            </button>
          )}
        </div>
        {isSecretPromptSelected && (
          <div className="mt-1.5 px-2 py-1 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-2 text-xs text-blue-800">
            <Bot className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">Using: <strong>{activeDropdown}</strong></span>
            <button type="button" onClick={() => { setIsSecretPromptSelected?.(false); setActiveDropdown?.('Custom Query'); setSelectedSecretId?.(null); }}
              className="ml-auto text-blue-500 hover:text-blue-700 flex-shrink-0">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </form>
    );
  }

  /* ═══════════════════════════════════════════════════════════════════════ */
  /* FULL-PAGE MODE (Claude-style) */
  /* ═══════════════════════════════════════════════════════════════════════ */
  return (
    <div className="flex flex-col items-center justify-center h-full w-full px-4">

      {/* ── Welcome hero ──────────────────────────────────────────────── */}
      {!hasResponse && (
        <div className="flex flex-col items-center text-center mb-8 max-w-xl w-full">
          {/* Brand mark */}
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#21C1B6] to-[#1AA49B] flex items-center justify-center shadow-lg mb-5">
            <Bot className="h-7 w-7 text-white" />
          </div>

          <h1 className="text-2xl font-bold text-gray-900 mb-2 leading-tight">
            Welcome to Smart Legal Insights
          </h1>
          <p className="text-gray-500 text-sm leading-relaxed max-w-sm">
            Your AI partner for fast, precise legal document analysis.
            Upload a file or ask a question to get instant, context-aware insights.
          </p>

          {/* Suggestion cards — only when document is ready */}
          {isReady && (
            <div className="grid grid-cols-2 gap-2.5 mt-8 w-full max-w-lg">
              {SUGGESTIONS.map(({ icon: Icon, text, query }) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => handleSuggestionClick(query)}
                  className="flex items-start gap-3 p-3.5 bg-white rounded-xl border border-gray-200 text-left
                             hover:border-[#21C1B6] hover:shadow-md transition-all group cursor-pointer"
                >
                  <span className="w-7 h-7 rounded-lg bg-gray-50 group-hover:bg-[#f0fdfa] flex items-center justify-center flex-shrink-0 transition-colors">
                    <Icon className="h-3.5 w-3.5 text-gray-400 group-hover:text-[#21C1B6] transition-colors" />
                  </span>
                  <span className="text-sm text-gray-600 group-hover:text-gray-900 leading-snug transition-colors">
                    {text}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Upload hint — when no document */}
          {!isReady && !fileId && (
            <div className="mt-8 flex items-center gap-2 text-xs text-gray-400">
              <Paperclip className="h-3.5 w-3.5" />
              <span>Click <strong className="text-gray-500">+</strong> below to upload a document and unlock AI analysis</span>
            </div>
          )}
        </div>
      )}

      {/* ── Input card ─────────────────────────────────────────────────── */}
      <div className="w-full max-w-2xl">
        <form onSubmit={handleSend}>

          {/* Prompt chips row */}
          {(isLoadingSecrets || secrets.length > 0) && (
            <PromptChipsBar
              secrets={secrets}
              isLoading={isLoadingSecrets}
              activeLabel={isSecretPromptSelected ? activeDropdown : null}
              onSelect={(s) => handleDropdownSelect(s.name, s.id)}
              disabled={!isReady || isGenerating}
              size="default"
              className="mb-2"
            />
          )}

          {/* Claude-style input box */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-md focus-within:border-[#21C1B6] focus-within:shadow-lg transition-all overflow-hidden">

            {/* Active prompt indicator (inside box, top) */}
            {isSecretPromptSelected && (
              <div className="flex items-center gap-2 px-4 pt-3 pb-1">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#f0fdfa] border border-[#b2f5ea] rounded-full text-xs font-medium text-[#0f766e]">
                  <Bot className="h-3 w-3" />
                  {activeDropdown}
                </span>
                <button type="button"
                  onClick={() => { setIsSecretPromptSelected?.(false); setActiveDropdown?.('Custom Query'); setSelectedSecretId?.(null); }}
                  className="text-gray-400 hover:text-gray-600 transition-colors">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={chatInput}
              onChange={handleChatInputChange}
              onKeyDown={handleKeyDown}
              placeholder={
                isSecretPromptSelected
                  ? 'Add more details to your query… (Enter to send, Shift+Enter for newline)'
                  : isReady
                    ? 'How can I help you today? (Enter to send, Shift+Enter for newline)'
                    : 'Upload a document to start asking questions…'
              }
              rows={1}
              disabled={isGenerating || !isReady}
              className="w-full px-4 pt-4 pb-2 bg-transparent border-none outline-none text-gray-900
                         placeholder-gray-400 text-[15px] leading-relaxed resize-none
                         min-h-[56px] max-h-[200px] overflow-y-auto disabled:opacity-60 disabled:cursor-not-allowed"
            />

            {/* ── Bottom toolbar ────────────────────────────────────────── */}
            <div className="flex items-center justify-between px-3 pb-3 pt-1">
              {/* Left: attach + mic */}
              <div className="flex items-center gap-1">
                <UploadOptionsMenu
                  fileInputRef={fileInputRef}
                  isUploading={isUploading}
                  onLocalFileClick={() => fileInputRef.current?.click()}
                  onGoogleDriveUpload={handleGoogleDriveUpload}
                  folderName={folderName}
                  isSplitView={false}
                />
                <input type="file" ref={fileInputRef} className="hidden"
                  accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.tiff,.mp3,.wav,.m4a,.flac,.ogg,.webm,.aac,.mp4"
                  onChange={handleFileUpload} disabled={isUploading} multiple />

                <button
                  type="button"
                  onClick={toggleListening}
                  disabled={isGenerating || !isReady || isSecretPromptSelected}
                  title={isListening ? 'Stop listening' : 'Voice input'}
                  className={`p-2 rounded-lg transition-all flex-shrink-0 ${
                    isListening
                      ? 'bg-red-500 text-white animate-pulse shadow-md'
                      : 'text-gray-400 hover:text-[#21C1B6] hover:bg-gray-50'
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  {isListening
                    ? <MicOff className="h-4 w-4" />
                    : <Mic className="h-4 w-4" />}
                </button>
              </div>

              {/* Right: hint + send/stop */}
              <div className="flex items-center gap-3">
                {chatInput.trim() && (
                  <span className="text-[11px] text-gray-300 hidden sm:block select-none">
                    Shift+Enter for newline
                  </span>
                )}

                {isGenerating ? (
                  <button
                    type="button"
                    onClick={stopGeneration}
                    title="Stop generation"
                    className="w-9 h-9 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center
                               shadow-md hover:shadow-lg transition-all flex-shrink-0"
                  >
                    <Square className="h-4 w-4 text-white fill-current" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!canSend}
                    title="Send message"
                    className="w-9 h-9 rounded-full flex items-center justify-center shadow-sm
                               transition-all flex-shrink-0
                               bg-[#21C1B6] hover:bg-[#1AA49B] hover:shadow-md
                               disabled:bg-gray-200 disabled:shadow-none disabled:cursor-not-allowed"
                  >
                    <Send className="h-4 w-4 text-white" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Disclaimer */}
          <p className="text-center text-[11px] text-gray-400 mt-2.5">
            AI research only — always verify legal conclusions independently.
          </p>
        </form>
      </div>
    </div>
  );
};

export default ChatInputPanel;
