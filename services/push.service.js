const webpush = require('web-push');
const pushSubscriptionsRepository = require('../repositories/pushSubscriptions.repository');
const AppError = require('../helpers/AppError');
const logger = require('../helpers/logger');
const { hashToken } = require('../helpers/tokenUtils');
const env = require('../config/env');

/** Cuánto guarda el servicio push del fabricante un aviso si el dispositivo está apagado. */
const TTL_SECONDS = 3 * 24 * 3600;
/** Tras tantos fallos seguidos (que no sean 404/410) la suscripción se descarta. */
const MAX_FAILURES = 10;
const MAX_BODY = 180;
const ICON = '/assets/icon/icon-192.png';
const BADGE = '/assets/icon/badge-96.png';

const enabled = !!(env.push.vapidPublicKey && env.push.vapidPrivateKey);
if (enabled) {
  try {
    webpush.setVapidDetails(env.push.vapidSubject, env.push.vapidPublicKey, env.push.vapidPrivateKey);
    logger.info('[push] Notificaciones push activas (VAPID configurado).');
  } catch (error) {
    logger.error('[push] Claves VAPID inválidas: push desactivado.', { error: error.message });
  }
} else {
  logger.info('[push] Sin VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY: notificaciones push desactivadas.');
}

const truncate = (text, max) => {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

/**
 * Notificaciones push (Web Push estándar, sin Firebase): el aviso del sistema operativo que llega
 * aunque la app esté cerrada. Es solo el AVISO — la notificación completa vive en `notifications`
 * (ver notifications.service.js#notifyUser, que llama a `sendToUser`) y se abre en la app.
 *
 * Cada suscripción va ligada a la sesión con que se activó (sql/067): llega a todos los
 * dispositivos de la cuenta con sesión abierta que activaron el push, y deja de llegar al cerrar
 * esa sesión (auth.service.js borra sus suscripciones).
 */
class PushService {
  get enabled() {
    return enabled;
  }

  getConfig() {
    return { enabled, publicKey: enabled ? env.push.vapidPublicKey : null };
  }

  _assertSubscription(sub) {
    const endpoint = sub?.endpoint;
    const p256dh = sub?.keys?.p256dh;
    const auth = sub?.keys?.auth;
    if (typeof endpoint !== 'string' || !/^https:\/\//i.test(endpoint) || endpoint.length > 2000) {
      throw AppError.badRequest('Suscripción push inválida.');
    }
    if (typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 255 || auth.length > 255) {
      throw AppError.badRequest('Suscripción push inválida.');
    }
    return { endpoint, p256dh, auth };
  }

  /** Guarda (o reasigna a esta cuenta y sesión) la suscripción del navegador. */
  async subscribe(userId, sessionId, subscription, userAgent) {
    if (!enabled) throw AppError.badRequest('Las notificaciones push no están configuradas en este servidor.');
    const { endpoint, p256dh, auth } = this._assertSubscription(subscription);
    await pushSubscriptionsRepository.upsert({
      userId,
      sessionId: sessionId || null,
      endpoint,
      endpointHash: hashToken(endpoint),
      p256dh,
      auth,
      userAgent: userAgent ? String(userAgent).slice(0, 255) : null,
    });
  }

  async unsubscribe(userId, endpoint) {
    if (typeof endpoint !== 'string' || !endpoint) return;
    await pushSubscriptionsRepository.deleteByHashForUser(hashToken(endpoint), userId);
  }

  /** Aviso de prueba a todos mis dispositivos con push activo. Devuelve a cuántos se intentó. */
  async sendTest(userId) {
    if (!enabled) throw AppError.badRequest('Las notificaciones push no están configuradas en este servidor.');
    const subs = await pushSubscriptionsRepository.findDeliverableByUsers([userId]);
    if (!subs.length) throw AppError.badRequest('No tienes dispositivos con las notificaciones activadas.');
    await this._deliver(subs, {
      title: 'Notificaciones activas',
      body: 'Así te avisaremos de las novedades de tu club.',
      url: '/notifications',
      tag: 'push-test',
    });
    return subs.length;
  }

  /** Fire and forget: nunca lanza ni demora a quien llama (ver notifications.service.js). */
  sendToUser(userId, message) {
    if (!enabled) return;
    pushSubscriptionsRepository
      .findDeliverableByUsers([userId])
      .then((subs) => this._deliver(subs, message))
      .catch((error) => logger.error('[push] Error enviando push', { userId, error: error.message }));
  }

  async _deliver(subs, { title, body, url, tag }) {
    const payload = JSON.stringify({
      title: truncate(title, 80),
      body: truncate(body, MAX_BODY),
      url: url || '/notifications',
      tag: tag || undefined,
      icon: ICON,
      badge: BADGE,
    });
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
            TTL: TTL_SECONDS,
            urgency: 'high',
          });
          await pushSubscriptionsRepository.markSuccess(s.id);
        } catch (error) {
          // 404/410: la suscripción ya no existe (app desinstalada, permiso revocado...).
          if (error.statusCode === 404 || error.statusCode === 410) {
            await pushSubscriptionsRepository.deleteById(s.id);
          } else {
            logger.error('[push] Envío rechazado', { subscriptionId: s.id, status: error.statusCode, error: error.body || error.message });
            await pushSubscriptionsRepository.addFailure(s.id);
          }
        }
      })
    );
  }

  async purgeFailing() {
    return pushSubscriptionsRepository.purgeFailing(MAX_FAILURES);
  }
}

module.exports = new PushService();
