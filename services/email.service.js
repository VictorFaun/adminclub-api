const logger = require('../helpers/logger');
const env = require('../config/env');

/**
 * Servicio de envío de correo. Implementación por defecto: registra el correo
 * en logs (útil en desarrollo). Para producción, sustituir el cuerpo de
 * `send()` por un proveedor real (SES, SendGrid, Postmark, SMTP, etc.) sin
 * tener que tocar ningún otro módulo de la aplicación (los services solo
 * dependen de esta interfaz).
 */
class EmailService {
  async send({ to, subject, html }) {
    // `html` puede traer un token de un solo uso en claro (reset de contraseña, verificación
    // de email) o un código de invitación — logger.info() persiste TODO lo que se le pase a
    // logs/combined.log en disco (ver helpers/logger.js), así que nunca debe llevarse el
    // cuerpo completo ahí: cualquiera con acceso al servidor, a los logs, o a un agregador al
    // que se les envíe ese archivo, podría leer el token y tomar control de la cuenta sin
    // conocer la contraseña. Se imprime en consola (para poder probar el flujo en desarrollo
    // sin un proveedor de correo real) pero NO se persiste a disco.
    // eslint-disable-next-line no-console
    console.log(`[email] -> ${to} | ${subject}\n${html}`);
    logger.info(`[email] -> ${to} | ${subject}`);
    return true;
  }

  async sendVerificationEmail(user, token) {
    const link = `${env.clientUrl}/auth/verify-email?token=${token}`;
    return this.send({
      to: user.email,
      subject: 'Verifica tu correo electrónico',
      html: `<p>Hola ${user.username},</p><p>Verifica tu correo haciendo clic en el siguiente enlace:</p><p><a href="${link}">${link}</a></p>`,
    });
  }

  async sendPasswordResetEmail(user, token) {
    const link = `${env.clientUrl}/auth/reset-password?token=${token}`;
    return this.send({
      to: user.email,
      subject: 'Recupera tu contraseña',
      html: `<p>Hola ${user.username},</p><p>Solicitaste restablecer tu contraseña. Este enlace expira pronto:</p><p><a href="${link}">${link}</a></p>`,
    });
  }

  async sendInvitationEmail(toEmail, club, code) {
    return this.send({
      to: toEmail,
      subject: `Invitación para unirte a ${club.name}`,
      html: `<p>Te invitaron a unirte a <strong>${club.name}</strong>.</p><p>Código de invitación: <strong>${code}</strong></p>`,
    });
  }
}

module.exports = new EmailService();
