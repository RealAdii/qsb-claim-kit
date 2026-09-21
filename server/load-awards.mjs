// Load an approved winner snapshot into yukon_reward_awards.
//
//   node --env-file=.env server/load-awards.mjs awards.json          check only
//   node --env-file=.env server/load-awards.mjs awards.json --apply  insert unfinalized
//   node --env-file=.env server/load-awards.mjs awards.json --finalize
//
// Rows land with finalized=false. A second person reviews every identity and
// amount against the approved snapshot before --finalize flips them on.
import { readFile } from "node:fs/promises";
import { readAwardSnapshot, resolveLogins } from "./memory-store.mjs";

const [file, ...flags] = process.argv.slice(2);
if (!file) { console.error("Usage: node server/load-awards.mjs <snapshot.json> [--apply|--finalize]"); process.exit(2); }
const apply = flags.includes("--apply");
const finalize = flags.includes("--finalize");

const awards = await resolveLogins(readAwardSnapshot(await readFile(file, "utf8")));
const total = awards.reduce((sum, award) => sum + award.amount, 0);
console.log(`${awards.length} awards, $${total.toLocaleString("en-US")} total:`);
for (const award of awards) console.log(`  ${award.githubId.padEnd(12)} ${(award.login ? "@" + award.login : "").padEnd(20)} ${award.awardId.padEnd(24)} $${award.amount}`);

if (!apply && !finalize) { console.log("\nCheck only. Re-run with --apply to insert, then --finalize after review."); process.exit(0); }
if (!process.env.DATABASE_URL) { console.error("Set DATABASE_URL to apply the snapshot."); process.exit(2); }

const { default: pg } = await import("pg");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (apply) {
      for (const award of awards) {
        await client.query(
          `INSERT INTO yukon_reward_awards (github_id,award_id,award_type,award_label,award_amount,finalized)
           VALUES ($1,$2,$3,$4,$5,false)
           ON CONFLICT (github_id,award_id) DO UPDATE SET award_type=EXCLUDED.award_type,
             award_label=EXCLUDED.award_label, award_amount=EXCLUDED.award_amount
           WHERE yukon_reward_awards.finalized=false`,
          [award.githubId, award.awardId, award.type, award.label, award.amount],
        );
      }
      console.log(`\nInserted or refreshed ${awards.length} unfinalized awards. Review them, then re-run with --finalize.`);
    }
    if (finalize) {
      let finalized = 0;
      for (const award of awards) {
        const result = await client.query(
          "UPDATE yukon_reward_awards SET finalized=true WHERE github_id=$1 AND award_id=$2 AND award_amount=$3",
          [award.githubId, award.awardId, award.amount],
        );
        finalized += result.rowCount;
      }
      if (finalized !== awards.length) throw new Error(`Only ${finalized} of ${awards.length} awards matched the loaded rows. Nothing was finalized.`);
      console.log(`\nFinalized ${finalized} awards. Claims are now open for these accounts.`);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
} finally { await pool.end(); }
