/**
 * Example usage of IntelligentFolderChat component
 * 
 * This file demonstrates how to integrate the Intelligent Folder Chat
 * into your existing pages/components.
 */

import React from 'react';
import IntelligentFolderChat from './IntelligentFolderChat';

/**
 * Example 1: Basic Usage
 */
export function BasicIntelligentChatExample() {
  const folderName = 'my-case-folder';
  const authToken = localStorage.getItem('token'); // or get from context

  return (
    <div style={{ height: '600px', margin: '20px' }}>
      <IntelligentFolderChat 
        folderName={folderName}
        authToken={authToken}
      />
    </div>
  );
}

/**
 * Example 2: With Completion Callback
 */
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
    
    // You can save to database, show notification, etc.
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

/**
 * Example 3: Using the Hook Directly (More Control)
 */
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

/**
 * Example 4: Integration with FolderDetailPage
 * 
 * Replace your existing folder chat in FolderDetailPage.jsx:
 * 
 * import IntelligentFolderChat from '../components/IntelligentFolderChat';
 * 
 * // In your component:
 * <IntelligentFolderChat 
 *   folderName={folderName}
 *   authToken={authToken}
 *   onMessageComplete={(data) => {
 *     // Handle completion
 *   }}
 * />
 */

export default BasicIntelligentChatExample;





