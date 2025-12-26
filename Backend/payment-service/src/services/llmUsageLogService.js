const pool = require('../config/db');
const { calculateCost } = require('./llmCostService');

/**
 * Service to log LLM usage to payment service database
 */
class LLMUsageLogService {
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
  static async logUsage(usageData) {
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

      console.log(`🔍 [LLM Usage Log Service] Received usageData:`, JSON.stringify(usageData));
      
      if (!userId || !modelName) {
        console.warn(`⚠️ [LLM Usage Log Service] Missing required fields - userId: ${userId}, modelName: ${modelName}`);
        return null;
      }

      const totalTokens = inputTokens + outputTokens;
      console.log(`💰 [LLM Usage Log Service] Calculating cost for model: ${modelName}, input: ${inputTokens}, output: ${outputTokens}`);

      // Calculate costs using the cost service
      const costData = calculateCost(modelName, inputTokens, outputTokens);
      console.log(`💰 [LLM Usage Log Service] Calculated costs - input: ₹${costData.inputCost}, output: ₹${costData.outputCost}, total: ₹${costData.totalCost}`);

      // Use UPSERT to aggregate tokens by user + model + date
      // If a row exists for the same user + model + date, add current tokens to previous tokens
      // Formula: new_total = previous_tokens + current_tokens
      // Also increment request_count to track individual requests
      // Otherwise, create a new row with current tokens and request_count = 1
      // Note: used_date is a generated column (DATE(used_at)), computed automatically from used_at
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
          request_count,
          used_at,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1, NOW(), NOW())
        ON CONFLICT (user_id, model_name, used_date)
        DO UPDATE SET
          -- Add current tokens to previous tokens: previous + current = new total
          input_tokens = public.llm_usage_logs.input_tokens + EXCLUDED.input_tokens,
          output_tokens = public.llm_usage_logs.output_tokens + EXCLUDED.output_tokens,
          total_tokens = public.llm_usage_logs.total_tokens + EXCLUDED.total_tokens,
          -- Add current costs to previous costs: previous + current = new total
          input_cost = public.llm_usage_logs.input_cost + EXCLUDED.input_cost,
          output_cost = public.llm_usage_logs.output_cost + EXCLUDED.output_cost,
          total_cost = public.llm_usage_logs.total_cost + EXCLUDED.total_cost,
          -- Increment request count: each conflict means another request
          request_count = public.llm_usage_logs.request_count + 1,
          used_at = NOW(),
          -- Keep the first endpoint and session_id, or update if they're provided
          endpoint = COALESCE(EXCLUDED.endpoint, public.llm_usage_logs.endpoint),
          session_id = COALESCE(EXCLUDED.session_id, public.llm_usage_logs.session_id)
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

      console.log(`💾 [LLM Usage Log Service] Attempting to insert/update with values:`, {
        userId,
        modelName,
        currentInputTokens: inputTokens,
        currentOutputTokens: outputTokens,
        currentTotalTokens: totalTokens,
        currentInputCost: costData.inputCost,
        currentOutputCost: costData.outputCost,
        currentTotalCost: costData.totalCost
      });

      const result = await pool.query(query, values);
      
      if (!result || !result.rows || result.rows.length === 0) {
        console.error('❌ [LLM Usage Log Service] Query executed but no rows returned');
        return null;
      }
      
      const savedRecord = result.rows[0];
      
      // Convert DECIMAL values from PostgreSQL (strings) to numbers for formatting
      const inputCost = parseFloat(savedRecord.input_cost) || 0;
      const outputCost = parseFloat(savedRecord.output_cost) || 0;
      const totalCost = parseFloat(savedRecord.total_cost) || 0;
      
      const requestCount = savedRecord.request_count || 1;
      console.log(`✅ [LLM Usage Log Service] Successfully logged usage for user ${userId}, model ${modelName}`);
      console.log(`   📊 Current usage (added to previous): input: ${savedRecord.input_tokens}, output: ${savedRecord.output_tokens}, total: ${savedRecord.total_tokens}`);
      console.log(`   💰 Current cost (added to previous): input: ₹${inputCost.toFixed(4)}, output: ₹${outputCost.toFixed(4)}, total: ₹${totalCost.toFixed(4)}`);
      console.log(`   🔢 Request count: ${requestCount} (${requestCount === 1 ? 'new request' : 'aggregated requests'})`);
      console.log(`   🆔 Record ID: ${savedRecord.id}`);
      
      return result.rows[0];
    } catch (error) {
      // Log detailed error information
      console.error('❌ [LLM Usage Log Service] Failed to log usage:', error.message);
      console.error('❌ [LLM Usage Log Service] Error code:', error.code);
      console.error('❌ [LLM Usage Log Service] Error name:', error.name);
      console.error('❌ [LLM Usage Log Service] Error stack:', error.stack);
      if (error.detail) {
        console.error('❌ [LLM Usage Log Service] Error detail:', error.detail);
      }
      if (error.hint) {
        console.error('❌ [LLM Usage Log Service] Error hint:', error.hint);
      }
      if (error.position) {
        console.error('❌ [LLM Usage Log Service] Error position:', error.position);
      }
      // Log the query and values for debugging
      console.error('❌ [LLM Usage Log Service] Query:', query.substring(0, 200) + '...');
      console.error('❌ [LLM Usage Log Service] Values:', JSON.stringify(values));
      return null;
    }
  }
}

module.exports = LLMUsageLogService;


