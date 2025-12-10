// import React from 'react';
// import ReactMarkdown from 'react-markdown';
// import remarkGfm from 'remark-gfm';
// import rehypeRaw from 'rehype-raw';
// import rehypeSanitize from 'rehype-sanitize';
// import { Bot, Copy, MessageSquare, ArrowRight } from 'lucide-react';
// import DownloadPdf from '../DownloadPdf/DownloadPdf';

// const DocumentViewer = ({
//   selectedMessageId,
//   currentResponse,
//   animatedResponseContent,
//   messages,
//   handleCopyResponse,
//   markdownOutputRef,
//   isAnimatingResponse,
//   showResponseImmediately,
//   formatDate,
//   markdownComponents,
// }) => {
//   if (!selectedMessageId || (!currentResponse && !animatedResponseContent)) {
//     return (
//       <div className="flex items-center justify-center h-full">
//         <div className="text-center text-gray-400">
//           <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
//           <p className="text-base font-medium">Select a question to view the response</p>
//         </div>
//       </div>
//     );
//   }

//   const selectedMessage = messages.find((msg) => msg.id === selectedMessageId);

//   return (
//     <div className="px-2 sm:px-4 py-2 sm:py-4">
//       <div className="max-w-none">
//         {/* Header Section */}
//         <div className="mb-3 sm:mb-4 pb-2 sm:pb-3 border-b border-gray-200 bg-white rounded-lg p-2 sm:p-3 shadow-sm">
//           <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2 sm:mb-2.5">
//             <h2 className="text-base sm:text-lg font-semibold text-gray-900 flex items-center">
//               <Bot className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-1.5 text-[#21C1B6]" />
//               JuriNex Response
//             </h2>
//             <div className="flex items-center flex-wrap gap-1 sm:gap-1.5 text-xs text-gray-500">
//               <button
//                 onClick={handleCopyResponse}
//                 className="flex items-center px-2.5 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
//                 title="Copy AI Response"
//               >
//                 <Copy className="h-3 w-3 mr-1" />
//                 Copy
//               </button>
//               <DownloadPdf
//                 markdownOutputRef={markdownOutputRef}
//                 questionTitle={selectedMessage?.question || selectedMessage?.display_text_left_panel || 'AI_Analysis'}
//               />
//               {selectedMessage?.timestamp && (
//                 <span>{formatDate(selectedMessage.timestamp)}</span>
//               )}
//               {selectedMessage?.session_id && (
//                 <>
//                   <span>•</span>
//                   <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">
//                     {selectedMessage.session_id.split('-')[1]?.substring(0, 6) || 'N/A'}
//                   </span>
//                 </>
//               )}
//             </div>
//           </div>
//           {/* Question Display */}
//           <div className="p-2 sm:p-2.5 bg-gradient-to-r from-[#E0F7F6] to-indigo-50 rounded-lg border-l-4 border-[#21C1B6]">
//             <p className="text-xs font-medium text-[#21C1B6] mb-1 flex items-center">
//               <MessageSquare className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-1" />
//               Question:
//             </p>
//             <p className="text-xs text-[#21C1B6] leading-relaxed break-words">
//               {selectedMessage?.question || 'No question available'}
//             </p>
//           </div>
//           {/* Skip Animation Button */}
//           {isAnimatingResponse && (
//             <div className="mt-2 flex justify-end">
//               <button
//                 onClick={() => showResponseImmediately(currentResponse)}
//                 className="text-xs text-[#21C1B6] hover:text-[#1AA49B] flex items-center space-x-1"
//               >
//                 <span>Skip animation</span>
//                 <ArrowRight className="h-2.5 w-2.5" />
//               </button>
//             </div>
//           )}
//         </div>
//         {/* Response Content */}
//         <div className="bg-white rounded-lg shadow-sm p-2 sm:p-4 overflow-hidden">
//           <div className="prose prose-gray prose-sm max-w-none" ref={markdownOutputRef}>
//             <ReactMarkdown
//               remarkPlugins={[remarkGfm]}
//               rehypePlugins={[rehypeRaw, rehypeSanitize]}
//               components={markdownComponents}
//             >
//               {animatedResponseContent || currentResponse || ''}
//             </ReactMarkdown>
//             {/* Typing Indicator */}
//             {isAnimatingResponse && (
//               <span className="inline-flex items-center ml-1">
//                 <span className="inline-block w-1.5 h-4 bg-[#21C1B6] animate-pulse"></span>
//               </span>
//             )}
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default DocumentViewer;



