const { prisma } = require('../prisma');

function logAudit(type, text) {
  return prisma.auditLog.create({ data: { type, text } }).catch(err => console.error('AUDIT LOG WRITE FAILED', err));
}

module.exports = { logAudit };
