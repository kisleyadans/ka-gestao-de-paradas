import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const panel = await readFile(new URL("../public/para360-operacional.html", import.meta.url), "utf8");
const functionStart = panel.indexOf("function sCurveForecast(list){");
const functionEnd = panel.indexOf("\n  window.pcmSCurveForecast=sCurveForecast;", functionStart);
assert.ok(functionStart >= 0 && functionEnd > functionStart, "sCurveForecast deve existir no painel");
const forecastSource = panel.slice(functionStart, functionEnd);
const curveStart = panel.lastIndexOf("curvePoints=function(list){");
const nextFunction = panel.indexOf("  async function saveAdminProgressOnline", curveStart);
const curveEnd = panel.lastIndexOf("  };", nextFunction) + 4;
assert.ok(curveStart >= 0 && curveEnd > curveStart, "curvePoints final deve existir no painel");
const curveSource = panel.slice(curveStart, curveEnd);
const areaConfigStart = panel.indexOf("function normalizeAreaKey(value){");
const areaConfigEnd = panel.indexOf("function updateFilterOptions(){", areaConfigStart);
assert.ok(areaConfigStart >= 0 && areaConfigEnd > areaConfigStart, "configuração dinâmica de circuitos deve existir");
const areaConfigSource = panel.slice(areaConfigStart, areaConfigEnd);

function runForecast(activities, now = "2026-08-01T18:00:00Z") {
  const context = {
    activities,
    result: null,
    refNow: () => new Date(now),
    validActivity: () => true,
    getEffectiveStatus: (activity) => activity.status,
    clampPct: (value) => Math.max(0, Math.min(100, Number(value || 0))),
    parseDate: (value) => value ? new Date(value) : null,
    scheduleInfo: (activity) => {
      const ini = new Date(activity.inicio);
      const fim = new Date(activity.termino);
      return { ini, fim, duration: (fim - ini) / 60000 };
    },
    Date,
    Math,
  };
  vm.runInNewContext(`${forecastSource}\nresult=sCurveForecast(activities);`, context);
  return context.result;
}

function runCurve(activities, snapshots, now = "2026-08-01T18:00:00Z") {
  const context = {
    activities,
    result: null,
    curvePoints: null,
    refNow: () => new Date(now),
    validActivity: () => true,
    getEffectiveStatus: (activity) => activity.status,
    clampPct: (value) => Math.max(0, Math.min(100, Number(value || 0))),
    parseDate: (value) => value ? new Date(value) : null,
    scheduleInfo: (activity) => {
      const ini = new Date(activity.inicio);
      const fim = new Date(activity.termino);
      return { ini, fim, duration: (fim - ini) / 60000 };
    },
    snapshotScope: () => ({ type: "areas", key: "Primario" }),
    window: { pcmProgressSnapshots: snapshots },
    $: () => null,
    Date,
    Math,
  };
  vm.runInNewContext(`${forecastSource}\n${curveSource}\nresult=curvePoints(activities);`, context);
  return context.result;
}

function runAreaConfigs(activities, includeDefaults = true) {
  const context = { activities, includeDefaults, result: null };
  vm.runInNewContext(`${areaConfigSource}\nresult=areaConfigsFromActivities(activities,includeDefaults);`, context);
  return context.result;
}

test("filtro e performance incluem todos os circuitos cadastrados", () => {
  const configs = runAreaConfigs([
    { area:"Usina" },
    { area:"Pátio de Minério" },
    { area:"Filtragem" },
    { area:"Concentração" },
  ]);

  assert.deepEqual(
    Array.from(configs, item=>item.label),
    ["Usina", "Britagem", "Primário", "Concentração", "Filtragem", "Pátio de Minério"],
  );
  assert.ok(configs.every(item=>item.color && item.icon));
});

test("variações de acento e caixa não duplicam o mesmo circuito", () => {
  const configs = runAreaConfigs([
    { area:"Primário" },
    { area:"PRIMARIO" },
    { area:"primário" },
    { area:"Pátio" },
    { area:"PATIO" },
  ], false);

  assert.equal(configs.filter(item=>item.key==="PRIMARIO").length, 1);
  assert.equal(configs.filter(item=>item.key==="PATIO").length, 1);
});

