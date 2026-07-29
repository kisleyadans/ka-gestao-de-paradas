import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const sourcePath = path.join(root, "public", "para360-operacional.html");
const pagePath = path.join(root, "app", "page.tsx");
const shellPath = path.join(root, "work", "offline-shell.js");
const outputDir = path.join(root, "outputs");
const outputPath = path.join(outputDir, "KA-Gestao-de-Paradas-OFFLINE.html");

const [source, pageSource, offlineShell] = await Promise.all([
  readFile(sourcePath, "utf8"),
  readFile(pagePath, "utf8"),
  readFile(shellPath, "utf8"),
]);

const cssMatch = pageSource.match(/customStyle\.textContent = `([\s\S]*?)`;\s*document\.head\.appendChild\(customStyle\)/);
if (!cssMatch) throw new Error("Não foi possível extrair o estilo atual do aplicativo.");

const offlineStyle = `${cssMatch[1]}
  body.ka-offline-mode #pcmAdminBar::before {
    content: "OFFLINE";
    background: #e8f4ee;
    border: 1px solid #b9dccb;
    border-radius: 999px;
    color: #087348;
    font-size: 9px;
    font-weight: 900;
    letter-spacing: .08em;
    padding: 4px 7px;
  }
`;

let html = source
  .replace(/<script\s+src=["']\/shared-sync\.js["']><\/script>\s*/gi, "")
  .replace(/<title>[\s\S]*?<\/title>/i, "<title>K.A - Gestão de Paradas (Offline)</title>")
  .replaceAll(
    "Este bloqueio evita alterações acidentais. A segurança de acesso deve ser controlada pelas permissões do SharePoint/servidor.",
    "Arquivo offline. Os dados ficam salvos somente neste computador.",
  )
  .replaceAll(
    "Modo consulta local — permissões reais controladas no SharePoint/servidor",
    "Modo consulta local — dados salvos somente neste computador",
  );

html = html.replace(
  "</head>",
  `<style id="ka-offline-app-style">${offlineStyle}</style>\n</head>`,
);
html = html.replace(
  "</body>",
  `<script id="ka-offline-shell">${offlineShell.replaceAll("</script>", "<\\/script>")}</script>\n</body>`,
);

await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, html, "utf8");

const checks = [
  [!html.includes('src="/shared-sync.js"'), "sem dependência do servidor"],
  [html.includes("ka-offline-shell"), "adaptação offline incorporada"],
  [html.includes("ka-activity-editor-open"), "editor compacto incorporado"],
  [html.includes("painel_parada_atividades"), "armazenamento local incorporado"],
  [html.includes("dadosEmbutidos"), "dados fictícios incorporados"],
  [html.includes("importDesbloqueiosCSV"), "importação da base de desbloqueios incorporada"],
  [html.includes("clearDesbloqueiosBase"), "limpeza da base de desbloqueios incorporada"],
  [html.includes("painel_parada_desbloqueios_initialized"), "base vazia persistente incorporada"],
];
for (const [ok, label] of checks) {
  if (!ok) throw new Error(`Validação falhou: ${label}`);
}

const expectedPasswordHash = createHash("sha256").update("PCM2026").digest("hex");
if (!html.includes(expectedPasswordHash)) {
  throw new Error("Validação falhou: senha administrativa não corresponde à configuração atual.");
}

const inlineScripts = Array.from(html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi));
let executableScriptCount = 0;
for (const [, attributes, code] of inlineScripts) {
  if (/\btype=["'](?:application\/json|application\/ld\+json)["']/i.test(attributes)) continue;
  if (/\bsrc=/i.test(attributes)) throw new Error("Validação falhou: script externo encontrado.");
  new vm.Script(code, { filename: `offline-inline-${executableScriptCount + 1}.js` });
  executableScriptCount += 1;
}

console.log(outputPath);
console.log(`bytes=${Buffer.byteLength(html, "utf8")}`);
console.log(`scripts=${executableScriptCount}`);
