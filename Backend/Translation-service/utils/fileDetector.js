const fs = require('fs');
const path = require('path');

// Import file-type (v16 supports CommonJS)
let fileTypeFromBuffer;
try {
  const fileType = require('file-type');
  fileTypeFromBuffer = fileType.fromBuffer || fileType;
} catch (e) {
  fileTypeFromBuffer = null;
  console.warn('file-type package not available, file detection may be limited');
}

/**
 * Detects if a file is digital native (text-based) or scanned (image-based)
 * @param {Buffer} fileBuffer - The file buffer
 * @param {string} mimeType - The MIME type of the file
 * @returns {Promise<{isDigitalNative: boolean, fileType: string}>}
 */
async function detectFileType(fileBuffer, mimeType) {
  try {
    // Digital native formats (text-based)
    const digitalNativeTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
      'text/plain',
      'text/html',
      'text/csv',
      'application/rtf',
    ];

    // Scanned/image formats
    const scannedTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/tiff',
      'image/bmp',
      'image/gif',
    ];

    // Check MIME type first
    if (digitalNativeTypes.includes(mimeType)) {
      // For PDFs, check if it contains actual text or is just scanned images
      if (mimeType === 'application/pdf') {
        const isTextBased = await checkPdfHasText(fileBuffer);
        return {
          isDigitalNative: isTextBased,
          fileType: isTextBased ? 'digital-native-pdf' : 'scanned-pdf',
        };
      }
      return {
        isDigitalNative: true,
        fileType: 'digital-native',
      };
    }

    if (scannedTypes.includes(mimeType)) {
      return {
        isDigitalNative: false,
        fileType: 'scanned-image',
      };
    }

    // Try to detect from buffer if MIME type is unknown
    if (fileTypeFromBuffer) {
      try {
        const detectedType = await fileTypeFromBuffer(fileBuffer);
        if (detectedType) {
          if (scannedTypes.includes(detectedType.mime)) {
            return {
              isDigitalNative: false,
              fileType: 'scanned-image',
            };
          }
        }
      } catch (detectError) {
        // If detection fails, continue with default behavior
        console.warn('File type detection failed:', detectError);
      }
    }

    // Default: assume digital native for unknown types
    return {
      isDigitalNative: true,
      fileType: 'unknown',
    };
  } catch (error) {
    console.error('Error detecting file type:', error);
    // Default to digital native on error
    return {
      isDigitalNative: true,
      fileType: 'unknown',
    };
  }
}

/**
 * Checks if a PDF contains actual text (not just scanned images)
 * This is a simple heuristic - checks for common text patterns
 */
async function checkPdfHasText(buffer) {
  try {
    const pdfString = buffer.toString('utf-8', 0, Math.min(5000, buffer.length));
    
    // Check for PDF text objects (simple heuristic)
    // Real PDFs with text usually have /Font or /Text objects
    const hasTextIndicators = 
      pdfString.includes('/Font') ||
      pdfString.includes('/Text') ||
      pdfString.includes('/Type/Page') ||
      pdfString.includes('stream') && pdfString.includes('endstream');
    
    // Scanned PDFs are usually just image streams
    const hasImageIndicators = 
      pdfString.includes('/Image') ||
      pdfString.includes('/XObject') ||
      pdfString.includes('/Subtype/Image');
    
    // If it has text indicators and not just image indicators, it's likely digital native
    return hasTextIndicators && !hasImageIndicators;
  } catch (error) {
    // If we can't determine, assume it's digital native
    return true;
  }
}

module.exports = {
  detectFileType,
};

