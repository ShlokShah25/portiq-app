const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const nodemailer = require('nodemailer');

const router = express.Router();

function getJwtSecret() {
  return process.env.JWT_SECRET || 'your_secret_key';
}

function createMailTransporter() {
  if (!process.env.MAIL_HOST || !process.env.MAIL_USER || !process.env.MAIL_PASS) {
    return null;
  }
  try {
    return nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: parseInt(process.env.MAIL_PORT || '587', 10),
      secure: process.env.MAIL_SECURE === 'true',
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
      },
    });
  } catch (err) {
    console.warn('Failed to create mail transporter:', err.message);
    return null;
  }
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

    // Allow lookup by either username or email, since the login field accepts both.
    const admin = await Admin.findOne({
      $or: [
        { username },
        { email: username.toLowerCase() }
      ]
    });
    if (!admin) {
      // Do not reveal user existence
      return res.json({ success: true });
    }

    const token = crypto.randomBytes(32).toString('hex');
    admin.resetToken = token;
    admin.resetTokenExpires = new Date(Date.now() + 1000 * 60 * 60); // 1 hour
    await admin.save();

    const transporter = createMailTransporter();
    if (transporter) {
      const appBase =
        process.env.APP_BASE_URL ||
        'https://meetingassistant.portiqtechnologies.com';
      const resetUrl = `${appBase}/reset-password?token=${encodeURIComponent(token)}`;

      // Fire-and-forget so the API responds immediately even if SMTP is slow.
      transporter
        .sendMail({
          from: process.env.MAIL_FROM || process.env.MAIL_USER,
          to: admin.email || username,
          subject: 'Reset your Portiq password',
          html: `
            <p>We received a request to reset the password for your Portiq account.</p>
            <p><a href="${resetUrl}" target="_blank" rel="noopener noreferrer">Click here to reset your password</a>. This link will expire in 1 hour.</p>
            <p>If you did not request this, you can safely ignore this email.</p>
          `,
        })
        .catch((mailErr) => {
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
    const email = payload.email;
    if (!email) {
      throw new Error('No email in Google account');
    }

    let admin = await Admin.findOne({ $or: [{ username: email }, { email }] });
    if (!admin) {
      const marketingBase =
        process.env.MARKETING_URL || 'https://www.portiqtechnologies.com';
      if (state === 'website') {
        // Sign up with Google: create account and send to website with session token
        const crypto = require('crypto');
        const randomPassword = crypto.randomBytes(24).toString('hex');
        admin = new Admin({
          username: email,
          email,
          password: randomPassword,
          hasActiveSubscription: false,
          productType: 'workplace',
          plan: 'starter',
        });
        await admin.save();
      } else {
        const appBase =
          process.env.APP_BASE_URL ||
          'https://meetingassistant.portiqtechnologies.com';
        console.warn(
          `Google login attempted for ${email} but no matching admin account exists.`
        );
        return res.redirect(
          `${marketingBase}?login=google_no_account&email=${encodeURIComponent(
            email
          )}`
        );
      }
    }

    const appToken = jwt.sign(
      { id: admin._id, username: admin.username, role: admin.role },
      getJwtSecret(),
      { expiresIn: '24h' }
    );

    const marketingBase =
      process.env.MARKETING_URL || 'https://www.portiqtechnologies.com';
    const appBase =
      process.env.APP_BASE_URL ||
      'https://meetingassistant.portiqtechnologies.com';

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

