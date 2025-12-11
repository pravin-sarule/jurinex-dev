
import React, { useState, useEffect, useContext, useRef, useMemo, useCallback, startTransition } from "react";
import { FileManagerContext } from "../../context/FileManagerContext";
import documentApi from "../../services/documentApi";
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

// Previous commented code below

// import React, { useState, useEffect, useContext, useRef } from "react";
// import { FileManagerContext } from "../../context/FileManagerContext";
// import documentApi from "../../services/documentApi";
// import apiService from "../../services/api";
// import {
//   BookOpen,
//   ChevronDown,
//   Send,
//   Loader2,
//   MessageSquare,
//   Search,
//   ChevronRight,
// } from "lucide-react";
// import ReactMarkdown from "react-markdown";
// import remarkGfm from "remark-gfm";
// import { SidebarContext } from "../../context/SidebarContext";
// import ChatCardList from "./ChatCardList"; // ✅ Card list

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
//   const [currentResponse, setCurrentResponse] = useState("");
//   const [animatedResponseContent, setAnimatedResponseContent] = useState("");
//   const [isAnimatingResponse, setIsAnimatingResponse] = useState(false);
//   const [selectedMessageId, setSelectedMessageId] = useState(null);
//   const [hasResponse, setHasResponse] = useState(false);
//   const [searchQuery, setSearchQuery] = useState("");

//   const responseRef = useRef(null);

//   // 🔹 Fetch chat history
//   const fetchChatHistory = async (sessionId) => {
//     if (!selectedFolder) return;

//     setLoadingChat(true);
//     setChatError(null);

//     try {
//       let data = await documentApi.getFolderChats(selectedFolder);
//       const chats = Array.isArray(data.chats) ? data.chats : [];
//       setCurrentChatHistory(chats);

//       if (sessionId) {
//         setSelectedChatSessionId(sessionId);
//         const selectedChat = chats.find((c) => c.id === sessionId);
//         if (selectedChat) {
//           const responseText =
//             selectedChat.response ||
//             selectedChat.answer ||
//             selectedChat.message ||
//             "";
//           setCurrentResponse(responseText);
//           setAnimatedResponseContent(responseText);
//           setSelectedMessageId(selectedChat.id);
//           setHasResponse(true);
//           setHasAiResponse(true);
//           setForceSidebarCollapsed(true);
//         } else if (selectedFolder === 'Test' && chats.length > 0) { // If Test folder has chats, enable input
//           setHasResponse(true);
//           setHasAiResponse(true);
//           setForceSidebarCollapsed(true);
//         }
//       } else {
//         setHasResponse(false);
//         setHasAiResponse(false);
//         setForceSidebarCollapsed(false);
//       }
//     } catch (err) {
//       console.error("❌ Error fetching chats:", err);
//       setChatError("Failed to fetch chat history.");
//     } finally {
//       setLoadingChat(false);
//     }
//   };

//   // 🔹 Animate typing effect
//   const animateResponse = (text) => {
//     setAnimatedResponseContent("");
//     setIsAnimatingResponse(true);
//     let i = 0;
//     const interval = setInterval(() => {
//       if (i < text.length) {
//         setAnimatedResponseContent((prev) => prev + text.charAt(i));
//         i++;
//         if (responseRef.current) {
//           responseRef.current.scrollTop = responseRef.current.scrollHeight;
//         }
//       } else {
//         clearInterval(interval);
//         setIsAnimatingResponse(false);
//       }
//     }, 20);
//   };

//   // 🔹 Handle new message
//   const handleNewMessage = async () => {
//     if (!selectedFolder || !chatInput.trim()) return;

//     setLoadingChat(true);
//     setChatError(null);

//     try {
//       const response = await documentApi.queryFolderDocuments(
//         selectedFolder,
//         chatInput,
//         selectedChatSessionId
//       );

//       if (response.sessionId) {
//         setSelectedChatSessionId(response.sessionId);
//       }

//       const history = Array.isArray(response.chatHistory)
//         ? response.chatHistory
//         : [];
//       setCurrentChatHistory(history);

//       if (history.length > 0) {
//         const latestMessage = history[history.length - 1];
//         const responseText =
//           latestMessage.response ||
//           latestMessage.answer ||
//           latestMessage.message ||
//           "";
//         setCurrentResponse(responseText);
//         setSelectedMessageId(latestMessage.id);
//         setHasResponse(true);
//         setHasAiResponse(true);
//         setForceSidebarCollapsed(true);
//         animateResponse(responseText);
//       }
//       setChatInput("");
//     } catch (err) {
//       setChatError(
//         `Failed to send message: ${err.response?.data?.details || err.message}`
//       );
//     } finally {
//       setLoadingChat(false);
//     }
//   };

//   // 🔹 Handle selecting a chat from ChatCardList
//   const handleSelectChat = (chatId) => {
//     fetchChatHistory(chatId);
//   };

//   useEffect(() => {
//     setChatSessions([]);
//     setCurrentChatHistory([]);
//     setSelectedChatSessionId(null);
//     setHasResponse(false);
//     setHasAiResponse(false);
//     setForceSidebarCollapsed(false);

//     if (selectedFolder && selectedFolder !== 'Test') { // Only fetch history for non-Test folders here
//       fetchChatHistory();
//     }
//     // For 'Test' folder, ChatCardList will handle its own fetching
//   }, [selectedFolder]);

//   if (!selectedFolder) {
//     return (
//       <div className="flex items-center justify-center h-full text-gray-400 text-lg bg-[#FDFCFB]">
//         Select a folder to start chatting.
//       </div>
//     );
//   }

//   return (
//     <div className="flex h-full bg-white">
//       {/* Left panel */}
//       <div className="w-1/2 border-r border-gray-200 flex flex-col">
//         {/* Header */}
//         <div className="p-4 border-b border-gray-200">
//           <div className="flex justify-between items-center mb-4">
//             <h2 className="text-lg font-semibold text-gray-900">Chats</h2>
//             <button
//               type="button"
//               onClick={() => {
//                 setCurrentChatHistory([]);
//                 setSelectedChatSessionId(null);
//                 setHasResponse(false);
//                 setHasAiResponse(false);
//                 setForceSidebarCollapsed(false);
//                 setChatInput("");
//               }}
//               className="flex items-center space-x-1 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
//             >
//               <MessageSquare className="h-4 w-4" />
//               <span>New Chat</span>
//             </button>
//           </div>

//           {/* Search bar */}
//           <div className="relative">
//             <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
//             <input
//               type="text"
//               placeholder="Search chats..."
//               value={searchQuery}
//               onChange={(e) => setSearchQuery(e.target.value)}
//               className="w-full pl-9 pr-3 py-2 bg-gray-100 rounded-lg text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
//             />
//           </div>
//         </div>

//         {/* Chat list */}
//         <div className="flex-1 overflow-y-auto px-4 py-2">
//           <ChatCardList
//             folderName={selectedFolder}
//             onSelectChat={handleSelectChat}
//           />
//         </div>

//         {/* Chat input */}
//         <div className="border-t border-gray-200 p-4">
//           <div className="flex items-center space-x-3 bg-gray-50 rounded-xl border border-gray-200 px-4 py-3">
//             <input
//               type="text"
//               value={chatInput}
//               onChange={(e) => setChatInput(e.target.value)}
//               placeholder="Ask a question..."
//               className="flex-1 bg-transparent border-none outline-none text-gray-900 placeholder-gray-500 text-sm font-medium"
//               disabled={loadingChat}
//             />
//             <button
//               type="button"
//               onClick={handleNewMessage}
//               disabled={loadingChat || !chatInput.trim()}
//               className="p-1.5 bg-black hover:bg-gray-800 disabled:bg-gray-300 text-white rounded-lg transition-colors"
//             >
//               {loadingChat ? (
//                 <Loader2 className="h-4 w-4 animate-spin" />
//               ) : (
//                 <Send className="h-4 w-4" />
//               )}
//             </button>
//           </div>
//           {chatError && (
//             <div className="mt-2 p-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
//               {chatError}
//             </div>
//           )}
//         </div>
//       </div>

//       {/* Right panel (AI response) */}
//       <div className="w-1/2 flex flex-col">
//         <div className="flex-1 overflow-y-auto p-6" ref={responseRef}>
//           {selectedMessageId && currentResponse ? (
//             <div className="max-w-none">
//               <div className="mb-6 pb-4 border-b border-gray-200">
//                 <h2 className="text-xl font-semibold text-gray-900">
//                   AI Response
//                 </h2>
//               </div>
//               <div className="prose prose-gray max-w-none">
//                 <ReactMarkdown
//                   remarkPlugins={[remarkGfm]}
//                   components={{
//                     h1: (props) => (
//                       <h1
//                         className="text-2xl font-bold mb-6 mt-8 text-black border-b-2 border-gray-300 pb-2"
//                         {...props}
//                       />
//                     ),
//                     h2: (props) => (
//                       <h2
//                         className="text-xl font-bold mb-4 mt-6 text-black"
//                         {...props}
//                       />
//                     ),
//                     p: (props) => (
//                       <p
//                         className="mb-4 leading-relaxed text-black text-justify"
//                         {...props}
//                       />
//                     ),
//                   }}
//                 >
//                   {animatedResponseContent || currentResponse}
//                 </ReactMarkdown>
//                 {isAnimatingResponse && (
//                   <span className="inline-block w-2 h-5 bg-gray-400 animate-pulse ml-1"></span>
//                 )}
//               </div>
//             </div>
//           ) : (
//             <div className="flex items-center justify-center h-full">
//               <div className="text-center max-w-md">
//                 <MessageSquare className="h-16 w-16 mx-auto mb-6 text-gray-300" />
//                 <h3 className="text-2xl font-semibold mb-4 text-gray-900">
//                   {selectedFolder === 'Test' ? 'No chat selected' : 'Select a chat'}
//                 </h3>
//                 <p className="text-gray-600 text-lg">
//                   {selectedFolder === 'Test' ? 'Select a chat from the list on the left.' : 'Click a chat from the left to view the response.'}
//                 </p>
//               </div>
//             </div>
//           )}
//         </div>
//       </div>
//     </div>
//   );
// };

// export default ChatInterface;
// import React, { useState, useEffect, useContext, useRef } from "react";
// import { FileManagerContext } from "../../context/FileManagerContext";
// import documentApi from "../../services/documentApi";
// import {
//   Plus,
//   Shuffle,
//   Search,
//   BookOpen,
//   ChevronDown,
//   ChevronRight,
//   MoreVertical,
//   MessageSquare,
//   Loader2,
//   Send,
// } from "lucide-react";
// import ReactMarkdown from "react-markdown";
// import remarkGfm from "remark-gfm";
// import { SidebarContext } from "../../context/SidebarContext";

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
//   const [currentResponse, setCurrentResponse] = useState("");
//   const [animatedResponseContent, setAnimatedResponseContent] = useState("");
//   const [isAnimatingResponse, setIsAnimatingResponse] = useState(false);
//   const [selectedMessageId, setSelectedMessageId] = useState(null);
//   const [hasResponse, setHasResponse] = useState(false);

//   // Secret prompt states
//   const [secrets, setSecrets] = useState([]);
//   const [isLoadingSecrets, setIsLoadingSecrets] = useState(false);
//   const [selectedSecretId, setSelectedSecretId] = useState(null);
//   const [activeDropdown, setActiveDropdown] = useState("Summary");
//   const [showDropdown, setShowDropdown] = useState(false);
//   const [isSecretPromptSelected, setIsSecretPromptSelected] = useState(false);

//   const responseRef = useRef(null);
//   const dropdownRef = useRef(null);

//   // API Configuration
//   const API_BASE_URL = "https://gateway-service-120280829617.asia-south1.run.app";

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
//       if (token) {
//         return token;
//       }
//     }
//     return null;
//   };

//   // 🔹 Fetch secrets list
//   const fetchSecrets = async () => {
//     try {
//       setIsLoadingSecrets(true);
//       setChatError(null);

//       const token = getAuthToken();
//       const headers = {
//         "Content-Type": "application/json",
//       };

//       if (token) {
//         headers["Authorization"] = `Bearer ${token}`;
//       }

//       const response = await fetch(`${API_BASE_URL}/files/secrets?fetch=true`, {
//         method: "GET",
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
//       console.error("Error fetching secrets:", error);
//       setChatError(`Failed to load analysis prompts: ${error.message}`);
//     } finally {
//       setIsLoadingSecrets(false);
//     }
//   };

//   // 🔹 Fetch secret value by ID
//   const fetchSecretValue = async (secretId) => {
//     try {
//       const existingSecret = secrets.find((secret) => secret.id === secretId);
//       if (existingSecret && existingSecret.value) {
//         return existingSecret.value;
//       }

//       const token = getAuthToken();
//       const headers = {
//         "Content-Type": "application/json",
//       };

//       if (token) {
//         headers["Authorization"] = `Bearer ${token}`;
//       }

//       const response = await fetch(
//         `${API_BASE_URL}/files/secrets/${secretId}`,
//         {
//           method: "GET",
//           headers,
//         }
//       );

//       if (!response.ok) {
//         throw new Error(`Failed to fetch secret value: ${response.status}`);
//       }

//       const secretData = await response.json();
//       const promptValue =
//         secretData.value || secretData.prompt || secretData.content || secretData;

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

//   // 🔹 Fetch chat history
//   const fetchChatHistory = async (sessionId) => {
//     if (!selectedFolder) return;

//     setLoadingChat(true);
//     setChatError(null);

//     try {
//       let data = await documentApi.getFolderChats(selectedFolder);
//       const chats = Array.isArray(data.chats) ? data.chats : [];
//       setCurrentChatHistory(chats);

//       if (sessionId) {
//         setSelectedChatSessionId(sessionId);
//         const selectedChat = chats.find((c) => c.id === sessionId);
//         if (selectedChat) {
//           const responseText =
//             selectedChat.response ||
//             selectedChat.answer ||
//             selectedChat.message ||
//             "";
//           setCurrentResponse(responseText);
//           setAnimatedResponseContent(responseText);
//           setSelectedMessageId(selectedChat.id);
//           setHasResponse(true);
//           setHasAiResponse(true);
//           setForceSidebarCollapsed(true);
//         } else if (selectedFolder === "Test" && chats.length > 0) {
//           setHasResponse(true);
//           setHasAiResponse(true);
//           setForceSidebarCollapsed(true);
//         }
//       } else {
//         setHasResponse(false);
//         setHasAiResponse(false);
//         setForceSidebarCollapsed(false);
//       }
//     } catch (err) {
//       console.error("❌ Error fetching chats:", err);
//       setChatError("Failed to fetch chat history.");
//     } finally {
//       setLoadingChat(false);
//     }
//   };

//   // 🔹 Animate typing effect
//   const animateResponse = (text) => {
//     setAnimatedResponseContent("");
//     setIsAnimatingResponse(true);
//     let i = 0;
//     const interval = setInterval(() => {
//       if (i < text.length) {
//         setAnimatedResponseContent((prev) => prev + text.charAt(i));
//         i++;
//         if (responseRef.current) {
//           responseRef.current.scrollTop = responseRef.current.scrollHeight;
//         }
//       } else {
//         clearInterval(interval);
//         setIsAnimatingResponse(false);
//       }
//     }, 20);
//   };

//   // 🔹 Chat with AI using secret prompt
//   const chatWithAI = async (folder, secretId, currentSessionId) => {
//     try {
//       setLoadingChat(true);
//       setChatError(null);

//       const selectedSecret = secrets.find((s) => s.id === secretId);
//       if (!selectedSecret) {
//         throw new Error("No prompt found for selected analysis type");
//       }

//       let promptValue = selectedSecret.value;
//       const promptLabel = selectedSecret.name;

//       if (!promptValue) {
//         promptValue = await fetchSecretValue(secretId);
//       }

//       if (!promptValue) {
//         throw new Error("Secret prompt value is empty.");
//       }

//       const response = await documentApi.queryFolderDocuments(
//         folder,
//         promptValue,
//         currentSessionId,
//         {
//           used_secret_prompt: true,
//           prompt_label: promptLabel,
//         }
//       );

//       if (response.sessionId) {
//         setSelectedChatSessionId(response.sessionId);
//       }

//       const history = Array.isArray(response.chatHistory)
//         ? response.chatHistory
//         : [];
//       setCurrentChatHistory(history);

//       if (history.length > 0) {
//         const latestMessage = history[history.length - 1];
//         const responseText =
//           latestMessage.response ||
//           latestMessage.answer ||
//           latestMessage.message ||
//           "";
//         setCurrentResponse(responseText);
//         setSelectedMessageId(latestMessage.id);
//         setHasResponse(true);
//         setHasAiResponse(true);
//         setForceSidebarCollapsed(true);
//         animateResponse(responseText);
//       }

//       return response;
//     } catch (error) {
//       setChatError(`Analysis failed: ${error.message}`);
//       throw error;
//     } finally {
//       setLoadingChat(false);
//     }
//   };

//   // 🔹 Handle new message (combines regular chat and secret prompt)
//   const handleNewMessage = async () => {
//     if (!selectedFolder) return;

//     if (isSecretPromptSelected) {
//       if (!selectedSecretId) {
//         setChatError("Please select an analysis type.");
//         return;
//       }
//       try {
//         await chatWithAI(selectedFolder, selectedSecretId, selectedChatSessionId);
//         setChatInput("");
//       } catch (error) {
//         // Error already handled
//       }
//     } else {
//       if (!chatInput.trim()) return;

//       setLoadingChat(true);
//       setChatError(null);

//       try {
//         const response = await documentApi.queryFolderDocuments(
//           selectedFolder,
//           chatInput,
//           selectedChatSessionId
//         );

//         if (response.sessionId) {
//           setSelectedChatSessionId(response.sessionId);
//         }

//         const history = Array.isArray(response.chatHistory)
//           ? response.chatHistory
//           : [];
//         setCurrentChatHistory(history);

//         if (history.length > 0) {
//           const latestMessage = history[history.length - 1];
//           const responseText =
//             latestMessage.response ||
//             latestMessage.answer ||
//             latestMessage.message ||
//             "";
//           setCurrentResponse(responseText);
//           setSelectedMessageId(latestMessage.id);
//           setHasResponse(true);
//           setHasAiResponse(true);
//           setForceSidebarCollapsed(true);
//           animateResponse(responseText);
//         }
//         setChatInput("");
//       } catch (err) {
//         setChatError(
//           `Failed to send message: ${err.response?.data?.details || err.message}`
//         );
//       } finally {
//         setLoadingChat(false);
//       }
//     }
//   };

//   // 🔹 Handle selecting a chat
//   const handleSelectChat = (chatId) => {
//     fetchChatHistory(chatId);
//   };

//   // 🔹 Handle new chat
//   const handleNewChat = () => {
//     setCurrentChatHistory([]);
//     setSelectedChatSessionId(null);
//     setHasResponse(false);
//     setHasAiResponse(false);
//     setForceSidebarCollapsed(false);
//     setChatInput("");
//     setSelectedMessageId(null);
//     setCurrentResponse("");
//     setIsSecretPromptSelected(false);
//   };

//   // 🔹 Handle dropdown selection
//   const handleDropdownSelect = (secretName, secretId) => {
//     setActiveDropdown(secretName);
//     setSelectedSecretId(secretId);
//     setIsSecretPromptSelected(true);
//     setChatInput("");
//     setShowDropdown(false);
//   };

//   // 🔹 Handle custom input change
//   const handleChatInputChange = (e) => {
//     setChatInput(e.target.value);
//     setIsSecretPromptSelected(false);
//     setActiveDropdown("Custom Query");
//   };

//   // 🔹 Format relative time
//   const getRelativeTime = (dateString) => {
//     const date = new Date(dateString);
//     const now = new Date();
//     const diffInSeconds = Math.floor((now - date) / 1000);

//     if (diffInSeconds < 60) return `Last message ${diffInSeconds} seconds ago`;
//     if (diffInSeconds < 3600)
//       return `Last message ${Math.floor(diffInSeconds / 60)} minutes ago`;
//     if (diffInSeconds < 86400)
//       return `Last message ${Math.floor(diffInSeconds / 3600)} hours ago`;
//     return `Last message ${Math.floor(diffInSeconds / 86400)} days ago`;
//   };

//   // 🔹 Close dropdown when clicking outside
//   useEffect(() => {
//     const handleClickOutside = (event) => {
//       if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
//         setShowDropdown(false);
//       }
//     };

//     document.addEventListener("mousedown", handleClickOutside);
//     return () => {
//       document.removeEventListener("mousedown", handleClickOutside);
//     };
//   }, []);

//   // 🔹 Load secrets on mount
//   useEffect(() => {
//     fetchSecrets();
//   }, []);

//   useEffect(() => {
//     setChatSessions([]);
//     setCurrentChatHistory([]);
//     setSelectedChatSessionId(null);
//     setHasResponse(false);
//     setHasAiResponse(false);
//     setForceSidebarCollapsed(false);

//     if (selectedFolder && selectedFolder !== "Test") {
//       fetchChatHistory();
//     }
//   }, [selectedFolder]);

//   if (!selectedFolder) {
//     return (
//       <div className="flex items-center justify-center h-full text-gray-400 text-lg bg-[#FDFCFB]">
//         Select a folder to start chatting.
//       </div>
//     );
//   }

//   return (
//     <div className="h-full bg-[#FDFCFB] overflow-hidden">
//       <div className="mx-auto h-full flex flex-col py-6 px-4">
//         {/* Top Search/Input Card */}
//         <div className="mb-6 bg-white rounded-2xl shadow-sm border border-gray-200 p-5 flex-shrink-0">
//           <input
//             type="text"
//             placeholder="How can I help you today?"
//             value={chatInput}
//             onChange={handleChatInputChange}
//             onKeyPress={(e) => e.key === "Enter" && handleNewMessage()}
//             className="w-full text-base text-gray-700 placeholder-gray-400 outline-none bg-transparent mb-4"
//             disabled={loadingChat}
//           />

//           {/* Action Buttons Row */}
//           <div className="flex items-center justify-between">
//             <div className="flex items-center space-x-2">
//               <button
//                 onClick={handleNewChat}
//                 className="p-2.5 hover:bg-gray-100 rounded-lg transition-colors"
//                 title="New Chat"
//               >
//                 <Plus className="h-5 w-5 text-gray-600" />
//               </button>
//               <button className="p-2.5 hover:bg-gray-100 rounded-lg transition-colors">
//                 <Shuffle className="h-5 w-5 text-gray-600" />
//               </button>
//               <button className="flex items-center space-x-2 px-4 py-2.5 hover:bg-gray-100 rounded-lg transition-colors">
//                 <Search className="h-4 w-4 text-gray-600" />
//                 <span className="text-sm text-gray-700">Research</span>
//               </button>

//               {/* Analysis Dropdown */}
//               <div className="relative" ref={dropdownRef}>
//                 <button
//                   onClick={() => setShowDropdown(!showDropdown)}
//                   disabled={isLoadingSecrets || loadingChat}
//                   className="flex items-center space-x-2 px-4 py-2.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50"
//                 >
//                   <BookOpen className="h-4 w-4" />
//                   <span className="text-sm font-medium">
//                     {isLoadingSecrets ? "Loading..." : activeDropdown}
//                   </span>
//                   <ChevronDown className="h-4 w-4" />
//                 </button>

//                 {showDropdown && !isLoadingSecrets && (
//                   <div className="absolute top-full left-0 mt-2 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto">
//                     {secrets.length > 0 ? (
//                       secrets.map((secret) => (
//                         <button
//                           key={secret.id}
//                           onClick={() =>
//                             handleDropdownSelect(secret.name, secret.id)
//                           }
//                           className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg"
//                         >
//                           {secret.name}
//                         </button>
//                       ))
//                     ) : (
//                       <div className="px-4 py-2.5 text-sm text-gray-500">
//                         No analysis prompts available
//                       </div>
//                     )}
//                   </div>
//                 )}
//               </div>
//             </div>

//             <div className="flex items-center space-x-2">
//               <button className="flex items-center space-x-1 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
//                 <span>Sonnet 4.5</span>
//                 <ChevronDown className="h-4 w-4" />
//               </button>
//               <button
//                 onClick={handleNewMessage}
//                 disabled={
//                   loadingChat ||
//                   (!chatInput.trim() && !isSecretPromptSelected)
//                 }
//                 style={{ backgroundColor: '#1AA49B' }} className="p-2.5 hover:bg-orange-400 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
//               >
//                 {loadingChat ? (
//                   <Loader2 className="h-5 w-5 text-white animate-spin" />
//                 ) : (
//                   <Send className="h-5 w-5 text-white" />
//                 )}
//               </button>
//             </div>
//           </div>
//         </div>

//         {/* Chat History List */}
//         <div className="flex-1 overflow-y-auto space-y-3 pb-4">
//           {currentChatHistory.map((chat) => (
//             <div
//               key={chat.id}
//               onClick={() => handleSelectChat(chat.id)}
//               className={`bg-white rounded-2xl shadow-sm border border-gray-200 p-5 cursor-pointer transition-all hover:shadow-md hover:border-gray-300 ${
//                 selectedMessageId === chat.id
//                   ? "ring-2 ring-blue-500 border-blue-500"
//                   : ""
//               }`}
//             >
//               <div className="flex items-start justify-between">
//                 <div className="flex-1">
//                   <h3 className="text-base font-semibold text-gray-900 mb-1">
//                     {chat.question || chat.query || "Untitled"}
//                   </h3>
//                   <p className="text-sm text-gray-500">
//                     {getRelativeTime(chat.created_at || chat.timestamp)}
//                   </p>
//                 </div>
//                 <button
//                   onClick={(e) => {
//                     e.stopPropagation();
//                   }}
//                   className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
//                 >
//                   <MoreVertical className="h-5 w-5 text-gray-400" />
//                 </button>
//               </div>
//             </div>
//           ))}

//           {currentChatHistory.length === 0 && !loadingChat && (
//             <div className="text-center py-12">
//               <MessageSquare className="h-12 w-12 mx-auto mb-4 text-gray-300" />
//               <p className="text-gray-500">
//                 No chats yet. Start a conversation!
//               </p>
//             </div>
//           )}

//           {loadingChat && currentChatHistory.length === 0 && (
//             <div className="flex justify-center py-8">
//               <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
//             </div>
//           )}
//         </div>

//         {/* Error Message */}
//         {chatError && (
//           <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm flex-shrink-0">
//             {chatError}
//           </div>
//         )}
//       </div>

//       {/* Modal Response View */}
//       {selectedMessageId && currentResponse && (
//         <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
//           <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
//             <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
//               <h2 className="text-xl font-semibold text-gray-900">
//                 AI Response
//               </h2>
//               <button
//                 onClick={() => {
//                   setSelectedMessageId(null);
//                   setCurrentResponse("");
//                 }}
//                 className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500 hover:text-gray-700"
//               >
//                 ✕
//               </button>
//             </div>

//             <div className="flex-1 overflow-y-auto p-6" ref={responseRef}>
//               <div className="prose prose-gray max-w-none">
//                 <ReactMarkdown
//                   remarkPlugins={[remarkGfm]}
//                   components={{
//                     h1: (props) => (
//                       <h1
//                         className="text-2xl font-bold mb-6 mt-8 text-black border-b-2 border-gray-300 pb-2"
//                         {...props}
//                       />
//                     ),
//                     h2: (props) => (
//                       <h2
//                         className="text-xl font-bold mb-4 mt-6 text-black"
//                         {...props}
//                       />
//                     ),
//                     p: (props) => (
//                       <p
//                         className="mb-4 leading-relaxed text-black"
//                         {...props}
//                       />
//                     ),
//                   }}
//                 >
//                   {animatedResponseContent || currentResponse}
//                 </ReactMarkdown>
//                 {isAnimatingResponse && (
//                   <span className="inline-block w-2 h-5 bg-gray-400 animate-pulse ml-1"></span>
//                 )}
//               </div>
//             </div>
//           </div>
//         </div>
//       )}
//     </div>
//   );
// };

// export default ChatInterface;


// import React, { useState, useEffect, useContext, useRef } from "react";
// import { FileManagerContext } from "../../context/FileManagerContext";
// import documentApi from "../../services/documentApi";
// import {
//   Plus,
//   Shuffle,
//   Search,
//   BookOpen,
//   ChevronDown,
//   MoreVertical,
//   MessageSquare,
//   Loader2,
//   Send,
// } from "lucide-react";
// import ReactMarkdown from "react-markdown";
// import remarkGfm from "remark-gfm";
// import { SidebarContext } from "../../context/SidebarContext";

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
//   const [currentResponse, setCurrentResponse] = useState("");
//   const [animatedResponseContent, setAnimatedResponseContent] = useState("");
//   const [isAnimatingResponse, setIsAnimatingResponse] = useState(false);
//   const [selectedMessageId, setSelectedMessageId] = useState(null);
//   const [hasResponse, setHasResponse] = useState(false);

//   // Secret prompt states
//   const [secrets, setSecrets] = useState([]);
//   const [isLoadingSecrets, setIsLoadingSecrets] = useState(false);
//   const [selectedSecretId, setSelectedSecretId] = useState(null);
//   const [activeDropdown, setActiveDropdown] = useState("Summary");
//   const [showDropdown, setShowDropdown] = useState(false);
//   const [isSecretPromptSelected, setIsSecretPromptSelected] = useState(false);

//   const responseRef = useRef(null);
//   const dropdownRef = useRef(null);

//   // API Configuration
//   const API_BASE_URL = "https://gateway-service-120280829617.asia-south1.run.app";

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
//       if (token) {
//         return token;
//       }
//     }
//     return null;
//   };

//   // Fetch secrets list
//   const fetchSecrets = async () => {
//     try {
//       setIsLoadingSecrets(true);
//       setChatError(null);

//       const token = getAuthToken();
//       const headers = {
//         "Content-Type": "application/json",
//       };

//       if (token) {
//         headers["Authorization"] = `Bearer ${token}`;
//       }

//       const response = await fetch(`${API_BASE_URL}/files/secrets?fetch=true`, {
//         method: "GET",
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
//       console.error("Error fetching secrets:", error);
//       setChatError(`Failed to load analysis prompts: ${error.message}`);
//     } finally {
//       setIsLoadingSecrets(false);
//     }
//   };

//   // Fetch secret value by ID
//   const fetchSecretValue = async (secretId) => {
//     try {
//       const existingSecret = secrets.find((secret) => secret.id === secretId);
//       if (existingSecret && existingSecret.value) {
//         return existingSecret.value;
//       }

//       const token = getAuthToken();
//       const headers = {
//         "Content-Type": "application/json",
//       };

//       if (token) {
//         headers["Authorization"] = `Bearer ${token}`;
//       }

//       const response = await fetch(
//         `${API_BASE_URL}/files/secrets/${secretId}`,
//         {
//           method: "GET",
//           headers,
//         }
//       );

//       if (!response.ok) {
//         throw new Error(`Failed to fetch secret value: ${response.status}`);
//       }

//       const secretData = await response.json();
//       const promptValue =
//         secretData.value || secretData.prompt || secretData.content || secretData;

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

//   // Fetch chat history
//   const fetchChatHistory = async (sessionId) => {
//     if (!selectedFolder) return;

//     setLoadingChat(true);
//     setChatError(null);

//     try {
//       let data = await documentApi.getFolderChats(selectedFolder);
//       const chats = Array.isArray(data.chats) ? data.chats : [];
//       setCurrentChatHistory(chats);

//       if (sessionId) {
//         setSelectedChatSessionId(sessionId);
//         const selectedChat = chats.find((c) => c.id === sessionId);
//         if (selectedChat) {
//           const responseText =
//             selectedChat.response ||
//             selectedChat.answer ||
//             selectedChat.message ||
//             "";
//           setCurrentResponse(responseText);
//           setAnimatedResponseContent(responseText);
//           setSelectedMessageId(selectedChat.id);
//           setHasResponse(true);
//           setHasAiResponse(true);
//           setForceSidebarCollapsed(true);
//         } else if (selectedFolder === "Test" && chats.length > 0) {
//           setHasResponse(true);
//           setHasAiResponse(true);
//           setForceSidebarCollapsed(true);
//         }
//       } else {
//         setHasResponse(false);
//         setHasAiResponse(false);
//         setForceSidebarCollapsed(false);
//       }
//     } catch (err) {
//       console.error("❌ Error fetching chats:", err);
//       setChatError("Failed to fetch chat history.");
//     } finally {
//       setLoadingChat(false);
//     }
//   };

//   // Animate typing effect
//   const animateResponse = (text) => {
//     setAnimatedResponseContent("");
//     setIsAnimatingResponse(true);
//     let i = 0;
//     const interval = setInterval(() => {
//       if (i < text.length) {
//         setAnimatedResponseContent((prev) => prev + text.charAt(i));
//         i++;
//         if (responseRef.current) {
//           responseRef.current.scrollTop = responseRef.current.scrollHeight;
//         }
//       } else {
//         clearInterval(interval);
//         setIsAnimatingResponse(false);
//       }
//     }, 20);
//   };

//   // Chat with AI using secret prompt
//   const chatWithAI = async (folder, secretId, currentSessionId) => {
//     try {
//       setLoadingChat(true);
//       setChatError(null);

//       const selectedSecret = secrets.find((s) => s.id === secretId);
//       if (!selectedSecret) {
//         throw new Error("No prompt found for selected analysis type");
//       }

//       let promptValue = selectedSecret.value;
//       const promptLabel = selectedSecret.name;

//       if (!promptValue) {
//         promptValue = await fetchSecretValue(secretId);
//       }

//       if (!promptValue) {
//         throw new Error("Secret prompt value is empty.");
//       }

//       const response = await documentApi.queryFolderDocuments(
//         folder,
//         promptValue,
//         currentSessionId,
//         {
//           used_secret_prompt: true,
//           prompt_label: promptLabel,
//         }
//       );

//       if (response.sessionId) {
//         setSelectedChatSessionId(response.sessionId);
//       }

//       const history = Array.isArray(response.chatHistory)
//         ? response.chatHistory
//         : [];
//       setCurrentChatHistory(history);

//       if (history.length > 0) {
//         const latestMessage = history[history.length - 1];
//         const responseText =
//           latestMessage.response ||
//           latestMessage.answer ||
//           latestMessage.message ||
//           "";
//         setCurrentResponse(responseText);
//         setSelectedMessageId(latestMessage.id);
//         setHasResponse(true);
//         setHasAiResponse(true);
//         setForceSidebarCollapsed(true);
//         animateResponse(responseText);
//       }

//       return response;
//     } catch (error) {
//       setChatError(`Analysis failed: ${error.message}`);
//       throw error;
//     } finally {
//       setLoadingChat(false);
//     }
//   };

//   // Handle new message (combines regular chat and secret prompt)
//   const handleNewMessage = async () => {
//     if (!selectedFolder) return;

//     if (isSecretPromptSelected) {
//       if (!selectedSecretId) {
//         setChatError("Please select an analysis type.");
//         return;
//       }
//       try {
//         await chatWithAI(selectedFolder, selectedSecretId, selectedChatSessionId);
//         setChatInput("");
//       } catch (error) {
//         // Error already handled
//       }
//     } else {
//       if (!chatInput.trim()) return;

//       setLoadingChat(true);
//       setChatError(null);

//       try {
//         const response = await documentApi.queryFolderDocuments(
//           selectedFolder,
//           chatInput,
//           selectedChatSessionId
//         );

//         if (response.sessionId) {
//           setSelectedChatSessionId(response.sessionId);
//         }

//         const history = Array.isArray(response.chatHistory)
//           ? response.chatHistory
//           : [];
//         setCurrentChatHistory(history);

//         if (history.length > 0) {
//           const latestMessage = history[history.length - 1];
//           const responseText =
//             latestMessage.response ||
//             latestMessage.answer ||
//             latestMessage.message ||
//             "";
//           setCurrentResponse(responseText);
//           setSelectedMessageId(latestMessage.id);
//           setHasResponse(true);
//           setHasAiResponse(true);
//           setForceSidebarCollapsed(true);
//           animateResponse(responseText);
//         }
//         setChatInput("");
//       } catch (err) {
//         setChatError(
//           `Failed to send message: ${err.response?.data?.details || err.message}`
//         );
//       } finally {
//         setLoadingChat(false);
//       }
//     }
//   };

//   // Handle selecting a chat
//   const handleSelectChat = (chat) => {
//     setSelectedMessageId(chat.id);
//     const responseText = chat.response || chat.answer || chat.message || "";
//     setCurrentResponse(responseText);
//     setAnimatedResponseContent(responseText);
//     setIsAnimatingResponse(false);
//     setHasResponse(true);
//     setHasAiResponse(true);
//     setForceSidebarCollapsed(true);
//   };

//   // Handle new chat
//   const handleNewChat = () => {
//     setCurrentChatHistory([]);
//     setSelectedChatSessionId(null);
//     setHasResponse(false);
//     setHasAiResponse(false);
//     setForceSidebarCollapsed(false);
//     setChatInput("");
//     setSelectedMessageId(null);
//     setCurrentResponse("");
//     setAnimatedResponseContent("");
//     setIsSecretPromptSelected(false);
//   };

//   // Handle dropdown selection
//   const handleDropdownSelect = (secretName, secretId) => {
//     setActiveDropdown(secretName);
//     setSelectedSecretId(secretId);
//     setIsSecretPromptSelected(true);
//     setChatInput("");
//     setShowDropdown(false);
//   };

//   // Handle custom input change
//   const handleChatInputChange = (e) => {
//     setChatInput(e.target.value);
//     setIsSecretPromptSelected(false);
//     setActiveDropdown("Custom Query");
//   };

//   // Format relative time
//   const getRelativeTime = (dateString) => {
//     const date = new Date(dateString);
//     const now = new Date();
//     const diffInSeconds = Math.floor((now - date) / 1000);

//     if (diffInSeconds < 60) return `Last message ${diffInSeconds} seconds ago`;
//     if (diffInSeconds < 3600)
//       return `Last message ${Math.floor(diffInSeconds / 60)} minutes ago`;
//     if (diffInSeconds < 86400)
//       return `Last message ${Math.floor(diffInSeconds / 3600)} hours ago`;
//     return `Last message ${Math.floor(diffInSeconds / 86400)} days ago`;
//   };

//   const formatDate = (dateString) => {
//     try {
//       return new Date(dateString).toLocaleString();
//     } catch (e) {
//       return 'Invalid date';
//     }
//   };

//   // Close dropdown when clicking outside
//   useEffect(() => {
//     const handleClickOutside = (event) => {
//       if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
//         setShowDropdown(false);
//       }
//     };

//     document.addEventListener("mousedown", handleClickOutside);
//     return () => {
//       document.removeEventListener("mousedown", handleClickOutside);
//     };
//   }, []);

//   // Load secrets on mount
//   useEffect(() => {
//     fetchSecrets();
//   }, []);

