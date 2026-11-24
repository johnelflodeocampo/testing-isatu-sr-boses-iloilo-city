# Vercel deployment

ISAT U BOSES runs as one Express Vercel Function. Static files stay in `public/`; private pages and scripts are included in the function bundle and are served only through the existing server routes.

## 1. Prepare PostgreSQL

Use the PostgreSQL connection URI from Supabase **Dashboard → Connect**. The project URL and Supabase API keys are not database credentials.

- For a new database, apply `db/supabase_deploy.sql` as the database owner.
- For an existing BOSES database, apply `db/migrations/20261124_vercel_readiness.sql` as the database owner before deploying. It creates the durable privacy-notice and shared rate-limit tables.
- If the current privacy notice is in `notice/notice.txt`, run `npm run migrate:privacy-notice` locally after applying the migration and configuring `DATABASE_URL`. This copies it once; it does not overwrite an existing database notice.

For Vercel serverless functions, use the Supabase **Transaction Pooler** connection from Dashboard → Connect (port `6543`). Do not use the Session Pooler for Vercel: each warm function instance holds its own session, which can exhaust the shared pooler's small client limit as instances scale. Keep the Vercel function region near the Supabase database region where possible.

The database role `boses_app` is intentionally least-privileged and created as `NOLOGIN`. In Supabase SQL Editor, run `ALTER ROLE boses_app WITH LOGIN PASSWORD '<random-password>';`, replacing the placeholder with a newly generated password. Use the role password only in Vercel's `DATABASE_URL`; do not use the `postgres` superuser credentials for the app. Copy the Transaction Pooler URI and host from Dashboard → Connect, set its username to `boses_app.<project-ref>`, and retain port `6543`. Set `DB_TRANSACTION_POOLER=true` and `DB_POOL_MAX=1` for Vercel Production and Preview. Transaction mode does not preserve session-level settings, so this mode authenticates directly as the restricted `boses_app` role.

## 2. Configure Vercel environment variables

Add these in **Vercel Project → Settings → Environment Variables** for Production and Preview as appropriate:

| Variable | Required value |
| --- | --- |
| `DATABASE_URL` | PostgreSQL URI from Supabase Dashboard → Connect |
| `JWT_SECRET` | Unique random value with at least 32 characters |
| `HASH_PEPPER` | A different unique random value with at least 32 characters |
| `APP_URL` | Canonical HTTPS site URL, such as `https://boses.example.edu.ph` |
| `GAS_API_URL` | Deployed Apps Script web-app `/exec` URL |
| `GAS_API_SECRET` | Random shared secret of at least 32 characters; must match Apps Script Script Property `GAS_API_SECRET` |
| `DB_TRANSACTION_POOLER` | `true` when `DATABASE_URL` uses Supabase's shared Transaction Pooler |
| `DB_POOL_MAX` | `1` for each Vercel function instance |

Optional:

- `SUPABASE_DB_CA_CERT_CONTENT`: PEM text for the Supabase database CA certificate if the default TLS roots do not validate the connection. Do not set this to a local filesystem path. `SUPABASE_DB_CA_CERT` remains available for local development paths.

The project-root `prod-ca-2021.crt` is embedded as a server-side trust anchor when Vercel's `SUPABASE_DB_CA_CERT` points to that file, so serverless file tracing cannot omit it. For a different certificate, use `SUPABASE_DB_CA_CERT_CONTENT`.

Never commit `.env` or paste secret values into source files. Rotate any credentials that have been shared outside the Vercel environment.

Vercel supplies deployment hostnames for Preview and Production. The app uses HTTPS cookies and permits same-origin browser requests for the configured URL and the current Vercel deployment hostname.
In production mode, startup validates the GAS URL and shared secret without sending an email, and fails fast if either is missing or invalid.

## 3. Deploy

Connect this repository to Vercel with the repository root as the project root. `vercel.json` explicitly selects the Express framework so application routes such as `/privacy` and `/login` reach the exported app in `app.js`. No frontend build command is required; static assets under `public/assets/` are served directly at their existing `/assets/...` URLs and use a 10-minute Vercel edge cache. `.vercelignore` leaves local setup scripts, tests, docs, Python tooling, the separately deployed Apps Script source, and local environment files out of deployment uploads while keeping them in the repository. Authenticated API responses and private pages remain uncached; browser-side notification refreshes are throttled, the admin notifications page reuses its initial response for the notification menu, and overlapping dashboard refresh requests are suppressed.

The app uses PostgreSQL-backed rate limiting so OTP and API limits are shared across serverless instances. The rate-limit table stores HMACs of client keys rather than raw IP addresses. Privacy-notice edits are persisted in PostgreSQL; Vercel's temporary filesystem is not used for writes.

After deployment:

1. Open `/` and confirm styles, scripts, and logos load.
2. Open `/login` and `/admin/login`; request a code only for an authorized test mailbox.
3. Use `node scripts/testGasEmail.js --check` to verify the shared secret without sending email. If the deployed script exposes MailApp readiness, the check also validates its quota. When deploying the repository's `gas_api.gs`, run `authorizeEmailService()` once and approve the MailApp permission first. An actual test email requires explicit `--send`.
4. Sign in as a superadmin and verify the privacy notice and officer directory.

## Local checks

```powershell
npm test
npm start
```

`npm start` is for a persistent local server. On Vercel, `app.js` exports the Express app and does not start a listener or perform a startup database probe.

## Test email API

The root `app.py` script uses `GAS_API_URL` and `GAS_API_SECRET` from the process environment or project `.env`. Run `python app.py --check` to verify the shared secret without sending email; it also checks quota if the API reports it. A recipient-only command is a dry run; send a real test email only with `python app.py --to <isatu-email> --send`. Recipients are restricted to ISAT U email domains.
