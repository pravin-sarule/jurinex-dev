


// import '../styles/AnalysisPage.css';
// import React, { useState, useEffect, useRef, useMemo } from 'react';
// import { useLocation, useParams, useNavigate } from 'react-router-dom';
// import { useSidebar } from '../context/SidebarContext';
// import DownloadPdf from '../components/DownloadPdf/DownloadPdf';
// import ReactMarkdown from 'react-markdown';
// import remarkGfm from 'remark-gfm';
// import rehypeRaw from 'rehype-raw';
// import rehypeSanitize from 'rehype-sanitize';
// import UploadProgressPanel from '../components/AnalysisPage/UploadProgressPanel';
// import ChatInputArea from '../components/AnalysisPage/ChatInputArea';
// import MessagesList from '../components/AnalysisPage/MessageList';
// import DocumentList from '../components/AnalysisPage/DocumentList';
// import DocumentViewer from '../components/AnalysisPage/DocumentViewer';
// import {
//   Search,
//   Send,
//   FileText,
//   Trash2,
//   RotateCcw,
//   ArrowRight,
//   ChevronRight,
//   AlertTriangle,
//   Clock,
//   Loader2,
//   Upload,
//   Download,
//   AlertCircle,
//   CheckCircle,
//   X,
//   Eye,
//   Quote,
//   BookOpen,
//   Copy,
//   ChevronDown,
//   Paperclip,
//   MessageSquare,
//   FileCheck,
//   Bot,
//   Check,
//   Circle,
//   CreditCard,
//   Square,
// } from 'lucide-react';

// const PROGRESS_STAGES = {
//   INIT: { range: [0, 15], label: 'Initialization' },
//   EXTRACT: { range: [15, 45], label: 'Text Extraction' },
//   CHUNK: { range: [45, 62], label: 'Chunking' },
//   EMBED: { range: [62, 78], label: 'Embeddings' },
//   STORE: { range: [78, 90], label: 'Database Storage' },
//   SUMMARY: { range: [90, 95], label: 'Summary Generation' },
//   FINAL: { range: [95, 100], label: 'Finalization' },
// };

// const STAGE_COLORS = {
//   INIT: 'from-blue-200 to-blue-400',
//   EXTRACT: 'from-blue-300 to-blue-500',
//   CHUNK: 'from-blue-400 to-blue-600',
//   EMBED: 'from-blue-500 to-blue-700',
//   STORE: 'from-blue-600 to-blue-800',
//   SUMMARY: 'from-blue-700 to-blue-900',
//   FINAL: 'from-blue-800 to-blue-950',
// };

// const getCurrentStage = (progress) => {
//   for (const [key, stage] of Object.entries(PROGRESS_STAGES)) {
//     if (progress >= stage.range[0] && progress < stage.range[1]) {
//       return key;
//     }
//   }
//   return 'FINAL';
// };

// const getStageColor = (progress) => {
//   const stageKey = getCurrentStage(progress);
//   return STAGE_COLORS[stageKey] || 'from-blue-500 to-blue-700';
// };

// const getStageStatus = (stageKey, progress) => {
//   const stage = PROGRESS_STAGES[stageKey];
//   if (progress >= stage.range[1]) return 'completed';
//   if (progress >= stage.range[0] && progress < stage.range[1]) return 'active';
//   return 'pending';
// };

// const RealTimeProgressPanel = ({ processingStatus }) => {
//   if (!processingStatus || !['processing', 'batch_processing', 'error'].includes(processingStatus.status)) return null;

//   const progress = processingStatus.processing_progress || 0;
//   const isError = processingStatus.status === 'error';
//   const isBatch = processingStatus.status === 'batch_processing';

//   const formatDate = (dateString) => {
//     try {
//       return new Date(dateString).toLocaleString();
//     } catch (e) {
//       return 'Invalid date';
//     }
//   };

//   const getSubProgress = () => {
//     if (processingStatus.embeddings_generated !== undefined && processingStatus.embeddings_total !== undefined) {
//       return `${processingStatus.embeddings_generated}/${processingStatus.embeddings_total} embeddings`;
//     }
//     if (processingStatus.chunks_saved !== undefined) {
//       return `${processingStatus.chunks_saved} chunks saved`;
//     }
//     if (processingStatus.estimated_pages !== undefined) {
//       return `Estimated ${processingStatus.estimated_pages} pages`;
//     }
//     return null;
//   };

//   const subProgress = getSubProgress();

//   return (
//     <div className="fixed top-4 left-1/2 z-50 transform -translate-x-1/2">
//       <div
//         className={`bg-white rounded-lg shadow-xl p-4 w-80 border-2 max-w-sm transition-all duration-300 ${
//           isError
//             ? 'border-red-200 animate-pulse'
//             : isBatch
//             ? 'border-yellow-200'
//             : 'border-blue-200'
//         }`}
//       >
//         <div className="flex justify-between items-center mb-3">
//           <h3 className="text-base font-semibold text-gray-900 flex items-center">
//             {isError ? (
//               <AlertTriangle className="h-4 w-4 text-red-500 mr-1.5 animate-pulse" />
//             ) : isBatch ? (
//               <FileText className="h-4 w-4 text-yellow-500 mr-1.5" />
//             ) : (
//               <Loader2 className="h-4 w-4 text-blue-500 mr-1.5 animate-spin" />
//             )}
//             {isError ? 'Processing Error' : isBatch ? 'Batch Processing' : 'Document Processing'}
//           </h3>
//         </div>
//         {isError ? (
//           <div className="text-center">
//             <AlertTriangle className="h-10 w-10 text-red-500 mx-auto mb-3 animate-pulse" />
//             <p className="text-red-700 text-xs mb-3 font-medium">
//               {processingStatus.job_error || 'An error occurred during processing'}
//             </p>
//             <p className="text-xs text-gray-500">Last updated: {formatDate(processingStatus.last_updated)}</p>
//           </div>
//         ) : (
//           <>
//             <div className="mb-3">
//               <div className="flex justify-between text-xs text-gray-600 mb-1.5">
//                 <span>Progress</span>
//                 <span className="font-semibold text-blue-600">{Math.round(progress)}%</span>
//               </div>
//               <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden relative">
//                 <div
//                   className={`h-2 rounded-full transition-all duration-1000 ease-out relative overflow-hidden bg-gradient-to-r ${getStageColor(
//                     progress
//                   )}`}
//                   style={{ width: `${progress}%` }}
//                 >
//                   <div className="absolute inset-0 bg-white/20 animate-shimmer"></div>
//                 </div>
//               </div>
//             </div>
//             <div className="mb-3">
//               <p className="text-xs text-gray-700 font-medium bg-blue-50 p-1.5 rounded text-blue-800 break-words">
//                 {processingStatus.current_operation || 'Processing document...'}
//               </p>
//               {subProgress && (
//                 <p className="text-xs text-gray-600 mt-1 bg-gray-50 p-1 rounded">{subProgress}</p>
//               )}
//             </div>
//             <div className="space-y-1.5 mb-3">
//               {Object.entries(PROGRESS_STAGES).map(([key, { label }]) => {
//                 const status = getStageStatus(key, progress);
//                 return (
//                   <div
//                     key={key}
//                     className={`flex items-center space-x-2 py-0.5 transition-all duration-300 ${
//                       status === 'completed'
//                         ? 'opacity-100'
//                         : status === 'active'
//                         ? 'opacity-100'
//                         : 'opacity-50'
//                     }`}
//                   >
//                     {status === 'completed' ? (
//                       <Check className="h-3 w-3 text-green-500 animate-pulse" />
//                     ) : status === 'active' ? (
//                       <Loader2 className="h-3 w-3 text-[#21C1B6] animate-spin" />
//                     ) : (
//                       <Circle className="h-3 w-3 text-gray-300" />
//                     )}
//                     <span
//                       className={`text-xs font-medium transition-colors ${
//                         status === 'completed'
//                           ? 'text-green-600'
//                           : status === 'active'
//                           ? 'text-[#21C1B6] font-semibold'
//                           : 'text-gray-400'
//                       }`}
//                     >
//                       {label}
//                     </span>
//                   </div>
//                 );
//               })}
//             </div>
//             {processingStatus.chunk_count > 0 && (
//               <p className="text-xs text-gray-600 mb-1.5 flex items-center">
//                 <FileText className="h-3 w-3 mr-1 text-gray-500" />
//                 {processingStatus.chunk_count} chunks created
//               </p>
//             )}
//             {processingStatus.chunking_method && (
//               <p className="text-xs text-gray-600 mb-1.5 flex items-center">
//                 <BookOpen className="h-3 w-3 mr-1 text-gray-500" />
//                 Method: {processingStatus.chunking_method}
//               </p>
//             )}
//             <p className="text-xs text-gray-400 flex items-center">
//               <Clock className="h-3 w-3 mr-1" />
//               Last updated: {formatDate(processingStatus.last_updated)}
//             </p>
//           </>
//         )}
//       </div>
//     </div>
//   );
// };

// const AnalysisPage = () => {
//   const location = useLocation();
//   const { fileId: paramFileId, sessionId: paramSessionId } = useParams();
//   const { setIsSidebarHidden, setIsSidebarCollapsed } = useSidebar();
//   const navigate = useNavigate();

//   // State Management
//   const [activeDropdown, setActiveDropdown] = useState('Custom Query');
//   const [isLoading, setIsLoading] = useState(false);
//   const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);
//   const [isUploading, setIsUploading] = useState(false);
//   const [error, setError] = useState(null);
//   const [success, setSuccess] = useState(null);
//   const [hasResponse, setHasResponse] = useState(false);
//   const [isSecretPromptSelected, setIsSecretPromptSelected] = useState(false);

//   // Document and Analysis Data
//   const [documentData, setDocumentData] = useState(null);
//   const [messages, setMessages] = useState([]);
//   const [fileId, setFileId] = useState(paramFileId || null);
//   const [sessionId, setSessionId] = useState(paramSessionId || null);
//   const [processingStatus, setProcessingStatus] = useState(null);
//   const [progressPercentage, setProgressPercentage] = useState(0);
//   const [currentResponse, setCurrentResponse] = useState('');
//   const [animatedResponseContent, setAnimatedResponseContent] = useState('');
//   const [isAnimatingResponse, setIsAnimatingResponse] = useState(false);
//   const [chatInput, setChatInput] = useState('');
//   const [showSplitView, setShowSplitView] = useState(false);
//   const [searchQuery, setSearchQuery] = useState('');
//   const [selectedMessageId, setSelectedMessageId] = useState(null);
//   const [displayLimit, setDisplayLimit] = useState(10);
//   const [showAllChats, setShowAllChats] = useState(false);
//   const [showDropdown, setShowDropdown] = useState(false);

//   // Secrets state
//   const [secrets, setSecrets] = useState([]);
//   const [isLoadingSecrets, setIsLoadingSecrets] = useState(false);
//   const [selectedSecretId, setSelectedSecretId] = useState(null);
//   const [selectedLlmName, setSelectedLlmName] = useState(null);

//   // Batch upload state
//   const [batchUploads, setBatchUploads] = useState([]);
//   const [uploadedDocuments, setUploadedDocuments] = useState([]);
//   const [overallUploadProgress, setOverallUploadProgress] = useState(0);
//   const [overallBatchProcessingProgress, setOverallBatchProcessingProgress] = useState(0);
//   const [activePollingFiles, setActivePollingFiles] = useState(new Set());
//   const [showInsufficientFundsAlert, setShowInsufficientFundsAlert] = useState(false);

//   // Refs
//   const fileInputRef = useRef(null);
//   const dropdownRef = useRef(null);
//   const responseRef = useRef(null);
//   const markdownOutputRef = useRef(null);
//   const pollingIntervalRef = useRef(null);
//   const animationFrameRef = useRef(null);
//   const uploadIntervalRef = useRef(null);
//   const batchPollingIntervalsRef = useRef({});
//   const simulatedProgressIntervalsRef = useRef({});

//   // API Configuration
//   const API_BASE_URL = 'http://localhost:5000';

//   const getAuthToken = () => {
//     const tokenKeys = [
//       'authToken',
//       'token',
//       'accessToken',
//       'jwt',
//       'bearerToken',
//       'auth_token',
//       'access_token',
//       'api_token',
//       'userToken',
//     ];
//     for (const key of tokenKeys) {
//       const token = localStorage.getItem(key);
//       if (token) return token;
//     }
//     return null;
//   };

//   const apiRequest = async (url, options = {}) => {
//     try {
//       const token = getAuthToken();
//       const defaultHeaders = { 'Content-Type': 'application/json' };
//       if (token) {
//         defaultHeaders['Authorization'] = `Bearer ${token}`;
//       }
//       const headers =
//         options.body instanceof FormData
//           ? token
//             ? { 'Authorization': `Bearer ${token}` }
//             : {}
//           : { ...defaultHeaders, ...options.headers };
//       const response = await fetch(`${API_BASE_URL}${url}`, { ...options, headers });

//       if (!response.ok) {
//         let errorData;
//         try {
//           errorData = await response.json();
//         } catch {
//           errorData = { error: `HTTP error! status: ${response.status}` };
//         }
//         switch (response.status) {
//           case 401:
//             throw new Error('Authentication required. Please log in again.');
//           case 403:
//             throw new Error(errorData.error || 'Access denied.');
//           case 404:
//             throw new Error('Resource not found.');
//           case 413:
//             throw new Error('File too large.');
//           case 415:
//             throw new Error('Unsupported file type.');
//           case 429:
//             throw new Error('Too many requests.');
//           default:
//             throw new Error(errorData.error || errorData.message || `Request failed with status ${response.status}`);
//         }
//       }
//       const contentType = response.headers.get('content-type');
//       if (contentType && contentType.includes('application/json')) {
//         return await response.json();
//       }
//       return response;
//     } catch (error) {
//       throw error;
//     }
//   };

//   // Fetch secrets
//   const fetchSecrets = async () => {
//     try {
//       setIsLoadingSecrets(true);
//       setError(null);
//       const token = getAuthToken();
//       const headers = { 'Content-Type': 'application/json' };
//       if (token) headers['Authorization'] = `Bearer ${token}`;
//       const response = await fetch(`${API_BASE_URL}/files/secrets?fetch=false`, {
//         method: 'GET',
//         headers,
//       });
//       if (!response.ok) {
//         throw new Error(`Failed to fetch secrets: ${response.status}`);
//       }
//       const secretsData = await response.json();
//       console.log('[fetchSecrets] Raw secrets data:', secretsData);
//       setSecrets(secretsData || []);
//       // Always start with "Custom Query" instead of auto-selecting first secret
//       setActiveDropdown('Custom Query');
//       setSelectedSecretId(null);
//       setSelectedLlmName(null);
//       setIsSecretPromptSelected(false);
//     } catch (error) {
//       console.error('Error fetching secrets:', error);
//       setError(`Failed to load analysis prompts: ${error.message}`);
//     } finally {
//       setIsLoadingSecrets(false);
//     }
//   };

//   // Enhanced getProcessingStatus function
//   const getProcessingStatus = async (file_id) => {
//     try {
//       const token = getAuthToken();
//       const headers = { 'Content-Type': 'application/json' };
//       if (token) headers['Authorization'] = `Bearer ${token}`;
//       const response = await fetch(`${API_BASE_URL}/files/status/${file_id}`, {
//         method: 'GET',
//         headers,
//       });
//       if (!response.ok) {
//         console.error(`[getProcessingStatus] Status check failed for ${file_id}: ${response.status}`);
//         return null;
//       }
//       const data = await response.json();
//       console.log(`[getProcessingStatus] File ${file_id} status:`, data.status, 'progress:', data.processing_progress, 'operation:', data.current_operation);
//       // Update processing status with all fields
//       if (file_id === fileId) {
//         const newProgress = data.processing_progress || 0;
//         const isCompleted = data.status === 'processed' || data.status === 'completed';
//         const isFailed = data.status === 'error' || data.status === 'failed';
       
//         // ✅ Prevent backwards progress - only update if increasing or final state
//         setProgressPercentage((currentProgress) => {
//           if (newProgress > currentProgress || isCompleted || isFailed || newProgress === 0) {
//             return newProgress;
//           }
//           console.log(`[getProcessingStatus] Skipping backwards progress for main file: ${newProgress}% <= ${currentProgress}%`);
//           return currentProgress; // Keep current progress if new is lower
//         });
       
//         setProcessingStatus(data);
//       }
//       // Update uploaded documents array with progress data
//       setUploadedDocuments((prev) =>
//         prev.map((doc) => {
//           if (doc.id === file_id) {
//             const currentProgress = doc.processingProgress || 0;
//             const newProgress = data.processing_progress || 0;
//             const isCompleted = data.status === 'processed' || data.status === 'completed';
//             const isFailed = data.status === 'error' || data.status === 'failed';
           
//             // ✅ Only update if: progress increased, status changed to completed/error, or it's a reset (0)
//             const shouldUpdate = newProgress > currentProgress || isCompleted || isFailed || newProgress === 0;
           
//             if (!shouldUpdate && data.status === doc.status) {
//               console.log(`[getProcessingStatus] Skipping backwards progress for ${file_id}: ${newProgress}% <= ${currentProgress}%`);
//               return doc; // Don't update if progress would go backwards
//             }
           
//             return {
//               ...doc,
//               status: data.status,
//               processingProgress: newProgress,
//               currentOperation: data.current_operation,
//               chunkCount: data.chunk_count,
//               lastUpdated: data.last_updated,
//               embeddingsGenerated: data.embeddings_generated,
//               embeddingsTotal: data.embeddings_total,
//               chunksSaved: data.chunks_saved,
//               estimatedPages: data.estimated_pages,
//               chunkingMethod: data.chunking_method,
//               jobError: data.job_error,
//             };
//           }
//           return doc;
//         })
//       );
//       // Update batch uploads with progress data
//       setBatchUploads((prev) =>
//         prev.map((upload) => {
//           if (upload.fileId === file_id) {
//             const currentProgress = upload.processingProgress || 0;
//             const newProgress = data.processing_progress || 0;
//             const isCompleted = data.status === 'processed' || data.status === 'completed';
//             const isFailed = data.status === 'error' || data.status === 'failed';
           
//             // ✅ Only update if: progress increased, status changed to completed/error, or it's a reset (0)
//             const shouldUpdate = newProgress > currentProgress || isCompleted || isFailed || newProgress === 0;
           
//             if (!shouldUpdate && data.status === upload.status) {
//               console.log(`[getProcessingStatus] Skipping backwards progress for ${file_id}: ${newProgress}% <= ${currentProgress}%`);
//               return upload; // Don't update if progress would go backwards
//             }
           
//             return {
//               ...upload,
//               status: data.status,
//               processingProgress: newProgress,
//               currentOperation: data.current_operation,
//               chunkCount: data.chunk_count,
//               lastUpdated: data.last_updated,
//               embeddingsGenerated: data.embeddings_generated,
//               embeddingsTotal: data.embeddings_total,
//               chunksSaved: data.chunks_saved,
//               estimatedPages: data.estimated_pages,
//               chunkingMethod: data.chunking_method,
//               jobError: data.job_error,
//             };
//           }
//           return upload;
//         })
//       );
//       // Handle completion or error - stop polling
//       if (data.status === 'processed') {
//         console.log(`[getProcessingStatus] File ${file_id} completed processing`);
//         if (batchPollingIntervalsRef.current[file_id]) {
//           clearInterval(batchPollingIntervalsRef.current[file_id]);
//           delete batchPollingIntervalsRef.current[file_id];
//           setActivePollingFiles((prev) => {
//             const newSet = new Set(prev);
//             newSet.delete(file_id);
//             return newSet;
//           });
//         }
//         if (file_id === fileId && pollingIntervalRef.current) {
//           clearInterval(pollingIntervalRef.current);
//           pollingIntervalRef.current = null;
//         }
//         setSuccess('Document processing completed!');
//       } else if (data.status === 'error') {
//         console.error(`[getProcessingStatus] File ${file_id} processing failed:`, data.job_error);
//         setError(data.job_error || `Document processing failed for ${data.filename}`);
//         if (batchPollingIntervalsRef.current[file_id]) {
//           clearInterval(batchPollingIntervalsRef.current[file_id]);
//           delete batchPollingIntervalsRef.current[file_id];
//           setActivePollingFiles((prev) => {
//             const newSet = new Set(prev);
//             newSet.delete(file_id);
//             return newSet;
//           });
//         }
//         if (file_id === fileId && pollingIntervalRef.current) {
//           clearInterval(pollingIntervalRef.current);
//           pollingIntervalRef.current = null;
//         }
//       }
//       return data;
//     } catch (error) {
//       console.error(`[getProcessingStatus] Error getting status for ${file_id}:`, error);
//       return null;
//     }
//   };

//   // Start polling for a single file (poll every 1s) - no timeout, continues until processed
//   const startProcessingStatusPolling = (file_id) => {
//     console.log(`[startProcessingStatusPolling] Starting 1s polling for file: ${file_id}`);
//     if (pollingIntervalRef.current && file_id === fileId) {
//       clearInterval(pollingIntervalRef.current);
//       pollingIntervalRef.current = null;
//     }
//     const pollInterval = 1000; // 1 second
//     const intervalId = setInterval(async () => {
//       const status = await getProcessingStatus(file_id);
//       if (status && (status.status === 'processed' || status.status === 'error')) {
//         clearInterval(intervalId);
//         if (file_id === fileId) {
//           pollingIntervalRef.current = null;
//         }
//       }
//       // Continue polling indefinitely until document is processed or errors naturally
//     }, pollInterval);
//     if (file_id === fileId) {
//       pollingIntervalRef.current = intervalId;
//     }
//   };

