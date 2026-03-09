/**
 * Subscription middleware for protecting authenticated user routes.
 *
 * This does NOT hook into any existing routes by default to avoid
 * breaking current behavior. When you introduce user login / JWT
 * for SaaS tenants, attach this middleware after your auth step.
 *
 * Example usage:
 *   const { requireActiveSubscription } = require('./middleware/subscription');
 *   router.get('/dashboard', authenticateUser, requireActiveSubscription, handler);
 */

function requireActiveSubscription(req, res, next) {
  // This assumes you will attach a `user` object to req in your
  // own authentication middleware, with subscription fields like:
  // - req.user.subscription_status
  // - req.user.plan

  const user = req.user;

  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (user.subscription_status !== 'active') {
    // On an API, we just report the status; your frontend can redirect to /pricing
    return res.status(402).json({
      error: 'Subscription inactive',
      redirectTo: '/pricing'
    });
  }

  return next();
}

module.exports = { requireActiveSubscription };

