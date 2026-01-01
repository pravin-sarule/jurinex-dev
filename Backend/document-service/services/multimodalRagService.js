const axios = require('axios');
const { VertexAI } = require('@google-cloud/vertexai');
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai');
const { Storage } = require('@google-cloud/storage');
const { RecursiveCharacterTextSplitter } = require('@langchain/textsplitters');
const pdfParse = require('pdf-parse');
const { credentials, fileOutputBucket } = require('../config/gcs');
const { uploadToGCS } = require('./gcsService');
const { 
  extractUrlsFromQuery, 
  isPdfUrl, 
  isWebPageUrl,
  fetchWebPageContent,
  streamWebPageFromUrl,
  processWebPageFromUrl,
  searchForPdfs,
  processPdfFromUrl
} = require('./webSearchService');

/**
 * Multimodal RAG Service
 * Handles: Query Analysis -> Document Acquisition -> GCS Upload -> Document AI -> RAG -> LLM Generation
 */

// Initialize clients
const projectId = process.env.GCLOUD_PROJECT_ID || process.env.GCP_PROJECT_ID;
const location = process.env.DOCUMENT_AI_LOCATION || 'us';
const processorId = process.env.DOCUMENT_AI_PROCESSOR_ID || process.env.DOCUMENT_AI_LAYOUT_PARSER_ID;

const docAiClient = new DocumentProcessorServiceClient({ credentials });
const storage = new Storage({ credentials });

// Helper function to get output bucket name
const getOutputBucketName = () => {
  const bucketName = process.env.GCS_OUTPUT_BUCKET_NAME || fileOutputBucket?.name;
  if (!bucketName) {
    throw new Error('GCS_OUTPUT_BUCKET_NAME environment variable is not set');
  }
  return bucketName;
};

// In-memory vector store (can be replaced with Pinecone)
const vectorStore = new Map();

/**
 * Query Analyzer: Determines if input is a direct URL or search query
 */
