


// import React, { useEffect, useState } from "react";
// import { useNavigate } from "react-router-dom";
// import apiService from "../services/api";

// const ChatHistoryPage = () => {
//   const [chats, setChats] = useState([]);
//   const [loading, setLoading] = useState(true);
//   const [loadingMore, setLoadingMore] = useState(false);
//   const [error, setError] = useState(null);
//   const [searchQuery, setSearchQuery] = useState("");
//   const [page, setPage] = useState(1);
//   const [hasMore, setHasMore] = useState(true);
//   const navigate = useNavigate();

//   const fetchChats = async (pageNumber = 1) => {
//     try {
//       if (pageNumber === 1) setLoading(true);
//       else setLoadingMore(true);
//       const data = await apiService.fetchChatSessions(pageNumber, 20);
//       console.log('[ChatHistoryPage] Fetched chats:', data);
//       if (data.length < 20) setHasMore(false);
//       if (pageNumber === 1) {
//         setChats(data);
//       } else {
//         setChats((prev) => [...prev, ...data]);
//       }
//     } catch (err) {
//       console.error("Error fetching chats:", err);
//       setError(err.message || "Error fetching chats");
//     } finally {
//       setLoading(false);
//       setLoadingMore(false);
//     }
//   };

//   useEffect(() => {
//     fetchChats(1);
//   }, []);

//   const handleLoadMore = () => {
//     const nextPage = page + 1;
//     setPage(nextPage);
//     fetchChats(nextPage);
//   };

//   const generateTopicTitle = (chat) => {
//     if (chat.used_secret_prompt || chat.prompt_label) {
//       return chat.prompt_label || "Secret Prompt Analysis";
//     }
//     if (!chat.question) return "Untitled Chat";
//     const words = chat.question.trim().split(" ");
//     return words.length <= 8 ? chat.question : words.slice(0, 8).join(" ") + "...";
//   };

//   const formatDate = (dateString) => {
//     const date = new Date(dateString);
//     const now = new Date();
//     const diffTime = Math.abs(now - date);
//     const diffMinutes = Math.floor(diffTime / (1000 * 60));
//     const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
//     const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

//     if (diffMinutes < 60) {
//       return `Last message ${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
//     } else if (diffHours < 24) {
//       return `Last message ${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
//     } else if (diffDays === 1) {
//       return "Last message 1 day ago";
//     } else if (diffDays < 7) {
//       return `Last message ${diffDays} days ago`;
//     } else {
//       return `Last message ${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) !== 1 ? 's' : ''} ago`;
//     }
//   };

//   const handleChatClick = (chat) => {
//     console.log('[ChatHistoryPage] Chat clicked:', chat);

//     if (chat.file_id && chat.session_id) {
//       navigate(`/analysis/${chat.file_id}/${chat.session_id}`, {
//         state: {
//           chat: {
//             ...chat,
//             id: chat.id,
//             file_id: chat.file_id,
//             session_id: chat.session_id,
//             question: chat.question,
//             answer: chat.answer,
//             used_secret_prompt: chat.used_secret_prompt,
//             prompt_label: chat.prompt_label
//           }
//         }
//       });
//     } else if (chat.session_id) {
//       console.warn('[ChatHistoryPage] Missing file_id, navigating with session_id only');
//       navigate(`/analysis/session/${chat.session_id}`, {
//         state: {
//           chat: {
//             ...chat,
//             id: chat.id,
//             session_id: chat.session_id
//           }
//         }
//       });
//     } else {
//       console.error("Cannot navigate to chat: Missing required IDs", chat);
//       alert("Cannot open this chat. Information is incomplete.");
//     }
//   };

//   // UPDATED: New chat button now goes to /analysis
//   const handleNewChat = () => {
//     navigate('/analysis');
//   };

//   if (loading) {
//     return (
//       <div className="min-h-screen bg-gray-50 flex items-center justify-center">
//         <div className="flex flex-col items-center space-y-4">
//           <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1AA49B]"></div>
//           <div className="text-gray-500 text-sm">Loading conversations...</div>
//         </div>
//       </div>
//     );
//   }

//   if (error) {
//     return (
//       <div className="min-h-screen bg-gray-50 flex items-center justify-center">
//         <div className="text-gray-600 text-sm bg-red-50 px-4 py-3 rounded-lg border border-red-200">
//           <p className="font-medium text-red-800 mb-1">Error loading conversations</p>
//           <p className="text-red-600">{error}</p>
//         </div>
//       </div>
//     );
//   }

//   const filteredChats = chats.filter(
//     (chat) =>
//       chat.question?.toLowerCase().includes(searchQuery.toLowerCase()) ||
//       chat.answer?.toLowerCase().includes(searchQuery.toLowerCase()) ||
//       chat.prompt_label?.toLowerCase().includes(searchQuery.toLowerCase())
//   );

//   return (
//     <div className="min-h-screen bg-gray-50">
//       <div className="max-w-3xl mx-auto px-4 py-6">
//         {/* Header */}
//         <div className="flex items-center justify-between mb-6">
//           <h1 className="text-xl font-medium text-gray-900">Your chat history</h1>
//           <button
//             onClick={handleNewChat}
//             onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//             onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//             className="inline-flex items-center px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
//             style={{ backgroundColor: '#21C1B6' }}
//           >
//             <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
//               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
//             </svg>
//             New chat
//           </button>
//         </div>

//         {/* Search Bar - Black Text */}
//         <div className="relative mb-4">
//           <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
//             <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
//               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
//             </svg>
//           </div>
//           <input
//             type="text"
//             placeholder="Search your chats..."
//             value={searchQuery}
//             onChange={(e) => setSearchQuery(e.target.value)}
//             className="block w-full pl-10 pr-3 py-3 border-2 rounded-xl text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#1AA49B] focus:border-[#1AA49B] bg-white"
//             style={{ 
//               color: 'black', 
//               borderColor: '#21C1B6' 
//             }}
//             onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#1AA49B')}
//             onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#21C1B6')}
//           />
//         </div>

//         {/* Chat Count + Select */}
//         <div className="flex items-center justify-between mb-4 text-sm text-gray-600">
//           <span>{filteredChats.length} chats with JuriNex</span>
//           <button className="text-[#21C1B6] hover:text-[#1AA49B] font-medium">Select</button>
//         </div>

