const memberGuardiansRepository = require('../repositories/memberGuardians.repository');
const membersRepository = require('../repositories/members.repository');
const memberFieldsRepository = require('../repositories/memberFields.repository');
const settingsRepository = require('../repositories/settings.repository');
const paymentsRepository = require('../repositories/payments.repository');
const paymentProofsRepository = require('../repositories/paymentProofs.repository');
const trainingAttendancesRepository = require('../repositories/trainingAttendances.repository');
const usersRepository = require('../repositories/users.repository');
const auditRepository = require('../repositories/audit.repository');
const membersService = require('./members.service');
const memberFieldsService = require('./memberFields.service');
const paymentsService = require('./payments.service');
const paymentProofsService = require('./paymentProofs.service');
const receiptsService = require('./receipts.service');
const trainingAttendanceService = require('./trainingAttendance.service');
const calendarService = require('./calendar.service');
const clubUserInvitationsService = require('./clubUserInvitations.service');
const AppError = require('../helpers/AppError');
const { withTransaction } = require('../config/database');
const { todayLocal } = require('../helpers/membership');
const { toAbsoluteMediaUrl, deleteUploadedFile } = require('../helpers/mediaUrl');
const { parseSettings, UPLOAD_TYPES, LAYOUT_TYPES } = require('../helpers/memberFieldTypes');
const { deletePrivateFile } = require('../middlewares/privateUpload.middleware');
const { USER_CLUB_STATUS } = require('../config/constants');

/** Interruptores del club (club_settings) con su valor por defecto. */
const SETTINGS = {
  enabled: { key: 'self_service_enabled', default: false },
  payments: { key: 'self_service_payments', default: true },
  payProof: { key: 'self_service_pay_proof', default: true },
  attendance: { key: 'self_service_attendance', default: true },
  profileEdit: { key: 'self_service_profile_edit', default: false },
  guardiansInvite: { key: 'self_service_guardians_invite', default: false },
};
const SECTION_LABEL = { payments: 'los pagos', payProof: 'subir comprobantes', attendance: 'la asistencia', profileEdit: 'editar la ficha', guardiansInvite: 'invitar apoderados' };

/** Horizonte de "por vencer" (espejo de paymentProofs.service.js#DUE_SOON_DAYS). */
const DUE_SOON_DAYS = 45;
const toDateOnly = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const round = (n) => Math.round(n * 100) / 100;

/**
 * "Mi club": lo que un socio ve de SÍ MISMO (y un apoderado, de las fichas que tiene a cargo), sin
 * depender de roles. Regla de seguridad: el `memberId` que llega del cliente nunca se usa sin
 * pasar antes por `_own`, que lo busca entre "mis fichas" (propia + a cargo) recalculadas desde la
 * BD en cada request; si no está, 404 (no se confirma que exista). Los servicios reutilizados
 * (pagos, comprobantes, asistencia) se llaman por sus métodos "sin revisar acceso" y la respuesta
 * se recorta a lo que corresponde ver al socio (nada de notas internas ni quién registró).
 */
class SelfServiceService {
  // ------------------------------------------------------------------ configuración

  async getSettings(clubId) {
    const raw = await settingsRepository.findAllByClub(clubId);
    const out = {};
    for (const [name, { key, default: def }] of Object.entries(SETTINGS)) out[name] = raw[key] === undefined ? def : raw[key] === '1';
    return out;
  }

  async updateSettings(clubId, data, actorId) {
    const entries = {};
    for (const [name, { key }] of Object.entries(SETTINGS)) {
      if (data[name] !== undefined) entries[key] = data[name] ? '1' : '0';
    }
    if (Object.keys(entries).length) await settingsRepository.upsertMany(clubId, entries);
    await auditRepository.logAction({ userId: actorId, clubId, action: 'SELF_SERVICE_SETTINGS_UPDATED', entityType: 'club_settings', entityId: clubId, changes: data });
    return this.getSettings(clubId);
  }

  _require(settings, section) {
    if (!settings.enabled) throw AppError.forbidden('El club no tiene habilitado "Mi club".');
    if (section && !settings[section]) throw AppError.forbidden(`El club no habilitó ${SECTION_LABEL[section]} en "Mi club".`);
  }

  // ------------------------------------------------------------------ mis fichas

