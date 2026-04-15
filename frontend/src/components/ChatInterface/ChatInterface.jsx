// import React, { useState, useEffect, useContext, useRef, useMemo, useCallback, startTransition } from "react";
// import { FileManagerContext } from "../../context/FileManagerContext";
// import documentApi from "../../services/documentApi";
// import { API_BASE_URL, GATEWAY_BASE_URL } from "../../config/apiConfig";
// import {
//   Plus,
//   Search,
//   BookOpen,
//   ChevronDown,
//   MoreVertical,
//   MessageSquare,
//   Loader2,
//   Send,
//   Copy,
//   Check,
//   Square,
//   Trash2,
//   FileText,
//   X,
//   ArrowRight,
// } from "lucide-react";
// import ReactMarkdown from "react-markdown";
// import remarkGfm from "remark-gfm";
// import rehypeRaw from "rehype-raw";
// import rehypeSanitize from "rehype-sanitize";
// import { SidebarContext } from "../../context/SidebarContext";
// import DownloadPdf from "../DownloadPdf/DownloadPdf";
// import { toast } from "react-toastify";
// import "../../styles/ChatInterface.css";
// import CitationsPanel from "../AnalysisPage/CitationsPanel";
// import apiService from "../../services/api";
// import { convertJsonToPlainText } from "../../utils/jsonToPlainText";
// import { renderSecretPromptResponse, isStructuredJsonResponse } from "../../utils/renderSecretPromptResponse";



// const ChatInterface = () => {
//   const {
//     selectedFolder,
//     setChatSessions,
//     selectedChatSessionId,
//     setSelectedChatSessionId,
//     setHasAiResponse,
//   } = useContext(FileManagerContext);
//   const { setForceSidebarCollapsed } = useContext(SidebarContext);
//   const [currentChatHistory, setCurrentChatHistory] = useState([]);
//   const [loadingChat, setLoadingChat] = useState(false);
//   const [chatError, setChatError] = useState(null);
//   const [chatInput, setChatInput] = useState("");
//   const [animatedResponseContent, setAnimatedResponseContent] = useState("");
//   const [thinkingContent, setThinkingContent] = useState("");
//   const [currentStatus, setCurrentStatus] = useState(null);
//   const [isAnimatingResponse, setIsAnimatingResponse] = useState(false);
//   const [selectedMessageId, setSelectedMessageId] = useState(null);
//   const [hasResponse, setHasResponse] = useState(false);
//   const [secrets, setSecrets] = useState([]);
//   const [isLoadingSecrets, setIsLoadingSecrets] = useState(false);
//   const [selectedSecretId, setSelectedSecretId] = useState(null);
//   const [selectedLlmName, setSelectedLlmName] = useState(null);
//   const [activeDropdown, setActiveDropdown] = useState("Custom Query");
//   const [showDropdown, setShowDropdown] = useState(false);
//   const [isSecretPromptSelected, setIsSecretPromptSelected] = useState(false);
//   const [copySuccess, setCopySuccess] = useState(false);
//   const [isGenerating, setIsGenerating] = useState(false);
//   const [needsHorizontalScroll, setNeedsHorizontalScroll] = useState(false);
//   const [scrollbarWidth, setScrollbarWidth] = useState(0);
//   const [showCitations, setShowCitations] = useState(false);
//   const [citations, setCitations] = useState([]);
//   const [loadingCitations, setLoadingCitations] = useState(false);
//   const [documentViewer, setDocumentViewer] = useState({ open: false, url: null, filename: null, page: null, loading: false, error: null });
//   const [isSmallScreen, setIsSmallScreen] = useState(() => {
//     if (typeof window === "undefined") return false;
//     return window.innerWidth < 1024;
//   });
//   const [openChatMenuId, setOpenChatMenuId] = useState(null);

//   const responseHasTable = useMemo(() => {
//     if (!animatedResponseContent) return false;
//     const htmlTablePattern = /<table/i.test(animatedResponseContent);
//     const markdownTablePattern = /(^|\n)\s*\|.+\|\s*($|\n)/.test(animatedResponseContent);
//     return htmlTablePattern || markdownTablePattern;
//   }, [animatedResponseContent]);

//   const formattedResponseContent = useMemo(() => {
//     const rawResponse = animatedResponseContent || '';
//     if (!rawResponse) return '';
    
//     const isStructured = isStructuredJsonResponse(rawResponse);
    
//     if (isStructured) {
//       return renderSecretPromptResponse(rawResponse);
//     }
    
//     return convertJsonToPlainText(rawResponse);
//   }, [animatedResponseContent]);

//   const shouldShowHorizontalScrollbar = useMemo(() => {
//     return isSmallScreen && responseHasTable && needsHorizontalScroll;
//   }, [isSmallScreen, responseHasTable, needsHorizontalScroll]);
//   const responseRef = useRef(null);
//   const dropdownRef = useRef(null);
//   const completeResponseRef = useRef(null);
//   const animationFrameRef = useRef(null);
//   const markdownOutputRef = useRef(null);
//   const horizontalScrollRef = useRef(null);
//   const stickyScrollbarRef = useRef(null);
//   const streamBufferRef = useRef('');
//   const streamThinkingRef = useRef('');
//   const streamUpdateTimeoutRef = useRef(null);
//   const streamReaderRef = useRef(null);
//   const chatMenuRefs = useRef({});
//   const panelStatesSetRef = useRef(false);
//   const fetchedFoldersRef = useRef(new Set());

//   const getAuthToken = () => {
//     const tokenKeys = [
//       "authToken",
//       "token",
//       "accessToken",
//       "jwt",
//       "bearerToken",
//       "auth_token",
//       "access_token",
//       "api_token",
//       "userToken",
//     ];
//     for (const key of tokenKeys) {
//       const token = localStorage.getItem(key);
//       if (token) return token;
//     }
//     return null;
//   };

//   const fetchDocumentUrl = async (fileId, pageNumber = null, token) => {
//     const GATEWAY_URL = GATEWAY_BASE_URL;
    
//     let url = pageNumber
//       ? `${GATEWAY_URL}/docs/file/${fileId}/view?page=${pageNumber}`
//       : `${GATEWAY_URL}/docs/file/${fileId}/view`;
    
//     console.log('[Document URL] Fetching from gateway:', url);
    
//     let response = await fetch(url, {
//       headers: {
//         'Authorization': `Bearer ${token}`,
//         'Content-Type': 'application/json'
//       }
//     });
    
//     if (!response.ok && response.status === 404) {
//       console.log('[Document URL] Primary gateway endpoint failed, trying fallback...');
//       url = pageNumber
//         ? `${GATEWAY_URL}/docs/${fileId}/view?page=${pageNumber}`
//         : `${GATEWAY_URL}/docs/${fileId}/view`;
      
//       console.log('[Document URL] Trying fallback gateway endpoint:', url);
      
//       response = await fetch(url, {
//         headers: {
//           'Authorization': `Bearer ${token}`,
//           'Content-Type': 'application/json'
//         }
//       });
//     }
    
//     if (!response.ok) {
//       const errorData = await response.json().catch(() => ({}));
//       throw new Error(errorData.message || errorData.error || `Failed to fetch document: ${response.status} ${response.statusText}`);
//     }
    
//     return await response.json();
//   };

//   const openDocumentAtPage = async (fileId, pageNumber, filename, token) => {
//     try {
//       const documentData = await fetchDocumentUrl(fileId, pageNumber, token);
      
//       const urlToOpen = documentData.viewUrlWithPage
//         || (pageNumber ? `${documentData.viewUrl}#page=${pageNumber}` : documentData.viewUrl)
//         || documentData.signedUrl;
      
//       if (!urlToOpen) {
//         throw new Error('No view URL available in response');
//       }
      
//       setDocumentViewer({
//         open: true,
//         url: urlToOpen,
//         filename: filename || documentData.document?.name || 'Document',
//         page: pageNumber,
//         loading: false
//       });
//     } catch (error) {
//       console.error('[Document] Error opening document:', error);
//       setDocumentViewer({
//         open: true,
//         url: null,
//         filename: filename || 'Document',
//         page: pageNumber,
//         loading: false,
//         error: error.message || 'Failed to load document'
//       });
//     }
//   };

//   const handleCopyResponse = async () => {
//     try {
//       await navigator.clipboard.writeText(animatedResponseContent);
//       setCopySuccess(true);
//       setTimeout(() => setCopySuccess(false), 2000);
//     } catch (error) {
//       console.error("Failed to copy:", error);
//       alert("Failed to copy to clipboard");
//     }
//   };

//   const skipAnimation = () => {
//     console.log('[ChatInterface] skipAnimation called');
    
//     if (animationFrameRef.current) {
//       cancelAnimationFrame(animationFrameRef.current);
//       clearTimeout(animationFrameRef.current);
//       animationFrameRef.current = null;
//     }
    
//     let completeResponse = '';
    
//     if (completeResponseRef.current) {
//       completeResponse = completeResponseRef.current;
//       console.log('[ChatInterface] skipAnimation: Found complete response in ref, length:', completeResponse.length);
//     }
    
//     if (!completeResponse && selectedMessageId) {
//       const selectedMessage = currentChatHistory.find(msg => msg.id === selectedMessageId);
//       if (selectedMessage) {
//         const rawResponse = selectedMessage.response || selectedMessage.answer || selectedMessage.message || "";
//         if (rawResponse) {
//           const isStructured = isStructuredJsonResponse(rawResponse);
//           completeResponse = isStructured
//             ? renderSecretPromptResponse(rawResponse)
//             : convertJsonToPlainText(rawResponse);
//           console.log('[ChatInterface] skipAnimation: Found response in message, length:', completeResponse.length);
//         }
//       }
//     }
    
//     if (!completeResponse && streamBufferRef.current) {
//       const rawResponse = streamBufferRef.current;
//       if (rawResponse) {
//         const isStructured = isStructuredJsonResponse(rawResponse);
//         completeResponse = isStructured
//           ? renderSecretPromptResponse(rawResponse)
//           : convertJsonToPlainText(rawResponse);
//         console.log('[ChatInterface] skipAnimation: Found response in streamBufferRef, length:', completeResponse.length);
//       }
//     }
    
//     if (!completeResponse && formattedResponseContent) {
//       completeResponse = formattedResponseContent;
//       console.log('[ChatInterface] skipAnimation: Using formattedResponseContent, length:', completeResponse.length);
//     }
    
//     if (completeResponse) {
//       setAnimatedResponseContent(completeResponse);
//       setIsAnimatingResponse(false);
//       setIsGenerating(false);
//       completeResponseRef.current = null;
//       console.log('[ChatInterface] skipAnimation: Animation skipped, complete response displayed');
//     } else {
//       console.warn('[ChatInterface] skipAnimation: No response found to skip to');
//     }
//   };

//   useEffect(() => {
//     const horizontalElement = horizontalScrollRef.current;
//     const contentElement = markdownOutputRef?.current;

//     if (!horizontalElement || !contentElement) return undefined;

//     const updateScrollbarState = () => {
//       const scrollWidth = contentElement.scrollWidth;
//       const clientWidth = horizontalElement.clientWidth;
//       const needsScroll = scrollWidth > clientWidth + 1;

//       setNeedsHorizontalScroll(needsScroll);
//       if (needsScroll) {
//         setScrollbarWidth(scrollWidth);
//       }
//     };

//     updateScrollbarState();

//     const resizeObserver = new ResizeObserver(updateScrollbarState);
//     resizeObserver.observe(contentElement);
//     resizeObserver.observe(horizontalElement);
//     window.addEventListener("resize", updateScrollbarState);

//     return () => {
//       resizeObserver.disconnect();
//       window.removeEventListener("resize", updateScrollbarState);
//     };
//   }, [selectedMessageId, animatedResponseContent, hasResponse]);

//   useEffect(() => {
//     if (!needsHorizontalScroll) return undefined;

//     const horizontalElement = horizontalScrollRef.current;
//     const stickyElement = stickyScrollbarRef.current;

//     if (!horizontalElement || !stickyElement) return undefined;

//     const syncSticky = () => {
//       stickyElement.scrollLeft = horizontalElement.scrollLeft;
//     };

//     const syncContent = () => {
//       horizontalElement.scrollLeft = stickyElement.scrollLeft;
//     };

//     stickyElement.scrollLeft = horizontalElement.scrollLeft;
//     horizontalElement.addEventListener("scroll", syncSticky);
//     stickyElement.addEventListener("scroll", syncContent);

//     return () => {
//       horizontalElement.removeEventListener("scroll", syncSticky);
//       stickyElement.removeEventListener("scroll", syncContent);
//     };
//   }, [needsHorizontalScroll, selectedMessageId]);

//   useEffect(() => {
//     const handleResize = () => {
//       setIsSmallScreen(window.innerWidth < 1024);
//     };
//     handleResize();
//     window.addEventListener("resize", handleResize);
//     return () => window.removeEventListener("resize", handleResize);
//   }, []);

//   const fetchSecrets = async () => {
//     try {
//       setIsLoadingSecrets(true);
//       setChatError(null);
//       const token = getAuthToken();
//       const headers = { "Content-Type": "application/json" };
//       if (token) headers["Authorization"] = `Bearer ${token}`;
//       const response = await fetch(`${API_BASE_URL}/files/secrets?fetch=true`, {
//         method: "GET",
//         headers,
//       });
//       if (!response.ok) throw new Error(`Failed to fetch secrets: ${response.status}`);
//       const secretsData = await response.json();
//       setSecrets(secretsData || []);
//       setActiveDropdown("Custom Query");
//       setSelectedSecretId(null);
//       setSelectedLlmName(null);
//       setIsSecretPromptSelected(false);
//     } catch (error) {
//       console.error("Error fetching secrets:", error);
//       setChatError(`Failed to load analysis prompts: ${error.message}`);
//     } finally {
//       setIsLoadingSecrets(false);
//     }
//   };

//   const fetchSecretValue = async (secretId) => {
//     try {
//       const existingSecret = secrets.find((secret) => secret.id === secretId);
//       if (existingSecret?.value) return existingSecret.value;
//       const token = getAuthToken();
//       const headers = { "Content-Type": "application/json" };
//       if (token) headers["Authorization"] = `Bearer ${token}`;
//       const response = await fetch(`${API_BASE_URL}/files/secrets/${secretId}`, {
//         method: "GET",
//         headers,
//       });
//       if (!response.ok) throw new Error(`Failed to fetch secret value: ${response.status}`);
//       const secretData = await response.json();
//       const promptValue = secretData.value || secretData.prompt || secretData.content || secretData;
//       setSecrets((prevSecrets) =>
//         prevSecrets.map((secret) =>
//           secret.id === secretId ? { ...secret, value: promptValue } : secret
//         )
//       );
//       return promptValue || "";
//     } catch (error) {
//       console.error("Error fetching secret value:", error);
//       throw new Error("Failed to retrieve analysis prompt");
//     }
//   };

//   const fetchChatHistory = useCallback(async (sessionId, folderName = null) => {
//     let folderToFetch = folderName;
//     if (!folderToFetch) {
//       if (typeof selectedFolder === 'string') {
//         folderToFetch = selectedFolder;
//       } else if (selectedFolder) {
//         folderToFetch = selectedFolder.originalname || selectedFolder.name || null;
//       }
//     }
//     if (!folderToFetch) {
//       console.log('[ChatInterface] fetchChatHistory: No folder to fetch, returning early. selectedFolder:', selectedFolder);
//       return;
//     }
//     console.log('[ChatInterface] fetchChatHistory: Starting fetch for folder:', folderToFetch, 'sessionId:', sessionId);
//     setLoadingChat(true);
//     setChatError(null);
//     try {
//       console.log('[ChatInterface] fetchChatHistory: Calling API...');
//       const data = await documentApi.getFolderChats(folderToFetch);
//       console.log('[ChatInterface] fetchChatHistory: API response:', data);
//       const chats = Array.isArray(data.chats) ? data.chats : [];
//       console.log('[ChatInterface] fetchChatHistory: Parsed chats array:', chats);
//       console.log('[ChatInterface] fetchChatHistory: Number of chats:', chats.length);
      
//       const chatsWithChunks = chats.map(chat => ({
//         ...chat,
//         response: chat.response || chat.answer || chat.message || "",
//         answer: chat.answer || chat.response || chat.message || "",
//         used_chunk_ids: chat.used_chunk_ids || [],
//         citations: chat.citations || null,
//         chunk_details: chat.chunk_details || null,
//         question: chat.question || chat.prompt_label || chat.promptLabel || chat.query || "Untitled",
//         prompt_label: chat.prompt_label || chat.promptLabel || null
//       }));
//       console.log('[ChatInterface] fetchChatHistory: Setting currentChatHistory with', chatsWithChunks.length, 'chats');
//       setCurrentChatHistory(prev => {
//         if (chatsWithChunks.length > 0) {
//           return chatsWithChunks;
//         }
//         return prev.length > 0 ? prev : chatsWithChunks;
//       });
      
//       if (sessionId) {
//         setSelectedChatSessionId(sessionId);
//         const selectedChat = chatsWithChunks.find((c) => c.id === sessionId);
//         if (selectedChat) {
//           const responseText = selectedChat.response || selectedChat.answer || selectedChat.message || "";
//           setSelectedMessageId(selectedChat.id);
//           const isStructured = isStructuredJsonResponse(responseText);
//           const formattedResponse = isStructured
//             ? renderSecretPromptResponse(responseText)
//             : convertJsonToPlainText(responseText);
//           setAnimatedResponseContent(formattedResponse);
//           setIsAnimatingResponse(false);
//           setIsGenerating(false);
//           setHasResponse(true);
//           setHasAiResponse(true);
//           setForceSidebarCollapsed(true);
//           console.log('[ChatInterface] Selected chat has used_chunk_ids:', selectedChat.used_chunk_ids);
//           console.log('[ChatInterface] Selected chat has citations:', selectedChat.citations);
//           setCitations([]);
//           setShowCitations(false);
//         }
//       } else {
//         setHasResponse(false);
//         setHasAiResponse(false);
//         setForceSidebarCollapsed(false);
//       }
//     } catch (err) {
//       console.error("[ChatInterface] fetchChatHistory: Error fetching chats:", err);
//       console.error("[ChatInterface] fetchChatHistory: Error details:", err.response?.data || err.message);
//       setChatError("Failed to fetch chat history.");
//     } finally {
//       setLoadingChat(false);
//       console.log('[ChatInterface] fetchChatHistory: Completed');
//     }
//   }, [selectedFolder]);

//   useEffect(() => {
//     const fetchCitations = async () => {
//       const folderName = typeof selectedFolder === 'string' ? selectedFolder : (selectedFolder?.originalname || selectedFolder?.name || null);
//       if (!selectedMessageId || !folderName) {
//         console.log('[Citations] Missing selectedMessageId or selectedFolder:', { selectedMessageId, selectedFolder, folderName });
//         setCitations([]);
//         setLoadingCitations(false);
//         return;
//       }

//       const message = currentChatHistory.find(msg => msg.id === selectedMessageId);
//       console.log('[Citations] Selected message:', message);
//       console.log('[Citations] Message has chunk_details:', message?.chunk_details);
//       console.log('[Citations] Message has citations:', message?.citations);
//       console.log('[Citations] Message has used_chunk_ids:', message?.used_chunk_ids);
      
//       if (!message) {
//         console.log('[Citations] Message not found in currentChatHistory, currentChatHistory length:', currentChatHistory.length);
//         setCitations([]);
//         setLoadingCitations(false);
//         return;
//       }
      
//       if (message.chunk_details && Array.isArray(message.chunk_details) && message.chunk_details.length > 0) {
//         console.log('[Citations] Using chunk_details from message:', message.chunk_details);
//         const formattedCitations = message.chunk_details.map((chunk) => {
//           const page = chunk.page || null;
//           const pageLabel = chunk.page_label || (page ? `Page ${page}` : null);
//           const filename = chunk.filename || 'document.pdf';
//           const fileId = chunk.file_id || chunk.fileId;
//           const text = chunk.content_preview || chunk.content || chunk.text || '';

//           const source = pageLabel 
//             ? `${filename} - ${pageLabel}`
//             : filename;

//           return {
//             page: page,
//             pageStart: page,
//             pageEnd: page,
//             pageLabel: pageLabel,
//             source: source,
//             filename: filename,
//             fileId: fileId,
//             text: text,
//             link: `${filename}#page=${page || 1}`,
//             viewUrl: fileId ? `${API_BASE_URL}/docs/file/${fileId}/view?page=${page || 1}` : null
//           };
//         });
//         console.log('[Citations] Formatted citations from chunk_details:', formattedCitations);
//         setCitations(formattedCitations);
//         setLoadingCitations(false);
//         return;
//       }

//       if (message.citations && Array.isArray(message.citations) && message.citations.length > 0) {
//         console.log('[Citations] Using citations from message metadata:', message.citations);
//         const formattedCitations = message.citations.map((citation) => {
//           const pageStart = citation.page_start || citation.pageStart;
//           const pageEnd = citation.page_end || citation.pageEnd;
//           const page = citation.page || pageStart;
          
//           let pageLabel = null;
//           if (pageStart && pageEnd && pageStart !== pageEnd) {
//             pageLabel = `Pages ${pageStart}-${pageEnd}`;
//           } else if (page || pageStart) {
//             pageLabel = `Page ${page || pageStart}`;
//           }

//           const source = pageLabel 
//             ? `${citation.filename || 'document.pdf'} - ${pageLabel}`
//             : (citation.filename || 'document.pdf');

//           return {
//             page: page || pageStart,
//             pageStart: pageStart,
//             pageEnd: pageEnd,
//             pageLabel: pageLabel,
//             source: source,
//             filename: citation.filename || 'document.pdf',
//             fileId: citation.fileId || citation.file_id,
//             text: citation.text || citation.content || citation.text_preview || '',
//             link: `${citation.filename || 'document.pdf'}#page=${page || pageStart || 1}`,
//             viewUrl: citation.viewUrl || (citation.fileId ? `${API_BASE_URL}/docs/file/${citation.fileId}/view?page=${page || pageStart || 1}` : null)
//           };
//         });
//         console.log('[Citations] Formatted citations from metadata:', formattedCitations);
//         setCitations(formattedCitations);
//         setLoadingCitations(false);
//         return;
//       }
      
