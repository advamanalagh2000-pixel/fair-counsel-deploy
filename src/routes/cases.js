const express = require('express');
const { prisma } = require('../prisma');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../services/auditLog');

const router = express.Router();

function fileCode() {
  const year = new Date().getFullYear();
  const n = Math.floor(10000 + Math.random() * 90000);
  return `FC/${year}/${n}`;
}

/** POST /api/cases  { lawyerId, category, notes, channel } — client only */
router.post('/', requireAuth, async (req, res) => {
  if (req.user.role !== 'user') return res.status(403).json({ error: 'Only clients can open a case' });
  const { lawyerId, category, notes, channel } = req.body || {};
  const lawyer = await prisma.lawyer.findUnique({ where: { id: lawyerId } });
  if (!lawyer || lawyer.status !== 'verified') return res.status(400).json({ error: 'Unknown lawyer' });

  const specs = (() => { try { return JSON.parse(lawyer.specs); } catch { return []; } })();

  const record = await prisma.case.create({
    data: {
      fileCode: fileCode(),
      clientId: req.user.sub,
      lawyerId,
      category: category || specs[0] || 'General',
      notes: notes || '',
      channel: channel === 'phone' ? 'phone' : 'video',
      status: 'awaiting_client',
      stage: 'consultation'
    }
  });
  logAudit('info', `Case ${record.fileCode} opened with ${lawyer.name}`);
  res.status(201).json(record);
});

/** GET /api/cases/mine — a client's own cases, or a lawyer's assigned cases */
router.get('/mine', requireAuth, async (req, res) => {
  if (req.user.role === 'lawyer') {
    const cases = await prisma.case.findMany({ where: { lawyerId: req.user.sub }, orderBy: { createdAt: 'desc' } });
    return res.json(cases);
  }
  const cases = await prisma.case.findMany({ where: { clientId: req.user.sub }, orderBy: { createdAt: 'desc' } });
  res.json(cases);
});

function canViewCase(user, c) {
  if (!c) return false;
  if (user.role === 'user') return c.clientId === user.sub;
  if (user.role === 'lawyer') return c.lawyerId === user.sub;
  return false;
}

/** GET /api/cases/:id */
router.get('/:id', requireAuth, async (req, res) => {
  const c = await prisma.case.findUnique({ where: { id: req.params.id } });
  if (!canViewCase(req.user, c)) return res.status(404).json({ error: 'Not found' });
  res.json(c);
});

module.exports = router;
