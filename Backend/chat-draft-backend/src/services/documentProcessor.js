const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

/* ─── text utilities ────────────────────────────────────────────────────── */
const normalizeWhitespace = (v) =>
  String(v || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const splitText = (text, chunkSize, overlap) => {
  if (!text) return [];
  const chunks = [];
  let cursor = 0;
  while (cursor < text.length) {
    const end = Math.min(text.length, cursor + chunkSize);
    chunks.push(text.slice(cursor, end).trim());
    if (end >= text.length) break;
    cursor = Math.max(0, end - overlap);
  }
  return chunks.filter(Boolean);
};

/* ─────────────────────────────────────────────────────────────────────────
   PDF text extraction — 4 attempts, NEVER throws.

   Returns the best text found, or a placeholder note so the AI knows
   the file was present but unreadable. Session creation is never blocked.

   Common causes of "bad XRef entry":
   - Incrementally-updated PDFs (signed / annotated)
   - Linearized / fast-web-view PDFs
   - PDFs created by some scanner software
───────────────────────────────────────────────────────────────────────── */
async function extractPdfText(filename, buffer) {
  // ── Attempt 1: standard pdf-parse ──────────────────────────────────────
  try {
    const r = await pdfParse(buffer);
    const t = normalizeWhitespace(r.text);
    if (t.length > 30) return t;
  } catch (_) { /* continue */ }

  // ── Attempt 2: pdf-parse with a different internal renderer ────────────
  try {
    const r = await pdfParse(buffer, {
      // Override the render callback to avoid layout issues
      pagerender: (pageData) =>
        pageData.getTextContent().then((tc) =>
          tc.items.map((i) => i.str).join(" ")
        ),
    });
    const t = normalizeWhitespace(r.text);
    if (t.length > 30) return t;
  } catch (_) { /* continue */ }

  // ── Attempt 3: raw BT…ET content-stream extraction ─────────────────────
  try {
    const raw = buffer.toString("latin1");
    const strings = [];
    const btEt = /BT([\s\S]*?)ET/g;
    let m;
    while ((m = btEt.exec(raw)) !== null) {
      const parens = m[1].match(/\(([^)\\]|\\.)*\)/g) || [];
      for (const s of parens) {
        const inner = s.slice(1, -1)
          .replace(/\\n/g, "\n").replace(/\\r/g, "\n").replace(/\\t/g, " ")
          .replace(/\\\(/g, "(").replace(/\\\)/g, ")")
          .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
        if (inner.trim().length > 2) strings.push(inner.trim());
      }
    }
    const t = normalizeWhitespace(strings.join(" "));
    if (t.length > 30) return t;
  } catch (_) { /* continue */ }

  // ── Attempt 4: plain printable-ASCII scrape ─────────────────────────────
  try {
    const printable = buffer
      .toString("latin1")
      .replace(/[^\x20-\x7E\n]/g, " ")
      .replace(/\s{3,}/g, "  ");
    // Only grab runs of words (skip raw PDF syntax noise)
    const words = printable.match(/[A-Za-z]{3,}(?:\s+[A-Za-z0-9,.'"-]{2,}){2,}/g) || [];
    const t = normalizeWhitespace(words.join(" "));
    if (t.length > 80) return t;
  } catch (_) { /* continue */ }

  // ── All attempts failed — return informative placeholder ───────────────
  // Never throw: session creation continues, AI is told the file is unreadable
  console.warn(`[pdf] Could not extract text from "${filename}" — using placeholder`);
  return `[NOTE: The file "${filename}" could not be parsed (possibly a scanned image PDF or has structural issues). ` +
    `No text was extracted. Use information from other documents to fill in any details this file may have contained.]`;
}

/* ─── file extraction dispatcher ────────────────────────────────────────── */
async function extractTextFromFile(file) {
  const ext = String(file.originalname || "").toLowerCase().split(".").pop();

  if (ext === "pdf")  return extractPdfText(file.originalname, file.buffer);
  if (ext === "docx") {
    const r = await mammoth.extractRawText({ buffer: file.buffer });
    return normalizeWhitespace(r.value);
  }
  if (["txt", "md", "csv"].includes(ext)) {
    return normalizeWhitespace(file.buffer.toString("utf8"));
  }
  throw new Error(`Unsupported file type ".${ext}". Supported: PDF, DOCX, TXT, MD, CSV.`);
}

/* ─────────────────────────────────────────────────────────────────────────
   PARALLEL DOCUMENT PROCESSOR WITH JOB QUEUE
   Processes up to CONCURRENCY=4 files simultaneously.
   Soft-fails per file — one bad file never blocks the rest.
───────────────────────────────────────────────────────────────────────── */
const CONCURRENCY = 4;

async function processOneDocument(file, chunkSize, overlap) {
  const text = await extractTextFromFile(file);
  const documentChunks = splitText(text, chunkSize, overlap);
  const chunkEntries = documentChunks.map((t, i) => ({
    id: `${file.originalname}::chunk-${i}`,
    source: file.originalname,
    text: t,
  }));
  return {
    name: file.originalname,
    textLength: text.length,
    chunks: chunkEntries.length,
    chunkEntries,
  };
}

async function processDocumentsParallel(files, chunkSize, overlap) {
  const results = new Array(files.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const idx = nextIndex++;
      if (idx >= files.length) break;
      const file = files[idx];
      try {
        results[idx] = await processOneDocument(file, chunkSize, overlap);
      } catch (err) {
        // Truly unrecoverable error (e.g. unsupported format) — still soft-fail
        results[idx] = {
          name: file.originalname,
          textLength: 0,
          chunks: 0,
          chunkEntries: [],
          error: err.message || "Failed to process file",
        };
        console.error(`[docProcessor] "${file.originalname}":`, err.message);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker)
  );
  return results;
}

/* ─── retrieval ─────────────────────────────────────────────────────────── */
function scoreChunk(chunk, query) {
  const tokens = String(query || "").toLowerCase().split(/\W+/).filter(t => t.length > 2);
  if (!tokens.length) return 0;
  const content = chunk.toLowerCase();
  return tokens.reduce((s, t) => (content.includes(t) ? s + 1 : s), 0);
}

function retrieveRelevantChunks(chunks, query, topK) {
  return [...chunks]
    .map(c => ({ chunk: c, score: scoreChunk(c.text, query) }))
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(e => e.chunk);
}

module.exports = {
  extractTextFromFile,
  splitText,
  processDocumentsParallel,
  retrieveRelevantChunks,
};
