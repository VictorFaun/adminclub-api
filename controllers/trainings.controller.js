const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const trainingsService = require('../services/trainings.service');

const list = asyncHandler(async (req, res) => {
  const items = await trainingsService.listForClub(req.club.id, req.user.id, req.authContext, req.query);
  return ApiResponse.ok(res, items, 'Entrenamientos obtenidos correctamente.');
});

const listArchived = asyncHandler(async (req, res) => {
  const items = await trainingsService.listArchivedForClub(req.club.id, req.query);
  return ApiResponse.ok(res, items, 'Entrenamientos archivados obtenidos correctamente.');
});

const getById = asyncHandler(async (req, res) => {
  const training = await trainingsService.getById(req.club.id, Number(req.params.id));
  return ApiResponse.ok(res, training, 'Entrenamiento obtenido correctamente.');
});

const create = asyncHandler(async (req, res) => {
  const training = await trainingsService.create(req.club.id, req.body, req.user.id);
  return ApiResponse.created(res, training, 'Entrenamiento creado correctamente.');
});

const update = asyncHandler(async (req, res) => {
  const training = await trainingsService.update(req.club.id, Number(req.params.id), req.body, req.user.id);
  return ApiResponse.ok(res, training, 'Entrenamiento actualizado correctamente.');
});

const remove = asyncHandler(async (req, res) => {
  await trainingsService.remove(req.club.id, Number(req.params.id), req.user.id);
  return ApiResponse.ok(res, null, 'Entrenamiento eliminado correctamente.');
});

const archive = asyncHandler(async (req, res) => {
  const training = await trainingsService.archive(req.club.id, Number(req.params.id), req.user.id);
  return ApiResponse.ok(res, training, 'Entrenamiento archivado correctamente.');
});

const restore = asyncHandler(async (req, res) => {
  const training = await trainingsService.restore(req.club.id, Number(req.params.id), req.user.id);
  return ApiResponse.ok(res, training, 'Entrenamiento restaurado correctamente.');
});

module.exports = { list, listArchived, getById, create, update, remove, archive, restore };
