// Usage: npm run create-admin -- email@example.com "Full Name" "password" [admin|editor]
import { getDb } from '../src/db.js';
import { hashPassword } from '../src/lib/auth.js';

const [email, name, password, role = 'admin'] = process.argv.slice(2);
if (!email || !name || !password) {
  console.error('Usage: npm run create-admin -- email "Full Name" password [admin|editor]');
  process.exit(1);
}
const db = getDb();
const hash = hashPassword(password);
db.prepare(
  `INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)
   ON CONFLICT(email) DO UPDATE SET name = excluded.name, password_hash = excluded.password_hash, role = excluded.role`,
).run(email, name, hash, role === 'editor' ? 'editor' : 'admin');
console.log(`Saved ${role} account for ${email}.`);
