BEGIN;

CREATE SCHEMA IF NOT EXISTS private_vault;

CREATE TABLE IF NOT EXISTS private_vault.login_otp_challenges (
    email TEXT PRIMARY KEY,
    challenge_id UUID NOT NULL UNIQUE,
    code_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts SMALLINT NOT NULL DEFAULT 0,
    CONSTRAINT login_otp_challenges_email_isatu CHECK (
        email = lower(btrim(email))
        AND email ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@(students\.)?isatu\.edu\.ph$'
    ),
    CONSTRAINT login_otp_challenges_code_hash CHECK (
        code_hash ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT login_otp_challenges_attempts CHECK (
        attempts BETWEEN 0 AND 5
    ),
    CONSTRAINT login_otp_challenges_expiry CHECK (
        expires_at > created_at
    )
);

REVOKE ALL ON SCHEMA private_vault FROM PUBLIC, boses_app;
REVOKE ALL ON TABLE private_vault.login_otp_challenges FROM PUBLIC, boses_app;
GRANT USAGE ON SCHEMA private_vault TO boses_app;
GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE private_vault.login_otp_challenges TO boses_app;

DO $$
DECLARE
    v_role TEXT;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
            EXECUTE pg_catalog.format(
                'REVOKE ALL ON SCHEMA private_vault FROM %I',
                v_role
            );
            EXECUTE pg_catalog.format(
                'REVOKE ALL ON TABLE private_vault.login_otp_challenges FROM %I',
                v_role
            );
        END IF;
    END LOOP;
END
$$;

COMMIT;
