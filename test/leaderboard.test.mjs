import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseLeaderboard, createLeaderboard } from "../server/leaderboard.mjs";

const fixture = readFileSync(new URL("./fixtures/qsb-leaderboard.html", import.meta.url), "utf8");

test("parses one entry per solver, ranked", () => {
  const solvers = parseLeaderboard(fixture);
  assert.ok(solvers.length >= 3);
  assert.deepEqual(solvers.map((s) => s.rank).slice(0, 3), [1, 2, 3]);
  assert.equal(solvers[0].login, "Saviour1001");
  assert.equal(solvers[0].avatarId, "71517788");
  assert.equal(solvers[0].score, "789M");
  assert.equal(solvers[0].model, "Grok 4.6");
  assert.equal(new Set(solvers.map((s) => s.login.toLowerCase())).size, solvers.length, "no duplicate solvers");
});

test("markup that no longer matches yields no rows rather than junk", () => {
  assert.deepEqual(parseLeaderboard("<html><body>nothing here</body></html>"), []);
});

test("a failed refresh serves the last good copy", async () => {
  let attempt = 0;
  const board = createLeaderboard({ ttlMs: 0, fetchImpl: async () => {
    attempt += 1;
    if (attempt === 1) return { ok: true, text: async () => fixture };
    return { ok: false, status: 502 };
  } });
  const first = await board.get();
  assert.equal(first.stale, false);
  assert.ok(first.solvers.length >= 3);
  const second = await board.get();
  assert.equal(second.stale, true);
  assert.equal(second.solvers.length, first.solvers.length);
});

test("a first fetch that fails surfaces the error", async () => {
  const board = createLeaderboard({ fetchImpl: async () => ({ ok: false, status: 500 }) });
  await assert.rejects(() => board.get(), /returned 500/);
});
