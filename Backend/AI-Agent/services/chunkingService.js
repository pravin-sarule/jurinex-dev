const { RecursiveCharacterTextSplitter } = require('@langchain/textsplitters');

function estimateTokenCount(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

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

async function chunkDocument(
  structuredContent,
  documentId,
  method = 'recursive',
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
        page_start,
        page_end,
        heading,
        chunk_method: method,
        chunk_index: i + 1
      }));
    });
  }

  console.log(`✅ Document ${documentId}: ${chunks.length} chunks created (method=${method}).`);
  return chunks;
}

module.exports = {
  chunkDocument,
  estimateTokenCount,
};
