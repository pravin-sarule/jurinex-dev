import { convertJsonToPlainText } from './jsonToPlainText';
import { isStructuredJsonResponse, renderSecretPromptResponse } from './renderSecretPromptResponse';

const BOX_CHARS = /[┌└├┤┬┴┼│─]/;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extractBoxInnerLines(block) {
  const lines = [];
  const parts = String(block).split('│');
  parts.forEach((part) => {
    const cleaned = part.replace(/[┌└├┤┬┴┼─]/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned && !/^[-─\s]+$/.test(cleaned)) {
      lines.push(cleaned);
    }
  });
  if (lines.length > 0) return lines;

  String(block)
    .split(/\n/)
    .forEach((line) => {
      const cleaned = line.replace(/[┌└├┤┬┴┼│─]/g, '').trim();
      if (cleaned) lines.push(cleaned);
    });
  return lines;
}

function renderLegalBannerHtml(innerLines) {
  if (!innerLines.length) return '';
  const title = innerLines[0];
  const meta = innerLines.slice(1).join(' · ');
  const metaHtml = meta
    ? `<div class="legal-response-banner__meta">${escapeHtml(meta)}</div>`
    : '';
  return (
    `<div class="legal-response-banner">` +
    `<div class="legal-response-banner__title">${escapeHtml(title)}</div>` +
    metaHtml +
    `</div>`
  );
}

function convertAsciiLegalBoxes(text) {
  if (!text || typeof text !== 'string' || !BOX_CHARS.test(text)) {
    return text;
  }

  let result = text;

  result = result.replace(/┌[\s─]+┐[\s\S]*?└[\s─]+┘/g, (block) => {
    const inner = extractBoxInnerLines(block);
    return inner.length ? renderLegalBannerHtml(inner) : block;
  });

  result = result.replace(/┌[\s─]+┐\s*((?:│[^┌└]+│\s*)+)\s*└[\s─]+┘/g, (block) => {
    const inner = extractBoxInnerLines(block);
    return inner.length ? renderLegalBannerHtml(inner) : block;
  });

  return result;
}

function cleanupBoxDebris(text) {
  return String(text)
    .split('\n')
    .filter((line) => {
      const stripped = line.replace(/[┌└├┤┬┴┼│─\s]/g, '');
      return stripped.length > 0 || !BOX_CHARS.test(line);
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Normalize full-width / unicode asterisks to ASCII for markdown parsing. */
function normalizeAsterisks(text) {
  return String(text).replace(/[\uFF0A\u2217\u204E]/g, '*');
}

/**
 * Convert **bold** markdown markers to <strong> so they never show as literal **.
 * Safe to run on mixed markdown/HTML (skips content that is already inside tags).
 */
export function convertMarkdownBoldMarkers(text) {
  if (!text || typeof text !== 'string') return text;
  if (text.length > 120000) return normalizeAsterisks(text);

  let converted = normalizeAsterisks(text);

  converted = converted.replace(/\*\*\s*\*\*/g, '');
  converted = converted.replace(/\*\*📎\s*\*\*/g, '📎 ');

  let previous = '';
  let iterations = 0;
  while (converted !== previous && iterations < 12) {
    previous = converted;
    converted = converted.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
    iterations += 1;
  }

  converted = converted.replace(/\*\*/g, '');

  return converted;
}

/** True when text still looks like raw JSON (should not be shown to users). */
export function looksLikeRawJsonString(text) {
  const t = String(text ?? '').trim();
  if (!t) return false;
  if (/^```(?:json)?\s*/i.test(t)) return true;
  if ((t.startsWith('{') || t.startsWith('[')) && /"[^"]+"\s*:/.test(t)) return true;
  return false;
}

/** True when formatted output has no readable content (only rules, pipes, or HTML shell). */
export function isEmptyFormattedChatContent(text) {
  const t = String(text ?? '').trim();
  if (!t) return true;
  const visible = t
    .replace(/<[^>]+>/g, ' ')
    .replace(/\|/g, ' ')
    .replace(/-{3,}/g, ' ')
    .replace(/\s+/g, '')
    .trim();
  return visible.length === 0;
}

export function formatChatResponseForDisplay(raw) {
  if (raw == null || raw === '') return '';

  const rawString = typeof raw === 'string' ? raw.trim() : '';

  let text;
  if (typeof raw === 'object') {
    text = convertJsonToPlainText(raw);
  } else if (isStructuredJsonResponse(raw)) {
    text = renderSecretPromptResponse(raw);
  } else {
    text = convertJsonToPlainText(raw);
  }

  if ((!text || isEmptyFormattedChatContent(text) || looksLikeRawJsonString(text)) && rawString) {
    if (isStructuredJsonResponse(rawString) || isStructuredJsonResponse(raw)) {
      const structured = renderSecretPromptResponse(rawString || raw);
      if (structured && !isEmptyFormattedChatContent(structured) && !looksLikeRawJsonString(structured)) {
        text = structured;
      }
    }
    if (!text || isEmptyFormattedChatContent(text) || looksLikeRawJsonString(text)) {
      const plain = convertJsonToPlainText(rawString || raw);
      if (plain && !looksLikeRawJsonString(plain)) text = plain;
    }
  }

  if (!text || isEmptyFormattedChatContent(text)) {
    // Final safety net: if the raw string is a JSON code block, try stripping fences and converting once more
    if (rawString) {
      const stripped = rawString
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();
      if (stripped && stripped !== rawString) {
        const recovered = convertJsonToPlainText(stripped);
        if (recovered && !isEmptyFormattedChatContent(recovered) && !looksLikeRawJsonString(recovered)) {
          text = recovered;
        } else if (recovered && recovered.length > 30) {
          text = recovered;
        }
      }
    }
    if (!text || isEmptyFormattedChatContent(text)) return '';
  }

  if (!/<[a-z][\s>]/i.test(text)) {
    text = convertAsciiLegalBoxes(text);
    text = cleanupBoxDebris(text);
  }

  text = convertMarkdownBoldMarkers(text);

  if (looksLikeRawJsonString(text)) {
    // Strip code fences and try one more conversion pass before giving up
    const stripped = String(text)
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    const converted = convertJsonToPlainText(stripped);
    if (converted && !looksLikeRawJsonString(converted) && !isEmptyFormattedChatContent(converted)) {
      return converted;
    }
    // Show the raw stripped content rather than a blank screen
    if (stripped && stripped.length > 20) return stripped;
    return '';
  }

  return text;
}

/** True only for full styled HTML documents — not mixed markdown + banner. */
export function chatResponseLooksLikeHtml(text) {
  if (!text) return false;
  return (
    /<table[\s>]/i.test(text) ||
    /<p\s+style\s*=/i.test(text) ||
    /<h[1-6]\s+style\s*=/i.test(text) ||
    /class="word-document-style"/i.test(text)
  );
}
