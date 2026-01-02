import React, { useRef, useEffect } from 'react';
import { Send, Loader2, BookOpen, ChevronDown, Bot, X, Square } from 'lucide-react';
import UploadOptionsMenu from '../UploadOptionsMenu';

const ChatInputPanel = ({
  fileInputRef,
  isUploading,
  handleFileUpload,
  handleGoogleDriveUpload,
  showDropdown,
  setShowDropdown,
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
}) => {
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [setShowDropdown]);

  const isGenerating = isLoading || isGeneratingInsights;

  return (
    <div className={`${isSplitView ? '' : 'flex flex-col items-center justify-center h-full w-full'}`}>
      {!isSplitView && (
        <div className="text-center max-w-2xl px-6 mb-12">
          <h3 className="text-3xl font-bold mb-4 text-gray-900">Welcome to Smart Legal Insights</h3>
          <p className="text-gray-600 text-xl leading-relaxed">
            Upload a legal document or ask a question to begin your AI-powered analysis.
          </p>
        </div>
      )}
      
      <div className={`${isSplitView ? 'w-full' : 'w-full max-w-4xl px-6'}`}>
        <form onSubmit={handleSend} className="mx-auto">
          <div className={`flex items-center space-x-2 bg-gray-50 rounded-xl border border-gray-300 ${isSplitView ? 'px-2 py-1.5' : 'px-5 py-4'} focus-within:border-blue-400 focus-within:bg-white focus-within:shadow-sm transition-all`}>
            <UploadOptionsMenu
              fileInputRef={fileInputRef}
              isUploading={isUploading}
              onLocalFileClick={() => fileInputRef.current?.click()}
              onGoogleDriveUpload={handleGoogleDriveUpload}
              folderName={folderName}
              isSplitView={isSplitView}
            />
           
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.tiff"
              onChange={handleFileUpload}
              disabled={isUploading}
              multiple
            />

            <div className="relative flex-shrink-0" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setShowDropdown(!showDropdown)}
                disabled={!fileId || processingStatus?.status !== 'processed' || isLoading || isGeneratingInsights || isLoadingSecrets}
                className={`flex items-center space-x-1.5 ${isSplitView ? 'px-1.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'} font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors`}
              >
                <BookOpen className={`${isSplitView ? 'h-3 w-3' : 'h-4 w-4'}`} />
                <span className="truncate max-w-[80px]">{isLoadingSecrets ? 'Load...' : activeDropdown}</span>
                <ChevronDown className={`${isSplitView ? 'h-3 w-3' : 'h-4 w-4'}`} />
              </button>

              {showDropdown && !isLoadingSecrets && (
                <div className="absolute bottom-full left-0 mb-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto">
                  {secrets.length > 0 ? (
                    secrets.map((secret) => (
                      <button
                        key={secret.id}
                        type="button"
                        onClick={() => handleDropdownSelect(secret.name, secret.id)}
                        className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg transition-colors"
                      >
                        {secret.name}
                      </button>
                    ))
                  ) : (
                    <div className="px-4 py-2.5 text-sm text-gray-500">
                      No analysis prompts available
                    </div>
                  )}
                </div>
              )}
            </div>

            <input
              type="text"
              value={chatInput}
              onChange={handleChatInputChange}
              placeholder={
                isSecretPromptSelected
                  ? `Add details...`
                  : fileId
                    ? "Ask a question..."
                    : "Upload document first"
              }
              className={`flex-1 bg-transparent border-none outline-none text-gray-900 placeholder-gray-400 ${isSplitView ? 'text-xs h-7' : 'text-[15px] h-10'} font-medium min-w-0 analysis-page-user-input`}
              disabled={isGenerating || !fileId || processingStatus?.status !== 'processed'}
              style={{ resize: 'none' }}
            />

            {isGenerating ? (
              <button
                type="button"
                onClick={stopGeneration}
                className={`${isSplitView ? 'p-1' : 'p-2'} bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex-shrink-0`}
                title="Stop Generation"
              >
                <Square className={`${isSplitView ? 'h-3.5 w-3.5' : 'h-5 w-5'} fill-current`} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={
                  (!chatInput.trim() && !isSecretPromptSelected) ||
                  !fileId ||
                  processingStatus?.status !== 'processed'
                }
                className={`${isSplitView ? 'p-1' : 'p-2'} bg-black hover:bg-gray-800 disabled:bg-gray-300 text-white rounded-lg transition-colors flex-shrink-0`}
                title="Send Message"
              >
                <Send className={`${isSplitView ? 'h-3.5 w-3.5' : 'h-5 w-5'}`} />
              </button>
            )}
          </div>

          {isSecretPromptSelected && (
            <div className={`${isSplitView ? 'mt-1.5 p-1.5' : 'mt-3 p-2'} bg-blue-50 border border-blue-200 rounded-lg`}>
              <div className={`flex items-center space-x-2 ${isSplitView ? 'text-xs' : 'text-sm'} text-blue-800`}>
                <Bot className={`${isSplitView ? 'h-3 w-3' : 'h-4 w-4'}`} />
                <span className="truncate">Using: <strong>{activeDropdown}</strong></span>
                <button
                  type="button"
                  onClick={() => {
                    setIsSecretPromptSelected(false);
                    setActiveDropdown('Custom Query');
                    setSelectedSecretId(null);
                  }}
                  className="ml-auto text-blue-600 hover:text-blue-800"
                >
                  <X className={`${isSplitView ? 'h-3 w-3' : 'h-4 w-4'}`} />
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

export default ChatInputPanel;
