const axios = require('axios');
const { VertexAI } = require('@google-cloud/vertexai');
const path = require('path');

/**
 * Web Search Service for PDF Processing
 * 
 * This service provides two main capabilities:
 * 1. Direct PDF processing from provided URLs
 * 2. PDF discovery and processing via Google Search API
 * 
 * Features:
 * - URL detection in queries
 * - Google Search API integration for PDF discovery
 * - Multimodal PDF processing (text, tables, visual data)
 * - Citation generation with source links
 */

// Initialize Vertex AI
let vertexAI;
function getGCSProjectId() {
  try {
    if (process.env.GCP_PROJECT_ID) {
      return process.env.GCP_PROJECT_ID;
    }

    if (process.env.GCS_KEY_BASE64) {
      const jsonString = Buffer.from(process.env.GCS_KEY_BASE64, 'base64').toString('utf-8');
      const credentials = JSON.parse(jsonString);
      if (credentials.project_id) {
        return credentials.project_id;
      }
    }
    
    throw new Error('GCP_PROJECT_ID not found. Set GCP_PROJECT_ID in .env');
  } catch (error) {
    console.error('❌ Failed to get GCP Project ID:', error.message);
    throw error;
  }
}

function initializeVertexAI() {
  if (vertexAI) return vertexAI;
  
  try {
    const projectId = getGCSProjectId();
    const location = process.env.GCP_LOCATION || 'us-central1';
    
    console.log(`🚀 Initializing Vertex AI for web search service: ${projectId}, location: ${location}`);
    
    vertexAI = new VertexAI({
      project: projectId,
      location: location,
    });
    
    return vertexAI;
  } catch (error) {
    console.error('❌ Failed to initialize Vertex AI:', error.message);
    throw error;
  }
}

/**
 * Extract URLs from a query string
 * @param {string} query - User query
 * @returns {Array<string>} - Array of URLs found in the query
 */
function extractUrlsFromQuery(query) {
  if (!query || typeof query !== 'string') {
    console.log(`[URL Extraction] Query is empty or not a string`);
    return [];
  }
  
  // More comprehensive URL regex that handles various URL formats
  const urlRegex = /(https?:\/\/[^\s\)\]\>\"\']+)/gi;
  const matches = query.match(urlRegex);
  
  if (matches) {
    // Clean up URLs (remove trailing punctuation that might have been captured)
    const cleanedUrls = matches.map(url => {
      // Remove trailing punctuation that's not part of the URL
      return url.replace(/[.,;:!?]+$/, '');
    });
    console.log(`[URL Extraction] Found ${cleanedUrls.length} URL(s):`, cleanedUrls);
    return cleanedUrls;
  }
  
  console.log(`[URL Extraction] No URLs found in query: "${query.substring(0, 100)}"`);
  return [];
}

/**
 * Check if a URL points to a PDF file
 * @param {string} url - URL to check
 * @returns {boolean} - True if URL is a PDF
 */
function isPdfUrl(url) {
  if (!url) {
    console.log(`[isPdfUrl] URL is empty`);
    return false;
  }
  
  const lowerUrl = url.toLowerCase();
  console.log(`[isPdfUrl] Checking URL: ${url}`);
  
  // Direct PDF file URLs (most common pattern)
  if (lowerUrl.endsWith('.pdf') || lowerUrl.includes('.pdf?') || lowerUrl.includes('.pdf#') || lowerUrl.includes('/.pdf')) {
    console.log(`[isPdfUrl] ✅ Detected as PDF: ends with .pdf or contains .pdf`);
    return true;
  }
  
  // URLs with /fulltext/ or /pdf/ in path (common for academic/research sites)
  if ((lowerUrl.includes('/fulltext/') || lowerUrl.includes('/pdf/') || lowerUrl.includes('/document/')) && 
      (lowerUrl.includes('.pdf') || lowerUrl.includes('pdf') || lowerUrl.includes('application/pdf'))) {
    console.log(`[isPdfUrl] ✅ Detected as PDF: contains /fulltext/ or /pdf/ path`);
    return true;
  }
  
  // Google Drive viewer URLs for PDFs
  if (lowerUrl.includes('googleusercontent.com/viewer') && lowerUrl.includes('/pdf/')) {
    console.log(`[isPdfUrl] ✅ Detected as PDF: Google Drive viewer`);
    return true;
  }
  
  // Google Drive share links that might be PDFs
  if (lowerUrl.includes('drive.google.com') && (lowerUrl.includes('/file/') || lowerUrl.includes('/open'))) {
    console.log(`[isPdfUrl] ✅ Detected as potential PDF: Google Drive link`);
    return true; // Will be validated later
  }
  
  // Other common PDF viewer patterns
  if (lowerUrl.includes('viewer') && (lowerUrl.includes('pdf') || lowerUrl.includes('application/pdf'))) {
    console.log(`[isPdfUrl] ✅ Detected as PDF: viewer pattern`);
    return true;
  }
  
  // Check Content-Type header if available (for URLs that don't have .pdf extension)
  // This will be checked during actual download
  
  console.log(`[isPdfUrl] ❌ Not detected as PDF`);
  return false;
}

/**
 * Check if a URL is a web page (HTML content)
 * @param {string} url - URL to check
 * @returns {boolean} - True if URL is likely a web page
 */
function isWebPageUrl(url) {
  if (!url) return false;
  const lowerUrl = url.toLowerCase();
  
  // Exclude PDFs and known file types
  if (isPdfUrl(url)) return false;
  if (lowerUrl.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|tar|gz)$/)) return false;
  
  // Common web page patterns
  if (lowerUrl.startsWith('http://') || lowerUrl.startsWith('https://')) {
    return true; // Any HTTP/HTTPS URL is potentially a web page
  }
  
  return false;
}

/**
 * Convert Google Drive share link to direct download/view URL
 * @param {string} url - Google Drive URL
 * @returns {Object} - Object with multiple URL options to try
 */
function convertGoogleDriveUrl(url) {
  if (!url) return { original: url, download: url, viewer: url };
  
  // Google Drive viewer URL pattern (already a viewer URL)
  if (url.includes('googleusercontent.com/viewer') && url.includes('/pdf/')) {
    return { original: url, download: url, viewer: url };
  }
  
  // Extract file ID from various Google Drive URL formats
  let fileId = null;
  
  // Format: https://drive.google.com/file/d/FILE_ID/view?usp=sharing
  if (url.includes('drive.google.com/file/d/')) {
    const fileIdMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (fileIdMatch && fileIdMatch[1]) {
      fileId = fileIdMatch[1];
    }
  }
  // Format: https://drive.google.com/open?id=FILE_ID
  else if (url.includes('drive.google.com/open')) {
    const fileIdMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (fileIdMatch && fileIdMatch[1]) {
      fileId = fileIdMatch[1];
    }
  }
  
  if (fileId) {
    // Try multiple URL formats
    return {
      original: url,
      download: `https://drive.google.com/uc?export=download&id=${fileId}`,
      viewer: `https://drive.google.com/file/d/${fileId}/preview`,
      direct: `https://drive.google.com/uc?export=view&id=${fileId}`,
      fileId: fileId
    };
  }
  
  return { original: url, download: url, viewer: url };
}

/**
 * Get the best URL to use for processing (tries multiple options)
 * @param {string} url - Original URL
 * @returns {string} - Best URL to try first
 */
function getBestUrlForProcessing(url) {
  const urls = convertGoogleDriveUrl(url);
  
  // For Google Drive, prefer the viewer/preview URL as it's more likely to work with Gemini
  if (urls.viewer && urls.viewer !== url) {
    return urls.viewer;
  }
  
  // Fallback to download URL
  if (urls.download && urls.download !== url) {
    return urls.download;
  }
  
  return url;
}

/**
 * Check if a URL is accessible and returns PDF content
 * @param {string} url - URL to check
 * @returns {Promise<{isPdf: boolean, accessible: boolean, error?: string}>}
 */
async function validatePdfUrl(url) {
  try {
    // For Google Drive viewer URLs, skip HEAD request as they may require special handling
    if (url.includes('googleusercontent.com/viewer') || url.includes('drive.google.com')) {
      return {
        isPdf: true, // Assume it's a PDF if it's a Google Drive URL
        accessible: true, // Will be validated when actually fetching
        status: 200,
        contentType: 'application/pdf',
        isGoogleDrive: true
      };
    }
    
    const response = await axios.head(url, {
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: (status) => status < 500, // Accept redirects and client errors
    });
    
    const contentType = response.headers['content-type'] || '';
    const isPdf = contentType.includes('application/pdf') || isPdfUrl(url);
    
    return {
      isPdf,
      accessible: response.status === 200,
      status: response.status,
      contentType
    };
  } catch (error) {
    // If HEAD fails, still try to process if URL looks like a PDF
    return {
      isPdf: isPdfUrl(url),
      accessible: true, // Will attempt to fetch anyway
      error: error.message,
      skipValidation: true
    };
  }
}

