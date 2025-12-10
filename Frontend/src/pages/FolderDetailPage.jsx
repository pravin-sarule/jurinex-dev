// import React, { useState, useEffect, useContext } from 'react';
// import { useParams, useNavigate } from 'react-router-dom';
// import { FileManagerContext } from '../context/FileManagerContext';
// import { ArrowLeft, Plus, Star, MoreVertical, ChevronDown } from 'lucide-react';
// import ChatInput from '../components/ChatInterface/ChatInput';
// import FolderContent from '../components/FolderContent/FolderContent';
// import DocumentPreviewModal from '../components/DocumentPreviewModal';
// import { documentApi } from '../services/documentApi';
// import ChatMessage from '../components/ChatInterface/ChatMessage';

// const FolderDetailPage = () => {
//   const { folderName } = useParams();
//   const navigate = useNavigate();
//   const {
//     setSelectedFolder,
//     selectedFolder,
//     loadFoldersAndFiles,
//     chatSessions,
//     setChatSessions,
//     selectedChatSessionId,
//     setSelectedChatSessionId,
//   } = useContext(FileManagerContext);

//   const [selectedDocument, setSelectedDocument] = useState(null);
//   const [currentChatHistory, setCurrentChatHistory] = useState([]);
//   const [loadingChat, setLoadingChat] = useState(false);
//   const [chatError, setChatError] = useState(null);
//   const [isStarred, setIsStarred] = useState(false);
//   const [showMoreMenu, setShowMoreMenu] = useState(false);

//   useEffect(() => {
//     if (folderName) {
//       setSelectedFolder(folderName);
//     }
//   }, [folderName, setSelectedFolder]);

//   useEffect(() => {
//     loadFoldersAndFiles();
//   }, [loadFoldersAndFiles]);

//   // Fetch chat sessions
//   useEffect(() => {
//     const fetchChatSessions = async () => {
//       if (!selectedFolder) {
//         setChatSessions([]);
//         return;
//       }
//       try {
//         const data = await documentApi.getFolderChatSessions(selectedFolder);
//         setChatSessions(data.sessions);
//       } catch (err) {
//         console.error('Error fetching chat sessions:', err);
//       }
//     };
//     fetchChatSessions();
//     setCurrentChatHistory([]);
//     setSelectedChatSessionId(null);
//   }, [selectedFolder, setChatSessions, setSelectedChatSessionId]);

//   // Fetch chat history
//   useEffect(() => {
//     const fetchChatHistory = async () => {
//       if (!selectedFolder || !selectedChatSessionId) {
//         setCurrentChatHistory([]);
//         return;
//       }
//       setLoadingChat(true);
//       setChatError(null);
//       try {
//         const data = await documentApi.getFolderChatSessionById(
//           selectedFolder,
//           selectedChatSessionId
//         );
//         setCurrentChatHistory(data.chatHistory);
//       } catch (err) {
//         setChatError('Failed to fetch chat history.');
//         console.error('Error fetching chat history:', err);
//       } finally {
//         setLoadingChat(false);
//       }
//     };
//     fetchChatHistory();
//   }, [selectedFolder, selectedChatSessionId]);

//   const handleSendMessage = async (message) => {
//     setLoadingChat(true);
//     setChatError(null);

//     if (!selectedFolder) {
//       alert('Please select a folder first.');
//       setLoadingChat(false);
//       return;
//     }

//     try {
//       let response;
//       if (selectedChatSessionId) {
//         response = await documentApi.continueFolderChat(
//           selectedFolder,
//           selectedChatSessionId,
//           message
//         );
//       } else {
//         response = await documentApi.queryFolderDocuments(selectedFolder, message);
//         setSelectedChatSessionId(response.sessionId);
//       }
//       setCurrentChatHistory(response.chatHistory);

//       // Refresh sessions
//       const data = await documentApi.getFolderChatSessions(selectedFolder);
//       setChatSessions(data.sessions);
//     } catch (err) {
//       setChatError(`Failed to send message: ${err.response?.data?.details || err.message}`);
//     } finally {
//       setLoadingChat(false);
//     }
//   };

