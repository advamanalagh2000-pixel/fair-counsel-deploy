const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuid } = require('uuid');
const { prisma } = require('../prisma');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../services/auditLog');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true }); // in case the host's file transfer dropped this empty directory
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, `${uuid()}-${file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

function canAccessCase(user, caseRecord) {
  if (!caseRecord) return false;
  if (user.role === 'user') return caseRecord.clientId === user.sub;
  if (user.role === 'lawyer') return caseRecord.lawyerId === user.sub;
  return false;
}

// A client can only see/download a document once it's cleared Fair Counsel's
// review, a lawyer sees all of their own uploads regardless of status, so
// they know what's pending vs sent back.
function canViewDocument(user, doc) {
  if (user.role === 'lawyer') return true;
  return doc.status === 'approved';
}

/** POST /api/documents/:caseId  (multipart form field: file) */
router.post('/:caseId', requireAuth, upload.single('file'), async (req, res) => {
  const c = await prisma.case.findUnique({ where: { id: req.params.caseId } });
  if (!canAccessCase(req.user, c)) return res.status(403).json({ error: 'No access to this case' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  // A lawyer's draft has to pass Fair Counsel review before the client sees it.
  // A client's own upload (e.g. supporting documents) has nothing to gate.
  const status = req.user.role === 'lawyer' ? 'pending_review' : 'approved';

  const doc = await prisma.document.create({
    data: {
      caseId: c.id,
      uploadedBy: req.user.sub,
      uploadedByRole: req.user.role,
      originalName: req.file.originalname,
      storedPath: req.file.filename, // never expose the raw disk path to clients
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      status
    }
  });
  if (status === 'pending_review') {
    logAudit('info', `Draft "${doc.originalName}" uploaded for case ${c.fileCode}, awaiting Fair Counsel review`);
  }
  res.status(201).json({ id: doc.id, originalName: doc.originalName, sizeBytes: doc.sizeBytes, status: doc.status });
});

/** GET /api/documents/mine — every document across all of the current user's cases, for a "My Documents" hub */
router.get('/mine', requireAuth, async (req, res) => {
  const myCases = req.user.role === 'lawyer'
    ? await prisma.case.findMany({ where: { lawyerId: req.user.sub } })
    : await prisma.case.findMany({ where: { clientId: req.user.sub } });
  const caseIds = myCases.map(c => c.id);
  const caseById = Object.fromEntries(myCases.map(c => [c.id, c]));
  const docs = (await prisma.document.findMany({ where: { caseId: { in: caseIds } }, orderBy: { createdAt: 'desc' } }))
    .filter(d => canViewDocument(req.user, d))
    .map(({ storedPath, ...rest }) => ({
      ...rest,
      fileCode: caseById[rest.caseId] ? caseById[rest.caseId].fileCode : null,
      category: caseById[rest.caseId] ? caseById[rest.caseId].category : null
    }));
  res.json(docs);
});

/** GET /api/documents/case/:caseId — list documents for a case (metadata only) */
router.get('/case/:caseId', requireAuth, async (req, res) => {
  const c = await prisma.case.findUnique({ where: { id: req.params.caseId } });
  if (!canAccessCase(req.user, c)) return res.status(403).json({ error: 'No access to this case' });
  const docs = (await prisma.document.findMany({ where: { caseId: c.id }, orderBy: { createdAt: 'desc' } }))
    .filter(d => canViewDocument(req.user, d))
    .map(({ storedPath, ...rest }) => rest); // never leak disk paths
  res.json(docs);
});

/** GET /api/documents/:id/download */
router.get('/:id/download', requireAuth, async (req, res) => {
  const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
  if (!doc) return res.status(404).json({ error: 'Not found' });
  const c = await prisma.case.findUnique({ where: { id: doc.caseId } });
  if (!canAccessCase(req.user, c)) return res.status(403).json({ error: 'No access to this document' });
  if (!canViewDocument(req.user, doc)) return res.status(403).json({ error: 'This document is still under Fair Counsel review' });
  res.download(path.join(UPLOAD_DIR, doc.storedPath), doc.originalName);
});

module.exports = router;
