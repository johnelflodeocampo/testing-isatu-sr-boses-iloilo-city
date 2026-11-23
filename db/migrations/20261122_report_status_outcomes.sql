BEGIN;

ALTER TABLE public.insights
    ADD COLUMN IF NOT EXISTS status_comment TEXT,
    ADD COLUMN IF NOT EXISTS status_comment_status TEXT,
    ADD COLUMN IF NOT EXISTS status_comment_at TIMESTAMPTZ;

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

DROP FUNCTION IF EXISTS public.member_list_insights(TEXT);
CREATE FUNCTION public.member_list_insights(p_identity_hash TEXT)
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
    status_comment_at TIMESTAMPTZ
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
           i.status_comment_at
    FROM public.insights AS i
    LEFT JOIN private_vault.notify_emails AS n ON n.insight_id = i.id
    WHERE i.identity_hash = p_identity_hash
    ORDER BY i.created_at DESC;
END;
$$;

DROP FUNCTION IF EXISTS public.admin_update_insight_status(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.admin_update_insight_status(UUID, TEXT, TEXT, TEXT);
CREATE FUNCTION public.admin_update_insight_status(
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
    WHERE i.id = p_insight_id;

    RETURN QUERY
    SELECT p_insight_id, v_tracking_id, p_status, i.status_comment, i.status_comment_at
    FROM public.insights AS i
    WHERE i.id = p_insight_id;
END;
$$;

DROP FUNCTION IF EXISTS public.admin_list_insights(TEXT);
CREATE FUNCTION public.admin_list_insights(p_officer_email TEXT)
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

REVOKE ALL ON FUNCTION public.member_list_insights(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_insight_status(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_insights(TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.member_list_insights(TEXT) TO boses_app;
GRANT EXECUTE ON FUNCTION public.admin_update_insight_status(UUID, TEXT, TEXT, TEXT) TO boses_app;
GRANT EXECUTE ON FUNCTION public.admin_list_insights(TEXT) TO boses_app;

COMMIT;
