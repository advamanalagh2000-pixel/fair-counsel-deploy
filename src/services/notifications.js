const { prisma } = require('../prisma');

/** Creates a real notification for a real event - never call this speculatively, only from an actual state change. */
async function notify({ recipientRole, recipientId, type, title, body = '', caseId = null }) {
  return prisma.notification.create({
    data: { recipientRole, recipientId, type, title, body, caseId }
  });
}

module.exports = { notify };
