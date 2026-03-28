const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');

const router = express.Router();

function getAdminFromToken(req) {
  try {
    const header = req.header('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.replace('Bearer ', '') : null;
    if (!token) return null;
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_secret_key');
    if (!decoded.id) return null;
    return decoded;
  } catch {
    return null;
  }
}

// Initialize Razorpay client if keys are present
let razorpay = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
} else {
  console.warn(
    '⚠️ RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is not set. /api/create-subscription will return an error until these are configured.'
  );
}

// Helper to resolve plan id from env by planType/productType
function resolvePlanId(planType, productType) {
  const type = (planType || '').toLowerCase();
  const product = (productType || 'workplace').toLowerCase();

  const map = {
    workplace: {
      starter:
        process.env.RAZORPAY_PLAN_WORKPLACE_STARTER ||
        process.env.RAZORPAY_PLAN_STARTER,
      professional:
        process.env.RAZORPAY_PLAN_WORKPLACE_PROFESSIONAL ||
        process.env.RAZORPAY_PLAN_PROFESSIONAL,
      business:
        process.env.RAZORPAY_PLAN_WORKPLACE_BUSINESS ||
        process.env.RAZORPAY_PLAN_BUSINESS,
    },
    education: {
      education: process.env.RAZORPAY_PLAN_EDU_BASE,
      education_plus: process.env.RAZORPAY_PLAN_EDU_PLUS,
      education_plus_hw: process.env.RAZORPAY_PLAN_EDU_PLUS, // alias
    },
  };

  const byProduct = map[product] || {};
  const fromMap = byProduct[type];
  if (fromMap) return fromMap;

  // Fallback to a single default plan id if provided
  return process.env.RAZORPAY_DEFAULT_PLAN_ID || null;
}

/**
 * Create Razorpay subscription for SaaS checkout.
 * Expects: { planType, productType, quantity, username } (username for webhook to activate account)
 */
