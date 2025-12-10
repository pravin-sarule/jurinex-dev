


// require('dotenv').config();
// const axios = require('axios');
// const { GoogleGenerativeAI } = require('@google/generative-ai');
// const { GoogleGenAI } = require('@google/genai');
// const pool = require('../config/db');
// const SystemPrompt = require('../models/SystemPrompt');

// // Old SDK for legacy Gemini models
// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// // New SDK for Gemini 3.0 Pro
// const genAI3 = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// // ---------------------------
// // Web Search Service using Serper.dev
// // ---------------------------
// async function performWebSearch(query, numResults = 5) {
//   try {
//     if (!process.env.SERPER_API_KEY) {
//       console.warn('[Web Search] SERPER_API_KEY not found, skipping web search');
//       return null;
//     }

//     console.log(`[Web Search] 🔍 Searching for: "${query}"`);

//     const response = await axios.post(
//       'https://google.serper.dev/search',
//       {
//         q: query,
//         num: numResults,
//       },
//       {
//         headers: {
//           'X-API-KEY': process.env.SERPER_API_KEY,
//           'Content-Type': 'application/json',
//         },
//         timeout: 10000,
//       }
//     );

//     const results = response.data?.organic || [];
//     const citations = results.map((result, index) => ({
//       index: index + 1,
//       title: result.title || '',
//       link: result.link || '',
//       snippet: result.snippet || '',
//     }));

//     // Format search results for LLM context
//     const formattedResults = results
//       .map((result, index) => {
//         return `[Source ${index + 1}] ${result.title || 'No title'}\nURL: ${result.link || 'No URL'}\nContent: ${result.snippet || 'No snippet'}`;
//       })
//       .join('\n\n');

//     return {
//       results: formattedResults,
//       citations,
//       rawResults: results,
//     };
//   } catch (error) {
//     console.error('[Web Search] Error performing search:', error.message);
//     return null;
//   }
// }

// // ---------------------------
// // Fetch Content from URL
// // ---------------------------
// async function fetchUrlContent(url) {
//   try {
//     console.log(`[URL Fetch] 📄 Fetching content from: ${url}`);
    
//     const response = await axios.get(url, {
//       timeout: 15000,
//       headers: {
//         'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
//       },
//       maxRedirects: 5
//     });

//     // Extract text content (basic extraction - you might want to use a library like cheerio for better parsing)
//     let content = response.data;
    
//     // Remove HTML tags for basic text extraction
//     if (typeof content === 'string') {
//       content = content
//         .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
//         .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
//         .replace(/<[^>]+>/g, ' ')
//         .replace(/\s+/g, ' ')
//         .trim();
      
//       // Limit content length
//       if (content.length > 10000) {
//         content = content.substring(0, 10000) + '...';
//       }
//     }

//     return {
//       url: url,
//       content: content,
//       success: true
//     };
//   } catch (error) {
//     console.error(`[URL Fetch] Error fetching ${url}:`, error.message);
//     return {
//       url: url,
//       content: `Failed to fetch content from ${url}: ${error.message}`,
//       success: false
//     };
//   }
// }

// // ---------------------------
// // Extract URLs from user message
// // ---------------------------
// function extractUrls(text) {
//   const urlRegex = /(https?:\/\/[^\s]+)/g;
//   const matches = text.match(urlRegex);
//   return matches || [];
// }

// // ---------------------------
// // Auto-detect if web search is needed - FIXED VERSION
// // ---------------------------
// function shouldTriggerWebSearch(userMessage, context = '', relevantChunks = '') {
//   if (!userMessage) return false;

//   const message = userMessage.toLowerCase();
//   const contextLower = (context || '').toLowerCase();
//   const chunksLower = (relevantChunks || '').toLowerCase();
  
//   // ============================================
//   // PRIORITY 1: EXPLICIT WEB SEARCH REQUESTS (CHECK FIRST!)
//   // ============================================
//   const explicitWebSearchTriggers = [
//     'search for',
//     'search from web',
//     'search from the web',
//     'search on web',
//     'search on the web',
//     'search online',
//     'search the internet',
//     'search the web',
//     'search web',
//     'find information about',
//     'find on web',
//     'find on the web',
//     'find online',
//     'look up',
//     'look up online',
//     'look up on web',
//     'google',
//     'google search',
//     'google it',
//     'web search',
//     'internet search',
//     'search google',
//     'use web search',
//     'use web',
//     'check online',
//     'check the web',
//     'get from web',
//     'get from internet',
//     'from web',
//     'from the web',
//     'from internet',
//     'answer from web',
//     'answer from the web',
//     'give answer from web',
//     'give me answer from web',
//     'tell me from web',
//     'tell from web',
//     // Hinglish triggers
//     'web se',
//     'web pe',
//     'web me',
//     'online search',
//     'internet se',
//     'google se',
//     'web par',
//     'web pe search',
//     'online dhoondo',
//     'internet se dhoondo',
//     'web se dekh',
//     'web pe dekh',
//     'web se batao',
//     'web pe batao',
//     'web se answer',
//     'web pe answer',
//   ];
  
//   // Check for explicit web search requests FIRST - these ALWAYS trigger regardless of document context
//   const hasExplicitTrigger = explicitWebSearchTriggers.some(trigger => message.includes(trigger));
//   if (hasExplicitTrigger) {
//     console.log('[Web Search] ✅ EXPLICIT web search request detected - triggering web search (FolderAI)');
//     return true;
//   }
  
//   // ============================================
//   // PRIORITY 2: DOCUMENT REJECTION PHRASES
//   // ============================================
//   const documentRejectionKeywords = [
//     // English phrases
//     "don't want from document",
//     "don't want from the document",
//     "don't want answer from document",
//     "don't want answer from the document",
//     "not from document",
//     "not from the document",
//     "not from documents",
//     "not from these documents",
//     "don't use document",
//     "don't use the document",
//     "ignore document",
//     "ignore the document",
//     "ignore documents",
//     "skip document",
//     "skip the document",
//     "without document",
//     "without documents",
//     "not in document",
//     "not in the document",
//     "i don't want",
//     "i dont want",
//     "don't want",
//     "dont want",
//     "not document",
//     "no document",
//     "without using document",
//     "without the document",
//     // Hinglish phrases
//     "web se search karo",
//     "web pe search karo",
//     "web me search karo",
//     "online search karo",
//     "internet se search karo",
//     "google se search karo",
//     "web par search",
//     "web pe search",
//     "online search",
//     "internet search",
//     "web search karo",
//     "web me dhoondo",
//     "web pe dhoondo",
//     "online dhoondo",
//     "internet se dhoondo",
//     "web se dekh",
//     "web pe dekh",
//     "online dekh",
//     "internet se dekh",
//     "document nahi",
//     "document mat use karo",
//   ];
  
//   // Check for document rejection
//   const hasDocumentRejection = documentRejectionKeywords.some(keyword => {
//     const lowerKeyword = keyword.toLowerCase();
//     if (lowerKeyword.length <= 5) {
//       return message.includes(lowerKeyword);
//     }
//     const keywordWords = lowerKeyword.split(/\s+/).filter(w => w.length > 2);
//     if (keywordWords.length > 2) {
//       return keywordWords.every(word => message.includes(word));
//     }
//     return message.includes(lowerKeyword);
//   });
  
//   // Also check for common patterns like "don't want" + "document"
//   const hasDontWant = (message.includes("don't want") || message.includes("dont want") || message.includes("don't want") || message.includes("do not want")) && 
//                       (message.includes("document") || message.includes("from document"));
  
//   // If user explicitly rejects documents, ALWAYS trigger web search
//   if (hasDocumentRejection || hasDontWant) {
//     console.log('[Web Search] ✅ User explicitly rejected documents - ALWAYS triggering web search (FolderAI)');
//     return true;
//   }
  
//   // ============================================
//   // PRIORITY 3: CHECK FOR PERSONAL DATA QUESTIONS (NEVER SEARCH)
//   // ============================================
//   const personalPronouns = [
//     'my',
//     'my own',
//     'my personal',
//     'my profile',
//     'my account',
//     'my information',
//     'my data',
//   ];
  
//   const personalDataKeywords = [
//     'my case',
//     'my organization',
//     'my company',
//     'my firm',
//     'my practice',
//     'my jurisdiction',
//     'my bar',
//     'my credentials',
//     'my role',
//     'my experience',
//     'my details',
//     'my name',
//     'my email',
//     'my phone',
//     'my address',
//     'my license',
//     'my registration',
//     'my status',
//     'my type',
//     'my category',
//   ];
  
//   // Check if question contains personal pronouns
//   const hasPersonalPronoun = personalPronouns.some(pronoun => {
//     const regex = new RegExp(`\\b${pronoun}\\b`, 'i');
//     return regex.test(userMessage);
//   });
  
//   // Check if question is about personal data
//   const isPersonalDataQuestion = personalDataKeywords.some(keyword => message.includes(keyword));
  
//   // If question is about user's own data/profile, NEVER trigger web search
//   if (hasPersonalPronoun || isPersonalDataQuestion) {
//     console.log('[Web Search] Personal data/profile question detected - skipping web search (FolderAI)');
//     return false;
//   }
  
//   // Check if there's substantial document context provided
//   const hasDocumentContext = (contextLower.length > 500) || (chunksLower.length > 500);
  
//   // ============================================
//   // PRIORITY 4: CURRENT/REAL-TIME INFORMATION TRIGGERS
//   // ============================================
//   const currentInfoTriggers = [
//     'latest news',
//     'current events',
//     'recent updates',
//     'what happened today',
//     'news about',
//     'breaking news',
//     'current status',
//     'latest developments',
//     'recent changes',
//     'what is happening',
//     'current price',
//     'stock price',
//     'weather',
//     'today',
//     'this week',
//     'this month',
//     'this year',
//     'now',
//     'currently',
//     'as of now',
//     'right now',
//     'recent',
//     'recently',
//     'latest',
//   ];
  
//   // Check for current/real-time information requests
//   const hasCurrentInfoTrigger = currentInfoTriggers.some(trigger => message.includes(trigger));
  
//   if (hasCurrentInfoTrigger) {
//     console.log('[Web Search] ✅ Current/real-time information request detected (FolderAI)');
//     return true;
//   }
  
//   // ============================================
//   // PRIORITY 5: GENERAL KNOWLEDGE QUESTIONS (NO DOCUMENTS)
//   // ============================================
//   const generalKnowledgePatterns = [
//     /^what is (.+)\?/i,
//     /^who is (.+)\?/i,
//     /^when did (.+) happen\?/i,
//     /^where is (.+)\?/i,
//     /^how (?:do|does|did) (.+)\?/i,
//     /^why (?:is|are|did|does) (.+)\?/i,
//     /tell me about (.+)/i,
//     /explain (.+)/i,
//     /what are (.+)/i,
//   ];
  
//   const isGeneralKnowledgeQuestion = generalKnowledgePatterns.some(pattern => pattern.test(userMessage));
  
//   // Document-related keywords that suggest question is ABOUT the documents
//   const documentRelatedKeywords = [
//     'document',
//     'this document',
//     'the document',
//     'these documents',
//     'in the document',
//     'from the document',
//     'according to',
//     'based on',
//     'analyze',
//     'summarize',
//     'what does it say',
//     'what is mentioned',
//     'what is stated',
//     'extract',
//     'find in',
//     'show me from',
//   ];
  
//   const isDocumentQuestion = documentRelatedKeywords.some(keyword => message.includes(keyword));
  
//   // If question is about documents and we have context, don't search web
//   if (isDocumentQuestion && hasDocumentContext) {
//     console.log('[Web Search] Question is about documents and context is available - skipping web search (FolderAI)');
//     return false;
//   }
  
//   // If it's a general knowledge question and NO document context, trigger web search
//   if (isGeneralKnowledgeQuestion && !hasDocumentContext) {
//     console.log('[Web Search] ✅ General knowledge question without document context (FolderAI)');
//     return true;
//   }
  
//   // If there's substantial document context, be conservative
//   if (hasDocumentContext) {
//     console.log('[Web Search] Document context available - assuming answer is in documents (FolderAI)');
//     return false;
//   }
  
//   // For pre-upload chats (no document context), trigger for knowledge questions
//   if (!hasDocumentContext && isGeneralKnowledgeQuestion) {
//     console.log('[Web Search] ✅ No document context - triggering for general knowledge question (FolderAI)');
//     return true;
//   }
  
//   // Default: don't trigger web search
//   console.log('[Web Search] No web search triggers detected - using available context (FolderAI)');
//   return false;
// }

// // ---------------------------
// // Estimate token count (approx)
// // ---------------------------
// function estimateTokenCount(text = '') {
//   return Math.ceil(text.length / 4); // 4 chars per token on average
// }

// // ---------------------------
// // Smart Context Trimmer - REDUCES TOKENS BY 70-90%
// // ---------------------------
// function trimContext(context, maxTokens = 500) {
//   if (!context) return '';
//   const tokens = estimateTokenCount(context);
//   if (tokens <= maxTokens) return context;
  
//   // Take only first portion (most relevant usually at start)
//   const ratio = maxTokens / tokens;
//   const trimmedLength = Math.floor(context.length * ratio);
//   return context.substring(0, trimmedLength) + '...';
// }

// // ---------------------------
// // Smart Chunk Filtering - REDUCES CHUNKS BY 80%
// // ---------------------------
// function filterRelevantChunks(chunks, userMessage, maxChunks = 5) {
//   if (!chunks) return '';
  
//   // Handle array of chunk objects
//   let chunkString;
//   if (Array.isArray(chunks)) {
//     // Convert array of chunk objects to string format
//     chunkString = chunks
//       .map((c) => {
//         // Handle both object format and string format
//         if (typeof c === 'string') {
//           return c;
//         }
//         // Object format: { content, filename, ... }
//         const filename = c.filename || c.originalname || 'Document';
//         const content = c.content || '';
//         return `📄 [${filename}]\n${content}`;
//       })
//       .join('\n\n');
//   } else if (typeof chunks === 'string') {
//     chunkString = chunks;
//   } else {
//     // Unknown type, return empty string
//     return '';
//   }
  
//   const chunkArray = chunkString.split('\n\n').filter(Boolean);
//   if (chunkArray.length <= maxChunks) return chunkString;
  
//   // Simple keyword matching to find most relevant chunks
//   const keywords = userMessage.toLowerCase()
//     .split(/\s+/)
//     .filter(w => w.length > 3)
//     .slice(0, 5); // Top 5 keywords only
  