//   const handleDocumentClick = (document) => {
//     setSelectedDocument(document);
//   };

//   const handleClosePreview = () => {
//     setSelectedDocument(null);
//   };

//   const handleToggleStar = () => {
//     setIsStarred((prev) => !prev);
//     // TODO: Call API to save star state if needed
//   };

//   const handleNewChat = () => {
//     setSelectedChatSessionId(null);
//     setCurrentChatHistory([]);
//   };

//   const handleSelectChatSession = (sessionId) => {
//     setSelectedChatSessionId(sessionId);
//   };

//   return (
//     <div className="min-h-screen bg-[#FDFCFB] text-gray-800 p-8">
//       <div className="max-w-7xl mx-auto">
//         {/* Top Navigation */}
//         <div className="mb-8 relative">
//           <button
//             onClick={() => navigate('/documents')}
//             className="flex items-center text-gray-600 hover:text-gray-800 transition-colors duration-200"
//           >
//             <ArrowLeft className="w-5 h-5 mr-2" />
//             <span>All projects</span>
//           </button>

//           {/* More menu */}
//           {showMoreMenu && (
//             <div className="absolute top-8 right-0 bg-white border border-gray-200 rounded-md shadow-lg p-2 z-50">
//               <button
//                 className="block w-full text-left px-4 py-2 hover:bg-gray-100 text-sm"
//                 onClick={() => alert('Rename project')}
//               >
//                 Rename Project
//               </button>
//               <button
//                 className="block w-full text-left px-4 py-2 hover:bg-gray-100 text-sm"
//                 onClick={() => alert('Delete project')}
//               >
//                 Delete Project
//               </button>
//             </div>
//           )}
//         </div>

//         {/* Document Upload Header */}
//         <div className="flex justify-between items-center mb-8">
//           <h1 className="text-3xl font-bold">{selectedFolder || 'Document Upload'}</h1>
//           <div className="flex items-center space-x-4">
//             <button onClick={() => setShowMoreMenu((prev) => !prev)}>
//               <MoreVertical className="w-5 h-5 text-gray-600" />
//             </button>
//             <button onClick={handleToggleStar}>
//               <Star
//                 className={`w-5 h-5 ${isStarred ? 'text-yellow-400 fill-yellow-400' : 'text-gray-400'}`}
//               />
//             </button>
//           </div>
//         </div>

//         {/* Main Content Area */}
//         <div className="flex space-x-8 h-[calc(100vh-120px)]"> {/* Adjusted height to prevent page scroll */}
//           {/* Left Section: Chat Interface */}
//           <div className="flex-1 flex flex-col space-y-4">
//             <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 flex-1 flex flex-col">
//               <p className="text-gray-600 mb-4">How can I help you today?</p>
//               <div className="flex items-center space-x-2 mb-4">
//                 <button
//                   onClick={handleNewChat}
//                   className="p-2 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
//                 >
//                   <Plus className="w-5 h-5 text-gray-600" />
//                 </button>

//                 <select
//                   className="flex-1 px-4 py-2 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors text-gray-700 text-sm"
//                   value={selectedChatSessionId || ''}
//                   onChange={(e) => handleSelectChatSession(e.target.value)}
//                 >
//                   <option value="">📄 {selectedFolder || 'Document Upload'}</option>
//                   {chatSessions.map((session) => (
//                     <option key={session.id} value={session.id}>
//                       💬 {session.name || `Session ${session.id}`}
//                     </option>
//                   ))}
//                 </select>

//                 <span className="ml-auto text-gray-500 text-sm flex items-center space-x-1">
//                   <span>Sonnet 4</span>
//                   <ChevronDown className="w-4 h-4" />
//                 </span>
//               </div>

//               <div className="flex-1 overflow-y-auto mb-4 p-2 bg-gray-50 rounded-md">
//                 {loadingChat ? (
//                   <div>Loading chat history...</div>
//                 ) : chatError ? (
//                   <div className="text-red-500">Error: {chatError}</div>
//                 ) : currentChatHistory.length === 0 ? (
//                   <p className="text-gray-400">
//                     {selectedChatSessionId
//                       ? 'No messages in this session. Start a conversation!'
//                       : 'Select a chat session or start a new query below.'}
//                   </p>
//                 ) : (
//                   currentChatHistory.map((msg, index) => (
//                     <ChatMessage key={index} message={msg} />
//                   ))
//                 )}
//               </div>

