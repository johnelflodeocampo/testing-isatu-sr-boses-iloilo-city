ALTER TABLE public.emergency_resources
    ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';

ALTER TABLE public.emergency_resources
    ADD COLUMN IF NOT EXISTS facebook_url TEXT NOT NULL DEFAULT '';

ALTER TABLE public.emergency_resources
    DROP CONSTRAINT IF EXISTS emergency_email_length;
ALTER TABLE public.emergency_resources
    ADD CONSTRAINT emergency_email_length CHECK (length(email) <= 254);

ALTER TABLE public.emergency_resources
    DROP CONSTRAINT IF EXISTS emergency_facebook_url_length;
ALTER TABLE public.emergency_resources
    ADD CONSTRAINT emergency_facebook_url_length CHECK (length(facebook_url) <= 2048);

ALTER TABLE public.emergency_resources
    DROP CONSTRAINT IF EXISTS emergency_resource_has_contact;
ALTER TABLE public.emergency_resources
    ADD CONSTRAINT emergency_resource_has_contact CHECK (
        phone <> '' OR email <> '' OR facebook_url <> '' OR website_url <> ''
    );
