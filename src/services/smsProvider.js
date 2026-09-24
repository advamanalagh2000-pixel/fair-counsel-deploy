/**
 * OTP delivery adapter. WhatsApp is the default channel (set by the caller via
 * `channel`), with SMS as an explicit fallback, matching how OTP delivery works
 * for most Indian consumer apps. routes/auth.js never talks to a specific vendor
 * directly, it calls sendOtp(phone, code, channel) and this module decides how
 * that actually happens, so swapping providers means editing only this file.
 *
 * PRODUCTION SETUP (pick one per channel):
 *   WhatsApp: WHATSAPP_PROVIDER=meta|twilio|gupshup, see .env.example for the
 *     credentials each one needs (Meta WhatsApp Cloud API, Twilio, or Gupshup).
 *   SMS:      SMS_PROVIDER=msg91|twilio (any DLT-registered Indian SMS provider
 *             is required for transactional SMS in India).
 *
 * Until real credentials are set, this runs in TEST MODE: no real message is
 * sent, the code is logged to the server console, and (only when
 * NODE_ENV !== 'production') echoed back in the API response so the frontend
 * can display it during development.
 */

const WHATSAPP_PROVIDER = process.env.WHATSAPP_PROVIDER || '';
const SMS_PROVIDER = process.env.SMS_PROVIDER || '';

async function sendViaMetaWhatsApp(phone, code) {
  // const res = await fetch(`https://graph.facebook.com/v19.0/${process.env.META_PHONE_NUMBER_ID}/messages`, {
  //   method: 'POST',
  //   headers: { Authorization: `Bearer ${process.env.META_WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
  //   body: JSON.stringify({
  //     messaging_product: 'whatsapp', to: `91${phone}`, type: 'template',
  //     template: { name: 'otp_login', language: { code: 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: code }] }] }
  //   })
  // });
  // if (!res.ok) throw new Error('Meta WhatsApp send failed: ' + res.status);
  throw new Error('Meta WhatsApp not configured, add META_WHATSAPP_TOKEN/META_PHONE_NUMBER_ID to .env and complete sendViaMetaWhatsApp()');
}

let twilioClient = null;
function getTwilioClient() {
  if (!process.env.TWILIO_SID || !process.env.TWILIO_AUTH_TOKEN) {
    throw new Error('Twilio not configured, add TWILIO_SID and TWILIO_AUTH_TOKEN to .env');
  }
  if (!twilioClient) {
    twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
}

async function sendViaTwilioWhatsApp(phone, code) {
  if (!process.env.TWILIO_WHATSAPP_FROM) {
    throw new Error('TWILIO_WHATSAPP_FROM not set, use the sandbox number (whatsapp:+14155238886) for testing, or your own approved sender for production');
  }
  const client = getTwilioClient();
  await client.messages.create({
    body: `Your Fair Counsel verification code is ${code}`,
    from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`,
    to: `whatsapp:+91${phone}`
  });
}

async function sendViaGupshup(phone, code) {
  // const res = await fetch('https://api.gupshup.io/wa/api/v1/template/msg', {
  //   method: 'POST',
  //   headers: { apikey: process.env.GUPSHUP_API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
  //   body: new URLSearchParams({ source: process.env.GUPSHUP_SOURCE, destination: `91${phone}`, template: JSON.stringify({ id: process.env.GUPSHUP_TEMPLATE_ID, params: [code] }) })
  // });
  // if (!res.ok) throw new Error('Gupshup send failed: ' + res.status);
  throw new Error('Gupshup not configured, add GUPSHUP_API_KEY/GUPSHUP_SOURCE/GUPSHUP_TEMPLATE_ID to .env and complete sendViaGupshup()');
}

async function sendViaMsg91(phone, code) {
  // const res = await fetch(`https://api.msg91.com/api/v5/otp?otp=${code}&mobile=91${phone}`, {
  //   headers: { authkey: process.env.MSG91_AUTH_KEY }
  // });
  // if (!res.ok) throw new Error('MSG91 send failed: ' + res.status);
  throw new Error('MSG91 not configured, add MSG91_AUTH_KEY to .env and complete sendViaMsg91()');
}

async function sendViaTwilioSms(phone, code) {
  if (!process.env.TWILIO_FROM_NUMBER) {
    throw new Error('TWILIO_FROM_NUMBER not set, add your Twilio SMS-capable number to .env');
  }
  const client = getTwilioClient();
  await client.messages.create({
    body: `Your Fair Counsel verification code is ${code}`,
    from: process.env.TWILIO_FROM_NUMBER,
    to: `+91${phone}`
  });
}

async function sendWhatsApp(phone, code) {
  if (WHATSAPP_PROVIDER === 'meta') return sendViaMetaWhatsApp(phone, code);
  if (WHATSAPP_PROVIDER === 'twilio') return sendViaTwilioWhatsApp(phone, code);
  if (WHATSAPP_PROVIDER === 'gupshup') return sendViaGupshup(phone, code);
  throw new Error('no whatsapp provider configured');
}

async function sendSms(phone, code) {
  if (SMS_PROVIDER === 'msg91') return sendViaMsg91(phone, code);
  if (SMS_PROVIDER === 'twilio') return sendViaTwilioSms(phone, code);
  throw new Error('no sms provider configured');
}

/**
 * Send an OTP over the requested channel ('whatsapp' | 'sms'), defaulting to
 * WhatsApp. Tries the requested channel first, then falls back to whichever
 * other channel actually has a provider configured, and only lands in test
 * mode if neither does. The fallback matters in practice: this deployment
 * only has WHATSAPP_PROVIDER set, not SMS_PROVIDER, so a client who
 * explicitly picks "SMS" would otherwise silently land in test mode - which
 * is invisible in production (devOtp is only echoed when NODE_ENV !==
 * 'production') - and just wait forever for a text that was never sent,
 * with no indication anything went wrong. Falling back to WhatsApp instead
 * means they actually get a working OTP, and the response's `channel`
 * field (which the frontend displays) honestly reflects what was used.
 */
async function sendOtp(phone, code, channel = 'whatsapp') {
  const preferred = channel === 'sms'
    ? [['sms', SMS_PROVIDER, sendSms], ['whatsapp', WHATSAPP_PROVIDER, sendWhatsApp]]
    : [['whatsapp', WHATSAPP_PROVIDER, sendWhatsApp], ['sms', SMS_PROVIDER, sendSms]];

  for (const [label, configured, send] of preferred) {
    if (!configured) continue;
    try {
      await send(phone, code);
      return { delivered: true, testMode: false, channel: label };
    } catch (err) {
      console.warn(`[otp] ${label} send failed (${err.message}), trying next channel`);
    }
  }

  // TEST MODE, no real delivery on either channel.
  console.log(`[otp:test-mode] Code for ${phone} is ${code} (not actually sent, set WHATSAPP_PROVIDER or SMS_PROVIDER in .env for real delivery)`);
  return { delivered: false, testMode: true, channel };
}

module.exports = { sendOtp, WHATSAPP_PROVIDER, SMS_PROVIDER };