//               <ChatInput onSendMessage={handleSendMessage} disabled={!selectedFolder} />
//             </div>

//             <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 text-center text-gray-500">
//               Start a chat to keep conversations organized and re-use project knowledge.
//             </div>
//           </div>

//           {/* Right Section: Instructions and Files */}
//           <div className="w-1/3 flex flex-col space-y-4">
//             {/* Instructions */}
//             <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
//               <div className="flex justify-between items-center mb-4">
//                 <h3 className="text-lg font-semibold">Instructions</h3>
//                 <button onClick={() => alert('Add instructions')}>
//                   <Plus className="w-5 h-5 text-gray-600" />
//                 </button>
//               </div>
//               <p className="text-gray-500 text-sm">Add instructions to tailor Claude's responses</p>
//             </div>

//             {/* Files */}
//             <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 flex-1 flex flex-col">
//               <div className="flex justify-between items-center mb-4">
//                 <h3 className="text-lg font-semibold">Files</h3>
//                 <button onClick={() => alert('Upload new file')}>
//                   <Plus className="w-5 h-5 text-gray-600" />
//                 </button>
//               </div>
//               <div className="flex-1 overflow-y-auto max-h-[calc(100%-60px)]"> {/* Added max-h and overflow-y-auto */}
//                 <FolderContent onDocumentClick={handleDocumentClick} />
//               </div>
//             </div>
//           </div>
//         </div>
//       </div>

//       {selectedDocument && (
//         <DocumentPreviewModal document={selectedDocument} onClose={handleClosePreview} />
//       )}
//     </div>
//   );
// };

// export default FolderDetailPage;


// import React, { useState, useEffect, useContext } from "react";
// import { useParams, useNavigate } from "react-router-dom";
// import { FileManagerContext } from "../context/FileManagerContext";
// import {
//   ArrowLeft,
//   Star,
//   MoreVertical,
// } from "lucide-react";
// import FolderContent from "../components/FolderContent/FolderContent";
// import DocumentPreviewModal from "../components/DocumentPreviewModal";
// import ChatInterface from "../components/ChatInterface/ChatInterface"; // Import ChatInterface

// const FolderDetailPage = () => {
//   const { folderName } = useParams();
//   const navigate = useNavigate();
//   const {
//     setSelectedFolder,
//     selectedFolder,
//     loadFoldersAndFiles,
//     hasAiResponse, // Get hasAiResponse from context
//   } = useContext(FileManagerContext);

//   const [selectedDocument, setSelectedDocument] = useState(null);
//   const [isStarred, setIsStarred] = useState(false);
//   const [showMoreMenu, setShowMoreMenu] = useState(false);

//   useEffect(() => {
//     if (folderName) {
//       setSelectedFolder(folderName);
//     }
//   }, [folderName, setSelectedFolder]);

//   useEffect(() => {
//     loadFoldersAndFiles();
//   }, [loadFoldersAndFiles]);

//   const handleDocumentClick = (doc) => {
//     setSelectedDocument(doc);
//   };

//   const handleClosePreview = () => {
//     setSelectedDocument(null);
//   };

//   const handleToggleStar = () => {
//    setIsStarred((prev) => !prev);
//   };

//   return (
//    <div className="bg-[#FDFCFB] text-gray-800 p-8 h-[calc(100vh - 64px)]">
//      <div className="mx-auto">
//        {/* Top Navigation */}
//        <div className="mb-8 relative">
//          <button
//             onClick={() => navigate("/documents")}
//             className="flex items-center text-gray-600 hover:text-gray-800 transition-colors duration-200"
//           >
//             <ArrowLeft className="w-5 h-5 mr-2" />
//             <span>All projects</span>
//           </button>

