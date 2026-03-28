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
    enum: ['starter', 'professional', 'business', 'institutional'],
    default: 'starter'
  },
  // Gate dashboard access: only true after a subscription is active (e.g. Razorpay webhook).
  hasActiveSubscription: {
    type: Boolean,
    default: false
  },
  /** Full app access without billing (e.g. internal demo / partner). Plan field still applies. */
  complimentaryAccess: {
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
  },
  /** Set when user completes Zoom/Teams OAuth (or manual confirm until OAuth ships). */
  meetingPlatforms: {
    zoom: { type: Boolean, default: false },
    teams: { type: Boolean, default: false },
  },
  /** Zoom user OAuth tokens (never returned in API JSON). */
  zoomOAuth: {
    accessToken: { type: String, default: null, select: false },
    refreshToken: { type: String, default: null, select: false },
    expiresAt: { type: Date, default: null },
    scope: { type: String, default: null },
    accountId: { type: String, default: null },
    email: { type: String, default: null },
  },
  /** Microsoft Graph delegated tokens for Teams-related features. */
  teamsOAuth: {
    accessToken: { type: String, default: null, select: false },
    refreshToken: { type: String, default: null, select: false },
    expiresAt: { type: Date, default: null },
    scope: { type: String, default: null },
    tenantId: { type: String, default: null },
    userPrincipalName: { type: String, default: null },
  },
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