//   // Start batch polling (1s intervals) - no timeout, continues until processed
//   const startBatchProcessingPolling = (fileIds) => {
//     console.log(`[startBatchProcessingPolling] Starting 1s batch polling for ${fileIds.length} files`);
//     fileIds.forEach((file_id) => {
//       if (batchPollingIntervalsRef.current[file_id]) return;
//       setActivePollingFiles((prev) => new Set([...prev, file_id]));
//       const pollInterval = 1000;
//       const intervalId = setInterval(async () => {
//         const status = await getProcessingStatus(file_id);
//         if (status && (status.status === 'processed' || status.status === 'error')) {
//           clearInterval(intervalId);
//           delete batchPollingIntervalsRef.current[file_id];
//           setActivePollingFiles((prev) => {
//             const newSet = new Set(prev);
//             newSet.delete(file_id);
//             return newSet;
//           });
//         }
//         // Continue polling indefinitely until document is processed or errors naturally
//       }, pollInterval);
//       batchPollingIntervalsRef.current[file_id] = intervalId;
//     });
//   };

//   // Batch file upload (triggers polling on success)
//   const batchUploadDocuments = async (files, secretId = null, llmName = null) => {
//     const isProduction = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
//     const environment = isProduction ? 'PRODUCTION' : 'LOCALHOST';
   
//     console.log(`[batchUploadDocuments] 🚀 Starting batch upload for ${files.length} files`);
//     console.log(`[batchUploadDocuments] 🌍 Environment: ${environment}`);
//     console.log(`[batchUploadDocuments] 🔗 API Base URL: ${API_BASE_URL}`);
   
//     setIsUploading(true);
//     setError(null);
//     const LARGE_FILE_THRESHOLD = 32 * 1024 * 1024; // 32MB in bytes
   
//     const initialBatchUploads = files.map((file, index) => {
//       const isLarge = file.size > LARGE_FILE_THRESHOLD;
//       const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
//       console.log(`[batchUploadDocuments] 📄 File ${index + 1}: ${file.name} (${fileSizeMB}MB) - ${isLarge ? '🔴 LARGE (will use signed URL)' : '🟢 Small (regular upload)'}`);
//       return {
//         id: `${file.name}-${Date.now()}-${index}`,
//         file: file,
//         fileName: file.name,
//         fileSize: file.size,
//         progress: 0,
//         status: 'pending',
//         fileId: null,
//         error: null,
//         processingProgress: 0,
//         isLargeFile: isLarge,
//       };
//     });
//     setBatchUploads(initialBatchUploads);
//     setShowSplitView(true);
   
//     try {
//       const token = getAuthToken();
//       const headers = {};
//       if (token) headers['Authorization'] = `Bearer ${token}`;
     
//       // Separate large and small files
//       const largeFiles = files.filter(f => f.size > LARGE_FILE_THRESHOLD);
//       const smallFiles = files.filter(f => f.size <= LARGE_FILE_THRESHOLD);
//       const uploadedFileIds = [];
     
//       console.log(`[batchUploadDocuments] 📊 Summary: ${largeFiles.length} large file(s) (signed URL), ${smallFiles.length} small file(s) (regular upload)`);
     
//       // Upload large files individually using signed URLs
//       for (let i = 0; i < largeFiles.length; i++) {
//         const file = largeFiles[i];
//         const matchingUpload = initialBatchUploads.find(u => u.file === file);
//         const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
       
//         try {
//           console.log(`\n[📤 SIGNED URL UPLOAD] Starting upload for: ${file.name} (${fileSizeMB}MB)`);
//           console.log(`[📤 SIGNED URL UPLOAD] Environment: ${environment}`);
         
//           setBatchUploads((prev) =>
//             prev.map((upload) =>
//               upload.id === matchingUpload.id
//                 ? { ...upload, status: 'uploading', progress: 10 }
//                 : upload
//             )
//           );
         
//           // Step 1: Get signed URL
//           const generateUrlEndpoint = `${API_BASE_URL}/files/generate-upload-url`;
//           console.log(`[📤 SIGNED URL UPLOAD] Step 1/3: Requesting signed URL from: ${generateUrlEndpoint}`);
         
//           const urlResponse = await fetch(generateUrlEndpoint, {
//             method: 'POST',
//             headers: {
//               ...headers,
//               'Content-Type': 'application/json',
//             },
//             body: JSON.stringify({
//               filename: file.name,
//               mimetype: file.type,
//               size: file.size,
//             }),
//           });
         
//           if (!urlResponse.ok) {
//             const errorData = await urlResponse.json().catch(() => ({}));
//             const errorMessage = errorData.error || errorData.message || `Failed to get upload URL: ${urlResponse.statusText}`;
           
//             // Check for subscription-related errors
//             const isSubscriptionError = urlResponse.status === 500 ||
//               errorMessage.toLowerCase().includes('subscription') ||
//               errorMessage.toLowerCase().includes('insufficient') ||
//               errorMessage.toLowerCase().includes('no plan') ||
//               errorMessage.toLowerCase().includes('plan required');
           
//             const error = new Error(errorMessage);
//             if (isSubscriptionError) {
//               error.isSubscriptionError = true;
//             }
//             throw error;
//           }
         
//           const urlData = await urlResponse.json();
//           const { signedUrl, gcsPath, filename } = urlData;
         
//           console.log(`[📤 SIGNED URL UPLOAD] ✅ Signed URL received`);
//           console.log(`[📤 SIGNED URL UPLOAD] GCS Path: ${gcsPath}`);
//           console.log(`[📤 SIGNED URL UPLOAD] Signed URL (first 100 chars): ${signedUrl.substring(0, 100)}...`);
         
//           setBatchUploads((prev) =>
//             prev.map((upload) =>
//               upload.id === matchingUpload.id
//                 ? { ...upload, progress: 30 }
//                 : upload
//             )
//           );
         
//           // Step 2: Upload file directly to GCS with progress tracking
//           console.log(`[📤 SIGNED URL UPLOAD] Step 2/3: Uploading file directly to GCS (PUT request)`);
         
//           // Use XMLHttpRequest for progress tracking
//           await new Promise((resolve, reject) => {
//             const xhr = new XMLHttpRequest();
           
//             // Track upload progress
//             xhr.upload.addEventListener('progress', (e) => {
//               if (e.lengthComputable) {
//                 const percentComplete = Math.round((e.loaded / e.total) * 100);
//                 // Map to 30-70% range (since we're at step 2 of 3)
//                 const mappedProgress = 30 + Math.round((percentComplete / 100) * 40);
//                 setBatchUploads((prev) =>
//                   prev.map((upload) =>
//                     upload.id === matchingUpload.id
//                       ? { ...upload, progress: mappedProgress }
//                       : upload
//                   )
//                 );
//               }
//             });
           
//             xhr.addEventListener('load', () => {
//               if (xhr.status >= 200 && xhr.status < 300) {
//                 console.log(`[📤 SIGNED URL UPLOAD] ✅ File uploaded to GCS successfully`);
//                 setBatchUploads((prev) =>
//                   prev.map((upload) =>
//                     upload.id === matchingUpload.id
//                       ? { ...upload, progress: 70 }
//                       : upload
//                   )
//                 );
//                 resolve();
//               } else {
//                 reject(new Error(`Failed to upload file to GCS: ${xhr.statusText}`));
//               }
//             });
           
//             xhr.addEventListener('error', () => {
//               reject(new Error('Network error during upload'));
//             });
           
//             xhr.addEventListener('abort', () => {
//               reject(new Error('Upload aborted'));
//             });
           
//             xhr.open('PUT', signedUrl);
//             xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
//             xhr.send(file);
//           });
         
//           // Step 3: Complete upload
//           const completeEndpoint = `${API_BASE_URL}/files/complete-upload`;
//           console.log(`[📤 SIGNED URL UPLOAD] Step 3/3: Notifying backend to process file: ${completeEndpoint}`);
         
//           const completeResponse = await fetch(completeEndpoint, {
//             method: 'POST',
//             headers: {
//               ...headers,
//               'Content-Type': 'application/json',
//             },
//             body: JSON.stringify({
//               gcsPath,
//               filename,
//               mimetype: file.type,
//               size: file.size,
//               secret_id: secretId,
//             }),
//           });
         
//           if (!completeResponse.ok) {
//             const errorData = await completeResponse.json();
//             const errorMessage = errorData.error || errorData.message || `Failed to complete upload: ${completeResponse.statusText}`;
           
//             // Check for subscription-related errors
//             const isSubscriptionError = completeResponse.status === 500 ||
//               errorMessage.toLowerCase().includes('subscription') ||
//               errorMessage.toLowerCase().includes('insufficient') ||
//               errorMessage.toLowerCase().includes('no plan') ||
//               errorMessage.toLowerCase().includes('plan required');
           
//             const error = new Error(errorMessage);
//             if (isSubscriptionError) {
//               error.isSubscriptionError = true;
//             }
//             throw error;
//           }
         
//           const completeData = await completeResponse.json();
//           const fileId = completeData.file_id;
         
//           console.log(`[📤 SIGNED URL UPLOAD] ✅ Upload completed successfully! File ID: ${fileId}`);
//           console.log(`[📤 SIGNED URL UPLOAD] 🎉 File ${file.name} is now being processed`);
         
//           setBatchUploads((prev) =>
//             prev.map((upload) =>
//               upload.id === matchingUpload.id
//                 ? { ...upload, status: 'batch_processing', fileId, progress: 100, processingProgress: 0 }
//                 : upload
//             )
//           );
         
//           setUploadedDocuments((prev) => [
//             ...prev,
//             {
//               id: fileId,
//               fileName: filename || matchingUpload.fileName,
//               fileSize: matchingUpload.fileSize,
//               uploadedAt: new Date().toISOString(),
//               status: 'batch_processing',
//               processingProgress: 0,
//             },
//           ]);
         
//           uploadedFileIds.push(fileId);
         
//           // Set first file as the active document
//           if (i === 0 && largeFiles.length > 0) {
//             setFileId(fileId);
//             setDocumentData({
//               id: fileId,
//               title: matchingUpload.fileName,
//               originalName: matchingUpload.fileName,
//               size: matchingUpload.fileSize,
//               type: matchingUpload.file.type,
//               uploadedAt: new Date().toISOString(),
//               status: 'batch_processing',
//               processingProgress: 0,
//             });
//             startProcessingStatusPolling(fileId);
//           }
//         } catch (error) {
//           console.error(`[📤 SIGNED URL UPLOAD] ❌ Upload failed for ${matchingUpload.fileName}:`, error);
//           console.error(`[📤 SIGNED URL UPLOAD] Error details:`, error.message);
//           setBatchUploads((prev) =>
//             prev.map((upload) =>
//               upload.id === matchingUpload.id
//                 ? { ...upload, status: 'failed', error: error.message, progress: 0 }
//                 : upload
//             )
//           );
//         }
//       }
     
//       // Upload small files using batch upload endpoint
//       if (smallFiles.length > 0) {
//         console.log(`\n[📦 REGULAR UPLOAD] Starting batch upload for ${smallFiles.length} small file(s)`);
//         console.log(`[📦 REGULAR UPLOAD] Environment: ${environment}`);
//         console.log(`[📦 REGULAR UPLOAD] Endpoint: ${API_BASE_URL}/files/batch-upload`);
       
//         const formData = new FormData();
//         smallFiles.forEach((file) => {
//           formData.append('document', file);
//         });
//         if (secretId) {
//           formData.append('secret_id', secretId);
//           formData.append('trigger_initial_analysis_with_secret', 'true');
//         }
//         if (llmName) {
//           formData.append('llm_name', llmName);
//         }
       
//         setBatchUploads((prev) =>
//           prev.map((upload) => {
//             const isSmallFile = smallFiles.includes(upload.file);
//             return isSmallFile ? { ...upload, status: 'uploading', progress: 0 } : upload;
//           })
//         );
       
//         // Use XMLHttpRequest for progress tracking
//         const data = await new Promise((resolve, reject) => {
//           const xhr = new XMLHttpRequest();
         
//           // Track upload progress for all small files combined
//           xhr.upload.addEventListener('progress', (e) => {
//             if (e.lengthComputable) {
//               const percentComplete = Math.round((e.loaded / e.total) * 100);
//               // Update progress for all small files
//               setBatchUploads((prev) =>
//                 prev.map((upload) => {
//                   const isSmallFile = smallFiles.includes(upload.file);
//                   return isSmallFile
//                     ? { ...upload, progress: percentComplete }
//                     : upload;
//                 })
//               );
//             }
//           });
         
//           xhr.addEventListener('load', () => {
//             if (xhr.status >= 200 && xhr.status < 300) {
//               try {
//                 const responseData = JSON.parse(xhr.responseText);
//                 // Set all small files to 100% progress
//                 setBatchUploads((prev) =>
//                   prev.map((upload) => {
//                     const isSmallFile = smallFiles.includes(upload.file);
//                     return isSmallFile
//                       ? { ...upload, progress: 100 }
//                       : upload;
//                   })
//                 );
//                 resolve(responseData);
//               } catch (error) {
//                 reject(new Error('Failed to parse response'));
//               }
//             } else {
//               try {
//                 const errorData = JSON.parse(xhr.responseText);
//                 // Check for subscription-related errors
//                 const errorMessage = errorData.error || errorData.message || '';
//                 const isSubscriptionError = xhr.status === 500 ||
//                   errorMessage.toLowerCase().includes('subscription') ||
//                   errorMessage.toLowerCase().includes('insufficient') ||
//                   errorMessage.toLowerCase().includes('no plan') ||
//                   errorMessage.toLowerCase().includes('plan required');
               
//                 if (isSubscriptionError) {
//                   const error = new Error(errorMessage || 'Subscription required');
//                   error.isSubscriptionError = true;
//                   reject(error);
//                 } else {
//                   reject(new Error(errorMessage || `Upload failed with status ${xhr.status}`));
//                 }
//               } catch {
//                 // If status is 500, treat as potential subscription error
//                 if (xhr.status === 500) {
//                   const error = new Error('Subscription required to upload files');
//                   error.isSubscriptionError = true;
//                   reject(error);
//                 } else {
//                   reject(new Error(`Upload failed with status ${xhr.status}`));
//                 }
//               }
//             }
//           });
         
//           xhr.addEventListener('error', () => {
//             reject(new Error('Network error during upload'));
//           });
         
//           xhr.addEventListener('abort', () => {
//             reject(new Error('Upload aborted'));
//           });
         
//           xhr.open('POST', `${API_BASE_URL}/files/batch-upload`);
//           Object.keys(headers).forEach((key) => {
//             xhr.setRequestHeader(key, headers[key]);
//           });
//           xhr.send(formData);
//         });
//         console.log('[batchUploadDocuments] Batch upload response:', data);
       
//         if (data.uploaded_files && Array.isArray(data.uploaded_files)) {
//           data.uploaded_files.forEach((uploadedFile, index) => {
//             const matchingUpload = initialBatchUploads.find(u => smallFiles.includes(u.file) &&
//               initialBatchUploads.filter(up => smallFiles.includes(up.file)).indexOf(u) === index);
           
//             if (!matchingUpload) return;
           
//             if (uploadedFile.error) {
//               console.error(`[batchUploadDocuments] Upload failed for ${matchingUpload.fileName}:`, uploadedFile.error);
//               setBatchUploads((prev) =>
//                 prev.map((upload) =>
//                   upload.id === matchingUpload.id
//                     ? { ...upload, status: 'failed', error: uploadedFile.error, progress: 0 }
//                     : upload
//                 )
//               );
//             } else {
//               const fileId = uploadedFile.file_id;
//               console.log(`[batchUploadDocuments] Successfully uploaded ${matchingUpload.fileName} with ID: ${fileId}`);
//               setBatchUploads((prev) =>
//                 prev.map((upload) =>
//                   upload.id === matchingUpload.id
//                     ? { ...upload, status: 'batch_processing', fileId, progress: 100, processingProgress: 0 }
//                     : upload
//                 )
//               );
//               setUploadedDocuments((prev) => [
//                 ...prev,
//                 {
//                   id: fileId,
//                   fileName: uploadedFile.filename || matchingUpload.fileName,
//                   fileSize: matchingUpload.fileSize,
//                   uploadedAt: new Date().toISOString(),
//                   status: 'batch_processing',
//                   operationName: uploadedFile.operation_name,
//                   processingProgress: 0,
//                 },
//               ]);
//               uploadedFileIds.push(fileId);
             
//               // Set first file as the active document if no large file was set
//               if (uploadedFileIds.length === largeFiles.length + 1) {
//                 setFileId(fileId);
//                 setDocumentData({
//                   id: fileId,
//                   title: matchingUpload.fileName,
//                   originalName: matchingUpload.fileName,
//                   size: matchingUpload.fileSize,
//                   type: matchingUpload.file.type,
//                   uploadedAt: new Date().toISOString(),
//                   status: 'batch_processing',
//                   processingProgress: 0,
//                 });
//                 startProcessingStatusPolling(fileId);
//               }
//             }
//           });
//         }
//       }
     
//       // Start polling for all uploaded files
//       if (uploadedFileIds.length > 0) {
//         startBatchProcessingPolling(uploadedFileIds);
//       }
     
//       const successCount = uploadedFileIds.length;
//       const failCount = initialBatchUploads.length - successCount;
     
//       if (successCount > 0) {
//         setSuccess(`${successCount} document(s) uploaded successfully! Processing...`);
//       }
//       if (failCount > 0) {
//         setError(`${failCount} document(s) failed to upload.`);
//       }
//     } catch (error) {
//       console.error('[batchUploadDocuments] Batch upload error:', error);
     
//       // Check if this is a subscription error
//       if (error.isSubscriptionError) {
//         setShowInsufficientFundsAlert(true);
//         setBatchUploads((prev) =>
//           prev.map((upload) => ({ ...upload, status: 'failed', error: 'Subscription required' }))
//         );
//       } else {
//         setError(`Batch upload failed: ${error.message}`);
//         setBatchUploads((prev) =>
//           prev.map((upload) => ({ ...upload, status: 'failed', error: error.message }))
//         );
//       }
//     } finally {
//       setIsUploading(false);
//     }
//   };

//   const LARGE_RESPONSE_THRESHOLD = 5000;
//   const CHATGPT_BASE_DELAY = 2; // baseline ms between characters
//   const CHATGPT_SPACE_DELAY = 0;
//   const CHATGPT_PUNCTUATION_BONUS = 20;
//   const CHATGPT_NEWLINE_BONUS = 40;
//   const CHATGPT_RANDOM_VARIANCE = 0.015; // up to 1.5% variance per char for natural feel

//   const getChatGptDelay = (char) => {
//     if (char === ' ') return CHATGPT_SPACE_DELAY;
//     if (char === '\n') return CHATGPT_BASE_DELAY + CHATGPT_NEWLINE_BONUS;
//     if (/[.,;:!?]/.test(char)) return CHATGPT_BASE_DELAY + CHATGPT_PUNCTUATION_BONUS;
//     return CHATGPT_BASE_DELAY;
//   };

//   // Animation that reveals the response in a ChatGPT-like fashion
//   const animateResponse = (text = '') => {
//     console.log('[animateResponse] Starting ChatGPT-style animation. Length:', text.length);

//     if (animationFrameRef.current) {
//       cancelAnimationFrame(animationFrameRef.current);
//       animationFrameRef.current = null;
//     }

//     setAnimatedResponseContent('');
//     setIsAnimatingResponse(true);
//     setShowSplitView(true);
//     if (!text) {
//       setIsAnimatingResponse(false);
//       return;
//     }

//     let charIndex = 0;
//     let accumulatedContent = '';
//     let lastTimestamp = 0;

//     const step = (timestamp) => {
//       if (charIndex >= text.length) {
//         setIsAnimatingResponse(false);
//         animationFrameRef.current = null;
//         return;
//       }

//       const currentChar = text[charIndex];
//       const baseDelay = getChatGptDelay(currentChar);
//       const delay = baseDelay * (1 + Math.random() * CHATGPT_RANDOM_VARIANCE);

//       if (charIndex === 0 || timestamp - lastTimestamp >= delay) {
//         accumulatedContent += currentChar;
//         setAnimatedResponseContent(accumulatedContent);
//         charIndex += 1;
//         lastTimestamp = timestamp;

//         if (responseRef.current) {
//           responseRef.current.scrollTop = responseRef.current.scrollHeight;
//         }
//       }

//       animationFrameRef.current = requestAnimationFrame(step);
//     };

//     animationFrameRef.current = requestAnimationFrame(step);
//   };

//   // Show response immediately
//   const showResponseImmediately = (text = '') => {
//     console.log('[showResponseImmediately] Displaying text immediately. Length:', text.length);
//     if (animationFrameRef.current) {
//       cancelAnimationFrame(animationFrameRef.current);
//       animationFrameRef.current = null;
//     }
//     setAnimatedResponseContent(text);
//     setIsAnimatingResponse(false);
//     setShowSplitView(true);
//     requestAnimationFrame(() => {
//       if (responseRef.current) {
//         responseRef.current.scrollTop = responseRef.current.scrollHeight;
//       }
//     });
//   };

