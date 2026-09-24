const express = require('express');
const { prisma } = require('../prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/** GET /api/notifications — the current user's (client or lawyer) own notifications, most recent first */
router.get('/', requireAuth, async (req, res) => {
  const where = { recipientRole: req.user.role, recipientId: req.user.sub };
  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.notification.count({ where: { ...where, read: false } })
  ]);
  res.json({ notifications, unreadCount });
});

/** POST /api/notifications/read-all */
router.post('/read-all', requireAuth, async (req, res) => {
  await prisma.notification.updateMany({
    where: { recipientRole: req.user.role, recipientId: req.user.sub, read: false },
    data: { read: true }
  });
  res.json({ ok: true });
});

module.exports = router;
