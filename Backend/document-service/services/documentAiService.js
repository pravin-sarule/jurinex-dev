
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai');
const { Storage } = require('@google-cloud/storage');
const { credentials } = require('../config/gcs');

const projectId = process.env.GCLOUD_PROJECT_ID;
const location = process.env.DOCUMENT_AI_LOCATION || 'us';
const processorId = process.env.DOCUMENT_AI_PROCESSOR_ID;

const client = new DocumentProcessorServiceClient({ credentials });
const storage = new Storage({ credentials });

/**
 * Process small documents (<20MB inline)
 */
async function extractTextFromDocument(fileBuffer, mimeType) {
  const name = `projects/${projectId}/locations/${location}/processors/${processorId}`;
  const request = {
    name,
    rawDocument: {
      content: fileBuffer.toString('base64'),
      mimeType,
    },
  };

  const [result] = await client.processDocument(request);
  return extractText(result.document);
}

/**
 * Batch process large documents asynchronously
 */
async function batchProcessDocument(inputUris, outputUriPrefix, mimeType = 'application/pdf') {
  const name = `projects/${projectId}/locations/${location}/processors/${processorId}`;
  const uris = Array.isArray(inputUris) ? inputUris : [inputUris];

  if (!outputUriPrefix.endsWith('/')) outputUriPrefix += '/';

  // Validate all input files exist
  await Promise.all(
    uris.map(async (uri) => {
      const { bucketName, prefix } = parseGcsUri(uri);
      const [exists] = await storage.bucket(bucketName).file(prefix).exists();
      if (!exists) throw new Error(`Input file not found in GCS: ${uri}`);
    })
  );

  const request = {
    name,
    inputDocuments: {
      gcsDocuments: {
        documents: uris.map(uri => ({ gcsUri: uri, mimeType })),
      },
    },
    documentOutputConfig: { gcsOutputConfig: { gcsUri: outputUriPrefix } },
  };

  const [operation] = await client.batchProcessDocuments(request);
  return operation.name;
}

/**
 * Get operation status
 */
async function getOperationStatus(operationName) {
  const [operation] = await client.operationsClient.getOperation({ name: operationName });
  return {
    done: operation.done || false,
    error: operation.error || null,
    response: operation.response || null,
  };
}

/**
 * Fetch batch results from GCS asynchronously and extract text only
 */
