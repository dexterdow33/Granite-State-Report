const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  town TEXT NOT NULL,
  county TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member',          -- member | admin
  status TEXT NOT NULL DEFAULT 'unverified',    -- unverified | pending | verified | rejected | suspended
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  verified_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

-- files holds the private paths of uploaded ID images while a review is open.
-- They are deleted from disk and cleared here as soon as a reviewer decides.
CREATE TABLE IF NOT EXISTS verifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  files TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',       -- pending | approved | rejected
  note TEXT NOT NULL DEFAULT '',
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  reviewer_id INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  county TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  price_cents INTEGER,
  link TEXT,
  removed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS posts_section ON posts(section, created_at);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  removed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function openDb(config) {
  fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
  fs.mkdirSync(config.privateUploadDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(config.dbFile);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// Columns added after v0.1. SQLite has no ADD COLUMN IF NOT EXISTS, so check first.
function migrate(db) {
  const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  if (!has('posts', 'source_url')) db.exec('ALTER TABLE posts ADD COLUMN source_url TEXT');
  if (!has('posts', 'edited_at')) db.exec('ALTER TABLE posts ADD COLUMN edited_at TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS posts_source_url ON posts(source_url) WHERE source_url IS NOT NULL');
}

module.exports = { openDb };
