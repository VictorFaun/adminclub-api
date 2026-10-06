const paymentProofsRepository = require('../repositories/paymentProofs.repository');
const { showLogoOnBanner } = require('../helpers/clubBranding');
const chargeInstancesRepository = require('../repositories/chargeInstances.repository');
const clubsRepository = require('../repositories/clubs.repository');
const settingsRepository = require('../repositories/settings.repository');
const auditRepository = require('../repositories/audit.repository');
const paymentsService = require('./payments.service');
const receiptsService = require('./receipts.service');
const treasuryAccountsService = require('./treasuryAccounts.service');
const chargesRepository = require('../repositories/charges.repository');
const treasuryAccountsRepository = require('../repositories/treasuryAccounts.repository');
const AppError = require('../helpers/AppError');
const { toAbsoluteMediaUrl } = require('../helpers/mediaUrl');
const { deletePrivateFile, resolvePrivatePath } = require('../middlewares/privateUpload.middleware');
const { CLUB_STATUS } = require('../config/constants');
const memberFieldsRepository = require('../repositories/memberFields.repository');
const { normalizeIdentifier } = require('../helpers/memberFieldTypes');
const { parseAccount, treasuryAccountToDto } = require('../helpers/paymentAccount');
const { withTransaction } = require('../config/database');
const { randomUUID } = require('crypto');

const MAX_PENDING_PER_INSTANCE = 3;
/** Tope de períodos en un mismo comprobante (pago múltiple). */
const MAX_INSTANCES_PER_PROOF = 24;
const PUBLIC_PAYMENTS_KEY = 'public_payments_enabled';
/** Un período pendiente que vence en más de estos días (y no está atrasado) todavía no se ofrece
 * como "por pagar" en la lista principal. */
const DUE_SOON_DAYS = 45;

const toDateOnly = (value) => new Date(value).toISOString().slice(0, 10);

/** `chargeInstanceIds` llega del multipart como "12,13,14" (o un solo `chargeInstanceId`). */
const parseInstanceIds = (raw) => {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
  return [...new Set(list.map((v) => Number(String(v).trim())).filter((n) => Number.isInteger(n) && n > 0))];
};

/**
 * Página pública de pagos (una por club, `/pay/<código-del-club>`): la persona se identifica con su
 * RUT, ve lo que debe y reporta un pago subiendo el comprobante; alguien con permiso lo aprueba (se
 * registra el pago real, con las mismas validaciones de siempre) o lo rechaza.
 *
 * Privacidad: solo responde si el club activó la página (Tesorería → Configuración); un RUT que no
 * existe, no es miembro activo del club o está mal escrito responde EXACTAMENTE igual (`found:false`,
 * sin error), y solo se devuelve el primer nombre + los cobros de esa persona.
 */
class PaymentProofsService {
  // ------------------------------------------------------------------ público (sin sesión)

  async isPublicPaymentsEnabled(clubId) {
    const settings = await settingsRepository.findAllByClub(clubId);
    return settings[PUBLIC_PAYMENTS_KEY] === '1';
  }

  async _publicClub(code) {
    const club = await clubsRepository.findByPublicCode(String(code || '').slice(0, 40));
    if (!club || club.status !== CLUB_STATUS.ACTIVE || !(await this.isPublicPaymentsEnabled(club.id))) {
      throw AppError.notFound('Esta página de pagos no está disponible.');
    }
    return club;
  }

  async getPublicClub(code) {
    const club = await this._publicClub(code);
    return {
      name: club.name,
      description: club.description,
      logoUrl: toAbsoluteMediaUrl(club.logo_url),
      bannerUrl: toAbsoluteMediaUrl(club.banner_url),
      showLogoOnBanner: await showLogoOnBanner(club.id),
      primaryColor: club.primary_color,
      secondaryColor: club.secondary_color,
      // Con qué se identifica la persona (el campo con uso "identificador" de la ficha: RUT, DNI…).
      // `null` = el club no tiene identificador → la página no puede buscar a nadie.
      identifier: await this._identifierInfo(club.id),
    };
  }

  async _identifierInfo(clubId) {
    const field = await memberFieldsRepository.findByRole(clubId, 'identifier');
    return field ? { label: field.label, type: field.field_type } : null;
  }

  /** Miembro activo por el identificador escrito en la página pública (`null` si no hay). */
  async _findByIdentifier(clubId, raw) {
    const field = await memberFieldsRepository.findByRole(clubId, 'identifier');
    if (!field) return null;
    const normalized = normalizeIdentifier(field, raw);
    return normalized ? paymentProofsRepository.findActiveMemberByIdentifier(clubId, String(normalized).toUpperCase()) : null;
  }

