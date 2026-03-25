const DEFAULT_PRODUCT = 'workplace';
const DEFAULT_PLAN = 'starter';

// Central definition of plan limits, kept in sync with marketing-site pricing copy.
// Education accounts use these same caps (keyed by admin.plan) until dedicated
// education tiers are defined.
const PLAN_LIMITS = {
  workplace: {
    starter: {
      maxParticipants: 10,
      maxParticipantsInBook: 20,
      maxDurationMinutes: 60,
      maxConcurrentMeetings: 1,
      /** Email “also send translated summary” (multi-language outbound) */
      allowsTranslatedSummary: false,
      /** Day-before + overdue action-item reminder emails */
      allowsActionItemReminders: false,
    },
    professional: {
      maxParticipants: 20,
      maxParticipantsInBook: 40,
      maxDurationMinutes: 180, // 3 hours
      maxConcurrentMeetings: 1,
      allowsTranslatedSummary: false,
      allowsActionItemReminders: true,
    },
    business: {
      maxParticipants: 30,
      maxParticipantsInBook: 60,
      maxDurationMinutes: 480, // 8 hours
      maxConcurrentMeetings: 3,
      allowsTranslatedSummary: true,
      allowsActionItemReminders: true,
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