/**
 * STEP 1: Query Understanding & Expansion (LLM)
 * Converts 1 user question → multiple high-quality search queries
 * 
 * @param {string} userQuestion - User's natural language question
 * @returns {Promise<{intent: string, queries: Array<string>}>}
 */
async function expandQuery(userQuestion) {
  try {
    console.log(`[Query Expansion] Expanding query: "${userQuestion}"`);
    
    const vertex_ai = initializeVertexAI();
    const model = vertex_ai.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
    
    const expansionPrompt = `You are a legal research assistant.

Given the user question, do the following:
1. Identify the intent (legal_research, factual, news, comparative).
2. Generate 3–5 diverse web search queries.
3. Queries must be concise and suitable for a search engine.

User Question:
${userQuestion}

Respond ONLY in valid JSON:
{
  "intent": "",
  "queries": []
}`;

    const result = await model.generateContent(expansionPrompt);
    const responseText = result.response.candidates[0].content.parts[0].text;
    
    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log(`[Query Expansion] Generated ${parsed.queries?.length || 0} queries with intent: ${parsed.intent}`);
      return {
        intent: parsed.intent || 'legal_research',
        queries: parsed.queries || [userQuestion] // Fallback to original if parsing fails
      };
    }
    
    // Fallback: return original query
    console.warn('[Query Expansion] Failed to parse JSON, using original query');
    return {
      intent: 'legal_research',
      queries: [userQuestion]
    };
  } catch (error) {
    console.error('[Query Expansion] Error:', error.message);
    // Fallback: return original query
    return {
      intent: 'legal_research',
      queries: [userQuestion]
    };
  }
}

/**
 * STEP 2: Source Filtering (CRITICAL)
 * Blocks protected portals, login-required sites, CAPTCHA-protected pages
 * 
 * @param {string} url - URL to check
 * @returns {boolean} - True if URL should be blocked
 */
function isBlockedDomain(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    
    // Blocked patterns
    const blockedPatterns = [
      // Court portals (session-based)
      /court.*portal/i,
      /ecourts/i,
      /judis\.nic\.in/i,
      /court.*login/i,
      /portal.*court/i,
      
      // Login-required sites
      /login/i,
      /signin/i,
      /auth/i,
      /secure/i,
      /members/i,
      /subscription/i,
      /paywall/i,
      
      // CAPTCHA-protected
      /captcha/i,
      /recaptcha/i,
      
      // Private/internal
      /intranet/i,
      /internal/i,
      /private/i
    ];
    
    // Check if hostname matches any blocked pattern
    for (const pattern of blockedPatterns) {
      if (pattern.test(hostname) || pattern.test(url)) {
        console.log(`[Source Filter] ❌ Blocked: ${url} (matches pattern: ${pattern})`);
        return true;
      }
    }
    
    // Allowed domains (explicit allowlist for known good sources)
    const allowedPatterns = [
      /indiankanoon\.org/i,
      /manupatra\.com/i,
      /scconline\.com/i,
      /legalcrystal\.com/i,
      /livelaw\.in/i,
      /barandbench\.com/i,
      /\.gov\./i, // Government sites
      /\.edu\./i, // Educational sites
      /\.org/i,   // Organizations
      /\.com/i,   // Commercial (with caution)
      /\.in/i     // Indian domains
    ];
    
    // Check if it's an allowed domain
    const isAllowed = allowedPatterns.some(pattern => pattern.test(hostname));
    
    if (!isAllowed) {
      console.log(`[Source Filter] ⚠️ Unknown domain: ${hostname} - allowing but monitoring`);
    }
    
    return false; // Allow by default if not explicitly blocked
  } catch (error) {
    console.error(`[Source Filter] Error checking URL ${url}:`, error.message);
    return false; // Allow if we can't parse (better to try than block)
  }
}

/**
 * STEP 3: Enhanced Web Search with Multiple Queries
 * Uses Serper API to search with expanded queries
 * 
 * @param {string} userQuestion - Original user question
 * @param {number} numResults - Number of results per query
 * @returns {Promise<{success: boolean, results: Array, error?: string}>}
 */
async function searchForPdfs(userQuestion, numResults = 5) {
  try {
    console.log(`[Web Search] Starting Perplexity-style search for: "${userQuestion}"`);
    
    // STEP 1: Query Expansion
    const { intent, queries } = await expandQuery(userQuestion);
    console.log(`[Web Search] Expanded to ${queries.length} queries with intent: ${intent}`);
    
    // Check for Serper API credentials
    const apiKey = process.env.SERPER_API_KEY;
    
    if (!apiKey) {
      console.warn('[Web Search] Serper API key not found.');
      console.warn('[Web Search] Please set SERPER_API_KEY in .env');
      console.warn('[Web Search] Falling back to Gemini Google Search tool.');
      return await searchForPdfsWithGemini(userQuestion, numResults);
    }

    // STEP 2: Search with all expanded queries
    const allResults = [];
    const seenUrls = new Set(); // For deduplication
    
    for (const query of queries) {
      try {
        // Build Serper API request body
        const requestBody = {
          q: query,
          num: Math.min(numResults, 10) // Serper API supports up to 10 results per request
        };
        
        // Add fileType filter only if user explicitly searches for PDFs
        if (query.toLowerCase().includes('pdf') || query.toLowerCase().includes('filetype:pdf')) {
          requestBody.fileType = 'pdf';
        }
        
        console.log(`[Web Search] Searching with query: "${query}"`);
        
        // Make POST request to Serper API
        const response = await axios.post(
          'https://google.serper.dev/search',
          requestBody,
          {
            headers: {
              'X-API-KEY': apiKey,
              'Content-Type': 'application/json'
            },
            timeout: 20000
          }
        );

        if (response.data && response.data.organic) {
          const searchResults = response.data.organic || [];
          
          // STEP 3: Source Filtering - Remove blocked domains
          // Accept both PDFs and Web HTML pages
          const filteredResults = searchResults.filter(item => {
            if (!item.link) return false;
            
            // Check if URL is blocked
            if (isBlockedDomain(item.link)) {
              return false;
            }
            
            // Check if we've seen this URL before (deduplication)
            if (seenUrls.has(item.link)) {
              return false;
            }
            
            // Accept both PDFs and web pages (HTML content)
            const isPdf = isPdfUrl(item.link);
            const isWeb = isWebPageUrl(item.link);
            
            if (!isPdf && !isWeb) {
              return false; // Skip if neither PDF nor web page
            }
            
            seenUrls.add(item.link);
            return true;
          });
          
          allResults.push(...filteredResults);
          console.log(`[Web Search] Query "${query}": ${filteredResults.length} results after filtering`);
        }
      } catch (queryError) {
        console.error(`[Web Search] Error searching with query "${query}":`, queryError.message);
        // Continue with other queries
        continue;
      }
    }
    
    if (allResults.length === 0) {
      console.warn('[Web Search] No results after filtering');
      console.warn('[Web Search] Falling back to Gemini Google Search tool...');
      return await searchForPdfsWithGemini(userQuestion, numResults);
    }
    
    // STEP 4: Rank by relevance + recency (simple ranking: position in results)
    // Sort by position (lower is better) and limit to max results
    const rankedResults = allResults
      .sort((a, b) => (a.position || 999) - (b.position || 999))
      .slice(0, numResults * 2); // Get more results for chunking later
    
    // STEP 5: Process and format results
    const pdfResults = rankedResults.map((item, index) => {
      // Determine source type dynamically from URL domain
      let sourceType = 'web_search';
      try {
        const urlObj = new URL(item.link);
        const hostname = urlObj.hostname.toLowerCase().replace('www.', '');
        const domainParts = hostname.split('.');
        if (domainParts.length >= 2) {
          sourceType = domainParts[domainParts.length - 2];
        } else {
          sourceType = hostname;
        }
      } catch (e) {
        sourceType = 'web_search';
      }
      
      // Extract citation data from Serper API response
      const citationData = {
        title: item.title || (isPdfUrl(item.link) ? `PDF Document ${index + 1}` : `Web Page ${index + 1}`),
        link: item.link,
        snippet: item.snippet || `Result found for: ${userQuestion}`,
        type: item.type || (isPdfUrl(item.link) ? 'pdf' : 'web'),
        source: sourceType,
        sourceType: sourceType,
        position: index + 1,
        displayLink: item.displayLink || (item.link ? new URL(item.link).hostname : ''),
        date: item.date || null // Serper may provide date
      };
      
      return citationData;
    });

    console.log(`[Web Search] ✅ Found ${pdfResults.length} unique results after filtering and ranking`);
    console.log(`   PDFs: ${pdfResults.filter(r => r.type === 'pdf' || isPdfUrl(r.link)).length}`);
    console.log(`   Web pages: ${pdfResults.filter(r => r.type === 'web' || isWebPageUrl(r.link)).length}`);
    
    return {
      success: pdfResults.length > 0,
      results: pdfResults.slice(0, numResults),
      totalResults: pdfResults.length,
      intent: intent,
      expandedQueries: queries
    };
  } catch (error) {
    console.error('[Web Search] Error in Perplexity-style search:', error.message);
    if (error.response) {
      console.error('[Web Search] API error response:', {
        status: error.response.status,
        data: error.response.data
      });
    }
    console.error('[Web Search] Falling back to Gemini Google Search tool...');
    // Fallback to Gemini if search fails
    return await searchForPdfsWithGemini(userQuestion, numResults);
  }
}

