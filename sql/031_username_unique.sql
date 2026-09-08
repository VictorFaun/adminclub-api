-- ============================================================================
-- 031: permite iniciar sesión con `username` además de `email`. `username` ya
-- existía (migración 006, poblado con el nombre completo) pero sin restricción
-- de unicidad — antes de agregar el UNIQUE KEY hay que desduplicar lo que ya
-- exista hoy. Se usa el `id` (no un contador 1,2,3...) como sufijo de los
-- duplicados: es el único valor que garantiza no chocar con ningún otro
-- username ya existente, sin tener que verificar cada candidato uno por uno.
-- ============================================================================
USE `admin_club`;

UPDATE `users` u
JOIN (
  SELECT
    `id`,
    COUNT(*) OVER (PARTITION BY LOWER(`username`)) AS `cnt`,
    ROW_NUMBER() OVER (PARTITION BY LOWER(`username`) ORDER BY `id`) AS `rn`
  FROM `users`
) `ranked` ON `ranked`.`id` = u.`id`
SET u.`username` = CONCAT(u.`username`, u.`id`)
WHERE `ranked`.`cnt` > 1 AND `ranked`.`rn` > 1;

ALTER TABLE `users`
  ADD UNIQUE KEY `uk_users_username` (`username`);
