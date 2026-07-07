// Shared formatting helpers for Drafting Mode — used by both the page-style
// Full Document view and the .docx export so screen and file stay identical.

/** Normalize a TextFormatSchema coming from the backend (all fields optional). */
export const normalizeFormat = (fmt, fallback = {}) => ({
  alignment: fmt?.alignment || fallback.alignment || 'left',
  fontSizePt: Number(fmt?.font_size_pt || fallback.fontSizePt || 12),
  bold: Boolean(fmt?.bold ?? fallback.bold ?? false),
  underline: Boolean(fmt?.underline ?? fallback.underline ?? false),
  allCaps: Boolean(fmt?.all_caps ?? fallback.allCaps ?? false),
});

/** Document-level defaults from TemplateStructure (court-draft conventions). */
export const documentDefaults = (structure) => ({
  fontFamily: structure?.base_font_family || 'Times New Roman',
  baseFontSizePt: Number(structure?.base_font_size_pt || 12),
  titleFormat: normalizeFormat(structure?.title_format, {
    alignment: 'center', fontSizePt: 14, bold: true,
  }),
});

const isTableRow = (line) => {
  const t = line.trim();
  return t.startsWith('|') && t.endsWith('|') && t.length > 2;
};

const isSeparatorRow = (line) =>
  /^\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(line.trim());

const splitRow = (line) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

/**
 * Parse section content into ordered blocks:
 *   { type: 'paragraph', text }            — one source line (may be empty)
 *   { type: 'table', header: [...], rows: [[...], ...] }
 * Markdown pipe tables become structured table blocks; everything else stays
 * verbatim line-by-line so template line structure survives untouched.
 */
export const parseContentBlocks = (content) => {
  const lines = String(content || '').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    if (isTableRow(lines[i]) && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      const header = splitRow(lines[i]);
      const rows = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) {
        if (!isSeparatorRow(lines[i])) rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }
    blocks.push({ type: 'paragraph', text: lines[i] });
    i += 1;
  }
  return blocks;
};

/** Does drafted content already restate the section heading as its first line? */
export const contentStartsWithHeading = (content, heading) => {
  const first = String(content || '').trimStart().split('\n', 1)[0]?.trim().toLowerCase() || '';
  const h = String(heading || '').trim().toLowerCase();
  if (!h) return false;
  return first === h || first.startsWith(h.slice(0, Math.max(10, h.length)));
};

/** Strip the restated heading line so heading typography can be applied once. */
export const splitHeadingFromContent = (content, heading) => {
  if (!contentStartsWithHeading(content, heading)) {
    return { headingText: heading, body: String(content || '').trim() };
  }
  const text = String(content || '').trimStart();
  const nl = text.indexOf('\n');
  return {
    headingText: nl === -1 ? text.trim() : text.slice(0, nl).trim(),
    body: nl === -1 ? '' : text.slice(nl + 1).replace(/^\n+/, '').trimEnd(),
  };
};

export const ptToPx = (pt) => Math.round(pt * (96 / 72) * 100) / 100;
