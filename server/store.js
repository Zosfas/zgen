import { getCollection } from "./db.js";
import { getFirestore, isFirebaseEnabled, serverTimestamp } from "./firebase.js";
import { trim } from "./util.js";

const gamesCollectionName =
  process.env.MONGODB_GAMES_COLLECTION?.trim() || "games";
const ticketsCollectionName =
  process.env.MONGODB_TICKETS_COLLECTION?.trim() || "tickets";
const downloadsCollectionName =
  process.env.MONGODB_DOWNLOADS_COLLECTION?.trim() || "downloads";

function adminTimestamp() {
  return serverTimestamp();
}

function toNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export async function upsertGameMapping({ appId, name, fileId, sizeBytes, art }) {
  if (isFirebaseEnabled()) {
    const db = getFirestore();
    if (!db) return null;
    const docRef = db.collection(gamesCollectionName).doc(trim(appId));
    const now = new Date();
    const payload = {
      appId: trim(appId),
      name: trim(name) || null,
      fileId: trim(fileId) || null,
      sizeBytes: toNumber(sizeBytes, null),
      art: trim(art) || null,
      updatedAt: now.toISOString(),
    };
    await docRef.set(
      {
        ...payload,
        createdAt: adminTimestamp(docRef),
      },
      { merge: true }
    );
    return payload;
  }

  const collection = await getCollection(gamesCollectionName);
  if (!collection) return null;
  const id = trim(appId);
  if (!id) return null;
  const now = new Date();
  const doc = {
    appId: id,
    name: trim(name) || null,
    fileId: trim(fileId) || null,
    sizeBytes: toNumber(sizeBytes, null),
    art: trim(art) || null,
    updatedAt: now,
  };
  await collection.updateOne({ appId: id }, { $set: doc, $setOnInsert: { createdAt: now } }, { upsert: true });
  return doc;
}

export async function removeGameMapping(appId) {
  if (isFirebaseEnabled()) {
    const db = getFirestore();
    if (!db) return null;
    await db.collection(gamesCollectionName).doc(trim(appId)).delete();
    return { ok: true };
  }

  const collection = await getCollection(gamesCollectionName);
  if (!collection) return null;
  const id = trim(appId);
  if (!id) return null;
  return collection.deleteOne({ appId: id });
}

export async function findGameMapping(appId) {
  if (isFirebaseEnabled()) {
    const db = getFirestore();
    if (!db) return null;
    const snap = await db.collection(gamesCollectionName).doc(trim(appId)).get();
    return snap.exists ? snap.data() : null;
  }

  const collection = await getCollection(gamesCollectionName);
  if (!collection) return null;
  return collection.findOne({ appId: trim(appId) });
}

export async function searchGameMappings(query, { limit = 80 } = {}) {
  if (isFirebaseEnabled()) {
    // Firestore has no native regex; for now, scan a limited set.
    const db = getFirestore();
    if (!db) return [];
    const q = trim(query);
    if (!q) return [];
    const isId = /^\d+$/.test(q);
    // Strategy: check doc by id, then fetch a small set ordered by nameLower and filter client-side.
    const results = [];
    if (isId) {
      const hit = await findGameMapping(q);
      if (hit) results.push(hit);
    }
    const snap = await db.collection(gamesCollectionName).limit(Math.max(50, limit)).get();
    snap.forEach((doc) => {
      const data = doc.data();
      if (results.length >= limit) return;
      const name = (data.name || "").toLowerCase();
      const appId = String(data.appId || "");
      const ql = q.toLowerCase();
      if (appId.includes(q) || name.includes(ql)) {
        results.push(data);
      }
    });
    return results.slice(0, limit);
  }

  const collection = await getCollection(gamesCollectionName);
  if (!collection) return [];
  const q = trim(query);
  if (!q) return [];
  const isId = /^\d+$/.test(q);
  const filter = isId
    ? { appId: { $regex: q, $options: "i" } }
    : {
        $or: [
          { name: { $regex: q, $options: "i" } },
          { appId: { $regex: q, $options: "i" } },
        ],
      };
  const cursor = collection
    .find(filter)
    .limit(Math.max(10, limit))
    .project({ _id: 0 });
  const docs = await cursor.toArray();
  return docs;
}

export async function logDownloadEvent({ userId, appId, fileId, status }) {
  if (isFirebaseEnabled()) {
    const db = getFirestore();
    if (!db) return;
    await db.collection(downloadsCollectionName).add({
      userId: trim(userId) || null,
      appId: trim(appId) || null,
      fileId: trim(fileId) || null,
      status: trim(status) || "unknown",
      createdAt: adminTimestamp(),
    });
    return;
  }

  const collection = await getCollection(downloadsCollectionName);
  if (!collection) return;
  const now = new Date();
  await collection.insertOne({
    userId: trim(userId) || null,
    appId: trim(appId) || null,
    fileId: trim(fileId) || null,
    status: trim(status) || "unknown",
    createdAt: now,
  });
}

export async function createTicket({ userId, username, topic, body }) {
  if (isFirebaseEnabled()) {
    const db = getFirestore();
    if (!db) return null;
    const now = adminTimestamp();
    const doc = {
      userId: trim(userId) || null,
      username: trim(username) || "Unknown",
      topic: trim(topic) || "Other",
      body: trim(body) || "",
      status: "open",
      createdAt: now,
      updatedAt: now,
    };
    await db.collection(ticketsCollectionName).add(doc);
    return doc;
  }

  const collection = await getCollection(ticketsCollectionName);
  if (!collection) return null;
  const now = new Date();
  const doc = {
    userId: trim(userId) || null,
    username: trim(username) || "Unknown",
    topic: trim(topic) || "Other",
    body: trim(body) || "",
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
  await collection.insertOne(doc);
  return doc;
}

export async function listTickets({ limit = 100 } = {}) {
  if (isFirebaseEnabled()) {
    const db = getFirestore();
    if (!db) return [];
    const snap = await db
      .collection(ticketsCollectionName)
      .orderBy("createdAt", "desc")
      .limit(Math.max(10, limit))
      .get();
    return snap.docs.map((d) => d.data());
  }

  const collection = await getCollection(ticketsCollectionName);
  if (!collection) return [];
  const cursor = collection
    .find({})
    .sort({ createdAt: -1 })
    .limit(Math.max(10, limit))
    .project({ _id: 0 });
  return cursor.toArray();
}

export async function updateTicketStatus(idOrUserRef, status) {
  if (isFirebaseEnabled()) {
    const db = getFirestore();
    if (!db) return null;
    const statusValue = trim(status);
    if (!statusValue) return null;
    await db
      .collection(ticketsCollectionName)
      .doc(String(idOrUserRef))
      .set({ status: statusValue, updatedAt: adminTimestamp() }, { merge: true });
    return { ok: true };
  }

  const collection = await getCollection(ticketsCollectionName);
  if (!collection) return null;
  const statusValue = trim(status);
  if (!statusValue) return null;
  return collection.updateOne(
    { _id: idOrUserRef },
    { $set: { status: statusValue, updatedAt: new Date() } }
  );
}
