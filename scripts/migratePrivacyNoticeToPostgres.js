const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = require('../models/database');
const legacyFileStore = require('../lib/privacyNoticeStore');

async function migratePrivacyNotice() {
  const notice = await legacyFileStore.read();
  if (!notice) {
    console.log('No legacy privacy notice file was found; nothing to migrate.');
    return;
  }

  const result = await pool.query(
    `INSERT INTO public.site_privacy_notice (
       id, is_published, title, body, updated_at
     )
     VALUES (1, TRUE, $1, $2, $3)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [notice.title, notice.body, notice.updated_at],
  );
  console.log(result.rowCount
    ? 'Privacy notice copied to PostgreSQL.'
    : 'A PostgreSQL privacy notice already exists; no changes were made.');
}

migratePrivacyNotice()
  .catch((error) => {
    console.error('Privacy notice migration failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
