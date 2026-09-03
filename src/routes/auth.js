const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { prisma, serializeLawyer } = require('../prisma');
const { sendOtp } = require('../services/smsProvider');
const { signSession } = require('../middleware/auth');
const { otpSendLimiter, loginLimiter } = require('../middleware/rateLimit');
const { logAudit } = require('../services/auditLog');

const router = express.Router();

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const OTP_MAX_ATTEMPTS = 3;
const RESEND_COOLDOWN_MS = 30 * 1000;

function generateOtp() {
  return String(crypto.randomInt(1000, 10000)); // 4-digit
}

async function issueOtp({ phone, purpose, pendingProfile }, res) {
  const recent = await prisma.otp.findFirst({
    where: { phone, consumed: false },
    orderBy: { createdAt: 'desc' }
  });
  if (recent && Date.now() - recent.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    const waitMs = RESEND_COOLDOWN_MS - (Date.now() - recent.createdAt.getTime());
    res.status(429).json({ error: 'Please wait before requesting another OTP', retryAfterMs: waitMs });
    return null;
  }

  // Invalidate any prior unconsumed OTPs for this phone/purpose so only the latest is valid.
  await prisma.otp.updateMany({ where: { phone, consumed: false }, data: { consumed: true } });

  const code = generateOtp();
  const codeHash = bcrypt.hashSync(code, 8);
  const record = await prisma.otp.create({
    data: {
      phone,
      codeHash,
      purpose,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      pendingProfile: pendingProfile ? JSON.stringify(pendingProfile) : null
    }
  });
  return { record, code };
}

/** POST /api/auth/send-otp  { phone, name?, clientType?, companyName?, gstin?, channel? } — client login/signup */
router.post('/send-otp', otpSendLimiter, async (req, res) => {
  const { phone, name, clientType, companyName, gstin, channel } = req.body || {};
  if (!phone || !/^\d{10}$/.test(phone)) {
    return res.status(400).json({ error: 'Provide a valid 10-digit phone number' });
  }
  const otpChannel = channel === 'sms' ? 'sms' : 'whatsapp'; // WhatsApp is the default

  const issued = await issueOtp({ phone, purpose: 'client', pendingProfile: { name, clientType, companyName, gstin } }, res);
  if (!issued) return;
  const { record, code } = issued;

  const sendResult = await sendOtp(phone, code, otpChannel);

  const response = { otpId: record.id, expiresInSeconds: OTP_TTL_MS / 1000, channel: sendResult.channel || otpChannel };
  if (process.env.NODE_ENV !== 'production' && sendResult.testMode) {
    response.devOtp = code;
    response.note = `devOtp is only present because no ${otpChannel} provider is configured (test mode). Remove before going live.`;
  }
  res.json(response);
});

/** POST /api/auth/verify-otp  { otpId, code } — client login/signup */
router.post('/verify-otp', loginLimiter, async (req, res) => {
  const { otpId, code } = req.body || {};
  const record = await prisma.otp.findUnique({ where: { id: otpId } });
  if (!record || record.purpose !== 'client' || record.consumed) return res.status(400).json({ error: 'Invalid or already-used OTP request' });
  if (record.expiresAt.getTime() < Date.now()) return res.status(400).json({ error: 'OTP expired, request a new one' });
  if (record.attempts >= OTP_MAX_ATTEMPTS) return res.status(429).json({ error: 'Too many incorrect attempts, request a new OTP' });

  const ok = bcrypt.compareSync(String(code || ''), record.codeHash);
  if (!ok) {
    const attempts = record.attempts + 1;
    await prisma.otp.update({ where: { id: record.id }, data: { attempts } });
    const remaining = OTP_MAX_ATTEMPTS - attempts;
    return res.status(400).json({ error: 'Incorrect OTP', attemptsRemaining: Math.max(remaining, 0) });
  }

  await prisma.otp.update({ where: { id: record.id }, data: { consumed: true } });

  const pendingProfile = record.pendingProfile ? JSON.parse(record.pendingProfile) : {};
  let user = await prisma.user.findUnique({ where: { phone: record.phone } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        phone: record.phone,
        name: pendingProfile.name || '',
        clientType: pendingProfile.clientType || 'individual',
        companyName: pendingProfile.companyName || null,
        gstin: pendingProfile.gstin || null
      }
    });
    logAudit('info', `New user registered: ${user.phone}`);
  }

  const token = signSession({ sub: user.id, role: 'user', phone: user.phone });
  res.json({ token, user });
});

