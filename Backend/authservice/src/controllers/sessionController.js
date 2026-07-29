const Session = require('../models/Session');
const { verifyTokenLenient } = require('../utils/jwt');
const { collectDeviceInfo, lookupGeoLocation } = require('../utils/deviceInfo');

// Settings → "Active sessions": list the active device sessions, sign out one,
// several (checkbox selection), or all other devices. All routes sit behind
// `protect`, so req.user is the verified owner.

const decodeRequestToken = (req) => {
  const token = req.headers.authorization?.split(' ')[1];
  return token ? verifyTokenLenient(token) : null;
};

const mapSessionRow = (row, currentSid) => ({
  id: row.id,
  browser: row.browser || 'Unknown browser',
  os: row.os || 'Unknown OS',
  device_type: row.device_type || 'desktop',
  ip_address: row.ip_address || 'Unknown',
  location: row.location || 'Unknown',
  login_time: row.login_time,
  last_active_at: row.last_active_at,
  is_current: Boolean(currentSid && row.sid && row.sid === currentSid),
});

const getActiveSessions = async (req, res) => {
  try {
    const decoded = decodeRequestToken(req);
    const currentSid = decoded?.sid || null;
    // Auto sign-out: legacy pre-feature rows + sessions whose 24h token expired.
    await Session.autoSignOutStale(req.user.id).catch(() => {});
    const rows = await Session.listActive(req.user.id);
    const sessions = rows.map((row) => mapSessionRow(row, currentSid));

    // The current device must ALWAYS be visible: this very request proves the
    // session is live. Tokens minted before device tracking carry no sid and
    // have no stored row — synthesize the entry from the request itself.
    if (!sessions.some((s) => s.is_current)) {
      const device = collectDeviceInfo(req);
      let location = 'Unknown';
      try { location = await lookupGeoLocation(device.ip); } catch { /* best effort */ }
      sessions.unshift({
        id: null, // virtual — not a stored row, so it cannot be revoked
        browser: device.browser,
        os: device.os,
        device_type: device.deviceType,
        ip_address: device.ip,
        location,
        login_time: decoded?.iat ? new Date(decoded.iat * 1000).toISOString() : null,
        last_active_at: new Date().toISOString(),
        is_current: true,
      });
    }

    res.status(200).json({
      success: true,
      max_devices: Session.MAX_ACTIVE_SESSIONS,
      sessions,
    });
  } catch (error) {
    console.error('[Sessions] list failed:', error);
    res.status(500).json({ success: false, message: 'Could not load login sessions' });
  }
};

const revokeSession = async (req, res) => {
  try {
    const sessionId = Number(req.params.id);
    if (!Number.isInteger(sessionId)) {
      return res.status(400).json({ success: false, message: 'Invalid session id' });
    }
    const revoked = await Session.revokeByIdForUser(sessionId, req.user.id);
    if (!revoked) {
      return res.status(404).json({ success: false, message: 'Session not found or already signed out' });
    }
    res.status(200).json({ success: true, message: 'Device signed out' });
  } catch (error) {
    console.error('[Sessions] revoke failed:', error);
    res.status(500).json({ success: false, message: 'Could not sign out that device' });
  }
};

/** Bulk sign-out of the sessions the user ticked in the panel. */
const revokeSessions = async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.session_ids)
      ? req.body.session_ids.map(Number).filter(Number.isInteger)
      : [];
    if (ids.length === 0) {
      return res.status(400).json({ success: false, message: 'session_ids required' });
    }
    const count = await Session.revokeManyForUser(ids, req.user.id);
    res.status(200).json({ success: true, signed_out: count });
  } catch (error) {
    console.error('[Sessions] bulk revoke failed:', error);
    res.status(500).json({ success: false, message: 'Could not sign out the selected devices' });
  }
};

/** Sign out every device except the one making this request. */
const revokeAllOtherSessions = async (req, res) => {
  try {
    const currentSid = decodeRequestToken(req)?.sid || null;
    const count = await Session.revokeAllForUserExceptSid(req.user.id, currentSid);
    res.status(200).json({ success: true, signed_out: count });
  } catch (error) {
    console.error('[Sessions] revoke-all failed:', error);
    res.status(500).json({ success: false, message: 'Could not sign out all devices' });
  }
};

module.exports = { getActiveSessions, revokeSession, revokeSessions, revokeAllOtherSessions };
