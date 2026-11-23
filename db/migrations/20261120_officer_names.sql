BEGIN;

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

REVOKE ALL ON FUNCTION public.superadmin_list_admins_v2(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.superadmin_manage_admin_v2(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.superadmin_list_admins_v2(TEXT) TO boses_app;
GRANT EXECUTE ON FUNCTION public.superadmin_manage_admin_v2(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO boses_app;

COMMIT;
