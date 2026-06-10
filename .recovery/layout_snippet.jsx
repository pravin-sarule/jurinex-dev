        <div className="flex h-full min-h-0 w-full overflow-hidden bg-white">
          {hasSessions && chatHistorySidebarOpen && (
            <div
              className="flex-shrink-0 flex flex-col border-r border-gray-100"
              style={{ width: '272px', height: '100%', background: '#fafafa' }}
            >
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2 bg-white">
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2 min-w-0">
                  <MessageSquare className="w-3.5 h-3.5 text-[#21C1B6] flex-shrink-0" />
                  <span className="truncate">Chat History</span>
                </h3>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    type="button"
                    onClick={startNewChat}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white"
                    style={{ background: '#21C1B6' }}
                    title="Start New Chat"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>New Chat</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setChatHistorySidebarOpen(false)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
                    title="Hide chat history"
                    aria-label="Hide chat history"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 scrollbar-custom">
                {isLoadingSessions ? (
                  <div className="flex justify-center py-10">
                    <Loader2 className="h-6 w-6 animate-spin text-[#21C1B6]" />
                  </div>
                ) : (
                  <ChatSessionList
                    sessions={sidebarSessions}
                    selectedSessionId={sessionId}
                    onSelectSession={handleSelectChatSession}
                    onDeleteSession={() => {}}
                  />
                )}
              </div>
            </div>
          )}
          {hasSessions && !chatHistorySidebarOpen && (
            <div className="flex-shrink-0 flex flex-col items-center border-r border-gray-100 bg-white w-10 py-3 gap-2">
              <button
                type="button"
                onClick={() => setChatHistorySidebarOpen(true)}
                className="p-2 rounded-xl hover:bg-gray-50 text-gray-400 hover:text-[#21C1B6] transition-colors"
                title="Show chat history"
                aria-label="Show chat history"
              >
                <MessageSquare className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="flex flex-1 min-w-0 flex-col h-full overflow-hidden bg-white">
            <div className="flex items-center justify-between px-5 py-2.5 border-b border-gray-100 flex-shrink-0 bg-white">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-1.5 h-4 rounded-full flex-shrink-0" style={{ background: '#21C1B6' }} />
                <span className="text-xs font-semibold text-gray-600 truncate">
                  {documentData?.originalName
                    || (sessionMessages.length > 0
                      ? generateSessionName(sessionMessages[0]?.display_text_left_panel || sessionMessages[0]?.question || '')
                      : 'New Conversation')}
                </span>
              </div>
              <button
                onClick={startNewChat}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white flex-shrink-0"
                style={{ background: '#21C1B6' }}
              >
                <Plus className="w-3.5 h-3.5" />
                New Chat
              </button>
            </div>

            <div
              ref={learningModeActive ? learningThreadRef : chatThreadRef}
              className={`flex-1 overflow-y-auto py-8 scrollbar-custom bg-white ${learningModeActive ? 'learning-chat-thread px-5' : 'px-8'}`}
            >
              <div
                style={{
                  maxWidth: learningModeActive ? '620px' : 'min(880px, 100%)',
                  margin: '0 auto',
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: learningModeActive ? undefined : '32px',
                }}
              >
                {learningModeActive ? (
                  <>
                    {sessionMessages.length === 0 && (
                      <div className="learning-thread-empty">
                        <Sparkles className="h-6 w-6 text-[#21C1B6] mb-2" />
                        <p className="text-sm text-gray-500">Ask a question about the document to start learning.</p>
                      </div>
                    )}
                    {sessionMessages.map((msg) => (
                      <div key={msg.id} className="learning-thread-item">
                        {msg.question && (
                          <div className="learning-user-bubble">
                            <p className="learning-user-text">{msg.display_text_left_panel || msg.question}</p>
                          </div>
                        )}
                        <div className="learning-ai-bubble">
                          {msg.learning_payload ? (
                            <LearningBubble
                              payload={msg.learning_payload}
                              isStreaming={msg.isStreaming && (isLoading || isGeneratingInsights)}
                              onOptionSelect={handleLearningOptionSelect}
                            />
                          ) : msg.isStreaming ? (
                            <div className="learning-thinking-indicator">
                              <Loader2 className="h-4 w-4 animate-spin text-[#21C1B6]" />
                              <span>{streamingMessage || 'Thinking...'}</span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </>
                ) : sessionMessages.length === 0 && !pendingQuestion ? (
                  <div className="flex flex-col items-center justify-center h-full text-center pt-20">
                    <MessageSquare className="h-10 w-10 mb-3 text-gray-200" />
                    <p className="text-gray-400 text-sm">Ask a question to start this conversation.</p>
                  </div>
                ) : (
                  <>
                    {sessionMessages
                      .filter((msg) =>
                        (msg.display_text_left_panel || msg.question || '').toLowerCase().includes(searchQuery.toLowerCase())
                      )
                      .map((msg, idx) => {
                        const assistantContent = getAssistantDisplayForMessage(msg, idx);
                        const questionLabel =
                          (msg.used_secret_prompt || msg.isSecretPrompt) && (msg.prompt_label || msg.promptLabel)
                            ? `Analysis: ${msg.prompt_label || msg.promptLabel}`
                            : (msg.display_text_left_panel || msg.question || 'Untitled');
                        return (
                          <div key={msg.id || idx} className="flex flex-col gap-3">
                            <div className="chat-thread-card chat-thread-card--user">
                              <div className="chat-thread-card__label">You</div>
                              <div className="chat-thread-card__body">{questionLabel}</div>
                            </div>
                            {(assistantContent || (msg.isStreaming && msg.id === selectedMessageId)) && (
                              <div className="chat-thread-card">
                                <div className="chat-thread-card__label">Assistant</div>
                                {!assistantContent && msg.isStreaming ? (
                                  <div className="flex items-center gap-2 text-gray-500 text-sm py-4 px-5">
                                    <Loader2 className="h-4 w-4 animate-spin text-[#21C1B6]" />
                                    <span>{streamingMessage || getStatusMessage(streamingStatus) || 'Thinking...'}</span>
                                  </div>
                                ) : (
                                  <>
                                    <div className="chat-thread-card__body analysis-page-ai-response">
                                      <FormattedAssistantContent
                                        raw={assistantContent}
                                        markdownComponents={markdownComponents}
                                      />
                                    </div>
                                    {assistantContent && (
                                      <div className="chat-thread-card__footer">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            handleMessageClick(msg);
                                            handleCopyResponse();
                                          }}
                                          className="inline-flex items-center gap-1 p-1 px-2 text-[11px] font-medium text-gray-500 border border-gray-200 rounded hover:bg-gray-50"
                                        >
                                          <Copy className="h-3 w-3" />
                                          Copy
                                        </button>
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    {pendingQuestion && (
                      <div className="flex flex-col gap-3">
                        <div className="chat-thread-card chat-thread-card--user">
                          <div className="chat-thread-card__label">You</div>
                          <div className="chat-thread-card__body">{pendingQuestion}</div>
                        </div>
                        <div className="chat-thread-card">
                          <div className="chat-thread-card__label">Assistant</div>
                          <div className="p-4">
                            <button
                              type="button"
                              onClick={() => setShowProcessingTimeline((prev) => !prev)}
                              className="flex items-center gap-2 text-xs font-medium text-[#1f6b5f] mb-3"
                            >
                              <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" />
                              <span>{showProcessingTimeline ? 'Hide thinking' : 'Show thinking'}</span>
                              <ChevronDown className={`h-3 w-3 transition-transform ${showProcessingTimeline ? 'rotate-180' : ''}`} />
                            </button>
                            {showProcessingTimeline && processingTimeline.length > 0 && (
                              <div className="border-l border-[#c9ddd5] pl-3 space-y-3 mb-3">
                                {processingTimeline.map((step) => (
                                  <div key={step.id}>
                                    <p className="text-[13px] font-semibold italic text-[#2b3528]">{step.title}</p>
                                    <p className="text-xs text-[#4f5b56]">{step.description}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="flex items-center gap-2 text-sm text-[#1f6b5f]">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              <span>{streamingMessage || getStatusMessage(streamingStatus) || 'Model thinking...'}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="border-t border-gray-200 p-3 bg-white flex-shrink-0">
              {documentData && (
                <div className="mb-2 p-2 bg-white rounded-lg border border-gray-200 max-w-3xl mx-auto w-full">
                  <div className="flex items-center space-x-1.5">
                    <FileCheck className="h-3 w-3 text-green-600" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-[#2b3528] truncate">{documentData.originalName}</p>
                      <p className="text-xs text-[#807868]">{formatFileSize(documentData.size)}</p>
                    </div>
                  </div>
                </div>
              )}
              {isChatUploading && (
                <div className="mb-2 p-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border-2 border-blue-200 shadow-md max-w-3xl mx-auto w-full">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-1.5">
                      <Loader2 className="h-3.5 w-3.5 text-blue-600 animate-spin" />
                      <span className="text-xs font-semibold text-blue-900">Uploading document...</span>
                    </div>
                    <span className="text-xs font-bold text-blue-700">{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-blue-200 rounded-full h-2 overflow-hidden">
                    <div className="bg-gradient-to-r from-blue-500 to-blue-600 h-2 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                  </div>
                </div>
              )}
              <form onSubmit={handleSend} className="max-w-3xl mx-auto w-full">
                {(isLoadingSecrets || secrets.length > 0) && (
                  <PromptChipsBar
                    secrets={secrets}
                    isLoading={isLoadingSecrets}
                    selectedSecretId={selectedSecretId}
                    activeLabel={isSecretPromptSelected ? activeDropdown : null}
                    onSelect={(s) => handleDropdownSelect(s.name, s.id, s.llm_name)}
                    disabled={isLoading || isGeneratingInsights}
                    size="compact"
                    className="mb-1"
                  />
                )}
                <div className="flex items-center space-x-1.5 bg-gray-50 rounded-xl px-2.5 py-2 focus-within:border-[#21C1B6] focus-within:bg-white analysis-input-container">
                  <UploadOptionsMenu
                    fileInputRef={fileInputRef}
                    isUploading={isUploading || isChatUploading}
                    onLocalFileClick={() => fileInputRef.current?.click()}
                    onGoogleDriveFilesSelected={handleGoogleDriveUpload}
                    isSplitView={false}
                    disabled={isUploading || isChatUploading}
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.tiff,.mp3,.wav,.m4a,.flac,.ogg,.webm,.aac,.mp4"
                    onChange={handleFileUpload}
                    disabled={isUploading || isChatUploading}
                    multiple
                  />
                  <div className="relative flex-shrink-0" ref={styleDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setShowStyleDropdown((s) => !s)}
                      disabled={isLoading || isGeneratingInsights}
                      className="flex items-center space-x-1 px-2 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                    >
                      <Sparkles className="h-3 w-3" />
                      <span>{learningModeActive ? 'Learning' : 'Normal'}</span>
                      <ChevronDown className="h-3 w-3" />
                    </button>
                    {showStyleDropdown && (
                      <div className="absolute bottom-full left-0 mb-2 w-36 bg-white border border-gray-200 rounded-lg shadow-lg z-20">
                        <button type="button" onClick={() => handleSelectStyle('normal')} className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50">Normal</button>
                        <button type="button" onClick={() => handleSelectStyle('learning')} className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50" disabled={!fileId}>Learning</button>
                      </div>
                    )}
                  </div>
                  <input
                    type="text"
                    value={chatInput}
                    onChange={handleChatInputChange}
                    placeholder={getInputPlaceholder()}
                    className="flex-1 bg-transparent border-none outline-none text-gray-900 placeholder-gray-500 text-xs font-medium py-1 min-w-0 analysis-page-user-input"
                    disabled={isLoading || isGeneratingInsights}
                  />
                  <button type="button" onClick={toggleListening} className={`p-1.5 rounded-full flex-shrink-0 ${isListening ? 'bg-red-500 text-white animate-pulse' : 'text-gray-400 hover:text-[#21C1B6]'}`} disabled={isLoading || isGeneratingInsights || isSecretPromptSelected}>
                    {isListening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                  </button>
                  <button type={sendButtonType} disabled={isSendButtonDisabled} onClick={handleSendButtonClick} className={getSendButtonClassName('small')} title={sendButtonTitle}>
                    {renderSendButtonIcon('small')}
                  </button>
                </div>
                {isSecretPromptSelected && (
                  <div className="mt-1.5 p-1.5 bg-[#E0F7F6] border border-[#21C1B6] rounded-lg text-xs text-[#21C1B6] flex items-center gap-1">
                    <Bot className="h-3 w-3" />
                    Using: <strong>{activeDropdown}</strong>
                    <button type="button" onClick={() => { setIsSecretPromptSelected(false); setActiveDropdown('Custom Query'); setSelectedSecretId(null); }} className="ml-auto"><X className="h-3 w-3" /></button>
                  </div>
                )}
              </form>
              <RateQuotaPills limits={limits} className="mt-2 max-w-3xl mx-auto" />
              {fileSizeLimitError && (
                <div className="mt-2 max-w-3xl mx-auto">
                  <div className="bg-[#E0F7F6] border border-[#21C1B6] rounded-lg p-3 text-xs text-gray-700">{fileSizeLimitError.message}</div>
                </div>
              )}
            </div>
          </div>
        </div>
