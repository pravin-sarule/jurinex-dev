import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useIntelligentFolderChat } from '../hooks/useIntelligentFolderChat';
import { BookOpen, ChevronDown, Mic, MicOff, Send, Sparkles, Copy, Download, FileText, Printer, Code, Search } from 'lucide-react';
import { getCleanText, downloadAsPdf, downloadAsHtml, printResponse } from '../utils/responseExportUtils';
import BrandingDownloadModal from './BrandingDownload/BrandingDownloadModal';
import './IntelligentFolderChat.css';
import CitationsPanel from '../AnalysisPage/CitationsPanel';
import apiService from '../services/api';
import documentApi from '../services/documentApi';
import LearningBubble from './LearningBubble';
import LearningQuestionModal from './LearningQuestionModal';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { convertJsonToPlainText } from '../utils/jsonToPlainText';
import {
  ensureTableSeparators,
  markdownTableComponents,
  markdownRehypePlugins,
  normalizeMarkdownFormatting,
  splitMarkdownIntoRenderChunks,
} from '../utils/markdownUtils';
import { renderSecretPromptResponse, isStructuredJsonResponse } from '../utils/renderSecretPromptResponse';
import { API_BASE_URL, CHAT_MODEL_BASE_URL, SECRET_PROMPTS_API_BASE, DOCS_BASE_URL } from '../config/apiConfig';
import { fetchSecretsList, peekSecretsList } from '../services/secretsService';
import ChatQuotaErrorModal from './ChatQuotaErrorModal';
import UpgradePlanBanner from './UpgradePlanBanner';

