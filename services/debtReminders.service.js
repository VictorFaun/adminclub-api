const { pool } = require('../config/database');
const env = require('../config/env');
const settingsRepository = require('../repositories/settings.repository');
const clubsRepository = require('../repositories/clubs.repository');
const auditRepository = require('../repositories/audit.repository');
const notificationsService = require('./notifications.service');
const emailService = require('./email.service');
const logger = require('../helpers/logger');
const { renderClubEmail } = require('../helpers/emailTemplate');
const { toAbsoluteMediaUrl } = require('../helpers/mediaUrl');
const { PROFILE_COLS, profileJoin } = require('../helpers/memberProfileSql');
const { CLUB_STATUS } = require('../config/constants');

const SETTINGS_KEY = 'debt_reminders';
const LAST_SENT_KEY = 'debt_reminders_last_sent';
const PUBLIC_PAYMENTS_KEY = 'public_payments_enabled';
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CL')}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const periodText = (label) => {
  if (label === 'unico') return 'pago único';
  const m = /^(\d{4})-(\d{2})$/.exec(label || '');
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  return /^\d{4}$/.test(label || '') ? `año ${label}` : label;
};

/**
 * Recordatorios de deuda: a cada miembro con períodos vencidos se le avisa cuánto debe, con el
 * enlace directo a su página de pago (si el club tiene la página pública activa). Va como
 * notificación en la app (si tiene cuenta vinculada, que además le llega por correo) o, si no tiene
 * cuenta, como correo a su campo "correo". Se envía a mano o automáticamente un día del mes.
 */
class DebtRemindersService {
  async getSettings(clubId) {
    const settings = await settingsRepository.findAllByClub(clubId);
    let raw = null;
    try {
      raw = JSON.parse(settings[SETTINGS_KEY] || 'null');
    } catch {
      raw = null;
    }
    const dayOfMonth = Math.min(Math.max(Number(raw?.dayOfMonth) || 15, 1), 28);
    return { enabled: !!raw?.enabled, dayOfMonth, lastSent: settings[LAST_SENT_KEY] || null };
  }

  async updateSettings(clubId, { enabled, dayOfMonth }, actorId) {
    const value = { enabled: !!enabled, dayOfMonth: Math.min(Math.max(Number(dayOfMonth) || 15, 1), 28) };
    await settingsRepository.upsertMany(clubId, { [SETTINGS_KEY]: JSON.stringify(value) });
    await auditRepository.logAction({ userId: actorId, clubId, action: 'DEBT_REMINDERS_UPDATED', entityType: 'club', entityId: clubId, changes: value });
    return this.getSettings(clubId);
  }

  /** Deudores del club: períodos vencidos con saldo, agrupados por miembro activo. Con
   * `chargeId`, solo los de ese cobro (botón "Recordar a los atrasados" de la matriz). */
  async debtors(clubId, chargeId = null) {
    const [rows] = await pool.query(
      `SELECT ci.member_id, ci.period_label, ci.amount, c.name AS charge_name,
              COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa WHERE pa.charge_instance_id = ci.id), 0) AS paid,
              m.user_id, ${PROFILE_COLS}
       FROM charge_instances ci
       INNER JOIN charges c ON c.id = ci.charge_id
       INNER JOIN members m ON m.id = ci.member_id AND m.status = 'active' AND m.deleted_at IS NULL
       ${profileJoin('m', 'mp')}
       WHERE c.club_id = ? AND ci.status IN ('pending', 'partial') AND ci.due_date < CURDATE()
         AND c.deleted_at IS NULL AND c.archived_at IS NULL ${chargeId ? 'AND c.id = ?' : ''}
       ORDER BY ci.due_date ASC`,
      chargeId ? [clubId, Number(chargeId)] : [clubId]
    );
    const byMember = new Map();
    for (const r of rows) {
      const remaining = Number(r.amount) - Number(r.paid);
      if (remaining <= 0) continue;
      if (!byMember.has(r.member_id)) {
        byMember.set(r.member_id, {
          memberId: r.member_id,
          name: [r.first_name, r.last_name].filter(Boolean).join(' ') || `Miembro #${r.member_id}`,
          email: r.email || null,
          identifier: r.rut || null,
          linkedUserId: r.user_id || null,
          total: 0,
          items: [],
        });
      }
      const d = byMember.get(r.member_id);
      d.total += remaining;
      d.items.push({ chargeName: r.charge_name, period: periodText(r.period_label), remaining });
    }
    return [...byMember.values()].map((d) => ({ ...d, channel: d.linkedUserId ? 'app' : d.email ? 'email' : null }));
  }