//         {/* Chat List - Light Border */}
//         <div className="space-y-4">
//           {[...filteredChats]
//             .sort((a, b) => new Date(b.created_at || b.timestamp) - new Date(a.created_at || a.timestamp))
//             .map((chat, index) => (
//               <div
//                 key={chat.id || index}
//                 onClick={() => handleChatClick(chat)}
//                 className="group cursor-pointer block px-6 py-5 bg-white rounded-2xl transition-all"
//                 style={{ 
//                   border: '2px solid #A3E4DB',
//                   backgroundColor: 'white'
//                 }}
//                 onMouseEnter={(e) => {
//                   e.currentTarget.style.borderColor = '#1AA49B';
//                   e.currentTarget.style.backgroundColor = '#F5FFFE';
//                 }}
//                 onMouseLeave={(e) => {
//                   e.currentTarget.style.borderColor = '#A3E4DB';
//                   e.currentTarget.style.backgroundColor = 'white';
//                 }}
//               >
//                 <div className="flex items-center justify-between">
//                   <div className="flex-1 min-w-0">
//                     <div className="flex items-center gap-2 mb-1">
//                       <h3 className="text-base font-medium text-gray-900 truncate">
//                         {generateTopicTitle(chat)}
//                       </h3>
//                       {chat.used_secret_prompt && (
//                         <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#e6f7f5] text-[#1AA49B]">
//                           Secret
//                         </span>
//                       )}
//                     </div>
//                     <p className="text-sm text-gray-500">
//                       {formatDate(chat.created_at || chat.timestamp)}
//                     </p>
//                   </div>

//                   <div className="opacity-0 group-hover:opacity-100 transition-opacity">
//                     <button
//                       className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
//                       onClick={(e) => {
//                         e.stopPropagation();
//                       }}
//                     >
//                       <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
//                         <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
//                       </svg>
//                     </button>
//                   </div>
//                 </div>
//               </div>
//             ))}
//         </div>

//         {/* Load More Button */}
//         {hasMore && (
//           <div className="mt-8 text-center">
//             <button
//               onClick={handleLoadMore}
//               disabled={loadingMore}
//               className="px-6 py-2.5 text-sm font-medium text-white rounded-xl transition-colors"
//               style={{ backgroundColor: '#21C1B6' }}
//               onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//               onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//             >
//               {loadingMore ? (
//                 <span className="flex items-center gap-2">
//                   <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
//                   Loading...
//                 </span>
//               ) : (
//                 "Load older conversations"
//               )}
//             </button>
//           </div>
//         )}

//         {/* No Search Results */}
//         {searchQuery && filteredChats.length === 0 && (
//           <div className="text-center py-16">
//             <svg className="mx-auto h-12 w-12 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
//               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
//             </svg>
//             <p className="text-gray-500 text-sm">No conversations match your search</p>
//           </div>
//         )}

//         {/* Empty State */}
//         {!loading && chats.length === 0 && !searchQuery && (
//           <div className="text-center py-16">
//             <svg className="mx-auto h-16 w-16 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
//               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
//             </svg>
//             <p className="text-gray-600 text-lg font-medium mb-2">No conversations yet</p>
//             <p className="text-gray-500 text-sm">
//               Start a conversation by uploading a document and asking questions
//             </p>
//           </div>
//         )}
//       </div>
//     </div>
//   );
// };

// export default ChatHistoryPage;




// import React, { useEffect, useState } from "react";
// import { useNavigate } from "react-router-dom";
// import apiService from "../services/api";
// import Swal from "sweetalert2";

// const ChatHistoryPage = () => {
//  const [chats, setChats] = useState([]);
//  const [loading, setLoading] = useState(true);
//  const [loadingMore, setLoadingMore] = useState(false);
//  const [error, setError] = useState(null);
//  const [searchQuery, setSearchQuery] = useState("");
//  const [page, setPage] = useState(1);
//  const [hasMore, setHasMore] = useState(true);
//  const [selectionMode, setSelectionMode] = useState(false);
//  const [selectedChats, setSelectedChats] = useState(new Set());
//  const [deleting, setDeleting] = useState(false);
//  const [openDropdown, setOpenDropdown] = useState(null); // Track which chat's dropdown is open
//  const navigate = useNavigate();

//  const fetchChats = async (pageNumber = 1) => {
//  try {
//  if (pageNumber === 1) setLoading(true);
//  else setLoadingMore(true);
//  const data = await apiService.fetchChatSessions(pageNumber, 20);
//  console.log('[ChatHistoryPage] Fetched chats:', data);
//  if (data.length < 20) setHasMore(false);
//  if (pageNumber === 1) {
//  setChats(data);
//  } else {
//  setChats((prev) => [...prev, ...data]);
//  }
//  } catch (err) {
//  console.error("Error fetching chats:", err);
//  setError(err.message || "Error fetching chats");
//  } finally {
//  setLoading(false);
//  setLoadingMore(false);
//  }
//  };

//  useEffect(() => {
//  fetchChats(1);
//  }, []);

//  const handleLoadMore = () => {
//  const nextPage = page + 1;
//  setPage(nextPage);
//  fetchChats(nextPage);
//  };

//  const generateTopicTitle = (chat) => {
//  if (chat.used_secret_prompt || chat.prompt_label) {
//  return chat.prompt_label || "Secret Prompt Analysis";
//  }
//  if (!chat.question) return "Untitled Chat";
//  const words = chat.question.trim().split(" ");
//  return words.length <= 8 ? chat.question : words.slice(0, 8).join(" ") + "...";
//  };

//  const formatDate = (dateString) => {
//  const date = new Date(dateString);
//  const now = new Date();
//  const diffTime = Math.abs(now - date);
//  const diffMinutes = Math.floor(diffTime / (1000 * 60));
//  const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
//  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

//  if (diffMinutes < 60) {
//  return `Last message ${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
//  } else if (diffHours < 24) {
//  return `Last message ${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
//  } else if (diffDays === 1) {
//  return "Last message 1 day ago";
//  } else if (diffDays < 7) {
//  return `Last message ${diffDays} days ago`;
//  } else {
//  return `Last message ${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) !== 1 ? 's' : ''} ago`;
//  }
//  };

//  const handleChatClick = (chat) => {
//  // Don't navigate if in selection mode
//  if (selectionMode) {
//  return;
//  }

