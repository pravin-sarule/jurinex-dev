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
  const raw = error?.response?.data || {};
  const data = (raw && typeof raw === 'object' && raw.detail && typeof raw.detail === 'object')
    ? raw.detail
    : raw;
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
  if (code === 'POLICY_CHECK_UNAVAILABLE') {
    return {
      title: 'Please try again',
      body:
        (typeof data.message === 'string' && data.message.trim()) ||
        "We couldn't verify usage limits right now. Please try again in a moment.",
      isLimit: false,
      limitType: 'unknown',
    };
  }
  return null;
}

/**
 * Plain string for folder intelligent-chat / agentic policy errors (429/503 JSON body).
 * Matches ChatModel-style { code, message, details } from LLMChatPolicyMiddleware.
 * @param {number} status - HTTP status
 * @param {object} [body] - Parsed JSON response body
 * @returns {string}
 */
export function getLlmPolicyErrorUserText(status, body) {
  const data = (body && typeof body === 'object' && body.detail && typeof body.detail === 'object')
    ? body.detail
    : body;
  if (data && typeof data === 'object') {
    const quota = getChatModelQuotaUserMessage({
      response: { data },
      code: data.code,
      details: data.details,
    });
    if (quota?.body) return quota.body;
    if (typeof data.message === 'string' && data.message.trim()) return data.message.trim();
    if (typeof data.error === 'string' && data.error.trim()) return data.error.trim();
  }
  if (status === 429) {
    return "You've reached a usage limit (too many messages or chats in this period). Please wait a bit and try again.";
  }
  if (status === 503) {
    return "The service couldn't verify your usage limits. Please try again shortly.";
  }
  return '';
}

/** Extract a plain string from an error value (handles both string and { title, body } objects). */
export function errorToString(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err.body) return err.body;
  return String(err);
}

/** Generic non-quota error card (same shape as quota messages for shared UI). */
export function stringToChatErrorDisplay(body, title = 'Something went wrong') {
  const b = typeof body === 'string' ? body : String(body ?? '');
  return { title, body: b || 'An error occurred', isLimit: false, limitType: 'unknown' };
}

/**
 * Normalize folder-chat / policy HTTP errors to the same { title, body, isLimit, limitType } shape as ChatModel.
 * @param {number} status
 * @param {object} [body] - Parsed JSON response body
 * @returns {{ title: string, body: string, isLimit: boolean, limitType: string }}
 */
export function parseLlmPolicyErrorForUi(status, body) {
  const data = (body && typeof body === 'object' && body.detail && typeof body.detail === 'object')
    ? body.detail
    : body;
  if (data && typeof data === 'object') {
    const quota = getChatModelQuotaUserMessage({
      response: { data },
      code: data.code,
      details: data.details,
    });
    if (quota) return quota;
  }
  let text = getLlmPolicyErrorUserText(status, data);
  if (!text && data && typeof data === 'object') {
    if (typeof data.message === 'string' && data.message.trim()) text = data.message.trim();
    else if (typeof data.error === 'string' && data.error.trim()) text = data.error.trim();
  }
  if (!text) text = `Something went wrong (${status}).`;

  if (status === 429) {
    return { title: 'Usage limit', body: text, isLimit: true, limitType: 'minute' };
  }
  return stringToChatErrorDisplay(text);
}

/**
 * Accept string or display object (for backward compatibility).
 * @returns {{ title: string, body: string, isLimit: boolean, limitType: string } | null}
 */
export function coerceChatErrorDisplay(input) {
  if (input == null) return null;
  if (typeof input === 'object' && input.body != null && input.title != null) {
    return {
      title: String(input.title),
      body: String(input.body),
      isLimit: !!input.isLimit,
      limitType: input.limitType || 'unknown',
    };
  }
  if (typeof input === 'string') {
    return stringToChatErrorDisplay(input);
  }
  return stringToChatErrorDisplay(String(input));
}

function _unwrapErrorBody(body) {
  if (body && typeof body === 'object' && body.detail && typeof body.detail === 'object') {
    return body.detail;
  }
  return body || {};
}

/**
 * Generic user-friendly message for API/network errors.
 * Distinguishes quota/token failures from file/upload failures.
 */
export function getUserFriendlyApiErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  const status = Number(error?.response?.status || error?.status || 0);
  const body = _unwrapErrorBody(error?.response?.data || {});
  const rawMessage = String(
    body?.message ||
    body?.error ||
    error?.message ||
    ''
  ).trim();

  if (status === 429 || /status code 429/i.test(rawMessage)) {
    return getLlmPolicyErrorUserText(429, body) ||
      "You've reached a usage limit. Please wait a bit and try again.";
  }

  if (status === 413) {
    return 'The file is too large for your current upload limits. Please upload a smaller file.';
  }
  if (status === 415) {
    return 'This file type is not supported. Please upload a supported document format.';
  }
  if (status === 404) {
    return 'The requested file or resource was not found.';
  }

  const m = rawMessage.toLowerCase();
  if (m.includes('token') && (m.includes('limit') || m.includes('quota') || m.includes('exhaust'))) {
    return "Your token limit has been reached. Please try again later or upgrade your plan.";
  }
  if (m.includes('file') || m.includes('upload') || m.includes('document')) {
    return rawMessage || 'There was a problem with the file. Please check the file and try again.';
  }

  return rawMessage || fallback;
}
