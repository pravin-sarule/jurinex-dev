// import React, { useState, useEffect, useContext, useRef } from 'react';
// import { FileManagerContext } from '../context/FileManagerContext';
// import ChatSessionList from './ChatInterface/ChatSessionList';
// import ChatMessage from './ChatInterface/ChatMessage';
// import ChatInput from './ChatInterface/ChatInput';
// import ApiService from '../services/api';
// import { BookOpen, ChevronDown, MessageSquare, Loader2 } from 'lucide-react';
// import ReactMarkdown from 'react-markdown';
// import remarkGfm from 'remark-gfm';

// const DocumentChatView = () => {
//   const { selectedFolder, chatSessions, setChatSessions, selectedChatSessionId, setSelectedChatSessionId } = useContext(FileManagerContext);
//   const [loadingSessions, setLoadingSessions] = useState(false);
//   const [sessionsError, setSessionsError] = useState(null);
//   const [currentChatHistory, setCurrentChatHistory] = useState([]);
//   const [loadingChat, setLoadingChat] = useState(false);
//   const [chatError, setChatError] = useState(null);
//   const [activeDropdown, setActiveDropdown] = useState('Custom Query');
//   const [showDropdown, setShowDropdown] = useState(false);
//   const [secrets, setSecrets] = useState([]);
//   const [isLoadingSecrets, setIsLoadingSecrets] = useState(false);
//   const [selectedSecretId, setSelectedSecretId] = useState(null);
//   const [isSecretPromptSelected, setIsSecretPromptSelected] = useState(false);
//   const [currentResponse, setCurrentResponse] = useState('');
//   const [animatedResponseContent, setAnimatedResponseContent] = useState('');
//   const [isAnimatingResponse, setIsAnimatingResponse] = useState(false);
//   const [selectedMessageId, setSelectedMessageId] = useState(null);

//   const dropdownRef = useRef(null);
//   const responseRef = useRef(null);

//   const fetchChatSessions = async () => {
//     if (!selectedFolder) {
//       setChatSessions([]);
//       return;
//     }
//     setLoadingSessions(true);
//     setSessionsError(null);
//     try {
//       const data = await ApiService.getFolderChatSessions(selectedFolder);
//       setChatSessions(data.sessions);
//     } catch (err) {
//       setSessionsError('Failed to fetch chat sessions.');
//       console.error('Error fetching chat sessions:', err);
//     } finally {
//       setLoadingSessions(false);
//     }
//   };

//   const fetchChatHistory = async (sessionId) => {
//     if (!selectedFolder || !sessionId) {
//       setCurrentChatHistory([]);
//       return;
//     }
//     setLoadingChat(true);
//     setChatError(null);
//     try {
//       const data = await ApiService.getFolderChatSessionById(selectedFolder, sessionId);
//       const chatHistory = Array.isArray(data.chatHistory) ? data.chatHistory : [];
//       setCurrentChatHistory(chatHistory);
//       // Set the latest message as the current response for display in the right panel
//       if (chatHistory.length > 0) {
//         const latestMessage = chatHistory[chatHistory.length - 1];
//         setCurrentResponse(latestMessage.response || latestMessage.message || '');
//         setAnimatedResponseContent(latestMessage.response || latestMessage.message || '');
//         setSelectedMessageId(latestMessage.id);
//       } else {
//         setCurrentResponse('');
//         setAnimatedResponseContent('');
//         setSelectedMessageId(null);
//       }
//     } catch (err) {
//       setChatError('Failed to fetch chat history.');
//       console.error('Error fetching chat history:', err);
//       setCurrentChatHistory([]); // Ensure history is cleared on error
//     } finally {
//       setLoadingChat(false);
//     }
//   };

//   const getAuthToken = () => {
//     const tokenKeys = [
//       'authToken', 'token', 'accessToken', 'jwt', 'bearerToken',
//       'auth_token', 'access_token', 'api_token', 'userToken'
//     ];
//     for (const key of tokenKeys) {
//       const token = localStorage.getItem(key);
//       if (token) {
//         return token;
//       }
//     }
//     return null;
//   };

//   const API_BASE_URL = 'http://localhost:5000'; // Assuming this is consistent

//   const fetchSecrets = async () => {
//     try {
//       setIsLoadingSecrets(true);
//       setChatError(null);
//       const token = getAuthToken();
//       const headers = { 'Content-Type': 'application/json' };
//       if (token) { headers['Authorization'] = `Bearer ${token}`; }

//       const response = await fetch(`${API_BASE_URL}/files/secrets?fetch=true`, {
//         method: 'GET',
//         headers,
//       });

