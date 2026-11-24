const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const createAdminController = require('../controllers/adminController');

const reportId = '123e4567-e89b-12d3-a456-426614174000';
const messageBody = 'A message for this report.';

async function postMessage(role) {
  const queries = [];
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes('INSERT INTO public.insight_messages')) {
        return {
          rowCount: 1,
          rows: [{
            id: '123e4567-e89b-12d3-a456-426614174001',
            sender_role: role,
            body: messageBody,
            created_at: new Date().toISOString(),
          }],
        };
      }
      if (sql.includes('INSERT INTO public.notifications')) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('SELECT report_type, tracking_id FROM public.insights')) {
        return { rowCount: 1, rows: [{ report_type: 'concern', tracking_id: 'BOSES-236AAFD3' }] };
      }
      if (sql.includes('SELECT identity_hash, tracking_id FROM public.insights')) {
        return { rowCount: 1, rows: [{ identity_hash: 'a'.repeat(64), tracking_id: 'BOSES-236AAFD3' }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.session = { email: `${role}@isatu.edu.ph` };
    next();
  });
  app.use(createAdminController({
    path: require('node:path'),
    crypto,
    publicDirectory: '',
    privateDirectory: '',
    pool,
    reportModel: {},
    draftModel: {},
    gasApi: { sendOfficerEmailNotification: async () => {} },
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
    handleDatabaseError: (error, response) => response.status(500).json({ error: error.message }),
    submissionLimiter: (_request, _response, next) => next(),
    messageLimiter: (_request, _response, next) => next(),
    sessionCookie: 'boses_user_session',
  }));

  const server = app.listen(0);
  try {
    const endpoint = role === 'member'
      ? `/api/my/insights/${reportId}/messages`
      : `/api/admin/insights/${reportId}/messages`;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: messageBody }),
    });
    const notification = queries.find(({ sql }) => sql.includes('INSERT INTO public.notifications'));
    return { notification, response };
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test('member message notification uses separate UUID and text parameters', async () => {
  const { notification, response } = await postMessage('member');

  assert.equal(response.status, 201);
  assert.match(notification.sql, /insight_id, kind, title, body, link\)/);
  assert.match(notification.sql, /VALUES \('officer', 'all_officers', \$1/);
  assert.deepEqual(notification.values, [
    reportId,
    'A student sent a new message in a report conversation.',
    `/inbox?report=${reportId}`,
  ]);
});

test('officer message notification uses separate UUID and text parameters', async () => {
  const { notification, response } = await postMessage('officer');

  assert.equal(response.status, 201);
  assert.match(notification.sql, /insight_id, kind, title, body, link\)/);
  assert.match(notification.sql, /VALUES \('member', \$1, \$2/);
  assert.deepEqual(notification.values, [
    'a'.repeat(64),
    reportId,
    'The officer team sent a message about BOSES-236AAFD3.',
    `/inbox?report=${reportId}`,
  ]);
});
