import React, { useRef, useEffect, useState } from 'react';
import { Bot, MessageSquare, Copy, Download, ArrowRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import jsPDF from 'jspdf';
import { convertJsonToPlainText } from '../../utils/jsonToPlainText';
import { renderSecretPromptResponse, isStructuredJsonResponse } from '../../utils/renderSecretPromptResponse';
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
 const [isPdfLoading, setIsPdfLoading] = useState(false);

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
 const textToCopy = animatedResponseContent || currentResponse;
 if (textToCopy) {
 const tempDiv = document.createElement('div');
 tempDiv.innerHTML = textToCopy;
 await navigator.clipboard.writeText(tempDiv.innerText);
 setSuccess('AI response copied to clipboard!');
 } else {
 setError('No response to copy.');
 }
 } catch (err) {
 console.error('Failed to copy AI response:', err);
 setError('Failed to copy response.');
 }
 };

 const handleDownloadPdf = async () => {
 const element = markdownOutputRef.current;
 if (!element) {
 setError('No content to download as PDF.');
 return;
 }

 setIsPdfLoading(true);
 setError(null);
 setSuccess(null);

 try {
 const clonedElement = element.cloneNode(true);

 const now = new Date();
 const year = now.getFullYear();
 const month = String(now.getMonth() + 1).padStart(2, '0');
 const day = String(now.getDate()).padStart(2, '0');
 let hours = now.getHours();
 const minutes = String(now.getMinutes()).padStart(2, '0');
 const ampm = hours >= 12 ? 'PM' : 'AM';
 hours = hours % 12;
 hours = hours ? hours : 12;
 const formattedTime = `${year}-${month}-${day}_${hours}-${minutes}${ampm}`;

 const pdf = new jsPDF('p', 'mm', 'a4');
 const pageWidth = 210;
 const pageHeight = 297;
 const margin = 20;
 const contentWidth = pageWidth - (2 * margin);
 let currentY = margin;
 const lineHeight = 7;
 const spacing = 5;

 const checkPageBreak = (requiredHeight) => {
 if (currentY + requiredHeight > pageHeight - margin) {
 pdf.addPage();
 currentY = margin;
 return true;
 }
 return false;
 };

 const addText = (text, fontSize = 12, isBold = false, color = [0, 0, 0]) => {
 if (!text || text.trim() === '') return 0;

 pdf.setFontSize(fontSize);
 pdf.setFont('helvetica', isBold ? 'bold' : 'normal');
 pdf.setTextColor(color[0], color[1], color[2]);

 const lines = pdf.splitTextToSize(text, contentWidth);
 const textHeight = lines.length * (fontSize * 0.35);

 checkPageBreak(textHeight);

 lines.forEach((line) => {
 if (currentY > pageHeight - margin - 10) {
 pdf.addPage();
 currentY = margin;
 }
 pdf.text(line, margin, currentY);
 currentY += fontSize * 0.35;
 });

 return textHeight;
 };

 const getPlainText = (element) => {
 if (!element) return '';
 if (element.nodeType === Node.TEXT_NODE) {
 return element.textContent || '';
 }
 let text = '';
 for (const node of element.childNodes) {
 if (node.nodeType === Node.TEXT_NODE) {
 text += node.textContent || '';
 } else if (node.nodeType === Node.ELEMENT_NODE) {
 text += getPlainText(node);
 }
 }
 return text;
 };

 const addFormattedText = (element, fontSize = 12, baseColor = [31, 41, 55]) => {
 if (!element) return;

 const processNode = (node, isBold = false, isItalic = false) => {
 if (node.nodeType === Node.TEXT_NODE) {
 const text = node.textContent || '';
 if (text.trim()) {
 pdf.setFontSize(fontSize);
 pdf.setFont('helvetica', isBold ? (isItalic ? 'bolditalic' : 'bold') : (isItalic ? 'italic' : 'normal'));
 pdf.setTextColor(baseColor[0], baseColor[1], baseColor[2]);
 
 const lines = pdf.splitTextToSize(text, contentWidth);
 const textHeight = lines.length * (fontSize * 0.35);
 checkPageBreak(textHeight);
 
 lines.forEach(line => {
 if (currentY > pageHeight - margin - 10) {
 pdf.addPage();
 currentY = margin;
 }
 pdf.text(line, margin, currentY);
 currentY += fontSize * 0.35;
 });
 }
 } else if (node.nodeType === Node.ELEMENT_NODE) {
 const tag = node.tagName ? node.tagName.toLowerCase() : '';
 let newBold = isBold;
 let newItalic = isItalic;
 
 if (tag === 'strong' || tag === 'b') newBold = true;
 if (tag === 'em' || tag === 'i') newItalic = true;
 
 for (const child of node.childNodes) {
 processNode(child, newBold, newItalic);
 }
 }
 };

 processNode(element);
 };

 const processElement = (el) => {
 if (!el || el.nodeType !== Node.ELEMENT_NODE) return;

 const tagName = el.tagName ? el.tagName.toLowerCase() : '';
 const textContent = getPlainText(el).trim();

 if (['script', 'style'].includes(tagName)) return;
 if (!textContent && !['table', 'hr', 'img', 'ul', 'ol'].includes(tagName)) {
 if (el.children.length === 0) return;
 }

 switch (tagName) {
 case 'h1':
 checkPageBreak(lineHeight * 2.5);
 currentY += spacing;
 addText(textContent, 20, true, [17, 24, 39]);
 currentY += spacing;
 pdf.setDrawColor(229, 231, 235);
 pdf.line(margin, currentY, pageWidth - margin, currentY);
 currentY += spacing;
 break;

 case 'h2':
 checkPageBreak(lineHeight * 2);
 currentY += spacing;
 addText(textContent, 18, true, [17, 24, 39]);
 currentY += spacing;
 pdf.setDrawColor(229, 231, 235);
 pdf.line(margin, currentY, pageWidth - margin, currentY);
 currentY += spacing;
 break;

 case 'h3':
 checkPageBreak(lineHeight * 1.8);
 currentY += spacing;
 addText(textContent, 16, true, [31, 41, 55]);
 currentY += spacing;
 break;

 case 'h4':
 case 'h5':
 case 'h6':
 checkPageBreak(lineHeight * 1.5);
 currentY += spacing;
 addText(textContent, 14, true, [31, 41, 55]);
 currentY += spacing;
 break;

 case 'p':
 if (textContent) {
 checkPageBreak(lineHeight * 1.5);
 addFormattedText(el, 12, [31, 41, 55]);
 currentY += spacing;
 }
 break;

 case 'ul':
 case 'ol':
 const listItems = el.querySelectorAll('li');
 let listIndex = 0;
 listItems.forEach((li) => {
 const liText = getPlainText(li).trim();
 if (liText) {
 const bullet = tagName === 'ul' ? '• ' : `${listIndex + 1}. `;
 checkPageBreak(lineHeight * 1.5);
 pdf.setFontSize(12);
 pdf.setFont('helvetica', 'normal');
 pdf.setTextColor(31, 41, 55);
 const fullText = bullet + liText;
 const lines = pdf.splitTextToSize(fullText, contentWidth - 10);
 const textHeight = lines.length * 4.2;
 checkPageBreak(textHeight);
 lines.forEach(line => {
 if (currentY > pageHeight - margin - 10) {
 pdf.addPage();
 currentY = margin;
 }
 pdf.text(line, margin + 5, currentY);
 currentY += 4.2;
 });
 listIndex++;
 currentY += spacing / 2;
 }
 });
 currentY += spacing;
 break;

 case 'table':
 const tableRows = el.querySelectorAll('tr');
 if (tableRows.length === 0) break;

 const firstRow = tableRows[0];
 const cellCount = firstRow.querySelectorAll('th, td').length;
 if (cellCount === 0) break;
 const cellWidth = contentWidth / cellCount;

 tableRows.forEach((row) => {
 const cells = row.querySelectorAll('th, td');
 if (cells.length === 0) return;
 
 const isHeader = row.querySelector('th') !== null;
 let maxCellHeight = 0;
 const cellHeights = [];

 cells.forEach((cell, cellIndex) => {
 const cellText = getPlainText(cell).trim();
 if (cellText) {
 pdf.setFontSize(isHeader ? 10 : 11);
 pdf.setFont('helvetica', isHeader ? 'bold' : 'normal');
 const cellLines = pdf.splitTextToSize(cellText, cellWidth - 4);
 const cellHeight = cellLines.length * (isHeader ? 3.5 : 3.85) + 2;
 cellHeights[cellIndex] = cellHeight;
 maxCellHeight = Math.max(maxCellHeight, cellHeight);
 } else {
 cellHeights[cellIndex] = isHeader ? 5 : 4;
 maxCellHeight = Math.max(maxCellHeight, cellHeights[cellIndex]);
 }
 });

 checkPageBreak(maxCellHeight + 2);

 pdf.setDrawColor(209, 213, 219);
 if (isHeader) {
 pdf.setFillColor(243, 244, 246);
 pdf.rect(margin, currentY, contentWidth, maxCellHeight, 'FD');
 } else {
 pdf.rect(margin, currentY, contentWidth, maxCellHeight, 'D');
 }

 cells.forEach((cell, cellIndex) => {
 const cellText = getPlainText(cell).trim();
 if (cellText) {
 pdf.setFontSize(isHeader ? 10 : 11);
 pdf.setFont('helvetica', isHeader ? 'bold' : 'normal');
 if (isHeader) {
 pdf.setTextColor(55, 65, 81);
 } else {
 pdf.setTextColor(31, 41, 55);
 }
 
 const cellLines = pdf.splitTextToSize(cellText, cellWidth - 4);
 const x = margin + (cellIndex * cellWidth) + 2;
 let y = currentY + (isHeader ? 3.5 : 3.85);
 
 cellLines.forEach((line) => {
 pdf.text(line, x, y);
 y += isHeader ? 3.5 : 3.85;
 });
 }

 if (cellIndex < cells.length - 1) {
 const borderX = margin + ((cellIndex + 1) * cellWidth);
 pdf.line(borderX, currentY, borderX, currentY + maxCellHeight);
 }
 });

 currentY += maxCellHeight + 2;
 });

 currentY += spacing;
 break;

 case 'pre':
 if (textContent) {
 pdf.setFont('courier');
 pdf.setFontSize(10);
 pdf.setTextColor(249, 250, 251);
 pdf.setFillColor(31, 41, 55);
 const codeLines = pdf.splitTextToSize(textContent, contentWidth - 4);
 const codeHeight = codeLines.length * 3.5 + 4;
 checkPageBreak(codeHeight);
 pdf.rect(margin, currentY, contentWidth, codeHeight, 'F');
 pdf.setTextColor(249, 250, 251);
 let codeY = currentY + 3.5;
 codeLines.forEach((line) => {
 pdf.text(line, margin + 2, codeY);
 codeY += 3.5;
 });
 pdf.setFont('helvetica');
 currentY += codeHeight + spacing;
 }
 break;

 case 'code':
 if (textContent && el.closest('pre') === null) {
 pdf.setFont('courier');
 pdf.setFontSize(11);
 pdf.setTextColor(220, 38, 38);
 pdf.setFillColor(243, 244, 246);
 const codeText = ' ' + textContent + ' ';
 const textWidth = pdf.getTextWidth(codeText);
 const textHeight = 4;
 checkPageBreak(textHeight);
 pdf.rect(margin, currentY - textHeight, textWidth + 2, textHeight, 'F');
 pdf.text(codeText, margin + 1, currentY - 1);
 pdf.setFont('helvetica');
 }
 break;

 case 'blockquote':
 if (textContent) {
 checkPageBreak(lineHeight * 2);
 pdf.setDrawColor(59, 130, 246);
 pdf.setFillColor(239, 246, 255);
 const quoteHeight = lineHeight * 2;
 pdf.rect(margin, currentY, 4, quoteHeight, 'F');
 pdf.rect(margin, currentY, contentWidth, quoteHeight, 'FD');
 pdf.setTextColor(30, 64, 175);
 pdf.setFont('helvetica', 'italic');
 pdf.setFontSize(12);
 const quoteLines = pdf.splitTextToSize(textContent, contentWidth - 10);
 let quoteY = currentY + 4;
 quoteLines.forEach((line) => {
 pdf.text(line, margin + 6, quoteY);
 quoteY += 4;
 });
 pdf.setFont('helvetica', 'normal');
 currentY += quoteHeight + spacing;
 }
 break;

 case 'hr':
 checkPageBreak(lineHeight);
 pdf.setDrawColor(229, 231, 235);
 pdf.setLineWidth(0.5);
 pdf.line(margin, currentY, pageWidth - margin, currentY);
 pdf.setLineWidth(0.2);
 currentY += spacing * 2;
 break;

 default:
 if (el.children && el.children.length > 0) {
 Array.from(el.children).forEach(child => processElement(child));
 } else if (textContent && !['strong', 'b', 'em', 'i', 'a'].includes(tagName)) {
 addText(textContent, 12, false, [31, 41, 55]);
 }
 break;
 }
 };

 const children = Array.from(clonedElement.children);
 if (children.length === 0) {
 processElement(clonedElement);
 } else {
 children.forEach(child => processElement(child));
 }

 const filename = `AI_Response_${formattedTime}.pdf`;

 pdf.save(filename);
 setSuccess('AI response downloaded as PDF!');
 setTimeout(() => setSuccess(null), 3000);
 } catch (err) {
 console.error('Failed to generate PDF:', err);
 setError(`Failed to download PDF: ${err.message}. Please try again.`);
 setTimeout(() => setError(null), 5000);
 } finally {
 setIsPdfLoading(false);
 }
 };

 const markdownComponents = {
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
 a: ({node, ...props}) => (
 <a
 {...props}
 className="text-blue-600 hover:text-blue-800 underline font-medium transition-colors"
 target="_blank"
 rel="noopener noreferrer"
 >
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
 <div className="my-6 rounded-lg border border-gray-300 shadow-sm overflow-hidden">
 <table className="min-w-full divide-y divide-gray-300" {...props} />
 </div>
 ),
 thead: ({node, ...props}) => (
 <thead className="bg-gradient-to-r from-gray-50 to-gray-100" {...props} />
 ),
 th: ({node, ...props}) => (
 <th className="px-6 py-4 text-left text-xs font-bold text-gray-800 uppercase tracking-wider border-b-2 border-gray-300" {...props} />
 ),
 tbody: ({node, ...props}) => (
 <tbody className="bg-white divide-y divide-gray-200" {...props} />
 ),
 tr: ({node, ...props}) => (
 <tr className="hover:bg-gray-50 transition-colors" {...props} />
 ),
 td: ({node, ...props}) => (
 <td className="px-6 py-4 text-sm text-gray-800 border-b border-gray-100 leading-relaxed" {...props} />
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
 className="flex items-center px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
 title="Copy AI Response"
 >
 <Copy className="h-4 w-4 mr-1" />
 Copy
 </button>
 <button
 onClick={handleDownloadPdf}
 disabled={isPdfLoading}
 className="flex items-center px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
 title="Download AI Response as PDF"
 >
 {isPdfLoading ? (
 <span className="h-4 w-4 mr-1 border-2 border-gray-600 border-t-transparent rounded-full animate-spin"></span>
 ) : (
 <Download className="h-4 w-4 mr-1" />
 )}
 PDF
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
  
  const isSecretPrompt = selectedMessage?.used_secret_prompt || false;
  
  const isStructured = isStructuredJsonResponse(rawResponse);
  
  let responseContent = '';
  if (isStructured) {
    responseContent = renderSecretPromptResponse(rawResponse);
  } else {
    responseContent = convertJsonToPlainText(rawResponse);
  }
  
  // Check if content contains HTML (Word document style)
  const containsHTML = responseContent.includes('<div style=') || 
                       responseContent.includes('<h1 style=') || 
                       responseContent.includes('<h2 style=') ||
                       responseContent.includes('<table style=') ||
                       responseContent.includes('<p style=');
  
  return (
    <div 
      className={containsHTML ? 'word-document-style' : 'prose prose-gray prose-lg max-w-none'} 
      ref={markdownOutputRef} 
      style={{ minWidth: 'fit-content' }}
    >
      {containsHTML ? (
        <div 
          dangerouslySetInnerHTML={{ __html: responseContent }}
          style={{ 
            fontFamily: "'Times New Roman', serif",
            lineHeight: '1.6',
            color: '#1a1a1a'
          }}
        />
      ) : (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw, rehypeSanitize]}
          components={markdownComponents}
        >
          {responseContent}
        </ReactMarkdown>
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

 </div>
 );
};

export default ChatResponsePanel;