//       if (!message.used_chunk_ids || message.used_chunk_ids.length === 0) {
//         console.log('[Citations] No used_chunk_ids or citations in message:', message.used_chunk_ids);
//         setCitations([]);
//         setShowCitations(false);
//         return;
//       }

//       console.log('[Citations] Fetching chunks for:', message.used_chunk_ids);
//       setLoadingCitations(true);
//       try {
//         const folderName = typeof selectedFolder === 'string' ? selectedFolder : (selectedFolder?.originalname || selectedFolder?.name || null);
//         if (!folderName) {
//           console.error('[Citations] Invalid folder name:', selectedFolder);
//           setCitations([]);
//           setLoadingCitations(false);
//           return;
//         }
//         const chunkDetails = await apiService.getFolderChunkDetails(message.used_chunk_ids, folderName);
//         console.log('[Citations] Received chunk details:', chunkDetails);
        
//         const formattedCitations = chunkDetails.map((chunk) => {
//           let pageLabel = chunk.page_range || null;
//           let page = null;
//           let pageStart = null;
//           let pageEnd = null;
          
//           if (pageLabel) {
//             const pageMatch = pageLabel.match(/(?:Pages? )?(\d+)(?:-(\d+))?/i);
//             if (pageMatch) {
//               pageStart = parseInt(pageMatch[1]);
//               pageEnd = pageMatch[2] ? parseInt(pageMatch[2]) : pageStart;
//               page = pageStart;
              
//               if (pageStart === pageEnd) {
//                 pageLabel = `Page ${pageStart}`;
//               } else {
//                 pageLabel = `Pages ${pageStart}-${pageEnd}`;
//               }
//             }
//           }

//           const source = pageLabel 
//             ? `${chunk.filename || 'document.pdf'} - ${pageLabel}`
//             : (chunk.filename || 'document.pdf');

//           return {
//             page: page || pageStart,
//             pageStart: pageStart,
//             pageEnd: pageEnd,
//             pageLabel: pageLabel,
//             source: source,
//             filename: chunk.filename || 'document.pdf',
//             fileId: chunk.file_id || chunk.fileId,
//             text: chunk.content || chunk.text || '',
//             link: `${chunk.filename || 'document.pdf'}#page=${page || pageStart || 1}`,
//             viewUrl: chunk.file_id ? `${API_BASE_URL}/docs/file/${chunk.file_id}/view?page=${page || pageStart || 1}` : null
//           };
//         });

//         console.log('[Citations] Formatted citations:', formattedCitations);
//         setCitations(formattedCitations);
//       } catch (error) {
//         console.error('[Citations] Failed to fetch citations:', error);
//         setCitations([]);
//       } finally {
//         setLoadingCitations(false);
//       }
//     };

//     fetchCitations();
//   }, [selectedMessageId, selectedFolder, currentChatHistory]);

//   const animateResponse = (text, skipAnimation = false, isAlreadyFormatted = false) => {
//     const plainText = isAlreadyFormatted ? text : convertJsonToPlainText(text);
    
//     completeResponseRef.current = plainText;
    
//     if (!plainText || typeof plainText !== 'string') {
//       setIsAnimatingResponse(false);
//       setIsGenerating(false);
//       setAnimatedResponseContent(plainText || '');
//       completeResponseRef.current = null;
//       return;
//     }

//     if (animationFrameRef.current) {
//       cancelAnimationFrame(animationFrameRef.current);
//       clearTimeout(animationFrameRef.current);
//       animationFrameRef.current = null;
//     }

//     const contentMatches = animatedResponseContent.trim() === plainText.trim() || 
//                           animatedResponseContent === plainText ||
//                           (animatedResponseContent.length > 0 && plainText.startsWith(animatedResponseContent));
    
//     if (contentMatches && !skipAnimation) {
//       setIsAnimatingResponse(false);
//       setIsGenerating(false);
//       if (animatedResponseContent !== plainText) {
//         setAnimatedResponseContent(plainText);
//       }
//       return;
//     }

//     if (!skipAnimation && !plainText.startsWith(animatedResponseContent) && animatedResponseContent !== plainText) {
//       setAnimatedResponseContent("");
//     }
//     setIsAnimatingResponse(!skipAnimation);
//     setIsGenerating(!skipAnimation);

//     const words = plainText.split(/(\s+)/);
//     let currentIndex = 0;
//     let displayedText = '';

//     if (words.length <= 3) {
//       setIsAnimatingResponse(false);
//       setIsGenerating(false);
//       setAnimatedResponseContent(plainText);
//       return;
//     }

//     const animateWord = () => {
//       if (currentIndex < words.length) {
//         displayedText += words[currentIndex];
//         setAnimatedResponseContent(displayedText);
//         currentIndex++;

//         if (responseRef.current) {
//           responseRef.current.scrollTop = responseRef.current.scrollHeight;
//         }

//         const word = words[currentIndex - 1];
//         let delay = 15;
        
//         if (word.trim().length === 0) {
//           delay = 3;
//         } else if (word.length > 15) {
//           delay = 25;
//         } else if (word.length > 10) {
//           delay = 20;
//         } else if (/[.!?]\s*$/.test(word)) {
//           delay = 40;
//         } else if (/[,;:]\s*$/.test(word)) {
//           delay = 20;
//         } else if (/^[#*`\-]/.test(word)) {
//           delay = 8;
//         }

//         animationFrameRef.current = setTimeout(animateWord, delay);
//       } else {
//         setIsAnimatingResponse(false);
//         setIsGenerating(false);
//         completeResponseRef.current = null;
//         setAnimatedResponseContent(plainText);
//         animationFrameRef.current = null;
//       }
//     };

//     animationFrameRef.current = setTimeout(animateWord, 20);
//   };

//   const handleStopGeneration = () => {
//     if (animationFrameRef.current) {
//       cancelAnimationFrame(animationFrameRef.current);
//       clearTimeout(animationFrameRef.current);
//       animationFrameRef.current = null;
//     }
//     if (streamBufferRef.current) {
//       const isStructured = isStructuredJsonResponse(streamBufferRef.current);
//       const formattedResponse = isStructured
//         ? renderSecretPromptResponse(streamBufferRef.current)
//         : convertJsonToPlainText(streamBufferRef.current);
//       setAnimatedResponseContent(formattedResponse);
//     }
//     setIsAnimatingResponse(false);
//     setIsGenerating(false);
//     setLoadingChat(false);
//   };

//   useEffect(() => {
//     return () => {
//       if (animationFrameRef.current) {
//         cancelAnimationFrame(animationFrameRef.current);
//         clearTimeout(animationFrameRef.current);
//       }
//       if (streamReaderRef.current) {
//         streamReaderRef.current.cancel().catch(() => {});
//       }
//       if (streamUpdateTimeoutRef.current) {
//         clearTimeout(streamUpdateTimeoutRef.current);
//       }
//     };
//   }, []);

//   const chatWithAI = async (folder, secretId, currentSessionId) => {
//     setAnimatedResponseContent('');
//     setThinkingContent('');
//     setCurrentStatus(null);
//     streamBufferRef.current = '';
//     streamThinkingRef.current = '';
//     setChatError(null);
//     setLoadingChat(true);
//     setIsAnimatingResponse(false);
    
//     if (streamReaderRef.current) {
//       try {
//         await streamReaderRef.current.cancel();
//       } catch (e) {
//       }
//       streamReaderRef.current = null;
//     }
    
//     if (streamUpdateTimeoutRef.current) {
//       clearTimeout(streamUpdateTimeoutRef.current);
//       streamUpdateTimeoutRef.current = null;
//     }

//     try {
//       const isContinuingSession = !!currentSessionId && currentChatHistory.length > 0;
//       if (!isContinuingSession && !panelStatesSetRef.current) {
//         setHasResponse(true);
//         setHasAiResponse(true);
//         setForceSidebarCollapsed(true);
//         panelStatesSetRef.current = true;
//       }
//       const selectedSecret = secrets.find((s) => s.id === secretId);
//       if (!selectedSecret) throw new Error("No prompt found for selected analysis type");
//       const promptLabel = selectedSecret.name;

//       const token = getAuthToken();
//       const response = await fetch(`${API_BASE_URL}/docs/${folder}/intelligent-chat/stream`, {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//           'Authorization': token ? `Bearer ${token}` : '',
//           'Accept': 'text/event-stream',
//         },
//         body: JSON.stringify({
//           secret_id: secretId,
//           session_id: currentSessionId,
//           llm_name: 'gemini',
//         }),
//       });

//       if (!response.ok) {
//         throw new Error(`HTTP error! status: ${response.status}`);
//       }

//       const reader = response.body.getReader();
//       streamReaderRef.current = reader;
//       const decoder = new TextDecoder();
//       let buffer = '';
//       let newSessionId = currentSessionId;
//       let finalMetadata = null;
//       let messageId = Date.now().toString();

//       while (true) {
//         const { done, value } = await reader.read();
        
//         if (done) {
//           setLoadingChat(false);
//           const isStructured = isStructuredJsonResponse(streamBufferRef.current);
//           let finalResponse = isStructured
//             ? renderSecretPromptResponse(streamBufferRef.current)
//             : convertJsonToPlainText(streamBufferRef.current);
//           if (finalMetadata) {
//             newSessionId = finalMetadata.session_id || finalMetadata.sessionId || newSessionId;
//             messageId = finalMetadata.message_id || finalMetadata.id || messageId;
//           }
          
//           let usedChunkIds = finalMetadata?.used_chunk_ids || [];
//           if (!usedChunkIds.length && finalMetadata?.citations && Array.isArray(finalMetadata.citations)) {
//             usedChunkIds = finalMetadata.citations.map(cit => cit.chunk_id || cit.id).filter(Boolean);
//           }
          
//           const newMessage = {
//             id: messageId,
//             question: promptLabel,
//             prompt_label: promptLabel,
//             response: finalResponse,
//             timestamp: new Date().toISOString(),
//             created_at: new Date().toISOString(),
//             isSecretPrompt: true,
//             used_secret_prompt: true,
//             used_chunk_ids: usedChunkIds,
//             citations: finalMetadata?.citations || null,
//             chunk_details: finalMetadata?.chunk_details || null,
//           };
//           const history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
//           setCurrentChatHistory(history);
          
//           if (newSessionId) {
//             setSelectedChatSessionId(newSessionId);
//           }
          
//           if (finalResponse && finalResponse.trim()) {
//             setSelectedMessageId(messageId);
//             if (!panelStatesSetRef.current) {
//               setHasResponse(true);
//               setHasAiResponse(true);
//               setForceSidebarCollapsed(true);
//               panelStatesSetRef.current = true;
//             }
//             if (finalResponse && finalResponse.trim()) {
//               animateResponse(finalResponse, false, true);
//             } else {
//               setIsAnimatingResponse(false);
//               setIsGenerating(false);
//             }
//           }
//           break;
//         }

//         buffer += decoder.decode(value, { stream: true });
//         const lines = buffer.split('\n');
//         buffer = lines.pop() || '';

//         for (const line of lines) {
//           if (!line.trim() || !line.startsWith('data: ')) continue;
          
//           const data = line.replace(/^data: /, '').trim();
          
//           if (data === '[PING]') {
//             continue;
//           }
          
//           if (data === '[DONE]') {
//             setLoadingChat(false);
//             const isStructured = isStructuredJsonResponse(streamBufferRef.current);
//             let finalResponse = isStructured
//               ? renderSecretPromptResponse(streamBufferRef.current)
//               : convertJsonToPlainText(streamBufferRef.current);
//             if (finalMetadata) {
//               newSessionId = finalMetadata.session_id || finalMetadata.sessionId || newSessionId;
//               messageId = finalMetadata.message_id || finalMetadata.id || messageId;
//             }
            
//             let usedChunkIds = finalMetadata?.used_chunk_ids || [];
//             if (!usedChunkIds.length && finalMetadata?.citations && Array.isArray(finalMetadata.citations)) {
//               usedChunkIds = finalMetadata.citations.map(cit => cit.chunk_id || cit.id).filter(Boolean);
//             }
            
//             const newMessage = {
//               id: messageId,
//               question: promptLabel,
//               prompt_label: promptLabel,
//               response: finalResponse,
//               timestamp: new Date().toISOString(),
//               created_at: new Date().toISOString(),
//               isSecretPrompt: true,
//               used_secret_prompt: true,
//               used_chunk_ids: usedChunkIds,
//               citations: finalMetadata?.citations || null,
//               chunk_details: finalMetadata?.chunk_details || null,
//             };
//             const history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
//             setCurrentChatHistory(history);
            
//             if (newSessionId) {
//               setSelectedChatSessionId(newSessionId);
//             }
            
//             if (finalResponse && finalResponse.trim()) {
//               setSelectedMessageId(messageId);
//               if (!panelStatesSetRef.current) {
//                 setHasResponse(true);
//                 setHasAiResponse(true);
//                 setForceSidebarCollapsed(true);
//                 panelStatesSetRef.current = true;
//               }
//               if (finalResponse && finalResponse.trim()) {
//                 animateResponse(finalResponse, false, true);
//               } else {
//                 setIsAnimatingResponse(false);
//                 setIsGenerating(false);
//               }
//             }
//             return;
//           }

//           try {
//             const parsed = JSON.parse(data);
            
//             if (parsed.type === 'metadata') {
//               console.log('Stream metadata:', parsed);
//               newSessionId = parsed.session_id || parsed.sessionId || newSessionId;
//               messageId = parsed.message_id || parsed.id || messageId;
//               if (!finalMetadata) finalMetadata = {};
//               finalMetadata = { ...finalMetadata, ...parsed };
//               } else if (parsed.type === 'status') {
//                 setCurrentStatus({
//                   status: parsed.status,
//                   message: parsed.message || parsed.status,
//                 });
//                 console.log('Status:', parsed.status, parsed.message);
//               } else if (parsed.type === 'thinking') {
//               const thinkingText = parsed.text || '';
//               if (thinkingText) {
//                 streamThinkingRef.current += thinkingText;
//                 if (streamUpdateTimeoutRef.current) {
//                   clearTimeout(streamUpdateTimeoutRef.current);
//                 }
//                 streamUpdateTimeoutRef.current = setTimeout(() => {
//                   setThinkingContent(streamThinkingRef.current);
//                 }, 10);
//               }
//             } else if (parsed.type === 'chunk') {
//               const chunkText = parsed.text || '';
//               if (chunkText) {
//                 streamBufferRef.current += chunkText;
//               }
//             } else if (parsed.type === 'done') {
//               finalMetadata = { ...finalMetadata, ...parsed };
//               console.log('[ChatInterface] Done metadata (secret prompt):', finalMetadata);
//               console.log('[ChatInterface] used_chunk_ids:', finalMetadata?.used_chunk_ids);
//               console.log('[ChatInterface] citations:', finalMetadata?.citations);
//               console.log('[ChatInterface] chunk_details:', finalMetadata?.chunk_details);
              
//               let usedChunkIds = finalMetadata?.used_chunk_ids || [];
//               if (!usedChunkIds.length && finalMetadata?.citations && Array.isArray(finalMetadata.citations)) {
//                 usedChunkIds = finalMetadata.citations.map(cit => cit.chunk_id || cit.id).filter(Boolean);
//               }
              
//                 const isStructured = isStructuredJsonResponse(streamBufferRef.current);
//                 let finalResponse = isStructured
//                   ? renderSecretPromptResponse(streamBufferRef.current)
//                   : convertJsonToPlainText(streamBufferRef.current);
//                 setLoadingChat(false);
//                 setCurrentStatus(null);
//                 if (streamThinkingRef.current) {
//                   setThinkingContent(streamThinkingRef.current);
//                 }
                
//               const messageId = finalMetadata?.message_id || finalMetadata?.id || Date.now().toString();
//               const newMessage = {
//                 id: messageId,
//                 question: questionText,
//                 response: finalResponse,
//                 timestamp: new Date().toISOString(),
//                 created_at: new Date().toISOString(),
//                 isSecretPrompt: false,
//                 used_chunk_ids: usedChunkIds,
//                 citations: finalMetadata?.citations || null,
//                 chunk_details: finalMetadata?.chunk_details || null,
//               };
//               const history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
//               setCurrentChatHistory(history);
//               setSelectedMessageId(newMessage.id);
              
//               if (!panelStatesSetRef.current) {
//                 setHasResponse(true);
//                 setHasAiResponse(true);
//                 setForceSidebarCollapsed(true);
//                 panelStatesSetRef.current = true;
//               }
              
//               if (finalResponse && finalResponse.trim()) {
//                 animateResponse(finalResponse, false, true);
//               } else {
//                 setIsAnimatingResponse(false);
//                 setIsGenerating(false);
//               }
//             } else if (parsed.type === 'error') {
//               setChatError(parsed.message || parsed.error);
//               setLoadingChat(false);
//             }
//           } catch (e) {
//           }
//         }
//       }
//     } catch (error) {
//       console.error("Chat error:", error);
//       setChatError(`Analysis failed: ${error.message}`);
//       setHasResponse(false);
//       setHasAiResponse(false);
//       setForceSidebarCollapsed(false);
//       throw error;
//     } finally {
//       setLoadingChat(false);
//       streamReaderRef.current = null;
//     }
//   };

//   const handleNewMessage = async () => {
//     if (!selectedFolder) return;
//     if (isSecretPromptSelected) {
//       if (!selectedSecretId) {
//         setChatError("Please select an analysis type.");
//         return;
//       }
//       await chatWithAI(selectedFolder, selectedSecretId, selectedChatSessionId);
//       setChatInput("");
//       setIsSecretPromptSelected(false);
//       setActiveDropdown("Custom Query");
//       setSelectedSecretId(null);
//       setSelectedLlmName(null);
//     } else {
//       if (!chatInput.trim()) return;
//       const questionText = chatInput.trim();
      
//       setAnimatedResponseContent('');
//       setThinkingContent('');
//       streamBufferRef.current = '';
//       streamThinkingRef.current = '';
//       setChatError(null);
//       setLoadingChat(true);
//       setIsAnimatingResponse(false);
//       panelStatesSetRef.current = false;
      
//       if (streamReaderRef.current) {
//         try {
//           await streamReaderRef.current.cancel();
//         } catch (e) {
//         }
//         streamReaderRef.current = null;
//       }
      
//       if (streamUpdateTimeoutRef.current) {
//         clearTimeout(streamUpdateTimeoutRef.current);
//         streamUpdateTimeoutRef.current = null;
//       }

//       const isContinuingSession = !!selectedChatSessionId && currentChatHistory.length > 0;
//       if (!isContinuingSession && !panelStatesSetRef.current) {
//         setHasResponse(true);
//         setHasAiResponse(true);
//         setForceSidebarCollapsed(true);
//         panelStatesSetRef.current = true;
//       }
      
//       try {
//         const token = getAuthToken();
//         const response = await fetch(`${API_BASE_URL}/docs/${selectedFolder}/intelligent-chat/stream`, {
//           method: 'POST',
//           headers: {
//             'Content-Type': 'application/json',
//             'Authorization': token ? `Bearer ${token}` : '',
//             'Accept': 'text/event-stream',
//           },
//           body: JSON.stringify({
//             question: questionText,
//             session_id: selectedChatSessionId,
//             llm_name: 'gemini',
//           }),
//         });

//         if (!response.ok) {
//           throw new Error(`HTTP error! status: ${response.status}`);
//         }

//         const reader = response.body.getReader();
//         streamReaderRef.current = reader;
//         const decoder = new TextDecoder();
//         let buffer = '';
//         let newSessionId = selectedChatSessionId;
//         let finalMetadata = null;
//         let messageId = Date.now().toString();

//         while (true) {
//           const { done, value } = await reader.read();
          
//           if (done) {
//             setLoadingChat(false);
//             const isStructured = isStructuredJsonResponse(streamBufferRef.current);
//             let finalResponse = isStructured
//               ? renderSecretPromptResponse(streamBufferRef.current)
//               : convertJsonToPlainText(streamBufferRef.current);
//             if (finalMetadata) {
//               newSessionId = finalMetadata.session_id || finalMetadata.sessionId || newSessionId;
//               messageId = finalMetadata.message_id || finalMetadata.id || messageId;
//             }
            
//             let usedChunkIds = finalMetadata?.used_chunk_ids || [];
            
//             if (!usedChunkIds.length && finalMetadata?.citations && Array.isArray(finalMetadata.citations)) {
//               usedChunkIds = finalMetadata.citations
//                 .map(cit => cit.chunk_id || cit.id || cit.chunkId)
//                 .filter(Boolean);
//             }
            
//             const newMessage = {
//               id: messageId,
//               question: questionText,
//               response: finalResponse,
//               timestamp: new Date().toISOString(),
//               created_at: new Date().toISOString(),
//               isSecretPrompt: false,
//               used_chunk_ids: usedChunkIds,
//               citations: finalMetadata?.citations || null,
//             };
//             const history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
//             setCurrentChatHistory(history);
            
//             if (newSessionId) {
//               setSelectedChatSessionId(newSessionId);
//             }
            
//             if (finalResponse && finalResponse.trim()) {
//               setSelectedMessageId(messageId);
//               if (!panelStatesSetRef.current) {
//                 setHasResponse(true);
//                 setHasAiResponse(true);
//                 setForceSidebarCollapsed(true);
//                 panelStatesSetRef.current = true;
//               }
//               const contentMatches = animatedResponseContent.trim() === finalResponse.trim() || 
//                                     animatedResponseContent === finalResponse ||
//                                     (animatedResponseContent.length > 0 && finalResponse.startsWith(animatedResponseContent));
              
//               if (finalResponse && finalResponse.trim()) {
//                 animateResponse(finalResponse, false, true);
//               } else {
//                 setIsAnimatingResponse(false);
//                 setIsGenerating(false);
//               }
//             }
//             setChatInput("");
//             break;
//           }

//           buffer += decoder.decode(value, { stream: true });
//           const lines = buffer.split('\n');
//           buffer = lines.pop() || '';

//           for (const line of lines) {
//             if (!line.trim() || !line.startsWith('data: ')) continue;
            
//             const data = line.replace(/^data: /, '').trim();
            
//             if (data === '[PING]') {
//               continue;
//             }
            