/**
 * Fallback: Search for PDFs using Gemini's Google Search tool
 * @param {string} query - Search query
 * @param {number} numResults - Number of results to return
 * @returns {Promise<{success: boolean, results: Array, error?: string}>}
 */
async function searchForPdfsWithGemini(query, numResults = 5) {
  try {
    console.log(`[Web Search] Using Gemini Google Search tool (fallback) for query: "${query}"`);
    
    const vertex_ai = initializeVertexAI();
    const model = vertex_ai.getGenerativeModel({ 
      model: 'gemini-2.0-flash-exp',
      tools: [{
        googleSearchRetrieval: {}
      }]
    });

    // Generic search prompt without hardcoding any websites
    const searchPrompt = `Search the web for relevant documents and web pages related to: "${query}". 

Please find:
1. PDF files (documents ending in .pdf) - reports, whitepapers, research papers, official documents
2. Web pages - articles, blog posts, official websites, case studies, legal documents

For each result you find, please provide the information in this exact JSON format:
{
  "results": [
    {
      "title": "Document or page title",
      "url": "https://example.com/document.pdf or https://example.com/page",
      "snippet": "Brief description or snippet",
      "type": "pdf" or "web"
    }
  ]
}

Return ONLY valid JSON with the results you found. Find the most relevant results from any website. If no results are found, return: {"results": []}`;

    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [{ text: searchPrompt }]
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json'
      }
    });

    if (!result.response || !result.response.candidates || !result.response.candidates.length) {
      throw new Error('Empty response from Gemini Google Search');
    }

    const responseText = result.response.candidates[0].content.parts[0].text;
    
    // Parse JSON response
    let pdfResults = [];
    try {
      let cleanedText = responseText.trim();
      const jsonMatch = cleanedText.match(/```json\s*([\s\S]*?)\s*```/i);
      if (jsonMatch) {
        cleanedText = jsonMatch[1].trim();
      } else if (cleanedText.startsWith('```')) {
        cleanedText = cleanedText.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
      }
      
      const parsed = JSON.parse(cleanedText);
      if (parsed.results && Array.isArray(parsed.results)) {
        pdfResults = parsed.results
          .filter(item => item.url && (isPdfUrl(item.url) || isWebPageUrl(item.url)))
          .map((item, index) => ({
            title: item.title || (isPdfUrl(item.url) ? `PDF Document ${index + 1}` : `Web Page ${index + 1}`),
            link: item.url,
            snippet: item.snippet || `Result found for: ${query}`,
            type: item.type || (isPdfUrl(item.url) ? 'pdf' : 'web'),
            source: item.source || 'web_search',
            sourceType: item.source || 'web_search',
            position: index + 1
          }));
      }
    } catch (parseError) {
      console.warn('[Web Search] Failed to parse JSON response:', parseError.message);
    }

    console.log(`[Web Search] Found ${pdfResults.length} results using Gemini Google Search (fallback)`);
    
    return {
      success: pdfResults.length > 0,
      results: pdfResults.slice(0, numResults),
      totalResults: pdfResults.length
    };
  } catch (error) {
    console.error('[Web Search] Error with Gemini Google Search fallback:', error.message);
    return {
      success: false,
      results: [],
      error: error.message
    };
  }
}

/**
 * Fetch web page content using headless browser (Puppeteer) for JavaScript-heavy sites
 * @param {string} url - URL to fetch
 * @returns {Promise<{success: boolean, content: string, error?: string}>}
 */
async function fetchWebPageContentWithPuppeteer(url) {
  try {
    let puppeteer;
    try {
      puppeteer = require('puppeteer');
    } catch (e) {
      console.warn('[Web Page] Puppeteer not available, skipping headless browser strategy');
      return { success: false, content: '', error: 'Puppeteer not installed' };
    }

    console.log(`[Web Page] Using Puppeteer for JavaScript-heavy site: ${url}`);
    
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920x1080'
      ]
    });

    try {
      const page = await browser.newPage();
      
      // Set realistic viewport and user agent
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      // Set extra headers
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
      });

      // Navigate to page and wait for content
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      // Wait a bit for any dynamic content to load
      await page.waitForTimeout(2000);

      // Extract content
      const content = await page.evaluate(() => {
        // Remove scripts, styles, etc.
        const scripts = document.querySelectorAll('script, style, noscript');
        scripts.forEach(el => el.remove());

        // Try to find main content
        const mainContent = document.querySelector('main, article, [role="main"], .content, #content, #judgment, #doccontent') || document.body;
        return mainContent.innerText || document.body.innerText;
      });

      if (content && content.trim().length > 50) {
        console.log(`[Web Page] ✅ Puppeteer extracted ${content.length} chars from ${url}`);
        return {
          success: true,
          content: content.trim()
        };
      } else {
        throw new Error('Content too short or empty');
      }
    } finally {
      await browser.close();
    }
  } catch (error) {
    console.error(`[Web Page] ❌ Puppeteer error for ${url}:`, error.message);
    return {
      success: false,
      content: '',
      error: error.message
    };
  }
}

/**
 * Fetch web page content using API service (Serper/Tavily) as fallback
 * @param {string} url - URL to fetch
 * @returns {Promise<{success: boolean, content: string, error?: string}>}
 */
async function fetchWebPageContentWithAPI(url) {
  try {
    // Try Serper.dev API if available
    if (process.env.SERPER_API_KEY) {
      console.log(`[Web Page] Using Serper API for: ${url}`);
      
      try {
        const response = await axios.post(
          'https://google.serper.dev/url',
          { url: url },
          {
            headers: {
              'X-API-KEY': process.env.SERPER_API_KEY,
              'Content-Type': 'application/json'
            },
            timeout: 20000
          }
        );

        if (response.data && response.data.content) {
          console.log(`[Web Page] ✅ Serper API extracted ${response.data.content.length} chars`);
          return {
            success: true,
            content: response.data.content
          };
        }
      } catch (serperError) {
        console.warn(`[Web Page] Serper API failed: ${serperError.message}`);
      }
    }

    // Try Tavily API if available
    if (process.env.TAVILY_API_KEY) {
      console.log(`[Web Page] Using Tavily API for: ${url}`);
      
      try {
        const response = await axios.post(
          'https://api.tavily.com/v1/content',
          { 
            url: url,
            include_raw_content: true
          },
          {
            headers: {
              'api-key': process.env.TAVILY_API_KEY,
              'Content-Type': 'application/json'
            },
            timeout: 20000
          }
        );

        if (response.data && response.data.content) {
          console.log(`[Web Page] ✅ Tavily API extracted ${response.data.content.length} chars`);
          return {
            success: true,
            content: response.data.content
          };
        }
      } catch (tavilyError) {
        console.warn(`[Web Page] Tavily API failed: ${tavilyError.message}`);
      }
    }

    return { success: false, content: '', error: 'No API service available' };
  } catch (error) {
    console.error(`[Web Page] ❌ API fetch error for ${url}:`, error.message);
    return {
      success: false,
      content: '',
      error: error.message
    };
  }
}

/**
 * Fetch and extract text content from a web page URL
 * Uses multiple strategies: axios -> Puppeteer -> API services
 * @param {string} url - URL of the web page
 * @returns {Promise<{success: boolean, content: string, error?: string}>}
 */