import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { Bot, Copy, MessageSquare, ArrowRight } from 'lucide-react';
import DownloadPdf from '../DownloadPdf/DownloadPdf';
import { convertJsonToPlainText } from '../../utils/jsonToPlainText';

const DocumentViewer = ({
  selectedMessageId,
  currentResponse,
  animatedResponseContent,
  messages,
  handleCopyResponse,
  markdownOutputRef,
  isAnimatingResponse,
  showResponseImmediately,
  formatDate,
  markdownComponents,
  responseContainerRef,
  fileId,
}) => {
  const horizontalScrollRef = useRef(null);
  const stickyScrollbarRef = useRef(null);
  const [needsHorizontalScroll, setNeedsHorizontalScroll] = useState(false);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);

  useEffect(() => {
    const horizontalElement = horizontalScrollRef.current;
    const contentElement = markdownOutputRef?.current;

    if (!horizontalElement || !contentElement) return undefined;

    const updateScrollbarState = () => {
      const scrollWidth = contentElement.scrollWidth;
      const clientWidth = horizontalElement.clientWidth;
      const needsScroll = scrollWidth > clientWidth + 1;

      setNeedsHorizontalScroll(needsScroll);
      if (needsScroll) {
        setScrollbarWidth(scrollWidth);
      }
    };

    updateScrollbarState();

    const resizeObserver = new ResizeObserver(() => {
      updateScrollbarState();
    });
    resizeObserver.observe(contentElement);
    resizeObserver.observe(horizontalElement);

    window.addEventListener('resize', updateScrollbarState);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateScrollbarState);
    };
  }, [selectedMessageId, currentResponse, animatedResponseContent, markdownOutputRef]);

  useEffect(() => {
    if (!needsHorizontalScroll) return undefined;

    const horizontalElement = horizontalScrollRef.current;
    const stickyElement = stickyScrollbarRef.current;

    if (!horizontalElement || !stickyElement) return undefined;

    const syncSticky = () => {
      stickyElement.scrollLeft = horizontalElement.scrollLeft;
    };

    const syncContent = () => {
      horizontalElement.scrollLeft = stickyElement.scrollLeft;
    };

    stickyElement.scrollLeft = horizontalElement.scrollLeft;
    horizontalElement.addEventListener('scroll', syncSticky);
    stickyElement.addEventListener('scroll', syncContent);

    return () => {
      horizontalElement.removeEventListener('scroll', syncSticky);
      stickyElement.removeEventListener('scroll', syncContent);
    };
  }, [needsHorizontalScroll]);

  // Auto-scroll to bottom when content changes during streaming
  useEffect(() => {
    if (responseContainerRef?.current && (currentResponse || animatedResponseContent)) {
      // Small delay to ensure DOM is updated
      const timeout = setTimeout(() => {
        if (responseContainerRef.current) {
          responseContainerRef.current.scrollTop = responseContainerRef.current.scrollHeight;
        }
      }, 100);
      return () => clearTimeout(timeout);
    }
  }, [currentResponse, animatedResponseContent, responseContainerRef]);

  // Show content if we have selectedMessageId and either currentResponse or animatedResponseContent
  // Also show if message is streaming (isStreaming flag)
  const selectedMessage = messages.find((msg) => msg.id === selectedMessageId);
  const hasContent = currentResponse || animatedResponseContent;
  const isStreaming = selectedMessage?.isStreaming;
  
  if (!selectedMessageId || (!hasContent && !isStreaming)) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-400">
          <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p className="text-base font-medium">Select a question to view the response</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="px-2 sm:px-4 pt-2 sm:pt-4 flex-shrink-0">
        <div className="max-w-none">
          {/* Header Section */}
          <div className="pb-2 sm:pb-3 border-b border-gray-200 bg-white rounded-lg p-2 sm:p-3 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2 sm:mb-2.5">
              <h2 className="text-base sm:text-lg font-semibold text-gray-900 flex items-center">
                <Bot className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-1.5 text-[#21C1B6]" />
                JuriNex Response
              </h2>
              <div className="flex items-center flex-wrap gap-1 sm:gap-1.5 text-xs text-gray-500">
                <button
                  onClick={handleCopyResponse}
                  className="flex items-center px-2.5 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
                  title="Copy AI Response"
                >
                  <Copy className="h-3 w-3 mr-1" />
                  Copy
                </button>
                <DownloadPdf
                  markdownOutputRef={markdownOutputRef}
                  questionTitle={selectedMessage?.question || selectedMessage?.display_text_left_panel || 'AI_Analysis'}
                />
                {selectedMessage?.timestamp && (
                  <span>{formatDate(selectedMessage.timestamp)}</span>
                )}
                {selectedMessage?.session_id && (
                  <>
                    <span>•</span>
                    <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                      {selectedMessage.session_id.split('-')[1]?.substring(0, 6) || 'N/A'}
                    </span>
                  </>
                )}
              </div>
            </div>
            {/* Question Display */}
            <div className="p-2 sm:p-2.5 bg-gradient-to-r from-[#E0F7F6] to-indigo-50 rounded-lg border-l-4 border-[#21C1B6]">
              <p className="text-xs font-medium text-[#21C1B6] mb-1 flex items-center">
                <MessageSquare className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-1" />
                Question:
              </p>
              <p className="text-xs text-[#21C1B6] leading-relaxed break-words max-h-32 overflow-y-auto">
                {selectedMessage?.question || 'No question available'}
              </p>
            </div>
            {/* Skip Animation Button */}
            {isAnimatingResponse && (
              <div className="mt-2 flex justify-end">
                <button
                  onClick={() => showResponseImmediately(currentResponse)}
                  className="text-xs text-[#21C1B6] hover:text-[#1AA49B] flex items-center space-x-1"
                >
                  <span>Skip animation</span>
                  <ArrowRight className="h-2.5 w-2.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Response Content - Scrollable Container */}
      <div
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2 sm:px-4 pb-2 sm:pb-4 response-scroll-container"
        ref={responseContainerRef ?? null}
      >
        <div className="bg-white rounded-lg shadow-sm p-2 sm:p-4 relative overflow-visible max-w-none">
          <style>{`
            .document-viewer-horizontal-container {
              overflow-x: auto;
              overflow-y: hidden;
              scrollbar-width: none;
            }
            .document-viewer-horizontal-container::-webkit-scrollbar {
              display: none;
            }
            /* Ensure scrollbar is visible and functional */
            .response-scroll-container {
              scrollbar-width: thin;
              scrollbar-color: #9CA3AF #E5E7EB;
            }
            .response-scroll-container::-webkit-scrollbar {
              width: 8px;
            }
            .response-scroll-container::-webkit-scrollbar-track {
              background: #F3F4F6;
              border-radius: 4px;
            }
            .response-scroll-container::-webkit-scrollbar-thumb {
              background: #9CA3AF;
              border-radius: 4px;
            }
            .response-scroll-container::-webkit-scrollbar-thumb:hover {
              background: #6B7280;
            }
          `}</style>
          <div className="space-y-2 pb-10">
            <div
              className="document-viewer-horizontal-container"
              ref={horizontalScrollRef}
            >
              <div
                className="prose prose-gray prose-sm max-w-none"
                ref={markdownOutputRef}
                style={{ minWidth: 'fit-content' }}
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw, rehypeSanitize]}
                  components={markdownComponents}
                >
                  {convertJsonToPlainText(
                    isAnimatingResponse
                      ? animatedResponseContent
                      : animatedResponseContent || currentResponse || ''
                  )}
                </ReactMarkdown>
                {/* Typing Indicator - Show during animation or streaming */}
                {(isAnimatingResponse || isStreaming) && (
                  <span className="inline-flex items-center ml-1">
                    <span className="inline-block w-1.5 h-4 bg-[#21C1B6] animate-pulse"></span>
                  </span>
                )}
              </div>
            </div>
          </div>
          {needsHorizontalScroll && (
            <div className="sticky bottom-0 left-0 right-0 pt-2 bg-white z-10">
              <div
                ref={stickyScrollbarRef}
                className="overflow-x-auto overflow-y-hidden bg-gray-100 border border-gray-200 rounded-lg shadow-sm"
                style={{
                  height: '16px',
                  scrollbarWidth: 'thin',
                  scrollbarColor: '#9CA3AF #E5E7EB',
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                <div style={{ width: `${scrollbarWidth}px`, height: '1px' }} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DocumentViewer;