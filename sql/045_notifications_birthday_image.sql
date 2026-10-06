-- ============================================================================
-- El cron de cumpleaños (birthdays.service.js) deja de enviar únicamente un
-- correo y ahora crea una notificación en la app (tipo 'birthday') que puede
-- llevar adjunta la imagen de la plantilla de cumpleaños compuesta en el
-- servidor (ver api/utils/birthdayTemplateRenderer.js). Todas las
-- notificaciones (esta y el resto) ahora además disparan un correo con el
-- mismo contenido (ver notifications.service.js#notifyUser) — no requiere
-- cambios de esquema aparte de estos dos.
-- ============================================================================
USE `admin_club`;

ALTER TABLE `notifications`
  MODIFY COLUMN `type` ENUM('info','success','warning','error','birthday') NOT NULL DEFAULT 'info';

ALTER TABLE `notifications`
  ADD COLUMN `image_url` VARCHAR(500) NULL AFTER `link`;
