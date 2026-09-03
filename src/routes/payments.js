const express = require('express');
const { prisma } = require('../prisma');
const { requireAuth } = require('../middleware/auth');
const { createOrder, verifyPaymentSignature, verifyWebhookSignature, MOCK_MODE } = require('../services/paymentProvider');
const { logAudit } = require('../services/auditLog');

const router = express.Router();

const PLATFORM_FEE_BPS = 1500; // 15% platform commission, illustrative only, set your real rate

/** POST /api/payments/create-order  { caseId, stage, amountPaise } */
router.post('/create-order', requireAuth, async (req, res) => {
  if (req.user.role !== 'user') return res.status(403).json({ error: 'Only clients can pay' });
  const { caseId, stage, amountPaise } = req.body || {};
  const c = await prisma.case.findUnique({ where: { id: caseId } });
  if (!c || c.clientId !== req.user.sub) return res.status(404).json({ error: 'Case not found' });
  if (!amountPaise || amountPaise <= 0) return res.status(400).json({ error: 'Invalid amount' });
  if (!['consultation', 'advance', 'final'].includes(stage)) return res.status(400).json({ error: 'Invalid payment stage' });

  const order = await createOrder({
    amountPaise,
    receipt: `${c.fileCode}-${stage}`,
    notes: { caseId, stage }
  });

  const payment = await prisma.payment.create({
    data: { caseId, stage, amountPaise, orderId: order.id, status: 'created' }
  });

  res.json({ order, paymentId: payment.id, mockMode: MOCK_MODE, keyId: process.env.RAZORPAY_KEY_ID || null });
});

/** POST /api/payments/confirm  { paymentId, razorpayOrderId, razorpayPaymentId, razorpaySignature } */
router.post('/confirm', requireAuth, async (req, res) => {
  const { paymentId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body || {};
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.status === 'paid') return res.json(payment); // idempotent, a double-click or retry shouldn't double-charge the ledger

  const valid = verifyPaymentSignature({
    orderId: razorpayOrderId,
    paymentId: razorpayPaymentId,
    signature: razorpaySignature
  });
  if (!valid) {
    await prisma.payment.update({ where: { id: paymentId }, data: { status: 'failed' } });
    logAudit('no', `Payment verification failed for ${paymentId}`);
    return res.status(400).json({ error: 'Payment signature verification failed' });
  }

  const updated = await prisma.payment.update({
    where: { id: paymentId },
    data: { status: 'paid', razorpayPaymentId, paidAt: new Date() }
  });

  const c = await prisma.case.findUnique({ where: { id: payment.caseId } });
  if (c) {
    const nextStage = payment.stage === 'consultation' ? 'advance' : payment.stage === 'advance' ? 'final' : 'final';
    const nextStatus = payment.stage === 'final' ? 'closed' : 'in_review';
    await prisma.case.update({ where: { id: c.id }, data: { stage: nextStage, status: nextStatus } });

    const lawyerSharePaise = Math.round(payment.amountPaise * (10000 - PLATFORM_FEE_BPS) / 10000);
    await prisma.payout.create({
      data: {
        lawyerId: c.lawyerId,
        caseId: c.id,
        paymentId: payment.id,
        grossPaise: payment.amountPaise,
        platformFeePaise: payment.amountPaise - lawyerSharePaise,
        netPayablePaise: lawyerSharePaise,
        status: 'pending_payout'
      }
    });

    logAudit('ok', `Payment ${paymentId} confirmed (${payment.stage}) for case ${c.fileCode}`);
  } else {
    logAudit('ok', `Payment ${paymentId} confirmed (${payment.stage})`);
  }

  res.json(updated);
});

/** POST /api/payments/webhooks/razorpay — server-to-server confirmation (recommended over client confirm alone) */
router.post('/webhooks/razorpay', express.raw({ type: '*/*' }), (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const ok = verifyWebhookSignature(req.body, signature);
  if (!ok) return res.status(400).send('invalid signature');
  // In production: parse req.body (JSON), reconcile against the payments table idempotently
  // (a webhook can arrive more than once, always check current status before mutating).
  res.status(200).send('ok');
});

/** GET /api/payments/payouts/:lawyerId — lawyer earnings ledger */
router.get('/payouts/:lawyerId', async (req, res) => {
  const rows = await prisma.payout.findMany({ where: { lawyerId: req.params.lawyerId }, orderBy: { createdAt: 'desc' } });
  const totalNetPaise = rows.reduce((sum, r) => sum + r.netPayablePaise, 0);
  res.json({ totalNetPaise, count: rows.length, rows });
});

module.exports = router;
