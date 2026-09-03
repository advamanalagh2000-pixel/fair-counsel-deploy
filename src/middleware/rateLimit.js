const rateLimit = require('express-rate-limit');

/**
 * Per-IP limiters for public, unauthenticated endpoints that are otherwise
 * cheap to hammer (OTP sends cost real money once a real WhatsApp/SMS
 * provider is wired in, and login/apply endpoints are the classic brute
 * force / spam targets). The OTP send routes already have their own
 * per-phone 30s resend cooldown in auth.js, this is a second, coarser layer
 * per IP so one phone number can't be used to flood many different numbers.
 */
function makeLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
    handler: (req, res, next, options) => res.status(429).json(options.message)
  });
}

const otpSendLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many OTP requests from this device, please wait a while before trying again.'
});

const loginLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many login attempts from this device, please wait a while before trying again.'
});

const applyLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many applications submitted from this device, please wait a while before trying again.'
});

module.exports = { otpSendLimiter, loginLimiter, applyLimiter };
