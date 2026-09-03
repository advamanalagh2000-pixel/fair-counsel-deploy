/**
 * Payment provider adapter (Razorpay).
 *
 * If RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are set in .env, this uses the real
 * Razorpay SDK in TEST MODE (Razorpay test keys, not live ones — get them free
 * from the Razorpay dashboard, no business verification needed for test mode).
 *
 * If no keys are set, it falls back to a local mock that simulates order
 * creation + payment capture so the rest of the app (booking, ledger, case
 * tracker) is fully testable before you've set up a Razorpay account.
 *
 * Swapping to Stripe instead: replace the two functions below with Stripe's
 * PaymentIntent equivalents — routes/payments.js doesn't need to change.
 */
const crypto = require('crypto');

const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const MOCK_MODE = !KEY_ID || !KEY_SECRET;

let razorpay = null;
if (!MOCK_MODE) {
  const Razorpay = require('razorpay');
  razorpay = new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET });
}

/** Create a payable order for a given amount (in paise) and case reference. */
async function createOrder({ amountPaise, currency = 'INR', receipt, notes }) {
  if (MOCK_MODE) {
    const id = 'order_mock_' + crypto.randomBytes(8).toString('hex');
    return { id, amount: amountPaise, currency, receipt, mock: true };
  }
  return razorpay.orders.create({ amount: amountPaise, currency, receipt, notes });
}

/**
 * Verify a payment signature from Razorpay's client-side checkout callback.
 * In mock mode, any payment with a `mock_` prefixed payment id is accepted —
 * this only exists so the full flow is clickable end-to-end without real keys.
 */
function verifyPaymentSignature({ orderId, paymentId, signature }) {
  if (MOCK_MODE) {
    return typeof paymentId === 'string' && paymentId.startsWith('pay_mock_');
  }
  const expected = crypto
    .createHmac('sha256', KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return expected === signature;
}

/** Verify a Razorpay webhook payload signature (for the /webhooks/razorpay route). */
function verifyWebhookSignature(rawBody, signatureHeader) {
  if (MOCK_MODE) return true; // no real webhooks in mock mode
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET || '')
    .update(rawBody)
    .digest('hex');
  return expected === signatureHeader;
}

module.exports = { createOrder, verifyPaymentSignature, verifyWebhookSignature, MOCK_MODE };
