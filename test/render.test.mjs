// Smoke test for the browser module. It renders every state against a tiny DOM
// stub, which catches the class of bug a syntax check cannot: a render path
// calling a helper that no longer exists.
import test from "node:test";
import assert from "node:assert/strict";

function element() {
  const node = {
    html: "", hidden: false, attributes: {}, classList: { add() {}, remove() {} }, style: { setProperty() {} },
    set innerHTML(value) { this.html = value; }, get innerHTML() { return this.html; },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    getAttribute(name) { return this.attributes[name]; },
    querySelector() { return element(); }, querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {}, append() {}, remove() {}, replaceChildren() { this.html = ""; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 100, height: 100 }; },
    focus() {},
  };
  return node;
}

function installDom() {
  const entry = element();
  globalThis.document = { querySelector: () => element(), createElement: () => element(), querySelectorAll: () => [], addEventListener() {}, body: element() };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.history = { replaceState() {} };
  globalThis.location = { search: "", pathname: "/qsb/rewards" };
  globalThis.requestAnimationFrame = () => {};
  return entry;
}

const { mountClaim } = await import("../public/claim.js");
const user = { id: "153971735", login: "RealAdii" };
const client = (status) => ({ status: async () => status, save: async () => ({ ok: true }), connect: async () => status, signOut: async () => ({ user: null, eligible: false, claimed: false }) });

test("a winner sees the card, the amount and the form", async () => {
  const entry = installDom();
  await mountClaim({ entry, headerSlot: element(), client: client({ user, eligible: true, claimed: false, award: { amount: 2500 } }) });
  for (const fragment of ["yr-card", "@RealAdii", "WINNER", "$2,500", 'name="koshEmail"', 'name="email"', 'name="telegram"', 'name="detailsConfirmed"']) {
    assert.ok(entry.html.includes(fragment), `winner view is missing ${fragment}`);
  }
  assert.equal(entry.html.includes("Reward status is unavailable"), false);
});

test("the other states render without throwing", async () => {
  for (const [name, status] of [
    ["signed out", { user: null, eligible: false, claimed: false }],
    ["not a winner", { user, eligible: false, claimed: false }],
    ["already claimed", { user, eligible: true, claimed: true, award: { amount: 2500 } }],
  ]) {
    const entry = installDom();
    await mountClaim({ entry, headerSlot: element(), client: client(status) });
    assert.equal(entry.html.includes("Reward status is unavailable"), false, `${name} view failed to render`);
  }
});
