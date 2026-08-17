import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { minify } from "terser";

const COPYRIGHT = "K.A Gestão de Paradas | Copyright (c) 2026 Kisley Adans | Todos os direitos reservados.";
const BANNER = `/*! ${COPYRIGHT} Uso não autorizado proibido. */`;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function minifyJavaScript(source, module = false) {
  const result = await minify(source, {
    module,
    ecma: 2020,
    compress: { passes: 2 },
    mangle: true,
    sourceMap: false,
    format: { comments: false, semicolons: true },
  });
  if (!result.code) throw new Error("A minificação JavaScript não gerou código.");
  return `${BANNER}\n${result.code}\n`;
}

function compactMarkup(fragment) {
  return fragment
    .replace(/<!--(?!\[if)[\s\S]*?-->/gi, "")
    .replace(/>\s+</g, "><");
}

async function protectHtml(source, version) {
  let cursor = 0;
  let output = "";
  const scriptPattern = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const match of source.matchAll(scriptPattern)) {
    output += compactMarkup(source.slice(cursor, match.index));
    const [full, attributes, code] = match;
    const isData = /\btype=["'](?:application\/json|application\/ld\+json)["']/i.test(attributes);
    const isExternal = /\bsrc=/i.test(attributes);
    if (isData || isExternal || !code.trim()) {
      output += full;
    } else {
      output += `<script${attributes}>${await minifyJavaScript(code, /\btype=["']module["']/i.test(attributes))}</script>`;
    }
    cursor = match.index + full.length;
  }
  output += compactMarkup(source.slice(cursor));
  output = output.trim();

  const safeVersion = String(version).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 64);
  const meta = [
    `<meta name="application-version" content="${safeVersion}">`,
    `<meta name="copyright" content="${COPYRIGHT}">`,
    `<meta name="robots" content="noarchive">`,
  ].join("");
  output = output.replace("</head>", `${meta}</head>`);
  return `<!DOCTYPE html>${output.replace(/^<!DOCTYPE html>/i, "")}`;
}

async function listFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, absolute));
    else files.push({ absolute, relative: path.relative(root, absolute).replaceAll("\\", "/") });
  }
  return files;
}

export async function protectPublicBuild(outputDir, options = {}) {
  const rawVersion = String(options.version || "local");
  const version = rawVersion === "local"
    ? `local-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    : rawVersion.slice(0, 40);
  const cacheVersion = version.slice(0, 12);
  const htmlPath = path.join(outputDir, "index.html");
  let html = await readFile(htmlPath, "utf8");
  html = html.replace(/(src=["']\.\/shared-sync\.js)(?:\?[^"']*)?(["'])/i, `$1?v=${cacheVersion}$2`);
  html = await protectHtml(html, version);
  await writeFile(htmlPath, html, "utf8");

  for (const file of ["shared-sync.js", "firebase-sync-core.mjs", "firebase-economic-policy.mjs"]) {
    const absolute = path.join(outputDir, file);
    let source = await readFile(absolute, "utf8");
    source = source.replace(/(\.\/[^"']+\.(?:mjs|js))(?:\?[^"']*)?/g, `$1?v=${cacheVersion}`);
    await writeFile(absolute, await minifyJavaScript(source, true), "utf8");
  }

  const files = (await listFiles(outputDir)).filter((file) => file.relative !== "version.json");
  const hashes = {};
  for (const file of files.sort((a, b) => a.relative.localeCompare(b.relative))) {
    hashes[file.relative] = sha256(await readFile(file.absolute));
  }
  const releaseHash = sha256(Object.entries(hashes).map(([name, hash]) => `${name}:${hash}`).join("\n"));
  const manifest = {
    product: "K.A Gestão de Paradas",
    owner: "Kisley Adans",
    copyright: "Copyright (c) 2026 Kisley Adans. Todos os direitos reservados.",
    version,
    builtAt: new Date().toISOString(),
    algorithm: "SHA-256",
    releaseHash,
    files: hashes,
  };
  await writeFile(path.join(outputDir, "version.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}
