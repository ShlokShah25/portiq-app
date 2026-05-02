/**
 * Trial + subscription gates for the client app.
 * Trial = full product (usage limits enforced in planConstraints + meeting creation).
 */

const TRIAL_MEETING_LIMIT = 3;
const MINUTES_SAVED_PER_MEETING = 12;

function isLegacyAdmin(admin) {
  return String(admin?.username || '').toLowerCase() === 'admin';
}

/** Accounts that use the 3-meeting free trial (not paid, not complimentary, not legacy). */
function isTrialEligibleAccount(admin) {
  if (!admin) return false;
  if (isLegacyAdmin(admin)) return false;
  if (admin.hasActiveSubscription) return false;
  if (admin.complimentaryAccess) return false;
  return true;
}

/**
 * @returns {number|null} null if trial limits do not apply; else meetings remaining (0..TRIAL_MEETING_LIMIT).
 */
function trialMeetingsRemaining(admin) {
  if (!admin || !isTrialEligibleAccount(admin)) return null;
  const used = Math.max(0, Number(admin.trialMeetingsUsed) || 0);
  return Math.max(0, TRIAL_MEETING_LIMIT - used);
}

/**
 * App shell (sidebar, dashboard): legacy demo, paid, complimentary, or free trial with meetings left.
 * Inactive paid (Razorpay row but not active), exhausted trial, or no entitlements → no access (must use login flow).
 */
function hasDashboardAccess(admin) {
  if (!admin) return false;
  if (isLegacyAdmin(admin)) return true;
  if (admin.complimentaryAccess) return true;
  if (admin.hasActiveSubscription) return true;
  if (admin.razorpaySubscriptionId && !admin.hasActiveSubscription) return false;
  const remaining = trialMeetingsRemaining(admin);
  if (remaining != null && remaining > 0) return true;
  return false;
}

/**
 * Block creating new meetings when payment is incomplete or trial is exhausted.
 */
function subscriptionDeniedResponse(admin) {
  if (!admin) {
    return {
      status: 401,
      json: { error: 'Sign in to create meetings.', code: 'UNAUTHORIZED' },
    };
  }
  if (isLegacyAdmin(admin)) return null;
  if (admin.hasActiveSubscription) return null;
  if (admin.complimentaryAccess) return null;

  if (admin.razorpaySubscriptionId && !admin.hasActiveSubscription) {
    return {
      status: 403,
      json: {
        error: "Finish your plan payment and you're good to go.",
        details: 'Complete payment to activate your plan.',
        code: 'SUBSCRIPTION_PAYMENT_PENDING',
      },
    };
  }

  const remaining = trialMeetingsRemaining(admin);
  if (remaining !== null && remaining <= 0) {
    return {
      status: 403,
      json: {
        error: "You've reached your free meeting allowance.",
        details: 'Upgrade when you’re ready to keep creating meetings.',
        code: 'TRIAL_LIMIT_REACHED',
      },
    };
  }

  return null;
}

/**
 * Only block when Razorpay subscription exists but is not active (e.g. follow-up / end session flows).
 */
function subscriptionPaymentPendingResponse(admin) {
  if (!admin) {
    return {
      status: 401,
      json: { error: 'Sign in required.', code: 'UNAUTHORIZED' },
    };
  }
  if (isLegacyAdmin(admin)) return null;
  if (admin.hasActiveSubscription) return null;
  if (admin.complimentaryAccess) return null;
  if (admin.razorpaySubscriptionId && !admin.hasActiveSubscription) {
    return {
      status: 403,
      json: {
        error: "Finish your plan payment and you're good to go.",
        details: 'Complete payment to activate your plan.',
        code: 'SUBSCRIPTION_PAYMENT_PENDING',
      },
    };
  }
  return null;
}

module.exports = {
  TRIAL_MEETING_LIMIT,
  MINUTES_SAVED_PER_MEETING,
  trialMeetingsRemaining,
  hasDashboardAccess,
  subscriptionDeniedResponse,
  subscriptionPaymentPendingResponse,
};
