

const { RecursiveCharacterTextSplitter } = require('@langchain/textsplitters');

/* ────────────────────────────────────────────────
 * Utility: Estimate token count
 * Rough rule of thumb: 1 token ≈ 4 characters (English)
 * ──────────────────────────────────────────────── */
function estimateTokenCount(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/* ────────────────────────────────────────────────
 * Utility: Merge small chunks to reduce token cost
 * ──────────────────────────────────────────────── */
function mergeSmallChunks(chunks, minChunkSize = 300) {
  if (!Array.isArray(chunks)) return [];
  const merged = [];
  let buffer = '';

  for (const chunk of chunks) {
    if ((buffer + chunk).length < minChunkSize) {
      buffer += chunk + ' ';
    } else {
      if (buffer.trim()) {
        merged.push(buffer.trim());
        buffer = '';
      }
      merged.push(chunk.trim());
    }
  }

  if (buffer.trim()) merged.push(buffer.trim());
  return merged;
}

/* ────────────────────────────────────────────────
 * Detect headings (for structural / agentic chunking)
 * ──────────────────────────────────────────────── */
function isHeading(line) {
  const trimmed = line.trim();
  const headingPatterns = [
    /^[A-Z][A-Z\s]{3,}$/, // ALL CAPS (minimum 4 chars)
    /^(?:SECTION|ARTICLE|CHAPTER|PART)\s+\d+/i,
    /^\d+\.\s+[A-Z]/,
    /^[IVXLCDM]+\.\s+/,
    /^#{1,6}\s+/,
  ];
  return headingPatterns.some((pattern) => pattern.test(trimmed));
}

/* ────────────────────────────────────────────────
 * Utility: Split text by structural elements
 * ──────────────────────────────────────────────── */
function splitByStructuralElements(text) {
  const sections = [];
  const lines = text.split('\n');
  let current = { content: '', heading: null, type: 'paragraph' };

  for (const line of lines) {
    if (isHeading(line)) {
      if (current.content.trim()) sections.push({ ...current });
      current = { content: line + '\n', heading: line.trim(), type: 'section' };
    } else {
      current.content += line + '\n';
    }
  }

  if (current.content.trim()) sections.push(current);
  return sections;
}

/* ────────────────────────────────────────────────
 * Line type detector (for agentic chunking)
 * ──────────────────────────────────────────────── */
function detectLineType(line) {
  if (!line) return null;
  const trimmed = line.trim();

  if (trimmed.includes('|') || (trimmed.match(/\t/g) || []).length > 2)
    return 'table';
  if (isHeading(trimmed)) return 'heading';
  if (/^(?:\d+\.)+\d*\s+|^\([a-z0-9]+\)\s+/i.test(trimmed))
    return 'numbered_clause';
  if (/^[-•*]\s+|^[►▪▸]\s+/.test(trimmed)) return 'bullet_point';
  return 'paragraph';
}

/* ────────────────────────────────────────────────
 * Split large paragraph into smaller ones
 * ──────────────────────────────────────────────── */
function splitLargeUnit(content, maxSize) {
  const sentences = content.match(/[^.!?]+[.!?]+/g) || [content];
  const chunks = [];
  let current = '';

  for (const s of sentences) {
    if ((current + s).length > maxSize && current.length > 0) {
      chunks.push(current.trim());
      current = s;
    } else current += s;
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/* ────────────────────────────────────────────────
 * 1️⃣ FIXED SIZE CHUNKER
 * ──────────────────────────────────────────────── */
async function fixedSizeChunker(structuredContent, chunkSize, chunkOverlap, formatChunk) {
  const chunks = [];
  const step = Math.max(1, chunkSize - chunkOverlap);

  for (const block of structuredContent) {
    const { text, page_start, page_end, heading } = block;
    if (!text || !text.trim()) continue;

    for (let i = 0; i < text.length; i += step) {
      const end = Math.min(i + chunkSize, text.length);
      const content = text.substring(i, end);
      chunks.push(formatChunk(content, {
        page_start, page_end, heading,
        chunk_method: 'fixed_size'
      }));
    }
  }

  return chunks;
}

/* ────────────────────────────────────────────────
 * 2️⃣ RECURSIVE CHUNKER (optimized for cost)
 * ──────────────────────────────────────────────── */
async function recursiveChunker(structuredContent, chunkSize, chunkOverlap, formatChunk) {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    separators: ['\n\n', '. ', '; ', '\n', ' ', ''],
  });

  const chunks = [];

  for (const block of structuredContent) {
    const { text, page_start, page_end, heading } = block;
    if (!text || !text.trim()) continue;

    const docs = await splitter.createDocuments([text]);
    const mergedDocs = mergeSmallChunks(docs.map((d) => d.pageContent));

    mergedDocs.forEach((content, i) => {
      chunks.push(formatChunk(content, {
        page_start, page_end, heading,
        chunk_method: 'recursive',
        chunk_index: i + 1
      }));
    });
  }

  return chunks;
}

/* ────────────────────────────────────────────────
 * 3️⃣ STRUCTURAL CHUNKER
 * ──────────────────────────────────────────────── */
async function structuralChunker(structuredContent, formatChunk) {
  const chunks = [];

  for (const block of structuredContent) {
    const { text, page_start, page_end, heading } = block;
    if (!text || !text.trim()) continue;

    const sections = splitByStructuralElements(text);
    sections.forEach((s) => {
      chunks.push(formatChunk(s.content, {
        page_start, page_end,
        heading: s.heading || heading,
        section_type: s.type,
        chunk_method: 'structural'
      }));
    });
  }

  return chunks;
}

/* ────────────────────────────────────────────────
 * 4️⃣ SEMANTIC CHUNKER (enhanced recursive)
 * ──────────────────────────────────────────────── */
async function semanticChunker(structuredContent, chunkSize, chunkOverlap, formatChunk) {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    separators: [
      '\n\n\n', '\n\n', '.\n', '. ', ';\n', '; ', '\n', ' ', ''
    ],
  });

  const chunks = [];

  for (const block of structuredContent) {
    const { text, page_start, page_end, heading } = block;
    if (!text || !text.trim()) continue;

    const docs = await splitter.createDocuments([text]);
    const merged = mergeSmallChunks(docs.map((d) => d.pageContent));

    merged.forEach((content, i) => {
      chunks.push(formatChunk(content, {
        page_start, page_end, heading,
        chunk_method: 'semantic',
        chunk_index: i + 1
      }));
    });
  }

  return chunks;
}