async function fetchBatchResults(bucketName, prefix) {
  console.log(`[fetchBatchResults] Looking for files in bucket: ${bucketName}, prefix: ${prefix}`);
  
  const bucket = storage.bucket(bucketName);
  const [exists] = await bucket.exists();
  
  if (!exists) {
    console.error(`[fetchBatchResults] ❌ Bucket does not exist: ${bucketName}`);
    throw new Error(`Output bucket does not exist: ${bucketName}`);
  }
  
  const [files] = await bucket.getFiles({ prefix });
  console.log(`[fetchBatchResults] Found ${files.length} total files with prefix "${prefix}"`);
  
  // Log all file names for debugging
  if (files.length > 0) {
    console.log(`[fetchBatchResults] Files found:`);
    files.slice(0, 10).forEach((file, i) => {
      console.log(`  ${i + 1}. ${file.name}`);
    });
    if (files.length > 10) {
      console.log(`  ... and ${files.length - 10} more files`);
    }
  } else {
    console.warn(`[fetchBatchResults] ⚠️ No files found with prefix "${prefix}"`);
    // Try to list files in parent directory to see what's there
    const parentPrefix = prefix.substring(0, prefix.lastIndexOf('/'));
    if (parentPrefix) {
      console.log(`[fetchBatchResults] Checking parent directory: ${parentPrefix}`);
      const [parentFiles] = await bucket.getFiles({ prefix: parentPrefix, maxResults: 20 });
      console.log(`[fetchBatchResults] Found ${parentFiles.length} files in parent directory:`);
      parentFiles.forEach((file, i) => {
        console.log(`  ${i + 1}. ${file.name}`);
      });
    }
  }

  const jsonFiles = files.filter(f => f.name.endsWith('.json'));
  console.log(`[fetchBatchResults] Found ${jsonFiles.length} JSON files`);

  if (jsonFiles.length === 0) {
    console.error(`[fetchBatchResults] ❌ No JSON files found in output bucket`);
    return [];
  }

  // Download and process files in parallel
  const texts = await Promise.all(
    jsonFiles.map(async (file) => {
      try {
        console.log(`[fetchBatchResults] Processing file: ${file.name}`);
        const [contents] = await file.download();
        const json = JSON.parse(contents.toString());
        
        // Log JSON structure for debugging
        console.log(`[fetchBatchResults] JSON keys: ${Object.keys(json).join(', ')}`);
        if (json.document) {
          console.log(`[fetchBatchResults] Document keys: ${Object.keys(json.document).join(', ')}`);
          if (json.document.pages) {
            console.log(`[fetchBatchResults] Pages array length: ${json.document.pages.length}`);
          }
          if (json.document.text) {
            console.log(`[fetchBatchResults] Document text length: ${json.document.text.length} chars`);
          }
        }
        
        const doc = json.document || json;
        const extracted = extractText(doc); // returns array of page texts
        console.log(`[fetchBatchResults] Extracted ${extracted.length} text segments from ${file.name}`);
        
        // If extraction failed, log the structure for debugging
        if (extracted.length === 0) {
          console.error(`[fetchBatchResults] ⚠️ No text extracted from ${file.name}`);
          console.error(`[fetchBatchResults] Document structure:`, JSON.stringify({
            hasPages: !!doc.pages,
            pagesLength: doc.pages?.length || 0,
            hasText: !!doc.text,
            textLength: doc.text?.length || 0,
            keys: Object.keys(doc)
          }, null, 2));
        }
        
        return extracted;
      } catch (fileError) {
        console.error(`[fetchBatchResults] ❌ Error processing file ${file.name}:`, fileError.message);
        console.error(`[fetchBatchResults] Error stack:`, fileError.stack);
        return []; // Return empty array for failed files
      }
    })
  );

  // Flatten array of arrays into a single array
  const flattened = texts.flat();
  console.log(`[fetchBatchResults] ✅ Total extracted text segments: ${flattened.length}`);
  return flattened;
}

/**
 * Extracts text from a Document AI document object using simplified logic.
 * 1. First tries page-based extraction (structured)
 * 2. Falls back to root text field if structured extraction fails
 * @param {object} document - The Document AI document object.
 * @returns {Array<object>} An array of objects, each with 'text', 'page_start', and 'page_end'.
 */
