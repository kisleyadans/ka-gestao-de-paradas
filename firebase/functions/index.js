import crypto from "node:crypto";
import express from "express";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";

initializeApp();

const db = getFirestore();
const operatorPasswordSecret = defineSecret("PCM_OPERATOR_PASSWORD");
const sessionSecretValue = defineSecret("PCM_SESSION_SECRET");
const REGION = "southamerica-east1";
const COOKIE_NAME = "ka_pcm_operator";
const SESSION_SECONDS = 12 * 60 * 60;
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const MAX_AUTH_ATTEMPTS = 6;
const SHARED_KEYS = [
  "schema",
  "bloqueios",
  "limpezas",
  "meetingPlan",
  "progressSnapshots",
  "desbloqueios",
  "desbloqueioSourceVersion",
  "desbloqueioBaseName",
  "refTime",
];

const stateRef = db.collection("ka_state").doc("current");
const metaRef = db.collection("ka_state").doc("revision");
const activitiesCollection = db.collection("ka_activities");
const activityAuditCollection = db.collection("ka_activity_audit");
const authAttemptsCollection = db.collection("ka_auth_attempts");

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cleanString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeBaseState(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    schema: cleanString(input.schema, "ka_gestao_paradas_v2"),
    activities: [],
    bloqueios: Array.isArray(input.bloqueios) ? clone(input.bloqueios) : [],
    limpezas: Array.isArray(input.limpezas) ? clone(input.limpezas) : [],
    meetingPlan: Array.isArray(input.meetingPlan) ? clone(input.meetingPlan) : [],
    progressSnapshots: Array.isArray(input.progressSnapshots) ? clone(input.progressSnapshots.slice(-500)) : [],
    desbloqueios: Array.isArray(input.desbloqueios) ? clone(input.desbloqueios) : [],
    desbloqueioSourceVersion: cleanString(input.desbloqueioSourceVersion),
    desbloqueioBaseName: cleanString(input.desbloqueioBaseName),
    refTime: cleanString(input.refTime),
  };
}

function changedKeys(base, next) {
  return SHARED_KEYS.filter((key) => !same(base[key], next[key]));
}

function mergeSnapshots(current, incoming) {
  const rows = [
    ...(Array.isArray(current) ? current : []),
    ...(Array.isArray(incoming) ? incoming : []),
  ];
  const unique = new Map();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const key = String(row.t ?? row.time ?? row.timestamp ?? JSON.stringify(row));
    unique.set(key, row);
  }
  return Array.from(unique.values()).slice(-500);
}

function mergeSharedState(current, base, next) {
  const merged = clone(current);
  const conflicts = [];
  for (const key of changedKeys(base, next)) {
    if (same(current[key], base[key])) merged[key] = clone(next[key]);
    else if (key === "progressSnapshots") merged[key] = mergeSnapshots(current[key], next[key]);
    else conflicts.push(key);
  }
  merged.activities = [];
  return { merged, conflicts };
}

function normalizeOperatorName(value) {
  if (typeof value !== "string") return "Operador PCM";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60) || "Operador PCM";
}

function safeEqual(left, right) {
  const a = crypto.createHash("sha256").update(String(left)).digest();
  const b = crypto.createHash("sha256").update(String(right)).digest();
  return crypto.timingSafeEqual(a, b);
}

function sign(value) {
  return crypto.createHmac("sha256", sessionSecretValue.value()).update(value).digest("hex");
}

