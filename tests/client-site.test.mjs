import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import {
  clientPage, clientSyncScript, loadClientConfig, PRIMARY_PROJECT_ID,
  scopeClientStorage, validateClientConfig,
} from "../work/client-site-config.mjs";

const profile = JSON.parse(await readFile(new URL("../clients/ceii.json", import.meta.url), "utf8"));
// Test fixture only. No real credentials or operational data are used.
const firebase = {
  projectId: profile.firebaseProjectId,
  appId: "1:123456789:web:testfixture",
  apiKey: "AIzaTestFixtureOnly",
  authDomain: `${profile.firebaseProjectId}.firebaseapp.com`,
};
const client = validateClientConfig(profile, firebase);

test("CEII exige seu próprio Firebase e nunca usa o projeto principal como fallback", async () => {
  assert.throws(() => validateClientConfig(profile, null), /configuração Web/);
  assert.throws(() => validateClientConfig(profile, { ...firebase, projectId: PRIMARY_PROJECT_ID }), /não corresponde/);
  assert.throws(() => validateClientConfig({ ...profile, firebaseProjectId: PRIMARY_PROJECT_ID }, firebase), /separado/);
  assert.throws(() => validateClientConfig(profile, { ...firebase, authDomain: `${PRIMARY_PROJECT_ID}.firebaseapp.com` }), /domínio/);
  assert.throws(() => validateClientConfig(profile, { ...firebase, private_key: "never-publish" }), /pública/);
  assert.throws(() => validateClientConfig(profile, { ...firebase, appId: "" }), /incompleta/);
  const root = new URL("..", import.meta.url).pathname;
  await assert.rejects(loadClientConfig(root, ["--client=../../primary"], {}), /Selecione/);
});

test("abrir CEII não lê, altera nem remove dados e sessões do cliente original", () => {
  const local = new Map([
    ["activities", "primary-unsent"],
    ["dynamic", "primary-dynamic"],
    ["generation", "primary-generation"],
  ]);
  const session = new Map([["pcm_admin", "1"]]);
  const storage = (map) => ({
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  });
  const context = vm.createContext({ localStorage: storage(local), sessionStorage: storage(session) });
  vm.runInContext(scopeClientStorage(`
    if(localStorage.getItem('activities')!==null)throw Error('client data leaked');
    if(sessionStorage.getItem('pcm_admin')!==null)throw Error('session leaked');
    const key='dynamic';
    localStorage.setItem(key,JSON.stringify(['ceii']));
    localStorage.setItem('activities','ceii-only');
    localStorage.removeItem('generation');
    sessionStorage.setItem('pcm_admin','0');
  `, "ceii"), context);
  assert.equal(local.get("activities"), "primary-unsent");
  assert.equal(local.get("dynamic"), "primary-dynamic");
  assert.equal(local.get("generation"), "primary-generation");
  assert.equal(local.get("ka-client:ceii:activities"), "ceii-only");
  assert.equal(local.get("ka-client:ceii:dynamic"), '["ceii"]');
  assert.equal(session.get("pcm_admin"), "1");
  assert.equal(session.get("ka-client:ceii:pcm_admin"), "0");
  assert.throws(() => scopeClientStorage("localStorage.clear()", "ceii"), /Revisão/);
});

test("o sincronizador gerado conecta somente ao Firebase CEII e usa cache próprio", async () => {
  const original = await readFile(new URL("../public/shared-sync.js", import.meta.url), "utf8");
  const script = clientSyncScript(original, client);
  assert.doesNotMatch(script, new RegExp(PRIMARY_PROJECT_ID));
  assert.match(script, /"projectId": "ka-gestao-paradas-ceii"/);
  assert.match(script, /getItem\("ka-client:ceii:" \+ ECONOMIC_CACHE_KEY/);
  assert.match(script, /setItem\("ka-client:ceii:" \+ "ka_discipline_session"/);
  assert.match(script, /signInWithEmailAndPassword/);
  assert.match(script, /runTransaction/);
  assert.throws(() => clientSyncScript("const FIREBASE_CONFIG = {};", client), /mudou/);
});

test("a página CEII mantém base vazia, scripts válidos e identificação própria", async () => {
  const original = await readFile(new URL("../public/para360-operacional.html", import.meta.url), "utf8");
  const html = clientPage(original, client);
  assert.match(html, /<title>KA Gestão de Paradas CEII<\/title>/);
  assert.equal((html.match(/id="ka-client-identity"/g) || []).length, 1);
  assert.match(html, /\.\/shared-sync\.js\?v=client-ceii-/);
  const data = JSON.parse(html.match(/<script id="dadosEmbutidos" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  for (const key of ["activities", "bloqueios", "desbloqueios", "limpezas", "meetingPlan", "progressSnapshots", "contatos"]) {
    assert.equal((data[key] || []).length, 0, key);
  }
  for (const [, attrs, code] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc=|\btype=["'](?:application\/json|application\/ld\+json)["']/i.test(attrs)) continue;
    new vm.Script(code);
  }
});

test("identificação na página trata o nome como texto", () => {
  const html = clientPage("<html><title>KA</title><body></body></html>", {
    ...client, name: '</script><img src=x onerror="bad()">',
  });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /\\u003c\/script>/);
});

test("publicação CEII aponta para seu diretório e nunca para o Hosting principal", async () => {
  const config = JSON.parse(await readFile(new URL("../firebase.ceii.json", import.meta.url), "utf8"));
  assert.equal(config.hosting.site, profile.firebaseProjectId);
  assert.equal(config.hosting.public, "dist/clients/ceii");
  assert.equal(config.firestore.rules, "firestore.rules");
});
