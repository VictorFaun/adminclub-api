-- Versiones de menor resolución del logo y el banner del club (helpers/clubMedia.js): se generan
-- al subirlos y se usan en todo lo chico (menú lateral, vista previa, correos, notificaciones,
-- recibos). NULL = no hay (clubes que los subieron antes): se usa la original.
ALTER TABLE `clubs`
  ADD COLUMN `logo_thumb_url` VARCHAR(500) NULL AFTER `logo_url`,
  ADD COLUMN `banner_thumb_url` VARCHAR(500) NULL AFTER `banner_url`;
