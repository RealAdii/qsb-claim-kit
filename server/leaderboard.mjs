// The challenge page has no public API, so the leaderboard is read out of the
// rendered page and cached. Parsing is defensive: a layout change upstream
// should yield an empty list and a stale-cache response, never a broken page.
const SOURCE = "https://www.yukon.org/qsb";

export function parseLeaderboard(html) {
  const solvers = new Map();
  const rows = html.split('data-solver="').slice(1);
  for (const row of rows) {
    const login = decode(/^([^"]+)"/.exec(row)?.[1] || "");
    if (!login || solvers.has(login.toLowerCase())) continue;
    const block = row.slice(0, 6000);
    const display = decode(/\/solver\/([^"?]+)\?/.exec(block)?.[1] || login);
    const avatarId = /avatars\.githubusercontent\.com\/u\/(\d+)/.exec(block)?.[1] || null;
    const rank = Number(/aria-label="Rank (\d+)/.exec(block)?.[1] || 0);
    const score = decode(/tabular-nums tracking-tight text-ink">([^<]+)<\/span>/.exec(block)?.[1] || "");
    const gain = decode(/leaderboard-gain[^"]*"[^>]*>([^<]+)</.exec(block)?.[1] || "") || null;
    const model = decode(/<span class="truncate text-xs font-medium text-ink-dim">([^<]+)<\/span>/.exec(block)?.[1] || "") || null;
    if (!rank || !score) continue;
    solvers.set(login.toLowerCase(), { rank, login: display, avatarId, score, gain, model });
  }
  return [...solvers.values()].sort((a, b) => a.rank - b.rank);
}

const decode = (value) => value.replaceAll("&amp;", "&").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">");

// A hand-written list always wins over the scrape, so the board can be driven
// from an approved roster instead of whatever the challenge page shows.
export function readRoster(text) {
  const parsed = JSON.parse(text);
  const rows = Array.isArray(parsed) ? parsed : parsed.solvers;
  if (!Array.isArray(rows) || !rows.length) throw new Error("The roster must be a non-empty JSON array of solvers.");
  return rows.map((row, index) => {
    const login = String(row.login ?? row.handle ?? "").trim();
    if (!login) throw new Error(`Roster entry ${index + 1} needs a login.`);
    return {
      rank: Number(row.rank ?? index + 1),
      login,
      avatarId: row.avatarId ? String(row.avatarId) : null,
      score: row.score === undefined || row.score === null ? "" : String(row.score),
      gain: row.gain ? String(row.gain) : null,
      model: row.model ? String(row.model) : null,
      title: row.title ? String(row.title) : null,
      points: row.points === undefined || row.points === null ? null : Number(row.points),
      prize: row.prize === undefined || row.prize === null ? null : Number(row.prize),
    };
  }).sort((a, b) => a.rank - b.rank);
}

// One cached copy shared by every visitor, refreshed in the background.
export function createLeaderboard({ ttlMs = 5 * 60 * 1000, fetchImpl = fetch, source = SOURCE } = {}) {
  let cache = { solvers: [], fetchedAt: 0 };
  let inflight = null;
  async function refresh() {
    const response = await fetchImpl(source, { headers: { "User-Agent": "Yukon-QSB-Rewards" }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Leaderboard source returned ${response.status}`);
    const solvers = parseLeaderboard(await response.text());
    if (!solvers.length) throw new Error("Leaderboard source returned no rows");
    cache = { solvers, fetchedAt: Date.now() };
    return cache;
  }
  return {
    async get() {
      const fresh = Date.now() - cache.fetchedAt < ttlMs;
      if (fresh) return { ...cache, stale: false };
      if (!inflight) inflight = refresh().finally(() => { inflight = null; });
      try { await inflight; } catch (error) {
        if (!cache.solvers.length) throw error;
        return { ...cache, stale: true };
      }
      return { ...cache, stale: false };
    },
    peek: () => cache,
  };
}
