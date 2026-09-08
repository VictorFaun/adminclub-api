const trainingsRepository = require('../repositories/trainings.repository');
const membersRepository = require('../repositories/members.repository');
const memberGroupsRepository = require('../repositories/memberGroups.repository');
const auditRepository = require('../repositories/audit.repository');
const trainingAttendanceService = require('./trainingAttendance.service');
const permissionService = require('./permission.service');
const AppError = require('../helpers/AppError');
const { withTransaction } = require('../config/database');
const { parseSort } = require('../helpers/pagination');
const { diffValue, buildDiff } = require('../helpers/auditDiff');
const { FUNCTIONS } = require('../config/constants');

const SORTABLE = ['name', 'start_date', 'status'];
const ARCHIVED_SORTABLE = ['archived_at', 'name'];
const DAYS_OF_WEEK = [1, 2, 3, 4, 5, 6, 7];

/** Mirror de charges.service.js, adaptado a entrenamientos: sin `amount`/`recurrence`/`purpose`
 * (reemplazados por `training_schedules`, el horario semanal — ver _assertSchedulesValid). */
class TrainingsService {
  toDto(training, { targetGroups = [], targetMembers = [], exclusionMemberIds = [], responsibles = [], schedules = [] } = {}) {
    return {
      id: training.id,
      uuid: training.uuid,
      clubId: training.club_id,
      name: training.name,
      description: training.description,
      color: training.color,
      startDate: training.start_date,
      endDate: training.end_date,
      status: training.status,
      // `null` = no archivado — mismo criterio que charges.service.js#toDto.
      archivedAt: training.archived_at,
      schedules: schedules.map((s) => ({ dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime })),
      // Entrenadores — cada uno opcionalmente acotado a un grupo, ver charges.service.js#toDto
      // (mismo concepto, mismo mirror de charges.repository.js#resolveResponsibles).
      responsibles: responsibles.map((r) => ({ memberId: r.memberId, memberName: r.memberName, groupId: r.groupId, groupName: r.groupName })),
      targetGroups,
      targetMembers,
      exclusionMemberIds,
      createdAt: training.created_at,
    };
  }

  /** Al menos un horario es obligatorio ("cuántos entrenamientos a la semana hay y qué días y
   * horarios" — pedido explícito, sin esto un entrenamiento no genera ninguna sesión). */
  _assertSchedulesValid(schedules) {
    if (!schedules || !schedules.length) throw AppError.badRequest('Agrega al menos un día y horario de entrenamiento.');
    for (const s of schedules) {
      if (!DAYS_OF_WEEK.includes(Number(s.dayOfWeek))) throw AppError.badRequest('Día de la semana inválido.');
      if (!/^\d{2}:\d{2}(:\d{2})?$/.test(s.startTime)) throw AppError.badRequest('Hora de inicio inválida.');
      if (s.endTime && !/^\d{2}:\d{2}(:\d{2})?$/.test(s.endTime)) throw AppError.badRequest('Hora de término inválida.');
      if (s.endTime && s.endTime <= s.startTime) throw AppError.badRequest('La hora de término debe ser posterior a la de inicio.');
    }
  }

  /** Mismo criterio que charges.service.js#_resolveTargets, sin validación de monto (acá no hay
   * precio) — `targetMembers`/`targetGroups` son arrays planos de ids. */
  async _resolveTargets(clubId, { targetMembers = [], targetGroups = [], exclusionMemberIds = [] }) {
    const allMemberIds = [...new Set([...targetMembers, ...exclusionMemberIds])];
    if (allMemberIds.length) {
      const found = await membersRepository.findByIds(allMemberIds, clubId);
      if (found.length !== allMemberIds.length) throw AppError.badRequest('Uno o más miembros no pertenecen a este club.');
    }
    if (targetGroups.length) {
      const found = await memberGroupsRepository.findByIds(targetGroups, clubId);
      if (found.length !== targetGroups.length) throw AppError.badRequest('Uno o más grupos no pertenecen a este club.');
    }
    return { targetMembers, targetGroups, exclusionMemberIds };
  }

