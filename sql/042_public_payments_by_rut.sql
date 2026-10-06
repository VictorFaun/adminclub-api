-- ============================================================================
-- 042: la página pública de pagos pasa a ser UNA por club (/pay/<código-del-club>) y el miembro
-- se identifica con su RUT — ya no hay enlace/token personal por miembro (040), se elimina.
-- ============================================================================
USE `admin_club`;

ALTER TABLE `members`
  DROP INDEX `uk_members_payment_token`,
  DROP COLUMN `payment_token`;
