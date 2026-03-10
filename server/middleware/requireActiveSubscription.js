const Organization = require('../models/Organization');

/**
 * Subscription guard middleware.
 *
 * This prevents organizations without an active paid subscription from
 * accessing core product APIs. It is intended to sit *after* auth
 * middleware so that req.user or req.admin is available.
 */
async function requireActiveSubscription(req, res, next) {
  try {
    // Support both "user" style auth and admin auth.
    const orgId =
      (req.user && req.user.organizationId) ||
      (req.admin && req.admin.organizationId) ||
      null;

    if (!orgId) {
      return res.status(403).json({
        message: 'Subscription required to access this feature'
      });
    }

    const org = await Organization.findById(orgId);
    if (!org) {
      return res.status(403).json({
        message: 'Subscription required to access this feature'
      });
    }

    if (org.subscriptionStatus !== 'active') {
      return res.status(403).json({
        message: 'Subscription required to access this feature'
      });
    }

    // Subscription is active – allow request through.
    next();
  } catch (error) {
    console.error('requireActiveSubscription error:', error);
    return res.status(500).json({
      message: 'Failed to verify subscription status'
    });
  }
}

module.exports = { requireActiveSubscription };

