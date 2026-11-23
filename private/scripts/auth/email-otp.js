const role = document.body.dataset.authRole;
const requestForm = document.querySelector('#otp-request-form');
const verifyForm = document.querySelector('#otp-verify-form');
const emailInput = document.querySelector('#otp-email');
const codeInput = document.querySelector('#otp-code');
const emailTarget = document.querySelector('#otp-email-target');
const message = document.querySelector('#login-message, #admin-login-message');

if (['student', 'officer'].includes(role) && requestForm && verifyForm && message) {
  let pendingEmail = '';
  let resendTimer = null;
  const resendButton = verifyForm.querySelector('[data-action="resend"]');
  const resendButtonLabel = resendButton.textContent.trim();

  function showMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle('is-error', isError);
  }

  function setBusy(form, busy) {
    form.querySelectorAll('button, input').forEach((control) => {
      control.disabled = busy;
    });
  }

  async function postAuth(endpoint, payload) {
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'BOSES-Client',
      },
      body: JSON.stringify(payload),
    });
    let result = {};
    try {
      result = await response.json();
    } catch {
      // The server may return an empty response for network or proxy errors.
    }
    if (!response.ok) {
      const error = new Error(result.error || 'Sign-in could not be completed. Please try again.');
      error.status = response.status;
      error.retryAfterSeconds = Number(result.retryAfterSeconds) || 0;
      throw error;
    }
    return result;
  }

  function startResendCooldown(seconds) {
    if (resendTimer) window.clearInterval(resendTimer);
    const expiresAt = Date.now() + Math.max(0, Number(seconds) || 0) * 1000;
    const updateButton = () => {
      const remaining = Math.ceil((expiresAt - Date.now()) / 1000);
      if (remaining <= 0) {
        resendButton.disabled = false;
        resendButton.textContent = resendButtonLabel;
        window.clearInterval(resendTimer);
        resendTimer = null;
        return;
      }
      resendButton.disabled = true;
      resendButton.textContent = `Resend code (${remaining}s)`;
    };
    updateButton();
    if (expiresAt > Date.now()) {
      resendTimer = window.setInterval(updateButton, 250);
    }
  }

  async function sendCode(email) {
    let resendAfterSeconds = 0;
    setBusy(requestForm, true);
    setBusy(verifyForm, true);
    showMessage('Sending your sign-in code…');
    try {
      const result = await postAuth('/api/auth/otp/request', { email, role });
      if (result.sent !== true) throw new Error('A sign-in code could not be sent.');
      pendingEmail = email;
      emailTarget.textContent = `A six-digit code was sent to ${email}.`;
      codeInput.value = '';
      requestForm.hidden = true;
      verifyForm.hidden = false;
      resendAfterSeconds = Number(result.resendAfterSeconds) || 60;
      showMessage('Check your inbox, including the spam folder, for your sign-in code.');
    } catch (error) {
      if (error.status === 429) {
        pendingEmail = email;
        emailTarget.textContent = `A sign-in code may already have been sent to ${email}.`;
        codeInput.value = '';
        requestForm.hidden = true;
        verifyForm.hidden = false;
        resendAfterSeconds = Number(error.retryAfterSeconds) || 60;
        showMessage(
          'Check your email and enter the recent code below. You can request another code when the timer ends.',
        );
      } else {
        showMessage(error.message || 'Could not send your sign-in code. Please try again.', true);
      }
    } finally {
      setBusy(requestForm, false);
      setBusy(verifyForm, false);
      if (resendAfterSeconds > 0) startResendCooldown(resendAfterSeconds);
      if (!verifyForm.hidden) codeInput.focus();
    }
  }

  requestForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!requestForm.reportValidity()) return;
    sendCode(emailInput.value.trim());
  });

  verifyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!verifyForm.reportValidity()) return;
    setBusy(verifyForm, true);
    showMessage('Verifying your code…');
    try {
      const result = await postAuth('/api/auth/otp/verify', {
        email: pendingEmail,
        role,
        token: codeInput.value.trim(),
      });
      if (result.signedIn !== true) throw new Error('Sign-in could not be completed.');
      window.location.assign(result.role === 'user' ? '/dashboard' : '/admin');
    } catch (error) {
      showMessage(error.message || 'Could not verify your code. Please try again.', true);
    } finally {
      setBusy(verifyForm, false);
    }
  });

  verifyForm.querySelector('[data-action="resend"]').addEventListener('click', () => {
    sendCode(pendingEmail);
  });

  verifyForm.querySelector('[data-action="change-email"]').addEventListener('click', () => {
    if (resendTimer) window.clearInterval(resendTimer);
    resendTimer = null;
    resendButton.disabled = false;
    resendButton.textContent = resendButtonLabel;
    verifyForm.hidden = true;
    requestForm.hidden = false;
    codeInput.value = '';
    showMessage('');
    emailInput.focus();
  });
}
