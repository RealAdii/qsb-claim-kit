-- Apply on the Yukon application database. Reserve row 1 of the private Sheet for headers.
CREATE SEQUENCE IF NOT EXISTS yukon_qsb_reward_claim_row START WITH 2;
CREATE TABLE IF NOT EXISTS yukon_qsb_reward_claims (
  github_id text NOT NULL,
  award_id text NOT NULL,
  sheet_row bigint NOT NULL UNIQUE DEFAULT nextval('yukon_qsb_reward_claim_row'),
  encrypted_details text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  synced_revision integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  retry_after timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (github_id, award_id)
);

-- Opaque, hashed GitHub login sessions. Access tokens from GitHub are not stored.
CREATE TABLE IF NOT EXISTS yukon_reward_sessions (
  session_hash text PRIMARY KEY,
  github_id text NOT NULL,
  github_login text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS yukon_reward_sessions_expiry_idx ON yukon_reward_sessions (expires_at);

-- Populate only from the owner-approved final winners list.
CREATE TABLE IF NOT EXISTS yukon_reward_awards (
  github_id text NOT NULL,
  award_id text NOT NULL,
  award_type text NOT NULL,
  award_label text NOT NULL,
  award_amount numeric(12,2) NOT NULL CHECK (award_amount > 0),
  finalized boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (github_id, award_id)
);
