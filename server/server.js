import "dotenv/config";
import express from "express";
import session from "express-session";
import passport from "passport";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configureDiscordAuth, ensureAuthenticated } from "./auth.js";
import {
  upsertGameMapping,
  removeGameMapping,
  findGameMapping,
  searchGameMappings,
  logDownloadEvent,
  createTicket,
  listTickets,
} from "./store.js";
import { isDbEnabled } from "./db.js";
import { isFirebaseEnabled } from "./firebase.js";
import {
  loadLocalGames,
  searchLocal,
  searchDrive,
  loadDriveFiles,
  findDriveFileByAppId,
  streamDriveFile,
} from "./drive.js";
import {
  checkDailyUse,
  consumeDailyUse,
  getUserProfile,
  isUserStoreEnabled,
  upsertUserProfile,
} from "./users.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-me";
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_CALLBACK_URL = process.env.DISCORD_CALLBACK_URL;
const DISCORD_ALLOWED_GUILD = process.env.DISCORD_ALLOWED_GUILD;
const SUPPORT_WEBHOOK_URL = process.env.SUPPORT_WEBHOOK_URL;
const GOOGLE_FOLDER_ID = process.env.GOOGLE_FOLDER_ID;
const GOOGLE_SERVICE_ACCOUNT_PATH =
  process.env.GOOGLE_SERVICE_ACCOUNT_PATH || "./service-account.json";
const DRIVE_MODE = process.env.DRIVE_MODE || "local";
const IS_PROD = process.env.NODE_ENV === "production";
const USER_STORE_ENABLED = isUserStoreEnabled();
const DB_ENABLED = isDbEnabled() || isFirebaseEnabled();
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 120); // requests per 5 minutes
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const rateBuckets = new Map();

let localGames = [];
if (IS_PROD) {
  app.set("trust proxy", 1);
}

function rateLimit(req, res, next) {
  if (RATE_LIMIT_MAX <= 0) return next();
  const key = req.ip || req.headers["x-forwarded-for"] || "unknown";
  const now = Date.now();
  const bucket = rateBuckets.get(key) || { count: 0, start: now };
  if (now - bucket.start > RATE_LIMIT_WINDOW_MS) {
    bucket.count = 0;
    bucket.start = now;
  }
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (bucket.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: "Too many requests" });
  }
  return next();
}

function ensureAdmin(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.user?.role === "admin") return next();
  return res.status(403).json({ error: "Forbidden" });
}

function mergeGames(baseGames, extraGames) {
  const byAppId = new Map();
  for (const game of baseGames || []) {
    const appId = String(game?.appId || "").trim();
    const name = String(game?.name || "").trim();
    if (!appId || !name) continue;
    byAppId.set(appId, { appId, name });
  }
  for (const game of extraGames || []) {
    const appId = String(game?.appId || "").trim();
    const name = String(game?.name || "").trim();
    if (!appId || !name) continue;
    if (!byAppId.has(appId)) {
      byAppId.set(appId, { appId, name });
    }
  }
  return Array.from(byAppId.values());
}

function mergeResults(primary, secondary) {
  const byAppId = new Map();
  for (const row of primary || []) {
    const appId = String(row?.appId || "").trim();
    if (!appId) continue;
    byAppId.set(appId, row);
  }
  for (const row of secondary || []) {
    const appId = String(row?.appId || "").trim();
    if (!appId || byAppId.has(appId)) continue;
    byAppId.set(appId, row);
  }
  return Array.from(byAppId.values());
}