//   useEffect(() => {
//     setChatSessions([]);
//     setCurrentChatHistory([]);
//     setSelectedChatSessionId(null);
//     setHasResponse(false);
//     setHasAiResponse(false);
//     setForceSidebarCollapsed(false);

//     if (selectedFolder && selectedFolder !== "Test") {
//       fetchChatHistory();
//     }
//   }, [selectedFolder]);

//   if (!selectedFolder) {
//     return (
//       <div className="flex items-center justify-center h-full text-gray-400 text-lg bg-[#FDFCFB]">
//         Select a folder to start chatting.
//       </div>
//     );
//   }

//   return (
//     <div className="flex h-screen bg-white">
//       {/* Left Panel - Chat History */}
//       <div className={`${hasResponse ? 'w-1/2' : 'w-full'} border-r border-gray-200 flex flex-col bg-white h-full`}>
//         {/* Header */}
//         <div className="p-4 border-b border-black border-opacity-20 flex-shrink-0">
//           <div className="flex items-center justify-between mb-4">
//             <h2 className="text-lg font-semibold text-gray-900">Questions</h2>
//             <button
//               onClick={handleNewChat}
//               className="px-3 py-1.5 text-sm font-medium text-white hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors" style={{ backgroundColor: '#21C1B6' }}
//             >
//               New Chat
//             </button>
//           </div>

//           {/* Search Input */}
//           <div className="relative mb-4">
//             <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
//             <input
//               type="text"
//               placeholder="Search questions..."
//               className="w-full pl-9 pr-3 py-2 bg-gray-100 rounded-lg text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
//             />
//           </div>
//         </div>

//         {/* Chat History List - Scrollable */}
//         <div className="flex-1 overflow-y-auto px-4 py-2">
//           <div className="space-y-2">
//             {currentChatHistory.map((chat) => (
//               <div
//                 key={chat.id}
//                 onClick={() => handleSelectChat(chat)}
//                 className={`p-3 rounded-lg border cursor-pointer transition-all duration-200 hover:shadow-md ${
//                   selectedMessageId === chat.id
//                     ? "bg-blue-50 border-blue-200 shadow-sm"
//                     : "bg-white border-gray-200 hover:bg-gray-50"
//                 }`}
//               >
//                 <div className="flex items-start justify-between">
//                   <div className="flex-1 min-w-0">
//                     <p className="text-sm font-medium text-gray-900 mb-1 line-clamp-2">
//                       {chat.question || chat.query || "Untitled"}
//                     </p>
//                     <p className="text-xs text-gray-500">
//                       {getRelativeTime(chat.created_at || chat.timestamp)}
//                     </p>
//                   </div>
//                   <button
//                     onClick={(e) => {
//                       e.stopPropagation();
//                     }}
//                     className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
//                   >
//                     <MoreVertical className="h-5 w-5 text-gray-400" />
//                   </button>
//                 </div>
//               </div>
//             ))}

//             {currentChatHistory.length === 0 && !loadingChat && (
//               <div className="text-center py-12">
//                 <MessageSquare className="h-12 w-12 mx-auto mb-4 text-gray-300" />
//                 <p className="text-gray-500">
//                   No chats yet. Start a conversation!
//                 </p>
//               </div>
//             )}

//             {loadingChat && currentChatHistory.length === 0 && (
//               <div className="flex justify-center py-8">
//                 <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
//               </div>
//             )}
//           </div>
//         </div>

//         {/* Input Area - Fixed at bottom */}
//         <div className="border-t border-gray-200 p-2 bg-white flex-shrink-0">
//           <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
//             <input
//               type="text"
//               placeholder="How can I help you today?"
//               value={chatInput}
//               onChange={handleChatInputChange}
//               onKeyPress={(e) => e.key === "Enter" && handleNewMessage()}
//               className="w-full text-base text-gray-700 placeholder-gray-400 outline-none bg-transparent"
//               disabled={loadingChat}
//             />

//             {/* Action Buttons Row */}
//             <div className="flex items-center justify-between">
//               <div className="flex items-center space-x-2">
//                 <button
//                   onClick={handleNewChat}
//                   className="p-2.5 hover:bg-gray-100 rounded-lg transition-colors"
//                   title="New Chat"
//                 >
//                 </button>

//                 {/* Analysis Dropdown */}
//                 <div className="relative" ref={dropdownRef}>
//                   <button
//                     onClick={() => setShowDropdown(!showDropdown)}
//                     disabled={isLoadingSecrets || loadingChat}
//                     className="flex items-center space-x-2 px-4 py-2.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50"
//                   >
//                     <BookOpen className="h-4 w-4" />
//                     <span className="text-sm font-medium">
//                       {isLoadingSecrets ? "Loading..." : activeDropdown}
//                     </span>
//                     <ChevronDown className="h-4 w-4" />
//                   </button>

//                   {showDropdown && !isLoadingSecrets && (
//                     <div className="absolute top-full left-0 mt-2 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto">
//                       {secrets.length > 0 ? (
//                         secrets.map((secret) => (
//                           <button
//                             key={secret.id}
//                             onClick={() =>
//                               handleDropdownSelect(secret.name, secret.id)
//                             }
//                             className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg"
//                           >
//                             {secret.name}
//                           </button>
//                         ))
//                       ) : (
//                         <div className="px-4 py-2.5 text-sm text-gray-500">
//                           No analysis prompts available
//                         </div>
//                       )}
//                     </div>
//                   )}
//                 </div>
//               </div>

//               <div className="flex items-center space-x-2">
//                 <button
//                   onClick={handleNewMessage}
//                   disabled={
//                     loadingChat ||
//                     (!chatInput.trim() && !isSecretPromptSelected)
//                   }
//                   style={{ backgroundColor: '#1AA49B' }} className="p-2.5 hover:bg-orange-400 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
//                 >
//                   {loadingChat ? (
//                     <Loader2 className="h-5 w-5 text-white animate-spin" />
//                   ) : (
//                     <Send className="h-5 w-5 text-white" />
//                   )}
//                 </button>
//               </div>
//             </div>
//           </div>

//           {/* Error Message */}
//           {chatError && (
//             <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
//               {chatError}
//             </div>
//           )}
//         </div>
//       </div>

//       {/* Right Panel - AI Response (Similar to AnalysisPage) */}
//       {hasResponse && selectedMessageId && (
//         <div className="w-1/2 flex flex-col h-full">
//           <div className="flex-1 overflow-y-auto" ref={responseRef}>
//             {currentResponse || animatedResponseContent ? (
//               <div className="px-6 py-6">
//                 <div className="max-w-none">
//                   {/* Response Header */}
//                   <div className="mb-6 pb-4 border-b border-gray-200">
//                     <div className="flex items-center justify-between">
//                       <h2 className="text-xl font-semibold text-gray-900">AI Response</h2>
//                       <div className="flex items-center space-x-2 text-sm text-gray-500">
//                         {currentChatHistory.find(msg => msg.id === selectedMessageId)?.timestamp && (
//                           <span>{formatDate(currentChatHistory.find(msg => msg.id === selectedMessageId).timestamp)}</span>
//                         )}
//                       </div>
//                     </div>
//                     {/* Original Question */}
//                     <div className="mt-3 p-3 bg-blue-50 rounded-lg border-l-4 border-blue-400">
//                       <p className="text-sm font-medium text-blue-900 mb-1">Question:</p>
//                       <p className="text-sm text-blue-800">
//                         {currentChatHistory.find(msg => msg.id === selectedMessageId)?.question || 'No question available'}
//                       </p>
//                     </div>
//                   </div>

//                   {/* Response Content */}
//                   <div className="prose prose-gray max-w-none">
//                     <ReactMarkdown
//                       remarkPlugins={[remarkGfm]}
//                       components={{
//                         h1: (props) => (
//                           <h1
//                             className="text-2xl font-bold mb-6 mt-8 text-black border-b-2 border-gray-300 pb-2"
//                             {...props}
//                           />
//                         ),
//                         h2: (props) => (
//                           <h2
//                             className="text-xl font-bold mb-4 mt-6 text-black"
//                             {...props}
//                           />
//                         ),
//                         h3: (props) => (
//                           <h3
//                             className="text-lg font-bold mb-3 mt-4 text-black"
//                             {...props}
//                           />
//                         ),
//                         p: (props) => (
//                           <p
//                             className="mb-4 leading-relaxed text-black text-justify"
//                             {...props}
//                           />
//                         ),
//                         strong: (props) => (
//                           <strong className="font-bold text-black" {...props} />
//                         ),
//                         ul: (props) => (
//                           <ul className="list-disc pl-5 mb-4 text-black" {...props} />
//                         ),
//                         ol: (props) => (
//                           <ol className="list-decimal pl-5 mb-4 text-black" {...props} />
//                         ),
//                         li: (props) => (
//                           <li className="mb-2 leading-relaxed text-black" {...props} />
//                         ),
//                         blockquote: (props) => (
//                           <blockquote className="border-l-4 border-gray-300 pl-4 italic text-gray-700 my-4" {...props} />
//                         ),
//                         code: ({ inline, ...props }) => {
//                           const className = inline 
//                             ? "bg-gray-100 px-1 py-0.5 rounded text-sm font-mono text-red-700" 
//                             : "block bg-gray-100 p-4 rounded-md text-sm font-mono overflow-x-auto my-4 text-red-700";
//                           return <code className={className} {...props} />;
//                         },
//                       }}
//                     >
//                       {animatedResponseContent || currentResponse}
//                     </ReactMarkdown>
//                     {isAnimatingResponse && (
//                       <span className="inline-block w-2 h-5 bg-gray-400 animate-pulse ml-1"></span>
//                     )}
//                   </div>
//                 </div>
//               </div>
//             ) : (
//               <div className="flex items-center justify-center h-full">
//                 <div className="text-center max-w-md px-6">
//                   <MessageSquare className="h-16 w-16 mx-auto mb-6 text-gray-300" />
//                   <h3 className="text-2xl font-semibold mb-4 text-gray-900">Select a Question</h3>
//                   <p className="text-gray-600 text-lg leading-relaxed">
//                     Click on any question from the left panel to view the AI response here.
//                   </p>
//                 </div>
//               </div>
//             )}
//           </div>
//         </div>
//       )}
//     </div>
//   );
// };

// export default ChatInterface;



// import React, { useState, useEffect, useContext, useRef } from "react";
// import { FileManagerContext } from "../../context/FileManagerContext";
// import documentApi from "../../services/documentApi";
// import {
//   Plus,
//   Shuffle,
//   Search,
//   BookOpen,
//   ChevronDown,
//   MoreVertical,
//   MessageSquare,
//   Loader2,
//   Send,
// } from "lucide-react";
// import ReactMarkdown from "react-markdown";
// import remarkGfm from "remark-gfm";
// import { SidebarContext } from "../../context/SidebarContext";

// import { Copy, Download } from 'lucide-react';
// import jsPDF from 'jspdf';

// import { Copy, Download } from 'lucide-react';
// import jsPDF from 'jspdf';

// import { Copy, Download } from 'lucide-react';
// import jsPDF from 'jspdf';

// import { Copy, Download } from 'lucide-react';
// import jsPDF from 'jspdf';

// import { Copy, Download } from 'lucide-react';
// import jsPDF from 'jspdf';
// import { useState } from 'react';

// import { useState, useEffect, useContext, useRef } from "react";
// import { FileManagerContext } from "../../context/FileManagerContext";
// import documentApi from "../../services/documentApi";
// import {
//   Plus,
//   Shuffle,
//   Search,
//   BookOpen,
//   ChevronDown,
//   MoreVertical,
//   MessageSquare,
//   Loader2,
//   Send,
// } from "lucide-react";
// import ReactMarkdown from "react-markdown";
// import remarkGfm from "remark-gfm";
// import { SidebarContext } from "../../context/SidebarContext";
// import { Copy, Download } from 'lucide-react';
// import jsPDF from 'jspdf';

// import { useState, useEffect, useContext, useRef } from "react";
// import { FileManagerContext } from "../../context/FileManagerContext";
// import documentApi from "../../services/documentApi";
// import {
//   Plus,
//   Shuffle,
//   Search,
//   BookOpen,
//   ChevronDown,
//   MoreVertical,
//   MessageSquare,
//   Loader2,
//   Send,
// } from "lucide-react";
// import ReactMarkdown from "react-markdown";
// import remarkGfm from "remark-gfm";
// import { SidebarContext } from "../../context/SidebarContext";
// import { Copy, Download } from 'lucide-react';
// import jsPDF from 'jspdf';

// const ChatInterface = () => {
//   const [copyMessage, setCopyMessage] = useState('');
//   const [downloadMessage, setDownloadMessage] = useState('');
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
//   const [currentResponse, setCurrentResponse] = useState("");
//   const [animatedResponseContent, setAnimatedResponseContent] = useState("");
//   const [isAnimatingResponse, setIsAnimatingResponse] = useState(false);
//   const [selectedMessageId, setSelectedMessageId] = useState(null);
//   const [hasResponse, setHasResponse] = useState(false);

//   // Secret prompt states
//   const [secrets, setSecrets] = useState([]);
//   const [isLoadingSecrets, setIsLoadingSecrets] = useState(false);
//   const [selectedSecretId, setSelectedSecretId] = useState(null);
//   const [activeDropdown, setActiveDropdown] = useState("Summary");
//   const [showDropdown, setShowDropdown] = useState(false);
//   const [isSecretPromptSelected, setIsSecretPromptSelected] = useState(false);

//   const responseRef = useRef(null);
//   const dropdownRef = useRef(null);

//   // API Configuration
//   const API_BASE_URL = "https://gateway-service-120280829617.asia-south1.run.app";

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
//       if (token) {
//         return token;
//       }
//     }
//     return null;
//   };

//   // Fetch secrets list
//   const fetchSecrets = async () => {
//     try {
//       setIsLoadingSecrets(true);
//       setChatError(null);

//       const token = getAuthToken();
//       const headers = {
//         "Content-Type": "application/json",
//       };

//       if (token) {
//         headers["Authorization"] = `Bearer ${token}`;
//       }

//       const response = await fetch(`${API_BASE_URL}/files/secrets?fetch=true`, {
//         method: "GET",
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
//       console.error("Error fetching secrets:", error);
//       setChatError(`Failed to load analysis prompts: ${error.message}`);
//     } finally {
//       setIsLoadingSecrets(false);
//     }
//   };

//   // Fetch secret value by ID
//   const fetchSecretValue = async (secretId) => {
//     try {
//       const existingSecret = secrets.find((secret) => secret.id === secretId);
//       if (existingSecret && existingSecret.value) {
//         return existingSecret.value;
//       }

//       const token = getAuthToken();
//       const headers = {
//         "Content-Type": "application/json",
//       };

//       if (token) {
//         headers["Authorization"] = `Bearer ${token}`;
//       }

//       const response = await fetch(
//         `${API_BASE_URL}/files/secrets/${secretId}`,
//         {
//           method: "GET",
//           headers,
//         }
//       );

//       if (!response.ok) {
//         throw new Error(`Failed to fetch secret value: ${response.status}`);
//       }

//       const secretData = await response.json();
//       const promptValue =
//         secretData.value || secretData.prompt || secretData.content || secretData;

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

//   // Fetch chat history
//   const fetchChatHistory = async (sessionId) => {
//     if (!selectedFolder) return;

//     setLoadingChat(true);
//     setChatError(null);

//     try {
//       let data = await documentApi.getFolderChats(selectedFolder);
//       const chats = Array.isArray(data.chats) ? data.chats : [];
//       setCurrentChatHistory(chats);

//       if (sessionId) {
//         setSelectedChatSessionId(sessionId);
//         const selectedChat = chats.find((c) => c.id === sessionId);
//         if (selectedChat) {
//           const responseText =
//             selectedChat.response ||
//             selectedChat.answer ||
//             selectedChat.message ||
//             "";
//           setCurrentResponse(responseText);
//           setAnimatedResponseContent(responseText);
//           setSelectedMessageId(selectedChat.id);
//           setHasResponse(true);
//           setHasAiResponse(true);
//           setForceSidebarCollapsed(true);
//         } else if (selectedFolder === "Test" && chats.length > 0) {
//           setHasResponse(true);
//           setHasAiResponse(true);
//           setForceSidebarCollapsed(true);
//         }
//       } else {
//         setHasResponse(false);
//         setHasAiResponse(false);
//         setForceSidebarCollapsed(false);
//       }
//     } catch (err) {
//       console.error("❌ Error fetching chats:", err);
//       setChatError("Failed to fetch chat history.");
//     } finally {
//       setLoadingChat(false);
//     }
//   };

//   // Animate typing effect
//   const animateResponse = (text) => {
//     setAnimatedResponseContent("");
//     setIsAnimatingResponse(true);
//     let i = 0;
//     const interval = setInterval(() => {
//       if (i < text.length) {
//         setAnimatedResponseContent((prev) => prev + text.charAt(i));
//         i++;
//         if (responseRef.current) {
//           responseRef.current.scrollTop = responseRef.current.scrollHeight;
//         }
//       } else {
//         clearInterval(interval);
//         setIsAnimatingResponse(false);
//       }
//     }, 20);
//   };

//   // Chat with AI using secret prompt - CORRECTED
//   const chatWithAI = async (folder, secretId, currentSessionId) => {
//     try {
//       setLoadingChat(true);
//       setChatError(null);

//       const selectedSecret = secrets.find((s) => s.id === secretId);
//       if (!selectedSecret) {
//         throw new Error("No prompt found for selected analysis type");
//       }

//       let promptValue = selectedSecret.value;
//       const promptLabel = selectedSecret.name;

//       // If the secret doesn't have a value, fetch it
//       if (!promptValue) {
//         promptValue = await fetchSecretValue(secretId);
//       }

//       if (!promptValue) {
//         throw new Error("Secret prompt value is empty.");
//       }

//       // CORRECTED: Send the actual prompt value to backend with metadata
//       const response = await documentApi.queryFolderDocuments(
//         folder,
//         promptValue, // Send the actual prompt content
//         currentSessionId,
//         {
//           used_secret_prompt: true,  // Flag that this uses a secret prompt
//           prompt_label: promptLabel,  // Store the name/label of the prompt
//           secret_id: secretId         // Optional: store the secret ID reference
//         }
//       );

//       if (response.sessionId) {
//         setSelectedChatSessionId(response.sessionId);
//       }

//       const history = Array.isArray(response.chatHistory)
//         ? response.chatHistory
//         : [];
//       setCurrentChatHistory(history);

//       if (history.length > 0) {
//         const latestMessage = history[history.length - 1];
//         const responseText =
//           latestMessage.response ||
//           latestMessage.answer ||
//           latestMessage.message ||
//           "";
//         setCurrentResponse(responseText);
//         setSelectedMessageId(latestMessage.id);
//         setHasResponse(true);
//         setHasAiResponse(true);
//         setForceSidebarCollapsed(true);
//         animateResponse(responseText);
//       }

//       return response;
//     } catch (error) {
//       setChatError(`Analysis failed: ${error.message}`);
//       throw error;
//     } finally {
//       setLoadingChat(false);
//     }
//   };

//   // Handle new message (combines regular chat and secret prompt)
//   const handleNewMessage = async () => {
//     if (!selectedFolder) return;

//     if (isSecretPromptSelected) {
//       // Using secret prompt
//       if (!selectedSecretId) {
//         setChatError("Please select an analysis type.");
//         return;
//       }
//       try {
//         await chatWithAI(selectedFolder, selectedSecretId, selectedChatSessionId);
//         setChatInput("");
//         setIsSecretPromptSelected(false); // Reset after sending
//       } catch (error) {
//         // Error already handled
//       }
//     } else {
//       // Regular chat
//       if (!chatInput.trim()) return;

//       setLoadingChat(true);
//       setChatError(null);

//       try {
//         const response = await documentApi.queryFolderDocuments(
//           selectedFolder,
//           chatInput,
//           selectedChatSessionId,
//           {
//             used_secret_prompt: false // Explicitly mark as regular chat
//           }
//         );

//         if (response.sessionId) {
//           setSelectedChatSessionId(response.sessionId);
//         }

//         const history = Array.isArray(response.chatHistory)
//           ? response.chatHistory
//           : [];
//         setCurrentChatHistory(history);

//         if (history.length > 0) {
//           const latestMessage = history[history.length - 1];
//           const responseText =
//             latestMessage.response ||
//             latestMessage.answer ||
//             latestMessage.message ||
//             "";
//           setCurrentResponse(responseText);
//           setSelectedMessageId(latestMessage.id);
//           setHasResponse(true);
//           setHasAiResponse(true);
//           setForceSidebarCollapsed(true);
//           animateResponse(responseText);
//         }
//         setChatInput("");
//       } catch (err) {
//         setChatError(
//           `Failed to send message: ${err.response?.data?.details || err.message}`
//         );
//       } finally {
//         setLoadingChat(false);
//       }
//     }
//   };

//   // Handle selecting a chat
//   const handleSelectChat = (chat) => {
//     setSelectedMessageId(chat.id);
//     const responseText = chat.response || chat.answer || chat.message || "";
//     setCurrentResponse(responseText);
//     setAnimatedResponseContent(responseText);
//     setIsAnimatingResponse(false);
//     setHasResponse(true);
//     setHasAiResponse(true);
//     setForceSidebarCollapsed(true);
//   };

//   // Handle new chat
//   const handleNewChat = () => {
//     setCurrentChatHistory([]);
//     setSelectedChatSessionId(null);
//     setHasResponse(false);
//     setHasAiResponse(false);
//     setForceSidebarCollapsed(false);
//     setChatInput("");
//     setSelectedMessageId(null);
//     setCurrentResponse("");
//     setAnimatedResponseContent("");
//     setIsSecretPromptSelected(false);
//     setSelectedSecretId(null);
//     // Reset to first secret as default
//     if (secrets.length > 0) {
//       setActiveDropdown(secrets[0].name);
//       setSelectedSecretId(secrets[0].id);
//     }
//   };

//   // Handle dropdown selection
//   const handleDropdownSelect = (secretName, secretId) => {
//     setActiveDropdown(secretName);
//     setSelectedSecretId(secretId);
//     setIsSecretPromptSelected(true);
//     setChatInput(""); // Clear any custom input
//     setShowDropdown(false);
//   };

//   // Handle custom input change
//   const handleChatInputChange = (e) => {
//     setChatInput(e.target.value);
//     setIsSecretPromptSelected(false); // Switch to custom query mode
//     setActiveDropdown("Custom Query");
//   };

//   // Format relative time
//   const getRelativeTime = (dateString) => {
//     const date = new Date(dateString);
//     const now = new Date();
//     const diffInSeconds = Math.floor((now - date) / 1000);

//     if (diffInSeconds < 60) return `Last message ${diffInSeconds} seconds ago`;
//     if (diffInSeconds < 3600)
//       return `Last message ${Math.floor(diffInSeconds / 60)} minutes ago`;
//     if (diffInSeconds < 86400)
//       return `Last message ${Math.floor(diffInSeconds / 3600)} hours ago`;
//     return `Last message ${Math.floor(diffInSeconds / 86400)} days ago`;
//   };

//   const formatDate = (dateString) => {
//     try {
//       return new Date(dateString).toLocaleString();
//     } catch (e) {
//       return 'Invalid date';
//     }
//   };

//   // Close dropdown when clicking outside
//   useEffect(() => {
//     const handleClickOutside = (event) => {
//       if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
//         setShowDropdown(false);
//       }
//     };

//     document.addEventListener("mousedown", handleClickOutside);
//     return () => {
//       document.removeEventListener("mousedown", handleClickOutside);
//     };
//   }, []);

//   // Load secrets on mount
//   useEffect(() => {
//     fetchSecrets();
//   }, []);

//   useEffect(() => {
//     setChatSessions([]);
//     setCurrentChatHistory([]);
//     setSelectedChatSessionId(null);
//     setHasResponse(false);
//     setHasAiResponse(false);
//     setForceSidebarCollapsed(false);

//     if (selectedFolder && selectedFolder !== "Test") {
//       fetchChatHistory();
//     }
//   }, [selectedFolder]);

//   if (!selectedFolder) {
//     return (
//       <div className="flex items-center justify-center h-full text-gray-400 text-lg bg-[#FDFCFB]">
//         Select a folder to start chatting.
//       </div>
//     );
//   }

//   return (
//     <div className=" flex h-screen bg-white">
//       {/* Left Panel - Chat History */}
//       <div className={`${hasResponse ? 'w-[35%]' : 'w-full'} border-r border-gray-200 flex flex-col bg-white h-full`}>
//         {/* Header */}
//         <div className="p-4 border-b border-black border-opacity-20 flex-shrink-0">
//           <div className="flex items-center justify-between mb-4">
//             <h2 className="text-lg font-semibold text-gray-900">Questions</h2>
//             <button
//               onClick={handleNewChat}
//               className="px-3 py-1.5 text-sm font-medium text-white hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors" style={{ backgroundColor: '#21C1B6' }}
//             >
//               New Chat
//             </button>
//           </div>

//           {/* Search Input */}
//           <div className="relative mb-4">
//             <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
//             <input
//               type="text"
//               placeholder="Search questions..."
//               className="w-full pl-9 pr-3 py-2 bg-gray-100 rounded-lg text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
//             />
//           </div>
//         </div>

//         {/* Chat History List - Scrollable */}
//         <div className="flex-1 overflow-y-auto px-4 py-2">
//           <div className="space-y-2">
//             {currentChatHistory.map((chat) => (
//               <div
//                 key={chat.id}
//                 onClick={() => handleSelectChat(chat)}
//                 className={`p-3 rounded-lg border cursor-pointer transition-all duration-200 hover:shadow-md ${
//                   selectedMessageId === chat.id
//                     ? "bg-blue-50 border-blue-200 shadow-sm"
//                     : "bg-white border-gray-200 hover:bg-gray-50"
//                 }`}
//               >
//                 <div className="flex items-start justify-between">
//                   <div className="flex-1 min-w-0">
//                     <p className="text-sm font-medium text-gray-900 mb-1 line-clamp-2">
//                       {chat.question || chat.query || "Untitled"}
//                     </p>
//                     <p className="text-xs text-gray-500">
//                       {getRelativeTime(chat.created_at || chat.timestamp)}
//                     </p>
//                   </div>
//                   <button
//                     onClick={(e) => {
//                       e.stopPropagation();
//                     }}
//                     className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
//                   >
//                     <MoreVertical className="h-5 w-5 text-gray-400" />
//                   </button>
//                 </div>
//               </div>
//             ))}

//             {currentChatHistory.length === 0 && !loadingChat && (
//               <div className="text-center py-12">
//                 <MessageSquare className="h-12 w-12 mx-auto mb-4 text-gray-300" />
//                 <p className="text-gray-500">
//                   No chats yet. Start a conversation!
//                 </p>
//               </div>
//             )}

//             {loadingChat && currentChatHistory.length === 0 && (
//               <div className="flex justify-center py-8">
//                 <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
//               </div>
//             )}
//           </div>
//         </div>

//         {/* Input Area - Fixed at bottom */}
//         <div className="border-t border-gray-200 p-2 bg-white flex-shrink-0">
//           <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
//             <input
//               type="text"
//               placeholder={isSecretPromptSelected ? `Analysis: ${activeDropdown}` : "How can I help you today?"}
//               value={chatInput}
//               onChange={handleChatInputChange}
//               onKeyPress={(e) => e.key === "Enter" && handleNewMessage()}
//               className="w-full text-base text-gray-700 placeholder-gray-400 outline-none bg-transparent"
//               disabled={loadingChat}
//             />

//             {/* Action Buttons Row */}
//             <div className="flex items-center justify-between mt-2">
//               <div className="flex items-center space-x-2">
//                 {/* Analysis Dropdown */}
//                 <div className="relative" ref={dropdownRef}>
//                   <button
//                     onClick={() => setShowDropdown(!showDropdown)}
//                     disabled={isLoadingSecrets || loadingChat}
//                     className="flex items-center space-x-2 px-4 py-2.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50"
//                   >
//                     <BookOpen className="h-4 w-4" />
//                     <span className="text-sm font-medium">
//                       {isLoadingSecrets ? "Loading..." : activeDropdown}
//                     </span>
//                     <ChevronDown className="h-4 w-4" />
//                   </button>

//                   {showDropdown && !isLoadingSecrets && (
//                     <div className="absolute bottom-full left-0 mb-2 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto">
//                       {secrets.length > 0 ? (
//                         secrets.map((secret) => (
//                           <button
//                             key={secret.id}
//                             onClick={() =>
//                               handleDropdownSelect(secret.name, secret.id)
//                             }
//                             className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg"
//                           >
//                             {secret.name}
//                           </button>
//                         ))
//                       ) : (
//                         <div className="px-4 py-2.5 text-sm text-gray-500">
//                           No analysis prompts available
//                         </div>
//                       )}
//                     </div>
//                   )}
//                 </div>
//               </div>

//               <div className="flex items-center space-x-2">
//                 <button
//                   onClick={handleNewMessage}
//                   disabled={
//                     loadingChat ||
//                     (!chatInput.trim() && !isSecretPromptSelected)
//                   }
//                   style={{ backgroundColor: '#1AA49B' }} className="p-2.5 hover:bg-orange-400 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
//                 >
//                   {loadingChat ? (
//                     <Loader2 className="h-5 w-5 text-white animate-spin" />
//                   ) : (
//                     <Send className="h-5 w-5 text-white" />
//                   )}
//                 </button>
//               </div>
//             </div>
//           </div>

//           {/* Error Message */}
//           {chatError && (
//             <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
//               {chatError}
//             </div>
//           )}
//         </div>
//       </div>

//       {/* Right Panel - AI Response */}
//       {hasResponse && selectedMessageId && (
//         <div className="w-[65%] flex flex-col h-full">
//           <div className="flex items-center justify-between p-4">
//             <h2 className="text-xl font-semibold text-gray-900">AI Response</h2>
//             <div className="flex space-x-2">
//               <button onClick={() => {navigator.clipboard.writeText(currentResponse); alert('Copied!')}} className="bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded-md flex items-center space-x-1">
//                 <Copy className="w-4 h-4" />
//                 <span>Copy</span>
//               </button>
//               <button onClick={() => {
//                 const doc = new jsPDF('p', 'pt', 'a4');
//                 const formattedResponse = currentResponse.replace(/\|---|---:\|/g, '').replace(/\|/g, '   ');
//                 doc.text(formattedResponse, 10, 10);
//                 doc.save("response.pdf");
//                 alert('Downloaded!');
//               }} className="bg-blue-500 hover:bg-blue-700 text-white px-3 py-1 rounded-md flex items-center space-x-1">
//               <Download className="w-4 h-4" />
//                 <span>Download</span>
//               </button>
//             </div>
//           </div>
//           <div className="flex-1 overflow-y-auto" ref={responseRef}  >
//             {currentResponse || animatedResponseContent ? (
//               <div className="px-6 py-6">
//                 <div className="max-w-none">
//                   {/* Response Header */}
//                   <div className="mb-6 pb-4 border-b border-gray-200">
//                     <div className="flex items-center justify-between">
//                       <h2 className="text-xl font-semibold text-gray-900">AI Response</h2>
//                       <div className="flex items-center space-x-2 text-sm text-gray-500">
//                         {currentChatHistory.find(msg => msg.id === selectedMessageId)?.timestamp && (
//                           <span>{formatDate(currentChatHistory.find(msg => msg.id === selectedMessageId).timestamp)}</span>
//                         )}
//                       </div>
//                     </div>
//                     {/* Original Question */}
//                     <div className="mt-3 p-3 bg-blue-50 rounded-lg border-l-4 border-blue-400">
//                       <p className="text-sm font-medium text-blue-900 mb-1">Question:</p>
//                       <p className="text-sm text-blue-800">
//                         {currentChatHistory.find(msg => msg.id === selectedMessageId)?.question || 'No question available'}
//                       </p>
//                     </div>
//                   </div>

//                   {/* Response Content */}
//                   <div className="prose prose-gray max-w-none">
//                     <ReactMarkdown
//                       remarkPlugins={[remarkGfm]}
//                       components={{
//                         h1: (props) => (
//                           <h1
//                             className="text-2xl font-bold mb-6 mt-8 text-black border-b-2 border-gray-300 pb-2"
//                             {...props}
//                           />
//                         ),
//                         h2: (props) => (
//                           <h2
//                             className="text-xl font-bold mb-4 mt-6 text-black"
//                             {...props}
//                           />
//                         ),
//                         h3: (props) => (
//                           <h3
//                             className="text-lg font-bold mb-3 mt-4 text-black"
//                             {...props}
//                           />
//                         ),
//                         p: (props) => (
//                           <p
//                             className="mb-4 leading-relaxed text-black text-justify"
//                             {...props}
//                           />
//                         ),
//                         strong: (props) => (
//                           <strong className="font-bold text-black" {...props} />
//                         ),
//                         ul: (props) => (
//                           <ul className="list-disc pl-5 mb-4 text-black" {...props} />
//                         ),
//                         ol: (props) => (
//                           <ol className="list-decimal pl-5 mb-4 text-black" {...props} />
//                         ),
//                         li: (props) => (
//                           <li className="mb-2 leading-relaxed text-black" {...props} />
//                         ),
//                         blockquote: (props) => (
//                           <blockquote className="border-l-4 border-gray-300 pl-4 italic text-gray-700 my-4" {...props} />
//                         ),
//                         code: ({ inline, ...props }) => {
//                           const className = inline 
//                             ? "bg-gray-100 px-1 py-0.5 rounded text-sm font-mono text-red-700" 
//                             : "block bg-gray-100 p-4 rounded-md text-sm font-mono overflow-x-auto my-4 text-red-700";
//                           return <code className={className} {...props} />;
//                         },
//                       }}
//                     >
//                       {animatedResponseContent || currentResponse}
//                     </ReactMarkdown>
//                     {isAnimatingResponse && (
//                       <span className="inline-block w-2 h-5 bg-gray-400 animate-pulse ml-1"></span>
//                     )}
//                   </div>
//                 </div>
//               </div>
//             ) : (
//               <div className="flex items-center justify-center h-full">
//                 <div className="text-center max-w-md px-6">
//                   <MessageSquare className="h-16 w-16 mx-auto mb-6 text-gray-300" />
//                   <h3 className="text-2xl font-semibold mb-4 text-gray-900">Select a Question</h3>
//                   <p className="text-gray-600 text-lg leading-relaxed">
//                     Click on any question from the left panel to view the AI response here.
//                   </p>
//                 </div>
//               </div>
//             )}
//           </div>
//         </div>
//       )}
//     </div>
//   );
// };

// export default ChatInterface;


// import React, { useState, useEffect, useContext, useRef } from "react";
// import { FileManagerContext } from "../../context/FileManagerContext";
// import documentApi from "../../services/documentApi";
// import {
//   Plus,
//   Shuffle,
//   Search,
//   BookOpen,
//   ChevronDown,
//   MoreVertical,
//   MessageSquare,
//   Loader2,
//   Send,
//   Copy,
//   Download,
// } from "lucide-react";
// import ReactMarkdown from "react-markdown";
// import remarkGfm from "remark-gfm";
// import { SidebarContext } from "../../context/SidebarContext";
// import jsPDF from 'jspdf';

// const ChatInterface = () => {
//   const [showCopyMessage, setShowCopyMessage] = useState(false);
//   const [showDownloadMessage, setShowDownloadMessage] = useState(false);
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
//   const [currentResponse, setCurrentResponse] = useState("");
//   const [animatedResponseContent, setAnimatedResponseContent] = useState("");
//   const [isAnimatingResponse, setIsAnimatingResponse] = useState(false);
//   const [selectedMessageId, setSelectedMessageId] = useState(null);
//   const [hasResponse, setHasResponse] = useState(false);

//   // Secret prompt states
//   const [secrets, setSecrets] = useState([]);
//   const [isLoadingSecrets, setIsLoadingSecrets] = useState(false);
//   const [selectedSecretId, setSelectedSecretId] = useState(null);
//   const [activeDropdown, setActiveDropdown] = useState("Summary");
//   const [showDropdown, setShowDropdown] = useState(false);
//   const [isSecretPromptSelected, setIsSecretPromptSelected] = useState(false);

//   const responseRef = useRef(null);
//   const dropdownRef = useRef(null);

//   // API Configuration
//   const API_BASE_URL = "https://gateway-service-120280829617.asia-south1.run.app";

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
//       if (token) {
//         return token;
//       }
//     }
//     return null;
//   };

//   // Fetch secrets list
//   const fetchSecrets = async () => {
//     try {
//       setIsLoadingSecrets(true);
//       setChatError(null);

//       const token = getAuthToken();
//       const headers = {
//         "Content-Type": "application/json",
//       };

//       if (token) {
//         headers["Authorization"] = `Bearer ${token}`;
//       }

//       const response = await fetch(`${API_BASE_URL}/files/secrets?fetch=true`, {
//         method: "GET",
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
//       console.error("Error fetching secrets:", error);
//       setChatError(`Failed to load analysis prompts: ${error.message}`);
//     } finally {
//       setIsLoadingSecrets(false);
//     }
//   };

//   // Fetch secret value by ID
//   const fetchSecretValue = async (secretId) => {
//     try {
//       const existingSecret = secrets.find((secret) => secret.id === secretId);
//       if (existingSecret && existingSecret.value) {
//         return existingSecret.value;
//       }

//       const token = getAuthToken();
//       const headers = {
//         "Content-Type": "application/json",
//       };

//       if (token) {
//         headers["Authorization"] = `Bearer ${token}`;
//       }

//       const response = await fetch(
//         `${API_BASE_URL}/files/secrets/${secretId}`,
//         {
//           method: "GET",
//           headers,
//         }
//       );

//       if (!response.ok) {
//         throw new Error(`Failed to fetch secret value: ${response.status}`);
//       }

//       const secretData = await response.json();
//       const promptValue =
//         secretData.value || secretData.prompt || secretData.content || secretData;

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

//   // Fetch chat history
//   const fetchChatHistory = async (sessionId) => {
//     if (!selectedFolder) return;

//     setLoadingChat(true);
//     setChatError(null);

//     try {
//       let data = await documentApi.getFolderChats(selectedFolder);
//       const chats = Array.isArray(data.chats) ? data.chats : [];
//       setCurrentChatHistory(chats);

