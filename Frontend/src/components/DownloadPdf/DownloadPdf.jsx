// import React, { useState } from 'react';
// import pdfMake from 'pdfmake/build/pdfmake';
// import pdfFonts from 'pdfmake/build/vfs_fonts';
// import { Download, Printer, Loader2 } from 'lucide-react';

// // Set up pdfmake fonts and VFS
// if (pdfFonts && pdfFonts.pdfMake && pdfFonts.pdfMake.vfs) {
//   pdfMake.vfs = pdfFonts.pdfMake.vfs;
// } else if (pdfFonts && pdfFonts.vfs) {
//   pdfMake.vfs = pdfFonts.vfs;
// }

// // Initialize Roboto fonts (always available from pdfFonts)
// const initializeRobotoFonts = () => {
//   if (!pdfMake.fonts) {
//     pdfMake.fonts = {};
//   }
  
//   // Register Roboto fonts if they're not already registered
//   if (!pdfMake.fonts.Roboto) {
//     // Log available VFS keys for debugging
//     const vfsKeys = pdfMake.vfs ? Object.keys(pdfMake.vfs) : [];
//     console.log('📋 Available VFS keys (first 20):', vfsKeys.slice(0, 20));
    
//     // Find Roboto font files in VFS (check various possible names)
//     const findRobotoFile = (name) => {
//       const possibleNames = [
//         name,
//         `roboto/${name}`,
//         `Roboto/${name}`,
//         name.toLowerCase(),
//         `roboto/${name.toLowerCase()}`
//       ];
      
//       for (const possibleName of possibleNames) {
//         if (pdfMake.vfs && pdfMake.vfs[possibleName]) {
//           return possibleName;
//         }
//       }
//       return null;
//     };
    
//     const normalFile = findRobotoFile('Roboto-Regular.ttf') || 
//                        findRobotoFile('roboto-regular.ttf') ||
//                        'Roboto-Regular.ttf'; // fallback to standard name
//     const boldFile = findRobotoFile('Roboto-Medium.ttf') || 
//                      findRobotoFile('roboto-medium.ttf') ||
//                      normalFile; // fallback to normal if not found
//     const italicFile = findRobotoFile('Roboto-Italic.ttf') || 
//                        findRobotoFile('roboto-italic.ttf') ||
//                        normalFile;
//     const boldItalicFile = findRobotoFile('Roboto-MediumItalic.ttf') || 
//                            findRobotoFile('roboto-mediumitalic.ttf') ||
//                            boldFile;
    
//     pdfMake.fonts.Roboto = {
//       normal: normalFile,
//       bold: boldFile,
//       italics: italicFile,
//       bolditalics: boldItalicFile
//     };
    
//     console.log('✓ Roboto fonts registered:', {
//       normal: normalFile,
//       bold: boldFile,
//       italics: italicFile,
//       bolditalics: boldItalicFile
//     });
    
//     // Verify files exist in VFS
//     const normalExists = pdfMake.vfs && pdfMake.vfs[normalFile];
//     const boldExists = pdfMake.vfs && pdfMake.vfs[boldFile];
//     console.log(`  Normal exists: ${normalExists ? '✓' : '✗'}, Bold exists: ${boldExists ? '✓' : '✗'}`);
//   }
// };

// // Initialize Roboto fonts immediately
// initializeRobotoFonts();

// // Font loading state
// let devanagariFontsLoaded = false;
// let devanagariVfsLoaded = false;

// // Devanagari Unicode range: U+0900–U+097F (Devanagari script)
// // Also includes extended ranges: U+1CD0–U+1CFF (Vedic Extensions), U+A8E0–U+A8FF (Devanagari Extended)
// const DEVANAGARI_UNICODE_RANGES = [
//   /[\u0900-\u097F]/, // Main Devanagari block
//   /[\u1CD0-\u1CFF]/, // Vedic Extensions
//   /[\uA8E0-\uA8FF]/, // Devanagari Extended
// ];

// /**
//  * Detects if text contains Devanagari characters
//  * @param {string} text - Text to check
//  * @returns {boolean} - True if Devanagari characters are found
//  */
// const containsDevanagari = (text) => {
//   if (!text || typeof text !== 'string') return false;
//   return DEVANAGARI_UNICODE_RANGES.some(regex => regex.test(text));
// };

// /**
//  * Extracts all text content from a DOM element recursively
//  * @param {Element} element - DOM element to extract text from
//  * @returns {string} - All text content concatenated
//  */
// const extractAllText = (element) => {
//   if (!element) return '';
  
//   let text = '';
//   const walker = document.createTreeWalker(
//     element,
//     NodeFilter.SHOW_TEXT,
//     null,
//     false
//   );
  
//   let node;
//   while (node = walker.nextNode()) {
//     text += node.textContent || '';
//   }
  
//   return text;
// };

// /**
//  * Checks if the content contains Devanagari text
//  * @param {Element} element - DOM element to check
//  * @returns {boolean} - True if Devanagari text is found
//  */
// const hasDevanagariContent = (element) => {
//   if (!element) return false;
//   const allText = extractAllText(element);
//   return containsDevanagari(allText);
// };

// // Function to load Devanagari VFS with enhanced error handling
// const loadDevanagariVfs = async () => {
//   if (devanagariVfsLoaded) {
//     // Double-check fonts are still in VFS
//     if (pdfMake.vfs && pdfMake.vfs['NotoSansDevanagari-Regular.ttf']) {
//       return true;
//     } else {
//       console.warn('⚠ Devanagari fonts were loaded but are missing from VFS, reloading...');
//       devanagariVfsLoaded = false;
//     }
//   }
  
//   // Ensure VFS exists
//   if (!pdfMake.vfs) {
//     pdfMake.vfs = {};
//   }
  
//   try {
//     console.log('🔄 Importing devanagari_vfs.js...');
//     console.log('📂 Current VFS keys before import:', pdfMake.vfs ? Object.keys(pdfMake.vfs).slice(0, 10) : 'VFS is null');
    
//     const devanagariModule = await import('../../fonts/vfs/devanagari_vfs.js');
//     console.log('📦 Module imported successfully');
//     console.log('📦 Module structure:', {
//       hasModule: !!devanagariModule,
//       moduleKeys: devanagariModule ? Object.keys(devanagariModule) : [],
//       hasPdfMake: !!(devanagariModule && devanagariModule.pdfMake),
//       hasVfs: !!(devanagariModule && devanagariModule.pdfMake && devanagariModule.pdfMake.vfs),
//       hasDefault: !!(devanagariModule && devanagariModule.default)
//     });
    
//     // Handle different possible module structures
//     let vfsToMerge = null;
    
//     if (devanagariModule && devanagariModule.pdfMake && devanagariModule.pdfMake.vfs) {
//       vfsToMerge = devanagariModule.pdfMake.vfs;
//     } else if (devanagariModule && devanagariModule.vfs) {
//       vfsToMerge = devanagariModule.vfs;
//     } else if (devanagariModule && devanagariModule.default) {
//       // Handle default export
//       const defaultModule = devanagariModule.default;
//       if (defaultModule.pdfMake && defaultModule.pdfMake.vfs) {
//         vfsToMerge = defaultModule.pdfMake.vfs;
//       } else if (defaultModule.vfs) {
//         vfsToMerge = defaultModule.vfs;
//       }
//     }
    
//     if (vfsToMerge && typeof vfsToMerge === 'object') {
//       const vfsKeys = Object.keys(vfsToMerge);
//       console.log('📋 VFS keys to merge:', vfsKeys);
//       console.log('📊 VFS merge details:', {
//         keysCount: vfsKeys.length,
//         hasRegular: vfsKeys.includes('NotoSansDevanagari-Regular.ttf'),
//         hasBold: vfsKeys.includes('NotoSansDevanagari-Bold.ttf'),
//         sampleKeys: vfsKeys.slice(0, 5)
//       });
      
//       // Ensure VFS exists before merging
//       if (!pdfMake.vfs) {
//         console.warn('⚠️ pdfMake.vfs is null, creating new VFS object');
//         pdfMake.vfs = {};
//       }
      
//       // Merge fonts into VFS - merge each key individually to ensure they're added
//       const beforeMergeCount = Object.keys(pdfMake.vfs).length;
//       const regularKey = 'NotoSansDevanagari-Regular.ttf';
//       const boldKey = 'NotoSansDevanagari-Bold.ttf';
      
//       // Merge all keys from vfsToMerge
//       for (const key of vfsKeys) {
//         pdfMake.vfs[key] = vfsToMerge[key];
//       }
      
//       const afterMergeCount = Object.keys(pdfMake.vfs).length;
//       console.log(`📦 VFS merge: ${beforeMergeCount} → ${afterMergeCount} keys`);
      
//       // Verify fonts were actually added - check immediately after merge
//       const regularExists = pdfMake.vfs[regularKey];
//       const boldExists = pdfMake.vfs[boldKey];
      
//       console.log('🔍 Post-merge verification:', {
//         regularKey,
//         regularExists: !!regularExists,
//         regularType: typeof regularExists,
//         regularLength: regularExists ? String(regularExists).length : 0,
//         regularHasOwnProperty: pdfMake.vfs.hasOwnProperty(regularKey),
//         boldKey,
//         boldExists: !!boldExists,
//         boldType: typeof boldExists,
//         boldLength: boldExists ? String(boldExists).length : 0
//       });
      
//       // Verify the font data is actually a string with content (base64 strings are long)
//       if (regularExists && typeof regularExists === 'string' && regularExists.length > 100) {
//         devanagariVfsLoaded = true;
//         console.log('✅ Devanagari fonts merged into VFS successfully');
//         console.log(`  Regular font: ✓ (type: ${typeof regularExists}, length: ${regularExists.length})`);
//         console.log(`  Bold font: ${boldExists && typeof boldExists === 'string' && boldExists.length > 100 ? '✓' : '✗'}`);
//         return true;
//       } else {
//         console.error('❌ Fonts were merged but NotoSansDevanagari-Regular.ttf is invalid or missing');
//         console.error('Regular font check:', {
//           exists: !!regularExists,
//           type: typeof regularExists,
//           length: regularExists ? String(regularExists).length : 0,
//           isString: typeof regularExists === 'string',
//           hasMinLength: regularExists ? String(regularExists).length > 100 : false,
//           hasOwnProperty: pdfMake.vfs.hasOwnProperty(regularKey)
//         });
//         console.error('Available VFS keys (first 20):', Object.keys(pdfMake.vfs).slice(0, 20));
        
//         // Check for alternative key names
//         const allKeys = Object.keys(pdfMake.vfs);
//         const devanagariKeys = allKeys.filter(key => 
//           key.toLowerCase().includes('devanagari') || 
//           key.toLowerCase().includes('noto')
//         );
//         if (devanagariKeys.length > 0) {
//           console.log('Found potential Devanagari font keys:', devanagariKeys);
//           console.log('💡 Checking key values:', devanagariKeys.slice(0, 3).map(k => ({
//             key: k,
//             type: typeof pdfMake.vfs[k],
//             length: String(pdfMake.vfs[k]).length
//           })));
//         } else {
//           console.error('❌ No Devanagari font keys found in VFS at all!');
//         }
//       }
//     } else {
//       console.error('❌ Invalid module structure - vfsToMerge is not an object:', {
//         hasModule: !!devanagariModule,
//         hasPdfMake: !!(devanagariModule && devanagariModule.pdfMake),
//         hasVfs: !!(devanagariModule && devanagariModule.pdfMake && devanagariModule.pdfMake.vfs),
//         moduleKeys: devanagariModule ? Object.keys(devanagariModule) : [],
//         vfsToMergeType: typeof vfsToMerge,
//         vfsToMergeValue: vfsToMerge
//       });
      
//       // Try to log the full module structure for debugging
//       if (devanagariModule) {
//         console.log('🔍 Full module structure:', JSON.stringify(Object.keys(devanagariModule), null, 2));
//         if (devanagariModule.pdfMake) {
//           console.log('🔍 pdfMake structure:', JSON.stringify(Object.keys(devanagariModule.pdfMake), null, 2));
//         }
//       }
//     }
//   } catch (error) {
//     console.error('❌ Could not import devanagari_vfs.js:', error);
//     console.error('Error details:', error.message, error.stack);
    
//     // Provide helpful error message
//     if (error.message && error.message.includes('Failed to fetch')) {
//       console.error('💡 Tip: The devanagari_vfs.js file may not be accessible. Check file path and build configuration.');
//     } else if (error.message && error.message.includes('Cannot find module')) {
//       console.error('💡 Tip: The devanagari_vfs.js file is missing. Run "npm run build:fonts" to generate it.');
//     }
//   }
//   return false;
// };

// // Function to register Devanagari fonts
// const registerDevanagariFont = async () => {
//   if (devanagariFontsLoaded) {
//     return true;
//   }

//   // Ensure VFS exists
//   if (!pdfMake.vfs) {
//     pdfMake.vfs = {};
//   }

//   // Load Devanagari VFS first
//   const vfsLoaded = await loadDevanagariVfs();
//   if (!vfsLoaded) {
//     console.warn('⚠ Could not load Devanagari VFS');
//     return false;
//   }

//   // Verify fonts are actually in VFS
//   const regularInVfs = pdfMake.vfs && pdfMake.vfs['NotoSansDevanagari-Regular.ttf'];
//   const boldInVfs = pdfMake.vfs && pdfMake.vfs['NotoSansDevanagari-Bold.ttf'];
  
//   console.log(`📊 Font availability check: Regular: ${regularInVfs ? '✓' : '✗'}, Bold: ${boldInVfs ? '✓' : '✗'}`);
  
//   // Only register DevanagariFont if we have at least the regular font in VFS
//   if (regularInVfs) {
//     // Register the font family only with fonts that actually exist in VFS
//     if (!pdfMake.fonts) {
//       pdfMake.fonts = {};
//     }
    
//     // Always use regular font for bold if bold font is not available
//     const boldFontFile = boldInVfs ? 'NotoSansDevanagari-Bold.ttf' : 'NotoSansDevanagari-Regular.ttf';
    
//     // Double-check the bold font file exists in VFS before using it
//     const boldFontExists = pdfMake.vfs[boldFontFile];
//     const finalBoldFont = boldFontExists ? boldFontFile : 'NotoSansDevanagari-Regular.ttf';
    
//     pdfMake.fonts.DevanagariFont = {
//       normal: 'NotoSansDevanagari-Regular.ttf',
//       bold: finalBoldFont,
//       italics: 'NotoSansDevanagari-Regular.ttf',
//       bolditalics: finalBoldFont
//     };

//     devanagariFontsLoaded = true;
//     console.log(`✅ DevanagariFont family registered successfully (Regular: ✓, Bold: ${boldInVfs && boldFontExists ? '✓' : '↳ using Regular'})`);
//     return true;
//   } else {
//     console.warn('⚠ Cannot register DevanagariFont - regular font not available in VFS.');
//     return false;
//   }
// };

// const DownloadPdf = ({ markdownOutputRef, questionTitle }) => {
//   const [isLoading, setIsLoading] = useState(false);
//   const [error, setError] = useState(null);
//   const [success, setSuccess] = useState(null);
//   const [devanagariDetected, setDevanagariDetected] = useState(false);
//   const [fontWarning, setFontWarning] = useState(null);

//   // Function to remove conversational text from LLM responses
//   const removeConversationalText = (element) => {
//     const conversationalPhrases = [
//       /^Okay,.*?\.(\s|$)/i,
//       /^Sure,.*?\.(\s|$)/i,
//       /^Here'?s.*?\.(\s|$)/i,
//       /^I'?ll.*?\.(\s|$)/i,
//       /^Let me.*?\.(\s|$)/i,
//       /^I'?ve.*?\.(\s|$)/i,
//       /^Certainly.*?\.(\s|$)/i,
//       /^Of course.*?\.(\s|$)/i,
//       /^Absolutely.*?\.(\s|$)/i,
//       /^Great,.*?\.(\s|$)/i,
//       /^Perfect,.*?\.(\s|$)/i,
//       /^Alright,.*?\.(\s|$)/i,
//     ];

