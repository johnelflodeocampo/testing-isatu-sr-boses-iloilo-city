ISAT U BOSES — Complete System Blueprint (ASCII Edition)

+------------------------------------------------------------------------------+
|                  ISAT U BOSES - SYSTEM ARCHITECTURE BLUEPRINT                |
|    Student/Faculty/Staff Concern Portal with In-App Report Updates           |
+------------------------------------------------------------------------------+
| Runtime  : Node.js (>=22) + Express 5.3  | Auth    : GAS-delivered email OTP   |
| Database : Supabase PostgreSQL (DATABASE_URL) | Hosting : Localhost -> Vercel |
| Frontend : Zero-Build HTML/CSS/Vanilla JS| Email   : Login OTP + optional officer notices via GAS |
+------------------------------------------------------------------------------+


1. End-to-End System Architecture

+------------------------------------------------------------------------------+
| [1] PUBLIC STATIC ENTRY (public/) - Zero Sensitive Views or Logic Exposed    |
+------------------------------------------------------------------------------+
| * index.html  : Public Landing Page (Overview + CTAs to /login & /tracker)   |
| * landing.js  : Checks /api/me -> upgrades CTA to /dashboard if signed in    |
| * guard.js    : Mobile-safe desktop DevTools blocker (bypasses iOS/Android)  |
| * style.css   : Responsive institutional dark UI & edit modal styles         |
+--------------------------------------+---------------------------------------+
                                       |
                                       v  HTTPS / HTTP Requests

+------------------------------------------------------------------------------+
| [2] SERVER-GATED PRIVATE VIEWS (private/) - Served Only by Express (no-store)|
+--------------------------------------+---------------------------------------+
| MEMBER PORTAL ROUTES                 | OFFICER & PUBLIC LOOKUP ROUTES        |
| * /login     -> login.html           | * /tracker -> tracker.html            |
|   (Email OTP Gate -> Cookie)         |   (Honeypot + BOSES-ID Status Lookup) |
| * /dashboard -> dashboard.html       | * /admin   -> admin-login.html (Gate) |
|   (HttpOnly Cookie Required)         |            -> admin.html (Whitelisted)|
|   - CREATE: Submit Report + Toggle   |   - Views ONLY Non-Identifiable Hash  |
|   - READ  : My Submitted History     |     (12hex...4hex@domain) & BOSES-ID |
|   - UPDATE: Edit Pending Reports     |   - Triages Status -> Triggers Email  |
|   - DELETE: Withdraw Own Reports     |   - Zero Access to Submitter Email    |
+------------------+-------------------+-------------------+-------------------+
                   |                                       |
                   +-------------------+-------------------+
                                       |
                                       v  Signed HttpOnly JWT Cookies + Headers

+------------------------------------------------------------------------------+
| [3] NODE.JS / EXPRESS 5 API (server.js)                                      |
+------------------------------------------------------------------------------+
| Security, Email OTP & Anti-Abuse Layer                                       |
| * Helmet Strict CSP (script-src 'self') + 16KB JSON Payload Limit            |
| * Sliding-Window IP Rate Limiters (Pages, Submissions, & ID Tracking)        |
| * App-generated login OTP via shared-secret GAS API                         |
|   - Students may use @students.isatu.edu.ph or @isatu.edu.ph;                |
|     officer addresses from either domain must be allowlisted before sign-in   |
| * requireBrowserHeader : Enforces X-Requested-With: BOSES-Client signature   |
| * requireMemberSession : Verifies boses_user_session HttpOnly JWT cookie     |
| * requireAdminSession  : Verifies boses_admin_session + public.admins table  |
+------------------------------------------------------------------------------+
| Identity & in-app report updates; optional minimal officer email notices    |
| * Mints Tracking ID (BOSES-XXXXXXXX) & salted SHA-256 identity tag           |
| * Anonymous reports stay labeled with the identity hash in the officer UI   |
+----------------------------------------------+------------------------------+
                   | Least-Privilege Role (boses_app)
                   v

+----------------------------------------------+   +---------------------------+
| [4] POSTGRESQL DATABASE (Local / Supabase)   |
+----------------------------------------------+
| PUBLIC SCHEMA (boses_app Access)             |
| * public.insights                            |
|   - Stores tracking_id, identity_hash,       |
|     content, priority, anonymity, status     |
| * public.admins (Officer email whitelist)    |
+-----------------------+----------------------+
                        | Linked via insight_id (ON DELETE CASCADE)
                        v
+----------------------------------------------+
| SYSTEM-ONLY VAULT SCHEMA (Admin-Blocked)     |
| * private_vault.notify_emails                |
|   - ALL privileges REVOKED from PUBLIC and   |
|     boses_app (Officers cannot query it)     |
|   - Accessed ONLY inside SECURITY DEFINER    |
|     PostgreSQL functions                     |
+----------------------------------------------+


