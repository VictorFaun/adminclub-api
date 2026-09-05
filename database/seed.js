/* eslint-disable no-console */
require('dotenv').config();
const { pool } = require('../config/database');
const usersRepository = require('../repositories/users.repository');
const rolesRepository = require('../repositories/roles.repository');
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

async function run() {
  await seedSuperAdmin();
  console.log('[seed] Seed completado.');
  await pool.end();
}

run().catch(async (error) => {
  console.error('[seed] Error:', error.message);
  await pool.end();
  process.exit(1);
});
