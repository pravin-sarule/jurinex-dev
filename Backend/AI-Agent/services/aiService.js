// require('dotenv').config();
// const { GoogleGenerativeAI } = require('@google/generative-ai');
// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// const PROVIDER_ALIASES = {
//   gemini: 'gemini',
//   'gemini-pro-2.5': 'gemini-pro-2.5',
//   'gemini-3-pro': 'gemini-3-pro',
// };

// function resolveProviderName(name = '') {
//   const key = name.trim().toLowerCase();
//   return PROVIDER_ALIASES[key] || 'gemini';
// }

// const GEMINI_MODELS = {
//   gemini: ['gemini-2.0-flash-exp', 'gemini-2.5-flash-preview-04-17'],
//   'gemini-pro-2.5': ['gemini-2.5-pro', 'gemini-2.5-pro-preview-05-06'],
//   'gemini-3-pro': ['gemini-3-pro-preview'],
// };

// function estimateTokenCount(text = '') {
//   return Math.ceil(text.length / 4);
// }

// function trimContext(context = '', maxTokens = 20000) {
//   if (!context) return '';
//   const tokens = estimateTokenCount(context);
//   if (tokens <= maxTokens) return context;
//   const ratio = maxTokens / tokens;
//   const trimmedLength = Math.floor(context.length * ratio);
//   return (
//     context.substring(0, trimmedLength) +
//     '\n\n[...context truncated due to model limits...]'
//   );
// }

// /**
//  * Clean response text by removing chunk references and markdown symbols
//  * @param {string} text - Raw response text
//  * @returns {string} Cleaned response text
//  */
// function cleanResponse(text) {
//   if (!text) return text;
  
//   let cleaned = text;
  
//   // Remove chunk references like "(Chunks 1, 5, 6)", "(Chunk 1)", etc.
//   cleaned = cleaned.replace(/\(Chunks?\s+\d+(?:\s*,\s*\d+)*\)/gi, '');
//   cleaned = cleaned.replace(/Chunks?\s+\d+(?:\s*,\s*\d+)*/gi, '');
//   cleaned = cleaned.replace(/\[Chunks?\s+\d+(?:\s*,\s*\d+)*\]/gi, '');
  
//   // PRESERVE markdown formatting: headings (#, ##, ###), bold (**text**), bullet points (-, *, •)
//   // Only remove markdown links [text](url) - keep the text
//   cleaned = cleaned.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
  
//   // Remove markdown code blocks (but preserve inline code if needed)
//   cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
//   // Keep inline code but remove backticks for cleaner display
//   cleaned = cleaned.replace(/`([^`]+)`/g, '$1');
  
//   // Normalize bullet points - ensure consistent formatting
//   // Convert various bullet styles to markdown bullet (-) at line start
//   cleaned = cleaned.replace(/^[\s]*[•▪▫]\s+/gm, '- ');
//   // Ensure markdown-style bullets are consistent
//   cleaned = cleaned.replace(/^[\s]*\*\s+/gm, '- ');
  
//   // Remove extra whitespace and clean up (but preserve line breaks for structure)
//   cleaned = cleaned.replace(/\n{3,}/g, '\n\n'); // Max 2 newlines
//   cleaned = cleaned.replace(/[ \t]{2,}/g, ' '); // Multiple spaces/tabs to single space (but preserve newlines)
//   cleaned = cleaned.trim();
  
//   return cleaned;
// }

// async function getSystemPrompt(hasDocumentContext = false) {
//   const basePrompt = `You are a professional and knowledgeable AI assistant for JuriNex, an intelligent legal technology platform. Your role is to help users with legal questions and provide clear, concise guidance.

// CRITICAL RESPONSE FORMATTING RULES:
// - ALWAYS format responses with PROPER STRUCTURE using markdown headings, bullet points, and highlights
// - Use markdown headings (## Heading, ### Subheading) to organize information into clear sections
// - Use bullet points (- or •) or numbered lists (1., 2., 3.) for key points under each heading
// - Use **bold** text to highlight important terms, concepts, or key information
// - Keep responses CONCISE and SHORT - maximum 5-7 key points per section
// - NEVER write long paragraphs - break information into clear, digestible sections with headings
// - Use professional, clean tone - be direct and clear
// - NEVER mention chunk numbers, chunk references, technical details, or that you're searching documents
// - NEVER mention "document context", "searching documents", or similar technical terms
// - Each point should be brief (1-2 sentences maximum)
// - Use simple, easy-to-understand language

