import React, { useMemo } from 'react';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import {
  formatChatResponseForDisplay,
  chatResponseLooksLikeHtml,
} from '../../utils/formatChatResponse';
import {
  ensureTableSeparators,
  markdownTableComponents,
  markdownRehypePlugins,
  normalizeMarkdownFormatting,
  splitMarkdownIntoRenderChunks,
} from '../../utils/markdownUtils';

/**
 * Renders assistant text with secret-prompt HTML, legal banners, or markdown.
 *
 * Wrapped in React.memo so that parent re-renders (e.g. new message arriving,
 * streaming status changing) never trigger ReactMarkdown to re-parse historical
 * messages whose `raw` content has not changed.
 */
const FormattedAssistantContent = React.memo(
  function FormattedAssistantContent({ raw, markdownComponents, className = '' }) {
    const content = useMemo(() => {
      let cleaned = formatChatResponseForDisplay(raw);
      if (!cleaned) return '';
      // Clean thinking content before rendering
      cleaned = cleaned.replace(/<(?:think|thinking)>[\s\S]*?<\/(?:think|thinking)>/gi, '');
      if (/<(?:think|thinking)>/i.test(cleaned)) {
        cleaned = cleaned.split(/<(?:think|thinking)>/i)[0];
      }
      return cleaned;
    }, [raw]);
    const markdownChunks = useMemo(
      () => splitMarkdownIntoRenderChunks(ensureTableSeparators(normalizeMarkdownFormatting(content))),
      [content],
    );

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
        {markdownChunks.map((chunk, index) => (
          <ReactMarkdown
            key={`${index}-${chunk.length}`}
            remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
            rehypePlugins={markdownRehypePlugins}
            components={{ ...markdownTableComponents, ...markdownComponents }}
          >
            {chunk}
          </ReactMarkdown>
        ))}
      </div>
    );
  },
  // Only re-render when the displayed text or styling actually changes
  (prev, next) =>
    prev.raw === next.raw &&
    prev.className === next.className &&
    prev.markdownComponents === next.markdownComponents,
);

export default FormattedAssistantContent;
