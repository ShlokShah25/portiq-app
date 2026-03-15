const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    index: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['super_admin', 'admin', 'faculty'],
    default: 'admin'
  },
  lastLogin: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  // SaaS product + plan info
  productType: {
    type: String,
    enum: ['workplace', 'education'],
    default: 'workplace'
  },
  plan: {
    type: String,
    enum: ['starter', 'professional', 'business'],
    default: 'starter'
  },
  // Gate dashboard access: only true after a subscription is active (e.g. Razorpay webhook).
  hasActiveSubscription: {
    type: Boolean,
    default: false
  },
  // Razorpay subscription id (set on subscription.activated) so we can cancel via API.
  razorpaySubscriptionId: {
    type: String,
    default: null,
    trim: true
  },
  // Optional fields used for password reset flow
  resetToken: {
    type: String,
    default: null
  },
  resetTokenExpires: {
    type: Date,
    default: null
  },
  // Participant book: persisted per admin so it's available across devices/sessions
  savedParticipants: {
    type: [{ name: String, email: String }],
    default: []
  }
});

// Hash password before saving
adminSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Compare password method
adminSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('Admin', adminSchema);
