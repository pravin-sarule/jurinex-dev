/**
 * LLM Usage Tracking Service
 * Saves LLM usage logs to the database
 */

const pool = require('../config/db');

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
  'gemini-3-pro-preview': { input: 169.00, output: 1014.00 },
  'gemini-3-pro': { input: 169.00, output: 1014.00 },
};

function normalizeModelName(modelName) {
  if (!modelName) return null;
  const normalized = modelName.toLowerCase().trim();
  if (MODEL_PRICING[normalized]) return normalized;
  
  for (const key in MODEL_PRICING) {
    if (normalized.includes(key.replace(/-001$/, ''))) {
      return key;
    }
  }
  
  console.warn(`⚠️ Unknown model "${modelName}", using default pricing (gemini-2.5-flash-001)`);
  return 'gemini-2.5-flash-001';
}

function calculateCost(modelName, inputTokens, outputTokens, contextLength = 0) {
  const normalizedModel = normalizeModelName(modelName);
  
  if (!normalizedModel || !MODEL_PRICING[normalizedModel]) {
    const defaultModel = 'gemini-2.5-flash-001';
    return calculateCost(defaultModel, inputTokens, outputTokens, contextLength);
  }
  
  let pricing = MODEL_PRICING[normalizedModel];
  if (normalizedModel === 'gemini-3-pro-preview' && contextLength > 200000) {
    pricing = { input: 338.00, output: 1521.00 };
  }
  
  const inputCost = (inputTokens / 1000000) * pricing.input;
  const outputCost = (outputTokens / 1000000) * pricing.output;
  const totalCost = inputCost + outputCost;
  
  return {
    inputCost: parseFloat(inputCost.toFixed(4)),
    outputCost: parseFloat(outputCost.toFixed(4)),
    totalCost: parseFloat(totalCost.toFixed(4)),
    modelName: normalizedModel
  };
}

/**
 * Log LLM usage to database
 * @param {Object} usageData - Usage data object
 * @param {number} usageData.userId - User ID
 * @param {string} usageData.modelName - Model name used
 * @param {number} usageData.inputTokens - Input tokens
 * @param {number} usageData.outputTokens - Output tokens
 * @param {string} usageData.endpoint - API endpoint (optional)
 * @param {string} usageData.requestId - Request ID (optional)
 * @param {string} usageData.fileId - File ID (optional)
 * @param {string} usageData.sessionId - Session ID (optional)
 * @returns {Promise<Object>} Saved usage log
 */
async function logLLMUsage(usageData) {
  try {
    const {
      userId,
      modelName,
      inputTokens = 0,
      outputTokens = 0,
      endpoint = null,
      requestId = null,
      fileId = null,
      sessionId = null
    } = usageData;

    if (!userId || !modelName) {
      console.warn('⚠️ [LLM Usage] Missing required fields (userId or modelName)');
      return null;
    }

    const totalTokens = inputTokens + outputTokens;

    // Calculate costs
    const costData = calculateCost(modelName, inputTokens, outputTokens);

    const query = `
      INSERT INTO public.llm_usage_logs (
        user_id,
        model_name,
        input_tokens,
        output_tokens,
        total_tokens,
        input_cost,
        output_cost,
        total_cost,
        request_id,
        endpoint,
        file_id,
        session_id,
        used_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
      RETURNING *
    `;

    const values = [
      userId,
      modelName,
      inputTokens,
      outputTokens,
      totalTokens,
      costData.inputCost,
      costData.outputCost,
      costData.totalCost,
      requestId,
      endpoint,
      fileId,
      sessionId
    ];

    const result = await pool.query(query, values);
    
    console.log(`✅ [LLM Usage] Logged usage for user ${userId}, model ${modelName}, tokens: ${totalTokens}, cost: ₹${costData.totalCost.toFixed(4)}`);
    
    return result.rows[0];
  } catch (error) {
    // Don't throw error - just log it so LLM calls don't fail
    console.error('❌ [LLM Usage] Failed to log usage:', error.message);
    console.error('Error details:', error);
    return null;
  }
}

module.exports = {
  logLLMUsage
};

