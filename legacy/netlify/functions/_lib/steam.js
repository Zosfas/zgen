function isNumericId(value) {
  return /^\d+$/.test(String(value || "").trim());
}

export async function fetchSteamAppDetails(appId) {
  const id = String(appId || "").trim();
  if (!isNumericId(id)) return null;

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
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchSteamAppsByName(query, limit = 80) {
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
      headerImage:
        item?.tiny_image || `https://cdn.akamai.steamstatic.com/steam/apps/${item.id}/header.jpg`,
    }));
  } catch (err) {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export function isSteamAppId(value) {
  return isNumericId(value);
}