//     const walker = document.createTreeWalker(
//       element,
//       NodeFilter.SHOW_TEXT,
//       null,
//       false
//     );

//     const textNodes = [];
//     let node;
//     while (node = walker.nextNode()) {
//       textNodes.push(node);
//     }

//     textNodes.slice(0, 3).forEach(textNode => {
//       let text = textNode.textContent.trim();
//       conversationalPhrases.forEach(phrase => {
//         text = text.replace(phrase, '');
//       });
      
//       if (text !== textNode.textContent.trim()) {
//         textNode.textContent = text;
//         const parent = textNode.parentElement;
//         if (parent && parent.tagName === 'P' && parent.textContent.trim() === '') {
//           parent.remove();
//         }
//       }
//     });
//   };

//   // Extract inline formatted text segments from a node
//   const extractFormattedText = (node) => {
//     const segments = [];
    
//     const processNode = (n) => {
//       if (n.nodeType === Node.TEXT_NODE) {
//         const text = n.textContent.trim();
//         if (text) {
//           segments.push({ text, style: [] });
//         }
//       } else if (n.nodeType === Node.ELEMENT_NODE) {
//         const tagName = n.tagName ? n.tagName.toLowerCase() : '';
//         const styles = [];
        
//         if (tagName === 'strong' || tagName === 'b') {
//           styles.push('bold');
//         }
//         if (tagName === 'em' || tagName === 'i') {
//           styles.push('italics');
//         }
//         if (tagName === 'code' && !n.closest('pre')) {
//           styles.push('code');
//         }
//         if (tagName === 'a') {
//           styles.push('link');
//         }
        
//         // Process children
//         for (const child of n.childNodes) {
//           if (child.nodeType === Node.TEXT_NODE) {
//             const text = child.textContent.trim();
//             if (text) {
//               segments.push({ text, style: styles });
//             }
//           } else {
//             const childSegments = extractFormattedText(child);
//             childSegments.forEach(seg => {
//               seg.style = [...styles, ...seg.style];
//               segments.push(seg);
//             });
//           }
//         }
//       }
//     };
    
//     processNode(node);
//     return segments;
//   };

//   // Convert formatted segments to pdfmake text array
//   const segmentsToPdfMakeText = (segments) => {
//     const result = [];
//     segments.forEach(seg => {
//       const textObj = { text: seg.text };
      
//       if (seg.style.includes('bold')) {
//         textObj.bold = true;
//       }
//       if (seg.style.includes('italics')) {
//         textObj.italics = true;
//       }
//       if (seg.style.includes('code')) {
//         textObj.font = 'Courier';
//         textObj.color = '#dc2626';
//         textObj.background = '#f3f4f6';
//       }
//       if (seg.style.includes('link')) {
//         textObj.color = '#2563eb';
//         textObj.decoration = 'underline';
//       }
      
//       result.push(textObj);
//     });
//     return result;
//   };

//   // Helper to flatten and filter content arrays
//   const flattenContent = (content) => {
//     if (!content) return null;
//     if (Array.isArray(content)) {
//       const flattened = content.flat().filter(item => item !== null && item !== undefined);
//       if (flattened.length === 0) return null;
//       if (flattened.length === 1) return flattened[0];
//       return flattened;
//     }
//     return content;
//   };

//   // Convert HTML element to pdfmake content
//   const elementToPdfMake = (element) => {
//     if (!element || element.nodeType !== Node.ELEMENT_NODE) {
//       return null;
//     }

//     const tagName = element.tagName ? element.tagName.toLowerCase() : '';
    
//     // Skip script and style tags
//     if (tagName === 'script' || tagName === 'style') {
//       return null;
//     }

//     // Handle headings
//     if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
//       const level = parseInt(tagName.charAt(1));
//       const fontSize = 24 - (level - 1) * 2; // h1: 24, h2: 22, h3: 20, etc.
//       const segments = extractFormattedText(element);
//       const textContent = segmentsToPdfMakeText(segments);
      
//       return {
//         text: textContent.length > 0 ? textContent : element.textContent.trim(),
//         fontSize,
//         bold: true,
//         color: '#111827',
//         margin: [0, level === 1 ? 8 : level === 2 ? 7 : 6, 0, level === 1 ? 6 : level === 2 ? 5 : 4],
//         pageBreak: 'avoid',
//       };
//     }

//     // Handle paragraphs
//     if (tagName === 'p') {
//       const segments = extractFormattedText(element);
//       const textContent = segmentsToPdfMakeText(segments);
//       const plainText = element.textContent.trim();
      
//       if (!plainText) return null;
      
//       return {
//         text: textContent.length > 0 ? textContent : plainText,
//         fontSize: 11,
//         color: '#1f2937',
//         margin: [0, 3, 0, 3],
//         lineHeight: 1.6,
//       };
//     }

//     // Handle lists
//     if (tagName === 'ul' || tagName === 'ol') {
//       const listItems = element.querySelectorAll('li');
//       const items = [];
      
//       listItems.forEach((li, index) => {
//         const segments = extractFormattedText(li);
//         const textContent = segmentsToPdfMakeText(segments);
//         const plainText = li.textContent.trim();
        
//         if (plainText) {
//           items.push({
//             text: textContent.length > 0 ? textContent : plainText,
//             fontSize: 11,
//             color: '#1f2937',
//             margin: [0, 1, 0, 1],
//           });
//         }
//       });
      
//       if (items.length === 0) return null;
      
//       return {
//         [tagName === 'ul' ? 'ul' : 'ol']: items,
//         margin: [0, 3, 0, 3],
//       };
//     }

//     // Handle tables
//     if (tagName === 'table') {
//       const rows = [];
//       const tableRows = element.querySelectorAll('tr');
      
//       if (tableRows.length === 0) return null;
      
//       let hasHeaderRow = false;
      
//       tableRows.forEach((row, rowIndex) => {
//         const cells = [];
//         const cellElements = row.querySelectorAll('th, td');
//         const isHeaderRow = row.querySelector('th') !== null;
        
//         if (isHeaderRow && rowIndex === 0) {
//           hasHeaderRow = true;
//         }
        
//         cellElements.forEach(cell => {
//           const segments = extractFormattedText(cell);
//           const textContent = segmentsToPdfMakeText(segments);
//           const plainText = cell.textContent.trim();
          
//           const cellContent = {
//             text: textContent.length > 0 ? textContent : plainText,
//             fontSize: isHeaderRow ? 10 : 10,
//             color: isHeaderRow ? '#374151' : '#1f2937',
//             bold: isHeaderRow,
//             margin: [4, 3, 4, 3],
//             fillColor: isHeaderRow ? '#f3f4f6' : undefined,
//           };
          
//           cells.push(cellContent);
//         });
        
//         if (cells.length > 0) {
//           rows.push(cells);
//         }
//       });
      
//       if (rows.length === 0) return null;
      
//       // Calculate column widths (equal distribution)
//       const numCols = rows[0]?.length || 0;
//       const colWidths = numCols > 0 ? Array(numCols).fill('*') : ['*'];
      
//       return {
//         table: {
//           headerRows: hasHeaderRow ? 1 : 0,
//           widths: colWidths,
//           body: rows,
//         },
//         layout: {
//           hLineWidth: (i, node) => {
//             // Thicker line after header
//             if (hasHeaderRow && i === 1) return 1;
//             return 0.5;
//           },
//           vLineWidth: (i, node) => 0.5,
//           hLineColor: (i, node) => '#d1d5db',
//           vLineColor: (i, node) => '#d1d5db',
//           paddingLeft: () => 4,
//           paddingRight: () => 4,
//           paddingTop: () => 3,
//           paddingBottom: () => 3,
//         },
//         margin: [0, 4, 0, 4],
//         pageBreak: 'avoid',
//       };
//     }

//     // Handle code blocks
//     if (tagName === 'pre') {
//       const codeText = element.textContent.trim();
//       if (!codeText) return null;
      
//       return {
//         text: codeText,
//         font: 'Courier',
//         fontSize: 9,
//         color: '#f9fafb',
//         background: '#1f2937',
//         margin: [0, 4, 0, 4],
//         preserveTrailingSpaces: true,
//         pageBreak: 'avoid',
//       };
//     }

//     // Handle inline code (not in pre)
//     if (tagName === 'code' && !element.closest('pre')) {
//       const codeText = element.textContent.trim();
//       if (!codeText) return null;
      
//       return {
//         text: ` ${codeText} `,
//         font: 'Courier',
//         fontSize: 10,
//         color: '#dc2626',
//         background: '#f3f4f6',
//         margin: [0, 0, 0, 0],
//       };
//     }

//     // Handle blockquotes
//     if (tagName === 'blockquote') {
//       const segments = extractFormattedText(element);
//       const textContent = segmentsToPdfMakeText(segments);
//       const plainText = element.textContent.trim();
      
//       if (!plainText) return null;
      
//       return {
//         text: textContent.length > 0 ? textContent : plainText,
//         fontSize: 11,
//         italics: true,
//         color: '#1e40af',
//         background: '#eff6ff',
//         border: [true, false, false, false],
//         borderColor: '#3b82f6',
//         borderWidth: 2,
//         margin: [8, 4, 0, 4],
//         padding: [8, 0, 0, 0],
//       };
//     }

//     // Handle horizontal rules
//     if (tagName === 'hr') {
//       return {
//         canvas: [{
//           type: 'line',
//           x1: 0,
//           y1: 0,
//           x2: 515, // Full width minus margins
//           y2: 0,
//           lineWidth: 1,
//           lineColor: '#e5e7eb',
//         }],
//         margin: [0, 6, 0, 6],
//       };
//     }

//     // Handle divs and other containers - recursively process children
//     if (tagName === 'div' || !['strong', 'b', 'em', 'i', 'a', 'span', 'code'].includes(tagName)) {
//       const children = Array.from(element.childNodes);
//       const content = [];
      
//       children.forEach(child => {
//         if (child.nodeType === Node.ELEMENT_NODE) {
//           const childContent = elementToPdfMake(child);
//           if (childContent) {
//             if (Array.isArray(childContent)) {
//               content.push(...childContent);
//             } else {
//               content.push(childContent);
//             }
//           }
//         } else if (child.nodeType === Node.TEXT_NODE) {
//           const text = child.textContent.trim();
//           if (text) {
//             // Check if this text node is part of a formatted element
//             const parent = child.parentElement;
//             if (parent && ['strong', 'b', 'em', 'i', 'a', 'code'].includes(parent.tagName?.toLowerCase())) {
//               // Let the parent handle formatting
//               return;
//             }
//             content.push({
//               text,
//               fontSize: 11,
//               color: '#1f2937',
//             });
//           }
//         }
//       });
      
//       if (content.length === 0) return null;
//       if (content.length === 1) return content[0];
//       return content;
//     }

//     return null;
//   };

//   // Main PDF generation function using pdfmake
//   const handleDownloadPdf = async () => {
//     const element = markdownOutputRef.current;
//     if (!element) {
//       setError('No content to download as PDF.');
//       return;
//     }

//     setIsLoading(true);
//     setError(null);
//     setSuccess(null);
//     setFontWarning(null);

//     // Yield to browser immediately
//     await new Promise(resolve => setTimeout(resolve, 10));

//     try {
//       // Detect Devanagari content
//       const hasDevanagari = hasDevanagariContent(element);
//       setDevanagariDetected(hasDevanagari);
      
//       if (hasDevanagari) {
//         console.log('🔍 Devanagari (Marathi) text detected in content');
//       }

//       // Load and register Devanagari fonts before generating PDF
//       let devanagariLoaded = false;
//       if (hasDevanagari) {
//         console.log('🔤 Loading Devanagari fonts...');
        
//         // Force reload to ensure fresh state
//         devanagariVfsLoaded = false;
//         devanagariFontsLoaded = false;
        
//         devanagariLoaded = await registerDevanagariFont();
        
//         // CRITICAL: Double-check fonts are actually in VFS before proceeding
//         if (devanagariLoaded) {
//           const regularInVfs = pdfMake.vfs && pdfMake.vfs['NotoSansDevanagari-Regular.ttf'] && typeof pdfMake.vfs['NotoSansDevanagari-Regular.ttf'] === 'string';
//           const fontRegistered = pdfMake.fonts && pdfMake.fonts.DevanagariFont;
          
//           console.log('🔍 Post-registration verification:', {
//             regularInVfs,
//             fontRegistered,
//             vfsExists: !!pdfMake.vfs,
//             vfsKeyCount: pdfMake.vfs ? Object.keys(pdfMake.vfs).length : 0,
//             hasRegularKey: pdfMake.vfs ? pdfMake.vfs.hasOwnProperty('NotoSansDevanagari-Regular.ttf') : false,
//             regularType: pdfMake.vfs && pdfMake.vfs['NotoSansDevanagari-Regular.ttf'] ? typeof pdfMake.vfs['NotoSansDevanagari-Regular.ttf'] : 'undefined',
//             regularLength: pdfMake.vfs && pdfMake.vfs['NotoSansDevanagari-Regular.ttf'] ? String(pdfMake.vfs['NotoSansDevanagari-Regular.ttf']).length : 0
//           });
          
//           if (!regularInVfs || !fontRegistered) {
//             console.error('❌ Font registration reported success but fonts not found in VFS!');
//             console.error('VFS keys containing "Devanagari" or "Noto":', 
//               pdfMake.vfs ? Object.keys(pdfMake.vfs).filter(k => 
//                 k.toLowerCase().includes('devanagari') || 
//                 k.toLowerCase().includes('noto')
//               ) : []
//             );
//             devanagariLoaded = false;
//           } else {
//             console.log('✅ Verified: Devanagari fonts are in VFS and registered');
//           }
//         }
        
//         if (!devanagariLoaded) {
//           setFontWarning(
//             'Devanagari fonts not available. PDF will use Roboto font (Marathi text may not render correctly). ' +
//             'For best quality, use the Print function which uses system fonts.'
//           );
//         }
//       }
      
//       let selectedFont = devanagariLoaded ? 'DevanagariFont' : 'Roboto';
//       console.log(`📝 Initial font selection: ${selectedFont}${hasDevanagari && !devanagariLoaded ? ' (fallback - Devanagari fonts unavailable)' : ''}`);
      
//       // Clone element to avoid modifying original
//       const clonedElement = element.cloneNode(true);
//       removeConversationalText(clonedElement);

//       // Convert DOM to pdfmake content
//       const content = [];
//       const children = Array.from(clonedElement.children);
      
//       if (children.length === 0) {
//         // Process element itself if no children
//         const elementContent = elementToPdfMake(clonedElement);
//         const flattened = flattenContent(elementContent);
//         if (flattened) {
//           if (Array.isArray(flattened)) {
//             content.push(...flattened);
//           } else {
//             content.push(flattened);
//           }
//         }
//       } else {
//         // Process each child element
//         children.forEach(child => {
//           const childContent = elementToPdfMake(child);
//           const flattened = flattenContent(childContent);
//           if (flattened) {
//             if (Array.isArray(flattened)) {
//               content.push(...flattened);
//             } else {
//               content.push(flattened);
//             }
//           }
//         });
//       }
      
//       // Filter out null/undefined and flatten
//       const filteredContent = content.filter(item => item !== null && item !== undefined);
//       if (filteredContent.length === 0) {
//         setError('No content found to generate PDF.');
//         setIsLoading(false);
//         return;
//       }

