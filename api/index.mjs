// Vercel entry point. Every invocation is isolated, so nothing is kept in
// process: sessions, awards and claims all live in PostgreSQL.
import pg from "pg";
import { createGithubAuth, postgresAuthStore } from "../server/github-auth.mjs";
import { createClaimHandler } from "../server/claim-handler.mjs";
import { postgresStore } from "../server/store.mjs";
import { createLeaderboard } from "../server/leaderboard.mjs";

const required = ["APP_ORIGIN", "DATABASE_URL", "CLAIM_ENCRYPTION_KEY", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GITHUB_CALLBACK_URL"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}`);

const origin = new URL(process.env.APP_ORIGIN).origin;
const callback = new URL(process.env.GITHUB_CALLBACK_URL);
if (callback.origin !== origin || callback.pathname !== "/auth/github/callback") throw new Error("GITHUB_CALLBACK_URL must be /auth/github/callback on APP_ORIGIN.");

// One pool per warm instance, small because many instances may exist at once.
const pool = globalThis.__qsbPool ?? (globalThis.__qsbPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3, idleTimeoutMillis: 10000 }));
const leaderboard = globalThis.__qsbBoard ?? (globalThis.__qsbBoard = createLeaderboard());

const githubAuth = createGithubAuth({
  origin, callbackUrl: callback.href,
  clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET,
  store: postgresAuthStore(pool),
});
const claimHandler = createClaimHandler({
  origin, getSession: githubAuth.getSession,
  getAward: async (githubId) => {
    const result = await pool.query('SELECT award_id AS "awardId", award_type AS type, award_label AS label, award_amount::float8 AS amount FROM yukon_reward_awards WHERE github_id=$1 AND finalized=true ORDER BY created_at,award_id LIMIT 1', [githubId]);
    return result.rows[0] || null;
  },
  store: postgresStore(pool),
});

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
    if (url.pathname.startsWith("/auth/")) {
      const response = await githubAuth.handle(await toRequest(req), url.pathname);
      if (response) return send(response, res);
      res.statusCode = 404; return res.end("Not found");
    }
    if (url.pathname === "/api/yukon/reward-claim") return send(await claimHandler(await toRequest(req)), res);
    if (url.pathname === "/api/qsb/leaderboard") {
      const [board, awarded] = await Promise.all([leaderboard.get(), prizes()]);
      const solvers = board.solvers.map((solver) => ({ ...solver, prize: solver.avatarId ? awarded.get(solver.avatarId) ?? null : null }));
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ updatedAt: board.fetchedAt, stale: board.stale, solvers }));
    }
    res.statusCode = 404; res.end("Not found");
  } catch {
    if (!res.headersSent) res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("The rewards service is temporarily unavailable.");
  }
}
