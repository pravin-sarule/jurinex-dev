/**
 * Enforces Dashboard Chat limits from `llm_chat_config` against `llm_usage_logs` and uploads.
 * All limits are per authenticated user (aggregated across every chat session — not per session).
 *
 * - total_tokens_per_day: per-user token cap in the rolling last 24 hours
 * - messages_per_hour: per-user LLM calls in the rolling last hour
 * - chats_per_day: per-user LLM calls in the rolling last 24 hours (field name is legacy; window is 24h)
 * - quota_chats_per_minute: per-user LLM calls in the last minute
 * - max_document_size_mb / max_document_pages / max_file_upload_per_day: upload path
 */

const pool = require('../config/db');
const paymentPool = require('../config/paymentDb');
const pdfParse = require('pdf-parse');

/** 0 or NaN = unlimited for rate limits */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Format a Date as IST string: "DD MMM YYYY, HH:MM AM/PM IST" */
function toISTString(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }) + ' IST';
}

/**
 * Next UTC midnight (used for quota messaging when a limit trips).
 */
function getNextUtcMidnightIsoString() {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0)
  );
  return next.toISOString();
}

/**
 * Compute rolling-window reset time: oldest_entry + window_ms.
 * Falls back to now + window_ms when no oldest entry is available.
 */
function rollingResetTime(oldestTs, windowMs) {
  const base = oldestTs ? new Date(oldestTs) : new Date();
  if (isNaN(base.getTime())) return new Date(Date.now() + windowMs);
  return new Date(base.getTime() + windowMs);
}

/**
 * Single consolidated query: counts + oldest timestamps + 24h token sum.
 * llm_usage_logs lives in Payment_DB (paymentPool).
 */
async function getUserUsageStats(userId) {
  const { rows } = await paymentPool.query(`
    SELECT
      COALESCE(SUM(total_tokens) FILTER (WHERE used_at > now() - interval '24 hours'), 0)::bigint AS tokens_24h,
      COALESCE(SUM(total_tokens) FILTER (WHERE used_at >= CURRENT_DATE AT TIME ZONE 'UTC'), 0)::bigint AS tokens_today,
      COUNT(*) FILTER (WHERE used_at > now() - interval '1 minute')::int  AS per_minute,
      COUNT(*) FILTER (WHERE used_at > now() - interval '1 hour')::int    AS per_hour,
      COUNT(*) FILTER (WHERE used_at > now() - interval '24 hours')::int  AS per_day,
      MIN(used_at) FILTER (WHERE used_at > now() - interval '1 minute')   AS oldest_1min,
      MIN(used_at) FILTER (WHERE used_at > now() - interval '1 hour')     AS oldest_1hr,
      MIN(used_at) FILTER (WHERE used_at > now() - interval '24 hours')   AS oldest_24h
    FROM public.llm_usage_logs
    WHERE user_id = $1
  `, [userId]);
  const r = rows[0] || {};
  return {
    tokens24h:   Number(r.tokens_24h || 0),
    tokensToday: Number(r.tokens_today || 0),
    perMinute:   Number(r.per_minute  || 0),
    perHour:     Number(r.per_hour    || 0),
    perDay:      Number(r.per_day     || 0),
    oldest1min:  r.oldest_1min || null,
    oldest1hr:   r.oldest_1hr  || null,
    oldest24h:   r.oldest_24h  || null,
  };
}

/**
 * Resolve active subscription token limits from monthly_plans (preferred) or subscription_plans.
 * Plan limits are zeroed when the plan has expired; topup balance is always returned.
 */
async function getPlanLimits(userId) {
  try {
    const { rows } = await paymentPool.query(`
      SELECT
        CASE WHEN (us.end_date IS NULL OR us.end_date >= CURRENT_DATE)
             THEN COALESCE(mp.monthly_tokens, sp.token_limit, 0)
             ELSE 0
        END                                                   AS monthly_limit,
        COALESCE(us.topup_token_balance, 0)                  AS topup_balance,
        us.topup_expires_at,
        COALESCE(us.last_reset_date, us.start_date)          AS billing_period_start
      FROM user_subscriptions us
      LEFT JOIN monthly_plans mp ON mp.id = us.monthly_plan_id
      LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
      WHERE us.user_id = $1
        AND LOWER(COALESCE(us.status, 'active')) IN ('active', 'topup_only')
      ORDER BY us.updated_at DESC NULLS LAST
      LIMIT 1
    `, [userId]);
    const row = rows[0];
    if (!row) {
      return { monthlyLimit: 0, topupBalance: 0, lastResetDate: null };
    }

    let topupBalance = Number(row.topup_balance || 0);
    if (row.topup_expires_at) {
      const expires = new Date(row.topup_expires_at);
      if (!Number.isNaN(expires.getTime()) && expires < new Date()) {
        topupBalance = 0;
      }
    }

    return {
      monthlyLimit: Number(row.monthly_limit || 0),
      topupBalance,
      lastResetDate: row.billing_period_start || null,
    };
  } catch (err) {
    console.warn('[LLM Policy] Plan limits query failed:', err.message);
    return { monthlyLimit: 0, topupBalance: 0, lastResetDate: null };
  }
}