test("area concluida congela a projecao no termino real", () => {
  const result = runForecast([
    {
      inicio: "2026-08-01T08:00:00Z",
      termino: "2026-08-01T10:00:00Z",
      terminoReal: "2026-08-01T09:50:00Z",
      progresso: 100,
      status: "Conclu\u00edda",
    },
    {
      inicio: "2026-08-01T10:00:00Z",
      termino: "2026-08-01T12:00:00Z",
      terminoReal: "2026-08-01T11:45:00Z",
      progresso: 100,
      status: "Conclu\u00edda",
    },
  ]);

  assert.equal(result.completed, true);
  assert.equal(result.shiftMs, 0);
  assert.equal(result.projectedEnd.toISOString(), "2026-08-01T11:45:00.000Z");
  assert.notEqual(result.projectedEnd.toISOString(), "2026-08-01T18:00:00.000Z");
});

test("area aberta continua usando a projecao dinamica", () => {
  const result = runForecast([{ inicio:"2026-08-01T08:00:00Z", termino:"2026-08-01T12:00:00Z", progresso:50, status:"Em andamento" }]);
  assert.equal(result.completed, false);
});

test("curva concluida usa horarios reais e ignora o instante de digitacao", () => {
  const activities = [
    { inicio:"2026-08-01T08:00:00Z", termino:"2026-08-01T10:00:00Z", inicioReal:"2026-08-01T08:00:00Z", terminoReal:"2026-08-01T10:00:00Z", progresso:100, status:"Conclu\u00edda" },
    { inicio:"2026-08-01T10:00:00Z", termino:"2026-08-01T12:00:00Z", inicioReal:"2026-08-01T10:00:00Z", terminoReal:"2026-08-01T12:00:00Z", progresso:100, status:"Conclu\u00edda" },
  ];
  const points = runCurve(activities, [
    { t:"2026-08-01T11:50:00Z", areas:{ Primario:0 } },
    { t:"2026-08-01T12:00:00Z", areas:{ Primario:100 } },
  ]);

  assert.ok(points.length > 2);
  assert.ok(points.every((point) => point.real === point.plan));
});

test("atividades iniciais concluidas no plano permanecem aderentes durante a parada", () => {
  const activities = [
    { inicio:"2026-08-01T08:00:00Z", termino:"2026-08-01T09:00:00Z", inicioReal:"2026-08-01T08:00:00Z", terminoReal:"2026-08-01T09:00:00Z", progresso:100, status:"Conclu\u00edda" },
    { inicio:"2026-08-01T09:00:00Z", termino:"2026-08-01T10:00:00Z", inicioReal:"2026-08-01T09:00:00Z", terminoReal:"2026-08-01T10:00:00Z", progresso:100, status:"Conclu\u00edda" },
    { inicio:"2026-08-01T10:00:00Z", termino:"2026-08-01T11:00:00Z", progresso:0, status:"N\u00e3o iniciada" },
    { inicio:"2026-08-01T11:00:00Z", termino:"2026-08-01T12:00:00Z", progresso:0, status:"N\u00e3o iniciada" },
  ];
  const points = runCurve(activities, [
    // O apontamento foi feito depois da execucao. Ele nao pode apagar a
    // historia calculada pelos horarios reais das atividades concluidas.
    { t:"2026-08-01T10:15:00Z", areas:{ Primario:0 } },
    { t:"2026-08-01T10:30:00Z", areas:{ Primario:50 } },
  ], "2026-08-01T10:30:00Z");

  const completedWindow = points.filter((point) =>
    point.t >= new Date("2026-08-01T08:00:00Z") &&
    point.t <= new Date("2026-08-01T10:00:00Z")
  );

  assert.ok(completedWindow.length > 5);
  assert.ok(completedWindow.every((point) => point.real === point.plan));
});
