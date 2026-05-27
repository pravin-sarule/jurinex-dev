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
    perMinute:   Number(r.per_minute  || 0),
    perHour:     Number(r.per_hour    || 0),
    perDay:      Number(r.per_day     || 0),
    oldest1min:  r.oldest_1min || null,
    oldest1hr:   r.oldest_1hr  || null,
    oldest24h:   r.oldest_24h  || null,
  };
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
  const maxMb = Math.max(0, num(config.max_document_size_mb));
  if (maxMb <= 0) return { ok: true };
  const maxBytes = maxMb * 1024 * 1024;
  const size = Number(file.size) || 0;
  if (size > maxBytes) {
    return {
      ok: false,
      code: 'FILE_EXCEEDS_DASHBOARD_MAX_SIZE',
      message: `This document exceeds the maximum size (${maxMb} MB) allowed in Dashboard Chat.`,
      details: { max_mb: maxMb, size_bytes: size },
    };
  }
  return { ok: true };
}

/**
 * New upload: size, daily upload count, PDF page count vs `llm_chat_config`.
 */
async function assertUploadAllowed(userId, config, { sizeBytes, buffer, mimetype, originalname }) {
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

module.exports = {
  assertChatAllowed,
  assertUploadAllowed,
  assertStoredFileMeetsDashboardLimits,
  getUserUsageStats,
  getUserDailyTokenSum,
  getUserRecentCounts,
  getUserUploadCountToday,
  getNextUtcMidnightIsoString,
  toISTString,
};
