import React, { useEffect, useState, useRef } from "react";
import documentApi from "../../services/documentApi"; // Corrected import path
import { Trash2, MoreVertical } from "lucide-react";
import { toast } from "react-toastify";

const ChatCardList = ({ folderName, onSelectChat }) => {
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openMenuId, setOpenMenuId] = useState(null);
  const menuRefs = useRef({});

  const loadChats = async () => {
    if (!folderName) return;
    try {
      setLoading(true);
      const data = await documentApi.getFolderChats(folderName);
      console.log("Chats fetched by ChatCardList:", data); // Added logging
      // backend returns { success, folderName, chats }
      setChats(data.chats || []);
    } catch (err) {
      console.error("❌ Error fetching chats:", err.message);
      setChats([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (folderName) {
      loadChats();
    }
  }, [folderName]);

  const handleDeleteChat = async (chatId, e) => {
    if (e) {
      e.stopPropagation(); // Prevent triggering the onClick for the card
    }
    
    setOpenMenuId(null); // Close the menu
    
    if (!window.confirm('Are you sure you want to delete this chat? This action cannot be undone.')) {
      return;
    }

    try {
      // Use toast.promise for async operation
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
      // Reload chats after deletion
      loadChats();
    } catch (err) {
      console.error("❌ Error deleting chat:", err);
      // Error is handled by toast.promise
    }
  };

  const handleMenuToggle = (chatId, e) => {
    e.stopPropagation(); // Prevent triggering the onClick for the card
    setOpenMenuId(openMenuId === chatId ? null : chatId);
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openMenuId && menuRefs.current[openMenuId]) {
        if (!menuRefs.current[openMenuId].contains(event.target)) {
          setOpenMenuId(null);
        }
      }
    };

    if (openMenuId) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [openMenuId]);

  if (loading) {
    return <p className="text-gray-400 text-center p-8">Loading chats...</p>;
  }

  if (!chats || chats.length === 0) {
    return <p className="text-gray-400 text-center p-8">No chat conversations found.</p>;
  }

  return (
    <div className="space-y-3">
      {chats.map((chat) => (
        <div
          key={chat.id}
          className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors duration-200 relative group"
          onClick={() => onSelectChat(chat.id)}
        >
          <div className={`absolute top-2 right-2 z-10 transition-opacity duration-200 ${openMenuId === chat.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} ref={(el) => (menuRefs.current[chat.id] = el)}>
            <button
              onClick={(e) => handleMenuToggle(chat.id, e)}
              className="p-1.5 rounded-full hover:bg-gray-100 text-gray-600 transition-colors duration-200 flex items-center justify-center"
              title="More options"
              type="button"
            >
              <MoreVertical className="w-5 h-5" />
            </button>
            {openMenuId === chat.id && (
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
          <h4 className="text-sm font-semibold text-gray-800 mb-1 pr-10">
            {chat.question?.slice(0, 40) || `Chat ${chat.id.substring(0, 8)}`}
          </h4>
          <p className="text-xs text-gray-500">
            {chat.created_at
              ? `Last message ${new Date(chat.created_at).toLocaleString()}`
              : "Last message N/A"}
          </p>
        </div>
      ))}
    </div>
  );
};

export default ChatCardList;