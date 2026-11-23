const test = require('node:test');
const assert = require('node:assert/strict');
const createLoginOtp = require('../utils/loginOtp');

function createMemoryPool(clock) {
  const challenges = new Map();
  return {
    challenges,
    async query(sql, parameters = []) {
      if (sql.includes('DELETE FROM private_vault.login_otp_challenges WHERE expires_at <= now()')) {
        for (const [email, challenge] of challenges) {
          if (challenge.expiresAt <= clock.now) challenges.delete(email);
        }
        return { rowCount: 0, rows: [] };
      }

      if (sql.includes('SELECT GREATEST(')) {
        const [email, cooldownSeconds] = parameters;
        const challenge = challenges.get(email);
        if (!challenge) return { rowCount: 0, rows: [] };
        return {
          rowCount: 1,
          rows: [{
            retry_after_seconds: Math.max(
              1,
              Math.ceil((challenge.lastSentAt + cooldownSeconds * 1000 - clock.now) / 1000),
            ),
          }],
        };
      }

      if (sql.includes('INSERT INTO private_vault.login_otp_challenges')) {
        const [email, challengeId, codeHash, cooldownSeconds] = parameters;
        const previous = challenges.get(email);
        if (previous && previous.lastSentAt > clock.now - cooldownSeconds * 1000) {
          return { rowCount: 0, rows: [] };
        }
        challenges.set(email, {
          challengeId,
          codeHash,
          createdAt: clock.now,
          expiresAt: clock.now + 10 * 60 * 1000,
          lastSentAt: clock.now,
          attempts: 0,
        });
        return { rowCount: 1, rows: [{ challenge_id: challengeId }] };
      }

      const [email, challengeIdOrAttempts, codeHashOrMax] = parameters;
      const challenge = challenges.get(email);
      if (sql.includes('SELECT challenge_id, code_hash, attempts')) {
        if (!challenge || challenge.expiresAt <= clock.now || challenge.attempts >= challengeIdOrAttempts) {
          return { rowCount: 0, rows: [] };
        }
        return {
          rowCount: 1,
          rows: [{
            challenge_id: challenge.challengeId,
            code_hash: challenge.codeHash,
            attempts: challenge.attempts,
          }],
        };
      }

      if (sql.includes('UPDATE private_vault.login_otp_challenges')) {
        if (challenge
          && challenge.challengeId === challengeIdOrAttempts
          && challenge.attempts < codeHashOrMax
          && challenge.expiresAt > clock.now) {
          challenge.attempts += 1;
          return { rowCount: 1, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      }

      if (sql.includes('DELETE FROM private_vault.login_otp_challenges')
        && sql.includes('challenge_id = $2')
        && !sql.includes('code_hash = $3')) {
        const [email, challengeId] = parameters;
        const challenge = challenges.get(email);
        if (challenge && challenge.challengeId === challengeId) {
          challenges.delete(email);
          return { rowCount: 1, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      }

      if (sql.includes('DELETE FROM private_vault.login_otp_challenges')) {
        const [challengeId, codeHash, maxAttempts] = parameters.slice(1);
        if (challenge
          && challenge.challengeId === challengeId
          && challenge.codeHash === codeHash
          && challenge.attempts < maxAttempts
          && challenge.expiresAt > clock.now) {
          challenges.delete(email);
          return { rowCount: 1, rows: [{ email }] };
        }
        return { rowCount: 0, rows: [] };
      }

      throw new Error(`Unexpected SQL in login OTP test: ${sql}`);
    },
  };
}

test('login OTP stores a keyed hash and consumes the code after successful verification', async () => {
  const clock = { now: 1_800_000_000_000 };
  const pool = createMemoryPool(clock);
  const sent = [];
  const otp = createLoginOtp({
    pool,
    secret: 'test-secret',
    randomInt: () => 42,
    randomUUID: () => 'challenge-one',
    sendEmail: async (email, token) => sent.push({ email, token }),
  });

  const result = await otp.request('student@students.isatu.edu.ph');
  const stored = pool.challenges.get('student@students.isatu.edu.ph');
  assert.deepEqual(result, { sent: true, resendAfterSeconds: 60 });
  assert.deepEqual(sent, [{
    email: 'student@students.isatu.edu.ph',
    token: '000042',
  }]);
  assert.match(stored.codeHash, /^[0-9a-f]{64}$/);
  assert.notEqual(stored.codeHash, sent[0].token);
  assert.equal(await otp.verify('student@students.isatu.edu.ph', '000042'), true);
  assert.equal(await otp.verify('student@students.isatu.edu.ph', '000042'), false);
});

test('login OTP rotates after the email cooldown and rejects the previous code', async () => {
  const clock = { now: 1_800_000_000_000 };
  const pool = createMemoryPool(clock);
  const tokens = [123456, 111111, 222222, 654321];
  const sent = [];
  let challengeNumber = 0;
  let tokenNumber = 0;
  const otp = createLoginOtp({
    pool,
    secret: 'test-secret',
    randomInt: () => tokens[tokenNumber++],
    randomUUID: () => `challenge-${++challengeNumber}`,
    sendEmail: async (email, token) => sent.push({ email, token }),
  });

  await otp.request('student@students.isatu.edu.ph');
  await assert.rejects(
    otp.request('student@students.isatu.edu.ph'),
    (error) => {
      assert.equal(error.status, 429);
      assert.equal(error.retryAfterSeconds, 60);
      return true;
    },
  );
  clock.now += 35000;
  await assert.rejects(
    otp.request('student@students.isatu.edu.ph'),
    (error) => {
      assert.equal(error.status, 429);
      assert.equal(error.retryAfterSeconds, 25);
      return true;
    },
  );
  clock.now += 25001;
  await otp.request('student@students.isatu.edu.ph');

  assert.deepEqual(sent.map((item) => item.token), ['123456', '654321']);
  assert.equal(await otp.verify('student@students.isatu.edu.ph', '123456'), false);
  assert.equal(await otp.verify('student@students.isatu.edu.ph', '654321'), true);
});

test('a failed email send clears the unsent challenge so the user can retry', async () => {
  const clock = { now: 1_800_000_000_000 };
  const pool = createMemoryPool(clock);
  let sendAttempts = 0;
  let challengeNumber = 0;
  const otp = createLoginOtp({
    pool,
    secret: 'test-secret',
    randomInt: () => 123456,
    randomUUID: () => `challenge-${++challengeNumber}`,
    sendEmail: async () => {
      sendAttempts += 1;
      if (sendAttempts === 1) throw new Error('GAS unavailable');
    },
  });

  await assert.rejects(otp.request('student@students.isatu.edu.ph'), /GAS unavailable/);
  assert.equal(pool.challenges.has('student@students.isatu.edu.ph'), false);
  await assert.doesNotReject(otp.request('student@students.isatu.edu.ph'));
});

test('login OTP locks after five invalid attempts and is scoped to its email', async () => {
  const clock = { now: 1_800_000_000_000 };
  const pool = createMemoryPool(clock);
  const otp = createLoginOtp({
    pool,
    secret: 'test-secret',
    randomInt: () => 987654,
    randomUUID: () => 'challenge-three',
    sendEmail: async () => {},
  });

  await otp.request('student@students.isatu.edu.ph');
  assert.equal(await otp.verify('other@students.isatu.edu.ph', '987654'), false);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(await otp.verify('student@students.isatu.edu.ph', '111111'), false);
  }
  assert.equal(await otp.verify('student@students.isatu.edu.ph', '987654'), false);
});
