const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

async function detectDigitalNativePDF(fileBuffer) {
  try {
    const pdfData = await pdfParse(fileBuffer);
    const extractedText = pdfData.text || '';
    const pageCount = pdfData.numpages || 1;
    
    if (pageCount === 0 || !extractedText.trim()) {
      return {
        isDigitalNative: false,
        text: extractedText,
        pageCount,
        confidence: 0,
        reasons: ['No text extracted - use Document AI']
      };
    }
    
    const trimmedText = extractedText.trim();
    const nonWhitespaceChars = extractedText.replace(/\s/g, '').length;
    const words = trimmedText.split(/\s+/).filter(w => w.length > 1);
    const wordCount = words.length;
    
    const charsPerPage = extractedText.length / pageCount;
    const wordsPerPage = wordCount / pageCount;
    const minCharsRequired = 100 * pageCount;
    const minWordsRequired = 10 * pageCount;
    
    const isDigitalNative = 
      nonWhitespaceChars >= minCharsRequired &&
      wordCount >= minWordsRequired &&
      charsPerPage >= 100 &&
      wordsPerPage >= 10;
    
    return {
      isDigitalNative,
      text: extractedText,
      pageCount,
      confidence: isDigitalNative ? 85 : 30,
      reasons: isDigitalNative 
        ? ['Digital-native PDF detected'] 
        : ['Low text density - likely scanned PDF']
    };
  } catch (error) {
    return {
      isDigitalNative: false,
      text: '',
      pageCount: 0,
      confidence: 0,
      reasons: [`Error: ${error.message}`]
    };
  }
}

async function extractTextFromPDFWithPages(fileBuffer) {
  try {
    const pdfData = await pdfParse(fileBuffer);
    const pageCount = pdfData.numpages || 1;
    const fullText = pdfData.text || '';
    
    if (!fullText || pageCount <= 1) {
      return [{
        text: normalizeText(fullText),
        page_start: 1,
        page_end: pageCount || 1
      }];
    }
    
    const totalChars = fullText.length;
    const avgCharsPerPage = Math.ceil(totalChars / pageCount);
    const normalizedText = normalizeText(fullText);
    
    const pageTexts = [];
    let currentPage = 1;
    let currentIndex = 0;
    
    while (currentIndex < normalizedText.length && currentPage <= pageCount) {
      let pageEndIndex = currentPage === pageCount 
        ? normalizedText.length 
        : Math.min(currentIndex + avgCharsPerPage, normalizedText.length);
      
      const pageText = normalizedText.substring(currentIndex, pageEndIndex).trim();
      
      if (pageText.length > 0) {
        pageTexts.push({
          text: pageText,
          page_start: currentPage,
          page_end: currentPage
        });
      }
      
      currentIndex = pageEndIndex;
      currentPage++;
    }
    
    return pageTexts.length > 0 ? pageTexts : [{
      text: normalizedText,
      page_start: 1,
      page_end: pageCount
    }];
    
  } catch (error) {
    throw new Error(`PDF extraction failed: ${error.message}`);
  }
}

async function extractText(fileBuffer, mimetype) {
  let extracted = '';
  
  if (mimetype === 'application/pdf') {
    const detection = await detectDigitalNativePDF(fileBuffer);
    
    if (!detection.isDigitalNative) {
      throw new Error('PDF is not digital-native. Use Document AI for OCR processing.');
    }
    
    extracted = detection.text;
  } else if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ buffer: fileBuffer });
    extracted = result.value;
  } else {
    throw new Error('Unsupported file type for text extraction');
  }
  
  return normalizeText(extracted);
}

function normalizeText(text) {
  if (typeof text !== 'string') return '';
  let cleanedText = text.replace(/[ \t]+/g, ' ');
  cleanedText = cleanedText.replace(/\n\s*\n/g, '\n\n');
  cleanedText = cleanedText.split('\n').map(line => line.trim()).join('\n');
  return cleanedText.trim();
}

module.exports = { 
  extractText, 
  normalizeText,
  detectDigitalNativePDF,
  extractTextFromPDFWithPages
};
