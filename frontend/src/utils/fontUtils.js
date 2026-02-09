const DEVANAGARI_UNICODE_RANGES = [
  /[\u0900-\u097F]/,
  /[\u1CD0-\u1CFF]/,
  /[\uA8E0-\uA8FF]/,
];

export const containsDevanagari = (text) => {
  if (!text || typeof text !== 'string') return false;
  return DEVANAGARI_UNICODE_RANGES.some(regex => regex.test(text));
};

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

export const hasDevanagariContent = (element) => {
  if (!element) return false;
  const allText = extractAllText(element);
  return containsDevanagari(allText);
};

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
  result.available = result.regularAvailable;

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

export const getAvailableFonts = (pdfMake) => {
  if (!pdfMake || !pdfMake.fonts) {
    return [];
  }
  return Object.keys(pdfMake.fonts);
};

export const getAvailableVfsFiles = (pdfMake, limit = 50) => {
  if (!pdfMake || !pdfMake.vfs) {
    return [];
  }
  return Object.keys(pdfMake.vfs).slice(0, limit);
};

