import { appendFile } from "node:fs/promises";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

const USERS = 25;
const DISCIPLINES = 17;
const BUCKETS = 16;
const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) throw new Error("FIREBASE_PROJECT_ID nao informado");

const app = initializeApp({ credential: applicationDefault(), projectId }, `ka-load-${Date.now()}`);
const db = getFirestore(app);
const runId = `run-${Date.now()}`;
const runRef = db.collection("ka_load_test_runs").doc(runId);
const bucketRefs = Array.from({ length: BUCKETS }, (_, index) =>
  runRef.collection("buckets").doc(String(index).padStart(2, "0")));
const progressRefs = Array.from({ length: DISCIPLINES }, (_, index) =>
  runRef.collection("progress").doc(`disciplina-${String(index + 1).padStart(2, "0")}`));

const counters = {
  setupWrites: 0,
  scenarioReads: 0,
  scenarioWrites: 0,
  cleanupDeletes: 0,
  initialReads: 0,
  transactionReads: 0,
  refreshReads: 0,
  errors: 0,
};
const billedQueryReads = (size) => Math.max(1, Number(size || 0));

async function setup() {
  const batch = db.batch();
  batch.set(runRef, {
    kind: "isolated-load-test",
    users: USERS,
    disciplines: DISCIPLINES,
    updatedAt: FieldValue.serverTimestamp(),
  });
  bucketRefs.forEach((ref, index) => batch.set(ref, {
    runId,
    bucket: index,
    entries: [],
    updatedAt: FieldValue.serverTimestamp(),
  }));
  progressRefs.forEach((ref, index) => batch.set(ref, {
    runId,
    disciplineKey: `DISCIPLINA_${index + 1}`,
    entries: [{ activityId: `TESTE_${index + 1}`, progresso: 0 }],
    updatedAt: FieldValue.serverTimestamp(),
  }));
  await batch.commit();
  counters.setupWrites = 1 + BUCKETS + DISCIPLINES;
}

async function openDashboard() {
  const [state, buckets, progress] = await Promise.all([
    runRef.get(),
    runRef.collection("buckets").get(),
    runRef.collection("progress").get(),
  ]);
  if (!state.exists || buckets.size !== BUCKETS || progress.size !== DISCIPLINES) {
    throw new Error("Base isolada incompleta durante abertura simulada");
  }
  return 1 + billedQueryReads(buckets.size) + billedQueryReads(progress.size);
}

async function advanceAllDisciplines() {
  await Promise.all(progressRefs.map((ref, index) => db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error(`Disciplina de teste ${index + 1} nao encontrada`);
    const current = snapshot.data();
    transaction.set(ref, {
      ...current,
      entries: [{ activityId: `TESTE_${index + 1}`, progresso: 50, status: "Em andamento" }],
      updatedBy: `Supervisor ${index + 1}`,
      updatedAt: FieldValue.serverTimestamp(),
    });
  })));
  counters.transactionReads = DISCIPLINES;
  counters.scenarioWrites = DISCIPLINES;
}

async function refreshDashboard(checkpoint) {
  const [state, buckets, progress] = await Promise.all([
    runRef.get(),
    runRef.collection("buckets").where("updatedAt", ">", checkpoint).get(),
    runRef.collection("progress").where("updatedAt", ">", checkpoint).get(),
  ]);
  if (!state.exists || progress.size !== DISCIPLINES) {
    throw new Error(`Atualizacao incremental retornou ${progress.size}/${DISCIPLINES} disciplinas`);
  }
  return 1 + billedQueryReads(buckets.size) + billedQueryReads(progress.size);
}

async function cleanup() {
  const batch = db.batch();
  bucketRefs.forEach((ref) => batch.delete(ref));
  progressRefs.forEach((ref) => batch.delete(ref));
  batch.delete(runRef);
  await batch.commit();
  counters.cleanupDeletes = 1 + BUCKETS + DISCIPLINES;
}

function markdown(result) {
  return [
    "## Teste real Firebase: 25 usuarios e todas as disciplinas",
    "",
    `- Leituras na abertura: **${result.initialReads}**`,
    `- Leituras das transacoes de avanço: **${result.transactionReads}**`,
    `- Leituras na atualizacao dos 25 paineis: **${result.refreshReads}**`,
    `- Total de leituras do cenario: **${result.scenarioReads}**`,
    `- Gravacoes de avanço: **${result.scenarioWrites}**`,
    `- Gravacoes temporarias de preparacao: **${result.setupWrites}**`,
    `- Exclusoes da limpeza: **${result.cleanupDeletes}**`,
    `- Erros: **${result.errors}**`,
    "",
    "A colecao temporaria foi isolada da base operacional e removida ao final.",
  ].join("\n");
}

let fatalError;
try {
  await setup();
  const initial = await Promise.all(Array.from({ length: USERS }, () => openDashboard()));
  counters.initialReads = initial.reduce((total, value) => total + value, 0);

  const checkpoint = Timestamp.now();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await advanceAllDisciplines();

  const refreshes = await Promise.all(Array.from({ length: USERS }, () => refreshDashboard(checkpoint)));
  counters.refreshReads = refreshes.reduce((total, value) => total + value, 0);
  counters.scenarioReads = counters.initialReads + counters.transactionReads + counters.refreshReads;
} catch (error) {
  counters.errors += 1;
  fatalError = error;
} finally {
  try { await cleanup(); }
  catch (cleanupError) {
    counters.errors += 1;
    if (!fatalError) fatalError = cleanupError;
  }
  console.log(JSON.stringify({ runId, ...counters }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown(counters)}\n`, "utf8");
  }
  await deleteApp(app);
}

if (fatalError) throw fatalError;
