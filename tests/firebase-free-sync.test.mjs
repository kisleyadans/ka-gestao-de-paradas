import assert from "node:assert/strict";
import test from "node:test";
import {
  BUCKET_COUNT,
  applyExclusiveActivityChange,
  bucketId,
  buildBuckets,
  collectActivityChanges,
  confirmActivityChanges,
  disciplineEmail,
  isAuthorizedDisciplineProgress,
  mergeActivityChange,
  mergeKeyedCollection,
  mergeSharedState,
  resolveActivityChange,
} from "../public/firebase-sync-core.mjs";

test("autoriza avanço somente para o e-mail da disciplina da atividade", () => {
  const activity = { id: "ATV-E1", disciplina: "Elétrica" };
  assert.equal(disciplineEmail(activity.disciplina), "eletrica@ka-paradas.app");
  assert.equal(isAuthorizedDisciplineProgress(activity, {
    activityId: "ATV-E1",
    disciplineKey: "ELETRICA",
    editorEmail: "eletrica@ka-paradas.app",
  }), true);
  assert.equal(isAuthorizedDisciplineProgress(activity, {
    activityId: "ATV-E1",
    disciplineKey: "MECANICA",
    editorEmail: "mecanica@ka-paradas.app",
  }), false);
});

test("divide atividades em blocos determinísticos para economizar leituras", () => {
  const activities = Array.from({ length: 240 }, (_, index) => ({
    id: `ATV-${String(index + 1).padStart(4, "0")}`,
    atividade: `Atividade ${index + 1}`,
  }));
  const buckets = buildBuckets(activities);
  assert.ok(buckets.size <= BUCKET_COUNT);
  assert.equal(Array.from(buckets.values()).flat().length, activities.length);
  assert.equal(bucketId("ATV-0001"), bucketId("ATV-0001"));
});

test("mescla campos diferentes e protege alteração simultânea no mesmo campo", () => {
  const base = { id: "ATV-A", progresso: 0, status: "Não iniciada", obs: "" };
  const currentEntry = {
    id: "ATV-A",
    activity: { ...base, progresso: 20 },
    position: 0,
    revision: 2,
  };

  const merged = mergeActivityChange(currentEntry, {
    id: "ATV-A",
    base,
    next: { ...base, obs: "Atualizada no campo" },
    position: 0,
  });
  assert.equal(merged.accepted, true);
  assert.equal(merged.entry.activity.progresso, 20);
  assert.equal(merged.entry.activity.obs, "Atualizada no campo");

  const conflict = mergeActivityChange(currentEntry, {
    id: "ATV-A",
    base,
    next: { ...base, progresso: 45 },
    position: 0,
  });
  assert.equal(conflict.accepted, false);
  assert.deepEqual(conflict.fields, ["progresso"]);
});

test("aceita edicoes rapidas do mesmo operador sem conflito no carimbo", () => {
  const base = {
    id: "ATV-RAPIDA",
    progresso: 0,
    status: "Nao iniciada",
    obs: "",
    ultimaAtualizacao: "2026-07-19T20:00:00.000Z",
  };
  const currentEntry = {
    id: base.id,
    activity: {
      ...base,
      progresso: 50,
      status: "Em andamento",
      ultimaAtualizacao: "2026-07-19T20:00:01.000Z",
    },
    position: 0,
    revision: 2,
  };
  const result = mergeActivityChange(currentEntry, {
    id: base.id,
    base,
    next: {
      ...base,
      progresso: 50,
      status: "Em andamento",
      obs: "Atualizada logo em seguida",
      ultimaAtualizacao: "2026-07-19T20:00:02.000Z",
    },
    position: 0,
  });

  assert.equal(result.accepted, true);
  assert.equal(result.entry.activity.progresso, 50);
  assert.equal(result.entry.activity.obs, "Atualizada logo em seguida");
  assert.equal(result.entry.activity.ultimaAtualizacao, "2026-07-19T20:00:02.000Z");
});

