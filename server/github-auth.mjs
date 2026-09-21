import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const STATE_COOKIE = "yukon_oauth_state";
const VERIFIER_COOKIE = "yukon_oauth_verifier";
const SESSION_COOKIE = "yukon_reward_session";
const cookie = (request, name) => {
  const pair = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null;
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

export function postgresAuthStore(pool) {
  return {
    async create(sessionHash, user, expiresAt) {
      await pool.query("INSERT INTO yukon_reward_sessions (session_hash,github_id,github_login,expires_at) VALUES ($1,$2,$3,$4)", [sessionHash, String(user.id), user.login, expiresAt]);
    },
    async get(sessionHash) {
      const result = await pool.query("SELECT github_id,github_login FROM yukon_reward_sessions WHERE session_hash=$1 AND expires_at>now()", [sessionHash]);
      const row = result.rows[0]; return row ? { githubId: row.github_id, login: row.github_login } : null;
    },
    async delete(sessionHash) {
      await pool.query("DELETE FROM yukon_reward_sessions WHERE session_hash=$1", [sessionHash]);
    },
  };
}

export function createGithubAuth({ origin, callbackUrl, clientId, clientSecret, store, fetchImpl = fetch, now = () => Date.now() }) {
  if (!origin || !callbackUrl || !clientId || !clientSecret || !store) throw new Error("GitHub OAuth configuration is incomplete.");
  const base = new URL(origin);
  const callback = new URL(callbackUrl);
  if (callback.origin !== base.origin || callback.pathname !== "/auth/github/callback") throw new Error("GitHub callback must be /auth/github/callback on APP_ORIGIN.");
  const secure = base.protocol === "https:" ? "; Secure" : "";
  const clearOAuth = [`${STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`, `${VERIFIER_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`];
  const issueSession = (token) => `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`;
  const clearSession = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
  const redirect = (path, options = {}) => {
    const response = new Response(null, { status: 303, headers: { Location: new URL(path, base).href, "Cache-Control": "no-store" } });
    for (const value of options.cookies || []) response.headers.append("Set-Cookie", value);
    return response;
  };

  async function getSession(request) {
    const token = cookie(request, SESSION_COOKIE);
    return token ? store.get(hash(token)) : null;
  }

  async function handle(request, pathname) {
    if (request.method === "GET" && pathname === "/auth/github") {
      const state = randomBytes(32).toString("base64url");
      const verifier = randomBytes(32).toString("base64url");
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      const authorize = new URL("https://github.com/login/oauth/authorize");
      authorize.searchParams.set("client_id", clientId);
      authorize.searchParams.set("redirect_uri", callback.href);
      authorize.searchParams.set("state", state);
      authorize.searchParams.set("code_challenge", challenge);
      authorize.searchParams.set("code_challenge_method", "S256");
      const response = new Response(null, { status: 302, headers: { Location: authorize.href, "Cache-Control": "no-store", "Set-Cookie": `${STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}` } });
      response.headers.append("Set-Cookie", `${VERIFIER_COOKIE}=${verifier}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`);
      return response;
    }

    if (request.method === "GET" && pathname === "/auth/github/callback") {
      const url = new URL(request.url);
      // Only a refusal is a cancellation. Everything else GitHub reports is a
      // real failure and must say which one.
      if (url.searchParams.has("error")) {
        const code = url.searchParams.get("error");
        console.error(`GitHub returned ${code}: ${url.searchParams.get("error_description") || "no description"}`);
        const cancelled = code === "access_denied";
        return redirect(`/qsb/rewards?auth=${cancelled ? "cancelled" : "failed"}${cancelled ? "" : `&why=${encodeURIComponent(code || "unknown")}`}`, { cookies: clearOAuth });
      }
      const received = url.searchParams.get("state") || "";
      const expected = cookie(request, STATE_COOKIE) || "";
      const verifier = cookie(request, VERIFIER_COOKIE);
      if (!received || !expected || !verifier || received.length !== expected.length || !timingSafeEqual(Buffer.from(received), Buffer.from(expected))) {
        console.error(`GitHub callback rejected: state ${received ? "mismatch" : "missing"}, cookies ${expected ? "present" : "missing"}.`);
        return redirect(`/qsb/rewards?auth=failed&why=${expected ? "state" : "cookies"}`, { cookies: clearOAuth });
      }
      const code = url.searchParams.get("code");
      if (!code) return redirect("/qsb/rewards?auth=failed", { cookies: clearOAuth });
      try {
        const tokenResponse = await fetchImpl("https://github.com/login/oauth/access_token", {
          method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: callback.href, code_verifier: verifier }),
          signal: AbortSignal.timeout(10000),
        });
        if (!tokenResponse.ok) throw Object.assign(new Error(`GitHub token exchange returned ${tokenResponse.status}`), { reason: `token_${tokenResponse.status}` });
        const tokenData = await tokenResponse.json();
        if (typeof tokenData.access_token !== "string" || tokenData.error) throw Object.assign(new Error(`GitHub did not issue a token: ${tokenData.error || "no access_token"} ${tokenData.error_description || ""}`.trim()), { reason: tokenData.error || "no_token" });
        const userResponse = await fetchImpl("https://api.github.com/user", {
          headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Yukon-QSB-Rewards" },
          signal: AbortSignal.timeout(10000),
        });
        if (!userResponse.ok) throw Object.assign(new Error(`GitHub /user returned ${userResponse.status}`), { reason: `user_${userResponse.status}` });
        const user = await userResponse.json();
        if (!Number.isSafeInteger(user.id) || typeof user.login !== "string" || !/^[A-Za-z0-9-]{1,39}$/.test(user.login)) throw new Error("Invalid GitHub identity");
        const session = randomBytes(32).toString("base64url");
        await store.create(hash(session), user, new Date(now() + 7 * 24 * 60 * 60 * 1000).toISOString());
        return redirect("/qsb/rewards?github=connected", { cookies: [...clearOAuth, issueSession(session)] });
      } catch (error) {
        console.error(`GitHub callback failed: ${error.message}`);
        return redirect(`/qsb/rewards?auth=failed&why=${encodeURIComponent(error.reason || "exchange")}`, { cookies: clearOAuth });
      }
    }

    if (request.method === "POST" && pathname === "/auth/logout") {
      if (request.headers.get("origin") !== base.origin) return json(403, { error: "Invalid request origin." });
      const token = cookie(request, SESSION_COOKIE);
      if (token) await store.delete(hash(token));
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store", "Set-Cookie": clearSession } });
    }
    return null;
  }
  return { handle, getSession };
}