//   const stopResponseAnimation = () => {
//     if (!isAnimatingResponse) return;
//     const fullText = currentResponse || animatedResponseContent || '';
//     showResponseImmediately(fullText);
//   };

//   const baseSendDisabled =
//     isLoading ||
//     isGeneratingInsights ||
//     (!chatInput.trim() && !isSecretPromptSelected);

//   const sendButtonType = isAnimatingResponse ? 'button' : 'submit';
//   const isSendButtonDisabled = isAnimatingResponse ? false : baseSendDisabled;
//   const sendButtonTitle = isAnimatingResponse ? 'Stop rendering' : 'Send Message';

//   const handleSendButtonClick = (event) => {
//     if (isAnimatingResponse) {
//       event.preventDefault();
//       stopResponseAnimation();
//     }
//   };

//   const getSendButtonClassName = (size = 'default') => {
//     const paddingClass = size === 'small' ? 'p-1.5' : 'p-1.5 sm:p-2';
//     const colorClass = isAnimatingResponse
//       ? 'bg-gray-500 hover:bg-gray-600'
//       : 'bg-[#21C1B6] hover:bg-[#1AA49B] disabled:bg-gray-300';
//     return `${paddingClass} text-white rounded-lg transition-colors flex-shrink-0 disabled:cursor-not-allowed ${colorClass}`;
//   };

//   const renderSendButtonIcon = (size = 'default') => {
//     const baseClass = size === 'small' ? 'h-3 w-3' : 'h-4 w-4 sm:h-5 sm:w-5';
//     if (isAnimatingResponse) {
//       return <Square className={baseClass} />;
//     }
//     if (isLoading || isGeneratingInsights) {
//       return <Loader2 className={`${baseClass} animate-spin`} />;
//     }
//     return <Send className={baseClass} />;
//   };

//   // Chat with document
//   const chatWithDocument = async (file_id, question, currentSessionId, llm_name = null) => {
//     try {
//       setIsLoading(true);
//       setError(null);
//       console.log('[chatWithDocument] Sending custom query. LLM:', llm_name || 'default (backend)');
//       const body = {
//         file_id: file_id,
//         question: question.trim(),
//         used_secret_prompt: false,
//         prompt_label: null,
//         session_id: currentSessionId,
//       };
//       if (llm_name) {
//         body.llm_name = llm_name;
//       }
//       const data = await apiRequest('/files/chat', {
//         method: 'POST',
//         body: JSON.stringify(body),
//       });
//       const response = data.answer || data.response || 'No response received';
//       const newSessionId = data.session_id || currentSessionId;
//       if (data.history && Array.isArray(data.history)) {
//         setMessages(data.history);
//         const latestMessage = data.history[data.history.length - 1];
//         if (latestMessage) {
//           setSelectedMessageId(latestMessage.id);
//           setCurrentResponse(latestMessage.answer);
//           if (latestMessage.answer.length > LARGE_RESPONSE_THRESHOLD) {
//             showResponseImmediately(latestMessage.answer);
//           } else {
//             animateResponse(latestMessage.answer);
//           }
//         }
//       } else {
//         const newChat = {
//           id: Date.now(),
//           file_id: file_id,
//           session_id: newSessionId,
//           question: question.trim(),
//           answer: response,
//           display_text_left_panel: question.trim(),
//           timestamp: new Date().toISOString(),
//           used_chunk_ids: data.used_chunk_ids || [],
//           confidence: data.confidence || 0.8,
//           type: 'chat',
//           used_secret_prompt: false,
//         };
//         setMessages((prev) => [...prev, newChat]);
//         setSelectedMessageId(newChat.id);
//         setCurrentResponse(response);
//         if (response.length > LARGE_RESPONSE_THRESHOLD) {
//           showResponseImmediately(response);
//         } else {
//           animateResponse(response);
//         }
//       }
//       setSessionId(newSessionId);
//       setChatInput('');
//       setHasResponse(true);
//       setSuccess('Question answered!');
//       return data;
//     } catch (error) {
//       console.error('[chatWithDocument] Error:', error);
//       // Handle specific error cases
//       if (error.message && error.message.includes('No content found')) {
//         setError('Document is still processing. Please wait a few moments and try again.');
//         // Refresh the processing status to get latest state
//         if (file_id) {
//           const status = await getProcessingStatus(file_id);
//           if (status) {
//             setProcessingStatus(status);
//             setProgressPercentage(status.processing_progress || 0);
//             // If still processing, restart polling
//             if (status.status !== 'processed' && status.status !== 'error') {
//               startProcessingStatusPolling(file_id);
//             }
//           }
//         }
//       } else {
//         setError(`Chat failed: ${error.message}`);
//       }
//       throw error;
//     } finally {
//       setIsLoading(false);
//     }
//   };

//   const handleFileUpload = async (event) => {
//     const files = Array.from(event.target.files);
//     console.log('Files selected:', files.length);
//     if (files.length === 0) return;
//     const allowedTypes = [
//       'application/pdf',
//       'application/msword',
//       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
//       'text/plain',
//       'image/png',
//       'image/jpeg',
//       'image/tiff',
//     ];
//     const maxSize = 300 * 1024 * 1024;
//     const validFiles = files.filter((file) => {
//       if (!allowedTypes.includes(file.type)) {
//         setError(`File "${file.name}" has an unsupported type.`);
//         return false;
//       }
//       if (file.size > maxSize) {
//         setError(`File "${file.name}" is too large (max 300MB).`);
//         return false;
//       }
//       return true;
//     });
//     if (validFiles.length === 0) {
//       event.target.value = '';
//       return;
//     }
//     try {
//       await batchUploadDocuments(validFiles, selectedSecretId, selectedLlmName);
//     } catch (error) {
//       console.error('Upload error:', error);
//     }
//     event.target.value = '';
//   };

//   const handleDropdownSelect = (secretName, secretId, llmName) => {
//     console.log('[handleDropdownSelect] Selected:', secretName, secretId, 'LLM:', llmName);
//     setActiveDropdown(secretName);
//     setSelectedSecretId(secretId);
//     setSelectedLlmName(llmName);
//     setIsSecretPromptSelected(true);
//     setChatInput('');
//     setShowDropdown(false);
//   };

//   const handleChatInputChange = (e) => {
//     setChatInput(e.target.value);
//     // When user types in the input box, switch to custom query mode
//     if (e.target.value && isSecretPromptSelected) {
//       setIsSecretPromptSelected(false);
//       setActiveDropdown('Custom Query');
//       setSelectedSecretId(null);
//       setSelectedLlmName(null);
//     }
//     // If input is empty and no secret is selected, show Custom Query
//     if (!e.target.value && !isSecretPromptSelected) {
//       setActiveDropdown('Custom Query');
//     }
//   };

//   const handleSend = async (e) => {
//     e.preventDefault();

//     const hasFile = Boolean(fileId);
//     const currentStatus = processingStatus?.status;
//     const currentProgress = progressPercentage || 0;
//     const isActivelyProcessing =
//       currentStatus &&
//       (currentStatus === 'processing' ||
//         currentStatus === 'batch_processing' ||
//         currentStatus === 'queued' ||
//         currentStatus === 'pending');
//     const isProcessingComplete =
//       !currentStatus || currentStatus === 'processed' || currentProgress >= 100;

//     if (isSecretPromptSelected) {
//       if (!hasFile) {
//         setError('Please upload a document before running an analysis prompt.');
//         return;
//       }
//       if (currentStatus === 'error') {
//         setError('Document processing failed. Please upload a new document.');
//         return;
//       }
//       if (isActivelyProcessing && !isProcessingComplete) {
//         setError('Document is still being processed. Please wait until processing is complete.');
//         return;
//       }
//       if (!selectedSecretId) {
//         setError('Please select an analysis type.');
//         return;
//       }
//       const selectedSecret = secrets.find((s) => s.id === selectedSecretId);
//       const promptLabel = selectedSecret?.name || 'Secret Prompt';
//       try {
//         setIsGeneratingInsights(true);
//         setError(null);
//         console.log('[handleSend] Triggering secret analysis with:', {
//           secretId: selectedSecretId,
//           fileId,
//           additionalInput: chatInput.trim(),
//           promptLabel: promptLabel,
//           llmName: selectedLlmName,
//         });
//         const data = await apiRequest('/files/chat', {
//           method: 'POST',
//           body: JSON.stringify({
//             file_id: fileId,
//             secret_id: selectedSecretId,
//             used_secret_prompt: true,
//             prompt_label: promptLabel,
//             session_id: sessionId,
//             llm_name: selectedLlmName,
//             additional_input: chatInput.trim() || '',
//           }),
//         });
//         console.log('[handleSend] Received response:', data);
//         const response = data.answer || data.response || 'No response received';
//         const newSessionId = data.session_id || sessionId;
//         const newChat = {
//           id: Date.now(),
//           file_id: fileId,
//           session_id: newSessionId,
//           question: promptLabel,
//           answer: response,
//           display_text_left_panel: `Analysis: ${promptLabel}`,
//           timestamp: new Date().toISOString(),
//           used_chunk_ids: data.used_chunk_ids || [],
//           confidence: data.confidence || 0.8,
//           type: 'chat',
//           used_secret_prompt: true,
//           prompt_label: promptLabel,
//         };
//         setMessages((prev) => [...prev, newChat]);
//         setSelectedMessageId(newChat.id);
//         setCurrentResponse(response);
//         if (response.length > LARGE_RESPONSE_THRESHOLD) {
//           showResponseImmediately(response);
//         } else {
//           animateResponse(response);
//         }
//         setSessionId(newSessionId);
//         setChatInput('');
//         setHasResponse(true);
//         setSuccess('Analysis completed successfully!');
//         setIsSecretPromptSelected(false);
//         setActiveDropdown('Custom Query');
//       } catch (error) {
//         console.error('[handleSend] Analysis error:', error);
//         // Handle specific error cases
//         if (error.message && error.message.includes('No content found')) {
//           setError('Document is still processing. Please wait a few moments and try again.');
//           // Optionally refresh the processing status
//           if (fileId) {
//             const status = await getProcessingStatus(fileId);
//             if (status) {
//               setProcessingStatus(status);
//               setProgressPercentage(status.processing_progress || 0);
//             }
//           }
//         } else {
//           setError(`Analysis failed: ${error.message}`);
//         }
//       } finally {
//         setIsGeneratingInsights(false);
//       }
//     } else {
//       if (!chatInput.trim()) {
//         setError('Please enter a question.');
//         return;
//       }

//       if (hasFile) {
//         if (currentStatus === 'error') {
//           setError('Document processing failed. Please upload a new document.');
//           return;
//         }
//         if (isActivelyProcessing && !isProcessingComplete) {
//           setError('Document is still being processed. Please wait until processing is complete.');
//           return;
//         }
//       }

//       try {
//         console.log('[handleSend] Using custom query. LLM:', selectedLlmName || 'default (backend)');
//         await chatWithDocument(fileId || null, chatInput, sessionId, selectedLlmName);
//       } catch (error) {
//         console.error('[handleSend] Chat error:', error);
//       }
//     }
//   };

//   const handleMessageClick = async (message) => {
//     setSelectedMessageId(message.id);
//     setCurrentResponse(message.answer);
//     showResponseImmediately(message.answer);
   
//     // If message has a file_id, verify and update the document processing status
//     // Messages can only exist if document was processed, so set status to processed
//     if (message.file_id) {
//       // Check current status to ensure it's accurate
//       const currentFileId = fileId || message.file_id;
//       if (currentFileId) {
//         try {
//           const status = await getProcessingStatus(currentFileId);
//           if (status) {
//             // If we have messages, the document must be processed (messages can't exist without processed content)
//             // So ensure status reflects this
//             const finalStatus = status.status === 'processed' ? status : { ...status, status: 'processed', processing_progress: 100 };
//             setProcessingStatus(finalStatus);
//             setProgressPercentage(finalStatus.processing_progress || 100);
//           } else {
//             // If status check fails but we have messages, assume processed
//             setProcessingStatus({ status: 'processed', processing_progress: 100 });
//             setProgressPercentage(100);
//           }
//         } catch (error) {
//           console.error('[handleMessageClick] Error checking status:', error);
//           // If we have messages, document must be processed
//           setProcessingStatus({ status: 'processed', processing_progress: 100 });
//           setProgressPercentage(100);
//         }
//       }
//     }
//   };

//   const clearAllChatData = () => {
//     if (pollingIntervalRef.current) {
//       clearInterval(pollingIntervalRef.current);
//       pollingIntervalRef.current = null;
//     }
//     Object.keys(batchPollingIntervalsRef.current).forEach((fileId) => {
//       clearInterval(batchPollingIntervalsRef.current[fileId]);
//     });
//     batchPollingIntervalsRef.current = {};
//     setActivePollingFiles(new Set());
//     if (animationFrameRef.current) {
//       cancelAnimationFrame(animationFrameRef.current);
//       animationFrameRef.current = null;
//     }
//     if (uploadIntervalRef.current) {
//       clearInterval(uploadIntervalRef.current);
//       uploadIntervalRef.current = null;
//     }
//     setMessages([]);
//     setDocumentData(null);
//     setFileId(null);
//     setCurrentResponse('');
//     setHasResponse(false);
//     setChatInput('');
//     setProcessingStatus(null);
//     setProgressPercentage(0);
//     setError(null);
//     setAnimatedResponseContent('');
//     setIsAnimatingResponse(false);
//     setShowSplitView(false);
//     setBatchUploads([]);
//     setUploadedDocuments([]);
//     setIsSecretPromptSelected(false);
//     setSelectedMessageId(null);
//     setActiveDropdown('Custom Query');
//     const newSessionId = `session-${Date.now()}`;
//     setSessionId(newSessionId);
//     setSuccess('New chat session started!');
//   };

//   const startNewChat = () => {
//     clearAllChatData();
//   };

//   const formatFileSize = (bytes) => {
//     if (bytes === 0) return '0 Bytes';
//     const k = 1024;
//     const sizes = ['Bytes', 'KB', 'MB', 'GB'];
//     const i = Math.floor(Math.log(bytes) / Math.log(k));
//     return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
//   };

//   const formatDate = (dateString) => {
//     try {
//       return new Date(dateString).toLocaleString();
//     } catch (e) {
//       return 'Invalid date';
//     }
//   };

//   // Function to map backend status to user-friendly display text
//   const getStatusDisplayText = (status, progress = 0) => {
//     switch (status) {
//       case 'queued':
//         return 'Queued...';
//       case 'processing':
//         if (progress >= 100) return 'Done';
//         return progress < 50
//           ? `Processing... (${Math.round(progress)}%)`
//           : progress < 90
//           ? `Analyzing... (${Math.round(progress)}%)`
//           : `Finalizing... (${Math.round(progress)}%)`;
//       case 'batch_processing':
//         if (progress >= 100) return 'Done';
//         return progress < 30
//           ? `Batch Processing... (${Math.round(progress)}%)`
//           : progress < 70
//           ? `Processing Documents... (${Math.round(progress)}%)`
//           : progress < 95
//           ? `Analyzing Batch... (${Math.round(progress)}%)`
//           : `Completing... (${Math.round(progress)}%)`;
//       case 'processed':
//         return progress >= 100 ? 'Done' : 'Processing...';
//       case 'error':
//       case 'failed':
//         return 'Failed';
//       default:
//         return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
//     }
//   };

//   const handleCopyResponse = async () => {
//     try {
//       const textToCopy = animatedResponseContent || currentResponse;
//       if (textToCopy) {
//         const tempDiv = document.createElement('div');
//         tempDiv.innerHTML = textToCopy;
//         await navigator.clipboard.writeText(tempDiv.innerText);
//         setSuccess('AI response copied to clipboard!');
//       } else {
//         setError('No response to copy.');
//       }
//     } catch (err) {
//       console.error('Failed to copy AI response:', err);
//       setError('Failed to copy response.');
//     }
//   };

//   const highlightText = (text, query) => {
//     if (!query || !text) return text;
//     const parts = text.split(new RegExp(`(${query})`, 'gi'));
//     return parts.map((part, i) =>
//       part.toLowerCase() === query.toLowerCase() ? (
//         <span key={i} className="bg-yellow-200 font-semibold text-black">
//           {part}
//         </span>
//       ) : (
//         part
//       )
//     );
//   };

//   // Cleanup on unmount
//   useEffect(() => {
//     return () => {
//       if (pollingIntervalRef.current) {
//         clearInterval(pollingIntervalRef.current);
//       }
//       if (animationFrameRef.current) {
//         cancelAnimationFrame(animationFrameRef.current);
//       }
//       if (uploadIntervalRef.current) {
//         clearInterval(uploadIntervalRef.current);
//       }
//       Object.keys(batchPollingIntervalsRef.current).forEach((fileId) => {
//         clearInterval(batchPollingIntervalsRef.current[fileId]);
//       });
//     };
//   }, []);

//   // Close dropdown when clicking outside
//   useEffect(() => {
//     const handleClickOutside = (event) => {
//       if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
//         setShowDropdown(false);
//       }
//     };
//     document.addEventListener('mousedown', handleClickOutside);
//     return () => {
//       document.removeEventListener('mousedown', handleClickOutside);
//     };
//   }, []);

//   useEffect(() => {
//     fetchSecrets();
//   }, []);


//   // Ensure processing status is set to 'processed' if messages exist
//   // Messages can only exist if document was processed
//   useEffect(() => {
//     if (messages.length > 0 && fileId) {
//       const currentStatus = processingStatus?.status;
//       const currentProgress = progressPercentage || 0;
     
//       // If we have messages but status is not 'processed', update it
//       if (currentStatus !== 'processed' || currentProgress < 100) {
//         setProcessingStatus(prev => ({
//           ...prev,
//           status: 'processed',
//           processing_progress: 100
//         }));
//         setProgressPercentage(100);
//       }
//     }
//   }, [messages, fileId, processingStatus, progressPercentage]);

//   // Main loading effect
//   useEffect(() => {
//     const fetchChatHistory = async (currentFileId, currentSessionId, selectedChatId = null) => {
//       try {
//         console.log('[AnalysisPage] Fetching chat history for fileId:', currentFileId);
//         const response = await apiRequest(`/files/chat-history/${currentFileId}`, {
//           method: 'GET',
//         });
//         const sessions = response || [];
//         let allMessages = [];
//         sessions.forEach((session) => {
//           session.messages.forEach((message) => {
//             allMessages.push({
//               ...message,
//               session_id: session.session_id,
//               timestamp: message.created_at || message.timestamp,
//               display_text_left_panel:
//                 message.used_secret_prompt
//                   ? `Secret Prompt: ${message.prompt_label || 'Unnamed Secret Prompt'}`
//                   : message.question,
//             });
//           });
//         });
//         // ✅ FIXED: Filter messages by the selected session ID to show only messages from that session
//         if (currentSessionId) {
//           allMessages = allMessages.filter((msg) => msg.session_id === currentSessionId);
//         }
//         allMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
//         setMessages(allMessages);
//         if (allMessages.length > 0) {
//           // Check actual file status first
//           const fileStatus = await getProcessingStatus(currentFileId);
//           // If we have messages, the document must be processed (messages can't exist without processed content)
//           const actualStatus = 'processed'; // Always processed if messages exist
//           const actualProgress = 100; // Always 100% if messages exist
         
//           // Use the fetched status but ensure it's marked as processed
//           const finalStatus = fileStatus ? { ...fileStatus, status: 'processed', processing_progress: 100 } : { status: 'processed', processing_progress: 100 };
         
//           setDocumentData({
//             id: currentFileId,
//             title: `Document for Session ${currentSessionId}`,
//             originalName: `Document for Session ${currentSessionId}`,
//             size: 0,
//             type: 'unknown',
//             uploadedAt: new Date().toISOString(),
//             status: actualStatus,
//             processingProgress: actualProgress,
//           });
//           setFileId(currentFileId);
//           setSessionId(currentSessionId);
//           setProcessingStatus(finalStatus);
//           setProgressPercentage(actualProgress);
//           setHasResponse(true);
//           setShowSplitView(true);
//           const chatToDisplay = selectedChatId
//             ? allMessages.find((chat) => chat.id === selectedChatId)
//             : allMessages[allMessages.length - 1];
//           if (chatToDisplay) {
//             setCurrentResponse(chatToDisplay.answer);
//             showResponseImmediately(chatToDisplay.answer);
//             setSelectedMessageId(chatToDisplay.id);
//           }
//         }
//         setSuccess('Chat history loaded successfully!');
//       } catch (err) {
//         console.error('[AnalysisPage] Error in fetchChatHistory:', err);
//         setError(`Failed to load chat history: ${err.message}`);
//       }
//     };

//     // ✅ NEW: Fetch chat history by session ID only (for session-only routes)
//     const fetchChatHistoryBySessionId = async (currentSessionId, selectedChatId = null) => {
//       try {
//         console.log('[AnalysisPage] Fetching chat history for sessionId:', currentSessionId);
//         const response = await apiRequest(`/files/session/${currentSessionId}`, {
//           method: 'GET',
//         });
        
