import React, { useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { Copy, ThumbsUp, ThumbsDown, RotateCcw } from 'lucide-react';
import LearningMcqBlock, { normalizeLearningUiMode } from './LearningMcqBlock';

const MAX_MARKDOWN_CHARS = 120000;

/**
 * Split "1️⃣ … 2️⃣ …" style option runs (Unicode keycap digits) into intro + option strings.
 * Used when the model puts choices in prose instead of `options: []`.
 */
function splitKeycapNumberedOptions(text) {
  const s = String(text || '');
  if (!s.trim()) return null;
  let matches = [...s.matchAll(/[1-9]\uFE0F\u20E3/g)];
  if (matches.length < 2) {
    matches = [...s.matchAll(/[1-9]\u20E3/g)];
  }
  if (matches.length < 2) return null;

  const firstIdx = matches[0].index;
  const intro = s.slice(0, firstIdx).trim();
  const options = [];
  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const labelLen = m[0].length;
    const bodyStart = m.index + labelLen;
    const bodyEnd = i + 1 < matches.length ? matches[i + 1].index : s.length;
    let body = s.slice(bodyStart, bodyEnd).trim();
    body = body.replace(/^\*\*|\*\*$/g, '').replace(/^\*|\*$/g, '').trim();
    if (body) options.push(body);
  }
  if (options.length < 2) return null;
  return { intro, options };
}

function clampMarkdown(text) {
  const t = String(text || '').trim();
  if (t.length <= MAX_MARKDOWN_CHARS) return t;
  return `${t.slice(0, MAX_MARKDOWN_CHARS)}\n\n[… truncated for display …]`;
}

