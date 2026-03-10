const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { getRazorpayClient } = require('../utils/razorpayClient');
const Organization = require('../models/Organization');
const { authenticateAdmin } = require('../middleware/auth');
const { requireActiveSubscription } = require('../middleware/requireActiveSubscription');

/**
 * POST /api/create-subscription
 *
 * Creates a Razorpay subscription for the requested plan type.
 *
 * Body:
 * - planType: "starter" | "professional" | "business"
 *
 * Response:
 * {
 *   subscriptionId: string,
 *   keyId: string
 * }
 */
router.post('/create-subscription', async (req, res) => {
  try {
    const { planType, customerEmail, organizationId } = req.body || {};

    if (!planType) {
      return res.status(400).json({ error: 'planType is required' });
    }

    // Map logical plan names to Razorpay plan IDs
    const planMap = {
      starter: "plan_SPFmcDcdszQQ0m",
      professional: "plan_SPFn1zTaawJWmb",
      business: "plan_SPFnmnSdQGeKuT"
    };

    const planId = planMap[planType];
    if (!planId) {
      return res.status(400).json({ error: 'Invalid planType' });
    }

    const razorpay = getRazorpayClient();

    // Build notes so webhook can later map subscription back to org/user
    const notes = {};
    if (customerEmail) notes.email = customerEmail;
    if (organizationId) notes.organizationId = organizationId;

    // Create subscription – assumes plans are already created in Razorpay dashboard
    const subscription = await razorpay.subscriptions.create({
      plan_id: planId,
      total_count: 0, // 0 => until cancelled (ongoing subscription)
      quantity: 1,
      notes
    });

    // Helpful log for deployment debugging
    console.log('[Razorpay] Subscription created:', {
      id: subscription.id,
      planType,
      planId
    });

    return res.json({
      subscriptionId: subscription.id,
      keyId: process.env.RAZORPAY_KEY_ID
    });
  } catch (error) {
    console.error('Error creating Razorpay subscription:', error);
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

/**
 * POST /api/billing/upgrade-plan
 *
 * Creates a new Razorpay subscription for an upgraded plan for the
 * currently authenticated organization. This keeps billing logic
 * organization-based rather than user-based.
 *
 * Body:
 * - newPlan: "professional" | "business"
 */
router.post('/billing/upgrade-plan', authenticateAdmin, requireActiveSubscription, async (req, res) => {
  try {
    const { newPlan } = req.body || {};

    if (!newPlan || !['professional', 'business'].includes(newPlan)) {
      return res.status(400).json({ error: 'newPlan must be "professional" or "business"' });
    }

    if (!req.admin.organizationId) {
      return res.status(400).json({ error: 'Admin is not associated with an organization' });
    }

    const organization = await Organization.findById(req.admin.organizationId);
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    if (organization.subscriptionStatus !== 'active') {
      return res.status(400).json({ error: 'Subscription must be active to upgrade plan' });
    }

    // Prevent downgrades: only allow moving up the ladder.
    const planOrder = { starter: 1, professional: 2, business: 3 };
    const currentPlanKey = organization.plan || 'starter';
    if (!planOrder[currentPlanKey]) {
      return res.status(400).json({ error: 'Current plan is not upgradeable' });
    }
    if (planOrder[newPlan] <= planOrder[currentPlanKey]) {
      return res.status(400).json({ error: 'Downgrades are not allowed at this time' });
    }

    // Map logical plan names to Razorpay plan IDs
    const planMap = {
      starter: 'plan_SPFmcDcdszQQ0m',
      professional: 'plan_SPFn1zTaawJWmb',
      business: 'plan_SPFnmnSdQGeKuT'
    };

    const newPlanId = planMap[newPlan];
    if (!newPlanId) {
      return res.status(400).json({ error: 'Invalid target plan' });
    }

    const razorpay = getRazorpayClient();

    // Notes help us link the upgraded subscription back to the organization
    const notes = {
      organizationId: organization._id.toString(),
      upgradedFrom: currentPlanKey
    };

    // Create upgraded subscription – total_count=12 as example yearly cycle
    const subscription = await razorpay.subscriptions.create({
      plan_id: newPlanId,
      customer_notify: 1,
      total_count: 12,
      notes
    });

    console.log('[Razorpay] Upgrade subscription created:', {
      id: subscription.id,
      from: currentPlanKey,
      to: newPlan
    });

    return res.json({
      subscriptionId: subscription.id,
      keyId: process.env.RAZORPAY_KEY_ID
    });
  } catch (error) {
    console.error('Error upgrading Razorpay subscription:', error);
    res.status(500).json({ error: 'Failed to upgrade subscription' });
  }
});

/**
 * POST /api/razorpay-webhook
 *
 * Razorpay webhook handler.
 * Verifies signature and reacts to:
 * - subscription.activated
 * - payment.captured
 * - payment.failed
 *
 * NOTE: This implementation logs events and sketches where you would
 * update your user/tenant subscription in the database.
 */
router.post('/razorpay-webhook', express.json({ type: '*/*' }), async (req, res) => {
  try {
    // Verify using the dedicated Razorpay webhook secret
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];

    if (!webhookSecret) {
      console.error('RAZORPAY_WEBHOOK_SECRET is not configured');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    const payload = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(payload)
      .digest('hex');

    if (expectedSignature !== signature) {
      console.warn('Invalid Razorpay webhook signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = req.body;
    const eventType = event.event;

    // Log every valid webhook for easier debugging
    console.log('[Razorpay Webhook] Event received:', eventType);

    // TODO: Replace this with real user lookup logic
    // e.g. use subscription_id or notes.userId / notes.email to find the user
    const logPrefix = `[Razorpay Webhook] ${eventType}`;

    switch (eventType) {
      case 'subscription.activated': {
        const subscription = event.payload.subscription?.entity;
        console.log(logPrefix, 'Subscription activated:', subscription?.id);

        // Determine plan type from plan_id mapping
        const planId = subscription?.plan_id;
        let plan = null;
        if (planId === 'plan_portiq_starter') plan = 'starter';
        else if (planId === 'plan_portiq_professional') plan = 'professional';
        else if (planId === 'plan_portiq_business') plan = 'business';

        // Link Razorpay subscription to organization and mark as active so
        // requireActiveSubscription will allow product access.
        const orgIdFromNotes = subscription?.notes?.organizationId;
        if (orgIdFromNotes) {
          await Organization.findByIdAndUpdate(orgIdFromNotes, {
            $set: {
              subscriptionStatus: 'active',
              plan,
              razorpaySubscriptionId: subscription.id
            }
          });
        }

        console.log(logPrefix, 'Plan activated:', plan || planId);
        break;
      }

      case 'subscription.cancelled':
      case 'subscription.completed': {
        const subscription = event.payload.subscription?.entity;
        console.log(logPrefix, 'Subscription ended:', subscription?.id, 'status:', subscription?.status);

        const orgIdFromNotes = subscription?.notes?.organizationId;
        if (orgIdFromNotes) {
          await Organization.findByIdAndUpdate(orgIdFromNotes, {
            $set: {
              subscriptionStatus: 'cancelled'
            }
          });
        }
        break;
      }

      case 'subscription.charged': {
        const subscription = event.payload.subscription?.entity;
        console.log(logPrefix, 'Subscription charged (recurring payment):', subscription?.id);
        // Optionally record recurring billing events for analytics/audit logs.
        break;
      }

      case 'payment.captured': {
        const payment = event.payload.payment?.entity;
        console.log(logPrefix, 'Payment captured:', payment?.id, 'amount:', payment?.amount);
        break;
      }

      case 'payment.failed': {
        const payment = event.payload.payment?.entity;
        console.log(logPrefix, 'Payment failed:', payment?.id, 'reason:', payment?.error_reason);
        break;
      }

      default:
        console.log('[Razorpay Webhook] Unhandled event type:', eventType);
    }

    res.json({ status: 'ok' });
  } catch (error) {
    console.error('Error handling Razorpay webhook:', error);
    res.status(500).json({ error: 'Webhook handling failed' });
  }
});

module.exports = router;

