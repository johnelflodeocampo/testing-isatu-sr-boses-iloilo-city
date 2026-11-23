const legacyFileStore = require('./privacyNoticeStore');

function createPostgresPrivacyNoticeStore(pool, { legacyStore = legacyFileStore } = {}) {
  async function read() {
    const result = await pool.query(
      `SELECT is_published, title, body, updated_at
       FROM public.site_privacy_notice
       WHERE id = 1`,
    );
    if (result.rowCount) {
      const notice = result.rows[0];
      return notice.is_published ? notice : null;
    }
    return legacyStore.read();
  }

  async function write(notice) {
    const result = await pool.query(
      `INSERT INTO public.site_privacy_notice (
         id, is_published, title, body, updated_at
       )
       VALUES (1, TRUE, $1, $2, $3)
       ON CONFLICT (id) DO UPDATE
       SET is_published = TRUE,
           title = EXCLUDED.title,
           body = EXCLUDED.body,
           updated_at = EXCLUDED.updated_at
       RETURNING is_published, title, body, updated_at`,
      [notice.title, notice.body, notice.updated_at],
    );
    return result.rows[0];
  }

  async function create(notice) {
    if (await read()) return null;
    const result = await pool.query(
      `INSERT INTO public.site_privacy_notice (
         id, is_published, title, body, updated_at
       )
       VALUES (1, TRUE, $1, $2, $3)
       ON CONFLICT (id) DO NOTHING
       RETURNING is_published, title, body, updated_at`,
      [notice.title, notice.body, notice.updated_at],
    );
    return result.rows[0] || null;
  }

  async function remove() {
    if (!(await read())) return false;
    await pool.query(
      `INSERT INTO public.site_privacy_notice (
         id, is_published, title, body, updated_at
       )
       VALUES (1, FALSE, NULL, NULL, now())
       ON CONFLICT (id) DO UPDATE
       SET is_published = FALSE,
           title = NULL,
           body = NULL,
           updated_at = now()`,
    );
    return true;
  }

  return { read, write, create, remove };
}

module.exports = createPostgresPrivacyNoticeStore;
