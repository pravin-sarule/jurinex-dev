// import { useState, useRef, useCallback, useEffect } from 'react';
// import { convertJsonToPlainText } from '../utils/jsonToPlainText';
// import { renderSecretPromptResponse, isStructuredJsonResponse } from '../utils/renderSecretPromptResponse';
// import { DOCS_BASE_URL } from '../config/apiConfig';

// const API_BASE = DOCS_BASE_URL;

// const getAuthToken = () => {
//   const tokenKeys = [
//     'authToken',
//     'token',
//     'accessToken',
//     'jwt',
//     'bearerToken',
//     'auth_token',
//     'access_token',
//     'api_token',
//     'userToken',
//   ];
//   for (const key of tokenKeys) {
//     const token = localStorage.getItem(key);
//     if (token) return token;
//   }
//   return null;
// };

// export function useIntelligentFolderChat(folderName, authToken = null) {
//   const [text, setText] = useState('');
//   const [thinking, setThinking] = useState('');
//   const [isStreaming, setIsStreaming] = useState(false);
//   const [error, setError] = useState(null);
//   const [sessionId, setSessionId] = useState(null);
//   const [methodUsed, setMethodUsed] = useState(null);
//   const [routingDecision, setRoutingDecision] = useState(null);
//   const [status, setStatus] = useState(null);
//   const [finalMetadata, setFinalMetadata] = useState(null);

//   const abortControllerRef = useRef(null);
//   const updateTimeoutRef = useRef(null);

//   const sendMessage = useCallback(async (question, secretId = null) => {
//     if (abortControllerRef.current) {
//       abortControllerRef.current.abort();
//     }

//     abortControllerRef.current = new AbortController();
//     const signal = abortControllerRef.current.signal;

//     setText('');
//     setThinking('');
//     setError(null);
//     setIsStreaming(true);
//     setMethodUsed(null);
//     setRoutingDecision(null);
//     setStatus(null);

//     if (updateTimeoutRef.current) {
//       clearTimeout(updateTimeoutRef.current);
//       updateTimeoutRef.current = null;
//     }

//     try {
//       const token = authToken || getAuthToken();
//       const endpoint = `${API_BASE}/${folderName}/intelligent-chat/stream`;

//       const requestBody = {
//         session_id: sessionId,
//         llm_name: 'gemini',
//       };

//       if (secretId) {
//         requestBody.secret_id = secretId;
//       } else if (question && question.trim()) {
//         requestBody.question = question.trim();
//       } else {
//         setError('Please enter a question or select an analysis prompt.');
//         setIsStreaming(false);
//         return;
//       }

//       const response = await fetch(endpoint, {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//           'Authorization': token ? `Bearer ${token}` : '',
//           'Accept': 'text/event-stream',
//         },
//         body: JSON.stringify(requestBody),
//         signal,
//       });

//       if (!response.ok) {
//         const errorData = await response.json().catch(() => ({}));
//         const errorMessage = errorData.error || errorData.message || `HTTP ${response.status}`;
        
//         if (secretId && errorMessage.toLowerCase().includes('question') && errorMessage.toLowerCase().includes('required')) {
//           setError('Backend error: Secret prompt could not be processed. Please try again or contact support.');
//         } else {
//           setError(errorMessage);
//         }
//         setIsStreaming(false);
//         return;
//       }

//       const reader = response.body.getReader();
//       const decoder = new TextDecoder();
//       let lineBuffer = '';
//       let accumulatedText = '';
//       let accumulatedThinking = '';
//       const isUsingSecretId = !!secretId;

//       while (true) {
//         if (signal.aborted) {
//           setIsStreaming(false);
//           break;
//         }

//         const { done, value } = await reader.read();

//         if (done) {
//           setIsStreaming(false);
//           if (accumulatedText) {
//             const isStructured = isStructuredJsonResponse(accumulatedText);
//             const formattedResponse = isStructured
//               ? renderSecretPromptResponse(accumulatedText)
//               : convertJsonToPlainText(accumulatedText);
//             setText(formattedResponse);
//           }
//           if (accumulatedThinking) {
//             setThinking(accumulatedThinking);
//           }
//           break;
//         }

//         lineBuffer += decoder.decode(value, { stream: true });
//         const lines = lineBuffer.split('\n');
//         lineBuffer = lines.pop() || '';

//         for (const line of lines) {
//           if (!line.trim() || !line.startsWith('data: ')) continue;