async function fetchWebPageContent(url) {
  try {
    console.log(`[Web Page] Fetching content from URL: ${url}`);
    
    // Strategy 1: Try axios first (fastest)
    try {
      // Rotate User-Agent to appear more human-like
      const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      ];
      const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

      // Determine referer dynamically from URL origin (no hardcoding)
      let referer = 'https://www.google.com/';
      try {
        const urlObj = new URL(url);
        referer = `${urlObj.protocol}//${urlObj.hostname}`;
      } catch (e) {
        // If URL parsing fails, use Google as default referer
        referer = 'https://www.google.com/';
      }

      const response = await axios.get(url, {
      timeout: 30000, // Increased timeout for legal sites
      headers: {
        'User-Agent': randomUserAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8', // Include Hindi for Indian sites
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
        'Referer': referer,
        'Origin': new URL(url).origin
      },
      maxRedirects: 10, // More redirects for legal sites
      validateStatus: (status) => status < 400,
      decompress: true // Handle gzip/deflate
    });

    let content = response.data;
    
    if (typeof content === 'string') {
      // Use cheerio for better HTML parsing (especially for Indian legal sites)
      let cheerio;
      try {
        cheerio = require('cheerio');
      } catch (e) {
        console.warn('[Web Page] cheerio not available, using regex extraction');
      }
      
      let extractedContent = content;
      
      // Generic content extraction using cheerio (no site-specific hardcoding)
      if (cheerio) {
        // General cheerio extraction for other sites
        console.log('[Web Page] Using cheerio for general extraction');
        const $ = cheerio.load(content);
        
        // Remove script, style, nav, header, footer
        $('script, style, nav, header, footer, aside, .sidebar, .navigation, .menu').remove();
        
        // Try to find main content
        const mainContent = $('main, article, [role="main"], .content, #content, .main-content').first();
        if (mainContent.length > 0) {
          extractedContent = mainContent.text();
          console.log(`[Web Page] Extracted from main content area: ${extractedContent.length} chars`);
        } else {
          extractedContent = $('body').text();
        }
      } else {
        // Fallback to regex extraction
        console.log('[Web Page] Using regex extraction (cheerio not available)');
        const contentSelectors = [
          /<div[^>]*id="judgment"[^>]*>([\s\S]*?)<\/div>/i,
          /<div[^>]*id="doccontent"[^>]*>([\s\S]*?)<\/div>/i,
          /<div[^>]*id="main_content"[^>]*>([\s\S]*?)<\/div>/i,
          /<div[^>]*class="[^"]*judgment[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
          /<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
          /<article[^>]*>([\s\S]*?)<\/article>/i,
          /<main[^>]*>([\s\S]*?)<\/main>/i
        ];
        
        for (const selector of contentSelectors) {
          const match = content.match(selector);
          if (match && match[1] && match[1].length > 500) {
            extractedContent = match[1];
            console.log(`[Web Page] Found content area using regex, extracted ${extractedContent.length} chars`);
            break;
          }
        }
      }
      
      // Clean up the extracted content
      extractedContent = extractedContent
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/h[1-6]>/gi, '\n\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      
      // If content is too short after extraction, use the full page
      if (extractedContent.length < 200) {
        console.log(`[Web Page] Extracted content too short (${extractedContent.length} chars), using full page`);
        extractedContent = content
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }
      
      content = extractedContent;
      
      // Limit content length to avoid token limits (keep more for legal documents)
      if (content.length > 100000) {
        content = content.substring(0, 100000) + '... [Content truncated]';
        console.warn(`[Web Page] Content truncated to 100000 chars for URL: ${url}`);
      }
      
      // Ensure we have meaningful content
      if (content.length < 50) {
        throw new Error('Extracted content is too short or empty');
      }
    } else {
      throw new Error('Response is not text/HTML');
    }

      console.log(`[Web Page] ✅ Successfully fetched and extracted ${content.length} chars from ${url} (axios)`);
      console.log(`[Web Page] Content preview (first 300 chars): ${content.substring(0, 300)}...`);
      
      return {
        success: true,
        content: content,
        url: url // Return URL for citation storage
      };
    } catch (axiosError) {
      console.warn(`[Web Page] ⚠️ Axios failed for ${url}: ${axiosError.message}`);
      
      // Strategy 2: Try Puppeteer for JavaScript-heavy sites
      if (axiosError.response && (axiosError.response.status === 403 || axiosError.response.status === 429)) {
        console.log(`[Web Page] Detected 403/429, trying Puppeteer...`);
        const puppeteerResult = await fetchWebPageContentWithPuppeteer(url);
        if (puppeteerResult.success) {
          return { ...puppeteerResult, url };
        }
      }

      // Strategy 3: Try API services (Serper/Tavily)
      console.log(`[Web Page] Trying API services as fallback...`);
      const apiResult = await fetchWebPageContentWithAPI(url);
      if (apiResult.success) {
        return { ...apiResult, url };
      }

      // All strategies failed
      throw axiosError;
    }
  } catch (error) {
    console.error(`[Web Page] ❌ All strategies failed for ${url}:`, error.message);
    console.error(`[Web Page] Error stack:`, error.stack);
    return {
      success: false,
      content: '',
      url: url,
      error: error.message
    };
  }
}

/**
 * Process web page content using Gemini
 * @param {string} url - URL of the web page
 * @param {string} question - User's question
 * @param {string} modelName - Gemini model to use
 * @returns {Promise<{success: boolean, content: string, citation: object, error?: string}>}
 */
async function processWebPageFromUrl(url, question, modelName = 'gemini-2.0-flash-exp') {
  try {
    console.log(`[Web Page Processing] Processing web page from URL: ${url}`);
    
    // Fetch the web page content
    const fetchResult = await fetchWebPageContent(url);
    if (!fetchResult.success) {
      throw new Error(`Failed to fetch web page: ${fetchResult.error || 'Unknown error'}`);
    }

    const vertex_ai = initializeVertexAI();
    const model = vertex_ai.getGenerativeModel({ model: modelName });

    // Validate content was fetched
    if (!fetchResult.content || fetchResult.content.trim().length < 50) {
      throw new Error(`Web page content is empty or too short (${fetchResult.content?.length || 0} chars). The page may require JavaScript or authentication.`);
    }

    const prompt = `You are analyzing a legal judgment/case document from a web page. The user has provided the full text content below.

**IMPORTANT**: 
- The content below has been SUCCESSFULLY RETRIEVED from the web page at: ${url}
- You HAVE access to this content and MUST use it to answer the user's question
- Do NOT say you cannot access the website - the content has already been fetched and provided below
- If the user asked to "check" a website, use the provided content to answer

**Web Page Content (from ${url}):**
${fetchResult.content}

**User Question:** ${question}

Please provide a comprehensive answer based on the content above. For legal judgments, include:
- Case name and parties
- Key facts
- Legal issues
- Court's decision and reasoning
- Important legal principles
- Similar or related cases if mentioned

Be specific, accurate, and cite details from the content. If the user asked for a summary in a specific word count, respect that limit.`;

    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
      }
    });

    if (!result.response || !result.response.candidates || !result.response.candidates.length) {
      throw new Error('Empty response from Gemini');
    }

    const content = result.response.candidates[0].content.parts[0].text;
    
    // Extract title from content if possible
    let pageTitle = 'Web Page';
    try {
      if (fetchResult.content) {
        const titleMatch = fetchResult.content.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch && titleMatch[1]) {
          pageTitle = titleMatch[1].trim();
        }
      }
    } catch (e) {
      // Ignore title extraction errors
    }

    // Determine source type dynamically from URL domain (no hardcoding)
    let sourceType = 'web_page';
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase().replace('www.', '');
      const domainParts = hostname.split('.');
      if (domainParts.length >= 2) {
        sourceType = domainParts[domainParts.length - 2]; // Extract domain name
      } else {
        sourceType = hostname;
      }
    } catch (e) {
      sourceType = 'web_page';
    }
    
    const citation = {
      title: pageTitle,
      url: url,
      source: sourceType,
      type: 'web',
      isWebSource: true,
      snippet: content.substring(0, 200) // First 200 chars as snippet
    };

    console.log(`[Web Page Processing] Successfully processed web page from ${url}`);
    console.log(`[Web Page Processing] Citation: ${JSON.stringify(citation)}`);
    
    return {
      success: true,
      content,
      citation
    };
  } catch (error) {
    console.error(`[Web Page Processing] Error processing web page from ${url}:`, error.message);
    return {
      success: false,
      content: '',
      citation: { url: url, title: 'Web Page', source: 'web_page' },
      error: `Failed to process web page: ${error.message}`
    };
  }
}

/**
 * Stream web page processing
 */
