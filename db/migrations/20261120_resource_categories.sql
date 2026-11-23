CREATE TABLE IF NOT EXISTS public.resource_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_type TEXT NOT NULL CHECK (resource_type IN ('faq', 'emergency')),
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    created_by TEXT REFERENCES public.admins(email) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS resource_categories_type_name_unique
    ON public.resource_categories (resource_type, lower(name));

INSERT INTO public.resource_categories (resource_type, name)
VALUES ('faq', 'General'), ('emergency', 'Emergency')
ON CONFLICT DO NOTHING;

INSERT INTO public.resource_categories (resource_type, name)
SELECT 'faq', category
FROM public.knowledge_base_entries
GROUP BY category
ON CONFLICT DO NOTHING;

INSERT INTO public.resource_categories (resource_type, name)
SELECT 'emergency', category
FROM public.emergency_resources
GROUP BY category
ON CONFLICT DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.resource_categories TO boses_app;
