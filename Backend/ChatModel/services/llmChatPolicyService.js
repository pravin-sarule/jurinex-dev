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
const pdfParse = require('pdf-parse');

/** 0 or NaN = unlimited for rate limits */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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

async function getUserDailyTokenSum(userId) {
  const { rows } = await pool.query(`
    SELECT COALESCE(SUM(total_tokens), 0)::bigint AS s
    FROM public.llm_usage_logs
    WHERE user_id = $1
      AND used_at > now() - interval '24 hours'
  `, [userId]);
  return Number(rows[0]?.s || 0);
}

async function getUserRecentCounts(userId) {
  const uid = userId;
  const [perMinute, perHour, perDay] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS c FROM public.llm_usage_logs
       WHERE user_id = $1 AND used_at > now() - interval '1 minute'`,
      [uid]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS c FROM public.llm_usage_logs
       WHERE user_id = $1 AND used_at > now() - interval '1 hour'`,
      [uid]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS c FROM public.llm_usage_logs
       WHERE user_id = $1 AND used_at > now() - interval '24 hours'`,
      [uid]
    ),
  ]);
  return {
    perMinute: perMinute.rows[0]?.c ?? 0,
    perHour: perHour.rows[0]?.c ?? 0,
    perDay: perDay.rows[0]?.c ?? 0,
  };
}

/**
 * @returns {{ ok: true } | { ok: false, code: string, message: string, details?: object }}
 */
async function assertChatAllowed(userId, llmConfig) {
  const perUserTokenCap = Math.max(0, Math.floor(num(llmConfig.total_tokens_per_day)));
  const perMin = Math.max(0, Math.floor(num(llmConfig.quota_chats_per_minute)));
  const perHour = Math.max(0, Math.floor(num(llmConfig.messages_per_hour)));
  const perDay = Math.max(0, Math.floor(num(llmConfig.chats_per_day)));

  let userTokens24h;
  let counts;
  try {
    userTokens24h = await getUserDailyTokenSum(userId);
    counts = await getUserRecentCounts(userId);
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

  const nextResetUtc = getNextUtcMidnightIsoString();

  if (perUserTokenCap > 0) {
    console.log(
      `[LLM Policy] Per-user tokens (rolling 24h): user=${userId}, used=${userTokens24h} / cap=${perUserTokenCap}`
    );
  }

  if (perUserTokenCap > 0 && userTokens24h >= perUserTokenCap) {
    return {
      ok: false,
      code: 'RATE_LIMIT_TOTAL_TOKENS_PER_DAY',
      message:
        'Your token budget for the last 24 hours has been reached. Try again after older usage rolls out of the window.',
      details: {
        used_tokens_last_24h: userTokens24h,
        limit: perUserTokenCap,
        next_reset_utc: nextResetUtc,
        reset_basis: 'rolling_24h_per_user_tokens',
        note:
          'Sum of total_tokens in llm_usage_logs for this user over the rolling last 24 hours. Increase total_tokens_per_day in llm_chat_config or wait for usage to age out.',
      },
    };
  }

  if (perMin > 0 && counts.perMinute >= perMin) {
    return {
      ok: false,
      code: 'RATE_LIMIT_PER_MINUTE',
      message: 'Too many chat requests. Please wait a minute and try again.',
      details: { limit_per_minute: perMin, used_last_minute: counts.perMinute },
    };
  }

  if (perHour > 0 && counts.perHour >= perHour) {
    return {
      ok: false,
      code: 'RATE_LIMIT_MESSAGES_PER_HOUR',
      message: 'Your hourly message quota has been reached. Try again later.',
      details: { limit_per_hour: perHour, used_last_hour: counts.perHour },
    };
  }

  if (perDay > 0 && counts.perDay >= perDay) {
    return {
      ok: false,
      code: 'RATE_LIMIT_CHATS_PER_DAY',
      message:
        'Your chat quota for the last 24 hours has been reached (all sessions combined). Try again later.',
      details: {
        limit_per_24h: perDay,
        used_last_24h: counts.perDay,
        reset_basis: 'rolling_24h_per_user',
        note: 'Counted from llm_usage_logs for this user over the rolling last 24 hours, not per session.',
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
  getUserDailyTokenSum,
  getUserRecentCounts,
  getUserUploadCountToday,
  getNextUtcMidnightIsoString,
};
