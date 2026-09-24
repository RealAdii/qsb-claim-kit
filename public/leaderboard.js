import { mountAccount } from "./claim.js?v=2";

const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const avatarUrl = (id, size) => `https://avatars.githubusercontent.com/u/${encodeURIComponent(id)}?v=4&s=${size}`;
const money = (amount) => `$${Number(amount).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const pct = (value) => `${Number(value).toFixed(2)}%`;
const winners = document.querySelector("#yr-winners");
const rest = document.querySelector("#yr-rest");
const note = document.querySelector("#yr-board-note");

await mountAccount();

const crown = '<svg class="yr-crown" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 7.5 7 11l5-6.5L17 11l4-3.5V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7.5Z"/></svg>';
const titles = ["Champion", "2nd place", "3rd place"];
const teamTag = '<span class="yr-team" tabindex="0" role="note" aria-label="StarkWare member. StarkWare members are not eligible for the rewards."><img src="/claim/media/favicon.svg" alt="" width="16" height="16"><span class="yr-tip">StarkWare members are not eligible for the rewards.</span></span>';

function breakdown(solver) {
  return `<span class="yr-split" tabindex="0" role="note" aria-label="Pinning ${pct(solver.gains.pinning)}, subset ${pct(solver.gains.subset)}, from ${solver.promotions} promoted submissions.">
    <b>${pct(solver.total)}</b>
    <span class="yr-tip yr-tip-split">
      <span><i>Pinning</i><b>${pct(solver.gains.pinning)}</b></span>
      <span><i>Subset</i><b>${pct(solver.gains.subset)}</b></span>
      <span class="yr-tip-foot"><i>Promoted submissions</i><b>${solver.promotions}</b></span>
    </span>
  </span>`;
}

function winnerCell(solver, index) {
  return `<article class="yr-winner-cell${index === 0 ? " is-champion" : ""}">
    ${solver.avatarId ? `<img class="yr-winner-avatar" src="${avatarUrl(solver.avatarId, 96)}" alt="" width="46" height="46" loading="lazy">` : `<span class="yr-winner-avatar"></span>`}
    <div class="yr-winner-body">
      <p class="yr-winner-title">${index === 0 ? crown : ""}${safe(solver.title || titles[index] || "")}</p>
      <p class="yr-winner-name">${safe(solver.login)}${solver.team ? teamTag : ""}</p>
      <p class="yr-winner-meta">${solver.prize ? money(solver.prize) : "To be announced"} <span>·</span> ${pct(solver.total)} gain</p>
    </div>
  </article>`;
}

function row(solver, index) {
  return `<li class="yr-row${index === 0 && !solver.team ? " is-lead" : ""}">
    <span class="yr-row-rank">${String(solver.rank).padStart(2, "0")}</span>
    ${solver.avatarId ? `<img class="yr-row-avatar" src="${avatarUrl(solver.avatarId, 64)}" alt="" width="32" height="32" loading="lazy">` : `<span class="yr-row-avatar"></span>`}
    <span class="yr-row-name">${safe(solver.login)}${index === 0 && !solver.team ? crown : ""}${solver.team ? teamTag : ""}</span>
    <span class="yr-row-gain">${breakdown(solver)}<small>total gain</small></span>
    <span class="yr-row-prize">${solver.team ? "<span>Not eligible</span>" : solver.prize ? money(solver.prize) : "<span>&mdash;</span>"}</span>
  </li>`;
}

const day = (value) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const range = (period) => {
  if (!period?.range) return "";
  // The window is half open, so the last day shown is the day before it ends.
  const until = new Date(Date.parse(period.range.until) - 864e5);
  return `${day(period.range.from)} to ${day(until)}`;
};

const PERIODS = [
  { key: "week1", label: "Week 1", pool: "$2,000" },
  { key: "weeks23", label: "Weeks 2 and 3", pool: "$18,000" },
];

function render(board, active) {
  const period = board.periods?.[active] || { solvers: board.solvers, workloads: board.workloads };
  const eligible = period.solvers.filter((solver) => !solver.team);
  const top = eligible.slice(0, 3);
  const tabs = PERIODS.map(({ key, label, pool }) =>
    `<button type="button" class="yr-period-tab${key === active ? " is-active" : ""}" data-period="${key}" aria-pressed="${key === active}">${label}<span>${pool}</span><small>${range(board.periods?.[key])}</small></button>`).join("");
  const heading = PERIODS.find((p) => p.key === active).label;
  winners.innerHTML = `<div class="yr-period-tabs" role="group" aria-label="Reward period">${tabs}</div>
    <header class="yr-winners-head"><h2>${heading} winners</h2><p class="yr-winners-range">${range(period)}${range(period) ? " · " : ""}${active === "week1" ? "Closed" : "Still running"}</p></header>
    ${top.length ? `<div class="yr-winners-grid">${top.map(winnerCell).join("")}</div>`
      : `<p class="yr-winners-empty">No promoted submissions in this period yet. Winners appear here as solvers push the record.</p>`}`;
  rest.innerHTML = period.solvers.length
    ? `<div class="yr-rows-head"><span>Solver</span><span class="yr-rows-head-gain">Total gain</span><span>Reward</span></div><ol class="yr-rows">${period.solvers.map(row).join("")}</ol>`
    : `<p class="yr-winners-empty">Nothing here yet.</p>`;
  for (const tab of winners.querySelectorAll(".yr-period-tab")) {
    tab.onclick = () => render(board, tab.dataset.period);
  }
  const when = board.updatedAt ? new Date(board.updatedAt).toLocaleTimeString() : "";
  const pinning = period.workloads?.pinning?.improvement;
  const subset = period.workloads?.subset?.improvement;
  note.textContent = `Total gain is every promoted submission a solver landed in this period, measured against the baseline the period started from and added across both workloads. Pinning has moved ${pinning ? pct(pinning) : "?"} and subset ${subset ? pct(subset) : "?"}. Weeks 2 and 3 start again from wherever the frontier stood when Week 1 closed. Standings as of ${when}${board.stale ? ", from the last good copy" : ""}.`;
}

try {
  const response = await fetch("/claim/api/qsb/leaderboard");
  if (!response.ok) throw new Error("unavailable");
  const board = await response.json();
  render(board, "week1");
} catch {
  note.textContent = "The leaderboard is unavailable right now. Please refresh to try again.";
}
