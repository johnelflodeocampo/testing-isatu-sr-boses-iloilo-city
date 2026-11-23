-- ISAT U BOSES schema-only deployment for a fresh Supabase PostgreSQL project.
-- No local student submissions or secrets are included. Bootstrap admin emails
-- and default resource categories from the canonical schema are included.
-- Run as the project database owner. The guard below rejects existing BOSES tables.
-- Login OTP delivery is handled by the signed Google Apps Script API, not Supabase Auth.
-- This schema includes private_vault.login_otp_challenges for hashed, expiring codes.

BEGIN;

DO $$
DECLARE
    v_table TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'admins',
        'insights',
        'portal_insights',
        'insight_tracking_ids',
        'member_drafts',
        'knowledge_base_entries',
        'resource_categories',
        'banned_identities',
        'restricted_message_identities',
        'insight_messages',
        'portal_insight_messages',
        'concern_assignments',
        'notifications',
        'schema_migrations'
    ]
    LOOP
        IF pg_catalog.to_regclass(pg_catalog.format('public.%I', v_table)) IS NOT NULL THEN
            RAISE EXCEPTION 'BOSES table public.% already exists; use a reviewed upgrade migration instead.',
                v_table;
        END IF;
    END LOOP;

    IF pg_catalog.to_regclass('private_vault.notify_emails') IS NOT NULL
       OR pg_catalog.to_regclass('private_vault.login_otp_challenges') IS NOT NULL
       OR pg_catalog.to_regclass('private_vault.portal_insight_notify_emails') IS NOT NULL THEN
        RAISE EXCEPTION 'BOSES private-vault tables already exist; use a reviewed upgrade migration instead.';
    END IF;
END
$$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS private_vault;

DO $$
BEGIN
    CREATE ROLE boses_app NOLOGIN;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.admins (
    email TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'admin',
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT admins_email_isatu CHECK (
        email = lower(btrim(email))
        AND email ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@(students\.)?isatu\.edu\.ph$'
    ),
    CONSTRAINT admins_name_format CHECK (
        name = btrim(name)
        AND char_length(name) <= 120
    ),
    CONSTRAINT admins_role_value CHECK (role IN ('admin', 'superadmin'))
);

ALTER TABLE public.admins
    ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.admins'::pg_catalog.regclass
          AND conname = 'admins_name_format'
    ) THEN
        ALTER TABLE public.admins
            ADD CONSTRAINT admins_name_format CHECK (
                name = btrim(name)
                AND char_length(name) <= 120
            );
    END IF;
END
$$;

INSERT INTO public.admins (email, role)
VALUES
    ('officer@isatu.edu.ph', 'admin'),
    ('srofficer@isatu.edu.ph', 'admin')
ON CONFLICT (email) DO NOTHING;

ALTER TABLE public.admins
    ALTER COLUMN role SET DEFAULT 'admin';

ALTER TABLE public.admins
    DROP CONSTRAINT IF EXISTS admins_role_not_blank;

UPDATE public.admins
SET role = 'admin'
WHERE role NOT IN ('admin', 'superadmin');

UPDATE public.admins
SET role = 'superadmin'
WHERE email = 'officer@isatu.edu.ph'
  AND NOT EXISTS (
      SELECT 1 FROM public.admins WHERE role = 'superadmin'
  );

ALTER TABLE public.admins
    DROP CONSTRAINT IF EXISTS admins_role_value;

ALTER TABLE public.admins
    ADD CONSTRAINT admins_role_value CHECK (role IN ('admin', 'superadmin'));

CREATE TABLE IF NOT EXISTS public.insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tracking_id TEXT NOT NULL UNIQUE,
    identity_hash TEXT NOT NULL,
    report_type TEXT NOT NULL DEFAULT 'concern',
    content TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium',
    is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'pending',
    status_comment TEXT,
    status_comment_status TEXT,
    status_comment_at TIMESTAMPTZ,
    chat_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT insights_tracking_id_format CHECK (
        tracking_id ~ '^BOSES-[A-F0-9]{8}$'
    ),
    CONSTRAINT insights_identity_hash_format CHECK (
        identity_hash ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT insights_report_type_value CHECK (
        report_type IN ('concern', 'feedback')
    ),
    CONSTRAINT insights_content_length CHECK (
        length(btrim(content)) BETWEEN 10 AND 10000
    ),
    CONSTRAINT insights_priority_value CHECK (
        priority IN ('low', 'medium', 'high', 'urgent')
    ),
    CONSTRAINT insights_status_value CHECK (
        (report_type = 'concern' AND status IN ('pending', 'reviewing', 'in_progress', 'resolved', 'dismissed', 'archived'))
        OR (report_type = 'feedback' AND status IN ('pending', 'under_review', 'in_progress', 'implemented', 'not_implemented', 'resolved', 'archived'))
    ),
    CONSTRAINT insights_status_comment_length CHECK (
        status_comment IS NULL OR length(btrim(status_comment)) BETWEEN 1 AND 2000
    ),
    CONSTRAINT insights_status_comment_status CHECK (
        (status_comment IS NULL AND status_comment_status IS NULL AND status_comment_at IS NULL)
        OR (
            status_comment IS NOT NULL
            AND status_comment_status IN ('resolved', 'dismissed', 'implemented', 'not_implemented')
            AND status_comment_at IS NOT NULL
        )
    )
);

CREATE TABLE IF NOT EXISTS public.portal_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tracking_id TEXT NOT NULL UNIQUE,
    identity_hash TEXT NOT NULL,
    content TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium',
    is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'pending',
    status_comment TEXT,
    status_comment_status TEXT,
    status_comment_at TIMESTAMPTZ,
    chat_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT portal_insights_tracking_id_format CHECK (
        tracking_id ~ '^BOSES-[A-F0-9]{8}$'
    ),
    CONSTRAINT portal_insights_identity_hash_format CHECK (
        identity_hash ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT portal_insights_content_length CHECK (
        length(btrim(content)) BETWEEN 10 AND 10000
    ),
    CONSTRAINT portal_insights_priority_value CHECK (
        priority IN ('low', 'medium', 'high', 'urgent')
    ),
    CONSTRAINT portal_insights_status_value CHECK (
        status IN ('pending', 'under_review', 'in_progress', 'implemented', 'not_implemented', 'resolved', 'archived')
    ),
    CONSTRAINT portal_insights_status_comment_length CHECK (
        status_comment IS NULL OR length(btrim(status_comment)) BETWEEN 1 AND 2000
    ),
    CONSTRAINT portal_insights_status_comment_status CHECK (
        (status_comment IS NULL AND status_comment_status IS NULL AND status_comment_at IS NULL)
        OR (
            status_comment IS NOT NULL
            AND status_comment_status IN ('resolved', 'dismissed', 'implemented', 'not_implemented')
            AND status_comment_at IS NOT NULL
        )
    )
);

CREATE TABLE IF NOT EXISTS public.insight_tracking_ids (
    tracking_id TEXT PRIMARY KEY,
    CONSTRAINT insight_tracking_ids_format CHECK (
        tracking_id ~ '^BOSES-[A-F0-9]{8}$'
    )
);

CREATE TABLE IF NOT EXISTS public.member_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_hash TEXT NOT NULL,
    report_type TEXT NOT NULL DEFAULT 'concern',
    content TEXT NOT NULL DEFAULT '',
    is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT member_drafts_identity_hash_format CHECK (
        identity_hash ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT member_drafts_report_type_value CHECK (
        report_type IN ('concern', 'feedback')
    ),
    CONSTRAINT member_drafts_content_length CHECK (
        length(content) <= 10000
    )
);

ALTER TABLE public.insights
    DROP CONSTRAINT IF EXISTS insights_content_length;
ALTER TABLE public.insights
    ADD CONSTRAINT insights_content_length CHECK (
        length(btrim(content)) BETWEEN 10 AND 10000
    );

ALTER TABLE public.member_drafts
    DROP CONSTRAINT IF EXISTS member_drafts_content_length;
ALTER TABLE public.member_drafts
    ADD CONSTRAINT member_drafts_content_length CHECK (
        length(content) <= 10000
    );

CREATE INDEX IF NOT EXISTS member_drafts_identity_updated_idx
    ON public.member_drafts (identity_hash, updated_at DESC);

ALTER TABLE public.insights
    ADD COLUMN IF NOT EXISTS report_type TEXT NOT NULL DEFAULT 'concern';

