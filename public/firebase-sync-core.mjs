export const BUCKET_COUNT = 16;

export const SHARED_KEYS = [
  "schema",
  "bloqueios",
  "limpezas",
  "meetingPlan",
  "progressSnapshots",
  "desbloqueios",
  "desbloqueioSourceVersion",
  "desbloqueioBaseName",
  "contatos",
  "refTime",
];

export function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function normalizeActivity(item) {
  const value = item && typeof item === "object" && !Array.isArray(item) ? item : {};
  return clone({
    ...value,
    id: String(value.id || "").trim(),
    extraEscopo: value.extraEscopo || "Não",
    caminhoCritico: value.caminhoCritico || "Não",
    autoProgress: false,
  });
}

export function normalizeDiscipline(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
}

export function disciplineEmail(value) {
  const slug = normalizeDiscipline(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return slug ? `${slug}@ka-paradas.app` : "";
}

export function isAuthorizedDisciplineProgress(activity, progress) {
  if (!activity || !progress) return false;
  return String(progress.activityId) === String(activity.id)
    && progress.disciplineKey === normalizeDiscipline(activity.disciplina)
    && progress.editorEmail === disciplineEmail(activity.disciplina);
}

export function sharedPart(value) {
  const state = value && typeof value === "object" ? value : {};
  return {
    schema: typeof state.schema === "string" ? state.schema : "ka_gestao_paradas_v2",
    activities: [],
    bloqueios: Array.isArray(state.bloqueios) ? clone(state.bloqueios) : [],
    limpezas: Array.isArray(state.limpezas) ? clone(state.limpezas) : [],
    meetingPlan: Array.isArray(state.meetingPlan) ? clone(state.meetingPlan) : [],
    progressSnapshots: Array.isArray(state.progressSnapshots) ? clone(state.progressSnapshots.slice(-500)) : [],
    desbloqueios: Array.isArray(state.desbloqueios) ? clone(state.desbloqueios) : [],
    desbloqueioSourceVersion: typeof state.desbloqueioSourceVersion === "string" ? state.desbloqueioSourceVersion : "",
    desbloqueioBaseName: typeof state.desbloqueioBaseName === "string" ? state.desbloqueioBaseName : "",
    contatos: Array.isArray(state.contatos) ? clone(state.contatos) : [],
    refTime: typeof state.refTime === "string" ? state.refTime : "",
  };
}

export function bucketId(id) {
  const text = String(id || "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return String((hash >>> 0) % BUCKET_COUNT).padStart(2, "0");
}

export function buildBuckets(items) {
  const buckets = new Map();
  (Array.isArray(items) ? items : []).forEach((item, position) => {
    const activity = normalizeActivity(item);
    if (!activity.id) return;
    const id = bucketId(activity.id);
    if (!buckets.has(id)) buckets.set(id, []);
    buckets.get(id).push({ id: activity.id, activity, position, revision: 1 });
  });
  return buckets;
}

export function changedFields(base, next) {
  const keys = new Set([...Object.keys(base || {}), ...Object.keys(next || {})]);
  keys.delete("id");
  return Array.from(keys).filter((key) => !same(base?.[key], next?.[key]));
}

export function applyFields(current, next, fields) {
  const merged = clone(current || {});
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(next || {}, field)) merged[field] = clone(next[field]);
    else delete merged[field];
  }
  return merged;
}

export function mergeActivityChange(currentEntry, change) {
  const current = currentEntry?.activity ? normalizeActivity(currentEntry.activity) : null;
  const base = change.base ? normalizeActivity(change.base) : null;
  const next = change.next ? normalizeActivity(change.next) : null;
  const currentRevision = Number(currentEntry?.revision || 0);

  if (change.deleted) {
    if (!current) return { accepted: true, deleted: true, revision: currentRevision };
    if (!base || !same(current, base)) {
      return { accepted: false, conflict: true, fields: ["__deleted"], current: clone(currentEntry) };
    }
    return { accepted: true, deleted: true, revision: currentRevision + 1 };
  }

  if (!next?.id) return { accepted: false, error: "Atividade sem identificador" };
  if (!current) {
    if (base && Object.keys(base).length > 1) {
      return { accepted: false, conflict: true, fields: ["__deleted"], current: null };
    }
    return {
      accepted: true,
      deleted: false,
      entry: { id: next.id, activity: next, position: change.position, revision: 1 },
    };
  }

  const fields = changedFields(base || { id: next.id }, next);
  // O carimbo muda em toda edição. Duas gravações rápidas do mesmo operador
  // podem ter carimbos diferentes antes de o retorno online atualizar a base
  // local; isso não é um conflito de negócio e deve seguir a última edição.
  const lastWriteWinsFields = new Set(["ultimaAtualizacao"]);
  const overlapping = fields.filter((field) => (
    !lastWriteWinsFields.has(field)
    && !same(current[field], base?.[field])
    && !same(current[field], next[field])
  ));
  if (overlapping.length > 0) {
    return { accepted: false, conflict: true, fields: overlapping, current: clone(currentEntry) };
  }

  const merged = applyFields(current, next, fields);
  const position = Number(change.position ?? currentEntry.position ?? 0);
  const positionChanged = position !== Number(currentEntry.position || 0);
  return {
    accepted: true,
    deleted: false,
    entry: {
      id: next.id,
      activity: normalizeActivity(merged),
      position,
      revision: currentRevision + (fields.length > 0 || positionChanged ? 1 : 0),
    },
  };
}

