// // const pdfParse = require('pdf-parse');
// // const mammoth = require('mammoth');

// // /**
// //  * Detects if a PDF is digital-native (has easily extractable text) or needs OCR
// //  * Digital-native = text-based PDF created from Word, LaTeX, etc.
// //  * Scanned = image-based PDF that needs Document AI for OCR
// //  * @param {Buffer} fileBuffer - PDF file buffer
// //  * @returns {Promise<{isDigitalNative: boolean, text: string, pageCount: number, confidence: number, reasons: string[], metrics: object}>}
// //  */
// // async function detectDigitalNativePDF(fileBuffer) {
// //   try {
// //     console.log(`\n${'='.repeat(80)}`);
// //     console.log(`[PDF DETECTION] Starting analysis...`);
// //     console.log(`${'='.repeat(80)}\n`);

// //     const pdfData = await pdfParse(fileBuffer);
// //     const extractedText = pdfData.text || '';
// //     const pageCount = pdfData.numpages || 1;
    
// //     console.log(`[PDF DETECTION] Initial extraction:`);
// //     console.log(`   - Pages: ${pageCount}`);
// //     console.log(`   - Raw text length: ${extractedText.length} chars`);
    
// //     if (pageCount === 0) {
// //       console.log(`[PDF DETECTION] ❌ No pages detected`);
// //       return {
// //         isDigitalNative: false,
// //         text: '',
// //         pageCount: 0,
// //         confidence: 0,
// //         reasons: ['No pages detected - use Document AI'],
// //         metrics: {}
// //       };
// //     }
    
// //     // Count text metrics
// //     const trimmedText = extractedText.trim();
// //     const nonWhitespaceChars = extractedText.replace(/\s/g, '').length;
// //     const totalChars = extractedText.length;
// //     const words = trimmedText.split(/\s+/).filter(w => w.length > 1);
// //     const wordCount = words.length;
    
// //     console.log(`[PDF DETECTION] Text metrics:`);
// //     console.log(`   - Total chars: ${totalChars}`);
// //     console.log(`   - Non-whitespace chars: ${nonWhitespaceChars}`);
// //     console.log(`   - Word count: ${wordCount}`);
    
// //     // Calculate per-page metrics
// //     const charsPerPage = totalChars / pageCount;
// //     const wordsPerPage = wordCount / pageCount;
// //     const nonWhitespaceCharsPerPage = nonWhitespaceChars / pageCount;
    
// //     console.log(`[PDF DETECTION] Per-page metrics:`);
// //     console.log(`   - Chars/page: ${charsPerPage.toFixed(1)}`);
// //     console.log(`   - Words/page: ${wordsPerPage.toFixed(1)}`);
// //     console.log(`   - Non-whitespace chars/page: ${nonWhitespaceCharsPerPage.toFixed(1)}`);
    
// //     // Initialize scoring
// //     let score = 0;
// //     const reasons = [];
    
// //     // === CRITICAL THRESHOLDS FOR DIGITAL-NATIVE PDFs ===
    
// //     // 1. Minimum text density check (MOST IMPORTANT)
// //     // Digital-native PDFs typically have 500+ chars/page
// //     // Scanned PDFs with poor OCR have < 300 chars/page
// //     const MIN_CHARS_PER_PAGE = 300;
// //     const IDEAL_CHARS_PER_PAGE = 500;
    
// //     console.log(`\n[PDF DETECTION] Threshold checks:`);
// //     console.log(`   - Minimum chars/page required: ${MIN_CHARS_PER_PAGE}`);
// //     console.log(`   - Ideal chars/page: ${IDEAL_CHARS_PER_PAGE}`);
// //     console.log(`   - Actual chars/page: ${charsPerPage.toFixed(1)}`);
    
// //     if (charsPerPage >= IDEAL_CHARS_PER_PAGE) {
// //       score += 40;
// //       reasons.push(`✓ Excellent text density: ${charsPerPage.toFixed(0)} chars/page`);
// //       console.log(`   ✅ PASS: Excellent text density`);
// //     } else if (charsPerPage >= MIN_CHARS_PER_PAGE) {
// //       score += 20;
// //       reasons.push(`✓ Acceptable text density: ${charsPerPage.toFixed(0)} chars/page`);
// //       console.log(`   ✅ PASS: Acceptable text density`);
// //     } else {
// //       score -= 50;
// //       reasons.push(`✗ Very low text density: ${charsPerPage.toFixed(0)} chars/page (need ${MIN_CHARS_PER_PAGE}+)`);
// //       console.log(`   ❌ FAIL: Very low text density`);
// //     }
    
// //     // 2. Word count check
// //     // Digital-native should have at least 50 words per page
// //     const MIN_WORDS_PER_PAGE = 50;
    
// //     console.log(`   - Minimum words/page required: ${MIN_WORDS_PER_PAGE}`);
// //     console.log(`   - Actual words/page: ${wordsPerPage.toFixed(1)}`);
    
// //     if (wordsPerPage >= MIN_WORDS_PER_PAGE * 1.5) {
// //       score += 30;
// //       reasons.push(`✓ Good word count: ${wordsPerPage.toFixed(1)} words/page`);
// //       console.log(`   ✅ PASS: Good word count`);
// //     } else if (wordsPerPage >= MIN_WORDS_PER_PAGE) {
// //       score += 15;
// //       reasons.push(`✓ Acceptable word count: ${wordsPerPage.toFixed(1)} words/page`);
// //       console.log(`   ✅ PASS: Acceptable word count`);
// //     } else {
// //       score -= 40;
// //       reasons.push(`✗ Very low word count: ${wordsPerPage.toFixed(1)} words/page (need ${MIN_WORDS_PER_PAGE}+)`);
// //       console.log(`   ❌ FAIL: Very low word count`);
// //     }
    
// //     // 3. Check for meaningful sentences and punctuation
// //     const sentences = (extractedText.match(/[.!?]+\s+[A-Z]/g) || []).length;
// //     const sentencesPerPage = sentences / pageCount;
// //     const commas = (extractedText.match(/,/g) || []).length;
// //     const periods = (extractedText.match(/\./g) || []).length;
    