//             if (data === '[DONE]') {
//               setLoadingChat(false);
//               const isStructured = isStructuredJsonResponse(streamBufferRef.current);
//               let finalResponse = isStructured
//                 ? renderSecretPromptResponse(streamBufferRef.current)
//                 : convertJsonToPlainText(streamBufferRef.current);
//               if (finalMetadata) {
//                 newSessionId = finalMetadata.session_id || finalMetadata.sessionId || newSessionId;
//                 messageId = finalMetadata.message_id || finalMetadata.id || messageId;
//               }
              
//             let usedChunkIds = finalMetadata?.used_chunk_ids || [];
            
//             if (!usedChunkIds.length && finalMetadata?.citations && Array.isArray(finalMetadata.citations)) {
//               usedChunkIds = finalMetadata.citations
//                 .map(cit => cit.chunk_id || cit.id || cit.chunkId)
//                 .filter(Boolean);
//               console.log('[ChatInterface] Extracted chunk IDs from citations:', usedChunkIds);
//             }
            
//             const newMessage = {
//               id: messageId,
//               question: questionText,
//               response: finalResponse,
//               timestamp: new Date().toISOString(),
//               created_at: new Date().toISOString(),
//               isSecretPrompt: false,
//               used_chunk_ids: usedChunkIds,
//               citations: finalMetadata?.citations || null,
//               chunk_details: finalMetadata?.chunk_details || null,
//             };
//               const history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
//               setCurrentChatHistory(history);
              
//               if (newSessionId) {
//                 setSelectedChatSessionId(newSessionId);
//               }
              
//               if (finalResponse && finalResponse.trim()) {
//                 setSelectedMessageId(messageId);
//                 setHasResponse(true);
//                 setHasAiResponse(true);
//                 setForceSidebarCollapsed(true);
//                 animateResponse(finalResponse);
//               }
//               setChatInput("");
//               return;
//             }

//             try {
//               const parsed = JSON.parse(data);
              
//               if (parsed.type === 'metadata') {
//                 console.log('Stream metadata:', parsed);
//                 newSessionId = parsed.session_id || parsed.sessionId || newSessionId;
//                 messageId = parsed.message_id || parsed.id || messageId;
//               } else if (parsed.type === 'status') {
//                 setCurrentStatus({
//                   status: parsed.status,
//                   message: parsed.message || parsed.status,
//                 });
//                 console.log('Status:', parsed.status, parsed.message);
//               } else if (parsed.type === 'chunk') {
//                 const chunkText = parsed.text || '';
//                 if (chunkText) {
//                   streamBufferRef.current += chunkText;
//                 }
//               } else if (parsed.type === 'done') {
//                 finalMetadata = parsed;
//                 console.log('[ChatInterface] Final metadata received:', finalMetadata);
//                 console.log('[ChatInterface] used_chunk_ids:', finalMetadata?.used_chunk_ids);
//                 console.log('[ChatInterface] citations:', finalMetadata?.citations);
//                 console.log('[ChatInterface] chunk_details:', finalMetadata?.chunk_details);
                
//                 let usedChunkIds = finalMetadata?.used_chunk_ids || [];
                
//                 if (!usedChunkIds.length && finalMetadata?.citations && Array.isArray(finalMetadata.citations)) {
//                   usedChunkIds = finalMetadata.citations.map(cit => cit.chunk_id || cit.id).filter(Boolean);
//                   console.log('[ChatInterface] Extracted chunk IDs from citations:', usedChunkIds);
//                 }
                
//                 if (!usedChunkIds.length && finalMetadata?.citations) {
//                   const citations = Array.isArray(finalMetadata.citations) 
//                     ? finalMetadata.citations 
//                     : Object.values(finalMetadata.citations || {});
//                   usedChunkIds = citations.map(cit => cit.chunk_id || cit.id).filter(Boolean);
//                 }
                
//                 const isStructured = isStructuredJsonResponse(streamBufferRef.current);
//                 let finalResponse = isStructured
//                   ? renderSecretPromptResponse(streamBufferRef.current)
//                   : convertJsonToPlainText(streamBufferRef.current);
//                 setLoadingChat(false);
//                 setCurrentStatus(null);
//                 if (streamThinkingRef.current) {
//                   setThinkingContent(streamThinkingRef.current);
//                 }
                
//                 const newMessage = {
//                   id: finalMetadata.message_id || finalMetadata.id || messageId,
//                   question: questionText,
//                   response: finalResponse,
//                   timestamp: new Date().toISOString(),
//                   created_at: new Date().toISOString(),
//                   isSecretPrompt: false,
//                   used_chunk_ids: usedChunkIds,
//                   citations: finalMetadata?.citations || null,
//                   chunk_details: finalMetadata?.chunk_details || null,
//                 };
//                 const history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
//                 setCurrentChatHistory(history);
//                 setSelectedMessageId(newMessage.id);
                
//                 if (finalResponse && finalResponse.trim()) {
//                   animateResponse(finalResponse, false, true);
//                 } else {
//                   setIsAnimatingResponse(false);
//                   setIsGenerating(false);
//                 }
//               } else if (parsed.type === 'error') {
//                 setChatError(parsed.message || parsed.error);
//                 setLoadingChat(false);
//               }
//             } catch (e) {
//             }
//           }
//         }
//       } catch (err) {
//         console.error("Error sending message:", err);
//         setChatError(`Failed to send message: ${err.response?.data?.details || err.message}`);
//         setHasResponse(false);
//         setHasAiResponse(false);
//         setForceSidebarCollapsed(false);
//       } finally {
//         setLoadingChat(false);
//         streamReaderRef.current = null;
//       }
//     }
//   };

//   const handleSelectChat = (chat) => {
//     console.log('[ChatInterface] handleSelectChat called with chat:', chat);
//     console.log('[ChatInterface] Chat has chunk_details:', chat?.chunk_details);
//     console.log('[ChatInterface] Chat has citations:', chat?.citations);
//     console.log('[ChatInterface] Chat has used_chunk_ids:', chat?.used_chunk_ids);
//     if (animationFrameRef.current) {
//       cancelAnimationFrame(animationFrameRef.current);
//       clearTimeout(animationFrameRef.current);
//       animationFrameRef.current = null;
//     }
//     const responseText = chat.response || chat.answer || chat.message || "";
//     const isStructured = isStructuredJsonResponse(responseText);
//     const formattedResponse = isStructured
//       ? renderSecretPromptResponse(responseText)
//       : convertJsonToPlainText(responseText);
//     startTransition(() => {
//       setSelectedMessageId(chat.id);
//       setAnimatedResponseContent(formattedResponse);
//       setIsAnimatingResponse(false);
//       setIsGenerating(false);
//       setHasResponse(true);
//       setHasAiResponse(true);
//       setForceSidebarCollapsed(true);
//     });
//     setCitations([]);
//     setShowCitations(false);
//     setLoadingCitations(true);
//   };

//   const handleDeleteChat = async (chatId, e) => {
//     if (e) {
//       e.stopPropagation();
//     }
    
//     setOpenChatMenuId(null);
    
//     const folderName = typeof selectedFolder === 'string' ? selectedFolder : (selectedFolder?.originalname || selectedFolder?.name || null);
//     if (!folderName || !chatId) {
//       console.error('[ChatInterface] handleDeleteChat: Missing folderName or chatId', { selectedFolder, folderName, chatId });
//       return;
//     }

//     if (!window.confirm('Are you sure you want to delete this chat? This action cannot be undone.')) {
//       return;
//     }

//     try {
//       setLoadingChat(true);
//       setChatError(null);
      
//       console.log('[ChatInterface] handleDeleteChat: Deleting chat', chatId, 'from folder', folderName);
//       const deletePromise = documentApi.deleteSingleFolderChat(folderName, chatId);
      
//       toast.promise(deletePromise, {
//         pending: 'Deleting chat...',
//         success: 'Chat deleted successfully!',
//         error: {
//           render({ data }) {
//             const errorMessage = data?.response?.data?.error || data?.message || 'Failed to delete chat';
//             return errorMessage;
//           },
//         },
//       });
      
//       await deletePromise;
//       console.log(`✅ Successfully deleted chat ${chatId}`);
      
//       setCurrentChatHistory(prev => prev.filter(chat => chat.id !== chatId));
      
//       if (selectedMessageId === chatId) {
//         setSelectedMessageId(null);
//         setAnimatedResponseContent("");
//         setHasResponse(false);
//         setHasAiResponse(false);
//         setForceSidebarCollapsed(false);
//       }
      
//       if (folderName) {
//         await fetchChatHistory(null, folderName);
//       }
//     } catch (err) {
//       console.error("❌ Error deleting chat:", err);
//       const errorMessage = err?.response?.data?.error || err?.message || 'Failed to delete chat';
//       setChatError(errorMessage);
//     } finally {
//       setLoadingChat(false);
//     }
//   };

//   const handleChatMenuToggle = (chatId, e) => {
//     if (e) {
//       e.stopPropagation();
//     }
//     setOpenChatMenuId(openChatMenuId === chatId ? null : chatId);
//   };

//   const handleNewChat = () => {
//     if (animationFrameRef.current) {
//       cancelAnimationFrame(animationFrameRef.current);
//       animationFrameRef.current = null;
//     }
//     setCurrentChatHistory([]);
//     setSelectedChatSessionId(null);
//     setHasResponse(false);
//     setHasAiResponse(false);
//     setForceSidebarCollapsed(false);
//     setChatInput("");
//     setSelectedMessageId(null);
//     setAnimatedResponseContent("");
//     setIsAnimatingResponse(false);
//     setIsGenerating(false);
//     setIsSecretPromptSelected(false);
//     setSelectedSecretId(null);
//     setSelectedLlmName(null);
//     setActiveDropdown("Custom Query");
//   };

//   const handleDeleteAllChats = async () => {
//     if (!selectedFolder) return;
    
//     const chatCount = currentChatHistory.length;
//     if (chatCount === 0) {
//       toast.info("No chats to delete.");
//       return;
//     }

//     if (!window.confirm(`Are you sure you want to delete all ${chatCount} chat(s) in this folder? This action cannot be undone.`)) {
//       return;
//     }

//     try {
//       setLoadingChat(true);
//       setChatError(null);
      
//       const deletePromise = documentApi.deleteAllFolderChats(selectedFolder);
      
//       toast.promise(deletePromise, {
//         pending: 'Deleting all chats...',
//         success: `All ${chatCount} chat(s) deleted successfully!`,
//         error: {
//           render({ data }) {
//             const errorMessage = data?.response?.data?.error || data?.message || 'Failed to delete all chats';
//             return errorMessage;
//           },
//         },
//       });
      
//       await deletePromise;
//       console.log(`✅ Successfully deleted all chats from folder ${selectedFolder}`);
      
//       setCurrentChatHistory([]);
//       setSelectedChatSessionId(null);
//       setHasResponse(false);
//       setHasAiResponse(false);
//       setForceSidebarCollapsed(false);
//       setSelectedMessageId(null);
//       setAnimatedResponseContent("");
//       setIsAnimatingResponse(false);
//       setIsGenerating(false);
      
//       const folderName = typeof selectedFolder === 'string' ? selectedFolder : (selectedFolder?.originalname || selectedFolder?.name || null);
//       if (folderName) {
//         await fetchChatHistory(null, folderName);
//       }
//     } catch (err) {
//       console.error("❌ Error deleting all chats:", err);
//       const errorMessage = err?.response?.data?.error || err?.message || 'Failed to delete all chats';
//       setChatError(errorMessage);
//     } finally {
//       setLoadingChat(false);
//     }
//   };

//   const handleDropdownSelect = (secretName, secretId, llmName) => {
//     setActiveDropdown(secretName);
//     setSelectedSecretId(secretId);
//     setSelectedLlmName(llmName);
//     setIsSecretPromptSelected(true);
//     setChatInput("");
//     setShowDropdown(false);
//   };

//   const handleChatInputChange = (e) => {
//     setChatInput(e.target.value);
//     if (e.target.value && isSecretPromptSelected) {
//       setIsSecretPromptSelected(false);
//       setActiveDropdown("Custom Query");
//       setSelectedSecretId(null);
//       setSelectedLlmName(null);
//     }
//     if (!e.target.value && !isSecretPromptSelected) {
//       setActiveDropdown("Custom Query");
//     }
//   };

//   const getRelativeTime = (dateString) => {
//     try {
//       const date = new Date(dateString);
//       const now = new Date();
//       const diffInSeconds = Math.floor((now - date) / 1000);
//       if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
//       if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
//       if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
//       return `${Math.floor(diffInSeconds / 86400)}d ago`;
//     } catch {
//       return "Unknown time";
//     }
//   };

//   const formatDate = (dateString) => {
//     try {
//       return new Date(dateString).toLocaleString();
//     } catch {
//       return "Invalid date";
//     }
//   };

//   useEffect(() => {
//     const handleClickOutside = (event) => {
//       if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
//         setShowDropdown(false);
//       }
//     };
//     document.addEventListener("mousedown", handleClickOutside);
//     return () => document.removeEventListener("mousedown", handleClickOutside);
//   }, []);

//   useEffect(() => {
//     const handleClickOutside = (event) => {
//       if (openChatMenuId && chatMenuRefs.current[openChatMenuId]) {
//         if (!chatMenuRefs.current[openChatMenuId].contains(event.target)) {
//           setOpenChatMenuId(null);
//         }
//       }
//     };

//     if (openChatMenuId) {
//       document.addEventListener("mousedown", handleClickOutside);
//       return () => {
//         document.removeEventListener("mousedown", handleClickOutside);
//       };
//     }
//   }, [openChatMenuId]);

//   useEffect(() => {
//     fetchSecrets();
//   }, []);

//   useEffect(() => {
//     console.log('[ChatInterface] useEffect triggered, selectedFolder:', selectedFolder);
//     if (animationFrameRef.current) {
//       cancelAnimationFrame(animationFrameRef.current);
//       animationFrameRef.current = null;
//     }
//     setChatSessions([]);
//     setSelectedChatSessionId(null);
//     setHasResponse(false);
//     setHasAiResponse(false);
//     setForceSidebarCollapsed(false);
//     setAnimatedResponseContent("");
//     setSelectedMessageId(null);
//     setIsAnimatingResponse(false);
//     setActiveDropdown("Custom Query");
//     setSelectedSecretId(null);
//     setSelectedLlmName(null);
//     setIsSecretPromptSelected(false);
//     setChatInput("");
    
//     const folderName = typeof selectedFolder === 'string' ? selectedFolder : (selectedFolder?.originalname || selectedFolder?.name || null);
//     if (folderName) {
//       const folderKey = `${folderName}`;
//       fetchedFoldersRef.current.delete(folderKey);
//       console.log('[ChatInterface] Calling fetchChatHistory for folder:', folderName);
//       fetchedFoldersRef.current.add(folderKey);
//       fetchChatHistory(null, folderName).then(() => {
//         console.log('[ChatInterface] fetchChatHistory completed successfully');
//       }).catch(err => {
//         console.error('[ChatInterface] Error in fetchChatHistory:', err);
//         fetchedFoldersRef.current.delete(folderKey);
//         setCurrentChatHistory([]);
//       });
//     } else {
//       console.log('[ChatInterface] Skipping fetchChatHistory - folder is:', selectedFolder);
//       if (selectedFolder === null || selectedFolder === undefined) {
//         console.log('[ChatInterface] selectedFolder is null/undefined - will fetch when folder is set');
//       } else {
//         fetchedFoldersRef.current.clear();
//         setCurrentChatHistory([]);
//       }
//     }
//   }, [selectedFolder, fetchChatHistory]);

//   if (!selectedFolder) {
//     return (
//       <div className="flex items-center justify-center h-full text-gray-400 text-lg bg-[#FDFCFB]">
//         Select a folder to start chatting.
//       </div>
//     );
//   }

//   const buttonClass = isGenerating
//     ? "p-2.5 bg-gray-500 hover:bg-gray-600 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-full transition-colors"
//     : "p-2.5 bg-[#21C1B6] hover:bg-[#1AA49B] disabled:bg-gray-300 disabled:cursor-not-allowed rounded-full transition-colors";

//   return (
//     <div className="flex h-full min-h-0 w-full bg-[#F8FAFD] px-4 sm:px-6 py-4 gap-4 overflow-hidden relative">
//       <div
//         className={`${hasResponse ? "flex-[0.4]" : "flex-1"} flex flex-col bg-white h-full transition-all duration-300 overflow-hidden rounded-2xl border border-gray-200 shadow-sm min-w-0`}
//       >
//         <div className="p-4 border-b border-black border-opacity-20 flex-shrink-0">
//           <div className="flex items-center justify-between mb-4">
//             <h2 className="text-lg font-semibold text-gray-900">Questions</h2>
//             <div className="flex items-center gap-2">
//               {currentChatHistory.length > 0 && (
//                 <button
//                   onClick={handleDeleteAllChats}
//                   disabled={loadingChat}
//                   className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed rounded-md transition-colors flex items-center gap-1.5"
//                   title="Delete all chats"
//                 >
//                   <Trash2 className="w-4 h-4" />
//                   Delete All
//                 </button>
//               )}
//               <button
//                 onClick={handleNewChat}
//                 className="px-3 py-1.5 text-sm font-medium text-white bg-[#21C1B6] hover:bg-[#1AA49B] rounded-md transition-colors"
//               >
//                 New Chat
//               </button>
//             </div>
//           </div>
//           <div className="relative mb-4">
//             <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
//             <input
//               type="text"
//               placeholder="Search questions..."
//               className="w-full pl-9 pr-3 py-2 bg-gray-100 rounded-lg text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#21C1B6] border-[#21C1B6]"
//             />
//           </div>
//         </div>
//         <div className="flex-1 overflow-y-auto px-4 py-2 scrollbar-custom">
//           {loadingChat && currentChatHistory.length === 0 ? (
//             <div className="flex justify-center py-8">
//               <Loader2 className="h-8 w-8 animate-spin text-[#21C1B6]" />
//             </div>
//           ) : currentChatHistory.length === 0 ? (
//             <div className="text-center py-12">
//               <MessageSquare className="h-12 w-12 mx-auto mb-4 text-gray-300" />
//               <p className="text-gray-500">No chats yet. Start a conversation!</p>
//             </div>
//           ) : (
//             <div className="space-y-2">
//               {currentChatHistory.map((chat) => (
//                 <div
//                   key={chat.id}
//                   onClick={() => handleSelectChat(chat)}
//                   className={`p-3 rounded-lg border cursor-pointer transition-all duration-200 hover:shadow-md group ${
//                     selectedMessageId === chat.id
//                       ? "bg-blue-50 border-blue-200 shadow-sm"
//                       : "bg-white border-gray-200 hover:bg-gray-50"
//                   }`}
//                 >
//                   <div className="flex items-start justify-between">
//                     <div className="flex-1 min-w-0">
//                       <p className="text-sm font-medium text-gray-900 mb-1 line-clamp-2">
//                         {chat.question || chat.prompt_label || chat.promptLabel || chat.query || "Untitled"}
//                       </p>
//                       <p className="text-xs text-gray-500">{getRelativeTime(chat.created_at || chat.timestamp)}</p>
//                     </div>
//                     <div className={`relative transition-opacity duration-200 ${openChatMenuId === chat.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} ref={(el) => (chatMenuRefs.current[chat.id] = el)}>
//                       <button
//                         onClick={(e) => handleChatMenuToggle(chat.id, e)}
//                         className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
//                         title="More options"
//                         type="button"
//                       >
//                         <MoreVertical className="h-4 w-4 text-gray-600" />
//                       </button>
//                       {openChatMenuId === chat.id && (
//                         <div className="absolute right-0 top-8 mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
//                           <button
//                             onClick={(e) => handleDeleteChat(chat.id, e)}
//                             className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 rounded-lg transition-colors"
//                             type="button"
//                           >
//                             <Trash2 className="w-4 h-4" />
//                             Delete
//                           </button>
//                         </div>
//                       )}
//                     </div>
//                   </div>
//                 </div>
//               ))}
//             </div>
//           )}
//         </div>
//         <div className="border-t border-gray-200 p-2 bg-white flex-shrink-0">
//           <form
//             onSubmit={(e) => {
//               e.preventDefault();
//               if (isGenerating) {
//                 handleStopGeneration();
//               } else {
//                 handleNewMessage();
//               }
//             }}
//             className="flex items-center space-x-3 bg-white rounded-xl border border-[#21C1B6] px-4 py-4 focus-within:ring-[#21C1B6] focus-within:shadow-sm"
//           >
//             <div className="relative flex-shrink-0" ref={dropdownRef}>
//               <button
//                 type="button"
//                 onClick={() => setShowDropdown(!showDropdown)}
//                 disabled={isLoadingSecrets || loadingChat}
//                 className="flex items-center space-x-2 px-2.5 py-1.5 text-xs font-medium text-gray-700 bg-white border border-[#21C1B6] rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
//               >
//                 <BookOpen className="h-3.5 w-3.5" />
//                 <span>{isLoadingSecrets ? "Loading..." : activeDropdown}</span>
//                 <ChevronDown className="h-3.5 w-3.5" />
//               </button>
//               {showDropdown && !isLoadingSecrets && (
//                 <div className="absolute bottom-full left-0 mb-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto">
//                   {secrets.length > 0 ? (
//                     secrets.map((secret) => (
//                       <button
//                         key={secret.id}
//                         type="button"
//                         onClick={() => handleDropdownSelect(secret.name, secret.id, secret.llm_name)}
//                         className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg"
//                       >
//                         {secret.name}
//                       </button>
//                     ))
//                   ) : (
//                     <div className="px-4 py-2.5 text-sm text-gray-500">
//                       No analysis prompts available
//                     </div>
//                   )}
//                 </div>
//               )}
//             </div>

