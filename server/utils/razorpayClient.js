const Razorpay = require('razorpay');

/**
 * Shared Razorpay client instance.
 *
 * Requires the following environment variables:
 * - RAZORPAY_KEY_ID
 * - RAZORPAY_KEY_SECRET
 */
let razorpay = null;

function getRazorpayClient() {
  if (razorpay) return razorpay;

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error('RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is not configured in environment');
  }

  razorpay = new Razorpay({
    key_id: keyId,
    key_secret: keySecret
  });

  return razorpay;
}

module.exports = { getRazorpayClient };