//  console.log('[ChatHistoryPage] Chat clicked:', chat);

//  if (chat.file_id && chat.session_id) {
//  navigate(`/analysis/${chat.file_id}/${chat.session_id}`, {
//  state: {
//  chat: {
//  ...chat,
//  id: chat.id,
//  file_id: chat.file_id,
//  session_id: chat.session_id,
//  question: chat.question,
//  answer: chat.answer,
//  used_secret_prompt: chat.used_secret_prompt,
//  prompt_label: chat.prompt_label
//  }
//  }
//  });
//  } else if (chat.session_id) {
//  console.warn('[ChatHistoryPage] Missing file_id, navigating with session_id only');
//  navigate(`/analysis/session/${chat.session_id}`, {
//  state: {
//  chat: {
//  ...chat,
//  id: chat.id,
//  session_id: chat.session_id
//  }
//  }
//  });
//  } else {
//  console.error("Cannot navigate to chat: Missing required IDs", chat);
//  alert("Cannot open this chat. Information is incomplete.");
//  }
//  };

//  // UPDATED: New chat button now goes to /analysis
//  const handleNewChat = () => {
//  navigate('/analysis');
//  };

//  // ========================
//  // Chat Deletion Functions
//  // ========================
//  const handleDeleteChat = async (chatId, event) => {
//  if (event) {
//  event.stopPropagation();
//  }
//  setOpenDropdown(null); // Close dropdown

//  const result = await Swal.fire({
//  title: 'Delete chat',
//  text: 'Are you sure you want to delete this chat?',
//  icon: 'warning',
//  showCancelButton: true,
//  confirmButtonColor: '#d33',
//  cancelButtonColor: '#6b7280',
//  confirmButtonText: 'Delete',
//  cancelButtonText: 'Cancel',
//  reverseButtons: false,
//  customClass: {
//  popup: 'rounded-lg',
//  confirmButton: 'rounded-lg',
//  cancelButton: 'rounded-lg'
//  }
//  });

//  if (result.isConfirmed) {
//  setDeleting(true);
//  try {
//  await apiService.deleteChat(chatId);
//  setChats(chats.filter(chat => chat.id !== chatId));
//  Swal.fire({
//  title: 'Deleted!',
//  text: 'Chat has been deleted.',
//  icon: 'success',
//  timer: 1500,
//  showConfirmButton: false
//  });
//  } catch (err) {
//  console.error("Error deleting chat:", err);
//  Swal.fire({
//  title: 'Error!',
//  text: err.message || 'Failed to delete chat. Please try again.',
//  icon: 'error',
//  confirmButtonColor: '#3085d6'
//  });
//  } finally {
//  setDeleting(false);
//  }
//  }
//  };

//  const handleDeleteSelected = async () => {
//  if (selectedChats.size === 0) {
//  Swal.fire({
//  title: 'No Selection',
//  text: 'Please select at least one chat to delete.',
//  icon: 'info',
//  confirmButtonColor: '#3085d6'
//  });
//  return;
//  }

//  const result = await Swal.fire({
//  title: `Delete ${selectedChats.size} Selected Chat(s)`,
//  text: `Are you sure you want to delete ${selectedChats.size} selected chat(s)?`,
//  icon: 'warning',
//  showCancelButton: true,
//  confirmButtonColor: '#d33',
//  cancelButtonColor: '#6b7280',
//  confirmButtonText: 'Delete',
//  cancelButtonText: 'Cancel',
//  reverseButtons: false,
//  customClass: {
//  popup: 'rounded-lg',
//  confirmButton: 'rounded-lg',
//  cancelButton: 'rounded-lg'
//  }
//  });

//  if (result.isConfirmed) {
//  setDeleting(true);
//  try {
//  const chatIdsArray = Array.from(selectedChats);
//  await apiService.deleteSelectedChats(chatIdsArray);
//  setChats(chats.filter(chat => !selectedChats.has(chat.id)));
//  setSelectedChats(new Set());
//  setSelectionMode(false);
//  Swal.fire({
//  title: 'Deleted!',
//  text: `${chatIdsArray.length} chat(s) have been deleted.`,
//  icon: 'success',
//  timer: 1500,
//  showConfirmButton: false
//  });
//  } catch (err) {
//  console.error("Error deleting selected chats:", err);
//  Swal.fire({
//  title: 'Error!',
//  text: err.message || 'Failed to delete selected chats. Please try again.',
//  icon: 'error',
//  confirmButtonColor: '#3085d6'
//  });
//  } finally {
//  setDeleting(false);
//  }
//  }
//  };

//  const handleDeleteAll = async () => {
//  if (chats.length === 0) {
//  Swal.fire({
//  title: 'No Chats',
//  text: 'No chats to delete.',
//  icon: 'info',
//  confirmButtonColor: '#3085d6'
//  });
//  return;
//  }

//  const result = await Swal.fire({
//  title: 'Delete All Chats',
//  text: `Are you sure you want to delete all ${chats.length} chats?`,
//  icon: 'warning',
//  showCancelButton: true,
//  confirmButtonColor: '#d33',
//  cancelButtonColor: '#6b7280',
//  confirmButtonText: 'Delete',
//  cancelButtonText: 'Cancel',
//  reverseButtons: false,
//  customClass: {
//  popup: 'rounded-lg',
//  confirmButton: 'rounded-lg',
//  cancelButton: 'rounded-lg'
//  }
//  });

//  if (result.isConfirmed) {
//  setDeleting(true);
//  try {
//  await apiService.deleteAllChats();
//  setChats([]);
//  setSelectedChats(new Set());
//  setSelectionMode(false);
//  Swal.fire({
//  title: 'Deleted!',
//  text: 'All chats have been deleted.',
//  icon: 'success',
//  timer: 1500,
//  showConfirmButton: false
//  });
//  } catch (err) {
//  console.error("Error deleting all chats:", err);
//  Swal.fire({
//  title: 'Error!',
//  text: err.message || 'Failed to delete all chats. Please try again.',
//  icon: 'error',
//  confirmButtonColor: '#3085d6'
//  });
//  } finally {
//  setDeleting(false);
//  }
//  }
//  };

//  // Selection mode handlers
//  const toggleSelectionMode = () => {
//  setSelectionMode(!selectionMode);
//  if (selectionMode) {
//  setSelectedChats(new Set());
//  }
//  };

