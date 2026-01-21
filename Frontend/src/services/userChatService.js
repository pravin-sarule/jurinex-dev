/**
 * User Chat Service for AI-Agent
 * Connects to AI-Agent service via Gateway for public user chat
 */
import { GATEWAY_BASE_URL } from '../config/apiConfig';

class UserChatService {
  constructor(baseUrl = null) {
    // Use provided baseUrl, or fallback to config, or detect from window
    let gatewayUrl = baseUrl;
    
    if (!gatewayUrl) {
      if (typeof window !== 'undefined') {
        // In browser: use config or detect from current origin
        try {
          // Try to use config first
          gatewayUrl = GATEWAY_BASE_URL || 
            import.meta.env.VITE_APP_GATEWAY_URL ||
            (window.location.origin.includes('localhost') ? 'https://gateway-service-120280829617.asia-south1.run.app' : window.location.origin);
        } catch (e) {
          // Fallback if config import fails
          gatewayUrl = window.location.origin.includes('localhost') 
            ? 'https://gateway-service-120280829617.asia-south1.run.app' 
            : window.location.origin;
        }
      } else {
        // Server-side: use default
        gatewayUrl = 'https://gateway-service-120280829617.asia-south1.run.app';
      }
    }
    
    this.baseUrl = `${gatewayUrl}/ai-agent/documents`;
    this.sessionId = this.getOrCreateSessionId();
  }

  /**
   * Generate a valid UUID v4
   * @returns {string} UUID v4 string
   */
  generateUUID() {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    // Fallback for older browsers or server-side
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Get or create session ID for conversation context
   * @returns {string} Session UUID
   */
  getOrCreateSessionId() {
    if (typeof window === 'undefined') {
      // Server-side: generate a proper UUID
      return this.generateUUID();
    }

    let sessionId = localStorage.getItem('ai_agent_chat_session_id');
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    if (!sessionId || !uuidRegex.test(sessionId)) {
      // Generate a proper UUID v4
      sessionId = this.generateUUID();
      localStorage.setItem('ai_agent_chat_session_id', sessionId);
    }
    return sessionId;
  }

  /**
   * Chat with all documents
   * @param {string} question - User question
   * @param {string[]} fileIds - Optional: specific file IDs, null = all documents
   * @returns {Promise<Object>} Chat response
   */
  async chat(question, fileIds = null) {
    if (!question || !question.trim()) {
      throw new Error('Question cannot be empty');
    }

    const body = {
      question: question.trim(),
      session_id: this.sessionId
    };

    // Only add file_ids if specified
    if (fileIds && Array.isArray(fileIds) && fileIds.length > 0) {
      body.file_ids = fileIds;
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Service-Name': 'landing-page-chatbot'
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || errorData.message || `Chat failed: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Update session ID if returned from server
      if (data.session_id && data.session_id !== this.sessionId) {
        this.sessionId = data.session_id;
        if (typeof window !== 'undefined') {
          localStorage.setItem('ai_agent_chat_session_id', data.session_id);
        }
      }

      return {
        success: true,
        answer: data.answer || data.response || '',
        message_id: data.message_id,
        session_id: data.session_id || this.sessionId,
        files_used: data.files_used || 0,
        chunks_used: data.chunks_used || 0,
        timestamp: data.timestamp || new Date().toISOString(),
        history: data.history || []
      };
    } catch (error) {
      console.error('[UserChatService] Chat error:', error);
      throw error;
    }
  }

  /**
   * Delete session on server (when user closes chat)
   * @returns {Promise<Object>} Deletion result
   */
  async deleteSession() {
    if (!this.sessionId) {
      return { success: true, message: 'No session to delete' };
    }

    try {
      const response = await fetch(`${this.baseUrl}/session/${this.sessionId}`, {
        method: 'DELETE',
        headers: {
          'X-Service-Name': 'landing-page-chatbot'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || errorData.message || `Delete failed: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Clear local session
      if (typeof window !== 'undefined') {
        localStorage.removeItem('ai_agent_chat_session_id');
      }
      this.sessionId = this.getOrCreateSessionId();

      return data;
    } catch (error) {
      console.error('[UserChatService] Delete session error:', error);
      // Still clear local session even if server delete fails
      if (typeof window !== 'undefined') {
        localStorage.removeItem('ai_agent_chat_session_id');
      }
      this.sessionId = this.getOrCreateSessionId();
      throw error;
    }
  }

  /**
   * Reset conversation session
   */
  resetSession() {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('ai_agent_chat_session_id');
    }
    this.sessionId = this.getOrCreateSessionId();
  }

  /**
   * Get current session ID
   * @returns {string}
   */
  getSessionId() {
    return this.sessionId;
  }
}

export default UserChatService;
