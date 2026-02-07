import { readFile } from "node:fs/promises";
import path from "node:path";
import { google } from "googleapis";

const cache = new Map();
const CACHE_TTL_MS = 60_000;
const ROMAN_NUMERALS = {
  i: "1",
  ii: "2",
  iii: "3",
  iv: "4",
  v: "5",
  vi: "6",
  vii: "7",
  viii: "8",
  ix: "9",
  x: "10",
};

function now() {
  return Date.now();
}

function normalize(text) {
  const cleaned = String(text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

  if (!cleaned) return "";
  return cleaned
    .split(" ")
    .map((token) => ROMAN_NUMERALS[token] || token)
    .join(" ");
}

function compact(text) {
  return normalize(text).replace(/\s+/g, "");
}

function tokens(text) {
  const normalized = normalize(text);
  return normalized ? normalized.split(" ") : [];
}

function acronym(text) {
  const list = tokens(text);
  if (!list.length) return "";
  return list.map((token) => token[0]).join("");
}

function isSubsequence(needle, haystack) {
  if (!needle || !haystack) return false;
  let index = 0;
  for (let i = 0; i < haystack.length && index < needle.length; i += 1) {
    if (needle[index] === haystack[i]) {
      index += 1;
    }
  }
  return index === needle.length;
}

function scoreText(queryRaw, targetRaw) {
  const q = normalize(queryRaw);
  const t = normalize(targetRaw);
  if (!q || !t) return 0;

  const qCompact = compact(q);
  const tCompact = compact(t);
  const qTokens = tokens(q);
  const tTokens = tokens(t);
  const targetAcronym = acronym(t);

  let score = 0;

  if (q === t) score += 2200;
  if (t.startsWith(q)) score += 1300;
  if (t.includes(q)) score += 900;

  if (qTokens.length && qTokens.every((token) => tTokens.includes(token))) {
    score += 680;
  }
  if (
    qTokens.length &&
    qTokens.every((token) => tTokens.some((targetToken) => targetToken.startsWith(token)))
  ) {
    score += 540;
  }

  for (const token of qTokens) {
    if (token.length >= 2 && tTokens.some((targetToken) => targetToken.startsWith(token))) {
      score += 42;
    }
  }

  if (qCompact.length >= 3 && tCompact.includes(qCompact)) {
    score += 580;
  }
  if (qCompact.length >= 4 && isSubsequence(qCompact, tCompact)) {
    score += 240;
  }
  if (targetAcronym && qCompact.length >= 2) {
    if (qCompact === targetAcronym) score += 1500;
    else if (targetAcronym.startsWith(qCompact)) score += 900;
    else if (isSubsequence(qCompact, targetAcronym)) score += 450;
  }

  score -= Math.min(220, Math.abs(tCompact.length - qCompact.length) * 3);
  return score;
}

function scoreAppId(queryRaw, appIdRaw) {
  const query = String(queryRaw || "").trim();
  const appId = String(appIdRaw || "").trim();
  if (!/^\d+$/.test(query) || !appId) return 0;
  if (query === appId) return 3000;
  if (appId.startsWith(query)) return 1700;
  if (appId.includes(query)) return 1200;
  return 0;
}

function toAppIdFromName(name) {
  const base = String(name || "").replace(/\.[^.]+$/, "").trim();
  if (!base) return null;

  const tokens = base.match(/\d{2,10}/g);
  if (!tokens || !tokens.length) return null;

  const leading = base.match(/^\d{2,10}/);
  if (leading) return leading[0];

  return tokens[0];
}

export async function loadLocalGames() {
  const filePath = path.resolve("data", "games.json");
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw);
}

export function searchLocal(games, query) {
  const raw = String(query || "").trim();
  if (!raw) return [];

  const ranked = [];
  for (const game of games) {
    const score =
      scoreText(raw, String(game.name || "")) + scoreAppId(raw, String(game.appId || ""));
    if (score > 0) {
      ranked.push({ game, score });
    }
  }

  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      String(a.game.name || "").localeCompare(String(b.game.name || ""))
  );
  return ranked.slice(0, 60).map((entry) => entry.game);
}

async function getDriveClient(serviceAccountPath) {
  let credentials = null;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_BASE64) {
    const raw = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8");
    credentials = JSON.parse(raw);
  }

  const auth = new google.auth.GoogleAuth(
    credentials
      ? {
          credentials,
          scopes: ["https://www.googleapis.com/auth/drive.readonly"],
        }
      : {
          keyFile: serviceAccountPath,
          scopes: ["https://www.googleapis.com/auth/drive.readonly"],
        }
  );
  return google.drive({ version: "v3", auth });
}

export async function searchDrive({
  folderId,
  query,
  serviceAccountPath,
  localGames = [],
}) {
  const files = await loadDriveFiles({ folderId, serviceAccountPath });
  return filterDriveResults(files, query, localGames);
}

export function findDriveFileByAppId(files, appId) {
  const target = normalize(String(appId));
  return files.find((file) => {
    const fileAppId = toAppIdFromName(file.name);
    return normalize(fileAppId || "") === target;
  });
}

function filterDriveResults(files, query, localGames = []) {
  const raw = String(query || "").trim();
  if (!raw) return [];

  const nameMap = new Map();
  for (const game of localGames) {
    nameMap.set(String(game.appId), game.name);
  }

  const ranked = files
    .map((file) => {
      const appId = toAppIdFromName(file.name);
      const gameName = appId ? nameMap.get(appId) || "" : "";
      const nameScore = scoreText(raw, gameName);
      const fileScore = scoreText(raw, file.name || "");
      const idScore = scoreAppId(raw, appId || "");
      const score = Math.round(nameScore * 1.25 + fileScore * 0.65 + idScore);
      if (score <= 0) return null;
      return { file, appId, gameName, score };
    })
    .filter(Boolean);

  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      String(a.gameName || a.file.name || "").localeCompare(String(b.gameName || b.file.name || ""))
  );

  return ranked.slice(0, 60).map(({ file, appId, gameName }) => ({
    id: file.id,
    name: file.name,
    appId,
    gameName: gameName || null,
    size: file.size ? Number(file.size) : null,
    modifiedTime: file.modifiedTime,
  }));
}

export async function loadDriveFiles({ folderId, serviceAccountPath }) {
  const cacheKey = `drive:${folderId}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now()) {
    return cached.files;
  }

  const drive = await getDriveClient(serviceAccountPath);
  const files = [];
  let pageToken;

  do {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, size, modifiedTime)",
      pageSize: 1000,
      pageToken,
    });

    files.push(...(response.data.files || []));
    pageToken = response.data.nextPageToken;
  } while (pageToken);

  cache.set(cacheKey, { files, expiresAt: now() + CACHE_TTL_MS });
  return files;
}

export async function streamDriveFile({ fileId, res, serviceAccountPath }) {
  const drive = await getDriveClient(serviceAccountPath);
  const response = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" }
  );

  return new Promise((resolve, reject) => {
    response.data
      .on("end", resolve)
      .on("error", reject)
      .pipe(res);
  });
}