// RESPONSE STRUCTURE GUIDELINES:
// - Start with a brief introduction (1-2 sentences) if needed
// - Use ## for main section headings (e.g., ## Platform Purpose, ## Key Features)
// - Use ### for subsections if needed
// - Present main information as bullet points (-) under each heading
// - Use **bold** to highlight important terms or concepts within bullet points
// - Keep each section focused on one main topic
// - End with a brief conclusion if necessary (optional)
// - Maximum response length: 50-100 words - Keep responses VERY SHORT and concise

// EXAMPLE FORMAT:
// ## Platform Purpose
// - **JuriNex** is an intelligent legal technology platform
// - Provides **AI-powered document analysis** and legal research tools
// - Helps legal professionals streamline their workflow

// ## Key Features
// - Document analysis and processing
// - Legal research assistance
// - Case management tools

// Key guidelines:
// - Be professional, clear, and concise
// - Respond naturally to greetings briefly (1-2 points)
// - When document information is provided, use it naturally without revealing the source
// - If asked about JuriNex services, provide structured information with proper headings
// - Use simple language when possible, but maintain accuracy for legal matters
// - Make complex legal information accessible through clear, structured explanations
// - If you don't know something, admit it briefly rather than guessing

// Remember: Always format responses with PROPER HEADINGS, BULLET POINTS, and HIGHLIGHTS. Keep responses SHORT, CLEAN, and PROFESSIONAL. Users should understand your response easily at a glance.`;

//   if (hasDocumentContext) {
//     return basePrompt + `\n\nWhen document information is provided, use it to answer questions naturally in structured format with headings and bullet points without mentioning that you're referencing documents.`;
//   }
  
//   return basePrompt;
// }

// async function askLLM(providerName, userMessage, context = '', relevant_chunks = '', originalQuestion = null) {
//   const provider = resolveProviderName(providerName);
//   const models = GEMINI_MODELS[provider] || GEMINI_MODELS['gemini'];
  
//   const trimmedContext = trimContext(context, 20000);
//   const trimmedChunks = trimContext(relevant_chunks, 20000);

//   let prompt = userMessage.trim();
//   const hasDocumentContext = !!trimmedChunks;
  
//   if (trimmedChunks) {
//     // Include document context naturally without technical labels
//     prompt += `\n\nRelevant Information:\n${trimmedChunks}`;
//   }

//   const systemPrompt = await getSystemPrompt(hasDocumentContext);

//   for (const modelName of models) {
//     try {
//       const model = genAI.getGenerativeModel({
//         model: modelName,
//         systemInstruction: systemPrompt
//       });

//       const result = await model.generateContent(prompt, {
//         generationConfig: {
//           maxOutputTokens: 8192,
//         },
//       });

//       let text = await result.response.text();
//       const usage = result.response.usageMetadata || {};
      
//       console.log(
//         `✅ ${provider} (${modelName}) - Tokens: ${usage.promptTokenCount || 0} + ${usage.candidatesTokenCount || 0}`
//       );
      
//       // Clean up the response: remove chunk references and markdown symbols
//       text = cleanResponse(text);
      
//       return text;
//     } catch (err) {
//       const errorMessage = err.message || '';
//       const isNotFoundError = 
//         errorMessage.includes('404') ||
//         errorMessage.includes('Not Found') ||
//         err.status === 404;
      
//       if (isNotFoundError && modelName !== models[models.length - 1]) {
//         console.log(`Model ${modelName} not found, trying next fallback...`);
//         continue;
//       }
      
//       if (modelName === models[models.length - 1]) {
//         throw err;
//       }
//     }
//   }
  
//   throw new Error('All models failed');
// }

