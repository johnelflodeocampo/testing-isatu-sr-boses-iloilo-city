function createDraftModel(pool) {
  return {
    async listForMember(identityHash) {
      return pool.query(
        `SELECT id, report_type, content, is_anonymous, created_at, updated_at
         FROM public.member_drafts
         WHERE identity_hash = $1
         ORDER BY updated_at DESC`,
        [identityHash],
      );
    },

    async saveForMember(identityHash, draft) {
      if (draft.id) {
        return pool.query(
          `UPDATE public.member_drafts
           SET report_type = $1, content = $2, is_anonymous = $3, updated_at = now()
           WHERE id = $4 AND identity_hash = $5
           RETURNING id, report_type, content, is_anonymous, created_at, updated_at`,
          [draft.reportType, draft.content, draft.isAnonymous, draft.id, identityHash],
        );
      }

      return pool.query(
        `INSERT INTO public.member_drafts (identity_hash, report_type, content, is_anonymous)
         VALUES ($1, $2, $3, $4)
         RETURNING id, report_type, content, is_anonymous, created_at, updated_at`,
        [identityHash, draft.reportType, draft.content, draft.isAnonymous],
      );
    },

    async deleteForMember(identityHash, id) {
      return pool.query(
        'DELETE FROM public.member_drafts WHERE id = $1 AND identity_hash = $2 RETURNING id',
        [id, identityHash],
      );
    },

    async createInsight({ trackingId, identityHash, reportType, content, isAnonymous, email, draftId }) {
      if (!draftId) {
        return pool.query(
          `SELECT id, tracking_id, status, created_at
           FROM public.create_insight_with_vault($1, $2, $3, $4, $5, $6)`,
          [trackingId, identityHash, reportType, content, isAnonymous, email],
        );
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const draft = await client.query(
          `UPDATE public.member_drafts
           SET report_type = $1, content = $2, is_anonymous = $3, updated_at = now()
           WHERE id = $4 AND identity_hash = $5
           RETURNING id`,
          [reportType, content, isAnonymous, draftId, identityHash],
        );
        if (draft.rowCount === 0) {
          await client.query('ROLLBACK');
          return null;
        }

        const result = await client.query(
          `SELECT id, tracking_id, status, created_at
           FROM public.create_insight_with_vault($1, $2, $3, $4, $5, $6)`,
          [trackingId, identityHash, reportType, content, isAnonymous, email],
        );
        await client.query(
          'DELETE FROM public.member_drafts WHERE id = $1 AND identity_hash = $2',
          [draftId, identityHash],
        );
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

module.exports = createDraftModel;
