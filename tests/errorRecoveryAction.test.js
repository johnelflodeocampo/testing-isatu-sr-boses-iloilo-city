const test = require('node:test');
const assert = require('node:assert/strict');
const getErrorRecoveryAction = require('../utils/errorRecoveryAction');

test('student errors return to the student dashboard', () => {
  assert.deepEqual(getErrorRecoveryAction('user'), {
    label: 'Back to dashboard',
    href: '/dashboard',
    bodyClass: 'portal-page portal-dashboard-page student-dashboard-page error-page student-error-page',
    context: '',
  });
});

test('admin and superadmin errors return to the admin dashboard', () => {
  for (const role of ['admin', 'superadmin']) {
    assert.deepEqual(getErrorRecoveryAction(role), {
      label: 'Back to dashboard',
      href: '/admin',
      bodyClass: `portal-page portal-dashboard-page admin-portal-page admin-dashboard-page error-page officer-error-page${role === 'superadmin' ? ' superadmin-error-page' : ''}`,
      context: '',
    });
  }
});

test('anonymous errors continue to return home', () => {
  assert.deepEqual(getErrorRecoveryAction(null), {
    label: 'Back to index',
    href: '/',
    bodyClass: 'home-page public-page error-page guest-error-page',
    context: 'You are not signed in. Return to the index to continue.',
  });
});