// //     console.log(`   - Sentences/page: ${sentencesPerPage.toFixed(1)}`);
// //     console.log(`   - Total commas: ${commas}`);
// //     console.log(`   - Total periods: ${periods}`);
    
// //     if (sentencesPerPage >= 5 && commas >= 10 && periods >= 10) {
// //       score += 25;
// //       reasons.push(`✓ Contains proper sentence structure`);
// //       console.log(`   ✅ PASS: Proper sentence structure`);
// //     } else if (sentencesPerPage >= 2 && (commas >= 3 || periods >= 3)) {
// //       score += 10;
// //       reasons.push(`⚠ Limited sentence structure detected`);
// //       console.log(`   ⚠️ PARTIAL: Limited sentence structure`);
// //     } else {
// //       score -= 30;
// //       reasons.push(`✗ No clear sentence structure - likely scanned`);
// //       console.log(`   ❌ FAIL: No clear sentence structure`);
// //     }
    
// //     // 4. Check for readable English/Latin characters
// //     const readableChars = (extractedText.match(/[a-zA-Z0-9\s.,;:!?()\-'"]/g) || []).length;
// //     const readableRatio = totalChars > 0 ? readableChars / totalChars : 0;
    
// //     console.log(`   - Readable ratio: ${(readableRatio * 100).toFixed(1)}%`);
    
// //     if (readableRatio >= 0.85) {
// //       score += 20;
// //       reasons.push(`✓ High readable character ratio: ${(readableRatio * 100).toFixed(1)}%`);
// //       console.log(`   ✅ PASS: High readable ratio`);
// //     } else if (readableRatio >= 0.70) {
// //       score += 5;
// //       reasons.push(`⚠ Moderate readable character ratio: ${(readableRatio * 100).toFixed(1)}%`);
// //       console.log(`   ⚠️ PARTIAL: Moderate readable ratio`);
// //     } else {
// //       score -= 35;
// //       reasons.push(`✗ Low readable character ratio: ${(readableRatio * 100).toFixed(1)}% - likely OCR noise`);
// //       console.log(`   ❌ FAIL: Low readable ratio`);
// //     }
    
// //     // 5. Detect OCR artifacts
// //     const ocrIndicators = [];
    
// //     // 5a. Excessive special characters
// //     const specialChars = (extractedText.match(/[^\x20-\x7E\s]/g) || []).length;
// //     const specialCharRatio = totalChars > 0 ? specialChars / totalChars : 0;
// //     console.log(`   - Special char ratio: ${(specialCharRatio * 100).toFixed(1)}%`);
// //     if (specialCharRatio > 0.10) {
// //       score -= 30;
// //       ocrIndicators.push('excessive special characters');
// //     }
    
// //     // 5b. Long sequences of numbers (OCR error pattern)
// //     const longNumberSequences = (extractedText.match(/\d{15,}/g) || []).length;
// //     console.log(`   - Long number sequences: ${longNumberSequences}`);
// //     if (longNumberSequences > 2) {
// //       score -= 25;
// //       ocrIndicators.push('suspicious number sequences');
// //     }
    
// //     // 5c. Random capitalization (OCR mistake)
// //     const randomCaps = (extractedText.match(/[a-z][A-Z][a-z]/g) || []).length;
// //     const randomCapRatio = wordCount > 0 ? randomCaps / wordCount : 0;
// //     console.log(`   - Random capitalization ratio: ${(randomCapRatio * 100).toFixed(1)}%`);
// //     if (randomCaps > wordCount * 0.05) {
// //       score -= 20;
// //       ocrIndicators.push('random capitalization');
// //     }
    
// //     // 5d. Missing word spacing
// //     const spaceRatio = totalChars > 0 ? (totalChars - nonWhitespaceChars) / totalChars : 0;
// //     console.log(`   - Space ratio: ${(spaceRatio * 100).toFixed(1)}%`);
// //     if (spaceRatio < 0.10 && totalChars > 100) {
// //       score -= 25;
// //       ocrIndicators.push('missing word spacing');
// //     }
    
// //     // 5e. Check for common OCR garbage patterns
// //     const garbagePatterns = [
// //       { pattern: /[Il1]{4,}/g, name: 'I/l/1 sequences' },
// //       { pattern: /[oO0]{4,}/g, name: 'o/O/0 sequences' },
// //       { pattern: /\w{50,}/g, name: 'very long words' },
// //       { pattern: /[^\w\s]{5,}/g, name: 'special char sequences' }
// //     ];
    
// //     let garbageCount = 0;
// //     for (const { pattern, name } of garbagePatterns) {
// //       const matches = (extractedText.match(pattern) || []).length;
// //       if (matches > 2) {
// //         garbageCount++;
// //         console.log(`   - Garbage pattern '${name}': ${matches} matches`);
// //       }
// //     }
    
// //     if (garbageCount >= 2) {
// //       score -= 30;
// //       ocrIndicators.push('garbage character patterns');
// //     }
    
// //     if (ocrIndicators.length > 0) {
// //       reasons.push(`✗ OCR artifacts detected: ${ocrIndicators.join(', ')}`);
// //       console.log(`   ❌ OCR artifacts: ${ocrIndicators.join(', ')}`);
// //     }
    
// //     // 6. Check for completely empty or near-empty extraction
// //     if (nonWhitespaceChars < 100) {
// //       score = -100; // Force to negative
// //       reasons.push(`✗ Almost no text extracted - definitely needs Document AI`);
// //       console.log(`   ❌ CRITICAL: Almost no text extracted`);
// //     }
    
// //     // 7. Check average word length
// //     const avgWordLength = wordCount > 0 ? nonWhitespaceChars / wordCount : 0;
// //     console.log(`   - Average word length: ${avgWordLength.toFixed(1)} chars`);
    
