# ISAT U BOSES — Local Development Blueprint

> Local-development companion to [isatu_boses.md](./isatu_boses.md). This version keeps the same BOSES reporting, privacy, officer-triage, and database context and uses an app-generated email OTP delivered through Google Apps Script.

| Component | Local development |
|---|---|
| Runtime | Node.js (>=22) + Express 5.3 |
| Authentication | App-generated email OTP via shared-secret GAS API; both roles accept `@students.isatu.edu.ph` or `@isatu.edu.ph`, while officers require the database allowlist |
| Database | Supabase PostgreSQL via `DATABASE_URL` |
| Hosting | Localhost |
| Frontend | Zero-build HTML/CSS/Vanilla JS |
| Email | Google Apps Script sends login codes and optional officer notices |

## 1. End-to-End Local Architecture

```text
PUBLIC STATIC ENTRY (public/)
  index.html       Public landing page; links to /login and /tracker
  landing.js       Checks /api/me and updates the signed-in CTA
  guard.js         Existing mobile-safe client-side guard
  style.css        Responsive institutional UI with subtle crossfade and scale transitions
  transitions.js   Internal page transitions and accessible reveal animations
                 |
                 v HTTP requests to local Express server

SERVER-GATED PRIVATE VIEWS (private/)
  /login           Email-entry page; accepts ISAT U addresses only
  /dashboard      Student private space with report and submission choices (requires member session)
  /dashboard/share  Report submission and saved drafts (requires member session)
  /dashboard/reports Report history, editing, and withdrawal (requires member session)
  /inbox          Dedicated private report conversations (requires member or officer session)
  /tracker        Public BOSES-ID status lookup
  /admin          Officer login and triage console (requires officer access)
                 |
                 v Signed HttpOnly session cookies

NODE.JS / EXPRESS (app.js)
  * app.js is the webapp process entry point and configures Express and middleware
  * routes/index.js mounts page, report, and admin controllers
  * controllers/pageController.js handles page delivery and authentication
  * controllers/reportController.js handles member reports and public tracking
  * controllers/adminController.js handles officer reports, messages, and access
  * models/database.js owns the PostgreSQL connection pool
  * models/reportModel.js encapsulates report-list and tracker queries
  * Validates email format and the allowed ISAT U domain suffixes
  * Generates email-bound codes and sends them through the shared-secret GAS API
  * Stores only keyed OTP hashes in `private_vault.login_otp_challenges`
  * Creates BOSES member sessions only after successful code verification
  * Requires officer emails to be present in public.admins
  * Applies the same browser-header checks and rate limits
  * Hashes identities and keeps raw account emails in the restricted database vault
  * Lets superadmins ban or unban member access by protected identity tag, including for anonymous reports
  * Provides a private, per-report conversation between its submitter and allowlisted officers
  * Routes new concerns through a persistent assignment queue; only superadmins see unassigned concerns, and assigned concerns are limited to that admin and superadmins
  * Publishes a searchable FAQ managed by admins and superadmins
  * Publishes a privacy and confidentiality notice managed only by superadmins
                 |
                 v

SUPABASE POSTGRESQL
  public.insights                 Tracking ID, identity hash, report content,
                                  report type (concern or feedback),
                                  officer-assigned priority, anonymity, status, timestamps
  public.admins                   Officer email allowlist and role
  public.concern_assignments      Persistent concern-to-admin assignment and queue
  public.insight_messages         Per-report messages and officer sender email
  public.knowledge_base_entries   Public FAQ questions and answers
  public.site_privacy_notice      Durable public privacy notice; only superadmins can manage it
  public.api_rate_limits          Shared, HMAC-keyed rate-limit windows
  private_vault.notify_emails     Signed-in account email in a restricted
                                  private vault; never sent by email
```

The browser UI remains zero-build HTML/CSS/Vanilla JS in `public/` and `private/`. Public assets stay organized under `public/assets/css/`, `public/assets/js/`, and `public/assets/assests/`; private pages and scripts are grouped under `private/pages/` and `private/scripts/` by audience and feature. Existing page and API URLs are preserved while HTTP handling, route mounting, and data access are separated into `controllers/`, `routes/`, and `models/`.

