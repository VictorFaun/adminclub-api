const usersRepository = require('../repositories/users.repository');
const sessionsRepository = require('../repositories/sessions.repository');
const tokensRepository = require('../repositories/tokens.repository');
const rolesRepository = require('../repositories/roles.repository');
const auditRepository = require('../repositories/audit.repository');
const clubsRepository = require('../repositories/clubs.repository');
const membersRepository = require('../repositories/members.repository');
const chargesRepository = require('../repositories/charges.repository');
const trainingsRepository = require('../repositories/trainings.repository');
const platformSettingsRepository = require('../repositories/platformSettings.repository');
const { withTransaction } = require('../config/database');
const AppError = require('../helpers/AppError');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  generateRandomToken,
  hashToken,
} = require('../helpers/tokenUtils');
const { hashPassword, comparePassword, isStrongPassword } = require('../helpers/passwordUtils');
const permissionService = require('./permission.service');
const emailService = require('./email.service');
const clubsService = require('./clubs.service');
const env = require('../config/env');
const { toAbsoluteMediaUrl } = require('../helpers/mediaUrl');
const { USER_STATUS, TOKEN_TYPE, GLOBAL_ROLES } = require('../config/constants');
const { OAuth2Client } = require('google-auth-library');

/**
 * Mapea una fila de club (snake_case, tal como la devuelve
 * `usersRepository.findClubsForUser`, que incluye además `membership_status`
 * e `is_default` de la tabla puente `user_clubs`) al DTO camelCase estándar,
 * preservando esos dos campos de membresía que `clubsService.toDto` no conoce.
 */
function toClubContextDto(row) {
  if (!row) return null;
  return {
    ...clubsService.toDto(row),
    membership_status: row.membership_status,
    is_default: row.is_default,
    requiresProfileCompletion: !!row.requires_profile_completion,
  };
}

function msFromExpiresIn(expiresIn) {
  const match = /^(\d+)([smhd])$/.exec(expiresIn);
  if (!match) return 15 * 60 * 1000;
  const value = Number(match[1]);
  const unit = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]];
  return value * unit;
}

class AuthService {
  sanitizeUser(user) {
    return {
      id: user.id,
      uuid: user.uuid,
      username: user.username,
      email: user.email,
      avatarUrl: toAbsoluteMediaUrl(user.avatar_url),
      phone: user.phone,
      timezone: user.timezone,
      status: user.status,
      emailVerified: !!user.email_verified_at,
      // `false` para una cuenta creada 100% desde Google (ver `createUserFromGoogle`) — el
      // frontend usa esto para mostrar "Crear contraseña" (dispara el flujo YA EXISTENTE de
      // "¿Olvidaste tu contraseña?", ver loginWithGoogle) en vez de "Cambiar contraseña".
      hasPassword: !!user.password_hash,
      defaultClubId: user.default_club_id,
      createdAt: user.created_at,
    };
  }

  async register({ username, email, password }) {
    const exists = await usersRepository.emailExists(email);
    if (exists) throw AppError.conflict('Ya existe una cuenta registrada con este correo electrónico.');
    // Necesario desde que `username` sirve también para iniciar sesión (uk_users_username,
    // migración 031) — antes era solo un nombre para mostrar, ahora dos personas no pueden
    // compartirlo sin ambigüedad de a cuál de las dos cuentas se refiere el login.
    if (await usersRepository.usernameExists(username)) {
      throw AppError.conflict('Ya existe una cuenta registrada con este nombre de usuario.');
    }
    if (!isStrongPassword(password)) {
      throw AppError.badRequest('La contraseña no cumple con los requisitos de seguridad.');
    }

    const passwordHash = await hashPassword(password);
    const userId = await usersRepository.createUser({
      username,
      email,
      passwordHash,
      status: USER_STATUS.ACTIVE,
      phone: null,
    });

    const user = await usersRepository.findById(userId);
    await this.requestEmailVerification(user);
    await emailService.sendWelcomeEmail(user);

    return this.sanitizeUser(user);
  }

