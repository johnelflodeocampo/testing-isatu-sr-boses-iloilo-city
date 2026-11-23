const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = require('../models/database');
const privacyNoticeStore = require('../lib/privacyNoticeStore');

async function migratePrivacyNotice() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'SELECT title, body, updated_at FROM public.privacy_notice WHERE id = 1',
    );
    const existingFile = await privacyNoticeStore.read();
    if (result.rowCount && !existingFile) {
      await privacyNoticeStore.write(result.rows[0]);
    }
    if (result.rowCount) {
      await client.query('DELETE FROM public.privacy_notice WHERE id = 1');
    }
    await client.query('COMMIT');
    console.log(result.rowCount
      ? 'Privacy notice migrated to notice/notice.txt; the database row was removed.'
      : 'No database privacy notice was found; any existing notice file was preserved.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migratePrivacyNotice().catch((error) => {
  if (error.code === '42P01') {
    console.log('The legacy privacy notice table does not exist; no database data was migrated.');
    pool.end();
    return;
  }
  console.error('Privacy notice migration failed:', error.message);
  process.exitCode = 1;
});