### Local pages and access

- `public/index.html` is the public landing page.
- `private/pages/auth/login.html` starts the GAS-delivered student email OTP flow.
- `private/pages/student/dashboard.html` is the student private-space chooser.
- `private/pages/student/dashboard-share.html` supports submitting reports and managing the signed-in member's drafts.
- `private/pages/student/dashboard-reports.html` supports searching and filtering reports by concern/feedback type and status, scrolling through report lists over four cards, paging through six reports at a time, and opening full report details; pending reports can be edited or withdrawn.
- `private/pages/shared/inbox.html` provides a dedicated conversation list and message thread for signed-in members and officers; its client script is `private/scripts/shared/messages.js`.
- `private/pages/public/tracker.html` looks up a report by BOSES tracking ID without exposing submitter identity.
- `/resources` shows searchable FAQs; `/admin/resources` provides FAQ and category management for admins and superadmins. The FAQ table scrolls vertically beyond four visible rows and paginates after eight matching entries. Deleting a category moves its answers to the protected `General` category.
- `/privacy` displays the Privacy & Confidentiality Notice; `/admin/privacy` provides superadmin-only CRUD.
- `private/pages/auth/admin-login.html` starts the allowlisted officer email OTP flow, and `private/pages/admin/admin.html` provides the protected triage console.
- `private/scripts/shared/privacy-sanitizer.js` is used by the admin notice editor; the public privacy page renders the sanitized notice server-side. `private/scripts/admin/report-pdf.js` is served only to signed-in officers.
- Never serve files from `private/` directly as static assets. Express must gate their routes and send no-store headers.

## 2. GAS-Delivered Email OTP

1. `/login` and `/admin/login` collect an email address. `/api/auth/otp/request` creates a random six-digit code and sends it to the entered address through the shared-secret GAS API.
2. The server stores only a keyed hash in `private_vault.login_otp_challenges`. Codes expire after 10 minutes, can be used once, and allow at most five verification attempts. A new request replaces the previous code after a 60-second per-email cooldown.
3. Student sign-in accepts `@students.isatu.edu.ph` and `@isatu.edu.ph` addresses and rejects identities with a member ban.
4. Officer sign-in accepts either ISAT U email domain, but the address must be listed in `public.admins`. The allowlist is checked before sending and again before issuing a session.
5. `/api/auth/otp/verify` consumes the matching email-bound code before BOSES issues a signed HttpOnly session.
6. IP-level limits apply to both request and verification endpoints. The GAS endpoint accepts timestamped requests authenticated with the shared secret, rejects replayed requests, and sends only to ISAT U email addresses.

Deploy `gas_api.gs` as a Google Apps Script web app, set Script Property `GAS_API_SECRET`, and set `GAS_API_URL` plus the same random `GAS_API_SECRET` in the Node server `.env`. Supabase API keys are not used for login or PostgreSQL connections; the app requires `DATABASE_URL` from Supabase Dashboard > Connect.

Officer bans apply to the verified email's identity tag. GAS email delivery and the BOSES data connection are separate.
The member dashboard's signed-in label shows the member's login email. Anonymous reports display the full 64-character SHA-256 identity hash; identified reports display the login email.
Members can save drafts in `public.member_drafts`, continue editing, delete, or submit them later. Drafts are scoped to the signed-in identity and are not reports; submitting a draft creates the report and removes the draft in one database transaction.
Submitted reports must contain at least 10 and no more than 10,000 characters. The interface also shows a live word count. Drafts use the same 10,000-character maximum and can be shorter than the submission minimum. The JSON request body limit is 64 KB.

## 3. Application Roles and Officer Access

