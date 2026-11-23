const API_SECRET_PROPERTY = 'GAS_API_SECRET';
const MAX_CLOCK_SKEW_SECONDS = 300;
const MAX_RECIPIENTS = 100;
const ISATU_EMAIL_PATTERN = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(students\.)?isatu\.edu\.ph$/i;

function doGet() {
  return jsonResponse({
    ok: true,
    service: 'ISAT U BOSES email API',
  });
}

function doPost(event) {
  let request;
  try {
    if (!event || !event.postData || typeof event.postData.contents !== 'string'
      || event.postData.contents.length > 20000) {
      return jsonResponse({ ok: false, error: 'Invalid request.' });
    }

    try {
      request = JSON.parse(event.postData.contents);
    } catch {
      return jsonResponse({ ok: false, error: 'Invalid JSON request.' });
    }

    const secret = PropertiesService.getScriptProperties().getProperty(API_SECRET_PROPERTY);
    if (!secret || secret.length < 32 || !verifyRequest(request, secret)) {
      return jsonResponse({ ok: false, error: 'Unauthorized request.' });
    }

    let payload;
    if (typeof request.payload === 'string') {
      try {
        payload = JSON.parse(request.payload);
      } catch {
        return jsonResponse({ ok: false, error: 'Invalid email payload JSON.' });
      }
    } else if (request.payload && typeof request.payload === 'object') {
      payload = request.payload;
    } else {
      return jsonResponse({ ok: false, error: 'Invalid email payload format.' });
    }

    if (!isValidPayload(payload)) {
      return jsonResponse({ ok: false, error: 'Invalid email payload.' });
    }
    if (payload.event === 'auth_check') {
      return jsonResponse({ ok: true, authorized: true });
    }

    const recipients = payload.event === 'login_otp' || payload.event === 'test_email'
      ? [payload.email.trim().toLowerCase()]
      : Array.from(new Set(payload.recipients.map((email) => email.trim().toLowerCase())));

    if (MailApp.getRemainingDailyQuota() < recipients.length) {
      return jsonResponse({ ok: false, error: 'Email quota is insufficient.' });
    }

    const cache = CacheService.getScriptCache();
    const nonceKey = `gas-email:${request.nonce}`;
    const lock = LockService.getScriptLock();
    lock.waitLock(5000);
    try {
      if (cache.get(nonceKey)) {
        return jsonResponse({ ok: false, error: 'Request has already been processed.' });
      }
      cache.put(nonceKey, '1', MAX_CLOCK_SKEW_SECONDS);
    } finally {
      lock.releaseLock();
    }

    const message = payload.event === 'login_otp'
      ? getLoginOtpMessage(payload)
      : payload.event === 'test_email'
        ? getTestEmailMessage()
        : getEmailMessage(payload);

    recipients.forEach((recipient) => {
      MailApp.sendEmail({
        to: recipient,
        subject: message.subject,
        body: message.body,
        name: 'ISAT U BOSES',
      });
    });

    return jsonResponse({ ok: true, sent: recipients.length });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('GAS email delivery failed:', detail);
    return jsonResponse({ ok: false, error: `Email could not be sent: ${detail}` });
  }
}

function verifyRequest(request, secret) {
  if (!request
    || typeof request !== 'object'
    || Array.isArray(request)
    || typeof request.secret !== 'string'
    || !constantTimeEqual(request.secret.trim(), secret.trim())
    || typeof request.timestamp !== 'string'
    || !/^\d{10}$/.test(request.timestamp)
    || typeof request.nonce !== 'string'
    || !/^[0-9a-f]{32}$/.test(request.nonce)) {
    return false;
  }

  const timestamp = Number(request.timestamp);
  return Math.abs(Math.floor(Date.now() / 1000) - timestamp) <= MAX_CLOCK_SKEW_SECONDS;
}

function isValidPayload(payload) {
  if (!payload
    || typeof payload !== 'object'
    || Array.isArray(payload)
    || !['auth_check', 'login_otp', 'test_email', 'new_submission', 'assignment', 'new_message'].includes(payload.event)) {
    return false;
  }
  if (payload.event === 'auth_check') return true;
  if (payload.event === 'test_email') {
    return typeof payload.email === 'string'
      && ISATU_EMAIL_PATTERN.test(payload.email.trim());
  }
  if (payload.event === 'login_otp') {
    return typeof payload.email === 'string'
      && ISATU_EMAIL_PATTERN.test(payload.email.trim())
      && typeof payload.otp === 'string'
      && /^\d{6}$/.test(payload.otp.trim());
  }
  if (!['new_submission', 'assignment', 'new_message'].includes(payload.event)
    || !['concern', 'feedback'].includes(payload.reportType)
    || typeof payload.trackingId !== 'string'
    || !/^BOSES-[A-F0-9]{8}$/i.test(payload.trackingId.trim())
    || !Array.isArray(payload.recipients)
    || payload.recipients.length === 0
    || payload.recipients.length > MAX_RECIPIENTS
    || payload.recipients.some((email) =>
      typeof email !== 'string' || !ISATU_EMAIL_PATTERN.test(email.trim()))) {
    return false;
  }

  return payload.event !== 'assignment'
    || payload.reportType === 'concern';
}

function getLoginOtpMessage(payload) {
  return {
    subject: 'ISAT U BOSES sign-in code',
    body: `Your ISAT U BOSES sign-in code is ${payload.otp.trim()}.\n\nIt expires in 10 minutes. Do not share this code with anyone. If you did not request it, you can ignore this email.`,
  };
}

function getTestEmailMessage() {
  return {
    subject: 'ISAT U BOSES email delivery test',
    body: 'This is a test email from ISAT U BOSES. Email delivery is configured.',
  };
}

function getEmailMessage(payload) {
  const reportType = payload.reportType === 'concern' ? 'concern' : 'feedback';
  const trackingId = payload.trackingId.trim().toUpperCase();
  let subject;
  let notice;

  if (payload.event === 'new_submission') {
    subject = `New ${reportType} submission`;
    notice = `A new ${reportType} submission is awaiting review.`;
  } else if (payload.event === 'assignment') {
    subject = 'Concern assignment updated';
    notice = 'A concern assignment was updated.';
  } else {
    subject = 'New report message';
    notice = `A new message was received for a ${reportType} report.`;
  }

  return {
    subject: `ISAT U BOSES: ${subject} (${trackingId})`,
    body: `${notice}\nTracking ID: ${trackingId}\n\nSign in to the ISAT U BOSES officer console to review. Report and message content is not included in this email.`,
  };
}

function constantTimeEqual(first, second) {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  }
  return difference === 0;
}

function jsonResponse(result) {
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}