//           {/* More menu */}
//           {showMoreMenu && (
//             <div className="absolute top-8 right-0 bg-white border border-gray-200 rounded-md shadow-lg p-2 z-50">
//               <button
//                 className="block w-full text-left px-4 py-2 hover:bg-gray-100 text-sm"
//                 onClick={() => alert("Rename project")}
//               >
//                 Rename Project
//               </button>
//               <button
//                 className="block w-full text-left px-4 py-2 hover:bg-gray-100 text-sm"
//                 onClick={() => alert("Delete project")}
//               >
//                 Delete Project
//               </button>
//             </div>
//           )}
//         </div>

//         {/* Document Upload Header */}
//         <div className="flex justify-between items-center mb-8">
//           <h1 className="text-3xl font-bold">
//             {selectedFolder || "Document Upload"}
//           </h1>
//           <div className="flex items-center space-x-4">
//             <button onClick={() => setShowMoreMenu((prev) => !prev)}>
//               <MoreVertical className="w-5 h-5 text-gray-600" />
//             </button>
//             <button onClick={handleToggleStar}>
//               <Star
//                 className={`w-5 h-5 ${
//                   isStarred ? "text-yellow-400 fill-yellow-400" : "text-gray-400"
//                 }`}
//               />
//             </button>
//           </div>
//         </div>

//         {/* Main Content Area */}
//         <div className={`${!hasAiResponse ? 'flex space-x-8' : ''} h-[calc(100vh - 120px)]`}>
//           {/* Left Section: Chat Interface */}
//           <div className={`${hasAiResponse ? 'w-full' : 'flex-1'} flex flex-col space-y-4`}>
//             <ChatInterface /> {/* Use the ChatInterface component */}
//           </div>

          
//           {!hasAiResponse && (
//             <div className="w-1/3 flex flex-col space-y-4 overflow-y-auto">
//               <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 flex-1 flex-col">
//                 <div className="flex justify-between items-center mb-4">
//                   <h3 className="text-lg font-semibold">Files</h3>
//                   {/* The upload button is now handled within FolderContent */}
//                 </div>

//                 {/* If a document is selected, show preview */}
//                 {selectedDocument ? (
//                   <DocumentPreviewModal
//                     document={selectedDocument}
//                     onClose={handleClosePreview}
//                   />
//                 ) : (
//                   <div className="flex-1 overflow-y-auto">
//                     <FolderContent onDocumentClick={handleDocumentClick} />
//                   </div>
//                 )}
//               </div>
//             </div>
//           )}
//         </div>
//       </div>
//     </div>
//   );
// };

// export default FolderDetailPage;





// import React, { useState, useEffect, useContext } from "react";
// import { useParams, useNavigate } from "react-router-dom";
// import { FileManagerContext } from "../context/FileManagerContext";
// import {
//   ArrowLeft,
//   Star,
//   MoreVertical,
// } from "lucide-react";
// import FolderContent from "../components/FolderContent/FolderContent";
// import DocumentPreviewModal from "../components/DocumentPreviewModal";
// import ChatInterface from "../components/ChatInterface/ChatInterface"; // Import ChatInterface

// const FolderDetailPage = () => {
//   const { folderName } = useParams();
//   const navigate = useNavigate();
//   const {
//     setSelectedFolder,
//     selectedFolder,
//     loadFoldersAndFiles,
//     hasAiResponse, // Get hasAiResponse from context
//   } = useContext(FileManagerContext);

//   const [selectedDocument, setSelectedDocument] = useState(null);
//   const [isStarred, setIsStarred] = useState(false);
//   const [showMoreMenu, setShowMoreMenu] = useState(false);

//   useEffect(() => {
//     if (folderName) {
//       setSelectedFolder(folderName);
//     }
//   }, [folderName, setSelectedFolder]);

//   useEffect(() => {
//     loadFoldersAndFiles();
//   }, [loadFoldersAndFiles]);

//   const handleDocumentClick = (doc) => {
//     setSelectedDocument(doc);
//   };

//   const handleClosePreview = () => {
//     setSelectedDocument(null);
//   };

//   const handleToggleStar = () => {
//     setIsStarred((prev) => !prev);
//   };

