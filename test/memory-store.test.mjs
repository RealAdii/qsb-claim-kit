import test from "node:test";
import assert from "node:assert/strict";
process.env.CLAIM_ENCRYPTION_KEY = process.env.CLAIM_ENCRYPTION_KEY || "a".repeat(64);
const { memoryAuthStore, memoryClaimStore, memoryAwardTable, readAwardSnapshot } = await import("../server/memory-store.mjs");

test("memory sessions expire", async () => {
  const store = memoryAuthStore();
  await store.create("hash-a", { id: 42, login: "solver" }, new Date(Date.now() + 60000).toISOString());
  assert.deepEqual(await store.get("hash-a"), { githubId: "42", login: "solver" });
  await store.create("hash-b", { id: 43, login: "late" }, new Date(Date.now() - 1000).toISOString());
  assert.equal(await store.get("hash-b"), null);
  await store.delete("hash-a");
  assert.equal(await store.get("hash-a"), null);
});

test("memory claims encrypt at rest and bump revision on resubmit", async () => {
  const store = memoryClaimStore();
  assert.equal(await store.exists("42", "week1-first"), false);
  await store.save("42", "week1-first", { koshStarknetAddress: "0x1", telegram: "@solver" });
  assert.equal(await store.exists("42", "week1-first"), true);
  await store.save("42", "week1-first", { koshStarknetAddress: "0x2", telegram: "@solver" });
  const rows = store.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].koshStarknetAddress, "0x2");
  assert.equal(rows[0].revision, 2);
});

test("only finalized awards are claimable", async () => {
  const table = memoryAwardTable(readAwardSnapshot(JSON.stringify([
    { githubId: "42", awardId: "week1-first", awardType: "week1", awardLabel: "Week 1 winner", awardAmount: 1000, finalized: true },
    { githubId: "43", awardId: "week1-second", awardType: "week1", awardLabel: "Week 1 second", awardAmount: 600, finalized: false },
  ])));
  assert.equal((await table.getAward("42")).amount, 1000);
  assert.equal((await table.getAward(42)).awardId, "week1-first");
  assert.equal(await table.getAward("43"), null);
  assert.equal(await table.getAward("999"), null);
});

test("award snapshots reject bad rows and duplicates", () => {
  const good = { githubId: "42", awardId: "week1-first", awardType: "week1", awardLabel: "Week 1 winner", awardAmount: 1000, finalized: true };
  assert.throws(() => readAwardSnapshot(JSON.stringify([{ ...good, githubId: "octocat" }])), /numeric GitHub account id/);
  assert.throws(() => readAwardSnapshot(JSON.stringify([{ ...good, awardAmount: 0 }])), /positive number/);
  assert.throws(() => readAwardSnapshot(JSON.stringify([{ ...good, awardLabel: "" }])), /required/);
  assert.throws(() => readAwardSnapshot(JSON.stringify([good, good])), /Duplicate award/);
  assert.throws(() => readAwardSnapshot(JSON.stringify({ rows: [good] })), /JSON array/);
});

test("logins resolve to immutable numeric ids", async () => {
  const { resolveLogins } = await import("../server/memory-store.mjs");
  const calls = [];
  const stub = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => ({ id: 153971735, login: "RealAdii" }) };
  };
  const awards = readAwardSnapshot(JSON.stringify([
    { login: "realadii", awardId: "week1-first", awardType: "week1", awardLabel: "Week 1 winner", awardAmount: 1000, finalized: true },
    { login: "RealAdii", awardId: "week1-bonus", awardType: "week1", awardLabel: "Week 1 bonus", awardAmount: 200, finalized: true },
    { githubId: "42", awardId: "week1-second", awardType: "week1", awardLabel: "Week 1 second", awardAmount: 600, finalized: true },
  ]));
  const resolved = await resolveLogins(awards, stub);
  assert.equal(resolved[0].githubId, "153971735");
  assert.equal(resolved[0].login, "RealAdii");
  assert.equal(resolved[2].githubId, "42");
  assert.equal(calls.length, 1, "one lookup per distinct login");
});

test("an unresolvable login stops the load", async () => {
  const { resolveLogins } = await import("../server/memory-store.mjs");
  const awards = readAwardSnapshot(JSON.stringify([{ login: "ghost", awardId: "a", awardType: "week1", awardLabel: "x", awardAmount: 1, finalized: true }]));
  await assert.rejects(() => resolveLogins(awards, async () => ({ ok: false, status: 404 })), /Could not resolve GitHub login "ghost"/);
});

test("a row with neither id nor login is rejected", () => {
  assert.throws(() => readAwardSnapshot(JSON.stringify([{ awardId: "a", awardType: "week1", awardLabel: "x", awardAmount: 1 }])), /githubId, or a login/);
});
