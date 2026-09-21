import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createGithubAuth } from "../server/github-auth.mjs";

function setup(fetchImpl) {
  const sessions = new Map();
  const store = {
    async create(hash, user, expiresAt) { sessions.set(hash, { githubId: String(user.id), login: user.login, expiresAt }); },
    async get(hash) { const value = sessions.get(hash); return value ? { githubId: value.githubId, login: value.login } : null; },
    async delete(hash) { sessions.delete(hash); },
  };
  const auth = createGithubAuth({ origin: "http://127.0.0.1:4318", callbackUrl: "http://127.0.0.1:4318/auth/github/callback", clientId: "test-client", clientSecret: "test-secret", store, fetchImpl, now: () => 1789990000000 });
  return { auth, sessions };
}
const parseCookies = (values) => values.map((entry) => entry.split(";", 1)[0]).join("; ");

test("starts GitHub OAuth with state, PKCE, and HttpOnly cookies", async () => {
  const { auth } = setup(async () => { throw new Error("fetch should not run"); });
  const response = await auth.handle(new Request("http://127.0.0.1:4318/auth/github"), "/auth/github");
  assert.equal(response.status, 302);
  const authorize = new URL(response.headers.get("location"));
  assert.equal(authorize.origin, "https://github.com");
  assert.equal(authorize.pathname, "/login/oauth/authorize");
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorize.searchParams.get("redirect_uri"), "http://127.0.0.1:4318/auth/github/callback");
  assert.ok(authorize.searchParams.get("state"));
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.ok(response.headers.getSetCookie().every((value) => value.includes("HttpOnly")));
});

test("callback verifies state, exchanges PKCE code, fetches GitHub identity, and issues a session", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push([String(url), init]);
    return String(url).includes("access_token")
      ? new Response(JSON.stringify({ access_token: "gho-test-token" }), { status: 200 })
      : new Response(JSON.stringify({ id: 24680, login: "winner" }), { status: 200 });
  };
  const { auth, sessions } = setup(fetchImpl);
  const start = await auth.handle(new Request("http://127.0.0.1:4318/auth/github"), "/auth/github");
  const cookies = responseCookies(start);
  const state = new URL(start.headers.get("location")).searchParams.get("state");
  const callback = await auth.handle(new Request(`http://127.0.0.1:4318/auth/github/callback?code=oauth-code&state=${state}`, { headers: { cookie: cookies } }), "/auth/github/callback");
  assert.equal(callback.status, 303);
  assert.equal(new URL(callback.headers.get("location")).pathname, "/qsb/rewards");
  assert.equal(new URL(callback.headers.get("location")).searchParams.get("github"), "connected");
  assert.equal(seen.length, 2);
  const tokenBody = JSON.parse(seen[0][1].body);
  assert.equal(tokenBody.code, "oauth-code");
  assert.equal(tokenBody.client_secret, "test-secret");
  assert.ok(tokenBody.code_verifier);
  assert.equal(seen[1][1].headers.Authorization, "Bearer gho-test-token");
  const issuedCookies = callback.headers.getSetCookie();
  assert.equal(issuedCookies.length, 3);
  const sessionCookie = issuedCookies.find((value) => value.startsWith("yukon_reward_session=")).split(";", 1)[0];
  const sessionRequest = new Request("http://127.0.0.1:4318/api/yukon/reward-claim", { headers: { cookie: sessionCookie } });
  assert.deepEqual(await auth.getSession(sessionRequest), { githubId: "24680", login: "winner" });
  assert.equal(sessions.size, 1);
});

test("rejects state mismatch without contacting GitHub", async () => {
  let called = false;
  const { auth } = setup(async () => { called = true; throw new Error("must not fetch"); });
  const response = await auth.handle(new Request("http://127.0.0.1:4318/auth/github/callback?code=x&state=attacker"), "/auth/github/callback");
  assert.equal(response.status, 303);
  assert.equal(called, false);
});

test("logout checks origin and deletes the hashed session", async () => {
  const { auth, sessions } = setup(async () => { throw new Error("not used"); });
  const fakeHash = createHash("sha256").update("session").digest("hex");
  sessions.set(fakeHash, { githubId: "24680", login: "winner" });
  const rejected = await auth.handle(new Request("http://127.0.0.1:4318/auth/logout", { method: "POST", headers: { origin: "https://attacker.test", cookie: "yukon_reward_session=session" } }), "/auth/logout");
  assert.equal(rejected.status, 403);
  const response = await auth.handle(new Request("http://127.0.0.1:4318/auth/logout", { method: "POST", headers: { origin: "http://127.0.0.1:4318", cookie: "yukon_reward_session=session" } }), "/auth/logout");
  assert.equal(response.status, 204);
  assert.equal(sessions.size, 0);
});

function responseCookies(response) {
  return parseCookies(response.headers.getSetCookie());
}