//   const scored = chunkArray.map(chunk => {
//     const chunkLower = chunk.toLowerCase();
//     const score = keywords.reduce((sum, kw) => {
//       return sum + (chunkLower.includes(kw) ? 1 : 0);
//     }, 0);
//     return { chunk, score };
//   });
  
//   // Sort by relevance and take top N
//   return scored
//     .sort((a, b) => b.score - a.score)
//     .slice(0, maxChunks)
//     .map(s => s.chunk)
//     .join('\n\n');
// }

// // ---------------------------
// // Retry Helper
// // ---------------------------
// async function retryWithBackoff(fn, retries = 3, delay = 2000) {
//   for (let attempt = 1; attempt <= retries; attempt++) {
//     try {
//       return await fn();
//     } catch (err) {
//       console.warn(`⚠️ Attempt ${attempt} failed:`, err.message);
//       if (
//         err.message.includes('overloaded') ||
//         err.message.includes('503') ||
//         err.message.includes('temporarily unavailable') ||
//         err.message.includes('quota') ||
//         err.message.includes('rate limit')
//       ) {
//         if (attempt < retries) {
//           await new Promise(res => setTimeout(res, delay * attempt));
//         } else {
//           throw new Error('LLM provider is temporarily unavailable. Please try again later.');
//         }
//       } else {
//         throw err;
//       }
//     }
//   }
// }

// // ---------------------------
// // Gemini model mappings
// // ---------------------------
// const GEMINI_MODELS = {
//   gemini: ['gemini-2.0-flash-exp', 'gemini-1.5-flash'],
//   'gemini-pro-2.5': ['gemini-2.5-pro', 'gemini-2.0-pro-exp', 'gemini-1.5-pro'],
//   'gemini-3-pro': ['gemini-3-pro-preview'], // Uses new SDK
// };

// // ---------------------------
// // LLM Configurations
// // ---------------------------
// const LLM_CONFIGS = {
//   openai: {
//     apiUrl: 'https://api.openai.com/v1/chat/completions',
//     model: 'gpt-4o-mini',
//     headers: {
//       'Content-Type': 'application/json',
//       Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
//     },
//   },
//   "gpt-4o": {
//     apiUrl: 'https://api.openai.com/v1/chat/completions',
//     model: 'gpt-4o',
//     headers: {
//       'Content-Type': 'application/json',
//       Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
//     },
//   },
//   anthropic: {
//     apiUrl: 'https://api.anthropic.com/v1/messages',
//     model: 'claude-3-5-haiku-20241022',
//     headers: {
//       'Content-Type': 'application/json',
//       'x-api-key': process.env.ANTHROPIC_API_KEY,
//       'anthropic-version': '2023-06-01',
//     },
//   },
//   'claude-sonnet-4': {
//     apiUrl: 'https://api.anthropic.com/v1/messages',
//     model: 'claude-sonnet-4-20250514',
//     headers: {
//       'Content-Type': 'application/json',
//       'x-api-key': process.env.ANTHROPIC_API_KEY,
//       'anthropic-version': '2023-06-01',
//     },
//   },
//   'claude-opus-4-1': {
//     apiUrl: 'https://api.anthropic.com/v1/messages',
//     model: 'claude-opus-4-1-20250805',
//     headers: {
//       'Content-Type': 'application/json',
//       'x-api-key': process.env.ANTHROPIC_API_KEY,
//       'anthropic-version': '2023-06-01',
//     },
//   },
//   'claude-sonnet-4-5': {
//     apiUrl: 'https://api.anthropic.com/v1/messages',
//     model: 'claude-sonnet-4-5-20250929',
//     headers: {
//       'Content-Type': 'application/json',
//       'x-api-key': process.env.ANTHROPIC_API_KEY,
//       'anthropic-version': '2023-06-01',
//     },
//   },
//   'claude-haiku-4-5': {
//     apiUrl: 'https://api.anthropic.com/v1/messages',
//     model: 'claude-haiku-4-5-20251001',
//     headers: {
//       'Content-Type': 'application/json',
//       'x-api-key': process.env.ANTHROPIC_API_KEY,
//       'anthropic-version': '2023-06-01',
//     },
//   },
//   deepseek: {
//     apiUrl: 'https://api.deepseek.com/chat/completions',
//     model: 'deepseek-chat',
//     headers: {
//       'Content-Type': 'application/json',
//       Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
//     },
//   },
// };

// // ---------------------------
// // Combined LLM Configurations
// // ---------------------------
// const ALL_LLM_CONFIGS = {
//   ...LLM_CONFIGS,
//   gemini: { model: 'gemini-2.0-flash-exp', headers: {} },
//   'gemini-pro-2.5': { model: 'gemini-2.5-pro', headers: {} },
//   'gemini-3-pro': { model: 'gemini-3-pro-preview' }, // Uses new SDK
// };

// const llmTokenCache = new Map();

// function normalizeProviderForDb(provider = '') {
//   const key = provider.toLowerCase();
//   if (key.includes('claude') || key === 'anthropic') return 'anthropic';
//   if (key.startsWith('gemini')) return 'gemini';
//   if (key.startsWith('gpt-') || key.includes('openai')) return 'openai';
//   if (key.includes('deepseek')) return 'deepseek';
//   return provider;
// }

// async function queryMaxTokensByProvider(provider, modelName) {
//   const query = `
//     SELECT max_output_tokens
//     FROM llm_max_tokens
//     WHERE LOWER(provider) = LOWER($1)
//       AND LOWER(model_name) = LOWER($2)
//     ORDER BY updated_at DESC
//     LIMIT 1;
//   `;
//   const { rows } = await pool.query(query, [provider, modelName]);
//   return rows[0]?.max_output_tokens ?? null;
// }

// async function queryMaxTokensByModel(modelName) {
//   const query = `
//     SELECT max_output_tokens
//     FROM llm_max_tokens
//     WHERE LOWER(model_name) = LOWER($1)
//     ORDER BY updated_at DESC
//     LIMIT 1;
//   `;
//   const { rows } = await pool.query(query, [modelName]);
//   return rows[0]?.max_output_tokens ?? null;
// }

// async function getModelMaxTokens(provider, modelName) {
//   if (!modelName) {
//     throw new Error('Folder LLM configuration missing model name when resolving max tokens.');
//   }

//   const cacheKey = `${provider.toLowerCase()}::${modelName.toLowerCase()}`;
//   if (llmTokenCache.has(cacheKey)) return llmTokenCache.get(cacheKey);

//   const providerCandidates = [provider];
//   const normalized = normalizeProviderForDb(provider);
//   if (normalized && normalized !== provider) providerCandidates.push(normalized);
//   providerCandidates.push(null); // fallback: model-only

//   for (const candidate of providerCandidates) {
//     let value = null;
//     try {
//       value =
//         candidate === null
//           ? await queryMaxTokensByModel(modelName)
//           : await queryMaxTokensByProvider(candidate, modelName);
//     } catch (err) {
//       console.error(
//         `[FolderLLM Max Tokens] Error querying max tokens for provider="${candidate}" model="${modelName}": ${err.message}`
//       );
//       continue;
//     }

//     if (value != null) {
//       llmTokenCache.set(cacheKey, value);
//       console.log(
//         `[FolderLLM Max Tokens] Using max_output_tokens=${value} for provider="${candidate || 'model-only'}" model="${modelName}"`
//       );
//       return value;
//     }
//   }

//   // Fallback defaults for models not in database
//   const defaultMaxTokens = {
//     'gemini-3-pro-preview': 8192,
//     'gemini-2.5-pro': 8192,
//     'gemini-2.5-flash': 8192,
//     'gemini-2.0-pro-exp': 8192,
//     'gemini-1.5-pro': 8192,
//     'gemini-1.5-flash': 8192,
//     'gemini-2.0-flash-exp': 8192,
//   };

//   const modelLower = modelName.toLowerCase();
//   if (defaultMaxTokens[modelLower]) {
//     const defaultValue = defaultMaxTokens[modelLower];
//     llmTokenCache.set(cacheKey, defaultValue);
//     console.log(
//       `[FolderLLM Max Tokens] Using default max_output_tokens=${defaultValue} for model="${modelName}" (not found in database)`
//     );
//     return defaultValue;
//   }

//   throw new Error(
//     `Max token configuration not found for provider="${provider}", model="${modelName}". Please insert a row into llm_max_tokens.`
//   );
// }

// // ---------------------------
// // Provider Availability Checker
// // ---------------------------
// function getAvailableProviders() {
//   return Object.fromEntries(
//     Object.entries(ALL_LLM_CONFIGS).map(([provider, cfg]) => {
//       let key;
//       if (provider.startsWith('gemini')) key = process.env.GEMINI_API_KEY;
//       else if (provider.includes('claude') || provider === 'anthropic') key = process.env.ANTHROPIC_API_KEY;
//       else if (provider === 'deepseek') key = process.env.DEEPSEEK_API_KEY;
//       else key = process.env.OPENAI_API_KEY;

//       return [
//         provider,
//         { available: !!key, model: cfg.model, reason: key ? 'Available' : 'Missing API key' },
//       ];
//     })
//   );
// }

// // ---------------------------
// // Provider Aliases
// // ---------------------------
// const PROVIDER_ALIASES = {
//   openai: 'openai',
//   'gpt-4o': 'gpt-4o',
//   'gpt-4o-mini': 'openai',
//   gemini: 'gemini',
//   'gemini-2.0-flash': 'gemini',
//   'gemini-1.5-flash': 'gemini',
//   'gemini-pro-2.5': 'gemini-pro-2.5',
//   'gemini-3-pro': 'gemini-3-pro',
//   'gemini-3.0-pro': 'gemini-3-pro',
//   anthropic: 'anthropic',
//   'claude': 'anthropic',
//   'claude-3-5-haiku': 'anthropic',
//   'claude-sonnet-4': 'claude-sonnet-4',
//   'claude-opus-4-1': 'claude-opus-4-1',
//   'claude-opus-4.1': 'claude-opus-4-1',
//   'claude-sonnet-4-5': 'claude-sonnet-4-5',
//   'claude-sonnet-4.5': 'claude-sonnet-4-5',
//   'claude-haiku-4-5': 'claude-haiku-4-5',
//   'claude-haiku-4.5': 'claude-haiku-4-5',
//   deepseek: 'deepseek',
//   'deepseek-chat': 'deepseek',
// };

// // ---------------------------
// // Resolve Provider
// // ---------------------------
// function resolveProviderName(name = '') {
//   const key = name.trim().toLowerCase();
//   const resolved = PROVIDER_ALIASES[key] || 'gemini';
//   console.log(`[resolveProviderName] DB name: "${name}" → "${resolved}"`);
//   return resolved;
// }

// // ---------------------------
// // Get System Prompt from Database
// // ---------------------------
// async function getSystemPrompt(baseContext = '') {
//   try {
//     const dbSystemPrompt = await SystemPrompt.getLatestSystemPrompt();
    
//     if (dbSystemPrompt && baseContext) {
//       const combinedPrompt = `${dbSystemPrompt}

// ${baseContext}`;
//       console.log('[SystemPrompt] 🔄 Using database system prompt (PRIMARY) + adaptive context (ENHANCEMENT) (FolderAI)');
//       console.log(`[SystemPrompt] Database prompt length: ${dbSystemPrompt.length} chars | Adaptive context: ${baseContext.length} chars (FolderAI)`);
//       return combinedPrompt;
//     }
    
//     if (dbSystemPrompt) {
//       console.log('[SystemPrompt] ✅ Using system prompt from database (STRICT COMPLIANCE MODE) (FolderAI)');
//       console.log(`[SystemPrompt] Database prompt length: ${dbSystemPrompt.length} chars (FolderAI)`);
//       return dbSystemPrompt;
//     }
    
//     console.log('[SystemPrompt] ⚠️ No database prompt found, using fallback system instruction (FolderAI)');
//     return baseContext || 'You are a helpful assistant.';
//   } catch (err) {
//     console.error('[SystemPrompt] ❌ Error getting system prompt, using fallback (FolderAI):', err.message);
//     return baseContext || 'You are a helpful assistant.';
//   }
// }

// // ---------------------------
// // Build Enhanced System Prompt with Source Attribution
// // ---------------------------
// function buildEnhancedSystemPrompt(baseSystemPrompt, hasDocuments, hasWebSearch, hasUrlContent, isExplicitWebRequest = false) {
//   let sourceInfo = '';
  
//   // If explicit web request, prioritize web sources CRITICALLY
//   if (isExplicitWebRequest && (hasWebSearch || hasUrlContent)) {
//     sourceInfo = `\n\n⚠️ CRITICAL: The user EXPLICITLY requested information from the INTERNET/WEB.
// You MUST prioritize and use WEB SEARCH RESULTS${hasUrlContent ? ' or FETCHED WEBSITE CONTENT' : ''} as your PRIMARY source.

// PRIMARY SOURCE: Web Search Results${hasUrlContent ? ' / Fetched Website Content' : ''}
// - Start your answer with: "According to web search results..." or "Based on information from the internet..."
// - Cite sources using [Source 1], [Source 2], etc. when using information from search results
// - If using fetched website content, cite the URL explicitly: "According to [URL]..."
// - Use ONLY web search results and fetched website content to answer the question
// - DO NOT rely on documents - the user explicitly requested web/internet information`;
//   } else if (hasWebSearch && hasDocuments) {
//     sourceInfo = `\n\nIMPORTANT: You have access to TWO sources of information:
// 1. **User Documents/Profile**: Internal documents and user profile information
// 2. **Web Search Results**: Real-time information from the internet${hasUrlContent ? ' and fetched website content' : ''}

// When answering:
// - If using information from user documents, mention "Based on your documents/profile..."
// - If using information from web search, cite the source number like [Source 1] and include it in your response
// - If using fetched website content, cite the URL and mention "According to the website..."
// - If using both, clearly distinguish which information comes from which source
// - Always prioritize user documents for personal/organization-specific questions
// - Use web search results for current events, general knowledge, or recent information`;
//   } else if (hasWebSearch) {
//     sourceInfo = `\n\nIMPORTANT: You have access to web search results${hasUrlContent ? ' and fetched website content' : ''} to answer this question.
// - Cite sources using [Source 1], [Source 2], etc. when using information from search results
// - If using fetched website content, cite the URL and mention "According to the website..."
// - Provide accurate, up-to-date information based on the search results
// - Indicate clearly that this information comes from web sources`;
//   } else if (hasDocuments) {
//     sourceInfo = `\n\nIMPORTANT: You have access to user documents and profile information.
// - When answering based on documents, mention "Based on your documents..." or "According to the provided information..."
// - Focus on information from the user's documents and context`;
//   }
  
