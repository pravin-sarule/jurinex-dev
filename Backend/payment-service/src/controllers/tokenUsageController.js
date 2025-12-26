const pool = require('../config/db');
const TokenUsageSyncService = require('../services/tokenUsageSyncService');

/**
 * Get token usage for the current user
 * Fetches from document service and returns the data
 * @route GET /api/user-resources/token-usage
 */
exports.getTokenUsage = async (req, res) => {
  try {
    const userId = req.user.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const authorizationHeader = req.headers.authorization;
    if (!authorizationHeader) {
      return res.status(401).json({ message: 'Authorization header required' });
    }

    // Fetch token usage from document service
    const usageData = await TokenUsageSyncService.getTokenUsage(userId, authorizationHeader);

    console.log(`📊 [TokenUsageController] Received usage data for user ${userId}:`, usageData);

    if (!usageData) {
      console.warn(`⚠️ [TokenUsageController] No usage data returned for user ${userId}, returning zeros`);
      return res.status(200).json({
        success: true,
        data: {
          tokens_used: 0,
          documents_used: 0,
          ai_analysis_used: 0,
          storage_used_gb: 0,
          carry_over_tokens: 0,
          period_start: null,
          period_end: null,
          updated_at: null
        }
      });
    }

    const responseData = {
      tokens_used: (usageData.tokens_used !== null && usageData.tokens_used !== undefined) ? usageData.tokens_used : 0,
      documents_used: (usageData.documents_used !== null && usageData.documents_used !== undefined) ? usageData.documents_used : 0,
      ai_analysis_used: (usageData.ai_analysis_used !== null && usageData.ai_analysis_used !== undefined) ? usageData.ai_analysis_used : 0,
      storage_used_gb: (usageData.storage_used_gb !== null && usageData.storage_used_gb !== undefined) ? usageData.storage_used_gb : 0,
      carry_over_tokens: (usageData.carry_over_tokens !== null && usageData.carry_over_tokens !== undefined) ? usageData.carry_over_tokens : 0,
      period_start: usageData.period_start || null,
      period_end: usageData.period_end || null,
      updated_at: usageData.updated_at || usageData.last_updated || null
    };

    console.log(`✅ [TokenUsageController] Sending token usage response for user ${userId}:`, responseData);

    res.status(200).json({
      success: true,
      data: responseData
    });

  } catch (error) {
    console.error('❌ Error fetching token usage:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error', 
      error: error.message 
    });
  }
};


