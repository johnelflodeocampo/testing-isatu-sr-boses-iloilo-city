const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeEmail,
  normalizeOfficerEmail,
  normalizeStudentEmail,
} = require('../utils/isatuEmail');

test('student sign-in accepts both normalized ISAT U email domains', () => {
  assert.equal(
    normalizeStudentEmail(' Student@Students.ISATU.edu.ph '),
    'student@students.isatu.edu.ph',
  );
  assert.equal(
    normalizeStudentEmail(' Member@ISATU.edu.ph '),
    'member@isatu.edu.ph',
  );
  assert.equal(normalizeStudentEmail('student@gmail.com'), null);
});

test('officer sign-in accepts both normalized ISAT U email domains', () => {
  assert.equal(normalizeOfficerEmail('Officer@ISATU.edu.ph'), 'officer@isatu.edu.ph');
  assert.equal(
    normalizeOfficerEmail(' Officer@Students.ISATU.edu.ph '),
    'officer@students.isatu.edu.ph',
  );
  assert.equal(normalizeOfficerEmail('officer@gmail.com'), null);
});

test('shared email normalization retains both ISAT U domains for existing features', () => {
  assert.equal(normalizeEmail('student@students.isatu.edu.ph'), 'student@students.isatu.edu.ph');
  assert.equal(normalizeEmail('officer@isatu.edu.ph'), 'officer@isatu.edu.ph');
  assert.equal(normalizeEmail('user@example.com'), null);
});
