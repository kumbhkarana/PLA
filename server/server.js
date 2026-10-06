'use strict';
/* BIMO server: serves the app, handles agent login and talks to the SUD Life BI portal. */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PortalSession, PortalError } = require('./portal');

const PORT = parseInt(process.env.PORT || '8080', 10);
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'assets', 'vendor'];
const SESSION_TTL = 12 * 60 * 60 * 1000;
const USERS = JSON.parse(fs.readFileSync(process.env.BIMO_USERS || path.join(__dirname, 'users.json'), 'utf8'));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2'
};

const sessions = new Map(); // token → { user, portal, expires }

function getSession(req) {
  const m = /(?:^|;\s*)bimo_sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  const s = m && sessions.get(m[1]);
  if (!s) return null;
  if (s.expires < Date.now()) { sessions.delete(m[1]); return null; }
  s.expires = Date.now() + SESSION_TTL;
  return s;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions) if (s.expires < now) sessions.delete(k);
}, 10 * 60 * 1000).unref();

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(data);
}

function readJson(req, limit = 100 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function api(req, res, route) {
  if (req.method !== 'POST' && route !== 'me') return send(res, 405, { error: 'Method not allowed' });

  if (route === 'login') {
    const { username = '', code = '' } = await readJson(req);
    const u = USERS.find((x) => x.username.toLowerCase() === String(username).trim().toLowerCase());
    if (!u || !safeEqual(u.code, String(code).trim())) return send(res, 401, { error: 'Incorrect username or password.' });
    const token = crypto.randomBytes(32).toString('hex');
    const user = { name: u.name, tier: u.tier, username: u.username };
    sessions.set(token, { user, portal: new PortalSession(), expires: Date.now() + SESSION_TTL });
    const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
    return send(res, 200, { user }, { 'Set-Cookie': `bimo_sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}${secure}` });
  }

  const session = getSession(req);
  if (!session) return send(res, 401, { error: 'Please log in again.' });

  if (route === 'me') return send(res, 200, { user: session.user });

  if (route === 'logout') {
    const m = /(?:^|;\s*)bimo_sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
    if (m) sessions.delete(m[1]);
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'bimo_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  if (route === 'lookup') {
    const { productId, method, data } = await readJson(req);
    return send(res, 200, { d: await session.portal.lookup(productId, method, data) });
  }

  if (route === 'generate') {
    const input = await readJson(req);
    return send(res, 200, await session.portal.generate(input));
  }

  return send(res, 404, { error: 'Not found' });
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath).replace(/^\/+/, '') || 'index.html';
  if (!PUBLIC.some((p) => rel === p || rel.startsWith(p + '/'))) return send(res, 404, 'Not found');
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) return send(res, 404, 'Not found');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url.pathname.slice(5));
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    serveStatic(req, res, url.pathname);
  } catch (err) {
    if (err instanceof PortalError) return send(res, 422, { error: err.message, details: err.details });
    console.error(err);
    const offline = /fetch failed|timeout|ENOTFOUND|ECONNRESET|aborted/i.test(String(err && (err.cause || err.message)));
    send(res, offline ? 502 : 500, { error: offline ? 'Could not reach the SUD Life BI portal. Please try again.' : 'Something went wrong.' });
  }
});

server.listen(PORT, () => console.log(`BIMO running on http://localhost:${PORT}`));
