# CLAUDE.md: APWEN Blog backend

Handoff notes for any AI assistant or developer. The frontend lives in `apwen-blog-frontend`; its `DESIGN.md` is the design system.

## What this is

A JSON API for the APWEN blog with **zero runtime dependencies**: Node's built-in `http` server, built-in `node:sqlite`, and `node:crypto` for scrypt password hashing and HS256 session tokens. Requires Node 22.13+ (Node 24 recommended for production, where `node:sqlite` is no longer flagged experimental).

## Run it

```bash
cp .env.example .env
npm run seed        # creates the first admin + 5 sample stories with images
npm run dev         # http://localhost:4000 (restarts on change)
npm test            # 13 integration tests against a temp database
```

Default admin comes from `ADMIN_EMAIL` / `ADMIN_PASSWORD` and is created automatically when the database has no users.

## Map

```
src/server.js          entry: ensure admin, listen
src/app.js             request pipeline: security headers, CORS, /uploads static, router, errors
src/config.js          env + tiny .env loader
src/db.js              SQLite connection + append-only migrations (PRAGMA user_version)
src/lib/router.js      method + path router with :params
src/lib/http.js        send/readJson/readRaw, cookies, HttpError
src/lib/auth.js        scrypt, JWT sign/verify, requireUser/requireAdmin, login rate limit
src/lib/content.js     Tiptap JSON allowlist sanitiser, text extraction, reading time, slugs
src/lib/image.js       image type sniffing + dimensions (JPEG/PNG/GIF/WebP/AVIF)
src/routes/*.js        auth, posts, media, settings
scripts/seed.js        sample content; scripts/seed-assets/ holds the sample images
scripts/create-admin.js
test/api.test.js       node:test integration suite
```

## Data model

- `posts`: `status` is `draft` or `published`. "Scheduled" = published with `published_at` in the future. "Trash" = `deleted_at` set (soft delete). Content is Tiptap JSON in `content`; `plain_text`, `excerpt` and `reading_minutes` are derived on save.
- `revisions`: snapshots on publish, on manual save, and on autosave at most every 15 minutes. Last 30 kept per post.
- `media`: uploaded images (files in `UPLOAD_DIR`, served at `/uploads/<file>` with immutable caching).
- `settings`: key/value JSON (social links, tagline, about, topics). Defaults in `routes/settings.js`.
- `users`: `admin` or `editor`.

To change the schema, **append** a new SQL string to `migrations` in `src/db.js`. Never edit an old one.

## API

Public: `GET /api/posts?page&limit&category&tag&q&featured&exclude&order=latest`, `GET /api/posts/:slug` (+ related), `GET /api/categories`, `GET /api/settings`, `GET /api/sitemap`, `GET /api/health`.

Auth: `POST /api/auth/login`, `POST /api/auth/logout`, `GET|PATCH /api/auth/me`. Session is an httpOnly `apwen_session` cookie (Bearer token also accepted).

Studio (signed in): `GET /api/admin/posts?state=all|draft|published|scheduled|trash&q`, `GET /api/admin/stats`, `GET|PATCH /api/admin/posts/:id` (PATCH accepts `expected_updated_at` → 409 on conflict, `force`, `revision`), `POST /api/admin/posts`, `POST /api/admin/posts/:id/{duplicate,trash,restore}`, `DELETE /api/admin/posts/:id`, `POST /api/admin/trash/empty`, `GET /api/admin/posts/:id/revisions`, `GET /api/admin/revisions/:id`, `GET|POST /api/admin/media` (POST body = raw image bytes, `X-File-Name` header), `PATCH|DELETE /api/admin/media/:id`, `PATCH /api/admin/settings`. Admin only: `GET|POST /api/admin/users`, `DELETE /api/admin/users/:id`.

Errors are `{ "error": "Plain-language message" }` with a fitting status code; the studio shows `error` directly to editors, so keep messages human.

## Rich content contract

If the frontend adds a node or mark to the editor, add it to `NODE_ATTRS` / `MARK_ATTRS` in `src/lib/content.js` (with any URL/colour validation) and add a test. Unknown types are silently dropped.

## Deploy

Needs a persistent disk for `DATA_DIR` (SQLite) and `UPLOAD_DIR` (images). Render/Railway/Fly with a volume, or any VPS. Set `NODE_ENV=production`, a 32+ char `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`. Put it behind HTTPS. The frontend proxies `/api` and `/uploads`, so `CORS_ORIGINS` can stay empty.

## Status / next steps

- [x] All routes implemented and covered by integration tests (passing).
- [ ] Optional: resize/convert uploads to WebP (would need `sharp`), S3/Cloudinary storage adapter, password reset by email, audit log.
