import React, { useState, useEffect, useRef } from 'react';
import { BookOpen, ChevronDown, Mic, MicOff, Send, Sparkles, X } from 'lucide-react';

const ChatInput = ({
  onSendMessage,
  disabled,
  activeDropdown,
  setActiveDropdown,
  showDropdown,
  setShowDropdown,
  secrets,
  isLoadingSecrets,
  selectedSecretId,
  handleDropdownSelect,
  isSecretPromptSelected,
  setIsSecretPromptSelected,
  handleChatInputChange,
  dropdownRef,
  learningModeActive = false,
  setLearningModeActive = () => {},
}) => {
  const [message, setMessage] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [recognition, setRecognition] = useState(null);
  const [showStyleDropdown, setShowStyleDropdown] = useState(false);
  const styleDropdownRef = useRef(null);

  useEffect(() => {
    // Check for browser support
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognitionInstance = new SpeechRecognition();
      recognitionInstance.continuous = false; // We want it to stop after one phrase
      recognitionInstance.interimResults = false;
      recognitionInstance.lang = 'en-US';

      recognitionInstance.onstart = () => {
        setIsListening(true);
      };

      recognitionInstance.onend = () => {
        setIsListening(false);
      };

      recognitionInstance.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setMessage((prev) => (prev ? `${prev} ${transcript}` : transcript));
        handleChatInputChange();
      };

      recognitionInstance.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      setRecognition(recognitionInstance);
    }
  }, [handleChatInputChange]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (styleDropdownRef.current && !styleDropdownRef.current.contains(event.target)) {
        setShowStyleDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

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

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isSecretPromptSelected && selectedSecretId) {
      onSendMessage('', true);
    } else if (message.trim() && !disabled) {
      onSendMessage(message, false);
      setMessage('');
    }
  };

  const onMessageChange = (e) => {
    setMessage(e.target.value);
    handleChatInputChange();
  };

  const handleStyleSelect = (style) => {
    setLearningModeActive(style === 'learning');
    setShowStyleDropdown(false);
  };

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex items-center space-x-3 bg-white rounded-xl border border-[#21C1B6] px-4 py-3 focus-within:ring-[#21C1B6] focus-within:shadow-sm">
        <div className="relative flex-shrink-0" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setShowDropdown(!showDropdown)}
          disabled={disabled || isLoadingSecrets}
          className="flex items-center space-x-2 px-2.5 py-1.5 text-xs font-medium text-gray-700 bg-white border border-[#21C1B6] rounded-lg hover:bg-[#1AA49B] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <BookOpen className="h-3.5 w-3.5" />
          <span>{isLoadingSecrets ? 'Loading...' : activeDropdown}</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>

        {showDropdown && !isLoadingSecrets && (
          <div className="absolute bottom-full left-0 mb-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto">
            {secrets.length > 0 ? (
              secrets.map((secret) => (
                <button
                  key={secret.id}
                  type="button"
                  onClick={() => handleDropdownSelect(secret.name, secret.id)}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg"
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

        <div className="relative flex-shrink-0" ref={styleDropdownRef}>
          <button
            type="button"
            onClick={() => setShowStyleDropdown((prev) => !prev)}
            className="flex items-center space-x-2 px-2.5 py-1.5 text-xs font-medium text-gray-700 bg-white border border-[#21C1B6] rounded-lg hover:bg-[#E0F7F6]"
            title="Choose response style"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>{learningModeActive ? 'Learning' : 'Normal'}</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {showStyleDropdown && (
            <div className="absolute bottom-full left-0 mb-2 w-36 bg-white border border-gray-200 rounded-lg shadow-lg z-20 overflow-hidden">
              <button
                type="button"
                onClick={() => handleStyleSelect('normal')}
                className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
              >
                Normal
              </button>
              <button
                type="button"
                onClick={() => handleStyleSelect('learning')}
                className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
              >
                Learning
              </button>
            </div>
          )}
        </div>

        <input
        type="text"
        className="flex-grow bg-transparent border-none outline-none text-gray-900 placeholder-gray-500 text-sm font-medium py-1 min-w-0"
        value={message}
        onChange={onMessageChange}
        placeholder={disabled ? "Select a folder to chat" : "Ask a question about the documents..."}
        disabled={disabled || isSecretPromptSelected}
        />
      
        <div className="flex items-center space-x-2">
        <button
          type="button"
          onClick={toggleListening}
          className={`p-2 rounded-full transition-all duration-300 ${
            isListening 
              ? 'bg-red-500 text-white animate-pulse shadow-lg scale-110' 
              : 'text-gray-400 hover:text-[#21C1B6] hover:bg-gray-100'
          }`}
          disabled={disabled || isSecretPromptSelected}
          title={isListening ? "Stop listening" : "Start voice input"}
        >
          {isListening ? (
            <MicOff className="h-5 w-5" />
          ) : (
            <Mic className="h-5 w-5" />
          )}
        </button>

        <button
          type="submit"
          className="p-2 bg-[#21C1B6] hover:bg-[#1AA49B] disabled:bg-gray-300 text-white rounded-lg transition-all duration-300 flex-shrink-0 flex items-center justify-center gap-2 px-4 shadow-sm active:scale-95"
          disabled={disabled || (!message.trim() && !isSecretPromptSelected)}
        >
          <Send className="h-4 w-4" />
          <span className="text-sm font-semibold">Send</span>
        </button>
        </div>
      </form>
      {learningModeActive && (
        <div className="mt-2 inline-flex items-center gap-2 px-2 py-1 rounded-full border border-[#21C1B6] bg-[#E0F7F6] text-[#11766f] text-xs font-medium">
          <Sparkles className="h-3 w-3" />
          <span>Learning mode active</span>
          <button
            type="button"
            onClick={() => setLearningModeActive(false)}
            className="text-[#11766f] hover:text-[#0e5f59]"
            title="Disable learning mode"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
};

export default ChatInput;



