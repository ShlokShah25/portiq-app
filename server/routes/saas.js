const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const Admin = require('../models/Admin');

/**
 * Lightweight SaaS signup endpoint.
 * Creates or updates an Admin user so the owner can log in with the chosen username/password.
 * This does NOT change existing org/billing schema – it only manages Admin credentials.
 */
router.post('/signup', async (req, res) => {
  try {
    const { username, email, password, organizationName, productType } = req.body || {};

    if (!username || !password || !email || !organizationName || !productType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Upsert admin with given username
    let admin = await Admin.findOne({ username });
    const isNew = !admin;
    if (!admin) {
      admin = new Admin({ username, password });
      admin.hasActiveSubscription = false; // no dashboard access until they subscribe
    } else {
      admin.password = password;
    }

    // Persist chosen product type and default plan for SaaS signup
    admin.email = email.toLowerCase();
    admin.productType =
      (productType || '').toLowerCase() === 'education' ? 'education' : 'workplace';
    if (!admin.plan) {
      admin.plan = 'starter';
    }

    await admin.save();

    // Best-effort welcome email (non-blocking for response)
    if (process.env.MAIL_HOST && process.env.MAIL_USER && process.env.MAIL_PASS) {
      try {
        const transporter = nodemailer.createTransport({
          host: process.env.MAIL_HOST,
          port: parseInt(process.env.MAIL_PORT || '587', 10),
          secure: process.env.MAIL_SECURE === 'true',
          auth: {
            user: process.env.MAIL_USER,
            pass: process.env.MAIL_PASS,
          },
        });

        const productLabel =
          (productType || '').toLowerCase() === 'education'
            ? 'Portiq Education'
            : 'Portiq Workplace';

        const appUrl =
          process.env.APP_LOGIN_URL ||
          'https://meetingassistant.portiqtechnologies.com/admin-login';

        transporter.sendMail({
          from: process.env.MAIL_FROM || process.env.MAIL_USER,
          to: email,
          subject: `Welcome to ${productLabel}`,
          html: `
            <p>Hi ${username},</p>
            <p>Welcome to <strong>${productLabel}</strong> at <strong>${organizationName}</strong>.</p>
            <p>Your account has been created. You can now sign in to your dashboard using your email/username and password.</p>
            <p><a href="${appUrl}" target="_blank" rel="noopener noreferrer">Go to your dashboard</a></p>
            <p>If you did not request this account, you can safely ignore this email.</p>
            <p>— Portiq Team</p>
          `,
        }).catch((err) => {
          console.warn('Welcome email failed:', err.message);
        });
      } catch (mailErr) {
        console.warn('Failed to initialize welcome email transporter:', mailErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Account created. You can now sign in from the app.',
    });
  } catch (err) {
    console.error('SaaS signup error:', err);
    return res.status(500).json({ error: 'Failed to create account. Please try again.' });
  }
});

/**
 * Website login: validate credentials and return session info for the marketing site.
 * Does not return an app JWT; used only to "log in to your Portiq account on the website".
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Email/username and password are required.' });
    }

    const admin = await Admin.findOne({
      $or: [{ username: username.trim() }, { email: username.trim().toLowerCase() }],
    });
    if (!admin) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    return res.status(200).json({
      success: true,
      user: {
        email: admin.email || '',
        username: admin.username,
        plan: (admin.plan || 'starter').toLowerCase(),
        productType: (admin.productType || 'workplace').toLowerCase(),
      },
    });
  } catch (err) {
    console.error('SaaS login error:', err);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

/**
 * Issue an auto-login token for a given username.
 * Used by the website to log user into the app immediately after first subscription.
 */
router.post('/create-autologin-token', async (req, res) => {
  try {
    const { username } = req.body || {};
    if (!username) {
      return res.status(400).json({ error: 'username is required' });
    }

    const admin = await Admin.findOne({ username });
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    const secret = process.env.JWT_SECRET || 'your_secret_key';
    const token = jwt.sign(
      { id: admin._id, username: admin.username, role: admin.role, autologin: true },
      secret,
      { expiresIn: '2h' }
    );

    return res.json({ success: true, token });
  } catch (err) {
    console.error('Auto-login token error:', err);
    return res.status(500).json({ error: 'Failed to create auto-login token.' });
  }
});

module.exports = router;

