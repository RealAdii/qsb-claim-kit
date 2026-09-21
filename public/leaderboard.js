import { mountAccount } from "./claim.js";

const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const avatarUrl = (id, size) => `https://avatars.githubusercontent.com/u/${encodeURIComponent(id)}?v=4&s=${size}`;
const money = (amount) => `$${Number(amount).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const winners = document.querySelector("#yr-winners");
const rest = document.querySelector("#yr-rest");
const note = document.querySelector("#yr-board-note");

await mountAccount();

const crown = '<svg class="yr-crown" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 7.5 7 11l5-6.5L17 11l4-3.5V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7.5Z"/></svg>';
const titles = ["Champion", "2nd place", "3rd place"];

function winnerCell(solver, index) {
  const title = solver.title || titles[index] || `Place ${solver.rank}`;
  const points = solver.points ? `${solver.points.toLocaleString("en-US")} points` : safe(solver.score);
  const prize = solver.prize ? money(solver.prize) : "To be announced";
  return `<article class="yr-winner-cell${index === 0 ? " is-champion" : ""}">
    ${solver.avatarId ? `<img class="yr-winner-avatar" src="${avatarUrl(solver.avatarId, 96)}" alt="" width="46" height="46" loading="lazy">` : `<span class="yr-winner-avatar"></span>`}
    <div class="yr-winner-body">
      <p class="yr-winner-title">${index === 0 ? crown : ""}${safe(title)}</p>
      <p class="yr-winner-name">${safe(solver.login)}</p>
      <p class="yr-winner-meta">${prize} <span>·</span> ${points}</p>
    </div>
  </article>`;
}

function row(solver, index) {
  return `<li class="yr-row${index === 0 ? " is-lead" : ""}">
    <span class="yr-row-rank">${String(solver.rank).padStart(2, "0")}</span>
    ${solver.avatarId ? `<img class="yr-row-avatar" src="${avatarUrl(solver.avatarId, 64)}" alt="" width="32" height="32" loading="lazy">` : `<span class="yr-row-avatar"></span>`}
    <span class="yr-row-name">${safe(solver.login)}${index === 0 ? crown : ""}</span>
    <span class="yr-row-model">${safe(solver.model || "")}</span>
    <span class="yr-row-score">${safe(solver.score)}<span>candidates/s</span></span>
    <span class="yr-row-prize">${solver.prize ? money(solver.prize) : "<span>&mdash;</span>"}</span>
  </li>`;
}

try {
  const response = await fetch("/api/qsb/leaderboard");
  if (!response.ok) throw new Error("unavailable");
  const board = await response.json();
  const top = board.solvers.slice(0, 3);
  const others = board.solvers.slice(3);
  winners.innerHTML = `<header class="yr-winners-head"><h2>Weekly winners</h2><p class="yr-winners-range">Week 1 · Sep 8 to Sep 14, 2026</p></header>
    <div class="yr-winners-grid">${top.map(winnerCell).join("")}</div>`;
  rest.innerHTML = others.length
    ? `<div class="yr-rows-head"><span>Solver</span><span>Reward</span></div><ol class="yr-rows">${others.map(row).join("")}</ol>`
    : "";
  const when = board.updatedAt ? new Date(board.updatedAt).toLocaleTimeString() : "";
  note.textContent = board.stale
    ? `Showing the last good copy of the standings, from ${when}. Week 1 rewards only; Weeks 2 and 3 are still running.`
    : `Standings as of ${when}. Week 1 rewards only; Weeks 2 and 3 are still running.`;
} catch {
  note.textContent = "The leaderboard is unavailable right now. Please refresh to try again.";
}