//       if (sessionId) {
//         setSelectedChatSessionId(sessionId);
//         const selectedChat = chats.find((c) => c.id === sessionId);
//         if (selectedChat) {
//           const responseText =
//             selectedChat.response ||
//             selectedChat.answer ||
//             selectedChat.message ||
//             "";
//           setCurrentResponse(responseText);
//           setAnimatedResponseContent(responseText);
//           setSelectedMessageId(selectedChat.id);
//           setHasResponse(true);
//           setHasAiResponse(true);
//           setForceSidebarCollapsed(true);
//         } else if (selectedFolder === "Test" && chats.length > 0) {
//           setHasResponse(true);
//           setHasAiResponse(true);
//           setForceSidebarCollapsed(true);
//         }
//       } else {
//         setHasResponse(false);
//         setHasAiResponse(false);
//         setForceSidebarCollapsed(false);
//       }
//     } catch (err) {
//       console.error("❌ Error fetching chats:", err);
//       setChatError("Failed to fetch chat history.");
//     } finally {
//       setLoadingChat(false);
//     }
//   };

//   // Animate typing effect
//   const animateResponse = (text) => {
//     setAnimatedResponseContent("");
//     setIsAnimatingResponse(true);
//     let i = 0;
//     const interval = setInterval(() => {
//       if (i < text.length) {
//         setAnimatedResponseContent((prev) => prev + text.charAt(i));
//         i++;
//         if (responseRef.current) {
//           responseRef.current.scrollTop = responseRef.current.scrollHeight;
//         }
//       } else {
//         clearInterval(interval);
//         setIsAnimatingResponse(false);
//       }
//     }, 20);
//   };

//   // Chat with AI using secret prompt
//   const chatWithAI = async (folder, secretId, currentSessionId) => {
//     try {
//       setLoadingChat(true);
//       setChatError(null);

//       const selectedSecret = secrets.find((s) => s.id === secretId);
//       if (!selectedSecret) {
//         throw new Error("No prompt found for selected analysis type");
//       }

//       let promptValue = selectedSecret.value;
//       const promptLabel = selectedSecret.name;

//       // If the secret doesn't have a value, fetch it
//       if (!promptValue) {
//         promptValue = await fetchSecretValue(secretId);
//       }

//       if (!promptValue) {
//         throw new Error("Secret prompt value is empty.");
//       }

//       // Send the actual prompt value to backend with metadata
//       const response = await documentApi.queryFolderDocuments(
//         folder,
//         promptValue,
//         currentSessionId,
//         {
//           used_secret_prompt: true,
//           prompt_label: promptLabel,
//           secret_id: secretId
//         }
//       );

//       if (response.sessionId) {
//         setSelectedChatSessionId(response.sessionId);
//       }

//       const history = Array.isArray(response.chatHistory)
//         ? response.chatHistory
//         : [];
//       setCurrentChatHistory(history);

//       if (history.length > 0) {
//         const latestMessage = history[history.length - 1];
//         const responseText =
//           latestMessage.response ||
//           latestMessage.answer ||
//           latestMessage.message ||
//           "";
//         setCurrentResponse(responseText);
//         setSelectedMessageId(latestMessage.id);
//         setHasResponse(true);
//         setHasAiResponse(true);
//         setForceSidebarCollapsed(true);
//         animateResponse(responseText);
//       }

//       return response;
//     } catch (error) {
//       setChatError(`Analysis failed: ${error.message}`);
//       throw error;
//     } finally {
//       setLoadingChat(false);
//     }
//   };

//   // Handle new message (combines regular chat and secret prompt)
//   const handleNewMessage = async () => {
//     if (!selectedFolder) return;

//     if (isSecretPromptSelected) {
//       // Using secret prompt
//       if (!selectedSecretId) {
//         setChatError("Please select an analysis type.");
//         return;
//       }
//       try {
//         await chatWithAI(selectedFolder, selectedSecretId, selectedChatSessionId);
//         setChatInput("");
//         setIsSecretPromptSelected(false);
//       } catch (error) {
//         // Error already handled
//       }
//     } else {
//       // Regular chat
//       if (!chatInput.trim()) return;

//       setLoadingChat(true);
//       setChatError(null);

//       try {
//         const response = await documentApi.queryFolderDocuments(
//           selectedFolder,
//           chatInput,
//           selectedChatSessionId,
//           {
//             used_secret_prompt: false
//           }
//         );

//         if (response.sessionId) {
//           setSelectedChatSessionId(response.sessionId);
//         }

//         const history = Array.isArray(response.chatHistory)
//           ? response.chatHistory
//           : [];
//         setCurrentChatHistory(history);

//         if (history.length > 0) {
//           const latestMessage = history[history.length - 1];
//           const responseText =
//             latestMessage.response ||
//             latestMessage.answer ||
//             latestMessage.message ||
//             "";
//           setCurrentResponse(responseText);
//           setSelectedMessageId(latestMessage.id);
//           setHasResponse(true);
//           setHasAiResponse(true);
//           setForceSidebarCollapsed(true);
//           animateResponse(responseText);
//         }
//         setChatInput("");
//       } catch (err) {
//         setChatError(
//           `Failed to send message: ${err.response?.data?.details || err.message}`
//         );
//       } finally {
//         setLoadingChat(false);
//       }
//     }
//   };

//   // Handle selecting a chat
//   const handleSelectChat = (chat) => {
//     setSelectedMessageId(chat.id);
//     const responseText = chat.response || chat.answer || chat.message || "";
//     setCurrentResponse(responseText);
//     setAnimatedResponseContent(responseText);
//     setIsAnimatingResponse(false);
//     setHasResponse(true);
//     setHasAiResponse(true);
//     setForceSidebarCollapsed(true);
//   };

//   // Handle new chat
//   const handleNewChat = () => {
//     setCurrentChatHistory([]);
//     setSelectedChatSessionId(null);
//     setHasResponse(false);
//     setHasAiResponse(false);
//     setForceSidebarCollapsed(false);
//     setChatInput("");
//     setSelectedMessageId(null);
//     setCurrentResponse("");
//     setAnimatedResponseContent("");
//     setIsSecretPromptSelected(false);
//     setSelectedSecretId(null);
//     // Reset to first secret as default
//     if (secrets.length > 0) {
//       setActiveDropdown(secrets[0].name);
//       setSelectedSecretId(secrets[0].id);
//     }
//   };

//   // Handle dropdown selection
//   const handleDropdownSelect = (secretName, secretId) => {
//     setActiveDropdown(secretName);
//     setSelectedSecretId(secretId);
//     setIsSecretPromptSelected(true);
//     setChatInput("");
//     setShowDropdown(false);
//   };

//   // Handle custom input change
//   const handleChatInputChange = (e) => {
//     setChatInput(e.target.value);
//     setIsSecretPromptSelected(false);
//     setActiveDropdown("Custom Query");
//   };

//   // Format relative time
//   const getRelativeTime = (dateString) => {
//     const date = new Date(dateString);
//     const now = new Date();
//     const diffInSeconds = Math.floor((now - date) / 1000);

//     if (diffInSeconds < 60) return `Last message ${diffInSeconds} seconds ago`;
//     if (diffInSeconds < 3600)
//       return `Last message ${Math.floor(diffInSeconds / 60)} minutes ago`;
//     if (diffInSeconds < 86400)
//       return `Last message ${Math.floor(diffInSeconds / 3600)} hours ago`;
//     return `Last message ${Math.floor(diffInSeconds / 86400)} days ago`;
//   };

//   const formatDate = (dateString) => {
//     try {
//       return new Date(dateString).toLocaleString();
//     } catch (e) {
//       return 'Invalid date';
//     }
//   };

//   // Copy to clipboard with feedback
//   const handleCopy = () => {
//     navigator.clipboard.writeText(currentResponse);
//     setShowCopyMessage(true);
//     setTimeout(() => setShowCopyMessage(false), 2000);
//   };

//   // Download as PDF with better formatting
//   const handleDownload = () => {
//     const doc = new jsPDF('p', 'pt', 'a4');
//     const pageWidth = doc.internal.pageSize.getWidth();
//     const pageHeight = doc.internal.pageSize.getHeight();
//     const margin = 40;
//     const maxWidth = pageWidth - 2 * margin;
//     let yPosition = margin;

//     // Helper function to add new page if needed
//     const checkPageBreak = (requiredSpace) => {
//       if (yPosition + requiredSpace > pageHeight - margin) {
//         doc.addPage();
//         yPosition = margin;
//         return true;
//       }
//       return false;
//     };

//     // Parse markdown and format for PDF
//     const lines = currentResponse.split('\n');
//     let inTable = false;
//     let tableData = [];
    
//     lines.forEach((line, index) => {
//       // Handle headers
//       if (line.startsWith('# ')) {
//         checkPageBreak(30);
//         doc.setFontSize(18);
//         doc.setFont(undefined, 'bold');
//         const text = line.replace('# ', '');
//         doc.text(text, margin, yPosition);
//         yPosition += 25;
//       } else if (line.startsWith('## ')) {
//         checkPageBreak(25);
//         doc.setFontSize(14);
//         doc.setFont(undefined, 'bold');
//         const text = line.replace('## ', '');
//         doc.text(text, margin, yPosition);
//         yPosition += 20;
//       } else if (line.startsWith('### ')) {
//         checkPageBreak(20);
//         doc.setFontSize(12);
//         doc.setFont(undefined, 'bold');
//         const text = line.replace('### ', '');
//         doc.text(text, margin, yPosition);
//         yPosition += 18;
//       }
//       // Handle tables
//       else if (line.includes('|')) {
//         if (!inTable) {
//           inTable = true;
//           tableData = [];
//         }
        
//         // Skip separator lines
//         if (!line.match(/^\|[\s-:|]+\|$/)) {
//           const cells = line.split('|').filter(cell => cell.trim()).map(cell => cell.trim());
//           tableData.push(cells);
//         }
        
//         // Check if next line is not a table (end of table)
//         if (index === lines.length - 1 || !lines[index + 1].includes('|')) {
//           inTable = false;
          
//           if (tableData.length > 0) {
//             checkPageBreak(tableData.length * 20 + 30);
            
//             // Calculate column widths
//             const numCols = tableData[0].length;
//             const colWidth = maxWidth / numCols;
            
//             // Draw table
//             doc.setFontSize(10);
//             tableData.forEach((row, rowIndex) => {
//               const isHeader = rowIndex === 0;
              
//               if (isHeader) {
//                 doc.setFont(undefined, 'bold');
//                 doc.setFillColor(240, 240, 240);
//               } else {
//                 doc.setFont(undefined, 'normal');
//               }
              
//               row.forEach((cell, colIndex) => {
//                 const x = margin + colIndex * colWidth;
//                 const y = yPosition;
                
//                 // Draw cell border
//                 doc.rect(x, y, colWidth, 20);
                
//                 // Fill header
//                 if (isHeader) {
//                   doc.rect(x, y, colWidth, 20, 'F');
//                 }
                
//                 // Draw text
//                 const cellText = doc.splitTextToSize(cell, colWidth - 10);
//                 doc.text(cellText, x + 5, y + 14);
//               });
              
//               yPosition += 20;
              
//               if (checkPageBreak(20)) {
//                 // Continue table on new page
//               }
//             });
            
//             yPosition += 10;
//             tableData = [];
//           }
//         }
//       }
//       // Handle bullet points
//       else if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
//         checkPageBreak(15);
//         doc.setFontSize(10);
//         doc.setFont(undefined, 'normal');
//         const text = line.replace(/^[\s-*]+/, '');
//         const wrappedText = doc.splitTextToSize('• ' + text, maxWidth - 20);
//         doc.text(wrappedText, margin + 10, yPosition);
//         yPosition += wrappedText.length * 12 + 5;
//       }
//       // Handle numbered lists
//       else if (line.match(/^\d+\.\s/)) {
//         checkPageBreak(15);
//         doc.setFontSize(10);
//         doc.setFont(undefined, 'normal');
//         const wrappedText = doc.splitTextToSize(line, maxWidth - 20);
//         doc.text(wrappedText, margin + 10, yPosition);
//         yPosition += wrappedText.length * 12 + 5;
//       }
//       // Handle bold text and regular paragraphs
//       else if (line.trim()) {
//         checkPageBreak(15);
//         doc.setFontSize(10);
//         doc.setFont(undefined, 'normal');
        
//         // Remove markdown formatting
//         let cleanText = line.replace(/\*\*(.*?)\*\*/g, '$1');
//         cleanText = cleanText.replace(/\*(.*?)\*/g, '$1');
//         cleanText = cleanText.replace(/`(.*?)`/g, '$1');
        
//         const wrappedText = doc.splitTextToSize(cleanText, maxWidth);
//         doc.text(wrappedText, margin, yPosition);
//         yPosition += wrappedText.length * 12 + 8;
//       }
//       // Empty line
//       else {
//         yPosition += 8;
//       }
//     });

//     doc.save('ai-response.pdf');
//     setShowDownloadMessage(true);
//     setTimeout(() => setShowDownloadMessage(false), 2000);
//   };

//   // Close dropdown when clicking outside
//   useEffect(() => {
//     const handleClickOutside = (event) => {
//       if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
//         setShowDropdown(false);
//       }
//     };

//     document.addEventListener("mousedown", handleClickOutside);
//     return () => {
//       document.removeEventListener("mousedown", handleClickOutside);
//     };
//   }, []);

//   // Load secrets on mount
//   useEffect(() => {
//     fetchSecrets();
//   }, []);

//   useEffect(() => {
//     setChatSessions([]);
//     setCurrentChatHistory([]);
//     setSelectedChatSessionId(null);
//     setHasResponse(false);
//     setHasAiResponse(false);
//     setForceSidebarCollapsed(false);

//     if (selectedFolder && selectedFolder !== "Test") {
//       fetchChatHistory();
//     }
//   }, [selectedFolder]);

//   if (!selectedFolder) {
//     return (
//       <div className="flex items-center justify-center h-full text-gray-400 text-lg bg-[#FDFCFB]">
//         Select a folder to start chatting.
//       </div>
//     );
//   }

//   return (
//     <div className="flex h-screen bg-white">
//       {/* Left Panel - Chat History */}
//       <div className={`${hasResponse ? 'w-[35%]' : 'w-full'} border-r border-gray-200 flex flex-col bg-white h-full`}>
//         {/* Header */}
//         <div className="p-4 border-b border-black border-opacity-20 flex-shrink-0">
//           <div className="flex items-center justify-between mb-4">
//             <h2 className="text-lg font-semibold text-gray-900">Questions</h2>
//             <button
//               onClick={handleNewChat}
//               className="px-3 py-1.5 text-sm font-medium text-white hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors" style={{ backgroundColor: '#21C1B6' }}
//             >
//               New Chat
//             </button>
//           </div>

//           {/* Search Input */}
//           <div className="relative mb-4">
//             <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
//             <input
//               type="text"
//               placeholder="Search questions..."
//               className="w-full pl-9 pr-3 py-2 bg-gray-100 rounded-lg text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
//             />
//           </div>
//         </div>

//         {/* Chat History List - Scrollable */}
//         <div className="flex-1 overflow-y-auto px-4 py-2">
//           <div className="space-y-2">
//             {currentChatHistory.map((chat) => (
//               <div
//                 key={chat.id}
//                 onClick={() => handleSelectChat(chat)}
//                 className={`p-3 rounded-lg border cursor-pointer transition-all duration-200 hover:shadow-md ${
//                   selectedMessageId === chat.id
//                     ? "bg-blue-50 border-blue-200 shadow-sm"
//                     : "bg-white border-gray-200 hover:bg-gray-50"
//                 }`}
//               >
//                 <div className="flex items-start justify-between">
//                   <div className="flex-1 min-w-0">
//                     <p className="text-sm font-medium text-gray-900 mb-1 line-clamp-2">
//                       {chat.question || chat.query || "Untitled"}
//                     </p>
//                     <p className="text-xs text-gray-500">
//                       {getRelativeTime(chat.created_at || chat.timestamp)}
//                     </p>
//                   </div>
//                   <button
//                     onClick={(e) => {
//                       e.stopPropagation();
//                     }}
//                     className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
//                   >
//                     <MoreVertical className="h-5 w-5 text-gray-400" />
//                   </button>
//                 </div>
//               </div>
//             ))}

//             {currentChatHistory.length === 0 && !loadingChat && (
//               <div className="text-center py-12">
//                 <MessageSquare className="h-12 w-12 mx-auto mb-4 text-gray-300" />
//                 <p className="text-gray-500">
//                   No chats yet. Start a conversation!
//                 </p>
//               </div>
//             )}

//             {loadingChat && currentChatHistory.length === 0 && (
//               <div className="flex justify-center py-8">
//                 <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
//               </div>
//             )}
//           </div>
//         </div>

//         {/* Input Area - Fixed at bottom */}
//         <div className="border-t border-gray-200 p-2 bg-white flex-shrink-0">
//           <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
//             <input
//               type="text"
//               placeholder={isSecretPromptSelected ? `Analysis: ${activeDropdown}` : "How can I help you today?"}
//               value={chatInput}
//               onChange={handleChatInputChange}
//               onKeyPress={(e) => e.key === "Enter" && handleNewMessage()}
//               className="w-full text-base text-gray-700 placeholder-gray-400 outline-none bg-transparent"
//               disabled={loadingChat}
//             />

//             {/* Action Buttons Row */}
//             <div className="flex items-center justify-between mt-2">
//               <div className="flex items-center space-x-2">
//                 {/* Analysis Dropdown */}
//                 <div className="relative" ref={dropdownRef}>
//                   <button
//                     onClick={() => setShowDropdown(!showDropdown)}
//                     disabled={isLoadingSecrets || loadingChat}
//                     className="flex items-center space-x-2 px-4 py-2.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50"
//                   >
//                     <BookOpen className="h-4 w-4" />
//                     <span className="text-sm font-medium">
//                       {isLoadingSecrets ? "Loading..." : activeDropdown}
//                     </span>
//                     <ChevronDown className="h-4 w-4" />
//                   </button>

//                   {showDropdown && !isLoadingSecrets && (
//                     <div className="absolute bottom-full left-0 mb-2 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto">
//                       {secrets.length > 0 ? (
//                         secrets.map((secret) => (
//                           <button
//                             key={secret.id}
//                             onClick={() =>
//                               handleDropdownSelect(secret.name, secret.id)
//                             }
//                             className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg"
//                           >
//                             {secret.name}
//                           </button>
//                         ))
//                       ) : (
//                         <div className="px-4 py-2.5 text-sm text-gray-500">
//                           No analysis prompts available
//                         </div>
//                       )}
//                     </div>
//                   )}
//                 </div>
//               </div>

//               <div className="flex items-center space-x-2">
//                 <button
//                   onClick={handleNewMessage}
//                   disabled={
//                     loadingChat ||
//                     (!chatInput.trim() && !isSecretPromptSelected)
//                   }
//                   style={{ backgroundColor: '#1AA49B' }} className="p-2.5 hover:bg-orange-400 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
//                 >
//                   {loadingChat ? (
//                     <Loader2 className="h-5 w-5 text-white animate-spin" />
//                   ) : (
//                     <Send className="h-5 w-5 text-white" />
//                   )}
//                 </button>
//               </div>
//             </div>
//           </div>

//           {/* Error Message */}
//           {chatError && (
//             <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
//               {chatError}
//             </div>
//           )}
//         </div>
//       </div>

//       {/* Right Panel - AI Response */}
//       {hasResponse && selectedMessageId && (
//         <div className="w-[65%] flex flex-col h-full">
//           {/* Header with Actions */}
//           <div className="flex items-center justify-between p-4 border-b border-gray-200">
//             <h2 className="text-xl font-semibold text-gray-900">AI Response</h2>
//             <div className="flex items-center space-x-2">
//               {/* Copy Button */}
//               <div className="relative">
//                 <button 
//                   onClick={handleCopy}
//                   className="bg-gray-200 hover:bg-gray-300 px-3 py-2 rounded-md flex items-center space-x-2 transition-colors"
//                 >
//                   <Copy className="w-4 h-4" />
//                   <span className="text-sm font-medium">Copy</span>
//                 </button>
//                 {showCopyMessage && (
//                   <div className="absolute top-full mt-2 left-1/2 transform -translate-x-1/2 bg-green-500 text-white px-3 py-1.5 rounded-md text-sm font-medium shadow-lg whitespace-nowrap z-10">
//                     Copied!
//                   </div>
//                 )}
//               </div>
              
//               {/* Download Button */}
//               <div className="relative">
//                 <button 
//                   onClick={handleDownload}
//                   className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 rounded-md flex items-center space-x-2 transition-colors"
//                 >
//                   <Download className="w-4 h-4" />
//                   <span className="text-sm font-medium">Download</span>
//                 </button>
//                 {showDownloadMessage && (
//                   <div className="absolute top-full mt-2 left-1/2 transform -translate-x-1/2 bg-green-500 text-white px-3 py-1.5 rounded-md text-sm font-medium shadow-lg whitespace-nowrap z-10">
//                     Downloaded!
//                   </div>
//                 )}
//               </div>
//             </div>
//           </div>
          
//           {/* Response Content */}
//           <div className="flex-1 overflow-y-auto" ref={responseRef}>
//             {currentResponse || animatedResponseContent ? (
//               <div className="px-6 py-6">
//                 <div className="max-w-none">
//                   {/* Response Header */}
//                   <div className="mb-6 pb-4 border-b border-gray-200">
//                     <div className="flex items-center justify-between">
//                       <div className="flex items-center space-x-2 text-sm text-gray-500">
//                         {currentChatHistory.find(msg => msg.id === selectedMessageId)?.timestamp && (
//                           <span>{formatDate(currentChatHistory.find(msg => msg.id === selectedMessageId).timestamp)}</span>
//                         )}
//                       </div>
//                     </div>
//                     {/* Original Question */}
//                     <div className="mt-3 p-3 bg-blue-50 rounded-lg border-l-4 border-blue-400">
//                       <p className="text-sm font-medium text-blue-900 mb-1">Question:</p>
//                       <p className="text-sm text-blue-800">
//                         {currentChatHistory.find(msg => msg.id === selectedMessageId)?.question || 'No question available'}
//                       </p>
//                     </div>
//                   </div>

//                   {/* Response Content */}
//                   <div className="prose prose-gray max-w-none">
//                     <ReactMarkdown
//                       remarkPlugins={[remarkGfm]}
//                       components={{
//                         h1: (props) => (
//                           <h1
//                             className="text-2xl font-bold mb-6 mt-8 text-black border-b-2 border-gray-300 pb-2"
//                             {...props}
//                           />
//                         ),
//                         h2: (props) => (
//                           <h2
//                             className="text-xl font-bold mb-4 mt-6 text-black"
//                             {...props}
//                           />
//                         ),
//                         h3: (props) => (
//                           <h3
//                             className="text-lg font-bold mb-3 mt-4 text-black"
//                             {...props}
//                           />
//                         ),
//                         p: (props) => (
//                           <p
//                             className="mb-4 leading-relaxed text-black text-justify"
//                             {...props}
//                           />
//                         ),
//                         strong: (props) => (
//                           <strong className="font-bold text-black" {...props} />
//                         ),
//                         ul: (props) => (
//                           <ul className="list-disc pl-5 mb-4 text-black" {...props} />
//                         ),
//                         ol: (props) => (
//                           <ol className="list-decimal pl-5 mb-4 text-black" {...props} />
//                         ),
//                         li: (props) => (
//                           <li className="mb-2 leading-relaxed text-black" {...props} />
//                         ),
//                         blockquote: (props) => (
//                           <blockquote className="border-l-4 border-gray-300 pl-4 italic text-gray-700 my-4" {...props} />
//                         ),
//                         code: ({ inline, ...props }) => {
//                           const className = inline 
//                             ? "bg-gray-100 px-1 py-0.5 rounded text-sm font-mono text-red-700" 
//                             : "block bg-gray-100 p-4 rounded-md text-sm font-mono overflow-x-auto my-4 text-red-700";
//                           return <code className={className} {...props} />;
//                         },
//                         table: (props) => (
//                           <div className="overflow-x-auto my-4">
//                             <table className="min-w-full border-collapse border border-gray-300" {...props} />
//                           </div>
//                         ),
//                         thead: (props) => (
//                           <thead className="bg-gray-100" {...props} />
//                         ),
//                         tbody: (props) => (
//                           <tbody {...props} />
//                         ),
//                         tr: (props) => (
//                           <tr className="border-b border-gray-300" {...props} />
//                         ),
//                         th: (props) => (
//                           <th className="border border-gray-300 px-4 py-2 text-left font-bold text-black" {...props} />
//                         ),
//                         td: (props) => (
//                           <td className="border border-gray-300 px-4 py-2 text-black" {...props} />
//                         ),
//                       }}
//                     >
//                       {animatedResponseContent || currentResponse}
//                     </ReactMarkdown>
//                     {isAnimatingResponse && (
//                       <span className="inline-block w-2 h-5 bg-gray-400 animate-pulse ml-1"></span>
//                     )}
//                   </div>
//                 </div>
//               </div>
//             ) : (
//               <div className="flex items-center justify-center h-full">
//                 <div className="text-center max-w-md px-6">
//                   <MessageSquare className="h-16 w-16 mx-auto mb-6 text-gray-300" />
//                   <h3 className="text-2xl font-semibold mb-4 text-gray-900">Select a Question</h3>
//                   <p className="text-gray-600 text-lg leading-relaxed">
//                     Click on any question from the left panel to view the AI response here.
//                   </p>
//                 </div>
//               </div>
//             )}
//           </div>
//         </div>
//       )}
//     </div>
//   );
// };

// export default ChatInterface;






// import React, { useState, useEffect, useContext, useRef } from "react";
// import { FileManagerContext } from "../../context/FileManagerContext";
// import documentApi from "../../services/documentApi";
// import {
//   Plus,
//   Shuffle,
//   Search,
//   BookOpen,
//   ChevronDown,
//   MoreVertical,
//   MessageSquare,
//   Loader2,
//   Send,
// } from "lucide-react";
// import ReactMarkdown from "react-markdown";
// import remarkGfm from "remark-gfm";
// import { SidebarContext } from "../../context/SidebarContext";

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
//   const [currentResponse, setCurrentResponse] = useState("");
//   const [animatedResponseContent, setAnimatedResponseContent] = useState("");
//   const [isAnimatingResponse, setIsAnimatingResponse] = useState(false);
//   const [selectedMessageId, setSelectedMessageId] = useState(null);
//   const [hasResponse, setHasResponse] = useState(false);

//   // Secret prompt states
//   const [secrets, setSecrets] = useState([]);
//   const [isLoadingSecrets, setIsLoadingSecrets] = useState(false);
//   const [selectedSecretId, setSelectedSecretId] = useState(null);
//   const [activeDropdown, setActiveDropdown] = useState("Summary");
//   const [showDropdown, setShowDropdown] = useState(false);
//   const [isSecretPromptSelected, setIsSecretPromptSelected] = useState(false);

//   const responseRef = useRef(null);
//   const dropdownRef = useRef(null);

//   // API Configuration
//   const API_BASE_URL = "https://gateway-service-120280829617.asia-south1.run.app";

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
//       if (token) {
//         return token;
//       }
//     }
//     return null;
//   };

//   // Fetch secrets list
//   const fetchSecrets = async () => {
//     try {
//       setIsLoadingSecrets(true);
//       setChatError(null);

//       const token = getAuthToken();
//       const headers = {
//         "Content-Type": "application/json",
//       };

//       if (token) {
//         headers["Authorization"] = `Bearer ${token}`;
//       }

//       const response = await fetch(`${API_BASE_URL}/files/secrets?fetch=true`, {
//         method: "GET",
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
//       console.error("Error fetching secrets:", error);
//       setChatError(`Failed to load analysis prompts: ${error.message}`);
//     } finally {
//       setIsLoadingSecrets(false);
//     }
//   };

//   // Fetch secret value by ID
//   const fetchSecretValue = async (secretId) => {
//     try {
//       const existingSecret = secrets.find((secret) => secret.id === secretId);
//       if (existingSecret && existingSecret.value) {
//         return existingSecret.value;
//       }

//       const token = getAuthToken();
//       const headers = {
//         "Content-Type": "application/json",
//       };

//       if (token) {
//         headers["Authorization"] = `Bearer ${token}`;
//       }

//       const response = await fetch(
//         `${API_BASE_URL}/files/secrets/${secretId}`,
//         {
//           method: "GET",
//           headers,
//         }
//       );

//       if (!response.ok) {
//         throw new Error(`Failed to fetch secret value: ${response.status}`);
//       }

//       const secretData = await response.json();
//       const promptValue =
//         secretData.value || secretData.prompt || secretData.content || secretData;

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

//   // Fetch chat history
//   const fetchChatHistory = async (sessionId) => {
//     if (!selectedFolder) return;

//     setLoadingChat(true);
//     setChatError(null);

//     try {
//       let data = await documentApi.getFolderChats(selectedFolder);
//       const chats = Array.isArray(data.chats) ? data.chats : [];
//       setCurrentChatHistory(chats);

//       if (sessionId) {
//         setSelectedChatSessionId(sessionId);
//         const selectedChat = chats.find((c) => c.id === sessionId);
//         if (selectedChat) {
//           const responseText =
//             selectedChat.response ||
//             selectedChat.answer ||
//             selectedChat.message ||
//             "";
//           setCurrentResponse(responseText);
//           setAnimatedResponseContent(responseText);
//           setSelectedMessageId(selectedChat.id);
//           setHasResponse(true);
//           setHasAiResponse(true);
//           setForceSidebarCollapsed(true);
//         } else if (selectedFolder === "Test" && chats.length > 0) {
//           setHasResponse(true);
//           setHasAiResponse(true);
//           setForceSidebarCollapsed(true);
//         }
//       } else {
//         setHasResponse(false);
//         setHasAiResponse(false);
//         setForceSidebarCollapsed(false);
//       }
//     } catch (err) {
//       console.error("❌ Error fetching chats:", err);
//       setChatError("Failed to fetch chat history.");
//     } finally {
//       setLoadingChat(false);
//     }
//   };

//   // Animate typing effect
//   const animateResponse = (text) => {
//     setAnimatedResponseContent("");
//     setIsAnimatingResponse(true);
//     let i = 0;
//     const interval = setInterval(() => {
//       if (i < text.length) {
//         setAnimatedResponseContent((prev) => prev + text.charAt(i));
//         i++;
//         if (responseRef.current) {
//           responseRef.current.scrollTop = responseRef.current.scrollHeight;
//         }
//       } else {
//         clearInterval(interval);
//         setIsAnimatingResponse(false);
//       }
//     }, 20);
//   };

//   // Chat with AI using secret prompt - CORRECTED
//   const chatWithAI = async (folder, secretId, currentSessionId) => {
//     try {
//       setLoadingChat(true);
//       setChatError(null);

//       const selectedSecret = secrets.find((s) => s.id === secretId);
//       if (!selectedSecret) {
//         throw new Error("No prompt found for selected analysis type");
//       }

//       let promptValue = selectedSecret.value;
//       const promptLabel = selectedSecret.name;

//       // If the secret doesn't have a value, fetch it
//       if (!promptValue) {
//         promptValue = await fetchSecretValue(secretId);
//       }

//       if (!promptValue) {
//         throw new Error("Secret prompt value is empty.");
//       }

//       // CORRECTED: Send the actual prompt value to backend with metadata
//       const response = await documentApi.queryFolderDocuments(
//         folder,
//         promptValue, // Send the actual prompt content
//         currentSessionId,
//         {
//           used_secret_prompt: true,  // Flag that this uses a secret prompt
//           prompt_label: promptLabel,  // Store the name/label of the prompt
//           secret_id: secretId         // Optional: store the secret ID reference
//         }
//       );

//       if (response.sessionId) {
//         setSelectedChatSessionId(response.sessionId);
//       }

//       const history = Array.isArray(response.chatHistory)
//         ? response.chatHistory
//         : [];
//       setCurrentChatHistory(history);

//       if (history.length > 0) {
//         const latestMessage = history[history.length - 1];
//         const responseText =
//           latestMessage.response ||
//           latestMessage.answer ||
//           latestMessage.message ||
//           "";
//         setCurrentResponse(responseText);
//         setSelectedMessageId(latestMessage.id);
//         setHasResponse(true);
//         setHasAiResponse(true);
//         setForceSidebarCollapsed(true);
//         animateResponse(responseText);
//       }

//       return response;
//     } catch (error) {
//       setChatError(`Analysis failed: ${error.message}`);
//       throw error;
//     } finally {
//       setLoadingChat(false);
//     }
//   };

//   // Handle new message (combines regular chat and secret prompt)
//   const handleNewMessage = async () => {
//     if (!selectedFolder) return;

//     if (isSecretPromptSelected) {
//       // Using secret prompt
//       if (!selectedSecretId) {
//         setChatError("Please select an analysis type.");
//         return;
//       }
//       try {
//         await chatWithAI(selectedFolder, selectedSecretId, selectedChatSessionId);
//         setChatInput("");
//         setIsSecretPromptSelected(false); // Reset after sending
//       } catch (error) {
//         // Error already handled
//       }
//     } else {
//       // Regular chat
//       if (!chatInput.trim()) return;

//       setLoadingChat(true);
//       setChatError(null);

//       try {
//         const response = await documentApi.queryFolderDocuments(
//           selectedFolder,
//           chatInput,
//           selectedChatSessionId,
//           {
//             used_secret_prompt: false // Explicitly mark as regular chat
//           }
//         );

//         if (response.sessionId) {
//           setSelectedChatSessionId(response.sessionId);
//         }

//         const history = Array.isArray(response.chatHistory)
//           ? response.chatHistory
//           : [];
//         setCurrentChatHistory(history);

//         if (history.length > 0) {
//           const latestMessage = history[history.length - 1];
//           const responseText =
//             latestMessage.response ||
//             latestMessage.answer ||
//             latestMessage.message ||
//             "";
//           setCurrentResponse(responseText);
//           setSelectedMessageId(latestMessage.id);
//           setHasResponse(true);
//           setHasAiResponse(true);
//           setForceSidebarCollapsed(true);
//           animateResponse(responseText);
//         }
//         setChatInput("");
//       } catch (err) {
//         setChatError(
//           `Failed to send message: ${err.response?.data?.details || err.message}`
//         );
//       } finally {
//         setLoadingChat(false);
//       }
//     }
//   };

//   // Handle selecting a chat
//   const handleSelectChat = (chat) => {
//     setSelectedMessageId(chat.id);
//     const responseText = chat.response || chat.answer || chat.message || "";
//     setCurrentResponse(responseText);
//     setAnimatedResponseContent(responseText);
//     setIsAnimatingResponse(false);
//     setHasResponse(true);
//     setHasAiResponse(true);
//     setForceSidebarCollapsed(true);
//   };

//   // Handle new chat
//   const handleNewChat = () => {
//     setCurrentChatHistory([]);
//     setSelectedChatSessionId(null);
//     setHasResponse(false);
//     setHasAiResponse(false);
//     setForceSidebarCollapsed(false);
//     setChatInput("");
//     setSelectedMessageId(null);
//     setCurrentResponse("");
//     setAnimatedResponseContent("");
//     setIsSecretPromptSelected(false);
//     setSelectedSecretId(null);
//     // Reset to first secret as default
//     if (secrets.length > 0) {
//       setActiveDropdown(secrets[0].name);
//       setSelectedSecretId(secrets[0].id);
//     }
//   };

//   // Handle dropdown selection
//   const handleDropdownSelect = (secretName, secretId) => {
//     setActiveDropdown(secretName);
//     setSelectedSecretId(secretId);
//     setIsSecretPromptSelected(true);
//     setChatInput(""); // Clear any custom input
//     setShowDropdown(false);
//   };

//   // Handle custom input change
//   const handleChatInputChange = (e) => {
//     setChatInput(e.target.value);
//     setIsSecretPromptSelected(false); // Switch to custom query mode
//     setActiveDropdown("Custom Query");
//   };

//   // Format relative time
//   const getRelativeTime = (dateString) => {
//     const date = new Date(dateString);
//     const now = new Date();
//     const diffInSeconds = Math.floor((now - date) / 1000);

//     if (diffInSeconds < 60) return `Last message ${diffInSeconds} seconds ago`;
//     if (diffInSeconds < 3600)
//       return `Last message ${Math.floor(diffInSeconds / 60)} minutes ago`;
//     if (diffInSeconds < 86400)
//       return `Last message ${Math.floor(diffInSeconds / 3600)} hours ago`;
//     return `Last message ${Math.floor(diffInSeconds / 86400)} days ago`;
//   };

//   const formatDate = (dateString) => {
//     try {
//       return new Date(dateString).toLocaleString();
//     } catch (e) {
//       return 'Invalid date';
//     }
//   };

//   // Close dropdown when clicking outside
//   useEffect(() => {
//     const handleClickOutside = (event) => {
//       if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
//         setShowDropdown(false);
//       }
//     };

//     document.addEventListener("mousedown", handleClickOutside);
//     return () => {
//       document.removeEventListener("mousedown", handleClickOutside);
//     };
//   }, []);

//   // Load secrets on mount
//   useEffect(() => {
//     fetchSecrets();
//   }, []);

//   useEffect(() => {
//     setChatSessions([]);
//     setCurrentChatHistory([]);
//     setSelectedChatSessionId(null);
//     setHasResponse(false);
//     setHasAiResponse(false);
//     setForceSidebarCollapsed(false);

//     if (selectedFolder && selectedFolder !== "Test") {
//       fetchChatHistory();
//     }
//   }, [selectedFolder]);

//   if (!selectedFolder) {
//     return (
//       <div className="flex items-center justify-center h-full text-gray-400 text-lg bg-[#FDFCFB]">
//         Select a folder to start chatting.
//       </div>
//     );
//   }
//   const containerStyle = {
//     marginLeft: '0px',
//     marginRight: '0px',
//   };
//   const aiResponseStyle = {
//     fontFamily: '"Crimson Text", Georgia, "Times New Roman", serif',
//     fontSize: '20px'
//   };

//   return (
//     <div className="flex h-screen bg-white" style={containerStyle}>
//       {/* Left Panel - Chat History */}
//       <div className={`${hasResponse ? 'w-[40%]' : 'w-full'} border-r border-gray-200 flex flex-col bg-white h-full`}>
//         {/* Header */}
//         <div className="p-4 border-b border-black border-opacity-20 flex-shrink-0">
//           <div className="flex items-center justify-between mb-4">
//             <h2 className="text-lg font-semibold text-gray-900">Questions</h2>
//             <button
//               onClick={handleNewChat}
//               className="px-3 py-1.5 text-sm font-medium text-white hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors" style={{ backgroundColor: '#21C1B6' }}
//             >
//               New Chat
//             </button>
//           </div>

//           {/* Search Input */}
//           <div className="relative mb-4">
//             <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
//             <input
//               type="text"
//               placeholder="Search questions..."
//               className="w-full pl-9 pr-3 py-2 bg-gray-100 rounded-lg text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
//             />
//           </div>
//         </div>

