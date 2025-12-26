//               ? 'PDF downloaded! Note: Marathi text may not render correctly. Use Print for best quality.'
      



      
      
        
        
        
        
        
        
        
        
        
        
        
        
        

      

      

      
      
      










    



    




    
      
      
      
    






      
      
      
      
      
      

      







      

      
      
      




          
            
            

      






        
          
          
          
          
          
          
          
          
          



      




      
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            

      









import React, { useState } from 'react';
import { Download, Printer, Loader2 } from 'lucide-react';

const DownloadPdf = ({ markdownOutputRef, questionTitle }) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [activeMethod, setActiveMethod] = useState('canvas');

  const containsDevanagari = (text) => {
    return /[\u0900-\u097F]/.test(text || '');
  };

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

  const ensureFontsLoaded = async () => {
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

  const prepareContent = () => {
    const element = markdownOutputRef.current;
    if (!element) {
      throw new Error('No content available to generate PDF');
    }

    const cloned = element.cloneNode(true);
    
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
              el.style.color = '#505050';
            } else if (prop === 'backgroundColor') {
              el.style.backgroundColor = '#ffffff';
            } else if (prop.includes('border')) {
              el.style[prop] = '#d1d5db';
            } else {
              el.style[prop] = '#1a1a1a';
            }
          }
        } catch (e) {
        }
      });
    });
    
    return element;
  };

  const styleElementForPdf = (element, hasDevanagari) => {
    const fontStack = hasDevanagari 
      ? '"Noto Sans Devanagari", "Times New Roman", Times, serif'
      : '"Times New Roman", Times, Georgia, serif';

    element.style.fontFamily = fontStack;
    element.style.backgroundColor = '#ffffff';
    element.style.color = '#505050';
    element.style.padding = '45px 50px';
    element.style.maxWidth = 'none';
    element.style.width = '100%';
    element.style.lineHeight = '1.8';
    element.style.fontSize = '20px';
    element.style.margin = '0';
    element.style.textRendering = 'optimizeLegibility';
    element.style.WebkitFontSmoothing = 'antialiased';

    element.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
      heading.style.fontFamily = fontStack;
      heading.style.color = '#444444';
      heading.style.pageBreakAfter = 'avoid';
      heading.style.pageBreakInside = 'avoid';
      heading.style.breakInside = 'avoid';
      heading.style.breakAfter = 'avoid';
      heading.style.textAlign = 'left';
      heading.style.orphans = '4';
      heading.style.widows = '4';
    });

    element.querySelectorAll('h1').forEach(h1 => {
      h1.style.fontSize = '32px';
      h1.style.fontWeight = '700';
      h1.style.marginTop = '30px';
      h1.style.marginBottom = '20px';
      h1.style.borderBottom = '2px solid #444444';
      h1.style.paddingBottom = '10px';
    });
    
    element.querySelectorAll('h2').forEach(h2 => {
      h2.style.fontSize = '28px';
      h2.style.fontWeight = '700';
      h2.style.marginTop = '28px';
      h2.style.marginBottom = '16px';
      h2.style.color = '#444444';
    });
    
    element.querySelectorAll('h3').forEach(h3 => {
      h3.style.fontSize = '24px';
      h3.style.fontWeight = '600';
      h3.style.marginTop = '24px';
      h3.style.marginBottom = '14px';
      h3.style.color = '#464646';
    });
    
    element.querySelectorAll('h4').forEach(h4 => {
      h4.style.fontSize = '22px';
      h4.style.fontWeight = '600';
      h4.style.marginTop = '20px';
      h4.style.marginBottom = '12px';
      h4.style.color = '#484848';
    });
    
    element.querySelectorAll('h5, h6').forEach(h => {
      h.style.fontSize = '20px';
      h.style.fontWeight = '600';
      h.style.marginTop = '18px';
      h.style.marginBottom = '10px';
      h.style.color = '#4a4a4a';
    });

    element.querySelectorAll('p').forEach(p => {
      p.style.marginBottom = '14px';
      p.style.lineHeight = '1.8';
      p.style.textAlign = 'justify';
      p.style.textJustify = 'inter-word';
      p.style.color = '#505050';
      p.style.fontSize = '20px';
      p.style.fontFamily = fontStack;
      p.style.orphans = '4';
      p.style.widows = '4';
    });

    element.querySelectorAll('table').forEach(table => {
      table.style.width = '100%';
      table.style.maxWidth = '100%';
      table.style.borderCollapse = 'collapse';
      table.style.marginTop = '20px';
      table.style.marginBottom = '20px';
      table.style.fontSize = '18px';
      table.style.fontFamily = fontStack;
      table.style.tableLayout = 'fixed';
      table.style.wordWrap = 'break-word';
      table.style.overflowWrap = 'break-word';
      table.style.border = '1px solid #999999';
      
      table.querySelectorAll('tr').forEach((tr, index) => {
        tr.style.pageBreakInside = 'avoid';
        tr.style.breakInside = 'avoid';
        tr.style.display = 'table-row';
        
        if (index > 0 && index % 2 === 0) {
          tr.querySelectorAll('td').forEach(td => {
            if (!td.style.backgroundColor || td.style.backgroundColor === '#ffffff') {
              td.style.backgroundColor = '#f9f9f9';
            }
          });
        }
      });
      
      table.querySelectorAll('th').forEach(th => {
        const bgColor = th.style.backgroundColor || window.getComputedStyle(th).backgroundColor;
        if (bgColor && (bgColor.includes('blue') || bgColor.includes('#') && (
          bgColor.includes('3b82f6') || bgColor.includes('2563eb') || bgColor.includes('1e40af') ||
          bgColor.includes('60a5fa') || bgColor.includes('93c5fd')
        ))) {
          th.style.backgroundColor = '';
        }
        
        th.style.border = '1px solid #999999';
        th.style.padding = '12px 10px';
        th.style.textAlign = 'left';
        th.style.fontSize = '20px';
        th.style.fontWeight = '700';
        th.style.lineHeight = '1.5';
        th.style.fontFamily = fontStack;
        th.style.verticalAlign = 'middle';
        th.style.backgroundColor = '#e8e8e8';
        th.style.color = '#444444';
        th.style.textTransform = 'uppercase';
        th.style.letterSpacing = '0.03em';
        th.style.wordWrap = 'break-word';
        th.style.overflowWrap = 'break-word';
        th.style.pageBreakInside = 'avoid';
        th.style.breakInside = 'avoid';
      });
      
      table.querySelectorAll('td').forEach(td => {
        td.style.border = '1px solid #cccccc';
        td.style.padding = '10px 10px';
        td.style.textAlign = 'left';
        td.style.fontSize = '18px';
        td.style.lineHeight = '1.6';
        td.style.fontFamily = fontStack;
        td.style.verticalAlign = 'top';
        td.style.color = '#505050';
        td.style.backgroundColor = td.style.backgroundColor || '#ffffff';
        td.style.wordWrap = 'break-word';
        td.style.overflowWrap = 'break-word';
        td.style.wordBreak = 'break-word';
        td.style.whiteSpace = 'normal';
        td.style.pageBreakInside = 'avoid';
        td.style.breakInside = 'avoid';
      });
      
      const thead = table.querySelector('thead');
      if (thead) {
        const bgColor = thead.style.backgroundColor || window.getComputedStyle(thead).backgroundColor;
        if (bgColor && (bgColor.includes('blue') || bgColor.includes('#') && (
          bgColor.includes('3b82f6') || bgColor.includes('2563eb') || bgColor.includes('1e40af') ||
          bgColor.includes('60a5fa') || bgColor.includes('93c5fd')
        ))) {
          thead.style.backgroundColor = '';
        }
        
        thead.style.display = 'table-header-group';
        thead.style.backgroundColor = '#e8e8e8';
      }
      
      const tbody = table.querySelector('tbody');
      if (tbody) {
        tbody.style.display = 'table-row-group';
      }
    });

    element.querySelectorAll('ul, ol').forEach(list => {
      list.style.marginBottom = '16px';
      list.style.marginTop = '10px';
      list.style.paddingLeft = '30px';
      list.style.fontFamily = fontStack;
      
      list.querySelectorAll('li').forEach(item => {
        item.style.marginBottom = '8px';
        item.style.lineHeight = '1.7';
        item.style.color = '#505050';
        item.style.fontSize = '20px';
        item.style.pageBreakInside = 'avoid';
        item.style.breakInside = 'avoid';
      });
    });

    element.querySelectorAll('pre').forEach(pre => {
      pre.style.backgroundColor = '#f5f5f5';
      pre.style.border = '1px solid #dddddd';
      pre.style.borderRadius = '4px';
      pre.style.padding = '14px';
      pre.style.fontFamily = '"Courier New", Courier, monospace';
      pre.style.fontSize = '16px';
      pre.style.overflow = 'auto';
      pre.style.margin = '14px 0';
      pre.style.pageBreakInside = 'avoid';
      pre.style.lineHeight = '1.5';
    });

    element.querySelectorAll('code:not(pre code)').forEach(code => {
      code.style.backgroundColor = '#f5f5f5';
      code.style.padding = '2px 5px';
      code.style.borderRadius = '3px';
      code.style.fontFamily = '"Courier New", Courier, monospace';
      code.style.fontSize = '17px';
      code.style.color = '#505050';
    });

    element.querySelectorAll('blockquote').forEach(bq => {
      bq.style.borderLeft = '4px solid #666666';
      bq.style.paddingLeft = '18px';
      bq.style.fontStyle = 'italic';
      bq.style.backgroundColor = '#f9f9f9';
      bq.style.padding = '14px 18px';
      bq.style.margin = '16px 0';
      bq.style.pageBreakInside = 'avoid';
      bq.style.color = '#444444';
      bq.style.fontSize = '19px';
    });

    element.querySelectorAll('strong, b').forEach(bold => {
      bold.style.fontWeight = '700';
      bold.style.color = '#444444';
    });

    element.querySelectorAll('a').forEach(link => {
      link.style.color = '#0066cc';
      link.style.textDecoration = 'underline';
    });

    element.querySelectorAll('hr').forEach(hr => {
      hr.style.border = 'none';
      hr.style.borderTop = '1px solid #cccccc';
      hr.style.margin = '24px 0';
    });

    return element;
  };

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

  const findSafeBreakPoints = (canvas, usableHeightPx, rowBoundaries = []) => {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const width = canvas.width;
    const height = canvas.height;
    
    const breakPoints = [];
    let currentY = 0;
    
    const isInTableRow = (y) => {
      return rowBoundaries.some(row => y >= row.top && y <= row.bottom);
    };
    
    const findNextRowStart = (y) => {
      for (const row of rowBoundaries) {
        if (row.top > y) {
          return row.top;
        }
      }
      return null;
    };
    
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
      
      if (isInTableRow(targetY)) {
        const rowEnd = findPreviousRowEnd(targetY);
        if (rowEnd && rowEnd > currentY) {
          if (rowEnd <= currentY + usableHeightPx) {
            targetY = rowEnd + 2;
          } else {
            const rowStart = rowBoundaries.find(r => r.bottom === rowEnd)?.top;
            if (rowStart && rowStart > currentY + 50) {
              targetY = rowStart - 2;
            } else {
              targetY = findPreviousRowEnd(targetY) || targetY;
            }
          }
        } else {
          const nextRowStart = findNextRowStart(targetY);
          if (nextRowStart) {
            const nextRow = rowBoundaries.find(r => r.top === nextRowStart);
            if (nextRow && nextRow.bottom <= currentY + usableHeightPx) {
              targetY = nextRowStart - 2;
            } else {
              targetY = nextRowStart - 2;
            }
          }
        }
      }
      
      let bestBreakY = targetY;
      let bestWhiteScore = 0;
      
      const searchRange = Math.min(250, usableHeightPx * 0.30);
      const minContentHeight = 100;
      
      for (let scanY = targetY; scanY > targetY - searchRange && scanY > currentY + minContentHeight; scanY--) {
        if (isInTableRow(scanY)) {
          const rowEnd = findPreviousRowEnd(scanY);
          if (rowEnd && rowEnd > currentY) {
            scanY = rowEnd + 1;
            continue;
          }
        }
        
        let whiteRowCount = 0;
        
        for (let rowOffset = -3; rowOffset <= 3; rowOffset++) {
          const checkY = scanY + rowOffset;
          if (checkY < 0 || checkY >= height) continue;
          
          if (isInTableRow(checkY)) continue;
          
          let rowWhitePixels = 0;
          let rowTotalSamples = 0;
          
          for (let x = 60; x < width - 60; x += 5) {
            const idx = (checkY * width + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            
            rowTotalSamples++;
            if (r > 252 && g > 252 && b > 252) {
              rowWhitePixels++;
            }
          }
          
          if (rowTotalSamples > 0 && (rowWhitePixels / rowTotalSamples) >= 0.98) {
            whiteRowCount++;
          }
        }
        
        if (whiteRowCount >= 5) {
          bestBreakY = scanY;
          bestWhiteScore = whiteRowCount;
          break;
        }
        
        if (whiteRowCount > bestWhiteScore) {
          bestWhiteScore = whiteRowCount;
          bestBreakY = scanY;
        }
      }
      
      if (bestWhiteScore < 3) {
        for (let scanY = targetY; scanY > targetY - searchRange && scanY > currentY + minContentHeight; scanY--) {
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

  const generateCanvasPdf = async () => {
    setIsGenerating(true);
    setError(null);
    setSuccess(null);
    setActiveMethod('canvas');

    try {
      const originalElement = markdownOutputRef.current;
      if (!originalElement) {
        throw new Error('No content available to generate PDF. Please ensure the content is loaded.');
      }

      const textContent = originalElement.textContent || originalElement.innerText || '';
      if (!textContent.trim()) {
        throw new Error('Content is empty. Please ensure the response has been generated.');
      }

      console.log(`📄 Preparing PDF for content (${textContent.length} characters)`);

      await loadLibraries();
      await ensureFontsLoaded();

      const contentElement = prepareContent();
      
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
      
      styledElement.style.width = '100%';
      styledElement.style.maxWidth = 'none';
      styledElement.style.margin = '0';
      styledElement.style.display = 'block';
      styledElement.style.visibility = 'visible';
      styledElement.style.opacity = '1';

      const tempContainer = document.createElement('div');
      tempContainer.style.position = 'fixed';
      tempContainer.style.left = '-800px';
      tempContainer.style.top = '0';
      tempContainer.style.width = '794px';
      tempContainer.style.height = 'auto';
      tempContainer.style.backgroundColor = 'white';
      tempContainer.style.padding = '20px';
      tempContainer.style.margin = '0';
      tempContainer.style.overflow = 'visible';
      tempContainer.style.zIndex = '-1';
      tempContainer.appendChild(styledElement);
      document.body.appendChild(tempContainer);

      void tempContainer.offsetHeight;
      void styledElement.offsetHeight;

      const contentHeight = styledElement.scrollHeight || styledElement.offsetHeight;
      
      if (!styledElement || contentHeight === 0) {
        document.body.removeChild(tempContainer);
        throw new Error('Content is empty or not visible. Please ensure the content is loaded.');
      }

      const maxCanvasHeight = 32767;
      let scale = 2.5;
      let scaledHeight = contentHeight * scale;
      
      if (scaledHeight > maxCanvasHeight) {
        scale = Math.floor((maxCanvasHeight / contentHeight) * 100) / 100;
        scale = Math.max(1.5, scale);
        scaledHeight = contentHeight * scale;
        console.log(`⚠️ Content is large (${Math.round(contentHeight / 1000)}k pixels). Reducing rendering scale to ${scale.toFixed(2)} (formatting unchanged).`);
      }

      console.log(`📏 Content height: ${contentHeight}px (rendering scale: ${scale}, scaled: ${Math.round(scaledHeight)}px)`);
      console.log(`✅ Formatting preserved: Times New Roman, light grey headers, larger fonts, lighter text colors`);

      const waitTime = Math.min(1000, Math.max(300, contentHeight / 15));
      await new Promise(resolve => setTimeout(resolve, waitTime));

      void styledElement.scrollHeight;
      void styledElement.offsetHeight;
      
      await new Promise(resolve => setTimeout(resolve, 100));

      const rowBoundaries = getTableRowBoundaries(styledElement, scale);
      console.log(`📊 Found ${rowBoundaries.length} table rows to protect from page breaks`);

      const canvasPromise = window.html2canvas(styledElement, {
        scale: scale,
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#ffffff',
        logging: false,
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

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('PDF generation timed out. Content may be too long. Try using the Print function instead.')), 300000);
      });

      const canvas = await Promise.race([canvasPromise, timeoutPromise]);

      if (!canvas || !canvas.width || !canvas.height) {
        throw new Error('Failed to generate canvas. Content may be too large or not properly rendered.');
      }

      console.log(`✅ Canvas created: ${canvas.width}x${canvas.height}px`);

      document.body.removeChild(tempContainer);
      await new Promise(resolve => setTimeout(resolve, 50));

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

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const topMargin = 18;
      const bottomMargin = 18;
      const sideMargin = 15;
      const contentWidth = pdfWidth - (sideMargin * 2);
      const usableHeight = pdfHeight - topMargin - bottomMargin;

      const canvasWidthMm = (canvas.width / scale) * 0.264583;
      const scaleFactor = contentWidth / canvasWidthMm;
      
      const pxPerMm = (scale * 96) / 25.4;
      const usableHeightPx = usableHeight * pxPerMm / scaleFactor;

      const breakPoints = findSafeBreakPoints(canvas, Math.floor(usableHeightPx), rowBoundaries);
      
      console.log(`📄 Generating PDF with ${breakPoints.length} pages`);

      for (let i = 0; i < breakPoints.length; i++) {
        if (i > 0) {
          pdf.addPage();
        }

        const bp = breakPoints[i];
        const sliceHeight = bp.end - bp.start;
        
        if (sliceHeight <= 0) continue;

        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = sliceHeight;
        const sliceCtx = sliceCanvas.getContext('2d');
        sliceCtx.fillStyle = '#ffffff';
        sliceCtx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
        sliceCtx.drawImage(canvas, 0, bp.start, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);

        const sliceImgData = sliceCanvas.toDataURL('image/jpeg', 0.92);
        const sliceHeightMm = (sliceHeight / scale) * 0.264583 * scaleFactor;
        
        pdf.addImage(sliceImgData, 'JPEG', sideMargin, topMargin, contentWidth, sliceHeightMm, '', 'FAST');

        pdf.setFontSize(10);
        pdf.setTextColor(120);
        pdf.text(`Page ${i + 1} of ${breakPoints.length}`, pdfWidth / 2, pdfHeight - 10, { align: 'center' });

        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const timestamp = new Date().toISOString().slice(0, 10);
      const cleanTitle = questionTitle
        ? questionTitle.replace(/[^a-zA-Z0-9_ -]/g, '').replace(/\s+/g, '_').substring(0, 50)
        : 'Jurinex_Response';
      const filename = `${cleanTitle}_${timestamp}.pdf`;

      pdf.save(filename);


    } catch (err) {
      console.error('PDF generation failed:', err);
      const errorMessage = err.message || 'Unknown error occurred';
      
      try {
        const tempContainer = document.querySelector('div[style*="-9999px"]');
        if (tempContainer && tempContainer.parentNode) {
          document.body.removeChild(tempContainer);
        }
      } catch (cleanupErr) {
      }
      
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
              
              tbody tr {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
                page-break-after: auto !important;
              }
              
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

      <button
        onClick={handleEnhancedPrint}
        disabled={isGenerating}
        className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title="Print with professional formatting"
      >
        <Printer className="h-4 w-4" />
      </button>

      {error && (
        <div className="fixed bottom-4 right-4 z-50 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg shadow-lg text-sm max-w-sm">
          <div className="font-semibold mb-1">❌ Error</div>
          <div className="text-xs">{error}</div>
        </div>
      )}

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