// async function getSummaryFromChunks(chunks) {
//   if (!chunks || chunks.length === 0) return null;
//   const combinedText = Array.isArray(chunks) ? chunks.join('\n\n') : chunks;
//   const prompt = `Provide a concise summary of the following text:\n\n${combinedText}`;
//   const summary = await askLLM('gemini', prompt);
//   return summary;
// }

// module.exports = {
//   askLLM,
//   resolveProviderName,
//   getSummaryFromChunks,
// };



// require('dotenv').config();
// const { GoogleGenerativeAI } = require('@google/generative-ai');
// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// const PROVIDER_ALIASES = {
//   gemini: 'gemini',
//   'gemini-pro-2.5': 'gemini-pro-2.5',
//   'gemini-3-pro': 'gemini-3-pro',
// };

// function resolveProviderName(name = '') {
//   const key = name.trim().toLowerCase();
//   return PROVIDER_ALIASES[key] || 'gemini';
// }

// const GEMINI_MODELS = {
//   gemini: ['gemini-2.0-flash-exp', 'gemini-2.5-flash-preview-04-17'],
//   'gemini-pro-2.5': ['gemini-2.5-pro', 'gemini-2.5-pro-preview-05-06'],
//   'gemini-3-pro': ['gemini-3-pro-preview'],
// };

// function estimateTokenCount(text = '') {
//   return Math.ceil(text.length / 4);
// }

// function trimContext(context = '', maxTokens = 20000) {
//   if (!context) return '';
//   const tokens = estimateTokenCount(context);
//   if (tokens <= maxTokens) return context;
//   const ratio = maxTokens / tokens;
//   const trimmedLength = Math.floor(context.length * ratio);
//   return (
//     context.substring(0, trimmedLength) +
//     '\n\n[...context truncated due to model limits...]'
//   );
// }

// /**
//  * Clean and format response text for professional output
//  * @param {string} text - Raw response text
//  * @returns {string} Cleaned and formatted response text
//  */
// function cleanResponse(text) {
//   if (!text) return text;
  
//   let cleaned = text;
  
//   // Remove chunk references like "(Chunks 1, 5, 6)", "(Chunk 1)", etc.
//   cleaned = cleaned.replace(/\(Chunks?\s+\d+(?:\s*,\s*\d+)*\)/gi, '');
//   cleaned = cleaned.replace(/Chunks?\s+\d+(?:\s*,\s*\d+)*/gi, '');
//   cleaned = cleaned.replace(/\[Chunks?\s+\d+(?:\s*,\s*\d+)*\]/gi, '');
  
//   // Remove any mentions of "document context", "searching", etc.
//   cleaned = cleaned.replace(/\b(based on|according to|from|in) (the\s+)?(document|context|provided information|search results?)\b/gi, '');
  
//   // Clean up markdown links - keep text, remove URL
//   cleaned = cleaned.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
  
//   // Remove code blocks (but keep inline code)
//   cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
  
//   // Normalize whitespace
//   cleaned = cleaned.replace(/\n{3,}/g, '\n\n'); // Max 2 newlines
//   cleaned = cleaned.replace(/[ \t]{2,}/g, ' '); // Multiple spaces to single space
//   cleaned = cleaned.trim();
  
//   return cleaned;
// }

// async function getSystemPrompt(hasDocumentContext = false, isGeneralQuestion = false) {
//   // For general/normal chat questions, use ultra-short prompt
//   if (isGeneralQuestion) {
//     return `You are a chatbot AI assistant for JuriNex. CRITICAL RULES:
// - Respond in EXACTLY 1-2 SHORT sentences maximum (10-20 words total)
// - Be brief, friendly, and conversational like a typical chatbot
// - NO headings, NO bullet points, NO formatting, NO lists
// - Just a simple, direct, short message
// - Examples: "Hello! How can I help you today?" or "Hi! I'm here to assist with legal questions about JuriNex."
// - Keep it extremely short - like a quick chat message`;
//   }
  
//   const basePrompt = `You are a professional AI assistant for **JuriNex**, an intelligent legal technology platform. Your role is to provide clear, accurate, and well-structured information about legal concepts and JuriNex services.

