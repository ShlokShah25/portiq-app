/**
 * When an admin is logged in but may not create meetings:
 * - SUBSCRIPTION_INACTIVE: no plan / cancelled / never subscribed
 * - SUBSCRIPTION_PAYMENT_PENDING: Razorpay subscription exists but not active yet (e.g. payment incomplete)
 */
function subscriptionDeniedResponse(admin) {
  if (!admin || admin.username === 'admin' || admin.hasActiveSubscription) {
    return null;
  }
  const paymentPending = !!admin.razorpaySubscriptionId;
  if (paymentPending) {
    return {
      status: 403,
      json: {
        error: "Finish your plan payment and you're good to go.",
        code: 'SUBSCRIPTION_PAYMENT_PENDING',
      },
    };
  }
  return {
    status: 403,
    json: {
      error: 'No active plan right now. Pick one on the site to create meetings.',
      code: 'SUBSCRIPTION_INACTIVE',
    },
  };
}

module.exports = { subscriptionDeniedResponse };
