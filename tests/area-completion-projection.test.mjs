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
