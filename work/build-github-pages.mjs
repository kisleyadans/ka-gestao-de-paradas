import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { protectPublicBuild } from "./protect-public-build.mjs";
import { runSecurityAudit } from "./security-audit.mjs";

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

const release = await protectPublicBuild(pagesOutput, {
  version: process.env.GITHUB_SHA || process.env.KA_RELEASE_VERSION || "local",
});
await runSecurityAudit({ root, distribution: pagesOutput });

console.log(pagesOutput);
console.log(`version=${release.version}`);
console.log(`releaseHash=${release.releaseHash}`);
