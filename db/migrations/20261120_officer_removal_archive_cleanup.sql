BEGIN;

ALTER TABLE public.concern_assignments
    DROP CONSTRAINT IF EXISTS concern_assignments_assigned_admin_fkey;
ALTER TABLE public.concern_assignments
    ADD CONSTRAINT concern_assignments_assigned_admin_fkey
    FOREIGN KEY (assigned_admin)
    REFERENCES public.admins (email)
    ON UPDATE CASCADE
    ON DELETE SET NULL;

ALTER TABLE public.insight_messages
    DROP CONSTRAINT IF EXISTS insight_messages_insight_id_fkey;
ALTER TABLE public.insight_messages
    ADD CONSTRAINT insight_messages_insight_id_fkey
    FOREIGN KEY (insight_id)
    REFERENCES public.insights (id)
    ON DELETE CASCADE;

COMMIT;
