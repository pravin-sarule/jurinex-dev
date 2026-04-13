import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X } from 'lucide-react';
import LearningMcqBlock, { normalizeLearningUiMode } from './LearningMcqBlock';

export default function LearningDetailPanel({ data, onOptionClick, onClose, isStreaming }) {
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
  const showMcq =
    (normalizedUi === 'options' || normalizedUi === 'options_multi') && optionList.length > 0;

  const compactBase = {
    fontSize: '15px',
    lineHeight: '1.55',
    color: '#111827',
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
  };

  const mdComponentsCompact = {
    p: ({ node, ...props }) => <p style={{ margin: '0 0 10px', ...compactBase }} {...props} />,
    strong: ({ node, ...props }) => <strong style={{ fontWeight: 600, color: '#0f766e', fontSize: '15px' }} {...props} />,
    em: ({ node, ...props }) => <em style={{ fontStyle: 'italic' }} {...props} />,
    h1: ({ node, ...props }) => <h1 style={{ fontSize: '15px', lineHeight: 1.35, margin: '0 0 8px', fontWeight: 700, color: '#111', ...compactBase }} {...props} />,
    h2: ({ node, ...props }) => <h2 style={{ fontSize: '14px', lineHeight: 1.35, margin: '0 0 8px', fontWeight: 700, color: '#111', ...compactBase }} {...props} />,
    h3: ({ node, ...props }) => <h3 style={{ fontSize: '14px', lineHeight: 1.35, margin: '0 0 8px', fontWeight: 600, color: '#111', ...compactBase }} {...props} />,
    ul: ({ node, ...props }) => <ul style={{ margin: '0 0 10px', paddingLeft: '18px', ...compactBase }} {...props} />,
    ol: ({ node, ...props }) => <ol style={{ margin: '0 0 10px', paddingLeft: '18px', ...compactBase }} {...props} />,
    li: ({ node, ...props }) => <li style={{ marginBottom: '4px', ...compactBase }} {...props} />,
    blockquote: ({ node, ...props }) => (
      <blockquote
        style={{
          margin: '8px 0',
          padding: '4px 0 4px 12px',
          borderLeft: '3px solid #cbd5e1',
          color: '#64748b',
          fontStyle: 'italic',
          fontSize: '13px',
          lineHeight: 1.5,
        }}
        {...props}
      />
    ),
    code: ({ node, inline, children, ...props }) =>
      inline ? (
        <code
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '4px',
            padding: '1px 4px',
            fontSize: '12px',
            fontFamily: '"IBM Plex Mono", "Courier New", monospace',
          }}
          {...props}
        >
          {children}
        </code>
      ) : (
        <code {...props}>{children}</code>
      ),
    pre: ({ node, ...props }) => (
      <pre
        style={{
          margin: '10px 0',
          padding: '10px 12px',
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          overflowX: 'auto',
          fontSize: '12px',
          lineHeight: '1.5',
          color: '#334155',
          fontFamily: '"IBM Plex Mono", "Courier New", monospace',
        }}
        {...props}
      />
    ),
    hr: ({ node, ...props }) => <hr style={{ border: 0, borderTop: '1px solid #e5e7eb', margin: '10px 0' }} {...props} />,
  };

  const mdComponentsQuestion = {
    p: ({ node, ...props }) => (
      <p
        style={{
          margin: '0 0 8px',
          fontSize: '15px',
          lineHeight: '1.5',
          color: '#1a1a1a',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontWeight: 600,
          textAlign: 'right',
        }}
        {...props}
      />
    ),
    strong: ({ node, ...props }) => <strong style={{ fontWeight: 700, color: '#0f766e' }} {...props} />,
    em: ({ node, ...props }) => <em style={{ fontStyle: 'italic' }} {...props} />,
    ul: ({ node, ...props }) => <ul style={{ margin: '0 0 8px', paddingLeft: '18px', textAlign: 'right', listStylePosition: 'inside' }} {...props} />,
    ol: ({ node, ...props }) => <ol style={{ margin: '0 0 8px', paddingLeft: '18px', textAlign: 'right', listStylePosition: 'inside' }} {...props} />,
    li: ({ node, ...props }) => <li style={{ marginBottom: '4px', fontSize: '15px', textAlign: 'right', fontFamily: 'Inter, system-ui, sans-serif' }} {...props} />,
    code: mdComponentsCompact.code,
    hr: ({ node, ...props }) => <hr style={{ border: 0, borderTop: '1px solid #e5e7eb', margin: '8px 0' }} {...props} />,
  };

  const truncate = (t, max) => {
    const s = String(t || '').trim();
    if (s.length <= max) return s;
    return `${s.slice(0, max).trim()}...`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#ffffff', position: 'relative' }}>
      {onClose && (
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '18px',
            right: '18px',
            zIndex: 2,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#8c877f',
            padding: '4px',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <X size={16} />
        </button>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '44px 32px 56px' }}>
        <div style={{ maxWidth: '560px', margin: '0 auto' }}>
          {feedback && feedback.trim() && (
            <div style={{ marginBottom: '14px' }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponentsCompact}>
                {truncate(feedback, 2000)}
              </ReactMarkdown>
            </div>
          )}

          {contentHint && contentHint.trim() && (
            <div
              style={{
                margin: '8px 0 14px',
                padding: '8px 12px 8px 14px',
                borderLeft: '4px solid #2563eb',
                background: '#f3f4f6',
                borderRadius: '0 8px 8px 0',
              }}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponentsCompact}>
                {truncate(contentHint, 900)}
              </ReactMarkdown>
            </div>
          )}

          {question && question.trim() && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                marginTop: '14px',
                paddingTop: '14px',
                borderTop: '1px solid #f1f5f9',
                width: '100%',
              }}
            >
              <div
                style={{
                  maxWidth: '78%',
                  textAlign: 'right',
                  background: '#f0fdfa',
                  border: '1px solid #21C1B6',
                  borderRadius: '18px 18px 4px 18px',
                  padding: '10px 14px',
                  boxShadow: '0 1px 3px rgba(33, 193, 182, 0.08)',
                }}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponentsQuestion}>
                  {truncate(question, 800)}
                </ReactMarkdown>
              </div>
            </div>
          )}

          {showMcq && (
            <LearningMcqBlock
              mode={normalizedUi === 'options_multi' ? 'options_multi' : 'options'}
              options={optionList}
              isStreaming={isStreaming}
              readOnly={false}
              onSubmit={onOptionClick}
            />
          )}
        </div>
      </div>
    </div>
  );
}
