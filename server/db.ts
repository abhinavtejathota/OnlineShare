import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

/** On Render, mount a persistent disk and set DATA_DIR (e.g. /var/data). */
const dataDir = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
const dbPath = path.join(dataDir, "onlineshare.db");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

/**
 * Built-in Node SQLite (no native addon). Works on Node 22+ and 24+ without rebuilds.
 * Uses the same on-disk .db file as before.
 */
export const db = new DatabaseSync(dbPath);

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS shares (
    id TEXT PRIMARY KEY,
    owner_token_hash TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT 'plaintext',
    title TEXT NOT NULL DEFAULT 'Untitled',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_accessed_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_shares_updated ON shares(updated_at);
`);

export type ShareRow = {
  id: string;
  owner_token_hash: string;
  content: string;
  language: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_accessed_at: string;
};

export function getDbPath(): string {
  return dbPath;
}