//   return baseSystemPrompt + sourceInfo;
// }

// // ---------------------------
// // Main Optimized LLM Caller - WITH URL FETCHING
// // ---------------------------
// async function askLLM(providerName, userMessage, context = '', relevant_chunks = null, originalQuestion = null) {
//   const provider = resolveProviderName(providerName);
//   const config = ALL_LLM_CONFIGS[provider];
//   if (!config) throw new Error(`❌ Unsupported LLM provider: ${provider}`);

//   // Ensure context is always a string
//   const safeContext = typeof context === 'string' ? context : '';

//   // Extract original user question for web search
//   let userQuestionForSearch = originalQuestion || userMessage;
  
//   if (!originalQuestion && userMessage) {
//     const userQuestionMatch = userMessage.match(/USER QUESTION:\s*(.+?)(?:\n\n===|$)/s);
//     if (userQuestionMatch) {
//       userQuestionForSearch = userQuestionMatch[1].trim();
//     } else {
//       const lines = userMessage.split('\n');
//       const contextMarkers = ['===', '---', 'Relevant Context', 'DOCUMENT', 'PROFILE'];
//       for (let i = 0; i < lines.length; i++) {
//         if (contextMarkers.some(marker => lines[i].includes(marker))) {
//           userQuestionForSearch = lines.slice(0, i).join(' ').trim();
//           break;
//         }
//       }
//       if (!userQuestionForSearch || userQuestionForSearch.length > 500) {
//         userQuestionForSearch = userMessage.substring(0, 200).trim();
//       }
//     }
//   }

//   // Check if this is an EXPLICIT web/internet request BEFORE trimming context
//   const messageLower = userQuestionForSearch.toLowerCase();
//   const explicitWebKeywords = [
//     'search web', 'search online', 'search the web', 'search internet', 'from web', 'from the web',
//     'from internet', 'from online', 'web se', 'web pe', 'online search', 'internet search', 'web search',
//     'don\'t want from document', 'dont want from document', 'not from document', 'ignore document', 'skip document',
//     'answer from web', 'give me from web', 'tell me from web', 'web se search', 'web pe search',
//     'search on web', 'search on internet', 'find on web', 'find on internet', 'look up on web',
//     'web se dhoondo', 'web pe dhoondo', 'internet se', 'online dhoondo', 'web se batao'
//   ];
//   const isExplicitWebRequest = explicitWebKeywords.some(keyword => messageLower.includes(keyword));
  
//   // If explicit web request, MINIMIZE document context
//   let trimmedContext, filteredChunks, trimmedFilteredChunks;
//   if (isExplicitWebRequest) {
//     // Minimize document context for explicit web requests
//     console.log('[Web Search] 🎯 Explicit web request detected - minimizing document context (FolderAI)');
//     trimmedContext = ''; // Don't include profile context for explicit web requests
//     filteredChunks = ''; // Don't include document chunks for explicit web requests
//     trimmedFilteredChunks = ''; // No document context
//   } else {
//     // Normal processing: trim context and chunks
//     trimmedContext = trimContext(safeContext, 200);
//     filteredChunks = filterRelevantChunks(relevant_chunks, userQuestionForSearch, 5);
//     trimmedFilteredChunks = trimContext(filteredChunks, 700);
//   }

//   // Check document availability
//   const hasDocumentContext = Boolean(trimmedContext || trimmedFilteredChunks);

//   // Initialize search and URL data
//   let webSearchData = null;
//   let citations = [];
//   let sourceInfo = [];
//   let urlContents = [];
  
//   // Check for URLs in user message
//   const urls = extractUrls(userQuestionForSearch);
  
//   // Determine what sources are available (only if not explicit web request)
//   if (!isExplicitWebRequest) {
//     if (trimmedFilteredChunks) {
//       sourceInfo.push('📄 Uploaded Documents');
//     }
//     if (trimmedContext) {
//       sourceInfo.push('📋 User Profile/Context');
//     }
//   }
  
//   // Fetch URL content if URLs are present
//   if (urls.length > 0) {
//     console.log(`[URL Fetch] 🔗 Found ${urls.length} URL(s) in message, fetching content... (FolderAI)`);
//     for (const url of urls) {
//       const urlData = await fetchUrlContent(url);
//       if (urlData.success) {
//         urlContents.push(urlData);
//         sourceInfo.push(`🔗 Website: ${url}`);
//       }
//     }
//   }
  
//   // ✅ WEB SEARCH: Provider-agnostic - works for ALL LLM models (Gemini, Claude, OpenAI, DeepSeek)
//   // Web search is called BEFORE provider-specific LLM calls, so all models receive web search results
//   const needsWebSearch = isExplicitWebRequest || shouldTriggerWebSearch(userQuestionForSearch, trimmedContext, trimmedFilteredChunks);
  
//   if (needsWebSearch) {
//     console.log(`[Web Search] 🔍 ${isExplicitWebRequest ? 'EXPLICIT' : 'Auto'}-triggering web search for user question (FolderAI):`, userQuestionForSearch.substring(0, 100));
//     console.log(`[Web Search] 📋 Provider: ${provider} - Web search will be available for this model (FolderAI)`);
//     webSearchData = await performWebSearch(userQuestionForSearch, 5);
    
//     if (webSearchData && webSearchData.results) {
//       citations = webSearchData.citations;
//       sourceInfo.push('🌐 Web Search');
//       console.log(`[Web Search] ✅ Found ${citations.length} search results with citations for provider ${provider} (FolderAI)`);
//       console.log(`[Web Search] ✅ Web search results will be included in prompt for ${provider} model (FolderAI)`);
//     } else {
//       console.log(`[Web Search] ⚠️ No search results found for provider ${provider} (FolderAI)`);
//     }
//   } else {
//     console.log(`[Web Search] ⏭️ Web search not needed for provider ${provider} (FolderAI)`);
//   }
  
//   // Build prompt with prioritized sources based on request type
//   let prompt = userMessage.trim();
  
//   // ⚠️ CRITICAL: If explicit web search is requested, prioritize web sources and minimize documents
//   if (isExplicitWebRequest && (webSearchData || urlContents.length > 0)) {
//     console.log('[Web Search] 🎯 EXPLICIT web search request - prioritizing web sources over documents (FolderAI)');
    
//     // Add web sources FIRST (highest priority)
//     if (urlContents.length > 0) {
//       prompt += `\n\n=== PRIMARY SOURCE: FETCHED WEBSITE CONTENT ===`;
//       urlContents.forEach(urlData => {
//         prompt += `\n\n[Website: ${urlData.url}]\n${urlData.content}`;
//       });
//       prompt += `\n\n⚠️ CRITICAL: This website content is the PRIMARY source for your answer.`;
//     }
    
//     if (webSearchData && webSearchData.results) {
//       prompt += `\n\n=== PRIMARY SOURCE: WEB SEARCH RESULTS ===\n${webSearchData.results}`;
//       prompt += `\n\n⚠️ CRITICAL: These web search results are the PRIMARY source for your answer. Use them as the main source.`;
//     }
    
//     // Add document context LAST (secondary/optional reference only)
//     if (trimmedFilteredChunks) {
//       prompt += `\n\n=== SECONDARY REFERENCE: UPLOADED DOCUMENTS (OPTIONAL) ===\n${trimmedFilteredChunks}`;
//       prompt += `\n\n⚠️ NOTE: The user explicitly requested web/internet information. Use documents ONLY for additional context if needed, but PRIMARY source must be web search results.`;
//     }
    
//     // Explicit instructions for web-first response
//     prompt += `\n\n🎯 CRITICAL INSTRUCTIONS:
// - The user EXPLICITLY requested information from the INTERNET/WEB
// - You MUST prioritize and use WEB SEARCH RESULTS or FETCHED WEBSITE CONTENT as your PRIMARY source
// - Use document context ONLY as secondary reference if absolutely necessary
// - Start your answer with: "According to web search results..." or "Based on information from the internet..."
// - If using web search, cite sources as [Source 1], [Source 2], etc.
// - If using fetched website content, mention the URL explicitly
// - DO NOT rely primarily on documents when the user asked for web/internet information`;
    
//   } else {
//     // Normal mode: documents first, then web sources
//     // Add document context
//     if (trimmedFilteredChunks) {
//       prompt += `\n\n=== UPLOADED DOCUMENTS CONTEXT ===\n${trimmedFilteredChunks}`;
//     }
    
//     // Add fetched URL content
//     if (urlContents.length > 0) {
//       prompt += `\n\n=== FETCHED WEBSITE CONTENT ===`;
//       urlContents.forEach(urlData => {
//         prompt += `\n\n[Website: ${urlData.url}]\n${urlData.content}`;
//       });
//       prompt += `\n\n⚠️ IMPORTANT: When using information from fetched websites above, cite the URL and mention "According to ${urlContents[0].url}..."`;
//     }
    
//     // Add web search results
//     if (webSearchData && webSearchData.results) {
//       prompt += `\n\n=== WEB SEARCH RESULTS ===\n${webSearchData.results}\n\n⚠️ IMPORTANT: When using information from web sources above, cite them as [Source 1], [Source 2], etc.`;
//     }
    
//     // Add source instruction
//     if (sourceInfo.length > 0) {
//       prompt += `\n\n📌 Available Information Sources: ${sourceInfo.join(', ')}`;
//       prompt += `\n\n🎯 Instructions: 
// - Answer the question using the most relevant sources available.
// - Clearly indicate which source(s) you're using (e.g., "Based on your uploaded documents..." or "According to web search results..." or "From the website..." or "From your profile...").
// - If using web search, cite sources as [Source 1], [Source 2], etc.
// - If using fetched website content, mention the URL.
// - If information is not available in any source, clearly state that.`;
//     }
//   }

//   const totalTokens = estimateTokenCount(prompt + trimmedContext);
//   console.log(`[askLLM] Optimized Tokens: ${totalTokens} (context: ${estimateTokenCount(trimmedContext)}, chunks: ${estimateTokenCount(trimmedFilteredChunks || '')}) | Sources: ${sourceInfo.join(', ') || 'None'} (FolderAI)`);

//   // Get enhanced system prompt
//   const baseSystemPrompt = await getSystemPrompt(trimmedContext);
//   const enhancedSystemPrompt = buildEnhancedSystemPrompt(
//     baseSystemPrompt,
//     hasDocumentContext && !isExplicitWebRequest, // Don't treat as document context if explicit web request
//     Boolean(webSearchData),
//     urlContents.length > 0,
//     isExplicitWebRequest // Pass explicit web request flag
//   );

//   // ✅ Call LLM - Web search results are already included in the prompt above
//   // This works for ALL providers: Gemini, Claude, OpenAI, DeepSeek
//   // The prompt contains web search results, so all models receive them regardless of provider
//   console.log(`[askLLM] 📤 Sending request to ${provider} with ${webSearchData ? 'WEB SEARCH RESULTS' : 'NO web search'} (FolderAI)`);
//   const response = await retryWithBackoff(() => 
//     callSinglePrompt(provider, prompt, enhancedSystemPrompt, webSearchData !== null || urlContents.length > 0)
//   );

//   // Append citations if web search was performed
//   if (citations.length > 0) {
//     const citationsText = '\n\n---\n**📚 Web Sources Referenced:**\n' + citations.map(c => `[Source ${c.index}] [${c.title}](${c.link})`).join('\n');
//     return response + citationsText;
//   }

//   return response;
// }

// // ---------------------------
// // Core LLM Call Logic
// // ✅ NOTE: Web search results are already included in the 'prompt' parameter
// // This function handles ALL providers (Gemini, Claude, OpenAI, DeepSeek)
// // All providers receive the same prompt which includes web search results when available
// // ---------------------------
// async function callSinglePrompt(provider, prompt, systemPrompt, hasWebSearch = false) {
//   const config = ALL_LLM_CONFIGS[provider];
//   const isClaude = provider.startsWith('claude') || provider === 'anthropic';
//   const isGemini = provider.startsWith('gemini');

//   console.log(`[SystemPrompt] 📝 Applying system instruction for ${provider} (FolderAI) (length: ${systemPrompt.length} chars)${hasWebSearch ? ' [WITH WEB/URL DATA]' : ''}`);
//   if (hasWebSearch) {
//     console.log(`[Web Search] ✅ ${provider} model will receive web search results in prompt (FolderAI)`);
//   }

//   // ---- Gemini ----
//   if (isGemini) {
//     const models = GEMINI_MODELS[provider] || GEMINI_MODELS['gemini'];
//     for (const modelName of models) {
//       try {
//         const maxOutputTokens = await getModelMaxTokens(provider, modelName);
//         console.log(`[FolderLLM Max Tokens] Gemini model ${modelName} using maxOutputTokens=${maxOutputTokens}`);
        
//         const isGemini3Pro = modelName === 'gemini-3-pro-preview';
        
//         if (isGemini3Pro) {
//           console.log(`[SystemPrompt] 🎯 Gemini 3.0 Pro ${modelName} using new SDK with system instruction (FolderAI)`);
          
//           try {
//             const totalRequestSize = prompt.length + (systemPrompt?.length || 0);
//             const maxSafeRequestSize = 3000000;
            
//             let finalPrompt = prompt;
//             let finalSystemPrompt = systemPrompt;
            
//             if (totalRequestSize > maxSafeRequestSize) {
//               console.warn(`[Gemini 3.0 Pro] ⚠️ Request size (${totalRequestSize} chars) exceeds safe limit (${maxSafeRequestSize} chars). Truncating...`);
//               const maxPromptSize = Math.floor(maxSafeRequestSize * 0.9);
//               const truncatedPrompt = prompt.substring(0, maxPromptSize);
//               finalPrompt = truncatedPrompt + '\n\n[...content truncated due to size limits...]';
//               console.log(`[Gemini 3.0 Pro] 📉 Truncated prompt from ${prompt.length} to ${finalPrompt.length} chars`);
//             }
            
//             const request = {
//               model: modelName,
//               contents: [
//                 {
//                   role: 'user',
//                   parts: [{ text: finalPrompt }]
//                 }
//               ],
//               systemInstruction: finalSystemPrompt ? {
//                 parts: [{ text: finalSystemPrompt }]
//               } : undefined,
//               generationConfig: {
//                 maxOutputTokens: maxOutputTokens,
//                 temperature: 0.7,
//               }
//             };

