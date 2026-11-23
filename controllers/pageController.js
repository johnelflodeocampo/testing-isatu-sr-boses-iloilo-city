const express = require('express');
const fs = require('node:fs/promises');
const sanitizePrivacyHtml = require('../lib/privacyHtml');

module.exports = function createController(dependencies) {
  const {
    path,
    publicDirectory,
    privateDirectory,
    privacyNoticeStore,
    pool,
    reportModel,
    loginOtp,
    sendPrivatePage,
    sendPrivateScript,
    normalizeOfficerEmail,
    normalizeStudentEmail,
    getIdentityTag,
    isIdentityBanned,
    setSession,
    clearSession,
    readSession,
    isAdminRole,
    validateAdminSession,
    requireSession,
    requirePageSession,
    requireBrowserRequest,
    handleDatabaseError,
    otpRequestLimiter,
    otpVerifyLimiter,
    submissionLimiter,
    messageLimiter,
    sessionCookie,
    sessionCookieOptions,
  } = dependencies;
  const router = express.Router();

  async function renderPrivacyNoticePage(templatePath, response, next) {
    try {
      const [html, notice] = await Promise.all([
        fs.readFile(path.join(privateDirectory, templatePath), 'utf8'),
        privacyNoticeStore.read(),
      ]);
      const escapeHtml = (value) => value.replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]);
      const noticeMarkup = notice
        ? `<h2 class="privacy-notice-title">${escapeHtml(notice.title)}</h2><div class="privacy-notice-body">${sanitizePrivacyHtml(notice.body)}</div>`
        : '<p class="empty-state">A privacy notice has not been published.</p>';
      const updatedAt = notice ? `Last updated ${escapeHtml(new Date(notice.updated_at).toLocaleString())}` : '';
      response.set({
        'Cache-Control': 'no-store, max-age=0',
        Pragma: 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      return response.type('html').send(
        html
          .replace('<!-- PRIVACY_NOTICE_CONTENT -->', noticeMarkup)
          .replace('<!-- PRIVACY_UPDATED_AT -->', updatedAt),
      );
    } catch (error) {
      return next(error);
    }
  }

  router.get('/', (request, response) => {
    if (isAdminRole(readSession(request)?.role)) {
      return response.redirect(303, '/admin');
    }
    response.sendFile(path.join(publicDirectory, 'index.html'));
  });
  router.get('/login', (request, response) => sendPrivatePage('pages/auth/login.html', response));
  router.get('/login/app.js', (request, response) =>
    sendPrivateScript('scripts/auth/email-otp.js', response));
  router.post('/api/auth/otp/request', otpRequestLimiter, requireBrowserRequest, async (request, response) => {
    response.set('Cache-Control', 'no-store');
    const flow = request.body?.role;
    if (flow !== 'student' && flow !== 'officer') {
      return response.status(400).json({ error: 'Choose a valid sign-in type.' });
    }

    const emailInput = typeof request.body.email === 'string' ? request.body.email : '';
    const email = flow === 'student'
      ? normalizeStudentEmail(emailInput)
      : normalizeOfficerEmail(emailInput);
    if (!email) {
      return response.status(400).json({
        error: flow === 'student'
          ? 'Use your @students.isatu.edu.ph or @isatu.edu.ph email address.'
          : 'Use your @students.isatu.edu.ph or @isatu.edu.ph officer email address.',
      });
    }

    if (flow === 'officer') {
      let officer;
      try {
        officer = await pool.query(
          'SELECT email FROM public.admins WHERE email = $1',
          [email],
        );
      } catch (error) {
        return handleDatabaseError(error, response);
      }
      if (officer.rowCount === 0) {
        return response.status(403).json({ error: 'This email is not authorized for officer access.' });
      }
    }

    try {
      const result = await loginOtp.request(email);
      return response.json({
        sent: true,
        resendAfterSeconds: result.resendAfterSeconds,
      });
    } catch (error) {
      if (error.status === 429) {
        const retryAfterSeconds = Math.max(1, Number(error.retryAfterSeconds) || 1);
        response.set('Retry-After', String(retryAfterSeconds));
        return response.status(429).json({
          error: 'A code was recently sent to this email. Wait before requesting another.',
          retryAfterSeconds,
        });
      }
      if (error.code) return handleDatabaseError(error, response);
      console.error('GAS login OTP request failed:', error.message);
      return response.status(502).json({
        error: 'Could not send a sign-in code. Please try again later.',
      });
    }
  });
  router.post('/api/auth/otp/verify', otpVerifyLimiter, requireBrowserRequest, async (request, response) => {
    response.set('Cache-Control', 'no-store');
    const flow = request.body?.role;
    if (flow !== 'student' && flow !== 'officer') {
      return response.status(400).json({ error: 'Choose a valid sign-in type.' });
    }

    const emailInput = typeof request.body.email === 'string' ? request.body.email : '';
    const email = flow === 'student'
      ? normalizeStudentEmail(emailInput)
      : normalizeOfficerEmail(emailInput);
    if (!email) {
      return response.status(400).json({
        error: flow === 'student'
          ? 'Use your @students.isatu.edu.ph or @isatu.edu.ph email address.'
          : 'Use your @students.isatu.edu.ph or @isatu.edu.ph officer email address.',
      });
    }

    const token = typeof request.body.token === 'string' ? request.body.token.trim() : '';
    if (!/^\d{6}$/.test(token)) {
      return response.status(400).json({ error: 'Enter the six-digit code from your email.' });
    }

    let verified;
    try {
      verified = await loginOtp.verify(email, token);
    } catch (error) {
      if (error.code) return handleDatabaseError(error, response);
      console.error('Login OTP verification failed:', error.message);
      return response.status(500).json({ error: 'Could not verify the sign-in code. Please try again later.' });
    }

    if (!verified) {
      return response.status(401).json({ error: 'The code is invalid or expired. Request a new code and try again.' });
    }

    if (flow === 'student') {
      let banned;
      try {
        banned = await isIdentityBanned(email);
      } catch (error) {
        return handleDatabaseError(error, response);
      }
      if (banned) {
        return response.status(403).json({ error: 'Your account is currently restricted from signing in.' });
      }
      setSession(response, email, 'user');
      return response.json({ signedIn: true, role: 'user' });
    }

    let officer;
    try {
      officer = await pool.query(
        'SELECT role FROM public.admins WHERE email = $1',
        [email],
      );
    } catch (error) {
      return handleDatabaseError(error, response);
    }
    if (officer.rowCount === 0) {
      return response.status(403).json({ error: 'This email is not authorized for officer access.' });
    }

    setSession(response, email, officer.rows[0].role);
    return response.json({ signedIn: true, role: officer.rows[0].role });
  });
  router.get('/dashboard', requirePageSession('member', '/login'), (request, response) =>
    sendPrivatePage('pages/student/dashboard.html', response));
  router.get('/dashboard/share', requirePageSession('member', '/login'), (request, response) =>
    sendPrivatePage('pages/student/dashboard-share.html', response));
  router.get('/dashboard/reports', requirePageSession('member', '/login'), (request, response) =>
    sendPrivatePage('pages/student/dashboard-reports.html', response));
  router.get('/dashboard/insights', requirePageSession('member', '/login'), (request, response) =>
    sendPrivatePage('pages/student/help-portal-submit.html', response));
  router.get('/dashboard/insights/app.js', requireSession('member'), (request, response) =>
    sendPrivateScript('scripts/student/help-portal-submit.js', response));
  router.get('/dashboard/submit-bug', requirePageSession('member', '/login'), (request, response) =>
    response.redirect(308, '/dashboard/insights'));
  router.get('/dashboard/submit-bug/app.js', requireSession('member'), (request, response) =>
    response.redirect(308, '/dashboard/insights/app.js'));
  router.get('/dashboard/resources', requirePageSession('member', '/login'), (request, response) =>
    sendPrivatePage('pages/student/dashboard-resources.html', response));
  router.get('/dashboard/resources/app.js', requireSession('member'), (request, response) =>
    sendPrivateScript('scripts/public/resources.js', response));
  router.get('/dashboard/privacy', requirePageSession('member', '/login'), (request, response, next) =>
    renderPrivacyNoticePage('pages/student/dashboard-privacy.html', response, next));
  router.get('/dashboard/portal.js', requireSession('member'), (request, response) =>
    sendPrivateScript('scripts/student/portal.js', response));
  router.get('/dashboard/app.js', requireSession('member'), (request, response) =>
    sendPrivateScript('scripts/student/dashboard.js', response));
  const inboxHandler = async (request, response, next) => {
    const session = readSession(request);
    if (!session) return response.redirect(303, '/login');
    if (isAdminRole(session.role)) {
      try {
        if (!(await validateAdminSession(session, response, '/admin/login'))) return;
      } catch (error) {
        return next(error);
      }
    } else if (session.role === 'user') {
      try {
        if (await isIdentityBanned(session.email)) {
          clearSession(response);
          return response.redirect(303, '/login');
        }
      } catch (error) {
        return next(error);
      }
    } else {
      return response.redirect(303, '/login');
    }
    return sendPrivatePage('pages/shared/inbox.html', response);
  };
  router.get('/inbox', inboxHandler);
  router.get('/messages', (request, response) => {
    response.redirect(308, `/inbox${request.url.slice('/messages'.length)}`);
  });
  router.get('/inbox/app.js', requireSession(), (request, response) =>
    sendPrivateScript('scripts/shared/messages.js', response));
  router.get('/messages/app.js', (request, response) => response.redirect(308, '/inbox/app.js'));
  router.get('/notifications', requirePageSession('member', '/login'), (request, response) =>
    sendPrivatePage('pages/student/notifications.html', response));
  router.get('/notifications/app.js', requireSession('member'), (request, response) =>
    sendPrivateScript('scripts/student/notifications.js', response));
  router.get('/notifications/topbar-actions.js', requireSession(), (request, response) =>
    sendPrivateScript('scripts/shared/topbar-actions.js', response));
  router.get('/api/notifications', requireSession(), async (request, response) => {
    const session = readSession(request);
    const memberRecipient = session.role === 'user' ? getIdentityTag(session.email) : null;
    try {
      const result = memberRecipient
        ? await pool.query(
          `SELECT id, COALESCE(insight_id, portal_insight_id) AS insight_id,
                  portal_insight_id,
                  kind, title, body, link, is_read, created_at
           FROM public.notifications
           WHERE recipient_type = 'member' AND recipient_key = $1
             AND NOT (kind = 'new_message' AND portal_insight_id IS NOT NULL)
           ORDER BY created_at DESC
           LIMIT 30`,
          [memberRecipient],
        )
        : await pool.query(
          `SELECT id, COALESCE(insight_id, portal_insight_id) AS insight_id,
                  kind, title, body, link, is_read, created_at
           FROM public.notifications
           WHERE recipient_type = 'officer'
             AND recipient_key IN ('all_officers', $1)
             AND NOT (kind = 'new_message' AND portal_insight_id IS NOT NULL)
           ORDER BY created_at DESC
           LIMIT 30`,
          [session.email],
        );
      const unread = result.rows.filter((item) => !item.is_read).length;
      response.set('Cache-Control', 'no-store');
      response.json({ notifications: result.rows, unread });
    } catch (error) {
      return handleDatabaseError(error, response);
    }
  });
  router.patch('/api/notifications/:id/read', requireSession(), requireBrowserRequest, async (request, response) => {
    const id = request.params.id;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return response.status(400).json({ error: 'Invalid notification ID.' });
    }
    const session = readSession(request);
    const recipientKey = session.role === 'user' ? getIdentityTag(session.email) : session.email;
    try {
      const result = await pool.query(
        `UPDATE public.notifications
         SET is_read = TRUE
         WHERE id = $1
           AND recipient_type = $2
           AND (recipient_key = $3 OR (recipient_type = 'officer' AND recipient_key = 'all_officers'))
         RETURNING id`,
        [id, session.role === 'user' ? 'member' : 'officer', recipientKey],
      );
      if (!result.rowCount) return response.status(404).json({ error: 'Notification not found.' });
      response.json({ read: true });
    } catch (error) {
      return handleDatabaseError(error, response);
    }
  });
  router.get('/tracker', (request, response) => sendPrivatePage('pages/public/tracker.html', response));
  router.get('/tracker/app.js', (request, response) => sendPrivateScript('scripts/public/tracker.js', response));
  router.get('/resources', (request, response) => {
    if (isAdminRole(readSession(request)?.role)) {
      return response.redirect(303, '/admin');
    }
    return sendPrivatePage('pages/public/resources.html', response);
  });
  router.get('/resources/app.js', (request, response) => sendPrivateScript('scripts/public/resources.js', response));
  router.get('/privacy', async (request, response, next) => {
    if (isAdminRole(readSession(request)?.role)) {
      return response.redirect(303, '/admin');
    }
    return renderPrivacyNoticePage('pages/public/privacy.html', response, next);
  });
  router.get('/privacy/sanitizer.js', (request, response) => sendPrivateScript('scripts/shared/privacy-sanitizer.js', response));
  router.get('/admin/login', async (request, response, next) => {
    const session = readSession(request);
    if (isAdminRole(session?.role)) {
      try {
        if (!(await validateAdminSession(session, response, '/admin/login'))) return;
        return response.redirect(303, '/admin');
      } catch (error) {
        return next(error);
      }
    }
    return sendPrivatePage('pages/auth/admin-login.html', response);
  });
  router.get('/admin/gate.js', (request, response) =>
    sendPrivateScript('scripts/auth/email-otp.js', response));
  router.get('/admin', requirePageSession('officer', '/admin/login'), (request, response) =>
    sendPrivatePage('pages/admin/admin.html', response));
  router.get('/admin/reports', requirePageSession('officer', '/admin/login'), (request, response) =>
    sendPrivatePage('pages/admin/admin-reports.html', response));
  router.get('/admin/insights', requirePageSession('officer', '/admin/login'), (request, response) =>
    sendPrivatePage('pages/admin/admin-insights.html', response));
  router.get('/admin/insights/app.js', requireSession('officer'), (request, response) =>
    sendPrivateScript('scripts/admin/admin-insights.js', response));
  router.get('/admin/notifications', requirePageSession('officer', '/admin/login'), (request, response) =>
    sendPrivatePage('pages/admin/notifications.html', response));
  router.get('/admin/notifications/app.js', requireSession('officer'), (request, response) =>
    sendPrivateScript('scripts/admin/notifications.js', response));
  router.get('/admin/app.js', requireSession('officer'), (request, response) =>
    sendPrivateScript('scripts/admin/admin.js', response));
  router.get('/admin/report-pdf.js', requireSession('officer'), (request, response) =>
    sendPrivateScript('scripts/admin/report-pdf.js', response));
  router.get('/admin/resources', requirePageSession('officer', '/admin/login'), (request, response) =>
    sendPrivatePage('pages/admin/admin-resources.html', response));
  router.get('/admin/resources/app.js', requireSession('officer'), (request, response) =>
    sendPrivateScript('scripts/admin/admin-resources.js', response));
  router.get('/admin/privacy', requirePageSession('superadmin', '/admin/login'), (request, response) =>
    sendPrivatePage('pages/admin/admin-privacy.html', response));
  router.get('/admin/privacy/app.js', requireSession('superadmin'), (request, response) =>
    sendPrivateScript('scripts/admin/admin-privacy.js', response));
  router.get('/admin/archive', requirePageSession('superadmin', '/admin/login'), (request, response) =>
    sendPrivatePage('pages/admin/admin-archive.html', response));
  router.get('/admin/archive/app.js', requireSession('superadmin'), (request, response) =>
    sendPrivateScript('scripts/admin/admin-archive.js', response));
  router.get('/admin/officers', requirePageSession('superadmin', '/admin/login'), (request, response) =>
    sendPrivatePage('pages/admin/admin-officers.html', response));
  router.get('/admin/officers/app.js', requireSession('superadmin'), (request, response) =>
    sendPrivateScript('scripts/admin/admin-officers.js', response));
  router.get('/admin/senders', requirePageSession('superadmin', '/admin/login'), (request, response) =>
    sendPrivatePage('pages/admin/admin-senders.html', response));
  router.get('/admin/senders/app.js', requireSession('superadmin'), (request, response) =>
    sendPrivateScript('scripts/admin/admin-senders.js', response));
  
  router.get('/api/me', requireSession(), async (request, response) => {
    const session = readSession(request);
    response.set('Cache-Control', 'no-store');
    if (!session) return response.json({ signedIn: false });
    let name = '';
    if (isAdminRole(session.role)) {
      try {
        const result = await pool.query(
          'SELECT name FROM public.admins WHERE email = $1',
          [session.email],
        );
        name = result.rows[0]?.name || '';
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    }
    response.json({
      signedIn: true,
      role: session.role,
      ...(isAdminRole(session.role) ? { name } : {}),
      ...(session.role === 'user'
        ? { email: session.email, identityTag: getIdentityTag(session.email) }
        : { email: session.email }),
    });
  });
  
  router.post('/api/auth/logout', requireSession(), requireBrowserRequest, (request, response) => {
    response.clearCookie(sessionCookie, sessionCookieOptions);
    response.json({ signedOut: true });
  });
  return router;
};
