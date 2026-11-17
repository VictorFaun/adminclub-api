-- ============================================================================
-- 087: grupos que solo cambian el precio de un cobro, y fecha de ingreso a cada grupo.
--
-- 1. `charge_target_groups.price_only`: un grupo así NO agrega a nadie al cobro; solo cambia el
--    monto de quienes ya están en él por otro grupo o por estar elegidos uno a uno. Caso real:
--    "Mensualidad TC Varones" es para el grupo TC Varones, con precio especial para Directiva y
--    Estudiantes. Antes, Directiva tenía que ser un grupo "a quién se le cobra", así que una dama
--    de TC Damas que entraba a Directiva quedaba cobrada en la mensualidad de varones.
--    Si un miembro califica para un precio especial y para el de su grupo, gana el especial
--    (charges.repository.js#resolveAmounts).
--
-- 2. `member_group_members.joined_at`: desde cuándo está en el grupo. Al entrar a un grupo al que
--    se le cobra, sus períodos se generan desde ese mes, no desde el inicio del cobro (antes, sumar
--    a alguien a mitad de año le cargaba el año completo como atrasado). Los que ya estaban quedan
--    con una fecha antigua: para ellos todo sigue igual que antes.
-- ============================================================================

ALTER TABLE `charge_target_groups`
  ADD COLUMN `price_only` TINYINT(1) NOT NULL DEFAULT 0 AFTER `position`;

ALTER TABLE `member_group_members`
  ADD COLUMN `joined_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE `member_group_members` SET `joined_at` = '2000-01-01 00:00:00';
