const express = require('express');

module.exports = function createController(dependencies) {
  const { path, crypto, appUrl, publicDirectory, privateDirectory, pool, reportModel, draftModel, sendPrivatePage, sendPrivateScript, normalizeEmail, getIdentityTag, isIdentityBanned, setSession, readSession, isAdminRole, validateAdminSession, requireSession, requirePageSession, requireBrowserRequest, handleDatabaseError, submissionLimiter, messageLimiter, sessionCookie } = dependencies;
  const router = express.Router();



  router.get('/api/my/insights', requireSession('member'), async (request, response) => {
    try {
      const identityTag = getIdentityTag(request.session.email);
      const result = await reportModel.listForMember(identityTag);
      response.set('Cache-Control', 'no-store');
      response.json({ insights: result.rows });
    } catch (error) {
      return handleDatabaseError(error, response);
    }
  });

  router.get('/api/my/drafts', requireSession('member'), async (request, response) => {
    try {
      const result = await draftModel.listForMember(getIdentityTag(request.session.email));
      response.set('Cache-Control', 'no-store');
      response.json({ drafts: result.rows });
    } catch (error) {
      return handleDatabaseError(error, response);
    }
  });

  router.post(
    '/api/my/drafts',
    requireSession('member'),
    requireBrowserRequest,
    async (request, response) => {
      const id = request.body?.id;
      const content = typeof request.body?.content === 'string' ? request.body.content.trim() : null;
      const { reportType, isAnonymous } = request.body || {};
      if ((id !== undefined && (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)))
        || content === null
        || content.length > 10000
        || !['concern', 'feedback'].includes(reportType)
        || typeof isAnonymous !== 'boolean') {
        return response.status(400).json({ error: 'Draft details are invalid.' });
      }
      try {
        const result = await draftModel.saveForMember(
          getIdentityTag(request.session.email),
          { id, content, reportType, isAnonymous },
        );
        if (result.rowCount === 0) {
          return response.status(404).json({ error: 'Draft not found.' });
        }
        response.status(id ? 200 : 201).json({ draft: result.rows[0] });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );

  router.delete(
    '/api/my/drafts/:id',
    requireSession('member'),
    requireBrowserRequest,
    async (request, response) => {
      const { id } = request.params;
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return response.status(400).json({ error: 'Invalid draft ID.' });
      }
      try {
        const result = await draftModel.deleteForMember(getIdentityTag(request.session.email), id);
        if (result.rowCount === 0) {
          return response.status(404).json({ error: 'Draft not found.' });
        }
        response.json({ deleted: true });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );
  router.get('/api/tracker/:trackingId', async (request, response) => {
    response.set('Cache-Control', 'no-store');
    const trackingId = request.params.trackingId.toUpperCase();
    if (!/^BOSES-[A-F0-9]{8}$/.test(trackingId)) {
      return response.status(400).json({ error: 'Enter a valid BOSES tracking ID.' });
    }
    try {
      const result = await reportModel.getTrackerStatus(trackingId);
      if (result.rowCount === 0) {
        return response.status(404).json({ error: 'No report was found for that tracking ID.' });
      }
      response.set('Cache-Control', 'no-store');
      response.json({ insight: result.rows[0] });
    } catch (error) {
      return handleDatabaseError(error, response);
    }
  });


  return router;
};
