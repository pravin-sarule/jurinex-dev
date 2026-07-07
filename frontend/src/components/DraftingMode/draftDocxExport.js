// Court-ready .docx export for Drafting Mode.
//
// Reproduces the typography captured from the template by the Structural
// Analyst: font family (Times New Roman for court drafts), per-section
// alignment, point sizes, bold/underline/caps headings, and real Word tables
// for tabular sections. A4 page, 1-inch margins.
import {
  AlignmentType, BorderStyle, Document, Packer, PageOrientation, Paragraph,
  Table, TableCell, TableRow, TextRun, WidthType, convertInchesToTwip,
} from 'docx';
import {
  documentDefaults, normalizeFormat, parseContentBlocks, splitHeadingFromContent,
} from './draftFormatUtils';

const ALIGN = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

const run = (text, fmt, fontFamily) =>
  new TextRun({
    text: fmt.allCaps ? String(text).toUpperCase() : String(text),
    font: fontFamily,
    size: Math.round(fmt.fontSizePt * 2), // docx sizes are half-points
    bold: fmt.bold,
    underline: fmt.underline ? {} : undefined,
  });

const para = (text, fmt, fontFamily, opts = {}) =>
  new Paragraph({
    alignment: ALIGN[fmt.alignment] || AlignmentType.LEFT,
    spacing: { after: opts.after ?? 120, line: 300 }, // 1.25 line spacing (court style)
    children: [run(text, fmt, fontFamily)],
  });

const CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const CELL_BORDERS = {
  top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER,
};

const tableFromBlock = (block, bodyFmt, fontFamily) => {
  const makeRow = (cells, bold) =>
    new TableRow({
      children: cells.map((c) =>
        new TableCell({
          borders: CELL_BORDERS,
          margins: {
            top: convertInchesToTwip(0.04), bottom: convertInchesToTwip(0.04),
            left: convertInchesToTwip(0.08), right: convertInchesToTwip(0.08),
          },
          children: [new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [run(c, { ...bodyFmt, bold }, fontFamily)],
          })],
        })),
    });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      makeRow(block.header, true),
      ...block.rows.map((r) => makeRow(r, false)),
    ],
  });
};

/**
 * Build and download a .docx of the compiled draft.
 * @param {object} structure  template_structure from the backend (may be null)
 * @param {Array}  sections   [{sectionId, heading, headingFormat, bodyFormat}]
 * @param {Map}    textStore  Map(sectionId -> drafted text)
 * @param {string} filename
 */
export const downloadDraftDocx = async (structure, sections, textStore, filename) => {
  const defaults = documentDefaults(structure);
  const font = defaults.fontFamily;
  const children = [];

  // Document title, centered/bold per the template's title typography.
  const title = structure?.document_title || 'Draft Document';
  children.push(para(title, defaults.titleFormat, font, { after: 360 }));

  for (const s of sections) {
    const raw = (textStore.get(s.sectionId) || '').trim();
    if (!raw) continue;
    const headingFmt = normalizeFormat(s.headingFormat, {
      bold: true, fontSizePt: defaults.baseFontSizePt,
    });
    const bodyFmt = normalizeFormat(s.bodyFormat, {
      alignment: 'justify', fontSizePt: defaults.baseFontSizePt,
    });
    const { headingText, body } = splitHeadingFromContent(raw, s.heading);

    if (headingText) children.push(para(headingText, headingFmt, font, { after: 160 }));

    for (const block of parseContentBlocks(body)) {
      if (block.type === 'table') {
        children.push(tableFromBlock(block, bodyFmt, font));
        children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
      } else if (block.text.trim() === '') {
        children.push(new Paragraph({ spacing: { after: 60 }, children: [] }));
      } else {
        children.push(para(block.text, bodyFmt, font, { after: 80 }));
      }
    }
    children.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font, size: Math.round(defaults.baseFontSizePt * 2) },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          size: {
            orientation: PageOrientation.PORTRAIT,
            width: convertInchesToTwip(8.27),   // A4
            height: convertInchesToTwip(11.69),
          },
          margin: {
            top: convertInchesToTwip(1), bottom: convertInchesToTwip(1),
            left: convertInchesToTwip(1), right: convertInchesToTwip(1),
          },
        },
      },
      children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

export default downloadDraftDocx;
