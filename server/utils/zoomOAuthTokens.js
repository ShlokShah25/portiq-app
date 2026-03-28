/**
 * Zoom user OAuth access tokens with refresh — for server-side Zoom REST calls.
 */

const fetch = global.fetch;

async function zoomRefreshAccessToken(refreshToken) {
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;
  if (!clientId || !clientSecret || !refreshToken) {
    return { ok: false, error: 'missing_credentials' };
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const res = await fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data.reason || data.error || `http_${res.status}`, data };
  }
  return { ok: true, data };
}

/**
 * Returns a valid access token for the admin's Zoom OAuth, refreshing if near expiry.
 * @param {import('mongoose').Types.ObjectId|string} adminId
 * @returns {Promise<string|null>}
 */
async function getZoomAccessTokenForAdmin(adminId) {
  const Admin = require('../models/Admin');
  const admin = await Admin.findById(adminId).select(
    '+zoomOAuth.refreshToken +zoomOAuth.accessToken'
  );
  if (!admin || !admin.zoomOAuth) return null;

  const { accessToken, refreshToken, expiresAt } = admin.zoomOAuth;
  const bufferMs = 5 * 60 * 1000;
  const stillValid =
    accessToken &&
    expiresAt &&
    new Date(expiresAt).getTime() > Date.now() + bufferMs;

  if (stillValid) return accessToken;

  if (!refreshToken) return accessToken || null;

  const refreshed = await zoomRefreshAccessToken(refreshToken);
  if (!refreshed.ok) {
    console.error('[zoomOAuth] refresh failed:', refreshed.error);
    return accessToken || null;
  }

  const d = refreshed.data;
  const newExpires = d.expires_in
    ? new Date(Date.now() + Number(d.expires_in) * 1000)
    : null;

  await Admin.findByIdAndUpdate(adminId, {
    $set: {
      'zoomOAuth.accessToken': d.access_token,
      'zoomOAuth.refreshToken': d.refresh_token || refreshToken,
      'zoomOAuth.expiresAt': newExpires,
      'zoomOAuth.scope': d.scope || admin.zoomOAuth.scope,
    },
  });

  return d.access_token || null;
}

module.exports = {
  getZoomAccessTokenForAdmin,
  zoomRefreshAccessToken,
};