function analyzeQuery(query) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔍 [MULTIMODAL RAG] Query Analysis`);
  console.log(`${'='.repeat(80)}`);
  console.log(`   Original Query: "${query}"`);
  
  const urls = extractUrlsFromQuery(query);
  console.log(`   Extracted URLs:`, urls);
  
  const hasPdfUrl = urls.length > 0 && isPdfUrl(urls[0]);
  const hasWebPageUrl = urls.length > 0 && isWebPageUrl(urls[0]);
  const hasDirectUrl = hasPdfUrl || hasWebPageUrl;
  
  console.log(`   Has PDF URL: ${hasPdfUrl}`);
  console.log(`   Has Web Page URL: ${hasWebPageUrl}`);
  console.log(`   Has Direct URL: ${hasDirectUrl}`);
  console.log(`   Is Search Query: ${!hasDirectUrl}`);
  console.log(`${'='.repeat(80)}\n`);
  
  return {
    isDirectUrl: hasDirectUrl,
    isPdfUrl: hasPdfUrl,
    isWebPageUrl: hasWebPageUrl,
    url: hasDirectUrl ? urls[0] : null,
    isSearchQuery: !hasDirectUrl,
    originalQuery: query
  };
}

/**
 * Document Acquisition: Download PDF from URL, process web page, or search for it
 */
async function acquireDocument(queryAnalysis, statusCallback) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📥 [MULTIMODAL RAG] Document Acquisition`);
  console.log(`${'='.repeat(80)}`);
  
  let pdfBuffer = null;
  let sourceUrl = null;
  let documentTitle = 'Document';
  let isWebPage = false;
  let webPageContent = null;

  if (queryAnalysis.isDirectUrl) {
    if (queryAnalysis.isWebPageUrl) {
      // Web Page URL: Fetch and extract content
      console.log(`   Processing Web Page URL: ${queryAnalysis.url}`);
      statusCallback('SEARCHING', 'Fetching content from web page...');
      sourceUrl = queryAnalysis.url;
      
      try {
        const fetchResult = await fetchWebPageContent(queryAnalysis.url);
        console.log(`   Web page fetch result:`, {
          success: fetchResult.success,
          contentLength: fetchResult.content?.length || 0,
          error: fetchResult.error
        });
        
        if (!fetchResult.success) {
          throw new Error(`Failed to fetch web page: ${fetchResult.error || 'Unknown error'}`);
        }
        
        webPageContent = fetchResult.content;
        documentTitle = new URL(queryAnalysis.url).hostname;
        isWebPage = true;
        
        statusCallback('SEARCHING', `Fetched web page: ${(webPageContent.length / 1024).toFixed(2)} KB`);
        console.log(`   ✅ Successfully fetched web page content: ${webPageContent.length} chars`);
      } catch (error) {
        console.error(`   ❌ Error fetching web page:`, error);
        throw new Error(`Failed to fetch web page: ${error.message}`);
      }
    } else if (queryAnalysis.isPdfUrl) {
      // Direct PDF URL: Download the PDF
      console.log(`   Processing PDF URL: ${queryAnalysis.url}`);
      statusCallback('SEARCHING', 'Downloading PDF from provided URL...');
      sourceUrl = queryAnalysis.url;
      
      try {
        console.log(`   Attempting to download PDF from: ${sourceUrl}`);
        const response = await axios.get(sourceUrl, {
          responseType: 'arraybuffer',
          timeout: 30000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        
        pdfBuffer = Buffer.from(response.data);
        documentTitle = sourceUrl.split('/').pop().replace('.pdf', '') || 'Document';
        
        console.log(`   ✅ Successfully downloaded PDF: ${(pdfBuffer.length / 1024).toFixed(2)} KB`);
        statusCallback('SEARCHING', `Downloaded PDF: ${(pdfBuffer.length / 1024).toFixed(2)} KB`);
      } catch (error) {
        console.error(`   ❌ Error downloading PDF:`, error.message);
        throw new Error(`Failed to download PDF from URL: ${error.message}`);
      }
    }
  } else {
    // Search Query: Use Gemini's Google Search tool
    console.log(`   Processing Search Query: "${queryAnalysis.originalQuery}"`);
    statusCallback('SEARCHING', 'Searching for relevant PDF documents using Google Search...');
    
    try {
      console.log(`   Calling searchForPdfs with query: "${queryAnalysis.originalQuery}"`);
      const searchResults = await searchForPdfs(queryAnalysis.originalQuery, 1);
      
      console.log(`   Search results:`, {
        success: searchResults.success,
        resultsCount: searchResults.results?.length || 0,
        error: searchResults.error
      });
      
      if (!searchResults.success || !searchResults.results || searchResults.results.length === 0) {
        console.error(`   ❌ No PDFs found in search results`);
        throw new Error(searchResults.error || 'No PDF documents found in search results');
      }
      
      const topResult = searchResults.results[0];
      sourceUrl = topResult.link;
      documentTitle = topResult.title || 'Document';
      
      console.log(`   ✅ Found PDF: ${documentTitle} at ${sourceUrl}`);
      statusCallback('SEARCHING', `Found PDF: ${documentTitle}`);
      
      // Download the PDF
      console.log(`   Downloading PDF from: ${sourceUrl}`);
      const pdfResponse = await axios.get(sourceUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      pdfBuffer = Buffer.from(pdfResponse.data);
      console.log(`   ✅ Successfully downloaded PDF: ${(pdfBuffer.length / 1024).toFixed(2)} KB`);
      statusCallback('SEARCHING', `Downloaded PDF: ${(pdfBuffer.length / 1024).toFixed(2)} KB`);
    } catch (error) {
      console.error(`   ❌ Search and download failed:`, error);
      throw new Error(`Search and download failed: ${error.message}`);
    }
  }
  
  console.log(`${'='.repeat(80)}\n`);
  
  return { pdfBuffer, sourceUrl, documentTitle, isWebPage, webPageContent };
}

/**
 * GCS Upload: Upload PDF to Google Cloud Storage
 */
async function uploadToGCSBucket(pdfBuffer, filename, statusCallback) {
  statusCallback('EXTRACTING', 'Uploading document to Google Cloud Storage...');
  
  try {
    // Get output bucket name from environment
    const outputBucketName = process.env.GCS_OUTPUT_BUCKET_NAME || fileOutputBucket?.name;
    
    if (!outputBucketName) {
      throw new Error('GCS_OUTPUT_BUCKET_NAME environment variable is not set');
    }
    
    console.log(`   📦 Using output bucket: ${outputBucketName}`);
    
    // Upload to the output bucket
    const timestamp = Date.now();
    const safeFilename = (filename || 'document.pdf').replace(/\s+/g, '_');
    const destination = `multimodal-rag/${timestamp}_${safeFilename}`;
    const file = fileOutputBucket.file(destination);
    
    await file.save(pdfBuffer, {
      resumable: false,
      metadata: {
        contentType: 'application/pdf',
        cacheControl: 'public, max-age=31536000',
      },
    });
    
    const gsUri = `gs://${outputBucketName}/${destination}`;
    
    console.log(`   ✅ Uploaded to: ${gsUri}`);
    statusCallback('EXTRACTING', 'Document uploaded to GCS successfully');
    
    return {
      gsUri: gsUri,
      gcsPath: destination
    };
  } catch (error) {
    console.error(`   ❌ GCS upload error:`, error);
    throw new Error(`GCS upload failed: ${error.message}`);
  }
}

/**
 * Document AI Pipeline: Extract text, tables, and visual elements
 */
async function processWithDocumentAI(gcsUri, statusCallback) {
  statusCallback('EXTRACTING', 'Processing document with Document AI Layout Parser...');
  
  try {
    const name = `projects/${projectId}/locations/${location}/processors/${processorId}`;
    
    const request = {
      name,
      rawDocument: {
        gcsUri: gcsUri,
        mimeType: 'application/pdf'
      }
    };
    
    const [operation] = await docAiClient.processDocument(request);
    const result = operation.document;
    
    // Extract full text
    let fullText = '';
    if (result.text) {
      fullText = result.text;
    }
    
    // Extract tables
    const tables = [];
    if (result.pages) {
      for (const page of result.pages) {
        if (page.tables) {
          for (const table of page.tables) {
            const tableData = extractTableData(table, result.text);
            tables.push({
              page: page.pageNumber || 1,
              data: tableData,
              markdown: convertTableToMarkdown(tableData),
              json: JSON.stringify(tableData, null, 2)
            });
          }
        }
      }
    }
    
    // Extract visual elements and document structure
    const visualElements = [];
    const documentStructure = {
      pages: result.pages?.length || 0,
      paragraphs: [],
      headings: [],
      lists: []
    };
    
    if (result.pages) {
      for (const page of result.pages) {
        if (page.paragraphs) {
          for (const para of page.paragraphs) {
            documentStructure.paragraphs.push({
              page: page.pageNumber || 1,
              text: extractTextFromLayout(para.layout, result.text)
            });
          }
        }
        
        if (page.blocks) {
          for (const block of page.blocks) {
            if (block.layout) {
              const blockText = extractTextFromLayout(block.layout, result.text);
              if (blockText.length > 0) {
                visualElements.push({
                  page: page.pageNumber || 1,
                  type: 'block',
                  text: blockText
                });
              }
            }
          }
        }
      }
    }
    
    statusCallback('EXTRACTING', `Extracted: ${fullText.length} chars, ${tables.length} tables, ${visualElements.length} visual elements`);
    
    return {
      fullText,
      tables,
      visualElements,
      documentStructure,
      pages: result.pages?.length || 0
    };
  } catch (error) {
    console.error('Document AI processing error:', error);
    // Fallback to PDF parsing
    return await fallbackPdfParsing(gcsUri, statusCallback);
  }
}

/**
 * Fallback: Use pdf-parse for text extraction
 */
async function fallbackPdfParsing(gcsUri, statusCallback) {
  statusCallback('EXTRACTING', 'Using fallback PDF parser...');
  
  try {
    // Use fileOutputBucket from config (uses GCS_OUTPUT_BUCKET_NAME)
    const outputBucketName = process.env.GCS_OUTPUT_BUCKET_NAME || fileOutputBucket?.name;
    
    if (!outputBucketName) {
      throw new Error('GCS_OUTPUT_BUCKET_NAME environment variable is not set');
    }
    
    console.log(`   Using output bucket for fallback: ${outputBucketName}`);
    
    // Download from GCS
    const gcsPath = gcsUri.replace(`gs://${outputBucketName}/`, '');
    const bucket = fileOutputBucket || storage.bucket(outputBucketName);
    const file = bucket.file(gcsPath);
    const [buffer] = await file.download();
    
    // Parse PDF
    const pdfData = await pdfParse(buffer);
    
    return {
      fullText: pdfData.text,
      tables: [],
      visualElements: [],
      documentStructure: {
        pages: pdfData.numpages,
        paragraphs: [],
        headings: [],
        lists: []
      },
      pages: pdfData.numpages
    };
  } catch (error) {
    throw new Error(`Fallback PDF parsing failed: ${error.message}`);
  }
}

/**
 * Extract text from layout element
 */
function extractTextFromLayout(layout, fullText) {
  if (!layout || !layout.textAnchor) return '';
  
  const startIndex = layout.textAnchor.textSegments?.[0]?.startIndex || 0;
  const endIndex = layout.textAnchor.textSegments?.[0]?.endIndex || 0;
  
  return fullText.substring(parseInt(startIndex), parseInt(endIndex));
}

/**
 * Extract table data from Document AI table
 */
function extractTableData(table, fullText) {
  const rows = [];
  
  if (table.headerRows) {
    for (const headerRow of table.headerRows) {
      const cells = [];
      if (headerRow.cells) {
        for (const cell of headerRow.cells) {
          cells.push(extractTextFromLayout(cell.layout, fullText));
        }
      }
      rows.push(cells);
    }
  }
  
  if (table.bodyRows) {
    for (const bodyRow of table.bodyRows) {
      const cells = [];
      if (bodyRow.cells) {
        for (const cell of bodyRow.cells) {
          cells.push(extractTextFromLayout(cell.layout, fullText));
        }
      }
      rows.push(cells);
    }
  }
  
  return rows;
}

/**
 * Convert table data to Markdown
 */
function convertTableToMarkdown(tableData) {
  if (!tableData || tableData.length === 0) return '';
  
  let markdown = '';
  for (let i = 0; i < tableData.length; i++) {
    const row = tableData[i];
    markdown += '| ' + row.join(' | ') + ' |\n';
    
    if (i === 0) {
      markdown += '|' + row.map(() => '---').join('|') + '|\n';
    }
  }
  
  return markdown;
}

/**
 * RAG Workflow: Chunk text and generate embeddings
 */
async function createRAGIndex(extractedData, sourceUrl, statusCallback) {
  console.log(`   Starting RAG index creation...`);
  statusCallback('VECTORIZING', 'Chunking document and generating embeddings...');
  
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
    separators: ['\n\n', '\n', '. ', ' ', '']
  });
  
  // Combine all text sources
  let allText = extractedData.fullText;
  console.log(`   Base text length: ${allText.length} chars`);
  
  // Add table data as text
  for (const table of extractedData.tables) {
    allText += '\n\n' + table.markdown;
  }
  console.log(`   After adding ${extractedData.tables.length} tables: ${allText.length} chars`);
  
  // Add visual elements
  for (const element of extractedData.visualElements) {
    allText += '\n\n' + element.text;
  }
  console.log(`   After adding ${extractedData.visualElements.length} visual elements: ${allText.length} chars`);
  
  // Split into chunks
  console.log(`   Splitting text into chunks...`);
  const chunks = await textSplitter.createDocuments([allText]);
  console.log(`   Created ${chunks.length} chunks`);
  
  statusCallback('VECTORIZING', `Created ${chunks.length} text chunks`);
  
  // Generate embeddings using Vertex AI
  const vertexAI = initializeVertexAI();
  const embeddings = [];
  
  console.log(`   Generating embeddings for ${chunks.length} chunks...`);
  for (let i = 0; i < chunks.length; i++) {
    if (i % 5 === 0 || i === chunks.length - 1) {
      statusCallback('VECTORIZING', `Generating embeddings: ${i + 1}/${chunks.length}`);
      console.log(`   Processing chunk ${i + 1}/${chunks.length}`);
    }
    
    const chunk = chunks[i];
    const embedding = await generateEmbedding(chunk.pageContent, vertexAI);
    
    const chunkData = {
      id: `chunk_${i}_${Date.now()}`,
      text: chunk.pageContent,
      embedding,
      metadata: {
        sourceUrl,
        chunkIndex: i,
        totalChunks: chunks.length
      }
    };
    
    vectorStore.set(chunkData.id, chunkData);
    embeddings.push(chunkData);
  }
  
  console.log(`   ✅ Generated ${embeddings.length} embeddings`);
  statusCallback('VECTORIZING', 'Embeddings generated and stored');
  
  return {
    chunks: embeddings,
    totalChunks: chunks.length
  };
}