ALTER TABLE public.insights
    ADD COLUMN IF NOT EXISTS chat_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.insights
    ADD COLUMN IF NOT EXISTS status_comment TEXT;
ALTER TABLE public.insights
    ADD COLUMN IF NOT EXISTS status_comment_status TEXT;
ALTER TABLE public.insights
    ADD COLUMN IF NOT EXISTS status_comment_at TIMESTAMPTZ;

ALTER TABLE public.insights
    DROP CONSTRAINT IF EXISTS insights_identity_hash_format;
ALTER TABLE public.insights
    ADD CONSTRAINT insights_identity_hash_format CHECK (
        identity_hash ~ '^[0-9a-f]{64}$'
    );

ALTER TABLE public.insights
    DROP CONSTRAINT IF EXISTS insights_report_type_value;

UPDATE public.insights
SET report_type = CASE
    WHEN report_type = 'concern' THEN 'concern'
    ELSE 'feedback'
END
WHERE report_type NOT IN ('concern', 'feedback');

ALTER TABLE public.insights
    ADD CONSTRAINT insights_report_type_value CHECK (
        report_type IN ('concern', 'feedback')
    );

ALTER TABLE public.insights
    DROP CONSTRAINT IF EXISTS insights_status_value;

UPDATE public.insights
SET status = 'under_review'
WHERE report_type = 'feedback'
  AND status = 'reviewing';

ALTER TABLE public.insights
    ADD CONSTRAINT insights_status_value CHECK (
        (report_type = 'concern' AND status IN ('pending', 'reviewing', 'in_progress', 'resolved', 'dismissed', 'archived'))
        OR (report_type = 'feedback' AND status IN ('pending', 'under_review', 'in_progress', 'implemented', 'not_implemented', 'resolved', 'archived'))
    );

ALTER TABLE public.insights
    DROP CONSTRAINT IF EXISTS insights_status_comment_length;
ALTER TABLE public.insights
    ADD CONSTRAINT insights_status_comment_length CHECK (
        status_comment IS NULL OR length(btrim(status_comment)) BETWEEN 1 AND 2000
    );
ALTER TABLE public.insights
    DROP CONSTRAINT IF EXISTS insights_status_comment_status;
ALTER TABLE public.insights
    ADD CONSTRAINT insights_status_comment_status CHECK (
        (status_comment IS NULL AND status_comment_status IS NULL AND status_comment_at IS NULL)
        OR (
            status_comment IS NOT NULL
            AND status_comment_status IN ('resolved', 'dismissed', 'implemented', 'not_implemented')
            AND status_comment_at IS NOT NULL
        )
    );

CREATE TABLE IF NOT EXISTS public.knowledge_base_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category TEXT NOT NULL DEFAULT 'General',
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    created_by TEXT REFERENCES public.admins(email) ON DELETE SET NULL,
    updated_by TEXT REFERENCES public.admins(email) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT knowledge_base_category_length CHECK (length(category) BETWEEN 1 AND 80),
    CONSTRAINT knowledge_base_question_length CHECK (length(question) BETWEEN 1 AND 240),
    CONSTRAINT knowledge_base_answer_length CHECK (length(answer) BETWEEN 1 AND 12000)
);

CREATE TABLE IF NOT EXISTS public.resource_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_type TEXT NOT NULL CHECK (resource_type = 'faq'),
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    created_by TEXT REFERENCES public.admins(email) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS resource_categories_type_name_unique
    ON public.resource_categories (resource_type, lower(name));

INSERT INTO public.resource_categories (resource_type, name)
VALUES ('faq', 'General')
ON CONFLICT DO NOTHING;

INSERT INTO public.resource_categories (resource_type, name)
SELECT 'faq', category
FROM public.knowledge_base_entries
GROUP BY category
ON CONFLICT DO NOTHING;

ALTER TABLE public.knowledge_base_entries
    DROP CONSTRAINT IF EXISTS knowledge_base_entries_created_by_fkey;
ALTER TABLE public.knowledge_base_entries
    ADD CONSTRAINT knowledge_base_entries_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.admins(email)
    ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public.knowledge_base_entries
    DROP CONSTRAINT IF EXISTS knowledge_base_entries_updated_by_fkey;
ALTER TABLE public.knowledge_base_entries
    ADD CONSTRAINT knowledge_base_entries_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES public.admins(email)
    ON UPDATE CASCADE ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.banned_identities (
    identity_hash TEXT PRIMARY KEY,
    banned_by TEXT NOT NULL,
    banned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT banned_identities_identity_hash_format CHECK (
        identity_hash ~ '^[0-9a-f]{64}$'
        OR identity_hash ~ '^[0-9a-f]{12}\.\.\.[0-9a-f]{4}@(students\.)?isatu\.edu\.ph$'
    ),
    CONSTRAINT banned_identities_officer_email CHECK (
        banned_by = lower(btrim(banned_by))
        AND banned_by ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@(students\.)?isatu\.edu\.ph$'
    )
);

ALTER TABLE public.banned_identities
    DROP CONSTRAINT IF EXISTS banned_identities_identity_hash_format;
ALTER TABLE public.banned_identities
    ADD CONSTRAINT banned_identities_identity_hash_format CHECK (
        identity_hash ~ '^[0-9a-f]{64}$'
        OR identity_hash ~ '^[0-9a-f]{12}\.\.\.[0-9a-f]{4}@(students\.)?isatu\.edu\.ph$'
    );

CREATE TABLE IF NOT EXISTS public.restricted_message_identities (
    identity_hash TEXT PRIMARY KEY,
    restricted_by TEXT NOT NULL,
    restricted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT restricted_message_identities_identity_hash_format CHECK (
        identity_hash ~ '^[0-9a-f]{64}$'
        OR identity_hash ~ '^[0-9a-f]{12}\.\.\.[0-9a-f]{4}@(students\.)?isatu\.edu\.ph$'
    ),
    CONSTRAINT restricted_message_identities_officer_email CHECK (
        restricted_by = lower(btrim(restricted_by))
        AND restricted_by ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@(students\.)?isatu\.edu\.ph$'
    )
);

ALTER TABLE public.restricted_message_identities
    DROP CONSTRAINT IF EXISTS restricted_message_identities_identity_hash_format;
ALTER TABLE public.restricted_message_identities
    ADD CONSTRAINT restricted_message_identities_identity_hash_format CHECK (
        identity_hash ~ '^[0-9a-f]{64}$'
        OR identity_hash ~ '^[0-9a-f]{12}\.\.\.[0-9a-f]{4}@(students\.)?isatu\.edu\.ph$'
    );

CREATE TABLE IF NOT EXISTS public.insight_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    insight_id UUID NOT NULL
        REFERENCES public.insights (id) ON DELETE CASCADE,
    sender_role TEXT NOT NULL,
    sender_email TEXT,
    body TEXT NOT NULL,
    is_unsent BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT insight_messages_sender_role CHECK (
        sender_role IN ('member', 'officer')
    ),
    CONSTRAINT insight_messages_body_length CHECK (
        length(btrim(body)) BETWEEN 1 AND 2000
    )
);

ALTER TABLE public.insight_messages
    ADD COLUMN IF NOT EXISTS sender_email TEXT,
    ADD COLUMN IF NOT EXISTS is_unsent BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.portal_insight_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    portal_insight_id UUID NOT NULL
        REFERENCES public.portal_insights (id) ON DELETE CASCADE,
    sender_role TEXT NOT NULL,
    sender_email TEXT,
    body TEXT NOT NULL,
    is_unsent BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT portal_insight_messages_sender_role CHECK (
        sender_role IN ('member', 'officer')
    ),
    CONSTRAINT portal_insight_messages_body_length CHECK (
        length(btrim(body)) BETWEEN 1 AND 2000
    )
);

CREATE TABLE IF NOT EXISTS public.concern_assignments (
    report_id UUID PRIMARY KEY
        REFERENCES public.insights (id) ON DELETE CASCADE,
    assigned_admin TEXT
        REFERENCES public.admins (email) ON UPDATE CASCADE ON DELETE SET NULL,
    assigned_by TEXT,
    assigned_at TIMESTAMPTZ,
    CONSTRAINT concern_assignments_assigned_by_email CHECK (
        assigned_by IS NULL
        OR (
            assigned_by = lower(btrim(assigned_by))
            AND assigned_by ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@(students\.)?isatu\.edu\.ph$'
        )
    )
);

