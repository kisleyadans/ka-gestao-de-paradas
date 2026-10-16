import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const firebaseOutput = path.join(root, "firebase", "public");
const pagesOutput = path.join(root, "dist", "github-pages");

// Reuse the validated static Firebase build, then adapt the asset paths for
// sites published below user.github.io/repository/.
await import("./build-firebase-site.mjs");

await rm(pagesOutput, { recursive: true, force: true });
await mkdir(pagesOutput, { recursive: true });
await cp(firebaseOutput, pagesOutput, { recursive: true });

const indexPath = path.join(pagesOutput, "index.html");
const html = (await readFile(indexPath, "utf8"))
  .replace(/src="\/shared-sync\.js\?v=([^"]+)"/, 'src="./shared-sync.js?v=$1"')
  .replaceAll('href="/shared-sync.js"', 'href="./shared-sync.js"');

if (!/src="\.\/shared-sync\.js\?v=[^"]+"/.test(html)) {
  throw new Error("O build do GitHub Pages não contém o sincronizador Firebase relativo.");
}

await Promise.all([
  writeFile(indexPath, html, "utf8"),
  writeFile(path.join(pagesOutput, ".nojekyll"), "", "utf8"),
]);

// Publish CEII below the existing GitHub Pages address. Its Firebase and
// application cache remain separate from the original page at the root.
const clientBuild = spawnSync(process.execPath, [
  path.join(root, "work", "build-client-site.mjs"), "--client=ceii",
], { cwd: root, stdio: "inherit" });
if (clientBuild.error) throw clientBuild.error;
if (clientBuild.status !== 0) throw new Error("Falha ao gerar a página CEII para o GitHub Pages.");
await cp(path.join(root, "dist", "clients", "ceii"), path.join(pagesOutput, "ceii"), { recursive: true });

console.log(pagesOutput);
console.log(`bytes=${Buffer.byteLength(html, "utf8")}`);
