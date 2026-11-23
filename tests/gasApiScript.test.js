const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createGasSandbox() {
  const secret = 'test-secret-with-at-least-thirty-two-characters';
  const sentEmails = [];
  const nonces = new Set();
  const sandbox = {
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => secret }),
    },
    MailApp: {
      getRemainingDailyQuota: () => 10,
      sendEmail: (message) => sentEmails.push(message),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (key) => nonces.has(key) ? '1' : null,
        put: (key) => nonces.add(key),
      }),
    },
    LockService: {
      getScriptLock: () => ({ waitLock() {}, releaseLock() {} }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (content) => ({
        content,
        setMimeType() { return this; },
      }),
    },
    console: { error() {} },
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'gas_api.gs'), 'utf8');
  vm.runInNewContext(source, sandbox);
  return { sandbox, secret, sentEmails };
}

function signPayload(secret, payload, nonce = 'a'.repeat(32)) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const payloadJson = JSON.stringify(payload);
  return {
    postData: {
      contents: JSON.stringify({ secret, timestamp, nonce, payload: payloadJson }),
    },
  };
}

test('GAS API provides a browser GET health check', () => {
  const { sandbox } = createGasSandbox();

  const response = sandbox.doGet();

  assert.deepEqual(JSON.parse(response.content), {
    ok: true,
    service: 'ISAT U BOSES email API',
  });
});

test('GAS API verifies an authenticated check without sending email', () => {
  const { sandbox, secret, sentEmails } = createGasSandbox();

  const response = sandbox.doPost(signPayload(secret, { event: 'auth_check' }));

  assert.deepEqual(JSON.parse(response.content), { ok: true, authorized: true });
  assert.equal(sentEmails.length, 0);
});

test('GAS API rejects an incorrect shared secret', () => {
  const { sandbox, secret, sentEmails } = createGasSandbox();
  const request = signPayload(secret, { event: 'auth_check' });
  const envelope = JSON.parse(request.postData.contents);
  envelope.secret = 'incorrect-secret';
  request.postData.contents = JSON.stringify(envelope);

  const response = sandbox.doPost(request);

  assert.deepEqual(JSON.parse(response.content), {
    ok: false,
    error: 'Unauthorized request.',
  });
  assert.equal(sentEmails.length, 0);
});

test('GAS API accepts an object payload', () => {
  const { sandbox, secret, sentEmails } = createGasSandbox();
  const request = signPayload(secret, { event: 'auth_check' });
  const envelope = JSON.parse(request.postData.contents);
  envelope.payload = JSON.parse(envelope.payload);
  request.postData.contents = JSON.stringify(envelope);

  const response = sandbox.doPost(request);

  assert.deepEqual(JSON.parse(response.content), { ok: true, authorized: true });
  assert.equal(sentEmails.length, 0);
});

test('GAS API sends authenticated login OTPs to both ISAT U email domains', () => {
  const { sandbox, secret, sentEmails } = createGasSandbox();
  for (const [email, nonce] of [
    ['student@students.isatu.edu.ph', 'b'.repeat(32)],
    ['member@isatu.edu.ph', 'c'.repeat(32)],
  ]) {
    const response = sandbox.doPost(signPayload(secret, {
      event: 'login_otp',
      email,
      otp: '012345',
    }, nonce));
    assert.deepEqual(JSON.parse(response.content), { ok: true, sent: 1 });
  }

  assert.equal(sentEmails.length, 2);
  assert.equal(sentEmails[0].to, 'student@students.isatu.edu.ph');
  assert.equal(sentEmails[1].to, 'member@isatu.edu.ph');
  assert.match(sentEmails[0].body, /012345/);
  assert.match(sentEmails[0].body, /expires in 10 minutes/i);
});

test('GAS API sends a test email only to a valid ISAT U address', () => {
  const { sandbox, secret, sentEmails } = createGasSandbox();
  const response = sandbox.doPost(signPayload(secret, {
    event: 'test_email',
    email: 'student@students.isatu.edu.ph',
  }));

  assert.deepEqual(JSON.parse(response.content), { ok: true, sent: 1 });
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, 'student@students.isatu.edu.ph');
  assert.equal(sentEmails[0].subject, 'ISAT U BOSES email delivery test');
  assert.match(sentEmails[0].body, /email delivery is configured/i);

  const invalid = sandbox.doPost(signPayload(secret, {
    event: 'test_email',
    email: 'user@example.com',
  }, 'c'.repeat(32)));
  assert.deepEqual(JSON.parse(invalid.content), {
    ok: false,
    error: 'Invalid email payload.',
  });
  assert.equal(sentEmails.length, 1);
});

test('GAS API rejects non-ISAT U login addresses and replayed requests', () => {
  const { sandbox, secret, sentEmails } = createGasSandbox();
  const invalid = sandbox.doPost(signPayload(secret, {
    event: 'login_otp',
    email: 'student@example.com',
    otp: '012345',
  }));
  assert.deepEqual(JSON.parse(invalid.content), {
    ok: false,
    error: 'Invalid email payload.',
  });
  assert.equal(sentEmails.length, 0);

  const validEvent = signPayload(secret, {
    event: 'login_otp',
    email: 'student@students.isatu.edu.ph',
    otp: '012345',
  }, 'b'.repeat(32));
  sandbox.doPost(validEvent);
  const replay = sandbox.doPost(validEvent);
  assert.deepEqual(JSON.parse(replay.content), {
    ok: false,
    error: 'Request has already been processed.',
  });
  assert.equal(sentEmails.length, 1);
});
