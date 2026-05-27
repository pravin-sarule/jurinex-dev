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

  const lines = text.split('\n');
  const out = [];
  let insertedSepForTable = false;

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

    // Models sometimes emit ASCII table scaffolding as content:
    // |----|----, repeated dashed lines, or rows with only blank cells.
    // Keep the single GFM separator that belongs to a table; drop the rest.
    // Also drop extra separator rows between data rows — GFM only needs one
    // separator immediately after the header row.
    if (
      (isEmptyPipeRow && !isSeparatorRow) ||
      (isPipeDividerOnly && !isSeparatorRow) ||
      (isLongDividerOnly && !isSeparatorRow) ||
      (isSeparatorRow && insertedSepForTable)
    ) {
      continue;
    }

    out.push(lines[i]);

    if (!isTableRow && !isSeparatorRow) {
      insertedSepForTable = false;
      continue;
    }

    if (isSeparatorRow) {
      insertedSepForTable = true;
      continue;
    }

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
 * ReactMarkdown `components` override that wraps every <table> in a
 * horizontally-scrollable container so wide tables never force the cell text
 * to break mid-word or mid-date.
 */
export const markdownTableComponents = {
  table: ({ node, ...props }) => (
    <div className="md-table-scroll">
      <table {...props} />
    </div>
  ),
};
