const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const createPageController = require('../controllers/pageController');
const {
  normalizeOfficerEmail,
  normalizeStudentEmail,
} = require('../utils/isatuEmail');

function passThrough(request, response, next) {
  next();
}

function createDependencies(overrides = {}) {
  const dependencies = {
    path: require('node:path'),
    privateDirectory: require('node:path').resolve(__dirname, '..', 'private'),
    publicDirectory: require('node:path').resolve(__dirname, '..', 'public'),
    pool: {
      query: async () => ({ rowCount: 1, rows: [{ role: 'admin' }] }),
    },
    reportModel: {},
    loginOtp: {
      request: async () => ({ sent: true }),
      verify: async () => true,
    },
    sendPrivatePage: (fileName, response) => response.sendFile(fileName),
    sendPrivateScript: (fileName, response) => response.sendFile(fileName),
    normalizeOfficerEmail,
    normalizeStudentEmail,
    getIdentityTag: (email) => email,
    isIdentityBanned: async () => false,
    setSession: (response, email, role) => {
      response.cookie('test-session', `${email}:${role}`);
    },
    clearSession: () => {},
    readSession: () => null,
    isAdminRole: (role) => ['admin', 'superadmin'].includes(role),
    validateAdminSession: async () => true,
    requireSession: () => passThrough,
    requirePageSession: () => passThrough,
    requireBrowserRequest: passThrough,
    handleDatabaseError: (error, response) => response.status(500).json({ error: error.message }),
    otpRequestLimiter: passThrough,
    otpVerifyLimiter: passThrough,
    submissionLimiter: passThrough,
    messageLimiter: passThrough,
    sessionCookie: 'boses_user_session',
    sessionCookieOptions: {},
  };
  return { ...dependencies, ...overrides };
}

async function withServer(t, dependencies, run) {
  const app = express();
  app.use(express.json());
  app.use(createPageController(dependencies));
  const server = app.listen(0);
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const { port } = server.address();
  return run(`http://127.0.0.1:${port}`);
}

async function postJson(baseUrl, route, payload) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'BOSES-Client',
    },
    body: JSON.stringify(payload),
  });
  return { response, body: await response.json() };
}

test('student OTP requests accept both ISAT U domains and reject other domains', async (t) => {
  const sentEmails = [];
  const dependencies = createDependencies({
    loginOtp: {
      request: async (email) => {
        sentEmails.push(email);
        return { sent: true, resendAfterSeconds: 60 };
      },
      verify: async () => true,
    },
  });

  await withServer(t, dependencies, async (baseUrl) => {
    const invalid = await postJson(baseUrl, '/api/auth/otp/request', {
      email: 'student@gmail.com',
      role: 'student',
    });
    assert.equal(invalid.response.status, 400);
    assert.deepEqual(sentEmails, []);

    const forgedRole = await postJson(baseUrl, '/api/auth/otp/request', {
      email: 'member@isatu.edu.ph',
      role: 'superadmin',
    });
    assert.equal(forgedRole.response.status, 400);
    assert.deepEqual(sentEmails, []);

    for (const [email, normalizedEmail] of [
      [' Student@Students.ISATU.edu.ph ', 'student@students.isatu.edu.ph'],
      [' Member@ISATU.edu.ph ', 'member@isatu.edu.ph'],
    ]) {
      const valid = await postJson(baseUrl, '/api/auth/otp/request', {
        email,
        role: 'student',
      });
      assert.equal(valid.response.status, 200);
      assert.equal(valid.body.sent, true);
      assert.equal(valid.body.resendAfterSeconds, 60);
      assert.equal(sentEmails[sentEmails.length - 1], normalizedEmail);
    }
  });
});

test('OTP cooldown response includes the remaining resend delay', async (t) => {
  const dependencies = createDependencies({
    loginOtp: {
      request: async () => {
        const error = new Error('cooldown');
        error.status = 429;
        error.retryAfterSeconds = 37;
        throw error;
      },
      verify: async () => true,
    },
  });

  await withServer(t, dependencies, async (baseUrl) => {
    const result = await postJson(baseUrl, '/api/auth/otp/request', {
      email: 'student@students.isatu.edu.ph',
      role: 'student',
    });
    assert.equal(result.response.status, 429);
    assert.equal(result.response.headers.get('retry-after'), '37');
    assert.equal(result.body.retryAfterSeconds, 37);
  });
});

