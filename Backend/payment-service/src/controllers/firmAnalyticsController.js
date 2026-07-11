const pool = require('../config/db');
const { fetchFirmContext, fetchFirmMembers } = require('../services/firmContextService');
const { fetchUserDocumentAnalytics } = require('../services/documentAnalyticsService');
const { resolveEffectivePlan } = require('../services/effectivePlanService');

function logFirmAnalytics(stage, payload = {}) {
  console.log(`[FirmAnalytics] ${stage}`, payload);
}

function logFirmAnalyticsError(stage, error, payload = {}) {
  console.error(`[FirmAnalytics] ${stage}`, {
    ...payload,
    message: error?.message,
    code: error?.code,
    detail: error?.detail,
    hint: error?.hint,
    status: error?.response?.status,
    responseData: error?.response?.data,
    stack: error?.stack,
  });
}

function parseRange(range = '30d') {
  const match = String(range || '30d').trim().match(/^(\d{1,3})d$/i);
  const days = match ? Math.max(1, Math.min(365, parseInt(match[1], 10))) : 30;
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

  return {
    label: `${days}d`,
    days,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
  };
}

function getCurrentMonthWindow() {
  const now = new Date();
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return {
    startDate: startDate.toISOString(),
    endDate: now.toISOString(),
  };
}

