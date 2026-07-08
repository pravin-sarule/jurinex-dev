import React from 'react';

/**
 * Dedicated rendering engine for legal DRAFT documents (draft-from-template).
 *
 * The general chat markdown renderer keeps breaking draft structure — most visibly
 * when a model emits a signature / execution block as malformed pipe rows
 * ("| | | Place: Pune | … | | Advocate for the Plaintiff |") that GitHub-flavored
 * markdown renders as literal "|" characters. This module isolates draft rendering:
 *   - sanitizeLegalDraftMarkdown() repairs the markdown (converts orphan pipe rows to
 *     clean lines, keeps only genuine tables) BEFORE ReactMarkdown sees it;
 *   - draftLineAlign() gives court-document alignment (centered titles / cause title /
 *     VERSUS, right-aligned party role labels, justified body);
 *   - legalDraftComponents are a serif, court-styled ReactMarkdown component set,
 *     completely separate from the chat's aiMarkdownComponents.
 */

// ── alignment (content-driven, works for live + history) ─────────────────────
const _CENTER_RE = [
  /^IN THE (COURT|HIGH COURT|MATTER)\b/i,
  /^(COMMERCIAL |CIVIL |CRIMINAL )?(SUIT|PETITION|APPLICATION|APPEAL|CASE|COMPLAINT)\s+NO\.?/i,
  /^(VERSUS|VS\.?|V\/S\.?)$/i,
  /^BEFORE THE\b/i,
  /^IN THE MATTER OF\b/i,
  /^(PLAINT|PETITION|APPLICATION|WRIT PETITION|MEMORANDUM)\s+UNDER\b/i,
  /^(PRAYER|VERIFICATION|STATEMENT OF TRUTH|SYNOPSIS|INDEX|LIST OF DATES|LIST OF DOCUMENTS|MEMO OF PARTIES|AFFIDAVIT|VAKALATNAMA)\b.{0,40}$/i,
  /^AND FOR THIS ACT OF KINDNESS/i,
  /(AGREEMENT|DEED|INDENTURE|CONTRACT|WILL|TESTAMENT|MEMORANDUM OF UNDERSTANDING|LEASE|MOU)\s*$/i, // ALL-CAPS doc title
];
// A trailing party-role label line: "…Plaintiff", "...Defendant", "… Petitioner".
const _ROLE_RE = /^[.…\s]*[.…]\s*(the\s+)?(first|second|third)?\s*(plaintiff|defendant|petitioner|respondent|appellant|applicant|complainant|landlord|tenant|lessor|lessee|licensor|licensee|vendor|purchaser|party)s?\b/i;

export function draftLineAlign(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  if (_ROLE_RE.test(t)) return 'right';
  const isAllCaps = t.length > 3 && t === t.toUpperCase() && /[A-Z]/.test(t);
  for (const re of _CENTER_RE) {
    if (re.test(t)) {
      // Only treat the ALL-CAPS doc-title rule as centered when the line is actually all-caps.
      if (re === _CENTER_RE[_CENTER_RE.length - 1] && !isAllCaps) continue;
      return 'center';
    }
  }
  return null;
}

// ── markdown sanitizer ───────────────────────────────────────────────────────
const _isSep = (l) => /^\|[\s\-:|]+\|$/.test(l.trim());
const _isPipeRow = (l) => {
  const s = l.trim();
  return s.startsWith('|') && s.endsWith('|') && s.length > 2;
};
// A pipe row is "structured" (a real table row) when it has multiple non-empty cells.
const _cellsOf = (l) =>
  l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

/**
 * Repair malformed markdown from a legal draft:
 *  - A contiguous block of pipe rows that has a separator row AND ≥2 non-separator rows
 *    is a genuine table → keep as-is.
 *  - Any other pipe row(s) (a lone signature/execution row, rows with mostly empty cells,
 *    no separator) → convert to clean lines: emit each non-empty cell on its own line.
 * This turns "| | | Place: Pune | Nexora… | | Date: ___ | … | Advocate for the Plaintiff |"
 * into readable, properly-structured lines instead of literal pipe text.
 */
