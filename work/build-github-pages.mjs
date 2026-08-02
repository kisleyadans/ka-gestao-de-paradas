import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

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
  .replaceAll('src="/shared-sync.js?v=20260802-4"', 'src="./shared-sync.js?v=20260802-4"')
  .replaceAll('href="/shared-sync.js"', 'href="./shared-sync.js"');

if (!html.includes('src="./shared-sync.js?v=20260802-4"')) {
  throw new Error("O build do GitHub Pages não contém o sincronizador Firebase relativo.");
}

await Promise.all([
  writeFile(indexPath, html, "utf8"),
  writeFile(path.join(pagesOutput, ".nojekyll"), "", "utf8"),
]);

console.log(pagesOutput);
console.log(`bytes=${Buffer.byteLength(html, "utf8")}`);
