import React from 'react';

const ChatSessionList = ({ sessions, selectedSessionId, onSelectSession, onDeleteSession }) => {
  return (
    <div className="space-y-2">
      {sessions.length === 0 ? (
        <p className="text-gray-400 text-sm">No chat sessions yet. Start a new query!</p>
      ) : (
        sessions.map((session) => (
          <div
            key={session.sessionId}
            className={`flex items-center justify-between p-3 rounded-md cursor-pointer transition-colors duration-200
              ${selectedSessionId === session.sessionId ? 'bg-blue-700' : 'hover:bg-gray-700'}`}
            onClick={() => onSelectSession(session.sessionId)}
          >
            <span className="font-medium text-sm flex-grow truncate">
              {session.messages[0]?.question || `Session ${session.sessionId.substring(0, 8)}...`}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeleteSession(session.sessionId);
              }}
              className="ml-2 text-red-400 hover:text-red-300 p-1 rounded-full hover:bg-gray-600"
              title="Delete session"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </button>
          </div>
        ))
      )}
    </div>
  );
};

export default ChatSessionList;