2. Report Submission, In-App Updates, and Officer Email Notices

  [1] MEMBER SIGNS IN VIA A GAS-DELIVERED EMAIL OTP
       |
       +---> Express creates a six-digit code and stores only its keyed hash
       +---> An authenticated GAS API request sends the code to the entered address
       +---> Express verifies the expiring, one-time code and checks the
       |     student email domain, member ban, or officer allowlist
       +---> Express computes deterministic tag:
       |       SHA-256(lowercase_email + ":" + HASH_PEPPER)
       |       Format: 8f4e2b9a41c0...c1d2@students.isatu.edu.ph
       +---> Issues HttpOnly Cookie (boses_user_session) -> Redirects /dashboard

  [2] MEMBER SUBMITS REPORT (POST /api/insights)
       |
       +---> Express mints Tracking ID (e.g., BOSES-9A4F21C8)
       +---> Calls SECURITY DEFINER Function: public.create_insight_with_vault()
       |      |
       |      |--+--> Inserts into public.insights (Officer-Viewable):
       |      |       { tracking_id  : "BOSES-9A4F21C8",
       |      |         identity_hash: "8f4e2b9a41c0...c1d2@students.isatu.edu.ph",
       |      |         content      : "...",
       |      |         priority     : "high",
       |      |         status       : "pending" }
       |      |
       |      +-----> Inserts into private_vault.notify_emails (System-Only):
       |              { insight_id     : <uuid>,
       |                recipient_email: "juan.delacruz@students.isatu.edu.ph" }
       |
       +---> Displays the tracking ID in the member's report history
       +---> Sends no email to the submitter or officers

  [3] OFFICER TRIAGES STATUS IN /admin (PATCH /api/admin/insights/:id)
       |
       +---> Officer views ONLY:
       |       Tracking ID : BOSES-9A4F21C8
       |       Sender Tag  : 8f4e2b9a41c0...c1d2@students.isatu.edu.ph
       |       (Zero database or API permission to view recipient_email)
       |
       +---> Officer updates status through the concern or feedback workflow
              |
              v
       +---> Status appears in signed-in report history and the public tracker;
             optional outcome comments stay in signed-in member/officer views
       +---> Status changes do not send email. Optional GAS email notices cover
             new concerns/feedback, assignments, and new report messages only


3. Report Lifecycle & Member History CRUD State Machine

                        +-----------------------+
                        |  MEMBER SUBMITS FORM  |
                        |   (POST /api/insights)|
                        +-----------+-----------+
                                    |
                                    v
                        +-----------------------+
          +------------>|       PENDING         |<------------+
          |             | (Editable & Deletable |             |
          |             |   by Owner in /dash)  |             |
          |             +---+---------------+---+             |
          |                 |               |                 |
   [Member PATCH]    [Member DELETE] [Officer PATCH]   [Member View]
   Edit content,     Withdraw report  Status updated   GET /api/my/insights
   priority, or      (CASCADE purges  to REVIEWING     matches JWT-derived
   anonymity toggle   vault email)                     identity_hash
                            |               |
                            v               v
                     +------------+  +----------------------+
                     |  DELETED   |  |  REVIEWING /         | (Concern)
                     |  (Purged)  |  |  UNDER REVIEW        | (Feedback)
                     +------------+  +----------+-----------+
                                                |
                                                v
                                     +----------------------+
                                     |    IN PROGRESS       |
                                     +----------+-----------+
                                                |
                              +-----------------+-----------------+
                              v                                   v
                    +---------------------+             +--------------------+
                    | RESOLVED /          |             | IMPLEMENTED /      |
                    | DISMISSED (Concern)  |             | NOT IMPLEMENTED   |
                    +----------+----------+             | (Feedback)         |
                               |                        +---------+----------+
                               +------------+---------------------+
                                            v
                                     +--------------+
                                     |   ARCHIVED   | (Superadmin)
                                     +--------------+


4. Database Schema & System-Only Vault Isolation

+-----------------------------------+       +----------------------------------+
| public.admins                     |       | public.insights                  |
| (SELECT granted to boses_app)     |       | (SELECT/UPD/DEL to boses_app)    |
+-----------------------------------+       +----------------------------------+
| PK email TEXT (ISAT U regex)      |       | PK id UUID (gen_random_uuid())   |
|    role TEXT ('officer', etc.)    |       | UQ tracking_id TEXT (BOSES-XXXX) |
|    added_at TIMESTAMPTZ           |       | IX identity_hash TEXT (SHA-256)  |
+-----------------------------------+       |    content TEXT (10..10000 chars)|
                                            |    priority TEXT (low..urgent)   |
                                            |    is_anonymous BOOLEAN          |
                                            |    status TEXT (pending..archiv) |
                                            |    created_at TIMESTAMPTZ        |
                                            |    updated_at TIMESTAMPTZ        |
                                            +----------------+-----------------+
                                                             |
                                                             | FK insight_id
                                                             | ON DELETE CASCADE
                                                             v
                                            +----------------------------------+
                                            | private_vault.notify_emails      |
                                            | (ALL ACCESS REVOKED: boses_app)  |
                                            +----------------------------------+
                                            | PK FK insight_id UUID            |
                                            |       recipient_email TEXT       |
                                            |       created_at TIMESTAMPTZ     |
                                            +----------------------------------+
                                            * Readable/Writable ONLY via:
                                              - create_insight_with_vault()
                                              - admin_update_insight_status()