  /**
   * A quién se le puede pagar un cobro, para UN miembro: su responsable (el resuelto por grupo, ver
   * charges.repository.js#resolveResponsibles) y/o Tesorería (la cuenta del cobro; nunca en un cobro
   * externo). `key` identifica el destino (`member:<id>` / `treasury:<cuentaId|0>`): un pago
   * múltiple solo puede juntar períodos con el MISMO destino (un comprobante = una transferencia).
   * `ctx` cachea cobros y cuentas del club entre períodos.
   */
  async _destinationsFor(chargeId, memberId, ctx) {
    if (ctx.byCharge.has(chargeId)) return ctx.byCharge.get(chargeId);
    const charge = await chargesRepository.findActiveById(chargeId);
    const list = [];
    if (charge) {
      const resolved = (await chargesRepository.resolveResponsibles(chargeId, [memberId])).get(memberId);
      if (resolved) {
        list.push({ key: `member:${resolved.memberId}`, type: 'responsible', memberId: resolved.memberId, name: resolved.memberName, account: resolved.account ?? null });
      }
      if (charge.purpose !== 'external') {
        ctx.accounts ??= await treasuryAccountsRepository.findByClub(charge.club_id);
        const account = await treasuryAccountsService.resolveForCharge(charge, ctx.accounts);
        list.push({ key: `treasury:${account?.id ?? 0}`, type: 'treasury', memberId: null, name: account?.name ?? 'Tesorería', account });
      }
    }
    ctx.byCharge.set(chargeId, list);
    return list;
  }

  _newDestinationContext() {
    return { byCharge: new Map(), accounts: null };
  }

  _toItem(r, kind) {
    const amount = Number(r.amount);
    const paid = Number(r.paid_amount);
    return {
      chargeInstanceId: r.id,
      chargeId: r.charge_id,
      chargeName: r.charge_name,
      chargeColor: r.charge_color,
      recurrence: r.charge_recurrence,
      periodLabel: r.period_label,
      dueDate: r.due_date,
      amount,
      paidAmount: paid,
      remaining: Math.max(amount - paid, 0),
      pendingProofs: Number(r.pending_proofs),
      kind, // 'overdue' | 'pending' | 'advance'
      destinations: [],
    };
  }

  /**
   * Cobros de la persona con ese RUT: atrasados y pendientes próximos, más los cobros recurrentes
   * activos (siempre visibles; si está al día se ofrece adelantar el próximo período).
   * `found:false` (200, sin error) si el RUT no corresponde a un miembro activo del club.
   */
  async lookup(code, rut) {
    const club = await this._publicClub(code);
    const member = await this._findByIdentifier(club.id, rut);
    if (!member) return { found: false };

    const today = toDateOnly(new Date());
    const limit = toDateOnly(new Date(Date.now() + DUE_SOON_DAYS * 86400000));
    // Períodos atrasados que nunca se generaron (cobro con inicio en el pasado): se crean para
    // que la persona los vea y pueda pagarlos, igual que ya los muestra la matriz.
    await paymentsService.materializeMissingForMember(member.id, new Date(Date.now() + DUE_SOON_DAYS * 86400000));
    const rows = (await paymentProofsRepository.findPayableInstances(member.id)).filter((r) => Number(r.amount) - Number(r.paid_amount) > 0);

    const items = [];
    const advanceByCharge = new Map();
    for (const r of rows) {
      const due = toDateOnly(r.due_date);
      if (due < today) items.push(this._toItem(r, 'overdue'));
      else if (due <= limit) items.push(this._toItem(r, 'pending'));
      else if (!advanceByCharge.has(r.charge_id)) advanceByCharge.set(r.charge_id, this._toItem(r, 'advance'));
    }

    const chargesWithDebt = new Set(items.map((i) => i.chargeId));
    const recurring = (await paymentProofsRepository.findActiveRecurringCharges(member.id))
      .filter((c) => !chargesWithDebt.has(c.id))
      .map((c) => ({
        chargeId: c.id,
        name: c.name,
        color: c.color,
        recurrence: c.recurrence,
        amount: Number(c.amount),
        next: advanceByCharge.get(c.id) ?? null,
      }));

    const ctx = this._newDestinationContext();
    for (const item of [...items, ...advanceByCharge.values()]) {
      item.destinations = await this._destinationsFor(item.chargeId, member.id, ctx);
    }

    return { found: true, memberFirstName: member.first_name || '', items, recurring };
  }

