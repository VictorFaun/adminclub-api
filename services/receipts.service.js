const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const env = require('../config/env');
const paymentsRepository = require('../repositories/payments.repository');
const clubsRepository = require('../repositories/clubs.repository');
const membersRepository = require('../repositories/members.repository');
const emailService = require('./email.service');
const logger = require('../helpers/logger');
const AppError = require('../helpers/AppError');
const { renderClubEmail } = require('../helpers/emailTemplate');
const { toAbsoluteMediaUrl } = require('../helpers/mediaUrl');

const UPLOAD_ROOT = path.join(__dirname, '..', env.upload.dir);
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CL')}`;
const day = (value) => {
  const d = new Date(value);
  return `${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
};
const periodText = (label) => {
  if (label === 'unico') return 'Pago único';
  const m = /^(\d{4})-(\d{2})$/.exec(label || '');
  if (m) return `${MONTHS[Number(m[2]) - 1].replace(/^./, (c) => c.toUpperCase())} ${m[1]}`;
  if (/^\d{4}$/.test(label || '')) return `Año ${label}`;
  return label || '';
};

/** Logo del club como archivo local (pdfkit solo dibuja PNG/JPG desde disco o buffer). */
function localLogo(logoUrl) {
  if (!logoUrl || /^https?:/i.test(logoUrl)) return null;
  const file = path.join(UPLOAD_ROOT, logoUrl.replace(/^\/?uploads\//, ''));
  return file.startsWith(UPLOAD_ROOT) && fs.existsSync(file) && /\.(png|jpe?g)$/i.test(file) ? file : null;
}

/**
 * Recibo en PDF de uno o varios pagos del mismo miembro (un pago múltiple de la página pública
 * genera un recibo con todos sus períodos).
 */
class ReceiptsService {
  async _load(clubId, paymentIds) {
    const payments = [];
    for (const id of paymentIds) {
      const p = await paymentsRepository.findActiveById(id);
      if (!p || p.club_id !== clubId) throw AppError.notFound('Pago no encontrado.');
      payments.push({ ...p, allocations: await paymentsRepository.getAllocations(p.id) });
    }
    if (new Set(payments.map((p) => p.member_id)).size > 1) throw AppError.badRequest('Un recibo agrupa pagos de un mismo miembro.');
    const club = await clubsRepository.findById(clubId);
    const member = await membersRepository.findActiveById(payments[0].member_id);
    return { payments, club, member };
  }

  async buildPdf(clubId, paymentIds) {
    const { payments, club, member } = await this._load(clubId, paymentIds);
    const fullName = member ? [member.first_name, member.middle_name, member.last_name, member.second_last_name].filter(Boolean).join(' ') || `Miembro #${member.id}` : 'Miembro';
    const total = payments.reduce((s, p) => s + Number(p.amount), 0);
    const number = payments.map((p) => String(p.id).padStart(6, '0')).join(', ');
    const color = club.primary_color || '#1F2937';

    const doc = new PDFDocument({ size: 'A5', margin: 36, info: { Title: `Recibo ${number} — ${club.name}`, Author: club.name } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    const width = doc.page.width - 72;
    // Encabezado
    doc.rect(0, 0, doc.page.width, 6).fill(color);
    const logo = localLogo(club.logo_url);
    let y = 30;
    if (logo) {
      try {
        doc.image(logo, 36, y, { fit: [48, 48] });
      } catch {
        // logo ilegible: se omite
      }
    }
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(15).text(club.name, logo ? 94 : 36, y + 6, { width: width - 60 });
    doc.font('Helvetica').fontSize(9).fillColor('#6B7280').text('Comprobante de pago', logo ? 94 : 36, y + 26);
    y = 96;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#6B7280').text(`N° ${number}`, 36, y, { width, align: 'right' });
    doc.text(`Fecha de pago: ${day(payments[0].paid_at)}`, 36, y + 12, { width, align: 'right' });

    // Miembro
    y += 36;
    doc.font('Helvetica').fontSize(8).fillColor('#6B7280').text('RECIBIMOS DE', 36, y);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827').text(fullName, 36, y + 11);
    if (member?.rut) doc.font('Helvetica').fontSize(9).fillColor('#374151').text(member.rut, 36, y + 27);

    // Detalle
    y += 52;
    doc.rect(36, y, width, 20).fill('#F3F4F6');
    doc.fillColor('#374151').font('Helvetica-Bold').fontSize(8.5).text('CONCEPTO', 44, y + 6).text('MONTO', 36, y + 6, { width: width - 8, align: 'right' });
    y += 26;
    for (const p of payments) {
      const a = p.allocations[0];
      const concept = a ? `${a.charge_name} · ${periodText(a.period_label)}` : 'Pago';
      doc.font('Helvetica').fontSize(10).fillColor('#111827').text(concept, 44, y, { width: width - 110 });
      doc.text(clp(p.amount), 36, y, { width: width - 8, align: 'right' });
      y = Math.max(y + 16, doc.y + 4);
      if (p.note) {
        doc.fontSize(8).fillColor('#6B7280').text(p.note, 44, y - 2, { width: width - 110 });
        y = doc.y + 6;
      }
    }
    doc.moveTo(36, y).lineTo(36 + width, y).strokeColor('#E5E7EB').stroke();
    y += 8;
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827').text('Total', 44, y).text(clp(total), 36, y, { width: width - 8, align: 'right' });

    // Destino
    y += 30;
    const dest = payments[0].paid_to_member_id ? `${payments[0].paid_to_member_name || 'Responsable'} (responsable del cobro)` : `Tesorería${payments[0].treasury_account_name ? ` · ${payments[0].treasury_account_name}` : ''}`;
    doc.font('Helvetica').fontSize(8).fillColor('#6B7280').text('PAGADO A', 36, y);
    doc.font('Helvetica').fontSize(10).fillColor('#111827').text(dest, 36, y + 11);

    doc.font('Helvetica').fontSize(7.5).fillColor('#9CA3AF').text(`Emitido el ${day(new Date())} · ${club.name}`, 36, doc.page.height - 50, { width, align: 'center' });
    doc.end();
    return { buffer: await done, filename: `recibo-${number.replace(/, /g, '-')}.pdf`, club, member, total };
  }

  /** Envía el recibo al correo del miembro (campo con uso "correo"), si tiene. Mejor esfuerzo. */
  emailToMember(clubId, paymentIds) {
    (async () => {
      const { buffer, filename, club, member, total } = await this.buildPdf(clubId, paymentIds);
      const to = String(member?.email || '').trim();
      if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return;
      await emailService.send({
        to,
        subject: `Recibo de tu pago en ${club.name}`,
        html: renderClubEmail({
          club: { name: club.name, primaryColor: club.primary_color, logoUrl: toAbsoluteMediaUrl(club.logo_url) },
          title: 'Recibimos tu pago',
          bodyHtml: `<p>Hola${member.first_name ? ` ${String(member.first_name).replace(/[<>&]/g, '')}` : ''},</p><p>Registramos tu pago por <strong>${clp(total)}</strong>. Te adjuntamos el recibo.</p>`,
        }),
        attachments: [{ filename, content: buffer }],
      });
    })().catch((error) => logger.error(`[receipts] correo de recibo: ${error.message}`));
  }
}

module.exports = new ReceiptsService();
