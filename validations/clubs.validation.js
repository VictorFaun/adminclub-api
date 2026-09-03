const { body, param, query } = require('express-validator');
const { isValidTimezone } = require('../helpers/timezones');

const HEX_COLOR = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

const clubId = [param('clubId').isInt({ min: 1 }).withMessage('Identificador de club inválido.')];

const createClub = [
  body('name').trim().notEmpty().withMessage('El nombre del club es obligatorio.').isLength({ max: 150 }),
  body('description').optional({ nullable: true }).trim().isLength({ max: 500 }),
  body('primaryColor').optional().matches(HEX_COLOR).withMessage('Color primario inválido.'),
  body('secondaryColor').optional().matches(HEX_COLOR).withMessage('Color secundario inválido.'),
  body('theme').optional().isIn(['light', 'dark', 'auto']),
  body('isPublic').optional().isBoolean().toBoolean(),
  // Opcional a propósito: si no llega (frontend viejo, o llamada directa a la API sin este
  // campo), clubs.service.js#create cae al default de la configuración de plataforma.
  body('timezone').optional().trim().custom(isValidTimezone).withMessage('Zona horaria inválida.'),
];

const updateClub = [
  ...clubId,
  body('name').optional().trim().isLength({ min: 1, max: 150 }),
  body('description').optional({ nullable: true }).trim().isLength({ max: 500 }),
  body('primaryColor').optional().matches(HEX_COLOR).withMessage('Color primario inválido.'),
  body('secondaryColor').optional().matches(HEX_COLOR).withMessage('Color secundario inválido.'),
  body('theme').optional().isIn(['light', 'dark', 'auto']),
  body('isPublic').optional().isBoolean().toBoolean(),
  body('timezone').optional().trim().custom(isValidTimezone).withMessage('Zona horaria inválida.'),
];

const listPublic = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('search').optional().isString().trim().isLength({ max: 100 }),
];

const joinByCode = [body('code').trim().notEmpty().withMessage('Debes ingresar un código.').isLength({ max: 20 })];

const requestAccess = [...clubId, body('message').optional({ nullable: true }).trim().isLength({ max: 255 })];

const resolveJoinRequest = [
  ...clubId,
  param('requestId').isInt({ min: 1 }),
  body('status').isIn(['approved', 'rejected']).withMessage('Estado inválido.'),
];

const updateSettings = [
  ...clubId,
  body('settings').isObject().withMessage('settings debe ser un objeto.'),
  // Sin esto, dos problemas pasaban en silencio (settings.repository.js#upsertMany hace
  // `String(entries[key])` sin ninguna validación previa): (1) una `setting_key` de más de
  // 100 caracteres no la rechazaba acá, sino que reventaba en el INSERT con
  // ER_DATA_TOO_LONG — error de MySQL que error.middleware.js no mapea, así que salía como
  // 500 genérico en vez de un 422 claro; (2) un valor anidado (objeto/array) no fallaba en
  // ningún punto, simplemente se guardaba el string literal "[object Object]", perdiendo el
  // dato real sin ningún aviso.
  body('settings').custom((settings) => {
    for (const [key, value] of Object.entries(settings)) {
      if (key.length > 100) throw new Error(`La clave "${key}" supera los 100 caracteres permitidos.`);
      if (value !== null && typeof value === 'object') {
        throw new Error(`El valor de "${key}" debe ser texto, número o booleano, no un objeto/arreglo.`);
      }
    }
    return true;
  }),
];

module.exports = { clubId, createClub, updateClub, listPublic, joinByCode, requestAccess, resolveJoinRequest, updateSettings };