//   return (
//     <div className="min-h-screen bg-[#FDFCFB] text-gray-800 p-8" style={{marginLeft: '0px', marginRight: '0px'}}>
//       <div className="mx-auto">
//         {/* Top Navigation */}
//         <div className="mb-8 relative">
//           <button
//             onClick={() => navigate("/documents")}
//             className="flex items-center text-gray-600 hover:text-gray-800 transition-colors duration-200"
//           >
//             <ArrowLeft className="w-5 h-5 mr-2" />
//             <span>All projects</span>
//           </button>

//           {/* More menu */}
//           {showMoreMenu && (
//             <div className="absolute top-8 right-0 bg-white border border-gray-200 rounded-md shadow-lg p-2 z-50">
//               <button
//                 className="block w-full text-left px-4 py-2 hover:bg-gray-100 text-sm"
//                 onClick={() => alert("Rename project")}
//               >
//                 Rename Project
//               </button>
//               <button
//                 className="block w-full text-left px-4 py-2 hover:bg-gray-100 text-sm"
//                 onClick={() => alert("Delete project")}
//               >
//                 Delete Project
//               </button>
//             </div>
//           )}
//         </div>

//         {/* Document Upload Header */}
//         <div className="flex justify-between items-center mb-8">
//           <h1 className="text-3xl font-bold">
//             {selectedFolder || "Document Upload"}
//           </h1>
//           <div className="flex items-center space-x-4">
//             <button onClick={() => setShowMoreMenu((prev) => !prev)}>
//               <MoreVertical className="w-5 h-5 text-gray-600" />
//             </button>
//             <button onClick={handleToggleStar}>
//               <Star
//                 className={`w-5 h-5 ${
//                   isStarred ? "text-yellow-400 fill-yellow-400" : "text-gray-400"
//                 }`}
//               />
//             </button>
//           </div>
//         </div>

//         {/* Main Content Area */}
//         <div className={`${!hasAiResponse ? 'flex space-x-8' : ''} h-[calc(100vh-80px)]`}>
//           {/* Left Section: Chat Interface */}
//           <div className={`${hasAiResponse ? 'w-full' : 'flex-1'} flex flex-col space-y-4`}>
//             <ChatInterface /> {/* Use the ChatInterface component */}
//           </div>

//           {/* Right Section: Files + Preview */}
//           {!hasAiResponse && (
//             <div className="w-1/3 flex flex-col space-y-4">
//               <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 flex-1 flex-col">
//                 <div className="flex justify-between items-center mb-4">
//                   <h3 className="text-lg font-semibold">Files</h3>
//                   {/* The upload button is now handled within FolderContent */}
//                 </div>

//                 {/* If a document is selected, show preview */}
//                 {selectedDocument ? (
//                   <DocumentPreviewModal
//                     document={selectedDocument}
//                     onClose={handleClosePreview}
//                   />
//                 ) : (
//                   <div className="flex-1 overflow-y-auto">
//                     <FolderContent onDocumentClick={handleDocumentClick} />
//                   </div>
//                 )}
//               </div>
//             </div>
//           )}
//         </div>
//       </div>
//     </div>
//   );
// };

// export default FolderDetailPage;


// import React, { useState, useEffect, useContext } from "react";
// import { useParams, useNavigate } from "react-router-dom";
// import { FileManagerContext } from "../context/FileManagerContext";
// import {
//   ArrowLeft,
//   Star,
//   MoreVertical,
// } from "lucide-react";
// import FolderContent from "../components/FolderContent/FolderContent";
// import DocumentPreviewModal from "../components/DocumentPreviewModal";
// import ChatInterface from "../components/ChatInterface/ChatInterface"; // Import ChatInterface

// const FolderDetailPage = () => {
//   const { folderName } = useParams();
//   const navigate = useNavigate();
//   const {
//     setSelectedFolder,
//     selectedFolder,
//     loadFoldersAndFiles,
//     hasAiResponse, // Get hasAiResponse from context
//   } = useContext(FileManagerContext);

//   const [selectedDocument, setSelectedDocument] = useState(null);
//   const [isStarred, setIsStarred] = useState(false);
//   const [showMoreMenu, setShowMoreMenu] = useState(false);
  

