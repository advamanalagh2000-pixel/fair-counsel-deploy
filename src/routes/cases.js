const express = require('express');
const { prisma } = require('../prisma');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../services/auditLog');
const { notify } = require('../services/notifications');

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
  const cases = await prisma.case.findMany({
    where: { clientId: req.user.sub },
    orderBy: { createdAt: 'desc' },
    include: {
      review: true,
      lawyer: { select: { name: true } },
      payments: { where: { stage: 'final', status: 'paid' }, select: { id: true } }
    }
  });
  res.json(cases.map(({ payments, ...c }) => ({ ...c, finalPaymentId: payments[0]?.id || null })));
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

/** POST /api/cases/:id/review  { rating, comment } — client only, case must be closed, one review per case */
router.post('/:id/review', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'user') return res.status(403).json({ error: 'Only clients can leave a review' });
    const c = await prisma.case.findUnique({ where: { id: req.params.id } });
    if (!c || c.clientId !== req.user.sub) return res.status(404).json({ error: 'Not found' });
    if (c.status !== 'closed') return res.status(400).json({ error: 'You can review a case once it is closed' });

    const existing = await prisma.review.findUnique({ where: { caseId: c.id } });
    if (existing) return res.status(409).json({ error: 'You already reviewed this case' });

    const rating = parseInt(req.body?.rating, 10);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be a whole number from 1 to 5' });
    }
    const comment = String(req.body?.comment || '').trim().slice(0, 1000);

    const review = await prisma.review.create({
      data: { caseId: c.id, lawyerId: c.lawyerId, clientId: req.user.sub, rating, comment }
    });
    logAudit('info', `New review (${rating}★) for case ${c.fileCode}`);
    await notify({
      recipientRole: 'lawyer', recipientId: c.lawyerId, type: 'review', caseId: c.id,
      title: `New ${rating}★ review`,
      body: comment || `You received a ${rating}-star review for FILE ${c.fileCode}.`
    });
    res.status(201).json(review);
  } catch (err) {
    console.error('POST /api/cases/:id/review failed:', err);
    res.status(500).json({ error: 'Could not save your review right now' });
  }
});

/** GET /api/cases/:id/messages — either party to the case */
router.get('/:id/messages', requireAuth, async (req, res) => {
  const c = await prisma.case.findUnique({ where: { id: req.params.id } });
  if (!canViewCase(req.user, c)) return res.status(404).json({ error: 'Not found' });
  const messages = await prisma.message.findMany({ where: { caseId: c.id }, orderBy: { createdAt: 'asc' } });
  res.json(messages);
});

/** POST /api/cases/:id/messages  { body } — either party to the case */
router.post('/:id/messages', requireAuth, async (req, res) => {
  try {
    const c = await prisma.case.findUnique({ where: { id: req.params.id } });
    if (!canViewCase(req.user, c)) return res.status(404).json({ error: 'Not found' });

    const body = String(req.body?.body || '').trim().slice(0, 2000);
    if (!body) return res.status(400).json({ error: 'Message cannot be empty' });

    const message = await prisma.message.create({
      data: { caseId: c.id, senderRole: req.user.role, senderId: req.user.sub, body }
    });
    const recipientRole = req.user.role === 'user' ? 'lawyer' : 'user';
    const recipientId = req.user.role === 'user' ? c.lawyerId : c.clientId;
    await notify({
      recipientRole, recipientId, type: 'message', caseId: c.id,
      title: `New message on FILE ${c.fileCode}`,
      body: body.slice(0, 120)
    });
    res.status(201).json(message);
  } catch (err) {
    console.error('POST /api/cases/:id/messages failed:', err);
    res.status(500).json({ error: 'Could not send your message right now' });
  }
});

module.exports = router;
