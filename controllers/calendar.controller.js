const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const calendarService = require('../services/calendar.service');

const feed = asyncHandler(async (req, res) => {
  const data = await calendarService.getFeed(req.club.id, req.user.id, req.authContext, { from: req.query.from, to: req.query.to });
  return ApiResponse.ok(res, data, 'Calendario obtenido correctamente.');
});

const shareableUsers = asyncHandler(async (req, res) => {
  const data = await calendarService.listShareableUsers(req.club.id, req.user.id);
  return ApiResponse.ok(res, data, 'Usuarios obtenidos correctamente.');
});

const getEvent = asyncHandler(async (req, res) => {
  const data = await calendarService.getEvent(req.club.id, req.user.id, Number(req.params.id));
  return ApiResponse.ok(res, data, 'Evento obtenido correctamente.');
});

const createEvent = asyncHandler(async (req, res) => {
  const data = await calendarService.create(req.club.id, req.user.id, req.body);
  return ApiResponse.created(res, data, 'Evento creado correctamente.');
});

const updateEvent = asyncHandler(async (req, res) => {
  const data = await calendarService.update(req.club.id, req.user.id, Number(req.params.id), req.body);
  return ApiResponse.ok(res, data, 'Evento actualizado correctamente.');
});

const removeEvent = asyncHandler(async (req, res) => {
  await calendarService.remove(req.club.id, req.user.id, Number(req.params.id));
  return ApiResponse.ok(res, null, 'Evento eliminado correctamente.');
});

const leaveEvent = asyncHandler(async (req, res) => {
  await calendarService.leave(req.club.id, req.user.id, Number(req.params.id));
  return ApiResponse.ok(res, null, 'Saliste del evento.');
});

module.exports = { feed, shareableUsers, getEvent, createEvent, updateEvent, removeEvent, leaveEvent };