//         {/* Chat History List - Scrollable */}
//         <div className="flex-1 overflow-y-auto px-4 py-2">
//           <div className="space-y-2">
//             {currentChatHistory.map((chat) => (
//               <div
//                 key={chat.id}
//                 onClick={() => handleSelectChat(chat)}
//                 className={`p-3 rounded-lg border cursor-pointer transition-all duration-200 hover:shadow-md ${
//                   selectedMessageId === chat.id
//                     ? "bg-blue-50 border-blue-200 shadow-sm"
//                     : "bg-white border-gray-200 hover:bg-gray-50"
//                 }`}
//               >
//                 <div className="flex items-start justify-between">
//                   <div className="flex-1 min-w-0">
//                     <p className="text-sm font-medium text-gray-900 mb-1 line-clamp-2">
//                       {chat.question || chat.query || "Untitled"}
//                     </p>
//                     <p className="text-xs text-gray-500">
//                       {getRelativeTime(chat.created_at || chat.timestamp)}
//                     </p>
//                   </div>
//                   <button
//                     onClick={(e) => {
//                       e.stopPropagation();
//                     }}
//                     className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
//                   >
//                     <MoreVertical className="h-5 w-5 text-gray-400" />
//                   </button>
//                 </div>
//               </div>
//             ))}

//             {currentChatHistory.length === 0 && !loadingChat && (
//               <div className="text-center py-12">
//                 <MessageSquare className="h-12 w-12 mx-auto mb-4 text-gray-300" />
//                 <p className="text-gray-500">
//                   No chats yet. Start a conversation!
//                 </p>
//               </div>
//             )}

//             {loadingChat && currentChatHistory.length === 0 && (
//               <div className="flex justify-center py-8">
//                 <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
//               </div>
//             )}
//           </div>
//         </div>

//         {/* Input Area - Fixed at bottom */}
//         <div className="border-t border-gray-200 p-2 bg-white flex-shrink-0">
//           <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
//             <input
//               type="text"
//               placeholder={isSecretPromptSelected ? `Analysis: ${activeDropdown}` : "How can I help you today?"}
//               value={chatInput}
//               onChange={handleChatInputChange}
//               onKeyPress={(e) => e.key === "Enter" && handleNewMessage()}
//               className="w-full text-base text-gray-700 placeholder-gray-400 outline-none bg-transparent"
//               disabled={loadingChat}
//             />

//             {/* Action Buttons Row */}
//             <div className="flex items-center justify-between mt-2">
//               <div className="flex items-center space-x-2">
//                 {/* Analysis Dropdown */}
//                 <div className="relative" ref={dropdownRef}>
//                   <button
//                     onClick={() => setShowDropdown(!showDropdown)}
//                     disabled={isLoadingSecrets || loadingChat}
//                     className="flex items-center space-x-2 px-4 py-2.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50"
//                   >
//                     <BookOpen className="h-4 w-4" />
//                     <span className="text-sm font-medium">
//                       {isLoadingSecrets ? "Loading..." : activeDropdown}
//                     </span>
//                     <ChevronDown className="h-4 w-4" />
//                   </button>

//                   {showDropdown && !isLoadingSecrets && (
//                     <div className="absolute bottom-full left-0 mb-2 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto">
//                       {secrets.length > 0 ? (
//                         secrets.map((secret) => (
//                           <button
//                             key={secret.id}
//                             onClick={() =>
//                               handleDropdownSelect(secret.name, secret.id)
//                             }
//                             className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg"
//                           >
//                             {secret.name}
//                           </button>
//                         ))
//                       ) : (
//                         <div className="px-4 py-2.5 text-sm text-gray-500">
//                           No analysis prompts available
//                         </div>
//                       )}
//                     </div>
//                   )}
//                 </div>
//               </div>

//               <div className="flex items-center space-x-2">
//                 <button
//                   onClick={handleNewMessage}
//                   disabled={
//                     loadingChat ||
//                     (!chatInput.trim() && !isSecretPromptSelected)
//                   }
//                   style={{ backgroundColor: '#1AA49B' }} className="p-2.5 hover:bg-orange-400 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
//                 >
//                   {loadingChat ? (
//                     <Loader2 className="h-5 w-5 text-white animate-spin" />
//                   ) : (
//                     <Send className="h-5 w-5 text-white" />
//                   )}
//                 </button>
//               </div>
//             </div>
//           </div>

//           {/* Error Message */}
//           {chatError && (
//             <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
//               {chatError}
//             </div>
//           )}
//         </div>
//       </div>

//       {/* Right Panel - AI Response */}
//       {hasResponse && selectedMessageId && (
//         <div className="w-[60%] flex flex-col h-full">
//           <div className="flex-1 overflow-y-auto" ref={responseRef}>
//             {currentResponse || animatedResponseContent ? (
//               <div className="px-2 py-2" style={aiResponseStyle}>
//                 <div className="max-w-none">
//                   {/* Response Header */}
//                   <div className="mb-6 pb-4 border-b border-gray-200">
//                     <div className="flex items-center justify-between">
//                       <h2 className="text-xl font-semibold text-gray-900">AI Response</h2>
//                       <div className="flex items-center space-x-2 text-sm text-gray-500">
//                         {currentChatHistory.find(msg => msg.id === selectedMessageId)?.timestamp && (
//                           <span>{formatDate(currentChatHistory.find(msg => msg.id === selectedMessageId).timestamp)}</span>
//                         )}
//                       </div>
//                     </div>
//                     {/* Original Question */}
//                     <div className="mt-3 p-3 bg-blue-50 rounded-lg border-l-4 border-blue-400">
//                       <p className="text-sm font-medium text-blue-900 mb-1">Question:</p>
//                       <p className="text-sm text-blue-800">
//                         {currentChatHistory.find(msg => msg.id === selectedMessageId)?.question || 'No question available'}
//                       </p>
//                     </div>
//                   </div>

//                   {/* Response Content */}
//                   <div className="prose prose-gray max-w-none">
//                     <ReactMarkdown
//                       remarkPlugins={[remarkGfm]}
//                       components={{
//                         h1: (props) => (
//                           <h1
//                             className="text-2xl font-bold mb-6 mt-8 text-black border-b-2 border-gray-300 pb-2"
//                             {...props}
//                           />
//                         ),
//                         h2: (props) => (
//                           <h2
//                             className="text-xl font-bold mb-4 mt-6 text-black"
//                             {...props}
//                           />
//                         ),
//                         h3: (props) => (
//                           <h3
//                             className="text-lg font-bold mb-3 mt-4 text-black"
//                             {...props}
//                           />
//                         ),
//                         p: (props) => (
//                           <p
//                             className="mb-4 leading-relaxed text-black text-justify"
//                             {...props}
//                           />
//                         ),
//                         strong: (props) => (
//                           <strong className="font-bold text-black" {...props} />
//                         ),
//                         ul: (props) => (
//                           <ul className="list-disc pl-5 mb-4 text-black" {...props} />
//                         ),
//                         ol: (props) => (
//                           <ol className="list-decimal pl-5 mb-4 text-black" {...props} />
//                         ),
//                         li: (props) => (
//                           <li className="mb-2 leading-relaxed text-black" {...props} />
//                         ),
//                         blockquote: (props) => (
//                           <blockquote className="border-l-4 border-gray-300 pl-4 italic text-gray-700 my-4" {...props} />
//                         ),
//                         code: ({ inline, ...props }) => {
//                           const className = inline 
//                             ? "bg-gray-100 px-1 py-0.5 rounded text-sm font-mono text-red-700" 
//                             : "block bg-gray-100 p-4 rounded-md text-sm font-mono overflow-x-auto my-4 text-red-700";
//                           return <code className={className} {...props} />;
//                         },
//                       }}
//                     >
//                       {animatedResponseContent || currentResponse}
//                     </ReactMarkdown>
//                     {isAnimatingResponse && (
//                       <span className="inline-block w-2 h-5 bg-gray-400 animate-pulse ml-1"></span>
//                     )}
//                   </div>
//                 </div>
//               </div>
//             ) : (
//               <div className="flex items-center justify-center h-full">
//                 <div className="text-center max-w-md px-6">
//                   <MessageSquare className="h-16 w-16 mx-auto mb-6 text-gray-300" />
//                   <h3 className="text-2xl font-semibold mb-4 text-gray-900">Select a Question</h3>
//                   <p className="text-gray-600 text-lg leading-relaxed">
//                     Click on any question from the left panel to view the AI response here.
//                   </p>
//                 </div>
//               </div>
//             )}
//           </div>
//         </div>
//       )}
//     </div>
//   );
// };

// export default ChatInterface;







// import React, { useState, useEffect, useContext, useRef } from "react";
// import { FileManagerContext } from "../../context/FileManagerContext";
// import documentApi from "../../services/documentApi";
// import {
//  Plus,
//  Shuffle,
//  Search,
//  BookOpen,
//  ChevronDown,
//  MoreVertical,
//  MessageSquare,
//  Loader2,
//  Send,
// } from "lucide-react";
// import ReactMarkdown from "react-markdown";
// import remarkGfm from "remark-gfm";
// import { SidebarContext } from "../../context/SidebarContext";

// const ChatInterface = () => {
//  const {
//  selectedFolder,
//  setChatSessions,
//  selectedChatSessionId,
//  setSelectedChatSessionId,
//  setHasAiResponse,
//  } = useContext(FileManagerContext);
//  const { setForceSidebarCollapsed } = useContext(SidebarContext);

//  const [currentChatHistory, setCurrentChatHistory] = useState([]);
//  const [loadingChat, setLoadingChat] = useState(false);
//  const [chatError, setChatError] = useState(null);

//  const [chatInput, setChatInput] = useState("");
//  const [currentResponse, setCurrentResponse] = useState("");
//  const [animatedResponseContent, setAnimatedResponseContent] = useState("");
//  const [isAnimatingResponse, setIsAnimatingResponse] = useState(false);
//  const [selectedMessageId, setSelectedMessageId] = useState(null);
//  const [hasResponse, setHasResponse] = useState(false);

//  // Secret prompt states
//  const [secrets, setSecrets] = useState([]);
//  const [isLoadingSecrets, setIsLoadingSecrets] = useState(false);
//  const [selectedSecretId, setSelectedSecretId] = useState(null);
//  const [selectedLlmName, setSelectedLlmName] = useState(null); // Declare selectedLlmName state
//  const [activeDropdown, setActiveDropdown] = useState("Summary");
//  const [showDropdown, setShowDropdown] = useState(false);
//  const [isSecretPromptSelected, setIsSecretPromptSelected] = useState(false);

//  const responseRef = useRef(null);
//  const dropdownRef = useRef(null);

//  // API Configuration
//  const API_BASE_URL = "https://gateway-service-120280829617.asia-south1.run.app";

//  const getAuthToken = () => {
//  const tokenKeys = [
//  "authToken",
//  "token",
//  "accessToken",
//  "jwt",
//  "bearerToken",
//  "auth_token",
//  "access_token",
//  "api_token",
//  "userToken",
//  ];

//  for (const key of tokenKeys) {
//  const token = localStorage.getItem(key);
//  if (token) {
//  return token;
//  }
//  }
//  return null;
//  };

//  // Fetch secrets list
//  const fetchSecrets = async () => {
//  try {
//  setIsLoadingSecrets(true);
//  setChatError(null);

//  const token = getAuthToken();
//  const headers = {
//  "Content-Type": "application/json",
//  };

//  if (token) {
//  headers["Authorization"] = `Bearer ${token}`;
//  }

//  const response = await fetch(`${API_BASE_URL}/files/secrets?fetch=true`, {
//  method: "GET",
//  headers,
//  });

//  if (!response.ok) {
//  throw new Error(`Failed to fetch secrets: ${response.status}`);
//  }

//  const secretsData = await response.json();
//  setSecrets(secretsData || []);

//  if (secretsData && secretsData.length > 0) {
//  setActiveDropdown(secretsData[0].name);
//  setSelectedSecretId(secretsData[0].id);
//  setSelectedLlmName(secretsData[0].llm_name); // Ensure LLM name is set
//  setIsSecretPromptSelected(true); // Set to true when a default secret is selected
//  } else {
//  setActiveDropdown('Custom Query'); // Default to Custom Query if no secrets
//  setSelectedSecretId(null);
//  setSelectedLlmName(null);
//  setIsSecretPromptSelected(false);
//  }
//  } catch (error) {
//  console.error("Error fetching secrets:", error);
//  setChatError(`Failed to load analysis prompts: ${error.message}`);
//  } finally {
//  setIsLoadingSecrets(false);
//  }
//  };

//  // Fetch secret value by ID
//  const fetchSecretValue = async (secretId) => {
//  try {
//  const existingSecret = secrets.find((secret) => secret.id === secretId);
//  if (existingSecret && existingSecret.value) {
//  return existingSecret.value;
//  }

//  const token = getAuthToken();
//  const headers = {
//  "Content-Type": "application/json",
//  };

//  if (token) {
//  headers["Authorization"] = `Bearer ${token}`;
//  }

//  const response = await fetch(
//  `${API_BASE_URL}/files/secrets/${secretId}`,
//  {
//  method: "GET",
//  headers,
//  }
//  );

//  if (!response.ok) {
//  throw new Error(`Failed to fetch secret value: ${response.status}`);
//  }

//  const secretData = await response.json();
//  const promptValue =
//  secretData.value || secretData.prompt || secretData.content || secretData;

//  setSecrets((prevSecrets) =>
//  prevSecrets.map((secret) =>
//  secret.id === secretId ? { ...secret, value: promptValue } : secret
//  )
//  );

//  return promptValue || "";
//  } catch (error) {
//  console.error("Error fetching secret value:", error);
//  throw new Error("Failed to retrieve analysis prompt");
//  }
//  };

//  // Fetch chat history
//  const fetchChatHistory = async (sessionId) => {
//  if (!selectedFolder) return;

//  setLoadingChat(true);
//  setChatError(null);

//  try {
//  let data = await documentApi.getFolderChats(selectedFolder);
//  const chats = Array.isArray(data.chats) ? data.chats : [];
//  setCurrentChatHistory(chats);

//  if (sessionId) {
//  setSelectedChatSessionId(sessionId);
//  const selectedChat = chats.find((c) => c.id === sessionId);
//  if (selectedChat) {
//  const responseText =
//  selectedChat.response ||
//  selectedChat.answer ||
//  selectedChat.message ||
//  "";
//  setCurrentResponse(responseText);
//  setAnimatedResponseContent(responseText);
//  setSelectedMessageId(selectedChat.id);
//  setHasResponse(true);
//  setHasAiResponse(true);
//  setForceSidebarCollapsed(true);
//  } else if (selectedFolder === "Test" && chats.length > 0) {
//  setHasResponse(true);
//  setHasAiResponse(true);
//  setForceSidebarCollapsed(true);
//  }
//  } else {
//  setHasResponse(false);
//  setHasAiResponse(false);
//  setForceSidebarCollapsed(false);
//  }
//  } catch (err) {
//  console.error("❌ Error fetching chats:", err);
//  setChatError("Failed to fetch chat history.");
//  } finally {
//  setLoadingChat(false);
//  }
//  };

//  // Animate typing effect
//  const animateResponse = (text) => {
//  setAnimatedResponseContent("");
//  setIsAnimatingResponse(true);
//  let i = 0;
//  const interval = setInterval(() => {
//  if (i < text.length) {
//  setAnimatedResponseContent((prev) => prev + text.charAt(i));
//  i++;
//  if (responseRef.current) {
//  responseRef.current.scrollTop = responseRef.current.scrollHeight;
//  }
//  } else {
//  clearInterval(interval);
//  setIsAnimatingResponse(false);
//  }
//  }, 20);
//  };

//  // Chat with AI using secret prompt - CORRECTED
//  const chatWithAI = async (folder, secretId, currentSessionId) => {
//  try {
//  setLoadingChat(true);
//  setChatError(null);

//  const selectedSecret = secrets.find((s) => s.id === secretId);
//  if (!selectedSecret) {
//  throw new Error("No prompt found for selected analysis type");
//  }

//  let promptValue = selectedSecret.value;
//  const promptLabel = selectedSecret.name;

//  // If the secret doesn't have a value, fetch it
//  if (!promptValue) {
//  promptValue = await fetchSecretValue(secretId);
//  }

//  if (!promptValue) {
//  throw new Error("Secret prompt value is empty.");
//  }

//  // CORRECTED: Send the actual prompt value to backend with metadata
//  const response = await documentApi.queryFolderDocuments(
//  folder,
//  promptValue, // Send the actual prompt content
//  currentSessionId,
//  {
//  used_secret_prompt: true, // Flag that this uses a secret prompt
//  prompt_label: promptLabel, // Store the name/label of the prompt
//  secret_id: secretId // Optional: store the secret ID reference
//  }
//  );

//  if (response.sessionId) {
//  setSelectedChatSessionId(response.sessionId);
//  }

//  const history = Array.isArray(response.chatHistory)
//  ? response.chatHistory
//  : [];
//  setCurrentChatHistory(history);

//  if (history.length > 0) {
//  const latestMessage = history[history.length - 1];
//  const responseText =
//  latestMessage.response ||
//  latestMessage.answer ||
//  latestMessage.message ||
//  "";
//  setCurrentResponse(responseText);
//  setSelectedMessageId(latestMessage.id);
//  setHasResponse(true);
//  setHasAiResponse(true);
//  setForceSidebarCollapsed(true);
//  animateResponse(responseText);
//  }

//  return response;
//  } catch (error) {
//  setChatError(`Analysis failed: ${error.message}`);
//  throw error;
//  } finally {
//  setLoadingChat(false);
//  }
//  };

//  // Handle new message (combines regular chat and secret prompt)
//  const handleNewMessage = async () => {
//  if (!selectedFolder) return;

//  if (isSecretPromptSelected) {
//  // Using secret prompt
//  if (!selectedSecretId) {
//  setChatError("Please select an analysis type.");
//  return;
//  }
//  try {
//  await chatWithAI(selectedFolder, selectedSecretId, selectedChatSessionId);
//  setChatInput("");
//  setIsSecretPromptSelected(false); // Reset after sending
//  } catch (error) {
//  // Error already handled
//  }
//  } else {
//  // Regular chat
//  if (!chatInput.trim()) return;

//  setLoadingChat(true);
//  setChatError(null);

//  try {
//  const response = await documentApi.queryFolderDocuments(
//  selectedFolder,
//  chatInput,
//  selectedChatSessionId,
//  {
//  used_secret_prompt: false // Explicitly mark as regular chat
//  }
//  );

//  if (response.sessionId) {
//  setSelectedChatSessionId(response.sessionId);
//  }

//  const history = Array.isArray(response.chatHistory)
//  ? response.chatHistory
//  : [];
//  setCurrentChatHistory(history);

//  if (history.length > 0) {
//  const latestMessage = history[history.length - 1];
//  const responseText =
//  latestMessage.response ||
//  latestMessage.answer ||
//  latestMessage.message ||
//  "";
//  setCurrentResponse(responseText);
//  setSelectedMessageId(latestMessage.id);
//  setHasResponse(true);
//  setHasAiResponse(true);
//  setForceSidebarCollapsed(true);
//  animateResponse(responseText);
//  }
//  setChatInput("");
//  } catch (err) {
//  setChatError(
//  `Failed to send message: ${err.response?.data?.details || err.message}`
//  );
//  } finally {
//  setLoadingChat(false);
//  }
//  }
//  };

//  // Handle selecting a chat
//  const handleSelectChat = (chat) => {
//  setSelectedMessageId(chat.id);
//  const responseText = chat.response || chat.answer || chat.message || "";
//  setCurrentResponse(responseText);
//  setAnimatedResponseContent(responseText);
//  setIsAnimatingResponse(false);
//  setHasResponse(true);
//  setHasAiResponse(true);
//  setForceSidebarCollapsed(true);
//  };

//  // Handle new chat
//  const handleNewChat = () => {
//  setCurrentChatHistory([]);
//  setSelectedChatSessionId(null);
//  setHasResponse(false);
//  setHasAiResponse(false);
//  setForceSidebarCollapsed(false);
//  setChatInput("");
//  setSelectedMessageId(null);
//  setCurrentResponse("");
//  setAnimatedResponseContent("");
//  setIsSecretPromptSelected(false);
//  setSelectedSecretId(null);
//  setSelectedLlmName(null); // Reset LLM name
//  // Reset to first secret as default or 'Custom Query'
//  if (secrets.length > 0) {
//  setActiveDropdown(secrets[0].name);
//  setSelectedSecretId(secrets[0].id);
//  setSelectedLlmName(secrets[0].llm_name); // Ensure LLM name is set
//  setIsSecretPromptSelected(true); // Set to true when resetting to default secret
//  } else {
//  setActiveDropdown('Custom Query'); // If no secrets, explicitly set to Custom Query
//  setIsSecretPromptSelected(false);
//  }
//  };

//  // Handle dropdown selection
//  const handleDropdownSelect = (secretName, secretId) => {
//  setActiveDropdown(secretName);
//  setSelectedSecretId(secretId);
//  setIsSecretPromptSelected(true);
//  setChatInput(""); // Clear any custom input
//  setShowDropdown(false);
//  };

//  // Handle custom input change
//  const handleChatInputChange = (e) => {
//  setChatInput(e.target.value);
//  // If a secret prompt is currently selected, typing should be considered additional input for that prompt.
//  // Only switch to "Custom Query" if no secret prompt is selected AND the dropdown is not already "Custom Query".
//  if (!isSecretPromptSelected && activeDropdown !== 'Custom Query') {
//  setActiveDropdown('Custom Query');
//  setSelectedSecretId(null);
//  setSelectedLlmName(null); // Reset LLM name when switching to custom query
//  }
//  };

//  // Format relative time
//  const getRelativeTime = (dateString) => {
//  const date = new Date(dateString);
//  const now = new Date();
//  const diffInSeconds = Math.floor((now - date) / 1000);

//  if (diffInSeconds < 60) return `Last message ${diffInSeconds} seconds ago`;
//  if (diffInSeconds < 3600)
//  return `Last message ${Math.floor(diffInSeconds / 60)} minutes ago`;
//  if (diffInSeconds < 86400)
//  return `Last message ${Math.floor(diffInSeconds / 3600)} hours ago`;
//  return `Last message ${Math.floor(diffInSeconds / 86400)} days ago`;
//  };

//  const formatDate = (dateString) => {
//  try {
//  return new Date(dateString).toLocaleString();
//  } catch (e) {
//  return 'Invalid date';
//  }
//  };

//  // Close dropdown when clicking outside
//  useEffect(() => {
//  const handleClickOutside = (event) => {
//  if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
//  setShowDropdown(false);
//  }
//  };

//  document.addEventListener("mousedown", handleClickOutside);
//  return () => {
//  document.removeEventListener("mousedown", handleClickOutside);
//  };
//  }, []);

//  // Load secrets on mount
//  useEffect(() => {
//  fetchSecrets();
//  }, []);

//  useEffect(() => {
//  setChatSessions([]);
//  setCurrentChatHistory([]);
//  setSelectedChatSessionId(null);
//  setHasResponse(false);
//  setHasAiResponse(false);
//  setForceSidebarCollapsed(false);

//  if (selectedFolder && selectedFolder !== "Test") {
//  fetchChatHistory();
//  }
//  }, [selectedFolder]);

//  if (!selectedFolder) {
//  return (
//  <div className="flex items-center justify-center h-full text-gray-400 text-lg bg-[#FDFCFB]">
//  Select a folder to start chatting.
//  </div>
//  );
//  }

//  return (
//  <div className="flex h-screen bg-white">
//  {/* Left Panel - Chat History */}
//  <div className={`${hasResponse ? 'w-1/2' : 'w-full'} border-r border-gray-200 flex flex-col bg-white h-full`}>
//  {/* Header */}
//  <div className="p-4 border-b border-black border-opacity-20 flex-shrink-0">
//  <div className="flex items-center justify-between mb-4">
//  <h2 className="text-lg font-semibold text-gray-900">Questions</h2>
//  <button
//  onClick={handleNewChat}
//  className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
//  >
//  New Chat
//  </button>
//  </div>

//  {/* Search Input */}
//  <div className="relative mb-4">
//  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
//  <input
//  type="text"
//  placeholder="Search questions..."
//  className="w-full pl-9 pr-3 py-2 bg-gray-100 rounded-lg text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
//  />
//  </div>
//  </div>

//  {/* Chat History List - Scrollable */}
//  <div className="flex-1 overflow-y-auto px-4 py-2">
//  <div className="space-y-2">
//  {currentChatHistory.map((chat) => (
//  <div
//  key={chat.id}
//  onClick={() => handleSelectChat(chat)}
//  className={`p-3 rounded-lg border cursor-pointer transition-all duration-200 hover:shadow-md ${
//  selectedMessageId === chat.id
//  ? "bg-blue-50 border-blue-200 shadow-sm"
//  : "bg-white border-gray-200 hover:bg-gray-50"
//  }`}
//  >
//  <div className="flex items-start justify-between">
//  <div className="flex-1 min-w-0">
//  <p className="text-sm font-medium text-gray-900 mb-1 line-clamp-2">
//  {chat.question || chat.query || "Untitled"}
//  </p>
//  <p className="text-xs text-gray-500">
//  {getRelativeTime(chat.created_at || chat.timestamp)}
//  </p>
//  </div>
//  <button
//  onClick={(e) => {
//  e.stopPropagation();
//  }}
//  className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
//  >
//  <MoreVertical className="h-5 w-5 text-gray-400" />
//  </button>
//  </div>
//  </div>
//  ))}

//  {currentChatHistory.length === 0 && !loadingChat && (
//  <div className="text-center py-12">
//  <MessageSquare className="h-12 w-12 mx-auto mb-4 text-gray-300" />
//  <p className="text-gray-500">
//  No chats yet. Start a conversation!
//  </p>
//  </div>
//  )}

//  {loadingChat && currentChatHistory.length === 0 && (
//  <div className="flex justify-center py-8">
//  <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
//  </div>
//  )}
//  </div>
//  </div>

//  {/* Input Area - Fixed at bottom */}
//  <div className="border-t border-gray-200 p-2 bg-white flex-shrink-0">
//  <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
//  <input
//  type="text"
//  placeholder={isSecretPromptSelected ? `Analysis: ${activeDropdown}` : "How can I help you today?"}
//  value={chatInput}
//  onChange={handleChatInputChange}
//  onKeyPress={(e) => e.key === "Enter" && handleNewMessage()}
//  className="w-full text-base text-gray-700 placeholder-gray-400 outline-none bg-transparent"
//  disabled={loadingChat}
//  />

//  {/* Action Buttons Row */}
//  <div className="flex items-center justify-between mt-2">
//  <div className="flex items-center space-x-2">
//  {/* Analysis Dropdown */}
//  <div className="relative" ref={dropdownRef}>
//  <button
//  onClick={() => setShowDropdown(!showDropdown)}
//  disabled={isLoadingSecrets || loadingChat}
//  className="flex items-center space-x-2 px-4 py-2.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50"
//  >
//  <BookOpen className="h-4 w-4" />
//  <span className="text-sm font-medium">
//  {isLoadingSecrets ? "Loading..." : activeDropdown}
//  </span>
//  <ChevronDown className="h-4 w-4" />
//  </button>

//  {showDropdown && !isLoadingSecrets && (
//  <div className="absolute bottom-full left-0 mb-2 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto">
//  {secrets.length > 0 ? (
//  secrets.map((secret) => (
//  <button
//  key={secret.id}
//  onClick={() =>
//  handleDropdownSelect(secret.name, secret.id)
//  }
//  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg"
//  >
//  {secret.name}
//  </button>
//  ))
//  ) : (
//  <div className="px-4 py-2.5 text-sm text-gray-500">
//  No analysis prompts available
//  </div>
//  )}
//  </div>
//  )}
//  </div>
//  </div>

//  <div className="flex items-center space-x-2">
//  <button
//  onClick={handleNewMessage}
//  disabled={
//  loadingChat ||
//  (!chatInput.trim() && !isSecretPromptSelected)
//  }
//  className="p-2.5 bg-orange-300 hover:bg-orange-400 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
//  >
//  {loadingChat ? (
//  <Loader2 className="h-5 w-5 text-white animate-spin" />
//  ) : (
//  <Send className="h-5 w-5 text-white" />
//  )}
//  </button>
//  </div>
//  </div>
//  </div>

//  {/* Error Message */}
//  {chatError && (
//  <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
//  {chatError}
//  </div>
//  )}
//  </div>
//  </div>

//  {/* Right Panel - AI Response */}
//  {hasResponse && selectedMessageId && (
//  <div className="w-1/2 flex flex-col h-full">
//  <div className="flex-1 overflow-y-auto" ref={responseRef}>
//  {currentResponse || animatedResponseContent ? (
//  <div className="px-6 py-6">
//  <div className="max-w-none">
//  {/* Response Header */}
//  <div className="mb-6 pb-4 border-b border-gray-200">
//  <div className="flex items-center justify-between">
//  <h2 className="text-xl font-semibold text-gray-900">AI Response</h2>
//  <div className="flex items-center space-x-2 text-sm text-gray-500">
//  {currentChatHistory.find(msg => msg.id === selectedMessageId)?.timestamp && (
//  <span>{formatDate(currentChatHistory.find(msg => msg.id === selectedMessageId).timestamp)}</span>
//  )}
//  </div>
//  </div>
//  {/* Original Question */}
//  <div className="mt-3 p-3 bg-blue-50 rounded-lg border-l-4 border-blue-400">
//  <p className="text-sm font-medium text-blue-900 mb-1">Question:</p>
//  <p className="text-sm text-blue-800">
//  {currentChatHistory.find(msg => msg.id === selectedMessageId)?.question || 'No question available'}
//  </p>
//  </div>
//  </div>

//  {/* Response Content */}
//  <div className="prose prose-gray max-w-none">
//  <ReactMarkdown
//  remarkPlugins={[remarkGfm]}
//  components={{
//  h1: (props) => (
//  <h1
//  className="text-2xl font-bold mb-6 mt-8 text-black border-b-2 border-gray-300 pb-2"
//  {...props}
//  />
//  ),
//  h2: (props) => (
//  <h2
//  className="text-xl font-bold mb-4 mt-6 text-black"
//  {...props}
//  />
//  ),
//  h3: (props) => (
//  <h3
//  className="text-lg font-bold mb-3 mt-4 text-black"
//  {...props}
//  />
//  ),
//  p: (props) => (
//  <p
//  className="mb-4 leading-relaxed text-black text-justify"
//  {...props}
//  />
//  ),
//  strong: (props) => (
//  <strong className="font-bold text-black" {...props} />
//  ),
//  ul: (props) => (
//  <ul className="list-disc pl-5 mb-4 text-black" {...props} />
//  ),
//  ol: (props) => (
//  <ol className="list-decimal pl-5 mb-4 text-black" {...props} />
//  ),
//  li: (props) => (
//  <li className="mb-2 leading-relaxed text-black" {...props} />
//  ),
//  blockquote: (props) => (
//  <blockquote className="border-l-4 border-gray-300 pl-4 italic text-gray-700 my-4" {...props} />
//  ),
//  code: ({ inline, ...props }) => {
//  const className = inline 
//  ? "bg-gray-100 px-1 py-0.5 rounded text-sm font-mono text-red-700" 
//  : "block bg-gray-100 p-4 rounded-md text-sm font-mono overflow-x-auto my-4 text-red-700";
//  return <code className={className} {...props} />;
//  },
//  }}
//  >
//  {animatedResponseContent || currentResponse}
//  </ReactMarkdown>
//  {isAnimatingResponse && (
//  <span className="inline-block w-2 h-5 bg-gray-400 animate-pulse ml-1"></span>
//  )}
//  </div>
//  </div>
//  </div>
//  ) : (
//  <div className="flex items-center justify-center h-full">
//  <div className="text-center max-w-md px-6">
//  <MessageSquare className="h-16 w-16 mx-auto mb-6 text-gray-300" />
//  <h3 className="text-2xl font-semibold mb-4 text-gray-900">Select a Question</h3>
//  <p className="text-gray-600 text-lg leading-relaxed">
//  Click on any question from the left panel to view the AI response here.
//  </p>
//  </div>
//  </div>
//  )}
//  </div>
//  </div>
//  )}
//  </div>
//  );
// };

// export default ChatInterface;




// import React, { useState, useEffect, useContext, useRef } from "react";
// import { FileManagerContext } from "../../context/FileManagerContext";
// import documentApi from "../../services/documentApi";
// import {
//  Plus,
//  Search,
//  BookOpen,
//  ChevronDown,
//  MoreVertical,
//  MessageSquare,
//  Loader2,
//  Send,
// } from "lucide-react";
// import ReactMarkdown from "react-markdown";
// import remarkGfm from "remark-gfm";
// import { SidebarContext } from "../../context/SidebarContext";

// const ChatInterface = () => {
//  const {
//  selectedFolder,
//  setChatSessions,
//  selectedChatSessionId,
//  setSelectedChatSessionId,
//  setHasAiResponse,
//  } = useContext(FileManagerContext);
//  const { setForceSidebarCollapsed } = useContext(SidebarContext);

//  const [currentChatHistory, setCurrentChatHistory] = useState([]);
//  const [loadingChat, setLoadingChat] = useState(false);
//  const [chatError, setChatError] = useState(null);
//  const [chatInput, setChatInput] = useState("");
//  const [animatedResponseContent, setAnimatedResponseContent] = useState("");
//  const [isAnimatingResponse, setIsAnimatingResponse] = useState(false);
//  const [selectedMessageId, setSelectedMessageId] = useState(null);
//  const [hasResponse, setHasResponse] = useState(false);

//  // Secret prompt states
//  const [secrets, setSecrets] = useState([]);
//  const [isLoadingSecrets, setIsLoadingSecrets] = useState(false);
//  const [selectedSecretId, setSelectedSecretId] = useState(null);
//  const [selectedLlmName, setSelectedLlmName] = useState(null);
//  const [activeDropdown, setActiveDropdown] = useState("Summary");
//  const [showDropdown, setShowDropdown] = useState(false);
//  const [isSecretPromptSelected, setIsSecretPromptSelected] = useState(false);

//  const responseRef = useRef(null);
//  const dropdownRef = useRef(null);
//  const animationIntervalRef = useRef(null);

//  // API Configuration
//  const API_BASE_URL = "https://gateway-service-120280829617.asia-south1.run.app";

//  const getAuthToken = () => {
//  const tokenKeys = [
//  "authToken",
//  "token",
//  "accessToken",
//  "jwt",
//  "bearerToken",
//  "auth_token",
//  "access_token",
//  "api_token",
//  "userToken",
//  ];
//  for (const key of tokenKeys) {
//  const token = localStorage.getItem(key);
//  if (token) return token;
//  }
//  return null;
//  };

//  // Fetch secrets list
//  const fetchSecrets = async () => {
//  try {
//  setIsLoadingSecrets(true);
//  setChatError(null);
//  const token = getAuthToken();
//  const headers = { "Content-Type": "application/json" };
//  if (token) headers["Authorization"] = `Bearer ${token}`;

//  const response = await fetch(`${API_BASE_URL}/files/secrets?fetch=true`, {
//  method: "GET",
//  headers,
//  });

//  if (!response.ok) throw new Error(`Failed to fetch secrets: ${response.status}`);
//  const secretsData = await response.json();
//  setSecrets(secretsData || []);

//  if (secretsData?.length > 0) {
//  setActiveDropdown(secretsData[0].name);
//  setSelectedSecretId(secretsData[0].id);
//  setSelectedLlmName(secretsData[0].llm_name);
//  setIsSecretPromptSelected(true);
//  } else {
//  setActiveDropdown("Custom Query");
//  setSelectedSecretId(null);
//  setSelectedLlmName(null);
//  setIsSecretPromptSelected(false);
//  }
//  } catch (error) {
//  console.error("Error fetching secrets:", error);
//  setChatError(`Failed to load analysis prompts: ${error.message}`);
//  } finally {
//  setIsLoadingSecrets(false);
//  }
//  };

//  // Fetch secret value by ID
//  const fetchSecretValue = async (secretId) => {
//  try {
//  const existingSecret = secrets.find((secret) => secret.id === secretId);
//  if (existingSecret?.value) return existingSecret.value;

//  const token = getAuthToken();
//  const headers = { "Content-Type": "application/json" };
//  if (token) headers["Authorization"] = `Bearer ${token}`;

//  const response = await fetch(`${API_BASE_URL}/files/secrets/${secretId}`, {
//  method: "GET",
//  headers,
//  });

//  if (!response.ok) throw new Error(`Failed to fetch secret value: ${response.status}`);
//  const secretData = await response.json();
//  const promptValue = secretData.value || secretData.prompt || secretData.content || secretData;

//  setSecrets((prevSecrets) =>
//  prevSecrets.map((secret) =>
//  secret.id === secretId ? { ...secret, value: promptValue } : secret
//  )
//  );
//  return promptValue || "";
//  } catch (error) {
//  console.error("Error fetching secret value:", error);
//  throw new Error("Failed to retrieve analysis prompt");
//  }
//  };

//  // Fetch chat history
//  const fetchChatHistory = async (sessionId) => {
//  if (!selectedFolder) return;

//  setLoadingChat(true);
//  setChatError(null);
//  try {
//  const data = await documentApi.getFolderChats(selectedFolder);
//  const chats = Array.isArray(data.chats) ? data.chats : [];
//  setCurrentChatHistory(chats);

//  if (sessionId) {
//  setSelectedChatSessionId(sessionId);
//  const selectedChat = chats.find((c) => c.id === sessionId);
//  if (selectedChat) {
//  const responseText = selectedChat.response || selectedChat.answer || selectedChat.message || "";
//  setSelectedMessageId(selectedChat.id);
//  setAnimatedResponseContent(responseText);
//  setHasResponse(true);
//  setHasAiResponse(true);
//  setForceSidebarCollapsed(true);
//  }
//  } else {
//  setHasResponse(false);
//  setHasAiResponse(false);
//  setForceSidebarCollapsed(false);
//  }
//  } catch (err) {
//  console.error("Error fetching chats:", err);
//  setChatError("Failed to fetch chat history.");
//  } finally {
//  setLoadingChat(false);
//  }
//  };

//  // Animate typing effect
//  const animateResponse = (text) => {
//  // Clear any existing animation
//  if (animationIntervalRef.current) {
//  clearInterval(animationIntervalRef.current);
//  animationIntervalRef.current = null;
//  }

//  setAnimatedResponseContent("");
//  setIsAnimatingResponse(true);
 
//  let i = 0;
//  animationIntervalRef.current = setInterval(() => {
//  if (i < text.length) {
//  setAnimatedResponseContent((prev) => prev + text.charAt(i));
//  i++;
//  if (responseRef.current) {
//  responseRef.current.scrollTop = responseRef.current.scrollHeight;
//  }
//  } else {
//  clearInterval(animationIntervalRef.current);
//  animationIntervalRef.current = null;
//  setIsAnimatingResponse(false);
//  }
//  }, 15); // Faster animation for better UX
//  };

