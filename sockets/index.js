const { Server } = require('socket.io');
const env = require('../config/env');
const corsOptions = require('../config/cors');
const { verifyAccessToken } = require('../helpers/tokenUtils');
const logger = require('../helpers/logger');
const usersRepository = require('../repositories/users.repository');
const { USER_CLUB_STATUS } = require('../config/constants');

let io = null;

/**
 * Inicializa Socket.IO sobre el servidor HTTP existente. Cada cliente se
 * autentica con el mismo Access Token JWT usado en REST (handshake.auth.token)
 * y se une a una room privada `user:{id}` y, si corresponde, `club:{id}`.
 */
function initSockets(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: corsOptions.origin, credentials: true },
    path: '/socket.io',
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('No autenticado.'));
      const payload = verifyAccessToken(token);
      socket.userId = payload.sub;
      next();
    } catch {
      next(new Error('Token inválido.'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.userId}`);

    // `emitToClub` no se usa todavía en ningún módulo (hoy toda notificación en vivo va por
    // `emitToUser`), pero la room `club:{id}` ya existe y cualquier cliente autenticado con
    // CUALQUIER cuenta podía unirse a la room de CUALQUIER club con solo mandar su id — sin
    // verificar membresía. En sí mismo no filtraba nada porque nadie emite a esa room todavía,
    // pero es exactamente el hueco que se abre en cuanto una función nueva (dashboard en vivo,
    // chat de club, etc.) empiece a usar `emitToClub` para algo sensible. Se verifica membresía
    // activa antes de unir, igual que hace `clubContextMiddleware` para las requests REST.
    socket.on('club:join', async (clubId) => {
      if (!clubId) return;
      try {
        const membership = await usersRepository.findMembership(socket.userId, Number(clubId));
        if (membership && membership.status === USER_CLUB_STATUS.ACTIVE) {
          socket.join(`club:${clubId}`);
        }
      } catch {
        // clubId inválido o error de BD: no unir, sin tumbar la conexión.
      }
    });

    socket.on('club:leave', (clubId) => {
      if (clubId) socket.leave(`club:${clubId}`);
    });

    socket.on('disconnect', () => {
      logger.info(`[socket] Usuario ${socket.userId} desconectado`);
    });
  });

  logger.info('[socket] Socket.IO inicializado.');
  return io;
}

function getIO() {
  if (!io) throw new Error('Socket.IO no ha sido inicializado.');
  return io;
}

/** Emite una notificación en tiempo real a un usuario específico. */
function emitToUser(userId, event, payload) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, payload);
}

/** Emite un evento a todos los miembros conectados de un club. */
function emitToClub(clubId, event, payload) {
  if (!io) return;
  io.to(`club:${clubId}`).emit(event, payload);
}

module.exports = { initSockets, getIO, emitToUser, emitToClub };