//         // Handle different response structures
//         let allMessages = [];
//         if (Array.isArray(response)) {
//           // If response is an array of messages
//           allMessages = response.map((message) => ({
//             ...message,
//             session_id: message.session_id || currentSessionId,
//             timestamp: message.created_at || message.timestamp,
//             display_text_left_panel:
//               message.used_secret_prompt
//                 ? `Secret Prompt: ${message.prompt_label || 'Unnamed Secret Prompt'}`
//                 : message.question,
//           }));
//         } else if (response.messages && Array.isArray(response.messages)) {
//           // If response has a messages array
//           allMessages = response.messages.map((message) => ({
//             ...message,
//             session_id: message.session_id || currentSessionId,
//             timestamp: message.created_at || message.timestamp,
//             display_text_left_panel:
//               message.used_secret_prompt
//                 ? `Secret Prompt: ${message.prompt_label || 'Unnamed Secret Prompt'}`
//                 : message.question,
//           }));
//         } else if (response.sessions && Array.isArray(response.sessions)) {
//           // If response has sessions array (similar to file-based history)
//           response.sessions.forEach((session) => {
//             if (session.messages && Array.isArray(session.messages)) {
//               session.messages.forEach((message) => {
//                 allMessages.push({
//                   ...message,
//                   session_id: session.session_id || currentSessionId,
//                   timestamp: message.created_at || message.timestamp,
//                   display_text_left_panel:
//                     message.used_secret_prompt
//                       ? `Secret Prompt: ${message.prompt_label || 'Unnamed Secret Prompt'}`
//                       : message.question,
//                 });
//               });
//             }
//           });
//         }
        
//         // Extract file_id from the first message if available
//         const extractedFileId = allMessages.length > 0 
//           ? (allMessages[0].file_id || response.file_id || null)
//           : null;
        
//         allMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
//         setMessages(allMessages);
        
//         if (allMessages.length > 0) {
//           // If we have a file_id, set it; otherwise leave it null
//           if (extractedFileId) {
//             setFileId(extractedFileId);
//             const fileStatus = await getProcessingStatus(extractedFileId);
//             const finalStatus = fileStatus ? { ...fileStatus, status: 'processed', processing_progress: 100 } : { status: 'processed', processing_progress: 100 };
//             setProcessingStatus(finalStatus);
//             setProgressPercentage(100);
            
//             setDocumentData({
//               id: extractedFileId,
//               title: `Document for Session ${currentSessionId}`,
//               originalName: `Document for Session ${currentSessionId}`,
//               size: 0,
//               type: 'unknown',
//               uploadedAt: new Date().toISOString(),
//               status: 'processed',
//               processingProgress: 100,
//             });
//           }
          
//           setSessionId(currentSessionId);
//           setHasResponse(true);
//           setShowSplitView(true);
//           const chatToDisplay = selectedChatId
//             ? allMessages.find((chat) => chat.id === selectedChatId)
//             : allMessages[allMessages.length - 1];
//           if (chatToDisplay) {
//             setCurrentResponse(chatToDisplay.answer || chatToDisplay.response || '');
//             showResponseImmediately(chatToDisplay.answer || chatToDisplay.response || '');
//             setSelectedMessageId(chatToDisplay.id);
//           }
//         }
//         setSuccess('Chat history loaded successfully!');
//       } catch (err) {
//         console.error('[AnalysisPage] Error in fetchChatHistoryBySessionId:', err);
//         setError(`Failed to load chat history: ${err.message}`);
//       }
//     };

//     // ✅ Clean up stale processing state on page refresh
//     try {
//       const savedProcessingStatus = localStorage.getItem('processingStatus');
//       if (savedProcessingStatus) {
//         const status = JSON.parse(savedProcessingStatus);
//         const processingStatuses = ['processing', 'batch_processing', 'batch_queued', 'queued', 'pending'];
//         if (processingStatuses.includes(status.status?.toLowerCase())) {
//           console.log('🧹 Clearing stale processing state from localStorage');
//           localStorage.removeItem('processingStatus');
//           localStorage.removeItem('progressPercentage');
//           localStorage.removeItem('isUploading');
//         }
//       }
//     } catch (err) {
//       console.error('Error cleaning up processing state:', err);
//     }

//     // Load from localStorage first
//     try {
//       const savedMessages = localStorage.getItem('messages');
//       if (savedMessages) {
//         const parsed = JSON.parse(savedMessages);
//         if (Array.isArray(parsed)) {
//           setMessages(parsed);
//         }
//       }
//       const savedSessionId = localStorage.getItem('sessionId');
//       if (savedSessionId) {
//         setSessionId(savedSessionId);
//       } else {
//         const newSessionId = `session-${Date.now()}`;
//         setSessionId(newSessionId);
//       }
//       const savedCurrentResponse = localStorage.getItem('currentResponse');
//       const savedAnimatedResponseContent = localStorage.getItem('animatedResponseContent');
//       if (savedCurrentResponse) {
//         setCurrentResponse(savedCurrentResponse);
//         if (savedAnimatedResponseContent) {
//           setAnimatedResponseContent(savedAnimatedResponseContent);
//           setShowSplitView(true);
//         } else {
//           setAnimatedResponseContent(savedCurrentResponse);
//         }
//         setIsAnimatingResponse(false);
//       }
//       const savedHasResponse = localStorage.getItem('hasResponse');
//       if (savedHasResponse) {
//         const parsedHasResponse = JSON.parse(savedHasResponse);
//         setHasResponse(parsedHasResponse);
//         if (parsedHasResponse) {
//           setShowSplitView(true);
//         }
//       }
//       const savedDocumentData = localStorage.getItem('documentData');
//       if (savedDocumentData) {
//         const parsed = JSON.parse(savedDocumentData);
//         setDocumentData(parsed);
//       }
//       const savedFileId = localStorage.getItem('fileId');
//       if (savedFileId) setFileId(savedFileId);
//       const savedProcessingStatus = localStorage.getItem('processingStatus');
//       if (savedProcessingStatus) {
//         const parsed = JSON.parse(savedProcessingStatus);
//         setProcessingStatus(parsed);
//         setProgressPercentage(parsed.processing_progress || 0);
//       }
//     } catch (error) {
//       console.error('[AnalysisPage] Error restoring from localStorage:', error);
//       if (!sessionId) {
//         const newSessionId = `session-${Date.now()}`;
//         setSessionId(newSessionId);
//       }
//     }

//     // Apply navigation overrides
//     if (location.state?.newChat) {
//       clearAllChatData();
//       window.history.replaceState({}, document.title);
//     } else if (paramFileId && paramSessionId) {
//       console.log('[AnalysisPage] Loading chat from URL params:', { paramFileId, paramSessionId });
//       setFileId(paramFileId);
//       setSessionId(paramSessionId);
//       // ✅ Set showSplitView immediately to prevent welcome screen flash
//       setShowSplitView(true);
//       setHasResponse(true);
//       // ✅ FIXED: Pass null for selectedChatId when loading from params (selects latest in session)
//       fetchChatHistory(paramFileId, paramSessionId, null);
//     } else if (paramSessionId && !paramFileId) {
//       // ✅ NEW: Handle session-only route (/analysis/session/:sessionId)
//       console.log('[AnalysisPage] Loading chat from session-only URL param:', { paramSessionId });
//       setSessionId(paramSessionId);
//       // ✅ Set showSplitView immediately to prevent welcome screen flash
//       setShowSplitView(true);
//       setHasResponse(true);
//       fetchChatHistoryBySessionId(paramSessionId, null);
//     } else if (location.state?.chat) {
//       const chatData = location.state.chat;
//       console.log('[AnalysisPage] Loading chat from location state:', chatData);
//       if (chatData.file_id && chatData.session_id) {
//         setFileId(chatData.file_id);
//         setSessionId(chatData.session_id);
//         // ✅ Set showSplitView immediately to prevent welcome screen flash
//         setShowSplitView(true);
//         setHasResponse(true);
//         // ✅ FIXED: Pass specific chat.id to select the exact message
//         fetchChatHistory(chatData.file_id, chatData.session_id, chatData.id);
//       } else if (chatData.session_id) {
//         // ✅ NEW: Handle case where only session_id is available
//         console.log('[AnalysisPage] Loading chat with session_id only:', chatData.session_id);
//         setSessionId(chatData.session_id);
//         // ✅ Set showSplitView immediately to prevent welcome screen flash
//         setShowSplitView(true);
//         setHasResponse(true);
//         // ✅ FIXED: Pass specific chat.id to select the exact message
//         fetchChatHistoryBySessionId(chatData.session_id, chatData.id);
//       } else {
//         setError('Unable to load chat: Missing required information (session_id or file_id)');
//       }
//       window.history.replaceState({}, document.title);
//     }
//   }, [location.state, paramFileId, paramSessionId]);

//   useEffect(() => {
//     if (showSplitView) {
//       setIsSidebarHidden(false);
//       setIsSidebarCollapsed(true);
//     } else if (hasResponse) {
//       setIsSidebarHidden(false);
//       setIsSidebarCollapsed(false);
//     } else {
//       setIsSidebarHidden(false);
//       setIsSidebarCollapsed(false);
//     }
//   }, [hasResponse, showSplitView, setIsSidebarHidden, setIsSidebarCollapsed]);

//   useEffect(() => {
//     if (success) {
//       const timer = setTimeout(() => setSuccess(null), 5000);
//       return () => clearTimeout(timer);
//     }
//   }, [success]);

//   // Simulate upload progress
//   useEffect(() => {
//     if (uploadIntervalRef.current) {
//       clearInterval(uploadIntervalRef.current);
//     }
//     const uploadingFiles = batchUploads.filter((upload) => upload.status === 'uploading');
//     if (uploadingFiles.length > 0) {
//       uploadIntervalRef.current = setInterval(() => {
//         setBatchUploads((prev) =>
//           prev.map((upload) => {
//             if (upload.status === 'uploading' && upload.progress < 100) {
//               const newProgress = Math.min(upload.progress + 2, 100);
//               return { ...upload, progress: newProgress };
//             }
//             return upload;
//           })
//         );
//       }, 200);
//     }
//     return () => {
//       if (uploadIntervalRef.current) {
//         clearInterval(uploadIntervalRef.current);
//         uploadIntervalRef.current = null;
//       }
//     };
//   }, [batchUploads.filter((u) => u.status === 'uploading').length]);

//   // Calculate overall upload progress
//   useEffect(() => {
//     if (batchUploads.length > 0) {
//       const uploadingFiles = batchUploads.filter((upload) => upload.status === 'uploading');
//       if (uploadingFiles.length > 0) {
//         const totalUploadProgress = uploadingFiles.reduce(
//           (sum, upload) => sum + (upload.progress || 0),
//           0
//         );
//         setOverallUploadProgress(totalUploadProgress / uploadingFiles.length);
//       } else {
//         setOverallUploadProgress(100);
//       }
//     } else {
//       setOverallUploadProgress(0);
//     }
//   }, [batchUploads]);

//   // Calculate overall batch processing progress with real-time updates
//   useEffect(() => {
//     if (batchUploads.length > 0) {
//       const processingFiles = batchUploads.filter(
//         (upload) => upload.status === 'processing' || upload.status === 'batch_processing'
//       );
//       if (processingFiles.length > 0) {
//         const totalProcessingProgress = processingFiles.reduce(
//           (sum, upload) => sum + (upload.processingProgress || 0),
//           0
//         );
//         const avgProgress = totalProcessingProgress / processingFiles.length;
//         setOverallBatchProcessingProgress(avgProgress);
//         console.log(
//           `[Overall Progress] ${processingFiles.length} files processing, avg: ${avgProgress.toFixed(1)}%`
//         );
//       } else {
//         const nonProcessedFiles = batchUploads.filter(
//           (upload) => upload.status !== 'processed' && upload.status !== 'failed'
//         );
//         if (nonProcessedFiles.length > 0) {
//           setOverallBatchProcessingProgress(0);
//         } else {
//           setOverallBatchProcessingProgress(100);
//         }
//       }
//     } else {
//       setOverallBatchProcessingProgress(0);
//     }
//   }, [batchUploads]);

//   // Derived state for main progress bar display with real-time updates
//   const currentProgressBarPercentage = useMemo(() => {
//     if (isUploading && overallUploadProgress < 100) {
//       return overallUploadProgress;
//     }
//     const hasProcessingFiles = batchUploads.some(
//       (upload) => upload.status === 'processing' || upload.status === 'batch_processing'
//     );
//     if (hasProcessingFiles) {
//       return overallBatchProcessingProgress;
//     }
//     if (documentData && (processingStatus?.status === 'processing' || processingStatus?.status === 'batch_processing')) {
//       return progressPercentage;
//     }
//     // Show 100% when processing is complete
//     if (documentData && processingStatus?.status === 'processed') {
//       return 100;
//     }
//     return 0;
//   }, [isUploading, overallUploadProgress, batchUploads, overallBatchProcessingProgress, documentData, processingStatus, progressPercentage]);

//   const currentProgressBarText = useMemo(() => {
//     if (isUploading && overallUploadProgress < 100) {
//       return `Uploading Documents... (${Math.round(overallUploadProgress)}%)`;
//     }
//     const processingCount = batchUploads.filter(
//       (upload) => upload.status === 'processing' || upload.status === 'batch_processing'
//     ).length;
//     if (processingCount > 0) {
//       return `Processing ${processingCount} document${
//         processingCount > 1 ? 's' : ''
//       }... (${Math.round(overallBatchProcessingProgress)}%)`;
//     }
//     if (documentData && (processingStatus?.status === 'processing' || processingStatus?.status === 'batch_processing')) {
//       return `${
//         processingStatus?.current_operation ||
//         (processingStatus?.status === 'batch_processing' ? 'Batch Processing...' : 'Processing document...')
//       } (${Math.round(progressPercentage)}%)`;
//     }
//     // Show "Done" only when progress is exactly 100% (after animation completes)
//     if (documentData && processingStatus?.status === 'processed' && progressPercentage >= 100) {
//       return 'Done';
//     }
//     return '';
//   }, [
//     isUploading,
//     overallUploadProgress,
//     batchUploads,
//     overallBatchProcessingProgress,
//     documentData,
//     processingStatus,
//     progressPercentage,
//   ]);

//   const showMainProgressBar = useMemo(() => {
//     return (
//       (isUploading && overallUploadProgress < 100) ||
//       batchUploads.some((upload) => upload.status === 'processing' || upload.status === 'batch_processing') ||
//       (documentData &&
//         (processingStatus?.status === 'processing' || processingStatus?.status === 'batch_processing')) ||
//       (documentData && processingStatus?.status === 'processed' && progressPercentage < 100)
//     );
//   }, [isUploading, overallUploadProgress, batchUploads, processingStatus, documentData, progressPercentage]);

//   useEffect(() => {
//     if (error) {
//       const timer = setTimeout(() => setError(null), 8000);
//       return () => clearTimeout(timer);
//     }
//   }, [error]);

//   // Enhanced Markdown Components
//   const markdownComponents = {
//     h1: ({ node, ...props }) => (
//       <h1
//         className="text-xl sm:text-2xl lg:text-3xl font-bold mb-4 sm:mb-6 mt-6 sm:mt-8 text-gray-900 border-b-2 border-gray-300 pb-2 sm:pb-3 analysis-page-ai-response break-words"
//         {...props}
//       />
//     ),
//     h2: ({ node, ...props }) => (
//       <h2 className="text-lg sm:text-xl lg:text-2xl font-bold mb-4 sm:mb-5 mt-5 sm:mt-7 text-gray-900 border-b border-gray-200 pb-2 analysis-page-ai-response break-words" {...props} />
//     ),
//     h3: ({ node, ...props }) => (
//       <h3 className="text-base sm:text-lg lg:text-xl font-semibold mb-3 sm:mb-4 mt-4 sm:mt-6 text-gray-800 analysis-page-ai-response break-words" {...props} />
//     ),
//     h4: ({ node, ...props }) => (
//       <h4 className="text-sm sm:text-base lg:text-lg font-semibold mb-2 sm:mb-3 mt-3 sm:mt-5 text-gray-800 analysis-page-ai-response break-words" {...props} />
//     ),
//     h5: ({ node, ...props }) => (
//       <h5 className="text-sm sm:text-base font-semibold mb-2 mt-3 sm:mt-4 text-gray-700 analysis-page-ai-response break-words" {...props} />
//     ),
//     h6: ({ node, ...props }) => (
//       <h6 className="text-xs sm:text-sm font-semibold mb-2 mt-2 sm:mt-3 text-gray-700 analysis-page-ai-response break-words" {...props} />
//     ),
//     p: ({ node, ...props }) => (
//       <p className="mb-3 sm:mb-4 leading-relaxed text-gray-800 text-sm sm:text-[15px] analysis-page-ai-response break-words" {...props} />
//     ),
//     strong: ({ node, ...props }) => <strong className="font-bold text-gray-900" {...props} />,
//     em: ({ node, ...props }) => <em className="italic text-gray-800" {...props} />,
//     ul: ({ node, ...props }) => <ul className="list-disc pl-6 mb-4 space-y-2 text-gray-800" {...props} />,
//     ol: ({ node, ...props }) => <ol className="list-decimal pl-6 mb-4 space-y-2 text-gray-800" {...props} />,
//     li: ({ node, ...props }) => <li className="leading-relaxed text-gray-800 analysis-page-ai-response" {...props} />,
//     a: ({ node, ...props }) => (
//       <a
//         className="text-[#21C1B6] hover:text-[#1AA49B] underline font-medium transition-colors"
//         target="_blank"
//         rel="noopener noreferrer"
//         {...props}
//       />
//     ),
//     blockquote: ({ node, ...props }) => (
//       <blockquote
//         className="border-l-4 border-[#21C1B6] pl-3 sm:pl-4 py-2 my-3 sm:my-4 bg-[#E0F7F6] text-gray-700 italic rounded-r analysis-page-ai-response text-sm sm:text-base break-words"
//         {...props}
//       />
//     ),
//     code: ({ node, inline, className, children, ...props }) => {
//       const match = /language-(\w+)/.exec(className || '');
//       const language = match ? match[1] : '';
//       if (inline) {
//         return (
//           <code
//             className="bg-gray-100 text-red-600 px-1 sm:px-1.5 py-0.5 rounded text-xs sm:text-sm font-mono border border-gray-200 break-all"
//             {...props}
//           >
//             {children}
//           </code>
//         );
//       }
//       return (
//         <div className="relative my-3 sm:my-4">
//           {language && (
//             <div className="bg-gray-800 text-gray-300 text-xs px-2 sm:px-3 py-1 rounded-t font-mono">
//               {language}
//             </div>
//           )}
//           <pre className={`bg-gray-900 text-gray-100 p-2 sm:p-4 ${language ? 'rounded-b' : 'rounded'} overflow-x-auto`}>
//             <code className="font-mono text-xs sm:text-sm" {...props}>
//               {children}
//             </code>
//           </pre>
//         </div>
//       );
//     },
//     pre: ({ node, ...props }) => (
//       <pre className="bg-gray-900 text-gray-100 p-2 sm:p-4 rounded my-3 sm:my-4 overflow-x-auto text-xs sm:text-sm" {...props} />
//     ),
//     table: ({ node, ...props }) => (
//       <div className="my-4 sm:my-6 rounded-lg border border-gray-300 block max-w-full">
//         <table className="border-collapse text-xs sm:text-sm w-full" {...props} />
//       </div>
//     ),
//     thead: ({ node, ...props }) => <thead className="bg-gray-100" {...props} />,
//     th: ({ node, ...props }) => (
//       <th
//         className="px-2 sm:px-3 py-2 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b border-r border-gray-300 whitespace-normal last:border-r-0 break-words"
//         {...props}
//       />
//     ),
//     tbody: ({ node, ...props }) => <tbody className="bg-white divide-y divide-gray-200" {...props} />,
//     tr: ({ node, ...props }) => <tr className="hover:bg-gray-50 transition-colors" {...props} />,
//     td: ({ node, ...props }) => (
//       <td className="px-2 sm:px-3 py-2 text-xs sm:text-sm text-gray-800 border-b border-r border-gray-200 align-top last:border-r-0 break-words" {...props} />
//     ),
//     hr: ({ node, ...props }) => <hr className="my-6 border-t-2 border-gray-300" {...props} />,
//     img: ({ node, ...props }) => <img className="max-w-full h-auto rounded-lg shadow-md my-4" alt="" {...props} />,
//   };

//   // Function to get proper placeholder text based on current state
//   const getInputPlaceholder = () => {
//     if (isSecretPromptSelected) {
//       return `Analysis : ${activeDropdown}...`;
//     }
//     if (!fileId) {
//       return 'Upload a document to get started';
//     }
//     // Check if document is still processing
//     // Only show processing message if actively processing (has status, not processed, and progress < 100)
//     if (processingStatus?.status && processingStatus.status !== 'processed' && progressPercentage < 100) {
//       return `${processingStatus.current_operation || 'Processing document...'} (${Math.round(progressPercentage)}%)`;
//     }
//     return showSplitView ? 'Ask a question...' : 'Message Legal Assistant...';
//   };