// //     if (avgWordLength < 3) {
// //       score -= 35;
// //       reasons.push(`✗ Average word length too short (${avgWordLength.toFixed(1)} chars) - likely OCR fragments`);
// //       console.log(`   ❌ FAIL: Word length too short`);
// //     } else if (avgWordLength >= 4 && avgWordLength <= 8) {
// //       score += 15;
// //       reasons.push(`✓ Normal average word length (${avgWordLength.toFixed(1)} chars)`);
// //       console.log(`   ✅ PASS: Normal word length`);
// //     }
    
// //     // 8. Check for continuous text blocks
// //     const textBlocks = extractedText.split(/\n{2,}/).filter(block => block.trim().length > 50);
// //     const blocksPerPage = textBlocks.length / pageCount;
// //     console.log(`   - Text blocks/page: ${blocksPerPage.toFixed(1)}`);
    
// //     if (blocksPerPage >= 2) {
// //       score += 10;
// //       reasons.push(`✓ Good text block structure (${blocksPerPage.toFixed(1)} blocks/page)`);
// //       console.log(`   ✅ PASS: Good text block structure`);
// //     } else if (blocksPerPage < 1) {
// //       score -= 20;
// //       reasons.push(`✗ Poor text block structure - likely scanned`);
// //       console.log(`   ❌ FAIL: Poor text block structure`);
// //     }
    
// //     // === FINAL DECISION ===
// //     // Normalize score to 0-100
// //     const rawScore = score;
// //     const confidence = Math.max(0, Math.min(100, score));
    
// //     console.log(`\n[PDF DETECTION] Scoring summary:`);
// //     console.log(`   - Raw score: ${rawScore}`);
// //     console.log(`   - Normalized confidence: ${confidence}%`);
    
// //     // DECISION THRESHOLD: 70% confidence
// //     // AND meets minimum thresholds
// //     const meetsMinimumThresholds = 
// //       charsPerPage >= MIN_CHARS_PER_PAGE &&
// //       wordsPerPage >= MIN_WORDS_PER_PAGE &&
// //       nonWhitespaceChars >= 100 &&
// //       readableRatio >= 0.70 &&
// //       avgWordLength >= 3.5;
    
// //     console.log(`[PDF DETECTION] Threshold checks:`);
// //     console.log(`   - Chars/page >= ${MIN_CHARS_PER_PAGE}: ${charsPerPage >= MIN_CHARS_PER_PAGE ? '✅' : '❌'}`);
// //     console.log(`   - Words/page >= ${MIN_WORDS_PER_PAGE}: ${wordsPerPage >= MIN_WORDS_PER_PAGE ? '✅' : '❌'}`);
// //     console.log(`   - Non-whitespace chars >= 100: ${nonWhitespaceChars >= 100 ? '✅' : '❌'}`);
// //     console.log(`   - Readable ratio >= 70%: ${readableRatio >= 0.70 ? '✅' : '❌'}`);
// //     console.log(`   - Avg word length >= 3.5: ${avgWordLength >= 3.5 ? '✅' : '❌'}`);
// //     console.log(`   - All thresholds met: ${meetsMinimumThresholds ? '✅' : '❌'}`);
    
// //     const isDigitalNative = confidence >= 70 && meetsMinimumThresholds;
    
// //     console.log(`\n${'='.repeat(80)}`);
// //     console.log(`[PDF DETECTION] FINAL DECISION: ${isDigitalNative ? '✅ DIGITAL-NATIVE' : '❌ NEEDS OCR'}`);
// //     console.log(`   - Confidence: ${confidence}% (threshold: 70%)`);
// //     console.log(`   - Meets thresholds: ${meetsMinimumThresholds ? 'YES' : 'NO'}`);
// //     console.log(`${'='.repeat(80)}\n`);
    
// //     // Add final recommendation
// //     if (isDigitalNative) {
// //       reasons.push(`\n✅ DECISION: Digital-native PDF - text extraction successful`);
// //       reasons.push(`   Confidence: ${confidence}% (threshold: 70%)`);
// //     } else {
// //       reasons.push(`\n❌ DECISION: Use Document AI for OCR processing`);
// //       if (confidence >= 40 && confidence < 70) {
// //         reasons.push(`   Reason: Borderline confidence (${confidence}%) - safer to use OCR`);
// //       } else {
// //         reasons.push(`   Reason: Low confidence (${confidence}%) - clear OCR indicators`);
// //       }
// //       if (!meetsMinimumThresholds) {
// //         reasons.push(`   Reason: Does not meet minimum text quality thresholds`);
// //       }
// //     }
    
// //     return {
// //       isDigitalNative,
// //       text: extractedText,
// //       pageCount,
// //       confidence: Math.round(confidence),
// //       reasons,
// //       metrics: {
// //         charsPerPage: parseFloat(charsPerPage.toFixed(1)),
// //         wordsPerPage: parseFloat(wordsPerPage.toFixed(1)),
// //         nonWhitespaceCharsPerPage: parseFloat(nonWhitespaceCharsPerPage.toFixed(1)),
// //         totalWords: wordCount,
// //         totalChars: totalChars,
// //         readableRatio: parseFloat((readableRatio * 100).toFixed(1)),
// //         sentencesPerPage: parseFloat(sentencesPerPage.toFixed(1)),
// //         avgWordLength: parseFloat(avgWordLength.toFixed(1)),
// //         textBlocksPerPage: parseFloat(blocksPerPage.toFixed(1)),
// //         hasOCRArtifacts: ocrIndicators.length > 0,
// //         ocrIndicatorCount: ocrIndicators.length,
// //         rawScore: rawScore
// //       }
// //     };
// //   } catch (error) {
// //     console.error("[PDF DETECTION] ❌ PDF parsing failed:", error.message);
// //     console.error(error.stack);
// //     // If parsing fails, definitely needs Document AI
// //     return {
// //       isDigitalNative: false,
// //       text: '',
// //       pageCount: 0,
// //       confidence: 0,
// //       reasons: [`✗ PDF parsing error: ${error.message}`, '❌ DECISION: Use Document AI'],
// //       metrics: {}
// //     };
// //   }
// // }

