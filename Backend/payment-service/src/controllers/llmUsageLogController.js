const pool = require('../config/db');
const LLMUsageLogService = require('../services/llmUsageLogService');

/**
 * Create LLM usage log entry
 * Called by document service to log LLM usage
 * @route POST /api/user-resources/llm-usage-log
 */
exports.createLLMUsageLog = async (req, res) => {
  try {
    console.log('📥 [LLM Usage Log Controller] Received request:', {
      userId: req.body.userId,
      modelName: req.body.modelName,
      inputTokens: req.body.inputTokens,
      outputTokens: req.body.outputTokens
    });

    const {
      userId,
      modelName,
      inputTokens = 0,
      outputTokens = 0,
      endpoint = null,
      requestId = null,
      fileId = null,
      sessionId = null
    } = req.body;

    if (!userId || !modelName) {
      console.warn('⚠️ [LLM Usage Log Controller] Missing required fields:', { userId, modelName });
      return res.status(400).json({ 
        success: false,
        message: 'userId and modelName are required' 
      });
    }

    const usageLog = await LLMUsageLogService.logUsage({
      userId,
      modelName,
      inputTokens,
      outputTokens,
      endpoint,
      requestId,
      fileId,
      sessionId
    });

    if (!usageLog) {
      console.error('❌ [LLM Usage Log Controller] Failed to create usage log - service returned null');
      console.error('❌ [LLM Usage Log Controller] Check service logs above for database error details');
      return res.status(500).json({
        success: false,
        message: 'Failed to create usage log. Check server logs for details.'
      });
    }

    console.log('✅ [LLM Usage Log Controller] Successfully created usage log:', {
      id: usageLog.id,
      userId: usageLog.user_id,
      modelName: usageLog.model_name,
      totalTokens: usageLog.total_tokens,
      totalCost: usageLog.total_cost
    });

    res.status(201).json({
      success: true,
      data: usageLog
    });

  } catch (error) {
    console.error('❌ [LLM Usage Log Controller] Error creating LLM usage log:', error);
    console.error('❌ [LLM Usage Log Controller] Error stack:', error.stack);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error', 
      error: error.message 
    });
  }
};


