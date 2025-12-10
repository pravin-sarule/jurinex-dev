// import React, { useRef } from 'react';
// import { Paperclip, Send, Loader2, BookOpen, ChevronDown, Bot, X } from 'lucide-react';

// const ChatInputArea = ({
//   fileInputRef,
//   isUploading,
//   handleFileUpload,
//   showDropdown,
//   setShowDropdown,
//   fileId,
//   processingStatus,
//   isLoading,
//   isGeneratingInsights,
//   isLoadingSecrets,
//   activeDropdown,
//   secrets,
//   handleDropdownSelect,
//   chatInput,
//   handleChatInputChange,
//   isSecretPromptSelected,
//   handleSend,
//   documentData,
//   hasResponse,
//   formatFileSize,
//   formatDate,
//   setIsSecretPromptSelected,
//   setActiveDropdown,
//   setSelectedSecretId,
//   progressPercentage,
//   getInputPlaceholder,
//   isSplitView = false,
// }) => {
//   const dropdownRef = useRef(null);

//   return (
//     <div className={isSplitView ? '' : 'flex flex-col items-center justify-center h-full w-full'}>
//       {!isSplitView && (
//         <div className="text-center max-w-2xl px-6 mb-12">
//           <h3 className="text-3xl font-bold mb-4 text-gray-900">Welcome to Smart Legal Insights</h3>
//           <p className="text-gray-600 text-xl leading-relaxed">
//             Upload a legal document or ask a question to begin your AI-powered analysis.
//           </p>
//         </div>
//       )}
      
//       <div className={isSplitView ? '' : 'w-full max-w-4xl px-6'}>
//         <form onSubmit={handleSend} className="mx-auto">
//           <div className={`flex items-center space-x-3 bg-gray-50 rounded-xl border ${isSplitView ? 'border-gray-200 px-2.5 py-2' : 'border-gray-500 px-5 py-6'} focus-within:border-[#21C1B6] focus-within:bg-white focus-within:shadow-sm analysis-input-container`}>
//             <button
//               type="button"
//               onClick={() => fileInputRef.current?.click()}
//               disabled={isUploading}
//               className={`${isSplitView ? 'p-1' : 'p-2'} text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0`}
//               title="Upload Document"
//             >
//               {isUploading ? (
//                 <Loader2 className={`${isSplitView ? 'h-3 w-3' : 'h-5 w-5'} animate-spin`} />
//               ) : (
//                 <Paperclip className={isSplitView ? 'h-3 w-3' : 'h-5 w-5'} />
//               )}
//             </button>
//             <input
//               ref={fileInputRef}
//               type="file"
//               className="hidden"
//               accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.tiff"
//               onChange={handleFileUpload}
//               disabled={isUploading}
//               multiple
//             />
//             <div className="relative flex-shrink-0" ref={dropdownRef}>
//               <button
//                 type="button"
//                 onClick={() => setShowDropdown(!showDropdown)}
//                 disabled={isLoading || isGeneratingInsights || isLoadingSecrets}
//                 className={`flex items-center space-x-2 ${isSplitView ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'} font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed`}
//               >
//                 <BookOpen className={isSplitView ? 'h-3 w-3' : 'h-4 w-4'} />
//                 <span>{isLoadingSecrets ? 'Loading...' : activeDropdown}</span>
//                 <ChevronDown className={isSplitView ? 'h-3 w-3' : 'h-4 w-4'} />
//               </button>
//               {showDropdown && !isLoadingSecrets && (
//                 <div className="absolute bottom-full left-0 mb-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto">
//                   {secrets.length > 0 ? (
//                     secrets.map((secret) => (
//                       <button
//                         key={secret.id}
//                         type="button"
//                         onClick={() => handleDropdownSelect(secret.name, secret.id, secret.llm_name)}
//                         className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg"
//                       >
//                         {secret.name}
//                       </button>
//                     ))
//                   ) : (
//                     <div className="px-4 py-2.5 text-sm text-gray-500">No analysis prompts available</div>
//                   )}
//                 </div>
//               )}
//             </div>
//             <input
//               type="text"
//               value={chatInput}
//               onChange={handleChatInputChange}
//               placeholder={getInputPlaceholder()}
//               className={`flex-1 bg-transparent border-none outline-none text-gray-900 placeholder-gray-500 ${isSplitView ? 'text-xs' : 'text-[15px]'} font-medium ${isSplitView ? 'py-1' : 'py-2'} min-w-0 analysis-page-user-input`}
//               disabled={
//                 isLoading ||
//                 isGeneratingInsights ||
//                 !fileId ||
//                 (processingStatus?.status !== 'processed' &&
//                   processingStatus?.status !== null &&
//                   progressPercentage < 100)
//               }
//             />
//             <button
//               type="submit"
//               disabled={
//                 isLoading ||
//                 isGeneratingInsights ||
//                 (!chatInput.trim() && !isSecretPromptSelected) ||
//                 !fileId ||
//                 (processingStatus && processingStatus.status !== 'processed' && progressPercentage < 100)
//               }
//               onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//               onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//               className={`${isSplitView ? 'p-1.5' : 'p-2'} bg-black hover:bg-gray-800 disabled:bg-gray-300 text-white rounded-lg transition-colors flex-shrink-0`}
//               title="Send Message"
//             >
//               {isLoading || isGeneratingInsights ? (
//                 <Loader2 className={isSplitView ? 'h-3 w-3' : 'h-5 w-5'} animate-spin />
//               ) : (
//                 <Send className={isSplitView ? 'h-3 w-3' : 'h-5 w-5'} />
//               )}
//             </button>
//           </div>
//           {isSecretPromptSelected && (
//             <div className={`mt-${isSplitView ? '1.5' : '3'} p-${isSplitView ? '1.5' : '2'} bg-[#E0F7F6] border border-[#21C1B6] rounded-lg`}>
//               <div className={`flex items-center space-x-${isSplitView ? '1.5' : '2'} text-${isSplitView ? 'xs' : 'sm'} text-[#21C1B6]`}>
//                 <Bot className={isSplitView ? 'h-3 w-3' : 'h-4 w-4'} />
//                 <span>
//                   {isSplitView ? 'Using: ' : 'Using analysis prompt: '}
//                   <strong>{activeDropdown}</strong>
//                 </span>
//                 <button
//                   type="button"
//                   onClick={() => {
//                     setIsSecretPromptSelected(false);
//                     setActiveDropdown('Custom Query');
//                     setSelectedSecretId(null);
//                   }}
//                   className="ml-auto text-[#21C1B6] hover:text-[#1AA49B]"
//                 >
//                   <X className={isSplitView ? 'h-3 w-3' : 'h-4 w-4'} />
//                 </button>
//               </div>
//             </div>
//           )}
//         </form>
//       </div>
//     </div>
//   );
// };

