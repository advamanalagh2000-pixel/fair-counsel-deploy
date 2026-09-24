const express = require('express');
const PDFDocument = require('pdfkit');
const { prisma } = require('../prisma');
const { requireAuth } = require('../middleware/auth');
const { createOrder, verifyPaymentSignature, verifyWebhookSignature, MOCK_MODE } = require('../services/paymentProvider');
const { logAudit } = require('../services/auditLog');
const { notify } = require('../services/notifications');

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
    await notify({
      recipientRole: 'lawyer', recipientId: c.lawyerId, type: 'payment', caseId: c.id,
      title: `Payment received for FILE ${c.fileCode}`,
      body: `${payment.stage[0].toUpperCase()}${payment.stage.slice(1)} payment of ₹${(payment.amountPaise / 100).toLocaleString('en-IN')} confirmed.`
    });
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

const PAY_STAGE_LABEL = { consultation: 'Consultation fee', advance: 'Advance (drafting) payment', final: 'Final payment' };

/**
 * GET /api/payments/:id/invoice — a real downloadable PDF, not the old
 * frontend button that just relabelled itself "Invoice ready" and
 * generated nothing. The GST split here is illustrative (treats the
 * amount charged as GST-inclusive at 18%, the standard rate for this kind
 * of service) - Fair Counsel needs to confirm actual GST treatment,
 * GSTIN, and invoicing requirements with a CA before this is relied on
 * for real compliance or filing.
 */
router.get('/:id/invoice', requireAuth, async (req, res) => {
  try {
  if (req.user.role !== 'user') return res.status(403).json({ error: 'Only the client who paid can download this invoice' });
  const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.status !== 'paid') return res.status(400).json({ error: 'This payment has not been completed yet' });
  const c = await prisma.case.findUnique({ where: { id: payment.caseId } });
  if (!c || c.clientId !== req.user.sub) return res.status(404).json({ error: 'Payment not found' });
  const client = await prisma.user.findUnique({ where: { id: c.clientId } });

  const GST_RATE = 0.18;
  const totalRupees = payment.amountPaise / 100;
  const taxableValue = totalRupees / (1 + GST_RATE);
  const gstAmount = totalRupees - taxableValue;
  const invoiceNo = `FC-INV-${c.fileCode.replace(/\//g, '-')}-${payment.stage.toUpperCase()}`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${invoiceNo}.pdf"`);

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);

  doc.fontSize(18).fillColor('#14467D').text('Fair Counsel Legal Marketplace Pvt. Ltd.', { continued: false });
  doc.fontSize(9).fillColor('#666').text('GSTIN: [GSTIN placeholder - confirm before real use]  |  CIN: U74999XX2026PTC000000 (placeholder)');
  doc.text('Registered office: [registered address], New Delhi, India');
  doc.moveDown(1.2);

  doc.fontSize(14).fillColor('#000').text('Tax Invoice', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('#000');
  doc.text(`Invoice No: ${invoiceNo}`);
  doc.text(`Invoice Date: ${(payment.paidAt || new Date()).toLocaleDateString('en-IN', { dateStyle: 'long' })}`);
  doc.text(`Case File: ${c.fileCode}`);
  doc.moveDown(0.8);

  doc.text('Billed to:');
  doc.text(client ? (client.name || 'Client') : 'Client');
  if (client && client.phone) doc.text(`Phone: ${client.phone}`);
  if (client && client.companyName) doc.text(`Company: ${client.companyName}`);
  if (client && client.gstin) doc.text(`Client GSTIN: ${client.gstin}`);
  doc.moveDown(1);

  const tableTop = doc.y;
  doc.font('Helvetica-Bold');
  doc.text('Description', 50, tableTop);
  doc.text('Amount', 420, tableTop, { width: 100, align: 'right' });
  doc.font('Helvetica');
  doc.moveTo(50, tableTop + 16).lineTo(520, tableTop + 16).strokeColor('#ccc').stroke();

  let y = tableTop + 24;
  doc.text(`${PAY_STAGE_LABEL[payment.stage] || payment.stage} — ${c.category}`, 50, y, { width: 350 });
  doc.text(`Rs. ${taxableValue.toFixed(2)}`, 420, y, { width: 100, align: 'right' });
  y += 20;
  doc.text('CGST @ 9%', 50, y);
  doc.text(`Rs. ${(gstAmount / 2).toFixed(2)}`, 420, y, { width: 100, align: 'right' });
  y += 20;
  doc.text('SGST @ 9%', 50, y);
  doc.text(`Rs. ${(gstAmount / 2).toFixed(2)}`, 420, y, { width: 100, align: 'right' });
  y += 24;
  doc.moveTo(50, y).lineTo(520, y).strokeColor('#ccc').stroke();
  y += 8;
  doc.font('Helvetica-Bold');
  doc.text('Total (GST-inclusive)', 50, y);
  doc.text(`Rs. ${totalRupees.toFixed(2)}`, 420, y, { width: 100, align: 'right' });
  doc.font('Helvetica');

  doc.moveDown(4);
  doc.fontSize(8).fillColor('#888').text(
    'This tax breakdown is illustrative (18% GST, split evenly as CGST/SGST, applied to the amount charged as GST-inclusive). ' +
    'Confirm actual GST registration, applicable rate, and invoicing requirements with a chartered accountant before relying on this document for tax filing or compliance.',
    { width: 470 }
  );

  doc.end();
  } catch (err) {
    console.error('GET /api/payments/:id/invoice failed:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Could not generate invoice right now' });
  }
});

/** GET /api/payments/payouts/:lawyerId — lawyer earnings ledger */
router.get('/payouts/:lawyerId', async (req, res) => {
  const rows = await prisma.payout.findMany({ where: { lawyerId: req.params.lawyerId }, orderBy: { createdAt: 'desc' } });
  const totalNetPaise = rows.reduce((sum, r) => sum + r.netPayablePaise, 0);
  res.json({ totalNetPaise, count: rows.length, rows });
});

module.exports = router;