//  // Cleanup animation on unmount
//  useEffect(() => {
//  return () => {
//  if (animationIntervalRef.current) {
//  clearInterval(animationIntervalRef.current);
//  }
//  };
//  }, []);

//  // Chat with AI using secret prompt
//  const chatWithAI = async (folder, secretId, currentSessionId) => {
//  try {
//  setLoadingChat(true);
//  setChatError(null);
 
//  // Don't reset the panel if we're continuing a session
//  const isContinuingSession = !!currentSessionId && currentChatHistory.length > 0;
 
//  if (!isContinuingSession) {
//  setHasResponse(true);
//  setHasAiResponse(true);
//  setForceSidebarCollapsed(true);
//  }

//  const selectedSecret = secrets.find((s) => s.id === secretId);
//  if (!selectedSecret) throw new Error("No prompt found for selected analysis type");

//  let promptValue = selectedSecret.value;
//  const promptLabel = selectedSecret.name;

//  if (!promptValue) promptValue = await fetchSecretValue(secretId);
//  if (!promptValue) throw new Error("Secret prompt value is empty.");

//  console.log("🔄 Sending request with session:", currentSessionId);

//  const response = await documentApi.queryFolderDocuments(folder, promptValue, currentSessionId, {
//  used_secret_prompt: true,
//  prompt_label: promptLabel,
//  secret_id: secretId,
//  });

//  console.log("🔍 Full API Response:", response);

//  // Handle session ID from various possible locations
//  const sessionId = response.sessionId || response.session_id || response.id;
//  console.log("🆔 Session ID - Current:", currentSessionId, "New:", sessionId);
 
//  if (sessionId) {
//  setSelectedChatSessionId(sessionId);
//  }

//  // Try multiple possible response structures
//  let history = [];
//  let responseText = "";
//  let messageId = null;

//  // Case 1: Response has chatHistory array
//  if (Array.isArray(response.chatHistory) && response.chatHistory.length > 0) {
//  history = response.chatHistory;
//  const latestMessage = history[history.length - 1];
//  responseText = latestMessage.response || latestMessage.answer || latestMessage.message || "";
//  messageId = latestMessage.id;
//  }
//  // Case 2: Response has chat_history array
//  else if (Array.isArray(response.chat_history) && response.chat_history.length > 0) {
//  history = response.chat_history;
//  const latestMessage = history[history.length - 1];
//  responseText = latestMessage.response || latestMessage.answer || latestMessage.message || "";
//  messageId = latestMessage.id;
//  }
//  // Case 3: Response has messages array
//  else if (Array.isArray(response.messages) && response.messages.length > 0) {
//  history = response.messages;
//  const latestMessage = history[history.length - 1];
//  responseText = latestMessage.response || latestMessage.answer || latestMessage.message || latestMessage.content || "";
//  messageId = latestMessage.id;
//  }
//  // Case 4: Direct response object
//  else if (response.response || response.answer || response.message || response.content) {
//  responseText = response.response || response.answer || response.message || response.content;
//  messageId = response.id || Date.now().toString();
//  // Merge with existing history if continuing session
//  const newMessage = {
//  id: messageId,
//  question: promptLabel, // Use promptLabel instead of promptValue
//  response: responseText,
//  timestamp: new Date().toISOString(),
//  created_at: new Date().toISOString(),
//  isSecretPrompt: true, // Flag to indicate secret prompt
//  };
//  history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
//  }

//  console.log("📝 Extracted Response Text:", responseText);
//  console.log("📚 Chat History Length:", history.length);

//  setCurrentChatHistory(history);

//  if (responseText && responseText.trim()) {
//  setSelectedMessageId(messageId);
//  setHasResponse(true);
//  setHasAiResponse(true);
//  setForceSidebarCollapsed(true);
//  animateResponse(responseText);
//  } else {
//  console.error("❌ No response text found in:", response);
//  setChatError("Received empty response from server. Check console for details.");
//  setHasResponse(false);
//  setHasAiResponse(false);
//  setForceSidebarCollapsed(false);
//  }

//  return response;
//  } catch (error) {
//  console.error("Chat error:", error);
//  setChatError(`Analysis failed: ${error.message}`);
//  setHasResponse(false);
//  setHasAiResponse(false);
//  setForceSidebarCollapsed(false);
//  throw error;
//  } finally {
//  setLoadingChat(false);
//  }
//  };

//  // Handle new message
//  const handleNewMessage = async () => {
//  if (!selectedFolder) return;

//  if (isSecretPromptSelected) {
//  if (!selectedSecretId) {
//  setChatError("Please select an analysis type.");
//  return;
//  }
//  await chatWithAI(selectedFolder, selectedSecretId, selectedChatSessionId);
//  setChatInput("");
//  setIsSecretPromptSelected(false);
//  } else {
//  if (!chatInput.trim()) return;

//  const questionText = chatInput.trim();
//  setLoadingChat(true);
//  setChatError(null);
 
//  // Don't reset the panel if we're continuing a session
//  const isContinuingSession = !!selectedChatSessionId && currentChatHistory.length > 0;
 
//  if (!isContinuingSession) {
//  setHasResponse(true);
//  setHasAiResponse(true);
//  setForceSidebarCollapsed(true);
//  }

//  try {
//  console.log("🔄 Sending message with session:", selectedChatSessionId);

//  const response = await documentApi.queryFolderDocuments(
//  selectedFolder,
//  questionText,
//  selectedChatSessionId,
//  { used_secret_prompt: false }
//  );

//  console.log("🔍 Full API Response:", response);

//  // Handle session ID from various possible locations
//  const sessionId = response.sessionId || response.session_id || response.id;
//  console.log("🆔 Session ID - Current:", selectedChatSessionId, "New:", sessionId);
 
//  if (sessionId) {
//  setSelectedChatSessionId(sessionId);
//  }

//  // Try multiple possible response structures
//  let history = [];
//  let responseText = "";
//  let messageId = null;

//  // Case 1: Response has chatHistory array
//  if (Array.isArray(response.chatHistory) && response.chatHistory.length > 0) {
//  history = response.chatHistory;
//  const latestMessage = history[history.length - 1];
//  responseText = latestMessage.response || latestMessage.answer || latestMessage.message || "";
//  messageId = latestMessage.id;
//  }
//  // Case 2: Response has chat_history array
//  else if (Array.isArray(response.chat_history) && response.chat_history.length > 0) {
//  history = response.chat_history;
//  const latestMessage = history[history.length - 1];
//  responseText = latestMessage.response || latestMessage.answer || latestMessage.message || "";
//  messageId = latestMessage.id;
//  }
//  // Case 3: Response has messages array
//  else if (Array.isArray(response.messages) && response.messages.length > 0) {
//  history = response.messages;
//  const latestMessage = history[history.length - 1];
//  responseText = latestMessage.response || latestMessage.answer || latestMessage.message || latestMessage.content || "";
//  messageId = latestMessage.id;
//  }
//  // Case 4: Direct response object
//  else if (response.response || response.answer || response.message || response.content) {
//  responseText = response.response || response.answer || response.message || response.content;
//  messageId = response.id || Date.now().toString();
//  // Merge with existing history if continuing session
//  const newMessage = {
//  id: messageId,
//  question: questionText,
//  response: responseText,
//  timestamp: new Date().toISOString(),
//  created_at: new Date().toISOString(),
//  isSecretPrompt: false, // Flag for custom query
//  };
//  history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
//  }

//  console.log("📝 Extracted Response Text:", responseText);
//  console.log("📚 Chat History Length:", history.length);

//  setCurrentChatHistory(history);

//  if (responseText && responseText.trim()) {
//  setSelectedMessageId(messageId);
//  setHasResponse(true);
//  setHasAiResponse(true);
//  setForceSidebarCollapsed(true);
//  animateResponse(responseText);
//  } else {
//  console.error("❌ No response text found in:", response);
//  setChatError("Received empty response from server. Check console for details.");
//  setHasResponse(false);
//  setHasAiResponse(false);
//  setForceSidebarCollapsed(false);
//  }
//  setChatInput("");
//  } catch (err) {
//  console.error("Error sending message:", err);
//  setChatError(`Failed to send message: ${err.response?.data?.details || err.message}`);
//  setHasResponse(false);
//  setHasAiResponse(false);
//  setForceSidebarCollapsed(false);
//  } finally {
//  setLoadingChat(false);
//  }
//  }
//  };

//  // Handle selecting a chat
//  const handleSelectChat = (chat) => {
//  // Clear any ongoing animation
//  if (animationIntervalRef.current) {
//  clearInterval(animationIntervalRef.current);
//  animationIntervalRef.current = null;
//  }

//  setSelectedMessageId(chat.id);
//  const responseText = chat.response || chat.answer || chat.message || "";
//  setAnimatedResponseContent(responseText);
//  setIsAnimatingResponse(false);
//  setHasResponse(true);
//  setHasAiResponse(true);
//  setForceSidebarCollapsed(true);
//  };

//  // Handle new chat
//  const handleNewChat = () => {
//  // Clear any ongoing animation
//  if (animationIntervalRef.current) {
//  clearInterval(animationIntervalRef.current);
//  animationIntervalRef.current = null;
//  }

//  setCurrentChatHistory([]);
//  setSelectedChatSessionId(null);
//  setHasResponse(false);
//  setHasAiResponse(false);
//  setForceSidebarCollapsed(false);
//  setChatInput("");
//  setSelectedMessageId(null);
//  setAnimatedResponseContent("");
//  setIsAnimatingResponse(false);
//  setIsSecretPromptSelected(false);
//  setSelectedSecretId(null);
//  setSelectedLlmName(null);

//  if (secrets.length > 0) {
//  setActiveDropdown(secrets[0].name);
//  setSelectedSecretId(secrets[0].id);
//  setSelectedLlmName(secrets[0].llm_name);
//  setIsSecretPromptSelected(true);
//  } else {
//  setActiveDropdown("Custom Query");
//  setIsSecretPromptSelected(false);
//  }
//  };

//  // Handle dropdown selection
//  const handleDropdownSelect = (secretName, secretId, llmName) => {
//  setActiveDropdown(secretName);
//  setSelectedSecretId(secretId);
//  setSelectedLlmName(llmName);
//  setIsSecretPromptSelected(true);
//  setChatInput("");
//  setShowDropdown(false);
//  };

//  // Handle custom input change
//  const handleChatInputChange = (e) => {
//  setChatInput(e.target.value);
//  if (e.target.value && isSecretPromptSelected) {
//  setIsSecretPromptSelected(false);
//  setActiveDropdown("Custom Query");
//  setSelectedSecretId(null);
//  setSelectedLlmName(null);
//  }
//  };

//  // Format relative time
//  const getRelativeTime = (dateString) => {
//  try {
//  const date = new Date(dateString);
//  const now = new Date();
//  const diffInSeconds = Math.floor((now - date) / 1000);
//  if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
//  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
//  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
//  return `${Math.floor(diffInSeconds / 86400)}d ago`;
//  } catch {
//  return "Unknown time";
//  }
//  };

//  // Format date for display
//  const formatDate = (dateString) => {
//  try {
//  return new Date(dateString).toLocaleString();
//  } catch {
//  return "Invalid date";
//  }
//  };

//  // Close dropdown when clicking outside
//  useEffect(() => {
//  const handleClickOutside = (event) => {
//  if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
//  setShowDropdown(false);
//  }
//  };
//  document.addEventListener("mousedown", handleClickOutside);
//  return () => document.removeEventListener("mousedown", handleClickOutside);
//  }, []);

//  // Load secrets on mount
//  useEffect(() => {
//  fetchSecrets();
//  }, []);

//  // Reset state when folder changes
//  useEffect(() => {
//  // Clear animation
//  if (animationIntervalRef.current) {
//  clearInterval(animationIntervalRef.current);
//  animationIntervalRef.current = null;
//  }

//  setChatSessions([]);
//  setCurrentChatHistory([]);
//  setSelectedChatSessionId(null);
//  setHasResponse(false);
//  setHasAiResponse(false);
//  setForceSidebarCollapsed(false);
//  setAnimatedResponseContent("");
//  setSelectedMessageId(null);
//  setIsAnimatingResponse(false);

//  if (selectedFolder && selectedFolder !== "Test") {
//  fetchChatHistory();
//  }
//  }, [selectedFolder]);

//  if (!selectedFolder) {
//  return (
//  <div className="flex items-center justify-center h-full text-gray-400 text-lg bg-[#FDFCFB]">
//  Select a folder to start chatting.
//  </div>
//  );
//  }

//  return (
//  <div className="flex h-screen bg-white">
//  {/* Left Panel - Chat History */}
//  <div className={`${hasResponse ? "w-[40%]" : "w-full"} border-r border-gray-200 flex flex-col bg-white h-full transition-all duration-300 overflow-hidden`}>
//  {/* Header */}
//  <div className="p-4 border-b border-black border-opacity-20 flex-shrink-0">
//  <div className="flex items-center justify-between mb-4">
//  <h2 className="text-lg font-semibold text-gray-900">Questions</h2>
//  <button
//  onClick={handleNewChat}
//  className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
//  >
//  New Chat
//  </button>
//  </div>
//  <div className="relative mb-4">
//  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
//  <input
//  type="text"
//  placeholder="Search questions..."
//  className="w-full pl-9 pr-3 py-2 bg-gray-100 rounded-lg text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
//  />
//  </div>
//  </div>

//  {/* Chat History List */}
//  <div className="flex-1 overflow-y-auto px-4 py-2 scrollbar-custom">
//  {loadingChat && currentChatHistory.length === 0 ? (
//  <div className="flex justify-center py-8">
//  <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
//  </div>
//  ) : currentChatHistory.length === 0 ? (
//  <div className="text-center py-12">
//  <MessageSquare className="h-12 w-12 mx-auto mb-4 text-gray-300" />
//  <p className="text-gray-500">No chats yet. Start a conversation!</p>
//  </div>
//  ) : (
//  <div className="space-y-2">
//  {currentChatHistory.map((chat) => (
//  <div
//  key={chat.id}
//  onClick={() => handleSelectChat(chat)}
//  className={`p-3 rounded-lg border cursor-pointer transition-all duration-200 hover:shadow-md ${
//  selectedMessageId === chat.id
//  ? "bg-blue-50 border-blue-200 shadow-sm"
//  : "bg-white border-gray-200 hover:bg-gray-50"
//  }`}
//  >
//  <div className="flex items-start justify-between">
//  <div className="flex-1 min-w-0">
//  <p className="text-sm font-medium text-gray-900 mb-1 line-clamp-2">
//  {chat.question || chat.query || "Untitled"}
//  </p>
//  <p className="text-xs text-gray-500">{getRelativeTime(chat.created_at || chat.timestamp)}</p>
//  </div>
//  <button
//  onClick={(e) => e.stopPropagation()}
//  className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
//  >
//  <MoreVertical className="h-5 w-5 text-gray-400" />
//  </button>
//  </div>
//  </div>
//  ))}
//  </div>
//  )}
//  </div>

//  {/* Input Area */}
//  <div className="border-t border-gray-200 p-2 bg-white flex-shrink-0">
//  <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
//  <input
//  type="text"
//  placeholder={isSecretPromptSelected ? `Analysis: ${activeDropdown}` : "How can I help you today?"}
//  value={chatInput}
//  onChange={handleChatInputChange}
//  onKeyPress={(e) => e.key === "Enter" && !e.shiftKey && handleNewMessage()}
//  className="w-full text-base text-gray-700 placeholder-gray-400 outline-none bg-transparent"
//  disabled={loadingChat}
//  />
//  <div className="flex items-center justify-between mt-2">
//  <div className="relative" ref={dropdownRef}>
//  <button
//  onClick={() => setShowDropdown(!showDropdown)}
//  disabled={isLoadingSecrets || loadingChat}
//  className="flex items-center space-x-2 px-4 py-2.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50"
//  >
//  <BookOpen className="h-4 w-4" />
//  <span className="text-sm font-medium">{isLoadingSecrets ? "Loading..." : activeDropdown}</span>
//  <ChevronDown className="h-4 w-4" />
//  </button>
//  {showDropdown && !isLoadingSecrets && (
//  <div className="absolute bottom-full left-0 mb-2 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto scrollbar-custom">
//  {secrets.length > 0 ? (
//  secrets.map((secret) => (
//  <button
//  key={secret.id}
//  onClick={() => handleDropdownSelect(secret.name, secret.id, secret.llm_name)}
//  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
//  >
//  {secret.name}
//  </button>
//  ))
//  ) : (
//  <div className="px-4 py-2.5 text-sm text-gray-500">No analysis prompts available</div>
//  )}
//  </div>
//  )}
//  </div>
//  <button
//  onClick={handleNewMessage}
//  disabled={loadingChat || (!chatInput.trim() && !isSecretPromptSelected)}
//  className="p-2.5 bg-orange-300 hover:bg-orange-400 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
//  >
//  {loadingChat ? (
//  <Loader2 className="h-5 w-5 text-white animate-spin" />
//  ) : (
//  <Send className="h-5 w-5 text-white" />
//  )}
//  </button>
//  </div>
//  </div>
//  {chatError && (
//  <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
//  {chatError}
//  </div>
//  )}
//  </div>
//  </div>

//  {/* Right Panel - AI Response */}
//  {hasResponse && (
//  <div className="w-[60%] flex flex-col h-full overflow-hidden">
//  <div className="flex-1 overflow-y-auto scrollbar-custom" ref={responseRef}>
//  {loadingChat && !animatedResponseContent ? (
//  <div className="flex items-center justify-center h-full">
//  <div className="text-center">
//  <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-blue-600" />
//  <p className="text-gray-600">Generating response...</p>
//  </div>
//  </div>
//  ) : selectedMessageId && animatedResponseContent ? (
//  <div className="px-6 py-6">
//  <div className="mb-6 pb-4 border-b border-gray-200">
//  <div className="flex items-center justify-between">
//  <h2 className="text-xl font-semibold text-gray-900">AI Response</h2>
//  <div className="text-sm text-gray-500">
//  {currentChatHistory.find((msg) => msg.id === selectedMessageId)?.timestamp && (
//  <span>{formatDate(currentChatHistory.find((msg) => msg.id === selectedMessageId).timestamp)}</span>
//  )}
//  </div>
//  </div>
//  <div className="mt-3 p-3 bg-blue-50 rounded-lg border-l-4 border-blue-400">
//  <p className="text-sm font-medium text-blue-900 mb-1">Question:</p>
//  <p className="text-sm text-blue-800">
//  {currentChatHistory.find((msg) => msg.id === selectedMessageId)?.question || "No question available"}
//  </p>
//  </div>
//  </div>
//  <div className="prose prose-gray max-w-none">
//  <ReactMarkdown
//  remarkPlugins={[remarkGfm]}
//  components={{
//  h1: ({ ...props }) => <h1 className="text-2xl font-bold mb-6 mt-8 text-black border-b-2 border-gray-300 pb-2" {...props} />,
//  h2: ({ ...props }) => <h2 className="text-xl font-bold mb-4 mt-6 text-black" {...props} />,
//  h3: ({ ...props }) => <h3 className="text-lg font-bold mb-3 mt-4 text-black" {...props} />,
//  p: ({ ...props }) => <p className="mb-4 leading-relaxed text-black text-justify" {...props} />,
//  strong: ({ ...props }) => <strong className="font-bold text-black" {...props} />,
//  ul: ({ ...props }) => <ul className="list-disc pl-5 mb-4 text-black" {...props} />,
//  ol: ({ ...props }) => <ol className="list-decimal pl-5 mb-4 text-black" {...props} />,
//  li: ({ ...props }) => <li className="mb-2 leading-relaxed text-black" {...props} />,
//  blockquote: ({ ...props }) => (
//  <blockquote className="border-l-4 border-gray-300 pl-4 italic text-gray-700 my-4" {...props} />
//  ),
//  code: ({ inline, ...props }) => (
//  <code
//  className={inline ? "bg-gray-100 px-1 py-0.5 rounded text-sm font-mono text-red-700" : "block bg-gray-100 p-4 rounded-md text-sm font-mono overflow-x-auto my-4 text-red-700"}
//  {...props}
//  />
//  ),
//  table: ({ ...props }) => (
//  <div className="overflow-x-auto my-4">
//  <table className="min-w-full divide-y divide-gray-300 border border-gray-300" {...props} />
//  </div>
//  ),
//  thead: ({ ...props }) => <thead className="bg-gray-50" {...props} />,
//  th: ({ ...props }) => <th className="px-4 py-2 text-left text-sm font-semibold text-gray-900 border-b border-gray-300" {...props} />,
//  td: ({ ...props }) => <td className="px-4 py-2 text-sm text-gray-700 border-b border-gray-200" {...props} />,
//  }}
//  >
//  {animatedResponseContent}
//  </ReactMarkdown>
//  {isAnimatingResponse && <span className="inline-block w-2 h-5 bg-gray-400 animate-pulse ml-1"></span>}
//  </div>
//  </div>
//  ) : (
//  <div className="flex items-center justify-center h-full">
//  <div className="text-center max-w-md px-6">
//  <MessageSquare className="h-16 w-16 mx-auto mb-6 text-gray-300" />
//  <h3 className="text-2xl font-semibold mb-4 text-gray-900">Select a Question</h3>
//  <p className="text-gray-600 text-lg leading-relaxed">
//  Click on any question from the left panel to view the AI response here.
//  </p>
//  </div>
//  </div>
//  )}
//  </div>
//  </div>
//  )}
//  <style jsx>{`
//  .scrollbar-custom::-webkit-scrollbar {
//  width: 8px;
//  }
//  .scrollbar-custom::-webkit-scrollbar-track {
//  background: #f1f1f1;
//  border-radius: 4px;
//  }
//  .scrollbar-custom::-webkit-scrollbar-thumb {
//  background: #a0aec0;
//  border-radius: 4px;
//  }
//  .scrollbar-custom::-webkit-scrollbar-thumb:hover {
//  background: #718096;
//  }
//  `}</style>
//  </div>
//  );
// };

// export default ChatInterface;


// import React, { useState, useEffect, useContext, useRef } from "react";
// import { FileManagerContext } from "../../context/FileManagerContext";
// import documentApi from "../../services/documentApi";
// import {
//   Plus,
//   Search,
//   BookOpen,
//   ChevronDown,
//   MoreVertical,
//   MessageSquare,
//   Loader2,
//   Send,
// } from "lucide-react";
// import ReactMarkdown from "react-markdown";
// import remarkGfm from "remark-gfm";
// import { SidebarContext } from "../../context/SidebarContext";

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
//   const [isAnimatingResponse, setIsAnimatingResponse] = useState(false);
//   const [selectedMessageId, setSelectedMessageId] = useState(null);
//   const [hasResponse, setHasResponse] = useState(false);
//   // Secret prompt states
//   const [secrets, setSecrets] = useState([]);
//   const [isLoadingSecrets, setIsLoadingSecrets] = useState(false);
//   const [selectedSecretId, setSelectedSecretId] = useState(null);
//   const [selectedLlmName, setSelectedLlmName] = useState(null);
//   const [activeDropdown, setActiveDropdown] = useState("Summary");
//   const [showDropdown, setShowDropdown] = useState(false);
//   const [isSecretPromptSelected, setIsSecretPromptSelected] = useState(false);
//   const responseRef = useRef(null);
//   const dropdownRef = useRef(null);
//   const animationIntervalRef = useRef(null);

//   // API Configuration
//   const API_BASE_URL = "https://gateway-service-120280829617.asia-south1.run.app";
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

//   // Fetch secrets list
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
//       if (secretsData?.length > 0) {
//         setActiveDropdown(secretsData[0].name);
//         setSelectedSecretId(secretsData[0].id);
//         setSelectedLlmName(secretsData[0].llm_name);
//         setIsSecretPromptSelected(true);
//       } else {
//         setActiveDropdown("Custom Query");
//         setSelectedSecretId(null);
//         setSelectedLlmName(null);
//         setIsSecretPromptSelected(false);
//       }
//     } catch (error) {
//       console.error("Error fetching secrets:", error);
//       setChatError(`Failed to load analysis prompts: ${error.message}`);
//     } finally {
//       setIsLoadingSecrets(false);
//     }
//   };

//   // Fetch secret value by ID
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

//   // Fetch chat history
//   const fetchChatHistory = async (sessionId) => {
//     if (!selectedFolder) return;
//     setLoadingChat(true);
//     setChatError(null);
//     try {
//       const data = await documentApi.getFolderChats(selectedFolder);
//       const chats = Array.isArray(data.chats) ? data.chats : [];
//       setCurrentChatHistory(chats);
//       if (sessionId) {
//         setSelectedChatSessionId(sessionId);
//         const selectedChat = chats.find((c) => c.id === sessionId);
//         if (selectedChat) {
//           const responseText = selectedChat.response || selectedChat.answer || selectedChat.message || "";
//           setSelectedMessageId(selectedChat.id);
//           setAnimatedResponseContent(responseText);
//           setHasResponse(true);
//           setHasAiResponse(true);
//           setForceSidebarCollapsed(true);
//         }
//       } else {
//         setHasResponse(false);
//         setHasAiResponse(false);
//         setForceSidebarCollapsed(false);
//       }
//     } catch (err) {
//       console.error("Error fetching chats:", err);
//       setChatError("Failed to fetch chat history.");
//     } finally {
//       setLoadingChat(false);
//     }
//   };

//   // Animate typing effect
//   const animateResponse = (text) => {
//     if (animationIntervalRef.current) {
//       clearInterval(animationIntervalRef.current);
//       animationIntervalRef.current = null;
//     }
//     setAnimatedResponseContent("");
//     setIsAnimatingResponse(true);
//     let i = 0;
//     animationIntervalRef.current = setInterval(() => {
//       if (i < text.length) {
//         setAnimatedResponseContent((prev) => prev + text.charAt(i));
//         i++;
//         if (responseRef.current) {
//           responseRef.current.scrollTop = responseRef.current.scrollHeight;
//         }
//       } else {
//         clearInterval(animationIntervalRef.current);
//         animationIntervalRef.current = null;
//         setIsAnimatingResponse(false);
//       }
//     }, 15);
//   };

//   // Cleanup animation on unmount
//   useEffect(() => {
//     return () => {
//       if (animationIntervalRef.current) {
//         clearInterval(animationIntervalRef.current);
//       }
//     };
//   }, []);

//   // Chat with AI using secret prompt
//   const chatWithAI = async (folder, secretId, currentSessionId) => {
//     try {
//       setLoadingChat(true);
//       setChatError(null);
//       const isContinuingSession = !!currentSessionId && currentChatHistory.length > 0;
//       if (!isContinuingSession) {
//         setHasResponse(true);
//         setHasAiResponse(true);
//         setForceSidebarCollapsed(true);
//       }
//       const selectedSecret = secrets.find((s) => s.id === secretId);
//       if (!selectedSecret) throw new Error("No prompt found for selected analysis type");
//       let promptValue = selectedSecret.value;
//       const promptLabel = selectedSecret.name;
//       if (!promptValue) promptValue = await fetchSecretValue(secretId);
//       if (!promptValue) throw new Error("Secret prompt value is empty.");
//       console.log("🔄 Sending request with session:", currentSessionId);
//       const response = await documentApi.queryFolderDocuments(folder, promptValue, currentSessionId, {
//         used_secret_prompt: true,
//         prompt_label: promptLabel,
//         secret_id: secretId,
//       });
//       console.log("🔍 Full API Response:", response);
//       const sessionId = response.sessionId || response.session_id || response.id;
//       console.log("🆔 Session ID - Current:", currentSessionId, "New:", sessionId);
//       if (sessionId) {
//         setSelectedChatSessionId(sessionId);
//       }
//       let history = [];
//       let responseText = "";
//       let messageId = null;
//       if (Array.isArray(response.chatHistory) && response.chatHistory.length > 0) {
//         history = response.chatHistory;
//         const latestMessage = history[history.length - 1];
//         responseText = latestMessage.response || latestMessage.answer || latestMessage.message || "";
//         messageId = latestMessage.id;
//       } else if (Array.isArray(response.chat_history) && response.chat_history.length > 0) {
//         history = response.chat_history;
//         const latestMessage = history[history.length - 1];
//         responseText = latestMessage.response || latestMessage.answer || latestMessage.message || "";
//         messageId = latestMessage.id;
//       } else if (Array.isArray(response.messages) && response.messages.length > 0) {
//         history = response.messages;
//         const latestMessage = history[history.length - 1];
//         responseText = latestMessage.response || latestMessage.answer || latestMessage.message || latestMessage.content || "";
//         messageId = latestMessage.id;
//       } else if (response.response || response.answer || response.message || response.content) {
//         responseText = response.response || response.answer || response.message || response.content;
//         messageId = response.id || Date.now().toString();
//         const newMessage = {
//           id: messageId,
//           question: promptLabel,
//           response: responseText,
//           timestamp: new Date().toISOString(),
//           created_at: new Date().toISOString(),
//           isSecretPrompt: true,
//         };
//         history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
//       }
//       console.log("📝 Extracted Response Text:", responseText);
//       console.log("📚 Chat History Length:", history.length);
//       setCurrentChatHistory(history);
//       if (responseText && responseText.trim()) {
//         setSelectedMessageId(messageId);
//         setHasResponse(true);
//         setHasAiResponse(true);
//         setForceSidebarCollapsed(true);
//         animateResponse(responseText);
//       } else {
//         console.error("❌ No response text found in:", response);
//         setChatError("Received empty response from server. Check console for details.");
//         setHasResponse(false);
//         setHasAiResponse(false);
//         setForceSidebarCollapsed(false);
//       }
//       return response;
//     } catch (error) {
//       console.error("Chat error:", error);
//       setChatError(`Analysis failed: ${error.message}`);
//       setHasResponse(false);
//       setHasAiResponse(false);
//       setForceSidebarCollapsed(false);
//       throw error;
//     } finally {
//       setLoadingChat(false);
//     }
//   };

//   // Handle new message
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
//     } else {
//       if (!chatInput.trim()) return;
//       const questionText = chatInput.trim();
//       setLoadingChat(true);
//       setChatError(null);
//       const isContinuingSession = !!selectedChatSessionId && currentChatHistory.length > 0;
//       if (!isContinuingSession) {
//         setHasResponse(true);
//         setHasAiResponse(true);
//         setForceSidebarCollapsed(true);
//       }
//       try {
//         console.log("🔄 Sending message with session:", selectedChatSessionId);
//         const response = await documentApi.queryFolderDocuments(
//           selectedFolder,
//           questionText,
//           selectedChatSessionId,
//           { used_secret_prompt: false }
//         );
//         console.log("🔍 Full API Response:", response);
//         const sessionId = response.sessionId || response.session_id || response.id;
//         console.log("🆔 Session ID - Current:", selectedChatSessionId, "New:", sessionId);
//         if (sessionId) {
//           setSelectedChatSessionId(sessionId);
//         }
//         let history = [];
//         let responseText = "";
//         let messageId = null;
//         if (Array.isArray(response.chatHistory) && response.chatHistory.length > 0) {
//           history = response.chatHistory;
//           const latestMessage = history[history.length - 1];
//           responseText = latestMessage.response || latestMessage.answer || latestMessage.message || "";
//           messageId = latestMessage.id;
//         } else if (Array.isArray(response.chat_history) && response.chat_history.length > 0) {
//           history = response.chat_history;
//           const latestMessage = history[history.length - 1];
//           responseText = latestMessage.response || latestMessage.answer || latestMessage.message || "";
//           messageId = latestMessage.id;
//         } else if (Array.isArray(response.messages) && response.messages.length > 0) {
//           history = response.messages;
//           const latestMessage = history[history.length - 1];
//           responseText = latestMessage.response || latestMessage.answer || latestMessage.message || latestMessage.content || "";
//           messageId = latestMessage.id;
//         } else if (response.response || response.answer || response.message || response.content) {
//           responseText = response.response || response.answer || response.message || response.content;
//           messageId = response.id || Date.now().toString();
//           const newMessage = {
//             id: messageId,
//             question: questionText,
//             response: responseText,
//             timestamp: new Date().toISOString(),
//             created_at: new Date().toISOString(),
//             isSecretPrompt: false,
//           };
//           history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
//         }
//         console.log("📝 Extracted Response Text:", responseText);
//         console.log("📚 Chat History Length:", history.length);
//         setCurrentChatHistory(history);
//         if (responseText && responseText.trim()) {
//           setSelectedMessageId(messageId);
//           setHasResponse(true);
//           setHasAiResponse(true);
//           setForceSidebarCollapsed(true);
//           animateResponse(responseText);
//         } else {
//           console.error("❌ No response text found in:", response);
//           setChatError("Received empty response from server. Check console for details.");
//           setHasResponse(false);
//           setHasAiResponse(false);
//           setForceSidebarCollapsed(false);
//         }
//         setChatInput("");
//       } catch (err) {
//         console.error("Error sending message:", err);
//         setChatError(`Failed to send message: ${err.response?.data?.details || err.message}`);
//         setHasResponse(false);
//         setHasAiResponse(false);
//         setForceSidebarCollapsed(false);
//       } finally {
//         setLoadingChat(false);
//       }
//     }
//   };

//   // Handle selecting a chat
//   const handleSelectChat = (chat) => {
//     if (animationIntervalRef.current) {
//       clearInterval(animationIntervalRef.current);
//       animationIntervalRef.current = null;
//     }
//     setSelectedMessageId(chat.id);
//     const responseText = chat.response || chat.answer || chat.message || "";
//     setAnimatedResponseContent(responseText);
//     setIsAnimatingResponse(false);
//     setHasResponse(true);
//     setHasAiResponse(true);
//     setForceSidebarCollapsed(true);
//   };

//   // Handle new chat
//   const handleNewChat = () => {
//     if (animationIntervalRef.current) {
//       clearInterval(animationIntervalRef.current);
//       animationIntervalRef.current = null;
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
//     setIsSecretPromptSelected(false);
//     setSelectedSecretId(null);
//     setSelectedLlmName(null);
//     if (secrets.length > 0) {
//       setActiveDropdown(secrets[0].name);
//       setSelectedSecretId(secrets[0].id);
//       setSelectedLlmName(secrets[0].llm_name);
//       setIsSecretPromptSelected(true);
//     } else {
//       setActiveDropdown("Custom Query");
//       setIsSecretPromptSelected(false);
//     }
//   };

//   // Handle dropdown selection
//   const handleDropdownSelect = (secretName, secretId, llmName) => {
//     setActiveDropdown(secretName);
//     setSelectedSecretId(secretId);
//     setSelectedLlmName(llmName);
//     setIsSecretPromptSelected(true);
//     setChatInput("");
//     setShowDropdown(false);
//   };

//   // Handle custom input change
//   const handleChatInputChange = (e) => {
//     setChatInput(e.target.value);
//     if (e.target.value && isSecretPromptSelected) {
//       setIsSecretPromptSelected(false);
//       setActiveDropdown("Custom Query");
//       setSelectedSecretId(null);
//       setSelectedLlmName(null);
//     }
//   };

//   // Format relative time
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

//   // Format date for display
//   const formatDate = (dateString) => {
//     try {
//       return new Date(dateString).toLocaleString();
//     } catch {
//       return "Invalid date";
//     }
//   };

//   // Close dropdown when clicking outside
//   useEffect(() => {
//     const handleClickOutside = (event) => {
//       if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
//         setShowDropdown(false);
//       }
//     };
//     document.addEventListener("mousedown", handleClickOutside);
//     return () => document.removeEventListener("mousedown", handleClickOutside);
//   }, []);

//   // Load secrets on mount
//   useEffect(() => {
//     fetchSecrets();
//   }, []);

//   // Reset state when folder changes
//   useEffect(() => {
//     if (animationIntervalRef.current) {
//       clearInterval(animationIntervalRef.current);
//       animationIntervalRef.current = null;
//     }
//     setChatSessions([]);
//     setCurrentChatHistory([]);
//     setSelectedChatSessionId(null);
//     setHasResponse(false);
//     setHasAiResponse(false);
//     setForceSidebarCollapsed(false);
//     setAnimatedResponseContent("");
//     setSelectedMessageId(null);
//     setIsAnimatingResponse(false);
//     if (selectedFolder && selectedFolder !== "Test") {
//       fetchChatHistory();
//     }
//   }, [selectedFolder]);

//   if (!selectedFolder) {
//     return (
//       <div className="flex items-center justify-center h-full text-gray-400 text-lg bg-[#FDFCFB]">
//         Select a folder to start chatting.
//       </div>
//     );
//   }

