import test from "node:test";
import assert from "node:assert/strict";
import { createSnapshotBoard } from "../server/snapshots.mjs";

// A tiny in-memory stand-in for the two queries the store uses.
function fakePool() {
  const rows = [];
  return {
    rows,
    async query(sql, params) {
      if (sql.startsWith("INSERT")) { rows.push({ payload: params[0], fetched_at: params[1] }); return { rowCount: 1 }; }
      if (sql.startsWith("DELETE")) return { rowCount: 0 };
      const latest = [...rows].sort((a, b) => b.fetched_at - a.fetched_at)[0];
      return { rows: latest ? [latest] : [] };
    },
  };
}
const standings = () => ({ solvers: [{ login: "ada" }], workloads: { pinning: { improvement: 1 }, subset: { improvement: 2 } }, periods: {} });

test("a fresh snapshot is served without recomputing", async () => {
  const pool = fakePool();
  let computed = 0;
  const board = createSnapshotBoard({ pool, compute: async () => { computed += 1; return standings(); } });
  await board.refresh();
  const served = await board.get();
  assert.equal(computed, 1);
  assert.equal(served.source, "snapshot");
  assert.equal(served.solvers[0].login, "ada");
});

test("an old snapshot triggers a recompute, and a failed recompute falls back to it", async () => {
  const pool = fakePool();
  let clock = Date.parse("2026-09-29T10:00:00Z");
  let fail = false;
  const board = createSnapshotBoard({ pool, now: () => clock, compute: async () => { if (fail) throw new Error("upstream down"); return standings(); } });
  await board.refresh();
  clock += 60 * 60 * 1000;
  const recomputed = await board.get();
  assert.equal(recomputed.source, "live");
  clock += 60 * 60 * 1000;
  fail = true;
  const fallback = await board.get();
  assert.equal(fallback.stale, true);
  assert.equal(fallback.source, "snapshot");
});

test("with no snapshot and a failing upstream the error surfaces", async () => {
  const board = createSnapshotBoard({ pool: fakePool(), compute: async () => { throw new Error("upstream down"); } });
  await assert.rejects(() => board.get(), /upstream down/);
});