// Modo de edição exclusiva: como as regras da base permitem somente um posto
// de edição, a ação mais recente desse posto é a fonte definitiva. Isso evita
// falsos conflitos quando a pessoa edita e logo depois exclui o mesmo item.
export function applyExclusiveActivityChange(currentEntry, change) {
  const currentRevision = Number(currentEntry?.revision || 0);
  if (change.deleted) {
    return { accepted: true, deleted: true, revision: currentRevision + (currentEntry ? 1 : 0) };
  }
  const next = change.next ? normalizeActivity(change.next) : null;
  if (!next?.id) return { accepted: false, error: "Atividade sem identificador" };
  return {
    accepted: true,
    deleted: false,
    entry: {
      id: next.id,
      activity: next,
      position: Number(change.position ?? currentEntry?.position ?? 0),
      revision: currentRevision + 1,
    },
  };
}

function changedSharedKeys(base, next) {
  return SHARED_KEYS.filter((key) => !same(base?.[key], next?.[key]));
}

function mergeSnapshots(current, incoming) {
  const rows = [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])];
  const unique = new Map();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const key = String(row.t ?? row.time ?? row.timestamp ?? JSON.stringify(row));
    unique.set(key, row);
  }
  return Array.from(unique.values()).slice(-500);
}

function keyedRecords(items) {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const id = String(item?.id || "").trim();
    if (!id || map.has(id)) return null;
    map.set(id, clone(item));
  }
  return map;
}

export function mergeKeyedCollection(currentValue, baseValue, nextValue) {
  const current = keyedRecords(currentValue);
  const base = keyedRecords(baseValue);
  const next = keyedRecords(nextValue);
  if (!current || !base || !next) return { value: clone(currentValue || []), conflicts: ["__invalid_ids"] };

  const merged = new Map(current);
  const conflicts = [];
  const localIds = new Set([...base.keys(), ...next.keys()]);
  for (const id of localIds) {
    const baseItem = base.get(id);
    const currentItem = current.get(id);
    const nextItem = next.get(id);
    if (same(nextItem, baseItem)) continue;

    if (same(currentItem, baseItem) || same(currentItem, nextItem)) {
      if (nextItem) merged.set(id, clone(nextItem));
      else merged.delete(id);
      continue;
    }

    if (baseItem && currentItem && nextItem) {
      const fields = changedFields(baseItem, nextItem);
      const lastWriteWinsFields = new Set(["ultimaAtualizacao"]);
      const overlapping = fields.filter((field) => (
        !lastWriteWinsFields.has(field)
        && !same(currentItem[field], baseItem[field])
        && !same(currentItem[field], nextItem[field])
      ));
      if (overlapping.length > 0) {
        conflicts.push(...overlapping.map((field) => `${id}.${field}`));
      } else {
        merged.set(id, applyFields(currentItem, nextItem, fields));
      }
      continue;
    }

    conflicts.push(`${id}.__record`);
  }

  const order = [];
  for (const item of Array.isArray(currentValue) ? currentValue : []) {
    const id = String(item?.id || "").trim();
    if (merged.has(id) && !order.includes(id)) order.push(id);
  }
  for (const item of Array.isArray(nextValue) ? nextValue : []) {
    const id = String(item?.id || "").trim();
    if (merged.has(id) && !order.includes(id)) order.push(id);
  }
  for (const id of merged.keys()) if (!order.includes(id)) order.push(id);
  return { value: order.map((id) => clone(merged.get(id))), conflicts };
}

export function mergeSharedState(currentValue, baseValue, nextValue) {
  const current = sharedPart(currentValue);
  const base = sharedPart(baseValue);
  const next = sharedPart(nextValue);
  const merged = clone(current);
  const conflicts = [];
  for (const key of changedSharedKeys(base, next)) {
    if (same(current[key], base[key]) || same(current[key], next[key])) merged[key] = clone(next[key]);
    else if (key === "progressSnapshots") merged[key] = mergeSnapshots(current[key], next[key]);
    else if (["limpezas", "bloqueios", "desbloqueios", "contatos"].includes(key)) {
      const result = mergeKeyedCollection(current[key], base[key], next[key]);
      if (result.conflicts.length > 0) conflicts.push(...result.conflicts.map((field) => `${key}.${field}`));
      else merged[key] = result.value;
    }
    else conflicts.push(key);
  }
  merged.activities = [];
  return { merged, conflicts, changed: changedSharedKeys(current, merged) };
}
