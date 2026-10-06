const trainingsRepository = require('../repositories/trainings.repository');
const trainingAttendancesRepository = require('../repositories/trainingAttendances.repository');
const membersRepository = require('../repositories/members.repository');
const memberMembershipsRepository = require('../repositories/memberMemberships.repository');
const { COVERAGE_REASONS, coversDate, dateReason } = require('../helpers/membership');
const membersService = require('./members.service');
const auditRepository = require('../repositories/audit.repository');
const permissionService = require('./permission.service');
const AppError = require('../helpers/AppError');
const { toAbsoluteMediaUrl } = require('../helpers/mediaUrl');
const { pool } = require('../config/database');
const { FUNCTIONS } = require('../config/constants');

// Ventana rodante de generación: bastante más ancha que "actual+siguiente" de Cobros porque acá
// la granularidad es semanal, no mensual — hace falta ventana para que la matriz tenga columnas
// suficientes sin depender de que el cron corra todos los días.
const GENERATION_WINDOW_DAYS = 56;
const MIN_WINDOW_SIZE = 1;
// Tope duro en 5 — pedido explícito, ver training-attendance.page.ts#SESSION_WINDOW_SIZE (mismo
// límite del lado del frontend; este es el respaldo real del backend por si algo pidiera más).
const MAX_WINDOW_SIZE = 5;
const DEFAULT_WINDOW_SIZE = 5;
const MARKABLE_STATUSES = ['pending', 'attended', 'absent', 'exempt'];
/** Faltas seguidas que disparan el aviso al entrenador (solo al llegar justo a este número). */
const ABSENCE_STREAK_ALERT = 3;
/** Días hacia atrás para el % de asistencia de la matriz. */
const STATS_WINDOW_DAYS = 60;
const TIME_REGEX = /^\d{2}:\d{2}(:\d{2})?$/;

