# Vercel deployment

ISAT U BOSES runs as one Express Vercel Function. Static files stay in `public/`; private pages and scripts are included in the function bundle and are served only through the existing server routes.

## 1. Prepare PostgreSQL

Use the PostgreSQL connection URI from Supabase **Dashboard → Connect**. The project URL and Supabase API keys are not database credentials.

- For a new database, apply `db/supabase_deploy.sql` as the database owner.
- For an existing BOSES database, apply `db/migrations/20261124_vercel_readiness.sql` as the database owner before deploying. It creates the durable privacy-notice and shared rate-limit tables.
- If the current privacy notice is in `notice/notice.txt`, run `npm run migrate:privacy-notice` locally after applying the migration and configuring `DATABASE_URL`. This copies it once; it does not overwrite an existing database notice.

Use a Supabase session pooler connection if the database is not reachable over IPv4. Keep the Vercel function region near the Supabase database region where possible.

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

Optional:

- `DB_POOL_MAX`: database connections per function instance; defaults to `3` on Vercel.
- `SUPABASE_DB_CA_CERT_CONTENT`: PEM text for the Supabase database CA certificate if the default TLS roots do not validate the connection. Do not set this to a local filesystem path. `SUPABASE_DB_CA_CERT` remains available for local development paths.

Never commit `.env` or paste secret values into source files. Rotate any credentials that have been shared outside the Vercel environment.

Vercel supplies deployment hostnames for Preview and Production. The app uses HTTPS cookies and permits same-origin browser requests for the configured URL and the current Vercel deployment hostname.
In production mode, startup validates the GAS URL and shared secret without sending an email, and fails fast if either is missing or invalid.

## 3. Deploy

Connect this repository to Vercel with the repository root as the project root. `vercel.json` explicitly selects the Express framework so application routes such as `/privacy` and `/login` reach the exported app in `app.js`. No frontend build command is required; the asset rewrite maps legacy `/assets/...` URLs to files under `public/`.

The app uses PostgreSQL-backed rate limiting so OTP and API limits are shared across serverless instances. The rate-limit table stores HMACs of client keys rather than raw IP addresses. Privacy-notice edits are persisted in PostgreSQL; Vercel's temporary filesystem is not used for writes.

After deployment:

1. Open `/` and confirm styles, scripts, and logos load.
2. Open `/login` and `/admin/login`; request a code only for an authorized test mailbox.
3. Use `node scripts/testGasEmail.js --check` from a configured local copy to verify the GAS secret without sending email. An actual test email requires explicit `--send`.
4. Sign in as a superadmin and verify the privacy notice and officer directory.

## Local checks

```powershell
npm test
npm start
```

`npm start` is for a persistent local server. On Vercel, `app.js` exports the Express app and does not start a listener or perform a startup database probe.