//       // Format timestamp
//       const now = new Date();
//       const year = now.getFullYear();
//       const month = String(now.getMonth() + 1).padStart(2, '0');
//       const day = String(now.getDate()).padStart(2, '0');
//       let hours = now.getHours();
//       const minutes = String(now.getMinutes()).padStart(2, '0');
//       const ampm = hours >= 12 ? 'PM' : 'AM';
//       hours = hours % 12;
//       hours = hours ? hours : 12;
//       const formattedTime = `${year}-${month}-${day}_${hours}-${minutes}${ampm}`;

//       // Clean filename
//       const cleanedQuestionTitle = questionTitle
//         ? questionTitle.replace(/[^a-zA-Z0-9_ -]/g, '').replace(/\s+/g, '_').substring(0, 50)
//         : 'AI_Analysis';

//       // CRITICAL: Final verification RIGHT BEFORE PDF generation
//       // Ensure selected font is registered and files exist in VFS
//       let finalSelectedFont = selectedFont;
      
//       // Ensure Roboto is always registered as fallback
//       initializeRobotoFonts();
      
//       if (selectedFont === 'DevanagariFont') {
//         const fontDef = pdfMake.fonts && pdfMake.fonts.DevanagariFont;
//         if (fontDef) {
//           const normalFile = fontDef.normal;
//           const boldFile = fontDef.bold;
          
//           // CRITICAL: Verify the actual font files exist in VFS with proper type and length
//           const normalInVfs = pdfMake.vfs && pdfMake.vfs.hasOwnProperty(normalFile);
//           const normalValue = normalInVfs ? pdfMake.vfs[normalFile] : null;
//           const normalExists = normalValue && typeof normalValue === 'string' && normalValue.length > 100; // Base64 strings are long
          
//           const boldInVfs = boldFile ? (pdfMake.vfs && pdfMake.vfs.hasOwnProperty(boldFile)) : false;
//           const boldValue = boldInVfs ? pdfMake.vfs[boldFile] : null;
//           const boldExists = boldValue && typeof boldValue === 'string' && boldValue.length > 100;
          
//           console.log('🔍 FINAL font verification (pre-PDF generation):', {
//             normalFile,
//             boldFile,
//             normalInVfs,
//             normalExists,
//             normalType: typeof normalValue,
//             normalLength: normalValue ? String(normalValue).length : 0,
//             boldInVfs,
//             boldExists,
//             vfsExists: !!pdfMake.vfs,
//             vfsKeysCount: pdfMake.vfs ? Object.keys(pdfMake.vfs).length : 0
//           });
          
//           if (!normalExists) {
//             console.error('❌ CRITICAL: DevanagariFont registered but font file missing or invalid in VFS!');
//             console.error(`  Expected file: ${normalFile}`);
//             console.error(`  File exists in VFS: ${normalInVfs}`);
//             console.error(`  File value type: ${typeof normalValue}`);
//             console.error(`  File value length: ${normalValue ? String(normalValue).length : 0}`);
//             console.error(`  VFS keys (first 30):`, pdfMake.vfs ? Object.keys(pdfMake.vfs).slice(0, 30) : []);
            
//             // Check if file exists with different key
//             if (pdfMake.vfs) {
//               const matchingKeys = Object.keys(pdfMake.vfs).filter(k => 
//                 k.toLowerCase().includes('devanagari') || 
//                 k.toLowerCase().includes('noto') ||
//                 (k.toLowerCase().includes('regular') && k.toLowerCase().includes('ttf'))
//               );
//               if (matchingKeys.length > 0) {
//                 console.log('💡 Found similar keys in VFS:', matchingKeys);
//                 console.log('💡 Sample values:', matchingKeys.slice(0, 3).map(k => ({
//                   key: k,
//                   type: typeof pdfMake.vfs[k],
//                   length: String(pdfMake.vfs[k]).length
//                 })));
//               } else {
//                 console.error('❌ No Devanagari font keys found in VFS at all!');
//               }
//             }
            
//             console.warn('⚠️ FORCING fallback to Roboto to prevent PDF generation failure');
//             finalSelectedFont = 'Roboto';
//             setFontWarning('Devanagari fonts could not be loaded. Using Roboto font. Marathi text may not render correctly. Use Print function for best quality.');
//           } else if (!boldExists && boldFile) {
//             console.warn('⚠ Bold font missing, but regular font exists - will use regular for bold');
//             console.log('✅ Font verification passed - regular Devanagari font present in VFS');
//           } else {
//             console.log('✅ Font verification passed - all Devanagari font files present in VFS');
//           }
//         } else {
//           console.warn('⚠ DevanagariFont not registered, falling back to Roboto');
//           finalSelectedFont = 'Roboto';
//         }
//       }
      
//       // ABSOLUTE FINAL CHECK: If we're still trying to use DevanagariFont, verify one more time
//       if (finalSelectedFont === 'DevanagariFont') {
//         const fontDef = pdfMake.fonts && pdfMake.fonts.DevanagariFont;
//         const normalFile = fontDef ? fontDef.normal : null;
//         const fontInVfs = normalFile && pdfMake.vfs && pdfMake.vfs[normalFile] && typeof pdfMake.vfs[normalFile] === 'string' && pdfMake.vfs[normalFile].length > 100;
        
//         if (!fontInVfs) {
//           console.error('❌ ABSOLUTE FINAL CHECK FAILED: Font not in VFS, forcing Roboto');
//           finalSelectedFont = 'Roboto';
//         }
//       }
      
//       // Final check: ensure the selected font is registered
//       if (!pdfMake.fonts || !pdfMake.fonts[finalSelectedFont]) {
//         console.error(`❌ Font '${finalSelectedFont}' is not registered! Available fonts:`, Object.keys(pdfMake.fonts || {}));
//         // Force Roboto registration
//         initializeRobotoFonts();
//         if (pdfMake.fonts && pdfMake.fonts.Roboto) {
//           finalSelectedFont = 'Roboto';
//           console.log('🔄 Using Roboto as fallback');
//         } else {
//           setError('Failed to initialize fonts. Please refresh the page.');
//           setIsLoading(false);
//           return;
//         }
//       }
      
//       console.log(`📝 Final font selection: ${finalSelectedFont}`);
//       console.log(`📋 Registered fonts:`, Object.keys(pdfMake.fonts || {}));
      
//       // ABSOLUTE FINAL CHECK: Verify font is actually usable before creating PDF
//       if (finalSelectedFont === 'DevanagariFont') {
//         const fontDef = pdfMake.fonts && pdfMake.fonts.DevanagariFont;
//         if (fontDef) {
//           const normalFile = fontDef.normal;
//           const fontData = pdfMake.vfs && pdfMake.vfs[normalFile];
          
//           if (!fontData || typeof fontData !== 'string' || fontData.length < 100) {
//             console.error('❌ LAST CHANCE CHECK: Devanagari font data invalid, switching to Roboto NOW');
//             console.error('Font data check:', {
//               hasFontData: !!fontData,
//               type: typeof fontData,
//               length: fontData ? String(fontData).length : 0,
//               firstChars: fontData ? String(fontData).substring(0, 50) : 'N/A'
//             });
//             finalSelectedFont = 'Roboto';
//             setFontWarning('Devanagari fonts could not be loaded. Using Roboto font. Marathi text may not render correctly. Use Print function for best quality.');
//           } else {
//             console.log('✅ Final verification passed - font data is valid and ready');
//           }
//         } else {
//           console.error('❌ LAST CHANCE CHECK: DevanagariFont not registered, switching to Roboto');
//           finalSelectedFont = 'Roboto';
//         }
//       }

//       // Create pdfmake document definition
//       const docDefinition = {
//         content: filteredContent,
//         defaultStyle: {
//           font: finalSelectedFont,
//           fontSize: 11,
//           lineHeight: 1.5,
//         },
//         styles: {
//           h1: {
//             font: finalSelectedFont,
//             fontSize: 24,
//             bold: true,
//             color: '#111827',
//             margin: [0, 8, 0, 6],
//           },
//           h2: {
//             font: finalSelectedFont,
//             fontSize: 22,
//             bold: true,
//             color: '#111827',
//             margin: [0, 7, 0, 5],
//           },
//           h3: {
//             font: finalSelectedFont,
//             fontSize: 20,
//             bold: true,
//             color: '#1f2937',
//             margin: [0, 6, 0, 4],
//           },
//           h4: {
//             font: finalSelectedFont,
//             fontSize: 18,
//             bold: true,
//             color: '#1f2937',
//             margin: [0, 5, 0, 3],
//           },
//           h5: {
//             font: finalSelectedFont,
//             fontSize: 16,
//             bold: true,
//             color: '#1f2937',
//             margin: [0, 4, 0, 2],
//           },
//           h6: {
//             font: finalSelectedFont,
//             fontSize: 14,
//             bold: true,
//             color: '#1f2937',
//             margin: [0, 3, 0, 2],
//           },
//           code: {
//             font: 'Courier',
//             fontSize: 10,
//             color: '#dc2626',
//             background: '#f3f4f6',
//           },
//           blockquote: {
//             font: finalSelectedFont,
//             italics: true,
//             color: '#1e40af',
//             background: '#eff6ff',
//             margin: [8, 4, 0, 4],
//           },
//         },
//         pageSize: 'A4',
//         pageMargins: [40, 60, 40, 60],
//         info: {
//           title: cleanedQuestionTitle,
//           author: 'JuriNex',
//           subject: 'AI Analysis Response',
//         },
//       };

//       // Generate and download PDF with error handling
//       const generatePdf = (docDef, fontName, retryCount = 0, hasDevanagariText = false) => {
//         try {
//           const pdfDocGenerator = pdfMake.createPdf(docDef);
//           const filename = `${cleanedQuestionTitle}_${formattedTime}.pdf`;
          
//           // Set up error handler for unhandled promise rejections
//           const errorHandler = (event) => {
//             const error = event.reason || event.error || event;
//             const isFontError = error && (
//               (typeof error === 'string' && error.includes('not found in virtual file system')) ||
//               (error.message && error.message.includes('not found in virtual file system')) ||
//               (error.message && error.message.includes('File') && error.message.includes('.ttf'))
//             );
            
//             if (isFontError) {
//               event.preventDefault();
//               console.error('❌ Font error detected:', error.message || error);
              
//               // Remove the error handler
//               window.removeEventListener('unhandledrejection', errorHandler);
              
//               // If we're not already using Roboto and haven't retried, retry with Roboto
//               if (fontName !== 'Roboto' && retryCount === 0) {
//                 console.log('🔄 Retrying PDF generation with Roboto font...');
//                 docDef.defaultStyle.font = 'Roboto';
//                 Object.keys(docDef.styles || {}).forEach(styleKey => {
//                   if (docDef.styles[styleKey].font && docDef.styles[styleKey].font !== 'Courier') {
//                     docDef.styles[styleKey].font = 'Roboto';
//                   }
//                 });
//                 generatePdf(docDef, 'Roboto', 1, hasDevanagariText);
//               } else {
//                 const errorMessage = hasDevanagariText
//                   ? 'Failed to generate PDF: Devanagari fonts not available. Please use the Print function for best Marathi text quality, or ensure devanagari_vfs.js is properly generated.'
//                   : 'Failed to generate PDF: Font file not found.';
//                 setError(errorMessage);
//                 setTimeout(() => setError(null), 7000);
//                 setIsLoading(false);
//               }
//               return true;
//             }
//             return false;
//           };
          
//           // Add error handler
//           window.addEventListener('unhandledrejection', errorHandler, { once: true });
          
//           pdfDocGenerator.download(filename, () => {
//             // Success - remove error handler
//             window.removeEventListener('unhandledrejection', errorHandler);
//             const successMessage = hasDevanagariText && fontName === 'Roboto'
//               ? 'PDF downloaded! Note: Marathi text may not render correctly. Use Print for best quality.'
//               : `PDF downloaded successfully! (Font: ${fontName})`;
//             setSuccess(successMessage);
//             setTimeout(() => setSuccess(null), 5000);
//             setIsLoading(false);
//           });
//         } catch (syncError) {
//           // Handle synchronous errors
//           if (syncError && (
//             (typeof syncError === 'string' && syncError.includes('not found in virtual file system')) ||
//             (syncError.message && syncError.message.includes('not found in virtual file system'))
//           )) {
//             console.error('❌ Font error during PDF creation:', syncError);
//             if (fontName !== 'Roboto' && retryCount === 0) {
//               // Retry with Roboto
//               docDef.defaultStyle.font = 'Roboto';
//               Object.keys(docDef.styles || {}).forEach(styleKey => {
//                 if (docDef.styles[styleKey].font && docDef.styles[styleKey].font !== 'Courier') {
//                   docDef.styles[styleKey].font = 'Roboto';
//                 }
//               });
//               generatePdf(docDef, 'Roboto', 1, hasDevanagariText);
//             } else {
//               const errorMessage = hasDevanagariText
//                 ? 'Failed to generate PDF: Devanagari fonts not available. Please use the Print function for best Marathi text quality.'
//                 : `Failed to generate PDF: ${syncError.message || syncError}`;
//               setError(errorMessage);
//               setTimeout(() => setError(null), 7000);
//               setIsLoading(false);
//             }
//           } else {
//             throw syncError;
//           }
//         }
//       };
      
//       generatePdf(docDefinition, finalSelectedFont, 0, hasDevanagari);

//     } catch (err) {
//       console.error('Failed to generate PDF:', err);
//       setError(`Failed to download PDF: ${err.message}`);
//       setTimeout(() => setError(null), 5000);
//       setIsLoading(false);
//     }
//   };

//   // Print function - keep existing implementation
//   const handlePrintPdf = () => {
//     const element = markdownOutputRef.current;
//     if (!element) {
//       setError('No content to print.');
//       setTimeout(() => setError(null), 5000);
//       return;
//     }

//     try {
//       const clonedElement = element.cloneNode(true);
//       removeConversationalText(clonedElement);
      
//       const printWindow = window.open('', '_blank', 'width=800,height=600');
      
//       const htmlContent = `
//         <!DOCTYPE html>
//         <html>
//         <head>
//         <meta charset="UTF-8">
//         <title>AI Analysis Response - ${new Date().toLocaleDateString()}</title>
//         <style>
//         * {
//         margin: 0;
//         padding: 0;
//         box-sizing: border-box;
//         }
        
//         body {
//         font-family: 'Noto Sans Devanagari', 'Mukta', 'Mangal', 'Arial Unicode MS', 'Nirmala UI', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
//         padding: 20px;
//         background: white;
//         color: #000;
//         line-height: 1.6;
//         }
        
//         /* Ensure Devanagari text renders properly */
//         * {
//         font-variant-ligatures: normal;
//         text-rendering: optimizeLegibility;
//         }
        
//         @media print {
//         @page {
//         size: A4;
//         margin: 2cm;
//         }
        
//         body {
//         padding: 0;
//         }
        
//         h1, h2, h3, h4, h5, h6 {
//         page-break-after: avoid;
//         break-after: avoid;
//         }
        
//         table, pre, code, blockquote, img {
//         page-break-inside: avoid;
//         break-inside: avoid;
//         }
        
//         tr {
//         page-break-inside: avoid;
//         break-inside: avoid;
//         }
//         }
        
//         table {
//         width: 100%;
//         max-width: 100%;
//         border-collapse: collapse;
//         margin: 20px 0;
//         page-break-inside: auto;
//         table-layout: fixed;
//         word-wrap: break-word;
//         overflow-wrap: break-word;
//         }
        
//         thead {
//         display: table-header-group;
//         background-color: #f3f4f6;
//         }
        
//         th {
//         background-color: #f3f4f6;
//         color: #374151;
//         font-weight: 600;
//         text-align: left;
//         padding: 8px 10px;
//         border: 1px solid #d1d5db;
//         font-size: 10px;
//         text-transform: uppercase;
//         word-wrap: break-word;
//         overflow-wrap: break-word;
//         word-break: break-word;
//         hyphens: auto;
//         }
        
