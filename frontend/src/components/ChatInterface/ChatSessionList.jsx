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
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;
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
      <div className="flex flex-col items-center justify-center h-full text-center pt-16 px-4">
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center mb-3"
          style={{ background: '#f0fdfb' }}>
          <MessageSquare className="h-5 w-5" style={{ color: '#21C1B6' }} />
        </div>
        <p className="text-gray-600 text-xs font-semibold">No sessions yet</p>
        <p className="text-gray-400 text-xs mt-1 leading-relaxed">
          Ask a question to start your first chat.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-1 pb-4">
      {sessions.map((session, index) => {
        const isSelected = selectedSessionId === session.sessionId;
        const sessionName = session.title && session.title !== "Untitled session"
          ? session.title
          : `Session ${index + 1}`;

        return (
          <div
            key={session.sessionId}
            onClick={() => onSelectSession(session.sessionId)}
            className={`group relative flex items-start justify-between gap-2 px-3 py-3 cursor-pointer rounded-xl transition-all ${
              isSelected
                ? "shadow-sm"
                : "hover:bg-white hover:shadow-sm"
            }`}
            style={isSelected ? { background: '#fff', boxShadow: '0 1px 6px rgba(33,193,182,0.12)', border: '1px solid #21C1B620' } : { border: '1px solid transparent' }}
          >
            {isSelected && (
              <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full" style={{ background: '#21C1B6' }} />
            )}
            <div className="min-w-0 flex-1 pl-1">
              <p className={`text-xs font-semibold leading-5 line-clamp-2 ${isSelected ? 'text-gray-900' : 'text-gray-600'}`}>
                {sessionName}
              </p>
              <div className="flex items-center gap-1 mt-1">
                <Clock className="h-2.5 w-2.5 text-gray-300 flex-shrink-0" />
                <p className="text-[10px] text-gray-400">
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
              className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all p-1 flex-shrink-0 rounded-lg hover:bg-red-50"
              title="Delete session"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default ChatSessionList;