/**
 * Generate embedding using existing embedding service
 */
async function generateEmbedding(text, vertexAI) {
  try {
    // Use existing embedding service
    const { generateEmbedding: generateEmbeddingFromService } = require('./embeddingService');
    const embedding = await generateEmbeddingFromService(text);
    const result = Array.isArray(embedding) ? embedding : (embedding.values || []);
    console.log(`      Generated embedding: ${result.length} dimensions`);
    return result;
  } catch (error) {
    console.error('      ❌ Embedding generation error:', error.message);
    // Last resort: simple hash-based embedding (not recommended for production)
    return Array(768).fill(0).map(() => Math.random());
  }
}

/**
 * Initialize Vertex AI
 */
function initializeVertexAI() {
  const projectId = process.env.GCP_PROJECT_ID || process.env.GCLOUD_PROJECT_ID;
  const location = process.env.GCP_LOCATION || 'us-central1';
  
  return new VertexAI({
    project: projectId,
    location: location
  });
}

/**
 * Semantic search in vector store
 */
async function searchVectorStore(query, topK = 5) {
  // Simple cosine similarity search (in production, use proper vector DB)
  const queryEmbedding = await generateEmbedding(query, initializeVertexAI());
  
  const results = [];
  for (const [id, chunkData] of vectorStore.entries()) {
    const similarity = cosineSimilarity(queryEmbedding, chunkData.embedding);
    results.push({ ...chunkData, similarity });
  }
  
  return results
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}