test('officer OTP requests require the allowlist for either ISAT U domain', async (t) => {
  let sentEmail = null;
  const dependencies = createDependencies({
    pool: {
      query: async () => ({ rowCount: 0, rows: [] }),
    },
    loginOtp: {
      request: async (email) => {
        sentEmail = email;
        return { sent: true };
      },
      verify: async () => true,
    },
  });

  await withServer(t, dependencies, async (baseUrl) => {
    for (const email of [
      'officer@gmail.com',
      'officer@isatu.edu.ph',
      'officer@students.isatu.edu.ph',
    ]) {
      const result = await postJson(baseUrl, '/api/auth/otp/request', {
        email,
        role: 'officer',
      });
      assert.equal(result.response.status, email.endsWith('@gmail.com') ? 400 : 403);
    }
    assert.equal(sentEmail, null);
  });
});

test('allowlisted officer can request and verify a code with a student-domain email', async (t) => {
  let sentEmail = null;
  let session = null;
  const dependencies = createDependencies({
    loginOtp: {
      request: async (email) => {
        sentEmail = email;
        return { sent: true, resendAfterSeconds: 60 };
      },
      verify: async (email, token) => email === sentEmail && token === '123456',
    },
    setSession: (_response, email, role) => { session = { email, role }; },
  });

  await withServer(t, dependencies, async (baseUrl) => {
    const request = await postJson(baseUrl, '/api/auth/otp/request', {
      email: ' Officer@Students.ISATU.edu.ph ',
      role: 'officer',
    });
    assert.equal(request.response.status, 200);
    assert.equal(sentEmail, 'officer@students.isatu.edu.ph');

    const verification = await postJson(baseUrl, '/api/auth/otp/verify', {
      email: sentEmail,
      role: 'officer',
      token: '123456',
    });
    assert.equal(verification.response.status, 200);
    assert.deepEqual(session, { email: sentEmail, role: 'admin' });
  });
});

test('verified student OTP issues a BOSES session for either ISAT U email domain', async (t) => {
  let session = null;
  const dependencies = createDependencies({
    loginOtp: {
      request: async () => ({ sent: true }),
      verify: async () => true,
    },
    setSession: (_response, email, role) => { session = { email, role }; },
  });

  await withServer(t, dependencies, async (baseUrl) => {
    for (const email of ['student@students.isatu.edu.ph', 'member@isatu.edu.ph']) {
      const result = await postJson(baseUrl, '/api/auth/otp/verify', {
        email,
        role: 'student',
        token: '123456',
      });
      assert.equal(result.response.status, 200);
      assert.equal(result.body.signedIn, true);
      assert.deepEqual(session, { email, role: 'user' });
    }
  });
});

test('verification rejects malformed codes and an invalid OTP', async (t) => {
  let verificationCalls = 0;
  const dependencies = createDependencies({
    loginOtp: {
      request: async () => ({ sent: true }),
      verify: async () => {
        verificationCalls += 1;
        return false;
      },
    },
  });

  await withServer(t, dependencies, async (baseUrl) => {
    const invalidDomain = await postJson(baseUrl, '/api/auth/otp/verify', {
      email: 'student@gmail.com',
      role: 'student',
      token: '123456',
    });
    assert.equal(invalidDomain.response.status, 400);
    assert.equal(verificationCalls, 0);

    const forgedRole = await postJson(baseUrl, '/api/auth/otp/verify', {
      email: 'member@isatu.edu.ph',
      role: 'superadmin',
      token: '123456',
    });
    assert.equal(forgedRole.response.status, 400);
    assert.equal(verificationCalls, 0);

    const malformed = await postJson(baseUrl, '/api/auth/otp/verify', {
      email: 'student@students.isatu.edu.ph',
      role: 'student',
      token: '123',
    });
    assert.equal(malformed.response.status, 400);
    assert.equal(verificationCalls, 0);

    const mismatch = await postJson(baseUrl, '/api/auth/otp/verify', {
      email: 'student@students.isatu.edu.ph',
      role: 'student',
      token: '123456',
    });
    assert.equal(mismatch.response.status, 401);
    assert.equal(verificationCalls, 1);
  });
});

test('verification rejects invalid codes and officers removed from the allowlist', async (t) => {
  let session = null;
  const dependencies = createDependencies({
    pool: {
      query: async () => ({ rowCount: 0, rows: [] }),
    },
    loginOtp: {
      request: async () => ({ sent: true }),
      verify: async (_email, token) => token !== '000000',
    },
    setSession: (_response, email, role) => { session = { email, role }; },
  });

  await withServer(t, dependencies, async (baseUrl) => {
    const expired = await postJson(baseUrl, '/api/auth/otp/verify', {
      email: 'student@students.isatu.edu.ph',
      role: 'student',
      token: '000000',
    });
    assert.equal(expired.response.status, 401);
    assert.equal(session, null);

    const removedOfficer = await postJson(baseUrl, '/api/auth/otp/verify', {
      email: 'officer@isatu.edu.ph',
      role: 'officer',
      token: '123456',
    });
    assert.equal(removedOfficer.response.status, 403);
    assert.equal(session, null);
  });
});
