import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function openDatabase(path) {
  if (!path) {
    mkdirSync(new URL('./data/', import.meta.url), { recursive: true })
    path = fileURLToPath(new URL('./data/neera.sqlite', import.meta.url))
  }
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;')
  // Additive migration: preserve the health-check database and any existing data.
  db.exec(`
    BEGIN;
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS schools (
      id TEXT PRIMARY KEY, name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id),
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'teacher'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);
    COMMIT;
  `)
  db.exec(`
    BEGIN;
    CREATE TABLE IF NOT EXISTS school_classes (
      id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id),
      name TEXT NOT NULL, students_json TEXT NOT NULL, roster_version INTEGER NOT NULL DEFAULT 1,
      UNIQUE(school_id,name)
    );
    CREATE TABLE IF NOT EXISTS class_teachers (
      class_id TEXT NOT NULL REFERENCES school_classes(id), user_id TEXT NOT NULL REFERENCES users(id),
      PRIMARY KEY(class_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS school_registers (
      class_id TEXT NOT NULL REFERENCES school_classes(id), date TEXT NOT NULL,
      version INTEGER NOT NULL, record_json TEXT NOT NULL, updated_by TEXT NOT NULL REFERENCES users(id),
      PRIMARY KEY(class_id,date)
    );
    CREATE TABLE IF NOT EXISTS register_mutations (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      class_id TEXT NOT NULL REFERENCES school_classes(id), date TEXT NOT NULL,
      payload_hash TEXT NOT NULL, response_json TEXT NOT NULL
    );
    INSERT OR IGNORE INTO schema_migrations(version) VALUES (2);
    COMMIT;
  `)
  return db
}
