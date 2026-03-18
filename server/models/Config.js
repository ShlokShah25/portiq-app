const mongoose = require('mongoose');

const configSchema = new mongoose.Schema({
  companyName: {
    type: String,
    default: 'Your Company',
    trim: true
  },
  companyLogo: {
    type: String, // Path to logo file
    default: null
  },
  // Time of day (server local time) to send action-item review reminders, in "HH:MM" 24h format.
  actionItemReminderTime: {
    type: String,
    default: '08:00'
  },
  // Enable/disable action-item review reminders.
  actionItemRemindersEnabled: {
    type: Boolean,
    default: true
  },
  completedMeetingDisplayHours: {
    type: Number,
    default: 24, // Show completed meetings for 24 hours by default
    min: 0,
    max: 168 // Max 1 week
  },
  alwaysOnDisplay: {
    enabled: { type: Boolean, default: true },
    idleTimeout: { type: Number, default: 30 },
    rotationInterval: { type: Number, default: 10 },
    backgroundColor: { type: String, default: '#0a1929' },
    textColor: { type: String, default: '#ffffff' },
    accentColor: { type: String, default: '#4fc3f7' }
  },
  pageCustomization: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Ensure only one config document exists
configSchema.statics.getConfig = async function() {
  let config = await this.findOne();
  if (!config) {
    config = new this({});
    await config.save();
  }
  return config;
};

configSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Config', configSchema);