  async preview(clubId, chargeId = null) {
    const list = await this.debtors(clubId, chargeId);
    return {
      settings: await this.getSettings(clubId),
      debtors: list.map(({ items, ...d }) => ({ ...d, periods: items.length })),
      reachable: list.filter((d) => d.channel).length,
    };
  }

  async send(clubId, actorId = null, chargeId = null) {
    const club = await clubsRepository.findById(clubId);
    const settings = await settingsRepository.findAllByClub(clubId);
    const payBase = settings[PUBLIC_PAYMENTS_KEY] === '1' && club.public_code ? `${env.clientUrl.replace(/\/$/, '')}/pay/${club.public_code}` : null;
    const list = await this.debtors(clubId, chargeId);
    let sent = 0;
    for (const d of list) {
      if (!d.channel) continue;
      const link = payBase ? `${payBase}${d.identifier ? `/${encodeURIComponent(d.identifier)}` : ''}` : null;
      const lines = d.items.map((i) => `${i.chargeName} (${i.period}): ${clp(i.remaining)}`);
      try {
        if (d.channel === 'app') {
          await notificationsService.notifyUser({
            userId: d.linkedUserId,
            clubId,
            type: 'warning',
            title: `Tienes ${clp(d.total)} pendientes en ${club.name}`,
            message: `${lines.slice(0, 6).join(' · ')}${lines.length > 6 ? ' …' : ''}${link ? ' — Puedes pagar en la página del club.' : ''}`,
            link: link || '/dashboard',
          });
        } else {
          await emailService.send({
            to: d.email,
            subject: `Recordatorio de pago — ${club.name}`,
            html: renderClubEmail({
              club: { name: club.name, primaryColor: club.primary_color, logoUrl: toAbsoluteMediaUrl(club.logo_url) },
              title: `Tienes ${clp(d.total)} pendientes`,
              bodyHtml: `<p>Hola ${esc(d.name.split(' ')[0])},</p><p>Te recordamos que tienes estos pagos vencidos en <strong>${esc(club.name)}</strong>:</p><ul>${d.items
                .map((i) => `<li>${esc(i.chargeName)} — ${esc(i.period)}: <strong>${clp(i.remaining)}</strong></li>`)
                .join('')}</ul><p>Si ya pagaste, no te preocupes: puede que aún no lo hayamos registrado.</p>`,
              ctaText: link ? 'Ver y pagar' : undefined,
              ctaUrl: link || undefined,
            }),
          });
        }
        sent += 1;
      } catch (error) {
        logger.error(`[reminders] ${d.name}: ${error.message}`);
      }
    }
    // El envío de un solo cobro no cuenta como el envío mensual automático.
    if (!chargeId) await settingsRepository.upsertMany(clubId, { [LAST_SENT_KEY]: new Date().toISOString().slice(0, 7) });
    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'DEBT_REMINDERS_SENT',
      entityType: chargeId ? 'charge' : 'club',
      entityId: chargeId ? Number(chargeId) : clubId,
      changes: { sent, debtors: list.length },
    });
    return { sent, debtors: list.length, withoutContact: list.filter((d) => !d.channel).length };
  }

  /** Cron diario: clubes con recordatorio automático cuyo día es hoy y que no enviaron este mes. */
  async runScheduled(today = new Date()) {
    const [rows] = await pool.query("SELECT club_id FROM club_settings WHERE setting_key = ? AND setting_value LIKE '%\"enabled\":true%'", [SETTINGS_KEY]);
    let clubs = 0;
    for (const { club_id: clubId } of rows) {
      const club = await clubsRepository.findById(clubId);
      if (!club || club.status !== CLUB_STATUS.ACTIVE) continue;
      const s = await this.getSettings(clubId);
      if (!s.enabled || s.dayOfMonth !== today.getDate() || s.lastSent === today.toISOString().slice(0, 7)) continue;
      await this.send(clubId, null);
      clubs += 1;
    }
    return clubs;
  }
}

module.exports = new DebtRemindersService();
