const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const Admin = require('../models/Admin');
const Organization = require('../models/Organization');

/**
 * SaaS signup endpoint used by the marketing site.
 *
 * Creates a new Organization and an owner Admin account that will be used
 * to log into the Portiq admin console.
 *
 * POST /api/saas/signup
 * Body:
 * - email (required)
 * - password (required)
 * - companyName (required)
 */
router.post('/saas/signup', async (req, res) => {
  try {
    const { email, password, companyName } = req.body || {};

    if (!email || !password || !companyName) {
      return res.status(400).json({ error: 'email, password and companyName are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const existing = await Admin.findOne({ username: normalizedEmail });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists. Please log in instead.' });
    }

    // Create organization for this new tenant
    const organization = new Organization({
      name: companyName.trim()
    });
    await organization.save();

    // Create owner admin tied to this organization
    const admin = new Admin({
      username: normalizedEmail,
      password,
      role: 'owner',
      organizationId: organization._id
    });
    await admin.save();

    const token = jwt.sign(
      { id: admin._id, username: admin.username, role: admin.role },
      process.env.JWT_SECRET || 'your_secret_key',
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      admin: {
        id: admin._id,
        username: admin.username,
        role: admin.role,
        organizationId: admin.organizationId
      },
      organization
    });
  } catch (error) {
    console.error('SaaS signup error:', error);
    res.status(500).json({ error: 'Signup failed' });
  }
});

module.exports = router;

