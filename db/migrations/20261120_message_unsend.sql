BEGIN;

ALTER TABLE public.insight_messages
    ADD COLUMN IF NOT EXISTS is_unsent BOOLEAN NOT NULL DEFAULT FALSE;

REVOKE UPDATE ON TABLE public.insight_messages FROM boses_app;
GRANT UPDATE (body, is_unsent) ON TABLE public.insight_messages TO boses_app;

COMMIT;
