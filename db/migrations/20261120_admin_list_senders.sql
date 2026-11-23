BEGIN;

CREATE OR REPLACE FUNCTION public.admin_list_senders(p_officer_email TEXT)
RETURNS TABLE (
    sender_id TEXT,
    sender_email TEXT,
    has_anonymous_reports BOOLEAN,
    report_count INTEGER,
    active_report_count INTEGER,
    archived_report_count INTEGER,
    is_banned BOOLEAN,
    is_message_restricted BOOLEAN
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
             AND a.role = 'superadmin'
       ) THEN
        RAISE EXCEPTION 'Superadmin access is required to list senders'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT i.identity_hash,
           CASE
               WHEN i.is_anonymous THEN NULL
               ELSE max(n.recipient_email)
           END,
           i.is_anonymous,
           count(*)::INTEGER,
           count(*) FILTER (WHERE i.status <> 'archived')::INTEGER,
           count(*) FILTER (WHERE i.status = 'archived')::INTEGER,
           (b.identity_hash IS NOT NULL),
           (r.identity_hash IS NOT NULL)
    FROM public.insights AS i
    LEFT JOIN private_vault.notify_emails AS n ON n.insight_id = i.id
    LEFT JOIN public.banned_identities AS b ON b.identity_hash = i.identity_hash
    LEFT JOIN public.restricted_message_identities AS r ON r.identity_hash = i.identity_hash
    GROUP BY i.identity_hash, i.is_anonymous, b.identity_hash, r.identity_hash
    ORDER BY max(i.created_at) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_senders(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_senders(TEXT) TO boses_app;

COMMIT;