CREATE INDEX IF NOT EXISTS concern_assignments_admin_idx
    ON public.concern_assignments (assigned_admin);

INSERT INTO public.concern_assignments (report_id)
SELECT i.id
FROM public.insights AS i
WHERE i.report_type = 'concern'
ON CONFLICT (report_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sync_concern_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.report_type = 'concern' THEN
        INSERT INTO public.concern_assignments (report_id)
        VALUES (NEW.id)
        ON CONFLICT (report_id) DO NOTHING;
    ELSE
        DELETE FROM public.concern_assignments
        WHERE report_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS insights_sync_concern_assignment ON public.insights;
CREATE TRIGGER insights_sync_concern_assignment
AFTER INSERT OR UPDATE OF report_type ON public.insights
FOR EACH ROW
EXECUTE FUNCTION public.sync_concern_assignment();

CREATE TABLE IF NOT EXISTS private_vault.notify_emails (
    insight_id UUID PRIMARY KEY
        REFERENCES public.insights (id) ON DELETE CASCADE,
    recipient_email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT notify_emails_isatu CHECK (
        recipient_email = lower(btrim(recipient_email))
        AND recipient_email ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@(students\.)?isatu\.edu\.ph$'
    )
);

CREATE TABLE IF NOT EXISTS private_vault.login_otp_challenges (
    email TEXT PRIMARY KEY,
    challenge_id UUID NOT NULL UNIQUE,
    code_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts SMALLINT NOT NULL DEFAULT 0,
    CONSTRAINT login_otp_challenges_email_isatu CHECK (
        email = lower(btrim(email))
        AND email ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@(students\.)?isatu\.edu\.ph$'
    ),
    CONSTRAINT login_otp_challenges_code_hash CHECK (
        code_hash ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT login_otp_challenges_attempts CHECK (
        attempts BETWEEN 0 AND 5
    ),
    CONSTRAINT login_otp_challenges_expiry CHECK (
        expires_at > created_at
    )
);

CREATE TABLE IF NOT EXISTS private_vault.portal_insight_notify_emails (
    portal_insight_id UUID PRIMARY KEY
        REFERENCES public.portal_insights (id) ON DELETE CASCADE,
    recipient_email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT portal_insight_notify_emails_isatu CHECK (
        recipient_email = lower(btrim(recipient_email))
        AND recipient_email ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@(students\.)?isatu\.edu\.ph$'
    )
);

CREATE INDEX IF NOT EXISTS insights_identity_created_idx
    ON public.insights (identity_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS insights_status_created_idx
    ON public.insights (status, created_at DESC);
CREATE INDEX IF NOT EXISTS portal_insights_identity_created_idx
    ON public.portal_insights (identity_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS portal_insights_status_created_idx
    ON public.portal_insights (status, created_at DESC);
CREATE INDEX IF NOT EXISTS insight_messages_report_created_idx
    ON public.insight_messages (insight_id, created_at);
CREATE INDEX IF NOT EXISTS portal_insight_messages_report_created_idx
    ON public.portal_insight_messages (portal_insight_id, created_at);

CREATE OR REPLACE FUNCTION public.set_insight_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_insight_tracking_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.insight_tracking_ids (tracking_id)
        VALUES (NEW.tracking_id);
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.tracking_id <> OLD.tracking_id THEN
            UPDATE public.insight_tracking_ids
            SET tracking_id = NEW.tracking_id
            WHERE tracking_id = OLD.tracking_id;
            IF NOT FOUND THEN
                INSERT INTO public.insight_tracking_ids (tracking_id)
                VALUES (NEW.tracking_id);
            END IF;
        END IF;
        RETURN NEW;
    END IF;

    DELETE FROM public.insight_tracking_ids
    WHERE tracking_id = OLD.tracking_id;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS insights_set_updated_at ON public.insights;
CREATE TRIGGER insights_set_updated_at
BEFORE UPDATE ON public.insights
FOR EACH ROW
EXECUTE FUNCTION public.set_insight_updated_at();

DROP TRIGGER IF EXISTS insights_tracking_id ON public.insights;
CREATE TRIGGER insights_tracking_id
AFTER INSERT OR UPDATE OF tracking_id OR DELETE ON public.insights
FOR EACH ROW
EXECUTE FUNCTION public.sync_insight_tracking_id();

DROP TRIGGER IF EXISTS portal_insights_set_updated_at ON public.portal_insights;
CREATE TRIGGER portal_insights_set_updated_at
BEFORE UPDATE ON public.portal_insights
FOR EACH ROW
EXECUTE FUNCTION public.set_insight_updated_at();

DROP TRIGGER IF EXISTS portal_insights_tracking_id ON public.portal_insights;
CREATE TRIGGER portal_insights_tracking_id
AFTER INSERT OR UPDATE OF tracking_id OR DELETE ON public.portal_insights
FOR EACH ROW
EXECUTE FUNCTION public.sync_insight_tracking_id();

DROP FUNCTION IF EXISTS public.create_insight_with_vault(
    TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT
);
DROP FUNCTION IF EXISTS public.create_insight_with_vault(
    TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT
);
DROP FUNCTION IF EXISTS public.admin_list_insights(TEXT);

CREATE OR REPLACE FUNCTION public.create_insight_with_vault(
    p_tracking_id TEXT,
    p_identity_hash TEXT,
    p_report_type TEXT,
    p_content TEXT,
    p_is_anonymous BOOLEAN,
    p_recipient_email TEXT
)
RETURNS TABLE (
    id UUID,
    tracking_id TEXT,
    status TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_insight_id UUID;
BEGIN
    IF p_tracking_id IS NULL
       OR p_tracking_id !~ '^BOSES-[A-F0-9]{8}$' THEN
        RAISE EXCEPTION 'Invalid tracking ID';
    END IF;

    IF p_identity_hash IS NULL
       OR p_identity_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Invalid identity hash';
    END IF;

    IF p_report_type IS NULL
       OR p_report_type NOT IN ('concern', 'feedback') THEN
        RAISE EXCEPTION 'Invalid report type';
    END IF;

    IF p_content IS NULL
       OR length(btrim(p_content)) NOT BETWEEN 10 AND 10000 THEN
        RAISE EXCEPTION 'Report content must be between 10 and 10000 characters';
    END IF;

    IF p_is_anonymous IS NULL THEN
        RAISE EXCEPTION 'An anonymity choice is required';
    END IF;

    IF p_recipient_email IS NULL
       OR p_recipient_email <> lower(btrim(p_recipient_email))
       OR p_recipient_email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@(students\.)?isatu\.edu\.ph$' THEN
        RAISE EXCEPTION 'A valid ISAT U email address is required';
    END IF;

    INSERT INTO public.insights (
        tracking_id, identity_hash, report_type, content, is_anonymous
    )
    VALUES (
        p_tracking_id, p_identity_hash, p_report_type, btrim(p_content), p_is_anonymous
    )
    RETURNING public.insights.id INTO v_insight_id;

    INSERT INTO private_vault.notify_emails (insight_id, recipient_email)
    VALUES (v_insight_id, p_recipient_email);

    IF p_report_type = 'concern' THEN
        INSERT INTO public.concern_assignments (report_id)
        VALUES (v_insight_id)
        ON CONFLICT (report_id) DO NOTHING;
    END IF;

    RETURN QUERY
    SELECT i.id, i.tracking_id, i.status, i.created_at
    FROM public.insights AS i
    WHERE i.id = v_insight_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_portal_insight_with_vault(
    p_tracking_id TEXT,
    p_identity_hash TEXT,
    p_content TEXT,
    p_is_anonymous BOOLEAN,
    p_recipient_email TEXT
)
RETURNS TABLE (
    id UUID,
    tracking_id TEXT,
    status TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_insight_id UUID;
BEGIN
    IF p_tracking_id IS NULL
       OR p_tracking_id !~ '^BOSES-[A-F0-9]{8}$' THEN
        RAISE EXCEPTION 'Invalid tracking ID';
    END IF;

    IF p_identity_hash IS NULL
       OR p_identity_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Invalid identity hash';
    END IF;

    IF p_content IS NULL
       OR length(btrim(p_content)) NOT BETWEEN 10 AND 10000 THEN
        RAISE EXCEPTION 'Portal Insights content must be between 10 and 10000 characters';
    END IF;

    IF p_is_anonymous IS NULL THEN
        RAISE EXCEPTION 'An anonymity choice is required';
    END IF;

    IF p_recipient_email IS NULL
       OR p_recipient_email <> lower(btrim(p_recipient_email))
       OR p_recipient_email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@(students\.)?isatu\.edu\.ph$' THEN
        RAISE EXCEPTION 'A valid ISAT U email address is required';
    END IF;

    INSERT INTO public.portal_insights (
        tracking_id, identity_hash, content, is_anonymous, chat_enabled
    )
    VALUES (
        p_tracking_id, p_identity_hash, btrim(p_content), p_is_anonymous, FALSE
    )
    RETURNING public.portal_insights.id INTO v_insight_id;

    INSERT INTO private_vault.portal_insight_notify_emails (
        portal_insight_id, recipient_email
    )
    VALUES (v_insight_id, p_recipient_email);

    RETURN QUERY
    SELECT i.id, i.tracking_id, i.status, i.created_at
    FROM public.portal_insights AS i
    WHERE i.id = v_insight_id;
END;
$$;

DROP FUNCTION IF EXISTS public.member_list_insights(TEXT);
CREATE OR REPLACE FUNCTION public.member_list_insights(p_identity_hash TEXT)
RETURNS TABLE (
    id UUID,
    tracking_id TEXT,
    identity_hash TEXT,
    report_type TEXT,
    content TEXT,
    is_anonymous BOOLEAN,
    status TEXT,
    chat_enabled BOOLEAN,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    sender_label TEXT,
    status_comment TEXT,
    status_comment_at TIMESTAMPTZ,
    storage_type TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF p_identity_hash IS NULL
       OR p_identity_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Invalid member identity hash';
    END IF;

    RETURN QUERY
    SELECT i.id,
           i.tracking_id,
           i.identity_hash,
           i.report_type,
           i.content,
           i.is_anonymous,
           i.status,
           i.chat_enabled,
           i.created_at,
           i.updated_at,
           CASE
               WHEN i.is_anonymous THEN i.identity_hash
               ELSE COALESCE(n.recipient_email, i.identity_hash)
           END,
           i.status_comment,
           i.status_comment_at,
           'insight'::TEXT
    FROM public.insights AS i
    LEFT JOIN private_vault.notify_emails AS n ON n.insight_id = i.id
    WHERE i.identity_hash = p_identity_hash
    ORDER BY i.created_at DESC;
END;
$$;

DROP FUNCTION IF EXISTS public.admin_update_insight_status(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.admin_update_insight_status(UUID, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.admin_update_insight_status(
    p_insight_id UUID,
    p_status TEXT,
    p_officer_email TEXT,
    p_status_comment TEXT
)
RETURNS TABLE (
    insight_id UUID,
    tracking_id TEXT,
    status TEXT,
    status_comment TEXT,
    status_comment_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_current_status TEXT;
    v_report_type TEXT;
    v_tracking_id TEXT;
    v_status_comment TEXT;
    v_status_comment_at TIMESTAMPTZ;
BEGIN
    IF p_status IS NULL
       OR p_status NOT IN ('pending', 'reviewing', 'under_review', 'in_progress', 'resolved', 'dismissed', 'implemented', 'not_implemented', 'archived') THEN
        RAISE EXCEPTION 'Invalid report status';
    END IF;

    IF p_status_comment IS NOT NULL
       AND length(btrim(p_status_comment)) NOT BETWEEN 1 AND 2000 THEN
        RAISE EXCEPTION 'Status comments must be between 1 and 2000 characters';
    END IF;

    IF p_officer_email IS NULL
       OR p_officer_email <> lower(btrim(p_officer_email))
       OR NOT EXISTS (
           SELECT 1
           FROM public.admins AS a
           WHERE a.email = p_officer_email
       ) THEN
        RAISE EXCEPTION 'Officer is not authorized to update report status'
            USING ERRCODE = '42501';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(2026112301::bigint);

    SELECT i.status, i.tracking_id, i.report_type
    INTO v_current_status, v_tracking_id, v_report_type
    FROM public.insights AS i
    WHERE i.id = p_insight_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Report not found'
            USING ERRCODE = 'P0002';
    END IF;

    IF p_status_comment IS NOT NULL
       AND NOT (
           (v_report_type = 'concern' AND p_status IN ('resolved', 'dismissed'))
           OR (v_report_type = 'feedback' AND p_status IN ('implemented', 'not_implemented'))
       ) THEN
        RAISE EXCEPTION 'Comments can only be added to final report outcomes';
    END IF;

    IF v_report_type = 'concern'
       AND NOT EXISTS (
           SELECT 1
           FROM public.admins AS a
           LEFT JOIN public.concern_assignments AS ca ON ca.report_id = p_insight_id
           WHERE a.email = p_officer_email
             AND (a.role = 'superadmin' OR ca.assigned_admin = p_officer_email)
       ) THEN
        RAISE EXCEPTION 'This concern is not assigned to this officer'
            USING ERRCODE = '42501';
    END IF;

    IF v_current_status = 'archived'
       AND NOT EXISTS (
           SELECT 1
           FROM public.admins AS a
           WHERE a.email = p_officer_email
             AND a.role = 'superadmin'
       ) THEN
        RAISE EXCEPTION 'Only superadmins can restore archived reports'
            USING ERRCODE = '42501';
    END IF;

    IF NOT (
        (
            v_report_type = 'concern'
            AND (
                (v_current_status = 'pending' AND p_status IN ('reviewing', 'resolved'))
                OR (v_current_status = 'reviewing' AND p_status IN ('in_progress', 'resolved', 'dismissed'))
                OR (v_current_status = 'in_progress' AND p_status IN ('resolved', 'dismissed'))
            )
        )
        OR (
            v_report_type = 'feedback'
            AND (
                (v_current_status = 'pending' AND p_status = 'under_review')
                OR (v_current_status = 'under_review' AND p_status = 'in_progress')
                OR (v_current_status = 'in_progress' AND p_status IN ('implemented', 'not_implemented'))
            )
        )
        OR (
            v_current_status IN ('resolved', 'dismissed', 'implemented', 'not_implemented')
            AND p_status = 'archived'
        )
        OR (
            v_report_type = 'feedback'
            AND v_current_status = 'resolved'
            AND p_status = 'archived'
        )
        OR (
            v_current_status = 'archived'
            AND EXISTS (
                SELECT 1
                FROM public.admins AS a
                WHERE a.email = p_officer_email
                  AND a.role = 'superadmin'
            )
            AND (
                (v_report_type = 'concern' AND p_status IN ('pending', 'reviewing', 'in_progress', 'resolved', 'dismissed'))
                OR (
                    v_report_type = 'feedback'
                    AND p_status IN ('pending', 'under_review', 'in_progress', 'implemented', 'not_implemented', 'resolved')
                )
            )
        )
    ) THEN
        RAISE EXCEPTION 'Invalid report status transition: % -> %',
            v_current_status, p_status;
    END IF;

    UPDATE public.insights AS i
    SET status = p_status,
        status_comment = CASE
            WHEN p_status = 'archived' THEN i.status_comment
            WHEN p_status IN ('resolved', 'dismissed', 'implemented', 'not_implemented') THEN
                CASE
                    WHEN p_status_comment IS NOT NULL THEN btrim(p_status_comment)
                    WHEN i.status_comment_status = p_status THEN i.status_comment
                    ELSE NULL
                END
            ELSE NULL
        END,
        status_comment_status = CASE
            WHEN p_status = 'archived' THEN i.status_comment_status
            WHEN p_status IN ('resolved', 'dismissed', 'implemented', 'not_implemented') THEN
                CASE
                    WHEN p_status_comment IS NOT NULL THEN p_status
                    WHEN i.status_comment_status = p_status THEN i.status_comment_status
                    ELSE NULL
                END
            ELSE NULL
        END,
        status_comment_at = CASE
            WHEN p_status = 'archived' THEN i.status_comment_at
            WHEN p_status IN ('resolved', 'dismissed', 'implemented', 'not_implemented') THEN
                CASE
                    WHEN p_status_comment IS NOT NULL THEN now()
                    WHEN i.status_comment_status = p_status THEN i.status_comment_at
                    ELSE NULL
                END
            ELSE NULL
        END
    WHERE i.id = p_insight_id
    RETURNING i.status_comment, i.status_comment_at
    INTO v_status_comment, v_status_comment_at;

    RETURN QUERY
    SELECT p_insight_id, v_tracking_id, p_status, v_status_comment, v_status_comment_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_portal_insight_status(
    p_insight_id UUID,
    p_status TEXT,
    p_officer_email TEXT,
    p_status_comment TEXT
)
RETURNS TABLE (
    insight_id UUID,
    tracking_id TEXT,
    status TEXT,
    status_comment TEXT,
    status_comment_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_current_status TEXT;
    v_tracking_id TEXT;
    v_status_comment TEXT;
    v_status_comment_at TIMESTAMPTZ;
BEGIN
    IF p_status IS NULL
       OR p_status NOT IN ('pending', 'under_review', 'in_progress', 'implemented', 'not_implemented', 'resolved', 'archived') THEN
        RAISE EXCEPTION 'Invalid Portal Insights status';
    END IF;

    IF p_status_comment IS NOT NULL
       AND length(btrim(p_status_comment)) NOT BETWEEN 1 AND 2000 THEN
        RAISE EXCEPTION 'Status comments must be between 1 and 2000 characters';
    END IF;

    IF p_officer_email IS NULL
       OR p_officer_email <> lower(btrim(p_officer_email))
       OR NOT EXISTS (
           SELECT 1
           FROM public.admins AS a
           WHERE a.email = p_officer_email
             AND a.role = 'superadmin'
       ) THEN
        RAISE EXCEPTION 'Only superadmins can update Portal Insights status'
            USING ERRCODE = '42501';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(2026112301::bigint);

    SELECT i.status, i.tracking_id
    INTO v_current_status, v_tracking_id
    FROM public.portal_insights AS i
    WHERE i.id = p_insight_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Portal Insights submission not found'
            USING ERRCODE = 'P0002';
    END IF;

    IF p_status_comment IS NOT NULL
       AND p_status NOT IN ('implemented', 'not_implemented') THEN
        RAISE EXCEPTION 'Outcome comments can only be added to implemented or not implemented submissions';
    END IF;

    IF NOT (
        (v_current_status = 'pending' AND p_status = 'under_review')
        OR (v_current_status = 'under_review' AND p_status = 'in_progress')
        OR (v_current_status = 'in_progress' AND p_status IN ('implemented', 'not_implemented'))
        OR (
            v_current_status IN ('resolved', 'implemented', 'not_implemented')
            AND p_status = 'archived'
        )
        OR (
            v_current_status = 'archived'
            AND p_status IN ('pending', 'under_review', 'in_progress', 'implemented', 'not_implemented', 'resolved')
        )
    ) THEN
        RAISE EXCEPTION 'Invalid Portal Insights status transition: % -> %',
            v_current_status, p_status;
    END IF;

    UPDATE public.portal_insights AS i
    SET status = p_status,
        status_comment = CASE
            WHEN p_status = 'archived' THEN i.status_comment
            WHEN p_status IN ('implemented', 'not_implemented') THEN
                CASE
                    WHEN p_status_comment IS NOT NULL THEN btrim(p_status_comment)
                    WHEN i.status_comment_status = p_status THEN i.status_comment
                    ELSE NULL
                END
            ELSE NULL
        END,
        status_comment_status = CASE
            WHEN p_status = 'archived' THEN i.status_comment_status
            WHEN p_status IN ('implemented', 'not_implemented') THEN
                CASE
                    WHEN p_status_comment IS NOT NULL THEN p_status
                    WHEN i.status_comment_status = p_status THEN i.status_comment_status
                    ELSE NULL
                END
            ELSE NULL
        END,
        status_comment_at = CASE
            WHEN p_status = 'archived' THEN i.status_comment_at
            WHEN p_status IN ('implemented', 'not_implemented') THEN
                CASE
                    WHEN p_status_comment IS NOT NULL THEN now()
                    WHEN i.status_comment_status = p_status THEN i.status_comment_at
                    ELSE NULL
                END
            ELSE NULL
        END
    WHERE i.id = p_insight_id
    RETURNING i.status_comment, i.status_comment_at
    INTO v_status_comment, v_status_comment_at;

    RETURN QUERY
    SELECT p_insight_id, v_tracking_id, p_status, v_status_comment, v_status_comment_at;
END;
$$;

DROP FUNCTION IF EXISTS public.admin_list_insights(TEXT);
CREATE OR REPLACE FUNCTION public.admin_list_insights(p_officer_email TEXT)
RETURNS TABLE (
    id UUID,
    tracking_id TEXT,
    sender_label TEXT,
    report_type TEXT,
    content TEXT,
    priority TEXT,
    is_anonymous BOOLEAN,
    chat_enabled BOOLEAN,
    status TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    is_banned BOOLEAN,
    assigned_admin TEXT,
    status_comment TEXT,
    status_comment_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF p_officer_email IS NULL
       OR p_officer_email <> lower(btrim(p_officer_email))
       OR NOT EXISTS (
           SELECT 1
           FROM public.admins AS a
           WHERE a.email = p_officer_email
       ) THEN
        RAISE EXCEPTION 'Officer is not authorized to list reports'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT i.id,
           i.tracking_id,
           CASE
               WHEN i.is_anonymous THEN 'Anonymous'
               ELSE COALESCE(n.recipient_email, i.identity_hash)
           END,
           i.report_type,
           i.content,
           i.priority,
           i.is_anonymous,
           i.chat_enabled,
           i.status,
           i.created_at,
           i.updated_at,
           (b.identity_hash IS NOT NULL),
           ca.assigned_admin,
           i.status_comment,
           i.status_comment_at
    FROM public.insights AS i
    LEFT JOIN private_vault.notify_emails AS n ON n.insight_id = i.id
    LEFT JOIN public.banned_identities AS b ON b.identity_hash = i.identity_hash
    LEFT JOIN public.concern_assignments AS ca ON ca.report_id = i.id
    WHERE i.report_type <> 'concern'
       OR EXISTS (
           SELECT 1
           FROM public.admins AS actor
           WHERE actor.email = p_officer_email
             AND (
                 actor.role = 'superadmin'
                 OR ca.assigned_admin = p_officer_email
             )
       )
    ORDER BY i.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_portal_insights(p_officer_email TEXT)
RETURNS TABLE (
    id UUID,
    tracking_id TEXT,
    sender_label TEXT,
    report_type TEXT,
    content TEXT,
    priority TEXT,
    is_anonymous BOOLEAN,
    chat_enabled BOOLEAN,
    status TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    is_banned BOOLEAN,
    assigned_admin TEXT,
    status_comment TEXT,
    status_comment_at TIMESTAMPTZ,
    storage_type TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF p_officer_email IS NULL
       OR p_officer_email <> lower(btrim(p_officer_email))
       OR NOT EXISTS (
           SELECT 1
           FROM public.admins AS a
           WHERE a.email = p_officer_email
       ) THEN
        RAISE EXCEPTION 'Officer is not authorized to list Portal Insights'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT i.id,
           i.tracking_id,
           CASE
               WHEN i.is_anonymous THEN 'Anonymous'
               ELSE COALESCE(n.recipient_email, i.identity_hash)
           END,
           'feedback'::TEXT,
           i.content,
           i.priority,
           i.is_anonymous,
           i.chat_enabled,
           i.status,
           i.created_at,
           i.updated_at,
           (b.identity_hash IS NOT NULL),
           NULL::TEXT,
           i.status_comment,
           i.status_comment_at,
           'portal_insight'::TEXT
    FROM public.portal_insights AS i
    LEFT JOIN private_vault.portal_insight_notify_emails AS n
        ON n.portal_insight_id = i.id
    LEFT JOIN public.banned_identities AS b ON b.identity_hash = i.identity_hash
    ORDER BY i.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.superadmin_list_admins(p_actor_email TEXT)
RETURNS TABLE (
    email TEXT,
    role TEXT,
    added_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF p_actor_email IS NULL
       OR NOT EXISTS (
           SELECT 1
           FROM public.admins AS a
           WHERE a.email = p_actor_email
             AND a.role = 'superadmin'
       ) THEN
        RAISE EXCEPTION 'Superadmin access is required'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT a.email, a.role, a.added_at
    FROM public.admins AS a
    ORDER BY a.role DESC, a.email ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.superadmin_manage_admin(
    p_actor_email TEXT,
    p_action TEXT,
    p_email TEXT,
    p_role TEXT DEFAULT NULL,
    p_new_email TEXT DEFAULT NULL
)
RETURNS TABLE (
    email TEXT,
    role TEXT,
    added_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_target_role TEXT;
BEGIN
    IF p_actor_email IS NULL
       OR NOT EXISTS (
           SELECT 1
           FROM public.admins AS a
           WHERE a.email = p_actor_email
             AND a.role = 'superadmin'
       ) THEN
        RAISE EXCEPTION 'Superadmin access is required'
            USING ERRCODE = '42501';
    END IF;

    IF p_email IS NULL
       OR p_email <> lower(btrim(p_email))
       OR p_email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@(students\.)?isatu\.edu\.ph$' THEN
        RAISE EXCEPTION 'A valid normalized ISAT U email address is required';
    END IF;

    IF p_action IS NULL OR p_action NOT IN ('create', 'update', 'delete') THEN
        RAISE EXCEPTION 'Invalid officer access action';
    END IF;

    IF p_action IN ('create', 'update')
       AND (p_role IS NULL OR p_role NOT IN ('admin', 'superadmin')) THEN
        RAISE EXCEPTION 'Role must be admin or superadmin';
    END IF;

    IF p_action = 'update'
       AND (p_new_email IS NULL
            OR p_new_email <> lower(btrim(p_new_email))
            OR p_new_email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@(students\.)?isatu\.edu\.ph$') THEN
        RAISE EXCEPTION 'A valid normalized ISAT U email address is required';
    END IF;

    LOCK TABLE public.admins IN EXCLUSIVE MODE;

    IF NOT EXISTS (
        SELECT 1
        FROM public.admins AS a
        WHERE a.email = p_actor_email
          AND a.role = 'superadmin'
    ) THEN
        RAISE EXCEPTION 'Superadmin access is required'
            USING ERRCODE = '42501';
    END IF;

    SELECT a.role
    INTO v_target_role
    FROM public.admins AS a
    WHERE a.email = p_email;

    IF p_action = 'create' THEN
        RETURN QUERY
        INSERT INTO public.admins AS a (email, role)
        VALUES (p_email, p_role)
        RETURNING a.email, a.role, a.added_at;
    ELSIF p_action = 'update' THEN
        IF v_target_role IS NULL THEN
            RAISE EXCEPTION 'Officer account not found'
                USING ERRCODE = 'P0002';
        END IF;
        IF v_target_role = 'superadmin'
           AND p_role <> 'superadmin'
           AND (SELECT count(*) FROM public.admins AS a WHERE a.role = 'superadmin') <= 1 THEN
            RAISE EXCEPTION 'Cannot demote the last superadmin'
                USING ERRCODE = '23514';
        END IF;
        RETURN QUERY
        UPDATE public.admins AS a
        SET email = p_new_email,
            role = p_role
        WHERE a.email = p_email
        RETURNING a.email, a.role, a.added_at;
    ELSE
        IF v_target_role IS NULL THEN
            RAISE EXCEPTION 'Officer account not found'
                USING ERRCODE = 'P0002';
        END IF;
        IF v_target_role = 'superadmin'
           AND (SELECT count(*) FROM public.admins AS a WHERE a.role = 'superadmin') <= 1 THEN
            RAISE EXCEPTION 'Cannot remove the last superadmin'
                USING ERRCODE = '23514';
        END IF;
        RETURN QUERY
        DELETE FROM public.admins AS a
        WHERE a.email = p_email
        RETURNING a.email, a.role, a.added_at;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_senders(p_officer_email TEXT)
RETURNS TABLE (
    sender_id TEXT,
    sender_email TEXT,
    has_anonymous_reports BOOLEAN,
    report_count INTEGER,
    active_report_count INTEGER,
    archived_report_count INTEGER,
    is_banned BOOLEAN,
    is_message_restricted BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF p_officer_email IS NULL
       OR p_officer_email <> lower(btrim(p_officer_email))
       OR NOT EXISTS (
           SELECT 1
           FROM public.admins AS a
           WHERE a.email = p_officer_email
             AND a.role = 'superadmin'
       ) THEN
        RAISE EXCEPTION 'Superadmin access is required to list senders'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    WITH submissions AS (
        SELECT i.identity_hash,
               i.is_anonymous,
               i.status,
               i.created_at,
               n.recipient_email
        FROM public.insights AS i
        LEFT JOIN private_vault.notify_emails AS n ON n.insight_id = i.id

        UNION ALL

        SELECT i.identity_hash,
               i.is_anonymous,
               i.status,
               i.created_at,
               n.recipient_email
        FROM public.portal_insights AS i
        LEFT JOIN private_vault.portal_insight_notify_emails AS n
            ON n.portal_insight_id = i.id
    )
    SELECT s.identity_hash,
           CASE
               WHEN s.is_anonymous THEN NULL
               ELSE max(s.recipient_email)
           END,
           s.is_anonymous,
           count(*)::INTEGER,
           count(*) FILTER (WHERE s.status <> 'archived')::INTEGER,
           count(*) FILTER (WHERE s.status = 'archived')::INTEGER,
           (b.identity_hash IS NOT NULL),
           (r.identity_hash IS NOT NULL)
    FROM submissions AS s
    LEFT JOIN public.banned_identities AS b ON b.identity_hash = s.identity_hash
    LEFT JOIN public.restricted_message_identities AS r ON r.identity_hash = s.identity_hash
    WHERE EXISTS (
        SELECT 1
        FROM public.insights AS pending_report
        WHERE pending_report.identity_hash = s.identity_hash
          AND pending_report.status = 'pending'
        UNION ALL
        SELECT 1
        FROM public.portal_insights AS pending_portal_insight
        WHERE pending_portal_insight.identity_hash = s.identity_hash
          AND pending_portal_insight.status = 'pending'
    )
    GROUP BY s.identity_hash, s.is_anonymous, b.identity_hash, r.identity_hash
    ORDER BY max(s.created_at) DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.superadmin_list_admins_v2(p_actor_email TEXT)
RETURNS TABLE (
    email TEXT,
    name TEXT,
    role TEXT,
    added_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF p_actor_email IS NULL
       OR NOT EXISTS (
           SELECT 1
           FROM public.admins AS a
           WHERE a.email = p_actor_email
             AND a.role = 'superadmin'
       ) THEN
        RAISE EXCEPTION 'Superadmin access is required'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT a.email, a.name, a.role, a.added_at, a.updated_at
    FROM public.admins AS a
    ORDER BY a.role DESC, a.email ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.superadmin_manage_admin_v2(
    p_actor_email TEXT,
    p_action TEXT,
    p_email TEXT,
    p_role TEXT DEFAULT NULL,
    p_name TEXT DEFAULT NULL,
    p_new_email TEXT DEFAULT NULL
)
RETURNS TABLE (
    email TEXT,
    name TEXT,
    role TEXT,
    added_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_target_role TEXT;
BEGIN
    IF p_actor_email IS NULL
       OR NOT EXISTS (
           SELECT 1
           FROM public.admins AS a
           WHERE a.email = p_actor_email
             AND a.role = 'superadmin'
       ) THEN
        RAISE EXCEPTION 'Superadmin access is required'
            USING ERRCODE = '42501';
    END IF;

    IF p_email IS NULL
       OR p_email <> lower(btrim(p_email))
       OR p_email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@(students\.)?isatu\.edu\.ph$' THEN
        RAISE EXCEPTION 'A valid normalized ISAT U email address is required';
    END IF;

    IF p_action IS NULL OR p_action NOT IN ('create', 'update', 'delete') THEN
        RAISE EXCEPTION 'Invalid officer access action';
    END IF;

    IF p_action IN ('create', 'update')
       AND (p_role IS NULL OR p_role NOT IN ('admin', 'superadmin')) THEN
        RAISE EXCEPTION 'Role must be admin or superadmin';
    END IF;

    IF p_action IN ('create', 'update')
       AND (p_name IS NULL
            OR p_name <> btrim(p_name)
            OR char_length(p_name) < 1
            OR char_length(p_name) > 120
            OR p_name ~ '[[:cntrl:]]') THEN
        RAISE EXCEPTION 'Officer name must be between 1 and 120 characters';
    END IF;

    IF p_action = 'update'
       AND (p_new_email IS NULL
            OR p_new_email <> lower(btrim(p_new_email))
            OR p_new_email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@(students\.)?isatu\.edu\.ph$') THEN
        RAISE EXCEPTION 'A valid normalized ISAT U email address is required';
    END IF;

    LOCK TABLE public.admins IN EXCLUSIVE MODE;

    IF NOT EXISTS (
        SELECT 1
        FROM public.admins AS a
        WHERE a.email = p_actor_email
          AND a.role = 'superadmin'
    ) THEN
        RAISE EXCEPTION 'Superadmin access is required'
            USING ERRCODE = '42501';
    END IF;

    SELECT a.role
    INTO v_target_role
    FROM public.admins AS a
    WHERE a.email = p_email;

    IF p_action = 'create' THEN
        RETURN QUERY
        INSERT INTO public.admins AS a (email, name, role)
        VALUES (p_email, p_name, p_role)
        RETURNING a.email, a.name, a.role, a.added_at, a.updated_at;
    ELSIF p_action = 'update' THEN
        IF v_target_role IS NULL THEN
            RAISE EXCEPTION 'Officer account not found'
                USING ERRCODE = 'P0002';
        END IF;
        IF v_target_role = 'superadmin'
           AND p_role <> 'superadmin'
           AND (SELECT count(*) FROM public.admins AS a WHERE a.role = 'superadmin') <= 1 THEN
            RAISE EXCEPTION 'Cannot demote the last superadmin'
                USING ERRCODE = '23514';
        END IF;
        RETURN QUERY
        UPDATE public.admins AS a
        SET email = p_new_email,
            name = p_name,
            role = p_role,
            updated_at = now()
        WHERE a.email = p_email
        RETURNING a.email, a.name, a.role, a.added_at, a.updated_at;
    ELSE
        IF v_target_role IS NULL THEN
            RAISE EXCEPTION 'Officer account not found'
                USING ERRCODE = 'P0002';
        END IF;
        IF v_target_role = 'superadmin'
           AND (SELECT count(*) FROM public.admins AS a WHERE a.role = 'superadmin') <= 1 THEN
            RAISE EXCEPTION 'Cannot remove the last superadmin'
                USING ERRCODE = '23514';
        END IF;
        RETURN QUERY
        DELETE FROM public.admins AS a
        WHERE a.email = p_email
        RETURNING a.email, a.name, a.role, a.added_at, a.updated_at;
    END IF;
END;
$$;

REVOKE ALL ON SCHEMA private_vault FROM PUBLIC, boses_app;
REVOKE ALL ON TABLE private_vault.notify_emails FROM PUBLIC, boses_app;
REVOKE ALL ON TABLE private_vault.login_otp_challenges FROM PUBLIC, boses_app;
REVOKE ALL ON TABLE private_vault.portal_insight_notify_emails FROM PUBLIC, boses_app;
REVOKE ALL ON TABLE public.insight_tracking_ids FROM PUBLIC, boses_app;
REVOKE ALL ON FUNCTION public.set_insight_updated_at() FROM PUBLIC, boses_app;
REVOKE ALL ON FUNCTION public.sync_concern_assignment() FROM PUBLIC, boses_app;
REVOKE ALL ON FUNCTION public.sync_insight_tracking_id() FROM PUBLIC, boses_app;
REVOKE ALL ON FUNCTION public.create_insight_with_vault(
    TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_portal_insight_with_vault(
    TEXT, TEXT, TEXT, BOOLEAN, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.member_list_insights(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_insight_status(
    UUID, TEXT, TEXT, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_insights(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_portal_insight_status(
    UUID, TEXT, TEXT, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_portal_insights(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_senders(TEXT) FROM PUBLIC;
REVOKE ALL ON TABLE public.concern_assignments FROM PUBLIC;
REVOKE ALL ON FUNCTION public.superadmin_list_admins(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.superadmin_manage_admin(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.superadmin_list_admins_v2(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.superadmin_manage_admin_v2(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO boses_app;
GRANT USAGE ON SCHEMA private_vault TO boses_app;
GRANT SELECT ON TABLE public.admins TO boses_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.knowledge_base_entries TO boses_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.resource_categories TO boses_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.insights TO boses_app;
REVOKE ALL ON TABLE public.portal_insights FROM PUBLIC, boses_app;
GRANT SELECT, DELETE ON TABLE public.portal_insights TO boses_app;
GRANT UPDATE (id) ON TABLE public.portal_insights TO boses_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.member_drafts TO boses_app;
GRANT SELECT, INSERT, DELETE ON TABLE public.banned_identities TO boses_app;
GRANT SELECT, INSERT, DELETE ON TABLE public.restricted_message_identities TO boses_app;
GRANT SELECT, INSERT ON TABLE public.insight_messages TO boses_app;
GRANT UPDATE (body, is_unsent) ON TABLE public.insight_messages TO boses_app;
REVOKE ALL ON TABLE public.portal_insight_messages FROM PUBLIC, boses_app;
GRANT SELECT ON TABLE public.portal_insight_messages TO boses_app;
GRANT UPDATE (id) ON TABLE public.portal_insight_messages TO boses_app;
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_type TEXT NOT NULL CHECK (recipient_type IN ('member', 'officer')),
    recipient_key TEXT NOT NULL,
    insight_id UUID REFERENCES public.insights (id) ON DELETE CASCADE,
    portal_insight_id UUID REFERENCES public.portal_insights (id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    link TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications
    ADD COLUMN IF NOT EXISTS portal_insight_id UUID
    REFERENCES public.portal_insights (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS notifications_recipient_created_idx
    ON public.notifications (recipient_type, recipient_key, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_portal_insight_idx
    ON public.notifications (portal_insight_id)
    WHERE portal_insight_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.schema_migrations (
    migration_name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.schema_migrations
        WHERE migration_name = '20261123_separate_portal_insights'
    ) THEN
        IF EXISTS (
            SELECT 1
            FROM public.insights AS legacy
            JOIN public.portal_insights AS current
              ON current.id = legacy.id
              OR current.tracking_id = legacy.tracking_id
        ) THEN
            RAISE EXCEPTION 'Cannot migrate Portal Insights because an existing ID or tracking ID is already in use.';
        END IF;

        INSERT INTO public.portal_insights (
            id, tracking_id, identity_hash, content, priority, is_anonymous,
            status, status_comment, status_comment_status, status_comment_at,
            chat_enabled, created_at, updated_at
        )
        SELECT id, tracking_id, identity_hash, content, priority, is_anonymous,
               status, status_comment, status_comment_status, status_comment_at,
               chat_enabled, created_at, updated_at
        FROM public.insights
        WHERE report_type = 'feedback';

        INSERT INTO public.portal_insight_messages (
            id, portal_insight_id, sender_role, sender_email, body, is_unsent, created_at
        )
        SELECT m.id, m.insight_id, m.sender_role, m.sender_email, m.body, m.is_unsent, m.created_at
        FROM public.insight_messages AS m
        JOIN public.insights AS i ON i.id = m.insight_id
        WHERE i.report_type = 'feedback';

        INSERT INTO private_vault.portal_insight_notify_emails (
            portal_insight_id, recipient_email, created_at
        )
        SELECT n.insight_id, n.recipient_email, n.created_at
        FROM private_vault.notify_emails AS n
        JOIN public.insights AS i ON i.id = n.insight_id
        WHERE i.report_type = 'feedback';

        UPDATE public.notifications AS n
        SET portal_insight_id = n.insight_id,
            insight_id = NULL
        WHERE n.insight_id IN (
            SELECT i.id
            FROM public.insights AS i
            WHERE i.report_type = 'feedback'
        );

        DELETE FROM public.insights
        WHERE report_type = 'feedback';

        INSERT INTO public.insight_tracking_ids (tracking_id)
        SELECT tracking_id FROM public.insights
        UNION
        SELECT tracking_id FROM public.portal_insights
        ON CONFLICT (tracking_id) DO NOTHING;

        INSERT INTO public.schema_migrations (migration_name)
        VALUES ('20261123_separate_portal_insights');
    END IF;
END;
$$;

ALTER TABLE public.portal_insights
    ALTER COLUMN chat_enabled SET DEFAULT FALSE;
UPDATE public.portal_insights
SET chat_enabled = FALSE
WHERE chat_enabled;

DROP FUNCTION IF EXISTS public.update_member_insight(UUID, TEXT, TEXT, TEXT, BOOLEAN);
CREATE FUNCTION public.update_member_insight(
    p_insight_id UUID,
    p_identity_hash TEXT,
    p_report_type TEXT,
    p_content TEXT,
    p_is_anonymous BOOLEAN
)
RETURNS TABLE (
    id UUID,
    tracking_id TEXT,
    report_type TEXT,
    content TEXT,
    is_anonymous BOOLEAN,
    status TEXT,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_insight public.insights%ROWTYPE;
BEGIN
    IF p_insight_id IS NULL
       OR p_identity_hash IS NULL
       OR p_identity_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Invalid member report identity';
    END IF;

    IF p_report_type IS NULL OR p_report_type NOT IN ('concern', 'feedback') THEN
        RAISE EXCEPTION 'Invalid report type';
    END IF;

    IF p_content IS NULL OR length(btrim(p_content)) NOT BETWEEN 10 AND 10000 THEN
        RAISE EXCEPTION 'Report content must be between 10 and 10000 characters';
    END IF;

    IF p_is_anonymous IS NULL THEN
        RAISE EXCEPTION 'An anonymity choice is required';
    END IF;

    SELECT i.*
    INTO v_insight
    FROM public.insights AS i
    WHERE i.id = p_insight_id
      AND i.identity_hash = p_identity_hash
      AND i.status = 'pending'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pending report not found or no longer editable'
            USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.insights
    SET content = btrim(p_content),
        report_type = p_report_type,
        is_anonymous = p_is_anonymous
    WHERE id = p_insight_id;

    RETURN QUERY
    SELECT i.id, i.tracking_id, i.report_type, i.content,
           i.is_anonymous, i.status, i.updated_at
    FROM public.insights AS i
    WHERE i.id = p_insight_id;

END;
$$;

REVOKE ALL ON FUNCTION public.update_member_insight(
    UUID, TEXT, TEXT, TEXT, BOOLEAN
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.lock_sender_archive_cleanup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(2026112301::bigint);
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_archived_sender_submissions(
    p_identity_hash TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF p_identity_hash IS NULL OR p_identity_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Invalid sender identity';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.insights AS i
        WHERE i.identity_hash = p_identity_hash
          AND i.status = 'pending'
    ) OR EXISTS (
        SELECT 1
        FROM public.portal_insights AS i
        WHERE i.identity_hash = p_identity_hash
          AND i.status = 'pending'
    ) THEN
        RETURN;
    END IF;

    DELETE FROM public.insights AS i
    WHERE i.identity_hash = p_identity_hash
      AND i.status = 'archived';

    DELETE FROM public.portal_insights AS i
    WHERE i.identity_hash = p_identity_hash
      AND i.status = 'archived';
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_archived_sender_submissions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'archived' THEN
            RETURN NULL;
        END IF;
        PERFORM public.purge_archived_sender_submissions(OLD.identity_hash);
    ELSE
        PERFORM public.purge_archived_sender_submissions(NEW.identity_hash);
        IF OLD.identity_hash IS DISTINCT FROM NEW.identity_hash THEN
            PERFORM public.purge_archived_sender_submissions(OLD.identity_hash);
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.lock_sender_archive_cleanup() FROM PUBLIC, boses_app;
REVOKE ALL ON FUNCTION public.purge_archived_sender_submissions(TEXT) FROM PUBLIC, boses_app;
REVOKE ALL ON FUNCTION public.cleanup_archived_sender_submissions() FROM PUBLIC, boses_app;

DO $$
DECLARE
    v_identity_hash TEXT;
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(2026112301::bigint);

    FOR v_identity_hash IN
        SELECT i.identity_hash
        FROM public.insights AS i
        WHERE i.status = 'archived'
        UNION
        SELECT i.identity_hash
        FROM public.portal_insights AS i
        WHERE i.status = 'archived'
    LOOP
        PERFORM public.purge_archived_sender_submissions(v_identity_hash);
    END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS insights_sender_archive_cleanup_lock_update ON public.insights;
CREATE TRIGGER insights_sender_archive_cleanup_lock_update
BEFORE UPDATE OF status ON public.insights
FOR EACH STATEMENT
EXECUTE FUNCTION public.lock_sender_archive_cleanup();

DROP TRIGGER IF EXISTS insights_sender_archive_cleanup_lock_delete ON public.insights;
CREATE TRIGGER insights_sender_archive_cleanup_lock_delete
BEFORE DELETE ON public.insights
FOR EACH STATEMENT
EXECUTE FUNCTION public.lock_sender_archive_cleanup();

DROP TRIGGER IF EXISTS portal_insights_sender_archive_cleanup_lock_update ON public.portal_insights;
CREATE TRIGGER portal_insights_sender_archive_cleanup_lock_update
BEFORE UPDATE OF status ON public.portal_insights
FOR EACH STATEMENT
EXECUTE FUNCTION public.lock_sender_archive_cleanup();

DROP TRIGGER IF EXISTS portal_insights_sender_archive_cleanup_lock_delete ON public.portal_insights;
CREATE TRIGGER portal_insights_sender_archive_cleanup_lock_delete
BEFORE DELETE ON public.portal_insights
FOR EACH STATEMENT
EXECUTE FUNCTION public.lock_sender_archive_cleanup();

DROP TRIGGER IF EXISTS insights_sender_archive_cleanup_update ON public.insights;
CREATE CONSTRAINT TRIGGER insights_sender_archive_cleanup_update
AFTER UPDATE OF status ON public.insights
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_archived_sender_submissions();

DROP TRIGGER IF EXISTS insights_sender_archive_cleanup_delete ON public.insights;
CREATE CONSTRAINT TRIGGER insights_sender_archive_cleanup_delete
AFTER DELETE ON public.insights
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_archived_sender_submissions();

DROP TRIGGER IF EXISTS portal_insights_sender_archive_cleanup_update ON public.portal_insights;
CREATE CONSTRAINT TRIGGER portal_insights_sender_archive_cleanup_update
AFTER UPDATE OF status ON public.portal_insights
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_archived_sender_submissions();

DROP TRIGGER IF EXISTS portal_insights_sender_archive_cleanup_delete ON public.portal_insights;
CREATE CONSTRAINT TRIGGER portal_insights_sender_archive_cleanup_delete
AFTER DELETE ON public.portal_insights
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_archived_sender_submissions();

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notifications TO boses_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.concern_assignments TO boses_app;
GRANT EXECUTE ON FUNCTION public.create_insight_with_vault(
    TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT
) TO boses_app;
GRANT EXECUTE ON FUNCTION public.create_portal_insight_with_vault(
    TEXT, TEXT, TEXT, BOOLEAN, TEXT
) TO boses_app;
GRANT EXECUTE ON FUNCTION public.member_list_insights(TEXT) TO boses_app;
GRANT EXECUTE ON FUNCTION public.admin_update_insight_status(
    UUID, TEXT, TEXT, TEXT
) TO boses_app;
GRANT EXECUTE ON FUNCTION public.admin_list_insights(TEXT) TO boses_app;
GRANT EXECUTE ON FUNCTION public.admin_update_portal_insight_status(
    UUID, TEXT, TEXT, TEXT
) TO boses_app;
GRANT EXECUTE ON FUNCTION public.admin_list_portal_insights(TEXT) TO boses_app;
GRANT EXECUTE ON FUNCTION public.admin_list_senders(TEXT) TO boses_app;
GRANT EXECUTE ON FUNCTION public.update_member_insight(
    UUID, TEXT, TEXT, TEXT, BOOLEAN
) TO boses_app;
GRANT EXECUTE ON FUNCTION public.superadmin_list_admins(TEXT) TO boses_app;
GRANT EXECUTE ON FUNCTION public.superadmin_manage_admin(TEXT, TEXT, TEXT, TEXT, TEXT) TO boses_app;
GRANT EXECUTE ON FUNCTION public.superadmin_list_admins_v2(TEXT) TO boses_app;
GRANT EXECUTE ON FUNCTION public.superadmin_manage_admin_v2(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO boses_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private_vault.login_otp_challenges TO boses_app;

REVOKE ALL PRIVILEGES ON TABLE
    public.admins,
    public.insights,
    public.portal_insights,
    public.insight_tracking_ids,
    public.member_drafts,
    public.knowledge_base_entries,
    public.resource_categories,
    public.banned_identities,
    public.restricted_message_identities,
    public.insight_messages,
    public.portal_insight_messages,
    public.concern_assignments,
    public.notifications,
    public.schema_migrations,
    private_vault.notify_emails,
    private_vault.login_otp_challenges,
    private_vault.portal_insight_notify_emails
FROM anon, authenticated;

REVOKE ALL ON SCHEMA private_vault FROM anon, authenticated;

COMMIT;