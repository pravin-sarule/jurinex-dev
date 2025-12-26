import { useState, useRef, useCallback, useEffect } from 'react';
import { convertJsonToPlainText } from '../utils/jsonToPlainText';
import { renderSecretPromptResponse, isStructuredJsonResponse } from '../utils/renderSecretPromptResponse';
import { DOCS_BASE_URL } from '../config/apiConfig';

const API_BASE = DOCS_BASE_URL;

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

export function useIntelligentFolderChat(folderName, authToken = null) {
  const [text, setText] = useState('');
  const [thinking, setThinking] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [methodUsed, setMethodUsed] = useState(null);
  const [routingDecision, setRoutingDecision] = useState(null);
  const [status, setStatus] = useState(null);
  const [finalMetadata, setFinalMetadata] = useState(null);

  const abortControllerRef = useRef(null);
  const updateTimeoutRef = useRef(null);

  const sendMessage = useCallback(async (question, secretId = null) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setText('');
    setThinking('');
    setError(null);
    setIsStreaming(true);
    setMethodUsed(null);
    setRoutingDecision(null);
    setStatus(null);

    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
      updateTimeoutRef.current = null;
    }

    try {
      const token = authToken || getAuthToken();
      const endpoint = `${API_BASE}/${folderName}/intelligent-chat/stream`;

      const requestBody = {
        session_id: sessionId,
        llm_name: 'gemini',
      };

      if (secretId) {
        requestBody.secret_id = secretId;
      } else if (question && question.trim()) {
        requestBody.question = question.trim();
      } else {
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
      let accumulatedText = '';
      let accumulatedThinking = '';
      const isUsingSecretId = !!secretId;

      while (true) {
        if (signal.aborted) {
          setIsStreaming(false);
          break;
        }

        const { done, value } = await reader.read();

        if (done) {
          setIsStreaming(false);
          if (accumulatedText) {
            const isStructured = isStructuredJsonResponse(accumulatedText);
            const formattedResponse = isStructured
              ? renderSecretPromptResponse(accumulatedText)
              : convertJsonToPlainText(accumulatedText);
            setText(formattedResponse);
          }
          if (accumulatedThinking) {
            setThinking(accumulatedThinking);
          }
          break;
        }

        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;

          const data = line.replace(/^data: /, '').trim();

          if (data === '[PING]') continue;

          if (data === '[DONE]') {
            setIsStreaming(false);
            if (accumulatedText) {
              const isStructured = isStructuredJsonResponse(accumulatedText);
              const formattedResponse = isStructured
                ? renderSecretPromptResponse(accumulatedText)
                : convertJsonToPlainText(accumulatedText);
              setText(formattedResponse);
            }
            if (accumulatedThinking) {
              setThinking(accumulatedThinking);
            }
            return;
          }

          try {
            const parsed = JSON.parse(data);

            switch (parsed.type) {
              case 'metadata':
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
                setStatus({
                  status: parsed.status,
                  message: parsed.message,
                });
                break;

              case 'thinking':
                const thinkingText = parsed.text || '';
                if (thinkingText) {
                  accumulatedThinking += thinkingText;
                  
                  if (updateTimeoutRef.current) {
                    clearTimeout(updateTimeoutRef.current);
                  }
                  
                  updateTimeoutRef.current = setTimeout(() => {
                    setThinking(accumulatedThinking);
                    updateTimeoutRef.current = null;
                  }, 10);
                }
                break;

              case 'chunk':
                const chunkText = parsed.text || '';
                if (chunkText) {
                  accumulatedText += chunkText;
                }
                break;

              case 'done':
                setIsStreaming(false);
                if (parsed.session_id) setSessionId(parsed.session_id);
                if (parsed.method) setMethodUsed(parsed.method);
                if (parsed.routing_decision) {
                  setRoutingDecision(parsed.routing_decision);
                }
                setFinalMetadata(parsed);
                console.log('[useIntelligentFolderChat] Done metadata:', parsed);
                console.log('[useIntelligentFolderChat] used_chunk_ids:', parsed.used_chunk_ids);
                console.log('[useIntelligentFolderChat] citations:', parsed.citations);
                if (accumulatedText) {
                  const isStructured = isStructuredJsonResponse(accumulatedText);
                  const formattedResponse = isStructured
                    ? renderSecretPromptResponse(accumulatedText)
                    : convertJsonToPlainText(accumulatedText);
                  setText(formattedResponse);
                }
                if (accumulatedThinking) {
                  setThinking(accumulatedThinking);
                }
                break;

              case 'error':
                const errorMsg = parsed.message || parsed.error || 'An error occurred';
                if (isUsingSecretId && errorMsg.toLowerCase().includes('question') && errorMsg.toLowerCase().includes('required')) {
                  setError('Backend error: Secret prompt could not be processed. Please try again or contact support.');
                } else {
                  setError(errorMsg);
                }
                setIsStreaming(false);
                break;

              default:
                console.log('Unknown stream event type:', parsed.type);
            }
          } catch (e) {
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

  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const clear = useCallback(() => {
    setText('');
    setThinking('');
    setError(null);
    setMethodUsed(null);
    setRoutingDecision(null);
    setStatus(null);
    stopStreaming();
  }, [stopStreaming]);

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
    thinking,
    isStreaming,
    error,
    sessionId,
    methodUsed,
    routingDecision,
    status,
    finalMetadata,
    sendMessage,
    stopStreaming,
    clear,
  };
}

