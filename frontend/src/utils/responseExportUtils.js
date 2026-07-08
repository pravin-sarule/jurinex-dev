/**
 * Strips markdown syntax from raw text so clipboard gets clean readable content.
 * Used as a fallback when the rendered DOM ref is unavailable.
 */
export function stripMarkdown(text) {
  if (!text) return '';
  return text
    // Fenced code blocks — keep content, drop fences
    .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
    .replace(/~~~[^\n]*\n([\s\S]*?)~~~/g, '$1')
    // Inline code
    .replace(/`([^`]+)`/g, '$1')
    // Bold + italic combinations
    .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
    .replace(/___([^_]+)___/g, '$1')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    // Italic
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    // Headings
    .replace(/^#{1,6}\s+/gm, '')
    // Links — keep label
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // Images — drop
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    // Blockquotes
    .replace(/^>\s+/gm, '')
    // Unordered list bullets
    .replace(/^[ \t]*[-*+]\s+/gm, '')
    // Ordered list numbers
    .replace(/^[ \t]*\d+\.\s+/gm, '')
    // Horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Collapse excessive blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Gets clean plain text from a rendered DOM element.
 * Falls back to stripMarkdown on raw text when the element is not mounted.
 */
export function getCleanText(domElement, rawFallback) {
  if (domElement) {
    return domElement.innerText || domElement.textContent || '';
  }
  // Fallback: strip HTML tags then markdown
  if (rawFallback) {
    const tmp = document.createElement('div');
    tmp.innerHTML = rawFallback;
    const fromHtml = tmp.innerText;
    // If it looks like HTML was parsed, return it; otherwise strip markdown
    return fromHtml !== rawFallback ? fromHtml : stripMarkdown(rawFallback);
  }
  return '';
}

/**
 * Loads html2pdf.js from CDN (once) and resolves when ready.
 * html2pdf renders via canvas so all fonts, emojis, and Unicode render correctly.
 */
const HTML2PDF_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';

export async function loadHtml2Pdf() {
  if (window.html2pdf) return;
  await new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${HTML2PDF_CDN}"]`);
    if (existing) { setTimeout(resolve, 200); return; }
    const script = document.createElement('script');
    script.src = HTML2PDF_CDN;
    script.onload = () => setTimeout(resolve, 150);
    script.onerror = () => reject(new Error('Failed to load PDF library. Check your internet connection.'));
    document.head.appendChild(script);
  });
}

