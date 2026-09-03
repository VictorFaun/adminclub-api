const clubsService = require('./clubs.service');
const auditRepository = require('../repositories/audit.repository');
const { parsePagination, buildMeta } = require('../helpers/pagination');

class DashboardService {
  async getOverview(clubId) {
    return clubsService.getStats(clubId);
  }

  async getAuditLogs(clubId, query, isSuperAdmin) {
    const { limit, offset, page } = parsePagination(query, ['created_at']);
    const { rows, total } = await auditRepository.paginateAuditLogs(clubId, { limit, offset });
    // ip_address/user_agent son detalle forense de seguridad, no "quién cambió qué" — se
    // reservan para Super Admin. Cualquier admin de club con VIEW_AUDIT_LOGS (es
    // club-assignable, ver 003_functions_visibility.sql) puede ver esta vista.
    const items = isSuperAdmin ? rows : rows.map(({ ip_address, user_agent, ...rest }) => rest);
    return { items, meta: buildMeta({ page, limit, total }) };
  }
}

module.exports = new DashboardService();