// export default ChatInputArea;





// import React, { useRef } from 'react';
// import { Paperclip, Send, Loader2, BookOpen, ChevronDown, Bot, X, Wrench } from 'lucide-react';

// const ChatInputArea = ({
//   fileInputRef,
//   isUploading,
//   handleFileUpload,
//   showDropdown,
//   setShowDropdown,
//   fileId,
//   processingStatus,
//   isLoading,
//   isGeneratingInsights,
//   isLoadingSecrets,
//   activeDropdown,
//   secrets,
//   handleDropdownSelect,
//   chatInput,
//   handleChatInputChange,
//   isSecretPromptSelected,
//   handleSend,
//   documentData,
//   hasResponse,
//   formatFileSize,
//   formatDate,
//   setIsSecretPromptSelected,
//   setActiveDropdown,
//   setSelectedSecretId,
//   progressPercentage,
//   getInputPlaceholder,
//   isSplitView = false,
//   showToolsDropdown,
//   setShowToolsDropdown,
//   handleMindmapClick,
// }) => {
//   const dropdownRef = useRef(null);
//   const toolsDropdownRef = useRef(null);

//   return (
//     <div className={isSplitView ? '' : 'flex flex-col items-center justify-center h-full w-full'}>
//       {!isSplitView && (
//         <div className="text-center max-w-2xl px-6 mb-12">
//           <h3 className="text-3xl font-bold mb-4 text-gray-900">Welcome to Smart Legal Insights</h3>
//           <p className="text-gray-600 text-xl leading-relaxed">
//             Upload a legal document or ask a question to begin your AI-powered analysis.
//           </p>
//         </div>
//       )}
      
