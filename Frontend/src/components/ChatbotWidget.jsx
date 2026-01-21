// import React, { useState, useRef, useEffect } from 'react';
// import { MessageCircle, X, Send, Loader2, Bot, User, Maximize2, Minimize2 } from 'lucide-react';
// import { motion, AnimatePresence } from 'framer-motion';
// import ReactMarkdown from 'react-markdown';
// import remarkGfm from 'remark-gfm';
// import UserChatService from '../services/userChatService';

// const ChatbotWidget = () => {
//   const [isOpen, setIsOpen] = useState(false);
//   const [isLargeScreen, setIsLargeScreen] = useState(false);
//   const [messages, setMessages] = useState([]);
//   const [input, setInput] = useState('');
//   const [loading, setLoading] = useState(false);
//   const [error, setError] = useState(null);
//   const messagesEndRef = useRef(null);
//   const inputRef = useRef(null);
//   const chatServiceRef = useRef(null);
//   const inactivityTimerRef = useRef(null);
//   const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

//   // Helper function to get current IST timestamp
//   const getCurrentISTTimestamp = () => {
//     const now = new Date();
//     // IST is UTC+5:30
//     const istOffset = 5.5 * 60 * 60 * 1000;
//     const istTime = new Date(now.getTime() + istOffset);
//     return istTime.toISOString().replace('Z', '+05:30');
//   };

//   // Initialize chat service
//   useEffect(() => {
//     chatServiceRef.current = new UserChatService();
    
//     // Add welcome message with IST timestamp
//     setMessages([
//       {
//         id: 'welcome',
//         role: 'assistant',
//         content: "👋 Hello! I'm your JuriNex AI assistant. I can help answer questions about legal documents, legal concepts, and how JuriNex can assist you. What would you like to know?",
//         timestamp: getCurrentISTTimestamp()
//       }
//     ]);

//     // Cleanup on component unmount
//     return () => {
//       if (chatServiceRef.current) {
//         chatServiceRef.current.deleteSession().catch(console.error);
//       }
//       if (inactivityTimerRef.current) {
//         clearTimeout(inactivityTimerRef.current);
//       }
//     };
//   }, []);

//   // Handle page unload - delete session
//   useEffect(() => {
//     const handleBeforeUnload = async () => {
//       if (chatServiceRef.current) {
//         const sessionId = chatServiceRef.current.getSessionId();
//         if (sessionId) {
//           // Use fetch with keepalive for reliable deletion on page close
//           try {
//             await fetch(`${chatServiceRef.current.baseUrl}/session/${sessionId}`, {
//               method: 'DELETE',
//               keepalive: true,
//               headers: {
//                 'X-Service-Name': 'landing-page-chatbot'
//               }
//             });
//           } catch (error) {
//             console.error('[ChatbotWidget] Error deleting session on unload:', error);
//           }
//         }
//       }
//     };

//     window.addEventListener('beforeunload', handleBeforeUnload);
//     return () => {
//       window.removeEventListener('beforeunload', handleBeforeUnload);
//     };
//   }, []);

//   // Reset inactivity timer
//   const resetInactivityTimer = () => {
//     if (inactivityTimerRef.current) {
//       clearTimeout(inactivityTimerRef.current);
//     }

//     inactivityTimerRef.current = setTimeout(async () => {
//       console.log('[ChatbotWidget] Session inactive for 5 minutes, deleting...');
//       if (chatServiceRef.current) {
//         try {
//           await chatServiceRef.current.deleteSession();
//           setMessages([
//             {
//               id: 'timeout',
//               role: 'assistant',
//               content: "Your session has expired. Starting a new conversation...",
//               timestamp: getCurrentISTTimestamp()
//             }
//           ]);
//         } catch (error) {
//           console.error('[ChatbotWidget] Error deleting expired session:', error);
//         }
//       }
//     }, SESSION_TIMEOUT_MS);
//   };

//   // Auto-scroll to bottom when messages change
//   useEffect(() => {
//     messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
//   }, [messages]);

//   // Focus input when chat opens
//   useEffect(() => {
//     if (isOpen && inputRef.current) {
//       setTimeout(() => inputRef.current?.focus(), 100);
//     }
//   }, [isOpen]);

//   const handleSend = async () => {
//     if (!input.trim() || loading) return;

//     const question = input.trim();
//     setInput('');
//     setError(null);

//     // Reset inactivity timer on user activity
//     resetInactivityTimer();

//     // Get current IST timestamp for both question and response
//     const currentTimestamp = getCurrentISTTimestamp();