  /** Mismo criterio que charges.service.js#_assertResponsiblesValid. */
  async _assertResponsiblesValid(clubId, responsibles, targetGroupIds) {
    if (!responsibles.length) return;
    const memberIds = [...new Set(responsibles.map((r) => r.memberId))];
    const found = await membersRepository.findByIds(memberIds, clubId);
    if (found.length !== memberIds.length) throw AppError.badRequest('Uno o más entrenadores no pertenecen a este club.');

    const targetGroupSet = new Set(targetGroupIds);
    for (const r of responsibles) {
      if (r.groupId != null && !targetGroupSet.has(r.groupId)) {
        throw AppError.badRequest('El grupo de un entrenador debe ser uno de los grupos apuntados por el entrenamiento.');
      }
    }
  }

  async _buildDto(training) {
    const [targetGroups, targetMembers, exclusionMemberIds, responsibles, schedules] = await Promise.all([
      trainingsRepository.getTargetGroups(training.id),
      trainingsRepository.getTargetMembers(training.id),
      trainingsRepository.getExclusionMemberIds(training.id),
      trainingsRepository.getResponsibleMembers(training.id),
      trainingsRepository.getSchedules(training.id),
    ]);
    return this.toDto(training, { targetGroups, targetMembers, exclusionMemberIds, responsibles, schedules });
  }

  /** Con VIEW_TRAININGS, la lista completa. Sin ella, solo los entrenamientos de los que el
   * actor es responsable — mismo criterio que charges.service.js#listForClub. */
  async listForClub(clubId, actorId, authContext, query = {}) {
    const sort = parseSort(query, SORTABLE);
    if (permissionService.hasFunction(authContext, FUNCTIONS.VIEW_TRAININGS)) {
      const rows = await trainingsRepository.findByClub(clubId, sort);
      return Promise.all(rows.map((r) => this._buildDto(r)));
    }
    const member = await membersRepository.findByUserId(actorId, clubId);
    if (!member) return [];
    const rows = await trainingsRepository.findByClubResponsibleMember(clubId, member.id, sort);
    return Promise.all(rows.map((r) => this._buildDto(r)));
  }

  async actorHasAnyResponsibleTraining(clubId, actorId) {
    const member = await membersRepository.findByUserId(actorId, clubId);
    if (!member) return false;
    return trainingsRepository.existsResponsibleMember(clubId, member.id);
  }

  async listArchivedForClub(clubId, query = {}) {
    const sort = parseSort(query, ARCHIVED_SORTABLE);
    const rows = await trainingsRepository.findArchivedByClub(clubId, sort);
    return Promise.all(rows.map((r) => this._buildDto(r)));
  }

  async getById(clubId, trainingId) {
    const training = await trainingsRepository.findActiveById(trainingId);
    if (!training || training.club_id !== clubId) throw AppError.notFound('Entrenamiento no encontrado.');
    return this._buildDto(training);
  }

  async create(clubId, data, actorId) {
    this._assertSchedulesValid(data.schedules);
    const targets = await this._resolveTargets(clubId, data);
    const responsibles = data.responsibles || [];
    await this._assertResponsiblesValid(clubId, responsibles, targets.targetGroups);

    const trainingId = await withTransaction(async (conn) => {
      const id = await trainingsRepository.createTraining(
        {
          clubId,
          name: data.name,
          description: data.description || null,
          color: data.color || '#6366F1',
          startDate: data.startDate,
          endDate: data.endDate || null,
          status: data.status || 'active',
          createdBy: actorId,
        },
        conn
      );
      await trainingsRepository.setSchedules(id, data.schedules, conn);
      await trainingsRepository.setTargetMembers(id, targets.targetMembers, conn);
      await trainingsRepository.setTargetGroups(id, targets.targetGroups, conn);
      await trainingsRepository.setExclusions(id, targets.exclusionMemberIds, conn);
      await trainingsRepository.setResponsibleMembers(id, responsibles, conn);
      return id;
    });

    await auditRepository.logAction({ userId: actorId, clubId, action: 'TRAINING_CREATED', entityType: 'training', entityId: trainingId, changes: { name: data.name } });

    // Genera de inmediato las primeras sesiones — no hace falta esperar al cron nocturno.
    await trainingAttendanceService.generateForTraining(trainingId);

    return this.getById(clubId, trainingId);
  }