//       if (!response.ok) {
//         throw new Error(`Failed to fetch secrets: ${response.status}`);
//       }
//       const secretsData = await response.json();
//       setSecrets(secretsData || []);
//       if (secretsData && secretsData.length > 0) {
//         setActiveDropdown(secretsData[0].name);
//         setSelectedSecretId(secretsData[0].id);
//       }
//     } catch (error) {
//       console.error('Error fetching secrets:', error);
//       setChatError(`Failed to load analysis prompts: ${error.message}`);
//     } finally {
//       setIsLoadingSecrets(false);
//     }
//   };

//   const fetchSecretValue = async (secretId) => {
//     try {
//       const existingSecret = secrets.find(secret => secret.id === secretId);
//       if (existingSecret && existingSecret.value) {
//         return existingSecret.value;
//       }
//       const token = getAuthToken();
//       const headers = { 'Content-Type': 'application/json' };
//       if (token) { headers['Authorization'] = `Bearer ${token}`; }

//       const response = await fetch(`${API_BASE_URL}/files/secrets/${secretId}`, {
//         method: 'GET',
//         headers,
//       });
//       if (!response.ok) {
//         throw new Error(`Failed to fetch secret value: ${response.status}`);
//       }
//       const secretData = await response.json();
//       const promptValue = secretData.value || secretData.prompt || secretData.content || secretData;
//       setSecrets(prevSecrets =>
//         prevSecrets.map(secret =>
//           secret.id === secretId
//             ? { ...secret, value: promptValue }
//             : secret
//         )
//       );
//       return promptValue || '';
//     } catch (error) {
//       console.error('Error fetching secret value:', error);
//       throw new Error('Failed to retrieve analysis prompt');
//     }
//   };

//   useEffect(() => {
//     if (selectedFolder && selectedFolder !== 'Test') {
//       fetchChatSessions();
//     } else {
//       setChatSessions([]);
//     }
//     setCurrentChatHistory([]);
//     setSelectedChatSessionId(null);
//   }, [selectedFolder, setChatSessions, setSelectedChatSessionId]);

//   useEffect(() => {
//     fetchSecrets();
//   }, []);

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
//     if (selectedFolder && selectedFolder !== 'Test' && selectedChatSessionId) {
//       fetchChatHistory(selectedChatSessionId);
//     } else {
//       setCurrentChatHistory([]);
//     }
//   }, [selectedFolder, selectedChatSessionId]);

//   const animateResponse = (text) => {
//     setAnimatedResponseContent('');
//     setIsAnimatingResponse(true);
//     let i = 0;
//     const interval = setInterval(() => {
//       if (i < text.length) {
//         setAnimatedResponseContent(prev => prev + text.charAt(i));
//         i++;
//         if (responseRef.current) {
//           responseRef.current.scrollTop = responseRef.current.scrollHeight;
//         }
//       } else {
//         clearInterval(interval);
//         setIsAnimatingResponse(false);
//       }
//     }, 20);
//     return interval;
//   };

//   const handleNewMessage = async (message, isSecretPrompt = false) => {
//     setLoadingChat(true);
//     setChatError(null);

//     const TEST_KEYWORD = '/test';
//     const isTestMode = message.startsWith(TEST_KEYWORD);
//     let processedMessage = message;
//     if (isTestMode) {
//       processedMessage = message.substring(TEST_KEYWORD.length).trim();
//     }

//     if (!selectedFolder && !isTestMode) {
//       alert('Please select a folder first, or use /test for a global query.');
//       setLoadingChat(false);
//       return;
//     }

//     try {
//       let response;
//       if (isSecretPrompt && selectedSecretId) {
//         const selectedSecret = secrets.find(s => s.id === selectedSecretId);
//         let promptValue = selectedSecret?.value;
//         const promptLabel = selectedSecret?.name || 'Analysis Prompt';

//         if (!promptValue) {
//           promptValue = await fetchSecretValue(selectedSecretId);
//         }
//         if (!promptValue) {
//           throw new Error('Secret prompt value is empty.');
//         }

//         response = await ApiService.queryFolderDocumentsWithSecret(
//           selectedFolder,
//           promptValue,
//           promptLabel,
//           selectedChatSessionId
//         );
//         if (!selectedChatSessionId && response.sessionId) {
//           setSelectedChatSessionId(response.sessionId);
//         }
//         const chatHistorySecret = Array.isArray(response.chatHistory) ? response.chatHistory : [];
//         setCurrentChatHistory(chatHistorySecret);
//         const latestMessageSecret = chatHistorySecret[chatHistorySecret.length - 1];
//         setCurrentResponse(latestMessageSecret?.response || latestMessageSecret?.message || '');
//         animateResponse(latestMessageSecret?.response || latestMessageSecret?.message || '');
//         setSelectedMessageId(latestMessageSecret?.id);

