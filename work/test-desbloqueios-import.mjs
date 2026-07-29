import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../public/para360-operacional.html", import.meta.url), "utf8");
const start = html.indexOf("  function normalizeCsvHeader(value){");
const end = html.indexOf("  window.selectDesbloqueiosCSV=function(){", start);
assert.ok(start >= 0 && end > start, "funções de importação não encontradas");

const context = vm.createContext({});
new vm.Script(`${html.slice(start, end)}
globalThis.importTools={parseDesbloqueiosCSV,csvToDesbloqueios};`).runInContext(context);

const csv = [
  "sep=;",
  "ID;Ordem;Equipamento;Horário de desbloqueio;Status central;Impacto;Observação;Fase;Subestação;Nº CX",
  "NX-01;1;TR-100;20/07/2026 08:30;Desbloqueado;Sim;Equipe A;MOAGEM;SE-01;10",
  "NX-02;2;BR-200;2026-07-20T09:45;Bloqueio Exclusivo;Não;Equipe B;BRITAGEM;SE-02;11",
].join("\r\n");

const records = context.importTools.parseDesbloqueiosCSV(csv);
const imported = context.importTools.csvToDesbloqueios(records, "parada-julho.csv");

assert.equal(imported.length, 2);
assert.equal(imported[0].id, "NX-01");
assert.equal(imported[0].horarioDesbloqueio, "2026-07-20T08:30");
assert.equal(imported[0].statusCentral, "Desbloqueado");
assert.equal(imported[0].impacto, true);
assert.equal(imported[0].fase, "MOAGEM");
assert.equal(imported[1].statusCentral, "Bloqueio Exclusivo");
assert.equal(imported[1].impacto, false);

console.log("importação de desbloqueios validada");
