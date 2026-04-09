import '../styles/AnalysisPage.css';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { API_BASE_URL, CHAT_MODEL_BASE_URL, SECRET_PROMPTS_API_BASE } from '../config/apiConfig';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { useSidebar } from '../context/SidebarContext';
import DownloadPdf from '../components/DownloadPdf/DownloadPdf';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import UploadProgressPanel from '../components/AnalysisPage/UploadProgressPanel';
import ChatInputArea from '../components/AnalysisPage/ChatInputArea';
import MessagesList from '../components/AnalysisPage/MessageList';
import DocumentViewer from '../components/AnalysisPage/DocumentViewer';
import ProgressStagesPopup from '../components/AnalysisPage/ProgressStagesPopup';
import UploadOptionsMenu from '../components/UploadOptionsMenu';
import googleDriveApi from '../services/googleDriveApi';
import apiService from '../services/api';
import { renderSecretPromptResponse, isStructuredJsonResponse } from '../utils/renderSecretPromptResponse';
import { convertJsonToPlainText } from '../utils/jsonToPlainText';
import { buildSuggestedQuestions } from '../utils/suggestedQuestions';
import { formatFileSize } from '../utils/planUtils';
import { useLlmChatLimits } from '../hooks/useLlmChatLimits';
import { formatUploadLimitExceededMessage } from '../services/llmChatLimitsService';
import { getChatModelQuotaUserMessage } from '../utils/llmQuotaMessages';
import {
  Search,
  Send,
  FileText,
  Trash2,
  RotateCcw,
  ChevronRight,
  AlertTriangle,
  Clock,
  Loader2,
  Upload,
  Download,
  AlertCircle,
  CheckCircle,
  X,
  Eye,
  Quote,
  BookOpen,
  Copy,
  ChevronDown,
  Paperclip,
  MessageSquare,
  FileCheck,
  Bot,
  Check,
  Circle,
  CreditCard,
  Square,
  Mic,
  MicOff,
} from 'lucide-react';

const PROGRESS_STAGES = {
  INIT: { range: [0, 15], label: 'Initialization' },
  EXTRACT: { range: [15, 45], label: 'Text Extraction' },
  CHUNK: { range: [45, 62], label: 'Chunking' },
  EMBED: { range: [62, 78], label: 'Embeddings' },
  STORE: { range: [78, 90], label: 'Database Storage' },
  SUMMARY: { range: [90, 95], label: 'Summary Generation' },
  FINAL: { range: [95, 100], label: 'Finalization' },
};

const STAGE_COLORS = {
  INIT: 'from-blue-200 to-blue-400',
  EXTRACT: 'from-blue-300 to-blue-500',
  CHUNK: 'from-blue-400 to-blue-600',
  EMBED: 'from-blue-500 to-blue-700',
  STORE: 'from-blue-600 to-blue-800',
  SUMMARY: 'from-blue-700 to-blue-900',
  FINAL: 'from-blue-800 to-blue-950',
};

const getCurrentStage = (progress) => {
  for (const [key, stage] of Object.entries(PROGRESS_STAGES)) {
    if (progress >= stage.range[0] && progress < stage.range[1]) {
      return key;
    }
  }
  return 'FINAL';
};

const getStageColor = (progress) => {
  const stageKey = getCurrentStage(progress);
  return STAGE_COLORS[stageKey] || 'from-blue-500 to-blue-700';
};

const getStageStatus = (stageKey, progress) => {
  const stage = PROGRESS_STAGES[stageKey];
  if (progress >= stage.range[1]) return 'completed';
  if (progress >= stage.range[0] && progress < stage.range[1]) return 'active';
  return 'pending';
};

const formatRateQuotaValue = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 'Unlimited';
  return String(Math.floor(n));
};

