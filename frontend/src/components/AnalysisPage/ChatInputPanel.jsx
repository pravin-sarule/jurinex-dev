import React, { useRef, useEffect, useState } from 'react';
import { Send, Loader2, Bot, X, Square, Mic, MicOff } from 'lucide-react';
import UploadOptionsMenu from '../UploadOptionsMenu';
import PromptChipsBar from '../PromptChipsBar';

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
  setChatInput, // Need this to update input from voice
}) => {
  const [isListening, setIsListening] = useState(false);
  const [recognition, setRecognition] = useState(null);

  // Speech recognition setup
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognitionInstance = new SpeechRecognition();
      recognitionInstance.continuous = false;
      recognitionInstance.interimResults = false;
      recognitionInstance.lang = 'en-US';

      recognitionInstance.onstart = () => setIsListening(true);
      recognitionInstance.onend = () => setIsListening(false);
      recognitionInstance.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        if (setChatInput) {
          setChatInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
        }
        
        // Reset secret prompt if voice input is given
        if (isSecretPromptSelected) {
          setIsSecretPromptSelected(false);
          if (setActiveDropdown) setActiveDropdown("Custom Query");
          if (setSelectedSecretId) setSelectedSecretId(null);
        }
      };
      recognitionInstance.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      setRecognition(recognitionInstance);
    }
  }, [isSecretPromptSelected, setChatInput, setActiveDropdown, setSelectedSecretId, setIsSecretPromptSelected]);

  const toggleListening = () => {
    if (!recognition) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }

    if (isListening) {
      recognition.stop();
    } else {
      try {
        recognition.start();
      } catch (err) {
        console.error('Failed to start recognition:', err);
      }
    }
  };

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
          {(isLoadingSecrets || secrets.length > 0) && (
            <PromptChipsBar
              secrets={secrets}
              isLoading={isLoadingSecrets}
              activeLabel={isSecretPromptSelected ? activeDropdown : null}
              onSelect={(secret) => handleDropdownSelect(secret.name, secret.id)}
              disabled={!fileId || processingStatus?.status !== 'processed' || isGenerating}
              size={isSplitView ? 'compact' : 'default'}
              className={isSplitView ? 'mb-1' : 'mb-1.5'}
            />
          )}
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
              accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.tiff,.mp3,.wav,.m4a,.flac,.ogg,.webm,.aac,.mp4"
              onChange={handleFileUpload}
              disabled={isUploading}
              multiple
            />

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

            <button
              type="button"
              onClick={toggleListening}
              className={`p-2 rounded-full transition-all duration-300 flex-shrink-0 ${
                isListening 
                  ? 'bg-red-500 text-white animate-pulse shadow-lg scale-110' 
                  : 'text-gray-400 hover:text-[#21C1B6] hover:bg-gray-50'
              }`}
              disabled={isGenerating || !fileId || processingStatus?.status !== 'processed' || isSecretPromptSelected}
              title={isListening ? "Stop listening" : "Start voice input"}
            >
              {isListening ? (
                <MicOff className={isSplitView ? 'h-3.5 w-3.5' : 'h-5 w-5'} />
              ) : (
                <Mic className={isSplitView ? 'h-3.5 w-3.5' : 'h-5 w-5'} />
              )}
            </button>

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
