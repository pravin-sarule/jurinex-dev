import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import {
  formatChatResponseForDisplay,
  chatResponseLooksLikeHtml,
} from '../../utils/formatChatResponse';
import { ensureTableSeparators, markdownTableComponents } from '../../utils/markdownUtils';

/**
 * Renders assistant text with secret-prompt HTML, legal banners, or markdown.
 */
export default function FormattedAssistantContent({ raw, markdownComponents, className = '' }) {
  const content = useMemo(() => formatChatResponseForDisplay(raw), [raw]);

  if (!content) return null;

  if (chatResponseLooksLikeHtml(content)) {
    return (
      <div
        className={`formatted-assistant-html word-document-style ${className}`.trim()}
        dangerouslySetInnerHTML={{ __html: content }}
      />
    );
  }

  return (
    <div className={`formatted-assistant-markdown ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={{ ...markdownTableComponents, ...markdownComponents }}
      >
        {ensureTableSeparators(content)}
      </ReactMarkdown>
    </div>
  );
}
