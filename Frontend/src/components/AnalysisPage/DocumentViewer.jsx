import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { Bot, Copy, MessageSquare } from 'lucide-react';
import DownloadPdf from '../DownloadPdf/DownloadPdf';
import { convertJsonToPlainText } from '../../utils/jsonToPlainText';

const PAGE_BREAK_TOKEN = '__JURINEX_PAGE_BREAK__';

const normalizeForPagination = (text) =>
  convertJsonToPlainText(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]*[-=]{0,5}\s*PAGE[\s_/-]*BREAK\s*[-=]{0,5}[ \t]*/gi, `\n\n${PAGE_BREAK_TOKEN}\n\n`)
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const splitLargeBlockSafely = (block, maxWeight) => {
  if (!block || block.length <= maxWeight) return [block];

  const sentenceParts = block
    .split(/(?<=[.!?])\s+(?=[A-Z0-9*"'-])/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (sentenceParts.length <= 1) {
    return [block];
  }

  const output = [];
  let current = '';

  sentenceParts.forEach((sentence) => {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (current && candidate.length > maxWeight) {
      output.push(current);
      current = sentence;
      return;
    }
    current = candidate;
  });

  if (current) {
    output.push(current);
  }

  return output.length ? output : [block];
};

const paginateMarkdownContent = (text) => {
  const normalized = normalizeForPagination(text);
  if (!normalized) return [];

  const explicitPages = normalized
    .split(new RegExp(`\\n\\s*(?:\\f|${PAGE_BREAK_TOKEN})\\s*\\n`, 'g'))
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  if (explicitPages.length > 1) {
    return explicitPages;
  }

  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const pages = [];
  let currentBlocks = [];
  let currentWeight = 0;
  const maxWeight = 3400;

  blocks.forEach((rawBlock) => {
    const candidateBlocks = splitLargeBlockSafely(rawBlock, maxWeight);

    candidateBlocks.forEach((block) => {
      const isHeading = /^#{1,6}\s/.test(block) || /^<h[1-6][\s>]/i.test(block);
      const isCode = /^```/.test(block) || /^<pre/i.test(block);
      const weight = Math.max(180, block.length + (isHeading ? 240 : 0) + (isCode ? 280 : 0));

      if (currentBlocks.length && currentWeight + weight > maxWeight) {
        pages.push(currentBlocks.join('\n\n'));
        currentBlocks = [];
        currentWeight = 0;
      }

      currentBlocks.push(block);
      currentWeight += weight;
    });
  });

  if (currentBlocks.length) {
    pages.push(currentBlocks.join('\n\n'));
  }

  return pages;
};

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
  exportContentRef,
  suggestedQuestions = [],
  onSuggestedQuestionClick,
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

  useEffect(() => {
    if (!responseContainerRef?.current) return undefined;
    const timeout = setTimeout(() => {
      if (responseContainerRef.current) {
        responseContainerRef.current.scrollTop = 0;
      }
    }, 100);
    return () => clearTimeout(timeout);
  }, [selectedMessageId, responseContainerRef]);

  const selectedMessage = messages.find((msg) => msg.id === selectedMessageId);
  const hasContent = currentResponse || animatedResponseContent;
  const isStreaming = selectedMessage?.isStreaming;
  const responseText = isAnimatingResponse
    ? animatedResponseContent
    : animatedResponseContent || currentResponse || '';
  const displayMessage = selectedMessage || {
    display_text_left_panel: 'Streaming response',
    question: 'Streaming response',
    timestamp: new Date().toISOString(),
  };
  const pages = useMemo(() => paginateMarkdownContent(responseText), [responseText]);

  if ((!selectedMessageId && !hasContent) || (!hasContent && !isStreaming)) {
    return (
      <div className="flex items-center justify-center h-full rounded-[22px] bg-white/80 border border-[#e5dfd4]">
        <div className="text-center text-[#807868] px-6">
          <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p className="text-base font-medium">Select a question to view the response</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-white rounded-[24px] border border-[#e0d9ca]">
      <div className="px-4 sm:px-5 pt-4 pb-3 border-b border-[#e3dccf] bg-white">
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[18px] sm:text-[20px] font-medium text-[#2b3528] flex items-center gap-2 truncate">
                <Bot className="h-4 w-4 text-[#1f6b5f] shrink-0" />
                {displayMessage.display_text_left_panel || displayMessage.question || 'Response'}
              </h2>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleCopyResponse}
                className="inline-flex items-center px-3 py-2 text-xs font-medium text-[#4e4a41] hover:text-[#1d1d1b] bg-white border border-[#ddd6c8] rounded-md transition-colors"
                title="Copy AI Response"
              >
                <Copy className="h-3.5 w-3.5 mr-1.5" />
                Copy
              </button>
              <DownloadPdf
                markdownOutputRef={markdownOutputRef}
                contentRef={exportContentRef}
                questionTitle={displayMessage.question || displayMessage.display_text_left_panel || 'AI_Analysis'}
              />
            </div>
          </div>
          <div className="flex items-center text-xs text-[#807868]">
            <span className="truncate">
              {displayMessage.timestamp ? formatDate(displayMessage.timestamp) : 'Preparing response'}
            </span>
          </div>
        </div>
      </div>

      <div
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 sm:px-4 py-4 [scrollbar-width:thin] [scrollbar-color:#b8b1a3_#f3f1ec] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-[#f3f1ec] [&::-webkit-scrollbar-thumb]:bg-[#b8b1a3] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-[#a59d8d]"
        ref={responseContainerRef ?? null}
      >
        <style>{`
          .document-viewer-horizontal-container {
            overflow-x: auto;
            overflow-y: hidden;
            scrollbar-width: none;
          }
          .document-viewer-horizontal-container::-webkit-scrollbar {
            display: none;
          }
        `}</style>
        <div className="space-y-5">
          <div ref={exportContentRef ?? null} className="space-y-5">
            {pages.length ? pages.map((pageContent, index) => (
              <article
                key={`response-page-${index + 1}`}
                className="export-page mx-auto w-full max-w-[794px] min-h-[1123px] bg-white border border-[#d9d2c6] rounded-[8px] shadow-[0_16px_34px_rgba(15,23,42,0.12)] px-8 sm:px-10 py-7"
                style={{ width: '100%' }}
              >
                <div className="flex items-center border-b border-[#e4ddd2] pb-3 text-[11px] uppercase tracking-[0.12em] text-[#807868]">
                  <span>JuriNex Analysis</span>
                </div>
                <div className="pt-6">
                  <div
                    className="document-viewer-horizontal-container"
                    ref={index === 0 ? horizontalScrollRef : undefined}
                  >
                    <div
                      className="prose prose-gray max-w-none"
                      ref={index === 0 ? markdownOutputRef : undefined}
                      style={{
                        width: '100%',
                        minWidth: 0,
                        overflowWrap: 'anywhere',
                        wordBreak: 'break-word',
                      }}
                    >
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeRaw, rehypeSanitize]}
                        components={markdownComponents}
                      >
                        {pageContent}
                      </ReactMarkdown>
                      {index === pages.length - 1 && (isAnimatingResponse || isStreaming) && (
                        <span className="inline-flex items-center ml-1">
                          <span className="inline-block w-1.5 h-4 bg-[#1f6b5f] animate-pulse"></span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            )) : (
              <div className="mx-auto w-full max-w-[794px] min-h-[1123px] bg-white border border-[#d9d2c6] rounded-[8px] shadow-[0_16px_34px_rgba(15,23,42,0.12)] px-8 py-7" style={{ width: '100%' }} />
            )}
          </div>
          {!isStreaming && !isAnimatingResponse && suggestedQuestions.length > 0 && (
            <section className="mx-auto w-full max-w-[780px] bg-[#f8fbfa] border border-[#d7e8e1] rounded-[16px] px-5 py-4">
              <div className="mb-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[#6f7f79] mb-1">Suggested Questions</p>
                <p className="text-sm text-[#3e4b46]">Use these to dig deeper into the completed response.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {suggestedQuestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => onSuggestedQuestionClick?.(suggestion)}
                    className="text-left px-3 py-2 rounded-full bg-white border border-[#c9ddd5] text-sm text-[#20463f] hover:bg-[#eef7f4] transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
        {needsHorizontalScroll && (
          <div className="sticky bottom-0 left-0 right-0 pt-2 bg-transparent z-10">
            <div
              ref={stickyScrollbarRef}
              className="overflow-x-auto overflow-y-hidden bg-white/95 border border-[#ddd6ca] rounded-lg shadow-sm"
              style={{
                height: '10px',
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
  );
};

export default DocumentViewer;
