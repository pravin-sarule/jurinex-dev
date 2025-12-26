import React, { useState, useEffect, useRef } from 'react';
import { useIntelligentFolderChat } from '../hooks/useIntelligentFolderChat';
import { BookOpen, ChevronDown } from 'lucide-react';
import './IntelligentFolderChat.css';
import CitationsPanel from '../AnalysisPage/CitationsPanel';
import apiService from '../services/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { convertJsonToPlainText } from '../utils/jsonToPlainText';
import { renderSecretPromptResponse, isStructuredJsonResponse } from '../utils/renderSecretPromptResponse';
import { API_BASE_URL } from '../config/apiConfig';

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

  const [secrets, setSecrets] = useState([]);
  const [isLoadingSecrets, setIsLoadingSecrets] = useState(false);
  const [selectedSecretId, setSelectedSecretId] = useState(null);
  const [activeDropdown, setActiveDropdown] = useState('Summary');
  const [showDropdown, setShowDropdown] = useState(false);
  const [isSecretPromptSelected, setIsSecretPromptSelected] = useState(false);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const finalizedMessageIds = useRef(new Set());

  const {
    text,
    thinking,
    isStreaming,
    error,
    sessionId,
    methodUsed,
    routingDecision,
    status,
    finalMetadata,
    sendMessage,
    stopStreaming,
    clear,
  } = useIntelligentFolderChat(folderName, authToken);


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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, text]);

  useEffect(() => {
    if (!currentMessageId) return;

    if (isStreaming) {
      setMessages(prev => {
        const newMessages = [...prev];
        const lastMessage = newMessages.find(m => m.id === currentMessageId);
        if (lastMessage && lastMessage.role === 'assistant') {
          lastMessage.text = text || '';
          lastMessage.thinking = thinking || '';
          lastMessage.isStreaming = true;
          lastMessage.method = methodUsed;
          lastMessage.status = status;
        }
        return newMessages;
      });
    } else {
      if (currentMessageId && !finalizedMessageIds.current.has(currentMessageId)) {
        setMessages(prev => {
          const newMessages = [...prev];
          const lastMessage = newMessages.find(m => m.id === currentMessageId);
          if (lastMessage && lastMessage.role === 'assistant' && lastMessage.isStreaming) {
            lastMessage.text = text || '';
            lastMessage.thinking = thinking || '';
            lastMessage.isStreaming = false;
            lastMessage.method = methodUsed;
            lastMessage.routingDecision = routingDecision;
            lastMessage.status = null;
            
            if (finalMetadata) {
              lastMessage.used_chunk_ids = finalMetadata.used_chunk_ids || [];
              lastMessage.citations = finalMetadata.citations || null;
              console.log('[IntelligentFolderChat] Stored metadata in message:', {
                used_chunk_ids: lastMessage.used_chunk_ids,
                citations: lastMessage.citations
              });
            }
            
            finalizedMessageIds.current.add(currentMessageId);
          }
          return newMessages;
        });

        if (onMessageComplete) {
          onMessageComplete({
            text,
            thinking,
            method: methodUsed,
            routingDecision,
            sessionId,
          });
        }

        setCurrentMessageId(null);
      }
    }
  }, [text, thinking, isStreaming, methodUsed, routingDecision, status, currentMessageId, sessionId, onMessageComplete, finalMetadata]);

  useEffect(() => {
    const fetchCitationsForMessage = async (message) => {
      if (!message || !folderName) {
        setCitations([]);
        return;
      }

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

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (isStreaming) return;

    if (isSecretPromptSelected && selectedSecretId) {
      await handleSecretPromptSubmit();
      return;
    } else if (input && input.trim()) {
      await handleRegularSubmit();
      return;
    }
  };

  const handleRegularSubmit = async () => {
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
      if (currentMessageId === aiMessageId) {
        setCurrentMessageId(null);
      }
    }
  };

  const handleSecretPromptSubmit = async () => {
    if (!selectedSecretId) {
      console.error('No secret ID selected');
      return;
    }

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
      await sendMessage(null, selectedSecretId);
    } catch (err) {
      console.error('Error sending secret prompt:', err);
      if (currentMessageId === aiMessageId) {
        setCurrentMessageId(null);
      }
    }
  };

  const handleDropdownSelect = (secretName, secretId) => {
    setActiveDropdown(secretName);
    setSelectedSecretId(secretId);
    setIsSecretPromptSelected(true);
    setInput('');
    setShowDropdown(false);
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);
    setIsSecretPromptSelected(false);
    setActiveDropdown('Custom Query');
  };

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

  const handleClear = () => {
    if (window.confirm('Are you sure you want to clear the chat?')) {
      setMessages([]);
      setCurrentMessageId(null);
      finalizedMessageIds.current.clear();
      clear();
    }
  };

  useEffect(() => {
    fetchSecrets();
  }, []);

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

                  <div className="ai-message">
                    {msg.text ? (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeRaw, rehypeSanitize]}
                        components={{
                          h1: ({node, ...props}) => <h1 className="text-2xl font-bold mb-4 mt-6 text-gray-900 border-b-2 border-gray-300 pb-2" {...props} />,
                          h2: ({node, ...props}) => <h2 className="text-xl font-bold mb-3 mt-5 text-gray-900 border-b border-gray-200 pb-1" {...props} />,
                          h3: ({node, ...props}) => <h3 className="text-lg font-semibold mb-2 mt-4 text-gray-800" {...props} />,
                          h4: ({node, ...props}) => <h4 className="text-base font-semibold mb-2 mt-3 text-gray-800" {...props} />,
                          h5: ({node, ...props}) => <h5 className="text-sm font-semibold mb-1 mt-2 text-gray-700" {...props} />,
                          h6: ({node, ...props}) => <h6 className="text-sm font-semibold mb-1 mt-2 text-gray-700" {...props} />,
                          p: ({node, ...props}) => <p className="mb-3 leading-relaxed text-gray-800 text-[15px]" {...props} />,
                          strong: ({node, ...props}) => <strong className="font-bold text-gray-900" {...props} />,
                          em: ({node, ...props}) => <em className="italic text-gray-800" {...props} />,
                          ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-3 space-y-1 text-gray-800" {...props} />,
                          ol: ({node, ...props}) => <ol className="list-decimal pl-5 mb-3 space-y-1 text-gray-800" {...props} />,
                          li: ({node, ...props}) => <li className="leading-relaxed text-gray-800" {...props} />,
                          a: ({node, ...props}) => <a className="text-blue-600 hover:text-blue-800 underline font-medium transition-colors" target="_blank" rel="noopener noreferrer" {...props} />,
                          blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-blue-500 pl-4 py-2 my-3 bg-blue-50 text-gray-700 italic rounded-r" {...props} />,
                          code: ({node, inline, ...props}) => {
                            const className = inline 
                              ? "bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono text-red-600" 
                              : "block bg-gray-900 text-gray-100 p-3 rounded-md text-xs font-mono overflow-x-auto my-3";
                            return <code className={className} {...props} />;
                          },
                          pre: ({node, ...props}) => <pre className="bg-gray-900 rounded-md overflow-hidden my-3" {...props} />,
                          table: ({node, ...props}) => (
                            <div className="overflow-x-auto my-4">
                              <table className="min-w-full border-collapse border border-gray-300" {...props} />
                            </div>
                          ),
                          thead: ({node, ...props}) => <thead className="bg-gray-100" {...props} />,
                          th: ({node, ...props}) => <th className="border border-gray-300 px-3 py-2 text-left font-bold text-gray-900 text-sm" {...props} />,
                          tbody: ({node, ...props}) => <tbody {...props} />,
                          td: ({node, ...props}) => <td className="border border-gray-300 px-3 py-2 text-gray-800 text-sm" {...props} />,
                          tr: ({node, ...props}) => <tr className="hover:bg-gray-50" {...props} />,
                          hr: ({node, ...props}) => <hr className="my-4 border-gray-300" {...props} />,
                        }}
                      >
                        {(() => {
                          const rawResponse = msg.text || '';
                          if (!rawResponse) return '';
                          
                          const isStructured = isStructuredJsonResponse(rawResponse);
                          if (isStructured) {
                            return renderSecretPromptResponse(rawResponse);
                          }
                          
                          return convertJsonToPlainText(rawResponse);
                        })()}
                      </ReactMarkdown>
                    ) : (
                      msg.isStreaming && !msg.thinking ? 'Generating response...' : ''
                    )}
                    {msg.isStreaming && msg.text && (
                      <span className="typing-indicator">▋</span>
                    )}
                  </div>

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

        {error && (
          <div className="error-message">
            <span className="error-icon">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

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


