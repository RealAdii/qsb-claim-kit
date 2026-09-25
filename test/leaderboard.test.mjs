import test from "node:test";
import assert from "node:assert/strict";
import { accumulate, rank, createLeaderboard, readRoster } from "../server/leaderboard.mjs";

// Two promotions on a baseline of 100: to 150, then to 180. The gains are
// measured against the baseline, so they are 50% and 30%, and they sum to the
// 80% the workload has moved overall.
const submissions = [
  { solverUsername: "ada", status: "accepted", improved: true, officialScore: 150, promotionFinishedAt: "2026-09-01T00:00:00Z", solverAvatarUrl: "https://avatars.githubusercontent.com/u/1?v=4" },
  { solverUsername: "grace", status: "accepted", improved: true, officialScore: 180, promotionFinishedAt: "2026-09-02T00:00:00Z", solverAvatarUrl: "https://avatars.githubusercontent.com/u/2?v=4" },
  { solverUsername: "mallory", status: "rejected", improved: false, officialScore: 900, promotionFinishedAt: "2026-09-03T00:00:00Z" },
];

test("gains are measured against the baseline and reconcile with the workload total", () => {
  const { solvers, record } = accumulate("pinning", 100, submissions);
  const ranked = rank(solvers);
  assert.equal(record, 180);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].login, "ada");
  assert.equal(ranked[0].gains.pinning.toFixed(2), "50.00");
  assert.equal(ranked[1].gains.pinning.toFixed(2), "30.00");
  const sum = ranked.reduce((total, row) => total + row.total, 0);
  assert.equal(sum.toFixed(2), (((180 - 100) / 100) * 100).toFixed(2));
});

test("a rejected submission never counts", () => {
  const { solvers } = accumulate("pinning", 100, submissions);
  assert.equal(solvers.has("mallory"), false);
});

test("both workloads add into one total per solver", () => {
  const { solvers } = accumulate("pinning", 100, submissions);
  accumulate("subset", 50, [{ solverUsername: "ada", status: "accepted", improved: true, officialScore: 75, promotionFinishedAt: "2026-09-04T00:00:00Z" }], solvers);
  const ada = rank(solvers).find((row) => row.login === "ada");
  assert.equal(ada.gains.pinning.toFixed(2), "50.00");
  assert.equal(ada.gains.subset.toFixed(2), "50.00");
  assert.equal(ada.total.toFixed(2), "100.00");
  assert.equal(ada.avatarId, "1");
});

test("a missing baseline is refused rather than guessed", () => {
  assert.throws(() => accumulate("pinning", 0, submissions), /positive baseline/);
});

test("a failed refresh serves the last good copy", async () => {
  const bench = { baselineScore: 100 };
  let attempt = 0;
  const board = createLeaderboard({ ttlMs: 0, fetchImpl: async (url) => {
    if (url.endsWith("/submissions")) {
      attempt += 1;
      if (attempt > 2) return { ok: false, status: 502 };
      return { ok: true, json: async () => ({ submissions }) };
    }
    return { ok: true, json: async () => bench };
  } });
  const first = await board.get();
  assert.equal(first.stale, false);
  assert.ok(first.solvers.length >= 2);
  const second = await board.get();
  assert.equal(second.stale, true);
  assert.equal(second.solvers.length, first.solvers.length);
});

test("the roster still pins named solvers", () => {
  const roster = readRoster(JSON.stringify([{ login: "ada", prize: 1000, title: "Champion" }]));
  assert.equal(roster[0].login, "ada");
  assert.equal(roster[0].prize, 1000);
  assert.throws(() => readRoster("[]"), /non-empty/);
});

// Eligibility follows the same standings the board shows.
import { awardsFromStandings } from "../server/auto-awards.mjs";

const board = (until) => ({
  periods: {
    week1: {
      range: { from: "2026-09-15T00:00:00Z", until },
      solvers: [
        { login: "teamPerson", avatarId: "1", team: "starkware" },
        { login: "ada", avatarId: "2", team: null },
        { login: "grace", avatarId: "3", team: null },
        { login: "hopper", avatarId: "4", team: null },
        { login: "lovelace", avatarId: "5", team: null },
      ],
    },
  },
});

test("a closed period makes its top three claimable, skipping team accounts", () => {
  const awards = awardsFromStandings(board("2026-09-24T00:00:00Z"), { now: Date.parse("2026-09-25T00:00:00Z") });
  assert.equal(awards.get("1"), undefined, "team accounts never get an award");
  assert.equal(awards.get("2").amount, 1000);
  assert.equal(awards.get("2").label, "Week 1 first place");
  assert.equal(awards.get("3").amount, 600);
  assert.equal(awards.get("4").amount, 400);
  assert.equal(awards.get("5"), undefined, "fourth place is not paid");
});

test("a period that is still running grants nothing", () => {
  const awards = awardsFromStandings(board("2026-10-08T00:00:00Z"), { now: Date.parse("2026-09-25T00:00:00Z") });
  assert.equal(awards.size, 0);
});
