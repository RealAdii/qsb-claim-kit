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

try {
  const response = await fetch("/claim/api/qsb/leaderboard");
  if (!response.ok) throw new Error("unavailable");
  const board = await response.json();
  // StarkWare accounts stay in the standings, with their real rank, but the
  // winners panel only ever shows solvers who can actually be paid.
  const eligible = board.solvers.filter((solver) => !solver.team);
  const top = eligible.slice(0, 3);
  const others = board.solvers;
  winners.innerHTML = `<header class="yr-winners-head"><h2>Week 1 winners</h2><p class="yr-winners-range">Week 1 · Sep 8 to Sep 14, 2026</p></header>
    <div class="yr-winners-grid">${top.map(winnerCell).join("")}</div>`;
  rest.innerHTML = others.length
    ? `<div class="yr-rows-head"><span>Solver</span><span class="yr-rows-head-gain">Total gain</span><span>Reward</span></div><ol class="yr-rows">${others.map(row).join("")}</ol>`
    : "";
  const when = board.updatedAt ? new Date(board.updatedAt).toLocaleTimeString() : "";
  const pinning = board.workloads?.pinning?.improvement;
  const subset = board.workloads?.subset?.improvement;
  note.textContent = `Total gain is every promoted submission a solver landed, measured against each workload's baseline and added across both. Pinning has moved ${pinning ? pct(pinning) : "?"} and subset ${subset ? pct(subset) : "?"} since the challenge opened. Standings as of ${when}${board.stale ? ", from the last good copy" : ""}. Week 1 rewards only; Weeks 2 and 3 are still running.`;
} catch {
  note.textContent = "The leaderboard is unavailable right now. Please refresh to try again.";
}
