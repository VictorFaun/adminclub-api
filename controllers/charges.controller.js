const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const chargesService = require('../services/charges.service');

const list = asyncHandler(async (req, res) => {
  const items = await chargesService.listForClub(req.club.id, req.user.id, req.authContext, req.query);
  return ApiResponse.ok(res, items, 'Cobros obtenidos correctamente.');
});

const listArchived = asyncHandler(async (req, res) => {
  const items = await chargesService.listArchivedForClub(req.club.id, req.query);
  return ApiResponse.ok(res, items, 'Cobros archivados obtenidos correctamente.');
});

const getById = asyncHandler(async (req, res) => {
  const charge = await chargesService.getById(req.club.id, Number(req.params.id));
  return ApiResponse.ok(res, charge, 'Cobro obtenido correctamente.');
});

// CHARGE_CREATED se registra en charges.service.js#create (con el id real), no acá.
const create = asyncHandler(async (req, res) => {
  const charge = await chargesService.create(req.club.id, req.body, req.user.id);
  return ApiResponse.created(res, charge, 'Cobro creado correctamente.');
});

const update = asyncHandler(async (req, res) => {
  const charge = await chargesService.update(req.club.id, Number(req.params.id), req.body, req.user.id);
  return ApiResponse.ok(res, charge, 'Cobro actualizado correctamente.');
});

const remove = asyncHandler(async (req, res) => {
  await chargesService.remove(req.club.id, Number(req.params.id), req.user.id);
  return ApiResponse.ok(res, null, 'Cobro eliminado correctamente.');
});

const archive = asyncHandler(async (req, res) => {
  const charge = await chargesService.archive(req.club.id, Number(req.params.id), req.user.id);
  return ApiResponse.ok(res, charge, 'Cobro archivado correctamente.');
});

const restore = asyncHandler(async (req, res) => {
  const charge = await chargesService.restore(req.club.id, Number(req.params.id), req.user.id);
  return ApiResponse.ok(res, charge, 'Cobro restaurado correctamente.');
});

module.exports = { list, listArchived, getById, create, update, remove, archive, restore };
