BEGIN;

CREATE TABLE IF NOT EXISTS public.resource_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_type TEXT NOT NULL,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    created_by TEXT REFERENCES public.admins(email) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DELETE FROM public.resource_categories
WHERE resource_type = 'emergency';

DROP TABLE IF EXISTS public.emergency_resources;

ALTER TABLE public.resource_categories
    DROP CONSTRAINT IF EXISTS resource_categories_resource_type_check;
ALTER TABLE public.resource_categories
    DROP CONSTRAINT IF EXISTS resource_categories_resource_type_faq_check;
ALTER TABLE public.resource_categories
    ADD CONSTRAINT resource_categories_resource_type_faq_check
    CHECK (resource_type = 'faq');

CREATE UNIQUE INDEX IF NOT EXISTS resource_categories_type_name_unique
    ON public.resource_categories (resource_type, lower(name));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.resource_categories TO boses_app;

INSERT INTO public.resource_categories (resource_type, name)
VALUES ('faq', 'General')
ON CONFLICT DO NOTHING;

INSERT INTO public.resource_categories (resource_type, name)
SELECT 'faq', category
FROM public.knowledge_base_entries
GROUP BY category
ON CONFLICT DO NOTHING;

COMMIT;