//         td {
//         padding: 8px 10px;
//         border: 1px solid #d1d5db;
//         color: #1f2937;
//         font-size: 11px;
//         word-wrap: break-word;
//         overflow-wrap: break-word;
//         word-break: break-word;
//         hyphens: auto;
//         overflow: hidden;
//         }
        
//         tbody tr:nth-child(even) {
//         background-color: #f9fafb;
//         }
        
//         h1 { font-size: 24px; font-weight: bold; margin: 24px 0 16px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }
//         h2 { font-size: 20px; font-weight: bold; margin: 20px 0 12px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
//         h3 { font-size: 18px; font-weight: 600; margin: 16px 0 10px; }
//         p { margin: 12px 0; font-size: 15px; line-height: 1.7; }
//         ul, ol { margin: 12px 0; padding-left: 24px; }
//         li { margin: 6px 0; }
//         pre { background: #1f2937; color: #f9fafb; padding: 16px; border-radius: 6px; margin: 16px 0; overflow-x: auto; }
//         code { background: #f3f4f6; color: #dc2626; padding: 2px 6px; border-radius: 3px; font-size: 13px; }
//         pre code { background: transparent; color: #f9fafb; padding: 0; }
//         blockquote { border-left: 4px solid #3b82f6; padding: 12px 16px; margin: 16px 0; background: #eff6ff; color: #1e40af; }
//         strong { font-weight: 700; }
//         a { color: #2563eb; text-decoration: underline; }
//         hr { border: none; border-top: 2px solid #e5e7eb; margin: 24px 0; }
//         </style>
//         </head>
//         <body>
//         ${clonedElement.innerHTML}
//         <script>
//         window.onload = function() {
//         setTimeout(() => {
//         window.print();
//         }, 500);
//         };
//         </script>
//         </body>
//         </html>
//       `;

//       printWindow.document.write(htmlContent);
//       printWindow.document.close();
      
//       setSuccess('Print dialog opened!');
//       setTimeout(() => setSuccess(null), 3000);
//     } catch (err) {
//       console.error('Failed to open print dialog:', err);
//       setError(`Failed to open print dialog: ${err.message}`);
//       setTimeout(() => setError(null), 5000);
//     }
//   };

//   return (
//     <>
//       <button
//         onClick={handleDownloadPdf}
//         disabled={isLoading}
//         className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
//         title="Download as PDF"
//       >
//         {isLoading ? (
//           <Loader2 className="h-4 w-4 animate-spin" />
//         ) : (
//           <Download className="h-4 w-4" />
//         )}
//       </button>
      
//       <button
//         onClick={handlePrintPdf}
//         disabled={isLoading}
//         className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
//         title="Print to PDF (Best Quality)"
//       >
//         <Printer className="h-4 w-4" />
//       </button>

//       {error && (
//         <div className="fixed bottom-4 right-4 z-50 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg shadow-lg text-sm max-w-md">
//           <div className="font-semibold mb-1">Error</div>
//           <div>{error}</div>
//         </div>
//       )}
      
//       {fontWarning && (
//         <div className="fixed bottom-4 right-4 z-50 bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg shadow-lg text-sm max-w-md">
//           <div className="font-semibold mb-1">⚠️ Font Warning</div>
//           <div>{fontWarning}</div>
//         </div>
//       )}
      
//       {success && (
//         <div className="fixed bottom-4 right-4 z-50 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg shadow-lg text-sm max-w-md">
//           <div className="font-semibold mb-1">Success</div>
//           <div>{success}</div>
//         </div>
//       )}
      
//     </>
//   );
// };

// export default DownloadPdf;


// import React, { useState } from 'react';
// import { Download, Printer, Loader2 } from 'lucide-react';

// /**
//  * Comprehensive Marathi PDF Generator
//  * This component replaces the problematic pdfmake-based solution
//  * with multiple working alternatives for Marathi text rendering
//  */
// const DownloadPdf = ({ markdownOutputRef, questionTitle }) => {
//   const [isGenerating, setIsGenerating] = useState(false);
//   const [error, setError] = useState(null);
//   const [success, setSuccess] = useState(null);
//   const [activeMethod, setActiveMethod] = useState('canvas'); // 'canvas', 'print'

//   // Detect Devanagari characters
//   const containsDevanagari = (text) => {
//     return /[\u0900-\u097F]/.test(text || '');
//   };

//   // Load external libraries dynamically
//   const loadLibraries = async () => {
//     const libraries = [];

//     if (!window.html2canvas) {
//       libraries.push(new Promise((resolve, reject) => {
//         const script = document.createElement('script');
//         script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
//         script.onload = resolve;
//         script.onerror = reject;
//         document.head.appendChild(script);
//       }));
//     }

//     // Check for jsPDF in different possible locations
//     const jsPDFLoaded = window.jsPDF || (window.jspdf && window.jspdf.jsPDF);
//     if (!jsPDFLoaded) {
//       libraries.push(new Promise((resolve, reject) => {
//         const script = document.createElement('script');
//         script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
//         script.onload = () => {
//           // Wait a bit for the library to initialize
//           setTimeout(() => {
//             if (window.jspdf || window.jsPDF) {
//               resolve();
//             } else {
//               reject(new Error('jsPDF failed to initialize'));
//             }
//           }, 100);
//         };
//         script.onerror = reject;
//         document.head.appendChild(script);
//       }));
//     }

//     if (libraries.length > 0) {
//       try {
//         await Promise.all(libraries);
//         console.log('✅ External libraries loaded successfully');
//       } catch (err) {
//         throw new Error(`Failed to load required libraries: ${err.message}`);
//       }
//     }
//   };

//   // Ensure Google Fonts are loaded
//   const ensureFontsLoaded = async () => {
//     // Add Crimson Text font link if not present
//     if (!document.querySelector('link[href*="Crimson+Text"]')) {
//       const crimsonLink = document.createElement('link');
//       crimsonLink.href = 'https://fonts.googleapis.com/css2?family=Crimson+Text:ital,wght@0,400;0,600;0,700;1,400;1,600;1,700&display=swap';
//       crimsonLink.rel = 'stylesheet';
//       document.head.appendChild(crimsonLink);
//     }
    
//     // Add Google Fonts link if not present
//     if (!document.querySelector('link[href*="Noto+Sans+Devanagari"]')) {
//       const fontLink = document.createElement('link');
//       fontLink.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;700&display=swap';
//       fontLink.rel = 'stylesheet';
//       document.head.appendChild(fontLink);
//     }

//     // Wait for fonts to load
//     if (document.fonts) {
//       await document.fonts.ready;
//       console.log('✅ Fonts loaded and ready');
//     }
//   };

//   // Prepare content for PDF generation
//   const prepareContent = () => {
//     const element = markdownOutputRef.current;
//     if (!element) {
//       throw new Error('No content available to generate PDF');
//     }

//     // Clone to avoid modifying original
//     const cloned = element.cloneNode(true);
    
//     // Remove conversational phrases
//     const conversationalPhrases = [
//       /^(Okay|Sure|Here'?s|I'?ll|Let me|I'?ve|Certainly|Of course|Absolutely|Great|Perfect|Alright),.*?\.(\s|$)/i
//     ];

//     const textNodes = [];
//     const walker = document.createTreeWalker(cloned, NodeFilter.SHOW_TEXT, null, false);
//     let node;
//     while (node = walker.nextNode()) {
//       textNodes.push(node);
//     }

//     textNodes.slice(0, 3).forEach(textNode => {
//       let text = textNode.textContent.trim();
//       conversationalPhrases.forEach(phrase => {
//         text = text.replace(phrase, '');
//       });
//       if (text !== textNode.textContent.trim()) {
//         textNode.textContent = text;
//         if (!textNode.textContent.trim()) {
//           const parent = textNode.parentElement;
//           if (parent && parent.tagName === 'P') {
//             parent.remove();
//           }
//         }
//       }
//     });

//     return cloned;
//   };

//   // Remove problematic CSS (oklch colors, etc.) that html2canvas can't handle
//   const sanitizeElementForCanvas = (element) => {
//     // Remove all class names to avoid Tailwind's oklch colors
//     const allElements = [element, ...element.querySelectorAll('*')];
    
//     allElements.forEach(el => {
//       // Remove class names
//       el.removeAttribute('class');
      
//       // Remove any inline styles that might contain oklch
//       if (el.style.cssText) {
//         const styles = el.style.cssText.split(';');
//         const safeStyles = styles.filter(style => {
//           const trimmed = style.trim();
//           if (!trimmed) return false;
//           // Remove any style containing oklch
//           if (trimmed.toLowerCase().includes('oklch')) return false;
//           return true;
//         });
//         el.style.cssText = safeStyles.join(';');
//       }
      
//       // Get computed styles and replace any oklch values
//       const computedStyle = window.getComputedStyle(el);
//       const styleProps = [
//         'color', 'backgroundColor', 'borderColor', 'borderTopColor',
//         'borderRightColor', 'borderBottomColor', 'borderLeftColor',
//         'outlineColor', 'textDecorationColor', 'columnRuleColor'
//       ];
      
//       styleProps.forEach(prop => {
//         try {
//           const value = computedStyle.getPropertyValue(prop);
//           if (value && value.toLowerCase().includes('oklch')) {
//             // Replace with a safe fallback color
//             if (prop === 'color') {
//               el.style.color = '#1f2937';
//             } else if (prop === 'backgroundColor') {
//               el.style.backgroundColor = '#ffffff';
//             } else if (prop.includes('border')) {
//               el.style[prop] = '#d1d5db';
//             } else {
//               el.style[prop] = '#1f2937';
//             }
//           }
//         } catch (e) {
//           // Ignore errors for unsupported properties
//         }
//       });
//     });
    
//     return element;
//   };

//   // Style element for better PDF rendering - matching AnalysisPage.css exactly
//   const styleElementForPdf = (element, hasDevanagari) => {
//     const fontStack = hasDevanagari 
//       ? '"Noto Sans Devanagari", "Arial Unicode MS", "Mangal", "Gargi", "Crimson Text", Georgia, "Times New Roman", serif'
//       : '"Crimson Text", Georgia, "Times New Roman", serif';

//     // Apply comprehensive styling - increased font size and spacing for PDF
//     element.style.fontFamily = fontStack;
//     element.style.backgroundColor = 'white';
//     element.style.color = '#111';
//     element.style.padding = '30px 50px';
//     element.style.paddingTop = '30px';
//     element.style.paddingBottom = '30px';
//     element.style.maxWidth = 'none';
//     element.style.width = '100%';
//     element.style.lineHeight = '1.8'; // Increased spacing
//     element.style.fontSize = '24px'; // Increased font size
//     element.style.margin = '0';

//     // Style headings - match AnalysisPage.css .response-content h2, h3
//     element.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
//       heading.style.fontFamily = fontStack;
//       heading.style.color = '#1a202c'; // Match AnalysisPage.css
//       heading.style.pageBreakAfter = 'avoid'; // Keep heading with following content
//       heading.style.pageBreakInside = 'avoid'; // Prevent heading from breaking
//       heading.style.breakInside = 'avoid'; // Modern CSS property
//       heading.style.breakAfter = 'avoid'; // Modern CSS property
//       heading.style.textAlign = 'left';
//       heading.style.orphans = '3';
//       heading.style.widows = '3';
//     });

//     // Set specific font sizes for headings - increased for PDF
//     element.querySelectorAll('h1').forEach(h1 => {
//       h1.style.fontSize = '2rem'; // Increased
//       h1.style.fontWeight = '700';
//       h1.style.marginTop = '2.5rem'; // Increased spacing
//       h1.style.marginBottom = '1.5rem'; // Increased spacing
//     });
//     element.querySelectorAll('h2').forEach(h2 => {
//       h2.style.fontSize = '1.7rem'; // Increased
//       h2.style.fontWeight = '700';
//       h2.style.marginTop = '2.5rem'; // Increased spacing
//       h2.style.marginBottom = '1.25rem'; // Increased spacing
//     });
//     element.querySelectorAll('h3').forEach(h3 => {
//       h3.style.fontSize = '1.5rem'; // Increased
//       h3.style.fontWeight = '600';
//       h3.style.marginTop = '2rem'; // Increased spacing
//       h3.style.marginBottom = '1rem'; // Increased spacing
//     });
//     element.querySelectorAll('h4').forEach(h4 => {
//       h4.style.fontSize = '1.3rem'; // Increased
//       h4.style.fontWeight = '600';
//       h4.style.marginTop = '1.75rem'; // Increased spacing
//       h4.style.marginBottom = '1rem'; // Increased spacing
//     });
//     element.querySelectorAll('h5').forEach(h5 => {
//       h5.style.fontSize = '1.2rem'; // Increased
//       h5.style.fontWeight = '600';
//       h5.style.marginTop = '1.5rem'; // Increased spacing
//       h5.style.marginBottom = '1rem'; // Increased spacing
//     });
//     element.querySelectorAll('h6').forEach(h6 => {
//       h6.style.fontSize = '1.1rem'; // Increased
//       h6.style.fontWeight = '600';
//       h6.style.marginTop = '1.5rem'; // Increased spacing
//       h6.style.marginBottom = '1rem'; // Increased spacing
//     });

//     // Style paragraphs - increased font size and spacing for PDF
//     element.querySelectorAll('p').forEach(p => {
//       p.style.marginBottom = '1.25rem'; // Increased spacing
//       p.style.lineHeight = '1.8'; // Increased spacing
//       p.style.textAlign = 'left';
//       p.style.color = '#111827';
//       p.style.fontSize = '20px'; // Increased font size
//       p.style.fontFamily = fontStack;
//       p.style.pageBreakInside = 'avoid'; // Prevent paragraph from breaking
//       p.style.breakInside = 'avoid'; // Modern CSS property
//       p.style.pageBreakAfter = 'auto';
//       p.style.orphans = '4';
//       p.style.widows = '4';
//     });

//     // Style tables - match AnalysisPage.css .prose table exactly
//     element.querySelectorAll('table').forEach(table => {
//       table.style.width = '100%';
//       table.style.maxWidth = '100%';
//       table.style.borderCollapse = 'collapse';
//       table.style.marginTop = '1.5rem'; // Match AnalysisPage.css
//       table.style.marginBottom = '1.5rem'; // Match AnalysisPage.css
//       table.style.pageBreakInside = 'auto';
//       table.style.fontSize = '18px'; // Keep table font size unchanged (as requested)
//       table.style.fontFamily = fontStack; // Match .prose table - "Crimson Text"
//       table.style.tableLayout = 'auto';
//       table.style.wordWrap = 'break-word';
//       table.style.overflowWrap = 'break-word';
//       table.style.border = '1px solid #d1d5db';
//       table.style.borderRadius = '8px';
//       table.style.overflow = 'hidden';
      
//       // Allow table to break across pages but keep rows together
//       table.querySelectorAll('tr').forEach(tr => {
//         tr.style.pageBreakInside = 'avoid'; // Prevent row from breaking
//         tr.style.breakInside = 'avoid'; // Modern CSS property
//         tr.style.display = 'table-row'; // Ensure rows stay together
//         tr.style.pageBreakAfter = 'auto';
//       });
      
//       // Prevent table cells from breaking
//       table.querySelectorAll('td, th').forEach(cell => {
//         cell.style.pageBreakInside = 'avoid';
//         cell.style.breakInside = 'avoid';
//       });
      
//       // Style table headers - keep table font size unchanged
//       table.querySelectorAll('th').forEach(th => {
//         th.style.border = '1px solid #e5e7eb';
//         th.style.padding = '0.9rem 1rem'; // Match .analysis-table th
//         th.style.textAlign = 'left';
//         th.style.fontSize = '16px'; // Keep table font size unchanged (as requested)
//         th.style.fontWeight = '600'; // Match .prose th
//         th.style.lineHeight = '1.6';
//         th.style.fontFamily = fontStack; // Match .prose th - "Crimson Text"
//         th.style.verticalAlign = 'middle';
//         th.style.backgroundColor = '#f3f4f6'; // Match .analysis-table th
//         th.style.color = '#374151'; // Match .analysis-table th
//         th.style.wordWrap = 'break-word';
//         th.style.overflowWrap = 'break-word';
//       });
      
