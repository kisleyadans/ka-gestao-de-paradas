import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("renderiza o aplicativo K.A com o painel operacional", async () => {
  const [page, layout, shell] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../work/offline-shell.js", import.meta.url), "utf8"),
    access(new URL("../dist/server/index.js", import.meta.url)),
  ]);
  assert.match(layout, /K\.A - Gestão de Paradas/i);
  assert.match(page, /para360-operacional\.html/i);
  assert.match(page, /ka-activity-editor-open/i);
  assert.match(page, /isOpen && !activityEditorWasOpen/);
  assert.match(shell, /isOpen && !activityEditorWasOpen/);
  assert.match(page, /Salvar \+ nova/i);
  assert.match(page, /Execução e avanço/i);
  assert.match(layout, /Centro de controle/i);
});

test("inclui a sincronização gratuita e concorrente no painel publicado", async () => {
  const [panel, sync, rules] = await Promise.all([
    readFile(new URL("../public/para360-operacional.html", import.meta.url), "utf8"),
    readFile(new URL("../public/shared-sync.js", import.meta.url), "utf8"),
    readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
  ]);

  assert.match(panel, /<script[^>]*src="\/shared-sync\.js\?v=20260804-7"[^>]*><\/script>/i);
  assert.match(panel, /<script id="pcm-initial-access-mode">/i);
  assert.match(panel, /<script id="ka-blank-project-v2">/i);
  assert.match(panel, /ka_project_database_generation/);
  assert.match(panel, /<body(?![^>]*\badmin-mode\b)[^>]*>/i);
  assert.doesNotMatch(panel, /<html[^>]*data-ka-offline-ready/i);
  assert.match(panel, /let menuButton = document\.querySelector\("\.ka-menu-toggle"\)/);
  assert.match(panel, /body:not\(\.admin-mode\) \.toolbar\{display:none !important\}/i);
  assert.match(panel, /<section id="view-dashboard" class="view(?: active)?">/i);
  assert.match(panel, /<section id="view-avanco" class="view">/i);
  assert.match(panel, /<section id="view-contatos" class="view">/i);
  assert.match(sync, /signInWithEmailAndPassword/);
  assert.match(sync, /Vários computadores podem editar atividades diferentes/i);
  assert.match(sync, /runTransaction/);
  assert.match(sync, /editorSessionId/);
  assert.match(sync, /mergeActivityChange/);
  assert.match(sync, /mergeSharedState/);
  assert.match(sync, /baseState: merged\.merged/);
  assert.match(sync, /kaSaveSharedNow = flushSharedChanges/);
  assert.match(panel, /clearDesbloqueiosBase=async function/);
  assert.match(panel, /apagada e confirmada online/);
  assert.match(panel, /Sair Admin/);
  assert.match(rules, /isSharedEditor/);
  assert.match(panel, /id="avEquipamento"/);
  assert.match(panel, /id="avArea"/);
  assert.match(panel, /avPopularFiltroArea/);
  assert.match(panel, /String\(a\.equipamento\|\|''\)\.toLowerCase\(\)\.includes\(equipamento\)/);
  assert.match(rules, /allow read: if true/);
  assert.match(rules, /hasAuditMetadata/);
  assert.match(sync, /kaClearSharedActivities/);
  assert.match(sync, /entries: \[\]/);
  assert.match(sync, /ka_free_state_v2/);
  assert.match(sync, /ka_free_activity_buckets_v2/);
  assert.match(sync, /ka_operator_name/);
  assert.match(sync, /pcmGetContatos/);
  assert.match(sync, /Senha compartilhada do editor/i);
  assert.match(sync, /ka_discipline_progress_v2/);
  assert.match(sync, /kaLoginDiscipline/);
  assert.match(sync, /kaSaveDisciplineProgress/);
  assert.match(sync, /Firebase recusou a gravação · confira as regras publicadas/);
  assert.doesNotMatch(sync, /forceConsultationMode/);
  assert.match(panel, /Senha da disciplina/);
  assert.match(sync, /terminoReal: actualFinish/);
  assert.match(rules, /"terminoReal"/);
  assert.match(panel, /forecast&&forecast\.completed/);
  assert.match(panel, /projectionBasis:'Escopo conclu\\u00eddo/);
  assert.match(panel, /somente as atividades autorizadas/i);
  assert.match(rules, /match \/ka_discipline_progress_v2/);
  assert.match(rules, /editorEmail == request\.auth\.token\.email/);
  assert.match(panel, /class="avanco-item-inicio-input"/);
  assert.match(panel, /avUsarInicioPlanejado/);
  assert.match(panel, /class="avanco-item-termino-input"/);
  assert.match(panel, /avUsarTerminoPlanejado/);
  assert.match(panel, /Confirme o in\\u00edcio real/);
  assert.match(panel, /Confirme o t\\u00e9rmino real/);
  assert.doesNotMatch(panel, /if\(a\.progresso>0&&!a\.inicioReal\)a\.inicioReal=toLocalInput\(refNow\(\)\)/);
  assert.doesNotMatch(panel, /terminoReal\|\|toLocalInput\(refNow\(\)\)/);
  assert.doesNotMatch(panel, /if\(!a\.terminoReal\)a\.terminoReal=toLocalInput\(refNow\(\)\)/);
  assert.match(sync, /inicioReal: actualStart/);
  assert.match(sync, /completed && !actualFinish/);
  assert.doesNotMatch(sync, /activity\.terminoReal \|\| nowLocal/);
  assert.match(sync, /let pendingActivitySave = false/);
  assert.match(panel, /async function saveAdminProgressOnline/);
  assert.match(panel, /await window\.kaSaveDisciplineProgress\(a\.id/);
  assert.match(panel, /quickStatus=async function/);
  assert.match(panel, /quickProgress=async function/);
  assert.match(panel, /quickActualField=async function/);
  assert.match(sync, /const shouldSaveActivities = pendingActivitySave/);
  assert.match(sync, /shouldSaveActivities \? collectActivityChanges\(\) : \[\]/);
  assert.match(sync, /scheduleSave\(delay, name === "saveLocal"\)/);
  assert.match(rules, /"inicioReal"/);
  assert.doesNotMatch(panel, /areaList\.filter\(a=>validActivity\(a\)/);
  assert.match(panel, /areaList\.filter\(a=>parseDate\(a\.inicio\)&&parseDate\(a\.termino\)/);
  assert.doesNotMatch(panel, /operationalArea\.every\([^\n]+clampPct/);
  assert.match(panel, /k\.actualEnd\|\|k\.projectedEnd\|\|k\.plannedEnd/);
  assert.match(panel, /const useSnapshotHistory=!forecast\.completed/);
  assert.match(panel, /useSnapshotHistory\?\(window\.pcmProgressSnapshots\|\|\[\]\):\[\]/);
  assert.match(panel, /id="pcmDataQualityBanner" class="pcm-data-banner admin-hide"/);
  assert.match(panel, /b\.className='pcm-data-banner admin-hide '/);
});