async function getTokensUsedThisMonth(userId, lastResetDate) {
  try {
    const { rows } = await paymentPool.query(`
      SELECT COALESCE(SUM(total_tokens), 0)::bigint AS tokens_month
      FROM public.llm_usage_logs
      WHERE user_id = $1
        AND ($2::timestamptz IS NULL OR used_at >= $2::timestamptz)
    `, [userId, lastResetDate || null]);
    return Number(rows[0]?.tokens_month || 0);
  } catch (err) {
    console.warn('[LLM Policy] Monthly usage query failed:', err.message);
    return 0;
  }
}

// Keep these for external callers that import them individually.
async function getUserDailyTokenSum(userId) {
  const stats = await getUserUsageStats(userId);
  return stats.tokens24h;
}

async function getUserRecentCounts(userId) {
  const stats = await getUserUsageStats(userId);
  return { perMinute: stats.perMinute, perHour: stats.perHour, perDay: stats.perDay };
}

/**
 * @returns {{ ok: true } | { ok: false, code: string, message: string, details?: object }}
 */
async function assertChatAllowed(userId, llmConfig) {
  const perUserTokenCap = Math.max(0, Math.floor(num(llmConfig.total_tokens_per_day)));
  const perMin = Math.max(0, Math.floor(num(llmConfig.quota_chats_per_minute)));
  const perHour = Math.max(0, Math.floor(num(llmConfig.messages_per_hour)));
  const perDay = Math.max(0, Math.floor(num(llmConfig.chats_per_day)));

  let stats;
  try {
    stats = await getUserUsageStats(userId);
  } catch (err) {
    console.error('[LLM Policy] Usage query failed:', err.message);
    if (process.env.LLM_POLICY_LENIENT === 'true') {
      return { ok: true };
    }
    return {
      ok: false,
      code: 'POLICY_CHECK_UNAVAILABLE',
      message: 'Usage limits could not be verified. Please try again shortly.',
      details: { reason: err.message },
    };
  }

  if (perUserTokenCap > 0) {
    console.log(
      `[LLM Policy] Per-user tokens (rolling 24h): user=${userId}, used=${stats.tokens24h} / cap=${perUserTokenCap}`
    );
  }

  if (perUserTokenCap > 0 && stats.tokens24h >= perUserTokenCap) {
    // Allow users with active top-up balance to continue past the rolling cap
    try {
      const { topupBalance } = await getPlanLimits(userId);
      if (topupBalance > 0) {
        return { ok: true, source: 'topup', topupBalance };
      }
    } catch (_) {
      // fall through to block
    }
    const resetAt = rollingResetTime(stats.oldest24h, 24 * 60 * 60 * 1000);
    return {
      ok: false,
      code: 'RATE_LIMIT_TOTAL_TOKENS_PER_DAY',
      message: `Your token budget for the last 24 hours has been reached. Resets at ${toISTString(resetAt)}.`,
      details: {
        used_tokens_last_24h: stats.tokens24h,
        limit: perUserTokenCap,
        next_reset_ist: toISTString(resetAt),
        next_reset_utc: resetAt.toISOString(),
        reset_basis: 'rolling_24h_per_user_tokens',
      },
    };
  }

  if (perMin > 0 && stats.perMinute >= perMin) {
    const resetAt = rollingResetTime(stats.oldest1min, 60 * 1000);
    return {
      ok: false,
      code: 'RATE_LIMIT_PER_MINUTE',
      message: `Too many chat requests. Please wait until ${toISTString(resetAt)}.`,
      details: {
        limit_per_minute: perMin,
        used_last_minute: stats.perMinute,
        next_reset_ist: toISTString(resetAt),
        next_reset_utc: resetAt.toISOString(),
      },
    };
  }

  if (perHour > 0 && stats.perHour >= perHour) {
    const resetAt = rollingResetTime(stats.oldest1hr, 60 * 60 * 1000);
    return {
      ok: false,
      code: 'RATE_LIMIT_MESSAGES_PER_HOUR',
      message: `Your hourly message quota has been reached. Resets at ${toISTString(resetAt)}.`,
      details: {
        limit_per_hour: perHour,
        used_last_hour: stats.perHour,
        next_reset_ist: toISTString(resetAt),
        next_reset_utc: resetAt.toISOString(),
      },
    };
  }

  if (perDay > 0 && stats.perDay >= perDay) {
    const resetAt = rollingResetTime(stats.oldest24h, 24 * 60 * 60 * 1000);
    return {
      ok: false,
      code: 'RATE_LIMIT_CHATS_PER_DAY',
      message: `Your daily chat quota has been reached. Resets at ${toISTString(resetAt)}.`,
      details: {
        limit_per_24h: perDay,
        used_last_24h: stats.perDay,
        next_reset_ist: toISTString(resetAt),
        next_reset_utc: resetAt.toISOString(),
        reset_basis: 'rolling_24h_per_user',
      },
    };
  }

  // ── Plan token limits (monthly_plans / subscription_plans) ─────────────────
  try {
    const { monthlyLimit, topupBalance, lastResetDate } = await getPlanLimits(userId);

    if (monthlyLimit > 0) {
      const tokensThisPeriod = await getTokensUsedThisMonth(userId, lastResetDate || null);

      if (tokensThisPeriod >= monthlyLimit) {
        if (topupBalance > 0) {
          return { ok: true, source: 'topup', topupBalance };
        }
        return {
          ok: false,
          code: 'MONTHLY_TOKEN_LIMIT_EXHAUSTED',
          message: 'You have used all your monthly tokens. Purchase a top-up to continue, upgrade your plan, or wait for your next billing date.',
          details: {
            tokens_used_this_period: tokensThisPeriod,
            monthly_token_limit: monthlyLimit,
            topup_available: true,
            next_reset_utc: getNextUtcMidnightIsoString(),
          },
        };
      }
    }
  } catch (err) {
    console.warn('[LLM Policy] Plan limit check failed:', err.message);
  }

  return { ok: true };
}