//       // Style table cells - keep table font size unchanged
//       table.querySelectorAll('td').forEach(td => {
//         td.style.border = '1px solid #e5e7eb';
//         td.style.padding = '0.8rem 1rem'; // Match .analysis-table td
//         td.style.textAlign = 'left';
//         td.style.fontSize = '16px'; // Keep table font size unchanged (as requested)
//         td.style.lineHeight = '1.6';
//         td.style.fontFamily = fontStack; // Match .prose td - "Crimson Text"
//         td.style.verticalAlign = 'middle';
//         td.style.color = '#111827'; // Match .analysis-table td
//         td.style.backgroundColor = '#ffffff';
//         td.style.wordWrap = 'break-word';
//         td.style.overflowWrap = 'break-word';
//         td.style.wordBreak = 'break-word';
//         td.style.whiteSpace = 'normal';
//       });
      
//       // Alternate row shading - match .analysis-table tbody tr:nth-child(even)
//       table.querySelectorAll('tbody tr:nth-child(even) td').forEach(td => {
//         td.style.backgroundColor = '#fafafa';
//       });
      
//       // Ensure thead repeats on each page
//       const thead = table.querySelector('thead');
//       if (thead) {
//         thead.style.display = 'table-header-group';
//         thead.style.backgroundColor = '#f9fafb'; // Match .analysis-table thead
//       }
//     });

//     // Style lists - increased font size and spacing for PDF
//     element.querySelectorAll('ul, ol').forEach(list => {
//       list.style.marginBottom = '1.5rem'; // Increased spacing
//       list.style.marginTop = '1rem'; // Increased spacing
//       list.style.paddingLeft = '40px'; // Increased spacing
//       list.style.fontFamily = fontStack;
//       list.style.pageBreakInside = 'avoid';
      
//       list.querySelectorAll('li').forEach(item => {
//         item.style.marginBottom = '12px'; // Increased spacing
//         item.style.lineHeight = '1.8'; // Increased spacing
//         item.style.color = '#111827';
//         item.style.fontSize = '20px'; // Increased font size
//         item.style.pageBreakInside = 'avoid'; // Prevent list item from breaking
//         item.style.breakInside = 'avoid'; // Modern CSS property
//         item.style.orphans = '2';
//         item.style.widows = '2';
//       });
//     });

//     // Style code blocks
//     element.querySelectorAll('pre').forEach(pre => {
//       pre.style.backgroundColor = '#f8f9fa';
//       pre.style.border = '1px solid #e9ecef';
//       pre.style.borderRadius = '6px';
//       pre.style.padding = '16px';
//       pre.style.fontFamily = '"Courier New", monospace';
//       pre.style.fontSize = '12px';
//       pre.style.overflow = 'auto';
//       pre.style.margin = '16px 0';
//       pre.style.pageBreakInside = 'avoid';
//     });

//     // Style inline code
//     element.querySelectorAll('code:not(pre code)').forEach(code => {
//       code.style.backgroundColor = '#f1f3f4';
//       code.style.padding = '2px 6px';
//       code.style.borderRadius = '3px';
//       code.style.fontFamily = '"Courier New", monospace';
//       code.style.fontSize = '13px';
//     });

//     // Style blockquotes
//     element.querySelectorAll('blockquote').forEach(bq => {
//       bq.style.borderLeft = '4px solid #2563eb';
//       bq.style.paddingLeft = '16px';
//       bq.style.fontStyle = 'italic';
//       bq.style.backgroundColor = '#f0f8ff';
//       bq.style.padding = '12px 16px';
//       bq.style.margin = '16px 0';
//       bq.style.pageBreakInside = 'avoid';
//     });

//     return element;
//   };

//   // Method 1: Canvas-based PDF generation
//   const generateCanvasPdf = async () => {
//     setIsGenerating(true);
//     setError(null);
//     setSuccess(null);
//     setActiveMethod('canvas');

//     try {
//       // Load libraries
//       await loadLibraries();
//       await ensureFontsLoaded();

//       // Prepare and style content
//       const contentElement = prepareContent();
//       const hasDevanagari = containsDevanagari(contentElement.textContent);
      
//       if (hasDevanagari) {
//         console.log('🔤 Devanagari text detected - optimizing for Unicode rendering');
//       }

//       // Preserve original element styling first, then apply PDF styles
//       // Clone the element to preserve original appearance
//       const originalElement = markdownOutputRef.current;
//       if (!originalElement) {
//         throw new Error('No content available to generate PDF');
//       }
      
//       // Get computed styles from original element to preserve appearance
//       const computedStyles = window.getComputedStyle(originalElement);
      
//       // Sanitize element to remove oklch colors and problematic CSS
//       const sanitizedElement = sanitizeElementForCanvas(contentElement);
//       const styledElement = styleElementForPdf(sanitizedElement, hasDevanagari);
      
//       // Preserve original width and styling from the response panel
//       styledElement.style.width = '100%';
//       styledElement.style.maxWidth = 'none';
//       styledElement.style.margin = '0';
//       styledElement.style.paddingTop = '20px';
//       styledElement.style.paddingBottom = '20px';

//       // Create temporary container
//       const tempContainer = document.createElement('div');
//       tempContainer.style.position = 'absolute';
//       tempContainer.style.left = '-9999px';
//       tempContainer.style.top = '0';
//       tempContainer.style.width = '800px';
//       tempContainer.style.backgroundColor = 'white';
//       tempContainer.style.padding = '0';
//       tempContainer.style.margin = '0';
//       tempContainer.appendChild(styledElement);
//       document.body.appendChild(tempContainer);

//       // Yield to browser to prevent unresponsive page
//       await new Promise(resolve => setTimeout(resolve, 50));

//       // Generate high-quality canvas with progress updates
//       const canvas = await new Promise((resolve, reject) => {
//         // Show progress indicator
//         const progressInterval = setInterval(() => {
//           // Keep UI responsive by yielding control
//           if (document.body) {
//             document.body.style.cursor = 'wait';
//           }
//         }, 100);

//         window.html2canvas(styledElement, {
//           scale: 2, // High resolution for crisp text
//           useCORS: true,
//           allowTaint: false,
//           backgroundColor: '#ffffff',
//           logging: false,
//           letterRendering: true,
//           width: 800,
//           height: styledElement.scrollHeight,
//           onclone: (clonedDoc) => {
//             // Ensure fonts are applied in cloned document
//             const clonedBody = clonedDoc.body;
//           const fontStack = hasDevanagari 
//             ? '"Noto Sans Devanagari", "Arial Unicode MS", "Mangal", "Gargi", "Crimson Text", Georgia, "Times New Roman", serif'
//             : '"Crimson Text", Georgia, "Times New Roman", serif';
//           clonedBody.style.fontFamily = fontStack;
          
//           // Additional sanitization in cloned document
//           const allElements = [clonedBody, ...clonedBody.querySelectorAll('*')];
//           allElements.forEach(el => {
//             // Remove class names
//             el.removeAttribute('class');
            
//             // Remove any style attributes containing oklch
//             if (el.hasAttribute('style')) {
//               const styleAttr = el.getAttribute('style');
//               if (styleAttr && styleAttr.toLowerCase().includes('oklch')) {
//                 const safeStyles = styleAttr.split(';').filter(s => 
//                   s.trim() && !s.toLowerCase().includes('oklch')
//                 );
//                 if (safeStyles.length > 0) {
//                   el.setAttribute('style', safeStyles.join(';'));
//                 } else {
//                   el.removeAttribute('style');
//                 }
//               }
//             }
            
//             // Check computed styles and replace oklch values
//             try {
//               const computedStyle = clonedDoc.defaultView.getComputedStyle(el);
//               const colorProps = ['color', 'backgroundColor', 'borderColor'];
//               colorProps.forEach(prop => {
//                 try {
//                   const value = computedStyle.getPropertyValue(prop);
//                   if (value && value.toLowerCase().includes('oklch')) {
//                     if (prop === 'color') {
//                       el.style.color = '#1f2937';
//                     } else if (prop === 'backgroundColor') {
//                       el.style.backgroundColor = '#ffffff';
//                     } else if (prop === 'borderColor') {
//                       el.style.borderColor = '#d1d5db';
//                     }
//                   }
//                 } catch (e) {
//                   // Ignore errors
//                 }
//               });
//             } catch (e) {
//               // Ignore errors
//             }
//           });
//         }
//         })
//           .then(canvas => {
//             clearInterval(progressInterval);
//             if (document.body) {
//               document.body.style.cursor = 'default';
//             }
//             resolve(canvas);
//           })
//           .catch(err => {
//             clearInterval(progressInterval);
//             if (document.body) {
//               document.body.style.cursor = 'default';
//             }
//             reject(err);
//           });
//       });

//       // Clean up
//       document.body.removeChild(tempContainer);
      
//       // Yield again before heavy PDF operations
//       await new Promise(resolve => setTimeout(resolve, 50));

//       // Create PDF - handle different jsPDF exposure patterns
//       let jsPDF;
//       if (window.jspdf && window.jspdf.jsPDF) {
//         // UMD bundle exposes as window.jspdf.jsPDF
//         jsPDF = window.jspdf.jsPDF;
//       } else if (window.jsPDF && typeof window.jsPDF === 'function') {
//         // Direct constructor
//         jsPDF = window.jsPDF;
//       } else if (window.jsPDF && window.jsPDF.jsPDF) {
//         // Object with jsPDF property
//         jsPDF = window.jsPDF.jsPDF;
//       } else {
//         throw new Error('jsPDF library not loaded correctly. Please refresh the page and try again.');
//       }

//       const pdf = new jsPDF({
//         orientation: 'portrait',
//         unit: 'mm',
//         format: 'a4'
//       });

//       // Calculate dimensions with proper top and bottom margins
//       const imgData = canvas.toDataURL('image/png', 1.0);
//       const pdfWidth = pdf.internal.pageSize.getWidth();
//       const pdfHeight = pdf.internal.pageSize.getHeight();
//       const topMargin = 25; // 25mm top margin
//       const bottomMargin = 25; // 25mm bottom margin
//       const sideMargin = 15; // 15mm side margins
//       const imgWidth = pdfWidth - (sideMargin * 2);
//       const imgHeight = (canvas.height * imgWidth) / canvas.width;
//       const usableHeight = pdfHeight - topMargin - bottomMargin;

//       // Add content to PDF (handle multiple pages with proper margins and table row protection)
//       let totalHeight = imgHeight;
//       let yPosition = topMargin;
//       let heightLeft = totalHeight;

//       // Buffer zone to avoid cutting table rows and text (in mm)
//       const rowProtectionBuffer = 30; // Increased buffer to avoid cutting rows and paragraphs

//       // Add first page
//       if (totalHeight <= usableHeight) {
//         // Content fits on one page
//         pdf.addImage(imgData, 'PNG', sideMargin, yPosition, imgWidth, totalHeight, '', 'FAST');
//       } else {
//         // Content spans multiple pages - smart slicing with buffer zones to avoid cutting table rows
//         let sourceY = 0; // Track position in source image (in mm)
        
//         while (heightLeft > 0) {
//           if (sourceY > 0) {
//             pdf.addPage();
//             yPosition = topMargin;
//           }
          
//           // Calculate how much fits on this page
//           // Use a buffer zone near the end to avoid cutting table rows
//           let heightOnPage = Math.min(heightLeft, usableHeight - rowProtectionBuffer);
          
//           // If we're near the end of content, use full height
//           if (heightLeft <= usableHeight) {
//             heightOnPage = heightLeft;
//           }
          
//           // Ensure minimum height
//           if (heightOnPage < 20) {
//             heightOnPage = Math.min(heightLeft, usableHeight);
//           }
          
//           // Calculate source position in pixels
//           const sourceYInPixelsFinal = (sourceY / imgWidth) * canvas.width;
//           const heightInPixels = (heightOnPage / imgWidth) * canvas.width;
          
//           // Create a temporary canvas for this slice
//           const sliceCanvas = document.createElement('canvas');
//           sliceCanvas.width = canvas.width;
//           sliceCanvas.height = heightInPixels;
//           const sliceCtx = sliceCanvas.getContext('2d');
//           sliceCtx.drawImage(canvas, 0, sourceYInPixelsFinal, canvas.width, heightInPixels, 0, 0, canvas.width, heightInPixels);
          
//           // Convert slice to image
//           const sliceImgData = sliceCanvas.toDataURL('image/png', 1.0);
          
//           // Add slice to PDF
//           pdf.addImage(sliceImgData, 'PNG', sideMargin, yPosition, imgWidth, heightOnPage, '', 'FAST');
          
//           // Move to next slice
//           sourceY += heightOnPage;
//           heightLeft -= heightOnPage;
          
//           // Yield control periodically to prevent blocking and show progress
//           if (heightLeft > 0) {
//             await new Promise(resolve => setTimeout(resolve, 20));
//           }
//         }
//       }

//       // Generate filename
//       const timestamp = new Date().toISOString().slice(0, 10);
//       const cleanTitle = questionTitle
//         ? questionTitle.replace(/[^a-zA-Z0-9_ -]/g, '').replace(/\s+/g, '_').substring(0, 50)
//         : 'Jurinex Response';
//       const filename = `${cleanTitle}_${timestamp}.pdf`;

//       // Download
//       pdf.save(filename);

//       const message = hasDevanagari 
//         ? 'PDF generated successfully! ✅ Marathi text rendered properly using system fonts.'
//         : 'PDF generated successfully!';
      
//       setSuccess(message);
//       setTimeout(() => setSuccess(null), 4000);

//     } catch (err) {
//       console.error('Canvas PDF generation failed:', err);
//       setError(`PDF generation failed: ${err.message}`);
//       setTimeout(() => setError(null), 5000);
//     } finally {
//       setIsGenerating(false);
//     }
//   };

//   // Method 2: Enhanced print function
//   const handleEnhancedPrint = () => {
//     const element = markdownOutputRef.current;
//     if (!element) {
//       setError('No content to print.');
//       return;
//     }

//     setActiveMethod('print');

//     try {
//       const hasDevanagari = containsDevanagari(element.textContent);
//       const printWindow = window.open('', '_blank', 'width=800,height=600');
      
//       const htmlContent = `
//         <!DOCTYPE html>
//         <html lang="${hasDevanagari ? 'mr' : 'en'}">
//         <head>
//           <meta charset="UTF-8">
//           <meta name="viewport" content="width=device-width, initial-scale=1.0">
//           <title>${questionTitle || 'Document'}</title>
//           <link href="https://fonts.googleapis.com/css2?family=Crimson+Text:ital,wght@0,400;0,600;0,700;1,400;1,600;1,700&display=swap" rel="stylesheet">
//           <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;700&display=swap" rel="stylesheet">
//           <style>
//             * { margin: 0; padding: 0; box-sizing: border-box; }
            
//             body {
//               font-family: ${hasDevanagari 
//                 ? '"Noto Sans Devanagari", "Arial Unicode MS", "Mangal", "Gargi", "Crimson Text", Georgia, "Times New Roman", serif' 
//                 : '"Crimson Text", Georgia, "Times New Roman", serif'
//               };
//               line-height: 1.8;
//               color: #111;
//               background: white;
//               padding: 2.5cm 2cm;
//               font-size: 24px;
//               text-rendering: optimizeLegibility;
//               font-variant-ligatures: normal;
//               orphans: 4;
//               widows: 4;
//             }
            
//             @page {
//               size: A4;
//               margin: 2cm;
//             }
            
