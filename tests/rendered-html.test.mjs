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

  assert.match(panel, /<script[^>]*src="\/shared-sync\.js"[^>]*><\/script>/i);
  assert.match(panel, /<script id="pcm-initial-access-mode">/i);
  assert.match(panel, /<body(?![^>]*\badmin-mode\b)[^>]*>/i);
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
  assert.match(rules, /allow read: if true/);
  assert.match(rules, /hasAuditMetadata/);
  assert.match(sync, /kaClearSharedActivities/);
  assert.match(sync, /entries: \[\]/);
  assert.match(sync, /ka_free_activity_buckets/);
  assert.match(sync, /ka_operator_name/);
  assert.match(sync, /pcmGetContatos/);
  assert.match(sync, /Senha compartilhada do editor/i);
});
