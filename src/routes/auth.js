import { getDb } from '../db.js';
import { config } from '../config.js';
import { badRequest, cookie, readJson, send, unauthorized } from '../lib/http.js';
import {
  SESSION_COOKIE, checkLoginRate, clearLoginRate, hashPassword, requireAdmin, requireUser, signToken, verifyPassword,
} from '../lib/auth.js';

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role });

export function registerAuthRoutes(router) {
  router.post('/api/auth/login', async (ctx) => {
    const ip = ctx.req.socket.remoteAddress || 'unknown';
    checkLoginRate(ip);
    const { email, password } = await readJson(ctx.req);
    if (!email || !password) throw badRequest('Enter your email and password.');
    const user = getDb().prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim());
    if (!user || !verifyPassword(String(password), user.password_hash)) {
      throw unauthorized('That email and password don’t match. Check them and try again.');
    }
    clearLoginRate(ip);
    const token = signToken({ sub: String(user.id), role: user.role });
    send(ctx.res, 200, { user: publicUser(user), token }, {
      'Set-Cookie': cookie(SESSION_COOKIE, token, { maxAge: config.sessionDays * 86400 }),
    });
  });

  router.post('/api/auth/logout', ({ res }) => {
    send(res, 200, { ok: true }, { 'Set-Cookie': cookie(SESSION_COOKIE, '', { maxAge: 0 }) });
  });

  router.get('/api/auth/me', (ctx) => {
    requireUser(ctx);
    send(ctx.res, 200, { user: publicUser(ctx.user) });
  });

  router.patch('/api/auth/me', async (ctx) => {
    requireUser(ctx);
    const body = await readJson(ctx.req);
    const db = getDb();
    if (body.name !== undefined) {
      const name = String(body.name).trim().slice(0, 80);
      if (!name) throw badRequest('Your name can’t be empty.');
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, ctx.user.id);
    }
    if (body.new_password !== undefined) {
      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(ctx.user.id);
      if (!verifyPassword(String(body.current_password || ''), row.password_hash)) {
        throw badRequest('Your current password is incorrect.');
      }
      if (String(body.new_password).length < 8) throw badRequest('Use at least 8 characters for the new password.');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(body.new_password)), ctx.user.id);
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.user.id);
    send(ctx.res, 200, { user: publicUser(user) });
  });

  // Team management (admins only)
  router.get('/api/admin/users', (ctx) => {
    requireAdmin(ctx);
    const rows = getDb().prepare('SELECT id, email, name, role, created_at FROM users ORDER BY created_at').all();
    send(ctx.res, 200, { users: rows.map((r) => ({ ...r })) });
  });

  router.post('/api/admin/users', async (ctx) => {
    requireAdmin(ctx);
    const { email, name, password, role = 'editor' } = await readJson(ctx.req);
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw badRequest('Enter a valid email address.');
    if (!name) throw badRequest('Enter a name.');
    if (!password || String(password).length < 8) throw badRequest('Use at least 8 characters for the password.');
    const db = getDb();
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw badRequest('Someone with that email already has an account.');
    const r = db
      .prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(String(email).trim(), String(name).trim(), hashPassword(String(password)), role === 'admin' ? 'admin' : 'editor');
    send(ctx.res, 201, { user: { id: Number(r.lastInsertRowid), email, name, role } });
  });

  router.delete('/api/admin/users/:id', (ctx) => {
    requireAdmin(ctx);
    const id = Number(ctx.params.id);
    if (id === ctx.user.id) throw badRequest('You can’t remove your own account.');
    getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
    send(ctx.res, 200, { ok: true });
  });
}