//             console.log(`[Gemini 3.0 Pro] 🚀 Sending request with ${finalPrompt.length} chars prompt and ${(finalSystemPrompt?.length || 0)} chars system instruction`);
            
//             const requestPromise = genAI3.models.generateContent(request);
//             const timeoutPromise = new Promise((_, reject) => 
//               setTimeout(() => reject(new Error('Request timeout: Gemini 3.0 Pro API request took too long')), 180000)
//             );
            
//             const response = await Promise.race([requestPromise, timeoutPromise]);
            
//             let text = '';
//             if (response.text) {
//               text = response.text;
//             } else if (response.candidates && response.candidates.length > 0) {
//               const candidate = response.candidates[0];
//               if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
//                 text = candidate.content.parts.map(part => part.text || '').join('');
//               }
//             }
            
//             if (!text) {
//               console.error('[Gemini 3.0 Pro] ❌ No text in response:', JSON.stringify(response, null, 2));
//               throw new Error('No text content in Gemini 3.0 Pro response');
//             }
            
//             const usage = response.usageMetadata || {};
//             console.log(
//               `✅ Gemini 3.0 Pro (${modelName}) - Tokens used: ${usage.promptTokenCount || 0} + ${usage.candidatesTokenCount || 0} = ${(usage.promptTokenCount || 0) + (usage.candidatesTokenCount || 0)} | max=${maxOutputTokens} (FolderAI)`
//             );
            
//             return text;
//           } catch (gemini3Error) {
//             const isNetworkError = gemini3Error.message?.includes('fetch failed') || 
//                                   gemini3Error.message?.includes('network') ||
//                                   gemini3Error.message?.includes('timeout') ||
//                                   gemini3Error.message?.includes('ECONNREFUSED') ||
//                                   gemini3Error.message?.includes('ETIMEDOUT');
            
//             if (isNetworkError) {
//               console.error(`[Gemini 3.0 Pro] ❌ Network/Request error: ${gemini3Error.message}`);
//               console.log(`[Gemini 3.0 Pro] ⚠️ Attempting fallback to legacy Gemini models...`);
//               throw new Error(`Gemini 3.0 Pro network error - will try legacy models: ${gemini3Error.message}`);
//             } else {
//               console.error(`[Gemini 3.0 Pro] ❌ Error details:`, {
//                 message: gemini3Error.message,
//                 stack: gemini3Error.stack,
//                 response: gemini3Error.response?.data
//               });
//               throw gemini3Error;
//             }
//           }
//         } else {
//           console.log(`[SystemPrompt] 🎯 Gemini ${modelName} using legacy SDK with systemInstruction from database (FolderAI)`);
//           const model = genAI.getGenerativeModel(
//             systemPrompt ? { model: modelName, systemInstruction: systemPrompt } : { model: modelName }
//           );
//           const result = await model.generateContent(prompt, {
//             generationConfig: {
//               maxOutputTokens,
//             },
//           });
//           const geminiResponse = await result.response.text();
//           const inputTokens = result.response.usageMetadata?.promptTokenCount || 0;
//           const outputTokens = result.response.usageMetadata?.candidatesTokenCount || 0;
//           console.log(`✅ Gemini (${modelName}) - Input: ${inputTokens}, Output: ${outputTokens}, Total: ${inputTokens + outputTokens} | max=${maxOutputTokens} (FolderAI)`);
//           return geminiResponse;
//         }
//       } catch (err) {
//         console.warn(`❌ Gemini model ${modelName} failed: ${err.message}`);
        
//         const isGemini3ProFailure = modelName === 'gemini-3-pro-preview' && err.message?.includes('Gemini 3.0 Pro network error');
//         const hasLegacyModels = models.length > 1 && models.some(m => m !== 'gemini-3-pro-preview');
        
//         if (isGemini3ProFailure && hasLegacyModels) {
//           console.log(`[Gemini 3.0 Pro] ⚠️ Falling back to legacy Gemini models due to network error...`);
//           continue;
//         }
        
//         if (modelName === models[models.length - 1]) {
//           throw err;
//         }
//         continue;
//       }
//     }
//     throw new Error(`❌ All Gemini models failed.`);
//   }

//   // ---- Claude / OpenAI / DeepSeek ----
//   const messages = isClaude
//     ? [{ role: 'user', content: prompt }]
//     : [
//         { role: 'system', content: systemPrompt },
//         { role: 'user', content: prompt },
//       ];

//   const resolvedModel = config.model;
//   const maxTokens = await getModelMaxTokens(provider, resolvedModel);

//   if (isClaude) {
//     console.log(`[SystemPrompt] 🎯 Claude ${resolvedModel} using system field from database (FolderAI)`);
//   } else {
//     console.log(`[SystemPrompt] 🎯 ${provider} ${resolvedModel} using system role in messages from database (FolderAI)`);
//   }

//   const payload = isClaude
//     ? {
//         model: config.model,
//         max_tokens: maxTokens,
//         system: systemPrompt,
//         messages,
//       }
//     : {
//         model: config.model,
//         messages,
//         max_tokens: maxTokens,
//         temperature: 0.7,
//       };
//   console.log(`[FolderLLM Max Tokens] ${provider} model ${resolvedModel} using max_tokens=${maxTokens}`);

//   const response = await axios.post(config.apiUrl, payload, {
//     headers: config.headers,
//     timeout: 120000,
//   });

//   let inputTokens = 0;
//   let outputTokens = 0;

//   if (isClaude) {
//     inputTokens = response.data?.usage?.input_tokens || 0;
//     outputTokens = response.data?.usage?.output_tokens || 0;
//   } else {
//     inputTokens = response.data?.usage?.prompt_tokens || 0;
//     outputTokens = response.data?.usage?.completion_tokens || 0;
//   }

//   console.log(`✅ ${provider} - Input: ${inputTokens}, Output: ${outputTokens}, Total: ${inputTokens + outputTokens} | max=${maxTokens} (FolderAI)`);

//   return isClaude
//     ? response.data?.content?.[0]?.text || response.data?.completion
//     : response.data?.choices?.[0]?.message?.content || '';
// }

// // ---------------------------
// // Streaming LLM Caller (SSE Support for Folder AI)
// // Returns async generator that yields text chunks
// // ---------------------------
// async function* streamLLM(providerName, userMessage, context = '', relevant_chunks = null, originalQuestion = null) {
//   // Use the same logic as askLLM to build prompt and context
//   // Then stream the response instead of waiting for complete response
//   const provider = resolveProviderName(providerName);
//   const config = ALL_LLM_CONFIGS[provider];
//   if (!config) throw new Error(`❌ Unsupported LLM provider: ${provider}`);

//   const safeContext = typeof context === 'string' ? context : '';
//   let userQuestionForSearch = originalQuestion || userMessage;
  
//   // Extract question for web search (same logic as askLLM)
//   if (!originalQuestion && userMessage) {
//     const userQuestionMatch = userMessage.match(/USER QUESTION:\s*(.+?)(?:\n\n===|$)/s);
//     if (userQuestionMatch) {
//       userQuestionForSearch = userQuestionMatch[1].trim();
//     }
//   }

//   // Check for explicit web request (same logic as askLLM)
//   const messageLower = userQuestionForSearch.toLowerCase();
//   const explicitWebKeywords = [
//     'search web', 'search online', 'from web', 'web se', 'web pe', 
//     'don\'t want from document', 'not from document', 'ignore document'
//   ];
//   const isExplicitWebRequest = explicitWebKeywords.some(keyword => messageLower.includes(keyword));
  
//   // Process context and chunks (same as askLLM)
//   let trimmedContext, filteredChunks, trimmedFilteredChunks;
//   if (isExplicitWebRequest) {
//     trimmedContext = '';
//     filteredChunks = '';
//     trimmedFilteredChunks = '';
//   } else {
//     trimmedContext = trimContext(safeContext, 200);
//     filteredChunks = filterRelevantChunks(relevant_chunks, userQuestionForSearch, 5);
//     trimmedFilteredChunks = trimContext(filteredChunks, 700);
//   }

//   // Handle web search if needed
//   let webSearchData = null;
//   const needsWebSearch = isExplicitWebRequest || shouldTriggerWebSearch(userQuestionForSearch, trimmedContext, trimmedFilteredChunks);
//   if (needsWebSearch) {
//     webSearchData = await performWebSearch(userQuestionForSearch, 5);
//   }

//   // Build prompt (same logic as askLLM)
//   let prompt = userMessage.trim();
//   if (trimmedFilteredChunks && !isExplicitWebRequest) {
//     prompt += `\n\n=== UPLOADED DOCUMENTS CONTEXT ===\n${trimmedFilteredChunks}`;
//   }
//   if (webSearchData && webSearchData.results) {
//     prompt += `\n\n=== WEB SEARCH RESULTS ===\n${webSearchData.results}`;
//   }

//   // Get system prompt
//   const baseSystemPrompt = await getSystemPrompt(trimmedContext);
//   const enhancedSystemPrompt = buildEnhancedSystemPrompt(
//     baseSystemPrompt,
//     Boolean(trimmedContext || trimmedFilteredChunks) && !isExplicitWebRequest,
//     Boolean(webSearchData),
//     false,
//     isExplicitWebRequest
//   );

//   const isGemini = provider.startsWith('gemini');
//   const isClaude = provider.startsWith('claude') || provider === 'anthropic';

//   // Stream based on provider
//   if (isGemini) {
//     const models = GEMINI_MODELS[provider] || GEMINI_MODELS['gemini'];
//     for (const modelName of models) {
//       try {
//         const maxOutputTokens = await getModelMaxTokens(provider, modelName);
//         const isGemini3Pro = modelName === 'gemini-3-pro-preview';
        
//         if (isGemini3Pro) {
//           // Gemini 3.0 Pro streaming (new SDK)
//           const request = {
//             model: modelName,
//             contents: [{ role: 'user', parts: [{ text: prompt }] }],
//             systemInstruction: enhancedSystemPrompt ? { parts: [{ text: enhancedSystemPrompt }] } : undefined,
//             generationConfig: { maxOutputTokens, temperature: 0.7 },
//           };
          
//           const totalPromptSize = prompt.length + (enhancedSystemPrompt?.length || 0);
//           console.log(`[Gemini 3.0 Pro Stream] 🚀 Starting stream request (prompt: ${prompt.length} chars, system: ${enhancedSystemPrompt?.length || 0} chars, total: ${totalPromptSize} chars)`);
          
//           // Calculate adaptive timeout based on prompt size
//           // Base timeout: 60 seconds
//           // Additional time: ~1 second per 1000 characters (for large prompts)
//           const baseTimeout = 60000; // 60 seconds base
//           const sizeBasedTimeout = Math.ceil(totalPromptSize / 1000) * 1000; // ~1s per 1000 chars
//           const INIT_TIMEOUT = Math.min(baseTimeout + sizeBasedTimeout, 180000); // Max 3 minutes
          
//           console.log(`[Gemini 3.0 Pro Stream] ⏱️ Using initialization timeout: ${Math.round(INIT_TIMEOUT/1000)}s (base: ${Math.round(baseTimeout/1000)}s + size: ${Math.round(sizeBasedTimeout/1000)}s)`);
          
//           // Retry logic for network failures and timeouts
//           let response;
//           let lastError;
//           const MAX_RETRIES = 3; // Increased retries
//           const RETRY_DELAY = 3000; // 3 seconds between retries
          
//           for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
//             try {
//               if (attempt > 0) {
//                 console.log(`[Gemini 3.0 Pro Stream] 🔄 Retry attempt ${attempt}/${MAX_RETRIES} after ${RETRY_DELAY}ms delay...`);
//                 await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
//               }
              
//               // Add timeout wrapper for the initial request with adaptive timeout
//               const requestPromise = genAI3.models.generateContentStream(request);
//               let timeoutId;
//               const timeoutPromise = new Promise((_, reject) => {
//                 timeoutId = setTimeout(() => {
//                   reject(new Error(`Request timeout: Gemini 3.0 Pro stream initialization took too long (>${Math.round(INIT_TIMEOUT/1000)}s). This may be due to a large prompt (${totalPromptSize} chars).`));
//                 }, INIT_TIMEOUT);
//               });
              
//               try {
//                 response = await Promise.race([requestPromise, timeoutPromise]);
//                 // Clear timeout if request succeeds
//                 if (timeoutId) clearTimeout(timeoutId);
//               } catch (error) {
//                 // Clear timeout on error
//                 if (timeoutId) clearTimeout(timeoutId);
//                 throw error;
//               }
//               console.log(`[Gemini 3.0 Pro Stream] ✅ Stream initialized successfully (attempt ${attempt + 1})`);
//               break; // Success, exit retry loop
//             } catch (initError) {
//               lastError = initError;
//               const errorMsg = initError.message || initError.toString();
//               const isNetworkError = errorMsg.includes('fetch failed') || 
//                                     errorMsg.includes('ECONNRESET') || 
//                                     errorMsg.includes('ETIMEDOUT') ||
//                                     errorMsg.includes('network') ||
//                                     errorMsg.includes('NetworkError');
              
//               const isTimeoutError = errorMsg.includes('timeout') || errorMsg.includes('Timeout');
//               const isRetryableError = isNetworkError || isTimeoutError;
              
//               console.error(`[Gemini 3.0 Pro Stream] ❌ Attempt ${attempt + 1} failed:`, errorMsg);
              
//               if (isRetryableError && attempt < MAX_RETRIES) {
//                 const errorType = isTimeoutError ? 'timeout' : 'network';
//                 console.log(`[Gemini 3.0 Pro Stream] 🔄 ${errorType} error detected, will retry (${attempt + 1}/${MAX_RETRIES})...`);
//                 continue; // Retry on network/timeout errors
//               } else {
//                 // Not a retryable error or max retries reached
//                 if (attempt >= MAX_RETRIES) {
//                   console.error(`[Gemini 3.0 Pro Stream] ❌ Failed to initialize stream after ${attempt + 1} attempt(s):`, errorMsg);
//                 }
//                 throw initError;
//               }
//             }
//           }
          
//           if (!response) {
//             throw lastError || new Error('Failed to initialize stream after all retry attempts');
//           }
          