  /**
   * Un comprobante cubre UNO o VARIOS períodos (`chargeInstanceIds`). Con uno solo se puede abonar
   * (`amount` ≤ saldo); con varios NO: cada período se reporta por su saldo completo y `amount` se
   * ignora. Se crea una fila por período, todas con el mismo `batch_uuid` y el mismo archivo.
   */
  async submitPublicProof(code, { rut, chargeInstanceId, chargeInstanceIds, amount, paidAt, note, destination }, file) {
    const discard = () => file && deletePrivateFile(`payment-proofs/${file.filename}`);
    try {
      const club = await this._publicClub(code);
      const member = await this._findByIdentifier(club.id, rut);
      if (!member) throw AppError.notFound('No encontramos información para ese RUT.');
      if (!file) throw AppError.badRequest('Adjunta el comprobante de pago (imagen o PDF).');

      const ids = parseInstanceIds(chargeInstanceIds ?? chargeInstanceId);
      if (!ids.length) throw AppError.badRequest('Elige al menos un período a pagar.');
      if (ids.length > MAX_INSTANCES_PER_PROOF) throw AppError.badRequest(`Puedes pagar hasta ${MAX_INSTANCES_PER_PROOF} períodos en un mismo comprobante.`);
      const multiple = ids.length > 1;

      const date = paidAt ? new Date(paidAt) : new Date();
      if (Number.isNaN(date.getTime())) throw AppError.badRequest('Fecha de pago inválida.');
      if (date.getTime() > Date.now() + 24 * 3600 * 1000) throw AppError.badRequest('La fecha de pago no puede ser futura.');

      // Destino del pago: el mismo para todos los períodos. Sin `destination` (clientes viejos) se
      // usa el primero sugerido del primer período, y se exige que calce con el resto igual.
      const ctx = this._newDestinationContext();
      let destinationKey = destination ? String(destination).slice(0, 40) : null;
      let chosen = null;
      const entries = [];
      for (const id of ids) {
        const instance = await chargeInstancesRepository.findActiveById(id);
        if (!instance || instance.member_id !== member.id || !['pending', 'partial'].includes(instance.status)) {
          throw AppError.badRequest('Uno de los períodos indicados no está disponible para reportar un pago.');
        }
        const remaining = Number(instance.amount) - (await chargeInstancesRepository.sumAllocations(instance.id));
        if (remaining <= 0.005) throw AppError.badRequest(`El período ${instance.period_label} ya no tiene saldo pendiente.`);
        let value = remaining;
        if (!multiple) {
          value = Number(amount);
          if (!Number.isFinite(value) || value <= 0) throw AppError.badRequest('Ingresa un monto válido.');
          if (value > remaining + 0.005) throw AppError.badRequest(`El monto excede el saldo pendiente de este período ($${remaining.toFixed(0)}).`);
        }
        if ((await paymentProofsRepository.countPendingForInstance(instance.id)) >= MAX_PENDING_PER_INSTANCE) {
          throw AppError.conflict(`Ya hay comprobantes pendientes de revisión para el período ${instance.period_label}. Espera a que se revisen.`);
        }
        const options = await this._destinationsFor(instance.charge_id, member.id, ctx);
        destinationKey ??= options[0]?.key ?? null;
        const match = options.find((o) => o.key === destinationKey);
        if (!match) {
          throw AppError.badRequest(
            multiple
              ? `El período ${instance.period_label} se paga a otro destino. Un mismo comprobante solo puede incluir cobros que se pagan a la misma cuenta.`
              : 'El destino elegido no corresponde a este cobro.'
          );
        }
        chosen = match;
        entries.push({ instance, value });
      }

      const batchUuid = randomUUID();
      const proofIds = await withTransaction(async (conn) => {
        const created = [];
        for (const { instance, value } of entries) {
          created.push(
            await paymentProofsRepository.createProof(
              {
                batchUuid,
                clubId: member.club_id,
                memberId: member.id,
                paidToMemberId: chosen?.memberId ?? null,
                chargeInstanceId: instance.id,
                amount: value,
                paidAt: toDateOnly(date),
                note: note ? String(note).slice(0, 255) : null,
                filePath: `payment-proofs/${file.filename}`,
                mimeType: file.mimetype,
              },
              conn
            )
          );
        }
        return created;
      });
      await auditRepository.logAction({
        userId: null,
        clubId: member.club_id,
        action: 'PAYMENT_PROOF_SUBMITTED',
        entityType: 'payment_proof',
        entityId: proofIds[0],
        changes: {
          memberId: member.id,
          batchUuid,
          destination: chosen?.name ?? null,
          amount: entries.reduce((sum, e) => sum + e.value, 0),
          periods: entries.map((e) => e.instance.period_label),
        },
      });
      return { id: proofIds[0], batchUuid, count: proofIds.length };
    } catch (error) {
      discard();
      throw error;
    }
  }

