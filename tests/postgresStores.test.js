const test = require('node:test');
const assert = require('node:assert/strict');
const createPostgresPrivacyNoticeStore = require('../lib/postgresPrivacyNoticeStore');
const createPostgresRateLimitStore = require('../utils/postgresRateLimitStore');

function createPrivacyNoticePool() {
  const rows = new Map();
  return {
    rows,
    async query(sql, values = []) {
      if (sql.includes('SELECT is_published')) {
        const row = rows.get(1);
        return { rowCount: row ? 1 : 0, rows: row ? [{ ...row }] : [] };
      }
      if (sql.includes('ON CONFLICT (id) DO NOTHING')) {
        if (rows.has(1)) return { rowCount: 0, rows: [] };
        const row = {
          id: 1,
          is_published: true,
          title: values[0],
          body: values[1],
          updated_at: values[2],
        };
        rows.set(1, row);
        return { rowCount: 1, rows: [{ ...row }] };
      }
      if (sql.includes('VALUES (1, FALSE')) {
        rows.set(1, {
          id: 1,
          is_published: false,
          title: null,
          body: null,
          updated_at: new Date(),
        });
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('ON CONFLICT (id) DO UPDATE')) {
        const row = {
          id: 1,
          is_published: true,
          title: values[0],
          body: values[1],
          updated_at: values[2],
        };
        rows.set(1, row);
        return { rowCount: 1, rows: [{ ...row }] };
      }
      throw new Error(`Unexpected privacy notice query: ${sql}`);
    },
  };
}

test('privacy notice persists in PostgreSQL and a deletion hides the bundled fallback', async () => {
  const pool = createPrivacyNoticePool();
  const store = createPostgresPrivacyNoticeStore(pool, {
    legacyStore: { read: async () => ({ title: 'Bundled', body: '<p>Legacy</p>' }) },
  });
  assert.equal((await store.read()).title, 'Bundled');
  const updated = await store.write({
    title: 'Privacy',
    body: '<p>Current</p>',
    updated_at: '2026-11-24T00:00:00.000Z',
  });
  assert.equal(updated.title, 'Privacy');
  assert.equal((await store.read()).body, '<p>Current</p>');
  assert.equal(await store.create({
    title: 'Duplicate',
    body: '<p>Duplicate</p>',
    updated_at: '2026-11-24T00:00:00.000Z',
  }), null);

  assert.equal(await store.remove(), true);
  assert.equal(await store.read(), null);
});

test('privacy notice can be created once when no legacy notice exists', async () => {
  const store = createPostgresPrivacyNoticeStore(createPrivacyNoticePool(), {
    legacyStore: { read: async () => null },
  });
  const notice = {
    title: 'Privacy',
    body: '<p>Notice</p>',
    updated_at: '2026-11-24T00:00:00.000Z',
  };

  assert.equal((await store.create(notice)).title, 'Privacy');
  assert.equal(await store.create(notice), null);
});

test('PostgreSQL rate limits hash client keys and honor each configured window', async () => {
  const rows = new Map();
  const calls = [];
  const pool = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('INSERT INTO public.api_rate_limits')) {
        const [keyHash, windowMs] = values;
        const existing = rows.get(keyHash);
        const expired = existing && existing.resetTime.getTime() <= Date.now();
        const row = {
          hit_count: expired ? 1 : (existing?.hit_count || 0) + 1,
          expires_at: expired || !existing
            ? new Date(Date.now() + windowMs)
            : existing.resetTime,
        };
        rows.set(keyHash, { hit_count: row.hit_count, resetTime: row.expires_at });
        return { rowCount: 1, rows: [row] };
      }
      if (sql.startsWith('UPDATE public.api_rate_limits')) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.startsWith('DELETE FROM public.api_rate_limits WHERE key_hash')) {
        rows.delete(values[0]);
        return { rowCount: 1, rows: [] };
      }
      if (sql.startsWith('DELETE FROM public.api_rate_limits WHERE expires_at')) {
        return { rowCount: 0, rows: [] };
      }
      throw new Error(`Unexpected rate-limit query: ${sql}`);
    },
  };
  const store = createPostgresRateLimitStore(
    pool,
    'test-hash-pepper-with-at-least-thirty-two-characters',
    'test',
  );
  store.init({ windowMs: 30_000 });

  const first = await store.increment('203.0.113.42');
  const second = await store.increment('203.0.113.42');
  const keyHash = calls.find((call) =>
    call.sql.includes('INSERT INTO public.api_rate_limits')).values[0];

  assert.equal(first.totalHits, 1);
  assert.equal(second.totalHits, 2);
  assert.equal(first.resetTime.getTime(), second.resetTime.getTime());
  assert.match(keyHash, /^[0-9a-f]{64}$/);
  assert.notEqual(keyHash, '203.0.113.42');
});