const RateQuotaPills = ({ limits, className = '' }) => {
  if (!limits) return null;
  const items = [
    { key: 'messages_per_hour', label: 'Messages / hour' },
    { key: 'quota_chats_per_minute', label: 'Chats / minute' },
    { key: 'chats_per_day', label: 'Chats / day' },
    { key: 'total_tokens_per_day', label: 'Tokens / 24h' },
  ];
  return (
    <div className={`rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 ${className}`.trim()}>
      <p className="text-[11px] uppercase tracking-[0.16em] text-[#807868] mb-1.5">Rate & Quota Limits</p>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <div key={item.key} className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1">
            <span className="text-[11px] text-gray-500">{item.label}</span>
            <span className="text-xs font-semibold text-gray-800">{formatRateQuotaValue(limits[item.key])}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const RealTimeProgressPanel = ({ processingStatus }) => {
  if (!processingStatus || !['processing', 'batch_processing', 'error'].includes(processingStatus.status)) return null;

  const progress = processingStatus.processing_progress || 0;
  const isError = processingStatus.status === 'error';
  const isBatch = processingStatus.status === 'batch_processing';

  const formatDate = (dateString) => {
    try {
      return new Date(dateString).toLocaleString();
    } catch (e) {
      return 'Invalid date';
    }
  };

  const getSubProgress = () => {
    if (processingStatus.embeddings_generated !== undefined && processingStatus.embeddings_total !== undefined) {
      return `${processingStatus.embeddings_generated}/${processingStatus.embeddings_total} embeddings`;
    }
    if (processingStatus.chunks_saved !== undefined) {
      return `${processingStatus.chunks_saved} chunks saved`;
    }
    if (processingStatus.estimated_pages !== undefined) {
      return `Estimated ${processingStatus.estimated_pages} pages`;
    }
    return null;
  };

  const subProgress = getSubProgress();

  return (
    <div className="fixed top-4 left-1/2 z-50 transform -translate-x-1/2">
      <div
        className={`bg-white rounded-lg shadow-xl p-4 w-80 border-2 max-w-sm transition-all duration-300 ${
          isError
            ? 'border-red-200 animate-pulse'
            : isBatch
            ? 'border-yellow-200'
            : 'border-blue-200'
        }`}
      >
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-base font-semibold text-gray-900 flex items-center">
            {isError ? (
              <AlertTriangle className="h-4 w-4 text-red-500 mr-1.5 animate-pulse" />
            ) : isBatch ? (
              <FileText className="h-4 w-4 text-yellow-500 mr-1.5" />
            ) : (
              <Loader2 className="h-4 w-4 text-blue-500 mr-1.5 animate-spin" />
            )}
            {isError ? 'Processing Error' : isBatch ? 'Batch Processing' : 'Document Processing'}
          </h3>
        </div>
        {isError ? (
          <div className="text-center">
            <AlertTriangle className="h-10 w-10 text-red-500 mx-auto mb-3 animate-pulse" />
            <p className="text-red-700 text-xs mb-3 font-medium">
              {processingStatus.job_error || 'An error occurred during processing'}
            </p>
            <p className="text-xs text-gray-500">Last updated: {formatDate(processingStatus.last_updated)}</p>
          </div>
        ) : (
          <>
            <div className="mb-3">
              <div className="flex justify-between text-xs text-gray-600 mb-1.5">
                <span>Progress</span>
                <span className="font-semibold text-blue-600">{Math.round(progress)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden relative">
                <div
                  className={`h-2 rounded-full transition-all duration-1000 ease-out relative overflow-hidden bg-gradient-to-r ${getStageColor(
                    progress
                  )}`}
                  style={{ width: `${progress}%` }}
                >
                  <div className="absolute inset-0 bg-white/20 animate-shimmer"></div>
                </div>
              </div>
            </div>
            <div className="mb-3">
              <p className="text-xs text-gray-700 font-medium bg-blue-50 p-1.5 rounded text-blue-800 break-words">
                {processingStatus.current_operation || 'Processing document...'}
              </p>
              {subProgress && (
                <p className="text-xs text-gray-600 mt-1 bg-gray-50 p-1 rounded">{subProgress}</p>
              )}
            </div>
            <div className="space-y-1.5 mb-3">
              {Object.entries(PROGRESS_STAGES).map(([key, { label }]) => {
                const status = getStageStatus(key, progress);
                return (
                  <div
                    key={key}
                    className={`flex items-center space-x-2 py-0.5 transition-all duration-300 ${
                      status === 'completed'
                        ? 'opacity-100'
                        : status === 'active'
                        ? 'opacity-100'
                        : 'opacity-50'
                    }`}
                  >
                    {status === 'completed' ? (
                      <Check className="h-3 w-3 text-green-500 animate-pulse" />
                    ) : status === 'active' ? (
                      <Loader2 className="h-3 w-3 text-[#21C1B6] animate-spin" />
                    ) : (
                      <Circle className="h-3 w-3 text-gray-300" />
                    )}
                    <span
                      className={`text-xs font-medium transition-colors ${
                        status === 'completed'
                          ? 'text-green-600'
                          : status === 'active'
                          ? 'text-[#21C1B6] font-semibold'
                          : 'text-gray-400'
                      }`}
                    >
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
            {processingStatus.chunk_count > 0 && (
              <p className="text-xs text-gray-600 mb-1.5 flex items-center">
                <FileText className="h-3 w-3 mr-1 text-gray-500" />
                {processingStatus.chunk_count} chunks created
              </p>
            )}
            {processingStatus.chunking_method && (
              <p className="text-xs text-gray-600 mb-1.5 flex items-center">
                <BookOpen className="h-3 w-3 mr-1 text-gray-500" />
                Method: {processingStatus.chunking_method}
              </p>
            )}
            <p className="text-xs text-gray-400 flex items-center">
              <Clock className="h-3 w-3 mr-1" />
              Last updated: {formatDate(processingStatus.last_updated)}
            </p>
          </>
        )}
      </div>
    </div>
  );
};

const ChatModelPage = () => {
  const location = useLocation();
  const { fileId: paramFileId, sessionId: paramSessionId } = useParams();
  const { setIsSidebarHidden, setIsSidebarCollapsed } = useSidebar();
  const navigate = useNavigate();

  const { maxUploadBytes, maxUploadMbLabel, loading: limitsLoading, error: limitsError, limits, refresh: refreshLimits } = useLlmChatLimits();

  /** All file UUIDs attached in this session (multi-doc chat). Primary id is fileId / first entry. */
  const chatAttachmentFileIdsRef = useRef([]);

  const [activeDropdown, setActiveDropdown] = useState('Custom Query');
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [hasResponse, setHasResponse] = useState(false);
  const [isSecretPromptSelected, setIsSecretPromptSelected] = useState(false);
  const [fileSizeLimitError, setFileSizeLimitError] = useState(null);

  const [documentData, setDocumentData] = useState(null);
  const [messages, setMessages] = useState([]);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [fileId, setFileId] = useState(paramFileId || null);
  const [sessionId, setSessionId] = useState(paramSessionId || null);
  const [currentResponse, setCurrentResponse] = useState('');
  const [animatedResponseContent, setAnimatedResponseContent] = useState('');
  const [isAnimatingResponse, setIsAnimatingResponse] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [showSplitView, setShowSplitView] = useState(false);
  const [splitLeftWidth, setSplitLeftWidth] = useState(48);
  const [isResizingSplit, setIsResizingSplit] = useState(false);
  const [isDesktopSplit, setIsDesktopSplit] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : false
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMessageId, setSelectedMessageId] = useState(null);
  const [displayLimit, setDisplayLimit] = useState(10);
  const [showAllChats, setShowAllChats] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const [secrets, setSecrets] = useState([]);
  const [isLoadingSecrets, setIsLoadingSecrets] = useState(false);
  const [selectedSecretId, setSelectedSecretId] = useState(null);
  const [selectedLlmName, setSelectedLlmName] = useState(null);

  const [batchUploads, setBatchUploads] = useState([]);
  const [uploadedDocuments, setUploadedDocuments] = useState([]);
  const [showInsufficientFundsAlert, setShowInsufficientFundsAlert] = useState(false);
  const [activePollingFiles, setActivePollingFiles] = useState(new Set());

  const [processingStatus, setProcessingStatus] = useState(null);
  const [progressPercentage, setProgressPercentage] = useState(0);

  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedFileId, setUploadedFileId] = useState(null);
  const [isChatUploading, setIsChatUploading] = useState(false);
 
  const [streamingStatus, setStreamingStatus] = useState(null);
  const [streamingMessage, setStreamingMessage] = useState('');
  const [pendingQuestion, setPendingQuestion] = useState(null);
  const [processingTimeline, setProcessingTimeline] = useState([]);
  const [showProcessingTimeline, setShowProcessingTimeline] = useState(true);
  const [reasoningText, setReasoningText] = useState('');
  const [showReasoning, setShowReasoning] = useState(true);
 
  const [chatModelFiles, setChatModelFiles] = useState([]);
  const [chatModelHistory, setChatModelHistory] = useState([]);

  /** Messages for the active session only (UI + viewer; `messages` may hold mixed sessions from restore). */
  const sessionMessages = useMemo(() => {
    if (!Array.isArray(messages) || messages.length === 0) return [];

    if (sessionId) {
      const matched = messages.filter(
        (m) => m.session_id != null && String(m.session_id) === String(sessionId)
      );
      if (matched.length > 0) return matched;
    }

    // Fallback for fresh streams before session_id is attached on metadata/done.
    const pendingWithoutSession = messages.filter((m) => m.session_id == null);
    if (pendingWithoutSession.length > 0) return pendingWithoutSession;

    return [];
  }, [messages, sessionId]);

  const fileInputRef = useRef(null);
  const dropdownRef = useRef(null);
  const responseRef = useRef(null);
  const markdownOutputRef = useRef(null);
  const exportContentRef = useRef(null);
  const animationFrameRef = useRef(null);
  const streamBufferRef = useRef('');
  const streamUpdateTimeoutRef = useRef(null);
  const streamReaderRef = useRef(null);
  const splitContainerRef = useRef(null);
  /** Optional per-request LLM overrides (VITE_CHAT_MODEL_MAX_OUTPUT_TOKENS, VITE_CHAT_MODEL_TEMPERATURE). */
  const chatModelStreamFetchParams = useMemo(() => {
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
    return Object.keys(o).length ? o : null;
  }, []);

  const pollingIntervalRef = useRef(null);
  
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
        setChatInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
        
        // Reset secret prompt if voice input is given
        if (isSecretPromptSelected) {
          setIsSecretPromptSelected(false);
          setActiveDropdown("Custom Query");
          setSelectedSecretId(null);
        }
      };
      recognitionInstance.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      setRecognition(recognitionInstance);
    }
  }, [isSecretPromptSelected]);

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
  const batchPollingIntervalsRef = useRef({});
  const uploadIntervalRef = useRef(null);

  useEffect(() => {
    const handleWindowResize = () => {
      setIsDesktopSplit(window.innerWidth >= 1024);
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, []);

  useEffect(() => {
    if (!isResizingSplit) return undefined;

    const handleMouseMove = (event) => {
      const container = splitContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (!rect.width) return;
      const rawPercent = ((event.clientX - rect.left) / rect.width) * 100;
      const clampedPercent = Math.min(72, Math.max(28, rawPercent));
      setSplitLeftWidth(clampedPercent);
    };

    const handleMouseUp = () => {
      setIsResizingSplit(false);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSplit]);

  const getAuthToken = () => {
    const tokenKeys = [
      'authToken',
      'token',
      'accessToken',
      'jwt',
      'bearerToken',
      'auth_token',
      'access_token',
      'api_token',
      'userToken',
    ];
    for (const key of tokenKeys) {
      const token = localStorage.getItem(key);
      if (token) return token;
    }
    return null;
  };

  const apiRequest = async (url, options = {}) => {
    try {
      const token = getAuthToken();
      const defaultHeaders = { 'Content-Type': 'application/json' };
      if (token) {
        defaultHeaders['Authorization'] = `Bearer ${token}`;
      }
      const headers =
        options.body instanceof FormData
          ? token
            ? { 'Authorization': `Bearer ${token}` }
            : {}
          : { ...defaultHeaders, ...options.headers };
      const response = await fetch(`${API_BASE_URL}${url}`, { ...options, headers });

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch {
          errorData = { error: `HTTP error! status: ${response.status}` };
        }
        switch (response.status) {
          case 401:
            throw new Error('Authentication required. Please log in again.');
          case 403:
            throw new Error(errorData.error || 'Access denied.');
          case 404:
            throw new Error('Resource not found.');
          case 413:
            throw new Error('File too large.');
          case 415:
            throw new Error('Unsupported file type.');
          case 429:
            throw new Error('Too many requests.');
          default:
            throw new Error(errorData.error || errorData.message || `Request failed with status ${response.status}`);
        }
      }
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      }
      return response;
    } catch (error) {
      throw error;
    }
  };

  const uploadDocumentToChat = async (file, options = {}) => {
    const { skipFinalize = false } = options;
    try {
      setIsChatUploading(true);
      setUploadProgress(0);
      setError(null);
      const response = await apiService.uploadChatModelDocument(file, {
        onProgress: (percentComplete) => {
          setUploadProgress(percentComplete);
          console.log(`[uploadDocumentToChat] Signed upload progress: ${percentComplete}%`);
        },
      });

      const fileId = response.data?.file_id || response.file_id;
      if (!fileId) {
        throw new Error('No file_id returned from upload');
      }

      chatAttachmentFileIdsRef.current = [...new Set([...chatAttachmentFileIdsRef.current, fileId])];

      setUploadedFileId(fileId);
      setFileId(fileId);
      setUploadProgress(100);

      if (!skipFinalize) {
        setTimeout(() => {
          setIsChatUploading(false);
          setSuccess('Document uploaded successfully! You can now ask questions about it.');

          setShowSplitView(true);
          setHasResponse(true);

          setStreamingStatus('ready');
          setStreamingMessage('Document ready. You can now ask questions about it.');
        }, 500);

        fetchChatModelFiles();
      }

      return { file_id: fileId, ...response };
    } catch (error) {
      console.error('[uploadDocumentToChat] Error:', error);
      setError(getChatModelQuotaUserMessage(error) || `Upload failed: ${error.message}`);
      setIsChatUploading(false);
      throw error;
    }
  };
 
  const getStatusMessage = (status) => {
    const statusMessages = {
      initializing: 'Starting…',
      validating: 'Validating…',
      fetching: 'Loading context…',
      analyzing: 'Preparing…',
      generating: 'Model thinking',
      saving: 'Saving…',
    };
    return statusMessages[status] || 'Working…';
  };

  const getProcessingStepTitle = (status, message = '') => {
    if (status === 'initializing') return 'Starting the Request';
    if (status === 'validating') return 'Validating Access';
    if (status === 'fetching') {
      if (/secret prompt/i.test(message)) return 'Loading the Analysis Prompt';
      if (/professional profile/i.test(message)) return 'Loading Profile Context';
      if (/previous conversation/i.test(message)) return 'Loading Conversation Context';
      if (/gcp/i.test(message)) return 'Retrieving Prompt Instructions';
      return 'Gathering Context';
    }
    if (status === 'analyzing') return 'Analyzing the Document';
    if (status === 'generating') return 'Drafting the Answer';
    if (status === 'saving') return 'Saving the Conversation';
    return 'Processing';
  };

  const pushProcessingStep = (status, message = '') => {
    const stepId = `${status}:${message || ''}`;
    setProcessingTimeline((prev) => {
      const next = prev.map((step) => ({ ...step, state: 'done' }));
      const existingIndex = next.findIndex((step) => step.id === stepId);
      const newStep = {
        id: stepId,
        status,
        title: getProcessingStepTitle(status, message),
        description: message || getStatusMessage(status) || 'Working...',
        state: 'active',
      };
      if (existingIndex >= 0) {
        next[existingIndex] = newStep;
        return next;
      }
      return [...next, newStep];
    });
  };

  const startProcessingTimeline = (questionLabel, initialStatus, initialMessage) => {
    setPendingQuestion(questionLabel || null);
    setShowProcessingTimeline(true);
    setShowReasoning(true);
    setReasoningText('');
    setProcessingTimeline([]);
    if (initialStatus) {
      pushProcessingStep(initialStatus, initialMessage);
    }
  };

  const clearProcessingTimeline = () => {
    setProcessingTimeline([]);
    setPendingQuestion(null);
    setShowProcessingTimeline(true);
    setReasoningText('');
    setShowReasoning(true);
  };

  const normalizedReasoningText = useMemo(() => {
    if (!reasoningText) return '';

    return reasoningText
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/([^\n])(\*\*[^*\n]+?\*\*)/g, '$1\n\n$2')
      .trim();
  }, [reasoningText]);

  const fetchChatModelFiles = async () => {
    try {
      const response = await apiService.getChatModelFiles();
      if (response.success && response.data?.files) {
        setChatModelFiles(response.data.files);
      }
    } catch (error) {
      console.error('[fetchChatModelFiles] Error:', error);
    }
  };
 
  const fetchChatModelHistory = async (fileId, sessionId = null) => {
    try {
      console.log('[DB] fetchChatModelHistory called with params:', {
        fileId,
        sessionId,
        endpoint: `/api/chat/history/${fileId}${sessionId ? `?session_id=${sessionId}` : ''}`,
      });

      const response = await apiService.getChatModelHistory(fileId, sessionId);

      console.log('[DB] Raw response from getChatModelHistory:', {
        success: response.success,
        file_id: response.data?.file_id,
        filename: response.data?.filename,
        session_id: response.data?.session_id,
        message_count: response.data?.count,
        history_preview: response.data?.history?.slice(0, 2).map(h => ({
          id: h.id,
          session_id: h.session_id,
          question_preview: (h.question || '').substring(0, 80),
          used_secret_prompt: h.used_secret_prompt,
          created_at: h.created_at,
        })),
      });

      if (response.success && response.data?.history) {
        const idsFromApi =
          Array.isArray(response.data.file_ids) && response.data.file_ids.length
            ? response.data.file_ids
            : Array.isArray(response.data.attached_files) && response.data.attached_files.length
              ? response.data.attached_files.map((a) => a.file_id).filter(Boolean)
              : [fileId];
        chatAttachmentFileIdsRef.current = [...new Set(idsFromApi.filter(Boolean))];

        const primaryAttachment =
          Array.isArray(response.data.attached_files) && response.data.attached_files.length
            ? response.data.attached_files[0]
            : null;

        const history = response.data.history.map((item) => ({
          id: item.id,
          file_id: item.file_id || fileId,
          session_id: item.session_id || sessionId,
          question: item.question,
          answer: item.answer,
          display_text_left_panel: item.used_secret_prompt
            ? `Analysis: ${item.prompt_label || 'Secret Prompt'}`
            : item.question,
          timestamp: item.created_at,
          type: 'chat',
          used_secret_prompt: item.used_secret_prompt || false,
          prompt_label: item.prompt_label || null,
          secret_id: item.secret_id || null,
        }));

        console.log('[DB] Loaded chat history for continuation:', {
          total_messages: history.length,
          session_id_used: sessionId,
          file_id_used: fileId,
          filename_from_db: response.data.filename,
          file_ids_restored: chatAttachmentFileIdsRef.current,
          sessions_in_history: [...new Set(history.map(h => h.session_id))],
        });

        setChatModelHistory(history);
        setMessages(history);

        const primaryId = primaryAttachment?.file_id || fileId;
        if (primaryId) {
          setFileId(primaryId);
        }
        const dbFilename =
          primaryAttachment?.filename ||
          response.data.filename ||
          `Document (${String(fileId).substring(0, 8)}...)`;
        setDocumentData({
          id: primaryId,
          title: dbFilename,
          originalName: dbFilename,
          size: primaryAttachment?.size ?? 0,
          type: primaryAttachment?.mimetype || 'unknown',
          gcs_uri: primaryAttachment?.gcs_uri || null,
          uploadedAt: history.length > 0 ? history[0].timestamp : new Date().toISOString(),
          status: 'processed',
          processingProgress: 100,
        });

        if (history.length > 0) {
          const lastMessage = history[history.length - 1];
          setSelectedMessageId(lastMessage.id);
          const rawAnswer = lastMessage.answer || '';
          const isStructured = lastMessage.used_secret_prompt && isStructuredJsonResponse(rawAnswer);
          const responseToDisplay = isStructured
            ? renderSecretPromptResponse(rawAnswer)
            : convertJsonToPlainText(rawAnswer);
          setCurrentResponse(responseToDisplay);
          showResponseImmediately(responseToDisplay);
          setHasResponse(true);
          setShowSplitView(true);
        }
      }
    } catch (error) {
      console.error('[fetchChatModelHistory] Error:', error);
      setError(`Failed to fetch chat history: ${error.message}`);
    }
  };

  // General legal chat — no document required
  const fetchGeneralChatHistory = async (currentSessionId) => {
    try {
      console.log('[DB] fetchGeneralChatHistory called with params:', {
        session_id: currentSessionId,
        endpoint: `/api/chat/general/history/${currentSessionId}`,
      });

      const response = await apiService.getGeneralChatHistory(currentSessionId);

      console.log('[DB] Raw response from getGeneralChatHistory:', {
        success: response.success,
        session_id: response.data?.session_id,
        message_count: response.data?.count,
        is_general_chat: response.data?.is_general_chat,
      });

      if (response.success && response.data?.history) {
        const history = response.data.history.map((item) => ({
          id: item.id,
          file_id: null,
          session_id: item.session_id || currentSessionId,
          question: item.question,
          answer: item.answer,
          display_text_left_panel: item.question,
          timestamp: item.created_at,
          type: 'general_chat',
          used_secret_prompt: false,
          prompt_label: null,
          is_general_chat: true,
        }));

        console.log('[DB] Loaded general chat history for continuation:', {
          total_messages: history.length,
          session_id_used: currentSessionId,
        });

        setMessages(history);
        setSessionId(currentSessionId);
        setHasResponse(true);
        setShowSplitView(true);

        if (history.length > 0) {
          const lastMessage = history[history.length - 1];
          setSelectedMessageId(lastMessage.id);
          setCurrentResponse(lastMessage.answer || '');
          showResponseImmediately(lastMessage.answer || '');
        }
      }
    } catch (error) {
      console.error('[fetchGeneralChatHistory] Error:', error);
      setError(`Failed to fetch general chat history: ${error.message}`);
    }
  };

  const askGeneralQuestionToChat = async (question) => {
    try {
      setIsLoading(true);
      setIsGeneratingInsights(true);
      setError(null);
      setCurrentResponse('');
      streamBufferRef.current = '';
      setStreamingStatus('initializing');
      setStreamingMessage('Starting legal chat...');
      startProcessingTimeline(question.trim(), 'initializing', 'Starting legal chat...');

      const messageId = Date.now();
      setHasResponse(true);
      setShowSplitView(true);
      setChatInput('');

      console.log('[General Chat] Sending question with DB params:', {
        session_id: sessionId,
        question_preview: question.trim().substring(0, 80),
        is_continuing_session: !!sessionId,
      });

      let newSessionId = sessionId;

      const generalStreamOpts = {
        ...(chatModelStreamFetchParams || {}),
        ...(selectedLlmName ? { llm_name: selectedLlmName } : {}),
      };

      await apiService.askGeneralChatStream(
        question.trim(),
        sessionId,
        (text) => {
          if (typeof text === 'string') {
            streamBufferRef.current += text;
            setCurrentResponse(streamBufferRef.current);
            setAnimatedResponseContent(streamBufferRef.current);
            if (!streamingStatus || streamingStatus !== 'generating') {
              setStreamingStatus('generating');
              setStreamingMessage('Model thinking');
            }
          }
        },
        (status, message) => {
          setStreamingStatus(status);
          setStreamingMessage(
            status === 'generating' ? 'Model thinking' : message || getStatusMessage(status)
          );
          pushProcessingStep(status, message || getStatusMessage(status));
          console.log('[General Chat] Status:', status, message);
        },
        (metadata) => {
          console.log('[General Chat] Metadata from DB:', metadata);
          if (metadata.session_id) {
            newSessionId = metadata.session_id;
            setSessionId(metadata.session_id);
          }
        },
        (doneData) => {
          console.log('[General Chat] Stream complete. DB params used:', {
            chat_id: doneData.chat_id,
            session_id: doneData.session_id,
            is_general_chat: doneData.is_general_chat,
            answer_length: doneData.answer_length,
          });
          const fromDone = (doneData && typeof doneData.answer === 'string') ? doneData.answer : '';
          const fromBuf = streamBufferRef.current || '';
          const finalResponse = fromDone.length >= fromBuf.length ? (fromDone || fromBuf) : fromBuf;
          if (doneData.session_id) newSessionId = doneData.session_id;
          const resolvedSessionId = newSessionId || sessionId || null;

          setStreamingStatus(null);
          setStreamingMessage('');
          clearProcessingTimeline();
          const newChat = {
            id: messageId,
            file_id: null,
            session_id: resolvedSessionId,
            question: question.trim(),
            answer: finalResponse,
            display_text_left_panel: question.trim(),
            timestamp: new Date().toISOString(),
            type: 'general_chat',
            used_secret_prompt: false,
            is_general_chat: true,
          };
          setMessages((prev) => [...prev, newChat]);
          setSelectedMessageId(messageId);
          setPendingQuestion(null);
          if (resolvedSessionId) setSessionId(resolvedSessionId);
          setCurrentResponse(finalResponse);
          showResponseImmediately(finalResponse);
          setIsLoading(false);
          setIsGeneratingInsights(false);
          setSuccess('Legal question answered!');
        },
        (errorMessage, details, code) => {
          console.error('[General Chat] Stream error:', errorMessage, { code, details });
          const synthetic = new Error(errorMessage);
          synthetic.code = code;
          synthetic.details = details;
          const friendly = getChatModelQuotaUserMessage(synthetic);
          if (code) {
            refreshLimits().catch(() => {});
          }
          setError(friendly || errorMessage || 'Failed to get answer.');
          setIsLoading(false);
          setIsGeneratingInsights(false);
          setStreamingStatus(null);
          setStreamingMessage('');
          clearProcessingTimeline();
        },
        Object.keys(generalStreamOpts).length ? generalStreamOpts : null,
        (thoughtText) => {
          if (typeof thoughtText === 'string' && thoughtText) {
            setReasoningText((prev) => `${prev}${thoughtText}`);
          }
        }
      );
    } catch (error) {
      console.error('[General Chat] Error:', error);
      setError(getChatModelQuotaUserMessage(error) || error.message || 'Failed to get answer.');
      setIsLoading(false);
      setIsGeneratingInsights(false);
      setStreamingStatus(null);
      setStreamingMessage('');
      clearProcessingTimeline();
      throw error;
    }
  };

  const askQuestionToChat = async (question, fileId, fileIdsOverride = null) => {
    try {
      setIsLoading(true);
      setIsGeneratingInsights(true);
      setError(null);
      setCurrentResponse('');
      streamBufferRef.current = '';
      setStreamingStatus('initializing');
      setStreamingMessage('Starting chat request...');
      startProcessingTimeline(question.trim(), 'initializing', 'Starting chat request...');

      if (streamReaderRef.current) {
        try {
          await streamReaderRef.current.cancel();
        } catch (e) {
        }
        streamReaderRef.current = null;
      }

      if (streamUpdateTimeoutRef.current) {
        clearTimeout(streamUpdateTimeoutRef.current);
        streamUpdateTimeoutRef.current = null;
      }

      const sanitizeId = (id) =>
        id && typeof id === 'string' ? id.replace(/\{\{|\}\}/g, '').replace(/\{|\}/g, '').trim() : id;

      let ids =
        Array.isArray(fileIdsOverride) && fileIdsOverride.length > 0
          ? fileIdsOverride.map(sanitizeId).filter(Boolean)
          : [];

      let cleanFileId = sanitizeId(fileId);
      if (!ids.length && cleanFileId) {
        ids = [cleanFileId];
      }
      if (!ids.length) {
        throw new Error('No file_id available. Please upload a document first.');
      }
      cleanFileId = ids[0];

      let newSessionId = sessionId;
      let finalMetadata = null;
     
      const messageId = Date.now();
      const newChat = {
        id: messageId,
        file_id: cleanFileId,
        session_id: sessionId,
        question: question.trim(),
        answer: '',
        display_text_left_panel: question.trim(),
        timestamp: new Date().toISOString(),
        type: 'chat',
        used_secret_prompt: false,
        isStreaming: true,
      };
     
      setMessages((prev) => [...prev, newChat]);
      setSelectedMessageId(messageId);
      setHasResponse(true);
      setShowSplitView(true);
      setChatInput('');

      console.log('[DB] Sending chat request with DB params:', {
        file_id: cleanFileId,
        file_ids: ids.length > 1 ? ids : undefined,
        session_id: sessionId,
        question_preview: question.trim().substring(0, 100),
        is_continuing_session: !!sessionId,
        endpoint: `${CHAT_MODEL_BASE_URL}/api/chat/ask/stream`,
      });

      await apiService.askChatModelQuestionStream(
        question.trim(),
        cleanFileId,
        sessionId,
        (text) => {
          if (typeof text === 'string') {
            streamBufferRef.current += text;
            if (!streamingStatus || streamingStatus !== 'generating') {
              setStreamingStatus('generating');
              setStreamingMessage('Model thinking');
            }
          }
        },
        (status, message) => {
          setStreamingStatus(status);
          setStreamingMessage(
            status === 'generating' ? 'Model thinking' : message || getStatusMessage(status)
          );
          pushProcessingStep(status, message || getStatusMessage(status));
          console.log('[askQuestionToChat] Status:', status, message);
        },
        (metadata) => {
          console.log('[askQuestionToChat] Metadata:', metadata);
          if (metadata.session_id) {
            newSessionId = metadata.session_id;
            setMessages((prev) => {
              const updated = prev.map((msg) =>
                msg.id === messageId
                  ? { ...msg, session_id: metadata.session_id }
                  : msg
              );
              return updated;
            });
            setSessionId(metadata.session_id);
          }
        },
        (doneData) => {
          console.log('[askQuestionToChat] Stream complete:', doneData);
          finalMetadata = doneData;
          const fromDone = (doneData && typeof doneData.answer === 'string') ? doneData.answer : '';
          const fromBuf = streamBufferRef.current || '';
          const finalResponse = fromDone.length >= fromBuf.length ? (fromDone || fromBuf) : fromBuf;
         
          if (doneData.session_id) {
            newSessionId = doneData.session_id;
          }
          const resolvedSessionId = newSessionId || sessionId || null;
         
          setStreamingStatus(null);
          setStreamingMessage('');
         
          setMessages((prev) => {
            const updated = prev.map((msg) =>
              msg.id === messageId
                ? {
                    ...msg,
                    answer: finalResponse,
                    session_id: resolvedSessionId,
                    isStreaming: false,
                  }
                : msg
            );
            return updated;
          });
         
          setSelectedMessageId(messageId);
          if (resolvedSessionId) setSessionId(resolvedSessionId);
          setCurrentResponse(finalResponse);
          showResponseImmediately(finalResponse);
          setIsLoading(false);
          setIsGeneratingInsights(false);
          setSuccess('Question answered!');
         
          setStreamingStatus(null);
          setStreamingMessage('');
          clearProcessingTimeline();
         
          if (responseRef.current) {
            setTimeout(() => {
              responseRef.current.scrollTop = responseRef.current.scrollHeight;
            }, 100);
          }
        },
        (errorMessage, details, code) => {
          console.error('[askQuestionToChat] Stream error:', errorMessage, { code, details });
          const synthetic = new Error(errorMessage);
          synthetic.code = code;
          synthetic.details = details;
          if (code) {
            refreshLimits().catch(() => {});
          }
          setError(getChatModelQuotaUserMessage(synthetic) || errorMessage || 'Failed to get answer.');
          setIsLoading(false);
          setIsGeneratingInsights(false);
          setStreamingStatus(null);
          setStreamingMessage('');
          clearProcessingTimeline();
         
          setMessages((prev) => {
            return prev.filter((msg) => msg.id !== messageId);
          });
        },
        null,
        false,
        null,
        null,
        selectedLlmName,
        chatModelStreamFetchParams,
        ids.length > 1 ? ids : null,
        (thoughtText) => {
          if (typeof thoughtText === 'string' && thoughtText) {
            setReasoningText((prev) => `${prev}${thoughtText}`);
          }
        }
      );
     
      return finalMetadata;
    } catch (error) {
      console.error('[askQuestionToChat] Error:', error);
      setError(getChatModelQuotaUserMessage(error) || `Failed to get answer: ${error.message}`);
      setIsLoading(false);
      setIsGeneratingInsights(false);
      setStreamingStatus(null);
      setStreamingMessage('');
      clearProcessingTimeline();
      throw error;
    }
  };

  const fetchSecrets = async () => {
    try {
      setIsLoadingSecrets(true);
      setError(null);
      const token = getAuthToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const response = await fetch(`${String(SECRET_PROMPTS_API_BASE || CHAT_MODEL_BASE_URL).replace(/\/$/, '')}/secrets?fetch=false`, {
        method: 'GET',
        headers,
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch secrets: ${response.status}`);
      }
      const secretsData = await response.json();
      console.log('[fetchSecrets] Raw secrets data:', secretsData);
      const secretsList = secretsData || [];
      setSecrets(secretsList);
     
      if (selectedSecretId) {
        const secretExists = secretsList.find((s) => s.id === selectedSecretId);
        if (!secretExists) {
          console.warn('[fetchSecrets] Previously selected secret ID no longer exists:', selectedSecretId);
          console.warn('[fetchSecrets] Available secrets:', secretsList.map(s => ({ id: s.id, name: s.name })));
          setSelectedSecretId(null);
          setIsSecretPromptSelected(false);
          setActiveDropdown('Custom Query');
          setSelectedLlmName(null);
        }
      } else {
        setActiveDropdown('Custom Query');
        setSelectedSecretId(null);
        setSelectedLlmName(null);
        setIsSecretPromptSelected(false);
      }
    } catch (error) {
      console.error('Error fetching secrets:', error);
      setError(`Failed to load analysis prompts: ${error.message}`);
    } finally {
      setIsLoadingSecrets(false);
    }
  };


  const batchUploadDocuments = async (files, secretId = null, llmName = null) => {
    const isProduction = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
    const environment = isProduction ? 'PRODUCTION' : 'LOCALHOST';
   
    console.log(`[batchUploadDocuments] 🚀 Starting batch upload for ${files.length} files`);
    console.log(`[batchUploadDocuments] 🌍 Environment: ${environment}`);
    console.log(`[batchUploadDocuments] 🔗 API Base URL: ${API_BASE_URL}`);
   
    setIsUploading(true);
    setError(null);
    const LARGE_FILE_THRESHOLD = 32 * 1024 * 1024;
   
    const initialBatchUploads = files.map((file, index) => {
      const isLarge = file.size > LARGE_FILE_THRESHOLD;
      const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
      console.log(`[batchUploadDocuments] 📄 File ${index + 1}: ${file.name} (${fileSizeMB}MB) - ${isLarge ? '🔴 LARGE (will use signed URL)' : '🟢 Small (regular upload)'}`);
      return {
        id: `${file.name}-${Date.now()}-${index}`,
        file: file,
        fileName: file.name,
        fileSize: file.size,
        status: 'pending',
        fileId: null,
        error: null,
        isLargeFile: isLarge,
      };
    });
    setBatchUploads(initialBatchUploads);
    setShowSplitView(true);
   
    try {
      const token = getAuthToken();
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
     
      const largeFiles = files.filter(f => f.size > LARGE_FILE_THRESHOLD);
      const smallFiles = files.filter(f => f.size <= LARGE_FILE_THRESHOLD);
      const uploadedFileIds = [];
     
      console.log(`[batchUploadDocuments] 📊 Summary: ${largeFiles.length} large file(s) (signed URL), ${smallFiles.length} small file(s) (regular upload)`);
     
      for (let i = 0; i < largeFiles.length; i++) {
        const file = largeFiles[i];
        const matchingUpload = initialBatchUploads.find(u => u.file === file);
        const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
       
        try {
          console.log(`\n[📤 SIGNED URL UPLOAD] Starting upload for: ${file.name} (${fileSizeMB}MB)`);
          console.log(`[📤 SIGNED URL UPLOAD] Environment: ${environment}`);
         
          setBatchUploads((prev) =>
            prev.map((upload) =>
              upload.id === matchingUpload.id
                ? { ...upload, status: 'uploading' }
                : upload
            )
          );
         
          const generateUrlEndpoint = `${API_BASE_URL}/files/generate-upload-url`;
          console.log(`[📤 SIGNED URL UPLOAD] Step 1/3: Requesting signed URL from: ${generateUrlEndpoint}`);
         
          const urlResponse = await fetch(generateUrlEndpoint, {
            method: 'POST',
            headers: {
              ...headers,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              filename: file.name,
              mimetype: file.type,
              size: file.size,
            }),
          });
         
          if (!urlResponse.ok) {
            const errorData = await urlResponse.json().catch(() => ({}));
            const errorMessage = errorData.error || errorData.message || `Failed to get upload URL: ${urlResponse.statusText}`;
           
            const isSubscriptionError = urlResponse.status === 500 ||
              errorMessage.toLowerCase().includes('subscription') ||
              errorMessage.toLowerCase().includes('insufficient') ||
              errorMessage.toLowerCase().includes('no plan') ||
              errorMessage.toLowerCase().includes('plan required');
           
            const error = new Error(errorMessage);
            if (isSubscriptionError) {
              error.isSubscriptionError = true;
            }
            throw error;
          }
         
          const urlData = await urlResponse.json();
          const { signedUrl, gcsPath, filename } = urlData;
         
          console.log(`[📤 SIGNED URL UPLOAD] ✅ Signed URL received`);
          console.log(`[📤 SIGNED URL UPLOAD] GCS Path: ${gcsPath}`);
          console.log(`[📤 SIGNED URL UPLOAD] Signed URL (first 100 chars): ${signedUrl.substring(0, 100)}...`);
         
         
          console.log(`[📤 SIGNED URL UPLOAD] Step 2/3: Uploading file directly to GCS (PUT request)`);
         
          await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
           
           
            xhr.addEventListener('load', () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                console.log(`[📤 SIGNED URL UPLOAD] ✅ File uploaded to GCS successfully`);
                resolve();
              } else {
                reject(new Error(`Failed to upload file to GCS: ${xhr.statusText}`));
              }
            });
           
            xhr.addEventListener('error', () => {
              reject(new Error('Network error during upload'));
            });
           
            xhr.addEventListener('abort', () => {
              reject(new Error('Upload aborted'));
            });
           
            xhr.open('PUT', signedUrl);
            xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
            xhr.send(file);
          });
         
          const completeEndpoint = `${API_BASE_URL}/files/complete-upload`;
          console.log(`[📤 SIGNED URL UPLOAD] Step 3/3: Notifying backend to process file: ${completeEndpoint}`);
         
          const completeResponse = await fetch(completeEndpoint, {
            method: 'POST',
            headers: {
              ...headers,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              gcsPath,
              filename,
              mimetype: file.type,
              size: file.size,
              secret_id: secretId,
            }),
          });
         
          if (!completeResponse.ok) {
            const errorData = await completeResponse.json();
            const errorMessage = errorData.error || errorData.message || `Failed to complete upload: ${completeResponse.statusText}`;
           
            const isSubscriptionError = completeResponse.status === 500 ||
              errorMessage.toLowerCase().includes('subscription') ||
              errorMessage.toLowerCase().includes('insufficient') ||
              errorMessage.toLowerCase().includes('no plan') ||
              errorMessage.toLowerCase().includes('plan required');
           
            const error = new Error(errorMessage);
            if (isSubscriptionError) {
              error.isSubscriptionError = true;
            }
            throw error;
          }
         
          const completeData = await completeResponse.json();
          const fileId = completeData.file_id;
         
          console.log(`[📤 SIGNED URL UPLOAD] ✅ Upload completed successfully! File ID: ${fileId}`);
          console.log(`[📤 SIGNED URL UPLOAD] 🎉 File ${file.name} is now being processed`);
         
          setBatchUploads((prev) =>
            prev.map((upload) =>
              upload.id === matchingUpload.id
                ? { ...upload, status: 'batch_processing', fileId, progress: 100, processingProgress: 0 }
                : upload
            )
          );
         
          setUploadedDocuments((prev) => [
            ...prev,
            {
              id: fileId,
              fileName: filename || matchingUpload.fileName,
              fileSize: matchingUpload.fileSize,
              uploadedAt: new Date().toISOString(),
            },
          ]);
         
          uploadedFileIds.push(fileId);
         
          if (i === 0 && largeFiles.length > 0) {
            setFileId(fileId);
                setDocumentData({
                  id: fileId,
                  title: matchingUpload.fileName,
                  originalName: matchingUpload.fileName,
                  size: matchingUpload.fileSize,
                  type: matchingUpload.file.type,
                  uploadedAt: new Date().toISOString(),
                });
          }
        } catch (error) {
          console.error(`[📤 SIGNED URL UPLOAD] ❌ Upload failed for ${matchingUpload.fileName}:`, error);
          console.error(`[📤 SIGNED URL UPLOAD] Error details:`, error.message);
          setBatchUploads((prev) =>
            prev.map((upload) =>
              upload.id === matchingUpload.id
                ? { ...upload, status: 'failed', error: error.message, progress: 0 }
                : upload
            )
          );
        }
      }
     
      if (smallFiles.length > 0) {
        console.log(`\n[📦 REGULAR UPLOAD] Starting batch upload for ${smallFiles.length} small file(s)`);
        console.log(`[📦 REGULAR UPLOAD] Environment: ${environment}`);
        console.log(`[📦 REGULAR UPLOAD] Endpoint: ${API_BASE_URL}/files/batch-upload`);
       
        const formData = new FormData();
        smallFiles.forEach((file) => {
          formData.append('document', file);
        });
        if (secretId) {
          formData.append('secret_id', secretId);
          formData.append('trigger_initial_analysis_with_secret', 'true');
        }
        if (llmName) {
          formData.append('llm_name', llmName);
        }
       
        setBatchUploads((prev) =>
          prev.map((upload) => {
            const isSmallFile = smallFiles.includes(upload.file);
            return isSmallFile ? { ...upload, status: 'uploading' } : upload;
          })
        );
       
        const data = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
         
         
          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const responseData = JSON.parse(xhr.responseText);
                resolve(responseData);
              } catch (error) {
                reject(new Error('Failed to parse response'));
              }
            } else {
              try {
                const errorData = JSON.parse(xhr.responseText);
                const errorMessage = errorData.error || errorData.message || '';
                const isSubscriptionError = xhr.status === 500 ||
                  errorMessage.toLowerCase().includes('subscription') ||
                  errorMessage.toLowerCase().includes('insufficient') ||
                  errorMessage.toLowerCase().includes('no plan') ||
                  errorMessage.toLowerCase().includes('plan required');
               
                if (isSubscriptionError) {
                  const error = new Error(errorMessage || 'Subscription required');
                  error.isSubscriptionError = true;
                  reject(error);
                } else {
                  reject(new Error(errorMessage || `Upload failed with status ${xhr.status}`));
                }
              } catch {
                if (xhr.status === 500) {
                  const error = new Error('Subscription required to upload files');
                  error.isSubscriptionError = true;
                  reject(error);
                } else {
                  reject(new Error(`Upload failed with status ${xhr.status}`));
                }
              }
            }
          });
         
          xhr.addEventListener('error', () => {
            reject(new Error('Network error during upload'));
          });
         
          xhr.addEventListener('abort', () => {
            reject(new Error('Upload aborted'));
          });
         
          xhr.open('POST', `${API_BASE_URL}/files/batch-upload`);
          Object.keys(headers).forEach((key) => {
            xhr.setRequestHeader(key, headers[key]);
          });
          xhr.send(formData);
        });
        console.log('[batchUploadDocuments] Batch upload response:', data);
       
        if (data.uploaded_files && Array.isArray(data.uploaded_files)) {
          data.uploaded_files.forEach((uploadedFile, index) => {
            const matchingUpload = initialBatchUploads.find(u => smallFiles.includes(u.file) &&
              initialBatchUploads.filter(up => smallFiles.includes(up.file)).indexOf(u) === index);
           
            if (!matchingUpload) return;
           
            if (uploadedFile.error) {
              console.error(`[batchUploadDocuments] Upload failed for ${matchingUpload.fileName}:`, uploadedFile.error);
              setBatchUploads((prev) =>
                prev.map((upload) =>
                  upload.id === matchingUpload.id
                    ? { ...upload, status: 'failed', error: uploadedFile.error }
                    : upload
                )
              );
            } else {
              const fileId = uploadedFile.file_id;
              console.log(`[batchUploadDocuments] Successfully uploaded ${matchingUpload.fileName} with ID: ${fileId}`);
              setBatchUploads((prev) =>
                prev.map((upload) =>
                  upload.id === matchingUpload.id
                    ? { ...upload, status: 'completed', fileId }
                    : upload
                )
              );
              setUploadedDocuments((prev) => [
                ...prev,
                {
                  id: fileId,
                  fileName: uploadedFile.filename || matchingUpload.fileName,
                  fileSize: matchingUpload.fileSize,
                  uploadedAt: new Date().toISOString(),
                },
              ]);
              uploadedFileIds.push(fileId);
             
              if (uploadedFileIds.length === largeFiles.length + 1) {
                setFileId(fileId);
                setDocumentData({
                  id: fileId,
                  title: matchingUpload.fileName,
                  originalName: matchingUpload.fileName,
                  size: matchingUpload.fileSize,
                  type: matchingUpload.file.type,
                  uploadedAt: new Date().toISOString(),
                });
              }
            }
          });
        }
      }
     
     
      const successCount = uploadedFileIds.length;
      const failCount = initialBatchUploads.length - successCount;
     
      if (successCount > 0) {
        setSuccess(`${successCount} document(s) uploaded successfully!`);
      }
      if (failCount > 0) {
        setError(`${failCount} document(s) failed to upload.`);
      }
    } catch (error) {
      console.error('[batchUploadDocuments] Batch upload error:', error);
     
      if (error.isSubscriptionError) {
        setShowInsufficientFundsAlert(true);
        setBatchUploads((prev) =>
          prev.map((upload) => ({ ...upload, status: 'failed', error: 'Subscription required' }))
        );
      } else {
        setError(`Batch upload failed: ${error.message}`);
        setBatchUploads((prev) =>
          prev.map((upload) => ({ ...upload, status: 'failed', error: error.message }))
        );
      }
    } finally {
      setIsUploading(false);
    }
  };

  const animateResponse = (text = '', isAlreadyFormatted = false) => {
    console.log('[animateResponse] Starting ChatGPT-style word-by-word animation. Length:', text.length);

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      clearTimeout(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const plainText = isAlreadyFormatted ? text : convertJsonToPlainText(text);

    if (!plainText || typeof plainText !== 'string') {
      setIsAnimatingResponse(false);
      setAnimatedResponseContent(plainText || '');
      return;
    }

    setAnimatedResponseContent('');
    setIsAnimatingResponse(true);
    setShowSplitView(true);

    const words = plainText.split(/(\s+)/);
    let currentIndex = 0;
    let displayedText = '';

    if (words.length <= 3) {
        setIsAnimatingResponse(false);
      setAnimatedResponseContent(plainText);
        return;
      }

    const animateWord = () => {
      if (currentIndex < words.length) {
        displayedText += words[currentIndex];
        setAnimatedResponseContent(displayedText);
        currentIndex++;

        if (responseRef.current) {
          responseRef.current.scrollTop = responseRef.current.scrollHeight;
        }

        const word = words[currentIndex - 1];
        let delay = 15;
       
        if (word.trim().length === 0) {
          delay = 3;
        } else if (word.length > 15) {
          delay = 25;
        } else if (word.length > 10) {
          delay = 20;
        } else if (/[.!?]\s*$/.test(word)) {
          delay = 40;
        } else if (/[,;:]\s*$/.test(word)) {
          delay = 20;
        } else if (/^[#*`\-]/.test(word)) {
          delay = 8;
        }

        animationFrameRef.current = setTimeout(animateWord, delay);
      } else {
        setIsAnimatingResponse(false);
        setAnimatedResponseContent(plainText);
        animationFrameRef.current = null;
      }
    };

    animationFrameRef.current = setTimeout(animateWord, 20);
  };

  const showResponseImmediately = (text = '') => {
    const plainText = convertJsonToPlainText(text);
   
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      clearTimeout(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    console.log('[showResponseImmediately] Displaying text immediately. Length:', plainText.length);
    setAnimatedResponseContent(plainText);
    setIsAnimatingResponse(false);
    setShowSplitView(true);
    requestAnimationFrame(() => {
      if (responseRef.current) {
        responseRef.current.scrollTop = responseRef.current.scrollHeight;
      }
    });
  };

  const stopResponseAnimation = () => {
    if (!isAnimatingResponse) return;
    const fullText = currentResponse || animatedResponseContent || '';
    showResponseImmediately(fullText);
  };

  const selectedMessage = useMemo(
    () => sessionMessages.find((msg) => msg.id === selectedMessageId) || null,
    [sessionMessages, selectedMessageId]
  );

  const suggestedQuestions = useMemo(
    () =>
      buildSuggestedQuestions({
        question: selectedMessage?.question || selectedMessage?.display_text_left_panel || '',
        response: currentResponse || animatedResponseContent || selectedMessage?.answer || '',
        promptLabel: selectedMessage?.prompt_label || '',
      }),
    [selectedMessage, currentResponse, animatedResponseContent]
  );

  const handleSuggestedQuestionClick = (suggestion) => {
    setChatInput(suggestion);
  };

  const baseSendDisabled =
    isLoading ||
    isGeneratingInsights ||
    (!chatInput.trim() && !isSecretPromptSelected);

  const sendButtonType = isAnimatingResponse ? 'button' : 'submit';
  const isSendButtonDisabled = isAnimatingResponse ? false : baseSendDisabled;
  const sendButtonTitle = isAnimatingResponse ? 'Stop rendering' : 'Send Message';

  const handleSendButtonClick = (event) => {
    if (isAnimatingResponse) {
      event.preventDefault();
      stopResponseAnimation();
    }
  };

  const getSendButtonClassName = (size = 'default') => {
    const paddingClass = size === 'small' ? 'p-1.5' : 'p-1.5 sm:p-2';
    const colorClass = isAnimatingResponse
      ? 'bg-gray-500 hover:bg-gray-600'
      : 'bg-[#21C1B6] hover:bg-[#1AA49B] disabled:bg-gray-300';
    return `${paddingClass} text-white rounded-lg transition-colors flex-shrink-0 disabled:cursor-not-allowed ${colorClass}`;
  };

  const renderSendButtonIcon = (size = 'default') => {
    const baseClass = size === 'small' ? 'h-3 w-3' : 'h-4 w-4 sm:h-5 sm:w-5';
    if (isAnimatingResponse) {
      return <Square className={baseClass} />;
    }
    if (isLoading || isGeneratingInsights) {
      return <Loader2 className={`${baseClass} animate-spin`} />;
    }
    return <Send className={baseClass} />;
  };

  const chatWithDocument = async (file_id, question, currentSessionId, llm_name = null) => {
    setCurrentResponse('');
    streamBufferRef.current = '';
    setError(null);
    setIsLoading(true);
    setIsAnimatingResponse(false);
   
    if (streamReaderRef.current) {
      try {
        await streamReaderRef.current.cancel();
      } catch (e) {
      }
      streamReaderRef.current = null;
    }
   
    if (streamUpdateTimeoutRef.current) {
      clearTimeout(streamUpdateTimeoutRef.current);
      streamUpdateTimeoutRef.current = null;
    }

    try {
      console.log('[chatWithDocument] Sending custom query with streaming. LLM:', llm_name || 'default (backend)');
      const token = getAuthToken();
      const body = {
        file_id: file_id,
        question: question.trim(),
        used_secret_prompt: false,
        prompt_label: null,
        session_id: currentSessionId,
      };
      if (llm_name) {
        body.llm_name = llm_name;
      }
      if (chatModelStreamFetchParams?.max_output_tokens != null) {
        body.max_output_tokens = chatModelStreamFetchParams.max_output_tokens;
      }
      if (chatModelStreamFetchParams?.model_temperature != null) {
        body.model_temperature = chatModelStreamFetchParams.model_temperature;
      }

      const response = await fetch(`${CHAT_MODEL_BASE_URL}/api/chat/ask/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      streamReaderRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = '';
      let newSessionId = currentSessionId;
      let finalMetadata = null;

      while (true) {
        const { done, value } = await reader.read();
       
          if (done) {
            setIsLoading(false);
            const fromDone = (finalMetadata && typeof finalMetadata.answer === 'string') ? finalMetadata.answer : '';
            const fromBuf = streamBufferRef.current || '';
            const finalResponse = fromDone.length >= fromBuf.length ? (fromDone || fromBuf) : fromBuf;
            if (finalMetadata) {
              newSessionId = finalMetadata.session_id || newSessionId;
            }
         
          const newChat = {
            id: Date.now(),
            file_id: file_id,
            session_id: newSessionId,
            question: question.trim(),
            answer: finalResponse,
            display_text_left_panel: question.trim(),
            timestamp: new Date().toISOString(),
            used_chunk_ids: finalMetadata?.used_chunk_ids || [],
            confidence: finalMetadata?.confidence || 0.8,
            type: 'chat',
            used_secret_prompt: false,
          };
          setMessages((prev) => [...prev, newChat]);
          setSelectedMessageId(newChat.id);
          setSessionId(newSessionId);
          setChatInput('');
          setCurrentResponse(finalResponse);
          setHasResponse(true);
          setSuccess('Question answered!');
          showResponseImmediately(finalResponse);
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r\n|\n|\r/);
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;
         
          const data = line.replace(/^data: /, '').trim();
         
          if (data === '[PING]') {
            continue;
          }
         
          if (data === '[DONE]') {
            setIsLoading(false);
            const fromDoneDone = (finalMetadata && typeof finalMetadata.answer === 'string') ? finalMetadata.answer : '';
            const fromBufDone = streamBufferRef.current || '';
            const finalResponse = fromDoneDone.length >= fromBufDone.length ? (fromDoneDone || fromBufDone) : fromBufDone;
            if (finalMetadata) {
              newSessionId = finalMetadata.session_id || newSessionId;
            }
           
            const newChat = {
              id: Date.now(),
              file_id: file_id,
              session_id: newSessionId,
              question: question.trim(),
              answer: finalResponse,
              display_text_left_panel: question.trim(),
              timestamp: new Date().toISOString(),
              used_chunk_ids: finalMetadata?.used_chunk_ids || [],
              confidence: finalMetadata?.confidence || 0.8,
              type: 'chat',
              used_secret_prompt: false,
            };
            setMessages((prev) => [...prev, newChat]);
            setSelectedMessageId(newChat.id);
            setSessionId(newSessionId);
            setChatInput('');
            setCurrentResponse(finalResponse);
            setHasResponse(true);
            setSuccess('Question answered!');
            showResponseImmediately(finalResponse);
            return;
          }

          try {
            const parsed = JSON.parse(data);
           
            if (parsed.type === 'metadata') {
              console.log('Stream metadata:', parsed);
              newSessionId = parsed.session_id || newSessionId;
            } else if (parsed.type === 'chunk') {
              streamBufferRef.current += parsed.text || '';
              const liveResponse = streamBufferRef.current;
              setCurrentResponse(liveResponse);
              setAnimatedResponseContent(liveResponse);
              setHasResponse(true);
            } else if (parsed.type === 'done') {
              finalMetadata = parsed;
              const fd = typeof parsed.answer === 'string' ? parsed.answer : '';
              const fb = streamBufferRef.current || '';
              const finalResponse = fd.length >= fb.length ? (fd || fb) : fb;
              setCurrentResponse(finalResponse);
              setIsLoading(false);
              showResponseImmediately(finalResponse);
            } else if (parsed.type === 'error') {
              setError(parsed.error);
              setIsLoading(false);
            }
          } catch (e) {
            console.warn('[chatWithDocument] Failed to parse SSE line:', e, data);
          }
        }
      }
    } catch (error) {
      console.error('[chatWithDocument] Streaming error:', error);
      if (error.message && error.message.includes('No content found')) {
        setError('Document is still processing. Please wait a few moments and try again.');
      } else {
        setError(`Chat failed: ${error.message}`);
      }
      setIsLoading(false);
      throw error;
    } finally {
      setIsLoading(false);
      streamReaderRef.current = null;
    }
  };

  const handleFileUpload = async (event) => {
    const files = Array.from(event.target.files);
    console.log('Files selected:', files.length);
    if (files.length === 0) return;

    if (limitsLoading) {
      setError('Loading upload limits from server… Please try again in a moment.');
      event.target.value = '';
      return;
    }
    if (limitsError || maxUploadBytes == null) {
      setError('Could not load upload limits (llm_chat_config). Please refresh the page.');
      event.target.value = '';
      return;
    }

    const maxSize = maxUploadBytes;

    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'image/png',
      'image/jpeg',
      'image/tiff',
    ];
    
    let hasFileSizeError = false;
    const validFiles = files.filter((file) => {
      if (!allowedTypes.includes(file.type)) {
        setError(`File "${file.name}" has an unsupported type.`);
        return false;
      }
      
      if (file.size > maxSize) {
        const fileSizeFormatted = formatFileSize(file.size);
        console.log('File size limit exceeded:', { fileName: file.name, fileSize: fileSizeFormatted, maxSizeMB: maxUploadMbLabel });
        hasFileSizeError = true;
        setFileSizeLimitError({
          message: formatUploadLimitExceededMessage({
            fileName: file.name,
            fileSizeFormatted,
            limitMbLabel: maxUploadMbLabel,
          }),
        });
        return false;
      }
      
      return true;
    });
   
    if (validFiles.length > 0) {
      setFileSizeLimitError(null);
    }
   
    if (validFiles.length === 0) {
      if (!hasFileSizeError) {
        event.target.value = '';
      } else {
        setTimeout(() => {
          if (event.target) {
            event.target.value = '';
          }
        }, 100);
      }
      return;
    }

    if (validFiles.length > 0) {
      const maxFilesFromLimits =
        limits?.max_upload_files != null ? Math.max(1, Number(limits.max_upload_files)) : 8;
      let toUpload = validFiles;
      if (validFiles.length > maxFilesFromLimits) {
        setError(
          `Only the first ${maxFilesFromLimits} file(s) are uploaded (maximum ${maxFilesFromLimits} per selection).`
        );
        toUpload = validFiles.slice(0, maxFilesFromLimits);
      }

      try {
        if (toUpload.length === 1) {
          const fileToUpload = toUpload[0];
          setDocumentData({
            name: fileToUpload.name,
            originalName: fileToUpload.name,
            size: fileToUpload.size,
            type: fileToUpload.type,
            uploadedAt: new Date().toISOString(),
          });
          const result = await uploadDocumentToChat(fileToUpload);
          console.log('[handleFileUpload] Document uploaded successfully:', result);
        } else {
          setDocumentData({
            name: `${toUpload.length} documents`,
            originalName: toUpload.map((f) => f.name).join(', '),
            size: toUpload.reduce((s, f) => s + f.size, 0),
            type: 'multi',
            uploadedAt: new Date().toISOString(),
          });
          for (const f of toUpload) {
            await uploadDocumentToChat(f, { skipFinalize: true });
          }
          setIsChatUploading(false);
          setUploadProgress(100);
          setSuccess(
            `${toUpload.length} documents uploaded successfully. You can ask questions about all of them.`
          );
          setShowSplitView(true);
          setHasResponse(true);
          setStreamingStatus('ready');
          setStreamingMessage('Documents ready. You can now ask questions.');
          fetchChatModelFiles();
          console.log('[handleFileUpload] Multi-document upload finished');
        }
      } catch (error) {
        console.error('[handleFileUpload] Upload error:', error);
        setError(`Failed to upload document: ${error.message}`);
        setDocumentData(null);
        setIsChatUploading(false);
      }
    }
   
    event.target.value = '';
  };

  // Handle Google Drive file upload for ChatModel
  const handleGoogleDriveUpload = async (files) => {
    console.log('[handleGoogleDriveUpload] Files selected from Google Drive:', files);
    
    if (!files || files.length === 0) {
      console.log('[handleGoogleDriveUpload] No files received');
      return;
    }

    // For ChatModel, we'll process the first file (single file upload workflow)
    const file = files[0];
    
    try {
      setIsChatUploading(true);
      setUploadProgress(0);
      setError(null);

      // Get access token
      let tokenData;
      try {
        tokenData = await googleDriveApi.getAccessToken();
      } catch (error) {
        if (error.response?.data?.needsAuth) {
          setError('Google Drive authorization expired. Please reconnect your Google Drive.');
          setIsChatUploading(false);
          return;
        }
        throw error;
      }

      const accessToken = tokenData.accessToken;
      const fileId = file.id || file.fileId;

      if (!fileId) {
        setError('File ID is missing from selected file');
        setIsChatUploading(false);
        return;
      }

      console.log('[handleGoogleDriveUpload] Uploading file to ChatModel:', fileId);

      setUploadProgress(20);

      // Call ChatModel Google Drive upload endpoint
      const token = getAuthToken();
      const headers = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      setUploadProgress(40);

      const response = await fetch(`${CHAT_MODEL_BASE_URL}/api/chat/google-drive/upload`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          fileId,
          accessToken,
        }),
      });

      setUploadProgress(70);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.message || errorData.error || `Upload failed with status ${response.status}`;
        
        if (errorData.needsAuth) {
          setError('Google Drive authorization expired. Please reconnect your Google Drive.');
        } else {
          setError(`Failed to upload from Google Drive: ${errorMessage}`);
        }
        setIsChatUploading(false);
        return;
      }

      const result = await response.json();
      console.log('[handleGoogleDriveUpload] Upload response:', result);

      setUploadProgress(90);

      const uploadedFileId = result.data?.file_id || result.file_id;

      if (!uploadedFileId) {
        setError('No file_id returned from upload');
        setIsChatUploading(false);
        return;
      }

      console.log('[handleGoogleDriveUpload] Extracted file_id:', uploadedFileId);

      chatAttachmentFileIdsRef.current = [...new Set([...chatAttachmentFileIdsRef.current, uploadedFileId])];

      setUploadedFileId(uploadedFileId);
      setFileId(uploadedFileId);
      setUploadProgress(100);

      // Set document data
      setDocumentData({
        name: result.data?.filename || file.name,
        originalName: result.data?.filename || file.name,
        size: result.data?.size || file.sizeBytes || 0,
        type: result.data?.mimetype || file.mimeType,
        uploadedAt: new Date().toISOString(),
      });

      setTimeout(() => {
        setIsChatUploading(false);
        setSuccess('Document uploaded from Google Drive successfully! You can now ask questions about it.');
        
        setShowSplitView(true);
        setHasResponse(true);
        
        setStreamingStatus('ready');
        setStreamingMessage('Document ready. You can now ask questions about it.');

        fetchChatModelFiles();
      }, 500);

    } catch (error) {
      console.error('[handleGoogleDriveUpload] Error:', error);
      setError(`Failed to upload from Google Drive: ${error.message}`);
      setIsChatUploading(false);
    }
  };

  const handleDropdownSelect = (secretName, secretId, llmName) => {
    console.log('[handleDropdownSelect] Selected:', secretName, secretId, 'LLM:', llmName);
   
    const secret = secrets.find((s) => s.id === secretId);
    if (!secret) {
      console.error('[handleDropdownSelect] Secret ID not found in secrets list:', secretId);
      console.error('[handleDropdownSelect] Available secrets:', secrets.map(s => ({ id: s.id, name: s.name })));
      setError(`Selected analysis prompt "${secretName}" is no longer available. Please refresh the page.`);
      setActiveDropdown('Custom Query');
      setSelectedSecretId(null);
      setSelectedLlmName(null);
      setIsSecretPromptSelected(false);
      setShowDropdown(false);
      return;
    }
   
    setActiveDropdown(secretName);
    setSelectedSecretId(secretId);
    setSelectedLlmName(llmName);
    setIsSecretPromptSelected(true);
    setChatInput('');
    setShowDropdown(false);
   
    console.log('[handleDropdownSelect] Looking for messages with secret_id:', secretId, 'file_id:', fileId);
    console.log('[handleDropdownSelect] Total messages (session):', sessionMessages.length);
    console.log('[handleDropdownSelect] Messages with secret prompts:', sessionMessages.filter(m => m.used_secret_prompt).map(m => ({
      id: m.id,
      secret_id: m.secret_id,
      prompt_label: m.prompt_label,
      file_id: m.file_id
    })));
   
    const messagesForThisPrompt = sessionMessages.filter(
      (msg) => {
        const matches = msg.used_secret_prompt &&
                       msg.secret_id === secretId &&
                       (msg.file_id === fileId || !fileId || !msg.file_id);
        if (matches) {
          console.log('[handleDropdownSelect] Found matching message:', {
            id: msg.id,
            secret_id: msg.secret_id,
            prompt_label: msg.prompt_label,
            file_id: msg.file_id
          });
        }
        return matches;
      }
    );
   
    console.log('[handleDropdownSelect] Found', messagesForThisPrompt.length, 'messages for this secret prompt');
   
    const messageForThisPrompt = messagesForThisPrompt.length > 0
      ? messagesForThisPrompt.sort((a, b) => {
          const timeA = new Date(a.timestamp || a.created_at || 0).getTime();
          const timeB = new Date(b.timestamp || b.created_at || 0).getTime();
          return timeB - timeA;
        })[0]
      : null;
   
    if (messageForThisPrompt) {
      console.log('[handleDropdownSelect] Displaying message:', {
        id: messageForThisPrompt.id,
        secret_id: messageForThisPrompt.secret_id,
        prompt_label: messageForThisPrompt.prompt_label,
        answer_length: (messageForThisPrompt.answer || '').length
      });
      setSelectedMessageId(messageForThisPrompt.id);
      const rawAnswer = messageForThisPrompt.answer || messageForThisPrompt.response || '';
      const isStructured = messageForThisPrompt.used_secret_prompt && isStructuredJsonResponse(rawAnswer);
      const responseToDisplay = isStructured
        ? renderSecretPromptResponse(rawAnswer)
        : convertJsonToPlainText(rawAnswer);
      setCurrentResponse(responseToDisplay);
      setAnimatedResponseContent(responseToDisplay);
      setHasResponse(true);
    } else {
      console.log('[handleDropdownSelect] No message found for this secret prompt, clearing response');
      setCurrentResponse('');
      setAnimatedResponseContent('');
      setSelectedMessageId(null);
      streamBufferRef.current = '';
      setIsAnimatingResponse(false);
      setHasResponse(false);
    }
  };

  const handleChatInputChange = (e) => {
    setChatInput(e.target.value);
    if (e.target.value && isSecretPromptSelected) {
      setIsSecretPromptSelected(false);
      setActiveDropdown('Custom Query');
      setSelectedSecretId(null);
      setSelectedLlmName(null);
    }
    if (!e.target.value && !isSecretPromptSelected) {
      setActiveDropdown('Custom Query');
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();

    const hasFile = Boolean(fileId);

    if (isSecretPromptSelected) {
      if (!hasFile) {
        setError('Please upload a document before running an analysis prompt.');
        return;
      }
      if (!selectedSecretId) {
        setError('Please select an analysis type.');
        return;
      }
     
      const selectedSecret = secrets.find((s) => s.id === selectedSecretId);
      if (!selectedSecret) {
        console.error('[handleSend] Selected secret ID not found in secrets list:', selectedSecretId);
        console.error('[handleSend] Available secrets:', secrets.map(s => ({ id: s.id, name: s.name })));
        setError(`Selected analysis prompt is no longer available. Please select a different one.`);
        setSelectedSecretId(null);
        setIsSecretPromptSelected(false);
        setActiveDropdown('Custom Query');
        return;
      }
     
      const promptLabel = selectedSecret.name || 'Secret Prompt';
      const secretAttachmentIds =
        chatAttachmentFileIdsRef.current.length > 0
          ? chatAttachmentFileIdsRef.current
          : fileId
            ? [fileId]
            : [];
      try {
        setIsGeneratingInsights(true);
        setError(null);
        console.log('[handleSend] Triggering secret analysis with streaming:', {
          secretId: selectedSecretId,
          fileId: secretAttachmentIds[0],
          file_ids: secretAttachmentIds.length > 1 ? secretAttachmentIds : undefined,
          additionalInput: chatInput.trim(),
          promptLabel: promptLabel,
          llmName: selectedLlmName,
        });
       
        setCurrentResponse('');
        streamBufferRef.current = '';
        setStreamingStatus('initializing');
        setStreamingMessage('Starting chat request...');
        startProcessingTimeline(`Analysis: ${promptLabel}`, 'initializing', 'Starting chat request...');
       
        if (streamReaderRef.current) {
          try {
            await streamReaderRef.current.cancel();
          } catch (e) {
          }
          streamReaderRef.current = null;
        }
       
        if (streamUpdateTimeoutRef.current) {
          clearTimeout(streamUpdateTimeoutRef.current);
          streamUpdateTimeoutRef.current = null;
        }

        streamBufferRef.current = '';
        let newSessionId = sessionId;
        let finalMetadata = null;
        const messageId = Date.now();

        const newChat = {
          id: messageId,
          file_id: secretAttachmentIds[0] || fileId,
          session_id: sessionId,
          question: promptLabel,
          answer: '',
          display_text_left_panel: `Analysis: ${promptLabel}`,
          timestamp: new Date().toISOString(),
          type: 'chat',
          used_secret_prompt: true,
          prompt_label: promptLabel,
          secret_id: selectedSecretId,
          isStreaming: true,
        };
        setMessages((prev) => [...prev, newChat]);
        setSelectedMessageId(messageId);
        setHasResponse(true);
        setShowSplitView(true);
        setChatInput('');
       
        setCurrentResponse('');
        setAnimatedResponseContent('');

        await apiService.askChatModelQuestionStream(
          '',
          secretAttachmentIds[0] || fileId,
          sessionId,
          (text) => {
            if (typeof text === 'string') {
              streamBufferRef.current += text;
              setCurrentResponse(streamBufferRef.current);
              setAnimatedResponseContent(streamBufferRef.current);
              setHasResponse(true);
            }
          },
          (status, message) => {
            console.log('[Secret Prompt] Status:', status, message);
            setStreamingStatus(status);
            setStreamingMessage(
              status === 'generating' ? 'Model thinking' : message || getStatusMessage(status)
            );
            pushProcessingStep(status, message || getStatusMessage(status));
          },
          (metadata) => {
            console.log('[Secret Prompt] Metadata:', metadata);
            if (metadata.session_id) {
              newSessionId = metadata.session_id;
              setSessionId(metadata.session_id);
            }
          },
          (doneData) => {
            console.log('[Secret Prompt] Stream complete:', doneData);
            finalMetadata = doneData;
            const sFromDone = (doneData && typeof doneData.answer === 'string') ? doneData.answer : '';
            const sFromBuf = streamBufferRef.current || '';
            const finalResponse = sFromDone.length >= sFromBuf.length ? (sFromDone || sFromBuf) : sFromBuf;
            console.log('[Secret Prompt] Final response length:', finalResponse.length);
            console.log('[Secret Prompt] Response preview:', finalResponse.substring(0, 200));
           
            if (doneData && doneData.session_id) {
              newSessionId = doneData.session_id;
            }
           
            if (!finalResponse || finalResponse.trim().length === 0) {
              console.error('[Secret Prompt] Empty response received!');
              setError('Received empty response from server. Please try again.');
              setIsGeneratingInsights(false);
              setStreamingStatus(null);
              setStreamingMessage('');
              clearProcessingTimeline();
              return;
            }
           
            let cleanedResponse = finalResponse;
           
            const jsonMatch = finalResponse.match(/```json\s*([\s\S]*?)\s*```/i);
            if (jsonMatch) {
              cleanedResponse = jsonMatch[1].trim();
              console.log('[Secret Prompt] Extracted JSON from markdown code block');
            }
           
            const isStructured = isStructuredJsonResponse(cleanedResponse) || isStructuredJsonResponse(finalResponse);
            console.log('[Secret Prompt] Final response is structured JSON:', isStructured);
            console.log('[Secret Prompt] Final response preview (first 500 chars):', finalResponse.substring(0, 500));
           
            const responseToStore = finalResponse;
           
            let responseToDisplay;
            if (isStructured) {
              try {
                responseToDisplay = renderSecretPromptResponse(cleanedResponse);
                if (!responseToDisplay || responseToDisplay.trim().length < 50) {
                  responseToDisplay = renderSecretPromptResponse(finalResponse);
                }
              } catch (e) {
                console.warn('[Secret Prompt] Error formatting cleaned response, trying original:', e);
                responseToDisplay = renderSecretPromptResponse(finalResponse);
              }
            } else {
              responseToDisplay = convertJsonToPlainText(finalResponse);
            }
           
            console.log('[Secret Prompt] Response formatted, length:', responseToDisplay.length);
            console.log('[Secret Prompt] Formatted response preview (first 500 chars):', responseToDisplay.substring(0, 500));
           
            console.log('[Secret Prompt] Updating message:', {
              messageId,
              selectedSecretId,
              promptLabel,
              responseLength: responseToStore.length
            });
            setMessages((prev) => {
              const updated = prev.map((msg) => {
                if (msg.id === messageId) {
                  console.log('[Secret Prompt] Updating message with secret_id:', selectedSecretId, 'prompt_label:', promptLabel);
                  return {
                    ...msg,
                    answer: responseToStore,
                    session_id: newSessionId,
                    isStreaming: false,
                    used_secret_prompt: true,
                    prompt_label: promptLabel,
                    secret_id: selectedSecretId,
                  };
                }
                return msg;
              });
              console.log('[Secret Prompt] Updated messages. Messages with secret prompts:', updated.filter(m => m.used_secret_prompt).map(m => ({
                id: m.id,
                secret_id: m.secret_id,
                prompt_label: m.prompt_label
              })));
              return updated;
            });
           
            setSelectedMessageId(messageId);
            setSessionId(newSessionId);
            setCurrentResponse(responseToDisplay);
            setAnimatedResponseContent(responseToDisplay);
            showResponseImmediately(responseToDisplay);
            setHasResponse(true);
            setSuccess('Analysis completed successfully!');
            setIsGeneratingInsights(false);
            setStreamingStatus(null);
            setStreamingMessage('');
            clearProcessingTimeline();
            setIsSecretPromptSelected(false);
            setActiveDropdown('Custom Query');
          },
          (error) => {
            console.error('[Secret Prompt] Error:', error);
            setError(`Analysis failed: ${error}`);
            setIsGeneratingInsights(false);
            setStreamingStatus(null);
            setStreamingMessage('');
            clearProcessingTimeline();
          },
          selectedSecretId,
          true,
          promptLabel,
          chatInput.trim() || '',
          selectedLlmName,
          chatModelStreamFetchParams,
          secretAttachmentIds.length > 1 ? secretAttachmentIds : null,
          (thoughtText) => {
            if (typeof thoughtText === 'string' && thoughtText) {
              setReasoningText((prev) => `${prev}${thoughtText}`);
            }
          }
        );
      } catch (error) {
        console.error('[handleSend] Analysis error:', error);
        if (error.message && error.message.includes('No content found')) {
          setError('Document is still processing. Please wait a few moments and try again.');
        } else {
          setError(getChatModelQuotaUserMessage(error) || `Analysis failed: ${error.message}`);
        }
        setStreamingStatus(null);
        setStreamingMessage('');
        clearProcessingTimeline();
      } finally {
        setIsGeneratingInsights(false);
        streamReaderRef.current = null;
      }
    } else {
      if (!chatInput.trim()) {
        setError('Please enter a question.');
        return;
      }

      const currentStatus = processingStatus?.status;
      const currentProgress = progressPercentage || 0;
      const isActivelyProcessing =
        currentStatus &&
        (currentStatus === 'processing' ||
          currentStatus === 'batch_processing' ||
          currentStatus === 'queued' ||
          currentStatus === 'pending');
      const isProcessingComplete =
        !currentStatus || currentStatus === 'processed' || currentProgress >= 100;

      if (hasFile) {
        if (currentStatus === 'error') {
          setError('Document processing failed. Please upload a new document.');
          return;
        }
        if (isActivelyProcessing && !isProcessingComplete) {
          setError('Document is still being processed. Please wait until processing is complete.');
          return;
        }
      }

      try {
        const currentFileId = uploadedFileId || fileId;
        if (currentFileId) {
          const attachmentIds =
            chatAttachmentFileIdsRef.current.length > 0
              ? chatAttachmentFileIdsRef.current
              : [currentFileId];
          console.log('[handleSend] Document chat — file_id(s):', attachmentIds, 'session_id:', sessionId);
          await askQuestionToChat(chatInput, attachmentIds[0], attachmentIds);
        } else {
          // No document uploaded — use general legal chat
          console.log('[handleSend] No document — routing to general legal chat, session_id:', sessionId);
          await askGeneralQuestionToChat(chatInput);
        }
      } catch (error) {
        console.error('[handleSend] Chat error:', error);
        setError(getChatModelQuotaUserMessage(error) || error.message || 'Failed to get answer. Please try again.');
      }
    }
  };


  const handleMessageClick = async (message) => {
    setSelectedMessageId(message.id);
   
    if (message.used_secret_prompt && message.secret_id) {
      const secret = secrets.find((s) => s.id === message.secret_id);
      if (secret) {
        setSelectedSecretId(message.secret_id);
        setIsSecretPromptSelected(true);
        setActiveDropdown(secret.name);
        setSelectedLlmName(secret.llm_name);
      } else {
        console.warn('[handleMessageClick] Secret ID from message not found in current secrets:', message.secret_id);
        console.warn('[handleMessageClick] Available secrets:', secrets.map(s => ({ id: s.id, name: s.name })));
        setSelectedSecretId(null);
        setIsSecretPromptSelected(false);
        setActiveDropdown('Custom Query');
        setSelectedLlmName(null);
      }
    } else {
      setIsSecretPromptSelected(false);
      setActiveDropdown('Custom Query');
      setSelectedSecretId(null);
      setSelectedLlmName(null);
    }
   
    const rawAnswer = message.answer || message.response || '';
    const isStructured = message.used_secret_prompt && isStructuredJsonResponse(rawAnswer);
    const responseToDisplay = isStructured
      ? renderSecretPromptResponse(rawAnswer)
      : convertJsonToPlainText(rawAnswer);
   
    setCurrentResponse(responseToDisplay);
    showResponseImmediately(responseToDisplay);
   
    if (message.file_id) {
      const currentFileId = fileId || message.file_id;
      if (currentFileId) {
        try {
          const status = await getProcessingStatus(currentFileId);
          if (status) {
            const finalStatus = status.status === 'processed' ? status : { ...status, status: 'processed', processing_progress: 100 };
            setProcessingStatus(finalStatus);
            setProgressPercentage(finalStatus.processing_progress || 100);
          } else {
            setProcessingStatus({ status: 'processed', processing_progress: 100 });
            setProgressPercentage(100);
          }
        } catch (error) {
          console.error('[handleMessageClick] Error checking status:', error);
          setProcessingStatus({ status: 'processed', processing_progress: 100 });
          setProgressPercentage(100);
        }
      }
    }
  };

  const clearAllChatData = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    Object.keys(batchPollingIntervalsRef.current).forEach((fileId) => {
      clearInterval(batchPollingIntervalsRef.current[fileId]);
    });
    batchPollingIntervalsRef.current = {};
    setActivePollingFiles(new Set());
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (uploadIntervalRef.current) {
      clearInterval(uploadIntervalRef.current);
      uploadIntervalRef.current = null;
    }
    setMessages([]);
    setDocumentData(null);
    setFileId(null);
    setCurrentResponse('');
    setHasResponse(false);
    setChatInput('');
    setProcessingStatus(null);
    setProgressPercentage(0);
    setError(null);
    setAnimatedResponseContent('');
    setIsAnimatingResponse(false);
    setShowSplitView(false);
    setBatchUploads([]);
    setUploadedDocuments([]);
    setIsSecretPromptSelected(false);
    setSelectedMessageId(null);
    setActiveDropdown('Custom Query');
    const newSessionId = crypto.randomUUID();
    setSessionId(newSessionId);
    console.log('[Session] New chat session created with UUID:', newSessionId);
    chatAttachmentFileIdsRef.current = [];
    setSuccess('New chat session started!');
    navigate('/chatmodel', { replace: true });
  };

  const startNewChat = () => {
    clearAllChatData();
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString) => {
    try {
      return new Date(dateString).toLocaleString();
    } catch (e) {
      return 'Invalid date';
    }
  };

  const getStatusDisplayText = (status, progress = 0) => {
    switch (status) {
      case 'queued':
        return 'Queued...';
      case 'processing':
        if (progress >= 100) return 'Done';
        return progress < 50
          ? `Processing... (${Math.round(progress)}%)`
          : progress < 90
          ? `Analyzing... (${Math.round(progress)}%)`
          : `Finalizing... (${Math.round(progress)}%)`;
      case 'batch_processing':
        if (progress >= 100) return 'Done';
        return progress < 30
          ? `Batch Processing... (${Math.round(progress)}%)`
          : progress < 70
          ? `Processing Documents... (${Math.round(progress)}%)`
          : progress < 95
          ? `Analyzing Batch... (${Math.round(progress)}%)`
          : `Completing... (${Math.round(progress)}%)`;
      case 'processed':
        return progress >= 100 ? 'Done' : 'Processing...';
      case 'error':
      case 'failed':
        return 'Failed';
      default:
        return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
    }
  };

  const handleCopyResponse = async () => {
    try {
      const textToCopy = animatedResponseContent || currentResponse;
      if (textToCopy) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = textToCopy;
        await navigator.clipboard.writeText(tempDiv.innerText);
        setSuccess('AI response copied to clipboard!');
      } else {
        setError('No response to copy.');
      }
    } catch (err) {
      console.error('Failed to copy AI response:', err);
      setError('Failed to copy response.');
    }
  };

  const highlightText = (text, query) => {
    if (!query || !text) return text;
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <span key={i} className="bg-yellow-200 font-semibold text-black">
          {part}
        </span>
      ) : (
        part
      )
    );
  };

  useEffect(() => {
    return () => {
      if (streamReaderRef.current) {
        streamReaderRef.current.cancel().catch(() => {});
      }
      if (streamUpdateTimeoutRef.current) {
        clearTimeout(streamUpdateTimeoutRef.current);
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
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

  useEffect(() => {
    fetchSecrets();
  }, []);

  // Format structured JSON responses (similar to AnalysisPage)
  useEffect(() => {
    if (selectedMessageId && sessionMessages.length > 0 && currentResponse) {
      const selectedMessage = sessionMessages.find(msg => msg.id === selectedMessageId);
      if (selectedMessage) {
        const rawAnswer = selectedMessage.answer || selectedMessage.response || '';
        const isSecretPrompt = selectedMessage.used_secret_prompt || false;
        const isCurrentResponseRawJson = isStructuredJsonResponse(currentResponse);
        const isRawAnswerStructured = isStructuredJsonResponse(rawAnswer);
        
        if (isSecretPrompt && isRawAnswerStructured && (isCurrentResponseRawJson || currentResponse === rawAnswer)) {
          const formattedResponse = renderSecretPromptResponse(rawAnswer);
          if (formattedResponse !== currentResponse) {
            setCurrentResponse(formattedResponse);
            setAnimatedResponseContent(formattedResponse);
          }
        }
      }
    }
  }, [selectedMessageId, sessionMessages, currentResponse]);

  // When the active session changes, drop selection/response that belong to another session.
  useEffect(() => {
    if (!sessionId) return;
    const list = messages.filter(
      (m) => m.session_id != null && String(m.session_id) === String(sessionId)
    );
    if (list.length === 0) {
      if (selectedMessageId != null) setSelectedMessageId(null);
      setCurrentResponse('');
      setAnimatedResponseContent('');
      setHasResponse(false);
      return;
    }
    const stillValid =
      selectedMessageId != null && list.some((m) => m.id === selectedMessageId);
    if (!stillValid && selectedMessageId != null) {
      const last = list[list.length - 1];
      setSelectedMessageId(last.id);
      const rawAnswer = last.answer || '';
      const isStructured = last.used_secret_prompt && isStructuredJsonResponse(rawAnswer);
      const responseToDisplay = isStructured
        ? renderSecretPromptResponse(rawAnswer)
        : convertJsonToPlainText(rawAnswer);
      setCurrentResponse(responseToDisplay);
      setAnimatedResponseContent(responseToDisplay);
      setIsAnimatingResponse(false);
      setHasResponse(true);
    }
  }, [sessionId, messages, selectedMessageId]);



  useEffect(() => {
    const fetchChatHistory = async (currentFileId, currentSessionId, selectedChatId = null) => {
      try {
        console.log('[AnalysisPage] Fetching chat history for fileId:', currentFileId);
        const response = await apiRequest(`/files/chat-history/${currentFileId}`, {
          method: 'GET',
        });
        const sessions = response || [];
        let allMessages = [];
        sessions.forEach((session) => {
          session.messages.forEach((message) => {
            allMessages.push({
              ...message,
              session_id: session.session_id,
              timestamp: message.created_at || message.timestamp,
              display_text_left_panel:
                message.used_secret_prompt
                  ? `Secret Prompt: ${message.prompt_label || 'Unnamed Secret Prompt'}`
                  : message.question,
            });
          });
        });
        if (currentSessionId) {
          allMessages = allMessages.filter((msg) => msg.session_id === currentSessionId);
        }
        allMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        setMessages(allMessages);
        if (allMessages.length > 0) {
          const fileStatus = await getProcessingStatus(currentFileId);
          const actualStatus = 'processed';
          const actualProgress = 100;
         
          const finalStatus = fileStatus ? { ...fileStatus, status: 'processed', processing_progress: 100 } : { status: 'processed', processing_progress: 100 };
         
          setDocumentData({
            id: currentFileId,
            title: `Document for Session ${currentSessionId}`,
            originalName: `Document for Session ${currentSessionId}`,
            size: 0,
            type: 'unknown',
            uploadedAt: new Date().toISOString(),
            status: actualStatus,
            processingProgress: actualProgress,
          });
          setFileId(currentFileId);
          setSessionId(currentSessionId);
          setProcessingStatus(finalStatus);
          setProgressPercentage(actualProgress);
          setHasResponse(true);
          setShowSplitView(true);
          const chatToDisplay = selectedChatId
            ? allMessages.find((chat) => chat.id === selectedChatId)
            : allMessages[allMessages.length - 1];
          if (chatToDisplay) {
            const rawAnswer = chatToDisplay.answer || chatToDisplay.response || '';
            const isStructured = chatToDisplay.used_secret_prompt && isStructuredJsonResponse(rawAnswer);
            const responseToDisplay = isStructured
              ? renderSecretPromptResponse(rawAnswer)
              : convertJsonToPlainText(rawAnswer);
            setCurrentResponse(responseToDisplay);
            showResponseImmediately(responseToDisplay);
            setSelectedMessageId(chatToDisplay.id);
          }
        }
        setSuccess('Chat history loaded successfully!');
      } catch (err) {
        console.error('[AnalysisPage] Error in fetchChatHistory:', err);
        setError(`Failed to load chat history: ${err.message}`);
      }
    };

    const fetchChatHistoryBySessionId = async (currentSessionId, selectedChatId = null) => {
      try {
        console.log('[AnalysisPage] Fetching chat history for sessionId:', currentSessionId);
        const response = await apiRequest(`/files/session/${currentSessionId}`, {
          method: 'GET',
        });
       
        let allMessages = [];
        if (Array.isArray(response)) {
          allMessages = response.map((message) => ({
            ...message,
            session_id: message.session_id || currentSessionId,
            timestamp: message.created_at || message.timestamp,
            display_text_left_panel:
              message.used_secret_prompt
                ? `Secret Prompt: ${message.prompt_label || 'Unnamed Secret Prompt'}`
                : message.question,
          }));
        } else if (response.messages && Array.isArray(response.messages)) {
          allMessages = response.messages.map((message) => ({
            ...message,
            session_id: message.session_id || currentSessionId,
            timestamp: message.created_at || message.timestamp,
            display_text_left_panel:
              message.used_secret_prompt
                ? `Secret Prompt: ${message.prompt_label || 'Unnamed Secret Prompt'}`
                : message.question,
          }));
        } else if (response.sessions && Array.isArray(response.sessions)) {
          response.sessions.forEach((session) => {
            if (session.messages && Array.isArray(session.messages)) {
              session.messages.forEach((message) => {
                allMessages.push({
                  ...message,
                  session_id: session.session_id || currentSessionId,
                  timestamp: message.created_at || message.timestamp,
                  display_text_left_panel:
                    message.used_secret_prompt
                      ? `Secret Prompt: ${message.prompt_label || 'Unnamed Secret Prompt'}`
                      : message.question,
                });
              });
            }
          });
        }
       
        const extractedFileId = allMessages.length > 0
          ? (allMessages[0].file_id || response.file_id || null)
          : null;
       
        allMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        setMessages(allMessages);
       
        if (allMessages.length > 0) {
          if (extractedFileId) {
            setFileId(extractedFileId);
            const fileStatus = await getProcessingStatus(extractedFileId);
            const finalStatus = fileStatus ? { ...fileStatus, status: 'processed', processing_progress: 100 } : { status: 'processed', processing_progress: 100 };
            setProcessingStatus(finalStatus);
            setProgressPercentage(100);
           
            setDocumentData({
              id: extractedFileId,
              title: `Document for Session ${currentSessionId}`,
              originalName: `Document for Session ${currentSessionId}`,
              size: 0,
              type: 'unknown',
              uploadedAt: new Date().toISOString(),
              status: 'processed',
              processingProgress: 100,
            });
          }
         
          setSessionId(currentSessionId);
          setHasResponse(true);
          setShowSplitView(true);
          const chatToDisplay = selectedChatId
            ? allMessages.find((chat) => chat.id === selectedChatId)
            : allMessages[allMessages.length - 1];
          if (chatToDisplay) {
            const rawAnswer = chatToDisplay.answer || chatToDisplay.response || '';
            const isStructured = chatToDisplay.used_secret_prompt && isStructuredJsonResponse(rawAnswer);
            const responseToDisplay = isStructured
              ? renderSecretPromptResponse(rawAnswer)
              : convertJsonToPlainText(rawAnswer);
            setCurrentResponse(responseToDisplay);
            showResponseImmediately(responseToDisplay);
            setSelectedMessageId(chatToDisplay.id);
          }
        }
        setSuccess('Chat history loaded successfully!');
      } catch (err) {
        console.error('[AnalysisPage] Error in fetchChatHistoryBySessionId:', err);
        setError(`Failed to load chat history: ${err.message}`);
      }
    };

    try {
      const savedProcessingStatus = localStorage.getItem('processingStatus');
      if (savedProcessingStatus) {
        const status = JSON.parse(savedProcessingStatus);
        const processingStatuses = ['processing', 'batch_processing', 'batch_queued', 'queued', 'pending'];
        if (processingStatuses.includes(status.status?.toLowerCase())) {
          console.log('🧹 Clearing stale processing state from localStorage');
          localStorage.removeItem('processingStatus');
          localStorage.removeItem('progressPercentage');
          localStorage.removeItem('isUploading');
        }
      }
    } catch (err) {
      console.error('Error cleaning up processing state:', err);
    }

    // URL / navigation state first so refresh and deep links do not lose the chat to localStorage.
    if (location.state?.newChat) {
      clearAllChatData();
      window.history.replaceState({}, document.title);
      return;
    }

    if (paramFileId && paramSessionId) {
      console.log('[DB] Resuming past session from URL params:', {
        file_id: paramFileId,
        session_id: paramSessionId,
        source: 'URL params',
      });
      setFileId(paramFileId);
      chatAttachmentFileIdsRef.current = [paramFileId];
      setSessionId(paramSessionId);
      setShowSplitView(true);
      setHasResponse(true);
      fetchChatModelHistory(paramFileId, paramSessionId);
      window.history.replaceState({}, document.title);
      return;
    }

    if (paramFileId && !paramSessionId) {
      console.log('[ChatModelPage] Loading chat from fileId only (resolve latest session):', { paramFileId });
      setFileId(paramFileId);
      chatAttachmentFileIdsRef.current = [paramFileId];
      setShowSplitView(true);
      setMessages([]);
      setChatModelHistory([]);
      setSelectedMessageId(null);
      setCurrentResponse('');
      setAnimatedResponseContent('');
      (async () => {
        try {
          const sessRes = await apiService.getChatModelSessions(paramFileId);
          if (sessRes.success && sessRes.data?.sessions?.length) {
            const latest = sessRes.data.sessions[0];
            setSessionId(latest.session_id);
            setHasResponse(true);
            await fetchChatModelHistory(paramFileId, latest.session_id);
          } else {
            const nid = crypto.randomUUID();
            setSessionId(nid);
            setHasResponse(false);
            await fetchChatModelHistory(paramFileId, nid);
          }
        } catch (e) {
          console.error('[ChatModelPage] Failed to resolve session for file:', e);
          setError('Failed to load document chats');
        }
      })();
      return;
    }

    // /chatmodel/session/:sessionId — general LLM chat (refresh-safe)
    if (paramSessionId && !paramFileId) {
      console.log('[ChatModelPage] General chat from URL:', paramSessionId);
      setFileId(null);
      setDocumentData(null);
      chatAttachmentFileIdsRef.current = [];
      setSessionId(paramSessionId);
      setShowSplitView(true);
      setHasResponse(true);
      const msgs = messagesRef.current;
      const skipFetch =
        msgs.length > 0 &&
        msgs.every((m) => !m.isStreaming) &&
        msgs.some((m) => String(m.session_id || sessionId || '') === String(paramSessionId));
      if (!skipFetch) {
        setMessages([]);
        fetchGeneralChatHistory(paramSessionId);
      }
      window.history.replaceState({}, document.title);
      return;
    }

    if (location.state?.chat) {
      const chatData = location.state.chat;
      console.log('[DB] Resuming past session from navigation state:', {
        file_id: chatData.file_id,
        session_id: chatData.session_id,
        chat_id: chatData.id,
        source: 'location.state.chat',
      });
      if (chatData.is_general_chat || (!chatData.file_id && chatData.session_id)) {
        // General legal chat — load by session only (no document)
        console.log('[DB] Resuming general legal chat session:', chatData.session_id);
        setSessionId(chatData.session_id);
        setHasResponse(true);
        fetchGeneralChatHistory(chatData.session_id);
      } else if (chatData.file_id && chatData.session_id) {
        setFileId(chatData.file_id);
        chatAttachmentFileIdsRef.current = [chatData.file_id];
        setSessionId(chatData.session_id);
        setShowSplitView(true);
        setHasResponse(true);
        fetchChatHistory(chatData.file_id, chatData.session_id, chatData.id);
      } else if (chatData.session_id) {
        console.log('[DB] Loading chat by session_id only:', chatData.session_id);
        setSessionId(chatData.session_id);
        setShowSplitView(true);
        setHasResponse(true);
        fetchChatHistoryBySessionId(chatData.session_id, chatData.id);
      } else {
        setError('Unable to load chat: Missing required information (session_id or file_id)');
      }
      window.history.replaceState({}, document.title);
      return;
    }

    try {
      const savedMessages = localStorage.getItem('messages');
      if (savedMessages) {
        const parsed = JSON.parse(savedMessages);
        if (Array.isArray(parsed)) {
          setMessages(parsed);
        }
      }
      const savedSessionId = localStorage.getItem('sessionId');
      if (savedSessionId) {
        console.log('[DB] Restored session ID from localStorage:', savedSessionId);
        setSessionId(savedSessionId);
      } else {
        const newSessionId = crypto.randomUUID();
        console.log('[Session] No saved session, created new UUID session:', newSessionId);
        setSessionId(newSessionId);
      }
      const savedCurrentResponse = localStorage.getItem('currentResponse');
      const savedAnimatedResponseContent = localStorage.getItem('animatedResponseContent');
      if (savedCurrentResponse) {
        setCurrentResponse(savedCurrentResponse);
        if (savedAnimatedResponseContent) {
          setAnimatedResponseContent(savedAnimatedResponseContent);
          setShowSplitView(true);
        } else {
          setAnimatedResponseContent(savedCurrentResponse);
        }
        setIsAnimatingResponse(false);
      }
      const savedHasResponse = localStorage.getItem('hasResponse');
      if (savedHasResponse) {
        const parsedHasResponse = JSON.parse(savedHasResponse);
        setHasResponse(parsedHasResponse);
        if (parsedHasResponse) {
          setShowSplitView(true);
        }
      }
      const savedDocumentData = localStorage.getItem('documentData');
      if (savedDocumentData) {
        const parsed = JSON.parse(savedDocumentData);
        setDocumentData(parsed);
      }
      const savedFileId = localStorage.getItem('fileId');
      if (savedFileId) {
        setFileId(savedFileId);
        chatAttachmentFileIdsRef.current = [savedFileId];
      }
      const savedProcessingStatus = localStorage.getItem('processingStatus');
      if (savedProcessingStatus) {
        const parsed = JSON.parse(savedProcessingStatus);
        setProcessingStatus(parsed);
        setProgressPercentage(parsed.processing_progress || 0);
      }
    } catch (error) {
      console.error('[AnalysisPage] Error restoring from localStorage:', error);
      if (!sessionId) {
        const newSessionId = crypto.randomUUID();
        console.log('[Session] Error recovery: created new UUID session:', newSessionId);
        setSessionId(newSessionId);
      }
    }
  }, [location.state, paramFileId, paramSessionId]);

  // Keep URL in sync so refresh restores the same session (general vs document chat).
  useEffect(() => {
    if (location.state?.newChat) return;
    if (!sessionId) return;
    if (fileId) {
      const target = `/chatmodel/${fileId}/${sessionId}`;
      if (location.pathname !== target) {
        navigate(target, { replace: true });
      }
      return;
    }
    if (location.pathname.startsWith('/chatmodel/session/')) return;
    if (location.pathname !== '/chatmodel') return;
    if (!hasResponse && messagesRef.current.length === 0) return;
    navigate(`/chatmodel/session/${encodeURIComponent(sessionId)}`, { replace: true });
  }, [sessionId, fileId, hasResponse, navigate, location.pathname, location.state?.newChat, messages.length]);

  useEffect(() => {
    if (showSplitView) {
      setIsSidebarHidden(false);
      setIsSidebarCollapsed(true);
    } else if (hasResponse) {
      setIsSidebarHidden(false);
      setIsSidebarCollapsed(false);
    } else {
      setIsSidebarHidden(false);
      setIsSidebarCollapsed(false);
    }
  }, [hasResponse, showSplitView, setIsSidebarHidden, setIsSidebarCollapsed]);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [success]);




  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const markdownComponents = {
    h1: ({ node, ...props }) => (
      <h1
        className="text-[24px] font-bold mb-5 mt-7 text-[#1a3d2b] bg-[#e8f4ee] border-l-4 border-[#1f6b5f] px-4 py-2 rounded-r-md analysis-page-ai-response break-words"
        {...props}
      />
    ),
    h2: ({ node, ...props }) => (
      <h2
        className="text-[20px] font-bold mb-4 mt-6 text-[#1a3d2b] bg-[#eef7f2] border-l-4 border-[#2d8c72] px-4 py-2 rounded-r-md analysis-page-ai-response break-words"
        {...props}
      />
    ),
    h3: ({ node, ...props }) => (
      <h3
        className="text-[17px] font-semibold mb-3 mt-5 text-[#1f3d30] bg-[#f3faf6] border-l-3 border-[#4aab87] px-3 py-1.5 rounded-r analysis-page-ai-response break-words"
        {...props}
      />
    ),
    h4: ({ node, ...props }) => (
      <h4
        className="text-[15px] font-semibold mb-2 mt-4 text-[#2a4a38] bg-[#f7fcf9] border-l-2 border-[#6bbfa0] px-3 py-1 rounded-r analysis-page-ai-response break-words"
        {...props}
      />
    ),
    h5: ({ node, ...props }) => (
      <h5 className="text-[14px] font-semibold mb-2 mt-3 text-gray-700 px-2 py-1 analysis-page-ai-response break-words" {...props} />
    ),
    h6: ({ node, ...props }) => (
      <h6 className="text-[13px] font-semibold mb-2 mt-2 text-gray-600 px-2 py-1 analysis-page-ai-response break-words" {...props} />
    ),
    p: ({ node, ...props }) => (
      <p className="mb-4 leading-[1.9] text-[#2f2a22] text-[17px] analysis-page-ai-response break-words" {...props} />
    ),
    strong: ({ node, ...props }) => <strong className="font-bold text-gray-900" {...props} />,
    em: ({ node, ...props }) => <em className="italic text-gray-800" {...props} />,
    ul: ({ node, ...props }) => <ul className="list-disc pl-7 mb-4 space-y-2 text-[#2f2a22]" {...props} />,
    ol: ({ node, ...props }) => <ol className="list-decimal pl-7 mb-4 space-y-2 text-[#2f2a22]" {...props} />,
    li: ({ node, ...props }) => <li className="leading-[1.9] text-[#2f2a22] text-[17px] analysis-page-ai-response" {...props} />,
    a: ({ node, ...props }) => (
      <a
        className="text-[#21C1B6] hover:text-[#1AA49B] underline font-medium transition-colors"
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      />
    ),
    blockquote: ({ node, ...props }) => (
      <blockquote
        className="border-l-4 border-[#1f6b5f] pl-4 py-3 my-4 bg-gray-50 text-[#5b554a] italic rounded-r analysis-page-ai-response text-[16px] break-words"
        {...props}
      />
    ),
    code: ({ node, inline, className, children, ...props }) => {
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : '';
      if (inline) {
        return (
          <code
            className="bg-gray-100 text-[#a53d2d] px-1.5 py-0.5 rounded text-[13px] font-mono border border-[#ddd6ca] break-all"
            {...props}
          >
            {children}
          </code>
        );
      }
      return (
        <div className="relative my-3 sm:my-4">
          {language && (
            <div className="bg-gray-800 text-gray-300 text-xs px-2 sm:px-3 py-1 rounded-t font-mono">
              {language}
            </div>
          )}
          <pre className={`bg-[#f3f4f6] text-[#243124] p-4 ${language ? 'rounded-b' : 'rounded'} overflow-x-auto border border-[#d8d1c5]`}>
            <code className="font-mono text-[13px]" {...props}>
              {children}
            </code>
          </pre>
        </div>
      );
    },
    pre: ({ node, ...props }) => (
      <pre className="bg-[#f3f4f6] text-[#243124] p-4 rounded my-4 overflow-x-auto text-[13px] border border-[#d8d1c5]" {...props} />
    ),
    table: ({ node, ...props }) => (
      <div className="my-6 rounded-lg border border-[#d6d0c4] block max-w-full overflow-hidden">
        <table className="border-collapse text-[14px] w-full" {...props} />
      </div>
    ),
    thead: ({ node, ...props }) => <thead className="bg-gray-50" {...props} />,
    th: ({ node, ...props }) => (
      <th
        className="px-3 py-2.5 text-left text-[11px] font-semibold text-[#5b554a] uppercase tracking-[0.12em] border-b border-r border-[#d6d0c4] whitespace-normal last:border-r-0 break-words"
        {...props}
      />
    ),
    tbody: ({ node, ...props }) => <tbody className="bg-white divide-y divide-[#ece7de]" {...props} />,
    tr: ({ node, ...props }) => <tr className="hover:bg-gray-50 transition-colors" {...props} />,
    td: ({ node, ...props }) => (
      <td className="px-3 py-2.5 text-[14px] text-[#2f2a22] border-b border-r border-[#ece7de] align-top last:border-r-0 break-words" {...props} />
    ),
    hr: ({ node, ...props }) => <hr className="my-6 border-t border-[#d8d1c5]" {...props} />,
    img: ({ node, ...props }) => <img className="max-w-full h-auto rounded-lg shadow-md my-4" alt="" {...props} />,
  };

  const getInputPlaceholder = () => {
    if (isSecretPromptSelected) {
      return `Analysis : ${activeDropdown}...`;
    }
    if (!fileId) {
      return 'Ask a legal question... (or upload a document for document-specific chat)';
    }
    if (processingStatus?.status && processingStatus.status !== 'processed' && progressPercentage < 100) {
      return `${processingStatus.current_operation || 'Processing document...'} (${Math.round(progressPercentage)}%)`;
    }
    return showSplitView ? 'Ask a question about the document...' : 'Ask a legal question or question about your document...';
  };

  return (
    <div className="flex flex-col lg:flex-row h-[90vh] bg-white overflow-hidden">
      {error && (() => {
        const isLimitError = typeof error === 'object' && error.isLimit;
        const errorTitle = isLimitError ? error.title : 'Something went wrong';
        const errorBody = isLimitError ? error.body : (typeof error === 'string' ? error : error.body || String(error));
        const limitIcons = { minute: '⏱️', hour: '🕐', daily: '📅', tokens: '🔋' };
        const limitEmoji = isLimitError ? (limitIcons[error.limitType] || '🚫') : null;

        if (isLimitError) {
          return (
            <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[92vw] max-w-md">
              <div className="bg-white rounded-2xl shadow-2xl border border-[#cfe1db] overflow-hidden">
                <div className="bg-gradient-to-r from-[#21C1B6] to-[#1f6b5f] px-5 py-3.5 flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <span className="text-xl leading-none">{limitEmoji}</span>
                    <h3 className="text-white font-semibold text-sm tracking-wide">{errorTitle}</h3>
                  </div>
                  <button onClick={() => setError(null)} className="text-white/70 hover:text-white transition-colors ml-3">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="bg-[#eef5f2] px-5 py-4">
                  <p className="text-sm text-[#2b3528] leading-relaxed">{errorBody}</p>
                  <div className="mt-4 pt-3 border-t border-[#cfe1db] flex items-center justify-between">
                    <div className="flex items-center space-x-1.5 text-xs text-[#1f6b5f]/70">
                      <Clock className="h-3 w-3" />
                      <span>Limits reset automatically</span>
                    </div>
                    <button
                      onClick={() => setError(null)}
                      className="px-4 py-1.5 bg-[#21C1B6] hover:bg-[#1AA49B] text-white text-xs font-semibold rounded-lg transition-colors"
                    >
                      Got it
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        }
        return (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[92vw] max-w-md">
            <div className="bg-white rounded-xl shadow-xl border border-[#cfe1db] overflow-hidden">
              <div className="bg-gradient-to-r from-[#21C1B6] to-[#1f6b5f] px-4 py-3 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <AlertCircle className="h-4 w-4 text-white flex-shrink-0" />
                  <h3 className="text-white font-semibold text-sm">{errorTitle}</h3>
                </div>
                <button onClick={() => setError(null)} className="text-white/70 hover:text-white transition-colors ml-3">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="bg-[#eef5f2] px-4 py-3">
                <p className="text-sm text-[#2b3528] leading-relaxed">{errorBody}</p>
              </div>
            </div>
          </div>
        );
      })()}
      {success && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[92vw] max-w-sm">
          <div className="bg-white rounded-xl shadow-xl border border-[#cfe1db] overflow-hidden">
            <div className="bg-gradient-to-r from-[#21C1B6] to-[#1f6b5f] px-4 py-3 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <CheckCircle className="h-4 w-4 text-white flex-shrink-0" />
                <span className="text-white font-semibold text-sm">{success}</span>
              </div>
              <button onClick={() => setSuccess(null)} className="text-white/70 hover:text-white transition-colors ml-3">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
      {showInsufficientFundsAlert && (
        <div className="fixed top-4 right-4 z-50 max-w-md">
          <div className="bg-red-50 border-2 border-red-300 rounded-lg shadow-2xl p-4 animate-fadeIn">
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0">
                <AlertCircle className="w-6 h-6 text-red-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-lg font-bold text-gray-900 mb-1">Insufficient Funds</h4>
                <p className="text-sm text-gray-700 mb-3">
                  You don't have enough credits to upload documents. Please upgrade your subscription plan to continue.
                </p>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => {
                      setShowInsufficientFundsAlert(false);
                      navigate('/subscription-plans');
                    }}
                    className="flex items-center justify-center px-4 py-2 bg-[#21C1B6] text-white rounded-lg hover:bg-[#1AA89E] transition-all duration-200 font-semibold text-sm shadow-md hover:shadow-lg"
                  >
                    <CreditCard className="w-4 h-4 mr-1.5" />
                    Upgrade Now
                  </button>
                  <button
                    onClick={() => setShowInsufficientFundsAlert(false)}
                    className="px-3 py-2 text-gray-600 hover:text-gray-900 transition-colors text-sm font-medium"
                  >
                    Close
                  </button>
                </div>
              </div>
              <button
                onClick={() => setShowInsufficientFundsAlert(false)}
                className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
      {!showSplitView ? (
        <div className="flex flex-col h-full w-full">
          <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8 overflow-y-auto">
            <div className="text-center max-w-2xl mb-8 sm:mb-12">
              <h3 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-3 sm:mb-4 text-gray-900">Welcome to Smart Legal Insights</h3>
              <p className="text-gray-600 text-base sm:text-lg lg:text-xl leading-relaxed">
              your AI partner for fast, precise legal document analysis. Upload a file or ask a question to get instant, context-aware legal insights.
              </p>
            </div>
            <div className="w-full max-w-4xl">
            {documentData && !hasResponse && (
              <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center space-x-3">
                  <FileCheck className="h-5 w-5 text-green-600" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{documentData.originalName}</p>
                    <p className="text-xs text-gray-500">
                      {formatFileSize(documentData.size)} • {formatDate(documentData.uploadedAt)}
                    </p>
                  </div>
                </div>
              </div>
            )}
            {isChatUploading && (
              <div className="mt-4 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border-2 border-blue-200 shadow-lg">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-2">
                    <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
                    <span className="text-sm font-semibold text-blue-900">Uploading document...</span>
                  </div>
                  <span className="text-base font-bold text-blue-700">{uploadProgress}%</span>
                </div>
                <div className="w-full bg-blue-200 rounded-full h-3 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-blue-500 to-blue-600 h-3 rounded-full transition-all duration-300 ease-out flex items-center justify-end pr-2"
                    style={{ width: `${uploadProgress}%` }}
                  >
                    {uploadProgress > 10 && (
                      <span className="text-xs font-semibold text-white">{uploadProgress}%</span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-blue-600 mt-2 flex items-center">
                  <Upload className="h-3 w-3 mr-1" />
                  Please wait while your document is being uploaded...
                </p>
              </div>
            )}
            <form onSubmit={handleSend} className="mx-auto mt-4">
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3 bg-gray-50 rounded-xl px-3 sm:px-5 py-4 sm:py-6 focus-within:border-[#21C1B6] focus-within:bg-white focus-within:shadow-sm analysis-input-container">
                <UploadOptionsMenu
                  fileInputRef={fileInputRef}
                  isUploading={isUploading || isChatUploading}
                  onLocalFileClick={() => fileInputRef.current?.click()}
                  onGoogleDriveFilesSelected={handleGoogleDriveUpload}
                  isSplitView={false}
                  disabled={isUploading || isChatUploading}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.tiff,.mp3,.wav,.m4a,.flac,.ogg,.webm,.aac,.mp4"
                  onChange={handleFileUpload}
                  disabled={isUploading || isChatUploading}
                  multiple
                />
                <div className="relative flex-shrink-0" ref={dropdownRef}>
                  <button
                    type="button"
                    onClick={() => setShowDropdown(!showDropdown)}
                    disabled={isLoading || isGeneratingInsights || isLoadingSecrets}
                    className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <BookOpen className="h-3 w-3 sm:h-4 sm:w-4" />
                    <span className="hidden sm:inline">{isLoadingSecrets ? 'Loading...' : activeDropdown}</span>
                    <span className="inline sm:hidden">{isLoadingSecrets ? '...' : 'Prompts'}</span>
                    <ChevronDown className="h-3 w-3 sm:h-4 sm:w-4" />
                  </button>
                  {showDropdown && !isLoadingSecrets && (
                    <div className="absolute bottom-full left-0 mb-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto">
                      {secrets.length > 0 ? (
                        secrets.map((secret) => (
                          <button
                            key={secret.id}
                            type="button"
                            onClick={() => handleDropdownSelect(secret.name, secret.id, secret.llm_name)}
                            className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg"
                          >
                            {secret.name}
                          </button>
                        ))
                      ) : (
                        <div className="px-4 py-2.5 text-sm text-gray-500">No analysis prompts available</div>
                      )}
                    </div>
                  )}
                </div>
                <input
                  type="text"
                  value={chatInput}
                  onChange={handleChatInputChange}
                  placeholder={getInputPlaceholder()}
                  className="flex-1 bg-transparent border-none outline-none text-gray-900 placeholder-gray-500 text-sm sm:text-[15px] font-medium py-2 min-w-0 w-full sm:w-auto analysis-page-user-input"
                  disabled={isLoading || isGeneratingInsights}
                />
                <button
                  type="button"
                  onClick={toggleListening}
                  className={`p-2 rounded-full transition-all duration-300 flex-shrink-0 ${
                    isListening 
                      ? 'bg-red-500 text-white animate-pulse shadow-lg scale-110' 
                      : 'text-gray-400 hover:text-[#21C1B6] hover:bg-gray-50'
                  }`}
                  disabled={isLoading || isGeneratingInsights || isSecretPromptSelected}
                  title={isListening ? "Stop listening" : "Start voice input"}
                >
                  {isListening ? (
                    <MicOff className="h-4 w-4" />
                  ) : (
                    <Mic className="h-4 w-4" />
                  )}
                </button>
                <button
                  type={sendButtonType}
                  disabled={isSendButtonDisabled}
                  onClick={handleSendButtonClick}
                  className={getSendButtonClassName()}
                  title={sendButtonTitle}
                >
                  {renderSendButtonIcon()}
                </button>
              </div>
              {isSecretPromptSelected && (
                <div className="mt-3 p-2 bg-[#E0F7F6] border border-[#21C1B6] rounded-lg">
                  <div className="flex items-center space-x-2 text-sm text-[#21C1B6]">
                    <Bot className="h-4 w-4" />
                    <span>
                      Using analysis prompt: <strong>{activeDropdown}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setIsSecretPromptSelected(false);
                        setActiveDropdown('Custom Query');
                        setSelectedSecretId(null);
                      }}
                      className="ml-auto text-[#21C1B6] hover:text-[#1AA49B]"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                )}
              </form>
              <RateQuotaPills limits={limits} className="mt-2" />
              
              {fileSizeLimitError && (
                <div className="mt-2 animate-fadeIn">
                  <div className="bg-[#E0F7F6] border border-[#21C1B6] rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-[#21C1B6] flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs sm:text-sm font-semibold text-gray-900 mb-1">Upload limit exceeded</p>
                        <p className="text-xs sm:text-sm text-gray-700 mb-2 leading-relaxed">
                          {fileSizeLimitError.message}
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setFileSizeLimitError(null)}
                            className="px-3 py-1.5 bg-[#21C1B6] text-white rounded-md hover:bg-[#1AA49B] transition-colors text-xs font-medium"
                          >
                            OK
                          </button>
                        </div>
                      </div>
                      <button
                        onClick={() => setFileSizeLimitError(null)}
                        className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors p-0.5"
                        aria-label="Close"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
          </div>
          </div>
         
          {sessionMessages.length > 0 && (
            <div className="border-t border-gray-200 bg-white flex-shrink-0" style={{ height: '30vh', minHeight: '250px' }}>
              <div className="h-full flex flex-col">
                <div className="p-2 sm:p-3 border-b border-gray-200 flex-shrink-0">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm sm:text-base font-semibold text-gray-900 flex items-center">
                      <MessageSquare className="h-4 w-4 mr-2" />
                      Recent Questions
                    </h2>
                    <span className="text-xs text-gray-500">{sessionMessages.length} question{sessionMessages.length !== 1 ? 's' : ''}</span>
                  </div>
                </div>
               
                <div className="flex-1 overflow-y-auto px-2 sm:px-3 py-2 [scrollbar-width:thin] [scrollbar-color:#c5c7cc_#f3f4f6] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-gray-100 [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-thumb]:rounded-full">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {sessionMessages.slice(0, 9).map((msg, i) => (
                      <div
                        key={msg.id || i}
                        onClick={() => {
                          handleMessageClick(msg);
                          setShowSplitView(true);
                        }}
                        className="p-2 sm:p-3 rounded-lg border border-gray-200 bg-gray-50 hover:bg-[#E0F7F6] hover:border-[#21C1B6] cursor-pointer transition-all duration-200 hover:shadow-md"
                      >
                        <p className="text-xs sm:text-sm font-medium text-gray-900 line-clamp-2 mb-1">
                          {msg.display_text_left_panel || msg.question}
                        </p>
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <span className="truncate">{formatDate(msg.timestamp || msg.created_at)}</span>
                          <ChevronRight className="h-3 w-3 flex-shrink-0 ml-1" />
                        </div>
                      </div>
                    ))}
                  </div>
                 
                  {sessionMessages.length > 9 && (
                    <div className="mt-2 text-center">
                      <button
                        onClick={() => setShowSplitView(true)}
                        className="text-xs text-[#21C1B6] hover:text-[#1AA49B] font-medium"
                      >
                        View all {sessionMessages.length} questions →
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (


        <>
          <div
            ref={splitContainerRef}
            className={`w-full h-full flex flex-col lg:flex-row ${isResizingSplit ? 'select-none' : ''}`}
          >
          <div
            className="w-full border-r-0 lg:border-r border-b lg:border-b-0 border-gray-200 flex flex-col bg-white h-1/2 lg:h-full"
            style={
              isDesktopSplit
                ? { width: `${splitLeftWidth}%`, flex: `0 0 ${splitLeftWidth}%` }
                : undefined
            }
          >
            <div className="p-4 border-b border-gray-200 bg-white">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[#807868]">
                    {documentData?.originalName ? 'AI Projects' : 'Legal Assistant'}
                  </p>
                  <h2 className="text-base sm:text-lg font-semibold text-[#2b3528] truncate">
                    {documentData?.originalName
                      ? documentData.originalName
                      : selectedMessageId
                        ? (sessionMessages.find((msg) => msg.id === selectedMessageId)?.display_text_left_panel || 'Legal Chat')
                        : 'General Legal Chat'}
                  </h2>
                </div>
                <button
                  onClick={startNewChat}
                  className="px-3 py-1.5 text-xs font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-md transition-colors border border-gray-200"
                >
                  New Chat
                </button>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#8e8678]" />
                <input
                  type="text"
                  placeholder="Search questions..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-white rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1f6b5f] border border-gray-200"
                />
              </div>
            </div>

            <div className="flex-1 min-h-0 px-4 pt-3 pb-2 bg-white">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#807868] mb-2">
                Recent Questions
              </p>
              {pendingQuestion && (
                <div className="mb-2 p-3 rounded-xl border border-[#cfe1db] bg-[#f6fbf9]">
                  <p className="text-xs font-medium text-[#2b3528] line-clamp-2 mb-3">{pendingQuestion}</p>
                  <button
                    type="button"
                    onClick={() => setShowProcessingTimeline((prev) => !prev)}
                    className="flex items-center gap-2 text-xs font-medium text-[#1f6b5f] mb-3"
                  >
                    <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" />
                    <span>{showProcessingTimeline ? 'Hide thinking' : 'Show thinking'}</span>
                    <ChevronDown className={`h-3 w-3 transition-transform ${showProcessingTimeline ? 'rotate-180' : ''}`} />
                  </button>
                  {showProcessingTimeline && processingTimeline.length > 0 && (
                    <div className="border-l border-[#c9ddd5] pl-3 space-y-3">
                      {processingTimeline.map((step) => (
                        <div key={step.id}>
                          <div className="flex items-center gap-2 mb-1">
                            {step.state === 'active' ? (
                              <Loader2 className="h-3 w-3 text-[#1f6b5f] animate-spin flex-shrink-0" />
                            ) : (
                              <CheckCircle className="h-3 w-3 text-[#1f6b5f] flex-shrink-0" />
                            )}
                            <p className="text-[13px] font-semibold italic text-[#2b3528]">{step.title}</p>
                          </div>
                          <p className="text-xs text-[#4f5b56] leading-5">{step.description}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {normalizedReasoningText && (
                    <div className="mt-3 pt-3 border-t border-[#dbe9e3]">
                      <button
                        type="button"
                        onClick={() => setShowReasoning((prev) => !prev)}
                        className="flex items-center gap-2 text-xs font-medium text-[#6f7f79] mb-2"
                      >
                        <span>Show AI Reasoning</span>
                        <ChevronDown className={`h-3 w-3 transition-transform ${showReasoning ? 'rotate-180' : ''}`} />
                      </button>
                      {showReasoning && (
                        <div className="border-l border-[#d6e4de] pl-3 max-h-80 overflow-y-auto pr-2">
                          <div className="prose prose-sm max-w-none text-[#67756f] prose-p:my-2 prose-headings:my-2 prose-strong:text-[#42504a] prose-em:text-[#67756f]">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {normalizedReasoningText}
                            </ReactMarkdown>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {(!showProcessingTimeline || processingTimeline.length === 0) && (
                    <div className="flex items-center space-x-1.5">
                      <Loader2 className="h-3 w-3 text-[#1f6b5f] animate-spin flex-shrink-0" />
                      <span className="text-xs text-[#1f6b5f] font-medium">
                        {streamingMessage || getStatusMessage(streamingStatus) || 'Model thinking...'}
                      </span>
                    </div>
                  )}
                </div>
              )}
              <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-gray-200 bg-white">
                <MessagesList
                  messages={sessionMessages}
                  selectedMessageId={selectedMessageId}
                  handleMessageClick={handleMessageClick}
                  displayLimit={displayLimit}
                  showAllChats={showAllChats}
                  setShowAllChats={setShowAllChats}
                  highlightText={highlightText}
                  formatDate={formatDate}
                  searchQuery={searchQuery}
                />
              </div>
            </div>

            <div className="border-t border-gray-200 p-3 bg-white flex-shrink-0">
              {documentData && (
                <div className="mb-2 p-2 bg-white rounded-lg border border-gray-200">
                  <div className="flex items-center space-x-1.5">
                    <FileCheck className="h-3 w-3 text-green-600" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-[#2b3528] truncate">{documentData.originalName}</p>
                      <p className="text-xs text-[#807868]">{formatFileSize(documentData.size)}</p>
                    </div>
                  </div>
                </div>
              )}
              {isChatUploading && (
                <div className="mb-2 p-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border-2 border-blue-200 shadow-md">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-1.5">
                      <Loader2 className="h-3.5 w-3.5 text-blue-600 animate-spin" />
                      <span className="text-xs font-semibold text-blue-900">Uploading document...</span>
                    </div>
                    <span className="text-xs font-bold text-blue-700">{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-blue-200 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-blue-500 to-blue-600 h-2 rounded-full transition-all duration-300 ease-out flex items-center justify-end pr-1"
                      style={{ width: `${uploadProgress}%` }}
                    >
                      {uploadProgress > 15 && (
                        <span className="text-[10px] font-semibold text-white">{uploadProgress}%</span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-blue-600 mt-1.5 flex items-center">
                    <Upload className="h-3 w-3 mr-1" />
                    Please wait while your document is being uploaded...
                  </p>
                </div>
              )}
              <form onSubmit={handleSend}>
                <div className="flex items-center space-x-1.5 bg-gray-50 rounded-xl px-2.5 py-2 focus-within:border-[#21C1B6] focus-within:bg-white focus-within:shadow-sm analysis-input-container">
                  <UploadOptionsMenu
                    fileInputRef={fileInputRef}
                    isUploading={isUploading || isChatUploading}
                    onLocalFileClick={() => fileInputRef.current?.click()}
                    onGoogleDriveFilesSelected={handleGoogleDriveUpload}
                    isSplitView={true}
                    disabled={isUploading || isChatUploading}
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.tiff,.mp3,.wav,.m4a,.flac,.ogg,.webm,.aac,.mp4"
                    onChange={handleFileUpload}
                    disabled={isUploading || isChatUploading}
                    multiple
                  />
                  <div className="relative flex-shrink-0" ref={dropdownRef}>
                    <button
                      type="button"
                      onClick={() => setShowDropdown(!showDropdown)}
                      disabled={isLoading || isGeneratingInsights || isLoadingSecrets}
                      className="flex items-center space-x-1 px-2 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <BookOpen className="h-3 w-3" />
                      <span>{isLoadingSecrets ? 'Loading...' : activeDropdown}</span>
                      <ChevronDown className="h-3 w-3" />
                    </button>
                    {showDropdown && !isLoadingSecrets && (
                      <div className="absolute bottom-full left-0 mb-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto">
                        {secrets.length > 0 ? (
                          secrets.map((secret) => (
                            <button
                              key={secret.id}
                              type="button"
                              onClick={() => handleDropdownSelect(secret.name, secret.id, secret.llm_name)}
                              className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg"
                            >
                              {secret.name}
                            </button>
                          ))
                        ) : (
                          <div className="px-4 py-2.5 text-sm text-gray-500">No analysis prompts available</div>
                        )}
                      </div>
                    )}
                  </div>
                <input
                  type="text"
                  value={chatInput}
                  onChange={handleChatInputChange}
                  placeholder={getInputPlaceholder()}
                  className="flex-1 bg-transparent border-none outline-none text-gray-900 placeholder-gray-500 text-xs font-medium py-1 min-w-0 analysis-page-user-input"
                  disabled={isLoading || isGeneratingInsights}
                />
                <button
                  type="button"
                  onClick={toggleListening}
                  className={`p-1.5 rounded-full transition-all duration-300 flex-shrink-0 ${
                    isListening 
                      ? 'bg-red-500 text-white animate-pulse shadow-lg scale-110' 
                      : 'text-gray-400 hover:text-[#21C1B6] hover:bg-gray-50'
                  }`}
                  disabled={isLoading || isGeneratingInsights || isSecretPromptSelected}
                  title={isListening ? "Stop listening" : "Start voice input"}
                >
                  {isListening ? (
                    <MicOff className="h-3.5 w-3.5" />
                  ) : (
                    <Mic className="h-3.5 w-3.5" />
                  )}
                </button>
                  <button
                    type={sendButtonType}
                    disabled={isSendButtonDisabled}
                    onClick={handleSendButtonClick}
                    className={getSendButtonClassName('small')}
                    title={sendButtonTitle}
                  >
                    {renderSendButtonIcon('small')}
                  </button>
                </div>
                {isSecretPromptSelected && (
                  <div className="mt-1.5 p-1.5 bg-[#E0F7F6] border border-[#21C1B6] rounded-lg">
                    <div className="flex items-center space-x-1.5 text-xs text-[#21C1B6]">
                      <Bot className="h-3 w-3" />
                      <span>
                        Using: <strong>{activeDropdown}</strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setIsSecretPromptSelected(false);
                          setActiveDropdown('Custom Query');
                          setSelectedSecretId(null);
                        }}
                        className="ml-auto text-[#21C1B6] hover:text-[#1AA49B]"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                )}
              </form>
              <RateQuotaPills limits={limits} className="mt-2" />
              
              {fileSizeLimitError && (
                <div className="mt-2 animate-fadeIn">
                  <div className="bg-[#E0F7F6] border border-[#21C1B6] rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-[#21C1B6] flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs sm:text-sm font-semibold text-gray-900 mb-1">Upload limit exceeded</p>
                        <p className="text-xs sm:text-sm text-gray-700 mb-2 leading-relaxed">
                          {fileSizeLimitError.message}
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setFileSizeLimitError(null)}
                            className="px-3 py-1.5 bg-[#21C1B6] text-white rounded-md hover:bg-[#1AA49B] transition-colors text-xs font-medium"
                          >
                            OK
                          </button>
                        </div>
                      </div>
                      <button
                        onClick={() => setFileSizeLimitError(null)}
                        className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors p-0.5"
                        aria-label="Close"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div
            className="hidden lg:flex items-center justify-center w-3 cursor-col-resize bg-white border-x border-gray-200 hover:bg-[#eef5f2] transition-colors"
            onMouseDown={() => setIsResizingSplit(true)}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize chat panels"
            title="Drag to resize panels"
          >
            <div className="h-12 w-[3px] rounded-full bg-[#c9c2b4]" />
          </div>

          <div
            className="w-full flex flex-col h-1/2 lg:h-full bg-white min-h-0"
            style={
              isDesktopSplit
                ? { width: `${100 - splitLeftWidth}%`, flex: `0 0 ${100 - splitLeftWidth}%` }
                : undefined
            }
          >
            <div className="flex-1 min-h-0 p-4">
              <div className="h-[calc(100%-0px)] min-h-0">
                <DocumentViewer
                  selectedMessageId={selectedMessageId}
                  currentResponse={currentResponse}
                  animatedResponseContent={animatedResponseContent}
                  messages={sessionMessages}
                  handleCopyResponse={handleCopyResponse}
                  markdownOutputRef={markdownOutputRef}
                  isAnimatingResponse={isAnimatingResponse}
                  showResponseImmediately={showResponseImmediately}
                  formatDate={formatDate}
                  markdownComponents={markdownComponents}
                  responseContainerRef={responseRef}
                  exportContentRef={exportContentRef}
                  suggestedQuestions={suggestedQuestions}
                  onSuggestedQuestionClick={handleSuggestedQuestionClick}
                />
              </div>
            </div>
          </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ChatModelPage;

