/**
 * Envuelve un controller/middleware async y reenvía cualquier rechazo a `next()`,
 * evitando try/catch repetido en cada controller.
 * @param {Function} fn
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
