// //     const sentences = (extractedText.match(/[.!?]+\s+[A-Z]/g) || []).length;
    
    
    
// //     const readableChars = (extractedText.match(/[a-zA-Z0-9\s.,;:!?()\-'"]/g) || []).length;
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
// //       if (!meetsMinimumThresholds) {
    

    
// //     if (!fullText) {
    

  
    
// //     if (!detection.isDigitalNative) {
    
  

// //   if (typeof text !== 'string') {





    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
//     const sentences = (extractedText.match(/[.!?]+\s+[A-Z]/g) || []).length;
    
    
    
//     const readableChars = (extractedText.match(/[a-zA-Z0-9\s.,;:!?()\-'"]/g) || []).length;
    
    
    
    
    
    
    
    
    
//     console.log(`   - No OCR artifacts: ${!hasOCRArtifacts ? '✅' : '❌'}`);
    
//     const isDigitalNative = confidence >= 70 && !hasOCRArtifacts && meetsQualityThresholds;
    
    
//       if (!meetsQualityThresholds) {
    

    
//     if (!fullText) {
    

  
    
//     if (!detection.isDigitalNative) {
    
  

//   if (typeof text !== 'string') {



const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

async function detectDigitalNativePDF(fileBuffer) {
  try {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[PDF DETECTION] Starting analysis...`);
    console.log(`${'='.repeat(80)}\n`);

    const pdfData = await pdfParse(fileBuffer);
    const extractedText = pdfData.text || '';
    const pageCount = pdfData.numpages || 1;
    
    console.log(`[PDF DETECTION] Basic metrics:`);
    console.log(`   - Pages: ${pageCount}`);
    console.log(`   - Total text length: ${extractedText.length} chars`);
    
    if (pageCount === 0) {
      return createResult(false, '', 0, 0, ['No pages detected - use Document AI']);
    }
    
    const trimmedText = extractedText.trim();
    const nonWhitespaceChars = extractedText.replace(/\s/g, '').length;
    const totalChars = extractedText.length;
    const words = trimmedText.split(/\s+/).filter(w => w.length > 1);
    const wordCount = words.length;
    
    const charsPerPage = totalChars / pageCount;
    const wordsPerPage = wordCount / pageCount;
    const avgWordLength = wordCount > 0 ? nonWhitespaceChars / wordCount : 0;
    
    console.log(`   - Chars/page: ${charsPerPage.toFixed(1)}`);
    console.log(`   - Words/page: ${wordsPerPage.toFixed(1)}`);
    console.log(`   - Avg word length: ${avgWordLength.toFixed(2)}`);
    
    let score = 0;
    const reasons = [];
    
    console.log(`\n[PDF DETECTION] 🔍 OCR Artifact Detection:`);
    
    const mergedWordPatterns = [
      /[a-z]{5,}of[a-z]{5,}/gi,         // "copyofletter", "workorderof"
      /[a-z]{5,}dated[a-z]{4,}/gi,      // "letterdated", "agreementdated"
      /[a-z]{5,}between[a-z]{4,}/gi,    // "agreementbetween"
      /[a-z]{5,}and[a-z]{4,}/gi,        // "governmentand" (but allow short like "andandroid")
      /copy\s*of\s*[a-z]+\s*dated/gi,   // Spaces collapsed: "copyofworkorderdated"
    ];
    
    let mergedWordCount = 0;
    for (const pattern of mergedWordPatterns) {
      const matches = extractedText.match(pattern) || [];
      const filtered = matches.filter(m => 
        !m.match(/^(thereof|whereof|hereof|instead|understand|wonderful)$/i)
      );
      mergedWordCount += filtered.length;
    }
    
    console.log(`   - Merged words: ${mergedWordCount}`);
    
    if (mergedWordCount > pageCount * 2.0) {
      score -= 70;
      reasons.push(`✗ CRITICAL: Excessive merged words (${mergedWordCount}) - scanned PDF`);
    } else if (mergedWordCount > pageCount * 0.5) {
      score -= 45;
      reasons.push(`✗ WARNING: Merged words detected (${mergedWordCount}) - likely OCR`);
    } else if (mergedWordCount === 0) {
      score += 30;
      reasons.push(`✓ No merged words`);
    } else {
      score += 15;
      reasons.push(`✓ Very few merged words (${mergedWordCount})`);
    }
    
    const brokenDatePatterns = [
      /\d[IlOo]\d/g,                    // "0I0", "1l9", "2O3"
      /[IlOo]\d[IlOo]/g,                // "I9O", "l2l"
      /\d{1,2}[\/\-][IlOo]\d/g,         // "01/I9", "12-O2"
      /\d+[,\.]{2,}\d+/g,               // "1998...", "2002,,"
    ];
    
    let brokenDateCount = 0;
    for (const pattern of brokenDatePatterns) {
      brokenDateCount += (extractedText.match(pattern) || []).length;
    }
    
    console.log(`   - Broken dates/numbers: ${brokenDateCount}`);
    
    if (brokenDateCount > pageCount * 0.5) {
      score -= 60;
      reasons.push(`✗ CRITICAL: Broken dates (${brokenDateCount}) - OCR corruption`);
    } else if (brokenDateCount > 0) {
      score -= 35;
      reasons.push(`✗ WARNING: Some broken dates (${brokenDateCount})`);
    } else {
      score += 25;
      reasons.push(`✓ No broken dates`);
    }
    
    const randomSymbolPatterns = [
      /[•\*]+[:\.]+[•\*]+/g,            // "*.:•.", "•.*.:"
      /[:\.]{4,}/g,                     // "....:", ".:.:.:"
      /[−\-]{2,}['\.]+/g,               // "--.'", "−.−."
      /[^\w\s]{5,}/g,                   // 5+ consecutive special chars
    ];
    
    let randomSymbolCount = 0;
    for (const pattern of randomSymbolPatterns) {
      randomSymbolCount += (extractedText.match(pattern) || []).length;
    }
    
    const symbolsPerPage = randomSymbolCount / pageCount;
    
    console.log(`   - Random symbols: ${randomSymbolCount} (${symbolsPerPage.toFixed(1)}/page)`);
    
    if (symbolsPerPage > 15) {
      score -= 55;
      reasons.push(`✗ CRITICAL: Excessive random symbols (${randomSymbolCount}) - OCR noise`);
    } else if (symbolsPerPage > 5) {
      score -= 30;
      reasons.push(`✗ WARNING: Random symbols detected (${randomSymbolCount})`);
    } else if (symbolsPerPage <= 1) {
      score += 20;
      reasons.push(`✓ Minimal random symbols`);
    } else {
      score += 5;
      reasons.push(`⚠ Some random symbols (${randomSymbolCount})`);
    }
    
    const text5kSample = extractedText.substring(0, Math.min(5000, extractedText.length));
    
    const suspiciousO = (text5kSample.match(/\d+[O]\d+/g) || []).length;
    const suspiciousI = (text5kSample.match(/\d[I]\d/g) || []).length;
    const suspiciousl = (text5kSample.match(/\d[l]\d/g) || []).length;
    
    const charSubstitutions = suspiciousO + suspiciousI + suspiciousl;
    
    console.log(`   - Character substitutions (in numbers): ${charSubstitutions}`);
    
    if (charSubstitutions > 8) {
      score -= 40;
      reasons.push(`✗ Many character substitutions (${charSubstitutions})`);
    } else if (charSubstitutions > 3) {
      score -= 25;
      reasons.push(`✗ Some character substitutions (${charSubstitutions})`);
    } else if (charSubstitutions === 0) {
      score += 20;
      reasons.push(`✓ No character substitutions`);
    } else {
      score += 5;
      reasons.push(`⚠ Minimal character substitutions (${charSubstitutions})`);
    }
    
    const properWords = words.filter(w => /^[a-zA-Z]{3,}$/.test(w));
    const properWordRatio = wordCount > 0 ? properWords.length / wordCount : 0;
    
    console.log(`   - Proper words: ${properWords.length}/${wordCount} (${(properWordRatio * 100).toFixed(1)}%)`);
    
    if (properWordRatio < 0.35) {
      score -= 50;
      reasons.push(`✗ Very low proper word ratio (${(properWordRatio * 100).toFixed(1)}%)`);
    } else if (properWordRatio < 0.55) {
      score -= 30;
      reasons.push(`✗ Low proper word ratio (${(properWordRatio * 100).toFixed(1)}%)`);
    } else if (properWordRatio >= 0.65) {
      score += 25;
      reasons.push(`✓ Good proper word ratio (${(properWordRatio * 100).toFixed(1)}%)`);
    } else {
      score += 10;
      reasons.push(`⚠ Acceptable proper word ratio (${(properWordRatio * 100).toFixed(1)}%)`);
    }
    
    console.log(`\n[PDF DETECTION] Basic Quality Checks:`);
    
    const MIN_CHARS_PER_PAGE = 200;
    const MIN_WORDS_PER_PAGE = 30;
    
    if (charsPerPage >= 800) {
      score += 20;
      reasons.push(`✓ Excellent text density (${charsPerPage.toFixed(0)} chars/page)`);
    } else if (charsPerPage >= MIN_CHARS_PER_PAGE) {
      score += 10;
      reasons.push(`✓ Adequate text density (${charsPerPage.toFixed(0)} chars/page)`);
    } else {
      score -= 35;
      reasons.push(`✗ Low text density (${charsPerPage.toFixed(0)} chars/page)`);
    }
    
    if (wordsPerPage >= MIN_WORDS_PER_PAGE) {
      score += 15;
      reasons.push(`✓ Adequate word count (${wordsPerPage.toFixed(1)} words/page)`);
    } else {
      score -= 30;
      reasons.push(`✗ Low word count (${wordsPerPage.toFixed(1)} words/page)`);
    }
    
    const sentences = (extractedText.match(/[.!?]+\s+[A-Z]/g) || []).length;
    const sentencesPerPage = sentences / pageCount;
    
    if (sentencesPerPage >= 3) {
      score += 15;
      reasons.push(`✓ Good sentence structure`);
    } else if (sentencesPerPage < 1) {
      score -= 20;
      reasons.push(`✗ Poor sentence structure`);
    }
    
    const readableChars = (extractedText.match(/[a-zA-Z0-9\s.,;:!?()\-'"]/g) || []).length;
    const readableRatio = totalChars > 0 ? readableChars / totalChars : 0;
    
    if (readableRatio >= 0.88) {
      score += 15;
      reasons.push(`✓ High readable ratio (${(readableRatio * 100).toFixed(1)}%)`);
    } else if (readableRatio < 0.75) {
      score -= 25;
      reasons.push(`✗ Low readable ratio (${(readableRatio * 100).toFixed(1)}%)`);
    }
    
    if (nonWhitespaceChars < 100) {
      score = -100;
      reasons.push(`✗ CRITICAL: Almost no text extracted`);
    }
    
    const rawScore = score;
    const confidence = Math.max(0, Math.min(100, score));
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[PDF DETECTION] SCORING:`);
    console.log(`   - Raw score: ${rawScore}`);
    console.log(`   - Confidence: ${confidence}%`);
    console.log(`${'='.repeat(80)}`);
    
    const hasOCRArtifacts = 
      mergedWordCount > pageCount * 0.5 ||  // Raised threshold
      brokenDateCount > pageCount * 0.1 ||   // Allow some minor issues
      symbolsPerPage > 8 ||                  // Raised threshold
      charSubstitutions > 3;                 // Raised threshold
    
    const meetsQualityThresholds = 
      charsPerPage >= MIN_CHARS_PER_PAGE &&
      wordsPerPage >= MIN_WORDS_PER_PAGE &&
      nonWhitespaceChars >= 100 &&
      properWordRatio >= 0.50 &&            // Lowered slightly
      readableRatio >= 0.70;                // Lowered slightly
    
    console.log(`\n[PDF DETECTION] Decision Criteria:`);
    console.log(`   - Confidence >= 70%: ${confidence >= 70 ? '✅' : '❌'} (${confidence}%)`);
    console.log(`   - No OCR artifacts: ${!hasOCRArtifacts ? '✅' : '❌'}`);
    console.log(`   - Quality thresholds: ${meetsQualityThresholds ? '✅' : '❌'}`);
    
    const isDigitalNative = confidence >= 70 && !hasOCRArtifacts && meetsQualityThresholds;
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[PDF DETECTION] 🎯 DECISION: ${isDigitalNative ? '✅ DIGITAL-NATIVE (pdf-parse)' : '❌ SCANNED (Document AI)'}`);
    console.log(`${'='.repeat(80)}\n`);
    
    if (isDigitalNative) {
      reasons.push(`\n✅ DECISION: Digital-native PDF - use pdf-parse`);
      reasons.push(`   • Clean text extraction`);
      reasons.push(`   • No OCR artifacts`);
      reasons.push(`   • Confidence: ${confidence}%`);
    } else {
      reasons.push(`\n❌ DECISION: Scanned PDF - use Document AI OCR`);
      if (hasOCRArtifacts) {
        reasons.push(`   • OCR artifacts detected`);
      }
      if (confidence < 70) {
        reasons.push(`   • Low confidence: ${confidence}%`);
      }
      if (!meetsQualityThresholds) {
        reasons.push(`   • Quality thresholds not met`);
      }
    }
    
    return createResult(
      isDigitalNative,
      extractedText,
      pageCount,
      confidence,
      reasons,
      {
        charsPerPage,
        wordsPerPage,
        avgWordLength,
        totalWords: wordCount,
        totalChars,
        readableRatio: readableRatio * 100,
        sentencesPerPage,
        properWordRatio: properWordRatio * 100,
        mergedWordCount,
        brokenDateCount,
        randomSymbolCount,
        symbolsPerPage,
        charSubstitutions,
        hasOCRArtifacts,
        rawScore
      }
    );
    
  } catch (error) {
    console.error("[PDF DETECTION] ❌ Error:", error.message);
    return createResult(false, '', 0, 0, [`✗ Error: ${error.message}`, '❌ Use Document AI']);
  }
}

function createResult(isDigitalNative, text, pageCount, confidence, reasons, metrics = {}) {
  return {
    isDigitalNative,
    text,
    pageCount,
    confidence: Math.round(confidence),
    reasons,
    metrics
  };
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
      let pageEndIndex;
      
      if (currentPage === pageCount) {
        pageEndIndex = normalizedText.length;
      } else {
        pageEndIndex = Math.min(currentIndex + avgCharsPerPage, normalizedText.length);
        
        const nextDoubleNewline = normalizedText.indexOf('\n\n', pageEndIndex - avgCharsPerPage * 0.3);
        if (nextDoubleNewline > currentIndex && nextDoubleNewline < currentIndex + avgCharsPerPage * 1.2) {
          pageEndIndex = nextDoubleNewline + 2;
        }
      }
      
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
    
    if (pageTexts.length === 0) {
      console.warn(`[PDF Extraction] ⚠️ Page splitting failed, returning full text as single block`);
      return [{
        text: normalizedText,
        page_start: 1,
        page_end: pageCount
      }];
    }
    
    console.log(`[PDF Extraction] ✅ Extracted ${pageTexts.length} pages from PDF (total pages: ${pageCount})`);
    return pageTexts;
    
  } catch (error) {
    console.error("PDF extraction failed:", error.message);
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
  if (typeof text !== 'string') {
    return '';
  }
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