  async update(clubId, trainingId, data, actorId) {
    const training = await trainingsRepository.findActiveById(trainingId);
    if (!training || training.club_id !== clubId) throw AppError.notFound('Entrenamiento no encontrado.');
    if (training.archived_at) throw AppError.conflict('Este entrenamiento está archivado — restáuralo antes de editarlo.');

    const updates = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description || null;
    if (data.color !== undefined) updates.color = data.color;
    if (data.startDate !== undefined) updates.start_date = data.startDate;
    if (data.endDate !== undefined) updates.end_date = data.endDate || null;
    if (data.status !== undefined) updates.status = data.status;

    if (data.schedules !== undefined) this._assertSchedulesValid(data.schedules);

    const targetsChanged = data.targetMembers !== undefined || data.targetGroups !== undefined || data.exclusionMemberIds !== undefined;
    const targets = targetsChanged
      ? await this._resolveTargets(clubId, {
          targetMembers: data.targetMembers ?? (await trainingsRepository.getTargetMembers(trainingId)),
          targetGroups: data.targetGroups ?? (await trainingsRepository.getTargetGroups(trainingId)),
          exclusionMemberIds: data.exclusionMemberIds ?? (await trainingsRepository.getExclusionMemberIds(trainingId)),
        })
      : null;

    const responsiblesChanged = data.responsibles !== undefined;
    if (responsiblesChanged) {
      const targetGroupIds = targets ? targets.targetGroups : await trainingsRepository.getTargetGroups(trainingId);
      await this._assertResponsiblesValid(clubId, data.responsibles, targetGroupIds);
    }

    await withTransaction(async (conn) => {
      if (Object.keys(updates).length) await trainingsRepository.updateById(trainingId, updates, conn);
      if (data.schedules !== undefined) await trainingsRepository.setSchedules(trainingId, data.schedules, conn);
      if (targets) {
        await trainingsRepository.setTargetMembers(trainingId, targets.targetMembers, conn);
        await trainingsRepository.setTargetGroups(trainingId, targets.targetGroups, conn);
        await trainingsRepository.setExclusions(trainingId, targets.exclusionMemberIds, conn);
      }
      if (responsiblesChanged) await trainingsRepository.setResponsibleMembers(trainingId, data.responsibles, conn);
    });

    const changes = buildDiff({
      name: updates.name !== undefined ? diffValue(training.name, updates.name) : undefined,
      status: updates.status !== undefined ? diffValue(training.status, updates.status) : undefined,
    });
    if (changes) {
      await auditRepository.logAction({ userId: actorId, clubId, action: 'TRAINING_UPDATED', entityType: 'training', entityId: trainingId, changes });
    }

    // Si cambiaron el horario/objetivos (o se reactivó), regenera sesiones para quien
    // corresponda ahora — mismo criterio que charges.service.js#update.
    if (data.schedules !== undefined || targets || (data.status === 'active' && training.status !== 'active')) {
      await trainingAttendanceService.generateForTraining(trainingId);
    }

    return this.getById(clubId, trainingId);
  }

  async remove(clubId, trainingId, actorId) {
    const training = await trainingsRepository.findActiveById(trainingId);
    if (!training || training.club_id !== clubId) throw AppError.notFound('Entrenamiento no encontrado.');
    if (!training.archived_at) throw AppError.conflict('Solo se pueden eliminar entrenamientos archivados — archívalo primero.');
    await trainingsRepository.softDelete(trainingId);
    await auditRepository.logAction({ userId: actorId, clubId, action: 'TRAINING_DELETED', entityType: 'training', entityId: trainingId, changes: { name: training.name } });
  }

  async archive(clubId, trainingId, actorId) {
    const training = await trainingsRepository.findActiveById(trainingId);
    if (!training || training.club_id !== clubId) throw AppError.notFound('Entrenamiento no encontrado.');
    if (training.archived_at) throw AppError.conflict('Este entrenamiento ya está archivado.');
    await trainingsRepository.archive(trainingId);
    if (training.status === 'active') await trainingsRepository.updateById(trainingId, { status: 'inactive' });
    await auditRepository.logAction({ userId: actorId, clubId, action: 'TRAINING_ARCHIVED', entityType: 'training', entityId: trainingId, changes: { name: training.name } });
    return this.getById(clubId, trainingId);
  }

  async restore(clubId, trainingId, actorId) {
    const training = await trainingsRepository.findActiveById(trainingId);
    if (!training || training.club_id !== clubId) throw AppError.notFound('Entrenamiento no encontrado.');
    if (!training.archived_at) throw AppError.conflict('Este entrenamiento no está archivado.');
    await trainingsRepository.restore(trainingId);
    await auditRepository.logAction({ userId: actorId, clubId, action: 'TRAINING_RESTORED', entityType: 'training', entityId: trainingId, changes: { name: training.name } });
    return this.getById(clubId, trainingId);
  }
}

module.exports = new TrainingsService();