/** POST /api/auth/lawyer/send-otp  { phone, channel? } — lawyer login for already-applied lawyers */
router.post('/lawyer/send-otp', otpSendLimiter, async (req, res) => {
  const { phone, channel } = req.body || {};
  if (!phone || !/^\d{10}$/.test(phone)) {
    return res.status(400).json({ error: 'Provide a valid 10-digit phone number' });
  }
  const otpChannel = channel === 'sms' ? 'sms' : 'whatsapp';

  const lawyer = await prisma.lawyer.findUnique({ where: { phone } });
  if (!lawyer) {
    return res.status(404).json({ error: 'No application found for this number. Apply to join Fair Counsel first.' });
  }
  if (lawyer.status === 'pending') {
    return res.status(403).json({ error: 'Your application is still under review. You will be able to log in once approved.' });
  }
  if (lawyer.status === 'rejected') {
    return res.status(403).json({ error: `Your application was not approved${lawyer.rejectionReason ? `: ${lawyer.rejectionReason}` : '.'}` });
  }

  const issued = await issueOtp({ phone, purpose: 'lawyer' }, res);
  if (!issued) return;
  const { record, code } = issued;

  const sendResult = await sendOtp(phone, code, otpChannel);

  const response = { otpId: record.id, expiresInSeconds: OTP_TTL_MS / 1000, channel: sendResult.channel || otpChannel };
  if (process.env.NODE_ENV !== 'production' && sendResult.testMode) {
    response.devOtp = code;
    response.note = `devOtp is only present because no ${otpChannel} provider is configured (test mode). Remove before going live.`;
  }
  res.json(response);
});

/** POST /api/auth/lawyer/verify-otp  { otpId, code } — lawyer login */
router.post('/lawyer/verify-otp', loginLimiter, async (req, res) => {
  const { otpId, code } = req.body || {};
  const record = await prisma.otp.findUnique({ where: { id: otpId } });
  if (!record || record.purpose !== 'lawyer' || record.consumed) return res.status(400).json({ error: 'Invalid or already-used OTP request' });
  if (record.expiresAt.getTime() < Date.now()) return res.status(400).json({ error: 'OTP expired, request a new one' });
  if (record.attempts >= OTP_MAX_ATTEMPTS) return res.status(429).json({ error: 'Too many incorrect attempts, request a new OTP' });

  const ok = bcrypt.compareSync(String(code || ''), record.codeHash);
  if (!ok) {
    const attempts = record.attempts + 1;
    await prisma.otp.update({ where: { id: record.id }, data: { attempts } });
    const remaining = OTP_MAX_ATTEMPTS - attempts;
    return res.status(400).json({ error: 'Incorrect OTP', attemptsRemaining: Math.max(remaining, 0) });
  }

  await prisma.otp.update({ where: { id: record.id }, data: { consumed: true } });

  const lawyer = await prisma.lawyer.findUnique({ where: { phone: record.phone } });
  if (!lawyer || lawyer.status !== 'verified') {
    return res.status(403).json({ error: 'This lawyer account is no longer eligible to log in' });
  }

  const token = signSession({ sub: lawyer.id, role: 'lawyer', phone: lawyer.phone });
  logAudit('info', `Lawyer "${lawyer.name}" signed in`);
  res.json({ token, lawyer: serializeLawyer(lawyer) });
});

/** POST /api/auth/admin-login  { username, password } — seeded via src/seed.js */
router.post('/admin-login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  const admin = await prisma.admin.findUnique({ where: { username } });
  if (!admin || !bcrypt.compareSync(String(password || ''), admin.passwordHash)) {
    logAudit('no', `Failed admin login attempt for username "${username}"`);
    return res.status(401).json({ error: 'Incorrect username or password' });
  }
  const token = signSession({ sub: admin.id, role: 'admin', adminRole: admin.role, username: admin.username }, '8h');
  logAudit('ok', `Admin "${admin.username}" signed in`);
  res.json({ token, admin: { username: admin.username, role: admin.role } });
});

module.exports = router;
