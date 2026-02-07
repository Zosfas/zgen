// Shared UI wiring for API mode and local demo fallback mode.
const searchInput = document.querySelector("#query");
const searchButton = document.querySelector(".search-btn");
const resultList = document.querySelector(".result-list");
const pillResults = document.querySelector(".pill-results");
const centerCard = document.querySelector(".center-card");
const statusDot = document.querySelector(".status-dot");
const hint = document.querySelector(".hint");
const userTitle = document.querySelector(".user-title");
const userSub = document.querySelector(".user-sub");
const searchHistoryEl = document.querySelector("#search-history");
const downloadHistoryEl = document.querySelector("#download-history");

const SEARCH_HISTORY_KEY = "recentSearches";
const DOWNLOAD_HISTORY_KEY = "recentDownloads";
const HISTORY_LIMIT = 12;
const MAX_SUGGESTIONS = 8;

let apiAvailable = null;
let localGamesCache = null;
let artMapCache = null;
const MAX_LOCAL_RESULTS = 60;
const suggestionCache = new Map();
let suggestionItems = [];
let activeSuggestionIndex = -1;
let suggestionBox = null;
let suggestionTimer = null;
let suggestionSeq = 0;
const SUPPORT_TOPICS = ["Game file", "Site not working", "Error on launch", "Can't join giveaway", "Online", "Others"];
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

function setResultsMode(enabled) {
  if (!centerCard) return;
  centerCard.classList.toggle("results-mode", Boolean(enabled));
}

function isSteamAppId(value) {
  return /^\d+$/.test(String(value || "").trim());
}

