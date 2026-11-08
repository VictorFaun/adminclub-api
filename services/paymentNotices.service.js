const membersRepository = require('../repositories/members.repository');
const clubsRepository = require('../repositories/clubs.repository');
const usersRepository = require('../repositories/users.repository');
const settingsRepository = require('../repositories/settings.repository');
const chargeInstancesRepository = require('../repositories/chargeInstances.repository');
const paymentProofsRepository = require('../repositories/paymentProofs.repository');
const memberGuardiansRepository = require('../repositories/memberGuardians.repository');
const notificationsService = require('./notifications.service');
const receiptsService = require('./receipts.service');
const emailService = require('./email.service');
const { renderClubEmail, renderTable, renderHighlight, renderNote, escapeHtml } = require('../helpers/emailTemplate');
const { toAbsoluteMediaUrl } = require('../helpers/mediaUrl');
const logger = require('../helpers/logger');
const env = require('../config/env');

/** Mismas claves que paymentProofs.service.js / selfService.service.js (club_settings). */
const PUBLIC_PAYMENTS_KEY = 'public_payments_enabled';
const SELF_SERVICE_KEY = 'self_service_enabled';
/** "Lo que sigue": períodos por pagar que vencen dentro de estos días (o ya vencieron). */
const UPCOMING_DAYS = 45;
/** Cuántos períodos pendientes se listan en el correo (el resto va resumido). */
const NEXT_SHOWN = 3;

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** "2026-03" → "Marzo 2026"; "unico" → "Pago único". */
const periodText = (label) => {
  if (label === 'unico') return 'Pago único';
  const m = /^(\d{4})-(\d{2})$/.exec(label || '');
  if (m) return `${MONTHS[Number(m[2]) - 1].replace(/^./, (c) => c.toUpperCase())} ${m[1]}`;
  if (/^\d{4}$/.test(label || '')) return `Año ${label}`;
  return label || '';
};
const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CL')}`;
const dayMonth = (value) => {
  const d = new Date(value);
  return `${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`;
};
const toDateOnly = (value) => new Date(value).toISOString().slice(0, 10);
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
const firstWord = (v) => String(v || '').trim().split(/\s+/)[0] || '';

/**
 * Avisos a quien pagó cuando se revisa su comprobante. Por cada persona y hecho, UN solo correo:
 *  - Aprobado: "Registramos tu pago" con el detalle, lo que queda pendiente y el recibo en PDF adjunto.
 *  - Rechazado: el motivo y cómo enviar otro comprobante.
 * Llega al correo de la ficha (aunque no tenga cuenta) y a las cuentas del miembro y de sus
 * apoderados, sin repetir direcciones. Las cuentas además lo ven en la app y como push (sin un
 * segundo correo). Un pago que registra tesorería directamente no avisa a nadie.
 */
class PaymentNoticesService {
  /** Mejor esfuerzo (sin await): nunca hace fallar la revisión. `paymentIds`: pagos creados al aprobar. */
  notifyReviewed({ clubId, memberId, batch, status, reason = null, paymentIds = [] }) {
    this._send({ clubId, memberId, batch, status, reason, paymentIds }).catch((error) =>
      logger.error(`[paymentNotices] aviso de comprobante ${status}: ${error.message}`)
    );
  }