// // /**
// //  * Extracts text from PDF with page-by-page information
// //  * @param {Buffer} fileBuffer - PDF file buffer
// //  * @returns {Promise<Array<{text: string, page_start: number, page_end: number}>>}
// //  */
// // async function extractTextFromPDFWithPages(fileBuffer) {
// //   try {
// //     const pdfData = await pdfParse(fileBuffer);
// //     const pageCount = pdfData.numpages || 1;
// //     const fullText = pdfData.text || '';
    
// //     if (!fullText) {
// //       return [{
// //         text: '',
// //         page_start: 1,
// //         page_end: pageCount
// //       }];
// //     }
    
// //     // Return normalized full text with page range
// //     return [{
// //       text: normalizeText(fullText),
// //       page_start: 1,
// //       page_end: pageCount
// //     }];
// //   } catch (error) {
// //     console.error("PDF extraction failed:", error.message);
// //     throw new Error(`PDF extraction failed: ${error.message}`);
// //   }
// // }

// // /**
// //  * Extracts text from file buffer (for digital-native documents only)
// //  * @param {Buffer} fileBuffer - File buffer
// //  * @param {string} mimetype - MIME type
// //  * @returns {Promise<string>} Extracted text
// //  */
// // async function extractText(fileBuffer, mimetype) {
// //   let extracted = '';
  
// //   if (mimetype === 'application/pdf') {
// //     // First check if it's digital-native
// //     const detection = await detectDigitalNativePDF(fileBuffer);
    
// //     if (!detection.isDigitalNative) {
// //       throw new Error('PDF is not digital-native. Use Document AI for OCR processing.');
// //     }
    
// //     extracted = detection.text;
// //   } else if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
// //     const result = await mammoth.extractRawText({ buffer: fileBuffer });
// //     extracted = result.value;
// //   } else {
// //     throw new Error('Unsupported file type for text extraction');
// //   }
  
// //   return normalizeText(extracted);
// // }

// // /**
// //  * Normalizes text by removing excessive whitespace, trimming, and standardizing newlines.
// //  * @param {string} text The input text to normalize.
// //  * @returns {string} The normalized text.
// //  */
// // function normalizeText(text) {
// //   if (typeof text !== 'string') {
// //     return '';
// //   }
// //   // Replace multiple spaces/tabs with a single space
// //   let cleanedText = text.replace(/[ \t]+/g, ' ');
// //   // Replace multiple newlines with at most two newlines (for paragraph separation)
// //   cleanedText = cleanedText.replace(/\n\s*\n/g, '\n\n');
// //   // Trim leading/trailing whitespace from each line and the whole text
// //   cleanedText = cleanedText.split('\n').map(line => line.trim()).join('\n');
// //   return cleanedText.trim();
// // }

// // module.exports = { 
// //   extractText, 
// //   normalizeText,
// //   detectDigitalNativePDF,
// //   extractTextFromPDFWithPages
// // };


// const pdfParse = require('pdf-parse');
// const mammoth = require('mammoth');

// /**
//  * Detects if a PDF is digital-native (has easily extractable text) or needs OCR
//  * CRITICAL: This must correctly identify scanned/OCR PDFs even if they have text
//  * @param {Buffer} fileBuffer - PDF file buffer
//  * @returns {Promise<{isDigitalNative: boolean, text: string, pageCount: number, confidence: number, reasons: string[], metrics: object}>}
//  */
// async function detectDigitalNativePDF(fileBuffer) {
//   try {
//     console.log(`\n${'='.repeat(80)}`);
//     console.log(`[PDF DETECTION] Starting deep analysis...`);
//     console.log(`${'='.repeat(80)}\n`);

//     const pdfData = await pdfParse(fileBuffer);
//     const extractedText = pdfData.text || '';
//     const pageCount = pdfData.numpages || 1;
    
//     console.log(`[PDF DETECTION] Initial extraction:`);
//     console.log(`   - Pages: ${pageCount}`);
//     console.log(`   - Raw text length: ${extractedText.length} chars`);
    
//     if (pageCount === 0) {
//       console.log(`[PDF DETECTION] ❌ No pages detected`);
//       return {
//         isDigitalNative: false,
//         text: '',
//         pageCount: 0,
//         confidence: 0,
//         reasons: ['No pages detected - use Document AI'],
//         metrics: {}
//       };
//     }
    
//     // Count text metrics
//     const trimmedText = extractedText.trim();
//     const nonWhitespaceChars = extractedText.replace(/\s/g, '').length;
//     const totalChars = extractedText.length;
//     const words = trimmedText.split(/\s+/).filter(w => w.length > 1);
//     const wordCount = words.length;
    
//     console.log(`[PDF DETECTION] Text metrics:`);
//     console.log(`   - Total chars: ${totalChars}`);
//     console.log(`   - Non-whitespace chars: ${nonWhitespaceChars}`);
//     console.log(`   - Word count: ${wordCount}`);
    
//     // Calculate per-page metrics
//     const charsPerPage = totalChars / pageCount;
//     const wordsPerPage = wordCount / pageCount;
//     const nonWhitespaceCharsPerPage = nonWhitespaceChars / pageCount;
    
//     console.log(`[PDF DETECTION] Per-page metrics:`);
//     console.log(`   - Chars/page: ${charsPerPage.toFixed(1)}`);
//     console.log(`   - Words/page: ${wordsPerPage.toFixed(1)}`);
    
//     // Initialize scoring
//     let score = 0;
//     const reasons = [];
    
//     // === CRITICAL OCR ARTIFACT DETECTION ===
//     console.log(`\n[PDF DETECTION] 🔍 CRITICAL OCR ARTIFACT CHECKS:`);
    