//   return (
//     <div className="flex h-screen bg-white">
//       {/* Left Panel - Chat History */}
//       <div className={`${hasResponse ? "w-[40%]" : "w-full"} border-r border-gray-200 flex flex-col bg-white h-full transition-all duration-300 overflow-hidden`}>
//         {/* Header */}
//         <div className="p-4 border-b border-black border-opacity-20 flex-shrink-0">
//           <div className="flex items-center justify-between mb-4">
//             <h2 className="text-lg font-semibold text-gray-900">Questions</h2>
//             <button
//               onClick={handleNewChat}
//               className="px-3 py-1.5 text-sm font-medium text-white bg-[#21C1B6] hover:bg-[#1AA49B] rounded-md transition-colors"
//             >
//               New Chat
//             </button>
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
//         {/* Chat History List */}
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
//                   className={`p-3 rounded-lg border cursor-pointer transition-all duration-200 hover:shadow-md ${
//                     selectedMessageId === chat.id
//                       ? "bg-blue-50 border-blue-200 shadow-sm"
//                       : "bg-white border-gray-200 hover:bg-gray-50"
//                   }`}
//                 >
//                   <div className="flex items-start justify-between">
//                     <div className="flex-1 min-w-0">
//                       <p className="text-sm font-medium text-gray-900 mb-1 line-clamp-2">
//                         {chat.question || chat.query || "Untitled"}
//                       </p>
//                       <p className="text-xs text-gray-500">{getRelativeTime(chat.created_at || chat.timestamp)}</p>
//                     </div>
//                     <button
//                       onClick={(e) => e.stopPropagation()}
//                       className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
//                     >
//                       <MoreVertical className="h-5 w-5 text-gray-400" />
//                     </button>
//                   </div>
//                 </div>
//               ))}
//             </div>
//           )}
//         </div>
//         {/* Input Area */}
//         <div className="border-t border-gray-200 p-2 bg-white flex-shrink-0">
//           <div className="bg-white rounded-xl shadow-sm border border-[#21C1B6] p-3">
//             <input
//               type="text"
//               placeholder={isSecretPromptSelected ? `Analysis: ${activeDropdown}` : "How can I help you today?"}
//               value={chatInput}
//               onChange={handleChatInputChange}
//               onKeyPress={(e) => e.key === "Enter" && !e.shiftKey && handleNewMessage()}
//               className="w-full text-base text-gray-700 placeholder-gray-400 outline-none bg-transparent focus:ring-2 focus:ring-[#21C1B6] border-[#21C1B6]"
//               disabled={loadingChat}
//             />
//             <div className="flex items-center justify-between mt-2">
//               <div className="relative" ref={dropdownRef}>
//                 <button
//                   onClick={() => setShowDropdown(!showDropdown)}
//                   disabled={isLoadingSecrets || loadingChat}
//                   className="flex items-center space-x-2 px-4 py-2.5 bg-[#21C1B6] text-white rounded-lg hover:bg-[#1AA49B] transition-colors disabled:opacity-50"
//                 >
//                   <BookOpen className="h-4 w-4" />
//                   <span className="text-sm font-medium">{isLoadingSecrets ? "Loading..." : activeDropdown}</span>
//                   <ChevronDown className="h-4 w-4" />
//                 </button>
//                 {showDropdown && !isLoadingSecrets && (
//                   <div className="absolute bottom-full left-0 mb-2 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto scrollbar-custom">
//                     {secrets.length > 0 ? (
//                       secrets.map((secret) => (
//                         <button
//                           key={secret.id}
//                           onClick={() => handleDropdownSelect(secret.name, secret.id, secret.llm_name)}
//                           className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
//                         >
//                           {secret.name}
//                         </button>
//                       ))
//                     ) : (
//                       <div className="px-4 py-2.5 text-sm text-gray-500">No analysis prompts available</div>
//                     )}
//                   </div>
//                 )}
//               </div>
//               <button
//                 onClick={handleNewMessage}
//                 disabled={loadingChat || (!chatInput.trim() && !isSecretPromptSelected)}
//                 className="p-2.5 bg-[#21C1B6] hover:bg-[#1AA49B] disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
//               >
//                 {loadingChat ? (
//                   <Loader2 className="h-5 w-5 text-white animate-spin" />
//                 ) : (
//                   <Send className="h-5 w-5 text-white" />
//                 )}
//               </button>
//             </div>
//           </div>
//           {chatError && (
//             <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
//               {chatError}
//             </div>
//           )}
//         </div>
//       </div>
//       {/* Right Panel - AI Response */}
//       {hasResponse && (
//         <div className="w-[60%] flex flex-col h-full overflow-hidden">
//           <div className="flex-1 overflow-y-auto scrollbar-custom" ref={responseRef}>
//             {loadingChat && !animatedResponseContent ? (
//               <div className="flex items-center justify-center h-full">
//                 <div className="text-center">
//                   <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-[#21C1B6]" />
//                   <p className="text-gray-600">Generating response...</p>
//                 </div>
//               </div>
//             ) : selectedMessageId && animatedResponseContent ? (
//               <div className="px-6 py-6">
//                 <div className="mb-6 pb-4 border-b border-gray-200">
//                   <div className="flex items-center justify-between">
//                     <h2 className="text-xl font-semibold text-gray-900">AI Response</h2>
//                     <div className="text-sm text-gray-500">
//                       {currentChatHistory.find((msg) => msg.id === selectedMessageId)?.timestamp && (
//                         <span>{formatDate(currentChatHistory.find((msg) => msg.id === selectedMessageId).timestamp)}</span>
//                       )}
//                     </div>
//                   </div>
//                   <div className="mt-3 p-3 bg-blue-50 rounded-lg border-l-4 border-[#21C1B6]">
//                     <p className="text-sm font-medium text-blue-900 mb-1">Question:</p>
//                     <p className="text-sm text-blue-800">
//                       {currentChatHistory.find((msg) => msg.id === selectedMessageId)?.question || "No question available"}
//                     </p>
//                   </div>
//                 </div>
//                 <div className="prose prose-gray max-w-none">
//                   <ReactMarkdown
//                     remarkPlugins={[remarkGfm]}
//                     components={{
//                       h1: ({ ...props }) => <h1 className="text-2xl font-bold mb-6 mt-8 text-black border-b-2 border-gray-300 pb-2" {...props} />,
//                       h2: ({ ...props }) => <h2 className="text-xl font-bold mb-4 mt-6 text-black" {...props} />,
//                       h3: ({ ...props }) => <h3 className="text-lg font-bold mb-3 mt-4 text-black" {...props} />,
//                       p: ({ ...props }) => <p className="mb-4 leading-relaxed text-black text-justify" {...props} />,
//                       strong: ({ ...props }) => <strong className="font-bold text-black" {...props} />,
//                       ul: ({ ...props }) => <ul className="list-disc pl-5 mb-4 text-black" {...props} />,
//                       ol: ({ ...props }) => <ol className="list-decimal pl-5 mb-4 text-black" {...props} />,
//                       li: ({ ...props }) => <li className="mb-2 leading-relaxed text-black" {...props} />,
//                       blockquote: ({ ...props }) => (
//                         <blockquote className="border-l-4 border-gray-300 pl-4 italic text-gray-700 my-4" {...props} />
//                       ),
//                       code: ({ inline, ...props }) => (
//                         <code
//                           className={inline ? "bg-gray-100 px-1 py-0.5 rounded text-sm font-mono text-red-700" : "block bg-gray-100 p-4 rounded-md text-sm font-mono overflow-x-auto my-4 text-red-700"}
//                           {...props}
//                         />
//                       ),
//                       table: ({ ...props }) => (
//                         <div className="overflow-x-auto my-4">
//                           <table className="min-w-full divide-y divide-gray-300 border border-gray-300" {...props} />
//                         </div>
//                       ),
//                       thead: ({ ...props }) => <thead className="bg-gray-50" {...props} />,
//                       th: ({ ...props }) => <th className="px-4 py-2 text-left text-sm font-semibold text-gray-900 border-b border-gray-300" {...props} />,
//                       td: ({ ...props }) => <td className="px-4 py-2 text-sm text-gray-700 border-b border-gray-200" {...props} />,
//                     }}
//                   >
//                     {animatedResponseContent}
//                   </ReactMarkdown>
//                   {isAnimatingResponse && <span className="inline-block w-2 h-5 bg-gray-400 animate-pulse ml-1"></span>}
//                 </div>
//               </div>
//             ) : (
//               <div className="flex items-center justify-center h-full">
//                 <div className="text-center max-w-md px-6">
//                   <MessageSquare className="h-16 w-16 mx-auto mb-6 text-gray-300" />
//                   <h3 className="text-2xl font-semibold mb-4 text-gray-900">Select a Question</h3>
//                   <p className="text-gray-600 text-lg leading-relaxed">
//                     Click on any question from the left panel to view the AI response here.
//                   </p>
//                 </div>
//               </div>
//             )}
//           </div>
//         </div>
//       )}
//       <style jsx>{`
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
//       `}</style>
//     </div>
//   );
// };

// export default ChatInterface;



// import React, { useState, useEffect, useContext, useRef } from "react";
// import { FileManagerContext } from "../../context/FileManagerContext";
// import documentApi from "../../services/documentApi";
// import {
//   Plus,
//   Search,
//   BookOpen,
//   ChevronDown,
//   MoreVertical,
//   MessageSquare,
//   Loader2,
//   Send,
// } from "lucide-react";
// import ReactMarkdown from "react-markdown";
// import remarkGfm from "remark-gfm";
// import { SidebarContext } from "../../context/SidebarContext";

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
//   const [isAnimatingResponse, setIsAnimatingResponse] = useState(false);
//   const [selectedMessageId, setSelectedMessageId] = useState(null);
//   const [hasResponse, setHasResponse] = useState(false);
//   const [secrets, setSecrets] = useState([]);
//   const [isLoadingSecrets, setIsLoadingSecrets] = useState(false);
//   const [selectedSecretId, setSelectedSecretId] = useState(null);
//   const [selectedLlmName, setSelectedLlmName] = useState(null);
//   const [activeDropdown, setActiveDropdown] = useState("Summary");
//   const [showDropdown, setShowDropdown] = useState(false);
//   const [isSecretPromptSelected, setIsSecretPromptSelected] = useState(false);
//   const responseRef = useRef(null);
//   const dropdownRef = useRef(null);
//   const animationFrameRef = useRef(null);

//   // API Configuration
//   const API_BASE_URL = "https://gateway-service-120280829617.asia-south1.run.app";
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

//   // Fetch secrets list
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
//       if (secretsData?.length > 0) {
//         setActiveDropdown(secretsData[0].name);
//         setSelectedSecretId(secretsData[0].id);
//         setSelectedLlmName(secretsData[0].llm_name);
//         setIsSecretPromptSelected(true);
//       } else {
//         setActiveDropdown("Custom Query");
//         setSelectedSecretId(null);
//         setSelectedLlmName(null);
//         setIsSecretPromptSelected(false);
//       }
//     } catch (error) {
//       console.error("Error fetching secrets:", error);
//       setChatError(`Failed to load analysis prompts: ${error.message}`);
//     } finally {
//       setIsLoadingSecrets(false);
//     }
//   };

//   // Fetch secret value by ID
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

//   // Fetch chat history
//   const fetchChatHistory = async (sessionId) => {
//     if (!selectedFolder) return;
//     setLoadingChat(true);
//     setChatError(null);
//     try {
//       const data = await documentApi.getFolderChats(selectedFolder);
//       const chats = Array.isArray(data.chats) ? data.chats : [];
//       setCurrentChatHistory(chats);
//       if (sessionId) {
//         setSelectedChatSessionId(sessionId);
//         const selectedChat = chats.find((c) => c.id === sessionId);
//         if (selectedChat) {
//           const responseText = selectedChat.response || selectedChat.answer || selectedChat.message || "";
//           setSelectedMessageId(selectedChat.id);
//           setAnimatedResponseContent(responseText);
//           setHasResponse(true);
//           setHasAiResponse(true);
//           setForceSidebarCollapsed(true);
//         }
//       } else {
//         setHasResponse(false);
//         setHasAiResponse(false);
//         setForceSidebarCollapsed(false);
//       }
//     } catch (err) {
//       console.error("Error fetching chats:", err);
//       setChatError("Failed to fetch chat history.");
//     } finally {
//       setLoadingChat(false);
//     }
//   };

//   // Animate typing effect
//   const animateResponse = (text) => {
//     if (animationFrameRef.current) {
//       cancelAnimationFrame(animationFrameRef.current);
//       animationFrameRef.current = null;
//     }
//     setAnimatedResponseContent("");
//     setIsAnimatingResponse(true);
//     let i = 0;
//     const charsPerFrame = 3; // Render 3 characters per frame to reduce state updates
//     const animate = () => {
//       if (i < text.length) {
//         const nextChunk = text.slice(i, i + charsPerFrame);
//         setAnimatedResponseContent((prev) => prev + nextChunk);
//         i += charsPerFrame;
//         if (responseRef.current) {
//           responseRef.current.scrollTop = responseRef.current.scrollHeight;
//         }
//         animationFrameRef.current = requestAnimationFrame(animate);
//       } else {
//         setIsAnimatingResponse(false);
//       }
//     };
//     animationFrameRef.current = requestAnimationFrame(animate);
//   };

//   // Cleanup animation on unmount
//   useEffect(() => {
//     return () => {
//       if (animationFrameRef.current) {
//         cancelAnimationFrame(animationFrameRef.current);
//       }
//     };
//   }, []);

//   // Chat with AI using secret prompt
//   const chatWithAI = async (folder, secretId, currentSessionId) => {
//     try {
//       setLoadingChat(true);
//       setChatError(null);
//       const isContinuingSession = !!currentSessionId && currentChatHistory.length > 0;
//       if (!isContinuingSession) {
//         setHasResponse(true);
//         setHasAiResponse(true);
//         setForceSidebarCollapsed(true);
//       }
//       const selectedSecret = secrets.find((s) => s.id === secretId);
//       if (!selectedSecret) throw new Error("No prompt found for selected analysis type");
//       let promptValue = selectedSecret.value;
//       const promptLabel = selectedSecret.name;
//       if (!promptValue) promptValue = await fetchSecretValue(secretId);
//       if (!promptValue) throw new Error("Secret prompt value is empty.");
//       console.log("🔄 Sending request with session:", currentSessionId);
//       const response = await documentApi.queryFolderDocuments(folder, promptValue, currentSessionId, {
//         used_secret_prompt: true,
//         prompt_label: promptLabel,
//         secret_id: secretId,
//       });
//       console.log("🔍 Full API Response:", response);
//       const sessionId = response.sessionId || response.session_id || response.id;
//       console.log("🆔 Session ID - Current:", currentSessionId, "New:", sessionId);
//       if (sessionId) {
//         setSelectedChatSessionId(sessionId);
//       }
//       let history = [];
//       let responseText = "";
//       let messageId = null;
//       if (Array.isArray(response.chatHistory) && response.chatHistory.length > 0) {
//         history = response.chatHistory;
//         const latestMessage = history[history.length - 1];
//         responseText = latestMessage.response || latestMessage.answer || latestMessage.message || "";
//         messageId = latestMessage.id;
//       } else if (Array.isArray(response.chat_history) && response.chat_history.length > 0) {
//         history = response.chat_history;
//         const latestMessage = history[history.length - 1];
//         responseText = latestMessage.response || latestMessage.answer || latestMessage.message || "";
//         messageId = latestMessage.id;
//       } else if (Array.isArray(response.messages) && response.messages.length > 0) {
//         history = response.messages;
//         const latestMessage = history[history.length - 1];
//         responseText = latestMessage.response || latestMessage.answer || latestMessage.message || latestMessage.content || "";
//         messageId = latestMessage.id;
//       } else if (response.response || response.answer || response.message || response.content) {
//         responseText = response.response || response.answer || response.message || response.content;
//         messageId = response.id || Date.now().toString();
//         const newMessage = {
//           id: messageId,
//           question: promptLabel,
//           response: responseText,
//           timestamp: new Date().toISOString(),
//           created_at: new Date().toISOString(),
//           isSecretPrompt: true,
//         };
//         history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
//       }
//       console.log("📝 Extracted Response Text:", responseText);
//       console.log("📚 Chat History Length:", history.length);
//       setCurrentChatHistory(history);
//       if (responseText && responseText.trim()) {
//         setSelectedMessageId(messageId);
//         setHasResponse(true);
//         setHasAiResponse(true);
//         setForceSidebarCollapsed(true);
//         animateResponse(responseText);
//       } else {
//         console.error("❌ No response text found in:", response);
//         setChatError("Received empty response from server. Check console for details.");
//         setHasResponse(false);
//         setHasAiResponse(false);
//         setForceSidebarCollapsed(false);
//       }
//       return response;
//     } catch (error) {
//       console.error("Chat error:", error);
//       setChatError(`Analysis failed: ${error.message}`);
//       setHasResponse(false);
//       setHasAiResponse(false);
//       setForceSidebarCollapsed(false);
//       throw error;
//     } finally {
//       setLoadingChat(false);
//     }
//   };

//   // Handle new message
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
//     } else {
//       if (!chatInput.trim()) return;
//       const questionText = chatInput.trim();
//       setLoadingChat(true);
//       setChatError(null);
//       const isContinuingSession = !!selectedChatSessionId && currentChatHistory.length > 0;
//       if (!isContinuingSession) {
//         setHasResponse(true);
//         setHasAiResponse(true);
//         setForceSidebarCollapsed(true);
//       }
//       try {
//         console.log("🔄 Sending message with session:", selectedChatSessionId);
//         const response = await documentApi.queryFolderDocuments(
//           selectedFolder,
//           questionText,
//           selectedChatSessionId,
//           { used_secret_prompt: false }
//         );
//         console.log("🔍 Full API Response:", response);
//         const sessionId = response.sessionId || response.session_id || response.id;
//         console.log("🆔 Session ID - Current:", selectedChatSessionId, "New:", sessionId);
//         if (sessionId) {
//           setSelectedChatSessionId(sessionId);
//         }
//         let history = [];
//         let responseText = "";
//         let messageId = null;
//         if (Array.isArray(response.chatHistory) && response.chatHistory.length > 0) {
//           history = response.chatHistory;
//           const latestMessage = history[history.length - 1];
//           responseText = latestMessage.response || latestMessage.answer || latestMessage.message || "";
//           messageId = latestMessage.id;
//         } else if (Array.isArray(response.chat_history) && response.chat_history.length > 0) {
//           history = response.chat_history;
//           const latestMessage = history[history.length - 1];
//           responseText = latestMessage.response || latestMessage.answer || latestMessage.message || "";
//           messageId = latestMessage.id;
//         } else if (Array.isArray(response.messages) && response.messages.length > 0) {
//           history = response.messages;
//           const latestMessage = history[history.length - 1];
//           responseText = latestMessage.response || latestMessage.answer || latestMessage.message || latestMessage.content || "";
//           messageId = latestMessage.id;
//         } else if (response.response || response.answer || response.message || response.content) {
//           responseText = response.response || response.answer || response.message || response.content;
//           messageId = response.id || Date.now().toString();
//           const newMessage = {
//             id: messageId,
//             question: questionText,
//             response: responseText,
//             timestamp: new Date().toISOString(),
//             created_at: new Date().toISOString(),
//             isSecretPrompt: false,
//           };
//           history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
//         }
//         console.log("📝 Extracted Response Text:", responseText);
//         console.log("📚 Chat History Length:", history.length);
//         setCurrentChatHistory(history);
//         if (responseText && responseText.trim()) {
//           setSelectedMessageId(messageId);
//           setHasResponse(true);
//           setHasAiResponse(true);
//           setForceSidebarCollapsed(true);
//           animateResponse(responseText);
//         } else {
//           console.error("❌ No response text found in:", response);
//           setChatError("Received empty response from server. Check console for details.");
//           setHasResponse(false);
//           setHasAiResponse(false);
//           setForceSidebarCollapsed(false);
//         }
//         setChatInput("");
//       } catch (err) {
//         console.error("Error sending message:", err);
//         setChatError(`Failed to send message: ${err.response?.data?.details || err.message}`);
//         setHasResponse(false);
//         setHasAiResponse(false);
//         setForceSidebarCollapsed(false);
//       } finally {
//         setLoadingChat(false);
//       }
//     }
//   };

//   // Handle selecting a chat
//   const handleSelectChat = (chat) => {
//     if (animationFrameRef.current) {
//       cancelAnimationFrame(animationFrameRef.current);
//       animationFrameRef.current = null;
//     }
//     setSelectedMessageId(chat.id);
//     const responseText = chat.response || chat.answer || chat.message || "";
//     setAnimatedResponseContent(responseText);
//     setIsAnimatingResponse(false);
//     setHasResponse(true);
//     setHasAiResponse(true);
//     setForceSidebarCollapsed(true);
//   };

//   // Handle new chat
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
//     setIsSecretPromptSelected(false);
//     setSelectedSecretId(null);
//     setSelectedLlmName(null);
//     if (secrets.length > 0) {
//       setActiveDropdown(secrets[0].name);
//       setSelectedSecretId(secrets[0].id);
//       setSelectedLlmName(secrets[0].llm_name);
//       setIsSecretPromptSelected(true);
//     } else {
//       setActiveDropdown("Custom Query");
//       setIsSecretPromptSelected(false);
//     }
//   };

//   // Handle dropdown selection
//   const handleDropdownSelect = (secretName, secretId, llmName) => {
//     setActiveDropdown(secretName);
//     setSelectedSecretId(secretId);
//     setSelectedLlmName(llmName);
//     setIsSecretPromptSelected(true);
//     setChatInput("");
//     setShowDropdown(false);
//   };

//   // Handle custom input change
//   const handleChatInputChange = (e) => {
//     setChatInput(e.target.value);
//     if (e.target.value && isSecretPromptSelected) {
//       setIsSecretPromptSelected(false);
//       setActiveDropdown("Custom Query");
//       setSelectedSecretId(null);
//       setSelectedLlmName(null);
//     }
//   };

//   // Format relative time
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

//   // Format date for display
//   const formatDate = (dateString) => {
//     try {
//       return new Date(dateString).toLocaleString();
//     } catch {
//       return "Invalid date";
//     }
//   };

//   // Close dropdown when clicking outside
//   useEffect(() => {
//     const handleClickOutside = (event) => {
//       if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
//         setShowDropdown(false);
//       }
//     };
//     document.addEventListener("mousedown", handleClickOutside);
//     return () => document.removeEventListener("mousedown", handleClickOutside);
//   }, []);

//   // Load secrets on mount
//   useEffect(() => {
//     fetchSecrets();
//   }, []);

//   // Reset state when folder changes
//   useEffect(() => {
//     if (animationFrameRef.current) {
//       cancelAnimationFrame(animationFrameRef.current);
//       animationFrameRef.current = null;
//     }
//     setChatSessions([]);
//     setCurrentChatHistory([]);
//     setSelectedChatSessionId(null);
//     setHasResponse(false);
//     setHasAiResponse(false);
//     setForceSidebarCollapsed(false);
//     setAnimatedResponseContent("");
//     setSelectedMessageId(null);
//     setIsAnimatingResponse(false);
//     if (selectedFolder && selectedFolder !== "Test") {
//       fetchChatHistory();
//     }
//   }, [selectedFolder]);

//   if (!selectedFolder) {
//     return (
//       <div className="flex items-center justify-center h-full text-gray-400 text-lg bg-[#FDFCFB]">
//         Select a folder to start chatting.
//       </div>
//     );
//   }

//   return (
//     <div className="flex h-screen bg-white">
//       {/* Left Panel - Chat History */}
//       <div className={`${hasResponse ? "w-[40%]" : "w-full"} border-r border-gray-200 flex flex-col bg-white h-full transition-all duration-300 overflow-hidden`}>
//         {/* Header */}
//         <div className="p-4 border-b border-black border-opacity-20 flex-shrink-0">
//           <div className="flex items-center justify-between mb-4">
//             <h2 className="text-lg font-semibold text-gray-900">Questions</h2>
//             <button
//               onClick={handleNewChat}
//               className="px-3 py-1.5 text-sm font-medium text-white bg-[#21C1B6] hover:bg-[#1AA49B] rounded-md transition-colors"
//             >
//               New Chat
//             </button>
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
//         {/* Chat History List */}
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
//                   className={`p-3 rounded-lg border cursor-pointer transition-all duration-200 hover:shadow-md ${
//                     selectedMessageId === chat.id
//                       ? "bg-blue-50 border-blue-200 shadow-sm"
//                       : "bg-white border-gray-200 hover:bg-gray-50"
//                   }`}
//                 >
//                   <div className="flex items-start justify-between">
//                     <div className="flex-1 min-w-0">
//                       <p className="text-sm font-medium text-gray-900 mb-1 line-clamp-2">
//                         {chat.question || chat.query || "Untitled"}
//                       </p>
//                       <p className="text-xs text-gray-500">{getRelativeTime(chat.created_at || chat.timestamp)}</p>
//                     </div>
//                     <button
//                       onClick={(e) => e.stopPropagation()}
//                       className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
//                     >
//                       <MoreVertical className="h-5 w-5 text-gray-400" />
//                     </button>
//                   </div>
//                 </div>
//               ))}
//             </div>
//           )}
//         </div>
//         {/* Input Area */}
//         <div className="border-t border-gray-200 p-2 bg-white flex-shrink-0">
//           <div className="bg-white rounded-xl shadow-sm border border-[#21C1B6] p-3">
//             <input
//               type="text"
//               placeholder={isSecretPromptSelected ? `Analysis: ${activeDropdown}` : "How can I help you today?"}
//               value={chatInput}
//               onChange={handleChatInputChange}
//               onKeyPress={(e) => e.key === "Enter" && !e.shiftKey && handleNewMessage()}
//               className="w-full text-base text-gray-700 placeholder-gray-400 outline-none bg-transparent focus:ring-2 focus:ring-[#21C1B6] border-[#21C1B6]"
//               disabled={loadingChat}
//             />
//             <div className="flex items-center justify-between mt-2">
//               <div className="relative" ref={dropdownRef}>
//                 <button
//                   onClick={() => setShowDropdown(!showDropdown)}
//                   disabled={isLoadingSecrets || loadingChat}
//                   className="flex items-center space-x-2 px-4 py-2.5 bg-[#21C1B6] text-white rounded-lg hover:bg-[#1AA49B] transition-colors disabled:opacity-50"
//                 >
//                   <BookOpen className="h-4 w-4" />
//                   <span className="text-sm font-medium">{isLoadingSecrets ? "Loading..." : activeDropdown}</span>
//                   <ChevronDown className="h-4 w-4" />
//                 </button>
//                 {showDropdown && !isLoadingSecrets && (
//                   <div className="absolute bottom-full left-0 mb-2 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto scrollbar-custom">
//                     {secrets.length > 0 ? (
//                       secrets.map((secret) => (
//                         <button
//                           key={secret.id}
//                           onClick={() => handleDropdownSelect(secret.name, secret.id, secret.llm_name)}
//                           className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
//                         >
//                           {secret.name}
//                         </button>
//                       ))
//                     ) : (
//                       <div className="px-4 py-2.5 text-sm text-gray-500">No analysis prompts available</div>
//                     )}
//                   </div>
//                 )}
//               </div>
//               <button
//                 onClick={handleNewMessage}
//                 disabled={loadingChat || (!chatInput.trim() && !isSecretPromptSelected)}
//                 className="p-2.5 bg-[#21C1B6] hover:bg-[#1AA49B] disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
//               >
//                 {loadingChat ? (
//                   <Loader2 className="h-5 w-5 text-white animate-spin" />
//                 ) : (
//                   <Send className="h-5 w-5 text-white" />
//                 )}
//               </button>
//             </div>
//           </div>
//           {chatError && (
//             <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
//               {chatError}
//             </div>
//           )}
//         </div>
//       </div>
//       {/* Right Panel - AI Response */}
//       {hasResponse && (
//         <div className="w-[60%] flex flex-col h-full overflow-hidden">
//           <div className="flex-1 overflow-y-auto scrollbar-custom" ref={responseRef}>
//             {loadingChat && !animatedResponseContent ? (
//               <div className="flex items-center justify-center h-full">
//                 <div className="text-center">
//                   <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-[#21C1B6]" />
//                   <p className="text-gray-600">Generating response...</p>
//                 </div>
//               </div>
//             ) : selectedMessageId && animatedResponseContent ? (
//               <div className="px-6 py-6">
//                 <div className="mb-6 pb-4 border-b border-gray-200">
//                   <div className="flex items-center justify-between">
//                     <h2 className="text-xl font-semibold text-gray-900">AI Response</h2>
//                     <div className="text-sm text-gray-500">
//                       {currentChatHistory.find((msg) => msg.id === selectedMessageId)?.timestamp && (
//                         <span>{formatDate(currentChatHistory.find((msg) => msg.id === selectedMessageId).timestamp)}</span>
//                       )}
//                     </div>
//                   </div>
//                   <div className="mt-3 p-3 bg-blue-50 rounded-lg border-l-4 border-[#21C1B6]">
//                     <p className="text-sm font-medium text-blue-900 mb-1">Question:</p>
//                     <p className="text-sm text-blue-800">
//                       {currentChatHistory.find((msg) => msg.id === selectedMessageId)?.question || "No question available"}
//                     </p>
//                   </div>
//                 </div>
//                 <div className="prose prose-gray max-w-none">
//                   <ReactMarkdown
//                     remarkPlugins={[remarkGfm]}
//                     components={{
//                       h1: ({ ...props }) => <h1 className="text-2xl font-bold mb-6 mt-8 text-black border-b-2 border-gray-300 pb-2" {...props} />,
//                       h2: ({ ...props }) => <h2 className="text-xl font-bold mb-4 mt-6 text-black" {...props} />,
//                       h3: ({ ...props }) => <h3 className="text-lg font-bold mb-3 mt-4 text-black" {...props} />,
//                       p: ({ ...props }) => <p className="mb-4 leading-relaxed text-black text-justify" {...props} />,
//                       strong: ({ ...props }) => <strong className="font-bold text-black" {...props} />,
//                       ul: ({ ...props }) => <ul className="list-disc pl-5 mb-4 text-black" {...props} />,
//                       ol: ({ ...props }) => <ol className="list-decimal pl-5 mb-4 text-black" {...props} />,
//                       li: ({ ...props }) => <li className="mb-2 leading-relaxed text-black" {...props} />,
//                       blockquote: ({ ...props }) => (
//                         <blockquote className="border-l-4 border-gray-300 pl-4 italic text-gray-700 my-4" {...props} />
//                       ),
//                       code: ({ inline, ...props }) => (
//                         <code
//                           className={inline ? "bg-gray-100 px-1 py-0.5 rounded text-sm font-mono text-red-700" : "block bg-gray-100 p-4 rounded-md text-sm font-mono overflow-x-auto my-4 text-red-700"}
//                           {...props}
//                         />
//                       ),
//                       table: ({ ...props }) => (
//                         <div className="overflow-x-auto my-4">
//                           <table className="min-w-full divide-y divide-gray-300 border border-gray-300" {...props} />
//                         </div>
//                       ),
//                       thead: ({ ...props }) => <thead className="bg-gray-50" {...props} />,
//                       th: ({ ...props }) => <th className="px-4 py-2 text-left text-sm font-semibold text-gray-900 border-b border-gray-300" {...props} />,
//                       td: ({ ...props }) => <td className="px-4 py-2 text-sm text-gray-700 border-b border-gray-200" {...props} />,
//                     }}
//                   >
//                     {animatedResponseContent}
//                   </ReactMarkdown>
//                   {isAnimatingResponse && <span className="inline-block w-2 h-5 bg-gray-400 animate-pulse ml-1"></span>}
//                 </div>
//               </div>
//             ) : (
//               <div className="flex items-center justify-center h-full">
//                 <div className="text-center max-w-md px-6">
//                   <MessageSquare className="h-16 w-16 mx-auto mb-6 text-gray-300" />
//                   <h3 className="text-2xl font-semibold mb-4 text-gray-900">Select a Question</h3>
//                   <p className="text-gray-600 text-lg leading-relaxed">
//                     Click on any question from the left panel to view the AI response here.
//                   </p>
//                 </div>
//               </div>
//             )}
//           </div>
//         </div>
//       )}
//       <style jsx>{`
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
//       `}</style>
//     </div>
//   );
// };

// export default ChatInterface;



// import React, { useState, useEffect, useContext, useRef } from "react";
// import { FileManagerContext } from "../../context/FileManagerContext";
// import documentApi from "../../services/documentApi";
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
// } from "lucide-react";
// import ReactMarkdown from "react-markdown";
// import remarkGfm from "remark-gfm";
// import { SidebarContext } from "../../context/SidebarContext";
// import DownloadPdf from "../DownloadPdf/DownloadPdf";
// import "../../styles/ChatInterface.css";

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
//   const [isAnimatingResponse, setIsAnimatingResponse] = useState(false);
//   const [selectedMessageId, setSelectedMessageId] = useState(null);
//   const [hasResponse, setHasResponse] = useState(false);
//   const [secrets, setSecrets] = useState([]);
//   const [isLoadingSecrets, setIsLoadingSecrets] = useState(false);
//   const [selectedSecretId, setSelectedSecretId] = useState(null);
//   const [selectedLlmName, setSelectedLlmName] = useState(null);
//   const [activeDropdown, setActiveDropdown] = useState("Summary");
//   const [showDropdown, setShowDropdown] = useState(false);
//   const [isSecretPromptSelected, setIsSecretPromptSelected] = useState(false);
//   const [copySuccess, setCopySuccess] = useState(false);
//   const [isGenerating, setIsGenerating] = useState(false);
//   const responseRef = useRef(null);
//   const dropdownRef = useRef(null);
//   const animationFrameRef = useRef(null);
//   const markdownOutputRef = useRef(null);

//   // API Configuration
//   const API_BASE_URL = "https://gateway-service-120280829617.asia-south1.run.app";
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

//   // Copy to clipboard function
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

//   // Fetch secrets list
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
//       if (secretsData?.length > 0) {
//         setActiveDropdown(secretsData[0].name);
//         setSelectedSecretId(secretsData[0].id);
//         setSelectedLlmName(secretsData[0].llm_name);
//         setIsSecretPromptSelected(true);
//       } else {
//         setActiveDropdown("Custom Query");
//         setSelectedSecretId(null);
//         setSelectedLlmName(null);
//         setIsSecretPromptSelected(false);
//       }
//     } catch (error) {
//       console.error("Error fetching secrets:", error);
//       setChatError(`Failed to load analysis prompts: ${error.message}`);
//     } finally {
//       setIsLoadingSecrets(false);
//     }
//   };

//   // Fetch secret value by ID
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

//   // Fetch chat history
//   const fetchChatHistory = async (sessionId) => {
//     if (!selectedFolder) return;
//     setLoadingChat(true);
//     setChatError(null);
//     try {
//       const data = await documentApi.getFolderChats(selectedFolder);
//       const chats = Array.isArray(data.chats) ? data.chats : [];
//       setCurrentChatHistory(chats);
//       if (sessionId) {
//         setSelectedChatSessionId(sessionId);
//         const selectedChat = chats.find((c) => c.id === sessionId);
//         if (selectedChat) {
//           const responseText = selectedChat.response || selectedChat.answer || selectedChat.message || "";
//           setSelectedMessageId(selectedChat.id);
//           setAnimatedResponseContent(responseText);
//           setHasResponse(true);
//           setHasAiResponse(true);
//           setForceSidebarCollapsed(true);
//         }
//       } else {
//         setHasResponse(false);
//         setHasAiResponse(false);
//         setForceSidebarCollapsed(false);
//       }
//     } catch (err) {
//       console.error("Error fetching chats:", err);
//       setChatError("Failed to fetch chat history.");
//     } finally {
//       setLoadingChat(false);
//     }
//   };

//   // Animate typing effect
//   const animateResponse = (text) => {
//     if (animationFrameRef.current) {
//       cancelAnimationFrame(animationFrameRef.current);
//       animationFrameRef.current = null;
//     }
//     setAnimatedResponseContent("");
//     setIsAnimatingResponse(true);
//     setIsGenerating(true);
//     let i = 0;
//     const charsPerFrame = 3;
//     const animate = () => {
//       if (i < text.length) {
//         const nextChunk = text.slice(i, i + charsPerFrame);
//         setAnimatedResponseContent((prev) => prev + nextChunk);
//         i += charsPerFrame;
//         if (responseRef.current) {
//           responseRef.current.scrollTop = responseRef.current.scrollHeight;
//         }
//         animationFrameRef.current = requestAnimationFrame(animate);
//       } else {
//         setIsAnimatingResponse(false);
//         setIsGenerating(false);
//       }
//     };
//     animationFrameRef.current = requestAnimationFrame(animate);
//   };

//   // Stop response generation
//   const handleStopGeneration = () => {
//     if (animationFrameRef.current) {
//       cancelAnimationFrame(animationFrameRef.current);
//       animationFrameRef.current = null;
//     }
//     setIsAnimatingResponse(false);
//     setIsGenerating(false);
//     setLoadingChat(false);
//   };

//   // Cleanup animation on unmount
//   useEffect(() => {
//     return () => {
//       if (animationFrameRef.current) {
//         cancelAnimationFrame(animationFrameRef.current);
//       }
//     };
//   }, []);

//   // Chat with AI using secret prompt
//   const chatWithAI = async (folder, secretId, currentSessionId) => {
//     try {
//       setLoadingChat(true);
//       setChatError(null);
//       const isContinuingSession = !!currentSessionId && currentChatHistory.length > 0;
//       if (!isContinuingSession) {
//         setHasResponse(true);
//         setHasAiResponse(true);
//         setForceSidebarCollapsed(true);
//       }
//       const selectedSecret = secrets.find((s) => s.id === secretId);
//       if (!selectedSecret) throw new Error("No prompt found for selected analysis type");
//       let promptValue = selectedSecret.value;
//       const promptLabel = selectedSecret.name;
//       if (!promptValue) promptValue = await fetchSecretValue(secretId);
//       if (!promptValue) throw new Error("Secret prompt value is empty.");
//       const response = await documentApi.queryFolderDocuments(folder, promptValue, currentSessionId, {
//         used_secret_prompt: true,
//         prompt_label: promptLabel,
//         secret_id: secretId,
//       });
//       const sessionId = response.sessionId || response.session_id || response.id;
//       if (sessionId) {
//         setSelectedChatSessionId(sessionId);
//       }
//       let history = [];
//       let responseText = "";
//       let messageId = null;
//       if (Array.isArray(response.chatHistory) && response.chatHistory.length > 0) {
//         history = response.chatHistory;
//         const latestMessage = history[history.length - 1];
//         responseText = latestMessage.response || latestMessage.answer || latestMessage.message || "";
//         messageId = latestMessage.id;
//       } else if (Array.isArray(response.chat_history) && response.chat_history.length > 0) {
//         history = response.chat_history;
//         const latestMessage = history[history.length - 1];
//         responseText = latestMessage.response || latestMessage.answer || latestMessage.message || "";
//         messageId = latestMessage.id;
//       } else if (Array.isArray(response.messages) && response.messages.length > 0) {
//         history = response.messages;
//         const latestMessage = history[history.length - 1];
//         responseText = latestMessage.response || latestMessage.answer || latestMessage.message || latestMessage.content || "";
//         messageId = latestMessage.id;
//       } else if (response.response || response.answer || response.message || response.content) {
//         responseText = response.response || response.answer || response.message || response.content;
//         messageId = response.id || Date.now().toString();
//         const newMessage = {
//           id: messageId,
//           question: promptLabel,
//           response: responseText,
//           timestamp: new Date().toISOString(),
//           created_at: new Date().toISOString(),
//           isSecretPrompt: true,
//         };
//         history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
//       }
//       setCurrentChatHistory(history);
//       if (responseText && responseText.trim()) {
//         setSelectedMessageId(messageId);
//         setHasResponse(true);
//         setHasAiResponse(true);
//         setForceSidebarCollapsed(true);
//         animateResponse(responseText);
//       } else {
//         setChatError("Received empty response from server.");
//         setHasResponse(false);
//         setHasAiResponse(false);
//         setForceSidebarCollapsed(false);
//       }
//       return response;
//     } catch (error) {
//       console.error("Chat error:", error);
//       setChatError(`Analysis failed: ${error.message}`);
//       setHasResponse(false);
//       setHasAiResponse(false);
//       setForceSidebarCollapsed(false);
//       throw error;
//     } finally {
//       setLoadingChat(false);
//     }
//   };

