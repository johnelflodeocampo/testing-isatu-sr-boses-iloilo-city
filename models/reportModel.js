function createReportModel(pool) {
  return {
    async listForMember(identityTag) {
      return pool.query(
        'SELECT * FROM public.member_list_insights($1)',
        [identityTag],
      );
    },

    async getTrackerStatus(trackingId) {
      return pool.query(
        `SELECT tracking_id, status, created_at, updated_at
         FROM public.insights
         WHERE tracking_id = $1
         UNION ALL
         SELECT tracking_id, status, created_at, updated_at
         FROM public.portal_insights
         WHERE tracking_id = $1`,
        [trackingId],
      );
    },

    async createPortalInsight({ trackingId, identityHash, content, isAnonymous, email }) {
      return pool.query(
        `SELECT id, tracking_id, status, created_at
         FROM public.create_portal_insight_with_vault($1, $2, $3, $4, $5)`,
        [trackingId, identityHash, content, isAnonymous, email],
      );
    },

    async listForAdmin(email) {
      return pool.query(
        'SELECT * FROM public.admin_list_insights($1)',
        [email],
      );
    },

    async listPortalInsightsForAdmin(email) {
      return pool.query(
        'SELECT * FROM public.admin_list_portal_insights($1)',
        [email],
      );
    },
  };
}

module.exports = createReportModel;