//             @media print {
//               body { padding: 0; }
//               h1, h2, h3, h4, h5, h6 { 
//                 page-break-after: avoid !important; 
//                 page-break-inside: avoid !important;
//                 break-after: avoid !important;
//                 break-inside: avoid !important;
//                 orphans: 3;
//                 widows: 3;
//               }
//               p {
//                 page-break-inside: avoid !important;
//                 break-inside: avoid !important;
//                 orphans: 4;
//                 widows: 4;
//               }
//               li {
//                 page-break-inside: avoid !important;
//                 break-inside: avoid !important;
//                 orphans: 2;
//                 widows: 2;
//               }
//               tr {
//                 page-break-inside: avoid !important;
//                 break-inside: avoid !important;
//                 display: table-row !important;
//                 page-break-after: auto;
//               }
//               td, th {
//                 page-break-inside: avoid !important;
//                 break-inside: avoid !important;
//               }
//               table {
//                 page-break-inside: auto;
//                 page-break-before: auto;
//                 page-break-after: auto;
//               }
//               tbody tr {
//                 page-break-inside: avoid !important;
//                 break-inside: avoid !important;
//               }
//               thead tr {
//                 page-break-inside: avoid !important;
//                 break-inside: avoid !important;
//               }
//               thead { 
//                 display: table-header-group; 
//               }
//               tfoot { 
//                 display: table-footer-group; 
//               }
//               pre, blockquote { page-break-inside: avoid; }
//             }
            
//             h1, h2, h3, h4, h5, h6 {
//               color: #000000;
//               font-weight: 700;
//               font-family: "Crimson Text", Georgia, "Times New Roman", serif;
//             }
            
//             h1 { 
//               font-size: 2rem; 
//               font-weight: 700;
//               text-align: left; 
//               margin: 2.5rem 0 1.5rem 0;
//               color: #1a202c;
//             }
//             h2 { 
//               font-size: 1.7rem; 
//               font-weight: 700;
//               text-align: left;
//               margin: 2.5rem 0 1.25rem 0;
//               color: #1a202c;
//             }
//             h3 { 
//               font-size: 1.5rem; 
//               font-weight: 600;
//               text-align: left;
//               margin: 2rem 0 1rem 0;
//               color: #1a202c;
//             }
//             h4 { 
//               font-size: 1.3rem; 
//               font-weight: 600;
//               text-align: left;
//               margin: 1.75rem 0 1rem 0;
//               color: #1a202c;
//             }
//             h5 { 
//               font-size: 1.2rem; 
//               font-weight: 600;
//               text-align: left;
//               margin: 1.5rem 0 1rem 0;
//               color: #1a202c;
//             }
//             h6 { 
//               font-size: 1.1rem; 
//               font-weight: 600;
//               text-align: left;
//               margin: 1.5rem 0 1rem 0;
//               color: #1a202c;
//             }
            
//             p { 
//               margin: 0 0 1.25rem 0; 
//               text-align: left; 
//               line-height: 1.8; 
//               color: #111827; 
//               font-size: 20px;
//               font-family: "Crimson Text", Georgia, "Times New Roman", serif;
//             }
//             ul, ol { 
//               margin: 1rem 0 1.5rem 0; 
//               padding-left: 40px; 
//               font-family: "Crimson Text", Georgia, "Times New Roman", serif;
//             }
//             li { 
//               margin: 0 0 12px 0; 
//               line-height: 1.8;
//               color: #111827;
//               font-size: 20px;
//             }
            
//             table {
//               width: 100%;
//               max-width: 100%;
//               border-collapse: collapse;
//               margin: 1.5rem 0;
//               font-size: 18px;
//               font-family: "Crimson Text", Georgia, "Times New Roman", serif;
//               page-break-inside: auto;
//               table-layout: auto;
//               word-wrap: break-word;
//               overflow-wrap: break-word;
//               border: 1px solid #d1d5db;
//               border-radius: 8px;
//               overflow: hidden;
//             }
            
//             thead {
//               background-color: #f9fafb;
//             }
            
//             th {
//               border: 1px solid #e5e7eb;
//               padding: 0.9rem 1rem;
//               text-align: left;
//               line-height: 1.6;
//               font-family: "Crimson Text", Georgia, "Times New Roman", serif;
//               vertical-align: middle;
//               background-color: #f3f4f6;
//               color: #374151;
//               font-weight: 600;
//               font-size: 16px;
//               word-wrap: break-word;
//               overflow-wrap: break-word;
//             }
            
//             td {
//               border: 1px solid #e5e7eb;
//               padding: 0.8rem 1rem;
//               text-align: left;
//               line-height: 1.6;
//               font-family: "Crimson Text", Georgia, "Times New Roman", serif;
//               vertical-align: middle;
//               color: #111827;
//               background-color: #ffffff;
//               font-size: 16px;
//               word-wrap: break-word;
//               overflow-wrap: break-word;
//               word-break: break-word;
//               white-space: normal;
//             }
            
//             tbody tr:nth-child(even) td {
//               background-color: #fafafa;
//             }
            
//             tr:nth-child(even) { background-color: #f9fafb; }
            
//             thead {
//               display: table-header-group;
//             }
            
//             pre {
//               background-color: #f8f9fa;
//               border: 1px solid #e9ecef;
//               border-radius: 4px;
//               padding: 1em;
//               font-family: 'Courier New', monospace;
//               font-size: 9pt;
//               margin: 1em 0;
//             }
            
//             code:not(pre code) {
//               background-color: #f1f3f4;
//               padding: 2px 4px;
//               border-radius: 3px;
//               font-family: 'Courier New', monospace;
//             }
            
//             blockquote {
//               border-left: 4px solid #2563eb;
//               padding: 1em;
//               margin: 1em 0;
//               background-color: #f0f8ff;
//               font-style: italic;
//             }
            
//             strong { font-weight: bold; }
//             em { font-style: italic; }
//           </style>
//         </head>
//         <body>
//           ${element.innerHTML}
//           <script>
//             window.onload = function() {
//               if (document.fonts) {
//                 document.fonts.ready.then(() => {
//                   setTimeout(() => window.print(), 800);
//                 });
//               } else {
//                 setTimeout(() => window.print(), 1200);
//               }
//             };
//           </script>
//         </body>
//         </html>
//       `;

//       printWindow.document.write(htmlContent);
//       printWindow.document.close();
      
//       setSuccess('Print dialog opened! 🖨️ System fonts will provide excellent Marathi rendering.');
//       setTimeout(() => setSuccess(null), 3000);

//     } catch (err) {
//       setError(`Print failed: ${err.message}`);
//       setTimeout(() => setError(null), 3000);
//     }
//   };


//   return (
//     <>
//       {/* Canvas PDF Generation Button */}
//       <button
//         onClick={generateCanvasPdf}
//         disabled={isGenerating && activeMethod === 'canvas'}
//         className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
//         title="Generate PDF using Canvas (Best for Marathi)"
//       >
//         {isGenerating && activeMethod === 'canvas' ? (
//           <Loader2 className="h-4 w-4 animate-spin" />
//         ) : (
//           <Download className="h-4 w-4" />
//         )}
//       </button>

//       {/* Enhanced Print Button */}
//       <button
//         onClick={handleEnhancedPrint}
//         disabled={isGenerating}
//         className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
//         title="Print with System Fonts (Excellent Marathi Support)"
//       >
//         <Printer className="h-4 w-4" />
//       </button>

//       {/* Status Messages */}
//       {error && (
//         <div className="fixed bottom-4 right-4 z-50 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg shadow-lg text-sm max-w-sm">
//           <div className="font-semibold mb-1">❌ Error</div>
//           <div className="text-xs">{error}</div>
//         </div>
//       )}

//       {success && (
//         <div className="fixed bottom-4 right-4 z-50 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg shadow-lg text-sm max-w-sm">
//           <div className="font-semibold mb-1">✅ Success</div>
//           <div className="text-xs">{success}</div>
//         </div>
//       )}
//     </>
//   );
// };

// export default DownloadPdf;


import React, { useState } from 'react';
import { Download, Printer, Loader2 } from 'lucide-react';

/**
 * Professional PDF Generator with Smart Page Break Handling
 * - Prevents text and table rows from being cut at page boundaries
 * - Uses Times New Roman font family
 * - Light grey table headers
 * - Larger font sizes for better readability
 */