  async _send({ clubId, memberId, batch, status, reason, paymentIds }) {
    const approved = status === 'approved';
    const [member, club, settings] = await Promise.all([membersRepository.findActiveById(memberId), clubsRepository.findById(clubId), settingsRepository.findAllByClub(clubId)]);
    if (!member || !club) return;

    const lines = approved ? await this._approvedLines(clubId, paymentIds) : this._rejectedLines(batch);
    const total = lines.reduce((sum, l) => sum + l.amount, 0);
    const periods = lines.map((l) => l.period.toLowerCase()).join(', ');
    const fullName = [member.first_name, member.middle_name, member.last_name, member.second_last_name].filter(Boolean).join(' ') || `Miembro #${member.id}`;
    const shortName = firstWord(member.first_name) || fullName;

    // Destinatarios: correo de la ficha + cuentas del miembro y de sus apoderados, sin repetir.
    const recipients = new Map();
    const add = (email, data) => {
      if (!isEmail(email)) return;
      const key = String(email).trim().toLowerCase();
      const prev = recipients.get(key);
      recipients.set(key, prev ? { ...prev, ...data, own: prev.own || data.own, userId: prev.userId ?? data.userId } : { to: String(email).trim(), ...data });
    };
    const accountIds = await memberGuardiansRepository.findUserIdsForMember(member.id);
    const accounts = [];
    for (const userId of accountIds) {
      const user = await usersRepository.findById(userId);
      if (!user || user.deleted_at) continue;
      const own = userId === member.user_id;
      accounts.push({ userId, own });
      add(user.email, { own, userId, name: own ? shortName : firstWord(user.username) });
    }
    add(member.email, { own: true, userId: null, name: shortName });

    // En la app y push (las cuentas): sin correo, ya va el de abajo.
    for (const { userId } of accounts) {
      await notificationsService.notifyUser({
        userId,
        clubId,
        type: approved ? 'success' : 'warning',
        category: 'payments',
        title: approved ? `Pago registrado (${clp(total)})` : 'Comprobante rechazado',
        message: approved ? `Se registró el pago de ${periods}.` : `El comprobante de ${periods} fue rechazado${reason ? `: ${reason}` : '.'}`,
        link: `/my/payments?member=${member.id}`,
        sendEmail: false,
      });
    }
    if (!recipients.size) return;

    const brand = { name: club.name, primaryColor: club.primary_color, logoUrl: toAbsoluteMediaUrl(club.logo_url) };
    const links = {
      myClub: settings[SELF_SERVICE_KEY] === '1' ? `${env.clientUrl}/my/payments?member=${member.id}` : null,
      publicPay: settings[PUBLIC_PAYMENTS_KEY] === '1' && club.public_code ? `${env.clientUrl}/pay/${club.public_code}` : null,
    };
    const extra = approved ? await this._approvedExtra(clubId, member, paymentIds) : null;

    for (const r of recipients.values()) {
      // Con cuenta, a "Mi club"; sin cuenta (o sin "Mi club"), a la página pública de pagos.
      const ctaUrl = (r.userId && links.myClub) || links.publicPay || null;
      const mail = approved
        ? this._approvedEmail({ brand, r, fullName, shortName, lines, total, extra, ctaUrl })
        : this._rejectedEmail({ brand, r, fullName, shortName, lines, total, reason, ctaUrl });
      await emailService.send({ to: r.to, subject: mail.subject, html: mail.html, attachments: mail.attachments || [], fromName: club.name });
    }
  }

  // ------------------------------------------------------------------ contenido

  /** Un renglón por período pagado, con su estado después del pago (pagado o abono). */
  async _approvedLines(clubId, paymentIds) {
    const { payments } = await receiptsService._load(clubId, paymentIds);
    const lines = [];
    for (const p of payments) {
      for (const a of p.allocations) {
        const instance = await chargeInstancesRepository.findActiveById(a.charge_instance_id);
        const remaining = instance ? Number(instance.amount) - (await chargeInstancesRepository.sumAllocations(instance.id)) : 0;
        lines.push({ concept: a.charge_name, period: periodText(a.period_label), amount: Number(a.amount), partial: remaining > 0.005 });
      }
    }
    return lines;
  }

  _rejectedLines(batch) {
    return batch.map((p) => ({ concept: p.charge_name, period: periodText(p.period_label), amount: Number(p.amount), partial: false }));
  }

  /** Destino, folio, recibo PDF y lo que le queda por pagar. */
  async _approvedExtra(clubId, member, paymentIds) {
    const { payments } = await receiptsService._load(clubId, paymentIds);
    const first = payments[0];
    const destination = first.paid_to_member_id
      ? `${first.paid_to_member_name || 'Responsable'} (responsable del cobro)`
      : `Tesorería${first.treasury_account_name ? ` · ${first.treasury_account_name}` : ''}`;
    const receipt = await receiptsService.buildPdf(clubId, paymentIds);

    const limit = toDateOnly(new Date(Date.now() + UPCOMING_DAYS * 86400000));
    const today = toDateOnly(new Date());
    const pending = (await paymentProofsRepository.findPayableInstances(member.id))
      .map((r) => ({ ...r, remaining: Number(r.amount) - Number(r.paid_amount) }))
      .filter((r) => r.remaining > 0.005 && toDateOnly(r.due_date) <= limit);
    // Los más antiguos primero; con muchos, solo los primeros y un resumen del resto.
    const next = pending
      .slice(0, NEXT_SHOWN)
      .map((r) => `${periodText(r.period_label)} · ${r.charge_name} (${clp(r.remaining)}, ${toDateOnly(r.due_date) < today ? 'venció' : 'vence'} el ${dayMonth(r.due_date)})`);
    if (pending.length > NEXT_SHOWN) {
      const rest = pending.length - NEXT_SHOWN;
      next.push(`…y ${rest} período${rest === 1 ? '' : 's'} más · total pendiente ${clp(pending.reduce((sum, r) => sum + r.remaining, 0))}`);
    }

    return {
      destination,
      folio: payments.map((p) => String(p.id).padStart(6, '0')).join(', '),
      attachment: { filename: receipt.filename, content: receipt.buffer },
      next,
      pendingTotal: pending.reduce((sum, r) => sum + r.remaining, 0),
    };
  }