export function sanitizeLegalDraftMarkdown(text) {
  const norm = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = norm.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!_isPipeRow(lines[i]) && !_isSep(lines[i])) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    // collect a contiguous pipe block (until a blank or non-pipe line)
    const block = [];
    let j = i;
    while (j < lines.length && lines[j].trim() !== '' && (_isPipeRow(lines[j]) || _isSep(lines[j]))) {
      block.push(lines[j]);
      j += 1;
    }
    const dataRows = block.filter((b) => !_isSep(b));
    const hasSep = block.some(_isSep);
    // After ensureTableSeparators() has run, a genuine table already has a separator
    // row and ≥2 data rows. A lone / erratic pipe row (a botched signature block) has
    // neither, so it is treated as orphan and flattened to clean lines.
    const looksLikeTable = hasSep && dataRows.length >= 2;
    if (looksLikeTable) {
      block.forEach((b) => out.push(b));
    } else {
      // orphan / malformed pipe rows → clean lines (drop empty cells, drop stray pipes)
      dataRows.forEach((r) => {
        const cells = _cellsOf(r).filter(Boolean);
        if (cells.length === 0) return;
        cells.forEach((c) => out.push(c));
      });
    }
    i = j;
  }
  return out.join('\n');
}

// ── court-styled ReactMarkdown component set (serif, isolated from chat) ──────
const _extract = (children) => {
  if (children == null) return '';
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(_extract).join('');
  if (typeof children === 'object' && children.props) return _extract(children.props.children);
  return '';
};

const SERIF = "'Times New Roman', 'Liberation Serif', Georgia, serif";

export const legalDraftComponents = {
  p: ({ node, children, ...props }) => {
    const align = draftLineAlign(_extract(children));
    return (
      <p
        style={{
          margin: '0 0 10px',
          fontFamily: SERIF,
          fontSize: '15px',
          lineHeight: 1.7,
          color: 'var(--draft-fg, #1a1a1a)',
          textAlign: align || 'justify',
        }}
        {...props}
      >
        {children}
      </p>
    );
  },
  h1: ({ node, children, ...props }) => (
    <h1 style={{ fontFamily: SERIF, fontSize: '18px', fontWeight: 700, margin: '18px 0 10px', textAlign: draftLineAlign(_extract(children)) || 'center', color: 'var(--draft-fg, #111)' }} {...props}>{children}</h1>
  ),
  h2: ({ node, children, ...props }) => (
    <h2 style={{ fontFamily: SERIF, fontSize: '16px', fontWeight: 700, margin: '16px 0 8px', textAlign: draftLineAlign(_extract(children)) || 'center', color: 'var(--draft-fg, #111)' }} {...props}>{children}</h2>
  ),
  h3: ({ node, children, ...props }) => (
    <h3 style={{ fontFamily: SERIF, fontSize: '15px', fontWeight: 700, margin: '14px 0 6px', textAlign: draftLineAlign(_extract(children)) || 'left', color: 'var(--draft-fg, #222)' }} {...props}>{children}</h3>
  ),
  strong: ({ node, ...props }) => <strong style={{ fontWeight: 700 }} {...props} />,
  ol: ({ node, ...props }) => <ol style={{ margin: '0 0 12px', paddingLeft: '26px', fontFamily: SERIF, fontSize: '15px', lineHeight: 1.7 }} {...props} />,
  ul: ({ node, ...props }) => <ul style={{ margin: '0 0 12px', paddingLeft: '24px', fontFamily: SERIF, fontSize: '15px', lineHeight: 1.7 }} {...props} />,
  li: ({ node, ...props }) => <li style={{ margin: '4px 0' }} {...props} />,
  hr: () => <hr style={{ border: 0, borderTop: '1px solid var(--draft-line, #d8d8d8)', margin: '18px 0' }} />,
};
