const test = require('node:test');
const assert = require('node:assert/strict');
const createGasApiClient = require('../utils/gasApi');

test('login OTP requests use the shared-secret format for both ISAT U email domains', async (t) => {
  const originalUrl = process.env.GAS_API_URL;
  const originalSecret = process.env.GAS_API_SECRET;
  process.env.GAS_API_URL = 'https://script.google.com/macros/s/test-deployment/exec';
  process.env.GAS_API_SECRET = 'test-secret-with-at-least-thirty-two-characters';
  t.after(() => {
    if (originalUrl === undefined) delete process.env.GAS_API_URL;
    else process.env.GAS_API_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.GAS_API_SECRET;
    else process.env.GAS_API_SECRET = originalSecret;
  });

  const calls = [];
  const client = createGasApiClient(
    { query: async () => { throw new Error('OTP sends must not query officer recipients.'); } },
    {
      now: () => 1_800_000_000_000,
      randomBytes: () => Buffer.alloc(16, 1),
      fetchImpl: async (url, options) => {
        calls.push({ url: String(url), options });
        return {
          ok: true,
          text: async () => JSON.stringify({ ok: true, sent: 1 }),
        };
      },
    },
  );

  for (const [email, normalizedEmail] of [
    ['Student@Students.ISATU.edu.ph', 'student@students.isatu.edu.ph'],
    ['Member@ISATU.edu.ph', 'member@isatu.edu.ph'],
  ]) {
    await client.sendLoginOtp(email, '012345');
    const call = calls[calls.length - 1];
    const envelope = JSON.parse(call.options.body);
    const payload = JSON.parse(envelope.payload);
    assert.equal(call.url, process.env.GAS_API_URL);
    assert.equal(envelope.secret, process.env.GAS_API_SECRET);
    assert.match(envelope.timestamp, /^\d{10}$/);
    assert.match(envelope.nonce, /^[0-9a-f]{32}$/);
    assert.deepEqual(payload, {
      event: 'login_otp',
      email: normalizedEmail,
      otp: '012345',
    });
  }
});

test('login OTP sender rejects non-university addresses and malformed codes', async (t) => {
  const originalUrl = process.env.GAS_API_URL;
  const originalSecret = process.env.GAS_API_SECRET;
  process.env.GAS_API_URL = 'https://script.google.com/macros/s/test-deployment/exec';
  process.env.GAS_API_SECRET = 'test-secret-with-at-least-thirty-two-characters';
  t.after(() => {
    if (originalUrl === undefined) delete process.env.GAS_API_URL;
    else process.env.GAS_API_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.GAS_API_SECRET;
    else process.env.GAS_API_SECRET = originalSecret;
  });

  const client = createGasApiClient({}, {
    fetchImpl: async () => {
      throw new Error('Invalid inputs must not be sent.');
    },
  });

  await assert.rejects(client.sendLoginOtp('user@example.com', '123456'), /invalid/i);
  await assert.rejects(client.sendLoginOtp('user@isatu.edu.ph', '123'), /invalid/i);
});

test('GAS authorization failures point to the secret and deployment settings', async (t) => {
  const originalUrl = process.env.GAS_API_URL;
  const originalSecret = process.env.GAS_API_SECRET;
  process.env.GAS_API_URL = 'https://script.google.com/macros/s/test-deployment/exec';
  process.env.GAS_API_SECRET = 'test-secret-with-at-least-thirty-two-characters';
  t.after(() => {
    if (originalUrl === undefined) delete process.env.GAS_API_URL;
    else process.env.GAS_API_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.GAS_API_SECRET;
    else process.env.GAS_API_SECRET = originalSecret;
  });

  const client = createGasApiClient({}, {
    fetchImpl: async () => ({
      ok: true,
      text: async () => JSON.stringify({ ok: false, error: 'Unauthorized request.' }),
    }),
  });

  await assert.rejects(
    client.sendLoginOtp('user@students.isatu.edu.ph', '123456'),
    /GAS_API_SECRET.*Script Property.*GAS_API_URL.*current deployment/,
  );
});

test('test email requests use the shared-secret format and target ISAT U addresses', async (t) => {
  const originalUrl = process.env.GAS_API_URL;
  const originalSecret = process.env.GAS_API_SECRET;
  process.env.GAS_API_URL = 'https://script.google.com/macros/s/test-deployment/exec';
  process.env.GAS_API_SECRET = 'test-secret-with-at-least-thirty-two-characters';
  t.after(() => {
    if (originalUrl === undefined) delete process.env.GAS_API_URL;
    else process.env.GAS_API_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.GAS_API_SECRET;
    else process.env.GAS_API_SECRET = originalSecret;
  });

  let requestBody;
  const client = createGasApiClient({}, {
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        text: async () => JSON.stringify({ ok: true, sent: 1 }),
      };
    },
  });

  await client.sendTestEmail('Student@Students.ISATU.edu.ph');
  assert.deepEqual(JSON.parse(requestBody.payload), {
    event: 'test_email',
    email: 'student@students.isatu.edu.ph',
  });
  assert.equal(requestBody.secret, process.env.GAS_API_SECRET);
  assert.match(requestBody.timestamp, /^\d{10}$/);
  assert.match(requestBody.nonce, /^[0-9a-f]{32}$/);
  await assert.rejects(
    client.sendTestEmail('user@example.com'),
    /must be an ISAT U email address/,
  );
});

test('GAS authorization check sends an authenticated no-email diagnostic event', async (t) => {
  const originalUrl = process.env.GAS_API_URL;
  const originalSecret = process.env.GAS_API_SECRET;
  process.env.GAS_API_URL = 'https://script.google.com/macros/s/test-deployment/exec';
  process.env.GAS_API_SECRET = 'test-secret-with-at-least-thirty-two-characters';
  t.after(() => {
    if (originalUrl === undefined) delete process.env.GAS_API_URL;
    else process.env.GAS_API_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.GAS_API_SECRET;
    else process.env.GAS_API_SECRET = originalSecret;
  });

  let requestPayload;
  const client = createGasApiClient({}, {
    fetchImpl: async (_url, options) => {
      requestPayload = JSON.parse(options.body);
      return {
        ok: true,
        text: async () => JSON.stringify({ ok: true, authorized: true }),
      };
    },
  });

  await client.checkAuthorization();
  assert.deepEqual(JSON.parse(requestPayload.payload), { event: 'auth_check' });
  assert.equal(requestPayload.secret, process.env.GAS_API_SECRET);
});

test('GAS authorization check identifies an outdated deployment', async (t) => {
  const originalUrl = process.env.GAS_API_URL;
  const originalSecret = process.env.GAS_API_SECRET;
  process.env.GAS_API_URL = 'https://script.google.com/macros/s/test-deployment/exec';
  process.env.GAS_API_SECRET = 'test-secret-with-at-least-thirty-two-characters';
  t.after(() => {
    if (originalUrl === undefined) delete process.env.GAS_API_URL;
    else process.env.GAS_API_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.GAS_API_SECRET;
    else process.env.GAS_API_SECRET = originalSecret;
  });

  const client = createGasApiClient({}, {
    fetchImpl: async () => ({
      ok: true,
      text: async () => JSON.stringify({ ok: false, error: 'Invalid email payload.' }),
    }),
  });

  await assert.rejects(client.checkAuthorization(), /GAS deployment is outdated/);
});