//       } else if (isTestMode) {
//         response = await ApiService.queryTestDocuments(processedMessage, selectedChatSessionId);
//         if (!selectedChatSessionId && response.sessionId) {
//           setSelectedChatSessionId(response.sessionId);
//         }
//         const chatHistoryTest = Array.isArray(response.chatHistory) ? response.chatHistory : [];
//         if (chatHistoryTest.length > 0) {
//           setCurrentChatHistory(chatHistoryTest);
//           const latestMessageTest = chatHistoryTest[chatHistoryTest.length - 1];
//           setCurrentResponse(latestMessageTest?.response || latestMessageTest?.message || '');
//           animateResponse(latestMessageTest?.response || latestMessageTest?.message || '');
//           setSelectedMessageId(latestMessageTest?.id);
//         } else if (response.message) {
//           setCurrentChatHistory([{ sender: 'AI', message: response.message }]);
//           setCurrentResponse(response.message);
//           animateResponse(response.message);
//           setSelectedMessageId(null); // No specific ID for a simple message
//         } else {
//           const stringifiedResponse = JSON.stringify(response);
//           setCurrentChatHistory([{ sender: 'AI', message: stringifiedResponse }]);
//           setCurrentResponse(stringifiedResponse);
//           animateResponse(stringifiedResponse);
//           setSelectedMessageId(null);
//         }

//       } else if (selectedChatSessionId) {
//         response = await ApiService.continueFolderChat(selectedFolder, selectedChatSessionId, processedMessage);
//         const chatHistoryContinue = Array.isArray(response.chatHistory) ? response.chatHistory : [];
//         setCurrentChatHistory(chatHistoryContinue);
//         const latestMessageContinue = chatHistoryContinue[chatHistoryContinue.length - 1];
//         setCurrentResponse(latestMessageContinue?.response || latestMessageContinue?.message || '');
//         animateResponse(latestMessageContinue?.response || latestMessageContinue?.message || '');
//         setSelectedMessageId(latestMessageContinue?.id);

//       } else {
//         response = await ApiService.queryFolderDocuments(selectedFolder, processedMessage);
//         if (response.sessionId) {
//           setSelectedChatSessionId(response.sessionId);
//         }
//         const chatHistoryQuery = Array.isArray(response.chatHistory) ? response.chatHistory : [];
//         setCurrentChatHistory(chatHistoryQuery);
//         const latestMessageQuery = chatHistoryQuery[chatHistoryQuery.length - 1];
//         setCurrentResponse(latestMessageQuery?.response || latestMessageQuery?.message || '');
//         animateResponse(latestMessageQuery?.response || latestMessageQuery?.message || '');
//         setSelectedMessageId(latestMessageQuery?.id);
//       }

//       if (!isTestMode) {
//         fetchChatSessions();
//       }
//     } catch (err) {
//       setChatError(`Failed to send message: ${err.response?.data?.details || err.message}`);
//     } finally {
//       setLoadingChat(false);
//       setIsSecretPromptSelected(false);
//       setActiveDropdown('Custom Query');
//     }
//   };

//   const handleDeleteSession = async (sessionId) => {
//     if (window.confirm('Are you sure you want to delete this chat session?')) {
//       try {
//         await ApiService.deleteFolderChatSession(selectedFolder, sessionId);
//         fetchChatSessions();
//         if (selectedChatSessionId === sessionId) {
//           setSelectedChatSessionId(null);
//           setCurrentChatHistory([]);
//           setCurrentResponse('');
//           setAnimatedResponseContent('');
//           setSelectedMessageId(null);
//         }
//       } catch (err) {
//         setChatError(`Failed to delete session: ${err.response?.data?.details || err.message}`);
//       }
//     }
//   };

//   const handleSelectChatSession = (sessionId) => {
//     setSelectedChatSessionId(sessionId);
//   };

//   const handleMessageClick = (message) => {
//     setSelectedMessageId(message.id);
//     setCurrentResponse(message.message);
//     setAnimatedResponseContent(message.message);
//     setIsAnimatingResponse(false);
//   };