// ## CRITICAL FORMATTING REQUIREMENTS

// **Response Structure:**
// 1. Always use proper markdown formatting with headings, bullet points, and numbered lists
// 2. Start responses with a brief 1-2 sentence introduction (if appropriate)
// 3. Use ## for main section headings (e.g., ## Overview, ## Key Features)
// 4. Use ### for subsections when needed
// 5. Use **bold text** to emphasize important terms, concepts, or key points
// 6. Use numbered lists (1., 2., 3.) for sequential steps or prioritized information
// 7. Use bullet points (-) for feature lists or non-sequential information
// 8. Keep each point concise: 1-2 sentences maximum

// **Tone & Style:**
// - Professional yet approachable
// - Clear and easy to understand
// - Avoid jargon unless necessary (explain technical terms simply)
// - Direct and to-the-point
// - Never mention technical details like "chunks", "documents", "context", or "searching"

// **Response Length:**
// - For NORMAL CHAT QUESTIONS (greetings, casual questions, general inquiries): Respond in ONLY 1-2 LINES maximum. Be extremely brief and conversational.
// - For LEGAL/DOCUMENT queries: Keep responses SHORT: 50-100 words maximum
// - Break information into digestible sections with clear headings only when needed
// - Each bullet point or numbered item should be brief (1 sentence maximum)
// - Prioritize brevity and clarity over detail

// **Content Guidelines:**
// 1. Answer questions directly and confidently
// 2. If document information is provided, integrate it naturally without revealing the source
// 3. For greetings and normal chat: Respond in EXACTLY 1-2 lines only. Example: "Hello! I'm here to help with legal questions about JuriNex. What would you like to know?"
// 4. For general questions: Keep to 1-2 lines maximum. No headings, no bullet points, just a brief direct answer.
// 5. If you don't know something, admit it professionally in 1 line: "I don't have specific information about that."
// 6. Always maintain accuracy - don't guess or fabricate information

// ## EXAMPLE RESPONSE FORMAT

// When asked "What is JuriNex?":

// ## About JuriNex

// **JuriNex** is an intelligent legal technology platform designed to streamline legal workflows and enhance productivity for legal professionals.

// ### Core Purpose
// - Provides AI-powered document analysis and legal research tools
// - Helps law firms and legal departments manage cases efficiently
// - Reduces time spent on routine legal tasks

// ### Key Features
// 1. **Document Analysis** - Automated review and extraction of key information
// 2. **Legal Research** - Quick access to relevant case laws and statutes
// 3. **Case Management** - Organized workflow and deadline tracking

// ---

// Remember: Format every response professionally with proper headings, bullet points, and emphasis. Keep it concise, clear, and well-structured.`;

//   if (hasDocumentContext) {
//     return basePrompt + `\n\n**Note:** Use the provided information naturally in your response without mentioning that you're referencing documents or external sources. Integrate it seamlessly into your structured format.`;
//   }
  
//   return basePrompt;
// }

// async function askLLM(providerName, userMessage, context = '', relevant_chunks = '', originalQuestion = null, isGeneralQuestion = false) {
//   const provider = resolveProviderName(providerName);
//   const models = GEMINI_MODELS[provider] || GEMINI_MODELS['gemini'];
  
//   const trimmedContext = trimContext(context, 20000);
//   const trimmedChunks = trimContext(relevant_chunks, 20000);

//   let prompt = userMessage.trim();
//   const hasDocumentContext = !!trimmedChunks;
  
//   if (trimmedChunks) {
//     // Include document context without technical labels
//     prompt += `\n\nRelevant Information:\n${trimmedChunks}`;
//   }

//   const systemPrompt = await getSystemPrompt(hasDocumentContext, isGeneralQuestion);

//   for (const modelName of models) {
//     try {
//       const model = genAI.getGenerativeModel({
//         model: modelName,
//         systemInstruction: systemPrompt
//       });

//       const result = await model.generateContent(prompt, {
//         generationConfig: {
//           maxOutputTokens: isGeneralQuestion ? 20 : 50, // Extremely short for general questions (20 tokens = ~15 words), slightly longer for document queries
//           temperature: 0.7,
//           topP: 0.8,
//           topK: 40,
//         },
//       });

