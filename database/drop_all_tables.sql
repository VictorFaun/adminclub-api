-- Borra la base admin_club completa y la crea vacía.
-- Después: npm run db:migrate && npm run db:seed

DROP DATABASE IF EXISTS `admin_club`;
CREATE DATABASE `admin_club` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