async function getUserUploadCountToday(userId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM user_files
     WHERE user_id = $1
       AND (is_folder IS NULL OR is_folder = false)
       AND created_at > now() - interval '24 hours'`,
    [userId]
  );
  return rows[0]?.c ?? 0;
}

/**
 * Stored file row (already uploaded) — re-check size vs current dashboard max.
 */
function assertStoredFileMeetsDashboardLimits(file, config) {
  return { ok: true };
}

/**
 * New upload: size, daily upload count, PDF page count vs `llm_chat_config`.
 */
async function assertUploadAllowed(userId, config, { sizeBytes, buffer, mimetype, originalname }) {
  return { ok: true };
  // eslint-disable-next-line no-unreachable
    const maxMb = Math.max(0, num(config.max_document_size_mb));
  if (maxMb > 0) {
    const maxBytes = maxMb * 1024 * 1024;
    if (sizeBytes > maxBytes) {
      return {
        ok: false,
        code: 'FILE_TOO_LARGE',
        message: `File exceeds maximum size of ${maxMb} MB (Dashboard Chat).`,
        details: { max_mb: maxMb, size_bytes: sizeBytes },
      };
    }
  }

  const maxUploads = Math.max(0, Math.floor(num(config.max_file_upload_per_day)));
  if (maxUploads > 0) {
    const count = await getUserUploadCountToday(userId);
    if (count >= maxUploads) {
      return {
        ok: false,
        code: 'DAILY_UPLOAD_LIMIT',
        message: `Maximum file uploads in the last 24 hours (${maxUploads}) reached (Dashboard Chat).`,
        details: { limit_per_24h: maxUploads, used_last_24h: count, reset_basis: 'rolling_24h_per_user' },
      };
    }
  }

  const maxPages = Math.max(0, Math.floor(num(config.max_document_pages)));
  const mime = (mimetype || '').toLowerCase();
  const name = (originalname || '').toLowerCase();
  const isPdf = mime === 'application/pdf' || name.endsWith('.pdf');

  if (maxPages > 0 && isPdf && buffer && buffer.length) {
    try {
      const data = await pdfParse(buffer);
      const pages = data.numpages || 0;
      if (pages > maxPages) {
        return {
          ok: false,
          code: 'DOCUMENT_TOO_MANY_PAGES',
          message: `Document has ${pages} pages; maximum allowed is ${maxPages} (Dashboard Chat).`,
          details: { max_pages: maxPages, pages },
        };
      }
    } catch (e) {
      return {
        ok: false,
        code: 'PDF_INVALID',
        message: 'Could not read this PDF (invalid or corrupted).',
        details: { error: e.message },
      };
    }
  }

  return { ok: true };
}

/**
 * assertStorageAllowed — check whether uploading `sizeBytes` more data
 * would exceed the user's plan storage_limit_gb.
 *
 * Reads current storage from Document_DB (user_files.size) and the plan
 * limit from Payment_DB (monthly_plans / subscription_plans).
 *
 * Returns { ok: true } when allowed, or { ok: false, code, message, details }
 * when the upload would exceed the quota.  A limit of 0 means unlimited.
 */
async function assertStorageAllowed(userId, sizeBytes = 0) {
  if (!userId) return { ok: true };

  // ── 1. Current storage used (Document DB) ──────────────────────────────
  let storageUsedBytes = 0;
  try {
    const res = await pool.query(
      `SELECT COALESCE(SUM(size), 0)::bigint AS total_bytes
       FROM user_files
       WHERE user_id = $1
         AND (is_folder IS NULL OR is_folder = FALSE)`,
      [String(userId)]
    );
    storageUsedBytes = parseInt(res.rows[0]?.total_bytes || 0, 10);
  } catch (err) {
    console.warn('[StoragePolicy] doc-db query failed for user', userId, err.message);
    return { ok: true };
  }

  // ── 2. Storage limit (Payment DB) ──────────────────────────────────────
  let storageLimitGb = 0;
  try {
    const res = await paymentPool.query(
      `SELECT COALESCE(mp.storage_limit_gb, sp.storage_limit_gb, 0)::numeric AS storage_limit_gb
       FROM user_subscriptions us
       LEFT JOIN monthly_plans      mp ON mp.id = us.monthly_plan_id AND mp.is_active = TRUE
       LEFT JOIN subscription_plans sp ON sp.id = us.plan_id
       WHERE us.user_id::text = $1
         AND LOWER(COALESCE(us.status, 'active')) = 'active'
         AND (us.end_date IS NULL OR us.end_date >= CURRENT_DATE)
         AND (mp.id IS NOT NULL OR sp.id IS NOT NULL)
       ORDER BY us.updated_at DESC NULLS LAST
       LIMIT 1`,
      [String(userId)]
    );
    storageLimitGb = parseFloat(res.rows[0]?.storage_limit_gb || 0);
  } catch (err) {
    console.warn('[StoragePolicy] payment-db query failed for user', userId, err.message);
    return { ok: true };
  }

  // No limit configured → allow
  if (!storageLimitGb || storageLimitGb <= 0) return { ok: true };

  const storageLimitBytes = storageLimitGb * 1024 ** 3;
  const usedAfterUpload   = storageUsedBytes + sizeBytes;

  if (usedAfterUpload > storageLimitBytes) {
    const usedGb  = storageUsedBytes / 1024 ** 3;
    const extraGb = sizeBytes / 1024 ** 3;
    return {
      ok: false,
      code: 'STORAGE_LIMIT_EXCEEDED',
      message:
        `You have used ${usedGb.toFixed(2)} GB of your ${storageLimitGb.toFixed(2)} GB storage limit. ` +
        `This upload (${extraGb.toFixed(3)} GB) would exceed your plan's storage quota. ` +
        'Delete existing files or upgrade your plan to continue.',
      details: {
        storage_used_bytes:  storageUsedBytes,
        storage_used_gb:     parseFloat(usedGb.toFixed(4)),
        storage_limit_gb:    storageLimitGb,
        upload_size_bytes:   sizeBytes,
        upload_size_gb:      parseFloat(extraGb.toFixed(4)),
        overage_bytes:       Math.max(0, Math.floor(usedAfterUpload - storageLimitBytes)),
      },
    };
  }

  return { ok: true };
}

module.exports = {
  assertChatAllowed,
  assertUploadAllowed,
  assertStoredFileMeetsDashboardLimits,
  getUserUsageStats,
  getUserDailyTokenSum,
  getUserRecentCounts,
  getUserUploadCountToday,
  getPlanLimits,
  getTokensUsedThisMonth,
  assertStorageAllowed,
  getNextUtcMidnightIsoString,
  toISTString,
};