async function* streamWebPageFromUrl(url, question, modelName = 'gemini-2.0-flash-exp') {
  try {
    console.log(`[Web Page Processing] Streaming web page from URL: ${url}`);
    
    // Fetch the web page content
    const fetchResult = await fetchWebPageContent(url);
    if (!fetchResult.success) {
      throw new Error(`Failed to fetch web page: ${fetchResult.error || 'Unknown error'}`);
    }

    const vertex_ai = initializeVertexAI();
    const model = vertex_ai.getGenerativeModel({ model: modelName });

    // Validate content was fetched
    if (!fetchResult.content || fetchResult.content.trim().length < 50) {
      throw new Error(`Web page content is empty or too short (${fetchResult.content?.length || 0} chars). The page may require JavaScript or authentication.`);
    }

    const prompt = `You are analyzing a legal judgment/case document from a web page. The user has provided the full text content below.

**IMPORTANT**: 
- The content below has been SUCCESSFULLY RETRIEVED from the web page at: ${url}
- You HAVE access to this content and MUST use it to answer the user's question
- Do NOT say you cannot access the website - the content has already been fetched and provided below
- If the user asked to "check" a website, use the provided content to answer

**Web Page Content (from ${url}):**
${fetchResult.content}

**User Question:** ${question}

Please provide a comprehensive answer based on the content above. For legal judgments, include:
- Case name and parties
- Key facts
- Legal issues
- Court's decision and reasoning
- Important legal principles
- Similar or related cases if mentioned

Be specific, accurate, and cite details from the content. If the user asked for a summary in a specific word count, respect that limit.`;

    const streamingResp = await model.generateContentStream({
      contents: [{
        role: 'user',
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
      }
    });

    for await (const chunk of streamingResp.stream) {
      let chunkText = '';
      
      if (chunk.text) {
        chunkText = chunk.text;
      } else if (chunk.candidates && chunk.candidates[0]) {
        const candidate = chunk.candidates[0];
        if (candidate.content && candidate.content.parts) {
          for (const part of candidate.content.parts) {
            if (part.text) {
              chunkText += part.text;
            }
          }
        }
      }
      
      if (chunkText) {
        yield chunkText;
      }
    }
  } catch (error) {
    console.error(`[Web Page Processing] Streaming error:`, error.message);
    throw new Error(`Web page streaming failed: ${error.message}`);
  }
}

/**
 * Process PDF from URL using Gemini multimodal pipeline
 * @param {string} pdfUrl - URL of the PDF to process
 * @param {string} question - User's question about the PDF
 * @param {string} modelName - Gemini model to use (default: gemini-2.0-flash-exp)
 * @returns {Promise<{success: boolean, content: string, citation: object, error?: string}>}
 */
async function processPdfFromUrl(pdfUrl, question, modelName = 'gemini-2.0-flash-exp') {
  try {
    console.log(`[PDF Processing] Processing PDF from URL: ${pdfUrl}`);
    
    // Get multiple URL options for Google Drive
    const urlOptions = convertGoogleDriveUrl(pdfUrl);
    let processedUrl = getBestUrlForProcessing(pdfUrl);
    
    if (processedUrl !== pdfUrl) {
      console.log(`[PDF Processing] Converted Google Drive URL: ${pdfUrl} -> ${processedUrl}`);
      console.log(`[PDF Processing] Available URL options:`, Object.keys(urlOptions).filter(k => k !== 'original'));
    }
    
    // Validate URL (skip strict validation for Google Drive URLs)
    const validation = await validatePdfUrl(processedUrl);
    if (!validation.skipValidation && !validation.accessible && !validation.isPdf) {
      console.warn(`[PDF Processing] URL validation warning: ${validation.error || 'Unknown error'}, but attempting to process anyway`);
    }

    const vertex_ai = initializeVertexAI();
    const model = vertex_ai.getGenerativeModel({ model: modelName });

    // Build prompt with multimodal instructions
    const prompt = `You are analyzing a PDF document from the web. Please extract and analyze the following:

1. **Text Content**: Extract all readable text from the document
2. **Tables**: Identify and extract data from any tables present
3. **Visual Data**: Analyze charts, graphs, and visual elements, describing their content and key insights
4. **Structure**: Identify document sections, headings, and organization

User Question: ${question}

Please provide a comprehensive answer based on the PDF content. Include specific details, quotes, and data points where relevant.`;

    // Use Gemini's fileData capability to process PDF from URL
    // Note: Gemini can process PDFs directly from URLs if they're publicly accessible
    // For Google Drive viewer URLs, try the original URL first, then fallback to download
    const parts = [
      {
        fileData: {
          mimeType: 'application/pdf',
          fileUri: processedUrl
        }
      },
      { text: prompt }
    ];

    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: parts
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
      }
    });

    if (!result.response || !result.response.candidates || !result.response.candidates.length) {
      throw new Error('Empty response from Gemini');
    }

    const content = result.response.candidates[0].content.parts[0].text;
    
    const citation = {
      title: 'PDF Document',
      url: pdfUrl, // Use original URL for citation
      source: 'web_pdf',
      type: 'pdf',
      isWebSource: true,
      snippet: content.substring(0, 200) // First 200 chars as snippet
    };

    console.log(`[PDF Processing] Successfully processed PDF from ${pdfUrl}`);
    console.log(`[PDF Processing] Citation: ${JSON.stringify(citation)}`);
    
    return {
      success: true,
      content,
      citation
    };
  } catch (error) {
    console.error(`[PDF Processing] Error processing PDF from ${pdfUrl}:`, error.message);
    console.error(`[PDF Processing] Error details:`, error);
    console.error(`[PDF Processing] Error stack:`, error.stack);
    
    // For Google Drive URLs, try alternative URL formats before fallback
    if (pdfUrl.includes('drive.google.com')) {
      const urlOptions = convertGoogleDriveUrl(pdfUrl);
      const alternativeUrls = [
        urlOptions.direct,
        urlOptions.download,
        urlOptions.viewer
      ].filter(url => url && url !== processedUrl);
      
      for (const altUrl of alternativeUrls) {
        try {
          console.log(`[PDF Processing] Trying alternative Google Drive URL: ${altUrl}`);
          const vertex_ai = initializeVertexAI();
          const model = vertex_ai.getGenerativeModel({ model: modelName });
          
          const prompt = `You are analyzing a PDF document from Google Drive. Please extract and analyze the following:

1. **Text Content**: Extract all readable text from the document
2. **Tables**: Identify and extract data from any tables present
3. **Visual Data**: Analyze charts, graphs, and visual elements, describing their content and key insights
4. **Structure**: Identify document sections, headings, and organization

User Question: ${question}

Please provide a comprehensive answer based on the PDF content. Include specific details, quotes, and data points where relevant.`;

          const parts = [
            {
              fileData: {
                mimeType: 'application/pdf',
                fileUri: altUrl
              }
            },
            { text: prompt }
          ];

          const result = await model.generateContent({
            contents: [{
              role: 'user',
              parts: parts
            }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 8192,
            }
          });

          if (result.response && result.response.candidates && result.response.candidates.length) {
            const content = result.response.candidates[0].content.parts[0].text;
            console.log(`[PDF Processing] Successfully processed PDF using alternative URL: ${altUrl}`);
            
            return {
              success: true,
              content,
              citation: {
                title: 'PDF Document',
                url: pdfUrl,
                source: 'web_pdf',
                type: 'pdf',
                isWebSource: true,
                snippet: content.substring(0, 200)
              }
            };
          }
        } catch (altError) {
          console.warn(`[PDF Processing] Alternative URL ${altUrl} also failed:`, altError.message);
          continue;
        }
      }
    }
    
    // Try fallback: download and process as base64
    try {
      console.log(`[PDF Processing] Attempting fallback method (download as base64)...`);
      return await processPdfFromUrlFallback(pdfUrl, question, modelName);
    } catch (fallbackError) {
      console.error(`[PDF Processing] Fallback also failed:`, fallbackError.message);
      return {
        success: false,
        content: '',
        citation: { url: pdfUrl, title: 'PDF Document', source: 'web_pdf' },
        error: `Failed to process PDF: ${error.message}. Tried multiple URL formats and fallback method, all failed. Please ensure the file is publicly accessible.`
      };
    }
  }
}

/**
 * Fallback method: Download PDF and process as base64
 * @param {string} pdfUrl - URL of the PDF
 * @param {string} question - User's question
 * @param {string} modelName - Model to use
 * @returns {Promise<{success: boolean, content: string, citation: object}>}
 */