export default function LearningChatBubble({ data, onViewFull, onOptionClick, isStreaming, optionsInteractionLocked = false }) {
  if (!data) return null;

  const {
    feedback = '',
    content_hint: contentHint = '',
    question = '',
    ui_type: uiType = 'text',
    options = null,
  } = data;

  const optionList = Array.isArray(options) ? options : [];
  const normalizedUi = normalizeLearningUiMode(uiType);

  const fullQuestion = String(question || '').trim();
  const keycapSplit = useMemo(() => {
    if (optionList.length > 0) return null;
    return splitKeycapNumberedOptions(fullQuestion);
  }, [optionList.length, fullQuestion]);

  const mcqOptionList = optionList.length > 0 ? optionList : keycapSplit?.options || [];
  const mcqMode =
    optionList.length > 0 && normalizedUi === 'options_multi' ? 'options_multi' : 'options';
  const showMcq =
    mcqOptionList.length > 0 &&
    (optionList.length > 0
      ? normalizedUi === 'options' || normalizedUi === 'options_multi'
      : !!keycapSplit);

  const bodyFont = '"Times New Roman", Times, serif';
  const feedbackMd = clampMarkdown(String(feedback || '').trim());
  const hintMd = clampMarkdown(String(contentHint || '').trim());

  const mdBody = {
    fontSize: '18px',
    lineHeight: 1.7,
    color: '#111827',
    fontFamily: bodyFont,
    letterSpacing: '0',
    wordSpacing: '0.02em',
    textAlign: 'left',
  };

  /** Main narrative (matches in-thread assistant: open layout, clear hierarchy, hr dividers). */
  const mdComponentsMain = {
    p: ({ node, ...props }) => <p style={{ margin: '0 0 14px', ...mdBody }} {...props} />,
    strong: ({ node, ...props }) => <strong style={{ fontWeight: 700, color: '#111827', fontSize: '18px' }} {...props} />,
    em: ({ node, ...props }) => <em style={{ fontStyle: 'italic', color: '#334155' }} {...props} />,
    h1: (p) => <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '18px 0 10px', color: '#111827', fontFamily: bodyFont, lineHeight: 1.5 }} {...p} />,
    h2: (p) => <h2 style={{ fontSize: '22px', fontWeight: 700, margin: '16px 0 10px', color: '#111827', fontFamily: bodyFont, lineHeight: 1.5 }} {...p} />,
    h3: (p) => <h3 style={{ fontSize: '20px', fontWeight: 600, margin: '14px 0 8px', color: '#111827', fontFamily: bodyFont, lineHeight: 1.5 }} {...p} />,
    ul: ({ node, ...props }) => <ul style={{ margin: '0 0 14px', paddingLeft: '34px', ...mdBody }} {...props} />,
    ol: ({ node, ...props }) => <ol style={{ margin: '0 0 14px', paddingLeft: '34px', ...mdBody }} {...props} />,
    li: ({ node, ...props }) => <li style={{ marginBottom: '6px', ...mdBody }} {...props} />,
    blockquote: ({ node, ...props }) => (
      <blockquote
        style={{
          margin: '14px 0',
          padding: '8px 0 8px 14px',
          borderLeft: '3px solid #cbd5e1',
          color: '#475569',
          fontStyle: 'italic',
          fontSize: '17px',
          lineHeight: 1.55,
          fontFamily: bodyFont,
        }}
        {...props}
      />
    ),
    code: ({ node, inline, children, ...props }) =>
      inline ? (
        <code
          style={{
            background: '#f1f5f9',
            border: '1px solid #e2e8f0',
            borderRadius: '4px',
            padding: '2px 6px',
            fontSize: '16px',
            fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
          }}
          {...props}
        >
          {children}
        </code>
      ) : (
        <code {...props}>{children}</code>
      ),
    hr: ({ node, ...props }) => (
      <hr
        style={{
          border: 0,
          borderTop: '1px solid #e2e8f0',
          margin: '22px 0',
        }}
        {...props}
      />
    ),
    table: ({ children, ...props }) => (
      <div style={{ overflowX: 'auto', margin: '14px 0' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '17px',
            fontFamily: bodyFont,
            color: '#111827',
          }}
          {...props}
        >
          {children}
        </table>
      </div>
    ),
    thead: (p) => <thead style={{ background: '#f8fafc' }} {...p} />,
    tbody: (p) => <tbody {...p} />,
    tr: (p) => <tr style={{ borderBottom: '1px solid #e2e8f0' }} {...p} />,
    th: (p) => (
      <th
        style={{
          border: '1px solid #e2e8f0',
          padding: '8px 10px',
          textAlign: 'left',
          fontWeight: 600,
        }}
        {...p}
      />
    ),
    td: (p) => <td style={{ border: '1px solid #e2e8f0', padding: '8px 10px', verticalAlign: 'top' }} {...p} />,
  };

  const mdCoach = {
    ...mdComponentsMain,
    p: ({ node, ...props }) => (
      <p
        style={{
          margin: '0 0 10px',
          fontSize: '18px',
          lineHeight: 1.7,
          color: '#111827',
          fontFamily: bodyFont,
          fontWeight: 500,
          letterSpacing: '0',
          wordSpacing: '0.02em',
        }}
        {...props}
      />
    ),
    strong: ({ node, ...props }) => <strong style={{ fontWeight: 700, color: '#111827' }} {...props} />,
    em: ({ node, ...props }) => <em style={{ fontStyle: 'italic' }} {...props} />,
    ul: ({ node, ...props }) => <ul style={{ margin: '0 0 8px', paddingLeft: '18px' }} {...props} />,
    ol: ({ node, ...props }) => <ol style={{ margin: '0 0 8px', paddingLeft: '18px' }} {...props} />,
    li: ({ node, ...props }) => <li style={{ marginBottom: '6px', fontSize: '18px', lineHeight: 1.7, fontFamily: bodyFont, wordSpacing: '0.02em' }} {...props} />,
    code: mdComponentsMain.code,
    hr: mdComponentsMain.hr,
  };

  const rehypePlugins = useMemo(() => [rehypeRaw, rehypeSanitize], []);

  const copyFullResponse = useCallback(() => {
    const parts = [feedback, contentHint, question].map((s) => String(s || '').trim()).filter(Boolean);
    const text = parts.join('\n\n');
    if (text) navigator.clipboard.writeText(text).catch(() => {});
  }, [feedback, contentHint, question]);

  return (
    <div
      style={{
        width: '100%',
        maxWidth: 'min(100%, 900px)',
        margin: '0 auto',
        padding: '2px 0 12px',
        background: '#ffffff',
        fontFamily: bodyFont,
      }}
    >
      {feedbackMd ? (
        <div style={{ marginBottom: hintMd || fullQuestion || showMcq ? '4px' : '0' }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={mdComponentsMain}>
            {feedbackMd}
          </ReactMarkdown>
        </div>
      ) : null}

      {hintMd ? (
        <div style={{ margin: '10px 0 2px' }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={mdComponentsMain}>
            {`**Hint:** ${hintMd}`}
          </ReactMarkdown>
        </div>
      ) : null}

      {fullQuestion ? (
        <div style={{ width: '100%', textAlign: 'left', marginTop: '8px' }}>
          <div
            style={{
              height: '1px',
              background: '#e2e8f0',
              margin: '16px 0 10px',
              width: '100%',
            }}
          />
          {keycapSplit && keycapSplit.intro ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={mdCoach}>
              {`**Next:** ${clampMarkdown(keycapSplit.intro)}`}
            </ReactMarkdown>
          ) : keycapSplit && !keycapSplit.intro ? (
            <p
              style={{
                margin: 0,
                fontSize: '14px',
                lineHeight: 1.55,
                color: '#1f2937',
                fontFamily: bodyFont,
                fontWeight: 500,
              }}
            >
              Choose a topic below:
            </p>
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={mdCoach}>
              {`**Next:** ${clampMarkdown(fullQuestion)}`}
            </ReactMarkdown>
          )}
        </div>
      ) : null}

      {showMcq ? (
        <LearningMcqBlock
          mode={mcqMode}
          options={mcqOptionList}
          isStreaming={isStreaming}
          readOnly={optionsInteractionLocked}
          onSubmit={onOptionClick}
        />
      ) : null}

      {(feedbackMd || hintMd || fullQuestion) && !isStreaming ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            marginTop: '14px',
            paddingTop: '10px',
            borderTop: '1px solid #f1f5f9',
          }}
        >
          <button
            type="button"
            onClick={copyFullResponse}
            title="Copy"
            style={actionBtnStyle}
          >
            <Copy className="h-4 w-4" />
          </button>
          <span style={{ width: '1px', height: '16px', background: '#e2e8f0', margin: '0 4px' }} aria-hidden />
          <button type="button" title="Helpful" style={{ ...actionBtnStyle, opacity: 0.45, cursor: 'default' }} disabled>
            <ThumbsUp className="h-4 w-4" />
          </button>
          <button type="button" title="Not helpful" style={{ ...actionBtnStyle, opacity: 0.45, cursor: 'default' }} disabled>
            <ThumbsDown className="h-4 w-4" />
          </button>
          <button type="button" title="Regenerate" style={{ ...actionBtnStyle, opacity: 0.45, cursor: 'default' }} disabled>
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {onViewFull ? (
        <button
          type="button"
          onClick={() => onViewFull(data)}
          style={{
            marginTop: '10px',
            alignSelf: 'flex-start',
            background: 'none',
            border: 'none',
            padding: 0,
            fontSize: '13px',
            color: '#64748b',
            cursor: 'pointer',
            textDecoration: 'underline',
            textUnderlineOffset: '3px',
          }}
        >
          View full response
        </button>
      ) : null}
    </div>
  );
}

const actionBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '8px',
  border: 'none',
  borderRadius: '8px',
  background: 'transparent',
  color: '#94a3b8',
  cursor: 'pointer',
};
