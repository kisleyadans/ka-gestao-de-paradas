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
  doc,
  initializeFirestore,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  BUCKET_COUNT,
  mergeActivityChange,
  mergeSharedState,
  bucketId,
  buildBuckets,
  clone,
  normalizeActivity,
  same,
  sharedPart,
} from "./firebase-sync-core.mjs";

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
  });
  // A base v2 começa vazia para a nova parada. As coleções antigas permanecem
  // intactas no Firestore como histórico e não são carregadas por esta versão.
  const stateRef = doc(db, "ka_free_state_v2", "current");
  const bucketsRef = collection(db, "ka_free_activity_buckets_v2");

  let operator = false;
  let operatorName = "";
  let editorSessionId = "";
  let applyingRemote = false;
  let saving = false;
  let dirty = false;
  let saveTimer = null;
  let statusChip = null;
  let baselineActivities = new Map();
  let baselineSharedState = null;
  let stateLoaded = false;
  let bucketsLoaded = false;
  let remoteStateData = null;
  let remoteBuckets = new Map();
  let initializing = false;
  let pendingRemote = false;
  let lastRemoteSignature = "";

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
        body:not(.admin-mode) input:not([type="search"]):not(#fEquipamento):not(#fBloqSearch),
        body:not(.admin-mode) textarea,
        body:not(.admin-mode) select:not(#fDisciplina):not(#fArea):not(#fStatus) {pointer-events:none}
        @media(max-width:720px){.admin-bar .admin-state{flex-basis:100%}.ka-shared-status{margin-right:auto}}
        @media print{.ka-shared-status{display:none!important}}
      `;
      document.head.appendChild(style);
    }
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

  async function forceConsultationMode(message) {
    if (message) setStatus(message, "error");
    operator = false;
    editorSessionId = "";
    try {
      sessionStorage.removeItem("ka_editor_session");
      sessionStorage.setItem("pcm_admin", "0");
    } catch {}
    try { await signOut(auth); } catch {}
    window.location.reload();
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
    if (typeof window.renderAll === "function") window.renderAll();
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
      return normalizeActivity(entry.activity);
    });
    return {
      state: { ...sharedPart(remoteStateData.baseState), activities: activitiesFromBuckets },
      versions,
      signature: JSON.stringify({
        stateRevision: remoteStateData.revision || 0,
        buckets: Array.from(remoteBuckets.entries()).map(([id, value]) => [id, value.revision || 0]),
      }),
    };
  }

  function applyAvailableRemote() {
    if (!stateLoaded || !bucketsLoaded) return;
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
    if (assembled.signature !== lastRemoteSignature) {
      applyFullState(assembled.state, assembled.versions);
      lastRemoteSignature = assembled.signature;
    }
    pendingRemote = false;
    const mode = operator ? `${operatorName} · edição compartilhada` : "somente consulta";
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

  function collectActivityChanges() {
    const current = new Map();
    (Array.isArray(window.activities) ? window.activities : []).forEach((activity, position) => {
      current.set(activity.id, { activity: clone(activity), position });
    });
    const changes = [];
    current.forEach((entry, id) => {
      const baseline = baselineActivities.get(id);
      if (!baseline || !same(baseline.activity, entry.activity)) {
        changes.push({
          id,
          base: baseline ? clone(baseline.activity) : null,
          next: entry.activity,
          deleted: false,
          position: entry.position,
        });
      }
    });
    baselineActivities.forEach((baseline, id) => {
      if (!current.has(id)) {
        changes.push({ id, base: clone(baseline.activity), next: null, deleted: true, position: 0 });
      }
    });
    return changes;
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
    return runTransaction(db, async (transaction) => {
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
          const result = mergeActivityChange(currentEntry, change);
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
  }

  async function saveSharedChanges(currentShared) {
    if (baselineSharedState && same(baselineSharedState, currentShared)) return { conflicts: [] };
    return runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(stateRef);
      if (!snapshot.exists()) throw new Error("A base online ainda não foi criada");
      const data = snapshot.data();
      const onlineShared = sharedPart(data.baseState);
      const merged = mergeSharedState(
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
    setStatus("Sincronizando alterações...", "pending");
    let saveFailed = false;
    try {
      const changes = collectActivityChanges();
      const currentShared = sharedPart(buildState());
      const activityResult = await saveActivityChanges(changes);
      const sharedResult = await saveSharedChanges(currentShared);
      const conflicts = [...activityResult.conflicts, ...sharedResult.conflicts];
      if (conflicts.length > 0) {
        setStatus("Online · conflito identificado; a versão mais recente foi preservada", "error");
        if (typeof window.showSaveToast === "function") {
          window.showSaveToast("⚠ Outra pessoa alterou o mesmo item. A versão online mais recente foi preservada.");
        }
      } else {
        setStatus(`Online · ${operatorName} · salvo às ${timeLabel()}`, "online");
        const saveInfo = document.getElementById("saveInfo");
        if (saveInfo) saveInfo.textContent = `Base online atualizada às ${timeLabel()}`;
        if (typeof window.showSaveToast === "function") window.showSaveToast("✓ Alteração publicada para todos");
      }
    } catch (error) {
      saveFailed = true;
      console.error("Shared state save failed", error);
      dirty = true;
      const denied = error?.code === "permission-denied";
      if (denied) {
        dirty = false;
        setStatus("Sessão de edição sem permissão · entrando em consulta", "error");
        setTimeout(() => forceConsultationMode(), 700);
      } else {
        setStatus("Falha ao sincronizar · tentando novamente", "error");
      }
    } finally {
      saving = false;
      if (!dirty && pendingRemote) applyAvailableRemote();
      if (dirty) scheduleSave(saveFailed ? 1800 : 120);
    }
  }

  function scheduleSave(delay) {
    if (!operator || applyingRemote) return;
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
    await saveRemote();
    if (dirty) throw new Error("A alteração ainda não foi confirmada pela base online");
    return true;
  }

  function wrapSaver(name, delay) {
    const original = window[name];
    if (typeof original !== "function" || original.__kaSharedWrapped) return;
    const wrapped = function () {
      const result = original.apply(this, arguments);
      if (result && typeof result.then === "function") {
        result.then(() => { if (!applyingRemote) scheduleSave(delay); });
      } else if (!applyingRemote) scheduleSave(delay);
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
    const name = window.prompt("Digite seu nome para registrar as atualizações:", rememberedName);
    if (name === null) return;
    if (!name.trim()) {
      window.alert("Informe seu nome para continuar.");
      return;
    }
    const password = window.prompt("Senha compartilhada do editor (teste):", "PCM2026");
    if (password === null) return;
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

  async function logout() {
    try {
      await signOut(auth);
    } finally {
      editorSessionId = "";
      try {
        sessionStorage.removeItem("ka_editor_session");
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

  function startRealtimeSync() {
    onSnapshot(stateRef, (snapshot) => {
      remoteStateData = snapshot.exists() ? snapshot.data() : null;
      stateLoaded = true;
      applyAvailableRemote();
    }, (error) => {
      console.error("State listener failed", error);
      stateLoaded = true;
      setStatus("Sem conexão com a base online", "error");
    });

    onSnapshot(bucketsRef, (snapshot) => {
      const next = new Map();
      snapshot.forEach((item) => next.set(item.id, item.data()));
      remoteBuckets = next;
      bucketsLoaded = true;
      applyAvailableRemote();
    }, (error) => {
      console.error("Activity listener failed", error);
      bucketsLoaded = true;
      setStatus("Sem conexão com as atividades online", "error");
    });

    renderEditorPresence();
  }

  async function boot() {
    ensureStatusUi();
    window.pcmLogin = login;
    window.pcmLogout = logout;
    window.kaClearSharedActivities = clearSharedActivities;
    window.kaSaveSharedNow = flushSharedChanges;
    window.kaScheduleSharedSave = scheduleSave;
    const user = await waitForAuth();
    operator = user?.email === OPERATOR_EMAIL;
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

    let localAdmin = false;
    try { localAdmin = sessionStorage.getItem("pcm_admin") === "1"; } catch {}
    if (localAdmin !== operator) {
      try { sessionStorage.setItem("pcm_admin", operator ? "1" : "0"); } catch {}
      window.location.reload();
      return;
    }

    installSaveHooks();
    startRealtimeSync();
  }

  boot();
})();
