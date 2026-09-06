import { z } from "zod";
import { db, type ShareRow } from "./db.js";
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

function toPublic(row: ShareRow): PublicShare {
  return {
    id: row.id,
    content: row.content,
    language: row.language,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createShare(): {
  share: PublicShare;
  ownerToken: string;
} {
  const id = generateShareId();
  const ownerToken = generateOwnerToken();
  const ts = nowIso();

  db.prepare(
    `INSERT INTO shares
      (id, owner_token_hash, content, language, title, created_at, updated_at, last_accessed_at)
     VALUES (?, ?, '', 'plaintext', 'Untitled', ?, ?, ?)`,
  ).run(id, hashOwnerToken(ownerToken), ts, ts, ts);

  const row = db.prepare("SELECT * FROM shares WHERE id = ?").get(id) as ShareRow;
  return { share: toPublic(row), ownerToken };
}

export function getShare(id: string): PublicShare | null {
  const row = db.prepare("SELECT * FROM shares WHERE id = ?").get(id) as
    | ShareRow
    | undefined;
  if (!row) return null;

  db.prepare("UPDATE shares SET last_accessed_at = ? WHERE id = ?").run(
    nowIso(),
    id,
  );
  return toPublic(row);
}

export function updateShare(
  id: string,
  patch: z.infer<typeof updateShareSchema>,
): PublicShare | null {
  const row = db.prepare("SELECT * FROM shares WHERE id = ?").get(id) as
    | ShareRow
    | undefined;
  if (!row) return null;

  const content = patch.content ?? row.content;
  const language = patch.language ?? row.language;
  const title = patch.title ?? row.title;
  const ts = nowIso();

  if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) {
    throw new Error("CONTENT_TOO_LARGE");
  }

  db.prepare(
    `UPDATE shares
     SET content = ?, language = ?, title = ?, updated_at = ?, last_accessed_at = ?
     WHERE id = ?`,
  ).run(content, language, title, ts, ts, id);

  const updated = db.prepare("SELECT * FROM shares WHERE id = ?").get(id) as ShareRow;
  return toPublic(updated);
}

export function deleteShare(id: string, ownerToken: string): boolean {
  const row = db.prepare("SELECT * FROM shares WHERE id = ?").get(id) as
    | ShareRow
    | undefined;
  if (!row) return false;
  if (!verifyOwnerToken(ownerToken, row.owner_token_hash)) return false;

  db.prepare("DELETE FROM shares WHERE id = ?").run(id);
  return true;
}

export function isOwner(id: string, ownerToken: string): boolean {
  const row = db.prepare("SELECT owner_token_hash FROM shares WHERE id = ?").get(
    id,
  ) as { owner_token_hash: string } | undefined;
  if (!row) return false;
  return verifyOwnerToken(ownerToken, row.owner_token_hash);
}
