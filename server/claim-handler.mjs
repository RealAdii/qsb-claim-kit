class ClientError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const limits = { email: 254, telegram: 64 };
const fieldNames = { email: "email address", telegram: "Telegram username" };
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function validate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ClientError(400, "Invalid form.");
  const fields = {};
  for (const [name, max] of Object.entries(limits)) {
    if (typeof body[name] !== "string") throw new ClientError(400, `Enter your ${fieldNames[name]}.`);
    fields[name] = body[name].trim();
    if (!fields[name] || fields[name].length > max) throw new ClientError(400, `Check your ${fieldNames[name]}.`);
  }
  if (!emailPattern.test(fields.email)) throw new ClientError(400, "Enter a valid email address.");
  fields.email = fields.email.toLowerCase();
  if (!/^@?[A-Za-z0-9_]{5,32}$/.test(fields.telegram)) throw new ClientError(400, "Enter a valid Telegram username.");
  fields.telegram = fields.telegram.startsWith("@") ? fields.telegram : `@${fields.telegram}`;
  if (body.detailsConfirmed !== true) throw new ClientError(400, "Confirm that your details are correct before submitting.");
  return { ...fields, detailsConfirmed: true, consentVersion: "yukon-qsb-reward-v1" };
}
async function readBody(request) {
  const reader = request.body?.getReader(); if (!reader) throw new ClientError(400, "Missing form.");
  let size = 0; const chunks = [];
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 8192) { await reader.cancel(); throw new ClientError(413, "Form is too large."); } chunks.push(value); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new ClientError(400, "Invalid JSON."); }
}
const json = (status, value) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" } });

// getAward must query the canonical Yukon award list by verified GitHub ID.
// Return { awardId, type, label, amount } only for a finalized winner.
export function createClaimHandler({ origin, getSession, getAward, store }) {
  if (!origin || !getSession || !getAward || !store) throw new Error("Production adapters are required.");
  const expectedOrigin = new URL(origin).origin;
  return async (request) => {
    try {
      if (!["GET", "POST"].includes(request.method)) return json(405, { error: "Method not allowed." });
      if (request.method === "POST") {
        if (request.headers.get("origin") !== expectedOrigin) return json(403, { error: "Invalid request origin." });
        if (!request.headers.get("content-type")?.startsWith("application/json")) return json(415, { error: "JSON is required." });
      }
      const session = await getSession(request);
      if (!session) return request.method === "GET" ? json(200, { user: null, eligible: false, claimed: false }) : json(401, { error: "Sign in with GitHub to claim." });
      if (!/^\d+$/.test(String(session.githubId)) || typeof session.login !== "string") throw new Error("Invalid session adapter result");
      const githubId = String(session.githubId);
      const award = await getAward(githubId);
      if (!award) return request.method === "GET" ? json(200, { user: { id: githubId, login: session.login }, eligible: false, claimed: false }) : json(403, { error: "This GitHub account does not have a Yukon QSB award to claim." });
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(String(award.awardId)) || typeof award.label !== "string" || !Number.isFinite(Number(award.amount)) || Number(award.amount) <= 0) throw new Error("Invalid award adapter result");
      if (request.method === "GET") return json(200, { user: { id: githubId, login: session.login }, eligible: true, claimed: await store.exists(githubId, award.awardId), award: { amount: Number(award.amount) } });
      const details = validate(await readBody(request));
      await store.save(githubId, award.awardId, { ...details, githubId, githubLogin: session.login, awardId: award.awardId, awardType: award.type, awardLabel: award.label, awardAmount: Number(award.amount), updatedAt: new Date().toISOString() });
      return json(200, { ok: true });
    } catch (error) {
      if (error instanceof ClientError) return json(error.status, { error: error.message });
      return json(503, { error: "We could not save or check your claim. Please try again." });
    }
  };
}
