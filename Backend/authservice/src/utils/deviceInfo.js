const http = require('http');

/**
 * Client-device metadata for login sessions: IP extraction, a dependency-free
 * user-agent parser (major browsers/OSes only), and an async best-effort
 * IP-geolocation lookup. Everything here degrades to "Unknown" — device
 * metadata must never break a login.
 */

/** Real client IP. First X-Forwarded-For entry wins (gateway/Cloud Run append). */
function getClientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  let ip = xff || req.ip || req.socket?.remoteAddress || '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';
  return ip || 'Unknown';
}

function parseUserAgent(uaRaw) {
  const ua = String(uaRaw || '');
  let browser = 'Unknown browser';
  let os = 'Unknown OS';
  let deviceType = 'desktop';

  // Order matters: Edge/Opera/Samsung UAs also contain "Chrome"; Chrome contains "Safari".
  let m;
  if ((m = ua.match(/Edg(?:e|A|iOS)?\/(\d+)/))) browser = `Edge ${m[1]}`;
  else if ((m = ua.match(/OPR\/(\d+)/)) || (m = ua.match(/Opera\/(\d+)/))) browser = `Opera ${m[1]}`;
  else if ((m = ua.match(/SamsungBrowser\/(\d+)/))) browser = `Samsung Internet ${m[1]}`;
  else if ((m = ua.match(/Firefox\/(\d+)/)) || (m = ua.match(/FxiOS\/(\d+)/))) browser = `Firefox ${m[1]}`;
  else if ((m = ua.match(/CriOS\/(\d+)/))) browser = `Chrome ${m[1]}`;
  else if ((m = ua.match(/Chrome\/(\d+)/))) browser = `Chrome ${m[1]}`;
  else if (/Safari\//.test(ua) && (m = ua.match(/Version\/(\d+)/))) browser = `Safari ${m[1]}`;
  else if (/Trident|MSIE/.test(ua)) browser = 'Internet Explorer';

  if (/Windows NT 10\.0/.test(ua)) os = 'Windows 10/11';
  else if ((m = ua.match(/Windows NT (\d+\.\d+)/))) os = `Windows NT ${m[1]}`;
  else if ((m = ua.match(/Mac OS X (\d+[._]\d+)/))) os = `macOS ${m[1].replace('_', '.')}`;
  else if ((m = ua.match(/Android (\d+)/))) os = `Android ${m[1]}`;
  else if ((m = ua.match(/(?:iPhone|iPad).*OS (\d+)/))) os = `iOS ${m[1]}`;
  else if (/Linux/.test(ua)) os = 'Linux';

  if (/iPad|Tablet/.test(ua)) deviceType = 'tablet';
  else if (/Mobi|Android.*Mobile|iPhone/.test(ua)) deviceType = 'mobile';

  return { browser, os, deviceType };
}

/** Everything the login handlers need, in one call. */
function collectDeviceInfo(req) {
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 500);
  const { browser, os, deviceType } = parseUserAgent(userAgent);
  return { ip: getClientIp(req), userAgent, browser, os, deviceType };
}

function isPrivateIp(ip) {
  return (
    !ip || ip === 'Unknown' || ip === '127.0.0.1' ||
    /^10\./.test(ip) || /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || /^fc|^fd|^fe80/i.test(ip)
  );
}

/**
 * Best-effort city/region/country from the IP (ip-api.com free tier, http-only).
 * Resolves to a display string; never rejects. Callers fire-and-forget this and
 * UPDATE the session row afterwards, so logins are never blocked on geo.
 */
function lookupGeoLocation(ip) {
  return new Promise((resolve) => {
    if (isPrivateIp(ip)) return resolve('Local network');
    const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city`;
    const request = http.get(url, { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.status !== 'success') return resolve('Unknown');
          const parts = [data.city, data.regionName, data.country].filter(Boolean);
          resolve(parts.length ? parts.join(', ') : 'Unknown');
        } catch {
          resolve('Unknown');
        }
      });
    });
    request.on('timeout', () => { request.destroy(); resolve('Unknown'); });
    request.on('error', () => resolve('Unknown'));
  });
}

module.exports = { getClientIp, parseUserAgent, collectDeviceInfo, lookupGeoLocation };
