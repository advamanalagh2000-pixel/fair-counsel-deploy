const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuid } = require('uuid');
const { prisma, serializeLawyer, serializePublicLawyer, fromArr, toArr } = require('../prisma');
const { requireLawyer } = require('../middleware/auth');
const { applyLimiter, matchLimiter } = require('../middleware/rateLimit');
const { logAudit } = require('../services/auditLog');

const router = express.Router();

function feeValue(l) { return l.feePaise || 0; }

// Bar ID uploads live in their own subdirectory, kept separate from case
// documents (documents.js) since they belong to an applicant, not a case.
const BAR_ID_UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'bar-ids');
fs.mkdirSync(BAR_ID_UPLOAD_DIR, { recursive: true });
const barIdUpload = multer({
  storage: multer.diskStorage({
    destination: BAR_ID_UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${uuid()}-${file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`)
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ok = ['application/pdf', 'image/jpeg', 'image/png'].includes(file.mimetype);
    cb(ok ? null : new Error('Bar ID must be a PDF or JPG/PNG image'), ok);
  }
});

// Keyword-based matching for "describe it in your words" - not an AI model,
// just substring matching against common phrasing for each specialisation,
// but it's real (searches the actual lawyer roster) rather than the fixed
// "Matrimonial Law in Jaipur, 3 lawyers" response every query used to get
// regardless of what was actually typed.
const MATCH_SPEC_KEYWORDS = {
  'Family Law': ['divorce', 'matrimonial', 'custody', 'alimony', 'maintenance', 'marriage', 'domestic violence', 'child support'],
  'Criminal Law': ['criminal', 'fir', 'bail', 'arrest', 'police complaint', 'cheque bounce', 'theft', 'assault', '138'],
  'Real Estate & Property Law': ['rent', 'rental', 'property', 'landlord', 'tenant', 'lease', 'eviction', 'possession'],
  'Infrastructure & Construction Law': ['construction', 'builder', 'contractor dispute', 'infrastructure'],
  'Employment & Labour Law': ['employment', 'labour', 'labor', 'termination', 'wrongful termination', 'workplace harassment', 'salary dispute'],
  'Consumer Protection Law': ['consumer', 'refund', 'defective product', 'service deficiency', 'warranty claim'],
  'Taxation Law': ['tax notice', 'income tax', 'gst notice', 'tax dispute'],
  'Intellectual Property Rights (IPR)': ['trademark', 'copyright', 'patent', 'intellectual property'],
  'Contract Law': ['breach of contract', 'contract dispute', 'agreement breach'],
  'Motor Accident Claims': ['motor accident', 'vehicle accident', 'accident claim', 'insurance claim'],
  'Corporate & Commercial Law': ['company registration', 'startup', 'incorporation', 'business dispute', 'partnership dispute'],
  'Banking & Finance Law': ['loan default', 'bank dispute', 'recovery notice', 'finance dispute']
};
const MATCH_CITIES = ['Delhi', 'Jaipur', 'Mumbai', 'Bengaluru', 'Pune', 'Hyderabad'];

/** POST /api/lawyers/match  { text } — keyword-matches free text to a specialisation/city, returns real lawyers */
router.post('/match', matchLimiter, async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || !text.trim()) return res.status(400).json({ error: 'Describe your situation first' });
    const lower = text.toLowerCase();

    let matchedSpec = null;
    for (const [spec, keywords] of Object.entries(MATCH_SPEC_KEYWORDS)) {
      if (keywords.some(k => lower.includes(k))) { matchedSpec = spec; break; }
    }
    const matchedCity = MATCH_CITIES.find(c => lower.includes(c.toLowerCase())) || null;

    const where = { status: 'verified' };
    if (matchedSpec) where.specs = { contains: `"${matchedSpec}"` };
    if (matchedCity) where.city = matchedCity;

    let results = await prisma.lawyer.findMany({ where });
    let fellBack = false;
    if (results.length === 0 && (matchedSpec || matchedCity)) {
      // We recognised something in the text but don't have a lawyer for that
      // exact combination yet - show the general roster instead of a dead end.
      results = await prisma.lawyer.findMany({ where: { status: 'verified' } });
      fellBack = true;
    }

    res.json({
      matchedSpec,
      matchedCity,
      fellBack,
      count: results.length,
      results: results.slice(0, 3).map(serializePublicLawyer)
    });
  } catch (err) {
    console.error('POST /api/lawyers/match failed:', err);
    res.status(500).json({ error: 'Could not match you to a lawyer right now' });
  }
});

/** GET /api/lawyers?spec=&city=&lang=&exp=&sort=&page=&pageSize= */
router.get('/', async (req, res) => {
  try {
    const { spec, city, lang, exp, sort = 'recommended', page = '1', pageSize = '4' } = req.query;

    const where = { status: 'verified' };
    if (spec && spec !== 'Any') where.specs = { contains: `"${spec}"` };
    if (city && city !== 'Any') where.city = city;
    if (lang && lang !== 'Any') where.langs = { contains: `"${lang}"` };
    if (exp && exp !== 'Any') where.experienceYears = { gte: parseInt(exp, 10) || 0 };

    let results = (await prisma.lawyer.findMany({ where })).map(serializePublicLawyer);

    switch (sort) {
      case 'exp-desc': results.sort((a, b) => b.experienceYears - a.experienceYears); break;
      case 'fee-asc': results.sort((a, b) => feeValue(a) - feeValue(b)); break;
      case 'fee-desc': results.sort((a, b) => feeValue(b) - feeValue(a)); break;
      case 'consultations-desc': results.sort((a, b) => b.consultationsCompleted - a.consultationsCompleted); break;
      default: results.sort((a, b) => (b.pinned - a.pinned) || (b.badge === 'fave') - (a.badge === 'fave') || b.experienceYears - a.experienceYears);
    }

    const p = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.max(1, parseInt(pageSize, 10) || 4);
    const total = results.length;
    const start = (p - 1) * size;
    const pageResults = results.slice(start, start + size);

    res.json({ total, page: p, pageSize: size, totalPages: Math.max(1, Math.ceil(total / size)), results: pageResults });
  } catch (err) {
    console.error('GET /api/lawyers failed:', err);
    res.status(500).json({ error: 'Could not load lawyers right now' });
  }
});

/**
 * POST /api/lawyers/apply — public application form, lands in the admin
 * verification queue. Accepts either plain JSON (no bar ID file attached)
 * or multipart/form-data with a `barId` file field. barIdUpload only
 * activates for multipart requests (it no-ops and calls next() for a JSON
 * request, same as documents.js's upload middleware), so both bodies land
 * in req.body the same way either way - except multipart text fields
 * always arrive as strings, so `specs` (a real array in the JSON path)
 * needs normalizing below rather than assuming Array.isArray().
 */
router.post('/apply', applyLimiter, barIdUpload.single('barId'), async (req, res) => {
  try {
    const { name, phone, email, experienceYears, bar, enrolmentState, city, langs, bio } = req.body || {};
    const specs = Array.isArray(req.body?.specs) ? req.body.specs : (req.body?.specs ? [req.body.specs] : []);
    if (!name || !name.trim()) return res.status(400).json({ error: 'Full name is required' });
    if (!phone || !/^\d{10}$/.test(phone)) return res.status(400).json({ error: 'Provide a valid 10-digit phone number' });
    if (!bar || !bar.trim()) return res.status(400).json({ error: 'Bar registration number is required' });
    if (specs.length === 0) return res.status(400).json({ error: 'Pick at least one specialisation' });
    if (!req.file) return res.status(400).json({ error: 'A Bar ID upload is required to apply' });

    const existing = await prisma.lawyer.findUnique({ where: { phone } });
    if (existing) return res.status(409).json({ error: 'An application already exists for this phone number' });

    const init = name.trim().split(/\s+/).filter(Boolean).slice(-2).map(w => w[0]).join('').toUpperCase();
    const lawyer = await prisma.lawyer.create({
      data: {
        name: name.trim(),
        phone,
        email: email || null,
        init,
        tags: fromArr(specs),
        specs: fromArr(specs),
        city: city || '',
        langs: fromArr(Array.isArray(langs) ? langs : String(langs || '').split(',').map(s => s.trim()).filter(Boolean)),
        experienceYears: parseInt(experienceYears, 10) || 0,
        bar: bar.trim(),
        bio: bio || '',
        status: 'pending',
        barIdOriginalName: req.file ? req.file.originalname : null,
        barIdStoredPath: req.file ? req.file.filename : null,
        barIdMimeType: req.file ? req.file.mimetype : null
      }
    });
    logAudit('info', `New lawyer application: ${lawyer.name} (${enrolmentState || 'state n/a'})`);
    res.status(201).json({ id: lawyer.id, status: lawyer.status });
  } catch (err) {
    console.error('POST /api/lawyers/apply failed:', err);
    res.status(500).json({ error: 'Could not submit your application right now' });
  }
});

// Multer's fileFilter/size-limit errors reach here (not the try/catch above,
// they happen in the upload middleware before the handler runs), turn them
// into a proper 400 instead of falling through to the generic 500 handler.
router.use('/apply', (err, req, res, next) => {
  res.status(400).json({ error: err.message || 'Could not process that upload' });
});

/** GET /api/lawyers/me — the logged-in lawyer's own profile */
router.get('/me', requireLawyer, async (req, res) => {
  const lawyer = await prisma.lawyer.findUnique({ where: { id: req.lawyer.sub } });
  if (!lawyer) return res.status(404).json({ error: 'Not found' });
  res.json(serializeLawyer(lawyer));
});

const AVAILABILITY_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const AVAILABILITY_PERIODS = ['morning', 'afternoon', 'evening'];
const VALID_AVAILABILITY_SLOTS = new Set(
  AVAILABILITY_DAYS.flatMap(day => AVAILABILITY_PERIODS.map(period => `${day}-${period}`))
);

/** PUT /api/lawyers/me/availability  { slots: string[] } — the lawyer's own weekly availability grid */
router.put('/me/availability', requireLawyer, async (req, res) => {
  try {
    const { slots } = req.body || {};
    if (!Array.isArray(slots) || slots.some(s => !VALID_AVAILABILITY_SLOTS.has(s))) {
      return res.status(400).json({ error: 'slots must be an array of valid "Day-period" keys' });
    }
    const lawyer = await prisma.lawyer.update({
      where: { id: req.lawyer.sub },
      data: { availability: fromArr([...new Set(slots)]) }
    });
    res.json({ availability: toArr(lawyer.availability) });
  } catch (err) {
    console.error('PUT /api/lawyers/me/availability failed:', err);
    res.status(500).json({ error: 'Could not save availability right now' });
  }
});

/** GET /api/lawyers/:id */
router.get('/:id', async (req, res) => {
  const lawyer = await prisma.lawyer.findUnique({ where: { id: req.params.id } });
  if (!lawyer) return res.status(404).json({ error: 'Not found' });
  res.json(serializePublicLawyer(lawyer));
});

module.exports = router;
