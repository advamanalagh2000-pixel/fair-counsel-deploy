const express = require('express');
const { prisma, toArr, fromArr } = require('../prisma');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../services/auditLog');

const router = express.Router();

const VALID_CHANNELS = ['video', 'phone', 'in_person'];

/** POST /api/consultation-requests  { practiceAreas: string[], preferredDate, channel, priorityClient } */
router.post('/', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'user') return res.status(403).json({ error: 'Only clients can submit a consultation request' });
    const { practiceAreas, preferredDate, channel, priorityClient } = req.body || {};
    if (!Array.isArray(practiceAreas) || practiceAreas.length === 0) {
      return res.status(400).json({ error: 'Pick at least one type of law' });
    }
    if (!VALID_CHANNELS.includes(channel)) {
      return res.status(400).json({ error: 'Invalid meeting channel' });
    }
    const date = new Date(preferredDate);
    if (Number.isNaN(date.getTime()) || date.getTime() < Date.now()) {
      return res.status(400).json({ error: 'Pick a valid future date and time' });
    }

    const request = await prisma.consultationRequest.create({
      data: {
        clientId: req.user.sub,
        practiceAreas: fromArr(practiceAreas),
        preferredDate: date,
        channel,
        priorityClient: !!priorityClient
      }
    });
    logAudit('info', `New consultation request submitted${priorityClient ? ' (priority)' : ''}`);
    res.status(201).json({ ...request, practiceAreas: toArr(request.practiceAreas) });
  } catch (err) {
    console.error('POST /api/consultation-requests failed:', err);
    res.status(500).json({ error: 'Could not submit your request right now' });
  }
});

module.exports = router;