//   // Handle new message
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
//     } else {
//       if (!chatInput.trim()) return;
//       const questionText = chatInput.trim();
//       setLoadingChat(true);
//       setChatError(null);
//       const isContinuingSession = !!selectedChatSessionId && currentChatHistory.length > 0;
//       if (!isContinuingSession) {
//         setHasResponse(true);
//         setHasAiResponse(true);
//         setForceSidebarCollapsed(true);
//       }
//       try {
//         const response = await documentApi.queryFolderDocuments(
//           selectedFolder,
//           questionText,
//           selectedChatSessionId,
//           { used_secret_prompt: false }
//         );
//         const sessionId = response.sessionId || response.session_id || response.id;
//         if (sessionId) {
//           setSelectedChatSessionId(sessionId);
//         }
//         let history = [];
//         let responseText = "";
//         let messageId = null;
//         if (Array.isArray(response.chatHistory) && response.chatHistory.length > 0) {
//           history = response.chatHistory;
//           const latestMessage = history[history.length - 1];
//           responseText = latestMessage.response || latestMessage.answer || latestMessage.message || "";
//           messageId = latestMessage.id;
//         } else if (Array.isArray(response.chat_history) && response.chat_history.length > 0) {
//           history = response.chat_history;
//           const latestMessage = history[history.length - 1];
//           responseText = latestMessage.response || latestMessage.answer || latestMessage.message || "";
//           messageId = latestMessage.id;
//         } else if (Array.isArray(response.messages) && response.messages.length > 0) {
//           history = response.messages;
//           const latestMessage = history[history.length - 1];
//           responseText = latestMessage.response || latestMessage.answer || latestMessage.message || latestMessage.content || "";
//           messageId = latestMessage.id;
//         } else if (response.response || response.answer || response.message || response.content) {
//           responseText = response.response || response.answer || response.message || response.content;
//           messageId = response.id || Date.now().toString();
//           const newMessage = {
//             id: messageId,
//             question: questionText,
//             response: responseText,
//             timestamp: new Date().toISOString(),
//             created_at: new Date().toISOString(),
//             isSecretPrompt: false,
//           };
//           history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
//         }
//         setCurrentChatHistory(history);
//         if (responseText && responseText.trim()) {
//           setSelectedMessageId(messageId);
//           setHasResponse(true);
//           setHasAiResponse(true);
//           setForceSidebarCollapsed(true);
//           animateResponse(responseText);
//         } else {
//           setChatError("Received empty response from server.");
//           setHasResponse(false);
//           setHasAiResponse(false);
//           setForceSidebarCollapsed(false);
//         }
//         setChatInput("");
//       } catch (err) {
//         console.error("Error sending message:", err);
//         setChatError(`Failed to send message: ${err.response?.data?.details || err.message}`);
//         setHasResponse(false);
//         setHasAiResponse(false);
//         setForceSidebarCollapsed(false);
//       } finally {
//         setLoadingChat(false);
//       }
//     }
//   };

//   // Handle selecting a chat
//   const handleSelectChat = (chat) => {
//     if (animationFrameRef.current) {
//       cancelAnimationFrame(animationFrameRef.current);
//       animationFrameRef.current = null;
//     }
//     setSelectedMessageId(chat.id);
//     const responseText = chat.response || chat.answer || chat.message || "";
//     setAnimatedResponseContent(responseText);
//     setIsAnimatingResponse(false);
//     setIsGenerating(false);
//     setHasResponse(true);
//     setHasAiResponse(true);
//     setForceSidebarCollapsed(true);
//   };

//   // Handle new chat
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
//     if (secrets.length > 0) {
//       setActiveDropdown(secrets[0].name);
//       setSelectedSecretId(secrets[0].id);
//       setSelectedLlmName(secrets[0].llm_name);
//       setIsSecretPromptSelected(true);
//     } else {
//       setActiveDropdown("Custom Query");
//       setIsSecretPromptSelected(false);
//     }
//   };

//   // Handle dropdown selection
//   const handleDropdownSelect = (secretName, secretId, llmName) => {
//     setActiveDropdown(secretName);
//     setSelectedSecretId(secretId);
//     setSelectedLlmName(llmName);
//     setIsSecretPromptSelected(true);
//     setChatInput("");
//     setShowDropdown(false);
//   };

//   // Handle custom input change
//   const handleChatInputChange = (e) => {
//     setChatInput(e.target.value);
//     if (e.target.value && isSecretPromptSelected) {
//       setIsSecretPromptSelected(false);
//       setActiveDropdown("Custom Query");
//       setSelectedSecretId(null);
//       setSelectedLlmName(null);
//     }
//   };

//   // Format relative time
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

//   // Format date for display
//   const formatDate = (dateString) => {
//     try {
//       return new Date(dateString).toLocaleString();
//     } catch {
//       return "Invalid date";
//     }
//   };

//   // Close dropdown when clicking outside
//   useEffect(() => {
//     const handleClickOutside = (event) => {
//       if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
//         setShowDropdown(false);
//       }
//     };
//     document.addEventListener("mousedown", handleClickOutside);
//     return () => document.removeEventListener("mousedown", handleClickOutside);
//   }, []);

//   // Load secrets on mount
//   useEffect(() => {
//     fetchSecrets();
//   }, []);

//   // Reset state when folder changes
//   useEffect(() => {
//     if (animationFrameRef.current) {
//       cancelAnimationFrame(animationFrameRef.current);
//       animationFrameRef.current = null;
//     }
//     setChatSessions([]);
//     setCurrentChatHistory([]);
//     setSelectedChatSessionId(null);
//     setHasResponse(false);
//     setHasAiResponse(false);
//     setForceSidebarCollapsed(false);
//     setAnimatedResponseContent("");
//     setSelectedMessageId(null);
//     setIsAnimatingResponse(false);
//     if (selectedFolder && selectedFolder !== "Test") {
//       fetchChatHistory();
//     }
//   }, [selectedFolder]);

//   if (!selectedFolder) {
//     return (
//       <div className="flex items-center justify-center h-full text-gray-400 text-lg bg-[#FDFCFB]">
//         Select a folder to start chatting.
//       </div>
//     );
//   }

//   return (
//     <div className="flex h-screen bg-white">
//       {/* Left Panel - Chat History */}
//       <div className={`${hasResponse ? "w-[40%]" : "w-full"} border-r border-gray-200 flex flex-col bg-white h-full transition-all duration-300 overflow-hidden`}>
//         {/* Header */}
//         <div className="p-4 border-b border-black border-opacity-20 flex-shrink-0">
//           <div className="flex items-center justify-between mb-4">
//             <h2 className="text-lg font-semibold text-gray-900">Questions</h2>
//             <button
//               onClick={handleNewChat}
//               className="px-3 py-1.5 text-sm font-medium text-white bg-[#21C1B6] hover:bg-[#1AA49B] rounded-md transition-colors"
//             >
//               New Chat
//             </button>
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
//         {/* Chat History List */}
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
//                   className={`p-3 rounded-lg border cursor-pointer transition-all duration-200 hover:shadow-md ${
//                     selectedMessageId === chat.id
//                       ? "bg-blue-50 border-blue-200 shadow-sm"
//                       : "bg-white border-gray-200 hover:bg-gray-50"
//                   }`}
//                 >
//                   <div className="flex items-start justify-between">
//                     <div className="flex-1 min-w-0">
//                       <p className="text-sm font-medium text-gray-900 mb-1 line-clamp-2">
//                         {chat.question || chat.query || "Untitled"}
//                       </p>
//                       <p className="text-xs text-gray-500">{getRelativeTime(chat.created_at || chat.timestamp)}</p>
//                     </div>
//                     <button
//                       onClick={(e) => e.stopPropagation()}
//                       className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
//                     >
//                       <MoreVertical className="h-5 w-5 text-gray-400" />
//                     </button>
//                   </div>
//                 </div>
//               ))}
//             </div>
//           )}
//         </div>
//         {/* Input Area */}
//         <div className="border-t border-gray-200 p-2 bg-white flex-shrink-0">
//           <div className="bg-white rounded-xl shadow-sm border border-[#21C1B6] p-3">
//             <input
//               type="text"
//               placeholder={isSecretPromptSelected ? `Analysis: ${activeDropdown}` : "How can I help you today?"}
//               value={chatInput}
//               onChange={handleChatInputChange}
//               onKeyPress={(e) => e.key === "Enter" && !e.shiftKey && handleNewMessage()}
//               className="w-full text-base text-gray-700 placeholder-gray-400 outline-none bg-transparent focus:ring-2 focus:ring-[#21C1B6] border-[#21C1B6]"
//               disabled={loadingChat}
//             />
//             <div className="flex items-center justify-between mt-2">
//               <div className="relative" ref={dropdownRef}>
//                 <button
//                   onClick={() => setShowDropdown(!showDropdown)}
//                   disabled={isLoadingSecrets || loadingChat}
//                   className="flex items-center space-x-2 px-4 py-2.5 bg-[#21C1B6] text-white rounded-lg hover:bg-[#1AA49B] transition-colors disabled:opacity-50"
//                 >
//                   <BookOpen className="h-4 w-4" />
//                   <span className="text-sm font-medium">{isLoadingSecrets ? "Loading..." : activeDropdown}</span>
//                   <ChevronDown className="h-4 w-4" />
//                 </button>
//                 {showDropdown && !isLoadingSecrets && (
//                   <div className="absolute bottom-full left-0 mb-2 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto scrollbar-custom">
//                     {secrets.length > 0 ? (
//                       secrets.map((secret) => (
//                         <button
//                           key={secret.id}
//                           onClick={() => handleDropdownSelect(secret.name, secret.id, secret.llm_name)}
//                           className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
//                         >
//                           {secret.name}
//                         </button>
//                       ))
//                     ) : (
//                       <div className="px-4 py-2.5 text-sm text-gray-500">No analysis prompts available</div>
//                     )}
//                   </div>
//                 )}
//               </div>
//               <button
//                 onClick={isGenerating ? handleStopGeneration : handleNewMessage}
//                 disabled={loadingChat || (!chatInput.trim() && !isSecretPromptSelected && !isGenerating)}
//                 className="p-2.5 bg-[#21C1B6] hover:bg-[#1AA49B] disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
//               >
//                 {loadingChat && !isGenerating ? (
//                   <Loader2 className="h-5 w-5 text-white animate-spin" />
//                 ) : isGenerating ? (
//                   <div className="h-5 w-5 text-white flex items-center justify-center">
//                     <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-sm"></div>
//                   </div>
//                 ) : (
//                   <Send className="h-5 w-5 text-white" />
//                 )}
//               </button>
//             </div>
//           </div>
//           {chatError && (
//             <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
//               {chatError}
//             </div>
//           )}
//         </div>
//       </div>
//       {/* Right Panel - AI Response */}
//       {hasResponse && (
//         <div className="w-[60%] flex flex-col h-full overflow-hidden">
//           <div className="flex-1 overflow-y-auto scrollbar-custom" ref={responseRef}>
//             {loadingChat && !animatedResponseContent ? (
//               <div className="flex items-center justify-center h-full">
//                 <div className="text-center">
//                   <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-[#21C1B6]" />
//                   <p className="text-gray-600">Generating response...</p>
//                 </div>
//               </div>
//             ) : selectedMessageId && animatedResponseContent ? (
//               <div className="px-6 py-6">
//                 <div className="mb-6 pb-4 border-b border-gray-200">
//                   <div className="flex items-center justify-between">
//                     <h2 className="text-xl font-semibold text-gray-900">AI Response</h2>
//                     <div className="flex items-center gap-2">
//                       <div className="text-sm text-gray-500 mr-2">
//                         {currentChatHistory.find((msg) => msg.id === selectedMessageId)?.timestamp && (
//                           <span>{formatDate(currentChatHistory.find((msg) => msg.id === selectedMessageId).timestamp)}</span>
//                         )}
//                       </div>
//                       <DownloadPdf markdownOutputRef={markdownOutputRef} />
//                       <button
//                         onClick={handleCopyResponse}
//                         className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
//                         title="Copy to clipboard"
//                       >
//                         {copySuccess ? (
//                           <Check className="h-4 w-4 text-green-600" />
//                         ) : (
//                           <Copy className="h-4 w-4" />
//                         )}
//                       </button>
//                     </div>
//                   </div>
//                   <div className="mt-3 p-3 bg-blue-50 rounded-lg border-l-4 border-[#21C1B6]">
//                     <p className="text-sm font-medium text-blue-900 mb-1">Question:</p>
//                     <p className="text-sm text-blue-800">
//                       {currentChatHistory.find((msg) => msg.id === selectedMessageId)?.question || "No question available"}
//                     </p>
//                   </div>
//                 </div>
//                 <div className="prose prose-gray max-w-none analysis-page-ai-response response-content" ref={markdownOutputRef}>
//                   <ReactMarkdown
//                     remarkPlugins={[remarkGfm]}
//                     components={{
//                       h1: ({ ...props }) => <h1 {...props} />,
//                       h2: ({ ...props }) => <h2 {...props} />,
//                       h3: ({ ...props }) => <h3 {...props} />,
//                       p: ({ ...props }) => <p {...props} />,
//                       strong: ({ ...props }) => <strong {...props} />,
//                       ul: ({ ...props }) => <ul {...props} />,
//                       ol: ({ ...props }) => <ol {...props} />,
//                       li: ({ ...props }) => <li {...props} />,
//                       blockquote: ({ ...props }) => <blockquote {...props} />,
//                       code: ({ inline, ...props }) => <code {...props} />,
//                       table: ({ ...props }) => (
//                         <div className="analysis-table-wrapper">
//                           <table className="analysis-table" {...props} />
//                         </div>
//                       ),
//                       thead: ({ ...props }) => <thead {...props} />,
//                       th: ({ ...props }) => <th {...props} />,
//                       td: ({ ...props }) => <td {...props} />,
//                     }}
//                   >
//                     {animatedResponseContent}
//                   </ReactMarkdown>
//                   {isAnimatingResponse && <span className="inline-block w-2 h-5 bg-gray-400 animate-pulse ml-1"></span>}
//                 </div>
//               </div>
//             ) : (
//               <div className="flex items-center justify-center h-full">
//                 <div className="text-center max-w-md px-6">
//                   <MessageSquare className="h-16 w-16 mx-auto mb-6 text-gray-300" />
//                   <h3 className="text-2xl font-semibold mb-4 text-gray-900">Select a Question</h3>
//                   <p className="text-gray-600 text-lg leading-relaxed">
//                     Click on any question from the left panel to view the AI response here.
//                   </p>
//                 </div>
//               </div>
//             )}
//           </div>
//         </div>
//       )}
//       <style jsx>{`
//         /* Import Google Fonts */
//         @import url('https://fonts.googleapis.com/css2?family=Crimson+Text:ital,wght@0,400;0,600;0,700;1,400;1,600;1,700&family=Inter:wght@100..900&display=swap');

//         /* Scrollbar styling */
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

//         /* AI Response Text Styling */
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

//         /* Table Styling */
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

//         /* Additional prose styling */
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
//       `}</style>
//     </div>
//   );
// };

// export default ChatInterface;


// import React, { useState, useEffect, useContext, useRef } from "react";
// import { FileManagerContext } from "../../context/FileManagerContext";
// import documentApi from "../../services/documentApi";
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
// } from "lucide-react";
// import ReactMarkdown from "react-markdown";
// import remarkGfm from "remark-gfm";
// import { SidebarContext } from "../../context/SidebarContext";
// import DownloadPdf from "../DownloadPdf/DownloadPdf";
// import "../../styles/ChatInterface.css";

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
//   const responseRef = useRef(null);
//   const dropdownRef = useRef(null);
//   const animationFrameRef = useRef(null);
//   const markdownOutputRef = useRef(null);

//   // API Configuration
//   const API_BASE_URL = "https://gateway-service-120280829617.asia-south1.run.app";
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

//   // Copy to clipboard function
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

//   // Fetch secrets list
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
//       // Always start with "Custom Query" instead of auto-selecting first secret
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

//   // Fetch secret value by ID
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

//   // Fetch chat history
//   const fetchChatHistory = async (sessionId) => {
//     if (!selectedFolder) return;
//     setLoadingChat(true);
//     setChatError(null);
//     try {
//       const data = await documentApi.getFolderChats(selectedFolder);
//       const chats = Array.isArray(data.chats) ? data.chats : [];
//       setCurrentChatHistory(chats);
//       if (sessionId) {
//         setSelectedChatSessionId(sessionId);
//         const selectedChat = chats.find((c) => c.id === sessionId);
//         if (selectedChat) {
//           const responseText = selectedChat.response || selectedChat.answer || selectedChat.message || "";
//           setSelectedMessageId(selectedChat.id);
//           setAnimatedResponseContent(responseText);
//           setHasResponse(true);
//           setHasAiResponse(true);
//           setForceSidebarCollapsed(true);
//         }
//       } else {
//         setHasResponse(false);
//         setHasAiResponse(false);
//         setForceSidebarCollapsed(false);
//       }
//     } catch (err) {
//       console.error("Error fetching chats:", err);
//       setChatError("Failed to fetch chat history.");
//     } finally {
//       setLoadingChat(false);
//     }
//   };

//   // Animate typing effect
//   const animateResponse = (text) => {
//     if (animationFrameRef.current) {
//       cancelAnimationFrame(animationFrameRef.current);
//       animationFrameRef.current = null;
//     }
//     setAnimatedResponseContent("");
//     setIsAnimatingResponse(true);
//     setIsGenerating(true);
//     let i = 0;
//     const charsPerFrame = 3;
//     const animate = () => {
//       if (i < text.length) {
//         const nextChunk = text.slice(i, i + charsPerFrame);
//         setAnimatedResponseContent((prev) => prev + nextChunk);
//         i += charsPerFrame;
//         if (responseRef.current) {
//           responseRef.current.scrollTop = responseRef.current.scrollHeight;
//         }
//         animationFrameRef.current = requestAnimationFrame(animate);
//       } else {
//         setIsAnimatingResponse(false);
//         setIsGenerating(false);
//       }
//     };
//     animationFrameRef.current = requestAnimationFrame(animate);
//   };

//   // Stop response generation
//   const handleStopGeneration = () => {
//     if (animationFrameRef.current) {
//       cancelAnimationFrame(animationFrameRef.current);
//       animationFrameRef.current = null;
//     }
//     setIsAnimatingResponse(false);
//     setIsGenerating(false);
//     setLoadingChat(false);
//   };

//   // Cleanup animation on unmount
//   useEffect(() => {
//     return () => {
//       if (animationFrameRef.current) {
//         cancelAnimationFrame(animationFrameRef.current);
//       }
//     };
//   }, []);

//   // Chat with AI using secret prompt
//   const chatWithAI = async (folder, secretId, currentSessionId) => {
//     try {
//       setLoadingChat(true);
//       setChatError(null);
//       const isContinuingSession = !!currentSessionId && currentChatHistory.length > 0;
//       if (!isContinuingSession) {
//         setHasResponse(true);
//         setHasAiResponse(true);
//         setForceSidebarCollapsed(true);
//       }
//       const selectedSecret = secrets.find((s) => s.id === secretId);
//       if (!selectedSecret) throw new Error("No prompt found for selected analysis type");
//       let promptValue = selectedSecret.value;
//       const promptLabel = selectedSecret.name;
//       if (!promptValue) promptValue = await fetchSecretValue(secretId);
//       if (!promptValue) throw new Error("Secret prompt value is empty.");
//       const response = await documentApi.queryFolderDocuments(folder, promptValue, currentSessionId, {
//         used_secret_prompt: true,
//         prompt_label: promptLabel,
//         secret_id: secretId,
//       });
//       const sessionId = response.sessionId || response.session_id || response.id;
//       if (sessionId) {
//         setSelectedChatSessionId(sessionId);
//       }
//       let history = [];
//       let responseText = "";
//       let messageId = null;
//       if (Array.isArray(response.chatHistory) && response.chatHistory.length > 0) {
//         history = response.chatHistory;
//         const latestMessage = history[history.length - 1];
//         responseText = latestMessage.response || latestMessage.answer || latestMessage.message || "";
//         messageId = latestMessage.id;
//       } else if (Array.isArray(response.chat_history) && response.chat_history.length > 0) {
//         history = response.chat_history;
//         const latestMessage = history[history.length - 1];
//         responseText = latestMessage.response || latestMessage.answer || latestMessage.message || "";
//         messageId = latestMessage.id;
//       } else if (Array.isArray(response.messages) && response.messages.length > 0) {
//         history = response.messages;
//         const latestMessage = history[history.length - 1];
//         responseText = latestMessage.response || latestMessage.answer || latestMessage.message || latestMessage.content || "";
//         messageId = latestMessage.id;
//       } else if (response.response || response.answer || response.message || response.content) {
//         responseText = response.response || response.answer || response.message || response.content;
//         messageId = response.id || Date.now().toString();
//         const newMessage = {
//           id: messageId,
//           question: promptLabel,
//           response: responseText,
//           timestamp: new Date().toISOString(),
//           created_at: new Date().toISOString(),
//           isSecretPrompt: true,
//         };
//         history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
//       }
//       setCurrentChatHistory(history);
//       if (responseText && responseText.trim()) {
//         setSelectedMessageId(messageId);
//         setHasResponse(true);
//         setHasAiResponse(true);
//         setForceSidebarCollapsed(true);
//         animateResponse(responseText);
//       } else {
//         setChatError("Received empty response from server.");
//         setHasResponse(false);
//         setHasAiResponse(false);
//         setForceSidebarCollapsed(false);
//       }
//       return response;
//     } catch (error) {
//       console.error("Chat error:", error);
//       setChatError(`Analysis failed: ${error.message}`);
//       setHasResponse(false);
//       setHasAiResponse(false);
//       setForceSidebarCollapsed(false);
//       throw error;
//     } finally {
//       setLoadingChat(false);
//     }
//   };

//   // Handle new message
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
//       setLoadingChat(true);
//       setChatError(null);
//       const isContinuingSession = !!selectedChatSessionId && currentChatHistory.length > 0;
//       if (!isContinuingSession) {
//         setHasResponse(true);
//         setHasAiResponse(true);
//         setForceSidebarCollapsed(true);
//       }
//       try {
//         const response = await documentApi.queryFolderDocuments(
//           selectedFolder,
//           questionText,
//           selectedChatSessionId,
//           { used_secret_prompt: false }
//         );
//         const sessionId = response.sessionId || response.session_id || response.id;
//         if (sessionId) {
//           setSelectedChatSessionId(sessionId);
//         }
//         let history = [];
//         let responseText = "";
//         let messageId = null;
//         if (Array.isArray(response.chatHistory) && response.chatHistory.length > 0) {
//           history = response.chatHistory;
//           const latestMessage = history[history.length - 1];
//           responseText = latestMessage.response || latestMessage.answer || latestMessage.message || "";
//           messageId = latestMessage.id;
//         } else if (Array.isArray(response.chat_history) && response.chat_history.length > 0) {
//           history = response.chat_history;
//           const latestMessage = history[history.length - 1];
//           responseText = latestMessage.response || latestMessage.answer || latestMessage.message || "";
//           messageId = latestMessage.id;
//         } else if (Array.isArray(response.messages) && response.messages.length > 0) {
//           history = response.messages;
//           const latestMessage = history[history.length - 1];
//           responseText = latestMessage.response || latestMessage.answer || latestMessage.message || latestMessage.content || "";
//           messageId = latestMessage.id;
//         } else if (response.response || response.answer || response.message || response.content) {
//           responseText = response.response || response.answer || response.message || response.content;
//           messageId = response.id || Date.now().toString();
//           const newMessage = {
//             id: messageId,
//             question: questionText,
//             response: responseText,
//             timestamp: new Date().toISOString(),
//             created_at: new Date().toISOString(),
//             isSecretPrompt: false,
//           };
//           history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
//         }
//         setCurrentChatHistory(history);
//         if (responseText && responseText.trim()) {
//           setSelectedMessageId(messageId);
//           setHasResponse(true);
//           setHasAiResponse(true);
//           setForceSidebarCollapsed(true);
//           animateResponse(responseText);
//         } else {
//           setChatError("Received empty response from server.");
//           setHasResponse(false);
//           setHasAiResponse(false);
//           setForceSidebarCollapsed(false);
//         }
//         setChatInput("");
//       } catch (err) {
//         console.error("Error sending message:", err);
//         setChatError(`Failed to send message: ${err.response?.data?.details || err.message}`);
//         setHasResponse(false);
//         setHasAiResponse(false);
//         setForceSidebarCollapsed(false);
//       } finally {
//         setLoadingChat(false);
//       }
//     }
//   };

//   // Handle selecting a chat
//   const handleSelectChat = (chat) => {
//     if (animationFrameRef.current) {
//       cancelAnimationFrame(animationFrameRef.current);
//       animationFrameRef.current = null;
//     }
//     setSelectedMessageId(chat.id);
//     const responseText = chat.response || chat.answer || chat.message || "";
//     setAnimatedResponseContent(responseText);
//     setIsAnimatingResponse(false);
//     setIsGenerating(false);
//     setHasResponse(true);
//     setHasAiResponse(true);
//     setForceSidebarCollapsed(true);
//   };

//   // Handle new chat
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

//   // Handle dropdown selection
//   const handleDropdownSelect = (secretName, secretId, llmName) => {
//     setActiveDropdown(secretName);
//     setSelectedSecretId(secretId);
//     setSelectedLlmName(llmName);
//     setIsSecretPromptSelected(true);
//     setChatInput("");
//     setShowDropdown(false);
//   };

//   // Handle custom input change
//   const handleChatInputChange = (e) => {
//     setChatInput(e.target.value);
//     // When user types in the input box, switch to custom query mode
//     if (e.target.value && isSecretPromptSelected) {
//       setIsSecretPromptSelected(false);
//       setActiveDropdown("Custom Query");
//       setSelectedSecretId(null);
//       setSelectedLlmName(null);
//     }
//     // If input is empty and no secret is selected, show Custom Query
//     if (!e.target.value && !isSecretPromptSelected) {
//       setActiveDropdown("Custom Query");
//     }
//   };

//   // Format relative time
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

//   // Format date for display
//   const formatDate = (dateString) => {
//     try {
//       return new Date(dateString).toLocaleString();
//     } catch {
//       return "Invalid date";
//     }
//   };

//   // Close dropdown when clicking outside
//   useEffect(() => {
//     const handleClickOutside = (event) => {
//       if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
//         setShowDropdown(false);
//       }
//     };
//     document.addEventListener("mousedown", handleClickOutside);
//     return () => document.removeEventListener("mousedown", handleClickOutside);
//   }, []);

//   // Load secrets on mount
//   useEffect(() => {
//     fetchSecrets();
//   }, []);

//   // Reset state when folder changes
//   useEffect(() => {
//     if (animationFrameRef.current) {
//       cancelAnimationFrame(animationFrameRef.current);
//       animationFrameRef.current = null;
//     }
//     setChatSessions([]);
//     setCurrentChatHistory([]);
//     setSelectedChatSessionId(null);
//     setHasResponse(false);
//     setHasAiResponse(false);
//     setForceSidebarCollapsed(false);
//     setAnimatedResponseContent("");
//     setSelectedMessageId(null);
//     setIsAnimatingResponse(false);
//     // Reset to Custom Query when folder changes
//     setActiveDropdown("Custom Query");
//     setSelectedSecretId(null);
//     setSelectedLlmName(null);
//     setIsSecretPromptSelected(false);
//     setChatInput("");
//     if (selectedFolder && selectedFolder !== "Test") {
//       fetchChatHistory();
//     }
//   }, [selectedFolder]);

//   if (!selectedFolder) {
//     return (
//       <div className="flex items-center justify-center h-full text-gray-400 text-lg bg-[#FDFCFB]">
//         Select a folder to start chatting.
//       </div>
//     );
//   }

//   return (
//     <div className="flex h-screen bg-white overflow-hidden">
//       {/* Left Panel - Chat History */}
//       <div className={`${hasResponse ? "w-[40%]" : "w-full"} border-r border-gray-200 flex flex-col bg-white h-full transition-all duration-300 overflow-hidden`}>
//         {/* Header */}
//         <div className="p-4 border-b border-black border-opacity-20 flex-shrink-0">
//           <div className="flex items-center justify-between mb-4">
//             <h2 className="text-lg font-semibold text-gray-900">Questions</h2>
//             <button
//               onClick={handleNewChat}
//               className="px-3 py-1.5 text-sm font-medium text-white bg-[#21C1B6] hover:bg-[#1AA49B] rounded-md transition-colors"
//             >
//               New Chat
//             </button>
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
//         {/* Chat History List */}
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
//                   className={`p-3 rounded-lg border cursor-pointer transition-all duration-200 hover:shadow-md ${
//                     selectedMessageId === chat.id
//                       ? "bg-blue-50 border-blue-200 shadow-sm"
//                       : "bg-white border-gray-200 hover:bg-gray-50"
//                   }`}
//                 >
//                   <div className="flex items-start justify-between">
//                     <div className="flex-1 min-w-0">
//                       <p className="text-sm font-medium text-gray-900 mb-1 line-clamp-2">
//                         {chat.question || chat.query || "Untitled"}
//                       </p>
//                       <p className="text-xs text-gray-500">{getRelativeTime(chat.created_at || chat.timestamp)}</p>
//                     </div>
//                     <button
//                       onClick={(e) => e.stopPropagation()}
//                       className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
//                     >
//                       <MoreVertical className="h-5 w-5 text-gray-400" />
//                     </button>
//                   </div>
//                 </div>
//               ))}
//             </div>
//           )}
//         </div>
//         {/* Input Area */}
//         <div className="border-t border-gray-200 p-2 bg-white flex-shrink-0">
//           <div className="bg-white rounded-xl shadow-sm border border-[#21C1B6] p-3">
//             <input
//               type="text"
//               placeholder={isSecretPromptSelected ? `Analysis: ${activeDropdown}` : "How can I help you today?"}
//               value={chatInput}
//               onChange={handleChatInputChange}
//               onKeyPress={(e) => e.key === "Enter" && !e.shiftKey && handleNewMessage()}
//               className="w-full text-base text-gray-700 placeholder-gray-400 outline-none bg-transparent focus:ring-2 focus:ring-[#21C1B6] border-[#21C1B6]"
//               disabled={loadingChat}
//             />
//             <div className="flex items-center justify-between mt-2">
//               <div className="relative" ref={dropdownRef}>
//                 <button
//                   onClick={() => setShowDropdown(!showDropdown)}
//                   disabled={isLoadingSecrets || loadingChat}
//                   className="flex items-center space-x-2 px-4 py-2.5 bg-[#21C1B6] text-white rounded-lg hover:bg-[#1AA49B] transition-colors disabled:opacity-50"
//                 >
//                   <BookOpen className="h-4 w-4" />
//                   <span className="text-sm font-medium">{isLoadingSecrets ? "Loading..." : activeDropdown}</span>
//                   <ChevronDown className="h-4 w-4" />
//                 </button>
//                 {showDropdown && !isLoadingSecrets && (
//                   <div className="absolute bottom-full left-0 mb-2 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto scrollbar-custom">
//                     {secrets.length > 0 ? (
//                       secrets.map((secret) => (
//                         <button
//                           key={secret.id}
//                           onClick={() => handleDropdownSelect(secret.name, secret.id, secret.llm_name)}
//                           className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
//                         >
//                           {secret.name}
//                         </button>
//                       ))
//                     ) : (
//                       <div className="px-4 py-2.5 text-sm text-gray-500">No analysis prompts available</div>
//                     )}
//                   </div>
//                 )}
//               </div>
//               <button
//                 onClick={isGenerating ? handleStopGeneration : handleNewMessage}
//                 disabled={loadingChat || (!chatInput.trim() && !isSecretPromptSelected && !isGenerating)}
//                 className="p-2.5 bg-[#21C1B6] hover:bg-[#1AA49B] disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
//               >
//                 {loadingChat && !isGenerating ? (
//                   <Loader2 className="h-5 w-5 text-white animate-spin" />
//                 ) : isGenerating ? (
//                   <div className="h-5 w-5 text-white flex items-center justify-center">
//                     <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-sm"></div>
//                   </div>
//                 ) : (
//                   <Send className="h-5 w-5 text-white" />
//                 )}
//               </button>
//             </div>
//           </div>
//           {chatError && (
//             <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
//               {chatError}
//             </div>
//           )}
//         </div>
//       </div>
//       {/* Right Panel - AI Response */}
//       {hasResponse && (
//         <div className="w-[60%] flex flex-col h-full overflow-hidden">
//           <div className="flex-1 overflow-y-auto scrollbar-custom" ref={responseRef}>
//             {loadingChat && !animatedResponseContent ? (
//               <div className="flex items-center justify-center h-full">
//                 <div className="text-center">
//                   <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-[#21C1B6]" />
//                   <p className="text-gray-600">Generating response...</p>
//                 </div>
//               </div>
//             ) : selectedMessageId && animatedResponseContent ? (
//               <div className="px-6 py-6">
//                 <div className="mb-6 pb-4 border-b border-gray-200">
//                   <div className="flex items-center justify-between">
//                     <h2 className="text-xl font-semibold text-gray-900">AI Response</h2>
//                     <div className="flex items-center gap-2">
//                       <div className="text-sm text-gray-500 mr-2">
//                         {currentChatHistory.find((msg) => msg.id === selectedMessageId)?.timestamp && (
//                           <span>{formatDate(currentChatHistory.find((msg) => msg.id === selectedMessageId).timestamp)}</span>
//                         )}
//                       </div>
//                       <DownloadPdf markdownOutputRef={markdownOutputRef} />
//                       <button
//                         onClick={handleCopyResponse}
//                         className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
//                         title="Copy to clipboard"
//                       >
//                         {copySuccess ? (
//                           <Check className="h-4 w-4 text-green-600" />
//                         ) : (
//                           <Copy className="h-4 w-4" />
//                         )}
//                       </button>
//                     </div>
//                   </div>
//                   <div className="mt-3 p-3 bg-blue-50 rounded-lg border-l-4 border-[#21C1B6]">
//                     <p className="text-sm font-medium text-blue-900 mb-1">Question:</p>
//                     <p className="text-sm text-blue-800">
//                       {currentChatHistory.find((msg) => msg.id === selectedMessageId)?.question || "No question available"}
//                     </p>
//                   </div>
//                 </div>
//                 <div className="prose prose-gray max-w-none analysis-page-ai-response response-content" ref={markdownOutputRef}>
//                   <ReactMarkdown
//                     remarkPlugins={[remarkGfm]}
//                     components={{
//                       h1: ({ ...props }) => <h1 {...props} />,
//                       h2: ({ ...props }) => <h2 {...props} />,
//                       h3: ({ ...props }) => <h3 {...props} />,
//                       p: ({ ...props }) => <p {...props} />,
//                       strong: ({ ...props }) => <strong {...props} />,
//                       ul: ({ ...props }) => <ul {...props} />,
//                       ol: ({ ...props }) => <ol {...props} />,
//                       li: ({ ...props }) => <li {...props} />,
//                       blockquote: ({ ...props }) => <blockquote {...props} />,
//                       code: ({ inline, ...props }) => <code {...props} />,
//                       table: ({ ...props }) => (
//                         <div className="analysis-table-wrapper">
//                           <table className="analysis-table" {...props} />
//                         </div>
//                       ),
//                       thead: ({ ...props }) => <thead {...props} />,
//                       th: ({ ...props }) => <th {...props} />,
//                       td: ({ ...props }) => <td {...props} />,
//                     }}
//                   >
//                     {animatedResponseContent}
//                   </ReactMarkdown>
//                   {isAnimatingResponse && <span className="inline-block w-2 h-5 bg-gray-400 animate-pulse ml-1"></span>}
//                 </div>
//               </div>
//             ) : (
//               <div className="flex items-center justify-center h-full">
//                 <div className="text-center max-w-md px-6">
//                   <MessageSquare className="h-16 w-16 mx-auto mb-6 text-gray-300" />
//                   <h3 className="text-2xl font-semibold mb-4 text-gray-900">Select a Question</h3>
//                   <p className="text-gray-600 text-lg leading-relaxed">
//                     Click on any question from the left panel to view the AI response here.
//                   </p>
//                 </div>
//               </div>
//             )}
//           </div>
//         </div>
//       )}
//       <style jsx>{`
//         /* Import Google Fonts */
//         @import url('https://fonts.googleapis.com/css2?family=Crimson+Text:ital,wght@0,400;0,600;0,700;1,400;1,600;1,700&family=Inter:wght@100..900&display=swap');

//         /* Scrollbar styling */
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

//         /* AI Response Text Styling */
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

//         /* Table Styling */
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

//         /* Additional prose styling */
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
//       `}</style>
//     </div>
//   );
// };