  _table(lines, { withStatus }) {
    const status = (l) => (l.partial ? '<span style="color:#b45309; font-weight:700;">Abono</span>' : '<span style="color:#15803d; font-weight:700;">Pagado</span>');
    return renderTable({
      columns: [{ label: 'Período' }, { label: 'Monto', align: 'right' }, ...(withStatus ? [{ label: 'Estado', align: 'right' }] : [])],
      rows: lines.map((l) => [`${escapeHtml(l.concept)} · ${escapeHtml(l.period)}`, clp(l.amount), ...(withStatus ? [status(l)] : [])]),
    });
  }

  _approvedEmail({ brand, r, fullName, shortName, lines, total, extra, ctaUrl }) {
    const hello = `<p>Hola${r.name ? ` ${escapeHtml(r.name)}` : ''},</p>`;
    const intro = r.own
      ? '<p>Tesorería aprobó tu comprobante y el pago quedó registrado. Te adjuntamos el recibo.</p>'
      : `<p>Registramos el pago de <strong>${escapeHtml(fullName)}</strong>, que tienes a tu cargo. Te adjuntamos el recibo.</p>`;
    const next = extra.next.length
      ? renderNote(`${r.own ? 'Te queda' : `A ${shortName} le queda`} pendiente:\n${extra.next.join('\n')}`, brand.primaryColor, 'Lo que sigue')
      : renderNote(r.own ? 'Estás al día: no tienes pagos pendientes.' : `${shortName} está al día: no tiene pagos pendientes.`, brand.primaryColor, 'Estado de cuenta');
    // En el asunto, con 3 o más períodos basta la cantidad (el detalle va en el correo).
    const periods = lines.length >= 3 ? `${lines.length} períodos` : lines.map((l) => l.period).join(', ');
    return {
      subject: r.own ? `Pago registrado: ${periods} · ${clp(total)}` : `Pago registrado de ${shortName}: ${periods} · ${clp(total)}`,
      html: renderClubEmail({
        club: brand,
        eyebrow: 'Pago registrado',
        title: r.own ? 'Registramos tu pago' : `Registramos el pago de ${shortName}`,
        // Lo que el asunto no dice: el recibo y cómo queda la cuenta.
        preheader: `Te adjuntamos el recibo. ${extra.pendingTotal ? `${r.own ? 'Te quedan' : `A ${shortName} le quedan`} ${clp(extra.pendingTotal)} pendientes.` : r.own ? 'Estás al día.' : `${shortName} está al día.`}`,
        bodyHtml: `${hello}${intro}
${renderHighlight({ label: 'Total pagado', value: clp(total), hint: `Pagado a ${extra.destination}`, tone: 'brand', color: brand.primaryColor })}
${this._table(lines, { withStatus: true })}
${next}
<p style="color:#6b6b78; font-size:13px;">Recibo N° ${escapeHtml(extra.folio)}</p>`,
        ctaText: ctaUrl ? (r.userId ? 'Ver en Mi club' : 'Ver mis pagos') : undefined,
        ctaUrl: ctaUrl || undefined,
      }),
      attachments: [extra.attachment],
    };
  }

  _rejectedEmail({ brand, r, fullName, shortName, lines, total, reason, ctaUrl }) {
    const hello = `<p>Hola${r.name ? ` ${escapeHtml(r.name)}` : ''},</p>`;
    const periods = lines.map((l) => l.period.toLowerCase()).join(', ');
    const intro = r.own
      ? `<p>Revisamos el comprobante que enviaste por <strong>${clp(total)}</strong> (${escapeHtml(periods)}) y no pudimos aprobarlo.</p>`
      : `<p>Revisamos el comprobante de <strong>${escapeHtml(fullName)}</strong> por <strong>${clp(total)}</strong> (${escapeHtml(periods)}) y no pudimos aprobarlo.</p>`;
    return {
      subject: r.own ? 'Tu comprobante fue rechazado' : `El comprobante de ${shortName} fue rechazado`,
      html: renderClubEmail({
        club: brand,
        eyebrow: 'Comprobante rechazado',
        title: 'El comprobante no pudo ser aprobado',
        preheader: reason ? `Motivo: ${reason}` : 'Revisa y envía otro comprobante.',
        bodyHtml: `${hello}${intro}
${renderNote(reason || 'El club no indicó un motivo.', '#c0362c', 'Motivo')}
<p>${ctaUrl ? 'Puedes enviar un nuevo comprobante desde el botón de abajo.' : 'Puedes enviar un nuevo comprobante al club.'} Si tienes dudas, contacta a tesorería.</p>`,
        ctaText: ctaUrl ? 'Enviar otro comprobante' : undefined,
        ctaUrl: ctaUrl || undefined,
      }),
    };
  }
}

module.exports = new PaymentNoticesService();
