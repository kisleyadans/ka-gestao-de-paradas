import { getOperatorSession } from "../../../lib/operator-auth";
import { allocateGlobalRevision, database, noStoreJson } from "../../../lib/shared-database";

type ActivityRow = {
  id: string;
  payload: string;
  revision: number;
  position: number;
  deleted: number;
  updated_at: string;
  updated_by: string;
};

type ActivityChange = {
  id?: unknown;
  expectedRevision?: unknown;
  base?: unknown;
  next?: unknown;
  deleted?: unknown;
  position?: unknown;
};

type ActivityRecord = Record<string, unknown>;

function parseActivity(value: string) {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Atividade inválida");
  return parsed as ActivityRecord;
}

function normalizeId(value: unknown) {
  if (typeof value !== "string") throw new Error("Identificador da atividade inválido");
  const id = value.trim();
  if (!id || id.length > 160 || /[\u0000-\u001f\u007f]/.test(id)) {
    throw new Error("Identificador da atividade inválido");
  }
  return id;
}

function normalizeActivity(value: unknown, id: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Atividade inválida");
  const activity = { ...(value as ActivityRecord), id };
  const serialized = JSON.stringify(activity);
  if (serialized.length > 100_000) throw new Error("Uma atividade ultrapassou o limite permitido");
  return activity;
}

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function changedFields(base: ActivityRecord, next: ActivityRecord) {
  const keys = new Set([...Object.keys(base), ...Object.keys(next)]);
  keys.delete("id");
  return Array.from(keys).filter((key) => !same(base[key], next[key]));
}

function applyFields(current: ActivityRecord, next: ActivityRecord, fields: string[]) {
  const merged = { ...current };
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(next, field)) merged[field] = next[field];
    else delete merged[field];
  }
  return merged;
}

function conflictResult(row: ActivityRow | null, id: string, fields: string[]) {
  return {
    id,
    fields,
    revision: row?.revision ?? 0,
    deleted: !row || row.deleted === 1,
    activity: row && row.deleted !== 1 ? parseActivity(row.payload) : null,
    updatedAt: row?.updated_at ?? null,
    updatedBy: row?.updated_by ?? null,
  };
}

async function readRow(db: D1Database, id: string) {
  return db
    .prepare(`
      SELECT id, payload, revision, position, deleted, updated_at, updated_by
      FROM activity_state
      WHERE id = ?
    `)
    .bind(id)
    .first<ActivityRow>();
}

