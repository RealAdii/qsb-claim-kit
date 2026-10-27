// Vercel entry point. Every invocation is isolated, so nothing is kept in
// process: sessions, awards and claims all live in PostgreSQL.
import pg from "pg";
import { createGithubAuth, postgresAuthStore } from "../server/github-auth.mjs";
import { CLAIM_DEADLINE, createClaimHandler } from "../server/claim-handler.mjs";
import { postgresStore } from "../server/store.mjs";
import { loadStandings } from "../server/leaderboard.mjs";
import { createSnapshotBoard } from "../server/snapshots.mjs";
import { awardsFromStandings, raffleFromStandings, combineAwards } from "../server/auto-awards.mjs";
import { readFile } from "node:fs/promises";

const required = ["APP_ORIGIN", "DATABASE_URL", "CLAIM_ENCRYPTION_KEY", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GITHUB_CALLBACK_URL"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}`);

const origin = new URL(process.env.APP_ORIGIN).origin;
const callback = new URL(process.env.GITHUB_CALLBACK_URL);
if (callback.origin !== origin || callback.pathname !== "/claim/auth/github/callback") throw new Error("GITHUB_CALLBACK_URL must be /claim/auth/github/callback on APP_ORIGIN.");

// One pool per warm instance, small because many instances may exist at once.
const pool = globalThis.__qsbPool ?? (globalThis.__qsbPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3, idleTimeoutMillis: 10000 }));
const leaderboard = globalThis.__qsbBoard ?? (globalThis.__qsbBoard = createSnapshotBoard({ pool, compute: () => loadStandings() }));

const githubAuth = createGithubAuth({
  origin, callbackUrl: callback.href,
  clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET,
  store: postgresAuthStore(pool),
});
const claimHandler = createClaimHandler({
  origin, getSession: githubAuth.getSession,
  claimDeadline: process.env.CLAIM_DEADLINE || CLAIM_DEADLINE,
  getAward: async (githubId) => {
    const result = await pool.query('SELECT award_id AS "awardId", award_type AS type, award_label AS label, award_amount::float8 AS amount FROM yukon_reward_awards WHERE github_id=$1 AND finalized=true ORDER BY created_at,award_id', [githubId]);
    if (result.rows.length) return combineAwards(result.rows);
    return awardsFromStandings(await decoratedBoard()).get(String(githubId)) || null;
  },
  store: postgresStore(pool),
});

// Team accounts appear on the board but never receive a reward.
let teamCache = null;
async function teamAccounts() {
  if (teamCache) return teamCache;
  try {
    const parsed = JSON.parse(await readFile(new URL("../team.json", import.meta.url), "utf8"));
    const groups = Array.isArray(parsed) ? { starkware: parsed } : parsed;
    teamCache = new Map();
    for (const [org, logins] of Object.entries(groups)) for (const login of logins) teamCache.set(login.toLowerCase(), org);
  } catch { teamCache = new Map(); }
  return teamCache;
}

// The board with team membership attached, which both eligibility and the
// board API need.
async function decoratedBoard() {
  const [board, team] = await Promise.all([leaderboard.get(), teamAccounts()]);
  const tag = (solver) => ({ ...solver, team: team.get(solver.login.toLowerCase()) || null });
  return { ...board, solvers: board.solvers.map(tag), periods: Object.fromEntries(Object.entries(board.periods || {}).map(([name, period]) => [name, { ...period, solvers: period.solvers.map(tag) }])) };
}

async function prizes() {
  const result = await pool.query("SELECT github_id, SUM(award_amount)::float8 AS amount FROM yukon_reward_awards WHERE finalized=true GROUP BY github_id");
  return new Map(result.rows.map((row) => [row.github_id, row.amount]));
}

async function toRequest(req) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  let body;
  if (!["GET", "HEAD"].includes(req.method)) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
  }
  return new Request(new URL(req.url, origin), { method: req.method, headers, ...(body?.length ? { body, duplex: "half" } : {}) });
}

function send(webResponse, res) {
  res.statusCode = webResponse.status;
  for (const [name, value] of webResponse.headers) if (name.toLowerCase() !== "set-cookie") res.setHeader(name, value);
  const cookies = webResponse.headers.getSetCookie?.() ?? [];
  if (cookies.length) res.setHeader("Set-Cookie", cookies);
  webResponse.arrayBuffer().then((bytes) => res.end(Buffer.from(bytes)), () => res.end());
}

export default async function handler(req, res) {
  const url = new URL(req.url, origin);
  try {
    if (url.pathname.startsWith("/claim/auth/")) {
      const response = await githubAuth.handle(await toRequest(req), url.pathname);
      if (response) return send(response, res);
      res.statusCode = 404; return res.end("Not found");
    }
    if (url.pathname === "/claim/api/yukon/reward-claim") return send(await claimHandler(await toRequest(req)), res);
    if (url.pathname === "/claim/api/cron/refresh") {
      const expected = process.env.CRON_SECRET;
      if (!expected || req.headers.authorization !== `Bearer ${expected}`) { res.writeHead(401, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: "Unauthorized" })); }
      const started = Date.now();
      const board = await leaderboard.refresh();
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ ok: true, solvers: board.solvers.length, fetchedAt: board.fetchedAt, tookMs: Date.now() - started, pinning: board.workloads.pinning.improvement, subset: board.workloads.subset.improvement }));
    }
    if (url.pathname === "/claim/api/qsb/leaderboard") {
      const [board, awarded] = await Promise.all([decoratedBoard(), prizes()]);
      const automatic = awardsFromStandings(board);
      const raffle = raffleFromStandings(board);
      const decorate = (solver, index) => ({
        rank: index + 1,
        login: solver.login,
        avatarId: solver.avatarId,
        gains: solver.gains,
        total: solver.total,
        promotions: solver.promotions,
        team: solver.team,
        prize: solver.team || !solver.avatarId ? null : awarded.get(solver.avatarId) ?? automatic.get(String(solver.avatarId))?.amount ?? null,
        raffle: !solver.team && solver.avatarId && raffle.qualifiers.some((q) => q.avatarId === String(solver.avatarId)) ? raffle.share : null,
      });
      const periods = Object.fromEntries(Object.entries(board.periods || {}).map(([name, period]) => [name, { workloads: period.workloads, range: period.range, solvers: period.solvers.map(decorate) }]));
      const { qualifiers, ...raffleSummary } = raffle;
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ updatedAt: board.fetchedAt, stale: board.stale, source: board.source, week1End: board.week1End, workloads: board.workloads, raffle: raffleSummary, periods, solvers: board.solvers.map(decorate) }));
    }
    res.statusCode = 404; res.end("Not found");
  } catch {
    if (!res.headersSent) res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("The rewards service is temporarily unavailable.");
  }
}