5. Role-Based & System-Level Access Control Matrix

+-----------------------------------+--------+----------+---------+------------+
| Resource / Capability             | Public | Student/ | Officer | System DB  |
|                                   | (Anon) | Fac/Staff| Admin   | Function   |
+-----------------------------------+--------+----------+---------+------------+
| Landing Page (public/index.html)  | Allow  |  Allow   |  Allow  |     -      |
| Email OTP Sign-In (/login)        | Allow  |  Allow   |  Allow  |     -      |
| Submit Report (CREATE)            |  Deny  |  Allow   |  Allow  |     -      |
| Own History CRUD (/dashboard)     |  Deny  |Allow(Hash|Allow(Hash|    -      |
| Edit Report While PENDING         |  Deny  |  Allow   |  Allow  |     -      |
| Edit Report Once REVIEWING+       |  Deny  |   Deny   |  Deny   |     -      |
| Withdraw/Delete Own Report        |  Deny  |  Allow   |  Allow  |  Cascade   |
| Track BOSES-ID (/tracker)         |AllowRPC| AllowRPC | AllowRPC|     -      |
| View All Reports (/admin)         |  Deny  |   Deny   |  Allow  |     -      |
| View Non-Identifiable Hash Tag    |  Deny  | Own Only |  Allow  |   Allow    |
| View Raw Submitter Email          |  Deny  |   Deny   |  DENY   |ALLOW (Only)|
| Update Report Status              |  Deny  |   Deny   |  Allow  |     -      |
| Send Officer Email Notification    |  Deny  |   Deny   |  Deny  | Signed GAS |
| Direct Static Access to private/  |  DENY  |   DENY   |  DENY   |     -      |
| Google Drive / External Storage   |Disabled| Disabled | Disabled|  Disabled  |
+-----------------------------------+--------+----------+---------+------------+


6. Repository Directory Blueprint

isatu-boses/
|-- .env.example               # Local & Cloud environment configuration template
|-- package.json               # Express 5, pg, jsonwebtoken, helmet
|-- vercel.json                # Production Vercel routing (bundles private/**)
|-- app.js                     # Express API and GAS-delivered login OTP
|-- db/
|   `-- schema.sql             # PostgreSQL tables, boses_app role, & vault RPCs
|-- private/                   # Server-gated views & scripts (never in public/)
|   |-- tracker.html           # Dedicated BOSES-ID lookup view (/tracker)
|   |-- tracker.js             # Anti-bot honeypot & lookup script (/tracker/app.js)
|   |-- login.html             # Student email OTP gate (/login)
|   |-- email-otp.js           # Student and officer email OTP flow
|   |-- dashboard.html         # Protected Member CRUD workspace (/dashboard)
|   |-- dashboard.js           # History CRUD & status monitor (/dashboard/app.js)
|   |-- admin-login.html       # Officer email OTP gate (/admin)
|   |-- admin.html             # Protected officer triage console (/admin)
|   `-- admin.js               # Officer stats, search, & triage (/admin/app.js)
`-- public/                    # Public static assets ONLY
    |-- index.html             # Informational landing page (/)
    |-- css/
    |   `-- style.css          # Responsive institutional dark UI & modal styles
    `-- js/
        |-- guard.js           # Mobile-safe desktop DevTools blocker
        `-- landing.js         # Session-aware landing page CTA updater


7. Local Testing & Cloud Migration Checklist

+------------------------------------------------------------------------------+
| PHASE 1: LOCAL APP TESTING (Node.js + Supabase PostgreSQL)                   |
+------------------------------------------------------------------------------+
| 1. Apply db/supabase_deploy.sql to a fresh Supabase project.                 |
| 2. Deploy gas_api.gs and configure its URL and shared secret.               |
| 3. Set Supabase DATABASE_URL, APP_URL, JWT_SECRET, HASH_PEPPER,              |
|    GAS_API_URL, and GAS_API_SECRET in .env, then run npm run dev.            |
+------------------------------------------------------------------------------+

+------------------------------------------------------------------------------+
| PHASE 2: SUPABASE DEPLOYMENT                                                 |
+------------------------------------------------------------------------------+
| 1. Run db/supabase_deploy.sql only against a fresh Supabase project.          |
| 2. For an existing database, apply the reviewed migration in Supabase SQL    |
|    Editor. The OTP challenge table is private and stores keyed code hashes. |
| 3. Set DATABASE_URL from Dashboard > Connect; API keys are not DB passwords.|
|    Keep all connection strings and GAS secrets out of browser code/source.  |
+------------------------------------------------------------------------------+
