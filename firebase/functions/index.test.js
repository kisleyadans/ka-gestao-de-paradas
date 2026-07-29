import assert from "node:assert/strict";
import test from "node:test";
import { testing } from "./index.js";

test("mescla áreas diferentes sem perder atualizações simultâneas", () => {
  const current = testing.normalizeBaseState({
    bloqueios: [{ id: "B1", status: "Aberto" }],
    limpezas: [{ id: "L1", status: "Pendente" }],
  });
  const base = testing.normalizeBaseState({
    bloqueios: [{ id: "B1", status: "Aberto" }],
    limpezas: [],
  });
  const next = testing.normalizeBaseState({
    bloqueios: [{ id: "B1", status: "Fechado" }],
    limpezas: [],
  });
  const result = testing.mergeSharedState(current, base, next);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.merged.bloqueios[0].status, "Fechado");
  assert.equal(result.merged.limpezas[0].status, "Pendente");
});

test("detecta conflito quando duas pessoas alteram o mesmo campo", () => {
  const base = { id: "A1", progresso: 10, obs: "" };
  const next = { ...base, progresso: 20 };
  const current = { ...base, progresso: 30 };
  const fields = testing.changedFields(base, next);
  assert.deepEqual(fields, ["progresso"]);
  assert.notDeepEqual(current.progresso, base.progresso);
});

test("preserva o nome da base de desbloqueios", () => {
  const state = testing.normalizeBaseState({
    desbloqueios: [],
    desbloqueioBaseName: "Parada Britagem 2026",
  });
  assert.equal(state.desbloqueioBaseName, "Parada Britagem 2026");
  assert.deepEqual(state.desbloqueios, []);
});