//  const toggleChatSelection = (chatId, event) => {
//  if (event) {
//  event.stopPropagation();
//  }
//  const newSelected = new Set(selectedChats);
//  if (newSelected.has(chatId)) {
//  newSelected.delete(chatId);
//  } else {
//  newSelected.add(chatId);
//  }
//  setSelectedChats(newSelected);
//  };

//  const selectAllChats = () => {
//  const allIds = new Set(filteredChats.map(chat => chat.id));
//  setSelectedChats(allIds);
//  };

//  const deselectAllChats = () => {
//  setSelectedChats(new Set());
//  };

//  // Handle dropdown toggle
//  const toggleDropdown = (chatId, event) => {
//  if (event) {
//  event.stopPropagation();
//  }
//  setOpenDropdown(openDropdown === chatId ? null : chatId);
//  };

//  // Close dropdown when clicking outside
//  useEffect(() => {
//  const handleClickOutside = (event) => {
//  if (!event.target.closest('.dropdown-container')) {
//  setOpenDropdown(null);
//  }
//  };
//  document.addEventListener('click', handleClickOutside);
//  return () => document.removeEventListener('click', handleClickOutside);
//  }, []);

//  if (loading) {
//  return (
//  <div className="min-h-screen bg-gray-50 flex items-center justify-center">
//  <div className="flex flex-col items-center space-y-4">
//  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1AA49B]"></div>
//  <div className="text-gray-500 text-sm">Loading conversations...</div>
//  </div>
//  </div>
//  );
//  }

//  if (error) {
//  return (
//  <div className="min-h-screen bg-gray-50 flex items-center justify-center">
//  <div className="text-gray-600 text-sm bg-red-50 px-4 py-3 rounded-lg border border-red-200">
//  <p className="font-medium text-red-800 mb-1">Error loading conversations</p>
//  <p className="text-red-600">{error}</p>
//  </div>
//  </div>
//  );
//  }

//  const filteredChats = chats.filter(
//  (chat) =>
//  chat.question?.toLowerCase().includes(searchQuery.toLowerCase()) ||
//  chat.answer?.toLowerCase().includes(searchQuery.toLowerCase()) ||
//  chat.prompt_label?.toLowerCase().includes(searchQuery.toLowerCase())
//  );

//  return (
//  <div className="min-h-screen bg-gray-50">
//  <div className="max-w-3xl mx-auto px-4 py-6">
//  {/* Header */}
//  <div className="flex items-center justify-between mb-6">
//  <h1 className="text-xl font-medium text-gray-900">Your chat history</h1>
//  <div className="flex items-center gap-2">
//  {selectionMode && selectedChats.size > 0 && (
//  <button
//  onClick={handleDeleteSelected}
//  disabled={deleting}
//  className="inline-flex items-center px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors bg-red-500 hover:bg-red-600 disabled:opacity-50"
//  >
//  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
//  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
//  </svg>
//  Delete Selected ({selectedChats.size})
//  </button>
//  )}
//  {chats.length > 0 && (
//  <button
//  onClick={handleDeleteAll}
//  disabled={deleting}
//  className="inline-flex items-center px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors bg-red-500 hover:bg-red-600 disabled:opacity-50"
//  >
//  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
//  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
//  </svg>
//  Delete All
//  </button>
//  )}
//  <button
//  onClick={handleNewChat}
//  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//  className="inline-flex items-center px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
//  style={{ backgroundColor: '#21C1B6' }}
//  >
//  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
//  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
//  </svg>
//  New chat
//  </button>
//  </div>
//  </div>

//  {/* Search Bar - Black Text */}
//  <div className="relative mb-4">
//  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
//  <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
//  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
//  </svg>
//  </div>
//  <input
//  type="text"
//  placeholder="Search your chats..."
//  value={searchQuery}
//  onChange={(e) => setSearchQuery(e.target.value)}
//  className="block w-full pl-10 pr-3 py-3 border-2 rounded-xl text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#1AA49B] focus:border-[#1AA49B] bg-white"
//  style={{ 
//  color: 'black', 
//  borderColor: '#21C1B6' 
//  }}
//  onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#1AA49B')}
//  onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#21C1B6')}
//  />
//  </div>

//  {/* Chat Count + Select */}
//  <div className="flex items-center justify-between mb-4 text-sm text-gray-600">
//  <span>{filteredChats.length} chats with JuriNex</span>
//  <div className="flex items-center gap-3">
//  {selectionMode && (
//  <>
//  <button
//  onClick={selectAllChats}
//  className="text-[#21C1B6] hover:text-[#1AA49B] font-medium"
//  >
//  Select All
//  </button>
//  <button
//  onClick={deselectAllChats}
//  className="text-[#21C1B6] hover:text-[#1AA49B] font-medium"
//  >
//  Deselect All
//  </button>
//  </>
//  )}
//  <button
//  onClick={toggleSelectionMode}
//  className={`font-medium ${
//  selectionMode
//  ? "text-red-500 hover:text-red-600"
//  : "text-[#21C1B6] hover:text-[#1AA49B]"
//  }`}
//  >
//  {selectionMode ? "Cancel" : "Select"}
//  </button>
//  </div>
//  </div>