- The application has three session roles: `user`, `admin`, and `superadmin`.
- The local member sign-in issues the `user` role. Officer sign-in looks up the email in `public.admins` and issues its stored `admin` or `superadmin` role.
- `admin` and `superadmin` accounts can review reports and use the officer console. Only `superadmin` can access the archive and sender-tag directory, archive or restore reports, ban/unban members, or manage officer-access email addresses.
- Feedback remains available to all officers. New concerns enter `public.concern_assignments` unassigned; only superadmins can see and assign them. Once assigned, only the assigned admin and superadmins can access the concern, change its status, or read and send its messages. Assignments are retained in PostgreSQL and removed automatically if a concern is changed to feedback.
- Only superadmins can set priority for concerns. Feedback does not use priority. Admins can update the status of concerns assigned to them.
- The initial superadmin is `officer@isatu.edu.ph`. `srofficer@isatu.edu.ph` is seeded as an `admin`.
- Superadmins can create, list, update email/role, and remove admin access. The database prevents demoting or deleting the last superadmin, with table locking to serialize concurrent changes.
- Admin role assignments are checked against the database on protected requests. Removing or changing an account's role invalidates its old session.
- API requests require a valid signed-in session by default. Only read-only FAQ and status-only tracker lookups plus the rate-limited `/api/auth/otp/request` and `/api/auth/otp/verify` endpoints are available without one. Login challenge hashes remain in the private vault and are not exposed through Supabase's public API schema. The public privacy page is rendered server-side; its notice API requires a session. Sign-out and session details also require an active session.
- Public tracker lookups are rate-limited to 30 requests per client IP per 15 minutes. Mutating API requests continue to require the same-origin browser-request header and endpoint-specific member/officer role checks.
- Admins and superadmins can create, edit, and delete public FAQ entries.
- Only superadmins can create, edit, or delete the public privacy notice. A local-development notice must be reviewed and replaced with institution-approved wording before shared or production use.

## 3. Report Submission, Privacy, and Notifications

### Member submits a report (`POST /api/insights`)

1. Express derives the normalized member email from the signed session.
2. The member selects a report type (`concern` or `feedback`); the value is stored separately from the report content in `public.insights.report_type`. Members do not assign priority; officers set it in the officer console.
   Members may save incomplete work to `public.member_drafts`. Drafts do not get a tracking ID, enter the officer queue, or trigger emails. Submitting a saved draft atomically creates the report and deletes that draft.
3. Express computes a deterministic identity hash:

   ```text
   SHA-256(lowercase_email + ":" + HASH_PEPPER)
   ```

   Store the full 64-character lowercase hash and display it for anonymous reports. Never display the raw email for anonymous reports.
4. Express mints a tracking ID such as `BOSES-9A4F21C8`.
5. The database function `public.create_insight_with_vault()` inserts the report into `public.insights` and keeps the signed-in account email in the restricted `private_vault.notify_emails` table for account and sender identity handling. Anonymous reports never display this address to officers or other members.
6. A new concern or feedback submission creates an in-app officer notification and can send a minimal email notice to current admins and superadmins through `gas_api.gs`. Assignment changes and new member messages can also send officer email notices. Emails contain only the event type and tracking ID; report text, message text, and student email are never included. Portal Insights, drafts, and status changes do not trigger email. Delivery remains disabled until the Apps Script endpoint and shared secret are configured.

### Officer triages a report (`PATCH /api/admin/insights/:id`)

