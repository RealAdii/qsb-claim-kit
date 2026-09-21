# Validation

Checked on 2026-09-21.

- Node tests cover GitHub OAuth state and PKCE, callback code exchange, identity lookup, session issuance, logout origin checks, finalized award gating, forged values, claim origin checks, private status responses, Kosh Starknet wallet format, optional email, Telegram validation, Kosh account confirmation, size limits, encryption binding, and fail-closed errors.
- The local `AUTH_MODE=demo` preview is isolated from GitHub, PostgreSQL, and Google Sheets. It can be used to inspect the landing page, winner form, nonwinner state, and completed state.
- The `AUTH_MODE=github` server uses a real GitHub OAuth app and PostgreSQL backed sessions and claim storage when configured with `.env` secrets and an approved recipient row.

Not verified against live GitHub: this workspace does not contain the Yukon OAuth app credentials, production database, or finalized winner list. The actual provider round trip and a production claim must be verified in staging after Yukon supplies those values. Google Sheets delivery also requires the private Sheet ID and service account credentials.
