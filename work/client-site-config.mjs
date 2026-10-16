import { readFile } from "node:fs/promises";

export const PRIMARY_PROJECT_ID = "pcm-gestaoparadas-kisley";
const PUBLIC_CONFIG_KEYS = new Set([
  "projectId", "appId", "apiKey", "authDomain", "messagingSenderId",
  "storageBucket", "databaseURL", "measurementId",
]);

export function validateClientConfig(profile, firebase) {
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(profile.id || "")) {
    throw new Error("Identificador de cliente inválido.");
  }
  if (typeof profile.name !== "string" || !profile.name.trim()) {
    throw new Error("Nome de cliente obrigatório.");
  }
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(profile.firebaseProjectId || "")
      || profile.firebaseProjectId === PRIMARY_PROJECT_ID) {
    throw new Error("O cliente precisa de um projeto Firebase separado do ambiente principal.");
  }
  if (!firebase || typeof firebase !== "object" || Array.isArray(firebase)) {
    throw new Error("Informe a configuração Web do Firebase do cliente em KA_CLIENT_FIREBASE_CONFIG.");
  }
  for (const key of Object.keys(firebase)) {
    if (!PUBLIC_CONFIG_KEYS.has(key)) {
      throw new Error("Use somente a configuração pública do app Web; contas de serviço e senhas não são aceitas.");
    }
  }
  for (const key of ["projectId", "appId", "apiKey", "authDomain"]) {
    if (typeof firebase[key] !== "string" || !firebase[key].trim()) {
      throw new Error(`Configuração Web incompleta: ${key}.`);
    }
  }
  if (firebase.projectId !== profile.firebaseProjectId) {
    throw new Error("O projeto Firebase informado não corresponde ao cliente selecionado.");
  }
  if (firebase.authDomain !== `${profile.firebaseProjectId}.firebaseapp.com`) {
    throw new Error("O domínio de autenticação precisa pertencer ao Firebase do cliente.");
  }
  if (!/^1:\d+:web:[a-zA-Z0-9]+$/.test(firebase.appId)
      || !/^AIza[\w-]+$/.test(firebase.apiKey)) {
    throw new Error("Copie appId e apiKey do app Web cadastrado no Firebase do cliente.");
  }
  return { ...profile, firebase: { ...firebase } };
}

export async function loadClientConfig(root, args, env = process.env) {
  const client = args.find((arg) => arg.startsWith("--client="))?.slice(9);
  if (!client || !/^[a-z][a-z0-9-]{1,39}$/.test(client)) {
    throw new Error("Selecione um cliente com --client=ceii.");
  }
  const profile = JSON.parse(await readFile(`${root}/clients/${client}.json`, "utf8"));
  if (profile.id !== client) throw new Error("O perfil não corresponde ao cliente selecionado.");
  const configPath = args.find((arg) => arg.startsWith("--firebase-config="))?.slice(18);
  const raw = configPath ? await readFile(configPath, "utf8")
    : env.KA_CLIENT_FIREBASE_CONFIG || (profile.firebase ? JSON.stringify(profile.firebase) : undefined);
  let firebase;
  try { firebase = raw ? JSON.parse(raw) : null; }
  catch { throw new Error("A configuração Web do Firebase precisa ser um JSON válido."); }
  return validateClientConfig(profile, firebase);
}

// Prefix only application calls. Do not patch Storage.prototype or the Firebase SDK.
// The original page keeps its current keys, including its unsent local changes.
export function scopeClientStorage(source, id) {
  const prefix = JSON.stringify(`ka-client:${id}:`);
  if (/\b(?:localStorage|sessionStorage)\s*\.\s*(?:clear|key|length)\b/.test(source)) {
    throw new Error("Revisão necessária: novo acesso global ao armazenamento do navegador.");
  }
  return source.replace(
    /\b((?:localStorage|sessionStorage)\s*\.\s*(?:getItem|setItem|removeItem))\s*\(/g,
    `$1(${prefix} + `,
  );
}

export function clientSyncScript(source, client) {
  const configPattern = /const FIREBASE_CONFIG = \{[\s\S]*?\n  \};/g;
  const matches = [...source.matchAll(configPattern)];
  if (matches.length !== 1 || !matches[0][0].includes(PRIMARY_PROJECT_ID)) {
    throw new Error("A configuração original mudou; revise a publicação do cliente.");
  }
  const script = source.replace(configPattern, () => `const FIREBASE_CONFIG = ${JSON.stringify(client.firebase, null, 2)};`);
  if (script.includes(PRIMARY_PROJECT_ID)) {
    throw new Error("Publicação bloqueada: o cliente ainda referencia o Firebase principal.");
  }
  return scopeClientStorage(script, client.id);
}

export function clientPage(source, client) {
  const json = JSON.stringify({ id: client.id, name: client.name }).replaceAll("<", "\\u003c");
  const brandScript = `<script id="ka-client-identity">(function(){
    const client=${json};
    function identify(){
      document.title=client.name;
      document.documentElement.dataset.kaClient=client.id;
      document.querySelectorAll('.ka-brand-subtitle,.ka-mobile-title span').forEach(el=>{el.textContent=client.name;});
      const breadcrumb=document.querySelector('.ka-pro-breadcrumb');
      if(breadcrumb && breadcrumb.firstChild)breadcrumb.firstChild.textContent=client.name+' ';
    }
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',identify);else identify();
  })();</script>`;
  const title = client.name.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return scopeClientStorage(source, client.id)
    .replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${title}</title>`)
    .replace(/(src=["'])\/?shared-sync\.js(?:\?[^"']*)?(["'])/g,
      `$1./shared-sync.js?v=client-${client.id}-20261016$2`)
    .replace("</body>", `${brandScript}\n</body>`);
}
