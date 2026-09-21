import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";

const files = new Map([
  ["/", "index.html"], ["/index.html", "index.html"], ["/qsb/rewards", "index.html"], ["/qsb/rewards/", "index.html"],
  ["/claim-component.css", "claim-component.css"], ["/claim.js", "claim.js"], ["/demo.js", "demo.js"], ["/live.js", "live.js"],
  ["/qsb/rewards/leaderboard", "leaderboard.html"], ["/qsb/rewards/leaderboard/", "leaderboard.html"], ["/leaderboard.js", "leaderboard.js"],
]);
const types = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8" };
// Hero media is served with byte ranges. Safari asks for bytes 0-1 first and
// refuses to play a video from a server that answers 200 with the whole file.
const media = new Map([["/media/hero.mp4", ["hero.mp4", "video/mp4"]], ["/media/hero-poster.jpg", ["hero-poster.jpg", "image/jpeg"]], ["/media/card-loop.mp4", ["card-loop.mp4", "video/mp4"]], ["/media/card-loop.jpg", ["card-loop.jpg", "image/jpeg"]], ["/media/podium-bg.mp4", ["podium-bg.mp4", "video/mp4"]], ["/media/podium-bg.jpg", ["podium-bg.jpg", "image/jpeg"]], ["/media/board-bg.mp4", ["board-bg.mp4", "video/mp4"]], ["/media/board-bg.jpg", ["board-bg.jpg", "image/jpeg"]], ["/media/favicon.svg", ["favicon.svg", "image/svg+xml"]], ["/media/starkware-logo.svg", ["starkware-logo.svg", "image/svg+xml"]], ["/media/starkware-logo-white.svg", ["starkware-logo-white.svg", "image/svg+xml"]]]);
async function sendMedia(name, type, req, res) {
  const path = new URL(`../public/media/${name}`, import.meta.url);
  const { size } = await stat(path);
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
  const base = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" };
  if (!range) { res.writeHead(200, { ...base, "Content-Length": size }); return createReadStream(path).pipe(res); }
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (!Number.isFinite(start) || start > end || start >= size) { res.writeHead(416, { ...base, "Content-Range": `bytes */${size}` }); return res.end(); }
  res.writeHead(206, { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
  createReadStream(path, { start, end }).pipe(res);
}
const authMode = process.env.AUTH_MODE || "demo";
let githubAuth, claimHandler, pool, appOrigin, devClaims, localOnly = false, prizes = async () => new Map();
const { createLeaderboard, readRoster } = await import("./leaderboard.mjs");
const leaderboard = createLeaderboard();
const rosterFile = new URL(`../${process.env.BOARD_ROSTER_FILE || "board-solvers.json"}`, import.meta.url);
let roster = null;
try {
  roster = readRoster(await readFile(rosterFile, "utf8"));
  console.log(`Leaderboard roster: ${roster.length} solvers from ${rosterFile.pathname.split("/").pop()}. The challenge page is not read.`);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

if (authMode === "github") {
  const store = process.env.STORE || "postgres";
  if (!["postgres", "memory"].includes(store)) throw new Error("STORE must be either postgres or memory.");
  const required = ["APP_ORIGIN", "CLAIM_ENCRYPTION_KEY", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GITHUB_CALLBACK_URL"];
  if (store === "postgres") required.push("DATABASE_URL");
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`AUTH_MODE=github requires: ${missing.join(", ")}`);
  appOrigin = new URL(process.env.APP_ORIGIN).origin;
  const callback = new URL(process.env.GITHUB_CALLBACK_URL);
  if (callback.origin !== appOrigin || callback.pathname !== "/auth/github/callback") throw new Error("GITHUB_CALLBACK_URL must be /auth/github/callback on APP_ORIGIN.");
  const { createGithubAuth, postgresAuthStore } = await import("./github-auth.mjs");
  const { createClaimHandler } = await import("./claim-handler.mjs");

  let authStore, claimStore, getAward;
  if (store === "memory") {
    if (!["127.0.0.1", "localhost", "::1"].includes(new URL(appOrigin).hostname)) throw new Error("STORE=memory is for local development only. Use STORE=postgres on any shared origin.");
    localOnly = true; // /dev/claims decrypts payout details, so never bind beyond the loopback interface.
    const { readFile } = await import("node:fs/promises");
    const { memoryAuthStore, memoryClaimStore, memoryAwardTable, readAwardSnapshot, resolveLogins } = await import("./memory-store.mjs");
    const file = new URL(`../${process.env.DEV_AWARDS_FILE || "dev-awards.json"}`, import.meta.url);
    const awards = await resolveLogins(readAwardSnapshot(await readFile(file, "utf8")));
    const table = memoryAwardTable(awards);
    authStore = memoryAuthStore();
    devClaims = claimStore = memoryClaimStore();
    getAward = table.getAward;
    prizes = async () => new Map(table.all().filter((a) => a.finalized).map((a) => [a.githubId, a.amount]));
    console.log(`STORE=memory: ${awards.length} awards loaded, ${table.all().filter((a) => a.finalized).length} finalized. Nothing is persisted.`);
  } else {
    const { default: pg } = await import("pg");
    const { postgresStore } = await import("./store.mjs");
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10, idleTimeoutMillis: 30000 });
    authStore = postgresAuthStore(pool);
    claimStore = postgresStore(pool);
    prizes = async () => {
      const result = await pool.query("SELECT github_id, SUM(award_amount)::float8 AS amount FROM yukon_reward_awards WHERE finalized=true GROUP BY github_id");
      return new Map(result.rows.map((row) => [row.github_id, row.amount]));
    };
    getAward = async (githubId) => {
      const result = await pool.query("SELECT award_id AS \"awardId\", award_type AS type, award_label AS label, award_amount::float8 AS amount FROM yukon_reward_awards WHERE github_id=$1 AND finalized=true ORDER BY created_at,award_id LIMIT 1", [githubId]);
      return result.rows[0] || null;
    };
  }

  githubAuth = createGithubAuth({ origin: appOrigin, callbackUrl: callback.href, clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET, store: authStore });
  claimHandler = createClaimHandler({ origin: appOrigin, getSession: githubAuth.getSession, getAward, store: claimStore });
} else if (authMode !== "demo") {
  throw new Error("AUTH_MODE must be either demo or github.");
}

async function nodeRequest(req, origin) {
  const method = req.method || "GET";
  const headers = new Headers(req.headers);
  let body;
  if (!["GET", "HEAD"].includes(method)) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
  }
  return new Request(new URL(req.url || "/", origin), { method, headers, ...(body ? { body, duplex: "half" } : {}) });
}

