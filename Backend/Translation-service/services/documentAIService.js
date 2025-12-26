const { DocumentProcessorServiceClient } = require('@google-cloud/documentai');
const config = require('../config/env');

class DocumentAIService {
  constructor() {
    const clientConfig = {
      projectId: config.googleCloud.projectId,
    };
    
    // Use credentials file if provided, otherwise rely on GOOGLE_APPLICATION_CREDENTIALS env var
    if (config.googleCloud.credentials) {
      clientConfig.keyFilename = config.googleCloud.credentials;
    }
    
    this.client = new DocumentProcessorServiceClient(clientConfig);
    this.processorName = `projects/${config.googleCloud.projectId}/locations/${config.documentAI.location}/processors/${config.documentAI.processorId}`;
  }

  /**
   * Processes a document using Document AI to extract text
   * @param {Buffer} documentBuffer - Document buffer
   * @param {string} mimeType - MIME type of the document
   * @returns {Promise<{text: string, pages: Array}>}
   */
  async processDocument(documentBuffer, mimeType) {
    try {
      const request = {
        name: this.processorName,
        rawDocument: {
          content: documentBuffer,
          mimeType: mimeType,
        },
      };

      const [result] = await this.client.processDocument(request);
      const document = result.document;

      // Extract text from all pages
      const fullText = document.text || '';
      const pages = document.pages || [];

      return {
        text: fullText,
        pages: pages.map((page, index) => ({
          pageNumber: index + 1,
          text: page.paragraphs?.map(p => p.layout?.textAnchor?.textSegments?.map(seg => {
            const start = seg.startIndex || 0;
            const end = seg.endIndex || 0;
            return fullText.substring(start, end);
          }).join('') || '').join('\n') || '',
        })),
        entities: document.entities || [],
      };
    } catch (error) {
      console.error('Document AI processing error:', error);
      throw new Error(`Document AI processing failed: ${error.message}`);
    }
  }

  /**
   * Processes a document asynchronously (for large documents)
   * @param {string} gcsInputUri - GCS input URI
   * @param {string} gcsOutputUri - GCS output URI
   * @returns {Promise<string>} - Operation name
   */
  async processDocumentAsync(gcsInputUri, gcsOutputUri) {
    try {
      const request = {
        name: this.processorName,
        inputDocuments: {
          gcsDocuments: {
            documents: [
              {
                gcsUri: gcsInputUri,
                mimeType: 'application/pdf',
              },
            ],
          },
        },
        documentOutputConfig: {
          gcsOutputConfig: {
            gcsUri: gcsOutputUri,
          },
        },
      };

      const [operation] = await this.client.batchProcessDocuments(request);
      return operation.name;
    } catch (error) {
      console.error('Async Document AI processing error:', error);
      throw new Error(`Async Document AI processing failed: ${error.message}`);
    }
  }
}

module.exports = new DocumentAIService();

