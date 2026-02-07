import { getCollection } from "./db.js";
import { trim } from "./util.js";

const gamesCollectionName =
  process.env.MONGODB_GAMES_COLLECTION?.trim() || "games";
const ticketsCollectionName =
  process.env.MONGODB_TICKETS_COLLECTION?.trim() || "tickets";
const downloadsCollectionName =
  process.env.MONGODB_DOWNLOADS_COLLECTION?.trim() || "downloads";

function toNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export async function upsertGameMapping({ appId, name, fileId, sizeBytes, art }) {
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
  const collection = await getCollection(gamesCollectionName);
  if (!collection) return null;
  const id = trim(appId);
  if (!id) return null;
  return collection.deleteOne({ appId: id });
}

export async function findGameMapping(appId) {
  const collection = await getCollection(gamesCollectionName);
  if (!collection) return null;
  return collection.findOne({ appId: trim(appId) });
}

export async function searchGameMappings(query, { limit = 80 } = {}) {
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
  const collection = await getCollection(ticketsCollectionName);
  if (!collection) return null;
  const statusValue = trim(status);
  if (!statusValue) return null;
  return collection.updateOne(
    { _id: idOrUserRef },
    { $set: { status: statusValue, updatedAt: new Date() } }
  );
}
