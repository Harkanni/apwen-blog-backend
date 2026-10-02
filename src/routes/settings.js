import { getDb } from '../db.js';
import { readJson, send, badRequest } from '../lib/http.js';
import { requireUser } from '../lib/auth.js';

export const DEFAULT_SETTINGS = {
  siteName: 'APWEN Blog',
  tagline: 'Stories, ideas and milestones from women engineering Nigeria’s future.',
  about:
    'The Association of Professional Women Engineers of Nigeria (APWEN) is a division of the Nigerian Society of Engineers. We support women in engineering and inspire girls to take up careers in science, technology, engineering and mathematics.',
  instagram: 'https://www.instagram.com/apwen_national/',
  facebook: 'https://www.facebook.com/apwennational/',
  website: 'https://apwen.org.ng',
  contactEmail: 'info@apwen.org.ng',
  categories: ['News', 'Member stories', 'STEM outreach', 'Events', 'Engineering insight', 'Opinion'],
};

const URL_KEYS = ['instagram', 'facebook', 'website'];

export function getSettings() {
  const rows = getDb().prepare('SELECT key, value FROM settings').all();
  const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
  return { ...DEFAULT_SETTINGS, ...stored };
}

export function registerSettingsRoutes(router) {
  router.get('/api/settings', ({ res }) => send(res, 200, { settings: getSettings() }, { 'Cache-Control': 'public, max-age=60' }));

  router.patch('/api/admin/settings', async (ctx) => {
    requireUser(ctx);
    const body = await readJson(ctx.req);
    const db = getDb();
    const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (body[key] === undefined) continue;
      let value = body[key];
      if (key === 'categories') {
        if (!Array.isArray(value)) throw badRequest('Categories must be a list.');
        value = [...new Set(value.map((c) => String(c).trim().slice(0, 40)).filter(Boolean))].slice(0, 20);
      } else {
        value = String(value).trim().slice(0, 1000);
        if (URL_KEYS.includes(key) && value && !/^https?:\/\//.test(value)) throw badRequest(`The ${key} link must start with https://`);
      }
      upsert.run(key, JSON.stringify(value));
    }
    send(ctx.res, 200, { settings: getSettings() });
  });
}