//             <input
//               type="text"
//               placeholder={isSecretPromptSelected ? `Analysis: ${activeDropdown}` : "How can I help you today?"}
//               value={chatInput}
//               onChange={handleChatInputChange}
//               onKeyPress={(e) => {
//                 if (e.key === "Enter" && !e.shiftKey) {
//                   e.preventDefault();
//                   handleNewMessage();
//                 }
//               }}
//               className="flex-grow bg-transparent border-none outline-none text-gray-900 placeholder-gray-500 text-sm font-medium py-2 min-w-0"
//               disabled={loadingChat}
//             />
//             <button
//               type="submit"
//               className={`p-1.5 text-white rounded-lg transition-colors flex-shrink-0 ${
//                 isGenerating 
//                   ? "bg-gray-500 hover:bg-gray-600" 
//                   : "bg-[#21C1B6] hover:bg-[#1AA49B]"
//               } disabled:bg-gray-300`}
//               disabled={loadingChat || (!chatInput.trim() && !isSecretPromptSelected && !isGenerating)}
//             >
//               {loadingChat && !isGenerating ? (
//                 <Loader2 className="h-4 w-4 text-white animate-spin" />
//               ) : isGenerating ? (
//                 <Square className="h-4 w-4 text-white" />
//               ) : (
//                 <Send className="h-4 w-4 text-white" />
//               )}
//             </button>
//           </form>
//           {chatError && (
//             <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
//               {chatError}
//             </div>
//           )}
//         </div>
//       </div>
//       {hasResponse && (
//         <div className="flex-[0.6] flex flex-col h-full overflow-hidden bg-white rounded-2xl border border-gray-200 shadow-sm min-w-0 relative" style={{ overflow: showCitations ? 'visible' : 'hidden' }}>
//           {selectedMessageId && animatedResponseContent && (
//             <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-gray-200 bg-white">
//               <div className="flex items-center justify-between">
//                 <h2 className="text-xl font-semibold text-gray-900">JuriNex Response</h2>
//                 <div className="flex items-center gap-2">
//                   <div className="text-sm text-gray-500 mr-2">
//                     {currentChatHistory.find((msg) => msg.id === selectedMessageId)?.timestamp && (
//                       <span>{formatDate(currentChatHistory.find((msg) => msg.id === selectedMessageId).timestamp)}</span>
//                     )}
//                   </div>
//                   <DownloadPdf markdownOutputRef={markdownOutputRef} />
//                   <button
//                     onClick={handleCopyResponse}
//                     className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
//                     title="Copy to clipboard"
//                   >
//                     {copySuccess ? (
//                       <Check className="h-4 w-4 text-green-600" />
//                     ) : (
//                       <Copy className="h-4 w-4" />
//                     )}
//                   </button>
//                 </div>
//               </div>
//               <div className="mt-3 p-3 bg-blue-50 rounded-lg border-l-4 border-[#21C1B6]">
//                 <p className="text-sm font-medium text-blue-900 mb-1">Question:</p>
//                 <p className="text-sm text-blue-800">
//                   {currentChatHistory.find((msg) => msg.id === selectedMessageId)?.question || "No question available"}
//                 </p>
//               </div>
//               {isAnimatingResponse && (
//                 <div className="mt-3 flex justify-end">
//                   <button
//                     onClick={skipAnimation}
//                     className="text-xs text-[#21C1B6] hover:text-[#1AA49B] flex items-center space-x-1 transition-colors font-medium"
//                   >
//                     <span>Skip animation</span>
//                     <ArrowRight className="h-3 w-3" />
//                   </button>
//                 </div>
//               )}
//             </div>
//           )}
//           <div className="flex-1 overflow-y-auto scrollbar-custom" ref={responseRef}>
//             {currentStatus && (
//               <div className="px-6 pt-6">
//                 <div className="status-display" style={{
//                   display: 'flex',
//                   alignItems: 'center',
//                   gap: '12px',
//                   padding: '12px 16px',
//                   background: '#f8f9fa',
//                   borderLeft: '4px solid #4285f4',
//                   borderRadius: '8px',
//                   marginBottom: '16px',
//                   fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", sans-serif'
//                 }}>
//                   <div className="status-spinner" style={{
//                     width: '20px',
//                     height: '20px',
//                     border: '2px solid #e0e0e0',
//                     borderTop: '2px solid #4285f4',
//                     borderRadius: '50%',
//                     animation: 'spin 1s linear infinite'
//                   }}></div>
//                   <div className="status-content">
//                     <div className="status-label" style={{
//                       fontSize: '13px',
//                       fontWeight: '500',
//                       color: '#5f6368',
//                       textTransform: 'capitalize',
//                       marginBottom: '2px'
//                     }}>
//                       {currentStatus.status}
//                     </div>
//                     <div className="status-message" style={{
//                       fontSize: '14px',
//                       color: '#3c4043'
//                     }}>
//                       {currentStatus.message}
//                     </div>
//                   </div>
//                 </div>
//               </div>
//             )}
            
//             {loadingChat && !animatedResponseContent && !thinkingContent && !currentStatus ? (
//               <div className="flex items-center justify-center h-full">
//                 <div className="text-center">
//                   <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-[#21C1B6]" />
//                   <p className="text-gray-600">Generating response...</p>
//                 </div>
//               </div>
//             ) : selectedMessageId && (animatedResponseContent || thinkingContent || currentStatus) ? (
//               <div className="px-6 py-6">
//                 {thinkingContent && (
//                   <div className="thinking-section" style={{
//                     background: '#f5f5f5',
//                     borderLeft: '4px solid #4285f4',
//                     borderRadius: '8px',
//                     padding: '16px',
//                     marginBottom: '16px',
//                     fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", sans-serif'
//                   }}>
//                     <div className="thinking-header" style={{
//                       display: 'flex',
//                       alignItems: 'center',
//                       gap: '8px',
//                       marginBottom: '12px',
//                       color: '#5f6368',
//                       fontSize: '14px',
//                       fontWeight: '500'
//                     }}>
//                       <span style={{ fontSize: '18px' }}>🧠</span>
//                       <span>Thinking...</span>
//                     </div>
//                     <div className="thinking-content" style={{
//                       color: '#3c4043',
//                       fontSize: '14px',
//                       lineHeight: '1.6',
//                       whiteSpace: 'pre-wrap',
//                       fontFamily: '"Roboto Mono", "Courier New", monospace',
//                       background: 'white',
//                       padding: '12px',
//                       borderRadius: '4px',
//                       border: '1px solid #e0e0e0',
//                       wordWrap: 'break-word'
//                     }}>
//                       {thinkingContent}
//                       {loadingChat && <span style={{ animation: 'blink 1s infinite' }}>▋</span>}
//                     </div>
//                   </div>
//                 )}
                
//                 {animatedResponseContent && (
//                   <div className="bg-white rounded-lg shadow-sm p-6">
//                     <div className="horizontal-scroll-container" ref={horizontalScrollRef}>
//                       <div
//                         className="prose prose-gray prose-lg max-w-none"
//                         ref={markdownOutputRef}
//                         style={{ minWidth: "fit-content" }}
//                       >
//                         <ReactMarkdown
//                           remarkPlugins={[remarkGfm]}
//                           rehypePlugins={[rehypeRaw, rehypeSanitize]}
//                           components={{
//                             h1: ({node, ...props}) => (
//                               <h1 className="text-4xl font-bold mb-8 mt-8 text-gray-900 border-b-2 border-blue-500 pb-4 analysis-page-ai-response tracking-tight" {...props} />
//                             ),
//                             h2: ({node, ...props}) => (
//                               <h2 className="text-2xl font-bold mb-6 mt-8 text-gray-900 border-b border-gray-300 pb-3 analysis-page-ai-response tracking-tight" {...props} />
//                             ),
//                             h3: ({node, ...props}) => (
//                               <h3 className="text-xl font-semibold mb-4 mt-6 text-gray-800 analysis-page-ai-response" {...props} />
//                             ),
//                             h4: ({node, ...props}) => (
//                               <h4 className="text-lg font-semibold mb-3 mt-5 text-gray-800 analysis-page-ai-response" {...props} />
//                             ),
//                             h5: ({node, ...props}) => (
//                               <h5 className="text-base font-semibold mb-2 mt-4 text-gray-700 analysis-page-ai-response" {...props} />
//                             ),
//                             h6: ({node, ...props}) => (
//                               <h6 className="text-sm font-semibold mb-2 mt-3 text-gray-700 analysis-page-ai-response" {...props} />
//                             ),
//                             p: ({node, ...props}) => (
//                               <p className="mb-5 leading-relaxed text-gray-800 text-[15px] analysis-page-ai-response" {...props} />
//                             ),
//                             strong: ({node, ...props}) => (
//                               <strong className="font-bold text-gray-900" {...props} />
//                             ),
//                             em: ({node, ...props}) => (
//                               <em className="italic text-gray-800" {...props} />
//                             ),
//                             ul: ({node, ...props}) => (
//                               <ul className="list-disc pl-6 mb-4 space-y-2 text-gray-800" {...props} />
//                             ),
//                             ol: ({node, ...props}) => (
//                               <ol className="list-decimal pl-6 mb-4 space-y-2 text-gray-800" {...props} />
//                             ),
//                             li: ({node, ...props}) => (
//                               <li className="leading-relaxed text-gray-800 analysis-page-ai-response" {...props} />
//                             ),
//                             a: ({node, ...props}) => (
//                               <a
//                                 {...props}
//                                 className="text-blue-600 hover:text-blue-800 underline font-medium transition-colors"
//                                 target="_blank"
//                                 rel="noopener noreferrer"
//                               />
//                             ),
//                             blockquote: ({node, ...props}) => (
//                               <blockquote className="border-l-4 border-blue-500 pl-6 py-3 my-6 bg-blue-50 text-gray-800 italic rounded-r-lg analysis-page-ai-response shadow-sm" {...props} />
//                             ),
//                             code: ({node, inline, className, children, ...props}) => {
//                               const match = /language-(\w+)/.exec(className || '');
//                               const language = match ? match[1] : '';
                              
//                               if (inline) {
//                                 return (
//                                   <code
//                                     className="bg-gray-100 text-red-600 px-1.5 py-0.5 rounded text-sm font-mono border border-gray-200"
//                                     {...props}
//                                   >
//                                     {children}
//                                   </code>
//                                 );
//                               }
                              
//                               return (
//                                 <div className="relative my-4">
//                                   {language && (
//                                     <div className="bg-gray-800 text-gray-300 text-xs px-3 py-1 rounded-t font-mono">
//                                       {language}
//                                     </div>
//                                   )}
//                                   <pre className={`bg-gray-900 text-gray-100 p-4 ${language ? 'rounded-b' : 'rounded'} overflow-x-auto`}>
//                                     <code className="font-mono text-sm" {...props}>
//                                       {children}
//                                     </code>
//                                   </pre>
//                                 </div>
//                               );
//                             },
//                             pre: ({node, ...props}) => (
//                               <pre className="bg-gray-900 text-gray-100 p-4 rounded my-4 overflow-x-auto" {...props} />
//                             ),
//                             table: ({node, ...props}) => (
//                               <div className="my-6 rounded-lg border border-gray-300 shadow-sm overflow-hidden">
//                                 <table className="min-w-full divide-y divide-gray-300" {...props} />
//                               </div>
//                             ),
//                             thead: ({node, ...props}) => (
//                               <thead className="bg-gradient-to-r from-gray-50 to-gray-100" {...props} />
//                             ),
//                             th: ({node, ...props}) => (
//                               <th className="px-6 py-4 text-left text-xs font-bold text-gray-800 uppercase tracking-wider border-b-2 border-gray-300" {...props} />
//                             ),
//                             tbody: ({node, ...props}) => (
//                               <tbody className="bg-white divide-y divide-gray-200" {...props} />
//                             ),
//                             tr: ({node, ...props}) => (
//                               <tr className="hover:bg-gray-50 transition-colors" {...props} />
//                             ),
//                             td: ({node, ...props}) => (
//                               <td className="px-6 py-4 text-sm text-gray-800 border-b border-gray-100 leading-relaxed" {...props} />
//                             ),
//                             hr: ({node, ...props}) => (
//                               <hr className="my-6 border-t-2 border-gray-300" {...props} />
//                             ),
//                             img: ({node, ...props}) => (
//                               <img className="max-w-full h-auto rounded-lg shadow-md my-4" alt="" {...props} />
//                             ),
//                           }}
//                         >
//                           {formattedResponseContent}
//                         </ReactMarkdown>
//                         {isAnimatingResponse && (
//                           <span className="inline-flex items-center ml-1">
//                             <span className="inline-block w-2 h-5 bg-blue-600 animate-pulse"></span>
//                           </span>
//                         )}
//                       </div>
//                     </div>
//                   </div>
//                 )}
                
//               </div>
//             ) : (
//               <div className="flex items-center justify-center h-full">
//                 <div className="text-center max-w-md px-6">
//                   <MessageSquare className="h-16 w-16 mx-auto mb-6 text-gray-300" />
//                   <h3 className="text-2xl font-semibold mb-4 text-gray-900">Select a Question</h3>
//                   <p className="text-gray-600 text-lg leading-relaxed">
//                     Click on any question from the left panel to view the JuriNex response here.
//                   </p>
//                 </div>
//               </div>
//             )}
//           </div>
          
//           {selectedMessageId && (() => {
//             const message = currentChatHistory.find((msg) => msg.id === selectedMessageId);
//             const hasCitations = message && (
//               (message.used_chunk_ids && message.used_chunk_ids.length > 0) ||
//               (message.citations && Array.isArray(message.citations) && message.citations.length > 0) ||
//               (citations && citations.length > 0)
//             );
            
//             return hasCitations ? (
//               <div className="px-6 py-4 border-t border-gray-200 bg-white flex justify-center flex-shrink-0" style={{ position: 'relative', zIndex: 10 }}>
//                 <button
//                   onClick={async (e) => {
//                     e.preventDefault();
//                     e.stopPropagation();
//                     console.log('[ChatInterface] SOURCES button clicked');
//                     console.log('[ChatInterface] Current citations:', citations);
//                     console.log('[ChatInterface] Current showCitations:', showCitations);
//                     console.log('[ChatInterface] Current selectedMessageId:', selectedMessageId);
                    
//                     const newShowState = !showCitations;
//                     setShowCitations(newShowState);
                    
//                     if (newShowState && (!citations || citations.length === 0)) {
//                       const message = currentChatHistory.find((msg) => msg.id === selectedMessageId);
//                       console.log('[ChatInterface] Message for citations:', message);
//                       if (message && (message.used_chunk_ids?.length > 0 || message.citations?.length > 0)) {
//                         console.log('[ChatInterface] Citations should be fetched by useEffect');
//                       }
//                     }
//                   }}
//                   className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
//                   style={{ pointerEvents: 'auto', zIndex: 20 }}
//                   type="button"
//                   disabled={loadingCitations}
//                 >
//                   <BookOpen className="h-4 w-4" />
//                   <span>SOURCES</span>
//                   {loadingCitations && (
//                     <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
//                   )}
//                   {citations && citations.length > 0 && (
//                     <span className="ml-1 text-xs bg-purple-500 px-2 py-0.5 rounded-full">
//                       {citations.length}
//                     </span>
//                   )}
//                 </button>
//               </div>
//             ) : null;
//           })()}
          
//           {shouldShowHorizontalScrollbar && (
//             <div className="px-6 pb-4 pt-2 bg-white border-t border-gray-100">
//               <div
//                 ref={stickyScrollbarRef}
//                 className="overflow-x-auto overflow-y-hidden bg-gray-100 border border-gray-200 rounded-lg shadow-sm"
//                 style={{
//                   height: "16px",
//                   scrollbarWidth: "thin",
//                   scrollbarColor: "#9CA3AF #E5E7EB",
//                   WebkitOverflowScrolling: "touch",
//                 }}
//               >
//                 <div style={{ width: `${scrollbarWidth}px`, height: "1px" }} />
//               </div>
//             </div>
//           )}
//         </div>
//       )}

//       {hasResponse && showCitations && (
//         <div className="absolute" style={{ right: '16px', top: '16px', bottom: '16px', width: '380px', zIndex: 50 }}>
//           <CitationsPanel
//             citations={citations || []}
//             folderName={selectedFolder}
//             onClose={() => setShowCitations(false)}
//             onCitationClick={async (citation) => {
//               const page = citation.page || citation.pageStart || 1;
//               const fileId = citation.fileId || citation.file_id;
              
//               if (!fileId) {
//                 console.error('[Citations] Invalid citation: missing fileId', citation);
//                 return;
//               }
              
//               console.log(`[Citations] Opening: ${fileId}, page ${page}`);
              
//               setDocumentViewer({
//                 open: true,
//                 url: null,
//                 filename: citation.filename || 'Document',
//                 page: page,
//                 loading: true
//               });
              
//               try {
//                 const token = getAuthToken();
//                 await openDocumentAtPage(fileId, page, citation.filename, token);
//               } catch (error) {
//                 console.error('[Citations] Error fetching document:', error);
//                 setDocumentViewer({
//                   open: true,
//                   url: null,
//                   filename: citation.filename || 'Document',
//                   page: page,
//                   loading: false,
//                   error: error.message || 'Failed to load document'
//                 });
//               }
//             }}
//           />
//         </div>
//       )}

//       {documentViewer.open && (
//         <div 
//           className="fixed inset-0 z-[60] flex items-center justify-center bg-white" 
//           onClick={(e) => {
//             if (e.target === e.currentTarget) {
//               setDocumentViewer({ open: false, url: null, filename: null, page: null, loading: false, error: null });
//             }
//           }}
//         >
//           <div className="bg-white rounded-lg shadow-2xl w-[95vw] h-[95vh] flex flex-col border border-gray-200" style={{ maxWidth: '1400px' }}>
//             <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
//               <div className="flex items-center gap-3">
//                 <FileText className="h-5 w-5 text-blue-600" />
//                 <div>
//                   <h3 className="text-lg font-semibold text-gray-900">{documentViewer.filename}</h3>
//                   {documentViewer.page && (
//                     <p className="text-sm text-gray-500">Page {documentViewer.page}</p>
//                   )}
//                 </div>
//               </div>
//               <button
//                 onClick={() => setDocumentViewer({ open: false, url: null, filename: null, page: null, loading: false, error: null })}
//                 className="p-2 hover:bg-gray-200 rounded-md transition-colors"
//                 aria-label="Close document viewer"
//               >
//                 <X className="h-5 w-5 text-gray-600" />
//               </button>
//             </div>

//             <div className="flex-1 overflow-hidden bg-white relative">
//               {documentViewer.loading ? (
//                 <div className="flex flex-col items-center justify-center h-full">
//                   <div className="animate-spin h-10 w-10 border-4 border-gray-200 border-t-blue-600 rounded-full mb-4"></div>
//                   <p className="text-gray-600">Loading document...</p>
//                 </div>
//               ) : documentViewer.error ? (
//                 <div className="flex flex-col items-center justify-center h-full p-6">
//                   <div className="text-red-500 mb-4">
//                     <FileText className="h-12 w-12 mx-auto mb-2" />
//                     <p className="text-lg font-semibold">Failed to load document</p>
//                   </div>
//                   <p className="text-gray-600 text-center mb-4">{documentViewer.error}</p>
//                   <button
//                     onClick={() => setDocumentViewer({ open: false, url: null, filename: null, page: null, loading: false, error: null })}
//                     className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
//                   >
//                     Close
//                   </button>
//                 </div>
//               ) : documentViewer.url ? (
//                 <iframe
//                   src={documentViewer.url}
//                   className="w-full h-full border-0"
//                   title={documentViewer.filename}
//                   style={{ backgroundColor: 'white' }}
//                 />
//               ) : (
//                 <div className="flex flex-col items-center justify-center h-full">
//                   <p className="text-gray-600">No document URL available</p>
//                 </div>
//               )}
//             </div>
//           </div>
//         </div>
//       )}
//       <style>{`
//         @import url('https://fonts.googleapis.com/css2?family=Crimson+Text:ital,wght@0,400;0,600;0,700;1,400;1,600;1,700&family=Inter:wght@100..900&display=swap');

//         .scrollbar-custom::-webkit-scrollbar {
//           width: 8px;
//         }
//         .scrollbar-custom::-webkit-scrollbar-track {
//           background: #f1f1f1;
//           border-radius: 4px;
//         }
//         .scrollbar-custom::-webkit-scrollbar-thumb {
//           background: #a0aec0;
//           border-radius: 4px;
//         }
//         .scrollbar-custom::-webkit-scrollbar-thumb:hover {
//           background: #718096;
//         }

//         .horizontal-scroll-container {
//           overflow-x: auto;
//           overflow-y: hidden;
//           scrollbar-width: none;
//         }

//         .horizontal-scroll-container::-webkit-scrollbar {
//           display: none;
//         }

//         :global(.analysis-page-ai-response) {
//           font-family: "Crimson Text", Georgia, "Times New Roman", serif !important;
//           font-size: 22px;
//           line-height: 1.8;
//           color: #111;
//         }

//         :global(.response-content h2) {
//           font-size: 1.75rem;
//           font-weight: 700;
//           color: #1a202c;
//           margin-top: 2rem;
//           margin-bottom: 1rem;
//         }

//         :global(.response-content h3) {
//           font-size: 1.4rem;
//           font-weight: 600;
//           color: #1a202c;
//           margin-top: 1.5rem;
//           margin-bottom: 0.75rem;
//         }

//         :global(.response-content p) {
//           margin-bottom: 1rem;
//           font-size: 20px;
//           line-height: 1.8;
//           color: #111827;
//         }

//         :global(.analysis-table) {
//           width: 100%;
//           border-collapse: collapse;
//           margin: 1.5rem 0;
//           font-family: "Inter", sans-serif;
//           font-size: 17px;
//           background-color: #ffffff;
//           border: 1px solid #d1d5db;
//           border-radius: 8px;
//           box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
//           overflow: hidden;
//         }

//         :global(.analysis-table thead) {
//           background-color: #f9fafb;
//         }

//         :global(.analysis-table th) {
//           padding: 0.9rem 1rem;
//           border: 1px solid #e5e7eb;
//           font-weight: 600;
//           color: #374151;
//           font-size: 16px;
//           text-align: left;
//           background-color: #f3f4f6;
//           text-transform: uppercase;
//           letter-spacing: 0.04em;
//         }

//         :global(.analysis-table td) {
//           padding: 0.8rem 1rem;
//           border: 1px solid #e5e7eb;
//           color: #111827;
//           vertical-align: middle;
//           background-color: #ffffff;
//           transition: background-color 0.2s ease-in-out;
//           font-size: 16px;
//         }

//         :global(.analysis-table tbody tr:nth-child(even) td) {
//           background-color: #fafafa;
//         }

//         :global(.analysis-table tbody tr:hover td) {
//           background-color: #f1f5f9;
//         }