  _memberDto(row, groups = []) {
    return {
      id: row.id,
      fullName: membersService._fullName(row),
      shortName: membersService._shortName(row),
      firstName: row.first_name ?? null,
      avatarUrl: row.avatar_url ? toAbsoluteMediaUrl(row.avatar_url) : null,
      status: row.status,
      relation: row.relation,
      guardianRelation: row.guardian_relation ?? null,
      groups: groups.map((g) => ({ id: g.id, name: g.name, color: g.color })),
    };
  }

  async _ownRows(clubId, userId) {
    return memberGuardiansRepository.findOwnMembers(clubId, userId);
  }

  /** Ficha `memberId` si está entre las de la cuenta (y el club tiene "Mi club" + la sección). */
  async _own(clubId, userId, memberId, section = null) {
    const settings = await this.getSettings(clubId);
    this._require(settings, section);
    const row = (await this._ownRows(clubId, userId)).find((r) => r.id === Number(memberId));
    if (!row) throw AppError.notFound('Miembro no encontrado.');
    return { member: row, settings };
  }

  /** Menú de "Mi club": interruptores + mis fichas. */
  async overview(clubId, userId) {
    const settings = await this.getSettings(clubId);
    const rows = settings.enabled ? await this._ownRows(clubId, userId) : [];
    const groups = rows.length ? await membersRepository.getGroupsForMembers(rows.map((r) => r.id)) : {};
    return { settings, members: rows.map((r) => this._memberDto(r, groups[r.id] || [])) };
  }

  // ------------------------------------------------------------------ pagos

  /** Saldo pagado por período, desde las imputaciones de los pagos. */
  _paidByInstance(payments) {
    const map = new Map();
    for (const p of payments) for (const a of p.allocations) map.set(a.chargeInstanceId, (map.get(a.chargeInstanceId) || 0) + a.amount);
    return map;
  }

