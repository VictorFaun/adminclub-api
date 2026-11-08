-- ============================================================================
-- 070: categoría de cada notificación, para filtrarlas en la pestaña Notificaciones
-- (cumpleaños, eventos, solicitudes y miembros, pagos, entrenamientos, invitaciones, general).
-- `type` sigue siendo el tono (info/success/warning/...); `category` es de qué trata. Las nuevas la
-- reciben al crearse (notifications.service.js#notifyUser); las existentes se clasifican acá por
-- su tipo y su enlace.
-- ============================================================================
USE `admin_club`;

ALTER TABLE `notifications`
  ADD COLUMN `category` VARCHAR(30) NOT NULL DEFAULT 'general' AFTER `type`,
  ADD KEY `idx_notifications_user_category` (`user_id`, `category`);

UPDATE `notifications` SET `category` = 'birthday' WHERE `type` = 'birthday';
UPDATE `notifications` SET `category` = 'invitation' WHERE `type` = 'invitation';
UPDATE `notifications` SET `category` = 'event' WHERE `category` = 'general' AND `link` LIKE '/calendar%';
UPDATE `notifications` SET `category` = 'members'
  WHERE `category` = 'general' AND (`link` LIKE '/members/applications%' OR `link` LIKE '/requests%' OR `link` LIKE '/members/list%');
UPDATE `notifications` SET `category` = 'payments'
  WHERE `category` = 'general' AND (`link` LIKE '%/my/payments%' OR `link` LIKE '%/pay/%' OR `link` LIKE '/treasury%' OR `title` LIKE 'Comprobante%');
UPDATE `notifications` SET `category` = 'trainings' WHERE `category` = 'general' AND `link` LIKE '/trainings%';