//   useEffect(() => {
//     if (folderName) {
//       setSelectedFolder(folderName);
//     }
//   }, [folderName, setSelectedFolder]);

//   useEffect(() => {
//     loadFoldersAndFiles();
//   }, [loadFoldersAndFiles]);

//   const handleDocumentClick = (doc) => {
//     setSelectedDocument(doc);
//   };

//   const handleClosePreview = () => {
//     setSelectedDocument(null);
//   };

//   const handleToggleStar = () => {
//     setIsStarred((prev) => !prev);
//   };

//   return (
//     <div className="min-h-screen bg-[#FDFCFB] text-gray-800 p-8" style={{marginLeft: '0px', marginRight: '0px'}}>
//       <div className="mx-auto">
//         {/* Top Navigation */}
//         <div className="mb-8 relative">
//           <button
//             onClick={() => navigate("/documents")}
//             className="flex items-center text-gray-600 hover:text-gray-800 transition-colors duration-200"
//           >
//             <ArrowLeft className="w-5 h-5 mr-2" />
//             <span>All projects</span>
//           </button>

//           {/* More menu */}
//           {showMoreMenu && (
//             <div className="absolute top-8 right-0 bg-white border border-gray-200 rounded-md shadow-lg p-2 z-50">
//               <button
//                 className="block w-full text-left px-4 py-2 hover:bg-gray-100 text-sm"
//                 onClick={() => alert("Rename project")}
//               >
//                 Rename Project
//               </button>
//               <button
//                 className="block w-full text-left px-4 py-2 hover:bg-gray-100 text-sm"
//                 onClick={() => alert("Delete project")}
//               >
//                 Delete Project
//               </button>
//             </div>
//           )}
//         </div>

//         {/* Document Upload Header */}
//         <div className="flex justify-between items-center mb-8">
//           <h1 className="text-3xl font-bold">
//             {selectedFolder || "Document Upload"}
//           </h1>
//           <div className="flex items-center space-x-4">
//             <button onClick={() => setShowMoreMenu((prev) => !prev)}>
//               <MoreVertical className="w-5 h-5 text-gray-600" />
//             </button>
//             <button onClick={handleToggleStar}>
//               <Star
//                 className={`w-5 h-5 ${
//                   isStarred ? "text-yellow-400 fill-yellow-400" : "text-gray-400"
//                 }`}
//               />
//             </button>
//           </div>
//         </div>

//         {/* Main Content Area */}
//         <div className={`${!hasAiResponse ? 'flex space-x-8' : ''} h-[calc(100vh-120px)]`}>
//           {/* Left Section: Chat Interface */}
//           <div className={`${hasAiResponse ? 'w-full' : 'flex-1'} flex flex-col space-y-4`}>
//             <ChatInterface /> {/* Use the ChatInterface component */}
//           </div>

//           {/* Right Section: Files + Preview */}
//           {!hasAiResponse && (
//             <div className="w-1/3 flex flex-col space-y-4">
//               <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 flex-1 flex-col">
//                 <div className="flex justify-between items-center mb-4">
//                   <h3 className="text-lg font-semibold">Files</h3>
//                   {/* The upload button is now handled within FolderContent */}
//                 </div>

//                 {/* If a document is selected, show preview */}
//                 {selectedDocument ? (
//                   <DocumentPreviewModal
//                     document={selectedDocument}
//                     onClose={handleClosePreview}
//                   />
//                 ) : (
//                   <div className="flex-1 overflow-y-auto">
//                     <FolderContent onDocumentClick={handleDocumentClick} />
//                   </div>
//                 )}
//               </div>
//             </div>
//           )}
//         </div>
//       </div>
//     </div>
//   );
// };

// export default FolderDetailPage;


// import React, { useState, useEffect, useContext } from "react";
// import { useParams, useNavigate } from "react-router-dom";
// import { FileManagerContext } from "../context/FileManagerContext";
// import {
//   ArrowLeft,
//   Star,
//   MoreVertical,
// } from "lucide-react";
// import FolderContent from "../components/FolderContent/FolderContent";
// import DocumentPreviewModal from "../components/DocumentPreviewModal";
// import ChatInterface from "../components/ChatInterface/ChatInterface";