//         :global(.analysis-table tr:first-child th:first-child) {
//           border-top-left-radius: 8px;
//         }
//         :global(.analysis-table tr:first-child th:last-child) {
//           border-top-right-radius: 8px;
//         }
//         :global(.analysis-table tr:last-child td:first-child) {
//           border-bottom-left-radius: 8px;
//         }
//         :global(.analysis-table tr:last-child td:last-child) {
//           border-bottom-right-radius: 8px;
//         }

//         :global(.prose table),
//         :global(.prose th),
//         :global(.prose td) {
//           font-family: "Crimson Text", Georgia, "Times New Roman", serif !important;
//         }

//         :global(.prose table) {
//           font-size: 20px !important;
//         }

//         :global(.prose th) {
//           font-size: 18px !important;
//           font-weight: 600 !important;
//         }

//         :global(.prose td) {
//           font-size: 18px !important;
//         }

//         :global(.analysis-table-wrapper) {
//           overflow-x: auto;
//           margin: 1rem 0;
//           border-radius: 8px;
//         }

//         :global(.analysis-table td span) {
//           display: inline-block;
//           background-color: #fef2f2;
//           color: #b91c1c;
//           padding: 3px 8px;
//           border-radius: 6px;
//           font-weight: 500;
//           font-size: 14px;
//           line-height: 1.3;
//         }

//         :global(.response-content ul),
//         :global(.response-content ol) {
//           margin: 12px 0;
//           padding-left: 28px;
//           font-family: "Crimson Text", Georgia, "Times New Roman", serif;
//           font-size: 20px;
//         }

//         :global(.response-content li) {
//           margin: 8px 0;
//           line-height: 1.8;
//           font-size: 20px;
//         }

//         :global(.response-content strong) {
//           font-weight: 700;
//           color: #111827;
//         }

//         :global(.response-content code) {
//           background-color: #f3f4f6;
//           color: #dc2626;
//           padding: 3px 8px;
//           border-radius: 4px;
//           font-family: 'Courier New', monospace;
//           font-size: 16px;
//         }

//         :global(.response-content pre) {
//           background-color: #1f2937;
//           color: #f9fafb;
//           padding: 20px;
//           border-radius: 8px;
//           overflow-x: auto;
//           margin: 20px 0;
//           font-family: 'Courier New', monospace;
//           font-size: 15px;
//         }

//         :global(.response-content pre code) {
//           background-color: transparent;
//           color: #f9fafb;
//           padding: 0;
//         }

//         :global(.response-content blockquote) {
//           border-left: 4px solid #3b82f6;
//           padding: 12px 16px;
//           margin: 16px 0;
//           background-color: #eff6ff;
//           color: #1e40af;
//           font-style: italic;
//           border-radius: 0 6px 6px 0;
//         }

//         :global(.response-content a) {
//           color: #2563eb;
//           text-decoration: underline;
//           font-weight: 500;
//         }

//         :global(.response-content hr) {
//           border: none;
//           border-top: 2px solid #e5e7eb;
//           margin: 24px 0;
//         }

//         @keyframes statusSpin {
//           0% { transform: rotate(0deg); }
//           100% { transform: rotate(360deg); }
//         }
//       `}</style>
//     </div>
//   );
// };

// export default ChatInterface;




import React, { useState, useEffect, useContext, useRef, useMemo, useCallback, startTransition } from "react";
import { FileManagerContext } from "../../context/FileManagerContext";
import documentApi from "../../services/documentApi";
import { API_BASE_URL, DOCS_BASE_URL, CHAT_MODEL_BASE_URL, SECRET_PROMPTS_API_BASE } from "../../config/apiConfig";
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
  Mic,
  MicOff,
  Sparkles,
  Settings2,
  PanelRight,
  ChevronLeft,
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
import {
  parseLlmPolicyErrorForUi,
  stringToChatErrorDisplay,
  getUserFriendlyApiErrorMessage,
} from "../../utils/llmQuotaMessages";
import ChatQuotaErrorModal from "../ChatQuotaErrorModal";
import { buildSuggestedQuestions } from "../../utils/suggestedQuestions";
import LearningChatBubble from "./LearningChatBubble";
import LearningDetailPanel from "./LearningDetailPanel";
import AgentStepsPanel from "./AgentStepsPanel";
import ChatSessionList from "./ChatSessionList";

/** Full plain text for chat list preview (not a single 120-char line). */
function plainTextPreviewFromResponse(raw) {
  if (raw == null || raw === "") return "";
  try {
    // If it looks like a learning payload JSON, extract only the feedback text
    const trimmed = String(raw).trim();
    const cleaned = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    if (cleaned.startsWith('{')) {
      try {
        const parsed = JSON.parse(cleaned);
        if (parsed && typeof parsed === 'object' && ('feedback' in parsed || 'question' in parsed)) {
          const parts = [];
          if (parsed.feedback) parts.push(String(parsed.feedback).trim());
          if (parsed.content_hint) parts.push(`💡 ${String(parsed.content_hint).trim()}`);
          if (parsed.question) parts.push(String(parsed.question).trim());
          return parts.join('\n\n');
        }
      } catch { /* not valid JSON */ }
    }
    let t = convertJsonToPlainText(raw);
    t = t.replace(/^#+\s*/gm, "").replace(/\*\*/g, "").trim();
    return t;
  } catch {
    return String(raw).slice(0, 2000);
  }
}

/** Extracts a learning payload object from raw LLM output (JSON or code-fenced JSON). */
function extractLearningPayloadFromRaw(raw) {
  if (!raw) return null;
  try {
    const cleaned = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    if (!cleaned.startsWith('{')) return null;
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object' && ('feedback' in parsed || 'question' in parsed)) {
      return parsed;
    }
  } catch { /* not JSON */ }
  return null;
}

/**
 * Same as extractLearningPayloadFromRaw but tolerates leading/trailing noise (e.g. streamed
 * whitespace or a prefix) by parsing the outermost {...} block. Needed so Learning Mode
 * keeps the structured UI instead of flashing raw markdown during SSE.
 */
function extractLearningPayloadLenient(raw) {
  if (!raw) return null;
  const strict = extractLearningPayloadFromRaw(raw);
  if (strict) return strict;
  try {
    let t = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    const parsed = JSON.parse(t.slice(start, end + 1));
    if (parsed && typeof parsed === 'object' && ('feedback' in parsed || 'question' in parsed)) {
      return parsed;
    }
  } catch {
    /* not JSON */
  }
  return null;
}

function sourcePassagesStorageKey(folderName, messageId) {
  return `jurinex.chat.sourcePassages.v1:${String(folderName || "")}:${String(messageId ?? "")}`;
}

function saveSourcePassagesToStorage(folderName, messageId, citations) {
  try {
    if (!folderName || messageId == null) return;
    const key = sourcePassagesStorageKey(folderName, messageId);
    if (!citations?.length) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify({ citations, savedAt: Date.now() }));
  } catch (_) {}
}