//     // Add user message with current IST timestamp
//     const userMessage = {
//       id: `user-${Date.now()}`,
//       role: 'user',
//       content: question,
//       timestamp: currentTimestamp
//     };
//     setMessages(prev => [...prev, userMessage]);
//     setLoading(true);

//     try {
//       // Get AI response
//       const result = await chatServiceRef.current.chat(question);

//       // Reset inactivity timer on successful response
//       resetInactivityTimer();

//       // Add AI response with same timestamp as question (or current IST time)
//       const aiMessage = {
//         id: result.message_id || `ai-${Date.now()}`,
//         role: 'assistant',
//         content: result.answer,
//         timestamp: currentTimestamp, // Use same timestamp as question
//         filesUsed: result.files_used,
//         chunksUsed: result.chunks_used
//       };
//       setMessages(prev => [...prev, aiMessage]);

//     } catch (error) {
//       console.error('Chat error:', error);
//       setError(error.message || 'Failed to get response. Please try again.');
      
//       // Add error message with IST timestamp
//       const errorMessage = {
//         id: `error-${Date.now()}`,
//         role: 'error',
//         content: error.message || 'Sorry, I encountered an error. Please try again.',
//         timestamp: getCurrentISTTimestamp()
//       };
//       setMessages(prev => [...prev, errorMessage]);
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleKeyPress = (e) => {
//     if (e.key === 'Enter' && !e.shiftKey) {
//       e.preventDefault();
//       handleSend();
//     }
//   };

//   const handleToggle = async () => {
//     if (isOpen) {
//       // Closing chat - delete session
//       if (chatServiceRef.current) {
//         try {
//           await chatServiceRef.current.deleteSession();
//           console.log('[ChatbotWidget] Session deleted on chat close');
//         } catch (error) {
//           console.error('[ChatbotWidget] Error deleting session on close:', error);
//         }
//       }
//       // Clear inactivity timer
//       if (inactivityTimerRef.current) {
//         clearTimeout(inactivityTimerRef.current);
//         inactivityTimerRef.current = null;
//       }
//       // Reset large screen state when closing
//       setIsLargeScreen(false);
//     } else {
//       // Opening chat - reset inactivity timer
//       resetInactivityTimer();
//     }
    
//     setIsOpen(!isOpen);
//     if (!isOpen) {
//       setError(null);
//     }
//   };

//   const formatTime = (timestamp) => {
//     try {
//       if (!timestamp) return '';
      
//       // Parse the timestamp
//       let date;
//       if (timestamp instanceof Date) {
//         date = timestamp;
//       } else if (typeof timestamp === 'string') {
//         // Parse ISO string (handles both UTC and IST formats)
//         date = new Date(timestamp);
//       } else {
//         return '';
//       }
      
//       // Check if date is valid
//       if (isNaN(date.getTime())) {
//         console.warn('[ChatbotWidget] Invalid timestamp:', timestamp);
//         return '';
//       }
      
//       // Format time in IST (Indian Standard Time)
//       // Use Asia/Kolkata timezone for proper IST conversion
//       const options = { 
//         hour: '2-digit', 
//         minute: '2-digit',
//         hour12: true,
//         timeZone: 'Asia/Kolkata' // IST timezone (UTC+5:30)
//       };
      
//       // Convert to IST using Intl API
//       return new Intl.DateTimeFormat('en-IN', options).format(date);
//     } catch (error) {
//       console.error('[ChatbotWidget] Error formatting time:', error, 'Timestamp:', timestamp);
//       return '';
//     }
//   };

//   return (
//     <>
//       {/* Chat Button */}
//       <motion.button
//         onClick={handleToggle}
//         className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-xl flex items-center justify-center text-white transition-all duration-300 hover:scale-110"
//         style={{ 
//           backgroundColor: '#21C1B6',
//           fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif"
//         }}
//         whileHover={{ scale: 1.1 }}
//         whileTap={{ scale: 0.95 }}
//         initial={{ scale: 0 }}
//         animate={{ scale: 1 }}
//         transition={{ type: 'spring', stiffness: 260, damping: 20 }}
//       >
//         <AnimatePresence mode="wait">
//           {isOpen ? (
//             <motion.div
//               key="close"
//               initial={{ rotate: -90, opacity: 0 }}
//               animate={{ rotate: 0, opacity: 1 }}
//               exit={{ rotate: 90, opacity: 0 }}
//               transition={{ duration: 0.2 }}
//             >
//               <X className="w-6 h-6" />
//             </motion.div>
//           ) : (
//             <motion.div
//               key="open"
//               initial={{ rotate: 90, opacity: 0 }}
//               animate={{ rotate: 0, opacity: 1 }}
//               exit={{ rotate: -90, opacity: 0 }}
//               transition={{ duration: 0.2 }}
//             >
//               <MessageCircle className="w-6 h-6" />
//             </motion.div>
//           )}
//         </AnimatePresence>
        
//         {/* Notification badge */}
//         {!isOpen && messages.length > 1 && (
//           <motion.span
//             className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-xs font-bold shadow-lg"
//             style={{ 
//               fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif"
//             }}
//             initial={{ scale: 0 }}
//             animate={{ scale: 1 }}
//             transition={{ type: 'spring', stiffness: 500, damping: 15 }}
//           >
//             {messages.length - 1}
//           </motion.span>
//         )}
//       </motion.button>

//       {/* Chat Window */}
//       <AnimatePresence>
//         {isOpen && (
//           <motion.div
//             className={`fixed z-50 bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden ${
//               isLargeScreen 
//                 ? 'top-4 left-4 right-4 bottom-4 w-auto h-auto' 
//                 : 'bottom-24 right-6 w-96 h-[600px]'
//             }`}
//             style={{ 
//               maxHeight: isLargeScreen ? 'calc(100vh - 32px)' : 'calc(100vh - 120px)',
//               fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif"
//             }}
//             initial={{ opacity: 0, scale: 0.8, y: 20 }}
//             animate={{ opacity: 1, scale: 1, y: 0 }}
//             exit={{ opacity: 0, scale: 0.8, y: 20 }}
//             transition={{ type: 'spring', stiffness: 300, damping: 30 }}
//           >
//             {/* Header */}
//             <div 
//               className="px-5 py-4 flex items-center justify-between text-white shadow-sm"
//               style={{ backgroundColor: '#21C1B6' }}
//             >
//               <div className="flex items-center gap-3">
//                 <Bot className="w-5 h-5" />
//                 <h3 className="font-semibold text-lg tracking-tight">JuriNex AI Assistant</h3>
//               </div>
//               <div className="flex items-center gap-2">
//                 <button
//                   onClick={() => setIsLargeScreen(!isLargeScreen)}
//                   className="p-1.5 hover:bg-white/20 rounded transition-colors"
//                   title={isLargeScreen ? "Minimize" : "Maximize"}
//                 >
//                   {isLargeScreen ? (
//                     <Minimize2 className="w-5 h-5" />
//                   ) : (
//                     <Maximize2 className="w-5 h-5" />
//                   )}
//                 </button>
//                 <button
//                   onClick={handleToggle}
//                   className="p-1 hover:bg-white/20 rounded transition-colors"
//                   title="Close"
//                 >
//                   <X className="w-5 h-5" />
//                 </button>
//               </div>
//             </div>

//             {/* Messages */}
//             <div className={`flex-1 overflow-y-auto bg-gradient-to-b from-gray-50 to-white ${
//               isLargeScreen ? 'p-6' : 'p-4'
//             }`}>
//               <div className={`space-y-5 ${
//                 isLargeScreen ? 'max-w-5xl mx-auto' : ''
//               }`}>
//                 {messages.map((message) => (
//                   <motion.div
//                     key={message.id}
//                     className={`flex gap-3 ${
//                       message.role === 'user' ? 'justify-end' : 'justify-start'
//                     }`}
//                     initial={{ opacity: 0, y: 10 }}
//                     animate={{ opacity: 1, y: 0 }}
//                     transition={{ duration: 0.3 }}
//                   >
//                     {message.role === 'assistant' && (
//                       <div className={`${isLargeScreen ? 'w-10 h-10' : 'w-8 h-8'} rounded-full flex items-center justify-center flex-shrink-0 shadow-sm`} style={{ backgroundColor: '#e0f7f6' }}>
//                         <Bot className={isLargeScreen ? 'w-5 h-5' : 'w-4 h-4'} style={{ color: '#21C1B6' }} />
//                       </div>
//                     )}
                    
//                     <div className={`${isLargeScreen ? 'max-w-[60%]' : 'max-w-[75%]'} ${message.role === 'user' ? 'order-2' : ''}`}>
//                       <div
//                         className={`rounded-xl ${
//                           isLargeScreen ? 'px-6 py-4' : 'px-5 py-3'
//                         } ${
//                           message.role === 'user'
//                             ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-md'
//                             : message.role === 'error'
//                             ? 'bg-red-50 text-red-800 border border-red-200 shadow-sm'
//                             : 'bg-white text-gray-800 shadow-md border border-gray-100'
//                         }`}
//                       >
//                         <div className={`${isLargeScreen ? 'text-base' : 'text-sm'} break-words leading-relaxed font-normal`} style={{ 
//                           fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif",
//                           letterSpacing: '0.01em'
//                         }}>
//                           <ReactMarkdown
//                             remarkPlugins={[remarkGfm]}
//                             components={{
//                               h2: ({node, ...props}) => <h2 className="text-lg font-semibold mt-4 mb-3 text-gray-900 border-b border-gray-200 pb-1" {...props} />,
//                               h3: ({node, ...props}) => <h3 className="text-base font-semibold mt-3 mb-2 text-gray-800" {...props} />,
//                               p: ({node, ...props}) => <p className="mb-2 text-gray-700 leading-relaxed" {...props} />,
//                               ul: ({node, ...props}) => <ul className="list-disc list-outside mb-3 space-y-1.5 ml-4" style={{ listStyleType: 'disc' }} {...props} />,
//                               ol: ({node, ...props}) => <ol className="list-decimal list-outside mb-3 space-y-1.5 ml-4" style={{ listStyleType: 'decimal' }} {...props} />,
//                               li: ({node, ...props}) => <li className="text-gray-700 pl-1" {...props} />,
//                               strong: ({node, ...props}) => <strong className="font-semibold text-gray-900" style={{ fontWeight: 600 }} {...props} />,
//                             }}
//                           >
//                             {message.content}
//                           </ReactMarkdown>
//                         </div>
//                       </div>
//                       <p className="text-xs text-gray-400 mt-2 px-1 font-medium" style={{ 
//                         fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif"
//                       }}>
//                         {formatTime(message.timestamp)}
//                       </p>
//                     </div>

//                     {message.role === 'user' && (
//                       <div className={`${isLargeScreen ? 'w-10 h-10' : 'w-8 h-8'} rounded-full flex items-center justify-center flex-shrink-0 bg-blue-100 order-3 shadow-sm`}>
//                         <User className={`${isLargeScreen ? 'w-5 h-5' : 'w-4 h-4'} text-blue-600`} />
//                       </div>
//                     )}
//                   </motion.div>
//                 ))}

//                 {loading && (
//                   <motion.div
//                     className="flex gap-3 justify-start"
//                     initial={{ opacity: 0 }}
//                     animate={{ opacity: 1 }}
//                   >
//                     <div className={`${isLargeScreen ? 'w-10 h-10' : 'w-8 h-8'} rounded-full flex items-center justify-center flex-shrink-0 shadow-sm`} style={{ backgroundColor: '#e0f7f6' }}>
//                       <Bot className={isLargeScreen ? 'w-5 h-5' : 'w-4 h-4'} style={{ color: '#21C1B6' }} />
//                     </div>
//                     <div className={`bg-white rounded-xl shadow-md border border-gray-100 ${
//                       isLargeScreen ? 'px-6 py-4' : 'px-5 py-3'
//                     }`}>
//                       <div className="flex gap-3 items-center">
//                         <Loader2 className={`${isLargeScreen ? 'w-5 h-5' : 'w-4 h-4'} animate-spin`} style={{ color: '#21C1B6' }} />
//                         <span className={`${isLargeScreen ? 'text-base' : 'text-sm'} text-gray-600 font-medium`} style={{ 
//                           fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif"
//                         }}>Thinking...</span>
//                       </div>
//                     </div>
//                   </motion.div>
//                 )}

//                 <div ref={messagesEndRef} />
//               </div>
//             </div>

//             {/* Error Banner */}
//             {error && (
//               <motion.div
//                 className="mx-4 mb-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 shadow-sm"
//                 style={{ 
//                   fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif",
//                   fontWeight: 500
//                 }}
//                 initial={{ opacity: 0, y: -10 }}
//                 animate={{ opacity: 1, y: 0 }}
//                 exit={{ opacity: 0, y: -10 }}
//               >
//                 {error}
//               </motion.div>
//             )}

//             {/* Input */}
//             <div className={`${isLargeScreen ? 'p-6' : 'p-4'} border-t border-gray-200 bg-white shadow-sm`}>
//               <div className={`flex gap-3 ${isLargeScreen ? 'max-w-5xl mx-auto' : ''}`}>
//                 <input
//                   ref={inputRef}
//                   type="text"
//                   value={input}
//                   onChange={(e) => setInput(e.target.value)}
//                   onKeyPress={handleKeyPress}
//                   placeholder="Ask me queries and questions about JuriNex..."
//                   className={`flex-1 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-offset-0 focus:border-transparent transition-all ${
//                     isLargeScreen ? 'px-5 py-3.5 text-base' : 'px-4 py-3 text-sm'
//                   }`}
//                   style={{ 
//                     focusRingColor: '#21C1B6',
//                     fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif",
//                     fontWeight: 400
//                   }}
//                   disabled={loading}
//                 />
//                 <button
//                   onClick={handleSend}
//                   disabled={!input.trim() || loading}
//                   className={`rounded-xl text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 shadow-md hover:shadow-lg ${
//                     isLargeScreen ? 'px-6 py-3.5' : 'px-5 py-3'
//                   }`}
//                   style={{ 
//                     backgroundColor: '#21C1B6',
//                     fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif"
//                   }}
//                 >
//                   {loading ? (
//                     <Loader2 className={`${isLargeScreen ? 'w-6 h-6' : 'w-5 h-5'} animate-spin`} />
//                   ) : (
//                     <Send className={isLargeScreen ? 'w-6 h-6' : 'w-5 h-5'} />
//                   )}
//                 </button>
//               </div>
//               <p className={`text-gray-500 mt-3 text-center ${isLargeScreen ? 'text-sm' : 'text-xs'} font-medium`} style={{ 
//                 fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif",
//                 letterSpacing: '0.01em'
//               }}>
//                 Ask me anything about JuriNex. As your AI assistant, I'm here to help you with everything.
//               </p>
//             </div>
//           </motion.div>
//         )}
//       </AnimatePresence>
//     </>
//   );
// };

// export default ChatbotWidget;


import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Loader2, Bot, User, Maximize2, Minimize2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import UserChatService from '../services/userChatService';

const ChatbotWidget = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isLargeScreen, setIsLargeScreen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(true);
  
  // Suggestion questions to show to users (short and compact)
  // Map short display text to full questions
  const suggestionQuestions = [
    { display: "What is JuriNex?", question: "What is JuriNex?" },
    { display: "How can it help?", question: "How can JuriNex help me?" },
    { display: "Legal concepts", question: "Tell me about legal concepts" },
    { display: "Services info", question: "What services does JuriNex offer?" }
  ];
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const chatServiceRef = useRef(null);
  const inactivityTimerRef = useRef(null);
  const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  // Helper function to get current IST timestamp
  const getCurrentISTTimestamp = () => {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(now.getTime() + istOffset);
    return istTime.toISOString().replace('Z', '+05:30');
  };

  // Initialize chat service
  useEffect(() => {
    chatServiceRef.current = new UserChatService();
    
    // Short, compact welcome message so the box is smaller
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: "👋 Welcome to JuriNex! I'm your AI legal assistant for understanding legal concepts and JuriNex services. How can I help you today?",
        timestamp: getCurrentISTTimestamp()
      }
    ]);

    return () => {
      if (chatServiceRef.current) {
        chatServiceRef.current.deleteSession().catch(console.error);
      }
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
    };
  }, []);

  // Handle page unload
  useEffect(() => {
    const handleBeforeUnload = async () => {
      if (chatServiceRef.current) {
        const sessionId = chatServiceRef.current.getSessionId();
        if (sessionId) {
          try {
            await fetch(`${chatServiceRef.current.baseUrl}/session/${sessionId}`, {
              method: 'DELETE',
              keepalive: true,
              headers: {
                'X-Service-Name': 'landing-page-chatbot'
              }
            });
          } catch (error) {
            console.error('[ChatbotWidget] Error deleting session on unload:', error);
          }
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Start inactivity timer only when chat is open and user has asked a question
  // Timer will delete session if no questions asked for 5 minutes while chat is open
  const startInactivityTimer = () => {
    // Clear existing timer
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }

    // Only start timer if chat is open
    if (!isOpen) {
      return;
    }

    inactivityTimerRef.current = setTimeout(async () => {
      console.log('[ChatbotWidget] No questions asked for 5 minutes while chat open, deleting session...');
      // Check if chat is still open before deleting
      if (chatServiceRef.current) {
        try {
          await chatServiceRef.current.deleteSession();
          // Reset to welcome message only if chat is still open
          setMessages(prev => {
            // Only reset if chat is still open (check by seeing if there are messages)
            if (prev.length > 0) {
              return [
                {
                  id: 'welcome',
                  role: 'assistant',
                  content: "👋 **Welcome back to JuriNex!**\n\nI'm your AI legal assistant, ready to help you with:\n\n- Understanding legal concepts\n- Information about JuriNex services\n\nHow can I assist you today?",
                  timestamp: getCurrentISTTimestamp()
                }
              ];
            }
            return prev;
          });
        } catch (error) {
          console.error('[ChatbotWidget] Error deleting expired session:', error);
        }
      }
    }, SESSION_TIMEOUT_MS);
  };

  // Clear inactivity timer when chat is closed
  useEffect(() => {
    if (!isOpen && inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
  }, [isOpen]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Handle suggestion click - auto-send the question
  const handleSuggestionClick = async (suggestionItem) => {
    if (loading) return;
    // Use the full question text, not the short display text
    const fullQuestion = typeof suggestionItem === 'string' ? suggestionItem : suggestionItem.question;
    // Directly send the suggestion without setting input
    await handleSend(fullQuestion);
  };

  const handleSend = async (questionText = null) => {
    const question = questionText || input.trim();
    if (!question || loading) return;

    // Clear input if it was typed, keep it if it's from suggestion
    if (!questionText) {
      setInput('');
    }
    setError(null);
    // Start inactivity timer when user asks a question (only if chat is open)
    startInactivityTimer();

    const currentTimestamp = getCurrentISTTimestamp();

    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: question,
      timestamp: currentTimestamp
    };
    setMessages(prev => [...prev, userMessage]);
    setLoading(true);

    try {
      const result = await chatServiceRef.current.chat(question);
      // Reset inactivity timer after getting response (only if chat is still open)
      startInactivityTimer();

      const aiMessage = {
        id: result.message_id || `ai-${Date.now()}`,
        role: 'assistant',
        content: result.answer,
        timestamp: currentTimestamp,
        filesUsed: result.files_used,
        chunksUsed: result.chunks_used
      };
      setMessages(prev => [...prev, aiMessage]);

    } catch (error) {
      console.error('Chat error:', error);
      setError(error.message || 'Failed to get response. Please try again.');
      
      const errorMessage = {
        id: `error-${Date.now()}`,
        role: 'error',
        content: '⚠️ I apologize, but I encountered an error processing your request. Please try again.',
        timestamp: getCurrentISTTimestamp()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleToggle = async () => {
    if (isOpen) {
      // Chat is being closed - delete session immediately
      if (chatServiceRef.current) {
        try {
          await chatServiceRef.current.deleteSession();
          console.log('[ChatbotWidget] Session deleted on chat close');
        } catch (error) {
          console.error('[ChatbotWidget] Error deleting session on close:', error);
        }
      }
      // Clear inactivity timer when closing
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
      setIsLargeScreen(false);
    } else {
      // Chat is being opened - don't start timer yet, wait for user to ask a question
      // Timer will start when user sends first message
    }
    
    setIsOpen(!isOpen);
    if (!isOpen) {
      setError(null);
    }
  };

  const formatTime = (timestamp) => {
    try {
      if (!timestamp) return '';
      
      let date;
      if (timestamp instanceof Date) {
        date = timestamp;
      } else if (typeof timestamp === 'string') {
        date = new Date(timestamp);
      } else {
        return '';
      }
      
      if (isNaN(date.getTime())) {
        console.warn('[ChatbotWidget] Invalid timestamp:', timestamp);
        return '';
      }
      
      const options = { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata'
      };
      
      return new Intl.DateTimeFormat('en-IN', options).format(date);
    } catch (error) {
      console.error('[ChatbotWidget] Error formatting time:', error, 'Timestamp:', timestamp);
      return '';
    }
  };

  return (
    <>
      {/* Custom scrollbar styles */}
      <style>{`
        .chat-messages::-webkit-scrollbar {
          width: 6px;
        }
        .chat-messages::-webkit-scrollbar-track {
          background: transparent;
        }
        .chat-messages::-webkit-scrollbar-thumb {
          background-color: #cbd5e1;
          border-radius: 3px;
        }
        .chat-messages::-webkit-scrollbar-thumb:hover {
          background-color: #94a3b8;
        }
      `}</style>
      
      {/* Chat Button */}
      <motion.button
        onClick={handleToggle}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-xl flex items-center justify-center text-white transition-all duration-300 hover:scale-110"
        style={{ 
          backgroundColor: '#21C1B6',
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
        }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20 }}
      >
        <AnimatePresence mode="wait">
          {isOpen ? (
            <motion.div
              key="close"
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 90, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <X className="w-6 h-6" />
            </motion.div>
          ) : (
            <motion.div
              key="open"
              initial={{ rotate: 90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: -90, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <MessageSquare className="w-6 h-6" />
            </motion.div>
          )}
        </AnimatePresence>
        
        {!isOpen && messages.length > 1 && (
          <motion.span
            className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-xs font-bold shadow-lg"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 15 }}
          >
            {messages.length - 1}
          </motion.span>
        )}
      </motion.button>

      {/* Chat Window */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className={`fixed z-50 bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden ${
              isLargeScreen 
                ? 'top-4 left-4 right-4 bottom-4 w-auto h-auto' 
                : 'bottom-24 right-6 w-96 h-[600px]'
            }`}
            style={{ 
              maxHeight: isLargeScreen ? 'calc(100vh - 32px)' : 'calc(100vh - 120px)',
              fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
            }}
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            {/* Header */}
            <div 
              className="px-4 py-3 flex items-center justify-between text-white"
              style={{ backgroundColor: '#21C1B6' }}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-white rounded flex items-center justify-center">
                  <Bot className="w-5 h-5" style={{ color: '#21C1B6' }} />
                </div>
                <div>
                  <h3 className="font-bold text-base tracking-tight">JuriNex AI</h3>
                  <p className="text-xs text-white/90 font-normal">Legal Assistant</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsLargeScreen(!isLargeScreen)}
                  className="p-1.5 hover:bg-white/20 rounded transition-colors"
                  title={isLargeScreen ? "Minimize" : "Maximize"}
                >
                  {isLargeScreen ? (
                    <Minimize2 className="w-5 h-5" />
                  ) : (
                    <Maximize2 className="w-5 h-5" />
                  )}
                </button>
                <button
                  onClick={handleToggle}
                  className="p-1.5 hover:bg-white/20 rounded transition-colors"
                  title="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div 
              className={`flex-1 overflow-y-auto bg-white chat-messages ${
                isLargeScreen ? 'p-6' : 'p-4'
              }`}
              style={{
                scrollbarWidth: 'thin',
                scrollbarColor: '#cbd5e1 transparent'
              }}
            >
              <div className={`space-y-4 ${
                isLargeScreen ? 'max-w-5xl mx-auto' : ''
              }`}>
                {messages.map((message) => (
                  <motion.div
                    key={message.id}
                    className={`flex gap-3 ${
                      message.role === 'user' ? 'justify-end' : 'justify-start'
                    }`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    {message.role === 'assistant' && (
                      <div className={`${isLargeScreen ? 'w-8 h-8' : 'w-8 h-8'} rounded-full flex items-center justify-center flex-shrink-0`} style={{ backgroundColor: '#f3f4f6' }}>
                        <Bot className={isLargeScreen ? 'w-4 h-4' : 'w-4 h-4'} style={{ color: '#21C1B6' }} />
                      </div>
                    )}
                    
                    <div className={`${isLargeScreen ? 'max-w-[65%]' : 'max-w-[75%]'} ${message.role === 'user' ? 'order-2' : ''}`}>
                      <div
                        className={`rounded-2xl ${
                          isLargeScreen ? 'px-4 py-3' : 'px-4 py-3'
                        } ${
                          message.role === 'user'
                            ? 'text-white'
                            : message.role === 'error'
                            ? 'bg-red-50 text-red-800 border border-red-200'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                        style={message.role === 'user' ? { 
                          backgroundColor: '#21C1B6'
                        } : {}}
                      >
                        <div className={`${isLargeScreen ? 'text-[14px]' : 'text-[14px]'} break-words leading-relaxed`} style={{ 
                          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                          letterSpacing: '0.01em',
                          lineHeight: '1.5',
                          color: message.role === 'user' ? 'white' : '#374151'
                        }}>
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              h2: ({node, ...props}) => (
                                <h2 className="text-[15px] font-bold mt-2 mb-1.5 text-gray-900" {...props} />
                              ),
                              h3: ({node, ...props}) => (
                                <h3 className="text-[14px] font-semibold mt-2 mb-1 text-gray-800" {...props} />
                              ),
                              p: ({node, ...props}) => (
                                <p className="mb-1.5 leading-relaxed" style={{ lineHeight: '1.5' }} {...props} />
                              ),
                              ul: ({node, ...props}) => (
                                <ul className="list-disc mb-2 space-y-1 ml-4" style={{ listStyleType: 'disc' }} {...props} />
                              ),
                              ol: ({node, ...props}) => (
                                <ol className="list-decimal mb-2 space-y-1 ml-4" style={{ listStyleType: 'decimal' }} {...props} />
                              ),
                              li: ({node, ...props}) => (
                                <li className="leading-relaxed" style={{ lineHeight: '1.5' }} {...props} />
                              ),
                              strong: ({node, ...props}) => (
                                <strong className="font-semibold" style={{ fontWeight: 600 }} {...props} />
                              ),
                              em: ({node, ...props}) => (
                                <em className="italic" {...props} />
                              ),
                              hr: ({node, ...props}) => (
                                <hr className="my-2 border-gray-200" {...props} />
                              ),
                            }}
                          >
                            {message.content}
                          </ReactMarkdown>
                        </div>
                      </div>
                      <p className={`text-[11px] text-gray-400 mt-1 px-1 ${message.role === 'user' ? 'text-right' : 'text-left'}`} style={{ 
                        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
                      }}>
                        {formatTime(message.timestamp)}
                      </p>
                    </div>

                    {message.role === 'user' && (
                      <div className={`${isLargeScreen ? 'w-8 h-8' : 'w-8 h-8'} rounded-full flex items-center justify-center flex-shrink-0 order-3`} style={{ backgroundColor: '#f3f4f6' }}>
                        <User className={`${isLargeScreen ? 'w-4 h-4' : 'w-4 h-4'}`} style={{ color: '#6b7280' }} />
                      </div>
                    )}
                  </motion.div>
                ))}

                {loading && (
                  <motion.div
                    className="flex gap-3 justify-start"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    <div className={`${isLargeScreen ? 'w-10 h-10' : 'w-9 h-9'} rounded-full flex items-center justify-center flex-shrink-0 shadow-sm`} style={{ backgroundColor: '#e0f7f6' }}>
                      <Bot className={isLargeScreen ? 'w-5 h-5' : 'w-5 h-5'} style={{ color: '#21C1B6' }} />
                    </div>
                    <div className={`bg-gray-100 rounded-2xl ${
                      isLargeScreen ? 'px-4 py-3' : 'px-4 py-3'
                    }`}>
                      <div className="flex gap-2.5 items-center">
                        <Loader2 className={`${isLargeScreen ? 'w-4 h-4' : 'w-4 h-4'} animate-spin`} style={{ color: '#21C1B6' }} />
                        <span className={`${isLargeScreen ? 'text-[14px]' : 'text-[14px]'} text-gray-600 font-medium`}>
                          Analyzing your query...
                        </span>
                      </div>
                    </div>
                  </motion.div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Error Banner */}
            {error && (
              <motion.div
                className="mx-4 mb-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 shadow-sm"
                style={{ 
                  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                  fontWeight: 500
                }}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                {error}
              </motion.div>
            )}

            {/* Suggestion Questions - always show after responses (when not loading) to keep users engaged */}
            {!loading && showSuggestions && (
              <div className={`px-4 pb-3 ${isLargeScreen ? 'px-6' : ''}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex-1"></div>
                  <button
                    onClick={() => setShowSuggestions(false)}
                    className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-full transition-colors"
                    style={{ 
                      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
                    }}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className={`grid grid-cols-2 gap-2 ${isLargeScreen ? 'max-w-5xl mx-auto' : ''}`}>
                  {suggestionQuestions.map((suggestion, index) => (
                    <motion.button
                      key={index}
                      onClick={() => handleSuggestionClick(suggestion)}
                      disabled={loading}
                      className="px-3 py-1.5 text-xs text-white rounded-full transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
                      style={{ 
                        backgroundColor: '#21C1B6',
                        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                        fontWeight: 500
                      }}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.1 }}
                    >
                      {suggestion.display}
                    </motion.button>
                  ))}
                </div>
              </div>
            )}

            {/* Input */}
            <div className={`${isLargeScreen ? 'p-4' : 'p-4'} border-t border-gray-200 bg-white`}>
              <div className={`flex gap-2 ${isLargeScreen ? 'max-w-5xl mx-auto' : ''}`}>
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Ask about legal concepts, JuriNex serv..."
                  className={`flex-1 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-0 focus:border-transparent transition-all ${
                    isLargeScreen ? 'px-4 py-2.5 text-[14px]' : 'px-4 py-2.5 text-[14px]'
                  }`}
                  style={{ 
                    focusRingColor: '#20c997',
                    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                    fontWeight: 400
                  }}
                  disabled={loading}
                />
                <button
                  onClick={() => handleSend()}
                  disabled={!input.trim() || loading}
                  className={`rounded-lg text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 ${
                    isLargeScreen ? 'px-4 py-2.5' : 'px-4 py-2.5'
                  }`}
                  style={{ 
                    backgroundColor: '#21C1B6',
                    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
                  }}
                >
                  {loading ? (
                    <Loader2 className={`${isLargeScreen ? 'w-5 h-5' : 'w-5 h-5'} animate-spin`} />
                  ) : (
                    <Send className={isLargeScreen ? 'w-5 h-5' : 'w-5 h-5'} />
                  )}
                </button>
              </div>
              <p className={`text-gray-500 mt-2 text-center ${isLargeScreen ? 'text-[12px]' : 'text-[12px]'} font-normal`} style={{ 
                fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
              }}>
                Powered by Nexintel AI • Ask Your Queries Here
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default ChatbotWidget;