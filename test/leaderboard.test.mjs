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

// The raffle opens with the last period and is shared equally by everyone
// above the threshold, and a solver with two awards gets one combined claim.
import { raffleFromStandings, combineAwards } from "../server/auto-awards.mjs";

const fullBoard = (until) => ({
  periods: {
    week1: { range: { from: "2026-09-15T00:00:00Z", until: "2026-09-24T00:00:00Z" }, solvers: [{ login: "ada", avatarId: "2", team: null, total: 70 }] },
    weeks23: { range: { from: "2026-09-24T00:00:00Z", until }, solvers: [{ login: "grace", avatarId: "3", team: null, total: 10 }, { login: "ada", avatarId: "2", team: null, total: 5 }] },
    all: { range: { from: "2026-09-15T00:00:00Z", until }, solvers: [
      { login: "teamPerson", avatarId: "1", team: "starkware", total: 500 },
      { login: "ada", avatarId: "2", team: null, total: 75 },
      { login: "grace", avatarId: "3", team: null, total: 10 },
      { login: "hopper", avatarId: "4", team: null, total: 3 },
      { login: "lovelace", avatarId: "5", team: null, total: 2.99 },
    ] },
  },
});

test("the raffle is shared equally by every non-team solver at 3 percent or more once the challenge closes", () => {
  const now = Date.parse("2026-10-09T00:00:00Z");
  const raffle = raffleFromStandings(fullBoard("2026-10-08T00:00:00Z"), { now });
  assert.equal(raffle.open, true);
  assert.deepEqual(raffle.qualifiers.map((q) => q.login), ["ada", "grace", "hopper"]);
  assert.equal(raffle.share, 2000);
  assert.equal(raffleFromStandings(fullBoard("2026-10-08T00:00:00Z"), { now: Date.parse("2026-10-01T00:00:00Z") }).open, false, "nothing before the last period closes");
});

test("a podium winner who also qualifies for the raffle gets one combined claim under the podium award id", () => {
  const awards = awardsFromStandings(fullBoard("2026-10-08T00:00:00Z"), { now: Date.parse("2026-10-09T00:00:00Z") });
  const ada = awards.get("2");
  assert.equal(ada.awardId, "week1-1");
  assert.equal(ada.amount, 1000 + 3600 + 2000, "Week 1 first, Weeks 2 and 3 second, and a raffle share");
  assert.equal(ada.parts.length, 3);
  assert.match(ada.label, /Week 1 first place plus .*Raffle share/);
  assert.equal(awards.get("4").awardId, "raffle");
  assert.equal(awards.get("4").amount, 2000);
  assert.equal(awards.get("5"), undefined, "2.99 percent does not qualify");
  assert.equal(awards.get("1"), undefined, "team accounts never qualify");
});

test("combineAwards keeps the first award id and adds the amounts", () => {
  const combined = combineAwards([{ awardId: "weeks23-1", type: "weeks23", label: "Weeks 2 and 3 first place", amount: 6000 }, { awardId: "raffle", type: "raffle", label: "Raffle share", amount: 272.73 }]);
  assert.equal(combined.awardId, "weeks23-1");
  assert.equal(combined.amount, 6272.73);
  assert.equal(combineAwards([]), null);
});