  async requestEmailVerification(user) {
    await tokensRepository.invalidateAllForUser({ userId: user.id, type: TOKEN_TYPE.VERIFY_EMAIL });
    const rawToken = generateRandomToken();
    const expiresAt = new Date(Date.now() + env.tokens.verifyEmailExpiresHours * 3600 * 1000);
    await tokensRepository.create({
      userId: user.id,
      tokenHash: hashToken(rawToken),
      type: TOKEN_TYPE.VERIFY_EMAIL,
      expiresAt,
    });
    await emailService.sendVerificationEmail(user, rawToken);
  }

  async verifyEmail(rawToken) {
    const record = await tokensRepository.findValid({ tokenHash: hashToken(rawToken), type: TOKEN_TYPE.VERIFY_EMAIL });
    if (!record) throw AppError.badRequest('El enlace de verificación es inválido o ha expirado.');

    await usersRepository.setEmailVerified(record.user_id);
    await tokensRepository.markUsed({ id: record.id, type: TOKEN_TYPE.VERIFY_EMAIL });
  }

  async login({ identifier, password, ipAddress, userAgent }) {
    const user = await usersRepository.findByIdentifier(identifier);
    if (!user) throw AppError.unauthorized('Credenciales incorrectas.');

    // Cuenta creada 100% desde Google (`password_hash` NULL, ver `createUserFromGoogle`) —
    // `comparePassword` no puede validar contra `null`, y aunque pudiera, no habría "la
    // contraseña actual" que comparar. Mensaje explícito en vez de "Credenciales incorrectas"
    // genérico, para que el usuario sepa qué hacer (usar Google, o crear una contraseña).
    if (!user.password_hash) {
      throw AppError.unauthorized('Esta cuenta usa Google — inicia sesión con Google o crea una contraseña con "¿Olvidaste tu contraseña?".');
    }

    const passwordMatches = await comparePassword(password, user.password_hash);
    if (!passwordMatches) throw AppError.unauthorized('Credenciales incorrectas.');

    if (user.status === USER_STATUS.SUSPENDED) throw AppError.forbidden('Tu cuenta ha sido suspendida.');
    if (user.status === USER_STATUS.BLOCKED) throw AppError.forbidden('Tu cuenta ha sido bloqueada.');

    const { accessToken, refreshToken } = await withTransaction(async (conn) => {
      const sessionId = await sessionsRepository.createSession({ userId: user.id, ipAddress, userAgent }, conn);
      return this._issueTokenPair({ userId: user.id, sessionId, ipAddress, userAgent }, conn);
    });

    await usersRepository.touchLastLogin(user.id);
    await auditRepository.logAction({
      userId: user.id,
      clubId: null,
      action: 'LOGIN',
      entityType: 'user',
      entityId: user.id,
      changes: null,
      ipAddress,
      userAgent,
    });

    const bootstrap = await this.resolveLoginClubContext(user.id);

    return {
      user: this.sanitizeUser(user),
      accessToken,
      refreshToken,
      ...bootstrap,
    };
  }

