const { pool } = require('../config/database');
const clubsRepository = require('../repositories/clubs.repository');
const settingsRepository = require('../repositories/settings.repository');
const memberFieldsRepository = require('../repositories/memberFields.repository');
const { SUGGESTED_FIELDS } = require('../helpers/memberFieldTypes');

const DISMISSED_KEY = 'setup_checklist_dismissed';

/**
 * "Primeros pasos" de un club nuevo: qué le falta configurar para empezar a usar la plataforma,
 * con el enlace a cada pantalla. Se calcula con los datos reales (no hay que marcar nada a mano)
 * y el administrador puede ocultarlo.
 */
class ClubSetupService {
  async checklist(clubId) {
    const club = await clubsRepository.findById(clubId);
    const settings = await settingsRepository.findAllByClub(clubId);
    const count = async (sql, params = [clubId]) => Number((await pool.query(sql, params))[0][0].n);
    const fields = await memberFieldsRepository.findByClub(clubId);
    const suggestedCodes = new Set(SUGGESTED_FIELDS.map((f) => f.code));

    const items = [
      {
        key: 'branding',
        title: 'Sube el logo y el banner del club',
        description: 'Aparecen en el menú, la página de pagos y el formulario de inscripción.',
        link: '/settings',
        done: !!club.logo_url && !!club.banner_url,
      },
      {
        key: 'ficha',
        title: 'Arma la ficha de tus miembros',
        description: 'Agrega los datos propios del club (talla, posición, salud…), secciones y documentos.',
        link: '/members/settings',
        done: fields.some((f) => !suggestedCodes.has(f.code)),
      },
      {
        key: 'groups',
        title: 'Crea los grupos o categorías',
        description: 'Ordenan a los miembros y sirven para cobrar y entrenar por grupo.',
        link: '/members/groups',
        done: (await count('SELECT COUNT(*) AS n FROM member_groups WHERE club_id = ?')) > 0,
      },
      {
        key: 'members',
        title: 'Carga a tus miembros',
        description: 'Uno a uno, importando una planilla de Excel o con el formulario de inscripción.',
        link: '/members/list',
        done: (await count('SELECT COUNT(*) AS n FROM members WHERE club_id = ? AND deleted_at IS NULL')) > 1,
      },
      {
        key: 'team',
        title: 'Invita a tu directiva',
        description: 'Cada uno entra con su cuenta y el rol que le corresponde (Tesorería, Secretaría…).',
        link: '/invitations',
        done: (await count("SELECT COUNT(*) AS n FROM user_clubs WHERE club_id = ? AND status = 'active'")) > 1,
      },
      {
        key: 'account',
        title: 'Completa los datos de la cuenta bancaria',
        description: 'Se muestran a quienes pagan por transferencia.',
        link: '/treasury/settings',
        done: (await count('SELECT COUNT(*) AS n FROM treasury_accounts WHERE club_id = ? AND deleted_at IS NULL AND account_number IS NOT NULL AND account_number <> ""')) > 0,
      },
      {
        key: 'charges',
        title: 'Crea tu primer cobro',
        description: 'Mensualidad, inscripción, cuotas únicas… por grupo o por miembro.',
        link: '/treasury/charges/new',
        done: (await count('SELECT COUNT(*) AS n FROM charges WHERE club_id = ? AND deleted_at IS NULL')) > 0,
      },
      {
        key: 'publicPay',
        title: 'Activa la página pública de pagos',
        description: 'Tus miembros ven lo que deben y suben su comprobante, sin cuenta.',
        link: '/treasury/settings',
        done: settings.public_payments_enabled === '1',
      },
    ];
    const completed = items.filter((i) => i.done).length;
    return { dismissed: settings[DISMISSED_KEY] === '1', completed, total: items.length, items };
  }

  async setDismissed(clubId, dismissed) {
    await settingsRepository.upsertMany(clubId, { [DISMISSED_KEY]: dismissed ? '1' : '0' });
    return this.checklist(clubId);
  }
}

module.exports = new ClubSetupService();
