import pg from "pg";
import { GoogleAuth } from "google-auth-library";
import { unseal } from "./crypto.mjs";
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
const spreadsheet = process.env.GOOGLE_SHEET_ID;
if (!spreadsheet) throw new Error("Set GOOGLE_SHEET_ID.");
const sheetName = process.env.GOOGLE_SHEET_TAB || "Reward claims";
const tab = "'" + sheetName.replaceAll("'", "''") + "'";
const headers = ["GitHub ID", "GitHub username", "Award ID", "Award category", "Award label", "Award amount USD", "Kosh account email", "Email", "Telegram", "Details confirmed by claimant", "Claimed at", "Updated at"];
async function write(range, values) {
  const client = await auth.getClient();
  await client.request({ url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheet)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, method: "PUT", data: { values }, timeout: 15000 });
}
try {
  await write(`${tab}!A1:L1`, [headers]);
  for (let i = 0; i < 100; i++) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("SELECT * FROM yukon_qsb_reward_claims WHERE revision>synced_revision AND retry_after<=now() ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1");
      const row = result.rows[0];
      if (!row) { await client.query("COMMIT"); break; }
      try {
        const r = unseal(row.encrypted_details, `${row.github_id}:${row.award_id}`);
        await write(`${tab}!A${row.sheet_row}:L${row.sheet_row}`, [[r.githubId, r.githubLogin, r.awardId, r.awardType, r.awardLabel, r.awardAmount, r.koshEmail, r.email, r.telegram, r.detailsConfirmed ? "Yes" : "No", new Date(row.created_at).toISOString(), r.updatedAt]]);
        await client.query("UPDATE yukon_qsb_reward_claims SET synced_revision=revision WHERE github_id=$1 AND award_id=$2", [row.github_id, row.award_id]);
      } catch {
        await client.query("UPDATE yukon_qsb_reward_claims SET retry_after=now()+interval '5 minutes' WHERE github_id=$1 AND award_id=$2", [row.github_id, row.award_id]);
        console.error("A reward claim sync failed; retry scheduled."); process.exitCode = 1;
      }
      await client.query("COMMIT");
    } catch { await client.query("ROLLBACK"); throw new Error("Reward claim sync transaction failed."); }
    finally { client.release(); }
  }
} finally { await pool.end(); }