//  {/* Chat List - Light Border */}
//  <div className="space-y-4">
//  {[...filteredChats]
//  .sort((a, b) => new Date(b.created_at || b.timestamp) - new Date(a.created_at || a.timestamp))
//  .map((chat, index) => (
//  <div
//  key={chat.id || index}
//  onClick={() => {
//  if (selectionMode) {
//  toggleChatSelection(chat.id);
//  } else {
//  handleChatClick(chat);
//  }
//  }}
//  className={`group cursor-pointer block px-6 py-5 rounded-2xl transition-all ${
//  selectionMode && selectedChats.has(chat.id)
//  ? 'bg-[#E6F7F5] border-2 border-[#1AA49B]'
//  : 'bg-white border-2 border-[#A3E4DB]'
//  }`}
//  onMouseEnter={(e) => {
//  if (!selectionMode || !selectedChats.has(chat.id)) {
//  e.currentTarget.style.borderColor = '#1AA49B';
//  e.currentTarget.style.backgroundColor = '#F5FFFE';
//  }
//  }}
//  onMouseLeave={(e) => {
//  if (!selectionMode || !selectedChats.has(chat.id)) {
//  e.currentTarget.style.borderColor = '#A3E4DB';
//  e.currentTarget.style.backgroundColor = 'white';
//  } else {
//  e.currentTarget.style.borderColor = '#1AA49B';
//  e.currentTarget.style.backgroundColor = '#E6F7F5';
//  }
//  }}
//  >
//  <div className="flex items-center justify-between">
//  <div className="flex items-center gap-3 flex-1 min-w-0">
//  {selectionMode && (
//  <input
//  type="checkbox"
//  checked={selectedChats.has(chat.id)}
//  onChange={(e) => toggleChatSelection(chat.id, e)}
//  onClick={(e) => e.stopPropagation()}
//  className="w-5 h-5 text-[#21C1B6] border-gray-300 rounded focus:ring-[#21C1B6] cursor-pointer"
//  />
//  )}
//  <div className="flex-1 min-w-0">
//  <div className="flex items-center gap-2 mb-1">
//  <h3 className="text-base font-medium text-gray-900 truncate">
//  {generateTopicTitle(chat)}
//  </h3>
//  {chat.used_secret_prompt && (
//  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#e6f7f5] text-[#1AA49B]">
//  Secret
//  </span>
//  )}
//  </div>
//  <p className="text-sm text-gray-500">
//  {formatDate(chat.created_at || chat.timestamp)}
//  </p>
//  </div>
//  </div>

//  <div className="opacity-0 group-hover:opacity-100 transition-opacity relative dropdown-container">
//  {!selectionMode && (
//  <>
//  <button
//  className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
//  onClick={(e) => toggleDropdown(chat.id, e)}
//  >
//  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
//  <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
//  </svg>
//  </button>
//  {openDropdown === chat.id && (
//  <div className="absolute right-0 top-10 z-50 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1">
//  <button
//  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
//  onClick={(e) => handleDeleteChat(chat.id, e)}
//  >
//  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
//  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
//  </svg>
//  Delete
//  </button>
//  </div>
//  )}
//  </>
//  )}
//  </div>
//  </div>
//  </div>
//  ))}
//  </div>

//  {/* Load More Button */}
//  {hasMore && (
//  <div className="mt-8 text-center">
//  <button
//  onClick={handleLoadMore}
//  disabled={loadingMore}
//  className="px-6 py-2.5 text-sm font-medium text-white rounded-xl transition-colors"
//  style={{ backgroundColor: '#21C1B6' }}
//  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//  >
//  {loadingMore ? (
//  <span className="flex items-center gap-2">
//  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
//  Loading...
//  </span>
//  ) : (
//  "Load older conversations"
//  )}
//  </button>
//  </div>
//  )}

//  {/* No Search Results */}
//  {searchQuery && filteredChats.length === 0 && (
//  <div className="text-center py-16">
//  <svg className="mx-auto h-12 w-12 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
//  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
//  </svg>
//  <p className="text-gray-500 text-sm">No conversations match your search</p>
//  </div>
//  )}

//  {/* Empty State */}
//  {!loading && chats.length === 0 && !searchQuery && (
//  <div className="text-center py-16">
//  <svg className="mx-auto h-16 w-16 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
//  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
//  </svg>
//  <p className="text-gray-600 text-lg font-medium mb-2">No conversations yet</p>
//  <p className="text-gray-500 text-sm">
//  Start a conversation by uploading a document and asking questions
//  </p>
//  </div>
//  )}

//  </div>
//  </div>
//  );
// };

// export default ChatHistoryPage;

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import apiService from "../services/api";
import Swal from "sweetalert2";

// Chat type filter options
const CHAT_TYPES = {
  ALL: 'all',
  ANALYSIS: 'analysis',
  CHAT_MODEL: 'chat_model'
};