//   return (
//     <div className="flex flex-col lg:flex-row h-[90vh] bg-white overflow-hidden">
//       {/* Real-time Progress Panel */}
//       {/* <RealTimeProgressPanel processingStatus={processingStatus} /> */}
//       {/* Error Messages */}
//       {error && (
//         <div className="fixed top-4 left-1/2 -translate-x-1/2 sm:left-auto sm:right-4 sm:translate-x-0 z-50 max-w-[90vw] sm:max-w-sm">
//           <div className="bg-red-50 border border-red-200 text-red-700 px-3 sm:px-4 py-2 sm:py-3 rounded-lg shadow-lg flex items-start space-x-2">
//             <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
//             <div className="flex-1">
//               <p className="text-sm">{error}</p>
//             </div>
//             <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
//               <X className="h-4 w-4" />
//             </button>
//           </div>
//         </div>
//       )}
//       {/* Success Messages */}
//       {success && (
//         <div className="fixed top-4 left-1/2 -translate-x-1/2 sm:left-auto sm:right-4 sm:translate-x-0 z-50 max-w-[90vw] sm:max-w-sm">
//           <div className="bg-green-50 border border-green-200 text-green-700 px-3 sm:px-4 py-2 sm:py-3 rounded-lg shadow-lg flex items-center space-x-2">
//             <CheckCircle className="h-5 w-5 flex-shrink-0" />
//             <span className="text-sm">{success}</span>
//             <button onClick={() => setSuccess(null)} className="ml-auto text-green-500 hover:text-green-700">
//               <X className="h-4 w-4" />
//             </button>
//           </div>
//         </div>
//       )}
//       {/* Insufficient Funds Alert */}
//       {showInsufficientFundsAlert && (
//         <div className="fixed top-4 right-4 z-50 max-w-md">
//           <div className="bg-red-50 border-2 border-red-300 rounded-lg shadow-2xl p-4 animate-fadeIn">
//             <div className="flex items-start space-x-3">
//               <div className="flex-shrink-0">
//                 <AlertCircle className="w-6 h-6 text-red-600" />
//               </div>
//               <div className="flex-1 min-w-0">
//                 <h4 className="text-lg font-bold text-gray-900 mb-1">Insufficient Funds</h4>
//                 <p className="text-sm text-gray-700 mb-3">
//                   You don't have enough credits to upload documents. Please upgrade your subscription plan to continue.
//                 </p>
//                 <div className="flex items-center space-x-2">
//                   <button
//                     onClick={() => {
//                       setShowInsufficientFundsAlert(false);
//                       navigate('/subscription-plans');
//                     }}
//                     className="flex items-center justify-center px-4 py-2 bg-[#21C1B6] text-white rounded-lg hover:bg-[#1AA89E] transition-all duration-200 font-semibold text-sm shadow-md hover:shadow-lg"
//                   >
//                     <CreditCard className="w-4 h-4 mr-1.5" />
//                     Upgrade Now
//                   </button>
//                   <button
//                     onClick={() => setShowInsufficientFundsAlert(false)}
//                     className="px-3 py-2 text-gray-600 hover:text-gray-900 transition-colors text-sm font-medium"
//                   >
//                     Close
//                   </button>
//                 </div>
//               </div>
//               <button
//                 onClick={() => setShowInsufficientFundsAlert(false)}
//                 className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
//               >
//                 <X className="h-4 w-4" />
//               </button>
//             </div>
//           </div>
//         </div>
//       )}
//       {/* Conditional Rendering */}
//       {!showSplitView ? (
//         // Single Page View with bottom panel
//         <div className="flex flex-col h-full w-full">
//           {/* Top Content Area */}
//           <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8 overflow-y-auto">
//             <div className="text-center max-w-2xl mb-8 sm:mb-12">
//               <h3 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-3 sm:mb-4 text-gray-900">Welcome to Smart Legal Insights</h3>
//               <p className="text-gray-600 text-base sm:text-lg lg:text-xl leading-relaxed">
//                 Upload a legal document or ask a question to begin your AI-powered analysis.
//               </p>
//             </div>
//             <div className="w-full max-w-4xl">
//             {showMainProgressBar && (
//               <div className="mt-3 text-center">
//                 <div className="inline-flex items-center px-3 py-1.5 bg-[#E0F7F6] text-[#21C1B6] rounded-full text-sm">
//                   <Loader2 className="h-4 w-4 animate-spin mr-2" />
//                   {currentProgressBarText}
//                 </div>
//                 <div className="w-full bg-gray-200 rounded-full h-2 mt-2 relative overflow-hidden">
//                   <div
//                     className={`h-2 rounded-full transition-all duration-300 relative overflow-hidden bg-gradient-to-r ${getStageColor(
//                       currentProgressBarPercentage
//                     )}`}
//                     style={{ width: `${currentProgressBarPercentage}%` }}
//                   >
//                     <div className="absolute inset-0 bg-white/20 animate-shimmer"></div>
//                   </div>
//                 </div>
//               </div>
//             )}
//             {documentData && !hasResponse && (
//               <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
//                 <div className="flex items-center space-x-3">
//                   <FileCheck className="h-5 w-5 text-green-600" />
//                   <div className="flex-1 min-w-0">
//                     <p className="text-sm font-medium text-gray-900 truncate">{documentData.originalName}</p>
//                     <p className="text-xs text-gray-500">
//                       {formatFileSize(documentData.size)} • {formatDate(documentData.uploadedAt)}
//                     </p>
//                   </div>
//                   {processingStatus && (
//                     <div
//                       className={`px-2 py-1 rounded-full text-xs font-medium ${
//                         processingStatus.status === 'processed'
//                           ? 'bg-green-100 text-green-800'
//                           : processingStatus.status === 'processing' || processingStatus.status === 'batch_processing'
//                           ? 'bg-[#E0F7F6] text-[#21C1B6]'
//                           : 'bg-red-100 text-red-800'
//                       }`}
//                     >
//                       {getStatusDisplayText(processingStatus.status, progressPercentage)}
//                     </div>
//                   )}
//                 </div>
//               </div>
//             )}
//             <form onSubmit={handleSend} className="mx-auto mt-4">
//               <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3 bg-gray-50 rounded-xl px-3 sm:px-5 py-4 sm:py-6 focus-within:border-[#21C1B6] focus-within:bg-white focus-within:shadow-sm analysis-input-container">
//                 <button
//                   type="button"
//                   onClick={() => fileInputRef.current?.click()}
//                   disabled={isUploading}
//                   className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
//                   title="Upload Document"
//                 >
//                   {isUploading ? <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin" /> : <Paperclip className="h-4 w-4 sm:h-5 sm:w-5" />}
//                 </button>
//                 <input
//                   ref={fileInputRef}
//                   type="file"
//                   className="hidden"
//                   accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.tiff"
//                   onChange={handleFileUpload}
//                   disabled={isUploading}
//                   multiple
//                 />
//                 <div className="relative flex-shrink-0" ref={dropdownRef}>
//                   <button
//                     type="button"
//                     onClick={() => setShowDropdown(!showDropdown)}
//                     disabled={isLoading || isGeneratingInsights || isLoadingSecrets}
//                     className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
//                   >
//                     <BookOpen className="h-3 w-3 sm:h-4 sm:w-4" />
//                     <span className="hidden sm:inline">{isLoadingSecrets ? 'Loading...' : activeDropdown}</span>
//                     <span className="inline sm:hidden">{isLoadingSecrets ? '...' : 'Prompts'}</span>
//                     <ChevronDown className="h-3 w-3 sm:h-4 sm:w-4" />
//                   </button>
//                   {showDropdown && !isLoadingSecrets && (
//                     <div className="absolute bottom-full left-0 mb-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto">
//                       {secrets.length > 0 ? (
//                         secrets.map((secret) => (
//                           <button
//                             key={secret.id}
//                             type="button"
//                             onClick={() => handleDropdownSelect(secret.name, secret.id, secret.llm_name)}
//                             className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg"
//                           >
//                             {secret.name}
//                           </button>
//                         ))
//                       ) : (
//                         <div className="px-4 py-2.5 text-sm text-gray-500">No analysis prompts available</div>
//                       )}
//                     </div>
//                   )}
//                 </div>
//                 <input
//                   type="text"
//                   value={chatInput}
//                   onChange={handleChatInputChange}
//                   placeholder={getInputPlaceholder()}
//                   className="flex-1 bg-transparent border-none outline-none text-gray-900 placeholder-gray-500 text-sm sm:text-[15px] font-medium py-2 min-w-0 w-full sm:w-auto analysis-page-user-input"
//                   disabled={isLoading || isGeneratingInsights}
//                 />
//                 <button
//                   type={sendButtonType}
//                   disabled={isSendButtonDisabled}
//                   onClick={handleSendButtonClick}
//                   className={getSendButtonClassName()}
//                   title={sendButtonTitle}
//                 >
//                   {renderSendButtonIcon()}
//                 </button>
//               </div>
//               {isSecretPromptSelected && (
//                 <div className="mt-3 p-2 bg-[#E0F7F6] border border-[#21C1B6] rounded-lg">
//                   <div className="flex items-center space-x-2 text-sm text-[#21C1B6]">
//                     <Bot className="h-4 w-4" />
//                     <span>
//                       Using analysis prompt: <strong>{activeDropdown}</strong>
//                     </span>
//                     <button
//                       type="button"
//                       onClick={() => {
//                         setIsSecretPromptSelected(false);
//                         setActiveDropdown('Custom Query');
//                         setSelectedSecretId(null);
//                       }}
//                       className="ml-auto text-[#21C1B6] hover:text-[#1AA49B]"
//                     >
//                       <X className="h-4 w-4" />
//                     </button>
//                   </div>
//                 </div>
//               )}
//             </form>
//           </div>
//           </div>
         
//           {/* Bottom Static Questions Panel */}
//           {messages.length > 0 && (
//             <div className="border-t border-gray-200 bg-white flex-shrink-0" style={{ height: '30vh', minHeight: '250px' }}>
//               <div className="h-full flex flex-col">
//                 <div className="p-2 sm:p-3 border-b border-gray-200 flex-shrink-0">
//                   <div className="flex items-center justify-between">
//                     <h2 className="text-sm sm:text-base font-semibold text-gray-900 flex items-center">
//                       <MessageSquare className="h-4 w-4 mr-2" />
//                       Recent Questions
//                     </h2>
//                     <span className="text-xs text-gray-500">{messages.length} question{messages.length !== 1 ? 's' : ''}</span>
//                   </div>
//                 </div>
               
//                 <div className="flex-1 overflow-y-auto px-2 sm:px-3 py-2 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-gray-100 [&::-webkit-scrollbar-thumb]:bg-gray-300">
//                   <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
//                     {messages.slice(0, 9).map((msg, i) => (
//                       <div
//                         key={msg.id || i}
//                         onClick={() => {
//                           handleMessageClick(msg);
//                           setShowSplitView(true);
//                         }}
//                         className="p-2 sm:p-3 rounded-lg border border-gray-200 bg-gray-50 hover:bg-[#E0F7F6] hover:border-[#21C1B6] cursor-pointer transition-all duration-200 hover:shadow-md"
//                       >
//                         <p className="text-xs sm:text-sm font-medium text-gray-900 line-clamp-2 mb-1">
//                           {msg.display_text_left_panel || msg.question}
//                         </p>
//                         <div className="flex items-center justify-between text-xs text-gray-500">
//                           <span className="truncate">{formatDate(msg.timestamp || msg.created_at)}</span>
//                           <ChevronRight className="h-3 w-3 flex-shrink-0 ml-1" />
//                         </div>
//                       </div>
//                     ))}
//                   </div>
                 
//                   {messages.length > 9 && (
//                     <div className="mt-2 text-center">
//                       <button
//                         onClick={() => setShowSplitView(true)}
//                         className="text-xs text-[#21C1B6] hover:text-[#1AA49B] font-medium"
//                       >
//                         View all {messages.length} questions →
//                       </button>
//                     </div>
//                   )}
//                 </div>
//               </div>
//             </div>
//           )}
//         </div>
//       ) : (
//         // Split View
//         <>
//           {/* Left Panel */}
//           <div className="w-full lg:w-2/5 border-r-0 lg:border-r border-b lg:border-b-0 border-gray-200 flex flex-col bg-white h-1/3 lg:h-full">
//             <div className="p-2 sm:p-3 border-b border-black border-opacity-20">
//               <div className="flex items-center justify-between mb-2 sm:mb-3">
//                 <h2 className="text-sm sm:text-base font-semibold text-gray-900">Questions</h2>
//                 <button
//                   onClick={startNewChat}
//                   className="px-3 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
//                 >
//                   New Chat
//                 </button>
//               </div>
//               <div className="relative mb-3">
//                 <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
//                 <input
//                   type="text"
//                   placeholder="Search questions..."
//                   value={searchQuery}
//                   onChange={(e) => setSearchQuery(e.target.value)}
//                   className="w-full pl-8 pr-3 py-1.5 bg-gray-100 rounded-lg text-xs text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent"
//                 />
//               </div>
//             </div>
//             <DocumentList
//               uploadedDocuments={uploadedDocuments}
//               fileId={fileId}
//               setFileId={setFileId}
//               setDocumentData={setDocumentData}
//               setProcessingStatus={setProcessingStatus}
//               setProgressPercentage={setProgressPercentage}
//               startProcessingStatusPolling={startProcessingStatusPolling}
//               formatFileSize={formatFileSize}
//               getStatusDisplayText={getStatusDisplayText}
//               getStageColor={getStageColor}
//             />
//             <MessagesList
//               messages={messages}
//               selectedMessageId={selectedMessageId}
//               handleMessageClick={handleMessageClick}
//               displayLimit={displayLimit}
//               showAllChats={showAllChats}
//               setShowAllChats={setShowAllChats}
//               isLoading={isLoading}
//               highlightText={highlightText}
//               formatDate={formatDate}
//               searchQuery={searchQuery}
//             />
//             <div className="border-t border-gray-200 p-3 bg-white flex-shrink-0">
//               {documentData && (
//                 <div className="mb-2 p-1.5 bg-gray-50 rounded-lg border border-gray-200">
//                   <div className="flex items-center space-x-1.5">
//                     <FileCheck className="h-3 w-3 text-green-600" />
//                     <div className="flex-1 min-w-0">
//                       <p className="text-xs font-medium text-gray-900 truncate">{documentData.originalName}</p>
//                       <p className="text-xs text-gray-500">{formatFileSize(documentData.size)}</p>
//                     </div>
//                     {processingStatus && (
//                       <div
//                         className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${
//                           processingStatus.status === 'processed' && progressPercentage >= 100
//                             ? 'bg-green-100 text-green-800'
//                             : processingStatus.status === 'processing' || processingStatus.status === 'batch_processing'
//                             ? 'bg-[#E0F7F6] text-[#21C1B6]'
//                             : 'bg-red-100 text-red-800'
//                         }`}
//                       >
//                         {getStatusDisplayText(processingStatus.status, progressPercentage)}
//                       </div>
//                     )}
//                   </div>
//                 </div>
//               )}
//               <form onSubmit={handleSend}>
//                 <div className="flex items-center space-x-1.5 bg-gray-50 rounded-xl px-2.5 py-2 focus-within:border-[#21C1B6] focus-within:bg-white focus-within:shadow-sm analysis-input-container">
//                   <button
//                     type="button"
//                     onClick={() => fileInputRef.current?.click()}
//                     disabled={isUploading}
//                     className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
//                     title="Upload Document"
//                   >
//                     {isUploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
//                   </button>
//                   <input
//                     ref={fileInputRef}
//                     type="file"
//                     className="hidden"
//                     accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.tiff"
//                     onChange={handleFileUpload}
//                     disabled={isUploading}
//                     multiple
//                   />
//                   <div className="relative flex-shrink-0" ref={dropdownRef}>
//                     <button
//                       type="button"
//                       onClick={() => setShowDropdown(!showDropdown)}
//                       disabled={isLoading || isGeneratingInsights || isLoadingSecrets}
//                       className="flex items-center space-x-1 px-2 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
//                     >
//                       <BookOpen className="h-3 w-3" />
//                       <span>{isLoadingSecrets ? 'Loading...' : activeDropdown}</span>
//                       <ChevronDown className="h-3 w-3" />
//                     </button>
//                     {showDropdown && !isLoadingSecrets && (
//                       <div className="absolute bottom-full left-0 mb-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto">
//                         {secrets.length > 0 ? (
//                           secrets.map((secret) => (
//                             <button
//                               key={secret.id}
//                               type="button"
//                               onClick={() => handleDropdownSelect(secret.name, secret.id, secret.llm_name)}
//                               className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg"
//                             >
//                               {secret.name}
//                             </button>
//                           ))
//                         ) : (
//                           <div className="px-4 py-2.5 text-sm text-gray-500">No analysis prompts available</div>
//                         )}
//                       </div>
//                     )}
//                   </div>
//                 <input
//                   type="text"
//                   value={chatInput}
//                   onChange={handleChatInputChange}
//                   placeholder={getInputPlaceholder()}
//                   className="flex-1 bg-transparent border-none outline-none text-gray-900 placeholder-gray-500 text-xs font-medium py-1 min-w-0 analysis-page-user-input"
//                   disabled={isLoading || isGeneratingInsights}
//                 />
//                   <button
//                     type={sendButtonType}
//                     disabled={isSendButtonDisabled}
//                     onClick={handleSendButtonClick}
//                     className={getSendButtonClassName('small')}
//                     title={sendButtonTitle}
//                   >
//                     {renderSendButtonIcon('small')}
//                   </button>
//                 </div>
//                 {isSecretPromptSelected && (
//                   <div className="mt-1.5 p-1.5 bg-[#E0F7F6] border border-[#21C1B6] rounded-lg">
//                     <div className="flex items-center space-x-1.5 text-xs text-[#21C1B6]">
//                       <Bot className="h-3 w-3" />
//                       <span>
//                         Using: <strong>{activeDropdown}</strong>
//                       </span>
//                       <button
//                         type="button"
//                         onClick={() => {
//                           setIsSecretPromptSelected(false);
//                           setActiveDropdown('Custom Query');
//                           setSelectedSecretId(null);
//                         }}
//                         className="ml-auto text-[#21C1B6] hover:text-[#1AA49B]"
//                       >
//                         <X className="h-3 w-3" />
//                       </button>
//                     </div>
//                   </div>
//                 )}
//               </form>
//             </div>
//           </div>

//           {/* Right Panel */}
//           <div className="w-full lg:w-3/5 flex flex-col h-2/3 lg:h-full bg-gray-50">
//             <div className="flex-1 p-2 sm:p-4 min-h-0">
//               <div className="h-full">
//                 <DocumentViewer
//                   selectedMessageId={selectedMessageId}
//                   currentResponse={currentResponse}
//                   animatedResponseContent={animatedResponseContent}
//                   messages={messages}
//                   handleCopyResponse={handleCopyResponse}
//                   markdownOutputRef={markdownOutputRef}
//                   isAnimatingResponse={isAnimatingResponse}
//                   showResponseImmediately={showResponseImmediately}
//                   formatDate={formatDate}
//                   markdownComponents={markdownComponents}
//                   responseContainerRef={responseRef}
//                 />
//               </div>
//             </div>
//           </div>
//         </>
//       )}
//     </div>
//   );
// };

// export default AnalysisPage;





import '../styles/AnalysisPage.css';
import React, { useState, useEffect, useRef, useMemo } from 'react';
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
import MindmapContainer from '../components/AnalysisPage/MindmapContainer';
import MindmapViewer from '../components/AnalysisPage/MindmapViewer';
import { convertJsonToPlainText } from '../utils/jsonToPlainText';
import { renderSecretPromptResponse, isStructuredJsonResponse } from '../utils/renderSecretPromptResponse';
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
  Wrench,
  Network,
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

