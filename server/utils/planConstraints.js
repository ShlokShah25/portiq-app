const DEFAULT_PRODUCT = 'workplace';
const DEFAULT_PLAN = 'starter';

// Central definition of plan limits, kept in sync with marketing-site pricing copy.
// Education accounts use these same caps (keyed by admin.plan) until dedicated
// education tiers are defined.
const PLAN_LIMITS = {
  workplace: {
    starter: {
      maxParticipants: 10,
      maxParticipantsInBook: 30,
      maxDurationMinutes: 60,
      maxConcurrentMeetings: 1,
      /** Email “also send translated summary” (multi-language outbound) */
      allowsTranslatedSummary: false,
      /** Day-before + overdue action-item reminder emails */
      allowsActionItemReminders: false,
      /** Zoom/Teams conference hooks + future bot join (same for all plans) */
      allowsConferenceBots: true,
    },
    professional: {
      maxParticipants: 30,
      maxParticipantsInBook: 60,
      maxDurationMinutes: 180, // 3 hours
      maxConcurrentMeetings: 1,
      allowsTranslatedSummary: false,
      allowsActionItemReminders: true,
      allowsConferenceBots: true,
    },
    business: {
      maxParticipants: 60,
      maxParticipantsInBook: 100,
      maxDurationMinutes: 480, // 8 hours
      maxConcurrentMeetings: 3,
      allowsTranslatedSummary: true,
      allowsActionItemReminders: true,
      allowsConferenceBots: true,
    },
    /** Campuses & enterprises — set manually / contract (no default Razorpay plan) */
    institutional: {
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
  const limits =
    byProduct[plan] || byProduct[DEFAULT_PLAN] || PLAN_LIMITS.workplace.starter;

  return {
    product,
    plan,
    ...limits,
  };
}

module.exports = {
  getPlanConstraints,
};