function toInt(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function toFloat(value, fallback = 0) {
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

async function requireFirmAdminContext(req) {
  const actorId = Number(req.user?.id);
  const actorEmail = req.user?.email || null;
  const actorAccountType = req.user?.account_type || null;

  logFirmAnalytics('Scope request received', {
    actorId,
    actorEmail,
    actorAccountType,
  });

  if (!actorId) {
    return { error: { status: 401, message: 'Unauthorized' } };
  }

  const firmContext = await fetchFirmContext(actorId);
  if (!firmContext?.firmId || !firmContext?.isFirmAdmin) {
    return { error: { status: 403, message: 'Only firm admins can view firm analytics.' } };
  }

  const roster = await fetchFirmMembers(actorId);
  const members = Array.isArray(roster?.members) ? roster.members : [];

  logFirmAnalytics('Scope resolved', {
    actorId,
    actorEmail,
    actorAccountType,
    firmId: firmContext.firmId,
    firmAdminUserId: firmContext.firmAdminUserId,
    memberCount: members.length,
    memberUserIds: members.map((member) => Number(member.user_id)).filter((value) => !Number.isNaN(value)),
  });

  return {
    actorId,
    actorEmail,
    actorAccountType,
    firmContext,
    members,
  };
}

async function getFirmUsageSummary(userIds, startDate, endDate) {
  if (!userIds.length) return new Map();

  const result = await pool.query(
    `
      SELECT
        user_id,
        COALESCE(SUM(COALESCE(request_count, 1)), COUNT(*)) AS request_count,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        COALESCE(SUM(total_cost), 0) AS total_cost
      FROM public.llm_usage_logs
      WHERE user_id = ANY($1::int[])
        AND used_at >= $2
        AND used_at <= $3
      GROUP BY user_id
    `,
    [userIds, startDate, endDate]
  );

  const usageMap = new Map();
  for (const row of result.rows || []) {
    usageMap.set(Number(row.user_id), {
      requestCount: toInt(row.request_count),
      inputTokens: toInt(row.input_tokens),
      outputTokens: toInt(row.output_tokens),
      totalTokens: toInt(row.total_tokens),
      totalCost: toFloat(row.total_cost),
    });
  }
  return usageMap;
}

async function getCurrentMonthUsageMap(userIds) {
  if (!userIds.length) return new Map();

  const { startDate, endDate } = getCurrentMonthWindow();
  logFirmAnalytics('Loading current month usage breakdown', {
    userIds,
    startDate,
    endDate,
  });

  const result = await pool.query(
    `
      SELECT
        user_id,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(total_tokens), 0) AS total_tokens
      FROM public.llm_usage_logs
      WHERE user_id = ANY($1::int[])
        AND used_at >= $2
        AND used_at <= $3
      GROUP BY user_id
    `,
    [userIds, startDate, endDate]
  );

  const usageMap = new Map();
  for (const row of result.rows || []) {
    usageMap.set(Number(row.user_id), {
      inputTokens: toInt(row.input_tokens),
      outputTokens: toInt(row.output_tokens),
      totalTokens: toInt(row.total_tokens),
    });
  }

  logFirmAnalytics('Current month usage breakdown loaded', {
    userIds,
    matchedRows: result.rows?.length || 0,
    usersWithUsage: Array.from(usageMap.keys()),
  });

  return usageMap;
}

async function getTokenLimitMap(firmId, userIds) {
  if (!firmId || !userIds.length) return new Map();

  logFirmAnalytics('Loading token limit map', {
    firmId,
    firmIdType: typeof firmId,
    userIds,
  });

  const result = await pool.query(
    `
      SELECT
        user_id,
        monthly_token_limit,
        hard_stop_enabled,
        updated_by,
        created_at,
        updated_at
      FROM firm_user_token_limits
      WHERE firm_id = $1
        AND user_id = ANY($2::int[])
    `,
    [firmId, userIds]
  );

  const limitsMap = new Map();
  for (const row of result.rows || []) {
    limitsMap.set(Number(row.user_id), {
      monthlyTokenLimit: row.monthly_token_limit === null ? null : toInt(row.monthly_token_limit),
      hardStopEnabled: row.hard_stop_enabled !== false,
      updatedBy: row.updated_by ? Number(row.updated_by) : null,
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
    });
  }

  logFirmAnalytics('Token limit map loaded', {
    firmId,
    matchedRows: result.rows?.length || 0,
    usersWithCaps: Array.from(limitsMap.keys()),
  });

  return limitsMap;
}

function buildCapStatus(limit, usageThisMonth = {}) {
  const normalizedUsage = {
    inputTokens: toInt(usageThisMonth?.inputTokens),
    outputTokens: toInt(usageThisMonth?.outputTokens),
    totalTokens: toInt(usageThisMonth?.totalTokens ?? usageThisMonth),
  };

  if (!limit || limit.monthlyTokenLimit === null || limit.monthlyTokenLimit === undefined) {
    return {
      monthlyTokenLimit: null,
      hardStopEnabled: true,
      usedThisMonth: normalizedUsage.totalTokens,
      usedThisMonthInputTokens: normalizedUsage.inputTokens,
      usedThisMonthOutputTokens: normalizedUsage.outputTokens,
      usedThisMonthTotalTokens: normalizedUsage.totalTokens,
      remainingThisMonth: null,
      capStatus: 'unlimited',
    };
  }

  const remaining = Math.max(0, limit.monthlyTokenLimit - normalizedUsage.totalTokens);
  const exceeded = normalizedUsage.totalTokens >= limit.monthlyTokenLimit;

  return {
    monthlyTokenLimit: limit.monthlyTokenLimit,
    hardStopEnabled: limit.hardStopEnabled !== false,
    usedThisMonth: normalizedUsage.totalTokens,
    usedThisMonthInputTokens: normalizedUsage.inputTokens,
    usedThisMonthOutputTokens: normalizedUsage.outputTokens,
    usedThisMonthTotalTokens: normalizedUsage.totalTokens,
    remainingThisMonth: remaining,
    capStatus: exceeded ? 'exceeded' : 'within_limit',
  };
}

async function buildFirmUserAnalyticsRows({ members, firmId, rangeWindow }) {
  const memberIds = members.map((member) => Number(member.user_id)).filter((value) => !Number.isNaN(value));

  logFirmAnalytics('Building analytics rows', {
    firmId,
    memberIds,
    range: rangeWindow.label,
    startDate: rangeWindow.startDate,
    endDate: rangeWindow.endDate,
  });

  const [usageMap, currentMonthUsageMap, limitMap, documentAnalytics] = await Promise.all([
    getFirmUsageSummary(memberIds, rangeWindow.startDate, rangeWindow.endDate),
    getCurrentMonthUsageMap(memberIds),
    getTokenLimitMap(firmId, memberIds),
    fetchUserDocumentAnalytics(memberIds, {
      startDate: rangeWindow.startDate,
      endDate: rangeWindow.endDate,
    }),
  ]);

  const effectivePlans = await Promise.all(
    memberIds.map(async (userId) => {
      const resolved = await resolveEffectivePlan(userId);
      return [userId, resolved.activePlan];
    })
  );
  const effectivePlanMap = new Map(effectivePlans);

  logFirmAnalytics('Analytics dependencies resolved', {
    firmId,
    memberIds,
    usageUsers: Array.from(usageMap.keys()),
    currentMonthUsers: Array.from(currentMonthUsageMap.keys()),
    cappedUsers: Array.from(limitMap.keys()),
    documentAnalyticsUsers: Object.keys(documentAnalytics || {}),
    effectivePlanUsers: Array.from(effectivePlanMap.keys()),
  });

  return members.map((member) => {
    const userId = Number(member.user_id);
    const usage = usageMap.get(userId) || {
      requestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalCost: 0,
    };
    const docMetrics = documentAnalytics?.[userId] || documentAnalytics?.[String(userId)] || {};
    const usedThisMonth = currentMonthUsageMap.get(userId) || {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
    const limit = limitMap.get(userId);
    const plan = effectivePlanMap.get(userId) || null;

    return {
      userId,
      username: member.username || member.email || `User ${userId}`,
      email: member.email,
      accountType: member.account_type || member.role || 'SOLO',
      membershipRole: member.role || member.account_type || 'STAFF',
      isActive: member.is_active !== false,
      isBlocked: member.is_active === false, // legacy alias: disabled users
      firstLogin: !!member.first_login,
      createdAt: member.created_at || null,
      lastLoginAt: member.last_login_at || null,
      lastSeenAt: member.last_seen_at || null,
      effectivePlan: plan
        ? {
            planName: plan.plan_name || plan.name || 'Unknown',
            isInheritedFromFirm: !!plan.is_inherited_from_firm,
            planOwnerUserId: plan.plan_owner_user_id || null,
            firmId: plan.firm_id || null,
          }
        : null,
      usage,
      documentsUploaded: toInt(docMetrics.documentsUploadedCount),
      uploadedBytes: toInt(docMetrics.uploadedBytes),
      latestUploadAt: docMetrics.latestUploadAt || null,
      casesCreated: toInt(docMetrics.casesCreatedCount),
      assignedCases: toInt(docMetrics.assignedCasesCount),
      createdCases: Array.isArray(docMetrics.createdCases) ? docMetrics.createdCases : [],
      tokenCap: buildCapStatus(limit, usedThisMonth),
    };
  });
}

function sortRows(rows, sortBy = 'tokens_desc') {
  const cloned = [...rows];

  switch (sortBy) {
    case 'cost_desc':
      return cloned.sort((a, b) => b.usage.totalCost - a.usage.totalCost);
    case 'last_seen_desc':
      return cloned.sort((a, b) => new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0));
    case 'last_login_desc':
      return cloned.sort((a, b) => new Date(b.lastLoginAt || 0) - new Date(a.lastLoginAt || 0));
    case 'documents_desc':
      return cloned.sort((a, b) => b.documentsUploaded - a.documentsUploaded);
    case 'cases_desc':
      return cloned.sort((a, b) => b.casesCreated - a.casesCreated);
    case 'name_asc':
      return cloned.sort((a, b) => String(a.username).localeCompare(String(b.username)));
    case 'tokens_desc':
    default:
      return cloned.sort((a, b) => b.usage.totalTokens - a.usage.totalTokens);
  }
}

exports.getFirmAnalyticsSummary = async (req, res) => {
  try {
    const scope = await requireFirmAdminContext(req);
    if (scope.error) {
      return res.status(scope.error.status).json({ success: false, message: scope.error.message });
    }

    const rangeWindow = parseRange(req.query.range);
    logFirmAnalytics('Summary request', {
      actorId: scope.actorId,
      firmId: scope.firmContext.firmId,
      range: rangeWindow.label,
    });

    const rows = await buildFirmUserAnalyticsRows({
      members: scope.members,
      firmId: scope.firmContext.firmId,
      rangeWindow,
    });

    const summary = rows.reduce(
      (acc, row) => {
        acc.totalUsers += 1;
        acc.disabledUsers += row.isActive === false ? 1 : 0;
        acc.blockedUsers += row.isActive === false ? 1 : 0; // legacy alias
        acc.pendingInvites += row.firstLogin ? 1 : 0;
        acc.totalInputTokens += row.usage.inputTokens;
        acc.totalOutputTokens += row.usage.outputTokens;
        acc.totalTokens += row.usage.totalTokens;
        acc.totalCost += row.usage.totalCost;
        acc.totalDocumentsUploaded += row.documentsUploaded;
        acc.totalCasesCreated += row.casesCreated;
        acc.totalAssignedCases += row.assignedCases;
        acc.activeTokenCaps += row.tokenCap.monthlyTokenLimit ? 1 : 0;
        return acc;
      },
      {
        totalUsers: 0,
        disabledUsers: 0,
        blockedUsers: 0,
        pendingInvites: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        totalCost: 0,
        totalDocumentsUploaded: 0,
        totalCasesCreated: 0,
        totalAssignedCases: 0,
        activeTokenCaps: 0,
      }
    );

    logFirmAnalytics('Summary aggregates computed', {
      actorId: scope.actorId,
      firmId: scope.firmContext.firmId,
      range: rangeWindow.label,
      totalUsers: summary.totalUsers,
      totalInputTokens: summary.totalInputTokens,
      totalOutputTokens: summary.totalOutputTokens,
      totalTokens: summary.totalTokens,
      totalCost: summary.totalCost,
      activeTokenCaps: summary.activeTokenCaps,
    });

    return res.status(200).json({
      success: true,
      data: {
        range: rangeWindow.label,
        firmId: scope.firmContext.firmId,
        firmAdminUserId: scope.firmContext.firmAdminUserId,
        summary,
      },
    });
  } catch (error) {
    logFirmAnalyticsError('Error fetching summary', error, {
      actorId: req.user?.id || null,
      actorEmail: req.user?.email || null,
      actorAccountType: req.user?.account_type || null,
      query: req.query,
    });
    return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

exports.getFirmAnalyticsUsers = async (req, res) => {
  try {
    const scope = await requireFirmAdminContext(req);
    if (scope.error) {
      return res.status(scope.error.status).json({ success: false, message: scope.error.message });
    }

    const rangeWindow = parseRange(req.query.range);
    const search = String(req.query.search || '').trim().toLowerCase();
    const sortBy = String(req.query.sortBy || 'tokens_desc');

    logFirmAnalytics('Users request', {
      actorId: scope.actorId,
      firmId: scope.firmContext.firmId,
      range: rangeWindow.label,
      search,
      sortBy,
    });

    const rows = await buildFirmUserAnalyticsRows({
      members: scope.members,
      firmId: scope.firmContext.firmId,
      rangeWindow,
    });

    const filteredRows = rows.filter((row) => {
      if (!search) return true;
      return (
        String(row.username || '').toLowerCase().includes(search)
        || String(row.email || '').toLowerCase().includes(search)
      );
    });

    return res.status(200).json({
      success: true,
      data: {
        range: rangeWindow.label,
        users: sortRows(filteredRows, sortBy),
      },
    });
  } catch (error) {
    logFirmAnalyticsError('Error fetching user rows', error, {
      actorId: req.user?.id || null,
      actorEmail: req.user?.email || null,
      actorAccountType: req.user?.account_type || null,
      query: req.query,
    });
    return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

exports.getFirmAnalyticsUserDetail = async (req, res) => {
  try {
    const scope = await requireFirmAdminContext(req);
    if (scope.error) {
      return res.status(scope.error.status).json({ success: false, message: scope.error.message });
    }

    const targetUserId = Number(req.params.userId);
    if (!targetUserId) {
      return res.status(400).json({ success: false, message: 'Invalid user id.' });
    }

    const member = scope.members.find((candidate) => Number(candidate.user_id) === targetUserId);
    if (!member) {
      return res.status(404).json({ success: false, message: 'User not found in this firm.' });
    }

    const rangeWindow = parseRange(req.query.range);
    logFirmAnalytics('User detail request', {
      actorId: scope.actorId,
      firmId: scope.firmContext.firmId,
      targetUserId,
      range: rangeWindow.label,
    });

    const [rows, endpointResult, modelResult, trendResult, activityResult] = await Promise.all([
      buildFirmUserAnalyticsRows({
        members: [member],
        firmId: scope.firmContext.firmId,
        rangeWindow,
      }),
      pool.query(
        `
          SELECT
            COALESCE(endpoint, 'Unknown') AS endpoint,
            COALESCE(SUM(COALESCE(request_count, 1)), COUNT(*)) AS request_count,
            COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens,
            COALESCE(SUM(total_tokens), 0) AS total_tokens,
            COALESCE(SUM(total_cost), 0) AS total_cost
          FROM public.llm_usage_logs
          WHERE user_id = $1
            AND used_at >= $2
            AND used_at <= $3
          GROUP BY COALESCE(endpoint, 'Unknown')
          ORDER BY total_cost DESC
        `,
        [targetUserId, rangeWindow.startDate, rangeWindow.endDate]
      ),
      pool.query(
        `
          SELECT
            COALESCE(model_name, 'Unknown') AS model_name,
            COALESCE(SUM(COALESCE(request_count, 1)), COUNT(*)) AS request_count,
            COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens,
            COALESCE(SUM(total_tokens), 0) AS total_tokens,
            COALESCE(SUM(total_cost), 0) AS total_cost
          FROM public.llm_usage_logs
          WHERE user_id = $1
            AND used_at >= $2
            AND used_at <= $3
          GROUP BY COALESCE(model_name, 'Unknown')
          ORDER BY total_cost DESC
        `,
        [targetUserId, rangeWindow.startDate, rangeWindow.endDate]
      ),
      pool.query(
        `
          SELECT
            DATE(used_at) AS used_day,
            COALESCE(SUM(COALESCE(request_count, 1)), COUNT(*)) AS request_count,
            COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens,
            COALESCE(SUM(total_tokens), 0) AS total_tokens,
            COALESCE(SUM(total_cost), 0) AS total_cost
          FROM public.llm_usage_logs
          WHERE user_id = $1
            AND used_at >= $2
            AND used_at <= $3
          GROUP BY DATE(used_at)
          ORDER BY used_day ASC
        `,
        [targetUserId, rangeWindow.startDate, rangeWindow.endDate]
      ),
      pool.query(
        `
          WITH daily_windows AS (
            SELECT
              DATE(used_at) AS used_day,
              GREATEST(
                ROUND(EXTRACT(EPOCH FROM (MAX(used_at) - MIN(used_at))) / 60.0),
                1
              ) AS active_minutes
            FROM public.llm_usage_logs
            WHERE user_id = $1
              AND used_at >= $2
              AND used_at <= $3
            GROUP BY DATE(used_at)
          )
          SELECT
            COALESCE(ROUND(AVG(active_minutes)), 0) AS avg_active_minutes,
            COALESCE(MAX(active_minutes), 0) AS peak_active_minutes,
            COALESCE(COUNT(*), 0) AS active_days
          FROM daily_windows
        `,
        [targetUserId, rangeWindow.startDate, rangeWindow.endDate]
      ),
    ]);

    const activityMetrics = {
      averageActiveMinutes: toInt(activityResult.rows?.[0]?.avg_active_minutes),
      peakActiveMinutes: toInt(activityResult.rows?.[0]?.peak_active_minutes),
      activeDays: toInt(activityResult.rows?.[0]?.active_days),
    };

    logFirmAnalytics('Detail aggregates prepared', {
      actorId: scope.actorId,
      firmId: scope.firmContext.firmId,
      targetUserId,
      range: rangeWindow.label,
      hasUserRow: !!rows[0],
      endpointRows: endpointResult.rows?.length || 0,
      modelRows: modelResult.rows?.length || 0,
      trendRows: trendResult.rows?.length || 0,
      activityMetrics,
      totalInputTokens: rows[0]?.usage?.inputTokens || 0,
      totalOutputTokens: rows[0]?.usage?.outputTokens || 0,
      totalTokens: rows[0]?.usage?.totalTokens || 0,
    });

    return res.status(200).json({
      success: true,
      data: {
        range: rangeWindow.label,
        user: {
          ...(rows[0] || {}),
          activityMetrics,
        },
        byEndpoint: (endpointResult.rows || []).map((row) => ({
          endpoint: row.endpoint,
          requestCount: toInt(row.request_count),
          inputTokens: toInt(row.input_tokens),
          outputTokens: toInt(row.output_tokens),
          totalTokens: toInt(row.total_tokens),
          totalCost: toFloat(row.total_cost),
        })),
        byModel: (modelResult.rows || []).map((row) => ({
          modelName: row.model_name,
          requestCount: toInt(row.request_count),
          inputTokens: toInt(row.input_tokens),
          outputTokens: toInt(row.output_tokens),
          totalTokens: toInt(row.total_tokens),
          totalCost: toFloat(row.total_cost),
        })),
        usageTrend: (trendResult.rows || []).map((row) => ({
          day: row.used_day,
          requestCount: toInt(row.request_count),
          inputTokens: toInt(row.input_tokens),
          outputTokens: toInt(row.output_tokens),
          totalTokens: toInt(row.total_tokens),
          totalCost: toFloat(row.total_cost),
        })),
      },
    });
  } catch (error) {
    logFirmAnalyticsError('Error fetching user detail', error, {
      actorId: req.user?.id || null,
      actorEmail: req.user?.email || null,
      actorAccountType: req.user?.account_type || null,
      targetUserId: req.params.userId,
      query: req.query,
    });
    return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

exports.updateFirmUserTokenLimit = async (req, res) => {
  try {
    const scope = await requireFirmAdminContext(req);
    if (scope.error) {
      return res.status(scope.error.status).json({ success: false, message: scope.error.message });
    }

    const targetUserId = Number(req.params.userId);
    if (!targetUserId) {
      return res.status(400).json({ success: false, message: 'Invalid user id.' });
    }

    if (Number(scope.firmContext.firmAdminUserId) === targetUserId) {
      return res.status(403).json({ success: false, message: 'Firm admin token caps cannot be edited here.' });
    }

    const member = scope.members.find((candidate) => Number(candidate.user_id) === targetUserId);
    if (!member) {
      return res.status(404).json({ success: false, message: 'User not found in this firm.' });
    }

    const { monthlyTokenLimit = null, hardStopEnabled = true } = req.body || {};
    const normalizedLimit = monthlyTokenLimit === null || monthlyTokenLimit === '' ? null : Number(monthlyTokenLimit);
    if (normalizedLimit !== null && (!Number.isFinite(normalizedLimit) || normalizedLimit < 0)) {
      return res.status(400).json({ success: false, message: 'monthlyTokenLimit must be a positive number or null.' });
    }

    logFirmAnalytics('Update token cap request', {
      actorId: scope.actorId,
      firmId: scope.firmContext.firmId,
      targetUserId,
      normalizedLimit,
      hardStopEnabled: hardStopEnabled !== false,
    });

    const result = await pool.query(
      `
        INSERT INTO firm_user_token_limits (
          firm_id,
          user_id,
          monthly_token_limit,
          hard_stop_enabled,
          updated_by,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        ON CONFLICT (firm_id, user_id)
        DO UPDATE SET
          monthly_token_limit = EXCLUDED.monthly_token_limit,
          hard_stop_enabled = EXCLUDED.hard_stop_enabled,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
        RETURNING *
      `,
      [
        scope.firmContext.firmId,
        targetUserId,
        normalizedLimit,
        hardStopEnabled !== false,
        scope.actorId,
      ]
    );

    const currentMonthUsage = await getCurrentMonthUsageMap([targetUserId]);
    const capStatus = buildCapStatus(
      {
        monthlyTokenLimit: normalizedLimit,
        hardStopEnabled: hardStopEnabled !== false,
      },
      currentMonthUsage.get(targetUserId) || {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      }
    );

    return res.status(200).json({
      success: true,
      data: {
        ...result.rows[0],
        tokenCap: capStatus,
      },
    });
  } catch (error) {
    logFirmAnalyticsError('Error updating token limit', error, {
      actorId: req.user?.id || null,
      actorEmail: req.user?.email || null,
      actorAccountType: req.user?.account_type || null,
      targetUserId: req.params.userId,
      body: req.body,
    });
    return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};

exports.checkFirmUserTokenLimit = async (req, res) => {
  try {
    const userId = Number(req.body?.userId);
    const requestedTokens = Math.max(0, Number(req.body?.requestedTokens || 0));

    logFirmAnalytics('Token cap enforcement request', {
      userId,
      requestedTokens,
    });

    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required.' });
    }

    const firmContext = await fetchFirmContext(userId);
    const accountType = String(firmContext?.accountType || '').toUpperCase();
    if (!firmContext?.firmId || accountType !== 'FIRM_USER') {
      return res.status(200).json({
        success: true,
        data: {
          allowed: true,
          enforced: false,
          reason: 'not_firm_user',
        },
      });
    }

    const limitResult = await pool.query(
      `
        SELECT monthly_token_limit, hard_stop_enabled
        FROM firm_user_token_limits
        WHERE firm_id = $1
          AND user_id = $2
        LIMIT 1
      `,
      [firmContext.firmId, userId]
    );

    const limitRow = limitResult.rows[0];
    if (!limitRow || limitRow.monthly_token_limit === null) {
      return res.status(200).json({
        success: true,
        data: {
          allowed: true,
          enforced: false,
          reason: 'no_cap',
        },
      });
    }

    const { startDate, endDate } = getCurrentMonthWindow();
    const usageResult = await pool.query(
      `
        SELECT
          COALESCE(SUM(input_tokens), 0) AS input_tokens,
          COALESCE(SUM(output_tokens), 0) AS output_tokens,
          COALESCE(SUM(total_tokens), 0) AS total_tokens
        FROM public.llm_usage_logs
        WHERE user_id = $1
          AND used_at >= $2
          AND used_at <= $3
      `,
      [userId, startDate, endDate]
    );

    const usedThisMonth = {
      inputTokens: toInt(usageResult.rows[0]?.input_tokens),
      outputTokens: toInt(usageResult.rows[0]?.output_tokens),
      totalTokens: toInt(usageResult.rows[0]?.total_tokens),
    };
    const monthlyTokenLimit = toInt(limitRow.monthly_token_limit);
    const hardStopEnabled = limitRow.hard_stop_enabled !== false;
    const projectedUsage = usedThisMonth.totalTokens + requestedTokens;
    const exceeded = projectedUsage > monthlyTokenLimit;

    return res.status(200).json({
      success: true,
      data: {
        allowed: !hardStopEnabled || !exceeded,
        enforced: true,
        reason: exceeded ? 'cap_exceeded' : 'within_limit',
        monthlyTokenLimit,
        hardStopEnabled,
        currentMonthInputTokensUsed: usedThisMonth.inputTokens,
        currentMonthOutputTokensUsed: usedThisMonth.outputTokens,
        currentMonthTokensUsed: usedThisMonth.totalTokens,
        requestedTokens,
        projectedUsage,
        remainingThisMonth: Math.max(0, monthlyTokenLimit - usedThisMonth.totalTokens),
      },
    });
  } catch (error) {
    logFirmAnalyticsError('Error checking firm token cap', error, {
      body: req.body,
    });
    return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
};
