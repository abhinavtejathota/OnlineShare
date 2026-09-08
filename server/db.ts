import pg from "pg";

const { Pool } = pg;

function buildDatabaseUrl(): string {
  if (process.env.DATABASE_URL?.trim()) {
    return process.env.DATABASE_URL.trim();
  }

  const host = process.env.PGHOST;
  const port = process.env.PGPORT || "5432";
  const database = process.env.PGDATABASE || "postgres";
  const user = process.env.PGUSER;
  const password = process.env.PGPASSWORD;

  if (host && user && password) {
    const encUser = encodeURIComponent(user);
    const encPass = encodeURIComponent(password);
    return `postgresql://${encUser}:${encPass}@${host}:${port}/${database}`;
  }

  throw new Error(
    "DATABASE_URL is required (Supabase Postgres). Set it in .env or your host env vars.",
  );
}

/** Strip sslmode from URL — we set SSL explicitly on the Pool for Supabase. */
function connectionStringWithoutSslMode(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete("sslmode");
    u.searchParams.delete("uselibpqcompat");
    return u.toString();
  } catch {
    return url;
  }
}

export const pool = new Pool({
  connectionString: connectionStringWithoutSslMode(buildDatabaseUrl()),
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30_000,
});

export type ShareRow = {
  id: string;
  owner_token_hash: string;
  content: string;
  language: string;
  title: string;
  created_at: string | Date;
  updated_at: string | Date;
  last_accessed_at: string | Date;
};

export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shares (
      id TEXT PRIMARY KEY,
      owner_token_hash TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT 'plaintext',
      title TEXT NOT NULL DEFAULT 'Untitled',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_shares_updated ON shares (updated_at);
  `);
}

export function getDbLabel(): string {
  try {
    const raw = buildDatabaseUrl().replace(/^postgresql:/i, "http:");
    const url = new URL(raw);
    return `postgres://${url.hostname}:${url.port || "5432"}${url.pathname}`;
  } catch {
    return "postgres (configured)";
  }
}