//       <div className={isSplitView ? '' : 'w-full max-w-4xl px-6'}>
//         <form onSubmit={handleSend} className="mx-auto">
//           <div className={`flex items-center space-x-3 bg-gray-50 rounded-xl border ${isSplitView ? 'border-gray-200 px-2.5 py-2' : 'border-gray-500 px-5 py-6'} focus-within:border-[#21C1B6] focus-within:bg-white focus-within:shadow-sm analysis-input-container`}>
//             <button
//               type="button"
//               onClick={() => fileInputRef.current?.click()}
//               disabled={isUploading}
//               className={`${isSplitView ? 'p-1' : 'p-2'} text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0`}
//               title="Upload Document"
//             >
//               {isUploading ? (
//                 <Loader2 className={`${isSplitView ? 'h-3 w-3' : 'h-5 w-5'} animate-spin`} />
//               ) : (
//                 <Paperclip className={isSplitView ? 'h-3 w-3' : 'h-5 w-5'} />
//               )}
//             </button>
//             <input
//               ref={fileInputRef}
//               type="file"
//               className="hidden"
//               accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.tiff"
//               onChange={handleFileUpload}
//               disabled={isUploading}
//               multiple
//             />
//             <div className="relative flex-shrink-0" ref={dropdownRef}>
//               <button
//                 type="button"
//                 onClick={() => setShowDropdown(!showDropdown)}
//                 disabled={isLoading || isGeneratingInsights || isLoadingSecrets}
//                 className={`flex items-center space-x-2 ${isSplitView ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'} font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed`}
//               >
//                 <BookOpen className={isSplitView ? 'h-3 w-3' : 'h-4 w-4'} />
//                 <span>{isLoadingSecrets ? 'Loading...' : activeDropdown}</span>
//                 <ChevronDown className={isSplitView ? 'h-3 w-3' : 'h-4 w-4'} />
//               </button>
//               {showDropdown && !isLoadingSecrets && (
//                 <div className="absolute bottom-full left-0 mb-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto">
//                   {secrets.length > 0 ? (
//                     secrets.map((secret) => (
//                       <button
//                         key={secret.id}
//                         type="button"
//                         onClick={() => handleDropdownSelect(secret.name, secret.id, secret.llm_name)}
//                         className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg"
//                       >
//                         {secret.name}
//                       </button>
//                     ))
//                   ) : (
//                     <div className="px-4 py-2.5 text-sm text-gray-500">No analysis prompts available</div>
//                   )}
//                 </div>
//               )}
//             </div>
//             <div className="relative flex-shrink-0" ref={toolsDropdownRef}>
//               <button
//                 type="button"
//                 onClick={() => setShowToolsDropdown(!showToolsDropdown)}
//                 disabled={isLoading || isGeneratingInsights || !fileId}
//                 className={`flex items-center space-x-2 ${isSplitView ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'} font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed`}
//                 title="Tools"
//               >
//                 <Wrench className={isSplitView ? 'h-3 w-3' : 'h-4 w-4'} />
//                 <span>Tools</span>
//                 <ChevronDown className={isSplitView ? 'h-3 w-3' : 'h-4 w-4'} />
//               </button>
//               {showToolsDropdown && (
//                 <div className="absolute bottom-full left-0 mb-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20">
//                   <button
//                     type="button"
//                     onClick={() => {
//                       handleMindmapClick();
//                       setShowToolsDropdown(false);
//                     }}
//                     className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg"
//                   >
//                     Mindmap
//                   </button>
//                 </div>
//               )}
//             </div>
//             <input
//               type="text"
//               value={chatInput}
//               onChange={handleChatInputChange}
//               placeholder={getInputPlaceholder()}
//               className={`flex-1 bg-transparent border-none outline-none text-gray-900 placeholder-gray-500 ${isSplitView ? 'text-xs' : 'text-[15px]'} font-medium ${isSplitView ? 'py-1' : 'py-2'} min-w-0 analysis-page-user-input`}
//               disabled={
//                 isLoading ||
//                 isGeneratingInsights ||
//                 !fileId ||
//                 (processingStatus?.status !== 'processed' &&
//                   processingStatus?.status !== null &&
//                   progressPercentage < 100)
//               }
//             />
//             <button
//               type="submit"
//               disabled={
//                 isLoading ||
//                 isGeneratingInsights ||
//                 (!chatInput.trim() && !isSecretPromptSelected) ||
//                 !fileId ||
//                 (processingStatus && processingStatus.status !== 'processed' && progressPercentage < 100)
//               }
//               onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//               onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//               className={`${isSplitView ? 'p-1.5' : 'p-2'} bg-black hover:bg-gray-800 disabled:bg-gray-300 text-white rounded-lg transition-colors flex-shrink-0`}
//               title="Send Message"
//             >
//               {isLoading || isGeneratingInsights ? (
//                 <Loader2 className={isSplitView ? 'h-3 w-3' : 'h-5 w-5'} animate-spin />
//               ) : (
//                 <Send className={isSplitView ? 'h-3 w-3' : 'h-5 w-5'} />
//               )}
//             </button>
//           </div>
//           {isSecretPromptSelected && (
//             <div className={`mt-${isSplitView ? '1.5' : '3'} p-${isSplitView ? '1.5' : '2'} bg-[#E0F7F6] border border-[#21C1B6] rounded-lg`}>
//               <div className={`flex items-center space-x-${isSplitView ? '1.5' : '2'} text-${isSplitView ? 'xs' : 'sm'} text-[#21C1B6]`}>
//                 <Bot className={isSplitView ? 'h-3 w-3' : 'h-4 w-4'} />
//                 <span>
//                   {isSplitView ? 'Using: ' : 'Using analysis prompt: '}
//                   <strong>{activeDropdown}</strong>
//                 </span>
//                 <button
//                   type="button"
//                   onClick={() => {
//                     setIsSecretPromptSelected(false);
//                     setActiveDropdown('Custom Query');
//                     setSelectedSecretId(null);
//                   }}
//                   className="ml-auto text-[#21C1B6] hover:text-[#1AA49B]"
//                 >
//                   <X className={isSplitView ? 'h-3 w-3' : 'h-4 w-4'} />
//                 </button>
//               </div>
//             </div>
//           )}
//         </form>
//       </div>
//     </div>
//   );
// };