//     // 1. CHECK FOR MERGED WORDS (Most reliable OCR indicator)
//     // Digital-native PDFs have proper spacing, OCR often merges words
//     const mergedWordPatterns = [
//       /[a-z]{3,}[A-Z][a-z]{3,}/g,  // "copyofAgreement"
//       /[a-z]{4,}of[a-z]{4,}/gi,     // "copyofletter"
//       /[a-z]{4,}dated[a-z]{3,}/gi,  // "letterdated"
//       /[a-z]{4,}between[a-z]{3,}/gi, // "agreementbetween"
//       /[a-z]{4,}and[a-z]{3,}/gi,    // "governmentand"
//     ];
    
//     let mergedWordCount = 0;
//     for (const pattern of mergedWordPatterns) {
//       const matches = (extractedText.match(pattern) || []).length;
//       mergedWordCount += matches;
//     }
    
//     console.log(`   - Merged words found: ${mergedWordCount}`);
    
//     if (mergedWordCount > pageCount * 2) {  // More than 2 per page
//       score -= 60;
//       reasons.push(`✗ CRITICAL: Many merged words detected (${mergedWordCount}) - clear OCR artifact`);
//       console.log(`   ❌ FAIL: Excessive merged words (${mergedWordCount}, limit: ${pageCount * 2})`);
//     } else if (mergedWordCount > pageCount * 0.5) {
//       score -= 40;
//       reasons.push(`✗ WARNING: Merged words detected (${mergedWordCount}) - likely OCR`);
//       console.log(`   ⚠️ WARNING: Some merged words detected (${mergedWordCount})`);
//     } else if (mergedWordCount === 0) {
//       score += 25;
//       reasons.push(`✓ No merged words - good indicator of digital-native`);
//       console.log(`   ✅ PASS: No merged words`);
//     }
    
//     // 2. CHECK FOR BROKEN DATES/NUMBERS (Strong OCR indicator)
//     // OCR often misreads dates: "01/07/1998" becomes "0I071i9,98"
//     const brokenDatePatterns = [
//       /\d[IlOo]\d/g,               // "0I0", "1l9", "2O3"
//       /[IlOo]\d[IlOo]/g,           // "I9O", "l2l"
//       /\d{1,2}[\/\-][IlOo]\d/g,    // "01/I9", "12-O2"
//       /\d+[,\.]{2,}\d+/g,          // "1998...", "2002,,"
//       /\d+[:\.,][•\*:]+\d*/g,      // "1998.:•.", "2002:*:"
//     ];
    
//     let brokenDateCount = 0;
//     for (const pattern of brokenDatePatterns) {
//       const matches = (extractedText.match(pattern) || []).length;
//       brokenDateCount += matches;
//     }
    
//     console.log(`   - Broken dates/numbers: ${brokenDateCount}`);
    
//     if (brokenDateCount > pageCount * 1) {  // More than 1 per page
//       score -= 50;
//       reasons.push(`✗ CRITICAL: Broken dates/numbers detected (${brokenDateCount}) - OCR corruption`);
//       console.log(`   ❌ FAIL: Excessive broken dates (${brokenDateCount})`);
//     } else if (brokenDateCount > 0) {
//       score -= 30;
//       reasons.push(`✗ WARNING: Some broken dates/numbers (${brokenDateCount}) - OCR issues`);
//       console.log(`   ⚠️ WARNING: Some broken dates (${brokenDateCount})`);
//     } else {
//       score += 20;
//       reasons.push(`✓ No broken dates/numbers`);
//       console.log(`   ✅ PASS: No broken dates`);
//     }
    
//     // 3. CHECK FOR RANDOM SYMBOLS IN TEXT (Strong OCR indicator)
//     // OCR introduces random symbols: "*.:•.", ".:.•.::−", "−.'..•"
//     const randomSymbolPatterns = [
//       /[•\*]+[:\.]+[•\*]+/g,       // "*.:•.", "•.*.:"
//       /[:\.]{3,}/g,                // "...:", ".:.:."
//       /[−\-]{2,}['\.]+/g,          // "--.'", "−.−."
//       /[^\w\s]{4,}/g,              // Any 4+ consecutive special chars
//     ];
    
//     let randomSymbolCount = 0;
//     for (const pattern of randomSymbolPatterns) {
//       const matches = (extractedText.match(pattern) || []).length;
//       randomSymbolCount += matches;
//     }
    
//     console.log(`   - Random symbol patterns: ${randomSymbolCount}`);
    
//     if (randomSymbolCount > pageCount * 0.5) {
//       score -= 45;
//       reasons.push(`✗ CRITICAL: Random symbols detected (${randomSymbolCount}) - OCR noise`);
//       console.log(`   ❌ FAIL: Excessive random symbols (${randomSymbolCount})`);
//     } else if (randomSymbolCount > 0) {
//       score -= 25;
//       reasons.push(`✗ WARNING: Some random symbols (${randomSymbolCount})`);
//       console.log(`   ⚠️ WARNING: Some random symbols (${randomSymbolCount})`);
//     } else {
//       score += 15;
//       reasons.push(`✓ No random symbol patterns`);
//       console.log(`   ✅ PASS: No random symbols`);
//     }
    
//     // 4. CHECK FOR CHARACTER SUBSTITUTIONS (Medium OCR indicator)
//     // OCR confuses similar looking characters: O/0, I/l/1, etc.
//     const text500Sample = extractedText.substring(0, Math.min(5000, extractedText.length));
    
//     // Count suspicious patterns in first 5000 chars
//     const suspiciousO = (text500Sample.match(/[A-Z]O[A-Z]/g) || []).length; // "AOB" instead of "A0B"
//     const suspiciousI = (text500Sample.match(/[0-9]I[0-9]/g) || []).length; // "0I0" instead of "010"
//     const suspiciousl = (text500Sample.match(/[0-9]l[0-9]/g) || []).length; // "0l0" instead of "010"
    
//     const charSubstitutions = suspiciousO + suspiciousI + suspiciousl;
//     console.log(`   - Character substitutions (O/0, I/l/1): ${charSubstitutions}`);
    