//           const data = line.replace(/^data: /, '').trim();

//           if (data === '[PING]') continue;

//           if (data === '[DONE]') {
//             setIsStreaming(false);
//             if (accumulatedText) {
//               const isStructured = isStructuredJsonResponse(accumulatedText);
//               const formattedResponse = isStructured
//                 ? renderSecretPromptResponse(accumulatedText)
//                 : convertJsonToPlainText(accumulatedText);
//               setText(formattedResponse);
//             }
//             if (accumulatedThinking) {
//               setThinking(accumulatedThinking);
//             }
//             return;
//           }

//           try {
//             const parsed = JSON.parse(data);

//             switch (parsed.type) {
//               case 'metadata':
//                 if (parsed.session_id) {
//                   setSessionId(parsed.session_id);
//                 }
//                 if (parsed.method) {
//                   setMethodUsed(parsed.method);
//                 }
//                 if (parsed.routing_decision) {
//                   setRoutingDecision(parsed.routing_decision);
//                 }
//                 break;

//               case 'status':
//                 setStatus({
//                   status: parsed.status,
//                   message: parsed.message,
//                 });
//                 break;

//               case 'thinking':
//                 const thinkingText = parsed.text || '';
//                 if (thinkingText) {
//                   accumulatedThinking += thinkingText;
                  
//                   if (updateTimeoutRef.current) {
//                     clearTimeout(updateTimeoutRef.current);
//                   }
                  
//                   updateTimeoutRef.current = setTimeout(() => {
//                     setThinking(accumulatedThinking);
//                     updateTimeoutRef.current = null;
//                   }, 10);
//                 }
//                 break;

//               case 'chunk':
//                 const chunkText = parsed.text || '';
//                 if (chunkText) {
//                   accumulatedText += chunkText;
//                 }
//                 break;

//               case 'done':
//                 setIsStreaming(false);
//                 if (parsed.session_id) setSessionId(parsed.session_id);
//                 if (parsed.method) setMethodUsed(parsed.method);
//                 if (parsed.routing_decision) {
//                   setRoutingDecision(parsed.routing_decision);
//                 }
//                 setFinalMetadata(parsed);
//                 console.log('[useIntelligentFolderChat] Done metadata:', parsed);
//                 console.log('[useIntelligentFolderChat] used_chunk_ids:', parsed.used_chunk_ids);
//                 console.log('[useIntelligentFolderChat] citations:', parsed.citations);
//                 if (accumulatedText) {
//                   const isStructured = isStructuredJsonResponse(accumulatedText);
//                   const formattedResponse = isStructured
//                     ? renderSecretPromptResponse(accumulatedText)
//                     : convertJsonToPlainText(accumulatedText);
//                   setText(formattedResponse);
//                 }
//                 if (accumulatedThinking) {
//                   setThinking(accumulatedThinking);
//                 }
//                 break;

//               case 'error':
//                 const errorMsg = parsed.message || parsed.error || 'An error occurred';
//                 if (isUsingSecretId && errorMsg.toLowerCase().includes('question') && errorMsg.toLowerCase().includes('required')) {
//                   setError('Backend error: Secret prompt could not be processed. Please try again or contact support.');
//                 } else {
//                   setError(errorMsg);
//                 }
//                 setIsStreaming(false);
//                 break;

//               default:
//                 console.log('Unknown stream event type:', parsed.type);
//             }
//           } catch (e) {
//             console.warn('Failed to parse stream data:', e, data);
//           }
//         }
//       }
//     } catch (err) {
//       if (err.name === 'AbortError') {
//         console.log('Request aborted');
//         setIsStreaming(false);
//         return;
//       }
//       setError(err.message || 'An error occurred');
//       setIsStreaming(false);
//     } finally {
//       if (updateTimeoutRef.current) {
//         clearTimeout(updateTimeoutRef.current);
//         updateTimeoutRef.current = null;
//       }
//     }
//   }, [folderName, authToken, sessionId]);

//   const stopStreaming = useCallback(() => {
//     if (abortControllerRef.current) {
//       abortControllerRef.current.abort();
//       abortControllerRef.current = null;
//     }
//     setIsStreaming(false);
//   }, []);

//   const clear = useCallback(() => {
//     setText('');
//     setThinking('');
//     setError(null);
//     setMethodUsed(null);
//     setRoutingDecision(null);
//     setStatus(null);
//     stopStreaming();
//   }, [stopStreaming]);

