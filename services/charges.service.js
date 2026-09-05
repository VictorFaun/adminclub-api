const chargesRepository = require('../repositories/charges.repository');
const membersRepository = require('../repositories/members.repository');
const memberGroupsRepository = require('../repositories/memberGroups.repository');
const memberTagsRepository = require('../repositories/memberTags.repository');
const auditRepository = require('../repositories/audit.repository');
const chargeInstancesService = require('./chargeInstances.service');
const permissionService = require('./permission.service');
const AppError = require('../helpers/AppError');
const { withTransaction } = require('../config/database');
const { diffValue, buildDiff } = require('../helpers/auditDiff');
const { CHARGE_RECURRENCE, FUNCTIONS } = require('../config/constants');

class ChargesService {
  toDto(charge, { targetGroups = [], targetTags = [], targetMembers = [], exclusionMemberIds = [] } = {}) {
    return {
      id: charge.id,
      uuid: charge.uuid,
      clubId: charge.club_id,
      name: charge.name,
      description: charge.description,
      color: charge.color,
      amount: Number(charge.amount),
      recurrence: charge.recurrence,
      startDate: charge.start_date,
      dueDay: charge.due_day,
      dueMonth: charge.due_month,
      endDate: charge.end_date,
      status: charge.status,
      // `null` = no archivado. Archivado ≠ eliminado: su dinero sigue contando en Tesorería, solo
      // se oculta de "Cobros" y "Pagos" — ver charges.repository.js#findByClub/findArchivedByClub.
      archivedAt: charge.archived_at,
      // 'treasury' (default) = el dinero es del club, como siempre. 'external' = el responsable
      // junta la plata y la entrega AFUERA del club (ej. inscripción de un campeonato) — nunca
      // pasa por Tesorería, y por eso exige responsable (ver _assertPurposeValid). Solo tiene
      // sentido para cobros únicos.
      purpose: charge.purpose,
      // Responsable del cobro — opcional si `purpose` es 'treasury' (ej. el entrenador que junta
      // la plata antes de entregarla a tesorería, alternativa a pagarle directo a Tesorería);
      // OBLIGATORIO si `purpose` es 'external' (ver payments.service.js#_validatePaidToMemberId).
      responsibleMemberId: charge.responsible_member_id,
      responsibleMemberName: charge.responsible_member_name ?? null,
      // `{id, amount}` — el nombre del target (grupo/etiqueta/miembro) es `id` en los 3 para que
      // el frontend pueda pasarlos tal cual a <app-priced-target-picker>, sin remapear.
      targetGroups: targetGroups.map((g) => ({ id: g.groupId, amount: g.amount })),
      targetTags: targetTags.map((t) => ({ id: t.tagId, amount: t.amount })),
      targetMembers: targetMembers.map((m) => ({ id: m.memberId, amount: m.amount })),
      exclusionMemberIds,
      createdAt: charge.created_at,
    };
  }

  /** `dueDay`/`dueMonth` solo tienen sentido según el tipo de recurrencia — se limpian/validan
   * acá para que nunca quede un cobro "once" con un día de vencimiento mensual colgado, ni uno
   * "monthly" sin `dueDay`. */
  _resolveSchedule({ recurrence, dueDay, dueMonth }) {
    if (recurrence === CHARGE_RECURRENCE.ONCE) return { dueDay: null, dueMonth: null };
    if (recurrence === CHARGE_RECURRENCE.MONTHLY) {
      if (!dueDay || dueDay < 1 || dueDay > 31) throw AppError.badRequest('Debes indicar un día de vencimiento (1-31) para un cobro mensual.');
      return { dueDay, dueMonth: null };
    }
    // yearly
    if (!dueDay || dueDay < 1 || dueDay > 31) throw AppError.badRequest('Debes indicar un día de vencimiento (1-31) para un cobro anual.');
    if (!dueMonth || dueMonth < 1 || dueMonth > 12) throw AppError.badRequest('Debes indicar un mes de vencimiento (1-12) para un cobro anual.');
    return { dueDay, dueMonth };
  }