export async function POST(request: Request) {
  try {
    const session = await getOperatorSession(request);
    if (!session) return noStoreJson({ error: "Acesso de operador necessário" }, { status: 401 });

    const body = (await request.json()) as { changes?: unknown };
    if (!Array.isArray(body.changes) || body.changes.length === 0 || body.changes.length > 25) {
      return noStoreJson({ error: "Envie de 1 a 25 alterações por vez" }, { status: 400 });
    }

    const changes = body.changes as ActivityChange[];
    const db = database();
    const now = new Date().toISOString();
    const globalRevision = await allocateGlobalRevision(db, now, session.name);
    const accepted: Array<Record<string, unknown>> = [];
    const conflicts: Array<Record<string, unknown>> = [];

    for (const change of changes) {
      const id = normalizeId(change.id);
      const expectedRevision = Math.max(0, Number(change.expectedRevision ?? 0) || 0);
      const deleted = change.deleted === true;
      const position = Math.max(0, Math.trunc(Number(change.position ?? 0) || 0));
      const base = change.base && typeof change.base === "object" && !Array.isArray(change.base)
        ? normalizeActivity(change.base, id)
        : ({ id } as ActivityRecord);
      const next = deleted ? null : normalizeActivity(change.next, id);
      const fields = next ? changedFields(base, next) : ["__deleted"];
      let finished = false;

      for (let attempt = 0; attempt < 3 && !finished; attempt += 1) {
        const current = await readRow(db, id);

        if (deleted) {
          if (!current || current.deleted === 1) {
            accepted.push({ id, deleted: true, revision: current?.revision ?? expectedRevision });
            finished = true;
            break;
          }
          if (current.revision !== expectedRevision) {
            conflicts.push(conflictResult(current, id, fields));
            finished = true;
            break;
          }

          const nextRevision = current.revision + 1;
          const updated = await db
            .prepare(`
              UPDATE activity_state
              SET deleted = 1, revision = ?, global_revision = ?, updated_at = ?, updated_by = ?
              WHERE id = ? AND revision = ?
              RETURNING revision
            `)
            .bind(nextRevision, globalRevision, now, session.name, id, current.revision)
            .first<{ revision: number }>();
          if (!updated) continue;

          await db
            .prepare(`
              INSERT INTO activity_audit
                (activity_id, activity_revision, global_revision, action, changes, snapshot, updated_by, created_at)
              VALUES (?, ?, ?, 'delete', ?, ?, ?, ?)
            `)
            .bind(id, nextRevision, globalRevision, JSON.stringify(fields), current.payload, session.name, now)
            .run();
          accepted.push({ id, deleted: true, revision: nextRevision });
          finished = true;
          break;
        }

        if (!current) {
          if (expectedRevision !== 0) {
            conflicts.push(conflictResult(null, id, fields));
            finished = true;
            break;
          }

          const payload = JSON.stringify(next);
          const inserted = await db
            .prepare(`
              INSERT INTO activity_state
                (id, payload, revision, global_revision, position, deleted, updated_at, updated_by)
              VALUES (?, ?, 1, ?, ?, 0, ?, ?)
              ON CONFLICT(id) DO NOTHING
              RETURNING revision
            `)
            .bind(id, payload, globalRevision, position, now, session.name)
            .first<{ revision: number }>();
          if (!inserted) continue;

          await db
            .prepare(`
              INSERT INTO activity_audit
                (activity_id, activity_revision, global_revision, action, changes, snapshot, updated_by, created_at)
              VALUES (?, 1, ?, 'create', ?, ?, ?, ?)
            `)
            .bind(id, globalRevision, JSON.stringify(Object.keys(next)), payload, session.name, now)
            .run();
          accepted.push({ id, deleted: false, revision: 1, activity: next, updatedBy: session.name });
          finished = true;
          break;
        }

        if (current.deleted === 1) {
          conflicts.push(conflictResult(current, id, fields));
          finished = true;
          break;
        }

        const currentActivity = parseActivity(current.payload);
        let valueToSave = next;
        if (current.revision !== expectedRevision) {
          const overlapping = fields.filter((field) => !same(currentActivity[field], base[field]));
          if (overlapping.length > 0) {
            conflicts.push(conflictResult(current, id, overlapping));
            finished = true;
            break;
          }
          valueToSave = applyFields(currentActivity, next, fields);
        }

        if (fields.length === 0 && current.position === position) {
          accepted.push({
            id,
            deleted: false,
            revision: current.revision,
            activity: currentActivity,
            updatedBy: current.updated_by,
          });
          finished = true;
          break;
        }

        const nextRevision = current.revision + 1;
        const payload = JSON.stringify(valueToSave);
        const updated = await db
          .prepare(`
            UPDATE activity_state
            SET payload = ?, revision = ?, global_revision = ?, position = ?, deleted = 0,
                updated_at = ?, updated_by = ?
            WHERE id = ? AND revision = ?
            RETURNING revision
          `)
          .bind(payload, nextRevision, globalRevision, position, now, session.name, id, current.revision)
          .first<{ revision: number }>();
        if (!updated) continue;

        await db
          .prepare(`
            INSERT INTO activity_audit
              (activity_id, activity_revision, global_revision, action, changes, snapshot, updated_by, created_at)
            VALUES (?, ?, ?, 'update', ?, ?, ?, ?)
          `)
          .bind(id, nextRevision, globalRevision, JSON.stringify(fields), payload, session.name, now)
          .run();
        accepted.push({
          id,
          deleted: false,
          revision: nextRevision,
          activity: valueToSave,
          updatedBy: session.name,
        });
        finished = true;
      }

      if (!finished) conflicts.push(conflictResult(await readRow(db, id), id, fields));
    }

    return noStoreJson({
      saved: conflicts.length === 0,
      revision: globalRevision,
      updatedAt: now,
      updatedBy: session.name,
      accepted,
      conflicts,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao salvar atividades";
    console.error("Activity batch write failed", error);
    return noStoreJson({ error: message }, { status: 400 });
  }
}
