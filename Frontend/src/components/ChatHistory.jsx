// import React from 'react';
// import { MessageSquare, User, Bot } from 'lucide-react';

// const ChatHistory = ({ chatHistory = [] }) => {
//   const formatDate = (dateString) => {
//     try {
//       return new Date(dateString).toLocaleString();
//     } catch {
//       return 'Invalid date';
//     }
//   };

//   if (chatHistory.length === 0) {
//     return (
//       <div className="text-center text-gray-500 py-8">
//         <MessageSquare className="h-12 w-12 mx-auto mb-4 text-gray-400" />
//         <p className="text-lg font-medium">No chat history for this file.</p>
//         <p className="text-sm">Start a conversation in AI Analysis to see it here.</p>
//       </div>
//     );
//   }

//   return (
//     <div className="space-y-6 p-4 bg-white rounded-lg shadow-sm">
//       <h2 className="text-xl font-semibold text-gray-800 border-b pb-3 mb-4">Chat History</h2>
//       {chatHistory.map((chat, index) => (
//         <div key={chat.id || index} className="flex flex-col space-y-2">
//           {/* User Question */}
//           <div className="flex items-start space-x-3">
//             <div className="flex-shrink-0 p-2 bg-blue-100 rounded-full">
//               <User className="h-5 w-5 text-blue-600" />
//             </div>
//             <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex-1">
//               <p className="font-medium text-blue-800">You asked:</p>
//               <p className="text-gray-800 leading-relaxed">
//                 {chat.isSecret ? `[Secret Prompt: ${chat.secretName || chat.promptName || 'Unnamed'}]` : chat.question}
//               </p>
//               <p className="text-xs text-gray-500 mt-1 text-right">{formatDate(chat.timestamp)}</p>
//             </div>
//           </div>

//           {/* AI Response */}
//           <div className="flex items-start space-x-3">
//             <div className="flex-shrink-0 p-2 bg-green-100 rounded-full">
//               <Bot className="h-5 w-5 text-green-600" />
//             </div>
//             <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex-1">
//               <p className="font-medium text-green-800">AI responded:</p>
//               <p className="text-gray-800 leading-relaxed">{chat.answer}</p>
//               <p className="text-xs text-gray-500 mt-1 text-right">{formatDate(chat.timestamp)}</p>
//             </div>
//           </div>
//         </div>
//       ))}
//     </div>
//   );
// };

// export default ChatHistory;



import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import apiService from "../services/api";

const ChatHistoryPage = () => {
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const navigate = useNavigate();

  const fetchChats = async (pageNumber = 1) => {
    try {
      if (pageNumber === 1) setLoading(true);
      else setLoadingMore(true);

      const data = await apiService.fetchChatSessions(pageNumber, 20);
      console.log('[ChatHistoryPage] Fetched chats:', data);

      if (data.length < 20) setHasMore(false);

      if (pageNumber === 1) {
        setChats(data);
      } else {
        setChats((prev) => [...prev, ...data]);
      }
    } catch (err) {
      console.error("Error fetching chats:", err);
      setError(err.message || "Error fetching chats");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchChats(1);
  }, []);

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchChats(nextPage);
  };

  const generateTopicTitle = (chat) => {
    // Check if this is a secret prompt chat
    if (chat.used_secret_prompt || chat.prompt_label) {
      return chat.prompt_label || "Secret Prompt Analysis";
    }
    
    if (!chat.question) return "Untitled Chat";

    const words = chat.question.trim().split(" ");
    return words.length <= 8 ? chat.question : words.slice(0, 8).join(" ") + "...";
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: new Date().getFullYear() !== date.getFullYear() ? "numeric" : undefined,
    });
  };

  const handleChatClick = (chat) => {
    console.log('[ChatHistoryPage] Chat clicked:', chat);
    
    // ✅ Navigate to AnalysisPage with proper route and state
    if (chat.file_id && chat.session_id) {
      // Navigate with both file_id and session_id in the URL
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
      // Fallback: navigate with only session_id
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

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900"></div>
          <div className="text-slate-500 text-sm">Loading conversations...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-slate-600 text-sm bg-red-50 px-4 py-3 rounded-lg border border-red-200">
          <p className="font-medium text-red-800 mb-1">Error loading conversations</p>
          <p className="text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  const filteredChats = chats.filter(
    (chat) =>
      chat.question?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      chat.answer?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      chat.prompt_label?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-medium text-slate-900 mb-2">Conversations</h1>
          <p className="text-slate-600 text-sm mb-6">Your recent chat history</p>

          {/* Search Input */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-3 text-sm border border-slate-200 rounded-lg focus:ring-1 focus:ring-slate-300 focus:outline-none"
            />
            <div className="absolute inset-y-0 right-0 flex items-center pr-3">
              <svg
                className="w-4 h-4 text-slate-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
          </div>
        </div>

        {/* Chat List */}
        <div className="space-y-3">
          {[...filteredChats]
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .map((chat) => (
              <div
                key={chat.id}
                onClick={() => handleChatClick(chat)}
                className="cursor-pointer block p-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Title */}
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-medium text-slate-900 line-clamp-1">
                        {generateTopicTitle(chat)}
                      </h3>
                      {chat.used_secret_prompt && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                          Secret Prompt
                        </span>
                      )}
                    </div>

                    {/* Question */}
                    <p className="text-sm text-slate-600 line-clamp-2 mb-2">
                      {chat.used_secret_prompt 
                        ? `Analysis: ${chat.prompt_label || 'Secret Prompt'}`
                        : chat.question || 'No question'
                      }
                    </p>

                    {/* Answer Preview */}
                    <p className="text-sm text-slate-500 line-clamp-2">
                      {chat.answer ? 
                        (chat.answer.length > 150 
                          ? chat.answer.substring(0, 150) + '...' 
                          : chat.answer
                        ) 
                        : 'No response'
                      }
                    </p>

                    {/* Metadata */}
                    <div className="flex items-center gap-3 mt-3 text-xs text-slate-400">
                      {chat.file_id && (
                        <span className="font-mono">
                          File: {chat.file_id.substring(0, 8)}
                        </span>
                      )}
                      {chat.session_id && (
                        <span className="font-mono">
                          Session: {chat.session_id.split('-')[1]?.substring(0, 6) || 'N/A'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Date */}
                  <div className="flex-shrink-0 text-right">
                    <span className="text-xs text-slate-400">
                      {formatDate(chat.created_at || chat.timestamp)}
                    </span>
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
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 hover:bg-slate-50 rounded-lg border border-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loadingMore ? (
                <span className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-600"></div>
                  Loading...
                </span>
              ) : (
                "Load older conversations"
              )}
            </button>
          </div>
        )}

        {/* No Results */}
        {searchQuery && filteredChats.length === 0 && (
          <div className="text-center py-12">
            <svg
              className="mx-auto h-12 w-12 text-slate-300 mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-slate-500 text-sm">No conversations match your search</p>
          </div>
        )}

        {/* Empty State */}
        {!loading && chats.length === 0 && (
          <div className="text-center py-12">
            <svg
              className="mx-auto h-16 w-16 text-slate-300 mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            <p className="text-slate-600 text-lg font-medium mb-2">No conversations yet</p>
            <p className="text-slate-500 text-sm">
              Start a conversation by uploading a document and asking questions
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatHistoryPage;