  // ------------------------------------------------------------------ administración

  /** `accounts`: cuentas de Tesorería del club (para resolver la del cobro sin consultar por fila). */
  _toDto(row, accounts = []) {
    const treasuryRow = accounts.find((a) => a.id === row.charge_treasury_account_id) || (accounts.length === 1 ? accounts[0] : null);
    const destination = row.paid_to_member_id
      ? { type: 'responsible', memberId: row.paid_to_member_id, name: row.paid_to_member_name ?? 'Responsable', account: parseAccount(row.paid_to_account) }
      : { type: 'treasury', memberId: null, name: treasuryRow?.name ?? 'Tesorería', account: treasuryAccountToDto(treasuryRow) };
    return {
      id: row.id,
      uuid: row.uuid,
      batchUuid: row.batch_uuid,
      memberId: row.member_id,
      memberName: row.member_name ?? null,
      memberRut: row.member_rut ?? null,
      memberGroups: row.member_groups ? String(row.member_groups).split('||') : [],
      chargeInstanceId: row.charge_instance_id,
      chargeId: row.charge_id,
      chargeName: row.charge_name,
      chargeColor: row.charge_color,
      chargeRecurrence: row.charge_recurrence,
      periodLabel: row.period_label,
      amount: Number(row.amount),
      paidAt: row.paid_at,
      note: row.note,
      mimeType: row.mime_type,
      status: row.status,
      reviewedByUsername: row.reviewed_by_username ?? null,
      reviewedAt: row.reviewed_at,
      reviewNote: row.review_note,
      createdAt: row.created_at,
      // A quién dice haber pagado la persona (y los datos de esa cuenta).
      destination,
    };
  }

  async list(clubId, { status, groupId, chargeId, search, from, to }, actorId, authContext) {
    const memberIds = await paymentsService.getVisibleMemberIds(authContext, actorId, clubId);
    const rows = await paymentProofsRepository.listByClub(clubId, {
      status,
      memberIds,
      groupId: groupId ? Number(groupId) : null,
      chargeId: chargeId ? Number(chargeId) : null,
      search: search ? String(search).trim().slice(0, 100) : null,
      from: from || null,
      to: to || null,
    });
    const accounts = rows.length ? await treasuryAccountsRepository.findByClub(clubId) : [];
    return rows.map((r) => this._toDto(r, accounts));
  }

  async filterOptions(clubId, actorId, authContext) {
    const memberIds = await paymentsService.getVisibleMemberIds(authContext, actorId, clubId);
    return paymentProofsRepository.filterOptions(clubId, memberIds);
  }

  async countPending(clubId, actorId, authContext) {
    const memberIds = await paymentsService.getVisibleMemberIds(authContext, actorId, clubId);
    return { pending: await paymentProofsRepository.countPending(clubId, memberIds) };
  }

  async _getReviewable(clubId, proofId, actorId, authContext) {
    const proof = await paymentProofsRepository.findById(proofId);
    if (!proof || proof.club_id !== clubId) throw AppError.notFound('Comprobante no encontrado.');
    await paymentsService.assertMemberPaymentsAccessible(clubId, proof.member_id, actorId, authContext);
    return proof;
  }

  /** Filas pendientes del lote al que pertenece el comprobante (un pago múltiple se revisa entero). */
  async _pendingBatch(proof) {
    const rows = await paymentProofsRepository.findByBatch(proof.batch_uuid);
    const pending = rows.filter((r) => r.status === 'pending');
    if (!pending.length) throw AppError.conflict('Este comprobante ya fue revisado.');
    return pending;
  }

