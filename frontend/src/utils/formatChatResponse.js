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

export function formatChatResponseForDisplay(raw) {
  if (raw == null || raw === '') return '';

  let text;
  if (typeof raw === 'object') {
    text = convertJsonToPlainText(raw);
  } else if (isStructuredJsonResponse(raw)) {
    text = renderSecretPromptResponse(raw);
  } else {
    text = convertJsonToPlainText(raw);
  }

  if (!text) return '';

  if (!/<[a-z][\s>]/i.test(text)) {
    text = convertAsciiLegalBoxes(text);
    text = cleanupBoxDebris(text);
  }

  text = convertMarkdownBoldMarkers(text);

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
