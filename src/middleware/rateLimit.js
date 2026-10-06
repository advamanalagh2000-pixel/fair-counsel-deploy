const rateLimit = require('express-rate-limit');

/**
 * Per-IP limiters for public, unauthenticated endpoints that are otherwise
 * cheap to hammer - login/apply endpoints are the classic brute force /
 * spam targets.
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

const matchLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Too many requests from this device, please wait a while before trying again.'
});

module.exports = { loginLimiter, applyLimiter, matchLimiter };