const DownloadPdf = ({ markdownOutputRef, questionTitle }) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [activeMethod, setActiveMethod] = useState('canvas');

  // Detect Devanagari characters
  const containsDevanagari = (text) => {
    return /[\u0900-\u097F]/.test(text || '');
  };

  // Load external libraries dynamically
  const loadLibraries = async () => {
    const libraries = [];

    if (!window.html2canvas) {
      libraries.push(new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      }));
    }

    const jsPDFLoaded = window.jsPDF || (window.jspdf && window.jspdf.jsPDF);
    if (!jsPDFLoaded) {
      libraries.push(new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        script.onload = () => {
          setTimeout(() => {
            if (window.jspdf || window.jsPDF) {
              resolve();
            } else {
              reject(new Error('jsPDF failed to initialize'));
            }
          }, 100);
        };
        script.onerror = reject;
        document.head.appendChild(script);
      }));
    }

    if (libraries.length > 0) {
      try {
        await Promise.all(libraries);
        console.log('✅ External libraries loaded successfully');
      } catch (err) {
        throw new Error(`Failed to load required libraries: ${err.message}`);
      }
    }
  };

  // Ensure fonts are loaded
  const ensureFontsLoaded = async () => {
    // Add Noto Sans Devanagari for Marathi text
    if (!document.querySelector('link[href*="Noto+Sans+Devanagari"]')) {
      const fontLink = document.createElement('link');
      fontLink.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap';
      fontLink.rel = 'stylesheet';
      document.head.appendChild(fontLink);
    }

    if (document.fonts) {
      await document.fonts.ready;
      console.log('✅ Fonts loaded and ready');
    }
  };

  // Prepare content for PDF generation
  const prepareContent = () => {
    const element = markdownOutputRef.current;
    if (!element) {
      throw new Error('No content available to generate PDF');
    }

    const cloned = element.cloneNode(true);
    
    // Remove conversational phrases
    const conversationalPhrases = [
      /^(Okay|Sure|Here'?s|I'?ll|Let me|I'?ve|Certainly|Of course|Absolutely|Great|Perfect|Alright),.*?\.(\s|$)/i
    ];

    const textNodes = [];
    const walker = document.createTreeWalker(cloned, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while (node = walker.nextNode()) {
      textNodes.push(node);
    }

    textNodes.slice(0, 3).forEach(textNode => {
      let text = textNode.textContent.trim();
      conversationalPhrases.forEach(phrase => {
        text = text.replace(phrase, '');
      });
      if (text !== textNode.textContent.trim()) {
        textNode.textContent = text;
        if (!textNode.textContent.trim()) {
          const parent = textNode.parentElement;
          if (parent && parent.tagName === 'P') {
            parent.remove();
          }
        }
      }
    });

    return cloned;
  };

  // Sanitize element for canvas - remove oklch colors
  const sanitizeElementForCanvas = (element) => {
    const allElements = [element, ...element.querySelectorAll('*')];
    
    allElements.forEach(el => {
      el.removeAttribute('class');
      
      if (el.style.cssText) {
        const styles = el.style.cssText.split(';');
        const safeStyles = styles.filter(style => {
          const trimmed = style.trim();
          if (!trimmed) return false;
          if (trimmed.toLowerCase().includes('oklch')) return false;
          return true;
        });
        el.style.cssText = safeStyles.join(';');
      }
      
      const computedStyle = window.getComputedStyle(el);
      const styleProps = [
        'color', 'backgroundColor', 'borderColor', 'borderTopColor',
        'borderRightColor', 'borderBottomColor', 'borderLeftColor',
        'outlineColor', 'textDecorationColor', 'columnRuleColor'
      ];
      
      styleProps.forEach(prop => {
        try {
          const value = computedStyle.getPropertyValue(prop);
          if (value && value.toLowerCase().includes('oklch')) {
            if (prop === 'color') {
              el.style.color = '#505050'; // Slightly lighter grey
            } else if (prop === 'backgroundColor') {
              el.style.backgroundColor = '#ffffff';
            } else if (prop.includes('border')) {
              el.style[prop] = '#d1d5db';
            } else {
              el.style[prop] = '#1a1a1a';
            }
          }
        } catch (e) {
          // Ignore errors
        }
      });
    });
    
    return element;
  };

  // Professional styling for PDF - Times New Roman, light grey headers, larger fonts
  const styleElementForPdf = (element, hasDevanagari) => {
    // Times New Roman font stack with Devanagari fallback
    const fontStack = hasDevanagari 
      ? '"Noto Sans Devanagari", "Times New Roman", Times, serif'
      : '"Times New Roman", Times, Georgia, serif';

    // Root element styling - Times New Roman font
    element.style.fontFamily = fontStack;
    element.style.backgroundColor = '#ffffff';
    element.style.color = '#505050'; // Slightly lighter grey
    element.style.padding = '45px 50px';
    element.style.maxWidth = 'none';
    element.style.width = '100%';
    element.style.lineHeight = '1.8';
    element.style.fontSize = '20px'; // Keep font size as is
    element.style.margin = '0';
    element.style.textRendering = 'optimizeLegibility';
    element.style.WebkitFontSmoothing = 'antialiased';

    // Style headings - Times New Roman font
    element.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
      heading.style.fontFamily = fontStack;
      heading.style.color = '#444444'; // Slightly lighter grey
      heading.style.pageBreakAfter = 'avoid';
      heading.style.pageBreakInside = 'avoid';
      heading.style.breakInside = 'avoid';
      heading.style.breakAfter = 'avoid';
      heading.style.textAlign = 'left';
      heading.style.orphans = '4';
      heading.style.widows = '4';
    });

    // Heading sizes - larger for better readability
    element.querySelectorAll('h1').forEach(h1 => {
      h1.style.fontSize = '32px'; // Keep font size as is
      h1.style.fontWeight = '700';
      h1.style.marginTop = '30px';
      h1.style.marginBottom = '20px';
      h1.style.borderBottom = '2px solid #444444'; // Match heading color
      h1.style.paddingBottom = '10px';
    });
    
    element.querySelectorAll('h2').forEach(h2 => {
      h2.style.fontSize = '28px'; // Keep font size as is
      h2.style.fontWeight = '700';
      h2.style.marginTop = '28px';
      h2.style.marginBottom = '16px';
      h2.style.color = '#444444'; // Slightly lighter grey
    });
    
    element.querySelectorAll('h3').forEach(h3 => {
      h3.style.fontSize = '24px'; // Keep font size as is
      h3.style.fontWeight = '600';
      h3.style.marginTop = '24px';
      h3.style.marginBottom = '14px';
      h3.style.color = '#464646'; // Slightly lighter grey
    });
    
    element.querySelectorAll('h4').forEach(h4 => {
      h4.style.fontSize = '22px'; // Keep font size as is
      h4.style.fontWeight = '600';
      h4.style.marginTop = '20px';
      h4.style.marginBottom = '12px';
      h4.style.color = '#484848'; // Slightly lighter grey
    });
    
    element.querySelectorAll('h5, h6').forEach(h => {
      h.style.fontSize = '20px'; // Keep font size as is
      h.style.fontWeight = '600';
      h.style.marginTop = '18px';
      h.style.marginBottom = '10px';
      h.style.color = '#4a4a4a'; // Slightly lighter grey
    });

    // Style paragraphs - Times New Roman font
    element.querySelectorAll('p').forEach(p => {
      p.style.marginBottom = '14px';
      p.style.lineHeight = '1.8';
      p.style.textAlign = 'justify';
      p.style.textJustify = 'inter-word';
      p.style.color = '#505050'; // Slightly lighter grey
      p.style.fontSize = '20px'; // Keep font size as is
      p.style.fontFamily = fontStack;
      p.style.orphans = '4';
      p.style.widows = '4';
    });

    // Style tables - LIGHT GREY headers, larger font
    element.querySelectorAll('table').forEach(table => {
      table.style.width = '100%';
      table.style.maxWidth = '100%';
      table.style.borderCollapse = 'collapse';
      table.style.marginTop = '20px';
      table.style.marginBottom = '20px';
      table.style.fontSize = '18px'; // Increased table font from 16px
      table.style.fontFamily = fontStack;
      table.style.tableLayout = 'fixed';
      table.style.wordWrap = 'break-word';
      table.style.overflowWrap = 'break-word';
      table.style.border = '1px solid #999999';
      
      // Style table rows - prevent breaking
      table.querySelectorAll('tr').forEach((tr, index) => {
        tr.style.pageBreakInside = 'avoid';
        tr.style.breakInside = 'avoid';
        tr.style.display = 'table-row';
        
        // Alternate row colors
        if (index > 0 && index % 2 === 0) {
          tr.querySelectorAll('td').forEach(td => {
            if (!td.style.backgroundColor || td.style.backgroundColor === '#ffffff') {
              td.style.backgroundColor = '#f9f9f9';
            }
          });
        }
      });
      
      // Style table headers - LIGHT GREY background (remove any blue colors)
      table.querySelectorAll('th').forEach(th => {
        // Remove any blue colors - explicitly check and remove
        const bgColor = th.style.backgroundColor || window.getComputedStyle(th).backgroundColor;
        if (bgColor && (bgColor.includes('blue') || bgColor.includes('#') && (
          bgColor.includes('3b82f6') || bgColor.includes('2563eb') || bgColor.includes('1e40af') ||
          bgColor.includes('60a5fa') || bgColor.includes('93c5fd')
        ))) {
          th.style.backgroundColor = ''; // Clear blue color
        }
        
        th.style.border = '1px solid #999999';
        th.style.padding = '12px 10px';
        th.style.textAlign = 'left';
        th.style.fontSize = '20px'; // Increased font size from 18px
        th.style.fontWeight = '700';
        th.style.lineHeight = '1.5';
        th.style.fontFamily = fontStack;
        th.style.verticalAlign = 'middle';
        th.style.backgroundColor = '#e8e8e8'; // Light grey (ensure no blue)
        th.style.color = '#444444'; // Slightly lighter grey text
        th.style.textTransform = 'uppercase';
        th.style.letterSpacing = '0.03em';
        th.style.wordWrap = 'break-word';
        th.style.overflowWrap = 'break-word';
        th.style.pageBreakInside = 'avoid';
        th.style.breakInside = 'avoid';
      });
      
      // Style table cells - larger font
      table.querySelectorAll('td').forEach(td => {
        td.style.border = '1px solid #cccccc';
        td.style.padding = '10px 10px';
        td.style.textAlign = 'left';
        td.style.fontSize = '18px'; // Increased font size from 16px
        td.style.lineHeight = '1.6';
        td.style.fontFamily = fontStack;
        td.style.verticalAlign = 'top';
        td.style.color = '#505050'; // Slightly lighter grey
        td.style.backgroundColor = td.style.backgroundColor || '#ffffff';
        td.style.wordWrap = 'break-word';
        td.style.overflowWrap = 'break-word';
        td.style.wordBreak = 'break-word';
        td.style.whiteSpace = 'normal';
        td.style.pageBreakInside = 'avoid';
        td.style.breakInside = 'avoid';
      });
      
      // Ensure thead repeats on each page - remove any blue colors
      const thead = table.querySelector('thead');
      if (thead) {
        // Remove any blue colors from thead
        const bgColor = thead.style.backgroundColor || window.getComputedStyle(thead).backgroundColor;
        if (bgColor && (bgColor.includes('blue') || bgColor.includes('#') && (
          bgColor.includes('3b82f6') || bgColor.includes('2563eb') || bgColor.includes('1e40af') ||
          bgColor.includes('60a5fa') || bgColor.includes('93c5fd')
        ))) {
          thead.style.backgroundColor = ''; // Clear blue color
        }
        
        thead.style.display = 'table-header-group';
        thead.style.backgroundColor = '#e8e8e8'; // Light grey (ensure no blue)
      }
      
      const tbody = table.querySelector('tbody');
      if (tbody) {
        tbody.style.display = 'table-row-group';
      }
    });

    // Style lists - larger font
    element.querySelectorAll('ul, ol').forEach(list => {
      list.style.marginBottom = '16px';
      list.style.marginTop = '10px';
      list.style.paddingLeft = '30px';
      list.style.fontFamily = fontStack;
      
      list.querySelectorAll('li').forEach(item => {
        item.style.marginBottom = '8px';
        item.style.lineHeight = '1.7';
        item.style.color = '#505050'; // Slightly lighter grey
        item.style.fontSize = '20px'; // Keep font size as is
        item.style.pageBreakInside = 'avoid';
        item.style.breakInside = 'avoid';
      });
    });

    // Style code blocks
    element.querySelectorAll('pre').forEach(pre => {
      pre.style.backgroundColor = '#f5f5f5';
      pre.style.border = '1px solid #dddddd';
      pre.style.borderRadius = '4px';
      pre.style.padding = '14px';
      pre.style.fontFamily = '"Courier New", Courier, monospace';
      pre.style.fontSize = '16px'; // Increased from 14px
      pre.style.overflow = 'auto';
      pre.style.margin = '14px 0';
      pre.style.pageBreakInside = 'avoid';
      pre.style.lineHeight = '1.5';
    });

    // Style inline code
    element.querySelectorAll('code:not(pre code)').forEach(code => {
      code.style.backgroundColor = '#f5f5f5';
      code.style.padding = '2px 5px';
      code.style.borderRadius = '3px';
      code.style.fontFamily = '"Courier New", Courier, monospace';
      code.style.fontSize = '17px'; // Keep font size as is
      code.style.color = '#505050'; // Slightly lighter grey
    });

    // Style blockquotes
    element.querySelectorAll('blockquote').forEach(bq => {
      bq.style.borderLeft = '4px solid #666666';
      bq.style.paddingLeft = '18px';
      bq.style.fontStyle = 'italic';
      bq.style.backgroundColor = '#f9f9f9';
      bq.style.padding = '14px 18px';
      bq.style.margin = '16px 0';
      bq.style.pageBreakInside = 'avoid';
      bq.style.color = '#444444'; // Slightly lighter grey
      bq.style.fontSize = '19px'; // Keep font size as is
    });

    // Style strong/bold text
    element.querySelectorAll('strong, b').forEach(bold => {
      bold.style.fontWeight = '700';
      bold.style.color = '#444444'; // Slightly lighter grey
    });

    // Style links
    element.querySelectorAll('a').forEach(link => {
      link.style.color = '#0066cc';
      link.style.textDecoration = 'underline';
    });

    // Style horizontal rules
    element.querySelectorAll('hr').forEach(hr => {
      hr.style.border = 'none';
      hr.style.borderTop = '1px solid #cccccc';
      hr.style.margin = '24px 0';
    });

    return element;
  };

  // Get table row boundaries from DOM element (before canvas rendering)
  const getTableRowBoundaries = (element, scale) => {
    const rowBoundaries = [];
    const tables = element.querySelectorAll('table');
    
    tables.forEach(table => {
      const rows = table.querySelectorAll('tr');
      rows.forEach(row => {
        const rect = row.getBoundingClientRect();
        const containerRect = element.getBoundingClientRect();
        const relativeTop = rect.top - containerRect.top;
        const relativeBottom = rect.bottom - containerRect.top;
        
        // Convert to canvas coordinates (accounting for scale)
        const topY = relativeTop * scale;
        const bottomY = relativeBottom * scale;
        const rowHeight = bottomY - topY;
        
        if (rowHeight > 0) {
          rowBoundaries.push({
            top: topY,
            bottom: bottomY,
            height: rowHeight
          });
        }
      });
    });
    
    return rowBoundaries.sort((a, b) => a.top - b.top);
  };

  // Improved break point detection - prevents cutting table rows
  const findSafeBreakPoints = (canvas, usableHeightPx, rowBoundaries = []) => {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const width = canvas.width;
    const height = canvas.height;
    
    const breakPoints = [];
    let currentY = 0;
    
    // Helper to check if a Y position is within a table row
    const isInTableRow = (y) => {
      return rowBoundaries.some(row => y >= row.top && y <= row.bottom);
    };
    
    // Helper to find the start of the next row after a Y position
    const findNextRowStart = (y) => {
      for (const row of rowBoundaries) {
        if (row.top > y) {
          return row.top;
        }
      }
      return null;
    };
    
    // Helper to find the end of the row before a Y position
    const findPreviousRowEnd = (y) => {
      let lastRowEnd = null;
      for (const row of rowBoundaries) {
        if (row.bottom < y) {
          lastRowEnd = row.bottom;
        } else {
          break;
        }
      }
      return lastRowEnd;
    };
    
    while (currentY < height) {
      let targetY = Math.min(currentY + usableHeightPx, height);
      
      if (targetY >= height) {
        breakPoints.push({ start: currentY, end: height });
        break;
      }
      
      // Check if targetY would cut through a table row
      if (isInTableRow(targetY)) {
        // Find the end of the current row
        const rowEnd = findPreviousRowEnd(targetY);
        if (rowEnd && rowEnd > currentY) {
          // Check if we can fit the complete row on this page
          if (rowEnd <= currentY + usableHeightPx) {
            // Row fits, break after it
            targetY = rowEnd + 2; // Small gap after row
          } else {
            // Row doesn't fit, move it to next page
            const rowStart = rowBoundaries.find(r => r.bottom === rowEnd)?.top;
            if (rowStart && rowStart > currentY + 50) {
              // Break before the row starts
              targetY = rowStart - 2;
            } else {
              // Very large row, break at previous safe point
              targetY = findPreviousRowEnd(targetY) || targetY;
            }
          }
        } else {
          // Find the start of the next row
          const nextRowStart = findNextRowStart(targetY);
          if (nextRowStart) {
            // Check if next row fits
            const nextRow = rowBoundaries.find(r => r.top === nextRowStart);
            if (nextRow && nextRow.bottom <= currentY + usableHeightPx) {
              // Next row fits, break before it
              targetY = nextRowStart - 2;
            } else {
              // Next row doesn't fit, break before it
              targetY = nextRowStart - 2;
            }
          }
        }
      }
      
      // Look backwards from target to find a safe break point (avoiding table rows)
      let bestBreakY = targetY;
      let bestWhiteScore = 0;
      
      // Search range - up to 30% of page height or 250px
      const searchRange = Math.min(250, usableHeightPx * 0.30);
      const minContentHeight = 100; // Minimum content per page
      
      for (let scanY = targetY; scanY > targetY - searchRange && scanY > currentY + minContentHeight; scanY--) {
        // Skip if this position is in a table row
        if (isInTableRow(scanY)) {
          const rowEnd = findPreviousRowEnd(scanY);
          if (rowEnd && rowEnd > currentY) {
            scanY = rowEnd + 1; // Jump to after the row
            continue;
          }
        }
        
        let whiteRowCount = 0;
        
        // Check a band of rows around this point (5 rows)
        for (let rowOffset = -3; rowOffset <= 3; rowOffset++) {
          const checkY = scanY + rowOffset;
          if (checkY < 0 || checkY >= height) continue;
          
          // Skip if checking within a table row
          if (isInTableRow(checkY)) continue;
          
          let rowWhitePixels = 0;
          let rowTotalSamples = 0;
          
          // Sample across the row width (skip margins)
          for (let x = 60; x < width - 60; x += 5) {
            const idx = (checkY * width + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            
            rowTotalSamples++;
            // Very white pixel check
            if (r > 252 && g > 252 && b > 252) {
              rowWhitePixels++;
            }
          }
          
          // If this row is >98% white, count it
          if (rowTotalSamples > 0 && (rowWhitePixels / rowTotalSamples) >= 0.98) {
            whiteRowCount++;
          }
        }
        
        // If we found a band of white rows (gap between content), use it
        if (whiteRowCount >= 5) {
          bestBreakY = scanY;
          bestWhiteScore = whiteRowCount;
          break; // Found a perfect break point
        }
        
        // Track best partial match
        if (whiteRowCount > bestWhiteScore) {
          bestWhiteScore = whiteRowCount;
          bestBreakY = scanY;
        }
      }
      
      // If no good white space found, try with lower threshold
      if (bestWhiteScore < 3) {
        for (let scanY = targetY; scanY > targetY - searchRange && scanY > currentY + minContentHeight; scanY--) {
          // Skip if this position is in a table row
          if (isInTableRow(scanY)) {
            const rowEnd = findPreviousRowEnd(scanY);
            if (rowEnd && rowEnd > currentY) {
              scanY = rowEnd + 1;
              continue;
            }
          }
          
          let lightPixelCount = 0;
          let totalSamples = 0;
          
          for (let x = 80; x < width - 80; x += 4) {
            const idx = (scanY * width + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            
            totalSamples++;
            // Light pixel (close to white)
            if (r > 245 && g > 245 && b > 245) {
              lightPixelCount++;
            }
          }
          
          if (totalSamples > 0 && (lightPixelCount / totalSamples) >= 0.90) {
            bestBreakY = scanY;
            break;
          }
        }
      }
      
      // Ensure we don't break in the middle of a table row
      if (isInTableRow(bestBreakY)) {
        const rowEnd = findPreviousRowEnd(bestBreakY);
        if (rowEnd && rowEnd > currentY) {
          bestBreakY = rowEnd + 2;
        } else {
          const rowStart = findNextRowStart(bestBreakY);
          if (rowStart) {
            bestBreakY = rowStart - 2;
          }
        }
      }
      
      breakPoints.push({ start: currentY, end: bestBreakY });
      currentY = bestBreakY;
    }
    
    return breakPoints;
  };

  // Main PDF generation
  const generateCanvasPdf = async () => {
    setIsGenerating(true);
    setError(null);
    setSuccess(null);
    setActiveMethod('canvas');

    try {
      // Validate content exists
      const originalElement = markdownOutputRef.current;
      if (!originalElement) {
        throw new Error('No content available to generate PDF. Please ensure the content is loaded.');
      }

      // Check if content has actual text
      const textContent = originalElement.textContent || originalElement.innerText || '';
      if (!textContent.trim()) {
        throw new Error('Content is empty. Please ensure the response has been generated.');
      }

      console.log(`📄 Preparing PDF for content (${textContent.length} characters)`);

      await loadLibraries();
      await ensureFontsLoaded();

      const contentElement = prepareContent();
      
      // Validate prepared content
      if (!contentElement) {
        throw new Error('Failed to prepare content for PDF generation.');
      }

      const preparedText = contentElement.textContent || contentElement.innerText || '';
      if (!preparedText.trim()) {
        throw new Error('Prepared content is empty. Content may not be properly formatted.');
      }

      const hasDevanagari = containsDevanagari(contentElement.textContent);
      
      if (hasDevanagari) {
        console.log('🔤 Devanagari text detected');
      }

      const sanitizedElement = sanitizeElementForCanvas(contentElement);
      const styledElement = styleElementForPdf(sanitizedElement, hasDevanagari);
      
      // Ensure element is visible for rendering
      styledElement.style.width = '100%';
      styledElement.style.maxWidth = 'none';
      styledElement.style.margin = '0';
      styledElement.style.display = 'block';
      styledElement.style.visibility = 'visible';
      styledElement.style.opacity = '1';

      // Create temporary container - positioned off-screen but still accessible
      const tempContainer = document.createElement('div');
      tempContainer.style.position = 'fixed';
      tempContainer.style.left = '-800px'; // Off-screen but still in viewport
      tempContainer.style.top = '0';
      tempContainer.style.width = '794px'; // A4 width at 96dpi
      tempContainer.style.height = 'auto';
      tempContainer.style.backgroundColor = 'white';
      tempContainer.style.padding = '20px';
      tempContainer.style.margin = '0';
      tempContainer.style.overflow = 'visible';
      tempContainer.style.zIndex = '-1'; // Behind everything
      tempContainer.appendChild(styledElement);
      document.body.appendChild(tempContainer);

      // Force layout recalculation
      void tempContainer.offsetHeight;
      void styledElement.offsetHeight;

      // Wait for content to fully render - longer wait for long content
      const contentHeight = styledElement.scrollHeight || styledElement.offsetHeight;
      
      // Check if content is actually visible and has content
      if (!styledElement || contentHeight === 0) {
        document.body.removeChild(tempContainer);
        throw new Error('Content is empty or not visible. Please ensure the content is loaded.');
      }

      // Calculate optimal scale based on content size to avoid canvas limits
      // Note: Scale only affects rendering resolution, NOT formatting (fonts, sizes, colors, spacing)
      const maxCanvasHeight = 32767; // Browser canvas height limit
      let scale = 2.5; // Default scale for high quality
      let scaledHeight = contentHeight * scale;
      
      // Reduce scale if content would exceed canvas limits
      // This only reduces image quality, all formatting remains exactly the same
      if (scaledHeight > maxCanvasHeight) {
        scale = Math.floor((maxCanvasHeight / contentHeight) * 100) / 100;
        scale = Math.max(1.5, scale); // Keep minimum 1.5 for good quality (was 1.0)
        scaledHeight = contentHeight * scale;
        console.log(`⚠️ Content is large (${Math.round(contentHeight / 1000)}k pixels). Reducing rendering scale to ${scale.toFixed(2)} (formatting unchanged).`);
      }

      console.log(`📏 Content height: ${contentHeight}px (rendering scale: ${scale}, scaled: ${Math.round(scaledHeight)}px)`);
      console.log(`✅ Formatting preserved: Times New Roman, light grey headers, larger fonts, lighter text colors`);

      const waitTime = Math.min(1000, Math.max(300, contentHeight / 15)); // Adaptive wait time
      await new Promise(resolve => setTimeout(resolve, waitTime));

      // Force another layout check to ensure DOM is fully rendered
      void styledElement.scrollHeight;
      void styledElement.offsetHeight;
      
      // Wait a bit more for table rendering
      await new Promise(resolve => setTimeout(resolve, 100));

      // Get table row boundaries AFTER element is in DOM and rendered
      // This helps prevent rows from being cut across pages
      const rowBoundaries = getTableRowBoundaries(styledElement, scale);
      console.log(`📊 Found ${rowBoundaries.length} table rows to protect from page breaks`);

      // Render to canvas with adaptive scale
      const canvasPromise = window.html2canvas(styledElement, {
        scale: scale,
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#ffffff',
        logging: false, // Disable logging for performance
        letterRendering: true,
        width: 794,
        height: styledElement.scrollHeight,
        windowWidth: 794,
        windowHeight: styledElement.scrollHeight,
        onclone: (clonedDoc) => {
          const clonedBody = clonedDoc.body;
          const fontStack = hasDevanagari 
            ? '"Noto Sans Devanagari", "Times New Roman", Times, serif'
            : '"Times New Roman", Times, Georgia, serif';
          clonedBody.style.fontFamily = fontStack;
          
          // Sanitize cloned document
          const allElements = [clonedBody, ...clonedBody.querySelectorAll('*')];
          allElements.forEach(el => {
            el.removeAttribute('class');
            if (el.hasAttribute('style')) {
              const styleAttr = el.getAttribute('style');
              if (styleAttr && styleAttr.toLowerCase().includes('oklch')) {
                const safeStyles = styleAttr.split(';').filter(s => 
                  s.trim() && !s.toLowerCase().includes('oklch')
                );
                if (safeStyles.length > 0) {
                  el.setAttribute('style', safeStyles.join(';'));
                } else {
                  el.removeAttribute('style');
                }
              }
            }
          });
        }
      });

      // Add timeout for very long content (5 minutes max)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('PDF generation timed out. Content may be too long. Try using the Print function instead.')), 300000);
      });

      const canvas = await Promise.race([canvasPromise, timeoutPromise]);

      // Validate canvas was created successfully
      if (!canvas || !canvas.width || !canvas.height) {
        throw new Error('Failed to generate canvas. Content may be too large or not properly rendered.');
      }

      console.log(`✅ Canvas created: ${canvas.width}x${canvas.height}px`);

      document.body.removeChild(tempContainer);
      await new Promise(resolve => setTimeout(resolve, 50));

      // Get jsPDF constructor
      let jsPDF;
      if (window.jspdf && window.jspdf.jsPDF) {
        jsPDF = window.jspdf.jsPDF;
      } else if (window.jsPDF && typeof window.jsPDF === 'function') {
        jsPDF = window.jsPDF;
      } else if (window.jsPDF && window.jsPDF.jsPDF) {
        jsPDF = window.jsPDF.jsPDF;
      } else {
        throw new Error('jsPDF library not loaded correctly');
      }

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
        compress: true
      });

      // PDF dimensions
      const pdfWidth = pdf.internal.pageSize.getWidth(); // 210mm
      const pdfHeight = pdf.internal.pageSize.getHeight(); // 297mm
      const topMargin = 18; // mm
      const bottomMargin = 18; // mm
      const sideMargin = 15; // mm
      const contentWidth = pdfWidth - (sideMargin * 2); // 180mm
      const usableHeight = pdfHeight - topMargin - bottomMargin; // 261mm

      // Calculate scale factors using the actual scale used
      const canvasWidthMm = (canvas.width / scale) * 0.264583;
      const scaleFactor = contentWidth / canvasWidthMm;
      
      // Pixels per mm in the canvas (using actual scale)
      const pxPerMm = (scale * 96) / 25.4;
      const usableHeightPx = usableHeight * pxPerMm / scaleFactor;

      // Find safe break points - pass row boundaries to prevent cutting table rows
      const breakPoints = findSafeBreakPoints(canvas, Math.floor(usableHeightPx), rowBoundaries);
      
      console.log(`📄 Generating PDF with ${breakPoints.length} pages`);

      // Generate pages using safe break points
      for (let i = 0; i < breakPoints.length; i++) {
        if (i > 0) {
          pdf.addPage();
        }

        const bp = breakPoints[i];
        const sliceHeight = bp.end - bp.start;
        
        if (sliceHeight <= 0) continue;

        // Create slice canvas
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = sliceHeight;
        const sliceCtx = sliceCanvas.getContext('2d');
        sliceCtx.fillStyle = '#ffffff';
        sliceCtx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
        sliceCtx.drawImage(canvas, 0, bp.start, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);

        // Convert to image and add to PDF
        const sliceImgData = sliceCanvas.toDataURL('image/jpeg', 0.92);
        const sliceHeightMm = (sliceHeight / scale) * 0.264583 * scaleFactor;
        
        pdf.addImage(sliceImgData, 'JPEG', sideMargin, topMargin, contentWidth, sliceHeightMm, '', 'FAST');

        // Add page number
        pdf.setFontSize(10);
        pdf.setTextColor(120);
        pdf.text(`Page ${i + 1} of ${breakPoints.length}`, pdfWidth / 2, pdfHeight - 10, { align: 'center' });

        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Generate filename and save
      const timestamp = new Date().toISOString().slice(0, 10);
      const cleanTitle = questionTitle
        ? questionTitle.replace(/[^a-zA-Z0-9_ -]/g, '').replace(/\s+/g, '_').substring(0, 50)
        : 'Jurinex_Response';
      const filename = `${cleanTitle}_${timestamp}.pdf`;

      pdf.save(filename);

      // Success message removed as requested

    } catch (err) {
      console.error('PDF generation failed:', err);
      const errorMessage = err.message || 'Unknown error occurred';
      
      // Clean up temp container if it still exists
      try {
        const tempContainer = document.querySelector('div[style*="-9999px"]');
        if (tempContainer && tempContainer.parentNode) {
          document.body.removeChild(tempContainer);
        }
      } catch (cleanupErr) {
        // Ignore cleanup errors
      }
      
      // Provide helpful error messages
      let userMessage = `PDF generation failed: ${errorMessage}`;
      if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
        userMessage = 'PDF generation timed out. The content is very long. Please try using the Print function instead, or split the content into smaller sections.';
      } else if (errorMessage.includes('canvas') || errorMessage.includes('empty')) {
        userMessage = 'Failed to capture content. Please ensure the content is fully loaded and visible, then try again.';
      } else if (errorMessage.includes('too large')) {
        userMessage = 'Content is too large to generate as PDF. Please use the Print function instead.';
      }
      
      setError(userMessage);
      setTimeout(() => setError(null), 8000);
    } finally {
      setIsGenerating(false);
    }
  };

  // Enhanced print function
  const handleEnhancedPrint = () => {
    const element = markdownOutputRef.current;
    if (!element) {
      setError('No content to print.');
      return;
    }

    setActiveMethod('print');

    try {
      const hasDevanagari = containsDevanagari(element.textContent);
      const printWindow = window.open('', '_blank', 'width=800,height=600');
      
      const htmlContent = `
        <!DOCTYPE html>
        <html lang="${hasDevanagari ? 'mr' : 'en'}">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${questionTitle || 'Document'}</title>
          <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap" rel="stylesheet">
          <style>
            * { 
              margin: 0; 
              padding: 0; 
              box-sizing: border-box; 
            }
            
            body {
              font-family: ${hasDevanagari 
                ? '"Noto Sans Devanagari", "Times New Roman", Times, serif' 
                : '"Times New Roman", Times, Georgia, serif'
              };
              line-height: 1.8;
              color: #505050;
              background: white;
              padding: 2cm 2.5cm;
              font-size: 20px;
              text-rendering: optimizeLegibility;
              -webkit-font-smoothing: antialiased;
            }
            
            @page {
              size: A4;
              margin: 2cm;
            }
            
            @media print {
              body { padding: 0; }
              
              h1, h2, h3, h4, h5, h6 { 
                page-break-after: avoid !important; 
                page-break-inside: avoid !important;
                break-after: avoid !important;
                break-inside: avoid !important;
                orphans: 4;
                widows: 4;
              }
              
              p {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
                orphans: 4;
                widows: 4;
              }
              
              li {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
              }
              
              tr {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
                display: table-row !important;
              }
              
              td, th {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
              }
              
              /* Ensure table rows are never split across pages */
              tbody tr {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
                page-break-after: auto !important;
              }
              
              /* If a row doesn't fit, move entire row to next page */
              thead tr {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
              }
              
              table {
                page-break-inside: auto;
              }
              
              thead { 
                display: table-header-group !important; 
              }
              
              tbody {
                display: table-row-group;
              }
              
              pre, blockquote { 
                page-break-inside: avoid !important; 
              }
            }
            
            h1, h2, h3, h4, h5, h6 {
              color: #444444;
              font-weight: 700;
              font-family: "Times New Roman", Times, Georgia, serif;
            }
            
            h1 { 
              font-size: 32px; 
              margin: 30px 0 20px 0;
              border-bottom: 2px solid #444444;
              padding-bottom: 10px;
            }
            
            h2 { 
              font-size: 28px; 
              margin: 28px 0 16px 0;
              color: #444444;
            }
            
            h3 { 
              font-size: 24px; 
              font-weight: 600;
              margin: 24px 0 14px 0;
              color: #464646;
            }
            
            h4 { 
              font-size: 22px; 
              font-weight: 600;
              margin: 20px 0 12px 0;
              color: #484848;
            }
            
            h5, h6 { 
              font-size: 20px; 
              font-weight: 600;
              margin: 18px 0 10px 0;
              color: #4a4a4a;
            }
            
            p { 
              margin: 0 0 14px 0; 
              text-align: justify;
              text-justify: inter-word;
              line-height: 1.8; 
              color: #505050; 
              font-size: 20px;
            }
            
            ul, ol { 
              margin: 10px 0 16px 0; 
              padding-left: 30px; 
            }
            
            li { 
              margin: 0 0 8px 0; 
              line-height: 1.7;
              color: #505050;
              font-size: 20px;
            }
            
            /* Table styling - Light grey headers */
            table {
              width: 100%;
              max-width: 100%;
              border-collapse: collapse;
              margin: 20px 0;
              font-size: 18px;
              font-family: "Times New Roman", Times, Georgia, serif;
              border: 1px solid #999999;
            }
            
            thead {
              background-color: #e5e5e5;
            }
            
            th {
              border: 1px solid #999999;
              padding: 12px 10px;
              text-align: left;
              line-height: 1.5;
              vertical-align: middle;
              background-color: #e5e5e5;
              color: #444444;
              font-weight: 700;
              font-size: 20px;
              text-transform: uppercase;
              letter-spacing: 0.03em;
            }
            
            td {
              border: 1px solid #cccccc;
              padding: 10px 10px;
              text-align: left;
              line-height: 1.6;
              vertical-align: top;
              color: #505050;
              background-color: #ffffff;
              font-size: 18px;
            }
            
            tbody tr:nth-child(even) td {
              background-color: #f9f9f9;
            }
            
            pre {
              background-color: #f5f5f5;
              border: 1px solid #dddddd;
              border-radius: 4px;
              padding: 14px;
              font-family: 'Courier New', Courier, monospace;
              font-size: 16px;
              margin: 14px 0;
              line-height: 1.5;
            }
            
            code:not(pre code) {
              background-color: #f5f5f5;
              padding: 2px 5px;
              border-radius: 3px;
              font-family: 'Courier New', Courier, monospace;
              font-size: 17px;
              color: #505050;
            }
            
            blockquote {
              border-left: 4px solid #666666;
              padding: 14px 18px;
              margin: 16px 0;
              background-color: #f9f9f9;
              font-style: italic;
              color: #444444;
              font-size: 19px;
            }
            
            strong, b { 
              font-weight: 700; 
              color: #444444;
            }
            
            a {
              color: #0066cc;
              text-decoration: underline;
            }
            
            hr {
              border: none;
              border-top: 1px solid #cccccc;
              margin: 24px 0;
            }
          </style>
        </head>
        <body>
          ${element.innerHTML}
          <script>
            window.onload = function() {
              if (document.fonts) {
                document.fonts.ready.then(() => {
                  setTimeout(() => window.print(), 800);
                });
              } else {
                setTimeout(() => window.print(), 1200);
              }
            };
          </script>
        </body>
        </html>
      `;

      printWindow.document.write(htmlContent);
      printWindow.document.close();
      
      setSuccess('Print dialog opened! 🖨️');
      setTimeout(() => setSuccess(null), 3000);

    } catch (err) {
      setError(`Print failed: ${err.message}`);
      setTimeout(() => setError(null), 3000);
    }
  };

  return (
    <>
      {/* PDF Download Button */}
      <button
        onClick={generateCanvasPdf}
        disabled={isGenerating && activeMethod === 'canvas'}
        className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title="Download PDF (Smart page breaks prevent content cutting)"
      >
        {isGenerating && activeMethod === 'canvas' ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
      </button>

      {/* Print Button */}
      <button
        onClick={handleEnhancedPrint}
        disabled={isGenerating}
        className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title="Print with professional formatting"
      >
        <Printer className="h-4 w-4" />
      </button>

      {/* Error Message */}
      {error && (
        <div className="fixed bottom-4 right-4 z-50 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg shadow-lg text-sm max-w-sm">
          <div className="font-semibold mb-1">❌ Error</div>
          <div className="text-xs">{error}</div>
        </div>
      )}

      {/* Success Message */}
      {success && (
        <div className="fixed bottom-4 right-4 z-50 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg shadow-lg text-sm max-w-sm">
          <div className="font-semibold mb-1">✅ Success</div>
          <div className="text-xs">{success}</div>
        </div>
      )}
    </>
  );
};

export default DownloadPdf;