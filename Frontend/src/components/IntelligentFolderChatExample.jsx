import React from 'react';
import IntelligentFolderChat from './IntelligentFolderChat';

export function BasicIntelligentChatExample() {
  const folderName = 'my-case-folder';
  const authToken = localStorage.getItem('token');

  return (
    <div style={{ height: '600px', margin: '20px' }}>
      <IntelligentFolderChat 
        folderName={folderName}
        authToken={authToken}
      />
    </div>
  );
}

export function IntelligentChatWithCallback() {
  const folderName = 'my-case-folder';
  const authToken = localStorage.getItem('token');

  const handleMessageComplete = (data) => {
    console.log('Message completed:', {
      text: data.text,
      method: data.method,
      sessionId: data.sessionId,
      routingDecision: data.routingDecision,
    });
    
  };

  return (
    <div style={{ height: '600px', margin: '20px' }}>
      <IntelligentFolderChat 
        folderName={folderName}
        authToken={authToken}
        onMessageComplete={handleMessageComplete}
      />
    </div>
  );
}

import { useIntelligentFolderChat } from '../hooks/useIntelligentFolderChat';

export function CustomIntelligentChat() {
  const folderName = 'my-case-folder';
  const authToken = localStorage.getItem('token');

  const {
    text,
    isStreaming,
    error,
    methodUsed,
    sendMessage,
    stopStreaming,
  } = useIntelligentFolderChat(folderName, authToken);

  const handleSend = async () => {
    await sendMessage("Summarize all documents");
  };

  return (
    <div style={{ padding: '20px' }}>
      <button 
        onClick={handleSend} 
        disabled={isStreaming}
      >
        {isStreaming ? 'Streaming...' : 'Ask Question'}
      </button>
      
      {isStreaming && (
        <button onClick={stopStreaming}>
          Stop
        </button>
      )}

      {methodUsed && (
        <div>
          Method: {methodUsed === 'gemini_eyeball' ? 'Complete Analysis' : 'Targeted Search'}
        </div>
      )}

      {error && (
        <div style={{ color: 'red' }}>Error: {error}</div>
      )}

      <div style={{ marginTop: '20px', padding: '10px', background: '#f5f5f5' }}>
        {text || (isStreaming ? 'Waiting for response...' : 'No response yet')}
      </div>
    </div>
  );
}


export default BasicIntelligentChatExample;