async function processPdfFromUrlFallback(pdfUrl, question, modelName = 'gemini-2.0-flash-exp') {
  try {
    console.log(`[PDF Processing] Using fallback method: downloading PDF from ${pdfUrl}`);
    
    // Get the best download URL for Google Drive
    const urlOptions = convertGoogleDriveUrl(pdfUrl);
    let downloadUrl = urlOptions.download || pdfUrl;
    
    // Try multiple download URL formats for Google Drive
    const downloadUrlsToTry = [];
    if (urlOptions.fileId) {
      // Try different Google Drive download formats
      downloadUrlsToTry.push(
        `https://drive.google.com/uc?export=download&id=${urlOptions.fileId}`,
        `https://drive.google.com/uc?export=view&id=${urlOptions.fileId}`,
        `https://drive.google.com/file/d/${urlOptions.fileId}/view?usp=sharing`
      );
    } else {
      downloadUrlsToTry.push(downloadUrl);
    }
    
    // Download PDF with appropriate headers for Google Drive
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'application/pdf,application/octet-stream,*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://drive.google.com/'
    };
    
    let pdfBuffer = null;
    let lastError = null;
    
    // Try each download URL until one works
    for (const tryUrl of downloadUrlsToTry) {
      try {
        console.log(`[PDF Processing] Attempting to download from: ${tryUrl}`);
        const response = await axios.get(tryUrl, {
          responseType: 'arraybuffer',
          timeout: 30000,
          maxContentLength: 50 * 1024 * 1024, // 50MB limit
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/pdf,application/octet-stream,*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': pdfUrl.includes('drive.google.com') ? 'https://drive.google.com/' : undefined
          },
          maxRedirects: 10, // Increased redirects
          validateStatus: (status) => status < 400, // Accept redirects
        });
        
        console.log(`[PDF Processing] Download response:`, {
          status: response.status,
          contentType: response.headers['content-type'],
          contentLength: response.data?.length || 0
        });
        
        // Check if we got a PDF or HTML (Google Drive sometimes returns HTML for authentication pages)
        const contentType = response.headers['content-type'] || '';
        if (contentType.includes('application/pdf')) {
          pdfBuffer = Buffer.from(response.data);
          console.log(`[PDF Processing] ✅ Successfully downloaded PDF (${pdfBuffer.length} bytes) from: ${tryUrl}`);
          break;
        } else if (response.data && response.data.length > 1000 && !contentType.includes('text/html')) {
          // Assume it's a PDF if it's binary data and large enough
          pdfBuffer = Buffer.from(response.data);
          console.log(`[PDF Processing] ✅ Downloaded binary data (${pdfBuffer.length} bytes), assuming PDF from: ${tryUrl}`);
          break;
        } else if (contentType.includes('text/html')) {
          console.warn(`[PDF Processing] ⚠️ Received HTML instead of PDF from ${tryUrl} - file may require authentication`);
          lastError = new Error('File requires authentication or is not publicly accessible');
          continue;
        } else {
          console.warn(`[PDF Processing] ⚠️ Unexpected content type: ${contentType} from ${tryUrl}`);
          lastError = new Error(`Unexpected content type: ${contentType}`);
          continue;
        }
      } catch (downloadError) {
        console.warn(`[PDF Processing] ❌ Failed to download from ${tryUrl}:`, downloadError.message);
        if (downloadError.response) {
          console.warn(`   Response status: ${downloadError.response.status}`);
          console.warn(`   Response headers:`, downloadError.response.headers);
        }
        lastError = downloadError;
        continue;
      }
    }
    
    if (!pdfBuffer) {
      throw lastError || new Error('Failed to download PDF from any URL format');
    }
    
    const base64Data = pdfBuffer.toString('base64');

    const vertex_ai = initializeVertexAI();
    const model = vertex_ai.getGenerativeModel({ model: modelName });

    const prompt = `You are analyzing a PDF document. Please extract and analyze:

1. **Text Content**: Extract all readable text
2. **Tables**: Identify and extract data from tables
3. **Visual Data**: Analyze charts, graphs, and visual elements
4. **Structure**: Identify document sections and organization

User Question: ${question}

Provide a comprehensive answer with specific details and data points.`;

    const parts = [
      {
        inlineData: {
          mimeType: 'application/pdf',
          data: base64Data
        }
      },
      { text: prompt }
    ];

    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: parts
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
      }
    });

    const content = result.response.candidates[0].content.parts[0].text;
    
    return {
      success: true,
      content,
      citation: {
        title: 'PDF Document',
        url: pdfUrl,
        source: 'web_pdf',
        type: 'pdf',
        isWebSource: true,
        snippet: content.substring(0, 200) // First 200 chars as snippet
      }
    };
  } catch (error) {
    throw new Error(`Fallback processing failed: ${error.message}`);
  }
}

/**
 * Stream PDF processing for real-time responses
 * @param {string} pdfUrl - URL of the PDF
 * @param {string} question - User's question
 * @param {string} modelName - Model to use
 * @returns {AsyncGenerator<string>} - Stream of text chunks
 */
