// The standings are computed on a schedule and stored, so every visitor reads
// the same copy and the page never waits on Yukon's API. A snapshot older than
// the tolerance falls back to a live computation, so a missed run degrades to
// today's behaviour rather than to stale data.
export const SNAPSHOT_TOLERANCE_MS = 45 * 60 * 1000;

export async function saveSnapshot(pool, standings, fetchedAt = new Date()) {
  await pool.query("INSERT INTO qsb_leaderboard_snapshots (payload, fetched_at) VALUES ($1, $2)", [JSON.stringify(standings), fetchedAt]);
  // Keep a short history for debugging, never an unbounded table.
  await pool.query("DELETE FROM qsb_leaderboard_snapshots WHERE id NOT IN (SELECT id FROM qsb_leaderboard_snapshots ORDER BY fetched_at DESC LIMIT 48)");
  return fetchedAt.getTime();
}

export async function loadSnapshot(pool) {
  const result = await pool.query("SELECT payload, fetched_at FROM qsb_leaderboard_snapshots ORDER BY fetched_at DESC LIMIT 1");
  const row = result.rows[0];
  if (!row) return null;
  const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
  return { ...payload, fetchedAt: new Date(row.fetched_at).getTime() };
}

// Reads the stored copy when it is fresh enough, otherwise recomputes and
// stores the result so the next reader benefits.
export function createSnapshotBoard({ pool, compute, toleranceMs = SNAPSHOT_TOLERANCE_MS, now = () => Date.now() }) {
  let inflight = null;
  async function refresh() {
    const standings = await compute();
    const fetchedAt = await saveSnapshot(pool, standings, new Date(now()));
    return { ...standings, fetchedAt, stale: false, source: "live" };
  }
  return {
    refresh,
    async get() {
      const stored = await loadSnapshot(pool).catch(() => null);
      if (stored && now() - stored.fetchedAt < toleranceMs) return { ...stored, stale: false, source: "snapshot" };
      if (!inflight) inflight = refresh().finally(() => { inflight = null; });
      try { return await inflight; }
      catch (error) {
        if (stored) return { ...stored, stale: true, source: "snapshot" };
        throw error;
      }
    },
  };
}
