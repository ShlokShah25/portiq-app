const express = require('express');
const router = express.Router();
const Config = require('../models/Config');
const { authenticateAdmin } = require('../middleware/auth');

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
    if (req.body.actionItemReminderTime !== undefined) {
      const raw = String(req.body.actionItemReminderTime || '').trim();
      // Basic HH:MM validation
      const match = raw.match(/^(\d{1,2}):(\d{2})$/);
      if (match) {
        let h = parseInt(match[1], 10);
        let m = parseInt(match[2], 10);
        if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
          return res.status(400).json({ error: 'Invalid actionItemReminderTime. Use HH:MM (24h).' });
        }
        // Normalize to zero-padded HH:MM
        config.actionItemReminderTime = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      } else {
        return res.status(400).json({ error: 'Invalid actionItemReminderTime. Use HH:MM (24h).' });
      }
    }
    if (req.body.actionItemRemindersEnabled !== undefined) {
      config.actionItemRemindersEnabled = !!req.body.actionItemRemindersEnabled;
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

module.exports = router;
