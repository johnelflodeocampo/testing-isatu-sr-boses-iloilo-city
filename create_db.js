const path = require('node:path');
const fs = require('node:fs/promises');

require('dotenv').config({ path: path.join(__dirname, '.env') });

if (process.env.DATABASE_URL) {
  throw new Error(
    'npm run create_db is for local PostgreSQL setup. Apply db/supabase_deploy.sql in the Supabase SQL Editor instead.',
  );
}

const { Client } = require('pg');
const crypto = require('node:crypto');

const databaseName = 'isatu_sr_boses_iloilocity_db';

function getConnectionConfig(database) {
  const password = process.env.PGPASSWORD;
  if (!password || password === 'CHANGE_ME') {
    throw new Error(
      'Set PGPASSWORD in the project .env file to your local PostgreSQL password.',
    );
  }

  return {
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password,
    database,
    ssl: false,
  };
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function getIdentityHash(email, pepper) {
  return crypto
    .createHash('sha256')
    .update(`${email}:${pepper}`)
    .digest('hex');
}

async function migrateIdentityHashes(client) {
  const pepper = process.env.HASH_PEPPER;
  if (!pepper || pepper.startsWith('CHANGE_ME')) {
    throw new Error('Set HASH_PEPPER to the same unique value used by the app before migrating sender identities.');
  }

  const tables = await client.query(
    `SELECT to_regclass('public.insights') IS NOT NULL AS has_insights,
            to_regclass('private_vault.notify_emails') IS NOT NULL AS has_notify_emails,
            to_regclass('public.portal_insights') IS NOT NULL AS has_portal_insights,
            to_regclass('private_vault.portal_insight_notify_emails') IS NOT NULL AS has_portal_notify_emails,
            to_regclass('public.banned_identities') IS NOT NULL AS has_bans,
            to_regclass('public.restricted_message_identities') IS NOT NULL AS has_message_restrictions`,
  );
  const state = tables.rows[0];
  if (!state.has_insights) return;
  if (!state.has_notify_emails) {
    throw new Error('Cannot migrate sender identities because the private account-email vault does not exist.');
  }
  if (state.has_portal_insights && !state.has_portal_notify_emails) {
    throw new Error('Cannot migrate Portal Insights identities because the private account-email vault does not exist.');
  }

  await client.query('BEGIN');
  try {
    await client.query('ALTER TABLE public.insights DROP CONSTRAINT IF EXISTS insights_identity_hash_format');
    if (state.has_portal_insights) {
      await client.query('ALTER TABLE public.portal_insights DROP CONSTRAINT IF EXISTS portal_insights_identity_hash_format');
    }
    if (state.has_bans) {
      await client.query('ALTER TABLE public.banned_identities DROP CONSTRAINT IF EXISTS banned_identities_identity_hash_format');
    }
    if (state.has_message_restrictions) {
      await client.query('ALTER TABLE public.restricted_message_identities DROP CONSTRAINT IF EXISTS restricted_message_identities_identity_hash_format');
    }

    const identitySources = [
      `SELECT i.identity_hash, n.recipient_email
       FROM public.insights AS i
       LEFT JOIN private_vault.notify_emails AS n ON n.insight_id = i.id`,
    ];
    if (state.has_portal_insights) {
      identitySources.push(
        `SELECT i.identity_hash, n.recipient_email
         FROM public.portal_insights AS i
         LEFT JOIN private_vault.portal_insight_notify_emails AS n
           ON n.portal_insight_id = i.id`,
      );
    }
    const identities = await client.query(
      `SELECT identity_hash AS old_hash,
              array_agg(DISTINCT recipient_email) FILTER (WHERE recipient_email IS NOT NULL) AS emails
       FROM (${identitySources.join('\nUNION ALL\n')}) AS stored_identities
       WHERE identity_hash !~ '^[0-9a-f]{64}$'
       GROUP BY identity_hash`,
    );
    const mappings = [];
    for (const identity of identities.rows) {
      if (!identity.emails || identity.emails.length !== 1) {
        throw new Error('Cannot safely migrate an existing sender identity without exactly one stored submitter email.');
      }
      mappings.push({
        oldHash: identity.old_hash,
        newHash: getIdentityHash(identity.emails[0], pepper),
      });
    }

    const duplicateHashes = new Set();
    const mappingByOldHash = new Map();
    for (const mapping of mappings) {
      const previous = mappingByOldHash.get(mapping.oldHash);
      if (previous && previous !== mapping.newHash) duplicateHashes.add(mapping.oldHash);
      mappingByOldHash.set(mapping.oldHash, mapping.newHash);
    }
    if (duplicateHashes.size) {
      throw new Error('Cannot safely migrate sender identities because a legacy masked tag maps to multiple accounts.');
    }

    await client.query(
      'CREATE TEMP TABLE identity_hash_migration (old_hash TEXT PRIMARY KEY, new_hash TEXT NOT NULL) ON COMMIT DROP',
    );
    if (mappings.length) {
      await client.query(
        `INSERT INTO identity_hash_migration (old_hash, new_hash)
         SELECT old_hash, new_hash
         FROM unnest($1::text[], $2::text[]) AS mapping(old_hash, new_hash)`,
        [mappings.map(({ oldHash }) => oldHash), mappings.map(({ newHash }) => newHash)],
      );
      await client.query('ALTER TABLE public.insights DISABLE TRIGGER insights_set_updated_at');
      await client.query(
        `UPDATE public.insights AS i
         SET identity_hash = mapping.new_hash
         FROM identity_hash_migration AS mapping
         WHERE i.identity_hash = mapping.old_hash`,
      );
      await client.query('ALTER TABLE public.insights ENABLE TRIGGER insights_set_updated_at');
      if (state.has_portal_insights) {
        await client.query('ALTER TABLE public.portal_insights DISABLE TRIGGER portal_insights_set_updated_at');
        await client.query(
          `UPDATE public.portal_insights AS i
           SET identity_hash = mapping.new_hash
           FROM identity_hash_migration AS mapping
           WHERE i.identity_hash = mapping.old_hash`,
        );
        await client.query('ALTER TABLE public.portal_insights ENABLE TRIGGER portal_insights_set_updated_at');
      }
      if (state.has_bans) {
        await client.query(
          `UPDATE public.banned_identities AS b
           SET identity_hash = mapping.new_hash
           FROM identity_hash_migration AS mapping
           WHERE b.identity_hash = mapping.old_hash`,
        );
      }
      if (state.has_message_restrictions) {
        await client.query(
          `UPDATE public.restricted_message_identities AS r
           SET identity_hash = mapping.new_hash
           FROM identity_hash_migration AS mapping
           WHERE r.identity_hash = mapping.old_hash`,
        );
      }
    }

    const invalidInsights = await client.query(
      `SELECT 1 FROM public.insights
       WHERE identity_hash !~ '^[0-9a-f]{64}$'
       LIMIT 1`,
    );
    if (invalidInsights.rowCount) {
      throw new Error('At least one report sender identity could not be migrated to a full SHA-256 hash.');
    }
    if (state.has_portal_insights) {
      const invalidPortalInsights = await client.query(
        `SELECT 1 FROM public.portal_insights
         WHERE identity_hash !~ '^[0-9a-f]{64}$'
         LIMIT 1`,
      );
      if (invalidPortalInsights.rowCount) {
        throw new Error('At least one Portal Insights sender identity could not be migrated to a full SHA-256 hash.');
      }
    }

    await client.query(
      `ALTER TABLE public.insights
       ADD CONSTRAINT insights_identity_hash_format CHECK (identity_hash ~ '^[0-9a-f]{64}$')`,
    );
    if (state.has_portal_insights) {
      await client.query(
        `ALTER TABLE public.portal_insights
         ADD CONSTRAINT portal_insights_identity_hash_format CHECK (identity_hash ~ '^[0-9a-f]{64}$')`,
      );
    }
    if (state.has_bans) {
      await client.query(
        `ALTER TABLE public.banned_identities
         ADD CONSTRAINT banned_identities_identity_hash_format CHECK (
           identity_hash ~ '^[0-9a-f]{64}$'
           OR identity_hash ~ '^[0-9a-f]{12}\.\.\.[0-9a-f]{4}@(students\.)?isatu\.edu\.ph$'
         )`,
      );
    }
    if (state.has_message_restrictions) {
      await client.query(
        `ALTER TABLE public.restricted_message_identities
         ADD CONSTRAINT restricted_message_identities_identity_hash_format CHECK (
           identity_hash ~ '^[0-9a-f]{64}$'
           OR identity_hash ~ '^[0-9a-f]{12}\.\.\.[0-9a-f]{4}@(students\.)?isatu\.edu\.ph$'
         )`,
      );
    }
    await client.query('COMMIT');
    if (mappings.length) {
      console.log(`Migrated ${mappings.length} legacy sender identity${mappings.length === 1 ? '' : 'ies'} to full SHA-256 hashes.`);
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function createDatabase() {
  const adminClient = new Client(getConnectionConfig('postgres'));
  let created = false;

  await adminClient.connect();

  try {
    const result = await adminClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [databaseName],
    );

    if (result.rowCount === 0) {
      await adminClient.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
      created = true;
    }
  } finally {
    await adminClient.end();
  }

  console.log(
    created
      ? `Created database "${databaseName}".`
      : `Database "${databaseName}" already exists.`,
  );

  const schemaPath = path.join(__dirname, 'db', 'schema.sql');
  const schema = await fs.readFile(schemaPath, 'utf8');
  if (!schema.trim()) {
    throw new Error(`Schema file is empty: ${schemaPath}`);
  }

  const schemaClient = new Client(getConnectionConfig(databaseName));
  await schemaClient.connect();

  try {
    await migrateIdentityHashes(schemaClient);
    await schemaClient.query(schema);
    console.log(`Applied schema from "${schemaPath}".`);
  } finally {
    await schemaClient.end();
  }
}

createDatabase().catch((error) => {
  console.error(`Could not set up database "${databaseName}": ${error.message}`);
  process.exitCode = 1;
});