//       let text = await result.response.text();
//       const usage = result.response.usageMetadata || {};
      
//       console.log(
//         `✅ ${provider} (${modelName}) - Tokens: ${usage.promptTokenCount || 0} + ${usage.candidatesTokenCount || 0}`
//       );
      
//       // Clean and format the response
//       text = cleanResponse(text);
      
//       // For general questions, enforce strict length limit (max 20 words)
//       if (isGeneralQuestion) {
//         const words = text.split(/\s+/);
//         if (words.length > 20) {
//           text = words.slice(0, 20).join(' ') + '.';
//         }
//         // Remove any markdown formatting that might have slipped through
//         text = text.replace(/^#{1,6}\s+/gm, ''); // Remove headings
//         text = text.replace(/^[-*•]\s+/gm, ''); // Remove bullet points
//         text = text.replace(/\*\*([^*]+)\*\*/g, '$1'); // Remove bold
//         text = text.trim();
//       }
      
//       return text;
//     } catch (err) {
//       const errorMessage = err.message || '';
//       const isNotFoundError = 
//         errorMessage.includes('404') ||
//         errorMessage.includes('Not Found') ||
//         err.status === 404;
      
//       if (isNotFoundError && modelName !== models[models.length - 1]) {
//         console.log(`Model ${modelName} not found, trying next fallback...`);
//         continue;
//       }
      
//       if (modelName === models[models.length - 1]) {
//         throw err;
//       }
//     }
//   }
  
//   throw new Error('All models failed');
// }

// async function getSummaryFromChunks(chunks) {
//   if (!chunks || chunks.length === 0) return null;
  
//   const combinedText = Array.isArray(chunks) ? chunks.join('\n\n') : chunks;
  
//   const prompt = `Provide a clear, concise summary of the following information in a professional format:

// ${combinedText}

// Use bullet points for key information and keep it brief (3-5 main points).`;

//   const summary = await askLLM('gemini', prompt);
//   return summary;
// }

// module.exports = {
//   askLLM,
//   resolveProviderName,
//   getSummaryFromChunks,
// };

// require('dotenv').config();
// const { GoogleGenerativeAI } = require('@google/generative-ai');
// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// const PROVIDER_ALIASES = {
//   gemini: 'gemini',
//   'gemini-pro-2.5': 'gemini-pro-2.5',
//   'gemini-3-pro': 'gemini-3-pro',
// };

// function resolveProviderName(name = '') {
//   const key = name.trim().toLowerCase();
//   return PROVIDER_ALIASES[key] || 'gemini';
// }

// const GEMINI_MODELS = {
//   gemini: ['gemini-2.0-flash-exp', 'gemini-2.5-flash-preview-04-17'],
//   'gemini-pro-2.5': ['gemini-2.5-pro', 'gemini-2.5-pro-preview-05-06'],
//   'gemini-3-pro': ['gemini-3-pro-preview'],
// };

// function estimateTokenCount(text = '') {
//   return Math.ceil(text.length / 4);
// }

// function trimContext(context = '', maxTokens = 20000) {
//   if (!context) return '';
//   const tokens = estimateTokenCount(context);
//   if (tokens <= maxTokens) return context;
//   const ratio = maxTokens / tokens;
//   const trimmedLength = Math.floor(context.length * ratio);
//   return (
//     context.substring(0, trimmedLength) +
//     '\n\n[...context truncated due to model limits...]'
//   );
// }

// /**
//  * Clean response text - keep it natural and concise
//  */
// function cleanResponse(text) {
//   if (!text) return text;
  
//   let cleaned = text;
  
//   // Remove chunk/document references
//   cleaned = cleaned.replace(/\(Chunks?\s+\d+(?:\s*,\s*\d+)*\)/gi, '');
//   cleaned = cleaned.replace(/Chunks?\s+\d+(?:\s*,\s*\d+)*/gi, '');
//   cleaned = cleaned.replace(/\[Chunks?\s+\d+(?:\s*,\s*\d+)*\]/gi, '');
//   cleaned = cleaned.replace(/\b(based on|according to|from|in) (the\s+)?(document|context|provided information|search results?)\b/gi, '');
  
