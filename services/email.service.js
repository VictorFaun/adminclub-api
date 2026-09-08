const { Resend } = require('resend');
const logger = require('../helpers/logger');
const env = require('../config/env');
const { renderPlatformEmail, renderClubEmail } = require('../helpers/emailTemplate');

// `null` mientras no haya API key — `send()` cae a loguear en consola (comportamiento de
// siempre), no rompe ningún flujo que ya dependa de este service (ver RESEND_EMAIL_SETUP.md).
const resendClient = env.email.resendApiKey ? new Resend(env.email.resendApiKey) : null;

/**
 * Servicio de envío de correo. Con `RESEND_API_KEY` configurada, envía de verdad vía Resend;
 * si no, se comporta como siempre (queda logueado en consola, útil en desarrollo sin proveedor).
 */
class EmailService {
  async send({ to, subject, html }) {
    if (!resendClient) {
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

    try {
      await resendClient.emails.send({
        from: `${env.email.fromName} <${env.email.fromAddress}>`,
        to,
        subject,
        html,
      });
      logger.info(`[email] enviado a ${to} | ${subject}`);
      return true;
    } catch (error) {
      // Best-effort: un correo que falla no debe reventar el flujo que lo dispara (registro,
      // recuperar contraseña, etc.) — el usuario ya quedó creado/actualizado en la base de datos.
      logger.error(`[email] error enviando a ${to} | ${subject}: ${error.message}`);
      return false;
    }
  }

  async sendVerificationEmail(user, token) {
    const link = `${env.clientUrl}/auth/verify-email?token=${token}`;
    return this.send({
      to: user.email,
      subject: 'Verifica tu correo electrónico',
      html: renderPlatformEmail({
        title: 'Verifica tu correo electrónico',
        bodyHtml: `<p>Hola ${user.username},</p><p>Verifica tu correo haciendo clic en el siguiente botón:</p>`,
        ctaText: 'Verificar correo',
        ctaUrl: link,
      }),
    });
  }

  async sendPasswordResetEmail(user, token) {
    const link = `${env.clientUrl}/auth/reset-password?token=${token}`;
    return this.send({
      to: user.email,
      subject: 'Recupera tu contraseña',
      html: renderPlatformEmail({
        title: 'Recupera tu contraseña',
        bodyHtml: `<p>Hola ${user.username},</p><p>Solicitaste restablecer tu contraseña. Este enlace expira pronto:</p>`,
        ctaText: 'Restablecer contraseña',
        ctaUrl: link,
      }),
    });
  }

  async sendWelcomeEmail(user) {
    return this.send({
      to: user.email,
      subject: 'Bienvenido a Admin Club',
      html: renderPlatformEmail({
        title: `¡Bienvenido, ${user.username}!`,
        bodyHtml: '<p>Tu cuenta fue creada correctamente. Ya puedes crear o unirte a un club para empezar a administrarlo.</p>',
      }),
    });
  }

  /** Lista para usar, sin llamador todavía: el modelo actual de invitación no exige un correo
   * destinatario obligatorio — engancharla cuando exista ese flujo (ver GOOGLE_LOGIN_SETUP.md
   * hermano RESEND_EMAIL_SETUP.md para el detalle). */
  async sendInvitationEmail(toEmail, club, code) {
    return this.send({
      to: toEmail,
      subject: `Invitación para unirte a ${club.name}`,
      html: renderClubEmail({
        club,
        title: `Te invitaron a unirte a ${club.name}`,
        bodyHtml: `<p>Usa el siguiente código de invitación para unirte:</p><p style="font-size:22px; font-weight:700; letter-spacing:0.08em;">${code}</p>`,
      }),
    });
  }
}

module.exports = new EmailService();
