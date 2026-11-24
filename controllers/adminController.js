const express = require('express');

module.exports = function createController(dependencies) {
  const { path, crypto, publicDirectory, privateDirectory, pool, reportModel, draftModel, gasApi, sendPrivatePage, sendPrivateScript, normalizeEmail, getIdentityTag, isIdentityBanned, setSession, readSession, isAdminRole, validateAdminSession, requireSession, requirePageSession, requireBrowserRequest, handleDatabaseError, submissionLimiter, messageLimiter, sessionCookie } = dependencies;
  const router = express.Router();
  const notifyOfficersByEmail = async (notification) => {
    try {
      await gasApi.sendOfficerEmailNotification(notification);
    } catch (error) {
      console.error(JSON.stringify({
        event: 'gas_email_notification_failed',
        notificationType: notification.event,
        trackingId: notification.trackingId,
        error: error.message,
      }));
    }
  };
  const notifyOfficersForReport = async (reportId, event) => {
    try {
      const report = await pool.query(
        'SELECT report_type, tracking_id FROM public.insights WHERE id = $1',
        [reportId],
      );
      if (!report.rowCount) return;
      await notifyOfficersByEmail({
        event,
        reportType: report.rows[0].report_type,
        trackingId: report.rows[0].tracking_id,
      });
    } catch (error) {
      console.error(JSON.stringify({
        event: 'gas_email_notification_metadata_failed',
        notificationType: event,
        reportId,
        error: error.message,
      }));
    }
  };
  const normalizeOfficerName = (value) => {
    if (typeof value !== 'string') return null;
    const name = value.trim();
    return name && name.length <= 120 && !/[\u0000-\u001f\u007f]/.test(name) ? name : null;
  };

  router.post(
    '/api/admin/insights/:id/ban',
    requireSession('superadmin'),
    requireBrowserRequest,
    async (request, response) => {
      const { id } = request.params;
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return response.status(400).json({ error: 'Invalid report ID.' });
      }
      try {
        const result = await pool.query(
          `WITH target AS (
             SELECT identity_hash FROM public.insights WHERE id = $1 AND status <> 'archived'
           ), ban AS (
             INSERT INTO public.banned_identities (identity_hash, banned_by)
             SELECT identity_hash, $2 FROM target
             ON CONFLICT (identity_hash) DO NOTHING
           )
           SELECT identity_hash FROM target`,
          [id, request.session.email],
        );
        if (result.rowCount === 0) {
          return response.status(404).json({ error: 'Report not found.' });
        }
        response.json({ isBanned: true });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );
  
  router.delete(
    '/api/admin/insights/:id/ban',
    requireSession('superadmin'),
    requireBrowserRequest,
    async (request, response) => {
      const { id } = request.params;
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return response.status(400).json({ error: 'Invalid report ID.' });
      }
      try {
        const result = await pool.query(
          `WITH target AS (
             SELECT identity_hash FROM public.insights WHERE id = $1 AND status <> 'archived'
           ), unban AS (
             DELETE FROM public.banned_identities AS b
             USING target
             WHERE b.identity_hash = target.identity_hash
           )
           SELECT identity_hash FROM target`,
          [id],
        );
        if (result.rowCount === 0) {
          return response.status(404).json({ error: 'Report not found.' });
        }
        response.json({ isBanned: false });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );
  
  router.patch(
    '/api/admin/insights/:id/priority',
    requireSession('superadmin'),
    requireBrowserRequest,
    async (request, response) => {
      const { id } = request.params;
      const { priority } = request.body || {};
      if (!/^[0-9a-f-]{36}$/i.test(id)
        || !['low', 'medium', 'high', 'urgent'].includes(priority)) {
        return response.status(400).json({ error: 'Report ID or requested priority is invalid.' });
      }
      try {
        const result = await pool.query(
          `UPDATE public.insights
           SET priority = $1
           WHERE id = $2
             AND status <> 'archived'
             AND report_type = 'concern'
           RETURNING id, priority`,
          [priority, id],
        );
        if (result.rowCount === 0) {
          return response.status(404).json({ error: 'Report not found.' });
        }
        response.json({ insight: result.rows[0] });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );

  router.patch(
    '/api/admin/insights/:id/assignment',
    requireSession('superadmin'),
    requireBrowserRequest,
    async (request, response) => {
      const { id } = request.params;
      const { assignedAdmin } = request.body || {};
      if (!/^[0-9a-f-]{36}$/i.test(id)
        || (assignedAdmin !== null && (typeof assignedAdmin !== 'string'
          || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(students\.)?isatu\.edu\.ph$/i.test(assignedAdmin)))) {
        return response.status(400).json({ error: 'Concern or assigned admin is invalid.' });
      }
      try {
        if (assignedAdmin !== null) {
          const officer = await pool.query(
            'SELECT 1 FROM public.admins WHERE email = $1 AND role = $2',
            [normalizeEmail(assignedAdmin), 'admin'],
          );
          if (officer.rowCount === 0) {
            return response.status(400).json({ error: 'Choose an active admin to assign this concern.' });
          }
        }
        const result = await pool.query(
          `INSERT INTO public.concern_assignments (report_id, assigned_admin, assigned_by, assigned_at)
           SELECT i.id, $2, $3, now()
           FROM public.insights AS i
           WHERE i.id = $1 AND i.report_type = 'concern'
           ON CONFLICT (report_id) DO UPDATE
           SET assigned_admin = EXCLUDED.assigned_admin,
               assigned_by = EXCLUDED.assigned_by,
               assigned_at = EXCLUDED.assigned_at
           RETURNING report_id, assigned_admin, assigned_by, assigned_at`,
          [id, assignedAdmin === null ? null : normalizeEmail(assignedAdmin), request.session.email],
        );
        if (result.rowCount === 0) {
          return response.status(404).json({ error: 'Concern not found.' });
        }
        const assignment = result.rows[0];
        if (assignment.assigned_admin) {
          await notifyOfficersForReport(id, 'assignment');
        }
        response.json({ assignment });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );
  
  router.get(
    '/api/superadmin/admins',
    requireSession('superadmin'),
    async (request, response) => {
      try {
        const result = await pool.query(
          'SELECT * FROM public.superadmin_list_admins_v2($1)',
          [request.session.email],
        );
        response.set('Cache-Control', 'no-store');
        response.json({ admins: result.rows });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );
  
  router.post(
    '/api/superadmin/admins',
    requireSession('superadmin'),
    requireBrowserRequest,
    async (request, response) => {
      const email = normalizeEmail(request.body?.email);
      const name = normalizeOfficerName(request.body?.name);
      const role = request.body?.role;
      if (!email || !name || !['admin', 'superadmin'].includes(role)) {
        return response.status(400).json({ error: 'Enter a valid officer name and ISAT U email, then select an access role.' });
      }
      try {
        const result = await pool.query(
          'SELECT * FROM public.superadmin_manage_admin_v2($1, $2, $3, $4, $5, $6)',
          [request.session.email, 'create', email, role, name, null],
        );
        response.status(201).json({ admin: result.rows[0] });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );
  
  router.patch(
    '/api/superadmin/admins/:email',
    requireSession('superadmin'),
    requireBrowserRequest,
    async (request, response) => {
      const email = normalizeEmail(request.params.email);
      const updatedEmail = normalizeEmail(request.body?.email);
      const name = normalizeOfficerName(request.body?.name);
      const role = request.body?.role;
      if (!email || !updatedEmail || !name || !['admin', 'superadmin'].includes(role)) {
        return response.status(400).json({ error: 'Enter a valid officer name and ISAT U email, then select an access role.' });
      }
      try {
        const result = await pool.query(
          'SELECT * FROM public.superadmin_manage_admin_v2($1, $2, $3, $4, $5, $6)',
          [request.session.email, 'update', email, role, name, updatedEmail],
        );
        response.json({ admin: result.rows[0] });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );
  
  router.delete(
    '/api/superadmin/admins/:email',
    requireSession('superadmin'),
    requireBrowserRequest,
    async (request, response) => {
      const email = normalizeEmail(request.params.email);
      if (!email) {
        return response.status(400).json({ error: 'Enter a valid ISAT U email address.' });
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const unassigned = await client.query(
          `UPDATE public.concern_assignments
           SET assigned_admin = NULL
           WHERE assigned_admin = $1`,
          [email],
        );
        const result = await client.query(
          'SELECT * FROM public.superadmin_manage_admin_v2($1, $2, $3, $4, $5, $6)',
          [request.session.email, 'delete', email, null, null, null],
        );
        await client.query('COMMIT');
        response.json({
          deleted: result.rows[0],
          unassignedConcerns: unassigned.rowCount,
        });
      } catch (error) {
        await client.query('ROLLBACK');
        return handleDatabaseError(error, response);
      } finally {
        client.release();
      }
    },
  );
  
  router.get(
    '/api/my/insights/:id/messages',
    requireSession('member'),
    async (request, response) => {
      const { id } = request.params;
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return response.status(400).json({ error: 'Invalid report ID.' });
      }
      try {
        const identityTag = getIdentityTag(request.session.email);
        const result = await pool.query(
          `SELECT m.id, m.sender_role, m.body, m.is_unsent, m.created_at,
                  (m.sender_role = 'member' AND NOT m.is_unsent) AS can_manage,
                  CASE
                    WHEN m.sender_role = 'officer'
                      THEN COALESCE(NULLIF(sender_admin.name, ''), NULLIF(split_part(m.sender_email, '@', 1), ''), 'Officer')
                    WHEN i.is_anonymous THEN 'Anonymous'
                    ELSE COALESCE(NULLIF(split_part(m.sender_email, '@', 1), ''), split_part($3, '@', 1), 'Submitter')
                  END AS sender_name
           FROM public.insight_messages AS m
           JOIN public.insights AS i ON i.id = m.insight_id
           LEFT JOIN public.admins AS sender_admin ON sender_admin.email = m.sender_email
           WHERE i.id = $1 AND i.identity_hash = $2
           ORDER BY m.created_at ASC, m.id ASC`,
          [id, identityTag, request.session.email],
        );
        const report = await pool.query(
          `SELECT i.chat_enabled, i.status, i.is_anonymous,
                  EXISTS (
                    SELECT 1 FROM public.restricted_message_identities AS r
                    WHERE r.identity_hash = i.identity_hash
                  ) AS message_restricted
           FROM public.insights AS i
           WHERE i.id = $1 AND i.identity_hash = $2`,
          [id, identityTag],
        );
        if (report.rowCount === 0) {
          return response.status(404).json({ error: 'Report not found.' });
        }
        response.set('Cache-Control', 'no-store');
        response.json({
          messages: result.rows,
          chatEnabled: report.rows[0].chat_enabled && report.rows[0].status !== 'archived',
          messageRestricted: report.rows[0].message_restricted,
          isAnonymous: report.rows[0].is_anonymous,
        });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );
  
  router.post(
    '/api/my/insights/:id/messages',
    requireSession('member'),
    requireBrowserRequest,
    messageLimiter,
    async (request, response) => {
      const { id } = request.params;
      const body = typeof request.body?.body === 'string' ? request.body.body.trim() : '';
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return response.status(400).json({ error: 'Invalid report ID.' });
      }
      if (body.length < 1 || body.length > 2000) {
        return response.status(400).json({ error: 'Messages must be 1–2,000 characters.' });
      }
      try {
        const identityTag = getIdentityTag(request.session.email);
        const result = await pool.query(
          `INSERT INTO public.insight_messages (insight_id, sender_role, sender_email, body)
           SELECT i.id, 'member',
                  CASE WHEN i.is_anonymous THEN NULL ELSE split_part($3, '@', 1) END,
                  $4
           FROM public.insights AS i
           WHERE i.id = $1 AND i.identity_hash = $2 AND i.chat_enabled = TRUE
             AND i.status <> 'archived'
             AND NOT EXISTS (
               SELECT 1 FROM public.restricted_message_identities AS r
               WHERE r.identity_hash = i.identity_hash
             )
           RETURNING id, sender_role, body, created_at`,
          [id, getIdentityTag(request.session.email), request.session.email, body],
        );
        if (result.rowCount === 0) {
          const report = await pool.query(
            `SELECT i.chat_enabled, i.status,
                    EXISTS (
                      SELECT 1 FROM public.restricted_message_identities AS r
                      WHERE r.identity_hash = i.identity_hash
                    ) AS message_restricted
             FROM public.insights AS i
             WHERE i.id = $1 AND i.identity_hash = $2`,
            [id, getIdentityTag(request.session.email)],
          );
          if (report.rowCount > 0 && report.rows[0].message_restricted) {
            return response.status(403).json({ error: 'Messaging has been restricted for this sender.' });
          }
          if (report.rowCount > 0 && report.rows[0].status === 'archived') {
            return response.status(403).json({ error: 'Messaging is disabled for archived reports.' });
          }
          if (report.rowCount > 0 && !report.rows[0].chat_enabled) {
            return response.status(403).json({ error: 'Messaging is disabled for this report.' });
          }
          return response.status(404).json({ error: 'Report not found.' });
        }
        await pool.query(
          `INSERT INTO public.notifications
           (recipient_type, recipient_key, insight_id, kind, title, body, link)
           VALUES ('officer', 'all_officers', $1, 'new_message',
                   'New report message',
                   $2,
                   $3)`,
          [
            id,
            'A student sent a new message in a report conversation.',
            `/inbox?report=${encodeURIComponent(id)}`,
          ],
        );
        await notifyOfficersForReport(id, 'new_message');
        response.status(201).json({ message: result.rows[0] });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );
  
  router.post(
    '/api/insights',
    requireSession('member'),
    requireBrowserRequest,
    submissionLimiter,
    async (request, response) => {
      const content = typeof request.body?.content === 'string'
        ? request.body.content.trim()
        : '';
      const reportType = request.body?.reportType;
      const isAnonymous = request.body?.isAnonymous;
      const draftId = request.body?.draftId;
      if (draftId !== undefined && (typeof draftId !== 'string' || !/^[0-9a-f-]{36}$/i.test(draftId))) {
        return response.status(400).json({ error: 'Invalid draft ID.' });
      }
      if (content.length < 10 || content.length > 10000) {
        return response.status(400).json({ error: 'Report details must be 10–10,000 characters.' });
      }
      if (!['concern', 'feedback'].includes(reportType)) {
        return response.status(400).json({ error: 'Choose concern or feedback as the report type.' });
      }
      if (typeof isAnonymous !== 'boolean') {
        return response.status(400).json({ error: 'Choose whether the report should be anonymous.' });
      }
  
      const email = request.session.email;
      const trackingId = `BOSES-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const identityTag = getIdentityTag(email);
  
      try {
        const result = await draftModel.createInsight({
          trackingId,
          identityHash: identityTag,
          reportType,
          content,
          isAnonymous,
          email,
          draftId,
        });
        if (!result) {
          return response.status(404).json({ error: 'Draft not found.' });
        }
        const insight = result.rows[0];
        await pool.query(
          `INSERT INTO public.notifications
           (recipient_type, recipient_key, insight_id, kind, title, body, link)
           VALUES ('officer', 'all_officers', $1, 'new_report',
                   'New report submitted',
                   $2,
                   '/admin')`,
          [insight.id, `${insight.tracking_id} was submitted and is awaiting review.`],
        );
        await notifyOfficersByEmail({
          event: 'new_submission',
          reportType,
          trackingId: insight.tracking_id,
        });
        response.status(201).json({ insight });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );

  router.post(
    '/api/portal-insights',
    requireSession('member'),
    requireBrowserRequest,
    submissionLimiter,
    async (request, response) => {
      const content = typeof request.body?.content === 'string'
        ? request.body.content.trim()
        : '';
      const isAnonymous = request.body?.isAnonymous;
      if (content.length < 10 || content.length > 10000) {
        return response.status(400).json({ error: 'Portal Insights details must be 10–10,000 characters.' });
      }
      if (typeof isAnonymous !== 'boolean') {
        return response.status(400).json({ error: 'Choose whether the Portal Insights submission should be anonymous.' });
      }

      const email = request.session.email;
      const trackingId = `BOSES-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const identityTag = getIdentityTag(email);

      try {
        const result = await reportModel.createPortalInsight({
          trackingId,
          identityHash: identityTag,
          content,
          isAnonymous,
          email,
        });
        const insight = result.rows[0];
        await pool.query(
          `INSERT INTO public.notifications
           (recipient_type, recipient_key, insight_id, portal_insight_id, kind, title, body, link)
           VALUES ('officer', 'all_officers', NULL, $1, 'new_report',
                   'New Portal Insights submission',
                   $2,
                   '/admin/insights')`,
          [insight.id, `${insight.tracking_id} was submitted and is awaiting review.`],
        );
        response.status(201).json({ insight });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );
  
  router.patch(
    '/api/my/insights/:id',
    requireSession('member'),
    requireBrowserRequest,
    async (request, response) => {
      const { id } = request.params;
      const content = typeof request.body?.content === 'string'
        ? request.body.content.trim()
        : '';
      const reportType = request.body?.reportType;
      const isAnonymous = request.body?.isAnonymous;
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return response.status(400).json({ error: 'Invalid report ID.' });
      }
      if (content.length < 10 || content.length > 10000
        || !['concern', 'feedback'].includes(reportType)
        || typeof isAnonymous !== 'boolean') {
        return response.status(400).json({ error: 'Report type, details, or anonymity choice are invalid.' });
      }
  
      try {
        const result = await pool.query(
          `SELECT * FROM public.update_member_insight($1, $2, $3, $4, $5)`,
          [id, getIdentityTag(request.session.email), reportType, content, isAnonymous],
        );
        if (result.rowCount === 0) {
          return response.status(404).json({ error: 'Pending report not found or no longer editable.' });
        }
        response.json({ insight: result.rows[0] });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );
  
  router.delete(
    '/api/my/insights/:id',
    requireSession('member'),
    requireBrowserRequest,
    async (request, response) => {
      const { id } = request.params;
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return response.status(400).json({ error: 'Invalid report ID.' });
      }
      try {
        const result = await pool.query(
          `DELETE FROM public.insights
           WHERE id = $1 AND identity_hash = $2 AND status = 'pending'
           RETURNING id`,
          [id, getIdentityTag(request.session.email)],
        );
        if (result.rowCount === 0) {
          return response.status(404).json({ error: 'Pending report not found or no longer withdrawable.' });
        }
        response.json({ deleted: true });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );
  
  router.get('/api/admin/insights', requireSession('officer'), async (request, response) => {
    try {
      const [result, counts] = await Promise.all([
        reportModel.listForAdmin(request.session.email),
        pool.query(
          `WITH submissions AS (
             SELECT report_type, status, 'insight'::text AS storage_type
             FROM public.insights
             UNION ALL
             SELECT 'feedback'::text AS report_type, status, 'portal_insight'::text AS storage_type
             FROM public.portal_insights
           )
           SELECT count(*) FILTER (WHERE status <> 'archived')::integer AS active,
                  count(*) FILTER (WHERE status = 'pending')::integer AS pending,
                  count(*) FILTER (WHERE report_type = 'concern' AND status = 'reviewing')::integer AS reviewing,
                  count(*) FILTER (WHERE storage_type = 'portal_insight' AND status = 'under_review')::integer AS under_review,
                  count(*) FILTER (WHERE status = 'in_progress')::integer AS in_progress,
                  count(*) FILTER (WHERE status IN ('resolved', 'dismissed', 'implemented', 'not_implemented'))::integer AS completed,
                  count(*) FILTER (WHERE status = 'archived')::integer AS archived
           FROM submissions`,
        ),
      ]);
      response.set('Cache-Control', 'no-store');
      response.json({
        insights: result.rows.filter((insight) => insight.status !== 'archived'),
        counts: counts.rows[0],
        ...(request.session.role === 'superadmin'
          ? { archived: result.rows.filter((insight) => insight.status === 'archived') }
          : {}),
      });
    } catch (error) {
      return handleDatabaseError(error, response);
    }
  });

  router.get('/api/admin/portal-insights', requireSession('officer'), async (request, response) => {
    try {
      const [result, counts] = await Promise.all([
        reportModel.listPortalInsightsForAdmin(request.session.email),
        pool.query(
          `SELECT count(*) FILTER (WHERE status <> 'archived')::integer AS active,
                  count(*) FILTER (WHERE status = 'pending')::integer AS pending,
                  count(*) FILTER (WHERE status = 'under_review')::integer AS under_review,
                  count(*) FILTER (WHERE status = 'in_progress')::integer AS in_progress,
                  count(*) FILTER (WHERE status IN ('resolved', 'implemented', 'not_implemented'))::integer AS completed,
                  count(*) FILTER (WHERE status = 'archived')::integer AS archived
           FROM public.portal_insights`,
        ),
      ]);
      response.set('Cache-Control', 'no-store');
      response.json({
        insights: result.rows.filter((insight) => insight.status !== 'archived'),
        counts: counts.rows[0],
        ...(request.session.role === 'superadmin'
          ? { archived: result.rows.filter((insight) => insight.status === 'archived') }
          : {}),
      });
    } catch (error) {
      return handleDatabaseError(error, response);
    }
  });

  router.patch(
    '/api/admin/portal-insights/:id',
    requireSession('superadmin'),
    requireBrowserRequest,
    async (request, response) => {
      const { id } = request.params;
      const { status } = request.body || {};
      const rawComment = request.body?.statusComment;
      const allowedStatuses = [
        'pending',
        'under_review',
        'in_progress',
        'implemented',
        'not_implemented',
        'resolved',
        'archived',
      ];
      const statusComment = rawComment === undefined || rawComment === null
        ? null
        : typeof rawComment === 'string' && rawComment.trim().length <= 2000
          ? rawComment.trim() || null
          : undefined;
      if (!/^[0-9a-f-]{36}$/i.test(id)
        || !allowedStatuses.includes(status)
        || statusComment === undefined) {
        return response.status(400).json({ error: 'Portal Insights ID or requested status is invalid.' });
      }

      try {
        const result = await pool.query(
          `SELECT insight_id, tracking_id, status, status_comment, status_comment_at
           FROM public.admin_update_portal_insight_status($1, $2, $3, $4)`,
          [id, status, request.session.email, statusComment],
        );
        const updated = result.rows[0];
        const identity = await pool.query(
          'SELECT identity_hash FROM public.portal_insights WHERE id = $1',
          [id],
        );
        if (identity.rowCount) {
          await pool.query(
            `INSERT INTO public.notifications
             (recipient_type, recipient_key, portal_insight_id, kind, title, body, link)
             VALUES ('member', $1, $2, 'status_update',
                     'Portal Insights status updated',
                     $3,
                     $4)`,
            [
              identity.rows[0].identity_hash,
              id,
              `${updated.tracking_id} is now ${status.replaceAll('_', ' ')}.`,
              `/notifications?detail=${encodeURIComponent(id)}`,
            ],
          );
        }
        response.json({
          insight: {
            id: updated.insight_id,
            trackingId: updated.tracking_id,
            status: updated.status,
            statusComment: updated.status_comment,
            statusCommentAt: updated.status_comment_at,
          },
        });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );

  router.delete(
    '/api/admin/portal-insights/:id',
    requireSession('superadmin'),
    requireBrowserRequest,
    async (request, response) => {
      const { id } = request.params;
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return response.status(400).json({ error: 'Invalid Portal Insights ID.' });
      }
      try {
        const result = await pool.query(
          `DELETE FROM public.portal_insights
           WHERE id = $1
           RETURNING id, tracking_id`,
          [id],
        );
        if (result.rowCount === 0) {
          return response.status(404).json({ error: 'Portal Insights submission not found.' });
        }
        response.json({ deleted: result.rows[0] });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );

  const archiveRolloverQuery = `WITH reports AS (
                                  SELECT i.id, i.tracking_id, i.report_type, i.content, i.priority,
                                         i.is_anonymous, i.status, i.chat_enabled, i.created_at, i.updated_at,
                                         i.status_comment, i.status_comment_status, i.status_comment_at,
                                         ca.assigned_admin, 'insight'::text AS storage_type
                                  FROM public.insights AS i
                                  LEFT JOIN public.concern_assignments AS ca ON ca.report_id = i.id
                                  WHERE i.status = 'archived'

                                  UNION ALL

                                  SELECT i.id, i.tracking_id, 'feedback'::text, i.content, i.priority,
                                         i.is_anonymous, i.status, i.chat_enabled, i.created_at, i.updated_at,
                                         i.status_comment, i.status_comment_status, i.status_comment_at,
                                         NULL::text, 'portal_insight'::text
                                  FROM public.portal_insights AS i
                                  WHERE i.status = 'archived'
                                ), messages AS (
                                  SELECT m.insight_id AS report_id, m.id, m.sender_role, m.body, m.is_unsent, m.created_at
                                  FROM public.insight_messages AS m
                                  UNION ALL
                                  SELECT m.portal_insight_id AS report_id, m.id, m.sender_role, m.body, m.is_unsent, m.created_at
                                  FROM public.portal_insight_messages AS m
                                )
                                SELECT r.id, r.tracking_id, r.report_type, r.content, r.priority,
                                       r.is_anonymous, r.status, r.chat_enabled, r.created_at, r.updated_at,
                                       r.status_comment, r.status_comment_status, r.status_comment_at,
                                       r.assigned_admin, r.storage_type,
                                       COALESCE(
                                         jsonb_agg(
                                           jsonb_build_object(
                                             'id', m.id,
                                             'senderRole', m.sender_role,
                                             'body', m.body,
                                             'isUnsent', m.is_unsent,
                                             'createdAt', m.created_at
                                           )
                                           ORDER BY m.created_at, m.id
                                         ) FILTER (WHERE m.id IS NOT NULL),
                                         '[]'::jsonb
                                       ) AS messages
                                FROM reports AS r
                                LEFT JOIN messages AS m ON m.report_id = r.id
                                GROUP BY r.id, r.tracking_id, r.report_type, r.content, r.priority,
                                         r.is_anonymous, r.status, r.chat_enabled, r.created_at, r.updated_at,
                                         r.status_comment, r.status_comment_status, r.status_comment_at,
                                         r.assigned_admin, r.storage_type
                                ORDER BY r.created_at, r.tracking_id`;

  router.get(
    '/api/admin/archive/:id/export',
    requireSession('superadmin'),
    async (request, response) => {
      const { id } = request.params;
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return response.status(400).json({ error: 'Invalid report ID.' });
      }
      try {
        const result = await pool.query(
          `WITH reports AS (
             SELECT i.id, i.tracking_id, i.report_type, i.content, i.priority,
                    i.is_anonymous, i.status, i.chat_enabled, i.created_at, i.updated_at,
                    i.status_comment, i.status_comment_status, i.status_comment_at,
                    ca.assigned_admin, 'insight'::text AS storage_type
             FROM public.insights AS i
             LEFT JOIN public.concern_assignments AS ca ON ca.report_id = i.id
             WHERE i.id = $1 AND i.status = 'archived'

             UNION ALL

             SELECT i.id, i.tracking_id, 'feedback'::text, i.content, i.priority,
                    i.is_anonymous, i.status, i.chat_enabled, i.created_at, i.updated_at,
                    i.status_comment, i.status_comment_status, i.status_comment_at,
                    NULL::text, 'portal_insight'::text
             FROM public.portal_insights AS i
             WHERE i.id = $1 AND i.status = 'archived'
           ), messages AS (
             SELECT m.insight_id AS report_id, m.id, m.sender_role, m.body, m.is_unsent, m.created_at
             FROM public.insight_messages AS m
           )
           SELECT r.id, r.tracking_id, r.report_type, r.content, r.priority,
                  r.is_anonymous, r.status, r.chat_enabled, r.created_at, r.updated_at,
                  r.status_comment, r.status_comment_status, r.status_comment_at,
                  r.assigned_admin, r.storage_type,
                  COALESCE(
                    jsonb_agg(
                      jsonb_build_object(
                        'id', m.id,
                        'senderRole', m.sender_role,
                        'body', m.body,
                        'isUnsent', m.is_unsent,
                        'createdAt', m.created_at
                      )
                      ORDER BY m.created_at, m.id
                    ) FILTER (WHERE m.id IS NOT NULL),
                    '[]'::jsonb
                  ) AS messages
           FROM reports AS r
           LEFT JOIN messages AS m ON m.report_id = r.id
           GROUP BY r.id, r.tracking_id, r.report_type, r.content, r.priority,
                    r.is_anonymous, r.status, r.chat_enabled, r.created_at, r.updated_at,
                    r.status_comment, r.status_comment_status, r.status_comment_at,
                    r.assigned_admin, r.storage_type`,
          [id],
        );
        if (!result.rowCount) {
          return response.status(404).json({ error: 'Archived report not found.' });
        }
        response.set('Cache-Control', 'no-store');
        response.json({ report: result.rows[0] });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );

  router.get(
    '/api/admin/archive/rollover',
    requireSession('superadmin'),
    async (request, response) => {
      try {
        const result = await pool.query(
          archiveRolloverQuery,
        );
        response.set('Cache-Control', 'no-store');
        response.json({
          reports: result.rows,
          rolloverToken: crypto.createHash('sha256').update(JSON.stringify(result.rows)).digest('hex'),
        });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );

  router.delete(
    '/api/admin/archive/rollover',
    requireSession('superadmin'),
    requireBrowserRequest,
    async (request, response) => {
      const { rolloverToken } = request.body || {};
      if (typeof rolloverToken !== 'string' || !/^[0-9a-f]{64}$/i.test(rolloverToken)) {
        return response.status(400).json({ error: 'The archive backup token is invalid.' });
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const archived = await client.query(
          `SELECT id
           FROM public.insights
           WHERE status = 'archived'
           ORDER BY id
           FOR UPDATE`,
        );
        const archivedPortalInsights = await client.query(
          `SELECT id
           FROM public.portal_insights
           WHERE status = 'archived'
           ORDER BY id
           FOR UPDATE`,
        );
        const reportIds = archived.rows.map((report) => report.id);
        const portalInsightIds = archivedPortalInsights.rows.map((insight) => insight.id);
        const allIds = [...reportIds, ...portalInsightIds];
        if (!allIds.length) {
          await client.query('ROLLBACK');
          return response.status(409).json({
            error: 'There are no archived reports to delete.',
          });
        }
        await client.query(
          `SELECT id FROM public.insight_messages
           WHERE insight_id = ANY($1::uuid[]) FOR UPDATE`,
          [reportIds],
        );
        await client.query(
          `SELECT id FROM public.portal_insight_messages
           WHERE portal_insight_id = ANY($1::uuid[]) FOR UPDATE`,
          [portalInsightIds],
        );
        await client.query(
          `SELECT report_id FROM public.concern_assignments
           WHERE report_id = ANY($1::uuid[]) FOR UPDATE`,
          [reportIds],
        );
        const currentArchive = await client.query(archiveRolloverQuery);
        const currentToken = crypto.createHash('sha256')
          .update(JSON.stringify(currentArchive.rows))
          .digest('hex');
        if (currentToken !== rolloverToken) {
          await client.query('ROLLBACK');
          return response.status(409).json({
            error: 'The archive changed after the backup was prepared. Nothing was deleted; refresh and run rollover again.',
          });
        }
        const messages = await client.query(
          `SELECT count(*)::integer AS count
           FROM (
             SELECT id FROM public.insight_messages WHERE insight_id = ANY($1::uuid[])
             UNION ALL
             SELECT id FROM public.portal_insight_messages WHERE portal_insight_id = ANY($2::uuid[])
           ) AS archived_messages`,
          [reportIds, portalInsightIds],
        );
        await client.query(
          `DELETE FROM public.concern_assignments
           WHERE report_id = ANY($1::uuid[])`,
          [reportIds],
        );
        const reports = await client.query(
          `DELETE FROM public.insights
           WHERE id = ANY($1::uuid[]) AND status = 'archived'`,
          [reportIds],
        );
        const portalInsights = await client.query(
          `DELETE FROM public.portal_insights
           WHERE id = ANY($1::uuid[]) AND status = 'archived'`,
          [portalInsightIds],
        );
        const remaining = await client.query(
          `SELECT (
             (SELECT count(*) FROM public.insights WHERE status = 'archived')
             + (SELECT count(*) FROM public.portal_insights WHERE status = 'archived')
           )::integer AS count`,
        );
        await client.query('COMMIT');
        response.json({
          deletedReports: reports.rowCount + portalInsights.rowCount,
          deletedMessages: messages.rows[0].count,
          remainingReports: remaining.rows[0].count,
        });
      } catch (error) {
        await client.query('ROLLBACK');
        return handleDatabaseError(error, response);
      } finally {
        client.release();
      }
    },
  );

  router.get('/api/admin/senders', requireSession('superadmin'), async (request, response) => {
    try {
      const result = await pool.query(
        'SELECT * FROM public.admin_list_senders($1::text)',
        [request.session.email],
      );
      response.set('Cache-Control', 'no-store');
      response.json({ senders: result.rows });
    } catch (error) {
      return handleDatabaseError(error, response);
    }
  });

  router.patch(
    '/api/admin/senders/:senderId/messages',
    requireSession('superadmin'),
    requireBrowserRequest,
    async (request, response) => {
      const { senderId } = request.params;
      const { restricted } = request.body || {};
      if (!/^[0-9a-f]{64}$/i.test(senderId)
        || typeof restricted !== 'boolean') {
        return response.status(400).json({ error: 'Sender ID or message restriction is invalid.' });
      }
      try {
        const sender = await pool.query(
          `SELECT 1
           FROM (
             SELECT identity_hash FROM public.insights
             UNION ALL
             SELECT identity_hash FROM public.portal_insights
           ) AS i
           WHERE i.identity_hash = $1
             AND (
               $2 = 'superadmin'
               OR NOT EXISTS (
                 SELECT 1
                 FROM public.insights AS hidden
                 LEFT JOIN public.concern_assignments AS ca ON ca.report_id = hidden.id
                 WHERE hidden.identity_hash = i.identity_hash
                   AND hidden.report_type = 'concern'
                   AND ca.assigned_admin IS DISTINCT FROM $3
               )
             )
           LIMIT 1`,
          [senderId, request.session.role, request.session.email],
        );
        if (sender.rowCount === 0) {
          return response.status(404).json({ error: 'Sender ID not found.' });
        }
        if (restricted) {
          await pool.query(
            `INSERT INTO public.restricted_message_identities (identity_hash, restricted_by)
             VALUES ($1, $2)
             ON CONFLICT (identity_hash) DO NOTHING`,
            [senderId, request.session.email],
          );
        } else {
          await pool.query(
            'DELETE FROM public.restricted_message_identities WHERE identity_hash = $1',
            [senderId],
          );
        }
        response.json({ senderId, isMessageRestricted: restricted });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );

  router.patch(
    '/api/admin/senders/:senderId/ban',
    requireSession('superadmin'),
    requireBrowserRequest,
    async (request, response) => {
      const { senderId } = request.params;
      const { banned } = request.body || {};
      if (!/^[0-9a-f]{64}$/i.test(senderId)
        || typeof banned !== 'boolean') {
        return response.status(400).json({ error: 'Sender ID or ban setting is invalid.' });
      }
      try {
        const sender = await pool.query(
          `SELECT 1
           FROM (
             SELECT identity_hash FROM public.insights
             UNION ALL
             SELECT identity_hash FROM public.portal_insights
           ) AS submissions
           WHERE identity_hash = $1
           LIMIT 1`,
          [senderId],
        );
        if (sender.rowCount === 0) {
          return response.status(404).json({ error: 'Sender ID not found.' });
        }
        if (banned) {
          await pool.query(
            `INSERT INTO public.banned_identities (identity_hash, banned_by)
             VALUES ($1, $2)
             ON CONFLICT (identity_hash) DO NOTHING`,
            [senderId, request.session.email],
          );
        } else {
          await pool.query(
            'DELETE FROM public.banned_identities WHERE identity_hash = $1',
            [senderId],
          );
        }
        response.json({ senderId, isBanned: banned });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );
  
  router.patch(
    '/api/admin/insights/:id/chat',
    requireSession('officer'),
    requireBrowserRequest,
    async (request, response) => {
      const { id } = request.params;
      const { enabled } = request.body || {};
      if (!/^[0-9a-f-]{36}$/i.test(id) || typeof enabled !== 'boolean') {
        return response.status(400).json({ error: 'Report ID or chat setting is invalid.' });
      }
      try {
        const result = await pool.query(
          `UPDATE public.insights
           SET chat_enabled = $1
           WHERE id = $2 AND status = 'resolved'
             AND (
               report_type <> 'concern'
               OR EXISTS (
                 SELECT 1
                 FROM public.admins AS actor
                 LEFT JOIN public.concern_assignments AS ca ON ca.report_id = public.insights.id
                 WHERE actor.email = $3
                   AND (actor.role = 'superadmin' OR ca.assigned_admin = $3)
               )
             )
           RETURNING id, chat_enabled`,
          [enabled, id, request.session.email],
        );
        if (result.rowCount === 0) {
          const report = await pool.query(
            `SELECT i.id
             FROM public.insights AS i
             WHERE i.id = $1
               AND (
                 i.report_type <> 'concern'
                 OR EXISTS (
                   SELECT 1
                   FROM public.admins AS actor
                   LEFT JOIN public.concern_assignments AS ca ON ca.report_id = i.id
                   WHERE actor.email = $2
                     AND (actor.role = 'superadmin' OR ca.assigned_admin = $2)
                 )
               )`,
            [id, request.session.email],
          );
          if (report.rowCount === 0) {
            return response.status(404).json({ error: 'Report not found.' });
          }
          return response.status(409).json({ error: 'Chat can only be toggled for resolved reports.' });
        }
        response.json({ insight: result.rows[0] });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );
  
  router.get(
    '/api/admin/insights/:id/messages',
    requireSession('officer'),
    async (request, response) => {
      const { id } = request.params;
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return response.status(400).json({ error: 'Invalid report ID.' });
      }
      try {
        const result = await pool.query(
          `SELECT i.id AS insight_id, i.chat_enabled, i.status, i.is_anonymous,
                  m.id AS message_id, m.sender_role, m.body, m.is_unsent, m.created_at,
                  (m.sender_role = 'officer' AND m.sender_email = $2 AND NOT m.is_unsent) AS can_manage,
                  CASE
                    WHEN m.sender_role = 'officer'
                      THEN COALESCE(NULLIF(sender_admin.name, ''), NULLIF(split_part(m.sender_email, '@', 1), ''), 'Officer')
                    WHEN m.sender_role = 'member' AND i.is_anonymous THEN 'Anonymous'
                    WHEN m.sender_role = 'member'
                      THEN COALESCE(NULLIF(split_part(m.sender_email, '@', 1), ''), 'Submitter')
                  END AS sender_name
           FROM public.insights AS i
           LEFT JOIN public.insight_messages AS m ON m.insight_id = i.id
           LEFT JOIN public.admins AS sender_admin ON sender_admin.email = m.sender_email
           WHERE i.id = $1
             AND (
               i.report_type <> 'concern'
               OR EXISTS (
                 SELECT 1
                 FROM public.admins AS actor
                 LEFT JOIN public.concern_assignments AS ca ON ca.report_id = i.id
                 WHERE actor.email = $2
                   AND (actor.role = 'superadmin' OR ca.assigned_admin = $2)
               )
             )
           ORDER BY m.created_at ASC NULLS FIRST, m.id ASC`,
          [id, request.session.email],
        );
        if (result.rowCount === 0) {
          return response.status(404).json({ error: 'Report not found.' });
        }
        const report = result.rows[0];
        response.set('Cache-Control', 'no-store');
        response.json({
          messages: result.rows
            .filter((row) => row.message_id)
            .map(({ message_id, sender_role, body, is_unsent, created_at, sender_name, can_manage }) => ({
              id: message_id,
              sender_role,
              body,
              is_unsent,
              created_at,
              sender_name,
              can_manage,
            })),
          chatEnabled: report.chat_enabled && report.status !== 'archived',
          isAnonymous: report.is_anonymous,
        });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );
  
  router.post(
    '/api/admin/insights/:id/messages',
    requireSession('officer'),
    requireBrowserRequest,
    messageLimiter,
    async (request, response) => {
      const { id } = request.params;
      const body = typeof request.body?.body === 'string' ? request.body.body.trim() : '';
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return response.status(400).json({ error: 'Invalid report ID.' });
      }
      if (body.length < 1 || body.length > 2000) {
        return response.status(400).json({ error: 'Messages must be 1–2,000 characters.' });
      }
      try {
        const result = await pool.query(
          `INSERT INTO public.insight_messages (insight_id, sender_role, sender_email, body)
           SELECT i.id, 'officer', $3, $2
           FROM public.insights AS i
           WHERE i.id = $1 AND i.chat_enabled = TRUE AND i.status <> 'archived'
             AND (
               i.report_type <> 'concern'
               OR EXISTS (
                 SELECT 1
                 FROM public.admins AS actor
                 LEFT JOIN public.concern_assignments AS ca ON ca.report_id = i.id
                 WHERE actor.email = $3
                   AND (actor.role = 'superadmin' OR ca.assigned_admin = $3)
               )
             )
           RETURNING id, sender_role, body, created_at`,
          [id, body, request.session.email],
        );
        if (result.rowCount === 0) {
          const report = await pool.query(
            `SELECT i.chat_enabled, i.status
             FROM public.insights AS i
             WHERE i.id = $1
               AND (
                 i.report_type <> 'concern'
                 OR EXISTS (
                   SELECT 1
                   FROM public.admins AS actor
                   LEFT JOIN public.concern_assignments AS ca ON ca.report_id = i.id
                   WHERE actor.email = $2
                     AND (actor.role = 'superadmin' OR ca.assigned_admin = $2)
                 )
               )`,
            [id, request.session.email],
          );
          if (report.rowCount > 0 && report.rows[0].status === 'archived') {
            return response.status(403).json({ error: 'Messaging is disabled for archived reports.' });
          }
          if (report.rowCount > 0 && !report.rows[0].chat_enabled) {
            return response.status(403).json({ error: 'Messaging is disabled for this report.' });
          }
          return response.status(404).json({ error: 'Report not found.' });
        }
         const identity = await pool.query(
           'SELECT identity_hash, tracking_id FROM public.insights WHERE id = $1',
           [id],
         );
         if (identity.rowCount) {
           await pool.query(
             `INSERT INTO public.notifications
              (recipient_type, recipient_key, insight_id, kind, title, body, link)
              VALUES ('member', $1, $2, 'new_message',
                      'New officer message',
                      $3,
                      $4)`,
             [
               identity.rows[0].identity_hash,
               id,
               `The officer team sent a message about ${identity.rows[0].tracking_id}.`,
               `/inbox?report=${encodeURIComponent(id)}`,
             ],
           );
         }
        response.status(201).json({ message: result.rows[0] });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );

  router.patch(
    '/api/insights/:id/messages/:messageId',
    requireSession(),
    requireBrowserRequest,
    async (request, response) => {
      const { id, messageId } = request.params;
      const body = typeof request.body?.body === 'string' ? request.body.body.trim() : '';
      if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(messageId)) {
        return response.status(400).json({ error: 'Invalid report or message ID.' });
      }
      if (body.length < 1 || body.length > 2000) {
        return response.status(400).json({ error: 'Messages must be 1–2,000 characters.' });
      }

      const officer = isAdminRole(request.session.role);
      const owner = officer ? request.session.email : getIdentityTag(request.session.email);
      const ownership = officer
        ? `m.sender_role = 'officer' AND m.sender_email = $4
           AND (
             i.report_type <> 'concern'
             OR EXISTS (
               SELECT 1
               FROM public.admins AS actor
               LEFT JOIN public.concern_assignments AS ca ON ca.report_id = i.id
               WHERE actor.email = $4
                 AND (actor.role = 'superadmin' OR ca.assigned_admin = $4)
             )
           )`
        : `m.sender_role = 'member' AND i.identity_hash = $4`;
      try {
        const result = await pool.query(
          `UPDATE public.insight_messages AS m
           SET body = $1
           FROM public.insights AS i
           WHERE m.id = $2 AND i.id = $3 AND m.insight_id = i.id AND NOT m.is_unsent
             AND ${ownership}
           RETURNING m.id, m.body, m.created_at`,
          [body, messageId, id, owner],
        );
        if (result.rowCount === 0) {
          return response.status(404).json({ error: 'Message not found or you cannot edit it.' });
        }
        response.json({ message: result.rows[0] });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );

  router.delete(
    '/api/insights/:id/messages/:messageId',
    requireSession(),
    requireBrowserRequest,
    async (request, response) => {
      const { id, messageId } = request.params;
      if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(messageId)) {
        return response.status(400).json({ error: 'Invalid report or message ID.' });
      }

      const officer = isAdminRole(request.session.role);
      const owner = officer ? request.session.email : getIdentityTag(request.session.email);
      const ownership = officer
        ? `m.sender_role = 'officer' AND m.sender_email = $3
           AND (
             i.report_type <> 'concern'
             OR EXISTS (
               SELECT 1
               FROM public.admins AS actor
               LEFT JOIN public.concern_assignments AS ca ON ca.report_id = i.id
               WHERE actor.email = $3
                 AND (actor.role = 'superadmin' OR ca.assigned_admin = $3)
             )
           )`
        : `m.sender_role = 'member' AND i.identity_hash = $3`;
      try {
        const result = await pool.query(
          `UPDATE public.insight_messages AS m
           SET body = 'This message was unsent', is_unsent = TRUE
           FROM public.insights AS i
           WHERE m.id = $1 AND i.id = $2 AND m.insight_id = i.id AND NOT m.is_unsent
             AND ${ownership}
           RETURNING m.id`,
          [messageId, id, owner],
        );
        if (result.rowCount === 0) {
          return response.status(404).json({ error: 'Message not found or you cannot unsend it.' });
        }
        response.json({ unsent: true, messageId: result.rows[0].id });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );
  
  router.patch(
    '/api/admin/insights/:id',
    requireSession('officer'),
    requireBrowserRequest,
    async (request, response) => {
      const { id } = request.params;
      const { status } = request.body || {};
      const rawComment = request.body?.statusComment;
      const allowedStatuses = [
        'pending',
        'reviewing',
        'under_review',
        'in_progress',
        'resolved',
        'dismissed',
        'implemented',
        'not_implemented',
        'archived',
      ];
      const statusComment = rawComment === undefined || rawComment === null
        ? null
        : typeof rawComment === 'string' && rawComment.trim().length <= 2000
          ? rawComment.trim() || null
          : undefined;
      if (!/^[0-9a-f-]{36}$/i.test(id)
        || !allowedStatuses.includes(status)
        || statusComment === undefined) {
        return response.status(400).json({ error: 'Report ID or requested status is invalid.' });
      }
      if (request.session.role !== 'superadmin') {
        try {
          const report = await pool.query(
            'SELECT report_type FROM public.insights WHERE id = $1',
            [id],
          );
          if (report.rowCount === 0) {
            return response.status(404).json({ error: 'Report not found.' });
          }
          if (report.rows[0].report_type === 'feedback') {
            return response.status(403).json({ error: 'Only superadmins can update Portal Insights status.' });
          }
        } catch (error) {
          return handleDatabaseError(error, response);
        }
      }
      if (request.session.role !== 'superadmin' && ['archived', 'pending'].includes(status)) {
        return response.status(403).json({ error: 'Only superadmins can archive or restore reports.' });
      }
  
      try {
        const result = await pool.query(
          `SELECT insight_id, tracking_id, status, status_comment, status_comment_at
           FROM public.admin_update_insight_status($1, $2, $3, $4)`,
          [id, status, request.session.email, statusComment],
        );
        const updated = result.rows[0];
        const reportIdentity = await pool.query(
          'SELECT identity_hash, tracking_id FROM public.insights WHERE id = $1',
          [id],
        );
        if (reportIdentity.rowCount) {
          await pool.query(
            `INSERT INTO public.notifications
             (recipient_type, recipient_key, insight_id, kind, title, body, link)
             VALUES ('member', $1, $2, 'status_update',
                     'Report status updated',
                     $3,
                     $4)`,
            [
              reportIdentity.rows[0].identity_hash,
              id,
              `${reportIdentity.rows[0].tracking_id} is now ${status.replaceAll('_', ' ')}.`,
              `/notifications?detail=${encodeURIComponent(id)}`,
            ],
          );
        }
        response.json({
          insight: {
            id: updated.insight_id,
            trackingId: updated.tracking_id,
            status: updated.status,
            statusComment: updated.status_comment,
            statusCommentAt: updated.status_comment_at,
          },
        });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );

  router.delete(
    '/api/admin/insights/:id',
    requireSession('superadmin'),
    requireBrowserRequest,
    async (request, response) => {
      const { id } = request.params;
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return response.status(400).json({ error: 'Invalid report ID.' });
      }
      try {
        const result = await pool.query(
          `DELETE FROM public.insights
           WHERE id = $1 AND status = 'archived'
           RETURNING id, tracking_id`,
          [id],
        );
        if (result.rowCount === 0) {
          return response.status(404).json({ error: 'Archived report not found.' });
        }
        response.json({ deleted: result.rows[0] });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );
  return router;
};
