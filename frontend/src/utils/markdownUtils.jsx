import React from 'react';

/**
 * Ensures GFM table separator rows are present so ReactMarkdown + remarkGfm
 * can render tables immediately, even during streaming when the AI emits header
 * and data rows before the separator row has arrived.
 *
 * GFM requires:
 *   | Header |
 *   | ------ |   ← separator; without it remarkGfm renders raw pipe text
 *   | Cell   |
 */
export function ensureTableSeparators(text) {
  if (!text) return text;

  // Normalize Windows line endings so split/join is consistent
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const out = [];
  let insertedSepForTable = false;
  let prevLineWasTableOrSep = false;

  for (let i = 0; i < lines.length; i++) {
    const curr = lines[i].trim();
    const next = (lines[i + 1] || '').trim();

    const isPipeDividerOnly = /^\|[\s\-:=|]+\|?$/.test(curr);
    const isLongDividerOnly = /^[\s\-:=|]{8,}$/.test(curr) && /[-=]/.test(curr);
    const isEmptyPipeRow =
      curr.startsWith('|') &&
      curr.endsWith('|') &&
      curr
        .slice(1, -1)
        .split('|')
        .every((cell) => !cell.replace(/[\s\-:=]/g, ''));

    const isTableRow =
      curr.startsWith('|') &&
      curr.endsWith('|') &&
      !/^\|[\s\-:|]+\|$/.test(curr);

    const isSeparatorRow = /^\|[\s\-:|]+\|$/.test(curr);

    const isNextDataRow =
      next.startsWith('|') &&
      next.endsWith('|') &&
      !/^\|[\s\-:|]+\|$/.test(next);

    const isNextSeparator = /^\|[\s\-:|]+\|$/.test(next);
    const isOrphanedAlignmentFragment = /^:{1,3}$/.test(curr);

    // Models sometimes emit ASCII table scaffolding as content:
    // |----|----, repeated dashed lines, or rows with only blank cells.
    // Keep the single GFM separator that belongs to a table; drop the rest.
    // Also drop extra separator rows between data rows — GFM only needs one
    // separator immediately after the header row.
    if (
      (isEmptyPipeRow && !isSeparatorRow) ||
      (isPipeDividerOnly && !isSeparatorRow) ||
      (isLongDividerOnly && !isSeparatorRow) ||
      isOrphanedAlignmentFragment ||
      (isSeparatorRow && insertedSepForTable)
    ) {
      continue;
    }

    // Ensure a blank line before a table row when transitioning from non-table content.
    // remark-gfm parses tables more reliably when preceded by a blank line.
    if (isTableRow && !prevLineWasTableOrSep && out.length > 0) {
      const lastOut = out[out.length - 1].trim();
      if (lastOut !== '') {
        out.push('');
      }
    }

    out.push(lines[i]);

    if (!isTableRow && !isSeparatorRow) {
      insertedSepForTable = false;
      prevLineWasTableOrSep = curr === '';  // blank lines reset table context
      continue;
    }

    if (isSeparatorRow) {
      insertedSepForTable = true;
      prevLineWasTableOrSep = true;
      continue;
    }

    prevLineWasTableOrSep = true;

    // Insert exactly one GFM separator after the header row (before first data row).
    if (isTableRow && isNextDataRow && !isNextSeparator && !insertedSepForTable) {
      const cols = (curr.match(/\|/g) || []).length - 1;
      if (cols > 0) {
        out.push('|' + Array(cols).fill(' --- ').join('|') + '|');
        insertedSepForTable = true;
      }
    }
  }

  return out.join('\n');
}

/**
 * Split very long markdown into complete block chunks. Rendering one huge legal
 * response through ReactMarkdown can stall the browser, especially when the AI
 * emits large malformed table sections. Chunking keeps long answers visible.
 */
export function splitMarkdownIntoRenderChunks(text, maxChars = 18000) {
  const value = String(text || '');
  if (value.length <= maxChars) return [value];

  const blocks = value.split(/\n{2,}/);
  const chunks = [];
  let current = '';

  blocks.forEach((block) => {
    const next = current ? `${current}\n\n${block}` : block;
    if (next.length <= maxChars || !current) {
      current = next;
      return;
    }
    chunks.push(current);
    current = block;
  });

  if (current) chunks.push(current);
  return chunks.length ? chunks : [value];
}

/**
 * ReactMarkdown `components` override — matches AppAssistant's full MD_COMPONENTS
 * pattern so DeepSeek and Gemini tables render identically across all chat surfaces.
 *
 * Covers every table element (table, thead, tbody, tr, th, td) with explicit inline
 * styles so rendering is consistent regardless of which CSS file is loaded.
 * The color palette uses the main chat's warm-gray scheme (not AppAssistant's teal).
 */
export const markdownTableComponents = {
  table: ({ node, ...props }) => (
    <div
      className="md-table-scroll"
      style={{ border: '1px solid #d6d0c4', borderRadius: '8px', overflow: 'hidden' }}
    >
      <table
        style={{ borderCollapse: 'collapse', width: '100%', fontSize: '13.5px' }}
        {...props}
      />
    </div>
  ),
  thead: ({ node, ...props }) => (
    <thead style={{ background: '#f6f8f7' }} {...props} />
  ),
  th: ({ node, ...props }) => (
    <th
      style={{
        padding: '9px 14px',
        textAlign: 'left',
        fontWeight: '600',
        fontSize: '11.5px',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: '#374151',
        borderBottom: '1.5px solid #d6d0c4',
        borderRight: '1px solid #ece7de',
        whiteSpace: 'nowrap',
      }}
      {...props}
    />
  ),
  tbody: ({ node, ...props }) => <tbody {...props} />,
  tr: ({ node, ...props }) => (
    <tr style={{ borderBottom: '1px solid #ece7de' }} {...props} />
  ),
  td: ({ node, ...props }) => (
    <td
      style={{
        padding: '8px 14px',
        verticalAlign: 'top',
        color: '#374151',
        borderRight: '1px solid #ece7de',
        lineHeight: '1.5',
      }}
      {...props}
    />
  ),
};