//   useEffect(() => {
//     return () => {
//       if (abortControllerRef.current) {
//         abortControllerRef.current.abort();
//       }
//       if (updateTimeoutRef.current) {
//         clearTimeout(updateTimeoutRef.current);
//       }
//     };
//   }, []);

//   return {
//     text,
//     thinking,
//     isStreaming,
//     error,
//     sessionId,
//     methodUsed,
//     routingDecision,
//     status,
//     finalMetadata,
//     sendMessage,
//     stopStreaming,
//     clear,
//   };
// }

import { useState, useRef, useCallback, useEffect } from 'react';
import { convertJsonToPlainText } from '../utils/jsonToPlainText';
import { renderSecretPromptResponse, isStructuredJsonResponse } from '../utils/renderSecretPromptResponse';
import { DOCS_BASE_URL } from '../config/apiConfig';
import { parseLlmPolicyErrorForUi, stringToChatErrorDisplay } from '../utils/llmQuotaMessages';
import { notifyResponseComplete, ensureNotificationPermission } from '../utils/responseNotifier';

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
  const [learningPayload, setLearningPayload] = useState(null);
  const [learningPopupQuestion, setLearningPopupQuestion] = useState(null);

  const abortControllerRef = useRef(null);
  const updateTimeoutRef = useRef(null);
  const chunkDisplayTimeoutRef = useRef(null);

  const formatAssistantText = (raw) => {
    if (!raw) return '';
    try {
      const isStructured = isStructuredJsonResponse(raw);
      return isStructured ? renderSecretPromptResponse(raw) : convertJsonToPlainText(raw);
    } catch (e) {
      console.warn('[useIntelligentFolderChat] formatAssistantText failed, using raw text', e);
      return raw;
    }
  };

  const sendMessage = useCallback(async (question, secretId = null, streamOpts = null) => {
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
    setLearningPayload(null);
    setLearningPopupQuestion(null);

    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
      updateTimeoutRef.current = null;
    }

    try {
      ensureNotificationPermission();
      const token = authToken || getAuthToken();
      const endpoint = `${API_BASE}/${encodeURIComponent(folderName)}/intelligent-chat/stream`;

      const requestBody = {
        session_id: sessionId,
        llm_name: 'gemini',
      };
      if (streamOpts && typeof streamOpts === 'object') {
        if (streamOpts.session_id) requestBody.session_id = streamOpts.session_id;
        if (streamOpts.llm_name) requestBody.llm_name = streamOpts.llm_name;
        if (streamOpts.max_output_tokens != null && streamOpts.max_output_tokens !== '') {
          const n = Number(streamOpts.max_output_tokens);
          if (Number.isFinite(n)) requestBody.max_output_tokens = n;
        }
        if (streamOpts.model_temperature != null && streamOpts.model_temperature !== '') {
          const t = Number(streamOpts.model_temperature);
          if (Number.isFinite(t)) requestBody.model_temperature = t;
        }
        if (streamOpts.learning_mode != null) {
          requestBody.learning_mode = !!streamOpts.learning_mode;
        }
        if (streamOpts.research_mode != null) {
          requestBody.research_mode = !!streamOpts.research_mode;
        }
        if (streamOpts.adversarial_mode != null) {
          requestBody.adversarial_mode = !!streamOpts.adversarial_mode;
        }
        if (streamOpts.context_page != null && streamOpts.context_page !== '') {
          const p = Number(streamOpts.context_page);
          if (Number.isFinite(p)) requestBody.context_page = p;
        }
        if (streamOpts.context_selection) {
          requestBody.context_selection = String(streamOpts.context_selection);
        }
        if (streamOpts.document_context) {
          requestBody.document_context = String(streamOpts.document_context);
        }
      }

      if (secretId) {
        requestBody.secret_id = secretId;
      } else if (question && question.trim()) {
        const rawQuestion = question.trim();
        const learningModeOn = !!requestBody.learning_mode;
        const englishOnlySuffix =
          '\n\nRespond in clear professional English only. Do not switch language.';
        requestBody.question = learningModeOn ? `${rawQuestion}${englishOnlySuffix}` : rawQuestion;
      } else {
        setError(stringToChatErrorDisplay('Please enter a question or select an analysis prompt.'));
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
        const display = parseLlmPolicyErrorForUi(response.status, errorData);
        const errorMessage = display.body || '';
        if (
          secretId &&
          errorMessage.toLowerCase().includes('question') &&
          errorMessage.toLowerCase().includes('required')
        ) {
          setError(
            stringToChatErrorDisplay(
              'Backend error: Secret prompt could not be processed. Please try again or contact support.'
            )
          );
        } else {
          setError(display);
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
          if (chunkDisplayTimeoutRef.current) {
            clearTimeout(chunkDisplayTimeoutRef.current);
            chunkDisplayTimeoutRef.current = null;
          }
          if (accumulatedText) {
            setText(formatAssistantText(accumulatedText));
          }
          if (accumulatedThinking) {
            setThinking(accumulatedThinking);
          }
          break;
        }

        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split(/\r\n|\n|\r/);
        lineBuffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;

          const data = line.replace(/^data: /, '').trim();

          if (data === '[PING]') continue;

          if (data === '[DONE]') {
            setIsStreaming(false);
            if (chunkDisplayTimeoutRef.current) {
              clearTimeout(chunkDisplayTimeoutRef.current);
              chunkDisplayTimeoutRef.current = null;
            }
            if (accumulatedText) {
              setText(formatAssistantText(accumulatedText));
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

              case 'thinking': {
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
              }

              case 'chunk': {
                const chunkText = parsed.text || '';
                if (chunkText) {
                  accumulatedText += chunkText;
                  if (chunkDisplayTimeoutRef.current) {
                    clearTimeout(chunkDisplayTimeoutRef.current);
                    chunkDisplayTimeoutRef.current = null;
                  }
                  setText(accumulatedText);
                }
                break;
              }

              case 'done':
                setIsStreaming(false);
                notifyResponseComplete();
                if (chunkDisplayTimeoutRef.current) {
                  clearTimeout(chunkDisplayTimeoutRef.current);
                  chunkDisplayTimeoutRef.current = null;
                }
                if (parsed.session_id) setSessionId(parsed.session_id);
                if (parsed.method) setMethodUsed(parsed.method);
                if (parsed.routing_decision) {
                  setRoutingDecision(parsed.routing_decision);
                }
                setFinalMetadata(parsed);
                if (parsed.learning_payload) {
                  setLearningPayload(parsed.learning_payload);
                }
                if (parsed.learning_popup_question && typeof parsed.learning_popup_question === 'object') {
                  setLearningPopupQuestion(parsed.learning_popup_question);
                } else {
                  setLearningPopupQuestion(null);
                }
                console.log('[useIntelligentFolderChat] Done metadata:', parsed);
                console.log('[useIntelligentFolderChat] used_chunk_ids:', parsed.used_chunk_ids);
                console.log('[useIntelligentFolderChat] citations:', parsed.citations);
                {
                  const fromDone = typeof parsed.answer === 'string' ? parsed.answer : '';
                  const raw =
                    fromDone.length > accumulatedText.length ? fromDone : (accumulatedText || fromDone);
                  if (raw) {
                    setText(formatAssistantText(raw));
                  }
                }
                if (accumulatedThinking) {
                  setThinking(accumulatedThinking);
                }
                break;

              case 'error': {
                const errorMsg = parsed.message || parsed.error || 'An error occurred';
                if (
                  isUsingSecretId &&
                  errorMsg.toLowerCase().includes('question') &&
                  errorMsg.toLowerCase().includes('required')
                ) {
                  setError(
                    stringToChatErrorDisplay(
                      'Backend error: Secret prompt could not be processed. Please try again or contact support.'
                    )
                  );
                } else {
                  setError(stringToChatErrorDisplay(errorMsg));
                }
                setIsStreaming(false);
                break;
              }

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
      setError(stringToChatErrorDisplay(err.message || 'An error occurred'));
      setIsStreaming(false);
    } finally {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
        updateTimeoutRef.current = null;
      }
      if (chunkDisplayTimeoutRef.current) {
        clearTimeout(chunkDisplayTimeoutRef.current);
        chunkDisplayTimeoutRef.current = null;
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
    setLearningPayload(null);
    setLearningPopupQuestion(null);
    stopStreaming();
  }, [stopStreaming]);

  const dismissLearningPopup = useCallback(() => {
    setLearningPopupQuestion(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
      if (chunkDisplayTimeoutRef.current) {
        clearTimeout(chunkDisplayTimeoutRef.current);
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
    learningPayload,
    learningPopupQuestion,
    dismissLearningPopup,
    sendMessage,
    stopStreaming,
    clear,
    clearError,
  };
}
