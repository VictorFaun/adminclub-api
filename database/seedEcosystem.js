/* eslint-disable no-console, no-await-in-loop */
/**
 * Seed de un ecosistema completo y realista (3 clubes, miembros, usuarios, roles, cobros,
 * gastos, entrenamientos, invitaciones, notificaciones, auditoría) con más de un año de
 * historial, pensado para tomar capturas de pantalla reales de cada vista de la app.
 *
 * NO toca clubs/users/members ya existentes (Trawen, Vickuro, Daniyok) — solo agrega contenido
 * nuevo alrededor. Todos los usuarios nuevos usan la misma contraseña (ver SEED_PASSWORD) para
 * poder iniciar sesión durante la captura de pantallas.
 *
 * Uso: node database/seedEcosystem.js
 */
require('dotenv').config();
const crypto = require('crypto');
const { pool } = require('../config/database');
const { hashPassword } = require('../helpers/passwordUtils');
const { FUNCTIONS } = require('../config/constants');

const SEED_PASSWORD = 'Ecosistema123!';
const TODAY = new Date(); // fecha real del sistema (ver system prompt: 2026-09-08)

const pad = (n) => String(n).padStart(2, '0');
const uuid = () => crypto.randomUUID();
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const pickWeighted = (pairs) => {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [value, w] of pairs) {
    if (r < w) return value;
    r -= w;
  }
  return pairs[pairs.length - 1][0];
};
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function clampDay(year, month, day) {
  return Math.min(day, daysInMonth(year, month));
}
function toDateString(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}
function formatDateOnly(date) {
  const d = new Date(date);
  return toDateString(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
function addMonthsLabel(year, month, offset) {
  const total = (year * 12 + (month - 1)) + offset;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}
/** JS getUTCDay(): domingo=0 → ISO: lunes=1..domingo=7 (mismo criterio que trainingAttendance.service.js#isoDayOfWeek). */
function isoDayOfWeek(date) {
  const d = date.getUTCDay();
  return d === 0 ? 7 : d;
}
function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Dígito verificador de RUT chileno (mod 11) — solo para realismo visual, sin validación real detrás. */
function rutCheckDigit(num) {
  let sum = 0;
  let mul = 2;
  for (const digit of String(num).split('').reverse()) {
    sum += Number(digit) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const res = 11 - (sum % 11);
  if (res === 11) return '0';
  if (res === 10) return 'K';
  return String(res);
}
function formatRut(num) {
  const s = String(num);
  const withDots = s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${withDots}-${rutCheckDigit(num)}`;
}
let rutSeq = 11000000;
function nextRut() {
  rutSeq += randInt(37, 401);
  return formatRut(rutSeq);
}

const FIRST_NAMES_M = ['Matías', 'Sebastián', 'Cristóbal', 'Joaquín', 'Benjamín', 'Vicente', 'Ignacio', 'Tomás', 'Diego', 'Felipe', 'Agustín', 'Maximiliano', 'Bastián', 'Gaspar', 'Martín', 'Rodrigo', 'Francisco', 'Nicolás', 'Pedro', 'Andrés'];
const FIRST_NAMES_F = ['Valentina', 'Isidora', 'Antonia', 'Florencia', 'Catalina', 'Fernanda', 'Josefa', 'Martina', 'Amanda', 'Emilia', 'Trinidad', 'Constanza', 'Javiera', 'Camila', 'Sofía', 'Daniela', 'Paz', 'Rocío', 'Macarena', 'Bárbara'];
const LAST_NAMES = ['González', 'Muñoz', 'Rojas', 'Díaz', 'Pérez', 'Soto', 'Contreras', 'Silva', 'Martínez', 'Sepúlveda', 'Morales', 'Rodríguez', 'López', 'Fuentes', 'Hernández', 'Torres', 'Araya', 'Flores', 'Espinoza', 'Valenzuela', 'Castillo', 'Reyes', 'Gutiérrez', 'Vásquez', 'Carrasco', 'Vargas', 'Tapia', 'Sandoval', 'Miranda', 'Bravo'];

function randomName() {
  const female = Math.random() < 0.5;
  const first = pick(female ? FIRST_NAMES_F : FIRST_NAMES_M);
  const last = pick(LAST_NAMES);
  const secondLast = pick(LAST_NAMES);
  return { firstName: first, lastName: last, secondLastName: secondLast, female };
}
function slugEmail(firstName, lastName, tag, domain = 'ecosistema.test') {
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  return `${norm(firstName)}.${norm(lastName)}${tag}@${domain}`;
}

async function upsertRole(conn, { clubId, name, description, color, functionCodes }) {
  const [existing] = await conn.query('SELECT id FROM roles WHERE club_id = ? AND name = ?', [clubId, name]);
  let roleId;
  if (existing.length) {
    roleId = existing[0].id;
  } else {
    const [result] = await conn.query(
      'INSERT INTO roles (uuid, club_id, name, description, scope, color, is_system) VALUES (?, ?, ?, ?, \'club\', ?, 0)',
      [uuid(), clubId, name, description, color]
    );
    roleId = result.insertId;
  }
  const [funcRows] = await conn.query('SELECT id, code FROM functions WHERE code IN (?)', [functionCodes]);
  for (const f of funcRows) {
    await conn.query('INSERT IGNORE INTO role_functions (role_id, function_id) VALUES (?, ?)', [roleId, f.id]);
  }
  return roleId;
}

async function createUser(conn, { username, email, roleGlobalNone = true }) {
  const [existing] = await conn.query('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length) return existing[0].id;
  const passwordHash = await hashPassword(SEED_PASSWORD);
  const [result] = await conn.query(
    `INSERT INTO users (uuid, username, email, password_hash, status, email_verified_at)
     VALUES (?, ?, ?, ?, 'active', NOW())`,
    [uuid(), username, email, passwordHash]
  );
  return result.insertId;
}

async function addUserToClub(conn, { userId, clubId, isDefault = false }) {
  await conn.query(
    `INSERT INTO user_clubs (user_id, club_id, status, is_default, joined_at)
     VALUES (?, ?, 'active', ?, NOW())
     ON DUPLICATE KEY UPDATE status = 'active'`,
    [userId, clubId, isDefault ? 1 : 0]
  );
}

async function assignRole(conn, { userId, roleId, clubId, assignedBy }) {
  await conn.query(
    `INSERT IGNORE INTO user_roles (user_id, role_id, club_id, assigned_by) VALUES (?, ?, ?, ?)`,
    [userId, roleId, clubId, assignedBy]
  );
}

async function createMember(conn, { clubId, firstName, lastName, secondLastName, email, phone, birthDate, userId = null, status = 'active', createdBy }) {
  const [result] = await conn.query(
    `INSERT INTO members (uuid, club_id, first_name, last_name, second_last_name, email, phone, rut, birth_date, user_id, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uuid(), clubId, firstName, lastName, secondLastName, email, phone, nextRut(), birthDate, userId, status, createdBy]
  );
  return result.insertId;
}

async function main() {
  const conn = await pool.getConnection();
  try {
    console.log('[seed] Iniciando seed del ecosistema...');

    // ---- Super Admin (ya existe) ----
    const [[superAdmin]] = await conn.query("SELECT id FROM users WHERE email = 'admin@adminclub.dev' LIMIT 1");
    const superAdminId = superAdmin ? superAdmin.id : null;

    // ---- Club 1: Trawen (YA EXISTE — solo se agrega contenido alrededor) ----
    const [[trawen]] = await conn.query("SELECT id, created_by FROM clubs WHERE name = 'Trawen' LIMIT 1");
    const trawenId = trawen.id;
    const trawenCreatedBy = trawen.created_by;

    // ---- Clubes nuevos ----
    async function ensureClub({ name, description, primaryColor, secondaryColor, isPublic = 1, createdBy }) {
      const [existing] = await conn.query('SELECT id FROM clubs WHERE name = ?', [name]);
      if (existing.length) return existing[0].id;
      const code = name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 10) + randInt(100, 999);
      const [result] = await conn.query(
        `INSERT INTO clubs (uuid, name, public_code, description, primary_color, secondary_color, theme, timezone, status, is_public, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 'auto', 'America/Santiago', 'active', ?, ?)`,
        [uuid(), name, code, description, primaryColor, secondaryColor, isPublic, createdBy]
      );
      return result.insertId;
    }

    // El admin de Andes/Halcones se crea primero para poder usarlo como created_by del club.
    const andesAdminId = await createUser(conn, { username: 'Constanza Rivas', email: 'admin.andes@ecosistema.test' });
    const halconesAdminId = await createUser(conn, { username: 'Ignacio Bello', email: 'admin.halcones@ecosistema.test' });

    const andesId = await ensureClub({
      name: 'Club Deportivo Los Andes',
      description: 'Club deportivo multi-disciplina fundado por la comunidad de Los Andes — fútbol, atletismo y actividades familiares.',
      primaryColor: '#0EA5E9',
      secondaryColor: '#F59E0B',
      createdBy: andesAdminId,
    });
    const halconesId = await ensureClub({
      name: 'Academia Halcones',
      description: 'Academia deportiva juvenil, recién formada.',
      primaryColor: '#DC2626',
      secondaryColor: '#111827',
      createdBy: halconesAdminId,
    });

    console.log(`[seed] Clubes: Trawen=${trawenId} Andes=${andesId} Halcones=${halconesId}`);

    // ---- Roles por club ----
    const ALL_CLUB_FUNCTIONS = Object.values(FUNCTIONS).filter((c) => !['MANAGE_PLATFORM', 'VIEW_ALL_CLUBS', 'EDIT_ALL_CLUBS', 'VIEW_ALL_FUNCTIONS', 'VIEW_ALL_USERS', 'EDIT_ALL_USERS', 'SUSPEND_ALL_USERS', 'DELETE_ALL_USERS', 'VIEW_PLATFORM_SETTINGS', 'EDIT_PLATFORM_SETTINGS'].includes(c));

    async function ensureAdminRole(clubId) {
      return upsertRole(conn, { clubId, name: 'Administrador', description: 'Control total sobre la administración del club', color: '#DC2626', functionCodes: ALL_CLUB_FUNCTIONS });
    }

    const TESORERO_FUNCS = [
      FUNCTIONS.VIEW_TREASURY_DASHBOARD, FUNCTIONS.VIEW_CHARGES, FUNCTIONS.CREATE_CHARGES, FUNCTIONS.EDIT_CHARGES, FUNCTIONS.DELETE_CHARGES,
      FUNCTIONS.VIEW_PAYMENTS, FUNCTIONS.VIEW_PAYMENTS_SCOPED, FUNCTIONS.CREATE_PAYMENTS, FUNCTIONS.EDIT_PAYMENTS, FUNCTIONS.DELETE_PAYMENTS, FUNCTIONS.EXEMPT_PAYMENTS,
      FUNCTIONS.VIEW_TREASURY_SETTINGS, FUNCTIONS.EDIT_TREASURY_SETTINGS,
      FUNCTIONS.VIEW_EXPENSES, FUNCTIONS.CREATE_EXPENSES, FUNCTIONS.EDIT_EXPENSES, FUNCTIONS.DELETE_EXPENSES,
      FUNCTIONS.VIEW_NOTIFICATIONS,
    ];
    const ENTRENADOR_FUNCS = [
      FUNCTIONS.VIEW_TRAININGS, FUNCTIONS.CREATE_TRAININGS, FUNCTIONS.EDIT_TRAININGS, FUNCTIONS.DELETE_TRAININGS,
      FUNCTIONS.VIEW_ATTENDANCE, FUNCTIONS.MARK_ATTENDANCE, FUNCTIONS.VIEW_TRAINING_SETTINGS, FUNCTIONS.EDIT_TRAINING_SETTINGS,
      FUNCTIONS.VIEW_NOTIFICATIONS,
    ];
    const DIRECTIVA_FUNCS = [
      FUNCTIONS.VIEW_DASHBOARD, FUNCTIONS.VIEW_MEMBERS, FUNCTIONS.VIEW_MEMBER_GROUPS, FUNCTIONS.VIEW_AUDIT_LOGS,
      FUNCTIONS.VIEW_USERS, FUNCTIONS.VIEW_ROLES, FUNCTIONS.VIEW_NOTIFICATIONS, FUNCTIONS.VIEW_CLUB,
      FUNCTIONS.VIEW_TREASURY_DASHBOARD, FUNCTIONS.VIEW_MEMBERS_DASHBOARD,
    ];

    const trawenAdminRole = await ensureAdminRole(trawenId);
    const trawenTesoreroRole = await upsertRole(conn, { clubId: trawenId, name: 'Tesorero', description: 'Encargado de cobros, pagos y gastos del club', color: '#16A34A', functionCodes: TESORERO_FUNCS });
    const trawenEntrenadorRole = await upsertRole(conn, { clubId: trawenId, name: 'Entrenador', description: 'Encargado de entrenamientos y asistencia', color: '#2563EB', functionCodes: ENTRENADOR_FUNCS });
    const trawenDirectivaRole = await upsertRole(conn, { clubId: trawenId, name: 'Directiva', description: 'Visión general del club sin funciones administrativas', color: '#7C3AED', functionCodes: DIRECTIVA_FUNCS });

    const andesAdminRole = await ensureAdminRole(andesId);
    const halconesAdminRole = await ensureAdminRole(halconesId);

    console.log('[seed] Roles creados.');

    // ---- Grupos de miembros ----
    async function ensureGroup(clubId, name, description, color) {
      const [existing] = await conn.query('SELECT id FROM member_groups WHERE club_id = ? AND name = ?', [clubId, name]);
      if (existing.length) return existing[0].id;
      const [result] = await conn.query(
        'INSERT INTO member_groups (uuid, club_id, name, description, color) VALUES (?, ?, ?, ?, ?)',
        [uuid(), clubId, name, description, color]
      );
      return result.insertId;
    }

    const trawenGroupAdultos = await ensureGroup(trawenId, 'Primera Adultos', 'Categoría adulta competitiva', '#DC2626');
    const trawenGroupJuvenil = await ensureGroup(trawenId, 'Juvenil', 'Categoría juvenil (14-17 años)', '#2563EB');
    const trawenGroupInfantil = await ensureGroup(trawenId, 'Infantil', 'Categoría infantil (8-13 años)', '#F59E0B');

    const andesGroupSenior = await ensureGroup(andesId, 'Senior', 'Deportistas mayores de 18 años', '#0EA5E9');
    const andesGroupJunior = await ensureGroup(andesId, 'Junior', 'Deportistas menores de 18 años', '#F59E0B');

    console.log('[seed] Grupos creados.');

    // ---- Campos personalizados de miembro (solo Trawen, para variedad) ----
    async function ensureMemberField(clubId, code, label, fieldType, options, sortOrder) {
      const [existing] = await conn.query('SELECT id FROM member_fields WHERE club_id = ? AND code = ?', [clubId, code]);
      if (existing.length) return existing[0].id;
      const [result] = await conn.query(
        'INSERT INTO member_fields (club_id, code, label, field_type, options, is_required, sort_order) VALUES (?, ?, ?, ?, ?, 0, ?)',
        [clubId, code, label, fieldType, options ? JSON.stringify(options) : null, sortOrder]
      );
      return result.insertId;
    }
    const fieldTalla = await ensureMemberField(trawenId, 'talla_camiseta', 'Talla de camiseta', 'select', ['XS', 'S', 'M', 'L', 'XL'], 1);
    const fieldAlergias = await ensureMemberField(trawenId, 'alergias', 'Alergias', 'text', null, 2);

    // ---- Miembros ----
    async function seedMembers(clubId, count, groupIds, adminUserId, opts = {}) {
      const created = [];
      for (let i = 0; i < count; i++) {
        const { firstName, lastName, secondLastName } = randomName();
        const email = slugEmail(firstName, lastName, `${clubId}${i}`);
        const phone = `+56 9 ${randInt(30000000, 89999999)}`;
        const isYouth = opts.youthGroupIds && opts.youthGroupIds.length;
        let groupId = null;
        let birthYear;
        if (groupIds.length) {
          groupId = pick(groupIds);
          const isYouthGroup = isYouth && opts.youthGroupIds.includes(groupId);
          birthYear = isYouthGroup ? TODAY.getFullYear() - randInt(9, 17) : TODAY.getFullYear() - randInt(19, 48);
        } else {
          birthYear = TODAY.getFullYear() - randInt(19, 48);
        }
        const birthDate = toDateString(birthYear, randInt(1, 12), randInt(1, 28));
        const status = i < count - Math.max(1, Math.floor(count * 0.12)) ? 'active' : 'inactive';
        const memberId = await createMember(conn, {
          clubId, firstName, lastName, secondLastName, email, phone, birthDate, status, createdBy: adminUserId,
        });
        if (groupId) await conn.query('INSERT IGNORE INTO member_group_members (group_id, member_id) VALUES (?, ?)', [groupId, memberId]);
        created.push({ id: memberId, firstName, lastName, secondLastName, groupId, status });
      }
      return created;
    }

    const trawenMembers = await seedMembers(
      trawenId, 18,
      [trawenGroupAdultos, trawenGroupJuvenil, trawenGroupInfantil],
      trawenCreatedBy,
      { youthGroupIds: [trawenGroupJuvenil, trawenGroupInfantil] }
    );
    const andesMembers = await seedMembers(andesId, 11, [andesGroupSenior, andesGroupJunior], andesAdminId, { youthGroupIds: [andesGroupJunior] });
    const halconesMembers = await seedMembers(halconesId, 6, [], halconesAdminId);

    console.log(`[seed] Miembros: Trawen=${trawenMembers.length} Andes=${andesMembers.length} Halcones=${halconesMembers.length}`);

    // Valores de campos personalizados para algunos miembros de Trawen.
    for (const m of trawenMembers.slice(0, 10)) {
      await conn.query('INSERT IGNORE INTO member_field_values (member_id, field_id, value) VALUES (?, ?, ?)', [m.id, fieldTalla, pick(['XS', 'S', 'M', 'L', 'XL'])]);
      if (Math.random() < 0.3) {
        await conn.query('INSERT IGNORE INTO member_field_values (member_id, field_id, value) VALUES (?, ?, ?)', [m.id, fieldAlergias, pick(['Ninguna', 'Polen', 'Maní', 'Ácaros'])]);
      }
    }

    // ---- Usuarios de las 6 personas de prueba (solo en Trawen, el club "completo") ----
    async function seedPersona({ clubId, member, tag, roleId, roleId2, isDefault, assignedBy }) {
      const email = slugEmail(member.firstName, member.lastName, tag);
      const userId = await createUser(conn, { username: `${member.firstName} ${member.lastName}`, email });
      await addUserToClub(conn, { userId, clubId, isDefault });
      await conn.query('UPDATE members SET user_id = ? WHERE id = ?', [userId, member.id]);
      if (roleId) await assignRole(conn, { userId, roleId, clubId, assignedBy });
      if (roleId2) await assignRole(conn, { userId, roleId2, clubId, assignedBy });
      return userId;
    }

    const trawenAdminMember = trawenMembers[0];
    const trawenTesoreroMember = trawenMembers[1];
    const trawenEntrenadorMember = trawenMembers[2];
    const trawenDirectivaMember = trawenMembers[3];
    const trawenSinRolMember = trawenMembers[4];
    const trawenResponsableMember = trawenMembers[5];

    const trawenAdminUserId = await seedPersona({ clubId: trawenId, member: trawenAdminMember, tag: '.admin', roleId: trawenAdminRole, isDefault: true, assignedBy: trawenCreatedBy });
    const trawenTesoreroUserId = await seedPersona({ clubId: trawenId, member: trawenTesoreroMember, tag: '.tesorero', roleId: trawenTesoreroRole, isDefault: true, assignedBy: trawenAdminUserId });
    const trawenEntrenadorUserId = await seedPersona({ clubId: trawenId, member: trawenEntrenadorMember, tag: '.entrenador', roleId: trawenEntrenadorRole, isDefault: true, assignedBy: trawenAdminUserId });
    const trawenDirectivaUserId = await seedPersona({ clubId: trawenId, member: trawenDirectivaMember, tag: '.directiva', roleId: trawenDirectivaRole, isDefault: true, assignedBy: trawenAdminUserId });
    const trawenSinRolUserId = await seedPersona({ clubId: trawenId, member: trawenSinRolMember, tag: '.sinrol', roleId: null, isDefault: true, assignedBy: trawenAdminUserId });
    const trawenResponsableUserId = await seedPersona({ clubId: trawenId, member: trawenResponsableMember, tag: '.responsable', roleId: null, isDefault: true, assignedBy: trawenAdminUserId });

    // Andes/Halcones: admin ya tiene usuario creado arriba, solo falta vincularlo a un miembro + rol.
    const andesAdminMember = andesMembers[0];
    await conn.query('UPDATE members SET user_id = ? WHERE id = ?', [andesAdminId, andesAdminMember.id]);
    await addUserToClub(conn, { userId: andesAdminId, clubId: andesId, isDefault: true });
    await assignRole(conn, { userId: andesAdminId, roleId: andesAdminRole, clubId: andesId, assignedBy: andesAdminId });

    const halconesAdminMember = halconesMembers[0];
    await conn.query('UPDATE members SET user_id = ? WHERE id = ?', [halconesAdminId, halconesAdminMember.id]);
    await addUserToClub(conn, { userId: halconesAdminId, clubId: halconesId, isDefault: true });
    await assignRole(conn, { userId: halconesAdminId, roleId: halconesAdminRole, clubId: halconesId, assignedBy: halconesAdminId });

    console.log('[seed] Usuarios/personas de prueba creados.');
    console.log(`  admin.trawen: ${slugEmail(trawenAdminMember.firstName, trawenAdminMember.lastName, '.admin')}`);
    console.log(`  tesorero.trawen: ${slugEmail(trawenTesoreroMember.firstName, trawenTesoreroMember.lastName, '.tesorero')}`);
    console.log(`  entrenador.trawen: ${slugEmail(trawenEntrenadorMember.firstName, trawenEntrenadorMember.lastName, '.entrenador')}`);
    console.log(`  directiva.trawen: ${slugEmail(trawenDirectivaMember.firstName, trawenDirectivaMember.lastName, '.directiva')}`);
    console.log(`  sinrol.trawen: ${slugEmail(trawenSinRolMember.firstName, trawenSinRolMember.lastName, '.sinrol')}`);
    console.log(`  responsable.trawen: ${slugEmail(trawenResponsableMember.firstName, trawenResponsableMember.lastName, '.responsable')}`);
    console.log(`  admin.andes: admin.andes@ecosistema.test`);
    console.log(`  admin.halcones: admin.halcones@ecosistema.test`);
    console.log(`  password para todos: ${SEED_PASSWORD}`);

    // =====================================================================================
    // COBROS — Trawen: 1 año+ de historial en 3 cobros. Andes: 1 cobro simple. Halcones: nada
    // (para dejar la lista de Cobros vacía como caso de prueba de estado vacío).
    // =====================================================================================
    async function ensureCharge(clubId, { name, description, color, amount, recurrence, startDate, dueDay, dueMonth, createdBy }) {
      const [existing] = await conn.query('SELECT id FROM charges WHERE club_id = ? AND name = ?', [clubId, name]);
      if (existing.length) return existing[0].id;
      const [result] = await conn.query(
        `INSERT INTO charges (uuid, club_id, name, description, color, amount, recurrence, start_date, due_day, due_month, status, purpose, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'treasury', ?)`,
        [uuid(), clubId, name, description, color, amount, recurrence, startDate, dueDay || null, dueMonth || null, createdBy]
      );
      return result.insertId;
    }

    async function setChargeTargetGroup(chargeId, groupId, amount) {
      await conn.query('INSERT IGNORE INTO charge_target_groups (charge_id, group_id, amount, position) VALUES (?, ?, ?, 0)', [chargeId, groupId, amount]);
    }
    async function setChargeTargetMembers(chargeId, memberIds, amount) {
      for (const memberId of memberIds) {
        await conn.query('INSERT IGNORE INTO charge_target_members (charge_id, member_id, amount) VALUES (?, ?, ?)', [chargeId, memberId, amount]);
      }
    }
    async function setChargeResponsible(chargeId, memberId, groupId) {
      await conn.query('INSERT IGNORE INTO charge_responsible_members (charge_id, member_id, group_id, position) VALUES (?, ?, ?, 0)', [chargeId, memberId, groupId]);
    }

    /** Genera charge_instances + payments/allocations para un cobro MENSUAL, desde `monthsBack`
     * meses atrás hasta `monthsFwd` meses adelante (relativo a hoy), para cada miembro objetivo.
     * Distribución realista: la mayoría pagadas a tiempo, algunas parciales, algunas atrasadas
     * (pending con due_date pasado = "overdue" en la UI), una exenta (congelada) por un tramo,
     * el período actual/futuro queda pending. */
    async function generateMonthlyHistory(chargeId, amount, memberIds, monthsBack, monthsFwd, dueDay, registeredBy) {
      const now = TODAY;
      const startYear = now.getFullYear();
      const startMonth = now.getMonth() + 1;
      // A un miembro (el primero) se lo congela un tramo de 2 meses para variedad visual.
      const frozenMember = memberIds[0];
      const frozenRange = [-6, -5];

      for (const memberId of memberIds) {
        for (let offset = -monthsBack; offset <= monthsFwd; offset++) {
          const { year, month } = addMonthsLabel(startYear, startMonth, offset);
          const label = `${year}-${pad(month)}`;
          const day = clampDay(year, month, dueDay);
          const dueDate = toDateString(year, month, day);
          const isFrozen = memberId === frozenMember && offset >= frozenRange[0] && offset <= frozenRange[1];

          let status = 'pending';
          let exemptType = null;
          if (isFrozen) {
            status = 'exempt';
            exemptType = 'frozen';
          } else if (offset < 0) {
            // Historial: 82% pagado a tiempo, 8% parcial, 10% quedó pendiente (atrasado).
            status = pickWeighted([['paid', 82], ['partial', 8], ['pending', 10]]);
          } else if (offset === 0) {
            status = pickWeighted([['paid', 45], ['pending', 55]]);
          } // offset > 0 (futuro): siempre pending.

          const [insertResult] = await conn.query(
            `INSERT IGNORE INTO charge_instances (uuid, charge_id, member_id, period_label, amount, due_date, status, exempt_type, exempt_reason, exempt_by, exempt_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              uuid(), chargeId, memberId, label, amount, dueDate, status, exemptType,
              isFrozen ? 'Licencia médica' : null,
              isFrozen ? registeredBy : null,
              isFrozen ? dueDate : null,
            ]
          );
          if (!insertResult.insertId) continue;
          const instanceId = insertResult.insertId;

          if (status === 'paid' || status === 'partial') {
            const paidAmount = status === 'paid' ? amount : (Number(amount) * 0.5).toFixed(2);
            const paidAt = `${dueDate} ${pad(randInt(9, 20))}:${pad(randInt(0, 59))}:00`;
            const [paymentResult] = await conn.query(
              `INSERT INTO payments (uuid, club_id, member_id, amount, paid_at, note, registered_by)
               VALUES (?, (SELECT club_id FROM charges WHERE id = ?), ?, ?, ?, ?, ?)`,
              [uuid(), chargeId, memberId, paidAmount, paidAt, status === 'partial' ? 'Abono parcial' : null, registeredBy]
            );
            await conn.query(
              'INSERT INTO payment_allocations (payment_id, charge_instance_id, amount) VALUES (?, ?, ?)',
              [paymentResult.insertId, instanceId, paidAmount]
            );
          }
        }
      }
    }

    async function generateOnceHistory(chargeId, amount, memberIds, startDate, registeredBy) {
      for (const memberId of memberIds) {
        const status = pickWeighted([['paid', 75], ['pending', 25]]);
        const [insertResult] = await conn.query(
          `INSERT IGNORE INTO charge_instances (uuid, charge_id, member_id, period_label, amount, due_date, status)
           VALUES (?, ?, ?, 'unico', ?, ?, ?)`,
          [uuid(), chargeId, memberId, amount, startDate, status]
        );
        if (!insertResult.insertId) continue;
        if (status === 'paid') {
          const [paymentResult] = await conn.query(
            `INSERT INTO payments (uuid, club_id, member_id, amount, paid_at, registered_by)
             VALUES (?, (SELECT club_id FROM charges WHERE id = ?), ?, ?, ?, ?)`,
            [uuid(), chargeId, memberId, amount, `${startDate} 10:00:00`, registeredBy]
          );
          await conn.query('INSERT INTO payment_allocations (payment_id, charge_instance_id, amount) VALUES (?, ?, ?)', [paymentResult.insertId, insertResult.insertId, amount]);
        }
      }
    }

    async function generateYearlyHistory(chargeId, amount, memberIds, yearsBack, dueMonth, dueDay, registeredBy) {
      const now = TODAY;
      for (const memberId of memberIds) {
        for (let offset = -yearsBack; offset <= 0; offset++) {
          const year = now.getFullYear() + offset;
          const day = clampDay(year, dueMonth, dueDay);
          const dueDate = toDateString(year, dueMonth, day);
          const isPast = new Date(dueDate) < now;
          const status = isPast ? pickWeighted([['paid', 80], ['pending', 20]]) : 'pending';
          const [insertResult] = await conn.query(
            `INSERT IGNORE INTO charge_instances (uuid, charge_id, member_id, period_label, amount, due_date, status)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [uuid(), chargeId, memberId, String(year), amount, dueDate, status]
          );
          if (!insertResult.insertId) continue;
          if (status === 'paid') {
            const [paymentResult] = await conn.query(
              `INSERT INTO payments (uuid, club_id, member_id, amount, paid_at, registered_by)
               VALUES (?, (SELECT club_id FROM charges WHERE id = ?), ?, ?, ?, ?)`,
              [uuid(), chargeId, memberId, amount, `${dueDate} 11:00:00`, registeredBy]
            );
            await conn.query('INSERT INTO payment_allocations (payment_id, charge_instance_id, amount) VALUES (?, ?, ?)', [paymentResult.insertId, insertResult.insertId, amount]);
          }
        }
      }
    }

    // -- Trawen: Mensualidad (id=1 ya existe, la reutilizamos y le agregamos targets/responsables/historial) --
    const [[mensualidad]] = await conn.query("SELECT id, amount FROM charges WHERE club_id = ? AND name = 'Mensualidad' LIMIT 1", [trawenId]);
    const mensualidadId = mensualidad.id;
    await setChargeTargetGroup(mensualidadId, trawenGroupAdultos, mensualidad.amount);
    await setChargeTargetGroup(mensualidadId, trawenGroupJuvenil, mensualidad.amount);
    await setChargeTargetGroup(mensualidadId, trawenGroupInfantil, mensualidad.amount);
    await setChargeResponsible(mensualidadId, trawenTesoreroMember.id, null);
    const trawenActiveMemberIds = trawenMembers.filter((m) => m.status === 'active').map((m) => m.id);
    await generateMonthlyHistory(mensualidadId, mensualidad.amount, trawenActiveMemberIds, 14, 1, 5, trawenTesoreroUserId);

    const cuotaFederacionId = await ensureCharge(trawenId, {
      name: 'Cuota Federación Anual', description: 'Cuota anual de afiliación a la federación regional', color: '#7C3AED',
      amount: 45000, recurrence: 'yearly', startDate: '2024-03-01', dueMonth: 3, dueDay: 15, createdBy: trawenAdminUserId,
    });
    await setChargeTargetGroup(cuotaFederacionId, trawenGroupAdultos, 45000);
    await setChargeResponsible(cuotaFederacionId, trawenTesoreroMember.id, trawenGroupAdultos);
    const trawenAdultosIds = trawenMembers.filter((m) => m.groupId === trawenGroupAdultos && m.status === 'active').map((m) => m.id);
    await generateYearlyHistory(cuotaFederacionId, 45000, trawenAdultosIds, 2, 3, 15, trawenTesoreroUserId);

    const implementacionId = await ensureCharge(trawenId, {
      name: 'Implementación deportiva', description: 'Aporte único para renovar indumentaria del club', color: '#0EA5E9',
      amount: 15000, recurrence: 'once', startDate: formatDateOnly(addDays(TODAY, -180)), createdBy: trawenAdminUserId,
    });
    await setChargeTargetMembers(implementacionId, trawenActiveMemberIds, 15000);
    await generateOnceHistory(implementacionId, 15000, trawenActiveMemberIds, formatDateOnly(addDays(TODAY, -180)), trawenTesoreroUserId);

    // Responsable SIN rol administrativo — demuestra el acceso acotado por "responsable de cobro".
    const trawenCafeteriaId = await ensureCharge(trawenId, {
      name: 'Cuota Cafetería', description: 'Aporte mensual para la cafetería del club (a cargo de un responsable sin rol administrativo)', color: '#F59E0B',
      amount: 3000, recurrence: 'monthly', startDate: formatDateOnly(addDays(TODAY, -300)), dueDay: 10, createdBy: trawenAdminUserId,
    });
    await setChargeTargetGroup(trawenCafeteriaId, trawenGroupAdultos, 3000);
    await setChargeResponsible(trawenCafeteriaId, trawenResponsableMember.id, null);
    await generateMonthlyHistory(trawenCafeteriaId, 3000, trawenAdultosIds, 9, 0, 10, trawenResponsableUserId);

    // -- Andes: un cobro simple --
    const andesActiveMemberIds = andesMembers.filter((m) => m.status === 'active').map((m) => m.id);
    const andesCuotaId = await ensureCharge(andesId, {
      name: 'Cuota Mensual', description: 'Cuota mensual del club', color: '#0EA5E9',
      amount: 12000, recurrence: 'monthly', startDate: formatDateOnly(addDays(TODAY, -400)), dueDay: 5, createdBy: andesAdminId,
    });
    await setChargeTargetGroup(andesCuotaId, andesGroupSenior, 12000);
    await setChargeTargetGroup(andesCuotaId, andesGroupJunior, 8000);
    await generateMonthlyHistory(andesCuotaId, 12000, andesActiveMemberIds, 10, 1, 5, andesAdminId);

    console.log('[seed] Cobros + historial de pagos generados.');

    // Colores de estado personalizados (solo Trawen, para probar la vista de configuración).
    const chargeColorRows = [
      ['pending', null], ['partial', '#F59E0B'], ['paid', '#16A34A'], ['exempt', '#38BDF8'], ['overdue', '#DC2626'], ['not_applicable', '#94A3B8'],
    ];
    for (const [code, color] of chargeColorRows) {
      await conn.query('INSERT INTO charge_status_colors (club_id, status_code, color) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE color = VALUES(color)', [trawenId, code, color]);
    }

    // =====================================================================================
    // GASTOS — Trawen: categorías + gastos recurrentes con historial. Andes: 1 gasto. Halcones: nada.
    // =====================================================================================
    async function ensureExpenseCategory(clubId, name, color) {
      const [existing] = await conn.query('SELECT id FROM expense_categories WHERE club_id = ? AND name = ?', [clubId, name]);
      if (existing.length) return existing[0].id;
      const [result] = await conn.query('INSERT INTO expense_categories (uuid, club_id, name, color) VALUES (?, ?, ?, ?)', [uuid(), clubId, name, color]);
      return result.insertId;
    }
    async function ensureExpense(clubId, { categoryId, name, description, color, amount, payee, recurrence, startDate, dueDay, dueMonth, createdBy }) {
      const [existing] = await conn.query('SELECT id FROM expenses WHERE club_id = ? AND name = ?', [clubId, name]);
      if (existing.length) return existing[0].id;
      const [result] = await conn.query(
        `INSERT INTO expenses (uuid, club_id, category_id, name, description, color, amount, payee, recurrence, start_date, due_day, due_month, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
        [uuid(), clubId, categoryId, name, description, color, amount, payee, recurrence, startDate, dueDay || null, dueMonth || null, createdBy]
      );
      return result.insertId;
    }
    async function generateExpenseMonthlyHistory(expenseId, clubId, amount, monthsBack, monthsFwd, dueDay, registeredBy) {
      const now = TODAY;
      const startYear = now.getFullYear();
      const startMonth = now.getMonth() + 1;
      for (let offset = -monthsBack; offset <= monthsFwd; offset++) {
        const { year, month } = addMonthsLabel(startYear, startMonth, offset);
        const label = `${year}-${pad(month)}`;
        const day = clampDay(year, month, dueDay);
        const dueDate = toDateString(year, month, day);
        let status = 'pending';
        if (offset < 0) status = pickWeighted([['paid', 88], ['pending', 12]]);
        else if (offset === 0) status = pickWeighted([['paid', 40], ['pending', 60]]);
        const [insertResult] = await conn.query(
          `INSERT IGNORE INTO expense_instances (uuid, expense_id, period_label, amount, due_date, status) VALUES (?, ?, ?, ?, ?, ?)`,
          [uuid(), expenseId, label, amount, dueDate, status]
        );
        if (!insertResult.insertId) continue;
        if (status === 'paid') {
          await conn.query(
            `INSERT INTO expense_payments (uuid, club_id, expense_instance_id, amount, paid_at, registered_by) VALUES (?, ?, ?, ?, ?, ?)`,
            [uuid(), clubId, insertResult.insertId, amount, `${dueDate} 09:00:00`, registeredBy]
          );
        }
      }
    }

    const catArriendo = await ensureExpenseCategory(trawenId, 'Arriendo cancha', '#DC2626');
    const catImplementacion = await ensureExpenseCategory(trawenId, 'Implementación', '#0EA5E9');
    const catArbitraje = await ensureExpenseCategory(trawenId, 'Arbitrajes', '#F59E0B');
    const catOtros = await ensureExpenseCategory(trawenId, 'Otros', '#6366F1');

    const arriendoId = await ensureExpense(trawenId, {
      categoryId: catArriendo, name: 'Arriendo de cancha', description: 'Arriendo mensual de la cancha municipal', color: '#DC2626',
      amount: 180000, payee: 'Municipalidad', recurrence: 'monthly', startDate: formatDateOnly(addDays(TODAY, -420)), dueDay: 1, createdBy: trawenAdminUserId,
    });
    await generateExpenseMonthlyHistory(arriendoId, trawenId, 180000, 14, 1, 1, trawenTesoreroUserId);

    const arbitrajeId = await ensureExpense(trawenId, {
      categoryId: catArbitraje, name: 'Arbitrajes fin de semana', description: 'Pago de árbitros para partidos oficiales', color: '#F59E0B',
      amount: 45000, payee: 'Asociación de árbitros', recurrence: 'monthly', startDate: formatDateOnly(addDays(TODAY, -300)), dueDay: 25, createdBy: trawenAdminUserId,
    });
    await generateExpenseMonthlyHistory(arbitrajeId, trawenId, 45000, 9, 0, 25, trawenTesoreroUserId);

    const balonesId = await ensureExpense(trawenId, {
      categoryId: catImplementacion, name: 'Compra de balones', description: 'Renovación de balones de entrenamiento', color: '#0EA5E9',
      amount: 60000, payee: 'Juan Pérez, tienda deportiva', recurrence: 'once', startDate: formatDateOnly(addDays(TODAY, -60)), createdBy: trawenAdminUserId,
    });
    await conn.query(
      `INSERT IGNORE INTO expense_instances (uuid, expense_id, period_label, amount, due_date, status) VALUES (?, ?, 'unico', ?, ?, 'paid')`,
      [uuid(), balonesId, 60000, formatDateOnly(addDays(TODAY, -60))]
    );
    const [[balonesInstance]] = await conn.query("SELECT id FROM expense_instances WHERE expense_id = ? AND period_label = 'unico'", [balonesId]);
    if (balonesInstance) {
      await conn.query(
        `INSERT IGNORE INTO expense_payments (uuid, club_id, expense_instance_id, amount, paid_at, registered_by) VALUES (?, ?, ?, ?, ?, ?)`,
        [uuid(), trawenId, balonesInstance.id, 60000, `${formatDateOnly(addDays(TODAY, -60))} 15:00:00`, trawenTesoreroUserId]
      );
    }

    await ensureExpenseCategory(trawenId, 'Sueldo entrenador', '#111827');

    const andesArriendoId = await ensureExpense(andesId, {
      categoryId: await ensureExpenseCategory(andesId, 'Arriendo', '#0EA5E9'),
      name: 'Arriendo de gimnasio', description: 'Arriendo mensual del gimnasio municipal', color: '#0EA5E9',
      amount: 90000, payee: 'Municipalidad de Los Andes', recurrence: 'monthly', startDate: formatDateOnly(addDays(TODAY, -365)), dueDay: 1, createdBy: andesAdminId,
    });
    await generateExpenseMonthlyHistory(andesArriendoId, andesId, 90000, 12, 0, 1, andesAdminId);

    console.log('[seed] Gastos + historial generados.');

    // =====================================================================================
    // ENTRENAMIENTOS — Trawen: 3 entrenamientos con 1 año de asistencia. Andes: 1. Halcones: nada.
    // =====================================================================================
    async function ensureTraining(clubId, { name, description, color, startDate, status = 'active', createdBy }) {
      const [existing] = await conn.query('SELECT id, status FROM trainings WHERE club_id = ? AND name = ?', [clubId, name]);
      if (existing.length) return existing[0].id;
      const [result] = await conn.query(
        `INSERT INTO trainings (uuid, club_id, name, description, color, start_date, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuid(), clubId, name, description, color, startDate, status, createdBy]
      );
      return result.insertId;
    }
    async function setTrainingSchedule(trainingId, dayOfWeek, startTime, endTime) {
      const [existing] = await conn.query('SELECT id FROM training_schedules WHERE training_id = ? AND day_of_week = ?', [trainingId, dayOfWeek]);
      if (existing.length) return;
      await conn.query('INSERT INTO training_schedules (training_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)', [trainingId, dayOfWeek, startTime, endTime]);
    }
    async function setTrainingTargetGroup(trainingId, groupId) {
      await conn.query('INSERT IGNORE INTO training_target_groups (training_id, group_id) VALUES (?, ?)', [trainingId, groupId]);
    }
    async function setTrainingTargetMembers(trainingId, memberIds) {
      for (const memberId of memberIds) await conn.query('INSERT IGNORE INTO training_target_members (training_id, member_id) VALUES (?, ?)', [trainingId, memberId]);
    }
    async function setTrainingResponsible(trainingId, memberId, groupId) {
      await conn.query('INSERT IGNORE INTO training_responsible_members (training_id, member_id, group_id, position) VALUES (?, ?, ?, 0)', [trainingId, memberId, groupId]);
    }

    /** Genera todas las fechas de sesión (por horario semanal) entre `startDate` y `endDate`
     * (inclusive), y marca asistencia realista para cada miembro objetivo: mayormente asistió,
     * algo de ausente, un tramo congelado para un miembro, un par de sesiones futuras pending. */
    async function generateAttendanceHistory(trainingId, dayOfWeeks, startDate, endDate, memberIds, markedBy) {
      const frozenMember = memberIds.length > 1 ? memberIds[1] : null;
      let cursor = new Date(startDate);
      const end = new Date(endDate);
      const sessionDates = [];
      while (cursor <= end) {
        if (dayOfWeeks.includes(isoDayOfWeek(cursor))) sessionDates.push(formatDateOnly(cursor));
        cursor = addDays(cursor, 1);
      }
      const now = TODAY;
      const frozenFrom = sessionDates[Math.floor(sessionDates.length * 0.35)];
      const frozenTo = sessionDates[Math.floor(sessionDates.length * 0.45)];

      for (const memberId of memberIds) {
        for (const sessionDate of sessionDates) {
          const isFuture = new Date(sessionDate) > now;
          const isFrozenWindow = memberId === frozenMember && sessionDate >= frozenFrom && sessionDate <= frozenTo;
          let status = 'pending';
          let exemptType = null;
          let markedAt = null;
          if (isFuture) {
            status = 'pending';
          } else if (isFrozenWindow) {
            status = 'exempt';
            exemptType = 'frozen';
            markedAt = `${sessionDate} 20:00:00`;
          } else {
            status = pickWeighted([['attended', 78], ['absent', 18], ['exempt', 4]]);
            if (status === 'exempt') exemptType = 'not_applicable';
            markedAt = `${sessionDate} 20:00:00`;
          }
          await conn.query(
            `INSERT IGNORE INTO training_attendances (uuid, training_id, member_id, session_date, status, exempt_type, exempt_reason, marked_by, marked_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [uuid(), trainingId, memberId, sessionDate, status, exemptType, isFrozenWindow ? 'Lesión' : null, markedAt ? markedBy : null, markedAt]
          );
        }
      }
    }

    const futbolAdultosId = await ensureTraining(trawenId, {
      name: 'Fútbol Primera Adultos', description: 'Entrenamiento de la categoría adulta competitiva', color: '#DC2626',
      startDate: formatDateOnly(addDays(TODAY, -400)), createdBy: trawenAdminUserId,
    });
    await setTrainingSchedule(futbolAdultosId, 1, '19:00:00', '20:30:00');
    await setTrainingSchedule(futbolAdultosId, 3, '19:00:00', '20:30:00');
    await setTrainingSchedule(futbolAdultosId, 5, '19:00:00', '20:30:00');
    await setTrainingTargetGroup(futbolAdultosId, trawenGroupAdultos);
    await setTrainingResponsible(futbolAdultosId, trawenEntrenadorMember.id, null);
    await generateAttendanceHistory(futbolAdultosId, [1, 3, 5], formatDateOnly(addDays(TODAY, -400)), formatDateOnly(addDays(TODAY, 10)), trawenAdultosIds, trawenEntrenadorUserId);

    const trawenJuvenilIds = trawenMembers.filter((m) => m.groupId === trawenGroupJuvenil && m.status === 'active').map((m) => m.id);
    const futbolJuvenilId = await ensureTraining(trawenId, {
      name: 'Fútbol Juvenil', description: 'Entrenamiento de la categoría juvenil', color: '#2563EB',
      startDate: formatDateOnly(addDays(TODAY, -365)), createdBy: trawenAdminUserId,
    });
    await setTrainingSchedule(futbolJuvenilId, 2, '17:00:00', '18:30:00');
    await setTrainingSchedule(futbolJuvenilId, 4, '17:00:00', '18:30:00');
    await setTrainingTargetGroup(futbolJuvenilId, trawenGroupJuvenil);
    await setTrainingResponsible(futbolJuvenilId, trawenEntrenadorMember.id, trawenGroupJuvenil);
    // Segundo responsable, acotado a este mismo grupo — demuestra multi-responsable por grupo.
    await setTrainingResponsible(futbolJuvenilId, trawenResponsableMember.id, trawenGroupJuvenil);
    await generateAttendanceHistory(futbolJuvenilId, [2, 4], formatDateOnly(addDays(TODAY, -365)), formatDateOnly(addDays(TODAY, 10)), trawenJuvenilIds, trawenEntrenadorUserId);

    // "tc damas" ya existía (inactivo) — se completa con horario/targets/historial para que no
    // se vea vacío/roto en las capturas, y se deja inactivo a propósito (prueba visual de ese estado).
    const [[tcDamas]] = await conn.query("SELECT id FROM trainings WHERE club_id = ? AND name = 'tc damas' LIMIT 1", [trawenId]);
    if (tcDamas) {
      await setTrainingSchedule(tcDamas.id, 6, '10:00:00', '11:30:00');
      await setTrainingTargetGroup(tcDamas.id, trawenGroupInfantil);
      await setTrainingResponsible(tcDamas.id, trawenEntrenadorMember.id, null);
      const trawenInfantilIds = trawenMembers.filter((m) => m.groupId === trawenGroupInfantil && m.status === 'active').map((m) => m.id);
      await generateAttendanceHistory(tcDamas.id, [6], formatDateOnly(addDays(TODAY, -200)), formatDateOnly(TODAY), trawenInfantilIds, trawenEntrenadorUserId);
    }

    const andesEntrenamientoId = await ensureTraining(andesId, {
      name: 'Atletismo General', description: 'Entrenamiento general de atletismo', color: '#0EA5E9',
      startDate: formatDateOnly(addDays(TODAY, -300)), createdBy: andesAdminId,
    });
    await setTrainingSchedule(andesEntrenamientoId, 2, '18:00:00', '19:30:00');
    await setTrainingSchedule(andesEntrenamientoId, 6, '09:00:00', '10:30:00');
    await setTrainingTargetGroup(andesEntrenamientoId, andesGroupSenior);
    await setTrainingTargetGroup(andesEntrenamientoId, andesGroupJunior);
    await generateAttendanceHistory(andesEntrenamientoId, [2, 6], formatDateOnly(addDays(TODAY, -300)), formatDateOnly(addDays(TODAY, 10)), andesActiveMemberIds, andesAdminId);

    console.log('[seed] Entrenamientos + historial de asistencia generados.');

    const trainingColorRows = [['pending', null], ['attended', '#16A34A'], ['absent', '#DC2626'], ['not_applicable', '#94A3B8'], ['frozen', '#38BDF8']];
    for (const [code, color] of trainingColorRows) {
      await conn.query('INSERT INTO training_status_colors (club_id, status_code, color) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE color = VALUES(color)', [trawenId, code, color]);
    }

    // =====================================================================================
    // INVITACIONES + SOLICITUDES DE UNIÓN (Trawen)
    // =====================================================================================
    async function ensureInvitation(clubId, { code, createdBy, maxUses, expiresAt, status, defaultRoleId, requiresProfile, note }) {
      const [existing] = await conn.query('SELECT id FROM invitations WHERE code = ?', [code]);
      if (existing.length) return existing[0].id;
      const [result] = await conn.query(
        `INSERT INTO invitations (uuid, club_id, code, created_by, max_uses, expires_at, status, default_role_id, requires_member_profile, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuid(), clubId, code, createdBy, maxUses || null, expiresAt || null, status, defaultRoleId || null, requiresProfile ? 1 : 0, note || null]
      );
      return result.insertId;
    }
    await ensureInvitation(trawenId, { code: 'TRAWEN-2026', createdBy: trawenAdminUserId, maxUses: 50, status: 'active', requiresProfile: true, note: 'Invitación general de temporada 2026' });
    await ensureInvitation(trawenId, { code: 'TRAWEN-JUV24', createdBy: trawenAdminUserId, maxUses: 20, status: 'expired', expiresAt: formatDateOnly(addDays(TODAY, -30)) + ' 00:00:00', note: 'Captación juvenil 2024 (vencida)' });
    await ensureInvitation(trawenId, { code: 'TRAWEN-OLD', createdBy: trawenAdminUserId, status: 'revoked', note: 'Código antiguo revocado' });

    // Solicitud de unión pendiente — un usuario nuevo pidiendo entrar a Trawen.
    const prospectoName = randomName();
    const prospectoEmail = slugEmail(prospectoName.firstName, prospectoName.lastName, '.prospecto');
    const prospectoUserId = await createUser(conn, { username: `${prospectoName.firstName} ${prospectoName.lastName}`, email: prospectoEmail });
    const [existingJoinReq] = await conn.query('SELECT id FROM join_requests WHERE club_id = ? AND user_id = ?', [trawenId, prospectoUserId]);
    if (!existingJoinReq.length) {
      await conn.query(
        `INSERT INTO join_requests (club_id, user_id, message, status) VALUES (?, ?, ?, 'pending')`,
        [trawenId, prospectoUserId, 'Hola, jugué en la selección de mi colegio y me gustaría sumarme al club esta temporada.']
      );
    }

    console.log('[seed] Invitaciones + solicitud de unión generadas.');

    // =====================================================================================
    // NOTIFICACIONES
    // =====================================================================================
    async function addNotification(userId, clubId, type, title, message, link, isRead, daysAgo) {
      const createdAt = `${formatDateOnly(addDays(TODAY, -daysAgo))} ${pad(randInt(8, 21))}:${pad(randInt(0, 59))}:00`;
      await conn.query(
        `INSERT INTO notifications (user_id, club_id, type, title, message, link, is_read, read_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, clubId, type, title, message, link || null, isRead ? 1 : 0, isRead ? createdAt : null, createdAt]
      );
    }
    await addNotification(trawenAdminUserId, trawenId, 'info', 'Nueva solicitud de unión', `${prospectoName.firstName} ${prospectoName.lastName} solicitó unirse al club.`, '/settings', false, 1);
    await addNotification(trawenAdminUserId, trawenId, 'warning', 'Cobros atrasados', 'Hay cuotas pendientes de meses anteriores.', '/treasury/charges', false, 3);
    await addNotification(trawenAdminUserId, trawenId, 'success', 'Cobro creado', 'El cobro "Cuota Cafetería" fue creado correctamente.', '/treasury/charges', true, 300);
    await addNotification(trawenTesoreroUserId, trawenId, 'info', 'Recordatorio', 'Quedan cuotas del mes por registrar.', '/treasury/payments', false, 2);
    await addNotification(trawenEntrenadorUserId, trawenId, 'success', 'Entrenamiento actualizado', 'Se actualizó el horario de Fútbol Juvenil.', '/trainings', true, 40);
    await addNotification(trawenEntrenadorUserId, trawenId, 'info', 'Asistencia pendiente', 'Hay sesiones recientes sin marcar asistencia.', '/trainings/attendance', false, 1);
    await addNotification(trawenResponsableUserId, trawenId, 'info', 'Recordatorio de cobro', 'La Cuota Cafetería del mes sigue pendiente para varios miembros.', '/treasury/payments', false, 5);

    console.log('[seed] Notificaciones generadas.');

    // =====================================================================================
    // AUDITORÍA — variedad de acciones a lo largo del año.
    // =====================================================================================
    async function addAudit(userId, clubId, action, entityType, entityId, daysAgo, changes) {
      const createdAt = `${formatDateOnly(addDays(TODAY, -daysAgo))} ${pad(randInt(8, 21))}:${pad(randInt(0, 59))}:00`;
      await conn.query(
        `INSERT INTO audit_logs (user_id, club_id, action, entity_type, entity_id, changes, ip_address, user_agent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, '127.0.0.1', 'Mozilla/5.0 (seed)', ?)`,
        [userId, clubId, action, entityType, entityId, changes ? JSON.stringify(changes) : null, createdAt]
      );
    }
    const auditEvents = [
      [trawenAdminUserId, 'CHARGE_CREATED', 'charge', mensualidadId, 400],
      [trawenAdminUserId, 'CHARGE_CREATED', 'charge', cuotaFederacionId, 380],
      [trawenAdminUserId, 'CHARGE_CREATED', 'charge', implementacionId, 180],
      [trawenAdminUserId, 'CHARGE_CREATED', 'charge', trawenCafeteriaId, 300],
      [trawenAdminUserId, 'TRAINING_CREATED', 'training', futbolAdultosId, 400],
      [trawenAdminUserId, 'TRAINING_CREATED', 'training', futbolJuvenilId, 365],
      [trawenAdminUserId, 'MEMBER_GROUP_CREATED', 'member_group', trawenGroupAdultos, 410],
      [trawenAdminUserId, 'MEMBER_GROUP_CREATED', 'member_group', trawenGroupJuvenil, 410],
      [trawenAdminUserId, 'ROLE_CREATED', 'role', trawenTesoreroRole, 405],
      [trawenAdminUserId, 'ROLE_CREATED', 'role', trawenEntrenadorRole, 405],
      [trawenAdminUserId, 'ROLE_CREATED', 'role', trawenDirectivaRole, 200],
      [trawenAdminUserId, 'INVITATION_CREATED', 'invitation', null, 30],
      [trawenAdminUserId, 'USER_ROLES_UPDATED', 'user', trawenTesoreroUserId, 405],
      [trawenTesoreroUserId, 'PAYMENT_CREATED', 'payment', null, 60],
      [trawenTesoreroUserId, 'PAYMENT_CREATED', 'payment', null, 30],
      [trawenTesoreroUserId, 'EXPENSE_CREATED', 'expense', arriendoId, 400],
      [trawenEntrenadorUserId, 'ATTENDANCE_MARKED', 'training_attendance', null, 5],
      [trawenEntrenadorUserId, 'ATTENDANCE_MARKED', 'training_attendance', null, 2],
      [trawenAdminUserId, 'CLUB_UPDATED', 'club', trawenId, 100],
      [trawenAdminUserId, 'LOGIN', 'user', trawenAdminUserId, 0],
      [trawenTesoreroUserId, 'LOGIN', 'user', trawenTesoreroUserId, 0],
      [trawenEntrenadorUserId, 'LOGIN', 'user', trawenEntrenadorUserId, 0],
    ];
    for (const [userId, action, entityType, entityId, daysAgo] of auditEvents) {
      await addAudit(userId, trawenId, action, entityType, entityId, daysAgo, null);
    }

    console.log('[seed] Auditoría generada.');
    console.log('[seed] ¡Ecosistema completo generado con éxito!');
  } finally {
    conn.release();
  }
}

module.exports = { main };

if (require.main === module) {
  main()
    .then(() => {
      console.log('[seed] Parte 1 (clubes/roles/miembros/usuarios) completa.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[seed] ERROR:', err);
      process.exit(1);
    });
}
