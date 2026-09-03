require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { execSync } = require('child_process');

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
