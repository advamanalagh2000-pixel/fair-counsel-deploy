const express = require('express');
const bcrypt = require('bcryptjs');
const { prisma, serializeLawyer } = require('../prisma');
const { requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const { logAudit } = require('../services/auditLog');

const router = express.Router();

/** GET /api/admin/lawyers/pending */
router.get('/lawyers/pending', requireAdmin, async (req, res) => {
  const lawyers = await prisma.lawyer.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' } });
  res.json(lawyers.map(serializeLawyer));
});

/** POST /api/admin/lawyers/:id/approve */
router.post('/lawyers/:id/approve', requireAdmin, async (req, res) => {
  const existing = await prisma.lawyer.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const lawyer = await prisma.lawyer.update({ where: { id: req.params.id }, data: { status: 'verified' } });
  logAudit('ok', `${lawyer.name} approved by admin "${req.admin.username}"`);
  res.json(serializeLawyer(lawyer));
});

/** POST /api/admin/lawyers/:id/reject  { reason } — reason is required */
router.post('/lawyers/:id/reject', requireAdmin, async (req, res) => {
  const { reason } = req.body || {};
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'A rejection reason is required' });
  const existing = await prisma.lawyer.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const lawyer = await prisma.lawyer.update({ where: { id: req.params.id }, data: { status: 'rejected', rejectionReason: reason } });
  logAudit('no', `${lawyer.name} rejected by admin "${req.admin.username}" ("${reason}")`);
  res.json(serializeLawyer(lawyer));
});

/** GET /api/admin/cases?search=&status= */
router.get('/cases', requireAdmin, async (req, res) => {
  const { search = '', status = '' } = req.query;
  const where = {};
  if (status) where.status = status;
  let cases = await prisma.case.findMany({ where, orderBy: { createdAt: 'desc' } });
  if (search) {
    const q = search.toLowerCase();
    cases = cases.filter(c => c.fileCode.toLowerCase().includes(q) || c.category.toLowerCase().includes(q));
  }
  res.json(cases);
});

/** GET /api/admin/audit-log */
router.get('/audit-log', requireAdmin, async (req, res) => {
  const log = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(log);
});

/** GET /api/admin/documents/pending — lawyer-uploaded drafts awaiting Fair Counsel review */
router.get('/documents/pending', requireAdmin, async (req, res) => {
  const docs = await prisma.document.findMany({
    where: { status: 'pending_review', uploadedByRole: 'lawyer' },
    orderBy: { createdAt: 'asc' }
  });
  const caseIds = [...new Set(docs.map(d => d.caseId))];
  const cases = await prisma.case.findMany({ where: { id: { in: caseIds } } });
  const caseById = Object.fromEntries(cases.map(c => [c.id, c]));
  const lawyerIds = [...new Set(cases.map(c => c.lawyerId))];
  const clientIds = [...new Set(cases.map(c => c.clientId))];
  const [lawyers, clients] = await Promise.all([
    prisma.lawyer.findMany({ where: { id: { in: lawyerIds } } }),
    prisma.user.findMany({ where: { id: { in: clientIds } } })
  ]);
  const lawyerById = Object.fromEntries(lawyers.map(l => [l.id, l]));
  const clientById = Object.fromEntries(clients.map(u => [u.id, u]));

  res.json(docs.map(({ storedPath, ...d }) => {
    const c = caseById[d.caseId];
    return {
      ...d,
      fileCode: c ? c.fileCode : null,
      category: c ? c.category : null,
      lawyerName: c && lawyerById[c.lawyerId] ? lawyerById[c.lawyerId].name : null,
      clientName: c && clientById[c.clientId] ? (clientById[c.clientId].name || clientById[c.clientId].phone) : null
    };
  }));
});

/** POST /api/admin/documents/:id/approve — releases a lawyer's draft to the client */
router.post('/documents/:id/approve', requireAdmin, async (req, res) => {
  const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
  if (!doc) return res.status(404).json({ error: 'Not found' });
  const updated = await prisma.document.update({
    where: { id: doc.id },
    data: { status: 'approved', reviewedBy: req.admin.username, reviewedAt: new Date(), rejectionReason: null }
  });
  const c = await prisma.case.findUnique({ where: { id: doc.caseId } });
  logAudit('ok', `Draft "${doc.originalName}" approved and released to client for case ${c ? c.fileCode : doc.caseId}, by admin "${req.admin.username}"`);
  res.json(updated);
});

/** POST /api/admin/documents/:id/reject  { reason } — sends a draft back to the lawyer, reason is required */
router.post('/documents/:id/reject', requireAdmin, async (req, res) => {
  const { reason } = req.body || {};
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'A reason is required so the lawyer knows what to fix' });
  const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
  if (!doc) return res.status(404).json({ error: 'Not found' });
  const updated = await prisma.document.update({
    where: { id: doc.id },
    data: { status: 'rejected', rejectionReason: reason, reviewedBy: req.admin.username, reviewedAt: new Date() }
  });
  const c = await prisma.case.findUnique({ where: { id: doc.caseId } });
  logAudit('no', `Draft "${doc.originalName}" sent back to lawyer for case ${c ? c.fileCode : doc.caseId} by admin "${req.admin.username}" ("${reason}")`);
  res.json(updated);
});

/** GET /api/admin/admins — superadmin only */
router.get('/admins', requireSuperAdmin, async (req, res) => {
  const admins = await prisma.admin.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, username: true, role: true, createdAt: true } });
  res.json(admins);
});

/** POST /api/admin/admins  { username, password, role } — superadmin only */
router.post('/admins', requireSuperAdmin, async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !username.trim()) return res.status(400).json({ error: 'Username is required' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const finalRole = role === 'superadmin' ? 'superadmin' : 'admin';
  const existing = await prisma.admin.findUnique({ where: { username } });
  if (existing) return res.status(409).json({ error: 'That username is already taken' });
  const admin = await prisma.admin.create({
    data: { username: username.trim(), passwordHash: bcrypt.hashSync(password, 8), role: finalRole }
  });
  logAudit('info', `Admin account "${admin.username}" (${finalRole}) created by "${req.admin.username}"`);
  res.status(201).json({ id: admin.id, username: admin.username, role: admin.role, createdAt: admin.createdAt });
});

module.exports = router;