//   // Clean markdown links
//   cleaned = cleaned.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
  
//   // Normalize whitespace
//   cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
//   cleaned = cleaned.replace(/[ \t]{2,}/g, ' ');
//   cleaned = cleaned.trim();
  
//   return cleaned;
// }

// async function getSystemPrompt(hasDocumentContext = false) {
//   return `You are JuriNex AI assistant. Respond naturally and briefly like a helpful chatbot.

// RULES:
// - Keep responses SHORT: 1-3 sentences (20-40 words max)
// - Be conversational and friendly
// - Answer directly without extra formatting
// - If you don't know, say "I don't have that information" in one line
// - No headings, no bullet points unless listing 2-3 items
// - Sound natural like ChatGPT or other AI assistants${hasDocumentContext ? '\n- Use provided information naturally without mentioning sources' : ''}`;
// }

// async function askLLM(providerName, userMessage, context = '', relevant_chunks = '', originalQuestion = null, isGeneralQuestion = false) {
//   const provider = resolveProviderName(providerName);
//   const models = GEMINI_MODELS[provider] || GEMINI_MODELS['gemini'];
  
//   const trimmedContext = trimContext(context, 20000);
//   const trimmedChunks = trimContext(relevant_chunks, 20000);

//   let prompt = userMessage.trim();
//   const hasDocumentContext = !!trimmedChunks;
  
//   if (trimmedChunks) {
//     prompt += `\n\nRelevant Information:\n${trimmedChunks}`;
//   }

//   const systemPrompt = await getSystemPrompt(hasDocumentContext);

//   for (const modelName of models) {
//     try {
//       const model = genAI.getGenerativeModel({
//         model: modelName,
//         systemInstruction: systemPrompt
//       });

//       const result = await model.generateContent(prompt, {
//         generationConfig: {
//           maxOutputTokens: 60, // Short responses (~40-45 words)
//           temperature: 0.7,
//           topP: 0.9,
//           topK: 40,
//         },
//       });

//       let text = await result.response.text();
//       const usage = result.response.usageMetadata || {};
      
//       console.log(
//         `✅ ${provider} (${modelName}) - Tokens: ${usage.promptTokenCount || 0} + ${usage.candidatesTokenCount || 0}`
//       );
      
//       // Clean the response
//       text = cleanResponse(text);
      
//       // Enforce word limit (max 50 words)
//       const words = text.split(/\s+/);
//       if (words.length > 50) {
//         text = words.slice(0, 50).join(' ') + '...';
//       }
      
//       return text;
//     } catch (err) {
//       const errorMessage = err.message || '';
//       const isNotFoundError = 
//         errorMessage.includes('404') ||
//         errorMessage.includes('Not Found') ||
//         err.status === 404;
      
//       if (isNotFoundError && modelName !== models[models.length - 1]) {
//         console.log(`Model ${modelName} not found, trying next fallback...`);
//         continue;
//       }
      
//       if (modelName === models[models.length - 1]) {
//         throw err;
//       }
//     }
//   }
  
//   throw new Error('All models failed');
// }

// async function getSummaryFromChunks(chunks) {
//   if (!chunks || chunks.length === 0) return null;
  
//   const combinedText = Array.isArray(chunks) ? chunks.join('\n\n') : chunks;
  
//   const prompt = `Summarize this in 2-3 short sentences:\n\n${combinedText}`;

//   const summary = await askLLM('gemini', prompt);
//   return summary;
// }

// module.exports = {
//   askLLM,
//   resolveProviderName,
//   getSummaryFromChunks,
// };

require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const PROVIDER_ALIASES = {
  gemini: 'gemini',
  'gemini-pro-2.5': 'gemini-pro-2.5',
  'gemini-3-pro': 'gemini-3-pro',
};

function resolveProviderName(name = '') {
  const key = name.trim().toLowerCase();
  return PROVIDER_ALIASES[key] || 'gemini';
}