  /** Login/registro con Google — verifica el `id_token` que Google Identity Services ya emitió
   * en el navegador (audience = GOOGLE_CLIENT_ID, ver config/env.js#google), sin flujo de
   * redirect/callback ni `client_secret` de por medio (no hace falta: la app es un SPA +
   * Capacitor, no un servidor con sesión propia). Resuelve la cuenta en este orden:
   * 1) ya vinculada por `google_id` → esa;
   * 2) existe una cuenta LOCAL con el mismo correo → se VINCULA (pedido explícito: nunca
   *    duplicar una cuenta por el mismo correo);
   * 3) no existe ninguna → se crea una nueva, 100% desde los datos de Google.
   * Termina con la MISMA cola que `login()` (mismos tokens/sesión/auditoría/bootstrap) para no
   * duplicar esa lógica. */
  async loginWithGoogle({ idToken, ipAddress, userAgent }) {
    if (!env.google.clientId) {
      throw AppError.badRequest('El login con Google no está configurado en este servidor.');
    }

    const client = new OAuth2Client(env.google.clientId);
    let payload;
    try {
      const ticket = await client.verifyIdToken({ idToken, audience: env.google.clientId });
      payload = ticket.getPayload();
    } catch {
      throw AppError.unauthorized('Token de Google inválido o expirado.');
    }
    if (!payload?.sub || !payload.email) throw AppError.unauthorized('Token de Google inválido.');

    let user = await usersRepository.findByGoogleId(payload.sub);
    if (!user) {
      const existingByEmail = await usersRepository.findByEmail(payload.email);
      if (existingByEmail) {
        await usersRepository.linkGoogleId(existingByEmail.id, payload.sub);
        user = await usersRepository.findById(existingByEmail.id);
      } else {
        const username = await this._generateUsernameFromEmail(payload.email);
        const userId = await usersRepository.createUserFromGoogle({
          username,
          email: payload.email,
          googleId: payload.sub,
          avatarUrl: payload.picture || null,
        });
        user = await usersRepository.findById(userId);
        await emailService.sendWelcomeEmail(user);
      }
    }

    if (user.status === USER_STATUS.SUSPENDED) throw AppError.forbidden('Tu cuenta ha sido suspendida.');
    if (user.status === USER_STATUS.BLOCKED) throw AppError.forbidden('Tu cuenta ha sido bloqueada.');

    const { accessToken, refreshToken } = await withTransaction(async (conn) => {
      const sessionId = await sessionsRepository.createSession({ userId: user.id, ipAddress, userAgent }, conn);
      return this._issueTokenPair({ userId: user.id, sessionId, ipAddress, userAgent }, conn);
    });

    await usersRepository.touchLastLogin(user.id);
    await auditRepository.logAction({
      userId: user.id,
      clubId: null,
      action: 'LOGIN',
      entityType: 'user',
      entityId: user.id,
      changes: { provider: 'google' },
      ipAddress,
      userAgent,
    });

    const bootstrap = await this.resolveLoginClubContext(user.id);
    return { user: this.sanitizeUser(user), accessToken, refreshToken, ...bootstrap };
  }

  /** `juan.perez@gmail.com` → `juan.perez`, con sufijo numérico si ya existe (mismo criterio que
   * la desduplicación de `031_username_unique.sql`, pero resuelto en el momento de crear la
   * cuenta en vez de en una migración retroactiva). */
  async _generateUsernameFromEmail(email) {
    const base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'usuario';
    let candidate = base;
    let suffix = 0;
    // eslint-disable-next-line no-await-in-loop
    while (await usersRepository.usernameExists(candidate)) {
      suffix += 1;
      candidate = `${base}${suffix}`;
    }
    return candidate;
  }

  /** Determina el club activo tras login según las reglas de negocio del flujo inicial. */
  async resolveLoginClubContext(userId) {
    const clubs = await usersRepository.findClubsForUser(userId);
    const activeClubs = clubs.filter((c) => c.membership_status === 'active');

    let selectedClubRow = null;
    if (activeClubs.length === 1) {
      selectedClubRow = activeClubs[0];
    } else if (activeClubs.length > 1) {
      selectedClubRow = activeClubs.find((c) => c.is_default) || activeClubs[0];
    }

    const clubId = selectedClubRow ? selectedClubRow.id : null;
    const authorization = await permissionService.buildAuthorizationContext(userId, clubId);
    authorization.hasResponsibleCharges = await this._hasResponsibleCharges(userId, clubId);
    authorization.hasResponsibleTrainings = await this._hasResponsibleTrainings(userId, clubId);
    const user = await usersRepository.findById(userId);

    return {
      clubs: activeClubs.map(toClubContextDto),
      selectedClub: toClubContextDto(selectedClubRow),
      authorization,
      platformTimezone: await this.getPlatformTimezone(),
      userTimezone: user ? user.timezone : null,
    };
  }

