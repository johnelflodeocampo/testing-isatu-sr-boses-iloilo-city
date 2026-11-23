BEGIN;

CREATE OR REPLACE FUNCTION public.admin_update_insight_status(
    p_insight_id UUID,
    p_status TEXT,
    p_officer_email TEXT
)
RETURNS TABLE (
    insight_id UUID,
    tracking_id TEXT,
    status TEXT,
    notify_email TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_current_status TEXT;
    v_report_type TEXT;
    v_tracking_id TEXT;
    v_notify_email TEXT;
BEGIN
    IF p_status IS NULL
       OR p_status NOT IN ('pending', 'reviewing', 'under_review', 'in_progress', 'resolved', 'archived') THEN
        RAISE EXCEPTION 'Invalid report status';
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
                OR (v_current_status = 'reviewing' AND p_status = 'resolved')
            )
        )
        OR (
            v_report_type = 'feedback'
            AND (
                (v_current_status = 'pending' AND p_status = 'under_review')
                OR (v_current_status = 'under_review' AND p_status = 'in_progress')
                OR (v_current_status = 'in_progress' AND p_status = 'resolved')
            )
        )
        OR (v_current_status = 'resolved' AND p_status = 'archived')
        OR (
            v_current_status = 'archived'
            AND EXISTS (
                SELECT 1
                FROM public.admins AS a
                WHERE a.email = p_officer_email
                  AND a.role = 'superadmin'
            )
            AND (
                (v_report_type = 'concern' AND p_status IN ('pending', 'reviewing', 'resolved'))
                OR (
                    v_report_type = 'feedback'
                    AND p_status IN ('pending', 'under_review', 'in_progress', 'resolved')
                )
            )
        )
    ) THEN
        RAISE EXCEPTION 'Invalid report status transition: % -> %',
            v_current_status, p_status;
    END IF;

    UPDATE public.insights AS i
    SET status = p_status
    WHERE i.id = p_insight_id;

    SELECT n.recipient_email
    INTO v_notify_email
    FROM private_vault.notify_emails AS n
    WHERE n.insight_id = p_insight_id;

    RETURN QUERY
    SELECT p_insight_id, v_tracking_id, p_status, v_notify_email;
END;
$$;

COMMIT;
