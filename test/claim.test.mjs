import { test } from "node:test";
import assert from "node:assert/strict";
import { createClaimHandler, validate } from "../server/claim-handler.mjs";
import { seal, unseal } from "../server/crypto.mjs";
const valid = { koshEmail: "solver@kosh.example", email: "solver@example.com", telegram: "@solver_name", detailsConfirmed: true };
const award = { awardId: "weeks23-second", type: "weeks23", label: "Weeks 2 to 3 · 2nd place", amount: 3600 };
function setup({ session = { githubId: 42, login: "solver" }, winningAward = award } = {}) {
  const records = new Map();
  const handler = createClaimHandler({ origin: "https://qsb.example", getSession: async () => session, getAward: async () => winningAward, store: { exists: async (id, awardId) => records.has(`${id}:${awardId}`), save: async (id, awardId, value) => records.set(`${id}:${awardId}`, value) } });
  return { handler, records };
}
const request = (body = valid, origin = "https://qsb.example") => new Request("https://qsb.example/api/yukon/reward-claim", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
test("only an authenticated account on the final award list can claim", async () => {
  assert.equal((await setup({ session: null }).handler(request())).status, 401);
  assert.equal((await setup({ winningAward: null }).handler(request())).status, 403);
});
test("rejects cross-origin writes", async () => { assert.equal((await setup().handler(request(valid, "https://other.example"))).status, 403); });
test("uses the verified account and canonical award, never submitted identity or prize", async () => {
  const { handler, records } = setup();
  assert.equal((await handler(request({ ...valid, githubId: "999", amount: 1 }))).status, 200);
  assert.equal(records.get("42:weeks23-second").githubId, "42");
  assert.equal(records.get("42:weeks23-second").awardAmount, 3600);
});
test("claim status gives the winner their own award and no contact details", async () => {
  const { handler } = setup(); await handler(request());
  const response = await handler(new Request("https://qsb.example/api/yukon/reward-claim"));
  const status = await response.json();
  assert.equal(status.eligible, true);
  assert.equal(status.claimed, true);
  assert.deepEqual(status.award, { amount: 3600 });
  assert.equal(JSON.stringify(status).includes("weeks23"), false);
  assert.equal(JSON.stringify(status).includes("2nd place"), false);
  assert.equal(JSON.stringify(status).includes("solver@example.com"), false);
  assert.equal(JSON.stringify(status).includes("@solver_name"), false);
});
test("award details stay hidden from anyone without a finalized award", async () => {
  for (const options of [{ session: null }, { winningAward: null }]) {
    const status = await (await setup(options).handler(new Request("https://qsb.example/api/yukon/reward-claim"))).json();
    assert.equal(status.eligible, false);
    assert.equal("award" in status, false);
  }
});
test("requires a Kosh email, a contact email, a Telegram username and the confirmation", () => {
  assert.throws(() => validate({ ...valid, koshEmail: "not-email" }));
  assert.throws(() => validate({ ...valid, koshEmail: undefined }));
  assert.throws(() => validate({ ...valid, koshEmail: "" }));
  assert.throws(() => validate({ ...valid, email: "not-email" }));
  assert.throws(() => validate({ ...valid, email: undefined }));
  assert.throws(() => validate({ ...valid, email: "" }));
  assert.throws(() => validate({ ...valid, telegram: "x" }));
  assert.throws(() => validate({ ...valid, telegram: undefined }));
  assert.throws(() => validate({ ...valid, detailsConfirmed: false }));
  assert.equal(validate({ ...valid, telegram: "solver_name" }).telegram, "@solver_name");
  assert.equal(validate({ ...valid, koshEmail: "Solver@Kosh.example" }).koshEmail, "solver@kosh.example");
});
test("caps request size", async () => {
  assert.equal((await setup().handler(request({ ...valid, telegram: "x".repeat(9000) }))).status, 413);
});
test("encrypted claims bind contact data to both account and award", () => {
  process.env.CLAIM_ENCRYPTION_KEY = "ab".repeat(32);
  const encrypted = seal(valid, "42:weeks23-second");
  assert.equal(encrypted.includes("solver@example.com"), false);
  assert.deepEqual(unseal(encrypted, "42:weeks23-second"), valid);
  assert.throws(() => unseal(encrypted, "43:weeks23-second"));
});
test("adapter errors fail closed without exposing internals", async () => {
  const handler = createClaimHandler({ origin: "https://qsb.example", getSession: async () => { throw new Error("SECRET"); }, getAward: async () => award, store: {} });
  const response = await handler(request());
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes("SECRET"), false);
});
