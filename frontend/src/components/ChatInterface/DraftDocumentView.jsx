import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { ensureTableSeparators, markdownTableComponents } from '../../utils/markdownUtils';
import { sanitizeLegalDraftMarkdown, legalDraftComponents } from '../../utils/legalDraftRender';

// The drafter (and now the TipTap editor) emit inline styles the user can set — red
// placeholder spans (<span style="color:red;font-weight:bold;">[____ FIELD ____]</span>),
// per-block alignment (text-align on p / h1-h6 / td / th) and font family/size/colour
// spans. rehype-sanitize strips inline styles by default, so allow `style` on the
// elements that legitimately carry draft styling.
const _STYLED_TAGS = ['span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'div'];
const DRAFT_SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [...new Set([...(defaultSchema.tagNames || []), 'span'])],
  attributes: {
    ...defaultSchema.attributes,
    ..._STYLED_TAGS.reduce((acc, tag) => {
      acc[tag] = [...new Set([...((defaultSchema.attributes && defaultSchema.attributes[tag]) || []), 'style'])];
      return acc;
    }, {}),
  },
};

/**
 * Renders a legal draft (or a single draft section) with the dedicated draft
 * engine — sanitizes malformed pipe/table markdown, then applies court-document
 * styling. Deliberately separate from the chat's FormattedAssistantContent so the
 * general chat renderer's quirks can never break a draft again.
 */
const DraftDocumentView = React.memo(function DraftDocumentView({ raw, className = '' }) {
  const md = useMemo(() => {
    // 1) ensureTableSeparators first — gives genuine header+data tables their GFM
    //    separator so they survive; 2) then sanitize — flattens leftover orphan/
    //    signature pipe rows into clean lines instead of literal "|" text.
    const withSeps = ensureTableSeparators(String(raw || ''));
    return sanitizeLegalDraftMarkdown(withSeps).replace(/[ \t]*\[source:[^\]]*\]/gi, '').trim();
  }, [raw]);

  if (!md) return null;

  return (
    <div className={`legal-draft-view ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, DRAFT_SANITIZE_SCHEMA]]}
        components={{ ...markdownTableComponents, ...legalDraftComponents }}
      >
        {md}
      </ReactMarkdown>
    </div>
  );
}, (prev, next) => prev.raw === next.raw && prev.className === next.className);

export default DraftDocumentView;
