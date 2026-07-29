import { getOperatorSession } from "../../../lib/operator-auth";
import {
  allocateGlobalRevision,
  database,
  noStoreJson,
  readSyncHeader,
} from "../../../lib/shared-database";

type SharedStateRow = {
  payload: string;
  revision: number;
  global_revision: number;
  updated_at: string;
  updated_by: string;
};

type ActivityRow = {
  id: string;
  payload: string;
  revision: number;
  global_revision: number;
  position: number;
  deleted: number;
  updated_at: string;
  updated_by: string;
};

const SHARED_KEYS = [
  "schema",
  "bloqueios",
  "limpezas",
  "meetingPlan",
  "progressSnapshots",
  "desbloqueios",
  "desbloqueioSourceVersion",
  "refTime",
] as const;

type SharedKey = (typeof SHARED_KEYS)[number];
type SharedBase = Record<SharedKey, unknown> & {
  exportedAt: string;
  activities: never[];
};

function parseObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Estado inválido");
  return parsed as Record<string, unknown>;
}

function normalizedBaseState(value: unknown): SharedBase {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Estado inválido");
  const input = value as Record<string, unknown>;

  return {
    schema: typeof input.schema === "string" ? input.schema : "ka_gestao_paradas_v2",
    exportedAt: new Date().toISOString(),
    activities: [],
    bloqueios: Array.isArray(input.bloqueios) ? input.bloqueios : [],
    limpezas: Array.isArray(input.limpezas) ? input.limpezas : [],
    meetingPlan: Array.isArray(input.meetingPlan) ? input.meetingPlan : [],
    progressSnapshots: Array.isArray(input.progressSnapshots) ? input.progressSnapshots.slice(-500) : [],
    desbloqueios: Array.isArray(input.desbloqueios) ? input.desbloqueios : [],
    desbloqueioSourceVersion:
      typeof input.desbloqueioSourceVersion === "string" ? input.desbloqueioSourceVersion : "",
    refTime: typeof input.refTime === "string" ? input.refTime : "",
  };
}

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function changedKeys(base: SharedBase, next: SharedBase) {
  return SHARED_KEYS.filter((key) => !same(base[key], next[key]));
}

function mergeSnapshots(current: unknown, incoming: unknown) {
  const rows = [
    ...(Array.isArray(current) ? current : []),
    ...(Array.isArray(incoming) ? incoming : []),
  ];
  const unique = new Map<string, unknown>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const key = String(item.t ?? item.time ?? item.timestamp ?? JSON.stringify(item));
    unique.set(key, row);
  }
  return Array.from(unique.values()).slice(-500);
}

function mergeSharedState(current: SharedBase, base: SharedBase, next: SharedBase) {
  const merged = { ...current } as SharedBase;
  const conflicts: SharedKey[] = [];

  for (const key of changedKeys(base, next)) {
    if (same(current[key], base[key])) {
      merged[key] = next[key] as never;
    } else if (key === "progressSnapshots") {
      merged[key] = mergeSnapshots(current[key], next[key]);
    } else {
      conflicts.push(key);
    }
  }

  merged.exportedAt = new Date().toISOString();
  merged.activities = [];
  return { merged, conflicts };
}

function activityFromRow(row: ActivityRow) {
  return {
    id: row.id,
    revision: row.revision,
    globalRevision: row.global_revision,
    position: row.position,
    deleted: row.deleted === 1,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    activity: row.deleted === 1 ? null : parseObject(row.payload),
  };
}

