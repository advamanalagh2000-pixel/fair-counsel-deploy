require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

/**
 * Regenerate the Prisma client before anything below requires it. Some hosts
 * (GoDaddy's Node.js hosting among them) reuse a cached node_modules across
 * deploys and skip `npm install`, so a schema.prisma change (like adding
 * binaryTargets for a different OpenSSL version) would otherwise never take
 * effect. This runs on every boot; `prisma generate` is fast and idempotent.
 */
try {
  execSync('npx prisma generate', { cwd: __dirname, stdio: 'inherit' });
} catch (err) {
  console.error('Prisma generate failed on startup:', err.message);
}

/**
 * Prisma's own runtime OpenSSL detection is unreliable on Linux hosts like
 * GoDaddy's (it logs "failed to detect the libssl/openssl version...
 * defaulting to openssl-1.1.x" and that default is wrong there, that host
 * only has OpenSSL 3.x). Rather than trust that guess, look at which query
 * engine binaries actually got generated on disk (via the binaryTargets in
 * schema.prisma) and point Prisma at a non-1.1.x one directly, bypassing its
 * detection entirely. Linux-only: macOS uses a different file type
 * (.dylib.node) and its normal, already-working default selection, this
 * whole problem is specific to the Linux/OpenSSL-3.0 host.
 */
if (process.platform === 'linux') {
  try {
    const enginesDir = path.join(__dirname, 'node_modules', '.prisma', 'client');
    const candidates = fs.readdirSync(enginesDir).filter(f => f.startsWith('libquery_engine-') && f.endsWith('.so.node'));
    const preferred = candidates.find(f => f.includes('openssl-3.0.x')) || candidates.find(f => !f.includes('openssl-1.1.x'));
    if (preferred) {
      process.env.PRISMA_QUERY_ENGINE_LIBRARY = path.join(enginesDir, preferred);
      console.log('Using Prisma query engine binary:', preferred);
    } else {
      console.warn('No non-openssl-1.1.x Prisma query engine binary found among:', candidates);
    }
  } catch (err) {
    console.error('Could not select a Prisma query engine binary:', err.message);
  }
}

const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use((req, res, next) => {
  if (req.path.startsWith('/api/payments/webhooks/')) return next(); // raw body for signature checks
  express.json({ limit: '2mb' })(req, res, next);
});

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/lawyers', require('./src/routes/lawyers'));
app.use('/api/cases', require('./src/routes/cases'));
app.use('/api/payments', require('./src/routes/payments'));
app.use('/api/documents', require('./src/routes/documents'));
app.use('/api/esign', require('./src/routes/esign'));
app.use('/api/admin', require('./src/routes/admin'));

// Serves the frontend (public/index.html, kept in sync with the top-level
// fair-counsel-frontend.html via `npm run sync-frontend`) from the same
// origin as the API, so there's nothing else to deploy or configure for CORS.
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;

/**
 * Self-contained startup: apply any pending Prisma migrations, then seed
 * demo data if the database is empty, THEN start accepting requests. Makes
 * the app boot-ready on hosts that don't offer a terminal for one-off setup
 * commands. Safe to run on every boot: `prisma migrate deploy` is a no-op
 * once migrations are already applied, and seed.js only inserts rows when
 * its tables are empty.
 *
 * On hosts where Prisma's migration engine binary itself won't run (see the
 * README note on GoDaddy's OpenSSL mismatch), a pre-migrated, pre-seeded
 * database file ships as part of the deploy instead (checked in at the path
 * DATABASE_URL resolves to), so migrate deploy is skipped entirely rather
 * than logging a crash on every boot for a step that already isn't needed.
 */
async function start() {
  const dbFile = (process.env.DATABASE_URL || '').replace(/^file:/, '');
  const dbPath = dbFile ? path.join(__dirname, 'prisma', dbFile) : null;
  if (dbPath && fs.existsSync(dbPath)) {
    console.log('Database file already present, skipping prisma migrate deploy:', dbPath);
  } else {
    try {
      execSync('npx prisma migrate deploy', { cwd: __dirname, stdio: 'inherit' });
    } catch (err) {
      console.error('Prisma migrate deploy failed on startup:', err.message);
    }
  }
  try {
    await require('./src/seed').seed();
  } catch (err) {
    console.error('Startup seed failed:', err.message);
  }

  app.listen(PORT, () => {
    console.log(`Fair Counsel backend listening on http://localhost:${PORT}`);
    console.log(`Try: curl http://localhost:${PORT}/api/health`);
  });
}

start();