function loadSourcePassagesFromStorage(folderName, messageId) {
  try {
    const raw = localStorage.getItem(sourcePassagesStorageKey(folderName, messageId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.citations) ? parsed.citations : null;
  } catch {
    return null;
  }
}

/**
 * When the model omits [1], [2], … markers, append them to successive paragraph blocks
 * so each paragraph can show an inline link to the matching source (best-effort: order matches citation order).
 */
function injectCitationMarkersIntoParagraphs(text, maxCitations) {
  if (!text || !maxCitations) return text;
  let assigned = 0;
  return text
    .split(/(\n{2,})/g)
    .map((seg) => {
      if (/^\n{2,}$/.test(seg)) return seg;
      const t = seg.trim();
      if (!t) return seg;
      if (t.startsWith("#") || t.startsWith("|") || t.startsWith("```") || t.startsWith("<")) return seg;
      if (/\[\d+\]/.test(seg)) return seg;
      if (assigned >= maxCitations) return seg;
      assigned += 1;
      return seg.replace(/\s*$/, "") + ` [${assigned}]`;
    })
    .join("");
}





















































































































































































































































































































   
       
       
         
           
           
             
             
               
               
               
             
             
           
       
       


















             
         





















































































































































































 


 
 







 









 
 




 




















































































































































































const ChatInterface = () => {
  const {
    selectedFolder,
    chatSessions,
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
  const [showStyleDropdown, setShowStyleDropdown] = useState(false);
  const [learningModeActive, setLearningModeActive] = useState(false);
  // Panel state — mirrors Claude's artifact panel
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelType, setPanelType] = useState(null); // 'learning' | 'response' | 'agentic'
  const [panelData, setPanelData] = useState(null);
  const [newChatMode, setNewChatMode] = useState(false);
  const [isSecretPromptSelected, setIsSecretPromptSelected] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState('');
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
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionsError, setSessionsError] = useState(null);
  const [chatHistorySidebarOpen, setChatHistorySidebarOpen] = useState(true);
  // Tracks the option key the user last picked (resets when a new pending question starts)
  const [pickedOption, setPickedOption] = useState(null);

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
          setSelectedLlmName(null);
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

  const responseHasTable = useMemo(() => {
    if (!animatedResponseContent) return false;
    const htmlTablePattern = /<table/i.test(animatedResponseContent);
    const markdownTablePattern = /(^|\n)\s*\|.+\|\s*($|\n)/.test(animatedResponseContent);
    return htmlTablePattern || markdownTablePattern;
  }, [animatedResponseContent]);

  const formattedResponseContent = useMemo(() => {
    const rawResponse = animatedResponseContent || '';
    if (!rawResponse) return '';

    const clean = (text) => text
      .replace(/\|\s*\|\s*\|[\s|]*\n/g, '')
      .replace(/^\s*\|\s*[-: ]+\s*\|\s*$/gm, (m) => m);

    let text;
    if (isGenerating) {
      text = clean(rawResponse);
    } else {
      const isStructured = isStructuredJsonResponse(rawResponse);
      text = clean(isStructured ? renderSecretPromptResponse(rawResponse) : convertJsonToPlainText(rawResponse));
    }

    // Inline [n] → clickable link (opens document viewer). Inject [n] per paragraph when missing.
    if (citations && citations.length > 0) {
      text = injectCitationMarkersIntoParagraphs(text, citations.length);
      text = text.replace(/\[(\d+)\]/g, (match, numStr) => {
        const n = parseInt(numStr, 10);
        if (n >= 1 && n <= citations.length) {
          const cite = citations[n - 1];
          const filenameShort = (cite.filename || "document").replace(/\.[^.]+$/, "");
          const pageBit =
            cite.pageLabel ||
            (cite.page || cite.pageStart ? `p. ${cite.page || cite.pageStart}` : "source");
          const safeTitle = `${filenameShort} · ${pageBit}`.replace(/"/g, "&quot;");
          return (
            `<span class="inline-cite" data-n="${n}" role="link" tabindex="0" title="${safeTitle}" ` +
            `style="font-size:0.92em;color:#1d4ed8;font-weight:600;text-decoration:underline;` +
            `cursor:pointer;white-space:nowrap;margin-left:3px">[${n}]</span>`
          );
        }
        return match;
      });
    }

    return text;
  }, [animatedResponseContent, isGenerating, citations]);

  const selectedMessage = useMemo(
    () => currentChatHistory.find((msg) => msg.id === selectedMessageId) || null,
    [currentChatHistory, selectedMessageId]
  );

  const selectedMessageResponseContent = useMemo(() => {
    if (!selectedMessage) return '';
    const responseText =
      selectedMessage.response || selectedMessage.answer || selectedMessage.message || '';
    if (!responseText) return '';
    return isStructuredJsonResponse(responseText)
      ? renderSecretPromptResponse(responseText)
      : convertJsonToPlainText(responseText);
  }, [selectedMessage]);

  const activeResponseContent = useMemo(
    () =>
      formattedResponseContent ||
      animatedResponseContent ||
      selectedMessageResponseContent ||
      panelData?.response ||
      '',
    [formattedResponseContent, animatedResponseContent, selectedMessageResponseContent, panelData]
  );

  const selectedMessageIsLearning = useMemo(() => {
    if (!selectedMessage) return false;
    if (selectedMessage.learning_mode || selectedMessage.learningPayload) return true;

    try {
      const raw = String(selectedMessage.response || '').trim();
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      return !!(parsed && typeof parsed === 'object' && ('feedback' in parsed || 'question' in parsed));
    } catch {
      return false;
    }
  }, [selectedMessage]);

  const suggestedQuestions = useMemo(
    () =>
      buildSuggestedQuestions({
        question: selectedMessage?.question || '',
        response: activeResponseContent || selectedMessage?.response || '',
        promptLabel: selectedMessage?.prompt_label || '',
      }),
    [selectedMessage, activeResponseContent]
  );

  const shouldShowHorizontalScrollbar = useMemo(() => {
    return isSmallScreen && responseHasTable && needsHorizontalScroll;
  }, [isSmallScreen, responseHasTable, needsHorizontalScroll]);
  const responseRef = useRef(null);
  const dropdownRef = useRef(null);
  const styleDropdownRef = useRef(null);
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
  const folderFilesCacheRef = useRef(new Map());

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

  const _normalizeFolderName = (folder) =>
    typeof folder === 'string' ? folder : (folder?.originalname || folder?.name || null);

  const _citationFileId = (citation) =>
    citation?.fileId || citation?.file_id || citation?.document_id || null;

  const _citationFilename = (citation) =>
    citation?.filename || citation?.document_name || citation?.documentName || null;

  const resolveCitationFileId = async (citation) => {
    const direct = _citationFileId(citation);
    if (direct) return direct;

    const folderName = _normalizeFolderName(selectedFolder);
    const citationName = String(_citationFilename(citation) || '').trim().toLowerCase();
    if (!folderName || !citationName) return null;

    let folderFiles = folderFilesCacheRef.current.get(folderName);
    if (!Array.isArray(folderFiles)) {
      try {
        const resp = await documentApi.getDocumentsInFolder(folderName);
        folderFiles = Array.isArray(resp?.files)
          ? resp.files
          : (Array.isArray(resp?.documents) ? resp.documents : []);
        folderFilesCacheRef.current.set(folderName, folderFiles);
      } catch (err) {
        console.warn('[Citations] Failed to fetch folder files for citation resolution:', err);
        return null;
      }
    }

    const nameOf = (f) =>
      String(
        f?.originalname ||
        f?.filename ||
        f?.document_name ||
        f?.name ||
        ''
      ).trim().toLowerCase();
    const idOf = (f) => f?.id || f?.file_id || f?.fileId || null;

    const exact = folderFiles.find((f) => nameOf(f) === citationName);
    if (exact) return idOf(exact);

    const contains = folderFiles.find((f) => {
      const n = nameOf(f);
      return n && (n.includes(citationName) || citationName.includes(n));
    });
    return contains ? idOf(contains) : null;
  };

  const fetchDocumentUrl = async (fileId, pageNumber = null, token) => {
    const url = pageNumber
      ? `${DOCS_BASE_URL}/file/${fileId}/view?page=${pageNumber}`
      : `${DOCS_BASE_URL}/file/${fileId}/view`;

    console.log('[Document URL] Fetching from agentic service:', url);

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

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
      await navigator.clipboard.writeText(activeResponseContent);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
      alert("Failed to copy to clipboard");
    }
  };

  const handleSuggestedQuestionClick = (suggestion) => {
    setChatInput(suggestion);
    setIsSecretPromptSelected(false);
    setActiveDropdown("Custom Query");
    setSelectedSecretId(null);
    setSelectedLlmName(null);
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
      const response = await fetch(`${String(SECRET_PROMPTS_API_BASE || CHAT_MODEL_BASE_URL).replace(/\/$/, '')}/secrets?fetch=true`, {
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
      setChatError(stringToChatErrorDisplay(`Failed to load analysis prompts: ${error.message}`));
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
      const response = await fetch(`${String(SECRET_PROMPTS_API_BASE || CHAT_MODEL_BASE_URL).replace(/\/$/, '')}/secrets/${secretId}`, {
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
    if (!sessionId) {
      setCurrentChatHistory([]);
      setSelectedMessageId(null);
      setAnimatedResponseContent("");
      setIsAnimatingResponse(false);
      setIsGenerating(false);
      setHasResponse(false);
      setHasAiResponse(false);
      setForceSidebarCollapsed(false);
      return;
    }
    console.log('[ChatInterface] fetchChatHistory: Starting fetch for folder:', folderToFetch, 'sessionId:', sessionId);
    setLoadingChat(true);
    setChatError(null);
    try {
      console.log('[ChatInterface] fetchChatHistory: Calling session API...');
      const data = await documentApi.getFolderChatSessionById(folderToFetch, sessionId);
      console.log('[ChatInterface] fetchChatHistory: API response:', data);
      let chats = Array.isArray(data?.chatHistory)
        ? data.chatHistory
        : Array.isArray(data?.session?.messages)
          ? data.session.messages
          : Array.isArray(data?.messages)
            ? data.messages
            : [];

      // If messages are in raw in-memory format {role, content}, convert to {question, answer}
      if (chats.length > 0 && chats[0]?.role) {
        const pairs = [];
        for (let i = 0; i < chats.length; i++) {
          if (chats[i].role === 'user') {
            const userMsg = chats[i];
            const aiMsg = chats[i + 1]?.role === 'assistant' ? chats[i + 1] : null;
            pairs.push({
              id: userMsg.id || String(Date.now() + i),
              question: userMsg.content,
              response: aiMsg?.content || '',
              answer: aiMsg?.content || '',
              created_at: userMsg.created_at,
              citations: [],
              used_chunk_ids: [],
            });
            if (aiMsg) i++;
          }
        }
        chats = pairs;
      }
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
      setCurrentChatHistory(chatsWithChunks);
      setSelectedChatSessionId(sessionId);
      // Show all messages inline in main panel — no auto-open of split panel
      setIsAnimatingResponse(false);
      setIsGenerating(false);
      setCitations([]);
      setShowCitations(false);
      if (chatsWithChunks.length > 0) {
        const selectedChat = chatsWithChunks[chatsWithChunks.length - 1];
        setSelectedMessageId(selectedChat.id);
        setHasResponse(true);
        setHasAiResponse(true); // Hide files sidebar when loading sessions
        setForceSidebarCollapsed(true);
        setAnimatedResponseContent(''); 
      } else {
        setHasResponse(false);
        setHasAiResponse(false);
        setForceSidebarCollapsed(false);
      }
    } catch (err) {
      console.error("[ChatInterface] fetchChatHistory: Error fetching chats:", err);
      console.error("[ChatInterface] fetchChatHistory: Error details:", err.response?.data || err.message);
      setChatError(stringToChatErrorDisplay('Failed to fetch chat history.'));
    } finally {
      setLoadingChat(false);
      console.log('[ChatInterface] fetchChatHistory: Completed');
    }
  }, [selectedFolder]);

  useEffect(() => {
    const fetchCitations = async () => {
      const toPlainText = (v) => {
        if (v == null) return '';
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
        if (Array.isArray(v)) return v.map(toPlainText).filter(Boolean).join('');
        if (typeof v === 'object') {
          if (typeof v.text === 'string' || typeof v.text === 'number') return String(v.text);
          if (v.type && v.text != null) return toPlainText(v.text);
        }
        try { return JSON.stringify(v); } catch { return String(v); }
      };

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
          const text = toPlainText(chunk.content_preview || chunk.content || chunk.text || '');

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
            viewUrl: fileId ? `${DOCS_BASE_URL}/file/${fileId}/view?page=${page || 1}` : null
          };
        });
        console.log('[Citations] Formatted citations from chunk_details:', formattedCitations);
        setCitations(formattedCitations);
        saveSourcePassagesToStorage(folderName, message.id, formattedCitations);
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
            filename: citation.filename || citation.document_name || 'document.pdf',
            fileId: citation.fileId || citation.file_id || citation.document_id,
            text: toPlainText(citation.text || citation.content || citation.text_preview || citation.quote || ''),
            link: `${citation.filename || citation.document_name || 'document.pdf'}#page=${page || pageStart || 1}`,
            viewUrl: citation.viewUrl || ((citation.fileId || citation.file_id || citation.document_id) ? `${DOCS_BASE_URL}/file/${citation.fileId || citation.file_id || citation.document_id}/view?page=${page || pageStart || 1}` : null)
          };
        });
        console.log('[Citations] Formatted citations from metadata:', formattedCitations);
        setCitations(formattedCitations);
        saveSourcePassagesToStorage(folderName, message.id, formattedCitations);
        setLoadingCitations(false);
        return;
      }
     
      if (!message.used_chunk_ids || message.used_chunk_ids.length === 0) {
        console.log('[Citations] No used_chunk_ids or citations in message:', message.used_chunk_ids);
        const cached = loadSourcePassagesFromStorage(folderName, message.id);
        if (cached?.length) {
          setCitations(cached);
        } else {
          setCitations([]);
          saveSourcePassagesToStorage(folderName, message.id, []);
        }
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
            viewUrl: (chunk.file_id || chunk.fileId) ? `${DOCS_BASE_URL}/file/${chunk.file_id || chunk.fileId}/view?page=${page || pageStart || 1}` : null
          };
        });

        console.log('[Citations] Formatted citations:', formattedCitations);
        setCitations(formattedCitations);
        saveSourcePassagesToStorage(folderName, message.id, formattedCitations);
      } catch (error) {
        console.error('[Citations] Failed to fetch citations:', error);
        const cached = loadSourcePassagesFromStorage(folderName, message.id);
        if (cached?.length) {
          setCitations(cached);
        } else {
          setCitations([]);
        }
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
    setPendingQuestion('');
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

  const extractStreamErrorMessage = async (response) => {
    const fallbackMessage = `HTTP error! status: ${response.status}`;

    try {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const payload = await response.json();
        return payload?.message || payload?.error || payload?.details || fallbackMessage;
      }

      const rawText = await response.text();
      if (!rawText) {
        return fallbackMessage;
      }

      try {
        const parsed = JSON.parse(rawText);
        return parsed?.message || parsed?.error || parsed?.details || rawText || fallbackMessage;
      } catch (parseError) {
        return rawText || fallbackMessage;
      }
    } catch (error) {
      return fallbackMessage;
    }
  };

  const chatWithAI = async (folder, secretId, currentSessionId) => {
    setAnimatedResponseContent('');
    setThinkingContent('');
    setCurrentStatus(null);
    streamBufferRef.current = '';
    streamThinkingRef.current = '';
    setChatError(null);
    setLoadingChat(true);
    setIsGenerating(true);
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
      const isContinuingSession = currentChatHistory.length > 0;
      if (!isContinuingSession && !panelStatesSetRef.current) {
        setHasResponse(true);
        setHasAiResponse(true);
        setForceSidebarCollapsed(true);
        panelStatesSetRef.current = true;
      }
      const selectedSecret = secrets.find((s) => s.id === secretId);
      if (!selectedSecret) throw new Error("No prompt found for selected analysis type");
      const promptLabel = selectedSecret.name;
      setPendingQuestion(`Analysis: ${promptLabel}`);
      // Server loads the secret body from document-service (same as SecretManager flow).
      // Do not send the full preset text in `question` — DB and UI store the prompt name only.

      const token = getAuthToken();
      const response = await fetch(`${DOCS_BASE_URL}/${encodeURIComponent(folder)}/intelligent-chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          question: '',
          prompt_label: promptLabel,
          secret_id: secretId,
          session_id: currentSessionId,
          llm_name: 'gemini',
          learning_mode: learningModeActive,
        }),
      });

      if (!response.ok) {
        let errBody = {};
        try {
          errBody = await response.json();
        } catch {
          errBody = {};
        }
        setChatError(parseLlmPolicyErrorForUi(response.status, errBody));
        setHasResponse(false);
        setHasAiResponse(false);
        setForceSidebarCollapsed(false);
        return;
      }

      const reader = response.body.getReader();
      streamReaderRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = '';
      let newSessionId = currentSessionId;
      let finalMetadata = null;
      let messageId = Date.now().toString();
      let streamHadError = false;
      let streamErrorMessage = '';

      while (true) {
        const { done, value } = await reader.read();
       
        if (done) {
          if (streamHadError) {
            console.warn('[ChatInterface] Secret prompt stream stopped after error:', streamErrorMessage);
            setCurrentStatus(null);
            break;
          }
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
            learning_mode: !!learningModeActive,
            learningPayload: learningModeActive
              ? (finalMetadata?.learning_payload || extractLearningPayloadLenient(streamBufferRef.current) || null)
              : null,
          };
          const history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
          setCurrentChatHistory(history);
          setPendingQuestion('');
         
          if (newSessionId) {
            setSelectedChatSessionId(newSessionId);
            fetchChatSessions().catch(() => {});
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
              setAnimatedResponseContent(finalResponse);
              setIsAnimatingResponse(false);
              setIsGenerating(false);
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
            if (streamHadError) {
              console.warn('[ChatInterface] Secret prompt stream received DONE after error:', streamErrorMessage);
              setLoadingChat(false);
              setCurrentStatus(null);
              return;
            }
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
              learning_mode: !!learningModeActive,
              learningPayload: learningModeActive
                ? (finalMetadata?.learning_payload || extractLearningPayloadLenient(streamBufferRef.current) || null)
                : null,
            };
            const history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
            setCurrentChatHistory(history);
            setPendingQuestion('');

            if (newSessionId) {
              setSelectedChatSessionId(newSessionId);
              fetchChatSessions().catch(() => {});
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
                  setAnimatedResponseContent(finalResponse);
                  setIsAnimatingResponse(false);
                  setIsGenerating(false);
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
              const metaSid = parsed.session_id || parsed.sessionId;
              if (metaSid) {
                newSessionId = metaSid;
                setSelectedChatSessionId(metaSid);
              }
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
                if (streamThinkingRef.current || thinkingContent) {
                  streamThinkingRef.current = '';
                  setThinkingContent('');
                }
                streamBufferRef.current += chunkText;
                setHasResponse(true);
                setHasAiResponse(true);
                if (!panelStatesSetRef.current) {
                  setForceSidebarCollapsed(true);
                  panelStatesSetRef.current = true;
                }
                const raw = streamBufferRef.current;
                const live = isStructuredJsonResponse(raw)
                  ? raw
                  : convertJsonToPlainText(raw);
                setAnimatedResponseContent(live);
                setIsGenerating(true);
                setIsAnimatingResponse(true);
              }
            } else if (parsed.type === 'done') {
              finalMetadata = { ...finalMetadata, ...parsed };
              const doneSid = finalMetadata.session_id || finalMetadata.sessionId;
              if (doneSid) {
                newSessionId = doneSid;
                setSelectedChatSessionId(doneSid);
              }
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

              const resolvedMsgId = finalMetadata?.message_id || finalMetadata?.id || messageId;
              const newMessage = {
                id: resolvedMsgId,
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
                learning_mode: !!learningModeActive,
                learningPayload: learningModeActive
                ? (finalMetadata?.learning_payload || extractLearningPayloadLenient(streamBufferRef.current) || null)
                : null,
              };
              const history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
              setCurrentChatHistory(history);
              setPendingQuestion('');
              setSelectedMessageId(newMessage.id);
              setAnimatedResponseContent(finalResponse);
              setIsAnimatingResponse(false);
              setIsGenerating(false);
              // No auto-open panel - user manually opens split view if needed
              if (newSessionId) {
                fetchChatSessions().catch(() => {});
              }
            } else if (parsed.type === 'error') {
              streamHadError = true;
              streamErrorMessage = parsed.message || parsed.error || 'An error occurred';
              console.error('[ChatInterface] Secret prompt stream error payload:', parsed);
              setChatError(
                stringToChatErrorDisplay(
                  streamErrorMessage
                )
              );
              setCurrentStatus(null);
              setLoadingChat(false);
            }
          } catch (e) {
          }
        }
      }
    } catch (error) {
      console.error("Chat error:", error);
      setChatError(
        stringToChatErrorDisplay(
          getUserFriendlyApiErrorMessage(error, 'Analysis could not complete. Please try again.')
        )
      );
      setHasResponse(false);
      setHasAiResponse(false);
      setForceSidebarCollapsed(false);
      throw error;
    } finally {
      setLoadingChat(false);
      setIsGenerating(false);
      setPendingQuestion('');
      streamReaderRef.current = null;
    }
  };

  const handleNewMessage = async (forcedQuestion = null) => {
    if (!selectedFolder) return;
    if (isSecretPromptSelected) {
      if (!selectedSecretId) {
        setChatError(stringToChatErrorDisplay('Please select an analysis type.', 'Missing selection'));
        return;
      }
      await chatWithAI(selectedFolder, selectedSecretId, selectedChatSessionId);
      setChatInput("");
      setIsSecretPromptSelected(false);
      setActiveDropdown("Custom Query");
      setSelectedSecretId(null);
      setSelectedLlmName(null);
    } else {
      const questionText = String(forcedQuestion ?? chatInput).trim();
      if (!questionText) return;

      setAnimatedResponseContent('');
      setThinkingContent('');
      streamBufferRef.current = '';
      streamThinkingRef.current = '';
      setChatError(null);
      setLoadingChat(true);
      setIsGenerating(true);
      setPendingQuestion(questionText);
      setPickedOption(null);
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

      const isContinuingSession = currentChatHistory.length > 0;
      if (!isContinuingSession && !panelStatesSetRef.current) {
        setHasResponse(true);
        setHasAiResponse(true);
        setForceSidebarCollapsed(true);
        panelStatesSetRef.current = true;
      }
     
      try {
        const folderName = typeof selectedFolder === 'string' ? selectedFolder : (selectedFolder?.originalname || selectedFolder?.name || null);
        if (!folderName) {
           setChatError("Missing folder information.");
           setLoadingChat(false);
           setIsGenerating(false);
           return;
        }

        const token = getAuthToken();
        const response = await fetch(`${DOCS_BASE_URL}/${encodeURIComponent(folderName)}/intelligent-chat/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : '',
            'Accept': 'text/event-stream',
          },
          body: JSON.stringify({
            question: questionText,
            session_id: selectedChatSessionId || undefined,
            llm_name: 'gemini',
            learning_mode: learningModeActive,
          }),
        });

        if (!response.ok) {
          let errBody = {};
          try {
            errBody = await response.json();
          } catch {
            errBody = {};
          }
          setChatError(parseLlmPolicyErrorForUi(response.status, errBody));
          setHasResponse(false);
          setHasAiResponse(false);
          setForceSidebarCollapsed(false);
          setPendingQuestion('');
          setIsGenerating(false);
          return;
        }

        const reader = response.body.getReader();
        streamReaderRef.current = reader;
        const decoder = new TextDecoder();
        let buffer = '';
        let newSessionId = selectedChatSessionId;
        let finalMetadata = null;
        let messageId = Date.now().toString();
        let streamHadError = false;
        let streamErrorMessage = '';

        while (true) {
          const { done, value } = await reader.read();
         
          if (done) {
            if (streamHadError) {
              console.warn('[ChatInterface] Folder chat stream stopped after error:', streamErrorMessage);
              setLoadingChat(false);
              setCurrentStatus(null);
              setChatInput(questionText);
              break;
            }
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
              learning_mode: !!learningModeActive,
              learningPayload: learningModeActive
                ? (finalMetadata?.learning_payload || extractLearningPayloadLenient(streamBufferRef.current) || null)
                : null,
            };
            const history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
            setCurrentChatHistory(history);
            setPendingQuestion('');

            if (newSessionId) {
              setSelectedChatSessionId(newSessionId);
              fetchChatSessions().catch(() => {});
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
                  setAnimatedResponseContent(finalResponse);
                  setIsAnimatingResponse(false);
                  setIsGenerating(false);
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
              if (streamHadError) {
                console.warn('[ChatInterface] Folder chat stream received DONE after error:', streamErrorMessage);
                setLoadingChat(false);
                setCurrentStatus(null);
                setChatInput(questionText);
                return;
              }
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
              learning_mode: !!learningModeActive,
              learningPayload: learningModeActive
                ? (finalMetadata?.learning_payload || extractLearningPayloadLenient(streamBufferRef.current) || null)
                : null,
            };
              const history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
              setCurrentChatHistory(history);
              setPendingQuestion('');

              if (newSessionId) {
                setSelectedChatSessionId(newSessionId);
                fetchChatSessions(); // Update session list with new session
              }

              if (finalResponse && finalResponse.trim()) {
                setSelectedMessageId(messageId);
                setHasResponse(true);
                setHasAiResponse(true);
                setForceSidebarCollapsed(true);
                setAnimatedResponseContent(finalResponse);
                setIsAnimatingResponse(false);
                setIsGenerating(false);
              }
              setChatInput("");
              return;
            }

            try {
              const parsed = JSON.parse(data);
             
              if (parsed.type === 'metadata') {
                console.log('Stream metadata:', parsed);
                const metaSid = parsed.session_id || parsed.sessionId;
                if (metaSid) {
                  newSessionId = metaSid;
                  setSelectedChatSessionId(metaSid);
                }
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
                  if (streamThinkingRef.current || thinkingContent) {
                    streamThinkingRef.current = '';
                    setThinkingContent('');
                  }
                  streamBufferRef.current += chunkText;
                  setHasResponse(true);
                  setHasAiResponse(true);
                  if (!panelStatesSetRef.current) {
                    setForceSidebarCollapsed(true);
                    panelStatesSetRef.current = true;
                  }
                  const raw = streamBufferRef.current;
                  const live = isStructuredJsonResponse(raw)
                    ? raw
                    : convertJsonToPlainText(raw);
                  setAnimatedResponseContent(live);
                  setIsGenerating(true);
                  setIsAnimatingResponse(true);
                }
              } else if (parsed.type === 'done') {
                finalMetadata = parsed;
                const doneSessionId = finalMetadata.session_id || finalMetadata.sessionId;
                if (doneSessionId) {
                  newSessionId = doneSessionId;
                  setSelectedChatSessionId(doneSessionId);
                }
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
                  learning_mode: !!learningModeActive,
                  learningPayload: learningModeActive
                ? (finalMetadata?.learning_payload || extractLearningPayloadLenient(streamBufferRef.current) || null)
                : null,
                };
                const history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
                setCurrentChatHistory(history);
                setPendingQuestion('');
                setSelectedMessageId(newMessage.id);
                setAnimatedResponseContent(finalResponse);
                setIsAnimatingResponse(false);
                setIsGenerating(false);
                if (doneSessionId) {
                  fetchChatSessions();
                }
              } else if (parsed.type === 'error') {
                streamHadError = true;
                streamErrorMessage = parsed.message || parsed.error || 'An error occurred';
                console.error('[ChatInterface] Folder chat stream error payload:', parsed);
                setChatError(
                  stringToChatErrorDisplay(
                    streamErrorMessage
                  )
                );
                setCurrentStatus(null);
                setLoadingChat(false);
              }
            } catch (e) {
            }
          }
        }
      } catch (err) {
        console.error("Error sending message:", err);
        setChatError(
          stringToChatErrorDisplay(
            err.message || "Couldn't send your message. Please try again."
          )
        );
        setHasResponse(false);
        setHasAiResponse(false);
        setForceSidebarCollapsed(false);
        setPendingQuestion('');
        setIsGenerating(false);
      } finally {
        setLoadingChat(false);
        streamReaderRef.current = null;
      }
    }
  };

  const handleLearningOptionSelect = useCallback(async (optionText) => {
    if (!optionText || loadingChat || isGenerating) return;
    setIsSecretPromptSelected(false);
    setSelectedSecretId(null);
    setSelectedLlmName(null);
    setActiveDropdown("Custom Query");
    await handleNewMessage(String(optionText));
  }, [loadingChat, isGenerating, handleNewMessage]);

  const openPanel = useCallback((type, data) => {
    setPanelType(type);
    setPanelData(data);
    setPanelOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setPanelData(null);
    setPanelType(null);
  }, []);

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
    const chatIsLearning = !!(chat?.learning_mode || chat?.learningPayload);
    startTransition(() => {
      setSelectedMessageId(chat.id);
      setAnimatedResponseContent(formattedResponse);
      setIsAnimatingResponse(false);
      setIsGenerating(false);
      setHasResponse(true);
      // Don't force sidebar collapsed - only collapse if panel is already open
    });
    setCitations([]);
    setShowCitations(false);
    setLoadingCitations(true);
    if (chatIsLearning) {
      closePanel();
    }
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
      setChatError(stringToChatErrorDisplay(errorMessage));
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
    setPendingQuestion('');
    setIsSecretPromptSelected(false);
    setSelectedSecretId(null);
    setSelectedLlmName(null);
    setActiveDropdown("Custom Query");
    setNewChatMode(true);
    closePanel();
  };

  const handleSelectChatSession = useCallback((sessionId) => {
    setSelectedChatSessionId(sessionId);
    setHasAiResponse(true);
    setNewChatMode(false);
  }, [setSelectedChatSessionId, setHasAiResponse]);

  const handleDeleteSession = useCallback(async (sessionId) => {
    const folderName = typeof selectedFolder === 'string'
      ? selectedFolder
      : (selectedFolder?.originalname || selectedFolder?.name || null);

    if (!folderName || !sessionId) return;
    if (!window.confirm('Are you sure you want to delete this session? This action cannot be undone.')) {
      return;
    }

    try {
      setLoadingSessions(true);
      setSessionsError(null);

      const deletePromise = documentApi.deleteFolderChatSession(folderName, sessionId);

      toast.promise(deletePromise, {
        pending: 'Deleting session...',
        success: 'Session deleted successfully!',
        error: {
          render({ data }) {
            const errorMessage = data?.response?.data?.error || data?.message || 'Failed to delete session';
            return errorMessage;
          },
        },
      });

      await deletePromise;

      setChatSessions((prev) => prev.filter((session) => session.sessionId !== sessionId));

      if (selectedChatSessionId === sessionId) {
        setSelectedChatSessionId(null);
        setCurrentChatHistory([]);
        setSelectedMessageId(null);
        setAnimatedResponseContent("");
        setHasResponse(false);
        setHasAiResponse(false);
        setForceSidebarCollapsed(false);
        closePanel();
      }
    } catch (err) {
      console.error('[ChatInterface] Error deleting session:', err);
      setSessionsError('Failed to delete session.');
    } finally {
      setLoadingSessions(false);
    }
  }, [
    selectedFolder,
    selectedChatSessionId,
    setChatSessions,
    setSelectedChatSessionId,
    setHasAiResponse,
    setForceSidebarCollapsed,
    closePanel,
  ]);

  const handleDeleteAllChats = async () => {
    if (!selectedFolder) return;
   
    const chatCount = selectedChatSessionId ? currentChatHistory.length : chatSessions.length;
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
      setChatSessions([]);
      closePanel();
     
      const folderName = typeof selectedFolder === 'string' ? selectedFolder : (selectedFolder?.originalname || selectedFolder?.name || null);
      if (folderName) {
        await fetchChatSessions(folderName);
      }
    } catch (err) {
      console.error("❌ Error deleting all chats:", err);
      const errorMessage = err?.response?.data?.error || err?.message || 'Failed to delete all chats';
      setChatError(stringToChatErrorDisplay(errorMessage));
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

  const getSessionIdFromSummary = (session) =>
    session?.sessionId || session?.session_id || session?.id || null;

  // Helper: extract raw text from rehype node children (used for option detection)
  const extractNodeText = (nodeChildren = []) => {
    return nodeChildren.map(n => {
      if (n.type === 'text') return n.value || '';
      if (n.children) return extractNodeText(n.children);
      return '';
    }).join('');
  };

  // Shared ReactMarkdown component overrides — clean serif style matching the site theme.
  // • Option paragraphs (A) … D)) → interactive clickable choice cards
  // • Bold text → site teal, no chip
  // • Questions (ending with ?) → bold body text (no callout box)
  const aiMarkdownComponents = {
    p: ({ node, children, ...props }) => {
      const rawText = extractNodeText(node?.children || []);

      // ── Option card detection: "A) …", "B) …", "C) …", "D) …" (or A. B. C. D.)
      const optionMatch = rawText.match(/^([A-Da-d])[).]\s+/);
      if (optionMatch) {
        const letter = optionMatch[1].toUpperCase();
        const optKey = `opt-${letter}`;
        const isPicked = pickedOption === optKey;
        const disabled = loadingChat || isGenerating;

        return (
          <div
            onClick={() => {
              if (disabled) return;
              setPickedOption(optKey);
              handleLearningOptionSelect(rawText);
            }}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              padding: '13px 18px',
              margin: '8px 0',
              background: isPicked ? '#f0fdfa' : '#fafafa',
              border: `1.5px solid ${isPicked ? '#21C1B6' : '#e2e8f0'}`,
              borderRadius: '12px',
              cursor: disabled ? 'default' : 'pointer',
              transition: 'all 0.18s ease',
              boxShadow: isPicked ? '0 0 0 3px rgba(33,193,182,0.15)' : 'none',
              opacity: disabled ? 0.7 : 1,
            }}
            onMouseEnter={e => { if (!disabled && !isPicked) e.currentTarget.style.borderColor = '#21C1B6'; }}
            onMouseLeave={e => { if (!disabled && !isPicked) e.currentTarget.style.borderColor = '#e2e8f0'; }}
          >
            {/* Letter badge */}
            <span style={{
              minWidth: '32px', height: '32px',
              borderRadius: '50%',
              background: isPicked ? '#21C1B6' : '#fff',
              border: `2px solid ${isPicked ? '#21C1B6' : '#cbd5e1'}`,
              color: isPicked ? '#fff' : '#64748b',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: '14px', flexShrink: 0,
              transition: 'all 0.18s ease',
            }}>
              {isPicked ? '✓' : letter}
            </span>
            {/* Option content */}
            <span style={{
              flex: 1, fontSize: '18px', lineHeight: '1.65',
              fontFamily: '"Crimson Text", "Times New Roman", Times, serif',
              color: isPicked ? '#0f766e' : '#1a1a1a',
              fontWeight: isPicked ? 600 : 400,
            }}>
              {children}
            </span>
          </div>
        );
      }

      // ── Question paragraph (ends with ?)
      const isQuestion = (() => {
        const last = node?.children?.[node.children.length - 1];
        const text = last?.value || extractNodeText(last?.children || []);
        return text.trimEnd().endsWith('?');
      })();
      if (isQuestion) {
        return (
          <p style={{
            margin: '0 0 16px',
            fontWeight: 700,
            color: '#1a1a1a',
            fontSize: '19px',
            lineHeight: '1.82',
            fontFamily: '"Crimson Text", "Times New Roman", Times, serif',
          }} {...props}>
            {children}
          </p>
        );
      }

      // ── Normal paragraph
      return (
        <p style={{
          margin: '0 0 16px',
          fontSize: '19px',
          lineHeight: '1.82',
          color: '#232323',
          fontFamily: '"Crimson Text", "Times New Roman", Times, serif',
        }} {...props}>
          {children}
        </p>
      );
    },

    strong: ({ children, ...props }) => (
      <strong style={{ fontWeight: 700, color: '#0f766e' }} {...props}>{children}</strong>
    ),
    h1: (p) => <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '24px 0 10px', color: '#111', fontFamily: '"Crimson Text", serif' }} {...p} />,
    h2: (p) => <h2 style={{ fontSize: '21px', fontWeight: 700, margin: '20px 0 8px', color: '#111', fontFamily: '"Crimson Text", serif' }} {...p} />,
    blockquote: (p) => (
      <blockquote style={{
        margin: '18px 0 22px', padding: '6px 0 6px 18px',
        borderLeft: '4px solid #21C1B6', background: '#f0fdfa',
        color: '#134e4a', fontStyle: 'italic', borderRadius: '0 6px 6px 0',
        fontSize: '19px', lineHeight: '1.72', fontFamily: '"Crimson Text", "Times New Roman", Times, serif',
      }} {...p} />
    ),
    ul: (p) => <ul style={{ margin: '0 0 18px', paddingLeft: '28px' }} {...p} />,
    ol: (p) => <ol style={{ margin: '0 0 18px', paddingLeft: '28px' }} {...p} />,
    li: (p) => <li style={{ marginBottom: '8px', fontSize: '19px', lineHeight: '1.72', fontFamily: '"Crimson Text", "Times New Roman", Times, serif' }} {...p} />,
    hr: (p) => <hr style={{ border: 0, borderTop: '1px solid #d9d1c5', margin: '24px 0' }} {...p} />,
    table: ({ children, ...props }) => (
      <div style={{ overflowX: 'auto', margin: '18px 0', WebkitOverflowScrolling: 'touch' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '17px',
            lineHeight: '1.5',
            fontFamily: '"Crimson Text", "Times New Roman", Times, serif',
          }}
          {...props}
        >
          {children}
        </table>
      </div>
    ),
    thead: (p) => <thead style={{ background: '#f8fafc' }} {...p} />,
    tbody: (p) => <tbody {...p} />,
    tr: (p) => <tr style={{ borderBottom: '1px solid #e2e8f0' }} {...p} />,
    th: (p) => (
      <th
        style={{
          border: '1px solid #cbd5e1',
          padding: '10px 12px',
          textAlign: 'left',
          fontWeight: 700,
          color: '#0f172a',
        }}
        {...p}
      />
    ),
    td: (p) => (
      <td
        style={{
          border: '1px solid #e2e8f0',
          padding: '10px 12px',
          verticalAlign: 'top',
          color: '#1e293b',
        }}
        {...p}
      />
    ),
    code: ({ node, inline, children, ...props }) =>
      inline ? (
        <code style={{
          background: '#f0fdfa', border: '1px solid #99f6e4',
          borderRadius: '5px', padding: '2px 6px', fontSize: '14px',
          color: '#0f766e', fontFamily: '"IBM Plex Mono", "Courier New", monospace',
        }} {...props}>{children}</code>
      ) : (
        <code {...props}>{children}</code>
      ),
  };

  const normalizeSessionSummary = (session) => {
    const messages = Array.isArray(session?.messages)
      ? session.messages
      : Array.isArray(session?.chatHistory)
        ? session.chatHistory
        : [];
    const firstMessage = messages[0] || {};
    const lastMessage = messages[messages.length - 1] || {};
    const derivedTitle =
      session?.title ||
      session?.name ||
      session?.question ||
      firstMessage?.question ||
      firstMessage?.prompt_label ||
      firstMessage?.query ||
      "Untitled session";

    return {
      ...session,
      sessionId: getSessionIdFromSummary(session),
      messages,
      title: String(derivedTitle).trim(),
      lastMessageAt:
        session?.updated_at ||
        session?.updatedAt ||
        lastMessage?.updated_at ||
        lastMessage?.created_at ||
        lastMessage?.timestamp ||
        firstMessage?.created_at ||
        session?.created_at ||
        null,
    };
  };

  const fetchChatSessions = useCallback(async (folderName = null) => {
    let folderToFetch = folderName;
    if (!folderToFetch) {
      if (typeof selectedFolder === 'string') {
        folderToFetch = selectedFolder;
      } else if (selectedFolder) {
        folderToFetch = selectedFolder.originalname || selectedFolder.name || null;
      }
    }
    if (!folderToFetch) {
      setChatSessions([]);
      return;
    }

    setLoadingSessions(true);
    setSessionsError(null);
    try {
      // Use getFolderChats which returns persisted history from the database
      const data = await documentApi.getFolderChats(folderToFetch);
      const sessions = Array.isArray(data?.chats) 
        ? data.chats.map(normalizeSessionSummary) 
        : Array.isArray(data) 
          ? data.map(normalizeSessionSummary) 
          : [];
      setChatSessions(sessions);
    } catch (err) {
      console.error('[ChatInterface] Failed to fetch chat sessions:', err);
      setSessionsError('Failed to fetch chat sessions.');
      setChatSessions([]);
    } finally {
      setLoadingSessions(false);
    }
  }, [selectedFolder, setChatSessions]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
      if (styleDropdownRef.current && !styleDropdownRef.current.contains(event.target)) {
        setShowStyleDropdown(false);
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

  // Auto-scroll when a new prompt starts or when chat history updates with a response.
  useEffect(() => {
    if (responseRef.current && pendingQuestion) {
      setTimeout(() => {
        if (responseRef.current) {
          responseRef.current.scrollTop = responseRef.current.scrollHeight;
        }
      }, 50);
    }
  }, [pendingQuestion]);

  useEffect(() => {
    if (responseRef.current && currentChatHistory.length > 0) {
      setTimeout(() => {
        if (responseRef.current) {
          responseRef.current.scrollTop = responseRef.current.scrollHeight;
        }
      }, 50);
    }
  }, [currentChatHistory.length]);

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
    setPendingQuestion('');
    setIsGenerating(false);
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
      fetchedFoldersRef.current.add(folderKey);
      fetchChatSessions(folderName).catch(err => {
        console.error('[ChatInterface] Error in fetchChatSessions:', err);
        fetchedFoldersRef.current.delete(folderKey);
        setChatSessions([]);
      });
    } else {
      console.log('[ChatInterface] Skipping fetchChatSessions - folder is:', selectedFolder);
      if (selectedFolder === null || selectedFolder === undefined) {
        console.log('[ChatInterface] selectedFolder is null/undefined - will fetch sessions when folder is set');
      } else {
        fetchedFoldersRef.current.clear();
        setCurrentChatHistory([]);
      }
    }
  }, [selectedFolder, fetchChatSessions, setChatSessions]);

  useEffect(() => {
    const folderName = typeof selectedFolder === 'string' ? selectedFolder : (selectedFolder?.originalname || selectedFolder?.name || null);
    if (!folderName || !selectedChatSessionId) {
      setCurrentChatHistory([]);
      return;
    }
    fetchChatHistory(selectedChatSessionId, folderName).catch((err) => {
      console.error('[ChatInterface] Error loading selected session:', err);
    });
  }, [selectedFolder, selectedChatSessionId, fetchChatHistory]);

  useEffect(() => {
    setHasAiResponse(panelOpen);
  }, [panelOpen, setHasAiResponse]);

  // Clear newChatMode once a session becomes active
  useEffect(() => {
    if (selectedChatSessionId) setNewChatMode(false);
  }, [selectedChatSessionId]);

  // Must run before any conditional return — same hook order when folder is null vs set.
  const threadUsesLearningLayout = useMemo(
    () =>
      learningModeActive ||
      (Array.isArray(currentChatHistory) && currentChatHistory.some((c) => !!c.learning_mode)),
    [learningModeActive, currentChatHistory]
  );

  if (!selectedFolder) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-lg bg-white">
        Select a folder to start chatting.
      </div>
    );
  }

  const buttonClass = isGenerating
    ? "p-2.5 bg-gray-500 hover:bg-gray-600 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-full transition-colors"
    : "p-2.5 bg-[#21C1B6] hover:bg-[#1AA49B] disabled:bg-gray-300 disabled:cursor-not-allowed rounded-full transition-colors";

  // ── Pagination helpers ──────────────────────────────────────────────────────
  const paginateContent = (text) => {
    const raw = text || '';
    const hasInlineCiteHtml = /class\s*=\s*["'][^"']*inline-cite/.test(raw);
    const normalized = (hasInlineCiteHtml ? raw : convertJsonToPlainText(raw)).replace(/\r\n/g, '\n').trim();
    if (!normalized) return [''];
    const explicitPages = normalized
      .split(/\n\s*(?:\f|---\s*PAGE BREAK\s*---|PAGE_BREAK|PAGE BREAK)\s*\n/gi)
      .map(c => c.trim())
      .filter(Boolean);
    if (explicitPages.length > 1) return explicitPages;
    const blocks = normalized.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
    const pages = [];
    let currentBlocks = [];
    let currentWeight = 0;
    const maxWeight = 2900;
    blocks.forEach(block => {
      const isHeading = /^#{1,6}\s/.test(block) || /^<h[1-6][\s>]/i.test(block);
      const isCode = /^```/.test(block) || /^<pre/i.test(block);
      const weight = Math.max(180, block.length + (isHeading ? 240 : 0) + (isCode ? 280 : 0));
      if (currentBlocks.length && currentWeight + weight > maxWeight) {
        pages.push(currentBlocks.join('\n\n'));
        currentBlocks = [];
        currentWeight = 0;
      }
      currentBlocks.push(block);
      currentWeight += weight;
    });
    if (currentBlocks.length) pages.push(currentBlocks.join('\n\n'));
    return pages.length ? pages : [''];
  };

  // ────────────────────────────────────────────────────────────────────────────
  // showMainArea: show the messages+input panel only when actively chatting
  const hasSessions = chatSessions && chatSessions.length > 0;
  const showMainArea = !!(selectedChatSessionId || pendingQuestion || hasResponse || loadingChat || !hasSessions || newChatMode);

  /** Normal mode: wider reading column; learning mode stays compact. */
  const messagesColumnMaxWidth = panelOpen ? '100%' : threadUsesLearningLayout ? '620px' : 'min(100%, 1180px)';

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden relative" style={{ background: '#fff' }}>
      <ChatQuotaErrorModal error={chatError} onDismiss={() => setChatError(null)} />

      {/* ── Chat Session Sidebar (Left) — full list or collapsed rail ── */}
      {hasSessions && chatHistorySidebarOpen && (
        <div
          className={`flex-shrink-0 flex flex-col border-r border-gray-100 bg-white ${!showMainArea ? 'flex-1' : ''}`}
          style={{ width: showMainArea ? '280px' : undefined, height: '100%' }}
        >
          <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2 min-w-0">
              <MessageSquare className="w-4 h-4 text-[#21C1B6] flex-shrink-0" />
              <span className="truncate">Chat History</span>
            </h3>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                onClick={handleNewChat}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg hover:border-[#21C1B6] hover:text-[#21C1B6] transition-all text-xs font-medium text-gray-700"
                title="Start New Chat"
              >
                <Plus className="w-4 h-4" />
                <span>New Chat</span>
              </button>
              {showMainArea && (
                <button
                  type="button"
                  onClick={() => setChatHistorySidebarOpen(false)}
                  className="p-1.5 bg-white border border-gray-200 rounded-lg hover:border-gray-300 text-gray-500 hover:text-gray-800 transition-all"
                  title="Hide chat history"
                  aria-label="Hide chat history"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 scrollbar-custom">
            {loadingSessions ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-[#21C1B6]" />
              </div>
            ) : sessionsError ? (
              <div className="px-3 py-4 text-xs text-red-500 text-center">{sessionsError}</div>
            ) : (
              <ChatSessionList
                sessions={chatSessions}
                selectedSessionId={selectedChatSessionId}
                onSelectSession={handleSelectChatSession}
                onDeleteSession={handleDeleteSession}
              />
            )}
          </div>
        </div>
      )}
      {hasSessions && !chatHistorySidebarOpen && showMainArea && (
        <div className="flex-shrink-0 flex flex-col items-center border-r border-gray-100 bg-white w-11 py-3 gap-2">
          <button
            type="button"
            onClick={() => setChatHistorySidebarOpen(true)}
            className="p-2 rounded-lg border border-gray-200 hover:border-[#21C1B6] text-gray-600 hover:text-[#11766f] transition-colors"
            title="Show chat history"
            aria-label="Show chat history"
          >
            <MessageSquare className="w-4 h-4 text-[#21C1B6]" />
          </button>
        </div>
      )}

      {/* ── MAIN CONTENT AREA (messages + input) — only when actively chatting ── */}
      {showMainArea && <div className="flex flex-1 min-w-0 h-full overflow-hidden relative bg-white">
        {/* Chat message panel (60% or 100% of available space) */}
        <div style={{ 
          width: panelOpen ? '40%' : '100%', 
          transition: 'width 0.3s ease', 
          display: 'flex', 
          flexDirection: 'column', 
          height: '100%', 
          borderRight: panelOpen ? '1px solid #e5e7eb' : 'none', 
          overflow: 'hidden', 
          background: '#ffffff' 
        }}>

          {/* top bar */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0 bg-white">
            <span className="text-sm font-medium text-gray-700">
              {selectedChatSessionId ? (chatSessions.find(s => s.sessionId === selectedChatSessionId)?.title || "Active Chat") : "New Conversation"}
            </span>
            <div className="flex items-center gap-2">
              {(chatSessions.length > 0 || currentChatHistory.length > 0) && (
                <button onClick={handleDeleteAllChats} disabled={loadingChat} title="Clear all" className="p-1 text-gray-400 hover:text-red-500 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              {hasResponse && !selectedMessageIsLearning && (
                <button
                  type="button"
                  onClick={() => panelOpen ? closePanel() : openPanel('response', { response: activeResponseContent, messageId: selectedMessageId })}
                  title={panelOpen ? 'Close split view' : 'Open split view'}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition-colors inline-flex items-center gap-1.5 ${
                    panelOpen
                      ? 'text-[#11766f] bg-[#E0F7F6] border border-[#21C1B6]'
                      : 'text-[#11766f] bg-white border border-[#21C1B6] hover:bg-[#f0fdfa]'
                  }`}
                >
                  <PanelRight className="w-3.5 h-3.5" />
                  <span>{panelOpen ? 'Close Split' : 'Split View'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Messages Area */}
          <div
            className={`flex-1 overflow-y-auto py-8 scrollbar-custom bg-white ${threadUsesLearningLayout ? 'px-5 sm:px-6' : 'px-8'}`}
            ref={responseRef}
          >
            <div style={{
              maxWidth: messagesColumnMaxWidth,
              margin: '0 auto',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '32px',
            }}
            >
              {!selectedChatSessionId && !pendingQuestion ? (
                <div className="flex flex-col items-center justify-center h-full text-center pt-20">
                  <div className="w-16 h-16 bg-[#F0FDF9] rounded-2xl flex items-center justify-center mb-4">
                    <MessageSquare className="h-8 w-8 text-[#21C1B6]" />
                  </div>
                  <h2 className="text-xl font-bold text-gray-800 mb-2">How can I help you today?</h2>
                  <p className="text-gray-500 text-sm max-w-sm mx-auto">
                    Ask a question above to start a new analysis session or select an existing one from the history.
                  </p>
                </div>
              ) : (loadingChat && currentChatHistory.length === 0) ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-7 w-7 animate-spin text-[#21C1B6]" />
                </div>
              ) : (currentChatHistory.length === 0 && !pendingQuestion) ? (
                <div className="flex flex-col items-center justify-center h-full text-center pt-20">
                  <MessageSquare className="h-10 w-10 mb-3 text-gray-200" />
                  <p className="text-gray-400 text-sm">This session has no messages yet</p>
                </div>
              ) : (
                <>
                  {currentChatHistory.map((chat, idx) => {
                    let resolvedPayload = chat.learningPayload || null;
                    if (!resolvedPayload && (learningModeActive || chat.learning_mode)) {
                      const raw = String(chat.response || '').trim();
                      resolvedPayload =
                        extractLearningPayloadLenient(raw) ||
                        extractLearningPayloadFromRaw(raw) ||
                        null;
                      if (!resolvedPayload) {
                        try {
                          const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
                          const parsed = JSON.parse(cleaned);
                          if (parsed && typeof parsed === 'object' && ('feedback' in parsed || 'question' in parsed)) {
                            resolvedPayload = parsed;
                          }
                        } catch { /* not JSON */ }
                      }
                    }
                    const isLearning = !!(learningModeActive || chat.learning_mode);

                    return (
                      <div key={chat.id != null ? `${String(chat.id)}-${idx}` : `chat-${idx}`} className="flex flex-col gap-3">
                        {/* User question item */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          {panelOpen && !isLearning ? (
                            <div style={{ width: '100%', position: 'relative' }}>
                              <button
                                type="button"
                                onClick={() => handleSelectChat(chat)}
                                style={{
                                  background: selectedMessageId === chat.id ? '#E0F7F6' : '#f9fafb',
                                  color: '#1a1a1a',
                                  borderRadius: '12px',
                                  border: selectedMessageId === chat.id ? '1px solid #21C1B6' : '1px solid #e5e7eb',
                                  padding: '14px 38px 14px 14px',
                                  minHeight: '64px',
                                  width: '84%',
                                  textAlign: 'left',
                                  fontSize: '14px',
                                  fontWeight: selectedMessageId === chat.id ? '600' : '500',
                                  lineHeight: '1.45',
                                  fontFamily: 'Inter, sans-serif',
                                  wordBreak: 'break-word',
                                  boxShadow: selectedMessageId === chat.id ? '0 1px 3px rgba(33, 193, 182, 0.12)' : 'none',
                                  cursor: 'pointer',
                                  marginLeft: 'auto'
                                }}
                              >
                                {(chat.used_secret_prompt || chat.isSecretPrompt) && (chat.prompt_label || chat.promptLabel)
                                  ? `Analysis: ${chat.prompt_label || chat.promptLabel}`
                                  : (chat.question || chat.prompt_label || chat.promptLabel || chat.query || "Untitled")}
                              </button>
                              <div
                                className="absolute top-2 right-2"
                                ref={(el) => (chatMenuRefs.current[chat.id] = el)}
                              >
                                <button
                                  onClick={(e) => handleChatMenuToggle(chat.id, e)}
                                  className="p-1 text-gray-400 hover:text-gray-600 transition-colors rounded"
                                >
                                  <MoreVertical className="h-3.5 w-3.5" />
                                </button>
                                {openChatMenuId === chat.id && (
                                  <div className="absolute right-0 top-7 w-36 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                                    <button onClick={(e) => handleDeleteChat(chat.id, e)} className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 rounded-lg">
                                      <Trash2 className="w-4 h-4" /> Delete
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div style={{
                              background: '#f0fdfa',
                              color: '#1a1a1a',
                              borderRadius: '18px 18px 4px 18px',
                              border: '1px solid #21C1B6',
                              padding: '10px 16px',
                              maxWidth: '72%',
                              fontSize: '17px',
                              fontWeight: '500',
                              lineHeight: '1.55',
                              fontFamily: 'Inter, sans-serif',
                              wordBreak: 'break-word',
                              boxShadow: '0 2px 4px rgba(33, 193, 182, 0.05)'
                            }}>
                              {(chat.used_secret_prompt || chat.isSecretPrompt) && (chat.prompt_label || chat.promptLabel)
                                ? `Analysis: ${chat.prompt_label || chat.promptLabel}`
                                : (chat.question || chat.prompt_label || chat.promptLabel || chat.query || "Untitled")}
                            </div>
                          )}
                        </div>

                        {/* AI response (Normal mode: hidden in left column when split panel is open) */}
                        {(!panelOpen || isLearning) && (chat.response || ((loadingChat || isGenerating) && !pendingQuestion && idx === currentChatHistory.length - 1)) && (
                          isLearning ? (
                            <div style={{ display: 'flex', justifyContent: 'flex-start', width: '100%' }}>
                              <div style={{ width: '100%', padding: '4px 0' }}>
                                {(loadingChat || isGenerating) && idx === currentChatHistory.length - 1 && !resolvedPayload && !pendingQuestion ? (
                                  <div className="flex items-center gap-2 text-gray-500 text-sm">
                                    <Loader2 className="h-4 w-4 animate-spin text-[#21C1B6]" />
                                    <span>Thinking...</span>
                                  </div>
                                ) : resolvedPayload ? (
                                  <LearningChatBubble
                                    data={resolvedPayload}
                                    isStreaming={(loadingChat || isGenerating) && idx === currentChatHistory.length - 1 && !pendingQuestion}
                                    optionsInteractionLocked={idx !== currentChatHistory.length - 1}
                                    onOptionClick={handleLearningOptionSelect}
                                    onViewFull={null}
                                  />
                                ) : (
                                  <div style={{ maxWidth: '560px', width: '100%', margin: '0 auto', fontSize: '16px', lineHeight: '1.65', color: '#111827', fontFamily: 'Inter, system-ui, sans-serif' }}>
                                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]} components={aiMarkdownComponents}>
                                      {chat.response}
                                    </ReactMarkdown>
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div style={{ maxWidth: '100%', margin: '0 auto', width: '100%', fontSize: '16px', lineHeight: '1.65', color: '#111827', fontFamily: 'Inter, system-ui, sans-serif' }}>
                              {!chat.response ? (
                                <div className="flex items-center gap-2 text-gray-500 text-sm py-2">
                                  <Loader2 className="h-4 w-4 animate-spin text-[#21C1B6]" />
                                  <span>Thinking...</span>
                                </div>
                              ) : (
                                <>
                                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]} components={aiMarkdownComponents}>
                                    {chat.response}
                                  </ReactMarkdown>
                                  <div className="flex items-center gap-2 mt-2">
                                    <button onClick={() => navigator.clipboard.writeText(chat.response)} className="p-1 px-2 text-[10px] text-gray-400 border border-gray-200 rounded hover:bg-gray-50">Copy</button>
                                    <button onClick={() => { handleSelectChat(chat); openPanel('response', { response: chat.response, messageId: chat.id }); }} className="p-1 px-2 text-[10px] text-gray-400 border border-gray-200 rounded hover:bg-gray-50">Open in Panel</button>
                                  </div>
                                </>
                              )}
                            </div>
                          )
                        )}

                        {/* Menu */}
                        {!(panelOpen && !isLearning) && (
                          <div className="mt-1 flex justify-end">
                            <div className="relative" ref={(el) => (chatMenuRefs.current[chat.id] = el)}>
                              <button onClick={(e) => handleChatMenuToggle(chat.id, e)} className="p-1 text-gray-300 hover:text-gray-500 transition-colors">
                                <MoreVertical className="h-3.5 w-3.5" />
                              </button>
                              {openChatMenuId === chat.id && (
                                <div className="absolute right-0 bottom-6 w-36 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                                  <button onClick={(e) => handleDeleteChat(chat.id, e)} className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 rounded-lg">
                                    <Trash2 className="w-4 h-4" /> Delete
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Pending Question */}
                  {pendingQuestion && (
                    <div className="flex flex-col gap-3">
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <div style={{ background: '#f0fdfa', border: '1px solid #21C1B6', borderRadius: '18px 18px 4px 18px', padding: '10px 16px', maxWidth: '72%', fontSize: '17px', color: '#1a1a1a', fontFamily: 'Inter, sans-serif' }}>
                          {pendingQuestion}
                        </div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        {learningModeActive ? (
                          <div style={{ width: '100%', maxWidth: '560px', margin: '0 auto' }}>
                            {(() => {
                              const livePayload =
                                extractLearningPayloadLenient(animatedResponseContent) ||
                                extractLearningPayloadFromRaw(animatedResponseContent);
                              if (livePayload) {
                                return (
                                  <LearningChatBubble
                                    data={livePayload}
                                    isStreaming={loadingChat || isGenerating}
                                    optionsInteractionLocked={false}
                                    onOptionClick={handleLearningOptionSelect}
                                    onViewFull={null}
                                  />
                                );
                              }
                              if (loadingChat || isGenerating) {
                                return (
                                  <div className="flex items-center gap-2 text-gray-500 text-sm">
                                    <Loader2 className="h-4 w-4 animate-spin text-[#21C1B6]" />
                                    <span>Thinking...</span>
                                  </div>
                                );
                              }
                              if (animatedResponseContent) {
                                return (
                                  <div style={{ fontSize: '16px', lineHeight: '1.65', color: '#111827', fontFamily: 'Inter, system-ui, sans-serif' }}>
                                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]} components={aiMarkdownComponents}>{animatedResponseContent}</ReactMarkdown>
                                  </div>
                                );
                              }
                              return (
                                <div className="flex items-center gap-2 text-gray-500 text-sm">
                                  <Loader2 className="h-4 w-4 animate-spin text-[#21C1B6]" />
                                  <span>Thinking...</span>
                                </div>
                              );
                            })()}
                          </div>
                        ) : (
                          <div style={{ maxWidth: '100%', margin: '0 auto', width: '100%', fontSize: '16px', lineHeight: '1.65', color: '#111827', fontFamily: 'Inter, system-ui, sans-serif' }}>
                            {animatedResponseContent ? (
                              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]} components={aiMarkdownComponents}>{animatedResponseContent}</ReactMarkdown>
                            ) : (
                              <div className="flex items-center gap-2 text-gray-500 text-sm py-2">
                                <Loader2 className="h-4 w-4 animate-spin text-[#21C1B6]" />
                                <span>Thinking...</span>
                              </div>
                            )}
                            {isGenerating && <span className="inline-block w-0.5 h-4 bg-gray-500 ml-1 animate-pulse" />}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Input Area */}
          <div className="flex-shrink-0 border-t border-gray-200 p-2 bg-white">
            <form 
              onSubmit={(e) => {
                e.preventDefault();
                if (isGenerating) handleStopGeneration();
                else handleNewMessage().catch(console.error);
              }}
              className="flex items-center space-x-3 bg-white rounded-xl border border-[#21C1B6] px-4 py-4 focus-within:ring-[#21C1B6]"
            >
              <div className="relative flex-shrink-0" ref={dropdownRef}>
                <button type="button" onClick={() => setShowDropdown(!showDropdown)} className="flex items-center space-x-2 px-2.5 py-1.5 text-xs font-medium text-gray-700 bg-white border border-[#21C1B6] rounded-lg">
                  <BookOpen className="h-3.5 w-3.5" />
                  <span>{isLoadingSecrets ? "Loading..." : activeDropdown}</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {showDropdown && !isLoadingSecrets && (
                  <div className="absolute bottom-full left-0 mb-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto">
                    {secrets.map((s) => (
                      <button key={s.id} type="button" onClick={() => handleDropdownSelect(s.name, s.id, s.llm_name)} className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">{s.name}</button>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative flex-shrink-0" ref={styleDropdownRef}>
                <button
                  type="button"
                  onClick={() => setShowStyleDropdown(!showStyleDropdown)}
                  className="flex items-center space-x-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-700 bg-white border border-[#21C1B6] rounded-lg"
                  title="Mode settings"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  {learningModeActive ? (
                    <Sparkles className="h-3.5 w-3.5 text-[#21C1B6]" />
                  ) : (
                    <MessageSquare className="h-3.5 w-3.5 text-[#21C1B6]" />
                  )}
                </button>
                {showStyleDropdown && (
                  <div className="absolute bottom-full left-0 mb-2 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-20 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => { setLearningModeActive(false); setShowStyleDropdown(false); closePanel(); }}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      <span className="flex items-center gap-2">
                        <MessageSquare className="h-3.5 w-3.5 text-[#21C1B6]" />
                        Normal
                      </span>
                      {!learningModeActive && <Check className="h-3.5 w-3.5 text-[#21C1B6]" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setLearningModeActive(true); setShowStyleDropdown(false); }}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      <span className="flex items-center gap-2">
                        <Sparkles className="h-3.5 w-3.5 text-[#21C1B6]" />
                        Learning
                      </span>
                      {learningModeActive && <Check className="h-3.5 w-3.5 text-[#21C1B6]" />}
                    </button>
                  </div>
                )}
              </div>
              <input
                type="text"
                value={chatInput}
                onChange={handleChatInputChange}
                placeholder={isSecretPromptSelected ? `Analysis: ${activeDropdown}` : "How can I help you today?"}
                className="flex-grow bg-transparent border-none outline-none text-gray-900 text-sm font-medium py-2 min-w-0"
                disabled={loadingChat}
              />
              <button
                type="submit"
                disabled={!isGenerating && (loadingChat || (!chatInput.trim() && !isSecretPromptSelected))}
                className="p-2 bg-[#21C1B6] hover:bg-[#1AA49B] disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex-shrink-0"
                title={isGenerating ? "Stop" : loadingChat ? "Sending…" : "Send"}
              >
                {isGenerating ? (
                  <X className="h-4 w-4" />
                ) : loadingChat ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </form>
          </div>
        </div>
        {/* PANEL CLOSED ABOVE, MAIN REMAINS OPEN FOR ARTIFACT PANEL */}
        {panelOpen && (
        <div className="chat-artifact-panel flex flex-col h-full min-w-0 relative" style={{ width: '60%', background: '#ffffff', overflow: 'hidden' }}>
          {/* ── Learning panel ── */}
          {panelType === 'learning' && panelData && (
            <LearningDetailPanel
              data={panelData}
              onOptionClick={handleLearningOptionSelect}
              onClose={closePanel}
              isStreaming={isGenerating || loadingChat}
            />
          )}

          {/* ── Agentic steps panel ── */}
          {panelType === 'agentic' && (
            <AgentStepsPanel
              steps={panelData?.steps || []}
              onClose={closePanel}
            />
          )}

          {/* ── Response / A4 viewer panel ── */}
          {(panelType === 'response' || (!panelType && hasResponse)) && (
          <>{/* Toolbar */}
          {selectedMessageId && activeResponseContent && (
            <div className="flex-shrink-0 px-4 py-2 flex items-center justify-between" style={{ background: '#ffffff', borderBottom: '1px solid #e5e7eb' }}>
              <div className="flex items-center gap-2">
                <DownloadPdf markdownOutputRef={markdownOutputRef} />
                <button
                  onClick={handleCopyResponse}
                  className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded transition-colors"
                  title="Copy to clipboard"
                >
                  {copySuccess ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <div className="text-xs text-gray-500">
                {currentChatHistory.find((msg) => msg.id === selectedMessageId)?.timestamp && (
                  <span>{formatDate(currentChatHistory.find((msg) => msg.id === selectedMessageId).timestamp)}</span>
                )}
              </div>
            </div>
          )}
          {/* A4 scroll area */}
          <div className="flex-1 overflow-y-auto scrollbar-custom" ref={responseRef} style={{ background: '#ffffff', padding: '24px 0' }}>
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
           
            {loadingChat && !activeResponseContent && !thinkingContent && !currentStatus ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-[#21C1B6]" />
                  <p className="text-gray-600">Generating response...</p>
                </div>
              </div>
            ) : selectedMessageId && (activeResponseContent || thinkingContent || currentStatus) ? (
              /* Paginated A4 pages — one card per page, Claude-style */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '0 0 32px 0' }}>
                {/* Thinking section above page 1 */}
                {thinkingContent && (
                  <div style={{
                    margin: '0 auto', width: '210mm', background: '#f5f5f5',
                    borderLeft: '4px solid #4285f4', borderRadius: '8px', padding: '16px',
                    boxSizing: 'border-box', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", sans-serif'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: '#5f6368', fontSize: '14px', fontWeight: '500' }}>
                      <span style={{ fontSize: '18px' }}>🧠</span>
                      <span>Thinking...</span>
                    </div>
                    <div style={{ color: '#3c4043', fontSize: '14px', lineHeight: '1.6', whiteSpace: 'pre-wrap', fontFamily: '"Roboto Mono", "Courier New", monospace', background: 'white', padding: '12px', borderRadius: '4px', border: '1px solid #e0e0e0', wordWrap: 'break-word' }}>
                      {thinkingContent}
                      {loadingChat && <span style={{ animation: 'blink 1s infinite' }}>▋</span>}
                    </div>
                  </div>
                )}
                {/* Paginated content */}
                {(() => {
                  const pages = selectedMessageIsLearning
                    ? [activeResponseContent || '']
                    : paginateContent(activeResponseContent || '');
                  const totalPages = pages.length || 1;
                  const useContinuousPanelLayout = selectedMessageIsLearning;

                  const openCitationByIndex = async (n) => {
                    if (!Number.isFinite(n) || n < 1) return;
                    const cite = citations?.[n - 1];
                    if (!cite) return;
                    const fid = await resolveCitationFileId(cite);
                    const pageNum = cite.page ?? cite.pageStart ?? 1;
                    const token = getAuthToken();
                    if (!token) {
                      toast.error('Please sign in to open the document.');
                      return;
                    }
                    if (!fid) {
                      toast.error('Document link is not available for this citation.');
                      return;
                    }
                    openDocumentAtPage(fid, pageNum, cite.filename, token);
                  };

                  const classListIncludesInlineCite = (cls) => {
                    if (!cls) return false;
                    const parts = Array.isArray(cls) ? cls : String(cls).split(/\s+/);
                    return parts.some((c) => String(c).includes('inline-cite'));
                  };

                  const mdComponents = {
                    h1: ({node, ...props}) => <h1 style={{ fontFamily: '"Times New Roman", Times, serif', fontSize: '24px', fontWeight: 700, margin: '24px 0 12px', color: '#111', lineHeight: 1.3 }} {...props} />,
                    h2: ({node, ...props}) => <h2 style={{ fontFamily: '"Times New Roman", Times, serif', fontSize: '21px', fontWeight: 700, margin: '20px 0 10px', color: '#111', lineHeight: 1.3 }} {...props} />,
                    h3: ({node, ...props}) => <h3 style={{ fontFamily: '"Times New Roman", Times, serif', fontSize: '19px', fontWeight: 700, margin: '16px 0 8px', color: '#111' }} {...props} />,
                    h4: ({node, ...props}) => <h4 style={{ fontFamily: '"Times New Roman", Times, serif', fontSize: '19px', fontWeight: 700, margin: '14px 0 6px', color: '#222' }} {...props} />,
                    h5: ({node, ...props}) => <h5 style={{ fontFamily: '"Times New Roman", Times, serif', fontSize: '17px', fontWeight: 700, margin: '12px 0 4px', color: '#333' }} {...props} />,
                    h6: ({node, ...props}) => <h6 style={{ fontFamily: '"Times New Roman", Times, serif', fontSize: '17px', fontWeight: 700, margin: '10px 0 4px', color: '#444' }} {...props} />,
                    p: ({node, ...props}) => <p style={{ fontFamily: '"Times New Roman", Times, serif', marginBottom: '14px', lineHeight: '1.75', color: '#1a1a1a', fontSize: '19px' }} {...props} />,
                    strong: ({node, ...props}) => <strong style={{ fontWeight: 700, color: '#111' }} {...props} />,
                    em: ({node, ...props}) => <em style={{ fontStyle: 'italic' }} {...props} />,
                    ul: ({node, ...props}) => <ul style={{ listStyleType: 'disc', paddingLeft: '28px', marginBottom: '14px', marginTop: '6px' }} {...props} />,
                    ol: ({node, ...props}) => <ol style={{ listStyleType: 'decimal', paddingLeft: '28px', marginBottom: '14px', marginTop: '6px' }} {...props} />,
                    li: ({node, ...props}) => <li style={{ fontFamily: '"Times New Roman", Times, serif', marginBottom: '6px', lineHeight: '1.75', color: '#1a1a1a', fontSize: '19px' }} {...props} />,
                    a: ({node, ...props}) => <a {...props} style={{ color: '#1a6db5', textDecoration: 'underline' }} target="_blank" rel="noopener noreferrer" />,
                    blockquote: ({node, ...props}) => <blockquote style={{ borderLeft: '3px solid #ccc', paddingLeft: '16px', margin: '16px 0', color: '#555', fontStyle: 'italic', fontSize: '19px', lineHeight: 1.75 }} {...props} />,
                    code: ({node, inline, className, children, ...props}) => {
                      const match = /language-(\w+)/.exec(className || '');
                      const language = match ? match[1] : '';
                      if (inline) return <code className="bg-gray-100 text-red-600 px-1.5 py-0.5 rounded text-sm font-mono border border-gray-200" {...props}>{children}</code>;
                      return (
                        <div className="relative my-4">
                          {language && <div className="bg-gray-800 text-gray-300 text-xs px-3 py-1 rounded-t font-mono">{language}</div>}
                          <pre className={`bg-gray-900 text-gray-100 p-4 ${language ? 'rounded-b' : 'rounded'} overflow-x-auto`}>
                            <code className="font-mono text-sm" {...props}>{children}</code>
                          </pre>
                        </div>
                      );
                    },
                    pre: ({node, ...props}) => <pre className="bg-gray-900 text-gray-100 p-4 rounded my-4 overflow-x-auto" {...props} />,
                    table: ({node, ...props}) => <div className="my-6 rounded-lg border border-gray-300 shadow-sm overflow-x-auto"><table className="min-w-full divide-y divide-gray-300" {...props} /></div>,
                    thead: ({node, ...props}) => <thead className="bg-gradient-to-r from-gray-50 to-gray-100" {...props} />,
                    th: ({node, ...props}) => <th className="px-6 py-4 text-left text-xs font-bold text-gray-800 uppercase tracking-wider border-b-2 border-gray-300" {...props} />,
                    tbody: ({node, ...props}) => <tbody className="bg-white divide-y divide-gray-200" {...props} />,
                    tr: ({node, ...props}) => <tr className="hover:bg-gray-50 transition-colors" {...props} />,
                    td: ({node, ...props}) => <td className="px-6 py-4 text-sm text-gray-800 border-b border-gray-100 leading-relaxed" {...props} />,
                    hr: ({node, ...props}) => <hr className="my-6 border-t-2 border-gray-300" {...props} />,
                    img: ({node, ...props}) => <img className="max-w-full h-auto rounded-lg shadow-md my-4" alt="" {...props} />,
                    span: ({ node, className, children, ...props }) => {
                      const hastClass = node?.properties?.className;
                      const isCite =
                        classListIncludesInlineCite(className) || classListIncludesInlineCite(hastClass);
                      const rawN =
                        props['data-n'] ??
                        node?.properties?.['data-n'] ??
                        node?.properties?.dataN;
                      const n = rawN != null ? parseInt(String(rawN), 10) : NaN;
                      if (
                        isCite &&
                        Number.isFinite(n) &&
                        citations?.length &&
                        n >= 1 &&
                        n <= citations.length
                      ) {
                        const cite = citations[n - 1];
                        const pageNum = cite.page ?? cite.pageStart ?? 1;
                        const pageLabel =
                          cite.pageLabel ||
                          (cite.page || cite.pageStart ? `p. ${cite.page || cite.pageStart}` : null);
                        const titleBits = [cite.filename, pageLabel].filter(Boolean).join(' · ');
                        return (
                          <span
                            role="link"
                            tabIndex={0}
                            data-n={n}
                            className={`inline-cite ${className || ''}`.trim()}
                            title={titleBits || 'Citation'}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openCitationByIndex(n);
                            }}
                            onKeyDown={(e) => {
                              if (e.key !== 'Enter' && e.key !== ' ') return;
                              e.preventDefault();
                              e.stopPropagation();
                              openCitationByIndex(n);
                            }}
                          >
                            <span className="inline-cite-num">[{n}]</span>
                            {pageLabel ? (
                              <span className="inline-cite-page"> {pageLabel}</span>
                            ) : null}
                          </span>
                        );
                      }
                      return (
                        <span className={className} {...props}>
                          {children}
                        </span>
                      );
                    },
                  };
                  return pages.map((pageContent, idx) => (
                    <article
                      key={`ci-page-${idx}`}
                      style={{
                        margin: '0 auto',
                        width: useContinuousPanelLayout ? 'min(920px, calc(100% - 48px))' : '210mm',
                        minHeight: useContinuousPanelLayout ? 'auto' : '297mm',
                        background: '#ffffff',
                        boxShadow: useContinuousPanelLayout ? 'none' : '0 16px 34px rgba(15,23,42,0.12)',
                        padding: useContinuousPanelLayout ? '8px 6px 20px' : '20mm 18mm',
                        boxSizing: 'border-box',
                        borderRadius: useContinuousPanelLayout ? '0' : '8px',
                        border: useContinuousPanelLayout ? 'none' : '1px solid #d9d2c6',
                        fontFamily: '"Times New Roman", Times, serif',
                      }}
                    >
                      {!useContinuousPanelLayout && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e4ddd2', paddingBottom: '10px', marginBottom: '24px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.12em', color: '#807868' }}>
                          <span>JuriNex Analysis</span>
                          <span>Page {idx + 1}</span>
                        </div>
                      )}
                      {/* Content */}
                      <div
                        ref={idx === 0 ? markdownOutputRef : undefined}
                        onClick={(e) => {
                          const t = e.target;
                          const el =
                            (t && t.nodeType === 3 ? t.parentElement : t)?.closest?.('.inline-cite');
                          if (!el) return;
                          e.preventDefault();
                          const n = parseInt(el.getAttribute('data-n'), 10);
                          openCitationByIndex(n);
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          const t = e.target;
                          const el =
                            (t && t.nodeType === 3 ? t.parentElement : t)?.closest?.('.inline-cite');
                          if (!el) return;
                          e.preventDefault();
                          const n = parseInt(el.getAttribute('data-n'), 10);
                          openCitationByIndex(n);
                        }}
                      >
                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={mdComponents}>
                          {pageContent}
                        </ReactMarkdown>
                        {idx === pages.length - 1 && isGenerating && (
                          <span style={{ display: 'inline-block', width: '2px', height: '18px', background: '#555', marginLeft: '2px', verticalAlign: 'middle', animation: 'blink 1s step-end infinite' }} />
                        )}
                      </div>
                      {!useContinuousPanelLayout && (
                        <div style={{ marginTop: '32px', paddingTop: '12px', borderTop: '1px solid #e7e1d7', textAlign: 'right', fontSize: '11px', color: '#807868' }}>
                          Page {idx + 1} / {totalPages}
                        </div>
                      )}
                    </article>
                  ));
                })()}
                {Array.isArray(citations) && citations.length > 0 && (
                  <section
                    style={{
                      margin: '0 auto',
                      width: '210mm',
                      background: '#f7fbff',
                      border: '1px solid #d6e8ff',
                      borderRadius: '12px',
                      padding: '12px 14px',
                      boxSizing: 'border-box',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '11px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.12em',
                        color: '#335b8a',
                        marginBottom: '8px',
                        fontWeight: 700,
                      }}
                    >
                      Paragraph Sources
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {citations.map((cite, idx) => {
                        const n = idx + 1;
                        const pageLabel = cite.pageLabel || (cite.page || cite.pageStart ? `Page ${cite.page || cite.pageStart}` : '');
                        const label = `${n}. ${cite.filename || 'Document'}${pageLabel ? ` - ${pageLabel}` : ''}`;
                        return (
                          <button
                            key={`visible-source-${n}-${cite.fileId || cite.document_id || cite.filename || 'doc'}`}
                            type="button"
                            onClick={async () => {
                              const token = getAuthToken();
                              if (!token) {
                                toast.error('Please sign in to open the document.');
                                return;
                              }
                              const fid = await resolveCitationFileId(cite);
                              if (!fid) {
                                toast.error('Document link is not available for this citation.');
                                return;
                              }
                              const pageNum = cite.page ?? cite.pageStart ?? 1;
                              openDocumentAtPage(fid, pageNum, cite.filename, token);
                            }}
                            style={{
                              textAlign: 'left',
                              padding: '6px 8px',
                              borderRadius: '8px',
                              border: '1px solid #d6e8ff',
                              background: '#ffffff',
                              color: '#1d4ed8',
                              fontSize: '13px',
                              textDecoration: 'underline',
                              cursor: 'pointer',
                            }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                )}
                {!loadingChat && !isGenerating && suggestedQuestions.length > 0 && (
                  <div
                    style={{
                      margin: '0 auto',
                      width: '210mm',
                      background: '#f8fbfa',
                      border: '1px solid #d7e8e1',
                      borderRadius: '16px',
                      padding: '18px 20px',
                      boxSizing: 'border-box',
                    }}
                  >
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.18em', color: '#6f7f79', marginBottom: '6px' }}>
                        Suggested Questions
                      </div>
                      <div style={{ fontSize: '14px', color: '#3e4b46' }}>
                        Use these follow-up questions to study the case in more detail.
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                      {suggestedQuestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => handleSuggestedQuestionClick(suggestion)}
                          style={{
                            textAlign: 'left',
                            padding: '10px 14px',
                            borderRadius: '999px',
                            background: '#ffffff',
                            border: '1px solid #c9ddd5',
                            color: '#20463f',
                            fontSize: '14px',
                            cursor: 'pointer',
                          }}
                        >
                          {suggestion}
                        </button>
                      ))}
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
          {false && selectedMessageId && (() => {
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
          </>
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
              const fileId = await resolveCitationFileId(citation);
             
              if (!fileId) {
                console.error('[Citations] Invalid citation: missing fileId', citation);
                toast.error('Document link is not available for this citation.');
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

        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }

        .inline-cite {
          display: inline-block;
          color: #1d4ed8;
          cursor: pointer;
          font-size: 10.5px;
          font-weight: 700;
          font-family: Inter, sans-serif;
          margin-left: 2px;
          padding: 0 3px;
          border-radius: 3px;
          background: #eff6ff;
          border: 1px solid #bfdbfe;
          vertical-align: super;
          line-height: 1.2;
          transition: background 0.15s, color 0.15s;
          user-select: none;
        }
        .inline-cite:hover {
          background: #dbeafe;
          color: #1e40af;
        }
        .inline-cite .inline-cite-page {
          font-weight: 500;
          font-size: 9px;
          color: #1e3a8a;
          margin-left: 2px;
        }
      `}</style>
      </div>}
    </div>
  );
};

export default ChatInterface;
