const DEFAULT_PRODUCT = 'workplace';
const DEFAULT_PLAN = 'starter';

// Central definition of plan limits, kept in sync with marketing-site pricing copy.
const PLAN_LIMITS = {
  workplace: {
    starter: {
      maxParticipants: 10,
      maxParticipantsInBook: 30,
      maxDurationMinutes: 60,
      maxConcurrentMeetings: 1,
    },
    professional: {
      maxParticipants: 30,
      maxParticipantsInBook: 60,
      maxDurationMinutes: 180, // 3 hours
      maxConcurrentMeetings: 1,
    },
    business: {
      maxParticipants: 60,
      maxParticipantsInBook: 100,
      maxDurationMinutes: 480, // 8 hours
      maxConcurrentMeetings: 3,
    },
  },
  // Education plans are currently unconstrained at the app level.
  education: {
    base: {
      maxParticipants: null,
      maxParticipantsInBook: null,
      maxDurationMinutes: null,
      maxConcurrentMeetings: null,
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
  const byProduct = PLAN_LIMITS[product] || PLAN_LIMITS[DEFAULT_PRODUCT];
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

