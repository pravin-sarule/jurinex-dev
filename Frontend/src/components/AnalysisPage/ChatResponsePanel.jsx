import React, { useRef, useEffect, useState } from 'react';
import { Bot, MessageSquare, Copy, Download, FileText, ArrowRight, Printer, Code } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import {
  formatChatResponseForDisplay,
  chatResponseLooksLikeHtml,
} from '../../utils/formatChatResponse';
import { getCleanText, downloadAsHtml, printResponse } from '../../utils/responseExportUtils';
import {
  ensureTableSeparators,
  markdownTableComponents,
  splitMarkdownIntoRenderChunks,
} from '../../utils/markdownUtils';
import BrandingDownloadModal from '../BrandingDownload/BrandingDownloadModal';
import '../../styles/ChatInterface.css';

const ChatResponsePanel = ({
 selectedMessageId,
 currentResponse,
 animatedResponseContent,
 messages,
 formatDate,
 isAnimatingResponse,
 showResponseImmediately,
 setSuccess,
 setError,
 stopGeneration,
 isLoading,
 isGeneratingInsights,
 fileId
}) => {
 const responseRef = useRef(null);
 const markdownOutputRef = useRef(null);
 const contentRef = useRef(null);
 const stickyScrollbarRef = useRef(null);
 const horizontalScrollRef = useRef(null);
 const [scrollbarWidth, setScrollbarWidth] = useState(0);
 const [showDownloadModal, setShowDownloadModal] = useState(false);
 const [showWordModal, setShowWordModal] = useState(false);

 useEffect(() => {
 if (responseRef.current && isAnimatingResponse) {
 responseRef.current.scrollTop = responseRef.current.scrollHeight;
 }
 }, [animatedResponseContent, isAnimatingResponse]);

 useEffect(() => {
 const responseElement = responseRef.current;
 if (!responseElement) return;

 responseElement.style.scrollbarWidth = 'thin';
 
 }, []);

 useEffect(() => {
 const horizontalElement = horizontalScrollRef.current;
 const markdownElement = markdownOutputRef.current;
 const stickyScrollbar = stickyScrollbarRef.current;
 
 if (!horizontalElement || !markdownElement || !stickyScrollbar) return;

 const updateScrollbar = () => {
 const scrollWidth = markdownElement.scrollWidth;
 const clientWidth = horizontalElement.clientWidth;
 
 if (scrollWidth > clientWidth) {
 setScrollbarWidth(scrollWidth);
 stickyScrollbar.scrollLeft = horizontalElement.scrollLeft;
 } else {
 setScrollbarWidth(0);
 }
 };

 const updateScrollbarDelayed = () => {
 setTimeout(() => {
 updateScrollbar();
 }, 100);
 };

 updateScrollbarDelayed();

 const handleHorizontalScroll = () => {
 if (stickyScrollbar) {
 stickyScrollbar.scrollLeft = horizontalElement.scrollLeft;
 }
 };

 const handleScrollbarScroll = () => {
 horizontalElement.scrollLeft = stickyScrollbar.scrollLeft;
 };

 horizontalElement.addEventListener('scroll', handleHorizontalScroll);
 stickyScrollbar.addEventListener('scroll', handleScrollbarScroll);

 const resizeObserver = new ResizeObserver(() => {
 updateScrollbar();
 });
 resizeObserver.observe(markdownElement);
 resizeObserver.observe(horizontalElement);

 const handleWindowResize = () => {
 updateScrollbar();
 };
 window.addEventListener('resize', handleWindowResize);

 return () => {
 horizontalElement.removeEventListener('scroll', handleHorizontalScroll);
 stickyScrollbar.removeEventListener('scroll', handleScrollbarScroll);
 window.removeEventListener('resize', handleWindowResize);
 resizeObserver.disconnect();
 };
 }, [selectedMessageId, currentResponse, animatedResponseContent, scrollbarWidth]);

 const handleCopyResponse = async () => {
 try {
   // Use the rendered DOM's innerText — gives clean text with no markdown symbols
   const text = getCleanText(markdownOutputRef.current, animatedResponseContent || currentResponse);
   if (text && text.trim()) {
     await navigator.clipboard.writeText(text.trim());
     setSuccess('AI response copied to clipboard!');
   } else {
     setError('No response to copy.');
   }
 } catch (err) {
   console.error('Failed to copy AI response:', err);
   setError('Failed to copy response.');
 }
 };

 const handleDownloadPdf = () => {
   if (!markdownOutputRef.current) {
     setError('No content to download as PDF.');
     return;
   }
   setShowDownloadModal(true);
 };


 const handleDownloadWord = () => {
   if (!markdownOutputRef.current) {
     setError('No content to download as Word document.');
     return;
   }
   setShowWordModal(true);
 };

 const markdownComponents = {
 ...markdownTableComponents,
 h1: ({node, ...props}) => (
 <h1 className="text-4xl font-bold mb-8 mt-8 text-gray-900 border-b-2 border-blue-500 pb-4 analysis-page-ai-response tracking-tight" {...props} />
 ),
 h2: ({node, ...props}) => (
 <h2 className="text-2xl font-bold mb-6 mt-8 text-gray-900 border-b border-gray-300 pb-3 analysis-page-ai-response tracking-tight" {...props} />
 ),
 h3: ({node, ...props}) => (
 <h3 className="text-xl font-semibold mb-4 mt-6 text-gray-800 analysis-page-ai-response" {...props} />
 ),
 h4: ({node, ...props}) => (
 <h4 className="text-lg font-semibold mb-3 mt-5 text-gray-800 analysis-page-ai-response" {...props} />
 ),
 h5: ({node, ...props}) => (
 <h5 className="text-base font-semibold mb-2 mt-4 text-gray-700 analysis-page-ai-response" {...props} />
 ),
 h6: ({node, ...props}) => (
 <h6 className="text-sm font-semibold mb-2 mt-3 text-gray-700 analysis-page-ai-response" {...props} />
 ),
 p: ({node, ...props}) => (
 <p className="mb-5 leading-relaxed text-gray-800 text-[15px] analysis-page-ai-response" {...props} />
 ),
 strong: ({node, ...props}) => (
 <strong className="font-bold text-gray-900" {...props} />
 ),
 em: ({node, ...props}) => (
 <em className="italic text-gray-800" {...props} />
 ),
 ul: ({node, ...props}) => (
 <ul className="list-disc pl-6 mb-4 space-y-2 text-gray-800" {...props} />
 ),
 ol: ({node, ...props}) => (
 <ol className="list-decimal pl-6 mb-4 space-y-2 text-gray-800" {...props} />
 ),
 li: ({node, ...props}) => (
 <li className="leading-relaxed text-gray-800 analysis-page-ai-response" {...props} />
 ),
 a: ({node, children, ...props}) => (
 <a
 {...props}
 className="text-blue-600 hover:text-blue-800 underline font-medium transition-colors"
 target="_blank"
 rel="noopener noreferrer"
 >
   {children}
 </a>
 ),
 blockquote: ({node, ...props}) => (
 <blockquote className="border-l-4 border-blue-500 pl-6 py-3 my-6 bg-blue-50 text-gray-800 italic rounded-r-lg analysis-page-ai-response shadow-sm" {...props} />
 ),
 code: ({node, inline, className, children, ...props}) => {
 const match = /language-(\w+)/.exec(className || '');
 const language = match ? match[1] : '';
 
 if (inline) {
 return (
 <code
 className="bg-gray-100 text-red-600 px-1.5 py-0.5 rounded text-sm font-mono border border-gray-200"
 {...props}
 >
 {children}
 </code>
 );
 }
 
 return (
 <div className="relative my-4">
 {language && (
 <div className="bg-gray-800 text-gray-300 text-xs px-3 py-1 rounded-t font-mono">
 {language}
 </div>
 )}
 <pre className={`bg-gray-900 text-gray-100 p-4 ${language ? 'rounded-b' : 'rounded'} overflow-x-auto`}>
 <code className="font-mono text-sm" {...props}>
 {children}
 </code>
 </pre>
 </div>
 );
 },
 pre: ({node, ...props}) => (
 <pre className="bg-gray-900 text-gray-100 p-4 rounded my-4 overflow-x-auto" {...props} />
 ),
 table: ({node, ...props}) => (
 <div className="md-table-scroll">
   <table {...props} />
 </div>
 ),
 thead: ({node, ...props}) => (
 <thead {...props} />
 ),
 th: ({node, ...props}) => (
 <th {...props} />
 ),
 tbody: ({node, ...props}) => (
 <tbody {...props} />
 ),
 tr: ({node, ...props}) => (
 <tr {...props} />
 ),
 td: ({node, ...props}) => (
 <td {...props} />
 ),
 hr: ({node, ...props}) => (
 <hr className="my-6 border-t-2 border-gray-300" {...props} />
 ),
 img: ({node, ...props}) => (
 <img className="max-w-full h-auto rounded-lg shadow-md my-4" alt="" {...props} />
 ),
 };

 const isGenerating = isAnimatingResponse || isLoading || isGeneratingInsights;

 return (
<div className="w-3/5 flex flex-col h-full bg-gray-50 relative">
 <style>{`
   .response-scroll-container {
    overflow-y: auto;
    overflow-x: hidden;
     scrollbar-width: thin;
   }
  .horizontal-scroll-container {
    overflow-x: auto;
    overflow-y: visible;
  }
  .horizontal-scroll-container::-webkit-scrollbar {
    height: 0px;
   }
 `}</style>
 <div 
  className="flex-1 response-scroll-container" 
  ref={responseRef}
 >
 {selectedMessageId && (currentResponse || animatedResponseContent) ? (
 <div className="px-6 py-6" ref={contentRef}>
 <div className="max-w-none" style={{ minWidth: 'fit-content' }}>
 <div className="mb-6 pb-4 border-b border-gray-200 bg-white rounded-lg p-4 shadow-sm">
 <div className="flex items-center justify-between mb-3">
 <h2 className="text-xl font-semibold text-gray-900 flex items-center">
 <Bot className="h-5 w-5 mr-2 text-blue-600" />
 AI Response
 </h2>
 <div className="flex items-center space-x-2 text-sm text-gray-500">
 <button
 onClick={handleCopyResponse}
 className="flex items-center px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors cursor-pointer"
 title="Copy AI Response"
 >
 <Copy className="h-4 w-4 mr-1" />
 Copy
 </button>
 <button
 onClick={handleDownloadPdf}
 className="flex items-center px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors cursor-pointer"
 title="Download AI Response as PDF"
 >
 <Download className="h-4 w-4 mr-1" />
 PDF
 </button>
 <button
 onClick={handleDownloadWord}
 className="flex items-center px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors cursor-pointer"
 title="Download AI Response as Word document"
 >
 <FileText className="h-4 w-4 mr-1" />
 Word
 </button>
 <button
 onClick={() => downloadAsHtml(markdownOutputRef.current, `AI_Response_${new Date().toISOString().slice(0, 10)}.html`)}
 className="flex items-center px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors cursor-pointer"
 title="Download AI Response as HTML file"
 >
 <Code className="h-4 w-4 mr-1" />
 HTML
 </button>
 <button
 onClick={() => printResponse(markdownOutputRef.current)}
 className="flex items-center px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors cursor-pointer"
 title="Print AI Response"
 >
 <Printer className="h-4 w-4 mr-1" />
 Print
 </button>
 {messages.find(msg => msg.id === selectedMessageId)?.timestamp && (
 <span>{formatDate(messages.find(msg => msg.id === selectedMessageId).timestamp)}</span>
 )}
 {messages.find(msg => msg.id === selectedMessageId)?.session_id && (
 <>
 <span>•</span>
 <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">
 {messages.find(msg => msg.id === selectedMessageId).session_id.split('-')[1]?.substring(0, 6) || 'N/A'}
 </span>
 </>
 )}
 </div>
 </div>
 
 <div className="p-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border-l-4 border-blue-500">
 <p className="text-sm font-medium text-blue-900 mb-1 flex items-center">
 <MessageSquare className="h-4 w-4 mr-1" />
 Question:
 </p>
 <p className="text-sm text-blue-800 leading-relaxed">
 {messages.find(msg => msg.id === selectedMessageId)?.question || 'No question available'}
 </p>
 </div>

 {isAnimatingResponse && (
 <div className="mt-3 flex justify-end">
 <button
 onClick={() => showResponseImmediately(currentResponse)}
 className="text-xs text-blue-600 hover:text-blue-800 flex items-center space-x-1 transition-colors"
 >
 <span>Skip animation</span>
 <ArrowRight className="h-3 w-3" />
 </button>
 </div>
 )}
 </div>

<div className="bg-white rounded-lg shadow-sm p-6">
<div
className="horizontal-scroll-container"
ref={horizontalScrollRef}
>
{(() => {
  // First, get the selected message and its response
  const selectedMessage = messages.find(msg => msg.id === selectedMessageId);
  const messageResponse = selectedMessage?.answer || selectedMessage?.response || '';
  
  // Always prioritize the message's stored response
  // Only use animatedResponseContent during active generation for the current message
  // Only use currentResponse as a last resort if message has no stored response
  let rawResponse = '';
  if (messageResponse) {
    // Message has a stored response - always use it
    rawResponse = messageResponse;
  } else if (isAnimatingResponse && animatedResponseContent) {
    // During active generation, use animated content
    rawResponse = animatedResponseContent;
  } else if (currentResponse) {
    // Last resort: use currentResponse only if message has no stored response
    rawResponse = currentResponse;
  }
  
  if (!rawResponse) return null;
  
  const responseContent = formatChatResponseForDisplay(rawResponse);
  
  if (!responseContent) return null;

  const isHTML = chatResponseLooksLikeHtml(responseContent);
  
  return (
    <div 
      className={isHTML ? 'word-document-style' : 'formatted-assistant-markdown analysis-page-response'} 
      ref={markdownOutputRef} 
      style={{ minWidth: 'fit-content' }}
    >
      {isHTML ? (
        <div 
          dangerouslySetInnerHTML={{ __html: responseContent }}
          style={{
            fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
            lineHeight: '1.75',
            color: '#1f1f1f',
            fontSize: '15px'
          }}
        />
      ) : (
        splitMarkdownIntoRenderChunks(ensureTableSeparators(responseContent)).map((chunk, index) => (
          <ReactMarkdown
            key={`${index}-${chunk.length}`}
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw, rehypeSanitize]}
            components={markdownComponents}
          >
            {chunk}
          </ReactMarkdown>
        ))
      )}
      
      {isAnimatingResponse && (
        <span className="inline-flex items-center ml-1">
          <span className="inline-block w-2 h-5 bg-blue-600 animate-pulse"></span>
        </span>
      )}
    </div>
  );
})()}
</div>
 </div>
 </div>
 </div>
 ) : (
 <div className="flex items-center justify-center h-full">
 <div className="text-center max-w-md px-6">
 <div className="bg-white rounded-full p-6 inline-block mb-6 shadow-lg">
 <MessageSquare className="h-16 w-16 text-blue-500" />
 </div>
 <h3 className="text-2xl font-semibold mb-4 text-gray-900">Select a Question</h3>
 <p className="text-gray-600 text-lg leading-relaxed">
 Click on any question from the left panel to view the AI response here.
 </p>
 </div>
 </div>
 )}
 </div>
 
 {scrollbarWidth > 0 && (
 <div 
 ref={stickyScrollbarRef}
 className="overflow-x-auto overflow-y-hidden bg-gray-100 border-t border-gray-300 z-10 flex-shrink-0"
 style={{ 
 height: '17px',
 scrollbarWidth: 'thin',
 scrollbarColor: '#9CA3AF #E5E7EB',
 WebkitOverflowScrolling: 'touch'
 }}
 >
 <div style={{ width: `${scrollbarWidth}px`, height: '1px' }}></div>
 </div>
 )}

 <BrandingDownloadModal
   isOpen={showDownloadModal}
   onClose={() => setShowDownloadModal(false)}
   contentRef={markdownOutputRef}
   filename={`AI_Response_${new Date().toISOString().slice(0, 10)}.pdf`}
   format="pdf"
   module="analysis-response"
 />
 <BrandingDownloadModal
   isOpen={showWordModal}
   onClose={() => setShowWordModal(false)}
   contentRef={markdownOutputRef}
   filename={`AI_Response_${new Date().toISOString().slice(0, 10)}.docx`}
   format="word"
   module="analysis-response"
 />
 </div>
 );
};

export default ChatResponsePanel;
