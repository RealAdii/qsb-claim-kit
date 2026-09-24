// Standings come from the challenge's own JSON API. Every promoted submission
// is listed per workload, so a solver's contribution is the sum of the gains
// their promotions produced, expressed the way the challenge page expresses
// them: as a share of that workload's baseline. Summing the per-solver figures
// for a workload reproduces the total the challenge page shows for it.
const API = "https://www.yukon.org/api";
export const BENCHMARKS = {
  pinning: "b352879c-669f-44ef-98cd-ad3d34d0fefa",
  subset: "eafd2f3d-e64f-49c1-b98a-6b825b0cdc82",
};

const avatarId = (url) => /avatars\.githubusercontent\.com\/u\/(\d+)/.exec(url || "")?.[1] || null;

// Week 1 is scored on the original baseline. Weeks 2 and 3 start again from
// wherever the frontier stood when Week 1 closed, so early entrants cannot
// carry their first-mover gains forward.
export const WEEK1_END = process.env.WEEK1_END || "2026-09-22T00:00:00.000Z";
export const WEEKS23_END = process.env.WEEKS23_END || new Date(Date.parse(process.env.WEEK1_END || "2026-09-22T00:00:00.000Z") + 14 * 864e5).toISOString();

export function accumulate(benchmark, baseline, submissions, into = new Map(), window = {}) {
  if (!Number.isFinite(baseline) || baseline <= 0) throw new Error(`${benchmark}: a positive baseline is required.`);
  const at = (s) => new Date(s.promotionFinishedAt || s.createdAt);
  const promoted = submissions
    .filter((s) => s.status === "accepted" && s.improved && Number.isFinite(s.officialScore))
    .sort((a, b) => at(a) - at(b));
  const from = window.from ? new Date(window.from) : null;
  const until = window.until ? new Date(window.until) : null;
  // The baseline for a later window is the frontier the earlier one left behind.
  let frontier = baseline;
  if (from) for (const s of promoted) if (at(s) < from) frontier = s.officialScore;
  const periodBaseline = from ? frontier : baseline;
  for (const submission of promoted) {
    if (from && at(submission) < from) continue;
    if (until && at(submission) >= until) continue;
    const gain = ((submission.officialScore - frontier) / periodBaseline) * 100;
    frontier = submission.officialScore;
    const login = submission.solverUsername;
    if (!login) continue;
    const row = into.get(login) || { login, avatarId: null, gains: {}, promotions: 0, best: {} };
    row.gains[benchmark] = (row.gains[benchmark] || 0) + gain;
    row.best[benchmark] = Math.max(row.best[benchmark] || 0, submission.officialScore);
    row.promotions += 1;
    row.avatarId = row.avatarId || avatarId(submission.solverAvatarUrl);
    into.set(login, row);
  }
  return { solvers: into, record: frontier, baseline: periodBaseline };
}

export function rank(solvers) {
  return [...solvers.values()]
    .map((row) => {
      const gains = Object.fromEntries(Object.keys(BENCHMARKS).map((name) => [name, row.gains[name] || 0]));
      return { ...row, gains, total: Object.values(gains).reduce((sum, value) => sum + value, 0) };
    })
    .sort((a, b) => b.total - a.total || a.login.localeCompare(b.login))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

async function readJson(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { Accept: "application/json", "User-Agent": "Yukon-QSB-Rewards" }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

export async function loadStandings(fetchImpl = fetch) {
  const raw = {};
  for (const [name, id] of Object.entries(BENCHMARKS)) {
    const [benchmark, board] = await Promise.all([
      readJson(`${API}/benchmarks/${id}`, fetchImpl),
      readJson(`${API}/benchmarks/${id}/submissions`, fetchImpl),
    ]);
    raw[name] = { baseline: benchmark.baselineScore ?? benchmark.benchmark?.baselineScore, submissions: board.submissions || [] };
  }
  // The challenge opened with its first promoted submission.
  const firstAt = Object.values(raw)
    .flatMap(({ submissions }) => submissions.filter((s) => s.status === "accepted" && s.improved).map((s) => s.promotionFinishedAt || s.createdAt))
    .sort()[0] || WEEK1_END;
  const periods = {
    all: {},
    week1: { until: WEEK1_END, from: null, range: { from: firstAt, until: WEEK1_END } },
    weeks23: { from: WEEK1_END, range: { from: WEEK1_END, until: WEEKS23_END } },
  };
  const out = {};
  for (const [period, window] of Object.entries(periods)) {
    const solvers = new Map();
    const workloads = {};
    for (const [name, { baseline, submissions }] of Object.entries(raw)) {
      const result = accumulate(name, baseline, submissions, solvers, window);
      workloads[name] = { baseline: result.baseline, record: result.record, improvement: ((result.record - result.baseline) / result.baseline) * 100 };
    }
    out[period] = { solvers: rank(solvers), workloads, range: window.range || null };
  }
  return { ...out.all, periods: out, week1End: WEEK1_END, weeks23End: WEEKS23_END };
}

// One cached copy shared by every visitor, refreshed in the background.
export function createLeaderboard({ ttlMs = 5 * 60 * 1000, fetchImpl = fetch } = {}) {
  let cache = { solvers: [], workloads: {}, fetchedAt: 0 };
  let inflight = null;
  async function refresh() {
    const next = await loadStandings(fetchImpl);
    if (!next.solvers.length) throw new Error("The standings API returned no solvers.");
    cache = { ...next, fetchedAt: Date.now() };
    return cache;
  }
  return {
    async get() {
      if (Date.now() - cache.fetchedAt < ttlMs) return { ...cache, stale: false };
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

// A hand-written list pins the top of the board; everyone else comes from the API.
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
      title: row.title ? String(row.title) : null,
      prize: row.prize === undefined || row.prize === null ? null : Number(row.prize),
    };
  }).sort((a, b) => a.rank - b.rank);
}
