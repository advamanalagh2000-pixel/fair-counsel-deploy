const express = require('express');
const { prisma } = require('../prisma');
const { requireAuth } = require('../middleware/auth');
const { initiateEsign, verifyEsignOtp } = require('../services/esignProvider');
const { logAudit } = require('../services/auditLog');

const router = express.Router();

/** POST /api/esign/initiate  { documentId, aadhaarLast4 } */
router.post('/initiate', requireAuth, async (req, res) => {
  const { documentId, aadhaarLast4 } = req.body || {};
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc || doc.uploadedBy !== req.user.sub) return res.status(404).json({ error: 'Document not found' });

  const result = await initiateEsign({ documentId, aadhaarLast4 });
  await prisma.esignRecord.create({
    data: {
      documentId,
      userId: req.user.sub,
      requestId: result.requestId,
      status: result.status
    }
  });
  res.json(result);
});

/** POST /api/esign/verify  { requestId, otp } */
router.post('/verify', requireAuth, async (req, res) => {
  const { requestId, otp } = req.body || {};
  const record = await prisma.esignRecord.findUnique({ where: { requestId } });
  if (!record || record.userId !== req.user.sub) return res.status(404).json({ error: 'eSign request not found' });

  const result = await verifyEsignOtp({ requestId, otp });
  await prisma.esignRecord.update({
    where: { id: record.id },
    data: {
      status: result.status,
      signedAt: result.signedAt ? new Date(result.signedAt) : null,
      certificateRef: result.certificateRef
    }
  });

  if (result.status === 'signed') {
    logAudit('ok', `Document ${record.documentId} signed via Aadhaar eSign (${result.certificateRef})`);
  } else {
    logAudit('no', `Aadhaar eSign verification failed for document ${record.documentId}`);
  }

  res.json(result);
});

module.exports = router;
