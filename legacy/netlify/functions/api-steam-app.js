import { json } from "./_lib/session.js";
import { isSteamAppId, fetchSteamAppDetails } from "./_lib/steam.js";

export async function handler(event) {
  const appId = String(event.queryStringParameters?.appId || "").trim();
  if (!isSteamAppId(appId)) {
    return json(400, { error: "Invalid appId" });
  }

  const details = await fetchSteamAppDetails(appId);
  if (!details) {
    return json(404, { error: "Steam app not found" });
  }

  return json(200, { app: details });
}
