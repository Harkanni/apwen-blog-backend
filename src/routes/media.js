import { createReadStream, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { badRequest, notFound, readJson, readRaw, send, HttpError } from '../lib/http.js';
import { requireUser } from '../lib/auth.js';
import { inspectImage } from '../lib/image.js';

const serialize = (m) => ({ ...m, url: `/uploads/${m.filename}` });

export function registerMediaRoutes(router) {
  /**
   * Upload one image. The request body is the raw file bytes (not multipart):
   *   fetch('/api/admin/media', { method: 'POST', body: file, headers: { 'X-File-Name': file.name } })
   */
  router.post('/api/admin/media', async (ctx) => {
    requireUser(ctx);
    const buf = await readRaw(ctx.req, config.maxUploadBytes);
    if (!buf.length) throw badRequest('No file was received.');
    const info = inspectImage(buf);
    if (!info) throw new HttpError(415, 'That file isn’t a supported image. Use JPG, PNG, WebP, GIF or AVIF.');
    mkdirSync(config.uploadDir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 7).replace('-', '');
    const filename = `${stamp}-${randomBytes(9).toString('base64url')}.${info.ext}`;
    writeFileSync(join(config.uploadDir, filename), buf);
    const original = decodeURIComponent(String(ctx.req.headers['x-file-name'] || '')).slice(0, 200);
    const db = getDb();
    const r = db
      .prepare('INSERT INTO media (filename, original_name, mime, size, width, height) VALUES (?, ?, ?, ?, ?, ?)')
      .run(filename, original, info.mime, buf.length, info.width, info.height);
    const row = db.prepare('SELECT * FROM media WHERE id = ?').get(Number(r.lastInsertRowid));
    send(ctx.res, 201, { media: serialize(row) });
  });

  router.get('/api/admin/media', (ctx) => {
    requireUser(ctx);
    const rows = getDb().prepare('SELECT * FROM media ORDER BY created_at DESC, id DESC LIMIT 300').all();
    send(ctx.res, 200, { media: rows.map(serialize) });
  });

  router.patch('/api/admin/media/:id', async (ctx) => {
    requireUser(ctx);
    const { alt } = await readJson(ctx.req);
    getDb().prepare('UPDATE media SET alt = ? WHERE id = ?').run(String(alt ?? '').slice(0, 300), Number(ctx.params.id));
    send(ctx.res, 200, { ok: true });
  });

  router.delete('/api/admin/media/:id', (ctx) => {
    requireUser(ctx);
    const db = getDb();
    const row = db.prepare('SELECT * FROM media WHERE id = ?').get(Number(ctx.params.id));
    if (!row) throw notFound('That image no longer exists.');
    const url = `/uploads/${row.filename}`;
    const used = db.prepare('SELECT COUNT(*) AS n FROM posts WHERE cover_image = ? OR instr(content, ?) > 0').get(url, url).n;
    if (used && ctx.query.get('force') !== 'true') {
      throw new HttpError(409, `This image is used in ${used} post${used === 1 ? '' : 's'}. Remove it from ${used === 1 ? 'that post' : 'those posts'} first.`);
    }
    db.prepare('DELETE FROM media WHERE id = ?').run(row.id);
    try {
      unlinkSync(join(config.uploadDir, row.filename));
    } catch {
      /* already gone */
    }
    send(ctx.res, 200, { ok: true });
  });
}

const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };

/** Serve uploaded files with long-lived caching (filenames are content-unique). */
export function serveUpload(req, res, pathname) {
  const name = basename(decodeURIComponent(pathname.slice('/uploads/'.length)));
  const ext = name.split('.').pop().toLowerCase();
  if (!MIME[ext]) return false;
  const file = join(config.uploadDir, name);
  let stat;
  try {
    stat = statSync(file);
  } catch {
    return false;
  }
  res.writeHead(200, {
    'Content-Type': MIME[ext],
    'Content-Length': stat.size,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') return res.end(), true;
  createReadStream(file).pipe(res);
  return true;
}
