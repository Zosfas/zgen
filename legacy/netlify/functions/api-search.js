import { json } from "./_lib/session.js";
import { loadGames, searchGames } from "./_lib/games.js";
import { listDriveFiles, searchDriveFiles } from "./_lib/drive.js";
import {
  isSteamAppId,
  fetchSteamAppDetails,
  searchSteamAppsByName,
} from "./_lib/steam.js";

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

export async function handler(event) {
  const query = String(event.queryStringParameters?.q || "").trim();
  if (!query) {
    return json(200, { results: [] });
  }

  const driveMode = process.env.DRIVE_MODE === "drive";

  try {
    const games = await loadGames();

    if (!driveMode) {
      let results = searchGames(games, query).map((game) => ({
        id: String(game.appId),
        appId: String(game.appId),
        name: game.name,
        gameName: game.name,
      }));

      if (!isSteamAppId(query) && results.length < 5) {
        const steamMatches = await searchSteamAppsByName(query, 40);
        const steamResults = steamMatches.map((game) => ({
          id: String(game.appId),
          appId: String(game.appId),
          name: game.name,
          gameName: game.name,
          art:
            game.headerImage ||
            `https://cdn.akamai.steamstatic.com/steam/apps/${String(game.appId)}/header.jpg`,
        }));
        results = mergeResults(results, steamResults);
      }

      if (!results.length && isSteamAppId(query)) {
        const details = await fetchSteamAppDetails(query);
        const appId = String(query);
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

      return json(200, { source: "local", results });
    }

    const folderId = process.env.GOOGLE_FOLDER_ID;
    if (!folderId) {
      return json(400, { error: "Missing GOOGLE_FOLDER_ID" });
    }

    const files = await listDriveFiles(folderId);
    let results = searchDriveFiles(files, query, games);

    if (!isSteamAppId(query) && results.length < 5) {
      const steamMatches = await searchSteamAppsByName(query, 120);
      if (steamMatches.length) {
        const mergedGames = mergeGames(games, steamMatches);
        const enrichedResults = searchDriveFiles(files, query, mergedGames);
        if (enrichedResults.length > results.length) {
          results = enrichedResults;
        }
      }
    }

    if (!results.length && isSteamAppId(query)) {
      const details = await fetchSteamAppDetails(query);
      const appId = String(query);
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

    return json(200, { source: "drive", results });
  } catch (err) {
    return json(500, { error: "Search failed", detail: err.message });
  }
}