// Shared typography for HTML download and Print
const EXPORT_STYLES_BASE = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  h1 { font-size: 18pt; font-weight: 700; color: #111827; margin: 18pt 0 9pt; border-bottom: 1pt solid #e5e7eb; padding-bottom: 5pt; }
  h2 { font-size: 15pt; font-weight: 700; color: #111827; margin: 14pt 0 8pt; }
  h3 { font-size: 13pt; font-weight: 600; color: #374151; margin: 12pt 0 6pt; }
  h4, h5, h6 { font-size: 11pt; font-weight: 600; color: #374151; margin: 10pt 0 4pt; }
  p { margin: 0 0 9pt; text-align: justify; text-justify: inter-word; line-height: 1.75; page-break-inside: avoid; }
  ul, ol { margin: 6pt 0 10pt; padding-left: 20pt; }
  li { margin-bottom: 4pt; line-height: 1.65; page-break-inside: avoid; }
  blockquote { border-left: 3pt solid #3b82f6; padding: 8pt 12pt; margin: 10pt 0; background: #eff6ff; color: #1e40af; font-style: italic; page-break-inside: avoid; }
  code { font-family: 'Courier New', monospace; font-size: 9.5pt; background: #f3f4f6; padding: 1pt 3pt; border-radius: 2pt; }
  pre { background: #1f2937; color: #f9fafb; padding: 10pt; border-radius: 3pt; font-family: 'Courier New', monospace; font-size: 9pt; margin: 10pt 0; white-space: pre-wrap; word-break: break-all; page-break-inside: avoid; }
  strong, b { font-weight: 700; }
  em, i { font-style: italic; }
  hr { border: none; border-top: 1pt solid #e5e7eb; margin: 14pt 0; }
  img { max-width: 100%; height: auto; page-break-inside: avoid; }
  .html2pdf__page-break { page-break-before: always; }
  .jurinex-hdr { display: flex; justify-content: space-between; align-items: center; padding-bottom: 8pt; margin-bottom: 16pt; border-bottom: 2pt solid #21C1B6; }
  .jurinex-logo { font-size: 17pt; font-weight: 800; color: #21C1B6; letter-spacing: -0.02em; }
  .jurinex-date { font-size: 9pt; color: #9ca3af; }
`;

// Table styles shared by both PDF and non-PDF exports
const TABLE_STYLES_SHARED = `
  table { border-collapse: collapse; margin: 10pt 0; page-break-inside: auto; }
  thead { display: table-header-group; }
  tbody tr:nth-child(even) td { background: #f9fafb; }
`;

// Table styles for HTML + Print (scrollable wide tables are fine)
const TABLE_STYLES_HTML = `
  ${TABLE_STYLES_SHARED}
  .md-table-scroll { overflow-x: auto; }
  table { width: max-content; min-width: 100%; font-size: 10.5pt; }
  th { border: 1pt solid #9ca3af; padding: 6pt 8pt; background: #f3f4f6; font-weight: 700; text-align: left; color: #1f2937; white-space: nowrap; }
  td { border: 1pt solid #d1d5db; padding: 6pt 8pt; vertical-align: top; color: #374151; }
`;

// Table styles for PDF — must fit within A4 page width, no scrolling
const TABLE_STYLES_PDF = `
  ${TABLE_STYLES_SHARED}
  table { width: 100%; max-width: 100%; font-size: 8.5pt; table-layout: fixed; }
  th { border: 0.75pt solid #9ca3af; padding: 4pt 5pt; background: #f3f4f6; font-weight: 700; text-align: left; color: #1f2937; word-break: break-word; overflow-wrap: break-word; white-space: normal; }
  td { border: 0.75pt solid #d1d5db; padding: 4pt 5pt; vertical-align: top; color: #374151; word-break: break-word; overflow-wrap: break-word; }
`;

/**
 * Clones the element and removes UI chrome + oklch() colors (canvas can't parse them).
 * When forPdf=true also unwraps .md-table-scroll divs — html2canvas captures only the
 * *visible* portion of overflow:auto containers, clipping the right columns in PDF output.
 */
function cloneForExport(element, forPdf = false) {
  const cloned = element.cloneNode(true);
  cloned.querySelectorAll('button, .ai-message-actions, .chat-thread-card__footer').forEach(el => el.remove());

  if (forPdf) {
    // Replace every scroll-wrapper with its children so the full table is captured
    cloned.querySelectorAll('.md-table-scroll').forEach(wrapper => {
      const parent = wrapper.parentNode;
      while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild, wrapper);
      wrapper.remove();
    });
    // Also remove inline styles that would push the layout beyond the A4 page:
    // table width/max-content AND th/td white-space:nowrap (inline styles override the
    // PDF stylesheet's white-space:normal, widening the layout and shifting the canvas).
    cloned.querySelectorAll('table, th, td').forEach(el => el.removeAttribute('style'));
    cloned.querySelectorAll('table').forEach(tbl => {
      tbl.style.width = '100%';
    });
  }

  [cloned, ...cloned.querySelectorAll('*')].forEach(el => {
    if (el.hasAttribute && el.hasAttribute('style')) {
      const safe = el.getAttribute('style')
        .split(';')
        .filter(s => s.trim() && !s.toLowerCase().includes('oklch'))
        .join(';');
      if (safe) el.setAttribute('style', safe);
      else el.removeAttribute('style');
    }
  });
  return cloned;
}

function buildExportHtmlString(cloned, forPdf = false) {
  const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const bodyStyle = forPdf
    // Explicit A4 pixel width (not max-width:100% + overflow:hidden): the string source
    // renders in a container sized to the REAL browser window, so percentage widths +
    // windowWidth:794 disagree and html2canvas captures a shifted/clipped strip.
    ? `font-family:"DM Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;font-size:12pt;line-height:1.75;color:#1f1f1f;background:#fff;text-rendering:optimizeLegibility;padding:0;margin:0;width:${A4_WIDTH_PX}px;`
    : 'font-family:"DM Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;font-size:12pt;line-height:1.75;color:#1f1f1f;background:#fff;text-rendering:optimizeLegibility;padding:24pt 32pt;';
  const tableStyles = forPdf ? TABLE_STYLES_PDF : TABLE_STYLES_HTML;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
${EXPORT_STYLES_BASE}
body { ${bodyStyle} }
${tableStyles}
@media print { body { padding: 0; } pre { white-space: pre-wrap; } }
</style>
</head>
<body>
<div class="jurinex-hdr">
  <span class="jurinex-logo">JuriNex</span>
  <span class="jurinex-date">${dateStr}</span>
</div>
${cloned.innerHTML}
</body>
</html>`;
}

// A4 at 96 dpi — tells html2canvas to assume this viewport width so
// percentage widths compute to A4 dimensions, not the user's monitor width.
const A4_WIDTH_PX = Math.round(210 * 96 / 25.4); // ≈ 794

/**
 * Downloads a DOM element as a properly formatted PDF.
 * Uses html2pdf.js canvas approach — handles emojis, Unicode, and rich formatting.
 */
export async function downloadAsPdf(element, filename = 'AI_Response.pdf') {
  if (!element) throw new Error('No content to export.');
  await loadHtml2Pdf();
  if (document.fonts) await document.fonts.ready;

  const htmlString = buildExportHtmlString(cloneForExport(element, true), true);

  const opt = {
    margin: [12, 14, 12, 14],
    filename,
    image: { type: 'jpeg', quality: 0.97 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: A4_WIDTH_PX,   // render at A4 width so tables lay out correctly
      width: A4_WIDTH_PX,         // capture exactly the A4-wide layout, not the real window
      x: 0,
      y: 0,
      scrollX: 0,                 // ignore the host page's scroll offsets — a scrolled
      scrollY: 0,                 // parent shifts the capture and clips the content
    },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true },
    pagebreak: { mode: ['css', 'legacy'], avoid: ['h1', 'h2', 'h3', 'h4', 'tr', 'li', 'blockquote', 'pre'] },
  };

  await window.html2pdf().set(opt).from(htmlString, 'string').save();
}

/**
 * Downloads a DOM element as a plain Word (.doc) file without branding.
 * For branded Word export use downloadWithBranding({ type: 'word' }).
 */
export function downloadAsWord(element, filename = 'AI_Response.doc') {
  if (!element) throw new Error('No content to export.');
  const cloned = cloneForExport(element, false);
  const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const wordDoc = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="UTF-8">
<title>Document</title>
<style>
body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.7; color: #1f1f1f; margin: 1in; }
h1 { font-size: 18pt; font-weight: bold; color: #111827; margin: 18pt 0 8pt; }
h2 { font-size: 15pt; font-weight: bold; color: #111827; margin: 14pt 0 7pt; }
h3 { font-size: 13pt; font-weight: bold; color: #374151; margin: 12pt 0 6pt; }
h4, h5, h6 { font-size: 11pt; font-weight: bold; color: #374151; margin: 10pt 0 4pt; }
p { margin: 0 0 10pt; }
ul, ol { margin: 0 0 10pt; padding-left: 20pt; }
li { margin-bottom: 4pt; }
table { border-collapse: collapse; width: 100%; margin: 10pt 0; }
th, td { border: 1pt solid #d1d5db; padding: 6pt 8pt; font-size: 10pt; vertical-align: top; }
th { background: #f3f4f6; font-weight: bold; }
blockquote { border-left: 3pt solid #3b82f6; padding-left: 12pt; margin: 10pt 0; color: #4b5563; font-style: italic; }
strong { font-weight: 700; }
em { font-style: italic; }
code { font-family: 'Courier New', monospace; font-size: 9pt; background: #f3f4f6; padding: 1pt 3pt; }
pre { background: #1f2937; color: #f9fafb; padding: 10pt; font-family: 'Courier New', monospace; font-size: 9pt; white-space: pre-wrap; }
.jurinex-hdr { font-size: 9pt; color: #6b7280; margin-bottom: 14pt; border-bottom: 1pt solid #e5e7eb; padding-bottom: 6pt; display: flex; justify-content: space-between; }
</style>
</head>
<body>
<div class="jurinex-hdr"><span>JuriNex</span><span>${dateStr}</span></div>
${cloned.innerHTML}
</body>
</html>`;
  const blob = new Blob([`﻿${wordDoc}`], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Downloads a DOM element as a self-contained HTML file.
 * Tables stay scrollable in the browser — no width constraint needed.
 */
export function downloadAsHtml(element, filename = 'AI_Response.html') {
  if (!element) throw new Error('No content to export.');
  const htmlString = buildExportHtmlString(cloneForExport(element, false), false);
  const blob = new Blob([htmlString], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Opens the response in a new window and triggers the browser print dialog.
 */
export function printResponse(element) {
  if (!element) throw new Error('No content to print.');
  const htmlString = buildExportHtmlString(cloneForExport(element, false), false);
  const win = window.open('', '_blank', 'width=900,height=700');
  win.document.open();
  win.document.write(htmlString);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}
