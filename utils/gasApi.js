const crypto = require('node:crypto');

const isatuEmailPattern = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(students\.)?isatu\.edu\.ph$/i;
const allowedNotificationEvents = new Set(['new_submission', 'assignment', 'new_message']);

function getDeploymentUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('GAS_API_URL must be a valid Google Apps Script deployment URL.');
  }

  if (url.protocol !== 'https:'
    || url.hostname !== 'script.google.com'
    || !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname)
    || url.username
    || url.password
    || url.search
    || url.hash) {
    throw new Error('GAS_API_URL must be an HTTPS Google Apps Script /exec URL.');
  }

  return url;
}

function validateNotification(notification) {
  if (!notification || !allowedNotificationEvents.has(notification.event)) {
    throw new Error('Unsupported officer email notification event.');
  }
  if (!['concern', 'feedback'].includes(notification.reportType)
    || typeof notification.trackingId !== 'string'
    || !/^BOSES-[A-F0-9]{8}$/.test(notification.trackingId)) {
    throw new Error('Officer email notification details are invalid.');
  }
}

function createGasApiClient(
  pool,
  { fetchImpl = globalThis.fetch, now = Date.now, randomBytes = crypto.randomBytes } = {},
) {
  let missingConfigurationLogged = false;

  function getConfiguration(required) {
    const urlValue = process.env.GAS_API_URL?.trim();
    const secret = process.env.GAS_API_SECRET?.trim();
    if (!urlValue || !secret) {
      if (required) throw new Error('Set GAS_API_URL and GAS_API_SECRET to enable login code email.');
      if (!missingConfigurationLogged) {
        console.warn(JSON.stringify({
          event: 'gas_email_not_configured',
          message: 'Set GAS_API_URL and GAS_API_SECRET to enable officer email notifications.',
        }));
        missingConfigurationLogged = true;
      }
      return null;
    }
    if (secret.length < 32 || secret.startsWith('CHANGE_ME')) {
      throw new Error('GAS_API_SECRET must be replaced with a random secret of at least 32 characters.');
    }
    if (typeof fetchImpl !== 'function') {
      throw new Error('GAS API email delivery requires the Fetch API.');
    }

    return {
      url: getDeploymentUrl(urlValue),
      secret,
    };
  }

  async function sendAuthenticatedPayload(payload, expectedRecipients) {
    const configuration = getConfiguration(true);
    const payloadJson = JSON.stringify(payload);
    const timestamp = String(Math.floor(now() / 1000));
    const nonce = randomBytes(16).toString('hex');

    const response = await fetchImpl(configuration.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: configuration.secret,
        timestamp,
        nonce,
        payload: payloadJson,
      }),
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    });
    let responseBody;
    try {
      responseBody = JSON.parse(await response.text());
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error('GAS API returned an invalid response.');
      }
      throw error;
    }
    if (!response.ok || responseBody?.ok !== true) {
      if (typeof responseBody?.error === 'string'
        && /^Unauthorized(?:\b|:)/i.test(responseBody.error)) {
        throw new Error(
          'GAS rejected the shared secret. Confirm GAS_API_SECRET in the server .env matches the Apps Script Script Property and GAS_API_URL targets the current deployment.',
        );
      }
      if (payload.event === 'auth_check'
        && typeof responseBody?.error === 'string'
        && responseBody.error.startsWith('Invalid email payload')) {
        throw new Error('GAS deployment is outdated. Deploy the current gas_api.gs version.');
      }
      throw new Error(responseBody?.error || 'GAS API rejected the email request.');
    }
    if (expectedRecipients === 0) {
      if (responseBody.authorized !== true) {
        throw new Error('GAS did not confirm the authenticated configuration check.');
      }
      return;
    }
    if (responseBody.sent !== expectedRecipients) {
      throw new Error('GAS API did not confirm delivery to every recipient.');
    }
  }

  return {
    async sendOfficerEmailNotification(notification) {
      validateNotification(notification);
      const configuration = getConfiguration(false);
      if (!configuration) return;

      const recipientsResult = await pool.query(
        `SELECT email
         FROM public.admins
         WHERE role IN ('admin', 'superadmin')
         ORDER BY email`,
      );
      const recipients = recipientsResult.rows.map((row) => row.email);
      if (!recipients.length || recipients.some((email) => !isatuEmailPattern.test(email))) {
        throw new Error('Officer email recipients are missing or invalid.');
      }

      await sendAuthenticatedPayload({
        event: notification.event,
        reportType: notification.reportType,
        trackingId: notification.trackingId,
        recipients,
      }, recipients.length);
    },

    async sendLoginOtp(email, token) {
      if (typeof email !== 'string'
        || !isatuEmailPattern.test(email)
        || typeof token !== 'string'
        || !/^\d{6}$/.test(token)) {
        throw new Error('Login email or code is invalid.');
      }

      await sendAuthenticatedPayload({
        event: 'login_otp',
        email: email.toLowerCase(),
        otp: token,
      }, 1);
    },

    async sendTestEmail(email) {
      if (typeof email !== 'string' || !isatuEmailPattern.test(email)) {
        throw new Error('Test email recipient must be an ISAT U email address.');
      }

      await sendAuthenticatedPayload({
        event: 'test_email',
        email: email.toLowerCase(),
      }, 1);
    },

    async checkAuthorization() {
      await sendAuthenticatedPayload({ event: 'auth_check' }, 0);
    },
  };
}

module.exports = createGasApiClient;
