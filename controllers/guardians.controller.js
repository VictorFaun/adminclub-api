const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const membersService = require('../services/members.service');
const selfService = require('../services/selfService.service');

// Directiva: apoderados de una ficha. Primero se revisa que el actor pueda ver esa ficha (scope de Miembros).
const assertMember = (req) => membersService.getById(req.club.id, Number(req.params.id), req.authContext, req.user.id);

const list = asyncHandler(async (req, res) => {
  await assertMember(req);
  return ApiResponse.ok(res, await selfService.listGuardians(req.club.id, Number(req.params.id)), 'Apoderados obtenidos correctamente.');
});

const add = asyncHandler(async (req, res) => {
  await assertMember(req);
  const data = await selfService.addGuardian(req.club.id, Number(req.params.id), req.body, req.user.id);
  return ApiResponse.ok(res, data, 'Apoderado agregado.');
});

const remove = asyncHandler(async (req, res) => {
  await assertMember(req);
  const data = await selfService.removeGuardian(req.club.id, Number(req.params.id), Number(req.params.userId), req.user.id);
  return ApiResponse.ok(res, data, 'Apoderado quitado.');
});

module.exports = { list, add, remove };