//           // Handle different response structures - the response might be the stream itself
//           // or it might have a .stream property
//           let stream = null;
//           if (response && typeof response[Symbol.asyncIterator] === 'function') {
//             // Response itself is iterable
//             stream = response;
//             console.log(`[Gemini 3.0 Pro Stream] ✅ Response is directly iterable`);
//           } else if (response && response.stream && typeof response.stream[Symbol.asyncIterator] === 'function') {
//             // Response has a .stream property that is iterable
//             stream = response.stream;
//             console.log(`[Gemini 3.0 Pro Stream] ✅ Response has iterable stream property`);
//           } else {
//             // Log detailed error information for debugging
//             console.error('[Gemini 3.0 Pro Stream] Invalid response structure:', {
//               hasStream: !!response?.stream,
//               hasResponse: !!response,
//               responseKeys: response ? Object.keys(response) : [],
//               responseType: typeof response,
//               isIterable: response && typeof response[Symbol.asyncIterator] === 'function',
//               streamIsIterable: response?.stream && typeof response.stream[Symbol.asyncIterator] === 'function'
//             });
//             throw new Error('Invalid streaming response from Gemini 3.0 Pro API - response is not iterable');
//           }
          
//           try {
//             let chunkCount = 0;
//             let lastChunkTime = Date.now();
//             const STREAM_TIMEOUT = 120000; // 2 minutes max between chunks
//             const HEARTBEAT_INTERVAL = 10000; // Log every 10 seconds if no chunks
//             let streamTimedOut = false;
            
//             // Create a timeout monitor that will log if no chunks arrive
//             const timeoutMonitor = setInterval(() => {
//               const timeSinceLastChunk = Date.now() - lastChunkTime;
//               if (timeSinceLastChunk > HEARTBEAT_INTERVAL) {
//                 console.log(`[Gemini 3.0 Pro Stream] ⏳ Waiting for chunks... (${Math.round(timeSinceLastChunk/1000)}s since last chunk, ${chunkCount} chunks received)`);
//               }
//             }, HEARTBEAT_INTERVAL);
            
//             try {
//               // Iterate through the stream
//               for await (const chunk of stream) {
//                 if (streamTimedOut) break;
                
//                 lastChunkTime = Date.now();
//                 chunkCount++;
                
//                 // Log first chunk
//                 if (chunkCount === 1) {
//                   console.log(`[Gemini 3.0 Pro Stream] ✅ First chunk received`);
//                 }
                
//                 const text = chunk?.text || (typeof chunk?.text === 'function' ? chunk.text() : '') || '';
//                 const reasoning = chunk?.reasoning || chunk?.reasoningMetadata?.reasoning || '';
                
//                 // Yield thinking/reasoning tokens if present
//                 if (reasoning) {
//                   yield { type: 'thinking', text: reasoning };
//                 }
                
//                 // Yield content tokens
//                 if (text) {
//                   yield { type: 'content', text: text };
//                 }
//               }
              
//               clearInterval(timeoutMonitor);
//               console.log(`[Gemini 3.0 Pro Stream] ✅ Stream completed (${chunkCount} chunks total)`);
//             } catch (iterationError) {
//               clearInterval(timeoutMonitor);
//               const errorMsg = iterationError.message || iterationError.toString();
//               const isNetworkError = errorMsg.includes('fetch failed') || 
//                                     errorMsg.includes('ECONNRESET') || 
//                                     errorMsg.includes('ETIMEDOUT') ||
//                                     errorMsg.includes('network');
              
//               if (isNetworkError) {
//                 console.error(`[Gemini 3.0 Pro Stream] ❌ Network error during streaming (received ${chunkCount} chunks):`, errorMsg);
//                 throw new Error(`Network error during streaming: ${errorMsg}. Received ${chunkCount} chunks before failure.`);
//               } else {
//                 console.error(`[Gemini 3.0 Pro Stream] ❌ Error during stream iteration (received ${chunkCount} chunks):`, errorMsg);
//                 throw iterationError;
//               }
//             }
//           } catch (streamError) {
//             console.error('[Gemini 3.0 Pro Stream] Error during streaming:', streamError);
//             throw streamError;
//           }
//           return; // Successfully streamed
//         } else {
//           // Legacy Gemini streaming
//           const model = genAI.getGenerativeModel(
//             enhancedSystemPrompt ? { model: modelName, systemInstruction: enhancedSystemPrompt } : { model: modelName }
//           );
//           const result = await model.generateContentStream(prompt, {
//             generationConfig: { maxOutputTokens },
//           });
          
//           for await (const chunk of result.stream) {
//             const text = chunk.text();
//             // Check for reasoning in legacy format
//             const reasoning = chunk.reasoning || chunk.reasoningMetadata?.reasoning || '';
            
//             if (reasoning) {
//               yield { type: 'thinking', text: reasoning };
//             }
            
//             if (text) {
//               yield { type: 'content', text: text };
//             }
//           }
//           return; // Successfully streamed
//         }
//       } catch (err) {
//         if (modelName === models[models.length - 1]) throw err;
//         continue;
//       }
//     }
//   }

//   // Claude / OpenAI / DeepSeek streaming
//   const messages = isClaude
//     ? [{ role: 'user', content: prompt }]
//     : [{ role: 'system', content: enhancedSystemPrompt }, { role: 'user', content: prompt }];

//   const resolvedModel = config.model;
//   const maxTokens = await getModelMaxTokens(provider, resolvedModel);

//   const payload = isClaude
//     ? { model: config.model, max_tokens: maxTokens, messages, system: enhancedSystemPrompt, stream: true }
//     : { model: config.model, messages, max_tokens: maxTokens, temperature: 0.7, stream: true };

//   const response = await axios.post(config.apiUrl, payload, {
//     headers: config.headers,
//     responseType: 'stream',
//     timeout: 120000,
//   });

//   // Stream chunks from response
//   let buffer = '';
//   for await (const chunk of response.data) {
//     buffer += chunk.toString();
//     const lines = buffer.split('\n');
//     buffer = lines.pop() || ''; // Keep incomplete line in buffer
    
//     for (const line of lines) {
//       if (!line.trim() || !line.startsWith('data: ')) continue;
//       const data = line.replace(/^data: /, '').trim();
//       if (data === '[DONE]') return;
//       try {
//         const json = JSON.parse(data);
//         const text = isClaude
//           ? json.delta?.text || json.content_block_delta?.text || ''
//           : json.choices?.[0]?.delta?.content || '';
//         if (text) yield text;
//       } catch (e) {
//         // Skip invalid JSON - might be partial data
//       }
//     }
//   }
// }

// // ---------------------------
// // Exports
// // ---------------------------
// module.exports = {
//   askLLM,
//   streamLLM,
//   resolveProviderName,
//   getAvailableProviders,
//   getModelMaxTokens,
//   ALL_LLM_CONFIGS,
// };


require('dotenv').config();
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleGenAI } = require('@google/genai');
const pool = require('../config/db');
const SystemPrompt = require('../models/SystemPrompt');

// Old SDK for legacy Gemini models
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// New SDK for Gemini 3.0 Pro
const genAI3 = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ---------------------------
// Web Search Service using Serper.dev
// ---------------------------
async function performWebSearch(query, numResults = 5) {
  try {
    if (!process.env.SERPER_API_KEY) {
      console.warn('[Web Search] SERPER_API_KEY not found, skipping web search');
      return null;
    }

    console.log(`[Web Search] 🔍 Searching for: "${query}"`);

    const response = await axios.post(
      'https://google.serper.dev/search',
      {
        q: query,
        num: numResults,
      },
      {
        headers: {
          'X-API-KEY': process.env.SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const results = response.data?.organic || [];
    const citations = results.map((result, index) => ({
      index: index + 1,
      title: result.title || '',
      link: result.link || '',
      snippet: result.snippet || '',
    }));

    // Format search results for LLM context
    const formattedResults = results
      .map((result, index) => {
        return `[Source ${index + 1}] ${result.title || 'No title'}\nURL: ${result.link || 'No URL'}\nContent: ${result.snippet || 'No snippet'}`;
      })
      .join('\n\n');

    return {
      results: formattedResults,
      citations,
      rawResults: results,
    };
  } catch (error) {
    console.error('[Web Search] Error performing search:', error.message);
    return null;
  }
}

// ---------------------------
// Fetch Content from URL
// ---------------------------
async function fetchUrlContent(url) {
  try {
    console.log(`[URL Fetch] 📄 Fetching content from: ${url}`);
    
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      maxRedirects: 5
    });

    // Extract text content (basic extraction - you might want to use a library like cheerio for better parsing)
    let content = response.data;
    
    // Remove HTML tags for basic text extraction
    if (typeof content === 'string') {
      content = content
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      // Limit content length
      if (content.length > 10000) {
        content = content.substring(0, 10000) + '...';
      }
    }

    return {
      url: url,
      content: content,
      success: true
    };
  } catch (error) {
    console.error(`[URL Fetch] Error fetching ${url}:`, error.message);
    return {
      url: url,
      content: `Failed to fetch content from ${url}: ${error.message}`,
      success: false
    };
  }
}

// ---------------------------
// Extract URLs from user message
// ---------------------------
function extractUrls(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(urlRegex);
  return matches || [];
}

// ---------------------------
// Auto-detect if web search is needed - FIXED VERSION
// ---------------------------
function shouldTriggerWebSearch(userMessage, context = '', relevantChunks = '') {
  if (!userMessage) return false;

  const message = userMessage.toLowerCase();
  const contextLower = (context || '').toLowerCase();
  const chunksLower = (relevantChunks || '').toLowerCase();
  
  // ============================================
  // PRIORITY 1: EXPLICIT WEB SEARCH REQUESTS (CHECK FIRST!)
  // ============================================
  const explicitWebSearchTriggers = [
    'search for',
    'search from web',
    'search from the web',
    'search on web',
    'search on the web',
    'search online',
    'search the internet',
    'search the web',
    'search web',
    'find information about',
    'find on web',
    'find on the web',
    'find online',
    'look up',
    'look up online',
    'look up on web',
    'google',
    'google search',
    'google it',
    'web search',
    'internet search',
    'search google',
    'use web search',
    'use web',
    'check online',
    'check the web',
    'get from web',
    'get from internet',
    'from web',
    'from the web',
    'from internet',
    'answer from web',
    'answer from the web',
    'give answer from web',
    'give me answer from web',
    'tell me from web',
    'tell from web',
    // Hinglish triggers
    'web se',
    'web pe',
    'web me',
    'online search',
    'internet se',
    'google se',
    'web par',
    'web pe search',
    'online dhoondo',
    'internet se dhoondo',
    'web se dekh',
    'web pe dekh',
    'web se batao',
    'web pe batao',
    'web se answer',
    'web pe answer',
  ];
  
  // Check for explicit web search requests FIRST - these ALWAYS trigger regardless of document context
  const hasExplicitTrigger = explicitWebSearchTriggers.some(trigger => message.includes(trigger));
  if (hasExplicitTrigger) {
    console.log('[Web Search] ✅ EXPLICIT web search request detected - triggering web search (FolderAI)');
    return true;
  }
  
  // ============================================
  // PRIORITY 2: DOCUMENT REJECTION PHRASES
  // ============================================
  const documentRejectionKeywords = [
    // English phrases
    "don't want from document",
    "don't want from the document",
    "don't want answer from document",
    "don't want answer from the document",
    "not from document",
    "not from the document",
    "not from documents",
    "not from these documents",
    "don't use document",
    "don't use the document",
    "ignore document",
    "ignore the document",
    "ignore documents",
    "skip document",
    "skip the document",
    "without document",
    "without documents",
    "not in document",
    "not in the document",
    "i don't want",
    "i dont want",
    "don't want",
    "dont want",
    "not document",
    "no document",
    "without using document",
    "without the document",
    // Hinglish phrases
    "web se search karo",
    "web pe search karo",
    "web me search karo",
    "online search karo",
    "internet se search karo",
    "google se search karo",
    "web par search",
    "web pe search",
    "online search",
    "internet search",
    "web search karo",
    "web me dhoondo",
    "web pe dhoondo",
    "online dhoondo",
    "internet se dhoondo",
    "web se dekh",
    "web pe dekh",
    "online dekh",
    "internet se dekh",
    "document nahi",
    "document mat use karo",
  ];
  
  // Check for document rejection
  const hasDocumentRejection = documentRejectionKeywords.some(keyword => {
    const lowerKeyword = keyword.toLowerCase();
    if (lowerKeyword.length <= 5) {
      return message.includes(lowerKeyword);
    }
    const keywordWords = lowerKeyword.split(/\s+/).filter(w => w.length > 2);
    if (keywordWords.length > 2) {
      return keywordWords.every(word => message.includes(word));
    }
    return message.includes(lowerKeyword);
  });
  
  // Also check for common patterns like "don't want" + "document"
  const hasDontWant = (message.includes("don't want") || message.includes("dont want") || message.includes("don't want") || message.includes("do not want")) && 
                      (message.includes("document") || message.includes("from document"));
  
  // If user explicitly rejects documents, ALWAYS trigger web search
  if (hasDocumentRejection || hasDontWant) {
    console.log('[Web Search] ✅ User explicitly rejected documents - ALWAYS triggering web search (FolderAI)');
    return true;
  }
  
  // ============================================
  // PRIORITY 3: CHECK FOR PERSONAL DATA QUESTIONS (NEVER SEARCH)
  // ============================================
  const personalPronouns = [
    'my',
    'my own',
    'my personal',
    'my profile',
    'my account',
    'my information',
    'my data',
  ];
  
  const personalDataKeywords = [
    'my case',
    'my organization',
    'my company',
    'my firm',
    'my practice',
    'my jurisdiction',
    'my bar',
    'my credentials',
    'my role',
    'my experience',
    'my details',
    'my name',
    'my email',
    'my phone',
    'my address',
    'my license',
    'my registration',
    'my status',
    'my type',
    'my category',
  ];
  
  // Check if question contains personal pronouns
  const hasPersonalPronoun = personalPronouns.some(pronoun => {
    const regex = new RegExp(`\\b${pronoun}\\b`, 'i');
    return regex.test(userMessage);
  });
  
  // Check if question is about personal data
  const isPersonalDataQuestion = personalDataKeywords.some(keyword => message.includes(keyword));
  
  // If question is about user's own data/profile, NEVER trigger web search
  if (hasPersonalPronoun || isPersonalDataQuestion) {
    console.log('[Web Search] Personal data/profile question detected - skipping web search (FolderAI)');
    return false;
  }
  
  // Check if there's substantial document context provided
  const hasDocumentContext = (contextLower.length > 500) || (chunksLower.length > 500);
  
  // ============================================
  // PRIORITY 4: CURRENT/REAL-TIME INFORMATION TRIGGERS
  // ============================================
  const currentInfoTriggers = [
    'latest news',
    'current events',
    'recent updates',
    'what happened today',
    'news about',
    'breaking news',
    'current status',
    'latest developments',
    'recent changes',
    'what is happening',
    'current price',
    'stock price',
    'weather',
    'today',
    'this week',
    'this month',
    'this year',
    'now',
    'currently',
    'as of now',
    'right now',
    'recent',
    'recently',
    'latest',
  ];
  
  // Check for current/real-time information requests
  const hasCurrentInfoTrigger = currentInfoTriggers.some(trigger => message.includes(trigger));
  
  if (hasCurrentInfoTrigger) {
    console.log('[Web Search] ✅ Current/real-time information request detected (FolderAI)');
    return true;
  }
  
  // ============================================
  // PRIORITY 5: GENERAL KNOWLEDGE QUESTIONS (NO DOCUMENTS)
  // ============================================
  const generalKnowledgePatterns = [
    /^what is (.+)\?/i,
    /^who is (.+)\?/i,
    /^when did (.+) happen\?/i,
    /^where is (.+)\?/i,
    /^how (?:do|does|did) (.+)\?/i,
    /^why (?:is|are|did|does) (.+)\?/i,
    /tell me about (.+)/i,
    /explain (.+)/i,
    /what are (.+)/i,
  ];
  
  const isGeneralKnowledgeQuestion = generalKnowledgePatterns.some(pattern => pattern.test(userMessage));
  
  // Document-related keywords that suggest question is ABOUT the documents
  const documentRelatedKeywords = [
    'document',
    'this document',
    'the document',
    'these documents',
    'in the document',
    'from the document',
    'according to',
    'based on',
    'analyze',
    'summarize',
    'what does it say',
    'what is mentioned',
    'what is stated',
    'extract',
    'find in',
    'show me from',
  ];
  
  const isDocumentQuestion = documentRelatedKeywords.some(keyword => message.includes(keyword));
  
  // If question is about documents and we have context, don't search web
  if (isDocumentQuestion && hasDocumentContext) {
    console.log('[Web Search] Question is about documents and context is available - skipping web search (FolderAI)');
    return false;
  }
  
  // If it's a general knowledge question and NO document context, trigger web search
  if (isGeneralKnowledgeQuestion && !hasDocumentContext) {
    console.log('[Web Search] ✅ General knowledge question without document context (FolderAI)');
    return true;
  }
  
  // If there's substantial document context, be conservative
  if (hasDocumentContext) {
    console.log('[Web Search] Document context available - assuming answer is in documents (FolderAI)');
    return false;
  }
  
  // For pre-upload chats (no document context), trigger for knowledge questions
  if (!hasDocumentContext && isGeneralKnowledgeQuestion) {
    console.log('[Web Search] ✅ No document context - triggering for general knowledge question (FolderAI)');
    return true;
  }
  
  // Default: don't trigger web search
  console.log('[Web Search] No web search triggers detected - using available context (FolderAI)');
  return false;
}

// ---------------------------
// Estimate token count (approx)
// ---------------------------
function estimateTokenCount(text = '') {
  return Math.ceil(text.length / 4); // 4 chars per token on average
}

// ---------------------------
// Smart Context Trimmer - REDUCES TOKENS BY 70-90%
// ---------------------------
function trimContext(context, maxTokens = 500) {
  if (!context) return '';
  const tokens = estimateTokenCount(context);
  if (tokens <= maxTokens) return context;
  
  // Take only first portion (most relevant usually at start)
  const ratio = maxTokens / tokens;
  const trimmedLength = Math.floor(context.length * ratio);
  return context.substring(0, trimmedLength) + '...';
}

// ---------------------------
// Smart Chunk Filtering - REDUCES CHUNKS BY 80%
// ---------------------------
function filterRelevantChunks(chunks, userMessage, maxChunks = 5) {
  if (!chunks) return '';
  
  // Handle array of chunk objects
  let chunkString;
  if (Array.isArray(chunks)) {
    // Convert array of chunk objects to string format
    chunkString = chunks
      .map((c) => {
        // Handle both object format and string format
        if (typeof c === 'string') {
          return c;
        }
        // Object format: { content, filename, ... }
        const filename = c.filename || c.originalname || 'Document';
        const content = c.content || '';
        return `📄 [${filename}]\n${content}`;
      })
      .join('\n\n');
  } else if (typeof chunks === 'string') {
    chunkString = chunks;
  } else {
    // Unknown type, return empty string
    return '';
  }
  
  const chunkArray = chunkString.split('\n\n').filter(Boolean);
  if (chunkArray.length <= maxChunks) return chunkString;
  
  // Simple keyword matching to find most relevant chunks
  const keywords = userMessage.toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3)
    .slice(0, 5); // Top 5 keywords only
  
  const scored = chunkArray.map(chunk => {
    const chunkLower = chunk.toLowerCase();
    const score = keywords.reduce((sum, kw) => {
      return sum + (chunkLower.includes(kw) ? 1 : 0);
    }, 0);
    return { chunk, score };
  });
  
  // Sort by relevance and take top N
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChunks)
    .map(s => s.chunk)
    .join('\n\n');
}