- Officers see the tracking ID, report details, status, and sender label. Anonymous reports are labeled `Anonymous` in the officer console and in conversations; identified reports show the submitter email. The email is retrieved only through an officer-authorized database function; application-role access to the private email vault remains revoked.
- Concern status moves from `pending` to `reviewing`, then to `in_progress`, and finally to `resolved` or `dismissed`; an officer may also resolve a pending concern directly.
- Feedback has a separate lifecycle: `pending` → `under_review` → `in_progress` → `implemented` or `not_implemented`. The officer console has distinct concern and feedback status filters. On Admin Reports, superadmins can also filter archived reports; dashboard recent reports remain active-only.
- An officer may add an optional outcome comment when resolving or dismissing a concern, or marking feedback implemented or not implemented. The submitter and officers can see the comment in signed-in report details and conversations; public tracking remains status-only.
- Marking a report Reviewing, Under Review, In Progress, Resolved, Dismissed, Implemented, or Not Implemented asks the officer to confirm first.
- Superadmins may archive final outcomes. `archived` reports are removed from active submissions and shown in `/admin/archive`; superadmins can restore concerns to Pending, Reviewing, In Progress, Resolved, or Dismissed, and feedback to Pending, Under Review, In Progress, Implemented, Not Implemented, or the legacy Resolved status. Outcome comments can be added when restoring to a final outcome. Archived reports can be downloaded as PDFs or permanently deleted; deleting a report also deletes its messages and private account-email record.
- Superadmins can download each archived report and its messages as an individual JSON file from the archive list. The archive's Term-End Rollover uses one confirmation dialog and requires typing `DELETE ALL ARCHIVED REPORTS`. It downloads a JSON backup first, then deletes only if the archived data still matches that backup; archived reports and their messages are deleted in a transaction.
- The officer dashboard's active, pending, concern Reviewing, feedback Under Review, In Progress, completed/decided, and archived counters are global totals, not limited to reports visible to the signed-in officer.
- The officer console has dedicated `/admin/archive`, `/admin/officers`, and `/admin/senders` pages. The archive and sender directory are superadmin-only, including their APIs.
- All signed-in officer pages use consistent role-aware navigation. Admin sessions are redirected from the public home, Privacy, and FAQ viewer pages into the officer console; the public viewer pages remain available to other users.
- Sender IDs are grouped by protected identity and anonymity in the sender directory. Anonymous and identified reports appear in separate rows; only the identified row shows the submitter email. Both rows share the sender's messaging restriction and member access controls. Superadmins can restrict or restore messaging and can ban or unban member access.
- The sender directory includes concerns, feedback, and Portal Insights, but lists an identity only while it has a Pending submission in either table. When its last Pending submission is moved to another status or deleted, archived submissions for that identity and their dependent records are permanently deleted. Other non-archived submissions and sender bans/message restrictions are retained.
- When the database is upgraded, `create_db.js` uses the existing private account-email vault and the configured `HASH_PEPPER` to migrate legacy masked sender tags to full SHA-256 hashes. Bans without a remaining report retain their legacy key so the ban remains effective.
- Member report history, conversations, and public tracking display Archived status directly; officers manage archived reports in the separate archive section.
- In the member's own report list, anonymous submissions display the full 64-character identity hash; identified submissions display the submitter email. This sender label is scoped to the signed-in member's own reports.
- The All submissions list keeps concerns and feedback together in the same `public.insights` table, with a separate status filter for each report type. Status transitions still apply independently to the selected report; search and type-specific filters apply only to active reports.
- Resolved concerns have an officer-only per-report chat toggle. Disabled chats remain readable, but neither members nor officers can send messages until an officer enables chat again. The server checks this setting when accepting messages.
- Officer message names use the local part of the officer email (for example, `johnelflo.deocampo`); the full officer email is not included in conversation responses.
- A sender-wide message restriction blocks member-originated messages on all of that sender's reports; officers can still reply where the report's per-report chat is enabled. Archived reports cannot be used to send messages, regardless of report chat setting.
- `public.admin_update_insight_status()` updates report status. Status updates do not trigger outbound email.
- Officers must never receive permission to query `private_vault.notify_emails` directly.

## 4. Report Lifecycle and Member History

```text
MEMBER SUBMITS
      |
      v
   PENDING  <--- editable/deletable by owner
      | \
      |  \ owner withdraws -> DELETED (vault email cascades)
      |
      +--- concern ---> REVIEWING ---> IN PROGRESS ---> RESOLVED / DISMISSED
      |
      +--- feedback -> UNDER REVIEW -> IN PROGRESS ---> IMPLEMENTED / NOT IMPLEMENTED
                                                           |
                                                           +---> ARCHIVED (superadmin)
```

- Member history (`GET /api/my/insights`) matches the identity hash derived from the signed-in session.
- Every report has a conversation thread, linked from its dashboard card and available at `/inbox?report=<report-id>`. Only its submitter and allowlisted officers can read or send messages; messages show role labels and never expose sender email addresses. The legacy `/messages` path redirects to `/inbox`, preserving the selected report.
- Messages are limited to 2,000 characters and refresh automatically while a conversation is open.
- Owners can update report content, type, or anonymity only while the report is `pending`. Priority is set and updated by officers only.
- Owners can withdraw their own pending report. Deleting it also removes the associated vault email through `ON DELETE CASCADE`.
- Officers control status transitions. Once a report is under review, the member cannot edit it.
- Officers can ban or unban a submitter's member access from any of their reports. The protected identity tag links anonymous and identified reports without exposing the email; a ban blocks member sign-in and invalidates access on the next protected request.
- The public tracker returns only status and tracking information; it must not reveal the submitter's email, identity hash, or outcome comments.

