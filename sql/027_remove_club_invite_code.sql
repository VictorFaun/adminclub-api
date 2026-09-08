-- ============================================================================
-- Elimina el código de invitación PERMANENTE fijo por club (`clubs.invite_code`,
-- de 001_schema.sql). Reemplazado por invitaciones normales (tabla `invitations`)
-- que se pueden crear SIN `maxUses` ni `expiresAt` — eso ya las hace "permanentes"
-- (uso ilimitado, nunca expiran; ver invitations.repository.js#claimUse/
-- expireOutdated, que solo actúan cuando esos campos NO son NULL). Un club puede
-- así tener tantos códigos permanentes como quiera (o ninguno), revocables por
-- separado, en vez de un único código fijo con su propio mecanismo de
-- activar/desactivar/regenerar.
-- ============================================================================
USE `admin_club`;

ALTER TABLE `clubs`
  DROP INDEX `uk_clubs_invite_code`,
  DROP COLUMN `invite_code`;
