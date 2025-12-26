const { TranslationServiceClient } = require('@google-cloud/translate');
const config = require('../config/env');

class TranslationService {
  constructor() {
    const clientConfig = {
      projectId: config.googleCloud.projectId,
    };
    
    // Use credentials file if provided, otherwise rely on GOOGLE_APPLICATION_CREDENTIALS env var
    if (config.googleCloud.credentials) {
      clientConfig.keyFilename = config.googleCloud.credentials;
    }
    
    this.client = new TranslationServiceClient(clientConfig);
  }

  /**
   * Translates text using Google Cloud Translation API
   * @param {string} text - Text to translate
   * @param {string} targetLanguage - Target language code (e.g., 'en', 'es', 'fr')
   * @param {string} sourceLanguage - Source language code (optional, auto-detect if not provided)
   * @returns {Promise<{translatedText: string, detectedLanguage?: string}>}
   */
  async translateText(text, targetLanguage, sourceLanguage = null) {
    try {
      const projectId = config.googleCloud.projectId;
      const location = config.translation.location;
      const parent = `projects/${projectId}/locations/${location}`;

      const request = {
        parent,
        contents: [text],
        mimeType: 'text/plain',
        targetLanguageCode: targetLanguage,
      };

      if (sourceLanguage) {
        request.sourceLanguageCode = sourceLanguage;
      }

      const [response] = await this.client.translateText(request);

      const translation = response.translations[0];
      return {
        translatedText: translation.translatedText,
        detectedLanguage: translation.detectedLanguageCode,
      };
    } catch (error) {
      console.error('Translation error:', error);
      throw new Error(`Translation failed: ${error.message}`);
    }
  }

  /**
   * Translates a document (preserves format)
   * @param {Buffer} documentBuffer - Document buffer
   * @param {string} mimeType - MIME type of the document
   * @param {string} targetLanguage - Target language code
   * @param {string} sourceLanguage - Source language code (optional)
   * @returns {Promise<Buffer>} - Translated document buffer
   */
  async translateDocument(documentBuffer, mimeType, targetLanguage, sourceLanguage = null) {
    try {
      const projectId = config.googleCloud.projectId;
      const location = config.translation.location;
      const parent = `projects/${projectId}/locations/${location}`;

      const request = {
        parent,
        documentInputConfig: {
          content: documentBuffer,
          mimeType: mimeType,
        },
        targetLanguageCode: targetLanguage,
      };

      if (sourceLanguage) {
        request.sourceLanguageCode = sourceLanguage;
      }

      const [response] = await this.client.translateDocument(request);

      return Buffer.from(response.documentByteStream);
    } catch (error) {
      console.error('Document translation error:', error);
      throw new Error(`Document translation failed: ${error.message}`);
    }
  }

  /**
   * Translates text asynchronously (for large documents)
   * @param {string} gcsInputUri - GCS input URI
   * @param {string} gcsOutputUri - GCS output URI
   * @param {string} targetLanguage - Target language code
   * @param {string} sourceLanguage - Source language code (optional)
   * @returns {Promise<string>} - Operation name
   */
  async translateDocumentAsync(gcsInputUri, gcsOutputUri, targetLanguage, sourceLanguage = null) {
    try {
      const projectId = config.googleCloud.projectId;
      const location = config.translation.location;
      const parent = `projects/${projectId}/locations/${location}`;

      const request = {
        parent,
        sourceLanguageCode: sourceLanguage || '',
        targetLanguageCodes: [targetLanguage],
        inputConfigs: [
          {
            gcsSource: {
              inputUri: gcsInputUri,
            },
            mimeType: 'application/pdf',
          },
        ],
        outputConfig: {
          gcsDestination: {
            outputUriPrefix: gcsOutputUri,
          },
        },
      };

      const [operation] = await this.client.batchTranslateDocument(request);
      return operation.name;
    } catch (error) {
      console.error('Async translation error:', error);
      throw new Error(`Async translation failed: ${error.message}`);
    }
  }
}

module.exports = new TranslationService();