## 5. Database Schema and Access Boundaries

| Table | Contents | Application access |
|---|---|---|
| `public.admins` | Officer email, role, and added timestamp | Read to authorize officer sessions; maintain through trusted setup/admin process |
| `public.insights` | UUID, unique BOSES tracking ID, identity hash, report type (`concern` or `feedback`), report content, officer-assigned priority, anonymity, status, timestamps | Members read/update report content, type, and anonymity; officers manage priority and status |
| `public.member_drafts` | Draft ID, member identity hash, report type, report text, anonymity, timestamps | Members create, read, update, and delete only their own drafts |
| `public.banned_identities` | Protected identity tag and officer/timestamp for account bans | Read, insert, and delete through officer-authorized application routes |
| `public.restricted_message_identities` | Protected identity tag and officer/timestamp for sender-wide message restrictions | Read, insert, and delete through officer-authorized application routes |
| `public.insight_messages` | Report ID, sender role, message body, timestamp | Read and insert through report-owner or allowlisted-officer API routes |
| `public.knowledge_base_entries` | FAQ category, question, answer, and editor timestamps | Public read; create, update, and delete by admins and superadmins |
| `public.site_privacy_notice` | Published privacy notice and update timestamp | Publicly rendered on `/privacy`; notice API reads require a session; write and delete by superadmins only |
| `public.api_rate_limits` | HMAC-keyed request counters and expiry timestamps | Accessed by the server's shared rate-limit store; raw client IPs are not stored |
| `private_vault.notify_emails` | Insight ID, submitter email, creation timestamp | No direct application-role access; database functions only |

Use the existing schema's constraints and least-privilege role model. The vault is readable/writable only through:

- `public.create_insight_with_vault()`
- `public.admin_update_insight_status()`

Both functions must enforce the expected operation and return no more sensitive data than the server needs. Use parameterized queries, validate all request bodies, and keep database credentials, `JWT_SECRET`, and `HASH_PEPPER` in local environment variables rather than source control.

## 6. Roles and Capabilities

| Capability | Public visitor | ISAT U email session | Whitelisted officer | Database function |
|---|---:|---:|---:|---:|
| View landing page | Allow | Allow | Allow | — |
| Request a GAS-delivered email OTP | Allow | Allow | Allow | — |
| Submit a report | Deny | Allow | Allow | — |
| View own history | Deny | Allow | Allow, own identity only | — |
| Edit a pending own report | Deny | Allow | Allow, own identity only | — |
| Edit a report once reviewing | Deny | Deny | Deny | — |
| Withdraw a pending own report | Deny | Allow | Allow, own identity only | Cascade |
| Track a BOSES ID | Allow | Allow | Allow | — |
| View FAQs and privacy notice | Allow | Allow | Allow | — |
| View all reports / triage | Deny | Deny | Allow | — |
| Manage FAQs | Deny | Deny | Allow | — |
| Manage privacy notice | Deny | Deny | Superadmin only | — |
| View raw submitter email | Deny | Deny | Deny | Restricted notification operation only |
| Send officer email notification | Deny | Deny | Deny | Server-side only, shared-secret request to the GAS endpoint |
| Directly access `private/` files | Deny | Deny | Deny | — |

Email OTPs are generated and verified by the BOSES server and delivered by the shared-secret GAS API. Student email-domain checks, member bans, and officer allowlisting are enforced before issuing a BOSES session.

## 7. Local Repository Layout