test("mesma sessao pode substituir rapidamente o mesmo campo", () => {
  const currentEntry = {
    id: "ATV-SESSAO",
    activity: { id: "ATV-SESSAO", progresso: 40, status: "Em andamento" },
    position: 0,
    revision: 3,
  };
  const result = applyExclusiveActivityChange(currentEntry, {
    id: "ATV-SESSAO",
    base: { id: "ATV-SESSAO", progresso: 20, status: "Em andamento" },
    next: { id: "ATV-SESSAO", progresso: 60, status: "Em andamento" },
    position: 0,
  });

  assert.equal(result.accepted, true);
  assert.equal(result.entry.activity.progresso, 60);
  assert.equal(result.entry.revision, 4);
});

test("modo exclusivo aceita exclusao mesmo depois de uma gravacao anterior", () => {
  const currentEntry = {
    id: "ATV-EXCLUIR",
    activity: { id: "ATV-EXCLUIR", progresso: 50, status: "Em andamento" },
    position: 0,
    revision: 4,
  };
  const result = applyExclusiveActivityChange(currentEntry, {
    id: "ATV-EXCLUIR",
    base: { id: "ATV-EXCLUIR", progresso: 0, status: "Nao iniciada" },
    next: null,
    deleted: true,
  });

  assert.equal(result.accepted, true);
  assert.equal(result.deleted, true);
});

test("administrador exclui atividade mesmo quando o avanco consolidado difere do bloco", () => {
  const currentEntry = {
    id: "ATV-AVANCO",
    activity: { id: "ATV-AVANCO", progresso: 0, status: "Nao iniciada" },
    position: 0,
    revision: 7,
  };
  const result = resolveActivityChange(currentEntry, {
    id: "ATV-AVANCO",
    base: { id: "ATV-AVANCO", progresso: 100, status: "Concluida" },
    next: null,
    deleted: true,
  }, false);

  assert.equal(result.accepted, true);
  assert.equal(result.deleted, true);
  assert.equal(result.revision, 8);
});

test("atividade criada pode ser excluida antes do retorno em tempo real", () => {
  const activity = { id: "ATV-NOVA", atividade: "Teste", progresso: 0 };
  let baseline = new Map();
  const creation = collectActivityChanges([activity], baseline);
  assert.equal(creation.length, 1);
  assert.equal(creation[0].deleted, false);

  baseline = confirmActivityChanges(baseline, creation);
  const deletion = collectActivityChanges([], baseline);
  assert.equal(deletion.length, 1);
  assert.equal(deletion[0].id, activity.id);
  assert.equal(deletion[0].deleted, true);
});

test("preserva instantâneos de progresso feitos por pessoas diferentes", () => {
  const base = { progressSnapshots: [], desbloqueioBaseName: "Base A" };
  const current = { ...base, progressSnapshots: [{ t: "10:00", value: 20 }] };
  const next = { ...base, progressSnapshots: [{ t: "10:05", value: 25 }] };
  const result = mergeSharedState(current, base, next);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.merged.progressSnapshots.length, 2);
});

test("preserva contatos cadastrados em computadores diferentes", () => {
  const base = { contatos: [] };
  const current = { contatos: [{ id: "C1", nome: "Contato A", area: "Elétrica" }] };
  const next = { contatos: [{ id: "C2", nome: "Contato B", area: "Operação" }] };
  const result = mergeSharedState(current, base, next);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.merged.contatos.length, 2);
});

test("preserva limpezas alteradas em computadores diferentes", () => {
  const base = [
    { id: "L1", status: "Concluida", progresso: 100, obs: "" },
    { id: "L2", status: "Programada", progresso: 0, obs: "" },
  ];
  const current = [base[0], { ...base[1], obs: "Atualizada no computador B" }];
  const next = [{ ...base[0], status: "Em andamento", progresso: 50 }, base[1]];
  const result = mergeKeyedCollection(current, base, next);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.value.find((item) => item.id === "L1").progresso, 50);
  assert.equal(result.value.find((item) => item.id === "L1").status, "Em andamento");
  assert.equal(result.value.find((item) => item.id === "L2").obs, "Atualizada no computador B");
});

test("protege o mesmo campo de limpeza alterado ao mesmo tempo", () => {
  const base = [{ id: "L1", status: "Concluida", progresso: 100 }];
  const current = [{ ...base[0], progresso: 80 }];
  const next = [{ ...base[0], progresso: 50 }];
  const result = mergeKeyedCollection(current, base, next);
  assert.deepEqual(result.conflicts, ["L1.progresso"]);
});