export async function GET(request: Request) {
  try {
    const db = database();
    const url = new URL(request.url);
    const knownRevision = Math.max(0, Number(url.searchParams.get("revision") ?? "0") || 0);
    const header = await readSyncHeader(db);

    if (!header) return noStoreJson({ initialized: false, revision: 0 });
    if (knownRevision > 0 && knownRevision === header.revision) {
      return noStoreJson({
        initialized: true,
        changed: false,
        revision: header.revision,
        updatedAt: header.updated_at,
        updatedBy: header.updated_by,
      });
    }

    const stateRow = await db
      .prepare(`
        SELECT payload, revision, global_revision, updated_at, updated_by
        FROM shared_state
        WHERE id = 1
      `)
      .first<SharedStateRow>();
    if (!stateRow) return noStoreJson({ initialized: false, revision: 0 });

    if (knownRevision > 0) {
      const rows = await db
        .prepare(`
          SELECT id, payload, revision, global_revision, position, deleted, updated_at, updated_by
          FROM activity_state
          WHERE global_revision > ?
          ORDER BY global_revision, position, id
        `)
        .bind(knownRevision)
        .all<ActivityRow>();

      return noStoreJson({
        initialized: true,
        changed: true,
        delta: true,
        revision: header.revision,
        stateRevision: stateRow.revision,
        updatedAt: header.updated_at,
        updatedBy: header.updated_by,
        baseState:
          stateRow.global_revision > knownRevision
            ? normalizedBaseState(parseObject(stateRow.payload))
            : null,
        activities: rows.results.map(activityFromRow),
      });
    }

    const rows = await db
      .prepare(`
        SELECT id, payload, revision, global_revision, position, deleted, updated_at, updated_by
        FROM activity_state
        WHERE deleted = 0
        ORDER BY position, id
      `)
      .all<ActivityRow>();
    const legacyState = parseObject(stateRow.payload);
    const activities = rows.results.length > 0
      ? rows.results.map((row) => parseObject(row.payload))
      : Array.isArray(legacyState.activities) ? legacyState.activities : [];
    const activityVersions = Object.fromEntries(rows.results.map((row) => [row.id, row.revision]));

    return noStoreJson({
      initialized: true,
      changed: true,
      delta: false,
      revision: header.revision,
      stateRevision: stateRow.revision,
      updatedAt: header.updated_at,
      updatedBy: header.updated_by,
      activityVersions,
      state: { ...normalizedBaseState(legacyState), activities },
    });
  } catch (error) {
    console.error("Shared state read failed", error);
    return noStoreJson({ error: "Não foi possível carregar a base compartilhada" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getOperatorSession(request);
    if (!session) return noStoreJson({ error: "Acesso de operador necessário" }, { status: 401 });

    const body = (await request.json()) as {
      expectedRevision?: number;
      state?: unknown;
      baseState?: unknown;
    };
    const expectedRevision = Math.max(0, Number(body.expectedRevision ?? 0) || 0);
    const nextState = normalizedBaseState(body.state);
    const suppliedBase = body.baseState ? normalizedBaseState(body.baseState) : null;
    const payloadSize = JSON.stringify(nextState).length;
    if (payloadSize > 4_000_000) {
      return noStoreJson({ error: "A base compartilhada ultrapassou o limite permitido" }, { status: 413 });
    }

    const db = database();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await db
        .prepare(`
          SELECT payload, revision, global_revision, updated_at, updated_by
          FROM shared_state
          WHERE id = 1
        `)
        .first<SharedStateRow>();
      const currentState = current ? normalizedBaseState(parseObject(current.payload)) : normalizedBaseState({});
      let stateToSave = nextState;

      if (current && expectedRevision !== current.revision) {
        if (!suppliedBase) {
          return noStoreJson(
            { error: "A base foi atualizada por outra pessoa", currentRevision: current.revision, currentState },
            { status: 409 },
          );
        }
        const result = mergeSharedState(currentState, suppliedBase, nextState);
        if (result.conflicts.length > 0) {
          return noStoreJson(
            {
              error: "Outra pessoa atualizou a mesma área do sistema",
              conflicts: result.conflicts,
              currentRevision: current.revision,
              currentState,
            },
            { status: 409 },
          );
        }
        stateToSave = result.merged;
      }

      const keys = changedKeys(currentState, stateToSave);
      if (current && keys.length === 0) {
        const header = await readSyncHeader(db);
        return noStoreJson({
          saved: true,
          revision: header?.revision ?? current.global_revision,
          stateRevision: current.revision,
          updatedAt: current.updated_at,
          updatedBy: current.updated_by,
        });
      }

      const now = new Date().toISOString();
      const globalRevision = await allocateGlobalRevision(db, now, session.name);
      const payload = JSON.stringify({ ...stateToSave, exportedAt: now, activities: [] });

      if (!current) {
        const inserted = await db
          .prepare(`
            INSERT INTO shared_state (id, payload, revision, global_revision, updated_at, updated_by)
            VALUES (1, ?, 1, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING
            RETURNING revision
          `)
          .bind(payload, globalRevision, now, session.name)
          .first<{ revision: number }>();
        if (!inserted) continue;

        return noStoreJson({
          saved: true,
          revision: globalRevision,
          stateRevision: 1,
          updatedAt: now,
          updatedBy: session.name,
        });
      }

      const nextStateRevision = current.revision + 1;
      const updated = await db
        .prepare(`
          UPDATE shared_state
          SET payload = ?, revision = ?, global_revision = ?, updated_at = ?, updated_by = ?
          WHERE id = 1 AND revision = ?
          RETURNING revision
        `)
        .bind(payload, nextStateRevision, globalRevision, now, session.name, current.revision)
        .first<{ revision: number }>();
      if (!updated) continue;

      const summary = JSON.stringify({ sections: keys, operator: session.name });
      await db
        .prepare("INSERT INTO audit_log (revision, action, summary, created_at) VALUES (?, 'shared_update', ?, ?)")
        .bind(nextStateRevision, summary, now)
        .run();

      return noStoreJson({
        saved: true,
        revision: globalRevision,
        stateRevision: nextStateRevision,
        updatedAt: now,
        updatedBy: session.name,
      });
    }

    return noStoreJson({ error: "A base recebeu várias alterações ao mesmo tempo. Tente novamente." }, { status: 409 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao salvar";
    console.error("Shared state write failed", error);
    return noStoreJson({ error: message }, { status: 400 });
  }
}
