/**
 * Zoom + Microsoft (Teams/Graph) OAuth — authorization code flow.
 * Callbacks redirect to the public app origin (APP_PUBLIC_URL, APP_BASE_URL, etc.).
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const { authenticateAdmin } = require('../middleware/auth');

const router = express.Router();

function jwtSecret() {
  return process.env.JWT_SECRET || 'your_secret_key';
}

function appPublicOrigin() {
  const u =
    process.env.APP_PUBLIC_URL ||
    process.env.APP_BASE_URL ||
    process.env.CLIENT_URL ||
    process.env.PUBLIC_APP_URL;
  if (u) return String(u).replace(/\/$/, '');
  return 'http://localhost:3002';
}

function zoomRedirectUri() {
  return process.env.ZOOM_OAUTH_REDIRECT_URI || '';
}

function teamsRedirectUri() {
  return process.env.TEAMS_OAUTH_REDIRECT_URI || '';
}

function teamsTenant() {
  return process.env.TEAMS_APP_TENANT_ID || process.env.MICROSOFT_TENANT_ID || 'common';
}

function teamsScopes() {
  return (
    process.env.TEAMS_GRAPH_SCOPES ||
    'offline_access openid profile https://graph.microsoft.com/User.Read'
  );
}

async function zoomExchangeCode(code) {
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;
  const redirectUri = zoomRedirectUri();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Zoom OAuth env not configured');
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
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
    throw new Error(data.reason || data.error || `Zoom token error (${res.status})`);
  }
  return data;
}

async function zoomFetchUserMe(accessToken) {
  const res = await fetch('https://api.zoom.us/v2/users/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { id: null, email: null };
  return { id: data.id || null, email: data.email || null };
}

async function teamsExchangeCode(code) {
  const clientId = process.env.TEAMS_GRAPH_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.TEAMS_GRAPH_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET;
  const redirectUri = teamsRedirectUri();
  const tenant = teamsTenant();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Microsoft OAuth env not configured');
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `Microsoft token error (${res.status})`);
  }
  return data;
}

async function graphFetchMe(accessToken) {
  const res = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { userPrincipalName: null, id: null };
  return { userPrincipalName: data.userPrincipalName || data.mail || null, id: data.id || null };
}

/** Start Zoom OAuth — returns authorize URL (SPA opens in same window). */
router.get('/oauth/zoom/start', authenticateAdmin, (req, res) => {
  const clientId = process.env.ZOOM_CLIENT_ID;
  const redirectUri = zoomRedirectUri();
  if (!clientId || !redirectUri) {
    return res.status(503).json({
      error: 'Zoom OAuth not configured',
      hint: 'Set ZOOM_CLIENT_ID and ZOOM_OAUTH_REDIRECT_URI on the server.',
    });
  }
  const state = jwt.sign(
    { aid: req.admin._id.toString(), p: 'zoom', v: 1 },
    jwtSecret(),
    { expiresIn: '15m' }
  );
  const url = new URL('https://zoom.us/oauth/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set(
    'scope',
    process.env.ZOOM_OAUTH_SCOPES || 'user:read:user user:read:email'
  );
  url.searchParams.set('state', state);
  return res.json({ url: url.toString() });
});

router.get('/oauth/zoom/callback', async (req, res) => {
  const origin = appPublicOrigin();
  const fail = (msg) => res.redirect(`${origin}/dashboard?zoom=error&message=${encodeURIComponent(msg || 'oauth_failed')}`);

  try {
    if (req.query.error) {
      return fail(String(req.query.error_description || req.query.error));
    }
    const { code, state } = req.query;
    if (!code || !state) return fail('missing_code_or_state');

    let decoded;
    try {
      decoded = jwt.verify(String(state), jwtSecret());
    } catch {
      return fail('invalid_state');
    }
    if (decoded.p !== 'zoom' || !decoded.aid) return fail('invalid_state_payload');

    const tokenJson = await zoomExchangeCode(String(code));
    const expiresAt = tokenJson.expires_in
      ? new Date(Date.now() + Number(tokenJson.expires_in) * 1000)
      : null;
    const me = await zoomFetchUserMe(tokenJson.access_token);

    await Admin.findByIdAndUpdate(decoded.aid, {
      $set: {
        'zoomOAuth.accessToken': tokenJson.access_token,
        'zoomOAuth.refreshToken': tokenJson.refresh_token || null,
        'zoomOAuth.expiresAt': expiresAt,
        'zoomOAuth.scope': tokenJson.scope || null,
        'zoomOAuth.accountId': me.id,
        'zoomOAuth.email': me.email,
        'meetingPlatforms.zoom': true,
      },
    });

    return res.redirect(`${origin}/dashboard?zoom=connected`);
  } catch (e) {
    console.error('[oauth/zoom/callback]', e.message);
    return fail(e.message || 'token_exchange_failed');
  }
});

/** Start Microsoft (Graph) OAuth for Teams integration path. */
router.get('/oauth/teams/start', authenticateAdmin, (req, res) => {
  const clientId = process.env.TEAMS_GRAPH_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID;
  const redirectUri = teamsRedirectUri();
  if (!clientId || !redirectUri) {
    return res.status(503).json({
      error: 'Microsoft OAuth not configured',
      hint: 'Set TEAMS_GRAPH_CLIENT_ID, TEAMS_GRAPH_CLIENT_SECRET, TEAMS_OAUTH_REDIRECT_URI.',
    });
  }
  const tenant = teamsTenant();
  const state = jwt.sign(
    { aid: req.admin._id.toString(), p: 'teams', v: 1 },
    jwtSecret(),
    { expiresIn: '15m' }
  );
  const url = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`
  );
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', teamsScopes());
  url.searchParams.set('state', state);
  return res.json({ url: url.toString() });
});

router.get('/oauth/teams/callback', async (req, res) => {
  const origin = appPublicOrigin();
  const fail = (msg) =>
    res.redirect(`${origin}/dashboard?teams=error&message=${encodeURIComponent(msg || 'oauth_failed')}`);

  try {
    if (req.query.error) {
      return fail(String(req.query.error_description || req.query.error));
    }
    const { code, state } = req.query;
    if (!code || !state) return fail('missing_code_or_state');

    let decoded;
    try {
      decoded = jwt.verify(String(state), jwtSecret());
    } catch {
      return fail('invalid_state');
    }
    if (decoded.p !== 'teams' || !decoded.aid) return fail('invalid_state_payload');

    const tokenJson = await teamsExchangeCode(String(code));
    const expiresAt = tokenJson.expires_in
      ? new Date(Date.now() + Number(tokenJson.expires_in) * 1000)
      : null;
    const me = await graphFetchMe(tokenJson.access_token);

    await Admin.findByIdAndUpdate(decoded.aid, {
      $set: {
        'teamsOAuth.accessToken': tokenJson.access_token,
        'teamsOAuth.refreshToken': tokenJson.refresh_token || null,
        'teamsOAuth.expiresAt': expiresAt,
        'teamsOAuth.scope': tokenJson.scope || null,
        'teamsOAuth.tenantId': tokenJson.tenant_id || teamsTenant(),
        'teamsOAuth.userPrincipalName': me.userPrincipalName,
        'meetingPlatforms.teams': true,
      },
    });

    return res.redirect(`${origin}/dashboard?teams=connected`);
  } catch (e) {
    console.error('[oauth/teams/callback]', e.message);
    return fail(e.message || 'token_exchange_failed');
  }
});

module.exports = router;
