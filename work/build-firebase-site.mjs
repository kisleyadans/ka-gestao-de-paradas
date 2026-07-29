import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const sourcePath = path.join(root, "public", "para360-operacional.html");
const syncPath = path.join(root, "public", "shared-sync.js");
const syncCorePath = path.join(root, "public", "firebase-sync-core.mjs");
const pagePath = path.join(root, "app", "page.tsx");
const shellPath = path.join(root, "work", "offline-shell.js");
const outputDir = path.join(root, "firebase", "public");
const outputPath = path.join(outputDir, "index.html");

const [source, syncScript, pageSource, shellSource] = await Promise.all([
  readFile(sourcePath, "utf8"),
  readFile(syncPath, "utf8"),
  readFile(pagePath, "utf8"),
  readFile(shellPath, "utf8"),
]);

const embeddedMatch = source.match(
  /<script id="dadosEmbutidos" type="application\/json">([\s\S]*?)<\/script>/i,
);
if (!embeddedMatch) throw new Error("Bloco dadosEmbutidos não encontrado.");
const embeddedState = JSON.parse(embeddedMatch[1]);
for (const key of ["activities", "bloqueios", "desbloqueios", "limpezas", "meetingPlan", "progressSnapshots"]) {
  if (Array.isArray(embeddedState[key]) && embeddedState[key].length > 0) {
    throw new Error(`Publicação bloqueada: ${key} contém dados operacionais embutidos.`);
  }
}

const cssMatch = pageSource.match(/customStyle\.textContent = `([\s\S]*?)`;\s*document\.head\.appendChild\(customStyle\)/);
if (!cssMatch) throw new Error("Não foi possível extrair o estilo do aplicativo.");

const onlineStyle = `${cssMatch[1]}
  body.ka-firebase-mode #pcmAdminBar::before {
    content: "ONLINE";
    background: #e8f5ee;
    border: 1px solid #b9dccb;
    border-radius: 999px;
    color: #087348;
    font-size: 9px;
    font-weight: 900;
    letter-spacing: .08em;
    padding: 4px 7px;
  }
`;

const onlineShell = shellSource
  .replaceAll("K.A - Gestão de Paradas (Offline)", "K.A - Gestão de Paradas")
  .replaceAll('"ka-app-layout", "ka-offline-mode"', '"ka-app-layout", "ka-firebase-mode"')
  .replaceAll("Uso local neste computador", "Base Firebase compartilhada")
  .replaceAll("Arquivo offline", "Firebase online")
  .replaceAll("Dados salvos neste computador", "Atualizações compartilhadas");

const html = source
  .replace(/<title>[\s\S]*?<\/title>/i, "<title>K.A - Gestão de Paradas</title>")
  .replace('<script src="/shared-sync.js"></script>', '<script type="module" src="/shared-sync.js"></script>')
  .replace("</head>", `<style id="ka-firebase-app-style">${onlineStyle}</style>\n</head>`)
  .replace(
    "</body>",
    `<script id="ka-firebase-shell">${onlineShell.replaceAll("</script>", "<\\/script>")}</script>\n</body>`,
  );

await mkdir(outputDir, { recursive: true });
await Promise.all([
  writeFile(outputPath, html, "utf8"),
  copyFile(syncPath, path.join(outputDir, "shared-sync.js")),
  copyFile(syncCorePath, path.join(outputDir, "firebase-sync-core.mjs")),
]);

const checks = [
  [html.includes('src="/shared-sync.js"'), "sincronização online"],
  [html.includes("ka-firebase-shell"), "visual de aplicativo"],
  [html.includes("importDesbloqueiosCSV"), "importação de desbloqueios"],
  [html.includes("clearDesbloqueiosBase"), "limpeza de desbloqueios"],
  [syncScript.includes("signInWithEmailAndPassword"), "autenticação gratuita"],
  [syncScript.includes("runTransaction"), "sincronização concorrente"],
  [syncScript.includes("desbloqueioBaseName"), "nome da base compartilhada"],
];
for (const [ok, label] of checks) {
  if (!ok) throw new Error(`Validação Firebase falhou: ${label}`);
}

const inlineScripts = Array.from(html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi));
let executableScriptCount = 0;
for (const [, attributes, code] of inlineScripts) {
  if (/\btype=["'](?:application\/json|application\/ld\+json)["']/i.test(attributes)) continue;
  if (/\bsrc=/i.test(attributes)) continue;
  new vm.Script(code, { filename: `firebase-inline-${executableScriptCount + 1}.js` });
  executableScriptCount += 1;
}

console.log(outputPath);
console.log(`bytes=${Buffer.byteLength(html, "utf8")}`);
console.log(`scripts=${executableScriptCount + 1}`);
