-- Apply as the Supabase database owner to an existing BOSES installation.
-- The fresh-project schema and db/supabase_deploy.sql already include these tables.
BEGIN;

CREATE TABLE IF NOT EXISTS public.site_privacy_notice (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    is_published BOOLEAN NOT NULL DEFAULT TRUE,
    title TEXT,
    body TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT site_privacy_notice_content CHECK (
        (
            is_published
            AND title IS NOT NULL
            AND char_length(btrim(title)) BETWEEN 1 AND 40
            AND body IS NOT NULL
            AND char_length(body) BETWEEN 1 AND 10000
        )
        OR (
            NOT is_published
            AND title IS NULL
            AND body IS NULL
        )
    )
);

CREATE TABLE IF NOT EXISTS public.api_rate_limits (
    key_hash TEXT PRIMARY KEY CHECK (key_hash ~ '^[0-9a-f]{64}$'),
    hit_count INTEGER NOT NULL CHECK (hit_count >= 0),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS api_rate_limits_expires_at_idx
    ON public.api_rate_limits (expires_at);

REVOKE ALL ON TABLE public.site_privacy_notice FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.site_privacy_notice TO boses_app;
REVOKE ALL ON TABLE public.api_rate_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.api_rate_limits TO boses_app;

COMMIT;