export default function IntelligentFolderChat({
  folderName,
  authToken = null,
  onMessageComplete = null,
  className = '',
  documentContext: documentContextProp = '',
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
  const [showStyleDropdown, setShowStyleDropdown] = useState(false);
  const [isSecretPromptSelected, setIsSecretPromptSelected] = useState(false);

  const [isListening, setIsListening] = useState(false);
  const [recognition, setRecognition] = useState(null);
  const [learningMode, setLearningMode] = useState(() => localStorage.getItem('learning_mode_enabled') === 'true');
  const [researchMode, setResearchMode] = useState(() => localStorage.getItem('research_mode_enabled') === 'true');
  // Deep Research: bounded agentic loop (plan → web-search rounds → synthesize) under a ₹10 budget.
  // Session-only (NOT persisted): it is a sub-toggle of Research, so it must never outlive it.
  const [deepResearchMode, setDeepResearchMode] = useState(false);
  const [adversarialMode, setAdversarialMode] = useState(() => localStorage.getItem('learning_adversarial_mode') === 'true');
  const [learningSessionId, setLearningSessionId] = useState(null);
  const [turnCount, setTurnCount] = useState(0);
  const [turnThreshold, setTurnThreshold] = useState(4);
  const [contextWarning, setContextWarning] = useState('');
  const [relationshipHint, setRelationshipHint] = useState('');

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const styleDropdownRef = useRef(null);
  const finalizedMessageIds = useRef(new Set());
  const messageRefs = useRef({});
  const [msgCopySuccess, setMsgCopySuccess] = useState(null);
  const [wordModalMsgId, setWordModalMsgId] = useState(null);

  // Setup speech recognition
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
        setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
      };
      recognitionInstance.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      setRecognition(recognitionInstance);
    }
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

  /** Same optional LLM overrides as ChatModelPage (VITE_* env). */
  const folderChatStreamFetchParams = useMemo(() => {
    const o = {};
    const mot = import.meta.env.VITE_CHAT_MODEL_MAX_OUTPUT_TOKENS;
    if (mot != null && String(mot).trim() !== '') {
      const n = Number(mot);
      if (Number.isFinite(n)) o.max_output_tokens = n;
    }
    const temp = import.meta.env.VITE_CHAT_MODEL_TEMPERATURE;
    if (temp != null && String(temp).trim() !== '') {
      const t = Number(temp);
      if (Number.isFinite(t)) o.model_temperature = t;
    }
    o.learning_mode = !!learningMode;
    o.research_mode = !!researchMode;
    o.deep_research = !!(researchMode && deepResearchMode);
    if (learningMode) {
      o.adversarial_mode = !!adversarialMode;
      if (relationshipHint) o.context_selection = relationshipHint;
    }
    return Object.keys(o).length ? o : null;
  }, [learningMode, researchMode, deepResearchMode, adversarialMode, relationshipHint]);

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
    learningPayload,
    learningPopupQuestion,
    dismissLearningPopup,
    sendMessage,
    stopStreaming,
    clear,
    clearError,
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

  /** Optional client-provided document_context (advanced); default is built on the server. */
  const optionalDocumentContextOverride = useMemo(
    () => String(documentContextProp || '').trim(),
    [documentContextProp],
  );

  const ensureLearningSession = async () => {
    const token = authToken || getAuthToken();
    const seg = encodeURIComponent(String(folderName || '').trim());
    const endpoint = `${String(DOCS_BASE_URL || '').replace(/\/$/, '')}/${seg}/learning/init`;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const body = { sessionId: learningSessionId || undefined };
    body.adversarial_mode = !!adversarialMode;
    if (optionalDocumentContextOverride) {
      body.documentContext = optionalDocumentContextOverride;
    }
    const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setContextWarning(String(err?.detail || err?.message || 'Learning Mode could not start'));
      return null;
    }
    setContextWarning('');
    const data = await res.json().catch(() => ({}));
    const sid = data?.sessionId || data?.session_id || learningSessionId || null;
    if (sid) setLearningSessionId(sid);
    if (typeof data?.turnCount === 'number') setTurnCount(data.turnCount);
    if (typeof data?.turnThreshold === 'number') setTurnThreshold(data.turnThreshold);
    return sid;
  };

  const analyzeRelationshipsForQuestion = async (questionText) => {
    if (!learningMode || !String(folderName || '').trim()) return '';
    const q = String(questionText || '').trim();
    if (!q) return '';
    const token = authToken || getAuthToken();
    const seg = encodeURIComponent(String(folderName || '').trim());
    const endpoint = `${String(DOCS_BASE_URL || '').replace(/\/$/, '')}/${seg}/learning/analyze-relationships`;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ query: q }),
      });
      if (!res.ok) return '';
      const data = await res.json().catch(() => ({}));
      const g = data?.grounding || {};
      const conflicts = Array.isArray(g?.conflicting_facts) ? g.conflicting_facts : [];
      const dates = Array.isArray(g?.key_dates) ? g.key_dates : [];
      const reqs = Array.isArray(g?.statutory_requirements) ? g.statutory_requirements : [];
      const summary = [
        conflicts[0]
          ? `Conflict: ${conflicts[0]?.left?.doc_id || 'Doc A'} vs ${conflicts[0]?.right?.doc_id || 'Doc B'}.`
          : '',
        dates[0] ? `Key date: ${dates[0]?.date_text || ''} (${dates[0]?.doc_id || 'document'}).` : '',
        reqs[0] ? `Statutory cue: ${reqs[0]?.requirement || ''} (${reqs[0]?.doc_id || 'document'}).` : '',
      ]
        .filter(Boolean)
        .join(' ');
      setRelationshipHint(summary);
      return summary;
    } catch (e) {
      console.warn('[IntelligentFolderChat] relationship analysis failed', e);
      return '';
    }
  };

  const loadSecrets = async () => {
    const cached = peekSecretsList();
    if (cached?.length) setSecrets(cached);
    if (!cached?.length) setIsLoadingSecrets(true);
    try {
      const secretsData = await fetchSecretsList();
      setSecrets(secretsData || []);
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
              if (finalMetadata.session_id) setLearningSessionId(finalMetadata.session_id);
              lastMessage.used_chunk_ids = finalMetadata.used_chunk_ids || [];
              lastMessage.citations = finalMetadata.citations || null;
              lastMessage.learningPayload = learningPayload || finalMetadata.learning_payload || null;
              lastMessage.learningPopupQuestion =
                finalMetadata.learning_popup_question || learningPopupQuestion || null;
              if (typeof finalMetadata.turn_count === 'number') setTurnCount(finalMetadata.turn_count);
              if (typeof finalMetadata.turn_threshold === 'number') setTurnThreshold(finalMetadata.turn_threshold);
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
  }, [
    text,
    thinking,
    isStreaming,
    methodUsed,
    routingDecision,
    status,
    currentMessageId,
    sessionId,
    onMessageComplete,
    finalMetadata,
    learningPayload,
    learningPopupQuestion,
  ]);

  useEffect(() => {
    localStorage.setItem('learning_mode_enabled', String(learningMode));
  }, [learningMode]);
  useEffect(() => {
    localStorage.setItem('research_mode_enabled', String(researchMode));
  }, [researchMode]);
  useEffect(() => {
    localStorage.setItem('learning_adversarial_mode', String(adversarialMode));
  }, [adversarialMode]);

  useEffect(() => {
    if (!learningMode) {
      setContextWarning('');
      setRelationshipHint('');
    }
  }, [learningMode]);

  useEffect(() => {
    if (!learningMode) return;
    setMessages([]);
    setCurrentMessageId(null);
    finalizedMessageIds.current.clear();
    setTurnCount(0);
    ensureLearningSession().catch(() => null);
  }, [folderName]);

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

  const handleQuickReply = async (optionText) => {
    if (!optionText || isStreaming) return;
    setInput(String(optionText));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await handleRegularSubmit(String(optionText));
  };

  const handleRegularSubmit = async (overrideText = null) => {
    if (currentMessageId) {
      setCurrentMessageId(null);
    }

    const outgoingText = (overrideText ?? input).trim();
    const userMessage = {
      id: Date.now(),
      role: 'user',
      text: outgoingText,
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
      let extra = { ...(folderChatStreamFetchParams || {}) };
      if (learningMode) {
        const sid = await ensureLearningSession();
        if (!sid) {
          setCurrentMessageId(null);
          setMessages(prev => prev.filter((m) => m.id !== aiMessageId));
          return;
        }
        const relHint = await analyzeRelationshipsForQuestion(outgoingText);
        extra = {
          ...extra,
          session_id: sid,
          ...(relHint ? { context_selection: relHint } : {}),
          ...(optionalDocumentContextOverride
            ? { document_context: optionalDocumentContextOverride }
            : {}),
        };
      }
      await sendMessage(outgoingText, null, extra || undefined);
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
      let extra = { ...(folderChatStreamFetchParams || {}) };
      if (learningMode) {
        const sid = await ensureLearningSession();
        if (!sid) {
          setCurrentMessageId(null);
          setMessages(prev => prev.filter((m) => m.id !== aiMessageId));
          return;
        }
        extra = {
          ...extra,
          session_id: sid,
          ...(relationshipHint ? { context_selection: relationshipHint } : {}),
          ...(optionalDocumentContextOverride
            ? { document_context: optionalDocumentContextOverride }
            : {}),
        };
      }
      await sendMessage(null, selectedSecretId, extra || undefined);
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

  const handleLearningModeToggle = async (enabled) => {
    if (enabled) {
      const sid = await ensureLearningSession();
      if (!sid) return;
      setMessages([]);
      setCurrentMessageId(null);
      finalizedMessageIds.current.clear();
      setTurnCount(0);
      setLearningMode(true);
      return;
    }
    const ok = window.confirm('Exit Learning Mode? Your progress will be reset.');
    if (!ok) return;
    setLearningMode(false);
    setLearningSessionId(null);
    setTurnCount(0);
  };

  const handleSelectStyle = async (style) => {
    if (style === 'learning') {
      setResearchMode(false);
      setDeepResearchMode(false);
      await handleLearningModeToggle(true);
    } else if (style === 'research') {
      if (learningMode) {
        setLearningMode(false);
        setLearningSessionId(null);
        setTurnCount(0);
      }
      setDeepResearchMode(false);
      setResearchMode(true);
      setMessages([]);
      setCurrentMessageId(null);
      finalizedMessageIds.current.clear();
    } else {
      if (learningMode) await handleLearningModeToggle(false);
      setResearchMode(false);
      setDeepResearchMode(false);
    }
    // Keep the menu open when Research is picked so its nested Deep Research toggle shows.
    if (style !== 'research') setShowStyleDropdown(false);
  };

  const getProcessedMsgText = (text) => {
    if (!text) return '';
    const isStructured = isStructuredJsonResponse(text);
    if (isStructured) return renderSecretPromptResponse(text);
    return convertJsonToPlainText(text);
  };

  const handleCopyMessage = async (msgId, msgText) => {
    try {
      const text = getCleanText(messageRefs.current[msgId], msgText);
      await navigator.clipboard.writeText(text);
      setMsgCopySuccess(msgId);
      setTimeout(() => setMsgCopySuccess(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Export the answer's markdown through the backend PDF builder — real
  // selectable text, proper tables and page breaks (html2pdf rasterizes the
  // DOM to images, which renders poorly). Falls back to the canvas approach
  // only if the backend export fails.
  const handleDownloadMsgPdf = async (msgId) => {
    const index = messages.findIndex((m) => m.id === msgId);
    const msg = messages[index];
    if (!msg?.text) return;
    const prevUser = messages.slice(0, index).reverse().find((m) => m.role === 'user');
    const question = String(prevUser?.text || '').trim();
    const title = question.length > 100 ? `${question.slice(0, 100)}…` : (question || 'AI Response');
    try {
      await documentApi.exportMergedPdf(
        title,
        [{ question: question || 'AI Response', answer: getProcessedMsgText(msg.text), source: null }],
        false
      );
    } catch (err) {
      console.error('Backend PDF export failed, falling back to canvas PDF:', err);
      try {
        await downloadAsPdf(messageRefs.current[msgId], `AI_Response_${new Date().toISOString().slice(0, 10)}.pdf`);
      } catch (fallbackErr) {
        console.error('Failed to generate PDF:', fallbackErr);
      }
    }
  };

  const handleDownloadMsgWord = (msgId) => {
    setWordModalMsgId(msgId);
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
    loadSecrets();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
      if (styleDropdownRef.current && !styleDropdownRef.current.contains(event.target)) {
        setShowStyleDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className={`intelligent-folder-chat ${className}`}>
      <ChatQuotaErrorModal error={error} onDismiss={clearError} />
      <LearningQuestionModal
        open={Boolean(learningMode && learningPopupQuestion)}
        data={learningPopupQuestion}
        folderName={folderName}
        sessionId={learningSessionId || sessionId}
        authToken={authToken}
        onClose={() => dismissLearningPopup()}
        onCompleted={(r) => {
          dismissLearningPopup();
          const follow = r && typeof r.follow_up_message === 'string' ? r.follow_up_message.trim() : '';
          if (follow) {
            setMessages((prev) => [
              ...prev,
              {
                id: Date.now(),
                role: 'assistant',
                text: follow,
                timestamp: new Date(),
                thinking: '',
                isStreaming: false,
              },
            ]);
          }
        }}
      />
      <div className="chat-header">
        <h3>
          Intelligent Folder Chat
          {learningMode ? <span className="learning-mode-tag">📖 Learning Mode</span> : null}
          {researchMode ? <span className="research-mode-tag">Research Mode · Live web</span> : null}
          {deepResearchMode ? <span className="research-mode-tag">Deep Research · agentic · ₹10 budget</span> : null}
        </h3>
        <div className="style-dropdown-wrap" ref={styleDropdownRef}>
          <button
            type="button"
            className={`learning-pill-toggle ${learningMode || researchMode || deepResearchMode ? 'active' : ''}`}
            onClick={() => setShowStyleDropdown((s) => !s)}
            disabled={isStreaming || !String(folderName || '').trim()}
            title={!String(folderName || '').trim() ? 'Select a folder first' : 'Choose response style'}
          >
            <span className="learning-pill-knob" />
            <span className="learning-pill-label">{learningMode ? 'Learning' : deepResearchMode ? 'Deep Research' : researchMode ? 'Research' : 'Normal'}</span>
            <ChevronDown className="h-3 w-3" />
          </button>
          {showStyleDropdown && (
            <div className="style-dropdown-menu">
              <button type="button" className="style-dropdown-item" onClick={() => handleSelectStyle('normal')}>
                Normal
              </button>
              <button
                type="button"
                className="style-dropdown-item"
                onClick={() => handleSelectStyle('learning')}
                disabled={!String(folderName || '').trim()}
              >
                Learning
              </button>
              <button type="button" className="style-dropdown-item" onClick={() => handleSelectStyle("research")} disabled={!String(folderName || "").trim()}>
                <Search className="h-3.5 w-3.5" />
                Research
              </button>
              {/* Deep Research is a sub-toggle of Research: shown only while Research is active;
                  toggling keeps the menu open so its ON/OFF state stays visible. */}
              {researchMode && (
                <button
                  type="button"
                  className="style-dropdown-item"
                  style={{ paddingLeft: '1.75rem', justifyContent: 'space-between' }}
                  onClick={(e) => { e.stopPropagation(); setDeepResearchMode((v) => !v); }}
                  title="Bounded agentic research: plans, runs multiple live web-search rounds, then writes a cited report. Slower & costs more (hard ₹10 budget)."
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Search className="h-3.5 w-3.5" />
                    Deep Research · ₹10
                  </span>
                  <span style={{ fontSize: '10px', fontWeight: 700, color: deepResearchMode ? '#21C1B6' : '#9ca3af' }}>
                    {deepResearchMode ? 'ON' : 'OFF'}
                  </span>
                </button>
              )}
            </div>
          )}
        </div>
        {learningMode && (
          <button
            type="button"
            onClick={() => setAdversarialMode((s) => !s)}
            disabled={isStreaming}
            title="Toggle opposing counsel challenge mode"
            style={{
              marginLeft: 8,
              padding: '6px 10px',
              borderRadius: 10,
              border: `1px solid ${adversarialMode ? '#b91c1c' : '#d1d5db'}`,
              background: adversarialMode ? '#fef2f2' : '#fff',
              color: adversarialMode ? '#b91c1c' : '#374151',
              fontSize: 12,
              fontWeight: 600,
              cursor: isStreaming ? 'not-allowed' : 'pointer',
            }}
          >
            {adversarialMode ? 'Adversarial: ON' : 'Adversarial: OFF'}
          </button>
        )}
        {learningMode && turnCount > 0 && turnCount < turnThreshold && (
          <div className="turn-progress">
            <span>Turn {turnCount} of {turnThreshold}</span>
            <span className="turn-dots">
              {Array.from({ length: turnThreshold }).map((_, i) => (
                <span key={`turn-dot-${i}`} className={i < turnCount ? 'dot filled' : 'dot'}>●</span>
              ))}
            </span>
          </div>
        )}
        {(learningSessionId || sessionId) && (
          <div className="session-info">
            Session: {(learningSessionId || sessionId).substring(0, 8)}...
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
      {contextWarning ? (
        <div className="learning-warning-banner">
          {contextWarning}
        </div>
      ) : null}
      {learningMode && relationshipHint ? (
        <div className="learning-warning-banner" style={{ background: '#ecfeff', borderColor: '#99f6e4', color: '#0f766e' }}>
          Deep grounding active: {relationshipHint}
        </div>
      ) : null}

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

                  <div
                    className="ai-message"
                    ref={el => { if (el) messageRefs.current[msg.id] = el; else delete messageRefs.current[msg.id]; }}
                  >
                    {msg.learningPayload ? (
                      <LearningBubble
                        payload={msg.learningPayload}
                        isStreaming={isStreaming}
                        onOptionSelect={handleQuickReply}
                      />
                    ) : msg.text ? (
                      (() => {
                        const rawResponse = msg.text || '';
                        if (!rawResponse) return null;
                        const isStructured = isStructuredJsonResponse(rawResponse);
                        const formatted = isStructured
                          ? renderSecretPromptResponse(rawResponse)
                          : convertJsonToPlainText(rawResponse);
                        const prepared = ensureTableSeparators(normalizeMarkdownFormatting(formatted));
                        return splitMarkdownIntoRenderChunks(prepared).map((chunk, index) => (
                          <ReactMarkdown
                            key={`${index}-${chunk.length}`}
                            remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
                            rehypePlugins={markdownRehypePlugins}
                            components={markdownTableComponents}
                          >
                            {chunk}
                          </ReactMarkdown>
                        ));
                      })()
                    ) : (
                      msg.isStreaming && !msg.thinking ? 'Generating response...' : ''
                    )}
                    {msg.isStreaming && msg.text && (
                      <span className="typing-indicator">▋</span>
                    )}
                  </div>

                  {!msg.isStreaming && msg.text && (
                    <div className="ai-message-actions">
                      <button
                        className="ai-msg-action-btn"
                        onClick={() => handleCopyMessage(msg.id, msg.text)}
                        title="Copy response"
                      >
                        <Copy size={13} />
                        <span>{msgCopySuccess === msg.id ? 'Copied!' : 'Copy'}</span>
                      </button>
                      <button
                        className="ai-msg-action-btn"
                        onClick={() => handleDownloadMsgPdf(msg.id)}
                        title="Download as PDF"
                      >
                        <Download size={13} />
                        <span>PDF</span>
                      </button>
                      <button
                        className="ai-msg-action-btn"
                        onClick={() => handleDownloadMsgWord(msg.id)}
                        title="Download as Word"
                      >
                        <FileText size={13} />
                        <span>Word</span>
                      </button>
                      <button
                        className="ai-msg-action-btn"
                        onClick={() => downloadAsHtml(messageRefs.current[msg.id], `AI_Response_${new Date().toISOString().slice(0, 10)}.html`)}
                        title="Download as HTML"
                      >
                        <Code size={13} />
                        <span>HTML</span>
                      </button>
                      <button
                        className="ai-msg-action-btn"
                        onClick={() => printResponse(messageRefs.current[msg.id])}
                        title="Print response"
                      >
                        <Printer size={13} />
                        <span>Print</span>
                      </button>
                    </div>
                  )}

                  {msg.status && (
                    <div className="status-display">
                      <div className="status-spinner"></div>
                      <div className="status-content">
                        <div className="status-label">
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
                      ) : msg.method === 'gemini_research' ? (
                        <>
                          <span className="method-icon">🌐</span>
                          <span className="method-label">Live Research</span>
                          <span className="method-tooltip">Gemini with Google Search grounding and case documents</span>
                        </>
                      ) : msg.method === 'deep_research' ? (
                        <>
                          <span className="method-icon">🧭</span>
                          <span className="method-label">Deep Research</span>
                          <span className="method-tooltip">Bounded agentic loop: plan → multiple live web-search rounds → cited synthesis (hard ₹10 budget)</span>
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

        <div ref={messagesEndRef} />
      </div>

      <UpgradePlanBanner className="chat-upgrade-banner mb-2" />
      <form onSubmit={handleSubmit} className="chat-input-form">
        <div className="input-container flex items-center space-x-2 bg-white rounded-xl border border-[#21C1B6] px-4 py-2 focus-within:ring-2 focus-within:ring-[#21C1B6]/20 transition-all">
          {learningMode && (
            <div className="learning-active-chip" title="Learning mode is active">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Learning</span>
              <button
                type="button"
                className="learning-chip-close"
                onClick={() => handleLearningModeToggle(false)}
                disabled={isStreaming}
              >
                ×
              </button>
            </div>
          )}
          {researchMode && (
            <div className="research-active-chip" title="Gemini research with live Google Search grounding">
              <Search className="h-3.5 w-3.5" />
              <span>Research</span>
              <button type="button" className="learning-chip-close" onClick={() => setResearchMode(false)} disabled={isStreaming}>×</button>
            </div>
          )}
          {deepResearchMode && (
            <div className="research-active-chip" title="Bounded agentic research: multiple live web-search rounds then a cited report. Hard ₹10 budget.">
              <Search className="h-3.5 w-3.5" />
              <span>Deep Research · ₹10</span>
              <button type="button" className="learning-chip-close" onClick={() => setDeepResearchMode(false)} disabled={isStreaming}>×</button>
            </div>
          )}
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder={isSecretPromptSelected ? `Using: ${activeDropdown}` : deepResearchMode ? "Deep research this across your documents and the live web (slower, ₹10 budget)..." : researchMode ? "Research this topic using case documents and the live web..." : "Ask a question about your documents..."}
            disabled={isStreaming || (learningMode && !!learningPopupQuestion)}
            className="flex-grow bg-transparent border-none outline-none text-gray-900 placeholder-gray-500 text-sm font-medium py-2 min-w-0"
            autoFocus
          />
          <div className="input-actions flex items-center space-x-2">
            <div className="relative flex-shrink-0" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setShowDropdown(!showDropdown)}
                disabled={isLoadingSecrets || isStreaming}
                className="flex items-center space-x-2 px-3 py-1.5 text-xs font-semibold text-gray-700 bg-gray-50 border border-gray-200 rounded-lg hover:border-[#21C1B6] hover:bg-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                title="Select analysis prompt"
              >
                <BookOpen className="h-3.5 w-3.5 text-[#21C1B6]" />
                <span>{isLoadingSecrets ? 'Loading...' : activeDropdown}</span>
                <ChevronDown className="h-3.5 w-3.5" />
              </button>

              {showDropdown && !isLoadingSecrets && (
                <div className="absolute bottom-full right-0 mb-2 w-56 bg-white border border-gray-200 rounded-xl shadow-xl z-50 py-1 overflow-hidden">
                  {secrets.length > 0 ? (
                    secrets.map((secret) => (
                      <button
                        key={secret.id}
                        type="button"
                        onClick={() => handleDropdownSelect(secret.name, secret.id)}
                        className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-[#21C1B6]/5 hover:text-[#21C1B6] transition-colors"
                      >
                        {secret.name}
                      </button>
                    ))
                  ) : (
                    <div className="px-4 py-3 text-sm text-gray-500 italic">
                      No analysis prompts available
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={toggleListening}
              className={`p-2 rounded-full transition-all duration-300 ${
                isListening 
                  ? 'bg-red-500 text-white animate-pulse shadow-lg scale-110' 
                  : 'text-gray-400 hover:text-[#21C1B6] hover:bg-gray-100'
              }`}
              disabled={isStreaming || isSecretPromptSelected}
              title={isListening ? "Stop listening" : "Start voice input"}
            >
              {isListening ? (
                <MicOff className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </button>

            {isStreaming ? (
              <button
                type="button"
                onClick={handleStop}
                className="px-4 py-2 bg-black text-white rounded-lg text-sm font-semibold hover:bg-gray-800 transition-colors shadow-sm"
                title="Stop streaming"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={
                  (!input.trim() && !(isSecretPromptSelected && selectedSecretId)) ||
                  isStreaming ||
                  (learningMode && !!learningPopupQuestion)
                }
                className="flex items-center space-x-2 px-4 py-2 bg-[#21C1B6] text-white rounded-lg text-sm font-semibold hover:bg-[#1AA49B] transition-all disabled:bg-gray-200 disabled:text-gray-400 shadow-sm active:scale-95"
                title="Send message"
              >
                <Send className="h-4 w-4" />
                <span>Send</span>
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
      <BrandingDownloadModal
        isOpen={wordModalMsgId != null}
        onClose={() => setWordModalMsgId(null)}
        contentRef={{ current: wordModalMsgId ? messageRefs.current[wordModalMsgId] : null }}
        filename={`AI_Response_${new Date().toISOString().slice(0, 10)}.docx`}
        format="word"
        module="folder-chat"
      />
    </div>
  );
}