// ---------------------------
// Retry Helper
// ---------------------------
async function retryWithBackoff(fn, retries = 3, delay = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      console.warn(`⚠️ Attempt ${attempt} failed:`, err.message);
      if (
        err.message.includes('overloaded') ||
        err.message.includes('503') ||
        err.message.includes('temporarily unavailable') ||
        err.message.includes('quota') ||
        err.message.includes('rate limit')
      ) {
        if (attempt < retries) {
          await new Promise(res => setTimeout(res, delay * attempt));
        } else {
          throw new Error('LLM provider is temporarily unavailable. Please try again later.');
        }
      } else {
        throw err;
      }
    }
  }
}

// ---------------------------
// Gemini model mappings
// ---------------------------
const GEMINI_MODELS = {
  gemini: ['gemini-2.0-flash-exp', 'gemini-1.5-flash'],
  'gemini-pro-2.5': ['gemini-2.5-pro', 'gemini-2.0-pro-exp', 'gemini-1.5-pro'],
  'gemini-3-pro': ['gemini-3-pro-preview'], // Uses new SDK
};

// ---------------------------
// LLM Configurations
// ---------------------------
const LLM_CONFIGS = {
  openai: {
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
  },
  "gpt-4o": {
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
  },
  anthropic: {
    apiUrl: 'https://api.anthropic.com/v1/messages',
    model: 'claude-3-5-haiku-20241022',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
  },
  'claude-sonnet-4': {
    apiUrl: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-4-20250514',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
  },
  'claude-opus-4-1': {
    apiUrl: 'https://api.anthropic.com/v1/messages',
    model: 'claude-opus-4-1-20250805',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
  },
  'claude-sonnet-4-5': {
    apiUrl: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-4-5-20250929',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
  },
  'claude-haiku-4-5': {
    apiUrl: 'https://api.anthropic.com/v1/messages',
    model: 'claude-haiku-4-5-20251001',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
  },
  deepseek: {
    apiUrl: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-chat',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
  },
};

// ---------------------------
// Combined LLM Configurations
// ---------------------------
const ALL_LLM_CONFIGS = {
  ...LLM_CONFIGS,
  gemini: { model: 'gemini-2.0-flash-exp', headers: {} },
  'gemini-pro-2.5': { model: 'gemini-2.5-pro', headers: {} },
  'gemini-3-pro': { model: 'gemini-3-pro-preview' }, // Uses new SDK
};

const llmTokenCache = new Map();

function normalizeProviderForDb(provider = '') {
  const key = provider.toLowerCase();
  if (key.includes('claude') || key === 'anthropic') return 'anthropic';
  if (key.startsWith('gemini')) return 'gemini';
  if (key.startsWith('gpt-') || key.includes('openai')) return 'openai';
  if (key.includes('deepseek')) return 'deepseek';
  return provider;
}

async function queryMaxTokensByProvider(provider, modelName) {
  const query = `
    SELECT max_output_tokens
    FROM llm_max_tokens
    WHERE LOWER(provider) = LOWER($1)
      AND LOWER(model_name) = LOWER($2)
    ORDER BY updated_at DESC
    LIMIT 1;
  `;
  const { rows } = await pool.query(query, [provider, modelName]);
  return rows[0]?.max_output_tokens ?? null;
}

async function queryMaxTokensByModel(modelName) {
  const query = `
    SELECT max_output_tokens
    FROM llm_max_tokens
    WHERE LOWER(model_name) = LOWER($1)
    ORDER BY updated_at DESC
    LIMIT 1;
  `;
  const { rows } = await pool.query(query, [modelName]);
  return rows[0]?.max_output_tokens ?? null;
}

async function getModelMaxTokens(provider, modelName) {
  if (!modelName) {
    throw new Error('Folder LLM configuration missing model name when resolving max tokens.');
  }

  const cacheKey = `${provider.toLowerCase()}::${modelName.toLowerCase()}`;
  if (llmTokenCache.has(cacheKey)) return llmTokenCache.get(cacheKey);

  const providerCandidates = [provider];
  const normalized = normalizeProviderForDb(provider);
  if (normalized && normalized !== provider) providerCandidates.push(normalized);
  providerCandidates.push(null); // fallback: model-only

  for (const candidate of providerCandidates) {
    let value = null;
    try {
      value =
        candidate === null
          ? await queryMaxTokensByModel(modelName)
          : await queryMaxTokensByProvider(candidate, modelName);
    } catch (err) {
      console.error(
        `[FolderLLM Max Tokens] Error querying max tokens for provider="${candidate}" model="${modelName}": ${err.message}`
      );
      continue;
    }

    if (value != null) {
      llmTokenCache.set(cacheKey, value);
      console.log(
        `[FolderLLM Max Tokens] Using max_output_tokens=${value} for provider="${candidate || 'model-only'}" model="${modelName}"`
      );
      return value;
    }
  }

  // Fallback defaults for models not in database
  const defaultMaxTokens = {
    'gemini-3-pro-preview': 8192,
    'gemini-2.5-pro': 8192,
    'gemini-2.5-flash': 8192,
    'gemini-2.0-pro-exp': 8192,
    'gemini-1.5-pro': 8192,
    'gemini-1.5-flash': 8192,
    'gemini-2.0-flash-exp': 8192,
  };

  const modelLower = modelName.toLowerCase();
  if (defaultMaxTokens[modelLower]) {
    const defaultValue = defaultMaxTokens[modelLower];
    llmTokenCache.set(cacheKey, defaultValue);
    console.log(
      `[FolderLLM Max Tokens] Using default max_output_tokens=${defaultValue} for model="${modelName}" (not found in database)`
    );
    return defaultValue;
  }

  throw new Error(
    `Max token configuration not found for provider="${provider}", model="${modelName}". Please insert a row into llm_max_tokens.`
  );
}

// ---------------------------
// Provider Availability Checker
// ---------------------------
function getAvailableProviders() {
  return Object.fromEntries(
    Object.entries(ALL_LLM_CONFIGS).map(([provider, cfg]) => {
      let key;
      if (provider.startsWith('gemini')) key = process.env.GEMINI_API_KEY;
      else if (provider.includes('claude') || provider === 'anthropic') key = process.env.ANTHROPIC_API_KEY;
      else if (provider === 'deepseek') key = process.env.DEEPSEEK_API_KEY;
      else key = process.env.OPENAI_API_KEY;

      return [
        provider,
        { available: !!key, model: cfg.model, reason: key ? 'Available' : 'Missing API key' },
      ];
    })
  );
}

// ---------------------------
// Provider Aliases
// ---------------------------
const PROVIDER_ALIASES = {
  openai: 'openai',
  'gpt-4o': 'gpt-4o',
  'gpt-4o-mini': 'openai',
  gemini: 'gemini',
  'gemini-2.0-flash': 'gemini',
  'gemini-1.5-flash': 'gemini',
  'gemini-pro-2.5': 'gemini-pro-2.5',
  'gemini-3-pro': 'gemini-3-pro',
  'gemini-3.0-pro': 'gemini-3-pro',
  anthropic: 'anthropic',
  'claude': 'anthropic',
  'claude-3-5-haiku': 'anthropic',
  'claude-sonnet-4': 'claude-sonnet-4',
  'claude-opus-4-1': 'claude-opus-4-1',
  'claude-opus-4.1': 'claude-opus-4-1',
  'claude-sonnet-4-5': 'claude-sonnet-4-5',
  'claude-sonnet-4.5': 'claude-sonnet-4-5',
  'claude-haiku-4-5': 'claude-haiku-4-5',
  'claude-haiku-4.5': 'claude-haiku-4-5',
  deepseek: 'deepseek',
  'deepseek-chat': 'deepseek',
};

// ---------------------------
// Resolve Provider
// ---------------------------
function resolveProviderName(name = '') {
  const key = name.trim().toLowerCase();
  const resolved = PROVIDER_ALIASES[key] || 'gemini';
  console.log(`[resolveProviderName] DB name: "${name}" → "${resolved}"`);
  return resolved;
}

// ---------------------------
// Get System Prompt from Database
// ---------------------------
async function getSystemPrompt(baseContext = '') {
  try {
    const dbSystemPrompt = await SystemPrompt.getLatestSystemPrompt();
    
    if (dbSystemPrompt && baseContext) {
      const combinedPrompt = `${dbSystemPrompt}

${baseContext}`;
      console.log('[SystemPrompt] 🔄 Using database system prompt (PRIMARY) + adaptive context (ENHANCEMENT) (FolderAI)');
      console.log(`[SystemPrompt] Database prompt length: ${dbSystemPrompt.length} chars | Adaptive context: ${baseContext.length} chars (FolderAI)`);
      return combinedPrompt;
    }
    
    if (dbSystemPrompt) {
      console.log('[SystemPrompt] ✅ Using system prompt from database (STRICT COMPLIANCE MODE) (FolderAI)');
      console.log(`[SystemPrompt] Database prompt length: ${dbSystemPrompt.length} chars (FolderAI)`);
      return dbSystemPrompt;
    }
    
    console.log('[SystemPrompt] ⚠️ No database prompt found, using fallback system instruction (FolderAI)');
    return baseContext || 'You are a helpful assistant.';
  } catch (err) {
    console.error('[SystemPrompt] ❌ Error getting system prompt, using fallback (FolderAI):', err.message);
    return baseContext || 'You are a helpful assistant.';
  }
}

