import { getDb, tx, nowIso } from '../db.js';
import { badRequest, notFound, readJson, send } from '../lib/http.js';
import { requireUser } from '../lib/auth.js';
import { sanitizeDoc, docToText, readingMinutes, countImages, makeExcerpt, slugify } from '../lib/content.js';

const LIST_COLUMNS = `id, slug, title, subtitle, excerpt, excerpt_custom, cover_image, cover_alt, category, tags, status,
  featured, author_name, reading_minutes, published_at, deleted_at, created_at, updated_at`;

const PUBLIC_WHERE = `status = 'published' AND deleted_at IS NULL AND published_at <= ?`;

function serialize(row, { withContent = false } = {}) {
  if (!row) return null;
  const post = { ...row, tags: safeJson(row.tags, []), featured: Boolean(row.featured), excerpt_custom: Boolean(row.excerpt_custom) };
  if (withContent) post.content = safeJson(row.content, { type: 'doc', content: [] });
  else delete post.content;
  delete post.plain_text;
  post.state = stateOf(post);
  return post;
}

function stateOf(p) {
  if (p.deleted_at) return 'trash';
  if (p.status === 'draft') return 'draft';
  return p.published_at && p.published_at > nowIso() ? 'scheduled' : 'published';
}

function safeJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function uniqueSlug(base, ignoreId = 0) {
  const db = getDb();
  const exists = db.prepare('SELECT 1 FROM posts WHERE slug = ? AND id != ?');
  let slug = base;
  let n = 2;
  while (exists.get(slug, ignoreId)) slug = `${base}-${n++}`;
  return slug;
}

function clamp(n, min, max, dflt) {
  const v = Number.parseInt(n, 10);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : dflt;
}

function cleanTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  return tags
    .map((t) => String(t).trim().replace(/\s+/g, ' ').slice(0, 40))
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .slice(0, 12);
}

function parseDate(v) {
  if (v === null) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw badRequest('Publish date is not a valid date.');
  return d.toISOString();
}

/** Apply a partial update payload to a post row (mutates `fields`). */
function buildFields(body, existing) {
  const f = {};
  const str = (k, max) => {
    if (body[k] !== undefined) f[k] = String(body[k] ?? '').slice(0, max);
  };
  str('title', 200);
  str('subtitle', 300);
  str('cover_alt', 300);
  str('author_name', 120);
  if (body.category !== undefined) f.category = String(body.category || 'News').trim().slice(0, 40) || 'News';
  if (body.cover_image !== undefined) {
    const v = body.cover_image;
    if (v && !/^(https?:\/\/|\/uploads\/)/.test(v)) throw badRequest('Cover image must be an uploaded image or a web address.');
    f.cover_image = v || null;
  }
  if (body.tags !== undefined) f.tags = JSON.stringify(cleanTags(body.tags));
  if (body.featured !== undefined) f.featured = body.featured ? 1 : 0;

  let doc;
  if (body.content !== undefined) {
    doc = sanitizeDoc(body.content);
    const text = docToText(doc);
    f.content = JSON.stringify(doc);
    f.plain_text = text;
    f.reading_minutes = readingMinutes(text, countImages(doc));
  }

  // Excerpt: a hand-written summary wins; an empty one means "derive it from the story".
  if (body.excerpt !== undefined && String(body.excerpt).trim()) {
    f.excerpt = String(body.excerpt).trim().slice(0, 400);
    f.excerpt_custom = 1;
  } else if (body.excerpt !== undefined || (f.plain_text !== undefined && !existing?.excerpt_custom)) {
    f.excerpt = makeExcerpt(f.plain_text ?? existing?.plain_text ?? '');
    f.excerpt_custom = 0;
  }

  if (body.status !== undefined) {
    if (!['draft', 'published'].includes(body.status)) throw badRequest('Status must be draft or published.');
    f.status = body.status;
    if (body.status === 'published') {
      f.published_at = body.published_at ? parseDate(body.published_at) : existing?.published_at || nowIso();
    } else if (body.published_at === null) {
      f.published_at = null;
    }
  } else if (body.published_at !== undefined) {
    f.published_at = body.published_at ? parseDate(body.published_at) : null;
  }

  if (body.slug !== undefined && body.slug !== null && String(body.slug).trim()) {
    f.slug = uniqueSlug(slugify(body.slug), existing?.id ?? 0);
  } else if (f.title !== undefined && existing && existing.status === 'draft' && !existing.published_at && existing.slug_auto) {
    // Keep the address in step with the title until the post is first published.
    f.slug = uniqueSlug(slugify(f.title), existing.id);
  }
  return f;
}

