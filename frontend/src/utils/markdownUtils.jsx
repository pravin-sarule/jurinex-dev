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
  if (!text || !text.includes('|')) return text;

  const lines = text.split('\n');
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    const curr = lines[i].trim();
    const next = (lines[i + 1] || '').trim();

    // A "table row" starts and ends with | and is NOT a separator row
    const isTableRow =
      curr.startsWith('|') &&
      curr.endsWith('|') &&
      !/^\|[\s\-:|]+\|$/.test(curr);

    // Next line is also a data row (not a separator, not partial separator)
    const isNextDataRow =
      next.startsWith('|') &&
      next.endsWith('|') &&
      !/^\|[\s\-:|]+\|$/.test(next);

    // Next line is starting to look like a separator but isn't complete yet
    const isNextPartialSep = /^\|[\-\s:]/.test(next);

    if (isTableRow && isNextDataRow && !isNextPartialSep) {
      const cols = (curr.match(/\|/g) || []).length - 1;
      if (cols > 0) {
        out.push('|' + Array(cols).fill(' --- ').join('|') + '|');
      }
    }
  }

  return out.join('\n');
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
