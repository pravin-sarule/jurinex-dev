const pool = require('../config/db');
const UserService = require('../services/userService');

/**
 * Get LLM usage logs for a user
 * @route GET /api/user-resources/llm-usage
 */
exports.getLLMUsage = async (req, res) => {
  try {
    const userId = req.user.id;
    const authorizationHeader = req.headers.authorization;
    
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // Check if table exists first
    try {
      const tableCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'llm_usage_logs'
        );
      `);
      
      if (!tableCheck.rows[0].exists) {
        console.error('❌ llm_usage_logs table does not exist in public schema');
        return res.status(500).json({ 
          success: false,
          message: 'LLM usage table not found. Please run the database migration.', 
          error: 'Table llm_usage_logs does not exist in public schema'
        });
      }
    } catch (checkError) {
      console.error('❌ Error checking table existence:', checkError);
    }

    const { startDate, endDate, modelName, limit = 100, offset = 0 } = req.query;

    let query = `
      SELECT 
        id,
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
        used_at,
        created_at
      FROM public.llm_usage_logs
      WHERE user_id = $1
    `;
    
    const params = [userId];
    let paramIndex = 2;

    if (startDate) {
      query += ` AND used_at >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND used_at <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    if (modelName) {
      query += ` AND model_name = $${paramIndex}`;
      params.push(modelName);
      paramIndex++;
    }

    query += ` ORDER BY used_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Fetch usernames for all unique user IDs in the logs
    const uniqueUserIds = [...new Set(result.rows.map(row => row.user_id))];
    const usernameMap = await UserService.getUsernamesByIds(uniqueUserIds, authorizationHeader);

    // Add username to each log entry
    const logsWithUsernames = result.rows.map(log => ({
      ...log,
      username: usernameMap.get(log.user_id) || `User ${log.user_id}`
    }));

    // Get active users
    const activeUsers = await UserService.getActiveUsers(authorizationHeader);

    // Get summary statistics
    // Use SUM(request_count) instead of COUNT(*) to get actual number of requests
    // since rows are aggregated by date (user + model + date)
    // If request_count column doesn't exist (backward compatibility), use COUNT(*)
    let summaryQuery = `
      SELECT 
        COALESCE(SUM(COALESCE(request_count, 1)), COUNT(*)) as total_requests,
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(SUM(input_cost), 0) as total_input_cost,
        COALESCE(SUM(output_cost), 0) as total_output_cost,
        COALESCE(SUM(total_cost), 0) as total_cost,
        COUNT(DISTINCT model_name) as unique_models
      FROM public.llm_usage_logs
      WHERE user_id = $1
    `;
    
    const summaryParams = [userId];
    let summaryParamIndex = 2;

    if (startDate) {
      summaryQuery += ` AND used_at >= $${summaryParamIndex}`;
      summaryParams.push(startDate);
      summaryParamIndex++;
    }

    if (endDate) {
      summaryQuery += ` AND used_at <= $${summaryParamIndex}`;
      summaryParams.push(endDate);
      summaryParamIndex++;
    }

    if (modelName) {
      summaryQuery += ` AND model_name = $${summaryParamIndex}`;
      summaryParams.push(modelName);
      summaryParamIndex++;
    }

    const summaryResult = await pool.query(summaryQuery, summaryParams);
    const summary = summaryResult.rows[0] || {
      total_requests: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_tokens: 0,
      total_input_cost: 0,
      total_output_cost: 0,
      total_cost: 0,
      unique_models: 0
    };

    // Get usage by model
    // Use SUM(request_count) instead of COUNT(*) to get actual number of requests per model
    // If request_count column doesn't exist (backward compatibility), use COUNT(*)
    let modelStatsQuery = `
      SELECT 
        model_name,
        COALESCE(SUM(COALESCE(request_count, 1)), COUNT(*)) as request_count,
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(SUM(total_cost), 0) as total_cost
      FROM public.llm_usage_logs
      WHERE user_id = $1
    `;
    
    const modelStatsParams = [userId];
    let modelStatsParamIndex = 2;

    if (startDate) {
      modelStatsQuery += ` AND used_at >= $${modelStatsParamIndex}`;
      modelStatsParams.push(startDate);
      modelStatsParamIndex++;
    }

    if (endDate) {
      modelStatsQuery += ` AND used_at <= $${modelStatsParamIndex}`;
      modelStatsParams.push(endDate);
      modelStatsParamIndex++;
    }

    modelStatsQuery += ` GROUP BY model_name ORDER BY total_cost DESC`;

    const modelStatsResult = await pool.query(modelStatsQuery, modelStatsParams);

    res.status(200).json({
      success: true,
      data: {
        logs: logsWithUsernames,
        summary: {
          total_requests: parseInt(summary.total_requests) || 0,
          total_input_tokens: parseInt(summary.total_input_tokens) || 0,
          total_output_tokens: parseInt(summary.total_output_tokens) || 0,
          total_tokens: parseInt(summary.total_tokens) || 0,
          total_input_cost: parseFloat(summary.total_input_cost) || 0,
          total_output_cost: parseFloat(summary.total_output_cost) || 0,
          total_cost: parseFloat(summary.total_cost) || 0,
          unique_models: parseInt(summary.unique_models) || 0
        },
        by_model: modelStatsResult.rows.map(row => ({
          model_name: row.model_name,
          request_count: parseInt(row.request_count),
          total_input_tokens: parseInt(row.total_input_tokens),
          total_output_tokens: parseInt(row.total_output_tokens),
          total_tokens: parseInt(row.total_tokens),
          total_cost: parseFloat(row.total_cost)
        })),
        active_users: activeUsers
      }
    });

  } catch (error) {
    console.error('❌ Error fetching LLM usage:', error);
    console.error('Error stack:', error.stack);
    
    // Check if table doesn't exist
    if (error.message && error.message.includes('does not exist')) {
      return res.status(500).json({ 
        success: false,
        message: 'LLM usage table not found. Please run the database migration.', 
        error: error.message 
      });
    }
    
    res.status(500).json({ 
      success: false,
      message: 'Internal server error', 
      error: error.message 
    });
  }
};

