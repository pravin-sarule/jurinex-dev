import React, { useState, useEffect, useContext, useRef, useMemo, useCallback, startTransition } from "react";
import { FileManagerContext } from "../../context/FileManagerContext";
import documentApi from "../../services/documentApi";
import { API_BASE_URL, GATEWAY_BASE_URL } from "../../config/apiConfig";
import {
  Plus,
  Search,
  BookOpen,
  ChevronDown,
  MoreVertical,
  MessageSquare,
  Loader2,
  Send,
  Copy,
  Check,
  Square,
  Trash2,
  FileText,
  X,
  ArrowRight,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { SidebarContext } from "../../context/SidebarContext";
import DownloadPdf from "../DownloadPdf/DownloadPdf";
import { toast } from "react-toastify";
import "../../styles/ChatInterface.css";
import CitationsPanel from "../AnalysisPage/CitationsPanel";
import apiService from "../../services/api";
import { convertJsonToPlainText } from "../../utils/jsonToPlainText";
import { renderSecretPromptResponse, isStructuredJsonResponse } from "../../utils/renderSecretPromptResponse";





















































































































































































































































































































    
        
        
          
            
            
              
              
                
                
                
              
              
            
        
        


















              
          





















































































































































































 


 
 







 









 
 




 




















































































































































































const ChatInterface = () => {
  const {
    selectedFolder,
    setChatSessions,
    selectedChatSessionId,
    setSelectedChatSessionId,
    setHasAiResponse,
  } = useContext(FileManagerContext);
  const { setForceSidebarCollapsed } = useContext(SidebarContext);
  const [currentChatHistory, setCurrentChatHistory] = useState([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [chatError, setChatError] = useState(null);
  const [chatInput, setChatInput] = useState("");
  const [animatedResponseContent, setAnimatedResponseContent] = useState("");
  const [thinkingContent, setThinkingContent] = useState("");
  const [currentStatus, setCurrentStatus] = useState(null);
  const [isAnimatingResponse, setIsAnimatingResponse] = useState(false);
  const [selectedMessageId, setSelectedMessageId] = useState(null);
  const [hasResponse, setHasResponse] = useState(false);
  const [secrets, setSecrets] = useState([]);
  const [isLoadingSecrets, setIsLoadingSecrets] = useState(false);
  const [selectedSecretId, setSelectedSecretId] = useState(null);
  const [selectedLlmName, setSelectedLlmName] = useState(null);
  const [activeDropdown, setActiveDropdown] = useState("Custom Query");
  const [showDropdown, setShowDropdown] = useState(false);
  const [isSecretPromptSelected, setIsSecretPromptSelected] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [needsHorizontalScroll, setNeedsHorizontalScroll] = useState(false);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  const [showCitations, setShowCitations] = useState(false);
  const [citations, setCitations] = useState([]);
  const [loadingCitations, setLoadingCitations] = useState(false);
  const [documentViewer, setDocumentViewer] = useState({ open: false, url: null, filename: null, page: null, loading: false, error: null });
  const [isSmallScreen, setIsSmallScreen] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < 1024;
  });
  const [openChatMenuId, setOpenChatMenuId] = useState(null);

  const responseHasTable = useMemo(() => {
    if (!animatedResponseContent) return false;
    const htmlTablePattern = /<table/i.test(animatedResponseContent);
    const markdownTablePattern = /(^|\n)\s*\|.+\|\s*($|\n)/.test(animatedResponseContent);
    return htmlTablePattern || markdownTablePattern;
  }, [animatedResponseContent]);

  const formattedResponseContent = useMemo(() => {
    const rawResponse = animatedResponseContent || '';
    if (!rawResponse) return '';
    
    const isStructured = isStructuredJsonResponse(rawResponse);
    
    if (isStructured) {
      return renderSecretPromptResponse(rawResponse);
    }
    
    return convertJsonToPlainText(rawResponse);
  }, [animatedResponseContent]);

  const shouldShowHorizontalScrollbar = useMemo(() => {
    return isSmallScreen && responseHasTable && needsHorizontalScroll;
  }, [isSmallScreen, responseHasTable, needsHorizontalScroll]);
  const responseRef = useRef(null);
  const dropdownRef = useRef(null);
  const completeResponseRef = useRef(null);
  const animationFrameRef = useRef(null);
  const markdownOutputRef = useRef(null);
  const horizontalScrollRef = useRef(null);
  const stickyScrollbarRef = useRef(null);
  const streamBufferRef = useRef('');
  const streamThinkingRef = useRef('');
  const streamUpdateTimeoutRef = useRef(null);
  const streamReaderRef = useRef(null);
  const chatMenuRefs = useRef({});
  const panelStatesSetRef = useRef(false);
  const fetchedFoldersRef = useRef(new Set());

  const getAuthToken = () => {
    const tokenKeys = [
      "authToken",
      "token",
      "accessToken",
      "jwt",
      "bearerToken",
      "auth_token",
      "access_token",
      "api_token",
      "userToken",
    ];
    for (const key of tokenKeys) {
      const token = localStorage.getItem(key);
      if (token) return token;
    }
    return null;
  };

  const fetchDocumentUrl = async (fileId, pageNumber = null, token) => {
    const GATEWAY_URL = GATEWAY_BASE_URL;
    
    let url = pageNumber
      ? `${GATEWAY_URL}/docs/file/${fileId}/view?page=${pageNumber}`
      : `${GATEWAY_URL}/docs/file/${fileId}/view`;
    
    console.log('[Document URL] Fetching from gateway:', url);
    
    let response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok && response.status === 404) {
      console.log('[Document URL] Primary gateway endpoint failed, trying fallback...');
      url = pageNumber
        ? `${GATEWAY_URL}/docs/${fileId}/view?page=${pageNumber}`
        : `${GATEWAY_URL}/docs/${fileId}/view`;
      
      console.log('[Document URL] Trying fallback gateway endpoint:', url);
      
      response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
    }
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || errorData.error || `Failed to fetch document: ${response.status} ${response.statusText}`);
    }
    
    return await response.json();
  };

  const openDocumentAtPage = async (fileId, pageNumber, filename, token) => {
    try {
      const documentData = await fetchDocumentUrl(fileId, pageNumber, token);
      
      const urlToOpen = documentData.viewUrlWithPage
        || (pageNumber ? `${documentData.viewUrl}#page=${pageNumber}` : documentData.viewUrl)
        || documentData.signedUrl;
      
      if (!urlToOpen) {
        throw new Error('No view URL available in response');
      }
      
      setDocumentViewer({
        open: true,
        url: urlToOpen,
        filename: filename || documentData.document?.name || 'Document',
        page: pageNumber,
        loading: false
      });
    } catch (error) {
      console.error('[Document] Error opening document:', error);
      setDocumentViewer({
        open: true,
        url: null,
        filename: filename || 'Document',
        page: pageNumber,
        loading: false,
        error: error.message || 'Failed to load document'
      });
    }
  };

  const handleCopyResponse = async () => {
    try {
      await navigator.clipboard.writeText(animatedResponseContent);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
      alert("Failed to copy to clipboard");
    }
  };

  const skipAnimation = () => {
    console.log('[ChatInterface] skipAnimation called');
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      clearTimeout(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    let completeResponse = '';
    
    if (completeResponseRef.current) {
      completeResponse = completeResponseRef.current;
      console.log('[ChatInterface] skipAnimation: Found complete response in ref, length:', completeResponse.length);
    }
    
    if (!completeResponse && selectedMessageId) {
      const selectedMessage = currentChatHistory.find(msg => msg.id === selectedMessageId);
      if (selectedMessage) {
        const rawResponse = selectedMessage.response || selectedMessage.answer || selectedMessage.message || "";
        if (rawResponse) {
          const isStructured = isStructuredJsonResponse(rawResponse);
          completeResponse = isStructured
            ? renderSecretPromptResponse(rawResponse)
            : convertJsonToPlainText(rawResponse);
          console.log('[ChatInterface] skipAnimation: Found response in message, length:', completeResponse.length);
        }
      }
    }
    
    if (!completeResponse && streamBufferRef.current) {
      const rawResponse = streamBufferRef.current;
      if (rawResponse) {
        const isStructured = isStructuredJsonResponse(rawResponse);
        completeResponse = isStructured
          ? renderSecretPromptResponse(rawResponse)
          : convertJsonToPlainText(rawResponse);
        console.log('[ChatInterface] skipAnimation: Found response in streamBufferRef, length:', completeResponse.length);
      }
    }
    
    if (!completeResponse && formattedResponseContent) {
      completeResponse = formattedResponseContent;
      console.log('[ChatInterface] skipAnimation: Using formattedResponseContent, length:', completeResponse.length);
    }
    
    if (completeResponse) {
      setAnimatedResponseContent(completeResponse);
      setIsAnimatingResponse(false);
      setIsGenerating(false);
      completeResponseRef.current = null;
      console.log('[ChatInterface] skipAnimation: Animation skipped, complete response displayed');
    } else {
      console.warn('[ChatInterface] skipAnimation: No response found to skip to');
    }
  };

  useEffect(() => {
    const horizontalElement = horizontalScrollRef.current;
    const contentElement = markdownOutputRef?.current;

    if (!horizontalElement || !contentElement) return undefined;

    const updateScrollbarState = () => {
      const scrollWidth = contentElement.scrollWidth;
      const clientWidth = horizontalElement.clientWidth;
      const needsScroll = scrollWidth > clientWidth + 1;

      setNeedsHorizontalScroll(needsScroll);
      if (needsScroll) {
        setScrollbarWidth(scrollWidth);
      }
    };

    updateScrollbarState();

    const resizeObserver = new ResizeObserver(updateScrollbarState);
    resizeObserver.observe(contentElement);
    resizeObserver.observe(horizontalElement);
    window.addEventListener("resize", updateScrollbarState);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateScrollbarState);
    };
  }, [selectedMessageId, animatedResponseContent, hasResponse]);

  useEffect(() => {
    if (!needsHorizontalScroll) return undefined;

    const horizontalElement = horizontalScrollRef.current;
    const stickyElement = stickyScrollbarRef.current;

    if (!horizontalElement || !stickyElement) return undefined;

    const syncSticky = () => {
      stickyElement.scrollLeft = horizontalElement.scrollLeft;
    };

    const syncContent = () => {
      horizontalElement.scrollLeft = stickyElement.scrollLeft;
    };

    stickyElement.scrollLeft = horizontalElement.scrollLeft;
    horizontalElement.addEventListener("scroll", syncSticky);
    stickyElement.addEventListener("scroll", syncContent);

    return () => {
      horizontalElement.removeEventListener("scroll", syncSticky);
      stickyElement.removeEventListener("scroll", syncContent);
    };
  }, [needsHorizontalScroll, selectedMessageId]);

  useEffect(() => {
    const handleResize = () => {
      setIsSmallScreen(window.innerWidth < 1024);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const fetchSecrets = async () => {
    try {
      setIsLoadingSecrets(true);
      setChatError(null);
      const token = getAuthToken();
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const response = await fetch(`${API_BASE_URL}/files/secrets?fetch=true`, {
        method: "GET",
        headers,
      });
      if (!response.ok) throw new Error(`Failed to fetch secrets: ${response.status}`);
      const secretsData = await response.json();
      setSecrets(secretsData || []);
      setActiveDropdown("Custom Query");
      setSelectedSecretId(null);
      setSelectedLlmName(null);
      setIsSecretPromptSelected(false);
    } catch (error) {
      console.error("Error fetching secrets:", error);
      setChatError(`Failed to load analysis prompts: ${error.message}`);
    } finally {
      setIsLoadingSecrets(false);
    }
  };

  const fetchSecretValue = async (secretId) => {
    try {
      const existingSecret = secrets.find((secret) => secret.id === secretId);
      if (existingSecret?.value) return existingSecret.value;
      const token = getAuthToken();
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const response = await fetch(`${API_BASE_URL}/files/secrets/${secretId}`, {
        method: "GET",
        headers,
      });
      if (!response.ok) throw new Error(`Failed to fetch secret value: ${response.status}`);
      const secretData = await response.json();
      const promptValue = secretData.value || secretData.prompt || secretData.content || secretData;
      setSecrets((prevSecrets) =>
        prevSecrets.map((secret) =>
          secret.id === secretId ? { ...secret, value: promptValue } : secret
        )
      );
      return promptValue || "";
    } catch (error) {
      console.error("Error fetching secret value:", error);
      throw new Error("Failed to retrieve analysis prompt");
    }
  };

  const fetchChatHistory = useCallback(async (sessionId, folderName = null) => {
    let folderToFetch = folderName;
    if (!folderToFetch) {
      if (typeof selectedFolder === 'string') {
        folderToFetch = selectedFolder;
      } else if (selectedFolder) {
        folderToFetch = selectedFolder.originalname || selectedFolder.name || null;
      }
    }
    if (!folderToFetch) {
      console.log('[ChatInterface] fetchChatHistory: No folder to fetch, returning early. selectedFolder:', selectedFolder);
      return;
    }
    console.log('[ChatInterface] fetchChatHistory: Starting fetch for folder:', folderToFetch, 'sessionId:', sessionId);
    setLoadingChat(true);
    setChatError(null);
    try {
      console.log('[ChatInterface] fetchChatHistory: Calling API...');
      const data = await documentApi.getFolderChats(folderToFetch);
      console.log('[ChatInterface] fetchChatHistory: API response:', data);
      const chats = Array.isArray(data.chats) ? data.chats : [];
      console.log('[ChatInterface] fetchChatHistory: Parsed chats array:', chats);
      console.log('[ChatInterface] fetchChatHistory: Number of chats:', chats.length);
      
      const chatsWithChunks = chats.map(chat => ({
        ...chat,
        response: chat.response || chat.answer || chat.message || "",
        answer: chat.answer || chat.response || chat.message || "",
        used_chunk_ids: chat.used_chunk_ids || [],
        citations: chat.citations || null,
        chunk_details: chat.chunk_details || null,
        question: chat.question || chat.prompt_label || chat.promptLabel || chat.query || "Untitled",
        prompt_label: chat.prompt_label || chat.promptLabel || null
      }));
      console.log('[ChatInterface] fetchChatHistory: Setting currentChatHistory with', chatsWithChunks.length, 'chats');
      setCurrentChatHistory(prev => {
        if (chatsWithChunks.length > 0) {
          return chatsWithChunks;
        }
        return prev.length > 0 ? prev : chatsWithChunks;
      });
      
      if (sessionId) {
        setSelectedChatSessionId(sessionId);
        const selectedChat = chatsWithChunks.find((c) => c.id === sessionId);
        if (selectedChat) {
          const responseText = selectedChat.response || selectedChat.answer || selectedChat.message || "";
          setSelectedMessageId(selectedChat.id);
          const isStructured = isStructuredJsonResponse(responseText);
          const formattedResponse = isStructured
            ? renderSecretPromptResponse(responseText)
            : convertJsonToPlainText(responseText);
          setAnimatedResponseContent(formattedResponse);
          setIsAnimatingResponse(false);
          setIsGenerating(false);
          setHasResponse(true);
          setHasAiResponse(true);
          setForceSidebarCollapsed(true);
          console.log('[ChatInterface] Selected chat has used_chunk_ids:', selectedChat.used_chunk_ids);
          console.log('[ChatInterface] Selected chat has citations:', selectedChat.citations);
          setCitations([]);
          setShowCitations(false);
        }
      } else {
        setHasResponse(false);
        setHasAiResponse(false);
        setForceSidebarCollapsed(false);
      }
    } catch (err) {
      console.error("[ChatInterface] fetchChatHistory: Error fetching chats:", err);
      console.error("[ChatInterface] fetchChatHistory: Error details:", err.response?.data || err.message);
      setChatError("Failed to fetch chat history.");
    } finally {
      setLoadingChat(false);
      console.log('[ChatInterface] fetchChatHistory: Completed');
    }
  }, [selectedFolder]);

  useEffect(() => {
    const fetchCitations = async () => {
      const folderName = typeof selectedFolder === 'string' ? selectedFolder : (selectedFolder?.originalname || selectedFolder?.name || null);
      if (!selectedMessageId || !folderName) {
        console.log('[Citations] Missing selectedMessageId or selectedFolder:', { selectedMessageId, selectedFolder, folderName });
        setCitations([]);
        setLoadingCitations(false);
        return;
      }

      const message = currentChatHistory.find(msg => msg.id === selectedMessageId);
      console.log('[Citations] Selected message:', message);
      console.log('[Citations] Message has chunk_details:', message?.chunk_details);
      console.log('[Citations] Message has citations:', message?.citations);
      console.log('[Citations] Message has used_chunk_ids:', message?.used_chunk_ids);
      
      if (!message) {
        console.log('[Citations] Message not found in currentChatHistory, currentChatHistory length:', currentChatHistory.length);
        setCitations([]);
        setLoadingCitations(false);
        return;
      }
      
      if (message.chunk_details && Array.isArray(message.chunk_details) && message.chunk_details.length > 0) {
        console.log('[Citations] Using chunk_details from message:', message.chunk_details);
        const formattedCitations = message.chunk_details.map((chunk) => {
          const page = chunk.page || null;
          const pageLabel = chunk.page_label || (page ? `Page ${page}` : null);
          const filename = chunk.filename || 'document.pdf';
          const fileId = chunk.file_id || chunk.fileId;
          const text = chunk.content_preview || chunk.content || chunk.text || '';

          const source = pageLabel 
            ? `${filename} - ${pageLabel}`
            : filename;

          return {
            page: page,
            pageStart: page,
            pageEnd: page,
            pageLabel: pageLabel,
            source: source,
            filename: filename,
            fileId: fileId,
            text: text,
            link: `${filename}#page=${page || 1}`,
            viewUrl: fileId ? `${API_BASE_URL}/docs/file/${fileId}/view?page=${page || 1}` : null
          };
        });
        console.log('[Citations] Formatted citations from chunk_details:', formattedCitations);
        setCitations(formattedCitations);
        setLoadingCitations(false);
        return;
      }

      if (message.citations && Array.isArray(message.citations) && message.citations.length > 0) {
        console.log('[Citations] Using citations from message metadata:', message.citations);
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
            viewUrl: citation.viewUrl || (citation.fileId ? `${API_BASE_URL}/docs/file/${citation.fileId}/view?page=${page || pageStart || 1}` : null)
          };
        });
        console.log('[Citations] Formatted citations from metadata:', formattedCitations);
        setCitations(formattedCitations);
        setLoadingCitations(false);
        return;
      }
      
      if (!message.used_chunk_ids || message.used_chunk_ids.length === 0) {
        console.log('[Citations] No used_chunk_ids or citations in message:', message.used_chunk_ids);
        setCitations([]);
        setShowCitations(false);
        return;
      }

      console.log('[Citations] Fetching chunks for:', message.used_chunk_ids);
      setLoadingCitations(true);
      try {
        const folderName = typeof selectedFolder === 'string' ? selectedFolder : (selectedFolder?.originalname || selectedFolder?.name || null);
        if (!folderName) {
          console.error('[Citations] Invalid folder name:', selectedFolder);
          setCitations([]);
          setLoadingCitations(false);
          return;
        }
        const chunkDetails = await apiService.getFolderChunkDetails(message.used_chunk_ids, folderName);
        console.log('[Citations] Received chunk details:', chunkDetails);
        
        const formattedCitations = chunkDetails.map((chunk) => {
          let pageLabel = chunk.page_range || null;
          let page = null;
          let pageStart = null;
          let pageEnd = null;
          
          if (pageLabel) {
            const pageMatch = pageLabel.match(/(?:Pages? )?(\d+)(?:-(\d+))?/i);
            if (pageMatch) {
              pageStart = parseInt(pageMatch[1]);
              pageEnd = pageMatch[2] ? parseInt(pageMatch[2]) : pageStart;
              page = pageStart;
              
              if (pageStart === pageEnd) {
                pageLabel = `Page ${pageStart}`;
              } else {
                pageLabel = `Pages ${pageStart}-${pageEnd}`;
              }
            }
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
            viewUrl: chunk.file_id ? `${API_BASE_URL}/docs/file/${chunk.file_id}/view?page=${page || pageStart || 1}` : null
          };
        });

        console.log('[Citations] Formatted citations:', formattedCitations);
        setCitations(formattedCitations);
      } catch (error) {
        console.error('[Citations] Failed to fetch citations:', error);
        setCitations([]);
      } finally {
        setLoadingCitations(false);
      }
    };

    fetchCitations();
  }, [selectedMessageId, selectedFolder, currentChatHistory]);

  const animateResponse = (text, skipAnimation = false, isAlreadyFormatted = false) => {
    const plainText = isAlreadyFormatted ? text : convertJsonToPlainText(text);
    
    completeResponseRef.current = plainText;
    
    if (!plainText || typeof plainText !== 'string') {
      setIsAnimatingResponse(false);
      setIsGenerating(false);
      setAnimatedResponseContent(plainText || '');
      completeResponseRef.current = null;
      return;
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      clearTimeout(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const contentMatches = animatedResponseContent.trim() === plainText.trim() || 
                          animatedResponseContent === plainText ||
                          (animatedResponseContent.length > 0 && plainText.startsWith(animatedResponseContent));
    
    if (contentMatches && !skipAnimation) {
      setIsAnimatingResponse(false);
      setIsGenerating(false);
      if (animatedResponseContent !== plainText) {
        setAnimatedResponseContent(plainText);
      }
      return;
    }

    if (!skipAnimation && !plainText.startsWith(animatedResponseContent) && animatedResponseContent !== plainText) {
      setAnimatedResponseContent("");
    }
    setIsAnimatingResponse(!skipAnimation);
    setIsGenerating(!skipAnimation);

    const words = plainText.split(/(\s+)/);
    let currentIndex = 0;
    let displayedText = '';

    if (words.length <= 3) {
      setIsAnimatingResponse(false);
      setIsGenerating(false);
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
        setIsGenerating(false);
        completeResponseRef.current = null;
        setAnimatedResponseContent(plainText);
        animationFrameRef.current = null;
      }
    };

    animationFrameRef.current = setTimeout(animateWord, 20);
  };

  const handleStopGeneration = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      clearTimeout(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamBufferRef.current) {
      const isStructured = isStructuredJsonResponse(streamBufferRef.current);
      const formattedResponse = isStructured
        ? renderSecretPromptResponse(streamBufferRef.current)
        : convertJsonToPlainText(streamBufferRef.current);
      setAnimatedResponseContent(formattedResponse);
    }
    setIsAnimatingResponse(false);
    setIsGenerating(false);
    setLoadingChat(false);
  };

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        clearTimeout(animationFrameRef.current);
      }
      if (streamReaderRef.current) {
        streamReaderRef.current.cancel().catch(() => {});
      }
      if (streamUpdateTimeoutRef.current) {
        clearTimeout(streamUpdateTimeoutRef.current);
      }
    };
  }, []);

  const chatWithAI = async (folder, secretId, currentSessionId) => {
    setAnimatedResponseContent('');
    setThinkingContent('');
    setCurrentStatus(null);
    streamBufferRef.current = '';
    streamThinkingRef.current = '';
    setChatError(null);
    setLoadingChat(true);
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
      const isContinuingSession = !!currentSessionId && currentChatHistory.length > 0;
      if (!isContinuingSession && !panelStatesSetRef.current) {
        setHasResponse(true);
        setHasAiResponse(true);
        setForceSidebarCollapsed(true);
        panelStatesSetRef.current = true;
      }
      const selectedSecret = secrets.find((s) => s.id === secretId);
      if (!selectedSecret) throw new Error("No prompt found for selected analysis type");
      const promptLabel = selectedSecret.name;

      const token = getAuthToken();
      const response = await fetch(`${API_BASE_URL}/docs/${folder}/intelligent-chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          secret_id: secretId,
          session_id: currentSessionId,
          llm_name: 'gemini',
        }),
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
      let messageId = Date.now().toString();

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          setLoadingChat(false);
          const isStructured = isStructuredJsonResponse(streamBufferRef.current);
          let finalResponse = isStructured
            ? renderSecretPromptResponse(streamBufferRef.current)
            : convertJsonToPlainText(streamBufferRef.current);
          if (finalMetadata) {
            newSessionId = finalMetadata.session_id || finalMetadata.sessionId || newSessionId;
            messageId = finalMetadata.message_id || finalMetadata.id || messageId;
          }
          
          let usedChunkIds = finalMetadata?.used_chunk_ids || [];
          if (!usedChunkIds.length && finalMetadata?.citations && Array.isArray(finalMetadata.citations)) {
            usedChunkIds = finalMetadata.citations.map(cit => cit.chunk_id || cit.id).filter(Boolean);
          }
          
          const newMessage = {
            id: messageId,
            question: promptLabel,
            prompt_label: promptLabel,
            response: finalResponse,
            timestamp: new Date().toISOString(),
            created_at: new Date().toISOString(),
            isSecretPrompt: true,
            used_secret_prompt: true,
            used_chunk_ids: usedChunkIds,
            citations: finalMetadata?.citations || null,
            chunk_details: finalMetadata?.chunk_details || null,
          };
          const history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
          setCurrentChatHistory(history);
          
          if (newSessionId) {
            setSelectedChatSessionId(newSessionId);
          }
          
          if (finalResponse && finalResponse.trim()) {
            setSelectedMessageId(messageId);
            if (!panelStatesSetRef.current) {
              setHasResponse(true);
              setHasAiResponse(true);
              setForceSidebarCollapsed(true);
              panelStatesSetRef.current = true;
            }
            if (finalResponse && finalResponse.trim()) {
              animateResponse(finalResponse, false, true);
            } else {
              setIsAnimatingResponse(false);
              setIsGenerating(false);
            }
          }
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
            setLoadingChat(false);
            const isStructured = isStructuredJsonResponse(streamBufferRef.current);
            let finalResponse = isStructured
              ? renderSecretPromptResponse(streamBufferRef.current)
              : convertJsonToPlainText(streamBufferRef.current);
            if (finalMetadata) {
              newSessionId = finalMetadata.session_id || finalMetadata.sessionId || newSessionId;
              messageId = finalMetadata.message_id || finalMetadata.id || messageId;
            }
            
            let usedChunkIds = finalMetadata?.used_chunk_ids || [];
            if (!usedChunkIds.length && finalMetadata?.citations && Array.isArray(finalMetadata.citations)) {
              usedChunkIds = finalMetadata.citations.map(cit => cit.chunk_id || cit.id).filter(Boolean);
            }
            
            const newMessage = {
              id: messageId,
              question: promptLabel,
              prompt_label: promptLabel,
              response: finalResponse,
              timestamp: new Date().toISOString(),
              created_at: new Date().toISOString(),
              isSecretPrompt: true,
              used_secret_prompt: true,
              used_chunk_ids: usedChunkIds,
              citations: finalMetadata?.citations || null,
              chunk_details: finalMetadata?.chunk_details || null,
            };
            const history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
            setCurrentChatHistory(history);
            
            if (newSessionId) {
              setSelectedChatSessionId(newSessionId);
            }
            
            if (finalResponse && finalResponse.trim()) {
              setSelectedMessageId(messageId);
              if (!panelStatesSetRef.current) {
                setHasResponse(true);
                setHasAiResponse(true);
                setForceSidebarCollapsed(true);
                panelStatesSetRef.current = true;
              }
              if (finalResponse && finalResponse.trim()) {
                animateResponse(finalResponse, false, true);
              } else {
                setIsAnimatingResponse(false);
                setIsGenerating(false);
              }
            }
            return;
          }

          try {
            const parsed = JSON.parse(data);
            
            if (parsed.type === 'metadata') {
              console.log('Stream metadata:', parsed);
              newSessionId = parsed.session_id || parsed.sessionId || newSessionId;
              messageId = parsed.message_id || parsed.id || messageId;
              if (!finalMetadata) finalMetadata = {};
              finalMetadata = { ...finalMetadata, ...parsed };
              } else if (parsed.type === 'status') {
                setCurrentStatus({
                  status: parsed.status,
                  message: parsed.message || parsed.status,
                });
                console.log('Status:', parsed.status, parsed.message);
              } else if (parsed.type === 'thinking') {
              const thinkingText = parsed.text || '';
              if (thinkingText) {
                streamThinkingRef.current += thinkingText;
                if (streamUpdateTimeoutRef.current) {
                  clearTimeout(streamUpdateTimeoutRef.current);
                }
                streamUpdateTimeoutRef.current = setTimeout(() => {
                  setThinkingContent(streamThinkingRef.current);
                }, 10);
              }
            } else if (parsed.type === 'chunk') {
              const chunkText = parsed.text || '';
              if (chunkText) {
                streamBufferRef.current += chunkText;
              }
            } else if (parsed.type === 'done') {
              finalMetadata = { ...finalMetadata, ...parsed };
              console.log('[ChatInterface] Done metadata (secret prompt):', finalMetadata);
              console.log('[ChatInterface] used_chunk_ids:', finalMetadata?.used_chunk_ids);
              console.log('[ChatInterface] citations:', finalMetadata?.citations);
              console.log('[ChatInterface] chunk_details:', finalMetadata?.chunk_details);
              
              let usedChunkIds = finalMetadata?.used_chunk_ids || [];
              if (!usedChunkIds.length && finalMetadata?.citations && Array.isArray(finalMetadata.citations)) {
                usedChunkIds = finalMetadata.citations.map(cit => cit.chunk_id || cit.id).filter(Boolean);
              }
              
                const isStructured = isStructuredJsonResponse(streamBufferRef.current);
                let finalResponse = isStructured
                  ? renderSecretPromptResponse(streamBufferRef.current)
                  : convertJsonToPlainText(streamBufferRef.current);
                setLoadingChat(false);
                setCurrentStatus(null);
                if (streamThinkingRef.current) {
                  setThinkingContent(streamThinkingRef.current);
                }
                
              const messageId = finalMetadata?.message_id || finalMetadata?.id || Date.now().toString();
              const newMessage = {
                id: messageId,
                question: questionText,
                response: finalResponse,
                timestamp: new Date().toISOString(),
                created_at: new Date().toISOString(),
                isSecretPrompt: false,
                used_chunk_ids: usedChunkIds,
                citations: finalMetadata?.citations || null,
                chunk_details: finalMetadata?.chunk_details || null,
              };
              const history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
              setCurrentChatHistory(history);
              setSelectedMessageId(newMessage.id);
              
              if (!panelStatesSetRef.current) {
                setHasResponse(true);
                setHasAiResponse(true);
                setForceSidebarCollapsed(true);
                panelStatesSetRef.current = true;
              }
              
              if (finalResponse && finalResponse.trim()) {
                animateResponse(finalResponse, false, true);
              } else {
                setIsAnimatingResponse(false);
                setIsGenerating(false);
              }
            } else if (parsed.type === 'error') {
              setChatError(parsed.message || parsed.error);
              setLoadingChat(false);
            }
          } catch (e) {
          }
        }
      }
    } catch (error) {
      console.error("Chat error:", error);
      setChatError(`Analysis failed: ${error.message}`);
      setHasResponse(false);
      setHasAiResponse(false);
      setForceSidebarCollapsed(false);
      throw error;
    } finally {
      setLoadingChat(false);
      streamReaderRef.current = null;
    }
  };

  const handleNewMessage = async () => {
    if (!selectedFolder) return;
    if (isSecretPromptSelected) {
      if (!selectedSecretId) {
        setChatError("Please select an analysis type.");
        return;
      }
      await chatWithAI(selectedFolder, selectedSecretId, selectedChatSessionId);
      setChatInput("");
      setIsSecretPromptSelected(false);
      setActiveDropdown("Custom Query");
      setSelectedSecretId(null);
      setSelectedLlmName(null);
    } else {
      if (!chatInput.trim()) return;
      const questionText = chatInput.trim();
      
      setAnimatedResponseContent('');
      setThinkingContent('');
      streamBufferRef.current = '';
      streamThinkingRef.current = '';
      setChatError(null);
      setLoadingChat(true);
      setIsAnimatingResponse(false);
      panelStatesSetRef.current = false;
      
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

      const isContinuingSession = !!selectedChatSessionId && currentChatHistory.length > 0;
      if (!isContinuingSession && !panelStatesSetRef.current) {
        setHasResponse(true);
        setHasAiResponse(true);
        setForceSidebarCollapsed(true);
        panelStatesSetRef.current = true;
      }
      
      try {
        const token = getAuthToken();
        const response = await fetch(`${API_BASE_URL}/docs/${selectedFolder}/intelligent-chat/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : '',
            'Accept': 'text/event-stream',
          },
          body: JSON.stringify({
            question: questionText,
            session_id: selectedChatSessionId,
            llm_name: 'gemini',
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body.getReader();
        streamReaderRef.current = reader;
        const decoder = new TextDecoder();
        let buffer = '';
        let newSessionId = selectedChatSessionId;
        let finalMetadata = null;
        let messageId = Date.now().toString();

        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            setLoadingChat(false);
            const isStructured = isStructuredJsonResponse(streamBufferRef.current);
            let finalResponse = isStructured
              ? renderSecretPromptResponse(streamBufferRef.current)
              : convertJsonToPlainText(streamBufferRef.current);
            if (finalMetadata) {
              newSessionId = finalMetadata.session_id || finalMetadata.sessionId || newSessionId;
              messageId = finalMetadata.message_id || finalMetadata.id || messageId;
            }
            
            let usedChunkIds = finalMetadata?.used_chunk_ids || [];
            
            if (!usedChunkIds.length && finalMetadata?.citations && Array.isArray(finalMetadata.citations)) {
              usedChunkIds = finalMetadata.citations
                .map(cit => cit.chunk_id || cit.id || cit.chunkId)
                .filter(Boolean);
            }
            
            const newMessage = {
              id: messageId,
              question: questionText,
              response: finalResponse,
              timestamp: new Date().toISOString(),
              created_at: new Date().toISOString(),
              isSecretPrompt: false,
              used_chunk_ids: usedChunkIds,
              citations: finalMetadata?.citations || null,
            };
            const history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
            setCurrentChatHistory(history);
            
            if (newSessionId) {
              setSelectedChatSessionId(newSessionId);
            }
            
            if (finalResponse && finalResponse.trim()) {
              setSelectedMessageId(messageId);
              if (!panelStatesSetRef.current) {
                setHasResponse(true);
                setHasAiResponse(true);
                setForceSidebarCollapsed(true);
                panelStatesSetRef.current = true;
              }
              const contentMatches = animatedResponseContent.trim() === finalResponse.trim() || 
                                    animatedResponseContent === finalResponse ||
                                    (animatedResponseContent.length > 0 && finalResponse.startsWith(animatedResponseContent));
              
              if (finalResponse && finalResponse.trim()) {
                animateResponse(finalResponse, false, true);
              } else {
                setIsAnimatingResponse(false);
                setIsGenerating(false);
              }
            }
            setChatInput("");
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
              setLoadingChat(false);
              const isStructured = isStructuredJsonResponse(streamBufferRef.current);
              let finalResponse = isStructured
                ? renderSecretPromptResponse(streamBufferRef.current)
                : convertJsonToPlainText(streamBufferRef.current);
              if (finalMetadata) {
                newSessionId = finalMetadata.session_id || finalMetadata.sessionId || newSessionId;
                messageId = finalMetadata.message_id || finalMetadata.id || messageId;
              }
              
            let usedChunkIds = finalMetadata?.used_chunk_ids || [];
            
            if (!usedChunkIds.length && finalMetadata?.citations && Array.isArray(finalMetadata.citations)) {
              usedChunkIds = finalMetadata.citations
                .map(cit => cit.chunk_id || cit.id || cit.chunkId)
                .filter(Boolean);
              console.log('[ChatInterface] Extracted chunk IDs from citations:', usedChunkIds);
            }
            
            const newMessage = {
              id: messageId,
              question: questionText,
              response: finalResponse,
              timestamp: new Date().toISOString(),
              created_at: new Date().toISOString(),
              isSecretPrompt: false,
              used_chunk_ids: usedChunkIds,
              citations: finalMetadata?.citations || null,
              chunk_details: finalMetadata?.chunk_details || null,
            };
              const history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
              setCurrentChatHistory(history);
              
              if (newSessionId) {
                setSelectedChatSessionId(newSessionId);
              }
              
              if (finalResponse && finalResponse.trim()) {
                setSelectedMessageId(messageId);
                setHasResponse(true);
                setHasAiResponse(true);
                setForceSidebarCollapsed(true);
                animateResponse(finalResponse);
              }
              setChatInput("");
              return;
            }

            try {
              const parsed = JSON.parse(data);
              
              if (parsed.type === 'metadata') {
                console.log('Stream metadata:', parsed);
                newSessionId = parsed.session_id || parsed.sessionId || newSessionId;
                messageId = parsed.message_id || parsed.id || messageId;
              } else if (parsed.type === 'status') {
                setCurrentStatus({
                  status: parsed.status,
                  message: parsed.message || parsed.status,
                });
                console.log('Status:', parsed.status, parsed.message);
              } else if (parsed.type === 'chunk') {
                const chunkText = parsed.text || '';
                if (chunkText) {
                  streamBufferRef.current += chunkText;
                }
              } else if (parsed.type === 'done') {
                finalMetadata = parsed;
                console.log('[ChatInterface] Final metadata received:', finalMetadata);
                console.log('[ChatInterface] used_chunk_ids:', finalMetadata?.used_chunk_ids);
                console.log('[ChatInterface] citations:', finalMetadata?.citations);
                console.log('[ChatInterface] chunk_details:', finalMetadata?.chunk_details);
                
                let usedChunkIds = finalMetadata?.used_chunk_ids || [];
                
                if (!usedChunkIds.length && finalMetadata?.citations && Array.isArray(finalMetadata.citations)) {
                  usedChunkIds = finalMetadata.citations.map(cit => cit.chunk_id || cit.id).filter(Boolean);
                  console.log('[ChatInterface] Extracted chunk IDs from citations:', usedChunkIds);
                }
                
                if (!usedChunkIds.length && finalMetadata?.citations) {
                  const citations = Array.isArray(finalMetadata.citations) 
                    ? finalMetadata.citations 
                    : Object.values(finalMetadata.citations || {});
                  usedChunkIds = citations.map(cit => cit.chunk_id || cit.id).filter(Boolean);
                }
                
                const isStructured = isStructuredJsonResponse(streamBufferRef.current);
                let finalResponse = isStructured
                  ? renderSecretPromptResponse(streamBufferRef.current)
                  : convertJsonToPlainText(streamBufferRef.current);
                setLoadingChat(false);
                setCurrentStatus(null);
                if (streamThinkingRef.current) {
                  setThinkingContent(streamThinkingRef.current);
                }
                
                const newMessage = {
                  id: finalMetadata.message_id || finalMetadata.id || messageId,
                  question: questionText,
                  response: finalResponse,
                  timestamp: new Date().toISOString(),
                  created_at: new Date().toISOString(),
                  isSecretPrompt: false,
                  used_chunk_ids: usedChunkIds,
                  citations: finalMetadata?.citations || null,
                  chunk_details: finalMetadata?.chunk_details || null,
                };
                const history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
                setCurrentChatHistory(history);
                setSelectedMessageId(newMessage.id);
                
                if (finalResponse && finalResponse.trim()) {
                  animateResponse(finalResponse, false, true);
                } else {
                  setIsAnimatingResponse(false);
                  setIsGenerating(false);
                }
              } else if (parsed.type === 'error') {
                setChatError(parsed.message || parsed.error);
                setLoadingChat(false);
              }
            } catch (e) {
            }
          }
        }
      } catch (err) {
        console.error("Error sending message:", err);
        setChatError(`Failed to send message: ${err.response?.data?.details || err.message}`);
        setHasResponse(false);
        setHasAiResponse(false);
        setForceSidebarCollapsed(false);
      } finally {
        setLoadingChat(false);
        streamReaderRef.current = null;
      }
    }
  };

  const handleSelectChat = (chat) => {
    console.log('[ChatInterface] handleSelectChat called with chat:', chat);
    console.log('[ChatInterface] Chat has chunk_details:', chat?.chunk_details);
    console.log('[ChatInterface] Chat has citations:', chat?.citations);
    console.log('[ChatInterface] Chat has used_chunk_ids:', chat?.used_chunk_ids);
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      clearTimeout(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    const responseText = chat.response || chat.answer || chat.message || "";
    const isStructured = isStructuredJsonResponse(responseText);
    const formattedResponse = isStructured
      ? renderSecretPromptResponse(responseText)
      : convertJsonToPlainText(responseText);
    startTransition(() => {
      setSelectedMessageId(chat.id);
      setAnimatedResponseContent(formattedResponse);
      setIsAnimatingResponse(false);
      setIsGenerating(false);
      setHasResponse(true);
      setHasAiResponse(true);
      setForceSidebarCollapsed(true);
    });
    setCitations([]);
    setShowCitations(false);
    setLoadingCitations(true);
  };

  const handleDeleteChat = async (chatId, e) => {
    if (e) {
      e.stopPropagation();
    }
    
    setOpenChatMenuId(null);
    
    const folderName = typeof selectedFolder === 'string' ? selectedFolder : (selectedFolder?.originalname || selectedFolder?.name || null);
    if (!folderName || !chatId) {
      console.error('[ChatInterface] handleDeleteChat: Missing folderName or chatId', { selectedFolder, folderName, chatId });
      return;
    }

    if (!window.confirm('Are you sure you want to delete this chat? This action cannot be undone.')) {
      return;
    }

    try {
      setLoadingChat(true);
      setChatError(null);
      
      console.log('[ChatInterface] handleDeleteChat: Deleting chat', chatId, 'from folder', folderName);
      const deletePromise = documentApi.deleteSingleFolderChat(folderName, chatId);
      
      toast.promise(deletePromise, {
        pending: 'Deleting chat...',
        success: 'Chat deleted successfully!',
        error: {
          render({ data }) {
            const errorMessage = data?.response?.data?.error || data?.message || 'Failed to delete chat';
            return errorMessage;
          },
        },
      });
      
      await deletePromise;
      console.log(`✅ Successfully deleted chat ${chatId}`);
      
      setCurrentChatHistory(prev => prev.filter(chat => chat.id !== chatId));
      
      if (selectedMessageId === chatId) {
        setSelectedMessageId(null);
        setAnimatedResponseContent("");
        setHasResponse(false);
        setHasAiResponse(false);
        setForceSidebarCollapsed(false);
      }
      
      if (folderName) {
        await fetchChatHistory(null, folderName);
      }
    } catch (err) {
      console.error("❌ Error deleting chat:", err);
      const errorMessage = err?.response?.data?.error || err?.message || 'Failed to delete chat';
      setChatError(errorMessage);
    } finally {
      setLoadingChat(false);
    }
  };

  const handleChatMenuToggle = (chatId, e) => {
    if (e) {
      e.stopPropagation();
    }
    setOpenChatMenuId(openChatMenuId === chatId ? null : chatId);
  };

  const handleNewChat = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setCurrentChatHistory([]);
    setSelectedChatSessionId(null);
    setHasResponse(false);
    setHasAiResponse(false);
    setForceSidebarCollapsed(false);
    setChatInput("");
    setSelectedMessageId(null);
    setAnimatedResponseContent("");
    setIsAnimatingResponse(false);
    setIsGenerating(false);
    setIsSecretPromptSelected(false);
    setSelectedSecretId(null);
    setSelectedLlmName(null);
    setActiveDropdown("Custom Query");
  };

  const handleDeleteAllChats = async () => {
    if (!selectedFolder) return;
    
    const chatCount = currentChatHistory.length;
    if (chatCount === 0) {
      toast.info("No chats to delete.");
      return;
    }

    if (!window.confirm(`Are you sure you want to delete all ${chatCount} chat(s) in this folder? This action cannot be undone.`)) {
      return;
    }

    try {
      setLoadingChat(true);
      setChatError(null);
      
      const deletePromise = documentApi.deleteAllFolderChats(selectedFolder);
      
      toast.promise(deletePromise, {
        pending: 'Deleting all chats...',
        success: `All ${chatCount} chat(s) deleted successfully!`,
        error: {
          render({ data }) {
            const errorMessage = data?.response?.data?.error || data?.message || 'Failed to delete all chats';
            return errorMessage;
          },
        },
      });
      
      await deletePromise;
      console.log(`✅ Successfully deleted all chats from folder ${selectedFolder}`);
      
      setCurrentChatHistory([]);
      setSelectedChatSessionId(null);
      setHasResponse(false);
      setHasAiResponse(false);
      setForceSidebarCollapsed(false);
      setSelectedMessageId(null);
      setAnimatedResponseContent("");
      setIsAnimatingResponse(false);
      setIsGenerating(false);
      
      const folderName = typeof selectedFolder === 'string' ? selectedFolder : (selectedFolder?.originalname || selectedFolder?.name || null);
      if (folderName) {
        await fetchChatHistory(null, folderName);
      }
    } catch (err) {
      console.error("❌ Error deleting all chats:", err);
      const errorMessage = err?.response?.data?.error || err?.message || 'Failed to delete all chats';
      setChatError(errorMessage);
    } finally {
      setLoadingChat(false);
    }
  };

  const handleDropdownSelect = (secretName, secretId, llmName) => {
    setActiveDropdown(secretName);
    setSelectedSecretId(secretId);
    setSelectedLlmName(llmName);
    setIsSecretPromptSelected(true);
    setChatInput("");
    setShowDropdown(false);
  };

  const handleChatInputChange = (e) => {
    setChatInput(e.target.value);
    if (e.target.value && isSecretPromptSelected) {
      setIsSecretPromptSelected(false);
      setActiveDropdown("Custom Query");
      setSelectedSecretId(null);
      setSelectedLlmName(null);
    }
    if (!e.target.value && !isSecretPromptSelected) {
      setActiveDropdown("Custom Query");
    }
  };

  const getRelativeTime = (dateString) => {
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diffInSeconds = Math.floor((now - date) / 1000);
      if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
      if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
      if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
      return `${Math.floor(diffInSeconds / 86400)}d ago`;
    } catch {
      return "Unknown time";
    }
  };

  const formatDate = (dateString) => {
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return "Invalid date";
    }
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openChatMenuId && chatMenuRefs.current[openChatMenuId]) {
        if (!chatMenuRefs.current[openChatMenuId].contains(event.target)) {
          setOpenChatMenuId(null);
        }
      }
    };

    if (openChatMenuId) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [openChatMenuId]);

  useEffect(() => {
    fetchSecrets();
  }, []);

  useEffect(() => {
    console.log('[ChatInterface] useEffect triggered, selectedFolder:', selectedFolder);
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setChatSessions([]);
    setSelectedChatSessionId(null);
    setHasResponse(false);
    setHasAiResponse(false);
    setForceSidebarCollapsed(false);
    setAnimatedResponseContent("");
    setSelectedMessageId(null);
    setIsAnimatingResponse(false);
    setActiveDropdown("Custom Query");
    setSelectedSecretId(null);
    setSelectedLlmName(null);
    setIsSecretPromptSelected(false);
    setChatInput("");
    
    const folderName = typeof selectedFolder === 'string' ? selectedFolder : (selectedFolder?.originalname || selectedFolder?.name || null);
    if (folderName) {
      const folderKey = `${folderName}`;
      fetchedFoldersRef.current.delete(folderKey);
      console.log('[ChatInterface] Calling fetchChatHistory for folder:', folderName);
      fetchedFoldersRef.current.add(folderKey);
      fetchChatHistory(null, folderName).then(() => {
        console.log('[ChatInterface] fetchChatHistory completed successfully');
      }).catch(err => {
        console.error('[ChatInterface] Error in fetchChatHistory:', err);
        fetchedFoldersRef.current.delete(folderKey);
        setCurrentChatHistory([]);
      });
    } else {
      console.log('[ChatInterface] Skipping fetchChatHistory - folder is:', selectedFolder);
      if (selectedFolder === null || selectedFolder === undefined) {
        console.log('[ChatInterface] selectedFolder is null/undefined - will fetch when folder is set');
      } else {
        fetchedFoldersRef.current.clear();
        setCurrentChatHistory([]);
      }
    }
  }, [selectedFolder, fetchChatHistory]);

  if (!selectedFolder) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-lg bg-[#FDFCFB]">
        Select a folder to start chatting.
      </div>
    );
  }

  const buttonClass = isGenerating
    ? "p-2.5 bg-gray-500 hover:bg-gray-600 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-full transition-colors"
    : "p-2.5 bg-[#21C1B6] hover:bg-[#1AA49B] disabled:bg-gray-300 disabled:cursor-not-allowed rounded-full transition-colors";

  return (
    <div className="flex h-full min-h-0 w-full bg-[#F8FAFD] px-4 sm:px-6 py-4 gap-4 overflow-hidden relative">
      <div
        className={`${hasResponse ? "flex-[0.4]" : "flex-1"} flex flex-col bg-white h-full transition-all duration-300 overflow-hidden rounded-2xl border border-gray-200 shadow-sm min-w-0`}
      >
        <div className="p-4 border-b border-black border-opacity-20 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Questions</h2>
            <div className="flex items-center gap-2">
              {currentChatHistory.length > 0 && (
                <button
                  onClick={handleDeleteAllChats}
                  disabled={loadingChat}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed rounded-md transition-colors flex items-center gap-1.5"
                  title="Delete all chats"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete All
                </button>
              )}
              <button
                onClick={handleNewChat}
                className="px-3 py-1.5 text-sm font-medium text-white bg-[#21C1B6] hover:bg-[#1AA49B] rounded-md transition-colors"
              >
                New Chat
              </button>
            </div>
          </div>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search questions..."
              className="w-full pl-9 pr-3 py-2 bg-gray-100 rounded-lg text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#21C1B6] border-[#21C1B6]"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-2 scrollbar-custom">
          {loadingChat && currentChatHistory.length === 0 ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-[#21C1B6]" />
            </div>
          ) : currentChatHistory.length === 0 ? (
            <div className="text-center py-12">
              <MessageSquare className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500">No chats yet. Start a conversation!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {currentChatHistory.map((chat) => (
                <div
                  key={chat.id}
                  onClick={() => handleSelectChat(chat)}
                  className={`p-3 rounded-lg border cursor-pointer transition-all duration-200 hover:shadow-md group ${
                    selectedMessageId === chat.id
                      ? "bg-blue-50 border-blue-200 shadow-sm"
                      : "bg-white border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 mb-1 line-clamp-2">
                        {chat.question || chat.prompt_label || chat.promptLabel || chat.query || "Untitled"}
                      </p>
                      <p className="text-xs text-gray-500">{getRelativeTime(chat.created_at || chat.timestamp)}</p>
                    </div>
                    <div className={`relative transition-opacity duration-200 ${openChatMenuId === chat.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} ref={(el) => (chatMenuRefs.current[chat.id] = el)}>
                      <button
                        onClick={(e) => handleChatMenuToggle(chat.id, e)}
                        className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
                        title="More options"
                        type="button"
                      >
                        <MoreVertical className="h-4 w-4 text-gray-600" />
                      </button>
                      {openChatMenuId === chat.id && (
                        <div className="absolute right-0 top-8 mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                          <button
                            onClick={(e) => handleDeleteChat(chat.id, e)}
                            className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 rounded-lg transition-colors"
                            type="button"
                          >
                            <Trash2 className="w-4 h-4" />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="border-t border-gray-200 p-2 bg-white flex-shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (isGenerating) {
                handleStopGeneration();
              } else {
                handleNewMessage();
              }
            }}
            className="flex items-center space-x-3 bg-white rounded-xl border border-[#21C1B6] px-4 py-4 focus-within:ring-[#21C1B6] focus-within:shadow-sm"
          >
            <div className="relative flex-shrink-0" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setShowDropdown(!showDropdown)}
                disabled={isLoadingSecrets || loadingChat}
                className="flex items-center space-x-2 px-2.5 py-1.5 text-xs font-medium text-gray-700 bg-white border border-[#21C1B6] rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <BookOpen className="h-3.5 w-3.5" />
                <span>{isLoadingSecrets ? "Loading..." : activeDropdown}</span>
                <ChevronDown className="h-3.5 w-3.5" />
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
                    <div className="px-4 py-2.5 text-sm text-gray-500">
                      No analysis prompts available
                    </div>
                  )}
                </div>
              )}
            </div>

            <input
              type="text"
              placeholder={isSecretPromptSelected ? `Analysis: ${activeDropdown}` : "How can I help you today?"}
              value={chatInput}
              onChange={handleChatInputChange}
              onKeyPress={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleNewMessage();
                }
              }}
              className="flex-grow bg-transparent border-none outline-none text-gray-900 placeholder-gray-500 text-sm font-medium py-2 min-w-0"
              disabled={loadingChat}
            />
            <button
              type="submit"
              className={`p-1.5 text-white rounded-lg transition-colors flex-shrink-0 ${
                isGenerating 
                  ? "bg-gray-500 hover:bg-gray-600" 
                  : "bg-[#21C1B6] hover:bg-[#1AA49B]"
              } disabled:bg-gray-300`}
              disabled={loadingChat || (!chatInput.trim() && !isSecretPromptSelected && !isGenerating)}
            >
              {loadingChat && !isGenerating ? (
                <Loader2 className="h-4 w-4 text-white animate-spin" />
              ) : isGenerating ? (
                <Square className="h-4 w-4 text-white" />
              ) : (
                <Send className="h-4 w-4 text-white" />
              )}
            </button>
          </form>
          {chatError && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
              {chatError}
            </div>
          )}
        </div>
      </div>
      {hasResponse && (
        <div className="flex-[0.6] flex flex-col h-full overflow-hidden bg-white rounded-2xl border border-gray-200 shadow-sm min-w-0 relative" style={{ overflow: showCitations ? 'visible' : 'hidden' }}>
          {selectedMessageId && animatedResponseContent && (
            <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-gray-200 bg-white">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900">JuriNex Response</h2>
                <div className="flex items-center gap-2">
                  <div className="text-sm text-gray-500 mr-2">
                    {currentChatHistory.find((msg) => msg.id === selectedMessageId)?.timestamp && (
                      <span>{formatDate(currentChatHistory.find((msg) => msg.id === selectedMessageId).timestamp)}</span>
                    )}
                  </div>
                  <DownloadPdf markdownOutputRef={markdownOutputRef} />
                  <button
                    onClick={handleCopyResponse}
                    className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
                    title="Copy to clipboard"
                  >
                    {copySuccess ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
              <div className="mt-3 p-3 bg-blue-50 rounded-lg border-l-4 border-[#21C1B6]">
                <p className="text-sm font-medium text-blue-900 mb-1">Question:</p>
                <p className="text-sm text-blue-800">
                  {currentChatHistory.find((msg) => msg.id === selectedMessageId)?.question || "No question available"}
                </p>
              </div>
              {isAnimatingResponse && (
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={skipAnimation}
                    className="text-xs text-[#21C1B6] hover:text-[#1AA49B] flex items-center space-x-1 transition-colors font-medium"
                  >
                    <span>Skip animation</span>
                    <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="flex-1 overflow-y-auto scrollbar-custom" ref={responseRef}>
            {currentStatus && (
              <div className="px-6 pt-6">
                <div className="status-display" style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 16px',
                  background: '#f8f9fa',
                  borderLeft: '4px solid #4285f4',
                  borderRadius: '8px',
                  marginBottom: '16px',
                  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", sans-serif'
                }}>
                  <div className="status-spinner" style={{
                    width: '20px',
                    height: '20px',
                    border: '2px solid #e0e0e0',
                    borderTop: '2px solid #4285f4',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite'
                  }}></div>
                  <div className="status-content">
                    <div className="status-label" style={{
                      fontSize: '13px',
                      fontWeight: '500',
                      color: '#5f6368',
                      textTransform: 'capitalize',
                      marginBottom: '2px'
                    }}>
                      {currentStatus.status}
                    </div>
                    <div className="status-message" style={{
                      fontSize: '14px',
                      color: '#3c4043'
                    }}>
                      {currentStatus.message}
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {loadingChat && !animatedResponseContent && !thinkingContent && !currentStatus ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-[#21C1B6]" />
                  <p className="text-gray-600">Generating response...</p>
                </div>
              </div>
            ) : selectedMessageId && (animatedResponseContent || thinkingContent || currentStatus) ? (
              <div className="px-6 py-6">
                {thinkingContent && (
                  <div className="thinking-section" style={{
                    background: '#f5f5f5',
                    borderLeft: '4px solid #4285f4',
                    borderRadius: '8px',
                    padding: '16px',
                    marginBottom: '16px',
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", sans-serif'
                  }}>
                    <div className="thinking-header" style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginBottom: '12px',
                      color: '#5f6368',
                      fontSize: '14px',
                      fontWeight: '500'
                    }}>
                      <span style={{ fontSize: '18px' }}>🧠</span>
                      <span>Thinking...</span>
                    </div>
                    <div className="thinking-content" style={{
                      color: '#3c4043',
                      fontSize: '14px',
                      lineHeight: '1.6',
                      whiteSpace: 'pre-wrap',
                      fontFamily: '"Roboto Mono", "Courier New", monospace',
                      background: 'white',
                      padding: '12px',
                      borderRadius: '4px',
                      border: '1px solid #e0e0e0',
                      wordWrap: 'break-word'
                    }}>
                      {thinkingContent}
                      {loadingChat && <span style={{ animation: 'blink 1s infinite' }}>▋</span>}
                    </div>
                  </div>
                )}
                
                {animatedResponseContent && (
                  <div className="bg-white rounded-lg shadow-sm p-6">
                    <div className="horizontal-scroll-container" ref={horizontalScrollRef}>
                      <div
                        className="prose prose-gray prose-lg max-w-none"
                        ref={markdownOutputRef}
                        style={{ minWidth: "fit-content" }}
                      >
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[rehypeRaw, rehypeSanitize]}
                          components={{
                            h1: ({node, ...props}) => (
                              <h1 className="text-4xl font-bold mb-8 mt-8 text-gray-900 border-b-2 border-blue-500 pb-4 analysis-page-ai-response tracking-tight" {...props} />
                            ),
                            h2: ({node, ...props}) => (
                              <h2 className="text-2xl font-bold mb-6 mt-8 text-gray-900 border-b border-gray-300 pb-3 analysis-page-ai-response tracking-tight" {...props} />
                            ),
                            h3: ({node, ...props}) => (
                              <h3 className="text-xl font-semibold mb-4 mt-6 text-gray-800 analysis-page-ai-response" {...props} />
                            ),
                            h4: ({node, ...props}) => (
                              <h4 className="text-lg font-semibold mb-3 mt-5 text-gray-800 analysis-page-ai-response" {...props} />
                            ),
                            h5: ({node, ...props}) => (
                              <h5 className="text-base font-semibold mb-2 mt-4 text-gray-700 analysis-page-ai-response" {...props} />
                            ),
                            h6: ({node, ...props}) => (
                              <h6 className="text-sm font-semibold mb-2 mt-3 text-gray-700 analysis-page-ai-response" {...props} />
                            ),
                            p: ({node, ...props}) => (
                              <p className="mb-5 leading-relaxed text-gray-800 text-[15px] analysis-page-ai-response" {...props} />
                            ),
                            strong: ({node, ...props}) => (
                              <strong className="font-bold text-gray-900" {...props} />
                            ),
                            em: ({node, ...props}) => (
                              <em className="italic text-gray-800" {...props} />
                            ),
                            ul: ({node, ...props}) => (
                              <ul className="list-disc pl-6 mb-4 space-y-2 text-gray-800" {...props} />
                            ),
                            ol: ({node, ...props}) => (
                              <ol className="list-decimal pl-6 mb-4 space-y-2 text-gray-800" {...props} />
                            ),
                            li: ({node, ...props}) => (
                              <li className="leading-relaxed text-gray-800 analysis-page-ai-response" {...props} />
                            ),
                            a: ({node, ...props}) => (
                              <a
                                {...props}
                                className="text-blue-600 hover:text-blue-800 underline font-medium transition-colors"
                                target="_blank"
                                rel="noopener noreferrer"
                              />
                            ),
                            blockquote: ({node, ...props}) => (
                              <blockquote className="border-l-4 border-blue-500 pl-6 py-3 my-6 bg-blue-50 text-gray-800 italic rounded-r-lg analysis-page-ai-response shadow-sm" {...props} />
                            ),
                            code: ({node, inline, className, children, ...props}) => {
                              const match = /language-(\w+)/.exec(className || '');
                              const language = match ? match[1] : '';
                              
                              if (inline) {
                                return (
                                  <code
                                    className="bg-gray-100 text-red-600 px-1.5 py-0.5 rounded text-sm font-mono border border-gray-200"
                                    {...props}
                                  >
                                    {children}
                                  </code>
                                );
                              }
                              
                              return (
                                <div className="relative my-4">
                                  {language && (
                                    <div className="bg-gray-800 text-gray-300 text-xs px-3 py-1 rounded-t font-mono">
                                      {language}
                                    </div>
                                  )}
                                  <pre className={`bg-gray-900 text-gray-100 p-4 ${language ? 'rounded-b' : 'rounded'} overflow-x-auto`}>
                                    <code className="font-mono text-sm" {...props}>
                                      {children}
                                    </code>
                                  </pre>
                                </div>
                              );
                            },
                            pre: ({node, ...props}) => (
                              <pre className="bg-gray-900 text-gray-100 p-4 rounded my-4 overflow-x-auto" {...props} />
                            ),
                            table: ({node, ...props}) => (
                              <div className="my-6 rounded-lg border border-gray-300 shadow-sm overflow-hidden">
                                <table className="min-w-full divide-y divide-gray-300" {...props} />
                              </div>
                            ),
                            thead: ({node, ...props}) => (
                              <thead className="bg-gradient-to-r from-gray-50 to-gray-100" {...props} />
                            ),
                            th: ({node, ...props}) => (
                              <th className="px-6 py-4 text-left text-xs font-bold text-gray-800 uppercase tracking-wider border-b-2 border-gray-300" {...props} />
                            ),
                            tbody: ({node, ...props}) => (
                              <tbody className="bg-white divide-y divide-gray-200" {...props} />
                            ),
                            tr: ({node, ...props}) => (
                              <tr className="hover:bg-gray-50 transition-colors" {...props} />
                            ),
                            td: ({node, ...props}) => (
                              <td className="px-6 py-4 text-sm text-gray-800 border-b border-gray-100 leading-relaxed" {...props} />
                            ),
                            hr: ({node, ...props}) => (
                              <hr className="my-6 border-t-2 border-gray-300" {...props} />
                            ),
                            img: ({node, ...props}) => (
                              <img className="max-w-full h-auto rounded-lg shadow-md my-4" alt="" {...props} />
                            ),
                          }}
                        >
                          {formattedResponseContent}
                        </ReactMarkdown>
                        {isAnimatingResponse && (
                          <span className="inline-flex items-center ml-1">
                            <span className="inline-block w-2 h-5 bg-blue-600 animate-pulse"></span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center max-w-md px-6">
                  <MessageSquare className="h-16 w-16 mx-auto mb-6 text-gray-300" />
                  <h3 className="text-2xl font-semibold mb-4 text-gray-900">Select a Question</h3>
                  <p className="text-gray-600 text-lg leading-relaxed">
                    Click on any question from the left panel to view the JuriNex response here.
                  </p>
                </div>
              </div>
            )}
          </div>
          
          {selectedMessageId && (() => {
            const message = currentChatHistory.find((msg) => msg.id === selectedMessageId);
            const hasCitations = message && (
              (message.used_chunk_ids && message.used_chunk_ids.length > 0) ||
              (message.citations && Array.isArray(message.citations) && message.citations.length > 0) ||
              (citations && citations.length > 0)
            );
            
            return hasCitations ? (
              <div className="px-6 py-4 border-t border-gray-200 bg-white flex justify-center flex-shrink-0" style={{ position: 'relative', zIndex: 10 }}>
                <button
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('[ChatInterface] SOURCES button clicked');
                    console.log('[ChatInterface] Current citations:', citations);
                    console.log('[ChatInterface] Current showCitations:', showCitations);
                    console.log('[ChatInterface] Current selectedMessageId:', selectedMessageId);
                    
                    const newShowState = !showCitations;
                    setShowCitations(newShowState);
                    
                    if (newShowState && (!citations || citations.length === 0)) {
                      const message = currentChatHistory.find((msg) => msg.id === selectedMessageId);
                      console.log('[ChatInterface] Message for citations:', message);
                      if (message && (message.used_chunk_ids?.length > 0 || message.citations?.length > 0)) {
                        console.log('[ChatInterface] Citations should be fetched by useEffect');
                      }
                    }
                  }}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ pointerEvents: 'auto', zIndex: 20 }}
                  type="button"
                  disabled={loadingCitations}
                >
                  <BookOpen className="h-4 w-4" />
                  <span>SOURCES</span>
                  {loadingCitations && (
                    <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  )}
                  {citations && citations.length > 0 && (
                    <span className="ml-1 text-xs bg-purple-500 px-2 py-0.5 rounded-full">
                      {citations.length}
                    </span>
                  )}
                </button>
              </div>
            ) : null;
          })()}
          
          {shouldShowHorizontalScrollbar && (
            <div className="px-6 pb-4 pt-2 bg-white border-t border-gray-100">
              <div
                ref={stickyScrollbarRef}
                className="overflow-x-auto overflow-y-hidden bg-gray-100 border border-gray-200 rounded-lg shadow-sm"
                style={{
                  height: "16px",
                  scrollbarWidth: "thin",
                  scrollbarColor: "#9CA3AF #E5E7EB",
                  WebkitOverflowScrolling: "touch",
                }}
              >
                <div style={{ width: `${scrollbarWidth}px`, height: "1px" }} />
              </div>
            </div>
          )}
        </div>
      )}

      {hasResponse && showCitations && (
        <div className="absolute" style={{ right: '16px', top: '16px', bottom: '16px', width: '380px', zIndex: 50 }}>
          <CitationsPanel
            citations={citations || []}
            folderName={selectedFolder}
            onClose={() => setShowCitations(false)}
            onCitationClick={async (citation) => {
              const page = citation.page || citation.pageStart || 1;
              const fileId = citation.fileId || citation.file_id;
              
              if (!fileId) {
                console.error('[Citations] Invalid citation: missing fileId', citation);
                return;
              }
              
              console.log(`[Citations] Opening: ${fileId}, page ${page}`);
              
              setDocumentViewer({
                open: true,
                url: null,
                filename: citation.filename || 'Document',
                page: page,
                loading: true
              });
              
              try {
                const token = getAuthToken();
                await openDocumentAtPage(fileId, page, citation.filename, token);
              } catch (error) {
                console.error('[Citations] Error fetching document:', error);
                setDocumentViewer({
                  open: true,
                  url: null,
                  filename: citation.filename || 'Document',
                  page: page,
                  loading: false,
                  error: error.message || 'Failed to load document'
                });
              }
            }}
          />
        </div>
      )}

      {documentViewer.open && (
        <div 
          className="fixed inset-0 z-[60] flex items-center justify-center bg-white" 
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setDocumentViewer({ open: false, url: null, filename: null, page: null, loading: false, error: null });
            }
          }}
        >
          <div className="bg-white rounded-lg shadow-2xl w-[95vw] h-[95vh] flex flex-col border border-gray-200" style={{ maxWidth: '1400px' }}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-blue-600" />
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{documentViewer.filename}</h3>
                  {documentViewer.page && (
                    <p className="text-sm text-gray-500">Page {documentViewer.page}</p>
                  )}
                </div>
              </div>
              <button
                onClick={() => setDocumentViewer({ open: false, url: null, filename: null, page: null, loading: false, error: null })}
                className="p-2 hover:bg-gray-200 rounded-md transition-colors"
                aria-label="Close document viewer"
              >
                <X className="h-5 w-5 text-gray-600" />
              </button>
            </div>

            <div className="flex-1 overflow-hidden bg-white relative">
              {documentViewer.loading ? (
                <div className="flex flex-col items-center justify-center h-full">
                  <div className="animate-spin h-10 w-10 border-4 border-gray-200 border-t-blue-600 rounded-full mb-4"></div>
                  <p className="text-gray-600">Loading document...</p>
                </div>
              ) : documentViewer.error ? (
                <div className="flex flex-col items-center justify-center h-full p-6">
                  <div className="text-red-500 mb-4">
                    <FileText className="h-12 w-12 mx-auto mb-2" />
                    <p className="text-lg font-semibold">Failed to load document</p>
                  </div>
                  <p className="text-gray-600 text-center mb-4">{documentViewer.error}</p>
                  <button
                    onClick={() => setDocumentViewer({ open: false, url: null, filename: null, page: null, loading: false, error: null })}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                  >
                    Close
                  </button>
                </div>
              ) : documentViewer.url ? (
                <iframe
                  src={documentViewer.url}
                  className="w-full h-full border-0"
                  title={documentViewer.filename}
                  style={{ backgroundColor: 'white' }}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full">
                  <p className="text-gray-600">No document URL available</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Crimson+Text:ital,wght@0,400;0,600;0,700;1,400;1,600;1,700&family=Inter:wght@100..900&display=swap');

        .scrollbar-custom::-webkit-scrollbar {
          width: 8px;
        }
        .scrollbar-custom::-webkit-scrollbar-track {
          background: #f1f1f1;
          border-radius: 4px;
        }
        .scrollbar-custom::-webkit-scrollbar-thumb {
          background: #a0aec0;
          border-radius: 4px;
        }
        .scrollbar-custom::-webkit-scrollbar-thumb:hover {
          background: #718096;
        }

        .horizontal-scroll-container {
          overflow-x: auto;
          overflow-y: hidden;
          scrollbar-width: none;
        }

        .horizontal-scroll-container::-webkit-scrollbar {
          display: none;
        }

        :global(.analysis-page-ai-response) {
          font-family: "Crimson Text", Georgia, "Times New Roman", serif !important;
          font-size: 22px;
          line-height: 1.8;
          color: #111;
        }

        :global(.response-content h2) {
          font-size: 1.75rem;
          font-weight: 700;
          color: #1a202c;
          margin-top: 2rem;
          margin-bottom: 1rem;
        }

        :global(.response-content h3) {
          font-size: 1.4rem;
          font-weight: 600;
          color: #1a202c;
          margin-top: 1.5rem;
          margin-bottom: 0.75rem;
        }

        :global(.response-content p) {
          margin-bottom: 1rem;
          font-size: 20px;
          line-height: 1.8;
          color: #111827;
        }

        :global(.analysis-table) {
          width: 100%;
          border-collapse: collapse;
          margin: 1.5rem 0;
          font-family: "Inter", sans-serif;
          font-size: 17px;
          background-color: #ffffff;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
          overflow: hidden;
        }

        :global(.analysis-table thead) {
          background-color: #f9fafb;
        }

        :global(.analysis-table th) {
          padding: 0.9rem 1rem;
          border: 1px solid #e5e7eb;
          font-weight: 600;
          color: #374151;
          font-size: 16px;
          text-align: left;
          background-color: #f3f4f6;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        :global(.analysis-table td) {
          padding: 0.8rem 1rem;
          border: 1px solid #e5e7eb;
          color: #111827;
          vertical-align: middle;
          background-color: #ffffff;
          transition: background-color 0.2s ease-in-out;
          font-size: 16px;
        }

        :global(.analysis-table tbody tr:nth-child(even) td) {
          background-color: #fafafa;
        }

        :global(.analysis-table tbody tr:hover td) {
          background-color: #f1f5f9;
        }

        :global(.analysis-table tr:first-child th:first-child) {
          border-top-left-radius: 8px;
        }
        :global(.analysis-table tr:first-child th:last-child) {
          border-top-right-radius: 8px;
        }
        :global(.analysis-table tr:last-child td:first-child) {
          border-bottom-left-radius: 8px;
        }
        :global(.analysis-table tr:last-child td:last-child) {
          border-bottom-right-radius: 8px;
        }

        :global(.prose table),
        :global(.prose th),
        :global(.prose td) {
          font-family: "Crimson Text", Georgia, "Times New Roman", serif !important;
        }

        :global(.prose table) {
          font-size: 20px !important;
        }

        :global(.prose th) {
          font-size: 18px !important;
          font-weight: 600 !important;
        }

        :global(.prose td) {
          font-size: 18px !important;
        }

        :global(.analysis-table-wrapper) {
          overflow-x: auto;
          margin: 1rem 0;
          border-radius: 8px;
        }

        :global(.analysis-table td span) {
          display: inline-block;
          background-color: #fef2f2;
          color: #b91c1c;
          padding: 3px 8px;
          border-radius: 6px;
          font-weight: 500;
          font-size: 14px;
          line-height: 1.3;
        }

        :global(.response-content ul),
        :global(.response-content ol) {
          margin: 12px 0;
          padding-left: 28px;
          font-family: "Crimson Text", Georgia, "Times New Roman", serif;
          font-size: 20px;
        }

        :global(.response-content li) {
          margin: 8px 0;
          line-height: 1.8;
          font-size: 20px;
        }

        :global(.response-content strong) {
          font-weight: 700;
          color: #111827;
        }

        :global(.response-content code) {
          background-color: #f3f4f6;
          color: #dc2626;
          padding: 3px 8px;
          border-radius: 4px;
          font-family: 'Courier New', monospace;
          font-size: 16px;
        }

        :global(.response-content pre) {
          background-color: #1f2937;
          color: #f9fafb;
          padding: 20px;
          border-radius: 8px;
          overflow-x: auto;
          margin: 20px 0;
          font-family: 'Courier New', monospace;
          font-size: 15px;
        }

        :global(.response-content pre code) {
          background-color: transparent;
          color: #f9fafb;
          padding: 0;
        }

        :global(.response-content blockquote) {
          border-left: 4px solid #3b82f6;
          padding: 12px 16px;
          margin: 16px 0;
          background-color: #eff6ff;
          color: #1e40af;
          font-style: italic;
          border-radius: 0 6px 6px 0;
        }

        :global(.response-content a) {
          color: #2563eb;
          text-decoration: underline;
          font-weight: 500;
        }

        :global(.response-content hr) {
          border: none;
          border-top: 2px solid #e5e7eb;
          margin: 24px 0;
        }

        @keyframes statusSpin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default ChatInterface;