import { env } from "cloudflare:workers";

export type SyncHeader = {
  revision: number;
  updated_at: string;
  updated_by: string;
};

export function database() {
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) throw new Error("Banco de dados indisponível");
  return db;
}

export function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export async function readSyncHeader(db = database()): Promise<SyncHeader | null> {
  const meta = await db
    .prepare("SELECT revision, updated_at, updated_by FROM sync_meta WHERE id = 1")
    .first<SyncHeader>();
  if (meta) return meta;

  return db
    .prepare("SELECT revision, updated_at, updated_by FROM shared_state WHERE id = 1")
    .first<SyncHeader>();
}

export async function allocateGlobalRevision(db: D1Database, updatedAt: string, updatedBy: string) {
  const row = await db
    .prepare(`
      INSERT INTO sync_meta (id, revision, updated_at, updated_by)
      VALUES (1, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        revision = sync_meta.revision + 1,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
      RETURNING revision
    `)
    .bind(updatedAt, updatedBy)
    .first<{ revision: number }>();

  if (!row) throw new Error("Não foi possível gerar a revisão compartilhada");
  return Number(row.revision);
}
