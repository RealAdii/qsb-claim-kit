const githubMark = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .9a11.1 11.1 0 0 0-3.51 21.63c.56.1.76-.24.76-.54v-2.1c-3.1.68-3.75-1.32-3.75-1.32-.5-1.3-1.24-1.64-1.24-1.64-1.02-.7.08-.69.08-.69 1.12.08 1.71 1.15 1.71 1.15 1 .1.75 2.07 3.36 1.48.1-.73.39-1.23.7-1.52-2.48-.29-5.09-1.24-5.09-5.52 0-1.22.44-2.22 1.15-3-.12-.29-.5-1.45.11-3.02 0 0 .94-.3 3.05 1.15a10.6 10.6 0 0 1 5.55 0c2.11-1.45 3.05-1.15 3.05-1.15.61 1.57.23 2.73.11 3.02.72.78 1.15 1.78 1.15 3 0 4.29-2.61 5.22-5.1 5.5.4.35.76 1.03.76 2.08v3.09c0 .3.2.65.77.54A11.1 11.1 0 0 0 12 .9Z"/></svg>';
const avatar = (id) => `https://avatars.githubusercontent.com/u/${encodeURIComponent(id)}?v=4&s=120`;
const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function httpClient(endpoint = "/api/yukon/reward-claim", loginUrl = "/auth/github?returnTo=%2Fqsb%2Frewards%3Fgithub%3Dconnected") {
  async function request(method, data) {
    const response = await fetch(endpoint, { method, credentials: "same-origin", headers: data ? { "Content-Type": "application/json" } : {}, body: data ? JSON.stringify(data) : undefined });
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error || "Could not submit your claim. Please try again.");
      if (response.status === 401) error.expired = true;
      throw error;
    }
    return result;
  }
  async function signOut() {
    try { await fetch("/auth/logout", { method: "POST", credentials: "same-origin" }); } catch { /* sign in again regardless */ }
    window.location.assign("/auth/github");
  }
  return { status: () => request("GET"), save: (data) => request("POST", data), connect: () => { window.location.assign(loginUrl); }, signOut };
}

const money = (amount) => `$${Number(amount).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
// Collectible winner card: foil edge, halftone portrait, nameplate. Every
// winner reads "WINNER" regardless of which award they hold.
const winnerCard = (user) => `<div class="yr-card" id="yr-card"><div class="yr-card-foil"><div class="yr-card-face">
    <video class="yr-card-loop" autoplay muted loop playsinline preload="auto" poster="/media/card-loop.jpg" aria-hidden="true" tabindex="-1"><source src="/media/card-loop.mp4" type="video/mp4"></video>
    <div class="yr-card-top"><span>YUKON</span><span class="yr-card-top-sep" aria-hidden="true"></span><span>QSB</span></div>
    <div class="yr-card-portrait"><img src="${avatar(user.id)}" alt="" width="240" height="240"><span class="yr-card-dots" aria-hidden="true"></span></div>
    <div class="yr-card-plate"><strong>@${safe(user.login)}</strong><span>WINNER</span></div>
    <p class="yr-card-meta">QUANTUM SAFE BITCOIN CHALLENGE</p>
  </div></div>
</div>`;
const switchAccountButton = (id) => `<button type="button" class="yr-switch-account" id="${id}">Use another GitHub account</button>`;


// The account control lives in the page header on every page, so it is its own
// small unit: connect when signed out, avatar pill with a menu when signed in.
export function createAccountHeader({ slot, client, onState }) {
  async function connect(button) {
    button.disabled = true; button.textContent = "Connecting...";
    try { const next = await client.connect(); if (next) onState?.(next, true); }
    catch { button.disabled = false; button.innerHTML = `${githubMark}Connect GitHub`; }
  }
  async function switchAccount(event) {
    const button = event.currentTarget;
    button.disabled = true; button.textContent = "Signing out...";
    const next = await client.signOut?.();
    if (next) onState?.(next, false);
  }
  function render(state) {
    if (!slot) return;
    if (!state?.user) {
      slot.innerHTML = `<button type="button" class="yr-header-connect" id="yr-header-connect">${githubMark}Connect GitHub</button>`;
      slot.querySelector("#yr-header-connect").onclick = (event) => connect(event.currentTarget);
      return;
    }
    slot.innerHTML = `<div class="yr-account"><button type="button" class="yr-account-pill" id="yr-account-pill" aria-haspopup="menu" aria-expanded="false"><img class="yr-account-avatar" src="${avatar(state.user.id)}" alt="" width="28" height="28"><span>${safe(state.user.login)}</span><svg class="yr-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="yr-account-menu" id="yr-account-menu" role="menu" hidden><button type="button" role="menuitem" id="yr-switch-menu">Use another GitHub account</button></div></div>`;
    const pill = slot.querySelector("#yr-account-pill");
    const menu = slot.querySelector("#yr-account-menu");
    const closeMenu = () => { menu.hidden = true; pill.setAttribute("aria-expanded", "false"); };
    pill.onclick = (event) => {
      event.stopPropagation();
      const open = menu.hidden;
      menu.hidden = !open; pill.setAttribute("aria-expanded", String(open));
      if (open) menu.querySelector("button").focus();
    };
    menu.querySelector("#yr-switch-menu").onclick = switchAccount;
    document.addEventListener("click", closeMenu);
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenu(); });
  }
  return { render, switchAccount };
}

