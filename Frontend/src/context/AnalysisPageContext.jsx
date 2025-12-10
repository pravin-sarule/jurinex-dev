import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import DownloadPdf from '../components/DownloadPdf/DownloadPdf';
import {
  Search, Send, FileText, Layers, Trash2, RotateCcw,
  ArrowRight, ChevronRight, AlertTriangle, Clock, Loader2,
  Upload, Download, AlertCircle, CheckCircle, X, Eye, Quote, BookOpen, Copy,
  ChevronDown, Paperclip, MessageSquare, FileCheck, Bot
} from 'lucide-react';

const AnalysisPageContext = createContext();

export const useAnalysisPage = () => {
  const context = useContext(AnalysisPageContext);
  if (!context) {
    throw new Error('useAnalysisPage must be used within AnalysisPageProvider');
  }
  return context;
};

export const AnalysisPageProvider = ({ 
  children, 
  location, 
  paramFileId, 
  paramSessionId, 
  setIsSidebarHidden, 
  setIsSidebarCollapsed 
}) => {
  // ALL STATES
  const [activeDropdown, setActiveDropdown] = useState('Summary');
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [hasResponse, setHasResponse] = useState(false);
  const [isSecretPromptSelected, setIsSecretPromptSelected] = useState(false);
  
  const [documentData, setDocumentData] = useState(null);
  const [messages, setMessages] = useState([]);
  const [fileId, setFileId] = useState(paramFileId || null);
  const [sessionId, setSessionId] = useState(paramSessionId || null);
  const [processingStatus, setProcessingStatus] = useState(null);
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
  
  // ALL REFS
  const fileInputRef = useRef(null);
  const dropdownRef = useRef(null);
  const responseRef = useRef(null);
  const markdownOutputRef = useRef(null);
  const pollingIntervalRef = useRef(null);
  const animationFrameRef = useRef(null);

  // API CONFIG
  const API_BASE_URL = 'https://gateway-service-120280829617.asia-south1.run.app';
  
  // ✅ FUNCTION 1: getAuthToken
  const getAuthToken = () => {
    const tokenKeys = [
      'authToken', 'token', 'accessToken', 'jwt', 'bearerToken',
      'auth_token', 'access_token', 'api_token', 'userToken'
    ];
    for (const key of tokenKeys) {
      const token = localStorage.getItem(key);
      if (token) return token;
    }
    return null;
  };

  // ✅ FUNCTION 2: apiRequest
  const apiRequest = async (url, options = {}) => {
    try {
      const token = getAuthToken();
      const defaultHeaders = { 'Content-Type': 'application/json' };
      if (token) defaultHeaders['Authorization'] = `Bearer ${token}`;
      const headers = options.body instanceof FormData 
        ? (token ? { 'Authorization': `Bearer ${token}` } : {})
        : { ...defaultHeaders, ...options.headers };

      const response = await fetch(`${API_BASE_URL}${url}`, { ...options, headers });

      if (!response.ok) {
        let errorData;
        try { errorData = await response.json(); } catch { 
          errorData = { error: `HTTP error! status: ${response.status}` }; 
        }
        switch (response.status) {
          case 401: throw new Error('Authentication required. Please log in again.');
          case 403: throw new Error(errorData.error || 'Access denied.');
          case 404: throw new Error('Resource not found.');
          case 413: throw new Error('File too large.');
          case 415: throw new Error('Unsupported file type.');
          case 429: throw new Error('Too many requests.');
          default: throw new Error(errorData.error || errorData.message || `Request failed with status ${response.status}`);
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

  // ✅ FUNCTION 3: fetchSecrets
  const fetchSecrets = async () => {
    try {
      setIsLoadingSecrets(true);
      setError(null);
      const token = getAuthToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch(`${API_BASE_URL}/files/secrets?fetch=false`, { method: 'GET', headers });
      if (!response.ok) throw new Error(`Failed to fetch secrets: ${response.status}`);

      const secretsData = await response.json();
      console.log('[fetchSecrets] Raw secrets data:', secretsData);
      setSecrets(secretsData || []);
      
      if (secretsData && secretsData.length > 0) {
        setActiveDropdown(secretsData[0].name);
        setSelectedSecretId(secretsData[0].id);
        setSelectedLlmName(secretsData[0].llm_name);
      }
    } catch (error) {
      console.error('Error fetching secrets:', error);
      setError(`Failed to load analysis prompts: ${error.message}`);
    } finally {
      setIsLoadingSecrets(false);
    }
  };

  // ✅ FUNCTION 4: batchUploadDocuments
  const batchUploadDocuments = async (files) => {
    console.log('Starting batch upload for', files.length, 'files');
    setIsUploading(true);
    setError(null);
    
    const initialBatchUploads = files.map((file, index) => ({
      id: `${file.name}-${Date.now()}-${index}`,
      file: file,
      fileName: file.name,
      fileSize: file.size,
      progress: 0,
      status: 'pending',
      fileId: null,
      error: null
    }));
    
    setBatchUploads(initialBatchUploads);
    setShowSplitView(true);

    try {
      const formData = new FormData();
      files.forEach(file => formData.append('document', file));
      setBatchUploads(prev => prev.map(upload => ({ ...upload, status: 'uploading', progress: 10 })));

      const token = getAuthToken();
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch(`${API_BASE_URL}/files/batch-upload`, { method: 'POST', headers, body: formData });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || errorData.message || `Upload failed with status ${response.status}`;
        
        // Check for subscription-related errors
        const isSubscriptionError = response.status === 500 || 
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

      const data = await response.json();
      console.log('Batch upload response:', data);

      if (data.uploaded_files && Array.isArray(data.uploaded_files)) {
        data.uploaded_files.forEach((uploadedFile, index) => {
          const matchingUpload = initialBatchUploads[index];
          
          if (uploadedFile.error) {
            setBatchUploads(prev => prev.map(upload =>
              upload.id === matchingUpload.id
                ? { ...upload, status: 'failed', error: uploadedFile.error, progress: 0 }
                : upload
            ));
          } else {
            const fileId = uploadedFile.file_id;
            
            setBatchUploads(prev => prev.map(upload =>
              upload.id === matchingUpload.id
                ? { ...upload, status: 'uploaded', fileId, progress: 100 }
                : upload
            ));

            setUploadedDocuments(prev => [...prev, {
              id: fileId,
              fileName: uploadedFile.filename || matchingUpload.fileName,
              fileSize: matchingUpload.fileSize,
              uploadedAt: new Date().toISOString(),
              status: 'batch_processing',
              operationName: uploadedFile.operation_name
            }]);

            if (index === 0) {
              setFileId(fileId);
              setDocumentData({
                id: fileId,
                title: matchingUpload.fileName,
                originalName: matchingUpload.fileName,
                size: matchingUpload.fileSize,
                type: matchingUpload.file.type,
                uploadedAt: new Date().toISOString(),
                status: 'batch_processing'
              });
              startProcessingStatusPolling(fileId);
            }
          }
        });

        const successCount = data.uploaded_files.filter(f => !f.error).length;
        const failCount = data.uploaded_files.filter(f => f.error).length;

        if (successCount > 0) setSuccess(`${successCount} document(s) uploaded successfully!`);
        if (failCount > 0) setError(`${failCount} document(s) failed to upload.`);
      }
    } catch (error) {
      console.error('Batch upload error:', error);
      
      // Check if this is a subscription error
      if (error.isSubscriptionError) {
        setError('Subscription required: You need an active subscription plan to upload and process documents. Please visit the Subscription Plans page to continue.');
        setBatchUploads(prev => prev.map(upload => ({
          ...upload, status: 'failed', error: 'Subscription required'
        })));
      } else {
        setError(`Batch upload failed: ${error.message}`);
        setBatchUploads(prev => prev.map(upload => ({
          ...upload, status: 'failed', error: error.message
        })));
      }
    } finally {
      setIsUploading(false);
    }
  };

  // ✅ FUNCTION 5: getProcessingStatus
  const getProcessingStatus = async (fileId) => {
    try {
      const response = await apiRequest(`/files/${fileId}/status`);
      return response;
    } catch (error) {
      console.error('Error fetching processing status:', error);
      throw error;
    }
  };

  // ✅ FUNCTION 6: startProcessingStatusPolling
  const startProcessingStatusPolling = (fileId) => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    pollingIntervalRef.current = setInterval(async () => {
      try {
        const status = await getProcessingStatus(fileId);
        setProcessingStatus(status);

        if (status.status === 'completed' || status.status === 'failed') {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
          
          if (status.status === 'completed') {
            setSuccess('Document processing completed!');
            setDocumentData(prev => ({ ...prev, status: 'completed' }));
          } else {
            setError('Document processing failed.');
          }
        }
      } catch (error) {
        console.error('Polling error:', error);
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
        setError('Failed to check processing status.');
      }
    }, 3000);
  };

  // ✅ FUNCTION 7: animateResponse - ChatGPT-style word-by-word animation
  const animateResponse = (responseText) => {
    // Handle empty or invalid responses
    if (!responseText || typeof responseText !== 'string') {
      setIsAnimatingResponse(false);
      setAnimatedResponseContent(responseText || '');
      return;
    }

    // Cancel any existing animation
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      clearTimeout(animationFrameRef.current);
    }

    setIsAnimatingResponse(true);
    setAnimatedResponseContent('');

    // Split text into words while preserving spaces and newlines
    // This regex splits on word boundaries but keeps the separators
    const words = responseText.split(/(\s+)/);
    let currentIndex = 0;
    let displayedText = '';

    // If response is very short, show it immediately
    if (words.length <= 3) {
      setIsAnimatingResponse(false);
      setAnimatedResponseContent(responseText);
      return;
    }

    const animateWord = () => {
      if (currentIndex < words.length) {
        // Add the next word to displayed text
        displayedText += words[currentIndex];
        setAnimatedResponseContent(displayedText);
        currentIndex++;

        // Calculate delay based on word length and type
        // Longer words get slightly more time, punctuation gets less
        const word = words[currentIndex - 1];
        let delay = 15; // Base delay in milliseconds (faster for smoother feel)
        
        if (word.trim().length === 0) {
          // For whitespace/newlines, use minimal delay
          delay = 3;
        } else if (word.length > 15) {
          // Very long words get a bit more time
          delay = 25;
        } else if (word.length > 10) {
          // Longer words get slightly more time
          delay = 20;
        } else if (/[.!?]\s*$/.test(word)) {
          // Sentences ending with punctuation get a pause (like ChatGPT)
          delay = 40;
        } else if (/[,;:]\s*$/.test(word)) {
          // Commas and semicolons get a small pause
          delay = 20;
        } else if (/^[#*`\-]/.test(word)) {
          // Markdown syntax characters render quickly
          delay = 8;
        }

        // Continue animation with calculated delay
        animationFrameRef.current = setTimeout(animateWord, delay);
      } else {
        // Animation complete
        setIsAnimatingResponse(false);
        setAnimatedResponseContent(responseText);
        animationFrameRef.current = null;
      }
    };

    // Start animation with a small initial delay for smoother start
    animationFrameRef.current = setTimeout(animateWord, 20);
  };

  // ✅ FUNCTION 8: showResponseImmediately
  const showResponseImmediately = (responseText) => {
    // Cancel any ongoing animation
    if (animationFrameRef.current) {
      clearTimeout(animationFrameRef.current);
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setIsAnimatingResponse(false);
    setAnimatedResponseContent(responseText);
    setCurrentResponse(responseText);
  };

  // ✅ FUNCTION 8.5: stopGeneration - Stop the animation and show full response
  const stopGeneration = () => {
    if (isAnimatingResponse && currentResponse) {
      showResponseImmediately(currentResponse);
    }
  };

  // ✅ FUNCTION 9: chatWithDocument
  const chatWithDocument = async (userMessage, secretId = selectedSecretId) => {
    if (!fileId || !secretId) {
      setError('Please upload a document and select an analysis prompt.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await apiRequest('/files/chat', {
        method: 'POST',
        body: JSON.stringify({
          file_id: fileId,
          session_id: sessionId || null,
          message: userMessage,
          secret_id: secretId
        })
      });

      const aiMessage = {
        id: Date.now(),
        type: 'ai',
        content: response.response,
        timestamp: new Date().toISOString(),
        secret_id: secretId
      };

      setMessages(prev => [...prev, { type: 'user', content: userMessage, timestamp: new Date().toISOString() }, aiMessage]);
      setCurrentResponse(response.response);
      animateResponse(response.response);
      setHasResponse(true);
      setChatInput('');

      if (!sessionId) {
        const newSessionId = response.session_id || Date.now().toString();
        setSessionId(newSessionId);
      }
    } catch (error) {
      setError(`Chat failed: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // ✅ FUNCTION 10: handleFileUpload
  const handleFileUpload = async (file) => {
    setIsUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('document', file);

      const response = await apiRequest('/files/upload', { method: 'POST', body: formData });
      
      setFileId(response.file_id);
      setDocumentData({
        id: response.file_id,
        title: file.name,
        originalName: file.name,
        size: file.size,
        type: file.type,
        uploadedAt: new Date().toISOString(),
        status: 'processing'
      });

      setSuccess('File uploaded successfully!');
      startProcessingStatusPolling(response.file_id);
    } catch (error) {
      setError(`Upload failed: ${error.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  // ✅ FUNCTION 11: handleDropdownSelect
  const handleDropdownSelect = (secret) => {
    setActiveDropdown(secret.name);
    setSelectedSecretId(secret.id);
    setSelectedLlmName(secret.llm_name);
    setShowDropdown(false);
    setIsSecretPromptSelected(true);
  };

  // ✅ FUNCTION 12: handleChatInputChange
  const handleChatInputChange = (e) => {
    setChatInput(e.target.value);
  };

  // ✅ FUNCTION 13: handleSend
  const handleSend = () => {
    if (!chatInput.trim()) return;
    chatWithDocument(chatInput);
  };

  // ✅ FUNCTION 14: handleMessageClick
  const handleMessageClick = (messageId) => {
    setSelectedMessageId(messageId === selectedMessageId ? null : messageId);
  };

  // ✅ FUNCTION 15: clearAllChatData
  const clearAllChatData = () => {
    setMessages([]);
    setCurrentResponse('');
    setAnimatedResponseContent('');
    setHasResponse(false);
    setSessionId(null);
    localStorage.removeItem('messages');
    localStorage.removeItem('currentResponse');
    localStorage.removeItem('animatedResponseContent');
    localStorage.removeItem('hasResponse');
    localStorage.removeItem('sessionId');
  };

  // ✅ FUNCTION 16: startNewChat
  const startNewChat = () => {
    clearAllChatData();
    setSessionId(Date.now().toString());
  };

  // ✅ FUNCTION 17: formatFileSize
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // ✅ FUNCTION 18: formatDate
  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString();
  };

  // ✅ FUNCTION 19: handleCopyResponse
  const handleCopyResponse = async () => {
    try {
      await navigator.clipboard.writeText(currentResponse);
      setSuccess('Response copied to clipboard!');
    } catch (error) {
      setError('Failed to copy response.');
    }
  };

  // ✅ FUNCTION 20: highlightText
  const highlightText = (text, query) => {
    if (!query) return text;
    const regex = new RegExp(`(${query})`, 'gi');
    return text.replace(regex, '<mark class="bg-yellow-200 px-1 rounded">$1</mark>');
  };

  // ✅ MARKDOWN COMPONENTS (YOUR CSS WORKS PERFECTLY)
  const markdownComponents = {
    h1: ({node, ...props}) => (
      <h1 className="text-3xl font-bold mb-6 mt-8 text-gray-900 border-b-2 border-gray-300 pb-3 analysis-page-ai-response" {...props} />
    ),
    h2: ({node, ...props}) => (
      <h2 className="text-2xl font-bold mb-5 mt-7 text-gray-900 border-b border-gray-200 pb-2 analysis-page-ai-response" {...props} />
    ),
    h3: ({node, ...props}) => (
      <h3 className="text-xl font-semibold mb-4 mt-6 text-gray-800 analysis-page-ai-response" {...props} />
    ),
    p: ({node, ...props}) => (
      <p className="mb-4 leading-relaxed text-gray-800 text-[15px] analysis-page-ai-response" {...props} />
    ),
    table: ({node, ...props}) => (
      <div className="overflow-x-auto my-6 rounded-lg border border-gray-300">
        <table className="min-w-full divide-y divide-gray-300 analysis-table" {...props} />
      </div>
    ),
    th: ({node, ...props}) => (
      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b border-gray-300" {...props} />
    ),
    td: ({node, ...props}) => <td className="px-4 py-3 text-sm text-gray-800 border-b border-gray-200" {...props} />,
    code: ({node, inline, ...props}) => (
      inline 
        ? <code className="bg-gray-100 text-red-600 px-1.5 py-0.5 rounded text-sm font-mono" {...props} />
        : <pre className="bg-gray-900 text-gray-100 p-4 rounded my-4 overflow-x-auto" {...props} />
    ),
    blockquote: ({node, ...props}) => (
      <blockquote className="border-l-4 border-blue-500 pl-4 py-2 my-4 bg-blue-50 text-gray-700 italic rounded-r analysis-page-ai-response" {...props} />
    ),
  };

  // ALL USE EFFECTS
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
      if (animationFrameRef.current) {
        // Handle both setTimeout and requestAnimationFrame
        if (typeof animationFrameRef.current === 'number') {
          clearTimeout(animationFrameRef.current);
          cancelAnimationFrame(animationFrameRef.current);
        }
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
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => { fetchSecrets(); }, []);

  useEffect(() => {
    if (showSplitView) {
      setIsSidebarHidden(false);
      setIsSidebarCollapsed(true);
    } else if (hasResponse) {
      setIsSidebarHidden(false);
      setIsSidebarCollapsed(false);
    }
  }, [hasResponse, showSplitView, setIsSidebarHidden, setIsSidebarCollapsed]);

  useEffect(() => { if (sessionId) localStorage.setItem('sessionId', sessionId); }, [sessionId]);
  useEffect(() => { localStorage.setItem('messages', JSON.stringify(messages)); }, [messages]);
  useEffect(() => {
    if (currentResponse) {
      localStorage.setItem('currentResponse', currentResponse);
      localStorage.setItem('animatedResponseContent', animatedResponseContent);
    }
  }, [currentResponse, animatedResponseContent]);

  // MAIN LOADING EFFECT
  useEffect(() => {
    const initializePage = async () => {
      const storedMessages = localStorage.getItem('messages');
      const storedResponse = localStorage.getItem('currentResponse');
      const storedAnimated = localStorage.getItem('animatedResponseContent');
      const storedHasResponse = localStorage.getItem('hasResponse');
      const storedSessionId = localStorage.getItem('sessionId');
      const storedFileId = localStorage.getItem('fileId');
      const storedDocumentData = localStorage.getItem('documentData');

      if (storedMessages) setMessages(JSON.parse(storedMessages));
      if (storedResponse) setCurrentResponse(storedResponse);
      if (storedAnimated) setAnimatedResponseContent(storedAnimated);
      if (storedHasResponse === 'true') setHasResponse(true);
      if (storedSessionId) setSessionId(storedSessionId);
      if (storedFileId) setFileId(storedFileId);
      if (storedDocumentData) setDocumentData(JSON.parse(storedDocumentData));

      if (paramFileId) {
        setFileId(paramFileId);
        setIsLoading(true);
        try {
          const status = await getProcessingStatus(paramFileId);
          setProcessingStatus(status);
          setDocumentData({
            id: paramFileId,
            status: status.status,
            uploadedAt: new Date().toISOString()
          });
          if (status.status === 'completed') {
            setSuccess('Document ready for analysis!');
          }
        } catch (error) {
          setError('Failed to load document status.');
        } finally {
          setIsLoading(false);
        }
      }
    };

    initializePage();
  }, [paramFileId]);

  // CONTEXT VALUE
  const value = {
    activeDropdown, isLoading, isGeneratingInsights, isUploading, error, success, hasResponse, 
    isSecretPromptSelected, documentData, messages, fileId, sessionId, processingStatus, 
    currentResponse, animatedResponseContent, isAnimatingResponse, chatInput, showSplitView, 
    searchQuery, selectedMessageId, displayLimit, showAllChats, showDropdown, secrets, 
    isLoadingSecrets, selectedSecretId, selectedLlmName, batchUploads, uploadedDocuments,
    
    setActiveDropdown, setIsLoading, setIsGeneratingInsights, setIsUploading, setError, 
    setSuccess, setHasResponse, setIsSecretPromptSelected, setDocumentData, setMessages, 
    setFileId, setSessionId, setProcessingStatus, setCurrentResponse, setAnimatedResponseContent, 
    setIsAnimatingResponse, setChatInput, setShowSplitView, setSearchQuery, setSelectedMessageId, 
    setDisplayLimit, setShowAllChats, setShowDropdown, setSecrets, setIsLoadingSecrets, 
    setSelectedSecretId, setSelectedLlmName, setBatchUploads, setUploadedDocuments,
    
    fileInputRef, dropdownRef, responseRef, markdownOutputRef,
    
    getAuthToken, apiRequest, fetchSecrets, batchUploadDocuments, getProcessingStatus, 
    startProcessingStatusPolling, animateResponse, showResponseImmediately, stopGeneration, chatWithDocument, 
    handleFileUpload, handleDropdownSelect, handleChatInputChange, handleSend, handleMessageClick, 
    clearAllChatData, startNewChat, formatFileSize, formatDate, handleCopyResponse, highlightText,
    
    markdownComponents, DownloadPdf, ReactMarkdown, remarkGfm, rehypeRaw, rehypeSanitize,
    icons: { Search, Send, FileText, Layers, Trash2, RotateCcw, ArrowRight, ChevronRight, 
             AlertTriangle, Clock, Loader2, Upload, Download, AlertCircle, CheckCircle, X, 
             Eye, Quote, BookOpen, Copy, ChevronDown, Paperclip, MessageSquare, FileCheck, Bot }
  };

  return (
    <AnalysisPageContext.Provider value={value}>
      {children}
    </AnalysisPageContext.Provider>
  );
};

