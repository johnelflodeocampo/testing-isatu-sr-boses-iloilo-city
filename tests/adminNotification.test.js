const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const createAdminController = require('../controllers/adminController');

test('new submission email uses the validated report type when the DB function omits it', async () => {
  let notification;
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.session = { email: 'member@isatu.edu.ph' };
    next();
  });
  app.use(createAdminController({
    path: require('node:path'),
    crypto,
    publicDirectory: '',
    privateDirectory: '',
    pool: { query: async () => ({ rowCount: 1, rows: [] }) },
    reportModel: {},
    draftModel: {
      createInsight: async () => ({
        rows: [{
          id: 'report-id',
          tracking_id: 'BOSES-236AAFD3',
          status: 'submitted',
          created_at: new Date(),
        }],
      }),
    },
    gasApi: {
      sendOfficerEmailNotification: async (value) => { notification = value; },
    },
    sendPrivatePage: () => {},
    sendPrivateScript: () => {},
    normalizeEmail: (email) => email,
    getIdentityTag: () => 'a'.repeat(64),
    isIdentityBanned: async () => false,
    setSession: () => {},
    readSession: () => null,
    isAdminRole: () => false,
    validateAdminSession: async () => true,
    requireSession: () => (_request, _response, next) => next(),
    requirePageSession: () => (_request, _response, next) => next(),
    requireBrowserRequest: (_request, _response, next) => next(),
    handleDatabaseError: (_error, response) => response.status(500).end(),
    submissionLimiter: (_request, _response, next) => next(),
    messageLimiter: (_request, _response, next) => next(),
    sessionCookie: 'boses_user_session',
  }));

  const server = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/insights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'This is a sufficiently detailed report.',
        reportType: 'concern',
        isAnonymous: true,
      }),
    });

    assert.equal(response.status, 201);
    assert.deepEqual(notification, {
      event: 'new_submission',
      reportType: 'concern',
      trackingId: 'BOSES-236AAFD3',
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