/**
 * Cosine similarity
 */
function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * LLM Generation: Use Gemini 1.5 Pro with retrieved context
 */
async function generateResponse(userQuery, ragContext, sourceUrl, statusCallback) {
  statusCallback('GENERATING', 'Generating response with Gemini 1.5 Pro...');
  
  const vertexAI = initializeVertexAI();
  const model = vertexAI.getGenerativeModel({
    model: 'gemini-1.5-pro'
  });
  
  // Build context from retrieved chunks
  const contextText = ragContext.chunks
    .map((chunk, idx) => `[Chunk ${idx + 1}]\n${chunk.text}`)
    .join('\n\n---\n\n');
  
  // Build prompt with citations
  const prompt = `You are an expert document analysis assistant. Answer the user's question based on the following context extracted from a PDF document.

**Source Document:** ${sourceUrl}

**Context from Document:**
${contextText}

**User Question:** ${userQuery}

**Instructions:**
1. Provide a comprehensive answer based on the context above
2. Include specific citations in your response using the format: [Source: Page X] or [Chunk Y]
3. Be accurate and cite the exact source when referencing information
4. If the context doesn't contain enough information, say so clearly
5. Format your response with proper structure and readability

**Response:**`;

  try {
    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
        topP: 0.95,
        topK: 40
      }
    });
    
    if (!result.response || !result.response.candidates || !result.response.candidates.length) {
      throw new Error('Empty response from Gemini');
    }
    
    const responseText = result.response.candidates[0].content.parts[0].text;
    
    // Extract citations from response
    const citations = extractCitations(responseText, sourceUrl, ragContext);
    
    statusCallback('GENERATING', 'Response generated successfully');
    
    return {
      response: responseText,
      citations,
      sourceUrl,
      chunksUsed: ragContext.chunks.length
    };
  } catch (error) {
    throw new Error(`LLM generation failed: ${error.message}`);
  }
}

