import { readFile } from "node:fs/promises";
import path from "node:path";

const FALLBACK_GAMES = [
  { name: "Kerbal Space Program", appId: "220200" },
  { name: "Factorio", appId: "427520" },
  { name: "Stardew Valley", appId: "413150" },
  { name: "Satisfactory", appId: "526870" },
  { name: "Deep Rock Galactic", appId: "548430" },
  { name: "Valheim", appId: "892970" },
];

let cache = null;
const MAX_SEARCH_RESULTS = 60;
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

function scoreGame(queryRaw, game) {
  const appId = String(game.appId || "");
  const name = String(game.name || "");
  return scoreText(queryRaw, name) + scoreAppId(queryRaw, appId);
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    return null;
  }
}

export async function loadGames() {
  if (cache) return cache;

  if (process.env.GAMES_JSON) {
    try {
      const parsed = JSON.parse(process.env.GAMES_JSON);
      if (Array.isArray(parsed)) {
        cache = parsed;
        return cache;
      }
    } catch (err) {
      // Ignore malformed env and continue to file fallback.
    }
  }

  const candidates = [
    path.resolve(process.cwd(), "data", "games.json"),
    path.resolve(process.cwd(), "site", "data", "games.json"),
  ];

  for (const candidate of candidates) {
    const parsed = await readJsonIfExists(candidate);
    if (parsed) {
      cache = parsed;
      return cache;
    }
  }

  cache = FALLBACK_GAMES;
  return cache;
}

export function searchGames(games, query) {
  const raw = String(query || "").trim();
  if (!raw) return [];

  const ranked = [];
  for (const game of games) {
    const score = scoreGame(raw, game);
    if (score > 0) {
      ranked.push({ game, score });
    }
  }

  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      String(a.game.name || "").localeCompare(String(b.game.name || ""))
  );

  return ranked.slice(0, MAX_SEARCH_RESULTS).map((entry) => entry.game);
}
