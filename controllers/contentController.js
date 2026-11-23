const express = require('express');
const sanitizePrivacyHtml = require('../lib/privacyHtml');

module.exports = function createController({
  pool,
  privacyNoticeStore,
  requireSession,
  requireBrowserRequest,
  handleDatabaseError,
}) {
  const router = express.Router();
  const categoryTypes = {
    faq: { table: 'knowledge_base_entries', defaultName: 'General' },
  };

  function getCategoryType(value) {
    return typeof value === 'string' ? categoryTypes[value] || null : null;
  }

  async function resourceCategoryExists(resourceType, name) {
    const result = await pool.query(
      `SELECT 1
       FROM public.resource_categories
       WHERE resource_type = $1 AND lower(name) = lower($2)`,
      [resourceType, name],
    );
    return result.rowCount > 0;
  }

  function readText(value, maxLength, fallback) {
    if (value === undefined && fallback !== undefined) return fallback;
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return text.length > 0 && text.length <= maxLength && !text.includes('\0') ? text : null;
  }

  function readId(value) {
    return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
  }

  function readKnowledgeBaseEntry(body) {
    const category = readText(body?.category, 80);
    const question = readText(body?.question, 240);
    const answer = readText(body?.answer, 12000);
    return category && question && answer ? { category, question, answer } : null;
  }

  function readPrivacyNotice(body) {
    const title = readText(body?.title, 40);
    const content = typeof body?.body === 'string' && !body.body.includes('\0')
      ? sanitizePrivacyHtml(body.body)
      : null;
    if (content && (content.length > 10000 || !content.replace(/<[^>]*>/g, '').trim())) return null;
    return title && content ? { title, body: content } : null;
  }

  router.get('/api/resources', async (request, response) => {
    try {
      const [knowledgeBase, categories] = await Promise.all([
        pool.query(
          `SELECT id, category, question, answer, updated_at
           FROM public.knowledge_base_entries
           ORDER BY lower(category), lower(question)`,
        ),
        pool.query(
          `SELECT id, resource_type, name
           FROM public.resource_categories
           WHERE resource_type = 'faq'
           ORDER BY lower(name)`,
        ),
      ]);
      response.set('Cache-Control', 'no-store');
      response.json({
        knowledgeBase: knowledgeBase.rows,
        categories: { faq: categories.rows },
      });
    } catch (error) {
      return handleDatabaseError(error, response);
    }
  });

  router.post(
    '/api/admin/resource-categories/:resourceType',
    requireSession('officer'),
    requireBrowserRequest,
    async (request, response) => {
      if (!getCategoryType(request.params.resourceType)) {
      return response.status(400).json({ error: 'Choose the FAQ category type.' });
      }
      const name = readText(request.body?.name, 80);
      if (!name) return response.status(400).json({ error: 'Enter a category name up to 80 characters.' });
      try {
        const result = await pool.query(
          `INSERT INTO public.resource_categories (resource_type, name, created_by)
           VALUES ($1, $2, $3)
           RETURNING id, resource_type, name`,
          [request.params.resourceType, name, request.session.email],
        );
        response.status(201).json({ category: result.rows[0] });
      } catch (error) {
        if (error.code === '23505') {
          return response.status(409).json({ error: 'A category with this name already exists.' });
        }
        return handleDatabaseError(error, response);
      }
    },
  );

  router.put(
    '/api/admin/resource-categories/:resourceType/:id',
    requireSession('officer'),
    requireBrowserRequest,
    async (request, response) => {
      const config = getCategoryType(request.params.resourceType);
      const name = readText(request.body?.name, 80);
      if (!config || !readId(request.params.id) || !name) {
        return response.status(400).json({ error: 'Category ID or name is invalid.' });
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const existing = await client.query(
          `SELECT id, name
           FROM public.resource_categories
           WHERE id = $1 AND resource_type = $2
           FOR UPDATE`,
          [request.params.id, request.params.resourceType],
        );
        if (!existing.rowCount) {
          await client.query('ROLLBACK');
          return response.status(404).json({ error: 'Category not found.' });
        }
        if (existing.rows[0].name.toLocaleLowerCase() === config.defaultName.toLocaleLowerCase()
          && name.toLocaleLowerCase() !== config.defaultName.toLocaleLowerCase()) {
          await client.query('ROLLBACK');
          return response.status(400).json({ error: 'The default category cannot be renamed.' });
        }
        const duplicate = await client.query(
          `SELECT 1
           FROM public.resource_categories
           WHERE resource_type = $1 AND lower(name) = lower($2) AND id <> $3`,
          [request.params.resourceType, name, request.params.id],
        );
        if (duplicate.rowCount) {
          await client.query('ROLLBACK');
          return response.status(409).json({ error: 'A category with this name already exists.' });
        }
        await client.query(
          `UPDATE public.${config.table}
           SET category = $1, updated_by = $2, updated_at = now()
           WHERE lower(category) = lower($3)`,
          [name, request.session.email, existing.rows[0].name],
        );
        const updated = await client.query(
          `UPDATE public.resource_categories
           SET name = $1
           WHERE id = $2 AND resource_type = $3
           RETURNING id, resource_type, name`,
          [name, request.params.id, request.params.resourceType],
        );
        await client.query('COMMIT');
        response.json({ category: updated.rows[0] });
      } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') {
          return response.status(409).json({ error: 'A category with this name already exists.' });
        }
        return handleDatabaseError(error, response);
      } finally {
        client.release();
      }
    },
  );

  router.delete(
    '/api/admin/resource-categories/:resourceType/:id',
    requireSession('officer'),
    requireBrowserRequest,
    async (request, response) => {
      const config = getCategoryType(request.params.resourceType);
      if (!config || !readId(request.params.id)) {
        return response.status(400).json({ error: 'Category type or ID is invalid.' });
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const existing = await client.query(
          `SELECT id, name
           FROM public.resource_categories
           WHERE id = $1 AND resource_type = $2
           FOR UPDATE`,
          [request.params.id, request.params.resourceType],
        );
        if (!existing.rowCount) {
          await client.query('ROLLBACK');
          return response.status(404).json({ error: 'Category not found.' });
        }
        if (existing.rows[0].name.toLocaleLowerCase() === config.defaultName.toLocaleLowerCase()) {
          await client.query('ROLLBACK');
          return response.status(400).json({ error: 'The default category cannot be deleted.' });
        }
        await client.query(
          `INSERT INTO public.resource_categories (resource_type, name, created_by)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [request.params.resourceType, config.defaultName, request.session.email],
        );
        const moved = await client.query(
          `UPDATE public.${config.table}
           SET category = $1, updated_by = $2, updated_at = now()
           WHERE lower(category) = lower($3)`,
          [config.defaultName, request.session.email, existing.rows[0].name],
        );
        await client.query(
          'DELETE FROM public.resource_categories WHERE id = $1 AND resource_type = $2',
          [request.params.id, request.params.resourceType],
        );
        await client.query('COMMIT');
        response.json({ deleted: true, reassigned: moved.rowCount, defaultCategory: config.defaultName });
      } catch (error) {
        await client.query('ROLLBACK');
        return handleDatabaseError(error, response);
      } finally {
        client.release();
      }
    },
  );

  router.get('/api/privacy-notice', requireSession(), async (request, response) => {
    try {
      response.set('Cache-Control', 'no-store');
      const notice = await privacyNoticeStore.read();
      if (notice) notice.body = sanitizePrivacyHtml(notice.body);
      response.json({ notice });
    } catch (error) {
      console.error('Privacy notice read failed:', error.message);
      response.status(500).json({ error: 'The privacy notice could not be read.' });
    }
  });

  router.post(
    '/api/admin/knowledge-base',
    requireSession('officer'),
    requireBrowserRequest,
    async (request, response) => {
      const entry = readKnowledgeBaseEntry(request.body);
      if (!entry) return response.status(400).json({ error: 'Enter a category, question, and answer within the stated limits.' });
      try {
        if (!(await resourceCategoryExists('faq', entry.category))) {
          return response.status(400).json({ error: 'Choose a category from the FAQ category list.' });
        }
        const result = await pool.query(
          `INSERT INTO public.knowledge_base_entries
             (category, question, answer, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $4)
           RETURNING id, category, question, answer, updated_at`,
          [entry.category, entry.question, entry.answer, request.session.email],
        );
        response.status(201).json({ entry: result.rows[0] });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );

  router.put(
    '/api/admin/knowledge-base/:id',
    requireSession('officer'),
    requireBrowserRequest,
    async (request, response) => {
      const entry = readKnowledgeBaseEntry(request.body);
      if (!readId(request.params.id) || !entry) {
        return response.status(400).json({ error: 'Entry ID, category, question, or answer is invalid.' });
      }
      try {
        if (!(await resourceCategoryExists('faq', entry.category))) {
          return response.status(400).json({ error: 'Choose a category from the FAQ category list.' });
        }
        const result = await pool.query(
          `UPDATE public.knowledge_base_entries
           SET category = $1, question = $2, answer = $3,
               updated_by = $4, updated_at = now()
           WHERE id = $5
           RETURNING id, category, question, answer, updated_at`,
          [entry.category, entry.question, entry.answer, request.session.email, request.params.id],
        );
        if (!result.rowCount) return response.status(404).json({ error: 'Knowledge base entry not found.' });
        response.json({ entry: result.rows[0] });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );

  router.delete(
    '/api/admin/knowledge-base/:id',
    requireSession('officer'),
    requireBrowserRequest,
    async (request, response) => {
      if (!readId(request.params.id)) return response.status(400).json({ error: 'Entry ID is invalid.' });
      try {
        const result = await pool.query(
          'DELETE FROM public.knowledge_base_entries WHERE id = $1',
          [request.params.id],
        );
        if (!result.rowCount) return response.status(404).json({ error: 'Knowledge base entry not found.' });
        response.json({ deleted: true });
      } catch (error) {
        return handleDatabaseError(error, response);
      }
    },
  );

  router.post(
    '/api/superadmin/privacy-notice',
    requireSession('superadmin'),
    requireBrowserRequest,
    async (request, response) => {
      const notice = readPrivacyNotice(request.body);
      if (!notice) return response.status(400).json({ error: 'Enter a title and notice text within the stated limits.' });
      try {
        const storedNotice = { ...notice, updated_at: new Date().toISOString() };
        const created = await privacyNoticeStore.create(storedNotice);
        if (!created) {
          return response.status(409).json({ error: 'A privacy notice already exists. Edit the existing notice instead.' });
        }
        response.status(201).json({ notice: created });
      } catch (error) {
        console.error('Privacy notice database write failed:', error.message);
        response.status(500).json({ error: 'The privacy notice could not be saved.' });
      }
    },
  );

  router.put(
    '/api/superadmin/privacy-notice',
    requireSession('superadmin'),
    requireBrowserRequest,
    async (request, response) => {
      const notice = readPrivacyNotice(request.body);
      if (!notice) return response.status(400).json({ error: 'Enter a title and notice text within the stated limits.' });
      try {
        const existingNotice = await privacyNoticeStore.read();
        if (!existingNotice) return response.status(404).json({ error: 'Privacy notice not found.' });
        const storedNotice = { ...notice, updated_at: new Date().toISOString() };
        const updatedNotice = await privacyNoticeStore.write(storedNotice);
        response.json({ notice: updatedNotice });
      } catch (error) {
        console.error('Privacy notice database write failed:', error.message);
        response.status(500).json({ error: 'The privacy notice could not be saved.' });
      }
    },
  );

  router.delete(
    '/api/superadmin/privacy-notice',
    requireSession('superadmin'),
    requireBrowserRequest,
    async (request, response) => {
      try {
        const removed = await privacyNoticeStore.remove();
        if (!removed) return response.status(404).json({ error: 'Privacy notice not found.' });
        response.json({ deleted: true });
      } catch (error) {
        console.error('Privacy notice database delete failed:', error.message);
        response.status(500).json({ error: 'The privacy notice could not be deleted.' });
      }
    },
  );

  return router;
};
