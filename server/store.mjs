import { seal } from "./crypto.mjs";
export function postgresStore(pool) {
  return {
    async exists(githubId, awardId) {
      const result = await pool.query("SELECT 1 FROM yukon_qsb_reward_claims WHERE github_id=$1 AND award_id=$2", [githubId, awardId]);
      return result.rowCount > 0;
    },
    async save(githubId, awardId, record) {
      await pool.query(`INSERT INTO yukon_qsb_reward_claims (github_id,award_id,encrypted_details) VALUES ($1,$2,$3)
        ON CONFLICT (github_id,award_id) DO UPDATE SET encrypted_details=EXCLUDED.encrypted_details,
        revision=yukon_qsb_reward_claims.revision+1,updated_at=now(),retry_after=now()`, [githubId, awardId, seal(record, `${githubId}:${awardId}`)]);
    },
  };
}