async function fetchSteamAppDetails(appId) {
  const id = String(appId || "").trim();
  if (!/^\d+$/.test(id)) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${id}&l=english`,
      { signal: controller.signal }
    );
    if (!response.ok) return null;
    const payload = await response.json();
    const entry = payload?.[id];
    if (!entry || !entry.success || !entry.data) return null;
    return {
      appId: id,
      name: entry.data.name || null,
      headerImage: entry.data.header_image || null,
      type: entry.data.type || null,
    };
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function searchSteamAppsByName(query, limit = 80) {
  const term = String(query || "").trim();
  if (!term) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  try {
    const response = await fetch(
      `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(
        term
      )}&l=english&cc=us`,
      { signal: controller.signal }
    );
    if (!response.ok) return [];

    const payload = await response.json();
    const items = Array.isArray(payload?.items) ? payload.items : [];
    return items.slice(0, Math.max(1, Number(limit) || 80)).map((item) => ({
      appId: String(item.id),
      name: String(item.name || `App ${item.id}`),
    }));
  } catch (error) {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

app.use(express.json());
app.use(rateLimit);
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", secure: IS_PROD },
  })
);

const discordEnabled =
  DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && DISCORD_CALLBACK_URL;

if (discordEnabled) {
  configureDiscordAuth({
    clientID: DISCORD_CLIENT_ID,
    clientSecret: DISCORD_CLIENT_SECRET,
    callbackURL: DISCORD_CALLBACK_URL,
    allowedGuild: DISCORD_ALLOWED_GUILD,
  });

  app.use(passport.initialize());
  app.use(passport.session());

  app.get("/auth/discord", passport.authenticate("discord"));
  app.get(
    "/auth/discord/callback",
    passport.authenticate("discord", { failureRedirect: "/login-failed.html" }),
    async (req, res) => {
      try {
        await upsertUserProfile(req.user, { source: "discord" });
      } catch (err) {
        // Ignore user-store failures and continue login flow.
      }
      res.redirect("/welcome-user.html");
    }
  );
} else {
  console.warn("Discord OAuth is not configured. Set DISCORD_* env vars.");
  app.get("/auth/discord", (req, res) => {
    res.redirect("/auth/demo");
  });
  app.get("/auth/discord/callback", (req, res) => {
    res.redirect("/login-failed.html");
  });
}

app.post("/auth/logout", (req, res) => {
  const finish = () => {
    if (req.session) {
      req.session.demoUser = null;
    }
    res.json({ ok: true });
  };
  if (req.logout) {
    req.logout(finish);
  } else {
    finish();
  }
});

app.get("/auth/demo", (req, res) => {
  const demoUser = {
    id: "demo",
    username: "DemoUser",
    discriminator: "0000",
    avatar: null,
  };
  if (req.session) {
    req.session.demoUser = demoUser;
  }
  upsertUserProfile(demoUser, { source: "demo" }).catch(() => {});
  res.redirect("/welcome-user.html");
});

app.get("/api/me", async (req, res) => {
  let sessionUser = null;

  if (req.isAuthenticated && req.isAuthenticated()) {
    sessionUser = req.user;
  } else if (req.session && req.session.demoUser) {
    sessionUser = req.session.demoUser;
  }

  if (!sessionUser) {
    return res.json({ user: null });
  }

  if (!USER_STORE_ENABLED) {
    return res.json({ user: sessionUser });
  }

  try {
    let profile = await getUserProfile(sessionUser.id);
    if (!profile) {
      profile = await upsertUserProfile(sessionUser, { source: "session" });
    }

    return res.json({
      user: {
        ...sessionUser,
        usesLeftToday: profile?.usesLeftToday ?? null,
        role: profile?.role || null,
        banned: Boolean(profile?.banned),
      },
    });
  } catch (err) {
    return res.json({ user: sessionUser });
  }
});

app.get("/api/search", async (req, res) => {
  const query = String(req.query.q || "");
  if (!query.trim()) {
    return res.json({ results: [] });
  }

  try {
    let dbMatches = [];
    if (DB_ENABLED) {
      dbMatches = await searchGameMappings(query, { limit: 80 });
    }

    if (DRIVE_MODE === "drive") {
      if (!GOOGLE_FOLDER_ID) {
        return res.status(400).json({ error: "Missing GOOGLE_FOLDER_ID" });
      }
      const driveResults = await searchDrive({
        folderId: GOOGLE_FOLDER_ID,
        query,
        serviceAccountPath: GOOGLE_SERVICE_ACCOUNT_PATH,
        localGames,
      });
      let results = driveResults;

      if (dbMatches.length) {
        const merged = mergeResults(
          dbMatches.map((g) => ({
            id: g.fileId || g.appId,
            appId: g.appId,
            name: g.name,
            gameName: g.name,
            art:
              g.art ||
              `https://cdn.akamai.steamstatic.com/steam/apps/${g.appId}/header.jpg`,
            size: g.sizeBytes || null,
            fileId: g.fileId || null,
          })),
          driveResults
        );
        results = merged;
      }

      if (!/^\d+$/.test(query.trim()) && results.length < 5) {
        const steamMatches = await searchSteamAppsByName(query, 120);
        if (steamMatches.length) {
          const mergedGames = mergeGames(localGames, steamMatches);
          const enrichedResults = await searchDrive({
            folderId: GOOGLE_FOLDER_ID,
            query,
            serviceAccountPath: GOOGLE_SERVICE_ACCOUNT_PATH,
            localGames: mergedGames,
          });
          if (enrichedResults.length > results.length) {
            results = enrichedResults;
          }
        }
      }
      if (!results.length && /^\d+$/.test(query.trim())) {
        const appId = query.trim();
        const details = await fetchSteamAppDetails(appId);
        results = [
          {
            id: appId,
            appId,
            name: details?.name || `App ${appId}`,
            gameName: details?.name || null,
            art:
              details?.headerImage ||
              `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
          },
        ];
      }
      return res.json({ results, source: "drive" });
    }

    let results = [];

    if (dbMatches.length) {
      results = dbMatches.map((g) => ({
        id: g.fileId || g.appId,
        appId: g.appId,
        name: g.name,
        gameName: g.name,
        art:
          g.art ||
          `https://cdn.akamai.steamstatic.com/steam/apps/${g.appId}/header.jpg`,
        size: g.sizeBytes || null,
        fileId: g.fileId || null,
      }));
    }

    const localResults = searchLocal(localGames, query).map((game) => ({
      name: game.name,
      appId: game.appId,
      id: game.appId,
    }));
    results = mergeResults(results, localResults);

    if (!/^\d+$/.test(query.trim()) && results.length < 5) {
      const steamMatches = await searchSteamAppsByName(query, 40);
      const steamResults = steamMatches.map((game) => ({
        id: String(game.appId),
        appId: String(game.appId),
        name: game.name,
        gameName: game.name,
        art: `https://cdn.akamai.steamstatic.com/steam/apps/${String(game.appId)}/header.jpg`,
      }));
      results = mergeResults(results, steamResults);
    }
    if (!results.length && /^\d+$/.test(query.trim())) {
      const appId = query.trim();
      const details = await fetchSteamAppDetails(appId);
      results = [
        {
          id: appId,
          appId,
          name: details?.name || `App ${appId}`,
          gameName: details?.name || null,
          art:
            details?.headerImage ||
            `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
        },
      ];
    }
    return res.json({ results, source: "local" });
  } catch (error) {
    return res.status(500).json({ error: "Search failed" });
  }
});

app.get("/api/steam-app", async (req, res) => {
  const appId = String(req.query.appId || "").trim();
  if (!/^\d+$/.test(appId)) {
    return res.status(400).json({ error: "Invalid appId" });
  }

  const details = await fetchSteamAppDetails(appId);
  if (!details) {
    return res.status(404).json({ error: "Steam app not found" });
  }
  return res.json({ app: details });
});

app.get("/api/admin/games", ensureAuthenticated, ensureAdmin, async (req, res) => {
  const q = String(req.query.q || "").trim();
  const results = DB_ENABLED ? await searchGameMappings(q || "", { limit: 200 }) : [];
  res.json({ results });
});

app.post("/api/admin/games", ensureAuthenticated, ensureAdmin, async (req, res) => {
  if (!DB_ENABLED) return res.status(501).json({ error: "Database disabled" });
  const { appId, name, fileId, sizeBytes, art } = req.body || {};
  if (!appId || !fileId) return res.status(400).json({ error: "appId and fileId required" });
  const doc = await upsertGameMapping({ appId, name, fileId, sizeBytes, art });
  res.json({ mapping: doc });
});

app.delete("/api/admin/games/:appId", ensureAuthenticated, ensureAdmin, async (req, res) => {
  if (!DB_ENABLED) return res.status(501).json({ error: "Database disabled" });
  const appId = req.params.appId;
  if (!appId) return res.status(400).json({ error: "appId required" });
  await removeGameMapping(appId);
  res.json({ ok: true });
});

app.get("/api/download", ensureAuthenticated, async (req, res) => {
  try {
    const requestedId = String(req.query.id || "");
    if (!requestedId) {
      return res.status(400).json({ error: "Missing file id" });
    }

    if (USER_STORE_ENABLED && req.user?.id) {
      const usage = await checkDailyUse(req.user.id);
      if (!usage.allowed) {
        if (usage.reason === "banned") {
          return res.status(403).json({ error: "Account is restricted" });
        }
        return res.status(429).json({ error: "Daily download limit reached" });
      }
    }

    if (DRIVE_MODE !== "drive") {
      const filename = `${requestedId}.txt`;
      res.setHeader("Content-Type", "text/plain");
      res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
      res.send(
        `Demo download for App ID ${requestedId}\\n\\n` +
          `This is a placeholder file. Enable DRIVE_MODE=drive to stream real files.\\n`
      );
      if (USER_STORE_ENABLED && req.user?.id) {
        consumeDailyUse(req.user.id).catch(() => {});
      }
      logDownloadEvent({
        userId: req.user?.id,
        appId: requestedId,
        fileId: requestedId,
        status: "demo",
      }).catch(() => {});
      return;
    }

    if (!GOOGLE_FOLDER_ID) {
      return res.status(400).json({ error: "Missing GOOGLE_FOLDER_ID" });
    }

    let fileId = requestedId;
    let appIdForLog = requestedId;

    if (DB_ENABLED && /^\d+$/.test(requestedId)) {
      const mapping = await findGameMapping(requestedId);
      if (mapping?.fileId) {
        fileId = mapping.fileId;
        appIdForLog = mapping.appId || requestedId;
      }
    }

    if (/^\d+$/.test(requestedId)) {
      const files = await loadDriveFiles({
        folderId: GOOGLE_FOLDER_ID,
        serviceAccountPath: GOOGLE_SERVICE_ACCOUNT_PATH,
      });
      const matched = findDriveFileByAppId(files, requestedId);
      if (!matched) {
        return res.status(404).json({ error: "Drive file not found for App ID" });
      }
      fileId = matched.id;
    }

    res.setHeader("Content-Disposition", "attachment");
    await streamDriveFile({
      fileId,
      res,
      serviceAccountPath: GOOGLE_SERVICE_ACCOUNT_PATH,
    });
    if (USER_STORE_ENABLED && req.user?.id) {
      consumeDailyUse(req.user.id).catch(() => {});
    }
    logDownloadEvent({
      userId: req.user?.id,
      appId: appIdForLog,
      fileId,
      status: "ok",
    }).catch(() => {});
  } catch (error) {
    logDownloadEvent({
      userId: req.user?.id,
      appId: String(req.query.id || ""),
      fileId: null,
      status: "error",
    }).catch(() => {});
    res.status(500).json({ error: "Download failed" });
  }
});

app.post("/api/support", ensureAuthenticated, async (req, res) => {
  try {
    if (!DB_ENABLED) return res.status(501).json({ error: "Support storage disabled" });
    const topic = String(req.body?.topic || "").trim() || "General";
    const body = String(req.body?.body || "").trim();
    const ticket = await createTicket({
      userId: req.user?.id,
      username: req.user?.username,
      topic,
      body,
    });

    if (SUPPORT_WEBHOOK_URL) {
      fetch(SUPPORT_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: `New support ticket from ${req.user?.username || "user"} (${req.user?.id || "unknown"}): ${topic}\n${body}`,
        }),
      }).catch(() => {});
    }

    res.json({ ticket });
  } catch (error) {
    res.status(500).json({ error: "Support request failed" });
  }
});

app.get("/api/admin/tickets", ensureAuthenticated, ensureAdmin, async (req, res) => {
  if (!DB_ENABLED) return res.status(501).json({ error: "Ticket storage disabled" });
  const tickets = await listTickets({ limit: 200 });
  res.json({ tickets });
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

const sitePath = path.resolve(__dirname, "..", "site");
app.use(express.static(sitePath));

app.get("*", (req, res) => {
  res.sendFile(path.join(sitePath, "index.html"));
});

async function start() {
  localGames = await loadLocalGames();
  app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
  });
}

start();
