import { mountClaim } from "./claim.js?v=2";

// Local-only GitHub and submission simulation. No form data is stored or sent.
const scenario = new URLSearchParams(location.search).get("state") || "winner";
let connected = ["claimed", "ineligible"].includes(scenario);
let claimed = scenario === "claimed";
const award = scenario === "ineligible" ? null : { awardId: "demo-week1-first", type: "week1", label: "Week 1 · 1st place", amount: 1000 };
function status() {
  return { user: connected ? { id: "demo-only", login: "sample-solver" } : null, eligible: connected && Boolean(award), claimed };
}
await mountClaim({
  entry: document.querySelector("#claim-entry"),
  client: {
    async status() { return status(); },
    async connect() { connected = true; return status(); },
    async signOut() { connected = false; claimed = false; return status(); },
    async save() { claimed = true; return { ok: true }; },
  },
});