function readCookie(request, name) {
  const cookie = request.headers.cookie ?? "";
  for (const item of cookie.split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return "";
}

function getOperatorSession(request) {
  const token = readCookie(request, COOKIE_NAME);
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const expiresAt = Number(parts[0]);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return null;
  const expected = sign(`${parts[0]}.${parts[1]}`);
  if (!safeEqual(parts[2], expected)) return null;
  try {
    return { name: normalizeOperatorName(Buffer.from(parts[1], "base64url").toString("utf8")) };
  } catch {
    return null;
  }
}

function createOperatorCookie(request, name) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const encodedName = Buffer.from(normalizeOperatorName(name), "utf8").toString("base64url");
  const signature = sign(`${expiresAt}.${encodedName}`);
  const secure = request.hostname === "localhost" || request.hostname === "127.0.0.1" ? "" : "; Secure";
  return `${COOKIE_NAME}=${encodeURIComponent(`${expiresAt}.${encodedName}.${signature}`)}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
}

function clearOperatorCookie(request) {
  const secure = request.hostname === "localhost" || request.hostname === "127.0.0.1" ? "" : "; Secure";
  return `${COOKIE_NAME}=; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=0`;
}

function clientKey(request) {
  const address = request.headers["x-forwarded-for"] ?? request.ip ?? "unknown";
  return crypto.createHmac("sha256", sessionSecretValue.value()).update(String(address)).digest("hex");
}

function activityDocId(id) {
  return crypto.createHash("sha256").update(id).digest("hex");
}

function normalizeActivity(value, id) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return clone({ ...input, id });
}

function normalizeActivityId(value) {
  const id = cleanString(value).trim().slice(0, 160);
  if (!id) throw new Error("Atividade sem identificador");
  return id;
}

function changedFields(base, next) {
  const keys = new Set([...Object.keys(base || {}), ...Object.keys(next || {})]);
  keys.delete("id");
  return Array.from(keys).filter((key) => !same(base?.[key], next?.[key]));
}

function applyFields(current, next, fields) {
  const merged = clone(current);
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(next, field)) merged[field] = clone(next[field]);
    else delete merged[field];
  }
  return merged;
}

function activityFromData(data) {
  return {
    id: data.id,
    revision: Number(data.revision || 0),
    globalRevision: Number(data.globalRevision || 0),
    position: Number(data.position || 0),
    deleted: data.deleted === true,
    updatedAt: data.updatedAt,
    updatedBy: data.updatedBy,
    activity: data.deleted === true ? null : clone(data.payload),
  };
}

function sendJson(response, status, body) {
  response.status(status).json(body);
}

class ApiConflict extends Error {
  constructor(body) {
    super("Conflito de atualização");
    this.body = body;
  }
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "5mb" }));
app.use((request, response, next) => {
  response.set("Cache-Control", "no-store");
  response.set("X-Content-Type-Options", "nosniff");
  next();
});

app.get("/api/health", (_request, response) => {
  sendJson(response, 200, { ok: true, service: "ka-gestao-paradas" });
});

app.get("/api/operator/session", (request, response) => {
  const session = getOperatorSession(request);
  sendJson(response, 200, { operator: Boolean(session), name: session?.name ?? "" });
});

app.post("/api/operator/session", async (request, response) => {
  try {
    const key = clientKey(request);
    const attemptRef = authAttemptsCollection.doc(key);
    const status = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(attemptRef);
      if (!snapshot.exists) return { blocked: false };
      const data = snapshot.data();
      const active = Date.now() - Number(data.windowStartedAt || 0) < AUTH_WINDOW_MS;
      return { blocked: active && Number(data.attempts || 0) >= MAX_AUTH_ATTEMPTS };
    });
    if (status.blocked) {
      return sendJson(response, 429, { error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." });
    }

    const suppliedPassword = cleanString(request.body?.password);
    if (!safeEqual(suppliedPassword, operatorPasswordSecret.value())) {
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(attemptRef);
        const data = snapshot.exists ? snapshot.data() : {};
        const active = Date.now() - Number(data.windowStartedAt || 0) < AUTH_WINDOW_MS;
        transaction.set(attemptRef, {
          attempts: active ? Number(data.attempts || 0) + 1 : 1,
          windowStartedAt: active ? Number(data.windowStartedAt) : Date.now(),
        });
      });
      return sendJson(response, 401, { error: "Senha incorreta" });
    }

    await attemptRef.delete().catch(() => undefined);
    const name = normalizeOperatorName(request.body?.name);
    response.set("Set-Cookie", createOperatorCookie(request, name));
    return sendJson(response, 200, { operator: true, name });
  } catch (error) {
    console.error("Operator login failed", error);
    return sendJson(response, 500, { error: "Não foi possível liberar o acesso agora" });
  }
});

app.delete("/api/operator/session", (request, response) => {
  response.set("Set-Cookie", clearOperatorCookie(request));
  sendJson(response, 200, { operator: false });
});

app.get("/api/state", async (request, response) => {
  try {
    const knownRevision = Math.max(0, Number(request.query.revision ?? 0) || 0);
    const [stateSnapshot, metaSnapshot] = await Promise.all([stateRef.get(), metaRef.get()]);
    if (!stateSnapshot.exists) return sendJson(response, 200, { initialized: false, revision: 0 });

    const stateData = stateSnapshot.data();
    const metaData = metaSnapshot.exists ? metaSnapshot.data() : {};
    const revision = Number(metaData.globalRevision || stateData.globalRevision || 0);
    if (knownRevision > 0 && knownRevision === revision) {
      return sendJson(response, 200, {
        initialized: true,
        changed: false,
        revision,
        updatedAt: metaData.updatedAt || stateData.updatedAt,
        updatedBy: metaData.updatedBy || stateData.updatedBy,
      });
    }

    if (knownRevision > 0) {
      const changedSnapshot = await activitiesCollection.where("globalRevision", ">", knownRevision).get();
      const activities = changedSnapshot.docs
        .map((document) => activityFromData(document.data()))
        .sort((left, right) => left.globalRevision - right.globalRevision || left.position - right.position);
      return sendJson(response, 200, {
        initialized: true,
        changed: true,
        delta: true,
        revision,
        stateRevision: Number(stateData.stateRevision || 0),
        updatedAt: metaData.updatedAt || stateData.updatedAt,
        updatedBy: metaData.updatedBy || stateData.updatedBy,
        baseState: Number(stateData.baseGlobalRevision || 0) > knownRevision ? normalizeBaseState(stateData.baseState) : null,
        activities,
      });
    }

    const allActivities = await activitiesCollection.get();
    const activeRows = allActivities.docs
      .map((document) => document.data())
      .filter((item) => item.deleted !== true)
      .sort((left, right) => Number(left.position || 0) - Number(right.position || 0));
    const activities = activeRows.map((item) => clone(item.payload));
    const activityVersions = Object.fromEntries(activeRows.map((item) => [item.id, Number(item.revision || 0)]));

    return sendJson(response, 200, {
      initialized: true,
      changed: true,
      delta: false,
      revision,
      stateRevision: Number(stateData.stateRevision || 0),
      updatedAt: metaData.updatedAt || stateData.updatedAt,
      updatedBy: metaData.updatedBy || stateData.updatedBy,
      activityVersions,
      state: { ...normalizeBaseState(stateData.baseState), activities },
    });
  } catch (error) {
    console.error("Shared state read failed", error);
    return sendJson(response, 500, { error: "Não foi possível carregar a base compartilhada" });
  }
});

app.put("/api/state", async (request, response) => {
  const session = getOperatorSession(request);
  if (!session) return sendJson(response, 401, { error: "Acesso de operador necessário" });

  try {
    const expectedRevision = Math.max(0, Number(request.body?.expectedRevision ?? 0) || 0);
    const nextState = normalizeBaseState(request.body?.state);
    const suppliedBase = request.body?.baseState ? normalizeBaseState(request.body.baseState) : null;
    if (JSON.stringify(nextState).length > 900_000) {
      return sendJson(response, 413, { error: "A base compartilhada ultrapassou o limite permitido" });
    }

    const result = await db.runTransaction(async (transaction) => {
      const [currentSnapshot, metaSnapshot] = await Promise.all([
        transaction.get(stateRef),
        transaction.get(metaRef),
      ]);
      const currentData = currentSnapshot.exists ? currentSnapshot.data() : null;
      const currentState = normalizeBaseState(currentData?.baseState);
      const currentStateRevision = Number(currentData?.stateRevision || 0);
      let stateToSave = nextState;

      if (currentData && expectedRevision !== currentStateRevision) {
        if (!suppliedBase) {
          throw new ApiConflict({
            error: "A base foi atualizada por outra pessoa",
            currentRevision: currentStateRevision,
            currentState,
          });
        }
        const merged = mergeSharedState(currentState, suppliedBase, nextState);
        if (merged.conflicts.length > 0) {
          throw new ApiConflict({
            error: "Outra pessoa atualizou a mesma área do sistema",
            conflicts: merged.conflicts,
            currentRevision: currentStateRevision,
            currentState,
          });
        }
        stateToSave = merged.merged;
      }

      const keys = changedKeys(currentState, stateToSave);
      if (currentData && keys.length === 0) {
        return {
          saved: true,
          revision: Number(metaSnapshot.data()?.globalRevision || currentData.globalRevision || 0),
          stateRevision: currentStateRevision,
          updatedAt: currentData.updatedAt,
          updatedBy: currentData.updatedBy,
        };
      }

      const now = new Date().toISOString();
      const globalRevision = Number(metaSnapshot.data()?.globalRevision || 0) + 1;
      const stateRevision = currentStateRevision + 1;
      transaction.set(metaRef, { globalRevision, updatedAt: now, updatedBy: session.name });
      transaction.set(stateRef, {
        baseState: stateToSave,
        stateRevision,
        globalRevision,
        baseGlobalRevision: globalRevision,
        updatedAt: now,
        updatedBy: session.name,
      });
      transaction.set(db.collection("ka_audit_log").doc(), {
        revision: stateRevision,
        globalRevision,
        action: "shared_update",
        sections: keys,
        updatedBy: session.name,
        createdAt: now,
      });
      return { saved: true, revision: globalRevision, stateRevision, updatedAt: now, updatedBy: session.name };
    });
    return sendJson(response, 200, result);
  } catch (error) {
    if (error instanceof ApiConflict) return sendJson(response, 409, error.body);
    console.error("Shared state write failed", error);
    return sendJson(response, 400, { error: error instanceof Error ? error.message : "Falha ao salvar" });
  }
});

app.post("/api/activities", async (request, response) => {
  const session = getOperatorSession(request);
  if (!session) return sendJson(response, 401, { error: "Acesso de operador necessário" });

  try {
    const changes = Array.isArray(request.body?.changes) ? request.body.changes : [];
    if (changes.length < 1 || changes.length > 25) {
      return sendJson(response, 400, { error: "Envie de 1 a 25 alterações por vez" });
    }

    const prepared = changes.map((change) => {
      const id = normalizeActivityId(change.id);
      return { change, id, ref: activitiesCollection.doc(activityDocId(id)) };
    });
    if (new Set(prepared.map((item) => item.id)).size !== prepared.length) {
      return sendJson(response, 400, { error: "O mesmo identificador foi enviado mais de uma vez" });
    }

    const result = await db.runTransaction(async (transaction) => {
      const metaSnapshot = await transaction.get(metaRef);
      const snapshots = await Promise.all(prepared.map((item) => transaction.get(item.ref)));
      const now = new Date().toISOString();
      const globalRevision = Number(metaSnapshot.data()?.globalRevision || 0) + 1;
      const accepted = [];
      const conflicts = [];
      const writes = [];

      prepared.forEach(({ change, id, ref }, index) => {
        const snapshot = snapshots[index];
        const current = snapshot.exists ? snapshot.data() : null;
        const expectedRevision = Math.max(0, Number(change.expectedRevision ?? 0) || 0);
        const deleted = change.deleted === true;
        const position = Math.max(0, Math.trunc(Number(change.position ?? 0) || 0));
        const base = normalizeActivity(change.base, id);
        const next = deleted ? null : normalizeActivity(change.next, id);
        const fields = next ? changedFields(base, next) : ["__deleted"];

        const addConflict = (overlapping = fields) => {
          conflicts.push({
            ...activityFromData(current || {
              id,
              revision: 0,
              globalRevision: 0,
              position,
              deleted: true,
              payload: null,
              updatedAt: now,
              updatedBy: "",
            }),
            fields: overlapping,
          });
        };

        if (deleted) {
          if (!current || current.deleted === true) {
            accepted.push({ id, deleted: true, revision: Number(current?.revision || expectedRevision) });
            return;
          }
          if (Number(current.revision || 0) !== expectedRevision) return addConflict();
          const revision = Number(current.revision || 0) + 1;
          writes.push({
            ref,
            data: { ...current, revision, globalRevision, deleted: true, updatedAt: now, updatedBy: session.name },
            audit: { activityId: id, activityRevision: revision, globalRevision, action: "delete", changes: fields, snapshot: current.payload, updatedBy: session.name, createdAt: now },
          });
          accepted.push({ id, deleted: true, revision });
          return;
        }

        if (!current) {
          if (expectedRevision !== 0) return addConflict();
          writes.push({
            ref,
            data: { id, payload: next, revision: 1, globalRevision, position, deleted: false, updatedAt: now, updatedBy: session.name },
            audit: { activityId: id, activityRevision: 1, globalRevision, action: "create", changes: Object.keys(next), snapshot: next, updatedBy: session.name, createdAt: now },
          });
          accepted.push({ id, deleted: false, revision: 1, activity: next, updatedBy: session.name });
          return;
        }

        if (current.deleted === true) return addConflict();
        const currentActivity = normalizeActivity(current.payload, id);
        let valueToSave = next;
        if (Number(current.revision || 0) !== expectedRevision) {
          const overlapping = fields.filter((field) => !same(currentActivity[field], base[field]));
          if (overlapping.length > 0) return addConflict(overlapping);
          valueToSave = applyFields(currentActivity, next, fields);
        }

        if (fields.length === 0 && Number(current.position || 0) === position) {
          accepted.push({ id, deleted: false, revision: Number(current.revision || 0), activity: currentActivity, updatedBy: current.updatedBy });
          return;
        }

        const revision = Number(current.revision || 0) + 1;
        writes.push({
          ref,
          data: { id, payload: valueToSave, revision, globalRevision, position, deleted: false, updatedAt: now, updatedBy: session.name },
          audit: { activityId: id, activityRevision: revision, globalRevision, action: "update", changes: fields, snapshot: valueToSave, updatedBy: session.name, createdAt: now },
        });
        accepted.push({ id, deleted: false, revision, activity: valueToSave, updatedBy: session.name });
      });

      if (writes.length > 0) {
        transaction.set(metaRef, { globalRevision, updatedAt: now, updatedBy: session.name });
        for (const write of writes) {
          transaction.set(write.ref, write.data);
          transaction.set(activityAuditCollection.doc(), write.audit);
        }
      }

      return {
        saved: conflicts.length === 0,
        revision: writes.length > 0 ? globalRevision : Number(metaSnapshot.data()?.globalRevision || 0),
        updatedAt: now,
        updatedBy: session.name,
        accepted,
        conflicts,
      };
    });
    return sendJson(response, 200, result);
  } catch (error) {
    console.error("Activity batch write failed", error);
    return sendJson(response, 400, { error: error instanceof Error ? error.message : "Falha ao salvar atividades" });
  }
});

app.use("/api", (_request, response) => {
  sendJson(response, 404, { error: "Endpoint não encontrado" });
});

export const api = onRequest(
  {
    region: REGION,
    memory: "512MiB",
    timeoutSeconds: 60,
    maxInstances: 20,
    secrets: [operatorPasswordSecret, sessionSecretValue],
  },
  app,
);

export const testing = {
  normalizeBaseState,
  changedKeys,
  mergeSharedState,
  changedFields,
  applyFields,
};
