import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDocFromCache,
  getDocFromServer,
  getDocsFromCache,
  getDocsFromServer,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  BUCKET_COUNT,
  collectActivityChanges,
  confirmActivityChanges,
  mergeSharedState,
  bucketId,
  buildBuckets,
  clone,
  disciplineEmail,
  isAuthorizedDisciplineProgress,
  normalizeActivity,
  normalizeDiscipline,
  progressDisciplineId,
  progressGroupId,
  resolveActivityChange,
  same,
  sharedPart,
} from "./firebase-sync-core.mjs?v=20260809-secure-login-2";
import {
  ECONOMIC_FULL_REFRESH_MS,
  ECONOMIC_REFRESH_MS,
  billedQueryReads,
  shouldRunFullRefresh,
} from "./firebase-economic-policy.mjs?v=20260809-secure-login-2";

(function () {
  "use strict";

  const FIREBASE_CONFIG = {
    projectId: "pcm-gestaoparadas-kisley",
    appId: "1:80286517015:web:089f23c68d1e79c3a91952",
    databaseURL: "https://pcm-gestaoparadas-kisley-default-rtdb.firebaseio.com",
    storageBucket: "pcm-gestaoparadas-kisley.firebasestorage.app",
    apiKey: "AIzaSyAARULh-6IWVFwF5vGi8nBh1zNyGVYd6KY",
    authDomain: "pcm-gestaoparadas-kisley.firebaseapp.com",
    messagingSenderId: "80286517015",
  };
  const OPERATOR_EMAIL = "operador@ka-paradas.app";
  const SAVE_DELAY = 700;
  const FAST_SAVE_DELAY = 200;

  const app = initializeApp(FIREBASE_CONFIG);
  const auth = getAuth(app);
  const db = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
    ignoreUndefinedProperties: true,
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  // A base v2 começa vazia para a nova parada. As coleções antigas permanecem
  // intactas no Firestore como histórico e não são carregadas por esta versão.
  const stateRef = doc(db, "ka_free_state_v2", "current");
  const bucketsRef = collection(db, "ka_free_activity_buckets_v2");
  const legacyProgressRef = collection(db, "ka_discipline_progress_v2");
  const progressGroupsRef = collection(db, "ka_discipline_progress_groups_v3");
  const disciplineProgressRef = collection(db, "ka_discipline_progress_v4");
  const ECONOMIC_CACHE_KEY = "ka_economic_sync_v4";

  let operator = false;
  let disciplineEditor = false;
  let disciplineSession = null;
  let operatorName = "";
  let editorSessionId = "";
  let applyingRemote = false;
  let saving = false;
  let dirty = false;
  let pendingActivitySave = false;
  let saveTimer = null;
  let statusChip = null;
  let baselineActivities = new Map();
  let baselineSharedState = null;
  let stateLoaded = false;
  let bucketsLoaded = false;
  let progressLoaded = false;
  let remoteStateData = null;
  let remoteBuckets = new Map();
  let remoteProgress = new Map();
  let progressRevision = 0;
  let progressSchema = 0;
  let migratingProgress = false;
  let initializing = false;
  let pendingRemote = false;
  let lastRemoteSignature = "";
  let refreshTimer = null;
  let refreshing = false;
  let lastBucketTimestamp = null;
  let lastProgressTimestamp = null;
  let progressDocumentOwners = new Map();
  let readBudget = { serverReads: 0, queries: 0, cacheLoads: 0, lastRefreshAt: 0 };

  function ensureStatusUi() {
    const bar = document.getElementById("pcmAdminBar");
    if (bar && !document.getElementById("kaSharedStatus")) {
      statusChip = document.createElement("span");
      statusChip.id = "kaSharedStatus";
      statusChip.className = "ka-shared-status pending";
      statusChip.textContent = "Conectando à base gratuita...";
      const firstButton = bar.querySelector("button");
      bar.insertBefore(statusChip, firstButton);
    } else {
      statusChip = document.getElementById("kaSharedStatus");
    }

    if (bar && !document.getElementById("kaSharedRefresh")) {
      const refreshButton = document.createElement("button");
      refreshButton.id = "kaSharedRefresh";
      refreshButton.type = "button";
      refreshButton.className = "ka-shared-refresh";
      refreshButton.textContent = "Atualizar dados";
      refreshButton.title = "Buscar agora as alteracoes feitas em outros aparelhos";
      refreshButton.addEventListener("click", () => window.kaRefreshOnlineNow?.());
      const firstButton = bar.querySelector("button");
      bar.insertBefore(refreshButton, firstButton);
    }

    if (!document.getElementById("kaSharedSyncStyle")) {
      const style = document.createElement("style");
      style.id = "kaSharedSyncStyle";
      style.textContent = `
        .ka-shared-status {
          align-items:center;border:1px solid #dce7e1;border-radius:999px;display:inline-flex;
          font-size:10px;font-weight:850;gap:6px;letter-spacing:.01em;margin-right:2px;
          padding:6px 10px;text-transform:none;
        }
        .ka-shared-status::before {background:currentColor;border-radius:50%;content:"";height:6px;width:6px}
        .ka-shared-status.online {background:#e8f5ee;color:#007642;border-color:#c7e6d3}
        .ka-shared-status.pending {background:#fff6d6;color:#866500;border-color:#efdfb4}
        .ka-shared-status.error {background:#fbeeed;color:#a83426;border-color:#f1d3ce}
        .ka-shared-refresh {background:#fff;border:1px solid #cbd9d2;border-radius:999px;color:#176044;
          cursor:pointer;font-size:10px;font-weight:850;padding:6px 10px}
        .ka-shared-refresh:hover {background:#eef8f3}
        .ka-admin-login-overlay {align-items:center;background:rgba(7,25,18,.68);display:flex;inset:0;
          justify-content:center;padding:18px;position:fixed;z-index:2147483647}
        .ka-admin-login-dialog {background:#fff;border:1px solid #d9e6df;border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.28);
          color:#183b2c;max-width:420px;padding:24px;width:100%}
        .ka-admin-login-dialog h2 {font-size:20px;margin:0 0 6px}
        .ka-admin-login-dialog p {color:#52675d;font-size:13px;line-height:1.45;margin:0 0 18px}
        .ka-admin-login-dialog label {display:block;font-size:12px;font-weight:850;margin:12px 0 5px}
        .ka-admin-login-dialog input {background:#fff;border:1px solid #baccc2;border-radius:10px;box-sizing:border-box;
          color:#173a2a;font-size:16px;padding:11px 12px;width:100%}
        .ka-admin-login-dialog input:focus {border-color:#00834b;box-shadow:0 0 0 3px rgba(0,131,75,.13);outline:0}
        .ka-admin-login-error {color:#ad2e24!important;font-weight:750;margin:9px 0 0!important;min-height:18px}
        .ka-admin-login-actions {display:flex;gap:10px;justify-content:flex-end;margin-top:16px}
        .ka-admin-login-actions button {border:0;border-radius:10px;cursor:pointer;font-weight:850;padding:10px 16px}
        .ka-admin-login-cancel {background:#edf2ef;color:#345246}
        .ka-admin-login-submit {background:#007c47;color:#fff}
        body:not(.admin-mode) input:not([type="search"]):not(#fEquipamento):not(#fBloqSearch),
        body:not(.admin-mode) textarea,
        body:not(.admin-mode) select:not(#fDisciplina):not(#fArea):not(#fStatus) {pointer-events:none}
        @media(max-width:720px){.admin-bar .admin-state{flex-basis:100%}.ka-shared-status{margin-right:auto}}
        @media print{.ka-shared-status,.ka-shared-refresh{display:none!important}}
      `;
      document.head.appendChild(style);
    }
  }

  function requestOperatorCredentials(initialName = "") {
    ensureStatusUi();
    return new Promise((resolve) => {
      document.getElementById("kaAdminLoginOverlay")?.remove();
      const overlay = document.createElement("div");
      overlay.id = "kaAdminLoginOverlay";
      overlay.className = "ka-admin-login-overlay";
      overlay.innerHTML = `
        <div class="ka-admin-login-dialog" role="dialog" aria-modal="true" aria-labelledby="kaAdminLoginTitle">
          <form id="kaAdminLoginForm" autocomplete="off">
            <h2 id="kaAdminLoginTitle">Acesso administrativo</h2>
            <p>Informe seu nome para o histórico e a senha de administrador. A senha nunca é preenchida pelo aplicativo.</p>
            <label for="kaAdminOperatorName">Seu nome</label>
            <input id="kaAdminOperatorName" type="text" maxlength="60" autocomplete="off" required>
            <label for="kaAdminOperatorPassword">Senha</label>
            <input id="kaAdminOperatorPassword" type="password" autocomplete="off" required>
            <p id="kaAdminLoginError" class="ka-admin-login-error" role="alert"></p>
            <div class="ka-admin-login-actions">
              <button class="ka-admin-login-cancel" type="button">Cancelar</button>
              <button class="ka-admin-login-submit" type="submit">Entrar</button>
            </div>
          </form>
        </div>`;
      document.body.appendChild(overlay);

      const form = overlay.querySelector("#kaAdminLoginForm");
      const nameInput = overlay.querySelector("#kaAdminOperatorName");
      const passwordInput = overlay.querySelector("#kaAdminOperatorPassword");
      const errorMessage = overlay.querySelector("#kaAdminLoginError");
      const cancelButton = overlay.querySelector(".ka-admin-login-cancel");
      nameInput.value = String(initialName || "").slice(0, 60);
      passwordInput.name = `ka-admin-secret-${Date.now()}`;
      passwordInput.value = "";

      const finish = (credentials) => {
        document.removeEventListener("keydown", onKeyDown);
        overlay.remove();
        resolve(credentials);
      };
      const onKeyDown = (event) => {
        if (event.key === "Escape") finish(null);
      };
      document.addEventListener("keydown", onKeyDown);
      cancelButton.addEventListener("click", () => finish(null));
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) finish(null);
      });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const name = nameInput.value.trim();
        const password = passwordInput.value;
        if (!name) {
          errorMessage.textContent = "Informe seu nome para continuar.";
          nameInput.focus();
          return;
        }
        if (!password) {
          errorMessage.textContent = "Informe a senha de administrador.";
          passwordInput.focus();
          return;
        }
        finish({ name, password });
      });
      requestAnimationFrame(() => (nameInput.value ? passwordInput : nameInput).focus());
    });
  }

  function setStatus(message, tone) {
    ensureStatusUi();
    if (!statusChip) return;
    statusChip.textContent = message;
    statusChip.className = "ka-shared-status " + (tone || "pending");
  }

  function timeLabel(value) {
    const raw = value && typeof value.toDate === "function" ? value.toDate() : value;
    const date = raw ? new Date(raw) : new Date();
    if (Number.isNaN(date.getTime())) return "agora";
    return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  function createEditorSessionId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `ka-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function publishDisciplineSession() {
    window.kaDisciplineSession = disciplineSession ? { ...disciplineSession } : null;
    window.kaDisciplineEmail = disciplineEmail;
    if (typeof window.avRefreshAccess === "function") window.avRefreshAccess();
  }

  function savedEditorSessionId() {
    try { return sessionStorage.getItem("ka_editor_session") || ""; } catch { return ""; }
  }

  function renderEditorPresence() {
    if (operator) return;
    const button = document.getElementById("pcmAdminBtn");
    const updatedAt = remoteStateData?.updatedAt;
    setStatus(
      updatedAt ? `Online · consulta · ${timeLabel(updatedAt)}` : "Online · consulta pública",
      "online",
    );
    if (button) {
      button.dataset.editorBusy = "0";
      button.title = "Entrar com a conta compartilhada de edição";
    }
  }

  function buildState() {
    const state = typeof window.montarBancoSharePoint === "function"
      ? window.montarBancoSharePoint()
      : {
          schema: "ka_gestao_paradas_v2",
          activities: Array.isArray(window.activities) ? window.activities : [],
          bloqueios: Array.isArray(window.bloqueios) ? window.bloqueios : [],
          limpezas: Array.isArray(window.limpezas) ? window.limpezas : [],
          meetingPlan: Array.isArray(window.meetingPlan) ? window.meetingPlan : [],
          progressSnapshots: window.pcmProgressSnapshots || [],
          refTime: document.getElementById("refTime")?.value || "",
        };
    state.exportedAt = new Date().toISOString();
    state.contatos = typeof window.pcmGetContatos === "function" ? window.pcmGetContatos() : [];
    return state;
  }

  function backupStateLocally(state) {
    try {
      localStorage.setItem("painel_parada_atividades", JSON.stringify(state.activities || []));
      localStorage.setItem("painel_parada_bloqueios", JSON.stringify(state.bloqueios || []));
      localStorage.setItem("painel_parada_limpezas", JSON.stringify(state.limpezas || []));
      localStorage.setItem("meetingPlan", JSON.stringify(state.meetingPlan || []));
      localStorage.setItem("pcmProgressSnapshots", JSON.stringify(state.progressSnapshots || []));
      localStorage.setItem("pcm_contatos_v1", JSON.stringify(state.contatos || []));
      if (typeof state.desbloqueioBaseName === "string") {
        localStorage.setItem("painel_parada_desbloqueios_nome", state.desbloqueioBaseName);
      }
      localStorage.setItem("painel_parada_refTime", state.refTime || "");
      localStorage.setItem("lastSaved", state.exportedAt || new Date().toISOString());
    } catch (error) {
      console.warn("Backup local da base compartilhada falhou", error);
    }
  }

  function applySharedFields(state) {
    if (Array.isArray(state.bloqueios)) window.bloqueios = state.bloqueios.map((item) => ({ ...item }));
    if (Array.isArray(state.limpezas)) window.limpezas = state.limpezas.map((item) => ({ ...item }));
    if (Array.isArray(state.meetingPlan)) window.meetingPlan = clone(state.meetingPlan);
    if (Array.isArray(state.progressSnapshots)) window.pcmProgressSnapshots = clone(state.progressSnapshots);
    if (Array.isArray(state.desbloqueios) && typeof window.pcmSetDesbloqueios === "function") {
      window.pcmSetDesbloqueios(clone(state.desbloqueios), state.desbloqueioBaseName || "Base online compartilhada");
    }
    if (Array.isArray(state.contatos) && typeof window.pcmSetContatos === "function") {
      window.pcmSetContatos(clone(state.contatos));
    }
    const referenceTime = document.getElementById("refTime");
    if (referenceTime && typeof state.refTime === "string") referenceTime.value = state.refTime;
  }

  function refreshEmbeddedAndUi() {
    const state = buildState();
    const embedded = document.getElementById("dadosEmbutidos");
    if (embedded) embedded.textContent = JSON.stringify(state);
    backupStateLocally(state);
    const saveInfo = document.getElementById("saveInfo");
    if (saveInfo) saveInfo.textContent = `Base online sincronizada às ${timeLabel(state.exportedAt)}`;
    const saveToast = document.getElementById("saveToast");
    if (saveToast) saveToast.textContent = `☁ Firebase sincronizado: ${timeLabel(state.exportedAt)}`;
    if (typeof window.renderAll === "function") window.renderAll();
    if (typeof window.avRefreshAccess === "function") window.avRefreshAccess();
    if (typeof window.updateHeaderTimestamp === "function") window.updateHeaderTimestamp();
  }

  function applyFullState(state, versions) {
    if (!state || !Array.isArray(state.activities)) return;
    applyingRemote = true;
    try {
      window.activities = state.activities.map(normalizeActivity);
      applySharedFields(state);
      baselineActivities = new Map();
      window.activities.forEach((activity) => {
        baselineActivities.set(activity.id, {
          activity: clone(activity),
          revision: Number(versions.get(activity.id) || 1),
        });
      });
      baselineSharedState = sharedPart(state);
      refreshEmbeddedAndUi();
    } finally {
      applyingRemote = false;
    }
  }

  function assembleRemoteState() {
    if (!remoteStateData) return null;
    const expected = Number(remoteStateData.bucketCount || BUCKET_COUNT);
    if (remoteBuckets.size < expected) return null;
    const entries = [];
    remoteBuckets.forEach((bucket) => {
      (Array.isArray(bucket.entries) ? bucket.entries : []).forEach((entry) => entries.push(entry));
    });
    entries.sort((left, right) => Number(left.position || 0) - Number(right.position || 0));
    const versions = new Map();
    const activitiesFromBuckets = entries.map((entry) => {
      versions.set(entry.id, Number(entry.revision || 1));
      const activity = normalizeActivity(entry.activity);
      const progress = remoteProgress.get(String(activity.id));
      if (isAuthorizedDisciplineProgress(activity, progress)) {
        activity.progresso = Math.max(0, Math.min(100, Number(progress.progresso || 0)));
        activity.status = String(progress.status || activity.status || "Não iniciada");
        activity.obs = String(progress.obs ?? activity.obs ?? "");
        if (typeof progress.inicioReal === "string" && progress.inicioReal) {
          activity.inicioReal = progress.inicioReal;
        }
        if (typeof progress.terminoReal === "string") {
          activity.terminoReal = progress.terminoReal;
        }
        activity.autoProgress = false;
        activity.updatedBy = String(progress.updatedBy || "");
        activity.updatedAt = progress.updatedAt || activity.updatedAt;
      }
      return activity;
    });
    return {
      state: { ...sharedPart(remoteStateData.baseState), activities: activitiesFromBuckets },
      versions,
      signature: JSON.stringify({
        stateRevision: remoteStateData.revision || 0,
        buckets: Array.from(remoteBuckets.entries()).map(([id, value]) => [id, value.revision || 0]),
        progressRevision,
      }),
    };
  }

  function applyAvailableRemote() {
    if (!stateLoaded || !bucketsLoaded || !progressLoaded) return;
    if (!remoteStateData) {
      if (operator && !initializing) initializeRemote();
      else if (!operator) setStatus("Online · aguardando a primeira carga do operador", "pending");
      return;
    }
    const assembled = assembleRemoteState();
    if (!assembled) {
      setStatus("Preparando a base compartilhada...", "pending");
      return;
    }
    if (saving || dirty) {
      pendingRemote = true;
      return;
    }
    if (typeof window.kaAvancoHasPendingEdits === "function" && window.kaAvancoHasPendingEdits()) {
      pendingRemote = true;
      const count = typeof window.kaAvancoPendingCount === "function" ? window.kaAvancoPendingCount() : 1;
      setStatus(`Atualização online aguardando você finalizar ${count} edição(ões)`, "pending");
      return;
    }
    if (assembled.signature !== lastRemoteSignature) {
      applyFullState(assembled.state, assembled.versions);
      lastRemoteSignature = assembled.signature;
    }
    pendingRemote = false;
    const mode = operator
      ? `${operatorName} · administrador`
      : disciplineEditor
        ? `${disciplineSession?.name || "Disciplina"} · avanço`
        : "somente consulta";
    setStatus(`Online · ${mode} · ${timeLabel(remoteStateData.updatedAt)}`, "online");
  }

  async function initializeRemote() {
    if (initializing || !operator) return;
    initializing = true;
    setStatus("Criando a primeira base compartilhada...", "pending");
    try {
      const initial = buildState();
      const buckets = buildBuckets(initial.activities);
      await runTransaction(db, async (transaction) => {
        const current = await transaction.get(stateRef);
        if (current.exists()) return;
        transaction.set(stateRef, {
          baseState: sharedPart(initial),
          bucketCount: BUCKET_COUNT,
          progressSchema: 4,
          revision: 1,
          updatedAt: serverTimestamp(),
          updatedBy: operatorName,
          editorSessionId,
        });
        for (let index = 0; index < BUCKET_COUNT; index += 1) {
          const id = String(index).padStart(2, "0");
          transaction.set(doc(bucketsRef, id), {
            entries: buckets.get(id) || [],
            revision: 1,
            updatedAt: serverTimestamp(),
            updatedBy: operatorName,
            editorSessionId,
          });
        }
      });
      setTimeout(() => refreshFromServer({ forceFull: true }), 500);
    } catch (error) {
      console.error("Initial Firebase load failed", error);
      setStatus("Não foi possível criar a base online", "error");
    } finally {
      initializing = false;
    }
  }

  async function clearSharedActivities() {
    if (!operator) throw new Error("Acesso de operador necessÃ¡rio");
    if (saving) throw new Error("Aguarde a sincronizaÃ§Ã£o atual terminar");
    saving = true;
    dirty = false;
    setStatus("Apagando as atividades da base compartilhada...", "pending");
    try {
      await runTransaction(db, async (transaction) => {
        const ids = Array.from({ length: BUCKET_COUNT }, (_, index) => String(index).padStart(2, "0"));
        const [stateSnapshot, ...bucketSnapshots] = await Promise.all([
          transaction.get(stateRef),
          ...ids.map((id) => transaction.get(doc(bucketsRef, id))),
        ]);
        ids.forEach((id, index) => {
          const snapshot = bucketSnapshots[index];
          const data = snapshot.exists() ? snapshot.data() : {};
          transaction.set(doc(bucketsRef, id), {
            ...data,
            entries: [],
            revision: Number(data.revision || 0) + 1,
            updatedAt: serverTimestamp(),
            updatedBy: operatorName || "Operador PCM",
            editorSessionId,
          });
        });
        if (stateSnapshot.exists()) {
          const state = stateSnapshot.data();
          transaction.set(stateRef, {
            ...state,
            revision: Number(state.revision || 0) + 1,
            updatedAt: serverTimestamp(),
            updatedBy: operatorName || "Operador PCM",
            editorSessionId,
          });
        }
      });
      applyingRemote = true;
      try {
        window.activities = [];
        baselineActivities = new Map();
        localStorage.setItem("painel_parada_atividades", "[]");
        refreshEmbeddedAndUi();
      } finally {
        applyingRemote = false;
      }
      lastRemoteSignature = "";
      setStatus(`Online Â· ${operatorName} Â· base de atividades vazia`, "online");
      if (typeof window.showSaveToast === "function") window.showSaveToast("âœ“ Atividades removidas da base compartilhada");
      return true;
    } finally {
      saving = false;
      dirty = false;
      if (pendingRemote) applyAvailableRemote();
    }
  }

  async function saveActivityChanges(changes) {
    if (changes.length === 0) return { conflicts: [] };
    const grouped = new Map();
    changes.forEach((change) => {
      const id = bucketId(change.id);
      if (!grouped.has(id)) grouped.set(id, []);
      grouped.get(id).push(change);
    });
    const ids = Array.from(grouped.keys());
    const result = await runTransaction(db, async (transaction) => {
      const snapshots = await Promise.all(ids.map((id) => transaction.get(doc(bucketsRef, id))));
      const conflicts = [];
      ids.forEach((id, bucketIndex) => {
        const snapshot = snapshots[bucketIndex];
        const data = snapshot.exists() ? snapshot.data() : { entries: [], revision: 0 };
        const entries = Array.isArray(data.entries) ? clone(data.entries) : [];
        let changed = false;
        grouped.get(id).forEach((change) => {
          const index = entries.findIndex((entry) => entry.id === change.id);
          const currentEntry = index >= 0 ? entries[index] : null;
          // A second write from this same tab may arrive before the realtime
          // listener refreshes the local baseline. In that case, the newest
          // change from the same session wins. Other sessions still use the
          // field-level merge and retain genuine conflict protection.
          const sameEditorSession = Boolean(
            editorSessionId && data.editorSessionId === editorSessionId,
          );
          const result = resolveActivityChange(currentEntry, change, sameEditorSession);
          if (!result.accepted) {
            conflicts.push({ id: change.id, fields: result.fields || [], current: result.current || currentEntry });
            return;
          }
          if (result.deleted) {
            if (index >= 0) {
              entries.splice(index, 1);
              changed = true;
            }
          } else if (index >= 0) {
            entries[index] = result.entry;
            changed = true;
          } else {
            entries.push(result.entry);
            changed = true;
          }
        });
        if (changed) {
          transaction.set(doc(bucketsRef, id), {
            entries,
            revision: Number(data.revision || 0) + 1,
            updatedAt: serverTimestamp(),
            updatedBy: operatorName,
            editorSessionId,
          });
        }
      });
      return { conflicts };
    });
    // O documento de progresso e secundario. A atividade ja foi removida do
    // bloco principal; se a limpeza deste historico falhar, isso nao pode
    // restaurar nem bloquear a exclusao confirmada pelo administrador.
    const deletedChanges = changes.filter((change) => change.deleted);
    if (deletedChanges.length > 0) {
      await Promise.allSettled(deletedChanges.map(async (change) => {
        await deleteDoc(doc(legacyProgressRef, encodeURIComponent(String(change.id))));
        if (progressSchema < 3) return;
        const discipline = change.base?.disciplina || "";
        const key = normalizeDiscipline(discipline);
        const groupedDoc = progressSchema >= 4
          ? doc(disciplineProgressRef, progressDisciplineId(key))
          : doc(progressGroupsRef, progressGroupId(key, change.id));
        await runTransaction(db, async (transaction) => {
          const snapshot = await transaction.get(groupedDoc);
          if (!snapshot.exists()) return;
          const current = snapshot.data();
          const entries = (Array.isArray(current.entries) ? current.entries : [])
            .filter((entry) => String(entry?.activityId) !== String(change.id));
          if (entries.length === 0) transaction.delete(groupedDoc);
          else transaction.set(groupedDoc, {
            ...current,
            entries,
            updatedAt: serverTimestamp(),
            updatedBy: operatorName,
            editorSessionId,
          });
        });
      }));
    }
    return result;
  }

  async function saveSharedChanges(currentShared) {
    if (baselineSharedState && same(baselineSharedState, currentShared)) return { conflicts: [] };
    return runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(stateRef);
      if (!snapshot.exists()) throw new Error("A base online ainda não foi criada");
      const data = snapshot.data();
      const onlineShared = sharedPart(data.baseState);
      const sameEditorSession = Boolean(
        editorSessionId && data.editorSessionId === editorSessionId,
      );
      const merged = sameEditorSession
        ? { merged: currentShared, conflicts: [] }
        : mergeSharedState(
            onlineShared,
            baselineSharedState || onlineShared,
            currentShared,
          );
      if (merged.conflicts.length > 0) return { conflicts: merged.conflicts };
      transaction.set(stateRef, {
        ...data,
        baseState: merged.merged,
        bucketCount: BUCKET_COUNT,
        revision: Number(data.revision || 0) + 1,
        updatedAt: serverTimestamp(),
        updatedBy: operatorName,
        editorSessionId,
      });
      return { conflicts: merged.conflicts };
    });
  }

  async function saveRemote() {
    if (!operator || applyingRemote) return;
    if (saving) {
      dirty = true;
      return;
    }
    saving = true;
    dirty = false;
    const shouldSaveActivities = pendingActivitySave;
    pendingActivitySave = false;
    setStatus("Sincronizando alterações...", "pending");
    let saveFailed = false;
    try {
      const changes = shouldSaveActivities
        ? collectActivityChanges(window.activities, baselineActivities)
        : [];
      const currentShared = sharedPart(buildState());
      const hadSharedChanges = !baselineSharedState || !same(baselineSharedState, currentShared);
      const hadChanges = changes.length > 0 || hadSharedChanges;
      const activityResult = shouldSaveActivities
        ? await saveActivityChanges(changes)
        : { conflicts: [] };
      if (shouldSaveActivities && activityResult.conflicts.length === 0) {
        baselineActivities = confirmActivityChanges(baselineActivities, changes);
      }
      const sharedResult = await saveSharedChanges(currentShared);
      const conflicts = [...activityResult.conflicts, ...sharedResult.conflicts];
      if (conflicts.length > 0) {
        setStatus("Online · conflito identificado; a versão mais recente foi preservada", "error");
        if (typeof window.showSaveToast === "function") {
          window.showSaveToast("⚠ Outra pessoa alterou o mesmo item. A versão online mais recente foi preservada.");
        }
      } else {
        baselineSharedState = clone(currentShared);
        setStatus(`Online · ${operatorName} · salvo às ${timeLabel()}`, "online");
        const saveInfo = document.getElementById("saveInfo");
        if (saveInfo) saveInfo.textContent = `Base online atualizada às ${timeLabel()}`;
        if (hadChanges && typeof window.showSaveToast === "function") window.showSaveToast("✓ Alteração publicada para todos");
      }
    } catch (error) {
      saveFailed = true;
      console.error("Shared state save failed", error);
      dirty = false;
      const denied = error?.code === "permission-denied";
      if (denied) {
        setStatus("Firebase recusou a gravação · confira as regras publicadas", "error");
      } else {
        setStatus("Falha ao sincronizar · sua sessão continua ativa", "error");
      }
    } finally {
      saving = false;
      if (!dirty && pendingRemote) applyAvailableRemote();
      if (dirty && !saveFailed) scheduleSave(120);
    }
    return !saveFailed;
  }

  function scheduleSave(delay, includeActivities) {
    if (!operator || applyingRemote) return;
    if (includeActivities === true) pendingActivitySave = true;
    dirty = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveRemote();
    }, typeof delay === "number" ? delay : SAVE_DELAY);
  }

  async function flushSharedChanges() {
    if (!operator) throw new Error("Acesso de edição necessário");
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const deadline = Date.now() + 10000;
    while (saving && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (saving) throw new Error("A sincronização anterior ainda não terminou");
    dirty = true;
    const saved = await saveRemote();
    if (!saved || dirty) throw new Error("A alteração não foi confirmada pelo Firebase. Sua sessão continua ativa; verifique as regras e a conexão.");
    return true;
  }

  async function saveDisciplineProgress(activityId, patch) {
    const activity = (Array.isArray(window.activities) ? window.activities : [])
      .find((item) => String(item.id) === String(activityId));
    if (!activity) throw new Error("Atividade não encontrada na base online");
    const expectedKey = normalizeDiscipline(activity.disciplina);
    const expectedEmail = disciplineEmail(activity.disciplina);
    if (!operator) {
      if (!disciplineEditor || !disciplineSession) throw new Error("Entre com a senha da sua disciplina");
      if (disciplineSession.key !== expectedKey || disciplineSession.email !== expectedEmail) {
        throw new Error("Esta atividade pertence a outra disciplina");
      }
    }
    const progress = Math.max(0, Math.min(100, Number(patch?.progresso || 0)));
    const status = String(patch?.status || "Não iniciada");
    const observation = String(patch?.obs || "").slice(0, 4000);
    const updater = String(patch?.updatedBy || disciplineSession?.name || operatorName || "Editor").slice(0, 80);
    const needsActualStart = progress > 0 || status === "Em andamento" || status === "Conclu\u00edda";
    const actualStart = needsActualStart
      ? String(patch?.inicioReal || activity.inicioReal || activity.inicio || "").slice(0, 40)
      : String(patch?.inicioReal || activity.inicioReal || "").slice(0, 40);
    const completed = progress >= 100 || status === "Conclu\u00edda";
    const actualFinish = completed
      ? String(patch?.terminoReal || activity.terminoReal || activity.termino || "").slice(0, 40) : "";
    if (actualStart && actualFinish && new Date(actualFinish).getTime() < new Date(actualStart).getTime()) {
      throw new Error("O t\u00e9rmino real n\u00e3o pode ser anterior ao in\u00edcio real");
    }
    const useGroupedProgress = progressSchema >= 3;
    const progressDoc = progressSchema >= 4
      ? doc(disciplineProgressRef, progressDisciplineId(expectedKey))
      : useGroupedProgress
        ? doc(progressGroupsRef, progressGroupId(expectedKey, activity.id))
        : doc(legacyProgressRef, encodeURIComponent(String(activity.id)));
    const progressValue = {
      activityId: String(activity.id),
      disciplineKey: expectedKey,
      disciplineName: String(activity.disciplina || ""),
      editorEmail: expectedEmail,
      progresso: progress,
      status,
      obs: observation,
      updatedBy: updater,
      inicioReal: actualStart,
      editorSessionId: editorSessionId || createEditorSessionId(),
      terminoReal: actualFinish,
      updatedAt: new Date().toISOString(),
    };
    setStatus(`Salvando avanço de ${activity.disciplina}...`, "pending");
    try {
      await runTransaction(db, async (transaction) => {
        if (useGroupedProgress) {
          const snapshot = await transaction.get(progressDoc);
          const current = snapshot.exists() ? snapshot.data() : {};
          const entries = new Map((Array.isArray(current.entries) ? current.entries : [])
            .filter((entry) => entry?.activityId)
            .map((entry) => [String(entry.activityId), entry]));
          entries.set(String(activity.id), progressValue);
          transaction.set(progressDoc, {
            disciplineKey: expectedKey,
            disciplineName: String(activity.disciplina || ""),
            editorEmail: expectedEmail,
            entries: Array.from(entries.values()),
            updatedBy: updater,
            editorSessionId: progressValue.editorSessionId,
            updatedAt: serverTimestamp(),
          });
        } else {
          transaction.set(progressDoc, { ...progressValue, updatedAt: serverTimestamp() });
        }
      });
      remoteProgress.set(String(activity.id), progressValue);
      progressRevision += 1;
      lastRemoteSignature = "";
      activity.progresso = progress;
      activity.status = status;
      activity.obs = observation;
      activity.autoProgress = false;
      activity.inicioReal = actualStart;
      activity.updatedBy = updater;
      setStatus(`Online · ${updater} · avanço salvo às ${timeLabel()}`, "online");
      activity.terminoReal = actualFinish;
      return true;
    } catch (error) {
      console.error("Discipline progress save failed", error);
      setStatus(
        error?.code === "permission-denied"
          ? "Firebase recusou o avanço · publique as regras atualizadas"
          : "Falha ao salvar avanço · sessão mantida",
        "error",
      );
      throw new Error("O avanço não foi confirmado online. A sessão continua aberta; confira a conexão e as regras do Firebase.");
    }
  }

  function wrapSaver(name, delay) {
    const original = window[name];
    if (typeof original !== "function" || original.__kaSharedWrapped) return;
    const wrapped = function () {
      const result = original.apply(this, arguments);
      if (result && typeof result.then === "function") {
        result.then(() => { if (!applyingRemote) scheduleSave(delay, name === "saveLocal"); });
      } else if (!applyingRemote) scheduleSave(delay, name === "saveLocal");
      return result;
    };
    wrapped.__kaSharedWrapped = true;
    window[name] = wrapped;
  }

  function installSaveHooks() {
    [
      "saveLocal",
      "saveMeetingPlan",
      "saveBloqueiosLocal",
      "quickDesbloqueioStatus",
      "quickDesbloqueioImpacto",
    ].forEach((name) => wrapSaver(name));
    [
      "saveLimpezasLocal",
      "saveLimpeza",
      "deleteLimpeza",
      "quickLimpezaStatus",
      "quickLimpezaProgress",
    ].forEach((name) => wrapSaver(name, FAST_SAVE_DELAY));
  }

  async function login() {
    let rememberedName = "";
    try { rememberedName = localStorage.getItem("ka_operator_name") || ""; } catch {}
    const credentials = await requestOperatorCredentials(rememberedName);
    if (!credentials) return;
    const { name, password } = credentials;
    setStatus("Validando acesso de edição...", "pending");
    try {
      await setPersistence(auth, browserLocalPersistence);
      await signInWithEmailAndPassword(auth, OPERATOR_EMAIL, password);
      const cleanName = name.trim().slice(0, 60);
      editorSessionId = createEditorSessionId();
      sessionStorage.setItem("ka_editor_session", editorSessionId);
      localStorage.setItem("ka_operator_name", cleanName);
      sessionStorage.setItem("pcm_admin", "1");
      window.alert(`Acesso liberado para ${cleanName}. Vários computadores podem editar atividades diferentes ao mesmo tempo.`);
      window.location.reload();
    } catch (error) {
      console.error("Operator login failed", error);
      try { await signOut(auth); } catch {}
      try {
        sessionStorage.removeItem("ka_editor_session");
        sessionStorage.setItem("pcm_admin", "0");
      } catch {}
      setStatus("Senha incorreta ou acesso indisponível", "error");
      window.alert("Senha incorreta. Verifique e tente novamente.");
    }
  }

  async function loginDiscipline(discipline, password, name) {
    const cleanDiscipline = String(discipline || "").trim();
    const email = disciplineEmail(cleanDiscipline);
    const cleanName = String(name || "").trim().slice(0, 80);
    if (!email) throw new Error("Selecione uma disciplina");
    if (!cleanName) throw new Error("Informe seu nome");
    if (!password) throw new Error("Informe a senha da disciplina");
    setStatus(`Validando acesso de ${cleanDiscipline}...`, "pending");
    try {
      await setPersistence(auth, browserLocalPersistence);
      const credential = await signInWithEmailAndPassword(auth, email, password);
      if (credential.user.email !== email) throw new Error("Conta incompatível com a disciplina");
      editorSessionId = createEditorSessionId();
      disciplineSession = {
        discipline: cleanDiscipline,
        key: normalizeDiscipline(cleanDiscipline),
        email,
        name: cleanName,
      };
      disciplineEditor = true;
      operator = false;
      try {
        sessionStorage.setItem("ka_editor_session", editorSessionId);
        localStorage.setItem("ka_discipline_session", JSON.stringify(disciplineSession));
        sessionStorage.setItem("pcm_admin", "0");
        localStorage.setItem("ka_discipline_name", cleanName);
      } catch {}
      publishDisciplineSession();
      setStatus(`Online · ${cleanName} · ${cleanDiscipline}`, "online");
      return { ...disciplineSession };
    } catch (error) {
      console.error("Discipline login failed", error);
      setStatus("Senha incorreta ou conta da disciplina não cadastrada", "error");
      throw new Error(`Não foi possível entrar em ${cleanDiscipline}. Confira a senha e o cadastro ${email} no Firebase.`);
    }
  }

  async function logout() {
    try {
      await signOut(auth);
    } finally {
      editorSessionId = "";
      try {
        sessionStorage.removeItem("ka_editor_session");
        localStorage.removeItem("ka_discipline_session");
        sessionStorage.setItem("pcm_admin", "0");
      } catch {}
      window.location.reload();
    }
  }

  function waitForAuth() {
    return new Promise((resolve) => {
      let unsubscribe = () => {};
      unsubscribe = onAuthStateChanged(auth, (user) => {
        unsubscribe();
        resolve(user);
      }, () => resolve(null));
    });
  }

  function timestampAfter(left, right) {
    if (!left) return false;
    if (!right) return true;
    if (Number(left.seconds || 0) !== Number(right.seconds || 0)) {
      return Number(left.seconds || 0) > Number(right.seconds || 0);
    }
    return Number(left.nanoseconds || 0) > Number(right.nanoseconds || 0);
  }

  function newestTimestamp(current, value) {
    return timestampAfter(value, current) ? value : current;
  }

  function progressReference(schema) {
    if (schema >= 4) return disciplineProgressRef;
    if (schema >= 3) return progressGroupsRef;
    return legacyProgressRef;
  }

  function mergeProgressSnapshot(snapshot, schema, replace) {
    if (replace) {
      remoteProgress = new Map();
      progressDocumentOwners = new Map();
    }
    snapshot.forEach((item) => {
      const owner = `${schema}:${item.id}`;
      Array.from(progressDocumentOwners.entries()).forEach(([activityId, documentOwner]) => {
        if (documentOwner === owner) {
          progressDocumentOwners.delete(activityId);
          remoteProgress.delete(activityId);
        }
      });
      const values = schema >= 3
        ? (Array.isArray(item.data()?.entries) ? item.data().entries : [])
        : [item.data()];
      values.forEach((data) => {
        if (!data?.activityId) return;
        const activityId = String(data.activityId);
        remoteProgress.set(activityId, data);
        progressDocumentOwners.set(activityId, owner);
      });
      lastProgressTimestamp = newestTimestamp(lastProgressTimestamp, item.data()?.updatedAt);
    });
    progressRevision += 1;
  }

  function mergeBucketSnapshot(snapshot, replace) {
    if (replace) remoteBuckets = new Map();
    snapshot.forEach((item) => {
      remoteBuckets.set(item.id, item.data());
      lastBucketTimestamp = newestTimestamp(lastBucketTimestamp, item.data()?.updatedAt);
    });
  }

  function progressValues(snapshot, schema) {
    const values = [];
    snapshot.forEach((item) => {
      if (schema >= 3) values.push(...(Array.isArray(item.data()?.entries) ? item.data().entries : []));
      else values.push(item.data());
    });
    return values.filter((value) => value?.activityId && value?.disciplineKey);
  }

  async function migrateProgressToV4(snapshot, sourceSchema) {
    if (!operator || migratingProgress || Number(remoteStateData?.progressSchema || 2) >= 4) return;
    migratingProgress = true;
    setStatus("Otimizando os avancos para reduzir leituras...", "pending");
    try {
      const grouped = new Map();
      progressValues(snapshot, sourceSchema).forEach((value) => {
        if (!value?.activityId || !value?.disciplineKey) return;
        const id = progressDisciplineId(value.disciplineKey);
        if (!grouped.has(id)) grouped.set(id, []);
        grouped.get(id).push(value);
      });
      await runTransaction(db, async (transaction) => {
        const stateSnapshot = await transaction.get(stateRef);
        if (!stateSnapshot.exists()) throw new Error("A base online ainda nao foi criada");
        const stateData = stateSnapshot.data();
        if (Number(stateData.progressSchema || 2) >= 4) return;
        const groupIds = Array.from(grouped.keys());
        const groupSnapshots = await Promise.all(groupIds.map((id) => transaction.get(doc(disciplineProgressRef, id))));
        groupIds.forEach((id, index) => {
          const current = groupSnapshots[index].exists() ? groupSnapshots[index].data() : {};
          const entries = new Map((Array.isArray(current.entries) ? current.entries : [])
            .filter((entry) => entry?.activityId)
            .map((entry) => [String(entry.activityId), entry]));
          grouped.get(id).forEach((entry) => entries.set(String(entry.activityId), entry));
          const first = grouped.get(id)[0] || {};
          transaction.set(doc(disciplineProgressRef, id), {
            disciplineKey: String(first.disciplineKey || current.disciplineKey || ""),
            disciplineName: String(first.disciplineName || current.disciplineName || ""),
            editorEmail: String(first.editorEmail || current.editorEmail || ""),
            entries: Array.from(entries.values()),
            updatedAt: serverTimestamp(),
            updatedBy: operatorName || "Migracao automatica",
            editorSessionId,
          });
        });
        transaction.set(stateRef, {
          ...stateData,
          progressSchema: 4,
          revision: Number(stateData.revision || 0) + 1,
          updatedAt: serverTimestamp(),
          updatedBy: operatorName || "Migracao automatica",
          editorSessionId,
        });
      });
      setStatus("Avancos consolidados - modo economico ativado", "online");
      setTimeout(() => refreshFromServer({ forceFull: true }), 500);
    } catch (error) {
      console.error("Progress migration failed", error);
      setStatus("Modo economico aguardando nova tentativa - dados atuais preservados", "error");
      setTimeout(() => {
        if (operator && Number(remoteStateData?.progressSchema || 2) < 4) {
          migrateProgressToV4(snapshot, sourceSchema);
        }
      }, 30000);
    } finally {
      migratingProgress = false;
    }
  }

  function cacheMetadata() {
    try { return JSON.parse(localStorage.getItem(ECONOMIC_CACHE_KEY) || "null") || {}; } catch { return {}; }
  }

  function saveCacheMetadata(fullRefresh) {
    try {
      const previous = cacheMetadata();
      localStorage.setItem(ECONOMIC_CACHE_KEY, JSON.stringify({
        fullCompletedAt: fullRefresh ? Date.now() : Number(previous.fullCompletedAt || 0),
        bucketUpdatedAtMs: lastBucketTimestamp?.toMillis?.() || 0,
        progressUpdatedAtMs: lastProgressTimestamp?.toMillis?.() || 0,
        progressSchema,
      }));
    } catch {}
  }

  function recordDocumentRead() {
    readBudget.serverReads += 1;
    readBudget.queries += 1;
  }

  function recordQueryReads(snapshot) {
    readBudget.serverReads += billedQueryReads(snapshot?.size || 0);
    readBudget.queries += 1;
  }

  function publishReadBudget() {
    readBudget.lastRefreshAt = Date.now();
    window.kaFirebaseReadBudget = { ...readBudget };
  }

  async function loadCachedData() {
    try {
      const stateSnapshot = await getDocFromCache(stateRef);
      remoteStateData = stateSnapshot.exists() ? stateSnapshot.data() : null;
      stateLoaded = true;
    } catch {
      stateLoaded = true;
    }
    progressSchema = Number(remoteStateData?.progressSchema || 4);
    try {
      const [bucketSnapshot, progressSnapshot] = await Promise.all([
        getDocsFromCache(bucketsRef),
        getDocsFromCache(progressReference(progressSchema)),
      ]);
      mergeBucketSnapshot(bucketSnapshot, true);
      mergeProgressSnapshot(progressSnapshot, progressSchema, true);
      readBudget.cacheLoads += bucketSnapshot.size + progressSnapshot.size + (remoteStateData ? 1 : 0);
    } catch (error) {
      console.warn("Cache local ainda nao esta disponivel", error);
    }
    bucketsLoaded = true;
    progressLoaded = true;
    applyAvailableRemote();
  }

  function incrementalReference(reference, timestamp) {
    return timestamp ? query(reference, where("updatedAt", ">", timestamp)) : reference;
  }

  async function refreshFromServer(options = {}) {
    if (refreshing || (document.visibilityState === "hidden" && !options.manual)) return false;
    refreshing = true;
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    if (options.manual) setStatus("Atualizando os dados online...", "pending");
    try {
      const previousSchema = progressSchema;
      const stateSnapshot = await getDocFromServer(stateRef);
      recordDocumentRead();
      remoteStateData = stateSnapshot.exists() ? stateSnapshot.data() : null;
      stateLoaded = true;
      progressSchema = Number(remoteStateData?.progressSchema || 4);

      const metadata = cacheMetadata();
      if (!lastBucketTimestamp && metadata.bucketUpdatedAtMs) {
        lastBucketTimestamp = Timestamp.fromMillis(Math.max(0, Number(metadata.bucketUpdatedAtMs) - 1));
      }
      if (!lastProgressTimestamp && metadata.progressUpdatedAtMs && previousSchema === progressSchema) {
        lastProgressTimestamp = Timestamp.fromMillis(Math.max(0, Number(metadata.progressUpdatedAtMs) - 1));
      }
      const expectedBuckets = Number(remoteStateData?.bucketCount || BUCKET_COUNT);
      const forceFull = Boolean(options.forceFull)
        || shouldRunFullRefresh(metadata.fullCompletedAt)
        || remoteBuckets.size < expectedBuckets;
      const fullProgress = forceFull || previousSchema !== progressSchema || !lastProgressTimestamp
        || (operator && progressSchema < 4);
      const bucketRequest = forceFull
        ? bucketsRef
        : incrementalReference(bucketsRef, lastBucketTimestamp);
      const progressRef = progressReference(progressSchema);
      const progressRequest = fullProgress
        ? progressRef
        : incrementalReference(progressRef, lastProgressTimestamp);
      const [bucketSnapshot, progressSnapshot] = await Promise.all([
        getDocsFromServer(bucketRequest),
        getDocsFromServer(progressRequest),
      ]);
      recordQueryReads(bucketSnapshot);
      recordQueryReads(progressSnapshot);
      mergeBucketSnapshot(bucketSnapshot, forceFull);
      mergeProgressSnapshot(progressSnapshot, progressSchema, fullProgress);
      bucketsLoaded = true;
      progressLoaded = true;
      lastRemoteSignature = "";
      saveCacheMetadata(forceFull);
      publishReadBudget();
      applyAvailableRemote();
      if (progressSchema < 4 && operator) migrateProgressToV4(progressSnapshot, progressSchema);
      return true;
    } catch (error) {
      console.error("Economic Firebase refresh failed", error);
      setStatus("Dados locais preservados - atualizacao online indisponivel", "error");
      return false;
    } finally {
      refreshing = false;
      scheduleEconomicRefresh();
    }
  }

  function scheduleEconomicRefresh(delay = ECONOMIC_REFRESH_MS) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
    if (document.visibilityState === "hidden") return;
    refreshTimer = setTimeout(() => refreshFromServer(), delay);
  }

  function startEconomicSync() {
    loadCachedData().finally(() => refreshFromServer());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = null;
        return;
      }
      const elapsed = Date.now() - Number(readBudget.lastRefreshAt || 0);
      if (elapsed >= ECONOMIC_REFRESH_MS) refreshFromServer();
      else scheduleEconomicRefresh(ECONOMIC_REFRESH_MS - elapsed);
    });
    window.addEventListener("online", () => refreshFromServer());
    window.kaRefreshOnlineNow = () => refreshFromServer({ manual: true });
    renderEditorPresence();
  }

  async function boot() {
    ensureStatusUi();
    window.pcmLogin = login;
    window.pcmLogout = logout;
    const adminButton = document.getElementById("pcmAdminBtn");
    if (adminButton) {
      adminButton.dataset.onlineReady = "1";
      adminButton.disabled = false;
      adminButton.removeAttribute("aria-busy");
      adminButton.title = "Entrar com a conta segura de edição";
    }
    window.kaClearSharedActivities = clearSharedActivities;
    window.kaSaveSharedNow = flushSharedChanges;
    window.kaScheduleSharedSave = scheduleSave;
    window.kaLoginDiscipline = loginDiscipline;
    window.kaLogoutDiscipline = logout;
    window.kaSaveDisciplineProgress = saveDisciplineProgress;
    window.kaReleasePendingRemote = applyAvailableRemote;
    window.kaDisciplineEmail = disciplineEmail;
    try { await setPersistence(auth, browserLocalPersistence); } catch {}
    const user = await waitForAuth();
    operator = user?.email === OPERATOR_EMAIL;
    if (user && !operator) {
      try {
        const saved = JSON.parse(localStorage.getItem("ka_discipline_session") || "null");
        if (saved?.email === user.email) {
          disciplineSession = saved;
          disciplineEditor = true;
        }
      } catch {}
    }
    try { operatorName = operator ? (localStorage.getItem("ka_operator_name") || "Operador PCM") : ""; } catch {
      operatorName = operator ? "Operador PCM" : "";
    }

    if (operator) {
      editorSessionId = savedEditorSessionId();
      if (!editorSessionId) {
        editorSessionId = createEditorSessionId();
        try { sessionStorage.setItem("ka_editor_session", editorSessionId); } catch {}
      }
    }
    if (disciplineEditor && !editorSessionId) {
      editorSessionId = savedEditorSessionId() || createEditorSessionId();
      try { sessionStorage.setItem("ka_editor_session", editorSessionId); } catch {}
    }

    let localAdmin = false;
    try { localAdmin = sessionStorage.getItem("pcm_admin") === "1"; } catch {}
    if (localAdmin !== operator) {
      try { sessionStorage.setItem("pcm_admin", operator ? "1" : "0"); } catch {}
    }
    if (typeof window.kaApplyOnlineAdminRole === "function") {
      window.kaApplyOnlineAdminRole(operator);
    } else {
      document.body.classList.toggle("admin-mode", operator);
      if (!operator) document.body.classList.remove("bloq-admin-mode");
    }

    publishDisciplineSession();
    installSaveHooks();
    startEconomicSync();
  }

  boot();
})();
