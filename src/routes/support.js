const express = require('express');
const { prisma } = require('../prisma');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../services/auditLog');

const router = express.Router();

/** POST /api/support/tickets  { caseId?, subject, details } — client raises a support ticket */
router.post('/tickets', requireAuth, async (req, res) => {
  if (req.user.role !== 'user') return res.status(403).json({ error: 'Only clients can raise support tickets' });
  const { caseId, subject, details } = req.body || {};
  if (!subject || !subject.trim()) return res.status(400).json({ error: 'A subject is required' });

  if (caseId) {
    const c = await prisma.case.findUnique({ where: { id: caseId } });
    if (!c || c.clientId !== req.user.sub) return res.status(400).json({ error: 'Unknown case' });
  }

  const ticket = await prisma.supportTicket.create({
    data: { clientId: req.user.sub, caseId: caseId || null, subject: subject.trim(), details: details || '' }
  });
  logAudit('info', `Support ticket raised: "${ticket.subject}"`);
  res.status(201).json(ticket);
});

module.exports = router;
