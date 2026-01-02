require('dotenv').config();
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleGenAI } = require('@google/genai');
const pool = require('../config/db');
const SystemPrompt = require('../models/SystemPrompt');
const LLMUsageLogService = require('./llmUsageLogService');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const genAI3 = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

    const formattedResults = results
      .map((result, index) => {
        return `[Source ${index + 1}] ${result.title || 'No title'}\nURL: ${result.link || 'No URL'}\nSnippet: ${result.snippet || 'No snippet'}`;
      })
      .join('\n\n');

    console.log(`[Web Search] ✅ Found ${citations.length} results`);

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

    let content = response.data;
    
    if (typeof content === 'string') {
      content = content
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      if (content.length > 10000) {
        content = content.substring(0, 10000) + '...';
      }
    }

    console.log(`[URL Fetch] ✅ Successfully fetched ${content.length} chars from ${url}`);

    return {
      url: url,
      content: content,
      success: true
    };
  } catch (error) {
    console.error(`[URL Fetch] ❌ Error fetching ${url}:`, error.message);
    return {
      url: url,
      content: `Failed to fetch content from ${url}: ${error.message}`,
      success: false
    };
  }
}

function extractUrls(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(urlRegex);
  return matches || [];
}

function shouldTriggerWebSearch(userMessage, context = '', relevantChunks = '') {
  if (!userMessage) return false;

  const message = userMessage.toLowerCase();
  const contextLower = (context || '').toLowerCase();
  const chunksLower = (relevantChunks || '').toLowerCase();
  
  // PRIORITY 1: EXPLICIT WEB SEARCH REQUESTS (CHECK FIRST!)
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
  
  const hasExplicitTrigger = explicitWebSearchTriggers.some(trigger => message.includes(trigger));
  if (hasExplicitTrigger) {
    console.log('[Web Search] ✅ EXPLICIT web search request detected - triggering web search');
    return true;
  }
  
  const documentRejectionKeywords = [
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
  
  const hasDontWant = (message.includes("don't want") || message.includes("dont want") || message.includes("don't want") || message.includes("do not want")) && 
                      (message.includes("document") || message.includes("from document"));
  
  if (hasDocumentRejection || hasDontWant) {
    console.log('[Web Search] ✅ User explicitly rejected documents - ALWAYS triggering web search');
    return true;
  }
  
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
  
  const hasPersonalPronoun = personalPronouns.some(pronoun => {
    const regex = new RegExp(`\\b${pronoun}\\b`, 'i');
    return regex.test(userMessage);
  });
  
  const isPersonalDataQuestion = personalDataKeywords.some(keyword => message.includes(keyword));
  
  if (hasPersonalPronoun || isPersonalDataQuestion) {
    console.log('[Web Search] Personal data/profile question detected - skipping web search');
    return false;
  }
  
  const hasDocumentContext = (contextLower.length > 500) || (chunksLower.length > 500);
  
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
  
  const hasCurrentInfoTrigger = currentInfoTriggers.some(trigger => message.includes(trigger));
  
  if (hasCurrentInfoTrigger) {
    console.log('[Web Search] ✅ Current/real-time information request detected');
    return true;
  }
  
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
  
  if (isDocumentQuestion && hasDocumentContext) {
    console.log('[Web Search] Question is about documents and context is available - skipping web search');
    return false;
  }
  
  if (isGeneralKnowledgeQuestion && !hasDocumentContext) {
    console.log('[Web Search] ✅ General knowledge question without document context');
    return true;
  }
  
  if (hasDocumentContext) {
    console.log('[Web Search] Document context available - assuming answer is in documents');
    return false;
  }
  
  if (!hasDocumentContext && isGeneralKnowledgeQuestion) {
    console.log('[Web Search] ✅ No document context - triggering for general knowledge question');
    return true;
  }
  
  console.log('[Web Search] No web search triggers detected - using available context');
  return false;
}

function estimateTokenCount(text = '') {
  return Math.ceil(text.length / 4); // ~4 characters per token
}

function trimContext(context = '', maxTokens = 20000) {
  if (!context) return '';
  const tokens = estimateTokenCount(context);
  if (tokens <= maxTokens) return context;
  const ratio = maxTokens / tokens;
  const trimmedLength = Math.floor(context.length * ratio);
  return (
    context.substring(0, trimmedLength) +
    '\n\n[...context truncated due to model limits...]'
  );
}

function filterRelevantChunks(chunks, userMessage, maxChunks = 12) {
  if (!chunks) return '';
  
  let chunkString;
  if (Array.isArray(chunks)) {
    chunkString = chunks
      .map((c) => {
        if (typeof c === 'string') {
          return c;
        }
        const filename = c.filename || c.originalname || 'Document';
        const content = c.content || '';
        return `📄 [${filename}]\n${content}`;
      })
      .join('\n\n');
  } else if (typeof chunks === 'string') {
    chunkString = chunks;
  } else {
    return '';
  }
  
  const chunkArray = chunkString.split('\n\n').filter(Boolean);
  if (chunkArray.length <= maxChunks) return chunkString;

  const keywords = userMessage
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3)
    .slice(0, 10);

  const scored = chunkArray.map(chunk => {
    const text = chunk.toLowerCase();
    const score = keywords.reduce(
      (sum, kw) => sum + (text.includes(kw) ? 1 : 0),
      0
    );
    return { chunk, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChunks)
    .map(s => s.chunk)
    .join('\n\n');
}

// Retry with exponential backoff for rate limiting and overload errors
async function retryWithBackoff(fn, retries = 3, delay = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const errorMessage = err.message || '';
      const isRateLimitError = 
        errorMessage.includes('overloaded') ||
        errorMessage.includes('503') ||
        errorMessage.includes('429') ||
        errorMessage.includes('Too Many Requests') ||
        errorMessage.includes('temporarily unavailable') ||
        errorMessage.includes('quota') ||
        errorMessage.includes('rate limit') ||
        errorMessage.includes('exceeded') ||
        err.status === 429 ||
        err.status === 503;
        
      console.warn(`⚠️ [retryWithBackoff] Attempt ${attempt}/${retries} failed:`, errorMessage.substring(0, 200));
      
      if (isRateLimitError) {
        if (attempt < retries) {
          const backoffDelay = delay * attempt;
          console.log(`⏳ [retryWithBackoff] Rate limit detected, waiting ${backoffDelay}ms before retry...`);
          await new Promise(res => setTimeout(res, backoffDelay));
        } else {
          throw new Error('LLM provider is temporarily unavailable due to rate limiting. Please try again later.');
        }
      } else {
        throw err; // Re-throw non-rate-limit errors immediately
      }
    }
  }
}