// export default ChatInterface;



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
  const [thinkingContent, setThinkingContent] = useState(""); // NEW: Model's thinking process
  const [currentStatus, setCurrentStatus] = useState(null); // NEW: Current status (analyzing, generating, etc.)
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

  // ✅ Format response content - must be at top level (not conditional) to follow Rules of Hooks
  const formattedResponseContent = useMemo(() => {
    const rawResponse = animatedResponseContent || '';
    if (!rawResponse) return '';
    
    // ✅ CRITICAL: Always check if the response is structured JSON
    // This ensures JSON responses are never displayed as raw JSON
    const isStructured = isStructuredJsonResponse(rawResponse);
    
    // Always format structured JSON responses (whether secret prompt or not)
    // This ensures JSON responses are never displayed as raw JSON
    if (isStructured) {
      return renderSecretPromptResponse(rawResponse);
    }
    
    // For non-structured responses, convert any JSON to plain text
    // This catches any JSON that wasn't detected as structured
    return convertJsonToPlainText(rawResponse);
  }, [animatedResponseContent]);

  const shouldShowHorizontalScrollbar = useMemo(() => {
    return isSmallScreen && responseHasTable && needsHorizontalScroll;
  }, [isSmallScreen, responseHasTable, needsHorizontalScroll]);
  const responseRef = useRef(null);
  const dropdownRef = useRef(null);
  const completeResponseRef = useRef(null); // Store complete response for skip animation
  const animationFrameRef = useRef(null);
  const markdownOutputRef = useRef(null);
  const horizontalScrollRef = useRef(null);
  const stickyScrollbarRef = useRef(null);
  const streamBufferRef = useRef('');
  const streamThinkingRef = useRef(''); // NEW: Store thinking content
  const streamUpdateTimeoutRef = useRef(null);
  const streamReaderRef = useRef(null);
  const chatMenuRefs = useRef({});
  const panelStatesSetRef = useRef(false); // Track if panel states have been set for current stream
  const fetchedFoldersRef = useRef(new Set()); // Track which folders we've fetched chats for

  // API Configuration
  const API_BASE_URL = "https://gateway-service-120280829617.asia-south1.run.app";
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

  /**
   * Fetch document URL via Gateway with automatic fallback
   */
  const fetchDocumentUrl = async (fileId, pageNumber = null, token) => {
    // Get gateway URL from environment or use API_BASE_URL
    const GATEWAY_URL = import.meta.env.VITE_APP_GATEWAY_URL || 
                        import.meta.env.REACT_APP_GATEWAY_URL || 
                        API_BASE_URL;
    
    // ✅ Primary endpoint via gateway: /docs/file/:fileId/view?page=X
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
    
    // ✅ Fallback endpoint via gateway: /docs/:fileId/view?page=X
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

  /**
   * Open document at specific page (for modal)
   */
  const openDocumentAtPage = async (fileId, pageNumber, filename, token) => {
    try {
      const documentData = await fetchDocumentUrl(fileId, pageNumber, token);
      
      // Use viewUrlWithPage if available (includes #page=X for PDFs)
      const urlToOpen = documentData.viewUrlWithPage
        || (pageNumber ? `${documentData.viewUrl}#page=${pageNumber}` : documentData.viewUrl)
        || documentData.signedUrl;
      
      if (!urlToOpen) {
        throw new Error('No view URL available in response');
      }
      
      // Open in modal instead of new window
      setDocumentViewer({
        open: true,
        url: urlToOpen,
        filename: filename || documentData.document?.name || 'Document',
        page: pageNumber,
        loading: false
      });
    } catch (error) {
      console.error('[Document] Error opening document:', error);
      // Show error in modal
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

  // Copy to clipboard function
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

  // Skip animation and show complete response immediately
  const skipAnimation = () => {
    console.log('[ChatInterface] skipAnimation called');
    
    // Cancel any ongoing animation
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      clearTimeout(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // Get the complete response - try multiple sources in priority order
    let completeResponse = '';
    
    // Priority 1: Get from completeResponseRef (stored when animation started)
    if (completeResponseRef.current) {
      completeResponse = completeResponseRef.current;
      console.log('[ChatInterface] skipAnimation: Found complete response in ref, length:', completeResponse.length);
    }
    
    // Priority 2: Get from selected message (if response is already saved)
    if (!completeResponse && selectedMessageId) {
      const selectedMessage = currentChatHistory.find(msg => msg.id === selectedMessageId);
      if (selectedMessage) {
        const rawResponse = selectedMessage.response || selectedMessage.answer || selectedMessage.message || "";
        if (rawResponse) {
          // Format the response if needed
          const isStructured = isStructuredJsonResponse(rawResponse);
          completeResponse = isStructured
            ? renderSecretPromptResponse(rawResponse)
            : convertJsonToPlainText(rawResponse);
          console.log('[ChatInterface] skipAnimation: Found response in message, length:', completeResponse.length);
        }
      }
    }
    
    // Priority 3: Get from streamBufferRef (for responses currently being generated)
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
    
    // Priority 4: Use formattedResponseContent (already formatted)
    if (!completeResponse && formattedResponseContent) {
      completeResponse = formattedResponseContent;
      console.log('[ChatInterface] skipAnimation: Using formattedResponseContent, length:', completeResponse.length);
    }
    
    if (completeResponse) {
      // Set the complete response immediately
      setAnimatedResponseContent(completeResponse);
      setIsAnimatingResponse(false);
      setIsGenerating(false);
      completeResponseRef.current = null; // Clear ref after skipping
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

  // Fetch secrets list
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
      // Always start with "Custom Query" instead of auto-selecting first secret
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

  // Fetch secret value by ID
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

  // Fetch chat history - use useCallback to ensure it always has latest selectedFolder
  const fetchChatHistory = useCallback(async (sessionId, folderName = null) => {
    // Use provided folderName or fall back to selectedFolder from context
    // ✅ Ensure we extract string from selectedFolder if it's an object
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
      
      // Ensure all messages have used_chunk_ids, citations, and chunk_details (even if empty array/null)
      // ✅ Also ensure prompt_label is preserved and used as question if question is missing
      // ✅ Map answer to response for consistency
      const chatsWithChunks = chats.map(chat => ({
        ...chat,
        // Map answer to response for consistency (backend returns 'answer', frontend uses 'response')
        response: chat.response || chat.answer || chat.message || "",
        answer: chat.answer || chat.response || chat.message || "", // Keep both for compatibility
        used_chunk_ids: chat.used_chunk_ids || [],
        citations: chat.citations || null,
        chunk_details: chat.chunk_details || null, // Preserve chunk_details from backend
        // ✅ Use prompt_label as question if question is missing (for secret prompts)
        question: chat.question || chat.prompt_label || chat.promptLabel || chat.query || "Untitled",
        prompt_label: chat.prompt_label || chat.promptLabel || null
      }));
      console.log('[ChatInterface] fetchChatHistory: Setting currentChatHistory with', chatsWithChunks.length, 'chats');
      // ✅ Use functional update to ensure we don't lose state during refresh
      setCurrentChatHistory(prev => {
        // If we have new chats, use them; otherwise keep previous (prevents flash on refresh)
        if (chatsWithChunks.length > 0) {
          return chatsWithChunks;
        }
        return prev.length > 0 ? prev : chatsWithChunks; // Only clear if truly empty
      });
      
      if (sessionId) {
        setSelectedChatSessionId(sessionId);
        const selectedChat = chatsWithChunks.find((c) => c.id === sessionId);
        if (selectedChat) {
          const responseText = selectedChat.response || selectedChat.answer || selectedChat.message || "";
          setSelectedMessageId(selectedChat.id);
          // ✅ Convert JSON to formatted document before displaying saved responses
          const isStructured = isStructuredJsonResponse(responseText);
          const formattedResponse = isStructured
            ? renderSecretPromptResponse(responseText)
            : convertJsonToPlainText(responseText);
          // Set content directly without animation for restored messages
          setAnimatedResponseContent(formattedResponse);
          setIsAnimatingResponse(false);
          setIsGenerating(false);
          setHasResponse(true);
          setHasAiResponse(true);
          setForceSidebarCollapsed(true);
          console.log('[ChatInterface] Selected chat has used_chunk_ids:', selectedChat.used_chunk_ids);
          console.log('[ChatInterface] Selected chat has citations:', selectedChat.citations);
          // Clear citations state to trigger fresh fetch via useEffect
          setCitations([]);
          setShowCitations(false);
          // Citations will be fetched automatically by the useEffect when selectedMessageId changes
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
  }, [selectedFolder]); // Include selectedFolder in dependencies

  // Fetch citations when message is selected
  useEffect(() => {
    const fetchCitations = async () => {
      // ✅ Ensure selectedFolder is a string, not an object
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
      
      // Priority 1: Check if chunk_details are available in the message (from backend response)
      if (message.chunk_details && Array.isArray(message.chunk_details) && message.chunk_details.length > 0) {
        console.log('[Citations] Using chunk_details from message:', message.chunk_details);
        const formattedCitations = message.chunk_details.map((chunk) => {
          const page = chunk.page || null;
          const pageLabel = chunk.page_label || (page ? `Page ${page}` : null);
          const filename = chunk.filename || 'document.pdf';
          const fileId = chunk.file_id || chunk.fileId;
          const text = chunk.content_preview || chunk.content || chunk.text || '';

          // Format source
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

      // Priority 2: Check if citations are already in the message (from metadata)
      if (message.citations && Array.isArray(message.citations) && message.citations.length > 0) {
        console.log('[Citations] Using citations from message metadata:', message.citations);
        const formattedCitations = message.citations.map((citation) => {
          const pageStart = citation.page_start || citation.pageStart;
          const pageEnd = citation.page_end || citation.pageEnd;
          const page = citation.page || pageStart;
          
          // Format page label
          let pageLabel = null;
          if (pageStart && pageEnd && pageStart !== pageEnd) {
            pageLabel = `Pages ${pageStart}-${pageEnd}`;
          } else if (page || pageStart) {
            pageLabel = `Page ${page || pageStart}`;
          }

          // Format source
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
      
      // Fallback: fetch chunks using used_chunk_ids
      if (!message.used_chunk_ids || message.used_chunk_ids.length === 0) {
        console.log('[Citations] No used_chunk_ids or citations in message:', message.used_chunk_ids);
        setCitations([]);
        setShowCitations(false);
        return;
      }

      console.log('[Citations] Fetching chunks for:', message.used_chunk_ids);
      setLoadingCitations(true);
      try {
        // For folder-based chat, use folder-based endpoint
        // getFolderChunkDetails already handles response format
        // ✅ Ensure selectedFolder is a string
        const folderName = typeof selectedFolder === 'string' ? selectedFolder : (selectedFolder?.originalname || selectedFolder?.name || null);
        if (!folderName) {
          console.error('[Citations] Invalid folder name:', selectedFolder);
          setCitations([]);
          setLoadingCitations(false);
          return;
        }
        const chunkDetails = await apiService.getFolderChunkDetails(message.used_chunk_ids, folderName);
        console.log('[Citations] Received chunk details:', chunkDetails);
        
        // Transform chunk details to citation format
        const formattedCitations = chunkDetails.map((chunk) => {
          // Parse page_range (e.g., "Page 5" or "Pages 5-7")
          let pageLabel = chunk.page_range || null;
          let page = null;
          let pageStart = null;
          let pageEnd = null;
          
          if (pageLabel) {
            // Extract page numbers from page_range
            const pageMatch = pageLabel.match(/(?:Pages? )?(\d+)(?:-(\d+))?/i);
            if (pageMatch) {
              pageStart = parseInt(pageMatch[1]);
              pageEnd = pageMatch[2] ? parseInt(pageMatch[2]) : pageStart;
              page = pageStart;
              
              // Format page label consistently
              if (pageStart === pageEnd) {
                pageLabel = `Page ${pageStart}`;
              } else {
                pageLabel = `Pages ${pageStart}-${pageEnd}`;
              }
            }
          }

          // Format source
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

  // Animate typing effect - ChatGPT-style word-by-word animation
  const animateResponse = (text, skipAnimation = false, isAlreadyFormatted = false) => {
    // ✅ Convert JSON to plain text only if not already formatted
    const plainText = isAlreadyFormatted ? text : convertJsonToPlainText(text);
    
    // Store complete response for skip animation
    completeResponseRef.current = plainText;
    
    // Handle empty or invalid responses
    if (!plainText || typeof plainText !== 'string') {
      setIsAnimatingResponse(false);
      setIsGenerating(false);
      setAnimatedResponseContent(plainText || '');
      completeResponseRef.current = null;
      return;
    }

    // Cancel any existing animation
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      clearTimeout(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // If content is already displayed and matches, skip animation to prevent blinking
    // Check with trim to handle whitespace differences, and check if new text extends current content
    const contentMatches = animatedResponseContent.trim() === plainText.trim() || 
                          animatedResponseContent === plainText ||
                          (animatedResponseContent.length > 0 && plainText.startsWith(animatedResponseContent));
    
    if (contentMatches && !skipAnimation) {
      setIsAnimatingResponse(false);
      setIsGenerating(false);
      // Ensure exact match without clearing (prevents blink)
      if (animatedResponseContent !== plainText) {
        setAnimatedResponseContent(plainText);
      }
      return;
    }

    // Only clear if we're going to animate and content is significantly different
    // Don't clear if the new text just extends the current content (streaming case)
    if (!skipAnimation && !plainText.startsWith(animatedResponseContent) && animatedResponseContent !== plainText) {
      setAnimatedResponseContent("");
    }
    setIsAnimatingResponse(!skipAnimation);
    setIsGenerating(!skipAnimation);

    // Split text into words while preserving spaces and newlines
    const words = plainText.split(/(\s+)/);
    let currentIndex = 0;
    let displayedText = '';

    // If response is very short, show it immediately
    if (words.length <= 3) {
      setIsAnimatingResponse(false);
      setIsGenerating(false);
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
        setIsGenerating(false);
        completeResponseRef.current = null; // Clear ref when animation completes
        setAnimatedResponseContent(plainText);
        animationFrameRef.current = null;
      }
    };

    // Start animation with a small initial delay for smoother start
    animationFrameRef.current = setTimeout(animateWord, 20);
  };

  // Stop response generation
  const handleStopGeneration = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      clearTimeout(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    // Show full response immediately when stopped
    if (streamBufferRef.current) {
      // ✅ Convert JSON to formatted document before displaying
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

  // Cleanup animation and streaming on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        clearTimeout(animationFrameRef.current);
      }
      // Cleanup streaming
      if (streamReaderRef.current) {
        streamReaderRef.current.cancel().catch(() => {});
      }
      if (streamUpdateTimeoutRef.current) {
        clearTimeout(streamUpdateTimeoutRef.current);
      }
    };
  }, []);

  // Chat with AI using secret prompt - Streaming version
  const chatWithAI = async (folder, secretId, currentSessionId) => {
    // Clear previous state
    setAnimatedResponseContent('');
    setThinkingContent(''); // Clear thinking
    setCurrentStatus(null); // Clear status
    streamBufferRef.current = '';
    streamThinkingRef.current = ''; // Clear thinking buffer
    setChatError(null);
    setLoadingChat(true);
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
      const isContinuingSession = !!currentSessionId && currentChatHistory.length > 0;
      // Set panel states only once at the start of streaming to prevent blinking
      if (!isContinuingSession && !panelStatesSetRef.current) {
        setHasResponse(true);
        setHasAiResponse(true);
        setForceSidebarCollapsed(true);
        panelStatesSetRef.current = true; // Mark as set
      }
      const selectedSecret = secrets.find((s) => s.id === secretId);
      if (!selectedSecret) throw new Error("No prompt found for selected analysis type");
      const promptLabel = selectedSecret.name;

      const token = getAuthToken();
      // ✅ CORRECT - Send secret_id for secret prompts, not question
      const response = await fetch(`${API_BASE_URL}/docs/${folder}/intelligent-chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          secret_id: secretId, // ✅ Send secret_id instead of question
          session_id: currentSessionId,
          llm_name: 'gemini', // Optional
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
          // Create message with final response
          // ✅ Convert JSON to formatted document before processing
          const isStructured = isStructuredJsonResponse(streamBufferRef.current);
          let finalResponse = isStructured
            ? renderSecretPromptResponse(streamBufferRef.current)
            : convertJsonToPlainText(streamBufferRef.current);
          if (finalMetadata) {
            newSessionId = finalMetadata.session_id || finalMetadata.sessionId || newSessionId;
            messageId = finalMetadata.message_id || finalMetadata.id || messageId;
          }
          
          // Extract used_chunk_ids from metadata or citations
          let usedChunkIds = finalMetadata?.used_chunk_ids || [];
          if (!usedChunkIds.length && finalMetadata?.citations && Array.isArray(finalMetadata.citations)) {
            usedChunkIds = finalMetadata.citations.map(cit => cit.chunk_id || cit.id).filter(Boolean);
          }
          
          const newMessage = {
            id: messageId,
            question: promptLabel, // ✅ Store prompt name as question
            prompt_label: promptLabel, // ✅ Also store as prompt_label for DB consistency
            response: finalResponse, // ✅ Already formatted - save as plain text, not JSON
            timestamp: new Date().toISOString(),
            created_at: new Date().toISOString(),
            isSecretPrompt: true,
            used_secret_prompt: true, // ✅ Mark as secret prompt
            used_chunk_ids: usedChunkIds, // ✅ Include used_chunk_ids
            citations: finalMetadata?.citations || null, // ✅ Include citations for secret prompts
            chunk_details: finalMetadata?.chunk_details || null, // ✅ Include chunk_details for secret prompts
          };
          const history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
          setCurrentChatHistory(history);
          
          if (newSessionId) {
            setSelectedChatSessionId(newSessionId);
          }
          
          if (finalResponse && finalResponse.trim()) {
            setSelectedMessageId(messageId);
            // Don't set panel states again if already set - prevents blinking
            if (!panelStatesSetRef.current) {
              setHasResponse(true);
              setHasAiResponse(true);
              setForceSidebarCollapsed(true);
              panelStatesSetRef.current = true;
            }
            // ✅ Animate the response word-by-word (same as custom queries)
            // finalResponse is already formatted for secret prompts, so pass isAlreadyFormatted=true
            if (finalResponse && finalResponse.trim()) {
              animateResponse(finalResponse, false, true); // isAlreadyFormatted=true for secret prompts
            } else {
              setIsAnimatingResponse(false);
              setIsGenerating(false);
            }
          }
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
            setLoadingChat(false);
            // ✅ Convert JSON to formatted document before processing
            const isStructured = isStructuredJsonResponse(streamBufferRef.current);
            let finalResponse = isStructured
              ? renderSecretPromptResponse(streamBufferRef.current)
              : convertJsonToPlainText(streamBufferRef.current);
            if (finalMetadata) {
              newSessionId = finalMetadata.session_id || finalMetadata.sessionId || newSessionId;
              messageId = finalMetadata.message_id || finalMetadata.id || messageId;
            }
            
            // Extract used_chunk_ids from metadata or citations
            let usedChunkIds = finalMetadata?.used_chunk_ids || [];
            if (!usedChunkIds.length && finalMetadata?.citations && Array.isArray(finalMetadata.citations)) {
              usedChunkIds = finalMetadata.citations.map(cit => cit.chunk_id || cit.id).filter(Boolean);
            }
            
            const newMessage = {
              id: messageId,
              question: promptLabel, // ✅ Store prompt name as question
              prompt_label: promptLabel, // ✅ Also store as prompt_label for DB consistency
              response: finalResponse, // ✅ Already formatted - save as plain text, not JSON
              timestamp: new Date().toISOString(),
              created_at: new Date().toISOString(),
              isSecretPrompt: true,
              used_secret_prompt: true, // ✅ Mark as secret prompt
              used_chunk_ids: usedChunkIds, // ✅ Include used_chunk_ids
              citations: finalMetadata?.citations || null, // ✅ Include citations for secret prompts
              chunk_details: finalMetadata?.chunk_details || null, // ✅ Include chunk_details for secret prompts
            };
            const history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
            setCurrentChatHistory(history);
            
            if (newSessionId) {
              setSelectedChatSessionId(newSessionId);
            }
            
            if (finalResponse && finalResponse.trim()) {
              setSelectedMessageId(messageId);
              // Don't set panel states again if already set - prevents blinking
              if (!panelStatesSetRef.current) {
                setHasResponse(true);
                setHasAiResponse(true);
                setForceSidebarCollapsed(true);
                panelStatesSetRef.current = true;
              }
              // ✅ Animate the response word-by-word (same as custom queries)
              // finalResponse is already formatted for secret prompts, so pass isAlreadyFormatted=true
              if (finalResponse && finalResponse.trim()) {
                animateResponse(finalResponse, false, true); // isAlreadyFormatted=true for secret prompts
              } else {
                setIsAnimatingResponse(false);
                setIsGenerating(false);
              }
            }
            return;
          }

          // Parse JSON data
          try {
            const parsed = JSON.parse(data);
            
            if (parsed.type === 'metadata') {
              // Handle metadata (session_id, method, etc.)
              console.log('Stream metadata:', parsed);
              newSessionId = parsed.session_id || parsed.sessionId || newSessionId;
              messageId = parsed.message_id || parsed.id || messageId;
              // ✅ Store metadata for later use (citations, chunk_details)
              if (!finalMetadata) finalMetadata = {};
              finalMetadata = { ...finalMetadata, ...parsed };
              } else if (parsed.type === 'status') {
                // Handle status updates (analyzing, generating, etc.) - Display prominently
                setCurrentStatus({
                  status: parsed.status,
                  message: parsed.message || parsed.status,
                });
                console.log('Status:', parsed.status, parsed.message);
              } else if (parsed.type === 'thinking') {
              // NEW: Handle thinking/reasoning process - render in real-time
              const thinkingText = parsed.text || '';
              if (thinkingText) {
                streamThinkingRef.current += thinkingText;
                // Update UI immediately for real-time thinking display
                if (streamUpdateTimeoutRef.current) {
                  clearTimeout(streamUpdateTimeoutRef.current);
                }
                streamUpdateTimeoutRef.current = setTimeout(() => {
                  setThinkingContent(streamThinkingRef.current);
                }, 10); // 10ms debounce for smooth rendering
              }
            } else if (parsed.type === 'chunk') {
              // ✅ Like AnalysisPage: Accumulate chunks but DON'T show during streaming
              // Only show complete formatted response after streaming is done
              const chunkText = parsed.text || '';
              if (chunkText) {
                streamBufferRef.current += chunkText;
                // Don't update animatedResponseContent during streaming
                // Wait until streaming is complete (done event) to show formatted content
              }
            } else if (parsed.type === 'done') {
              // Final metadata - stream complete
              finalMetadata = { ...finalMetadata, ...parsed };
              console.log('[ChatInterface] Done metadata (secret prompt):', finalMetadata);
              console.log('[ChatInterface] used_chunk_ids:', finalMetadata?.used_chunk_ids);
              console.log('[ChatInterface] citations:', finalMetadata?.citations);
              console.log('[ChatInterface] chunk_details:', finalMetadata?.chunk_details);
              
              // Extract used_chunk_ids from metadata or citations
              let usedChunkIds = finalMetadata?.used_chunk_ids || [];
              if (!usedChunkIds.length && finalMetadata?.citations && Array.isArray(finalMetadata.citations)) {
                usedChunkIds = finalMetadata.citations.map(cit => cit.chunk_id || cit.id).filter(Boolean);
              }
              
                // ✅ Convert JSON to formatted document before processing
                const isStructured = isStructuredJsonResponse(streamBufferRef.current);
                let finalResponse = isStructured
                  ? renderSecretPromptResponse(streamBufferRef.current)
                  : convertJsonToPlainText(streamBufferRef.current);
                setLoadingChat(false);
                setCurrentStatus(null); // Clear status when done
                // Ensure final thinking and text are displayed
                if (streamThinkingRef.current) {
                  setThinkingContent(streamThinkingRef.current);
                }
                
              // ✅ Always save message to chat history (even without metadata)
              const messageId = finalMetadata?.message_id || finalMetadata?.id || Date.now().toString();
              const newMessage = {
                id: messageId,
                question: questionText, // ✅ Store user's question
                response: finalResponse, // ✅ Already formatted - save as plain text, not JSON
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
              
              // ✅ Set panel states
              if (!panelStatesSetRef.current) {
                setHasResponse(true);
                setHasAiResponse(true);
                setForceSidebarCollapsed(true);
                panelStatesSetRef.current = true;
              }
              
              // ✅ Animate the response word-by-word (same as custom queries)
              // finalResponse is already formatted for custom queries, so pass isAlreadyFormatted=true
              if (finalResponse && finalResponse.trim()) {
                animateResponse(finalResponse, false, true); // isAlreadyFormatted=true since it's already formatted
              } else {
                setIsAnimatingResponse(false);
                setIsGenerating(false);
              }
            } else if (parsed.type === 'error') {
              setChatError(parsed.message || parsed.error);
              setLoadingChat(false);
            }
          } catch (e) {
            // Skip invalid JSON - might be partial data
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

  // Handle new message - Streaming version
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
      
      // Clear previous state
      setAnimatedResponseContent('');
      setThinkingContent(''); // Clear thinking
      streamBufferRef.current = '';
      streamThinkingRef.current = ''; // Clear thinking buffer
      setChatError(null);
      setLoadingChat(true);
      setIsAnimatingResponse(false);
      panelStatesSetRef.current = false; // Reset panel states flag for new stream
      
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

      const isContinuingSession = !!selectedChatSessionId && currentChatHistory.length > 0;
      // Set panel states only once at the start of streaming to prevent blinking
      if (!isContinuingSession && !panelStatesSetRef.current) {
        setHasResponse(true);
        setHasAiResponse(true);
        setForceSidebarCollapsed(true);
        panelStatesSetRef.current = true; // Mark as set
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
            llm_name: 'gemini', // Optional
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
            // Create message with final response
            // ✅ Convert JSON to formatted document before processing
            const isStructured = isStructuredJsonResponse(streamBufferRef.current);
            let finalResponse = isStructured
              ? renderSecretPromptResponse(streamBufferRef.current)
              : convertJsonToPlainText(streamBufferRef.current);
            if (finalMetadata) {
              newSessionId = finalMetadata.session_id || finalMetadata.sessionId || newSessionId;
              messageId = finalMetadata.message_id || finalMetadata.id || messageId;
            }
            
            // Extract used_chunk_ids from metadata or citations
            let usedChunkIds = finalMetadata?.used_chunk_ids || [];
            
            // If citations are provided, try to extract chunk IDs from them
            if (!usedChunkIds.length && finalMetadata?.citations && Array.isArray(finalMetadata.citations)) {
              // Try to extract chunk IDs from citation objects
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
              citations: finalMetadata?.citations || null, // Store citations if available
            };
            const history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
            setCurrentChatHistory(history);
            
            if (newSessionId) {
              setSelectedChatSessionId(newSessionId);
            }
            
            if (finalResponse && finalResponse.trim()) {
              setSelectedMessageId(messageId);
              // Don't set panel states again if already set - prevents blinking
              if (!panelStatesSetRef.current) {
                setHasResponse(true);
                setHasAiResponse(true);
                setForceSidebarCollapsed(true);
                panelStatesSetRef.current = true;
              }
              // Don't animate if content is already displayed from streaming
              const contentMatches = animatedResponseContent.trim() === finalResponse.trim() || 
                                    animatedResponseContent === finalResponse ||
                                    (animatedResponseContent.length > 0 && finalResponse.startsWith(animatedResponseContent));
              
              // ✅ Always animate the response word-by-word (same as custom queries)
              // finalResponse is already formatted, so pass isAlreadyFormatted=true
              if (finalResponse && finalResponse.trim()) {
                animateResponse(finalResponse, false, true); // isAlreadyFormatted=true
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
              setLoadingChat(false);
              // ✅ Convert JSON to formatted document before processing
              const isStructured = isStructuredJsonResponse(streamBufferRef.current);
              let finalResponse = isStructured
                ? renderSecretPromptResponse(streamBufferRef.current)
                : convertJsonToPlainText(streamBufferRef.current);
              if (finalMetadata) {
                newSessionId = finalMetadata.session_id || finalMetadata.sessionId || newSessionId;
                messageId = finalMetadata.message_id || finalMetadata.id || messageId;
              }
              
            // Extract used_chunk_ids from metadata or citations
            let usedChunkIds = finalMetadata?.used_chunk_ids || [];
            
            // If citations are provided, try to extract chunk IDs from them
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
              citations: finalMetadata?.citations || null, // Store citations if available
              chunk_details: finalMetadata?.chunk_details || null, // Store chunk_details from backend
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
                // Animate the complete response word-by-word
                animateResponse(finalResponse);
              }
              setChatInput("");
              return;
            }

            // Parse JSON data
            try {
              const parsed = JSON.parse(data);
              
              if (parsed.type === 'metadata') {
                // Handle metadata (session_id, method, etc.)
                console.log('Stream metadata:', parsed);
                newSessionId = parsed.session_id || parsed.sessionId || newSessionId;
                messageId = parsed.message_id || parsed.id || messageId;
              } else if (parsed.type === 'status') {
                // Handle status updates (analyzing, generating, etc.) - Display prominently
                setCurrentStatus({
                  status: parsed.status,
                  message: parsed.message || parsed.status,
                });
                console.log('Status:', parsed.status, parsed.message);
              } else if (parsed.type === 'chunk') {
                // ✅ Like AnalysisPage: Accumulate chunks but DON'T show during streaming
                // Only show complete formatted response after streaming is done
                const chunkText = parsed.text || '';
                if (chunkText) {
                  streamBufferRef.current += chunkText;
                  // Don't update animatedResponseContent during streaming
                  // Wait until streaming is complete (done event) to show formatted content
                }
              } else if (parsed.type === 'done') {
                // Final metadata - stream complete
                finalMetadata = parsed;
                console.log('[ChatInterface] Final metadata received:', finalMetadata);
                console.log('[ChatInterface] used_chunk_ids:', finalMetadata?.used_chunk_ids);
                console.log('[ChatInterface] citations:', finalMetadata?.citations);
                console.log('[ChatInterface] chunk_details:', finalMetadata?.chunk_details);
                
                // Extract used_chunk_ids from metadata or citations
                let usedChunkIds = finalMetadata?.used_chunk_ids || [];
                
                // If citations are provided, extract chunk IDs from them
                if (!usedChunkIds.length && finalMetadata?.citations && Array.isArray(finalMetadata.citations)) {
                  usedChunkIds = finalMetadata.citations.map(cit => cit.chunk_id || cit.id).filter(Boolean);
                  console.log('[ChatInterface] Extracted chunk IDs from citations:', usedChunkIds);
                }
                
                // If still no chunk IDs, try to extract from citations array directly
                if (!usedChunkIds.length && finalMetadata?.citations) {
                  const citations = Array.isArray(finalMetadata.citations) 
                    ? finalMetadata.citations 
                    : Object.values(finalMetadata.citations || {});
                  usedChunkIds = citations.map(cit => cit.chunk_id || cit.id).filter(Boolean);
                }
                
                // ✅ Convert JSON to formatted document before processing
                const isStructured = isStructuredJsonResponse(streamBufferRef.current);
                let finalResponse = isStructured
                  ? renderSecretPromptResponse(streamBufferRef.current)
                  : convertJsonToPlainText(streamBufferRef.current);
                setLoadingChat(false);
                setCurrentStatus(null); // Clear status when done
                // Ensure final thinking and text are displayed
                if (streamThinkingRef.current) {
                  setThinkingContent(streamThinkingRef.current);
                }
                
                // Create message with used_chunk_ids, citations, and chunk_details
                const newMessage = {
                  id: finalMetadata.message_id || finalMetadata.id || messageId,
                  question: questionText,
                  response: finalResponse,
                  timestamp: new Date().toISOString(),
                  created_at: new Date().toISOString(),
                  isSecretPrompt: false,
                  used_chunk_ids: usedChunkIds,
                  citations: finalMetadata?.citations || null, // Store citations if available
                  chunk_details: finalMetadata?.chunk_details || null, // Store chunk_details from backend
                };
                const history = isContinuingSession ? [...currentChatHistory, newMessage] : [newMessage];
                setCurrentChatHistory(history);
                setSelectedMessageId(newMessage.id);
                
                // ✅ Animate the response word-by-word (same as custom queries)
                // finalResponse is already formatted, so pass isAlreadyFormatted=true
                if (finalResponse && finalResponse.trim()) {
                  animateResponse(finalResponse, false, true); // isAlreadyFormatted=true
                } else {
                  setIsAnimatingResponse(false);
                  setIsGenerating(false);
                }
              } else if (parsed.type === 'error') {
                setChatError(parsed.message || parsed.error);
                setLoadingChat(false);
              }
            } catch (e) {
              // Skip invalid JSON - might be partial data
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

  // Handle selecting a chat
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
    // ✅ Convert JSON to formatted document before displaying saved responses
    const isStructured = isStructuredJsonResponse(responseText);
    const formattedResponse = isStructured
      ? renderSecretPromptResponse(responseText)
      : convertJsonToPlainText(responseText);
    // Set content directly without animation for history messages
    // Batch all state updates together to prevent blinking
    startTransition(() => {
      setSelectedMessageId(chat.id); // ✅ Set selectedMessageId first to trigger citation fetch
      setAnimatedResponseContent(formattedResponse);
      setIsAnimatingResponse(false);
      setIsGenerating(false);
      setHasResponse(true);
      setHasAiResponse(true);
      setForceSidebarCollapsed(true);
    });
    // Citations will be fetched automatically by useEffect when selectedMessageId changes
    // Clear any previous citations state to trigger fresh fetch
    setCitations([]);
    setShowCitations(false);
    setLoadingCitations(true); // Show loading state while fetching citations
  };

  // Handle delete single chat
  const handleDeleteChat = async (chatId, e) => {
    if (e) {
      e.stopPropagation(); // Prevent triggering the onClick for the chat card
    }
    
    setOpenChatMenuId(null); // Close the menu
    
    // ✅ Extract folder name from selectedFolder (handle both string and object)
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
      
      // Remove the chat from the current history
      setCurrentChatHistory(prev => prev.filter(chat => chat.id !== chatId));
      
      // If the deleted chat was selected, clear the selection
      if (selectedMessageId === chatId) {
        setSelectedMessageId(null);
        setAnimatedResponseContent("");
        setHasResponse(false);
        setHasAiResponse(false);
        setForceSidebarCollapsed(false);
      }
      
      // Refresh the chat list
      if (folderName) {
        await fetchChatHistory(null, folderName);
      }
    } catch (err) {
      console.error("❌ Error deleting chat:", err);
      const errorMessage = err?.response?.data?.error || err?.message || 'Failed to delete chat';
      setChatError(errorMessage);
      // Error is handled by toast.promise
    } finally {
      setLoadingChat(false);
    }
  };

  // Handle chat menu toggle
  const handleChatMenuToggle = (chatId, e) => {
    if (e) {
      e.stopPropagation(); // Prevent triggering the onClick for the chat card
    }
    setOpenChatMenuId(openChatMenuId === chatId ? null : chatId);
  };

  // Handle new chat
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

  // Handle delete all chats
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
      
      // Clear the chat history and reset state
      setCurrentChatHistory([]);
      setSelectedChatSessionId(null);
      setHasResponse(false);
      setHasAiResponse(false);
      setForceSidebarCollapsed(false);
      setSelectedMessageId(null);
      setAnimatedResponseContent("");
      setIsAnimatingResponse(false);
      setIsGenerating(false);
      
      // Optionally refresh the chat list
      const folderName = typeof selectedFolder === 'string' ? selectedFolder : (selectedFolder?.originalname || selectedFolder?.name || null);
      if (folderName) {
        await fetchChatHistory(null, folderName);
      }
    } catch (err) {
      console.error("❌ Error deleting all chats:", err);
      const errorMessage = err?.response?.data?.error || err?.message || 'Failed to delete all chats';
      setChatError(errorMessage);
      // Error is handled by toast.promise
    } finally {
      setLoadingChat(false);
    }
  };

  // Handle dropdown selection
  const handleDropdownSelect = (secretName, secretId, llmName) => {
    setActiveDropdown(secretName);
    setSelectedSecretId(secretId);
    setSelectedLlmName(llmName);
    setIsSecretPromptSelected(true);
    setChatInput("");
    setShowDropdown(false);
  };

  // Handle custom input change
  const handleChatInputChange = (e) => {
    setChatInput(e.target.value);
    // When user types in the input box, switch to custom query mode
    if (e.target.value && isSecretPromptSelected) {
      setIsSecretPromptSelected(false);
      setActiveDropdown("Custom Query");
      setSelectedSecretId(null);
      setSelectedLlmName(null);
    }
    // If input is empty and no secret is selected, show Custom Query
    if (!e.target.value && !isSecretPromptSelected) {
      setActiveDropdown("Custom Query");
    }
  };

  // Format relative time
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

  // Format date for display
  const formatDate = (dateString) => {
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return "Invalid date";
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Close chat menu when clicking outside
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

  // Load secrets on mount
  useEffect(() => {
    fetchSecrets();
  }, []);

  // Reset state when folder changes and load chats
  useEffect(() => {
    console.log('[ChatInterface] useEffect triggered, selectedFolder:', selectedFolder);
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    // ✅ Don't clear currentChatHistory immediately - let fetchChatHistory handle it
    // This prevents flash of empty state on page refresh
    setChatSessions([]);
    setSelectedChatSessionId(null);
    setHasResponse(false);
    setHasAiResponse(false);
    setForceSidebarCollapsed(false);
    setAnimatedResponseContent("");
    setSelectedMessageId(null);
    setIsAnimatingResponse(false);
    // Reset to Custom Query when folder changes
    setActiveDropdown("Custom Query");
    setSelectedSecretId(null);
    setSelectedLlmName(null);
    setIsSecretPromptSelected(false);
    setChatInput("");
    
    // ✅ Always fetch chats when folder changes (including on mount and page refresh)
    // ✅ Include "Test" folder - no longer excluding it
    const folderName = typeof selectedFolder === 'string' ? selectedFolder : (selectedFolder?.originalname || selectedFolder?.name || null);
    if (folderName) {
      const folderKey = `${folderName}`;
      // Always fetch when folder changes (clear the ref entry for this folder first)
      fetchedFoldersRef.current.delete(folderKey);
      console.log('[ChatInterface] Calling fetchChatHistory for folder:', folderName);
      fetchedFoldersRef.current.add(folderKey);
      // Fetch immediately - pass folderName explicitly to avoid closure issues
      fetchChatHistory(null, folderName).then(() => {
        console.log('[ChatInterface] fetchChatHistory completed successfully');
      }).catch(err => {
        console.error('[ChatInterface] Error in fetchChatHistory:', err);
        fetchedFoldersRef.current.delete(folderKey); // Remove on error so we can retry
        setCurrentChatHistory([]);
      });
    } else {
      console.log('[ChatInterface] Skipping fetchChatHistory - folder is:', selectedFolder);
      // Don't clear on mount if folder is not yet set - wait for it to be set
      if (selectedFolder === null || selectedFolder === undefined) {
        console.log('[ChatInterface] selectedFolder is null/undefined - will fetch when folder is set');
      } else {
        // Clear fetched folders when folder changes to invalid value
        fetchedFoldersRef.current.clear();
        setCurrentChatHistory([]);
      }
    }
  }, [selectedFolder, fetchChatHistory]); // Include fetchChatHistory since it's now a useCallback

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
      {/* Left Panel - Chat History */}
      <div
        className={`${hasResponse ? "flex-[0.4]" : "flex-1"} flex flex-col bg-white h-full transition-all duration-300 overflow-hidden rounded-2xl border border-gray-200 shadow-sm min-w-0`}
      >
        {/* Header */}
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
        {/* Chat History List */}
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
        {/* Input Area */}
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
            {/* Analysis Dropdown */}
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
      {/* Right Panel - AI Response */}
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
              {/* Skip Animation Button - Show when animation is in progress */}
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
            {/* Status Display (Gemini-like) - Shows what model is doing */}
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
                {/* Thinking Section (Gemini-like) */}
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
                
                {/* Answer Section */}
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
          
          {/* Sources Button - Outside scrollable area */}
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
                    
                    // Toggle the panel
                    const newShowState = !showCitations;
                    setShowCitations(newShowState);
                    
                    // If opening and no citations, ensure they're being fetched
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

      {/* Sources Panel - Right Sidebar (Overlay on Right Panel) */}
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
              
              // Show loading state immediately
              setDocumentViewer({
                open: true,
                url: null, // Will be set after fetching
                filename: citation.filename || 'Document',
                page: page,
                loading: true
              });
              
              try {
                // ✅ Use the corrected function with automatic fallback
                const token = getAuthToken();
                await openDocumentAtPage(fileId, page, citation.filename, token);
              } catch (error) {
                console.error('[Citations] Error fetching document:', error);
                // Error is already handled in openDocumentAtPage, but ensure modal shows error
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

      {/* Document Viewer Modal */}
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
            {/* Header */}
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

            {/* Document Content */}
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
        /* Import Google Fonts */
        @import url('https://fonts.googleapis.com/css2?family=Crimson+Text:ital,wght@0,400;0,600;0,700;1,400;1,600;1,700&family=Inter:wght@100..900&display=swap');

        /* Scrollbar styling */
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

        /* AI Response Text Styling */
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

        /* Table Styling */
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

        /* Additional prose styling */
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