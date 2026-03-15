const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');

/**
 * Verify JWT token for admin routes
 */
const authenticateAdmin = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_secret_key');
    const admin = await Admin.findById(decoded.id).select('-password');
    
    if (!admin) {
      return res.status(401).json({ error: 'Invalid token.' });
    }

    req.admin = admin;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token.' });
  }
};

/**
 * Require active subscription (use after authenticateAdmin).
 * Legacy 'admin' user is always allowed. Returns 403 with code NO_SUBSCRIPTION so client can redirect to pricing.
 */
const requireSubscription = (req, res, next) => {
  if (!req.admin) return res.status(401).json({ error: 'Unauthorized' });
  if (req.admin.username === 'admin') return next();
  if (req.admin.hasActiveSubscription) return next();
  return res.status(403).json({
    error: 'No active subscription. Please purchase a plan from the website to access the dashboard.',
    code: 'NO_SUBSCRIPTION',
  });
};

module.exports = { authenticateAdmin, requireSubscription };
