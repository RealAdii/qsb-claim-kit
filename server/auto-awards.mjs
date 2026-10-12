// Eligibility follows the published ladder: once a reward period has closed,
// its top three solvers who are not on a team can claim, in order. A finalized
// row in the database always wins over this, so an operator can override any
// automatic result. A period that is still running never grants a claim, since
// its standings are still moving.
//
// The raffle pool is shared equally by every solver who is not on a team and
// improved the frontier by at least the threshold over the whole challenge.
// It opens once the last period has closed, because the qualifier count, and
// so each share, is only fixed at that point.
export const LADDER = {
  week1: { label: "Week 1", amounts: [1000, 600, 400] },
  weeks23: { label: "Weeks 2 and 3", amounts: [6000, 3600, 2400] },
};
export const RAFFLE = { pool: 6000, threshold: 3, period: "all", closesWith: "weeks23", label: "Raffle share" };
const PLACES = ["first place", "second place", "third place"];

const closed = (board, period, now) => {
  const until = board.periods?.[period]?.range?.until;
  return Boolean(until) && Date.parse(until) <= now;
};

export function raffleFromStandings(board, { now = Date.now() } = {}) {
  const solvers = board.periods?.[RAFFLE.period]?.solvers || board.solvers || [];
  const qualifiers = solvers.filter((solver) => !solver.team && Number(solver.total) >= RAFFLE.threshold && solver.avatarId);
  const open = closed(board, RAFFLE.closesWith, now) && qualifiers.length > 0;
  const share = open ? Math.floor((RAFFLE.pool / qualifiers.length) * 100) / 100 : 0;
  return { ...RAFFLE, open, count: qualifiers.length, share, qualifiers: open ? qualifiers.map((solver) => ({ login: solver.login, avatarId: String(solver.avatarId), total: solver.total })) : [] };
}

// One claim per account. When an account has more than one award, the podium
// award keeps its id, so a claim already filed against it stays valid, and the
// amounts are added together. Labels are joined for the claim record.
export function combineAwards(awards) {
  const list = awards.filter(Boolean);
  if (!list.length) return null;
  if (list.length === 1) return { ...list[0] };
  const [first, ...more] = list;
  return {
    ...first,
    label: [first.label, ...more.map((award) => award.label)].join(" plus "),
    amount: Math.round(list.reduce((sum, award) => sum + Number(award.amount), 0) * 100) / 100,
    parts: list.map(({ awardId, type, label, amount }) => ({ awardId, type, label, amount: Number(amount) })),
  };
}

export function awardsFromStandings(board, { now = Date.now() } = {}) {
  const parts = new Map();
  const add = (id, award) => parts.set(id, [...(parts.get(id) || []), award]);
  for (const [period, { label, amounts }] of Object.entries(LADDER)) {
    const data = board.periods?.[period];
    if (!data?.range?.until) continue;
    if (Date.parse(data.range.until) > now) continue;
    const eligible = data.solvers.filter((solver) => !solver.team);
    eligible.slice(0, amounts.length).forEach((solver, index) => {
      if (!solver.avatarId) return;
      add(String(solver.avatarId), {
        awardId: `${period}-${index + 1}`,
        type: period,
        label: `${label} ${PLACES[index]}`,
        amount: amounts[index],
        login: solver.login,
      });
    });
  }
  const raffle = raffleFromStandings(board, { now });
  for (const solver of raffle.qualifiers) {
    add(solver.avatarId, { awardId: "raffle", type: "raffle", label: raffle.label, amount: raffle.share, login: solver.login });
  }
  return new Map([...parts].map(([id, awards]) => [id, combineAwards(awards)]));
}
