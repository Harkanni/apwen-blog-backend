import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

// Minimal .env loader (no dependency). Real environment variables win.
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    const [, key, raw] = m;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^["']|["']$/g, '');
  }
}

const env = process.env;
const isProd = env.NODE_ENV === 'production';

if (isProd && (!env.JWT_SECRET || env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be set to at least 32 characters in production.');
}

export const config = {
  isProd,
  port: Number(env.PORT || 4000),
  dataDir: resolve(env.DATA_DIR || './data'),
  uploadDir: resolve(env.UPLOAD_DIR || './uploads'),
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me-dev-only-secret',
  sessionDays: Number(env.SESSION_DAYS || 7),
  // Comma-separated list of browser origins allowed to call the API directly.
  // When the frontend proxies /api (the default setup) this can stay empty.
  corsOrigins: (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  // Public URL the API is reachable at; used to build absolute media URLs.
  publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
  maxUploadBytes: Number(env.MAX_UPLOAD_MB || 8) * 1024 * 1024,
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProd,
  adminEmail: env.ADMIN_EMAIL || 'admin@apwen.org.ng',
  adminPassword: env.ADMIN_PASSWORD || 'ChangeMe!2026',
  adminName: env.ADMIN_NAME || 'Content Team',
};
