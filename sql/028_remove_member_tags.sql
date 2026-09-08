-- ============================================================================
-- Elimina el módulo de "Etiquetas" de miembros — se fusiona con "Grupos" (misma
-- idea, redundante para el usuario). Confirmado seguro: `charge_target_tags`,
-- `member_tag_members` y `member_tags` ya tienen ON DELETE CASCADE completo
-- (015_member_tags.sql, 016_charge_pricing.sql), y `resolveAmounts`/
-- `expandTargetMemberIds` (charges.repository.js) ya ignoraban el targeting puro
-- por etiqueta al armar a quién generarle instancias — no hay comportamiento vivo
-- que preservar migrando datos, un DROP directo es seguro.
-- ============================================================================
USE `admin_club`;

-- Cascada a role_functions (fk_role_functions_function ON DELETE CASCADE, 001_schema.sql).
DELETE FROM `functions` WHERE `code` IN ('VIEW_MEMBER_TAGS', 'MANAGE_MEMBER_TAGS');

DROP TABLE IF EXISTS `charge_target_tags`;
DROP TABLE IF EXISTS `member_tag_members`;
DROP TABLE IF EXISTS `member_tags`;