const GEMINI_MODELS = {
  gemini: ['gemini-2.0-flash-exp', 'gemini-2.5-flash-preview-04-17'],
  'gemini-pro-2.5': ['gemini-2.5-pro', 'gemini-2.5-pro-preview-05-06'],
  'gemini-3-pro': ['gemini-3-pro-preview'],
};

function estimateTokenCount(text = '') {
  return Math.ceil(text.length / 4);
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

/**
 * Clean response text - keep it natural and concise
 */
function cleanResponse(text) {
  if (!text) return text;
  
  let cleaned = text;
  
  // Remove chunk/document references
  cleaned = cleaned.replace(/\(Chunks?\s+\d+(?:\s*,\s*\d+)*\)/gi, '');
  cleaned = cleaned.replace(/Chunks?\s+\d+(?:\s*,\s*\d+)*/gi, '');
  cleaned = cleaned.replace(/\[Chunks?\s+\d+(?:\s*,\s*\d+)*\]/gi, '');
  cleaned = cleaned.replace(/\b(based on|according to|from|in) (the\s+)?(document|context|provided information|search results?)\b/gi, '');
  
  // Clean markdown links
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
  
  // Normalize whitespace
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.replace(/[ \t]{2,}/g, ' ');
  cleaned = cleaned.trim();
  
  return cleaned;
}

async function getSystemPrompt(hasDocumentContext = false) {
  return `You are JuriNex AI. Answer in MAXIMUM 2-3 short sentences only. Be brief and direct.${hasDocumentContext ? ' Use provided info naturally.' : ''}`;
}

async function askLLM(providerName, userMessage, context = '', relevant_chunks = '', originalQuestion = null, isGeneralQuestion = false) {
  const provider = resolveProviderName(providerName);
  const models = GEMINI_MODELS[provider] || GEMINI_MODELS['gemini'];
  
  const trimmedContext = trimContext(context, 20000);
  const trimmedChunks = trimContext(relevant_chunks, 20000);

  let prompt = userMessage.trim();
  const hasDocumentContext = !!trimmedChunks;
  
  if (trimmedChunks) {
    prompt += `\n\nRelevant Information:\n${trimmedChunks}`;
  }

  const systemPrompt = await getSystemPrompt(hasDocumentContext);

  for (const modelName of models) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: systemPrompt
      });

      const result = await model.generateContent(prompt, {
        generationConfig: {
          maxOutputTokens: 10, // Very short: ~25-30 words max
          temperature: 0.6,
          topP: 0.8,
          topK: 30,
        },
      });

      let text = await result.response.text();
      const usage = result.response.usageMetadata || {};
      
      console.log(
        `✅ ${provider} (${modelName}) - Tokens: ${usage.promptTokenCount || 0} + ${usage.candidatesTokenCount || 0}`
      );
      
      // Clean the response
      text = cleanResponse(text);
      
      // Enforce strict 2-3 sentence limit (max 30 words)
      const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
      if (sentences.length > 3) {
        text = sentences.slice(0, 3).join(' ');
      }
      
      const words = text.split(/\s+/);
      if (words.length > 35) {
        text = words.slice(0, 35).join(' ') + '.';
      }
      
      return text;
    } catch (err) {
      const errorMessage = err.message || '';
      const isNotFoundError = 
        errorMessage.includes('404') ||
        errorMessage.includes('Not Found') ||
        err.status === 404;
      
      if (isNotFoundError && modelName !== models[models.length - 1]) {
        console.log(`Model ${modelName} not found, trying next fallback...`);
        continue;
      }
      
      if (modelName === models[models.length - 1]) {
        throw err;
      }
    }
  }
  
  throw new Error('All models failed');
}

async function getSummaryFromChunks(chunks) {
  if (!chunks || chunks.length === 0) return null;
  
  const combinedText = Array.isArray(chunks) ? chunks.join('\n\n') : chunks;
  
  const prompt = `Summarize this in 2-3 short sentences:\n\n${combinedText}`;

  const summary = await askLLM('gemini', prompt);
  return summary;
}

module.exports = {
  askLLM,
  resolveProviderName,
  getSummaryFromChunks,
};