//     if (charSubstitutions > 10) {
//       score -= 40;
//       reasons.push(`✗ Many character substitutions (${charSubstitutions}) - OCR confusion`);
//       console.log(`   ❌ FAIL: Many character substitutions (${charSubstitutions})`);
//     } else if (charSubstitutions > 3) {
//       score -= 20;
//       reasons.push(`✗ Some character substitutions (${charSubstitutions})`);
//       console.log(`   ⚠️ WARNING: Some character substitutions (${charSubstitutions})`);
//     }
    
//     // 5. CHECK WORD QUALITY (Average word length and proper words)
//     const avgWordLength = wordCount > 0 ? nonWhitespaceChars / wordCount : 0;
//     console.log(`\n[PDF DETECTION] Word quality checks:`);
//     console.log(`   - Average word length: ${avgWordLength.toFixed(2)} chars`);
    
//     // Count properly formed words (only letters, 3+ chars)
//     const properWords = words.filter(w => /^[a-zA-Z]{3,}$/.test(w));
//     const properWordRatio = wordCount > 0 ? properWords.length / wordCount : 0;
    
//     console.log(`   - Proper words: ${properWords.length}/${wordCount} (${(properWordRatio * 100).toFixed(1)}%)`);
    
//     if (properWordRatio < 0.30) {  // Less than 30% proper words
//       score -= 50;
//       reasons.push(`✗ Very few proper words (${(properWordRatio * 100).toFixed(1)}%) - OCR garbage`);
//       console.log(`   ❌ FAIL: Very few proper words`);
//     } else if (properWordRatio < 0.50) {  // Less than 50% proper words
//       score -= 30;
//       reasons.push(`✗ Low proper word ratio (${(properWordRatio * 100).toFixed(1)}%)`);
//       console.log(`   ⚠️ WARNING: Low proper word ratio`);
//     } else if (properWordRatio >= 0.70) {
//       score += 20;
//       reasons.push(`✓ Good proper word ratio (${(properWordRatio * 100).toFixed(1)}%)`);
//       console.log(`   ✅ PASS: Good proper word ratio`);
//     }
    
//     // 6. BASIC THRESHOLDS (Still needed but less weight)
//     console.log(`\n[PDF DETECTION] Basic threshold checks:`);
    
//     const MIN_CHARS_PER_PAGE = 300;
//     const MIN_WORDS_PER_PAGE = 50;
    
//     if (charsPerPage >= 500) {
//       score += 15;
//       reasons.push(`✓ Good text density: ${charsPerPage.toFixed(0)} chars/page`);
//       console.log(`   ✅ Good text density`);
//     } else if (charsPerPage >= MIN_CHARS_PER_PAGE) {
//       score += 5;
//       reasons.push(`⚠ Acceptable text density: ${charsPerPage.toFixed(0)} chars/page`);
//       console.log(`   ⚠️ Acceptable text density`);
//     } else {
//       score -= 30;
//       reasons.push(`✗ Low text density: ${charsPerPage.toFixed(0)} chars/page`);
//       console.log(`   ❌ Low text density`);
//     }
    
//     if (wordsPerPage >= 50) {
//       score += 10;
//       reasons.push(`✓ Acceptable word count: ${wordsPerPage.toFixed(1)} words/page`);
//       console.log(`   ✅ Acceptable word count`);
//     } else {
//       score -= 30;
//       reasons.push(`✗ Low word count: ${wordsPerPage.toFixed(1)} words/page`);
//       console.log(`   ❌ Low word count`);
//     }
    
//     // 7. SENTENCE STRUCTURE CHECK
//     const sentences = (extractedText.match(/[.!?]+\s+[A-Z]/g) || []).length;
//     const sentencesPerPage = sentences / pageCount;
    
//     console.log(`   - Sentences/page: ${sentencesPerPage.toFixed(1)}`);
    
//     if (sentencesPerPage >= 3) {
//       score += 15;
//       reasons.push(`✓ Good sentence structure`);
//       console.log(`   ✅ Good sentence structure`);
//     } else if (sentencesPerPage < 1) {
//       score -= 20;
//       reasons.push(`✗ Poor sentence structure`);
//       console.log(`   ❌ Poor sentence structure`);
//     }
    
//     // 8. READABLE CHARACTER RATIO
//     const readableChars = (extractedText.match(/[a-zA-Z0-9\s.,;:!?()\-'"]/g) || []).length;
//     const readableRatio = totalChars > 0 ? readableChars / totalChars : 0;
    
//     console.log(`   - Readable ratio: ${(readableRatio * 100).toFixed(1)}%`);
    
//     if (readableRatio >= 0.90) {
//       score += 15;
//       reasons.push(`✓ High readable ratio: ${(readableRatio * 100).toFixed(1)}%`);
//       console.log(`   ✅ High readable ratio`);
//     } else if (readableRatio < 0.75) {
//       score -= 25;
//       reasons.push(`✗ Low readable ratio: ${(readableRatio * 100).toFixed(1)}%`);
//       console.log(`   ❌ Low readable ratio`);
//     }
    
//     // 9. CHECK FOR COMPLETE EMPTINESS
//     if (nonWhitespaceChars < 100) {
//       score = -100;
//       reasons.push(`✗ CRITICAL: Almost no text extracted`);
//       console.log(`   ❌ CRITICAL: Almost no text`);
//     }
    
//     // === FINAL DECISION ===
//     const rawScore = score;
//     const confidence = Math.max(0, Math.min(100, score));
    
//     console.log(`\n${'='.repeat(80)}`);
//     console.log(`[PDF DETECTION] SCORING SUMMARY:`);
//     console.log(`   - Raw score: ${rawScore}`);
//     console.log(`   - Normalized confidence: ${confidence}%`);
//     console.log(`${'='.repeat(80)}`);
    
//     // STRICT DECISION: Must pass ALL of these:
//     // 1. Confidence >= 70%
//     // 2. No excessive OCR artifacts
//     // 3. Good proper word ratio
//     // 4. Meets basic thresholds
    
//     const hasOCRArtifacts = 
//       mergedWordCount > pageCount * 0.5 ||
//       brokenDateCount > 0 ||
//       randomSymbolCount > 0 ||
//       charSubstitutions > 3;
    
