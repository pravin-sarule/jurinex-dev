const axios = require('axios');

const API_GATEWAY_URL = process.env.API_GATEWAY_URL || 'http://localhost:5000';
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://localhost:5003';

/**
 * Service to log LLM usage to payment service
 */
class LLMUsageLogService {
  /**
   * Log LLM usage to payment service
   * @param {Object} usageData - Usage data object
   * @param {number} usageData.userId - User ID
   * @param {string} usageData.modelName - Model name used
   * @param {number} usageData.inputTokens - Input tokens
   * @param {number} usageData.outputTokens - Output tokens
   * @param {string} usageData.endpoint - API endpoint (optional)
   * @param {string} usageData.requestId - Request ID (optional)
   * @param {string} usageData.fileId - File ID (optional)
   * @param {string} usageData.sessionId - Session ID (optional)
   * @returns {Promise<Object|null>} Saved usage log or null
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

      if (!userId || !modelName) {
        console.warn(`⚠️ [LLM Usage Log] Missing required fields - userId: ${userId}, modelName: ${modelName}`);
        return null;
      }

      console.log(`📊 [LLM Usage Log] Attempting to log usage - userId: ${userId}, model: ${modelName}, input: ${inputTokens}, output: ${outputTokens}, endpoint: ${endpoint || 'N/A'}`);
      console.log(`📊 [LLM Usage Log] Payment service URL: ${PAYMENT_SERVICE_URL}/api/user-resources/llm-usage-log`);

      // Send directly to payment service (internal service-to-service call)
      const response = await axios.post(
        `${PAYMENT_SERVICE_URL}/api/user-resources/llm-usage-log`,
        {
          userId,
          modelName,
          inputTokens,
          outputTokens,
          endpoint,
          requestId,
          fileId,
          sessionId
        },
        {
          timeout: 5000, // Short timeout since this is fire-and-forget
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data && response.data.success) {
        console.log(`✅ [LLM Usage Log] Successfully logged usage for user ${userId}, model ${modelName}, total tokens: ${inputTokens + outputTokens}`);
        return response.data.data;
      } else {
        console.warn(`⚠️ [LLM Usage Log] Payment service returned unsuccessful response:`, response.data);
        return null;
      }

      return null;
    } catch (error) {
      // Don't throw error - just log it so LLM calls don't fail
      console.error('❌ [LLM Usage Log] Failed to log usage to payment service:', error.message);
      if (error.response) {
        console.error('❌ [LLM Usage Log] Response status:', error.response.status);
        console.error('❌ [LLM Usage Log] Response data:', error.response.data);
      }
      if (error.request) {
        console.error('❌ [LLM Usage Log] Request was made but no response received. Payment service URL:', `${PAYMENT_SERVICE_URL}/api/user-resources/llm-usage-log`);
      }
      // Log full error in development
      if (process.env.NODE_ENV === 'development') {
        console.error('❌ [LLM Usage Log] Full error details:', error);
      }
      return null;
    }
  }
}

module.exports = LLMUsageLogService;