/* ────────────────────────────────────────────────
 * 5️⃣ AGENTIC CHUNKER (intelligent)
 * ──────────────────────────────────────────────── */
async function agenticChunker(structuredContent, chunkSize, formatChunk) {
  const chunks = [];

  for (const block of structuredContent) {
    const { text, page_start, page_end, heading } = block;
    if (!text || !text.trim()) continue;

    const lines = text.split('\n');
    let current = { content: '', type: 'paragraph', heading: null };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const type = detectLineType(line);

      if (type === 'heading') {
        if (current.content.trim()) chunks.push(formatChunk(current.content, {
          page_start, page_end,
          heading: current.heading || heading,
          chunk_method: 'agentic',
          unit_type: current.type
        }));
        current = { content: line + '\n', type: 'section', heading: line.trim() };
      } else {
        current.content += line + '\n';
      }

      // Split if too long
      if (current.content.length > chunkSize * 1.2) {
        const parts = splitLargeUnit(current.content, chunkSize);
        parts.forEach((p) =>
          chunks.push(formatChunk(p, {
            page_start, page_end,
            heading: current.heading || heading,
            chunk_method: 'agentic',
            unit_type: current.type
          }))
        );
        current.content = '';
      }
    }

    if (current.content.trim()) {
      chunks.push(formatChunk(current.content, {
        page_start, page_end,
        heading: current.heading || heading,
        chunk_method: 'agentic',
        unit_type: current.type
      }));
    }
  }

  return chunks;
}

/* ────────────────────────────────────────────────
 * MAIN ENTRYPOINT
 * ──────────────────────────────────────────────── */
async function chunkDocument(
  structuredContent,
  documentId,
  method = 'optimized_recursive',
  chunkSize = 1200,
  chunkOverlap = 150
) {
  if (!structuredContent || !structuredContent.length) {
    console.warn('⚠️ Empty structured content.');
    return [];
  }

  const formatChunk = (content, metadata) => ({
    content,
    metadata: { ...metadata, document_id: documentId },
    token_count: estimateTokenCount(content),
  });

  let chunks = [];

  switch (method) {
    case 'fixed_size':
      chunks = await fixedSizeChunker(structuredContent, chunkSize, chunkOverlap, formatChunk);
      break;
    case 'recursive':
    case 'optimized_recursive':
      chunks = await recursiveChunker(structuredContent, chunkSize, chunkOverlap, formatChunk);
      break;
    case 'structural':
      chunks = await structuralChunker(structuredContent, formatChunk);
      break;
    case 'semantic':
      chunks = await semanticChunker(structuredContent, chunkSize, chunkOverlap, formatChunk);
      break;
    case 'agentic':
      chunks = await agenticChunker(structuredContent, chunkSize, formatChunk);
      break;
    default:
      console.warn(`Unknown method "${method}", defaulting to optimized recursive.`);
      chunks = await recursiveChunker(structuredContent, chunkSize, chunkOverlap, formatChunk);
  }

  console.log(`✅ Document ${documentId}: ${chunks.length} chunks created (method=${method}).`);
  return chunks;
}

/* ────────────────────────────────────────────────
 * EXPORTS
 * ──────────────────────────────────────────────── */
module.exports = {
  chunkDocument,
  fixedSizeChunker,
  recursiveChunker,
  structuralChunker,
  semanticChunker,
  agenticChunker,
  estimateTokenCount,
};