router.post('/create-subscription', async (req, res) => {
  try {
    if (!razorpay) {
      return res.status(500).json({
        error:
          'Razorpay is not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.',
      });
    }

    const { planType, productType, quantity, username } = req.body || {};

    if (!planType) {
      return res.status(400).json({ error: 'planType is required' });
    }

    if (String(planType).toLowerCase() === 'institutional') {
      return res.status(400).json({
        error:
          'Institutional plans are sold through sales. Email help@portiqtechnologies.com to discuss pricing and limits.',
      });
    }

    const planId = resolvePlanId(planType, productType);
    if (!planId) {
      return res.status(500).json({
        error: 'No Razorpay plan configured.',
        errorDetail: `Set RAZORPAY_PLAN_${(productType || 'workplace').toUpperCase()}_${String(planType).toUpperCase()} or RAZORPAY_PLAN_${String(planType).toUpperCase()} in env for plan "${planType}" / product "${productType || 'workplace'}".`,
      });
    }

    const qty = Number.isFinite(quantity) ? Number(quantity) || 1 : 1;
    const notes = {
      productType: productType || 'workplace',
      planType,
    };
    if (username && String(username).trim()) {
      notes.username = String(username).trim();
    }

    const subscription = await razorpay.subscriptions.create({
      plan_id: planId,
      total_count: 12,
      quantity: qty,
      notes,
    });

    return res.status(200).json({
      success: true,
      subscriptionId: subscription.id,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error('Create subscription error:', err);
    const message = err.message || String(err);
    const detail =
      err.description ||
      err.error?.description ||
      err.reason ||
      err.response?.data?.error?.description ||
      err.response?.data?.description ||
      (typeof err.response?.data === 'string' ? err.response.data : null) ||
      message;
    return res.status(500).json({
      error: 'Failed to create subscription.',
      errorDetail: detail,
    });
  }
});

/**
 * Cancel subscription for the authenticated admin. Stops future payments.
 */
router.post('/cancel-subscription', async (req, res) => {
  try {
    const decoded = getAdminFromToken(req);
    if (!decoded || !decoded.id) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }
    const admin = await Admin.findById(decoded.id);
    if (!admin) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }
    const subId = admin.razorpaySubscriptionId;
    if (!subId || !razorpay) {
      admin.razorpaySubscriptionId = null;
      if (!admin.complimentaryAccess) {
        admin.hasActiveSubscription = false;
      }
      await admin.save();
      return res.status(200).json({
        success: true,
        message: admin.complimentaryAccess
          ? 'No billing subscription on file.'
          : 'Subscription cancelled.',
      });
    }
    try {
      await razorpay.subscriptions.cancel(subId);
    } catch (e) {
      if (e.statusCode === 400 && /already cancelled|not found/i.test((e.error?.description || e.message || ''))) {
        admin.hasActiveSubscription = false;
        admin.razorpaySubscriptionId = null;
        await admin.save();
        return res.status(200).json({ success: true, message: 'Subscription cancelled.' });
      }
      console.error('Razorpay cancel error:', e);
      return res.status(500).json({ error: 'Failed to cancel with payment provider. Try again or contact support.' });
    }
    admin.hasActiveSubscription = false;
    admin.razorpaySubscriptionId = null;
    await admin.save();
    return res.status(200).json({ success: true, message: 'Subscription cancelled. No further charges will be made.' });
  } catch (err) {
    console.error('Cancel subscription error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
});

/**
 * Razorpay webhook: on subscription.activated, set hasActiveSubscription and plan for the admin.
 * Called from index.js with raw body. req.body is a Buffer.
 */
async function handleWebhook(req, res) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('RAZORPAY_WEBHOOK_SECRET not set; webhook ignored');
    return res.status(200).send('OK');
  }
  const signature = req.headers['x-razorpay-signature'];
  if (!signature || !req.body) {
    return res.status(400).send('Bad Request');
  }
  const body = typeof req.body === 'string' ? req.body : req.body.toString ? req.body.toString('utf8') : '';
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  if (expected !== signature) {
    console.warn('Razorpay webhook signature mismatch');
    return res.status(400).send('Bad Request');
  }
  let event;
  try {
    event = JSON.parse(body);
  } catch (e) {
    return res.status(400).send('Bad Request');
  }
  const subId = event.payload?.subscription?.entity?.id;
  const eventName = event.event;

  /**
   * Fetch subscription from Razorpay and sync admin: id + plan + hasActiveSubscription (true only when status is active).
   * Used for subscription.authenticated (mandate done, payment may be pending) and subscription.activated.
   */
  async function syncSubscriptionById(id) {
    if (!id || !razorpay) return;
    try {
      const sub = await razorpay.subscriptions.fetch(id);
      const notes = sub.notes || {};
      const username = notes.username;
      if (!username) return;
      const admin = await Admin.findOne({ username });
      if (!admin) return;
      admin.razorpaySubscriptionId = id;
      if (notes.planType) admin.plan = String(notes.planType).toLowerCase();
      admin.hasActiveSubscription = sub.status === 'active';
      await admin.save();
      console.log('Subscription sync for', username, 'status=', sub.status);
    } catch (e) {
      console.error('Webhook subscription sync error:', e);
    }
  }

  if (
    (eventName === 'subscription.authenticated' || eventName === 'subscription.activated') &&
    subId &&
    razorpay
  ) {
    await syncSubscriptionById(subId);
    return res.status(200).send('OK');
  }

  if (eventName === 'subscription.halted' && subId) {
    try {
      const admin = await Admin.findOne({ razorpaySubscriptionId: subId });
      if (admin) {
        admin.hasActiveSubscription = false;
        await admin.save();
        console.log('Subscription halted for admin:', admin.username);
      }
    } catch (e) {
      console.error('Webhook subscription.halted processing error:', e);
    }
    return res.status(200).send('OK');
  }

  if ((eventName === 'subscription.cancelled' || eventName === 'subscription.completed') && subId) {
    try {
      const admin = await Admin.findOne({ razorpaySubscriptionId: subId });
      if (admin) {
        admin.hasActiveSubscription = false;
        admin.razorpaySubscriptionId = null;
        await admin.save();
        console.log('Subscription cancelled/completed for admin:', admin.username);
      }
    } catch (e) {
      console.error('Webhook subscription.cancelled/completed processing error:', e);
    }
    return res.status(200).send('OK');
  }

  return res.status(200).send('OK');
}

module.exports = router;
module.exports.handleWebhook = handleWebhook;

