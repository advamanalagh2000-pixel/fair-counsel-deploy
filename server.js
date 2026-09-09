// dotenv only loads a local .env file for development, the deployed app has
// no .env file (secrets come from the host's own environment variables), so
// treat a missing/failed install of this dev-only dependency as harmless
// rather than a fatal crash, this platform's npm install has been
// unreliable about fully completing before.
try { require('dotenv').config(); } catch (err) { console.warn('dotenv not available, continuing without a local .env file:', err.message); }
const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');

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
 * Prisma's own runtime auto-detection of which query engine binary to load
 * has repeatedly guessed wrong on this host (GoDaddy's Node hosting is
 * Alpine/musl, not glibc, and its OpenSSL version isn't what Prisma expects
 * by default). binaryTargets in schema.prisma ships candidates for several
 * environments, but Prisma still picks one via its own heuristic at query
 * time. Since the query engine only loads lazily, on the FIRST actual query
 * (not at `new PrismaClient()`), a wrong guess doesn't show up until some
 * request calls the database, and by then it's an unhandled rejection deep
 * inside a route handler. So: scan the generated engine binaries ourselves,
 * try loading each candidate in-process (not via a spawned subprocess, since
 * this platform may restrict subprocess spawning) until one actually works,
 * and pin Prisma to that one explicitly via PRISMA_QUERY_ENGINE_LIBRARY
 * before any route (and therefore any Prisma query) can run.
 */
if (process.platform === 'linux') {
  try {
    const enginesDir = path.join(__dirname, 'node_modules', '.prisma', 'client');
    const candidates = fs.readdirSync(enginesDir).filter(f => f.startsWith('libquery_engine-') && f.endsWith('.so.node'));
    const ordered = [
      ...candidates.filter(f => f.includes('musl')),
      ...candidates.filter(f => !f.includes('musl') && !f.includes('openssl-1.1.x')),
      ...candidates.filter(f => !f.includes('musl') && f.includes('openssl-1.1.x'))
    ];
    let chosen = null;
    for (const candidate of ordered) {
      const enginePath = path.join(enginesDir, candidate);
      try { require(enginePath); chosen = candidate; break; } catch {}
    }
    if (chosen) {
      process.env.PRISMA_QUERY_ENGINE_LIBRARY = path.join(enginesDir, chosen);
      console.log('Using Prisma query engine binary:', chosen);
    } else {
      console.warn('No working Prisma query engine binary found among:', candidates);
    }
  } catch (err) {
    console.error('Could not select a Prisma query engine binary:', err.message);
  }
}

/**
 * None of the ~35 async route handlers in src/routes catch their own errors,
 * and Express 4 does not propagate a rejected promise from an async handler
 * to the error middleware on its own (that's an Express 5 behavior). Without
 * this, a single failing request (e.g. a Prisma error) becomes an unhandled
 * rejection, which Node treats as fatal and kills the whole process, taking
 * every other visitor down with it, and the platform then boots a fresh
 * process that dies the same way on the next such request. Logging instead
 * of crashing keeps the rest of the site up even when one request fails.
 */
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (process staying up):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (process staying up):', err);
});

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
app.use('/api/support', require('./src/routes/support'));
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
 */
async function start() {
  try {
    execSync('npx prisma migrate deploy', { cwd: __dirname, stdio: 'inherit' });
  } catch (err) {
    console.error('Prisma migrate deploy failed on startup:', err.message);
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