  /**
   * Aprueba el lote completo: registra UN pago por período (un pago siempre corresponde a un solo
   * período, ver payments.service.js#create). `amount` solo se puede ajustar si el lote es de un
   * período; en un pago múltiple cada período va por el monto reportado.
   */
  async approve(clubId, proofId, { amount }, actorId, authContext) {
    const proof = await this._getReviewable(clubId, proofId, actorId, authContext);
    const batch = await this._pendingBatch(proof);
    const override = amount !== undefined && amount !== null ? Number(amount) : null;
    if (batch.length > 1 && override !== null) throw AppError.badRequest('En un pago múltiple no se puede modificar el monto.');

    // Se revisa todo el lote ANTES de registrar nada, para no dejarlo aprobado a medias. De paso se
    // resuelve a quién queda el pago: el destino que eligió la persona (`paid_to_member_id`, `null` =
    // Tesorería). Comprobantes viejos de un cobro externo (sin destino guardado) van a su responsable.
    const paidToById = new Map();
    for (const p of batch) {
      const instance = await chargeInstancesRepository.findActiveById(p.charge_instance_id);
      const remaining = instance ? Number(instance.amount) - (await chargeInstancesRepository.sumAllocations(instance.id)) : 0;
      const value = override ?? Number(p.amount);
      if (!instance || instance.status === 'exempt' || value > remaining + 0.005) {
        throw AppError.conflict(`El período ${p.period_label} ya no tiene ese saldo pendiente. Rechaza el comprobante y registra el pago manualmente.`);
      }
      const charge = await chargesRepository.findActiveById(instance.charge_id);
      let paidTo = p.paid_to_member_id ?? null;
      if (paidTo === null && charge?.purpose === 'external') {
        paidTo = (await chargesRepository.resolveResponsibles(charge.id, [p.member_id])).get(p.member_id)?.memberId ?? null;
      }
      if (paidTo !== null) {
        const responsibleIds = (await chargesRepository.getResponsibleMembers(instance.charge_id)).map((r) => r.memberId);
        if (!responsibleIds.includes(paidTo)) {
          throw AppError.conflict(`El destino del pago del período ${p.period_label} ya no es responsable de ese cobro. Rechaza el comprobante y registra el pago manualmente.`);
        }
      }
      paidToById.set(p.id, paidTo);
    }

    const multipleNote = batch.length > 1 ? ` (pago múltiple, ${batch.length} períodos)` : '';
    const paymentIds = [];
    for (const p of batch) {
      // Registra el pago con las MISMAS validaciones del alta manual (saldo, período exento, alcance).
      const payment = await paymentsService.create(
        clubId,
        {
          memberId: p.member_id,
          chargeInstanceId: p.charge_instance_id,
          amount: override ?? Number(p.amount),
          paidAt: p.paid_at,
          paidToMemberId: paidToById.get(p.id),
          note: `Comprobante enviado por el miembro${multipleNote}${p.note ? ` — ${p.note}` : ''}`,
        },
        actorId,
        authContext
      );
      await paymentProofsRepository.markReviewed(p.id, { status: 'approved', reviewedBy: actorId, paymentId: payment.id });
      await auditRepository.logAction({ userId: actorId, clubId, action: 'PAYMENT_PROOF_APPROVED', entityType: 'payment_proof', entityId: p.id, changes: { paymentId: payment.id, batchUuid: p.batch_uuid } });
      paymentIds.push(payment.id);
    }
    // El recibo le llega al miembro por correo (si tiene uno en su ficha).
    if (paymentIds.length) receiptsService.emailToMember(clubId, paymentIds);
    return { paymentId: paymentIds[0], paymentIds };
  }

  async reject(clubId, proofId, { reason }, actorId, authContext) {
    const proof = await this._getReviewable(clubId, proofId, actorId, authContext);
    const batch = await this._pendingBatch(proof);
    const reviewNote = reason ? String(reason).slice(0, 255) : null;
    for (const p of batch) {
      await paymentProofsRepository.markReviewed(p.id, { status: 'rejected', reviewedBy: actorId, reviewNote });
      await auditRepository.logAction({ userId: actorId, clubId, action: 'PAYMENT_PROOF_REJECTED', entityType: 'payment_proof', entityId: p.id, changes: { batchUuid: p.batch_uuid, ...(reason ? { reason } : {}) } });
    }
  }

  async getFile(clubId, proofId, actorId, authContext) {
    const proof = await this._getReviewable(clubId, proofId, actorId, authContext);
    const absolutePath = resolvePrivatePath(proof.file_path);
    if (!absolutePath) throw AppError.notFound('Archivo no encontrado.');
    const ext = proof.file_path.slice(proof.file_path.lastIndexOf('.'));
    return { absolutePath, name: `comprobante-${proof.id}${ext}`, mimeType: proof.mime_type };
  }

  // ------------------------------------------------------------------ configuración

  async getPublicPaymentsSetting(clubId) {
    return { enabled: await this.isPublicPaymentsEnabled(clubId) };
  }

  async setPublicPaymentsSetting(clubId, enabled, actorId) {
    await settingsRepository.upsertMany(clubId, { [PUBLIC_PAYMENTS_KEY]: enabled ? '1' : '0' });
    await auditRepository.logAction({ userId: actorId, clubId, action: 'TREASURY_PUBLIC_PAYMENTS_UPDATED', entityType: 'club_settings', entityId: clubId, changes: { enabled: !!enabled } });
    return { enabled: !!enabled };
  }
}

module.exports = new PaymentProofsService();
