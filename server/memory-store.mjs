// Development-only adapters. Everything lives in this process, so the real
// GitHub OAuth round trip can be exercised without PostgreSQL. Never select
// these in staging or production: restarting the server erases every session,
// award and claim.
import { seal, unseal } from "./crypto.mjs";

export function memoryAuthStore() {
  const sessions = new Map();
  return {
    async create(sessionHash, user, expiresAt) {
      sessions.set(sessionHash, { githubId: String(user.id), login: user.login, expiresAt: Date.parse(expiresAt) });
    },
    async get(sessionHash) {
      const row = sessions.get(sessionHash);
      if (!row) return null;
      if (!(row.expiresAt > Date.now())) { sessions.delete(sessionHash); return null; }
      return { githubId: row.githubId, login: row.login };
    },
    async delete(sessionHash) { sessions.delete(sessionHash); },
  };
}

export function memoryClaimStore() {
  const claims = new Map();
  const key = (githubId, awardId) => `${githubId}:${awardId}`;
  return {
    async exists(githubId, awardId) { return claims.has(key(githubId, awardId)); },
    async save(githubId, awardId, record) {
      const identity = key(githubId, awardId);
      const previous = claims.get(identity);
      claims.set(identity, {
        githubId, awardId,
        encrypted: seal(record, identity),
        revision: (previous?.revision || 0) + 1,
        createdAt: previous?.createdAt || new Date().toISOString(),
      });
    },
    // Dev inspection only. Returns what the Sheets worker would deliver.
    list() {
      return [...claims.values()].map((row) => ({
        ...unseal(row.encrypted, key(row.githubId, row.awardId)),
        revision: row.revision,
        createdAt: row.createdAt,
      }));
    },
  };
}

export function memoryAwardTable(rows = []) {
  const awards = rows.map(normalizeAward);
  return {
    async getAward(githubId) {
      return awards.find((award) => award.githubId === String(githubId) && award.finalized) || null;
    },
    all: () => awards.map((award) => ({ ...award })),
  };
}

export function normalizeAward(row, index = 0) {
  const where = `award ${index + 1}`;
  const githubId = String(row.githubId ?? row.github_id ?? "").trim();
  const login = String(row.login ?? row.githubLogin ?? row.github_login ?? "").trim();
  const awardId = String(row.awardId ?? row.award_id ?? "").trim();
  const type = String(row.awardType ?? row.award_type ?? row.type ?? "").trim();
  const label = String(row.awardLabel ?? row.award_label ?? row.label ?? "").trim();
  const amount = Number(row.awardAmount ?? row.award_amount ?? row.amount);
  const finalized = row.finalized === true || row.finalized === "true";
  if (githubId && !/^\d+$/.test(githubId)) throw new Error(`${where}: githubId must be the numeric GitHub account id.`);
  if (!githubId && !/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(login)) throw new Error(`${where}: give a githubId, or a login to resolve into one.`);
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(awardId)) throw new Error(`${where}: awardId must be 1 to 80 characters of letters, digits, hyphen or underscore.`);
  if (!type || !label) throw new Error(`${where}: awardType and awardLabel are required.`);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`${where}: awardAmount must be a positive number.`);
  return { githubId, login, awardId, type, label, amount, finalized };
}

// A login is a convenience for whoever writes the list. Eligibility is always
// checked against the immutable numeric id, because GitHub logins can be
// renamed and then claimed by somebody else.
export async function resolveLogins(awards, fetchImpl = fetch) {
  const resolved = new Map();
  const out = [];
  for (const award of awards) {
    if (award.githubId) { out.push(award); continue; }
    const key = award.login.toLowerCase();
    if (!resolved.has(key)) {
      const response = await fetchImpl(`https://api.github.com/users/${encodeURIComponent(award.login)}`, {
        headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Yukon-QSB-Rewards" },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`Could not resolve GitHub login "${award.login}": GitHub returned ${response.status}.`);
      const user = await response.json();
      if (!Number.isSafeInteger(user.id)) throw new Error(`GitHub returned no numeric id for "${award.login}".`);
      resolved.set(key, { id: String(user.id), login: user.login });
    }
    const match = resolved.get(key);
    out.push({ ...award, githubId: match.id, login: match.login });
  }
  return out;
}

export function readAwardSnapshot(text) {
  const parsed = JSON.parse(text);
  const rows = Array.isArray(parsed) ? parsed : parsed.awards;
  if (!Array.isArray(rows)) throw new Error("The award snapshot must be a JSON array, or an object with an awards array.");
  const awards = rows.map(normalizeAward);
  const seen = new Set();
  for (const award of awards) {
    const identity = `${award.githubId || award.login.toLowerCase()}:${award.awardId}`;
    if (seen.has(identity)) throw new Error(`Duplicate award ${identity} in the snapshot.`);
    seen.add(identity);
  }
  return awards;
}
