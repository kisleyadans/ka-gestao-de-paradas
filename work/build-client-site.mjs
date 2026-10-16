import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import vm from "node:vm";
import { clientPage, clientSyncScript, loadClientConfig } from "./client-site-config.mjs";

const root = process.cwd();
// Validate before running a build, and never fall back to the primary Firebase.
const client = await loadClientConfig(root, process.argv.slice(2));
await import("./build-firebase-site.mjs");
const original = path.join(root, "firebase", "public");
const output = path.join(root, "dist", "clients", client.id);
await mkdir(output, { recursive: true });

const [html, sync] = await Promise.all([
  readFile(path.join(original, "index.html"), "utf8"),
  readFile(path.join(original, "shared-sync.js"), "utf8"),
]);
const page = clientPage(html, client);
const script = clientSyncScript(sync, client);
for (const [, attrs, code] of page.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (/\bsrc=|\btype=["'](?:application\/json|application\/ld\+json)["']/i.test(attrs)) continue;
  new vm.Script(code);
}

await Promise.all([
  writeFile(path.join(output, "index.html"), page, "utf8"),
  writeFile(path.join(output, "shared-sync.js"), script, "utf8"),
  cp(path.join(original, "firebase-sync-core.mjs"), path.join(output, "firebase-sync-core.mjs")),
  cp(path.join(original, "firebase-economic-policy.mjs"), path.join(output, "firebase-economic-policy.mjs")),
  writeFile(path.join(output, ".nojekyll"), "", "utf8"),
]);
const manifest = {
  client: client.id, name: client.name, firebaseProjectId: client.firebase.projectId,
  indexSha256: createHash("sha256").update(page).digest("hex"),
  syncSha256: createHash("sha256").update(script).digest("hex"),
};
await writeFile(path.join(output, "client-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Cliente ${client.name}: ${output}`);