// ---------------------------
// Build Enhanced System Prompt with Source Attribution
// ---------------------------
function buildEnhancedSystemPrompt(baseSystemPrompt, hasDocuments, hasWebSearch, hasUrlContent, isExplicitWebRequest = false) {
  let sourceInfo = '';
  
  // If explicit web request, prioritize web sources CRITICALLY
  if (isExplicitWebRequest && (hasWebSearch || hasUrlContent)) {
    sourceInfo = `\n\n⚠️ CRITICAL: The user EXPLICITLY requested information from the INTERNET/WEB.
You MUST prioritize and use WEB SEARCH RESULTS${hasUrlContent ? ' or FETCHED WEBSITE CONTENT' : ''} as your PRIMARY source.

PRIMARY SOURCE: Web Search Results${hasUrlContent ? ' / Fetched Website Content' : ''}
- Start your answer with: "According to web search results..." or "Based on information from the internet..."
- Cite sources using [Source 1], [Source 2], etc. when using information from search results
- If using fetched website content, cite the URL explicitly: "According to [URL]..."
- Use ONLY web search results and fetched website content to answer the question
- DO NOT rely on documents - the user explicitly requested web/internet information`;
  } else if (hasWebSearch && hasDocuments) {
    sourceInfo = `\n\nIMPORTANT: You have access to TWO sources of information:
1. **User Documents/Profile**: Internal documents and user profile information
2. **Web Search Results**: Real-time information from the internet${hasUrlContent ? ' and fetched website content' : ''}

When answering:
- If using information from user documents, mention "Based on your documents/profile..."
- If using information from web search, cite the source number like [Source 1] and include it in your response
- If using fetched website content, cite the URL and mention "According to the website..."
- If using both, clearly distinguish which information comes from which source
- Always prioritize user documents for personal/organization-specific questions
- Use web search results for current events, general knowledge, or recent information`;
  } else if (hasWebSearch) {
    sourceInfo = `\n\nIMPORTANT: You have access to web search results${hasUrlContent ? ' and fetched website content' : ''} to answer this question.
- Cite sources using [Source 1], [Source 2], etc. when using information from search results
- If using fetched website content, cite the URL and mention "According to the website..."
- Provide accurate, up-to-date information based on the search results
- Indicate clearly that this information comes from web sources`;
  } else if (hasDocuments) {
    sourceInfo = `\n\nIMPORTANT: You have access to user documents and profile information.
- When answering based on documents, mention "Based on your documents..." or "According to the provided information..."
- Focus on information from the user's documents and context`;
  }
  
  return baseSystemPrompt + sourceInfo;
}

// ---------------------------
// Main Optimized LLM Caller - WITH URL FETCHING
// ---------------------------
async function askLLM(providerName, userMessage, context = '', relevant_chunks = null, originalQuestion = null) {
  const provider = resolveProviderName(providerName);
  const config = ALL_LLM_CONFIGS[provider];
  if (!config) throw new Error(`❌ Unsupported LLM provider: ${provider}`);

  // Ensure context is always a string
  const safeContext = typeof context === 'string' ? context : '';

  // Extract original user question for web search
  let userQuestionForSearch = originalQuestion || userMessage;
  
  if (!originalQuestion && userMessage) {
    const userQuestionMatch = userMessage.match(/USER QUESTION:\s*(.+?)(?:\n\n===|$)/s);
    if (userQuestionMatch) {
      userQuestionForSearch = userQuestionMatch[1].trim();
    } else {
      const lines = userMessage.split('\n');
      const contextMarkers = ['===', '---', 'Relevant Context', 'DOCUMENT', 'PROFILE'];
      for (let i = 0; i < lines.length; i++) {
        if (contextMarkers.some(marker => lines[i].includes(marker))) {
          userQuestionForSearch = lines.slice(0, i).join(' ').trim();
          break;
        }
      }
      if (!userQuestionForSearch || userQuestionForSearch.length > 500) {
        userQuestionForSearch = userMessage.substring(0, 200).trim();
      }
    }
  }

  // Check if this is an EXPLICIT web/internet request BEFORE trimming context
  const messageLower = userQuestionForSearch.toLowerCase();
  const explicitWebKeywords = [
    'search web', 'search online', 'search the web', 'search internet', 'from web', 'from the web',
    'from internet', 'from online', 'web se', 'web pe', 'online search', 'internet search', 'web search',
    'don\'t want from document', 'dont want from document', 'not from document', 'ignore document', 'skip document',
    'answer from web', 'give me from web', 'tell me from web', 'web se search', 'web pe search',
    'search on web', 'search on internet', 'find on web', 'find on internet', 'look up on web',
    'web se dhoondo', 'web pe dhoondo', 'internet se', 'online dhoondo', 'web se batao'
  ];
  const isExplicitWebRequest = explicitWebKeywords.some(keyword => messageLower.includes(keyword));
  
  // If explicit web request, MINIMIZE document context
  let trimmedContext, filteredChunks, trimmedFilteredChunks;
  if (isExplicitWebRequest) {
    // Minimize document context for explicit web requests
    console.log('[Web Search] 🎯 Explicit web request detected - minimizing document context (FolderAI)');
    trimmedContext = ''; // Don't include profile context for explicit web requests
    filteredChunks = ''; // Don't include document chunks for explicit web requests
    trimmedFilteredChunks = ''; // No document context
  } else {
    // Normal processing: trim context and chunks
    trimmedContext = trimContext(safeContext, 200);
    filteredChunks = filterRelevantChunks(relevant_chunks, userQuestionForSearch, 5);
    trimmedFilteredChunks = trimContext(filteredChunks, 700);
  }

  // Check document availability
  const hasDocumentContext = Boolean(trimmedContext || trimmedFilteredChunks);

  // Initialize search and URL data
  let webSearchData = null;
  let citations = [];
  let sourceInfo = [];
  let urlContents = [];
  
  // Check for URLs in user message
  const urls = extractUrls(userQuestionForSearch);
  
  // Determine what sources are available (only if not explicit web request)
  if (!isExplicitWebRequest) {
    if (trimmedFilteredChunks) {
      sourceInfo.push('📄 Uploaded Documents');
    }
    if (trimmedContext) {
      sourceInfo.push('📋 User Profile/Context');
    }
  }
  
  // Fetch URL content if URLs are present
  if (urls.length > 0) {
    console.log(`[URL Fetch] 🔗 Found ${urls.length} URL(s) in message, fetching content... (FolderAI)`);
    for (const url of urls) {
      const urlData = await fetchUrlContent(url);
      if (urlData.success) {
        urlContents.push(urlData);
        sourceInfo.push(`🔗 Website: ${url}`);
      }
    }
  }
  
  // ✅ WEB SEARCH: Provider-agnostic - works for ALL LLM models (Gemini, Claude, OpenAI, DeepSeek)
  // Web search is called BEFORE provider-specific LLM calls, so all models receive web search results
  const needsWebSearch = isExplicitWebRequest || shouldTriggerWebSearch(userQuestionForSearch, trimmedContext, trimmedFilteredChunks);
  
  if (needsWebSearch) {
    console.log(`[Web Search] 🔍 ${isExplicitWebRequest ? 'EXPLICIT' : 'Auto'}-triggering web search for user question (FolderAI):`, userQuestionForSearch.substring(0, 100));
    console.log(`[Web Search] 📋 Provider: ${provider} - Web search will be available for this model (FolderAI)`);
    webSearchData = await performWebSearch(userQuestionForSearch, 5);
    
    if (webSearchData && webSearchData.results) {
      citations = webSearchData.citations;
      sourceInfo.push('🌐 Web Search');
      console.log(`[Web Search] ✅ Found ${citations.length} search results with citations for provider ${provider} (FolderAI)`);
      console.log(`[Web Search] ✅ Web search results will be included in prompt for ${provider} model (FolderAI)`);
    } else {
      console.log(`[Web Search] ⚠️ No search results found for provider ${provider} (FolderAI)`);
    }
  } else {
    console.log(`[Web Search] ⏭️ Web search not needed for provider ${provider} (FolderAI)`);
  }
  
  // Build prompt with prioritized sources based on request type
  let prompt = userMessage.trim();
  
  // ⚠️ CRITICAL: If explicit web search is requested, prioritize web sources and minimize documents
  if (isExplicitWebRequest && (webSearchData || urlContents.length > 0)) {
    console.log('[Web Search] 🎯 EXPLICIT web search request - prioritizing web sources over documents (FolderAI)');
    
    // Add web sources FIRST (highest priority)
    if (urlContents.length > 0) {
      prompt += `\n\n=== PRIMARY SOURCE: FETCHED WEBSITE CONTENT ===`;
      urlContents.forEach(urlData => {
        prompt += `\n\n[Website: ${urlData.url}]\n${urlData.content}`;
      });
      prompt += `\n\n⚠️ CRITICAL: This website content is the PRIMARY source for your answer.`;
    }
    
    if (webSearchData && webSearchData.results) {
      prompt += `\n\n=== PRIMARY SOURCE: WEB SEARCH RESULTS ===\n${webSearchData.results}`;
      prompt += `\n\n⚠️ CRITICAL: These web search results are the PRIMARY source for your answer. Use them as the main source.`;
    }
    
    // Add document context LAST (secondary/optional reference only)
    if (trimmedFilteredChunks) {
      prompt += `\n\n=== SECONDARY REFERENCE: UPLOADED DOCUMENTS (OPTIONAL) ===\n${trimmedFilteredChunks}`;
      prompt += `\n\n⚠️ NOTE: The user explicitly requested web/internet information. Use documents ONLY for additional context if needed, but PRIMARY source must be web search results.`;
    }
    
    // Explicit instructions for web-first response
    prompt += `\n\n🎯 CRITICAL INSTRUCTIONS:
- The user EXPLICITLY requested information from the INTERNET/WEB
- You MUST prioritize and use WEB SEARCH RESULTS or FETCHED WEBSITE CONTENT as your PRIMARY source
- Use document context ONLY as secondary reference if absolutely necessary
- Start your answer with: "According to web search results..." or "Based on information from the internet..."
- If using web search, cite sources as [Source 1], [Source 2], etc.
- If using fetched website content, mention the URL explicitly
- DO NOT rely primarily on documents when the user asked for web/internet information`;
    
  } else {
    // Normal mode: documents first, then web sources
    // Add document context
    if (trimmedFilteredChunks) {
      prompt += `\n\n=== UPLOADED DOCUMENTS CONTEXT ===\n${trimmedFilteredChunks}`;
    }
    
    // Add fetched URL content
    if (urlContents.length > 0) {
      prompt += `\n\n=== FETCHED WEBSITE CONTENT ===`;
      urlContents.forEach(urlData => {
        prompt += `\n\n[Website: ${urlData.url}]\n${urlData.content}`;
      });
      prompt += `\n\n⚠️ IMPORTANT: When using information from fetched websites above, cite the URL and mention "According to ${urlContents[0].url}..."`;
    }
    
    // Add web search results
    if (webSearchData && webSearchData.results) {
      prompt += `\n\n=== WEB SEARCH RESULTS ===\n${webSearchData.results}\n\n⚠️ IMPORTANT: When using information from web sources above, cite them as [Source 1], [Source 2], etc.`;
    }
    
    // Add source instruction
    if (sourceInfo.length > 0) {
      prompt += `\n\n📌 Available Information Sources: ${sourceInfo.join(', ')}`;
      prompt += `\n\n🎯 Instructions: 
- Answer the question using the most relevant sources available.
- Clearly indicate which source(s) you're using (e.g., "Based on your uploaded documents..." or "According to web search results..." or "From the website..." or "From your profile...").
- If using web search, cite sources as [Source 1], [Source 2], etc.
- If using fetched website content, mention the URL.
- If information is not available in any source, clearly state that.`;
    }
  }

  const totalTokens = estimateTokenCount(prompt + trimmedContext);
  console.log(`[askLLM] Optimized Tokens: ${totalTokens} (context: ${estimateTokenCount(trimmedContext)}, chunks: ${estimateTokenCount(trimmedFilteredChunks || '')}) | Sources: ${sourceInfo.join(', ') || 'None'} (FolderAI)`);

  // Get enhanced system prompt
  const baseSystemPrompt = await getSystemPrompt(trimmedContext);
  const enhancedSystemPrompt = buildEnhancedSystemPrompt(
    baseSystemPrompt,
    hasDocumentContext && !isExplicitWebRequest, // Don't treat as document context if explicit web request
    Boolean(webSearchData),
    urlContents.length > 0,
    isExplicitWebRequest // Pass explicit web request flag
  );

  // ✅ Call LLM - Web search results are already included in the prompt above
  // This works for ALL providers: Gemini, Claude, OpenAI, DeepSeek
  // The prompt contains web search results, so all models receive them regardless of provider
  console.log(`[askLLM] 📤 Sending request to ${provider} with ${webSearchData ? 'WEB SEARCH RESULTS' : 'NO web search'} (FolderAI)`);
  const response = await retryWithBackoff(() => 
    callSinglePrompt(provider, prompt, enhancedSystemPrompt, webSearchData !== null || urlContents.length > 0)
  );

  // Append citations if web search was performed
  if (citations.length > 0) {
    const citationsText = '\n\n---\n**📚 Web Sources Referenced:**\n' + citations.map(c => `[Source ${c.index}] [${c.title}](${c.link})`).join('\n');
    return response + citationsText;
  }

  return response;
}

