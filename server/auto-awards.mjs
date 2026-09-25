// Eligibility follows the published ladder: once a reward period has closed,
// its top three solvers who are not on a team can claim, in order. A finalized
// row in the database always wins over this, so an operator can override any
// automatic result. A period that is still running never grants a claim, since
// its standings are still moving.
export const LADDER = {
  week1: { label: "Week 1", amounts: [1000, 600, 400] },
  weeks23: { label: "Weeks 2 and 3", amounts: [6000, 3600, 2400] },
};
const PLACES = ["first place", "second place", "third place"];

export function awardsFromStandings(board, { now = Date.now() } = {}) {
  const awards = new Map();
  for (const [period, { label, amounts }] of Object.entries(LADDER)) {
    const data = board.periods?.[period];
    if (!data?.range?.until) continue;
    if (Date.parse(data.range.until) > now) continue;
    const eligible = data.solvers.filter((solver) => !solver.team);
    eligible.slice(0, amounts.length).forEach((solver, index) => {
      if (!solver.avatarId) return;
      awards.set(String(solver.avatarId), {
        awardId: `${period}-${index + 1}`,
        type: period,
        label: `${label} ${PLACES[index]}`,
        amount: amounts[index],
        login: solver.login,
      });
    });
  }
  return awards;
}
