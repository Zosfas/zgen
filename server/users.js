import { MongoClient } from "mongodb";

let cachedConfig = null;
let cachedClient = null;
let cachedClientPromise = null;

function trim(value) {
  return String(value || "").trim();
}

function toNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function defaultDailyUses() {
  return Math.max(0, toNumber(process.env.DEFAULT_DAILY_USES, 10));
}

function adminIdSet() {
  const raw = trim(process.env.ADMIN_DISCORD_IDS) || "923472355924267028";
  const ids = raw
    .split(",")
    .map((value) => trim(value))
    .filter(Boolean);
  return new Set(ids);
}

function isAdminUserId(userIdRaw) {
  const userId = trim(userIdRaw);
  if (!userId) return false;
  return adminIdSet().has(userId);
}

function getConfig() {
  if (cachedConfig !== null) return cachedConfig;

  const uri = trim(process.env.MONGODB_URI);
  const dbName = trim(process.env.MONGODB_DB);
  const usersCollection = trim(process.env.MONGODB_USERS_COLLECTION) || "users";

  if (!uri || !dbName) {
    cachedConfig = null;
    return cachedConfig;
  }

  cachedConfig = { uri, dbName, usersCollection };
  return cachedConfig;
}

export function isUserStoreEnabled() {
  return Boolean(getConfig());
}

async function getCollection() {
  const config = getConfig();
  if (!config) return null;

  if (cachedClient) {
    return cachedClient.db(config.dbName).collection(config.usersCollection);
  }

  if (!cachedClientPromise) {
    const client = new MongoClient(config.uri, {
      maxPoolSize: 8,
      serverSelectionTimeoutMS: 8000,
    });
    cachedClientPromise = client.connect();
  }

  try {
    cachedClient = await cachedClientPromise;
  } catch (err) {
    cachedClientPromise = null;
    cachedClient = null;
    throw err;
  }

  return cachedClient.db(config.dbName).collection(config.usersCollection);
}

function toPublicProfile(doc) {
  if (!doc) return null;
  return {
    userId: trim(doc.userId),
    username: trim(doc.username),
    discriminator: trim(doc.discriminator) || "0000",
    avatar: doc.avatar || null,
    usesLeftToday: Number.isFinite(Number(doc.usesLeftToday))
      ? Number(doc.usesLeftToday)
      : null,
    usesDate: trim(doc.usesDate) || null,
    role: trim(doc.role) || null,
    banned: Boolean(doc.banned),
    lastLoginAt: doc.lastLoginAt || null,
  };
}

export async function upsertUserProfile(user, options = {}) {
  const collection = await getCollection();
  if (!collection) return null;

  const userId = trim(user?.id);
  if (!userId) return null;

  const now = new Date();
  const today = todayKey(now);
  const source = trim(options.source) || "unknown";

  const existing = await collection.findOne({ userId });
  const usesLeftToday =
    existing && trim(existing.usesDate) === today
      ? toNumber(existing.usesLeftToday, defaultDailyUses())
      : defaultDailyUses();
  const isAdmin = isAdminUserId(userId);

  const update = {
    userId,
    username: trim(user.username) || "Unknown",
    discriminator: trim(user.discriminator) || "0000",
    avatar: user.avatar || null,
    source,
    usesDate: today,
    usesLeftToday,
    role: isAdmin ? "admin" : existing?.role || null,
    banned: Boolean(existing?.banned),
    lastLoginAt: now,
    updatedAt: now,
  };

  await collection.updateOne(
    { userId },
    {
      $set: update,
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  return toPublicProfile(update);
}

export async function getUserProfile(userIdRaw) {
  const collection = await getCollection();
  if (!collection) return null;

  const userId = trim(userIdRaw);
  if (!userId) return null;

  const doc = await collection.findOne({ userId });
  if (!doc) return null;

  const now = new Date();
  const today = todayKey(now);
  if (isAdminUserId(userId) && trim(doc.role) !== "admin") {
    await collection.updateOne(
      { userId },
      {
        $set: {
          role: "admin",
          updatedAt: now,
        },
      }
    );
    doc.role = "admin";
  }

  const currentUses = toNumber(doc.usesLeftToday, defaultDailyUses());
  if (trim(doc.usesDate) !== today || !Number.isFinite(currentUses)) {
    const nextUses = defaultDailyUses();
    await collection.updateOne(
      { userId },
      {
        $set: {
          usesDate: today,
          usesLeftToday: nextUses,
          updatedAt: now,
        },
      }
    );

    return toPublicProfile({
      ...doc,
      usesDate: today,
      usesLeftToday: nextUses,
    });
  }

  return toPublicProfile(doc);
}

export async function checkDailyUse(userIdRaw) {
  const collection = await getCollection();
  if (!collection) {
    return { allowed: true, remaining: null, reason: null };
  }

  const profile = await getUserProfile(userIdRaw);
  if (!profile) {
    return { allowed: true, remaining: null, reason: null };
  }

  if (profile.banned) {
    return { allowed: false, remaining: 0, reason: "banned" };
  }

  if (!Number.isFinite(profile.usesLeftToday)) {
    return { allowed: true, remaining: null, reason: null };
  }

  if (profile.usesLeftToday <= 0) {
    return { allowed: false, remaining: 0, reason: "limit" };
  }

  return { allowed: true, remaining: profile.usesLeftToday, reason: null };
}

export async function consumeDailyUse(userIdRaw) {
  const collection = await getCollection();
  if (!collection) {
    return { allowed: true, remaining: null, reason: null };
  }

  const check = await checkDailyUse(userIdRaw);
  if (!check.allowed) return check;
  if (!Number.isFinite(check.remaining)) return check;

  const remaining = Math.max(0, Number(check.remaining) - 1);
  await collection.updateOne(
    { userId: trim(userIdRaw) },
    {
      $set: {
        usesLeftToday: remaining,
        updatedAt: new Date(),
      },
    }
  );

  return { allowed: true, remaining, reason: null };
}
