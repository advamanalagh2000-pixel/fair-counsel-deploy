/**
 * TOTP (Google Authenticator/Authy-compatible) helpers for admin 2FA.
 * Centralised here because otplib's API differs meaningfully by major
 * version - v13 (installed) exports top-level generateSecret/generateURI/
 * verifySync functions, not the classic `authenticator` singleton object
 * older docs/examples reference, and verifySync returns { valid, ... },
 * not a plain boolean, so callers must check the .valid property.
 */
const otplib = require('otplib');

function generateTotpSecret() {
  return otplib.generateSecret();
}

function generateTotpUri(label, secret) {
  return otplib.generateURI({ issuer: 'Fair Counsel', label, secret });
}

function verifyTotpCode(secret, code) {
  if (!code || !secret) return false;
  return otplib.verifySync({ secret, token: String(code) }).valid === true;
}

module.exports = { generateTotpSecret, generateTotpUri, verifyTotpCode };
