const express = require('express');
const Razorpay = require('razorpay');

const router = express.Router();

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
      starter: process.env.RAZORPAY_PLAN_WORKPLACE_STARTER,
      professional: process.env.RAZORPAY_PLAN_WORKPLACE_PROFESSIONAL,
      business: process.env.RAZORPAY_PLAN_WORKPLACE_BUSINESS,
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
 * Expects: { planType, productType, quantity }
 */
router.post('/create-subscription', async (req, res) => {
  try {
    if (!razorpay) {
      return res.status(500).json({
        error:
          'Razorpay is not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.',
      });
    }

    const { planType, productType, quantity } = req.body || {};

    if (!planType) {
      return res.status(400).json({ error: 'planType is required' });
    }

    const planId = resolvePlanId(planType, productType);
    if (!planId) {
      return res.status(500).json({
        error:
          'No Razorpay plan configured for this planType/productType. Please set the appropriate RAZORPAY_PLAN_* env vars.',
      });
    }

    const qty = Number.isFinite(quantity) ? Number(quantity) || 1 : 1;

    const subscription = await razorpay.subscriptions.create({
      plan_id: planId,
      total_count: 12, // e.g. 12 months; adjust as needed in Razorpay dashboard
      quantity: qty,
      notes: {
        productType: productType || 'workplace',
        planType,
      },
    });

    return res.status(200).json({
      success: true,
      subscriptionId: subscription.id,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error('Create subscription error:', err);
    return res
      .status(500)
      .json({ error: 'Failed to create subscription. Please try again.' });
  }
});

module.exports = router;

