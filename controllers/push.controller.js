const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const pushService = require('../services/push.service');

const config = asyncHandler(async (req, res) => ApiResponse.ok(res, pushService.getConfig(), 'Configuración de notificaciones push.'));

const subscribe = asyncHandler(async (req, res) => {
  await pushService.subscribe(req.user.id, req.sessionId, req.body, req.headers['user-agent']);
  return ApiResponse.ok(res, null, 'Notificaciones activadas en este dispositivo.');
});

const unsubscribe = asyncHandler(async (req, res) => {
  await pushService.unsubscribe(req.user.id, req.body.endpoint);
  return ApiResponse.ok(res, null, 'Notificaciones desactivadas en este dispositivo.');
});

const test = asyncHandler(async (req, res) => {
  const devices = await pushService.sendTest(req.user.id);
  return ApiResponse.ok(res, { devices }, 'Aviso de prueba enviado.');
});

module.exports = { config, subscribe, unsubscribe, test };
