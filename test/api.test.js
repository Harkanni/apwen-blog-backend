import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'apwen-test-'));
process.env.DATA_DIR = dir;
process.env.UPLOAD_DIR = join(dir, 'uploads');
process.env.ADMIN_EMAIL = 'admin@test.dev';
process.env.ADMIN_PASSWORD = 'password123';

const { createApp } = await import('../src/app.js');
const { ensureAdmin } = await import('../scripts/ensure-admin.js');

let server;
let base;
let cookie = '';

async function api(path, { method = 'GET', body, headers = {}, raw } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, res };
}

before(async () => {
  ensureAdmin();
  server = createApp();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('rejects admin routes without a session', async () => {
  const { status } = await api('/api/admin/posts');
  assert.equal(status, 401);
});

test('rejects a wrong password', async () => {
  const { status } = await api('/api/auth/login', { method: 'POST', body: { email: 'admin@test.dev', password: 'nope' } });
  assert.equal(status, 401);
});

test('signs in and returns the user', async () => {
  const { status, data, res } = await api('/api/auth/login', { method: 'POST', body: { email: 'admin@test.dev', password: 'password123' } });
  assert.equal(status, 200);
  assert.equal(data.user.role, 'admin');
  cookie = res.headers.get('set-cookie').split(';')[0];
  const me = await api('/api/auth/me');
  assert.equal(me.data.user.email, 'admin@test.dev');
});

let postId;

test('creates a draft that stays private', async () => {
  const { status, data } = await api('/api/admin/posts', { method: 'POST', body: {} });
  assert.equal(status, 201);
  postId = data.post.id;
  assert.equal(data.post.state, 'draft');
  const pub = await api('/api/posts');
  assert.equal(pub.data.total, 0);
});

test('autosaves content, strips unsafe nodes and derives metadata', async () => {
  const content = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Hello engineers', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] },
      { type: 'script', content: [{ type: 'text', text: 'bad' }] },
      { type: 'image', attrs: { src: 'javascript:alert(1)' } },
      { type: 'image', attrs: { src: '/uploads/x.png', alt: 'ok', layout: 'huge' } },
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Section' }] },
    ],
  };
  const { status, data } = await api(`/api/admin/posts/${postId}`, { method: 'PATCH', body: { title: 'Women in Engineering Day', content } });
  assert.equal(status, 200);
  const nodes = data.post.content.content;
  assert.equal(nodes.length, 3);
  assert.equal(nodes[0].content[0].marks, undefined, 'unsafe link mark removed');
  assert.equal(nodes[1].attrs.layout, 'normal');
  assert.equal(nodes[2].attrs.level, 2, 'h1 clamped to h2');
  assert.equal(data.post.slug, 'women-in-engineering-day', 'slug follows the title while a draft');
  assert.match(data.post.excerpt, /Hello engineers/);
});

test('publishes and appears publicly with content', async () => {
  const { data } = await api(`/api/admin/posts/${postId}`, { method: 'PATCH', body: { status: 'published', category: 'Events', tags: ['INWED', 'inwed', ' Lagos '] } });
  assert.equal(data.post.state, 'published');
  assert.deepEqual(data.post.tags, ['INWED', 'Lagos']);
  const list = await api('/api/posts?category=events');
  assert.equal(list.data.total, 1);
  const one = await api('/api/posts/women-in-engineering-day');
  assert.equal(one.status, 200);
  assert.equal(one.data.post.content.type, 'doc');
  const byTag = await api('/api/posts?tag=lagos');
  assert.equal(byTag.data.total, 1);
});

test('keeps the slug stable after publishing', async () => {
  const { data } = await api(`/api/admin/posts/${postId}`, { method: 'PATCH', body: { title: 'Renamed later' } });
  assert.equal(data.post.slug, 'women-in-engineering-day');
});

test('scheduled posts are hidden until their time', async () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  const { data } = await api('/api/admin/posts', { method: 'POST', body: { title: 'Future', status: 'published', published_at: future } });
  assert.equal(data.post.state, 'scheduled');
  const pub = await api('/api/posts/future');
  assert.equal(pub.status, 404);
});

test('detects edit conflicts', async () => {
  const { status } = await api(`/api/admin/posts/${postId}`, { method: 'PATCH', body: { title: 'x', expected_updated_at: '2000-01-01T00:00:00.000Z' } });
  assert.equal(status, 409);
});

test('uploads an image and reads its size', async () => {
  // 1x1 PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const { status, data } = await api('/api/admin/media', { method: 'POST', raw: png, headers: { 'Content-Type': 'image/png', 'X-File-Name': 'dot.png' } });
  assert.equal(status, 201);
  assert.equal(data.media.width, 1);
  const file = await fetch(base + data.media.url);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'image/png');
});

test('rejects files that are not images', async () => {
  const { status } = await api('/api/admin/media', { method: 'POST', raw: Buffer.from('<svg onload=alert(1)>hello world</svg>'), headers: { 'Content-Type': 'image/svg+xml' } });
  assert.equal(status, 415);
});

test('moves to trash, restores and deletes for good', async () => {
  await api(`/api/admin/posts/${postId}/trash`, { method: 'POST' });
  assert.equal((await api('/api/posts/women-in-engineering-day')).status, 404);
  const trash = await api('/api/admin/posts?state=trash');
  assert.equal(trash.data.posts.length, 1);
  await api(`/api/admin/posts/${postId}/restore`, { method: 'POST' });
  assert.equal((await api('/api/posts/women-in-engineering-day')).status, 200);
  await api(`/api/admin/posts/${postId}`, { method: 'DELETE' });
  assert.equal((await api(`/api/admin/posts/${postId}`)).status, 404);
});

test('saves site settings and validates links', async () => {
  const bad = await api('/api/admin/settings', { method: 'PATCH', body: { instagram: 'instagram.com/x' } });
  assert.equal(bad.status, 400);
  const ok = await api('/api/admin/settings', { method: 'PATCH', body: { instagram: 'https://instagram.com/apwen' } });
  assert.equal(ok.data.settings.instagram, 'https://instagram.com/apwen');
});

test('derives the summary unless one is written by hand, and unpublish clears the date', async () => {
  const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First words of the story.' }] }] };
  const { data: created } = await api('/api/admin/posts', { method: 'POST', body: { title: 'Summary test', content } });
  assert.equal(created.post.excerpt, 'First words of the story.');
  assert.equal(created.post.excerpt_custom, false);
  const { data: custom } = await api(`/api/admin/posts/${created.post.id}`, { method: 'PATCH', body: { excerpt: 'Hand written.' } });
  assert.equal(custom.post.excerpt_custom, true);
  const content2 = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Changed text.' }] }] };
  const { data: kept } = await api(`/api/admin/posts/${created.post.id}`, { method: 'PATCH', body: { content: content2 } });
  assert.equal(kept.post.excerpt, 'Hand written.');
  const { data: cleared } = await api(`/api/admin/posts/${created.post.id}`, { method: 'PATCH', body: { excerpt: '' } });
  assert.equal(cleared.post.excerpt, 'Changed text.');
  await api(`/api/admin/posts/${created.post.id}`, { method: 'PATCH', body: { status: 'published' } });
  const { data: un } = await api(`/api/admin/posts/${created.post.id}`, { method: 'PATCH', body: { status: 'draft', published_at: null } });
  assert.equal(un.post.published_at, null);
  assert.equal(un.post.state, 'draft');
});
