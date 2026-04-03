/**
 * Display formatters for AI usage, currency, etc.
 */

/**
 * Format token count for display
 * @param {number} n
 * @returns {string}
 */
export function formatTokenCount(n) {
  if (n == null) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/**
 * Format cost in INR for display
 * @param {number} inr
 * @param {Object} opts - { decimals }
 * @returns {string}
 */
export function formatCostInr(inr, opts = {}) {
  const decimals = opts.decimals ?? 4;
  if (inr == null || Number.isNaN(inr)) return '₹0.00';
  return `₹${Number(inr).toFixed(decimals)}`;
}