```text
isatu-boses/
|-- .env.example
|-- package.json
|-- app.js                    # Webapp entry point, Express setup, middleware, and startup
|-- controllers/
|   |-- pageController.js
|   |-- reportController.js
|   |-- adminController.js
|   `-- contentController.js     # Public resources plus role-gated CRUD APIs
|-- routes/
|   `-- index.js               # Mounts feature controllers
|-- models/
|   |-- database.js            # PostgreSQL connection pool
|   `-- reportModel.js         # Report list and tracker queries
|-- db/
|   `-- schema.sql
|-- private/
|   |-- pages/
|   |   |-- admin/           # Officer console, archive, resources, privacy, and access pages
|   |   |-- auth/            # Student and officer sign-in pages
|   |   |-- public/          # Public privacy, resources, and report-tracker pages
|   |   |-- shared/          # Inbox used by signed-in members and officers
|   |   `-- student/         # Student dashboard and report pages
|   `-- scripts/
|       |-- admin/           # Officer console and admin feature scripts
|       |-- auth/            # Sign-in scripts
|       |-- public/          # Public page scripts
|       |-- shared/          # Shared privacy-notice sanitizer
|       |-- shared/          # Shared inbox and privacy-sanitizer scripts
|       `-- student/         # Student dashboard scripts
`-- public/
    |-- index.html
    |-- css/
    |   `-- style.css
    `-- js/
        |-- guard.js
        |-- transitions.js
        `-- landing.js
```

## 8. Local Testing and GAS Email OTP Setup

### Phase 1 — Local app with Supabase PostgreSQL

1. Copy `.env.example` to `.env` and set `DATABASE_URL` to the PostgreSQL connection URI from Supabase Dashboard > Connect. Use the database password and SSL connection details; Supabase API keys are not database credentials.
2. For a fresh Supabase project, run `db/supabase_deploy.sql` in the Supabase SQL Editor. For an existing project, apply the reviewed schema migration there instead.
3. The schema seeds `officer@isatu.edu.ph` into `public.admins` as an officer. Add or remove allowlisted addresses using a trusted database-owner connection:

   ```sql
   INSERT INTO public.admins (email, role)
   VALUES ('another.officer@isatu.edu.ph', 'officer')
   ON CONFLICT (email) DO NOTHING;
   ```

4. Configure `APP_URL`, `JWT_SECRET`, and `HASH_PEPPER` in `.env`. `create_db.js` is for a separate local PostgreSQL database and is not used by the app's Supabase connection.
5. Deploy `gas_api.gs` as a Google Apps Script web app that executes as the deploying account. Set its Script Property `GAS_API_SECRET` to a random secret of at least 32 characters; set the same value and the deployed `/exec` URL as `GAS_API_SECRET` and `GAS_API_URL` in the Node `.env`. Authorize `MailApp`; the endpoint validates HMAC signatures, timestamps, and replay nonces before sending login codes or officer notices. Keep the secret out of source control.
6. Start the server with `npm start` and verify the full flow:
   - An address outside the two ISAT U suffixes is rejected.
   - An allowed member address can open the member dashboard and submit a report.
   - A non-whitelisted address cannot access officer pages or APIs.
   - A whitelisted officer can triage, but cannot see a submitter's raw email.
   - Report history, editing restrictions, deletion, and tracker lookup behave as described.
7. Apply `db/migrations/20261124_create_login_otp_challenges.sql` to an existing database before restarting the app. Keep the app bound to localhost during testing and use test data while validating login email delivery.

### Historical local database migrations

The following legacy commands target a separate local database and are not used by the Supabase-backed app. Apply required migrations to Supabase through the SQL Editor. The OTP challenge migration is `db/migrations/20261124_create_login_otp_challenges.sql`.

```powershell
npm run create_db
```

This applies `db/schema.sql`, including the sender-list function and cleanup triggers. Applying the schema also purges existing archived submissions for identities without any Pending submission in either table. Restart the web service after the database update; restarting alone does not apply schema changes.

Officer names and the updated timestamp require the officer-name migration on existing databases:

```sh
psql -v ON_ERROR_STOP=1 -U postgres -d isatu_sr_boses_iloilocity_db \
  -f db/migrations/20261120_officer_names.sql
```

Existing officers receive a blank name until a superadmin updates their profile. Newly added officers must have a name.

Message sender display names use an officer's configured name or the submitter's email prefix, except for anonymous reports. Apply this migration to populate prefixes for existing non-anonymous conversations; it does not copy full submitter email addresses into message rows:

```sh
psql -v ON_ERROR_STOP=1 -U postgres -d isatu_sr_boses_iloilocity_db \
  -f db/migrations/20261120_message_sender_names.sql