const GEMINI_MODELS = {
  // Primary model with fallbacks for rate limiting (using valid model names)
  gemini: ['gemini-2.0-flash-exp', 'gemini-2.5-flash-preview-04-17', 'gemini-2.0-flash'],
  'gemini-pro-2.5': ['gemini-2.5-pro', 'gemini-2.5-pro-preview-05-06'],
  'gemini-3-pro': ['gemini-3-pro-preview'], // Uses new SDK
};

const LLM_CONFIGS = {
  'gpt-4o': {
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
  },
  openai: {
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
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
  anthropic: {
    apiUrl: 'https://api.anthropic.com/v1/messages',
    model: 'claude-3-5-haiku-20241022',
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
  gemini: { model: 'gemini-2.0-flash-exp' },
  'gemini-pro-2.5': { model: 'gemini-2.5-pro' },
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
    throw new Error('LLM configuration missing model name when resolving max tokens.');
  }

  const cacheKey = `${provider.toLowerCase()}::${modelName.toLowerCase()}`;
  if (llmTokenCache.has(cacheKey)) return llmTokenCache.get(cacheKey);

  const providerCandidates = [provider];
  const normalized = normalizeProviderForDb(provider);
  if (normalized && normalized !== provider) providerCandidates.push(normalized);
  providerCandidates.push(null); // final fallback: model-name only

  for (const candidate of providerCandidates) {
    let value = null;
    try {
      value =
        candidate === null
          ? await queryMaxTokensByModel(modelName)
          : await queryMaxTokensByProvider(candidate, modelName);
    } catch (err) {
      console.error(`[LLM Max Tokens] Error querying max tokens for provider="${candidate}" model="${modelName}": ${err.message}`);
      continue;
    }

    if (value != null) {
      llmTokenCache.set(cacheKey, value);
      console.log(
        `[LLM Max Tokens] Using max_output_tokens=${value} for provider="${candidate || 'model-only'}" model="${modelName}"`
      );
      return value;
    }
  }

  const defaultMaxTokens = {
    'gemini-3-pro-preview': 8192,
    'gemini-2.5-pro': 8192,
    'gemini-2.5-flash': 8192,
    'gemini-2.0-flash-exp': 8192,
    'gemini-2.0-flash': 8192,
    'gemini-2.0-pro-exp': 8192,
    'gemini-1.5-flash': 8192,
    'gemini-1.5-pro': 8192,
  };

  const modelLower = modelName.toLowerCase();
  if (defaultMaxTokens[modelLower]) {
    const defaultValue = defaultMaxTokens[modelLower];
    llmTokenCache.set(cacheKey, defaultValue);
    console.log(
      `[LLM Max Tokens] Using default max_output_tokens=${defaultValue} for model="${modelName}" (not found in database)`
    );
    return defaultValue;
  }

  throw new Error(
    `Max token configuration not found for provider="${provider}", model="${modelName}". Please insert a row into llm_max_tokens.`
  );
}

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
  claude: 'anthropic',
  anthropic: 'anthropic',
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

function resolveProviderName(name = '') {
  const key = name.trim().toLowerCase();
  const resolved = PROVIDER_ALIASES[key] || 'gemini';
  console.log(`[resolveProviderName] "${name}" → "${resolved}"`);
  return resolved;
}

function getAvailableProviders() {
  return Object.fromEntries(
    Object.entries(LLM_CONFIGS).map(([provider, cfg]) => {
      let key;
      if (provider.startsWith('gemini'))
        key = process.env.GEMINI_API_KEY;
      else if (provider.includes('claude') || provider === 'anthropic')
        key = process.env.ANTHROPIC_API_KEY;
      else if (provider === 'deepseek')
        key = process.env.DEEPSEEK_API_KEY;
      else key = process.env.OPENAI_API_KEY;
      return [
        provider,
        {
          available: !!key,
          model: cfg.model,
          reason: key ? 'Available' : 'Missing API key',
        },
      ];
    })
  );
}

async function getSystemPrompt(baseContext = '') {
  try {
    const dbSystemPrompt = await SystemPrompt.getLatestSystemPrompt();
    
    if (dbSystemPrompt && baseContext) {
      const combinedPrompt = `${dbSystemPrompt}

${baseContext}`;
      console.log('[SystemPrompt] 🔄 Using database system prompt (PRIMARY) + adaptive context (ENHANCEMENT)');
      console.log(`[SystemPrompt] Database prompt length: ${dbSystemPrompt.length} chars | Adaptive context: ${baseContext.length} chars`);
      return combinedPrompt;
    }
    
    if (dbSystemPrompt && dbSystemPrompt.trim()) {
      console.log('[SystemPrompt] ✅ Using system prompt from database (STRICT COMPLIANCE MODE)');
      console.log(`[SystemPrompt] Database prompt length: ${dbSystemPrompt.length} chars`);
      console.log(`[SystemPrompt] Database prompt preview: ${dbSystemPrompt.substring(0, 200)}...`);
      return dbSystemPrompt.trim();
    }
    
    console.log('[SystemPrompt] ⚠️ No database prompt found, using fallback system instruction');
    if (baseContext && baseContext.trim()) {
      console.log(`[SystemPrompt] Using context as fallback (${baseContext.length} chars)`);
      return baseContext.trim();
    }
    console.log('[SystemPrompt] Using default fallback system instruction');
    return 'You are a helpful AI assistant.';
  } catch (err) {
    console.error('[SystemPrompt] ❌ Error getting system prompt, using fallback:', err.message);
    console.error('[SystemPrompt] Error stack:', err.stack);
    if (baseContext && baseContext.trim()) {
      return baseContext.trim();
    }
    return 'You are a helpful AI assistant.';
  }
}

function buildEnhancedSystemPrompt(baseSystemPrompt, hasDocuments, hasWebSearch, hasUrlContent, isExplicitWebRequest = false) {
  let sourceInfo = '';
  
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

async function askLLM(providerName, userMessage, context = '', relevant_chunks = '', originalQuestion = null, metadata = {}) {
  const provider = resolveProviderName(providerName);
  const config = LLM_CONFIGS[provider];
  if (!config) throw new Error(`❌ Unsupported LLM provider: ${provider}`);

  const safeContext = typeof context === 'string' ? context : '';

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
  
  let trimmedContext, filteredChunks, trimmedChunks;
  if (isExplicitWebRequest) {
    console.log('[Web Search] 🎯 Explicit web request detected - minimizing document context');
    trimmedContext = ''; // Don't include profile context for explicit web requests
    filteredChunks = ''; // Don't include document chunks for explicit web requests
    trimmedChunks = ''; // No document context
  } else {
    trimmedContext = trimContext(safeContext, 20000);
    filteredChunks = filterRelevantChunks(relevant_chunks, userQuestionForSearch, 12);
    trimmedChunks = trimContext(filteredChunks, 20000);
  }

  let webSearchData = null;
  let citations = [];
  let sourceInfo = [];
  let urlContents = [];
  
  const urls = extractUrls(userQuestionForSearch);
  
  if (!isExplicitWebRequest) {
    if (trimmedChunks) {
      sourceInfo.push('📄 Uploaded Documents');
    }
    if (trimmedContext) {
      sourceInfo.push('📋 User Profile/Context');
    }
  }
  
  if (urls.length > 0) {
    console.log(`[URL Fetch] 🔗 Found ${urls.length} URL(s) in message, fetching content...`);
    for (const url of urls) {
      const urlData = await fetchUrlContent(url);
      if (urlData.success) {
        urlContents.push(urlData);
        sourceInfo.push(`🔗 Website: ${url}`);
      }
    }
  }
  
  const needsWebSearch = isExplicitWebRequest || shouldTriggerWebSearch(userQuestionForSearch, trimmedContext, trimmedChunks);
  if (needsWebSearch) {
    console.log(`[Web Search] 🔍 ${isExplicitWebRequest ? 'EXPLICIT' : 'Auto'}-triggering web search for user question:`, userQuestionForSearch.substring(0, 100));
    console.log(`[Web Search] 📋 Provider: ${provider} - Web search will be available for this model`);
    webSearchData = await performWebSearch(userQuestionForSearch, 5);
    
    if (webSearchData && webSearchData.results) {
      citations = webSearchData.citations;
      sourceInfo.push('🌐 Web Search');
      console.log(`[Web Search] ✅ Found ${citations.length} search results with citations for provider ${provider}`);
      console.log(`[Web Search] ✅ Web search results will be included in prompt for ${provider} model`);
    } else {
      console.log(`[Web Search] ⚠️ No search results found for provider ${provider}`);
    }
  } else {
    console.log(`[Web Search] ⏭️ Web search not needed for provider ${provider}`);
  }

  let prompt = userMessage.trim();
  
  if (isExplicitWebRequest && (webSearchData || urlContents.length > 0)) {
    console.log('[Web Search] 🎯 EXPLICIT web search request - prioritizing web sources over documents');
    
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
    
    if (trimmedChunks) {
      prompt += `\n\n=== SECONDARY REFERENCE: UPLOADED DOCUMENTS (OPTIONAL) ===\n${trimmedChunks}`;
      prompt += `\n\n⚠️ NOTE: The user explicitly requested web/internet information. Use documents ONLY for additional context if needed, but PRIMARY source must be web search results.`;
    }
    
    prompt += `\n\n🎯 CRITICAL INSTRUCTIONS:
- The user EXPLICITLY requested information from the INTERNET/WEB
- You MUST prioritize and use WEB SEARCH RESULTS${urlContents.length > 0 ? ' or FETCHED WEBSITE CONTENT' : ''} as your PRIMARY source
- Use document context ONLY as secondary reference if absolutely necessary
- Start your answer with: "According to web search results..." or "Based on information from the internet..."
- Cite sources as [Source 1], [Source 2], etc.${urlContents.length > 0 ? ' or mention the URL explicitly' : ''}
- DO NOT rely primarily on documents when the user asked for web/internet information`;
    
  } else {
    if (trimmedChunks) {
      prompt += `\n\n=== UPLOADED DOCUMENTS CONTEXT ===\n${trimmedChunks}`;
    }
    
    if (urlContents.length > 0) {
      prompt += `\n\n=== FETCHED WEBSITE CONTENT ===`;
      urlContents.forEach(urlData => {
        prompt += `\n\n[Website: ${urlData.url}]\n${urlData.content}`;
      });
      prompt += `\n\n⚠️ IMPORTANT: When using information from fetched websites above, cite the URL and mention "According to ${urlContents[0].url}..."`;
    }
    
    if (webSearchData && webSearchData.results) {
      prompt += `\n\n=== WEB SEARCH RESULTS ===\n${webSearchData.results}\n\n⚠️ IMPORTANT: When using information from web sources above, cite them as [Source 1], [Source 2], etc.`;
    }
    
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

  const hasComprehensiveInstructions = prompt.includes('COMPREHENSIVE (Full Document)') || 
                                       prompt.includes('COMPLETE DOCUMENT CONTENT') ||
                                       prompt.includes('Now provide your comprehensive analysis:');

  if (hasComprehensiveInstructions) {
    const reinforcementInstructions = `

CRITICAL REMINDER - You MUST:
✓ Follow the structure specified above
✓ Extract ALL details mentioned (dates, names, amounts, etc.)
✓ Use exact quotes for legal names and technical terms
✓ Organize with clear headings and bullet points
✓ Include page references when available
✓ State "NOT MENTIONED IN DOCUMENT" if information is missing
✓ Be comprehensive - don't skip important details

Begin your analysis now:`;
    
    prompt += reinforcementInstructions;
    console.log('[askLLM] ✅ Added reinforcement instructions for comprehensive analysis');
  }

  const totalTokens = estimateTokenCount(prompt + trimmedContext);
  console.log(`[askLLM] Total tokens estimated: ${totalTokens} | Sources: ${sourceInfo.join(', ')}`);

  const baseSystemPrompt = await getSystemPrompt(trimmedContext);
  const enhancedSystemPrompt = buildEnhancedSystemPrompt(
    baseSystemPrompt,
    Boolean(trimmedContext || trimmedChunks) && !isExplicitWebRequest,
    Boolean(webSearchData),
    urlContents.length > 0,
    isExplicitWebRequest
  );

  console.log(`[askLLM] 📤 Sending request to ${provider} with ${webSearchData || urlContents.length > 0 ? 'WEB SEARCH/URL DATA' : 'NO web search'}`);
  const response = await retryWithBackoff(() =>
    callSinglePrompt(provider, prompt, enhancedSystemPrompt, webSearchData !== null || urlContents.length > 0, metadata)
  );

  if (citations.length > 0) {
    const citationsText = '\n\n---\n**📚 Web Sources Referenced:**\n' + 
      citations.map(c => `[Source ${c.index}] [${c.title}](${c.link})`).join('\n');
    return response + citationsText;
  }

  return response;
}

async function callSinglePrompt(provider, prompt, systemPrompt, hasWebSearch = false, metadata = {}) {
  const config = LLM_CONFIGS[provider];
  const isGemini = provider.startsWith('gemini');
  const isClaude = provider.startsWith('claude') || provider === 'anthropic';

  const hasValidSystemPrompt = systemPrompt && systemPrompt.trim().length > 0;
  if (!hasValidSystemPrompt) {
    console.error(`[SystemPrompt] ❌ CRITICAL: System prompt is missing or empty for ${provider}! Responses may not comply with expected behavior!`);
  } else {
    console.log(`[SystemPrompt] ✅ System prompt validated for ${provider} (length: ${systemPrompt.trim().length} chars)${hasWebSearch ? ' [WITH WEB/URL DATA IN PROMPT]' : ''}`);
    console.log(`[SystemPrompt] System prompt preview: ${systemPrompt.trim().substring(0, 200)}...`);
  }
  if (hasWebSearch) {
    console.log(`[Web Search] ✅ ${provider} model will receive web search/URL results in prompt`);
  }

  if (isGemini) {
    const models = GEMINI_MODELS[provider] || GEMINI_MODELS['gemini'];
    for (const modelName of models) {
      try {
        const maxOutputTokens = await getModelMaxTokens(provider, modelName);
        console.log(`[LLM Max Tokens] Gemini model ${modelName} using maxOutputTokens=${maxOutputTokens}`);
        
        const isGemini3Pro = modelName === 'gemini-3-pro-preview';
        
        if (isGemini3Pro) {
          console.log(`[SystemPrompt] 🎯 Gemini 3.0 Pro ${modelName} using new SDK`);
          
          try {
            const totalRequestSize = prompt.length + (systemPrompt?.length || 0);
            const maxSafeRequestSize = 3000000; // ~750K tokens (75% of 1M for safety)
            
            let finalPrompt = prompt;
            let finalSystemPrompt = systemPrompt;
            
            if (totalRequestSize > maxSafeRequestSize) {
              console.warn(`[Gemini 3.0 Pro] ⚠️ Request size (${totalRequestSize} chars) exceeds safe limit (${maxSafeRequestSize} chars). Truncating...`);
              const maxPromptSize = Math.floor(maxSafeRequestSize * 0.9);
              const truncatedPrompt = prompt.substring(0, maxPromptSize);
              finalPrompt = truncatedPrompt + '\n\n[...content truncated due to size limits...]';
              console.log(`[Gemini 3.0 Pro] 📉 Truncated prompt from ${prompt.length} to ${finalPrompt.length} chars`);
            }
            
            const requestPayload = {
              model: modelName,
              contents: [
                {
                  role: 'user',
                  parts: [{ text: finalPrompt }]
                }
              ],
              systemInstruction: hasValidSystemPrompt ? {
                parts: [{ text: finalSystemPrompt.trim() }]
              } : undefined,
              generationConfig: {
                maxOutputTokens,
                temperature: 0.7,
              }
            };
            
            console.log(`[Gemini 3.0 Pro] 🚀 Sending request with ${finalPrompt.length} chars prompt and ${(hasValidSystemPrompt ? finalSystemPrompt.trim().length : 0)} chars system instruction`);
            if (hasValidSystemPrompt) {
              console.log(`[callSinglePrompt] ✅ System prompt WILL be applied to Gemini 3.0 Pro ${modelName} (${finalSystemPrompt.trim().length} chars)`);
            } else {
              console.error(`[callSinglePrompt] ❌ System prompt NOT applied to Gemini 3.0 Pro ${modelName}`);
            }
            
            const requestPromise = genAI3.models.generateContent(requestPayload);
            const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Request timeout: Gemini 3.0 Pro API request took too long')), 180000)
            );
            
            const response = await Promise.race([requestPromise, timeoutPromise]);
            
            const text = response.text || 
                        response.candidates?.[0]?.content?.parts?.[0]?.text || 
                        response.response?.text() || '';
            
            if (!text) {
              throw new Error('No text returned from Gemini 3.0 Pro');
            }
            
            const usage = response.usageMetadata || {};
            let inputTokens = usage.promptTokenCount || usage.promptTokenCount || 0;
            let outputTokens = usage.candidatesTokenCount || 0;
            
            // Calculate tokens from text if API didn't return them
            if (inputTokens === 0 && finalPrompt) {
              inputTokens = estimateTokenCount(finalPrompt + (finalSystemPrompt || ''));
              console.log(`⚠️ [Gemini 3.0 Pro] API didn't return input tokens, calculated from text: ${inputTokens}`);
            }
            if (outputTokens === 0 && text) {
              outputTokens = estimateTokenCount(text);
              console.log(`⚠️ [Gemini 3.0 Pro] API didn't return output tokens, calculated from text: ${outputTokens}`);
            }
            
            console.log(
              `✅ Gemini 3.0 Pro (${modelName}) - Tokens used: ${inputTokens} + ${outputTokens} | max=${maxOutputTokens}`
            );
            
            // Log LLM usage to payment service
            console.log(`🔍 [DEBUG] Checking metadata for logging - userId: ${metadata?.userId}, modelName: ${modelName}, metadata:`, JSON.stringify(metadata));
            if (metadata && metadata.userId && modelName) {
              console.log(`🚀 [DEBUG] Calling LLMUsageLogService.logUsage for Gemini 3.0 Pro`);
              LLMUsageLogService.logUsage({
                userId: metadata.userId,
                modelName: modelName,
                inputTokens: inputTokens,
                outputTokens: outputTokens,
                endpoint: metadata.endpoint || '/api/doc/analyze',
                requestId: metadata.requestId,
                fileId: metadata.fileId,
                sessionId: metadata.sessionId
              }).catch(err => {
                console.error('⚠️ Failed to log LLM usage:', err.message);
              });
            }
            
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
          console.log(`[SystemPrompt] 🎯 Gemini ${modelName} using legacy SDK with systemInstruction`);
          const model = genAI.getGenerativeModel(
            hasValidSystemPrompt
              ? { model: modelName, systemInstruction: systemPrompt.trim() }
              : { model: modelName }
          );
          if (hasValidSystemPrompt) {
            console.log(`[callSinglePrompt] ✅ System prompt WILL be applied to Gemini ${modelName} (${systemPrompt.trim().length} chars)`);
          } else {
            console.error(`[callSinglePrompt] ❌ System prompt NOT applied to Gemini ${modelName}`);
          }
          const result = await model.generateContent(prompt, {
            generationConfig: {
              maxOutputTokens,
            },
          });
          const text = await result.response.text();
          const usage = result.response.usageMetadata || {};
          let inputTokens = usage.promptTokenCount || 0;
          let outputTokens = usage.candidatesTokenCount || 0;
          
          // Calculate tokens from text if API didn't return them
          if (inputTokens === 0 && prompt) {
            inputTokens = estimateTokenCount(prompt + (systemPrompt || ''));
            console.log(`⚠️ [Gemini Legacy] API didn't return input tokens, calculated from text: ${inputTokens}`);
          }
          if (outputTokens === 0 && text) {
            outputTokens = estimateTokenCount(text);
            console.log(`⚠️ [Gemini Legacy] API didn't return output tokens, calculated from text: ${outputTokens}`);
          }
          
          console.log(
            `✅ Gemini (${modelName}) - Tokens used: ${inputTokens} + ${outputTokens} | max=${maxOutputTokens}`
          );
          
          // Log LLM usage to payment service
          console.log(`🔍 [DEBUG] Checking metadata for logging - userId: ${metadata?.userId}, modelName: ${modelName}, metadata:`, JSON.stringify(metadata));
          if (metadata && metadata.userId && modelName) {
            console.log(`🚀 [DEBUG] Calling LLMUsageLogService.logUsage for Gemini legacy`);
            LLMUsageLogService.logUsage({
              userId: metadata.userId,
              modelName: modelName,
              inputTokens: inputTokens,
              outputTokens: outputTokens,
              endpoint: metadata.endpoint || '/api/doc/analyze',
              requestId: metadata.requestId,
              fileId: metadata.fileId,
              sessionId: metadata.sessionId
            }).catch(err => {
              console.error('⚠️ Failed to log LLM usage:', err.message);
            });
          }
          
          return text;
        }
      } catch (err) {
        const errorMessage = err.message || '';
        const isRateLimitError = 
          errorMessage.includes('429') ||
          errorMessage.includes('Too Many Requests') ||
          errorMessage.includes('quota') ||
          errorMessage.includes('rate limit') ||
          errorMessage.includes('exceeded') ||
          err.status === 429;
          
        const isNotFoundError = 
          errorMessage.includes('404') ||
          errorMessage.includes('Not Found') ||
          errorMessage.includes('is not found') ||
          errorMessage.includes('not supported') ||
          err.status === 404;
          
        console.warn(`⚠️ Gemini model ${modelName} failed: ${errorMessage.substring(0, 200)}`);
        console.error('[Gemini Error Details]', err.response?.data || err);
        
        // If model not found, immediately try next fallback (no delay)
        if (isNotFoundError && modelName !== models[models.length - 1]) {
          console.log(`🔄 [callSinglePrompt] Model ${modelName} not found, trying next fallback...`);
          continue;
        }
        
        // If rate limited, wait and try fallback
        if (isRateLimitError && modelName !== models[models.length - 1]) {
          console.log(`🔄 [callSinglePrompt] Rate limit on ${modelName}, waiting before trying fallback model...`);
          await new Promise(res => setTimeout(res, 2000));
          continue;
        }
        
        if (modelName === models[models.length - 1]) {
          throw err;
        }
      }
    }
    return '⚠️ Gemini could not process this input.';
  }

  const messages = isClaude
    ? [{ role: 'user', content: prompt }]
    : [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ];

  const resolvedModelName = config.model;
  const maxTokens = await getModelMaxTokens(provider, resolvedModelName);

  if (isClaude) {
    console.log(`[SystemPrompt] 🎯 Claude ${resolvedModelName} using system field`);
  } else {
    console.log(`[SystemPrompt] 🎯 ${provider} ${resolvedModelName} using system role in messages`);
  }

  const payload = isClaude
    ? {
        model: config.model,
        max_tokens: maxTokens,
        messages,
        system: systemPrompt,
      }
    : {
        model: config.model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.7,
      };
  console.log(`[LLM Max Tokens] ${provider} model ${resolvedModelName} using max_tokens=${maxTokens}`);

  const response = await axios.post(config.apiUrl, payload, {
    headers: config.headers,
    timeout: 240000,
  });

  const usage = response.data?.usage || {};
  let inputTokens = usage.prompt_tokens || usage.input_tokens || 0;
  let outputTokens = usage.completion_tokens || usage.output_tokens || 0;
  
  // Get response text for token calculation if needed
  const responseText = response.data?.choices?.[0]?.message?.content ||
    response.data?.content?.[0]?.text ||
    '';
  
  // Calculate tokens from text if API didn't return them
  if (inputTokens === 0 && prompt) {
    inputTokens = estimateTokenCount(prompt + (systemPrompt || ''));
    console.log(`⚠️ [${provider}] API didn't return input tokens, calculated from text: ${inputTokens}`);
  }
  if (outputTokens === 0 && responseText) {
    outputTokens = estimateTokenCount(responseText);
    console.log(`⚠️ [${provider}] API didn't return output tokens, calculated from text: ${outputTokens}`);
  }
  
  console.log(
    `✅ ${provider} - Tokens: ${inputTokens} + ${outputTokens}`
  );

  // Log LLM usage to payment service for Claude/OpenAI
  console.log(`🔍 [DEBUG] Checking metadata for logging - userId: ${metadata?.userId}, modelName: ${resolvedModelName}, metadata:`, JSON.stringify(metadata));
  if (metadata && metadata.userId && resolvedModelName) {
    console.log(`🚀 [DEBUG] Calling LLMUsageLogService.logUsage for Claude/OpenAI`);
    LLMUsageLogService.logUsage({
      userId: metadata.userId,
      modelName: resolvedModelName,
      inputTokens: inputTokens,
      outputTokens: outputTokens,
      endpoint: metadata.endpoint || '/api/doc/analyze',
      requestId: metadata.requestId,
      fileId: metadata.fileId,
      sessionId: metadata.sessionId
    }).catch(err => {
      console.error('⚠️ Failed to log LLM usage:', err.message);
    });
  }

  return responseText || '⚠️ AI returned no text.';
}

async function* streamLLM(providerName, userMessage, context = '', relevant_chunks = '', originalQuestion = null, metadata = {}) {
  const provider = resolveProviderName(providerName);
  const config = LLM_CONFIGS[provider];
  if (!config) throw new Error(`❌ Unsupported LLM provider: ${provider}`);

  const safeContext = typeof context === 'string' ? context : '';
  let userQuestionForSearch = originalQuestion || userMessage;
  
  if (!originalQuestion && userMessage) {
    const userQuestionMatch = userMessage.match(/USER QUESTION:\s*(.+?)(?:\n\n===|$)/s);
    if (userQuestionMatch) {
      userQuestionForSearch = userQuestionMatch[1].trim();
    }
  }

  const messageLower = userQuestionForSearch.toLowerCase();
  const explicitWebKeywords = [
    'search web', 'search online', 'from web', 'web se', 'web pe', 
    'don\'t want from document', 'not from document', 'ignore document'
  ];
  const isExplicitWebRequest = explicitWebKeywords.some(keyword => messageLower.includes(keyword));
  
  let trimmedContext, filteredChunks, trimmedChunks;
  if (isExplicitWebRequest) {
    trimmedContext = '';
    filteredChunks = '';
    trimmedChunks = '';
  } else {
    trimmedContext = trimContext(safeContext, 20000);
    filteredChunks = filterRelevantChunks(relevant_chunks, userQuestionForSearch, 12);
    trimmedChunks = trimContext(filteredChunks, 20000);
  }

  let webSearchData = null;
  let urlContents = [];
  const urls = extractUrls(userQuestionForSearch);
  
  if (urls.length > 0) {
    for (const url of urls) {
      const urlData = await fetchUrlContent(url);
      if (urlData.success) {
        urlContents.push(urlData);
      }
    }
  }
  
  const needsWebSearch = isExplicitWebRequest || shouldTriggerWebSearch(userQuestionForSearch, trimmedContext, trimmedChunks);
  if (needsWebSearch) {
    webSearchData = await performWebSearch(userQuestionForSearch, 5);
  }

  let prompt = userMessage.trim();
  if (trimmedChunks && !isExplicitWebRequest) {
    prompt += `\n\n=== UPLOADED DOCUMENTS CONTEXT ===\n${trimmedChunks}`;
  }
  if (urlContents.length > 0) {
    prompt += `\n\n=== FETCHED WEBSITE CONTENT ===`;
    urlContents.forEach(urlData => {
      prompt += `\n\n[Website: ${urlData.url}]\n${urlData.content}`;
    });
  }
  if (webSearchData && webSearchData.results) {
    prompt += `\n\n=== WEB SEARCH RESULTS ===\n${webSearchData.results}`;
  }

  const baseSystemPrompt = await getSystemPrompt(trimmedContext);
  const enhancedSystemPrompt = buildEnhancedSystemPrompt(
    baseSystemPrompt,
    Boolean(trimmedContext || trimmedChunks) && !isExplicitWebRequest,
    Boolean(webSearchData),
    urlContents.length > 0,
    isExplicitWebRequest
  );

  const isGemini = provider.startsWith('gemini');
  const isClaude = provider.startsWith('claude') || provider === 'anthropic';

  if (isGemini) {
    const models = GEMINI_MODELS[provider] || GEMINI_MODELS['gemini'];
    let lastError = null;
    
    for (const modelName of models) {
      try {
        const maxOutputTokens = await getModelMaxTokens(provider, modelName);
        const isGemini3Pro = modelName === 'gemini-3-pro-preview';
        
        console.log(`[streamLLM] Trying Gemini model: ${modelName}`);
        
        if (isGemini3Pro) {
          const hasValidSystemPrompt = enhancedSystemPrompt && enhancedSystemPrompt.trim().length > 0;
          const request = {
            model: modelName,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            systemInstruction: hasValidSystemPrompt ? { parts: [{ text: enhancedSystemPrompt.trim() }] } : undefined,
            generationConfig: { maxOutputTokens, temperature: 0.7 },
          };
          
          const response = await genAI3.models.generateContentStream(request);
          
          let stream = null;
          if (response && typeof response[Symbol.asyncIterator] === 'function') {
            stream = response;
          } else if (response && response.stream && typeof response.stream[Symbol.asyncIterator] === 'function') {
            stream = response.stream;
          } else {
            throw new Error('Invalid streaming response from Gemini 3.0 Pro API');
          }
          
          for await (const chunk of stream) {
            const text = chunk?.text || (typeof chunk?.text === 'function' ? chunk.text() : '') || '';
            if (text) yield text;
          }
          return;
        } else {
          const hasValidSystemPrompt = enhancedSystemPrompt && enhancedSystemPrompt.trim().length > 0;
          const modelConfig = hasValidSystemPrompt 
            ? { model: modelName, systemInstruction: enhancedSystemPrompt.trim() } 
            : { model: modelName };
          const model = genAI.getGenerativeModel(modelConfig);
          const result = await model.generateContentStream(prompt, {
            generationConfig: { maxOutputTokens },
          });
          
          for await (const chunk of result.stream) {
            const text = chunk.text();
            if (text) yield text;
          }
          return;
        }
      } catch (err) {
        lastError = err;
        const errorMessage = err.message || '';
        const isRateLimitError = 
          errorMessage.includes('429') ||
          errorMessage.includes('Too Many Requests') ||
          errorMessage.includes('quota') ||
          errorMessage.includes('rate limit') ||
          errorMessage.includes('exceeded') ||
          err.status === 429;
        
        const isNotFoundError = 
          errorMessage.includes('404') ||
          errorMessage.includes('Not Found') ||
          errorMessage.includes('is not found') ||
          errorMessage.includes('not supported') ||
          err.status === 404;
        
        console.warn(`⚠️ [streamLLM] Gemini model ${modelName} failed:`, errorMessage.substring(0, 200));
        
        // If model not found, immediately try next fallback (no delay)
        if (isNotFoundError && modelName !== models[models.length - 1]) {
          console.log(`🔄 [streamLLM] Model ${modelName} not found, trying next fallback...`);
          continue;
        }
        
        // If rate limited, wait longer and try fallback
        if (isRateLimitError && modelName !== models[models.length - 1]) {
          console.log(`🔄 [streamLLM] Rate limit on ${modelName}, waiting before trying fallback model...`);
          // Wait 2 seconds before trying the next model
          await new Promise(res => setTimeout(res, 2000));
          continue;
        }
        
        // If this is the last model, throw the error
        if (modelName === models[models.length - 1]) {
          throw err;
        }
        continue;
      }
    }
    
    // If we get here, all models failed
    if (lastError) throw lastError;
  }

  const hasValidSystemPrompt = enhancedSystemPrompt && enhancedSystemPrompt.trim().length > 0;
  const messages = isClaude
    ? [{ role: 'user', content: prompt }]
    : hasValidSystemPrompt 
      ? [{ role: 'system', content: enhancedSystemPrompt.trim() }, { role: 'user', content: prompt }]
      : [{ role: 'user', content: prompt }];

  const resolvedModelName = config.model;
  const maxTokens = await getModelMaxTokens(provider, resolvedModelName);
  
  const payload = isClaude
    ? { 
        model: config.model, 
        max_tokens: maxTokens, 
        messages, 
        system: hasValidSystemPrompt ? enhancedSystemPrompt.trim() : undefined, 
        stream: true 
      }
    : { 
        model: config.model, 
        messages, 
        max_tokens: maxTokens, 
        temperature: 0.7, 
        stream: true 
      };

  console.log(`[Claude Stream] Starting stream with max_tokens=${maxTokens}, timeout=240s`);
  
  const response = await axios.post(config.apiUrl, payload, {
    headers: config.headers,
    responseType: 'stream',
    timeout: 240000,
  });

  let buffer = '';
  let lastChunkTime = Date.now();
  const CHUNK_TIMEOUT = 30000; // 30 seconds timeout between chunks
  let hasReceivedData = false;
  
  try {
    for await (const chunk of response.data) {
      const now = Date.now();
      const timeSinceLastChunk = now - lastChunkTime;
      
      // If we've received data before and it's been too long, break
      if (hasReceivedData && timeSinceLastChunk > CHUNK_TIMEOUT) {
        console.warn(`[Claude Stream] Timeout: No data received for ${timeSinceLastChunk}ms, ending stream`);
        break;
      }
      
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        // Handle Claude SSE format: "data: {...}" or "event: ..."
        if (line.startsWith('data: ')) {
          const data = line.replace(/^data: /, '').trim();
          if (data === '[DONE]') {
            console.log('[Claude Stream] Received [DONE] signal');
            return;
          }
          
          try {
            const json = JSON.parse(data);
            
            // Claude streaming format: content_block_delta or delta
            let text = '';
            if (json.type === 'content_block_delta' && json.delta?.text) {
              text = json.delta.text;
            } else if (json.type === 'content_block_delta' && json.content_block_delta?.text) {
              text = json.content_block_delta.text;
            } else if (json.delta?.text) {
              text = json.delta.text;
            } else if (json.content_block_delta?.text) {
              text = json.content_block_delta.text;
            } else if (!isClaude && json.choices?.[0]?.delta?.content) {
              text = json.choices[0].delta.content;
            }
            
            if (text) {
              hasReceivedData = true;
              lastChunkTime = now;
              yield text;
            }
          } catch (e) {
            // Skip invalid JSON lines (might be event: ping or other non-data lines)
            if (!line.startsWith('event:')) {
              console.warn(`[Claude Stream] Failed to parse line: ${line.substring(0, 100)}`);
            }
          }
        } else if (line.startsWith('event: ')) {
          // Handle SSE events (e.g., "event: ping")
          const eventType = line.replace(/^event: /, '').trim();
          if (eventType === 'ping') {
            lastChunkTime = now; // Reset timeout on ping
          }
        }
      }
    }
    
    // Process any remaining buffer
    if (buffer.trim()) {
      const lines = buffer.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.replace(/^data: /, '').trim();
          if (data === '[DONE]') return;
          try {
            const json = JSON.parse(data);
            const text = isClaude
              ? json.delta?.text || json.content_block_delta?.text || ''
              : json.choices?.[0]?.delta?.content || '';
            if (text) yield text;
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }
  } catch (error) {
    console.error(`[Claude Stream] Error during streaming:`, error.message);
    if (error.code === 'ECONNABORTED') {
      throw new Error('Request timeout: Claude API took too long to respond');
    }
    throw error;
  }
}

async function getSummaryFromChunks(chunks) {
  if (!chunks || chunks.length === 0) {
    return null;
  }
  const combinedText = chunks.join('\n\n');
  const prompt = `Provide a concise summary of the following text:\n\n${combinedText}`;
  
  const summary = await askLLM('gemini', prompt);
  return summary;
}

module.exports = {
  askLLM,
  streamLLM,
  resolveProviderName,
  getAvailableProviders,
  getSummaryFromChunks,
  performWebSearch,
  fetchUrlContent,
  extractUrls,
  shouldTriggerWebSearch,
};
