const crypto = require('node:crypto');

const maxAttempts = 5;
const resendCooldownSeconds = 60;

class LoginOtpCooldownError extends Error {
  constructor(retryAfterSeconds) {
    super('A sign-in code was recently sent to this email address.');
    this.name = 'LoginOtpCooldownError';
    this.status = 429;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function hashOtp(email, token, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${email}:${token}`, 'utf8')
    .digest('hex');
}

function matchesHash(storedHash, candidateHash) {
  if (!/^[0-9a-f]{64}$/.test(storedHash)) return false;
  return crypto.timingSafeEqual(
    Buffer.from(storedHash, 'hex'),
    Buffer.from(candidateHash, 'hex'),
  );
}

function createLoginOtp({ pool, secret, sendEmail, randomInt = crypto.randomInt, randomUUID = crypto.randomUUID }) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A PostgreSQL pool is required for login OTPs.');
  }
  if (!secret) throw new Error('JWT_SECRET is required to protect login OTPs.');
  if (typeof sendEmail !== 'function') {
    throw new TypeError('A GAS email sender is required for login OTPs.');
  }

  return {
    async request(email) {
      await pool.query(
        'DELETE FROM private_vault.login_otp_challenges WHERE expires_at <= now()',
      );

      const challengeId = randomUUID();
      const token = String(randomInt(0, 1000000)).padStart(6, '0');
      const codeHash = hashOtp(email, token, secret);
      const result = await pool.query(
        `INSERT INTO private_vault.login_otp_challenges AS current_challenge (
           email, challenge_id, code_hash, created_at, expires_at, last_sent_at, attempts
         )
         VALUES ($1, $2, $3, now(), now() + interval '10 minutes', now(), 0)
         ON CONFLICT (email) DO UPDATE
         SET challenge_id = EXCLUDED.challenge_id,
             code_hash = EXCLUDED.code_hash,
             created_at = now(),
             expires_at = now() + interval '10 minutes',
             last_sent_at = now(),
             attempts = 0
         WHERE current_challenge.last_sent_at <= now() - ($4 * interval '1 second')
         RETURNING challenge_id`,
        [email, challengeId, codeHash, resendCooldownSeconds],
      );
      if (result.rowCount === 0) {
        const cooldown = await pool.query(
          `SELECT GREATEST(
             1,
             CEIL(EXTRACT(EPOCH FROM (
               last_sent_at + ($2 * interval '1 second') - now()
             )))::int
           ) AS retry_after_seconds
           FROM private_vault.login_otp_challenges
           WHERE email = $1`,
          [email, resendCooldownSeconds],
        );
        throw new LoginOtpCooldownError(
          cooldown.rows[0]?.retry_after_seconds ?? 1,
        );
      }

      try {
        await sendEmail(email, token);
      } catch (error) {
        try {
          await pool.query(
            `DELETE FROM private_vault.login_otp_challenges
             WHERE email = $1 AND challenge_id = $2`,
            [email, challengeId],
          );
        } catch (cleanupError) {
          console.error('Failed to clear an unsent login OTP challenge:', cleanupError.message);
        }
        throw error;
      }
      return { sent: true, resendAfterSeconds: resendCooldownSeconds };
    },

    async verify(email, token) {
      const result = await pool.query(
        `SELECT challenge_id, code_hash, attempts
         FROM private_vault.login_otp_challenges
         WHERE email = $1
           AND expires_at > now()
           AND attempts < $2`,
        [email, maxAttempts],
      );
      const challenge = result.rows[0];
      if (!challenge) return false;

      const candidateHash = hashOtp(email, token, secret);
      if (!matchesHash(challenge.code_hash, candidateHash)) {
        await pool.query(
          `UPDATE private_vault.login_otp_challenges
           SET attempts = attempts + 1
           WHERE email = $1
             AND challenge_id = $2
             AND attempts < $3
             AND expires_at > now()`,
          [email, challenge.challenge_id, maxAttempts],
        );
        return false;
      }

      const consumed = await pool.query(
        `DELETE FROM private_vault.login_otp_challenges
         WHERE email = $1
           AND challenge_id = $2
           AND code_hash = $3
           AND attempts < $4
           AND expires_at > now()
         RETURNING email`,
        [email, challenge.challenge_id, challenge.code_hash, maxAttempts],
      );
      return consumed.rowCount === 1;
    },
  };
}

module.exports = createLoginOtp;
