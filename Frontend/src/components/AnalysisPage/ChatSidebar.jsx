import React from 'react';
import {
  Search, FileText, Loader2, ChevronRight, MessageSquare, CheckCircle, Clock, AlertCircle
} from 'lucide-react';
import ChatInputPanel from './ChatInputPanel';

const ChatSidebar = ({
  messages,
  searchQuery,
  setSearchQuery,
  startNewChat,
  uploadedDocuments,
  fileId,
  setFileId,
  setDocumentData,
  startProcessingStatusPolling,
  formatFileSize,
  formatTime,
  displayLimit,
  showAllChats,
  setShowAllChats,
  handleMessageClick,
  selectedMessageId,
  isLoading,
  formatDate,
  fileInputRef,
  isUploading,
  handleFileUpload,
  showDropdown,
  setShowDropdown,
  processingStatus,
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
  setIsSecretPromptSelected,
  setActiveDropdown,
  setSelectedSecretId
}) => {
  
  const highlightText = (text, query) => {
    if (!query || !text) return text;
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <span key={i} className="bg-yellow-200 font-semibold text-black">
          {part}
        </span>
      ) : (
        part
      )
    );
  };

  return (
    <div className="w-2/5 border-r border-gray-200 flex flex-col bg-white h-full overflow-y-auto">
      {/* Fixed Header */}
      <div className="p-4 border-b border-gray-200 flex-shrink-0 bg-white">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900">Questions</h2>
          <button
            onClick={startNewChat}
            className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
          >
            New Chat
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search questions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-gray-100 rounded-lg text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Scrollable Messages List */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        <div className="space-y-2">
          {messages
            .filter(msg =>
              (msg.display_text_left_panel || msg.question || '').toLowerCase().includes(searchQuery.toLowerCase())
            )
            .slice(0, showAllChats ? messages.length : displayLimit)
            .map((msg, i) => (
              <div
                key={msg.id || i}
                onClick={() => handleMessageClick(msg)}
                className={`p-3 rounded-lg border cursor-pointer transition-all duration-200 hover:shadow-md ${
                  selectedMessageId === msg.id
                    ? 'bg-blue-50 border-blue-200 shadow-sm'
                    : 'bg-white border-gray-200 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 mb-1 line-clamp-2">
                      {highlightText(msg.display_text_left_panel || msg.question, searchQuery)}
                    </p>
                    <div className="flex items-center space-x-2 text-xs text-gray-500">
                      <span>{formatDate(msg.timestamp || msg.created_at)}</span>
                      {msg.session_id && (
                        <>
                          <span>•</span>
                          <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                            {msg.session_id.split('-')[1]?.substring(0, 8) || 'N/A'}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  {selectedMessageId === msg.id && (
                    <ChevronRight className="h-4 w-4 text-blue-600 flex-shrink-0 ml-2" />
                  )}
                </div>
              </div>
            ))}

          {messages.length > displayLimit && !showAllChats && (
            <div className="text-center py-4">
              <button
                onClick={() => setShowAllChats(true)}
                className="px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
              >
                See All ({messages.length - displayLimit} more)
              </button>
            </div>
          )}
         
          {isLoading && (
            <div className="p-3 rounded-lg border bg-blue-50 border-blue-200">
              <div className="flex items-center space-x-2">
                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                <span className="text-sm text-blue-800">Processing...</span>
              </div>
            </div>
          )}
         
          {messages.length === 0 && !isLoading && (
            <div className="text-center py-8">
              <MessageSquare className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p className="text-gray-500 text-sm">No questions yet</p>
              <p className="text-gray-400 text-xs">Start by asking a question</p>
            </div>
          )}
        </div>
      </div>

      {/* Uploaded Documents - Above Input */}
      {uploadedDocuments.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-200 bg-gray-50 flex-shrink-0 max-h-[140px] overflow-y-auto">
          <h3 className="text-xs font-semibold text-gray-700 mb-2 flex items-center">
            <FileText className="h-3 w-3 mr-1" />
            Uploaded ({uploadedDocuments.length})
          </h3>
          <div className="space-y-1.5">
            {uploadedDocuments.map((doc) => (
              <div
                key={doc.id}
                onClick={() => {
                  setFileId(doc.id);
                  setDocumentData({
                    id: doc.id,
                    title: doc.fileName,
                    originalName: doc.fileName,
                    size: doc.fileSize,
                    type: 'unknown',
                    uploadedAt: doc.uploadedAt,
                    status: doc.status,
                  });
                  if (doc.status !== 'processed') {
                    startProcessingStatusPolling(doc.id);
                  }
                }}
                className={`p-2 rounded-md cursor-pointer transition-all ${
                  fileId === doc.id
                    ? 'bg-blue-100 border border-blue-300'
                    : 'bg-white border border-gray-200 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-900 truncate">{doc.fileName}</p>
                    <p className="text-xs text-gray-500">{formatFileSize(doc.fileSize)}</p>
                  </div>

                  {/* Status Icon and Progress */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {(doc.status === 'processing' || doc.status === 'batch_processing' || doc.status === 'batch_queued' || doc.status === 'queued') && (
                      <div className="flex items-center gap-1">
                        <div className="relative w-8 h-8">
                          <svg className="w-8 h-8 transform -rotate-90">
                            <circle
                              cx="16"
                              cy="16"
                              r="14"
                              stroke="currentColor"
                              strokeWidth="3"
                              fill="none"
                              className="text-gray-200"
                            />
                            <circle
                              cx="16"
                              cy="16"
                              r="14"
                              stroke="currentColor"
                              strokeWidth="3"
                              fill="none"
                              strokeDasharray={`${2 * Math.PI * 14}`}
                              strokeDashoffset={`${2 * Math.PI * 14 * (1 - (doc.processingProgress || 0) / 100)}`}
                              className="text-blue-600 transition-all duration-500"
                            />
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-xs font-semibold text-blue-600">{Math.round(doc.processingProgress || 0)}%</span>
                          </div>
                        </div>
                        <div className="text-xs text-gray-600">
                          <Clock className="h-3 w-3 inline mr-0.5" />
                          <span>{formatTime(doc.estimatedTime)}</span>
                        </div>
                      </div>
                    )}
                    {doc.status === 'processed' && (
                      <CheckCircle className="h-5 w-5 text-green-600" />
                    )}
                    {doc.status === 'error' && (
                      <AlertCircle className="h-5 w-5 text-red-600" />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fixed Input Panel at Bottom */}
      <div className="border-t border-gray-200 p-3 bg-white flex-shrink-0" style={{ position: 'sticky', bottom: 0 }}>
        <ChatInputPanel
          fileInputRef={fileInputRef}
          isUploading={isUploading}
          handleFileUpload={handleFileUpload}
          showDropdown={showDropdown}
          setShowDropdown={setShowDropdown}
          fileId={fileId}
          processingStatus={processingStatus}
          isLoading={isLoading}
          isGeneratingInsights={isGeneratingInsights}
          isLoadingSecrets={isLoadingSecrets}
          activeDropdown={activeDropdown}
          secrets={secrets}
          handleDropdownSelect={handleDropdownSelect}
          chatInput={chatInput}
          handleChatInputChange={handleChatInputChange}
          isSecretPromptSelected={isSecretPromptSelected}
          handleSend={handleSend}
          documentData={documentData}
          hasResponse={true}
          formatFileSize={formatFileSize}
          formatDate={formatDate}
          setIsSecretPromptSelected={setIsSecretPromptSelected}
          setActiveDropdown={setActiveDropdown}
          setSelectedSecretId={setSelectedSecretId}
          isSplitView={true}
        />
      </div>
    </div>
  );
};

export default ChatSidebar;