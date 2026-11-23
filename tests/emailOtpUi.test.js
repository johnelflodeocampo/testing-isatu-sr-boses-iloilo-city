const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createElement(textContent = '') {
  return {
    textContent,
    value: '',
    hidden: false,
    disabled: false,
    focused: false,
    listeners: {},
    controls: [],
    classList: {
      toggle() {},
    },
    addEventListener(name, callback) {
      this.listeners[name] = callback;
    },
    querySelectorAll() {
      return this.controls;
    },
    reportValidity() {
      return true;
    },
    focus() {
      this.focused = true;
    },
  };
}

test('OTP cooldown shows code entry and counts down to resend', async () => {
  const requestForm = createElement();
  const verifyForm = createElement();
  const emailInput = createElement();
  const codeInput = createElement();
  const emailTarget = createElement();
  const message = createElement();
  const requestButton = createElement();
  const verifyButton = createElement();
  const resendButton = createElement('Resend code');
  const changeEmailButton = createElement('Use a different email');
  requestForm.controls = [emailInput, requestButton];
  verifyForm.controls = [codeInput, verifyButton, resendButton, changeEmailButton];
  verifyForm.querySelector = (selector) => ({
    '[data-action="resend"]': resendButton,
    '[data-action="change-email"]': changeEmailButton,
  }[selector]);
  emailInput.value = 'student@students.isatu.edu.ph';

  const elements = {
    '#otp-request-form': requestForm,
    '#otp-verify-form': verifyForm,
    '#otp-email': emailInput,
    '#otp-code': codeInput,
    '#otp-email-target': emailTarget,
    '#login-message, #admin-login-message': message,
  };
  const document = {
    body: { dataset: { authRole: 'student' } },
    querySelector: (selector) => elements[selector],
  };
  const window = {
    clearInterval() {},
    setInterval() {
      return 1;
    },
    location: { assign() {} },
  };
  const fetchCalls = [];
  const fetch = async (endpoint, options) => {
    fetchCalls.push({ endpoint, payload: JSON.parse(options.body) });
    return {
      ok: false,
      status: 429,
      json: async () => ({
        error: 'A code was recently sent.',
        retryAfterSeconds: 37,
      }),
    };
  };
  const source = fs.readFileSync(
    path.resolve(__dirname, '..', 'private', 'scripts', 'auth', 'email-otp.js'),
    'utf8',
  );
  vm.runInNewContext(source, { document, window, fetch });

  requestForm.listeners.submit({ preventDefault() {} });
  await new Promise(setImmediate);

  assert.deepEqual(fetchCalls, [{
    endpoint: '/api/auth/otp/request',
    payload: { email: 'student@students.isatu.edu.ph', role: 'student' },
  }]);
  assert.equal(requestForm.hidden, true);
  assert.equal(verifyForm.hidden, false);
  assert.equal(emailTarget.textContent, 'A sign-in code may already have been sent to student@students.isatu.edu.ph.');
  assert.equal(resendButton.disabled, true);
  assert.equal(resendButton.textContent, 'Resend code (37s)');
  assert.match(message.textContent, /enter the recent code below/i);
  assert.equal(codeInput.focused, true);
});