// const FolderDetailPage = () => {
//   const { folderName } = useParams();
//   const navigate = useNavigate();
//   const {
//     setSelectedFolder,
//     selectedFolder,
//     loadFoldersAndFiles,
//     hasAiResponse,
//   } = useContext(FileManagerContext);
//   const [selectedDocument, setSelectedDocument] = useState(null);
//   const [isStarred, setIsStarred] = useState(false);
//   const [showMoreMenu, setShowMoreMenu] = useState(false);

//   useEffect(() => {
//     if (folderName) {
//       setSelectedFolder(folderName);
//     }
//   }, [folderName, setSelectedFolder]);

//   useEffect(() => {
//     loadFoldersAndFiles();
//   }, [loadFoldersAndFiles]);

//   const handleDocumentClick = (doc) => {
//     setSelectedDocument(doc);
//   };

//   const handleClosePreview = () => {
//     setSelectedDocument(null);
//   };

//   const handleToggleStar = () => {
//     setIsStarred((prev) => !prev);
//   };

//   return (
//     <div className="min-h-screen bg-[#FDFCFB] text-gray-800 p-8" style={{marginLeft: '0px', marginRight: '0px'}}>
//       <div className="mx-auto">
//         {/* Top Navigation */}
//         <div className="mb-8 relative">
//           <button
//             onClick={() => navigate("/documents")}
//             className="flex items-center text-gray-600 hover:text-gray-800 transition-colors duration-200"
//           >
//             <ArrowLeft className="w-5 h-5 mr-2" />
//             <span>All projects</span>
//           </button>
//           {showMoreMenu && (
//             <div className="absolute top-8 right-0 bg-white border border-gray-200 rounded-md shadow-lg p-2 z-50">
//               <button
//                 className="block w-full text-left px-4 py-2 hover:bg-gray-100 text-sm"
//                 onClick={() => alert("Rename project")}
//               >
//                 Rename Project
//               </button>
//               <button
//                 className="block w-full text-left px-4 py-2 hover:bg-gray-100 text-sm"
//                 onClick={() => alert("Delete project")}
//               >
//                 Delete Project
//               </button>
//             </div>
//           )}
//         </div>
//         {/* Document Upload Header */}
//         <div className="flex justify-between items-center mb-8">
//           <h1 className="text-3xl font-bold">
//             {selectedFolder || "Document Upload"}
//           </h1>
//           <div className="flex items-center space-x-4">
//             <button onClick={() => setShowMoreMenu((prev) => !prev)}>
//               <MoreVertical className="w-5 h-5 text-gray-600" />
//             </button>
//             <button onClick={handleToggleStar}>
//               <Star
//                 className={`w-5 h-5 ${
//                   isStarred ? "text-yellow-400 fill-yellow-400" : "text-gray-400"
//                 }`}
//               />
//             </button>
//           </div>
//         </div>
//         {/* Main Content Area */}
//         <div className={`${!hasAiResponse ? 'flex space-x-8' : ''} h-[calc(100vh-120px)]`}>
//           {/* Left Section: Chat Interface */}
//           <div className={`${hasAiResponse ? 'w-full' : 'flex-1'} flex flex-col space-y-4`}>
//             <ChatInterface />
//           </div>
//           {/* Right Section: Files + Preview */}
//           {!hasAiResponse && (
//             <div className="w-1/3 flex flex-col space-y-4">
//               <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 flex-1 flex-col">
//                 <div className="flex justify-between items-center mb-4">
//                   <h3 className="text-lg font-semibold">Files</h3>
//                 </div>
//                 {selectedDocument ? (
//                   <DocumentPreviewModal
//                     document={selectedDocument}
//                     onClose={handleClosePreview}
//                   />
//                 ) : (
//                   <div className="flex-1 overflow-y-auto">
//                     <FolderContent onDocumentClick={handleDocumentClick} />
//                   </div>
//                 )}
//               </div>
//             </div>
//           )}
//         </div>
//       </div>
//     </div>
//   );
// };
// export default FolderDetailPage;



