const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const membersService = require('../services/members.service');
const selfService = require('../services/selfService.service');

// Directiva: apoderados de una ficha (miembros vinculados a otro miembro). Primero se revisa que el
// actor pueda ver esa ficha (scope de Miembros) — y también la del apoderado, si se indica.
const assertMember = (req, id = Number(req.params.id)) => membersService.getById(req.club.id, id, req.authContext, req.user.id);

const list = asyncHandler(async (req, res) => {
  await assertMember(req);
  return ApiResponse.ok(res, await selfService.listGuardians(req.club.id, Number(req.params.id)), 'Apoderados obtenidos correctamente.');
});

const wards = asyncHandler(async (req, res) => {
  await assertMember(req);
  return ApiResponse.ok(res, await selfService.listWards(req.club.id, Number(req.params.id)), 'Miembros a cargo obtenidos correctamente.');
});

const add = asyncHandler(async (req, res) => {
  await assertMember(req);
  if (req.body.guardianMemberId) await assertMember(req, Number(req.body.guardianMemberId));
  const data = await selfService.addGuardian(req.club.id, Number(req.params.id), req.body, req.user.id);
  return ApiResponse.ok(res, data, 'Apoderado agregado.');
});

const remove = asyncHandler(async (req, res) => {
  await assertMember(req);
  const data = await selfService.removeGuardian(req.club.id, Number(req.params.id), Number(req.params.guardianId), req.user.id);
  return ApiResponse.ok(res, data, 'Apoderado quitado.');
});

module.exports = { list, wards, add, remove };
