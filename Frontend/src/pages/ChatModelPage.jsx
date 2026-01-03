import '../styles/AnalysisPage.css';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { API_BASE_URL } from '../config/apiConfig';
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
import DocumentList from '../components/AnalysisPage/DocumentList';
import DocumentViewer from '../components/AnalysisPage/DocumentViewer';
import ProgressStagesPopup from '../components/AnalysisPage/ProgressStagesPopup';
import UploadOptionsMenu from '../components/UploadOptionsMenu';
import googleDriveApi from '../services/googleDriveApi';
import apiService from '../services/api';
import { renderSecretPromptResponse, isStructuredJsonResponse } from '../utils/renderSecretPromptResponse';
import { convertJsonToPlainText } from '../utils/jsonToPlainText';
import { isUserFreeTier, FREE_TIER_MAX_FILE_SIZE_BYTES, FREE_TIER_MAX_FILE_SIZE_MB, formatFileSize } from '../utils/planUtils';
import {
  Search,
  Send,
  FileText,
  Trash2,
  RotateCcw,
  ArrowRight,
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
  Zap,
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
  const [fileId, setFileId] = useState(paramFileId || null);
  const [sessionId, setSessionId] = useState(paramSessionId || null);
  const [currentResponse, setCurrentResponse] = useState('');
  const [animatedResponseContent, setAnimatedResponseContent] = useState('');
  const [isAnimatingResponse, setIsAnimatingResponse] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [showSplitView, setShowSplitView] = useState(false);
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
 
  const [chatModelFiles, setChatModelFiles] = useState([]);
  const [chatModelHistory, setChatModelHistory] = useState([]);

  const fileInputRef = useRef(null);
  const dropdownRef = useRef(null);
  const responseRef = useRef(null);
  const markdownOutputRef = useRef(null);
  const animationFrameRef = useRef(null);
  const streamBufferRef = useRef('');
  const streamUpdateTimeoutRef = useRef(null);
  const streamReaderRef = useRef(null);
  const pollingIntervalRef = useRef(null);
  const batchPollingIntervalsRef = useRef({});
  const uploadIntervalRef = useRef(null);

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

  const uploadDocumentToChat = async (file) => {
    try {
      setIsChatUploading(true);
      setUploadProgress(0);
      setError(null);

      const token = getAuthToken();
      const formData = new FormData();
      formData.append('document', file);

      const headers = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const CHAT_MODEL_BASE_URL = API_BASE_URL;

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percentComplete = Math.round((e.loaded / e.total) * 100);
            setUploadProgress(percentComplete);
            console.log(`[uploadDocumentToChat] Upload progress: ${percentComplete}%`);
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const response = JSON.parse(xhr.responseText);
              console.log('[uploadDocumentToChat] Upload response:', response);
             
              let fileId = response.data?.file_id || response.file_id;
             
              if (!fileId) {
                console.error('[uploadDocumentToChat] No file_id found in response:', response);
                setError('No file_id returned from upload');
                setIsChatUploading(false);
                reject(new Error('No file_id returned from upload'));
                return;
              }
             
              console.log('[uploadDocumentToChat] Extracted file_id:', fileId);
             
              setUploadedFileId(fileId);
              setFileId(fileId);
              setUploadProgress(100);
             
              setTimeout(() => {
                setIsChatUploading(false);
                setSuccess('Document uploaded successfully! You can now ask questions about it.');
               
                setShowSplitView(true);
                setHasResponse(true);
               
                setStreamingStatus('ready');
                setStreamingMessage('Document ready. You can now ask questions about it.');
              }, 500);
             
              fetchChatModelFiles();
             
              resolve({ file_id: fileId, ...response });
            } catch (error) {
              console.error('[uploadDocumentToChat] Error parsing upload response:', error);
              console.error('[uploadDocumentToChat] Response text:', xhr.responseText);
              setError(`Failed to parse upload response: ${error.message}`);
              setIsChatUploading(false);
              reject(new Error(`Failed to parse upload response: ${error.message}`));
            }
          } else {
            let errorMessage = 'Upload failed';
            try {
              const errorData = JSON.parse(xhr.responseText);
              errorMessage = errorData.error || errorData.message || errorMessage;
            } catch (e) {
              if (xhr.status === 404) {
                errorMessage = `Endpoint not found (404). Please check if the server is running and the endpoint '/chat/upload-document' exists.`;
              } else {
                errorMessage = `Upload failed with status ${xhr.status}`;
              }
            }
            console.error('[uploadDocumentToChat] Upload failed:', {
              status: xhr.status,
              statusText: xhr.statusText,
              responseText: xhr.responseText,
              url: `${CHAT_MODEL_BASE_URL}/chat/upload-document`,
            });
            setError(errorMessage);
            setIsChatUploading(false);
            reject(new Error(errorMessage));
          }
        });

        xhr.addEventListener('error', () => {
          setError('Network error during upload');
          setIsChatUploading(false);
          reject(new Error('Network error during upload'));
        });

        xhr.addEventListener('abort', () => {
          setError('Upload cancelled');
          setIsChatUploading(false);
          reject(new Error('Upload cancelled'));
        });

        xhr.open('POST', `${CHAT_MODEL_BASE_URL}/chat/upload-document`);
        console.log('[uploadDocumentToChat] Uploading to:', `${CHAT_MODEL_BASE_URL}/chat/upload-document`);
        Object.keys(headers).forEach((key) => {
          xhr.setRequestHeader(key, headers[key]);
        });
        xhr.send(formData);
      });
    } catch (error) {
      console.error('[uploadDocumentToChat] Error:', error);
      setError(`Upload failed: ${error.message}`);
      setIsChatUploading(false);
      throw error;
    }
  };
 
  const getStatusMessage = (status) => {
    const statusMessages = {
      'initializing': 'Starting chat request...',
      'validating': 'Validating file access...',
      'fetching': 'Fetching previous conversation context...',
      'analyzing': 'Analyzing document and preparing context...',
      'generating': 'Generating response from AI...',
      'saving': 'Saving conversation to database...',
    };
    return statusMessages[status] || 'Processing...';
  };

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
      const response = await apiService.getChatModelHistory(fileId, sessionId);
      if (response.success && response.data?.history) {
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
        setChatModelHistory(history);
        setMessages(history);
        if (history.length > 0) {
          const lastMessage = history[history.length - 1];
          setSelectedMessageId(lastMessage.id);
          const rawAnswer = lastMessage.answer || '';
          const isStructured = lastMessage.used_secret_prompt && isStructuredJsonResponse(rawAnswer);
          const responseToDisplay = isStructured
            ? renderSecretPromptResponse(rawAnswer)
            : convertJsonToPlainText(rawAnswer);
          setCurrentResponse(responseToDisplay);
        }
      }
    } catch (error) {
      console.error('[fetchChatModelHistory] Error:', error);
      setError(`Failed to fetch chat history: ${error.message}`);
    }
  };

  const askQuestionToChat = async (question, fileId) => {
    try {
      setIsLoading(true);
      setIsGeneratingInsights(true);
      setError(null);
      setCurrentResponse('');
      streamBufferRef.current = '';
      setStreamingStatus('initializing');
      setStreamingMessage('Starting chat request...');

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

      let cleanFileId = fileId;
      if (fileId && typeof fileId === 'string') {
        cleanFileId = fileId.replace(/\{\{|\}\}/g, '').replace(/\{|\}/g, '').trim();
      }

      if (!cleanFileId) {
        throw new Error('No file_id available. Please upload a document first.');
      }

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

      await apiService.askChatModelQuestionStream(
        question.trim(),
        cleanFileId,
        sessionId,
        (text) => {
          if (text) {
            streamBufferRef.current += text;
           
            const currentText = streamBufferRef.current;
            setCurrentResponse(currentText);
            setAnimatedResponseContent(currentText);
           
            setMessages((prev) => {
              const updated = prev.map((msg) =>
                msg.id === messageId
                  ? { ...msg, answer: currentText, isStreaming: true }
                  : msg
              );
              return updated;
            });
           
            if (responseRef.current) {
              responseRef.current.scrollTop = responseRef.current.scrollHeight;
            }
           
            if (!streamingStatus || streamingStatus !== 'generating') {
              setStreamingStatus('generating');
              setStreamingMessage('Generating response from AI...');
            }
          }
        },
        (status, message) => {
          setStreamingStatus(status);
          setStreamingMessage(message || getStatusMessage(status));
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
          const finalResponse = streamBufferRef.current;
         
          if (doneData.session_id) {
            newSessionId = doneData.session_id;
          }
         
          setStreamingStatus(null);
          setStreamingMessage('');
         
          setMessages((prev) => {
            const updated = prev.map((msg) =>
              msg.id === messageId
                ? {
                    ...msg,
                    answer: finalResponse,
                    session_id: newSessionId,
                    isStreaming: false,
                  }
                : msg
            );
            return updated;
          });
         
          setSelectedMessageId(messageId);
          setSessionId(newSessionId);
          setCurrentResponse(finalResponse);
          setAnimatedResponseContent(finalResponse);
          setIsLoading(false);
          setIsGeneratingInsights(false);
          setSuccess('Question answered!');
         
          setStreamingStatus(null);
          setStreamingMessage('');
         
          if (responseRef.current) {
            setTimeout(() => {
              responseRef.current.scrollTop = responseRef.current.scrollHeight;
            }, 100);
          }
        },
        (errorMessage, details) => {
          console.error('[askQuestionToChat] Stream error:', errorMessage, details);
          setError(`Failed to get answer: ${errorMessage}`);
          setIsLoading(false);
          setIsGeneratingInsights(false);
          setStreamingStatus(null);
          setStreamingMessage('');
         
          setMessages((prev) => {
            return prev.filter((msg) => msg.id !== messageId);
          });
        }
      );
     
      return finalMetadata;
    } catch (error) {
      console.error('[askQuestionToChat] Error:', error);
      setError(`Failed to get answer: ${error.message}`);
      setIsLoading(false);
      setIsGeneratingInsights(false);
      setStreamingStatus(null);
      setStreamingMessage('');
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
      const response = await fetch(`${API_BASE_URL}/files/secrets?fetch=false`, {
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

      const response = await fetch(`${API_BASE_URL}/files/chat/stream`, {
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
          const finalResponse = streamBufferRef.current;
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
          animateResponse(finalResponse);
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;
         
          const data = line.replace(/^data: /, '').trim();
         
          if (data === '[PING]') {
            continue;
          }
         
          if (data === '[DONE]') {
            setIsLoading(false);
            const finalResponse = streamBufferRef.current;
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
            animateResponse(finalResponse);
            return;
          }

          try {
            const parsed = JSON.parse(data);
           
            if (parsed.type === 'metadata') {
              console.log('Stream metadata:', parsed);
              newSessionId = parsed.session_id || newSessionId;
            } else if (parsed.type === 'chunk') {
              streamBufferRef.current += parsed.text || '';
            } else if (parsed.type === 'done') {
              finalMetadata = parsed;
              const finalResponse = streamBufferRef.current;
              setCurrentResponse(finalResponse);
              setIsLoading(false);
              animateResponse(finalResponse);
            } else if (parsed.type === 'error') {
              setError(parsed.error);
              setIsLoading(false);
            }
          } catch (e) {
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
   
    const isFreeUser = isUserFreeTier();
    console.log('Is free user:', isFreeUser);
   
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'image/png',
      'image/jpeg',
      'image/tiff',
    ];
    
    const maxSize = isFreeUser ? FREE_TIER_MAX_FILE_SIZE_BYTES : 300 * 1024 * 1024;
    
    let hasFileSizeError = false;
    const validFiles = files.filter((file) => {
      if (!allowedTypes.includes(file.type)) {
        setError(`File "${file.name}" has an unsupported type.`);
        return false;
      }
      
      if (isFreeUser && file.size > maxSize) {
        const fileSizeFormatted = formatFileSize(file.size);
        console.log('File size limit exceeded:', { fileName: file.name, fileSize: fileSizeFormatted, maxSize: `${FREE_TIER_MAX_FILE_SIZE_MB} MB` });
        hasFileSizeError = true;
        setFileSizeLimitError({
          fileName: file.name,
          fileSize: fileSizeFormatted,
          maxSize: `${FREE_TIER_MAX_FILE_SIZE_MB} MB`
        });
        return false;
      } else if (!isFreeUser && file.size > maxSize) {
        setError(`File "${file.name}" is too large (max 300MB).`);
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
      const fileToUpload = validFiles[0];
      if (validFiles.length > 1) {
        setError(`Multiple files selected. Uploading "${fileToUpload.name}" only.`);
      }
     
      try {
        setDocumentData({
          name: fileToUpload.name,
          originalName: fileToUpload.name,
          size: fileToUpload.size,
          type: fileToUpload.type,
          uploadedAt: new Date().toISOString(),
        });
        const result = await uploadDocumentToChat(fileToUpload);
        console.log('[handleFileUpload] Document uploaded successfully:', result);
      } catch (error) {
        console.error('[handleFileUpload] Upload error:', error);
        setError(`Failed to upload document: ${error.message}`);
        setDocumentData(null);
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

      const response = await fetch(`${API_BASE_URL}/chat/google-drive/upload`, {
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
    console.log('[handleDropdownSelect] Total messages:', messages.length);
    console.log('[handleDropdownSelect] Messages with secret prompts:', messages.filter(m => m.used_secret_prompt).map(m => ({
      id: m.id,
      secret_id: m.secret_id,
      prompt_label: m.prompt_label,
      file_id: m.file_id
    })));
   
    const messagesForThisPrompt = messages.filter(
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
      try {
        setIsGeneratingInsights(true);
        setError(null);
        console.log('[handleSend] Triggering secret analysis with streaming:', {
          secretId: selectedSecretId,
          fileId,
          additionalInput: chatInput.trim(),
          promptLabel: promptLabel,
          llmName: selectedLlmName,
        });
       
        setCurrentResponse('');
        streamBufferRef.current = '';
       
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
          file_id: fileId,
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
          fileId,
          sessionId,
          (text) => {
            if (text) {
              streamBufferRef.current += text;
            }
          },
          (status, message) => {
            console.log('[Secret Prompt] Status:', status, message);
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
            const finalResponse = (doneData && doneData.answer) ? doneData.answer : (streamBufferRef.current || '');
            console.log('[Secret Prompt] Final response length:', finalResponse.length);
            console.log('[Secret Prompt] Response preview:', finalResponse.substring(0, 200));
           
            if (doneData && doneData.session_id) {
              newSessionId = doneData.session_id;
            }
           
            if (!finalResponse || finalResponse.trim().length === 0) {
              console.error('[Secret Prompt] Empty response received!');
              setError('Received empty response from server. Please try again.');
              setIsGeneratingInsights(false);
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
            animateResponse(responseToDisplay, true);
            setHasResponse(true);
            setSuccess('Analysis completed successfully!');
            setIsGeneratingInsights(false);
            setIsSecretPromptSelected(false);
            setActiveDropdown('Custom Query');
          },
          (error) => {
            console.error('[Secret Prompt] Error:', error);
            setError(`Analysis failed: ${error}`);
            setIsGeneratingInsights(false);
          },
          selectedSecretId,
          true,
          promptLabel,
          chatInput.trim() || '',
          selectedLlmName
        );
      } catch (error) {
        console.error('[handleSend] Analysis error:', error);
        if (error.message && error.message.includes('No content found')) {
          setError('Document is still processing. Please wait a few moments and try again.');
        } else {
          setError(`Analysis failed: ${error.message}`);
        }
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
          console.log('[handleSend] Using new chat ask API');
          console.log('[handleSend] file_id:', currentFileId);
          console.log('[handleSend] question:', chatInput.trim());
          await askQuestionToChat(chatInput, currentFileId);
        } else {
          setError('Please upload a document first before asking questions.');
          console.warn('[handleSend] No file_id available. uploadedFileId:', uploadedFileId, 'fileId:', fileId);
        }
      } catch (error) {
        console.error('[handleSend] Chat error:', error);
        setError(error.message || 'Failed to get answer. Please try again.');
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
    const newSessionId = `session-${Date.now()}`;
    setSessionId(newSessionId);
    setSuccess('New chat session started!');
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
    if (selectedMessageId && messages.length > 0 && currentResponse) {
      const selectedMessage = messages.find(msg => msg.id === selectedMessageId);
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
  }, [selectedMessageId, messages, currentResponse]);



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
        setSessionId(savedSessionId);
      } else {
        const newSessionId = `session-${Date.now()}`;
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
      if (savedFileId) setFileId(savedFileId);
      const savedProcessingStatus = localStorage.getItem('processingStatus');
      if (savedProcessingStatus) {
        const parsed = JSON.parse(savedProcessingStatus);
        setProcessingStatus(parsed);
        setProgressPercentage(parsed.processing_progress || 0);
      }
    } catch (error) {
      console.error('[AnalysisPage] Error restoring from localStorage:', error);
      if (!sessionId) {
        const newSessionId = `session-${Date.now()}`;
        setSessionId(newSessionId);
      }
    }

    if (location.state?.newChat) {
      clearAllChatData();
      window.history.replaceState({}, document.title);
    } else if (paramFileId && paramSessionId) {
      console.log('[ChatModelPage] Loading chat from URL params:', { paramFileId, paramSessionId });
      setFileId(paramFileId);
      setSessionId(paramSessionId);
      setShowSplitView(true);
      setHasResponse(true);
      fetchChatModelHistory(paramFileId, paramSessionId);
    } else if (paramFileId && !paramSessionId) {
      console.log('[ChatModelPage] Loading chat from fileId only:', { paramFileId });
      setFileId(paramFileId);
      setShowSplitView(true);
      setHasResponse(true);
      fetchChatModelHistory(paramFileId, null);
    } else if (location.state?.chat) {
      const chatData = location.state.chat;
      console.log('[ChatModelPage] Loading chat from location state:', chatData);
      if (chatData.file_id && chatData.session_id) {
        setFileId(chatData.file_id);
        setSessionId(chatData.session_id);
        setShowSplitView(true);
        setHasResponse(true);
        fetchChatHistory(chatData.file_id, chatData.session_id, chatData.id);
      } else if (chatData.session_id) {
        console.log('[AnalysisPage] Loading chat with session_id only:', chatData.session_id);
        setSessionId(chatData.session_id);
        setShowSplitView(true);
        setHasResponse(true);
        fetchChatHistoryBySessionId(chatData.session_id, chatData.id);
      } else {
        setError('Unable to load chat: Missing required information (session_id or file_id)');
      }
      window.history.replaceState({}, document.title);
    }
  }, [location.state, paramFileId, paramSessionId]);

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
        className="text-xl sm:text-2xl lg:text-3xl font-bold mb-4 sm:mb-6 mt-6 sm:mt-8 text-gray-900 border-b-2 border-gray-300 pb-2 sm:pb-3 analysis-page-ai-response break-words"
        {...props}
      />
    ),
    h2: ({ node, ...props }) => (
      <h2 className="text-lg sm:text-xl lg:text-2xl font-bold mb-4 sm:mb-5 mt-5 sm:mt-7 text-gray-900 border-b border-gray-200 pb-2 analysis-page-ai-response break-words" {...props} />
    ),
    h3: ({ node, ...props }) => (
      <h3 className="text-base sm:text-lg lg:text-xl font-semibold mb-3 sm:mb-4 mt-4 sm:mt-6 text-gray-800 analysis-page-ai-response break-words" {...props} />
    ),
    h4: ({ node, ...props }) => (
      <h4 className="text-sm sm:text-base lg:text-lg font-semibold mb-2 sm:mb-3 mt-3 sm:mt-5 text-gray-800 analysis-page-ai-response break-words" {...props} />
    ),
    h5: ({ node, ...props }) => (
      <h5 className="text-sm sm:text-base font-semibold mb-2 mt-3 sm:mt-4 text-gray-700 analysis-page-ai-response break-words" {...props} />
    ),
    h6: ({ node, ...props }) => (
      <h6 className="text-xs sm:text-sm font-semibold mb-2 mt-2 sm:mt-3 text-gray-700 analysis-page-ai-response break-words" {...props} />
    ),
    p: ({ node, ...props }) => (
      <p className="mb-3 sm:mb-4 leading-relaxed text-gray-800 text-sm sm:text-[15px] analysis-page-ai-response break-words" {...props} />
    ),
    strong: ({ node, ...props }) => <strong className="font-bold text-gray-900" {...props} />,
    em: ({ node, ...props }) => <em className="italic text-gray-800" {...props} />,
    ul: ({ node, ...props }) => <ul className="list-disc pl-6 mb-4 space-y-2 text-gray-800" {...props} />,
    ol: ({ node, ...props }) => <ol className="list-decimal pl-6 mb-4 space-y-2 text-gray-800" {...props} />,
    li: ({ node, ...props }) => <li className="leading-relaxed text-gray-800 analysis-page-ai-response" {...props} />,
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
        className="border-l-4 border-[#21C1B6] pl-3 sm:pl-4 py-2 my-3 sm:my-4 bg-[#E0F7F6] text-gray-700 italic rounded-r analysis-page-ai-response text-sm sm:text-base break-words"
        {...props}
      />
    ),
    code: ({ node, inline, className, children, ...props }) => {
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : '';
      if (inline) {
        return (
          <code
            className="bg-gray-100 text-red-600 px-1 sm:px-1.5 py-0.5 rounded text-xs sm:text-sm font-mono border border-gray-200 break-all"
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
          <pre className={`bg-gray-900 text-gray-100 p-2 sm:p-4 ${language ? 'rounded-b' : 'rounded'} overflow-x-auto`}>
            <code className="font-mono text-xs sm:text-sm" {...props}>
              {children}
            </code>
          </pre>
        </div>
      );
    },
    pre: ({ node, ...props }) => (
      <pre className="bg-gray-900 text-gray-100 p-2 sm:p-4 rounded my-3 sm:my-4 overflow-x-auto text-xs sm:text-sm" {...props} />
    ),
    table: ({ node, ...props }) => (
      <div className="my-4 sm:my-6 rounded-lg border border-gray-300 block max-w-full">
        <table className="border-collapse text-xs sm:text-sm w-full" {...props} />
      </div>
    ),
    thead: ({ node, ...props }) => <thead className="bg-gray-100" {...props} />,
    th: ({ node, ...props }) => (
      <th
        className="px-2 sm:px-3 py-2 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b border-r border-gray-300 whitespace-normal last:border-r-0 break-words"
        {...props}
      />
    ),
    tbody: ({ node, ...props }) => <tbody className="bg-white divide-y divide-gray-200" {...props} />,
    tr: ({ node, ...props }) => <tr className="hover:bg-gray-50 transition-colors" {...props} />,
    td: ({ node, ...props }) => (
      <td className="px-2 sm:px-3 py-2 text-xs sm:text-sm text-gray-800 border-b border-r border-gray-200 align-top last:border-r-0 break-words" {...props} />
    ),
    hr: ({ node, ...props }) => <hr className="my-6 border-t-2 border-gray-300" {...props} />,
    img: ({ node, ...props }) => <img className="max-w-full h-auto rounded-lg shadow-md my-4" alt="" {...props} />,
  };

  const getInputPlaceholder = () => {
    if (isSecretPromptSelected) {
      return `Analysis : ${activeDropdown}...`;
    }
    if (!fileId) {
      return 'Upload a document to get started';
    }
    if (processingStatus?.status && processingStatus.status !== 'processed' && progressPercentage < 100) {
      return `${processingStatus.current_operation || 'Processing document...'} (${Math.round(progressPercentage)}%)`;
    }
    return showSplitView ? 'Ask a question...' : 'Message Legal Assistant...';
  };

  return (
    <div className="flex flex-col lg:flex-row h-[90vh] bg-white overflow-hidden">
      {error && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 sm:left-auto sm:right-4 sm:translate-x-0 z-50 max-w-[90vw] sm:max-w-sm">
          <div className="bg-red-50 border border-red-200 text-red-700 px-3 sm:px-4 py-2 sm:py-3 rounded-lg shadow-lg flex items-start space-x-2">
            <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      {success && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 sm:left-auto sm:right-4 sm:translate-x-0 z-50 max-w-[90vw] sm:max-w-sm">
          <div className="bg-green-50 border border-green-200 text-green-700 px-3 sm:px-4 py-2 sm:py-3 rounded-lg shadow-lg flex items-center space-x-2">
            <CheckCircle className="h-5 w-5 flex-shrink-0" />
            <span className="text-sm">{success}</span>
            <button onClick={() => setSuccess(null)} className="ml-auto text-green-500 hover:text-green-700">
              <X className="h-4 w-4" />
            </button>
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
                  accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.tiff"
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
              
              {fileSizeLimitError && (
                <div className="mt-2 animate-fadeIn">
                  <div className="bg-[#E0F7F6] border border-[#21C1B6] rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-[#21C1B6] flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs sm:text-sm text-gray-700 mb-2 leading-relaxed">
                          <span className="font-semibold text-gray-900">{fileSizeLimitError.fileName}</span> ({fileSizeLimitError.fileSize}) exceeds the free plan limit of <span className="font-semibold text-[#21C1B6]">{fileSizeLimitError.maxSize}</span>.
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setFileSizeLimitError(null);
                              navigate('/subscription-plans');
                            }}
                            className="flex items-center px-3 py-1.5 bg-[#21C1B6] text-white rounded-md hover:bg-[#1AA49B] transition-colors text-xs font-medium"
                          >
                            <Zap className="h-3 w-3 mr-1.5" />
                            Upgrade Plan
                          </button>
                          <button
                            onClick={() => setFileSizeLimitError(null)}
                            className="px-3 py-1.5 text-gray-600 hover:text-gray-900 hover:bg-white/50 rounded-md transition-colors text-xs font-medium"
                          >
                            Dismiss
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
         
          {messages.length > 0 && (
            <div className="border-t border-gray-200 bg-white flex-shrink-0" style={{ height: '30vh', minHeight: '250px' }}>
              <div className="h-full flex flex-col">
                <div className="p-2 sm:p-3 border-b border-gray-200 flex-shrink-0">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm sm:text-base font-semibold text-gray-900 flex items-center">
                      <MessageSquare className="h-4 w-4 mr-2" />
                      Recent Questions
                    </h2>
                    <span className="text-xs text-gray-500">{messages.length} question{messages.length !== 1 ? 's' : ''}</span>
                  </div>
                </div>
               
                <div className="flex-1 overflow-y-auto px-2 sm:px-3 py-2 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-gray-100 [&::-webkit-scrollbar-thumb]:bg-gray-300">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {messages.slice(0, 9).map((msg, i) => (
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
                 
                  {messages.length > 9 && (
                    <div className="mt-2 text-center">
                      <button
                        onClick={() => setShowSplitView(true)}
                        className="text-xs text-[#21C1B6] hover:text-[#1AA49B] font-medium"
                      >
                        View all {messages.length} questions →
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
          <div className="w-full lg:w-2/5 border-r-0 lg:border-r border-b lg:border-b-0 border-gray-200 flex flex-col bg-white h-1/3 lg:h-full">
            <div className="p-2 sm:p-3 border-b border-black border-opacity-20">
              <div className="flex items-center justify-between mb-2 sm:mb-3">
                <h2 className="text-sm sm:text-base font-semibold text-gray-900">Questions</h2>
                <button
                  onClick={startNewChat}
                  className="px-3 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
                >
                  New Chat
                </button>
              </div>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search questions..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-gray-100 rounded-lg text-xs text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent"
                />
              </div>
            </div>
            <DocumentList
              uploadedDocuments={uploadedDocuments}
              fileId={fileId}
              setFileId={setFileId}
              setDocumentData={setDocumentData}
              formatFileSize={formatFileSize}
            />
           
            <div className="flex-1 overflow-y-auto px-3 py-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-gray-100 [&::-webkit-scrollbar-thumb]:bg-gray-300">
              <div className="space-y-1.5">
                <MessagesList
              messages={messages}
              selectedMessageId={selectedMessageId}
              handleMessageClick={handleMessageClick}
              displayLimit={displayLimit}
              showAllChats={showAllChats}
              setShowAllChats={setShowAllChats}
              isLoading={isLoading}
              highlightText={highlightText}
              formatDate={formatDate}
              searchQuery={searchQuery}
            />
              </div>
            </div>
            <div className="border-t border-gray-200 p-3 bg-white flex-shrink-0">
              {documentData && (
                <div className="mb-2 p-1.5 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex items-center space-x-1.5">
                    <FileCheck className="h-3 w-3 text-green-600" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-900 truncate">{documentData.originalName}</p>
                      <p className="text-xs text-gray-500">{formatFileSize(documentData.size)}</p>
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
                    accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.tiff"
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
              
              {fileSizeLimitError && (
                <div className="mt-2 animate-fadeIn">
                  <div className="bg-[#E0F7F6] border border-[#21C1B6] rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-[#21C1B6] flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs sm:text-sm text-gray-700 mb-2 leading-relaxed">
                          <span className="font-semibold text-gray-900">{fileSizeLimitError.fileName}</span> ({fileSizeLimitError.fileSize}) exceeds the free plan limit of <span className="font-semibold text-[#21C1B6]">{fileSizeLimitError.maxSize}</span>.
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setFileSizeLimitError(null);
                              navigate('/subscription-plans');
                            }}
                            className="flex items-center px-3 py-1.5 bg-[#21C1B6] text-white rounded-md hover:bg-[#1AA49B] transition-colors text-xs font-medium"
                          >
                            <Zap className="h-3 w-3 mr-1.5" />
                            Upgrade Plan
                          </button>
                          <button
                            onClick={() => setFileSizeLimitError(null)}
                            className="px-3 py-1.5 text-gray-600 hover:text-gray-900 hover:bg-white/50 rounded-md transition-colors text-xs font-medium"
                          >
                            Dismiss
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

          <div className="w-full lg:w-3/5 flex flex-col h-2/3 lg:h-full bg-gray-50">
            <div className="flex-1 p-2 sm:p-4 min-h-0">
              <div className="h-full flex flex-col">
                {(streamingStatus && streamingMessage) || (isLoading || isGeneratingInsights) ? (
                  <div className="flex-shrink-0 mb-4">
                    <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border-2 border-blue-200 shadow-lg animate-fade-in">
                      <div className="flex items-start space-x-3">
                        <Loader2 className="h-5 w-5 text-blue-600 animate-spin flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-base font-semibold text-blue-900 mb-1">
                            {streamingMessage || getStatusMessage(streamingStatus) || 'Processing your request...'}
                          </p>
                          <p className="text-sm text-blue-700 capitalize font-medium">
                            {streamingStatus ?
                              streamingStatus.replace(/_/g, ' ').split(' ').map(word =>
                                word.charAt(0).toUpperCase() + word.slice(1)
                              ).join(' ')
                              : (isGeneratingInsights ? 'Generating...' : 'Initializing...')}
                          </p>
                          <div className="flex items-center space-x-1 mt-2">
                            <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '0ms' }}></div>
                            <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '150ms' }}></div>
                            <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '300ms' }}></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="flex-1 min-h-0">
                  <DocumentViewer
                    selectedMessageId={selectedMessageId}
                    currentResponse={currentResponse}
                    animatedResponseContent={animatedResponseContent}
                    messages={messages}
                    handleCopyResponse={handleCopyResponse}
                    markdownOutputRef={markdownOutputRef}
                    isAnimatingResponse={isAnimatingResponse}
                    showResponseImmediately={showResponseImmediately}
                    formatDate={formatDate}
                    markdownComponents={markdownComponents}
                    responseContainerRef={responseRef}
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