  /** Valida que cada grupo/etiqueta/miembro apuntado exista en el club y que cada monto sea
   * válido (defensa en profundidad — `charges.validation.js` ya lo exige, pero el service es la
   * fuente de verdad) — `targetGroups`/`targetTags`/`targetMembers` vienen en la forma cruda del
   * payload (`{groupId,amount}`/`{tagId,amount}`/`{memberId,amount}`). */
  async _resolveTargets(clubId, { targetMembers = [], targetGroups = [], targetTags = [], exclusionMemberIds = [] }) {
    for (const t of [...targetGroups, ...targetTags, ...targetMembers]) {
      if (!(Number(t.amount) > 0)) throw AppError.badRequest('Cada grupo, etiqueta o miembro apuntado necesita un monto mayor a $0.');
    }

    const memberIds = targetMembers.map((t) => t.memberId);
    const allMemberIds = [...new Set([...memberIds, ...exclusionMemberIds])];
    if (allMemberIds.length) {
      const found = await membersRepository.findByIds(allMemberIds, clubId);
      if (found.length !== allMemberIds.length) throw AppError.badRequest('Uno o más miembros no pertenecen a este club.');
    }
    const groupIds = targetGroups.map((t) => t.groupId);
    if (groupIds.length) {
      const found = await memberGroupsRepository.findByIds(groupIds, clubId);
      if (found.length !== groupIds.length) throw AppError.badRequest('Uno o más grupos no pertenecen a este club.');
    }
    const tagIds = targetTags.map((t) => t.tagId);
    if (tagIds.length) {
      const found = await memberTagsRepository.findByIds(tagIds, clubId);
      if (found.length !== tagIds.length) throw AppError.badRequest('Una o más etiquetas no pertenecen a este club.');
    }
    return { targetMembers, targetGroups, targetTags, exclusionMemberIds };
  }

  /** `responsibleMemberId` es opcional y, a diferencia de los targets, no necesita pertenecer a
   * los grupos/miembros apuntados por el cobro — puede ser cualquier miembro del club (ej. el
   * entrenador de una categoría, aunque él mismo no pague este cobro). */
  async _assertResponsibleMemberValid(clubId, responsibleMemberId) {
    if (!responsibleMemberId) return;
    const found = await membersRepository.findByIds([responsibleMemberId], clubId);
    if (!found.length) throw AppError.badRequest('El responsable indicado no pertenece a este club.');
  }

  /** `purpose: 'external'` solo tiene sentido para un cobro único (ej. la inscripción puntual de
   * un campeonato) — uno recurrente ya es plata del club período tras período, no una recolección
   * puntual para un fin externo. Además EXIGE responsable: sin él no habría a quién pagarle (un
   * cobro externo nunca admite Tesorería como destino, ver
   * payments.service.js#_validatePaidToMemberId). `recurrence`/`responsibleMemberId` ya vienen
   * resueltos (con lo existente si no cambiaron en un update). */
  _assertPurposeValid(purpose, recurrence, responsibleMemberId) {
    if (purpose !== 'external') return;
    if (recurrence !== CHARGE_RECURRENCE.ONCE) throw AppError.badRequest('El destino "Externo" solo está disponible para cobros únicos.');
    if (!responsibleMemberId) throw AppError.badRequest('Un cobro externo necesita un responsable — es a quien se le pagará.');
  }

  async _buildDto(charge) {
    const [targetGroups, targetTags, targetMembers, exclusionMemberIds] = await Promise.all([
      chargesRepository.getTargetGroups(charge.id),
      chargesRepository.getTargetTags(charge.id),
      chargesRepository.getTargetMembers(charge.id),
      chargesRepository.getExclusionMemberIds(charge.id),
    ]);
    return this.toDto(charge, { targetGroups, targetTags, targetMembers, exclusionMemberIds });
  }

  /** Con VIEW_CHARGES, la lista completa de siempre. Sin ella, el único motivo por el que la ruta
   * (ver permission.middleware.js#requireFunctionOrResponsibleCharge) dejó pasar al actor es que
   * su ficha vinculada (`members.user_id`) sea responsable de algún cobro — ahí se le devuelven
   * SOLO esos, nunca la lista completa (es lo que arma los tabs de "Pagos" para él). */
  async listForClub(clubId, actorId, authContext) {
    if (permissionService.hasFunction(authContext, FUNCTIONS.VIEW_CHARGES)) {
      const rows = await chargesRepository.findByClub(clubId);
      return Promise.all(rows.map((r) => this._buildDto(r)));
    }
    const member = await membersRepository.findByUserId(actorId, clubId);
    if (!member) return [];
    const rows = await chargesRepository.findByClubResponsibleMember(clubId, member.id);
    return Promise.all(rows.map((r) => this._buildDto(r)));
  }

  /** ¿Hay al menos un cobro (no archivado/eliminado) del que el actor sea responsable en este
   * club? Chequeo liviano (sin armar DTOs) usado por el guard de rutas para decidir si dejar
   * pasar a alguien sin VIEW_CHARGES/VIEW_PAYMENTS(_SCOPED) — ver permission.middleware.js. */
  async actorHasAnyResponsibleCharge(clubId, actorId) {
    const member = await membersRepository.findByUserId(actorId, clubId);
    if (!member) return false;
    return chargesRepository.existsResponsibleMember(clubId, member.id);
  }

  async listArchivedForClub(clubId) {
    const rows = await chargesRepository.findArchivedByClub(clubId);
    return Promise.all(rows.map((r) => this._buildDto(r)));
  }

