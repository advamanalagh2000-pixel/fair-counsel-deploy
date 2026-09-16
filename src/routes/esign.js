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
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  // eSign is the client signing a document, not necessarily the one who
  // uploaded it, the normal case is a lawyer's draft (uploadedBy = the
  // lawyer) that the client then signs, so access is via the case's client,
  // matching how documents.js already gates who can view an approved draft.
  const c = await prisma.case.findUnique({ where: { id: doc.caseId } });
  if (!c || c.clientId !== req.user.sub) return res.status(403).json({ error: 'Only the client on this case can e-sign this document' });
  if (doc.status !== 'approved') return res.status(400).json({ error: 'This document must be approved before it can be e-signed' });

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