// ---------------------------
// Core LLM Call Logic
// ✅ NOTE: Web search results are already included in the 'prompt' parameter
// This function handles ALL providers (Gemini, Claude, OpenAI, DeepSeek)
// All providers receive the same prompt which includes web search results when available
// ---------------------------
async function callSinglePrompt(provider, prompt, systemPrompt, hasWebSearch = false) {
  const config = ALL_LLM_CONFIGS[provider];
  const isClaude = provider.startsWith('claude') || provider === 'anthropic';
  const isGemini = provider.startsWith('gemini');

  console.log(`[SystemPrompt] 📝 Applying system instruction for ${provider} (FolderAI) (length: ${systemPrompt.length} chars)${hasWebSearch ? ' [WITH WEB/URL DATA]' : ''}`);
  if (hasWebSearch) {
    console.log(`[Web Search] ✅ ${provider} model will receive web search results in prompt (FolderAI)`);
  }

  // ---- Gemini ----
  if (isGemini) {
    const models = GEMINI_MODELS[provider] || GEMINI_MODELS['gemini'];
    for (const modelName of models) {
      try {
        const maxOutputTokens = await getModelMaxTokens(provider, modelName);
        console.log(`[FolderLLM Max Tokens] Gemini model ${modelName} using maxOutputTokens=${maxOutputTokens}`);
        
        const isGemini3Pro = modelName === 'gemini-3-pro-preview';
        
        if (isGemini3Pro) {
          console.log(`[SystemPrompt] 🎯 Gemini 3.0 Pro ${modelName} using new SDK with system instruction (FolderAI)`);
          
          try {
            const totalRequestSize = prompt.length + (systemPrompt?.length || 0);
            const maxSafeRequestSize = 3000000;
            
            let finalPrompt = prompt;
            let finalSystemPrompt = systemPrompt;
            
            if (totalRequestSize > maxSafeRequestSize) {
              console.warn(`[Gemini 3.0 Pro] ⚠️ Request size (${totalRequestSize} chars) exceeds safe limit (${maxSafeRequestSize} chars). Truncating...`);
              const maxPromptSize = Math.floor(maxSafeRequestSize * 0.9);
              const truncatedPrompt = prompt.substring(0, maxPromptSize);
              finalPrompt = truncatedPrompt + '\n\n[...content truncated due to size limits...]';
              console.log(`[Gemini 3.0 Pro] 📉 Truncated prompt from ${prompt.length} to ${finalPrompt.length} chars`);
            }
            
            const request = {
              model: modelName,
              contents: [
                {
                  role: 'user',
                  parts: [{ text: finalPrompt }]
                }
              ],
              systemInstruction: finalSystemPrompt ? {
                parts: [{ text: finalSystemPrompt }]
              } : undefined,
              generationConfig: {
                maxOutputTokens: maxOutputTokens,
                temperature: 0.7,
              }
            };

            console.log(`[Gemini 3.0 Pro] 🚀 Sending request with ${finalPrompt.length} chars prompt and ${(finalSystemPrompt?.length || 0)} chars system instruction`);
            
            const requestPromise = genAI3.models.generateContent(request);
            const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Request timeout: Gemini 3.0 Pro API request took too long')), 180000)
            );
            
            const response = await Promise.race([requestPromise, timeoutPromise]);
            
            let text = '';
            if (response.text) {
              text = response.text;
            } else if (response.candidates && response.candidates.length > 0) {
              const candidate = response.candidates[0];
              if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                text = candidate.content.parts.map(part => part.text || '').join('');
              }
            }
            
            if (!text) {
              console.error('[Gemini 3.0 Pro] ❌ No text in response:', JSON.stringify(response, null, 2));
              throw new Error('No text content in Gemini 3.0 Pro response');
            }
            
            const usage = response.usageMetadata || {};
            console.log(
              `✅ Gemini 3.0 Pro (${modelName}) - Tokens used: ${usage.promptTokenCount || 0} + ${usage.candidatesTokenCount || 0} = ${(usage.promptTokenCount || 0) + (usage.candidatesTokenCount || 0)} | max=${maxOutputTokens} (FolderAI)`
            );
            
            return text;
          } catch (gemini3Error) {
            const isNetworkError = gemini3Error.message?.includes('fetch failed') || 
                                  gemini3Error.message?.includes('network') ||
                                  gemini3Error.message?.includes('timeout') ||
                                  gemini3Error.message?.includes('ECONNREFUSED') ||
                                  gemini3Error.message?.includes('ETIMEDOUT');
            
            if (isNetworkError) {
              console.error(`[Gemini 3.0 Pro] ❌ Network/Request error: ${gemini3Error.message}`);
              console.log(`[Gemini 3.0 Pro] ⚠️ Attempting fallback to legacy Gemini models...`);
              throw new Error(`Gemini 3.0 Pro network error - will try legacy models: ${gemini3Error.message}`);
            } else {
              console.error(`[Gemini 3.0 Pro] ❌ Error details:`, {
                message: gemini3Error.message,
                stack: gemini3Error.stack,
                response: gemini3Error.response?.data
              });
              throw gemini3Error;
            }
          }
        } else {
          console.log(`[SystemPrompt] 🎯 Gemini ${modelName} using legacy SDK with systemInstruction from database (FolderAI)`);
          const model = genAI.getGenerativeModel(
            systemPrompt ? { model: modelName, systemInstruction: systemPrompt } : { model: modelName }
          );
          const result = await model.generateContent(prompt, {
            generationConfig: {
              maxOutputTokens,
            },
          });
          const geminiResponse = await result.response.text();
          const inputTokens = result.response.usageMetadata?.promptTokenCount || 0;
          const outputTokens = result.response.usageMetadata?.candidatesTokenCount || 0;
          console.log(`✅ Gemini (${modelName}) - Input: ${inputTokens}, Output: ${outputTokens}, Total: ${inputTokens + outputTokens} | max=${maxOutputTokens} (FolderAI)`);
          return geminiResponse;
        }
      } catch (err) {
        console.warn(`❌ Gemini model ${modelName} failed: ${err.message}`);
        
        const isGemini3ProFailure = modelName === 'gemini-3-pro-preview' && err.message?.includes('Gemini 3.0 Pro network error');
        const hasLegacyModels = models.length > 1 && models.some(m => m !== 'gemini-3-pro-preview');
        
        if (isGemini3ProFailure && hasLegacyModels) {
          console.log(`[Gemini 3.0 Pro] ⚠️ Falling back to legacy Gemini models due to network error...`);
          continue;
        }
        
        if (modelName === models[models.length - 1]) {
          throw err;
        }
        continue;
      }
    }
    throw new Error(`❌ All Gemini models failed.`);
  }

  // ---- Claude / OpenAI / DeepSeek ----
  const messages = isClaude
    ? [{ role: 'user', content: prompt }]
    : [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ];

  const resolvedModel = config.model;
  const maxTokens = await getModelMaxTokens(provider, resolvedModel);

  if (isClaude) {
    console.log(`[SystemPrompt] 🎯 Claude ${resolvedModel} using system field from database (FolderAI)`);
  } else {
    console.log(`[SystemPrompt] 🎯 ${provider} ${resolvedModel} using system role in messages from database (FolderAI)`);
  }

  const payload = isClaude
    ? {
        model: config.model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
      }
    : {
        model: config.model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.7,
      };
  console.log(`[FolderLLM Max Tokens] ${provider} model ${resolvedModel} using max_tokens=${maxTokens}`);

  const response = await axios.post(config.apiUrl, payload, {
    headers: config.headers,
    timeout: 120000,
  });

  let inputTokens = 0;
  let outputTokens = 0;

  if (isClaude) {
    inputTokens = response.data?.usage?.input_tokens || 0;
    outputTokens = response.data?.usage?.output_tokens || 0;
  } else {
    inputTokens = response.data?.usage?.prompt_tokens || 0;
    outputTokens = response.data?.usage?.completion_tokens || 0;
  }

  console.log(`✅ ${provider} - Input: ${inputTokens}, Output: ${outputTokens}, Total: ${inputTokens + outputTokens} | max=${maxTokens} (FolderAI)`);

  return isClaude
    ? response.data?.content?.[0]?.text || response.data?.completion
    : response.data?.choices?.[0]?.message?.content || '';
}

// ---------------------------
// Streaming LLM Caller (SSE Support for Folder AI)
// Returns async generator that yields text chunks as strings
// ---------------------------
async function* streamLLM(providerName, userMessage, context = '', relevant_chunks = null, originalQuestion = null) {
  const provider = resolveProviderName(providerName);
  const config = ALL_LLM_CONFIGS[provider];
  if (!config) throw new Error(`❌ Unsupported LLM provider: ${provider}`);

  const safeContext = typeof context === 'string' ? context : '';
  let userQuestionForSearch = originalQuestion || userMessage;
  
  // Extract question for web search (same logic as askLLM)
  if (!originalQuestion && userMessage) {
    const userQuestionMatch = userMessage.match(/USER QUESTION:\s*(.+?)(?:\n\n===|$)/s);
    if (userQuestionMatch) {
      userQuestionForSearch = userQuestionMatch[1].trim();
    }
  }

  // Check for explicit web request
  const messageLower = userQuestionForSearch.toLowerCase();
  const explicitWebKeywords = [
    'search web', 'search online', 'from web', 'web se', 'web pe', 
    'don\'t want from document', 'not from document', 'ignore document'
  ];
  const isExplicitWebRequest = explicitWebKeywords.some(keyword => messageLower.includes(keyword));
  
  // Process context and chunks
  let trimmedContext, filteredChunks, trimmedFilteredChunks;
  if (isExplicitWebRequest) {
    trimmedContext = '';
    filteredChunks = '';
    trimmedFilteredChunks = '';
  } else {
    trimmedContext = trimContext(safeContext, 200);
    filteredChunks = filterRelevantChunks(relevant_chunks, userQuestionForSearch, 5);
    trimmedFilteredChunks = trimContext(filteredChunks, 700);
  }

  // Handle web search if needed
  let webSearchData = null;
  const needsWebSearch = isExplicitWebRequest || shouldTriggerWebSearch(userQuestionForSearch, trimmedContext, trimmedFilteredChunks);
  if (needsWebSearch) {
    webSearchData = await performWebSearch(userQuestionForSearch, 5);
  }

  // Build prompt (same logic as askLLM)
  let prompt = userMessage.trim();
  if (trimmedFilteredChunks && !isExplicitWebRequest) {
    prompt += `\n\n=== UPLOADED DOCUMENTS CONTEXT ===\n${trimmedFilteredChunks}`;
  }
  if (webSearchData && webSearchData.results) {
    prompt += `\n\n=== WEB SEARCH RESULTS ===\n${webSearchData.results}`;
  }

  // Get system prompt
  const baseSystemPrompt = await getSystemPrompt(trimmedContext);
  const enhancedSystemPrompt = buildEnhancedSystemPrompt(
    baseSystemPrompt,
    Boolean(trimmedContext || trimmedFilteredChunks) && !isExplicitWebRequest,
    Boolean(webSearchData),
    false,
    isExplicitWebRequest
  );

  const isGemini = provider.startsWith('gemini');
  const isClaude = provider.startsWith('claude') || provider === 'anthropic';

  console.log(`[Stream] 🚀 Starting stream for provider: ${provider}`);

  // Stream based on provider
  if (isGemini) {
    const models = GEMINI_MODELS[provider] || GEMINI_MODELS['gemini'];
    let lastError = null;
    
    for (const modelName of models) {
      try {
        const maxOutputTokens = await getModelMaxTokens(provider, modelName);
        const isGemini3Pro = modelName === 'gemini-3-pro-preview';
        
        console.log(`[Stream] Attempting Gemini model: ${modelName}`);
        
        if (isGemini3Pro) {
          // Gemini 3.0 Pro streaming (new SDK)
          const request = {
            model: modelName,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            systemInstruction: enhancedSystemPrompt ? { parts: [{ text: enhancedSystemPrompt }] } : undefined,
            generationConfig: { maxOutputTokens, temperature: 0.7 },
          };
          
          console.log(`[Gemini 3.0 Pro Stream] 🚀 Starting stream (prompt: ${prompt.length} chars)`);
          
          const response = await genAI3.models.generateContentStream(request);
          
          // Handle the stream - response should be directly iterable
          let chunkCount = 0;
          for await (const chunk of response) {
            chunkCount++;
            const text = chunk?.text || '';
            if (text) {
              yield text; // Yield text directly as string
            }
          }
          
          console.log(`[Gemini 3.0 Pro Stream] ✅ Stream completed (${chunkCount} chunks)`);
          return; // Successfully streamed
          
        } else {
          // Legacy Gemini streaming
          const model = genAI.getGenerativeModel(
            enhancedSystemPrompt ? { model: modelName, systemInstruction: enhancedSystemPrompt } : { model: modelName }
          );
          
          const result = await model.generateContentStream(prompt, {
            generationConfig: { maxOutputTokens },
          });
          
          let chunkCount = 0;
          for await (const chunk of result.stream) {
            chunkCount++;
            const text = chunk.text();
            if (text) {
              yield text; // Yield text directly as string
            }
          }
          
          console.log(`[Gemini Stream] ✅ Stream completed (${chunkCount} chunks)`);
          return; // Successfully streamed
        }
      } catch (err) {
        lastError = err;
        console.warn(`[Stream] ❌ Gemini model ${modelName} failed:`, err.message);
        
        // If this is the last model, throw the error
        if (modelName === models[models.length - 1]) {
          throw err;
        }
        // Otherwise continue to next model
        continue;
      }
    }
    
    // If we get here, all models failed
    throw lastError || new Error('❌ All Gemini models failed for streaming');
  }

  // Claude / OpenAI / DeepSeek streaming
  const messages = isClaude
    ? [{ role: 'user', content: prompt }]
    : [{ role: 'system', content: enhancedSystemPrompt }, { role: 'user', content: prompt }];

  const resolvedModel = config.model;
  const maxTokens = await getModelMaxTokens(provider, resolvedModel);

  const payload = isClaude
    ? { model: config.model, max_tokens: maxTokens, messages, system: enhancedSystemPrompt, stream: true }
    : { model: config.model, messages, max_tokens: maxTokens, temperature: 0.7, stream: true };

  console.log(`[Stream] 📤 Sending streaming request to ${provider}`);

  const response = await axios.post(config.apiUrl, payload, {
    headers: config.headers,
    responseType: 'stream',
    timeout: 120000,
  });

  // Stream chunks from response
  let buffer = '';
  let chunkCount = 0;
  
  for await (const chunk of response.data) {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line in buffer
    
    for (const line of lines) {
      if (!line.trim() || !line.startsWith('data: ')) continue;
      const data = line.replace(/^data: /, '').trim();
      if (data === '[DONE]') {
        console.log(`[Stream] ✅ ${provider} stream completed (${chunkCount} chunks)`);
        return;
      }
      
      try {
        const json = JSON.parse(data);
        const text = isClaude
          ? json.delta?.text || json.content_block?.text || ''
          : json.choices?.[0]?.delta?.content || '';
        
        if (text) {
          chunkCount++;
          yield text; // Yield text directly as string
        }
      } catch (e) {
        // Skip invalid JSON - might be partial data
        continue;
      }
    }
  }
  
  console.log(`[Stream] ✅ ${provider} stream completed (${chunkCount} chunks)`);
}

// ---------------------------
// Exports
// ---------------------------
module.exports = {
  askLLM,
  streamLLM,
  resolveProviderName,
  getAvailableProviders,
  getModelMaxTokens,
  ALL_LLM_CONFIGS,
};