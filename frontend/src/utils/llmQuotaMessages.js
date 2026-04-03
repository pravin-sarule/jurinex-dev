/**
 * LLM quota copy. Per-user chat limits use a rolling 24-hour window (all sessions combined).
 */

const IST_TZ = 'Asia/Kolkata';

export function formatUtcIsoInIST(isoUtc) {
  if (!isoUtc) return '';
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TZ,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

export function buildDailyTokenPoolExceededMessage(details) {
  const ist = formatUtcIsoInIST(details?.next_reset_utc);
  const used = details?.used_tokens_last_24h ?? details?.used_tokens_today;
  const limit = details?.limit;

  let body = "You've used all available tokens for the last 24 hours.";
  if (Number.isFinite(Number(used)) && Number.isFinite(Number(limit))) {
    body += ` Usage: ${Number(used).toLocaleString()} / ${Number(limit).toLocaleString()} tokens.`;
  }
  if (
    details?.reset_basis === 'rolling_24h_global_tokens' ||
    details?.reset_basis === 'rolling_24h_per_user_tokens'
  ) {
    body += ' This is a rolling window — your quota frees up as older usage ages out.';
  } else if (ist) {
    body += ` Resets at ${ist} (IST).`;
  } else {
    body += ' Resets at the next UTC midnight.';
  }
  return { title: 'Token Limit Reached', body, isLimit: true, limitType: 'tokens' };
}

export function buildDailyChatQuotaMessage(details) {
  const ist = formatUtcIsoInIST(details?.next_reset_utc);
  const lim = details?.limit_per_24h ?? details?.limit_per_day;
  const used = details?.used_last_24h ?? details?.used_today;

  let body = "You've reached your daily chat quota.";
  if (Number.isFinite(Number(lim)) && Number.isFinite(Number(used))) {
    body += ` (${used} / ${lim} chats used.)`;
  }
  if (details?.reset_basis === 'rolling_24h_per_user') {
    body += ' This is a rolling 24-hour window.';
  } else if (ist) {
    body += ` Resets at ${ist} (IST).`;
  } else {
    body += ' Resets at the next UTC midnight.';
  }
  return { title: 'Daily Chat Limit Reached', body, isLimit: true, limitType: 'daily' };
}

export function buildPerMinuteQuotaMessage(details) {
  const limit = details?.limit_per_minute;
  const used = details?.used_last_minute;

  let body = "You've sent too many chats in a short time.";
  if (Number.isFinite(Number(limit)) && Number.isFinite(Number(used))) {
    body += ` (${used} / ${limit} per minute.)`;
  }
  body += ' Please wait a moment and try again.';
  return { title: 'Slow Down a Bit', body, isLimit: true, limitType: 'minute' };
}

export function buildPerHourQuotaMessage(details) {
  const limit = details?.limit_per_hour;
  const used = details?.used_last_hour;

  let body = "You've reached the hourly message limit for your account.";
  if (Number.isFinite(Number(limit)) && Number.isFinite(Number(used))) {
    body += ` (${used} / ${limit} messages this hour.)`;
  }
  body += ' Please try again later.';
  return { title: 'Hourly Limit Reached', body, isLimit: true, limitType: 'hour' };
}

/**
 * Map ChatModel API errors to a user-facing { title, body, isLimit } object, or null if not a quota error.
 * @param {Error & { code?: string, details?: object, response?: { data?: object } }} error
 * @returns {{ title: string, body: string, isLimit: true, limitType: string } | null}
 */
export function getChatModelQuotaUserMessage(error) {
  const data = error?.response?.data || {};
  const code = error?.code || data.code;
  const details = error?.details ?? data.details;

  if (code === 'DAILY_GLOBAL_TOKEN_POOL_EXHAUSTED' || code === 'RATE_LIMIT_TOTAL_TOKENS_PER_DAY') {
    return buildDailyTokenPoolExceededMessage(details);
  }
  if (code === 'RATE_LIMIT_CHATS_PER_DAY') {
    return buildDailyChatQuotaMessage(details);
  }
  if (code === 'RATE_LIMIT_PER_MINUTE') {
    return buildPerMinuteQuotaMessage(details);
  }
  if (code === 'RATE_LIMIT_MESSAGES_PER_HOUR') {
    return buildPerHourQuotaMessage(details);
  }
  return null;
}

/** Extract a plain string from an error value (handles both string and { title, body } objects). */
export function errorToString(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err.body) return err.body;
  return String(err);
}
