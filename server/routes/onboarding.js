const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateAdmin } = require('../middleware/auth');
const Organization = require('../models/Organization');

// Storage for organization logos
const orgLogoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/org-logos');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `org-${Date.now()}${ext}`);
  }
});

const uploadOrgLogo = multer({
  storage: orgLogoStorage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

/**
 * POST /api/onboarding/organization
 *
 * Creates an Organization for the currently authenticated admin (tenant)
 * and links the admin to that organization. This powers the first-time
 * onboarding flow for multi-tenant isolation.
 *
 * Body (multipart/form-data):
 * - name: string (required)
 * - logo: file (optional)
 */
router.post(
  '/onboarding/organization',
  authenticateAdmin,
  uploadOrgLogo.single('logo'),
  async (req, res) => {
    try {
      const name = (req.body.name || '').trim();
      if (!name) {
        return res.status(400).json({ error: 'Organization name is required' });
      }

      let logoUrl = null;
      if (req.file) {
        logoUrl = `/uploads/org-logos/${req.file.filename}`;
      }

      const org = new Organization({
        name,
        logoUrl
      });
      await org.save();

      // Link current admin to this organization for tenant scoping
      req.admin.organizationId = org._id;
      await req.admin.save();

      res.json({
        success: true,
        organization: org,
        admin: {
          id: req.admin._id,
          username: req.admin.username,
          role: req.admin.role,
          organizationId: req.admin.organizationId
        }
      });
    } catch (error) {
      console.error('Error during onboarding organization creation:', error);
      res.status(500).json({ error: 'Failed to create organization' });
    }
  }
);

module.exports = router;

