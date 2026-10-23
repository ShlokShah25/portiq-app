const { trialMeetingsRemaining } = require('./subscriptionGate');

const DEFAULT_PRODUCT = 'workplace';
const DEFAULT_PLAN = 'starter';

// Central definition of plan limits (enforced server-side). Marketing highlights features; caps surface in-app.
// Education accounts use these same caps (keyed by admin.plan) until dedicated
// education tiers are defined.
const PLAN_LIMITS = {
  workplace: {
    starter: {
      maxParticipants: 10,
      maxParticipantsInBook: 20,
      maxDurationMinutes: 90, // Workspace Starter: 90 min per meeting keeps the plan's AI cost bounded
      maxConcurrentMeetings: 1,
      /** On-screen live transcript while recording (an extra transcription pass). Off by default on Starter; users can turn it on per meeting. */
      livePreviewDefault: false,
      /** Email “also send translated summary” (multi-language outbound) */
      allowsTranslatedSummary: false,
      /** Day-before + overdue action-item reminder emails */
      allowsActionItemReminders: false,
      /** Zoom/Teams conference hooks + future bot join (same for all plans) */
      allowsConferenceBots: true,
    },
    professional: {
      livePreviewDefault: true,
      maxParticipants: 20,
      maxParticipantsInBook: 40,
      maxDurationMinutes: 180, // 3 hours
      maxConcurrentMeetings: 1,
      allowsTranslatedSummary: false,
      allowsActionItemReminders: true,
      allowsConferenceBots: true,
    },
    business: {
      livePreviewDefault: true,
      maxParticipants: 30,
      maxParticipantsInBook: 60,
      maxDurationMinutes: 480, // 8 hours
      maxConcurrentMeetings: 3,
      allowsTranslatedSummary: true,
      allowsActionItemReminders: true,
      allowsConferenceBots: true,
    },
    /** Campuses & enterprises — set manually / contract (no default Razorpay plan) */
    institutional: {
      livePreviewDefault: true,
      maxParticipants: 200,
      maxParticipantsInBook: 500,
      maxDurationMinutes: 1440, // 24 hours
      maxConcurrentMeetings: 25,
      allowsTranslatedSummary: true,
      allowsActionItemReminders: true,
      allowsConferenceBots: true,
    },
  },
};

function resolveProductAndPlan(admin) {
  const product =
    (admin?.productType || '').toLowerCase() || DEFAULT_PRODUCT;
  const plan = (admin?.plan || '').toLowerCase() || DEFAULT_PLAN;
  return { product, plan };
}

function getPlanConstraints(admin) {
  const { product, plan } = resolveProductAndPlan(admin);
  const byProduct = PLAN_LIMITS.workplace;

  const rem = trialMeetingsRemaining(admin);
  const trialing =
    rem !== null &&
    rem > 0 &&
    admin &&
    !admin.hasActiveSubscription &&
    !admin.complimentaryAccess &&
    String(admin.username || '').toLowerCase() !== 'admin';

  if (trialing) {
    return {
      product,
      plan: 'business',
      ...byProduct.business,
    };
  }

  const limits = {
    ...(byProduct[plan] || byProduct[DEFAULT_PLAN] || PLAN_LIMITS.workplace.starter),
  };
  // Education lectures and labs run long and the live transcript is part of the classroom
  // experience, so education keeps the 3-hour cap and live preview on at every tier.
  if (product === 'education') {
    limits.maxDurationMinutes = Math.max(180, Number(limits.maxDurationMinutes) || 0);
    limits.livePreviewDefault = true;
  }

  return {
    product,
    plan,
    ...limits,
  };
}

module.exports = {
  getPlanConstraints,
};

