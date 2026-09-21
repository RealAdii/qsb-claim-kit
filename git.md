# Yukon QSB reward claim: implementation and release steps

This guide is for an agent integrating the claim page into Yukon's repository. Work from the live application repo, inspect existing conventions, and keep the implementation aligned with the Yukon leaderboard. The standalone kit in this folder is an executable reference, not a connection to Yukon's production systems.

## Step 1: inspect the application before editing

Read the app's `AGENTS.md`, package scripts, route structure, GitHub auth implementation, database access layer, deployment config, and QSB page styles. Find the server-side source that records leaderboard identities. Confirm the immutable numeric GitHub account ID is used there. Identify who owns final award approval and which database contains the authoritative recipient list.

If the leaderboard team already has GitHub OAuth running, reuse its verified session. Do not ask the claimant to type a GitHub name. If it does not exist yet, the kit includes a complete OAuth app flow in `server/github-auth.mjs`, backed by an opaque server session. Agree on one auth path with the leaderboard team so the claim page checks the same GitHub identity as the leaderboard.

## Step 2: freeze the policy and recipient snapshot

The public landing page states only that Week 1 has $2,000 in rewards and Weeks 2 and 3 have $18,000 in rewards. Do not add individual amounts to the public page unless the reward owner changes that instruction.

The approved internal award structure is:

| Pool | Distribution | Qualification |
| --- | --- | --- |
| Week 1 | $1,000, $600, $400 | Separate Week 1 top three |
| Weeks 2 to 3 top solvers | $6,000, $3,600, $2,400 | Weeks 2 to 3 results only |
| Weeks 2 to 3 raffle | $6,000 total | Random draw among solvers with at least 3% improvement |

Week 1 improvement is excluded from the Weeks 2 to 3 ranking and raffle calculation. Before computing the final list, record the exact cutoff timestamps and timezone, improvement formula and baseline, raffle entry rules, whether top-three winners can enter the raffle, tie handling, and payout process. Save the rule version with the reviewed winner snapshot. Do not calculate eligibility in the browser.

Apply `server/schema.sql` to the Yukon PostgreSQL database. Keep recipient rows unfinalized while loading and reviewing them. Use the numeric GitHub ID from the verified leaderboard records:

```sql
INSERT INTO yukon_reward_awards
  (github_id, award_id, award_type, award_label, award_amount, finalized)
VALUES
  ('12345678', 'week1-first', 'week1', 'Week 1 winner', 1000, false),
  ('23456789', 'weeks23-raffle-a', 'weeks23-raffle', 'Weeks 2 to 3 raffle', 1000, false);
```

Or load the snapshot with `server/load-awards.mjs`, which validates the file, prints the per-award totals, inserts with `finalized=false`, and finalizes only on a second run after review. Replace the example IDs and labels with the approved data. Do not reuse award IDs. After a second person verifies every identity and amount against the approved snapshot, set only those approved rows to `finalized=true`. The displayed total does not reveal which award a claimant received.

## Step 3: configure and exercise GitHub authentication

For the standalone kit, create a GitHub OAuth App. Set the callback URL to the exact public origin plus `/auth/github/callback`. GitHub requires the configured callback to match the authorization request. The flow uses state and PKCE, exchanges the code only on the server, reads `/user` to get the stable numeric ID, and stores only a hash of the random app session token. See [GitHub's OAuth web flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).

Copy `.env.example` to `.env` and set:

- `AUTH_MODE=github`
- `APP_ORIGIN` and `GITHUB_CALLBACK_URL`, using the same origin and callback path
- `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`
- `DATABASE_URL`
- `CLAIM_ENCRYPTION_KEY`, generated with `openssl rand -hex 32`
- `PORT` if the host assigns a port

Run `npm install`, apply the schema with `psql "$DATABASE_URL" -f server/schema.sql`, load an approved test recipient, and run `npm start`. On a workstation without PostgreSQL, set `STORE=memory` and list the test recipients in `dev-awards.json`: the same OAuth code path runs against in-process storage, and the server refuses that setting on any non-localhost origin. First test with a nonwinner GitHub account. Then test with the account whose numeric ID is in the finalized test recipient row. Check that only the winner sees the form, refresh preserves the session, logout removes the session, and an invalid or expired OAuth session cannot submit. Use HTTPS for staging and production so the session cookie gets the `Secure` flag.

In Yukon's existing app, use its shared OAuth and cookie/session code instead of adding another provider app. Adapt `getSession` to return `{ githubId, login }` from the authenticated server session. It must reject unsigned client values. The claim handler rechecks the finalized award on every status request and every form submission.

## Step 4: connect the separate claim page

Mount the landing page at the route selected by the Yukon team, for example `/qsb/rewards`. Keep the page in the existing QSB shell and use its colors, type, buttons, spacing, and responsive breakpoints. The expected progression is:

1. Public totals and the Connect GitHub button.
2. After GitHub callback, confetti for a verified winner, then the claim form.
3. Booo state for an authenticated account not on the finalized list, with a link to the QSB leaderboard.
4. Confirmation after a saved claim.

The form requires a Kosh Starknet wallet address and Telegram username. Email is optional. Include a link to Kosh account onboarding beside the address field, and make clear the claimant returns here to enter their address. The claim page does not create a Kosh account or wallet itself. Confirm with Kosh that the recipient's wallet address and network are supported for the intended payout before opening claims.

The backend accepts only the server session identity and canonical award data. It ignores claimant-supplied GitHub IDs and prize details. It checks same-origin writes, validates and limits fields, encrypts personal details in PostgreSQL, and avoids returning submitted email or Telegram in the status response. Add rate limiting and operator audit logging using Yukon's production conventions.

## Step 5: set up private Google Sheets delivery

Create a new private Google Sheet with a `Reward claims` tab. Grant editor access only to the service account used by the worker and the rewards operators. Configure `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB`, and service account credentials on the worker only. Schedule `node --env-file=.env server/sync-sheets.mjs` once per minute and monitor retries. The worker decrypts claim data on the server and writes the Kosh Starknet wallet address, optional email, Telegram username, and award metadata into the private Sheet.

Test a valid claim, missing email, invalid address, nonwinner submission, duplicate save, database outage, Sheet outage, and successful retry in staging. Verify database data remains encrypted and access to the Sheet is limited. Never put credentials in the browser or commit them.

## Step 6: release with the leaderboard

Coordinate timing with the Yukon leaderboard GitHub login so both pages use the same account identity. Deploy the page, OAuth callback, status and submit endpoints, schema, and award snapshot together to staging. Test the full provider round trip with separate winner and nonwinner accounts. Confirm the public page shows only the two totals, and confirm recipient information is not exposed before auth.

Before production, remove test recipients and claims, configure production secrets, load and verify the approved finalized recipient snapshot, and confirm Sheet access. After deployment, check a real winner claim, a nonwinner rejection, private Sheet delivery, and worker health. Record who can change the recipient list and how changes are reviewed.