function normalizeSearchText(text) {
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

function compactSearchText(text) {
  return normalizeSearchText(text).replace(/\s+/g, "");
}

function searchTokens(text) {
  const normalized = normalizeSearchText(text);
  return normalized ? normalized.split(" ") : [];
}

function acronym(text) {
  const list = searchTokens(text);
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
  const q = normalizeSearchText(queryRaw);
  const t = normalizeSearchText(targetRaw);
  if (!q || !t) return 0;

  const qCompact = compactSearchText(q);
  const tCompact = compactSearchText(t);
  const qTokens = searchTokens(q);
  const tTokens = searchTokens(t);
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
  if (!isSteamAppId(query) || !appId) return 0;
  if (query === appId) return 3000;
  if (appId.startsWith(query)) return 1700;
  if (appId.includes(query)) return 1200;
  return 0;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return null;
  const units = ["B", "KB", "MB", "GB"];
  let size = n;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[idx]}`;
}

function ensureSuggestionBox() {
  if (!searchInput) return null;
  if (suggestionBox) return suggestionBox;

  suggestionBox = document.createElement("div");
  suggestionBox.className = "search-suggest";
  suggestionBox.hidden = true;
  searchInput.insertAdjacentElement("afterend", suggestionBox);
  return suggestionBox;
}

function resetSuggestionState() {
  suggestionItems = [];
  activeSuggestionIndex = -1;
}

function hideSuggestions() {
  const box = ensureSuggestionBox();
  if (!box) return;
  box.hidden = true;
  box.innerHTML = "";
  box.classList.remove("visible");
  resetSuggestionState();
}

function setActiveSuggestion(index) {
  const box = ensureSuggestionBox();
  if (!box || !suggestionItems.length) return;

  const boundedIndex = Math.max(0, Math.min(index, suggestionItems.length - 1));
  activeSuggestionIndex = boundedIndex;

  const rows = box.querySelectorAll(".suggest-item");
  rows.forEach((row, rowIndex) => {
    if (rowIndex === boundedIndex) {
      row.classList.add("active");
    } else {
      row.classList.remove("active");
    }
  });
}

function suggestionItemFromResult(item) {
  const label = resultLabel(item);
  const appId = String(label.appId || "");
  return {
    raw: item,
    title: label.title,
    appId,
    key: `${appId}:${label.title}`.toLowerCase(),
  };
}

function renderSuggestions(results) {
  const box = ensureSuggestionBox();
  if (!box) return;

  const unique = [];
  const seen = new Set();
  for (const item of results) {
    const entry = suggestionItemFromResult(item);
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    unique.push(entry);
    if (unique.length >= MAX_SUGGESTIONS) break;
  }

  if (!unique.length) {
    hideSuggestions();
    return;
  }

  suggestionItems = unique;
  activeSuggestionIndex = -1;
  box.hidden = false;
  box.classList.add("visible");
  box.innerHTML = unique
    .map(
      (entry, index) => `
      <button type="button" class="suggest-item" data-suggest-index="${index}">
        <span class="suggest-name">${escapeHtml(entry.title)}</span>
        <span class="suggest-id">${escapeHtml(entry.appId)}</span>
      </button>
    `
    )
    .join("");
}

async function showSearchResults(query, results) {
  saveRecentSearch(query, results.length);
  renderResults(results);
  await renderPillResults(results.slice(0, 1));
  renderHistory();
}

async function applySuggestion(index) {
  const entry = suggestionItems[index];
  if (!entry) return;
  if (searchInput) {
    searchInput.value = entry.title;
  }
  hideSuggestions();
  await showSearchResults(entry.title, [entry.raw]);
}

function readJsonStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    return [];
  }
}

function writeJsonStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getDemoUser() {
  try {
    const raw = localStorage.getItem("demoUser");
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function pushHistory(key, entry, identity) {
  const current = readJsonStorage(key);
  const deduped = current.filter((item) => item[identity] !== entry[identity]);
  const updated = [entry, ...deduped].slice(0, HISTORY_LIMIT);
  writeJsonStorage(key, updated);
}

function saveRecentSearch(query, count) {
  pushHistory(
    SEARCH_HISTORY_KEY,
    {
      query,
      count,
      at: new Date().toISOString(),
    },
    "query"
  );
}

function saveRecentDownload(fileId, label) {
  pushHistory(
    DOWNLOAD_HISTORY_KEY,
    {
      fileId,
      label,
      at: new Date().toISOString(),
    },
    "fileId"
  );
}

function clearHistory() {
  localStorage.removeItem(SEARCH_HISTORY_KEY);
  localStorage.removeItem(DOWNLOAD_HISTORY_KEY);
  renderHistory();
}

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString();
}

function renderHistory() {
  if (searchHistoryEl) {
    const searches = readJsonStorage(SEARCH_HISTORY_KEY);
    searchHistoryEl.innerHTML = searches.length
      ? searches
          .map(
            (item) => `
        <div class="pill-result">
          <div>
            <div class="pill-result-title">${escapeHtml(item.query)}</div>
            <div class="pill-result-sub">${escapeHtml(item.count)} matches | ${escapeHtml(formatTime(item.at))}</div>
          </div>
        </div>
      `
          )
          .join("")
      : '<div class="pill-result empty"><div class="pill-result-title">No searches yet</div></div>';
  }

  if (downloadHistoryEl) {
    const downloads = readJsonStorage(DOWNLOAD_HISTORY_KEY);
    downloadHistoryEl.innerHTML = downloads.length
      ? downloads
          .map(
            (item) => `
        <div class="pill-result">
          <div>
            <div class="pill-result-title">${escapeHtml(item.label)}</div>
            <div class="pill-result-sub">File ref: ${escapeHtml(item.fileId)} | ${escapeHtml(formatTime(item.at))}</div>
          </div>
          <button class="pill-btn pill-small" data-file="${escapeHtml(item.fileId)}" data-label="${escapeHtml(item.label)}">Download</button>
        </div>
      `
          )
          .join("")
      : '<div class="pill-result empty"><div class="pill-result-title">No downloads yet</div></div>';
  }
}

async function checkApi() {
  if (apiAvailable !== null) return apiAvailable;
  try {
    const res = await fetch("/api/me", { cache: "no-store" });
    apiAvailable = res.ok;
  } catch (err) {
    apiAvailable = false;
  }
  return apiAvailable;
}

async function fetchMe() {
  try {
    if (await checkApi()) {
      const res = await fetch("/api/me");
      const data = await res.json();
      return data.user;
    }
    return getDemoUser();
  } catch (err) {
    return getDemoUser();
  }
}

async function loadLocalGames() {
  if (localGamesCache) return localGamesCache;
  const res = await fetch("data/games.json", { cache: "no-store" });
  const data = await res.json();
  localGamesCache = data;
  return data;
}

async function loadArtMap() {
  if (artMapCache) return artMapCache;
  try {
    const res = await fetch("data/art.json", { cache: "no-store" });
    const data = await res.json();
    artMapCache = Array.isArray(data) ? data : [];
  } catch (err) {
    artMapCache = [];
  }
  return artMapCache;
}

async function resolveArt(appId) {
  const map = await loadArtMap();
  const match = map.find((entry) => String(entry.appId) === String(appId));
  if (match?.art) return match.art;
  if (!appId || String(appId) === "unknown") return "assets/welcome-bg.jpeg";
  return `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
}