// For pages that only carry the header, such as the leaderboard.
export async function mountAccount({ slot = document.querySelector("#claim-connect"), client = httpClient() } = {}) {
  const header = createAccountHeader({ slot, client, onState: (next) => header.render(next) });
  try { header.render(await client.status()); } catch { header.render(null); }
  return header;
}

export async function mountClaim({ entry, client = httpClient(), headerSlot = document.querySelector("#claim-connect") }) {
  let state, disposed = false, saving = false;
  const header = createAccountHeader({ slot: headerSlot, client, onState: (next, celebrate) => { state = next; renderState(celebrate); } });
  const switchAccount = header.switchAccount;
  const renderHeader = () => header.render(state);
  function wireSwitchAccount(id) {
    const button = entry.querySelector(`#${id}`);
    if (button) button.onclick = switchAccount;
  }
  function confetti() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const colors = ["#c8781f", "#d78b46", "#e8a95f", "#f3c78a", "#fbe6bd"];
    for (let i = 0; i < 48; i++) {
      const piece = document.createElement("i"); piece.className = "yr-confetti";
      piece.style.left = `${Math.random() * 100}vw`; piece.style.background = colors[i % colors.length];
      piece.style.animationDelay = `${Math.random() * 0.65}s`; piece.style.setProperty("--drift", `${Math.random() * 180 - 90}px`);
      document.body.append(piece); setTimeout(() => piece.remove(), 3300);
    }
  }
  // Connecting happens from the header control, so there is no card until
  // there is a signed-in account. Only an auth error keeps the card visible.
  function renderConnect() {
    const params = new URLSearchParams(location.search);
    const authResult = params.get("auth");
    if (authResult) { params.delete("auth"); history.replaceState(null, "", location.pathname + (params.size ? `?${params}` : "")); }
    const notices = {
      failed: `<p class="yr-error" role="alert">GitHub sign-in could not be completed. Please try again.</p>`,
      cancelled: `<p class="yr-error" role="status">GitHub sign-in was cancelled.</p>`,
      expired: `<p class="yr-error" role="status">Your session expired. Connect GitHub again to pick up where you left off.</p>`,
    };
    const why = params.get("why");
    if (why) { params.delete("why"); history.replaceState(null, "", location.pathname + (params.size ? `?${params}` : "")); }
    const message = notices[authResult] ? notices[authResult].replace("</p>", `${why ? ` <span class="yr-error-code">(${safe(why)})</span>` : ""}</p>`) : undefined;
    if (!message) { entry.replaceChildren(); entry.hidden = true; return; }
    entry.hidden = false;
    entry.innerHTML = `<div class="yr-state">${message}</div>`;
  }
  function renderLoser() {
    entry.innerHTML = `<div class="yr-state"><span class="yr-state-icon" aria-hidden="true">!</span><div><h2>Booo! This GitHub account is not on the winners list.</h2><p>Make sure you connected the same GitHub account you used on the <a href="https://www.yukon.org/qsb">QSB leaderboard</a>.</p>${switchAccountButton("yr-switch-account")}</div></div>`;
    wireSwitchAccount("yr-switch-account");
  }
  function renderReceived() {
    const login = state?.user?.login;
    const who = login ? `<p class="yr-fineprint">Filed for @${safe(login)}.</p>` : "";
    const mark = state?.user?.id ? `<img class="yr-avatar" src="${avatar(state.user.id)}" alt="" width="68" height="68">` : `<span class="yr-state-icon" aria-hidden="true">✓</span>`;
    entry.innerHTML = `<div class="yr-state" role="status">${mark}<div><h2>Details received</h2><p>Your reward details are on file. The Yukon team will contact you using the email or Telegram address you submitted. Make sure you have a KoshMoney account before payout.</p>${who}</div></div>`;
  }
  function wireCardTilt() {
    const card = entry.querySelector("#yr-card");
    if (!card || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    card.classList.add("is-revealing");
    card.addEventListener("pointermove", (event) => {
      const box = card.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width - 0.5;
      const y = (event.clientY - box.top) / box.height - 0.5;
      card.style.setProperty("--tilt-x", `${(-y * 14).toFixed(2)}deg`);
      card.style.setProperty("--tilt-y", `${(x * 16).toFixed(2)}deg`);
      card.style.setProperty("--shine", `${((x + 0.5) * 100).toFixed(1)}%`);
    });
    card.addEventListener("pointerleave", () => {
      card.style.setProperty("--tilt-x", "0deg");
      card.style.setProperty("--tilt-y", "0deg");
      card.style.setProperty("--shine", "50%");
    });
  }
  // A verified winner arrives back from GitHub at the top of the page, so the
  // claim section is brought into view rather than left below the fold.
  function revealClaim() {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => entry.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" }));
  }
  function renderForm() {
    const amount = state.award ? `<p class="yr-winner-amount">${money(state.award.amount)}</p>` : "";
    entry.innerHTML = `<div class="yr-claim-grid">
      <div class="yr-claim-left">${winnerCard(state.user)}</div>
      <div class="yr-claim-right">
        <p class="yr-winner-kicker">You're on the winners list</p>
        ${amount}
        <form id="yr-form"><div class="yr-fields"><label class="full"><span class="yr-field-label">Kosh account email</span><input name="koshEmail" type="email" autocomplete="off" required maxlength="254" spellcheck="false" placeholder="you@example.com"><small>The email address your KoshMoney account uses, which is where the payout goes. <a href="https://koshmoney.com/" target="_blank" rel="noreferrer">Create a Kosh account</a> if you need one, then return here.</small></label><label><span class="yr-field-label">Email address</span><input name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com"></label><label><span class="yr-field-label">Telegram username</span><input name="telegram" type="text" autocomplete="off" required maxlength="33" placeholder="@username"></label></div><label class="yr-kosh"><input type="checkbox" name="detailsConfirmed" required><span>I have checked these details and confirm they are correct. I have a Kosh account on that email, or I will create one before payout.</span></label><p class="yr-error" id="yr-error" role="alert"></p><div class="yr-form-actions"><button class="yr-primary" type="submit">Submit reward details</button></div></form>
      </div>
    </div>`;
    wireCardTilt();
    const form = entry.querySelector("#yr-form");
    form.onsubmit = async (event) => {
      event.preventDefault(); if (saving) return;
      const fields = Object.fromEntries(new FormData(form)); fields.detailsConfirmed = fields.detailsConfirmed === "on";
      const button = form.querySelector('[type="submit"]'); saving = true; button.disabled = true; button.textContent = "Submitting...";
      form.setAttribute("aria-busy", "true"); entry.setAttribute("aria-busy", "true");
      try { await client.save(fields); state.claimed = true; renderReceived(); }
      catch (error) {
        if (error.expired) { state = { user: null, eligible: false, claimed: false }; history.replaceState(null, "", `${location.pathname}?auth=expired`); saving = false; return renderConnect(); }
        form.querySelector("#yr-error").textContent = error.message; button.disabled = false; button.textContent = "Submit reward details";
      }
      finally { saving = false; form.removeAttribute("aria-busy"); entry.setAttribute("aria-busy", "false"); }
    };
  }
  function renderState(celebrate = false) {
    entry.setAttribute("aria-busy", "false");
    renderHeader();
    entry.hidden = false;
    if (!state?.user) return renderConnect();
    if (!state.eligible) return renderLoser();
    if (state.claimed) return renderReceived();
    renderForm();
    if (celebrate) { confetti(); revealClaim(); }
  }
  try {
    state = await client.status();
    const justConnected = new URLSearchParams(location.search).get("github") === "connected";
    if (justConnected) history.replaceState(null, "", location.pathname);
    if (!disposed) renderState(justConnected);
  }
  catch { entry.textContent = "Reward status is unavailable. Please refresh to try again."; }
  return { destroy() { disposed = true; entry.replaceChildren(); headerSlot?.replaceChildren(); document.querySelectorAll(".yr-confetti").forEach((item) => item.remove()); } };
}
