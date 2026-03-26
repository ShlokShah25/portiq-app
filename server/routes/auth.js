const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const { hasDashboardAccess } = require('../utils/subscriptionGate');
const { sendEmail, isEmailConfigured, getDefaultFrom } = require('../utils/emailService');

const router = express.Router();

function getJwtSecret() {
  return process.env.JWT_SECRET || 'your_secret_key';
}

/**
 * Forgot password - send reset link
 */
router.post('/forgot', async (req, res) => {
  try {
    const { username } = req.body || {};
    if (!username) {
      return res.status(400).json({ error: 'username (or email used as username) is required' });
    }

    // If duplicate emails exist, target the row most likely to be the real tenant (subscription + recent).
    const admins = await Admin.find({
      $or: [{ username }, { email: String(username).toLowerCase() }]
    })
      .sort({ hasActiveSubscription: -1, updatedAt: -1 })
      .limit(1);
    const admin = admins[0];
    if (!admin) {
      // Do not reveal user existence
      return res.json({ success: true });
    }

    const token = crypto.randomBytes(32).toString('hex');
    admin.resetToken = token;
    admin.resetTokenExpires = new Date(Date.now() + 1000 * 60 * 60); // 1 hour
    await admin.save();

    if (isEmailConfigured()) {
      const appBase =
        process.env.APP_BASE_URL ||
        'https://meetingassistant.portiqtechnologies.com';
      const resetUrl = `${appBase}/reset-password?token=${encodeURIComponent(token)}`;

      sendEmail({
        from: getDefaultFrom(),
        to: admin.email || username,
        subject: 'Reset your Portiq password',
        html: `
          <p>We received a request to reset the password for your Portiq account.</p>
          <p><a href="${resetUrl}" target="_blank" rel="noopener noreferrer">Click here to reset your password</a>. This link will expire in 1 hour.</p>
          <p>If you did not request this, you can safely ignore this email.</p>
        `,
      }).catch((mailErr) => {
        console.warn('Forgot password email failed:', mailErr.message);
      });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ error: 'Failed to start password reset.' });
  }
});

/**
 * Reset password with token
 */
router.post('/reset', async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password) {
      return res.status(400).json({ error: 'token and password are required' });
    }

    const admin = await Admin.findOne({
      resetToken: token,
      resetTokenExpires: { $gt: new Date() },
    });

    if (!admin) {
      return res.status(400).json({ error: 'Reset link is invalid or has expired.' });
    }

    admin.password = password;
    admin.resetToken = null;
    admin.resetTokenExpires = null;
    await admin.save();

    return res.json({ success: true });
  } catch (err) {
    console.error('Password reset error:', err);
    return res.status(500).json({ error: 'Failed to reset password.' });
  }
});

/**
 * Google OAuth start
 * Redirects to Google consent screen.
 */
router.get('/google', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    'https://meetingassistant.portiqtechnologies.com/api/auth/google/callback';
  if (!clientId) {
    return res.status(500).send('Google OAuth is not configured.');
  }

  const state = encodeURIComponent(req.query.next || '/dashboard');
  const scope = encodeURIComponent('openid email profile');

  const url =
    'https://accounts.google.com/o/oauth2/v2/auth' +
    `?client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    '&response_type=code' +
    `&scope=${scope}` +
    `&state=${state}`;

  res.redirect(url);
});

/**
 * Google OAuth callback
 */
router.get('/google/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) {
      return res.status(400).send('Missing code');
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri =
      process.env.GOOGLE_REDIRECT_URI ||
      'https://meetingassistant.portiqtechnologies.com/api/auth/google/callback';

    if (!clientId || !clientSecret) {
      return res.status(500).send('Google OAuth is not configured.');
    }

    const tokenRes = await axios.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );

    const { id_token } = tokenRes.data || {};
    if (!id_token) {
      throw new Error('Missing id_token from Google');
    }

    const payload = JSON.parse(
      Buffer.from(id_token.split('.')[1], 'base64').toString('utf8')
    );
    const emailRaw = payload.email;
    if (!emailRaw) {
      throw new Error('No email in Google account');
    }
    const emailNorm = String(emailRaw).toLowerCase().trim();

    const marketingBase =
      process.env.MARKETING_URL || 'https://www.portiqtechnologies.com';
    const appBase =
      process.env.APP_BASE_URL ||
      'https://meetingassistant.portiqtechnologies.com';

    // Prefer an account with an active subscription when the same email exists on multiple rows.
    const existing = await Admin.find({
      $or: [{ username: emailNorm }, { email: emailNorm }],
    })
      .sort({ hasActiveSubscription: -1, updatedAt: -1 })
      .limit(1);

    let admin = existing[0];
    if (!admin) {
      if (state === 'website') {
        // Sign up with Google: create account and send to website with session token
        const crypto = require('crypto');
        const randomPassword = crypto.randomBytes(24).toString('hex');
        admin = new Admin({
          username: emailNorm,
          email: emailNorm,
          password: randomPassword,
          hasActiveSubscription: false,
          productType: 'workplace',
          plan: 'starter',
        });
        await admin.save();
      } else {
        console.warn(
          `Google login attempted for ${emailNorm} but no matching admin account exists.`
        );
        return res.redirect(
          `${marketingBase}?login=google_no_account&email=${encodeURIComponent(
            emailNorm
          )}`
        );
      }
    }

    if (state === 'website') {
      const websiteSessionToken = jwt.sign(
        { adminId: admin._id.toString(), purpose: 'website_session' },
        getJwtSecret(),
        { expiresIn: '5m' }
      );
      const returnUrl =
        `${marketingBase}?auth_token=${encodeURIComponent(websiteSessionToken)}`;
      return res.redirect(returnUrl);
    }

    // App Google login: same subscription gate as password (avoid JWT that dies on first /admin/* call).
    if (!hasDashboardAccess(admin)) {
      return res.redirect(
        `${marketingBase}?login=no_subscription&email=${encodeURIComponent(
          emailNorm
        )}`
      );
    }

    const appToken = jwt.sign(
      {
        id: admin._id.toString(),
        username: admin.username,
        role: admin.role,
      },
      getJwtSecret(),
      { expiresIn: '24h' }
    );

    const nextPath = state || '/dashboard';
    const redirectUrl =
      `${appBase}/admin-login?social_token=${encodeURIComponent(appToken)}` +
      `&next=${encodeURIComponent(nextPath)}`;

    res.redirect(redirectUrl);
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    const appBase =
      process.env.APP_BASE_URL ||
      'https://meetingassistant.portiqtechnologies.com';
    res.redirect(`${appBase}/admin-login?error=google_auth`);
  }
});

module.exports = router;