function extractText(document) {
  if (!document) {
    console.warn(`[extractText] Document is null or undefined`);
    return [];
  }

  let extractedText = "";

  // 1. Try page-based extraction (structured logic)
  if (document.pages && Array.isArray(document.pages) && document.pages.length > 0) {
    console.log(`[extractText] Processing ${document.pages.length} pages from pages array`);
    
    const pageTexts = [];
    for (let i = 0; i < document.pages.length; i++) {
      const page = document.pages[i];
      const pageNumber = page.pageNumber !== null && page.pageNumber !== undefined
        ? page.pageNumber
        : (i + 1);
      
      // Try to extract text from page
      let pageText = null;
      
      // Try paragraphs first
      if (page.paragraphs && Array.isArray(page.paragraphs)) {
        const paragraphTexts = page.paragraphs
          .map(para => {
            if (para.layout && para.layout.textAnchor && para.layout.textAnchor.content) {
              return para.layout.textAnchor.content;
            }
            return null;
          })
          .filter(Boolean);
        if (paragraphTexts.length > 0) {
          pageText = paragraphTexts.join('\n');
        }
      }
      
      // Try lines if paragraphs didn't work
      if (!pageText && page.lines && Array.isArray(page.lines)) {
        const lineTexts = page.lines
          .map(line => {
            if (line.layout && line.layout.textAnchor && line.layout.textAnchor.content) {
              return line.layout.textAnchor.content;
            }
            return null;
          })
          .filter(Boolean);
        if (lineTexts.length > 0) {
          pageText = lineTexts.join('\n');
        }
      }
      
      // Try blocks if lines didn't work
      if (!pageText && page.blocks && Array.isArray(page.blocks)) {
        const blockTexts = page.blocks
          .map(block => {
            if (block.layout && block.layout.textAnchor && block.layout.textAnchor.content) {
              return block.layout.textAnchor.content;
            }
            return null;
          })
          .filter(Boolean);
        if (blockTexts.length > 0) {
          pageText = blockTexts.join('\n');
        }
      }
      
      // Try direct page.text field
      if (!pageText && page.text && page.text.trim()) {
        pageText = page.text;
      }
      
      if (pageText && pageText.trim()) {
        pageTexts.push({
          text: pageText.trim(),
          page_start: pageNumber,
          page_end: pageNumber,
        });
        extractedText += pageText.trim() + '\n\n';
      }
    }
    
    // If we got text from pages, return it
    if (pageTexts.length > 0) {
      console.log(`[extractText] ✅ Extracted ${pageTexts.length} pages with structured extraction`);
      return pageTexts;
    }
  }

  // 2. CRITICAL FIX: Fallback to root text
  // If structured extraction failed, or returned empty, take the raw text.
  if (!extractedText.trim() && document.text) {
    console.log(`[extractText] Structured extraction failed. Falling back to root text (Length: ${document.text.length})`);
    extractedText = document.text;
  }

  // If we have extracted text but no page structure, return as single block
  if (extractedText && extractedText.trim()) {
    // Try to estimate page count based on text length (~2000 chars per page)
    const estimatedPageCount = Math.max(1, Math.ceil(extractedText.length / 2000));
    
    // If it's a single page worth of text, return as one block
    if (estimatedPageCount === 1) {
      return [{
        text: extractedText.trim(),
        page_start: 1,
        page_end: 1,
      }];
    }
    
    // Otherwise, split into estimated pages
    const charsPerPage = Math.ceil(extractedText.length / estimatedPageCount);
    const pageTexts = [];
    for (let i = 0; i < estimatedPageCount; i++) {
      const start = i * charsPerPage;
      const end = Math.min(start + charsPerPage, extractedText.length);
      const pageText = extractedText.substring(start, end).trim();
      
      if (pageText.length > 0) {
        pageTexts.push({
          text: pageText,
          page_start: i + 1,
          page_end: i + 1,
        });
      }
    }
    
    console.log(`[extractText] ✅ Extracted ${pageTexts.length} pages from root text fallback`);
    return pageTexts;
  }

  // Last resort: try to find any text field
  console.warn(`[extractText] ⚠️ No text found in pages or root text field`);
  console.warn(`[extractText] Available keys: ${Object.keys(document).join(', ')}`);
  
  const textFields = ['text', 'content', 'fullText', 'documentText'];
  for (const field of textFields) {
    if (document[field] && typeof document[field] === 'string' && document[field].trim()) {
      console.log(`[extractText] ✅ Extracted text from field "${field}" (${document[field].trim().length} chars)`);
      return [{
        text: document[field].trim(),
        page_start: 1,
        page_end: 1,
      }];
    }
  }

  console.error(`[extractText] ❌ No text could be extracted from document`);
  return [];
}

/**
 * Parse gs:// URI into bucket + prefix
 */
function parseGcsUri(gcsUri) {
  if (!gcsUri.startsWith('gs://')) throw new Error(`Invalid GCS URI: ${gcsUri}`);
  const parts = gcsUri.replace('gs://', '').split('/');
  const bucketName = parts.shift();
  const prefix = parts.join('/');
  return { bucketName, prefix };
}

module.exports = {
  extractTextFromDocument,
  batchProcessDocument,
  getOperationStatus,
  fetchBatchResults,
  extractText,
};
