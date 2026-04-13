import React from "react";
import { MessageSquare, Trash2, Clock } from "lucide-react";

const formatRelativeTime = (value) => {
  if (!value) return "No recent messages";

  try {
    const date = new Date(value);
    const now = new Date();
    const diffInSeconds = Math.max(0, Math.floor((now - date) / 1000));

    if (diffInSeconds < 60) return "Just now";

    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) {
      return `${diffInMinutes}m ago`;
    }

    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) {
      return `${diffInHours}h ago`;
    }

    const diffInDays = Math.floor(diffInHours / 24);
    return `${diffInDays}d ago`;
  } catch {
    return "Recently";
  }
};

const ChatSessionList = ({
  sessions,
  selectedSessionId,
  onSelectSession,
  onDeleteSession,
}) => {
  if (!sessions.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center pt-20">
        <MessageSquare className="h-10 w-10 mb-3 text-gray-200" />
        <p className="text-gray-500 text-sm font-medium">No chat sessions yet</p>
        <p className="text-gray-400 text-sm mt-1">
          Ask a question to start your first session.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-2 pb-4">
      {sessions.map((session, index) => {
        const isSelected = selectedSessionId === session.sessionId;
        // Use session title (first user question) as the session name
        const sessionName = session.title && session.title !== "Untitled session"
          ? session.title
          : `Session ${index + 1}`;

        return (
          <div
            key={session.sessionId}
            onClick={() => onSelectSession(session.sessionId)}
            className={`group flex items-start justify-between gap-3 px-4 py-4 cursor-pointer rounded-xl transition-all border ${
              isSelected
                ? "bg-[#E8F8F7] border-[#21C1B6] shadow-sm"
                : "bg-white border-gray-100 hover:bg-[#F5FBFB] hover:border-[#21C1B6]/40 hover:shadow-sm"
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isSelected ? 'bg-[#21C1B6]' : 'bg-gray-300'}`} />
                <p className={`text-[14px] leading-5 font-semibold truncate ${isSelected ? 'text-[#11766f]' : 'text-gray-800'}`}>
                  {sessionName}
                </p>
              </div>
              <div className="flex items-center gap-1.5 pl-3.5">
                <Clock className="h-3 w-3 text-gray-400 flex-shrink-0" />
                <p className="text-xs text-gray-400">
                  {formatRelativeTime(session.lastMessageAt)}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onDeleteSession(session.sessionId);
              }}
              className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all p-1 flex-shrink-0 mt-1"
              title="Delete session"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default ChatSessionList;
