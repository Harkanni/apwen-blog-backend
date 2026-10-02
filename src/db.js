import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

/**
 * Ordered schema migrations. Append new entries; never edit old ones.
 * The index (1-based) is stored in PRAGMA user_version.
 */
const migrations = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('admin','editor')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE posts (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT '',
    subtitle TEXT NOT NULL DEFAULT '',
    excerpt TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '{"type":"doc","content":[]}',
    plain_text TEXT NOT NULL DEFAULT '',
    cover_image TEXT,
    cover_alt TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'News',
    tags TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
    featured INTEGER NOT NULL DEFAULT 0,
    author_name TEXT NOT NULL DEFAULT 'APWEN',
    reading_minutes INTEGER NOT NULL DEFAULT 1,
    published_at TEXT,
    deleted_at TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX posts_public_idx ON posts (status, deleted_at, published_at DESC);
  CREATE INDEX posts_category_idx ON posts (category);

  CREATE TABLE revisions (
    id INTEGER PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT 'save',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX revisions_post_idx ON revisions (post_id, created_at DESC);

  CREATE TABLE media (
    id INTEGER PRIMARY KEY,
    filename TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL DEFAULT '',
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    alt TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // 2: remember whether the summary was written by hand (otherwise it is derived from the story)
  `ALTER TABLE posts ADD COLUMN excerpt_custom INTEGER NOT NULL DEFAULT 0;`,
];

let db;

export function getDb() {
  if (db) return db;
  mkdirSync(config.dataDir, { recursive: true });
  db = new DatabaseSync(process.env.DB_FILE || join(config.dataDir, 'apwen.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(database) {
  const { user_version: current } = database.prepare('PRAGMA user_version').get();
  for (let i = current; i < migrations.length; i++) {
    database.exec('BEGIN');
    try {
      database.exec(migrations[i]);
      database.exec(`PRAGMA user_version = ${i + 1}`);
      database.exec('COMMIT');
    } catch (err) {
      database.exec('ROLLBACK');
      throw err;
    }
  }
}

/** Run fn inside a transaction. */
export function tx(fn) {
  const d = getDb();
  d.exec('BEGIN');
  try {
    const out = fn(d);
    d.exec('COMMIT');
    return out;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}

export const nowIso = () => new Date().toISOString();
