import { getDb } from '../src/db.js';
import { config } from '../src/config.js';
import { hashPassword } from '../src/lib/auth.js';

/** Create the first admin from ADMIN_EMAIL / ADMIN_PASSWORD if no users exist yet. */
export function ensureAdmin() {
  const db = getDb();
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (n > 0) return null;
  db.prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)').run(
    config.adminEmail,
    config.adminName,
    hashPassword(config.adminPassword),
    'admin',
  );
  console.log(`Created admin account ${config.adminEmail}. Change the password after first sign-in.`);
  return config.adminEmail;
}