  async getById(clubId, chargeId) {
    const charge = await chargesRepository.findActiveById(chargeId);
    if (!charge || charge.club_id !== clubId) throw AppError.notFound('Cobro no encontrado.');
    return this._buildDto(charge);
  }

  async create(clubId, data, actorId) {
    const schedule = this._resolveSchedule(data);
    const targets = await this._resolveTargets(clubId, data);
    await this._assertResponsibleMemberValid(clubId, data.responsibleMemberId);
    const purpose = data.purpose || 'treasury';
    this._assertPurposeValid(purpose, data.recurrence, data.responsibleMemberId);

    const chargeId = await withTransaction(async (conn) => {
      const id = await chargesRepository.createCharge(
        {
          clubId,
          name: data.name,
          description: data.description || null,
          color: data.color || '#6366F1',
          amount: data.amount,
          recurrence: data.recurrence,
          startDate: data.startDate,
          dueDay: schedule.dueDay,
          dueMonth: schedule.dueMonth,
          endDate: data.endDate || null,
          status: data.status || 'active',
          purpose,
          responsibleMemberId: data.responsibleMemberId || null,
          createdBy: actorId,
        },
        conn
      );
      await chargesRepository.setTargetMembers(id, targets.targetMembers, conn);
      await chargesRepository.setTargetGroups(id, targets.targetGroups, conn);
      await chargesRepository.setTargetTags(id, targets.targetTags, conn);
      await chargesRepository.setExclusions(id, targets.exclusionMemberIds, conn);
      return id;
    });

    await auditRepository.logAction({ userId: actorId, clubId, action: 'CHARGE_CREATED', entityType: 'charge', entityId: chargeId, changes: { name: data.name, amount: data.amount } });

    // Genera de inmediato el/los primeros períodos — no hace falta esperar al cron nocturno
    // para que aparezcan las primeras instancias apenas se crea el cobro.
    await chargeInstancesService.generateForCharge(chargeId);

    return this.getById(clubId, chargeId);
  }

  async update(clubId, chargeId, data, actorId) {
    const charge = await chargesRepository.findActiveById(chargeId);
    if (!charge || charge.club_id !== clubId) throw AppError.notFound('Cobro no encontrado.');
    // Defensa en profundidad: el botón de editar ya no se muestra para un cobro archivado (ver
    // charge-archive-list.page.html), pero el service es la fuente de verdad — se exige
    // restaurarlo primero para evitar reactivar targets/generación de instancias a sus espaldas.
    if (charge.archived_at) throw AppError.conflict('Este cobro está archivado — restáuralo antes de editarlo.');

    const recurrence = data.recurrence !== undefined ? data.recurrence : charge.recurrence;
    const schedule =
      data.recurrence !== undefined || data.dueDay !== undefined || data.dueMonth !== undefined
        ? this._resolveSchedule({ recurrence, dueDay: data.dueDay, dueMonth: data.dueMonth })
        : undefined;

    const updates = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description || null;
    if (data.color !== undefined) updates.color = data.color;
    if (data.amount !== undefined) updates.amount = data.amount;
    if (data.recurrence !== undefined) updates.recurrence = data.recurrence;
    if (data.startDate !== undefined) updates.start_date = data.startDate;
    if (schedule !== undefined) {
      updates.due_day = schedule.dueDay;
      updates.due_month = schedule.dueMonth;
    }
    if (data.endDate !== undefined) updates.end_date = data.endDate || null;
    if (data.status !== undefined) updates.status = data.status;
    if (data.responsibleMemberId !== undefined) {
      await this._assertResponsibleMemberValid(clubId, data.responsibleMemberId);
      updates.responsible_member_id = data.responsibleMemberId || null;
    }
    if (data.purpose !== undefined) updates.purpose = data.purpose;

    const finalPurpose = data.purpose !== undefined ? data.purpose : charge.purpose;
    const finalResponsibleMemberId = data.responsibleMemberId !== undefined ? data.responsibleMemberId : charge.responsible_member_id;
    this._assertPurposeValid(finalPurpose, recurrence, finalResponsibleMemberId);

    const targetsChanged =
      data.targetMembers !== undefined || data.targetGroups !== undefined || data.targetTags !== undefined || data.exclusionMemberIds !== undefined;
    const targets = targetsChanged
      ? await this._resolveTargets(clubId, {
          targetMembers: data.targetMembers ?? (await chargesRepository.getTargetMembers(chargeId)),
          targetGroups: data.targetGroups ?? (await chargesRepository.getTargetGroups(chargeId)),
          targetTags: data.targetTags ?? (await chargesRepository.getTargetTags(chargeId)),
          exclusionMemberIds: data.exclusionMemberIds ?? (await chargesRepository.getExclusionMemberIds(chargeId)),
        })
      : null;

    await withTransaction(async (conn) => {
      if (Object.keys(updates).length) await chargesRepository.updateById(chargeId, updates, conn);
      if (targets) {
        await chargesRepository.setTargetMembers(chargeId, targets.targetMembers, conn);
        await chargesRepository.setTargetGroups(chargeId, targets.targetGroups, conn);
        await chargesRepository.setTargetTags(chargeId, targets.targetTags, conn);
        await chargesRepository.setExclusions(chargeId, targets.exclusionMemberIds, conn);
      }
    });

    const changes = buildDiff({
      name: updates.name !== undefined ? diffValue(charge.name, updates.name) : undefined,
      amount: updates.amount !== undefined ? diffValue(Number(charge.amount), Number(updates.amount)) : undefined,
      status: updates.status !== undefined ? diffValue(charge.status, updates.status) : undefined,
    });
    if (changes) {
      await auditRepository.logAction({ userId: actorId, clubId, action: 'CHARGE_UPDATED', entityType: 'charge', entityId: chargeId, changes });
    }

    // Si cambiaron los objetivos (o se reactivó el cobro), genera instancias para quien
    // corresponda ahora — un miembro recién agregado a un grupo apuntado no debería tener que
    // esperar al cron nocturno para ver su primer período.
    if (targets || (data.status === 'active' && charge.status !== 'active')) {
      await chargeInstancesService.generateForCharge(chargeId);
    }

    return this.getById(clubId, chargeId);
  }