const ChatHistoryPage = () => {
 const [chats, setChats] = useState([]);
 const [chatModelChats, setChatModelChats] = useState([]);
 const [loading, setLoading] = useState(true);
 const [loadingMore, setLoadingMore] = useState(false);
 const [error, setError] = useState(null);
 const [searchQuery, setSearchQuery] = useState("");
 const [page, setPage] = useState(1);
 const [hasMore, setHasMore] = useState(true);
 const [selectionMode, setSelectionMode] = useState(false);
 const [selectedChats, setSelectedChats] = useState(new Set());
 const [deleting, setDeleting] = useState(false);
 const [openDropdown, setOpenDropdown] = useState(null); // Track which chat's dropdown is open
 const [chatTypeFilter, setChatTypeFilter] = useState(CHAT_TYPES.ALL); // Filter for chat type
 const navigate = useNavigate();

 // Fetch Analysis chats
 const fetchChats = async (pageNumber = 1) => {
 try {
 if (pageNumber === 1) setLoading(true);
 else setLoadingMore(true);
 const data = await apiService.fetchChatSessions(pageNumber, 20);
 console.log('[ChatHistoryPage] Fetched Analysis chats:', data);
 if (data.length < 20) setHasMore(false);
 if (pageNumber === 1) {
 setChats(data);
 } else {
 setChats((prev) => [...prev, ...data]);
 }
 } catch (err) {
 console.error("Error fetching Analysis chats:", err);
 setError(err.message || "Error fetching chats");
 } finally {
 setLoading(false);
 setLoadingMore(false);
 }
 };

 // Fetch ChatModel chats
 const fetchChatModelChats = async () => {
 try {
 const response = await apiService.getChatModelFiles();
 if (response.success && response.data?.files) {
 const files = response.data.files;
 const allChatModelChats = [];
 
 // For each file, fetch its sessions and history
 for (const file of files) {
 try {
 const sessionsResponse = await apiService.getChatModelSessions(file.id);
 if (sessionsResponse.success && sessionsResponse.data?.sessions) {
 sessionsResponse.data.sessions.forEach((session) => {
 if (session.messages && session.messages.length > 0) {
 session.messages.forEach((message) => {
 allChatModelChats.push({
 id: message.id,
 file_id: file.id,
 session_id: session.session_id,
 question: message.question,
 answer: message.answer,
 created_at: message.created_at || session.last_message_at,
 filename: file.filename,
 chat_type: 'chat_model', // Mark as chat model chat
 });
 });
 }
 });
 }
 } catch (err) {
 console.error(`Error fetching sessions for file ${file.id}:`, err);
 }
 }
 
 setChatModelChats(allChatModelChats);
 } else {
 setChatModelChats([]);
 }
 } catch (err) {
 console.error("Error fetching ChatModel chats:", err);
 // Don't set error for ChatModel, just log it
 }
 };

 useEffect(() => {
 fetchChats(1);
 fetchChatModelChats();
 }, []);

 const handleLoadMore = () => {
 const nextPage = page + 1;
 setPage(nextPage);
 fetchChats(nextPage);
 };

 const generateTopicTitle = (chat) => {
 if (chat.used_secret_prompt || chat.prompt_label) {
 return chat.prompt_label || "Secret Prompt Analysis";
 }
 if (!chat.question) return "Untitled Chat";
 const words = chat.question.trim().split(" ");
 return words.length <= 8 ? chat.question : words.slice(0, 8).join(" ") + "...";
 };

 const formatDate = (dateString) => {
 const date = new Date(dateString);
 const now = new Date();
 const diffTime = Math.abs(now - date);
 const diffMinutes = Math.floor(diffTime / (1000 * 60));
 const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
 const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

 if (diffMinutes < 60) {
 return `Last message ${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
 } else if (diffHours < 24) {
 return `Last message ${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
 } else if (diffDays === 1) {
 return "Last message 1 day ago";
 } else if (diffDays < 7) {
 return `Last message ${diffDays} days ago`;
 } else {
 return `Last message ${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) !== 1 ? 's' : ''} ago`;
 }
 };

 const handleChatClick = (chat) => {
 // Don't navigate if in selection mode
 if (selectionMode) {
 return;
 }

 console.log('[ChatHistoryPage] Chat clicked:', chat);

 // Check if it's a ChatModel chat
 if (chat.chat_type === 'chat_model') {
 if (chat.file_id && chat.session_id) {
 navigate(`/chatmodel/${chat.file_id}/${chat.session_id}`, {
 state: {
 chat: {
 ...chat,
 id: chat.id,
 file_id: chat.file_id,
 session_id: chat.session_id,
 question: chat.question,
 answer: chat.answer
 }
 }
 });
 } else if (chat.file_id) {
 navigate(`/chatmodel`, {
 state: {
 chat: {
 ...chat,
 id: chat.id,
 file_id: chat.file_id,
 question: chat.question,
 answer: chat.answer
 }
 }
 });
 } else {
 console.error("Cannot navigate to ChatModel chat: Missing file_id", chat);
 alert("Cannot open this chat. Information is incomplete.");
 }
 return;
 }

 // Analysis chat navigation
 if (chat.file_id && chat.session_id) {
 navigate(`/analysis/${chat.file_id}/${chat.session_id}`, {
 state: {
 chat: {
 ...chat,
 id: chat.id,
 file_id: chat.file_id,
 session_id: chat.session_id,
 question: chat.question,
 answer: chat.answer,
 used_secret_prompt: chat.used_secret_prompt,
 prompt_label: chat.prompt_label
 }
 }
 });
 } else if (chat.session_id) {
 console.warn('[ChatHistoryPage] Missing file_id, navigating with session_id only');
 navigate(`/analysis/session/${chat.session_id}`, {
 state: {
 chat: {
 ...chat,
 id: chat.id,
 session_id: chat.session_id
 }
 }
 });
 } else {
 console.error("Cannot navigate to chat: Missing required IDs", chat);
 alert("Cannot open this chat. Information is incomplete.");
 }
 };

 // New chat button - goes to Analysis by default
 const handleNewChat = () => {
 if (chatTypeFilter === CHAT_TYPES.CHAT_MODEL) {
 navigate('/chatmodel');
 } else {
 navigate('/analysis');
 }
 };

 // ========================
 // Chat Deletion Functions
 // ========================
 const handleDeleteChat = async (chatId, event) => {
 if (event) {
 event.stopPropagation();
 }
 setOpenDropdown(null); // Close dropdown

 const result = await Swal.fire({
 title: 'Delete chat',
 text: 'Are you sure you want to delete this chat?',
 icon: 'warning',
 showCancelButton: true,
 confirmButtonColor: '#d33',
 cancelButtonColor: '#6b7280',
 confirmButtonText: 'Delete',
 cancelButtonText: 'Cancel',
 reverseButtons: false,
 customClass: {
 popup: 'rounded-lg',
 confirmButton: 'rounded-lg',
 cancelButton: 'rounded-lg'
 }
 });

 if (result.isConfirmed) {
 setDeleting(true);
 try {
 await apiService.deleteChat(chatId);
 setChats(chats.filter(chat => chat.id !== chatId));
 Swal.fire({
 title: 'Deleted!',
 text: 'Chat has been deleted.',
 icon: 'success',
 timer: 1500,
 showConfirmButton: false
 });
 } catch (err) {
 console.error("Error deleting chat:", err);
 Swal.fire({
 title: 'Error!',
 text: err.message || 'Failed to delete chat. Please try again.',
 icon: 'error',
 confirmButtonColor: '#3085d6'
 });
 } finally {
 setDeleting(false);
 }
 }
 };

 const handleDeleteSelected = async () => {
 if (selectedChats.size === 0) {
 Swal.fire({
 title: 'No Selection',
 text: 'Please select at least one chat to delete.',
 icon: 'info',
 confirmButtonColor: '#3085d6'
 });
 return;
 }

 const result = await Swal.fire({
 title: `Delete ${selectedChats.size} Selected Chat(s)`,
 text: `Are you sure you want to delete ${selectedChats.size} selected chat(s)?`,
 icon: 'warning',
 showCancelButton: true,
 confirmButtonColor: '#d33',
 cancelButtonColor: '#6b7280',
 confirmButtonText: 'Delete',
 cancelButtonText: 'Cancel',
 reverseButtons: false,
 customClass: {
 popup: 'rounded-lg',
 confirmButton: 'rounded-lg',
 cancelButton: 'rounded-lg'
 }
 });

 if (result.isConfirmed) {
 setDeleting(true);
 try {
 const chatIdsArray = Array.from(selectedChats);
 await apiService.deleteSelectedChats(chatIdsArray);
 setChats(chats.filter(chat => !selectedChats.has(chat.id)));
 setSelectedChats(new Set());
 setSelectionMode(false);
 Swal.fire({
 title: 'Deleted!',
 text: `${chatIdsArray.length} chat(s) have been deleted.`,
 icon: 'success',
 timer: 1500,
 showConfirmButton: false
 });
 } catch (err) {
 console.error("Error deleting selected chats:", err);
 Swal.fire({
 title: 'Error!',
 text: err.message || 'Failed to delete selected chats. Please try again.',
 icon: 'error',
 confirmButtonColor: '#3085d6'
 });
 } finally {
 setDeleting(false);
 }
 }
 };

 const handleDeleteAll = async () => {
 if (chats.length === 0) {
 Swal.fire({
 title: 'No Chats',
 text: 'No chats to delete.',
 icon: 'info',
 confirmButtonColor: '#3085d6'
 });
 return;
 }

 const result = await Swal.fire({
 title: 'Delete All Chats',
 text: `Are you sure you want to delete all ${chats.length} chats?`,
 icon: 'warning',
 showCancelButton: true,
 confirmButtonColor: '#d33',
 cancelButtonColor: '#6b7280',
 confirmButtonText: 'Delete',
 cancelButtonText: 'Cancel',
 reverseButtons: false,
 customClass: {
 popup: 'rounded-lg',
 confirmButton: 'rounded-lg',
 cancelButton: 'rounded-lg'
 }
 });

 if (result.isConfirmed) {
 setDeleting(true);
 try {
 await apiService.deleteAllChats();
 setChats([]);
 setSelectedChats(new Set());
 setSelectionMode(false);
 Swal.fire({
 title: 'Deleted!',
 text: 'All chats have been deleted.',
 icon: 'success',
 timer: 1500,
 showConfirmButton: false
 });
 } catch (err) {
 console.error("Error deleting all chats:", err);
 Swal.fire({
 title: 'Error!',
 text: err.message || 'Failed to delete all chats. Please try again.',
 icon: 'error',
 confirmButtonColor: '#3085d6'
 });
 } finally {
 setDeleting(false);
 }
 }
 };

 // Selection mode handlers
 const toggleSelectionMode = () => {
 setSelectionMode(!selectionMode);
 if (selectionMode) {
 setSelectedChats(new Set());
 }
 };

 const toggleChatSelection = (chatId, event) => {
 if (event) {
 event.stopPropagation();
 }
 const newSelected = new Set(selectedChats);
 if (newSelected.has(chatId)) {
 newSelected.delete(chatId);
 } else {
 newSelected.add(chatId);
 }
 setSelectedChats(newSelected);
 };

 const selectAllChats = () => {
 const allIds = new Set(filteredChats.map(chat => chat.id));
 setSelectedChats(allIds);
 };

 const deselectAllChats = () => {
 setSelectedChats(new Set());
 };

 // Handle dropdown toggle
 const toggleDropdown = (chatId, event) => {
 if (event) {
 event.stopPropagation();
 }
 setOpenDropdown(openDropdown === chatId ? null : chatId);
 };

 // Close dropdown when clicking outside
 useEffect(() => {
 const handleClickOutside = (event) => {
 if (!event.target.closest('.dropdown-container')) {
 setOpenDropdown(null);
 }
 };
 document.addEventListener('click', handleClickOutside);
 return () => document.removeEventListener('click', handleClickOutside);
 }, []);

 if (loading) {
 return (
 <div className="min-h-screen bg-gray-50 flex items-center justify-center">
 <div className="flex flex-col items-center space-y-4">
 <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1AA49B]"></div>
 <div className="text-gray-500 text-sm">Loading conversations...</div>
 </div>
 </div>
 );
 }

 if (error) {
 return (
 <div className="min-h-screen bg-gray-50 flex items-center justify-center">
 <div className="text-gray-600 text-sm bg-red-50 px-4 py-3 rounded-lg border border-red-200">
 <p className="font-medium text-red-800 mb-1">Error loading conversations</p>
 <p className="text-red-600">{error}</p>
 </div>
 </div>
 );
 }

 // Combine and filter chats based on type filter
 const getAllChats = () => {
 let allChats = [];
 
 if (chatTypeFilter === CHAT_TYPES.ALL) {
 allChats = [...chats, ...chatModelChats];
 } else if (chatTypeFilter === CHAT_TYPES.ANALYSIS) {
 allChats = chats;
 } else if (chatTypeFilter === CHAT_TYPES.CHAT_MODEL) {
 allChats = chatModelChats;
 }
 
 return allChats;
 };

 const filteredChats = getAllChats().filter(
 (chat) =>
 chat.question?.toLowerCase().includes(searchQuery.toLowerCase()) ||
 chat.answer?.toLowerCase().includes(searchQuery.toLowerCase()) ||
 chat.prompt_label?.toLowerCase().includes(searchQuery.toLowerCase())
 );

 return (
 <div className="min-h-screen bg-gray-50">
 <div className="max-w-3xl mx-auto px-4 py-6">
 {/* Header */}
 <div className="flex items-center justify-between mb-6">
 <h1 className="text-xl font-medium text-gray-900">Your chat history</h1>
 
 {/* Chat Type Filter Buttons */}
 <div className="flex items-center gap-2">
 <button
 onClick={() => setChatTypeFilter(CHAT_TYPES.ALL)}
 className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
   chatTypeFilter === CHAT_TYPES.ALL
     ? 'bg-[#21C1B6] text-white'
     : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
 }`}
 >
 All
 </button>
 <button
 onClick={() => setChatTypeFilter(CHAT_TYPES.ANALYSIS)}
 className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
   chatTypeFilter === CHAT_TYPES.ANALYSIS
     ? 'bg-[#21C1B6] text-white'
     : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
 }`}
 >
 Analysis
 </button>
 <button
 onClick={() => setChatTypeFilter(CHAT_TYPES.CHAT_MODEL)}
 className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
   chatTypeFilter === CHAT_TYPES.CHAT_MODEL
     ? 'bg-[#21C1B6] text-white'
     : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
 }`}
 >
 Chat Model
 </button>
 </div>
 <div className="flex items-center gap-2">
 {selectionMode && selectedChats.size > 0 && (
 <button
 onClick={handleDeleteSelected}
 disabled={deleting}
 className="inline-flex items-center px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors bg-red-500 hover:bg-red-600 disabled:opacity-50"
 >
 <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
 </svg>
 Delete Selected ({selectedChats.size})
 </button>
 )}
 {chats.length > 0 && (
 <button
 onClick={handleDeleteAll}
 disabled={deleting}
 className="inline-flex items-center px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors bg-red-500 hover:bg-red-600 disabled:opacity-50"
 >
 <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
 </svg>
 Delete All
 </button>
 )}
 <button
 onClick={handleNewChat}
 onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
 onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
 className="inline-flex items-center px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
 style={{ backgroundColor: '#21C1B6' }}
 >
 <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
 </svg>
 New chat
 </button>
 </div>
 </div>

 {/* Search Bar - Black Text */}
 <div className="relative mb-4">
 <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
 <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
 </svg>
 </div>
 <input
 type="text"
 placeholder="Search your chats..."
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 className="block w-full pl-10 pr-3 py-3 border-2 rounded-xl text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#1AA49B] focus:border-[#1AA49B] bg-white"
 style={{ 
 color: 'black', 
 borderColor: '#21C1B6' 
 }}
 onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#1AA49B')}
 onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#21C1B6')}
 />
 </div>

 {/* Chat Count + Select */}
 <div className="flex items-center justify-between mb-4 text-sm text-gray-600">
 <span>{filteredChats.length} chats with JuriNex</span>
 <div className="flex items-center gap-3">
 {selectionMode && (
 <>
 <button
 onClick={selectAllChats}
 className="text-[#21C1B6] hover:text-[#1AA49B] font-medium"
 >
 Select All
 </button>
 <button
 onClick={deselectAllChats}
 className="text-[#21C1B6] hover:text-[#1AA49B] font-medium"
 >
 Deselect All
 </button>
 </>
 )}
 <button
 onClick={toggleSelectionMode}
 className={`font-medium ${
 selectionMode
 ? "text-red-500 hover:text-red-600"
 : "text-[#21C1B6] hover:text-[#1AA49B]"
 }`}
 >
 {selectionMode ? "Cancel" : "Select"}
 </button>
 </div>
 </div>

 {/* Chat List - Light Border */}
 <div className="space-y-4">
 {[...filteredChats]
 .sort((a, b) => new Date(b.created_at || b.timestamp) - new Date(a.created_at || a.timestamp))
 .map((chat, index) => (
 <div
 key={chat.id || index}
 onClick={() => {
 if (selectionMode) {
 toggleChatSelection(chat.id);
 } else {
 handleChatClick(chat);
 }
 }}
 className={`group cursor-pointer block px-6 py-5 rounded-2xl transition-all ${
 selectionMode && selectedChats.has(chat.id)
 ? 'bg-[#E6F7F5] border-2 border-[#1AA49B]'
 : 'bg-white border-2 border-[#A3E4DB]'
 }`}
 onMouseEnter={(e) => {
 if (!selectionMode || !selectedChats.has(chat.id)) {
 e.currentTarget.style.borderColor = '#1AA49B';
 e.currentTarget.style.backgroundColor = '#F5FFFE';
 }
 }}
 onMouseLeave={(e) => {
 if (!selectionMode || !selectedChats.has(chat.id)) {
 e.currentTarget.style.borderColor = '#A3E4DB';
 e.currentTarget.style.backgroundColor = 'white';
 } else {
 e.currentTarget.style.borderColor = '#1AA49B';
 e.currentTarget.style.backgroundColor = '#E6F7F5';
 }
 }}
 >
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-3 flex-1 min-w-0">
 {selectionMode && (
 <input
 type="checkbox"
 checked={selectedChats.has(chat.id)}
 onChange={(e) => toggleChatSelection(chat.id, e)}
 onClick={(e) => e.stopPropagation()}
 className="w-5 h-5 text-[#21C1B6] border-gray-300 rounded focus:ring-[#21C1B6] cursor-pointer"
 />
 )}
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2 mb-1">
 <h3 className="text-base font-medium text-gray-900 truncate">
 {generateTopicTitle(chat)}
 </h3>
 {chat.chat_type === 'chat_model' && (
 <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
 Chat Model
 </span>
 )}
 {chat.used_secret_prompt && (
 <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#e6f7f5] text-[#1AA49B]">
 Secret
 </span>
 )}
 </div>
 <p className="text-sm text-gray-500">
 {formatDate(chat.created_at || chat.timestamp)}
 </p>
 </div>
 </div>

 <div className="opacity-0 group-hover:opacity-100 transition-opacity relative dropdown-container">
 {!selectionMode && (
 <>
 <button
 className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
 onClick={(e) => toggleDropdown(chat.id, e)}
 >
 <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
 <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
 </svg>
 </button>
 {openDropdown === chat.id && (
 <div className="absolute right-0 top-10 z-50 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1">
 <button
 className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
 onClick={(e) => handleDeleteChat(chat.id, e)}
 >
 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
 </svg>
 Delete
 </button>
 </div>
 )}
 </>
 )}
 </div>
 </div>
 </div>
 ))}
 </div>

 {/* Load More Button */}
 {hasMore && (
 <div className="mt-8 text-center">
 <button
 onClick={handleLoadMore}
 disabled={loadingMore}
 className="px-6 py-2.5 text-sm font-medium text-white rounded-xl transition-colors"
 style={{ backgroundColor: '#21C1B6' }}
 onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
 onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
 >
 {loadingMore ? (
 <span className="flex items-center gap-2">
 <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
 Loading...
 </span>
 ) : (
 "Load older conversations"
 )}
 </button>
 </div>
 )}

 {/* No Search Results */}
 {searchQuery && filteredChats.length === 0 && (
 <div className="text-center py-16">
 <svg className="mx-auto h-12 w-12 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
 </svg>
 <p className="text-gray-500 text-sm">No conversations match your search</p>
 </div>
 )}

 {/* Empty State */}
 {!loading && chats.length === 0 && !searchQuery && (
 <div className="text-center py-16">
 <svg className="mx-auto h-16 w-16 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
 </svg>
 <p className="text-gray-600 text-lg font-medium mb-2">No conversations yet</p>
 <p className="text-gray-500 text-sm">
 Start a conversation by uploading a document and asking questions
 </p>
 </div>
 )}

 </div>
 </div>
 );
};

export default ChatHistoryPage;