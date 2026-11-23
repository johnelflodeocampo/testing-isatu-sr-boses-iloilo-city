const crypto = require('node:crypto');

function createPostgresRateLimitStore(pool, secret, namespace) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A PostgreSQL pool is required for shared rate limits.');
  }
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('A 32-character HASH_PEPPER is required for shared rate limits.');
  }
  if (typeof namespace !== 'string' || namespace.length === 0) {
    throw new Error('A unique namespace is required for each shared rate limit.');
  }

  let windowMs;
  let lastCleanupAt = 0;
  let cleanupPromise = null;

  function hashKey(key) {
    return crypto.createHmac('sha256', secret)
      .update(`${namespace}:${key}`)
      .digest('hex');
  }

  async function cleanupExpiredKeys() {
    if (Date.now() - lastCleanupAt < 60_000) return;
    if (!cleanupPromise) {
      cleanupPromise = pool.query(
        'DELETE FROM public.api_rate_limits WHERE expires_at <= now()',
      ).then(() => {
        lastCleanupAt = Date.now();
      }).finally(() => {
        cleanupPromise = null;
      });
    }
    await cleanupPromise;
  }

  return {
    localKeys: false,
    prefix: `${namespace}:`,

    init(options) {
      windowMs = options.windowMs;
    },

    async increment(key) {
      if (!Number.isFinite(windowMs) || windowMs <= 0) {
        throw new Error('The PostgreSQL rate-limit store has not been initialized.');
      }
      await cleanupExpiredKeys();
      const result = await pool.query(
        `INSERT INTO public.api_rate_limits AS current_limit (
           key_hash, hit_count, expires_at
         )
         VALUES (
           $1,
           1,
           now() + ($2::double precision * interval '1 millisecond')
         )
         ON CONFLICT (key_hash) DO UPDATE
         SET hit_count = CASE
               WHEN current_limit.expires_at <= now() THEN 1
               ELSE current_limit.hit_count + 1
             END,
             expires_at = CASE
               WHEN current_limit.expires_at <= now()
                 THEN now() + ($2::double precision * interval '1 millisecond')
               ELSE current_limit.expires_at
             END
         RETURNING hit_count, expires_at`,
        [hashKey(key), windowMs],
      );
      return {
        totalHits: Number(result.rows[0].hit_count),
        resetTime: new Date(result.rows[0].expires_at),
      };
    },

    async decrement(key) {
      await pool.query(
        `UPDATE public.api_rate_limits
         SET hit_count = GREATEST(0, hit_count - 1)
         WHERE key_hash = $1`,
        [hashKey(key)],
      );
    },

    async resetKey(key) {
      await pool.query(
        'DELETE FROM public.api_rate_limits WHERE key_hash = $1',
        [hashKey(key)],
      );
    },
  };
}

module.exports = createPostgresRateLimitStore;