  /** `true` si el usuario está vinculado a un miembro (`members.user_id`, ver
   * members.service.js#linkUser) que es responsable de al menos un cobro en este club — solo
   * importa para armar el frontend (mostrar el ítem "Pagos" del menú y dejar pasar el guard de
   * ruta aunque falte VIEW_CHARGES/VIEW_PAYMENTS(_SCOPED), ver treasury-payments-access.guard.ts
   * y permission.middleware.js#requireFunctionOrResponsibleCharge, que hace el chequeo real en
   * cada request — esto es solo para la UI). No se calcula dentro de
   * `permissionService.buildAuthorizationContext` a propósito: ese método corre en CADA request
   * autenticada (vía `requireFunction`), y esto solo hace falta en el bootstrap de sesión. */
  async _hasResponsibleCharges(userId, clubId) {
    if (!clubId) return false;
    const member = await membersRepository.findByUserId(userId, clubId);
    if (!member) return false;
    return chargesRepository.existsResponsibleMember(clubId, member.id);
  }

  /** Mismo criterio EXACTO que `_hasResponsibleCharges`, para "Entrenamientos" — usado por el
   * ítem "Entrenamientos" del menú y `trainings-access.guard.ts`/
   * `permission.middleware.js#requireFunctionOrResponsibleTraining` (que hace el chequeo real). */
  async _hasResponsibleTrainings(userId, clubId) {
    if (!clubId) return false;
    const member = await membersRepository.findByUserId(userId, clubId);
    if (!member) return false;
    return trainingsRepository.existsResponsibleMember(clubId, member.id);
  }

  /**
   * Zona horaria en la que TODA la app debe mostrar fechas/horas (config. de plataforma, ver
   * platformSettings.service.js). Viaja en el bootstrap de sesión (login/`/auth/me`) — no en
   * `GET /platform-settings` — porque ese endpoint exige `VIEW_PLATFORM_SETTINGS` (solo Super
   * Admin), pero CUALQUIER usuario autenticado necesita saber en qué zona horaria interpretar
   * las fechas que ve, no solo quien puede administrar la configuración.
   */
  async getPlatformTimezone() {
    const settings = await platformSettingsRepository.get();
    return settings ? settings.timezone : 'UTC';
  }

  async _issueTokenPair({ userId, sessionId, ipAddress, userAgent }, conn) {
    const accessToken = signAccessToken({ sub: userId });
    const refreshToken = signRefreshToken({ sub: userId, sid: sessionId });
    const expiresAt = new Date(Date.now() + msFromExpiresIn(env.jwt.refreshExpiresIn));

    await sessionsRepository.storeRefreshToken(
      { userId, sessionId, tokenHash: hashToken(refreshToken), expiresAt, ipAddress, userAgent },
      conn
    );

    return { accessToken, refreshToken };
  }

  async refresh({ refreshToken, ipAddress, userAgent }) {
    if (!refreshToken) throw AppError.unauthorized('No se proporcionó un refresh token.');

    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw AppError.unauthorized('Refresh token inválido o expirado.');
    }

    const tokenHash = hashToken(refreshToken);
    const stored = await sessionsRepository.findValidByHash(tokenHash);
    if (!stored) throw AppError.unauthorized('La sesión ha expirado o ya fue cerrada.');

    const user = await usersRepository.findById(payload.sub);
    if (!user || user.status !== USER_STATUS.ACTIVE) throw AppError.unauthorized('Usuario no válido.');

    const { accessToken, refreshToken: newRefreshToken } = await withTransaction(async (conn) => {
      const pair = await this._issueTokenPair(
        { userId: user.id, sessionId: stored.session_id, ipAddress, userAgent },
        conn
      );
      await sessionsRepository.revokeByHash(tokenHash, hashToken(pair.refreshToken), conn);
      if (stored.session_id) await sessionsRepository.touch(stored.session_id, conn);
      return pair;
    });

