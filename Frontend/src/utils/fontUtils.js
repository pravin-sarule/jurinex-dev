/**
 * Font Utilities for PDF Generation
 * Provides helper functions for font detection, verification, and management
 */

// Devanagari Unicode ranges
const DEVANAGARI_UNICODE_RANGES = [
  /[\u0900-\u097F]/, // Main Devanagari block (U+0900–U+097F)
  /[\u1CD0-\u1CFF]/, // Vedic Extensions (U+1CD0–U+1CFF)
  /[\uA8E0-\uA8FF]/, // Devanagari Extended (U+A8E0–U+A8FF)
];

/**
 * Detects if text contains Devanagari characters
 * @param {string} text - Text to check
 * @returns {boolean} - True if Devanagari characters are found
 */
export const containsDevanagari = (text) => {
  if (!text || typeof text !== 'string') return false;
  return DEVANAGARI_UNICODE_RANGES.some(regex => regex.test(text));
};

/**
 * Extracts all text content from a DOM element recursively
 * @param {Element} element - DOM element to extract text from
 * @returns {string} - All text content concatenated
 */
export const extractAllText = (element) => {
  if (!element) return '';
  
  let text = '';
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );
  
  let node;
  while (node = walker.nextNode()) {
    text += node.textContent || '';
  }
  
  return text;
};

/**
 * Checks if the content contains Devanagari text
 * @param {Element} element - DOM element to check
 * @returns {boolean} - True if Devanagari text is found
 */
export const hasDevanagariContent = (element) => {
  if (!element) return false;
  const allText = extractAllText(element);
  return containsDevanagari(allText);
};

/**
 * Verifies if Devanagari fonts are available in pdfMake VFS
 * @param {Object} pdfMake - pdfMake instance
 * @returns {Object} - Verification result with details
 */
export const verifyDevanagariFonts = (pdfMake) => {
  const result = {
    available: false,
    regularAvailable: false,
    boldAvailable: false,
    fontFamilyRegistered: false,
    details: {}
  };

  if (!pdfMake || !pdfMake.vfs) {
    return result;
  }

  const regularKey = 'NotoSansDevanagari-Regular.ttf';
  const boldKey = 'NotoSansDevanagari-Bold.ttf';

  result.regularAvailable = !!pdfMake.vfs[regularKey];
  result.boldAvailable = !!pdfMake.vfs[boldKey];
  result.available = result.regularAvailable; // At least regular is needed

  if (pdfMake.fonts && pdfMake.fonts.DevanagariFont) {
    result.fontFamilyRegistered = true;
    result.details.fontFamily = pdfMake.fonts.DevanagariFont;
  }

  result.details.vfsKeys = Object.keys(pdfMake.vfs).filter(key => 
    key.toLowerCase().includes('devanagari') || 
    key.toLowerCase().includes('noto')
  );

  return result;
};

/**
 * Gets a list of available fonts in pdfMake
 * @param {Object} pdfMake - pdfMake instance
 * @returns {Array<string>} - List of registered font family names
 */
export const getAvailableFonts = (pdfMake) => {
  if (!pdfMake || !pdfMake.fonts) {
    return [];
  }
  return Object.keys(pdfMake.fonts);
};

/**
 * Gets a list of available VFS files
 * @param {Object} pdfMake - pdfMake instance
 * @param {number} limit - Maximum number of keys to return (default: 50)
 * @returns {Array<string>} - List of VFS file keys
 */
export const getAvailableVfsFiles = (pdfMake, limit = 50) => {
  if (!pdfMake || !pdfMake.vfs) {
    return [];
  }
  return Object.keys(pdfMake.vfs).slice(0, limit);
};

