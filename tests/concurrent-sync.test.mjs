import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Miniflare } from "miniflare";

async function applyMigration(db, relativePath) {
  const sql = await readFile(new URL(relativePath, import.meta.url), "utf8");
  for (const part of sql.split("--> statement-breakpoint")) {
    const statement = part.trim();
    if (statement) await db.prepare(statement).run();
  }
}

async function setup() {
  const miniflare = new Miniflare({
    modules: true,
    scriptPath: fileURLToPath(new URL("../dist/server/index.js", import.meta.url)),
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    compatibilityDate: "2026-05-22",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: `ka-sync-${Date.now()}-${Math.random()}` },
    bindings: {
      PCM_OPERATOR_PASSWORD: "PCM2026",
      PCM_SESSION_SECRET: "segredo-de-teste-comprido-e-deterministico",
    },
    serviceBindings: {
      ASSETS: async () => new Response("Not found", { status: 404 }),
    },
  });
  const db = await miniflare.getD1Database("DB");
  await applyMigration(db, "../drizzle/0000_exotic_thena.sql");

  const initial = {
    schema: "ka_test_v1",
    activities: [
      { id: "ATV-A", atividade: "Atividade A", progresso: 0, status: "Não iniciada", obs: "" },
      { id: "ATV-B", atividade: "Atividade B", progresso: 0, status: "Não iniciada", obs: "" },
    ],
    bloqueios: [],
    limpezas: [],
    meetingPlan: [],
    progressSnapshots: [],
    desbloqueios: [],
    refTime: "",
  };
  await db
    .prepare(`
      INSERT INTO shared_state (id, payload, revision, updated_at, updated_by)
      VALUES (1, ?, 1, ?, 'Carga inicial')
    `)
    .bind(JSON.stringify(initial), new Date().toISOString())
    .run();
  await applyMigration(db, "../drizzle/0001_blue_silverclaw.sql");

  async function fetchJson(path, options = {}) {
    const response = await miniflare.dispatchFetch(`http://localhost${path}`, options);
    return { response, data: await response.json() };
  }

  const login = await fetchJson("/api/operator/session", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "127.0.0.1" },
    body: JSON.stringify({ password: "PCM2026", name: "Alice PCM" }),
  });
  assert.equal(login.response.status, 200);
  const cookie = login.response.headers.get("set-cookie").split(";", 1)[0];

  return { miniflare, db, fetchJson, cookie };
}

function activityChange(base, next, expectedRevision) {
  return {
    id: base.id,
    expectedRevision,
    base,
    next,
    deleted: false,
    position: base.id === "ATV-A" ? 0 : 1,
  };
}

test("salva atividades diferentes em paralelo e protege o mesmo campo", async (t) => {
  const app = await setup();
  t.after(async () => { await app.miniflare.dispose(); });
  const authHeaders = { "content-type": "application/json", cookie: app.cookie };

  const initial = await app.fetchJson("/api/state");
  assert.equal(initial.response.status, 200);
  assert.equal(initial.data.state.activities.length, 2);
  assert.equal(initial.data.activityVersions["ATV-A"], 1);
  assert.equal(initial.data.activityVersions["ATV-B"], 1);

  const activityA = initial.data.state.activities.find((item) => item.id === "ATV-A");
  const activityB = initial.data.state.activities.find((item) => item.id === "ATV-B");
  const parallelPayloads = [
    activityChange(activityA, { ...activityA, progresso: 10 }, 1),
    activityChange(activityB, { ...activityB, progresso: 25 }, 1),
  ];
  const parallelResults = await Promise.all(parallelPayloads.map((change) =>
    app.fetchJson("/api/activities", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ changes: [change] }),
    })
  ));
  parallelResults.forEach(({ response, data }) => {
    assert.equal(response.status, 200);
    assert.equal(data.conflicts.length, 0);
    assert.equal(data.accepted.length, 1);
  });

  const afterParallel = await app.fetchJson("/api/state");
  const currentA = afterParallel.data.state.activities.find((item) => item.id === "ATV-A");
  const currentB = afterParallel.data.state.activities.find((item) => item.id === "ATV-B");
  assert.equal(currentA.progresso, 10);
  assert.equal(currentB.progresso, 25);

  const versionA = afterParallel.data.activityVersions["ATV-A"];
  const nonOverlappingOne = activityChange(currentA, { ...currentA, status: "Em andamento" }, versionA);
  const nonOverlappingTwo = activityChange(currentA, { ...currentA, obs: "Atualizada no campo" }, versionA);
  const firstMerge = await app.fetchJson("/api/activities", {
    method: "POST", headers: authHeaders, body: JSON.stringify({ changes: [nonOverlappingOne] }),
  });
  const secondMerge = await app.fetchJson("/api/activities", {
    method: "POST", headers: authHeaders, body: JSON.stringify({ changes: [nonOverlappingTwo] }),
  });
  assert.equal(firstMerge.data.conflicts.length, 0);
  assert.equal(secondMerge.data.conflicts.length, 0);

  const afterMerge = await app.fetchJson("/api/state");
  const mergedA = afterMerge.data.state.activities.find((item) => item.id === "ATV-A");
  assert.equal(mergedA.status, "Em andamento");
  assert.equal(mergedA.obs, "Atualizada no campo");

  const mergedVersion = afterMerge.data.activityVersions["ATV-A"];
  const sameFieldOne = activityChange(mergedA, { ...mergedA, progresso: 35 }, mergedVersion);
  const sameFieldTwo = activityChange(mergedA, { ...mergedA, progresso: 45 }, mergedVersion);
  const accepted = await app.fetchJson("/api/activities", {
    method: "POST", headers: authHeaders, body: JSON.stringify({ changes: [sameFieldOne] }),
  });
  const rejected = await app.fetchJson("/api/activities", {
    method: "POST", headers: authHeaders, body: JSON.stringify({ changes: [sameFieldTwo] }),
  });
  assert.equal(accepted.data.conflicts.length, 0);
  assert.equal(rejected.data.conflicts.length, 1);
  assert.deepEqual(rejected.data.conflicts[0].fields, ["progresso"]);
  assert.equal(rejected.data.conflicts[0].activity.progresso, 35);

  const audit = await app.db.prepare("SELECT COUNT(*) AS total FROM activity_audit").first();
  assert.ok(Number(audit.total) >= 5);
});
