// import React, { useState } from 'react';
// import { BookOpen, ChevronDown } from 'lucide-react';

// const ChatInput = ({
//   onSendMessage,
//   disabled,
//   activeDropdown,
//   setActiveDropdown,
//   showDropdown,
//   setShowDropdown,
//   secrets,
//   isLoadingSecrets,
//   selectedSecretId,
//   handleDropdownSelect,
//   isSecretPromptSelected,
//   setIsSecretPromptSelected,
//   handleChatInputChange,
//   dropdownRef,
// }) => {
//   const [message, setMessage] = useState('');

//   const handleSubmit = (e) => {
//     e.preventDefault();
//     if (isSecretPromptSelected && selectedSecretId) {
//       onSendMessage('', true); // Send empty message, signal it's a secret prompt
//     } else if (message.trim() && !disabled) {
//       onSendMessage(message, false);
//       setMessage('');
//     }
//   };

//   const onMessageChange = (e) => {
//     setMessage(e.target.value);
//     handleChatInputChange(); // Notify parent about chat input change
//   };

//   return (
//     <form onSubmit={handleSubmit} className="flex items-center space-x-3 bg-white rounded-xl border border-gray-200 px-4 py-3 focus-within:border-blue-300 focus-within:shadow-sm">
//       {/* Analysis Dropdown */}
//       <div className="relative flex-shrink-0" ref={dropdownRef}>
//         <button
//           type="button"
//           onClick={() => setShowDropdown(!showDropdown)}
//           disabled={disabled || isLoadingSecrets}
//           className="flex items-center space-x-2 px-2.5 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
//         >
//           <BookOpen className="h-3.5 w-3.5" />
//           <span>{isLoadingSecrets ? 'Loading...' : activeDropdown}</span>
//           <ChevronDown className="h-3.5 w-3.5" />
//         </button>

//         {showDropdown && !isLoadingSecrets && (
//           <div className="absolute bottom-full left-0 mb-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto">
//             {secrets.length > 0 ? (
//               secrets.map((secret) => (
//                 <button
//                   key={secret.id}
//                   type="button"
//                   onClick={() => handleDropdownSelect(secret.name, secret.id)}
//                   className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg"
//                 >
//                   {secret.name}
//                 </button>
//               ))
//             ) : (
//               <div className="px-4 py-2.5 text-sm text-gray-500">
//                 No analysis prompts available
//               </div>
//             )}
//           </div>
//         )}
//       </div>

//       <input
//         type="text"
//         className="flex-grow bg-transparent border-none outline-none text-gray-900 placeholder-gray-500 text-sm font-medium py-1 min-w-0"
//         value={message}
//         onChange={onMessageChange}
//         placeholder={disabled ? "Select a folder to chat" : "Ask a question about the documents..."}
//         disabled={disabled || isSecretPromptSelected}
//       />
//       <button
//         type="submit"
//         className="p-1.5 bg-black hover:bg-gray-800 disabled:bg-gray-300 text-white rounded-lg transition-colors flex-shrink-0"
//         disabled={disabled || (!message.trim() && !isSecretPromptSelected)}
//       >
//         Send
//       </button>
//     </form>
//   );
// };

// export default ChatInput;


import React, { useState } from 'react';
import { BookOpen, ChevronDown } from 'lucide-react';

const ChatInput = ({
  onSendMessage,
  disabled,
  activeDropdown,
  setActiveDropdown,
  showDropdown,
  setShowDropdown,
  secrets,
  isLoadingSecrets,
  selectedSecretId,
  handleDropdownSelect,
  isSecretPromptSelected,
  setIsSecretPromptSelected,
  handleChatInputChange,
  dropdownRef,
}) => {
  const [message, setMessage] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isSecretPromptSelected && selectedSecretId) {
      onSendMessage('', true); // Send empty message, signal it's a secret prompt
    } else if (message.trim() && !disabled) {
      onSendMessage(message, false);
      setMessage('');
    }
  };

  const onMessageChange = (e) => {
    setMessage(e.target.value);
    handleChatInputChange(); // Notify parent about chat input change
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center space-x-3 bg-white rounded-xl border border-[#21C1B6] px-4 py-3 focus-within:ring-[#21C1B6] focus-within:shadow-sm">
      {/* Analysis Dropdown */}
      <div className="relative flex-shrink-0" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setShowDropdown(!showDropdown)}
          disabled={disabled || isLoadingSecrets}
          className="flex items-center space-x-2 px-2.5 py-1.5 text-xs font-medium text-gray-700 bg-white border border-[#21C1B6] rounded-lg hover:bg-[#1AA49B] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <BookOpen className="h-3.5 w-3.5" />
          <span>{isLoadingSecrets ? 'Loading...' : activeDropdown}</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>

        {showDropdown && !isLoadingSecrets && (
          <div className="absolute bottom-full left-0 mb-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto">
            {secrets.length > 0 ? (
              secrets.map((secret) => (
                <button
                  key={secret.id}
                  type="button"
                  onClick={() => handleDropdownSelect(secret.name, secret.id)}
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
        className="flex-grow bg-transparent border-none outline-none text-gray-900 placeholder-gray-500 text-sm font-medium py-1 min-w-0"
        value={message}
        onChange={onMessageChange}
        placeholder={disabled ? "Select a folder to chat" : "Ask a question about the documents..."}
        disabled={disabled || isSecretPromptSelected}
      />
      <button
        type="submit"
        className="p-1.5 bg-black hover:bg-gray-800 disabled:bg-gray-300 text-white rounded-lg transition-colors flex-shrink-0"
        disabled={disabled || (!message.trim() && !isSecretPromptSelected)}
      >
        Send
      </button>
    </form>
  );
};

export default ChatInput;