/**
 * Extract citations from response text
 */
function extractCitations(responseText, sourceUrl, ragContext) {
  const citations = [];
  
  // Extract [Source: Page X] or [Chunk Y] patterns
  const citationPattern = /\[(?:Source|Chunk)\s*:?\s*([^\]]+)\]/gi;
  let match;
  
  while ((match = citationPattern.exec(responseText)) !== null) {
    citations.push({
      reference: match[0],
      page: extractPageNumber(match[1]),
      sourceUrl,
      chunkIndex: extractChunkIndex(match[1])
    });
  }
  
  return citations;
}

function extractPageNumber(text) {
  const pageMatch = text.match(/page\s*(\d+)/i);
  return pageMatch ? parseInt(pageMatch[1]) : null;
}

function extractChunkIndex(text) {
  const chunkMatch = text.match(/chunk\s*(\d+)/i);
  return chunkMatch ? parseInt(chunkMatch[1]) : null;
}

/**
 * Main Pipeline: Orchestrates the entire multimodal RAG workflow
 */
async function processMultimodalRAG(query, statusCallback) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🚀 [MULTIMODAL RAG] Starting Pipeline`);
  console.log(`${'='.repeat(80)}`);
  console.log(`   Query: "${query}"`);
  console.log(`   Timestamp: ${new Date().toISOString()}`);
  console.log(`${'='.repeat(80)}\n`);
  
  try {
    // Step 1: Query Analysis
    console.log(`\n[STEP 1] Query Analysis`);
    statusCallback('SEARCHING', 'Analyzing query...');
    const queryAnalysis = analyzeQuery(query);
    console.log(`✅ Query analysis complete\n`);
    
    // Step 2: Document Acquisition
    console.log(`\n[STEP 2] Document Acquisition`);
    const { pdfBuffer, sourceUrl, documentTitle, isWebPage, webPageContent } = await acquireDocument(queryAnalysis, statusCallback);
    console.log(`✅ Document acquisition complete`);
    console.log(`   Source URL: ${sourceUrl}`);
    console.log(`   Document Title: ${documentTitle}`);
    console.log(`   Is Web Page: ${isWebPage}`);
    console.log(`   Has PDF Buffer: ${!!pdfBuffer}`);
    console.log(`   Has Web Page Content: ${!!webPageContent}\n`);
    
    // Handle web pages differently - process directly without Document AI
    if (isWebPage && webPageContent) {
      console.log(`\n[WEB PAGE MODE] Processing web page content directly`);
      statusCallback('EXTRACTING', 'Processing web page content...');
      
      // Create extracted data structure for web pages
      const extractedData = {
        fullText: webPageContent,
        tables: [],
        visualElements: [],
        documentStructure: {
          pages: 1,
          paragraphs: [],
          headings: [],
          lists: []
        },
        pages: 1
      };
      
      console.log(`   Extracted ${extractedData.fullText.length} characters from web page`);
      statusCallback('EXTRACTING', `Extracted: ${extractedData.fullText.length} chars from web page`);
      
      // Step 5: RAG Index Creation
      console.log(`\n[STEP 5] RAG Index Creation`);
      const ragIndex = await createRAGIndex(extractedData, sourceUrl, statusCallback);
      console.log(`✅ RAG index created: ${ragIndex.totalChunks} chunks\n`);
      
      // Step 6: Search for relevant chunks
      console.log(`\n[STEP 6] Vector Search`);
      statusCallback('VECTORIZING', 'Searching for relevant document sections...');
      const relevantChunks = await searchVectorStore(query, 5);
      console.log(`✅ Found ${relevantChunks.length} relevant chunks\n`);
      
      // Step 7: LLM Generation
      console.log(`\n[STEP 7] LLM Generation`);
      const ragContext = {
        chunks: relevantChunks,
        extractedData
      };
      
      const response = await generateResponse(query, ragContext, sourceUrl, statusCallback);
      console.log(`✅ Response generated: ${response.response.length} characters`);
      console.log(`   Citations: ${response.citations.length}\n`);
      
      return {
        success: true,
        response: response.response,
        citations: response.citations,
        sourceUrl: response.sourceUrl,
        extractionStats: {
          textLength: extractedData.fullText.length,
          tablesCount: extractedData.tables.length,
          visualElementsCount: extractedData.visualElements.length,
          pages: extractedData.pages,
          chunksUsed: response.chunksUsed
        },
        documentTitle
      };
    }
    
    // PDF Processing Path
    if (!pdfBuffer) {
      throw new Error('No PDF buffer available for processing');
    }
    
    // Step 3: GCS Upload
    console.log(`\n[STEP 3] GCS Upload`);
    const gcsResult = await uploadToGCSBucket(pdfBuffer, `${documentTitle}.pdf`, statusCallback);
    console.log(`✅ GCS upload complete`);
    console.log(`   GCS URI: ${gcsResult.gsUri}`);
    console.log(`   GCS Path: ${gcsResult.gcsPath}\n`);
    
    // Step 4: Document AI Processing
    console.log(`\n[STEP 4] Document AI Processing`);
    const extractedData = await processWithDocumentAI(gcsResult.gsUri, statusCallback);
    console.log(`✅ Document AI processing complete`);
    console.log(`   Text Length: ${extractedData.fullText.length} chars`);
    console.log(`   Tables: ${extractedData.tables.length}`);
    console.log(`   Visual Elements: ${extractedData.visualElements.length}`);
    console.log(`   Pages: ${extractedData.pages}\n`);
    
    // Step 5: RAG Index Creation
    console.log(`\n[STEP 5] RAG Index Creation`);
    const ragIndex = await createRAGIndex(extractedData, sourceUrl, statusCallback);
    console.log(`✅ RAG index created: ${ragIndex.totalChunks} chunks\n`);
    
    // Step 6: Search for relevant chunks (using original query)
    console.log(`\n[STEP 6] Vector Search`);
    statusCallback('VECTORIZING', 'Searching for relevant document sections...');
    const relevantChunks = await searchVectorStore(query, 5);
    console.log(`✅ Found ${relevantChunks.length} relevant chunks\n`);
    
    // Step 7: LLM Generation
    console.log(`\n[STEP 7] LLM Generation`);
    const ragContext = {
      chunks: relevantChunks,
      extractedData
    };
    
    const response = await generateResponse(query, ragContext, sourceUrl, statusCallback);
    console.log(`✅ Response generated: ${response.response.length} characters`);
    console.log(`   Citations: ${response.citations.length}\n`);
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`✅ [MULTIMODAL RAG] Pipeline Complete`);
    console.log(`${'='.repeat(80)}\n`);
    
    return {
      success: true,
      response: response.response,
      citations: response.citations,
      sourceUrl: response.sourceUrl,
      extractionStats: {
        textLength: extractedData.fullText.length,
        tablesCount: extractedData.tables.length,
        visualElementsCount: extractedData.visualElements.length,
        pages: extractedData.pages,
        chunksUsed: response.chunksUsed
      },
      documentTitle
    };
  } catch (error) {
    console.error(`\n${'='.repeat(80)}`);
    console.error(`❌ [MULTIMODAL RAG] Pipeline Error`);
    console.error(`${'='.repeat(80)}`);
    console.error(`   Error: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
    console.error(`${'='.repeat(80)}\n`);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  processMultimodalRAG,
  analyzeQuery,
  acquireDocument,
  uploadToGCSBucket,
  processWithDocumentAI,
  createRAGIndex,
  generateResponse
};