const pad = (n) => String(n).padStart(2, '0');
function formatDateOnly(date) {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
/** JS `getUTCDay()` es 0=domingo..6=sábado; ISO (usado en `training_schedules.day_of_week`) es
 * 1=lunes..7=domingo. */
function isoDayOfWeek(date) {
  const jsDay = date.getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

/**
 * Mirror de chargeInstances.service.js + payments.service.js para lo que aplica a asistencia:
 * generación idempotente de sesiones (`INSERT IGNORE`), acceso acotado por responsable
 * (entrenador) con prioridad de grupo, y una matriz miembro×fecha en vez de miembro×período.
 * Sin dinero de por medio: una marca de asistencia es una sola mutación (no hay "abono parcial"
 * ni "a quién se le paga").
 */
class TrainingAttendanceService {
  /** "Primer nombre + primer apellido" — mismo criterio que payments.service.js#_shortName. */
  _shortName(m) {
    return [m.first_name, m.last_name].filter(Boolean).join(' ');
  }

  /** `exempt` se abre en dos etiquetas según `exempt_type`, igual criterio que
   * payments.service.js#_resolveDisplayStatus — acá no hay "overdue" calculado (no se pidió). */
  _resolveDisplayStatus(row) {
    if (row.status === 'exempt') return row.exempt_type === 'not_applicable' ? 'not_applicable' : 'frozen';
    return row.status;
  }

  _matrixCellToDto(row) {
    return {
      id: row.id,
      sessionDate: formatDateOnly(row.session_date),
      status: row.status,
      displayStatus: this._resolveDisplayStatus(row),
      exemptReason: row.exempt_reason,
      exemptType: row.exempt_type,
    };
  }

  /** `notApplicableReason`: el miembro no estaba en el club ese día ("Antes de su ingreso" / "Retirado"). */
  _virtualCellToDto(sessionDate, notApplicableReason = null) {
    if (notApplicableReason) {
      return { id: null, sessionDate, status: 'exempt', displayStatus: 'not_applicable', exemptReason: notApplicableReason, exemptType: 'not_applicable' };
    }
    return { id: null, sessionDate, status: 'pending', displayStatus: 'pending', exemptReason: null, exemptType: null };
  }

  _attendanceToDto(row) {
    return {
      id: row.id,
      uuid: row.uuid,
      trainingId: row.training_id,
      trainingName: row.training_name,
      trainingColor: row.training_color,
      sessionDate: formatDateOnly(row.session_date),
      status: row.status,
      displayStatus: this._resolveDisplayStatus(row),
      exemptReason: row.exempt_reason,
      exemptType: row.exempt_type,
    };
  }

  // --- Generación de sesiones (mirror de chargeInstances.service.js) ---

  /** Fechas de sesión dentro de la ventana rodante, respetando `start_date`/`end_date` — mismo
   * criterio de "no generar fuera de la ventana en que el entrenamiento corresponde" que
   * chargeInstances.service.js#_computePeriods. */
  _computeSessionDates(schedules, startDate, endDate, referenceDate = new Date(), overrides = []) {
    const cancelled = new Set(overrides.filter((o) => o.kind === 'cancelled').map((o) => formatDateOnly(o.session_date)));
    // Los días "extra" son explícitos: se generan siempre (no dependen de la ventana rodante).
    const extras = overrides.filter((o) => o.kind === 'extra').map((o) => formatDateOnly(o.session_date));
    const scheduled = this._computeScheduledDates(schedules, startDate, endDate, referenceDate).filter((d) => !cancelled.has(d));
    return [...new Set([...scheduled, ...extras])].sort();
  }

  _computeScheduledDates(schedules, startDate, endDate, referenceDate = new Date()) {
    const today = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate()));
    const rangeStart = new Date(Math.max(today.getTime(), new Date(startDate).getTime()));
    const windowEnd = new Date(today.getTime() + GENERATION_WINDOW_DAYS * 86400000);
    const rangeEnd = endDate ? new Date(Math.min(windowEnd.getTime(), new Date(endDate).getTime())) : windowEnd;
    if (rangeEnd < rangeStart) return [];

    const scheduleDays = new Set(schedules.map((s) => s.dayOfWeek));
    const dates = [];
    const cursor = new Date(rangeStart);
    while (cursor <= rangeEnd) {
      if (scheduleDays.has(isoDayOfWeek(cursor))) dates.push(formatDateOnly(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dates;
  }

  async generateForTraining(trainingId, referenceDate = new Date()) {
    const training = await trainingsRepository.findActiveById(trainingId);
    // Un entrenamiento archivado/inactivo no debe seguir generando sesiones en silencio — mismo
    // criterio que chargeInstances.service.js#generateForCharge.
    if (!training || training.status !== 'active' || training.archived_at) return 0;

    const [schedules, memberIds, overrides] = await Promise.all([
      trainingsRepository.getSchedules(trainingId),
      trainingsRepository.expandTargetMemberIds(trainingId),
      trainingsRepository.getSessionOverrides(trainingId),
    ]);
    // Sin horario semanal puede haber igual días "extra" agregados a mano.
    if ((!schedules.length && !overrides.some((o) => o.kind === 'extra')) || !memberIds.length) return 0;

    const dates = this._computeSessionDates(schedules, training.start_date, training.end_date, referenceDate, overrides);
    if (!dates.length) return 0;

    // Solo las sesiones en que cada miembro está en el club (desde su ingreso, sin sus retiros).
    const memberships = await memberMembershipsRepository.findByMembers(memberIds);
    const rows = [];
    for (const sessionDate of dates) {
      for (const memberId of memberIds) {
        if (coversDate(memberships.get(memberId), sessionDate)) rows.push({ trainingId, memberId, sessionDate });
      }
    }
    return trainingAttendancesRepository.bulkInsertIgnore(rows);
  }

  /** Crea (idempotente) la fila de UN miembro/fecha si todavía no existe — usado al marcar
   * asistencia sobre una celda virtual (ej. un miembro agregado después de la última
   * generación). Mismo patrón que chargeInstances.service.js#ensureInstance. */
  async ensureAttendance(trainingId, memberId, sessionDate) {
    await trainingAttendancesRepository.bulkInsertIgnore([{ trainingId, memberId, sessionDate }]);
    return trainingAttendancesRepository.findByTrainingMemberDate(trainingId, memberId, sessionDate);
  }

  /** `clubId` opcional: sin él, recorre todos los clubes (cron diario). */
  async generateDueTrainings(clubId = null) {
    const trainings = clubId ? await trainingsRepository.findActiveByClubForGeneration(clubId) : await trainingsRepository.findAllActiveForGeneration();
    let total = 0;
    for (const training of trainings) {
      // eslint-disable-next-line no-await-in-loop
      total += await this.generateForTraining(training.id);
    }
    return total;
  }

  // --- Acceso (mirror de payments.service.js) ---

  async _resolveAccess(authContext, actorId, clubId) {
    if (permissionService.hasFunction(authContext, FUNCTIONS.VIEW_ATTENDANCE)) return { full: true, memberIds: null };
    const memberIds = await trainingAttendancesRepository.findAccessibleMemberIds(actorId, clubId);
    return { full: false, memberIds };
  }

  _assertAccessible(access, memberId) {
    if (access.full) return;
    if (!access.memberIds.includes(memberId)) throw AppError.notFound('Miembro no encontrado.');
  }

  async getVisibleMemberIds(authContext, actorId, clubId) {
    const [memberAccess, attendanceAccess] = await Promise.all([
      membersService.resolveAccessForController(authContext, actorId, clubId),
      this._resolveAccess(authContext, actorId, clubId),
    ]);
    if (memberAccess.full && attendanceAccess.full) return null;
    if (memberAccess.full) return attendanceAccess.memberIds;
    if (attendanceAccess.full) return memberAccess.memberIds;
    const set = new Set(attendanceAccess.memberIds);
    return memberAccess.memberIds.filter((id) => set.has(id));
  }

  async assertMemberAttendanceAccessible(clubId, memberId, actorId, authContext) {
    await membersService.getById(clubId, memberId, authContext, actorId);
    const access = await this._resolveAccess(authContext, actorId, clubId);
    this._assertAccessible(access, memberId);
    return access;
  }

  /** Camino combinado para ver/marcar la asistencia de UN miembro puntual — además del camino
   * normal, acepta ser el responsable RESUELTO (con prioridad de grupo) para ESE miembro
   * puntual, mismo patrón que payments.service.js#assertChargeMemberPaymentAccessible. */
  async assertTrainingMemberAccessible(training, memberId, actorId, authContext) {
    const member = await membersRepository.findByUserId(actorId, training.club_id);
    if (member) {
      const resolved = await trainingsRepository.resolveResponsibles(training.id, [memberId]);
      if (resolved.get(memberId)?.memberId === member.id) return;
    }
    await this.assertMemberAttendanceAccessible(training.club_id, memberId, actorId, authContext);
  }

  /** ¿A quién de los participantes de ESTE entrenamiento puede ver el actor? Mismo mirror que
   * payments.service.js#_resolveChargeParticipants — un responsable sin rol ve SOLO los
   * miembros cuyo responsable resuelto sea él (acotado a su grupo, o a todos si no tiene uno). */
  async _resolveTrainingParticipants(training, actorId, authContext) {
    // Incluye a los retirados con asistencias registradas (su historial no desaparece de la matriz).
    const participantIds = await trainingsRepository.expandTargetMemberIds(training.id, undefined, { inactive: 'all' });
    if (permissionService.hasAnyFunction(authContext, [FUNCTIONS.VIEW_ATTENDANCE, FUNCTIONS.VIEW_ATTENDANCE_SCOPED])) {
      const visibleMemberIds = await this.getVisibleMemberIds(authContext, actorId, training.club_id);
      const memberIds = visibleMemberIds === null ? participantIds : participantIds.filter((id) => visibleMemberIds.includes(id));
      return { memberIds, scopedToMemberId: null };
    }
    const member = await membersRepository.findByUserId(actorId, training.club_id);
    if (!member || !(await trainingsRepository.isAnyResponsible(training.id, member.id))) {
      throw AppError.forbidden('No tienes permiso para ver este entrenamiento.');
    }
    const resolved = await trainingsRepository.resolveResponsibles(training.id, participantIds);
    const memberIds = participantIds.filter((id) => resolved.get(id)?.memberId === member.id);
    return { memberIds, scopedToMemberId: member.id };
  }

  // --- Matriz miembro×fecha ---

  /** Ventana de fechas mostrada — a diferencia de charges.service.js#_matrixPeriods (que CALCULA
   * períodos con una fórmula de calendario, así que puede "correr" el ancla exactamente 1 unidad
   * con solo aritmética de fechas), acá las fechas de sesión son irregulares (días de la semana
   * configurables, no mensual/anual) — no hay fórmula que las prediga sin consultar la BD. Se
   * pagina por PÁGINA COMPLETA en vez de "1 columna corrida": `offset` es un entero (0 = la
   * página que incluye hoy, ±1 = página siguiente/anterior completa), sin fechas de por medio —
   * evita que el frontend tenga que conocer la lista completa de fechas reales solo para
   * calcular "la fecha 1 posición antes/después".
   *
   * Sin offset (vista por defecto), la ventana TERMINA en la sesión de hoy (pedido explícito: hoy
   * siempre a la derecha, mismo criterio que payments.service.js#_matrixPeriods) y arranca hasta
   * `size - 1` sesiones atrás; si hay menos sesiones anteriores que eso, el arranque se clampea a
   * la primera sesión real y la ventana se completa hacia ADELANTE con sesiones futuras (nunca
   * se rellena con columnas vacías) — así siempre se muestran `size` sesiones salvo que el
   * entrenamiento realmente tenga menos que eso en total. `startIdx` se clampea contra
   * `dates.length - size` (no solo `dates.length - 1`) por el mismo motivo: evita que una página
   * completa hacia adelante/atrás "aterrice" pegada al borde con menos columnas de las que
   * realmente hay disponibles para mostrar. */
  async _matrixSessionDates(trainingId, offset, columns, all = false) {
    const [rows] = await pool.query('SELECT DISTINCT session_date FROM training_attendances WHERE training_id = ? ORDER BY session_date ASC', [
      trainingId,
    ]);
    // Un día cancelado no es una columna de la matriz (aunque hubiera filas viejas sin marcar).
    const cancelled = new Set(
      (await trainingsRepository.getSessionOverrides(trainingId)).filter((o) => o.kind === 'cancelled').map((o) => formatDateOnly(o.session_date))
    );
    const dates = rows.map((r) => formatDateOnly(r.session_date)).filter((d) => !cancelled.has(d));
    if (!dates.length) return { dates: [], canGoBack: false, canGoForward: false };
    // Exportación: todas las sesiones hasta hoy.
    if (all) return { dates: dates.filter((d) => d <= formatDateOnly(new Date())), canGoBack: false, canGoForward: false };

    const size = Math.max(MIN_WINDOW_SIZE, Math.min(MAX_WINDOW_SIZE, columns || DEFAULT_WINDOW_SIZE));
    const todayStr = formatDateOnly(new Date());
    let todayIdx = dates.findIndex((d) => d >= todayStr);
    if (todayIdx === -1) todayIdx = dates.length - 1;

    const baseStart = Math.max(0, todayIdx - size + 1);
    const maxStart = Math.max(0, dates.length - size);
    let startIdx = baseStart + (offset || 0) * size;
    startIdx = Math.max(0, Math.min(startIdx, maxStart));
    const endIdx = Math.min(dates.length - 1, startIdx + size - 1);
    return { dates: dates.slice(startIdx, endIdx + 1), canGoBack: startIdx > 0, canGoForward: endIdx < dates.length - 1 };
  }

  async getAttendanceMatrix(clubId, trainingId, { offset, columns, all = false } = {}, actorId, authContext) {
    const training = await trainingsRepository.findActiveById(trainingId);
    if (!training || training.club_id !== clubId) throw AppError.notFound('Entrenamiento no encontrado.');

    const trainingDto = {
      id: training.id,
      name: training.name,
      color: training.color,
      status: training.status,
      responsibles: (await trainingsRepository.getResponsibleMembers(training.id)).map((r) => ({
        memberId: r.memberId,
        memberName: r.memberName,
        groupId: r.groupId,
        groupName: r.groupName,
      })),
    };

    const { dates, canGoBack, canGoForward } = await this._matrixSessionDates(trainingId, offset || 0, columns || null, all);
    const { memberIds } = await this._resolveTrainingParticipants(training, actorId, authContext);

    const sessionMeta = await this._buildSessionMeta(trainingId, dates);
    if (!memberIds.length || !dates.length) return { training: trainingDto, sessionDates: dates, sessionMeta, canGoBack, canGoForward, rows: [] };

    const [allMembers, attendances, membershipsByMember] = await Promise.all([
      membersRepository.findNamesByIds(memberIds, clubId),
      trainingAttendancesRepository.findForTrainingAndMembers(trainingId, memberIds),
      memberMembershipsRepository.findByMembers(memberIds),
    ]);

    const cellLookup = new Map();
    for (const att of attendances) {
      const dateKey = formatDateOnly(att.session_date);
      if (!cellLookup.has(att.member_id)) cellLookup.set(att.member_id, new Map());
      cellLookup.get(att.member_id).set(dateKey, att);
    }

    // Solo aparece quien estaba en el club en alguna de las fechas mostradas, o tiene asistencia
    // registrada en ellas (un retirado no queda para siempre en la lista).
    const coveredOn = (m, d) => coversDate(membershipsByMember.get(m.id), d);
    const hasRecordOn = (m, d) => {
      const att = cellLookup.get(m.id)?.get(d);
      return !!att && !(att.status === 'exempt' && COVERAGE_REASONS.includes(att.exempt_reason));
    };
    const members = allMembers.filter((m) => dates.some((d) => coveredOn(m, d) || hasRecordOn(m, d)));

    const rows = members
      .map((m) => ({
        memberId: m.id,
        memberName: this._shortName(m),
        memberAvatarUrl: m.avatar_url ? toAbsoluteMediaUrl(m.avatar_url) : null,
        groupIds: m.group_ids ? m.group_ids.split(',').map(Number) : [],
        // Retirado actualmente (se muestra con su historial de las fechas en que estuvo).
        inactive: m.status === 'inactive',
        cells: dates.reduce((acc, d) => {
          const att = cellLookup.get(m.id)?.get(d);
          acc[d] = att ? this._matrixCellToDto(att) : this._virtualCellToDto(d, dateReason(membershipsByMember.get(m.id), d));
          return acc;
        }, {}),
      }))
      .sort((a, b) => a.memberName.localeCompare(b.memberName));

    return { training: trainingDto, sessionDates: dates, sessionMeta, canGoBack, canGoForward, rows };
  }

  /** Por fecha mostrada: hora (la del horario semanal, o la propia del día si es extra/modificado),
   * nota y de qué tipo es ('scheduled' | 'extra' | 'modified') — la UI lo usa para etiquetar y
   * decidir qué acciones ofrecer sobre esa columna. */
  async _buildSessionMeta(trainingId, dates) {
    const [schedules, overrides] = await Promise.all([trainingsRepository.getSchedules(trainingId), trainingsRepository.getSessionOverrides(trainingId)]);
    const overrideByDate = new Map(overrides.map((o) => [formatDateOnly(o.session_date), o]));
    const meta = {};
    for (const date of dates) {
      const o = overrideByDate.get(date);
      const weekly = schedules.find((s) => s.dayOfWeek === isoDayOfWeek(new Date(`${date}T00:00:00Z`)));
      const kind = o?.kind === 'extra' ? 'extra' : o?.kind === 'modified' ? 'modified' : 'scheduled';
      meta[date] = {
        kind,
        startTime: o?.start_time ?? weekly?.startTime ?? null,
        endTime: o?.end_time ?? weekly?.endTime ?? null,
        note: o?.note ?? null,
      };
    }
    return meta;
  }

  // --- Días especiales (agregar / editar / cancelar / restaurar) ---

  async _assertCanManageSessions(clubId, trainingId, actorId, authContext) {
    const training = await trainingsRepository.findActiveById(trainingId);
    if (!training || training.club_id !== clubId) throw AppError.notFound('Entrenamiento no encontrado.');
    if (training.archived_at) throw AppError.conflict('Este entrenamiento está archivado — restáuralo antes de modificarlo.');
    if (permissionService.hasAnyFunction(authContext, [FUNCTIONS.EDIT_TRAININGS, FUNCTIONS.MARK_ATTENDANCE])) return training;
    // Sin esos permisos, debe ser responsable (entrenador) de ESTE entrenamiento puntual.
    const member = await membersRepository.findByUserId(actorId, clubId);
    if (!member || !(await trainingsRepository.isAnyResponsible(trainingId, member.id))) {
      throw AppError.forbidden('No tienes permiso para modificar los días de este entrenamiento.');
    }
    return training;
  }

  _normalizeSessionInput({ startTime, endTime, note }) {
    if (startTime && !TIME_REGEX.test(startTime)) throw AppError.badRequest('Hora de inicio inválida.');
    if (endTime && !TIME_REGEX.test(endTime)) throw AppError.badRequest('Hora de término inválida.');
    if (startTime && endTime && endTime <= startTime) throw AppError.badRequest('La hora de término debe ser posterior a la de inicio.');
    return { startTime: startTime || null, endTime: endTime || null, note: note ? String(note).slice(0, 255) : null };
  }

  _assertDateInTrainingRange(training, sessionDate) {
    const day = formatDateOnly(sessionDate);
    if (day < formatDateOnly(training.start_date)) throw AppError.badRequest('La fecha es anterior al inicio del entrenamiento.');
    if (training.end_date && day > formatDateOnly(training.end_date)) throw AppError.badRequest('La fecha es posterior al término del entrenamiento.');
    return day;
  }

  /** Agrega un día especial (recuperación, sesión extra o día de un entrenamiento sin horario fijo). */
  async addSession(clubId, trainingId, data, actorId, authContext) {
    const training = await this._assertCanManageSessions(clubId, trainingId, actorId, authContext);
    const day = this._assertDateInTrainingRange(training, data.sessionDate);
    const input = this._normalizeSessionInput(data);

    const [schedules, existing] = await Promise.all([trainingsRepository.getSchedules(trainingId), trainingsRepository.findSessionOverride(trainingId, day)]);
    const isScheduled = schedules.some((s) => s.dayOfWeek === isoDayOfWeek(new Date(`${day}T00:00:00Z`)));
    if (existing?.kind === 'extra') throw AppError.conflict('Ya agregaste un entrenamiento en esa fecha.');
    // Un día del horario semanal que NO está cancelado ya es una sesión: no se duplica.
    if (isScheduled && existing?.kind !== 'cancelled') throw AppError.conflict('Ese día ya es parte del horario semanal.');

    await trainingsRepository.upsertSessionOverride({ trainingId, sessionDate: day, kind: 'extra', ...input, createdBy: actorId });
    await this.generateForTraining(trainingId);
    await auditRepository.logAction({ userId: actorId, clubId, action: 'TRAINING_SESSION_ADDED', entityType: 'training', entityId: trainingId, changes: { sessionDate: day, note: input.note } });
    return { sessionDate: day };
  }

  /** Cambia la hora/nota de UN día (los de horario semanal quedan como 'modified'; los extra siguen 'extra'). */
  async updateSession(clubId, trainingId, sessionDate, data, actorId, authContext) {
    await this._assertCanManageSessions(clubId, trainingId, actorId, authContext);
    const day = formatDateOnly(sessionDate);
    const input = this._normalizeSessionInput(data);
    const existing = await trainingsRepository.findSessionOverride(trainingId, day);
    if (existing?.kind === 'cancelled') throw AppError.conflict('Este día está cancelado — restáuralo primero.');
    const kind = existing?.kind === 'extra' ? 'extra' : 'modified';
    await trainingsRepository.upsertSessionOverride({ trainingId, sessionDate: day, kind, ...input, createdBy: actorId });
    await auditRepository.logAction({ userId: actorId, clubId, action: 'TRAINING_SESSION_UPDATED', entityType: 'training', entityId: trainingId, changes: { sessionDate: day, ...input } });
    return { sessionDate: day };
  }

  /** Cancela un día (no se realiza). Si ya hay asistencia marcada, no se puede — evita perder datos. */
  async cancelSession(clubId, trainingId, sessionDate, data, actorId, authContext) {
    await this._assertCanManageSessions(clubId, trainingId, actorId, authContext);
    const day = formatDateOnly(sessionDate);
    if (await trainingAttendancesRepository.countMarkedForDate(trainingId, day)) {
      throw AppError.conflict('Ya hay asistencia marcada ese día. Desmárcala primero (o déjala como no aplica) para poder cancelarlo.');
    }
    const existing = await trainingsRepository.findSessionOverride(trainingId, day);
    if (existing?.kind === 'extra') {
      // Un día extra cancelado simplemente deja de existir.
      await trainingsRepository.deleteSessionOverride(trainingId, day);
    } else {
      await trainingsRepository.upsertSessionOverride({ trainingId, sessionDate: day, kind: 'cancelled', note: data?.note, createdBy: actorId });
    }
    await trainingAttendancesRepository.deletePendingForDate(trainingId, day);
    await auditRepository.logAction({ userId: actorId, clubId, action: 'TRAINING_SESSION_CANCELLED', entityType: 'training', entityId: trainingId, changes: { sessionDate: day, note: data?.note ?? null } });
  }

  /** Vuelve un día cancelado/modificado a lo que dice el horario semanal. */
  async restoreSession(clubId, trainingId, sessionDate, actorId, authContext) {
    await this._assertCanManageSessions(clubId, trainingId, actorId, authContext);
    const day = formatDateOnly(sessionDate);
    const existing = await trainingsRepository.findSessionOverride(trainingId, day);
    if (!existing || existing.kind === 'extra') throw AppError.conflict('Ese día no tiene cambios que deshacer.');
    await trainingsRepository.deleteSessionOverride(trainingId, day);
    await this.generateForTraining(trainingId);
    await auditRepository.logAction({ userId: actorId, clubId, action: 'TRAINING_SESSION_UPDATED', entityType: 'training', entityId: trainingId, changes: { sessionDate: day, restored: true } });
  }

  /** Días cancelados (para poder restaurarlos desde la UI aunque no salgan como columna). */
  async listCancelledSessions(clubId, trainingId, actorId, authContext) {
    await this._assertCanManageSessions(clubId, trainingId, actorId, authContext);
    const overrides = await trainingsRepository.getSessionOverrides(trainingId);
    return overrides.filter((o) => o.kind === 'cancelled').map((o) => ({ sessionDate: formatDateOnly(o.session_date), note: o.note }));
  }

  /** Marca la asistencia de UN miembro en UNA fecha puntual — crea la fila si todavía no existe
   * (celda virtual). `status`: 'pending' (deshace la marca) | 'attended' | 'absent' | 'exempt'
   * (con `exemptType`: 'frozen'|'not_applicable'). */
  async markAttendance(clubId, trainingId, memberId, sessionDate, data, actorId, authContext) {
    const training = await trainingsRepository.findActiveById(trainingId);
    if (!training || training.club_id !== clubId) throw AppError.notFound('Entrenamiento no encontrado.');
    await this.assertTrainingMemberAccessible(training, memberId, actorId, authContext);

    const participantIds = await trainingsRepository.expandTargetMemberIds(trainingId, undefined, { inactive: 'all' });
    if (!participantIds.includes(memberId)) throw AppError.badRequest('Este miembro no participa de este entrenamiento.');

    // Solo días en que el miembro estaba en el club (historial de pertenencia).
    const reason = dateReason(await memberMembershipsRepository.findByMember(memberId), sessionDate);
    if (reason) {
      throw AppError.badRequest(reason === 'Retirado' ? 'El miembro estaba retirado del club ese día: no le corresponde asistencia.' : 'Esa sesión es anterior al ingreso del miembro: no le corresponde asistencia.');
    }

    if (!MARKABLE_STATUSES.includes(data.status)) throw AppError.badRequest('Estado de asistencia inválido.');

    const row = await this.ensureAttendance(trainingId, memberId, sessionDate);
    await trainingAttendancesRepository.markAttendance(row.id, {
      status: data.status,
      exemptType: data.exemptType,
      exemptReason: data.exemptReason,
      markedBy: actorId,
    });

    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'ATTENDANCE_MARKED',
      entityType: 'training_attendance',
      entityId: row.id,
      changes: { status: data.status, sessionDate },
    });

    if (data.status === 'absent') await this._checkAbsenceStreaks(training, [memberId]);

    const updated = await trainingAttendancesRepository.findActiveById(row.id);
    return this._matrixCellToDto(updated);
  }

  /** Pasar lista: marca a varios miembros en UNA sesión de una vez. Cada marca valida acceso y
   * pertenencia igual que `markAttendance`; las que fallan se informan sin cortar el resto. Se
   * registra una sola acción en la auditoría (no una por jugador). */
  async markSession(clubId, trainingId, sessionDate, marks, actorId, authContext) {
    const training = await trainingsRepository.findActiveById(trainingId);
    if (!training || training.club_id !== clubId) throw AppError.notFound('Entrenamiento no encontrado.');
    const participantIds = await trainingsRepository.expandTargetMemberIds(trainingId, undefined, { inactive: 'all' });
    const saved = [];
    const failed = [];
    for (const mark of marks) {
      const memberId = Number(mark.memberId);
      try {
        if (!MARKABLE_STATUSES.includes(mark.status)) throw AppError.badRequest('Estado de asistencia inválido.');
        if (!participantIds.includes(memberId)) throw AppError.badRequest('No participa de este entrenamiento.');
        await this.assertTrainingMemberAccessible(training, memberId, actorId, authContext);
        if (dateReason(await memberMembershipsRepository.findByMember(memberId), sessionDate)) throw AppError.badRequest('No estaba en el club ese día.');
        const row = await this.ensureAttendance(trainingId, memberId, sessionDate);
        await trainingAttendancesRepository.markAttendance(row.id, {
          status: mark.status,
          exemptType: mark.status === 'exempt' ? mark.exemptType ?? 'frozen' : null,
          exemptReason: null,
          markedBy: actorId,
        });
        saved.push({ memberId, status: mark.status });
      } catch (error) {
        failed.push({ memberId, message: error.message });
      }
    }
    if (saved.length) {
      await auditRepository.logAction({
        userId: actorId,
        clubId,
        action: 'ATTENDANCE_ROLL_CALL',
        entityType: 'training',
        entityId: trainingId,
        changes: {
          sessionDate,
          attended: saved.filter((s) => s.status === 'attended').length,
          absent: saved.filter((s) => s.status === 'absent').length,
        },
      });
      await this._checkAbsenceStreaks(training, saved.filter((s) => s.status === 'absent').map((s) => s.memberId));
    }
    return { saved: saved.length, failed };
  }

  /** Si un miembro acaba de llegar a ABSENCE_STREAK_ALERT faltas seguidas (contando solo las
   * sesiones marcadas asistió/no asistió), se avisa a los entrenadores del entrenamiento que
   * tienen cuenta. Solo al llegar justo al número, para no repetir el aviso en cada falta. */
  async _checkAbsenceStreaks(training, memberIds) {
    if (!memberIds.length) return;
    try {
      const notificationsService = require('./notifications.service');
      const coaches = await trainingsRepository.getResponsibleMembers(training.id);
      const [coachUsers] = coaches.length
        ? await pool.query('SELECT id, user_id FROM members WHERE id IN (?) AND user_id IS NOT NULL', [coaches.map((c) => c.memberId)])
        : [[]];
      if (!coachUsers.length) return;
      for (const memberId of memberIds) {
        const [rows] = await pool.query(
          `SELECT status FROM training_attendances
           WHERE training_id = ? AND member_id = ? AND status IN ('attended', 'absent') AND session_date <= CURDATE()
           ORDER BY session_date DESC LIMIT ?`,
          [training.id, memberId, ABSENCE_STREAK_ALERT + 1]
        );
        const streak = rows.findIndex((r) => r.status !== 'absent');
        const count = streak === -1 ? rows.length : streak;
        if (count !== ABSENCE_STREAK_ALERT) continue;
        const [named] = await membersRepository.findNamesByIds([memberId], training.club_id);
        const name = named ? this._shortName(named) : 'Un jugador';
        for (const coach of coachUsers) {
          await notificationsService.notifyUser({
            userId: coach.user_id,
            clubId: training.club_id,
            type: 'warning',
            title: `${name} lleva ${ABSENCE_STREAK_ALERT} faltas seguidas`,
            message: `En ${training.name}. Puede valer la pena preguntarle si está todo bien.`,
            link: `/trainings/attendance/members/${memberId}`,
          });
        }
      }
    } catch {
      // El aviso es un extra: nunca debe hacer fallar el registro de la asistencia.
    }
  }

  /** % de asistencia de cada participante visible en los últimos STATS_WINDOW_DAYS días (solo
   * sesiones marcadas asistió/no asistió hasta hoy) y su racha actual de faltas seguidas. */
  async getTrainingStats(clubId, trainingId, actorId, authContext) {
    const training = await trainingsRepository.findActiveById(trainingId);
    if (!training || training.club_id !== clubId) throw AppError.notFound('Entrenamiento no encontrado.');
    const { memberIds } = await this._resolveTrainingParticipants(training, actorId, authContext);
    if (!memberIds.length) return { days: STATS_WINDOW_DAYS, members: {} };
    const [rows] = await pool.query(
      `SELECT member_id, session_date, status FROM training_attendances
       WHERE training_id = ? AND member_id IN (?) AND status IN ('attended', 'absent')
         AND session_date BETWEEN DATE_SUB(CURDATE(), INTERVAL ? DAY) AND CURDATE()
       ORDER BY session_date DESC`,
      [trainingId, memberIds, STATS_WINDOW_DAYS]
    );
    const members = {};
    for (const r of rows) {
      const m = (members[r.member_id] ??= { attended: 0, marked: 0, streak: 0, streakOpen: true, lastAttended: null });
      m.marked += 1;
      if (r.status === 'attended') {
        m.attended += 1;
        if (!m.lastAttended) m.lastAttended = formatDateOnly(r.session_date);
        m.streakOpen = false;
      } else if (m.streakOpen) {
        m.streak += 1;
      }
    }
    for (const m of Object.values(members)) {
      m.pct = m.marked ? Math.round((m.attended / m.marked) * 100) : null;
      delete m.streakOpen;
    }
    return { days: STATS_WINDOW_DAYS, alertAt: ABSENCE_STREAK_ALERT, members };
  }

  // --- Ficha de un miembro (pestañas por entrenamiento) ---

  async listForMember(clubId, memberId, actorId, authContext) {
    await this.assertMemberAttendanceAccessible(clubId, memberId, actorId, authContext);
    const rows = await trainingAttendancesRepository.findForMember(memberId);
    return { attendances: rows.map((r) => this._attendanceToDto(r)) };
  }
}

module.exports = new TrainingAttendanceService();