    return { accessToken, refreshToken: newRefreshToken, user: this.sanitizeUser(user) };
  }

  async logout({ refreshToken }) {
    if (!refreshToken) return;
    const tokenHash = hashToken(refreshToken);
    const stored = await sessionsRepository.findValidByHash(tokenHash);
    await sessionsRepository.revokeByHash(tokenHash);
    if (stored && stored.session_id) await sessionsRepository.deactivate(stored.session_id);
  }

  async logoutAll(userId) {
    await sessionsRepository.revokeAllForUser(userId);
  }

  async forgotPassword(email) {
    const user = await usersRepository.findByEmail(email);
    // Respuesta siempre genérica: no revelar si el correo existe o no.
    if (!user) return;

    await tokensRepository.invalidateAllForUser({ userId: user.id, type: TOKEN_TYPE.RESET_PASSWORD });
    const rawToken = generateRandomToken();
    const expiresAt = new Date(Date.now() + env.tokens.resetPasswordExpiresMin * 60 * 1000);
    await tokensRepository.create({
      userId: user.id,
      tokenHash: hashToken(rawToken),
      type: TOKEN_TYPE.RESET_PASSWORD,
      expiresAt,
    });
    await emailService.sendPasswordResetEmail(user, rawToken);
  }

  async resetPassword({ token, password }) {
    if (!isStrongPassword(password)) {
      throw AppError.badRequest('La contraseña no cumple con los requisitos de seguridad.');
    }
    const record = await tokensRepository.findValid({ tokenHash: hashToken(token), type: TOKEN_TYPE.RESET_PASSWORD });
    if (!record) throw AppError.badRequest('El enlace de recuperación es inválido o ha expirado.');

    const passwordHash = await hashPassword(password);
    await withTransaction(async (conn) => {
      await usersRepository.updatePasswordHash(record.user_id, passwordHash, conn);
      await tokensRepository.markUsed({ id: record.id, type: TOKEN_TYPE.RESET_PASSWORD }, conn);
      await sessionsRepository.revokeAllForUser(record.user_id, conn);
    });
  }

  async changePassword({ userId, currentPassword, newPassword }) {
    if (!isStrongPassword(newPassword)) {
      throw AppError.badRequest('La nueva contraseña no cumple con los requisitos de seguridad.');
    }
    const user = await usersRepository.findById(userId);
    const matches = await comparePassword(currentPassword, user.password_hash);
    if (!matches) throw AppError.unauthorized('La contraseña actual es incorrecta.');

    const passwordHash = await hashPassword(newPassword);
    await usersRepository.updatePasswordHash(userId, passwordHash);
    await sessionsRepository.revokeAllForUser(userId);
  }

  async getContext(userId, clubId) {
    const user = await usersRepository.findById(userId);
    const clubs = await usersRepository.findClubsForUser(userId);
    const authorization = await permissionService.buildAuthorizationContext(userId, clubId || null);
    authorization.hasResponsibleCharges = await this._hasResponsibleCharges(userId, clubId || null);
    authorization.hasResponsibleTrainings = await this._hasResponsibleTrainings(userId, clubId || null);

    let selectedClubRow = clubId ? clubs.find((c) => c.id === Number(clubId)) : null;
    if (clubId && !selectedClubRow && permissionService.hasFunction(authorization, 'VIEW_CLUB')) {
      // No es miembro de este club, pero el contexto de solo lectura (VIEW_ALL_CLUBS/Super
      // Admin, ver permission.service.js) le dio VIEW_CLUB para poder explorarlo: igual le
      // mostramos su info básica para que la UI (nombre, logo, colores) pueda renderizarse.
      selectedClubRow = await clubsRepository.findActiveById(Number(clubId));
    }

    return {
      user: this.sanitizeUser(user),
      clubs: clubs.filter((c) => c.membership_status === 'active').map(toClubContextDto),
      selectedClub: toClubContextDto(selectedClubRow),
      authorization,
      platformTimezone: await this.getPlatformTimezone(),
      userTimezone: user.timezone,
    };
  }

  async setDefaultClub(userId, clubId) {
    const membership = await usersRepository.findMembership(userId, clubId);
    if (!membership || membership.status !== 'active') {
      throw AppError.forbidden('No perteneces a este club.');
    }
    await usersRepository.clearDefaultClub(userId);
    await usersRepository.addToClub({ userId, clubId, status: 'active', isDefault: true });
    await usersRepository.setDefaultClub(userId, clubId);
  }

  isSuperAdmin(globalRoleCodes) {
    return globalRoleCodes.includes(GLOBAL_ROLES.SUPER_ADMIN);
  }
}

module.exports = new AuthService();
