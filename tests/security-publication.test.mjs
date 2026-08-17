import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  ADMIN_EMAIL,
  accessRecordForUser,
  collectDisciplineMappings,
  disciplineEmail,
  normalizeDiscipline,
} from "../firebase/functions/discipline-access-policy.mjs";

const root = process.cwd();
const output = path.join(root, "dist", "github-pages");

test("normalização e e-mail da disciplina são determinísticos", () => {
  assert.equal(normalizeDiscipline(" Elétrica Bloqueio "), "ELETRICA BLOQUEIO");
  assert.equal(disciplineEmail(" Elétrica Bloqueio "), "eletrica-bloqueio@ka-paradas.app");
});

test("ACL vincula UID administrativo e disciplina sem confiar no formulário", () => {
  const mappings = collectDisciplineMappings({
    bucketDocs: [{ entries: [{ activity: { disciplina: "Mecânica" } }] }],
  });
  const admin = accessRecordForUser({ uid: "admin-uid", email: ADMIN_EMAIL, disabled: false }, mappings);
  const discipline = accessRecordForUser({ uid: "discipline-uid", email: "mecanica@ka-paradas.app", disabled: false }, mappings);
  const unknown = accessRecordForUser({ uid: "other-uid", email: "outra@ka-paradas.app", disabled: false }, mappings);
  assert.deepEqual(admin, {
    role: "admin", email: ADMIN_EMAIL, disciplineKey: "", disciplineName: "Administração", enabled: true,
  });
  assert.equal(discipline.role, "discipline");
  assert.equal(discipline.disciplineKey, "MECANICA");
  assert.equal(unknown.enabled, false);
});

test("regras exigem ACL do servidor e não expõem a coleção", async () => {
  const rules = await readFile(path.join(root, "firestore.rules"), "utf8");
  assert.match(rules, /ka_discipline_access\/\$\(request\.auth\.uid\)/);
  assert.match(rules, /canEditDiscipline\(request\.resource\.data\.disciplineKey/);
  assert.match(rules, /match \/ka_discipline_access\/\{document\}[\s\S]*allow read, write: if false;/);
  assert.doesNotMatch(rules, /isSharedEditor\(\) \|\| request\.resource\.data\.editorEmail/);
});

test("publicação está minificada, identificada e sem mapas de código", async () => {
  const [html, sync, manifestText, license, notice] = await Promise.all([
    readFile(path.join(output, "index.html"), "utf8"),
    readFile(path.join(output, "shared-sync.js"), "utf8"),
    readFile(path.join(output, "version.json"), "utf8"),
    readFile(path.join(root, "LICENSE"), "utf8"),
    readFile(path.join(root, "NOTICE"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.match(html, /name="application-version"/);
  assert.doesNotMatch(html, /<!--(?!\[if)/);
  assert.match(sync, /^\/\*! K\.A Gestão de Paradas/);
  assert.doesNotMatch(sync, /sourceMappingURL/);
  assert.equal(manifest.algorithm, "SHA-256");
  assert.equal(manifest.files["index.html"], createHash("sha256").update(html).digest("hex"));
  assert.equal(manifest.files["shared-sync.js"], createHash("sha256").update(sync).digest("hex"));
  assert.match(license, /Todos os direitos reservados/i);
  assert.match(notice, /Kisley Adans/);
});
