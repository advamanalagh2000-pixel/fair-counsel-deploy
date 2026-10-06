const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { prisma, serializeLawyer } = require('../prisma');
const { signSession, requireAuth, JWT_SECRET } = require('../middleware/auth');
const { verifyTotpCode } = require('../services/totp');
const { loginLimiter } = require('../middleware/rateLimit');
const { logAudit } = require('../services/auditLog');

const router = express.Router();

/**
 * No phone/email verification step - a phone number alone creates or logs
 * into an account. This is a deliberate, known tradeoff (see the commit
 * that removed OTP): without a real WhatsApp/SMS/email provider configured,
 * OTP was a hard wall nobody could get past, so verification was dropped
 * entirely rather than faked. Anyone who knows a phone number can act as
 * that account - acceptable for now, not for handling real client money
 * without a real verification channel in front of it again.
 */

/** POST /api/auth/login  { phone, name?, clientType?, companyName?, gstin? } — client login/signup, no verification */
router.post('/login', loginLimiter, async (req, res) => {
  const { phone, name, clientType, companyName, gstin } = req.body || {};
  if (!phone || !/^\d{10}$/.test(phone)) {
    return res.status(400).json({ error: 'Provide a valid 10-digit phone number' });
  }

  let user = await prisma.user.findUnique({ where: { phone } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        phone,
        name: name || '',
        clientType: clientType || 'individual',
        companyName: companyName || null,
        gstin: gstin || null
      }
    });
    logAudit('info', `New user registered: ${user.phone}`);
  }

  const token = signSession({ sub: user.id, role: 'user', phone: user.phone });
  res.json({ token, user });
});

/** POST /api/auth/lawyer/login  { phone } — lawyer login for already-applied lawyers, no verification */
router.post('/lawyer/login', loginLimiter, async (req, res) => {
  const { phone } = req.body || {};
  if (!phone || !/^\d{10}$/.test(phone)) {
    return res.status(400).json({ error: 'Provide a valid 10-digit phone number' });
  }

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
  // A suspended lawyer can still log in and see their existing cases -
  // suspension only blocks new bookings (cases.js gates that on
  // status === 'verified' separately), it isn't a full account lockout.
  if (lawyer.status !== 'verified' && lawyer.status !== 'suspended') {
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
  if (admin.totpEnabled) {
    // Not a real session yet - role is deliberately not 'admin', so this
    // token can't pass requireAdmin even if it leaked, it's only good for
    // the /admin-login/totp exchange below, and only for 5 minutes.
    const tempToken = signSession({ sub: admin.id, role: 'admin-pending-2fa' }, '5m');
    return res.json({ requiresTotp: true, tempToken });
  }
  const token = signSession({ sub: admin.id, role: 'admin', adminRole: admin.role, username: admin.username }, '8h');
  logAudit('ok', `Admin "${admin.username}" signed in`);
  res.json({ token, admin: { username: admin.username, role: admin.role } });
});

/** POST /api/auth/admin-login/totp  { tempToken, code } — second step when 2FA is enabled */
router.post('/admin-login/totp', loginLimiter, async (req, res) => {
  const { tempToken, code } = req.body || {};
  let payload;
  try {
    payload = jwt.verify(tempToken, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Login session expired, sign in again' });
  }
  if (payload.role !== 'admin-pending-2fa') return res.status(401).json({ error: 'Invalid login session' });
  const admin = await prisma.admin.findUnique({ where: { id: payload.sub } });
  if (!admin || !admin.totpEnabled || !admin.totpSecret) return res.status(401).json({ error: 'Invalid login session' });
  if (!verifyTotpCode(admin.totpSecret, code)) {
    logAudit('no', `Failed 2FA code for admin "${admin.username}"`);
    return res.status(401).json({ error: 'Incorrect code' });
  }
  const token = signSession({ sub: admin.id, role: 'admin', adminRole: admin.role, username: admin.username }, '8h');
  logAudit('ok', `Admin "${admin.username}" signed in (2FA)`);
  res.json({ token, admin: { username: admin.username, role: admin.role } });
});

/** GET /api/auth/me — the logged-in client's own profile */
router.get('/me', requireAuth, async (req, res) => {
  if (req.user.role !== 'user') return res.status(403).json({ error: 'Only clients have a profile here' });
  const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json(user);
});

/**
 * GET /api/auth/me/data — DPDP-style data export: everything Fair Counsel
 * holds about this client, as one JSON file they can download. Documents
 * are listed by metadata only (name/size/status), not the file contents -
 * those are downloaded separately via the existing per-document route.
 */
router.get('/me/data', requireAuth, async (req, res) => {
  if (req.user.role !== 'user') return res.status(403).json({ error: 'Only clients can export data here' });
  const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
  if (!user) return res.status(404).json({ error: 'Not found' });
  const cases = await prisma.case.findMany({ where: { clientId: user.id }, include: { payments: true, documents: true, supportTickets: true } });
  const exportPayload = {
    exportedAt: new Date().toISOString(),
    profile: user,
    cases: cases.map(c => ({
      fileCode: c.fileCode, category: c.category, status: c.status, stage: c.stage, channel: c.channel, createdAt: c.createdAt,
      payments: c.payments.map(p => ({ stage: p.stage, amountPaise: p.amountPaise, status: p.status, paidAt: p.paidAt })),
      documents: c.documents.map(d => ({ originalName: d.originalName, status: d.status, sizeBytes: d.sizeBytes, createdAt: d.createdAt })),
      supportTickets: c.supportTickets.map(t => ({ subject: t.subject, details: t.details, status: t.status, createdAt: t.createdAt }))
    }))
  };
  res.setHeader('Content-Disposition', 'attachment; filename="fair-counsel-my-data.json"');
  res.json(exportPayload);
});

/**
 * DELETE /api/auth/me — self-service account deletion, same protection the
 * admin-side deletion already has: blocked while any case history exists,
 * to keep payment/audit records intact. A client with case history who
 * wants to be forgotten needs to go through support (raise a ticket) so a
 * human can weigh the DPDP erasure request against the retention
 * obligations - this isn't something that should silently no-op or
 * silently destroy financial records either way.
 */
router.delete('/me', requireAuth, async (req, res) => {
  if (req.user.role !== 'user') return res.status(403).json({ error: 'Only clients can delete their account here' });
  const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
  if (!user) return res.status(404).json({ error: 'Not found' });
  const caseCount = await prisma.case.count({ where: { clientId: user.id } });
  if (caseCount > 0) {
    return res.status(400).json({ error: `Your account has ${caseCount} case(s) on record, so it can't be deleted automatically, to keep payment and audit records intact. Raise a support ticket and our team will handle your request.` });
  }
  await prisma.user.delete({ where: { id: user.id } });
  logAudit('no', `Client "${user.name || user.phone}" deleted their own account`);
  res.json({ ok: true });
});

module.exports = router;
