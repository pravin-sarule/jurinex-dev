import React, { useState, useEffect, useRef } from 'react';
import { useIntelligentFolderChat } from '../hooks/useIntelligentFolderChat';
import { BookOpen, ChevronDown } from 'lucide-react';
import './IntelligentFolderChat.css';
import CitationsPanel from '../AnalysisPage/CitationsPanel';
import apiService from '../services/api';

/**
 * Complete Intelligent Folder Chat Component
 * Renders streaming responses in real-time as chunks arrive
 */
export default function IntelligentFolderChat({
  folderName,
  authToken = null,
  onMessageComplete = null,
  className = '',
}) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [currentMessageId, setCurrentMessageId] = useState(null);
  const [showCitations, setShowCitations] = useState(false);
  const [citations, setCitations] = useState([]);
  const [loadingCitations, setLoadingCitations] = useState(false);
  const [selectedMessageForCitations, setSelectedMessageForCitations] = useState(null);

  // Secret prompt states
  const [secrets, setSecrets] = useState([]);
  const [isLoadingSecrets, setIsLoadingSecrets] = useState(false);
  const [selectedSecretId, setSelectedSecretId] = useState(null);
  const [activeDropdown, setActiveDropdown] = useState('Summary');
  const [showDropdown, setShowDropdown] = useState(false);
  const [isSecretPromptSelected, setIsSecretPromptSelected] = useState(false);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const finalizedMessageIds = useRef(new Set()); // Track finalized messages to prevent duplicate rendering

  const {
    text,
    thinking, // NEW: Model's thinking process
    isStreaming,
    error,
    sessionId,
    methodUsed,
    routingDecision,
    status,
    finalMetadata, // Final metadata with citations
    sendMessage,
    stopStreaming,
    clear,
  } = useIntelligentFolderChat(folderName, authToken);

  // API Configuration
  const API_BASE_URL = import.meta.env.VITE_APP_API_URL || import.meta.env.REACT_APP_API_BASE_URL || 'https://gateway-service-120280829617.asia-south1.run.app';

  // Helper to get auth token from localStorage
  const getAuthToken = () => {
    const tokenKeys = [
      'authToken', 'token', 'accessToken', 'jwt', 'bearerToken',
      'auth_token', 'access_token', 'api_token', 'userToken',
    ];
    for (const key of tokenKeys) {
      const token = localStorage.getItem(key);
      if (token) return token;
    }
    return null;
  };

  // 🔹 Fetch secrets list
  const fetchSecrets = async () => {
    try {
      setIsLoadingSecrets(true);

      const token = authToken || getAuthToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch(`${API_BASE_URL}/files/secrets?fetch=true`, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch secrets: ${response.status}`);
      }

      const secretsData = await response.json();
      setSecrets(secretsData || []);

      if (secretsData && secretsData.length > 0) {
        setActiveDropdown(secretsData[0].name);
        setSelectedSecretId(secretsData[0].id);
      }
    } catch (error) {
      console.error('Error fetching secrets:', error);
    } finally {
      setIsLoadingSecrets(false);
    }
  };

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, text]);

  // Update current streaming message in real-time
  useEffect(() => {
    // Only update if we have an active message being streamed
    if (!currentMessageId) return;

    if (isStreaming) {
      // Streaming in progress - update message in real-time
      setMessages(prev => {
        const newMessages = [...prev];
        const lastMessage = newMessages.find(m => m.id === currentMessageId);
        if (lastMessage && lastMessage.role === 'assistant') {
          // Only update if this is the current streaming message
          lastMessage.text = text || '';
          lastMessage.thinking = thinking || ''; // Update thinking in real-time
          lastMessage.isStreaming = true;
          lastMessage.method = methodUsed;
          lastMessage.status = status;
        }
        return newMessages;
      });
    } else {
      // Stream completed - finalize message ONCE
      // Check if this message has already been finalized
      if (currentMessageId && !finalizedMessageIds.current.has(currentMessageId)) {
        setMessages(prev => {
          const newMessages = [...prev];
          const lastMessage = newMessages.find(m => m.id === currentMessageId);
          if (lastMessage && lastMessage.role === 'assistant' && lastMessage.isStreaming) {
            // Only finalize if message is still marked as streaming (prevents duplicate updates)
            lastMessage.text = text || '';
            lastMessage.thinking = thinking || ''; // Final thinking content
            lastMessage.isStreaming = false;
            lastMessage.method = methodUsed;
            lastMessage.routingDecision = routingDecision;
            lastMessage.status = null;
            
            // Store metadata with citations and used_chunk_ids
            if (finalMetadata) {
              lastMessage.used_chunk_ids = finalMetadata.used_chunk_ids || [];
              lastMessage.citations = finalMetadata.citations || null;
              console.log('[IntelligentFolderChat] Stored metadata in message:', {
                used_chunk_ids: lastMessage.used_chunk_ids,
                citations: lastMessage.citations
              });
            }
            
            // Mark this message as finalized
            finalizedMessageIds.current.add(currentMessageId);
          }
          return newMessages;
        });

        // Call completion callback
        if (onMessageComplete) {
          onMessageComplete({
            text,
            thinking,
            method: methodUsed,
            routingDecision,
            sessionId,
          });
        }

        // Clear current message ID to prevent further updates
        setCurrentMessageId(null);
      }
    }
  }, [text, thinking, isStreaming, methodUsed, routingDecision, status, currentMessageId, sessionId, onMessageComplete, finalMetadata]);

  // Fetch citations when a message is clicked/selected
  useEffect(() => {
    const fetchCitationsForMessage = async (message) => {
      if (!message || !folderName) {
        setCitations([]);
        return;
      }

      // Check if citations are already in the message
      if (message.citations && Array.isArray(message.citations) && message.citations.length > 0) {
        console.log('[IntelligentFolderChat] Using citations from message:', message.citations);
        const formattedCitations = message.citations.map((citation) => {
          const pageStart = citation.page_start || citation.pageStart;
          const pageEnd = citation.page_end || citation.pageEnd;
          const page = citation.page || pageStart;
          
          let pageLabel = null;
          if (pageStart && pageEnd && pageStart !== pageEnd) {
            pageLabel = `Pages ${pageStart}-${pageEnd}`;
          } else if (page || pageStart) {
            pageLabel = `Page ${page || pageStart}`;
          }

          const source = pageLabel 
            ? `${citation.filename || 'document.pdf'} - ${pageLabel}`
            : (citation.filename || 'document.pdf');

          return {
            page: page || pageStart,
            pageStart: pageStart,
            pageEnd: pageEnd,
            pageLabel: pageLabel,
            source: source,
            filename: citation.filename || 'document.pdf',
            fileId: citation.fileId || citation.file_id,
            text: citation.text || citation.content || citation.text_preview || '',
            link: `${citation.filename || 'document.pdf'}#page=${page || pageStart || 1}`,
            viewUrl: citation.viewUrl || (citation.fileId ? `${API_BASE_URL}/api/files/${citation.fileId}/view#page=${page || pageStart || 1}` : null)
          };
        });
        setCitations(formattedCitations);
        return;
      }

      // Fallback: fetch using used_chunk_ids
      if (!message.used_chunk_ids || message.used_chunk_ids.length === 0) {
        setCitations([]);
        return;
      }

      setLoadingCitations(true);
      try {
        const chunkDetails = await apiService.getFolderChunkDetails(message.used_chunk_ids, folderName);
        const formattedCitations = chunkDetails.map((chunk) => {
          const pageStart = chunk.page_start || chunk.pageStart;
          const pageEnd = chunk.page_end || chunk.pageEnd;
          const page = chunk.page || pageStart;
          
          let pageLabel = null;
          if (pageStart && pageEnd && pageStart !== pageEnd) {
            pageLabel = `Pages ${pageStart}-${pageEnd}`;
          } else if (page || pageStart) {
            pageLabel = `Page ${page || pageStart}`;
          }

          const source = pageLabel 
            ? `${chunk.filename || 'document.pdf'} - ${pageLabel}`
            : (chunk.filename || 'document.pdf');

          return {
            page: page || pageStart,
            pageStart: pageStart,
            pageEnd: pageEnd,
            pageLabel: pageLabel,
            source: source,
            filename: chunk.filename || 'document.pdf',
            fileId: chunk.file_id || chunk.fileId,
            text: chunk.content || chunk.text || '',
            link: `${chunk.filename || 'document.pdf'}#page=${page || pageStart || 1}`,
            viewUrl: chunk.file_id ? `${API_BASE_URL}/api/files/${chunk.file_id}/view#page=${page || pageStart || 1}` : null
          };
        });
        setCitations(formattedCitations);
      } catch (error) {
        console.error('[IntelligentFolderChat] Failed to fetch citations:', error);
        setCitations([]);
      } finally {
        setLoadingCitations(false);
      }
    };

    if (selectedMessageForCitations) {
      fetchCitationsForMessage(selectedMessageForCitations);
    }
  }, [selectedMessageForCitations, folderName]);

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();

    // Prevent submission if streaming
    if (isStreaming) return;

    // Check if using secret prompt or regular input
    if (isSecretPromptSelected && selectedSecretId) {
      // Secret prompt selected - only send secret_id, no question required
      // Backend will fetch the secret prompt using secret_id
      await handleSecretPromptSubmit();
      return; // Exit early to prevent any further validation
    } else if (input && input.trim()) {
      // Regular input - require question
      await handleRegularSubmit();
      return;
    }
    // If neither condition is met, do nothing (button should be disabled anyway)
  };

  // Handle regular chat submission
  const handleRegularSubmit = async () => {
    // Clear any previous streaming state before starting new message
    if (currentMessageId) {
      setCurrentMessageId(null);
    }

    const userMessage = {
      id: Date.now(),
      role: 'user',
      text: input.trim(),
      timestamp: new Date(),
    };

    const aiMessageId = Date.now() + 1;
    const aiMessage = {
      id: aiMessageId,
      role: 'assistant',
      text: '',
      thinking: '',
      isStreaming: true,
      method: null,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage, aiMessage]);
    setCurrentMessageId(aiMessageId);
    setInput('');

    setTimeout(() => inputRef.current?.focus(), 100);

    try {
      await sendMessage(input.trim(), null);
    } catch (err) {
      console.error('Error sending message:', err);
      // Reset current message ID on error
      if (currentMessageId === aiMessageId) {
        setCurrentMessageId(null);
      }
    }
  };

  // Handle secret prompt submission
  const handleSecretPromptSubmit = async () => {
    // Validate that we have a secret ID
    if (!selectedSecretId) {
      console.error('No secret ID selected');
      return;
    }

    // Clear any previous streaming state before starting new message
    if (currentMessageId) {
      setCurrentMessageId(null);
    }

    const selectedSecret = secrets.find(s => s.id === selectedSecretId);
    const promptLabel = selectedSecret?.name || 'Secret Prompt';

    const userMessage = {
      id: Date.now(),
      role: 'user',
      text: `📚 ${promptLabel}`,
      timestamp: new Date(),
    };

    const aiMessageId = Date.now() + 1;
    const aiMessage = {
      id: aiMessageId,
      role: 'assistant',
      text: '',
      thinking: '',
      isStreaming: true,
      method: null,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage, aiMessage]);
    setCurrentMessageId(aiMessageId);
    setIsSecretPromptSelected(false);

    setTimeout(() => inputRef.current?.focus(), 100);

    try {
      // ✅ Send ONLY secret_id - no question field at all
      // Backend will fetch the secret prompt using secret_id
      await sendMessage(null, selectedSecretId);
    } catch (err) {
      console.error('Error sending secret prompt:', err);
      // Reset current message ID on error
      if (currentMessageId === aiMessageId) {
        setCurrentMessageId(null);
      }
    }
  };

  // Handle dropdown selection
  const handleDropdownSelect = (secretName, secretId) => {
    setActiveDropdown(secretName);
    setSelectedSecretId(secretId);
    setIsSecretPromptSelected(true);
    setInput('');
    setShowDropdown(false);
  };

  // Handle input change
  const handleInputChange = (e) => {
    setInput(e.target.value);
    setIsSecretPromptSelected(false);
    setActiveDropdown('Custom Query');
  };

  // Handle stop streaming
  const handleStop = () => {
    stopStreaming();
    if (currentMessageId) {
      setMessages(prev => {
        const newMessages = [...prev];
        const lastMessage = newMessages.find(m => m.id === currentMessageId);
        if (lastMessage) {
          lastMessage.isStreaming = false;
        }
        return newMessages;
      });
      setCurrentMessageId(null);
    }
  };

  // Handle clear chat
  const handleClear = () => {
    if (window.confirm('Are you sure you want to clear the chat?')) {
      setMessages([]);
      setCurrentMessageId(null);
      finalizedMessageIds.current.clear(); // Clear finalized messages tracking
      clear();
    }
  };

  // Load secrets on mount
  useEffect(() => {
    fetchSecrets();
  }, []);

  // Close dropdown when clicking outside
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
  }, []);

  return (
    <div className={`intelligent-folder-chat ${className}`}>
      {/* Header */}
      <div className="chat-header">
        <h3>Intelligent Folder Chat</h3>
        {sessionId && (
          <div className="session-info">
            Session: {sessionId.substring(0, 8)}...
          </div>
        )}
        {messages.length > 0 && (
          <button
            onClick={handleClear}
            className="clear-button"
            title="Clear chat"
          >
            Clear
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="empty-state">
            <p>Ask questions about your documents</p>
            <div className="example-queries">
              <p className="example-label">Try asking:</p>
              <button
                className="example-query"
                onClick={() => setInput("Provide a complete summary of all documents")}
              >
                "Provide a complete summary of all documents"
              </button>
              <button
                className="example-query"
                onClick={() => setInput("What does the contract say about payment terms?")}
              >
                "What does the contract say about payment terms?"
              </button>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <div className="message-header">
              <span className="message-role">
                {msg.role === 'user' ? 'You' : 'AI'}
              </span>
              <span className="message-time">
                {msg.timestamp.toLocaleTimeString()}
              </span>
            </div>

            <div className="message-content">
              {msg.role === 'user' ? (
                <div className="user-message">{msg.text}</div>
              ) : (
                <>
                  {/* Thinking Section (Like Gemini) */}
                  {msg.thinking && (
                    <div className="thinking-section">
                      <div className="thinking-header">
                        <span className="thinking-icon">🧠</span>
                        <span className="thinking-label">Thinking...</span>
                      </div>
                      <div className="thinking-content">
                        {msg.thinking}
                        {msg.isStreaming && (
                          <span className="typing-indicator">▋</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Answer Section */}
                  <div className="ai-message">
                    {msg.text || (msg.isStreaming && !msg.thinking ? 'Generating response...' : '')}
                    {msg.isStreaming && msg.text && (
                      <span className="typing-indicator">▋</span>
                    )}
                  </div>

                  {/* Status Display (Gemini-like) - Shows what model is doing */}
                  {msg.status && (
                    <div className="status-display">
                      <div className="status-spinner"></div>
                      <div className="status-content">
                        <div className="status-label">
                          {msg.status.status}
                        </div>
                        <div className="status-message">
                          {msg.status.message}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Method badge */}
                  {msg.method && (
                    <div className="method-badge">
                      {msg.method === 'gemini_eyeball' ? (
                        <>
                          <span className="method-icon">📚</span>
                          <span className="method-label">Complete Analysis</span>
                          <span className="method-tooltip">
                            Using Gemini Eyeball - analyzing all folder documents
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="method-icon">🔍</span>
                          <span className="method-label">Targeted Search</span>
                          <span className="method-tooltip">
                            Using RAG - searching specific relevant sections
                          </span>
                        </>
                      )}
                    </div>
                  )}

                  {/* Routing decision info */}
                  {msg.routingDecision && (
                    <div className="routing-info">
                      <span className="info-icon">ℹ️</span>
                      <span className="routing-reason">{msg.routingDecision.reason}</span>
                      {msg.routingDecision.confidence && (
                        <span className="confidence">
                          Confidence: {Math.round(msg.routingDecision.confidence * 100)}%
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}

        {/* Error message */}
        {error && (
          <div className="error-message">
            <span className="error-icon">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input form */}
      <form onSubmit={handleSubmit} className="chat-input-form">
        <div className="input-container">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder={isSecretPromptSelected ? `Using: ${activeDropdown}` : "Ask a question about your documents..."}
            disabled={isStreaming}
            className="chat-input"
            autoFocus
          />
          <div className="input-actions">
            {/* Secret Prompt Dropdown */}
            <div className="relative" ref={dropdownRef} style={{ marginRight: '8px' }}>
              <button
                type="button"
                onClick={() => setShowDropdown(!showDropdown)}
                disabled={isLoadingSecrets || isStreaming}
                className="secret-dropdown-button"
                title="Select analysis prompt"
              >
                <BookOpen className="h-4 w-4" />
                <span className="text-sm">{isLoadingSecrets ? 'Loading...' : activeDropdown}</span>
                <ChevronDown className="h-4 w-4" />
              </button>

              {showDropdown && !isLoadingSecrets && (
                <div className="secret-dropdown-menu">
                  {secrets.length > 0 ? (
                    secrets.map((secret) => (
                      <button
                        key={secret.id}
                        type="button"
                        onClick={() => handleDropdownSelect(secret.name, secret.id)}
                        className="secret-dropdown-item"
                      >
                        {secret.name}
                      </button>
                    ))
                  ) : (
                    <div className="secret-dropdown-empty">
                      No analysis prompts available
                    </div>
                  )}
                </div>
              )}
            </div>

            {isStreaming ? (
              <button
                type="button"
                onClick={handleStop}
                className="stop-button"
                title="Stop streaming"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={(!input.trim() && !(isSecretPromptSelected && selectedSecretId)) || isStreaming}
                className="send-button"
                title="Send message"
              >
                Send
              </button>
            )}
          </div>
        </div>
      </form>

      {/* Citations Panel */}
      {showCitations && citations && citations.length > 0 && (
        <CitationsPanel
          citations={citations}
          fileId={null}
          onClose={() => {
            setShowCitations(false);
            setSelectedMessageForCitations(null);
          }}
          onCitationClick={(citation) => {
            const page = citation.page || citation.pageStart || 1;
            if (citation.fileId) {
              const url = `${API_BASE_URL}/api/files/${citation.fileId}/view#page=${page}`;
              window.open(url, '_blank');
            } else if (citation.viewUrl) {
              window.open(citation.viewUrl, '_blank');
            }
          }}
        />
      )}
    </div>
  );
}