import React, { useState, useEffect, useContext } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { FileManagerContext } from "../context/FileManagerContext";
import {
  ArrowLeft,
  Star,
  MoreVertical,
} from "lucide-react";
import FolderContent from "../components/FolderContent/FolderContent";
import DocumentPreviewModal from "../components/DocumentPreviewModal";
import ChatInterface from "../components/ChatInterface/ChatInterface";

const FolderDetailPage = () => {
  const { folderName } = useParams();
  const navigate = useNavigate();
  const {
    setSelectedFolder,
    selectedFolder,
    loadFoldersAndFiles,
    hasAiResponse,
  } = useContext(FileManagerContext);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [isStarred, setIsStarred] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  useEffect(() => {
    if (folderName) {
      setSelectedFolder(folderName);
    }

    return () => {
      setSelectedFolder(null);
    };
  }, [folderName, setSelectedFolder]);

  useEffect(() => {
    loadFoldersAndFiles();
  }, [loadFoldersAndFiles]);

  const handleDocumentClick = (doc) => {
    setSelectedDocument(doc);
  };

  const handleClosePreview = () => {
    setSelectedDocument(null);
  };

  const handleToggleStar = () => {
    setIsStarred((prev) => !prev);
  };

  return (
    <div className="h-screen bg-[#FDFCFB] text-gray-800 overflow-hidden scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent" style={{marginLeft: '0px', marginRight: '0px'}}>
      <div className="h-full flex flex-col mx-auto">
        {/* Top Navigation */}
        <div className="flex-shrink-0 p-0">
          <button
            onClick={() => navigate("/documents")}
            className="flex items-center text-gray-600 hover:text-gray-800 transition-colors duration-200"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            <span className="text-sm">All projects</span>
          </button>
          {showMoreMenu && (
            <div className="absolute top-8 right-0 bg-white border border-gray-200 rounded-md shadow-lg p-2 z-50">
              <button
                className="block w-full text-left px-4 py-2 hover:bg-gray-100 text-sm"
                onClick={() => alert("Rename project")}
              >
                Rename Project
              </button>
              <button
                className="block w-full text-left px-4 py-2 hover:bg-gray-100 text-sm"
                onClick={() => alert("Delete project")}
              >
                Delete Project
              </button>
            </div>
          )}
        </div>
        {/* Document Upload Header */}
        <div className="flex-shrink-0 flex justify-between items-start p-0 gap-3">
          <h1 className="text-xl font-bold min-w-0 flex-1 break-words pr-2">
            {selectedFolder || "Document Upload"}
          </h1>
          <div className="flex items-center space-x-2 flex-shrink-0">
            <button onClick={() => setShowMoreMenu((prev) => !prev)}>
              <MoreVertical className="w-4 h-4 text-gray-600" />
            </button>
            <button onClick={handleToggleStar}>
              <Star
                className={`w-4 h-4 ${
                  isStarred ? "text-yellow-400 fill-yellow-400" : "text-gray-400"
                }`}
              />
            </button>
          </div>
        </div>
        {/* Main Content Area */}
        <div className={`flex-1 flex ${!hasAiResponse ? 'space-x-2' : ''} overflow-hidden`}>
          {/* Left Section: Chat Interface */}
          <div className={`${hasAiResponse ? 'w-full h-full' : 'flex-1 h-full'} flex flex-col scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent`}>
            <ChatInterface />
          </div>
          {/* Right Section: Files + Preview */}
          {!hasAiResponse && (
            <div className="w-1/3 flex flex-col h-full overflow-hidden scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">
              <div className="bg-white p-2 rounded border border-gray-200 flex-1 flex flex-col overflow-hidden">
                <div className="flex justify-between items-center mb-1 flex-shrink-0">
                  <h3 className="text-sm font-semibold">Files</h3>
                </div>
                {selectedDocument ? (
                  <DocumentPreviewModal
                    document={selectedDocument}
                    onClose={handleClosePreview}
                  />
                ) : (
                  <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">
                    <FolderContent onDocumentClick={handleDocumentClick} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
export default FolderDetailPage;