//   return (
//     <div className="flex h-full bg-white text-gray-800 rounded-lg shadow-lg">
//       {/* Left Panel - Chat Sessions and History */}
//       <div className="w-1/2 border-r border-gray-200 flex flex-col">
//         <div className="p-4 border-b border-gray-200">
//           <h3 className="text-lg font-semibold mb-4">Chat Sessions</h3>
//           {loadingSessions ? (
//             <div>Loading sessions...</div>
//           ) : sessionsError ? (
//             <div className="text-red-500">Error: {sessionsError}</div>
//           ) : (
//             <ChatSessionList
//               sessions={chatSessions}
//               selectedSessionId={selectedChatSessionId}
//               onSelectSession={handleSelectChatSession}
//               onDeleteSession={handleDeleteSession}
//             />
//           )}
//         </div>
//         <div className="flex-1 overflow-y-auto p-4">
//           {loadingChat ? (
//             <div>Loading chat history...</div>
//           ) : chatError ? (
//             <div className="text-red-500">Error: {chatError}</div>
//           ) : currentChatHistory.length === 0 ? (
//             <div className="text-center py-8">
//               <MessageSquare className="h-12 w-12 mx-auto mb-3 text-gray-300" />
//               <p className="text-gray-500 text-sm">No messages yet</p>
//               <p className="text-gray-400 text-xs">Start by asking a question</p>
//             </div>
//           ) : (
//             <div className="space-y-2">
//               {currentChatHistory.map((msg, index) => (
//                 <div
//                   key={msg.id || index}
//                   onClick={() => handleMessageClick(msg)}
//                   className={`p-3 rounded-lg border cursor-pointer transition-all duration-200 hover:shadow-md ${
//                     selectedMessageId === msg.id
//                       ? 'bg-blue-50 border-blue-200 shadow-sm'
//                       : 'bg-white border-gray-200 hover:bg-gray-50'
//                   }`}
//                 >
//                   <p className="text-sm font-medium text-gray-900 mb-1 line-clamp-2">
//                     {msg.question}
//                   </p>
//                   <span className="text-xs text-gray-500">
//                     {new Date(msg.timestamp).toLocaleString()}
//                   </span>
//                 </div>
//               ))}
//             </div>
//           )}
//         </div>
//         <div className="p-4 border-t border-gray-200">
//           <ChatInput
//             onSendMessage={handleNewMessage}
//             disabled={!selectedFolder}
//             activeDropdown={activeDropdown}
//             setActiveDropdown={setActiveDropdown}
//             showDropdown={showDropdown}
//             setShowDropdown={setShowDropdown}
//             secrets={secrets}
//             isLoadingSecrets={isLoadingSecrets}
//             selectedSecretId={selectedSecretId}
//             handleDropdownSelect={handleDropdownSelect}
//             isSecretPromptSelected={isSecretPromptSelected}
//             setIsSecretPromptSelected={setIsSecretPromptSelected}
//             handleChatInputChange={handleChatInputChange}
//             dropdownRef={dropdownRef}
//           />
//         </div>
//       </div>

//       {/* Right Panel - AI Response */}
//       <div className="w-1/2 flex flex-col">
//         <div className="flex-1 overflow-y-auto p-6" ref={responseRef}>
//           {selectedMessageId && (currentResponse || animatedResponseContent) ? (
//             <div className="max-w-none">
//               <div className="mb-6 pb-4 border-b border-gray-200">
//                 <h2 className="text-xl font-semibold text-gray-900">AI Response</h2>
//                 <div className="mt-3 p-3 bg-blue-50 rounded-lg border-l-4 border-blue-400">
//                   <p className="text-sm font-medium text-blue-900 mb-1">Question:</p>
//                   <p className="text-sm text-blue-800">
//                     {currentChatHistory.find(msg => msg.id === selectedMessageId)?.question || 'No question available'}
//                   </p>
//                 </div>
//               </div>
//               <div className="prose prose-gray max-w-none custom-markdown-renderer">
//                 <ReactMarkdown
//                   remarkPlugins={[remarkGfm]}
//                   children={animatedResponseContent || currentResponse || ''}
//                   components={{
//                     h1: ({node, ...props}) => <h1 className="text-2xl font-bold mb-6 mt-8 text-black border-b-2 border-gray-300 pb-2" {...props} />,
//                     h2: ({node, ...props}) => <h2 className="text-xl font-bold mb-4 mt-6 text-black" {...props} />,
//                     h3: ({node, ...props}) => <h3 className="text-lg font-bold mb-3 mt-4 text-black" {...props} />,
//                     h4: ({node, ...props}) => <h4 className="text-base font-bold mb-2 mt-3 text-black" {...props} />,
//                     h5: ({node, ...props}) => <h5 className="text-base font-bold mb-2 mt-3 text-black" {...props} />,
//                     h6: ({node, ...props}) => <h6 className="text-base font-bold mb-2 mt-3 text-black" {...props} />,
//                     p: ({node, ...props}) => <p className="mb-4 leading-relaxed text-black text-justify" {...props} />,
//                     strong: ({node, ...props}) => <strong className="font-bold text-black" {...props} />,
//                     em: ({node, ...props}) => <em className="italic text-black" {...props} />,
//                     ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-4 text-black" {...props} />,
//                     ol: ({node, ...props}) => <ol className="list-decimal pl-5 mb-4 text-black" {...props} />,
//                     li: ({node, ...props}) => <li className="mb-2 leading-relaxed text-black" {...props} />,
//                     a: ({node, ...props}) => <a className="text-blue-600 hover:underline" {...props} />,
//                     blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-gray-300 pl-4 italic text-gray-700 my-4" {...props} />,
//                     code: ({node, inline, ...props}) => {
//                       const className = inline ? "bg-gray-100 px-1 py-0.5 rounded text-sm font-mono text-red-700" : "block bg-gray-100 p-4 rounded-md text-sm font-mono overflow-x-auto my-4 text-red-700";
//                       return <code className={className} {...props} />;
//                     },
//                     table: ({node, ...props}) => <div className="overflow-x-auto my-6"><table className="min-w-full border-collapse border border-gray-400" {...props} /></div>,
//                     thead: ({node, ...props}) => <thead className="bg-gray-100" {...props} />,
//                     th: ({node, ...props}) => <th className="border border-gray-400 px-4 py-3 text-left font-bold text-black" {...props} />,
//                     tbody: ({node, ...props}) => <tbody {...props} />,
//                     td: ({node, ...props}) => <td className="border border-gray-400 px-4 py-3 text-black" {...props} />,
//                     hr: ({node, ...props}) => <hr className="my-6 border-gray-400" {...props} />,
//                   }}
//                 />
//                 {isAnimatingResponse && (
//                   <span className="inline-block w-2 h-5 bg-gray-400 animate-pulse ml-1"></span>
//                 )}
//               </div>
//             </div>
//           ) : (
//             <div className="flex items-center justify-center h-full">
//               <div className="text-center max-w-md px-6">
//                 <MessageSquare className="h-16 w-16 mx-auto mb-6 text-gray-300" />
//                 <h3 className="text-2xl font-semibold mb-4 text-gray-900">Select a Question</h3>
//                 <p className="text-gray-600 text-lg leading-relaxed">
//                   Click on any question from the left panel to view the AI response here.
//                 </p>
//               </div>
//             </div>
//           )}
//         </div>
//       </div>
//     </div>
//   );
// };