async function fetchSteamDetails(appId) {
  const id = String(appId || "").trim();
  if (!isSteamAppId(id)) return null;

  if (await checkApi()) {
    try {
      const response = await fetch(`/api/steam-app?appId=${encodeURIComponent(id)}`);
      if (!response.ok) return null;
      const payload = await response.json();
      return payload.app || null;
    } catch (err) {
      return null;
    }
  }

  try {
    const response = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(id)}&l=english`
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
  }
}

function searchLocalGames(games, query) {
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
  return ranked.slice(0, MAX_LOCAL_RESULTS).map((entry) => entry.game);
}

function resultLabel(item) {
  const title = item.gameName || item.name || `App ${item.id}`;
  const appId = item.appId || item.name || "unknown";
  return { title, appId };
}

function renderResults(results) {
  if (!resultList) return;
  if (!results.length) {
    resultList.innerHTML = `
      <div class="result-empty">
        <div class="result-title">No matches yet</div>
        <div class="result-sub">Try another game name or App ID.</div>
      </div>
    `;
    return;
  }

  resultList.innerHTML = results
    .map((item) => {
      const label = resultLabel(item);
      const fileRef = item.id || item.appId || item.name || "";
      return `
        <div class="result-card">
          <div class="result-main">
            <div class="result-title">${escapeHtml(label.title)}</div>
            <div class="result-sub">Steam App ID: ${escapeHtml(label.appId)}</div>
          </div>
          <button class="ghost-btn" data-file="${escapeHtml(fileRef)}" data-label="${escapeHtml(label.title)}">Download</button>
        </div>
      `;
    })
    .join("");
}

async function renderPillResults(results) {
  if (!pillResults) return;
  if (!results.length) {
    setResultsMode(false);
    pillResults.innerHTML = `
      <div class="pill-result empty">
        <div class="pill-result-title">No matches yet</div>
        <div class="pill-result-sub">Try another game name or App ID.</div>
      </div>
    `;
    return;
  }

  const cards = await Promise.all(
    results.map(async (item) => {
      const label = resultLabel(item);
      const fileRef = item.id || item.appId || item.name || "";
      const art = item.art || (await resolveArt(label.appId));
      const sizeLabel = formatSize(item.size || item.sizeBytes);
      return `
        <div class="game-card" style="--game-art: url('${escapeHtml(art)}')">
          <div class="game-card-header">
            <div class="game-card-title">ZosfasGen</div>
            <button class="game-card-close" data-action="close-card" aria-label="Close">x</button>
          </div>
          <div class="game-card-media">
            <div class="game-card-media-title">${escapeHtml(label.title)}</div>
            <div class="game-card-footer">
              <div class="game-card-icons">
                <span class="meta-icon chat" aria-label="Support chat"></span>
                ${sizeLabel ? `<span class="meta-icon warn" aria-label="File size">${escapeHtml(sizeLabel)}</span>` : `<span class="meta-icon warn" aria-hidden="true"></span>`}
              </div>
              <button class="game-card-btn primary" data-file="${escapeHtml(fileRef)}" data-label="${escapeHtml(label.title)}">Download</button>
              <button class="game-card-btn ghost" data-action="request-update">Request Update</button>
            </div>
          </div>
        </div>
      `;
    })
  );
  pillResults.innerHTML = cards.join("");
  setResultsMode(true);
}

async function fetchSearchResults(query, { limit = MAX_LOCAL_RESULTS, includeSteamFallback = true } = {}) {
  const rawQuery = String(query || "").trim();
  if (!rawQuery) return [];

  let results = [];
  try {
    if (await checkApi()) {
      const res = await fetch(`/api/search?q=${encodeURIComponent(rawQuery)}`);
      if (res.ok) {
        const data = await res.json();
        results = Array.isArray(data.results) ? data.results : [];
      }
    } else {
      const games = await loadLocalGames();
      results = searchLocalGames(games, rawQuery).map((game) => ({
        name: game.name,
        gameName: game.name,
        appId: game.appId,
        id: game.appId,
      }));
    }
  } catch (err) {
    results = [];
  }

  if (!results.length && includeSteamFallback && isSteamAppId(rawQuery)) {
    const appId = rawQuery;
    const details = await fetchSteamDetails(appId);
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

  return results.slice(0, limit);
}

async function fetchSuggestions(query) {
  const cacheKey = normalizeSearchText(query);
  if (!cacheKey || cacheKey.length < 2) return [];
  if (suggestionCache.has(cacheKey)) {
    return suggestionCache.get(cacheKey);
  }

  const results = await fetchSearchResults(query, {
    limit: MAX_SUGGESTIONS,
    includeSteamFallback: isSteamAppId(query),
  });
  suggestionCache.set(cacheKey, results);
  return results;
}

function queueSuggestions() {
  if (!searchInput) return;
  const query = searchInput.value.trim();
  if (query.length < 2) {
    hideSuggestions();
    return;
  }

  const seq = ++suggestionSeq;
  if (suggestionTimer) {
    clearTimeout(suggestionTimer);
  }

  suggestionTimer = setTimeout(async () => {
    const results = await fetchSuggestions(query);
    if (seq !== suggestionSeq) return;

    const currentQuery = searchInput.value.trim();
    if (!currentQuery || normalizeSearchText(currentQuery) !== normalizeSearchText(query)) {
      return;
    }

    renderSuggestions(results);
  }, 140);
}

async function runSearch(queryOverride) {
  const query = String(queryOverride ?? searchInput?.value ?? "").trim();
  if (!query) return;
  hideSuggestions();
  const results = await fetchSearchResults(query, {
    limit: MAX_LOCAL_RESULTS,
    includeSteamFallback: true,
  });
  await showSearchResults(query, results);
}

if (searchButton) {
  searchButton.addEventListener("click", () => runSearch());
}

if (searchInput) {
  ensureSuggestionBox();

  searchInput.addEventListener("input", () => {
    queueSuggestions();
  });

  searchInput.addEventListener("focus", () => {
    queueSuggestions();
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && suggestionItems.length) {
      event.preventDefault();
      const nextIndex =
        activeSuggestionIndex < 0 ? 0 : (activeSuggestionIndex + 1) % suggestionItems.length;
      setActiveSuggestion(nextIndex);
      return;
    }

    if (event.key === "ArrowUp" && suggestionItems.length) {
      event.preventDefault();
      const nextIndex =
        activeSuggestionIndex < 0
          ? suggestionItems.length - 1
          : (activeSuggestionIndex - 1 + suggestionItems.length) % suggestionItems.length;
      setActiveSuggestion(nextIndex);
      return;
    }

    if (event.key === "Escape") {
      hideSuggestions();
      return;
    }

    if (event.key === "Enter") {
      if (activeSuggestionIndex >= 0) {
        event.preventDefault();
        applySuggestion(activeSuggestionIndex);
        return;
      }
      runSearch();
    }
  });
}

async function handleDownload(fileId, label = "Unknown") {
  if (!fileId) {
    alert("Drive mode is not enabled yet.");
    return;
  }

  saveRecentDownload(fileId, label);
  renderHistory();

  if (await checkApi()) {
    const response = await fetch(`/api/download?id=${encodeURIComponent(fileId)}`);
    if (!response.ok) {
      try {
        const errorData = await response.json();
        alert(errorData.error || "Download failed");
      } catch (err) {
        alert("Download failed");
      }
      return;
    }

    const disposition = response.headers.get("Content-Disposition") || "";
    const filenameMatch = disposition.match(/filename=\"?([^\";]+)\"?/i);
    const filename = filenameMatch ? filenameMatch[1] : `${fileId}.bin`;

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return;
  }

  const content =
    `Demo download for App ID ${fileId}\n\n` +
    `This is a placeholder file for local demo mode.\n`;
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileId}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function submitSupport(topic) {
  const chosen = topic || "Other";
  const detail = prompt(`Describe the issue (${chosen}):`, "");
  if (detail === null) return;
  if (!(await checkApi())) {
    alert("API unavailable. Please sign in first.");
    return;
  }
  try {
    const res = await fetch("/api/support", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: chosen, body: detail }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || "Support request failed");
      return;
    }
    alert("Support ticket submitted.");
  } catch (err) {
    alert("Support request failed");
  }
}

document.body.addEventListener("click", (event) => {
  const suggestionTarget = event.target.closest("[data-suggest-index]");
  if (suggestionTarget) {
    const index = Number(suggestionTarget.dataset.suggestIndex);
    if (Number.isInteger(index)) {
      applySuggestion(index);
    }
    return;
  }

  if (
    searchInput &&
    !event.target.closest(".search-suggest") &&
    !event.target.closest("#query")
  ) {
    hideSuggestions();
  }

  const downloadTarget = event.target.closest("button[data-file]");
  if (downloadTarget) {
    handleDownload(downloadTarget.dataset.file, downloadTarget.dataset.label || "Unknown");
    return;
  }

  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) return;

  const action = actionTarget.dataset.action;
  if (action === "claim") {
    alert("Giveaway claimed! (Demo mode)");
    return;
  }
  if (action === "support") {
    const topic = actionTarget.textContent || "Support";
    submitSupport(topic);
    return;
  }
  if (action === "support-close") {
    const ticket = document.querySelector(".support-ticket");
    if (ticket) {
      ticket.classList.add("hidden");
    }
    return;
  }
  if (action === "close-card") {
    if (pillResults) {
      pillResults.innerHTML = "";
    }
    setResultsMode(false);
    return;
  }
  if (action === "request-update") {
    alert("Update request submitted. (Demo mode)");
    return;
  }
  if (action === "clear-history") {
    clearHistory();
  }
});

fetchMe().then((user) => {
  if (userTitle && user) {
    userTitle.textContent = `Welcome ${user.username}`;
  }
  if (userSub && user) {
    if (Number.isFinite(Number(user.usesLeftToday))) {
      userSub.textContent = `${Number(user.usesLeftToday)} uses left today`;
    } else {
      userSub.textContent = apiAvailable ? "Authenticated" : "Demo mode";
    }
  }
  if (!statusDot || !hint) return;
  if (user) {
    statusDot.textContent = "Online";
    statusDot.classList.add("online");
    hint.textContent = `Signed in as ${user.username}`;
  }
});

renderHistory();