const AnalysisPage = () => {
  const location = useLocation();
  const { fileId: paramFileId, sessionId: paramSessionId } = useParams();
  const { setIsSidebarHidden, setIsSidebarCollapsed } = useSidebar();
  const navigate = useNavigate();

  // State Management
  const [activeDropdown, setActiveDropdown] = useState('Custom Query');
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [hasResponse, setHasResponse] = useState(false);
  const [isSecretPromptSelected, setIsSecretPromptSelected] = useState(false);

  // Document and Analysis Data
  const [documentData, setDocumentData] = useState(null);
  const [messages, setMessages] = useState([]);
  const [fileId, setFileId] = useState(paramFileId || null);
  const [sessionId, setSessionId] = useState(paramSessionId || null);
  const [processingStatus, setProcessingStatus] = useState(null);
  const [progressPercentage, setProgressPercentage] = useState(0);
  const [showProgressPopup, setShowProgressPopup] = useState(false);
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
  const [showToolsDropdown, setShowToolsDropdown] = useState(false);

  // Mindmap state
  const [showMindmap, setShowMindmap] = useState(false);
  const [selectedMindmapMessageId, setSelectedMindmapMessageId] = useState(null);
  const [mindmapData, setMindmapData] = useState(null);
  const [isGeneratingMindmap, setIsGeneratingMindmap] = useState(false);
  const [mindmapError, setMindmapError] = useState(null);

  // Secrets state
  const [secrets, setSecrets] = useState([]);
  const [isLoadingSecrets, setIsLoadingSecrets] = useState(false);
  const [selectedSecretId, setSelectedSecretId] = useState(null);
  const [selectedLlmName, setSelectedLlmName] = useState(null);

  // Batch upload state
  const [batchUploads, setBatchUploads] = useState([]);
  const [uploadedDocuments, setUploadedDocuments] = useState([]);
  const [overallUploadProgress, setOverallUploadProgress] = useState(0);
  const [overallBatchProcessingProgress, setOverallBatchProcessingProgress] = useState(0);
  const [activePollingFiles, setActivePollingFiles] = useState(new Set());
  const [showInsufficientFundsAlert, setShowInsufficientFundsAlert] = useState(false);

  // Refs
  const fileInputRef = useRef(null);
  const dropdownRef = useRef(null);
  const responseRef = useRef(null);
  const markdownOutputRef = useRef(null);
  const pollingIntervalRef = useRef(null);
  const animationFrameRef = useRef(null);
  const uploadIntervalRef = useRef(null);
  const batchPollingIntervalsRef = useRef({});
  const simulatedProgressIntervalsRef = useRef({});
  const streamBufferRef = useRef('');
  const streamUpdateTimeoutRef = useRef(null);
  const streamReaderRef = useRef(null);
  const [isStopped, setIsStopped] = useState(false);
  const currentRequestIdRef = useRef(null); // Track the current request ID to prevent mixing responses
  
  // ✅ Auto-format response when a message is selected to ensure past chats show formatted content immediately
  useEffect(() => {
    if (selectedMessageId && messages.length > 0 && currentResponse) {
      const selectedMessage = messages.find(msg => msg.id === selectedMessageId);
      if (selectedMessage) {
        const rawAnswer = selectedMessage.answer || selectedMessage.response || '';
        // Only reformat if currentResponse looks like raw JSON and message is a secret prompt
        const isSecretPrompt = selectedMessage.used_secret_prompt || false;
        const isCurrentResponseRawJson = isStructuredJsonResponse(currentResponse);
        const isRawAnswerStructured = isStructuredJsonResponse(rawAnswer);
        
        // If the message is a secret prompt and currentResponse is raw JSON, format it
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

  // API Configuration
  const API_BASE_URL = 'http://localhost:5000';

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

  // Fetch secrets
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
      setSecrets(secretsData || []);
      // Always start with "Custom Query" instead of auto-selecting first secret
      setActiveDropdown('Custom Query');
      setSelectedSecretId(null);
      setSelectedLlmName(null);
      setIsSecretPromptSelected(false);
    } catch (error) {
      console.error('Error fetching secrets:', error);
      setError(`Failed to load analysis prompts: ${error.message}`);
    } finally {
      setIsLoadingSecrets(false);
    }
  };

  // Enhanced getProcessingStatus function
  const getProcessingStatus = async (file_id) => {
    try {
      const token = getAuthToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const response = await fetch(`${API_BASE_URL}/files/status/${file_id}`, {
        method: 'GET',
        headers,
      });
      if (!response.ok) {
        console.error(`[getProcessingStatus] Status check failed for ${file_id}: ${response.status}`);
        return null;
      }
      const data = await response.json();
      console.log(`[getProcessingStatus] File ${file_id} status:`, data.status, 'progress:', data.processing_progress, 'operation:', data.current_operation);
      // Update processing status with all fields
      if (file_id === fileId) {
        const newProgress = data.processing_progress || 0;
        const isCompleted = data.status === 'processed' || data.status === 'completed';
        const isFailed = data.status === 'error' || data.status === 'failed';
       
        // ✅ Prevent backwards progress - only update if increasing or final state
        setProgressPercentage((currentProgress) => {
          if (newProgress > currentProgress || isCompleted || isFailed || newProgress === 0) {
            return newProgress;
          }
          console.log(`[getProcessingStatus] Skipping backwards progress for main file: ${newProgress}% <= ${currentProgress}%`);
          return currentProgress; // Keep current progress if new is lower
        });
       
        setProcessingStatus(data);
      }
      // Update uploaded documents array with progress data
      setUploadedDocuments((prev) =>
        prev.map((doc) => {
          if (doc.id === file_id) {
            const currentProgress = doc.processingProgress || 0;
            const newProgress = data.processing_progress || 0;
            const isCompleted = data.status === 'processed' || data.status === 'completed';
            const isFailed = data.status === 'error' || data.status === 'failed';
           
            // ✅ Only update if: progress increased, status changed to completed/error, or it's a reset (0)
            const shouldUpdate = newProgress > currentProgress || isCompleted || isFailed || newProgress === 0;
           
            if (!shouldUpdate && data.status === doc.status) {
              console.log(`[getProcessingStatus] Skipping backwards progress for ${file_id}: ${newProgress}% <= ${currentProgress}%`);
              return doc; // Don't update if progress would go backwards
            }
           
            return {
              ...doc,
              status: data.status,
              processingProgress: newProgress,
              currentOperation: data.current_operation,
              chunkCount: data.chunk_count,
              lastUpdated: data.last_updated,
              embeddingsGenerated: data.embeddings_generated,
              embeddingsTotal: data.embeddings_total,
              chunksSaved: data.chunks_saved,
              estimatedPages: data.estimated_pages,
              chunkingMethod: data.chunking_method,
              jobError: data.job_error,
            };
          }
          return doc;
        })
      );
      // Update batch uploads with progress data
      setBatchUploads((prev) =>
        prev.map((upload) => {
          if (upload.fileId === file_id) {
            const currentProgress = upload.processingProgress || 0;
            const newProgress = data.processing_progress || 0;
            const isCompleted = data.status === 'processed' || data.status === 'completed';
            const isFailed = data.status === 'error' || data.status === 'failed';
           
            // ✅ Only update if: progress increased, status changed to completed/error, or it's a reset (0)
            const shouldUpdate = newProgress > currentProgress || isCompleted || isFailed || newProgress === 0;
           
            if (!shouldUpdate && data.status === upload.status) {
              console.log(`[getProcessingStatus] Skipping backwards progress for ${file_id}: ${newProgress}% <= ${currentProgress}%`);
              return upload; // Don't update if progress would go backwards
            }
           
            return {
              ...upload,
              status: data.status,
              processingProgress: newProgress,
              currentOperation: data.current_operation,
              chunkCount: data.chunk_count,
              lastUpdated: data.last_updated,
              embeddingsGenerated: data.embeddings_generated,
              embeddingsTotal: data.embeddings_total,
              chunksSaved: data.chunks_saved,
              estimatedPages: data.estimated_pages,
              chunkingMethod: data.chunking_method,
              jobError: data.job_error,
            };
          }
          return upload;
        })
      );
      // Handle completion or error - stop polling
      if (data.status === 'processed') {
        console.log(`[getProcessingStatus] File ${file_id} completed processing`);
        if (batchPollingIntervalsRef.current[file_id]) {
          clearInterval(batchPollingIntervalsRef.current[file_id]);
          delete batchPollingIntervalsRef.current[file_id];
          setActivePollingFiles((prev) => {
            const newSet = new Set(prev);
            newSet.delete(file_id);
            return newSet;
          });
        }
        if (file_id === fileId && pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        setSuccess('Document processing completed!');
      } else if (data.status === 'error') {
        console.error(`[getProcessingStatus] File ${file_id} processing failed:`, data.job_error);
        setError(data.job_error || `Document processing failed for ${data.filename}`);
        if (batchPollingIntervalsRef.current[file_id]) {
          clearInterval(batchPollingIntervalsRef.current[file_id]);
          delete batchPollingIntervalsRef.current[file_id];
          setActivePollingFiles((prev) => {
            const newSet = new Set(prev);
            newSet.delete(file_id);
            return newSet;
          });
        }
        if (file_id === fileId && pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      }
      return data;
    } catch (error) {
      console.error(`[getProcessingStatus] Error getting status for ${file_id}:`, error);
      return null;
    }
  };

  // Start polling for a single file (poll every 1s) - no timeout, continues until processed
  const startProcessingStatusPolling = (file_id) => {
    console.log(`[startProcessingStatusPolling] Starting 1s polling for file: ${file_id}`);
    if (pollingIntervalRef.current && file_id === fileId) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    const pollInterval = 1000; // 1 second
    const intervalId = setInterval(async () => {
      const status = await getProcessingStatus(file_id);
      if (status && (status.status === 'processed' || status.status === 'error')) {
        clearInterval(intervalId);
        if (file_id === fileId) {
          pollingIntervalRef.current = null;
        }
      }
      // Continue polling indefinitely until document is processed or errors naturally
    }, pollInterval);
    if (file_id === fileId) {
      pollingIntervalRef.current = intervalId;
    }
  };

  // Start batch polling (1s intervals) - no timeout, continues until processed
  const startBatchProcessingPolling = (fileIds) => {
    console.log(`[startBatchProcessingPolling] Starting 1s batch polling for ${fileIds.length} files`);
    fileIds.forEach((file_id) => {
      if (batchPollingIntervalsRef.current[file_id]) return;
      setActivePollingFiles((prev) => new Set([...prev, file_id]));
      const pollInterval = 1000;
      const intervalId = setInterval(async () => {
        const status = await getProcessingStatus(file_id);
        if (status && (status.status === 'processed' || status.status === 'error')) {
          clearInterval(intervalId);
          delete batchPollingIntervalsRef.current[file_id];
          setActivePollingFiles((prev) => {
            const newSet = new Set(prev);
            newSet.delete(file_id);
            return newSet;
          });
        }
        // Continue polling indefinitely until document is processed or errors naturally
      }, pollInterval);
      batchPollingIntervalsRef.current[file_id] = intervalId;
    });
  };

  // Batch file upload (triggers polling on success)
  const batchUploadDocuments = async (files, secretId = null, llmName = null) => {
    const isProduction = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
    const environment = isProduction ? 'PRODUCTION' : 'LOCALHOST';
   
    console.log(`[batchUploadDocuments] 🚀 Starting batch upload for ${files.length} files`);
    console.log(`[batchUploadDocuments] 🌍 Environment: ${environment}`);
    console.log(`[batchUploadDocuments] 🔗 API Base URL: ${API_BASE_URL}`);
   
    setIsUploading(true);
    setError(null);
    const LARGE_FILE_THRESHOLD = 32 * 1024 * 1024; // 32MB in bytes
   
    const initialBatchUploads = files.map((file, index) => {
      const isLarge = file.size > LARGE_FILE_THRESHOLD;
      const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
      console.log(`[batchUploadDocuments] 📄 File ${index + 1}: ${file.name} (${fileSizeMB}MB) - ${isLarge ? '🔴 LARGE (will use signed URL)' : '🟢 Small (regular upload)'}`);
      return {
        id: `${file.name}-${Date.now()}-${index}`,
        file: file,
        fileName: file.name,
        fileSize: file.size,
        progress: 0,
        status: 'pending',
        fileId: null,
        error: null,
        processingProgress: 0,
        isLargeFile: isLarge,
      };
    });
    setBatchUploads(initialBatchUploads);
    setShowSplitView(true);
   
    try {
      const token = getAuthToken();
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
     
      // Separate large and small files
      const largeFiles = files.filter(f => f.size > LARGE_FILE_THRESHOLD);
      const smallFiles = files.filter(f => f.size <= LARGE_FILE_THRESHOLD);
      const uploadedFileIds = [];
     
      console.log(`[batchUploadDocuments] 📊 Summary: ${largeFiles.length} large file(s) (signed URL), ${smallFiles.length} small file(s) (regular upload)`);
     
      // Upload large files individually using signed URLs
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
                ? { ...upload, status: 'uploading', progress: 10 }
                : upload
            )
          );
         
          // Step 1: Get signed URL
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
           
            // Check for subscription-related errors
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
         
          setBatchUploads((prev) =>
            prev.map((upload) =>
              upload.id === matchingUpload.id
                ? { ...upload, progress: 30 }
                : upload
            )
          );
         
          // Step 2: Upload file directly to GCS with progress tracking
          console.log(`[📤 SIGNED URL UPLOAD] Step 2/3: Uploading file directly to GCS (PUT request)`);
         
          // Use XMLHttpRequest for progress tracking
          await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
           
            // Track upload progress
            xhr.upload.addEventListener('progress', (e) => {
              if (e.lengthComputable) {
                const percentComplete = Math.round((e.loaded / e.total) * 100);
                // Map to 30-70% range (since we're at step 2 of 3)
                const mappedProgress = 30 + Math.round((percentComplete / 100) * 40);
                setBatchUploads((prev) =>
                  prev.map((upload) =>
                    upload.id === matchingUpload.id
                      ? { ...upload, progress: mappedProgress }
                      : upload
                  )
                );
              }
            });
           
            xhr.addEventListener('load', () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                console.log(`[📤 SIGNED URL UPLOAD] ✅ File uploaded to GCS successfully`);
                setBatchUploads((prev) =>
                  prev.map((upload) =>
                    upload.id === matchingUpload.id
                      ? { ...upload, progress: 70 }
                      : upload
                  )
                );
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
         
          // Step 3: Complete upload
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
           
            // Check for subscription-related errors
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
              status: 'batch_processing',
              processingProgress: 0,
            },
          ]);
         
          uploadedFileIds.push(fileId);
         
          // Set first file as the active document
          if (i === 0 && largeFiles.length > 0) {
            setFileId(fileId);
            setDocumentData({
              id: fileId,
              title: matchingUpload.fileName,
              originalName: matchingUpload.fileName,
              size: matchingUpload.fileSize,
              type: matchingUpload.file.type,
              uploadedAt: new Date().toISOString(),
              status: 'batch_processing',
              processingProgress: 0,
            });
            startProcessingStatusPolling(fileId);
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
     
      // Upload small files using batch upload endpoint
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
            return isSmallFile ? { ...upload, status: 'uploading', progress: 0 } : upload;
          })
        );
       
        // Use XMLHttpRequest for progress tracking
        const data = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
         
          // Track upload progress for all small files combined
          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
              const percentComplete = Math.round((e.loaded / e.total) * 100);
              // Update progress for all small files
              setBatchUploads((prev) =>
                prev.map((upload) => {
                  const isSmallFile = smallFiles.includes(upload.file);
                  return isSmallFile
                    ? { ...upload, progress: percentComplete }
                    : upload;
                })
              );
            }
          });
         
          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const responseData = JSON.parse(xhr.responseText);
                // Set all small files to 100% progress
                setBatchUploads((prev) =>
                  prev.map((upload) => {
                    const isSmallFile = smallFiles.includes(upload.file);
                    return isSmallFile
                      ? { ...upload, progress: 100 }
                      : upload;
                  })
                );
                resolve(responseData);
              } catch (error) {
                reject(new Error('Failed to parse response'));
              }
            } else {
              try {
                const errorData = JSON.parse(xhr.responseText);
                // Check for subscription-related errors
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
                // If status is 500, treat as potential subscription error
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
                    ? { ...upload, status: 'failed', error: uploadedFile.error, progress: 0 }
                    : upload
                )
              );
            } else {
              const fileId = uploadedFile.file_id;
              console.log(`[batchUploadDocuments] Successfully uploaded ${matchingUpload.fileName} with ID: ${fileId}`);
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
                  fileName: uploadedFile.filename || matchingUpload.fileName,
                  fileSize: matchingUpload.fileSize,
                  uploadedAt: new Date().toISOString(),
                  status: 'batch_processing',
                  operationName: uploadedFile.operation_name,
                  processingProgress: 0,
                },
              ]);
              uploadedFileIds.push(fileId);
             
              // Set first file as the active document if no large file was set
              if (uploadedFileIds.length === largeFiles.length + 1) {
                setFileId(fileId);
                setDocumentData({
                  id: fileId,
                  title: matchingUpload.fileName,
                  originalName: matchingUpload.fileName,
                  size: matchingUpload.fileSize,
                  type: matchingUpload.file.type,
                  uploadedAt: new Date().toISOString(),
                  status: 'batch_processing',
                  processingProgress: 0,
                });
                startProcessingStatusPolling(fileId);
              }
            }
          });
        }
      }
     
      // Start polling for all uploaded files
      if (uploadedFileIds.length > 0) {
        startBatchProcessingPolling(uploadedFileIds);
      }
     
      const successCount = uploadedFileIds.length;
      const failCount = initialBatchUploads.length - successCount;
     
      if (successCount > 0) {
        setSuccess(`${successCount} document(s) uploaded successfully! Processing...`);
      }
      if (failCount > 0) {
        setError(`${failCount} document(s) failed to upload.`);
      }
    } catch (error) {
      console.error('[batchUploadDocuments] Batch upload error:', error);
     
      // Check if this is a subscription error
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

  // Animation that reveals the response in a ChatGPT-like fashion (word-by-word)
  const animateResponse = (text = '', isAlreadyFormatted = false) => {
    console.log('[animateResponse] Starting ChatGPT-style word-by-word animation. Length:', text.length);

    // Cancel any existing animation
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      clearTimeout(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // ✅ Convert JSON to plain text only if not already formatted
    const plainText = isAlreadyFormatted ? text : convertJsonToPlainText(text);
    
    // Handle empty or invalid responses
    if (!plainText || typeof plainText !== 'string') {
      setIsAnimatingResponse(false);
      setAnimatedResponseContent(plainText || '');
      return;
    }

    setAnimatedResponseContent('');
    setIsAnimatingResponse(true);
    setShowSplitView(true);

    // Split text into words while preserving spaces and newlines
    const words = plainText.split(/(\s+)/);
    let currentIndex = 0;
    let displayedText = '';

    // If response is very short, show it immediately
    if (words.length <= 3) {
        setIsAnimatingResponse(false);
      setAnimatedResponseContent(plainText);
        return;
      }

    const animateWord = () => {
      if (currentIndex < words.length) {
        // Add the next word to displayed text
        displayedText += words[currentIndex];
        setAnimatedResponseContent(displayedText);
        currentIndex++;

        // Auto-scroll during animation
        if (responseRef.current) {
          responseRef.current.scrollTop = responseRef.current.scrollHeight;
        }

        // Calculate delay based on word length and type
        const word = words[currentIndex - 1];
        let delay = 15; // Base delay in milliseconds
        
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
        setAnimatedResponseContent(plainText);
        animationFrameRef.current = null;
      }
    };

    // Start animation with a small initial delay for smoother start
    animationFrameRef.current = setTimeout(animateWord, 20);
  };

  // Show response immediately
  const showResponseImmediately = (text = '') => {
    // ✅ Convert JSON to plain text first
    const plainText = convertJsonToPlainText(text);
    
    // Cancel any ongoing animation
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

  // Stop generation function
  const stopGeneration = async () => {
    setIsStopped(true);
    setIsLoading(false);
    setIsGeneratingInsights(false);
    
    // Cancel the stream reader if it exists
    if (streamReaderRef.current) {
      try {
        await streamReaderRef.current.cancel();
      } catch (e) {
        console.warn('[stopGeneration] Error canceling stream:', e);
      }
      streamReaderRef.current = null;
    }
    
    // Clear any pending timeouts
    if (streamUpdateTimeoutRef.current) {
      clearTimeout(streamUpdateTimeoutRef.current);
      streamUpdateTimeoutRef.current = null;
    }
    
    // Show whatever we have so far with animation
    if (streamBufferRef.current) {
      const finalResponse = streamBufferRef.current;
      const isStructured = isStructuredJsonResponse(finalResponse);
      const responseToDisplay = isStructured 
        ? renderSecretPromptResponse(finalResponse) 
        : convertJsonToPlainText(finalResponse);
      setCurrentResponse(responseToDisplay);
      animateResponse(responseToDisplay, isStructured); // Animate the partial response
    }
    
    setSuccess('Generation stopped.');
  };

  const baseSendDisabled =
    isLoading ||
    isGeneratingInsights ||
    (!chatInput.trim() && !isSecretPromptSelected);

  const isGenerating = isLoading || isGeneratingInsights;
  const sendButtonType = (isAnimatingResponse || isGenerating) ? 'button' : 'submit';
  const isSendButtonDisabled = (isAnimatingResponse || isGenerating) ? false : baseSendDisabled;
  const sendButtonTitle = isGenerating ? 'Stop Generation' : (isAnimatingResponse ? 'Stop rendering' : 'Send Message');

  const handleSendButtonClick = (event) => {
    if (isGenerating) {
      event.preventDefault();
      stopGeneration();
    } else if (isAnimatingResponse) {
      event.preventDefault();
      stopResponseAnimation();
    }
  };

  const getSendButtonClassName = (size = 'default') => {
    const paddingClass = size === 'small' ? 'p-1.5' : 'p-1.5 sm:p-2';
    const colorClass = (isAnimatingResponse || isGenerating)
      ? 'bg-red-600 hover:bg-red-700'
      : 'bg-[#21C1B6] hover:bg-[#1AA49B] disabled:bg-gray-300';
    return `${paddingClass} text-white rounded-lg transition-colors flex-shrink-0 disabled:cursor-not-allowed ${colorClass}`;
  };

  const renderSendButtonIcon = (size = 'default') => {
    const baseClass = size === 'small' ? 'h-3 w-3' : 'h-4 w-4 sm:h-5 sm:w-5';
    if (isGenerating) {
      return <Square className={`${baseClass} fill-current`} />;
    }
    if (isAnimatingResponse) {
      return <Square className={baseClass} />;
    }
    return <Send className={baseClass} />;
  };

  // Chat with document - Streaming version
  const chatWithDocument = async (file_id, question, currentSessionId, llm_name = null) => {
    // Clear previous state
    setCurrentResponse('');
    setAnimatedResponseContent('');
    streamBufferRef.current = '';
    setError(null);
    setIsLoading(true);
    setIsAnimatingResponse(false);
    
    // Close existing stream if any
    if (streamReaderRef.current) {
      try {
        await streamReaderRef.current.cancel();
      } catch (e) {
        // Ignore cancel errors
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
          if (isStopped) {
            setIsLoading(false);
            // Show partial response if stopped with animation
            if (streamBufferRef.current) {
              const plainTextResponse = convertJsonToPlainText(streamBufferRef.current);
              setCurrentResponse(plainTextResponse);
              animateResponse(plainTextResponse);
            }
            break;
          }
          
          setIsLoading(false);
          // Create message with final response
          const finalResponse = streamBufferRef.current;
          if (finalMetadata) {
            newSessionId = finalMetadata.session_id || newSessionId;
          }
          
          // ✅ Convert JSON to plain text before saving to message
          const plainTextResponse = convertJsonToPlainText(finalResponse);
          const newChat = {
            id: Date.now(),
            file_id: file_id,
            session_id: newSessionId,
            question: question.trim(),
            answer: plainTextResponse, // Store plain text, not JSON
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
          // Set current response and animate it
          setCurrentResponse(plainTextResponse);
          animateResponse(plainTextResponse);
          setHasResponse(true);
          setSuccess('Question answered!');
          break;
        }
        
        // Check if stopped during streaming
        if (isStopped) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;
          
          const data = line.replace(/^data: /, '').trim();
          
          // Handle heartbeat
          if (data === '[PING]') {
            continue; // Ignore heartbeat
          }
          
          // Handle completion
          if (data === '[DONE]') {
            if (isStopped) {
              setIsLoading(false);
              // Show partial response if stopped with animation
              if (streamBufferRef.current) {
                const plainTextResponse = convertJsonToPlainText(streamBufferRef.current);
                setCurrentResponse(plainTextResponse);
                animateResponse(plainTextResponse);
              }
              return;
            }
            
            setIsLoading(false);
            const finalResponse = streamBufferRef.current;
            if (finalMetadata) {
              newSessionId = finalMetadata.session_id || newSessionId;
            }
            
            // ✅ Convert JSON to plain text before saving to message
            const plainTextResponse = convertJsonToPlainText(finalResponse);
            const newChat = {
              id: Date.now(),
              file_id: file_id,
              session_id: newSessionId,
              question: question.trim(),
              answer: plainTextResponse, // Store plain text, not JSON
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
            // Set current response and animate it
            setCurrentResponse(plainTextResponse);
            animateResponse(plainTextResponse);
            setHasResponse(true);
            setSuccess('Question answered!');
            return;
          }
          
          // Check if stopped during streaming
          if (isStopped) {
            return;
          }

          // Parse JSON data
          try {
            const parsed = JSON.parse(data);
            
            if (parsed.type === 'metadata') {
              // Handle metadata (session_id, etc.)
              console.log('Stream metadata:', parsed);
              newSessionId = parsed.session_id || newSessionId;
            } else if (parsed.type === 'chunk') {
              // Append chunk to buffer (don't show during streaming)
              if (!isStopped) {
                streamBufferRef.current += parsed.text || '';
                // Don't display during streaming - only show after completion
              }
              
              // Check if stopped during streaming
              if (isStopped) {
                break;
              }
            } else if (parsed.type === 'done') {
              // Final metadata - stream complete
              if (isStopped) {
                setIsLoading(false);
                // Show partial response if stopped with animation
                if (streamBufferRef.current) {
                  const plainTextResponse = convertJsonToPlainText(streamBufferRef.current);
                  setCurrentResponse(plainTextResponse);
                  animateResponse(plainTextResponse);
                }
                return;
              }
              
              finalMetadata = parsed;
              const finalResponse = streamBufferRef.current;
              // ✅ Convert JSON to plain text before setting
              const plainTextResponse = convertJsonToPlainText(finalResponse);
              // Set current response and animate it
              setCurrentResponse(plainTextResponse);
              animateResponse(plainTextResponse);
              setIsLoading(false);
            } else if (parsed.type === 'error') {
              setError(parsed.error);
              setIsLoading(false);
            }
          } catch (e) {
            // Skip invalid JSON - might be partial data
          }
        }
      }
    } catch (error) {
      console.error('[chatWithDocument] Streaming error:', error);
      // Handle specific error cases
      if (error.message && error.message.includes('No content found')) {
        setError('Document is still processing. Please wait a few moments and try again.');
        // Refresh the processing status to get latest state
        if (file_id) {
          const status = await getProcessingStatus(file_id);
          if (status) {
            setProcessingStatus(status);
            setProgressPercentage(status.processing_progress || 0);
            // If still processing, restart polling
            if (status.status !== 'processed' && status.status !== 'error') {
              startProcessingStatusPolling(file_id);
            }
          }
        }
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
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'image/png',
      'image/jpeg',
      'image/tiff',
    ];
    const maxSize = 300 * 1024 * 1024;
    const validFiles = files.filter((file) => {
      if (!allowedTypes.includes(file.type)) {
        setError(`File "${file.name}" has an unsupported type.`);
        return false;
      }
      if (file.size > maxSize) {
        setError(`File "${file.name}" is too large (max 300MB).`);
        return false;
      }
      return true;
    });
    if (validFiles.length === 0) {
      event.target.value = '';
      return;
    }
    try {
      await batchUploadDocuments(validFiles, selectedSecretId, selectedLlmName);
    } catch (error) {
      console.error('Upload error:', error);
    }
    event.target.value = '';
  };

  const handleDropdownSelect = (secretName, secretId, llmName) => {
    console.log('[handleDropdownSelect] Selected:', secretName, secretId, 'LLM:', llmName);
    setActiveDropdown(secretName);
    setSelectedSecretId(secretId);
    setSelectedLlmName(llmName);
    setIsSecretPromptSelected(true);
    setChatInput('');
    setShowDropdown(false);
    
    // Find and display the most recent message for this specific secret prompt, or clear if none exists
    const messagesForThisPrompt = messages.filter(
      (msg) => msg.used_secret_prompt && msg.secret_id === secretId && msg.file_id === fileId
    );
    
    // Get the most recent message (by timestamp)
    const messageForThisPrompt = messagesForThisPrompt.length > 0
      ? messagesForThisPrompt.sort((a, b) => {
          const timeA = new Date(a.timestamp || a.created_at || 0).getTime();
          const timeB = new Date(b.timestamp || b.created_at || 0).getTime();
          return timeB - timeA; // Most recent first
        })[0]
      : null;
    
    if (messageForThisPrompt) {
      // Display the most recent message for this specific prompt
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
      // Clear previous response when switching to a different secret prompt with no existing message
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
    // When user types in the input box, switch to custom query mode
    if (e.target.value && isSecretPromptSelected) {
      setIsSecretPromptSelected(false);
      setActiveDropdown('Custom Query');
      setSelectedSecretId(null);
      setSelectedLlmName(null);
    }
    // If input is empty and no secret is selected, show Custom Query
    if (!e.target.value && !isSecretPromptSelected) {
      setActiveDropdown('Custom Query');
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();

    const hasFile = Boolean(fileId);
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

    if (isSecretPromptSelected) {
      if (!hasFile) {
        setError('Please upload a document before running an analysis prompt.');
        return;
      }
      if (currentStatus === 'error') {
        setError('Document processing failed. Please upload a new document.');
        return;
      }
      if (isActivelyProcessing && !isProcessingComplete) {
        setError('Document is still being processed. Please wait until processing is complete.');
        return;
      }
      if (!selectedSecretId) {
        setError('Please select an analysis type.');
        return;
      }
      const selectedSecret = secrets.find((s) => s.id === selectedSecretId);
      const promptLabel = selectedSecret?.name || 'Secret Prompt';
      
      // ✅ CRITICAL: Capture the secretId at the start to ensure we only show responses for THIS prompt
      const currentSecretId = selectedSecretId;
      const currentPromptLabel = promptLabel;
      const currentLlmName = selectedLlmName;
      
      // ✅ CRITICAL: Generate a unique request ID for this request
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      currentRequestIdRef.current = requestId;
      
      try {
        setIsGeneratingInsights(true);
        setError(null);
        console.log('[handleSend] Triggering secret analysis with streaming:', {
          requestId,
          secretId: currentSecretId,
          fileId,
          additionalInput: chatInput.trim(),
          promptLabel: currentPromptLabel,
          llmName: currentLlmName,
        });
        
        // ✅ CRITICAL: Aggressively clear ALL previous state to prevent showing previous prompt's response
        // Cancel any ongoing animations first
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          clearTimeout(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        setCurrentResponse('');
        setAnimatedResponseContent('');
        setSelectedMessageId(null); // Clear previous message selection
        streamBufferRef.current = ''; // Clear buffer completely
        setIsAnimatingResponse(false);
        setIsStopped(false);
        setHasResponse(false); // Reset response flag
        // Force a small delay to ensure state is cleared before starting new request
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Close existing stream if any
        if (streamReaderRef.current) {
          try {
            await streamReaderRef.current.cancel();
          } catch (e) {
            // Ignore cancel errors
          }
          streamReaderRef.current = null;
        }
        
        if (streamUpdateTimeoutRef.current) {
          clearTimeout(streamUpdateTimeoutRef.current);
          streamUpdateTimeoutRef.current = null;
        }

        const token = getAuthToken();
        const response = await fetch(`${API_BASE_URL}/files/chat/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : '',
            'Accept': 'text/event-stream',
          },
          body: JSON.stringify({
            file_id: fileId,
            secret_id: currentSecretId, // Use captured value
            used_secret_prompt: true,
            prompt_label: currentPromptLabel, // Use captured value
            session_id: sessionId,
            llm_name: currentLlmName, // Use captured value
            additional_input: chatInput.trim() || '',
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body.getReader();
        streamReaderRef.current = reader;
        const decoder = new TextDecoder();
        let buffer = '';
        let newSessionId = sessionId;
        let finalMetadata = null;

        while (true) {
          // ✅ CRITICAL: Check if this request is still the current one
          if (currentRequestIdRef.current !== requestId) {
            console.log('[handleSend] Request ID changed during streaming, aborting. Current:', currentRequestIdRef.current, 'Expected:', requestId);
            break;
          }
          
          const { done, value } = await reader.read();
          
          if (done) {
            // ✅ CRITICAL: Verify this is still the current request before processing
            if (currentRequestIdRef.current !== requestId) {
              console.log('[handleSend] Request ID changed before processing done, ignoring response');
              break;
            }
            
            if (isStopped) {
              setIsGeneratingInsights(false);
              // Show partial response if stopped with animation, but only if it matches the current secret prompt and request
              if (streamBufferRef.current && currentSecretId === selectedSecretId && currentRequestIdRef.current === requestId) {
                const finalResponse = streamBufferRef.current;
                const isStructured = isStructuredJsonResponse(finalResponse);
                const responseToDisplay = isStructured ? renderSecretPromptResponse(finalResponse) : convertJsonToPlainText(finalResponse);
                setCurrentResponse(responseToDisplay);
                animateResponse(responseToDisplay, isStructured); // Animate the partial response
              }
              break;
            }
            
            setIsGeneratingInsights(false);
            // Create message with final response
            const finalResponse = streamBufferRef.current;
            if (finalMetadata) {
              newSessionId = finalMetadata.session_id || newSessionId;
            }
            
            // ✅ For secret prompts, preserve raw JSON response; otherwise convert to plain text
            const isStructured = isStructuredJsonResponse(finalResponse);
            const responseToStore = isStructured ? finalResponse : convertJsonToPlainText(finalResponse);
            const responseToDisplay = isStructured ? renderSecretPromptResponse(finalResponse) : convertJsonToPlainText(finalResponse);
            
            const newChat = {
              id: Date.now(),
              file_id: fileId,
              session_id: newSessionId,
              question: currentPromptLabel, // Use captured value
              answer: responseToStore, // Store raw JSON for secret prompts, plain text for others
              display_text_left_panel: `Analysis: ${currentPromptLabel}`, // Use captured value
              timestamp: new Date().toISOString(),
              used_chunk_ids: finalMetadata?.used_chunk_ids || [],
              confidence: finalMetadata?.confidence || 0.8,
              type: 'chat',
              used_secret_prompt: true,
              prompt_label: currentPromptLabel, // Use captured value
              secret_id: currentSecretId, // Use captured value to uniquely identify the prompt
            };
            setMessages((prev) => [...prev, newChat]);
            // ✅ CRITICAL: Only set the response if this message matches the secret prompt that initiated this request
            // AND if this is still the current request
            if (currentSecretId === newChat.secret_id && currentSecretId === selectedSecretId && currentRequestIdRef.current === requestId) {
              setSelectedMessageId(newChat.id);
              setSessionId(newSessionId);
              setChatInput('');
              // Set current response and animate it (already formatted for secret prompts)
              setCurrentResponse(responseToDisplay);
              animateResponse(responseToDisplay, true); // true = already formatted
              setHasResponse(true);
            } else {
              // If secret prompt changed during streaming, don't show this response
              console.log('[handleSend] Request ID or secret prompt changed during streaming, not displaying response. RequestId:', currentRequestIdRef.current, 'Expected:', requestId, 'Current:', currentSecretId, 'Selected:', selectedSecretId);
            }
            setSuccess('Analysis completed successfully!');
            setIsSecretPromptSelected(false);
            setActiveDropdown('Custom Query');
            break;
          }
          
          // Check if stopped during streaming
          if (isStopped) {
            break;
          }
          
          // ✅ CRITICAL: Verify this is still the current request before processing chunks
          if (currentRequestIdRef.current !== requestId) {
            console.log('[handleSend] Request ID changed during chunk processing, ignoring chunks');
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line

          for (const line of lines) {
            if (!line.trim() || !line.startsWith('data: ')) continue;
            
            const data = line.replace(/^data: /, '').trim();
            
            // Handle heartbeat
            if (data === '[PING]') {
              continue; // Ignore heartbeat
            }
            
            // Handle completion
            if (data === '[DONE]') {
              // ✅ CRITICAL: Verify this is still the current request
              if (currentRequestIdRef.current !== requestId) {
                console.log('[handleSend] Request ID changed before processing [DONE], ignoring');
                return;
              }
              
              if (isStopped) {
                setIsGeneratingInsights(false);
                // Show partial response if stopped with animation, but only if it matches the current secret prompt and request
                if (streamBufferRef.current && currentSecretId === selectedSecretId && currentRequestIdRef.current === requestId) {
                  const finalResponse = streamBufferRef.current;
                  const isStructured = isStructuredJsonResponse(finalResponse);
                  const responseToDisplay = isStructured ? renderSecretPromptResponse(finalResponse) : convertJsonToPlainText(finalResponse);
                  setCurrentResponse(responseToDisplay);
                  animateResponse(responseToDisplay, isStructured); // Animate the partial response
                }
                return;
              }
              
              setIsGeneratingInsights(false);
              const finalResponse = streamBufferRef.current;
              
              if (finalMetadata) {
                newSessionId = finalMetadata.session_id || newSessionId;
              }
              
              // ✅ For secret prompts, preserve raw JSON response; otherwise convert to plain text
              const isStructured = isStructuredJsonResponse(finalResponse);
              const responseToStore = isStructured ? finalResponse : convertJsonToPlainText(finalResponse);
              const responseToDisplay = isStructured ? renderSecretPromptResponse(finalResponse) : convertJsonToPlainText(finalResponse);
              
              const newChat = {
                id: Date.now(),
                file_id: fileId,
                session_id: newSessionId,
                question: currentPromptLabel, // Use captured value
                answer: responseToStore, // Store raw JSON for secret prompts, plain text for others
                display_text_left_panel: `Analysis: ${currentPromptLabel}`, // Use captured value
                timestamp: new Date().toISOString(),
                used_chunk_ids: finalMetadata?.used_chunk_ids || [],
                confidence: finalMetadata?.confidence || 0.8,
                type: 'chat',
                used_secret_prompt: true,
                prompt_label: currentPromptLabel, // Use captured value
                secret_id: currentSecretId, // Use captured value to uniquely identify the prompt
              };
              setMessages((prev) => [...prev, newChat]);
              // ✅ CRITICAL: Only set the response if this message matches the secret prompt that initiated this request
              // AND if this is still the current request
              if (currentSecretId === newChat.secret_id && currentSecretId === selectedSecretId && currentRequestIdRef.current === requestId) {
                setSelectedMessageId(newChat.id);
                setSessionId(newSessionId);
                setChatInput('');
                // Set current response and animate it (already formatted for secret prompts)
                setCurrentResponse(responseToDisplay);
                animateResponse(responseToDisplay, true); // true = already formatted
                setHasResponse(true);
              } else {
                // If secret prompt changed during streaming, don't show this response
                console.log('[handleSend] Request ID or secret prompt changed during streaming, not displaying response. RequestId:', currentRequestIdRef.current, 'Expected:', requestId, 'Current:', currentSecretId, 'Selected:', selectedSecretId);
              }
              setSuccess('Analysis completed successfully!');
              setIsSecretPromptSelected(false);
              setActiveDropdown('Custom Query');
              return;
            }
            
            // Check if stopped during streaming
            if (isStopped) {
              return;
            }
            
            // ✅ CRITICAL: Verify this is still the current request before processing chunks
            if (currentRequestIdRef.current !== requestId) {
              console.log('[handleSend] Request ID changed during chunk processing, ignoring chunks');
              return;
            }

            // Parse JSON data
            try {
              const parsed = JSON.parse(data);
              
              if (parsed.type === 'metadata') {
                // Handle metadata (session_id, etc.)
                console.log('Stream metadata:', parsed);
                newSessionId = parsed.session_id || newSessionId;
              } else if (parsed.type === 'chunk') {
                // ✅ CRITICAL: Only append chunk if this is still the current request
                if (!isStopped && currentRequestIdRef.current === requestId) {
                  streamBufferRef.current += parsed.text || '';
                  // Don't display during streaming - only show after completion
                }
                
                // Check if stopped during streaming
                if (isStopped) {
                  break;
                }
                
                // ✅ CRITICAL: Double-check request ID after processing chunk
                if (currentRequestIdRef.current !== requestId) {
                  console.log('[handleSend] Request ID changed after processing chunk, aborting');
                  break;
                }
              } else if (parsed.type === 'done') {
                // Final metadata - stream complete
                if (isStopped) {
                  setIsGeneratingInsights(false);
                  return;
                }
                
                finalMetadata = parsed;
                const finalResponse = streamBufferRef.current;
                // ✅ For secret prompts, render structured JSON; otherwise convert to plain text
                const isStructured = isStructuredJsonResponse(finalResponse);
                const responseToDisplay = isStructured
                  ? renderSecretPromptResponse(finalResponse)
                  : convertJsonToPlainText(finalResponse);
                // Set current response and animate it (already formatted for secret prompts)
                setCurrentResponse(responseToDisplay);
                animateResponse(responseToDisplay, true); // true = already formatted
                setIsGeneratingInsights(false);
              } else if (parsed.type === 'error') {
                setError(parsed.error);
                setIsGeneratingInsights(false);
              }
            } catch (e) {
              // Skip invalid JSON - might be partial data
            }
          }
        }
      } catch (error) {
        console.error('[handleSend] Analysis error:', error);
        // Handle specific error cases
        if (error.message && error.message.includes('No content found')) {
          setError('Document is still processing. Please wait a few moments and try again.');
          // Optionally refresh the processing status
          if (fileId) {
            const status = await getProcessingStatus(fileId);
            if (status) {
              setProcessingStatus(status);
              setProgressPercentage(status.processing_progress || 0);
            }
          }
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
        console.log('[handleSend] Using custom query. LLM:', selectedLlmName || 'default (backend)');
        await chatWithDocument(fileId || null, chatInput, sessionId, selectedLlmName);
      } catch (error) {
        console.error('[handleSend] Chat error:', error);
      }
    }
  };

  const handleMessageClick = async (message) => {
    setSelectedMessageId(message.id);
    
    // Clear animation state when selecting a message
    setIsAnimatingResponse(false);
    setAnimatedResponseContent('');
    
    // If this is a secret prompt message, update the selected secret to match
    if (message.used_secret_prompt && message.secret_id) {
      setSelectedSecretId(message.secret_id);
      setIsSecretPromptSelected(true);
      // Find the secret name to update the dropdown
      const secret = secrets.find((s) => s.id === message.secret_id);
      if (secret) {
        setActiveDropdown(secret.name);
        setSelectedLlmName(secret.llm_name);
      }
    } else {
      // If it's not a secret prompt, clear secret selection
      setIsSecretPromptSelected(false);
      setActiveDropdown('Custom Query');
      setSelectedSecretId(null);
      setSelectedLlmName(null);
    }
    
    // ✅ For secret prompts, render structured JSON; otherwise convert to plain text
    const rawAnswer = message.answer || message.response || '';
    const isStructured = message.used_secret_prompt && isStructuredJsonResponse(rawAnswer);
    const responseToDisplay = isStructured
      ? renderSecretPromptResponse(rawAnswer)
      : convertJsonToPlainText(rawAnswer);
    
    setCurrentResponse(responseToDisplay);
    showResponseImmediately(responseToDisplay);
    setShowMindmap(false);
    setSelectedMindmapMessageId(null);
   
    // If message has a file_id, verify and update the document processing status
    // Messages can only exist if document was processed, so set status to processed
    if (message.file_id) {
      // Check current status to ensure it's accurate
      const currentFileId = fileId || message.file_id;
      if (currentFileId) {
        try {
          const status = await getProcessingStatus(currentFileId);
          if (status) {
            // If we have messages, the document must be processed (messages can't exist without processed content)
            // So ensure status reflects this
            const finalStatus = status.status === 'processed' ? status : { ...status, status: 'processed', processing_progress: 100 };
            setProcessingStatus(finalStatus);
            setProgressPercentage(finalStatus.processing_progress || 100);
          } else {
            // If status check fails but we have messages, assume processed
            setProcessingStatus({ status: 'processed', processing_progress: 100 });
            setProgressPercentage(100);
          }
        } catch (error) {
          console.error('[handleMessageClick] Error checking status:', error);
          // If we have messages, document must be processed
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
    // Clear mindmap state for new session
    setShowMindmap(false);
    setSelectedMindmapMessageId(null);
    setMindmapData(null);
    setIsGeneratingMindmap(false);
    setMindmapError(null);
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

  // Function to map backend status to user-friendly display text
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      // Cleanup streaming
      if (streamReaderRef.current) {
        streamReaderRef.current.cancel().catch(() => {});
      }
      if (streamUpdateTimeoutRef.current) {
        clearTimeout(streamUpdateTimeoutRef.current);
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (uploadIntervalRef.current) {
        clearInterval(uploadIntervalRef.current);
      }
      Object.keys(batchPollingIntervalsRef.current).forEach((fileId) => {
        clearInterval(batchPollingIntervalsRef.current[fileId]);
      });
    };
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

  useEffect(() => {
    fetchSecrets();
  }, []);


  // Ensure processing status is set to 'processed' if messages exist
  // Messages can only exist if document was processed
  useEffect(() => {
    if (messages.length > 0 && fileId) {
      const currentStatus = processingStatus?.status;
      const currentProgress = progressPercentage || 0;
     
      // If we have messages but status is not 'processed', update it
      if (currentStatus !== 'processed' || currentProgress < 100) {
        setProcessingStatus(prev => ({
          ...prev,
          status: 'processed',
          processing_progress: 100
        }));
        setProgressPercentage(100);
      }
    }
  }, [messages, fileId, processingStatus, progressPercentage]);

  // Main loading effect
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
        // ✅ FIXED: Filter messages by the selected session ID to show only messages from that session
        if (currentSessionId) {
          allMessages = allMessages.filter((msg) => msg.session_id === currentSessionId);
        }
        allMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        setMessages(allMessages);
        if (allMessages.length > 0) {
          // Check actual file status first
          const fileStatus = await getProcessingStatus(currentFileId);
          // If we have messages, the document must be processed (messages can't exist without processed content)
          const actualStatus = 'processed'; // Always processed if messages exist
          const actualProgress = 100; // Always 100% if messages exist
         
          // Use the fetched status but ensure it's marked as processed
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
            // ✅ For secret prompts, render structured JSON; otherwise convert to plain text
            const rawAnswer = chatToDisplay.answer || chatToDisplay.response || '';
            const isSecretPrompt = chatToDisplay.used_secret_prompt || false;
            const isStructured = isSecretPrompt && isStructuredJsonResponse(rawAnswer);
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

    // ✅ NEW: Fetch chat history by session ID only (for session-only routes)
    const fetchChatHistoryBySessionId = async (currentSessionId, selectedChatId = null) => {
      try {
        console.log('[AnalysisPage] Fetching chat history for sessionId:', currentSessionId);
        const response = await apiRequest(`/files/session/${currentSessionId}`, {
          method: 'GET',
        });
       
        // Handle different response structures
        let allMessages = [];
        if (Array.isArray(response)) {
          // If response is an array of messages
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
          // If response has a messages array
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
          // If response has sessions array (similar to file-based history)
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
       
        // Extract file_id from the first message if available
        const extractedFileId = allMessages.length > 0
          ? (allMessages[0].file_id || response.file_id || null)
          : null;
       
        allMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        setMessages(allMessages);
       
        if (allMessages.length > 0) {
          // If we have a file_id, set it; otherwise leave it null
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
            // ✅ For secret prompts, render structured JSON; otherwise convert to plain text
            const responseText = chatToDisplay.answer || chatToDisplay.response || '';
            const isSecretPrompt = chatToDisplay.used_secret_prompt || false;
            const isStructured = isStructuredJsonResponse(responseText);
            const responseToDisplay = (isSecretPrompt && isStructured)
              ? renderSecretPromptResponse(responseText)
              : convertJsonToPlainText(responseText);
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

    // ✅ Clean up stale processing state on page refresh
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

    // Load from localStorage first
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
        // ✅ Check if it's structured JSON (secret prompt response) and format accordingly
        const isStructured = isStructuredJsonResponse(savedCurrentResponse);
        // Try to find the selected message to check if it's a secret prompt
        const selectedMessage = messages.find(msg => msg.id === selectedMessageId);
        const isSecretPrompt = selectedMessage?.used_secret_prompt || false;
        
        const responseToDisplay = (isSecretPrompt && isStructured)
          ? renderSecretPromptResponse(savedCurrentResponse)
          : convertJsonToPlainText(savedCurrentResponse);
        
        setCurrentResponse(responseToDisplay);
        if (savedAnimatedResponseContent) {
          const isAnimatedStructured = isStructuredJsonResponse(savedAnimatedResponseContent);
          const animatedToDisplay = (isSecretPrompt && isAnimatedStructured)
            ? renderSecretPromptResponse(savedAnimatedResponseContent)
            : convertJsonToPlainText(savedAnimatedResponseContent);
          setAnimatedResponseContent(animatedToDisplay);
          setShowSplitView(true);
        } else {
          setAnimatedResponseContent(responseToDisplay);
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

    // Apply navigation overrides
    if (location.state?.newChat) {
      clearAllChatData();
      window.history.replaceState({}, document.title);
    } else if (paramFileId && paramSessionId) {
      console.log('[AnalysisPage] Loading chat from URL params:', { paramFileId, paramSessionId });
      setFileId(paramFileId);
      setSessionId(paramSessionId);
      // ✅ Set showSplitView immediately to prevent welcome screen flash
      setShowSplitView(true);
      setHasResponse(true);
      // ✅ FIXED: Pass null for selectedChatId when loading from params (selects latest in session)
      fetchChatHistory(paramFileId, paramSessionId, null);
    } else if (paramSessionId && !paramFileId) {
      // ✅ NEW: Handle session-only route (/analysis/session/:sessionId)
      console.log('[AnalysisPage] Loading chat from session-only URL param:', { paramSessionId });
      setSessionId(paramSessionId);
      // ✅ Set showSplitView immediately to prevent welcome screen flash
      setShowSplitView(true);
      setHasResponse(true);
      fetchChatHistoryBySessionId(paramSessionId, null);
    } else if (location.state?.chat) {
      const chatData = location.state.chat;
      console.log('[AnalysisPage] Loading chat from location state:', chatData);
      if (chatData.file_id && chatData.session_id) {
        setFileId(chatData.file_id);
        setSessionId(chatData.session_id);
        // ✅ Set showSplitView immediately to prevent welcome screen flash
        setShowSplitView(true);
        setHasResponse(true);
        // ✅ FIXED: Pass specific chat.id to select the exact message
        fetchChatHistory(chatData.file_id, chatData.session_id, chatData.id);
      } else if (chatData.session_id) {
        // ✅ NEW: Handle case where only session_id is available
        console.log('[AnalysisPage] Loading chat with session_id only:', chatData.session_id);
        setSessionId(chatData.session_id);
        // ✅ Set showSplitView immediately to prevent welcome screen flash
        setShowSplitView(true);
        setHasResponse(true);
        // ✅ FIXED: Pass specific chat.id to select the exact message
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

  // Simulate upload progress
  useEffect(() => {
    if (uploadIntervalRef.current) {
      clearInterval(uploadIntervalRef.current);
    }
    const uploadingFiles = batchUploads.filter((upload) => upload.status === 'uploading');
    if (uploadingFiles.length > 0) {
      uploadIntervalRef.current = setInterval(() => {
        setBatchUploads((prev) =>
          prev.map((upload) => {
            if (upload.status === 'uploading' && upload.progress < 100) {
              const newProgress = Math.min(upload.progress + 2, 100);
              return { ...upload, progress: newProgress };
            }
            return upload;
          })
        );
      }, 200);
    }
    return () => {
      if (uploadIntervalRef.current) {
        clearInterval(uploadIntervalRef.current);
        uploadIntervalRef.current = null;
      }
    };
  }, [batchUploads.filter((u) => u.status === 'uploading').length]);

  // Calculate overall upload progress
  useEffect(() => {
    if (batchUploads.length > 0) {
      const uploadingFiles = batchUploads.filter((upload) => upload.status === 'uploading');
      if (uploadingFiles.length > 0) {
        const totalUploadProgress = uploadingFiles.reduce(
          (sum, upload) => sum + (upload.progress || 0),
          0
        );
        setOverallUploadProgress(totalUploadProgress / uploadingFiles.length);
      } else {
        setOverallUploadProgress(100);
      }
    } else {
      setOverallUploadProgress(0);
    }
  }, [batchUploads]);

  // Calculate overall batch processing progress with real-time updates
  useEffect(() => {
    if (batchUploads.length > 0) {
      const processingFiles = batchUploads.filter(
        (upload) => upload.status === 'processing' || upload.status === 'batch_processing'
      );
      if (processingFiles.length > 0) {
        const totalProcessingProgress = processingFiles.reduce(
          (sum, upload) => sum + (upload.processingProgress || 0),
          0
        );
        const avgProgress = totalProcessingProgress / processingFiles.length;
        setOverallBatchProcessingProgress(avgProgress);
        console.log(
          `[Overall Progress] ${processingFiles.length} files processing, avg: ${avgProgress.toFixed(1)}%`
        );
      } else {
        const nonProcessedFiles = batchUploads.filter(
          (upload) => upload.status !== 'processed' && upload.status !== 'failed'
        );
        if (nonProcessedFiles.length > 0) {
          setOverallBatchProcessingProgress(0);
        } else {
          setOverallBatchProcessingProgress(100);
        }
      }
    } else {
      setOverallBatchProcessingProgress(0);
    }
  }, [batchUploads]);

  // Derived state for main progress bar display with real-time updates
  const currentProgressBarPercentage = useMemo(() => {
    if (isUploading && overallUploadProgress < 100) {
      return overallUploadProgress;
    }
    const hasProcessingFiles = batchUploads.some(
      (upload) => upload.status === 'processing' || upload.status === 'batch_processing'
    );
    if (hasProcessingFiles) {
      return overallBatchProcessingProgress;
    }
    if (documentData && (processingStatus?.status === 'processing' || processingStatus?.status === 'batch_processing')) {
      return progressPercentage;
    }
    // Show 100% when processing is complete
    if (documentData && processingStatus?.status === 'processed') {
      return 100;
    }
    return 0;
  }, [isUploading, overallUploadProgress, batchUploads, overallBatchProcessingProgress, documentData, processingStatus, progressPercentage]);

  const currentProgressBarText = useMemo(() => {
    if (isUploading && overallUploadProgress < 100) {
      return `Uploading Documents... (${Math.round(overallUploadProgress)}%)`;
    }
    const processingCount = batchUploads.filter(
      (upload) => upload.status === 'processing' || upload.status === 'batch_processing'
    ).length;
    if (processingCount > 0) {
      return `Processing ${processingCount} document${
        processingCount > 1 ? 's' : ''
      }... (${Math.round(overallBatchProcessingProgress)}%)`;
    }
    if (documentData && (processingStatus?.status === 'processing' || processingStatus?.status === 'batch_processing')) {
      return `${
        processingStatus?.current_operation ||
        (processingStatus?.status === 'batch_processing' ? 'Batch Processing...' : 'Processing document...')
      } (${Math.round(progressPercentage)}%)`;
    }
    // Show "Done" only when progress is exactly 100% (after animation completes)
    if (documentData && processingStatus?.status === 'processed' && progressPercentage >= 100) {
      return 'Done';
    }
    return '';
  }, [
    isUploading,
    overallUploadProgress,
    batchUploads,
    overallBatchProcessingProgress,
    documentData,
    processingStatus,
    progressPercentage,
  ]);

  const showMainProgressBar = useMemo(() => {
    return (
      (isUploading && overallUploadProgress < 100) ||
      batchUploads.some((upload) => upload.status === 'processing' || upload.status === 'batch_processing') ||
      (documentData &&
        (processingStatus?.status === 'processing' || processingStatus?.status === 'batch_processing')) ||
      (documentData && processingStatus?.status === 'processed' && progressPercentage < 100)
    );
  }, [isUploading, overallUploadProgress, batchUploads, processingStatus, documentData, progressPercentage]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // Enhanced Markdown Components
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

  // Function to get proper placeholder text based on current state
  const getInputPlaceholder = () => {
    if (isSecretPromptSelected) {
      return `Analysis : ${activeDropdown}...`;
    }
    if (!fileId) {
      return 'Upload a document to get started';
    }
    // Check if document is still processing
    // Only show processing message if actively processing (has status, not processed, and progress < 100)
    if (processingStatus?.status && processingStatus.status !== 'processed' && progressPercentage < 100) {
      return `${processingStatus.current_operation || 'Processing document...'} (${Math.round(progressPercentage)}%)`;
    }
    return showSplitView ? 'Ask a question...' : 'Message Legal Assistant...';
  };

  return (
    <div className="flex flex-col lg:flex-row h-[90vh] bg-white overflow-hidden">
      {/* Real-time Progress Panel */}
      {/* <RealTimeProgressPanel processingStatus={processingStatus} /> */}
      {/* Error Messages */}
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
      {/* Success Messages */}
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
      {/* Insufficient Funds Alert */}
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
      {/* Conditional Rendering */}
      {!showSplitView ? (
        // Single Page View with bottom panel
        <div className="flex flex-col h-full w-full">
          {/* Top Content Area */}
          <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8 overflow-y-auto">
            <div className="text-center max-w-2xl mb-8 sm:mb-12">
              <h3 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-3 sm:mb-4 text-gray-900">Welcome to Smart Legal Insights</h3>
              <p className="text-gray-600 text-base sm:text-lg lg:text-xl leading-relaxed">
                Upload a legal document or ask a question to begin your AI-powered analysis.
              </p>
            </div>
            <div className="w-full max-w-4xl">
            {showMainProgressBar && (
              <div className="mt-3">
                <div className="text-center">
                  <div className="inline-flex items-center px-3 py-1.5 bg-[#E0F7F6] text-[#21C1B6] rounded-full text-sm">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    {currentProgressBarText}
                  </div>
                  <div 
                    className="w-full bg-gray-200 rounded-full h-2 mt-2 relative overflow-hidden cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => setShowProgressPopup(!showProgressPopup)}
                    title="Click to view detailed progress"
                  >
                    <div
                      className={`h-2 rounded-full transition-all duration-300 relative overflow-hidden bg-gradient-to-r ${getStageColor(
                        currentProgressBarPercentage
                      )}`}
                      style={{ width: `${currentProgressBarPercentage}%` }}
                    >
                      <div className="absolute inset-0 bg-white/20 animate-shimmer"></div>
                    </div>
                  </div>
                </div>
                {/* Inline Progress Popup */}
                <ProgressStagesPopup
                  isOpen={showProgressPopup}
                  onClose={() => setShowProgressPopup(false)}
                  processingStatus={processingStatus}
                  progressPercentage={progressPercentage}
                  documentName={documentData?.originalName || 'Document'}
                />
              </div>
            )}
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
                  {processingStatus && (
                    <div
                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                        processingStatus.status === 'processed'
                          ? 'bg-green-100 text-green-800'
                          : processingStatus.status === 'processing' || processingStatus.status === 'batch_processing'
                          ? 'bg-[#E0F7F6] text-[#21C1B6]'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {getStatusDisplayText(processingStatus.status, progressPercentage)}
                    </div>
                  )}
                </div>
              </div>
            )}
            <form onSubmit={handleSend} className="mx-auto mt-4">
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3 bg-gray-50 rounded-xl px-3 sm:px-5 py-4 sm:py-6 focus-within:border-[#21C1B6] focus-within:bg-white focus-within:shadow-sm analysis-input-container">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
                  title="Upload Document"
                >
                  {isUploading ? <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin" /> : <Paperclip className="h-4 w-4 sm:h-5 sm:w-5" />}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.tiff"
                  onChange={handleFileUpload}
                  disabled={isUploading}
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
                <div className="relative flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowToolsDropdown(!showToolsDropdown)}
                    disabled={isLoading || isGeneratingInsights || !fileId}
                    className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Tools"
                  >
                    <Wrench className="h-3 w-3 sm:h-4 sm:w-4" />
                    <span className="hidden sm:inline">Tools</span>
                    <ChevronDown className="h-3 w-3 sm:h-4 sm:w-4" />
                  </button>
                  {showToolsDropdown && (
                    <div className="absolute bottom-full left-0 mb-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20">
                      <button
                        type="button"
                        onClick={() => {
                          setShowMindmap(true);
                          setShowToolsDropdown(false);
                          setShowSplitView(true);
                          setSelectedMindmapMessageId('mindmap');
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg flex items-center space-x-2"
                      >
                        <Network className="h-4 w-4" />
                        <span>Mindmap</span>
                      </button>
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
          </div>
          </div>
         
          {/* Bottom Static Questions Panel */}
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


        // Split View
        <>
          {/* Left Panel */}
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
              setProcessingStatus={setProcessingStatus}
              setProgressPercentage={setProgressPercentage}
              startProcessingStatusPolling={startProcessingStatusPolling}
              formatFileSize={formatFileSize}
              getStatusDisplayText={getStatusDisplayText}
              getStageColor={getStageColor}
              onProgressBarClick={() => setShowProgressPopup(true)}
            />
            {/* Inline Progress Popup for Split View */}
            {showProgressPopup && (
              <div className="px-3 pb-2">
                <ProgressStagesPopup
                  isOpen={showProgressPopup}
                  onClose={() => setShowProgressPopup(false)}
                  processingStatus={processingStatus}
                  progressPercentage={progressPercentage}
                  documentName={documentData?.originalName || 'Document'}
                />
              </div>
            )}
            
            {/* Mindmap Container */}
            <div className="flex-1 overflow-y-auto px-3 py-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-gray-100 [&::-webkit-scrollbar-thumb]:bg-gray-300">
              <div className="space-y-1.5">
                <MindmapContainer
                  fileId={fileId}
                  sessionId={sessionId}
                  uploadedDocuments={uploadedDocuments}
                  apiBaseUrl={API_BASE_URL}
                  getAuthToken={getAuthToken}
                  showMindmap={showMindmap}
                  setShowMindmap={setShowMindmap}
                  selectedMindmapMessageId={selectedMindmapMessageId}
                  setSelectedMindmapMessageId={setSelectedMindmapMessageId}
                  mindmapData={mindmapData}
                  setMindmapData={setMindmapData}
                  isGeneratingMindmap={isGeneratingMindmap}
                  setIsGeneratingMindmap={setIsGeneratingMindmap}
                  mindmapError={mindmapError}
                  setMindmapError={setMindmapError}
                  onMindmapItemClick={() => {
                    setSelectedMessageId(null);
                  }}
                />
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
                    {processingStatus && (
                      <div
                        className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${
                          processingStatus.status === 'processed' && progressPercentage >= 100
                            ? 'bg-green-100 text-green-800'
                            : processingStatus.status === 'processing' || processingStatus.status === 'batch_processing'
                            ? 'bg-[#E0F7F6] text-[#21C1B6]'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {getStatusDisplayText(processingStatus.status, progressPercentage)}
                      </div>
                    )}
                  </div>
                </div>
              )}
              <form onSubmit={handleSend}>
                <div className="flex items-center space-x-1.5 bg-gray-50 rounded-xl px-2.5 py-2 focus-within:border-[#21C1B6] focus-within:bg-white focus-within:shadow-sm analysis-input-container">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
                    title="Upload Document"
                  >
                    {isUploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.tiff"
                    onChange={handleFileUpload}
                    disabled={isUploading}
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
                  <div className="relative flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowToolsDropdown(!showToolsDropdown)}
                      disabled={isLoading || isGeneratingInsights || !fileId}
                      className="flex items-center space-x-1 px-2 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Tools"
                    >
                      <Wrench className="h-3 w-3" />
                      <span>Tools</span>
                      <ChevronDown className="h-3 w-3" />
                    </button>
                    {showToolsDropdown && (
                      <div className="absolute bottom-full left-0 mb-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20">
                        <button
                          type="button"
                          onClick={() => {
                            setShowMindmap(true);
                            setShowToolsDropdown(false);
                            setSelectedMindmapMessageId('mindmap');
                            setSelectedMessageId(null);
                          }}
                          className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg flex items-center space-x-2"
                        >
                          <Network className="h-4 w-4" />
                          <span>Mindmap</span>
                        </button>
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
            </div>
          </div>

          {/* Right Panel */}
          <div className="w-full lg:w-3/5 flex flex-col h-2/3 lg:h-full bg-gray-50">
            <div className="flex-1 p-2 sm:p-4 min-h-0">
              <div className="h-full">
                {showMindmap && selectedMindmapMessageId === 'mindmap' ? (
                  <MindmapViewer 
                    mindmapData={mindmapData} 
                    apiBaseUrl={API_BASE_URL}
                    getAuthToken={getAuthToken}
                  />
                ) : (
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
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AnalysisPage;

