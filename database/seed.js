/* eslint-disable no-console */
require('dotenv').config();
const { pool } = require('../config/database');
const usersRepository = require('../repositories/users.repository');
const rolesRepository = require('../repositories/roles.repository');
const clubsService = require('../services/clubs.service');
const { hashPassword } = require('../helpers/passwordUtils');
const { USER_STATUS, GLOBAL_ROLES } = require('../config/constants');

const SUPER_ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL || 'admin@adminclub.dev';
const SUPER_ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD || 'Admin123!';

async function seedSuperAdmin() {
  const existing = await usersRepository.findByEmail(SUPER_ADMIN_EMAIL);
  if (existing) {
    console.log(`[seed] Super Admin ya existe (${SUPER_ADMIN_EMAIL}).`);
    return existing.id;
  }

  const passwordHash = await hashPassword(SUPER_ADMIN_PASSWORD);
  const userId = await usersRepository.createUser({
    username: 'Super Admin',
    email: SUPER_ADMIN_EMAIL,
    passwordHash,
    status: USER_STATUS.ACTIVE,
    phone: null,
  });
  await usersRepository.setEmailVerified(userId);

  const superAdminRole = await rolesRepository.findByNameInScope(GLOBAL_ROLES.SUPER_ADMIN, null);
  if (superAdminRole) {
    await rolesRepository.assignToUser({ userId, roleId: superAdminRole.id, clubId: null, assignedBy: userId });
  }

  console.log(`[seed] Super Admin creado: ${SUPER_ADMIN_EMAIL} / ${SUPER_ADMIN_PASSWORD}`);
  return userId;
}

async function seedDemoClub(ownerId) {
  const [rows] = await pool.query('SELECT id FROM clubs WHERE public_code = ? LIMIT 1', ['club-demo']);
  if (rows.length) {
    console.log('[seed] Club demo ya existe.');
    return;
  }

  const club = await clubsService.create(
    {
      name: 'Club Demo',
      description: 'Club de demostración generado automáticamente por el seeder.',
      primaryColor: '#4F46E5',
      secondaryColor: '#22C55E',
      theme: 'auto',
      isPublic: true,
    },
    ownerId
  );

  console.log(`[seed] Club demo creado: ${club.name} (código público: ${club.publicCode}, código de invitación: ${club.inviteCode})`);
}

async function run() {
  const superAdminId = await seedSuperAdmin();
  await seedDemoClub(superAdminId);
  console.log('[seed] Seed completado.');
  await pool.end();
}

run().catch(async (error) => {
  console.error('[seed] Error:', error.message);
  await pool.end();
  process.exit(1);
});