// export default ChatInputArea;







import React, { useRef } from 'react';
import { Paperclip, Send, Loader2, BookOpen, ChevronDown, Bot, X, Wrench } from 'lucide-react';

const ChatInputArea = ({
  fileInputRef,
  isUploading,
  handleFileUpload,
  showDropdown,
  setShowDropdown,
  fileId,
  processingStatus,
  isLoading,
  isGeneratingInsights,
  isLoadingSecrets,
  activeDropdown,
  secrets,
  handleDropdownSelect,
  chatInput,
  handleChatInputChange,
  isSecretPromptSelected,
  handleSend,
  documentData,
  hasResponse,
  formatFileSize,
  formatDate,
  setIsSecretPromptSelected,
  setActiveDropdown,
  setSelectedSecretId,
  progressPercentage,
  getInputPlaceholder,
  isSplitView = false,
  showToolsDropdown,
  setShowToolsDropdown,
  handleMindmapClick,
}) => {
  const dropdownRef = useRef(null);
  const toolsDropdownRef = useRef(null);

  return (
    <div className={isSplitView ? '' : 'flex flex-col items-center justify-center h-full w-full'}>
      {!isSplitView && (
        <div className="text-center max-w-2xl px-6 mb-12">
          <h3 className="text-3xl font-bold mb-4 text-gray-900">Welcome to Smart Legal Insights</h3>
          <p className="text-gray-600 text-xl leading-relaxed">
            Upload a legal document or ask a question to begin your AI-powered analysis.
          </p>
        </div>
      )}
      
      <div className={isSplitView ? '' : 'w-full max-w-4xl px-6'}>
        <form onSubmit={handleSend} className="mx-auto">
          <div className={`flex items-center space-x-3 bg-gray-50 rounded-xl border ${isSplitView ? 'border-gray-200 px-2.5 py-2' : 'border-gray-500 px-5 py-6'} focus-within:border-[#21C1B6] focus-within:bg-white focus-within:shadow-sm analysis-input-container`}>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className={`${isSplitView ? 'p-1' : 'p-2'} text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0`}
              title="Upload Document"
            >
              {isUploading ? (
                <Loader2 className={`${isSplitView ? 'h-3 w-3' : 'h-5 w-5'} animate-spin`} />
              ) : (
                <Paperclip className={isSplitView ? 'h-3 w-3' : 'h-5 w-5'} />
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.tiff"
              onChange={handleFileUpload}
              disabled={isUploading}
              multiple
            />
            <div className="relative flex-shrink-0" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setShowDropdown(!showDropdown)}
                disabled={isLoading || isGeneratingInsights || isLoadingSecrets}
                className={`flex items-center space-x-2 ${isSplitView ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'} font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <BookOpen className={isSplitView ? 'h-3 w-3' : 'h-4 w-4'} />
                <span>{isLoadingSecrets ? 'Loading...' : activeDropdown}</span>
                <ChevronDown className={isSplitView ? 'h-3 w-3' : 'h-4 w-4'} />
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
                    <div className="px-4 py-2.5 text-sm text-gray-500">No analysis prompts available</div>
                  )}
                </div>
              )}
            </div>
            <div className="relative flex-shrink-0" ref={toolsDropdownRef}>
              <button
                type="button"
                onClick={() => setShowToolsDropdown(!showToolsDropdown)}
                disabled={isLoading || isGeneratingInsights || !fileId}
                className={`flex items-center space-x-2 ${isSplitView ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'} font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed`}
                title="Tools"
              >
                <Wrench className={isSplitView ? 'h-3 w-3' : 'h-4 w-4'} />
                <span>Tools</span>
                <ChevronDown className={isSplitView ? 'h-3 w-3' : 'h-4 w-4'} />
              </button>
              {showToolsDropdown && (
                <div className="absolute bottom-full left-0 mb-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20">
                  <button
                    type="button"
                    onClick={() => {
                      handleMindmapClick();
                      setShowToolsDropdown(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg"
                  >
                    Mindmap
                  </button>
                </div>
              )}
            </div>
            <input
              type="text"
              value={chatInput}
              onChange={handleChatInputChange}
              placeholder={getInputPlaceholder()}
              className={`flex-1 bg-transparent border-none outline-none text-gray-900 placeholder-gray-500 ${isSplitView ? 'text-xs' : 'text-[15px]'} font-medium ${isSplitView ? 'py-1' : 'py-2'} min-w-0 analysis-page-user-input`}
              disabled={
                isLoading ||
                isGeneratingInsights ||
                !fileId ||
                (processingStatus?.status !== 'processed' &&
                  processingStatus?.status !== null &&
                  progressPercentage < 100)
              }
            />
            <button
              type="submit"
              disabled={
                isLoading ||
                isGeneratingInsights ||
                (!chatInput.trim() && !isSecretPromptSelected) ||
                !fileId ||
                (processingStatus && processingStatus.status !== 'processed' && progressPercentage < 100)
              }
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
              className={`${isSplitView ? 'p-1.5' : 'p-2'} bg-black hover:bg-gray-800 disabled:bg-gray-300 text-white rounded-lg transition-colors flex-shrink-0`}
              title="Send Message"
            >
              {isLoading || isGeneratingInsights ? (
                <Loader2 className={isSplitView ? 'h-3 w-3' : 'h-5 w-5'} animate-spin />
              ) : (
                <Send className={isSplitView ? 'h-3 w-3' : 'h-5 w-5'} />
              )}
            </button>
          </div>
          {isSecretPromptSelected && (
            <div className={`mt-${isSplitView ? '1.5' : '3'} p-${isSplitView ? '1.5' : '2'} bg-[#E0F7F6] border border-[#21C1B6] rounded-lg`}>
              <div className={`flex items-center space-x-${isSplitView ? '1.5' : '2'} text-${isSplitView ? 'xs' : 'sm'} text-[#21C1B6]`}>
                <Bot className={isSplitView ? 'h-3 w-3' : 'h-4 w-4'} />
                <span>
                  {isSplitView ? 'Using: ' : 'Using analysis prompt: '}
                  <strong>{activeDropdown}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setIsSecretPromptSelected(false);
                    setActiveDropdown('Custom Query');
                    setSelectedSecretId(null);
                  }}
                  className="ml-auto text-[#21C1B6] hover:text-[#1AA49B]"
                >
                  <X className={isSplitView ? 'h-3 w-3' : 'h-4 w-4'} />
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

export default ChatInputArea;






