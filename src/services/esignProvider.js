/**
 * Aadhaar eSign provider adapter.
 *
 * IMPORTANT: this is a MOCK implementation only. Unlike SMS or payments, there is
 * no public sandbox you can just plug keys into — Aadhaar-based eSign under the
 * IT Act, 2000 and UIDAI's eSign guidelines can only be performed through a
 * licensed ASP (Application Service Provider), e.g. NSDL e-Gov, CDAC, eMudhra,
 * Digio, Leegality, or similar. Getting production access requires:
 *   1. Registering as a requesting entity with a licensed ASP
 *   2. Legal/compliance review (this is a regulated signing mechanism, not a
 *      generic API you self-serve into)
 *   3. Integrating their specific eSign XML/API flow (varies per ASP)
 *
 * This file exists so the rest of the codebase (routes/esign.js, the document
 * flow) already has the right shape — request → redirect/OTP → signed artifact
 * with audit trail — so wiring in a real ASP later is a matter of implementing
 * these three functions against their actual API, not restructuring the app.
 */
const crypto = require('crypto');

async function initiateEsign({ documentId, aadhaarLast4 }) {
  // A real ASP integration redirects the user to UIDAI's OTP screen or embeds
  // their widget — it does not accept a raw Aadhaar number server-side at all.
  return {
    requestId: 'esign_mock_' + crypto.randomBytes(8).toString('hex'),
    documentId,
    aadhaarLast4,
    status: 'otp_sent',
    mock: true
  };
}

async function verifyEsignOtp({ requestId, otp }) {
  const success = otp === '1234'; // mock only — see file header
  return {
    requestId,
    status: success ? 'signed' : 'failed',
    signedAt: success ? new Date().toISOString() : null,
    certificateRef: success ? 'MOCK-CERT-' + requestId.slice(-8).toUpperCase() : null,
    mock: true
  };
}

module.exports = { initiateEsign, verifyEsignOtp };
