# Yukon QSB reward claim

A separate Yukon QSB rewards page and claim flow. The public page shows only the period totals: Week 1 has $2,000 in rewards, and Weeks 2 and 3 have $18,000 in rewards. Visitors connect GitHub first. The server checks the authenticated numeric GitHub account ID against the finalized award list. Winners see a short confetti state, then submit a Kosh Starknet wallet address and Telegram username. Email is optional. Nonwinners see the Booo message and cannot submit a claim.

## Hero and theme

The hero is a full-bleed looping video (`public/media/hero.mp4`, 1280 by 720, 8 seconds, no audio, 546 KB) over a left-weighted scrim, with `public/media/hero-poster.jpg` as the poster and as the still background under `prefers-reduced-motion: reduce`. The palette is lifted from the `.challenge-qsb` theme on the challenge page: `#b3651f` accent, `#8a4a15` accent strong, `#f7ece1` accent soft, `#262d36` hero, `#d78b46` record gold, `#0d131c` ink. The font stack starts with `repro`, so the page picks up Yukon's own face when it runs inside the app and falls back to the system sans locally.

The preview server serves the video with byte ranges (`Accept-Ranges`, 206 with `Content-Range`). Safari requests `bytes=0-1` first and will not play a video from a server that answers 200 with the whole file, so whatever host serves these assets in production must support ranges too.

`react/QsbHero.jsx` is the same hero as a component, with a `mediaBase` prop for the app's static asset path. `react/QsbClaim.jsx` remains the claim card only.

## Local visual prototype

Requires Node 22 or newer.

```sh
npm install
npm start
```

Open http://localhost:4318. The default `AUTH_MODE=demo` starts a local-only interaction mock. It does not contact GitHub, a database, or a Google Sheet, and submitted values are not stored. Use `?state=ineligible` or `?state=claimed` to preview those states.

```sh
npm test
```

## Run the real GitHub OAuth flow locally

The full authorization-code flow is implemented in `server/github-auth.mjs`. It creates cryptographically random state and PKCE values, exchanges the one-use code on the server, verifies the identity through GitHub's `/user` endpoint, and issues a seven-day HttpOnly session cookie. The GitHub access token is not retained. OAuth sessions and claim records are stored in PostgreSQL. The database award table controls eligibility.

1. Create a GitHub OAuth App in GitHub Developer Settings. Set its authorization callback URL to `http://127.0.0.1:4318/auth/github/callback`. GitHub's web flow requires the callback URL to match the app configuration. See [GitHub's OAuth web flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).
2. Copy `.env.example` to `.env`. Set `AUTH_MODE=github`, the OAuth app client ID and secret, `APP_ORIGIN`, and the exact matching callback URL. Keep `.env` private and out of version control.
3. Set `DATABASE_URL` to a PostgreSQL database and generate a fresh 32-byte encryption key as 64 hexadecimal characters. For example, run `openssl rand -hex 32` and put its output in `CLAIM_ENCRYPTION_KEY`.
4. Apply the database schema: `psql "$DATABASE_URL" -f server/schema.sql`.
5. Add only the owner-approved final recipients to `yukon_reward_awards`, keyed by the numeric GitHub account ID, not the login name. Keep `finalized=false` while reviewing, then set it to true only when the recipient snapshot is approved. An example insert is in `git.md`.
6. Start with `npm start`, open http://127.0.0.1:4318, and connect GitHub. Use a test OAuth account and a test recipient row first. Remove test rows and claims before opening the page.

Without the GitHub OAuth app credentials the live path correctly fails closed. The standalone kit cannot infer or import the winners from a different Yukon service.

### Without PostgreSQL: STORE=memory

To exercise the real GitHub round trip on a machine with no database, set `STORE=memory` in `.env` and leave `DATABASE_URL` unset. Sessions, awards and claims then live in the server process only, and every restart clears them. The server refuses `STORE=memory` on any origin other than localhost.

The award list comes from `DEV_AWARDS_FILE` (default `dev-awards.json`, copied from `dev-awards.example.json`). Put your own numeric GitHub account ID in it, which `gh api user --jq .id` prints, and set `finalized: true` for the row you want to claim. Add a second row with `finalized: false`, or sign in with an account that is not listed, to see the Booo state.

```sh
STORE=memory npm start
curl http://127.0.0.1:4318/dev/claims   # what the Sheets worker would deliver
```

`/dev/claims` exists only under `STORE=memory`. It decrypts and prints the submitted payout details so the collection path can be checked without Google Sheets.

### Loading the winner snapshot

`server/load-awards.mjs` validates an approved snapshot and applies it to PostgreSQL in two steps, so no award becomes claimable before a second person reviews it.

```sh
node server/load-awards.mjs awards.json                            # validate and print the totals
node --env-file=.env server/load-awards.mjs awards.json --apply    # insert with finalized=false
node --env-file=.env server/load-awards.mjs awards.json --finalize # after review
```

The snapshot is a JSON array of `{githubId, awardId, awardType, awardLabel, awardAmount}`. The loader rejects non-numeric GitHub IDs, non-positive amounts and duplicate awards, `--apply` never overwrites a row that is already finalized, and `--finalize` refuses the whole batch unless every row matches the loaded amount.

## Deploy into Yukon's app

The current standalone server can run end to end when configured. For production, host it behind HTTPS, set `APP_ORIGIN` to the public claim page origin, register that exact origin's `/auth/github/callback` URL in GitHub, and provide secrets through the host's secret manager. Apply `server/schema.sql` to the production PostgreSQL database and load the approved winner list before launch.

If Yukon already has a shared GitHub OAuth system, use its verified server session in `server/claim-handler.mjs` instead of deploying a second OAuth app. The session must provide the immutable numeric GitHub account ID and login. The UI must never determine eligibility. The handler checks the award list on page load and again on submission. See [git.md](git.md) for the integration and release sequence.

## Claim fields and Kosh account setup

The form requires the Kosh Starknet wallet address, Telegram username, and confirmation that the recipient has or will create a Kosh account before payout. Email is optional. “Create a Kosh account” links to the Kosh site so a recipient can complete Kosh's account setup, then return to enter their wallet address. This page does not create a Kosh account or wallet inside the claim flow. Confirm with Kosh that the recipient's address is a Starknet address supported for the planned payout before collecting production claims.

## Private Google Sheets delivery

The app first writes encrypted claim details to PostgreSQL. The separate worker `server/sync-sheets.mjs` decrypts pending rows server-side and copies them to a private Google Sheet. The Sheet receives readable wallet addresses, optional email, and Telegram details, so restrict access to the Yukon rewards operators.

1. Create a private Sheet with a `Reward claims` tab and share it with the service account as an editor.
2. Set `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB`, and `GOOGLE_APPLICATION_CREDENTIALS` in the worker environment.
3. Schedule `node --env-file=.env server/sync-sheets.mjs` once per minute. Review failed and pending rows.
4. Test a winner claim, a nonwinner rejection, Sheet downtime and retry, and a replacement submission in staging.

Never put the service account file or OAuth client secret in the browser. Do not use a public demo spreadsheet for real claimant data.
