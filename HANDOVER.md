# Deploying the QSB reward claim page

The page lives at `quantum.starkware.co/claim`. It is a separate Vercel
deployment: the PQ hub only forwards the `/claim` prefix to it, so the hub owns
no claim code and the claim app owns no hub routes.

Everything the app serves sits under `/claim`, including its assets, its OAuth
endpoints and its APIs. Nothing is at the root, so the forward is two lines and
cannot collide with the hub's own routes.

## What is already done

- `SamrendraS/starknet-pq-migration-hub` PR #22 is merged into `main`. It adds
  the two rewrites in `next.config.ts` pointing at `https://qsb-rewards.vercel.app`.
- The claim app is deployed and healthy at `https://qsb-rewards.vercel.app/claim`.
- A GitHub App named **QSB rewards claim** is registered with two callback URLs,
  `https://quantum.starkware.co/claim/auth/github/callback` and the
  `qsb-rewards.vercel.app` equivalent, so either origin can sign people in.
- A Neon PostgreSQL database holds sessions, the award list and encrypted claims.
  The schema is applied and the Week 1 awards are loaded and finalized.

## What is blocked

The first production deploy of the hub after its move to the
`keep-starknet-strange` Vercel org failed. The same commit compiles cleanly in
the hub's own CI ("Compiled successfully"), and the previous production deploys,
all from before the move, succeeded. So the build is fine and the failure is in
the project's Vercel configuration, most likely an environment variable or
setting that did not come across with the move. Reading that build log needs
access to the `keep-starknet-strange` scope.

Once that deploy succeeds, `quantum.starkware.co/claim` works with no further
change. Nothing else is outstanding.

## Option A: keep the claim app where it is

Redeploy the hub. That is the whole task.

## Option B: move the claim app into your own Vercel project

1. Create a Vercel project from this repository. No framework preset, no build
   command: `public/` is served as static files and `api/index.mjs` is the only
   function. Node 22 or newer.
2. Set the environment variables listed below for Production.
3. Apply `server/schema.sql` to the database.
4. Load the approved winners with `server/load-awards.mjs`, which validates the
   file, resolves GitHub logins to immutable numeric ids, inserts everything
   unfinalized and only finalizes on a second run:

   ```bash
   node --env-file=.env server/load-awards.mjs awards-week1.json            # check
   node --env-file=.env server/load-awards.mjs awards-week1.json --apply    # insert
   node --env-file=.env server/load-awards.mjs awards-week1.json --finalize # open claims
   ```

5. Point `CLAIM_APP` in the hub's `next.config.ts` at the new deployment.
6. If the deployment answers on a different origin, register that origin's
   `/claim/auth/github/callback` on the GitHub App, or create a fresh app with
   `APP_NAME="..." CALLBACK_ORIGIN="https://your-origin" node server/setup-github-app.mjs`,
   which creates it from a manifest in one click and writes the credentials.

## Environment variables

| Name | What it is |
| --- | --- |
| `APP_ORIGIN` | `https://quantum.starkware.co`. Used for same-origin checks and every redirect. |
| `GITHUB_CALLBACK_URL` | `https://quantum.starkware.co/claim/auth/github/callback`. Must match a callback registered on the GitHub App. |
| `GITHUB_CLIENT_ID` | The GitHub App's client id. |
| `GITHUB_CLIENT_SECRET` | The GitHub App's client secret. Rotate it in the app settings if it is ever exposed. |
| `CLAIM_ENCRYPTION_KEY` | 32 bytes of hex, `openssl rand -hex 32`. Encrypts claim details at rest. **Changing it makes existing claims unreadable.** |
| `DATABASE_URL` | PostgreSQL connection string. Supplied automatically if you attach Neon through the Vercel integration. |
| `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB`, `GOOGLE_APPLICATION_CREDENTIALS` | Only for the Sheets delivery worker, `server/sync-sheets.mjs`. Not needed to run the page. |

Current values are not in this repository. They are in the deployment's
environment and can be read with `vercel env pull`.

## Checking a deployment

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<origin>/claim
curl -s -o /dev/null -w '%{http_code}\n' https://<origin>/claim/leaderboard
curl -s https://<origin>/claim/api/yukon/reward-claim   # {"user":null,...} when signed out
curl -sI -H 'Range: bytes=0-1' https://<origin>/claim/media/hero.mp4   # must be 206
```

The last one matters: Safari will not play the hero video from a server that
answers a range request with 200 and the whole file.

`npm test` covers the OAuth flow, the claim validation and storage, the award
loader, the leaderboard parser and that every asset each page references
resolves from every route the page is served at.
