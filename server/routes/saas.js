const express = require('express');
const router = express.Router();
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
    if (!admin) {
      admin = new Admin({ username, password });
    } else {
      admin.password = password;
    }

    await admin.save();

    return res.status(200).json({
      success: true,
      message: 'Account created. You can now sign in from the app.',
    });
  } catch (err) {
    console.error('SaaS signup error:', err);
    return res.status(500).json({ error: 'Failed to create account. Please try again.' });
  }
});

module.exports = router;

