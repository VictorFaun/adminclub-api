const { PAGINATION } = require('../config/constants');

/**
 * Normaliza query params de paginación/orden a valores seguros.
 * @param {import('express').Request['query']} query
 * @param {string[]} sortableColumns whitelist de columnas ordenables (previene SQL injection en ORDER BY)
 */
function parsePagination(query, sortableColumns = ['created_at']) {
  const page = Math.max(Number(query.page) || PAGINATION.DEFAULT_PAGE, 1);
  const limit = Math.min(Math.max(Number(query.limit) || PAGINATION.DEFAULT_LIMIT, 1), PAGINATION.MAX_LIMIT);
  const offset = (page - 1) * limit;

  let sortBy = String(query.sortBy || sortableColumns[0]);
  if (!sortableColumns.includes(sortBy)) sortBy = sortableColumns[0];

  const sortOrder = String(query.sortOrder || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  return { page, limit, offset, sortBy, sortOrder };
}

function buildMeta({ page, limit, total }) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(Math.ceil(total / limit), 1),
    hasNextPage: page * limit < total,
    hasPrevPage: page > 1,
  };
}

module.exports = { parsePagination, buildMeta };
