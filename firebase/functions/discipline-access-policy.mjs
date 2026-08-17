export const ADMIN_EMAIL = "operador@ka-paradas.app";

export function normalizeDiscipline(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

export function disciplineEmail(value) {
  const slug = normalizeDiscipline(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return slug ? `${slug}@ka-paradas.app` : "";
}

function registerDiscipline(mappings, value, displayName = value) {
  const disciplineKey = normalizeDiscipline(value);
  const email = disciplineEmail(disciplineKey);
  if (!disciplineKey || !email) return;
  const current = mappings.get(email);
  if (current && current.disciplineKey !== disciplineKey) {
    throw new Error(`Colisão de disciplina para ${email}: ${current.disciplineKey} e ${disciplineKey}.`);
  }
  mappings.set(email, {
    disciplineKey,
    disciplineName: String(displayName || value || disciplineKey).trim() || disciplineKey,
  });
}

export function collectDisciplineMappings({ bucketDocs = [], progressDocs = [] } = {}) {
  const mappings = new Map();
  for (const bucket of bucketDocs) {
    const entries = Array.isArray(bucket?.entries) ? bucket.entries : [];
    for (const entry of entries) {
      const discipline = entry?.activity?.disciplina;
      registerDiscipline(mappings, discipline, discipline);
    }
  }
  for (const progress of progressDocs) {
    registerDiscipline(
      mappings,
      progress?.disciplineKey || progress?.disciplineName,
      progress?.disciplineName || progress?.disciplineKey,
    );
  }
  return mappings;
}

export function accessRecordForUser(user, mappings, adminEmail = ADMIN_EMAIL) {
  const email = String(user?.email || "").toLowerCase().trim();
  if (!user?.uid || !email) return null;
  if (email === String(adminEmail).toLowerCase()) {
    return { role: "admin", email, disciplineKey: "", disciplineName: "Administração", enabled: !user.disabled };
  }
  const discipline = mappings.get(email);
  if (!discipline) {
    return { role: "unassigned", email, disciplineKey: "", disciplineName: "", enabled: false };
  }
  return { role: "discipline", email, ...discipline, enabled: !user.disabled };
}