```

Message owners can edit or unsend their own messages. Unsent messages are replaced with a “This message was unsent” marker. Add the message state and app-role update permission on existing databases:

```sh
psql -v ON_ERROR_STOP=1 -U postgres -d isatu_sr_boses_iloilocity_db \
  -f db/migrations/20261120_message_unsend.sql
```

To let superadmins restore archived concerns and feedback to a selected workflow status, apply:

```sh
psql -v ON_ERROR_STOP=1 -U postgres -d isatu_sr_boses_iloilocity_db \
  -f db/migrations/20261120_restore_archived_report_status.sql
```

The older restore migration supports an earlier set of statuses. Apply the current status migration below afterward to enable the complete workflows and comment support.

For the current status workflows and optional private outcome comments, apply the status migration after earlier archive migrations:

```sh
psql -v ON_ERROR_STOP=1 -U postgres -d isatu_sr_boses_iloilocity_db \
  -f db/migrations/20261122_report_status_outcomes.sql
```

Restart the web service after applying it. Outcome comments appear only in signed-in member and officer views; the public tracker remains status-only.

Portal Insights are stored separately from concerns and other feedback. For existing databases, apply the schema migration below as a database owner. It moves every legacy `report_type = 'feedback'` submission into `public.portal_insights`, preserving tracking IDs, submitter emails, messages, and linked notifications:

```sh
psql -v ON_ERROR_STOP=1 -U postgres -d isatu_sr_boses_iloilocity_db \
  -f db/migrations/20261123_separate_portal_insights.sql
```

For a separate local database only, `npm run create_db` applies the current schema after migrating legacy sender identity hashes. The running app always uses the Supabase `DATABASE_URL`.

The student Portal Insights form uses `/api/portal-insights` and stores submissions in `public.portal_insights`. Regular concerns and feedback remain in `public.insights`; Portal Insights are excluded from the student's Reports list and from all Inbox conversation lists and message routes. Legacy `portal_insight_messages` rows are preserved but cannot be read or changed through Inbox APIs. They are excluded from individual archive exports; the term-end rollover backup retains these legacy rows before permanent cleanup.

Existing databases must apply the FAQ migration. It removes the former emergency-resource records, categories, and table, and ensures FAQ categories exist. The deletion is permanent:

```sh
psql -v ON_ERROR_STOP=1 -U postgres -d isatu_sr_boses_iloilocity_db \
  -f db/migrations/20261121_remove_emergency_resources.sql
```

Restart the web service after applying the migration. Earlier resource-category and emergency contact-channel migrations are historical and must not be used to restore the removed feature.

Officer removal automatically unassigns their concerns. Permanently deleting an archived report also deletes its related messages. Existing databases can ensure these foreign-key behaviors with:

```sh
psql -v ON_ERROR_STOP=1 -U postgres -d isatu_sr_boses_iloilocity_db \
  -f db/migrations/20261120_officer_removal_archive_cleanup.sql
```

The privacy notice is stored in PostgreSQL for durable deployment. Existing installations should apply `db/migrations/20261124_vercel_readiness.sql` and copy their legacy notice file:

```powershell
npm run migrate:privacy-notice
```

The legacy file remains a read-only fallback for deployments that have not yet copied it. Notice titles remain editable and support up to 40 characters, including “Privacy & Confidentiality Notice.”

### Phase 2 — Configure GAS Email Delivery

1. Deploy `gas_api.gs` as a Google Apps Script web app, execute as the account that sends email, and authorize `MailApp`.
2. Add a random `GAS_API_SECRET` Script Property and set the same value in the server `.env`; configure `GAS_API_URL` with the deployed `/exec` URL.
3. Apply `db/supabase_deploy.sql` on a fresh Supabase database or run the OTP migration on an existing database. The app requires `DATABASE_URL` from Supabase Dashboard > Connect.
4. Test student-domain validation, officer allowlisting, cooldowns, expiry, attempt limits, one-time code consumption, member bans, logout, and session expiry. Never place the GAS secret in browser code or source control.
