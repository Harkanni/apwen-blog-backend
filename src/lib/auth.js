import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { parseCookies, unauthorized, HttpError } from './http.js';

export const SESSION_COOKIE = 'apwen_session';

// ---- Passwords (scrypt) -------------------------------------------------
export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(expected, actual);
}

// ---- Signed tokens (HS256 JWT) ------------------------------------------
const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function signToken(payload, ttlSeconds = config.sessionDays * 86400) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }));
  const sig = createHmac('sha256', config.jwtSecret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [header, body, sig] = token.split('.');
  if (!header || !body || !sig) return null;
  const expected = createHmac('sha256', config.jwtSecret).update(`${header}.${body}`).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Resolve the signed-in user from the session cookie or a Bearer token. */
export function userFromRequest(req) {
  let token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const auth = req.headers.authorization;
  if (!token && auth?.startsWith('Bearer ')) token = auth.slice(7);
  const payload = verifyToken(token);
  if (!payload?.sub) return null;
  const user = getDb()
    .prepare('SELECT id, email, name, role, created_at FROM users WHERE id = ?')
    .get(Number(payload.sub));
  return user ? { ...user } : null;
}

/** Route guard. */
export function requireUser(ctx) {
  if (!ctx.user) throw unauthorized();
}

export function requireAdmin(ctx) {
  requireUser(ctx);
  if (ctx.user.role !== 'admin') throw new HttpError(403, 'Only admins can do this.');
}

// ---- Login rate limiting (in-memory, per IP) ----------------------------
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function checkLoginRate(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now - entry.first > WINDOW_MS) {
    attempts.set(ip, { first: now, count: 1 });
    return;
  }
  entry.count++;
  if (entry.count > MAX_ATTEMPTS) {
    const mins = Math.ceil((WINDOW_MS - (now - entry.first)) / 60000);
    throw new HttpError(429, `Too many sign-in attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
  }
}

export function clearLoginRate(ip) {
  attempts.delete(ip);
}