//     const meetsQualityThresholds = 
//       charsPerPage >= MIN_CHARS_PER_PAGE &&
//       wordsPerPage >= MIN_WORDS_PER_PAGE &&
//       nonWhitespaceChars >= 100 &&
//       properWordRatio >= 0.50 &&
//       readableRatio >= 0.75;
    
//     console.log(`\n[PDF DETECTION] Decision criteria:`);
//     console.log(`   - Confidence >= 70%: ${confidence >= 70 ? '✅' : '❌'} (${confidence}%)`);
//     console.log(`   - No OCR artifacts: ${!hasOCRArtifacts ? '✅' : '❌'}`);
//     console.log(`   - Quality thresholds: ${meetsQualityThresholds ? '✅' : '❌'}`);
    
//     // CRITICAL: If ANY OCR artifacts detected, mark as scanned
//     const isDigitalNative = confidence >= 70 && !hasOCRArtifacts && meetsQualityThresholds;
    
//     console.log(`\n${'='.repeat(80)}`);
//     console.log(`[PDF DETECTION] 🎯 FINAL DECISION: ${isDigitalNative ? '✅ DIGITAL-NATIVE' : '❌ NEEDS DOCUMENT AI OCR'}`);
//     console.log(`${'='.repeat(80)}\n`);
    
//     // Add final recommendation
//     if (isDigitalNative) {
//       reasons.push(`\n✅ DECISION: Digital-native PDF - clean text extraction`);
//       reasons.push(`   Confidence: ${confidence}%`);
//       reasons.push(`   No OCR artifacts detected`);
//     } else {
//       reasons.push(`\n❌ DECISION: Use Document AI for OCR processing`);
//       if (hasOCRArtifacts) {
//         reasons.push(`   Reason: OCR artifacts detected (merged words, broken dates, etc.)`);
//       }
//       if (confidence < 70) {
//         reasons.push(`   Reason: Low confidence score (${confidence}%)`);
//       }
//       if (!meetsQualityThresholds) {
//         reasons.push(`   Reason: Does not meet text quality thresholds`);
//       }
//     }
    
//     return {
//       isDigitalNative,
//       text: extractedText,
//       pageCount,
//       confidence: Math.round(confidence),
//       reasons,
//       metrics: {
//         charsPerPage: parseFloat(charsPerPage.toFixed(1)),
//         wordsPerPage: parseFloat(wordsPerPage.toFixed(1)),
//         nonWhitespaceCharsPerPage: parseFloat(nonWhitespaceCharsPerPage.toFixed(1)),
//         totalWords: wordCount,
//         totalChars: totalChars,
//         readableRatio: parseFloat((readableRatio * 100).toFixed(1)),
//         sentencesPerPage: parseFloat(sentencesPerPage.toFixed(1)),
//         avgWordLength: parseFloat(avgWordLength.toFixed(1)),
//         properWordRatio: parseFloat((properWordRatio * 100).toFixed(1)),
//         // OCR artifact metrics
//         mergedWordCount: mergedWordCount,
//         brokenDateCount: brokenDateCount,
//         randomSymbolCount: randomSymbolCount,
//         charSubstitutions: charSubstitutions,
//         hasOCRArtifacts: hasOCRArtifacts,
//         rawScore: rawScore
//       }
//     };
//   } catch (error) {
//     console.error("[PDF DETECTION] ❌ PDF parsing failed:", error.message);
//     console.error(error.stack);
//     return {
//       isDigitalNative: false,
//       text: '',
//       pageCount: 0,
//       confidence: 0,
//       reasons: [`✗ PDF parsing error: ${error.message}`, '❌ DECISION: Use Document AI'],
//       metrics: {}
//     };
//   }
// }

// /**
//  * Extracts text from PDF with page-by-page information
//  */
// async function extractTextFromPDFWithPages(fileBuffer) {
//   try {
//     const pdfData = await pdfParse(fileBuffer);
//     const pageCount = pdfData.numpages || 1;
//     const fullText = pdfData.text || '';
    
//     if (!fullText) {
//       return [{
//         text: '',
//         page_start: 1,
//         page_end: pageCount
//       }];
//     }
    
//     return [{
//       text: normalizeText(fullText),
//       page_start: 1,
//       page_end: pageCount
//     }];
//   } catch (error) {
//     console.error("PDF extraction failed:", error.message);
//     throw new Error(`PDF extraction failed: ${error.message}`);
//   }
// }

// /**
//  * Extracts text from file buffer (for digital-native documents only)
//  */
// async function extractText(fileBuffer, mimetype) {
//   let extracted = '';
  
//   if (mimetype === 'application/pdf') {
//     const detection = await detectDigitalNativePDF(fileBuffer);
    
//     if (!detection.isDigitalNative) {
//       throw new Error('PDF is not digital-native. Use Document AI for OCR processing.');
//     }
    
//     extracted = detection.text;
//   } else if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
//     const result = await mammoth.extractRawText({ buffer: fileBuffer });
//     extracted = result.value;
//   } else {
//     throw new Error('Unsupported file type for text extraction');
//   }
  
//   return normalizeText(extracted);
// }

// /**
//  * Normalizes text
//  */
// function normalizeText(text) {
//   if (typeof text !== 'string') {
//     return '';
//   }
//   let cleanedText = text.replace(/[ \t]+/g, ' ');
//   cleanedText = cleanedText.replace(/\n\s*\n/g, '\n\n');
//   cleanedText = cleanedText.split('\n').map(line => line.trim()).join('\n');
//   return cleanedText.trim();
// }

// module.exports = { 
//   extractText, 
//   normalizeText,
//   detectDigitalNativePDF,
//   extractTextFromPDFWithPages
// };


const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

