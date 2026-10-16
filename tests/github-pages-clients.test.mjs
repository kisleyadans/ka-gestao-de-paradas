import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("GitHub Pages publica CEII em /ceii com Firebase e cache separados e preserva a página original", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const build = spawnSync(process.execPath, ["work/build-github-pages.mjs"], {
    cwd: root, encoding: "utf8", env: { ...process.env, KA_CLIENT_FIREBASE_CONFIG: "" },
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);
  const [originalHtml, originalSync, rootHtml, rootSync, ceiiHtml, ceiiSync, profile] = await Promise.all([
    readFile(new URL("../firebase/public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/shared-sync.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/github-pages/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/github-pages/shared-sync.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/github-pages/ceii/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/github-pages/ceii/shared-sync.js", import.meta.url), "utf8"),
    readFile(new URL("../clients/ceii.json", import.meta.url), "utf8"),
  ]);
  assert.equal(rootSync, originalSync);
  assert.equal(rootHtml, originalHtml
    .replace(/src="\/shared-sync\.js\?v=([^"]+)"/, 'src="./shared-sync.js?v=$1"')
    .replaceAll('href="/shared-sync.js"', 'href="./shared-sync.js"'));
  assert.doesNotMatch(rootHtml, /id="ka-client-identity"|ka-client:ceii:/);
  assert.match(ceiiHtml, /<title>KA Gestão de Paradas CEII<\/title>/);
  assert.match(ceiiHtml, /src="\.\/shared-sync\.js\?v=client-ceii-/);
  assert.match(ceiiHtml, /ka-client:ceii:/);
  assert.match(ceiiSync, /ka-client:ceii:/);
  assert.doesNotMatch(ceiiSync, /pcm-gestaoparadas-kisley/);
  const config = JSON.parse(ceiiSync.match(/const FIREBASE_CONFIG = (\{[\s\S]*?\n\});/)[1]);
  assert.equal(config.projectId, JSON.parse(profile).firebaseProjectId);
  for (const module of ["firebase-sync-core.mjs", "firebase-economic-policy.mjs"]) {
    assert.equal(await readFile(new URL(`../dist/github-pages/ceii/${module}`, import.meta.url), "utf8"),
      await readFile(new URL(`../public/${module}`, import.meta.url), "utf8"));
  }
});