function sendWebResponse(webResponse, res) {
  res.statusCode = webResponse.status;
  for (const [name, value] of webResponse.headers) if (name.toLowerCase() !== "set-cookie") res.setHeader(name, value);
  if (typeof webResponse.headers.getSetCookie === "function") {
    const cookies = webResponse.headers.getSetCookie();
    if (cookies.length) res.setHeader("Set-Cookie", cookies);
  }
  if (webResponse.body) webResponse.arrayBuffer().then((bytes) => res.end(Buffer.from(bytes)), () => res.end());
  else res.end();
}

const server = createServer(async (req, res) => {
  const origin = appOrigin || `http://${req.headers.host || "127.0.0.1:4318"}`;
  const url = new URL(req.url || "/", origin);
  try {
    if (authMode === "github") {
      const request = await nodeRequest(req, origin);
      if (url.pathname.startsWith("/auth/")) {
        const response = await githubAuth.handle(request, url.pathname);
        if (response) return sendWebResponse(response, res);
      }
      if (url.pathname === "/api/yukon/reward-claim") return sendWebResponse(await claimHandler(request), res);
      // Dev inspection of collected payout details. Only exists with STORE=memory.
      if (url.pathname === "/dev/claims" && devClaims) {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify(devClaims.list(), null, 2));
      }
    }
    if (url.pathname === "/api/qsb/leaderboard") {
      try {
        if (roster) {
          const awarded = await prizes();
          const pinned = roster.map((solver) => ({ ...solver, prize: solver.prize ?? (solver.avatarId ? awarded.get(solver.avatarId) ?? null : null) }));
          // Everyone the roster does not pin still comes from the challenge page,
          // ranked below the pinned rows.
          let live = [];
          try { live = (await leaderboard.get()).solvers; } catch { live = leaderboard.peek().solvers; }
          const seen = new Set(pinned.flatMap((solver) => [solver.login.toLowerCase(), solver.avatarId].filter(Boolean)));
          const rest = live
            .filter((solver) => !seen.has(solver.login.toLowerCase()) && !seen.has(solver.avatarId))
            .map((solver, index) => ({ ...solver, rank: pinned.length + index + 1, prize: solver.avatarId ? awarded.get(solver.avatarId) ?? null : null }));
          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          return res.end(JSON.stringify({ updatedAt: Date.now(), stale: false, source: "roster", solvers: [...pinned, ...rest] }));
        }
        const [board, awarded] = await Promise.all([leaderboard.get(), prizes()]);
        const solvers = board.solvers.map((solver) => ({ ...solver, prize: awarded.get(solver.avatarId) ?? null }));
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ updatedAt: board.fetchedAt, stale: board.stale, solvers }));
      } catch {
        res.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ error: "The leaderboard is unavailable right now." }));
      }
    }
    const asset = media.get(url.pathname);
    if (asset) return sendMedia(asset[0], asset[1], req, res);
    let file = files.get(url.pathname);
    if (url.pathname === "/live.js" && authMode === "demo") file = "demo.js";
    if (!file) { res.writeHead(404); return res.end("Not found"); }
    const content = await readFile(new URL(`../public/${file}`, import.meta.url));
    res.writeHead(200, {
      "Content-Type": types[file.split(".").pop()], "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' https://avatars.githubusercontent.com; frame-ancestors 'none'; form-action 'self'",
    });
    res.end(content);
  } catch {
    if (!res.headersSent) res.writeHead(503, { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" });
    res.end("The rewards service is temporarily unavailable.");
  }
});

const port = Number(process.env.PORT || (appOrigin ? new URL(appOrigin).port : 4318) || 4318);
const host = localOnly ? new URL(appOrigin).hostname : process.env.HOST || (authMode === "github" && appOrigin && new URL(appOrigin).hostname !== "127.0.0.1" ? "0.0.0.0" : "127.0.0.1");
server.listen(port, host, () => console.log(`Yukon QSB rewards (${authMode}): http://${host}:${server.address().port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { server.close(); if (pool) await pool.end(); process.exit(0); });
