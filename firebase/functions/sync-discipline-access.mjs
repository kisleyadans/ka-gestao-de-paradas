import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import {
  ADMIN_EMAIL,
  accessRecordForUser,
  collectDisciplineMappings,
} from "./discipline-access-policy.mjs";

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
if (!projectId) throw new Error("FIREBASE_PROJECT_ID não informado.");

const app = getApps()[0] || initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore(app);
const auth = getAuth(app);

async function readCollection(name) {
  const snapshot = await db.collection(name).get();
  return snapshot.docs.map((document) => document.data());
}

async function listUsers() {
  const users = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

const [bucketDocs, progressV2, progressV3, progressV4, users] = await Promise.all([
  readCollection("ka_free_activity_buckets_v2"),
  readCollection("ka_discipline_progress_v2"),
  readCollection("ka_discipline_progress_groups_v3"),
  readCollection("ka_discipline_progress_v4"),
  listUsers(),
]);

const mappings = collectDisciplineMappings({
  bucketDocs,
  progressDocs: [...progressV2, ...progressV3, ...progressV4],
});
if (mappings.size === 0) {
  throw new Error("Nenhuma disciplina foi localizada. As regras não serão publicadas sem a ACL inicial.");
}

const records = users
  .map((user) => ({ uid: user.uid, record: accessRecordForUser(user, mappings, ADMIN_EMAIL) }))
  .filter(({ record }) => record);
if (!records.some(({ record }) => record.role === "admin" && record.enabled)) {
  throw new Error(`A conta administrativa ${ADMIN_EMAIL} não foi localizada ou está desativada.`);
}

for (let offset = 0; offset < records.length; offset += 450) {
  const batch = db.batch();
  for (const { uid, record } of records.slice(offset, offset + 450)) {
    batch.set(db.collection("ka_discipline_access").doc(uid), {
      ...record,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}

const enabledDisciplines = records.filter(({ record }) => record.role === "discipline" && record.enabled).length;
const disabledUsers = records.filter(({ record }) => !record.enabled).length;
console.log(`ACL sincronizada: ${enabledDisciplines} disciplina(s), 1 administrador, ${disabledUsers} conta(s) sem acesso.`);