  async _ledger(clubId, memberId) {
    const { instances, payments } = await paymentsService.ledgerForMember(clubId, memberId);
    const paid = this._paidByInstance(payments);
    return {
      instances: instances.map((i) => {
        const paidAmount = i.id ? round(paid.get(i.id) || 0) : 0;
        return {
          id: i.id,
          chargeId: i.chargeId,
          chargeName: i.chargeName,
          chargeColor: i.chargeColor,
          chargeRecurrence: i.chargeRecurrence,
          periodLabel: i.periodLabel,
          amount: i.amount,
          paidAmount,
          remaining: ['exempt'].includes(i.status) ? 0 : Math.max(round(i.amount - paidAmount), 0),
          dueDate: i.dueDate,
          status: i.status,
          displayStatus: i.displayStatus,
          exemptReason: i.exemptReason,
        };
      }),
      // Sin notas internas ni quién lo registró.
      payments: payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        paidAt: p.paidAt,
        paidTo: p.paidToMemberName || p.treasuryAccountName || 'Tesorería',
        allocations: p.allocations.map((a) => ({ chargeInstanceId: a.chargeInstanceId, amount: a.amount, periodLabel: a.periodLabel, chargeName: a.chargeName, chargeColor: a.chargeColor })),
      })),
    };
  }

  /** Atrasado (vencido con saldo) y "por vencer": lo que vence en los próximos DUE_SOON_DAYS
   * (mismo horizonte que la página pública de pagos; la cuota del año siguiente no cuenta). */
  _debt(instances) {
    const today = todayLocal();
    const soon = new Date(Date.parse(`${today}T00:00:00Z`) + DUE_SOON_DAYS * 86400000).toISOString().slice(0, 10);
    let overdue = 0;
    let overdueCount = 0;
    let pending = 0;
    for (const i of instances) {
      if (!['pending', 'partial'].includes(i.status) || i.remaining <= 0) continue;
      if (toDateOnly(i.dueDate) < today) {
        overdue += i.remaining;
        overdueCount += 1;
      } else if (toDateOnly(i.dueDate) <= soon) {
        pending += i.remaining;
      }
    }
    return { overdue: round(overdue), overdueCount, pending: round(pending), total: round(overdue + pending) };
  }

  async payments(clubId, userId, memberId) {
    const { member, settings } = await this._own(clubId, userId, memberId, 'payments');
    const ledger = await this._ledger(clubId, member.id);
    return { ...ledger, debt: this._debt(ledger.instances), canSubmitProof: settings.payProof && member.status === 'active' };
  }

  async receipt(clubId, userId, paymentId) {
    const payment = await paymentsRepository.findActiveById(Number(paymentId));
    if (!payment || payment.club_id !== clubId) throw AppError.notFound('Pago no encontrado.');
    await this._own(clubId, userId, payment.member_id, 'payments');
    return receiptsService.buildPdf(clubId, [payment.id]);
  }

  async payOptions(clubId, userId, memberId) {
    const { member } = await this._own(clubId, userId, memberId, 'payProof');
    return paymentProofsService.payableForMember(member);
  }

  async submitProof(clubId, userId, memberId, body, file) {
    let member;
    try {
      ({ member } = await this._own(clubId, userId, memberId, 'payProof'));
      if (member.status !== 'active') throw AppError.badRequest('Esta ficha está retirada: no se pueden reportar pagos.');
    } catch (error) {
      if (file) deletePrivateFile(`payment-proofs/${file.filename}`);
      throw error;
    }
    return paymentProofsService.submitProofForMember(member, body, file, userId);
  }

  async proofs(clubId, userId, memberId) {
    const { member } = await this._own(clubId, userId, memberId, 'payments');
    const rows = await paymentProofsRepository.listByClub(clubId, { memberIds: [member.id] });
    // Un comprobante múltiple son varias filas (una por período): se agrupan por lote.
    const byBatch = new Map();
    for (const r of rows) {
      const key = r.batch_uuid || `p${r.id}`;
      if (!byBatch.has(key)) {
        byBatch.set(key, { id: r.id, status: r.status, paidAt: r.paid_at, createdAt: r.created_at, reviewedAt: r.reviewed_at, reviewNote: r.status === 'rejected' ? r.review_note : null, amount: 0, periods: [] });
      }
      const b = byBatch.get(key);
      b.amount = round(b.amount + Number(r.amount));
      b.periods.push({ chargeName: r.charge_name, chargeColor: r.charge_color, periodLabel: r.period_label });
    }
    return [...byBatch.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  // ------------------------------------------------------------------ asistencia

  async attendance(clubId, userId, memberId) {
    const { member } = await this._own(clubId, userId, memberId, 'attendance');
    const today = todayLocal();
    const rows = (await trainingAttendancesRepository.findForMember(member.id)).filter((r) => toDateOnly(r.session_date) <= today);
    const items = rows.map((r) => trainingAttendanceService._attendanceToDto(r));
    const byTraining = new Map();
    const total = { attended: 0, marked: 0 };
    for (const i of items) {
      const t = byTraining.get(i.trainingId) || { trainingId: i.trainingId, name: i.trainingName, color: i.trainingColor, attended: 0, marked: 0 };
      if (i.status === 'attended' || i.status === 'absent') {
        t.marked += 1;
        total.marked += 1;
        if (i.status === 'attended') {
          t.attended += 1;
          total.attended += 1;
        }
      }
      byTraining.set(i.trainingId, t);
    }
    const pct = (x) => (x.marked ? Math.round((x.attended / x.marked) * 100) : null);
    return {
      summary: { ...total, pct: pct(total) },
      trainings: [...byTraining.values()].map((t) => ({ ...t, pct: pct(t) })),
      items: items.map(({ uuid, ...rest }) => rest),
    };
  }

  // ------------------------------------------------------------------ inicio

  async summary(clubId, userId, memberId) {
    const { member, settings } = await this._own(clubId, userId, memberId);
    const out = { member: this._memberDto(member, await membersRepository.getGroupsForMember(member.id)), debt: null, nextDue: [], attendance: null, upcoming: [] };

    if (settings.payments) {
      const { instances } = await this._ledger(clubId, member.id);
      out.debt = this._debt(instances);
      out.nextDue = instances
        .filter((i) => ['pending', 'partial'].includes(i.status) && i.remaining > 0)
        .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
        .slice(0, 4);
    }
    if (settings.attendance) {
      const month = todayLocal().slice(0, 7);
      const { summary, items } = await this.attendance(clubId, userId, member.id);
      const inMonth = items.filter((i) => i.sessionDate.startsWith(month) && ['attended', 'absent'].includes(i.status));
      const attended = inMonth.filter((i) => i.status === 'attended').length;
      out.attendance = { total: summary, month: { attended, marked: inMonth.length, pct: inMonth.length ? Math.round((attended / inMonth.length) * 100) : null } };
    }
    // Próximos entrenamientos (14 días) — independientes del interruptor de asistencia.
    const trainings = (await calendarService.trainingsForMembers(clubId, [member.id])).filter((t) => t.status === 'active');
    if (trainings.length) {
      const from = todayLocal();
      const to = new Date(Date.parse(`${from}T00:00:00Z`) + 14 * 86400000).toISOString().slice(0, 10);
      out.upcoming = (await calendarService.sessionsOf(trainings, from, to)).slice(0, 5);
    }
    return out;
  }

  // ------------------------------------------------------------------ mi ficha

  async _fieldCatalog(clubId) {
    return (await memberFieldsRepository.findByClub(clubId)).filter((f) => f.field_type !== 'file' && !parseSettings(f).sensitive);
  }

  _editable(field, settings) {
    return !!settings.profileEdit && !!parseSettings(field).selfEditable && !LAYOUT_TYPES.includes(field.field_type) && field.role !== 'identifier';
  }

  async profile(clubId, userId, memberId) {
    const { member, settings } = await this._own(clubId, userId, memberId);
    const catalog = await this._fieldCatalog(clubId);
    const dto = await membersService._buildDto(member);
    const visible = new Set(catalog.map((f) => f.code));
    const fields = Object.fromEntries(Object.entries(dto.fields).filter(([code]) => visible.has(code)));
    return {
      member: { ...this._memberDto(member, dto.groups), joinedOn: dto.joinedOn ?? null, fields },
      fields: catalog.map((f) => ({ ...memberFieldsService.toDto(f), editable: this._editable(f, settings) })),
      canEdit: catalog.some((f) => this._editable(f, settings)),
    };
  }

  async updateProfile(clubId, userId, memberId, { fields }) {
    const { member, settings } = await this._own(clubId, userId, memberId, 'profileEdit');
    const editable = new Map((await this._fieldCatalog(clubId)).filter((f) => this._editable(f, settings) && !UPLOAD_TYPES.includes(f.field_type)).map((f) => [f.code, f]));
    // Whitelist en el servidor: lo que no es editable se ignora aunque venga en el body.
    const input = Object.fromEntries(Object.entries(fields && typeof fields === 'object' ? fields : {}).filter(([code]) => editable.has(code)));
    if (!Object.keys(input).length) throw AppError.badRequest('No hay campos editables para guardar.');
    const values = await membersService._prepareFieldValues(clubId, input, { requireAll: false, memberId: member.id, allowSensitive: false });
    await withTransaction(async (conn) => {
      if (Object.keys(values.set).length) await membersRepository.upsertFieldValues(member.id, values.set, conn);
      await membersRepository.deleteFieldValues(member.id, values.clear, conn);
    });
    await auditRepository.logAction({
      userId,
      clubId,
      action: 'MEMBER_SELF_UPDATED',
      entityType: 'member',
      entityId: member.id,
      changes: { fields: [...editable.values()].filter((f) => Object.prototype.hasOwnProperty.call(input, f.code)).map((f) => f.label) },
    });
    return this.profile(clubId, userId, member.id);
  }

  async _editableImageField(clubId, settings, fieldId) {
    const field = (await this._fieldCatalog(clubId)).find((f) => f.id === Number(fieldId) && f.field_type === 'image');
    if (!field || !this._editable(field, settings)) throw AppError.forbidden('Este campo no lo puedes modificar.');
    return field;
  }

  async setImage(clubId, userId, memberId, fieldId, file) {
    try {
      const { member, settings } = await this._own(clubId, userId, memberId, 'profileEdit');
      const field = await this._editableImageField(clubId, settings, fieldId);
      return await membersService.storeImage(clubId, member.id, field, file, userId, 'MEMBER_SELF_UPDATED');
    } catch (error) {
      if (file) deleteUploadedFile(`/uploads/member-photos/${file.filename}`);
      throw error;
    }
  }

  async removeImage(clubId, userId, memberId, fieldId, url) {
    const { member, settings } = await this._own(clubId, userId, memberId, 'profileEdit');
    const field = await this._editableImageField(clubId, settings, fieldId);
    await membersService.dropImage(member.id, field, url || null);
  }

  // ------------------------------------------------------------------ apoderados

  _guardianDto(r) {
    return { userId: r.user_id, username: r.username, email: r.email, avatarUrl: r.avatar_url ? toAbsoluteMediaUrl(r.avatar_url) : null, relation: r.relation ?? null, createdAt: r.created_at };
  }

  async _clubMember(clubId, memberId) {
    const member = await membersRepository.findActiveById(Number(memberId));
    if (!member || member.club_id !== clubId) throw AppError.notFound('Miembro no encontrado.');
    return member;
  }

  /** Directiva: apoderados de una ficha (el acceso a la ficha lo valida el controller). */
  async listGuardians(clubId, memberId) {
    const member = await this._clubMember(clubId, memberId);
    return (await memberGuardiansRepository.findByMember(member.id)).map((r) => this._guardianDto(r));
  }

  async addGuardian(clubId, memberId, { userId, relation }, actorId) {
    const member = await this._clubMember(clubId, memberId);
    const membership = await usersRepository.findMembership(Number(userId), clubId);
    if (!membership || membership.status !== USER_CLUB_STATUS.ACTIVE) throw AppError.badRequest('La cuenta debe pertenecer al club (activa).');
    if (member.user_id === Number(userId)) throw AppError.badRequest('Esa cuenta ya es la titular de esta ficha.');
    await memberGuardiansRepository.add({ memberId: member.id, userId: Number(userId), relation: relation?.trim() || null, createdBy: actorId });
    await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_GUARDIAN_ADDED', entityType: 'member', entityId: member.id, changes: { userId: Number(userId), relation: relation || null } });
    return this.listGuardians(clubId, member.id);
  }

  async removeGuardian(clubId, memberId, guardianUserId, actorId) {
    const member = await this._clubMember(clubId, memberId);
    if (!(await memberGuardiansRepository.remove(member.id, Number(guardianUserId)))) throw AppError.notFound('Apoderado no encontrado.');
    await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_GUARDIAN_REMOVED', entityType: 'member', entityId: member.id, changes: { userId: Number(guardianUserId) } });
    return this.listGuardians(clubId, member.id);
  }

  /** "Mi club": apoderados de una de mis fichas (sin correos: solo nombre y relación). */
  async myGuardians(clubId, userId, memberId) {
    const { member, settings } = await this._own(clubId, userId, memberId);
    const rows = await memberGuardiansRepository.findByMember(member.id);
    return { canInvite: settings.guardiansInvite, guardians: rows.map((r) => ({ ...this._guardianDto(r), email: undefined, isMe: r.user_id === userId })) };
  }

  /**
   * El titular o un apoderado suma a otro apoderado por correo (si el club lo permite): si la
   * cuenta ya es del club queda vinculada al tiro; si no, le llega una invitación al club (sin
   * roles) que al aceptar la deja como apoderado (ver clubEntry.service.js#enter).
   */
  async inviteGuardian(clubId, userId, memberId, { email, relation }) {
    const { member } = await this._own(clubId, userId, memberId, 'guardiansInvite');
    const target = await usersRepository.findByEmail(String(email || '').trim().toLowerCase());
    if (!target) throw AppError.notFound('No hay una cuenta con ese correo. Pídele que se registre primero.');
    if (target.id === userId || target.id === member.user_id) throw AppError.badRequest('Esa cuenta ya tiene acceso a esta ficha.');
    const cleanRelation = relation ? String(relation).trim().slice(0, 40) : null;
    const membership = await usersRepository.findMembership(target.id, clubId);
    if (membership?.status === USER_CLUB_STATUS.ACTIVE) {
      await memberGuardiansRepository.add({ memberId: member.id, userId: target.id, relation: cleanRelation, createdBy: userId });
      await auditRepository.logAction({ userId, clubId, action: 'MEMBER_GUARDIAN_ADDED', entityType: 'member', entityId: member.id, changes: { userId: target.id, relation: cleanRelation } });
      return { added: true, invited: false };
    }
    if (membership && membership.status !== USER_CLUB_STATUS.WITHDRAWN) throw AppError.conflict('Esa cuenta no puede recibir invitaciones de este club ahora.');
    await clubUserInvitationsService.invite(clubId, { userId: target.id, message: `Te invitaron como apoderado de ${membersService._fullName(member)}.`, roleIds: [], guardianOf: [member.id], guardianRelation: cleanRelation }, userId);
    return { added: false, invited: true };
  }
}

module.exports = new SelfServiceService();
