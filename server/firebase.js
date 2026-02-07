import admin from "firebase-admin";
import { readFileSync } from "node:fs";

let firestore = null;

function loadServiceAccount() {
  // Priority: BASE64 JSON -> FILE PATH -> RAW KEY ENV (not recommended)
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const json = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8");
    return JSON.parse(json);
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const json = readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, "utf8");
    return JSON.parse(json);
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;
  if (projectId && clientEmail && privateKeyRaw) {
    const privateKey = privateKeyRaw.replace(/\\n/g, "\n");
    return { projectId, clientEmail, privateKey };
  }

  return null;
}

export function isFirebaseEnabled() {
  return Boolean(process.env.FIREBASE_PROJECT_ID);
}

export function getFirestore() {
  if (!isFirebaseEnabled()) return null;
  if (firestore) return firestore;

  const sa = loadServiceAccount();
  if (!sa) return null;

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(sa),
      projectId: sa.projectId || process.env.FIREBASE_PROJECT_ID,
    });
  }
  firestore = admin.firestore();
  return firestore;
}

export function serverTimestamp() {
  if (!isFirebaseEnabled()) return new Date();
  return admin.firestore.FieldValue.serverTimestamp();
}
