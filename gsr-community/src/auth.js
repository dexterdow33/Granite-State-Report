const crypto = require('node:crypto');

const SESSION_COOKIE = 'gsrc_sid';
const CSRF_COOKIE = 'gsrc_csrf';

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieOptions(config, maxAgeMs) {
  return { httpOnly: true, sameSite: 'lax', secure: config.production, path: '/', maxAge: maxAgeMs };
}

function createSession(db, config, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const maxAge = config.sessionDays * 24 * 60 * 60 * 1000;
  const expires = new Date(Date.now() + maxAge).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, expires);
  res.cookie(SESSION_COOKIE, token, cookieOptions(config, maxAge));
}

function destroySession(db, req, res) {
  const token = req.cookies[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

// Loads cookies, the signed-in user, and a double-submit CSRF token onto req/res.locals.
function sessionMiddleware(db, config) {
  return (req, res, next) => {
    req.cookies = parseCookies(req.headers.cookie);
    req.user = null;
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      const row = db.prepare(`
        SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ?`).get(sha256(token), new Date().toISOString());
      if (row) req.user = row;
    }
    let csrf = req.cookies[CSRF_COOKIE];
    if (!csrf || csrf.length < 20) {
      csrf = crypto.randomBytes(24).toString('base64url');
      res.cookie(CSRF_COOKIE, csrf, cookieOptions(config, 365 * 24 * 60 * 60 * 1000));
    }
    req.csrfToken = csrf;
    next();
  };
}

function csrfValid(req) {
  const sent = req.body && req.body._csrf;
  if (typeof sent !== 'string' || !req.csrfToken) return false;
  const a = Buffer.from(sent);
  const b = Buffer.from(req.csrfToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Simple fixed-window limiter for login and signup attempts, keyed by IP.
function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) return res.status(429).send('Too many attempts. Try again in a few minutes.');
    next();
  };
}

module.exports = {
  hashPassword, verifyPassword, createSession, destroySession,
  sessionMiddleware, csrfValid, rateLimiter,
};
