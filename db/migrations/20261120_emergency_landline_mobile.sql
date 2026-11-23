BEGIN;

ALTER TABLE public.emergency_resources
    ADD COLUMN IF NOT EXISTS landline TEXT NOT NULL DEFAULT '';
ALTER TABLE public.emergency_resources
    ADD COLUMN IF NOT EXISTS mobile_number TEXT NOT NULL DEFAULT '';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'emergency_resources'
          AND column_name = 'phone'
    ) THEN
        UPDATE public.emergency_resources
        SET landline = phone
        WHERE landline = '' AND phone <> '';
        ALTER TABLE public.emergency_resources DROP COLUMN phone;
    END IF;
END
$$;

ALTER TABLE public.emergency_resources
    DROP CONSTRAINT IF EXISTS emergency_phone_length;
ALTER TABLE public.emergency_resources
    DROP CONSTRAINT IF EXISTS emergency_resource_has_contact;
ALTER TABLE public.emergency_resources
    DROP CONSTRAINT IF EXISTS emergency_landline_length;
ALTER TABLE public.emergency_resources
    ADD CONSTRAINT emergency_landline_length CHECK (length(landline) <= 40);
ALTER TABLE public.emergency_resources
    DROP CONSTRAINT IF EXISTS emergency_mobile_number_length;
ALTER TABLE public.emergency_resources
    ADD CONSTRAINT emergency_mobile_number_length CHECK (length(mobile_number) <= 40);
ALTER TABLE public.emergency_resources
    ADD CONSTRAINT emergency_resource_has_contact CHECK (
        landline <> '' OR mobile_number <> '' OR email <> '' OR facebook_url <> '' OR website_url <> ''
    );

COMMIT;
