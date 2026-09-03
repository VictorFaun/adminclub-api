const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const notificationsService = require('../services/notifications.service');

const list = asyncHandler(async (req, res) => {
  const { items, meta, unreadCount } = await notificationsService.listForUser(req.user.id, req.query);
  return ApiResponse.send(res, {
    message: 'Notificaciones obtenidas correctamente.',
    data: items,
    meta: { pagination: meta, unreadCount },
  });
});

const markRead = asyncHandler(async (req, res) => {
  await notificationsService.markRead(req.user.id, Number(req.params.id));
  return ApiResponse.ok(res, null, 'Notificación marcada como leída.');
});

const markAllRead = asyncHandler(async (req, res) => {
  await notificationsService.markAllRead(req.user.id, req.body.clubId);
  return ApiResponse.ok(res, null, 'Todas las notificaciones fueron marcadas como leídas.');
});

const broadcast = asyncHandler(async (req, res) => {
  const count = await notificationsService.broadcastToClub(req.club.id, req.body);
  return ApiResponse.ok(res, { sentTo: count }, 'Notificación enviada correctamente.');
});

module.exports = { list, markRead, markAllRead, broadcast };
