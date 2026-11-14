-- ============================================================================
-- 074: rutas de archivos subidos sin dominio.
--
-- Las imágenes de la plantilla de cumpleaños se guardaban con la URL completa
-- ("https://adminclub.thedifference.pro/uploads/birthday-template/..."). Al cambiar el dominio, la
-- tarjeta de cumpleaños pedía esas imágenes al dominio antiguo y el navegador las bloqueaba al
-- dibujarlas. Ahora se guardan relativas ("/uploads/..."), como las fotos, logos y avatares, y la
-- API les pone el dominio vigente al entregarlas (birthdays.service.js#getTemplateForClient).
--
-- También quedan relativos los enlaces de notificaciones antiguas que apuntaban a la propia app
-- ("https://<dominio>/pay/..." → "/pay/..."): la app y los correos ya resuelven rutas relativas
-- con el dominio vigente. Los enlaces a otros sitios no se tocan.
-- Idempotente: lo ya relativo no coincide con los patrones.
-- ============================================================================
USE `admin_club`;

UPDATE `club_settings`
  SET `setting_value` = REGEXP_REPLACE(`setting_value`, 'https?://[^"/]+/uploads/', '/uploads/')
  WHERE `setting_key` LIKE 'birthday\_template\_%'
    AND `setting_value` REGEXP 'https?://[^"/]+/uploads/';

UPDATE `notifications`
  SET `link` = REGEXP_REPLACE(`link`, '^https?://(adminclub|miclub)[.]thedifference[.]pro', '')
  WHERE `link` REGEXP '^https?://(adminclub|miclub)[.]thedifference[.]pro/';