  /** Solo se puede eliminar un cobro YA ARCHIVADO — de paso a "Cobros" (con sus botones ya
   * apretados de acciones) le saca "Eliminar", una acción destructiva que solo tiene sentido
   * tras haberlo archivado primero (ver charge-archive-list.page.html, donde vive el botón). */
  async remove(clubId, chargeId, actorId) {
    const charge = await chargesRepository.findActiveById(chargeId);
    if (!charge || charge.club_id !== clubId) throw AppError.notFound('Cobro no encontrado.');
    if (!charge.archived_at) throw AppError.conflict('Solo se pueden eliminar cobros archivados — archívalo primero.');
    await chargesRepository.softDelete(chargeId);
    await auditRepository.logAction({ userId: actorId, clubId, action: 'CHARGE_DELETED', entityType: 'charge', entityId: chargeId, changes: { name: charge.name } });
  }

  /** A diferencia de `remove` (elimina, deja de contar en cualquier suma de dinero), archivar
   * solo oculta el cobro de "Cobros" y "Pagos" y detiene la generación de nuevas instancias
   * (ver chargeInstances.service.js#generateForCharge) — su dinero histórico sigue contando
   * normalmente en el dashboard de Tesorería. Si estaba activo, de paso queda inactivo — un cobro
   * archivado no debería seguir generando períodos nuevos en silencio mientras nadie lo ve (esto
   * ya lo bloquea `generateForCharge` mirando `archived_at`, pero dejar el status reflejando la
   * realidad evita que se vea "activo" en la ficha mientras está oculto). */
  async archive(clubId, chargeId, actorId) {
    const charge = await chargesRepository.findActiveById(chargeId);
    if (!charge || charge.club_id !== clubId) throw AppError.notFound('Cobro no encontrado.');
    if (charge.archived_at) throw AppError.conflict('Este cobro ya está archivado.');
    await chargesRepository.archive(chargeId);
    if (charge.status === 'active') await chargesRepository.updateById(chargeId, { status: 'inactive' });
    await auditRepository.logAction({ userId: actorId, clubId, action: 'CHARGE_ARCHIVED', entityType: 'charge', entityId: chargeId, changes: { name: charge.name } });
    return this.getById(clubId, chargeId);
  }

  /** Restaurar NUNCA reactiva la generación por sí solo: `archive()` ya deja el cobro en
   * `status='inactive'` si estaba activo, y acá no se toca ese campo — queda inactivo hasta que
   * alguien lo reactive a mano (botón "Activar"), a propósito, para no retomar de golpe la
   * generación de nuevos períodos de un cobro que recién se sacó del cajón. */
  async restore(clubId, chargeId, actorId) {
    const charge = await chargesRepository.findActiveById(chargeId);
    if (!charge || charge.club_id !== clubId) throw AppError.notFound('Cobro no encontrado.');
    if (!charge.archived_at) throw AppError.conflict('Este cobro no está archivado.');
    await chargesRepository.restore(chargeId);
    await auditRepository.logAction({ userId: actorId, clubId, action: 'CHARGE_RESTORED', entityType: 'charge', entityId: chargeId, changes: { name: charge.name } });
    return this.getById(clubId, chargeId);
  }
}

module.exports = new ChargesService();
