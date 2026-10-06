-- ============================================================================
-- 039: nuevo tipo de campo personalizado 'address' (dirección con autocompletado y mapa de
-- Google). El valor se guarda como texto en member_field_values (la dirección legible, o un JSON
-- {"text","lat","lng"} cuando se eligió una sugerencia de Google).
-- ============================================================================
USE `admin_club`;

ALTER TABLE `member_fields`
  MODIFY COLUMN `field_type` ENUM('text','number','date','boolean','select','address') NOT NULL DEFAULT 'text';
