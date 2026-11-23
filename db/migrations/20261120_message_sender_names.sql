BEGIN;

UPDATE public.insight_messages AS m
SET sender_email = CASE
    WHEN i.is_anonymous THEN NULL
    ELSE split_part(n.recipient_email, '@', 1)
END
FROM public.insights AS i
LEFT JOIN private_vault.notify_emails AS n ON n.insight_id = i.id
WHERE m.insight_id = i.id
  AND m.sender_role = 'member'
  AND m.sender_email IS NULL
  AND (i.is_anonymous OR n.recipient_email IS NOT NULL);

COMMIT;