/**
 * Detects if a PDF is digital-native (clean text extraction) or needs Document AI OCR
 * 
 * DECISION LOGIC:
 * - Digital-native PDF (from Word/LaTeX) → Use pdf-parse (FREE, instant)
 * - Scanned/OCR PDF → Use Document AI (cloud processing)
 * 
 * @param {Buffer} fileBuffer - PDF file buffer
 * @returns {Promise<{isDigitalNative: boolean, text: string, pageCount: number, confidence: number, reasons: string[], metrics: object}>}
 */
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
    
    // Calculate basic metrics
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
    
    // Initialize scoring
    let score = 0;
    const reasons = [];
    
    // === CRITICAL OCR ARTIFACT DETECTION ===
    console.log(`\n[PDF DETECTION] 🔍 OCR Artifact Detection:`);
    
    // 1. MERGED WORDS - Most reliable OCR indicator
    // Only detect ACTUAL merged words, not PDF extraction artifacts
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
      // Filter out common false positives
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
    
    // 2. BROKEN DATES/NUMBERS
    const brokenDatePatterns = [
      /\d[IlOo]\d/g,                    // "0I0", "1l9", "2O3"
      /[IlOo]\d[IlOo]/g,                // "I9O", "l2l"
      /\d{1,2}[\/\-][IlOo]\d/g,         // "01/I9", "12-O2"
      /\d+[,\.]{2,}\d+/g,               // "1998...", "2002,,"
      /\d+[:\.,][•\*:]+\d*/g,           // "1998.:•.", "2002:*:"
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
    
    // 3. RANDOM SYMBOL PATTERNS
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
    
    // Adjust for page count - more pages = more expected special chars
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
    
    // 4. CHARACTER SUBSTITUTIONS - OCR errors mixing O/0, I/1/l
    // Only detect in context of numbers/dates, not normal words like "FROM", "ROM", "EOF"
    const text5kSample = extractedText.substring(0, Math.min(5000, extractedText.length));
    
    // Look for O instead of 0 in dates/numbers: 2O23, 1O/O7/98
    const suspiciousO = (text5kSample.match(/\d+[O]\d+/g) || []).length;
    // Look for I instead of 1 in numbers: 2I99, 0I
    const suspiciousI = (text5kSample.match(/\d[I]\d/g) || []).length;
    // Look for l instead of 1 in numbers: 2l99, 0l
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
    
    // 5. WORD QUALITY
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
    
    // 6. BASIC THRESHOLDS
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
    
    // 7. SENTENCE STRUCTURE
    const sentences = (extractedText.match(/[.!?]+\s+[A-Z]/g) || []).length;
    const sentencesPerPage = sentences / pageCount;
    
    if (sentencesPerPage >= 3) {
      score += 15;
      reasons.push(`✓ Good sentence structure`);
    } else if (sentencesPerPage < 1) {
      score -= 20;
      reasons.push(`✗ Poor sentence structure`);
    }
    
    // 8. READABLE CHARACTERS
    const readableChars = (extractedText.match(/[a-zA-Z0-9\s.,;:!?()\-'"]/g) || []).length;
    const readableRatio = totalChars > 0 ? readableChars / totalChars : 0;
    
    if (readableRatio >= 0.88) {
      score += 15;
      reasons.push(`✓ High readable ratio (${(readableRatio * 100).toFixed(1)}%)`);
    } else if (readableRatio < 0.75) {
      score -= 25;
      reasons.push(`✗ Low readable ratio (${(readableRatio * 100).toFixed(1)}%)`);
    }
    
    // 9. EMPTINESS CHECK
    if (nonWhitespaceChars < 100) {
      score = -100;
      reasons.push(`✗ CRITICAL: Almost no text extracted`);
    }
    
    // === FINAL DECISION ===
    const rawScore = score;
    const confidence = Math.max(0, Math.min(100, score));
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[PDF DETECTION] SCORING:`);
    console.log(`   - Raw score: ${rawScore}`);
    console.log(`   - Confidence: ${confidence}%`);
    console.log(`${'='.repeat(80)}`);
    
    // STRICT CRITERIA
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
    
    // FINAL DECISION: ALL three must pass
    const isDigitalNative = confidence >= 70 && !hasOCRArtifacts && meetsQualityThresholds;
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[PDF DETECTION] 🎯 DECISION: ${isDigitalNative ? '✅ DIGITAL-NATIVE (pdf-parse)' : '❌ SCANNED (Document AI)'}`);
    console.log(`${'='.repeat(80)}\n`);
    
    // Add final reasoning
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

/**
 * Helper to create detection result
 */
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

/**
 * Extract text from PDF with page information
 * ✅ FIXED: Extracts page-by-page to preserve individual page numbers
 * Note: pdf-parse doesn't support page-by-page extraction natively,
 * so we estimate page boundaries based on text length distribution
 */
async function extractTextFromPDFWithPages(fileBuffer) {
  try {
    const pdfData = await pdfParse(fileBuffer);
    const pageCount = pdfData.numpages || 1;
    const fullText = pdfData.text || '';
    
    if (!fullText || pageCount <= 1) {
      // Single page or no text
      return [{
        text: normalizeText(fullText),
        page_start: 1,
        page_end: pageCount || 1
      }];
    }
    
    // ✅ FIXED: Split text by pages using approximate page boundaries
    // Strategy: Divide total text length by page count to estimate chars per page
    const totalChars = fullText.length;
    const avgCharsPerPage = Math.ceil(totalChars / pageCount);
    const normalizedText = normalizeText(fullText);
    
    const pageTexts = [];
    let currentPage = 1;
    let currentIndex = 0;
    
    // Split text into approximate page-sized chunks
    while (currentIndex < normalizedText.length && currentPage <= pageCount) {
      let pageEndIndex;
      
      if (currentPage === pageCount) {
        // Last page: take remaining text
        pageEndIndex = normalizedText.length;
      } else {
        // Estimate page boundary
        pageEndIndex = Math.min(currentIndex + avgCharsPerPage, normalizedText.length);
        
        // Try to break at paragraph boundary (double newline) for better chunking
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
    
    // If splitting failed, return as single block with page range
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

/**
 * Extract text from file buffer
 */
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

/**
 * Normalize text
 */
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