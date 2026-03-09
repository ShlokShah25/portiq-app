const express = require('express');
const router = express.Router();
const Config = require('../models/Config');
const { authenticateAdmin } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

/**
 * Get current configuration
 */
router.get('/', async (req, res) => {
  try {
    const config = await Config.getConfig();
    res.json(config);
  } catch (error) {
    console.error('Error fetching config:', error);
    res.status(500).json({ error: 'Failed to fetch configuration' });
  }
});

/**
 * Update configuration (admin only)
 */
router.put('/', authenticateAdmin, async (req, res) => {
  try {
    const config = await Config.getConfig();
    
    // Update allowed fields
    if (req.body.companyName !== undefined) config.companyName = req.body.companyName;
    if (req.body.companyLogo !== undefined) config.companyLogo = req.body.companyLogo;
    if (req.body.completedMeetingDisplayHours !== undefined) {
      config.completedMeetingDisplayHours = Math.max(0, Math.min(168, req.body.completedMeetingDisplayHours));
    }
    if (req.body.alwaysOnDisplay) {
      config.alwaysOnDisplay = {
        enabled: req.body.alwaysOnDisplay.enabled !== undefined ? req.body.alwaysOnDisplay.enabled : (config.alwaysOnDisplay?.enabled ?? true),
        idleTimeout: req.body.alwaysOnDisplay.idleTimeout || config.alwaysOnDisplay?.idleTimeout || 30,
        rotationInterval: req.body.alwaysOnDisplay.rotationInterval || config.alwaysOnDisplay?.rotationInterval || 10,
        backgroundColor: req.body.alwaysOnDisplay.backgroundColor || config.alwaysOnDisplay?.backgroundColor || '#0a1929',
        textColor: req.body.alwaysOnDisplay.textColor || config.alwaysOnDisplay?.textColor || '#ffffff',
        accentColor: req.body.alwaysOnDisplay.accentColor || config.alwaysOnDisplay?.accentColor || '#4fc3f7'
      };
    }
    if (req.body.pageCustomization !== undefined) {
      config.pageCustomization = req.body.pageCustomization;
    }
    
    await config.save();
    
    res.json({
      success: true,
      message: 'Configuration updated successfully',
      config
    });
  } catch (error) {
    console.error('Error updating config:', error);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

/**
 * Upload company logo (admin only)
 * Saves logo under /uploads/logos and stores the public path in config.companyLogo
 */
const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/logos');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `company-logo-${Date.now()}${ext}`);
  }
});

const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for logo upload'));
    }
  }
});

router.post('/logo', authenticateAdmin, logoUpload.single('logo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No logo file uploaded' });
    }

    const config = await Config.getConfig();
    // Public URL path served by Express static /uploads
    const publicPath = `/uploads/logos/${req.file.filename}`;
    config.companyLogo = publicPath;
    await config.save();

    res.json({
      success: true,
      message: 'Company logo updated successfully',
      logoUrl: publicPath,
      config
    });
  } catch (error) {
    console.error('Error uploading company logo:', error);
    res.status(500).json({ error: 'Failed to upload company logo' });
  }
});

module.exports = router;
