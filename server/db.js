import { MongoClient } from "mongodb";

let cachedClient = null;
let cachedDb = null;
let clientPromise = null;

const uri = process.env.MONGODB_URI ? String(process.env.MONGODB_URI).trim() : "";
const dbName = process.env.MONGODB_DB ? String(process.env.MONGODB_DB).trim() : "";

function hasConfig() {
  return Boolean(uri && dbName);
}

export function isDbEnabled() {
  return hasConfig();
}

async function getClient() {
  if (!hasConfig()) return null;
  if (cachedClient) return cachedClient;
  if (!clientPromise) {
    const client = new MongoClient(uri, {
      maxPoolSize: 8,
      serverSelectionTimeoutMS: 8000,
    });
    clientPromise = client.connect();
  }
  cachedClient = await clientPromise;
  return cachedClient;
}

export async function getDb() {
  if (!hasConfig()) return null;
  if (cachedDb) return cachedDb;
  const client = await getClient();
  if (!client) return null;
  cachedDb = client.db(dbName);
  return cachedDb;
}

export async function getCollection(name) {
  const db = await getDb();
  if (!db || !name) return null;
  return db.collection(name);
}
