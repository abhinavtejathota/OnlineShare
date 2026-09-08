import { z } from "zod";
import { pool, type ShareRow } from "./db.js";
import {
  generateOwnerToken,
  generateShareId,
  hashOwnerToken,
  verifyOwnerToken,
} from "./security.js";

const MAX_CONTENT_BYTES = 2 * 1024 * 1024; // 2 MB

export const updateShareSchema = z.object({
  content: z.string().max(MAX_CONTENT_BYTES).optional(),
  language: z.string().max(64).optional(),
  title: z.string().max(120).optional(),
});

function nowIso(): string {
  return new Date().toISOString();
}

export type PublicShare = {
  id: string;
  content: string;
  language: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toPublic(row: ShareRow): PublicShare {
  return {
    id: row.id,
    content: row.content,
    language: row.language,
    title: row.title,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function createShare(): Promise<{
  share: PublicShare;
  ownerToken: string;
}> {
  const id = generateShareId();
  const ownerToken = generateOwnerToken();
  const ts = nowIso();

  await pool.query(
    `INSERT INTO shares
      (id, owner_token_hash, content, language, title, created_at, updated_at, last_accessed_at)
     VALUES ($1, $2, '', 'plaintext', 'Untitled', $3, $4, $5)`,
    [id, hashOwnerToken(ownerToken), ts, ts, ts],
  );

  const { rows } = await pool.query<ShareRow>("SELECT * FROM shares WHERE id = $1", [id]);
  return { share: toPublic(rows[0]), ownerToken };
}

export async function getShare(id: string): Promise<PublicShare | null> {
  const { rows } = await pool.query<ShareRow>("SELECT * FROM shares WHERE id = $1", [id]);
  const row = rows[0];
  if (!row) return null;

  await pool.query("UPDATE shares SET last_accessed_at = $1 WHERE id = $2", [
    nowIso(),
    id,
  ]);
  return toPublic(row);
}

export async function updateShare(
  id: string,
  patch: z.infer<typeof updateShareSchema>,
): Promise<PublicShare | null> {
  const { rows } = await pool.query<ShareRow>("SELECT * FROM shares WHERE id = $1", [id]);
  const row = rows[0];
  if (!row) return null;

  const content = patch.content ?? row.content;
  const language = patch.language ?? row.language;
  const title = patch.title ?? row.title;
  const ts = nowIso();

  if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) {
    throw new Error("CONTENT_TOO_LARGE");
  }

  await pool.query(
    `UPDATE shares
     SET content = $1, language = $2, title = $3, updated_at = $4, last_accessed_at = $5
     WHERE id = $6`,
    [content, language, title, ts, ts, id],
  );

  const updated = await pool.query<ShareRow>("SELECT * FROM shares WHERE id = $1", [id]);
  return toPublic(updated.rows[0]);
}

export async function deleteShare(id: string, ownerToken: string): Promise<boolean> {
  const { rows } = await pool.query<ShareRow>("SELECT * FROM shares WHERE id = $1", [id]);
  const row = rows[0];
  if (!row) return false;
  if (!verifyOwnerToken(ownerToken, row.owner_token_hash)) return false;

  await pool.query("DELETE FROM shares WHERE id = $1", [id]);
  return true;
}

export async function isOwner(id: string, ownerToken: string): Promise<boolean> {
  const { rows } = await pool.query<{ owner_token_hash: string }>(
    "SELECT owner_token_hash FROM shares WHERE id = $1",
    [id],
  );
  const row = rows[0];
  if (!row) return false;
  return verifyOwnerToken(ownerToken, row.owner_token_hash);
}
