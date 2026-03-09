const mongoose = require('mongoose');

const voiceProfileSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  voiceVector: {
    type: [Number], // Array of numbers representing the voice embedding
    required: true
  },
  voiceSampleFile: {
    type: String, // Path to the recorded voice sample
    default: null
  },
  standardSentence: {
    type: String,
    default: 'Hello, my name is {name} and I am ready for the meeting.'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  lastUsed: {
    type: Date,
    default: Date.now
  }
});

// Update updatedAt before saving
voiceProfileSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Index for faster lookups
voiceProfileSchema.index({ email: 1 });
voiceProfileSchema.index({ name: 1 });

module.exports = mongoose.model('VoiceProfile', voiceProfileSchema);