// export default DocumentChatView;



import React, { useState, useEffect, useContext, useRef } from 'react';
import { FileManagerContext } from '../context/FileManagerContext';
import ChatSessionList from './ChatInterface/ChatSessionList';
import ChatMessage from './ChatInterface/ChatMessage';
import ChatInput from './ChatInterface/ChatInput';
import { convertJsonToPlainText } from '../utils/jsonToPlainText';
import ApiService from '../services/api';
import { BookOpen, ChevronDown, MessageSquare, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { convertJsonToPlainText } from '../utils/jsonToPlainText';

const DocumentChatView = () => {
  const { selectedFolder, chatSessions, setChatSessions, selectedChatSessionId, setSelectedChatSessionId } = useContext(FileManagerContext);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionsError, setSessionsError] = useState(null);
  const [currentChatHistory, setCurrentChatHistory] = useState([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [chatError, setChatError] = useState(null);
  const [activeDropdown, setActiveDropdown] = useState('Custom Query');
  const [showDropdown, setShowDropdown] = useState(false);
  const [secrets, setSecrets] = useState([]);
  const [isLoadingSecrets, setIsLoadingSecrets] = useState(false);
  const [selectedSecretId, setSelectedSecretId] = useState(null);
  const [isSecretPromptSelected, setIsSecretPromptSelected] = useState(false);
  const [currentResponse, setCurrentResponse] = useState('');
  const [animatedResponseContent, setAnimatedResponseContent] = useState('');
  const [isAnimatingResponse, setIsAnimatingResponse] = useState(false);
  const [selectedMessageId, setSelectedMessageId] = useState(null);

  const dropdownRef = useRef(null);
  const responseRef = useRef(null);

  const fetchChatSessions = async () => {
    if (!selectedFolder) {
      setChatSessions([]);
      return;
    }
    setLoadingSessions(true);
    setSessionsError(null);
    try {
      const data = await ApiService.getFolderChatSessions(selectedFolder);
      setChatSessions(data.sessions);
    } catch (err) {
      setSessionsError('Failed to fetch chat sessions.');
      console.error('Error fetching chat sessions:', err);
    } finally {
      setLoadingSessions(false);
    }
  };

  const fetchChatHistory = async (sessionId) => {
    if (!selectedFolder || !sessionId) {
      setCurrentChatHistory([]);
      return;
    }
    setLoadingChat(true);
    setChatError(null);
    try {
      const data = await ApiService.getFolderChatSessionById(selectedFolder, sessionId);
      const chatHistory = Array.isArray(data.chatHistory) ? data.chatHistory : [];
      setCurrentChatHistory(chatHistory);
      // Set the latest message as the current response for display in the right panel
      if (chatHistory.length > 0) {
        const latestMessage = chatHistory[chatHistory.length - 1];
        setCurrentResponse(latestMessage.response || latestMessage.message || '');
        setAnimatedResponseContent(latestMessage.response || latestMessage.message || '');
        setSelectedMessageId(latestMessage.id);
      } else {
        setCurrentResponse('');
        setAnimatedResponseContent('');
        setSelectedMessageId(null);
      }
    } catch (err) {
      setChatError('Failed to fetch chat history.');
      console.error('Error fetching chat history:', err);
      setCurrentChatHistory([]); // Ensure history is cleared on error
    } finally {
      setLoadingChat(false);
    }
  };

  const getAuthToken = () => {
    const tokenKeys = [
      'authToken', 'token', 'accessToken', 'jwt', 'bearerToken',
      'auth_token', 'access_token', 'api_token', 'userToken'
    ];
    for (const key of tokenKeys) {
      const token = localStorage.getItem(key);
      if (token) {
        return token;
      }
    }
    return null;
  };

  const API_BASE_URL = 'http://localhost:5000'; // Assuming this is consistent

  const fetchSecrets = async () => {
    try {
      setIsLoadingSecrets(true);
      setChatError(null);
      const token = getAuthToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) { headers['Authorization'] = `Bearer ${token}`; }

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
      setChatError(`Failed to load analysis prompts: ${error.message}`);
    } finally {
      setIsLoadingSecrets(false);
    }
  };

  const fetchSecretValue = async (secretId) => {
    try {
      const existingSecret = secrets.find(secret => secret.id === secretId);
      if (existingSecret && existingSecret.value) {
        return existingSecret.value;
      }
      const token = getAuthToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) { headers['Authorization'] = `Bearer ${token}`; }

      const response = await fetch(`${API_BASE_URL}/files/secrets/${secretId}`, {
        method: 'GET',
        headers,
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch secret value: ${response.status}`);
      }
      const secretData = await response.json();
      const promptValue = secretData.value || secretData.prompt || secretData.content || secretData;
      setSecrets(prevSecrets =>
        prevSecrets.map(secret =>
          secret.id === secretId
            ? { ...secret, value: promptValue }
            : secret
        )
      );
      return promptValue || '';
    } catch (error) {
      console.error('Error fetching secret value:', error);
      throw new Error('Failed to retrieve analysis prompt');
    }
  };

  useEffect(() => {
    if (selectedFolder && selectedFolder !== 'Test') {
      fetchChatSessions();
    } else {
      setChatSessions([]);
    }
    setCurrentChatHistory([]);
    setSelectedChatSessionId(null);
  }, [selectedFolder, setChatSessions, setSelectedChatSessionId]);

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

  useEffect(() => {
    if (selectedFolder && selectedFolder !== 'Test' && selectedChatSessionId) {
      fetchChatHistory(selectedChatSessionId);
    } else {
      setCurrentChatHistory([]);
    }
  }, [selectedFolder, selectedChatSessionId]);

  const animateResponse = (text) => {
    setAnimatedResponseContent('');
    setIsAnimatingResponse(true);
    let i = 0;
    const interval = setInterval(() => {
      if (i < text.length) {
        setAnimatedResponseContent(prev => prev + text.charAt(i));
        i++;
        if (responseRef.current) {
          responseRef.current.scrollTop = responseRef.current.scrollHeight;
        }
      } else {
        clearInterval(interval);
        setIsAnimatingResponse(false);
      }
    }, 20);
    return interval;
  };

  const handleNewMessage = async (message, isSecretPrompt = false) => {
    setLoadingChat(true);
    setChatError(null);

    const TEST_KEYWORD = '/test';
    const isTestMode = message.startsWith(TEST_KEYWORD);
    let processedMessage = message;
    if (isTestMode) {
      processedMessage = message.substring(TEST_KEYWORD.length).trim();
    }

    if (!selectedFolder && !isTestMode) {
      alert('Please select a folder first, or use /test for a global query.');
      setLoadingChat(false);
      return;
    }

    try {
      let response;
      if (isSecretPrompt && selectedSecretId) {
        const selectedSecret = secrets.find(s => s.id === selectedSecretId);
        let promptValue = selectedSecret?.value;
        const promptLabel = selectedSecret?.name || 'Analysis Prompt';

        if (!promptValue) {
          promptValue = await fetchSecretValue(selectedSecretId);
        }
        if (!promptValue) {
          throw new Error('Secret prompt value is empty.');
        }

        response = await ApiService.queryFolderDocumentsWithSecret(
          selectedFolder,
          promptValue,
          promptLabel,
          selectedChatSessionId
        );
        if (!selectedChatSessionId && response.sessionId) {
          setSelectedChatSessionId(response.sessionId);
        }
        const chatHistorySecret = Array.isArray(response.chatHistory) ? response.chatHistory : [];
        setCurrentChatHistory(chatHistorySecret);
        const latestMessageSecret = chatHistorySecret[chatHistorySecret.length - 1];
        setCurrentResponse(latestMessageSecret?.response || latestMessageSecret?.message || '');
        animateResponse(latestMessageSecret?.response || latestMessageSecret?.message || '');
        setSelectedMessageId(latestMessageSecret?.id);

      } else if (isTestMode) {
        response = await ApiService.queryTestDocuments(processedMessage, selectedChatSessionId);
        if (!selectedChatSessionId && response.sessionId) {
          setSelectedChatSessionId(response.sessionId);
        }
        const chatHistoryTest = Array.isArray(response.chatHistory) ? response.chatHistory : [];
        if (chatHistoryTest.length > 0) {
          setCurrentChatHistory(chatHistoryTest);
          const latestMessageTest = chatHistoryTest[chatHistoryTest.length - 1];
          setCurrentResponse(latestMessageTest?.response || latestMessageTest?.message || '');
          animateResponse(latestMessageTest?.response || latestMessageTest?.message || '');
          setSelectedMessageId(latestMessageTest?.id);
        } else if (response.message) {
          setCurrentChatHistory([{ sender: 'AI', message: response.message }]);
          setCurrentResponse(response.message);
          animateResponse(response.message);
          setSelectedMessageId(null); // No specific ID for a simple message
        } else {
          const stringifiedResponse = JSON.stringify(response);
          setCurrentChatHistory([{ sender: 'AI', message: stringifiedResponse }]);
          setCurrentResponse(stringifiedResponse);
          animateResponse(stringifiedResponse);
          setSelectedMessageId(null);
        }

      } else if (selectedChatSessionId) {
        response = await ApiService.continueFolderChat(selectedFolder, selectedChatSessionId, processedMessage);
        const chatHistoryContinue = Array.isArray(response.chatHistory) ? response.chatHistory : [];
        setCurrentChatHistory(chatHistoryContinue);
        const latestMessageContinue = chatHistoryContinue[chatHistoryContinue.length - 1];
        setCurrentResponse(latestMessageContinue?.response || latestMessageContinue?.message || '');
        animateResponse(latestMessageContinue?.response || latestMessageContinue?.message || '');
        setSelectedMessageId(latestMessageContinue?.id);

      } else {
        response = await ApiService.queryFolderDocuments(selectedFolder, processedMessage);
        if (response.sessionId) {
          setSelectedChatSessionId(response.sessionId);
        }
        const chatHistoryQuery = Array.isArray(response.chatHistory) ? response.chatHistory : [];
        setCurrentChatHistory(chatHistoryQuery);
        const latestMessageQuery = chatHistoryQuery[chatHistoryQuery.length - 1];
        setCurrentResponse(latestMessageQuery?.response || latestMessageQuery?.message || '');
        animateResponse(latestMessageQuery?.response || latestMessageQuery?.message || '');
        setSelectedMessageId(latestMessageQuery?.id);
      }

      if (!isTestMode) {
        fetchChatSessions();
      }
    } catch (err) {
      setChatError(`Failed to send message: ${err.response?.data?.details || err.message}`);
    } finally {
      setLoadingChat(false);
      setIsSecretPromptSelected(false);
      setActiveDropdown('Custom Query');
    }
  };

  const handleDeleteSession = async (sessionId) => {
    if (window.confirm('Are you sure you want to delete this chat session?')) {
      try {
        await ApiService.deleteFolderChatSession(selectedFolder, sessionId);
        fetchChatSessions();
        if (selectedChatSessionId === sessionId) {
          setSelectedChatSessionId(null);
          setCurrentChatHistory([]);
          setCurrentResponse('');
          setAnimatedResponseContent('');
          setSelectedMessageId(null);
        }
      } catch (err) {
        setChatError(`Failed to delete session: ${err.response?.data?.details || err.message}`);
      }
    }
  };

  const handleSelectChatSession = (sessionId) => {
    setSelectedChatSessionId(sessionId);
  };

  const handleMessageClick = (message) => {
    setSelectedMessageId(message.id);
    setCurrentResponse(message.message);
    setAnimatedResponseContent(message.message);
    setIsAnimatingResponse(false);
  };

  return (
    <div className="flex h-full bg-white text-gray-800 rounded-lg shadow-lg">
      {/* Left Panel - Chat Sessions and History */}
      <div className="w-1/2 border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold mb-4">Chat Sessions</h3>
          {loadingSessions ? (
            <div>Loading sessions...</div>
          ) : sessionsError ? (
            <div className="text-red-500">Error: {sessionsError}</div>
          ) : (
            <ChatSessionList
              sessions={chatSessions}
              selectedSessionId={selectedChatSessionId}
              onSelectSession={handleSelectChatSession}
              onDeleteSession={handleDeleteSession}
            />
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loadingChat ? (
            <div>Loading chat history...</div>
          ) : chatError ? (
            <div className="text-red-500">Error: {chatError}</div>
          ) : currentChatHistory.length === 0 ? (
            <div className="text-center py-8">
              <MessageSquare className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p className="text-gray-500 text-sm">No messages yet</p>
              <p className="text-gray-400 text-xs">Start by asking a question</p>
            </div>
          ) : (
            <div className="space-y-2">
              {currentChatHistory.map((msg, index) => (
                <div
                  key={msg.id || index}
                  onClick={() => handleMessageClick(msg)}
                  className={`p-3 rounded-lg border cursor-pointer transition-all duration-200 hover:shadow-md ${
                    selectedMessageId === msg.id
                      ? 'bg-blue-50 border-blue-200 shadow-sm'
                      : 'bg-white border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <p className="text-sm font-medium text-gray-900 mb-1 line-clamp-2">
                    {msg.question}
                  </p>
                  <span className="text-xs text-gray-500">
                    {new Date(msg.timestamp).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="p-4 border-t border-gray-200">
          <ChatInput
            onSendMessage={handleNewMessage}
            disabled={!selectedFolder}
            activeDropdown={activeDropdown}
            setActiveDropdown={setActiveDropdown}
            showDropdown={showDropdown}
            setShowDropdown={setShowDropdown}
            secrets={secrets}
            isLoadingSecrets={isLoadingSecrets}
            selectedSecretId={selectedSecretId}
            handleDropdownSelect={handleDropdownSelect}
            isSecretPromptSelected={isSecretPromptSelected}
            setIsSecretPromptSelected={setIsSecretPromptSelected}
            handleChatInputChange={handleChatInputChange}
            dropdownRef={dropdownRef}
          />
        </div>
      </div>

      {/* Right Panel - AI Response */}
      <div className="w-1/2 flex flex-col">
        <div className="flex-1 overflow-y-auto p-6" ref={responseRef}>
          {selectedMessageId && (currentResponse || animatedResponseContent) ? (
            <div className="max-w-none">
              <div className="mb-6 pb-4 border-b border-gray-200">
                <h2 className="text-xl font-semibold text-gray-900">AI Response</h2>
                <div className="mt-3 p-3 bg-blue-50 rounded-lg border-l-4 border-blue-400">
                  <p className="text-sm font-medium text-blue-900 mb-1">Question:</p>
                  <p className="text-sm text-blue-800">
                    {currentChatHistory.find(msg => msg.id === selectedMessageId)?.question || 'No question available'}
                  </p>
                </div>
              </div>
              <div className="prose prose-gray max-w-none custom-markdown-renderer">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  children={animatedResponseContent || currentResponse || ''}
                  components={{
                    h1: ({node, ...props}) => <h1 className="text-2xl font-bold mb-6 mt-8 text-black border-b-2 border-gray-300 pb-2" {...props} />,
                    h2: ({node, ...props}) => <h2 className="text-xl font-bold mb-4 mt-6 text-black" {...props} />,
                    h3: ({node, ...props}) => <h3 className="text-lg font-bold mb-3 mt-4 text-black" {...props} />,
                    h4: ({node, ...props}) => <h4 className="text-base font-bold mb-2 mt-3 text-black" {...props} />,
                    h5: ({node, ...props}) => <h5 className="text-base font-bold mb-2 mt-3 text-black" {...props} />,
                    h6: ({node, ...props}) => <h6 className="text-base font-bold mb-2 mt-3 text-black" {...props} />,
                    p: ({node, ...props}) => <p className="mb-4 leading-relaxed text-black text-justify" {...props} />,
                    strong: ({node, ...props}) => <strong className="font-bold text-black" {...props} />,
                    em: ({node, ...props}) => <em className="italic text-black" {...props} />,
                    ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-4 text-black" {...props} />,
                    ol: ({node, ...props}) => <ol className="list-decimal pl-5 mb-4 text-black" {...props} />,
                    li: ({node, ...props}) => <li className="mb-2 leading-relaxed text-black" {...props} />,
                    a: ({node, ...props}) => <a className="text-blue-600 hover:underline" {...props} />,
                    blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-gray-300 pl-4 italic text-gray-700 my-4" {...props} />,
                    code: ({node, inline, ...props}) => {
                      const className = inline ? "bg-gray-100 px-1 py-0.5 rounded text-sm font-mono text-red-700" : "block bg-gray-100 p-4 rounded-md text-sm font-mono overflow-x-auto my-4 text-red-700";
                      return <code className={className} {...props} />;
                    },
                    table: ({node, ...props}) => <div className="overflow-x-auto my-6"><table className="min-w-full border-collapse border border-gray-400" {...props} /></div>,
                    thead: ({node, ...props}) => <thead className="bg-gray-100" {...props} />,
                    th: ({node, ...props}) => <th className="border border-gray-400 px-4 py-3 text-left font-bold text-black" {...props} />,
                    tbody: ({node, ...props}) => <tbody {...props} />,
                    td: ({node, ...props}) => <td className="border border-gray-400 px-4 py-3 text-black" {...props} />,
                    hr: ({node, ...props}) => <hr className="my-6 border-gray-400" {...props} />,
                  }}
                />
                {isAnimatingResponse && (
                  <span className="inline-block w-2 h-5 bg-gray-400 animate-pulse ml-1"></span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-md px-6">
                <MessageSquare className="h-16 w-16 mx-auto mb-6 text-gray-300" />
                <h3 className="text-2xl font-semibold mb-4 text-gray-900">Select a Question</h3>
                <p className="text-gray-600 text-lg leading-relaxed">
                  Click on any question from the left panel to view the AI response here.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DocumentChatView;