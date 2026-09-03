const express = require('express');
const { prisma, serializeLawyer, serializePublicLawyer, fromArr } = require('../prisma');
const { requireLawyer } = require('../middleware/auth');
const { applyLimiter } = require('../middleware/rateLimit');
const { logAudit } = require('../services/auditLog');

const router = express.Router();

function feeValue(l) { return l.feePaise || 0; }

/** GET /api/lawyers?spec=&city=&lang=&exp=&sort=&page=&pageSize= */
router.get('/', async (req, res) => {
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
    default: results.sort((a, b) => (b.badge === 'fave') - (a.badge === 'fave') || b.experienceYears - a.experienceYears);
  }

  const p = Math.max(1, parseInt(page, 10) || 1);
  const size = Math.max(1, parseInt(pageSize, 10) || 4);
  const total = results.length;
  const start = (p - 1) * size;
  const pageResults = results.slice(start, start + size);

  res.json({ total, page: p, pageSize: size, totalPages: Math.max(1, Math.ceil(total / size)), results: pageResults });
});

/** POST /api/lawyers/apply — public application form, lands in the admin verification queue */
router.post('/apply', applyLimiter, async (req, res) => {
  const { name, phone, email, experienceYears, bar, enrolmentState, city, langs, specs, bio } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Full name is required' });
  if (!phone || !/^\d{10}$/.test(phone)) return res.status(400).json({ error: 'Provide a valid 10-digit phone number' });
  if (!bar || !bar.trim()) return res.status(400).json({ error: 'Bar registration number is required' });
  if (!Array.isArray(specs) || specs.length === 0) return res.status(400).json({ error: 'Pick at least one specialisation' });

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
      status: 'pending'
    }
  });
  logAudit('info', `New lawyer application: ${lawyer.name} (${enrolmentState || 'state n/a'})`);
  res.status(201).json({ id: lawyer.id, status: lawyer.status });
});

/** GET /api/lawyers/me — the logged-in lawyer's own profile */
router.get('/me', requireLawyer, async (req, res) => {
  const lawyer = await prisma.lawyer.findUnique({ where: { id: req.lawyer.sub } });
  if (!lawyer) return res.status(404).json({ error: 'Not found' });
  res.json(serializeLawyer(lawyer));
});

/** GET /api/lawyers/:id */
router.get('/:id', async (req, res) => {
  const lawyer = await prisma.lawyer.findUnique({ where: { id: req.params.id } });
  if (!lawyer) return res.status(404).json({ error: 'Not found' });
  res.json(serializePublicLawyer(lawyer));
});

module.exports = router;
