import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEXT_EXTENSIONS = new Set([".html", ".js", ".mjs", ".ts", ".tsx", ".json", ".yml", ".yaml", ".md", ".txt"]);
const OPERATIONAL_ARRAYS = ["activities", "bloqueios", "desbloqueios", "limpezas", "meetingPlan", "progressSnapshots", "contatos"];

async function walk(current, excluded = new Set()) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (excluded.has(entry.name)) continue;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute, excluded));
    else if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(absolute);
  }
  return files;
}

function auditEmbeddedData(html, label, findings) {
  const match = html.match(/<script[^>]*id=["']dadosEmbutidos["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return;
  try {
    const state = JSON.parse(match[1]);
    for (const field of OPERATIONAL_ARRAYS) {
      if (Array.isArray(state[field]) && state[field].length > 0) findings.push(`${label}: dados operacionais em ${field}`);
    }
  } catch {
    findings.push(`${label}: bloco dadosEmbutidos inválido`);
  }
}

export async function runSecurityAudit(options = {}) {
  const root = options.root || process.cwd();
  const distribution = options.distribution || path.join(root, "dist", "github-pages");
  const findings = [];
  const sourceFiles = await walk(root, new Set([".git", "node_modules", "dist", ".vinext", ".next", "bin", "obj"]));
  const secretPatterns = [
    [/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, "chave privada PEM"],
    [/["']type["']\s*:\s*["']service_account["']/, "credencial de conta de serviço"],
    [/["']private_key["']\s*:/, "campo private_key"],
    [/\b(?:ADMIN_PASSWORD|OPERATOR_PASSWORD|DEFAULT_PASSWORD|SENHA_PADRAO)\s*[:=]\s*["'][^"']+["']/i, "senha literal"],
  ];
  for (const file of sourceFiles) {
    const content = await readFile(file, "utf8");
    const label = path.relative(root, file).replaceAll("\\", "/");
    secretPatterns.forEach(([pattern, name]) => {
      if (pattern.test(content)) findings.push(`${label}: ${name}`);
    });
    const isPublishedHtml = label === "public/para360-operacional.html"
      || label === "firebase/public/index.html";
    if (isPublishedHtml) auditEmbeddedData(content, label, findings);
  }

  try {
    const distributionFiles = await walk(distribution, new Set());
    for (const file of distributionFiles) {
      const content = await readFile(file, "utf8");
      const label = path.relative(distribution, file).replaceAll("\\", "/");
      if (/sourceMappingURL\s*=/.test(content) || file.endsWith(".map")) findings.push(`${label}: mapa de código publicado`);
      secretPatterns.forEach(([pattern, name]) => {
        if (pattern.test(content)) findings.push(`${label}: ${name}`);
      });
      if (file.endsWith(".html")) auditEmbeddedData(content, label, findings);
    }
    const manifest = JSON.parse(await readFile(path.join(distribution, "version.json"), "utf8"));
    if (!manifest.releaseHash || !manifest.version || manifest.algorithm !== "SHA-256") findings.push("version.json: manifesto incompleto");
  } catch (error) {
    findings.push(`distribuição protegida indisponível: ${error.message}`);
  }

  if (findings.length) throw new Error(`Auditoria de segurança bloqueou a publicação:\n- ${findings.join("\n- ")}`);
  console.log("Auditoria de segurança aprovada: sem segredos, dados embutidos ou mapas de código.");
  return true;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runSecurityAudit();
}
