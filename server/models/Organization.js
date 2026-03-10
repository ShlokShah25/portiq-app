const mongoose = require('mongoose');

/**
 * Organization model
 *
 * This enables multi-tenant data isolation by grouping admins/users,
 * meetings, and other resources under a specific organization.
 */
const organizationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  logoUrl: {
    type: String,
    default: null
  },
  /**
   * Current subscription plan for this organization (e.g. starter/professional/business).
   * Used together with subscriptionStatus to gate product access.
   */
  plan: {
    type: String,
    default: null
  },
  /**
   * High-level subscription state used for access control.
   * Only organizations with subscriptionStatus === "active" are allowed
   * to access product APIs via the requireActiveSubscription middleware.
   */
  subscriptionStatus: {
    type: String,
    enum: ['pending', 'active', 'cancelled'],
    default: 'pending'
  },
  /**
   * Last known Razorpay subscription ID for this organization.
   * Populated from Razorpay webhooks to keep billing and access aligned.
   */
  razorpaySubscriptionId: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Organization', organizationSchema);

