import { useState, useRef, useCallback, useEffect } from 'react';
import { convertJsonToPlainText } from '../utils/jsonToPlainText';

// Get API base URL from environment or default
const API_BASE_URL = import.meta.env.VITE_APP_API_URL || import.meta.env.REACT_APP_API_BASE_URL || 'https://gateway-service-120280829617.asia-south1.run.app';
const API_BASE = `${API_BASE_URL}/docs`;

// Helper to get auth token from localStorage
const getAuthToken = () => {
  const tokenKeys = [
    'authToken',
    'token',
    'accessToken',
    'jwt',
    'bearerToken',
    'auth_token',
    'access_token',
    'api_token',
    'userToken',
  ];
  for (const key of tokenKeys) {
    const token = localStorage.getItem(key);
    if (token) return token;
  }
  return null;
};

/**
 * Hook for intelligent folder chat with real-time streaming rendering
 * Renders chunks immediately as they arrive, not buffered
 */
export function useIntelligentFolderChat(folderName, authToken = null) {
  const [text, setText] = useState('');
  const [thinking, setThinking] = useState(''); // NEW: Model's thinking/reasoning process
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [methodUsed, setMethodUsed] = useState(null);
  const [routingDecision, setRoutingDecision] = useState(null);
  const [status, setStatus] = useState(null);
  const [finalMetadata, setFinalMetadata] = useState(null); // Store final metadata with citations

  const abortControllerRef = useRef(null);
  const updateTimeoutRef = useRef(null);

  /**
   * Send a message and stream the response in real-time
   * Chunks are rendered immediately as they arrive
   * @param {string} question - The user's question (optional if secretId is provided)
   * @param {string} secretId - The secret prompt ID (optional, used instead of question)
   */
  const sendMessage = useCallback(async (question, secretId = null) => {
    // Cancel any ongoing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    // Reset state
    setText('');
    setThinking(''); // Reset thinking
    setError(null);
    setIsStreaming(true);
    setMethodUsed(null);
    setRoutingDecision(null);
    setStatus(null);

    // Clear any pending UI updates
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
      updateTimeoutRef.current = null;
    }

    try {
      const token = authToken || getAuthToken();
      const endpoint = `${API_BASE}/${folderName}/intelligent-chat/stream`;

      // Build request body based on whether using secret prompt or regular question
      const requestBody = {
        session_id: sessionId,
        llm_name: 'gemini', // Optional
      };

      // ✅ Send secret_id for secret prompts, question for regular chat
      // When secretId is provided, ONLY send secret_id (no question field at all)
      // Backend will fetch the secret prompt using secret_id
      if (secretId) {
        requestBody.secret_id = secretId;
        // Explicitly do NOT include question field when using secret_id
        // Backend handles secret_id and fetches the prompt internally
      } else if (question && question.trim()) {
        // Only include question if it's provided and not empty
        requestBody.question = question.trim();
      } else {
        // No secretId and no valid question - this should not happen
        // This error should not occur if form validation is working correctly
        setError('Please enter a question or select an analysis prompt.');
        setIsStreaming(false);
        return;
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(requestBody),
        signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || errorData.message || `HTTP ${response.status}`;
        
        // If using secret_id and backend says question is required, provide a clearer error
        if (secretId && errorMessage.toLowerCase().includes('question') && errorMessage.toLowerCase().includes('required')) {
          setError('Backend error: Secret prompt could not be processed. Please try again or contact support.');
        } else {
          setError(errorMessage);
        }
        setIsStreaming(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let lineBuffer = '';
      let accumulatedText = ''; // Track full text for final state
      let accumulatedThinking = ''; // Track thinking content
      const isUsingSecretId = !!secretId; // Store flag for error handling

      while (true) {
        if (signal.aborted) {
          setIsStreaming(false);
          break;
        }

        const { done, value } = await reader.read();

        if (done) {
          // Stream complete - ensure final text and thinking are set ONCE
          setIsStreaming(false);
          if (accumulatedText) {
            // ✅ Convert JSON to plain text before setting final text
            const plainTextResponse = convertJsonToPlainText(accumulatedText);
            setText(plainTextResponse);
          }
          if (accumulatedThinking) {
            setThinking(accumulatedThinking);
          }
          break;
        }

        // Decode chunk
        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || ''; // Keep incomplete line in buffer

        // Process each complete line
        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;

          const data = line.replace(/^data: /, '').trim();

          // Handle heartbeat
          if (data === '[PING]') continue;

          // Handle completion marker
          if (data === '[DONE]') {
            setIsStreaming(false);
            // Ensure final text is displayed once
            if (accumulatedText) {
              // ✅ Convert JSON to plain text before setting final text
              const plainTextResponse = convertJsonToPlainText(accumulatedText);
              setText(plainTextResponse);
            }
            if (accumulatedThinking) {
              setThinking(accumulatedThinking);
            }
            return;
          }

          // Parse JSON data
          try {
            const parsed = JSON.parse(data);

            switch (parsed.type) {
              case 'metadata':
                // Initial metadata with session_id and method
                if (parsed.session_id) {
                  setSessionId(parsed.session_id);
                }
                if (parsed.method) {
                  setMethodUsed(parsed.method);
                }
                if (parsed.routing_decision) {
                  setRoutingDecision(parsed.routing_decision);
                }
                break;

              case 'status':
                // Status updates (analyzing, generating, etc.)
                setStatus({
                  status: parsed.status,
                  message: parsed.message,
                });
                break;

              case 'thinking':
                // CRITICAL: Render thinking chunks immediately in real-time
                const thinkingText = parsed.text || '';
                if (thinkingText) {
                  accumulatedThinking += thinkingText;
                  
                  // Update UI immediately for real-time rendering
                  if (updateTimeoutRef.current) {
                    clearTimeout(updateTimeoutRef.current);
                  }
                  
                  // Immediate update for real-time rendering
                  updateTimeoutRef.current = setTimeout(() => {
                    setThinking(accumulatedThinking);
                    updateTimeoutRef.current = null;
                  }, 10); // 10ms debounce for smooth rendering
                }
                break;

              case 'chunk':
                // CRITICAL: Render chunk immediately in real-time
                const chunkText = parsed.text || '';
                if (chunkText) {
                  accumulatedText += chunkText;
                  
                  // Update UI immediately for real-time rendering
                  // Debounce rapid updates to prevent excessive re-renders
                  if (updateTimeoutRef.current) {
                    clearTimeout(updateTimeoutRef.current);
                  }
                  
                  // Use immediate update with minimal debounce for smooth rendering
                  // This ensures chunks appear as fast as possible while batching
                  // very rapid updates (multiple chunks in same frame)
                  // ✅ Convert JSON to plain text as chunks accumulate
                  updateTimeoutRef.current = setTimeout(() => {
                    const plainTextResponse = convertJsonToPlainText(accumulatedText);
                    setText(plainTextResponse);
                    updateTimeoutRef.current = null;
                  }, 10); // 10ms debounce - fast enough for real-time feel
                }
                break;

              case 'done':
                // Final metadata - stream is complete
                setIsStreaming(false);
                if (parsed.session_id) setSessionId(parsed.session_id);
                if (parsed.method) setMethodUsed(parsed.method);
                if (parsed.routing_decision) {
                  setRoutingDecision(parsed.routing_decision);
                }
                // Store final metadata for citations
                setFinalMetadata(parsed);
                // Log metadata for debugging
                console.log('[useIntelligentFolderChat] Done metadata:', parsed);
                console.log('[useIntelligentFolderChat] used_chunk_ids:', parsed.used_chunk_ids);
                console.log('[useIntelligentFolderChat] citations:', parsed.citations);
                // Ensure final text and thinking are set ONCE
                if (accumulatedText) {
                  // ✅ Convert JSON to plain text before setting final text
                  const plainTextResponse = convertJsonToPlainText(accumulatedText);
                  setText(plainTextResponse);
                }
                if (accumulatedThinking) {
                  setThinking(accumulatedThinking);
                }
                break;

              case 'error':
                // Handle error messages - filter out "question required" when using secret_id
                const errorMsg = parsed.message || parsed.error || 'An error occurred';
                if (isUsingSecretId && errorMsg.toLowerCase().includes('question') && errorMsg.toLowerCase().includes('required')) {
                  setError('Backend error: Secret prompt could not be processed. Please try again or contact support.');
                } else {
                  setError(errorMsg);
                }
                setIsStreaming(false);
                break;

              default:
                // Unknown type - log for debugging
                console.log('Unknown stream event type:', parsed.type);
            }
          } catch (e) {
            // Skip invalid JSON (might be partial data)
            console.warn('Failed to parse stream data:', e, data);
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('Request aborted');
        setIsStreaming(false);
        return;
      }
      setError(err.message || 'An error occurred');
      setIsStreaming(false);
    } finally {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
        updateTimeoutRef.current = null;
      }
    }
  }, [folderName, authToken, sessionId]);

  /**
   * Stop the current streaming request
   */
  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  /**
   * Clear the current text and reset state
   */
  const clear = useCallback(() => {
    setText('');
    setThinking('');
    setError(null);
    setMethodUsed(null);
    setRoutingDecision(null);
    setStatus(null);
    stopStreaming();
  }, [stopStreaming]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
    };
  }, []);

  return {
    text,
    thinking, // NEW: Expose thinking content
    isStreaming,
    error,
    sessionId,
    methodUsed,
    routingDecision,
    status,
    finalMetadata, // Expose final metadata with citations
    sendMessage,
    stopStreaming,
    clear,
  };
}

