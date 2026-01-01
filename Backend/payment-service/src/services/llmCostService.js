/**
 * LLM Cost Calculation Service
 * Calculates costs for different Gemini models based on token usage
 * Prices are per 1 Million tokens in Indian Rupees (INR)
 */

// Model pricing per 1 Million tokens (Input, Output) in INR
const MODEL_PRICING = {
  'gemini-2.0-flash-001': { input: 8.45, output: 33.80 },
  'gemini-2.0-flash': { input: 8.45, output: 33.80 },
  'gemini-2.0-flash-lite': { input: 6.35, output: 25.35 },
  'gemini-2.5-flash-001': { input: 25.35, output: 211.25 },
  'gemini-2.5-flash': { input: 25.35, output: 211.25 },
  'gemini-2.5-flash-lite': { input: 8.45, output: 33.80 },
  'gemini-2.5-pro-001': { input: 105.60, output: 845.00 },
  'gemini-2.5-pro': { input: 105.60, output: 845.00 },
  'gemini-3-flash-001': { input: 42.25, output: 126.75 },
  'gemini-3-flash': { input: 42.25, output: 126.75 },
  'gemini-3-pro-preview': { input: 169.00, output: 1014.00 }, // Default for <= 200k context
  'gemini-3-pro': { input: 169.00, output: 1014.00 }, // Default for <= 200k context
};

/**
 * Normalize model name to match pricing keys
 * @param {string} modelName - Raw model name from API
 * @returns {string} - Normalized model name
 */
function normalizeModelName(modelName) {
  if (!modelName) return null;
  
  // Convert to lowercase and handle common variations
  const normalized = modelName.toLowerCase().trim();
  
  // Direct match
  if (MODEL_PRICING[normalized]) {
    return normalized;
  }
  
  // Handle gemini-3-pro variations with context length
  if (normalized.includes('gemini-3-pro')) {
    // Check if context > 200k (would need to be passed separately or detected)
    // For now, default to <= 200k pricing
    return 'gemini-3-pro-preview';
  }
  
  // Try to match by pattern
  for (const key in MODEL_PRICING) {
    if (normalized.includes(key.replace(/-001$/, ''))) {
      return key;
    }
  }
  
  // Default fallback - use gemini-2.5-flash pricing
  console.warn(`⚠️ Unknown model "${modelName}", using default pricing (gemini-2.5-flash-001)`);
  return 'gemini-2.5-flash-001';
}

/**
 * Calculate cost for token usage
 * @param {string} modelName - Model name
 * @param {number} inputTokens - Number of input tokens
 * @param {number} outputTokens - Number of output tokens
 * @param {number} contextLength - Optional context length for gemini-3-pro (defaults to <= 200k)
 * @returns {Object} Cost breakdown
 */
function calculateCost(modelName, inputTokens, outputTokens, contextLength = 0) {
  const normalizedModel = normalizeModelName(modelName);
  
  if (!normalizedModel || !MODEL_PRICING[normalizedModel]) {
    // Use default pricing if model not found
    const defaultModel = 'gemini-2.5-flash-001';
    console.warn(`⚠️ Model "${modelName}" not found in pricing, using ${defaultModel}`);
    return calculateCost(defaultModel, inputTokens, outputTokens, contextLength);
  }
  
  // Handle gemini-3-pro with context > 200k
  let pricing = MODEL_PRICING[normalizedModel];
  if (normalizedModel === 'gemini-3-pro-preview' && contextLength > 200000) {
    pricing = { input: 338.00, output: 1521.00 };
  }
  
  // Calculate costs (prices are per 1M tokens, so divide by 1,000,000)
  const inputCost = (inputTokens / 1000000) * pricing.input;
  const outputCost = (outputTokens / 1000000) * pricing.output;
  const totalCost = inputCost + outputCost;
  
  return {
    inputCost: parseFloat(inputCost.toFixed(4)),
    outputCost: parseFloat(outputCost.toFixed(4)),
    totalCost: parseFloat(totalCost.toFixed(4)),
    modelName: normalizedModel,
    inputPricePerMillion: pricing.input,
    outputPricePerMillion: pricing.output
  };
}

module.exports = {
  calculateCost,
  normalizeModelName,
  MODEL_PRICING
};