async function* streamPdfFromUrl(pdfUrl, question, modelName = 'gemini-2.0-flash-exp') {
  try {
    console.log(`[PDF Processing] Streaming PDF from URL: ${pdfUrl}`);
    
    // Get the best URL for processing
    let processedUrl = getBestUrlForProcessing(pdfUrl);
    if (processedUrl !== pdfUrl) {
      console.log(`[PDF Processing] Converted Google Drive URL for streaming: ${pdfUrl} -> ${processedUrl}`);
    }
    
    const vertex_ai = initializeVertexAI();
    const model = vertex_ai.getGenerativeModel({ model: modelName });

    const prompt = `You are analyzing a PDF document from the web. Extract and analyze:

1. **Text Content**: All readable text
2. **Tables**: Data from tables
3. **Visual Data**: Charts, graphs, and visual elements
4. **Structure**: Document sections and organization

User Question: ${question}

Provide a comprehensive answer with specific details.`;

    const parts = [
      {
        fileData: {
          mimeType: 'application/pdf',
          fileUri: processedUrl
        }
      },
      { text: prompt }
    ];

    const streamingResp = await model.generateContentStream({
      contents: [{
        role: 'user',
        parts: parts
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
      }
    });

    for await (const chunk of streamingResp.stream) {
      let chunkText = '';
      
      if (chunk.text) {
        chunkText = chunk.text;
      } else if (chunk.candidates && chunk.candidates[0]) {
        const candidate = chunk.candidates[0];
        if (candidate.content && candidate.content.parts) {
          for (const part of candidate.content.parts) {
            if (part.text) {
              chunkText += part.text;
            }
          }
        }
      }
      
      if (chunkText) {
        yield chunkText;
      }
    }
  } catch (error) {
    console.error(`[PDF Processing] Streaming error:`, error.message);
    // Try fallback
    try {
      yield* await streamPdfFromUrlFallback(pdfUrl, question, modelName);
    } catch (fallbackError) {
      throw new Error(`PDF streaming failed: ${error.message}`);
    }
  }
}

/**
 * Fallback streaming method
 */
async function* streamPdfFromUrlFallback(pdfUrl, question, modelName) {
  try {
    // Get the best download URL for Google Drive
    const urlOptions = convertGoogleDriveUrl(pdfUrl);
    let downloadUrl = urlOptions.download || pdfUrl;
    
    // Try multiple download URL formats for Google Drive
    const downloadUrlsToTry = [];
    if (urlOptions.fileId) {
      downloadUrlsToTry.push(
        `https://drive.google.com/uc?export=download&id=${urlOptions.fileId}`,
        `https://drive.google.com/uc?export=view&id=${urlOptions.fileId}`
      );
    } else {
      downloadUrlsToTry.push(downloadUrl);
    }
    
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/pdf,application/octet-stream,*/*',
      'Referer': 'https://drive.google.com/'
    };
    
    let pdfBuffer = null;
    for (const tryUrl of downloadUrlsToTry) {
      try {
        const response = await axios.get(tryUrl, {
          responseType: 'arraybuffer',
          timeout: 30000,
          headers,
          maxRedirects: 5,
        });
        
        const contentType = response.headers['content-type'] || '';
        if (contentType.includes('application/pdf') || response.data.length > 1000) {
          pdfBuffer = Buffer.from(response.data);
          break;
        }
      } catch (err) {
        continue;
      }
    }
    
    if (!pdfBuffer) {
      throw new Error('Failed to download PDF from Google Drive');
    }
    
    const base64Data = pdfBuffer.toString('base64');

    const vertex_ai = initializeVertexAI();
    const model = vertex_ai.getGenerativeModel({ model: modelName });

    const prompt = `Analyze this PDF document. Extract text, tables, and visual data.

User Question: ${question}`;

    const parts = [
      {
        inlineData: {
          mimeType: 'application/pdf',
          data: base64Data
        }
      },
      { text: prompt }
    ];

    const streamingResp = await model.generateContentStream({
      contents: [{
        role: 'user',
        parts: parts
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
      }
    });

    for await (const chunk of streamingResp.stream) {
      let chunkText = '';
      
      if (chunk.text) {
        chunkText = chunk.text;
      } else if (chunk.candidates && chunk.candidates[0]) {
        const candidate = chunk.candidates[0];
        if (candidate.content && candidate.content.parts) {
          for (const part of candidate.content.parts) {
            if (part.text) {
              chunkText += part.text;
            }
          }
        }
      }
      
      if (chunkText) {
        yield chunkText;
      }
    }
  } catch (error) {
    throw new Error(`Fallback streaming failed: ${error.message}`);
  }
}

/**
 * Main function: Analyze query and process PDFs
 * @param {string} query - User query
 * @param {string} question - Refined question (if different from query)
 * @returns {Promise<{hasUrl: boolean, pdfUrl?: string, needsSearch: boolean, searchResults?: Array, processedContent?: string, citations?: Array}>}
 */
async function analyzeAndProcessPdfQuery(query, question = null) {
  const userQuestion = question || query;
  
  // Step 1: Check if URL is provided in query
  const urls = extractUrlsFromQuery(query);
  
  if (urls.length > 0) {
    const url = urls[0];
    console.log(`[Web Search] URL detected in query: ${url}`);
    
    // Check if it's a PDF URL
    const isPdf = isPdfUrl(url) || 
                  url.toLowerCase().includes('googleusercontent.com') || 
                  url.toLowerCase().includes('drive.google.com') ||
                  url.toLowerCase().includes('viewer') ||
                  url.toLowerCase().includes('/pdf/');
    
    // Check if it's a web page URL
    const isWebPage = isWebPageUrl(url);
    
    if (isPdf) {
      // Process PDF directly from provided URL
      console.log(`[Web Search] PDF/Document URL detected: ${url}`);
      console.log(`[Web Search] URL type: ${url.includes('google') ? 'Google Drive' : 'Direct PDF'}`);
      
      const result = await processPdfFromUrl(url, userQuestion);
      
      return {
        hasUrl: true,
        pdfUrl: url,
        needsSearch: false,
        processedContent: result.content,
        citations: [result.citation],
        success: result.success,
        error: result.error
      };
    } else if (isWebPage) {
      // Process web page content
      console.log(`[Web Search] Web page URL detected: ${url}`);
      
      const result = await processWebPageFromUrl(url, userQuestion);
      
      return {
        hasUrl: true,
        pdfUrl: url,
        needsSearch: false,
        processedContent: result.content,
        citations: [result.citation],
        success: result.success,
        error: result.error,
        isWebPage: true
      };
    }
  }
  
  // Step 2: Determine if search is needed
  // ONLY search when user EXPLICITLY requests web search
  const explicitWebSearchKeywords = [
    'search from the web',
    'search on web',
    'search on the web',
    'search online',
    'search the internet',
    'search the web',
    'search web',
    'find on web',
    'find on the web',
    'find online',
    'look up online',
    'look up on web',
    'google search',
    'web search',
    'internet search',
    'use web search',
    'check online',
    'check the web',
    'get from web',
    'get from internet',
    'from web',
    'from the web',
    'from internet',
    'answer from web',
    'answer from the web',
    'tell me from web',
    'web se', // Partial matches for "web search"
    'web pe', // Hindi/English mix
    'online search',
    'internet se', // Hindi/English mix
    'web par search', // Hindi/English mix
    'web se dekh', // Hindi/English mix
    'web pe dekh', // Hindi/English mix
    'web se batao', // Hindi/English mix
    'web pe batao' // Hindi/English mix
  ];
  
  const queryLower = query.toLowerCase();
  const needsSearch = explicitWebSearchKeywords.some(keyword => queryLower.includes(keyword));
  
  if (needsSearch) {
    console.log(`[Web Search] Search required for query: "${query}"`);
    
    const searchResults = await searchForPdfs(query, 3); // Get top 3 PDFs
    
    if (searchResults.success && searchResults.results.length > 0) {
      // Process the most relevant PDF
      const topPdf = searchResults.results[0];
      console.log(`[Web Search] Processing top PDF result: ${topPdf.link}`);
      
      const result = await processPdfFromUrl(topPdf.link, userQuestion);
      
      // Build citations for all found PDFs
      const citations = [
        {
          ...result.citation,
          title: topPdf.title,
          snippet: topPdf.snippet
        },
        ...searchResults.results.slice(1).map(pdf => ({
          title: pdf.title,
          url: pdf.link,
          snippet: pdf.snippet,
          source: 'web_search',
          type: 'pdf'
        }))
      ];
      
      return {
        hasUrl: false,
        needsSearch: true,
        searchResults: searchResults.results,
        processedContent: result.content,
        citations,
        success: result.success,
        error: result.error
      };
    }
    
    return {
      hasUrl: false,
      needsSearch: true,
      searchResults: [],
      processedContent: '',
      citations: [],
      success: false,
      error: 'No PDFs found in search results'
    };
  }
  
  // No URL and no search needed
  return {
    hasUrl: false,
    needsSearch: false,
    processedContent: '',
    citations: []
  };
}

/**
 * Stream version of analyzeAndProcessPdfQuery
 */
async function* streamAnalyzeAndProcessPdfQuery(query, question = null) {
  const userQuestion = question || query;
  
  const urls = extractUrlsFromQuery(query);
  
  if (urls.length > 0) {
    const url = urls[0];
    
    // Check if it's a PDF URL
    const isPdf = isPdfUrl(url) || 
                  url.toLowerCase().includes('googleusercontent.com') || 
                  url.toLowerCase().includes('drive.google.com') ||
                  url.toLowerCase().includes('viewer') ||
                  url.toLowerCase().includes('/pdf/');
    
    // Check if it's a web page URL
    const isWebPage = isWebPageUrl(url);
    
    if (isPdf) {
      console.log(`[Web Search] Streaming PDF/Document from URL: ${url}`);
      yield* streamPdfFromUrl(url, userQuestion);
      return;
    } else if (isWebPage) {
      console.log(`[Web Search] Streaming web page from URL: ${url}`);
      yield* streamWebPageFromUrl(url, userQuestion);
      return;
    }
  }
  
  // ONLY search when user EXPLICITLY requests web search
  const explicitWebSearchKeywords = [
    'search from the web',
    'search on web',
    'search on the web',
    'search online',
    'search the internet',
    'search the web',
    'search web',
    'find on web',
    'find on the web',
    'find online',
    'look up online',
    'look up on web',
    'google search',
    'web search',
    'internet search',
    'use web search',
    'check online',
    'check the web',
    'get from web',
    'get from internet',
    'from web',
    'from the web',
    'from internet',
    'answer from web',
    'answer from the web',
    'tell me from web',
    'web se',
    'web pe',
    'online search',
    'internet se',
    'web par search',
    'web se dekh',
    'web pe dekh',
    'web se batao',
    'web pe batao'
  ];
  
  const queryLower = query.toLowerCase();
  const needsSearch = explicitWebSearchKeywords.some(keyword => queryLower.includes(keyword));
  
  if (needsSearch) {
    const searchResults = await searchForPdfs(query, 3);
    
    if (searchResults.success && searchResults.results.length > 0) {
      const topPdf = searchResults.results[0];
      yield* streamPdfFromUrl(topPdf.link, userQuestion);
      return;
    }
  }
  
  throw new Error('No PDF URL provided and search did not find any PDFs');
}

/**
 * STEP 6: Evidence Chunking
 * Break content into small factual chunks (300-600 tokens max, one idea per chunk)
 * 
 * @param {string} content - Raw content to chunk
 * @param {string} source - Source name
 * @param {string} url - Source URL
 * @param {string} date - Optional date
 * @returns {Array<{text: string, source: string, url: string, date?: string}>}
 */
function chunkEvidence(content, source, url, date = null) {
  if (!content || content.trim().length === 0) {
    return [];
  }
  
  // Simple chunking: split by sentences, then group into ~500 token chunks
  const sentences = content.split(/[.!?]+\s+/).filter(s => s.trim().length > 20);
  const chunks = [];
  let currentChunk = '';
  let currentTokenCount = 0;
  const maxTokens = 500; // Approximate: 1 token ≈ 4 characters
  
  for (const sentence of sentences) {
    const sentenceTokens = Math.ceil(sentence.length / 4);
    
    if (currentTokenCount + sentenceTokens > maxTokens && currentChunk.length > 0) {
      // Save current chunk and start new one
      chunks.push({
        text: currentChunk.trim(),
        source: source,
        url: url,
        date: date || null
      });
      currentChunk = sentence;
      currentTokenCount = sentenceTokens;
    } else {
      currentChunk += (currentChunk ? '. ' : '') + sentence;
      currentTokenCount += sentenceTokens;
    }
  }
  
  // Add remaining chunk
  if (currentChunk.trim().length > 0) {
    chunks.push({
      text: currentChunk.trim(),
      source: source,
      url: url,
      date: date || null
    });
  }
  
  console.log(`[Evidence Chunking] Created ${chunks.length} chunks from ${source}`);
  return chunks;
}

/**
 * STEP 7: Evidence Filtering (LLM)
 * Remove opinions, speculation, promotional text. Keep only factual, verifiable statements.
 * 
 * @param {string} rawText - Raw web text
 * @returns {Promise<string>} - Clean evidence snippets
 */
async function filterEvidence(rawText) {
  try {
    const vertex_ai = initializeVertexAI();
    const model = vertex_ai.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
    
    const filterPrompt = `You are reviewing extracted web content.

Your task:
1. Keep only factual, verifiable statements.
2. Remove opinions, speculation, and promotional text.
3. Preserve legal findings, dates, case names, and principles.

Text:
${rawText.substring(0, 8000)} // Limit to avoid token limits

Return a list of clean evidence snippets. Each snippet should be a factual statement.`;

    const result = await model.generateContent(filterPrompt);
    const filteredText = result.response.candidates[0].content.parts[0].text;
    
    return filteredText;
  } catch (error) {
    console.error('[Evidence Filtering] Error:', error.message);
    // Return original text if filtering fails
    return rawText;
  }
}

/**
 * STEP 8: Citation-First Answer Synthesis (LLM)
 * Generate answer with strict citation requirements
 * 
 * @param {Array<{text: string, source: string, url: string, date?: string}>} evidenceChunks - Evidence chunks with metadata
 * @param {string} userQuestion - User's question
 * @returns {Promise<{answer: string, citations: Array, confidence: 'high'|'medium'|'low'}>}
 */
async function synthesizeAnswerWithCitations(evidenceChunks, userQuestion) {
  try {
    // Check confidence: need at least 2 reliable sources
    if (evidenceChunks.length < 2) {
      return {
        answer: "Reliable sources were insufficient to provide a confident answer to this query.",
        citations: [],
        confidence: 'low'
      };
    }
    
    // Count unique sources
    const uniqueSources = new Set(evidenceChunks.map(c => c.url));
    if (uniqueSources.size < 2) {
      return {
        answer: "Reliable sources were insufficient to provide a confident answer to this query.",
        citations: [],
        confidence: 'low'
      };
    }
    
    const vertex_ai = initializeVertexAI();
    const model = vertex_ai.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
    
    // Format evidence chunks with metadata
    const evidenceText = evidenceChunks.map((chunk, idx) => {
      return `[Source ${idx + 1}] ${chunk.source}\nURL: ${chunk.url}${chunk.date ? `\nDate: ${chunk.date}` : ''}\nContent: ${chunk.text}`;
    }).join('\n\n');
    
    const synthesisPrompt = `You are a citation-driven legal AI assistant.

STRICT RULES:
- Every statement MUST be supported by at least one source.
- Do NOT use general knowledge.
- If no source supports a claim, omit it.
- Use neutral, professional legal language.
- Add numbered citations like [1], [2] after each claim.

Sources:
${evidenceText}

User Question:
${userQuestion}

Answer format:
- Paragraph-style explanation
- Add numbered citations like [1], [2] after each factual claim
- After the answer, list sources in this format:

Sources:
[1] Source Name – URL
[2] Source Name – URL

If the provided sources are insufficient, outdated, or conflicting, respond ONLY with:
"Reliable sources were insufficient to provide a confident answer to this query."`;

    const result = await model.generateContent(synthesisPrompt);
    const answerText = result.response.candidates[0].content.parts[0].text;
    
    // Extract citations from answer
    const citations = evidenceChunks.map((chunk, idx) => ({
      index: idx + 1,
      title: chunk.source,
      url: chunk.url,
      snippet: chunk.text.substring(0, 200),
      date: chunk.date || null
    }));
    
    // Determine confidence
    let confidence = 'medium';
    if (uniqueSources.size >= 3 && evidenceChunks.length >= 5) {
      confidence = 'high';
    } else if (uniqueSources.size < 2 || evidenceChunks.length < 3) {
      confidence = 'low';
    }
    
    return {
      answer: answerText,
      citations: citations,
      confidence: confidence
    };
  } catch (error) {
    console.error('[Answer Synthesis] Error:', error.message);
    return {
      answer: "An error occurred while synthesizing the answer. Reliable sources were insufficient to provide a confident answer to this query.",
      citations: [],
      confidence: 'low'
    };
  }
}

/**
 * STEP 9: Complete Perplexity-Style Web Search Pipeline
 * Combines all steps: expansion → search → filtering → fetching → chunking → synthesis
 * 
 * @param {string} userQuestion - User's natural language question
 * @param {number} maxResults - Maximum number of search results
 * @returns {Promise<{answer: string, citations: Array, confidence: string, sources: Array}>}
 */
async function performPerplexityStyleSearch(userQuestion, maxResults = 5) {
  try {
    console.log(`[Perplexity Search] Starting complete pipeline for: "${userQuestion}"`);
    
    // STEP 1: Query Expansion
    const { intent, queries } = await expandQuery(userQuestion);
    console.log(`[Perplexity Search] Expanded to ${queries.length} queries`);
    
    // STEP 2 & 3: Web Search with Source Filtering
    const searchResult = await searchForPdfs(userQuestion, maxResults);
    
    if (!searchResult.success || !searchResult.results || searchResult.results.length === 0) {
      return {
        answer: "Reliable sources were insufficient to provide a confident answer to this query.",
        citations: [],
        confidence: 'low',
        sources: []
      };
    }
    
    // STEP 4 & 5: Fetch and Chunk Content (Both PDFs and Web HTML)
    const evidenceChunks = [];
    const fetchedSources = [];
    
    for (const result of searchResult.results.slice(0, maxResults)) {
      try {
        let content = null;
        let contentType = 'web'; // Default to web
        
        // Check if it's a PDF or web page
        if (isPdfUrl(result.link)) {
          // Process PDF
          console.log(`[Perplexity Search] 📄 Processing PDF: ${result.title}`);
          contentType = 'pdf';
          
          try {
            const pdfResult = await processPdfFromUrl(result.link, userQuestion);
            if (pdfResult.success && pdfResult.content) {
              content = pdfResult.content;
              console.log(`[Perplexity Search] ✅ PDF processed: ${pdfResult.content.length} chars`);
            }
          } catch (pdfError) {
            console.error(`[Perplexity Search] ❌ PDF processing failed: ${pdfError.message}`);
            // Fallback to web page fetching if PDF processing fails
            contentType = 'web';
          }
        }
        
        // If not PDF or PDF processing failed, fetch as web page
        if (!content && (isWebPageUrl(result.link) || contentType === 'web')) {
          console.log(`[Perplexity Search] 🌐 Processing Web Page: ${result.title}`);
          contentType = 'web';
          
          const fetchResult = await fetchWebPageContent(result.link);
          
          if (fetchResult.success && fetchResult.content) {
            content = fetchResult.content;
            console.log(`[Perplexity Search] ✅ Web page fetched: ${content.length} chars`);
          }
        }
        
        // Process content if we have it (from either PDF or web)
        if (content && content.trim().length > 50) {
          // Filter evidence (remove opinions, keep facts)
          const filteredContent = await filterEvidence(content);
          
          // Chunk evidence (works for both PDF text and HTML content)
          const chunks = chunkEvidence(
            filteredContent,
            result.title || result.sourceType,
            result.link,
            result.date || null
          );
          
          if (chunks.length > 0) {
            evidenceChunks.push(...chunks);
            fetchedSources.push({
              title: result.title,
              url: result.link,
              sourceType: result.sourceType,
              type: contentType, // 'pdf' or 'web'
              contentLength: content.length
            });
            
            console.log(`[Perplexity Search] ✅ Processed ${contentType.toUpperCase()}: ${result.title} (${chunks.length} chunks)`);
          } else {
            console.warn(`[Perplexity Search] ⚠️ No chunks created from ${result.title}`);
          }
        } else {
          console.warn(`[Perplexity Search] ⚠️ No content extracted from ${result.link}`);
        }
      } catch (fetchError) {
        console.error(`[Perplexity Search] ❌ Failed to process ${result.link}:`, fetchError.message);
        // Continue with other sources
        continue;
      }
    }
    
    // STEP 6: Check if we have enough evidence
    if (evidenceChunks.length < 2) {
      return {
        answer: "Reliable sources were insufficient to provide a confident answer to this query.",
        citations: [],
        confidence: 'low',
        sources: fetchedSources
      };
    }
    
    // STEP 7: Synthesize Answer with Citations
    const synthesisResult = await synthesizeAnswerWithCitations(evidenceChunks, userQuestion);
    
    return {
      answer: synthesisResult.answer,
      citations: synthesisResult.citations,
      confidence: synthesisResult.confidence,
      sources: fetchedSources,
      intent: intent,
      expandedQueries: queries
    };
  } catch (error) {
    console.error('[Perplexity Search] Pipeline error:', error.message);
    return {
      answer: "An error occurred while processing your query. Reliable sources were insufficient to provide a confident answer.",
      citations: [],
      confidence: 'low',
      sources: []
    };
  }
}

module.exports = {
  extractUrlsFromQuery,
  isPdfUrl,
  isWebPageUrl,
  validatePdfUrl,
  convertGoogleDriveUrl,
  getBestUrlForProcessing,
  fetchWebPageContent,
  processWebPageFromUrl,
  streamWebPageFromUrl,
  searchForPdfs,
  processPdfFromUrl,
  streamPdfFromUrl,
  analyzeAndProcessPdfQuery,
  streamAnalyzeAndProcessPdfQuery,
  initializeVertexAI,
  // New Perplexity-style functions
  expandQuery,
  isBlockedDomain,
  chunkEvidence,
  filterEvidence,
  synthesizeAnswerWithCitations,
  performPerplexityStyleSearch
};