function snapshot(db, postId, reason) {
  const row = db.prepare('SELECT title, content FROM posts WHERE id = ?').get(postId);
  if (!row) return;
  db.prepare('INSERT INTO revisions (post_id, title, content, reason) VALUES (?, ?, ?, ?)').run(postId, row.title, row.content, reason);
  db.prepare(
    `DELETE FROM revisions WHERE post_id = ? AND id NOT IN
     (SELECT id FROM revisions WHERE post_id = ? ORDER BY created_at DESC, id DESC LIMIT 30)`,
  ).run(postId, postId);
}

export function registerPostRoutes(router) {
  // ---------------- Public ----------------
  router.get('/api/posts', ({ res, query }) => {
    const db = getDb();
    const limit = clamp(query.get('limit'), 1, 50, 12);
    const page = clamp(query.get('page'), 1, 10000, 1);
    const where = [PUBLIC_WHERE];
    const args = [nowIso()];
    const category = query.get('category');
    const tag = query.get('tag');
    const q = query.get('q');
    if (category) {
      where.push('category = ? COLLATE NOCASE');
      args.push(category);
    }
    if (tag) {
      where.push(`EXISTS (SELECT 1 FROM json_each(posts.tags) WHERE lower(value) = lower(?))`);
      args.push(tag);
    }
    if (q) {
      where.push(`(title LIKE ? OR subtitle LIKE ? OR plain_text LIKE ?)`);
      const like = `%${q.replace(/[%_]/g, '')}%`;
      args.push(like, like, like);
    }
    if (query.get('featured') === 'true') where.push('featured = 1');
    const exclude = query.get('exclude');
    if (exclude) {
      where.push('slug != ?');
      args.push(exclude);
    }
    const whereSql = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) AS n FROM posts WHERE ${whereSql}`).get(...args).n;
    const rows = db
      .prepare(`SELECT ${LIST_COLUMNS} FROM posts WHERE ${whereSql} ORDER BY featured DESC, published_at DESC LIMIT ? OFFSET ?`)
      .all(...args, limit, (page - 1) * limit);
    // `featured DESC` only matters for the very first slot; keep chronological otherwise.
    const ordered = query.get('order') === 'latest' || page > 1 ? rows.sort((a, b) => (a.published_at < b.published_at ? 1 : -1)) : rows;
    send(res, 200, {
      posts: ordered.map((r) => serialize(r)),
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  });

  router.get('/api/posts/:slug', ({ res, params }) => {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM posts WHERE slug = ? AND ${PUBLIC_WHERE}`).get(params.slug, nowIso());
    if (!row) throw notFound('This story could not be found.');
    const post = serialize(row, { withContent: true });
    const related = db
      .prepare(
        `SELECT ${LIST_COLUMNS} FROM posts WHERE ${PUBLIC_WHERE} AND id != ?
         ORDER BY (category = ?) DESC, published_at DESC LIMIT 3`,
      )
      .all(nowIso(), row.id, row.category)
      .map((r) => serialize(r));
    send(res, 200, { post, related });
  });

  router.get('/api/categories', ({ res }) => {
    const rows = getDb()
      .prepare(`SELECT category AS name, COUNT(*) AS count FROM posts WHERE ${PUBLIC_WHERE} GROUP BY category ORDER BY count DESC, name`)
      .all(nowIso());
    send(res, 200, { categories: rows.map((r) => ({ ...r })) });
  });

  router.get('/api/sitemap', ({ res }) => {
    const rows = getDb().prepare(`SELECT slug, updated_at FROM posts WHERE ${PUBLIC_WHERE} ORDER BY published_at DESC`).all(nowIso());
    send(res, 200, { posts: rows.map((r) => ({ ...r })) });
  });

  // ---------------- Admin ----------------
  router.get('/api/admin/posts', (ctx) => {
    requireUser(ctx);
    const { res, query } = ctx;
    const state = query.get('state') || 'all';
    const q = query.get('q');
    const where = [];
    const args = [];
    const now = nowIso();
    if (state === 'trash') where.push('deleted_at IS NOT NULL');
    else {
      where.push('deleted_at IS NULL');
      if (state === 'draft') where.push(`status = 'draft'`);
      if (state === 'published') {
        where.push(`status = 'published' AND published_at <= ?`);
        args.push(now);
      }
      if (state === 'scheduled') {
        where.push(`status = 'published' AND published_at > ?`);
        args.push(now);
      }
    }
    if (q) {
      where.push('(title LIKE ? OR plain_text LIKE ?)');
      args.push(`%${q}%`, `%${q}%`);
    }
    const rows = getDb()
      .prepare(`SELECT ${LIST_COLUMNS} FROM posts WHERE ${where.join(' AND ')} ORDER BY COALESCE(deleted_at, updated_at) DESC LIMIT 500`)
      .all(...args);
    send(res, 200, { posts: rows.map((r) => serialize(r)) });
  });

  router.get('/api/admin/stats', (ctx) => {
    requireUser(ctx);
    const now = nowIso();
    const row = getDb()
      .prepare(
        `SELECT
          SUM(deleted_at IS NULL) AS all_posts,
          SUM(deleted_at IS NULL AND status = 'draft') AS draft,
          SUM(deleted_at IS NULL AND status = 'published' AND published_at <= ?) AS published,
          SUM(deleted_at IS NULL AND status = 'published' AND published_at > ?) AS scheduled,
          SUM(deleted_at IS NOT NULL) AS trash
        FROM posts`,
      )
      .get(now, now);
    const out = {};
    for (const [k, v] of Object.entries(row)) out[k] = v ?? 0;
    send(ctx.res, 200, out);
  });

  router.get('/api/admin/posts/:id', (ctx) => {
    requireUser(ctx);
    const row = getDb().prepare('SELECT * FROM posts WHERE id = ?').get(Number(ctx.params.id));
    if (!row) throw notFound('This post no longer exists.');
    send(ctx.res, 200, { post: serialize(row, { withContent: true }) });
  });

  router.post('/api/admin/posts', async (ctx) => {
    requireUser(ctx);
    const body = await readJson(ctx.req);
    const db = getDb();
    const id = tx(() => {
      const title = String(body.title ?? '').slice(0, 200);
      const slug = uniqueSlug(slugify(body.slug || title || `draft-${Date.now().toString(36)}`));
      const { lastInsertRowid } = db
        .prepare('INSERT INTO posts (slug, title, author_name, created_by) VALUES (?, ?, ?, ?)')
        .run(slug, title, ctx.user.name, ctx.user.id);
      const newId = Number(lastInsertRowid);
      const fields = buildFields({ ...body, slug: undefined, title: undefined }, { id: newId, status: 'draft', slug_auto: true });
      if (body.content === undefined) Object.assign(fields, buildFields({ content: { type: 'doc', content: [] } }, { id: newId }));
      applyUpdate(db, newId, fields);
      if (fields.status === 'published') snapshot(db, newId, 'publish');
      return newId;
    });
    const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
    send(ctx.res, 201, { post: serialize(row, { withContent: true }) });
  });

  router.patch('/api/admin/posts/:id', async (ctx) => {
    requireUser(ctx);
    const body = await readJson(ctx.req);
    const db = getDb();
    const id = Number(ctx.params.id);
    const existing = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
    if (!existing) throw notFound('This post no longer exists.');
    if (body.expected_updated_at && body.expected_updated_at !== existing.updated_at && !body.force) {
      return send(ctx.res, 409, {
        error: 'This post was changed somewhere else since you opened it.',
        post: serialize(existing, { withContent: true }),
      });
    }
    const slugAuto = existing.slug === uniqueSlugLike(existing);
    const fields = buildFields(body, { ...existing, slug_auto: slugAuto });
    const out = tx(() => {
      const last = db.prepare('SELECT created_at FROM revisions WHERE post_id = ? ORDER BY created_at DESC LIMIT 1').get(id);
      const stale = !last || Date.now() - Date.parse(last.created_at) > 15 * 60 * 1000;
      const publishing = fields.status === 'published' && existing.status !== 'published';
      if (fields.content !== undefined && fields.content !== existing.content && (stale || body.revision)) {
        snapshot(db, id, body.revision ? 'manual' : 'autosave');
      }
      applyUpdate(db, id, fields);
      if (publishing) snapshot(db, id, 'publish');
      return db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
    });
    send(ctx.res, 200, { post: serialize(out, { withContent: true }) });
  });

  router.post('/api/admin/posts/:id/duplicate', (ctx) => {
    requireUser(ctx);
    const db = getDb();
    const src = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(ctx.params.id));
    if (!src) throw notFound('This post no longer exists.');
    const title = `${src.title || 'Untitled'} (copy)`;
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO posts (slug, title, subtitle, excerpt, content, plain_text, cover_image, cover_alt, category, tags,
          author_name, reading_minutes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        uniqueSlug(slugify(title)), title, src.subtitle, src.excerpt, src.content, src.plain_text, src.cover_image,
        src.cover_alt, src.category, src.tags, src.author_name, src.reading_minutes, ctx.user.id,
      );
    const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(lastInsertRowid));
    send(ctx.res, 201, { post: serialize(row, { withContent: true }) });
  });

  router.post('/api/admin/posts/:id/trash', (ctx) => {
    requireUser(ctx);
    const r = getDb().prepare('UPDATE posts SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(nowIso(), Number(ctx.params.id));
    if (!r.changes) throw notFound('This post is already in the trash or no longer exists.');
    send(ctx.res, 200, { ok: true });
  });

  router.post('/api/admin/posts/:id/restore', (ctx) => {
    requireUser(ctx);
    const r = getDb().prepare('UPDATE posts SET deleted_at = NULL WHERE id = ?').run(Number(ctx.params.id));
    if (!r.changes) throw notFound('This post no longer exists.');
    send(ctx.res, 200, { ok: true });
  });

  router.delete('/api/admin/posts/:id', (ctx) => {
    requireUser(ctx);
    const r = getDb().prepare('DELETE FROM posts WHERE id = ?').run(Number(ctx.params.id));
    if (!r.changes) throw notFound('This post no longer exists.');
    send(ctx.res, 200, { ok: true });
  });

  router.post('/api/admin/trash/empty', (ctx) => {
    requireUser(ctx);
    const r = getDb().prepare('DELETE FROM posts WHERE deleted_at IS NOT NULL').run();
    send(ctx.res, 200, { deleted: Number(r.changes) });
  });

  router.get('/api/admin/posts/:id/revisions', (ctx) => {
    requireUser(ctx);
    const rows = getDb()
      .prepare('SELECT id, title, reason, created_at, length(content) AS size FROM revisions WHERE post_id = ? ORDER BY created_at DESC, id DESC')
      .all(Number(ctx.params.id));
    send(ctx.res, 200, { revisions: rows.map((r) => ({ ...r })) });
  });

  router.get('/api/admin/revisions/:id', (ctx) => {
    requireUser(ctx);
    const row = getDb().prepare('SELECT * FROM revisions WHERE id = ?').get(Number(ctx.params.id));
    if (!row) throw notFound('That version no longer exists.');
    send(ctx.res, 200, { revision: { ...row, content: safeJson(row.content, null) } });
  });
}

// A post's slug is "auto" when it equals the slug its title would produce (optionally with a -N suffix).
function uniqueSlugLike(post) {
  if (/^(draft-[a-z0-9]+|untitled(-\d+)?)$/.test(post.slug)) return post.slug;
  const base = slugify(post.title || '');
  return post.slug === base || new RegExp(`^${base}-\\d+$`).test(post.slug) ? post.slug : null;
}

function applyUpdate(db, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sql = `UPDATE posts SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`;
  db.prepare(sql).run(...keys.map((k) => fields[k]), nowIso(), id);
}
